import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

const llm = new ChatOpenAI({
	modelName: "google/gemini-2.5-flash-preview-05-20",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENROUTER_API_KEY,
	configuration: {
		baseURL: "https://openrouter.ai/api/v1",
		defaultHeaders: {
			"HTTP-Referer": null, // Optional. Site URL for rankings on openrouter.ai.
			"X-Title": null, // Optional. Site title for rankings on openrouter.ai.
		},
	},
});

const task =
	"Go to https://search.brave.com/ and Search for the latest tesla stock price";
const agent = new Agent(task, llm);
console.log("---gemini_openrouter.ts agent run---");
agent.run();
