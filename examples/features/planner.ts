/**
 * Show how to use an agent with a separate planner LLM for task planning.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import { Agent } from "browsernode";
import { BrowserProfile } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";

async function main() {
	// Create LLM instances
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
	});

	const plannerLLM = new ChatOpenAI({
		model: "gpt-4o-mini", // Using gpt-4o-mini as equivalent to o3-mini
	});

	// Define your task
	const task =
		"Go to https://search.brave.com and search for tesla stock price";

	// Create agent with planner configuration
	const agent = new Agent({
		task: task,
		llm: llm,
		plannerLLM: plannerLLM,
		useVisionForPlanner: false,
		plannerInterval: 1,
		browserProfile: new BrowserProfile({
			headless: false,
		}),
	});

	try {
		// Run the agent
		await agent.run();
	} catch (error) {
		console.error("Error running agent:", error);
	}
}

// Run the main function
main().catch(console.error);
