import { ChatOpenAI } from "@langchain/openai";
import { Agent, Browser, BrowserContextConfig } from "browsernode";

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

	// Create a browser instance first, then create a context from it
	const browser = new Browser();
	const context = await browser.newContext(
		new BrowserContextConfig({
			tracePath: "./tmp/traces/",
		}),
	);

	try {
		const agent = new Agent(task, llm, { browserContext: context });
		const result = await agent.run(max_steps);
		return result;
	} finally {
		// Make sure to close the context and browser when done
		await context.close();
		await browser.close();
	}
}

if (require.main === module) {
	const task = "NVIDIA stock price";
	const result = await runAgent(task);
	console.log(
		"example/features/save_trace.ts result:",
		JSON.stringify(result, null, 2),
	);
}
