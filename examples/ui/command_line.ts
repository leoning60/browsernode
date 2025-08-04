import { Agent, ChatAnthropic, ChatOpenAI } from "browsernode";
import { BrowserSession } from "browsernode";
import { Controller } from "browsernode";
import type { BaseChatModel } from "browsernode/llm";

interface CommandLineArgs {
	query: string;
	provider: "openai" | "anthropic";
}

/**
 * Get LLM instance based on provider
 */
function getLLM(provider: string): BaseChatModel {
	if (provider === "anthropic") {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) {
			throw new Error(
				"Error: ANTHROPIC_API_KEY is not set. Please provide a valid API key.",
			);
		}

		return new ChatAnthropic({
			model: "claude-3-5-sonnet-20240620",
			temperature: 0.0,
			apiKey: apiKey,
		});
	} else if (provider === "openai") {
		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			throw new Error(
				"Error: OPENAI_API_KEY is not set. Please provide a valid API key.",
			);
		}

		return new ChatOpenAI({
			model: "gpt-4o",
			temperature: 0.0,
			apiKey: apiKey,
		});
	} else {
		throw new Error(`Unsupported provider: ${provider}`);
	}
}

/**
 * Parse command-line arguments
 */
function parseArguments(): CommandLineArgs {
	const args = process.argv.slice(2);
	let query = "go to search.brave.com and search for posts about tesla optimus";
	let provider: "openai" | "anthropic" = "openai";

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--query":
				if (i + 1 < args.length) {
					query = args[i + 1] || "??";
					i++; // Skip the next argument since we consumed it
				} else {
					throw new Error("--query requires a value");
				}
				break;
			case "--provider":
				if (i + 1 < args.length) {
					const providerValue = args[i + 1];
					if (providerValue === "openai" || providerValue === "anthropic") {
						provider = providerValue;
						i++; // Skip the next argument since we consumed it
					} else {
						throw new Error(
							"--provider must be either 'openai' or 'anthropic'",
						);
					}
				} else {
					throw new Error("--provider requires a value");
				}
				break;
			case "--help":
			case "-h":
				console.log(`
Usage: npx tsx command_line.ts [options]

Options:
  --query <string>     The query to process (default: "go to search.brave.com and search for tesla optimus")
  --provider <string>  The model provider to use: openai or anthropic (default: openai)
  --help, -h          Show this help message

Examples:
  npx tsx command_line.ts
  npx tsx command_line.ts --query "go to search.brave.com and search for tesla optimus"
  npx tsx command_line.ts --query "find latest node.js tutorials on Medium" --provider anthropic
`);
				process.exit(0);
				break;
			default:
				if (args[i]?.startsWith("-")) {
					throw new Error(`Unknown option: ${args[i]}`);
				}
		}
	}

	return { query, provider };
}

/**
 * Initialize the browser agent with the given query and provider
 */
function initializeAgent(query: string, provider: string) {
	const llm = getLLM(provider);
	const controller = new Controller();
	const browserSession = new BrowserSession();

	const agent = new Agent({
		task: query,
		llm: llm,
		useVision: true,
		maxActionsPerStep: 1,
	});

	return { agent, browserSession };
}

/**
 * Main async function to run the agent
 */
async function main() {
	try {
		console.log("🤖 Browsernode Command Line Interface");
		console.log("=====================================\n");

		const args = parseArguments();
		console.log(`Provider: ${args.provider}`);
		console.log(`Query: ${args.query}\n`);

		const { agent, browserSession } = initializeAgent(
			args.query,
			args.provider,
		);

		console.log("Starting browser automation...\n");
		const result = await agent.run();

		console.log("\n✅ Task completed!");
		console.log("Final result:", result.finalResult() || "No result available");

		console.log("\nPress Enter to close the browser...");
		process.stdin.once("data", async () => {
			await browserSession.close();
			console.log("Browser closed. Goodbye!");
			process.exit(0);
		});
	} catch (error) {
		console.error(
			"❌ Error:",
			error instanceof Error ? error.message : String(error),
		);
		process.exit(1);
	}
}

// Run if this file is executed directly

main().catch((error) => {
	console.error("❌ Fatal error:", error);
	process.exit(1);
});

export { getLLM, parseArguments, initializeAgent, main };
