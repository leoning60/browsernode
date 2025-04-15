import type {
	BrowserType,
	ElementHandle,
	FrameLocator,
	Page,
	Browser as PlaywrightBrowser,
	BrowserContext as PlaywrightBrowserContext,
} from "playwright";
import winston from "winston";

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

const logger = bnLogger.child({
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
		// Implementation would require Node.js equivalents for subprocess and requests
		// This is a simplified version
		if (!this.config.browserInstancePath) {
			throw new Error("Chrome instance path is required");
		}
		// Add actual implementation here
		throw new Error("Not implemented in this example");
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
