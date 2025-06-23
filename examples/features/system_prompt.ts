import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

const extend_system_message = `
REMEMBER the most important RULE:
ALWAYS open first a new tab and go first to url wikipedia.com no matter the task!!!
`;

const task = "after open 3 tabs, end the task";
const model = new ChatOpenAI({
	modelName: "gpt-4o",
	apiKey: process.env.OPENAI_API_KEY,
});

// Create agent with extended system prompt
const agent = new Agent(task, model, {
	extendSystemMessage: extend_system_message,
});
agent.run();
