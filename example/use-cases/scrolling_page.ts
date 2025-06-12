import { Agent, Browser, BrowserConfig } from "browsernode";

import { ChatOpenAI } from "@langchain/openai";

const llm = new ChatOpenAI({
	modelName: "gpt-4o",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENAI_API_KEY,
});

const task =
	"Navigate to 'https://en.wikipedia.org/wiki/Internet' and scroll to the string 'The vast majority of computer'";
const max_steps = 10;
const agent = new Agent(task, llm, {
	browser: new Browser(
		new BrowserConfig({
			headless: false,
		}),
	),
});

await agent.run(max_steps);
