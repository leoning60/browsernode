import { ChatOpenAI } from "@langchain/openai";
import { AgentOutput } from "../../../src/agent/views";
import { ActionModel } from "../../../src/controller/registry/views";
import { ChatLangchain } from "./chat";

async function testLangChainIntegration() {
	console.log("Testing LangChain integration fix...\n");

	// Create a LangChain model
	const langchainModel = new ChatOpenAI({
		modelName: "gpt-4o-mini",
		temperature: 0.1,
		openAIApiKey: process.env.OPENAI_API_KEY,
	});

	// Wrap it with ChatLangchain
	const wrappedModel = new ChatLangchain(langchainModel);

	// Create a simple ActionModel for testing
	const testActionModel = {
		click: { index: 0 },
		wait: { seconds: 1 },
		done: { success: false, text: "Test" },
	} as ActionModel;

	// Create CustomAgentOutput class
	const CustomAgentOutput = AgentOutput.typeWithCustomActions(testActionModel);

	// Test messages
	const testMessages = [
		{
			role: "system" as const,
			content: "You are a helpful assistant that outputs structured data.",
		},
		{
			role: "user" as const,
			content:
				"Please click on the first element. Return your response in the required JSON format with evaluationPreviousGoal, memory, nextGoal, and action fields.",
		},
	];

	try {
		console.log("Attempting to invoke with CustomAgentOutput...");
		const result = await wrappedModel.ainvoke(testMessages, CustomAgentOutput);
		console.log("✅ Success! Result:", JSON.stringify(result, null, 2));
	} catch (error) {
		console.error("❌ Error:", error);
		console.error("\nFull error details:", JSON.stringify(error, null, 2));
	}
}

// Run the test
testLangChainIntegration().catch(console.error);
