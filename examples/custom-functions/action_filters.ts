import { ActionResult, Agent, Controller } from "browsernode";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

/**
 * Action filters (domains and pageFilter) let you limit actions available to the Agent on a step-by-step/page-by-page basis.
 *
 * controller.action(description, { paramModel, domains?, pageFilter? })
 *
 * This helps prevent the LLM from deciding to use an action that is not compatible with the current page.
 * It helps limit decision fatigue by scoping actions only to pages where they make sense.
 * It also helps prevent mis-triggering stateful actions or actions that could break other programs or leak secrets.
 *
 * For example:
 *   - only run on certain domains: domains: ['example.com', '*.example.com', 'example.co.*'] (supports globs, but no regex)
 *   - only fill in a password on a specific login page url
 *   - only run if this action has not run before on this page (e.g. by looking up the url in a file on disk)
 *
 * During each step, the agent recalculates the actions available specifically for that page, and informs the LLM.
 */

// Initialize controller
const controller = new Controller();

// Action will only be available to Agent on Google domains because of the domain filter
controller.action("Trigger disco mode", {
	paramModel: z.object({}),
	domains: ["google.com", "*.google.com"], // domains filter
})(async function discoMode(params: Record<string, any>, page: Page) {
	await (page as any).evaluate(() => {
		// Define the wiggle animation
		if (document.styleSheets[0]) {
			document.styleSheets[0].insertRule(
				"@keyframes wiggle { 0% { transform: rotate(0deg); } 50% { transform: rotate(10deg); } 100% { transform: rotate(0deg); } }",
			);
		}

		document.querySelectorAll("*").forEach((element) => {
			(element as HTMLElement).style.animation = "wiggle 0.5s infinite";
		});
	});

	return new ActionResult({
		extractedContent: "Disco mode activated! 🕺💃",
		includeInMemory: true,
		longTermMemory: "Activated disco mode on the page",
	});
});

// You can create a custom page filter function that determines if the action should be available for a given page
function isLoginPage(page: Page): boolean {
	const url = page.url().toLowerCase();
	return url.includes("login") || url.includes("signin");
}

// Then use it in the action decorator to limit the action to only be available on pages where the filter returns True
controller.action("Use the force, luke", {
	paramModel: z.object({}),
	pageFilter: isLoginPage, // page filter function
})(async function useTheForce(params: Record<string, any>, page: Page) {
	// This will only ever run on pages that matched the filter
	if (!isLoginPage(page)) {
		throw new Error("This action should only run on login pages");
	}

	await (page as any).evaluate(() => {
		if (document.querySelector("body")) {
			document.querySelector("body")!.innerHTML =
				"These are not the droids you are looking for";
		}
	});

	return new ActionResult({
		extractedContent: "Used the force! 🌟",
		includeInMemory: true,
		longTermMemory: "Used the force on login page",
	});
});

async function main() {
	/**
	 * Main function to run the example
	 *
	 * disco mode will not be triggered on apple.com because the LLM won't be able to see that action available,
	 * it should work on Google.com though.
	 */

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create the agent
	const agent = new Agent({
		task: `Go to apple.com and trigger disco mode (if you don't know how to do that, then just move on).
		Then go to google.com and trigger disco mode.
		After that, go to the Google login page and Use the force, luke.`,
		llm: llm,
		controller: controller,
	});

	// Run the agent
	const result = await agent.run(10);
	console.log(`🎯 Task completed: ${result}`);
}

// Run the main function
main().catch(console.error);
