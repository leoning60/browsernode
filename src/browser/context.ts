// Playwright browser on steroids.

import type {
	ElementHandle,
	FrameLocator,
	Page,
	Browser as PlaywrightBrowser,
	BrowserContext as PlaywrightBrowserContext,
} from "playwright";
import { errors as playwrightErrors } from "playwright";
import * as uuid from "uuid";
import { Logger } from "winston";

import { BrowserError, TabInfo, URLNotAllowedError } from "./views";

import { DomService } from "../dom/service";
import type { SelectorMap } from "../dom/views";
import { DOMElementNode } from "../dom/views";
import bnLogger from "../logging_config";
import { timeExecution } from "../utils";
import { Browser } from "./browser";
import { BrowserState } from "./views";
type TimeoutError = playwrightErrors.TimeoutError;

const logger: Logger = bnLogger.child({
	module: "browser_node/browser/context",
});
interface BrowserContextWindowSize {
	width: number;
	height: number;
}

interface Geolocation {
	latitude: number;
	longitude: number;
}

interface BrowserContextConfigParams {
	cookiesFile?: string | null;
	minimumWaitPageLoadTime?: number;
	waitForNetworkIdlePageLoadTime?: number;
	maximumWaitPageLoadTime?: number;
	waitBetweenActions?: number;
	disableSecurity?: boolean;
	browserWindowSize?: BrowserContextWindowSize;
	noViewport?: boolean | null;
	saveRecordingPath?: string | null;
	saveDownloadsPath?: string | null;
	tracePath?: string | null;
	locale?: string | null;
	userAgent?: string;
	highlightElements?: boolean;
	viewportExpansion?: number;
	allowedDomains?: string[] | null;
	includeDynamicAttributes?: boolean;
	forceKeepContextAlive?: boolean;
	isMobile?: boolean | null;
	hasTouch?: boolean | null;
	geolocation?: Geolocation | null;
	permissions?: string[] | null;
	timezoneId?: string | null;
}
/**
 * Configuration for the BrowserContext.
 *
 * Default values:
 *   cookiesFile: null - Path to cookies file for persistence
 *   disableSecurity: true - Disable browser security features
 *   minimumWaitPageLoadTime: 0.25 - Minimum time to wait before getting page state for LLM input
 *   waitForNetworkIdlePageLoadTime: 0.5 - Time to wait for network requests to finish before getting page state
 *   maximumWaitPageLoadTime: 5 - Maximum time to wait for page load before proceeding anyway
 *   waitBetweenActions: 0.5 - Time to wait between multiple per step actions
 *   browserWindowSize: { width: 1280, height: 1100 } - Default browser window size
 *   noViewport: null - Disable viewport
 *   saveRecordingPath: null - Path to save video recordings
 *   saveDownloadsPath: null - Path to save downloads to
 *   tracePath: null - Path to save trace files
 *   locale: null - Specify user locale (e.g., en-GB, de-DE)
 *   userAgent: Default Chrome UA - Custom user agent to use
 *   highlightElements: true - Highlight elements in the DOM on the screen
 *   viewportExpansion: 500 - Viewport expansion in pixels
 *   allowedDomains: null - List of allowed domains that can be accessed
 *   includeDynamicAttributes: true - Include dynamic attributes in the CSS selector
 *   isMobile: null - Whether the meta viewport tag is taken into account
 *   hasTouch: null - Whether to enable touch events
 *   geolocation: null - Geolocation to be used in the browser context
 *   permissions: null - Browser permissions to grant
 *   timezoneId: null - Changes the timezone of the browser
 */
export class BrowserContextConfig {
	public cookiesFile: string | null;
	public minimumWaitPageLoadTime: number;
	public waitForNetworkIdlePageLoadTime: number;
	public maximumWaitPageLoadTime: number;
	public waitBetweenActions: number;
	public disableSecurity: boolean;
	public browserWindowSize: BrowserContextWindowSize;
	public noViewport: boolean | null;
	public saveRecordingPath: string | null;
	public saveDownloadsPath: string | null;
	public tracePath: string | null;
	public locale: string | null;
	public userAgent: string;
	public highlightElements: boolean;
	public viewportExpansion: number;
	public allowedDomains: string[] | null;
	public includeDynamicAttributes: boolean;
	public forceKeepContextAlive: boolean;
	public isMobile: boolean | null;
	public hasTouch: boolean | null;
	public geolocation: Geolocation | null;
	public permissions: string[] | null;
	public timezoneId: string | null;

	constructor(params: BrowserContextConfigParams = {}) {
		this.cookiesFile = params.cookiesFile ?? null;
		this.minimumWaitPageLoadTime = params.minimumWaitPageLoadTime ?? 0.25;
		this.waitForNetworkIdlePageLoadTime =
			params.waitForNetworkIdlePageLoadTime ?? 0.5;
		this.maximumWaitPageLoadTime = params.maximumWaitPageLoadTime ?? 5;
		this.waitBetweenActions = params.waitBetweenActions ?? 0.5;
		this.disableSecurity = params.disableSecurity ?? true;
		this.browserWindowSize = params.browserWindowSize ?? {
			width: 1280,
			height: 1100,
		};
		this.noViewport = params.noViewport ?? null;
		this.saveRecordingPath = params.saveRecordingPath ?? null;
		this.saveDownloadsPath = params.saveDownloadsPath ?? null;
		this.tracePath = params.tracePath ?? null;
		this.locale = params.locale ?? null;
		this.userAgent =
			params.userAgent ??
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36";
		this.highlightElements = params.highlightElements ?? true;
		this.viewportExpansion = params.viewportExpansion ?? 500;
		this.allowedDomains = params.allowedDomains ?? null;
		this.includeDynamicAttributes = params.includeDynamicAttributes ?? true;
		this.forceKeepContextAlive = params.forceKeepContextAlive ?? false;
		this.isMobile = params.isMobile ?? null;
		this.hasTouch = params.hasTouch ?? null;
		this.geolocation = params.geolocation ?? null;
		this.permissions = params.permissions ?? null;
		this.timezoneId = params.timezoneId ?? null;
	}
}

class BrowserSession {
	constructor(
		public context: PlaywrightBrowserContext,
		public cachedState: BrowserState | null,
	) {}
}

class BrowserContextState {
	/**
	 * State of the browser context
	 */
	constructor(public targetId: string | null) {}
}

export class BrowserContext {
	public contextId: string;
	public config: BrowserContextConfig;
	public browser: Browser;
	public state: BrowserContextState;
	public session: BrowserSession | null = null;
	public pageEventHandler: ((page: Page) => Promise<void>) | null = null;
	public currentState?: BrowserState;

	constructor(
		browser: Browser,
		config: BrowserContextConfig = new BrowserContextConfig(),
		state: BrowserContextState | null = null,
	) {
		this.contextId = uuid.v4();

		logger.debug(`Initializing new browser context with id: ${this.contextId}`);

		this.config = config;
		this.browser = browser;
		this.state = state || new BrowserContextState(null);
	}

	@timeExecution("--initializeSession(browserContext)")
	async initializeSession(): Promise<BrowserSession> {
		logger.debug("Initializing browser context");

		const playwrightBrowser = await this.browser.getPlaywrightBrowser();
		const context = await this.createContext(playwrightBrowser);
		this.pageEventHandler = null;

		const pages = context.pages();
		this.session = {
			context,
			cachedState: null,
		};

		let activePage: Page | undefined = undefined;
		if (this.browser.config.cdpUrl && this.state.targetId) {
			const targets = await this.getCdpTargets();
			for (const target of targets) {
				if (target.targetId === this.state.targetId) {
					for (const page of pages) {
						if (page.url === target.url) {
							activePage = page;
							break;
						}
					}
					break;
				}
			}
		}

		if (!activePage) {
			activePage = pages.length > 0 ? pages[0] : await context.newPage();
			logger.debug(
				pages.length > 0 ? "Using existing page" : "Created new page",
			);

			if (this.browser.config.cdpUrl) {
				const targets = await this.getCdpTargets();
				for (const target of targets) {
					if (target.url === activePage!.url) {
						this.state.targetId = target.targetId;
						break;
					}
				}
			}
		}

		await activePage!.bringToFront();
		await activePage!.waitForLoadState("load");
		this.addNewPageListener(context);

		return this.session;
	}

	private addNewPageListener(context: PlaywrightBrowserContext): void {
		const onPage = async (page: Page) => {
			if (this.browser.config.cdpUrl) {
				await page.reload();
			}
			await page.waitForLoadState();
			logger.debug(`New page opened: ${page.url}`);
			if (this.session) {
				this.state.targetId = null;
			}
		};
		this.pageEventHandler = onPage;
		context.on("page", onPage);
	}

	@timeExecution("--close(browserContext)")
	async close(): Promise<void> {
		logger.debug("Closing browser context");

		if (!this.session) return;

		try {
			if (this.pageEventHandler && this.session.context) {
				try {
					this.session.context.off("page", this.pageEventHandler);
				} catch (e) {
					logger.debug(`Failed to remove CDP listener: ${e}`);
				}
				this.pageEventHandler = null;
			}

			await this.saveCookies();

			if (this.config.tracePath) {
				try {
					await this.session.context.tracing.stop({
						path: `${this.config.tracePath}/${this.contextId}.zip`,
					});
				} catch (e) {
					logger.debug(`Failed to stop tracing: ${e}`);
				}
			}

			if (!this.config.forceKeepContextAlive) {
				try {
					await this.session.context.close();
				} catch (e) {
					logger.debug(`Failed to close context: ${e}`);
				}
			}
		} finally {
			this.session = null;
			this.pageEventHandler = null;
		}
	}

	async getSession(): Promise<BrowserSession> {
		if (!this.session) {
			return await this.initializeSession();
		}
		return this.session;
	}

	async getCurrentPage(): Promise<Page> {
		const session = await this.getSession();
		return await this.getCurrentPageInternal(session);
	}

	private async createContext(
		browser: PlaywrightBrowser,
	): Promise<PlaywrightBrowserContext> {
		let context: PlaywrightBrowserContext;
		if (this.browser.config.cdpUrl && browser.contexts.length > 0) {
			context = browser.contexts()[0]!;
		} else if (
			this.browser.config.browserInstancePath &&
			browser.contexts.length > 0
		) {
			context = browser.contexts()[0]!;
		} else {
			context = await browser.newContext({
				viewport: this.config.browserWindowSize,
				// noViewport: false,
				userAgent: this.config.userAgent,
				javaScriptEnabled: true,
				bypassCSP: this.config.disableSecurity,
				ignoreHTTPSErrors: this.config.disableSecurity,
				recordVideo: this.config.saveRecordingPath
					? {
							dir: this.config.saveRecordingPath,
							size: this.config.browserWindowSize,
						}
					: undefined,
				locale: this.config.locale || undefined,
				isMobile: this.config.isMobile || undefined,
				hasTouch: this.config.hasTouch || undefined,
				geolocation: this.config.geolocation || undefined,
				permissions: this.config.permissions || undefined,
				timezoneId: this.config.timezoneId || undefined,
			});
		}

		if (this.config.tracePath) {
			await context.tracing.start({
				screenshots: true,
				snapshots: true,
				sources: true,
			});
		}

		await context.addInitScript({
			content: `
              Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
              Object.defineProperty(navigator, 'languages', { get: () => ['en-US'] });
              Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
              window.chrome = { runtime: {} };
              const originalQuery = window.navigator.permissions.query;
              window.navigator.permissions.query = (parameters) => (
                  parameters.name === 'notifications' ?
                      Promise.resolve({ state: Notification.permission }) :
                      originalQuery(parameters)
              );
              (function () {
                  const originalAttachShadow = Element.prototype.attachShadow;
                  Element.prototype.attachShadow = function attachShadow(options) {
                      return originalAttachShadow.call(this, { ...options, mode: "open" });
                  };
              })();
          `,
		});

		return context;
	}

	async waitForStableNetwork(): Promise<void> {
		const page = await this.getCurrentPage();
		const pendingRequests = new Set<any>();
		let lastActivity = Date.now();

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
		const IGNORED_URL_PATTERNS = new Set([
			"analytics",
			"tracking",
			"telemetry",
			"beacon",
			"metrics",
			"doubleclick",
			"adsystem",
			"adserver",
			"advertising",
			"facebook.com/plugins",
			"platform.twitter",
			"linkedin.com/embed",
			"livechat",
			"zendesk",
			"intercom",
			"crisp.chat",
			"hotjar",
			"push-notifications",
			"onesignal",
			"pushwoosh",
			"heartbeat",
			"ping",
			"alive",
			"webrtc",
			"rtmp://",
			"wss://",
			"cloudfront.net",
			"fastly.net",
		]);

		const onRequest = async (request: any) => {
			if (!RELEVANT_RESOURCE_TYPES.has(request.resourceType())) return;
			if (
				["websocket", "media", "eventsource", "manifest", "other"].includes(
					request.resourceType(),
				)
			)
				return;
			const url = request.url().toLowerCase();
			if ([...IGNORED_URL_PATTERNS].some((pattern) => url.includes(pattern)))
				return;
			if (url.startsWith("data:") || url.startsWith("blob:")) return;
			const headers = await request.headers();
			if (
				headers.purpose === "prefetch" ||
				["video", "audio"].includes(headers["sec-fetch-dest"])
			)
				return;

			pendingRequests.add(request);
			lastActivity = Date.now();
		};

		const onResponse = async (response: any) => {
			const request = response.request();
			if (!pendingRequests.has(request)) return;
			const contentType =
				(await response.headers())["content-type"]?.toLowerCase() || "";
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
			if (![...RELEVANT_CONTENT_TYPES].some((ct) => contentType.includes(ct))) {
				pendingRequests.delete(request);
				return;
			}
			const contentLength = (await response.headers())["content-length"];
			if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
				pendingRequests.delete(request);
				return;
			}
			pendingRequests.delete(request);
			lastActivity = Date.now();
		};

		page.on("request", onRequest);
		page.on("response", onResponse);

		try {
			const startTime = Date.now();
			while (true) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				const now = Date.now();
				if (
					pendingRequests.size === 0 &&
					now - lastActivity >=
						this.config.waitForNetworkIdlePageLoadTime * 1000
				)
					break;
				if (now - startTime > this.config.maximumWaitPageLoadTime * 1000) {
					logger.debug(
						`Network timeout after ${this.config.maximumWaitPageLoadTime}s with ${pendingRequests.size} pending requests`,
					);
					break;
				}
			}
		} finally {
			page.off("request", onRequest);
			page.off("response", onResponse);
		}

		logger.debug(
			`Network stabilized for ${this.config.waitForNetworkIdlePageLoadTime} seconds`,
		);
	}

	async waitForPageAndFramesLoad(timeoutOverwrite?: number): Promise<void> {
		const startTime = Date.now();
		try {
			await this.waitForStableNetwork();
			const page = await this.getCurrentPage();
			await this.checkAndHandleNavigation(page);
		} catch (e) {
			if (e instanceof URLNotAllowedError) throw e;
			logger.warn("Page load failed, continuing...");
		}
		const elapsed = (Date.now() - startTime) / 1000;
		const remaining = Math.max(
			(timeoutOverwrite || this.config.minimumWaitPageLoadTime) - elapsed,
			0,
		);
		logger.debug(
			`--Page loaded in ${elapsed.toFixed(2)} seconds, waiting for additional ${remaining.toFixed(2)} seconds`,
		);
		if (remaining > 0)
			await new Promise((resolve) => setTimeout(resolve, remaining * 1000));
	}

	private isUrlAllowed(url: string): boolean {
		if (!this.config.allowedDomains) return true;
		try {
			const urlObj = new URL(url);
			let domain = urlObj.hostname.toLowerCase();
			if (domain.includes(":")) domain = domain.split(":")[0]!;
			return this.config.allowedDomains.some(
				(allowed) =>
					domain === allowed.toLowerCase() ||
					domain.endsWith("." + allowed.toLowerCase()),
			);
		} catch (e) {
			logger.error(`Error checking URL allowlist: ${e}`);
			return false;
		}
	}

	private async checkAndHandleNavigation(page: Page): Promise<void> {
		if (!this.isUrlAllowed(page.url())) {
			logger.warn(`Navigation to non-allowed URL detected: ${page.url}`);
			try {
				await this.goBack();
			} catch (e) {
				logger.error(`Failed to go back after detecting non-allowed URL: ${e}`);
			}
			throw new URLNotAllowedError(
				`Navigation to non-allowed URL: ${page.url}`,
			);
		}
	}

	async navigateTo(url: string): Promise<void> {
		if (!this.isUrlAllowed(url))
			throw new BrowserError(`Navigation to non-allowed URL: ${url}`);
		const page = await this.getCurrentPage();
		await page.goto(url);
		await page.waitForLoadState();
	}

	async refreshPage(): Promise<void> {
		const page = await this.getCurrentPage();
		await page.reload();
		await page.waitForLoadState();
	}

	async goBack(): Promise<void> {
		const page = await this.getCurrentPage();
		try {
			await page.goBack({ timeout: 10, waitUntil: "domcontentloaded" });
		} catch (e) {
			logger.debug(`During goBack: ${e}`);
		}
	}

	async goForward(): Promise<void> {
		const page = await this.getCurrentPage();
		try {
			await page.goForward({ timeout: 10, waitUntil: "domcontentloaded" });
		} catch (e) {
			logger.debug(`During goForward: ${e}`);
		}
	}

	async closeCurrentTab(): Promise<void> {
		const session = await this.getSession();
		const page = await this.getCurrentPageInternal(session);
		await page.close();
		if (session.context.pages().length > 0) await this.switchToTab(0);
	}

	async getPageHtml(): Promise<string> {
		const page = await this.getCurrentPage();
		return await page.content();
	}

	async executeJavascript(script: string): Promise<any> {
		const page = await this.getCurrentPage();
		return await page.evaluate(script);
	}

	async getPageStructure(): Promise<string> {
		const debugScript = `(() => {
          function getPageStructure(element = document, depth = 0, maxDepth = 10) {
              if (depth >= maxDepth) return '';
              const indent = '  '.repeat(depth);
              let structure = '';
              const skipTags = new Set(['script', 'style', 'link', 'meta', 'noscript']);
              if (element !== document) {
                  const tagName = element.tagName.toLowerCase();
                  if (skipTags.has(tagName)) return '';
                  const id = element.id ? \`#\${element.id}\` : '';
                  const classes = element.className && typeof element.className === 'string' ?
                      \`.\${element.className.split(" ").filter(c => c).join(".")}\` : '';
                  const attrs = [];
                  if (element.getAttribute('role')) attrs.push(\`role="\${element.getAttribute('role')}"\`);
                  if (element.getAttribute('aria-label')) attrs.push(\`aria-label="\${element.getAttribute('aria-label')}"\`);
                  if (element.getAttribute('type')) attrs.push(\`type="\${element.getAttribute('type')}"\`);
                  if (element.getAttribute('name')) attrs.push(\`name="\${element.getAttribute('name')}"\`);
                  if (element.getAttribute('src')) {
                      const src = element.getAttribute('src');
                      attrs.push(\`src="\${src.substring(0, 50)}\${src.length > 50 ? '...' : ''}"\`);
                  }
                  structure += \`\${indent}\${tagName}\${id}\${classes}\${attrs.length ? ' [' + attrs.join(', ') + ']' : ''}\\n\`;
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
              const children = element.children || element.childNodes;
              for (const child of children) {
                  if (child.nodeType === 1) {
                      structure += getPageStructure(child, depth + 1, maxDepth);
                  }
              }
              return structure;
          }
          return getPageStructure();
      })()`;
		const page = await this.getCurrentPage();
		return await page.evaluate(debugScript);
	}
	/**
	 * Get the current state of the browser
	 * @returns The current state of the browser
	 */
	@timeExecution("--getState(browserContext)")
	async getState(): Promise<BrowserState> {
		await this.waitForPageAndFramesLoad();
		const session = await this.getSession();
		session.cachedState = await this.updateState();
		if (this.config.cookiesFile) {
			setImmediate(() => this.saveCookies()); // Simulating asyncio.create_task
		}
		return session.cachedState;
	}

	private async updateState(focusElement: number = -1): Promise<BrowserState> {
		const session = await this.getSession();
		let page: Page;
		try {
			page = await this.getCurrentPage();
			await page.evaluate("1");
		} catch (e) {
			logger.debug(`Current page is no longer accessible: ${e}`);
			const pages = session.context.pages();
			if (pages.length > 0) {
				this.state.targetId = null;
				page = await this.getCurrentPageInternal(session);
				logger.debug(`Switched to page: ${await page.title()}`);
			} else {
				throw new BrowserError("Browser closed: no valid pages available");
			}
		}

		try {
			await this.removeHighlights();
			const domService = new DomService(page);
			const content = await domService.getClickableElements(
				this.config.highlightElements,
				focusElement,
				this.config.viewportExpansion,
			);

			const screenshotB64 = await this.takeScreenshot();
			const [pixelsAbove, pixelsBelow] = await this.getScrollInfo(page);

			this.currentState = new BrowserState(
				content.elementTree,
				content.selectorMap,
				page.url(),
				await page.title(),
				await this.getTabsInfo(),
				screenshotB64,
				pixelsAbove,
				pixelsBelow,
				[],
			);

			return this.currentState;
		} catch (e) {
			logger.error(`Failed to update state: ${e}`);
			if (this.currentState) return this.currentState;
			throw e;
		}
	}

	@timeExecution("--takeScreenshot(browserContext)")
	async takeScreenshot(fullPage: boolean = false): Promise<string> {
		const page = await this.getCurrentPage();
		await page.bringToFront();
		await page.waitForLoadState();
		const screenshot = await page.screenshot({
			fullPage,
			animations: "disabled",
		});
		return Buffer.from(screenshot).toString("base64");
	}

	@timeExecution("--removeHighlights(browserContext)")
	async removeHighlights(): Promise<void> {
		try {
			const page = await this.getCurrentPage();
			await page.evaluate(`
				try {
					// Remove the highlight container and all its contents
					const container = document.getElementById('playwright-highlight-container');
					if (container) {
						container.remove();
					}
					// Remove highlight attributes from elements
					const highlightedElements = document.querySelectorAll('[browser-user-highlight-id^="playwright-highlight-"]');
					highlightedElements.forEach(el => {
						el.removeAttribute('browser-user-highlight-id');
					});
				} catch (e) {
					console.error('Failed to remove highlights:', e);
				}
			`);
		} catch (e) {
			logger.debug(`Failed to remove highlights (this is usually ok): ${e}`);
			// Don't raise the error since this is not critical functionality
		}
	}

	private static convertSimpleXpathToCssSelector(xpath: string): string {
		if (!xpath) return "";
		xpath = xpath.replace(/^\//, "");
		const parts = xpath.split("/");
		const cssParts: string[] = [];
		for (const part of parts) {
			if (!part) continue;
			if (part.includes(":") && !part.includes("[")) {
				cssParts.push(part.replace(/:/g, "\\:"));
				continue;
			}
			if (part.includes("[")) {
				let basePart = part.substring(0, part.indexOf("["));
				if (basePart.includes(":")) basePart = basePart.replace(/:/g, "\\:");
				const indexPart = part.substring(part.indexOf("["));
				const indices = indexPart
					.split("]")
					.slice(0, -1)
					.map((i) => i.replace(/[\[\]]/g, ""));
				for (const idx of indices) {
					if (/^\d+$/.test(idx)) {
						const index = parseInt(idx) - 1;
						basePart += `:nth-of-type(${index + 1})`;
					} else if (idx === "last()") {
						basePart += ":last-of-type";
					} else if (idx.includes("position()") && idx.includes(">1")) {
						basePart += ":nth-of-type(n+2)";
					}
				}
				cssParts.push(basePart);
			} else {
				cssParts.push(part);
			}
		}
		return cssParts.join(" > ");
	}

	@timeExecution("--enhancedCssSelectorForElement")
	private static enhancedCssSelectorForElement(
		element: DOMElementNode,
		includeDynamicAttributes: boolean = true,
	): string {
		try {
			let cssSelector = this.convertSimpleXpathToCssSelector(element.xpath);
			if (element.attributes.class && includeDynamicAttributes) {
				const validClassNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
				const classes = element.attributes.class.split(/\s+/);
				for (const className of classes) {
					if (className && validClassNamePattern.test(className)) {
						cssSelector += `.${className}`;
					}
				}
			}

			const SAFE_ATTRIBUTES = new Set([
				//Data attributes (if they're stable in your application)
				"id",
				//Standard HTML attributes
				"name",
				"type",
				"placeholder",
				//Accessibility attributes
				"aria-label",
				"aria-labelledby",
				"aria-describedby",
				"role",
				//Common form attributes
				"for",
				"autocomplete",
				"required",
				"readonly",
				//Media attributes
				"alt",
				"title",
				"src",
				// Custom stable attributes (add any application-specific ones)
				"href",
				"target",
			]);
			if (includeDynamicAttributes) {
				SAFE_ATTRIBUTES.add("data-id")
					.add("data-qa")
					.add("data-cy")
					.add("data-testid");
			}

			for (const [attribute, value] of Object.entries(element.attributes)) {
				if (
					attribute === "class" ||
					!attribute ||
					!SAFE_ATTRIBUTES.has(attribute)
				)
					continue;
				const safeAttribute = attribute.replace(/:/g, "\\:");
				if (value === "") {
					cssSelector += `[${safeAttribute}]`;
				} else if (/["'<>`\n\r\t]/.test(value)) {
					const collapsedValue = value
						.replace(/\s+/g, " ")
						.trim()
						.replace(/"/g, '\\"');
					cssSelector += `[${safeAttribute}*="${collapsedValue}"]`;
				} else {
					cssSelector += `[${safeAttribute}="${value}"]`;
				}
			}

			return cssSelector;
		} catch {
			const tagName = element.tagName || "*";
			return `${tagName}[highlight_index='${element.highlightIndex}']`;
		}
	}

	@timeExecution("--getLocateElement(browserContext)")
	async getLocateElement(
		element: DOMElementNode,
	): Promise<ElementHandle | null> {
		let currentFrame: Page | FrameLocator = await this.getCurrentPage();
		const parents: DOMElementNode[] = [];
		let current = element;
		while (current.parent) {
			parents.push(current.parent);
			current = current.parent;
		}
		parents.reverse();

		const iframes = parents.filter((item) => item.tagName === "iframe");
		for (const parent of iframes) {
			const cssSelector = BrowserContext.enhancedCssSelectorForElement(
				parent,
				this.config.includeDynamicAttributes,
			);
			currentFrame = (currentFrame as Page).frameLocator(cssSelector);
		}

		const cssSelector = BrowserContext.enhancedCssSelectorForElement(
			element,
			this.config.includeDynamicAttributes,
		);
		try {
			if (isFrameLocator(currentFrame)) {
				return await currentFrame.locator(cssSelector).elementHandle();
			} else {
				const elementHandle = await currentFrame.$(cssSelector);
				if (elementHandle) await elementHandle.scrollIntoViewIfNeeded();
				return elementHandle;
			}
		} catch (e) {
			logger.error(`Failed to locate element: ${e}`);
			return null;
		}
	}

	@timeExecution("--inputTextElementNode(browserContext)")
	async inputTextElementNode(
		elementNode: DOMElementNode,
		text: string,
	): Promise<void> {
		const elementHandle = await this.getLocateElement(elementNode);
		if (!elementHandle)
			throw new BrowserError(
				`Element: ${JSON.stringify(elementNode)} not found`,
			);

		try {
			await elementHandle.waitForElementState("stable", { timeout: 1000 });
			await elementHandle.scrollIntoViewIfNeeded({ timeout: 1000 });
		} catch {}

		const tagHandle = await elementHandle.getProperty("tagName");
		const tagName = (await tagHandle.jsonValue()).toLowerCase();
		const isContentEditable = await (
			await elementHandle.getProperty("isContentEditable")
		).jsonValue();
		const readonly =
			(await (await elementHandle.getProperty("readOnly"))?.jsonValue()) ||
			false;
		const disabled =
			(await (await elementHandle.getProperty("disabled"))?.jsonValue()) ||
			false;

		if ((isContentEditable || tagName === "input") && !(readonly || disabled)) {
			await elementHandle.evaluate('el => el.textContent = ""');
			await elementHandle.type(text, { delay: 5 });
		} else {
			await elementHandle.fill(text);
		}
	}

	@timeExecution("--clickElementNode(browserContext)")
	async clickElementNode(
		elementNode: DOMElementNode,
	): Promise<string | undefined> {
		const page = await this.getCurrentPage();
		const elementHandle = await this.getLocateElement(elementNode);
		if (!elementHandle)
			throw new Error(`Element: ${JSON.stringify(elementNode)} not found`);

		const performClick = async (
			clickFunc: () => Promise<void>,
		): Promise<string | undefined> => {
			if (this.config.saveDownloadsPath) {
				try {
					const downloadPromise = page.waitForEvent("download", {
						timeout: 5000,
					});
					await clickFunc();
					const download = await downloadPromise;
					const suggestedFilename = download.suggestedFilename();
					const uniqueFilename = await this.getUniqueFilename(
						this.config.saveDownloadsPath,
						suggestedFilename,
					);
					const downloadPath = `${this.config.saveDownloadsPath}/${uniqueFilename}`;
					await download.saveAs(downloadPath);
					logger.debug(`Download triggered. Saved file to: ${downloadPath}`);
					return downloadPath;
				} catch (e) {
					if (e instanceof playwrightErrors.TimeoutError) {
						logger.debug(
							"No download triggered within timeout. Checking navigation...",
						);
						await page.waitForLoadState();
						await this.checkAndHandleNavigation(page);
					} else throw e;
				}
			} else {
				await clickFunc();
				await page.waitForLoadState();
				await this.checkAndHandleNavigation(page);
			}
		};

		try {
			return await performClick(() => elementHandle.click({ timeout: 1500 }));
		} catch (e) {
			if (e instanceof URLNotAllowedError) throw e;
			try {
				return await performClick(() =>
					page.evaluate("(el) => el.click()", elementHandle),
				);
			} catch (err) {
				if (err instanceof URLNotAllowedError) throw err;
				throw new Error(`Failed to click element: ${err}`);
			}
		}
	}

	@timeExecution("--getTabsInfo(browserContext)")
	async getTabsInfo(): Promise<TabInfo[]> {
		const session = await this.getSession();
		const tabsInfo: TabInfo[] = [];
		for (const [pageId, page] of session.context.pages().entries()) {
			tabsInfo.push(new TabInfo(pageId, page.url(), await page.title()));
		}
		return tabsInfo;
	}

	@timeExecution("--switchToTab(browserContext)")
	async switchToTab(pageId: number): Promise<void> {
		const session = await this.getSession();
		const pages = session.context.pages();
		if (pageId >= pages.length)
			throw new BrowserError(`No tab found with pageId: ${pageId}`);
		const page = pages[pageId]!;
		if (!this.isUrlAllowed(page.url()))
			throw new BrowserError(
				`Cannot switch to tab with non-allowed URL: ${page.url()}`,
			);
		if (this.browser.config.cdpUrl) {
			const targets = await this.getCdpTargets();
			for (const target of targets) {
				if (target.url === page.url) {
					this.state.targetId = target.targetId;
					break;
				}
			}
		}
		await page.bringToFront();
		await page.waitForLoadState();
	}

	@timeExecution("--createNewTab(browserContext)")
	async createNewTab(url?: string): Promise<void> {
		if (url && !this.isUrlAllowed(url))
			throw new BrowserError(
				`Cannot create new tab with non-allowed URL: ${url}`,
			);
		const session = await this.getSession();
		const newPage = await session.context.newPage();
		await newPage.waitForLoadState();
		if (url) {
			await newPage.goto(url);
			await this.waitForPageAndFramesLoad(1);
		}
		if (this.browser.config.cdpUrl) {
			const targets = await this.getCdpTargets();
			for (const target of targets) {
				if (target.url === newPage.url) {
					this.state.targetId = target.targetId;
					break;
				}
			}
		}
	}

	private async getCurrentPageInternal(session: BrowserSession): Promise<Page> {
		const pages = session.context.pages();
		if (this.browser.config.cdpUrl && this.state.targetId) {
			const targets = await this.getCdpTargets();
			for (const target of targets) {
				if (target.targetId === this.state.targetId) {
					for (const page of pages) {
						if (page.url === target.url) return page;
					}
				}
			}
		}
		return pages.length > 0
			? pages[pages.length - 1]!
			: await session.context.newPage();
	}

	async getSelectorMap(): Promise<SelectorMap> {
		const session = await this.getSession();
		return session.cachedState?.selectorMap || {};
	}

	async getElementByIndex(index: number): Promise<ElementHandle | null> {
		const selectorMap = await this.getSelectorMap();
		return await this.getLocateElement(selectorMap[index]!);
	}

	async getDomElementByIndex(index: number): Promise<DOMElementNode> {
		const selectorMap = await this.getSelectorMap();
		return selectorMap[index]!;
	}

	async saveCookies(): Promise<void> {
		if (this.session && this.session.context && this.config.cookiesFile) {
			try {
				const cookies = await this.session.context.cookies();
				logger.debug(
					`Saving ${cookies.length} cookies to ${this.config.cookiesFile}`,
				);
				// Note: File system operations require Node.js fs.promises or similar, omitted here
			} catch (e) {
				logger.warn(`Failed to save cookies: ${e}`);
			}
		}
	}

	async isFileUploader(
		elementNode: DOMElementNode,
		maxDepth: number = 3,
		currentDepth: number = 0,
	): Promise<boolean> {
		if (currentDepth > maxDepth || !(elementNode instanceof DOMElementNode))
			return false;
		if (elementNode.tagName === "input") {
			return (
				elementNode.attributes.type === "file" ||
				!!elementNode.attributes.accept
			);
		}
		if (elementNode.children && currentDepth < maxDepth) {
			for (const child of elementNode.children) {
				if (
					child instanceof DOMElementNode &&
					(await this.isFileUploader(child, maxDepth, currentDepth + 1))
				) {
					return true;
				}
			}
		}
		return false;
	}

	async getScrollInfo(page: Page): Promise<[number, number]> {
		const scrollY = await page.evaluate("window.scrollY");
		const viewportHeight = await page.evaluate("window.innerHeight");
		const totalHeight = await page.evaluate(
			"document.documentElement.scrollHeight",
		);
		return [
			scrollY as number,
			(totalHeight as number) -
				(scrollY as number) -
				(viewportHeight as number),
		];
	}

	async resetContext(): Promise<void> {
		const session = await this.getSession();
		for (const page of session.context.pages()) {
			await page.close();
		}
		session.cachedState = null;
		this.state.targetId = null;
	}

	private async getUniqueFilename(
		directory: string,
		filename: string,
	): Promise<string> {
		// Note: Requires Node.js path and fs for actual file checking, simulated here
		const [base, ext] = filename.split(/(\.[^.]+)$/);
		let counter = 1;
		let newFilename = filename;
		// while (fs.existsSync(`${directory}/${newFilename}`)) {
		//     newFilename = `${base} (${counter})${ext || ''}`;
		//     counter++;
		// }
		return newFilename;
	}

	private async getCdpTargets(): Promise<any[]> {
		if (!this.browser.config.cdpUrl || !this.session) return [];
		try {
			const pages = this.session.context.pages();
			if (!pages.length) return [];
			const firstPage = pages[0]!;
			const cdpSession = await firstPage.context().newCDPSession(firstPage);
			const result = await cdpSession.send("Target.getTargets");
			await cdpSession.detach();
			return result.targetInfos || [];
		} catch (e) {
			logger.debug(`Failed to get CDP targets: ${e}`);
			return [];
		}
	}
}

function isFrameLocator(obj: Page | FrameLocator): obj is FrameLocator {
	return (obj as FrameLocator).first !== undefined;
}
