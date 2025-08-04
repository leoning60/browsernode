/**
 * Show how to control an agent with pause, resume, and stop functionality.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import * as readline from "readline";
import { Agent } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";

class AgentController {
	private agent: Agent;
	private running: boolean = false;
	private agentThread: NodeJS.Timeout | null = null;

	constructor() {
		const llm = new ChatOpenAI({ model: "gpt-4o" });
		this.agent = new Agent({
			task: "open in one action https://www.google.com, https://www.wikipedia.org, https://www.youtube.com, https://www.github.com, https://amazon.com",
			llm: llm,
			browserProfile: new BrowserProfile({
				headless: false,
			}),
		});
	}

	async runAgent(): Promise<void> {
		/**Run the agent*/
		this.running = true;
		try {
			await this.agent.run();
		} catch (error) {
			console.error("Agent run error:", error);
		} finally {
			this.running = false;
		}
	}

	start(): void {
		/**Start the agent in a separate thread*/
		if (!this.running) {
			console.log("Starting agent...");
			this.agentThread = setTimeout(() => {
				this.runAgent();
			}, 0);
		} else {
			console.log("Agent is already running");
		}
	}

	pause(): void {
		/**Pause the agent*/
		console.log("Pausing agent...");
		this.agent.pause();
	}

	resume(): void {
		/**Resume the agent*/
		console.log("Resuming agent...");
		this.agent.resume();
	}

	stop(): void {
		/**Stop the agent*/
		console.log("Stopping agent...");
		this.agent.stop();
		this.running = false;
		if (this.agentThread) {
			clearTimeout(this.agentThread);
			this.agentThread = null;
		}
	}

	isRunning(): boolean {
		return this.running;
	}
}

function printMenu(): void {
	console.log("\nAgent Control Menu:");
	console.log("1. Start");
	console.log("2. Pause");
	console.log("3. Resume");
	console.log("4. Stop");
	console.log("5. Exit");
}

async function main(): Promise<void> {
	const controller = new AgentController();
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	while (true) {
		printMenu();
		try {
			const choice = await new Promise<string>((resolve) => {
				rl.question("Enter your choice (1-5): ", resolve);
			});

			if (choice === "1" && !controller.isRunning()) {
				controller.start();
			} else if (choice === "2") {
				controller.pause();
			} else if (choice === "3") {
				controller.resume();
			} else if (choice === "4") {
				controller.stop();
			} else if (choice === "5") {
				console.log("Exiting...");
				if (controller.isRunning()) {
					controller.stop();
				}
				break;
			} else if (choice === "1" && controller.isRunning()) {
				console.log("Agent is already running");
			} else {
				console.log("Invalid choice. Please enter a number between 1-5.");
			}

			// Small delay to prevent CPU spinning
			await new Promise((resolve) => setTimeout(resolve, 100));
		} catch (error) {
			if (error instanceof Error && error.message.includes("SIGINT")) {
				console.log("\nExiting...");
				if (controller.isRunning()) {
					controller.stop();
				}
				break;
			}
			console.error("Error:", error);
		}
	}

	rl.close();
}

// Run the main function
main().catch(console.error);
