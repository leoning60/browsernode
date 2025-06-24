import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

const llm = new ChatOpenAI({
	modelName: "gpt-4o-mini",
	temperature: 0.0,
	openAIApiKey: process.env.OPENAI_API_KEY,
});

const task = "Search for the latest tesla stock price";
const agent = new Agent(task, llm);
console.log("---example.ts agent run---");
agent.run();
