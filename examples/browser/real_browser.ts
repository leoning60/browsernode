import { Agent, BrowserProfile, BrowserSession } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

// Browser profile configuration
const browserProfile = new BrowserProfile({
	// NOTE: you need to close your chrome browser - so that this can open your browser in debug mode
	executablePath:
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	userDataDir: "~/.config/browsernode/profiles/default",
	headless: false,
});

// Browser session configuration
const browserSession = new BrowserSession({
	browserProfile: browserProfile,
});

async function main() {
	const llm = new ChatOpenAI({
		model: "gpt-4.1-mini",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	const agent = new Agent(
		"go to https://search.brave.com and find todays DOW stock price",
		llm,
		{
			browserSession: browserSession,
		},
	);

	await agent.run();
	await browserSession.close();

	console.log("Press Enter to close...");
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("data", () => process.exit(0));
}

main().catch(console.error);
