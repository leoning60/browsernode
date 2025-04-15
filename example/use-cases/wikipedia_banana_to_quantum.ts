import { Agent, Browser, BrowserConfig } from "browser-node";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { BrowserContextConfig } from "../../src/browser/context";

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
	"go to https://en.wikipedia.org/wiki/Banana and click on buttons on the wikipedia page to go as fast as possible from banna to Quantum mechanics";
const max_steps = 10;
const agent = new Agent(task, llm, {
	browser: new Browser(
		new BrowserConfig({
			newContextConfig: new BrowserContextConfig({
				highlightElements: false,
				viewportExpansion: -1,
			}),
		}),
	),
	useVision: true,
});

await agent.run(max_steps);
