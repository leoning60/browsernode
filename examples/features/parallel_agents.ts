/**
 * Show how to run multiple agents in parallel with the same browser session.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import * as path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { Agent } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";

async function main() {
	// Get the directory where this script is located
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);

	// Create browser profile with recording and user data directory
	const browserProfile = new BrowserProfile({
		keepAlive: true,
		headless: false,
		recordVideoDir: path.join(__dirname, "tmp", "recordings"),
		userDataDir: path.join(
			process.env.HOME || "",
			".config",
			"browsernode",
			"profiles",
			"default",
		),
	});

	// Create browser session
	const browserSession = new BrowserSession({
		browserProfile: browserProfile,
	});

	// Start the browser session
	await browserSession.start();

	// Create LLM instance
	const llm = new ChatOpenAI({ model: "gpt-4o" });

	// Define tasks for parallel execution
	const tasks = [
		"Search Google for weather in Tokyo",
		"Check Reddit front page title",
		"Look up Bitcoin price on Coinbase",
		"Find NASA image of the day",
		"Check top story on CNN",
		// Uncomment more tasks if needed:
		// "Search latest SpaceX launch date",
		// "Look up population of Paris",
		// "Find current time in Sydney",
		// "Check who won last Super Bowl",
		// "Search trending topics on Twitter",
	];

	// Create agents for each task
	const agents = tasks.map(
		(task) =>
			new Agent({
				task: task,
				llm: llm,
				browserSession: browserSession,
			}),
	);

	try {
		// Run all agents in parallel
		console.log(`Starting ${agents.length} agents in parallel...`);
		const results = await Promise.all(agents.map((agent) => agent.run()));

		// Print results
		console.log("\n=== Results ===");
		results.forEach((result, index) => {
			console.log(`Task ${index + 1}: ${tasks[index]}`);
			console.log(`  Success: ${result.isSuccessful()}`);
			console.log(
				`  Output: ${result.finalResult()?.slice(0, 200) || ""}${(result.finalResult()?.length || 0) > 200 ? "..." : ""}`,
			);
			console.log("");
		});
	} catch (error) {
		console.error("Error running parallel agents:", error);
	} finally {
		// Clean up browser session
		await browserSession.kill();
		console.log("🔒 Browser session killed");
	}
}

// Run the main function
main().catch(console.error);
