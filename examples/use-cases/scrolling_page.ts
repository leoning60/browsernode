/**
 * Goal: Automates webpage scrolling with various scrolling actions and text search functionality.
 *
 * Webpage Scrolling Template using browsernode
 * ----------------------------------------
 *
 * This template demonstrates how to use browsernode to navigate to a webpage and perform
 * various scrolling actions including:
 * - Scrolling down by specific amounts
 * - Scrolling up by specific amounts
 * - Scrolling to specific text content
 * - General page navigation
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import { Agent, BrowserProfile, BrowserSession } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// Check required environment variables
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

// ============ Configuration Section ============
interface ScrollingConfig {
	/** Configuration for webpage scrolling */
	openaiApiKey: string;
	headless: boolean;
	model: string;
	targetUrl: string;
	scrollTask: string;
}

// Customize these settings
const scrollingConfig: ScrollingConfig = {
	openaiApiKey: process.env.OPENAI_API_KEY!,
	headless: false,
	model: "gpt-4o",
	targetUrl: "https://en.wikipedia.org/wiki/Internet",
	// Example tasks - uncomment the one you want to use:
	scrollTask:
		"Navigate to 'https://en.wikipedia.org/wiki/Internet' and scroll to the string 'The vast majority of computer'",
	// scrollTask: "Navigate to 'https://en.wikipedia.org/wiki/Internet' and scroll down by one page - then scroll up by 100 pixels - then scroll down by 100 pixels - then scroll down by 10000 pixels.",
};

function createScrollingAgent(config: ScrollingConfig): Agent {
	const llm = new ChatOpenAI({
		model: config.model,
		apiKey: config.openaiApiKey,
	});

	const browserProfile = new BrowserProfile({
		headless: config.headless,
		disableSecurity: true,
		userDataDir: "~/.config/browsernode/profiles/scrolling",
	});

	const browserSession = new BrowserSession({
		browserProfile: browserProfile,
	});

	// Create the agent with scrolling instructions
	const agent = new Agent({
		task: config.scrollTask,
		llm: llm,
		useVision: true,
		browserSession: browserSession,
	});

	return agent;
}

async function performScrolling(agent: Agent): Promise<void> {
	try {
		await agent.run();
		console.log("✅ Scrolling task completed successfully!");
	} catch (error) {
		console.error(`❌ Error during scrolling task: ${error}`);
		throw error;
	}
}

async function main(): Promise<void> {
	console.log("🌐 Starting webpage scrolling automation...");
	console.log(`📄 Target URL: ${scrollingConfig.targetUrl}`);
	console.log(`📝 Task: ${scrollingConfig.scrollTask}`);

	const agent = createScrollingAgent(scrollingConfig);

	try {
		await performScrolling(agent);
	} catch (error) {
		console.error("❌ Failed to complete scrolling automation:", error);
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

// Run the main function
main().catch(console.error);

export { type ScrollingConfig, createScrollingAgent, performScrolling };
