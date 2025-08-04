/**
 * Show how to use custom outputs.
 *
 * This example demonstrates how to use browsernode with custom output models
 * to find social media profiles of influencers from TikTok videos.
 *
 * @dev You need to add OPENAI_API_KEY and BEARER_TOKEN to your environment variables.
 */

import { ActionResult, Agent, Controller } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Check required environment variables
const BEARER_TOKEN = process.env.BEARER_TOKEN;
if (!BEARER_TOKEN) {
	// use the api key for ask tessa
	// you can also use other apis like exa, xAI, perplexity, etc.
	throw new Error(
		"BEARER_TOKEN is not set - go to https://www.heytessa.ai/ and create an api key",
	);
}

if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

// Define the Profile schema using Zod
const ProfileSchema = z.object({
	platform: z.string(),
	profileUrl: z.string(),
});

const ProfilesSchema = z.object({
	profiles: z.array(ProfileSchema),
});

type Profile = z.infer<typeof ProfileSchema>;
type Profiles = z.infer<typeof ProfilesSchema>;

// Initialize controller with custom output model
const controller = new Controller(["searchGoogle"], ProfilesSchema);

// Register custom action for web search
controller.action("Search the web for a specific query")(
	async function searchWeb(query: string) {
		const keysToUse = ["url", "title", "content", "author", "score"];
		const headers = { Authorization: `Bearer ${BEARER_TOKEN}` };

		try {
			const response = await fetch("https://asktessa.ai/api/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...headers,
				},
				body: JSON.stringify({ query }),
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json();
			const finalResults = data.sources
				.filter((source: any) => source.score >= 0.2)
				.map((source: any) => {
					const result: any = {};
					keysToUse.forEach((key) => {
						if (key in source) {
							result[key] = source[key];
						}
					});
					return result;
				});

			const resultText = JSON.stringify(finalResults, null, 4);
			console.log(resultText);

			return new ActionResult({
				extractedContent: resultText,
				includeInMemory: true,
			});
		} catch (error) {
			console.error("Error during web search:", error);
			throw error;
		}
	},
);

async function main() {
	const task = `
		Go to this tiktok video url, open it and extract the @username from the resulting url. 
		Then do a websearch for this username to find all his social media profiles. 
		Return me the links to the social media profiles with the platform name.
		https://www.tiktokv.com/share/video/7470981717659110678/
	`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		apiKey: process.env.OPENAI_API_KEY!,
	});

	// Create and run the agent
	const agent = new Agent({
		task: task,
		llm: llm,
		controller: controller,
	});

	const history = await agent.run();
	const result = history.finalResult();

	if (result) {
		try {
			const parsed: Profiles = ProfilesSchema.parse(JSON.parse(result));

			for (const profile of parsed.profiles) {
				console.log("\n--------------------------------");
				console.log(`Platform:         ${profile.platform}`);
				console.log(`Profile URL:      ${profile.profileUrl}`);
			}
		} catch (error) {
			console.error("Error parsing result:", error);
			console.log("Raw result:", result);
		}
	} else {
		console.log("No result");
	}
}

// Run the main function
main().catch(console.error);
