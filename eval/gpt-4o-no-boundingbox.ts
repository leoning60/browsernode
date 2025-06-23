import { ChatOpenAI } from "@langchain/openai";
import { Agent, Browser, BrowserConfig } from "browsernode";
import { BrowserContextConfig } from "../src/browser/context";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
	throw new Error("OPENAI_API_KEY is not set");
}

async function runAgent(task: string, max_steps: number = 38) {
	const llm = new ChatOpenAI({
		modelName: "gpt-4o",
		temperature: 0.0,
		openAIApiKey: apiKey,
	});
	const browser = new Browser(
		new BrowserConfig(
			new BrowserContextConfig({
				highlightElements: false,
			}),
		),
	);
	const agent = new Agent(task, llm, { browser });
	const result = await agent.run(max_steps);
	return result;
}

async function main() {
	const task =
		"Go to https://www.google.com and search for 'node.js' and click on the first result";
	const result = await runAgent(task);
	console.log(
		"eval/gpt-4o-no-boundingbox.ts result:",
		JSON.stringify(result, null, 2),
	);
}

main().catch(console.error);
