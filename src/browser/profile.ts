import { URL } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type {
	Browser,
	BrowserContext,
	ClientCertificate,
	Geolocation,
	HTTPCredentials,
	Page,
	ProxySettings,
	ViewportSize,
} from "./types";

// Chrome debugging port
//use a non-default port to avoid conflicts with other tools / devs using 9222
export const CHROME_DEBUG_PORT = 9242;

// Chrome disabled components (equivalent to Python CHROME_DISABLED_COMPONENTS)
export const CHROME_DISABLED_COMPONENTS = [
	// Playwright defaults: https://github.com/microsoft/playwright/blob/41008eeddd020e2dee1c540f7c0cdfa337e99637/packages/playwright-core/src/server/chromium/chromiumSwitches.ts#L76
	// AcceptCHFrame,AutoExpandDetailsElement,AvoidUnnecessaryBeforeUnloadCheckSync,CertificateTransparencyComponentUpdater,DeferRendererTasksAfterInput,DestroyProfileOnBrowserClose,DialMediaRouteProvider,ExtensionManifestV2Disabled,GlobalMediaControls,HttpsUpgrades,ImprovedCookieControls,LazyFrameLoading,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate
	// See https://github.com/microsoft/playwright/pull/10380
	"AcceptCHFrame",
	// See https://github.com/microsoft/playwright/pull/10679
	"AutoExpandDetailsElement",
	// See https://github.com/microsoft/playwright/issues/14047
	"AvoidUnnecessaryBeforeUnloadCheckSync",
	// See https://github.com/microsoft/playwright/pull/12992
	"CertificateTransparencyComponentUpdater",
	"DestroyProfileOnBrowserClose",
	// See https://github.com/microsoft/playwright/pull/13854
	"DialMediaRouteProvider",
	// Chromium is disabling manifest version 2. Allow testing it as long as Chromium can actually run it.
	// Disabled in https://chromium-review.googlesource.com/c/chromium/src/+/6265903.
	"ExtensionManifestV2Disabled",
	"GlobalMediaControls",
	//See https://github.com/microsoft/playwright/pull/27605
	"HttpsUpgrades",
	"ImprovedCookieControls",
	"LazyFrameLoading",
	// Hides the Lens feature in the URL address bar. Its not working in unofficial builds.
	"LensOverlay",
	// See https://github.com/microsoft/playwright/pull/8162
	"MediaRouter",
	// See https://github.com/microsoft/playwright/issues/28023
	"PaintHolding",
	// See https:#github.com/microsoft/playwright/issues/32230
	"ThirdPartyStoragePartitioning",
	// See https://github.com/microsoft/playwright/issues/16126
	"Translate",
	//***********
	// Added by us:
	"AutomationControlled",
	"BackForwardCache",
	"OptimizationHints",
	"ProcessPerSiteUpToMainFrameThreshold",
	"InterestFeedContentSuggestions",
	"CalculateNativeWinOcclusion", //chrome normally stops rendering tabs if they are not visible (occluded by a foreground window or other app)
	//'BackForwardCache', // agent does actually use back/forward navigation, but we can disable if we ever remove that
	"HeavyAdPrivacyMitigations",
	"PrivacySandboxSettings4",
	"AutofillServerCommunication",
	"CrashReporting",
	"OverscrollHistoryNavigation",
	"InfiniteSessionRestore",
	"ExtensionDisableUnsupportedDeveloper",
];

// Chrome command line arguments
export const CHROME_HEADLESS_ARGS = ["--headless=new"];

export const CHROME_DOCKER_ARGS = [
	// '--disable-gpu',   // GPU is actually supported in headless docker mode now, but sometimes useful to test without it
	"--no-sandbox",
	"--disable-gpu-sandbox",
	"--disable-setuid-sandbox",
	"--disable-dev-shm-usage",
	"--no-xshm",
	"--no-zygote",
	// '--single-process',  // might be the cause of "Target page, context or browser has been closed" errors during CDP page.captureScreenshot https://stackoverflow.com/questions/51629151/puppeteer-protocol-error-page-navigate-target-closed
	"--disable-site-isolation-trials", //lowers RAM use by 10-16% in docker, but could lead to easier bot blocking if pages can detect it?
];

export const CHROME_DISABLE_SECURITY_ARGS = [
	"--disable-site-isolation-trials",
	"--disable-web-security",
	"--disable-features=IsolateOrigins,site-per-process",
	"--allow-running-insecure-content",
	"--ignore-certificate-errors",
	"--ignore-ssl-errors",
	"--ignore-certificate-errors-spki-list",
];

export const CHROME_DETERMINISTIC_RENDERING_ARGS = [
	"--deterministic-mode",
	"--js-flags=--random-seed=1157259159",
	"--force-device-scale-factor=2",
	"--enable-webgl",
	//"--disable-skia-runtime-opts",
	// "--disable-2d-canvas-clip-aa",
	"--font-render-hinting=none",
	"--force-color-profile=srgb",
];

export const CHROME_DEFAULT_ARGS = [
	// // provided by playwright by default: https://github.com/microsoft/playwright/blob/41008eeddd020e2dee1c540f7c0cdfa337e99637/packages/playwright-core/src/server/chromium/chromiumSwitches.ts#L76
	// // we don't need to include them twice in our own config, but it's harmless
	// "--disable-field-trial-config", // https://source.chromium.org/chromium/chromium/src/+/main:testing/variations/README.md
	// "--disable-background-networking",
	// "--disable-background-timer-throttling", // agents might be working on background pages if the human switches to another tab
	// "--disable-backgrounding-occluded-windows", // same deal, agents are often working on backgrounded browser windows
	// "--disable-back-forward-cache", // Avoids surprises like main request not being intercepted during page.goBack().
	// "--disable-breakpad",
	// "--disable-client-side-phishing-detection",
	// "--disable-component-extensions-with-background-pages",
	// "--disable-component-update", // Avoids unneeded network activity after startup.
	// "--no-default-browser-check",
	// //  '--disable-default-apps',
	// "--disable-dev-shm-usage", // crucial for docker support, harmless in non-docker environments
	// // 'disable-extensions',
	// //  'disable-features=' + disabledFeatures(assistantMode).join(','),
	// "--allow-pre-commit-input", // let page JS run a little early before GPU rendering finishes
	// "--disable-hang-monitor",
	// "--disable-ipc-flooding-protection", // important to be able to make lots of CDP calls in a tight loop
	// "--disable-popup-blocking",
	// "--disable-prompt-on-repost",
	// "--disable-renderer-backgrounding",
	// // 	 '--force-color-profile=srgb',  # moved to CHROME_DETERMINISTIC_RENDERING_ARGS
	// "--metrics-recording-only",
	// "--no-first-run",
	// "--password-store=basic",
	// "--use-mock-keychain",
	// //  // See https://chromium-review.googlesource.com/c/chromium/src/+/2436773
	// "--no-service-autorun",
	// "--export-tagged-pdf",
	// //  https://chromium-review.googlesource.com/c/chromium/src/+/4853540
	// "--disable-search-engine-choice-screen",
	// //  https://issues.chromium.org/41491762
	// "--unsafely-disable-devtools-self-xss-warnings",

	// Added by us:
	"--enable-features=NetworkService,NetworkServiceInProcess",
	"--enable-network-information-downlink-max",
	"--test-type=gpu",
	"--disable-sync",
	"--allow-legacy-extension-manifests",
	"--allow-pre-commit-input",
	"--disable-blink-features=AutomationControlled",
	"--install-autogenerated-theme=0,0,0",
	// '--hide-scrollbars',// leave them visible! the agent uses them to know when it needs to scroll to see more options
	"--log-level=2",
	// '--enable-logging=stderr',
	"--disable-focus-on-load",
	"--disable-window-activation",
	"--generate-pdf-document-outline",
	"--no-pings",
	"--ash-no-nudges",
	"--disable-infobars",
	'--simulate-outdated-no-au="Tue, 31 Dec 2099 23:59:59 GMT"',
	"--hide-crash-restore-bubble",
	"--suppress-message-center-popups",
	"--disable-domain-reliability",
	"--disable-datasaver-prompt",
	"--disable-speech-synthesis-api",
	"--disable-speech-api",
	"--disable-print-preview",
	"--safebrowsing-disable-auto-update",
	"--disable-external-intent-requests",
	"--disable-desktop-notifications",
	"--noerrdialogs",
	"--silent-debugger-extension-api",
	`--disable-features=${CHROME_DISABLED_COMPONENTS.join(",")}`,
];

// ===== Enum definitions =====
// Enums
export enum ColorScheme {
	LIGHT = "light",
	DARK = "dark",
	NO_PREFERENCE = "no-preference",
	NULL = "null",
}

export enum Contrast {
	NO_PREFERENCE = "no-preference",
	MORE = "more",
	NULL = "null",
}

export enum ReducedMotion {
	REDUCE = "reduce",
	NO_PREFERENCE = "no-preference",
	NULL = "null",
}

export enum ForcedColors {
	ACTIVE = "active",
	NONE = "none",
	NULL = "null",
}

export enum ServiceWorkers {
	ALLOW = "allow",
	BLOCK = "block",
}

export enum RecordHarContent {
	OMIT = "omit",
	EMBED = "embed",
	ATTACH = "attach",
}

export enum RecordHarMode {
	FULL = "full",
	MINIMAL = "minimal",
}

export enum BrowserChannel {
	CHROMIUM = "chromium",
	CHROME = "chrome",
	CHROME_BETA = "chrome-beta",
	CHROME_DEV = "chrome-dev",
	CHROME_CANARY = "chrome-canary",
	MSEDGE = "msedge",
	MSEDGE_BETA = "msedge-beta",
	MSEDGE_DEV = "msedge-dev",
	MSEDGE_CANARY = "msedge-canary",
}

// Using constants from central location in browsernode.config
export const BROWSERNODE_DEFAULT_CHANNEL = BrowserChannel.CHROMIUM;

// Validation functions
export function validateUrl(url: string, schemes: string[] = []): string {
	/**
	 * Validate URL format and optionally check for specific schemes.
	 */
	try {
		const parsed = new URL(url);
		if (schemes.length > 0 && !schemes.includes(parsed.protocol.slice(0, -1))) {
			throw new Error(
				`URL has invalid scheme: ${url} (expected one of ${schemes.join(", ")})`,
			);
		}
		return url;
	} catch (error) {
		throw new Error(`Invalid URL format: ${url}`);
	}
}

export function validateFloatRange(
	value: number,
	minValue: number,
	maxValue: number,
): number {
	/**
	 * Validate a number is within a specified range.
	 */
	if (value < minValue || value > maxValue) {
		throw new Error(`Value ${value} outside of range ${minValue}-${maxValue}`);
	}
	return value;
}

export function validateCliArg(arg: string): string {
	/**
	 * Validate that arg is a valid CLI argument.
	 */
	if (!arg.startsWith("--")) {
		throw new Error(
			`Invalid CLI argument: ${arg} (should start with --, e.g. --some-key="some value here")`,
		);
	}
	return arg;
}

// Display detection functions
export function getDisplaySize(): ViewportSize | null {
	// This would need platform-specific implementation
	// For now, return null as we can't detect display size in Node.js without additional packages
	return null;
}

export function getWindowAdjustments(): [number, number] {
	/**
	 * Returns recommended x, y offsets for window positioning
	 *
	 */
	const platform = process.platform;
	if (platform === "darwin") {
		return [-4, 24]; // macOS,macOS has a small title bar, no border
	} else if (platform === "win32") {
		return [-8, 0]; // Windows,Windows has a border on the left
	} else {
		return [0, 0]; // Linux
	}
}
// ===== Zod schemas for validation =====
const UrlSchema = z.string().refine(validateUrl, "Invalid URL format");
const NonNegativeFloatSchema = z.number().min(0);
const CliArgSchema = z.string().refine(validateCliArg, "Invalid CLI argument");

// Type definitions
export type UrlString = z.infer<typeof UrlSchema>;
export type NonNegativeFloat = z.infer<typeof NonNegativeFloatSchema>;
export type CliArgString = z.infer<typeof CliArgSchema>;

// ===== Interface definitions =====

export interface BrowserContextArgs {
	/**
	 * Base model for common browser context parameters used by
	 * both BrowserType.newContext() and BrowserType.launchPersistentContext().
	 *
	 * https://playwright.dev/python/docs/api/class-browser#browser-new-context
	 */
	// Browser context parameters
	acceptDownloads?: boolean;
	offline?: boolean;
	strictSelectors?: boolean;

	// Security options
	proxy?: ProxySettings;
	permissions?: string[];
	bypassCSP?: boolean;
	clientCertificates?: ClientCertificate[];
	extraHTTPHeaders?: Record<string, string>;
	httpCredentials?: HTTPCredentials;
	ignoreHTTPSErrors?: boolean;
	javaScriptEnabled?: boolean;
	baseURL?: string;
	serviceWorkers?: ServiceWorkers;

	// Viewport options
	userAgent?: string;
	screen?: ViewportSize;
	viewport?: ViewportSize;
	noViewport?: boolean;
	deviceScaleFactor?: number;
	isMobile?: boolean;
	hasTouch?: boolean;
	locale?: string;
	geolocation?: Geolocation;
	timezoneId?: string;
	colorScheme?: ColorScheme;
	contrast?: Contrast;
	reducedMotion?: ReducedMotion;
	forcedColors?: ForcedColors;

	// Recording options
	recordHarContent?: RecordHarContent;
	recordHarMode?: RecordHarMode;
	recordHarOmitContent?: boolean;
	recordHarPath?: string;
	recordHarUrlFilter?: string | RegExp;
	recordVideoDir?: string;
	recordVideoSize?: ViewportSize;
}

export interface BrowserConnectArgs {
	/**
	 * Base model for common browser connect parameters used by
	 * both connectOverCdp() and connectOverWs().
	 *
	 * https://playwright.dev/docs/api/class-browsertype#browser-type-connect
	 * https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
	 */
	headers?: Record<string, string>;
	slowMo?: number;
	timeout?: number;
}

export interface BrowserLaunchArgs {
	/**
	 * Base model for common browser launch parameters used by
	 * both launch() and launchPersistentContext().
	 *
	 * https://playwright.dev/docs/api/class-browsertype#browser-type-launch
	 */

	env?: Record<string, string | number | boolean>;
	executablePath?: string;
	headless?: boolean;
	args?: string[];
	ignoreDefaultArgs?: string[] | boolean;
	// https://playwright.dev/docs/browsers#chromium-headless-shell
	channel?: BrowserChannel;
	chromiumSandbox?: boolean;
	devtools?: boolean;
	slowMo?: number;
	timeout?: number;
	proxy?: ProxySettings;
	downloadsPath?: string;
	tracesDir?: string;
	handleSIGHUP?: boolean;
	handleSIGINT?: boolean;
	handleSIGTERM?: boolean;
}

export interface BrowserNewContextArgs extends BrowserContextArgs {
	/**
	 * Pydantic model for new_context() arguments.
	 * Extends BaseContextParams with storage_state parameter.
	 *
	 * https://playwright.dev/docs/api/class-browser#browser-new-context
	 */
	// TODO: use StorageState type instead of string | object
	storageState?: string | object;
}

export interface BrowserLaunchPersistentContextArgs
	extends BrowserLaunchArgs,
		BrowserContextArgs {
	/**
	 * Model for launchPersistentContext() arguments.
	 * Combines browser launch parameters and context parameters,
	 * plus adds the user_data_dir parameter.
	 * https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context
	 */
	// Required parameter specific to launch_persistent_context, but can be None to use incognito temp dir
	userDataDir?: string;
}

export interface BrowserProfileOptions
	extends BrowserLaunchPersistentContextArgs,
		BrowserConnectArgs {
	/**
	 * A BrowserProfile is a static template collection of kwargs that can be passed to:
	 * - BrowserType.launch(BrowserLaunchArgs)
	 * - BrowserType.connect(BrowserConnectArgs)
	 * - BrowserType.connectOverCdp(BrowserConnectArgs)
	 * - BrowserType.launchPersistentContext(BrowserLaunchPersistentContextArgs)
	 * - BrowserContext.newContext(BrowserNewContextArgs)
	 * - BrowserSession(BrowserProfile)
	 */
	// Unique identifier
	id?: string;

	// Custom options
	stealth?: boolean;
	disableSecurity?: boolean;
	deterministicRendering?: boolean;
	allowedDomains?: string[];
	keepAlive?: boolean;
	windowSize?: ViewportSize;
	windowPosition?: ViewportSize;

	// Page load/wait timings
	defaultNavigationTimeout?: number;
	defaultTimeout?: number;
	minimumWaitPageLoadTime?: number;
	waitForNetworkIdlePageLoadTime?: number;
	maximumWaitPageLoadTime?: number;
	waitBetweenActions?: number;

	// UI/viewport/DOM
	includeDynamicAttributes?: boolean;
	highlightElements?: boolean;
	viewportExpansion?: number;

	profileDirectory?: string;
	cookiesFile?: string;

	// Storage state (for BrowserContext.new_context)
	storageState?: string | object;
}

export class BrowserProfile implements BrowserProfileOptions {
	// Core identification
	public readonly id: string;
	public profileDirectory: string = "Default";

	// Browser launch configuration
	public env?: Record<string, string | number | boolean>;
	public executablePath?: string;
	public headless?: boolean;
	public args: string[] = [];
	public ignoreDefaultArgs: string[] | boolean = [
		"--enable-automation",
		"--disable-extensions",
		"--hide-scrollbars",
		"--disable-features=AcceptCHFrame,AutoExpandDetailsElement,AvoidUnnecessaryBeforeUnloadCheckSync,CertificateTransparencyComponentUpdater,DeferRendererTasksAfterInput,DestroyProfileOnBrowserClose,DialMediaRouteProvider,ExtensionManifestV2Disabled,GlobalMediaControls,HttpsUpgrades,ImprovedCookieControls,LazyFrameLoading,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate",
	];
	public channel?: BrowserChannel;
	public chromiumSandbox: boolean = true;
	public devtools: boolean = false;
	public slowMo: number = 0;
	public timeout: number = 30000;
	public proxy?: ProxySettings;
	public downloadsPath?: string;
	public tracesDir?: string;
	public handleSIGHUP: boolean = true;
	public handleSIGINT: boolean = false;
	public handleSIGTERM: boolean = false;

	// Context configuration
	public acceptDownloads: boolean = true;
	public offline: boolean = false;
	public strictSelectors: boolean = false;
	public permissions: string[] = [
		"clipboard-read",
		"clipboard-write",
		"notifications",
	];
	public bypassCSP: boolean = false;
	public clientCertificates: ClientCertificate[] = [];
	public extraHTTPHeaders: Record<string, string> = {};
	public httpCredentials?: HTTPCredentials;
	public ignoreHTTPSErrors: boolean = false;
	public javaScriptEnabled: boolean = true;
	public baseURL?: string;
	public serviceWorkers: ServiceWorkers = ServiceWorkers.ALLOW;

	// Viewport and display
	public userAgent?: string;
	public screen?: ViewportSize;
	public viewport?: ViewportSize;
	public noViewport?: boolean;
	public deviceScaleFactor?: number;
	public isMobile: boolean = false;
	public hasTouch: boolean = false;
	public locale?: string;
	public geolocation?: Geolocation;
	public timezoneId?: string;
	public colorScheme: ColorScheme = ColorScheme.LIGHT;
	public contrast: Contrast = Contrast.NO_PREFERENCE;
	public reducedMotion: ReducedMotion = ReducedMotion.NO_PREFERENCE;
	public forcedColors: ForcedColors = ForcedColors.NONE;

	// Recording options
	public recordHarContent: RecordHarContent = RecordHarContent.EMBED;
	public recordHarMode: RecordHarMode = RecordHarMode.FULL;
	public recordHarOmitContent: boolean = false;
	public recordHarPath?: string;
	public recordHarUrlFilter?: string | RegExp;
	public recordVideoDir?: string;
	public recordVideoSize?: ViewportSize;

	// Storage and persistence
	public userDataDir?: string;
	public storageState?: string | object;

	// Connection options
	public headers?: Record<string, string>;

	// Custom browsernode options
	public stealth: boolean = false;
	public disableSecurity: boolean = false;
	public deterministicRendering: boolean = false;
	public allowedDomains?: string[];
	public keepAlive?: boolean;
	public windowSize?: ViewportSize;
	public windowPosition?: ViewportSize = { width: 0, height: 0 };

	// Timing configuration
	public defaultNavigationTimeout?: number;
	public defaultTimeout?: number;
	public minimumWaitPageLoadTime: number = 0.25;
	public waitForNetworkIdlePageLoadTime: number = 0.5;
	public maximumWaitPageLoadTime: number = 5.0;
	public waitBetweenActions: number = 0.5;

	// UI/DOM options
	public includeDynamicAttributes: boolean = true;
	public highlightElements: boolean = true;
	public viewportExpansion: number = 500;

	// Legacy options
	public cookiesFile?: string;

	constructor(options: BrowserProfileOptions = {}) {
		this.id = options.id || this.generateId();

		// Apply all options
		Object.assign(this, options);

		// Handle deprecated window_width/window_height
		this.copyOldConfigNamesToNew();

		// Validate configuration
		this.validateConfiguration();

		// Detect display configuration
		// this.detectDisplayConfiguration();
	}

	private generateId(): string {
		return `bp_${uuidv4()}`;
	}

	private copyOldConfigNamesToNew(): void {
		// Handle deprecated window_width/window_height properties
		// This matches the Python model validator copy_old_config_names_to_new
		const hasDeprecatedProps =
			(this as any).windowWidth || (this as any).windowHeight;
		if (hasDeprecatedProps) {
			console.warn(
				"⚠️ BrowserProfile(windowWidth=..., windowHeight=...) are deprecated, use BrowserProfile(windowSize={width: 1280, height: 1100}) instead.",
			);
			const windowSize = this.windowSize || { width: 0, height: 0 };
			windowSize.width = windowSize.width || (this as any).windowWidth || 1280;
			windowSize.height =
				windowSize.height || (this as any).windowHeight || 1100;
			this.windowSize = windowSize;
		}
	}

	private validateConfiguration(): void {
		// Validate devtools and headless combination
		if (this.headless && this.devtools) {
			throw new Error(
				"headless=true and devtools=true cannot both be set at the same time",
			);
		}

		// Validate CLI arguments
		this.args = this.args.map((arg) => validateCliArg(arg));

		// Warn about deterministic rendering
		this.warnDeterministicRenderingWeirdness();

		// Warn about storage state conflicts
		this.warnStorageStateUserDataDirConflict();

		// Warn about user data directory version conflicts
		this.warnUserDataDirNonDefaultVersion();
	}

	private warnDeterministicRenderingWeirdness(): void {
		if (this.deterministicRendering) {
			console.warn(
				"⚠️ BrowserProfile(deterministicRendering=true) is NOT RECOMMENDED. It breaks many sites and increases chances of getting blocked by anti-bot systems. " +
					"It hardcodes the JS random seed and forces browsers across Linux/Mac/Windows to use the same font rendering engine so that identical screenshots can be generated.",
			);
		}
	}

	private warnStorageStateUserDataDirConflict(): void {
		const hasStorageState = this.storageState !== undefined;
		const hasUserDataDir = this.userDataDir !== undefined;
		const hasCookiesFile = this.cookiesFile !== undefined;
		const staticSource = hasCookiesFile
			? "cookiesFile"
			: hasStorageState
				? "storageState"
				: null;

		if (staticSource && hasUserDataDir) {
			console.warn(
				`⚠️ BrowserProfile(...) was passed both ${staticSource} AND userDataDir. ${staticSource}=${this.storageState || this.cookiesFile} will forcibly overwrite ` +
					`cookies/localStorage/sessionStorage in userDataDir=${this.userDataDir}. ` +
					`For multiple browsers in parallel, use only storageState with userDataDir=null, ` +
					`or use a separate userDataDir for each browser and set storageState=null.`,
			);
		}
	}

	private warnUserDataDirNonDefaultVersion(): void {
		// TODO: Implement when we have CONFIG constants defined
		// This would check if using default profile dir with non-default channel
		// and warn about potential corruption
	}

	detectDisplayConfiguration(): void {
		/**
		 * Detect the system display size and initialize the display-related config defaults:
		 * screen, windowSize, windowPosition, viewport, noViewport, deviceScaleFactor
		 */
		const displaySize = getDisplaySize();
		const hasScreenAvailable = Boolean(displaySize);

		this.screen = this.screen || displaySize || { width: 1280, height: 1100 };

		// if no headless preference specified, prefer headful if there is a display available
		if (this.headless === undefined) {
			this.headless = !hasScreenAvailable;
		}

		// set up window size and position if headful
		if (this.headless) {
			// headless mode: no window available, use viewport instead to constrain content size
			this.viewport = this.viewport || this.windowSize || this.screen;
			this.windowPosition = undefined; // no windows to position in headless mode
			this.windowSize = undefined;
			this.noViewport = false; // viewport is always enabled in headless mode
		} else {
			// headful mode: use window, disable viewport by default, content fits to size of window
			this.windowSize = this.windowSize || this.screen;
			this.noViewport =
				this.noViewport === null || this.noViewport === undefined
					? true
					: this.noViewport;
			this.viewport = this.noViewport ? undefined : this.viewport;
		}

		// automatically setup viewport if any config requires it
		const useViewport =
			this.headless || this.viewport || this.deviceScaleFactor;
		this.noViewport =
			this.noViewport === null || this.noViewport === undefined
				? !useViewport
				: this.noViewport;
		const actualUseViewport = !this.noViewport;

		if (actualUseViewport) {
			// if we are using viewport, make deviceScaleFactor and screen are set to real values to avoid easy fingerprinting
			this.viewport = this.viewport || this.screen;
			this.deviceScaleFactor = this.deviceScaleFactor || 1.0;
			if (!this.viewport) {
				throw new Error("viewport must be set when using viewport mode");
			}
			if (this.noViewport) {
				throw new Error("noViewport must be false when using viewport mode");
			}
		} else {
			// deviceScaleFactor and screen are not supported in non-viewport mode, the system monitor determines these
			this.viewport = undefined;
			this.deviceScaleFactor = undefined; // only supported in viewport mode
			this.screen = undefined; // only supported in viewport mode
			if (this.viewport) {
				throw new Error(
					"viewport must be undefined when not using viewport mode",
				);
			}
			if (!this.noViewport) {
				throw new Error("noViewport must be true when not using viewport mode");
			}
		}

		// Final validation
		if (this.headless && this.noViewport) {
			throw new Error(
				"headless=true and noViewport=true cannot both be set at the same time",
			);
		}
	}

	public getArgs(): string[] {
		/**
		 * Get the list of all Chrome CLI launch args for this profile
		 * (compiled from defaults, user-provided, and system-specific).
		 */
		let defaultArgs: string[] = [];

		if (Array.isArray(this.ignoreDefaultArgs)) {
			defaultArgs = CHROME_DEFAULT_ARGS.filter(
				(arg) => !(this.ignoreDefaultArgs as string[]).includes(arg),
			);
		} else if (this.ignoreDefaultArgs === true) {
			defaultArgs = [];
		} else if (!this.ignoreDefaultArgs) {
			defaultArgs = [...CHROME_DEFAULT_ARGS];
		}

		// Capture args before conversion for logging
		const preConversionArgs = [
			...defaultArgs,
			...this.args,
			`--profile-directory=${this.profileDirectory}`,
			...(process.env.DOCKER ? CHROME_DOCKER_ARGS : []),
			...(this.headless ? CHROME_HEADLESS_ARGS : []),
			...(this.disableSecurity ? CHROME_DISABLE_SECURITY_ARGS : []),
			...(this.deterministicRendering
				? CHROME_DETERMINISTIC_RENDERING_ARGS
				: []),
			...(this.windowSize
				? [`--window-size=${this.windowSize.width},${this.windowSize.height}`]
				: !this.headless
					? ["--start-maximized"]
					: []),
			...(this.windowPosition
				? [
						`--window-position=${this.windowPosition.width},${this.windowPosition.height}`,
					]
				: []),
		];

		// Convert to dict and back to dedupe and merge duplicate args
		const finalArgsList = this.argsAsList(this.argsAsDict(preConversionArgs));
		return finalArgsList;
	}

	private argsAsDict(args: string[]): Record<string, string> {
		/**
		 * Convert list of CLI args to a dictionary for deduplication and merging.
		 * This matches the Python BrowserLaunchArgs.args_as_dict() method.
		 */
		const argsDict: Record<string, string> = {};
		for (const arg of args) {
			const [key, value = ""] = arg.split("=", 2);
			if (key) {
				argsDict[key.trim().replace(/^--/, "")] = value.trim();
			}
		}
		return argsDict;
	}

	private argsAsList(args: Record<string, string>): string[] {
		/**
		 * Convert dictionary of CLI args back to a list.
		 * This matches the Python BrowserLaunchArgs.args_as_list() method.
		 */
		return Object.entries(args).map(([key, value]) =>
			value
				? `--${key.replace(/^--/, "")}=${value}`
				: `--${key.replace(/^--/, "")}`,
		);
	}

	// Static utility methods matching Python version
	public static argsAsDict(args: string[]): Record<string, string> {
		const argsDict: Record<string, string> = {};
		for (const arg of args) {
			const [key, value = ""] = arg.split("=", 2);
			if (key) {
				argsDict[key.trim().replace(/^--/, "")] = value.trim();
			}
		}
		return argsDict;
	}

	public static argsAsList(args: Record<string, string>): string[] {
		return Object.entries(args).map(([key, value]) =>
			value
				? `--${key.replace(/^--/, "")}=${value}`
				: `--${key.replace(/^--/, "")}`,
		);
	}

	public toString(): string {
		return `BrowserProfile#${this.id.slice(-4)}`;
	}

	public repr(): string {
		const shortDir = this.userDataDir ? this.userDataDir : "<incognito>";
		return `BrowserProfile#${this.id.slice(-4)}(userDataDir=${shortDir}, headless=${this.headless})`;
	}

	public toJSON(): BrowserProfileOptions {
		return {
			id: this.id,
			profileDirectory: this.profileDirectory,
			env: this.env,
			executablePath: this.executablePath,
			headless: this.headless,
			args: this.args,
			ignoreDefaultArgs: this.ignoreDefaultArgs,
			channel: this.channel,
			chromiumSandbox: this.chromiumSandbox,
			devtools: this.devtools,
			slowMo: this.slowMo,
			timeout: this.timeout,
			proxy: this.proxy,
			downloadsPath: this.downloadsPath,
			tracesDir: this.tracesDir,
			handleSIGHUP: this.handleSIGHUP,
			handleSIGINT: this.handleSIGINT,
			handleSIGTERM: this.handleSIGTERM,
			acceptDownloads: this.acceptDownloads,
			offline: this.offline,
			strictSelectors: this.strictSelectors,
			permissions: this.permissions,
			bypassCSP: this.bypassCSP,
			clientCertificates: this.clientCertificates,
			extraHTTPHeaders: this.extraHTTPHeaders,
			httpCredentials: this.httpCredentials,
			ignoreHTTPSErrors: this.ignoreHTTPSErrors,
			javaScriptEnabled: this.javaScriptEnabled,
			baseURL: this.baseURL,
			serviceWorkers: this.serviceWorkers,
			userAgent: this.userAgent,
			screen: this.screen,
			viewport: this.viewport,
			noViewport: this.noViewport,
			deviceScaleFactor: this.deviceScaleFactor,
			isMobile: this.isMobile,
			hasTouch: this.hasTouch,
			locale: this.locale,
			geolocation: this.geolocation,
			timezoneId: this.timezoneId,
			colorScheme: this.colorScheme,
			contrast: this.contrast,
			reducedMotion: this.reducedMotion,
			forcedColors: this.forcedColors,
			recordHarContent: this.recordHarContent,
			recordHarMode: this.recordHarMode,
			recordHarOmitContent: this.recordHarOmitContent,
			recordHarPath: this.recordHarPath,
			recordHarUrlFilter: this.recordHarUrlFilter,
			recordVideoDir: this.recordVideoDir,
			recordVideoSize: this.recordVideoSize,
			userDataDir: this.userDataDir,
			storageState: this.storageState,
			headers: this.headers,
			stealth: this.stealth,
			disableSecurity: this.disableSecurity,
			deterministicRendering: this.deterministicRendering,
			allowedDomains: this.allowedDomains,
			keepAlive: this.keepAlive,
			windowSize: this.windowSize,
			windowPosition: this.windowPosition,
			defaultNavigationTimeout: this.defaultNavigationTimeout,
			defaultTimeout: this.defaultTimeout,
			minimumWaitPageLoadTime: this.minimumWaitPageLoadTime,
			waitForNetworkIdlePageLoadTime: this.waitForNetworkIdlePageLoadTime,
			maximumWaitPageLoadTime: this.maximumWaitPageLoadTime,
			waitBetweenActions: this.waitBetweenActions,
			includeDynamicAttributes: this.includeDynamicAttributes,
			highlightElements: this.highlightElements,
			viewportExpansion: this.viewportExpansion,
			cookiesFile: this.cookiesFile,
		};
	}

	// Helper methods for extracting specific configuration sets
	public getNewContextArgs(): BrowserNewContextArgs {
		return {
			acceptDownloads: this.acceptDownloads,
			offline: this.offline,
			strictSelectors: this.strictSelectors,
			proxy: this.proxy,
			permissions: this.permissions,
			bypassCSP: this.bypassCSP,
			clientCertificates: this.clientCertificates,
			extraHTTPHeaders: this.extraHTTPHeaders,
			httpCredentials: this.httpCredentials,
			ignoreHTTPSErrors: this.ignoreHTTPSErrors,
			javaScriptEnabled: this.javaScriptEnabled,
			baseURL: this.baseURL,
			serviceWorkers: this.serviceWorkers,
			userAgent: this.userAgent,
			screen: this.screen,
			viewport: this.viewport,
			noViewport: this.noViewport,
			deviceScaleFactor: this.deviceScaleFactor,
			isMobile: this.isMobile,
			hasTouch: this.hasTouch,
			locale: this.locale,
			geolocation: this.geolocation,
			timezoneId: this.timezoneId,
			colorScheme: this.colorScheme,
			contrast: this.contrast,
			reducedMotion: this.reducedMotion,
			forcedColors: this.forcedColors,
			recordHarContent: this.recordHarContent,
			recordHarMode: this.recordHarMode,
			recordHarOmitContent: this.recordHarOmitContent,
			recordHarPath: this.recordHarPath,
			recordHarUrlFilter: this.recordHarUrlFilter,
			recordVideoDir: this.recordVideoDir,
			recordVideoSize: this.recordVideoSize,
			storageState: this.storageState,
		};
	}

	public getLaunchArgs(): BrowserLaunchArgs {
		return {
			env: this.env,
			executablePath: this.executablePath,
			headless: this.headless,
			args: this.getArgs(),
			ignoreDefaultArgs: this.ignoreDefaultArgs,
			channel: this.channel,
			chromiumSandbox: this.chromiumSandbox,
			devtools: this.devtools,
			slowMo: this.slowMo,
			timeout: this.timeout,
			proxy: this.proxy,
			downloadsPath: this.downloadsPath,
			tracesDir: this.tracesDir,
			handleSIGHUP: this.handleSIGHUP,
			handleSIGINT: this.handleSIGINT,
			handleSIGTERM: this.handleSIGTERM,
		};
	}

	public getConnectArgs(): BrowserConnectArgs {
		return {
			headers: this.headers,
			slowMo: this.slowMo,
			timeout: this.timeout,
		};
	}

	public getLaunchPersistentContextArgs(): BrowserLaunchPersistentContextArgs {
		return {
			...this.getLaunchArgs(),
			...this.getNewContextArgs(),
			userDataDir: this.userDataDir,
		};
	}

	// Python-style method names for compatibility
	public kwargsForLaunchPersistentContext(): BrowserLaunchPersistentContextArgs {
		return this.getLaunchPersistentContextArgs();
	}

	public kwargsForNewContext(): BrowserNewContextArgs {
		return this.getNewContextArgs();
	}

	public kwargsForConnect(): BrowserConnectArgs {
		return this.getConnectArgs();
	}

	public kwargsForLaunch(): BrowserLaunchArgs {
		return this.getLaunchArgs();
	}
}

// Factory function for creating common browser profiles
export function createBrowserProfile(
	options: BrowserProfileOptions = {},
): BrowserProfile {
	return new BrowserProfile(options);
}

// Common preset profiles
export const STEALTH_PROFILE = createBrowserProfile({
	stealth: true,
	headless: false,
	channel: BrowserChannel.CHROME,
	viewport: undefined,
	noViewport: true,
	// Don't add custom browser headers or userAgent as recommended by Patchright
	userAgent: undefined,
	extraHTTPHeaders: {},
	// Remove automation-related flags
	ignoreDefaultArgs: [
		"--enable-automation",
		"--disable-extensions",
		"--disable-popup-blocking",
		"--disable-component-update",
		"--disable-default-apps",
	],
});

export const HEADLESS_PROFILE = createBrowserProfile({
	headless: true,
	stealth: false,
});

export const DEVELOPMENT_PROFILE = createBrowserProfile({
	headless: false,
	devtools: true,
	slowMo: 100,
	disableSecurity: true,
});
