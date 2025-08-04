/**
 * Example of how it supports cross-origin iframes.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import { Agent, Controller } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

// Initialize controller
const controller = new Controller();

async function main() {
	const agent = new Agent({
		task: 'Click "Go cross-site (simple page)" button on https://csreis.github.io/tests/cross-site-iframe.html then tell me the text within',
		// 'Navigate to https://csreis.github.io/tests/cross-site-iframe.html, click the "Go cross-site (simple page)" button once, then extract and return the visible text from the page. If the iframe content does not change after clicking, report what you can see.',
		llm: new ChatOpenAI({
			model: "gpt-4o",
			temperature: 0.0,
			apiKey: process.env.OPENAI_API_KEY,
		}),

		controller: controller,
	});

	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

// Run the main function
main().catch(console.error);
