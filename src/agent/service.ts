import { exec } from "child_process";
import { appendFileSync, existsSync, readFileSync } from "fs";
import os from "os";
import path, { resolve } from "path";
import { inspect, promisify } from "util";
import { config } from "dotenv";
import { v4 as uuidv4 } from "uuid";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EventBus } from "./eventbus_util";
// Load environment variables
config();
import {
	ActionResult,
	AgentBrain,
	AgentError,
	AgentHistory,
	AgentHistoryList,
	AgentOutput,
	AgentSettings,
	AgentState,
	AgentStepInfo,
	type AgentStructuredOutput,
	StepMetadata,
} from "./views";

import type { BaseChatModel } from "../llm/base";
import type { BaseMessage, UserMessage } from "../llm/messages";
import { TokenCost } from "../tokens/service";
import {
	CreateAgentOutputFileEvent,
	CreateAgentSessionEvent,
	CreateAgentStepEvent,
	CreateAgentTaskEvent,
	UpdateAgentTaskEvent,
} from "./cloud_events";

import type { ToolCallingMethod } from "./views";

import { BrowserProfile, BrowserSession } from "../browser";
import type { Browser, BrowserContext, Page } from "../browser/types";
import { BrowserStateHistory, BrowserStateSummary } from "../browser/views";
import { ActionModel } from "../controller/registry/views";
import { Controller } from "../controller/service";
import { HistoryTreeProcessor } from "../dom/history_tree_processor/service";
import { DOMHistoryElement } from "../dom/history_tree_processor/view";
import { MessageManager } from "./message_manager/service";
import { saveConversation } from "./message_manager/utils";
import { AgentMessagePrompt, PlannerPrompt, SystemPrompt } from "./prompts";

import { fileURLToPath } from "url";
import { modelDump } from "../bn_utils";
import { CONFIG } from "../config";
import { DEFAULT_INCLUDE_ATTRIBUTES } from "../dom/views";
import { LLMException } from "../exceptions";
import { FileSystem } from "../filesystem/file_system";
import bnLogger from "../logging_config";
import { CloudSync } from "../sync";
import { ProductTelemetry } from "../telemetry/service";
import { AgentTelemetryEvent } from "../telemetry/views";
import { SignalHandler, getBrowserNodeVersion, logPrettyPath } from "../utils";
import { timeExecution } from "../utils_old";
import { createHistoryGif } from "./gif";

const logger = bnLogger.child({
	label: "browsernode/agent/service",
});

// Type aliases for better readability
type AgentHookFunc<Context> = (agent: Agent<Context>) => Promise<void>;

/**
 * Utility function to log the model's response.
 */
function logResponse(
	response: AgentOutput,
	registry?: any,
	logger?: any,
): void {
	// Use module logger if no logger provided
	if (!logger) {
		logger = bnLogger.child({ label: "browsernode/agent/service" });
	}

	// Add null checks for response and currentState
	if (
		!response ||
		!response.currentState ||
		!response.currentState.evaluationPreviousGoal
	) {
		logger.warn("⚠️ Malformed response object, skipping response logging");
		return;
	}

	let emoji: string;
	if (
		response.currentState.evaluationPreviousGoal
			.toLowerCase()
			.includes("success")
	) {
		emoji = "👍";
	} else if (
		response.currentState.evaluationPreviousGoal
			.toLowerCase()
			.includes("failure")
	) {
		emoji = "⚠️";
	} else {
		emoji = "❔";
	}

	// Only log thinking if it's present
	if (response.currentState.thinking) {
		logger.info(`💡 Thinking:\n${response.currentState.thinking}`);
	}
	logger.info(`${emoji} Eval: ${response.currentState.evaluationPreviousGoal}`);
	logger.info(`🧠 Memory: ${response.currentState.memory}`);
	logger.info(`🎯 Next goal: ${response.currentState.nextGoal}\n`);
}

/**
 * Agent class for executing browser automation tasks
 */
export class Agent<
	Context = any,
	TAgentStructuredOutput extends AgentStructuredOutput = AgentStructuredOutput,
> {
	// Core properties
	id: string;
	taskId: string;
	sessionId: string;
	task: string;
	llm: BaseChatModel;
	controller: Controller<Context>;
	outputModelSchema?: new (
		...args: any[]
	) => TAgentStructuredOutput;
	sensitiveData?: Record<string, string | Record<string, string>>;
	settings: AgentSettings;
	state: AgentState;
	tokenCostService: TokenCost;
	fileSystem?: FileSystem;
	fileSystemPath?: string;

	// Action models
	ActionModel: any;
	AgentOutput: any;
	DoneActionModel: any;
	DoneAgentOutput: any;
	unfilteredActions: string;

	// Browser session
	browserSession: BrowserSession | null = null;

	// Message manager
	private _messageManager: MessageManager;

	// Callbacks
	registerNewStepCallback?: (
		state: BrowserStateSummary,
		output: AgentOutput,
		step: number,
	) => void | Promise<void>;
	registerDoneCallback?: (history: AgentHistoryList) => void | Promise<void>;
	registerExternalAgentStatusRaiseErrorCallback?: () => Promise<boolean>;

	// Context and telemetry
	context: Context | null;
	telemetry: ProductTelemetry;

	// Initial actions
	initialActions?: ActionModel[];

	// Version and source info
	version: string = "";
	source: string = "";

	forceExitTelemetryLogged: boolean = false;

	// Session and task timing
	private _sessionStartTime?: number;
	private _taskStartTime?: number;

	// Download tracking
	hasDownloadsPath: boolean = false;
	private _lastKnownDownloads: string[] = [];

	// External pause event
	private _externalPauseEvent: any; // Will be set to an event-like object

	// Other properties
	enableCloudSync: boolean;
	cloudSync?: CloudSync;
	eventbus?: EventBus; // EventBus type when available

	// cli
	running: boolean = false;
	lastResponseTime: number = 0;

	// Constructor with timeExecution decorator equivalent
	constructor(
		task: string,
		llm: BaseChatModel,
		options: {
			// Browser options
			page?: Page;
			browser?: Browser | BrowserSession;
			browserContext?: BrowserContext;
			browserProfile?: BrowserProfile;
			browserSession?: BrowserSession;
			controller?: Controller<Context>;

			// Initial agent run parameters
			sensitiveData?: Record<string, string | Record<string, string>>;
			initialActions?: Array<Record<string, Record<string, any>>>;

			// Cloud callbacks
			registerNewStepCallback?: (
				state: BrowserStateSummary,
				output: AgentOutput,
				step: number,
			) => void | Promise<void>;
			registerDoneCallback?: (
				history: AgentHistoryList,
			) => void | Promise<void>;
			registerExternalAgentStatusRaiseErrorCallback?: () => Promise<boolean>;

			// Agent settings
			outputModelSchema?: new (
				...args: any[]
			) => TAgentStructuredOutput;
			useVision?: boolean;
			useVisionForPlanner?: boolean;
			saveConversationPath?: string;
			saveConversationPathEncoding?: string;
			maxFailures?: number;
			retryDelay?: number;
			overrideSystemMessage?: string;
			extendSystemMessage?: string;
			validateOutput?: boolean;
			messageContext?: string;
			generateGif?: boolean | string;
			availableFilePaths?: string[];
			includeAttributes?: string[];
			maxActionsPerStep?: number;
			useThinking?: boolean;
			maxHistoryItems?: number;
			pageExtractionLLM?: BaseChatModel;
			plannerLLM?: BaseChatModel;
			plannerInterval?: number;
			isPlannerReasoning?: boolean;
			extendPlannerSystemMessage?: string;
			injectedAgentState?: AgentState;
			context?: Context;
			source?: string;
			fileSystemPath?: string;
			taskId?: string;
			cloudSync?: CloudSync;
			calculateCost?: boolean;
			displayFilesInDoneText?: boolean;
		} = {},
	) {
		// Initialize IDs
		this.id = options.taskId || uuidv4();
		this.taskId = this.id;
		this.sessionId = uuidv4();

		// Core components
		this.task = task;
		this.llm = llm;
		this.controller =
			options.controller ||
			new Controller<Context>(
				undefined,
				undefined,
				options.displayFilesInDoneText,
			);

		// Structured output
		this.outputModelSchema = options.outputModelSchema;
		if (this.outputModelSchema) {
			this.controller.useStructuredOutputAction(this.outputModelSchema);
		}

		this.sensitiveData = options.sensitiveData;

		// Initialize settings
		this.settings = new AgentSettings({
			useVision: options.useVision ?? true,
			useVisionForPlanner: options.useVisionForPlanner ?? false,
			saveConversationPath: options.saveConversationPath,
			saveConversationPathEncoding:
				options.saveConversationPathEncoding ?? "utf-8",
			maxFailures: options.maxFailures ?? 1,
			retryDelay: options.retryDelay ?? 10,
			overrideSystemMessage: options.overrideSystemMessage,
			extendSystemMessage: options.extendSystemMessage,
			validateOutput: options.validateOutput ?? false,
			messageContext: options.messageContext,
			generateGif: options.generateGif ?? false,
			availableFilePaths: options.availableFilePaths || [],
			includeAttributes:
				options.includeAttributes || DEFAULT_INCLUDE_ATTRIBUTES,
			maxActionsPerStep: options.maxActionsPerStep ?? 10,
			useThinking: options.useThinking ?? true,
			maxHistoryItems: options.maxHistoryItems ?? 40,
			pageExtractionLLM: options.pageExtractionLLM || llm,
			plannerLLM: options.plannerLLM,
			plannerInterval: options.plannerInterval ?? 1,
			isPlannerReasoning: options.isPlannerReasoning ?? false,
			extendPlannerSystemMessage: options.extendPlannerSystemMessage,
			calculateCost: options.calculateCost ?? false,
		});

		// Token cost service
		this.tokenCostService = new TokenCost(this.settings.calculateCost);
		this.tokenCostService.registerLLM(llm);
		if (this.settings.pageExtractionLLM) {
			this.tokenCostService.registerLLM(this.settings.pageExtractionLLM);
		}
		if (this.settings.plannerLLM) {
			this.tokenCostService.registerLLM(this.settings.plannerLLM);
		}

		// Initialize state
		this.state = options.injectedAgentState || new AgentState();

		// Initialize file system
		this._setFileSystem(options.fileSystemPath);

		// Action setup
		this._setupActionModels();
		this._setBrowserNodeVersionAndSource(options.source);
		this.initialActions = options.initialActions
			? this._convertInitialActions(options.initialActions)
			: undefined;

		// Verify LLM setup
		this._verifyAndSetupLLM();

		// TODO: move this logic to the LLMs
		// Handle model-specific vision settings
		this._handleModelSpecificSettings();

		// Log agent initialization
		this._logAgentInitialization();

		// Initialize available actions for system prompt (only non-filtered actions)
		// These will be used for the system prompt to maintain caching
		this.unfilteredActions = this.controller.registry.getPromptDescription();

		// Initialize message manager with state
		// Initial system prompt with all actions - will be updated during each step
		this._messageManager = new MessageManager({
			task,
			systemMessage: new SystemPrompt({
				actionDescription: this.unfilteredActions,
				maxActionsPerStep: this.settings.maxActionsPerStep,
				overrideSystemMessage: this.settings.overrideSystemMessage,
				extendSystemMessage: this.settings.extendSystemMessage,
				useThinking: this.settings.useThinking,
			}).getSystemMessage(),
			fileSystem: this.fileSystem!,
			availableFilePaths: this.settings.availableFilePaths,
			state: this.state.messageManagerState,
			useThinking: this.settings.useThinking,
			includeAttributes: this.settings.includeAttributes,
			messageContext: this.settings.messageContext,
			sensitiveData: this.sensitiveData,
			maxHistoryItems: this.settings.maxHistoryItems,
		});

		// Initialize browser session
		this._initializeBrowserSession(options);

		// Validate sensitive data security
		this._validateSensitiveDataSecurity();

		// Set callbacks
		this.registerNewStepCallback = options.registerNewStepCallback;
		this.registerDoneCallback = options.registerDoneCallback;
		this.registerExternalAgentStatusRaiseErrorCallback =
			options.registerExternalAgentStatusRaiseErrorCallback;

		// Context
		this.context = options.context || null;

		// Telemetry
		this.telemetry = new ProductTelemetry();

		// Event bus with WAL persistence
		// Default to ~/.config/browsernode/events/{agent_session_id}.jsonl
		const walPath = path.join(
			CONFIG.browsernodeConfigDir,
			"events",
			`${this.sessionId}.jsonl`,
		);
		this.eventbus = new EventBus({
			name: this.sessionId,
			walPath: walPath,
		});

		// Cloud sync service
		this.enableCloudSync = CONFIG.browsernodeCloudSync;
		if (this.enableCloudSync || options.cloudSync) {
			this.cloudSync = options.cloudSync || new CloudSync();
			// Register cloud sync handler
			this.eventbus?.on("*", this.cloudSync.handleEvent);
		}

		// Resolve and expand save conversation path
		if (this.settings.saveConversationPath) {
			const savePathStr = this.settings.saveConversationPath.toString();
			// Expand user home directory (~) and resolve to absolute path
			const expandedPath = savePathStr.startsWith("~")
				? savePathStr.replace("~", os.homedir())
				: savePathStr;
			this.settings.saveConversationPath = path.resolve(expandedPath);
			logger.info(
				`💬 Saving conversation to ${logPrettyPath(this.settings.saveConversationPath)}`,
			);
		}

		// Initialize download tracking
		if (!this.browserSession) {
			throw new Error("BrowserSession is not set up");
		}
		this.hasDownloadsPath =
			this.browserSession.browserProfile.downloadsPath !== null &&
			this.browserSession.browserProfile.downloadsPath !== undefined;
		if (this.hasDownloadsPath) {
			this._lastKnownDownloads = [];
			logger.info("📁 Initialized download tracking for agent");
		}

		// Initialize external pause event
		this._externalPauseEvent = this._createAsyncEvent();
		this._externalPauseEvent.set();
	}

	// Properties
	// Get instance-specific logger with task ID in the name
	get logger() {
		const browserSessionId = this.browserSession?.id || this.id;
		const currentPageId = this.browserSession?.agentCurrentPage
			? String(this.browserSession.agentCurrentPage).slice(-2)
			: "00";
		return bnLogger.child({
			label: `browsernode.Agent🅰 ${this.taskId.slice(-4)} on 🆂 ${browserSessionId.slice(-4)} 🅟 ${currentPageId}`,
		});
	}

	get browser(): Browser {
		if (!this.browserSession) {
			throw new Error("BrowserSession is not set up");
		}
		if (!this.browserSession.browser) {
			throw new Error("Browser is not set up");
		}
		return this.browserSession.browser;
	}

	get browserContext(): BrowserContext {
		if (!this.browserSession) {
			throw new Error("BrowserSession is not set up");
		}
		if (!this.browserSession.browserContext) {
			throw new Error("BrowserContext is not set up");
		}
		return this.browserSession.browserContext;
	}

	get browserProfile(): BrowserProfile {
		if (!this.browserSession) {
			throw new Error("BrowserSession is not set up");
		}
		return this.browserSession.browserProfile;
	}

	// Update availableFilePaths with downloaded files.
	private _updateAvailableFilePaths(downloads: string[]): void {
		if (!this.hasDownloadsPath) {
			return;
		}

		const currentFiles = new Set(this.settings.availableFilePaths || []);
		const newFiles = new Set(
			downloads.filter((file) => !currentFiles.has(file)),
		);

		if (newFiles.size > 0) {
			this.settings.availableFilePaths = [...currentFiles, ...newFiles];
			// Update message manager with new file paths
			this._messageManager.availableFilePaths =
				this.settings.availableFilePaths;

			this.logger.info(
				`📁 Added ${newFiles.size} downloaded files to available_file_paths (total: ${this.settings.availableFilePaths.length} files)`,
			);
			for (const filePath of newFiles) {
				this.logger.info(`📄 New file available: ${filePath}`);
			}
		} else {
			this.logger.info(
				`📁 No new downloads detected (tracking ${currentFiles.size} files)`,
			);
		}
	}

	private _setFileSystem(fileSystemPath?: string): void {
		// Check for conflicting parameters
		if (this.state.fileSystemState && fileSystemPath) {
			throw new Error(
				"Cannot provide both fileSystemState (from agent state) and fileSystemPath. " +
					"Either restore from existing state or create new file system at specified path, not both.",
			);
		}

		// Check if we should restore from existing state first
		if (this.state.fileSystemState) {
			try {
				// Restore file system from state at the exact same location
				this.fileSystem = FileSystem.fromState(this.state.fileSystemState);
				this.fileSystemPath = this.fileSystem.baseDir;
				logger.info(
					`💾 File system restored from state to: ${this.fileSystemPath}`,
				);
				return;
			} catch (error) {
				logger.error(`💾 Failed to restore file system from state: ${error}`);
				throw error;
			}
		}

		// Initialize new file system
		try {
			if (fileSystemPath) {
				this.fileSystem = new FileSystem(fileSystemPath);
				this.fileSystemPath = fileSystemPath;
			} else {
				// Create a temporary file system using agent ID
				const baseTmp = os.tmpdir();
				this.fileSystemPath = path.join(
					baseTmp,
					`browsernode_agent_${this.id}`,
				);
				this.fileSystem = new FileSystem(this.fileSystemPath);
			}
		} catch (error) {
			logger.error(`💾 Failed to initialize file system: ${error}.`);
			throw error;
		}

		// Save file system state to agent state
		this.state.fileSystemState = this.fileSystem.getState();
		logger.info(`💾 File system path: ${this.fileSystemPath}`);
	}

	private _setBrowserNodeVersionAndSource(sourceOverride?: string): void {
		// Get the version from package.json
		this.version = getBrowserNodeVersion();

		const __filename = fileURLToPath(import.meta.url);
		const __dirname = path.dirname(__filename);

		// Determine source
		try {
			const packageRoot = path.join(__dirname, "..", "..", "..");
			const repoFiles = [".git", "README.md", "docs", "examples"];
			const hasRepoFiles = repoFiles.every((file) =>
				existsSync(path.join(packageRoot, file)),
			);
			this.source = hasRepoFiles ? "git" : "npm";
		} catch (error) {
			this.logger.debug(`Error determining source: ${error}`);
			this.source = "unknown";
		}
		// this.logger.debug('Version: {version}, Source: {source}')  // moved later to _logAgentRun so that people are more likely to include it in copy-pasted support ticket logs
		if (sourceOverride) {
			this.source = sourceOverride;
		}
	}
	// Save current file system state to agent state
	private _setupActionModels(): void {
		// Initially only include actions with no filters

		this.ActionModel = this.controller.registry.createActionModel();

		// Create output model with the dynamic actions
		if (this.settings.useThinking) {
			this.AgentOutput = AgentOutput.typeWithCustomActions(this.ActionModel);
		} else {
			this.AgentOutput = AgentOutput.typeWithCustomActionsNoThinking(
				this.ActionModel,
			);
		}

		// Used to force the done action when max_steps is reached
		this.DoneActionModel = this.controller.registry.createActionModel(["done"]);
		if (this.settings.useThinking) {
			this.DoneAgentOutput = AgentOutput.typeWithCustomActions(
				this.DoneActionModel,
			);
		} else {
			this.DoneAgentOutput = AgentOutput.typeWithCustomActionsNoThinking(
				this.DoneActionModel,
			);
		}
	}

	/**
	 * Add a new task to the agent, keeping the same task_id as tasks are continuous
	 */
	addNewTask(newTask: string): void {
		// Simply delegate to message manager - no need for new task_id or events
		// The task continues with new instructions, it doesn't end and start a new one
		this.task = newTask;
		this._messageManager.addNewTask(newTask);
	}

	/**
	 * Execute one step of the task
	 */
	@timeExecution("--step")
	async step(stepInfo?: AgentStepInfo): Promise<void> {
		let browserStateSummary: BrowserStateSummary | null = null;
		let modelOutput: AgentOutput | null = null;
		let result: ActionResult[] = [];
		const stepStartTime = Date.now();

		try {
			if (!this.browserSession) {
				throw new Error("BrowserSession is not set up");
			}

			browserStateSummary = await this.browserSession.getStateSummary(true);
			const currentPage = await this.browserSession.getCurrentPage();

			this._logStepContext(currentPage, browserStateSummary);

			await this._raiseIfStoppedOrPaused();

			// Update action models with page-specific actions
			await this._updateActionModelsForPage(currentPage);

			// Get page-specific filtered actions
			const pageFilteredActions =
				this.controller.registry.getPromptDescription(currentPage);

			// If there are page-specific actions, add them as a special message
			if (pageFilteredActions) {
				const pageActionMessage = `For this page, these additional actions are available:\n${pageFilteredActions}`;
				this._messageManager.addMessageWithType({
					role: "user",
					content: pageActionMessage,
				});
			}

			this._messageManager.addStateMessage(
				browserStateSummary,
				this.state.lastModelOutput,
				this.state.lastResult,
				stepInfo,
				this.settings.useVision,
				pageFilteredActions,
				this.sensitiveData,
			);

			// Run planner at specified intervals if configured
			if (
				this.settings.plannerLLM &&
				this.state.nSteps % this.settings.plannerInterval === 0
			) {
				// Add plan before last state message
				const plan = await this._runPlanner();
				this._messageManager.addPlan(plan, -1);
			}

			// Handle last step
			if (stepInfo?.isLastStep()) {
				// Add last step warning if needed
				const msg =
					'Now comes your last step. Use only the "done" action now. No other actions - so here your action sequence must have length 1.\n' +
					'If the task is not yet fully finished as requested by the user, set success in "done" to false! E.g. if not all steps are fully completed.\n' +
					'If the task is fully finished, set success in "done" to true.\n' +
					"Include everything you found out for the ultimate task in the done text.";
				this.logger.info("Last step finishing up");
				this._messageManager.addMessageWithType({ role: "user", content: msg });

				// Defensive check: ensure DoneAgentOutput is defined before assignment
				if (!this.DoneAgentOutput) {
					this.logger.warn(
						"⚠️ this.DoneAgentOutput is undefined, re-initializing action models",
					);
					this._setupActionModels();
					if (!this.DoneAgentOutput) {
						throw new Error(
							"Failed to initialize DoneAgentOutput - this.DoneAgentOutput is still undefined after setupActionModels()",
						);
					}
				}

				this.AgentOutput = this.DoneAgentOutput;
			}

			const inputMessages = this._messageManager.getMessages();

			try {
				modelOutput = await this.getNextAction(inputMessages);

				if (
					!modelOutput.action ||
					!Array.isArray(modelOutput.action) ||
					modelOutput.action.every((action) => Object.keys(action).length === 0)
				) {
					this.logger.warn("Model returned empty action. Retrying...");

					const clarificationMessage = {
						role: "user" as const,
						content:
							"You forgot to return an action. Please respond only with a valid JSON action according to the expected format.",
					};

					const retryMessages = [...inputMessages, clarificationMessage];
					modelOutput = await this.getNextAction(retryMessages);

					if (
						!modelOutput.action ||
						modelOutput.action.every(
							(action) => Object.keys(action).length === 0,
						)
					) {
						this.logger.warn(
							"Model still returned empty after retry. Inserting safe noop action.",
						);
						const actionInstance = new this.ActionModel();
						actionInstance.done = {
							success: false,
							text: "No next action returned by LLM!",
						};
						modelOutput.action = [actionInstance];
					}
				}

				// Check again for paused/stopped state
				await this._raiseIfStoppedOrPaused();

				this.state.nSteps += 1;

				// Execute callbacks
				if (this.registerNewStepCallback) {
					if (this.isAsyncFunction(this.registerNewStepCallback)) {
						await this.registerNewStepCallback(
							browserStateSummary,
							modelOutput,
							this.state.nSteps,
						);
					} else {
						this.registerNewStepCallback(
							browserStateSummary,
							modelOutput,
							this.state.nSteps,
						);
					}
				}

				// Save conversation if needed
				if (this.settings.saveConversationPath) {
					const conversationDir = path.resolve(
						this.settings.saveConversationPath.toString(),
					);
					const conversationFilename = `conversation_${this.id}_${this.state.nSteps}.txt`;
					const target = path.join(conversationDir, conversationFilename);
					await saveConversation(
						inputMessages,
						modelOutput,
						target,
						this.settings.saveConversationPathEncoding as BufferEncoding,
					);
				}

				// Remove last state message from history
				this._messageManager.removeLastStateMessage(); // we dont want the whole state in the chat history

				// Check again if paused before committing
				// check again if Ctrl+C was pressed before we commit the output to history
				await this._raiseIfStoppedOrPaused();
			} catch (error) {
				this._messageManager.removeLastStateMessage();
				if (error instanceof Error && error.message.includes("cancelled")) {
					throw new Error("Model query cancelled by user");
				}
				throw error;
			}

			// Execute actions
			result = await this.multiAct(modelOutput.action);

			this.state.lastResult = result;
			this.state.lastModelOutput = modelOutput;

			// Check for new downloads after executing actions
			if (this.hasDownloadsPath && this.browserSession) {
				try {
					const currentDownloads = this.browserSession.downloadedFiles;
					if (
						JSON.stringify(currentDownloads) !==
						JSON.stringify(this._lastKnownDownloads)
					) {
						this._updateAvailableFilePaths(currentDownloads);
						this._lastKnownDownloads = currentDownloads;
					}
				} catch (error) {
					this.logger.debug(`📁 Failed to check for new downloads: ${error}`);
				}
			}

			// Log final result
			if (result.length > 0) {
				const lastResult = result[result.length - 1];
				if (lastResult?.isDone) {
					this.logger.info(`📄 Result: ${lastResult.extractedContent}`);
					if (lastResult.attachments) {
						this.logger.info("📎 Click links below to access the attachments:");
						for (const filePath of lastResult.attachments || []) {
							this.logger.info(`👉 ${filePath}`);
						}
					}
				}
			}

			this.state.consecutiveFailures = 0;
		} catch (error) {
			if (error instanceof Error && error.message.includes("paused")) {
				// this.logger.debug("Agent paused");
				this.state.lastResult = [
					{
						error:
							"The agent was paused mid-step - the last action might need to be repeated",
						includeInMemory: true,
					},
				];
				return;
			} else if (
				error instanceof Error &&
				(error.name === "AbortError" || error.message.includes("cancelled"))
			) {
				// Directly handle the case where the step is cancelled at a higher level
				// this.logger.debug("Task cancelled - agent was paused with Ctrl+C");
				this.state.lastResult = [
					{
						error: "The agent was paused with Ctrl+C",
						includeInMemory: true,
					},
				];
				throw new Error("Step cancelled by user");
			} else {
				result = await this._handleStepError(error as Error);
				this.state.lastResult = result;
			}
		} finally {
			const stepEndTime = Date.now();
			if (result.length > 0 && browserStateSummary) {
				const metadata = new StepMetadata(
					stepStartTime,
					stepEndTime,
					this.state.nSteps,
				);
				this._makeHistoryItem(
					modelOutput,
					browserStateSummary,
					result,
					metadata,
				);
			}

			// Log step completion summary
			this._logStepCompletionSummary(stepStartTime, result);

			// Save file system state after step completion
			this.saveFileSystemState();

			// Emit both step created and executed events
			if (browserStateSummary && modelOutput) {
				// Extract key step data for the event
				const actionsData =
					modelOutput.action?.map((action) =>
						action.modelDump ? action.modelDump() : action,
					) || [];

				// Emit step event (placeholder - actual implementation depends on event system)
				this.eventbus?.dispatch(
					CreateAgentStepEvent.fromAgentStep(
						this,
						modelOutput,
						result,
						actionsData,
						browserStateSummary,
					),
				);
			}
		}
	}

	/**Handle step error*/
	@timeExecution("--handle_step_error (agent)")
	private async _handleStepError(error: Error): Promise<ActionResult[]> {
		const includeTrace = this.logger.level === "debug";
		let errorMsg = AgentError.formatError(error, includeTrace);
		const prefix = `❌ Result failed ${this.state.consecutiveFailures + 1}/${this.settings.maxFailures} times:\n `;
		this.state.consecutiveFailures += 1;

		if (errorMsg.includes("Browser closed")) {
			this.logger.error(
				"❌ Browser is closed or disconnected, unable to proceed",
			);
			return [
				{
					error: "Browser closed or disconnected, unable to proceed",
					includeInMemory: true,
				},
			];
		}

		// Check for validation errors and token limit issues
		if (
			error.name === "ValidationError" ||
			error.name === "ValueError" ||
			error instanceof TypeError
		) {
			this.logger.error(`${prefix}${errorMsg}`);
			if (errorMsg.includes("Max token limit reached")) {
				// TODO: Implement token cutting logic when needed
				// For now, just log the issue
				this.logger.warn(
					"Max token limit reached - consider reducing message history",
				);
			}
		} else if (
			errorMsg.includes("Could not parse response") ||
			errorMsg.includes("tool_use_failed")
		) {
			// Give model a hint how output should look like
			this.logger.debug(`Model: ${this.llm.model} failed`);
			errorMsg += "\n\nReturn a valid JSON object with the required fields.";
			this.logger.error(`${prefix}${errorMsg}`);
		} else {
			// Handle rate limit errors from different providers
			const isRateLimitError =
				error.name === "RateLimitError" || // OpenAI
				error.name === "ResourceExhausted" || // Google
				error.name === "AnthropicRateLimitError" || // Anthropic
				errorMsg.includes("RateLimit") ||
				errorMsg.includes("on tokens per minute (TPM): Limit") ||
				errorMsg.includes("rate_limit_exceeded") ||
				errorMsg.includes("quota_exceeded");

			if (isRateLimitError) {
				this.logger.warn(`${prefix}${errorMsg}`);
				await this.sleep(this.settings.retryDelay * 1000);
			} else {
				this.logger.error(`${prefix}${errorMsg}`);
			}
		}

		return [{ error: errorMsg, includeInMemory: true }];
	}

	/**Create and store history item*/
	private _makeHistoryItem(
		modelOutput: AgentOutput | null,
		browserStateSummary: BrowserStateSummary,
		result: ActionResult[],
		metadata?: StepMetadata,
	): void {
		let interactedElements: Array<DOMHistoryElement | null> = [null];

		if (modelOutput) {
			interactedElements = AgentHistory.getInteractedElement(
				modelOutput,
				browserStateSummary.selectorMap,
			);
		}

		const stateHistory = new BrowserStateHistory(
			browserStateSummary.url,
			browserStateSummary.title,
			browserStateSummary.tabs,
			interactedElements,
			browserStateSummary.screenshot,
		);

		const historyItem = new AgentHistory(
			modelOutput,
			result,
			stateHistory,
			metadata,
		);

		this.state.history.history.push(historyItem);
	}
	private _removeThinkTags(text: string): string {
		// Step 1: Remove well-formed <think>...</think>
		text = text.replace(/<think>.*?<\/think>/gs, "");
		// Step 2: If there's an unmatched closing tag </think>,
		//         remove everything up to and including that.
		text = text.replace(/.*?<\/think>/gs, "");
		return text.trim();
	}

	/**
	 * Get next action from LLM based on current state
	 */
	@timeExecution("--getNextAction (agent)")
	async getNextAction(inputMessages: BaseMessage[]): Promise<AgentOutput> {
		// Defensive check: ensure AgentOutput is defined
		if (!this.AgentOutput) {
			this.logger.warn(
				"⚠️ this.AgentOutput is undefined, re-initializing action models",
			);
			this._setupActionModels();
			if (!this.AgentOutput) {
				throw new Error(
					"Failed to initialize AgentOutput - this.AgentOutput is still undefined after setupActionModels()",
				);
			}
		}

		// Additional type safety check - ensure it's a proper class constructor
		if (typeof this.AgentOutput !== "function") {
			this.logger.error(
				`❌ this.AgentOutput is not a function: ${typeof this.AgentOutput}, value: ${this.AgentOutput}`,
			);
			this._setupActionModels();
			if (typeof this.AgentOutput !== "function") {
				throw new Error(
					"Failed to initialize AgentOutput - this.AgentOutput is not a proper class constructor",
				);
			}
		}

		const response = await this.llm.ainvoke(inputMessages, this.AgentOutput);

		const completionData = response.completion as any;
		// Create a proper AgentOutput instance instead of just type casting
		const parsed = new AgentOutput(
			completionData.evaluationPreviousGoal,
			completionData.memory,
			completionData.nextGoal,
			completionData.action,
			completionData.thinking,
		);

		// Cut the number of actions to maxActionsPerStep if needed
		if (
			parsed.action &&
			parsed.action.length > this.settings.maxActionsPerStep
		) {
			parsed.action = parsed.action.slice(0, this.settings.maxActionsPerStep);
		}

		if (!(this.state.paused || this.state.stopped)) {
			logResponse(parsed, this.controller.registry.registry, this.logger);
		}

		this._logNextActionSummary(parsed);
		return parsed;
	}

	/**Log the agent run*/
	_logAgentRun(): void {
		this.logger.info(`🚀 Starting task: ${this.task}`);
		this.logger.debug(
			`🤖 BrowserNode Library Version ${this.version} (${this.source})`,
		);
	}

	/**Log step context information*/
	private _logStepContext(
		currentPage: any,
		browserStateSummary: BrowserStateSummary,
	): void {
		const urlShort =
			currentPage.url.length > 50
				? currentPage.url.substring(0, 50) + "..."
				: currentPage.url;
		const interactiveCount = Object.keys(
			browserStateSummary.selectorMap || {},
		).length;
		this.logger.info(
			`📍 Step ${this.state.nSteps}: Evaluating page with ${interactiveCount} interactive elements on: ${urlShort}`,
		);
	}

	/**Log a comprehensive summary of the next action(s)*/
	private _logNextActionSummary(parsed: AgentOutput): void {
		if (!this.logger.level || this.logger.level !== "debug" || !parsed.action) {
			return;
		}

		const actionCount = parsed.action.length;
		// Collect action details
		const actionDetails: string[] = [];

		for (let i = 0; i < parsed.action.length; i++) {
			const action = parsed.action[i];
			const actionData = modelDump(action) ? modelDump(action) : action;
			const actionName = Object.keys(actionData)[0] || "unknown";
			const actionParams = actionData[actionName] || {};
			// Format key parameters concisely
			const paramSummary: string[] = [];
			if (typeof actionParams === "object" && actionParams !== null) {
				for (const [key, value] of Object.entries(actionParams)) {
					if (key === "index") {
						paramSummary.push(`#${value}`);
					} else if (key === "text" && typeof value === "string") {
						const textPreview =
							value.length > 30 ? value.substring(0, 30) + "..." : value;
						paramSummary.push(`text="${textPreview}"`);
					} else if (key === "url") {
						paramSummary.push(`url="${value}"`);
					} else if (key === "success") {
						paramSummary.push(`success=${value}`);
					} else if (
						typeof value === "string" ||
						typeof value === "number" ||
						typeof value === "boolean"
					) {
						const valStr = String(value);
						const valPreview =
							valStr.length > 30 ? valStr.substring(0, 30) + "..." : valStr;
						paramSummary.push(`${key}=${valPreview}`);
					}
				}
			}

			const paramStr =
				paramSummary.length > 0 ? `(${paramSummary.join(", ")})` : "";
			actionDetails.push(`${actionName}${paramStr}`);
		}
		// Create summary based on single vs multi-action
		if (actionCount === 1) {
			this.logger.info(`☝️ Decided next action: ${actionDetails[0]}`);
		} else {
			const summaryLines = [`✌️ Decided next ${actionCount} multi-actions:`];
			for (let i = 0; i < actionDetails.length; i++) {
				summaryLines.push(`          ${i + 1}. ${actionDetails[i]}`);
			}
			this.logger.info(summaryLines.join("\n"));
		}
	}

	/**Log step completion summary with action count, timing, and success/failure stats*/
	private _logStepCompletionSummary(
		stepStartTime: number,
		result: ActionResult[],
	): void {
		if (result.length === 0) {
			return;
		}

		const stepDuration = (Date.now() - stepStartTime) / 1000;
		const actionCount = result.length;
		// Count success and failures
		const successCount = result.filter((r) => !r.error).length;
		const failureCount = actionCount - successCount;
		// Format success/failure indicators
		const successIndicator = successCount > 0 ? `✅ ${successCount}` : "";
		const failureIndicator = failureCount > 0 ? `❌ ${failureCount}` : "";
		const statusParts = [successIndicator, failureIndicator].filter(
			(part) => part,
		);
		const statusStr = statusParts.length > 0 ? statusParts.join(" | ") : "✅ 0";

		this.logger.info(
			`📍 Step ${this.state.nSteps}: Ran ${actionCount} actions in ${stepDuration.toFixed(2)}s: ${statusStr}`,
		);
	}

	/**Send the agent event for this run to telemetry*/
	private _logAgentEvent(
		maxSteps: number,
		agentRunError?: string | null,
	): void {
		const tokenSummary = this.tokenCostService.getUsageTokensForModel(
			this.llm.model,
		);

		// Prepare action history data correctly
		const actionHistoryData: any[] = [];
		for (const item of this.state.history.history) {
			if (item.modelOutput && item.modelOutput.action) {
				// Convert each ActionModel in the step to its dictionary representation
				const stepActions = item.modelOutput.action
					.filter((action) => action) // Ensure action is not null/undefined
					.map((action) => modelDump(action, true));
				actionHistoryData.push(stepActions);
			} else {
				// Append null if a step had no actions or no model output
				actionHistoryData.push(null);
			}
		}

		const finalRes = this.state.history.finalResult();
		const finalResultStr = finalRes !== null ? JSON.stringify(finalRes) : null;

		this.telemetry.capture(
			new AgentTelemetryEvent({
				task: this.task,
				model: this.llm.model,
				modelProvider: this.llm.provider,
				plannerLlm: this.settings.plannerLLM?.model || null,
				maxSteps,
				maxActionsPerStep: this.settings.maxActionsPerStep,
				useVision: this.settings.useVision,
				useValidation: this.settings.validateOutput,
				version: this.version,
				source: this.source,
				actionErrors: this.state.history.errors(),
				actionHistory: actionHistoryData,
				urlsVisited: this.state.history.urls(),
				steps: this.state.nSteps,
				totalInputTokens: tokenSummary.promptTokens,
				totalDurationSeconds: this.state.history.totalDurationSeconds(),
				success: this.state.history.isSuccessful(),
				finalResultResponse: finalResultStr,
				errorMessage: agentRunError || null,
			}),
		);
	}

	/**
	 * Take a single step
	 * @returns completion status
	 */
	async takeStep(stepInfo?: AgentStepInfo): Promise<[boolean, boolean]> {
		await this.step(stepInfo);

		if (this.state.history.isDone()) {
			await this.logCompletion();
			if (this.registerDoneCallback) {
				if (this.isAsyncFunction(this.registerDoneCallback)) {
					await this.registerDoneCallback(this.state.history);
				} else {
					this.registerDoneCallback(this.state.history);
				}
			}
			return [true, true];
		}

		return [false, false];
	}

	/**
	 * Execute the task with maximum number of steps
	 * @param maxSteps - Maximum number of steps to execute
	 * @param options - Optional options
	 * @returns AgentHistoryList
	 */
	@timeExecution("--run (agent)")
	async run(
		maxSteps = 100,
		options: {
			onStepStart?: AgentHookFunc<Context>;
			onStepEnd?: AgentHookFunc<Context>;
		} = {},
	): Promise<AgentHistoryList> {
		const { onStepStart, onStepEnd } = options;
		let agentRunError: string | null = null; // Initialize error tracking variable
		this.forceExitTelemetryLogged = false; // Flag for custom telemetry on force exit

		// Set up the signal handler with callbacks specific to this agent
		const onForceExitLogTelemetry = () => {
			this._logAgentEvent(maxSteps, "SIGINT: Cancelled by user");
			// Call the shutdown method on the telemetry instance to ensure all events are sent
			// Note: We don't await this since it's a force exit, but we initiate the shutdown
			if (this.telemetry) {
				this.telemetry.shutdown().catch((error) => {
					this.logger.error(
						`Failed to shutdown telemetry on force exit: ${error}`,
					);
				});
			}
			this.forceExitTelemetryLogged = true; // Set the flag
		};

		const signalHandler = new SignalHandler({
			pauseCallback: () => this.pause(),
			resumeCallback: () => this.resume(),
			customExitCallback: onForceExitLogTelemetry, // Pass the new telemetry callback
			exitOnSecondInt: true,
		});
		signalHandler.register();

		try {
			this._logAgentRun();

			// Initialize timing for session and task
			this._sessionStartTime = Date.now();
			this._taskStartTime = this._sessionStartTime; // Initialize task start time

			// Emit CreateAgentSessionEvent at the START of run()
			if (this.eventbus) {
				this.eventbus.dispatch(CreateAgentSessionEvent.fromAgent(this));
			}

			// Emit CreateAgentTaskEvent at the START of run()
			if (this.eventbus) {
				this.eventbus.dispatch(CreateAgentTaskEvent.fromAgent(this));
			}

			// Execute initial actions if provided
			if (this.initialActions) {
				const result = await this.multiAct(this.initialActions, false);
				this.state.lastResult = result;
			}

			// Main execution loop
			for (let step = 0; step < maxSteps; step++) {
				// Replace the polling with clean pause-wait
				if (this.state.paused) {
					await this.waitUntilResumed();
					signalHandler.reset();
				}

				// Check if we should stop due to failures
				if (this.state.consecutiveFailures >= this.settings.maxFailures) {
					this.logger.error(
						`❌ Stopping due to ${this.settings.maxFailures} consecutive failures`,
					);
					agentRunError = `Stopped due to ${this.settings.maxFailures} consecutive failures`;
					break;
				}

				// Check control flags before each step
				if (this.state.stopped) {
					this.logger.info("🛑 Agent stopped");
					agentRunError = "Agent stopped programmatically";
					break;
				}

				while (this.state.paused) {
					await this.sleep(200); // Small delay to prevent CPU spinning
					if (this.state.stopped) {
						// Allow stopping while paused
						agentRunError = "Agent stopped programmatically while paused";
						break;
					}
				}

				// Execute step hooks
				if (onStepStart) {
					await onStepStart(this);
				}

				const stepInfo = new AgentStepInfo(step, maxSteps);
				await this.step(stepInfo);

				if (onStepEnd) {
					await onStepEnd(this);
				}

				// Check if done
				if (this.state.history.isDone()) {
					await this.logCompletion();

					if (this.registerDoneCallback) {
						if (this.isAsyncFunction(this.registerDoneCallback)) {
							await this.registerDoneCallback(this.state.history);
						} else {
							this.registerDoneCallback(this.state.history);
						}
					}

					// Task completed
					break;
				}
			}

			// Handle max steps reached (using else block equivalent)
			if (!this.state.history.isDone() && !agentRunError) {
				agentRunError = "Failed to complete task in maximum steps";
				this.state.history.history.push(
					new AgentHistory(
						null,
						[{ error: agentRunError, includeInMemory: true }],
						new BrowserStateHistory("", "", [], [], null),
						undefined,
					),
				);
				this.logger.info(`❌ ${agentRunError}`);
			}

			// Set usage summary
			this.state.history.usage = await this.tokenCostService.getUsageSummary();

			// Set the model output schema and call it on the fly
			if (!this.state.history._outputModelSchema && this.outputModelSchema) {
				this.state.history._outputModelSchema = this.outputModelSchema;
			}

			return this.state.history;
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes("KeyboardInterrupt")
			) {
				// Already handled by our signal handler, but catch any direct KeyboardInterrupt as well
				this.logger.info(
					"Got KeyboardInterrupt during execution, returning current history",
				);
				agentRunError = "KeyboardInterrupt";
				this.state.history.usage =
					await this.tokenCostService.getUsageSummary();
				return this.state.history;
			}

			this.logger.error(`Agent run failed with exception: ${error}`);
			agentRunError = String(error);
			throw error;
		} finally {
			// Log token usage summary
			await this.tokenCostService.logUsageSummary();

			// Unregister signal handlers before cleanup
			signalHandler.unregister();

			if (!this.forceExitTelemetryLogged) {
				try {
					this._logAgentEvent(maxSteps, agentRunError);
					// Ensure telemetry data is sent before exit
					if (this.telemetry) {
						await this.telemetry.shutdown();
					}
				} catch (logError) {
					this.logger.error(`Failed to log telemetry event: ${logError}`);
				}
			} else {
				// Info message when custom telemetry for SIGINT was already logged
				this.logger.info(
					"Telemetry for force exit (SIGINT) was logged by custom exit callback.",
				);
			}

			// NOTE: CreateAgentSessionEvent and CreateAgentTaskEvent are now emitted at the START of run()
			// to match backend requirements for CREATE events to be fired when entities are created,
			// not when they are completed

			// Emit UpdateAgentTaskEvent at the END of run() with final task state
			if (this.eventbus) {
				this.eventbus.dispatch(UpdateAgentTaskEvent.fromAgent(this));
			}

			// Generate GIF if needed before stopping event bus
			if (this.settings.generateGif) {
				const outputPath =
					typeof this.settings.generateGif === "string"
						? this.settings.generateGif
						: "agent_history.gif";

				try {
					await createHistoryGif(this.task, this.state.history, { outputPath });

					// Emit output file generated event for GIF
					if (this.eventbus) {
						const outputEvent =
							await CreateAgentOutputFileEvent.fromAgentAndFile(
								this,
								outputPath,
							);
						this.eventbus.dispatch(outputEvent);
					}
				} catch (error) {
					this.logger.warn(`Failed to create GIF: ${error}`);
				}
			}

			// Wait briefly for cloud auth to start and print the URL, but don't block for completion
			if (this.enableCloudSync && this.cloudSync) {
				// Cloud sync authentication handling would go here
				// We'll skip this for now as it's complex async handling
			}

			// Stop the event bus gracefully, waiting for all events to be processed
			// Use longer timeout to avoid deadlocks in tests with multiple agents
			if (this.eventbus) {
				try {
					await this.eventbus.stop(10.0); // 10 second timeout
				} catch (error) {
					this.logger.warn(`Event bus stop timeout: ${error}`);
				}
			}

			// Cleanup
			await this.close();
		}
	}

	/**
	 * Execute multiple actions
	 */
	@timeExecution("--multiAct(agent)")
	async multiAct(
		actions: ActionModel[],
		checkForNewElements = true,
	): Promise<ActionResult[]> {
		const results: ActionResult[] = [];

		if (!this.browserSession) {
			throw new Error("BrowserSession is not set up");
		}

		const cachedSelectorMap = await this.browserSession.getSelectorMap();
		const cachedPathHashes = new Set(
			Object.values(cachedSelectorMap).map((e) => e.hash.branchPathHash),
		);

		await this.browserSession.removeHighlights();

		for (let i = 0; i < actions.length; i++) {
			const action = actions[i];
			if (!action) {
				this.logger.warn(`Action at index ${i} is null or undefined, skipping`);
				continue;
			}

			// Don't allow 'done' as a single action after other actions
			if (i > 0 && action.modelDump && action.modelDump().done) {
				const msg = `Done action is allowed only as a single action - stopped after action ${i} / ${actions.length}.`;
				this.logger.info(msg);
				break;
			}

			// Check for index changes after previous action
			if (action.getIndex && action.getIndex() !== null && i !== 0) {
				const newBrowserStateSummary =
					await this.browserSession.getStateSummary(false);
				const newSelectorMap = newBrowserStateSummary.selectorMap;

				const actionIndex = action.getIndex();
				if (actionIndex === null) {
					continue;
				}
				// Detect index change after previous action
				const origTarget = cachedSelectorMap[actionIndex];
				const origTargetHash = origTarget?.hash.branchPathHash;
				const newTarget = newSelectorMap[actionIndex];
				const newTargetHash = newTarget?.hash.branchPathHash;

				if (origTargetHash !== newTargetHash) {
					const msg = `Element index changed after action ${i} / ${actions.length}, because page changed.`;
					this.logger.info(msg);
					results.push({
						extractedContent: msg,
						includeInMemory: true,
						longTermMemory: msg,
					});
					break;
				}

				const newPathHashes = new Set(
					Object.values(newSelectorMap).map((e) => e.hash.branchPathHash),
				);
				if (
					checkForNewElements &&
					!this.isSubset(newPathHashes, cachedPathHashes)
				) {
					const msg = `Something new appeared after action ${i} / ${actions.length}, following actions are NOT executed and should be retried.`;
					this.logger.info(msg);
					results.push({
						extractedContent: msg,
						includeInMemory: true,
						longTermMemory: msg,
					});
					break;
				}
			}

			try {
				await this._raiseIfStoppedOrPaused();

				const result = await this.controller.act(
					action,
					this.browserSession,
					this.settings.pageExtractionLLM,
					this.sensitiveData,
					this.settings.availableFilePaths,
					this.fileSystem,
					this.context,
				);

				results.push(result);

				// Get action name for logging
				const actionData = action.modelDump ? action.modelDump() : action;
				const actionName = Object.keys(actionData)[0] || "unknown";
				const actionParams = actionData[actionName] || "";
				this.logger.info(
					`☑️ Executed action ${i + 1}/${actions.length}: ${actionName}(${JSON.stringify(
						actionParams,
						null,
						2,
					)})`,
				);

				const lastResult = results[results.length - 1];
				if (
					lastResult?.isDone ||
					lastResult?.error ||
					i === actions.length - 1
				) {
					break;
				}

				await this.sleep(this.browserProfile.waitBetweenActions);
			} catch (error) {
				if (error instanceof Error && error.message.includes("cancelled")) {
					this.logger.info(`Action ${i + 1} was cancelled due to Ctrl+C`);
					if (results.length === 0) {
						results.push({
							error: "The action was cancelled due to Ctrl+C",
							includeInMemory: true,
						});
					}
					throw new Error("Action cancelled by user");
				}
				throw error;
			}
		}

		return results;
	}

	/**
	 * Log completion of the task
	 */
	async logCompletion(): Promise<void> {
		if (this.state.history.isSuccessful()) {
			this.logger.info("✅ Task completed successfully");
		} else {
			this.logger.info("❌ Task completed without success");
		}
	}

	/**
	 * Rerun a saved history of actions with error handling and retry logic.
	 *
	 * @param history - The history to replay
	 * @param maxRetries - Maximum number of retries per action
	 * @param skipFailures - Whether to skip failed actions or stop execution
	 * @param delayBetweenActions - Delay between actions in seconds
	 * @returns List of action results
	 */
	@timeExecution("--rerun_history (agent)")
	async rerunHistory(
		history: AgentHistoryList,
		options: {
			maxRetries?: number;
			skipFailures?: boolean;
			delayBetweenActions?: number;
		} = {},
	): Promise<ActionResult[]> {
		const {
			maxRetries = 3,
			skipFailures = true,
			delayBetweenActions = 2.0,
		} = options;

		// Execute initial actions if provided
		if (this.initialActions) {
			const result = await this.multiAct(this.initialActions);
			this.state.lastResult = result;
		}

		const results: ActionResult[] = [];

		for (let i = 0; i < history.history.length; i++) {
			const historyItem = history.history[i];

			// Check if historyItem exists
			if (!historyItem) {
				this.logger.warn(`Step ${i + 1}: History item is undefined, skipping`);
				results.push({
					error: "History item is undefined",
					includeInMemory: false,
				});
				continue;
			}

			const goal = historyItem.modelOutput?.currentState.nextGoal || "";
			this.logger.info(
				`Replaying step ${i + 1}/${history.history.length}: goal: ${goal}`,
			);

			if (
				!historyItem.modelOutput ||
				!historyItem.modelOutput.action ||
				historyItem.modelOutput.action.length === 0 ||
				historyItem.modelOutput.action.every((action) => action === null)
			) {
				this.logger.warn(`Step ${i + 1}: No action to replay, skipping`);
				results.push({
					error: "No action to replay",
					includeInMemory: false,
				});
				continue;
			}

			let retryCount = 0;
			while (retryCount < maxRetries) {
				try {
					const result = await this._executeHistoryStep(
						historyItem,
						delayBetweenActions,
					);
					results.push(...result);
					break;
				} catch (error) {
					retryCount++;
					if (retryCount === maxRetries) {
						const errorMsg = `Step ${i + 1} failed after ${maxRetries} attempts: ${error}`;
						this.logger.error(errorMsg);
						if (!skipFailures) {
							results.push({
								error: errorMsg,
								includeInMemory: true,
							});
							throw new Error(errorMsg);
						}
						results.push({
							error: errorMsg,
							includeInMemory: false,
						});
					} else {
						this.logger.warn(
							`Step ${i + 1} failed (attempt ${retryCount}/${maxRetries}), retrying...`,
						);
						await this.sleep(delayBetweenActions * 1000); // Convert seconds to milliseconds
					}
				}
			}
		}

		return results;
	}

	/**
	 * Execute a single step from history with element validation
	 *
	 */
	async _executeHistoryStep(
		historyItem: AgentHistory,
		delayBetweenActions: number,
	): Promise<ActionResult[]> {
		if (!this.browserSession) {
			throw new Error("BrowserSession is not set up");
		}

		const state = await this.browserSession.getStateSummary(false);
		if (!state || !historyItem.modelOutput) {
			throw new Error("Invalid state or model output");
		}

		const updatedActions: ActionModel[] = [];

		for (let i = 0; i < historyItem.modelOutput.action.length; i++) {
			const action = historyItem.modelOutput.action[i];
			if (!action) {
				throw new Error(`Action at index ${i} is undefined`);
			}

			const interactedElement =
				historyItem.state?.interactedElement?.[i] || null;

			const updatedAction = await this._updateActionIndices(
				interactedElement,
				action,
				state,
			);

			if (updatedAction === null) {
				throw new Error(`Could not find matching element ${i} in current page`);
			}

			updatedActions.push(updatedAction);
		}

		const result = await this.multiAct(updatedActions);

		// Add delay after executing actions
		if (delayBetweenActions > 0) {
			await this.sleep(delayBetweenActions * 1000);
		}

		return result;
	}

	/**
	 * Update action indices based on current page state.
	 * Returns updated action or None if element cannot be found.
	 * @private
	 */
	private async _updateActionIndices(
		historicalElement: DOMHistoryElement | null,
		action: ActionModel,
		browserStateSummary: BrowserStateSummary,
	): Promise<ActionModel | null> {
		if (!historicalElement || !browserStateSummary.elementTree) {
			return action;
		}

		const currentElement = HistoryTreeProcessor.findHistoryElementInTree(
			historicalElement,
			browserStateSummary.elementTree,
		);

		if (!currentElement || currentElement.highlightIndex === null) {
			return null;
		}

		const oldIndex = action.getIndex ? action.getIndex() : null;
		if (oldIndex !== currentElement.highlightIndex) {
			// Update the action's index
			if (action.setIndex) {
				action.setIndex(currentElement.highlightIndex);
				this.logger.info(
					`Element moved in DOM, updated index from ${oldIndex} to ${currentElement.highlightIndex}`,
				);
			} else {
				// Fallback: recreate action with new index if setIndex method doesn't exist
				const actionData = action.modelDump ? action.modelDump() : action;
				const actionName = Object.keys(actionData)[0];
				if (!actionName) {
					return null;
				}

				const params = { ...actionData[actionName] };
				params.index = currentElement.highlightIndex;

				// Create new action instance
				const newActionData: Record<string, any> = {};
				newActionData[actionName] = params;
				return new ActionModel(newActionData);
			}
		}

		return action;
	}
	/**
	 * Load history from file and rerun it.
	 *
	 * @param historyFile - Path to the history file
	 * @param options - Additional arguments passed to rerunHistory
	 * @returns List of action results
	 */
	async loadAndRerun(
		historyFile?: string | null,
		options: {
			maxRetries?: number;
			skipFailures?: boolean;
			delayBetweenActions?: number;
		} = {},
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
	 * Save the current history to a file
	 */
	saveHistory(filePath?: string): void {
		if (!filePath) {
			filePath = "AgentHistory.json";
		}
		this.state.history.saveToFile(filePath);
	}

	/**
	 * Wait until the agent is resumed
	 */
	async waitUntilResumed(): Promise<void> {
		await this._externalPauseEvent.wait();
	}
	/**
	 * Pause the agent before the next step.
	 */
	pause(): void {
		console.log(
			"\n\n⏸️  Got [Ctrl+C], paused the agent and left the browser open.\n\tPress [Enter] to resume or [Ctrl+C] again to quit.",
		);
		this.state.paused = true;
		this._externalPauseEvent.clear();

		// Task paused

		// The signal handler will handle the asyncio pause logic for us
		// No need to duplicate the code here
	}

	/**
	 * Resume the agent
	 */
	resume(): void {
		console.log(
			"----------------------------------------------------------------------",
		);
		console.log(
			"▶️  Got Enter, resuming agent execution where it left off...\n",
		);
		this.state.paused = false;
		this._externalPauseEvent.set();
		// Task resumed

		// The signal handler should have already reset the flags
		// through its reset() method when called from run()

		// playwright browser is always immediately killed by the first Ctrl+C (no way to stop that)
		// so we need to restart the browser if user wants to continue
		// the constructor() method exists, even through its shows a linter error

		// Restart browser if needed
		if (this.browser) {
			this.logger.info("🌎 Restarting/reconnecting to browser...");
			// Browser restart logic would go here
		}
	}

	/**
	 * Stop the agent
	 */
	stop(): void {
		this.logger.info("⏹️ Agent stopping");
		this.state.stopped = true;
		// Task stopped
	}

	// Convert dictionary-based actions to ActionModel instances
	private _convertInitialActions(
		actions: Array<Record<string, Record<string, any>>>,
	): ActionModel[] {
		const convertedActions: ActionModel[] = [];

		for (const actionDict of actions) {
			// Each action_dict should have a single key-value pair
			const actionKeys = Object.keys(actionDict);
			if (actionKeys.length === 0) {
				throw new Error("Action dictionary is empty");
			}
			const actionName = actionKeys[0];
			if (!actionName) {
				throw new Error("Action name is undefined");
			}
			const params = actionDict[actionName];

			if (!params) {
				throw new Error(`No parameters found for action: ${actionName}`);
			}

			// Get the parameter model for this action from registry
			const actionInfo =
				this.controller.registry.registry.actions.get(actionName);
			if (!actionInfo) {
				throw new Error(`Unknown action: ${actionName}`);
			}

			const paramModel = actionInfo.paramModel;

			// Validate parameters using the appropriate param model
			let validatedParams: any;
			if (!paramModel) {
				// No parameter model, use params as-is
				validatedParams = params;
			} else if (typeof paramModel.parse === "function") {
				// paramModel is a Zod schema, use parse method
				try {
					validatedParams = paramModel.parse(params);
				} catch (e) {
					throw new Error(`Invalid parameters for action ${actionName}: ${e}`);
				}
			} else if (
				paramModel.paramModel &&
				typeof paramModel.paramModel.parse === "function"
			) {
				// paramModel has a nested paramModel property with the actual Zod schema
				try {
					validatedParams = paramModel.paramModel.parse(params);
				} catch (e) {
					throw new Error(`Invalid parameters for action ${actionName}: ${e}`);
				}
			} else if (typeof paramModel === "function") {
				// paramModel is a constructor function
				const ParamModelConstructor = paramModel as new (args: any) => any;
				validatedParams = new ParamModelConstructor(params);
			} else {
				throw new Error(
					`Invalid parameter model type for action: ${actionName}`,
				);
			}

			// Create ActionModel instance with the validated parameters
			const actionModelData: Record<string, any> = {};
			actionModelData[actionName] = validatedParams;
			const actionModel = new ActionModel(actionModelData);
			convertedActions.push(actionModel);
		}

		return convertedActions;
	}

	/**
	 * Verify that the LLM API keys are setup and the LLM API is responding properly.
	 * Also handles tool calling method detection if in auto mode.
	 */
	private _verifyAndSetupLLM(): void {
		// Skip verification if already done
		if (
			(this.llm as any)._verifiedApiKeys === true ||
			CONFIG.skipLlmApiKeyVerification
		) {
			(this.llm as any)._verifiedApiKeys = true;
			return;
		}

		// Set verified flag
		(this.llm as any)._verifiedApiKeys = true;
	}

	/**
	 * Run the planner to generate a plan for the next step.
	 *
	 * @returns The plan as a string, or null if no planner is set
	 */
	private async _runPlanner(): Promise<string | null> {
		// Skip planning if no planner_llm is set
		if (!this.settings.plannerLLM) {
			return null;
		}

		// Get current state to filter actions by page
		if (!this.browserSession) {
			throw new Error("BrowserSession is not set up");
		}

		const page = await this.browserSession.getCurrentPage();

		// Get all standard actions and page-specific actions
		const standardActions = this.controller.registry.getPromptDescription(); // No page = system prompt actions
		const pageActions = this.controller.registry.getPromptDescription(page); // Page-specific actions

		// Combine both for the planner
		let allActions = standardActions;
		if (pageActions) {
			allActions += "\n" + pageActions;
		}

		// Create planner message history using full message history with all available actions
		const plannerMessages = [
			new PlannerPrompt(allActions).getSystemMessage(
				this.settings.isPlannerReasoning,
				this.settings.extendPlannerSystemMessage,
			),
			...this._messageManager.getMessages().slice(1), // Use full message history except system
		];

		// Remove images from planner messages if vision is disabled
		if (!this.settings.useVisionForPlanner && this.settings.useVision) {
			const lastStateMessage = plannerMessages[plannerMessages.length - 1];
			if (lastStateMessage && Array.isArray(lastStateMessage.content)) {
				let newMsg = "";
				for (const msg of lastStateMessage.content) {
					if (msg.type === "text") {
						newMsg += msg.text;
					}
					// Skip image_url content
				}
				plannerMessages[plannerMessages.length - 1] = {
					...lastStateMessage,
					content: newMsg,
				};
			}
		}

		// Get planner output
		try {
			const response = await this.settings.plannerLLM.ainvoke(plannerMessages);
			let plan = response.completion;

			// Remove think tags for DeepSeek reasoner models
			if (
				this.settings.plannerLLM.model.includes("deepseek-r1") ||
				this.settings.plannerLLM.model.includes("deepseek-reasoner")
			) {
				plan = this._removeThinkTags(plan);
			}

			try {
				const planJson = JSON.parse(plan);
				this.logger.info(
					`Planning Analysis:\n${JSON.stringify(planJson, null, 4)}`,
				);
			} catch (error) {
				this.logger.info(`Planning Analysis:\n${plan}`);
			}

			return plan;
		} catch (error) {
			this.logger.error(`Failed to invoke planner: ${error}`);
			const statusCode =
				(error as any).statusCode || (error as any).code || 500;
			const errorMsg = `Planner LLM API call failed: ${(error as Error).constructor.name}: ${error}`;
			throw new LLMException(statusCode, errorMsg);
		}
	}

	get messageManager(): MessageManager {
		return this._messageManager;
	}

	/**
	 * Close all resources
	 */
	async close(): Promise<void> {
		try {
			if (this.browserSession) {
				await this.browserSession.stop();
			}

			// Force garbage collection if available
			if (global.gc) {
				global.gc();
			}
		} catch (error) {
			this.logger.error(`Error during cleanup: ${error}`);
		}
	}

	/**
	 * Update action models with page-specific actions
	 *
	 * @param page - The current page
	 */
	private async _updateActionModelsForPage(page: any): Promise<void> {
		// Create new action model with current page's filtered actions
		this.ActionModel = this.controller.registry.createActionModel(null, page);

		// Update output model with the new actions
		if (this.settings.useThinking) {
			this.AgentOutput = AgentOutput.typeWithCustomActions(this.ActionModel);
		} else {
			this.AgentOutput = AgentOutput.typeWithCustomActionsNoThinking(
				this.ActionModel,
			);
		}

		// Update done action model too
		this.DoneActionModel = this.controller.registry.createActionModel(
			["done"],
			page,
		);
		if (this.settings.useThinking) {
			this.DoneAgentOutput = AgentOutput.typeWithCustomActions(
				this.DoneActionModel,
			);
		} else {
			this.DoneAgentOutput = AgentOutput.typeWithCustomActionsNoThinking(
				this.DoneActionModel,
			);
		}
	}

	// Private helper methods------------------------------------------------

	private _handleModelSpecificSettings(): void {
		// Handle DeepSeek models
		if (this.llm.model.toLowerCase().includes("deepseek")) {
			this.logger.warn(
				"⚠️ DeepSeek models do not support useVision=true yet. Setting useVision=false for now...",
			);
			this.settings.useVision = false;
		}
		if (
			this.settings.plannerLLM &&
			this.settings.plannerLLM.model.toLowerCase().includes("deepseek")
		) {
			this.logger.warn(
				"⚠️ DeepSeek models do not support useVision=true yet. Setting useVisionForPlanner=false for now...",
			);
			this.settings.useVisionForPlanner = false;
		}

		// Handle XAI models
		if (this.llm.model.toLowerCase().includes("grok")) {
			this.logger.warn(
				"⚠️ XAI models do not support useVision=true yet. Setting useVision=false for now...",
			);
			this.settings.useVision = false;
		}
		if (
			this.settings.plannerLLM &&
			this.settings.plannerLLM.model.toLowerCase().includes("grok")
		) {
			this.logger.warn(
				"⚠️ XAI models do not support useVision=true yet. Setting useVisionForPlanner=false for now...",
			);
			this.settings.useVisionForPlanner = false;
		}
	}

	private _logAgentInitialization(): void {
		this.logger.info(
			`🧠 Starting a browsernode agent ${this.version} with base_model=${this.llm.model}` +
				`${this.settings.useVision ? " +vision" : ""}` +
				` extraction_model=${this.settings.pageExtractionLLM?.model || "Unknown"}` +
				`${this.settings.plannerLLM ? ` planner_model=${this.settings.plannerLLM.model}` : ""}` +
				`${this.settings.isPlannerReasoning ? " +reasoning" : ""}` +
				`${this.settings.useVisionForPlanner ? " +vision" : ""} ` +
				`${this.fileSystem ? " +file_system" : ""}`,
		);
	}

	private _initializeBrowserSession(options: any): void {
		if (options.browserSession instanceof BrowserSession) {
			options.browserSession = options.browserSession || options.browser;
		}

		const browserContext = options.page?.context || options.browserContext;
		const browserProfile = options.browserProfile; // || DEFAULT_BROWSER_PROFILE;

		if (options.browserSession) {
			// Always copy sessions to avoid agents overwriting each other
			if ((options.browserSession as any)._ownsBrowserResources) {
				this.browserSession = options.browserSession;
			} else {
				this.logger.warn(
					"⚠️ Attempting to use multiple Agents with the same BrowserSession! This is not supported yet and will likely lead to strange behavior, use separate BrowserSessions for each Agent.",
				);
				this.browserSession = options.browserSession.modelCopy();
			}
		} else {
			if (options.browser && typeof options.browser.close !== "function") {
				throw new Error("Browser is not set up");
			}

			this.browserSession = new BrowserSession({
				browserProfile,
				browser: options.browser,
				browserContext,
				agentCurrentPage: options.page,
				id: uuidv4().slice(-4) + this.id.slice(-4), // Use same 4-char suffix
			});
		}
	}

	private async _validateSensitiveDataSecurity(): Promise<void> {
		if (!this.sensitiveData) {
			return;
		}

		// Check if sensitive_data has domain-specific credentials
		const hasDomainSpecificCredentials = Object.values(this.sensitiveData).some(
			(v) => typeof v === "object" && v !== null,
		);

		// If no allowed_domains are configured, show security warning
		if (!this.browserProfile.allowedDomains) {
			this.logger.error(
				"⚠️⚠️⚠️ Agent(sensitiveData=••••••••) was provided but BrowserSession(allowedDomains=[...]) is not locked down! ⚠️⚠️⚠️\n" +
					"          ☠️ If the agent visits a malicious website and encounters a prompt-injection attack, your sensitiveData may be exposed!\n\n" +
					"             https://docs.browsernode.com/customize/browser-settings#restrict-urls\n" +
					"Waiting 10 seconds before continuing... Press [Ctrl+C] to abort.",
			);

			if (process.stdin.isTTY) {
				try {
					await this._waitWithKeyboardInterrupt(10000);
				} catch (error) {
					if (error instanceof Error && error.message === "KeyboardInterrupt") {
						console.log(
							'\n\n 🛑 Exiting now... set BrowserSession(allowedDomains=["example.com", "example.org"]) to only domains you trust to see your sensitiveData.',
						);
						process.exit(0);
					}
					throw error;
				}
			} else {
				// no point waiting if we're not in an interactive shell
			}
			this.logger.warn(
				"‼️ Continuing with insecure settings for now... but this will become a hard error in the future!",
			);
		} else if (hasDomainSpecificCredentials) {
			// If we're using domain-specific credentials, validate domain patterns
			// Validate domain patterns for domain-specific credentials
			// For domain-specific format, ensure all domain patterns are included in allowed_domains
			const domainPatterns = Object.keys(this.sensitiveData).filter(
				(k) => typeof this.sensitiveData![k] === "object",
			);

			for (const domainPattern of domainPatterns) {
				let isAllowed = false;
				// Special cases that don't require URL matching
				for (const allowedDomain of this.browserProfile.allowedDomains) {
					if (domainPattern === allowedDomain || allowedDomain === "*") {
						isAllowed = true;
						break;
					}

					// Extract domain parts
					// Need to create example URLs to compare the patterns
					// Extract the domain parts, ignoring scheme
					const patternDomain = domainPattern.includes("://")
						? domainPattern.split("://")[1]
						: domainPattern;
					const allowedDomainPart = allowedDomain.includes("://")
						? allowedDomain.split("://")[1]
						: allowedDomain;

					// Check if pattern is covered by allowed domain
					// Example: "google.com" is covered by "*.google.com"
					if (
						patternDomain === allowedDomainPart ||
						(allowedDomainPart?.startsWith("*.") &&
							(patternDomain === allowedDomainPart.slice(2) ||
								patternDomain?.endsWith("." + allowedDomainPart.slice(2))))
					) {
						isAllowed = true;
						break;
					}
				}

				if (!isAllowed) {
					this.logger.warn(
						`⚠️ Domain pattern "${domainPattern}" in sensitiveData is not covered by any pattern in allowedDomains=${this.browserProfile.allowedDomains}\n` +
							`   This may be a security risk as credentials could be used on unintended domains.`,
					);
				}
			}
		}
	}

	// Utility methods

	private isAsyncFunction(fn: any): boolean {
		return fn && fn.constructor.name === "AsyncFunction";
	}

	private isSubset<T>(subset: Set<T>, superset: Set<T>): boolean {
		for (const item of subset) {
			if (!superset.has(item)) {
				return false;
			}
		}
		return true;
	}

	private async sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private async _waitWithKeyboardInterrupt(ms: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				process.removeListener("SIGINT", interruptHandler);
				resolve();
			}, ms);

			const interruptHandler = () => {
				clearTimeout(timeout);
				process.removeListener("SIGINT", interruptHandler);
				reject(new Error("KeyboardInterrupt"));
			};

			process.on("SIGINT", interruptHandler);
		});
	}

	// Core agent methods

	/**
	 * Save file system state
	 */
	saveFileSystemState(): void {
		if (this.fileSystem) {
			this.state.fileSystemState = this.fileSystem.getState();
		} else {
			this.logger.error("💾 File system is not set up. Cannot save state.");
			throw new Error("File system is not set up. Cannot save state.");
		}
	}

	private _createAsyncEvent() {
		let isSet = false;
		let waiters: Array<() => void> = [];

		return {
			set: () => {
				isSet = true;
				waiters.forEach((resolve) => resolve());
				waiters = [];
			},
			clear: () => {
				isSet = false;
			},
			wait: async (): Promise<void> => {
				if (isSet) {
					return Promise.resolve();
				}
				return new Promise<void>((resolve) => {
					waiters.push(resolve);
				});
			},
		};
	}

	/**
	 * Utility function that raises an InterruptedError if the agent is stopped or paused.
	 */
	private async _raiseIfStoppedOrPaused(): Promise<void> {
		if (this.registerExternalAgentStatusRaiseErrorCallback) {
			if (await this.registerExternalAgentStatusRaiseErrorCallback()) {
				throw new Error("Agent stopped or paused");
			}
		}

		if (this.state.stopped || this.state.paused) {
			// this.logger.debug("---->Agent paused after getting state");
			throw new Error("Agent stopped or paused");
		}
	}
}
