/**
 * Show how to use custom outputs.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import * as path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { Agent } from "browsernode";
import { AgentState } from "browsernode/agent/views";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";
import * as fs from "fs/promises";

async function main() {
	// Get the directory where this script is located
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);

	const task = "Go to hackernews show hn and give me the first 5 posts";

	const browserProfile = new BrowserProfile({
		headless: false,
	});

	const browserSession = new BrowserSession({
		browserProfile: browserProfile,
	});

	const agentState = new AgentState();

	for (let i = 0; i < 10; i++) {
		const agent = new Agent(task, new ChatOpenAI({ model: "gpt-4o" }), {
			browserSession: browserSession,
			injectedAgentState: agentState,
			pageExtractionLLM: new ChatOpenAI({ model: "gpt-4o-mini" }),
		});

		const [done, valid] = await agent.takeStep();
		console.log(`Step ${i}: Done: ${done}, Valid: ${valid}`);

		if (done && valid) {
			break;
		}

		// Clear history
		agentState.history.history = [];

		// Save state to file
		const serialized = JSON.stringify(
			agentState,
			(key, value) => {
				// Exclude history from serialization
				if (key === "history") {
					return undefined;
				}
				return value;
			},
			2,
		);

		const stateFilePath = path.join(__dirname, "agent_state.json");
		await fs.writeFile(stateFilePath, serialized, "utf-8");

		// Load state back from file
		const loadedJson = await fs.readFile(stateFilePath, "utf-8");
		const loadedState = JSON.parse(loadedJson);

		// Reconstruct AgentState object
		agentState.agentId = loadedState.agentId;
		agentState.nSteps = loadedState.nSteps;
		agentState.consecutiveFailures = loadedState.consecutiveFailures;
		agentState.lastResult = loadedState.lastResult;
		agentState.lastPlan = loadedState.lastPlan;
		agentState.lastModelOutput = loadedState.lastModelOutput;
		agentState.paused = loadedState.paused;
		agentState.stopped = loadedState.stopped;
		agentState.messageManagerState = loadedState.messageManagerState;
		agentState.fileSystemState = loadedState.fileSystemState;

		break;
	}

	// Clean up
	if (browserSession) {
		await browserSession.kill();
		console.log("🔒 Browser session killed");
	}
}

// Run the main function
main().catch(console.error);
