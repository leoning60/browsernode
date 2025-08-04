/**
 * Goal: Automates posting on X (Twitter) using stored authentication cookies.
 *
 * Twitter Posting Agent using browsernode
 * ----------------------------------------
 *
 * This template demonstrates how to use browsernode to automate posting on X (Twitter)
 * using stored authentication cookies. The agent will:
 * - Navigate to X.com
 * - Write a new post with specified text
 * - Submit the post
 *
 * @dev You need to add GOOGLE_API_KEY to your environment variables.
 * @dev Make sure you have valid Twitter cookies stored in the browser profile.
 */

import { createInterface } from "readline";
import { Agent, BrowserProfile, BrowserSession } from "browsernode";
import { ChatGoogle } from "browsernode/llm";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// Check required environment variables
if (!process.env.GOOGLE_API_KEY) {
	throw new Error(
		"GOOGLE_API_KEY is not set. Please add it to your environment variables.",
	);
}

// ============ Configuration Section ============
interface TwitterPostingConfig {
	/** Configuration for Twitter posting agent */
	model: string;
	userDataDir: string;
	headless: boolean;
	executablePath?: string;
	maxActionsPerStep: number;
	maxSteps: number;
	postText: string;
}

// Customize these settings
const twitterPostingConfig: TwitterPostingConfig = {
	model: "gemini-2.5-flash",
	userDataDir: "~/.config/browsernode/profiles/default",
	headless: true, // Set to false to see the browser
	// executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // Uncomment for macOS
	maxActionsPerStep: 4,
	maxSteps: 25,
	postText: "browsernode ftw", // Change this to your desired post text
};

function createLLM(): ChatGoogle {
	return new ChatGoogle({
		model: twitterPostingConfig.model,
		apiKey: process.env.GOOGLE_API_KEY!,
	});
}

function createBrowserSession(): BrowserSession {
	const browserProfile = new BrowserProfile({
		userDataDir: twitterPostingConfig.userDataDir,
		headless: twitterPostingConfig.headless,
		// executablePath: twitterPostingConfig.executablePath, // Uncomment if specified
	});

	return new BrowserSession({
		browserProfile: browserProfile,
	});
}

async function waitForUserInput(prompt: string): Promise<void> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(prompt, () => {
			rl.close();
			resolve();
		});
	});
}

async function performTwitterPosting(): Promise<void> {
	console.log("🐦 Starting Twitter posting agent...");
	console.log(`📝 Post text: "${twitterPostingConfig.postText}"`);

	const llm = createLLM();
	const browserSession = createBrowserSession();

	// Create the agent
	const agent = new Agent({
		task: `go to https://x.com. write a new post with the text "${twitterPostingConfig.postText}", and submit it`,
		llm: llm,
		browserSession: browserSession,
		maxActionsPerStep: twitterPostingConfig.maxActionsPerStep,
	});

	try {
		console.log("🚀 Running agent...");
		await agent.run(twitterPostingConfig.maxSteps);

		console.log("✅ Twitter posting task completed successfully!");

		// Wait for user input before closing browser (if not headless)
		if (!twitterPostingConfig.headless) {
			await waitForUserInput("Press Enter to close the browser...");
		}
	} catch (error) {
		console.error(`❌ Error during Twitter posting task: ${error}`);
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
		await performTwitterPosting();
	} catch (error) {
		console.error("❌ Failed to complete Twitter posting task:", error);
		process.exit(1);
	}
}

// Run the main function
main().catch(console.error);

export {
	type TwitterPostingConfig,
	createLLM,
	createBrowserSession,
	performTwitterPosting,
	waitForUserInput,
};
