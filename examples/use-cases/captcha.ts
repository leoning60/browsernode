import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

import * as readline from "readline";

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

async function runAgent(task: string, max_steps: number = 38) {
	const llm = new ChatOpenAI({
		modelName: "gpt-4o",
		temperature: 0.0,
		streaming: true,
		openAIApiKey: process.env.OPENAI_API_KEY,
	});
	const agent = new Agent(task, llm, { useVision: true });
	await agent.run(max_steps);
	// 等待用户按下回车键
	rl.question("Press Enter to exit", () => {
		rl.close();
		// 程序继续执行并退出
	});
}

const task =
	"go to https://captcha.com/demos/features/captcha-demo.aspx and solve the captcha";
await runAgent(task);
