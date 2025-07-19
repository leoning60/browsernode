/**
 * Manual CDP demonstration - connects to a manually started Chrome instance.
 *
 * This example demonstrates connecting to an existing Chrome browser that you start manually.
 * This is useful when you want to:
 * - Debug with an existing browser session
 * - Use a specific Chrome profile or configuration
 * - Have full control over the browser startup process
 *
 * For automatic CDP handling, see: examples/browser/using_cdp_auto.ts
 *
 * To test this locally, follow these steps:
 * 1. Close any existing Chrome instances
 * 2. Start Chrome with CDP enabled (requires a custom user data directory):
 *    - On Windows: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-debug"`
 *    - On macOS: `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug"`
 *    - On Linux: `google-chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug"`
 * 3. Verify CDP is running by visiting `http://localhost:9222/json/version` in another browser
 * 4. Run this example with: `npx tsx examples/browser/using_cdp.ts`
 *
 * @dev You need to set the `GOOGLE_API_KEY` environment variable before proceeding.
 */

import { Agent, BrowserProfile, BrowserSession } from "browsernode";
import { ChatGoogle } from "browsernode/llm";
import { config } from "dotenv";

config();

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
	throw new Error("GOOGLE_API_KEY is not set");
}

// Browser session configuration with CDP
const browserSession = new BrowserSession({
	browserProfile: new BrowserProfile({
		headless: false,
	}),
	cdpUrl: "http://localhost:9222",
});

async function main() {
	const task =
		"In docs.google.com write my Papa a quick thank you for everything letter \n - Magnus";
	const fullTask = task + " and save the document as pdf";

	const model = new ChatGoogle({
		model: "gemini-2.5-flash",
		apiKey: apiKey,
	});

	const agent = new Agent(fullTask, model, {
		browserSession: browserSession,
	});

	await agent.run();
	await browserSession.close();

	console.log("Press Enter to close...");
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("data", () => process.exit(0));
}

main().catch(console.error);
