import { ActionResult, Agent, Controller } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Initialize controller
const controller = new Controller();

// Hover Action parameter model
const HoverActionSchema = z.object({
	index: z.number().optional(),
	xpath: z.string().optional(),
	selector: z.string().optional(),
});

type HoverAction = z.infer<typeof HoverActionSchema>;

// Hover over element - custom action
controller.action("Hover over an element", {
	paramModel: HoverActionSchema,
})(async function hoverElement(
	params: HoverAction,
	browserSession: BrowserSession,
) {
	const { index, xpath, selector } = params;

	let elementHandle: any = null;

	if (xpath) {
		// Use XPath to locate the element
		const page = await browserSession.getCurrentPage();
		elementHandle = await page.locator(`xpath=${xpath}`).first();
		if (!elementHandle) {
			throw new Error(`Failed to locate element with XPath ${xpath}`);
		}
	} else if (selector) {
		// Use CSS selector to locate the element
		const page = await browserSession.getCurrentPage();
		elementHandle = await page.locator(selector).first();
		if (!elementHandle) {
			throw new Error(`Failed to locate element with CSS Selector ${selector}`);
		}
	} else if (index !== undefined) {
		// Use index to locate the element from the selector map
		const selectorMap = await browserSession.getSelectorMap();
		if (!(index in selectorMap)) {
			throw new Error(
				`Element index ${index} does not exist - retry or use alternative actions`,
			);
		}

		const elementNode = selectorMap[index];
		elementHandle = await browserSession.getLocateElement(elementNode);
		if (!elementHandle) {
			throw new Error(`Failed to locate element with index ${index}`);
		}
	} else {
		throw new Error("Either index, xpath, or selector must be provided");
	}

	try {
		await elementHandle.hover();

		const msg =
			index !== undefined
				? `🖱️ Hovered over element at index ${index}`
				: xpath
					? `🖱️ Hovered over element with XPath ${xpath}`
					: `🖱️ Hovered over element with selector ${selector}`;

		return new ActionResult({
			extractedContent: msg,
			includeInMemory: true,
		});
	} catch (error) {
		const errMsg = `❌ Failed to hover over element: ${error instanceof Error ? error.message : String(error)}`;
		throw new Error(errMsg);
	}
});

async function main() {
	/**
	 * Example task: Navigate to a test page and hover over an element
	 */
	const task = `
	Open https://testpages.eviltester.com/styled/csspseudo/css-hover.html and hover the element with the css selector #hoverdivpara, then click on "Can you click me?"
	`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent({
		task: task,
		llm: llm,
		controller: controller,
	});

	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

// Run the main function
main().catch(console.error);
