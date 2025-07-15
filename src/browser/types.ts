// Centralized imports for browser typing
import type {
	Browser as PatchrightBrowser,
	BrowserContext as PatchrightBrowserContext,
	BrowserType as PatchrightBrowserType,
	chromium as PatchrightChromium,
	ElementHandle as PatchrightElementHandle,
	FrameLocator as PatchrightFrameLocator,
	Page as PatchrightPage,
} from "patchright";

import type {
	Browser as PlaywrightBrowser,
	BrowserContext as PlaywrightBrowserContext,
	BrowserType as PlaywrightBrowserType,
	chromium as PlaywrightChromium,
	ElementHandle as PlaywrightElementHandle,
	FrameLocator as PlaywrightFrameLocator,
	Page as PlaywrightPage,
} from "playwright";
import { errors as playwrightErrors } from "playwright";

// Import and export API structures from playwright
import type {
	BrowserContextOptions, //	ClientCertificate,ProxySettings,StorageState,
	Geolocation,
	HTTPCredentials,
	ViewportSize,
} from "playwright";

// Export the types from playwright
type ClientCertificate = BrowserContextOptions["clientCertificates"];
type ProxySettings = BrowserContextOptions["proxy"];
type StorageState = BrowserContextOptions["storageState"];

export type {
	BrowserContextOptions,
	ClientCertificate,
	ProxySettings,
	StorageState,
	Geolocation,
	HTTPCredentials,
	ViewportSize,
};

// Define union types for Patchright and Playwright
export type Browser = PatchrightBrowser | PlaywrightBrowser;
export type BrowserContext =
	| PatchrightBrowserContext
	| PlaywrightBrowserContext;
export type Page = PatchrightPage | PlaywrightPage;
export type ElementHandle = PatchrightElementHandle | PlaywrightElementHandle;
export type FrameLocator = PatchrightFrameLocator | PlaywrightFrameLocator;

// Export browser launch functions
export type PlaywrightChromiumType = typeof PlaywrightChromium;
export type PatchrightChromiumType = typeof PatchrightChromium;

export type PlaywrightOrPatchrightChromium =
	| PlaywrightChromiumType
	| PatchrightChromiumType;

// export type PlaywrightBrowserType = PlaywrightBrowserType;
// export type PatchrightBrowserType = PatchrightBrowserType;

// export type PlaywrightOrPatchrightBrowserType =
// 	| PlaywrightBrowserType
// 	| PatchrightBrowserType;
