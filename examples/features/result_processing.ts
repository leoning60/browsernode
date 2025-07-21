/**
 * Show how to process and analyze agent results after completion.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import * as os from "os";
import * as path from "path";
import { Agent } from "browsernode";
import { AgentHistoryList } from "browsernode/agent/views";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";
import { config } from "dotenv";

// Load environment variables
config();

async function main() {
	// Create LLM instance
	const llm = new ChatOpenAI({
		model: "gpt-4o",
	});

	// Create browser session with context manager pattern
	const browserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			headless: false,
			tracesDir: "./tmp/result_processing",
			windowSize: { width: 1280, height: 1000 },
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
		const agent = new Agent(
			"go to google.com and type 'OpenAI' click search and give me the first url",
			llm,
			{
				browserSession: browserSession,
			},
		);

		// Run the agent and get history
		const history: AgentHistoryList = await agent.run(3);

		// Process and display results
		console.log("Final Result:");
		console.log(JSON.stringify(history.finalResult(), null, 4));

		console.log("\nErrors:");
		console.log(JSON.stringify(history.errors(), null, 4));

		// e.g. xPaths the model clicked on
		console.log("\nModel Outputs:");
		console.log(JSON.stringify(history.modelActions(), null, 4));

		console.log("\nThoughts:");
		console.log(JSON.stringify(history.modelThoughts(), null, 4));
	} catch (error) {
		console.error("Error running agent:", error);
	} finally {
		// Close the browser session
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
