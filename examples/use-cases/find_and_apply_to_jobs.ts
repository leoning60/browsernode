/**
 * Goal: Searches for job listings, evaluates relevance based on a CV, and applies
 *
 * This example demonstrates how to use browsernode to automate job searching and application
 * processes with custom actions for file handling and CV uploads.
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 * Also you need to have a CV file (cv_04_24.pdf) in the current directory.
 */

import * as fs from "fs";
import * as path from "path";
import {
	ActionResult,
	Agent,
	BrowserProfile,
	BrowserSession,
	Controller,
} from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import * as csv from "csv-writer";
import { config } from "dotenv";
import { z } from "zod";
// import pdf from "pdf-parse"; // Dynamic import used instead

config();

// Check required environment variables
const requiredEnvVars = ["OPENAI_API_KEY"];
for (const varName of requiredEnvVars) {
	if (!process.env[varName]) {
		throw new Error(
			`${varName} is not set. Please add it to your environment variables.`,
		);
	}
}

// NOTE: This is the path to your cv file
// You can modify this path to point to your actual CV file
const CV_PATH = path.join(process.cwd(), "cv_04_24.pdf");

// Check if CV file exists
if (!fs.existsSync(CV_PATH)) {
	throw new Error(
		`You need to set the path to your cv file in the CV_PATH variable. CV file not found at ${CV_PATH}`,
	);
}

// Define the Job schema using Zod
const JobSchema = z.object({
	title: z.string(),
	link: z.string(),
	company: z.string(),
	fitScore: z.number(),
	location: z.string().optional(),
	salary: z.string().optional(),
});

type Job = z.infer<typeof JobSchema>;

// Initialize controller for custom actions
const controller = new Controller();

// Register custom actions
controller.action(
	"Save jobs to file - with a score how well it fits to my profile",
	{
		paramModel: JobSchema,
	},
)(async function saveJobs(job: Job) {
	const csvWriter = csv.createObjectCsvWriter({
		path: "jobs.csv",
		header: [
			{ id: "title", title: "Title" },
			{ id: "company", title: "Company" },
			{ id: "link", title: "Link" },
			{ id: "fitScore", title: "Fit Score" },
			{ id: "salary", title: "Salary" },
			{ id: "location", title: "Location" },
		],
		append: true,
	});

	await csvWriter.writeRecords([job]);
	console.log(
		`📄 Saved job: ${job.title} at ${job.company} (Fit Score: ${job.fitScore})`,
	);
	return "Saved job to file";
});

controller.action("Read jobs from file")(async function readJobs() {
	if (!fs.existsSync("jobs.csv")) {
		return "No jobs file found";
	}
	return fs.readFileSync("jobs.csv", "utf-8");
});

controller.action("Read my cv for context to fill forms")(
	async function readCv() {
		try {
			if (fs.existsSync(CV_PATH)) {
				// Use dynamic import to avoid initialization issues with pdf-parse
				const { default: pdf } = await import("pdf-parse");
				const dataBuffer = fs.readFileSync(CV_PATH);
				const data = await pdf(dataBuffer);
				const cvContent = data.text;
				console.log(`📋 Read CV with ${cvContent.length} characters`);
				return new ActionResult({
					extractedContent: cvContent,
					includeInMemory: true,
				});
			} else {
				throw new Error(`CV file not found at ${CV_PATH}`);
			}
		} catch (error) {
			console.error("❌ Error reading CV:", error);
			return new ActionResult({
				error: `Error reading CV file: ${error}`,
			});
		}
	},
);

controller.action(
	"Upload cv to element - call this function to upload if element is not found, try with different index of the same upload element",
)(async function uploadCv(index: number, browserSession: BrowserSession) {
	try {
		const absolutePath = path.resolve(CV_PATH);

		// Find file upload element by index
		const fileUploadDomEl = await browserSession.findFileUploadElementByIndex(
			index,
			3,
			3,
		);

		if (!fileUploadDomEl) {
			console.log(`⚠️  No file upload element found at index ${index}`);
			return new ActionResult({
				error: `No file upload element found at index ${index}`,
			});
		}

		// Get the actual element
		const fileUploadEl = await browserSession.getLocateElement(fileUploadDomEl);

		if (!fileUploadEl) {
			console.log(`⚠️  No file upload element found at index ${index}`);
			return new ActionResult({
				error: `No file upload element found at index ${index}`,
			});
		}

		// Upload the file
		await fileUploadEl.setInputFiles(absolutePath);
		const message = `✅ Successfully uploaded file "${absolutePath}" to index ${index}`;
		console.log(message);
		return new ActionResult({
			extractedContent: message,
			includeInMemory: true,
		});
	} catch (error) {
		const errorMsg = `❌ Failed to upload file to index ${index}: ${error}`;
		console.error(errorMsg);
		return new ActionResult({
			error: errorMsg,
		});
	}
});

// Configure browser session
const browserSession = new BrowserSession({
	browserProfile: new BrowserProfile({
		// Uncomment and modify if you want to use a specific Chrome installation
		// executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		disableSecurity: true,
		userDataDir: "~/.config/browsernode/profiles/default",
	}),
});

async function main() {
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		apiKey: process.env.OPENAI_API_KEY!,
	});

	const groundTask =
		"You are a professional job finder. " +
		"1. Read my cv with readCv " +
		"find ml internships in and save them to a file " +
		"search at company:";

	const tasks = [
		groundTask + "\n" + "Google",
		// groundTask + '\n' + 'Amazon',
		// groundTask + '\n' + 'Apple',
		// groundTask + '\n' + 'Microsoft',
		// groundTask + '\n' + 'Meta',
	];

	// Create agents for each task
	const agents = tasks.map(
		(task) =>
			new Agent(task, llm, {
				useVision: true,
				controller: controller,
				browserSession: browserSession,
			}),
	);

	try {
		// Run all agents concurrently
		const results = await Promise.all(agents.map((agent) => agent.run()));

		results.forEach((result, index) => {
			console.log(`🎯 Task ${index + 1} completed:`, result);
		});
	} catch (error) {
		console.error("❌ Error running agents:", error);
	} finally {
		// Clean up browser session
		await browserSession.close();
	}

	console.log("✅ All tasks completed. Check jobs.csv for saved jobs.");
}

// Run the main function
main().catch(console.error);
