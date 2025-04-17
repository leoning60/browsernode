import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browser-node";

const llm = new ChatOpenAI({
	modelName: "gpt-4o-mini",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENAI_API_KEY,
	configuration: {
		baseURL: "https://openrouter.ai/api/v1",
		defaultHeaders: {
			"HTTP-Referer": null, // Optional. Site URL for rankings on openrouter.ai.
			"X-Title": null, // Optional. Site title for rankings on openrouter.ai.
		},
	},
});

const task = "Search for the latest tesla stock price";
const agent = new Agent(task, llm);
console.log("---simple.ts agent run---");
agent.run();
