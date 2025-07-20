import { BrowserProfile } from "./profile";
import { BrowserSession } from "./session";

export const Browser = BrowserSession;
export const BrowserConfig = BrowserProfile;
export const BrowserContext = BrowserSession;
export const BrowserContextConfig = BrowserProfile;

// Re-export original classes
export { BrowserProfile, BrowserSession };
