/**
 * Goal: Automates CAPTCHA solving on a demo website.
 *
 * Simple try of the agent.
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 * NOTE: captchas are hard. For this example it works. But e.g. for iframes it does not.
 * for this example it helps to zoom in.
 */

import { Agent } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

// Check if OPENAI_API_KEY is set
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

async function main() {
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	const agent = new Agent(
		"go to https://captcha.com/demos/features/captcha-demo.aspx and solve the captcha",
		llm,
	);

	const result = await agent.run();
	console.log("🎯 Task completed:", result);

	// Wait for user input before exiting
	console.log("Press Enter to exit...");
	process.stdin.once("data", () => {
		process.exit(0);
	});
}

// Run the main function
main().catch(console.error);
