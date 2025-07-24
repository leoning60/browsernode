/**
 * Show how to restrict an agent to only visit allowed domains.
 * This example is expected to fail.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { Agent } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";

async function waitForInput(message: string): Promise<void> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(message, () => {
			rl.close();
			resolve();
		});
	});
}

async function main() {
	// Create LLM instance
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
	});

	// Define the task
	const task =
		"go to google.com and search for openai.com and click on the first link then extract content and scroll down - what's there?";

	// Define allowed domains
	const allowedDomains = ["google.com", "www.google.com"];

	// Create browser profile with domain restrictions
	const browserProfile = new BrowserProfile({
		executablePath:
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		allowedDomains: allowedDomains,
		userDataDir: path.join(
			os.homedir(),
			".config",
			"browsernode",
			"profiles",
			"default",
		),
	});

	// Create browser session
	const browserSession = new BrowserSession({
		browserProfile: browserProfile,
	});

	// Create agent with browser session
	const agent = new Agent(task, llm, {
		browserSession: browserSession,
	});

	try {
		// Start the browser session
		await browserSession.start();

		// Run the agent with max steps limit
		await agent.run(25);

		// Wait for user input before closing
		await waitForInput("Press Enter to close the browser...");
	} catch (error) {
		console.error("Error running agent:", error);
	} finally {
		// Close the browser session
		await browserSession.close();
		console.log("🔒 Browser session closed");
	}
}

// Run the main function
main().catch(console.error);
