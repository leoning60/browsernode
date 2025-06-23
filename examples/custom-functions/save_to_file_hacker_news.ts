import * as fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import { Agent, Controller } from "browsernode";
import { z } from "zod";
import { saveScreenshots } from "../utils/save_screenshots";

function getCurrentDirPath() {
	const __filename = fileURLToPath(import.meta.url);
	return dirname(__filename);
}

// Initialize controller first
const customController = new Controller();

const SaveTextFileAction = z.object({
	content: z.string(),
});

// Generate output directory once at startup
customController.action("Save content to text file", {
	paramModel: SaveTextFileAction,
})(async function saveTextFile(params: z.infer<typeof SaveTextFileAction>) {
	const content = params.content;
	fs.appendFileSync(
		join(getCurrentDirPath(), "hacker_news.txt"),
		typeof content === "string" ? content : JSON.stringify(content),
	);
	return `Saved news to hacker_news.txt`;
});

async function main() {
	const task =
		" Go to https://news.ycombinator.com/ and save the top 5 news to hacker_news.txt file.";

	const model = new ChatOpenAI({
		modelName: "gpt-4o",
		apiKey: process.env.OPENAI_API_KEY,
		streaming: true,
	});

	const agent = new Agent(task, model, {
		controller: customController,
		useVision: true,
	});

	const history = await agent.run();
	console.log("Task completed successfully!");
	saveScreenshots(history.screenshots(), getCurrentDirPath());
}

main().catch(console.error);
