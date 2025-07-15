import { BrowserProfile } from "./profile";
import { BrowserSession } from "./session";

// Aliases equivalent to Python variable assignments
export const Browser = BrowserSession;
export const BrowserConfig = BrowserProfile;
export const BrowserContext = BrowserSession;
export const BrowserContextConfig = BrowserProfile;

// Re-export original classes
export { BrowserProfile, BrowserSession };
