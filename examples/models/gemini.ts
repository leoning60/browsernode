import { Agent } from "browsernode";
import { ChatGoogle } from "browsernode/llm";

// @dev You need to add GEMINI_API_KEY to your environment variables.
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
	throw new Error("GOOGLE_API_KEY is not set");
}

const llm = new ChatGoogle({
	model: "gemini-2.5-flash",
	temperature: 0.0,
	apiKey: process.env.GEMINI_API_KEY,
});

// const task = "Go to search.brave.com, search for 'gemini'";
const task = "Go to search.brave.com, search for 'google stock price'";
const agent = new Agent({
	task: task,
	llm: llm,
});

async function main() {
	console.log("---gemini.ts agent run---");
	const history = await agent.run(25);
	console.log(history.usage);

	// Wait for user input before continuing
	console.log("Press Enter to continue...");
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("data", () => {
		process.exit(0);
	});
}

main().catch(console.error);
