import { exec } from "child_process";
import { existsSync, readFileSync } from "fs";
import path, { resolve } from "path";
import { inspect, promisify } from "util";
import { config } from "dotenv";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	BaseMessage,
	HumanMessage,
	SystemMessage,
} from "@langchain/core/messages";

import {
	ActionResult,
	AgentError,
	AgentHistory,
	AgentHistoryList,
	AgentOutput,
	AgentStepInfo,
	StepMetadata,
} from "./views";
import type { ToolCallingMethod } from "./views";
import { AgentSettings, AgentState } from "./views";

import { Browser } from "../browser/browser";
import { BrowserContext } from "../browser/context";
import { BrowserState, BrowserStateHistory } from "../browser/views";
import { ActionModel } from "../controller/registry/views";
import { Controller } from "../controller/service";
import { HistoryTreeProcessor } from "../dom/history_tree_processor/service";
import { DOMHistoryElement } from "../dom/history_tree_processor/view";
import { createHistoryGif } from "./gif";
import {
	MessageManager,
	MessageManagerSettings,
} from "./message_manager/service";
import {
	convertInputMessages,
	extractJsonFromModelOutput,
	saveConversation,
} from "./message_manager/utils";
import { MessageManagerState } from "./message_manager/views";
import { AgentMessagePrompt, PlannerPrompt, SystemPrompt } from "./prompt";

import { simplifyZodSchema } from "../bn_utils";
import bnLogger from "../logging_config";
import { timeExecution, timeExecutionAsync } from "../utils";

// Load environment variables
config();
const logger = bnLogger.child({
	label: "browser_node/agent/service",
});

function logResponse(response: AgentOutput): void {
	/**
	 * 记录模型响应的工具函数
	 */

	// 根据目标评估结果选择表情符号
	let emoji: string;
	if (response.currentState.evaluationPreviousGoal.includes("Success")) {
		emoji = "👍";
	} else if (response.currentState.evaluationPreviousGoal.includes("Failed")) {
		emoji = "⚠";
	} else {
		emoji = "🤷";
	}

	// 记录状态信息
	logger.info(`${emoji} Eval: ${response.currentState.evaluationPreviousGoal}`);
	logger.info(`🧠 Memory: ${response.currentState.memory}`);
	logger.info(`🎯 Next goal: ${response.currentState.nextGoal}`);

	for (let i = 0; i < response.action.length; i++) {
		logger.info(
			`🛠️ Action ${i + 1}/${response.action.length}: ${JSON.stringify(response.action[i], null, 2)}`,
		);
	}
}

const execAsync = promisify(exec);

type Context = any;

export class Agent<T = Context> {
	controller: Controller<T>;
	sensitiveData?: Record<string, string>;
	settings: AgentSettings;
	state: AgentState;
	ActionModel: any;
	AgentOutput: any;
	DoneActionModel: any;
	DoneAgentOutput: any;
	availableActions: string;
	toolCallingMethod?: ToolCallingMethod;
	private _messageManager: MessageManager;
	injectedBrowser: boolean;
	injectedBrowserContext: boolean;
	browser: Browser;
	browserContext: BrowserContext;
	registerNewStepCallback?: (
		state: BrowserState,
		output: AgentOutput,
		step: number,
	) => void | Promise<void>;
	registerDoneCallback?: (history: AgentHistoryList) => void | Promise<void>;
	registerExternalAgentStatusRaiseErrorCallback?: () => Promise<boolean>;
	context?: T;
	telemetry: any; // Replace with actual telemetry type
	initialActions?: any[];
	version?: string;
	source?: "git" | "pip" | "unknown";
	chatModelLibrary?: string;
	modelName?: string;
	plannerModelName?: string;

	constructor(
		public task: string,
		public llm: BaseChatModel,
		options: {
			browser?: Browser;
			browserContext?: BrowserContext;
			controller?: Controller<T>;
			sensitiveData?: Record<string, string>;
			initialActions?: any[];
			registerNewStepCallback?: (
				state: BrowserState,
				output: AgentOutput,
				step: number,
			) => void | Promise<void>;
			registerDoneCallback?: (
				history: AgentHistoryList,
			) => void | Promise<void>;
			registerExternalAgentStatusRaiseErrorCallback?: () => Promise<boolean>;
			useVision?: boolean;
			useVisionForPlanner?: boolean;
			saveConversationPath?: string;
			saveConversationPathEncoding?: string;
			maxFailures?: number;
			retryDelay?: number;
			overrideSystemMessage?: string;
			extendSystemMessage?: string;
			maxInputTokens?: number;
			validateOutput?: boolean;
			messageContext?: string;
			generateGif?: boolean | string;
			availableFilePaths?: string[];
			includeAttributes?: string[];
			maxActionsPerStep?: number;
			toolCallingMethod?: ToolCallingMethod;
			pageExtractionLLM?: BaseChatModel;
			plannerLLM?: BaseChatModel;
			plannerInterval?: number;
			injectedAgentState?: AgentState;
			context?: T;
			//
			chatModelLibrary?: string;
			modelName?: string;
			plannerModelName?: string;
			version?: string;
			source?: "git" | "pip" | "unknown";
		} = {},
	) {
		const startTime = Date.now(); // Measure constructor execution time

		const {
			browser,
			browserContext,
			controller = new Controller(),
			sensitiveData,
			initialActions,
			registerNewStepCallback,
			registerDoneCallback,
			registerExternalAgentStatusRaiseErrorCallback,
			useVision = true,
			useVisionForPlanner = false,
			saveConversationPath,
			saveConversationPathEncoding = "utf-8",
			maxFailures = 1,
			retryDelay = 10,
			overrideSystemMessage,
			extendSystemMessage,
			maxInputTokens = 128000,
			validateOutput = false,
			messageContext,
			generateGif = false,
			availableFilePaths,
			includeAttributes = [
				"title",
				"type",
				"name",
				"role",
				"aria-label",
				"placeholder",
				"value",
				"alt",
				"aria-expanded",
				"data-date-format",
			],
			maxActionsPerStep = 10,
			toolCallingMethod = "auto" as ToolCallingMethod,
			pageExtractionLLM,
			plannerLLM,
			plannerInterval = 1,
			injectedAgentState,
			context,
		} = options;

		const pageExtractionLLMFinal = pageExtractionLLM || llm;

		// Core components
		this.task = task;
		this.llm = llm;
		this.controller = controller;
		this.sensitiveData = sensitiveData;

		this.settings = new AgentSettings({
			useVision,
			useVisionForPlanner,
			saveConversationPath,
			saveConversationPathEncoding,
			maxFailures,
			retryDelay,
			overrideSystemMessage,
			extendSystemMessage,
			maxInputTokens,
			validateOutput,
			messageContext,
			generateGif,
			availableFilePaths,
			includeAttributes,
			maxActionsPerStep,
			toolCallingMethod,
			pageExtractionLLM: pageExtractionLLMFinal,
			plannerLLM,
			plannerInterval,
		});

		// Initialize state
		this.state = injectedAgentState || new AgentState();

		// Action setup
		this.setupActionModels();
		this.setBrowserUseVersionAndSource();
		this.initialActions = initialActions
			? this.convertInitialActions(initialActions)
			: undefined;

		// Model setup
		this.setModelNames();

		// For models without tool calling, add available actions to context
		this.availableActions = this.controller.registry.getPromptDescription();

		this.toolCallingMethod = this.setToolCallingMethod();
		this.settings.messageContext = this.setMessageContext();

		// Initialize message manager with state
		this._messageManager = new MessageManager({
			task,
			systemMessage: new SystemPrompt({
				actionDescription: this.availableActions,
				maxActionsPerStep: this.settings.maxActionsPerStep,
				overrideSystemMessage: this.settings.overrideSystemMessage ?? undefined,
				extendSystemMessage: this.settings.extendSystemMessage ?? undefined,
			}).getSystemMessage(),
			settings: {
				maxInputTokens: this.settings.maxInputTokens,
				includeAttributes: this.settings.includeAttributes,
				messageContext: this.settings.messageContext,
				sensitiveData,
				availableFilePaths: this.settings.availableFilePaths,
			} as MessageManagerSettings,
			state: this.state.messageManagerState,
		});

		// Browser setup
		this.injectedBrowser = browser !== undefined;
		this.injectedBrowserContext = browserContext !== undefined;
		if (browserContext) {
			this.browser = browser!;
			this.browserContext = browserContext;
		} else {
			this.browser = browser || new Browser();
			this.browserContext = new BrowserContext(
				this.browser,
				this.browser.config.newContextConfig,
			);
		}

		// Callbacks
		this.registerNewStepCallback = registerNewStepCallback;
		this.registerDoneCallback = registerDoneCallback;
		this.registerExternalAgentStatusRaiseErrorCallback =
			registerExternalAgentStatusRaiseErrorCallback;

		// Context
		this.context = context;

		// Telemetry
		this.telemetry = { capture: (event: any) => {} }; // Replace with actual implementation

		if (this.settings.saveConversationPath) {
			logger.info(
				`Saving conversation to ${this.settings.saveConversationPath}`,
			);
		}

		// At the end of the constructor
		const executionTime = (Date.now() - startTime) / 1000;
		logger.debug(
			`--constructor (agent) Execution time: ${executionTime.toFixed(2)} seconds`,
		);
	}

	private setMessageContext(): string | undefined {
		if (this.toolCallingMethod === "raw") {
			if (this.settings.messageContext) {
				return `${this.settings.messageContext}\n\nAvailable actions: ${this.availableActions}`;
			} else {
				return `Available actions: ${this.availableActions}`;
			}
		}
		return this.settings.messageContext ?? undefined;
	}

	/**
	 * Get the version and source of the browser-use package (git or pip in a nutshell)
	 */
	private setBrowserUseVersionAndSource(): void {
		try {
			// First check for repository-specific files
			const repo_files = [".git", "README.md", "docs", "examples"];
			const packageRoot = resolve(__dirname, "..", "..");

			// If all of these files/dirs exist, it's likely from git
			if (repo_files.every((file) => existsSync(resolve(packageRoot, file)))) {
				try {
					execAsync("git describe --tags")
						.then(({ stdout }) => {
							this.version = stdout.trim();
						})
						.catch(() => {
							this.version = "unknown";
						});
					this.source = "git";
				} catch (error) {
					this.version = "unknown";
					this.source = "git";
				}
			} else {
				// If no repo files found, try getting version from package.json
				try {
					const packageJson = JSON.parse(
						readFileSync(resolve(packageRoot, "package.json"), "utf8"),
					);
					this.version = packageJson.version;
					this.source = "pip";
				} catch (error) {
					this.version = "unknown";
					this.source = "unknown";
				}
			}
		} catch (error) {
			this.version = "unknown";
			this.source = "unknown";
		}
	}

	private setModelNames(): void {
		this.chatModelLibrary = this.llm.constructor.name;
		this.modelName = "Unknown";

		if ("modelName" in this.llm && this.llm.modelName !== undefined) {
			this.modelName = this.llm.modelName as string;
		} else if ("model" in this.llm && this.llm.model !== undefined) {
			this.modelName = this.llm.model as string;
		}

		if (this.settings.plannerLLM) {
			if (
				"modelName" in this.settings.plannerLLM &&
				this.settings.plannerLLM.modelName !== undefined
			) {
				this.plannerModelName = this.settings.plannerLLM.modelName as string;
			} else if (
				"model" in this.settings.plannerLLM &&
				this.settings.plannerLLM.model !== undefined
			) {
				this.plannerModelName = this.settings.plannerLLM.model as string;
			} else {
				this.plannerModelName = "Unknown";
			}
		} else {
			this.plannerModelName = undefined;
		}
	}

	private setupActionModels(): void {
		this.ActionModel = this.controller.registry.createActionModel();
		this.AgentOutput = AgentOutput.typeWithCustomActions(this.ActionModel);
		// Used to force the done action when max_steps is reached
		this.DoneActionModel = this.controller.registry.createActionModel(["done"]);
		this.DoneAgentOutput = AgentOutput.typeWithCustomActions(
			this.DoneActionModel,
		);
	}

	private setToolCallingMethod(): ToolCallingMethod | undefined {
		const toolCallingMethod = this.settings.toolCallingMethod;
		if (toolCallingMethod === "auto") {
			if (
				this.modelName &&
				(this.modelName.includes("deepseek-reasoner") ||
					this.modelName.includes("deepseek-r1"))
			) {
				return "raw";
			} else if (this.chatModelLibrary === "ChatGoogleGenerativeAI") {
				return undefined;
			} else if (this.chatModelLibrary === "ChatOpenAI") {
				return "functionCalling";
			} else if (this.chatModelLibrary === "AzureChatOpenAI") {
				return "functionCalling";
			} else {
				return undefined;
			}
		} else {
			return toolCallingMethod ?? undefined;
		}
	}

	public addNewTask(new_task: string): void {
		this._messageManager.addNewTask(new_task);
	}

	private async raiseIfStoppedOrPaused(): Promise<void> {
		if (this.registerExternalAgentStatusRaiseErrorCallback) {
			if (await this.registerExternalAgentStatusRaiseErrorCallback()) {
				throw new Error("Interrupted");
			}
		}

		if (this.state.stopped || this.state.paused) {
			logger.debug("Agent paused after getting state");
			throw new Error("Interrupted");
		}
	}

	@timeExecution("--step (agent)")
	public async step(stepInfo?: AgentStepInfo): Promise<void> {
		logger.info(`📍 Step ${this.state.nSteps}`);
		let state: BrowserState | null = null; // clear state
		let modelOutput: AgentOutput | null = null; // clear model output
		let result: ActionResult[] = []; // clear result
		const stepStartTime = Date.now(); // clear step start time
		let tokens = 0; // clear tokens

		try {
			state = await this.browserContext.getState();
			await this.raiseIfStoppedOrPaused();
			this._messageManager.addStateMessage(
				state,
				this.state.lastResult ?? undefined,
				stepInfo,
				this.settings.useVision,
			);

			// Run planner at specified intervals if planner is configured
			if (
				this.settings.plannerLLM &&
				this.state.nSteps % this.settings.plannerInterval === 0
			) {
				const plan = await this.runPlanner();
				if (plan) {
					// Add plan before last state message
					this._messageManager.addPlan(plan, -1);
				}
			}

			if (stepInfo && stepInfo.isLastStep()) {
				// Add last step warning if needed
				let msg =
					'Now comes your last step. Use only the "done" action now. No other actions - so here your action sequence must have length 1.';
				msg +=
					'\nIf the task is not yet fully finished as requested by the user, set success in "done" to false! E.g. if not all steps are fully completed.';
				msg +=
					'\nIf the task is fully finished, set success in "done" to true.';
				msg +=
					"\nInclude everything you found out for the ultimate task in the done text.";
				logger.info("Last step finishing up");
				this._messageManager.addMessageWithTokens(
					new HumanMessage({ content: msg }),
				);
				this.AgentOutput = this.DoneAgentOutput;
			}

			const inputMessages = this._messageManager.getMessages();
			tokens = this._messageManager.state.history.currentTokens;

			try {
				modelOutput = await this.getNextAction(inputMessages);
				this.state.nSteps += 1;

				if (this.registerNewStepCallback) {
					const callback = this.registerNewStepCallback;
					if (callback.constructor.name === "AsyncFunction") {
						await callback(state, modelOutput, this.state.nSteps);
					} else {
						callback(state, modelOutput, this.state.nSteps);
					}
				}

				if (this.settings.saveConversationPath) {
					const target = `${this.settings.saveConversationPath}_${this.state.nSteps}.txt`;
					saveConversation(
						inputMessages,
						modelOutput,
						target,
						this.settings.saveConversationPathEncoding as BufferEncoding,
					);
				}

				this._messageManager.removeLastStateMessage(); // We don't want the whole state in the chat history

				await this.raiseIfStoppedOrPaused();

				this._messageManager.addModelOutput(modelOutput);
			} catch (e) {
				// Model call failed, remove last state message from history
				this._messageManager.removeLastStateMessage();
				throw e;
			}
			result = await this.multiAct(modelOutput.action);
			this.state.lastResult = result;

			if (result.length > 0 && result[result.length - 1]?.isDone) {
				logger.info(
					`📄 Result: ${result[result.length - 1]?.extractedContent}`,
				);
			}

			this.state.consecutiveFailures = 0;
		} catch (e) {
			if (e instanceof Error && e.message === "Interrupted") {
				logger.debug("Agent paused");
				this.state.lastResult = [
					{
						error:
							"The agent was paused - now continuing actions might need to be repeated",
						includeInMemory: true,
					} as ActionResult,
				];
				return;
			} else {
				result = await this.handleStepError(e as Error);
				this.state.lastResult = result;
			}
		} finally {
			const stepEndTime = Date.now();
			const actions = modelOutput
				? modelOutput.action.map((a) => {
						// Simulating model_dump(exclude_unset=True) behavior
						const cleanedAction: Record<string, any> = {};
						for (const [key, value] of Object.entries(a)) {
							if (value !== undefined) {
								cleanedAction[key] = value;
							}
						}
						return cleanedAction;
					})
				: [];

			this.telemetry.capture({
				type: "AgentStepTelemetryEvent",
				agentId: this.state.agentId,
				step: this.state.nSteps,
				actions,
				consecutiveFailures: this.state.consecutiveFailures,
				stepError: result.length
					? result.map((r) => r.error).filter(Boolean)
					: ["No result"],
			});

			if (!result.length) {
				return;
			}

			if (state) {
				const metadata: StepMetadata = {
					stepNumber: this.state.nSteps,
					stepStartTime,
					stepEndTime,
					inputTokens: tokens,
					durationSeconds: (stepEndTime - stepStartTime) / 1000,
				};
				this.makeHistoryItem(modelOutput, state, result, metadata);
			}
		}
	}

	@timeExecution("--handleStepError(agent)")
	private async handleStepError(error: Error): Promise<ActionResult[]> {
		const includeTrace = logger.level === "debug";
		const errorMsg = AgentError.formatError(error, includeTrace);
		const prefix = `❌ Result failed ${this.state.consecutiveFailures + 1}/${this.settings.maxFailures} times:`;

		if (
			error instanceof Error &&
			(error.name === "ValidationError" ||
				error.name === "ValueError" ||
				error.message.includes("validation failed"))
		) {
			logger.error(`${prefix}`, error);
			if (errorMsg.includes("Max token limit reached")) {
				// Cut tokens from history
				this._messageManager.settings.maxInputTokens =
					this.settings.maxInputTokens - 500;
				logger.info(
					`Cutting tokens from history - new max input tokens: ${this._messageManager.settings.maxInputTokens}`,
				);
				this._messageManager.cutMessages();
			} else if (errorMsg.includes("Could not parse response")) {
				// Give model a hint how output should look like
				const enhancedErrorMsg =
					errorMsg + "\n\nReturn a valid JSON object with the required fields.";
				return [
					{ error: enhancedErrorMsg, includeInMemory: true } as ActionResult,
				];
			}

			this.state.consecutiveFailures += 1;
		} else {
			// Handle rate limit errors - assuming they follow similar patterns to Python
			if (
				error.message.includes("RateLimit") ||
				error.message.includes("ResourceExhausted")
			) {
				logger.warn(`${prefix}`, error);
				await new Promise((resolve) =>
					setTimeout(resolve, this.settings.retryDelay * 1000),
				);
				this.state.consecutiveFailures += 1;
			} else {
				logger.error(`${prefix}`, error);
				this.state.consecutiveFailures += 1;
			}
		}

		return [{ error: errorMsg, includeInMemory: true } as ActionResult];
	}

	private makeHistoryItem(
		modelOutput: AgentOutput | null,
		state: BrowserState,
		result: ActionResult[],
		metadata?: StepMetadata,
	): void {
		let interactedElements;

		if (modelOutput) {
			interactedElements = AgentHistory.getInteractedElement(
				modelOutput,
				state.selectorMap,
			);
		} else {
			interactedElements = [null];
		}

		const stateHistory = new BrowserStateHistory(
			state.url,
			state.title,
			state.tabs,
			interactedElements,
			state.screenshot,
		);

		const historyItem = {
			modelOutput,
			result,
			state: stateHistory,
			metadata,
		} as AgentHistory;

		this.state.history.history.push(historyItem);
	}

	private removeThinkTags(text: string): string {
		// Step 1: Remove well-formed <think>...</think>
		text = text.replace(/<think>[\s\S]*?<\/think>/g, "");
		// Step 2: If there's an unmatched closing tag </think>,
		//         remove everything up to and including that.
		text = text.replace(/[\s\S]*?<\/think>/g, "");
		return text.trim();
	}

	private convertInputMessages(inputMessages: BaseMessage[]): BaseMessage[] {
		if (
			this.modelName &&
			(this.modelName.includes("deepseek-reasoner") ||
				this.modelName.includes("deepseek-r1"))
		) {
			return convertInputMessages(inputMessages, this.modelName);
		} else {
			return inputMessages;
		}
	}

	@timeExecution("--getNextAction(agent)")
	public async getNextAction(
		inputMessages: BaseMessage[],
	): Promise<AgentOutput> {
		inputMessages = this.convertInputMessages(inputMessages);

		if (this.toolCallingMethod === "raw") {
			const output = await this.llm.invoke(inputMessages);
			// Clean up think tags if present
			const cleanedContent = this.removeThinkTags(String(output.content));
			output.content = cleanedContent;

			try {
				const parsed_json = extractJsonFromModelOutput(String(output.content));
				return new this.AgentOutput(
					parsed_json.currentState,
					parsed_json.action,
				);
			} catch (e) {
				logger.warn("Failed to parse model output", e);
				throw new Error("Could not parse response.");
			}
		} else if (this.toolCallingMethod === null) {
			const structuredLLM = this.llm.withStructuredOutput(this.AgentOutput, {
				includeRaw: true,
			});
			const response = await structuredLLM.invoke(inputMessages);
			const parsed = response.parsed as AgentOutput;

			if (!parsed) {
				throw new Error("Could not parse response.");
			}

			return parsed;
		} else {
			const agentOutputSchema = this.AgentOutput.schemaWithCustomActions(
				this.ActionModel,
			);

			const structuredLLM = this.llm.withStructuredOutput(agentOutputSchema, {
				includeRaw: true,
				method: this.toolCallingMethod,
			});

			// Then get the structured response
			const response = await structuredLLM.invoke(inputMessages);
			logger.debug("---getNextAction response---:", response);
			if (
				!response ||
				typeof response !== "object" ||
				!("parsed" in response) ||
				!("raw" in response)
			) {
				throw new Error("Failed to get LLM Response");
			}

			let parsedJson;
			if (response.parsed && response.parsed.action) {
				parsedJson = response.parsed;
			}
			// Fix for when tool_calls exist but parsed is null
			if (
				!response.parsed &&
				response.raw &&
				response.raw.additional_kwargs &&
				response.raw.additional_kwargs.tool_calls &&
				response.raw.additional_kwargs.tool_calls.length > 0
			) {
				const toolCall = response.raw.additional_kwargs.tool_calls[0];
				if (toolCall && toolCall.function && toolCall.function.arguments) {
					try {
						const removeEscapeCharactersParsedJson =
							toolCall.function.arguments.replace(/\\(.)/g, "$1");
						parsedJson = JSON.parse(removeEscapeCharactersParsedJson);
					} catch (e) {
						logger.warn("Failed to parse tool call arguments as JSON", e);
					}
				}
			}
			if (!parsedJson && response.raw.content) {
				parsedJson = extractJsonFromModelOutput(String(response.raw.content));
			}
			if (!parsedJson) {
				throw new Error("Failed to parse LLM Response to tool call arguments");
			}
			const parsedAgentOutput = new this.AgentOutput(
				parsedJson.currentState,
				parsedJson.action,
			);
			logResponse(parsedAgentOutput);
			return parsedAgentOutput;
		}
	}
	/**
	 * Log the agent run
	 */
	private logAgentRun(): void {
		logger.info(`🚀 Starting task: ${this.task}`);
		logger.debug(`Version: ${this.version}, Source: ${this.source}`);
	}

	/**
	 * Take a step
	 * @returns [boolean, boolean]:[isDone, isValid]
	 */
	public async takeStep(): Promise<[boolean, boolean]> {
		await this.step();

		if (this.state.history.isDone()) {
			if (this.settings.validateOutput) {
				if (!(await this.validateOutput())) {
					return [true, false];
				}
			}

			await this.logCompletion();
			if (this.registerDoneCallback) {
				const callback = this.registerDoneCallback;
				if (callback.constructor.name === "AsyncFunction") {
					await callback(this.state.history);
				} else {
					callback(this.state.history);
				}
			}
			return [true, true];
		}

		return [false, false];
	}

	@timeExecution("--run(agent)")
	async run(maxSteps: number = 100): Promise<AgentHistoryList> {
		try {
			this.logAgentRun();

			// Execute initial actions if provided
			if (this.initialActions) {
				const result = await this.multiAct(this.initialActions, false);
				this.state.lastResult = result;
			}

			for (let step = 0; step < maxSteps; step++) {
				// Check if we should stop due to too many failures
				if (this.state.consecutiveFailures >= this.settings.maxFailures) {
					logger.error(
						`❌ Stopping due to ${this.settings.maxFailures} consecutive failures`,
					);
					break;
				}

				// Check control flags before each step
				if (this.state.stopped) {
					logger.info("Agent stopped");
					break;
				}

				while (this.state.paused) {
					await new Promise((resolve) => setTimeout(resolve, 200)); // Small delay to prevent CPU spinning
					if (this.state.stopped) {
						// Allow stopping while paused
						break;
					}
				}
				const stepInfo = new AgentStepInfo(step, maxSteps);
				await this.step(stepInfo);
				if (this.state.history.isDone()) {
					if (this.settings.validateOutput && step < maxSteps - 1) {
						if (!(await this.validateOutput())) {
							continue;
						}
					}

					await this.logCompletion();
					break;
				}
			}

			// If loop completes without breaking
			if (!this.state.history.isDone()) {
				console.info("❌ Failed to complete task in maximum steps");
			}
			return this.state.history;
		} finally {
			this.telemetry.capture({
				agentId: this.state.agentId,
				isDone: this.state.history.isDone(),
				success: this.state.history.isSuccessful(),
				steps: this.state.nSteps,
				maxStepsReached: this.state.nSteps >= maxSteps,
				errors: this.state.history.errors(),
				totalInputTokens: this.state.history.totalInputTokens(),
				totalDurationSeconds: this.state.history.totalDurationSeconds(),
			});

			await this.close();

			if (this.settings.generateGif) {
				let outputPath = "agent_history.gif";
				if (typeof this.settings.generateGif === "string") {
					outputPath = this.settings.generateGif;
				}

				createHistoryGif(this.task, this.state.history, {
					outputPath,
				});
			}
		}
	}

	@timeExecution("--multiAct(agent)")
	async multiAct(
		actions: ActionModel[],
		checkForNewElements: boolean = true,
	): Promise<ActionResult[]> {
		const results: ActionResult[] = [];
		const cachedSelectorMap = await this.browserContext.getSelectorMap();
		const cachedPathHashes = new Set(
			Array.from(Object.values(cachedSelectorMap)).map(
				(e) => e.hash.branchPathHash,
			),
		);

		await this.browserContext.removeHighlights();
		for (let i = 0; i < actions.length; i++) {
			const action = actions[i]!;
			if (action.getIndex() !== null && i !== 0) {
				const newState = await this.browserContext.getState();
				const newPathHashes = new Set(
					Array.from(Object.values(newState.selectorMap)).map(
						(e) => e.hash.branchPathHash,
					),
				);

				if (checkForNewElements && !isSubset(newPathHashes, cachedPathHashes)) {
					// next action requires index but there are new elements on the page
					const msg = `Something new appeared after action ${i} / ${actions.length}`;
					logger.info(msg);
					results.push({ extractedContent: msg, includeInMemory: true });
					break;
				}
			}

			await this.raiseIfStoppedOrPaused();

			const result = await this.controller.act(
				action,
				this.browserContext,
				this.settings.pageExtractionLLM,
				this.sensitiveData,
				this.settings.availableFilePaths,
				{ context: this.context },
			);

			results.push(result);
			if (
				results[results.length - 1]?.isDone ||
				results[results.length - 1]?.error ||
				i === actions.length - 1
			) {
				break;
			}

			await new Promise((resolve) =>
				setTimeout(resolve, this.browserContext.config.waitBetweenActions),
			);
		}

		return results;
	}

	async validateOutput(): Promise<boolean> {
		const systemMsg =
			`You are a validator of an agent who interacts with a browser. ` +
			`Validate if the output of last action is what the user wanted and if the task is completed. ` +
			`If the task is unclear defined, you can let it pass. But if something is missing or the image does not show what was requested dont let it pass. ` +
			`Try to understand the page and help the model with suggestions like scroll, do x, ... to get the solution right. ` +
			`Task to validate: ${this.task}. Return a JSON object with 2 keys: is_valid and reason. ` +
			`is_valid is a boolean that indicates if the output is correct. ` +
			`reason is a string that explains why it is valid or not.` +
			` example: {"is_valid": false, "reason": "The user wanted to search for "cat photos", but the agent searched for "dog photos" instead."}`;
		let msg: BaseMessage[] = [];
		if (this.browserContext.session) {
			const state = await this.browserContext.getState();
			const content = new AgentMessagePrompt(
				state,
				this.state.lastResult,
				this.settings.includeAttributes,
			);

			msg = [
				new SystemMessage({ content: systemMsg }),
				content.getUserMessage(this.settings.useVision),
			];
		} else {
			// if no browser session, we can't validate the output
			return true;
		}
		/**
		 * Validation results.
		 */
		interface ValidationResult {
			isValid: boolean;
			reason: string;
		}

		const validator = this.llm.withStructuredOutput<ValidationResult>(
			{
				isValid: { type: "boolean" },
				reason: { type: "string" },
			},
			{ includeRaw: true },
		);

		const response = await validator.invoke(msg);
		const parsed: ValidationResult = response.parsed;

		const isValid = parsed.isValid;
		if (!isValid) {
			logger.info(`❌ Validator decision: ${parsed.reason}`);
			const msg = `The output is not yet correct. ${parsed.reason}.`;
			this.state.lastResult = [
				{ extractedContent: msg, includeInMemory: true },
			];
		} else {
			logger.info(`✅ Validator decision: ${parsed.reason}`);
		}

		return isValid;
	}

	async logCompletion(): Promise<void> {
		logger.info("✅ Task completed");
		if (this.state.history.isSuccessful()) {
			logger.info("✅ Successfully");
		} else {
			logger.info("❌ Unfinished");
		}

		if (this.registerDoneCallback) {
			if (isAsyncFunction(this.registerDoneCallback)) {
				await this.registerDoneCallback(this.state.history);
			} else {
				this.registerDoneCallback(this.state.history);
			}
		}
	}

	async rerunHistory(
		history: AgentHistoryList,
		maxRetries: number = 1,
		skipFailures: boolean = true,
		delayBetweenActions: number = 2.0,
	): Promise<ActionResult[]> {
		// Execute initial actions if provided
		if (this.initialActions) {
			const result = await this.multiAct(this.initialActions);
			this.state.lastResult = result;
		}

		const results: ActionResult[] = [];

		for (let i = 0; i < history.history.length; i++) {
			const historyItem = history.history[i]!;
			const goal = historyItem.modelOutput?.currentState.nextGoal || "";
			logger.info(
				`Replaying step ${i + 1}/${history.history.length}: goal: ${goal}`,
			);

			if (
				!historyItem.modelOutput ||
				!historyItem.modelOutput.action ||
				historyItem.modelOutput.action[0] === null
			) {
				logger.warn(`Step ${i + 1}: No action to replay, skipping`);
				results.push(new ActionResult({ error: "No action to replay" }));
				continue;
			}

			let retryCount = 0;
			while (retryCount < maxRetries) {
				try {
					const result = await this.executeHistoryStep(
						historyItem,
						delayBetweenActions,
					);
					results.push(...result);
					break;
				} catch (e: any) {
					retryCount++;
					if (retryCount === maxRetries) {
						const errorMsg = `Step ${i + 1} failed after ${maxRetries} attempts: ${e.toString()}`;
						logger.error(errorMsg);
						if (!skipFailures) {
							results.push(new ActionResult({ error: errorMsg }));
							throw new Error(errorMsg);
						}
					} else {
						logger.warn(
							`Step ${i + 1} failed (attempt ${retryCount}/${maxRetries}), retrying...`,
						);
						await new Promise((resolve) =>
							setTimeout(resolve, delayBetweenActions * 1000),
						);
					}
				}
			}
		}

		return results;
	}

	private async executeHistoryStep(
		historyItem: AgentHistory,
		delay: number,
	): Promise<ActionResult[]> {
		const state = await this.browserContext.getState();
		if (!state || !historyItem.modelOutput) {
			throw new Error("Invalid state or model output");
		}

		const updatedActions: (ActionModel | null)[] = [];
		for (let i = 0; i < historyItem.modelOutput.action.length; i++) {
			const updatedAction = await this.updateActionIndices(
				historyItem.modelOutput.action[i]!,
				state,
				historyItem.state.interactedElement[i],
			);
			updatedActions.push(updatedAction);

			if (updatedAction === null) {
				throw new Error(`Could not find matching element ${i} in current page`);
			}
		}

		// Filter out null values and cast
		const actions = updatedActions.filter((a): a is ActionModel => a !== null);
		const result = await this.multiAct(actions);

		await new Promise((resolve) => setTimeout(resolve, delay * 1000));
		return result;
	}

	async updateActionIndices(
		action: ActionModel,
		currentState: BrowserState,
		historicalElement?: DOMHistoryElement | null,
	): Promise<ActionModel | null> {
		if (!historicalElement || !currentState.elementTree) {
			return action;
		}

		const currentElement = HistoryTreeProcessor.findHistoryElementInTree(
			historicalElement,
			currentState.elementTree,
		);

		if (!currentElement || currentElement.highlightIndex === null) {
			return null;
		}

		const oldIndex = action.getIndex();
		if (oldIndex !== currentElement.highlightIndex) {
			action.setIndex(currentElement.highlightIndex);
			logger.info(
				`Element moved in DOM, updated index from ${oldIndex} to ${currentElement.highlightIndex}`,
			);
		}

		return action;
	}

	async loadAndRerun(
		historyFile?: string | typeof path,
		options: any = {},
	): Promise<ActionResult[]> {
		if (!historyFile) {
			historyFile = "AgentHistory.json";
		}

		const history = await AgentHistoryList.loadFromFile(
			historyFile,
			this.AgentOutput,
		);
		return await this.rerunHistory(history, options);
	}
	/**
	 * Save the history to a file
	 * @param filePath - The path to the file to save the history to
	 */
	saveHistory(filePath?: string | typeof path): void {
		if (!filePath) {
			filePath = "AgentHistory.json";
		}
		this.state.history.saveToFile(filePath);
	}
	/**
	 * Pause the agent before the next step
	 */
	pause(): void {
		logger.info("🔄 pausing Agent ");
		this.state.paused = true;
	}
	/**
	 * Resume the agent
	 */
	resume(): void {
		logger.info("▶️ Agent resuming");
		this.state.paused = false;
	}
	/**
	 * Stop the agent
	 */
	stop(): void {
		logger.info("⏹️ Agent stopping");
		this.state.stopped = true;
	}
	/**
	 * Convert dictionary-based actions to ActionModel instances
	 * @param actions - The initial actions to convert
	 * @returns The converted actions
	 */
	convertInitialActions(
		actions: Record<string, Record<string, any>>[],
	): ActionModel[] {
		const convertedActions: ActionModel[] = [];

		for (const actionDict of actions) {
			// Each action_dict should have a single key-value pair
			const actionName = Object.keys(actionDict)[0];
			if (!actionName) continue;

			const params = actionDict[actionName];
			if (!params) continue;

			// Get the parameter model for this action from registry
			const actionInfo =
				this.controller.registry.registry.actions.get(actionName);
			if (!actionInfo) continue;

			const paramModel = actionInfo.paramModel;

			// Create validated parameters using the appropriate param model
			const validatedParams = params;

			// Create ActionModel instance with the validated parameters
			const actionModel = new this.ActionModel({
				[actionName]: validatedParams,
			});
			convertedActions.push(actionModel);
		}

		return convertedActions;
	}

	async runPlanner(): Promise<string | null> {
		// Skip planning if no planner_llm is set
		if (!this.settings.plannerLLM) {
			return null;
		}

		// Create planner message history using full message history
		const allMessages = this._messageManager.getMessages();
		const plannerMessages = [
			new PlannerPrompt({
				actionDescription: this.controller.registry.getPromptDescription(),
				maxActionsPerStep: 10,
			}).getSystemMessage(),
			...allMessages.slice(1), // Use full message history except the first
		];

		if (!this.settings.useVisionForPlanner && this.settings.useVision) {
			const lastStateMessage: HumanMessage =
				plannerMessages[plannerMessages.length - 1]!;
			// remove image from last state message
			let newMsg = "";

			if (Array.isArray(lastStateMessage.content)) {
				for (const msg of lastStateMessage.content) {
					if (msg.type === "text") {
						newMsg += msg.text;
					}
					// Skip image_url types
				}
			} else {
				newMsg = lastStateMessage.content;
			}

			plannerMessages[plannerMessages.length - 1] = new HumanMessage({
				content: newMsg,
			});
		}

		const convertedMessages = convertInputMessages(
			plannerMessages,
			this.plannerModelName,
		);

		// Get planner output
		const response = await this.settings.plannerLLM.invoke(convertedMessages);
		let plan = String(response.content);

		// if deepseek-reasoner, remove think tags
		if (
			this.plannerModelName &&
			(this.plannerModelName.includes("deepseek-r1") ||
				this.plannerModelName.includes("deepseek-reasoner"))
		) {
			plan = this.removeThinkTags(plan);
		}

		try {
			const planJson = JSON.parse(plan);
			logger.info(`Planning Analysis:\n${JSON.stringify(planJson, null, 4)}`);
		} catch (e) {
			if (e instanceof SyntaxError) {
				logger.info(`Planning Analysis:\n${plan}`);
			} else {
				logger.debug(`Error parsing planning analysis: ${e}`);
				logger.info(`Plan: ${plan}`);
			}
		}

		return plan;
	}

	get messageManager(): MessageManager {
		return this._messageManager;
	}

	async cleanupHttpxClients(): Promise<void> {
		logger.debug("Cleanup HTTP clients completed");
	}

	async close(): Promise<void> {
		try {
			// First close browser resources
			if (this.browserContext && !this.injectedBrowserContext) {
				await this.browserContext.close();
			}

			if (this.browser && !this.injectedBrowser) {
				await this.browser.close();
			}

			// Then cleanup HTTP clients
			await this.cleanupHttpxClients();
		} catch (e) {
			logger.error(`Error during cleanup: ${e}`);
		}
	}
}

// Helper function to check if one set is a subset of another
function isSubset<T>(subset: Set<T>, superset: Set<T>): boolean {
	for (const elem of subset) {
		if (!superset.has(elem)) {
			return false;
		}
	}
	return true;
}

// Helper function to check if a function is async
function isAsyncFunction(fn: Function): boolean {
	return fn.constructor.name === "AsyncFunction";
}
