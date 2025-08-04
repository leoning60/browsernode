import { exec, spawn } from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { setTimeout } from "timers/promises";

import type { BrowserType as PatchrightBrowserType } from "patchright";
import { chromium as PatchrightChromium } from "patchright";
import type { BrowserType as PlaywrightBrowserType } from "playwright";
import { chromium as PlaywrightChromium } from "playwright";

import { v4 as uuidv4 } from "uuid";
import { Logger } from "winston";
import { modelCopy, modelDump } from "../bn_utils";
import { CONFIG } from "../config";
import { ClickableElementProcessor } from "../dom/clickable_element_processor/service";
import { DomService } from "../dom/service";
import { DOMElementNode, type SelectorMap } from "../dom/views";
import bnLogger from "../logging_config";
import {
	isSignalHandlerActive,
	logPrettyPath,
	logPrettyUrl,
	matchUrlWithDomainPattern,
	mergeDicts,
	retry,
	timeExecution,
} from "../utils";
import {
	BROWSERNODE_DEFAULT_CHANNEL,
	BrowserChannel,
	BrowserProfile,
} from "./profile";
import type {
	Browser,
	BrowserContext,
	ElementHandle,
	FrameLocator,
	Page,
	PlaywrightOrPatchrightChromium,
} from "./types";
import { normalizeUrl } from "./utils";
import {
	BrowserError,
	BrowserStateSummary,
	TabInfo,
	URLNotAllowedError,
} from "./views";

const logger: Logger = bnLogger.child({
	module: "browsernode/browser/session",
});

// Set environment variable to workaround Playwright font issue
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1"; // https://github.com/microsoft/playwright/issues/35972

let globWarningShown = false; // used inside _isUrlAllowed to avoid spamming the logs with the same warning multiple times
// Global state for playwright instances
let globalPlaywrightApiObject: any = null;
let globalPatchrightApiObject: any = null;

// Track if shutdown hooks have been registered
let shutdownHooksRegistered = false;

/**
 * Register a shutdown hook to stop the shared global playwright node.js client when the program exits
 *
 * TypeScript differences:
 * - Uses process.on() events instead of atexit.register()
 * - Handles multiple exit scenarios (SIGINT, SIGTERM, etc.)
 * - No explicit playwright.stop() call needed in Node.js
 * - Uses global variables instead of instance variables
 */
function registerShutdownHooks(): void {
	if (shutdownHooksRegistered) {
		return;
	}
	shutdownHooksRegistered = true;

	/**
	 * Shutdown function for playwright instances
	 */
	const shutdownPlaywright = async (): Promise<void> => {
		// Shutdown playwright instance
		if (globalPlaywrightApiObject) {
			try {
				logger.debug(
					"🛑 Shutting down shared global playwright node.js client",
				);
				// Note: Unlike Python's playwright.stop(), Node.js playwright doesn't require explicit stop()
				// The instances are automatically cleaned up when the process exits
				// We set to null to help with garbage collection and prevent further use
				globalPlaywrightApiObject = null;
			} catch (error: any) {
				// Ignore errors during shutdown
				logger.debug(`Error during playwright shutdown: ${error.message}`);
			}
		}

		// Shutdown patchright instance
		if (globalPatchrightApiObject) {
			try {
				logger.debug(
					"🛑 Shutting down shared global patchright node.js client",
				);
				globalPatchrightApiObject = null;
			} catch (error: any) {
				// Ignore errors during shutdown
				logger.debug(`Error during patchright shutdown: ${error.message}`);
			}
		}
	};

	/**
	 * Synchronous version for exit event (which only allows sync code)
	 */
	const shutdownPlaywrightSync = (): void => {
		if (globalPlaywrightApiObject) {
			logger.debug(
				"🛑 Shutting down shared global playwright node.js client (sync)",
			);
			globalPlaywrightApiObject = null;
		}
		if (globalPatchrightApiObject) {
			logger.debug(
				"🛑 Shutting down shared global patchright node.js client (sync)",
			);
			globalPatchrightApiObject = null;
		}
	};

	// Register shutdown hooks for various exit scenarios
	// beforeExit allows async operations
	process.on("beforeExit", async () => {
		await shutdownPlaywright();
	});

	// exit event only allows synchronous operations
	process.on("exit", () => {
		shutdownPlaywrightSync();
	});

	// Handle Ctrl+C (SIGINT)
	process.on("SIGINT", async () => {
		// Check if there's an active SignalHandler managing pause/resume logic
		if (isSignalHandlerActive()) {
			// Let the SignalHandler handle this, don't force exit
			logger.debug(
				"Active SignalHandler detected, skipping browser shutdown hooks",
			);
			return;
		}
		await shutdownPlaywright();
		process.exit(0);
	});

	// Handle termination signal (SIGTERM)
	process.on("SIGTERM", async () => {
		await shutdownPlaywright();
		process.exit(0);
	});

	// Handle unhandled promise rejections
	process.on("unhandledRejection", async (reason, promise) => {
		logger.error("Unhandled Rejection at:", promise, "reason:", reason);
		await shutdownPlaywright();
		process.exit(1);
	});

	// Handle uncaught exceptions
	process.on("uncaughtException", async (error) => {
		logger.error("Uncaught Exception thrown:", error);
		await shutdownPlaywright();
		process.exit(1);
	});
}

/**
 * Global FinalizationRegistry for automatic cleanup
 *
 * __del__ is called when an object is garbage collected, allowing for automatic cleanup.
 * In TypeScript/JavaScript, FinalizationRegistry provides similar functionality, though it's not
 * guaranteed to run and should not be relied upon for critical cleanup.
 *
 * This registry automatically kills browser processes when BrowserSession objects are garbage collected,
 * but proper cleanup should still be done by calling .stop() or .dispose() explicitly.
 */
const browserSessionFinalizationRegistry = new FinalizationRegistry(
	(heldValue: {
		id: string;
		browserPid?: number;
		keepAlive?: boolean;
		ownsBrowser: boolean;
		logger: any;
	}) => {
		// This runs when a BrowserSession is garbage collected
		const { id, browserPid, keepAlive, ownsBrowser, logger } = heldValue;

		if (ownsBrowser && browserPid && !keepAlive) {
			const status = `🪓 killing pid=${browserPid}...`;
			logger.debug(`🗑️ Auto-cleanup BrowserSession 🆂 ${id.slice(-4)} ${status}`);

			try {
				// Kill the browser process
				process.kill(browserPid, "SIGTERM");
				logger.debug(
					`↳ Sent SIGTERM to browser process browserPid=${browserPid} (auto-cleanup)`,
				);

				// Force kill after delay if needed
				global.setTimeout(() => {
					try {
						process.kill(browserPid, 0); // Check if still exists
						process.kill(browserPid, "SIGKILL");
						logger.debug(
							`↳ Force killed browser process browserPid=${browserPid} (auto-cleanup)`,
						);
					} catch (error: any) {
						if (error.code === "ESRCH") {
							logger.debug(
								`↳ Browser process browserPid=${browserPid} already terminated (auto-cleanup)`,
							);
						}
					}
				}, 5000);
			} catch (error: any) {
				if (error.code !== "ESRCH") {
					logger.warn(
						`Error in auto-cleanup: ${error.constructor.name}: ${error.message}`,
					);
				}
			}
		}
	},
);

const MAX_SCREENSHOT_HEIGHT = 2000;
const MAX_SCREENSHOT_WIDTH = 1920;

// Helper function for logging glob warnings
function logGlobWarning(domain: string, glob: string, logger: any): void {
	if (!globWarningShown) {
		logger.warn(
			`⚠️ Allowing agent to visit ${domain} based on allowedDomains=['${glob}', ...]. Set allowedDomains=['${domain}', ...] explicitly to avoid matching too many domains!`,
		);
		globWarningShown = true;
	}
}

// Decorator for requiring initialization
function requireInitialization(
	/**
	 * Decorator for BrowserSession methods to require the BrowserSession be already active
	 */
	target: any,
	propertyName: string,
	descriptor: PropertyDescriptor,
): void {
	const method = descriptor.value;

	descriptor.value = async function (this: BrowserSession, ...args: any[]) {
		try {
			if (!this.initialized || !this.browserContext) {
				await this.start();
			}

			if (!this.agentCurrentPage || this.agentCurrentPage.isClosed()) {
				this.agentCurrentPage =
					this.browserContext && this.browserContext.pages().length > 0
						? this.browserContext.pages()[0]
						: undefined;
			}

			if (!this.agentCurrentPage || this.agentCurrentPage.isClosed()) {
				await this.createNewTab();
			}

			if (!this.agentCurrentPage || this.agentCurrentPage.isClosed()) {
				throw new Error(
					"BrowserSession.start() must be called first to initialize the browser session",
				);
			}

			// if (!this._cachedBrowserStateSummary) {
			// 	throw new Error(
			// 		"BrowserSession(...).start() must be called first to initialize the browser session",
			// 	);
			// }

			return await method.apply(this, args);
		} catch (error: any) {
			// Check if this is a TargetClosedError or similar connection error
			if (
				error.name === "TargetClosedError" ||
				error.message.includes("context or browser has been closed")
			) {
				this.logger.warn(
					`✂️ Browser ${this.connectionStr} disconnected before BrowserSession.${propertyName} could run...`,
				);
				this.resetConnectionState();
				throw error;
			} else {
				throw error;
			}
		}
	};
}

const DEFAULT_BROWSER_PROFILE = new BrowserProfile();

interface CachedClickableElementHashes {
	/**
	 * Clickable elements hashes for the last state
	 */
	url: string;
	hashes: Set<string>;
}
interface BrowserSessionOptions {
	id?: string;
	browserProfile?: BrowserProfile;
	wssUrl?: string;
	cdpUrl?: string;
	browserPid?: number;
	chromium?: PlaywrightOrPatchrightChromium;
	browser?: Browser;
	browserContext?: BrowserContext;
	initialized?: boolean;
	agentCurrentPage?: Page;
	humanCurrentPage?: Page;
	[key: string]: any; // Allow additional options
}

export class BrowserSession extends EventEmitter {
	/**
	 * Represents an active browser session with a running browser process somewhere.
	 * Chromium flags should be passed via extra_launch_args.
	 * Extra Playwright launch options (e.g., handle_sigterm, handle_sigint) can be passed as kwargs to BrowserSession and will be forwarded to the launch() call.
	 */

	// Persistent ID for this browser session
	public id: string;

	// Template profile for the BrowserSession
	public browserProfile: BrowserProfile;

	// Runtime props/state
	// WSS URL of the node.js playwright browser server to connect to, outputted by (await chromium.launchServer()).wsEndpoint()
	public wssUrl?: string;
	// CDP URL of the browser to connect to, e.g. http://localhost:9222 or ws://127.0.0.1:9222/devtools/browser/387adf4c-243f-4051-a181-46798f4a46f4
	public cdpUrl?: string;
	// pid of a running chromium-based browser process to connect to on localhost
	public browserPid?: number;
	// Playwright library object returned by: await (playwright or patchright).start()
	public chromium?: PlaywrightOrPatchrightChromium;
	// playwright Browser object to use (optional)
	public browser?: Browser;
	// playwright BrowserContext object to use (optional)
	public browserContext?: BrowserContext;

	// runtime state: state that changes during the lifecycle of a BrowserSession(), updated by the methods below
	// Mark BrowserSession launch/connection as already ready and skip setup (not recommended)
	public initialized: boolean = false;
	// Foreground Page that the agent is focused on
	// mutated by self.createNewTab(url)
	public agentCurrentPage?: Page;
	// Foreground Page that the human is focused on
	// mutated by self.setupCurrentPageChangeListeners()
	public humanCurrentPage?: Page;

	// Private fields
	_cachedBrowserStateSummary?: BrowserStateSummary;
	browserStateSummary?: BrowserStateSummary;
	private _cachedClickableElementHashes?: CachedClickableElementHashes;
	private _tabVisibilityCallback?: (source: { page: Page }) => void;
	private _logger?: any;
	private _downloadedFiles: string[] = [];
	private _originalBrowserSession?: BrowserSession; // Reference to prevent GC of the original session when copied
	private _ownsBrowserResources: boolean = true; // True if this instance owns and should clean up browser resources

	constructor(options: Partial<BrowserSessionOptions> = {}) {
		super();

		this.id = options.id || uuidv4();
		this.browserProfile = options.browserProfile || DEFAULT_BROWSER_PROFILE;
		this.wssUrl = options.wssUrl;
		this.cdpUrl = options.cdpUrl;
		this.browserPid = options.browserPid;
		this.chromium = options.chromium;
		this.browser = options.browser;
		this.browserContext = options.browserContext;
		this.initialized = options.initialized || false;
		this.agentCurrentPage = options.agentCurrentPage;
		this.humanCurrentPage = options.humanCurrentPage;

		// Apply session overrides to profile
		this.applySessionOverridesToProfile(options);

		// Register with FinalizationRegistry for automatic cleanup
		browserSessionFinalizationRegistry.register(this, {
			id: this.id,
			browserPid: this.browserPid,
			keepAlive: this.browserProfile.keepAlive,
			ownsBrowser: this._ownsBrowserResources,
			logger: this.logger,
		});
	}

	// private generateId(): string {
	// 	// Simple UUID-like ID generation
	// 	return Math.random().toString(36).substring(2, 15);
	// }

	private applySessionOverridesToProfile(
		options: Partial<BrowserSessionOptions>,
	): void {
		/**
		 * Apply any extra options as session-specific config overrides on top of browserProfile
		 */
		const sessionOwnFields = new Set([
			"id",
			"browserProfile",
			"wssUrl",
			"cdpUrl",
			"browserPid",
			"chromium",
			"browser",
			"browserContext",
			"initialized",
			"agentCurrentPage",
			"humanCurrentPage",
		]);

		// Get all the extra kwarg overrides passed to BrowserSession(...) that are actually
		// config Fields tracked by BrowserProfile, instead of BrowserSession's own args
		const profileOverrides: any = {};
		for (const [key, value] of Object.entries(options)) {
			if (!sessionOwnFields.has(key) && value !== undefined) {
				profileOverrides[key] = value;
			}
		}
		// FOR REPL DEBUGGING ONLY, NEVER ALLOW CIRCULAR REFERENCES IN REAL CODE:
		// this.browserProfile.inUseBySession = this

		// Create a new BrowserProfile instance with the copied data to preserve methods
		const copiedData = modelCopy(this.browserProfile, profileOverrides);
		this.browserProfile = new BrowserProfile(copiedData);
	}

	public get logger(): any {
		if (!this._logger) {
			this._logger = logger.child({
				sessionId: this.id,
				module: "browsernode/browser/session",
			});
		}
		return this._logger;
	}

	public toString(): string {
		const isCopy = this._originalBrowserSession ? "©" : "#";
		return `BrowserSession🆂 ${this.id.slice(-4)} ${isCopy}${this.agentCurrentPage?.toString().slice(-2) || "??"}`;
	}

	public get connectionStr(): string {
		const binaryName = this.browserProfile.executablePath
			? path
					.basename(this.browserProfile.executablePath)
					.toLowerCase()
					.replace(/\s+/g, "-")
					.replace(".exe", "")
			: (this.browserProfile.channel || BROWSERNODE_DEFAULT_CHANNEL)
					.toString()
					.toLowerCase()
					.replace("_", "-")
					.replace(/\s+/g, "-");

		const driverName = this.browserProfile.stealth
			? "patchright"
			: "playwright";

		if (this.cdpUrl) return `cdpUrl=${this.cdpUrl}`;
		if (this.wssUrl) return `wssUrl=${this.wssUrl}`;
		if (this.browserPid) return `browserPid=${this.browserPid}`;
		return `browser=${driverName}:${binaryName}`;
	}

	/**
	 * Starts the browser session by either connecting to an existing browser or launching a new one.
	 * Precedence order for launching/connecting:
	 *   1. page=Page playwright object, will use its page.context as browserContext
	 *   2. browserContext=PlaywrightBrowserContext object, will use its browser
	 *   3. browser=PlaywrightBrowser object, will use its first available context
	 *   4. browserPid=int, will connect to a local chromium-based browser via pid
	 *   5. wssUrl=str, will connect to a remote playwright browser server via WSS
	 *   6. cdpUrl=str, will connect to a remote chromium-based browser via CDP
	 *   7. playwright=Playwright object, will use its chromium instance to launch a new browser
	 */
	public async start(): Promise<BrowserSession> {
		/**
		 * If we're already initialized and the connection is still valid, return the existing session state and start from scratch
		 * Use timeout to prevent indefinite waiting on lock acquisition
		 */

		// Quick return if already connected
		if (this.initialized && (await this.isConnected())) {
			return this;
		}

		// Reset if we were initialized but lost connection
		if (this.initialized) {
			this.logger.warn(
				`💔 Browser ${this.connectionStr} has gone away, attempting to reconnect...`,
			);
			this.resetConnectionState();
		}

		try {
			// Setup
			await this.browserProfile.detectDisplayConfiguration();
			this.prepareUserDataDir();

			// Get playwright object
			await this.setupPlaywright();

			// Try to connect/launch browser
			await this._connectOrLaunchBrowser();

			// Ensure we have a context
			if (!this.browserContext) {
				throw new Error(
					`Failed to create BrowserContext for browser=${this.browser}`,
				);
			}

			// Configure browser
			await this._setupViewports();
			await this.setupCurrentPageChangeListeners();
			await this._startContextTracing();

			this.initialized = true;
			return this;
		} catch (error) {
			this.initialized = false;
			throw error;
		}
	}

	/**
	 * Shuts down the BrowserSession, killing the browser process (only works if keepAlive=false)
	 */
	public async stop(hint: string = ""): Promise<void> {
		// Unregister from FinalizationRegistry since we're stopping properly
		browserSessionFinalizationRegistry.unregister(this);

		// Save cookies to disk if configured
		if (this.browserContext) {
			try {
				await this.saveStorageState();
			} catch (error: any) {
				this.logger.warn(
					`⚠️ Failed to save auth storage state before stopping: ${error.constructor.name}: ${error.message}`,
				);
			}
		}

		if (this.browserProfile.keepAlive) {
			this.logger.info(
				"🕊️ BrowserSession.stop() called but keepAlive=true, leaving the browser running. Use .kill() to force close.",
			);
			return;
		}

		// Only the owner can actually stop the browser
		if (!this._ownsBrowserResources) {
			this.logger.debug(
				`🔗 BrowserSession.stop() called on a copy, not closing shared browser resources ${hint}`,
			);
			this.resetConnectionState();
			return;
		}

		if (this.browserContext || this.browser) {
			this.logger.info(
				`🛑 Closing ${this.connectionStr} browser context ${hint} ${JSON.stringify(this.browser || this.browserContext, null, 2)}`,
			);

			// Save trace recording if configured
			if (this.browserProfile.tracesDir && this.browserContext) {
				try {
					await this._saveTraceRecording();
				} catch (error: any) {
					if (error.name === "TargetClosedError") {
						this.logger.debug(
							"Browser context already closed, trace may have been saved automatically",
						);
					} else {
						this.logger.error(
							`❌ Error saving browser context trace: ${error.constructor.name}: ${error.message}`,
						);
					}
				}
			}

			// Log video/HAR save operations
			if (this.browserProfile.recordVideoDir) {
				this.logger.info(
					`🎥 Saving video recording to recordVideoDir= ${this.browserProfile.recordVideoDir}...`,
				);
			}
			if (this.browserProfile.recordHarPath) {
				this.logger.info(
					`🎥 Saving HAR file to recordHarPath= ${this.browserProfile.recordHarPath}...`,
				);
			}

			// Close browser context and browser
			try {
				await this._closeBrowserContext();
				await this._closeBrowser();
			} catch (error: any) {
				if (!error.message.includes("browser has been closed")) {
					this.logger.warn(
						`❌ Error closing browser: ${error.constructor.name}: ${error.message}`,
					);
				}
			} finally {
				this.browserContext = undefined;
				this.browser = undefined;
			}
		}

		// Kill the chrome subprocess if we started it
		if (this.browserPid) {
			try {
				await this._terminateBrowserProcess("(stop() called)");
			} catch (error: any) {
				if (error.name !== "NoSuchProcess") {
					this.logger.debug(
						`❌ Error terminating subprocess: ${error.constructor.name}: ${error.message}`,
					);
				}
				this.browserPid = undefined;
			}
		}

		// Clean up temporary user data directory
		if (
			this.browserProfile.userDataDir &&
			path
				.basename(this.browserProfile.userDataDir)
				.startsWith("browsernode-tmp")
		) {
			try {
				fs.rmSync(this.browserProfile.userDataDir, {
					recursive: true,
					force: true,
				});
			} catch (error: any) {
				// Ignore cleanup errors
				this.logger.debug(
					`❌ Error cleaning up temporary user data directory: ${error.constructor.name}: ${error.message}`,
				);
			}
		}

		this.resetConnectionState();
	}

	/**
	 * Deprecated: Provides backwards-compatibility with old method Browser().close()
	 */
	public async close(): Promise<void> {
		await this.stop("(close() called)");
	}

	/**
	 * Stop the BrowserSession even if keepAlive=true
	 */
	public async kill(): Promise<void> {
		this.browserProfile.keepAlive = false;
		await this.stop("(kill() called)");
	}

	/**
	 * Deprecated: Provides backwards-compatibility with old class method Browser().newContext()
	 */
	public async newContext(...args: any[]): Promise<BrowserSession> {
		// remove this after >=0.3.0
		return this;
	}

	/**
	 * A factory method to create a new BrowserSession and start it
	 */
	static async create(): Promise<BrowserSession> {
		const session = new BrowserSession();
		await session.start();
		return session;
	}

	/**
	 * Check if two BrowserSessions are equal
	 */
	public equals(other: BrowserSession): boolean {
		if (!(other instanceof BrowserSession)) {
			return false;
		}

		// Two sessions are considered equal if they're connected to the same browser
		// All three connection identifiers must match
		return (
			this.browserPid === other.browserPid &&
			this.cdpUrl === other.cdpUrl &&
			this.wssUrl === other.wssUrl
		);
	}

	public async dispose(): Promise<void> {
		// Unregister from FinalizationRegistry since we're disposing properly
		browserSessionFinalizationRegistry.unregister(this);
		await this.stop("(context manager exit)");
	}

	/**
	 * Create a copy of this BrowserSession that shares the browser resources but doesn't own them.
	 * This method creates a copy that:
	 * - Shares the same browser, browser_context, and playwright objects
	 * - Doesn't own the browser resources (won't close them when garbage collected)
	 * - Keeps a reference to the original to prevent premature garbage collection
	 */
	public modelCopy(
		overrides: Partial<BrowserSessionOptions> = {},
	): BrowserSession {
		// Create the copy using the parent class method
		const copy = new BrowserSession({
			...this.getOptions(),
			...overrides,
		});

		// The copy doesn't own the browser resources
		copy._ownsBrowserResources = false;

		// Keep a reference to the original to prevent garbage collection
		copy._originalBrowserSession = this;

		// Manually copy over the excluded fields that are needed for browser connection
		// These fields are excluded in the model config but need to be shared
		copy.chromium = this.chromium;
		copy.browser = this.browser;
		copy.browserContext = this.browserContext;
		copy.agentCurrentPage = this.agentCurrentPage;
		copy.humanCurrentPage = this.humanCurrentPage;
		copy.browserPid = this.browserPid;

		return copy;
	}
	private getOptions(): BrowserSessionOptions {
		return {
			id: this.id,
			browserProfile: this.browserProfile,
			wssUrl: this.wssUrl,
			cdpUrl: this.cdpUrl,
			browserPid: this.browserPid,
			initialized: this.initialized,
		};
	}

	/**
	 * This method handles garbage collection cleanup logic.
	 * a cleanup method that should be called when the session is no longer needed.
	 */
	public finalize(): void {
		const profile = this.browserProfile;
		const keepAlive = profile?.keepAlive;
		const userDataDir = profile?.userDataDir;
		const ownsBrowser = this._ownsBrowserResources;
		const status =
			this.browserPid && ownsBrowser
				? `🪓 killing pid=${this.browserPid}...`
				: "☠️";

		this.logger.debug(
			`🗑️ Garbage collected BrowserSession 🆂 ${this.id.slice(-4)}.${
				this.agentCurrentPage?.toString().slice(-2) || "??"
			} ref #${this.id.slice(-4)} keepAlive=${keepAlive} ownsBrowser=${ownsBrowser} ${status}`,
		);

		// Only kill browser processes if this instance owns them
		if (ownsBrowser) {
			try {
				this._killChildProcesses("(garbage collected)");
			} catch (error: any) {
				// Never let finalize raise Timeout exceptions
				if (error.name !== "TimeoutError") {
					this.logger.warn(
						`Error force-killing browser in BrowserSession.finalize: ${error.constructor.name}: ${error.message}`,
					);
				}
			}
		}
	}

	/**
	 * Kill any child processes that might be related to the browser
	 */
	private _killChildProcesses(hint: string = ""): void {
		if (!this.browserProfile.keepAlive && this.browserPid) {
			try {
				// In Node.js, we use process.kill() instead of psutil
				// First try to terminate gracefully
				try {
					process.kill(this.browserPid, "SIGTERM");
					this.logger.debug(
						`↳ Sent SIGTERM to browser process browserPid=${this.browserPid} ${hint}`,
					);

					// Give it a moment to exit gracefully
					global.setTimeout(() => {
						try {
							// Check if process is still running and force kill if needed
							process.kill(this.browserPid!, 0); // This will throw if process doesn't exist
							process.kill(this.browserPid!, "SIGKILL");
							this.logger.debug(
								`↳ Force killed browser process browserPid=${this.browserPid} ${hint}`,
							);
						} catch (error: any) {
							if (error.code === "ESRCH") {
								// Process doesn't exist anymore, which is what we want
								this.logger.debug(
									`↳ Browser process browserPid=${this.browserPid} already terminated ${hint}`,
								);
							}
						}
					}, 5000);
				} catch (error: any) {
					if (error.code === "ESRCH") {
						// Process doesn't exist
						this.logger.debug(
							`↳ Browser process browserPid=${this.browserPid} not found ${hint}`,
						);
					} else {
						this.logger.warn(
							`Error terminating browser process: ${error.constructor.name}: ${error.message}`,
						);
					}
				}
			} catch (error: any) {
				this.logger.warn(
					`Error force-killing browser in BrowserSession._killChildProcesses: ${error.constructor.name}: ${error.message}`,
				);
			}
		}
	}
	/**
	 * Create and return a new playwright or patchright node.js subprocess / API connector
	 */
	private async _startGlobalPlaywrightSubprocess(
		isStealth: boolean,
	): Promise<PlaywrightOrPatchrightChromium> {
		// Register shutdown hooks when creating playwright instances
		registerShutdownHooks();

		if (isStealth) {
			globalPatchrightApiObject = await PatchrightChromium;
			return globalPatchrightApiObject;
		}
		globalPlaywrightApiObject = await PlaywrightChromium;
		return globalPlaywrightApiObject;
	}

	private async _unsafeGetOrStartPlaywrightObject(): Promise<PlaywrightOrPatchrightChromium> {
		/**
		 * Get existing or create new global playwright object with proper locking.
		 */
		const isStealth = this.browserProfile.stealth;
		const driverName = isStealth ? "patchright" : "playwright";
		const globalApiObject = isStealth
			? globalPatchrightApiObject
			: globalPlaywrightApiObject;

		// Check if we need to create or recreate the global object
		let shouldRecreate = false;

		if (globalApiObject !== process) {
			this.logger.debug(
				`Detected event loop change. Previous ${driverName} instance was created in a different event loop. ` +
					"Creating new instance to avoid disconnection when the previous loop closes.",
			);
			shouldRecreate = true;
		}

		// Also check if the object exists but is no longer functional
		if (globalApiObject && !shouldRecreate) {
			try {
				// Try to access a property to verify the object is still valid
				const _ = globalApiObject.chromium?.executablePath;
			} catch (error: any) {
				this.logger.debug(
					`Detected invalid ${driverName} instance: ${error.constructor.name}. Creating new instance.`,
				);
				shouldRecreate = true;
			}
		}

		// If we already have a valid object, use it
		if (globalApiObject && !shouldRecreate) {
			return globalApiObject;
		}

		// Create new playwright object
		return await this._startGlobalPlaywrightSubprocess(isStealth);
	}

	// --- Cleanup Methods ---
	/**
	 * Close browser context with retry logic.
	 */
	@retry({ wait: 1, retries: 2, timeout: 10 })
	private async _closeBrowserContext(): Promise<void> {
		await this._unsafeCloseBrowserContext();
	}

	/**
	 * Unsafe browser context close logic without retry protection.
	 */
	private async _unsafeCloseBrowserContext(): Promise<void> {
		if (this.browserContext) {
			await this.browserContext.close();
			this.browserContext = undefined;
		}
	}
	/**
	 * Close browser instance with retry logic.
	 */
	@retry({ wait: 1, retries: 2, timeout: 10 })
	private async _closeBrowser(): Promise<void> {
		await this._unsafeCloseBrowser();
	}

	/**
	 * Unsafe browser close logic without retry protection.
	 */
	private async _unsafeCloseBrowser(): Promise<void> {
		if (this.browser && this.browser.isConnected()) {
			await this.browser.close();
			this.browser = undefined;
		}
	}

	/**
	 * Terminate browser process with retry logic.
	 */
	@retry({ wait: 0.5, retries: 3, timeout: 5 })
	private async _terminateBrowserProcess(hint: string = ""): Promise<void> {
		await this._unsafeTerminateBrowserProcess(hint);
	}

	/**
	 * Unsafe browser process termination without retry protection.
	 */
	// TODO: Implement this
	private async _unsafeTerminateBrowserProcess(
		hint: string = "",
	): Promise<void> {
		if (this.browserPid) {
			try {
				// Get process information for logging
				let executablePath = "unknown";
				try {
					// In Node.js, we can't easily get cmdline like psutil, but we can try to get some info
					executablePath =
						this.browserProfile.executablePath ||
						(this.browserProfile.channel
							? this.browserProfile.channel.toString()
							: "chrome");
				} catch (error) {
					// Ignore errors getting process info
				}

				this.logger.info(
					`↳ Killing browserPid=${this.browserPid} ${executablePath} ${hint}`,
				);

				// Try graceful termination first (SIGTERM)
				try {
					process.kill(this.browserPid, "SIGTERM");
					this.logger.debug(`↳ Sent SIGTERM to browserPid=${this.browserPid}`);
				} catch (error: any) {
					if (error.code === "ESRCH") {
						// Process doesn't exist, that's fine
						this.logger.debug(
							`↳ Process browserPid=${this.browserPid} not found (already terminated)`,
						);
						return;
					}
					throw error;
				}

				// Kill child processes
				this._killChildProcesses(hint);

				// Wait for process to terminate gracefully (up to 4 seconds)
				await this._waitForProcessTermination(this.browserPid, 4000);
			} catch (error: any) {
				if (error.code === "ESRCH") {
					// Process already gone, that's fine
					this.logger.debug(
						`↳ Process browserPid=${this.browserPid} no longer exists`,
					);
				} else {
					this.logger.warn(
						`Error terminating browser process: ${error.constructor.name}: ${error.message}`,
					);
				}
			} finally {
				this.browserPid = undefined;
			}
		}
	}

	/**
	 * Wait for a process to terminate with timeout
	 */
	private async _waitForProcessTermination(
		pid: number,
		timeoutMs: number,
	): Promise<void> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeoutMs) {
			try {
				// Check if process is still running (this will throw if process doesn't exist)
				process.kill(pid, 0);
				// Process still exists, wait a bit
				await setTimeout(100);
			} catch (error: any) {
				if (error.code === "ESRCH") {
					// Process terminated successfully
					this.logger.debug(
						`↳ Process browserPid=${pid} terminated gracefully`,
					);
					return;
				}
				throw error;
			}
		}

		// Timeout reached, force kill
		try {
			process.kill(pid, "SIGKILL");
			this.logger.debug(`↳ Force killed browserPid=${pid} after timeout`);
		} catch (error: any) {
			if (error.code !== "ESRCH") {
				this.logger.warn(
					`Failed to force kill browserPid=${pid}: ${error.message}`,
				);
			}
		}
	}

	/**
	 * Save browser trace recording.
	 */
	@retry({ wait: 1, retries: 2, timeout: 30 })
	private async _saveTraceRecording(): Promise<void> {
		if (this.browserProfile.tracesDir && this.browserContext) {
			const tracesPath = this.browserProfile.tracesDir;
			const finalTracePath = tracesPath.endsWith(".zip")
				? tracesPath
				: path.join(tracesPath, `BrowserSession_${this.id}.zip`);

			this.logger.info(
				`🎥 Saving browser context trace to ${finalTracePath}...`,
			);
			await this.browserContext.tracing.stop({ path: finalTracePath });
		}
	}

	/**
	 * Try all connection methods in order of precedence.
	 */
	private async _connectOrLaunchBrowser(): Promise<void> {
		// Try connecting via passed objects first
		await this.setupBrowserViaPassedObjects();
		if (this.browserContext) return;

		// Try connecting via browser PID
		await this.setupBrowserViaBrowserPid();
		if (this.browserContext) return;

		// Try connecting via WSS URL
		await this.setupBrowserViaWssUrl();
		if (this.browserContext) return;

		// Try connecting via CDP URL
		await this.setupBrowserViaCdpUrl();
		if (this.browserContext) return;

		// Launch new browser as last resort
		await this.setupNewBrowserContext();
	}

	/**
	 * Take screenshot using Playwright, with retry and semaphore protection.
	 */
	@retry({ wait: 2, retries: 2, timeout: 35 })
	private async _takeScreenshotHybrid(page: Page): Promise<string> {
		// Use Playwright screenshot directly
		if (!this.browserContext) {
			throw new Error("BrowserContext is not set up");
		}

		try {
			await (page as any).evaluate("() => true");
		} catch (error) {
			throw new Error("Page is not usable before screenshot!");
		}

		await page.bringToFront();

		try {
			const screenshot = await page.screenshot({
				fullPage: false,
				// scale: "css",
				timeout: this.browserProfile.defaultTimeout || 30000,
				animations: "allow",
				caret: "initial",
			});

			try {
				await (page as any).evaluate("() => true");
			} catch (error) {
				throw new Error("Page is not usable after screenshot!");
			}

			const screenshotB64 = Buffer.from(screenshot).toString("base64");
			if (!screenshotB64) {
				throw new Error("Playwright page.screenshot() returned empty base64");
			}
			return screenshotB64;
		} catch (error: any) {
			if (error.message.toLowerCase().includes("timeout")) {
				this.logger.warn(
					"🚨 Screenshot timed out, resetting connection state and restarting browser...",
				);
				this.resetConnectionState();
				await this.start();
			}
			throw error;
		}
	}

	/**
	 * Set up playwright library client object: usually the result of (await chromium)
	 * Override to customize the set up of the playwright or patchright library object
	 */
	@retry({ wait: 0.5, retries: 2, timeout: 30 })
	public async setupPlaywright(): Promise<void> {
		const isStealth = this.browserProfile.stealth;

		// Configure browser channel based on stealth mode
		if (isStealth) {
			this.browserProfile.channel =
				this.browserProfile.channel || BrowserChannel.CHROME;
			this.logger.info(
				`🕶️ Activated stealth mode using patchright ${this.browserProfile.channel.toLowerCase()} browser...`,
			);
		} else {
			this.browserProfile.channel =
				this.browserProfile.channel || BrowserChannel.CHROMIUM;
		}

		// Get or create the global playwright object
		this.chromium =
			this.chromium || (await this._unsafeGetOrStartPlaywrightObject());

		// Log stealth best-practices warnings if applicable
		if (isStealth) {
			if (
				this.browserProfile.channel &&
				this.browserProfile.channel !== BrowserChannel.CHROME
			) {
				this.logger.info(
					" 🪄 For maximum stealth, BrowserSession(...) should be passed channel=null or BrowserChannel.CHROME",
				);
			}
			if (!this.browserProfile.userDataDir) {
				this.logger.info(
					" 🪄 For maximum stealth, BrowserSession(...) should be passed a persistent userDataDir=...",
				);
			}
			if (this.browserProfile.headless || !this.browserProfile.noViewport) {
				this.logger.info(
					" 🪄 For maximum stealth, BrowserSession(...) should be passed headless=false & viewport=null",
				);
			}
		}
	}

	/**
	 * Override to customize the set up of the connection to an existing browser
	 */
	private async setupBrowserViaPassedObjects(): Promise<void> {
		// 1. check for a passed Page object, if present, it always takes priority, set browserContext = page.context
		if (this.agentCurrentPage) {
			try {
				// Test if the page is still usable by evaluating simple JS
				if (this.agentCurrentPage) {
					await (this.agentCurrentPage as any).evaluate("() => true");
				}
				this.browserContext = this.agentCurrentPage.context();
			} catch (error) {
				this.agentCurrentPage = undefined;
				this.browserContext = undefined;
			}
		}

		// 2. Check if the current browser connection is valid, if not clear the invalid objects
		if (this.browserContext) {
			try {
				// Try to access a property that would fail if the context is closed
				const _ = this.browserContext.pages();
				// Additional check: verify the browser is still connected
				if (
					this.browserContext.browser() &&
					!this.browserContext.browser()?.isConnected()
				) {
					this.browserContext = undefined;
				}
			} catch (error) {
				// Context is closed, clear it
				this.browserContext = undefined;
			}
		}

		// 3. if we have a browser object but it's disconnected, clear it and the context because we cant use either
		if (this.browser && !this.browser.isConnected()) {
			if (
				this.browserContext &&
				this.browserContext.browser() === this.browser
			) {
				this.browserContext = undefined;
			}
			this.browser = undefined;
		}

		// 4.if we have a context now, it always takes precedence, set browser = context.browser, otherwise use the passed browser
		const browserFromContext = this.browserContext?.browser();
		if (browserFromContext?.isConnected()) {
			this.browser = browserFromContext;
		}

		if (this.browser || this.browserContext) {
			this.logger.info(
				`🎭 Connected to existing user-provided browser: ${this.browserContext}`,
			);
			this.setBrowserKeepAlive(true); // we connected to an existing browser, dont kill it at the end
		}
	}

	/**
	 * If browserPid is provided, calcuclate its CDP URL by looking for --remote-debugging-port=... in its CLI args, then connect to it
	 */
	private async setupBrowserViaBrowserPid(): Promise<void> {
		if (this.browser || this.browserContext || !this.browserPid) {
			return; // already connected to a browser, no browser_pid provided, nothing to do
		}

		// Check that browser_pid process is running, otherwise we cannot connect to it
		try {
			// Check if process exists using Node.js process.kill with signal 0
			process.kill(this.browserPid, 0);
		} catch (error: any) {
			if (error.code === "ESRCH") {
				this.logger.warn(
					`⚠️ Expected Chrome process with pid=${this.browserPid} not found, unable to (re-)connect`,
				);
			} else {
				this.logger.warn(
					`⚠️ Error accessing chrome process with pid=${this.browserPid}: ${error.constructor.name}: ${error.message}`,
				);
			}
			this.browserPid = undefined;
			return;
		}

		// Get command line arguments of the process
		let args: string[];
		try {
			args = await this.getProcessCommandLine(this.browserPid);
		} catch (error: any) {
			this.logger.warn(
				`⚠️ Error getting command line for process pid=${this.browserPid}: ${error.constructor.name}: ${error.message}`,
			);
			this.browserPid = undefined;
			return;
		}

		// check that browserPid process is exposing a debug port we can connect to, otherwise we cannot connect to it
		const debugPortArg = args.find((arg) =>
			arg.startsWith("--remote-debugging-port="),
		);
		if (!debugPortArg) {
			// Provided pid is unusable, it's either not running or doesn't have an open debug port
			if (args.includes("--remote-debugging-pipe")) {
				this.logger.error(
					`❌ Found --remote-debugging-pipe in browser launch args for browserPid=${this.browserPid} but it was started by a different BrowserSession, cannot connect to it`,
				);
			} else {
				this.logger.error(
					`❌ Could not find --remote-debugging-port=... to connect to in browser launch args for browserPid=${this.browserPid}: ${args.join(" ")}`,
				);
			}
			this.browserPid = undefined;
			return;
		}

		const debugPort = debugPortArg.split("=")[1]?.trim();
		if (!debugPort) {
			this.logger.error(
				`❌ Invalid --remote-debugging-port argument for browserPid=${this.browserPid}: ${debugPortArg}`,
			);
			this.browserPid = undefined;
			return;
		}

		this.cdpUrl = this.cdpUrl || `http://localhost:${debugPort}/`;
		this.logger.info(
			`🌎 Connecting to existing local browser process: browserPid=${this.browserPid} on ${this.cdpUrl}`,
		);

		if (!this.chromium) {
			throw new Error("chromium instance is null");
		}

		this.browser =
			this.browser ||
			(await this.chromium.connectOverCDP(
				this.cdpUrl,
				this.browserProfile.kwargsForConnect(),
			));
		this.setBrowserKeepAlive(true); // we connected to an existing browser, don't kill it at the end
	}

	private async getProcessCommandLine(pid: number): Promise<string[]> {
		const platform = os.platform();

		if (platform === "win32") {
			// Windows implementation
			return this.getProcessCommandLineWindows(pid);
		} else {
			// Unix-like systems (Linux, macOS)
			return this.getProcessCommandLineUnix(pid);
		}
	}

	private async getProcessCommandLineUnix(pid: number): Promise<string[]> {
		const platform = os.platform();

		if (platform === "darwin") {
			// macOS: use ps command
			return new Promise((resolve, reject) => {
				exec(`ps -p ${pid} -o command=`, (error: any, stdout: string) => {
					if (error) {
						reject(
							new Error(
								`Failed to get command line for process ${pid}: ${error.message}`,
							),
						);
						return;
					}

					const commandLine = stdout.trim();
					if (!commandLine) {
						reject(new Error(`No command line found for process ${pid}`));
						return;
					}

					// Parse command line into arguments
					const args = this.parseCommandLine(commandLine);
					resolve(args);
				});
			});
		} else {
			// Linux: use /proc filesystem
			try {
				const cmdlineContent = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
				// Command line arguments are null-separated
				return cmdlineContent.split("\0").filter((arg) => arg.length > 0);
			} catch (error: any) {
				throw new Error(
					`Failed to read /proc/${pid}/cmdline: ${error.message}`,
				);
			}
		}
	}

	private async getProcessCommandLineWindows(pid: number): Promise<string[]> {
		return new Promise((resolve, reject) => {
			const child = spawn(
				"wmic",
				[
					"process",
					"where",
					`ProcessId=${pid}`,
					"get",
					"CommandLine",
					"/format:value",
				],
				{ windowsHide: true },
			);

			let output = "";
			child.stdout?.on("data", (data) => {
				output += data.toString();
			});

			child.on("close", (code) => {
				if (code !== 0) {
					reject(new Error(`wmic process failed with code ${code}`));
					return;
				}

				try {
					// Parse the output to extract command line
					const lines = output.split("\n");
					const commandLineLine = lines.find((line) =>
						line.startsWith("CommandLine="),
					);
					if (!commandLineLine) {
						reject(new Error("CommandLine not found in wmic output"));
						return;
					}

					const commandLine = commandLineLine
						.substring("CommandLine=".length)
						.trim();
					if (!commandLine) {
						reject(new Error("Empty command line"));
						return;
					}

					// Parse command line into arguments (simplified parsing)
					const args = this.parseCommandLine(commandLine);
					resolve(args);
				} catch (error) {
					reject(error);
				}
			});

			child.on("error", (error) => {
				reject(error);
			});
		});
	}

	/**
	 * Get Chrome version info and WebSocket debugger URL from CDP endpoint
	 */
	private async getChromeVersionInfo(cdpUrl: string): Promise<{
		webSocketDebuggerUrl?: string;
		[key: string]: any;
	} | null> {
		return new Promise((resolve) => {
			// Ensure the URL ends with /json/version
			const versionUrl = cdpUrl.endsWith("/")
				? `${cdpUrl}json/version`
				: `${cdpUrl}/json/version`;

			let responseData = "";
			const req = http.get(versionUrl, (res: any) => {
				if (res.statusCode === 200) {
					res.on("data", (chunk: string) => {
						responseData += chunk;
					});

					res.on("end", () => {
						try {
							const versionInfo = JSON.parse(responseData);
							resolve(versionInfo);
						} catch (error) {
							this.logger.error(`Failed to parse version info: ${error}`);
							resolve(null);
						}
					});
				} else {
					this.logger.error(
						`HTTP ${res.statusCode} when fetching version info`,
					);
					resolve(null);
				}
			});

			req.on("error", (error: any) => {
				this.logger.error(`Error fetching version info: ${error.message}`);
				resolve(null);
			});

			req.setTimeout(5000, () => {
				req.destroy();
				this.logger.error("Timeout fetching version info");
				resolve(null);
			});
		});
	}

	private parseCommandLine(commandLine: string): string[] {
		// Simple command line parsing - this could be more sophisticated
		// For now, split by spaces but handle quoted arguments
		const args: string[] = [];
		let current = "";
		let inQuotes = false;
		let quoteChar = "";

		for (let i = 0; i < commandLine.length; i++) {
			const char = commandLine[i];

			if ((char === '"' || char === "'") && !inQuotes) {
				inQuotes = true;
				quoteChar = char;
			} else if (char === quoteChar && inQuotes) {
				inQuotes = false;
				quoteChar = "";
			} else if (char === " " && !inQuotes) {
				if (current.trim()) {
					args.push(current.trim());
					current = "";
				}
			} else {
				current += char;
			}
		}

		if (current.trim()) {
			args.push(current.trim());
		}

		return args;
	}

	/**
	 * Check for a passed wssUrl, connect to a remote playwright browser server via WSS
	 */
	private async setupBrowserViaWssUrl(): Promise<void> {
		if (this.browser || this.browserContext || !this.wssUrl) {
			return; // already connected to a browser or no wssUrl provided, nothing to do
		}

		this.logger.info(
			`🌎 Connecting to existing remote chromium playwright node.js server over WSS: ${this.wssUrl}`,
		);
		if (!this.chromium) {
			throw new Error("chromium instance is null");
		}

		this.browser = await this.chromium.connect(
			this.wssUrl,
			this.browserProfile.kwargsForConnect(),
		);
		this.setBrowserKeepAlive(true); // we connected to an existing browser, dont kill it at the end
	}

	/**
	 * check for a passed cdpUrl, connect to a remote chromium-based browser via CDP
	 */
	private async setupBrowserViaCdpUrl(): Promise<void> {
		if (this.browser || this.browserContext || !this.cdpUrl) {
			return; // already connected to a browser or no cdpUrl provided, nothing to do
		}

		this.logger.info(
			`🌎 Connecting to existing remote chromium-based browser over CDP: ${this.cdpUrl}`,
		);
		if (!this.chromium) {
			throw new Error("chromium instance is null");
		}

		try {
			// Get the WebSocket debugger URL from the CDP version endpoint
			this.logger.debug(`Fetching version info from: ${this.cdpUrl}`);
			const versionInfo = await this.getChromeVersionInfo(this.cdpUrl);
			this.logger.debug(`Version info received:`, versionInfo);

			if (!versionInfo || !versionInfo.webSocketDebuggerUrl) {
				this.logger.error(
					`Invalid version info: ${JSON.stringify(versionInfo)}`,
				);
				throw new Error("Could not get WebSocket URL from Chrome CDP endpoint");
			}

			this.logger.debug(
				`Connecting to WebSocket: ${versionInfo.webSocketDebuggerUrl}`,
			);

			// Connect using the specific WebSocket URL to avoid Playwright CDP discovery bug
			this.browser = await this.chromium.connectOverCDP({
				wsEndpoint: versionInfo.webSocketDebuggerUrl,
				timeout: 20000, // 20 second timeout for connection
				slowMo: 50, // Add slight delay to ensure stability
				...this.browserProfile.kwargsForConnect(),
			});

			this.logger.info("✅ Successfully connected via CDP WebSocket");
		} catch (error: any) {
			this.logger.error(
				`❌ Failed to connect via CDP WebSocket: ${error.message}`,
			);
			this.logger.info("🔄 Falling back to original CDP connection method");
			// Fallback to the original method in case the workaround fails
			this.browser = await this.chromium.connectOverCDP(
				this.cdpUrl,
				this.browserProfile.kwargsForConnect(),
			);
		}

		this.setBrowserKeepAlive(true); // we connected to an existing browser, dont kill it at the end
	}

	/**
	 * Launch a new browser and browserContext
	 */
	@retry({ wait: 1, retries: 2, timeout: 45 })
	private async setupNewBrowserContext(): Promise<void> {
		// Double-check after semaphore acquisition to prevent duplicate browser launches
		if (this.browserContext) {
			try {
				if (
					// Check if context is still valid and has pages
					this.browserContext.pages().length > 0 &&
					!this.browserContext.pages().every((page) => page.isClosed())
				) {
					this.logger.debug(
						"Browser context already exists after semaphore acquisition, skipping launch",
					);
					return;
				}
			} catch (error) {
				// Continue with launch if we can't check pages
				// If we can't check pages, assume context is invalid and continue with launch
				this.logger.debug(
					"Browser context is invalid after semaphore acquisition, launching new browser",
				);
			}
		}
		await this.unsafeSetupNewBrowserContext();
	}

	/**
	 * Unsafe browser context setup without retry protection.
	 */
	private async unsafeSetupNewBrowserContext(): Promise<void> {
		const childPidsBeforeLaunch = await this.getChildProcessPids();

		// If we have a browser object but no browser_context, use the first context discovered or make a new one
		if (this.browser && !this.browserContext) {
			const contexts = this.browser.contexts();
			if (contexts && contexts.length > 0) {
				this.browserContext = contexts[0];
				this.logger.info(
					`🌎 Using first browserContext available in existing browser: ${JSON.stringify(this.browserContext, null, 2)}`,
				);
			} else {
				this.browserContext = await this.browser.newContext(
					modelDump(this.browserProfile.kwargsForNewContext()),
				);
				const storageInfo = this.browserProfile.storageState
					? ` + loaded storageState=${
							typeof this.browserProfile.storageState === "object"
								? Object.keys(this.browserProfile.storageState).length
								: "0"
						} cookies`
					: "";
				this.logger.info(
					`🌎 Created new empty browserContext in existing browser${storageInfo}: ${this.browserContext}`,
				);
			}
		}

		// If we still have no browser_context by now, launch a new local one using launch_persistent_context()
		if (!this.browserContext) {
			if (!this.browserProfile.channel) {
				throw new Error("browserProfile.channel is null");
			}

			this.logger.info(
				`🌎 Launching new local browser ` +
					`${this.browserProfile.stealth ? "patchright" : "playwright"}:${this.browserProfile.channel.toLowerCase()} ` +
					`keepAlive=${this.browserProfile.keepAlive || false} ` +
					`userDataDir= ${logPrettyPath(this.browserProfile.userDataDir) || "<incognito>"}`,
			);

			//if no user_data_dir is provided, generate a unique one for this temporary browserContext (will be used to uniquely identify the browser_pid later)
			if (!this.browserProfile.userDataDir) {
				this.browserProfile.userDataDir = await this.createTempUserDataDir();
			}

			// User data dir was provided, prepare it for use
			this.prepareUserDataDir();

			// Search for potentially conflicting local processes running on the same user_data_dir
			await this.checkForConflictingProcesses();

			// Launch persistent context with user_data_dir
			try {
				await this.launchPersistentContextWithRetry();
			} catch (error: any) {
				// show a nice logger hint explaining what went wrong with the user_data_dir
				// calculate the version of the browser that the userDataDir is for, and the version of the browser we are running with
				await this.handleBrowserLaunchError(error);
				throw error;
			}
		}

		// Only restore browser from context if it's connected, otherwise keep it None to force new launch
		const browserFromContext = this.browserContext?.browser();
		if (browserFromContext?.isConnected()) {
			this.browser = browserFromContext;
		}
		// ^ self.browser can unfortunately still be None at the end ^
		// playwright does not give us a browser object at all when we use launchPersistentContext()!

		// Detect any new child chrome processes that we might have launched above
		// Skip process detection if we connected to an existing browser via CDP/WSS
		const connectedToExistingBrowser =
			this.cdpUrl || this.wssUrl || this.browserPid;
		if (!connectedToExistingBrowser) {
			await this.detectNewBrowserProcess(childPidsBeforeLaunch);
		} else {
			this.logger.debug(
				`⏭️ Skipping process detection for existing browser connection: ${this.connectionStr}`,
			);
		}

		if (this.browser) {
			if (!this.browser.isConnected()) {
				throw new Error(
					`Browser is not connected, did the browser process crash or get killed? (connection method: ${this.connectionStr})`,
				);
			}
		}

		this.logger.debug(
			`🪢 Browser ${this.connectionStr} connected ${JSON.stringify(this.browser || this.browserContext, null, 2)}`,
		);

		if (!this.browserContext) {
			throw new Error(
				`${this.toString()} Failed to create a playwright BrowserContext ${this.browserContext} for browser=${this.browser}`,
			);
		}
		// this.logger.debug("Setting up init scripts in browser");

		// Add init scripts
		await this.addInitScripts();
	}

	/**
	 * Get PIDs of all current child processes (recursive)
	 */
	private async getChildProcessPids(): Promise<Set<number>> {
		try {
			const platform = os.platform();

			return new Promise((resolve) => {
				if (platform === "win32") {
					// Windows: get child processes using wmic with recursive search
					exec(
						`wmic process get ProcessId,ParentProcessId /format:csv | findstr /V "^Node"`,
						(error: any, stdout: string) => {
							if (error) {
								resolve(new Set());
								return;
							}
							const pids = new Set<number>();
							const lines = stdout.split("\n");
							const processList = new Map<number, number>(); // pid -> parentPid

							// Parse all processes
							for (const line of lines) {
								const parts = line.split(",");
								if (parts.length >= 3) {
									const parentPid = parseInt(parts[1]?.trim() ?? "");
									const pid = parseInt(parts[2]?.trim() ?? "");
									if (!isNaN(pid) && !isNaN(parentPid)) {
										processList.set(pid, parentPid);
									}
								}
							}

							// Find all descendants recursively
							const findDescendants = (parentPid: number) => {
								for (const [pid, ppid] of processList) {
									if (ppid === parentPid) {
										pids.add(pid);
										findDescendants(pid); // Recursive
									}
								}
							};

							findDescendants(process.pid);
							resolve(pids);
						},
					);
				} else {
					// Unix-like: get child processes recursively using ps
					// exec(`ps -eo pid,ppid --no-headers`, (error: any, stdout: string) => {
					// TODO: macos ps does not support --no-headers
					exec(`ps -eo pid,ppid`, (error: any, stdout: string) => {
						if (error) {
							resolve(new Set());
							return;
						}
						const pids = new Set<number>();
						const lines = stdout.trim().split("\n");
						const processList = new Map<number, number>(); // pid -> parentPid

						// Parse all processes (skip header line)
						for (let i = 1; i < lines.length; i++) {
							const line = lines[i];
							if (!line) continue;

							const parts = line.trim().split(/\s+/);
							if (parts.length >= 2) {
								const pid = parseInt(parts[0] ?? "");
								const ppid = parseInt(parts[1] ?? "");
								if (!isNaN(pid) && !isNaN(ppid)) {
									processList.set(pid, ppid);
								}
							}
						}

						// Find all descendants recursively
						const findDescendants = (parentPid: number) => {
							for (const [pid, ppid] of processList) {
								if (ppid === parentPid) {
									pids.add(pid);
									findDescendants(pid); // Recursive
								}
							}
						};

						findDescendants(process.pid);
						resolve(pids);
					});
				}
			});
		} catch (error) {
			this.logger.debug(`Error getting child process PIDs: ${error}`);
			return new Set();
		}
	}

	/**
	 * Search for potentially conflicting local processes running on the same userDataDir
	 */
	private async checkForConflictingProcesses(): Promise<void> {
		if (!this.browserProfile.userDataDir) return;

		try {
			const platform = os.platform();
			const userDataDirPath = path.resolve(this.browserProfile.userDataDir);

			return new Promise<void>((resolve) => {
				if (platform === "win32") {
					// Windows: use wmic to check process command lines
					exec(
						"wmic process get ProcessId,CommandLine /format:csv",
						(error: any, stdout: string) => {
							if (error) {
								resolve();
								return;
							}

							const lines = stdout.split("\n");
							for (const line of lines) {
								if (line.includes(`--user-data-dir=${userDataDirPath}`)) {
									// Extract PID from the CSV format
									const parts = line.split(",");
									if (parts.length >= 2) {
										const pid = parts[1]?.trim();
										if (pid && !isNaN(parseInt(pid))) {
											this.logger.error(
												`🚨 Found potentially conflicting browser process browserPid=${pid} ` +
													`already running with the same userDataDir= ${logPrettyPath(this.browserProfile.userDataDir)}`,
											);
											break;
										}
									}
								}
							}
							resolve();
						},
					);
				} else {
					// Unix-like: use ps to check process command lines
					exec("ps ax -o pid,command", (error: any, stdout: string) => {
						if (error) {
							resolve();
							return;
						}

						const lines = stdout.split("\n");
						for (const line of lines) {
							if (line.includes(`--user-data-dir=${userDataDirPath}`)) {
								const match = line.match(/^\s*(\d+)/);
								if (match) {
									const pid = match[1];
									this.logger.error(
										`🚨 Found potentially conflicting browser process browserPid=${pid} ` +
											`already running with the same user_data_dir= ${logPrettyPath(this.browserProfile.userDataDir)}`,
									);
									break;
								}
							}
						}
						resolve();
					});
				}
			});
		} catch (error) {
			// Ignore errors in conflict detection - this is non-critical
			this.logger.debug(`Error checking for conflicting processes: ${error}`);
		}
	}

	/**
	 * Launch persistent context with retry and timeout handling
	 */
	private async launchPersistentContextWithRetry(): Promise<void> {
		if (!this.chromium) {
			throw new Error("chromium instance is null");
		}

		const timeoutMs = this.browserProfile.defaultTimeout || 30000;

		try {
			// Try launch with timeout
			const timeoutPromise = new Promise<never>((_, reject) => {
				global.setTimeout(() => reject(new Error("Launch timeout")), timeoutMs);
			});

			const launchPromise = this.chromium.launchPersistentContext(
				this.browserProfile.userDataDir!,
				modelDump(this.browserProfile.kwargsForLaunchPersistentContext()),
			);

			this.browserContext = await Promise.race([launchPromise, timeoutPromise]);
		} catch (error: any) {
			// Check if it's a SingletonLock error
			if (
				error.message.includes("SingletonLock") ||
				error.message.includes("ProcessSingleton")
			) {
				this.logger.warn(
					"⚠️ SingletonLock error detected. Cleaning up and retrying...",
				);

				// Remove the stale lock file
				const singletonLock = path.join(
					this.browserProfile.userDataDir!,
					"SingletonLock",
				);
				if (fs.existsSync(singletonLock)) {
					fs.unlinkSync(singletonLock);
				}

				// Wait a moment for cleanup
				await setTimeout(100);

				// Retry the launch
				this.browserContext = await this.chromium.launchPersistentContext(
					this.browserProfile.userDataDir!,
					modelDump(this.browserProfile.kwargsForLaunchPersistentContext()),
				);
			} else if (error.message.includes("Launch timeout")) {
				this.logger.warn(
					"Browser operation timed out. This may indicate the chromium instance is invalid due to event loop changes. " +
						"Recreating chromium instance and retrying...",
				);

				// Force recreation of the playwright object
				this.chromium = await this._unsafeGetOrStartPlaywrightObject();

				// Retry the operation with the new playwright instance
				this.browserContext = await this.chromium.launchPersistentContext(
					this.browserProfile.userDataDir!,
					modelDump(this.browserProfile.kwargsForLaunchPersistentContext()),
				);
			} else {
				throw error;
			}
		}
	}

	private async handleBrowserLaunchError(error: any): Promise<void> {
		/**
		 * Handle browser launch errors with detailed logging
		 */
		// Calculate browser versions for error reporting
		// userDataDir is corrupted or unreadable because it was migrated to a newer version of chrome than we are running with
		let userDataDirChromeVersion = "???";
		let testBrowserVersion = "???";

		try {
			// Check if user_data_dir has version info
			const lastVersionPath = path.join(
				this.browserProfile.userDataDir!,
				"Last Version",
			);
			if (fs.existsSync(lastVersionPath)) {
				userDataDirChromeVersion = fs
					.readFileSync(lastVersionPath, "utf8")
					.trim();
			}
		} catch (e) {
			// Ignore version detection errors
			// let the logger below handle it
		}
		try {
			// Get test browser version
			if (this.chromium) {
				const testBrowser = await this.chromium.launch({ headless: true });
				testBrowserVersion = testBrowser.version();
				await testBrowser.close();
			}
		} catch (e: any) {
			// Log test browser errors for debugging
			this.logger.debug(
				`Failed to get test browser chromium version: ${e.constructor.name}: ${e.message}`,
			);
		}

		// Determine error reason
		// failed to parse extensions == most common error text when userDataDir is corrupted / has an unusable schema
		const reason = error.message.includes("Failed parsing extensions")
			? "due to bad"
			: "for unknown reason with";
		const driver = this.browserProfile.stealth ? "patchright" : "playwright";
		const browserChannel = this.browserProfile.executablePath
			? path
					.basename(this.browserProfile.executablePath)
					.replace(" ", "-")
					.replace(".exe", "")
					.toLowerCase()
			: (this.browserProfile.channel || BROWSERNODE_DEFAULT_CHANNEL)
					.toString()
					.toLowerCase();

		this.logger.error(
			`❌ Launching new local browser ${driver}:${browserChannel} (v${testBrowserVersion}) failed!\n` +
				`\tFailed ${reason} userDataDir= ${logPrettyPath(this.browserProfile.userDataDir!)} (created with v${userDataDirChromeVersion})\n` +
				`\tTry using a different browser version/channel or delete the userDataDir to start over with a fresh profile.\n` +
				`\t(can happen if different versions of Chrome/Chromium/Brave/etc. tried to share one dir)\n\n` +
				`${error.constructor.name} ${error.message}`,
		);
	}

	private async detectNewBrowserProcess(
		childPidsBeforeLaunch: Set<number>,
	): Promise<void> {
		/**
		 * Detect any new child chrome processes that we might have launched
		 */
		const childPidsAfterLaunch = await this.getChildProcessPids();

		const newChildPids = new Set(
			[...childPidsAfterLaunch].filter(
				(pid) => !childPidsBeforeLaunch.has(pid),
			),
		);

		const newChromeProcs: Array<{
			pid: number;
			executablePath: string;
			cmdline?: string[];
		}> = [];

		for (const pid of newChildPids) {
			const proc = await this.isOurChromeProcess(pid);
			if (proc) {
				newChromeProcs.push(proc);
			}
		}

		if (newChromeProcs.length === 0) {
			this.logger.debug(
				`❌ Failed to find any new child chrome processes after launching new browser: ${Array.from(newChildPids)}`,
			);
			// Browser PID detection can fail in some environments (e.g. CI, containers)
			// This is not critical - the browser is still running and usable
			this.browserPid = undefined;
			// } else if (newChromeProcs.length > 1) {
			//   this.logger.debug(
			//     `❌ Found multiple new child chrome processes after launching new browser: ${newChromeProcs.map((p) => p.pid)}`,
			//   );
			//   this.browserPid = undefined;
			// } else {
		} else if (newChromeProcs.length === 1) {
			// Single Chrome process found - use it
			const newChromeProc = newChromeProcs[0];
			if (newChromeProc) {
				this.browserPid = newChromeProc.pid;

				// look through the discovered new chrome processes to uniquely identify the one that *we* launched,
				// match using unique userDataDir
				// try {
				//   this.logger.info(
				//     `↳ Spawned browserPid=${this.browserPid} ${logPrettyPath(newChromeProc.executablePath)}`,
				//   );
				//   if (newChromeProc.cmdline) {
				//     this.logger.debug(newChromeProc.cmdline.join(" "));
				//   }
				//   this.setBrowserKeepAlive(false); // close the browser at the end because we launched it
				// } catch (error: any) {
				//   this.logger.warn(
				//     `Browser process ${this.browserPid} died immediately after launch: ${error.constructor.name}`,
				this.logger.info(
					`↳ Spawned browserPid=${this.browserPid} ${logPrettyPath(newChromeProc.executablePath)}`,
				);
				if (newChromeProc.cmdline) {
					this.logger.debug(newChromeProc.cmdline.join(" "));
				}
				this.setBrowserKeepAlive(false); // close the browser at the end because we launched it
			}
		} else {
			// Multiple Chrome processes found - this is normal for Chrome's multi-process architecture
			// Find the main browser process (the one without --type= parameter)
			const mainProcess = newChromeProcs.find(
				(proc) =>
					proc.cmdline && !proc.cmdline.some((arg) => arg.includes("--type=")),
			);

			if (mainProcess) {
				this.browserPid = mainProcess.pid;
				this.logger.info(
					`↳ Spawned browserPid=${this.browserPid} ${logPrettyPath(mainProcess.executablePath)} (main process among ${newChromeProcs.length} Chrome processes)`,
				);
				if (mainProcess.cmdline) {
					this.logger.debug(mainProcess.cmdline.join(" "));
				}
				this.setBrowserKeepAlive(false); // close the browser at the end because we launched it
			} else {
				// Fallback: use the first process if we can't identify the main one
				const firstProc = newChromeProcs[0];
				if (firstProc) {
					this.browserPid = firstProc.pid;
					this.logger.info(
						`↳ Spawned browserPid=${this.browserPid} ${logPrettyPath(firstProc.executablePath)} (fallback: first of ${newChromeProcs.length} Chrome processes)`,
					);
					this.setBrowserKeepAlive(false);
				}
			}
		}
	}

	private async isOurChromeProcess(pid: number): Promise<{
		pid: number;
		executablePath: string;
		cmdline?: string[];
	} | null> {
		/**
		 * Check if a process is our chrome process
		 */
		try {
			// Check if process exists
			process.kill(pid, 0);

			// Get command line for the process
			const cmdline = await this.getProcessCommandLine(pid);
			if (!cmdline || cmdline.length === 0) {
				return null;
			}

			const executablePath = cmdline[0];
			if (!executablePath) return null;

			// Skip helper processes
			if (executablePath.includes("Helper")) {
				return null;
			}

			// Check if it matches our executable path
			if (this.browserProfile.executablePath) {
				const expectedPath = path.resolve(this.browserProfile.executablePath);
				const actualPath = path.resolve(executablePath);
				if (expectedPath !== actualPath) {
					return null;
				}
			}

			// Check if it matches our user data dir
			if (this.browserProfile.userDataDir) {
				const expectedUserDataDir = path.resolve(
					this.browserProfile.userDataDir,
				);
				const userDataDirArg = cmdline.find((arg) =>
					arg.startsWith("--user-data-dir="),
				);
				if (userDataDirArg) {
					const userDataDirValue = userDataDirArg.split("=")[1];
					if (userDataDirValue) {
						const actualUserDataDir = path.resolve(userDataDirValue);
						if (expectedUserDataDir === actualUserDataDir) {
							return { pid, executablePath, cmdline };
						}
					}
				}
			} else {
				// If no userDataDir is set, check if this looks like a main chrome process
				if (
					executablePath.toLowerCase().includes("chrom") &&
					!cmdline.some((arg) => arg.includes("--type="))
				) {
					return { pid, executablePath, cmdline };
				}
			}

			return null;
		} catch (error) {
			return null;
		}
	}

	private async addInitScripts(): Promise<void> {
		/**
		 * Add initialization scripts to the browser context
		 */
		if (!this.browserContext) return;

		const initScript = `
			// check to make sure we're not inside the PDF viewer
			window.isPdfViewer = !!document?.body?.querySelector('body > embed[type="application/pdf"][width="100%"]')
			if (!window.isPdfViewer) {

				// Permissions
				const originalQuery = window.navigator.permissions.query;
				window.navigator.permissions.query = (parameters) => (
					parameters.name === 'notifications' ?
						Promise.resolve({ state: Notification.permission }) :
						originalQuery(parameters)
				);
				(() => {
					if (window._eventListenerTrackerInitialized) return;
					window._eventListenerTrackerInitialized = true;

					const originalAddEventListener = EventTarget.prototype.addEventListener;
					const eventListenersMap = new WeakMap();

					EventTarget.prototype.addEventListener = function(type, listener, options) {
						if (typeof listener === "function") {
							let listeners = eventListenersMap.get(this);
							if (!listeners) {
								listeners = [];
								eventListenersMap.set(this, listeners);
							}

							listeners.push({
								type,
								listener,
								listenerPreview: listener.toString().slice(0, 100),
								options
							});
						}

						return originalAddEventListener.call(this, type, listener, options);
					};

					window.getEventListenersForNode = (node) => {
						const listeners = eventListenersMap.get(node) || [];
						return listeners.map(({ type, listenerPreview, options }) => ({
							type,
							listenerPreview,
							options
						}));
					};
				})();
			}
		`;
		// Expose anti-detection scripts
		try {
			await this.browserContext.addInitScript(initScript);
		} catch (error: any) {
			if (
				error.message.includes(
					"Target page, context or browser has been closed",
				)
			) {
				this.logger.warn(
					"⚠️ Browser context was closed before init script could be added",
				);
				// Reset connection state since browser is no longer valid
				this.resetConnectionState();
			} else {
				throw error;
			}
		}

		// Log stealth warning if needed
		if (
			this.browserProfile.stealth &&
			!(this.chromium && this.chromium.constructor.name.includes("Patchright"))
		) {
			this.logger.warn(
				"⚠️ Failed to set up stealth mode. Got normal playwright objects as input.",
			);
		}
	}

	private logPrettyPath(filePath?: string): string {
		/**
		 * Format file path for pretty logging
		 */
		if (!filePath) return "";

		try {
			// Try to make path relative to home directory
			const homedir = os.homedir();
			if (filePath.startsWith(homedir)) {
				return `~${filePath.substring(homedir.length)}`;
			}
			return filePath;
		} catch (error) {
			return filePath;
		}
	}

	private setBrowserKeepAlive(keepAlive?: boolean): void {
		/**
		 * Set the keepAlive flag on the browserProfile
		 */
		if (this.browserProfile.keepAlive === undefined) {
			this.browserProfile.keepAlive = keepAlive;
		}
	}

	private async createTempUserDataDir(): Promise<string> {
		/**
		 * Create a temporary user data directory
		 */
		const tmpDir = os.tmpdir();
		const tempPath = path.join(tmpDir, `browsernode-tmp-`);
		fs.mkdirSync(tempPath, { recursive: true });
		return tempPath;
	}

	private async setupCurrentPageChangeListeners(): Promise<void> {
		/**
		 * Set up listeners to detect when the user switches tabs manually
		 * Uses a combination of:
		 * - visibilitychange events
		 * - window focus/blur events
		 * - pointermove events
		 *
		 * This annoying multi-method approach is needed for more reliable detection across browsers because playwright provides no API for this.
		 *
		 * TODO: pester the playwright team to add a new event that fires when a headful tab is focused.
		 * OR implement a browsernode chrome extension that acts as a bridge to the chrome.tabs API.
		 *
		 *         - https://github.com/microsoft/playwright/issues/1290
		 *         - https://github.com/microsoft/playwright/issues/2286
		 *         - https://github.com/microsoft/playwright/issues/3570
		 *         - https://github.com/microsoft/playwright/issues/13989
		 */

		// Set up / detect foreground page
		if (!this.browserContext) {
			throw new Error("BrowserContext object is not set");
		}

		const pages = this.browserContext.pages();
		let foregroundPage: Page | undefined;

		if (pages.length > 0) {
			foregroundPage = pages[0];
			// Generate a simple hash-based identifier for the page
			const pageId = foregroundPage
				? Math.abs(
						foregroundPage
							.url()
							.split("")
							.reduce((a, b) => {
								a = (a << 5) - a + b.charCodeAt(0);
								return a & a;
							}, 0),
					)
						.toString(16)
						.slice(-2)
				: "??";
			this.logger.debug(
				`👁️‍🗨️ Found ${pages.length} existing tabs in browser, Agent 🅰 ${this.id.slice(-4)}.${pageId} will start focused on tab 🄿 [${pages.indexOf(foregroundPage as any)}]: ${foregroundPage?.url() || "unknown"}`,
			);
		} else {
			foregroundPage = await this.browserContext.newPage();
			this.logger.debug("➕ Opened new tab in empty browser context...");
		}

		this.agentCurrentPage = this.agentCurrentPage || foregroundPage;
		this.humanCurrentPage = this.humanCurrentPage || foregroundPage;
		// this.logger.debug("About to define _BrowsernodeonTabVisibilityChange callback");

		// Define the callback function for tab visibility changes
		const _BrowsernodeonTabVisibilityChange = (source: {
			page: Page;
		}): void => {
			/**
			 * Hook callback fired when init script injected into a page detects a focus event
			 */
			const newPage = source.page;

			// Update human foreground tab state
			const oldForeground = this.humanCurrentPage;
			if (!this.browserContext) {
				throw new Error("BrowserContext object is not set");
			}
			if (!oldForeground) {
				throw new Error("Old foreground page is not set");
			}

			const oldTabIdx = this.browserContext
				.pages()
				.indexOf(oldForeground as any);
			this.humanCurrentPage = newPage;
			const newTabIdx = this.browserContext.pages().indexOf(newPage as any);

			// Log before and after for debugging
			const oldUrl = oldForeground?.url() || "about:blank";
			const newUrl = newPage?.url() || "about:blank";
			const agentUrl = this.agentCurrentPage?.url() || "about:blank";
			const agentTabIdx = this.browserContext
				.pages()
				.indexOf(this.agentCurrentPage! as any);

			if (oldUrl !== newUrl) {
				this.logger.info(
					`👁️ Foreground tab changed by human from [${oldTabIdx}]${logPrettyUrl(oldUrl)} ` +
						`➡️ [${newTabIdx}]${logPrettyUrl(newUrl)} ` +
						`(agent will stay on [${agentTabIdx}]${logPrettyUrl(agentUrl)})`,
				);
			}
		};

		// Store the callback so we can potentially clean it up later
		this._tabVisibilityCallback = _BrowsernodeonTabVisibilityChange;
		// this.logger.info('About to call expose_binding')
		try {
			await (this.browserContext as any).exposeBinding(
				"_BrowsernodeonTabVisibilityChange",
				_BrowsernodeonTabVisibilityChange,
			);
			// this.logger.debug('window.browsernodeOnTabVisibilityChange binding attached via browser_context')
		} catch (error: any) {
			if (
				error.message.includes(
					'Function "_BrowsernodeonTabVisibilityChange" has been already registered',
				)
			) {
				this.logger.debug(
					'⚠️ Function "_BrowsernodeonTabVisibilityChange" has been already registered, ' +
						"this is likely because the browser was already started with an existing BrowserSession()",
				);
			} else {
				throw error;
			}
		}

		const updateTabFocusScript = `
			// --- Method 1: visibilitychange event (unfortunately *all* tabs are always marked visible by playwright, usually does not fire) ---
			document.addEventListener('visibilitychange', async () => {
				if (document.visibilityState === 'visible') {
					await window._BrowsernodeonTabVisibilityChange({ source: 'visibilitychange', url: document.location.href });
					console.log('Browsernode Foreground tab change event fired', document.location.href);
				}
			});
			
			// --- Method 2: focus/blur events, most reliable method for headful browsers ---
			window.addEventListener('focus', async () => {
				await window._BrowsernodeonTabVisibilityChange({ source: 'focus', url: document.location.href });
				console.log('Browsernode Foreground tab change event fired', document.location.href);
			});
			
			// --- Method 3: pointermove events (may be fired by agent if we implement AI hover movements, also very noisy) ---
			// Use a throttled handler to avoid excessive calls
			// let lastMove = 0;
			// window.addEventListener('pointermove', async () => {
			// 	const now = Date.now();
			// 	if (now - lastMove > 1000) {  // Throttle to once per second
			// 		lastMove = now;
			// 		await window._BrowsernodeonTabVisibilityChange({ source: 'pointermove', url: document.location.href });
			//      console.log('Browsernode Foreground tab change event fired', document.location.href);
			// 	}
			// });
		`;

		try {
			await this.browserContext.addInitScript(updateTabFocusScript);
		} catch (error: any) {
			this.logger.warn(
				`⚠️ Failed to register init script for tab focus detection: ${error.message}`,
			);
		}

		// Set up visibility listeners for all existing tabs
		for (const page of this.browserContext.pages()) {
			// Skip about:blank pages as they can hang when evaluating scripts
			if (page.url() === "about:blank") {
				continue;
			}

			try {
				await (page as any).evaluate(updateTabFocusScript);
				// this.logger.debug(`Added visibility listener to tab: ${page.url()}`)
			} catch (error: any) {
				const pageIdx = this.browserContext.pages().indexOf(page as any);
				this.logger.debug(
					`⚠️ Failed to add visibility listener to existing tab, is it crashed or ignoring CDP commands?: [${pageIdx}]${page.url()}: ${error.constructor.name}: ${error.message}`,
				);
			}
		}
	}

	/**
	 * Resize any existing page viewports to match the configured size, set up storage_state, permissions, geolocation, etc.
	 */
	private async _setupViewports(): Promise<void> {
		if (!this.browserContext) {
			throw new Error(
				"BrowserSession.browserContext must already be set up before calling _setupViewports()",
			);
		}

		// log the viewport settings to terminal
		const viewport = this.browserProfile.viewport;
		this.logger.debug(
			"📐 Setting up viewport: " +
				`headless=${this.browserProfile.headless} ` +
				(this.browserProfile.windowSize
					? `window=${this.browserProfile.windowSize.width}x${this.browserProfile.windowSize.height}px `
					: "(no window) ") +
				(this.browserProfile.screen
					? `screen=${this.browserProfile.screen.width}x${this.browserProfile.screen.height}px `
					: "") +
				(viewport
					? `viewport=${viewport.width}x${viewport.height}px `
					: "(no viewport) ") +
				`deviceScaleFactor=${this.browserProfile.deviceScaleFactor || 1.0} ` +
				`isMobile=${this.browserProfile.isMobile} ` +
				(this.browserProfile.colorScheme
					? `colorScheme=${this.browserProfile.colorScheme} `
					: "") +
				(this.browserProfile.locale
					? `locale=${this.browserProfile.locale} `
					: "") +
				(this.browserProfile.timezoneId
					? `timezoneId=${this.browserProfile.timezoneId} `
					: "") +
				(this.browserProfile.geolocation
					? `geolocation=${JSON.stringify(this.browserProfile.geolocation)} `
					: "") +
				`permissions=${(this.browserProfile.permissions || ["<none>"]).join(",")} ` +
				`storageState=${logPrettyPath(
					typeof this.browserProfile.storageState === "string"
						? this.browserProfile.storageState
						: this.browserProfile.cookiesFile || "<none>",
				)} `,
		);

		// if we have any viewport settings in the profile, make sure to apply them to the entire browser_context as defaults
		if (this.browserProfile.permissions) {
			try {
				await this.browserContext.grantPermissions(
					this.browserProfile.permissions,
				);
			} catch (error: any) {
				this.logger.warn(
					`⚠️ Failed to grant browser permissions ${JSON.stringify(this.browserProfile.permissions)}: ${error.constructor.name}: ${error.message}`,
				);
			}
		}

		// Set timeouts
		try {
			if (this.browserProfile.defaultTimeout) {
				this.browserContext.setDefaultTimeout(
					this.browserProfile.defaultTimeout,
				);
			}
			if (this.browserProfile.defaultNavigationTimeout) {
				this.browserContext.setDefaultNavigationTimeout(
					this.browserProfile.defaultNavigationTimeout,
				);
			}
		} catch (error: any) {
			this.logger.warn(
				`⚠️ Failed to set playwright timeout settings ` +
					`cdpApi=${this.browserProfile.defaultTimeout} ` +
					`navigation=${this.browserProfile.defaultNavigationTimeout}: ${error.constructor.name}: ${error.message}`,
			);
		}

		// Set extra HTTP headers
		if (this.browserProfile.extraHTTPHeaders) {
			try {
				await this.browserContext.setExtraHTTPHeaders(
					this.browserProfile.extraHTTPHeaders,
				);
			} catch (error: any) {
				this.logger.warn(
					`⚠️ Failed to setup playwright extraHTTPHeaders: ${error.constructor.name}: ${error.message}`,
				); // dont print the secret header contents in the logs!
			}
		}

		// Set geolocation
		if (this.browserProfile.geolocation) {
			try {
				await this.browserContext.setGeolocation(
					this.browserProfile.geolocation,
				);
			} catch (error: any) {
				this.logger.warn(
					`⚠️ Failed to update browser geolocation ${JSON.stringify(this.browserProfile.geolocation)}: ${error.constructor.name}: ${error.message}`,
				);
			}
		}

		// Load storage state
		await this.loadStorageState();

		let page: Page | undefined;

		// Apply viewport to existing pages
		const pages = this.browserContext.pages();
		for (const currentPage of pages) {
			page = currentPage;
			// apply viewport size settings to any existing pages
			if (viewport) {
				await currentPage.setViewportSize(viewport);
			}

			// show browsernode dvd screensaver-style bouncing loading animation on any about:blank pages
			if (currentPage.url() === "about:blank") {
				await this.showDvdScreensaverLoadingAnimation(currentPage);
			}
		}

		// Create a page if none exist
		page = page || (await this.browserContext.newPage());

		// Resize browser window if no viewport is set but window size is specified
		if (
			!viewport &&
			this.browserProfile.windowSize &&
			!this.browserProfile.headless
		) {
			// attempt to resize the actual browser window
			await this.resizeBrowserWindow(page);

			// After resizing, apply the updated viewport to all existing pages
			if (this.browserProfile.viewport) {
				for (const currentPage of this.browserContext.pages()) {
					try {
						await currentPage.setViewportSize(this.browserProfile.viewport);
					} catch (error: any) {
						this.logger.warn(
							`⚠️ Failed to apply viewport to existing page: ${error.constructor.name}: ${error.message}`,
						);
					}
				}
			}
		}
	}

	private async resizeBrowserWindow(page: Page): Promise<void> {
		/**
		 * Attempt to resize the actual browser window using CDP API with JavaScript fallback
		 */
		if (!this.browserProfile.windowSize) {
			return;
		}

		const logSize = (size: { width: number; height: number }) =>
			`${size.width}x${size.height}px`;

		try {
			// attempt to resize the actual browser window
			// CDP API: https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-setWindowBounds
			const cdpSession = await page.context().newCDPSession(page as any);
			const windowIdResult = await (cdpSession as any).send(
				"Browser.getWindowForTarget",
			);
			await (cdpSession as any).send("Browser.setWindowBounds", {
				windowId: windowIdResult.windowId,
				bounds: {
					...this.browserProfile.windowSize,
					windowState: "normal", // Ensure window is not minimized/maximized
				},
			});
			await cdpSession.detach();

			// After resizing the window, also resize the viewport to match
			// This ensures the page content fills the entire window
			const viewportSize = {
				width: this.browserProfile.windowSize.width,
				height: this.browserProfile.windowSize.height,
			};
			await page.setViewportSize(viewportSize);
			// Update browserProfile.viewport so other methods can use it
			this.browserProfile.viewport = viewportSize;
			this.logger.debug(
				`📐 Resized viewport to match window size: ${logSize(viewportSize)}`,
			);
		} catch (error: any) {
			try {
				// Fallback to JavaScript resize if CDP setWindowBounds fails
				await (page as any).evaluate(
					`(width, height) => { window.resizeTo(width, height); }`,
					this.browserProfile.windowSize.width,
					this.browserProfile.windowSize.height,
				);

				// Also resize viewport in fallback case
				const viewportSize = {
					width: this.browserProfile.windowSize.width,
					height: this.browserProfile.windowSize.height,
				};
				await page.setViewportSize(viewportSize);
				// Update browserProfile.viewport so other methods can use it
				this.browserProfile.viewport = viewportSize;
				this.logger.debug(
					`📐 Resized viewport to match window size (fallback): ${logSize(viewportSize)}`,
				);
				return;
			} catch (fallbackError) {
				// Both methods failed
				this.logger.warn(
					`⚠️ Failed to resize browser window to ${logSize(this.browserProfile.windowSize)} using both CDP setWindowBounds and JavaScript fallback: ${error.constructor.name}: ${error.message}`,
				);
			}
		}
	}

	public async isConnected(restart: boolean = true): Promise<boolean> {
		/**
		 * Check if the browser session has valid, connected browser and context objects.
		 * @returns
		 * Returns False if any of the following conditions are met:
		 * - No browser_context exists
		 * - Browser exists but is disconnected
		 * - Browser_context's browser exists but is disconnected
		 * - Browser_context itself is closed/unusable
		 *
		 * @param restart: If True, will attempt to create a new tab if no pages exist (valid contexts must always have at least one page open).
		 *            If False, will only check connection status without side effects.
		 */
		if (!this.browserContext) {
			return false;
		}

		if (
			this.browserContext.browser() &&
			!this.browserContext.browser()?.isConnected()
		) {
			return false;
		}

		// Check if the browserContext itself is closed/unusable
		try {
			if (this.browserContext.pages().length > 0) {
				// Use the first available page to test the connection
				const testPage = this.browserContext.pages()[0];
				const result = await (testPage as any).evaluate("() => true");
				return result === true;
			} else if (restart) {
				await this.createNewTab();
				if (this.browserContext.pages().length > 0) {
					const testPage = this.browserContext.pages()[0];
					const result = await (testPage as any).evaluate("() => true");
					return result === true;
				}
				return false;
			} else {
				return false;
			}
		} catch (error) {
			return false;
		}
	}

	resetConnectionState(): void {
		/**
		 * Reset the browser connection state when disconnection is detected
		 */
		const alreadyDisconnected = !(
			this.initialized ||
			this.browser ||
			this.browserContext ||
			this.agentCurrentPage ||
			this.humanCurrentPage ||
			this._cachedClickableElementHashes ||
			this._cachedBrowserStateSummary
		);

		this.initialized = false;
		this.browser = undefined;
		this.browserContext = undefined;
		this.agentCurrentPage = undefined;
		this.humanCurrentPage = undefined;
		this._cachedClickableElementHashes = undefined;
		this._cachedBrowserStateSummary = undefined;

		if (this.browserPid) {
			try {
				// Check if process is still alive and serving a remote debugging port
				// Implementation would need process checking logic here
				// For now, just clear the PID
				this.browserPid = undefined;
			} catch (error) {
				this.logger.info(
					`↳ Browser browserPid=${this.browserPid} process is no longer running`,
				);
				this.browserPid = undefined;
			}
		}

		if (!alreadyDisconnected) {
			this.logger.debug(`⚰️ Browser ${this.connectionStr} disconnected`);
		}
	}
	/**
	 * Create and unlock the user data dir and ensure all recording paths exist.
	 */
	public prepareUserDataDir(): void {
		if (this.browserProfile.userDataDir) {
			try {
				fs.mkdirSync(this.browserProfile.userDataDir, { recursive: true });
				fs.writeFileSync(
					path.join(this.browserProfile.userDataDir, ".browsernode_profile_id"),
					this.browserProfile.id,
				);
			} catch (error: any) {
				throw new Error(
					`Unusable path provided for userDataDir= ${this.browserProfile.userDataDir} (check for typos/permissions issues)`,
				);
			}

			// Clear any existing locks by any other chrome processes (hacky)
			const singletonLock = path.join(
				this.browserProfile.userDataDir,
				"SingletonLock",
			);
			if (fs.existsSync(singletonLock)) {
				fs.unlinkSync(singletonLock);
				this.logger.warn(
					`⚠️ Multiple chrome processes may be trying to share userDataDir=${this.browserProfile.userDataDir}`,
				);
			}
		}

		// Create directories for all paths that need them
		const dirPaths = {
			downloadsPath: this.browserProfile.downloadsPath,
			recordVideoDir: this.browserProfile.recordVideoDir,
			tracesDir: this.browserProfile.tracesDir,
		};

		const filePaths = {
			recordHarPath: this.browserProfile.recordHarPath,
		};

		// Handle directory creation
		for (const [pathName, pathValue] of Object.entries(dirPaths)) {
			if (pathValue) {
				try {
					fs.mkdirSync(pathValue, { recursive: true });
				} catch (error: any) {
					this.logger.error(
						`❌ Failed to create ${pathName} directory ${pathValue}: ${error.message}`,
					);
				}
			}
		}

		// Handle file path parent directory creation
		for (const [pathName, pathValue] of Object.entries(filePaths)) {
			if (pathValue) {
				try {
					fs.mkdirSync(path.dirname(pathValue), { recursive: true });
				} catch (error: any) {
					this.logger.error(
						`❌ Failed to create parent directory for ${pathName} ${pathValue}: ${error.message}`,
					);
				}
			}
		}
	}

	// --- Tab Management ---
	/**
	 * Get the current page + ensure it's not null / closed
	 */
	public async getCurrentPage(): Promise<Page> {
		if (!this.initialized) {
			await this.start();
		}

		// Get-or-create the browserContext if it's not already set up
		if (!this.browserContext) {
			await this.start();
			if (!this.browserContext) {
				throw new Error("BrowserContext is not set up");
			}
		}

		// If either focused page is closed, clear it so we dont use a dead object
		if (!this.humanCurrentPage || this.humanCurrentPage.isClosed()) {
			this.humanCurrentPage = undefined;
		}
		if (!this.agentCurrentPage || this.agentCurrentPage.isClosed()) {
			this.agentCurrentPage = undefined;
		}

		// If either one is undefined, fallback to using the other one for both
		this.agentCurrentPage = this.agentCurrentPage || this.humanCurrentPage;
		this.humanCurrentPage = this.humanCurrentPage || this.agentCurrentPage;

		// If both are still undefined, fallback to using the first open tab  we can find
		if (!this.agentCurrentPage) {
			const pages = this.browserContext.pages();
			if (pages.length > 0) {
				const firstAvailableTab = pages[0];
				this.agentCurrentPage = firstAvailableTab;
				this.humanCurrentPage = firstAvailableTab;
			} else {
				// If all tabs are closed, open a new one ,never allow a context with 0 tabs
				const newTab = await this.createNewTab();
				this.agentCurrentPage = newTab;
				this.humanCurrentPage = newTab;
			}
		}

		if (!this.agentCurrentPage) {
			throw new Error(
				`${this.toString()} Failed to find or create a new page for the agent`,
			);
		}
		if (!this.humanCurrentPage) {
			throw new Error(
				`${this.toString()} Failed to find or create a new page for the human`,
			);
		}

		return this.agentCurrentPage;
	}

	public get tabs(): Page[] {
		if (!this.browserContext) {
			return [];
		}
		return this.browserContext.pages();
	}

	@requireInitialization
	public async newTab(url?: string): Promise<Page> {
		return await this.createNewTab(url);
	}

	@requireInitialization
	public async switchTab(tabIndex: number): Promise<Page> {
		if (!this.browserContext) {
			throw new Error("BrowserContext is not set up");
		}

		const pages = this.browserContext.pages();
		if (!pages || tabIndex >= pages.length) {
			throw new Error("Tab index out of range");
		}

		const page = pages[tabIndex];
		this.agentCurrentPage = page;

		// Invalidate cached state since we've switched to a different tab
		// The cached state contains DOM elements and selector map from the previous tab
		this._cachedBrowserStateSummary = undefined;
		this._cachedClickableElementHashes = undefined;

		return page as Page;
	}

	@requireInitialization
	public async waitForElement(
		selector: string,
		timeout: number = 10000,
	): Promise<void> {
		const page = await this.getCurrentPage();
		await page.waitForSelector(selector, { state: "visible", timeout });
	}

	@timeExecution("--removeHighlights")
	public async removeHighlights(): Promise<void> {
		/**
		 * Removes all highlight overlays and labels created by the highlightElement function.
		 * Handles cases where the page might be closed or inaccessible.
		 */
		const page = await this.getCurrentPage();
		try {
			await (page as any).evaluate(`
				try {
					// Remove the highlight container and all its contents
					const container = document.getElementById('playwright-highlight-container');
					if (container) {
						container.remove();
					}

					// Remove highlight attributes from elements
					const highlightedElements = document.querySelectorAll('[browsernode-highlight-id^="playwright-highlight-"]');
					highlightedElements.forEach(el => {
						el.removeAttribute('browsernode-highlight-id');
					});
				} catch (e) {
					console.error('Failed to remove highlights:', e);
				}
			`);
		} catch (error: any) {
			this.logger.debug(
				`⚠️ Failed to remove highlights (this is usually ok): ${error.constructor.name}: ${error.message}`,
			);
			// Don't raise the error since this is not critical functionality
		}
	}

	/**
	 * Get DOM element by index.
	 */
	@requireInitialization
	public async getDomElementByIndex(
		index: number,
	): Promise<DOMElementNode | null> {
		const selectorMap = await this.getSelectorMap();
		return selectorMap[index] || null;
	}

	/**
	 * Optimized method to click an element using xpath.
	 */
	@requireInitialization
	@timeExecution("--clickElementNode")
	async _clickElementNode(elementNode: DOMElementNode): Promise<string | null> {
		const page = await this.getCurrentPage();
		try {
			// Highlight before clicking
			// if (elementNode.highlightIndex !== undefined) {
			// 	await this._updateState(focusElement: elementNode.highlightIndex);
			// }

			let elementHandle = await this.getLocateElement(elementNode);

			if (elementHandle === null) {
				throw new Error(`Element: ${JSON.stringify(elementNode)} not found`);
			}

			/**
			 * Performs the actual click, handling both download and navigation scenarios.
			 */
			const performClick = async (
				clickFunc: () => Promise<void>,
			): Promise<string | null> => {
				// only wait the 5s extra for potential downloads if they are enabled
				// TODO: instead of blocking for 5s, we should register a non-block page.on('download') event
				// and then check if the download has been triggered within the event handler
				if (this.browserProfile.downloadsPath) {
					try {
						// Try short-timeout expect_download to detect a file download has been triggered
						const downloadPromise = (this.browserContext as any).waitForEvent(
							"download",
							{
								timeout: 5000,
							},
						);
						await clickFunc();
						const download = await downloadPromise;

						// Determine file path
						const suggestedFilename = download.suggestedFilename();
						const uniqueFilename = await BrowserSession._getUniqueFilename(
							this.browserProfile.downloadsPath,
							suggestedFilename,
						);
						// Track the downloaded file in the session
						const downloadPath = path.join(
							this.browserProfile.downloadsPath,
							uniqueFilename,
						);
						await download.saveAs(downloadPath);
						this.logger.info(`⬇️ Downloaded file to: ${downloadPath}`);

						// Track the downloaded file in the session
						this._downloadedFiles.push(downloadPath);
						this.logger.info(
							`📁 Added download to session tracking (total: ${this._downloadedFiles.length} files)`,
						);

						return downloadPath;
					} catch (error) {
						// If no download is triggered, treat as normal click
						this.logger.debug(
							"No download triggered within timeout. Checking navigation...",
						);
						try {
							await page.waitForLoadState();
						} catch (e: any) {
							this.logger.warn(
								`⚠️ Page ${logPrettyUrl(page.url())} failed to finish loading after click: ${e.constructor.name}: ${e.message}`,
							);
						}
						await this._checkAndHandleNavigation(page);
					}
				} else {
					// If downloads are disabled, just perform the click
					await clickFunc();
					try {
						await page.waitForLoadState();
					} catch (e: any) {
						this.logger.warn(
							`⚠️ Page ${logPrettyUrl(page.url())} failed to finish loading after click: ${e.constructor.name}: ${e.message}`,
						);
					}
					await this._checkAndHandleNavigation(page);
				}
				return null;
			};

			try {
				return await performClick(async () => {
					if (elementHandle) {
						await elementHandle.click({ timeout: 1500 });
					}
				});
			} catch (error: any) {
				if (error instanceof URLNotAllowedError) {
					throw error;
				}

				// Check if it's a context error and provide more info
				if (
					error.message.includes("Cannot find context with specified id") ||
					error.message.includes("Protocol error")
				) {
					this.logger.warn(
						`⚠️ Element context lost, attempting to re-locate element: ${error.constructor.name}`,
					);
					// Try to re-locate the element
					elementHandle = await this.getLocateElement(elementNode);
					if (elementHandle === null) {
						throw new Error(
							`Element no longer exists in DOM after context loss: ${JSON.stringify(elementNode)}`,
						);
					}
					// Try click again with fresh element
					try {
						return await performClick(async () => {
							if (elementHandle) {
								await elementHandle.click({ timeout: 1500 });
							}
						});
					} catch (retryError) {
						// Fall back to JavaScript click
						return await performClick(async () => {
							if (elementHandle) {
								await (page as any).evaluate(
									(el: any) => el.click(),
									elementHandle,
								);
							}
						});
					}
				} else {
					// Original fallback for other errors
					try {
						return await performClick(async () => {
							if (elementHandle) {
								await (page as any).evaluate(
									(el: any) => el.click(),
									elementHandle,
								);
							}
						});
					} catch (fallbackError: any) {
						if (fallbackError instanceof URLNotAllowedError) {
							throw fallbackError;
						}

						// Final fallback - try clicking by coordinates if available
						if (
							elementNode.viewportCoordinates &&
							elementNode.viewportCoordinates.center
						) {
							try {
								this.logger.warn(
									`⚠️ Element click failed, falling back to coordinate click at (${elementNode.viewportCoordinates.center.x}, ${elementNode.viewportCoordinates.center.y})`,
								);
								await page.mouse.click(
									elementNode.viewportCoordinates.center.x,
									elementNode.viewportCoordinates.center.y,
								);
								try {
									await page.waitForLoadState();
								} catch (loadError) {
									// Ignore load errors
								}
								await this._checkAndHandleNavigation(page);
								return null; // Success
							} catch (coordError: any) {
								this.logger.error(
									`Coordinate click also failed: ${coordError.constructor.name}: ${coordError.message}`,
								);
							}
						}
						throw new Error(
							`Failed to click element: ${error.constructor.name}: ${error.message}`,
						);
					}
				}
			}
		} catch (error: any) {
			if (error instanceof URLNotAllowedError) {
				throw error;
			}
			throw new Error(
				`Failed to click element: ${JSON.stringify(elementNode)}. Error: ${error.message}`,
			);
		}
	}

	@requireInitialization
	@timeExecution("--getTabsInfo")
	public async getTabsInfo(): Promise<TabInfo[]> {
		/**
		 * Get information about all tabs
		 */
		if (!this.browserContext) {
			throw new Error("BrowserContext is not set up");
		}

		const tabsInfo: TabInfo[] = [];
		const pages = this.browserContext.pages();

		for (let pageId = 0; pageId < pages.length; pageId++) {
			const page = pages[pageId];
			try {
				const title = await this._getPageTitle(page as Page);
				const tabInfo: TabInfo = {
					pageId,
					url: (page as any).url(),
					title,
					parentPageId: null,
				};
				tabsInfo.push(tabInfo);
			} catch (error) {
				this.logger.debug(
					`⚠️ Failed to get tab info for tab #${pageId}: ${(page as any).url()} (ignoring)`,
				);
				const tabInfo: TabInfo = {
					pageId,
					url: "about:blank",
					title: "ignore this tab and do not use it",
					parentPageId: null,
				};
				tabsInfo.push(tabInfo);
			}
		}

		return tabsInfo;
	}

	/**
	 * Get page title with timeout protection.
	 */
	@retry({ timeout: 1, retries: 0 }) //  Single attempt with 1s timeout, no retries
	private async _getPageTitle(page: Page): Promise<string> {
		return await page.title();
	}

	@retry({ timeout: 20, retries: 1 })
	private async _setViewportSize(
		page: Page,
		viewport: { width: number; height: number },
	): Promise<void> {
		/**
		 * Set viewport size with timeout protection.
		 */
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
	}

	@requireInitialization
	public async closeTab(tabIndex?: number): Promise<void> {
		if (!this.browserContext) {
			throw new Error("BrowserContext is not set up");
		}

		const pages = this.browserContext.pages();
		if (!pages.length) {
			return;
		}

		let page: Page;
		if (tabIndex === undefined) {
			page = await this.getCurrentPage();
		} else {
			if (tabIndex >= pages.length || tabIndex < 0) {
				throw new Error(
					`Tab index ${tabIndex} out of range. Available tabs: ${pages.length}`,
				);
			}
			page = pages[tabIndex] as Page;
		}

		await page.close();

		// Reset page references to first available tab
		// Reset the self.agentCurrentPage and self.humanCurrentPage references to first available tab
		await this.getCurrentPage();
	}

	// --- Page Navigation ---
	@requireInitialization
	public async navigate(url: string): Promise<void> {
		const normalizedUrl = normalizeUrl(url);

		try {
			if (this.agentCurrentPage) {
				await this.agentCurrentPage.goto(normalizedUrl, {
					waitUntil: "domcontentloaded",
				});
			} else {
				await this.createNewTab(normalizedUrl);
			}
		} catch (error: any) {
			if (error.message.toLowerCase().includes("timeout")) {
				const timeout = this.browserProfile.defaultNavigationTimeout || 30000;
				this.logger.warn(
					`⚠️ Loading ${normalizedUrl} didn't finish after ${timeout / 1000}s, continuing anyway...`,
				);
			} else {
				throw error;
			}
		}
	}

	@requireInitialization
	public async refresh(): Promise<void> {
		if (this.agentCurrentPage && !this.agentCurrentPage.isClosed()) {
			await this.agentCurrentPage.reload();
		} else {
			await this.createNewTab();
		}
	}

	@requireInitialization
	public async executeJavascript(script: string): Promise<any> {
		const page = await this.getCurrentPage();
		return await (page as any).evaluate(script);
	}

	public async getCookies(): Promise<any[]> {
		if (this.browserContext) {
			return await this.browserContext.cookies();
		}
		return [];
	}

	public async saveCookies(...args: any[]): Promise<void> {
		/**
		 * Old name for the new saveStorageState() function.
		 */
		await this.saveStorageState(...args);
	}
	private async _saveCookiesToFile(
		filePath: string | undefined,
		cookies: any[] | null,
	): Promise<void> {
		if (!filePath && !this.browserProfile.cookiesFile) {
			return;
		}

		if (!cookies) {
			return;
		}

		let cookiesFilePath: string;
		try {
			// Use provided path or fallback to profile's cookies file
			const targetPath = filePath || this.browserProfile.cookiesFile!;

			// Resolve and normalize the path (TypeScript equivalent of Path().expanduser().resolve())
			cookiesFilePath = path.resolve(
				targetPath.startsWith("~")
					? targetPath.replace("~", os.homedir())
					: targetPath,
			);

			// Create parent directories
			const dir = path.dirname(cookiesFilePath);
			fs.mkdirSync(dir, { recursive: true });

			// Write to a temporary file first
			const safeCookies = cookies || [];
			const tempPath = cookiesFilePath + ".tmp";
			fs.writeFileSync(tempPath, JSON.stringify(safeCookies, null, 4));

			try {
				// Backup any existing cookies_file if one is already present
				if (fs.existsSync(cookiesFilePath)) {
					const backupPath =
						cookiesFilePath.replace(/\.json$/, "") + ".json.bak";
					fs.renameSync(cookiesFilePath, backupPath);
				}
			} catch (error) {
				// Ignore backup errors
			}

			fs.renameSync(tempPath, cookiesFilePath);
			this.logger.info(
				`🍪 Saved ${safeCookies.length} cookies to cookiesFile= ${logPrettyPath(cookiesFilePath)}`,
			);
		} catch (error: any) {
			this.logger.warn(
				`❌ Failed to save cookies to cookiesFile= ${logPrettyPath(cookiesFilePath!)}: ${error.constructor.name}: ${error.message}`,
			);
		}
	}

	private async _saveStorageStateToFile(
		_path: string,
		storageState: any,
	): Promise<void> {
		try {
			const dir = path.dirname(_path);
			fs.mkdirSync(dir, { recursive: true });

			// Atomic write: write to temp file first, then rename
			const tempPath = path + ".tmp";
			fs.writeFileSync(tempPath, JSON.stringify(storageState, null, 4));

			try {
				// Backup existing file
				if (fs.existsSync(_path)) {
					fs.renameSync(_path, _path + ".bak");
				}
			} catch (error) {
				// Ignore backup errors
			}

			fs.renameSync(tempPath, _path);

			const cookieCount = storageState.cookies?.length || 0;
			const originCount = storageState.origins?.length || 0;
			this.logger.info(
				`🍪 Saved ${cookieCount + originCount} cookies to storageState= ${path}`,
			);
		} catch (error: any) {
			this.logger.warn(
				`❌ Failed to save cookies to storageState= ${path}: ${error.constructor.name}: ${error.message}`,
			);
		}
	}

	// --- Storage State Management ---
	@retry({ timeout: 5, retries: 1 })
	public async saveStorageState(path?: string): Promise<void> {
		/**
		 * Save cookies to the specified path or the configured cookiesFile and/or storageState.
		 */
		await this._unsafeSaveStorageState(path);
	}

	private async _unsafeSaveStorageState(path?: string): Promise<void> {
		/**
		 * Unsafe storage state save logic without retry protection.
		 */
		if (
			!path &&
			!this.browserProfile.storageState &&
			!this.browserProfile.cookiesFile
		) {
			return;
		}

		if (!this.browserContext) {
			throw new Error("BrowserContext is not set up");
		}

		const storageState = await this.browserContext.storageState();
		const cookies = storageState.cookies;
		const hasAnyAuthData =
			cookies.length > 0 ||
			(storageState.origins && storageState.origins.length > 0);

		// Handle explicit path parameter
		if (path && hasAnyAuthData) {
			if (path.endsWith("storage_state.json")) {
				await this._saveStorageStateToFile(path, storageState);
				return;
			} else {
				// Assume old API usage
				await this._saveCookiesToFile(path, cookies);
				const newPath = path.replace(/[^/]*$/, "storage_state.json");
				await this._saveStorageStateToFile(newPath, storageState);
				this.logger.warn(
					"⚠️ cookiesFile is deprecated. Please use storageState instead.",
				);
				return;
			}
		}

		// Save to configured paths
		if (
			this.browserProfile.storageState &&
			typeof this.browserProfile.storageState === "string"
		) {
			await this._saveStorageStateToFile(
				this.browserProfile.storageState,
				storageState,
			);
		}
	}

	public async loadCookiesFromFile(): Promise<void> {
		/**
		 * Old name for the new loadStorageState() function.
		 */
		await this.loadStorageState();
	}

	/**
	 * Get list of all files downloaded during this browser session.
	 * @returns List of absolute file paths to downloaded files
	 */
	public get downloadedFiles(): string[] {
		this.logger.debug(
			`📁 Retrieved ${this._downloadedFiles.length} downloaded files from session tracking`,
		);
		return [...this._downloadedFiles];
	}

	private async _waitForStableNetwork(): Promise<void> {
		const pendingRequests = new Set<any>();
		let lastActivity = Date.now() / 1000;

		const page = await this.getCurrentPage();

		// Define relevant resource types and content types
		const RELEVANT_RESOURCE_TYPES = new Set([
			"document",
			"stylesheet",
			"image",
			"font",
			"script",
			"iframe",
		]);

		const RELEVANT_CONTENT_TYPES = new Set([
			"text/html",
			"text/css",
			"application/javascript",
			"image/",
			"font/",
			"application/json",
		]);

		// Additional patterns to filter out
		const IGNORED_URL_PATTERNS = new Set([
			// Analytics and tracking
			"analytics",
			"tracking",
			"telemetry",
			"beacon",
			"metrics",
			// Ad-related
			"doubleclick",
			"adsystem",
			"adserver",
			"advertising",
			// Social media widgets
			"facebook.com/plugins",
			"platform.twitter",
			"linkedin.com/embed",
			// Live chat and support
			"livechat",
			"zendesk",
			"intercom",
			"crisp.chat",
			"hotjar",
			// Push notifications
			"push-notifications",
			"onesignal",
			"pushwoosh",
			// Background sync/heartbeat
			"heartbeat",
			"ping",
			"alive",
			// WebRTC and streaming
			"webrtc",
			"rtmp://",
			"wss://",
			// Common CDNs for dynamic content
			"cloudfront.net",
			"fastly.net",
		]);

		const onRequest = (request: any): void => {
			// Filter by resource type
			if (!RELEVANT_RESOURCE_TYPES.has(request.resourceType())) {
				return;
			}

			// Filter out streaming, websocket, and other real-time requests
			if (
				new Set(["websocket", "media", "eventsource", "manifest", "other"]).has(
					request.resourceType(),
				)
			) {
				return;
			}

			// Filter out by URL patterns
			const url = request.url().toLowerCase();
			if (
				Array.from(IGNORED_URL_PATTERNS).some((pattern) =>
					url.includes(pattern),
				)
			) {
				return;
			}

			// Filter out data URLs and blob URLs
			if (url.startsWith("data:") || url.startsWith("blob:")) {
				return;
			}

			// Filter out requests with certain headers
			const headers = request.headers();
			if (
				headers["purpose"] === "prefetch" ||
				["video", "audio"].includes(headers["sec-fetch-dest"])
			) {
				return;
			}

			pendingRequests.add(request);
			lastActivity = Date.now() / 1000;
			// this.logger.debug(`Request started: ${request.url()} (${request.resourceType()})`);
		};

		const onResponse = (response: any): void => {
			const request = response.request();
			if (!pendingRequests.has(request)) {
				return;
			}

			// Filter by content type if available
			const contentType = (
				response.headers()["content-type"] || ""
			).toLowerCase();

			// Skip if content type indicates streaming or real-time data
			if (
				[
					"streaming",
					"video",
					"audio",
					"webm",
					"mp4",
					"event-stream",
					"websocket",
					"protobuf",
				].some((t) => contentType.includes(t))
			) {
				pendingRequests.delete(request);
				return;
			}

			// Only process relevant content types
			if (
				!Array.from(RELEVANT_CONTENT_TYPES).some((ct) =>
					contentType.includes(ct),
				)
			) {
				pendingRequests.delete(request);
				return;
			}

			// Skip if response is too large (likely not essential for page load)
			const contentLength = response.headers()["content-length"];
			if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
				// 5MB
				pendingRequests.delete(request);
				return;
			}

			pendingRequests.delete(request);
			lastActivity = Date.now() / 1000;
			// this.logger.debug(`Request resolved: ${request.url()} (${contentType})`);
		};

		// Attach event listeners
		(page as any).on("request", onRequest);
		(page as any).on("response", onResponse);

		let now = Date.now() / 1000;
		const startTime = Date.now() / 1000;
		try {
			// Wait for idle time
			while (true) {
				await setTimeout(100);
				now = Date.now() / 1000;
				if (
					pendingRequests.size === 0 &&
					now - lastActivity >=
						this.browserProfile.waitForNetworkIdlePageLoadTime
				) {
					break;
				}
				if (now - startTime > this.browserProfile.maximumWaitPageLoadTime) {
					this.logger.debug(
						`${this} Network timeout after ${this.browserProfile.maximumWaitPageLoadTime}s with ${pendingRequests.size} ` +
							`pending requests: ${Array.from(pendingRequests).map((r: any) => r.url())}`,
					);
					break;
				}
			}
		} finally {
			// Clean up event listeners
			(page as any).off("request", onRequest);
			(page as any).off("response", onResponse);
		}

		const elapsed = now - startTime;
		if (elapsed > 1) {
			this.logger.debug(
				`💤 Page network traffic calmed down after ${elapsed.toFixed(2)} seconds`,
			);
		}
	}

	/**
	 * Ensures page is fully loaded before continuing.
	 * Waits for either network to be idle or minimum WAIT_TIME, whichever is longer.
	 * Also checks if the loaded URL is allowed.
	 */
	private async _waitForPageAndFramesLoad(
		timeoutOverwrite?: number,
	): Promise<void> {
		// Start timing
		const startTime = Date.now();

		// Wait for page load
		const page = await this.getCurrentPage();
		try {
			await this._waitForStableNetwork();

			// Check if the loaded URL is allowed
			await this._checkAndHandleNavigation(page);
		} catch (error: any) {
			if (error instanceof URLNotAllowedError) {
				throw error;
			}
			this.logger.warn(
				`⚠️ Page load for ${logPrettyUrl(page.url())} failed due to ${error.constructor.name}, continuing anyway...`,
			);
		}

		// Calculate remaining time to meet minimum WAIT_TIME
		const elapsed = (Date.now() - startTime) / 1000;
		const minWaitTime =
			timeoutOverwrite || this.browserProfile.minimumWaitPageLoadTime || 0;
		const remaining = Math.max(minWaitTime - elapsed, 0);

		// Just for logging, calculate how much data was downloaded
		let bytesUsed: number | undefined = undefined;
		try {
			bytesUsed = await (page as any).evaluate(
				`() => {
					let total = 0;
					for (const entry of performance.getEntriesByType('resource')) {
						total += entry.transferSize || 0;
					}
					for (const nav of performance.getEntriesByType('navigation')) {
						total += nav.transferSize || 0;
					}
					return total;
				}`,
			);
		} catch (error) {
			// Ignore errors getting bytes used
			bytesUsed = undefined;
		}

		let tabIdx: string | number;
		try {
			tabIdx = this.tabs.indexOf(page);
		} catch (error) {
			tabIdx = "??";
		}

		const extraDelay =
			remaining > 0
				? `, waiting +${remaining.toFixed(2)}s for all frames to finish`
				: "";

		if (bytesUsed !== undefined) {
			this.logger.info(
				`➡️ Page navigation [${tabIdx}]${logPrettyUrl(page.url(), 40)} used ${(bytesUsed / 1024).toFixed(1)} KB in ${elapsed.toFixed(2)}s${extraDelay}`,
			);
		} else {
			this.logger.info(
				`➡️ Page navigation [${tabIdx}]${logPrettyUrl(page.url(), 40)} took ${elapsed.toFixed(2)}s${extraDelay}`,
			);
		}

		// Sleep remaining time if needed
		if (remaining > 0) {
			await setTimeout(remaining * 1000);
		}
	}

	/*
		Check if a URL is allowed based on the whitelist configuration. SECURITY CRITICAL.

		Supports optional glob patterns and schemes in allowed_domains:
		- *.example.com will match sub.example.com and example.com
		- *google.com will match google.com, agoogle.com, and www.google.com
		- http*://example.com will match http://example.com, https://example.com
		- chrome-extension://* will match chrome-extension://aaaaaaaaaaaa and chrome-extension://bbbbbbbbbbbbb
	*/
	private _isUrlAllowed(url: string): boolean {
		if (!this.browserProfile.allowedDomains) {
			return true; // allowed_domains are not configured, allow everything by default
		}

		// Special case: Always allow 'about:blank'
		if (url === "about:blank") {
			return true;
		}

		for (const allowedDomain of this.browserProfile.allowedDomains) {
			try {
				if (matchUrlWithDomainPattern(url, allowedDomain, true)) {
					// If it's a pattern with wildcards, show a warning
					if (allowedDomain.includes("*")) {
						const domain = new URL(url).hostname?.toLowerCase() || "";
						logGlobWarning(domain, allowedDomain, this.logger);
					}
					return true;
				}
			} catch (error) {
				// This would only happen if about:blank is passed to match_url_with_domain_pattern,
				// which shouldn't occur since we check for it above
				continue;
			}
		}

		return false;
	}

	/**
	 * Check if current page URL is allowed and handle if not.
	 */
	private async _checkAndHandleNavigation(page: Page): Promise<void> {
		if (!this._isUrlAllowed(page.url())) {
			this.logger.warn(
				`⛔️ Navigation to non-allowed URL detected: ${page.url()}`,
			);
			try {
				await this.goBack();
			} catch (error: any) {
				this.logger.error(
					`⛔️ Failed to go back after detecting non-allowed URL: ${error.constructor.name}: ${error.message}`,
				);
			}
			throw new URLNotAllowedError(
				`Navigation to non-allowed URL: ${page.url()}`,
			);
		}
	}

	public async navigateTo(url: string): Promise<void> {
		/**
		 * Navigate the agent's current tab to a URL
		 */
		// Add https:// if there's no protocol
		const normalizedUrl = normalizeUrl(url);

		if (!this._isUrlAllowed(normalizedUrl)) {
			throw new Error(`Navigation to non-allowed URL: ${normalizedUrl}`);
		}

		const page = await this.getCurrentPage();
		await page.goto(normalizedUrl);
		try {
			await page.waitForLoadState();
		} catch (error: any) {
			this.logger.warn(
				`⚠️ Page failed to fully load after navigation: ${error.constructor.name}: ${error.message}`,
			);
		}
	}

	/**
	 * Refresh the agent's current page
	 */
	public async refreshPage(): Promise<void> {
		const page = await this.getCurrentPage();
		await page.reload();
		try {
			await page.waitForLoadState();
		} catch (error: any) {
			this.logger.warn(
				`⚠️ Page failed to fully load after refresh: ${error.constructor.name}: ${error.message}`,
			);
		}
	}

	/**
	 * Navigate the agent's tab back in browser history
	 */
	public async goBack(): Promise<void> {
		try {
			// 10 ms timeout
			const page = await this.getCurrentPage();
			await page.goBack({ timeout: 10, waitUntil: "domcontentloaded" });
			// await this._waitForPageAndFramesLoad(1.0)
		} catch (error: any) {
			this.logger.debug(
				// Continue even if its not fully loaded, because we wait later for the page to load
				`⏮️ Error during goBack: ${error.constructor.name}: ${error.message}`,
			);
		}
	}

	/**
	 * Navigate the agent's tab forward in browser history
	 */
	public async goForward(): Promise<void> {
		try {
			const page = await this.getCurrentPage();
			await page.goForward({ timeout: 10, waitUntil: "domcontentloaded" });
		} catch (error: any) {
			// Continue even if its not fully loaded, because we wait later for the page to load
			this.logger.debug(
				`⏭️ Error during goForward: ${error.constructor.name}: ${error.message}`,
			);
		}
	}

	/**
	 * Close the current tab that the agent is working with.
	 *
	 * This closes the tab that the agent is currently using (agentCurrentPage),
	 * not necessarily the tab that is visible to the user (humanCurrentPage).
	 * If they are the same tab, both references will be updated.
	 */
	public async closeCurrentTab(): Promise<void> {
		if (!this.browserContext) {
			throw new Error("Browser context is not set");
		}
		if (!this.agentCurrentPage) {
			throw new Error("Agent current page is not set");
		}

		// Check if this is the foreground tab as well
		const isForeground = this.agentCurrentPage === this.humanCurrentPage;

		// Close the tab
		try {
			await this.agentCurrentPage.close();
		} catch (error: any) {
			this.logger.debug(
				`⛔️ Error during closeCurrentTab: ${error.constructor.name}: ${error.message}`,
			);
		}

		// Clear agent's reference to the closed tab
		this.agentCurrentPage = undefined;

		// Clear foreground reference if needed
		if (isForeground) {
			this.humanCurrentPage = undefined;
		}

		// Switch to the first available tab if any exist
		if (this.browserContext.pages().length > 0) {
			await this.switchToTab(0);
			// switchToTab already updates both tab references
		}
		// Otherwise, the browser will be closed
	}

	/**
	 * Get a debug view of the page structure including iframes
	 */
	public async getPageHtml(): Promise<string> {
		const page = await this.getCurrentPage();
		return await page.content();
	}

	@requireInitialization
	public async getPageStructure(): Promise<string> {
		/**
		 * Get a debug view of the page structure including iframes
		 */
		const debugScript = `(() => {
			function getPageStructure(element = document, depth = 0, maxDepth = 10) {
				if (depth >= maxDepth) return '';

				const indent = '  '.repeat(depth);
				let structure = '';

				// Skip certain elements that clutter the output
				const skipTags = new Set(['script', 'style', 'link', 'meta', 'noscript']);

				// Add current element info if it's not the document
				if (element !== document) {
					const tagName = element.tagName.toLowerCase();

					// Skip uninteresting elements
					if (skipTags.has(tagName)) return '';

					const id = element.id ? \`#\${element.id}\` : '';
					const classes = element.className && typeof element.className === 'string' ?
						\`.\${element.className.split(' ').filter(c => c).join('.')}\` : '';

					// Get additional useful attributes
					const attrs = [];
					if (element.getAttribute('role')) attrs.push(\`role="\${element.getAttribute('role')}"\`);
					if (element.getAttribute('aria-label')) attrs.push(\`aria-label="\${element.getAttribute('aria-label')}"\`);
					if (element.getAttribute('type')) attrs.push(\`type="\${element.getAttribute('type')}"\`);
					if (element.getAttribute('name')) attrs.push(\`name="\${element.getAttribute('name')}"\`);
					if (element.getAttribute('src')) {
						const src = element.getAttribute('src');
						attrs.push(\`src="\${src.substring(0, 50)}\${src.length > 50 ? '...' : ''}"\`);
					}

					// Add element info
					structure += \`\${indent}\${tagName}\${id}\${classes}\${attrs.length ? ' [' + attrs.join(', ') + ']' : ''}\\n\`;

					// Handle iframes specially
					if (tagName === 'iframe') {
						try {
							const iframeDoc = element.contentDocument || element.contentWindow?.document;
							if (iframeDoc) {
								structure += \`\${indent}  [IFRAME CONTENT]:\\n\`;
								structure += getPageStructure(iframeDoc, depth + 2, maxDepth);
							} else {
								structure += \`\${indent}  [IFRAME: No access - likely cross-origin]\\n\`;
							}
						} catch (e) {
							structure += \`\${indent}  [IFRAME: Access denied - \${e.message}]\\n\`;
						}
					}
				}

				// Get all child elements
				const children = element.children || element.childNodes;
				for (const child of children) {
					if (child.nodeType === 1) { // Element nodes only
						structure += getPageStructure(child, depth + 1, maxDepth);
					}
				}

				return structure;
			}

			return getPageStructure();
		})()`;

		const page = await this.getCurrentPage();
		const structure = await (page as any).evaluate(debugScript);
		return structure;
	}

	@timeExecution("--getStateSummary")
	@requireInitialization
	public async getStateSummary(
		cacheClickableElementsHashes: boolean,
	): Promise<BrowserStateSummary> {
		/*Get a summary of the current browser state

		This method builds a BrowserStateSummary object that captures the current state
		of the browser, including url, title, tabs, screenshot, and DOM tree.

		Parameters:
		-----------
		cacheClickableElementsHashes: bool
			If True, cache the clickable elements hashes for the current state.
			This is used to calculate which elements are new to the LLM since the last message,
			which helps reduce token usage.
		*/

		await this._waitForPageAndFramesLoad();
		const updatedState = await this._getUpdatedState();

		// Find out which elements are new
		// Do this only if url has not changed
		if (cacheClickableElementsHashes) {
			// if we are on the same url as the last state, we can use the cached hashes
			if (
				this._cachedClickableElementHashes &&
				this._cachedClickableElementHashes.url === updatedState.url
			) {
				// Pointers, feel free to edit in place
				const updatedStateClickableElements =
					ClickableElementProcessor.getClickableElements(
						updatedState.elementTree,
					);

				for (const domElement of updatedStateClickableElements) {
					domElement.isNew = !this._cachedClickableElementHashes.hashes.has(
						ClickableElementProcessor.hashDomElement(domElement), // see which elements are new from the last state where we cached the hashes
					);
				}
			}

			// in any case, we need to cache the new hashes
			this._cachedClickableElementHashes = {
				url: updatedState.url,
				hashes: ClickableElementProcessor.getClickableElementsHashes(
					updatedState.elementTree,
				),
			};
		}

		this._cachedBrowserStateSummary = updatedState;
		return this._cachedBrowserStateSummary;
	}

	/**
	 * Update and return state.
	 */
	private async _getUpdatedState(
		focusElement: number = -1,
	): Promise<BrowserStateSummary> {
		const page = await this.getCurrentPage();

		// Check if current page is still valid, if not switch to another available page
		try {
			// Test if page is still accessible
			await (page as any).evaluate("1");
		} catch (error: any) {
			this.logger.debug(
				`👋 Current page is no longer accessible: ${error.constructor.name}: ${error.message}`,
			);
			throw new Error("Browser closed: no valid pages available");
		}

		try {
			await this.removeHighlights();
			const domService = new DomService(page, this.logger);
			const content = await domService.getClickableElements(
				this.browserProfile.highlightElements,
				focusElement,
				this.browserProfile.viewportExpansion,
			);

			const tabsInfo = await this.getTabsInfo();

			// Get all cross-origin iframes within the page and open them in new tabs
			// mark the titles of the new tabs so the LLM knows to check them for additional content
			// unfortunately too buggy for now, too many sites use invisible cross-origin iframes for ads, tracking, youtube videos, social media, etc.
			// and it distracts the bot by opening a lot of new tabs
			// iframeUrls = await domService.getCrossOriginIframes()
			// outerPage = this.agentCurrentPage
			// for url in iframeUrls:
			// 	if url in [tab.url for tab in tabsInfo]:
			// 		continue  # skip if the iframe if we already have it open in a tab
			// 	newPageId = tabsInfo[-1].pageId + 1
			// 	this.logger.debug(f'Opening cross-origin iframe in new tab #{newPageId}: {url}')
			// 	await this.createNewTab(url)
			// 	tabsInfo.append(
			// 		TabInfo(
			// 			pageId=newPageId,
			// 			url=url,
			// 			title=f'iFrame opened as new tab, treat as if embedded inside page {outerPage.url}: {page.url}',
			// 			parentPageUrl=outerPage.url,
			// 		)
			// 	)

			let screenshotB64: string | null;
			try {
				screenshotB64 = await this.takeScreenshot();
			} catch (error: any) {
				this.logger.warn(
					`Failed to capture screenshot: ${error.constructor.name}: ${error.message}`,
				);
				screenshotB64 = null;
			}

			const [pixelsAbove, pixelsBelow] = await this.getScrollInfo(page);

			const browserStateSummary: BrowserStateSummary = {
				elementTree: content.elementTree,
				selectorMap: content.selectorMap,
				url: page.url(),
				title: await page.title(),
				tabs: tabsInfo,
				screenshot: screenshotB64,
				pixelsAbove,
				pixelsBelow,
				browserErrors: [],
			};

			return browserStateSummary;
		} catch (error: any) {
			this.logger.error(
				`❌ Failed to update browserStateSummary: ${error.constructor.name}: ${error.message}`,
			);
			// Return last known good state if available
			if (this.browserStateSummary) {
				return this.browserStateSummary;
			}
			throw error;
		}
	}
	// --- Screenshot and State Management ---
	/**
	 * Returns a base64 encoded screenshot of the current page.
	 */
	@timeExecution("--takeScreenshot")
	@retry({ wait: 2, retries: 2, timeout: 35 })
	public async takeScreenshot(fullPage: boolean = false): Promise<string> {
		if (!this.agentCurrentPage) {
			throw new Error("Agent current page is not set");
		}

		// page has already loaded by this point, this is just extra for previous action animations/frame loads to settle
		const page = await this.getCurrentPage();
		try {
			await page.waitForLoadState("load", { timeout: 5000 });
		} catch (error) {
			// Continue if page doesn't load fully
		}

		try {
			// Always use our clipping approach - never pass full_page=True to Playwright
			// This prevents timeouts on very long pages

			// 1. Get current viewport and page dimensions including scroll position
			// const dimensions = await page.evaluate(() => {
			// 	return {
			// 		width: window.innerWidth,
			// 		height: window.innerHeight,
			// 		pageWidth: document.documentElement.scrollWidth,
			// 		pageHeight: document.documentElement.scrollHeight,
			// 		devicePixelRatio: window.devicePixelRatio || 1,
			// 		scrollX: window.pageXOffset || document.documentElement.scrollLeft || 0,
			// 		scrollY: window.pageYOffset || document.documentElement.scrollTop || 0
			// 	};
			// });

			// When full_page=False, screenshot captures the current viewport
			// The clip parameter uses viewport coordinates (0,0 is top-left of viewport)
			// We just need to ensure the clip dimensions don't exceed our maximums
			// const clipWidth = Math.min(dimensions.width, MAX_SCREENSHOT_WIDTH);
			// const clipHeight = Math.min(dimensions.height, MAX_SCREENSHOT_HEIGHT);

			// Take screenshot using our retry-decorated method
			// Don't pass clip parameter - let Playwright capture the full viewport
			// It will automatically handle cases where viewport extends beyond page content
			return await this._takeScreenshotHybrid(page);
		} catch (error: any) {
			this.logger.error(
				`❌ Failed to take screenshot after retries: ${error.constructor.name}: ${error.message}`,
			);
			throw error;
		}
	}

	/**
	 * Start tracing on browser context if tracePath is configured.
	 */
	private async _startContextTracing(): Promise<void> {
		if (this.browserProfile.tracesDir && this.browserContext) {
			try {
				this.logger.debug(
					`📽️ Starting tracing (will save to: ${this.browserProfile.tracesDir})`,
				);
				// Don't pass any path to start() - let Playwright handle internal temp files
				await this.browserContext.tracing.start({
					screenshots: true,
					snapshots: true,
					sources: false, // Reduce trace size
				});
			} catch (error: any) {
				this.logger.warn(`Failed to start tracing: ${error.message}`);
			}
		}
	}
	// region - User Actions
	/**
	 * Generate a unique filename for downloads by appending (1), (2), etc., if a file already exists.
	 */
	private static async _getUniqueFilename(
		directory: string,
		filename: string,
	): Promise<string> {
		const ext = path.extname(filename);
		const base = path.basename(filename, ext);
		let counter = 1;
		let newFilename = filename;

		while (fs.existsSync(path.join(directory, newFilename))) {
			newFilename = `${base} (${counter})${ext}`;
			counter++;
		}

		return newFilename;
	}

	/**
	 * Converts simple XPath expressions to CSS selectors.
	 */
	private static _convertSimpleXpathToCssSelector(xpath: string): string {
		if (!xpath) {
			return "";
		}

		// Remove leading slash if present
		xpath = xpath.replace(/^\/+/, "");

		// Split into parts
		const parts = xpath.split("/");
		const cssParts: string[] = [];

		for (const part of parts) {
			if (!part) {
				continue;
			}

			// Handle custom elements with colons by escaping them
			if (part.includes(":") && !part.includes("[")) {
				const basePart = part.replace(/:/g, "\\:");
				cssParts.push(basePart);
				continue;
			}

			// Handle index notation [n]
			if (part.includes("[")) {
				let basePart = part.substring(0, part.indexOf("["));
				// Handle custom elements with colons in the base part
				if (basePart.includes(":")) {
					basePart = basePart.replace(/:/g, "\\:");
				}
				const indexPart = part.substring(part.indexOf("["));

				// Handle multiple indices
				const indices = indexPart
					.split("]")
					.slice(0, -1)
					.map((i) => i.replace("[", ""));

				for (const idx of indices) {
					try {
						// Handle numeric indices
						if (/^\d+$/.test(idx)) {
							const index = parseInt(idx) - 1;
							basePart += `:nth-of-type(${index + 1})`;
						}
						// Handle last() function
						else if (idx === "last()") {
							basePart += ":last-of-type";
						}
						// Handle position() functions
						else if (idx.includes("position()")) {
							if (idx.includes(">1")) {
								basePart += ":nth-of-type(n+2)";
							}
						}
					} catch (error) {
						continue;
					}
				}

				cssParts.push(basePart);
			} else {
				cssParts.push(part);
			}
		}

		const baseSelector = cssParts.join(" > ");
		return baseSelector;
	}

	/**
	 * Creates a CSS selector for a DOM element, handling various edge cases and special characters.
	 *
	 * @param element - The DOM element to create a selector for.
	 * @param includeDynamicAttributes - Whether to include dynamic attributes in the selector.
	 * @returns A valid CSS selector string
	 */
	@timeExecution("--enhancedCssSelectorForElement")
	private static _enhancedCssSelectorForElement(
		element: DOMElementNode,
		includeDynamicAttributes: boolean = true,
	): string {
		try {
			// Get base selector from XPath
			let cssSelector = BrowserSession._convertSimpleXpathToCssSelector(
				element.xpath,
			);

			// Handle class attributes
			if (
				element.attributes?.["class"] &&
				element.attributes["class"] &&
				includeDynamicAttributes
			) {
				// Define a regex pattern for valid class names in CSS
				const validClassNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

				// Iterate through the class attribute values
				const classes = element.attributes["class"].split(" ");
				for (const className of classes) {
					// Skip empty class names
					if (!className.trim()) {
						continue;
					}

					// Check if the class name is valid
					if (validClassNamePattern.test(className)) {
						// Append the valid class name to the CSS selector
						cssSelector += `.${className}`;
					} else {
						// Skip invalid class names
						continue;
					}
				}
			}

			// Expanded set of safe attributes that are stable and useful for selection
			const SAFE_ATTRIBUTES = new Set([
				// Data attributes (if they're stable in your application)
				"id",
				// Standard HTML attributes
				"name",
				"type",
				"placeholder",
				// Accessibility attributes
				"aria-label",
				"aria-labelledby",
				"aria-describedby",
				"role",
				// Common form attributes
				"for",
				"autocomplete",
				"required",
				"readonly",
				// Media attributes
				"alt",
				"title",
				"src",
				// Custom stable attributes (add any application-specific ones)
				"href",
				"target",
			]);

			if (includeDynamicAttributes) {
				const dynamicAttributes = [
					"data-id",
					"data-qa",
					"data-cy",
					"data-testid",
				];
				for (const attr of dynamicAttributes) {
					SAFE_ATTRIBUTES.add(attr);
				}
			}

			// Handle other attributes
			for (const [attribute, value] of Object.entries(
				element.attributes || {},
			)) {
				if (attribute === "class") {
					continue;
				}

				// Skip invalid attribute names
				if (!attribute.trim()) {
					continue;
				}

				if (!SAFE_ATTRIBUTES.has(attribute)) {
					continue;
				}

				// Escape special characters in attribute names
				const safeAttribute = attribute.replace(/:/g, "\\:");

				// Handle different value cases
				if (value === "") {
					cssSelector += `[${safeAttribute}]`;
				} else if (/["'<>`\n\r\t]/.test(value)) {
					// Use contains for values with special characters
					// For newline-containing text, only use the part before the newline
					let processedValue = value;
					if (value.includes("\n")) {
						processedValue = value.split("\n")[0] || value;
					}
					// Regex-substitute *any* whitespace with a single space, then strip.
					const collapsedValue = processedValue.replace(/\s+/g, " ").trim();
					// Escape embedded double-quotes.
					const safeValue = collapsedValue.replace(/"/g, '\\"');
					cssSelector += `[${safeAttribute}*="${safeValue}"]`;
				} else {
					cssSelector += `[${safeAttribute}="${value}"]`;
				}
			}

			return cssSelector;
		} catch (error) {
			// Fallback to a more basic selector if something goes wrong
			const tagName = element.tagName || "*";
			return `${tagName}[highlight_index='${element.highlightIndex}']`;
		}
	}

	/**
	 * Checks if an element is visible on the page.
	 * We use our own implementation instead of relying solely on Playwright's isVisible() because
	 * of edge cases with CSS frameworks like Tailwind. When elements use Tailwind's 'hidden' class,
	 * the computed style may return display as '' (empty string) instead of 'none', causing Playwright
	 * to incorrectly consider hidden elements as visible. By additionally checking the bounding box
	 * dimensions, we catch elements that have zero width/height regardless of how they were hidden.
	 */
	@requireInitialization
	@timeExecution("--isVisible")
	private async _isVisible(element: ElementHandle): Promise<boolean> {
		const isHidden = await element.isHidden();
		const bbox = await element.boundingBox();

		return !isHidden && bbox !== null && bbox.width > 0 && bbox.height > 0;
	}

	@requireInitialization
	@timeExecution("--getLocateElement")
	async getLocateElement(
		element: DOMElementNode,
	): Promise<ElementHandle | null> {
		/**
		 * Locate an element on the page using the element node information.
		 * Handles iframe traversal and uses enhanced CSS selectors with XPath fallbacks.
		 */
		const page = await this.getCurrentPage();
		let currentFrame: Page | FrameLocator = page;

		// Start with the target element and collect all parents
		const parents: DOMElementNode[] = [];
		let current = element;
		while (current.parent !== null && current.parent !== undefined) {
			const parent = current.parent;
			parents.push(parent);
			current = parent;
		}

		// Reverse the parents list to process from top to bottom
		parents.reverse();

		// Process all iframe parents in sequence
		const iframes = parents.filter((item) => item.tagName === "iframe");
		for (const parent of iframes) {
			const cssSelector = BrowserSession._enhancedCssSelectorForElement(
				parent,
				this.browserProfile.includeDynamicAttributes,
			);
			// Use CSS selector if available, otherwise fall back to XPath
			if (cssSelector) {
				currentFrame = currentFrame.frameLocator(cssSelector);
			} else {
				this.logger.debug(`Using XPath for iframe: ${parent.xpath}`);
				currentFrame = currentFrame.frameLocator(`xpath=${parent.xpath}`);
			}
		}

		const cssSelector = BrowserSession._enhancedCssSelectorForElement(
			element,
			this.browserProfile.includeDynamicAttributes,
		);

		try {
			let elementHandle: ElementHandle | null = null;

			if ("frameLocator" in currentFrame) {
				// currentFrame is a FrameLocator
				if (cssSelector) {
					elementHandle = await currentFrame
						.locator(cssSelector)
						.elementHandle();
				} else {
					// Fall back to XPath when CSS selector is empty
					this.logger.debug(
						`CSS selector empty, falling back to XPath: ${element.xpath}`,
					);
					elementHandle = await currentFrame
						.locator(`xpath=${element.xpath}`)
						.elementHandle();
				}
			} else {
				// currentFrame is a Page
				if (cssSelector) {
					elementHandle = await (currentFrame as any).querySelector(
						cssSelector,
					);
				} else {
					// Fall back to XPath
					this.logger.debug(
						`CSS selector empty, falling back to XPath: ${element.xpath}`,
					);
					elementHandle = await (currentFrame as any).locator(
						`xpath=${element.xpath}`,
					);
				}

				if (elementHandle) {
					const isVisible = await this._isVisible(elementHandle);
					if (isVisible) {
						await elementHandle.scrollIntoViewIfNeeded();
					}
				}
			}

			return elementHandle;
		} catch (error: any) {
			// If CSS selector failed, try XPath as fallback
			if (cssSelector && !error.message.includes("CSS.escape")) {
				try {
					this.logger.debug(
						`CSS selector failed, trying XPath fallback: ${element.xpath}`,
					);
					let elementHandle: ElementHandle | null = null;

					if ("frameLocator" in currentFrame) {
						elementHandle = await currentFrame
							.locator(`xpath=${element.xpath}`)
							.elementHandle();
					} else {
						elementHandle = await (currentFrame as Page)
							.locator(`xpath=${element.xpath}`)
							.elementHandle();
					}

					if (elementHandle) {
						const isVisible = await this._isVisible(elementHandle);
						if (isVisible) {
							await elementHandle.scrollIntoViewIfNeeded();
						}
					}

					return elementHandle;
				} catch (xpathError: any) {
					this.logger.error(
						`❌ Failed to locate element with both CSS (${cssSelector}) and XPath (${element.xpath}): ${xpathError.constructor.name}: ${xpathError.message}`,
					);
					return null;
				}
			} else {
				this.logger.error(
					`❌ Failed to locate element ${cssSelector || element.xpath} on page ${logPrettyUrl(page.url())}: ${error.constructor.name}: ${error.message}`,
				);
				return null;
			}
		}
	}

	/**
	 * Locates an element on the page using the provided XPath.
	 */
	@requireInitialization
	@timeExecution("--getLocateElementByXpath")
	private async getLocateElementByXpath(
		xpath: string,
	): Promise<ElementHandle | null> {
		const page = await this.getCurrentPage();

		try {
			// Use XPath to locate the element
			const elementHandle = await (page as any).querySelector(`xpath=${xpath}`);
			if (elementHandle) {
				const isVisible = await this._isVisible(elementHandle);
				if (isVisible) {
					await elementHandle.scrollIntoViewIfNeeded();
				}
				return elementHandle;
			}
			return null;
		} catch (error: any) {
			this.logger.error(
				`❌ Failed to locate xpath ${xpath} on page ${logPrettyUrl(page.url())}: ${error.constructor.name}: ${error.message}`,
			);
			return null;
		}
	}

	/**
	 * Locates an element on the page using the provided CSS selector.
	 */
	@requireInitialization
	@timeExecution("--getLocateElementByCssSelector")
	private async getLocateElementByCssSelector(
		cssSelector: string,
	): Promise<ElementHandle | null> {
		const page = await this.getCurrentPage();

		try {
			// Use CSS selector to locate the element
			const elementHandle = await (page as any).querySelector(cssSelector);
			if (elementHandle) {
				const isVisible = await this._isVisible(elementHandle);
				if (isVisible) {
					await elementHandle.scrollIntoViewIfNeeded();
				}
				return elementHandle;
			}
			return null;
		} catch (error: any) {
			this.logger.error(
				`❌ Failed to locate element ${cssSelector} on page ${logPrettyUrl(page.url())}: ${error.constructor.name}: ${error.message}`,
			);
			return null;
		}
	}

	/**
	 * Locates an element on the page using the provided text content.
	 * If `nth` is provided, it returns the nth matching element (0-based).
	 * If `elementType` is provided, filters by tag name (e.g., 'button', 'span').
	 */
	@requireInitialization
	@timeExecution("--getLocateElementByText")
	private async getLocateElementByText(
		text: string,
		nth: number | null = 0,
		elementType: string | null = null,
	): Promise<ElementHandle | null> {
		const page = await this.getCurrentPage();

		try {
			// Handle specific element type or use any type
			const selector = `${elementType || "*"}:text("${text}")`;
			const elements = await (page as any).querySelectorAll(selector);

			// Consider only visible elements
			const visibleElements: ElementHandle[] = [];
			for (const el of elements) {
				if (await this._isVisible(el)) {
					visibleElements.push(el);
				}
			}

			if (visibleElements.length === 0) {
				this.logger.error(
					`❌ No visible element with text '${text}' found on page ${logPrettyUrl(page.url())}.`,
				);
				return null;
			}

			let elementHandle: ElementHandle;
			if (nth !== null) {
				if (nth >= 0 && nth < visibleElements.length) {
					elementHandle = visibleElements[nth]!;
				} else {
					this.logger.error(
						`❌ Visible element with text '${text}' not found at index #${nth} on page ${logPrettyUrl(page.url())}.`,
					);
					return null;
				}
			} else {
				elementHandle = visibleElements[0]!;
			}

			const isVisible = await this._isVisible(elementHandle);
			if (isVisible) {
				await elementHandle.scrollIntoViewIfNeeded();
			}

			return elementHandle;
		} catch (error: any) {
			this.logger.error(
				`❌ Failed to locate element by text '${text}' on page ${logPrettyUrl(page.url())}: ${error.constructor.name}: ${error.message}`,
			);
			return null;
		}
	}
	/**
	 * Input text into an element with proper error handling and state management.
	 * Handles different types of input fields and ensures proper element state before input.
	 */
	@requireInitialization
	@timeExecution("--inputTextElementNode")
	async _inputTextElementNode(
		elementNode: DOMElementNode,
		text: string,
	): Promise<void> {
		try {
			const elementHandle = await this.getLocateElement(elementNode);

			if (elementHandle === null) {
				throw new BrowserError(
					`Element: ${JSON.stringify(elementNode)} not found`,
				);
			}

			// Ensure element is ready for input
			try {
				await elementHandle.waitForElementState("stable", { timeout: 1000 });
				const isVisible = await this._isVisible(elementHandle);
				if (isVisible) {
					await elementHandle.scrollIntoViewIfNeeded({ timeout: 1000 });
				}
			} catch (error) {
				// Continue even if state preparation fails
			}

			// Let's first try to click and type
			try {
				await (elementHandle as any).evaluate(
					'el => {el.textContent = ""; el.value = "";}',
				);
				await elementHandle.click();
				await setTimeout(100); // Increased sleep time
				const page = await this.getCurrentPage();
				await page.keyboard.type(text);
				return;
			} catch (error: any) {
				this.logger.debug(
					`Input text with click and type failed, trying element handle method: ${error.message}`,
				);
				// Continue to fallback method
			}

			// Get element properties to determine input method
			const tagHandle = await elementHandle.getProperty("tagName");
			const tagName = ((await tagHandle.jsonValue()) as string).toLowerCase();
			const isContenteditable =
				await elementHandle.getProperty("isContentEditable");
			const readonlyHandle = await elementHandle.getProperty("readOnly");
			const disabledHandle = await elementHandle.getProperty("disabled");

			const readonly = readonlyHandle
				? await readonlyHandle.jsonValue()
				: false;
			const disabled = disabledHandle
				? await disabledHandle.jsonValue()
				: false;

			try {
				if (
					((await isContenteditable.jsonValue()) || tagName === "input") &&
					!(readonly || disabled)
				) {
					await (elementHandle as any).evaluate(
						'el => {el.textContent = ""; el.value = "";}',
					);
					await elementHandle.type(text, { delay: 5 });
				} else {
					await elementHandle.fill(text);
				}
			} catch (error: any) {
				this.logger.error(
					`Error during input text into element: ${error.constructor.name}: ${error.message}`,
				);
				throw new BrowserError(
					`Failed to input text into element: ${JSON.stringify(elementNode)}`,
				);
			}
		} catch (error: any) {
			// Get current page URL safely for error message
			let pageUrl = "unknown page";
			try {
				const page = await this.getCurrentPage();
				pageUrl = logPrettyUrl(page.url());
			} catch (urlError) {
				// Use default value
			}

			this.logger.debug(
				`❌ Failed to input text into element: ${JSON.stringify(elementNode)} on page ${pageUrl}: ${error.constructor.name}: ${error.message}`,
			);
			throw new BrowserError(
				`Failed to input text into index ${elementNode.highlightIndex}`,
			);
		}
	}

	@requireInitialization
	@timeExecution("--switchToTab")
	public async switchToTab(pageId: number): Promise<Page> {
		/**
		 * Switch to a specific tab by its pageId (aka tab index exposed to LLM)
		 */
		if (!this.browserContext) {
			throw new BrowserError("Browser context is not set");
		}

		const pages = this.browserContext.pages();
		if (pageId >= pages.length) {
			throw new BrowserError(`No tab found with pageId: ${pageId}`);
		}

		const page = pages[pageId];

		// Check if the tab's URL is allowed before switching
		if (!this._isUrlAllowed((page as any).url())) {
			throw new BrowserError(
				`Cannot switch to tab with non-allowed URL: ${(page as any).url()}`,
			);
		}

		// Update both tab references - agent wants this tab, and it's now in the foreground
		this.agentCurrentPage = page;
		await (this.agentCurrentPage as any).bringToFront(); // crucial for screenshot to work

		// In order for a human watching to be able to follow along with what the agent is doing
		// update the human's active tab to match the agent's
		if (this.humanCurrentPage !== page) {
			// TODO: figure out how to do this without bringing the entire window to the foreground and stealing foreground app focus
			// might require browsernode extension loaded into the browser so we can use chrome.tabs extension APIs
			// await page.bringToFront()
		}

		this.humanCurrentPage = page;

		// Invalidate cached state since we've switched to a different tab
		// The cached state contains DOM elements and selector map from the previous tab
		this._cachedBrowserStateSummary = undefined;
		this._cachedClickableElementHashes = undefined;

		try {
			await (page as any).waitForLoadState();
		} catch (error: any) {
			this.logger.warn(
				`⚠️ New page failed to fully load: ${error.constructor.name}: ${error.message}`,
			);
		}

		// Set the viewport size for the tab
		if (this.browserProfile.viewport) {
			await (page as any).setViewportSize(this.browserProfile.viewport);
		}

		return page as Page;
	}

	/**
	 * Create a new tab and optionally navigate to a URL
	 */
	@timeExecution("--createNewTab")
	public async createNewTab(url?: string): Promise<Page> {
		// Add https:// if there's no protocol
		let normalizedUrl = url;
		if (url) {
			normalizedUrl = normalizeUrl(url);

			if (!this._isUrlAllowed(normalizedUrl)) {
				throw new BrowserError(
					`Cannot create new tab with non-allowed URL: ${normalizedUrl}`,
				);
			}
		}
		let newPage: Page = undefined as any;
		try {
			if (!this.browserContext) {
				throw new Error("Browser context is not set");
			}
			newPage = await this.browserContext.newPage();
		} catch (error) {
			this.initialized = false;
			this.browserContext = undefined; // Clear the closed context
		}

		if (!this.initialized || !this.browserContext) {
			// If we were initialized but lost connection, reset state first to avoid infinite loops
			if (this.initialized && !this.browserContext) {
				this.logger.warn(
					`💔 Browser ${this.connectionStr} disconnected while trying to create a new tab, reconnecting...`,
				);
				this.resetConnectionState();
			}
			await this.start();
			if (!this.browserContext) {
				throw new Error("Browser context is not set");
			}
			newPage = await this.browserContext.newPage();
		}

		// Update agent tab reference
		this.agentCurrentPage = newPage;

		// Update human tab reference if there is no human tab yet
		if (!this.humanCurrentPage || this.humanCurrentPage.isClosed()) {
			this.humanCurrentPage = newPage;
		}

		const tabIdx = this.tabs.indexOf(newPage);
		try {
			await newPage.waitForLoadState();
		} catch (error: any) {
			this.logger.warn(
				`⚠️ New page [${tabIdx}]${logPrettyUrl(newPage.url())} failed to fully load: ${error.constructor.name}: ${error.message}`,
			);
		}

		// Set the viewport size for the new tab
		if (this.browserProfile.viewport) {
			await newPage.setViewportSize(this.browserProfile.viewport);
		}

		if (normalizedUrl) {
			try {
				await newPage.goto(normalizedUrl, { waitUntil: "domcontentloaded" });
				await this._waitForPageAndFramesLoad(1);
			} catch (error: any) {
				this.logger.error(
					`❌ Error navigating to ${normalizedUrl}: ${error.constructor.name}: ${error.message} (proceeding anyway...)`,
				);
			}
		}

		if (!this.humanCurrentPage) {
			throw new Error("Human current page is not set");
		}
		if (!this.agentCurrentPage) {
			throw new Error("Agent current page is not set");
		}

		// If there are any unused about:blank tabs after we open a new tab, close them to clean up unused tabs
		if (!this.browserContext) {
			throw new Error("Browser context is not set");
		}

		// Hacky way to be sure we only close our own tabs, check the title of the tab for our BrowserSession name
		const titleOfOurSetupTab = `Starting agent ${this.id.slice(-4)}...`; // set up by showDvdScreensaverLoadingAnimation()

		for (const page of this.browserContext.pages()) {
			try {
				const pageTitle = await page.title();
				if (
					page.url() === "about:blank" &&
					page !== this.agentCurrentPage &&
					pageTitle === titleOfOurSetupTab
				) {
					await page.close();
					// In case we just closed the human's tab, fix the refs
					this.humanCurrentPage = this.humanCurrentPage.isClosed()
						? this.agentCurrentPage
						: this.humanCurrentPage;
					break; // Only close a maximum of one unused about:blank tab,
					// if multiple parallel agents share one BrowserSession
					// closing every new_page() tab (which start on about:blank) causes lots of problems
					// (the title check is not enough when they share a single BrowserSession)
				}
			} catch (error) {
				// Ignore errors when checking/closing tabs
				continue;
			}
		}

		return newPage;
	}

	@requireInitialization
	public async getSelectorMap(): Promise<SelectorMap> {
		/**
		 * Get the current selector map.
		 */
		if (!this._cachedBrowserStateSummary) {
			return {};
		}
		return this._cachedBrowserStateSummary.selectorMap;
	}

	@requireInitialization
	public async getElementByIndex(index: number): Promise<ElementHandle | null> {
		const selectorMap = await this.getSelectorMap();
		const node = selectorMap[index];
		if (!node) {
			return null;
		}
		const elementHandle = await this.getLocateElement(node);
		return elementHandle;
	}

	public async isFileInputByIndex(index: number): Promise<boolean> {
		try {
			const selectorMap = await this.getSelectorMap();
			const node = selectorMap[index];
			if (!node) {
				return false;
			}
			return BrowserSession.isFileInput(node);
		} catch (error: any) {
			this.logger.debug(
				`❌ Error in isFileInputByIndex(index=${index}): ${error.constructor.name}: ${error.message}`,
			);
			return false;
		}
	}

	public static isFileInput(node: DOMElementNode): boolean {
		return (
			node instanceof Object &&
			node.tagName?.toLowerCase() === "input" &&
			node.attributes?.["type"]?.toLowerCase() === "file"
		);
	}

	/**
	 * Find the closest file input to the selected element by traversing the DOM bottom-up.
	 * At each level (up to maxHeight ancestors):
	 * - Check the current node itself
	 * - Check all its children/descendants up to maxDescendantDepth
	 * - Check all siblings (and their descendants up to maxDescendantDepth)
	 * Returns the first file input found, or null if not found.
	 */
	@requireInitialization
	public async findFileUploadElementByIndex(
		index: number,
		maxHeight: number = 3,
		maxDescendantDepth: number = 3,
	): Promise<DOMElementNode | null> {
		try {
			const selectorMap = await this.getSelectorMap();
			if (!(index in selectorMap)) {
				return null;
			}

			const candidateElement = selectorMap[index];
			if (!candidateElement) {
				return null;
			}

			const findFileInputInDescendants = (
				node: DOMElementNode,
				depth: number,
			): DOMElementNode | null => {
				if (depth < 0 || !node) {
					return null;
				}
				if (BrowserSession.isFileInput(node)) {
					return node;
				}
				for (const child of node.children || []) {
					if (child instanceof DOMElementNode) {
						const result = findFileInputInDescendants(child, depth - 1);
						if (result) {
							return result;
						}
					}
				}
				return null;
			};

			let current: DOMElementNode | null = candidateElement;
			for (let i = 0; i <= maxHeight; i++) {
				if (!current) {
					break;
				}

				// 1. Check the current node itself
				if (BrowserSession.isFileInput(current)) {
					return current;
				}

				// 2. Check all descendants of the current node
				const result = findFileInputInDescendants(current, maxDescendantDepth);
				if (result) {
					return result;
				}

				// 3. Check all siblings and their descendants
				const parent: DOMElementNode | null = current.parent;
				if (parent) {
					for (const sibling of parent.children || []) {
						if (sibling === current) {
							continue;
						}
						if (
							sibling instanceof DOMElementNode &&
							BrowserSession.isFileInput(sibling)
						) {
							return sibling;
						}
						if (sibling instanceof DOMElementNode) {
							const siblingResult = findFileInputInDescendants(
								sibling,
								maxDescendantDepth,
							);
							if (siblingResult) {
								return siblingResult;
							}
						}
					}
				}

				current = parent;
			}

			return null;
		} catch (error: any) {
			const page = await this.getCurrentPage();
			this.logger.debug(
				`❌ Error in findFileUploadElementByIndex(index=${index}) on page ${logPrettyUrl(page.url())}: ${error.constructor.name}: ${error.message}`,
			);
			return null;
		}
	}

	@requireInitialization
	public async getScrollInfo(page: Page): Promise<[number, number]> {
		/**
		 * Get scroll position information for the current page.
		 */
		const scrollY = await (page as any).evaluate("window.scrollY");
		const viewportHeight = await (page as any).evaluate("window.innerHeight");
		const totalHeight = await (page as any).evaluate(
			"document.documentElement.scrollHeight",
		);
		const pixelsAbove = scrollY;
		const pixelsBelow = totalHeight - (scrollY + viewportHeight);
		return [pixelsAbove, pixelsBelow];
	}

	private async loadStorageState(): Promise<void> {
		/**
		 * Load cookies from the storageState or cookiesFile and apply them to the browser context.
		 */
		if (!this.browserContext) {
			throw new Error(
				"Browser context is not initialized, cannot load storage state",
			);
		}

		if (
			this.browserProfile.storageState &&
			typeof this.browserProfile.storageState === "string"
		) {
			try {
				const storageStateText = fs.readFileSync(
					this.browserProfile.storageState,
					"utf8",
				);
				const storageState = JSON.parse(storageStateText);

				if (storageState.cookies) {
					await this.browserContext.addCookies(storageState.cookies);
					const numEntries =
						storageState.cookies.length + (storageState.origins?.length || 0);
					if (numEntries > 0) {
						this.logger.info(
							`🍪 Loaded ${numEntries} cookies from storageState= ${this.browserProfile.storageState}`,
						);
					}
				}
			} catch (error: any) {
				this.logger.warn(
					`❌ Failed to load cookies from storageState: ${error.constructor.name}: ${error.message}`,
				);
			}
		}
	}

	@requireInitialization
	async _scrollContainer(pixels: number): Promise<void> {
		/**
		 * Scroll the element that truly owns vertical scroll. Starts at the focused node ➜ climbs to the first big,
		 * scroll-enabled ancestor otherwise picks the first scrollable element or the root, then calls `element.scrollBy`
		 * (or `window.scrollBy` for the root) by the supplied pixel value.
		 */

		// An element can *really* scroll if: overflow-y is auto|scroll|overlay, it has more content than fits,
		// its own viewport is not a postage stamp (more than 50% of window).
		const SMART_SCROLL_JS = `(dy) => {
			const bigEnough = el => el.clientHeight >= window.innerHeight * 0.5;
			const canScroll = el =>
				el &&
				/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) &&
				el.scrollHeight > el.clientHeight &&
				bigEnough(el);

			let el = document.activeElement;
			while (el && !canScroll(el) && el !== document.body) el = el.parentElement;

			el = canScroll(el)
					? el
					: [...document.querySelectorAll('*')].find(canScroll)
					|| document.scrollingElement
					|| document.documentElement;

			if (el === document.scrollingElement ||
				el === document.documentElement ||
				el === document.body) {
				window.scrollBy(0, dy);
			} else {
				el.scrollBy({ top: dy, behavior: 'auto' });
			}
		}`;

		const page = await this.getCurrentPage();
		await (page as any).evaluate(SMART_SCROLL_JS, pixels);
	}
	// --- DVD Screensaver Loading Animation Helper ---
	private async showDvdScreensaverLoadingAnimation(page: Page): Promise<void> {
		/**
		 * Injects a DVD screensaver-style bouncing logo loading animation overlay into the given Playwright Page.
		 * This is used to visually indicate that the browser is setting up or waiting.
		 */
		if (CONFIG.isInEvals) {
			// dont bother wasting CPU showing animations during evals
			return;
		}

		// we could enforce this, but maybe it's useful to be able to show it on other tabs?
		// if (page.url == 'about:blank'), 'DVD screensaver loading animation should only be shown on about:blank tabs'

		// all in one JS function for speed, we want as few roundtrip CDP calls as possible
		// between opening the tab and showing the animation
		await (page as any).evaluate(
			`(browser_session_label) => {
			const animated_title = \`Starting agent \${browser_session_label}...\`;
			if (document.title === animated_title) {
				return;      // already run on this tab, dont run again
			}
			document.title = animated_title;

			// Create the main overlay
			const loadingOverlay = document.createElement('div');
			loadingOverlay.id = 'pretty-loading-animation';
			loadingOverlay.style.position = 'fixed';
			loadingOverlay.style.top = '0';
			loadingOverlay.style.left = '0';
			loadingOverlay.style.width = '100vw';
			loadingOverlay.style.height = '100vh';
			loadingOverlay.style.background = '#000';
			loadingOverlay.style.zIndex = '99999';
			loadingOverlay.style.overflow = 'hidden';

			// Create the image element
			const img = document.createElement('img');
			img.src = 'https://cf.browsernode.com/logo.svg';
			img.alt = 'Browsernode';
			img.style.width = '200px';
			img.style.height = 'auto';
			img.style.position = 'absolute';
			img.style.left = '0px';
			img.style.top = '0px';
			img.style.zIndex = '2';
			img.style.opacity = '0.8';

			loadingOverlay.appendChild(img);
			document.body.appendChild(loadingOverlay);

			// DVD screensaver bounce logic
			let x = Math.random() * (window.innerWidth - 300);
			let y = Math.random() * (window.innerHeight - 300);
			let dx = 1.2 + Math.random() * 0.4; // px per frame
			let dy = 1.2 + Math.random() * 0.4;
			// Randomize direction
			if (Math.random() > 0.5) dx = -dx;
			if (Math.random() > 0.5) dy = -dy;

			function animate() {
				const imgWidth = img.offsetWidth || 300;
				const imgHeight = img.offsetHeight || 300;
				x += dx;
				y += dy;

				if (x <= 0) {
					x = 0;
					dx = Math.abs(dx);
				} else if (x + imgWidth >= window.innerWidth) {
					x = window.innerWidth - imgWidth;
					dx = -Math.abs(dx);
				}
				if (y <= 0) {
					y = 0;
					dy = Math.abs(dy);
				} else if (y + imgHeight >= window.innerHeight) {
					y = window.innerHeight - imgHeight;
					dy = -Math.abs(dy);
				}

				img.style.left = \`\${x}px\`;
				img.style.top = \`\${y}px\`;

				requestAnimationFrame(animate);
			}
			animate();

			// Responsive: update bounds on resize
			window.addEventListener('resize', () => {
				x = Math.min(x, window.innerWidth - img.offsetWidth);
				y = Math.min(y, window.innerHeight - img.offsetHeight);
			});

			// Add a little CSS for smoothness
			const style = document.createElement('style');
			style.innerHTML = \`
				#pretty-loading-animation {
					/*backdrop-filter: blur(2px) brightness(0.9);*/
				}
				#pretty-loading-animation img {
					user-select: none;
					pointer-events: none;
				}
			\`;
			document.head.appendChild(style);
		}`,
			this.id.slice(-4),
		);
	}
}
