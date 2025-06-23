import { Agent, Browser, BrowserConfig } from "browsernode";

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { BrowserContextConfig } from "../../src/browser/context";
import { saveScreenshots } from "../utils/save_screenshots";

const llm = new ChatOpenAI({
	modelName: "gpt-4o-mini",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENAI_API_KEY,
});

const task =
	"go to https://en.wikipedia.org/wiki/Banana and click on buttons on the wikipedia page to go as fast as possible from banna to Quantum mechanics";
const max_steps = 20;
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

function getCurrentDirPath() {
	const __filename = fileURLToPath(import.meta.url);
	return dirname(__filename);
}

async function main() {
	const history = await agent.run(max_steps);
	console.log("Task completed successfully!");
	saveScreenshots(history.screenshots(), getCurrentDirPath());
	console.log("Screenshots saved successfully!");
}

main().catch(console.error);
