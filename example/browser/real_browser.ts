import { ChatOpenAI } from "@langchain/openai";
import {
	Agent,
	Browser,
	BrowserConfig,
	BrowserContextConfig,
} from "browsernode";

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
		new BrowserConfig({
			browserInstancePath:
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			extraBrowserArgs: [
				"--user-data-dir=/tmp/chrome-browsernode-real",
				"--no-first-run",
				"--disable-default-apps",
			],
		}),
	);
	const agent = new Agent(task, llm, { browser });
	const result = await agent.run(max_steps);
	return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const task = "Go to https://www.google.com and search for 'node.js'";
	const result = await runAgent(task);
	console.log("real_browser.ts result:", JSON.stringify(result, null, 2));
}
