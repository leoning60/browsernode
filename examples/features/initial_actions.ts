import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

const initialActions = [
	{ openTab: { url: "https://search.brave.com" } },
	{
		openTab: {
			url: "https://www.anthropic.com/engineering/building-effective-agents",
		},
	},
	{ scrollDown: { amount: 5000 } },
];

const llm = new ChatOpenAI({
	modelName: "gpt-4o-mini",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENAI_API_KEY,
});

const task = "What theories are displayed on the page?";
const agent = new Agent(task, llm, { initialActions: initialActions });
console.log("---initial_actions.ts agent run---");
agent.run();
