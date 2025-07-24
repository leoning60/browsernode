import { Mistral } from "@mistralai/mistralai";
import { ActionResult, Agent, Controller } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Check for required environment variables
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

if (!process.env.MISTRAL_API_KEY) {
	throw new Error(
		"MISTRAL_API_KEY is not set. Please add it to your environment variables.",
	);
}

// Initialize controller
const controller = new Controller();

// PDF Extract Parameters schema
const PdfExtractParams = z.object({
	url: z.string().describe("URL to a PDF document"),
});

// Type definitions for Mistral OCR response
interface MistralOcrPage {
	markdown: string;
}

interface MistralOcrResponse {
	pages: MistralOcrPage[];
}

// Extract PDF Text - custom action
controller.action("Extract PDF Text", {
	paramModel: PdfExtractParams,
})(async function extractMistralOcr(params: z.infer<typeof PdfExtractParams>) {
	/**
	 * Process a PDF URL using Mistral OCR API and return the OCR response.
	 *
	 * Args:
	 *     url: URL to a PDF document
	 *
	 * Returns:
	 *     OCR response object from Mistral API
	 */
	const apiKey = process.env.MISTRAL_API_KEY;

	if (!apiKey) {
		return new ActionResult({
			error: "MISTRAL_API_KEY is not set",
			includeInMemory: true,
		});
	}

	try {
		const client = new Mistral({ apiKey });

		const response = await client.ocr.process({
			model: "mistral-ocr-latest",
			document: {
				type: "document_url",
				documentUrl: params.url,
			},
		});

		// Format the response as markdown
		let markdown = "";
		if (response.pages && Array.isArray(response.pages)) {
			markdown = response.pages
				.map(
					(page: MistralOcrPage, index: number) =>
						`### Page ${index + 1}\n${page.markdown || ""}`,
				)
				.join("\n\n");
		} else {
			markdown = "No pages found in the PDF or unexpected response format.";
		}

		return new ActionResult({
			extractedContent: markdown,
			includeInMemory: false, // PDF content can be very large, so we don't include it in memory
			longTermMemory: `Extracted PDF content from ${params.url}`,
		});
	} catch (error) {
		return new ActionResult({
			error: `Failed to extract PDF content: ${error instanceof Error ? error.message : String(error)}`,
			includeInMemory: true,
		});
	}
});

async function main() {
	/**
	 * Example task: Navigate to a PDF URL, extract its contents using the Extract PDF Text action,
	 * and explain its historical significance.
	 */
	const task = `
	Objective: Navigate to the following URL, extract its contents using the "Extract PDF Text" action (not extractStructuredData), and explain its historical significance.

	URL: https://docs.house.gov/meetings/GO/GO00/20220929/115171/HHRG-117-GO00-20220929-SD010.pdf
	
	Important: Use the "Extract PDF Text" action specifically, not the general extractStructuredData action.
	`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o-mini",
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
