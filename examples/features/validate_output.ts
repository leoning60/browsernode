/**
 * Demonstrate output validator.
 * Shows how to create custom actions with parameter validation and how output validation works.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import os from "os";
import path from "path";
import { ActionResult, Agent } from "browsernode";
import { Controller } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Create the controller
const controller = new Controller();

// Define the parameter model using Zod
const DoneResultSchema = z.object({
	title: z.string(),
	comments: z.string(),
	hours_since_start: z.number().int(),
});

// Type inference for TypeScript
type DoneResultType = z.infer<typeof DoneResultSchema>;

// Register the custom done action that overrides the default
// We overwrite done() in this example to demonstrate the validator
controller.registry.action("Done with task", {
	paramModel: DoneResultSchema,
})(async function done(params: DoneResultType): Promise<ActionResult> {
	const result = new ActionResult({
		isDone: true,
		extractedContent: JSON.stringify(params),
	});

	console.log("Action Result:", result);

	// NOTE: This is clearly wrong - to demonstrate the validator
	// Force return a wrong type to trigger validation error
	console.log("🚨 Intentionally returning wrong type to test validator...");
	throw new Error("Invalid return type: expected ActionResult but got string");
});

async function main() {
	const task = "Go to hackernews hn and give me the top 1 post";

	// Initialize the model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
	});

	// Create browser session
	const browserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			userDataDir: path.join(
				os.homedir(),
				".config",
				"browsernode",
				"profiles",
				"validation-example",
			),
		}),
	});

	// Create agent with output validation enabled
	const agent = new Agent({
		task: task,
		llm: llm,
		controller: controller,
		browserSession: browserSession,
		validateOutput: true, // This should catch validation errors
	});

	try {
		// Start the browser session
		await browserSession.start();

		console.log("🚀 Starting agent with output validation enabled...");
		console.log("⚠️ This should fail to demonstrate the validator");

		// NOTE: This should fail to demonstrate the validator
		await agent.run(5);

		console.log("✅ Agent execution completed");
	} catch (error) {
		console.error("❌ Expected validation error occurred:", error);
		console.log("✅ Output validation worked as expected!");
	} finally {
		// Clean up browser session
		await browserSession.close();
		console.log("🔒 Browser session closed");

		if (browserSession) {
			await browserSession.kill();
			console.log("🔒 Browser session killed");
		}
	}
}

// Run the main function
main().catch(console.error);
