import * as fs from "fs";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import { Agent, Controller } from "browsernode";
import { z } from "zod";
import { saveScreenshots } from "../utils/save_screenshots";

// Initialize controller first
const controller = new Controller();

const ModelSchema = z.object({
	title: z.string(),
	url: z.string(),
	likes: z.number(),
	license: z.string(),
});

const ModelsSchema = z.object({
	models: z.array(ModelSchema),
});

controller.action("Save to text file", {
	paramModel: ModelsSchema,
})(async function saveModels(params: z.infer<typeof ModelsSchema>) {
	const data =
		params.models
			.map(
				(model) =>
					`${model.title} (${model.url}): ${model.likes} likes, ${model.license}`,
			)
			.join("\n") + "\n";

	fs.appendFileSync("models.txt", data);
	return `Saved ${params.models.length} models to models.txt`;
});

function getCurrentDirPath() {
	const __filename = fileURLToPath(import.meta.url);
	return dirname(__filename);
}

async function main() {
	const task =
		"Look up models with a license of cc-by-sa-4.0 and sort by most likes on Hugging face, save top 5 to file.";

	const model = new ChatOpenAI({
		modelName: "gpt-4o-mini",
		apiKey: process.env.OPENAI_API_KEY,
		streaming: true,
	});

	const agent = new Agent(task, model, { controller, useVision: true });

	const history = await agent.run();
	console.log("Task completed successfully!");
	saveScreenshots(history.screenshots(), getCurrentDirPath());
}

main().catch(console.error);
