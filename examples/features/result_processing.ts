import { ChatOpenAI } from "@langchain/openai";
import {
	Agent,
	AgentHistoryList,
	Browser,
	BrowserConfig,
	BrowserContextConfig,
} from "browsernode";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
	throw new Error("OPENAI_API_KEY is not set");
}

async function runAgent(task: string, max_steps: number = 38) {
	const browser = new Browser(
		new BrowserConfig({
			headless: false,
			disableSecurity: true,
			extraBrowserArgs: ["--window-size=2000,2000"],
		}),
	);
	const context = await browser.newContext(
		new BrowserContextConfig({
			tracePath: "./tmp/result_processing/",
			noViewport: false,
			browserWindowSize: { width: 1280, height: 1000 },
		}),
	);
	const llm = new ChatOpenAI({
		modelName: "gpt-4o",
		temperature: 0.0,
		openAIApiKey: apiKey,
	});
	try {
		const agent = new Agent(task, llm, { browserContext: context });
		const history: AgentHistoryList = await agent.run(max_steps);
		console.log("Final Result:");
		console.log(JSON.stringify(history.finalResult(), null, 4));

		console.log("\nErrors:");
		console.log(JSON.stringify(history.errors(), null, 4));

		// e.g. xPaths the model clicked on
		console.log("\nModel Outputs:");
		console.log(JSON.stringify(history.modelActions(), null, 4));

		console.log("\nThoughts:");
		console.log(JSON.stringify(history.modelThoughts(), null, 4));
	} finally {
		await context.close();
		await browser.close();
	}
}

async function main() {
	const task =
		"Go to https://search.brave.com and search for tesla stock price";
	const result = await runAgent(task);
	// console.log(
	// 	"example/features/result_processing.ts result:",
	// 	JSON.stringify(result, null, 2),
	// );
}

main();
