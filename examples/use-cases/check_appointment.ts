/**
 * Goal: Checks for available visa appointment slots on the Greece MFA website.
 *
 * This example demonstrates how to use browsernode to check visa appointment availability
 * on the Greece MFA website and report back the available dates.
 */

import { Agent, Controller } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Check required environment variables
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

// Initialize controller
const controller = new Controller();

// Define the WebpageInfo schema using Zod
const WebpageInfoSchema = z.object({
	link: z
		.string()
		.default(
			"https://appointment.mfa.gr/en/reservations/aero/ireland-grcon-dub/",
		),
});

type WebpageInfo = z.infer<typeof WebpageInfoSchema>;

// Register custom action
controller.action("Go to the webpage", {
	paramModel: WebpageInfoSchema,
})(async function goToWebpage(webpageInfo: WebpageInfo) {
	/**
	 * Custom action to return the webpage link.
	 * This action provides the URL for the Greece MFA appointment system.
	 */
	return webpageInfo.link;
});

async function main() {
	/**
	 * Main function to execute the agent task.
	 * The agent will check visa appointment availability on the Greece MFA website.
	 */
	const task = `
		Go to the Greece MFA webpage via the link I provided you.
		Check the visa appointment dates. If there is no available date in this month, check the next month.
		If there is no available date in both months, tell me there is no available date.
	`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o-mini",
		apiKey: process.env.OPENAI_API_KEY!,
	});

	// Create and run the agent
	const agent = new Agent({
		task: task,
		llm: llm,
		controller: controller,
		useVision: true,
	});

	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

// Run the main function
main().catch(console.error);
