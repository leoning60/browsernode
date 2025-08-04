/**
 * Show how to save execution traces during agent runs for debugging and analysis.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import * as os from "os";
import * as path from "path";
import { Agent } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";

async function main() {
	// Create LLM instance
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
	});

	// Create browser session with trace saving enabled
	const browserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			tracesDir: "./tmp/traces/",
			userDataDir: path.join(
				os.homedir(),
				".config",
				"browsernode",
				"profiles",
				"default",
			),
		}),
	});

	try {
		// Start the browser session
		await browserSession.start();

		// Create agent
		const agent = new Agent({
			task: "Go to hackernews, then go to apple.com and return all titles of open tabs",
			llm: llm,
			browserSession: browserSession,
		});

		// Run the agent - traces will be automatically saved to ./tmp/traces/
		await agent.run();

		console.log("✅ Agent execution completed. Traces saved to ./tmp/traces/");
	} catch (error) {
		console.error("Error running agent:", error);
	} finally {
		// Close the browser session (equivalent to exiting async with context)
		await browserSession.close();
		console.log("🔒 Browser session closed");
	}
}

// Run the main function
main().catch(console.error);
