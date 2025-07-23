#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { promisify } from "util";
import blessed from "blessed";
import blessedContrib from "blessed-contrib";
import { config as loadEnv } from "dotenv";
import winston from "winston";

// Load environment variables
loadEnv();

// Check if readline is available
let readlineAvailable = true;
try {
	require("readline");
} catch (error) {
	readlineAvailable = false;
}

process.env["BROWSERNODE_LOGGING_LEVEL"] = "result";

// Import project modules
import { Agent } from "./agent/service";
import { AgentSettings } from "./agent/views";
import { BrowserProfile, BrowserSession } from "./browser/index";
import { CONFIG } from "./config";
import { Controller } from "./controller/service";
import { ChatAnthropic } from "./llm/anthropic/chat";
import { ChatGoogle } from "./llm/google/chat";
import { ChatOpenAI } from "./llm/openai/chat";

const userDataDir = path.join(CONFIG.browsernodeProfilesDir, "cli");

// Default User settings
const maxHistoryLength = 100;

// Ensure directories exist
const configDir = path.dirname(CONFIG.browsernodeConfigFile);
if (!fs.existsSync(configDir)) {
	fs.mkdirSync(configDir, { recursive: true });
}
if (!fs.existsSync(userDataDir)) {
	fs.mkdirSync(userDataDir, { recursive: true });
}

// Logo components with styling for rich panels
const browserLogo = `
				   [white] NNNNNNNN        NNNNNNNN [/]                                
				   [white] N:::::::N       N::::::N [/]                                
				   [white] N::::::::N      N::::::N [/]                                
				   [white] N:::::::::N     N::::::N [/]                                
				   [white] N::::::::::N    N::::::N [/]                                
				   [white] N:::::::::::N   N::::::N [/]                                
				   [white] N:::::::N::::N  N::::::N [/]                                
				   [white] N::::::N N::::N N::::::N [/]                                
				   [white] N::::::N  N::::N:::::::N [/]                                
				   [white] N::::::N   N:::::::::::N [/]                                
				   [white] N::::::N    N::::::::::N [/]                                
				   [white] N::::::N     N:::::::::N [/]                                
				   [white] N::::::N      N::::::::N [/]                                
				   [white] N::::::N       N:::::::N [/]                                
				   [white] N::::::N        N::::::N [/]                                
				   [white] NNNNNNNN         NNNNNNN [/]                                

[white]██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███╗   ██╗ ██████╗ ██████╗ ███████╗[/]
[white]██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗████╗  ██║██╔═══██╗██╔══██╗██╔════╝[/]
[white]██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝██╔██╗ ██║██║   ██║██║  ██║█████╗[/]  
[white]██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗██║╚██╗██║██║   ██║██║  ██║██╔══╝[/]  
[white]██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║██║ ╚████║╚██████╔╝██████╔╝███████╗[/]
[white]╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝[/]
`;

// Common UI constants
const textualBorderStyles = {
	logo: "blue",
	info: "blue",
	input: "orange3",
	working: "yellow",
	completion: "green",
};

interface ConfigModel {
	name?: string;
	temperature: number;
	apiKeys: {
		openaiApiKey?: string;
		anthropicApiKey?: string;
		googleApiKey?: string;
		deepseekApiKey?: string;
		grokApiKey?: string;
	};
}

interface ConfigAgent {
	// AgentSettings properties - using defaults
}

interface ConfigBrowser {
	headless: boolean;
	keepAlive: boolean;
	ignoreHttpsErrors: boolean;
	windowWidth?: number;
	windowHeight?: number;
	userDataDir?: string;
	profileDirectory?: string;
	cdpUrl?: string;
	executablePath?: string;
}

interface Config {
	model: ConfigModel;
	agent: ConfigAgent;
	browser: ConfigBrowser;
	commandHistory: string[];
}

/**Return default configuration object.*/
function getDefaultConfig(): Config {
	return {
		model: {
			name: undefined,
			temperature: 0.0,
			apiKeys: {
				openaiApiKey: CONFIG.openaiApiKey,
				anthropicApiKey: CONFIG.anthropicApiKey,
				googleApiKey: CONFIG.googleApiKey,
				deepseekApiKey: CONFIG.deepseekApiKey,
				grokApiKey: CONFIG.grokApiKey,
			},
		},
		agent: {}, // AgentSettings will use defaults
		browser: {
			headless: true,
			keepAlive: true,
			ignoreHttpsErrors: false,
		},
		commandHistory: [],
	};
}

/**Load user configuration from file.*/
function loadUserConfig(): Config {
	if (!fs.existsSync(CONFIG.browsernodeConfigFile)) {
		// Create default config
		const config = getDefaultConfig();
		saveUserConfig(config);
		return config;
	}

	try {
		const data = JSON.parse(
			fs.readFileSync(CONFIG.browsernodeConfigFile, "utf8"),
		);
		// Ensure data is an object, not an array
		if (Array.isArray(data)) {
			// If it's an array, it's probably just command history from previous version
			const config = getDefaultConfig();
			config.commandHistory = data; // Use the array as command history
			return config;
		}
		return data as Config;
	} catch (error) {
		// If file is corrupted, start with empty config
		if (error instanceof SyntaxError) {
			console.error("Error parsing config file:", error);
		}
		return getDefaultConfig();
	}
}

/**Save user configuration to file.*/
function saveUserConfig(config: Config): void {
	// Ensure command history doesn't exceed maximum length
	if (config.commandHistory && Array.isArray(config.commandHistory)) {
		if (config.commandHistory.length > maxHistoryLength) {
			config.commandHistory = config.commandHistory.slice(-maxHistoryLength);
		}
	}

	fs.writeFileSync(
		CONFIG.browsernodeConfigFile,
		JSON.stringify(config, null, 2),
	);
}

/**Update configuration with command-line arguments.*/
function updateConfigWithClickArgs(config: Config, args: any): Config {
	// Ensure required sections exist
	if (!config.model) {
		config.model = {
			name: undefined,
			temperature: 0.0,
			apiKeys: {},
		};
	}
	if (!config.browser) {
		config.browser = {
			headless: true,
			keepAlive: true,
			ignoreHttpsErrors: false,
		};
	}

	// Update configuration with command-line args if provided
	if (args.model) {
		config.model.name = args.model;
	}
	if (args.headless !== undefined) {
		config.browser.headless = args.headless;
	}
	if (args.windowWidth) {
		config.browser.windowWidth = args.windowWidth;
	}
	if (args.windowHeight) {
		config.browser.windowHeight = args.windowHeight;
	}
	if (args.userDataDir) {
		config.browser.userDataDir = args.userDataDir;
	}
	if (args.profileDirectory) {
		config.browser.profileDirectory = args.profileDirectory;
	}
	if (args.cdpUrl) {
		config.browser.cdpUrl = args.cdpUrl;
	}

	return config;
}

/**Set up readline with command history.*/
function setupReadlineHistory(history: string[]): void {
	if (!readlineAvailable) {
		return;
	}

	// Add history items to readline
	for (const item of history) {
		(readline as any).addHistory(item);
	}
}

/**Get the language model based on config and available API keys.*/
function getLlm(config: Config): any {
	// Set API keys from config if available
	const apiKeys = config.model?.apiKeys || {};
	const modelName = config.model?.name;
	const temperature = config.model?.temperature || 0.0;

	// Set environment variables if they're in the config but not in the environment
	if (apiKeys.openaiApiKey && !CONFIG.openaiApiKey) {
		process.env.OPENAI_API_KEY = apiKeys.openaiApiKey;
	}
	if (apiKeys.anthropicApiKey && !CONFIG.anthropicApiKey) {
		process.env.ANTHROPIC_API_KEY = apiKeys.anthropicApiKey;
	}
	if (apiKeys.googleApiKey && !CONFIG.googleApiKey) {
		process.env.GOOGLE_API_KEY = apiKeys.googleApiKey;
	}

	if (modelName) {
		if (modelName.startsWith("gpt")) {
			if (!CONFIG.openaiApiKey) {
				console.error(
					"⚠️  OpenAI API key not found. Please update your config or set OPENAI_API_KEY environment variable.",
				);
				process.exit(1);
			}
			return new ChatOpenAI({ model: modelName, temperature });
		} else if (modelName.startsWith("claude")) {
			if (!CONFIG.anthropicApiKey) {
				console.error(
					"⚠️  Anthropic API key not found. Please update your config or set ANTHROPIC_API_KEY environment variable.",
				);
				process.exit(1);
			}
			return new ChatAnthropic({ model: modelName, temperature });
		} else if (modelName.startsWith("gemini")) {
			if (!CONFIG.googleApiKey) {
				console.error(
					"⚠️  Google API key not found. Please update your config or set GOOGLE_API_KEY environment variable.",
				);
				process.exit(1);
			}
			return new ChatGoogle({ model: modelName, temperature });
		}
	}

	// Auto-detect based on available API keys
	if (CONFIG.openaiApiKey) {
		return new ChatOpenAI({ model: "gpt-4o", temperature });
	} else if (CONFIG.anthropicApiKey) {
		return new ChatAnthropic({ model: "claude-3.5-sonnet-exp", temperature });
	} else if (CONFIG.googleApiKey) {
		return new ChatGoogle({ model: "gemini-2.0-flash-lite", temperature });
	} else {
		console.error(
			"⚠️  No API keys found. Please update your config or set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY.",
		);
		process.exit(1);
	}
}

/**Custom logging handler that redirects logs to a blessed log widget.*/
class RichLogHandler extends winston.transports.Console {
	private richLog: any;

	constructor(richLog: any) {
		super();
		this.richLog = richLog;
	}

	log(info: any, callback: any) {
		try {
			const msg = this.format?.transform(info);
			this.richLog.log(msg);
		} catch (error) {
			// Handle error
		}
		callback();
	}
}

/**Browsernode TUI application.*/
class BrowsernodeApp extends EventEmitter {
	config: Config;
	browserSession: BrowserSession | null = null;
	controller: Controller | null = null;
	agent: Agent | null = null;
	llm: any = null;
	taskHistory: string[];
	historyIndex: number;
	screen: any;
	widgets: { [key: string]: any } = {};

	constructor(config: Config) {
		super();
		this.config = config;
		this.taskHistory = config.commandHistory || [];
		// Track current position in history for up/down navigation
		this.historyIndex = this.taskHistory.length;
	}

	/**Set up logging to redirect to blessed log widget instead of stdout.*/
	setupRichlogLogging(): void {
		// Try to add RESULT level if it doesn't exist
		try {
			winston.addColors({ result: "cyan" });
		} catch (error) {
			// Level already exists, which is fine
		}

		// Get the blessed log widget
		const richLog = this.widgets.resultsLog;

		// Create and set up the custom handler
		const logHandler = new RichLogHandler(richLog);
		const logType =
			process.env.BROWSERNODE_LOGGING_LEVEL?.toLowerCase() || "result";

		// Set up the formatter based on log type
		if (logType === "result") {
			logHandler.format = winston.format.printf(
				({ message }) => message as string,
			);
		} else {
			logHandler.format = winston.format.printf(
				({ level, message, timestamp }) =>
					`${timestamp} - ${level.toUpperCase()} - ${message}`,
			);
		}

		// Configure winston logger
		winston.configure({
			level: logType === "result" ? "info" : logType,
			transports: [logHandler],
		});

		// Silence third-party loggers
		const silentLoggers = [
			"WDM",
			"httpx",
			"selenium",
			"playwright",
			"urllib3",
			"asyncio",
			"openai",
			"httpcore",
			"charset_normalizer",
			"anthropic._base_client",
			"PIL.PngImagePlugin",
			"trafilatura.htmlprocessing",
			"trafilatura",
		];

		// Note: In winston, we don't have the same fine-grained control over third-party loggers
		// This is a simplified approach
	}

	/**Set up components when app is mounted.*/
	onMount(): void {
		const logger = winston.createLogger({
			level: "debug",
			format: winston.format.combine(
				winston.format.label({ label: "browsernode.onMount" }),
				winston.format.simple(),
			),
			transports: [new winston.transports.Console()],
		});

		logger.debug("onMount() method started");

		// Step 1: Set up custom logging to blessed log
		logger.debug("Setting up blessed log logging...");
		try {
			this.setupRichlogLogging();
			logger.debug("Blessed log logging set up successfully");
		} catch (error) {
			logger.error(`Error setting up blessed log logging: ${error}`);
			throw new Error(`Failed to set up blessed log logging: ${error}`);
		}

		// Step 2: Set up input history
		logger.debug("Setting up readline history...");
		try {
			if (readlineAvailable && this.taskHistory.length > 0) {
				setupReadlineHistory(this.taskHistory);
				logger.debug(
					`Added ${this.taskHistory.length} items to readline history`,
				);
			} else {
				logger.debug("No readline history to set up");
			}
		} catch (error) {
			logger.error(`Error setting up readline history: ${error}`);
			// Non-critical, continue
		}

		// Step 3: Focus the input field
		logger.debug("Focusing input field...");
		try {
			const inputField = this.widgets.taskInput;
			inputField.focus();
			logger.debug("Input field focused");
		} catch (error) {
			logger.error(`Error focusing input field: ${error}`);
			// Non-critical, continue
		}

		// Step 5: Start continuous info panel updates
		logger.debug("Starting info panel updates...");
		try {
			this.updateInfoPanels();
			logger.debug("Info panel updates started");
		} catch (error) {
			logger.error(`Error starting info panel updates: ${error}`);
			// Non-critical, continue
		}

		logger.debug("onMount() completed successfully");
	}

	/**Handle up arrow key in the input field.*/
	onInputKeyUp(event: any): void {
		// Only process if we have history
		if (this.taskHistory.length === 0) {
			return;
		}

		// Move back in history if possible
		if (this.historyIndex > 0) {
			this.historyIndex--;
			const taskInput = this.widgets.taskInput;
			taskInput.setValue(this.taskHistory[this.historyIndex]);
			// Move cursor to end of text
			taskInput.cursor = taskInput.value.length;
		}

		// Prevent default behavior
		event.preventDefault();
	}

	/**Handle down arrow key in the input field.*/
	onInputKeyDown(event: any): void {
		// Only process if we have history
		if (this.taskHistory.length === 0) {
			return;
		}

		// Move forward in history or clear input if at the end
		if (this.historyIndex < this.taskHistory.length - 1) {
			this.historyIndex++;
			const taskInput = this.widgets.taskInput;
			taskInput.setValue(this.taskHistory[this.historyIndex]);
			// Move cursor to end of text
			taskInput.cursor = taskInput.value.length;
		} else if (this.historyIndex === this.taskHistory.length - 1) {
			// At the end of history, go to "new line" state
			this.historyIndex++;
			this.widgets.taskInput.setValue("");
		}

		// Prevent default behavior
		event.preventDefault();
	}

	/**Handle key events at the app level to ensure graceful exit.*/
	async onKey(event: any): Promise<void> {
		// Handle Ctrl+C, Ctrl+D, and Ctrl+Q for app exit
		if (event.full === "C-c" || event.full === "C-d" || event.full === "C-q") {
			await this.actionQuit();
			event.preventDefault();
		}
	}

	/**Handle task input submission.*/
	onInputSubmitted(value: string): void {
		const task = value.trim();
		if (!task) {
			return;
		}

		// Add to history if it's new
		if (
			task &&
			(!this.taskHistory.length ||
				task !== this.taskHistory[this.taskHistory.length - 1])
		) {
			this.taskHistory.push(task);
			this.config.commandHistory = this.taskHistory;
			saveUserConfig(this.config);
		}

		// Reset history index to point past the end of history
		this.historyIndex = this.taskHistory.length;

		// Hide logo, links, and paths panels
		this.hideIntroPanels();

		// Process the task
		this.runTask(task);

		// Clear the input
		this.widgets.taskInput.setValue("");
	}

	/**Hide the intro panels, show info panels, and expand the log view.*/
	hideIntroPanels(): void {
		try {
			// Get the panels
			const logoPanel = this.widgets.logoPanel;
			const linksPanel = this.widgets.linksPanel;
			const pathsPanel = this.widgets.pathsPanel;
			const infoPanels = this.widgets.infoPanels;
			const tasksPanel = this.widgets.tasksPanel;

			// Hide intro panels if they're visible and show info panels
			if (logoPanel.visible) {
				// Log for debugging
				winston.info("Hiding intro panels and showing info panels");

				logoPanel.hide();
				linksPanel.hide();
				pathsPanel.hide();

				// Show info panels
				infoPanels.show();
				tasksPanel.show();

				// Make results container take full height
				const resultsContainer = this.widgets.resultsContainer;
				resultsContainer.height = "100%";

				// Configure the log
				const resultsLog = this.widgets.resultsLog;
				resultsLog.height = "100%";

				winston.info("Panels should now be visible");
			}
		} catch (error) {
			winston.error(`Error in hideIntroPanels: ${error}`);
		}
	}

	/**Update all information panels with current state.*/
	updateInfoPanels(): void {
		try {
			// Update actual content
			this.updateBrowserPanel();
			this.updateModelPanel();
			this.updateTasksPanel();
		} catch (error) {
			winston.error(`Error in updateInfoPanels: ${error}`);
		} finally {
			// Always schedule the next update - will update at 1-second intervals
			// This ensures continuous updates even if agent state changes
			setTimeout(() => this.updateInfoPanels(), 1000);
		}
	}

	/**Update browser information panel with details about the browser.*/
	updateBrowserPanel(): void {
		const browserInfo = this.widgets.browserInfo;
		browserInfo.setContent("");

		// Try to use the agent's browser session if available
		let browserSession = this.browserSession;
		if (this.agent?.browserSession) {
			browserSession = this.agent.browserSession;
		}

		if (browserSession) {
			try {
				// Check if browser session has a browser context
				if (!browserSession.browserContext) {
					browserInfo.setContent(
						"Browser session created, waiting for browser to launch...",
					);
					return;
				}

				// Update our reference if we're using the agent's session
				if (browserSession !== this.browserSession) {
					this.browserSession = browserSession;
				}

				// Get basic browser info from browser_profile
				const browserType = "Chromium";
				const headless = browserSession.browserProfile.headless;

				// Determine connection type based on config
				let connectionType = "playwright"; // Default
				if (browserSession.cdpUrl) {
					connectionType = "CDP";
				} else if (browserSession.wssUrl) {
					connectionType = "WSS";
				} else if (browserSession.browserProfile.executablePath) {
					connectionType = "user-provided";
				}

				// Get window size details from browser_profile
				let windowWidth: number | undefined;
				let windowHeight: number | undefined;
				if (browserSession.browserProfile.viewport) {
					windowWidth = browserSession.browserProfile.viewport.width;
					windowHeight = browserSession.browserProfile.viewport.height;
				}

				// Try to get browser PID
				let browserPid = "Unknown";
				let connected = false;
				let browserStatus = "Disconnected";

				try {
					// Check if browser PID is available
					if (browserSession.browserPid) {
						browserPid = browserSession.browserPid.toString();
						connected = true;
						browserStatus = "Connected";
					}
					// Otherwise just check if we have a browser context
					else if (browserSession.browserContext) {
						connected = true;
						browserStatus = "Connected";
						browserPid = "N/A";
					}
				} catch (error) {
					browserPid = `Error: ${error}`;
				}

				// Display browser information
				let content = `Chromium Browser (${browserStatus})\n`;
				content += `Type: ${connectionType}${headless ? " (headless)" : ""}\n`;
				content += `PID: ${browserPid}\n`;
				content += `CDP Port: ${browserSession.cdpUrl}\n`;

				if (windowWidth && windowHeight) {
					content += `Window: ${windowWidth} × ${windowHeight}\n`;
				}

				// Include additional information about the browser if needed
				if (connected && this.agent) {
					try {
						// Show when the browser was connected
						const currentTime = new Date().toLocaleTimeString();
						content += `Last updated: ${currentTime}\n`;
					} catch (error) {
						// Continue
					}

					// Show the agent's current page URL if available
					if (browserSession.agentCurrentPage) {
						let currentUrl = browserSession.agentCurrentPage
							.url()
							.replace("https://", "")
							.replace("http://", "")
							.replace("www.", "");
						if (currentUrl.length > 36) {
							currentUrl = currentUrl.substring(0, 36) + "…";
						}
						content += `👁️  ${currentUrl}\n`;
					}
				}

				browserInfo.setContent(content);
			} catch (error) {
				browserInfo.setContent(`Error updating browser info: ${error}`);
			}
		} else {
			browserInfo.setContent("Browser not initialized");
		}
	}

	/**Update model information panel with details about the LLM.*/
	updateModelPanel(): void {
		const modelInfo = this.widgets.modelInfo;
		modelInfo.setContent("");

		if (this.llm) {
			// Get model details
			let modelName = "Unknown";
			if (this.llm.modelName) {
				modelName = this.llm.modelName;
			} else if (this.llm.model) {
				modelName = this.llm.model;
			}

			let content = "";

			// Show model name
			if (this.agent) {
				const tempStr = this.llm.temperature
					? `${this.llm.temperature}ºC `
					: "";
				const visionStr = this.agent.settings.useVision ? "+ vision " : "";
				const plannerStr = this.agent.settings.plannerLLM ? "+ planner" : "";
				content += `LLM: ${this.llm.constructor.name} ${modelName} ${tempStr}${visionStr}${plannerStr}\n`;
			} else {
				content += `LLM: ${this.llm.constructor.name} ${modelName}\n`;
			}

			// Show token usage statistics if agent exists and has history
			if (this.agent?.state?.history) {
				// Calculate tokens per step
				const numSteps = this.agent.state.history.history.length;

				if (numSteps > 0) {
					const lastStep = this.agent.state.history.history[numSteps - 1];
					let stepDuration = 0;
					if (lastStep && lastStep.metadata) {
						stepDuration = lastStep.metadata.durationSeconds || 0;
					}

					// Show total duration
					const totalDuration = this.agent.state.history.totalDurationSeconds();
					if (totalDuration > 0) {
						content += `Total Duration: ${totalDuration.toFixed(2)}s\n`;
						content += `Last Step Duration: ${stepDuration.toFixed(2)}s\n`;
					}

					// Add current state information
					if (this.agent.running) {
						content += "LLM is thinking...\n";
					} else if (this.agent.state.paused) {
						content += "LLM paused\n";
					}
				}
			}

			modelInfo.setContent(content);
		} else {
			modelInfo.setContent("Model not initialized");
		}
	}

	/**Update tasks information panel with details about the tasks and steps hierarchy.*/
	updateTasksPanel(): void {
		const tasksInfo = this.widgets.tasksInfo;
		tasksInfo.setContent("");

		if (this.agent) {
			// Check if agent has tasks
			let content = "";
			const messageHistory: any[] = [];

			// Try to extract tasks by looking at message history
			if (this.agent.messageManager?.state?.history?.messages) {
				const messages = this.agent.messageManager.state.history.messages;

				// Extract original task(s)
				const originalTasks: string[] = [];
				for (const msg of messages) {
					if (
						msg.content &&
						typeof msg.content === "string" &&
						msg.content.includes("Your ultimate task is:")
					) {
						const taskText = msg.content.split('"""')[1]?.trim();
						if (taskText) {
							originalTasks.push(taskText);
						}
					}
				}

				if (originalTasks.length > 0) {
					content += "TASK:\n";
					for (let i = 0; i < originalTasks.length; i++) {
						// Only show latest task if multiple task changes occurred
						if (i === originalTasks.length - 1) {
							content += `${originalTasks[i]}\n\n`;
						}
					}
				}
			}

			// Get current state information
			const currentStep = this.agent.state?.nSteps || 0;

			// Get all agent history items
			const historyItems: any[] = [];
			if (this.agent.state?.history?.history) {
				const history = this.agent.state.history.history;

				if (history.length > 0) {
					content += "STEPS:\n";

					for (let idx = 0; idx < history.length; idx++) {
						const item = history[idx];
						const stepNum = idx + 1;

						// Determine step status
						let stepStyle = "✓";

						// For the current step, show it as in progress
						if (stepNum === currentStep) {
							stepStyle = "⟳";
						}

						// Check if this step had an error
						if (
							item &&
							item.result &&
							item.result.some((result: any) => result.error)
						) {
							stepStyle = "✗";
						}

						// Show step number
						content += `${stepStyle} Step ${stepNum}/${currentStep}\n`;

						// Show goal if available
						if (item && item.modelOutput?.currentState) {
							// Show goal for this step
							const goal = item.modelOutput.currentState.nextGoal;
							if (goal) {
								// Take just the first line for display
								const goalLines = goal.trim().split("\n");
								const goalSummary = goalLines[0];
								content += `   Goal: ${goalSummary}\n`;
							}

							// Show evaluation of previous goal (feedback)
							const evalPrev =
								item.modelOutput.currentState.evaluationPreviousGoal;
							if (evalPrev && stepNum > 1) {
								// Only show for steps after the first
								const evalLines = evalPrev.trim().split("\n");
								let evalSummary = evalLines[0];
								evalSummary = evalSummary!
									.replace("Success", "✅ ")
									.replace("Failed", "❌ ")
									.trim();
								content += `   Evaluation: ${evalSummary}\n`;
							}
						}

						// Show actions taken in this step
						if (item && item.modelOutput?.action) {
							content += "   Actions:\n";
							for (
								let actionIdx = 0;
								actionIdx < item.modelOutput.action.length;
								actionIdx++
							) {
								const action = item.modelOutput.action[actionIdx];
								const actionType = action?.constructor.name;
								if (action && action.modelDump) {
									// For proper actions, show the action type
									const actionDict = action.modelDump({ excludeUnset: true });
									if (Object.keys(actionDict).length > 0) {
										const actionName = Object.keys(actionDict)[0];
										content += `     ${actionIdx + 1}. ${actionName}\n`;
									}
								}
							}
						}

						// Show results or errors from this step
						if (item && item.result) {
							for (const result of item.result) {
								if (result.error) {
									content += `   Error: ${result.error}\n`;
								} else if (result.extractedContent) {
									content += `   Result: ${result.extractedContent}\n`;
								}
							}
						}

						// Add a space between steps for readability
						content += "\n";
					}
				}
			}

			// If agent is actively running, show a status indicator
			if (this.agent.running) {
				content += "Agent is actively working...\n";
			} else if (this.agent.state?.paused) {
				content += "Agent is paused (press Enter to resume)\n";
			}

			tasksInfo.setContent(content);
		} else {
			tasksInfo.setContent("Agent not initialized");
		}

		// Force scroll to bottom
		const tasksPanel = this.widgets.tasksPanel;
		tasksPanel.scrollTo(tasksPanel.getScrollHeight());
	}

	/**Scroll to the input field to ensure it's visible.*/
	scrollToInput(): void {
		const inputContainer = this.widgets.taskInputContainer;
		inputContainer.scrollIntoView();
	}

	/**Launch the task in a background worker.*/
	runTask(task: string): void {
		// Create or update the agent
		const agentSettings = this.config.agent as AgentSettings;
		// Get the logger
		const logger = winston.createLogger({
			level: "debug",
			format: winston.format.combine(
				winston.format.label({ label: "browsernode.app" }),
				winston.format.simple(),
			),
			transports: [new winston.transports.Console()],
		});

		// Make sure intro is hidden and log is ready
		this.hideIntroPanels();

		// Start continuous updates of all info panels
		this.updateInfoPanels();

		// Clear the log to start fresh
		const richLog = this.widgets.resultsLog;
		richLog.setContent("");

		if (!this.agent) {
			if (!this.llm) {
				throw new Error("LLM not initialized");
			}
			this.agent = new Agent(task, this.llm, {
				controller: this.controller || new Controller(),
				browserSession: this.browserSession!,
				source: "cli",
				...agentSettings,
			});
			// Update our browser_session reference to point to the agent's
			if (this.agent.browserSession) {
				this.browserSession = this.agent.browserSession;
			}
		} else {
			this.agent.addNewTask(task);
		}

		// Let the agent run in the background
		const agentTaskWorker = async (): Promise<void> => {
			logger.debug(`\n🚀 Working on task: ${task}`);

			// Set flags to indicate the agent is running
			if (this.agent) {
				this.agent.running = true;
				this.agent.lastResponseTime = 0;
			}

			// Panel updates are already happening via the timer in updateInfoPanels

			try {
				// Run the agent task, redirecting output to blessed log through our handler
				if (this.agent) {
					await this.agent.run();
				}
			} catch (error) {
				logger.error(`\nError running agent: ${error}`);
			} finally {
				// Clear the running flag
				if (this.agent) {
					(this.agent as any).running = false;
				}

				// No need to call updateInfoPanels() here as it's already updating via timer

				logger.debug("\n✅ Task completed!");

				// Make sure the task input container is visible
				const taskInputContainer = this.widgets.taskInputContainer;
				taskInputContainer.show();

				// Refocus the input field
				const inputField = this.widgets.taskInput;
				inputField.focus();

				// Ensure the input is visible by scrolling to it
				setTimeout(() => this.scrollToInput(), 100);
			}
		};

		// Run the worker
		agentTaskWorker();
	}

	/**Navigate to the previous item in command history.*/
	actionInputHistoryPrev(): void {
		// Only process if we have history and input is focused
		const inputField = this.widgets.taskInput;
		if (!inputField.focused || this.taskHistory.length === 0) {
			return;
		}

		// Move back in history if possible
		if (this.historyIndex > 0) {
			this.historyIndex--;
			inputField.setValue(this.taskHistory[this.historyIndex]);
			// Move cursor to end of text
			inputField.cursor = inputField.value.length;
		}
	}

	/**Navigate to the next item in command history or clear input.*/
	actionInputHistoryNext(): void {
		// Only process if we have history and input is focused
		const inputField = this.widgets.taskInput;
		if (!inputField.focused || this.taskHistory.length === 0) {
			return;
		}

		// Move forward in history or clear input if at the end
		if (this.historyIndex < this.taskHistory.length - 1) {
			this.historyIndex++;
			inputField.setValue(this.taskHistory[this.historyIndex]);
			// Move cursor to end of text
			inputField.cursor = inputField.value.length;
		} else if (this.historyIndex === this.taskHistory.length - 1) {
			// At the end of history, go to "new line" state
			this.historyIndex++;
			inputField.setValue("");
		}
	}

	/**Quit the application and clean up resources.*/
	async actionQuit(): Promise<void> {
		// Close the browser session if it exists
		if (this.browserSession) {
			try {
				await this.browserSession.close();
				winston.debug("Browser session closed successfully");
			} catch (error) {
				winston.error(`Error closing browser session: ${error}`);
			}
		}

		// Exit the application
		process.exit(0);
	}

	/**Create the UI layout.*/
	compose(): void {
		// Create screen
		this.screen = blessed.screen({
			smartCSR: true,
			title: "BrowserNode CLI",
		});

		// Main container for app content
		const mainContainer = blessed.box({
			parent: this.screen,
			top: 0,
			left: 0,
			width: "100%",
			height: "100%",
			border: {
				type: "line",
			},
			style: {
				border: {
					fg: "blue",
				},
			},
		});

		// Logo panel
		const logoPanel = blessed.box({
			parent: mainContainer,
			top: 0,
			left: 0,
			width: "100%",
			height: "50%",
			content: browserLogo,
			tags: true,
			style: {
				border: {
					fg: "blue",
				},
			},
		});
		this.widgets.logoPanel = logoPanel;

		// Information panels (hidden by default)
		const infoPanels = blessed.box({
			parent: mainContainer,
			top: 0,
			left: 0,
			width: "100%",
			height: "50%",
			hidden: true,
		});
		this.widgets.infoPanels = infoPanels;

		// Browser panel
		const browserPanel = blessed.box({
			parent: infoPanels,
			top: 0,
			left: 0,
			width: "50%",
			height: "50%",
			border: {
				type: "line",
			},
			style: {
				border: {
					fg: "blue",
				},
			},
		});

		const browserInfo = blessed.log({
			parent: browserPanel,
			top: 0,
			left: 0,
			width: "100%",
			height: "100%",
			tags: true,
			scrollable: true,
		});
		this.widgets.browserInfo = browserInfo;

		// Model panel
		const modelPanel = blessed.box({
			parent: infoPanels,
			top: 0,
			left: "50%",
			width: "50%",
			height: "50%",
			border: {
				type: "line",
			},
			style: {
				border: {
					fg: "blue",
				},
			},
		});

		const modelInfo = blessed.log({
			parent: modelPanel,
			top: 0,
			left: 0,
			width: "100%",
			height: "100%",
			tags: true,
			scrollable: true,
		});
		this.widgets.modelInfo = modelInfo;

		// Tasks panel (full width, below browser and model)
		const tasksPanel = blessed.box({
			parent: infoPanels,
			top: "50%",
			left: 0,
			width: "100%",
			height: "50%",
			border: {
				type: "line",
			},
			style: {
				border: {
					fg: "blue",
				},
			},
			hidden: true,
		});

		const tasksInfo = blessed.log({
			parent: tasksPanel,
			top: 0,
			left: 0,
			width: "100%",
			height: "100%",
			tags: true,
			scrollable: true,
		});
		this.widgets.tasksInfo = tasksInfo;
		this.widgets.tasksPanel = tasksPanel;

		// Links panel with URLs
		const linksPanel = blessed.box({
			parent: mainContainer,
			top: "50%",
			left: 0,
			width: "100%",
			height: "25%",
			content: `Run at scale on cloud:    ☁️  https://browsernode.com
Chat & share on Discord:  🚀  https://discord.gg/ESAUZAdxXY
Get prompt inspiration:   🦸  https://github.com/browsernode/awesome-prompts
Report any issues:        🐛  https://github.com/browsernode/browsernode/issues`,
			tags: true,
			border: {
				type: "line",
			},
			style: {
				border: {
					fg: "blue",
				},
			},
		});
		this.widgets.linksPanel = linksPanel;

		// Paths panel
		const pathsPanel = blessed.box({
			parent: mainContainer,
			top: "75%",
			left: 0,
			width: "100%",
			height: "15%",
			content: ` ⚙️  Settings & history saved to:    ${CONFIG.browsernodeConfigFile.replace(os.homedir(), "~")}
 📁 Outputs & recordings saved to:  ${process.cwd().replace(os.homedir(), "~")}`,
			tags: true,
			border: {
				type: "line",
			},
			style: {
				border: {
					fg: "blue",
				},
			},
		});
		this.widgets.pathsPanel = pathsPanel;

		// Results view with scrolling (place this before input to make input sticky at bottom)
		const resultsContainer = blessed.box({
			parent: mainContainer,
			top: "90%",
			left: 0,
			width: "100%",
			height: "8%",
			hidden: true,
		});

		const resultsLog = blessed.log({
			parent: resultsContainer,
			top: 0,
			left: 0,
			width: "100%",
			height: "100%",
			tags: true,
			scrollable: true,
		});
		this.widgets.resultsLog = resultsLog;
		this.widgets.resultsContainer = resultsContainer;

		// Task input container (now at the bottom)
		const taskInputContainer = blessed.box({
			parent: mainContainer,
			bottom: 0,
			left: 0,
			width: "100%",
			height: "10%",
			border: {
				type: "line",
			},
			style: {
				border: {
					fg: "orange",
				},
			},
		});

		const taskLabel = blessed.text({
			parent: taskInputContainer,
			top: 0,
			left: 0,
			width: "100%",
			height: 1,
			content: "🔍 What would you like me to do on the web?",
			tags: true,
		});

		const taskInput = blessed.textbox({
			parent: taskInputContainer,
			top: 1,
			left: 0,
			width: "100%",
			height: 1,
			inputOnFocus: true,
			keys: true,
			vi: true,
		});

		this.widgets.taskInput = taskInput;
		this.widgets.taskInputContainer = taskInputContainer;

		// Set up event handlers
		taskInput.on("submit", (value: any) => {
			this.onInputSubmitted(value);
		});

		taskInput.on("keypress", (ch: any, key: any) => {
			if (key.name === "up") {
				this.onInputKeyUp(key);
			} else if (key.name === "down") {
				this.onInputKeyDown(key);
			}
		});

		this.screen.key(["C-c", "C-q", "C-d"], async () => {
			await this.actionQuit();
		});

		// Focus the input
		taskInput.focus();

		// Render the screen
		this.screen.render();
	}

	/**Run the application.*/
	async runAsync(): Promise<void> {
		this.compose();
		this.onMount();

		// Keep the application running
		return new Promise((resolve) => {
			this.screen.key(["C-c"], () => {
				resolve();
			});
		});
	}
}

/**Run browsernode in non-interactive mode with a single prompt.*/
async function runPromptMode(
	prompt: string,
	args: any,
	debug: boolean = false,
): Promise<void> {
	// Set up logging to only show results by default
	process.env.BROWSERNODE_LOGGING_LEVEL = "result";

	// Configure winston for result-only logging
	winston.configure({
		level: "info",
		format: winston.format.simple(),
		transports: [new winston.transports.Console()],
	});

	try {
		// Load config
		let config = loadUserConfig();
		config = updateConfigWithClickArgs(config, args);

		// Get LLM
		const llm = getLlm(config);

		// Get agent settings from config
		const agentSettings = config.agent as AgentSettings;

		// Create browser session with config parameters
		const browserConfig = config.browser;
		// Create BrowserProfile with userDataDir
		const profile = new BrowserProfile({
			userDataDir: userDataDir,
			...browserConfig,
		});
		const browserSession = new BrowserSession({
			browserProfile: profile,
		});

		// Create and run agent
		const agent = new Agent(prompt, llm, {
			browserSession,
			source: "cli",
			...(agentSettings as AgentSettings),
		});

		await agent.run();

		// Close browser session
		await browserSession.close();
	} catch (error) {
		if (debug) {
			console.error(error);
		} else {
			console.error(`Error: ${error}`);
		}
		process.exit(1);
	}
}

/**Run the blessed interface.*/
async function textualInterface(config: Config): Promise<void> {
	const logger = winston.createLogger({
		level: "debug",
		format: winston.format.simple(),
		transports: [new winston.transports.Console()],
	});

	// Set up logging for blessed UI - prevent any logging to stdout
	function setupTextualLogging(): void {
		// Configure winston to use null transport during UI
		winston.configure({
			level: "error",
			transports: [new winston.transports.Console({ silent: true })],
		});
		logger.debug("Logging configured for blessed UI");
	}

	logger.debug("Setting up Browser, Controller, and LLM...");

	// Step 1: Initialize BrowserSession with config
	logger.debug("Initializing BrowserSession...");
	let browserSession: BrowserSession;
	try {
		// Get browser config from the config object
		const browserConfig = config.browser;

		logger.info("Browser type: chromium"); // BrowserSession only supports chromium
		if (browserConfig.executablePath) {
			logger.info(`Browser binary: ${browserConfig.executablePath}`);
		}
		if (browserConfig.headless) {
			logger.info("Browser mode: headless");
		} else {
			logger.info("Browser mode: visible");
		}

		// Create BrowserSession directly with config parameters
		// Create BrowserProfile with userDataDir
		const profile = new BrowserProfile({
			userDataDir: userDataDir,
			...browserConfig,
		});
		browserSession = new BrowserSession({
			browserProfile: profile,
		});
		logger.debug("BrowserSession initialized successfully");

		// Log browser version if available
		try {
			if (browserSession.browser) {
				const version = await browserSession.browser.version();
				logger.info(`Browser version: ${version}`);
			}
		} catch (error) {
			logger.debug(`Could not determine browser version: ${error}`);
		}
	} catch (error) {
		logger.error(`Error initializing BrowserSession: ${error}`);
		throw new Error(`Failed to initialize BrowserSession: ${error}`);
	}

	// Step 3: Initialize Controller
	logger.debug("Initializing Controller...");
	let controller: Controller;
	try {
		controller = new Controller();
		logger.debug("Controller initialized successfully");
	} catch (error) {
		logger.error(`Error initializing Controller: ${error}`);
		throw new Error(`Failed to initialize Controller: ${error}`);
	}

	// Step 4: Get LLM
	logger.debug("Getting LLM...");
	let llm: any;
	try {
		llm = getLlm(config);
		// Log LLM details
		const modelName = llm.modelName || llm.model || "Unknown model";
		const provider = llm.constructor.name;
		const temperature = llm.temperature || 0.0;
		logger.info(`LLM: ${provider} (${modelName}), temperature: ${temperature}`);
		logger.debug(`LLM initialized successfully: ${provider}`);
	} catch (error) {
		logger.error(`Error getting LLM: ${error}`);
		throw new Error(`Failed to initialize LLM: ${error}`);
	}

	logger.debug("Initializing BrowsernodeApp instance...");
	try {
		const app = new BrowsernodeApp(config);
		// Pass the initialized components to the app
		app.browserSession = browserSession;
		app.controller = controller;
		app.llm = llm;

		// Configure logging for blessed UI before going fullscreen
		setupTextualLogging();

		// Log browser and model configuration that will be used
		const browserType = "Chromium"; // BrowserSession only supports Chromium
		const modelName = config.model.name || "auto-detected";
		const headless = config.browser.headless;
		const headlessStr = headless ? "headless" : "visible";

		logger.info(
			`Preparing ${browserType} browser (${headlessStr}) with ${modelName} LLM`,
		);

		logger.debug("Starting blessed app with runAsync()...");
		// No more logging after this point as we're in fullscreen mode
		await app.runAsync();
	} catch (error) {
		logger.error(`Error in textualInterface: ${error}`);
		// Make sure to close browser session if app initialization fails
		await browserSession.close();
		throw error;
	}
}

// Main function using yargs
async function main(): Promise<void> {
	const argv = await yargs(hideBin(process.argv))
		.option("version", {
			type: "boolean",
			description: "Print version and exit",
		})
		.option("model", {
			type: "string",
			description:
				"Model to use (e.g., gpt-4o, claude-3-opus-20240229, gemini-pro)",
		})
		.option("debug", {
			type: "boolean",
			description: "Enable verbose startup logging",
		})
		.option("headless", {
			type: "boolean",
			description: "Run browser in headless mode",
		})
		.option("window-width", {
			type: "number",
			description: "Browser window width",
		})
		.option("window-height", {
			type: "number",
			description: "Browser window height",
		})
		.option("user-data-dir", {
			type: "string",
			description: "Path to Chrome user data directory",
		})
		.option("profile-directory", {
			type: "string",
			description: "Chrome profile directory name",
		})
		.option("cdp-url", {
			type: "string",
			description: "Connect to existing Chrome via CDP URL",
		})
		.option("prompt", {
			alias: "p",
			type: "string",
			description: "Run a single task without the TUI (headless mode)",
		})
		.help()
		.parse();

	if (argv.version) {
		const packageJson = JSON.parse(
			fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"),
		);
		console.log(packageJson.version);
		process.exit(0);
	}

	// Check if prompt mode is activated
	if (argv.prompt) {
		// Set environment variable for prompt mode before running
		process.env.BROWSERNODE_LOGGING_LEVEL = "result";
		// Run in non-interactive mode
		await runPromptMode(argv.prompt, argv, argv.debug);
		return;
	}

	// Configure console logging
	winston.configure({
		level: argv.debug ? "debug" : "info",
		format: winston.format.combine(
			winston.format.timestamp({ format: "HH:mm:ss" }),
			winston.format.printf(({ timestamp, level, message }) => {
				return `${timestamp} - ${level.toUpperCase()} - ${message}`;
			}),
		),
		transports: [new winston.transports.Console()],
	});

	winston.info("Starting BrowserNode initialization");
	if (argv.debug) {
		winston.debug(
			`System info: Node ${process.version}, Platform: ${process.platform}`,
		);
	}

	winston.debug("Loading environment variables from .env file...");
	loadEnv();
	winston.debug("Environment variables loaded");

	// Load user configuration
	winston.debug("Loading user configuration...");
	let config: Config;
	try {
		config = loadUserConfig();
		winston.debug(
			`User configuration loaded from ${CONFIG.browsernodeConfigFile}`,
		);
	} catch (error) {
		winston.error(`Error loading user configuration: ${error}`);
		console.error(`Error loading configuration: ${error}`);
		process.exit(1);
	}

	// Update config with command-line arguments
	winston.debug("Updating configuration with command line arguments...");
	try {
		config = updateConfigWithClickArgs(config, argv);
		winston.debug("Configuration updated");
	} catch (error) {
		winston.error(`Error updating config with command line args: ${error}`);
		console.error(`Error updating configuration: ${error}`);
		process.exit(1);
	}

	// Save updated config
	winston.debug("Saving user configuration...");
	try {
		saveUserConfig(config);
		winston.debug("Configuration saved");
	} catch (error) {
		winston.error(`Error saving user configuration: ${error}`);
		console.error(`Error saving configuration: ${error}`);
		process.exit(1);
	}

	// Setup handlers for console output before entering blessed UI
	winston.debug("Setting up handlers for blessed UI...");

	// Log browser and model configuration that will be used
	const browserType = "Chromium"; // BrowserSession only supports Chromium
	const modelName = config.model.name || "auto-detected";
	const headless = config.browser.headless;
	const headlessStr = headless ? "headless" : "visible";

	winston.info(
		`Preparing ${browserType} browser (${headlessStr}) with ${modelName} LLM`,
	);

	try {
		// Run the blessed UI interface - now all the initialization happens before we go fullscreen
		winston.debug("Starting blessed UI interface...");
		await textualInterface(config);
	} catch (error) {
		// Restore console logging for error reporting
		winston.configure({
			level: "info",
			transports: [new winston.transports.Console()],
		});

		winston.error(`Error initializing BrowserNode: ${error}`);
		console.error(`\nError launching BrowserNode: ${error}`);
		if (argv.debug) {
			console.error(error);
		}
		process.exit(1);
	}
}

// Run the main function
if (
	process.argv[1]?.endsWith("cli.js") ||
	process.argv[1]?.endsWith("cli.ts")
) {
	main().catch((error) => {
		console.error("Fatal error:", error);
		process.exit(1);
	});
}
