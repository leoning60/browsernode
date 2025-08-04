/**
 * Goal: A general-purpose web navigation agent for tasks like flight booking and course searching.
 *
 * Web Voyager Agent using browsernode
 * ----------------------------------------
 *
 * This template demonstrates how to use browsernode to create a general-purpose
 * web navigation agent that can handle various tasks including:
 * - Flight booking and search
 * - Course searching and enrollment
 * - Hotel booking
 * - General web navigation tasks
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { Agent, BrowserProfile, BrowserSession } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// Check required environment variables
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"Either OPENAI_API_KEY must be set. Please add them to your environment variables.",
	);
}

// ============ Configuration Section ============
interface WebVoyagerConfig {
	/** Configuration for web voyager agent */
	headless: boolean;
	model: string;
	minimumWaitPageLoadTime: number;
	maximumWaitPageLoadTime: number;
	viewport: { width: number; height: number };
	userDataDir: string;
	validateOutput: boolean;
	enableMemory: boolean;
	maxSteps: number;
}

// Customize these settings
const webVoyagerConfig: WebVoyagerConfig = {
	headless: false, // Set to true in production
	model: "gpt-4o",
	minimumWaitPageLoadTime: 1, // 3 on prod
	maximumWaitPageLoadTime: 10, // 20 on prod
	viewport: { width: 1280, height: 1100 },
	userDataDir: "~/.config/browsernode/profiles/default",
	validateOutput: true,
	enableMemory: false,
	maxSteps: 50,
};

// Example tasks - uncomment the one you want to use:
const TASKS = {
	flightSearch:
		"Find the lowest-priced one-way flight from Cairo to Montreal on February 21, 2025, including the total travel time and number of stops. on https://www.google.com/travel/flights/",
	courseSearch:
		"Browse Coursera, which universities offer Master of Advanced Study in Engineering degrees? Tell me what is the latest application deadline for this degree? on https://www.coursera.org/",
	hotelBooking:
		"Find and book a hotel in Paris with suitable accommodations for a family of four (two adults and two children) offering free cancellation for the dates of February 14-21, 2025. on https://www.booking.com/",
};

// Select the task you want to run
const SELECTED_TASK = TASKS.hotelBooking; // Change this to run different tasks

function createLLM(): ChatOpenAI {
	// Set LLM based on defined environment variables
	if (process.env.OPENAI_API_KEY) {
		return new ChatOpenAI({
			model: webVoyagerConfig.model,
			apiKey: process.env.OPENAI_API_KEY,
		});
	} else {
		throw new Error("No LLM found. Please set OPENAI_API_KEY ");
	}
}

function createBrowserSession(): BrowserSession {
	const browserProfile = new BrowserProfile({
		headless: webVoyagerConfig.headless,
		minimumWaitPageLoadTime: webVoyagerConfig.minimumWaitPageLoadTime,
		maximumWaitPageLoadTime: webVoyagerConfig.maximumWaitPageLoadTime,
		viewport: webVoyagerConfig.viewport,
		userDataDir: webVoyagerConfig.userDataDir,
		// tracePath: './tmp/web_voyager_agent', // Uncomment to enable tracing
	});

	return new BrowserSession({
		browserProfile: browserProfile,
	});
}

async function saveHistory(
	history: any,
	filePath: string = "./tmp/history.json",
): Promise<void> {
	try {
		// Ensure directory exists
		const dir = dirname(filePath);
		mkdirSync(dir, { recursive: true });

		// Save history to file
		writeFileSync(filePath, JSON.stringify(history, null, 2));
		console.log(`✅ History saved to: ${filePath}`);
	} catch (error) {
		console.error(`❌ Error saving history: ${error}`);
	}
}

async function performWebVoyagerTask(): Promise<void> {
	console.log("🌐 Starting web voyager agent...");
	console.log(`📝 Task: ${SELECTED_TASK}`);

	const llm = createLLM();
	const browserSession = createBrowserSession();

	// Create the agent
	const agent = new Agent({
		task: SELECTED_TASK,
		llm,
		browserSession: browserSession,
		validateOutput: webVoyagerConfig.validateOutput,
		// enableMemory: webVoyagerConfig.enableMemory, // Note: This option might not exist in browsernode
	});

	try {
		console.log("🚀 Running agent...");
		const history = await agent.run(webVoyagerConfig.maxSteps);

		console.log("✅ Web voyager task completed successfully!");
		console.log(`📊 Total steps: ${history.length}`);

		// Save history to file
		await saveHistory(history);
	} catch (error) {
		console.error(`❌ Error during web voyager task: ${error}`);
		throw error;
	} finally {
		// Clean up browser session
		if (agent.browserSession) {
			await agent.browserSession.close();
		}
		if (agent.browserSession) {
			await agent.browserSession.kill();
		}
	}
}

async function main(): Promise<void> {
	try {
		await performWebVoyagerTask();
	} catch (error) {
		console.error("❌ Failed to complete web voyager task:", error);
		process.exit(1);
	}
}

// Run the main function
main().catch(console.error);

export {
	type WebVoyagerConfig,
	TASKS,
	createLLM,
	createBrowserSession,
	performWebVoyagerTask,
	saveHistory,
};
