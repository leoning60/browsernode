import * as fs from "fs";
import * as path from "path";
import { ActionResult, Agent, Controller } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { config } from "dotenv";
import { z } from "zod";

config();

// Define the Person and PersonList schemas using Zod
const PersonSchema = z.object({
	name: z.string(),
	email: z.string().nullable().optional(),
});

const PersonListSchema = z.object({
	people: z.array(PersonSchema),
});

type Person = z.infer<typeof PersonSchema>;
type PersonList = z.infer<typeof PersonListSchema>;

// Check for required environment variable
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
if (!PERPLEXITY_API_KEY) {
	throw new Error("PERPLEXITY_API_KEY is not set");
}

// Initialize controller with output model
const controller = new Controller(["searchGoogle"], PersonListSchema);

// Search web with Perplexity - custom action
controller.action("Search the web for a specific query with perplexity", {
	paramModel: z.object({
		query: z.string().describe("The search query to send to Perplexity"),
	}),
})(async function searchWeb(params: { query: string }) {
	const url = "https://api.perplexity.ai/chat/completions";

	const payload = {
		model: "sonar",
		messages: [
			{ role: "system", content: "Be precise and concise." },
			{ role: "user", content: params.query },
		],
	};

	const headers = {
		Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
		"Content-Type": "application/json",
	};

	try {
		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const responseJson = (await response.json()) as any;
		const content = responseJson.choices[0].message.content;
		const citations = responseJson.citations;
		const output = `${content}\n\nCitations:\n${citations.join("\n")}`;

		console.log(output);

		return new ActionResult({
			extractedContent: output,
			includeInMemory: true,
		});
	} catch (error) {
		console.error("Error calling Perplexity API:", error);
		throw error;
	}
});

async function main() {
	const names = ["Ruedi Aebersold", "Bernd Bodenmiller", "Eugene Demler"];

	const task = `Use searchWeb with "find email address of the following ETH professor:" for each of the persons. Finally return the list with name and email if provided.\n\n${names.join("\n")}`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o-mini",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent(task, llm, {
		controller: controller,
	});

	const history = await agent.run();
	console.log(`🎯 Task completed: ${history}`);

	// Extract the final result from the history
	const finalResult = history.finalResult();
	if (finalResult) {
		try {
			const parsed: PersonList = PersonListSchema.parse(
				JSON.parse(finalResult),
			);
			console.log("\nResults:");
			for (const person of parsed.people) {
				console.log(`${person.name} - ${person.email || "No email found"}`);
			}
		} catch (error) {
			console.error("Error parsing result:", error);
			console.log("Raw result:", finalResult);
		}
	} else {
		console.log("No result");
	}
}

// Run the main function
main().catch(console.error);
