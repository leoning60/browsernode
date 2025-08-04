/**
 * Goal: Navigate from Wikipedia's Banana page to Quantum mechanics page as fast as possible.
 *
 * This example demonstrates how to use browsernode to navigate through Wikipedia
 * by clicking on links to go from the Banana page to the Quantum mechanics page.
 */

import { Agent, BrowserProfile, BrowserSession } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

// Check required environment variables
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

async function main() {
	/**
	 * Main function to execute the agent task.
	 * The agent will navigate from Wikipedia's Banana page to Quantum mechanics page
	 * by clicking on relevant links as fast as possible.
	 */

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
	});

	// Define the task
	const task =
		"go to https://en.wikipedia.org/wiki/Banana and click on buttons on the wikipedia page to go as fast as possible from banana to Quantum mechanics";

	// Create browser session with custom profile
	const browserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			viewportExpansion: -1,
			highlightElements: false,
			userDataDir: "~/.config/browsernode/profiles/default",
		}),
	});

	// Create and run the agent
	const agent = new Agent({
		task: task,
		llm: llm,
		browserSession: browserSession,
		useVision: false,
	});

	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

// Run the main function
main().catch(console.error);
