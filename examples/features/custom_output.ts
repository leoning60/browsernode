/**
 * Custom Output Example with Structured Data Extraction
 *
 * This example demonstrates how to:
 * 1. Define structured output models using Zod schemas
 * 2. Use the Controller with output validation
 * 3. Extract structured data from web pages (Hacker News)
 * 4. Parse and display the results
 *
 * Required Environment Variables:
 * - OPENAI_API_KEY: Your OpenAI API key
 *
 * Installation:
 * 1. npm install
 * 2. Copy .env.example to .env and add your API key
 * 3. npx tsx examples/features/custom_output.ts
 */

import { Agent, Controller } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Zod schemas for Post and Posts
const PostSchema = z.object({
	post_title: z.string().describe("The title of the post"),
	post_url: z.string().describe("The URL of the post"),
	num_comments: z.number().describe("Number of comments on the post"),
	hours_since_post: z.number().describe("Hours since the post was created"),
});

const PostsSchema = z.object({
	posts: z.array(PostSchema).describe("Array of posts from Hacker News"),
});

type Post = z.infer<typeof PostSchema>;
type Posts = z.infer<typeof PostsSchema>;

async function main() {
	// Check for required environment variable
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not set in environment variables");
	}

	// Initialize controller with output model for structured data extraction
	const controller = new Controller([], PostsSchema);

	// Task to extract structured data from Hacker News
	const task = "Go to hackernews show hn and give me the first 5 posts";

	// Initialize the language model
	const model = new ChatOpenAI({
		model: "gpt-4o",
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent({
		task: task,
		llm: model,
		controller: controller,
	});

	try {
		console.log("🚀 Starting agent to extract Hacker News posts...\n");

		const history = await agent.run();

		// Extract the final result from the agent history
		const result = history.finalResult();

		if (result) {
			// Parse the structured result using Zod
			const parsed: Posts = PostsSchema.parse(JSON.parse(result));

			console.log("🎯 Extracted Posts from Hacker News Show HN:\n");

			// Display each post with formatting
			for (const [index, post] of parsed.posts.entries()) {
				console.log(`\n${index + 1}. --------------------------------`);
				console.log(`Title:            ${post.post_title}`);
				console.log(`URL:              ${post.post_url}`);
				console.log(`Comments:         ${post.num_comments}`);
				console.log(`Hours since post: ${post.hours_since_post}`);
			}

			console.log("\n✅ Successfully extracted structured data!");
		} else {
			console.log("❌ No result returned from agent");
		}
	} catch (error) {
		console.error("💥 Error running agent:", error);

		// If it's a Zod validation error, provide more details
		if (error instanceof z.ZodError) {
			console.error("Validation errors:", error.errors);
		}
	}
}

// Run the main function
main().catch(console.error);
