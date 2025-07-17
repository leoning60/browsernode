import RateLimitError from "openai";
import { v4 as uuid } from "uuid";
import { Logger } from "winston";
import { z } from "zod";

import fs from "fs";
import path from "path";
import type { BrowserStateHistory } from "../browser/views";
import { ActionModel } from "../controller/registry/views";
import { HistoryTreeProcessor } from "../dom/history_tree_processor/service";
import { DOMHistoryElement } from "../dom/history_tree_processor/view";
import type { DOMElementNode } from "../dom/views";

import { zodToJsonSchema } from "zod-to-json-schema";
import { modelDump } from "../bn_utils";
import type { SelectorMap } from "../dom/views";
import type { FileSystemState } from "../filesystem/file_system";
import type { BaseChatModel } from "../llm/base";
import bnLogger from "../logging_config";
import type { UsageSummary } from "../tokens/views";
import { MessageManagerState } from "./message_manager/views";

// Generic type for structured output, equivalent to Python's TypeVar('AgentStructuredOutput', bound=BaseModel)
type AgentStructuredOutput<
	T extends Record<string, any> = Record<string, any>,
> = T;

type ToolCallingMethod =
	| "functionCalling"
	| "jsonMode"
	| "jsonSchema"
	| "raw"
	| "auto";

// Configure Winston logger
const logger: Logger = bnLogger.child({
	module: "browsernode/agent/views",
});

/**
 * Configuration options for the Agent
 */
class AgentSettings {
	useVision: boolean = true;
	useVisionForPlanner: boolean = false;
	saveConversationPath?: string;
	saveConversationPathEncoding?: string = "utf-8";
	maxFailures: number = 1;
	retryDelay: number = 10;
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
	useThinking: boolean = true;
	maxHistoryItems: number = 40;

	pageExtractionLLM?: BaseChatModel;
	plannerLLM?: BaseChatModel;
	plannerInterval: number = 1; // Run planner every N steps
	isPlannerReasoning: boolean = false;
	extendPlannerSystemMessage?: string;
	calculateCost: boolean = false;

	// Legacy properties for backward compatibility
	// toolCallingMethod?: ToolCallingMethod = "auto";

	constructor(settings: Partial<AgentSettings> = {}) {
		Object.assign(this, settings);
	}
}

/**
 * Holds all state information for an Agent
 */
class AgentState {
	agentId: string;
	nSteps: number;
	consecutiveFailures: number;
	lastResult: ActionResult[] | null;
	history: AgentHistoryList;
	lastPlan: string | null;
	lastModelOutput: AgentOutput | null;
	paused: boolean;
	stopped: boolean;
	messageManagerState: MessageManagerState;
	fileSystemState: FileSystemState | null;

	constructor(
		params: {
			agentId?: string;
			nSteps?: number;
			consecutiveFailures?: number;
			lastResult?: ActionResult[] | null;
			history?: AgentHistoryList;
			lastPlan?: string | null;
			lastModelOutput?: AgentOutput | null;
			paused?: boolean;
			stopped?: boolean;
			messageManagerState?: MessageManagerState;
			fileSystemState?: any | null;
		} = {},
	) {
		this.agentId = params.agentId ?? uuid();
		this.nSteps = params.nSteps ?? 1;
		this.consecutiveFailures = params.consecutiveFailures ?? 0;
		this.lastResult = params.lastResult ?? null;
		this.history = params.history ?? new AgentHistoryList([], null);
		this.lastPlan = params.lastPlan ?? null;
		this.lastModelOutput = params.lastModelOutput ?? null;
		this.paused = params.paused ?? false;
		this.stopped = params.stopped ?? false;
		this.messageManagerState =
			params.messageManagerState ?? new MessageManagerState();
		this.fileSystemState = params.fileSystemState ?? null;
	}
}

class AgentStepInfo {
	stepNumber: number;
	maxSteps: number;

	constructor(stepNumber: number, maxSteps: number) {
		this.stepNumber = stepNumber;
		this.maxSteps = maxSteps;
	}

	/**
	 * Check if this is the last step
	 */
	isLastStep(): boolean {
		return this.stepNumber >= this.maxSteps - 1;
	}
}

/**
 * Result of executing an action
 */
class ActionResult {
	// For done action
	isDone?: boolean = false;
	success?: boolean | null = null;

	// Error handling - always include in long term memory
	error?: string | null = null;

	// Files
	attachments?: string[] | null = null; // Files to display in the done message

	// Always include in long term memory
	longTermMemory?: string | null = null; // Memory of this action

	// if updateOnlyReadState is True we add the extractedContent to the agent context only once for the next step
	// if updateOnlyReadState is False we add the extractedContent to the agent long term memory if no longTermMemory is provided
	extractedContent?: string | null = null;
	includeExtractedContentOnlyOnce?: boolean = false; // Whether the extracted content should be used to update the read_state

	// Deprecated
	includeInMemory: boolean = false; // whether to include in extractedContent inside longTermMemory

	constructor(
		params: {
			isDone?: boolean;
			success?: boolean | null;
			error?: string | null;
			attachments?: string[] | null;
			longTermMemory?: string | null;
			extractedContent?: string | null;
			includeExtractedContentOnlyOnce?: boolean;
			includeInMemory?: boolean;
		} = {},
	) {
		this.isDone = params.isDone ?? false;
		this.success = params.success ?? null;
		this.error = params.error ?? null;
		this.attachments = params.attachments ?? null;
		this.longTermMemory = params.longTermMemory ?? null;
		this.extractedContent = params.extractedContent ?? null;
		this.includeExtractedContentOnlyOnce =
			params.includeExtractedContentOnlyOnce ?? false;
		this.includeInMemory = params.includeInMemory ?? false;

		// Validate success requires done
		if (this.success === true && this.isDone !== true) {
			throw new Error(
				"success=true can only be set when isDone=true. " +
					"For regular actions that succeed, leave success as null. " +
					"Use success=false only for actions that fail.",
			);
		}
	}
}

/**
 * Metadata for a single step including timing and token information
 */
class StepMetadata {
	stepStartTime: number;
	stepEndTime: number;
	stepNumber: number;

	constructor(stepStartTime: number, stepEndTime: number, stepNumber: number) {
		this.stepStartTime = stepStartTime;
		this.stepEndTime = stepEndTime;
		this.stepNumber = stepNumber;
	}

	/**
	 * Calculate step duration in seconds
	 */
	get durationSeconds(): number {
		return this.stepEndTime - this.stepStartTime;
	}
}

class AgentBrain {
	thinking?: string | null = null;
	evaluationPreviousGoal: string;
	memory: string;
	nextGoal: string;

	constructor(
		evaluationPreviousGoal: string,
		memory: string,
		nextGoal: string,
		thinking?: string | null,
	) {
		this.thinking = thinking;
		this.evaluationPreviousGoal = evaluationPreviousGoal;
		this.memory = memory;
		this.nextGoal = nextGoal;
	}
}

// AgentBrain schema for validation
const AgentBrainSchema = z.object({
	thinking: z.string().optional().nullable(),
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
});

type AgentBrainType = z.infer<typeof AgentBrainSchema>;

class AgentOutput {
	thinking?: string | null = null;
	evaluationPreviousGoal: string;
	memory: string;
	nextGoal: string;
	action: ActionModel[]; // List of actions to execute

	constructor(
		evaluationPreviousGoal: string,
		memory: string,
		nextGoal: string,
		action: ActionModel[],
		thinking?: string | null,
	) {
		this.thinking = thinking;
		this.evaluationPreviousGoal = evaluationPreviousGoal;
		this.memory = memory;
		this.nextGoal = nextGoal;
		this.action = action;

		// Ensure at least one action is provided
		if (!action || action.length === 0) {
			throw new Error("At least one action must be provided");
		}
	}

	/**
	 * For backward compatibility - returns an AgentBrain with the flattened properties
	 */
	get currentState(): AgentBrain {
		return new AgentBrain(
			this.evaluationPreviousGoal,
			this.memory,
			this.nextGoal,
			this.thinking,
		);
	}

	/**
	 * Extend actions with custom actions
	 */
	static typeWithCustomActions(customActions: ActionModel): typeof AgentOutput {
		return class CustomAgentOutput extends AgentOutput {
			constructor(
				evaluationPreviousGoal: string,
				memory: string,
				nextGoal: string,
				action: ActionModel[],
				thinking?: string | null,
			) {
				super(evaluationPreviousGoal, memory, nextGoal, action, thinking);
				this.action =
					action.length > 0
						? action.map(() => {
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

				for (let i = 0; i < action.length; i++) {
					const llmAction = action[i];
					for (const key in llmAction) {
						if (this.action[i]!.hasOwnProperty(key)) {
							this.action[i]![key] = llmAction[key];
						} else {
							this.action[i]![key] = llmAction[key];
						}
					}

					for (const key in this.action[i]!) {
						if (action[i]!.hasOwnProperty(key)) {
							this.action[i]![key] = action[i]![key];
						} else {
							this.action[i]![key] = undefined;
						}
					}
				}
			}

			// Add static method to generate JSON schema for SchemaOptimizer
			static getJsonSchema(): Record<string, any> {
				const zodSchema = AgentOutput.schemaWithCustomActions(customActions);
				return zodToJsonSchema(zodSchema);
			}
		};
	}

	/**
	 * Extend actions with custom actions and exclude thinking field
	 */
	// TODO: complete this
	static typeWithCustomActionsNoThinking(
		customActions: ActionModel,
	): typeof AgentOutput {
		class AgentOutputNoThinking extends AgentOutput {
			static schemaWithoutThinking(customActions: ActionModel): any {
				const schema = AgentOutput.schemaWithCustomActions(customActions);
				if (schema && schema.shape && schema.shape.thinking) {
					delete schema.shape.thinking;
				}
				return schema;
			}
		}

		return class CustomAgentOutputNoThinking extends AgentOutputNoThinking {
			constructor(
				evaluationPreviousGoal: string,
				memory: string,
				nextGoal: string,
				outputAction: ActionModel[],
			) {
				super(evaluationPreviousGoal, memory, nextGoal, outputAction);
			}

			// Add static method to generate JSON schema for SchemaOptimizer
			static getJsonSchema(): Record<string, any> {
				const zodSchema =
					AgentOutputNoThinking.schemaWithoutThinking(customActions);
				return zodToJsonSchema(zodSchema);
			}
		};
	}

	static schemaWithCustomActions(customActions: ActionModel): any {
		// Create base schema structure with root description
		const schema = z
			.object({
				thinking: z.string().optional().nullable().default(null),
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
				action: z
					.array(
						z.object({}), // Will be populated with action union dynamically
					)
					.min(1)
					.describe("List of actions to execute"),
			})
			.describe("AgentOutput model with custom actions");

		// Add action properties from customActions
		if (customActions) {
			// Create individual action schemas as a union
			const actionSchemas: z.ZodObject<any, any>[] = [];

			// Generate individual schemas for each action
			for (const [actionName, paramModel] of Object.entries(customActions)) {
				if (paramModel && paramModel.paramModel) {
					// Create a schema for this specific action only
					const actionSchema = z.object({
						[actionName]: paramModel.paramModel,
					});
					actionSchemas.push(actionSchema);
				}
			}

			// Create a union of all possible action schemas
			if (actionSchemas.length > 0) {
				let actionUnion: z.ZodTypeAny;
				if (actionSchemas.length === 1) {
					const firstSchema = actionSchemas[0];
					if (firstSchema) {
						actionUnion = firstSchema;
					} else {
						throw new Error("First action schema is undefined");
					}
				} else {
					actionUnion = z.union(
						actionSchemas as [
							z.ZodObject<any, any>,
							z.ZodObject<any, any>,
							...z.ZodObject<any, any>[],
						],
					);
				}

				// Cast to bypass TypeScript's strict typing for schema.shape.action
				(schema as any).shape.action = z
					.array(actionUnion)
					.min(1)
					.describe(
						"Union of all available action models that maintains ActionModel interface",
					);
			}
		}
		return schema;
	}
}

/**
 * History item for agent actions
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

	/**
	 * Custom serialization handling circular references
	 */
	modelDump(excludeNone: boolean = true): Record<string, any> {
		// Handle action serialization
		let modelOutputDump: Record<string, any> | null = null;
		if (this.modelOutput) {
			const actionDump = this.modelOutput.action.map((action) =>
				modelDump(action, excludeNone),
			);
			modelOutputDump = {
				evaluationPreviousGoal: this.modelOutput.evaluationPreviousGoal,
				memory: this.modelOutput.memory,
				nextGoal: this.modelOutput.nextGoal,
				action: actionDump, // This preserves the actual action data
				thinking: this.modelOutput.thinking,
			};
		}

		const result = {
			modelOutput: modelOutputDump,
			result: this.result.map((r) => {
				const dump: Record<string, any> = {};
				for (const [key, value] of Object.entries(r)) {
					if (!excludeNone || (value !== null && value !== undefined)) {
						dump[key] = value;
					}
				}
				return dump;
			}),
			state: this.state, // Assuming state has its own serialization method
			metadata: this.metadata
				? {
						stepStartTime: this.metadata.stepStartTime,
						stepEndTime: this.metadata.stepEndTime,
						stepNumber: this.metadata.stepNumber,
					}
				: null,
		};

		return result;
	}
}

/**
 * List of AgentHistory messages, i.e. the history of the agent's actions and thoughts.
 */
class AgentHistoryList<
	T extends AgentStructuredOutput = AgentStructuredOutput,
> {
	history: AgentHistory[]; // History list
	usage: UsageSummary | null;

	_outputModelSchema?: new (
		...args: any[]
	) => T | null; // Type for structured output

	constructor(history: AgentHistory[], usage: UsageSummary | null = null) {
		this.history = history;
		this.usage = usage;
	}

	/**
	 * Get total duration of all steps in seconds
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
	 * Return the number of history items
	 */
	get length(): number {
		return this.history.length;
	}

	toString(): string {
		return `AgentHistoryList(allResults=${JSON.stringify(this.actionResults())}, allModelOutputs=${JSON.stringify(this.modelActions())})`;
	}

	/**
	 * Save history to JSON file with proper serialization
	 */
	async saveToFile(filepath: string): Promise<void> {
		try {
			const dir = path.dirname(filepath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			const data = this.modelDump();
			fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
		} catch (e) {
			throw e;
		}
	}

	/**
	 * Custom serialization that properly uses AgentHistory's modelDump
	 */
	modelDump(excludeNone: boolean = true): Record<string, any> {
		return {
			history: this.history.map((h) => h.modelDump(excludeNone)),
			usage: this.usage,
		};
	}

	/**
	 * Load history from JSON file
	 */
	static async loadFromFile(
		filepath: string,
		outputModel: typeof AgentOutput,
	): Promise<AgentHistoryList> {
		const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));

		// Loop through history and validate outputModel actions to enrich with custom actions
		for (const h of data.history) {
			if (h.modelOutput) {
				if (typeof h.modelOutput === "object" && h.modelOutput !== null) {
					// Convert back to AgentOutput instance
					h.modelOutput = new outputModel(
						h.modelOutput.evaluationPreviousGoal,
						h.modelOutput.memory,
						h.modelOutput.nextGoal,
						h.modelOutput.action,
						h.modelOutput.thinking,
					);
				} else {
					h.modelOutput = null;
				}
			}
			if (!("interactedElement" in h.state)) {
				h.state.interactedElement = null;
			}
		}

		return new AgentHistoryList(data.history as AgentHistory[], data.usage);
	}

	/**
	 * Last action in history
	 */
	lastAction(): Record<string, any> | null {
		if (
			this.history.length > 0 &&
			this.history[this.history.length - 1]?.modelOutput
		) {
			const lastModelOutput =
				this.history[this.history.length - 1]!.modelOutput!;
			const lastAction =
				lastModelOutput.action[lastModelOutput.action.length - 1];
			return modelDump(lastAction, true);
		}
		return null;
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
		if (
			this.history.length > 0 &&
			this.history[this.history.length - 1]?.result.length &&
			this.history[this.history.length - 1]!.result.length > 0
		) {
			const lastResult =
				this.history[this.history.length - 1]!.result[
					this.history[this.history.length - 1]!.result.length - 1
				];
			return lastResult?.extractedContent || null;
		}
		return null;
	}

	/**
	 * Check if the agent is done
	 */
	isDone(): boolean {
		if (
			this.history.length > 0 &&
			this.history[this.history.length - 1]?.result.length &&
			this.history[this.history.length - 1]!.result.length > 0
		) {
			const lastResult =
				this.history[this.history.length - 1]!.result[
					this.history[this.history.length - 1]!.result.length - 1
				];
			return lastResult?.isDone === true;
		}
		return false;
	}

	/**
	 * Check if the agent completed successfully - the agent decides in the last step if it was successful or not.
	 * Returns null if not done yet.
	 */
	isSuccessful(): boolean | null {
		if (
			this.history.length > 0 &&
			this.history[this.history.length - 1]?.result.length &&
			this.history[this.history.length - 1]!.result.length > 0
		) {
			const lastResult =
				this.history[this.history.length - 1]!.result[
					this.history[this.history.length - 1]!.result.length - 1
				];
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

	/**
	 * Get the structured output from the history
	 *
	 * @returns
	 * Returns the structured output if both finalResult and _outputModelSchema are available,
	 * otherwise null
	 */
	get structuredOutput(): AgentStructuredOutput | null {
		const finalResult = this.finalResult();
		if (finalResult !== null && this._outputModelSchema !== undefined) {
			try {
				return JSON.parse(finalResult) as AgentStructuredOutput;
			} catch {
				return null;
			}
		}
		return null;
	}
}

/**
 * Container for agent error handling
 */
class AgentError {
	static readonly VALIDATION_ERROR: string =
		"Invalid model output format. Please follow the correct schema.";
	static readonly RATE_LIMIT_ERROR: string =
		"Rate limit reached. Waiting before retry.";
	static readonly NO_VALID_ACTION: string = "No valid action found";

	/**
	 * Format error message based on error type and optionally include trace
	 */
	static formatError(error: Error, includeTrace: boolean = false): string {
		const message = "";

		// Check for validation errors (you might need to adapt this based on your validation library)
		if (
			error.name === "ValidationError" ||
			error.message.includes("validation")
		) {
			return `${AgentError.VALIDATION_ERROR}\nDetails: ${error.message}`;
		}

		// Check for rate limit errors
		if (error instanceof RateLimitError) {
			return AgentError.RATE_LIMIT_ERROR;
		}

		if (includeTrace && error.stack) {
			return `${error.message}\nStacktrace:\n${error.stack}`;
		}

		return error.message;
	}
}

// Export the types and classes
export {
	type AgentStructuredOutput,
	type ToolCallingMethod,
	AgentSettings,
	AgentState,
	AgentStepInfo,
	ActionResult,
	StepMetadata,
	AgentBrain,
	type AgentBrainType,
	AgentOutput,
	AgentHistory,
	AgentHistoryList,
	AgentError,
	HistoryTreeProcessor,
};
