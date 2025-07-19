import { Agent } from "browsernode";
import { ChatAnthropic } from "browsernode";
import { config } from "dotenv";

// @dev You need to add ANTHROPIC_API_KEY to your environment variables.
config();

const llm = new ChatAnthropic({
	model: "claude-4-sonnet-20250514",
	temperature: 0.0,
	apiKey: process.env.ANTHROPIC_API_KEY,
});

const task =
	"Go to amazon.com, search for laptop, sort by best rating, and give me the price of the first result";
// const task = "Search for the nvidia stock price ";

const agent = new Agent(task, llm);

async function main() {
	console.log("---claude-4-sonnet.ts agent run---");
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
