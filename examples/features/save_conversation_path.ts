import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

const llm = new ChatOpenAI({
	modelName: "gpt-4o",
	temperature: 0.0,
	streaming: true,
	openAIApiKey: process.env.OPENAI_API_KEY,
});

const task =
	"go to https://search.brave.com/ and search for the latest tesla stock price";
const agent = new Agent(task, llm, {
	saveConversationPath: "logs/conversation",
});
console.log("---save_conversation_path.ts agent run---");
agent.run();
