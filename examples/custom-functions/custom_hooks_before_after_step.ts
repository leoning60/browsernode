/**
 * Description: TypeScript modules designed to capture detailed
 * browser usage data for analysis, with both server and client
 * components working together to record and store the information.
 *
 * Adapted from Python version by Carlos A. Planchón
 * https://github.com/carlosplanchon/
 *
 * Author: BrowserNode Team
 * Feedback is appreciated!
 */

import * as fs from "fs";
import * as path from "path";
import { Agent, Controller } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import cors from "cors";
import { config } from "dotenv";
import express, { type Request, type Response } from "express";

config();

/*********************
 *                   *
 *   --- UTILS ---   *
 *                   *
 *********************/

/**
 * Convert a Base64-encoded string to a PNG file.
 * @param b64String A string containing Base64-encoded data
 * @param outputFile The path to the output PNG file
 */
function b64ToPng(b64String: string, outputFile: string): void {
	// Remove data URL prefix if present
	const base64Data = b64String.replace(/^data:image\/[a-z]+;base64,/, "");
	fs.writeFileSync(outputFile, Buffer.from(base64Data, "base64"));
}

/**
 * Ensure directory exists, create if it doesn't
 */
function ensureDirectoryExists(dirPath: string): void {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

/**
 * Get next available file number for recordings
 */
function getNextFileNumber(recordingsDir: string): number {
	const existingNumbers: number[] = [];

	if (fs.existsSync(recordingsDir)) {
		const files = fs.readdirSync(recordingsDir);
		for (const file of files) {
			if (file.endsWith(".json")) {
				const fileName = path.basename(file, ".json");
				const fileNum = parseInt(fileName, 10);
				if (!isNaN(fileNum)) {
					existingNumbers.push(fileNum);
				}
			}
		}
	}

	return existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
}

/***********************************************************************
 *                                                                     *
 *   --- EXPRESS API TO RECORD AND SAVE Browsernode ACTIVITY ---     *
 *                                                                     *
 ***********************************************************************/

interface AgentHistoryStep {
	websiteHtml?: string;
	websiteScreenshot?: string;
	url?: string;
	modelThoughts?: any;
	modelOutputs?: any;
	modelActions?: any;
	extractedContent?: any;
	timestamp?: string;
	stepNumber?: number;
}

class RecordingServer {
	private app: express.Application;
	private recordingsDir: string;

	constructor(recordingsDir: string = "recordings") {
		this.app = express();
		this.recordingsDir = recordingsDir;
		this.setupMiddleware();
		this.setupRoutes();
		ensureDirectoryExists(this.recordingsDir);
	}

	private setupMiddleware(): void {
		this.app.use(cors());
		this.app.use(express.json({ limit: "50mb" }));
		this.app.use(express.urlencoded({ extended: true, limit: "50mb" }));
	}

	private setupRoutes(): void {
		this.app.post(
			"/post_agent_history_step",
			async (req: Request, res: Response) => {
				try {
					const data: AgentHistoryStep = req.body;

					// Add timestamp if not present
					if (!data.timestamp) {
						data.timestamp = new Date().toISOString();
					}

					console.log("📊 Received agent history step:", {
						url: data.url,
						timestamp: data.timestamp,
						hasScreenshot: !!data.websiteScreenshot,
						hasHtml: !!data.websiteHtml,
					});

					// Get next file number
					const nextNumber = getNextFileNumber(this.recordingsDir);
					const filePath = path.join(this.recordingsDir, `${nextNumber}.json`);

					// Save the JSON data
					fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

					// Save screenshot as separate PNG if available
					if (data.websiteScreenshot) {
						const screenshotPath = path.join(
							this.recordingsDir,
							`${nextNumber}_screenshot.png`,
						);
						try {
							b64ToPng(data.websiteScreenshot, screenshotPath);
							console.log(`📸 Screenshot saved to: ${screenshotPath}`);
						} catch (error) {
							console.error("❌ Error saving screenshot:", error);
						}
					}

					console.log(`💾 Data saved to: ${filePath}`);

					res.json({
						status: "ok",
						message: `Saved to ${filePath}`,
						fileNumber: nextNumber,
					});
				} catch (error) {
					console.error("❌ Error processing request:", error);
					res.status(500).json({
						status: "error",
						message: "Failed to save agent history step",
					});
				}
			},
		);

		this.app.get("/recordings", (req: Request, res: Response) => {
			try {
				const files = fs
					.readdirSync(this.recordingsDir)
					.filter((file) => file.endsWith(".json"))
					.map((file) => {
						const filePath = path.join(this.recordingsDir, file);
						const stats = fs.statSync(filePath);
						return {
							filename: file,
							size: stats.size,
							created: stats.ctime,
						};
					});

				res.json({ recordings: files });
			} catch (error) {
				res.status(500).json({ error: "Failed to list recordings" });
			}
		});
	}

	public start(port: number = 9000, host: string = "0.0.0.0"): void {
		this.app.listen(port, host, () => {
			console.log(`🚀 Recording server running at http://${host}:${port}`);
		});
	}
}

/****************************************************************
 *                                                              *
 *   --- CLIENT TO RECORD AND SAVE Browsernode ACTIVITY ---   *
 *                                                              *
 ****************************************************************/

interface RecordingConfig {
	apiUrl?: string;
	includeHtml?: boolean;
	includeScreenshot?: boolean;
	saveToFile?: boolean;
	recordingsDir?: string;
}

class BrowserActivityRecorder {
	private config: RecordingConfig;
	private stepCounter: number = 0;

	constructor(config: RecordingConfig = {}) {
		this.config = {
			apiUrl: "http://127.0.0.1:9000/post_agent_history_step",
			includeHtml: true,
			includeScreenshot: true,
			saveToFile: false,
			recordingsDir: "recordings",
			...config,
		};

		if (this.config.saveToFile) {
			ensureDirectoryExists(this.config.recordingsDir!);
		}
	}

	/**
	 * Send agent history step to API server
	 */
	private async sendToApi(data: AgentHistoryStep): Promise<any> {
		try {
			const response = await fetch(this.config.apiUrl!, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(data),
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			return await response.json();
		} catch (error) {
			console.error("❌ Failed to send data to API:", error);
			throw error;
		}
	}

	/**
	 * Save data to local file
	 */
	private saveToLocalFile(data: AgentHistoryStep): void {
		const nextNumber = getNextFileNumber(this.config.recordingsDir!);
		const filePath = path.join(
			this.config.recordingsDir!,
			`${nextNumber}.json`,
		);

		fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
		console.log(`💾 Saved locally to: ${filePath}`);

		// Save screenshot separately if available
		if (data.websiteScreenshot) {
			const screenshotPath = path.join(
				this.config.recordingsDir!,
				`${nextNumber}_screenshot.png`,
			);
			try {
				b64ToPng(data.websiteScreenshot, screenshotPath);
				console.log(`📸 Screenshot saved to: ${screenshotPath}`);
			} catch (error) {
				console.error("❌ Error saving screenshot:", error);
			}
		}
	}

	/**
	 * Record browser activity for a given agent step
	 */
	public async recordActivity(agent: Agent): Promise<void> {
		try {
			this.stepCounter++;
			console.log(`📊 Recording step ${this.stepCounter}...`);

			const data: AgentHistoryStep = {
				stepNumber: this.stepCounter,
				timestamp: new Date().toISOString(),
			};

			// Get current page if browser session exists
			if (agent.browserSession) {
				try {
					// Get current page using the proper browsernode API
					const page = await agent.browserSession.getCurrentPage();

					// Get current URL
					try {
						data.url = page.url();
					} catch (error) {
						console.warn("⚠️ Could not get current URL:", error);
					}

					// Get HTML content if enabled
					if (this.config.includeHtml) {
						try {
							data.websiteHtml = await page.content();
						} catch (error) {
							console.warn("⚠️ Could not get page HTML:", error);
						}
					}

					// Get screenshot if enabled
					if (this.config.includeScreenshot) {
						try {
							// Use browsernode's takeScreenshot method which handles retries and errors
							const screenshotBase64 =
								await agent.browserSession.takeScreenshot();
							data.websiteScreenshot = `data:image/png;base64,${screenshotBase64}`;
						} catch (error) {
							console.warn("⚠️ Could not take screenshot:", error);
						}
					}
				} catch (error) {
					console.warn("⚠️ Could not access browser session:", error);
				}
			}

			// Save data
			if (this.config.saveToFile) {
				this.saveToLocalFile(data);
			} else {
				await this.sendToApi(data);
			}
		} catch (error) {
			console.error("❌ Error recording activity:", error);
		}
	}

	/**
	 * Create hook functions for Agent (compatible with browsernode's hook system)
	 */
	public createHooks() {
		return {
			onStepStart: async (agent: Agent) => {
				console.log("🎬 Before step hook triggered");
				await this.recordActivity(agent);
			},
			onStepEnd: async (agent: Agent) => {
				console.log("🎬 After step hook triggered");
				await this.recordActivity(agent);
			},
		};
	}
}

/****************************************************************
 *                                                              *
 *   --- EXAMPLE USAGE ---                                     *
 *                                                              *
 ****************************************************************/

async function startRecordingServer(): Promise<void> {
	const server = new RecordingServer();
	server.start(9000, "0.0.0.0");

	// Keep the server running
	return new Promise(() => {});
}

async function runAgentWithRecording(): Promise<void> {
	const task = "Compare the price of gpt-4o and DeepSeek-V3";

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4.1-mini",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create activity recorder - use local file storage by default since API server may not be running
	const recorder = new BrowserActivityRecorder({
		includeHtml: true,
		includeScreenshot: true,
		saveToFile: true, // Save locally by default - set to false to use API server
		recordingsDir: "./recordings", // Local directory for recordings
	});

	// Create controller
	const controller = new Controller();

	// Create agent
	const agent = new Agent(task, llm, {
		controller: controller,
	});

	try {
		console.log("🤖 Starting agent with activity recording...");

		// Get the hooks from the recorder
		const hooks = recorder.createHooks();

		// Run the agent with the recording hooks
		const result = await agent.run(30, {
			onStepStart: hooks.onStepStart,
			onStepEnd: hooks.onStepEnd,
		});

		console.log(`🎯 Task completed: ${result}`);

		// Record final state
		await recorder.recordActivity(agent);
	} catch (error) {
		console.error("❌ Error running agent:", error);
	}
}

// Export for use in other modules
export {
	BrowserActivityRecorder,
	RecordingServer,
	b64ToPng,
	ensureDirectoryExists,
};

// Example usage - uncomment the function you want to run
async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.includes("--server")) {
		console.log("🚀 Starting recording server...");
		await startRecordingServer();
	} else {
		console.log("🤖 Running agent with recording...");
		await runAgentWithRecording();
	}
}

// Uncomment to run the example
main().catch(console.error);
