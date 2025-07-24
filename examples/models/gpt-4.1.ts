import { Agent } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

// @dev You need to add OPENAI_API_KEY to your environment variables.

const llm = new ChatOpenAI({
	model: "gpt-4.1-mini",
	temperature: 0.0,
	apiKey: process.env.OPENAI_API_KEY,
});

const task =
	"Go to example.com, click on the first link, and give me the title of the page";
const agent = new Agent(task, llm);

async function main() {
	console.log("---gpt-4.1.ts agent run---");
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
