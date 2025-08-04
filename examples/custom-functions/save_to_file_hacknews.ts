import * as fs from "fs";
import * as path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { ActionResult, Agent, Controller } from "browsernode";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

function getCurrentDirPath() {
	const __filename = fileURLToPath(import.meta.url);
	return dirname(__filename);
}

// Initialize controller
const controller = new Controller();

// Define the news schema using Zod
const NewsItemSchema = z.object({
	title: z.string(),
	url: z.string().optional(),
	points: z.number().optional(),
	comments: z.number().optional(),
});

const NewsSchema = z.object({
	news: z.array(NewsItemSchema),
});

type NewsItem = z.infer<typeof NewsItemSchema>;
type News = z.infer<typeof NewsSchema>;

// Save news - custom action
controller.action("Save news", {
	paramModel: NewsSchema,
})(async function saveNews(params: News, page: Page) {
	const filePath = path.join(getCurrentDirPath(), "hacker_news.txt");

	// Append news to file
	const content =
		params.news
			.map(
				(item) =>
					`${item.title}${item.url ? ` (${item.url})` : ""}${item.points ? ` - ${item.points} points` : ""}${item.comments ? ` - ${item.comments} comments` : ""}`,
			)
			.join("\n") + "\n";

	try {
		// Ensure directory exists
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		// Log the operation
		console.log(
			`📝 Attempting to save ${params.news.length} news items to: ${filePath}`,
		);
		console.log(`📄 Content to save:\n${content}`);

		// Write to file
		fs.appendFileSync(filePath, content);

		// Verify file was written
		if (fs.existsSync(filePath)) {
			const fileStats = fs.statSync(filePath);
			console.log(`✅ File saved successfully. Size: ${fileStats.size} bytes`);
		}

		const msg = `Saved ${params.news.length} news items to hacker_news.txt`;
		return new ActionResult({
			extractedContent: msg,
			includeInMemory: true,
			longTermMemory: `Saved ${params.news.length} news items to file`,
		});
	} catch (error) {
		const errorMsg = `❌ Failed to save news to file: ${error}`;
		console.error(errorMsg);
		return new ActionResult({
			error: errorMsg,
			extractedContent: errorMsg,
			includeInMemory: true,
		});
	}
});

async function main() {
	const task = `
	Go to https://news.ycombinator.com/ and save the top 5 news to hacker_news.txt file.
	`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent({
		task: task,
		llm: llm,
		controller: controller,
	});

	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

// Run the main function
main().catch(console.error);
