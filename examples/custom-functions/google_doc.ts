/**
 * Google Docs Letter Writing Example with PDF Export
 *
 * This example demonstrates how to:
 * 1. Open Google Docs in a real browser
 * 2. Write a personalized letter
 * 3. Save the document as a PDF
 * 4. Use custom actions for PDF saving
 *
 * Required Environment Variables:
 * - OPENAI_API_KEY: Your OpenAI API key
 *
 * Installation:
 * 1. npm install
 * 2. Copy .env.example to .env and add your API key
 * 3. Close any existing Chrome instances
 * 4. npx tsx examples/use-cases/google_doc.ts
 */

import * as fs from "fs";
import * as path from "path";
import { ActionResult, Agent, Controller } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Create downloads directory for PDF output
const downloadPath = path.join(process.cwd(), "downloads");
if (!fs.existsSync(downloadPath)) {
	fs.mkdirSync(downloadPath, { recursive: true });
}

async function main() {
	// Check for required environment variable
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not set in environment variables");
	}

	// Initialize controller with custom PDF save action
	const controller = new Controller();

	// Custom action to save Google Doc as PDF
	controller.action("Save the current Google Document as a PDF file", {
		paramModel: z.object({
			filename: z
				.string()
				.optional()
				.describe("Optional filename for the PDF (without extension)"),
		}),
	})(async function saveGoogleDocAsPdf(
		params: { filename?: string },
		page: Page,
	) {
		try {
			// Create a descriptive filename
			const timestamp = new Date()
				.toISOString()
				.slice(0, 19)
				.replace(/:/g, "-");
			const filename = params.filename || `papa-letter-${timestamp}`;
			const filePath = path.join(downloadPath, `${filename}.pdf`);

			// Emulate screen media for better PDF output
			await page.emulateMedia({ media: "screen" });

			// Save as PDF with print-friendly settings
			await page.pdf({
				path: filePath,
				format: "A4",
				printBackground: true,
				margin: {
					top: "1in",
					right: "1in",
					bottom: "1in",
					left: "1in",
				},
			});

			const message = `Successfully saved Google Document as PDF to: ${filePath}`;
			console.log(`📄 ${message}`);

			return new ActionResult({
				extractedContent: message,
				includeInMemory: true,
				longTermMemory: `Saved letter to Papa as PDF: ${filename}.pdf`,
			});
		} catch (error) {
			const errorMessage = `Failed to save PDF: ${error instanceof Error ? error.message : String(error)}`;
			console.error(`❌ ${errorMessage}`);

			return new ActionResult({
				error: errorMessage,
				includeInMemory: true,
			});
		}
	});

	// Task definition
	const task = `
		Please help me write a heartfelt letter to my Papa in Google Docs and save it as a PDF:

		1. Go to docs.google.com
		2. Create a new document
		3. Write a sincere and heartfelt letter to my Papa, thanking him for everything he has done for me
		4. Include specific elements like:
		   - Appreciation for his guidance and support
		   - Memories of important moments we shared
		   - How his lessons have shaped who I am today
		   - My gratitude for his love and patience
		5. Make the letter warm, personal, and meaningful
		6. After writing the letter, save the document as a PDF file

		Please make sure the letter is well-formatted with proper paragraphs and a warm, grateful tone.
	`;

	// Browser profile configuration for real Chrome browser
	const browserProfile = new BrowserProfile({
		executablePath:
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: false, // Keep visible to see the process
		userDataDir: "~/.config/browsernode/profiles/default",
		viewport: { width: 1280, height: 800 },
	});

	// Create browser session
	const browserSession = new BrowserSession({
		browserProfile: browserProfile,
	});

	// Initialize the language model
	const model = new ChatOpenAI({
		model: "gpt-4.1",
		temperature: 0.5, // Slightly higher for more creative writing
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and configure the agent
	const agent = new Agent(task, model, {
		controller: controller,
		browserSession: browserSession,
		useVision: true,
		maxActionsPerStep: 2,
	});

	try {
		console.log("🚀 Starting Google Docs letter writing task...\n");
		console.log("📝 The agent will:");
		console.log("   • Open Google Docs");
		console.log("   • Write a heartfelt letter to Papa");
		console.log("   • Save the document as PDF");
		console.log("   • Store the PDF in the downloads folder\n");

		// Run the agent
		const history = await agent.run();

		console.log("✅ Task completed successfully!");
		console.log(`📁 Check the downloads folder for your PDF: ${downloadPath}`);

		// Display final result if available
		const result = history.finalResult();
		if (result) {
			console.log("\n🎯 Final result:", result);
		}

		// Wait for user input before closing browser
		console.log("\nPress Enter to close the browser...");
		await new Promise((resolve) => {
			process.stdin.once("data", resolve);
		});
	} catch (error) {
		console.error("💥 Error during task execution:", error);
	} finally {
		// Clean up browser session
		try {
			await browserSession.close();
			console.log("🔒 Browser session closed");
			if (browserSession) {
				await browserSession.kill();
				console.log("🔒 Browser killed");
			}
		} catch (closeError) {
			console.error("Error closing browser:", closeError);
		}
	}
}

// Helper function to wait for user input
function waitForInput(message: string): Promise<void> {
	console.log(message);
	return new Promise((resolve) => {
		process.stdin.once("data", () => resolve());
	});
}

// Run the main function
main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
