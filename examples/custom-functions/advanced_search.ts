/**
 * Advanced Search Example with Custom SERPER API Integration
 *
 * This example demonstrates how to:
 * 1. Create custom actions using the SERPER API for web search
 * 2. Use Zod schemas for structured output validation
 * 3. Search for email addresses of professors using an LLM agent
 *
 * Required Environment Variables:
 * - SERPER_API_KEY: Your SERPER API key from https://serper.dev/
 * - OPENAI_API_KEY: Your OpenAI API key
 *
 * Installation:
 * 1. npm install
 * 2. Copy .env.example to .env and add your API keys
 * 3. npx tsx examples/custom-functions/advanced_search.ts
 */

import * as http from "http";
import * as https from "https";
import { ActionResult, Agent, Controller } from "browsernode";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Zod schemas for Person and PersonList
const PersonSchema = z.object({
	name: z.string(),
	email: z.string().nullable().optional(),
});

const PersonListSchema = z.object({
	people: z.array(PersonSchema),
});

type Person = z.infer<typeof PersonSchema>;
type PersonList = z.infer<typeof PersonListSchema>;

const SERP_API_KEY = process.env.SERPER_API_KEY;
if (!SERP_API_KEY) {
	throw new Error("SERPER_API_KEY is not set");
}

// Initialize controller with excluded actions and output model
const controller = new Controller(["searchGoogle"], PersonListSchema);

// Custom search action using SERPER API
controller.action(
	"Search the web for a specific query. Returns a short description and links of the results.",
	{
		paramModel: z.object({
			query: z.string().describe("The search query to execute"),
		}),
	},
)(async function searchWeb(params: { query: string }, page: Page) {
	const { query } = params;

	// Perform SERP search using SERPER API
	return new Promise<ActionResult>((resolve, reject) => {
		const payload = JSON.stringify({ q: query });
		const options = {
			hostname: "google.serper.dev",
			path: "/search",
			method: "POST",
			headers: {
				"X-API-KEY": SERP_API_KEY,
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(payload),
			},
		};

		const req = https.request(options, (res) => {
			let data = "";

			res.on("data", (chunk) => {
				data += chunk;
			});

			res.on("end", () => {
				try {
					const serpData = JSON.parse(data);

					// Exclude searchParameters and credits
					const filteredData = Object.fromEntries(
						Object.entries(serpData).filter(
							([key]) => !["searchParameters", "credits"].includes(key),
						),
					);

					// Get organic results and remove position field
					const organicArray = Array.isArray(filteredData.organic)
						? filteredData.organic
						: [];
					const organic = organicArray.map((item: any) => {
						const { position, ...rest } = item;
						return rest;
					});

					console.log("Search results:", JSON.stringify(organic, null, 2));

					const organicStr = JSON.stringify(organic);

					resolve(
						new ActionResult({
							extractedContent: organicStr,
							includeInMemory: false,
							includeExtractedContentOnlyOnce: true,
						}),
					);
				} catch (error) {
					reject(new Error(`Failed to parse SERP response: ${error}`));
				}
			});
		});

		req.on("error", (error) => {
			reject(new Error(`SERP API request failed: ${error}`));
		});

		req.write(payload);
		req.end();
	});
});

const names = [
	"Ruedi Aebersold",
	// "Bernd Bodenmiller",
	// "Eugene Demler",
	// "Erich Fischer",
	// "Pietro Gambardella",
	// "Matthias Huss",
	// "Reto Knutti",
	// "Maksym Kovalenko",
	// "Antonio Lanzavecchia",
	// "Maria Lukatskaya",
	// "Jochen Markard",
	// "Javier Pérez-Ramírez",
	// "Federica Sallusto",
	// "Gisbert Schneider",
	// "Sonia I. Seneviratne",
	// "Michael Siegrist",
	// "Johan Six",
	// "Tanja Stadler",
	// "Shinichi Sunagawa",
	// "Michael Bruce Zimmermann",
];

async function main() {
	const task = `use searchWeb with "find email address of the following ETH professor:" for each of the following persons in a list of actions. Finally return the list with name and email if provided - do always 5 at once\n${names.join("\n")}`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4.1-mini",
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent(task, llm, {
		controller: controller,
	});

	try {
		const agentHistory = await agent.run();

		// Extract the final result from the agent history
		const finalResult = agentHistory.finalResult();
		// console.log("finalResult:", finalResult);

		if (finalResult) {
			const parsed = PersonListSchema.parse(JSON.parse(finalResult));

			console.log("\n🎯 Search Results:");
			for (const person of parsed.people) {
				console.log(`${person.name} - ${person.email || "No email found"}`);
			}
		} else {
			console.log("No result");
		}
	} catch (error) {
		console.error("Error running agent:", error);
	}
}

main().catch(console.error);
