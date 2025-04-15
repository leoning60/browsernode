import { spawn } from "child_process";
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
		const browser = await this.setupBrowser();
		this.playwrightBrowser = browser;
		return this.playwrightBrowser;
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

		// 检查Chrome实例是否已经运行
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
			// 检查浏览器是否已经运行
			const chromeRunning = await checkChromeInstance();
			if (chromeRunning) {
				this.logger.info("Reusing existing Chrome instance");
				return browser.connectOverCDP("http://localhost:9222");
			}
		} catch (error) {
			this.logger.debug(
				"No existing Chrome instance found, starting a new one",
			);
		}

		// 启动新的Chrome实例
		const args = ["--remote-debugging-port=9222"];
		if (this.config.headless) {
			args.push("--headless");
		}

		// 合并额外的浏览器参数
		const allArgs = [...args, ...this.config.extraBrowserArgs];

		// 启动Chrome进程
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

		// 连接到新实例
		try {
			return browser.connectOverCDP("http://localhost:9222");
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
				if (this.playwrightBrowser) {
					await this.playwrightBrowser.close();
					this.playwrightBrowser = null;
				}
			}
		} catch (e) {
			this.logger.debug(`Failed to close browser properly: ${e}`);
		}
	}
}
