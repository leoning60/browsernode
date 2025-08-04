/**
 * Custom User Agent Example
 *
 * This example demonstrates how to:
 * 1. Use command line arguments to configure the agent
 * 2. Set a custom user agent in the browser profile
 * 3. Run a task to verify the user agent is being used
 * 4. Support multiple LLM providers (OpenAI and Anthropic)
 *
 * Required Environment Variables:
 * - OPENAI_API_KEY: Your OpenAI API key (if using OpenAI)
 * - ANTHROPIC_API_KEY: Your Anthropic API key (if using Anthropic)
 *
 * Installation:
 * 1. npm install
 * 2. Copy .env.example to .env and add your API keys
 * 3. npx tsx examples/features/custom_user_agent.ts [--provider openai|anthropic] [--query "custom task"]
 */

import { Agent, Controller } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatAnthropic, ChatOpenAI } from "browsernode/llm";
import { Command } from "commander";

function getLlm(provider: string) {
	if (provider === "anthropic") {
		if (!process.env.ANTHROPIC_API_KEY) {
			throw new Error("ANTHROPIC_API_KEY is not set in environment variables");
		}
		return new ChatAnthropic({
			model: "claude-3-5-sonnet-20240620",
			temperature: 0.0,
			apiKey: process.env.ANTHROPIC_API_KEY,
		});
	} else if (provider === "openai") {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error("OPENAI_API_KEY is not set in environment variables");
		}
		return new ChatOpenAI({
			model: "gpt-4o",
			temperature: 0.0,
			apiKey: process.env.OPENAI_API_KEY,
		});
	} else {
		throw new Error(`Unsupported provider: ${provider}`);
	}
}

// NOTE: This example is to find your current user agent string to use it in the browser_context
const defaultTask =
	"go to https://whatismyuseragent.com and find the current user agent string";

async function main() {
	// Set up command line argument parsing
	const program = new Command();
	program
		.option("--query <query>", "The query to process", defaultTask)
		.option("--provider <provider>", "The model provider to use", "openai")
		.parse();

	const options = program.opts();

	// Validate provider
	if (!["openai", "anthropic"].includes(options.provider)) {
		console.error('Error: provider must be either "openai" or "anthropic"');
		process.exit(1);
	}

	console.log(`🤖 Using provider: ${options.provider}`);
	console.log(`📝 Task: ${options.query}`);
	console.log(`🌐 Custom User Agent: foobarfoo\n`);

	try {
		// Initialize the language model
		const llm = getLlm(options.provider);

		// Create controller
		const controller = new Controller();

		// Create browser session with custom user agent
		const browserProfile = new BrowserProfile({
			userAgent: "foobarfoo",
			userDataDir: "~/.config/browsernode/profiles/default",
			headless: false, // Make browser visible to see the results
		});

		const browserSession = new BrowserSession({
			browserProfile: browserProfile,
		});

		// Create agent with custom configuration
		const agent = new Agent({
			task: options.query,
			llm: llm,
			controller: controller,
			browserSession: browserSession,
			useVision: true,
			maxActionsPerStep: 1,
		});

		console.log("🚀 Starting agent execution...\n");

		// Run the agent with max steps
		const history = await agent.run(25);

		console.log("\n✅ Agent execution completed!");
		console.log("Final result:", history.finalResult());

		// Wait for user input before closing
		console.log("\nPress Enter to close the browser...");
		await new Promise((resolve) => {
			process.stdin.once("data", resolve);
		});

		// Close the browser session
		await browserSession.close();
		console.log("🔚 Browser session closed.");
	} catch (error) {
		console.error("💥 Error running agent:", error);
		process.exit(1);
	}
}

// Run the main function
main().catch(console.error);
