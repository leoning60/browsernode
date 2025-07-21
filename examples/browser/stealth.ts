import * as fs from "fs";
import * as path from "path";
import { BrowserProfile, BrowserSession } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { config } from "dotenv";
import terminalImage from "terminal-image";

config();

const llm = new ChatOpenAI({ model: "gpt-4.1-mini" });

// Get terminal dimensions
const terminalWidth = process.stdout.columns || 80;
const terminalHeight = process.stdout.rows || 20;

async function waitForInput(message: string): Promise<void> {
	console.log(message);
	process.stdin.setRawMode(true);
	process.stdin.resume();
	return new Promise<void>((resolve) => {
		process.stdin.once("data", () => {
			process.stdin.setRawMode(false);
			process.stdin.pause();
			resolve();
		});
	});
}

async function displayImage(imagePath: string): Promise<void> {
	try {
		const imageData = await terminalImage.file(imagePath, {
			height: Math.max(terminalHeight - 15, 40),
		});
		console.log(imageData);
	} catch (error) {
		console.error(`Failed to display image ${imagePath}:`, error);
	}
}

async function main() {
	console.log("\n\nNORMAL BROWSER:");
	// Default Playwright Chromium Browser
	const normalBrowserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			userDataDir: undefined,
			headless: false,
			stealth: false,
		}),
	});

	await normalBrowserSession.start();
	await normalBrowserSession.createNewTab(
		"https://abrahamjuliot.github.io/creepjs/",
	);

	// Wait for page to load
	await new Promise((resolve) => setTimeout(resolve, 5000));

	const normalPage = await normalBrowserSession.getCurrentPage();
	await normalPage?.screenshot({ path: "normal_browser.png" });
	await displayImage("normal_browser.png");
	await normalBrowserSession.close();

	console.log("\n\nSTEALTH BROWSER (PATCHRIGHT):");
	const stealthBrowserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			userDataDir: "~/.config/browsernode/profiles/stealth",
			stealth: true,
			headless: false,
			disableSecurity: false,
			deterministicRendering: false,
		}),
	});

	await stealthBrowserSession.start();
	await stealthBrowserSession.createNewTab(
		"https://abrahamjuliot.github.io/creepjs/",
	);

	// Wait for page to load
	await new Promise((resolve) => setTimeout(resolve, 5000));

	const stealthPage = await stealthBrowserSession.getCurrentPage();
	await stealthPage?.screenshot({ path: "stealth_browser.png" });
	await displayImage("stealth_browser.png");
	await stealthBrowserSession.close();

	// Brave Browser
	const bravePath =
		"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
	if (fs.existsSync(bravePath)) {
		console.log("\n\nBRAVE BROWSER:");
		const braveBrowserSession = new BrowserSession({
			browserProfile: new BrowserProfile({
				executablePath: bravePath,
				headless: false,
				disableSecurity: false,
				userDataDir: "~/.config/browsernode/profiles/brave",
				deterministicRendering: false,
			}),
		});

		await braveBrowserSession.start();
		await braveBrowserSession.createNewTab(
			"https://abrahamjuliot.github.io/creepjs/",
		);

		// Wait for page to load
		await new Promise((resolve) => setTimeout(resolve, 5000));

		const bravePage = await braveBrowserSession.getCurrentPage();
		await bravePage?.screenshot({ path: "brave_browser.png" });
		await displayImage("brave_browser.png");
		await braveBrowserSession.close();

		console.log("\n\nBRAVE + STEALTH BROWSER:");
		const braveStealthBrowserSession = new BrowserSession({
			browserProfile: new BrowserProfile({
				executablePath: bravePath,
				headless: false,
				disableSecurity: false,
				userDataDir: undefined,
				deterministicRendering: false,
				stealth: true,
			}),
		});

		await braveStealthBrowserSession.start();
		await braveStealthBrowserSession.createNewTab(
			"https://abrahamjuliot.github.io/creepjs/",
		);

		// Wait for page to load
		await new Promise((resolve) => setTimeout(resolve, 5000));

		const braveStealthPage = await braveStealthBrowserSession.getCurrentPage();
		await braveStealthPage?.screenshot({ path: "brave_stealth_browser.png" });
		await displayImage("brave_stealth_browser.png");

		await waitForInput("Press [Enter] to close the browser...");
		await braveStealthBrowserSession.close();
	}

	// Commented out agent examples (can be uncommented for testing)
	/*
	console.log('\nTesting with Agent...');
	const agent = new Agent(
		"Go to https://abrahamjuliot.github.io/creepjs/ and verify that the detection score is >50%.",
		llm,
		{
			browserSession: stealthBrowserSession,
		}
	);
	await agent.run();

	await waitForInput('Press Enter to close the browser...');
	*/

	// Clean up screenshot files
	const screenshotFiles = [
		"normal_browser.png",
		"stealth_browser.png",
		"brave_browser.png",
		"brave_stealth_browser.png",
	];

	for (const file of screenshotFiles) {
		if (fs.existsSync(file)) {
			fs.unlinkSync(file);
		}
	}
}

main().catch(console.error);
