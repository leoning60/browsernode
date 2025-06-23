import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

const llm = new ChatOpenAI({
	modelName: "gpt-4o",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENAI_API_KEY,
});

const task = "Search for the latest tesla stock price";
const agent = new Agent(task, llm);
console.log("--- history.ts agent run---");
const history = await agent.run();
console.log("history:", JSON.stringify(history, null, 4));
