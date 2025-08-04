/**
 * File Download Example with Google Gemini
 *
 * This example demonstrates how to:
 * 1. Use Google Gemini as the LLM model
 * 2. Configure a custom downloads path in the browser profile
 * 3. Create an agent that downloads files from a website
 * 4. Track downloaded files during the session
 *
 * Required Environment Variables:
 * - GOOGLE_API_KEY: Your Google API key for Gemini
 *
 * Installation:
 * 1. npm install
 * 2. Copy .env.example to .env and add your API key
 * 3. npx tsx examples/features/download_file.ts
 */

import os from "os";
import path from "path";
import { Agent } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatGoogle } from "browsernode/llm";

async function runDownload() {
	// Check for required environment variable
	const apiKey = process.env.GOOGLE_API_KEY;
	if (!apiKey) {
		throw new Error("GOOGLE_API_KEY is not set in environment variables");
	}

	console.log("🤖 Using Google Gemini model: gemini-2.0-flash-exp");
	console.log("📁 Downloads will be saved to: ~/Downloads");
	console.log("🌐 Target website: https://file-examples.com/\n");

	// Initialize Google Gemini LLM
	const llm = new ChatGoogle({
		model: "gemini-2.0-flash-exp",
		apiKey: apiKey,
	});

	// Create browser profile with downloads configuration
	const browserProfile = new BrowserProfile({
		downloadsPath: path.join(os.homedir(), "Downloads"), // Expand ~/Downloads to full path
		userDataDir: path.join(
			os.homedir(),
			".config/browsernode/profiles/default",
		),
		headless: false, // Make browser visible to see the download process
		acceptDownloads: true, // Enable downloads
	});

	// Create browser session with the configured profile
	const browserSession = new BrowserSession({
		browserProfile: browserProfile,
	});

	try {
		// Create agent with download task
		const agent = new Agent({
			task: 'Go to "https://file-examples.com/" and download the smallest doc file.',
			llm: llm,
			maxActionsPerStep: 8,
			useVision: true,
			browserSession: browserSession,
		});

		console.log("🚀 Starting agent execution...\n");

		// Run the agent with maximum 25 steps
		const history = await agent.run(25);

		console.log("\n✅ Agent execution completed!");
		console.log("Final result:", history.finalResult());

		// Check for downloaded files
		const downloadedFiles = browserSession.downloadedFiles;
		if (downloadedFiles.length > 0) {
			console.log("\n📁 Downloaded files:");
			downloadedFiles.forEach((file, index) => {
				console.log(`   ${index + 1}. ${file}`);
			});
		} else {
			console.log("\n📁 No files were downloaded during this session.");
		}
	} catch (error) {
		console.error("💥 Error running agent:", error);
	} finally {
		// Close the browser session
		await browserSession.close();
		console.log("🔚 Browser session closed.");
	}
}

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
	runDownload().catch(console.error);
}
