import { Agent, Controller } from "browsernode";
import { BrowserProfile } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";

async function main() {
	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Initialize controller
	const controller = new Controller();

	// Initial task - more specific
	const task = `
		Find the founders of tesla and draft them a short personalized message.
	`;

	// Create and run the agent
	const agent = new Agent({
		task: task,
		llm: llm,
		controller: controller,
		browserProfile: new BrowserProfile({
			executablePath:
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			keepAlive: false, // Close the browser after the task is completed
			userDataDir: "~/.config/browsernode/profiles/default",
		}),
		maxFailures: 2, // Reduce failures to avoid infinite loops
	});

	console.log("🚀 Starting initial task...");
	try {
		await agent.run(15); // Limit to 15 steps for initial task
		console.log("✅ Initial task completed!");
	} catch (error) {
		console.error("❌ Initial task failed:", error);
	}

	// Add a new follow-up task - more specific and actionable
	console.log("🔄 Adding follow-up task...");
	const newTask = `
		Find ONE official photo of the spaceX founders online.
		When you locate it, describe what you see and mark the task as successful.
	`;

	agent.addNewTask(newTask);

	console.log("🚀 Starting follow-up task...");
	try {
		await agent.run(10); // Limit to 10 steps for follow-up task
		console.log("✅ Follow-up task completed!");
	} catch (error) {
		console.error("❌ Follow-up task failed:", error);
	} finally {
		// Close the browser
		if (agent.browserSession) {
			await agent.browserSession.kill();
			console.log("🔒 Browser closed");
		}
	}

	console.log("🎯 All tasks completed!");
}

// Run the main function
main().catch(console.error);
