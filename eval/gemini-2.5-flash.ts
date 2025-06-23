import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Agent } from "browsernode";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
	throw new Error("GEMINI_API_KEY is not set");
}
const llm = new ChatGoogleGenerativeAI({
	model: "models/gemini-2.5-flash-preview-05-20",
	temperature: 0.0,
	apiKey: process.env.GEMINI_API_KEY,
});

async function main(max_steps: number = 38) {
	// const task ="Go to https://search.brave.com/ and search for nvidia stock price";
	const task =
		"go to https://en.wikipedia.org/wiki/Banana and click on buttons on the wikipedia page to go as fast as possible from banna to Quantum mechanics";
	// const agent = new Agent(task, llm, {
	// 	toolCallingMethod: "raw",
	// });
	const agent = new Agent(task, llm);

	const history = await agent.run(max_steps);
	// console.log(
	// 	"eval/gemini-2.5-flash.ts result:",
	// 	JSON.stringify(history, null, 2),
	// );
}

main().catch(console.error);
