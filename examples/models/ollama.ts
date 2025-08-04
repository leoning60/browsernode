import { Agent } from "browsernode";
import { ChatOllama } from "browsernode/llm";

const llm = new ChatOllama({
	model: "qwen3:32b",
	host: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
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
