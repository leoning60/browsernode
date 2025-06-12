import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

async function runAgent(task: string, max_steps: number = 38) {
	const llm = new ChatOpenAI({
		modelName: "gpt-4o",
		temperature: 0.0,
		openAIApiKey: process.env.OPENAI_API_KEY,
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
