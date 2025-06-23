import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import {
	Agent,
	Browser,
	BrowserConfig,
	BrowserContextConfig,
	Controller,
} from "browsernode";
import { saveScreenshots } from "../utils/save_screenshots";

// Validate required environment variables
const requiredEnvVars = ["OPENAI_API_KEY"];
for (const envVar of requiredEnvVars) {
	if (!process.env[envVar]) {
		throw new Error(
			`${envVar} is not set. Please add it to your environment variables.`,
		);
	}
}

function getCurrentDirPath() {
	const __filename = fileURLToPath(import.meta.url);
	return dirname(__filename);
}

// Initialize controller
const controller = new Controller();

// Task options - uncomment the one you want to use
// const TASK = `
// Find the lowest-priced one-way flight from Cairo to Montreal on February 21, 2025, including the total travel time and number of stops. on https://www.google.com/travel/flights/
// `;

// const TASK = `
// Browse Coursera, which universities offer Master of Advanced Study in Engineering degrees? Tell me what is the latest application deadline for this degree? on https://www.coursera.org/
// `;

const TASK = `
Find and book a hotel in Paris with suitable accommodations for a family of four (two adults and two children) offering free cancellation for the dates of August 14-21, 2025. on https://www.booking.com/
`;

async function main() {
	try {
		const model = new ChatOpenAI({
			modelName: "gpt-4o-mini",
			apiKey: process.env.OPENAI_API_KEY,
			streaming: true,
			temperature: 0.1,
		});

		const agent = new Agent(TASK, model, {
			controller,
			useVision: true,
			browser: new Browser(
				new BrowserConfig({
					headless: false, // Set to true in production
					disableSecurity: true,
					newContextConfig: new BrowserContextConfig({
						// minimumWaitPageLoadTime: 1000, // 1 second (3 seconds in production)
						// maximumWaitPageLoadTime: 1000, // 10 seconds (20 seconds in production)
						// noViewport: true,
						browserWindowSize: {
							width: 1280,
							height: 1100,
						},
					}),
				}),
			),
		});

		console.log("Starting web voyager agent...");
		console.log("Task:", TASK);

		const history = await agent.run();

		console.log("Task completed successfully!");

		// Save history to file
		saveHistoryToFile(history);
		// Save screenshots if available
		saveScreenshots(history.screenshots(), getCurrentDirPath());
	} catch (error) {
		console.error("Error running web voyager agent:", error);
		throw error;
	}
}

function saveHistoryToFile(history: any) {
	try {
		const timestamp = Date.now().toString();
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const tmpDir = join(__dirname, "tmp");
		mkdirSync(tmpDir, { recursive: true });

		const historyPath = join(tmpDir, `history_${timestamp}.json`);
		writeFileSync(historyPath, JSON.stringify(history, null, 2));
		console.log(`Saved history: ${historyPath}`);
	} catch (error) {
		console.error("Error saving history:", error);
	}
}

main().catch(console.error);
