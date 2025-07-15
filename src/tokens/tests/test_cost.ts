/**
 * Simple test for token cost tracking with real LLM calls.
 *
 * Tests ChatOpenAI and ChatGoogle by iteratively generating countries.
 */

import { config } from "dotenv";
import { createLogger, format, transports } from "winston";
import {
	type BaseMessage,
	createAssistantMessage,
	createSystemMessage,
	createUserMessage,
} from "../../llm/messages";
import { ChatOpenAI } from "../../llm/openai/chat";
import type { ChatInvokeUsage } from "../../llm/views";
import { TokenCost } from "../service";

config();

const logger = createLogger({
	level: "info",
	format: format.simple(),
	transports: [new transports.Console()],
});

async function testMockTokenCostTracking(): Promise<void> {
	/**
	 * Test token cost tracking with mock data (no API calls required)
	 */

	console.log("\n🔧 Mock Token Cost Tracking Test");
	console.log("=".repeat(80));

	// Initialize token cost service
	const tokenCost = new TokenCost(true); // Enable cost calculation
	await tokenCost.initialize();

	// Simulate different model usages
	const mockUsages = [
		{
			model: "gpt-4",
			usage: {
				promptTokens: 150,
				completionTokens: 50,
				totalTokens: 200,
				promptCachedTokens: null,
				promptCacheCreationTokens: null,
				promptImageTokens: null,
			} as ChatInvokeUsage,
		},
		{
			model: "gpt-4",
			usage: {
				promptTokens: 200,
				completionTokens: 75,
				totalTokens: 275,
				promptCachedTokens: null,
				promptCacheCreationTokens: null,
				promptImageTokens: null,
			} as ChatInvokeUsage,
		},
		{
			model: "claude-3-sonnet",
			usage: {
				promptTokens: 180,
				completionTokens: 60,
				totalTokens: 240,
				promptCachedTokens: 50,
				promptCacheCreationTokens: null,
				promptImageTokens: null,
			} as ChatInvokeUsage,
		},
	];

	console.log("\n📝 Adding mock usage entries:");
	for (const mockUsage of mockUsages) {
		const entry = tokenCost.addUsage(mockUsage.model, mockUsage.usage);
		console.log(
			`  Added: ${mockUsage.model} - ${mockUsage.usage.promptTokens} prompt + ${mockUsage.usage.completionTokens} completion tokens`,
		);
	}

	// Display cost summary
	console.log("\n💰 Cost Summary");
	console.log("=".repeat(80));

	const summary = await tokenCost.getUsageSummary();
	console.log(`Total calls: ${summary.entryCount}`);
	console.log(`Total tokens: ${summary.totalTokens.toLocaleString()}`);
	console.log(`Total cost: $${summary.totalCost.toFixed(6)}`);

	console.log("\n📊 Cost breakdown by model:");
	for (const [model, stats] of Object.entries(summary.byModel)) {
		console.log(`\n${model}:`);
		console.log(`  Calls: ${stats.invocations}`);
		console.log(`  Prompt tokens: ${stats.promptTokens.toLocaleString()}`);
		console.log(
			`  Completion tokens: ${stats.completionTokens.toLocaleString()}`,
		);
		console.log(`  Total tokens: ${stats.totalTokens.toLocaleString()}`);
		console.log(`  Cost: $${stats.cost.toFixed(6)}`);
		console.log(
			`  Average tokens per call: ${stats.averageTokensPerInvocation.toFixed(1)}`,
		);
	}
}

async function testIterativeCountryGeneration(): Promise<void> {
	/**
	 * Test token cost tracking with iterative country generation
	 */

	// Check if API key is available
	if (!process.env.OPENAI_API_KEY) {
		console.log("\n⚠️  OPENAI_API_KEY not found. Running mock test instead.");
		await testMockTokenCostTracking();
		return;
	}

	// Initialize token cost service
	const tokenCost = new TokenCost();
	await tokenCost.initialize();

	// System prompt that explains the iterative task
	const systemPrompt = `You are a country name generator. When asked, you will provide exactly ONE country name and nothing else.
Each time you're asked to continue, provide the next country name that hasn't been mentioned yet.
Keep track of which countries you've already said and don't repeat them.
Only output the country name, no numbers, no punctuation, just the name.`;

	// Test with different models - add a dummy API key for testing
	const models = [
		new ChatOpenAI({
			model: "gpt-4",
			apiKey: process.env.OPENAI_API_KEY || "test-key-for-demo",
		}),
		// new ChatGoogle({ model: 'gemini-2.0-flash-exp' }),
	];

	console.log("\n🌍 Iterative Country Generation Test");
	console.log("=".repeat(80));

	for (const llm of models) {
		console.log(`\n📍 Testing ${llm.modelName}`);
		console.log("-".repeat(60));

		// Register the LLM for automatic tracking
		tokenCost.registerLLM(llm);

		// Initialize conversation
		const messages: BaseMessage[] = [
			createSystemMessage(systemPrompt),
			createUserMessage("Give me a country name"),
		];

		const countries: string[] = [];

		// Generate 10 countries iteratively
		for (let i = 0; i < 10; i++) {
			// Call the LLM
			const result = await llm.ainvoke(messages);
			const country = result.completion.trim();
			countries.push(country);

			// Add the response to messages
			messages.push(createAssistantMessage(country));

			// Add the next request (except for the last iteration)
			if (i < 9) {
				messages.push(createUserMessage("Next country please"));
			}

			console.log(`  Country ${i + 1}: ${country}`);
		}

		console.log(`\n  Generated countries: ${countries.join(", ")}`);
	}

	// Display cost summary
	console.log("\n💰 Cost Summary");
	console.log("=".repeat(80));

	const summary = await tokenCost.getUsageSummary();
	console.log(`Total calls: ${summary.entryCount}`);
	console.log(`Total tokens: ${summary.totalTokens.toLocaleString()}`);
	console.log(`Total cost: $${summary.totalCost.toFixed(6)}`);

	console.log("\n📊 Cost breakdown by model:");
	for (const [model, stats] of Object.entries(summary.byModel)) {
		console.log(`\n${model}:`);
		console.log(`  Calls: ${stats.invocations}`);
		console.log(`  Prompt tokens: ${stats.promptTokens.toLocaleString()}`);
		console.log(
			`  Completion tokens: ${stats.completionTokens.toLocaleString()}`,
		);
		console.log(`  Total tokens: ${stats.totalTokens.toLocaleString()}`);
		console.log(`  Cost: $${stats.cost.toFixed(6)}`);
		console.log(
			`  Average tokens per call: ${stats.averageTokensPerInvocation.toFixed(1)}`,
		);
	}
}

// Run the test if this file is executed directly
// if (import.meta.url === `file://${process.argv[1]}`) {
// 	testIterativeCountryGeneration().catch(console.error);
// }

testIterativeCountryGeneration().catch(console.error);
export { testIterativeCountryGeneration, testMockTokenCostTracking };
