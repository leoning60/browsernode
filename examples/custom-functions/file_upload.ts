import * as fs from "fs";
import * as path from "path";
import { ActionResult, Agent, Controller } from "browsernode";
import type { BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";
import { config } from "dotenv";
import { z } from "zod";

config();

// Initialize controller
const controller = new Controller();

// Custom file upload action
controller.action("Upload file to interactive element with file path", {
	paramModel: z.object({
		index: z.number(),
		path: z.string(),
	}),
})(async function uploadFile(
	params: { index: number; path: string },
	browserSession: BrowserSession,
	availableFilePaths?: string[],
) {
	// Validate file path is available
	if (!availableFilePaths || !availableFilePaths.includes(params.path)) {
		return new ActionResult({
			error: `File path ${params.path} is not available`,
		});
	}

	// Check if file exists
	if (!fs.existsSync(params.path)) {
		return new ActionResult({
			error: `File ${params.path} does not exist`,
		});
	}

	// Find file upload element
	const fileUploadDomEl = await browserSession.findFileUploadElementByIndex(
		params.index,
		3,
		3,
	);

	if (!fileUploadDomEl) {
		const msg = `No file upload element found at index ${params.index}`;
		console.log(msg);
		return new ActionResult({ error: msg });
	}

	// Get the actual element handle
	const fileUploadEl = await browserSession.getLocateElement(fileUploadDomEl);

	if (!fileUploadEl) {
		const msg = `No file upload element found at index ${params.index}`;
		console.log(msg);
		return new ActionResult({ error: msg });
	}

	try {
		// Upload the file
		await fileUploadEl.setInputFiles(params.path);
		const msg = `Successfully uploaded file to index ${params.index}`;
		console.log(msg);
		return new ActionResult({
			extractedContent: msg,
			includeInMemory: true,
		});
	} catch (e: any) {
		const msg = `Failed to upload file to index ${params.index}: ${e.toString()}`;
		console.log(msg);
		return new ActionResult({ error: msg });
	}
});

// Helper function to create test files
function createFile(fileType: string = "txt"): string {
	const fileName = `tmp.${fileType}`;
	const filePath = path.join(process.cwd(), fileName);

	// Create file content based on type
	let content = "test";
	if (fileType === "pdf") {
		// For PDF, we'll create a simple text file that can be converted
		content = "This is a test PDF content";
	} else if (fileType === "csv") {
		content = "name,age,city\nJohn,30,New York\nJane,25,Los Angeles";
	}

	fs.writeFileSync(filePath, content);
	console.log(`Created file: ${filePath}`);
	return filePath;
}

async function main() {
	//const task = 'Go to https://kzmpmkh2zfk1ojnpxfn1.lite.vusercontent.net/ and - read the file content and upload them to fields'
	const task =
		"Go to https://www.freepdfconvert.com/, upload the file tmp.pdf into the field choose a file - dont click the fileupload button";

	// Create test files
	const availableFilePaths = [
		createFile("txt"),
		createFile("pdf"),
		createFile("csv"),
	];

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4.1-mini",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent(task, llm, {
		controller: controller,
		availableFilePaths: availableFilePaths,
	});

	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

// Run the main function
main().catch(console.error);
