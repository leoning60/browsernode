import { execSync, spawn } from "child_process";
import * as http from "http";
import { promisify } from "util";
import type {
	BrowserType,
	ElementHandle,
	FrameLocator,
	Page,
	Browser as PlaywrightBrowser,
	BrowserContext as PlaywrightBrowserContext,
} from "playwright";
import { Logger } from "winston";

import {
	chromium,
	devices,
	firefox,
	errors as playwrightErrors,
	webkit,
} from "playwright";

import bnLogger from "../logging_config";
import { timeExecution } from "../utils";
import { BrowserContext, BrowserContextConfig } from "./context";
type TimeoutError = playwrightErrors.TimeoutError;

const logger: Logger = bnLogger.child({
	module: "browser_node/browser/browser",
});

interface ProxySettings {
	host: string;
	port: number;
	username?: string;
	password?: string;
}

interface BrowserConfigOptions {
	headless?: boolean;
	disableSecurity?: boolean;
	extraBrowserArgs?: string[];
	browserInstancePath?: string | null;
	wssUrl?: string | null;
	cdpUrl?: string | null;
	proxy?: ProxySettings | null;
	newContextConfig?: BrowserContextConfig;
	forceKeepBrowserAlive?: boolean;
	browserClass?: "chromium" | "firefox" | "webkit";
}

export class BrowserConfig {
	public headless: boolean;
	public disableSecurity: boolean;
	public extraBrowserArgs: string[];
	public browserInstancePath: string | null;
	public wssUrl: string | null;
	public cdpUrl: string | null;
	public proxy: ProxySettings | null;
	public newContextConfig: BrowserContextConfig;
	public forceKeepBrowserAlive: boolean;
	public browserClass: "chromium" | "firefox" | "webkit";

	constructor(options: BrowserConfigOptions = {}) {
		this.headless = options.headless ?? false;
		this.disableSecurity = options.disableSecurity ?? true;
		this.extraBrowserArgs = options.extraBrowserArgs ?? [];
		this.browserInstancePath = options.browserInstancePath ?? null;
		this.wssUrl = options.wssUrl ?? null;
		this.cdpUrl = options.cdpUrl ?? null;
		this.proxy = options.proxy ?? null;
		this.newContextConfig =
			options.newContextConfig ?? new BrowserContextConfig();
		this.forceKeepBrowserAlive = options.forceKeepBrowserAlive ?? false;
		this.browserClass = options.browserClass ?? "chromium";
	}
}

export class Browser {
	public config: BrowserConfig;
	public playwrightBrowser: PlaywrightBrowser | null = null;
	public disableSecurityArgs: string[] = [];
	public logger = bnLogger.child({
		module: "browser_node/browser/browser",
	});

	constructor(config: BrowserConfig = new BrowserConfig()) {
		this.logger.debug("Initializing new browser");
		this.config = config;

		if (this.config.disableSecurity) {
			this.disableSecurityArgs = [
				"--disable-web-security",
				"--disable-site-isolation-trials",
			];
			if (this.config.browserClass === "chromium") {
				this.disableSecurityArgs.push(
					"--disable-features=IsolateOrigins,site-per-process",
				);
			}
		}
	}

	public async newContext(
		config: BrowserContextConfig = new BrowserContextConfig(),
	): Promise<BrowserContext> {
		return new BrowserContext(this, config);
	}

	public async getPlaywrightBrowser(): Promise<PlaywrightBrowser> {
		if (this.playwrightBrowser === null) {
			return this.init();
		}
		return this.playwrightBrowser;
	}

	@timeExecution("--init(browser)")
	private async init(): Promise<PlaywrightBrowser> {
		try {
			// First check if Chrome is already running and try to connect
			const chromeRunning = await this.checkChromeInstance();
			if (chromeRunning && this.config.browserInstancePath) {
				this.logger.info("Detected running Chrome instance, connecting...");
				const versionInfo = await this.chromeJsonVersionInfo(
					"http://localhost:9222/json/version",
				);

				if (versionInfo.versionInfo?.webSocketDebuggerUrl) {
					this.logger.debug(
						`Connecting to WebSocket: ${versionInfo.versionInfo.webSocketDebuggerUrl}`,
					);
					try {
						let browserType;
						if (this.config.browserClass === "firefox") {
							browserType = await firefox;
						} else if (this.config.browserClass === "webkit") {
							browserType = await webkit;
						} else {
							browserType = await chromium;
						}

						const browser = await browserType.connectOverCDP({
							wsEndpoint: versionInfo.versionInfo.webSocketDebuggerUrl,
							timeout: 20000,
							slowMo: 50, // Add slight delay to ensure stability
						});
						this.playwrightBrowser = browser;
						return browser;
					} catch (e) {
						this.logger.error(`Failed to connect to existing Chrome: ${e}`);
					}
				}
			}

			// Fall back to regular setup if direct connection failed
			const browser = await this.setupBrowser();
			this.playwrightBrowser = browser;
			return browser;
		} catch (e) {
			this.logger.error(`Browser initialization failed: ${e}`);
			throw e;
		}
	}

	private async checkChromeInstance(): Promise<boolean> {
		return new Promise((resolve) => {
			const req = http.get(
				"http://localhost:9222/json/version",
				(res: http.IncomingMessage) => {
					if (res.statusCode === 200) {
						resolve(true);
					} else {
						resolve(false);
					}
				},
			);

			req.on("error", () => {
				resolve(false);
			});

			req.setTimeout(2000, () => {
				req.destroy();
				resolve(false);
			});
		});
	}

	private async chromeJsonVersionInfo(
		url: "http://localhost:9222/json/version",
	): Promise<{
		running: boolean;
		versionInfo?: Record<string, string>;
	}> {
		return new Promise((resolve) => {
			let responseData = "";
			let req = http.get(url, (res: http.IncomingMessage) => {
				if (res.statusCode === 200) {
					res.on("data", (chunk) => {
						responseData += chunk;
					});

					res.on("end", () => {
						try {
							const versionInfo = JSON.parse(responseData);
							resolve({
								running: true,
								versionInfo: versionInfo,
							});
						} catch (error) {
							resolve({ running: true });
						}
					});
				} else {
					resolve({ running: false });
				}
			});

			req.on("error", () => {
				resolve({ running: false });
			});

			req.setTimeout(2000, () => {
				req.destroy();
				resolve({ running: false });
			});
		});
	}

	private async setupCdp(browser: BrowserType<{}>): Promise<PlaywrightBrowser> {
		if (!this.config.cdpUrl) {
			throw new Error("CDP URL is required");
		}
		if (this.config.browserInstancePath?.toLowerCase().includes("firefox")) {
			throw new Error(
				"CDP has been deprecated for Firefox, check: https://fxdx.dev/deprecating-cdp-support-in-firefox-embracing-the-future-with-webdriver-bidi/",
			);
		}

		this.logger.info(
			`Connecting to remote browser via CDP ${this.config.cdpUrl}`,
		);
		return browser.connectOverCDP(this.config.cdpUrl);
	}

	private async setupWss(browser: BrowserType<{}>): Promise<PlaywrightBrowser> {
		if (!this.config.wssUrl) {
			throw new Error("WSS URL is required");
		}
		this.logger.info(
			`Connecting to remote browser via WSS ${this.config.wssUrl}`,
		);
		return browser.connect(this.config.wssUrl);
	}

	private async setupBrowserWithInstance(
		browser: BrowserType<{}>,
	): Promise<PlaywrightBrowser> {
		if (!this.config.browserInstancePath) {
			throw new Error("Chrome instance path is required");
		}

		const checkChromeInstance = (): Promise<boolean> => {
			return new Promise((resolve) => {
				const req = http.get(
					"http://localhost:9222/json/version",
					(res: http.IncomingMessage) => {
						if (res.statusCode === 200) {
							resolve(true);
						} else {
							resolve(false);
						}
					},
				);

				req.on("error", () => {
					resolve(false);
				});

				req.setTimeout(2000, () => {
					req.destroy();
					resolve(false);
				});
			});
		};
		try {
			// Check if the browser is already running
			const chromeRunning = await checkChromeInstance();
			if (chromeRunning) {
				this.logger.info("Reusing existing Chrome instance");
				// Use the EXACT WebSocket debugger URL from the existing Chrome instance
				const versionInfo = await this.chromeJsonVersionInfo(
					"http://localhost:9222/json/version",
				);
				if (!versionInfo.versionInfo?.webSocketDebuggerUrl) {
					throw new Error(
						"Could not get WebSocket URL from existing Chrome instance",
					);
				}
				this.logger.debug(
					`Connecting to: ${versionInfo.versionInfo.webSocketDebuggerUrl}`,
				);

				// Connect directly using the WebSocket URL
				return browser.connectOverCDP({
					wsEndpoint: versionInfo.versionInfo.webSocketDebuggerUrl,
					timeout: 20000, // 20 second timeout for connection
					slowMo: 50, // Add slight delay to avoid race conditions
				});
			}
		} catch (error) {
			this.logger.debug(
				"No existing Chrome instance found, starting a new one",
			);
		}

		// Start a new Chrome instance
		const args = ["--remote-debugging-port=9222"];
		if (this.config.headless) {
			args.push("--headless");
		}

		// Merge extra browser arguments
		const allArgs = [...args, ...this.config.extraBrowserArgs];

		// Start Chrome process
		// console.debug(
		// 	"Starting Chrome process:",
		// 	this.config.browserInstancePath,
		// 	allArgs,
		// );
		const chromeProcess = spawn(this.config.browserInstancePath, allArgs, {
			stdio: "ignore",
			detached: true,
		});
		chromeProcess.unref();

		// 等待Chrome启动
		for (let i = 0; i < 10; i++) {
			const chromeRunning = await checkChromeInstance();
			if (chromeRunning) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		// Connect to the new instance
		try {
			const versionInfo = await this.chromeJsonVersionInfo(
				"http://localhost:9222/json/version",
			);
			if (!versionInfo.versionInfo?.webSocketDebuggerUrl) {
				throw new Error("Could not get WebSocket URL from Chrome instance");
			}
			return browser.connectOverCDP({
				wsEndpoint: versionInfo.versionInfo.webSocketDebuggerUrl,
				timeout: 20000, //20 second timeout for connection
			});
		} catch (error) {
			this.logger.error(`Failed to start a new Chrome instance: ${error}`);
			throw new Error(
				"To start Chrome in Debug mode, you need to close all existing Chrome instances and try again otherwise we cannot connect to the instance.",
			);
		}
	}

	private async setupStandardBrowser(
		browser: BrowserType<{}>,
	): Promise<PlaywrightBrowser> {
		const argsMap: Record<string, string[]> = {
			chromium: [
				"--no-sandbox",
				"--disable-blink-features=AutomationControlled",
				"--disable-infobars",
				"--disable-background-timer-throttling",
				"--disable-popup-blocking",
				"--disable-backgrounding-occluded-windows",
				"--disable-renderer-backgrounding",
				"--disable-window-activation",
				"--disable-focus-on-load",
				"--no-first-run",
				"--no-default-browser-check",
				"--no-startup-window",
				"--window-position=0,0",
			],
			firefox: ["-no-remote"],
			webkit: ["--no-startup-window"],
		};

		return browser.launch({
			headless: this.config.headless,
			args: [
				...(argsMap[this.config.browserClass] || []),
				...this.disableSecurityArgs,
				...this.config.extraBrowserArgs,
			],
			// proxy: this.config.proxy,
			proxy: this.config.proxy
				? {
						server: `${this.config.proxy.host}:${this.config.proxy.port}`,
						username: this.config.proxy.username,
						password: this.config.proxy.password,
					}
				: undefined,
		});
	}

	private async setupBrowser(): Promise<PlaywrightBrowser> {
		let browser: BrowserType<{}>;
		switch (this.config.browserClass) {
			case "firefox":
				browser = await firefox;
				break;
			case "webkit":
				browser = await webkit;
				break;
			default:
				browser = await chromium;
				break;
		}
		try {
			if (this.config.cdpUrl) {
				return await this.setupCdp(browser);
			}
			if (this.config.wssUrl) {
				return await this.setupWss(browser);
			}
			if (this.config.browserInstancePath) {
				return await this.setupBrowserWithInstance(browser);
			}
			return await this.setupStandardBrowser(browser);
		} catch (e) {
			this.logger.error(
				`Failed to initialize Playwright browser: ${String(e)}`,
			);
			throw e;
		}
	}

	public async close(): Promise<void> {
		try {
			if (!this.config.forceKeepBrowserAlive) {
				// console.debug(
				// 	"this.config.forceKeepBrowserAlive:",
				// 	this.config.forceKeepBrowserAlive,
				// );
				if (this.playwrightBrowser) {
					// TODO: not working. now use pkill -f 'Google Chrome' to kill the browser.
					await this.playwrightBrowser.close();
					this.playwrightBrowser = null;
					// console.debug("browser closed");
					// execSync("pkill -f 'Google Chrome'");
				}
			}
		} catch (e) {
			this.logger.debug(`Failed to close browser properly: ${e}`);
		}
	}
}
