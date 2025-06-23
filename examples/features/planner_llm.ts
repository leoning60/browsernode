import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

const llm = new ChatOpenAI({
	modelName: "gpt-4o-mini",
	temperature: 0.0,
	openAIApiKey: process.env.OPENAI_API_KEY,
});

const planner_llm = new ChatOpenAI({
	modelName: "o3-mini",
	openAIApiKey: process.env.OPENAI_API_KEY,
});

const task = "Go to https://search.brave.com and search for tesla stock price";
const agent = new Agent(task, llm, {
	plannerLLM: planner_llm,
	useVisionForPlanner: false,
	plannerInterval: 4,
});
console.log("---planner_llm.ts agent run---");
agent.run();
