/**
 * Example demonstrating multiple agents using the same browser session.
 *
 * This example shows how to:
 * 1. Create a single browser session with keepAlive enabled
 * 2. Run multiple agents concurrently with the same browser session
 * 3. Have agents work on different tasks but share the same browser
 *
 * Run this example with: `npx tsx examples/browser/multiple_agents_same_browser.ts`
 *
 * @dev You need to set the `OPENAI_API_KEY` environment variable before proceeding.
 */

import { Agent, BrowserProfile, BrowserSession } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { config } from "dotenv";

config();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
	throw new Error("OPENAI_API_KEY is not set");
}

async function main(): Promise<void> {
	// Create a browser session that will be shared between agents
	const browserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			keepAlive: true,
			userDataDir: undefined,
			headless: false,
		}),
	});

	// Start the browser session
	await browserSession.start();

	// Create the LLM instance that will be shared between agents
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		apiKey: apiKey,
	});

	// Define tasks for each agent
	const task1 = "find todays weather on San Francisco and extract it as json";
	const task2 = "find todays weather in Zurich and extract it as json";

	// Create two agents that will share the same browser session
	const agent1 = new Agent(task1, llm, {
		browserSession: browserSession,
	});

	const agent2 = new Agent(task2, llm, {
		browserSession: browserSession,
	});

	// Run both agents concurrently
	console.log("🚀 Starting both agents concurrently...");
	console.log(`Agent 1 task: ${task1}`);
	console.log(`Agent 2 task: ${task2}`);

	try {
		// Use Promise.all to run both agents concurrently
		const [result1, result2] = await Promise.all([agent1.run(), agent2.run()]);

		console.log("✅ Both agents completed successfully!");
		console.log("Agent 1 result:", result1.finalResult());
		console.log("Agent 2 result:", result2.finalResult());
	} catch (error) {
		console.error("❌ Error running agents:", error);
	} finally {
		// Close the browser session
		await browserSession.close();
		console.log("🔒 Browser session closed");
	}
}

// Run the main function
main().catch(console.error);
