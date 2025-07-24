import { Agent } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

async function main() {
	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent(
		"open 3 tabs with elon musk, trump, and steve jobs, then go back to the first and stop",
		llm,
	);

	console.log("🚀 Starting agent with multi-tab task...");
	try {
		const result = await agent.run(15); // max 15 steps for multi-tab operations
		console.log("✅ Task completed successfully!");
		console.log("📋 Result:", JSON.stringify(result, null, 2));
	} catch (error) {
		console.error("❌ Task failed:", error);
	} finally {
		// Close browser session if it exists
		if (agent.browserSession) {
			await agent.browserSession.close();
			console.log("🔒 Browser session closed");
		}
	}
}

// Run the main function
main().catch(console.error);
