/**
 * Custom System Prompt Example
 *
 * This example demonstrates how to:
 * 1. Use extendSystemMessage to add custom instructions to the default system prompt
 * 2. Access and display the system prompt configuration
 * 3. Run an agent with custom behavior rules
 *
 * Required Environment Variables:
 * - OPENAI_API_KEY: Your OpenAI API key
 *
 * Installation:
 * 1. npm install
 * 2. Copy .env.example to .env and add your API key
 * 3. npx tsx examples/features/custom_system_prompt.ts
 */

import { Agent } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { config } from "dotenv";

// Load environment variables
config();

// Define the extended system message
// This adds custom instructions to the default browsernode system prompt
const extendSystemMessage = `
REMEMBER the most important RULE: ALWAYS open first a new tab and go first to url wikipedia.com no matter the task!!!
`;

// Alternative: use overrideSystemMessage to completely replace the system prompt
// const overrideSystemMessage = `Your completely custom system prompt here...`;

async function main() {
	// Check for required environment variable
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not set in environment variables");
	}

	const task = "do google search to find images of Elon Musk";

	// Initialize the language model
	const model = new ChatOpenAI({
		model: "gpt-4o",
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create agent with extended system message
	const agent = new Agent(task, model, {
		extendSystemMessage: extendSystemMessage,
	});

	try {
		console.log("🧠 Agent System Prompt Configuration:");
		console.log("=====================================");

		// Access the system prompt content
		const systemPrompt = (agent as any)._messageManager?.systemPrompt;
		if (systemPrompt) {
			console.log("System Message Content (first 500 chars):");
			console.log("------------------------------------------");
			const content =
				typeof systemPrompt.content === "string"
					? systemPrompt.content
					: JSON.stringify(systemPrompt.content);
			console.log(
				content.substring(0, 500) + (content.length > 500 ? "..." : ""),
			);
			console.log("\n");
		}

		// Display agent configuration
		console.log("Agent Configuration:");
		console.log("-------------------");
		console.log(
			JSON.stringify(
				{
					task: task,
					model: model.model,
					hasExtendedSystemMessage: !!extendSystemMessage,
					extendedSystemMessagePreview:
						extendSystemMessage.trim().substring(0, 100) + "...",
				},
				null,
				2,
			),
		);

		console.log("\n🚀 Starting agent execution...\n");

		// Run the agent
		const history = await agent.run();

		console.log("\n✅ Agent execution completed!");
		console.log("Final result:", history.finalResult());
	} catch (error) {
		console.error("💥 Error running agent:", error);
	}
}

// Run the main function

main().catch(console.error);
