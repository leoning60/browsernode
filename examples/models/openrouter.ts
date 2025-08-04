import { Agent } from "browsernode";
import { ChatOpenRouter } from "browsernode/llm";

// @dev You need to add OPENAI_API_KEY to your environment variables.

const llm = new ChatOpenRouter({
	model: "google/gemini-2.5-flash",
	temperature: 0.0,
	apiKey: process.env.OPENROUTER_API_KEY,
	baseUrl: process.env.OPENROUTER_BASE_URL,
});

const task =
	"Go to example.com, click on the first link, and give me the title of the page";
const agent = new Agent({
	task: task,
	llm: llm,
});

async function main() {
	console.log("---openrouter agent run---");
	const history = await agent.run(10);
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
