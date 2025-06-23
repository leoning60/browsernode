import { ChatOpenAI } from "@langchain/openai";
import { Agent } from "browsernode";

// Initialize the model

const llm = new ChatOpenAI({
	modelName: "deepseek-reasoner",
	temperature: 0.0,
	streaming: false,
	openAIApiKey: process.env.DEEPSEEK_API_KEY,
	configuration: {
		baseURL: "https://api.deepseek.com",
	},
});

// Define sensitive data
// The model will only see the keys (x_name, x_password) but never the actual values
const sensitiveData = { x_name: "magnus", x_password: "12345678" };

// wrong task prompt,too simple
// const wrong_task_prompt ="go to x.com and login with x_name and x_password then write a post about the meaning of life";

// Use a more detailed task description for X.com's multi-step login
const task = `Go to x.com and complete the login process:
1. Click on "Sign in" if needed
2. Look for the username/email/phone input field and enter x_name
3. Click the "Next" button to proceed
4. Wait for the password field to appear, then enter x_password
5. Click the final "Log in" button
6. Once logged in, write a post about the meaning of life`;

// Pass the sensitive data to the agent
const agent = new Agent(task, llm, {
	sensitiveData: sensitiveData,
	maxActionsPerStep: 1, // Execute one action at a time for better control
	toolCallingMethod: "raw", // Force raw mode for DeepSeek compatibility
	useVision: false, // DeepSeek does not support vision
});

// Debug logging
console.log("Agent model name:", agent.modelName);
console.log("Agent chat model library:", agent.chatModelLibrary);
console.log("Agent toolCallingMethod:", agent.toolCallingMethod);

await agent.run();
