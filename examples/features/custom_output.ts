import { ChatOpenAI } from "@langchain/openai";
import { Agent, Controller } from "browsernode";
import { z } from "zod";

// use zod to define the output format
const PostSchema = z.object({
	post_title: z.string(),
	post_url: z.string(),
	num_comments: z.number(),
	hours_since_post: z.number(),
});

const PostsSchema = z.object({
	posts: z.array(PostSchema),
});

// Create controller with output model
const controller = new Controller([], PostsSchema);

async function main() {
	const task =
		"Go to https://news.ycombinator.com/ and give me the first 5 posts.";

	const model = new ChatOpenAI({
		modelName: "gpt-4o",
		apiKey: process.env.OPENAI_API_KEY,
	});

	const agent = new Agent(task, model, {
		controller: controller,
	});

	const history = await agent.run();

	const result = history.finalResult();
	if (result) {
		// console.log("result:", result);
		try {
			const parsed: z.infer<typeof PostsSchema> = JSON.parse(result);

			for (const post of parsed.posts) {
				console.log("\n--------------------------------");
				console.log(`Title:            ${post.post_title}`);
				console.log(`URL:              ${post.post_url}`);
				console.log(`Comments:         ${post.num_comments}`);
				console.log(`Hours since post: ${post.hours_since_post}`);
			}
		} catch (error) {
			console.error("Failed to parse result:", error);
			console.log("Raw result:", result);
		}
	} else {
		console.log("No result");
	}
}

main().catch(console.error);
