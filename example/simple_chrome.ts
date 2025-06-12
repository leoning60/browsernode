import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { Agent, Browser, BrowserConfig } from "browsernode";

const llm = new ChatOpenAI({
	modelName: "gpt-4o",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENAI_API_KEY,
});

const task = "Search for the latest tesla stock price";

// Function to detect the default Chrome path on macOS
function getDefaultChromePath(): string {
	return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}
// Create browser configuration
const config = new BrowserConfig({
	headless: false, // Make sure the browser is visible
	// headless: true, // Alternative: Use headless mode to avoid conflicts with existing Chrome instances
	browserClass: "chromium", // Use Chrome/Chromium
	browserInstancePath: getDefaultChromePath(), // Path to Chrome on macOS
	extraBrowserArgs: [
		"--start-maximized",
		"--user-data-dir=/tmp/chrome-browsernode", // Use a separate user data directory
	], // Optional: start with maximized window
	forceKeepBrowserAlive: true, // Add this option to prevent closing browser when using existing instance
});

const agent = new Agent(task, llm, {
	browser: new Browser(config),
});
console.log("---simple_chrome.ts agent run---");
// Run the agent task and handle process termination
async function runAgentTask() {
	try {
		// Wait for the agent to complete its task
		const history = await agent.run();
		console.log("Task completed successfully!");

		// Manually terminate the process when done
		setTimeout(() => {
			console.log("Exiting process...");
			process.exit(0);
		}, 1000);
	} catch (error) {
		console.error("Error during agent task:", error);
		process.exit(1);
	}
}

runAgentTask();
