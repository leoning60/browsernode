/**
 * Example of using LangChain models with browsernode.
 *
 * This example demonstrates how to:
 * 1. Wrap a LangChain model with ChatLangchain
 * 2. Use it with a browsernode Agent
 * 3. Run a simple web automation task
 *
 * @file purpose: Example usage of LangChain integration with browsernode
 */

import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";
import { ChatLangchain } from "./chat";

async function main(): Promise<void> {
	/**Basic example using ChatLangchain with OpenAI through LangChain.*/

	// Create a LangChain model (OpenAI)
	const langchainModel = new ChatOpenAI({
		model: "gpt-4o-mini",
		temperature: 0.1,
	});

	// Wrap it with ChatLangchain to make it compatible with browsernode
	const llm = new ChatLangchain(langchainModel);

	// Create a simple task
	const task = "Go to https://search.brave.com and search tesla stock price";

	// Create and run the agent
	const agent = new Agent({
		task: task,
		llm: llm,
	});

	console.log(`🚀 Starting task: ${task}`);
	console.log(`🤖 Using model: ${llm.name} (provider: ${llm.provider})`);

	// Run the agent
	const history = await agent.run();

	console.log(`✅ Task completed! Steps taken: ${history.history.length}`);

	// Print the final result if available
	const finalResult = history.finalResult();
	if (finalResult) {
		console.log(`📋 Final result: ${finalResult}`);
	}

	return;
}

console.log("🌐 Browsernode LangChain Integration Example");
console.log("=".repeat(44));

main().catch(console.error);
