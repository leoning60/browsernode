import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

const llm = new ChatOpenAI({
	modelName: "gpt-4o",
	temperature: 0.0,
	streaming: false,
	openAIApiKey: process.env.AZURE_OPENAI_KEY,
	configuration: {
		baseURL: process.env.AZURE_OPENAI_ENDPOINT,
	},
});

const task =
	"use http://search.brave.com/ to search for the latest tesla stock price";
const agent = new Agent(task, llm);
console.log("---azure_openai.ts agent run---");
agent.run();
