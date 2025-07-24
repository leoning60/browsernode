import * as fs from "fs";
import * as path from "path";
import { ActionResult, Agent, Controller } from "browsernode";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Create download directory
const downloadPath = path.join(process.cwd(), "downloads");
if (!fs.existsSync(downloadPath)) {
	fs.mkdirSync(downloadPath, { recursive: true });
}

// Initialize controller
const controller = new Controller();

// Save PDF - custom action
controller.action("Save the current page as a PDF file", {
	paramModel: z.object({}), // No parameters needed
})(async function savePdf(params: Record<string, any>, page: Page) {
	// Get current URL and create sanitized filename
	const currentUrl = page.url();
	const shortUrl = currentUrl.replace(/^https?:\/\/(?:www\.)?|\/$/g, "");
	const slug = shortUrl
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
	const sanitizedFilename = `${slug}.pdf`;
	const filePath = path.join(downloadPath, sanitizedFilename);

	// Emulate screen media and save as PDF
	await page.emulateMedia({ media: "screen" });
	await page.pdf({
		path: filePath,
		format: "A4",
		printBackground: false,
	});

	const msg = `Saving page with URL ${currentUrl} as PDF to ${filePath}`;
	return new ActionResult({
		extractedContent: msg,
		includeInMemory: true,
		longTermMemory: `Saved PDF to ${sanitizedFilename}`,
	});
});

async function main() {
	/**
	 * Example task: Navigate to posthog.com and save the page as a PDF
	 */
	const task = `
	Go to https://posthog.com/ and save the page as a PDF file.
	`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4.1-mini",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent(task, llm, {
		controller: controller,
	});

	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

// Run the main function

main().catch(console.error);
