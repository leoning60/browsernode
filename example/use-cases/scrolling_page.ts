import { Agent, Browser, BrowserConfig } from "browser-node";

import { ChatOpenAI } from "@langchain/openai";

const llm = new ChatOpenAI({
	modelName: "gpt-4o-mini",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENAI_API_KEY,
	configuration: {
		baseURL: "https://openrouter.ai/api/v1", //if you want to use openrouter.ai, you can set the baseURL to the openrouter.ai API URL
		defaultHeaders: {
			"HTTP-Referer": null, // Optional. Site URL for rankings on openrouter.ai.
			"X-Title": null, // Optional. Site title for rankings on openrouter.ai.
		},
	},
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
