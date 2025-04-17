import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browser-node";

async function runAgent(task: string, max_steps: number = 38) {
	const llm = new ChatOpenAI({
		modelName: "gpt-4o-mini",
		temperature: 0.0,
		openAIApiKey: process.env.OPENAI_API_KEY,
		configuration: {
			baseURL: "https://openrouter.ai/api/v1", //if you want to use openrouter.ai, you can set the baseURL to the openrouter.ai API URL
			defaultHeaders: {
				"HTTP-Referer": null, // Optional. Site URL for rankings on openrouter.ai.
				"X-Title": null, // Optional. Site title for rankings on openrouter.ai.
			},
		},
	});
	const agent = new Agent(task, llm, {
		useVision: false,
	});
	const result = await agent.run(max_steps);
	return result;
}

if (require.main === module) {
	const task =
		"Go to https://www.google.com and search for 'node.js' and click on the first result";
	const result = await runAgent(task);
	console.log(
		"eval/gpt-4o-no-vision.ts result:",
		JSON.stringify(result, null, 2),
	);
}
