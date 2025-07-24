/**
 * Goal: Implements a multi-agent system for online code editors, with separate agents for coding and execution.
 *
 * This example demonstrates how to use browsernode to coordinate multiple agents:
 * 1. Agent1: Opens an online code editor (Programiz)
 * 2. Coder: Writes and completes code (simple calculator)
 * 3. Executor: Executes the code and suggests updates if there are errors
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import { Agent, BrowserSession } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

// Check required environment variables
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

async function main() {
	const browserSession = new BrowserSession();

	try {
		await browserSession.start();

		const model = new ChatOpenAI({
			model: "gpt-4o",
			apiKey: process.env.OPENAI_API_KEY!,
		});

		console.log("🚀 Starting multi-agent code editor system...");

		// Initialize browser agent to open the online code editor
		const agent1 = new Agent("Open an online code editor programiz.", model, {
			browserSession: browserSession,
		});

		// Executor agent - executes code and provides feedback
		const executor = new Agent(
			"Executor. Execute the code written by the coder and suggest some updates if there are errors.",
			model,
			{
				browserSession: browserSession,
			},
		);

		// Coder agent - writes the code
		const coder = new Agent(
			"Coder. Your job is to write and complete code. You are an expert coder. Code a simple calculator. Write the code on the coding interface after agent1 has opened the link.",
			model,
			{
				browserSession: browserSession,
			},
		);

		// Execute agents in sequence
		console.log("🌐 Agent1: Opening online code editor...");
		const agent1Result = await agent1.run();
		console.log("✅ Agent1 completed:", agent1Result);

		console.log("💻 Coder: Writing calculator code...");
		const coderResult = await coder.run();
		console.log("✅ Coder completed:", coderResult);

		console.log("⚡ Executor: Executing code and providing feedback...");
		const executorResult = await executor.run();
		console.log("✅ Executor completed:", executorResult);

		console.log("🎉 Multi-agent system completed successfully!");
	} catch (error) {
		console.error("❌ Error during multi-agent execution:", error);
	} finally {
		// Clean up browser session
		await browserSession.close();
		console.log("🧹 Browser session closed");
	}
}

// Run the main function
main().catch(console.error);
