import { ChatAnthropic } from "@langchain/anthropic";
import { Agent } from "browsernode";

async function runAgent(task: string, max_steps: number = 38) {
	const llm = new ChatAnthropic({
		modelName: "claude-3-5-sonnet-20240620",
		temperature: 0.0,
		anthropicApiKey: process.env.ANTHROPIC_API_KEY,
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
