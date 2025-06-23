import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

const llm = new ChatOpenAI({
	modelName: "deepseek-chat",
	temperature: 0.0,
	streaming: false,
	openAIApiKey: process.env.DEEPSEEK_API_KEY,
	configuration: {
		baseURL: "https://api.deepseek.com",
	},
});

const task =
	"use http://search.brave.com/ to search for the latest tesla stock price";
const agent = new Agent(task, llm, {
	useVision: false, // DeepSeek does not support vision
	// Note: DeepSeek models automatically use "raw" tool calling mode
	// instead of function calling to ensure compatibility
});
console.log("---deepseek.ts agent run---");
agent.run();
