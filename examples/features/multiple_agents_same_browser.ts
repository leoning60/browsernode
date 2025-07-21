import { Agent } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";
import { config } from "dotenv";

// Load environment variables
config();

async function main() {
	// Create a shared browser session
	const browserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			keepAlive: true,
			userDataDir: undefined,
			headless: false,
		}),
	});

	// Start the browser session
	await browserSession.start();

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Define tasks for the agents
	const task1 = "find todays weather on San Francisco and extract it as json";
	const task2 = "find todays weather in Zurich and extract it as json";

	// Create agents with the same browser session
	const agent1 = new Agent(task1, llm, {
		browserSession: browserSession,
	});

	const agent2 = new Agent(task2, llm, {
		browserSession: browserSession,
	});

	console.log("🚀 Starting multiple agents with shared browser session...");

	try {
		// Run both agents concurrently
		const [result1, result2] = await Promise.all([
			agent1.run(15), // max 15 steps for each agent
			agent2.run(15),
		]);

		console.log("✅ Both tasks completed successfully!");
		console.log("📋 Agent 1 Result:", JSON.stringify(result1, null, 2));
		console.log("📋 Agent 2 Result:", JSON.stringify(result2, null, 2));
	} catch (error) {
		console.error("❌ Task failed:", error);
	} finally {
		// Close browser session
		await browserSession.close();
		console.log("🔒 Browser session closed");
		// Close the browser
		if (agent1.browserSession) {
			await agent1.browserSession.kill();
			console.log("🔒 Browser killed");
		}
	}
}

// Run the main function
main().catch(console.error);
