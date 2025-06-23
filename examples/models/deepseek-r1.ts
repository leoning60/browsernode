import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

const llm = new ChatOpenAI({
	modelName: "deepseek-reasoner",
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
});
console.log("---deepseek-r1.ts agent run---");
agent.run();
