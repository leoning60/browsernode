import { Agent, Browser, BrowserConfig } from "browsernode";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { BrowserContextConfig } from "../../src/browser/context";

const llm = new ChatOpenAI({
	modelName: "gpt-4o",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENAI_API_KEY,
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
