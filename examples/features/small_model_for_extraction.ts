/**
 * Example showing how to use a smaller model for extraction tasks while using a larger model for main actions.
 * This demonstrates cost optimization by using GPT-4o for complex reasoning and GPT-4o-mini for data extraction.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import * as os from "os";
import * as path from "path";
import { Agent } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";

async function main() {
	// Initialize the main model for complex reasoning and actions
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
	});

	// Initialize a smaller, cost-effective model for extraction tasks
	const smallLlm = new ChatOpenAI({
		model: "gpt-4o-mini",
		temperature: 0.0,
	});

	// Define the task
	const task =
		"Find the founders of scale.ai in ycombinator, extract all links and open the links one by one";

	// Create browser session
	const browserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			userDataDir: path.join(
				os.homedir(),
				".config",
				"browsernode",
				"profiles",
				"extraction-example",
			),
		}),
	});

	// Create agent with both models
	const agent = new Agent({
		task: task,
		llm: llm,
		browserSession: browserSession,
		// Use the smaller model for extraction tasks to optimize costs
		pageExtractionLLM: smallLlm,
	});

	try {
		// Start the browser session
		await browserSession.start();

		console.log("🚀 Starting agent with optimized model usage...");
		console.log("📊 Main model: gpt-4o (for complex reasoning)");
		console.log("🔍 Extraction model: gpt-4o-mini (for data extraction)");

		// Run the agent
		await agent.run();

		console.log("✅ Agent execution completed successfully");
	} catch (error) {
		console.error("❌ Error running agent:", error);
	} finally {
		// Clean up browser session
		await browserSession.close();
		console.log("🔒 Browser session closed");

		if (browserSession) {
			await browserSession.kill();
			console.log("🔒 Browser session killed");
		}
	}
}

// Run the main function
main().catch(console.error);
