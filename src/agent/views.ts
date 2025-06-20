import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { v4 as uuid } from "uuid";
import { Logger } from "winston";
import { z } from "zod";
import { MessageManagerState } from "../agent/message_manager/views";
import type { BrowserStateHistory } from "../browser/views";
import type { ActionModel } from "../controller/registry/views";
import { HistoryTreeProcessor } from "../dom/history_tree_processor/service";
import { DOMHistoryElement } from "../dom/history_tree_processor/view";
import type { DOMElementNode } from "../dom/views";

import type path from "path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { modelDump } from "../bn_utils";
import type { SelectorMap } from "../dom/views";
import bnLogger from "../logging_config";

// 工具调用方法类型定义
type ToolCallingMethod =
	| "functionCalling"
	| "jsonMode"
	| "jsonSchema"
	| "raw"
	| "auto";

// Configure Winston logger
const logger: Logger = bnLogger.child({
	module: "browser_node/agent/views",
});

class AgentSettings {
	useVision: boolean = true;
	useVisionForPlanner: boolean = false;
	saveConversationPath?: string;
	saveConversationPathEncoding?: string = "utf-8";
	maxFailures: number = 1;
	retryDelay: number = 10;
	maxInputTokens: number = 128000;
	validateOutput: boolean = false;
	messageContext?: string;
	generateGif: boolean | string = false;
	availableFilePaths?: string[];
	overrideSystemMessage?: string;
	extendSystemMessage?: string;
	includeAttributes: string[] = [
		"title",
		"type",
		"name",
		"role",
		"tabindex",
		"aria-label",
		"placeholder",
		"value",
		"alt",
		"aria-expanded",
	];

	maxActionsPerStep: number = 10;
	toolCallingMethod?: ToolCallingMethod = "auto";
	pageExtractionLLM?: BaseChatModel;
	plannerLLM?: BaseChatModel | null;
	plannerInterval: number = 1;

	constructor(settings: Partial<AgentSettings> = {}) {
		Object.assign(this, settings);
	}
}

interface AgentHistoryList {
	history: AgentHistory[];

	totalDurationSeconds(): number;
	totalInputTokens(): number;
	inputTokenUsage(): number[];
	saveToFile(filepath: string): void;
	lastAction(): any | null;
	errors(): (string | null)[];
	finalResult(): string | null;
	isDone(): boolean;
	isSuccessful(): boolean | null;
	hasErrors(): boolean;
	urls(): (string | null)[];
	screenshots(): (string | null)[];
	actionNames(): string[];
	modelThoughts(): AgentBrain[];
	modelOutputs(): AgentOutput[];
	modelActions(): any[];
	actionResults(): ActionResult[];
	extractedContent(): string[];
	modelActionsFiltered(include?: string[]): any[];
	numberOfSteps(): number;
}

class AgentState {
	agentId: string;
	nSteps: number;
	consecutiveFailures: number;
	lastResult: ActionResult[] | null;
	history: AgentHistoryList;
	lastPlan: string | null;
	paused: boolean;
	stopped: boolean;
	messageManagerState: MessageManagerState;

	constructor(
		params: {
			agentId?: string;
			nSteps?: number;
			consecutiveFailures?: number;
			lastResult?: ActionResult[] | null;
			history?: AgentHistoryList;
			lastPlan?: string | null;
			paused?: boolean;
			stopped?: boolean;
			messageManagerState?: MessageManagerState;
		} = {},
	) {
		this.agentId = params.agentId ?? uuid();
		this.nSteps = params.nSteps ?? 1;
		this.consecutiveFailures = params.consecutiveFailures ?? 0;
		this.lastResult = params.lastResult ?? null;
		this.history = params.history ?? new AgentHistoryList([]);
		this.lastPlan = params.lastPlan ?? null;
		this.paused = params.paused ?? false;
		this.stopped = params.stopped ?? false;
		this.messageManagerState =
			params.messageManagerState ?? new MessageManagerState();
	}
}

class AgentStepInfo {
	stepNumber: number;
	maxSteps: number;

	constructor(stepNumber: number, maxSteps: number) {
		this.stepNumber = stepNumber;
		this.maxSteps = maxSteps;
	}

	isLastStep(): boolean {
		return this.stepNumber >= this.maxSteps - 1;
	}
}

class ActionResult {
	isDone?: boolean = false;
	success?: boolean | null = null;
	extractedContent?: string | null = null;
	error?: string | null = "";
	includeInMemory: boolean = false;

	constructor(params: {
		isDone?: boolean;
		success?: boolean;
		extractedContent?: string;
		error?: string;
		includeInMemory?: boolean;
	}) {
		this.isDone = params.isDone;
		this.success = params.success;
		this.extractedContent = params.extractedContent;
		this.error = params.error;
		this.includeInMemory = params.includeInMemory ?? false;
	}
}

class StepMetadata {
	stepStartTime: number;
	stepEndTime: number;
	inputTokens: number;
	stepNumber: number;

	constructor(
		stepStartTime: number,
		stepEndTime: number,
		inputTokens: number,
		stepNumber: number,
	) {
		this.stepStartTime = stepStartTime;
		this.stepEndTime = stepEndTime;
		this.inputTokens = inputTokens;
		this.stepNumber = stepNumber;
	}
	get durationSeconds(): number {
		return this.stepEndTime - this.stepStartTime;
	}
}
// AgentBrain schema
const AgentBrainSchema = z.object({
	evaluationPreviousGoal: z.string().describe("Previous goal evaluation"),
	memory: z.string().describe("Memory"),
	nextGoal: z.string().describe("Next goal"),
});

type AgentBrain = z.infer<typeof AgentBrainSchema>;
/**
 * Agent output model
 *
 * @dev note: This model is extended through custom actions in AgentService.
 * You can also use some fields that don't exist in this model as long as
 * they are registered in the DynamicActions model.
 */
class AgentOutput {
	currentState: AgentBrain;
	action: ActionModel[];

	constructor(currentState: AgentBrain, action: ActionModel[]) {
		this.currentState = currentState;
		this.action = action;
	}

	static typeWithCustomActions(customActions: ActionModel): typeof AgentOutput {
		return class CustomAgentOutput extends AgentOutput {
			constructor(currentState: AgentBrain, outputAction: ActionModel[]) {
				super(currentState, outputAction);
				this.action =
					outputAction.length > 0
						? outputAction.map(() => {
								return Object.create(
									Object.getPrototypeOf(customActions),
									Object.getOwnPropertyDescriptors(customActions),
								);
							})
						: [
								Object.create(
									Object.getPrototypeOf(customActions),
									Object.getOwnPropertyDescriptors(customActions),
								),
							];

				for (let i = 0; i < outputAction.length; i++) {
					const llmAction = outputAction[i];
					for (const key in llmAction) {
						if (this.action[i]!.hasOwnProperty(key)) {
							this.action[i]![key] = llmAction[key];
						} else {
							this.action[i]![key] = llmAction[key];
						}
					}

					for (const key in this.action[i]!) {
						if (outputAction[i]!.hasOwnProperty(key)) {
							this.action[i]![key] = outputAction[i]![key];
						} else {
							this.action[i]![key] = undefined;
						}
					}
				}
			}
		};
	}
	static schemaWithCustomActions(custom_actions: ActionModel): any {
		// Create base schema structure exactly matching SimpleSchema
		const schema = z.object({
			currentState: z.object({
				evaluationPreviousGoal: z
					.string()
					.describe(
						"Success|Failed|Unknown with explanation of previous goal status",
					),
				memory: z
					.string()
					.describe(
						"Description of what has been done and what needs to be remembered",
					),
				nextGoal: z.string().describe("What needs to be done next"),
			}),
			action: z.array(
				z.object({}), // Will be populated with action properties dynamically
			),
		});

		// Add action properties from custom_actions
		if (custom_actions) {
			// Create object shape for actions
			const actionProperties: Record<
				string,
				z.ZodOptional<z.ZodObject<any>>
			> = {};

			// Generate properties for each action
			for (const [actionName, paramModel] of Object.entries(custom_actions)) {
				// Make sure paramModel.paramModel is a Zod schema and convert to optional
				if (paramModel && paramModel.paramModel) {
					actionProperties[actionName] = paramModel.paramModel.optional();
				}
			}

			// Set the array item type to be an object with all possible action properties
			schema.shape.action = z.array(z.object(actionProperties));
		}
		return schema;
	}
}
/**
 * Agent action history item
 */
class AgentHistory {
	modelOutput: AgentOutput | null; // Model output
	result: ActionResult[]; // Result list
	state: BrowserStateHistory; // Browser state history
	metadata?: StepMetadata; // Step metadata

	constructor(
		modelOutput: AgentOutput | null,
		result: ActionResult[],
		state: BrowserStateHistory,
		metadata?: StepMetadata,
	) {
		this.modelOutput = modelOutput;
		this.result = result;
		this.state = state;
		this.metadata = metadata;
	}

	/**
	 * Get interacted elements
	 */
	static getInteractedElement(
		modelOutput: AgentOutput,
		selectorMap: SelectorMap,
	): (DOMHistoryElement | null)[] {
		const elements: (DOMHistoryElement | null)[] = [];
		for (const action of modelOutput.action) {
			const index = action.getIndex?.();
			if (index !== undefined && index !== null && index in selectorMap) {
				const el: DOMElementNode | undefined = selectorMap[index];
				if (el) {
					elements.push(
						HistoryTreeProcessor.convertDomElementToHistoryElement(el),
					);
				} else {
					elements.push(null);
				}
			} else {
				elements.push(null);
			}
		}
		return elements;
	}
}

/**
 * Agent history list
 */
class AgentHistoryList {
	history: AgentHistory[]; // History list

	constructor(history: AgentHistory[]) {
		this.history = history;
	}

	/**
	 * Get total duration in seconds for all steps
	 */
	totalDurationSeconds(): number {
		let total = 0.0;
		for (const h of this.history) {
			if (h.metadata) {
				total += h.metadata.durationSeconds;
			}
		}
		return total;
	}

	/**
	 * Get total token count used by all steps.
	 * Note: These are approximate token counts from the message manager.
	 * For accurate token counts, use tools like LangChain Smith or OpenAI's token counter.
	 */
	totalInputTokens(): number {
		let total = 0;
		for (const h of this.history) {
			if (h.metadata) {
				total += h.metadata.inputTokens;
			}
		}
		return total;
	}

	/**
	 * Get token usage for each step
	 */
	inputTokenUsage(): number[] {
		return this.history
			.filter((h) => h.metadata)
			.map((h) => h.metadata!.inputTokens);
	}

	toString(): string {
		return `AgentHistoryList(all_results=${this.actionResults()}, all_model_outputs=${this.modelActions()})`;
	}

	/**
	 * Save history to JSON file with proper serialization
	 */
	async saveToFile(filepath: string | typeof path): Promise<void> {
		try {
			// Note: Path handling would need to be implemented or use a file system library
			// This assumes a Node.js environment - browser would need different implementation
			const fs = require("fs");
			const path = require("path");

			const dir = path.dirname(filepath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			fs.writeFileSync(filepath, JSON.stringify(this, null, 2), "utf-8");
		} catch (e) {
			throw e;
		}
	}

	/**
	 * Load history from JSON file
	 */
	static async loadFromFile(
		filepath: string | typeof path,
		outputModel: AgentOutput,
	): Promise<AgentHistoryList> {
		// This assumes a Node.js environment
		const fs = require("fs");
		const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));

		// Loop through history and validate output_model actions to enrich with custom actions
		for (const h of data.history) {
			if (h.modelOutput) {
				if (typeof h.modelOutput === "object" && h.modelOutput !== null) {
					h.modelOutput = h.modelOutput as AgentOutput; // 直接断言
				} else {
					h.modelOutput = null;
				}
			}
			if (!("interactedElement" in h.state)) {
				h.state.interactedElement = null;
			}
		}

		// Assume there's a static method to validate the model
		return new AgentHistoryList(data.history as AgentHistory[]);
	}

	/**
	 * Last action in history
	 */
	lastAction(): Record<string, any> | null {
		const lastModelOutput = this.history[this.history.length - 1]?.modelOutput;
		return lastModelOutput
			? modelDump(
					lastModelOutput.action[lastModelOutput.action.length - 1],
					true,
				)
			: null;
	}

	/**
	 * Get all errors from history, with null for steps without errors
	 */
	errors(): (string | null)[] {
		const errors: (string | null)[] = [];
		for (const h of this.history) {
			const stepErrors = h.result.filter((r) => r.error).map((r) => r.error);

			// Each step can have only one error
			errors.push(stepErrors.length > 0 ? stepErrors[0]! : null);
		}
		return errors;
	}

	/**
	 * Final result from history
	 */
	finalResult(): string | null {
		const lastItem =
			this.history.length > 0
				? this.history[this.history.length - 1]
				: undefined;
		if (lastItem?.result && lastItem.result.length > 0) {
			const lastResult = lastItem.result[lastItem.result.length - 1];
			return lastResult?.extractedContent || null;
		}
		return null;
	}

	/**
	 * Check if the agent is done
	 */
	isDone(): boolean {
		const lastItem =
			this.history.length > 0
				? this.history[this.history.length - 1]
				: undefined;
		if (lastItem?.result && lastItem.result.length > 0) {
			const lastResult = lastItem.result[lastItem.result.length - 1];
			return lastResult?.isDone === true;
		}
		return false;
	}

	/**
	 * Check if the agent completed successfully - the agent decides in the last step if it was successful or not.
	 * Returns null if not done yet.
	 */
	isSuccessful(): boolean | null {
		const lastItem =
			this.history.length > 0
				? this.history[this.history.length - 1]
				: undefined;
		if (lastItem?.result && lastItem.result.length > 0) {
			const lastResult = lastItem.result[lastItem.result.length - 1];
			if (lastResult?.isDone === true) {
				return lastResult.success ?? null;
			}
		}
		return null;
	}

	/**
	 * Check if the agent has any non-null errors
	 */
	hasErrors(): boolean {
		return this.errors().some((error) => error !== null);
	}

	/**
	 * Get all unique URLs from history
	 */
	urls(): (string | null)[] {
		return this.history.map((h) => h.state.url || null);
	}

	/**
	 * Get all screenshots from history
	 */
	screenshots(): (string | null)[] {
		return this.history.map((h) => h.state.screenshot || null);
	}

	/**
	 * Get all action names from history
	 */
	actionNames(): string[] {
		const actionNames: string[] = [];
		for (const action of this.modelActions()) {
			const actions = Object.keys(action);
			if (actions.length) {
				actionNames.push(actions[0]!);
			}
		}
		return actionNames;
	}

	/**
	 * Get all thoughts from history
	 */
	modelThoughts(): AgentBrain[] {
		return this.history
			.filter((h) => h.modelOutput !== null)
			.map((h) => h.modelOutput!.currentState);
	}

	/**
	 * Get all model outputs from history
	 */
	modelOutputs(): AgentOutput[] {
		return this.history
			.filter((h) => h.modelOutput !== null)
			.map((h) => h.modelOutput!);
	}

	/**
	 * Get all actions from history
	 */
	modelActions(): Record<string, any>[] {
		const outputs: Record<string, any>[] = [];

		for (const h of this.history) {
			if (h.modelOutput) {
				for (let i = 0; i < h.modelOutput.action.length; i++) {
					const action = h.modelOutput.action[i];
					const interactedElement = h.state.interactedElement?.[i] || null;
					const output = modelDump(action!, true);
					output["interactedElement"] = interactedElement;
					outputs.push(output);
				}
			}
		}
		return outputs;
	}

	/**
	 * Get all results from history
	 */
	actionResults(): ActionResult[] {
		const results: ActionResult[] = [];
		for (const h of this.history) {
			results.push(...h.result.filter((r) => r));
		}
		return results;
	}

	/**
	 * Get all extracted content from history
	 */
	extractedContent(): string[] {
		const content: string[] = [];
		for (const h of this.history) {
			content.push(
				...h.result
					.filter((r) => r.extractedContent)
					.map((r) => r.extractedContent!),
			);
		}
		return content;
	}

	/**
	 * Get all model actions from history as JSON
	 */
	modelActionsFiltered(include?: string[]): Record<string, any>[] {
		if (!include) {
			include = [];
		}
		const outputs = this.modelActions();
		const result: Record<string, any>[] = [];

		for (const o of outputs) {
			for (const i of include) {
				if (i === Object.keys(o)[0]) {
					result.push(o);
				}
			}
		}
		return result;
	}

	/**
	 * Get the number of steps in the history
	 */
	numberOfSteps(): number {
		return this.history.length;
	}

	// Additional method for model validation (placeholder)
	static modelValidate(data: any): AgentHistoryList {
		// Implementation would depend on your validation approach
		return new AgentHistoryList(data.history);
	}
}

/**
 * Container for agent error handling
 */
class AgentError {
	static readonly NO_VALID_ACTION: string = "No valid action found";

	static formatError(error: Error, includeTrace: boolean = false): string {
		const errorInfo = [
			`Error: ${error.name || "Unknown error"}`,
			`Message: ${error.message}`,
		];

		if (error.stack) {
			errorInfo.push(`Stacktrace:\n${error.stack}`);
		}

		// Include additional properties from the error object
		for (const [key, value] of Object.entries(error)) {
			if (
				key !== "name" &&
				key !== "message" &&
				key !== "stack" &&
				typeof value !== "function"
			) {
				errorInfo.push(`${key}: ${JSON.stringify(value)}`);
			}
		}

		return errorInfo.join("\n");
	}
}

// Export the types and classes
export {
	type ToolCallingMethod,
	AgentSettings,
	AgentState,
	AgentStepInfo,
	ActionResult,
	StepMetadata,
	type AgentBrain,
	AgentOutput,
	AgentHistory,
	AgentHistoryList,
	AgentError,
	HistoryTreeProcessor,
};
