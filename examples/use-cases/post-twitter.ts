/**
 * Goal: Provides a template for automated posting on X (Twitter), including new tweets, tagging, and replies.
 *
 * X Posting Template using browsernode
 * ----------------------------------------
 *
 * This template allows you to automate posting on X using browsernode.
 * It supports:
 * - Posting new tweets
 * - Tagging users
 * - Replying to tweets
 *
 * Add your target user and message in the config section.
 *
 * target_user="XXXXX"
 * message="XXXXX"
 * reply_url="XXXXX"
 *
 * Any issues, contact me on X @leoning_ai
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import { Agent, BrowserProfile, BrowserSession, Controller } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

// Check required environment variables
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

// ============ Configuration Section ============
interface TwitterConfig {
	/** Configuration for Twitter posting */
	openaiApiKey: string;
	chromePath?: string;
	targetUser: string; // Twitter handle without @
	message: string;
	replyUrl: string;
	headless: boolean;
	model: string;
	baseUrl: string;
}

// Customize these settings
const twitterConfig: TwitterConfig = {
	openaiApiKey: process.env.OPENAI_API_KEY!,
	chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // This is for MacOS (Chrome)
	targetUser: "XXXXX", // Replace with actual Twitter handle
	message: "XXXXX", // Replace with your message
	replyUrl: "XXXXX", // Replace with tweet URL to reply to
	headless: false,
	model: "gpt-4o",
	baseUrl: "https://x.com/home",
};

function createTwitterAgent(config: TwitterConfig): Agent {
	const llm = new ChatOpenAI({
		model: config.model,
		apiKey: config.openaiApiKey,
	});

	const browserProfile = new BrowserProfile({
		headless: config.headless,
		executablePath: config.chromePath,
		disableSecurity: true,
		userDataDir: "~/.config/browsernode/profiles/twitter",
	});

	const browserSession = new BrowserSession({
		browserProfile: browserProfile,
	});

	const controller = new Controller();

	// Construct the full message with tag
	const fullMessage = `@${config.targetUser} ${config.message}`;

	// Create the agent with detailed instructions
	const agent = new Agent({
		task: `Navigate to Twitter and create a post and reply to a tweet.

        Here are the specific steps:

        1. Go to ${config.baseUrl}. See the text input field at the top of the page that says "What's happening?"
        2. Look for the text input field at the top of the page that says "What's happening?"
        3. Click the input field and type exactly this message:
        "${fullMessage}"
        4. Find and click the "Post" button (look for attributes: 'button' and 'data-testid="tweetButton"')
        5. Do not click on the '+' button which will add another tweet.

        6. Navigate to ${config.replyUrl}
        7. Before replying, understand the context of the tweet by scrolling down and reading the comments.
        8. Reply to the tweet under 50 characters.

        Important:
        - Wait for each element to load before interacting
        - Make sure the message is typed exactly as shown
        - Verify the post button is clickable before clicking
        - Do not click on the '+' button which will add another tweet`,
		llm: llm,
		useVision: true,
		controller: controller,
		browserSession: browserSession,
	});

	return agent;
}

async function postTweet(agent: Agent): Promise<void> {
	try {
		await agent.run();
		console.log("✅ Tweet posted successfully!");
	} catch (error) {
		console.error(`❌ Error posting tweet: ${error}`);
		throw error;
	}
}

async function main(): Promise<void> {
	// Validate configuration
	if (twitterConfig.targetUser === "XXXXX") {
		console.warn("⚠️  Please update targetUser in the configuration");
	}
	if (twitterConfig.message === "XXXXX") {
		console.warn("⚠️  Please update message in the configuration");
	}
	if (twitterConfig.replyUrl === "XXXXX") {
		console.warn("⚠️  Please update replyUrl in the configuration");
	}

	console.log("🐦 Starting Twitter posting automation...");
	console.log(
		`📝 Message: @${twitterConfig.targetUser} ${twitterConfig.message}`,
	);
	console.log(`🔗 Reply URL: ${twitterConfig.replyUrl}`);

	const agent = createTwitterAgent(twitterConfig);

	try {
		await postTweet(agent);
	} catch (error) {
		console.error("❌ Failed to complete Twitter automation:", error);
	} finally {
		// Clean up browser session
		if (agent.browserSession) {
			await agent.browserSession.close();
		}
	}
}

// Run the main function
main().catch(console.error);

export { type TwitterConfig, createTwitterAgent, postTweet };
