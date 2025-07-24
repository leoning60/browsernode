import { Agent } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

const llm = new ChatOpenAI({
	model: "gpt-4.1",
	temperature: 0.0,
	apiKey: process.env.OPENAI_API_KEY,
});

const task = "Compare the price of gpt-4o and DeepSeek-V3";
const agent = new Agent(task, llm);
const history = await agent.run();
console.log(history.usage);
