import { Agent } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

const llm = new ChatOpenAI({
	model: "gpt-4.1",
	temperature: 0.0,
	apiKey: process.env.OPENAI_API_KEY,
});

const task = "Compare the price of gpt-4o and k2";
const agent = new Agent({
	task: task,
	llm: llm,
});
const history = await agent.run();
console.log(history.usage);
