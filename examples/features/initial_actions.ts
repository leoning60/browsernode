import { Agent } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { config } from "dotenv";

// Load environment variables
config();

async function main() {
	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Define initial actions
	const initialActions = [
		{ goToUrl: { url: "https://www.google.com", newTab: true } },
		{
			goToUrl: {
				url: "https://en.wikipedia.org/wiki/Randomness",
				newTab: true,
			},
		},
		{ scroll: { down: true } }, // browsernode scrolls by page, not pixel amount
	] as Array<Record<string, Record<string, any>>>;

	// Create and run the agent
	const agent = new Agent("What theories are displayed on the page?", llm, {
		initialActions: initialActions,
	});

	console.log("🚀 Starting agent with initial actions...");
	try {
		const result = await agent.run(10); // max 10 steps
		console.log("✅ Task completed successfully!");
		console.log("📋 Result:", result);
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
