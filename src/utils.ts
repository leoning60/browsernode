import { EventEmitter } from "events";
import { promises as fs } from "fs";
import * as fsSync from "fs";
import os from "os";
import path from "path";

import { platform } from "os";
import { URL, fileURLToPath } from "url";
import type { Logger } from "winston";

import bnLogger from "./logging_config";

const logger: Logger = bnLogger.child({
	module: "browsernode/utils",
});

// Get current file directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

// Global flag to prevent duplicate exit messages
let exiting = false;

// Define generic types
type AnyFunction = (...args: any[]) => any;
type AsyncFunction<T = any> = (...args: any[]) => Promise<T>;

// Exception types (simplified - adjust based on actual usage)
interface BadRequestError extends Error {
	name: "BadRequestError";
}

interface SignalHandlerOptions {
	loop?: EventEmitter;
	pauseCallback?: () => void;
	resumeCallback?: () => void;
	customExitCallback?: () => void;
	exitOnSecondInt?: boolean;
	interruptibleTaskPatterns?: string[];
}

/**
 * A modular and reusable signal handling system for managing SIGINT (Ctrl+C), SIGTERM,
 * and other signals in Node.js applications.
 *
 * This class provides:
 * - Configurable signal handling for SIGINT and SIGTERM
 * - Support for custom pause/resume callbacks
 * - Management of event loop state across signals
 * - Standardized handling of first and second Ctrl+C presses
 * - Cross-platform compatibility (with simplified behavior on Windows)
 */
export class SignalHandler {
	private readonly loop: EventEmitter;
	private readonly pauseCallback?: () => void;
	private readonly resumeCallback?: () => void;
	private readonly customExitCallback?: () => void;
	private readonly exitOnSecondInt: boolean;
	private readonly interruptibleTaskPatterns: string[];
	private readonly isWindows: boolean;

	// State tracking
	private ctrlCPressed = false;
	private waitingForInput = false;
	private originalSigintHandler?: NodeJS.SignalsListener;
	private originalSigtermHandler?: NodeJS.SignalsListener;

	constructor(options: SignalHandlerOptions = {}) {
		this.loop = options.loop || new EventEmitter();
		this.pauseCallback = options.pauseCallback;
		this.resumeCallback = options.resumeCallback;
		this.customExitCallback = options.customExitCallback;
		this.exitOnSecondInt = options.exitOnSecondInt ?? true;
		this.interruptibleTaskPatterns = options.interruptibleTaskPatterns || [
			"step",
			"multiAct",
			"getNextAction",
		];
		this.isWindows = platform() === "win32";
	}

	/**
	 * Register signal handlers for SIGINT and SIGTERM
	 */
	register(): void {
		try {
			if (this.isWindows) {
				// On Windows, use simple signal handling with immediate exit on Ctrl+C
				const windowsHandler = (signal: NodeJS.Signals) => {
					console.error(
						"\n\n🛑 Got Ctrl+C. Exiting immediately on Windows...\n",
					);
					// Run the custom exit callback if provided
					if (this.customExitCallback) {
						this.customExitCallback();
					}
					process.exit(0);
				};

				this.originalSigintHandler = windowsHandler;
				process.on("SIGINT", windowsHandler);
			} else {
				// On Unix-like systems, use more sophisticated signal handling
				this.originalSigintHandler = () => this.sigintHandler();
				this.originalSigtermHandler = () => this.sigtermHandler();

				process.on("SIGINT", this.originalSigintHandler);
				process.on("SIGTERM", this.originalSigtermHandler);
			}
		} catch (error) {
			// There are situations where signal handlers are not supported, e.g.
			// - some operating systems
			// - certain runtime environments
			logger.debug("Signal handlers not supported in this environment");
		}
	}

	/**
	 * Unregister signal handlers and restore original handlers if possible
	 */
	unregister(): void {
		try {
			if (this.originalSigintHandler) {
				process.removeListener("SIGINT", this.originalSigintHandler);
			}
			if (this.originalSigtermHandler) {
				process.removeListener("SIGTERM", this.originalSigtermHandler);
			}
		} catch (error) {
			logger.warn(`Error while unregistering signal handlers: ${error}`);
		}
	}

	/**
	 * Handle a second Ctrl+C press by performing cleanup and exiting
	 */
	private handleSecondCtrlC(): void {
		if (!exiting) {
			exiting = true;

			// Call custom exit callback if provided
			if (this.customExitCallback) {
				try {
					this.customExitCallback();
				} catch (error) {
					logger.error(`Error in exit callback: ${error}`);
				}
			}
		}

		// Force immediate exit
		console.error("\n\n🛑  Got second Ctrl+C. Exiting immediately...\n");

		// Reset terminal to a clean state
		process.stderr.write("\x1b[?25h"); // Show cursor
		process.stdout.write("\x1b[?25h"); // Show cursor
		process.stderr.write("\x1b[0m"); // Reset text attributes
		process.stdout.write("\x1b[0m"); // Reset text attributes
		process.stderr.write("\x1b[?1l"); // Reset cursor keys to normal mode
		process.stdout.write("\x1b[?1l"); // Reset cursor keys to normal mode
		process.stderr.write("\x1b[?2004l"); // Disable bracketed paste mode
		process.stdout.write("\x1b[?2004l"); // Disable bracketed paste mode
		process.stderr.write("\r"); // Carriage return
		process.stdout.write("\r"); // Carriage return

		console.error(
			"(tip: press [Enter] once to fix escape codes appearing after chrome exit)",
		);

		process.exit(0);
	}

	/**
	 * SIGINT (Ctrl+C) handler
	 */
	private sigintHandler(): void {
		if (exiting) {
			// Already exiting, force exit immediately
			process.exit(0);
		}

		if (this.ctrlCPressed) {
			// If we're in the waiting for input state, let the pause method handle it
			if (this.waitingForInput) {
				return;
			}

			// Second Ctrl+C - exit immediately if configured to do so
			if (this.exitOnSecondInt) {
				this.handleSecondCtrlC();
			}
		}

		// Mark that Ctrl+C was pressed
		this.ctrlCPressed = true;

		// Cancel current tasks that should be interruptible
		this.cancelInterruptibleTasks();

		// Call pause callback if provided
		if (this.pauseCallback) {
			try {
				this.pauseCallback();
			} catch (error) {
				logger.error(`Error in pause callback: ${error}`);
			}
		}

		// Log pause message
		console.error(
			"----------------------------------------------------------------------",
		);
	}

	/**
	 * SIGTERM handler
	 */
	private sigtermHandler(): void {
		if (!exiting) {
			exiting = true;
			console.error("\n\n🛑 SIGTERM received. Exiting immediately...\n\n");

			// Call custom exit callback if provided
			if (this.customExitCallback) {
				this.customExitCallback();
			}
		}

		process.exit(0);
	}

	/**
	 * Cancel current tasks that should be interruptible
	 */
	private cancelInterruptibleTasks(): void {
		// For now, we'll emit events that can be listened to
		this.loop.emit("cancelInterruptibleTasks", this.interruptibleTaskPatterns);
	}

	/**
	 * Wait for user input to resume or exit
	 */
	waitForResume(): void {
		// Set flag to indicate we're waiting for input
		this.waitingForInput = true;

		const green = "\x1b[32;1m";
		const red = "\x1b[31m";
		const blink = "\x1b[33;5m";
		const unblink = "\x1b[0m";
		const reset = "\x1b[0m";

		try {
			process.stderr.write(
				`➡️  Press ${green}[Enter]${reset} to resume or ${red}[Ctrl+C]${reset} again to exit${blink}...${unblink} `,
			);

			// Set up input handling
			process.stdin.setRawMode(true);
			process.stdin.resume();
			process.stdin.setEncoding("utf8");

			const handleInput = (key: string) => {
				if (key === "\u0003") {
					// Ctrl+C
					this.handleSecondCtrlC();
				} else if (key === "\r" || key === "\n") {
					// Enter
					process.stdin.removeListener("data", handleInput);
					process.stdin.setRawMode(false);
					process.stdin.pause();

					// Call resume callback if provided
					if (this.resumeCallback) {
						this.resumeCallback();
					}
				}
			};

			process.stdin.on("data", handleInput);
		} catch (error) {
			logger.error(`Error in waitForResume: ${error}`);
		} finally {
			this.waitingForInput = false;
		}
	}

	/**
	 * Reset state after resuming
	 */
	reset(): void {
		this.ctrlCPressed = false;
		this.waitingForInput = false;
	}
}

// Global system monitoring state
let lastOverloadCheck = 0;
const overloadCheckInterval = 5000; // Check every 5 seconds
let activeRetryOperations = 0;

// Global semaphore registry for retry decorator
const globalRetrySemaphores: Map<
	string,
	{ count: number; max: number; waiting: Array<() => void> }
> = new Map();

interface RetryOptions {
	wait?: number;
	retries?: number;
	timeout?: number;
	retryOn?: Array<new (...args: any[]) => Error>;
	backoffFactor?: number;
	semaphoreLimit?: number;
	semaphoreName?: string;
	semaphoreLax?: boolean;
	semaphoreScope?: "global" | "class" | "self";
	semaphoreTimeout?: number;
}

/**
 * Check if system is overloaded and return [isOverloaded, reason]
 */
function checkSystemOverload(): [boolean, string] {
	try {
		// Get basic system stats (simplified version for Node.js)
		const memUsage = process.memoryUsage();
		const memUsedMB = memUsage.heapUsed / 1024 / 1024;
		const memTotalMB = memUsage.heapTotal / 1024 / 1024;
		const memPercent = (memUsedMB / memTotalMB) * 100;

		const reasons: string[] = [];
		let isOverloaded = false;

		// Check memory usage (simplified since we don't have CPU info easily)
		if (memPercent > 85) {
			isOverloaded = true;
			reasons.push(`Memory: ${memPercent.toFixed(1)}%`);
		}

		// Check number of concurrent operations
		if (activeRetryOperations > 30) {
			isOverloaded = true;
			reasons.push(`Active operations: ${activeRetryOperations}`);
		}

		return [isOverloaded, reasons.join(", ")];
	} catch (error) {
		return [false, ""];
	}
}

/**
 * Check if environment variables are set (supports both "all" and "any" validation)
 */
export function checkEnvVariables(
	keys: string[],
	validator: "all" | "any" = "all",
): boolean {
	const checkFn =
		validator === "all" ? keys.every.bind(keys) : keys.some.bind(keys);
	return checkFn((key) => {
		const value = process.env[key];
		return value !== undefined && value.trim() !== "";
	});
}

/**
 * Check if a domain pattern has complex wildcards that could match too many domains
 */
export function isUnsafePattern(pattern: string): boolean {
	// Extract domain part if there's a scheme
	if (pattern.includes("://")) {
		const parts = pattern.split("://", 2);
		if (parts.length > 1 && parts[1] !== undefined) {
			pattern = parts[1];
		}
	}

	// Remove safe patterns (*.domain and domain.*)
	const bareDomain = pattern.replace(/\.\*/g, "").replace(/\*\./g, "");

	// If there are still wildcards, it's potentially unsafe
	return bareDomain.includes("*");
}

/**
 * Check if a URL matches a domain pattern. SECURITY CRITICAL.
 */
export function matchUrlWithDomainPattern(
	url: string,
	domainPattern: string,
	logWarnings = false,
): boolean {
	try {
		// about:blank must be handled at the callsite
		if (url === "about:blank") {
			return false;
		}

		const parsedUrl = new URL(url);
		const scheme = parsedUrl.protocol.slice(0, -1).toLowerCase(); // Remove trailing ':'
		const domain = parsedUrl.hostname.toLowerCase();

		if (!scheme || !domain) {
			return false;
		}

		// Normalize the domain pattern
		domainPattern = domainPattern.toLowerCase();

		// Handle pattern with scheme
		let patternScheme: string;
		let patternDomain: string;

		if (domainPattern.includes("://")) {
			const parts = domainPattern.split("://", 2);
			patternScheme = parts[0] || "https";
			patternDomain = parts[1] || "";
		} else {
			patternScheme = "https"; // Default to matching only https for security
			patternDomain = domainPattern;
		}

		// Handle port in pattern
		if (patternDomain.includes(":") && !patternDomain.startsWith(":")) {
			const parts = patternDomain.split(":", 2);
			patternDomain = parts[0] || "";
		}

		// If scheme doesn't match, return false
		if (!matchPattern(scheme, patternScheme)) {
			return false;
		}

		// Check for exact match
		if (patternDomain === "*" || domain === patternDomain) {
			return true;
		}

		// Handle glob patterns
		if (patternDomain.includes("*")) {
			// Check for unsafe glob patterns
			if (
				patternDomain.split("*.").length > 2 ||
				patternDomain.split(".*").length > 2
			) {
				if (logWarnings) {
					logger.error(
						`⛔️ Multiple wildcards in pattern=[${domainPattern}] are not supported`,
					);
				}
				return false;
			}

			// Check for wildcards in TLD part
			if (patternDomain.endsWith(".*")) {
				if (logWarnings) {
					logger.error(
						`⛔️ Wildcard TLDs like in pattern=[${domainPattern}] are not supported for security`,
					);
				}
				return false;
			}

			// Check for embedded wildcards
			const bareDomain = patternDomain.replace(/\*\./g, "");
			if (bareDomain.includes("*")) {
				if (logWarnings) {
					logger.error(
						`⛔️ Only *.domain style patterns are supported, ignoring pattern=[${domainPattern}]`,
					);
				}
				return false;
			}

			// Special handling so that *.google.com also matches bare google.com
			if (patternDomain.startsWith("*.")) {
				const parentDomain = patternDomain.slice(2);
				if (domain === parentDomain || matchPattern(domain, parentDomain)) {
					return true;
				}
			}

			// Normal case: match domain against pattern
			if (matchPattern(domain, patternDomain)) {
				return true;
			}
		}

		return false;
	} catch (error) {
		logger.error(
			`⛔️ Error matching URL ${url} with pattern ${domainPattern}: ${error}`,
		);
		return false;
	}
}

/**
 * Simple pattern matching function (basic glob support)
 */
function matchPattern(text: string, pattern: string): boolean {
	// Convert glob pattern to regex
	const regexPattern = pattern
		.replace(/\./g, "\\.")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");

	const regex = new RegExp(`^${regexPattern}$`);
	return regex.test(text);
}

/**
 * Merge two dictionaries recursively
 */
export function mergeDicts(
	a: Record<string, any>,
	b: Record<string, any>,
	path: string[] = [],
): Record<string, any> {
	const result = { ...a };

	for (const key in b) {
		if (key in result) {
			if (
				typeof result[key] === "object" &&
				typeof b[key] === "object" &&
				!Array.isArray(result[key]) &&
				!Array.isArray(b[key])
			) {
				result[key] = mergeDicts(result[key], b[key], [...path, key]);
			} else if (Array.isArray(result[key]) && Array.isArray(b[key])) {
				result[key] = [...result[key], ...b[key]];
			} else if (result[key] !== b[key]) {
				throw new Error(`Conflict at ${[...path, key].join(".")}`);
			}
		} else {
			result[key] = b[key];
		}
	}

	return result;
}

/**
 * Get the browsernode package version
 */
export function getBrowserNodeVersion(): string {
	try {
		// Try to read version from package.json
		// When running from compiled code in dist/, go up one level to reach package.json
		const packageJsonPath = path.join(__dirname, "..", "package.json");
		const packageJson = JSON.parse(
			fsSync.readFileSync(packageJsonPath, "utf8"),
		);
		const version = packageJson.version || "unknown";
		process.env.LIBRARY_VERSION = version;
		return version;
	} catch (error) {
		logger.debug(`Error detecting browsernode version: ${error}`);
		return "unknown";
	}
}

/**
 * Pretty-print a path, shorten home dir to ~ and cwd to .
 */
export function logPrettyPath(pathInput: string | undefined | null): string {
	if (!pathInput || !pathInput.trim()) {
		return "";
	}

	if (typeof pathInput !== "string") {
		return `<${typeof pathInput}>`;
	}

	// Replace home dir and cwd with ~ and .
	const homeDir = os.homedir();
	const cwd = process.cwd();
	let prettyPath = pathInput.replace(homeDir, "~").replace(cwd, ".");

	// Wrap in quotes if it contains spaces
	if (prettyPath.trim() && prettyPath.includes(" ")) {
		prettyPath = `"${prettyPath}"`;
	}

	return prettyPath;
}

/**
 * Truncate/pretty-print a URL with a maximum length
 */
export function logPrettyUrl(url: string, maxLen = 22): string {
	const prettyUrl = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
	if (prettyUrl.length > maxLen) {
		return prettyUrl.slice(0, maxLen) + "…";
	}
	return prettyUrl;
}

/**
 * Retry decorator with semaphore support for async functions
 */
export function retry(options: RetryOptions = {}) {
	const {
		wait = 3,
		retries = 3,
		timeout = 5,
		retryOn = null,
		backoffFactor = 1.0,
		semaphoreLimit = null,
		semaphoreName = null,
		semaphoreLax = true,
		semaphoreScope = "global",
		semaphoreTimeout = null,
	} = options;

	return function (
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor,
	) {
		const originalMethod = descriptor.value;

		descriptor.value = async function (...args: any[]) {
			let semaphoreAcquired = false;
			let semaphoreKey: string | null = null;

			// Track active operations
			activeRetryOperations++;

			// Check for system overload (rate limited)
			const currentTime = Date.now();
			if (currentTime - lastOverloadCheck > overloadCheckInterval) {
				lastOverloadCheck = currentTime;
				const [isOverloaded, reason] = checkSystemOverload();
				if (isOverloaded) {
					logger.warn(
						`⚠️  System overload detected: ${reason}. Consider reducing concurrent operations to prevent hanging.`,
					);
				}
			}

			// Semaphore handling
			if (semaphoreLimit !== null) {
				// Determine semaphore key based on scope
				const baseName = semaphoreName || propertyKey;

				if (semaphoreScope === "global") {
					semaphoreKey = baseName;
				} else if (semaphoreScope === "class" && this?.constructor?.name) {
					semaphoreKey = `${this.constructor.name}.${baseName}`;
				} else if (semaphoreScope === "self") {
					// Use object reference as key
					semaphoreKey = `${this.constructor?.name || "unknown"}_${baseName}`;
				} else {
					semaphoreKey = baseName;
				}

				// Get or create semaphore
				if (!globalRetrySemaphores.has(semaphoreKey)) {
					globalRetrySemaphores.set(semaphoreKey, {
						count: 0,
						max: semaphoreLimit,
						waiting: [],
					});
				}

				const semaphore = globalRetrySemaphores.get(semaphoreKey)!;

				// Try to acquire semaphore
				const semStart = Date.now();
				const semTimeoutMs =
					semaphoreTimeout !== null
						? semaphoreTimeout * 1000
						: Math.max(timeout * 1000, timeout * (semaphoreLimit - 1) * 1000);

				if (semaphore.count < semaphore.max) {
					semaphore.count++;
					semaphoreAcquired = true;
				} else {
					// Wait for semaphore
					const waitPromise = new Promise<void>((resolve, reject) => {
						const timeoutId = setTimeout(() => {
							const index = semaphore.waiting.findIndex((cb) => cb === resolve);
							if (index !== -1) {
								semaphore.waiting.splice(index, 1);
							}
							if (!semaphoreLax) {
								reject(
									new Error(
										`Failed to acquire semaphore "${semaphoreKey}" within ${semTimeoutMs}ms`,
									),
								);
							} else {
								logger.warn(
									`Failed to acquire semaphore "${semaphoreKey}" after ${Date.now() - semStart}ms, proceeding without concurrency limit`,
								);
								resolve();
							}
						}, semTimeoutMs);

						semaphore.waiting.push(() => {
							clearTimeout(timeoutId);
							semaphore.count++;
							semaphoreAcquired = true;
							resolve();
						});
					});

					await waitPromise;
				}
			}

			// Retry logic
			const startTime = Date.now();
			let lastException: Error | null = null;

			try {
				for (let attempt = 0; attempt <= retries; attempt++) {
					try {
						// Execute with timeout
						const timeoutPromise = new Promise<never>((_, reject) => {
							setTimeout(() => reject(new Error("Timeout")), timeout * 1000);
						});

						const result = await Promise.race([
							originalMethod.apply(this, args),
							timeoutPromise,
						]);

						return result;
					} catch (error) {
						const err = error as Error;

						// Check if we should retry this exception
						if (
							retryOn !== null &&
							!retryOn.some((ErrorClass) => err instanceof ErrorClass)
						) {
							throw err;
						}

						lastException = err;

						if (attempt < retries) {
							// Calculate wait time with backoff
							const currentWait = wait * Math.pow(backoffFactor, attempt);

							logger.warn(
								`${propertyKey} failed (attempt ${attempt + 1}/${retries + 1}): ${err.name}: ${err.message}. Waiting ${currentWait.toFixed(1)}s before retry...`,
							);

							await new Promise((resolve) =>
								setTimeout(resolve, currentWait * 1000),
							);
						} else {
							// Final failure
							const totalTime = (Date.now() - startTime) / 1000;
							logger.error(
								`${propertyKey} failed after ${retries + 1} attempts over ${totalTime.toFixed(1)}s. Final error: ${err.name}: ${err.message}`,
							);
							throw err;
						}
					}
				}
			} finally {
				// Decrement active operations counter
				activeRetryOperations = Math.max(0, activeRetryOperations - 1);

				// Release semaphore
				if (semaphoreAcquired && semaphoreKey) {
					const semaphore = globalRetrySemaphores.get(semaphoreKey)!;
					semaphore.count--;

					// Wake up waiting functions
					if (semaphore.waiting.length > 0) {
						const nextWaiting = semaphore.waiting.shift();
						if (nextWaiting) {
							nextWaiting();
						}
					}
				}
			}

			// This should never be reached, but TypeScript requires it
			throw lastException || new Error("Unknown error");
		};

		return descriptor;
	};
}

/**
 * Decorator for timing synchronous function execution
 */
export function timeExecution(additionalText = "") {
	return function (
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor,
	) {
		const originalMethod = descriptor.value;

		descriptor.value = function (...args: any[]) {
			const startTime = Date.now();
			const result = originalMethod.apply(this, args);
			const executionTime = (Date.now() - startTime) / 1000;

			// Only log if execution takes more than 0.25 seconds
			if (executionTime > 0.25) {
				// Try to get logger from the instance (this), then from args, then use default
				let methodLogger = logger;
				if (this && (this as any).logger) {
					methodLogger = (this as any).logger;
				} else if (
					args &&
					args.length > 0 &&
					args[0] &&
					(args[0] as any).logger
				) {
					methodLogger = (args[0] as any).logger;
				}

				methodLogger.debug(
					`⏳ ${additionalText.replace(/-/g, "")}() took ${executionTime.toFixed(2)}s`,
				);
			}
			return result;
		};

		return descriptor;
	};
}

/**
 * Decorator for timing asynchronous function execution
 */
export function timeExecutionAsync(additionalText = "") {
	return function (
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor,
	) {
		const originalMethod = descriptor.value;

		descriptor.value = async function (...args: any[]) {
			const startTime = Date.now();
			const result = await originalMethod.apply(this, args);
			const executionTime = (Date.now() - startTime) / 1000;

			// Only log if execution takes more than 0.25 seconds
			if (executionTime > 0.25) {
				// Try to get logger from the instance (this), then from args, then use default
				let methodLogger = logger;
				if (this && (this as any).logger) {
					methodLogger = (this as any).logger;
				} else if (
					args &&
					args.length > 0 &&
					args[0] &&
					(args[0] as any).logger
				) {
					methodLogger = (args[0] as any).logger;
				}

				methodLogger.debug(
					`⏳ ${additionalText.replace(/-/g, "")}() took ${executionTime.toFixed(2)}s`,
				);
			}
			return result;
		};

		return descriptor;
	};
}

/**
 * Singleton pattern function
 */
export function singleton<T extends new (...args: any[]) => any>(
	constructor: T,
): T {
	let instance: InstanceType<T> | undefined;

	const wrapper = function (this: any, ...args: any[]): InstanceType<T> {
		if (instance === undefined) {
			instance = new constructor(...args);
		}
		return instance as InstanceType<T>;
	};

	// Copy prototype and static properties
	wrapper.prototype = constructor.prototype;
	Object.setPrototypeOf(wrapper, constructor);

	return wrapper as unknown as T;
}
