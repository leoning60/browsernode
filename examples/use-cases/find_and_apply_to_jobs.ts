import { createWriteStream, existsSync } from "fs";
import * as path from "path";
import { ChatOpenAI } from "@langchain/openai";
import {
	Agent,
	Browser,
	BrowserConfig,
	BrowserContext,
	Controller,
} from "browsernode";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import * as fs from "fs/promises";
import winston from "winston";

// Load environment variables

// Validate required environment variables
const requiredEnvVars = ["OPENAI_API_KEY"];
for (const envVar of requiredEnvVars) {
	if (!process.env[envVar]) {
		throw new Error(
			`${envVar} is not set. Please add it to your environment variables.`,
		);
	}
}

// Setup logger
const logger = winston.createLogger({
	level: "info",
	format: winston.format.json(),
	transports: [
		new winston.transports.Console({
			format: winston.format.simple(),
		}),
	],
});

// Initialize controller
const controller = new Controller();

// NOTE: Update this to your CV file path
const CV_PATH = path.join(process.cwd(), "cv_04_24.pdf");
const JOBS_CSV_PATH = path.join(process.cwd(), "jobs.csv");

// Check if CV exists
if (!existsSync(CV_PATH)) {
	throw new Error(
		`CV file not found at ${CV_PATH}. Please update CV_PATH to point to your CV file.`,
	);
}

// Job interface
interface Job {
	title: string;
	link: string;
	company: string;
	fitScore: number;
	location?: string;
	salary?: string;
}

// Controller action: Save jobs to file
controller.action(
	"Save jobs to file - with a score how well it fits to my profile",
	{
		paramModel: Job,
	},
)(async function saveJobs(params: Job) {
	try {
		const csvLine = stringify([
			[
				params.title,
				params.company,
				params.link,
				params.salary || "",
				params.location || "",
				params.fitScore,
			],
		]);

		await fs.appendFile(JOBS_CSV_PATH, csvLine);
		logger.info(`Saved job: ${params.title} at ${params.company}`);
		return "Saved job to file";
	} catch (error) {
		logger.error("Error saving job:", error);
		return `Failed to save job: ${error}`;
	}
});

// Controller action: Read jobs from file
controller.action("Read jobs from file")(async function readJobs() {
	try {
		if (!existsSync(JOBS_CSV_PATH)) {
			await fs.writeFile(
				JOBS_CSV_PATH,
				"Title,Company,Link,Salary,Location,FitScore\n",
			);
			return "No jobs saved yet. Created new jobs file.";
		}

		const content = await fs.readFile(JOBS_CSV_PATH, "utf-8");
		return content;
	} catch (error) {
		logger.error("Error reading jobs:", error);
		return `Failed to read jobs: ${error}`;
	}
});

// Controller action: Read CV for context
controller.action("Read my cv for context to fill forms")(
	async function readCV() {
		try {
			// Dynamic import for pdf-parse
			const pdfParse = await import("pdf-parse")
				.then((m) => m.default)
				.catch(() => null);

			if (!pdfParse) {
				logger.warn("pdf-parse not installed. Run: bun add pdf-parse");
				return {
					extractedContent:
						"PDF reading requires pdf-parse. Please install it with: bun add pdf-parse",
					includeInMemory: false,
				};
			}

			const dataBuffer = await fs.readFile(CV_PATH);
			const data = await pdfParse(dataBuffer);
			logger.info(`Read CV with ${data.text.length} characters`);

			return {
				extractedContent: data.text,
				includeInMemory: true,
			};
		} catch (error) {
			logger.error("Error reading CV:", error);
			return { error: `Failed to read CV: ${error}` };
		}
	},
);

// Controller action: Upload CV to element
controller.action(
	"Upload cv to element - call this function to upload if element is not found, try with different index of the same upload element",
)(async function uploadCV(params: { index: number }, browser: BrowserContext) {
	const absolutePath = path.resolve(CV_PATH);

	try {
		const domElement = await browser.getDomElementByIndex(params.index);

		if (!domElement) {
			return { error: `No element found at index ${params.index}` };
		}

		const fileUploadDomElement = domElement.getFileUploadElement();

		if (!fileUploadDomElement) {
			logger.info(`No file upload element found at index ${params.index}`);
			return { error: `No file upload element found at index ${params.index}` };
		}

		const fileUploadElement =
			await browser.getLocateElement(fileUploadDomElement);

		if (!fileUploadElement) {
			logger.info(`No file upload element found at index ${params.index}`);
			return { error: `No file upload element found at index ${params.index}` };
		}

		await fileUploadElement.setInputFiles(absolutePath);
		const msg = `Successfully uploaded file "${absolutePath}" to index ${params.index}`;
		logger.info(msg);
		return { extractedContent: msg };
	} catch (error) {
		logger.error(`Error uploading file: ${error}`);
		return {
			error: `Failed to upload file to index ${params.index}: ${error}`,
		};
	}
});

// Main function
async function main() {
	// Initialize LLM
	const llm = new ChatOpenAI({
		modelName: "gpt-4o",
		temperature: 0.0,
		streaming: true,
		openAIApiKey: process.env.OPENAI_API_KEY,
	});

	// Create browser configuration
	const browserConfig = new BrowserConfig({
		headless: false,
		browserInstancePath:
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // Update for your OS
		disableSecurity: true,
	});

	const browser = new Browser(browserConfig);

	// Base task
	const groundTask = `You are a professional job finder.
1. Read my CV with read_cv action
2. Read the saved jobs file
3. Find ML internships and save them to a file
Search at company:`;

	// Tasks for different companies
	const tasks = [
		`${groundTask}\nGoogle`,
		// `${groundTask}\nAmazon`,
		// `${groundTask}\nApple`,
		// `${groundTask}\nMicrosoft`,
		// `${groundTask}\nMeta`,
	];

	// Create agents for each task
	const agents = tasks.map(
		(task) =>
			new Agent(task, llm, {
				controller,
				browser,
				useVision: true,
				maxFailures: 3,
				retryDelay: 3,
			}),
	);

	// Run all agents concurrently
	try {
		await Promise.all(agents.map((agent) => agent.run()));
		logger.info("All tasks completed successfully!");
	} catch (error) {
		logger.error("Error during agent execution:", error);
		process.exit(1);
	}
}

// Run the main function

main().catch((error) => {
	logger.error("Fatal error:", error);
	process.exit(1);
});
