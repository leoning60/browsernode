import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

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
	const agent = new Agent(task, llm);
	const result = await agent.run(max_steps);
	return result;
}

if (require.main === module) {
	const task =
		"Go to https://www.google.com and search for 'node.js' and click on the first result";
	const result = await runAgent(task);
	console.log("eval/gpt-4o.ts result:", JSON.stringify(result, null, 2));
}
