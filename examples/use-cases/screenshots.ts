import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";
import { saveScreenshots } from "../utils/save_screenshots";

function getCurrentDirPath() {
	const __filename = fileURLToPath(import.meta.url);
	return dirname(__filename);
}

console.log("getCurrentDirPath:", getCurrentDirPath());

const llm = new ChatOpenAI({
	modelName: "gpt-4o-mini",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENAI_API_KEY,
});

const task =
	"use http://search.brave.com/ to search for the latest tesla stock price";
const agent = new Agent(task, llm);
console.log("--- screenshots.ts agent run---");
const history = await agent.run();

const screenshots = history.screenshots();

saveScreenshots(screenshots, getCurrentDirPath());
// console.log("history.screenshots:", screenshots);
