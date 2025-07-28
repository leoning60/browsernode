import * as fs from "fs";
import * as path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { ActionResult, Agent, Controller } from "browsernode";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

function getCurrentDirPath() {
	const __filename = fileURLToPath(import.meta.url);
	return dirname(__filename);
}

// Initialize controller
const controller = new Controller();

// Define the HuggingFace model schema using Zod
const ModelSchema = z.object({
	name: z.string().describe("The name of the model"),
	author: z.string().describe("The author/organization of the model"),
	download_count: z.string().describe("Number of downloads"),
	link: z.string().describe("URL link to the model"),
});

const ModelsSchema = z.object({
	models: z.array(ModelSchema).describe("Array of HuggingFace models"),
});

type Model = z.infer<typeof ModelSchema>;
type Models = z.infer<typeof ModelsSchema>;

// Save models to JSON file - custom action
controller.action("Save models to JSON", {
	paramModel: ModelsSchema,
})(async function saveModelsToJson(params: Models, page: Page) {
	const filePath = path.join(getCurrentDirPath(), "huggingface_models.json");

	try {
		// Ensure directory exists
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		// Log the operation
		console.log(
			`📝 Attempting to save ${params.models.length} models to: ${filePath}`,
		);

		// Create JSON content with proper formatting
		const jsonContent = JSON.stringify(params, null, 2);
		console.log(`📄 Content to save:\n${jsonContent}`);

		// Write to file
		fs.writeFileSync(filePath, jsonContent, "utf-8");

		// Verify file was written
		if (fs.existsSync(filePath)) {
			const fileStats = fs.statSync(filePath);
			console.log(`✅ File saved successfully. Size: ${fileStats.size} bytes`);
		}

		const msg = `Saved ${params.models.length} HuggingFace models to huggingface_models.json`;
		return new ActionResult({
			extractedContent: msg,
			includeInMemory: true,
			longTermMemory: `Saved ${params.models.length} HuggingFace models to JSON file`,
		});
	} catch (error) {
		const errorMsg = `❌ Failed to save models to JSON file: ${error}`;
		console.error(errorMsg);
		return new ActionResult({
			error: errorMsg,
			extractedContent: errorMsg,
			includeInMemory: true,
		});
	}
});

async function main() {
	// Check for required environment variable
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not set in environment variables");
	}

	const task = `
	Go to HuggingFace models page (https://huggingface.co/models), sort the models by number of downloads, and collect the first 10 results.
	
	For each model, extract:
	- name: The model name
	- author: The author/organization name
	- download_count: The number of downloads (as shown on the page)
	- link: The full URL to the model page
	
	After collecting the data, use the "Save models to JSON" action to save all 10 models to a JSON file.
	`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent(task, llm, {
		controller: controller,
	});

	try {
		console.log("🚀 Starting agent to scrape HuggingFace models...\n");

		const result = await agent.run();
		console.log(`🎯 Task completed: ${result.finalResult()}`);

		// Check if the JSON file was created
		const jsonFilePath = path.join(
			getCurrentDirPath(),
			"huggingface_models.json",
		);
		if (fs.existsSync(jsonFilePath)) {
			console.log("\n📄 JSON file created successfully!");

			// Read and display the saved data
			const savedData = JSON.parse(fs.readFileSync(jsonFilePath, "utf-8"));
			console.log(
				`\n📊 Preview of saved models (${savedData.models.length} total):`,
			);

			for (const [index, model] of savedData.models.entries()) {
				console.log(`\n${index + 1}. --------------------------------`);
				console.log(`Name:         ${model.name}`);
				console.log(`Author:       ${model.author}`);
				console.log(`Downloads:    ${model.download_count}`);
				console.log(`Link:         ${model.link}`);
			}
		}
	} catch (error) {
		console.error("💥 Error running agent:", error);
	}
}

// Run the main function
main().catch(console.error);
