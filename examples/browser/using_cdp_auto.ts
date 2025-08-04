/**
 * Auto CDP demonstration - handles both scenarios:
 * 1. Connects to existing Chrome if already running on port 9222,
 *    - on macos, you need to start chrome with the following command:
 *      - /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug-auto"
 *    - On Windows: you need to start chrome with the following command:
 *      - "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-debug-auto"
 *    - On Linux: you need to start chrome with the following command:
 *      - google-chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug-auto"
 * 2. Automatically starts Chrome with CDP if none found
 *
 * This is more user-friendly than the manual CDP version.
 *
 * @dev You need to set the `GOOGLE_API_KEY` environment variable before proceeding.
 */

import * as http from "http";
import { Agent, BrowserProfile, BrowserSession } from "browsernode";
import { ChatGoogle } from "browsernode/llm";

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
	throw new Error("GOOGLE_API_KEY is not set");
}

/**
 * Check if Chrome is already running with CDP enabled on port 9222
 */
async function checkChromeRunning(): Promise<boolean> {
	return new Promise((resolve) => {
		const req = http.get("http://localhost:9222/json/version", (res) => {
			resolve(res.statusCode === 200);
		});

		req.on("error", () => {
			resolve(false);
		});

		req.setTimeout(2000, () => {
			req.destroy();
			resolve(false);
		});
	});
}

async function main() {
	const task = "search for tesla stock price";
	const fullTask = task;

	const model = new ChatGoogle({
		model: "gemini-2.5-flash",
		apiKey: apiKey,
	});

	// Check if Chrome is already running with CDP
	const chromeRunning = await checkChromeRunning();

	let browserSession: BrowserSession;

	if (chromeRunning) {
		console.log("🔗 Found existing Chrome with CDP, connecting...");
		// Connect to existing Chrome
		browserSession = new BrowserSession({
			browserProfile: new BrowserProfile({
				headless: false,
			}),
			cdpUrl: "http://localhost:9222",
		});
	} else {
		console.log("🚀 Starting new Chrome with CDP enabled...");
		// Start new Chrome with CDP enabled
		browserSession = new BrowserSession({
			browserProfile: new BrowserProfile({
				headless: false,
				// Add CDP arguments to auto-start Chrome with debugging
				args: ["--remote-debugging-port=9222"],
				userDataDir: "/tmp/chrome-debug-auto",
			}),
		});
	}

	const agent = new Agent({
		task: fullTask,
		llm: model,
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
