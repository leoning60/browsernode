import { Agent } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { config } from "dotenv";

config();

const llm = new ChatOpenAI({
	model: "gpt-4.1-mini",
	temperature: 0.0,
	apiKey: process.env.OPENAI_API_KEY,
});

const task = "Search for the latest tesla stock price";
// const task = "Go to example.com, click on the first link, and give me the title of the page";
const agent = new Agent(task, llm);
console.log("---simple.ts agent run---");
const history = await agent.run();
console.log(history.usage);
