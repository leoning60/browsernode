import * as readline from "readline";
import { Agent } from "browsernode";
import { BrowserSession } from "browsernode/browser";
import { ChatGoogle } from "browsernode/llm";
import { config } from "dotenv";
import { chromium } from "playwright";

// Load environment variables
config();

async function main() {
	const apiKey = process.env.GOOGLE_API_KEY;

	if (!apiKey) {
		throw new Error("GOOGLE_API_KEY is not set");
	}

	const llm = new ChatGoogle({
		model: "gemini-2.0-flash",
		apiKey: apiKey,
	});

	// Launch browser using Playwright
	const browser = await chromium.launch({
		headless: false,
	});

	const context = await browser.newContext({
		viewport: { width: 1502, height: 853 },
		ignoreHTTPSErrors: true,
	});

	// Create browser session with the context
	const browserSession = new BrowserSession({
		browserContext: context,
	});

	// Create agent with the browser session
	const agent = new Agent("Go to https://tesla.com/", llm, {
		browserSession: browserSession,
	});

	try {
		// First task
		const result1 = await agent.run();
		console.log(
			`First task was ${result1.isSuccessful() ? "successful" : "not successful"}`,
		);

		if (!result1.isSuccessful()) {
			throw new Error("Failed to navigate to the initial page.");
		}

		// Add second task
		agent.addNewTask("Navigate to the documentation page");

		const result2 = await agent.run();
		console.log(
			`Second task was ${result2.isSuccessful() ? "successful" : "not successful"}`,
		);

		if (!result2.isSuccessful()) {
			throw new Error("Failed to navigate to the documentation page.");
		}

		// Interactive loop for user input
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		while (true) {
			const nextTask = await new Promise<string>((resolve) => {
				rl.question("Write your next task or leave empty to exit\n> ", resolve);
			});

			if (!nextTask.trim()) {
				console.log("Exiting...");
				break;
			}

			agent.addNewTask(nextTask);
			const result = await agent.run();

			console.log(
				`Task '${nextTask}' was ${result.isSuccessful() ? "successful" : "not successful"}`,
			);

			if (!result.isSuccessful()) {
				console.log("Failed to complete the task. Please try again.");
				continue;
			}
		}

		rl.close();
	} finally {
		await context.close();
		await browser.close();
		console.log("🔒 Browser closed");
		// Close the browser
		if (agent.browserSession) {
			await agent.browserSession.kill();
			console.log("🔒 Browser killed");
		}
	}
}

// Run the main function
main().catch(console.error);
