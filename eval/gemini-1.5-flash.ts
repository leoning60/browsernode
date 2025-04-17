import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Agent } from "browser-node";

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
	throw new Error("GOOGLE_API_KEY is not set");
}

async function runAgent(task: string, max_steps: number = 38) {
	const llm = new ChatGoogleGenerativeAI({
		modelName: "gemini-1.5-flash",
		temperature: 0.0,
		googleApiKey: apiKey,
	});
	const agent = new Agent(task, llm);
	const result = await agent.run(max_steps);
	return result;
}

if (require.main === module) {
	const task =
		"Go to https://www.google.com and search for 'node.js' and click on the first result";
	const result = await runAgent(task);
	console.log(
		"eval/gemini-1.5-flash.ts result:",
		JSON.stringify(result, null, 2),
	);
}
