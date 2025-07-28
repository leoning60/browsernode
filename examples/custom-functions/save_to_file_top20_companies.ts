import * as fs from "fs";
import * as path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { ActionResult, Agent, Controller } from "browsernode";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import * as csv from "csv-writer";
import { z } from "zod";

function getCurrentDirPath() {
	const __filename = fileURLToPath(import.meta.url);
	return dirname(__filename);
}

// Initialize controller
const controller = new Controller();

// Define the company schema using Zod
const CompanySchema = z.object({
	rank: z.number(),
	companyName: z.string(),
	symbol: z.string(),
});

const CompaniesSchema = z.object({
	companies: z.array(CompanySchema),
});

type Company = z.infer<typeof CompanySchema>;
type Companies = z.infer<typeof CompaniesSchema>;

// Save companies to CSV - custom action
controller.action("Save companies to csv", {
	paramModel: CompaniesSchema,
})(async function saveCompanies(params: Companies, page: Page) {
	const filePath = path.join(getCurrentDirPath(), "nasdaq_top20_companies.csv");

	try {
		// Ensure directory exists
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		// Create CSV writer with proper headers
		const csvWriter = csv.createObjectCsvWriter({
			path: filePath,
			header: [
				{ id: "rank", title: "rank" },
				{ id: "companyName", title: "company_name" },
				{ id: "symbol", title: "symbol" },
			],
		});

		// Log the operation
		console.log(
			`📝 Attempting to save ${params.companies.length} companies to: ${filePath}`,
		);

		// Write to CSV file using csv-writer
		await csvWriter.writeRecords(params.companies);

		// Verify file was written
		if (fs.existsSync(filePath)) {
			const fileStats = fs.statSync(filePath);
			console.log(`✅ File saved successfully. Size: ${fileStats.size} bytes`);

			// Read and display the content
			const content = fs.readFileSync(filePath, "utf8");
			console.log(`📄 CSV content:\n${content}`);
		}

		const msg = `Saved ${params.companies.length} companies to nasdaq_top20_companies.csv`;
		return new ActionResult({
			extractedContent: msg,
			includeInMemory: true,
			longTermMemory: `Saved ${params.companies.length} companies to CSV file`,
		});
	} catch (error) {
		const errorMsg = `❌ Failed to save companies to file: ${error}`;
		console.error(errorMsg);
		return new ActionResult({
			error: errorMsg,
			extractedContent: errorMsg,
			includeInMemory: true,
		});
	}
});

async function main() {
	const task = `
	create a csv of the 20 biggest companies in the nasdaq.
	
	Use the "Save companies to csv" action to save the data to a CSV file.
	`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4.1",
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
