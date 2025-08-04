import { ActionResult, Agent, Controller } from "browsernode";
import { BrowserProfile } from "browsernode/browser";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import clipboard from "clipboardy";
import { z } from "zod";

// Initialize controller
const controller = new Controller();

// Copy text to clipboard - custom action
controller.action("Copy text to clipboard", {
	paramModel: z.object({
		text: z.string().describe("The text to copy to clipboard"),
	}),
})(async function copyToClipboard(params: { text: string }, page: Page) {
	try {
		// Use clipboardy to copy text
		await clipboard.write(params.text);

		return new ActionResult({
			extractedContent: `Copied "${params.text}" to clipboard`,
			includeInMemory: true,
			longTermMemory: `Copied text to clipboard: ${params.text}`,
		});
	} catch (error) {
		return new ActionResult({
			extractedContent: `Failed to copy text to clipboard: ${error}`,
			includeInMemory: true,
		});
	}
});

// Paste text from clipboard - custom action
controller.action("Paste text from clipboard", {
	paramModel: z.object({}), // No parameters needed
})(async function pasteFromClipboard(params: Record<string, any>, page: Page) {
	try {
		// Get text from clipboard using clipboardy
		const clipboardText = await clipboard.read();

		// Type the text in the browser
		await page.keyboard.type(clipboardText);

		return new ActionResult({
			extractedContent: `Pasted "${clipboardText}" from clipboard`,
			includeInMemory: true,
			longTermMemory: `Pasted text from clipboard: ${clipboardText}`,
		});
	} catch (error) {
		return new ActionResult({
			extractedContent: `Failed to paste from clipboard: ${error}`,
			includeInMemory: true,
		});
	}
});

async function main() {
	/**
	 * Example task: Copy text to clipboard, navigate to Google, and paste the text
	 */
	const task = `
	Copy the text "Hello, world!" to the clipboard, then go to google.com and paste the text in the search box.
	`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4.1-mini",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create browser profile with headless disabled to see the browser
	const browserProfile = new BrowserProfile({
		headless: false,
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
