import { Agent } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

const llm = new ChatOpenAI({
	model: "gpt-4.1",
	temperature: 0.0,
	apiKey: process.env.OPENAI_API_KEY,
});

const task = "Search for the latest tesla stock price";
// const task = "Go to example.com, click on the first link, and give me the title of the page";
const agent = new Agent({
	task: task,
	llm: llm,
});
console.log("---simple.ts agent run---");
const history = await agent.run();
console.log(history.usage);
