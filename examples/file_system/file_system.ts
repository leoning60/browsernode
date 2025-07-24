import * as fs from "fs";
import * as path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { ActionResult, Agent, Controller } from "browsernode";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Script directory setup
const SCRIPT_DIR = __dirname;
const agentDir = path.join(SCRIPT_DIR, "test_no_thinking");
const conversationDir = path.join(agentDir, "conversations", "conversation");
const fileSystemDir = path.join(agentDir, "fs");

// Create directories
if (!fs.existsSync(agentDir)) {
	fs.mkdirSync(agentDir, { recursive: true });
}
if (!fs.existsSync(conversationDir)) {
	fs.mkdirSync(conversationDir, { recursive: true });
}
if (!fs.existsSync(fileSystemDir)) {
	fs.mkdirSync(fileSystemDir, { recursive: true });
}

console.log(`Agent logs directory: ${agentDir}`);

// Initialize controller
const controller = new Controller();

// Custom action to write content to a file
controller.action("Write content to a file", {
	paramModel: z.object({
		filename: z.string().describe("Name of the file to write to"),
		content: z.string().describe("Content to write to the file"),
	}),
})(async function writeFile(
	params: { filename: string; content: string },
	page: Page,
) {
	const filePath = path.join(fileSystemDir, params.filename);

	try {
		fs.writeFileSync(filePath, params.content, "utf8");
		const msg = `Successfully wrote content to ${params.filename}`;
		return new ActionResult({
			extractedContent: msg,
			includeInMemory: true,
			longTermMemory: `Wrote file: ${params.filename}`,
		});
	} catch (error) {
		const errorMsg = `Failed to write to ${params.filename}: ${error}`;
		return new ActionResult({
			extractedContent: errorMsg,
			includeInMemory: true,
			longTermMemory: errorMsg,
		});
	}
});

// Custom action to append content to a file
controller.action("Append content to an existing file", {
	paramModel: z.object({
		filename: z.string().describe("Name of the file to append to"),
		content: z.string().describe("Content to append to the file"),
	}),
})(async function appendFile(
	params: { filename: string; content: string },
	page: Page,
) {
	const filePath = path.join(fileSystemDir, params.filename);

	try {
		fs.appendFileSync(filePath, `\n${params.content}`, "utf8");
		const msg = `Successfully appended content to ${params.filename}`;
		return new ActionResult({
			extractedContent: msg,
			includeInMemory: true,
			longTermMemory: `Appended to file: ${params.filename}`,
		});
	} catch (error) {
		const errorMsg = `Failed to append to ${params.filename}: ${error}`;
		return new ActionResult({
			extractedContent: errorMsg,
			includeInMemory: true,
			longTermMemory: errorMsg,
		});
	}
});

// Custom action to read content from a file
controller.action("Read content from a file", {
	paramModel: z.object({
		filename: z.string().describe("Name of the file to read"),
	}),
})(async function readFile(params: { filename: string }, page: Page) {
	const filePath = path.join(fileSystemDir, params.filename);

	try {
		const content = fs.readFileSync(filePath, "utf8");
		const msg = `File content of ${params.filename}:\n${content}`;
		return new ActionResult({
			extractedContent: msg,
			includeInMemory: true,
			longTermMemory: `Read file: ${params.filename}`,
		});
	} catch (error) {
		const errorMsg = `Failed to read ${params.filename}: ${error}`;
		return new ActionResult({
			extractedContent: errorMsg,
			includeInMemory: true,
			longTermMemory: errorMsg,
		});
	}
});

// Custom action to share/display file content
controller.action("Share the content of a file with the user", {
	paramModel: z.object({
		filename: z.string().describe("Name of the file to share"),
	}),
})(async function shareFile(params: { filename: string }, page: Page) {
	const filePath = path.join(fileSystemDir, params.filename);

	try {
		const content = fs.readFileSync(filePath, "utf8");
		const msg = `Sharing file ${params.filename} with user:\n\n--- File Content ---\n${content}\n--- End of File ---`;
		return new ActionResult({
			extractedContent: msg,
			includeInMemory: true,
			longTermMemory: `Shared file: ${params.filename} with user`,
		});
	} catch (error) {
		const errorMsg = `Failed to share ${params.filename}: ${error}`;
		return new ActionResult({
			extractedContent: errorMsg,
			includeInMemory: true,
			longTermMemory: errorMsg,
		});
	}
});

async function main() {
	const task = `
Go to https://mertunsall.github.io/posts/post1.html
Save the title of the article in "data.md"
Then, use append_file to add the first sentence of the article to "data.md"
Then, read the file to see its content and make sure it's correct.
Finally, share the file with me.

NOTE: DO NOT USE extract_structured_data action - everything is visible in browser state.
    `.trim();

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

	try {
		const result = await agent.run();
		console.log(`🎯 Final result: ${result}`, { flush: true });

		// Wait for user input before cleaning up
		console.log("\nPress Enter to clean the file system...");
		await new Promise((resolve) => {
			process.stdin.once("data", () => {
				resolve(void 0);
			});
		});

		// Clean the file system
		if (fs.existsSync(fileSystemDir)) {
			fs.rmSync(fileSystemDir, { recursive: true, force: true });
			console.log("File system cleaned successfully.");
		}
	} catch (error) {
		console.error("Error running agent:", error);
	}
}

// Run the main function
main().catch(console.error);
