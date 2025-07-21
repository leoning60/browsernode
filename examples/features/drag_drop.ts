/**
 * Drag and Drop Features Example
 *  ❌ Task completed without success
 *
 * This example demonstrates drag and drop functionality with two tasks:
 * 1. Reordering items in a sortable list
 * 2. Drawing a triangle in Excalidraw using drag operations
 *
 * Required Environment Variables:
 * - GOOGLE_API_KEY: Your Google API key for Gemini
 *
 * Installation:
 * 1. npm install
 * 2. Copy .env.example to .env and add your GOOGLE_API_KEY
 * 3. npx tsx examples/features/drag_drop.ts [--task 1|2]
 */

import { Agent, Controller } from "browsernode";
import { ChatGoogle } from "browsernode/llm";
import { Command } from "commander";
import { config } from "dotenv";

// Load environment variables
config();

// Task definitions
const task1 = `
Navigate to: https://sortablejs.github.io/Sortable/.
Look for any sortable list example on the page - it might be titled "Simple list", "Basic example", "Sortable List", or similar.
If you can't find "Simple list example" specifically, use any visible sortable list with draggable items.
Once you find a sortable list, drag the first item to a position below the third item.
Use the scrollToText action to search for "sortable" or "list" or "example" text if regular scrolling doesn't work.
`;

const task2 = `
Navigate to: https://excalidraw.com/.
Wait for the page to fully load, then look for drawing tools.
Click on the drawing/pencil tool (it might be in different positions, look for pencil, pen, or draw icons).
Then draw a triangle on the canvas starting from coordinate (400,400).
Use drag and drop actions to create the triangle by drawing three connected lines.
`;

function initializeLlm(): ChatGoogle {
	const apiKey = process.env.GOOGLE_API_KEY;
	if (!apiKey) {
		throw new Error("GOOGLE_API_KEY is not set in environment variables");
	}

	return new ChatGoogle({
		model: "gemini-2.5-flash",
		apiKey: apiKey,
		temperature: 0.0,
	});
}

async function runTask(taskNumber: number): Promise<void> {
	return runTaskInternal(taskNumber, true);
}

// Add a troubleshooting function
async function runTaskWithTroubleshooting(taskNumber: number): Promise<void> {
	console.log("🔧 Running task with enhanced troubleshooting...\n");

	// Enhanced task with more specific instructions
	const enhancedTask1 = `
Navigate to: https://sortablejs.github.io/Sortable/.
IMPORTANT: Use these strategies in order:
1. First, use scrollToText action to search for "sortable" text on the page
2. If that doesn't work, use scrollToText to search for "example" text
3. Look for ANY list of items that appear draggable (usually have drag handles or hover effects)
4. The items might be named differently than "item 1", "item 2" - look for any numbered or named list items
5. Try dragging the first visible item in any sortable list to a position after the third item
6. If you see multiple examples, try the first visible one
`;

	const enhancedTask2 = `
Navigate to: https://excalidraw.com/.
IMPORTANT: Use these strategies:
1. Wait 3 seconds for the page to fully load
2. Look for ANY drawing tool icon (pencil, pen, brush, line tool)
3. The tool might not be at index 40 - scan for drawing tools in the toolbar
4. Once a drawing tool is selected, click and drag on the canvas to draw
5. Draw three lines to form a triangle, starting near coordinate (400,400)
`;

	const selectedTask = taskNumber === 2 ? enhancedTask2 : enhancedTask1;
	const taskName =
		taskNumber === 2 ? "Enhanced Excalidraw Drawing" : "Enhanced Sortable List";

	console.log(`🚀 Starting enhanced task ${taskNumber}: ${taskName}`);
	console.log(`📝 Enhanced task description: ${selectedTask.trim()}\n`);

	try {
		const llm = initializeLlm();
		const controller = new Controller();

		const agent = new Agent(selectedTask, llm, {
			controller: controller,
			useVision: true,
			maxActionsPerStep: 1,
		});

		console.log("🎯 Enhanced agent execution started...\n");

		// Run with more steps and better error handling
		const history = await agent.run(40);

		console.log("\n✅ Enhanced agent execution completed!");

		// Safe access to finalResult with null check
		const finalResult = history.finalResult();
		const resultText = finalResult || "No result available";
		console.log("Final result:", resultText);

		// Wait for user input before closing
		console.log("\nPress Enter to exit...");
		await new Promise((resolve) => {
			process.stdin.once("data", () => {
				resolve(void 0);
			});
		});

		// Force exit after user input
		console.log("🔚 Exiting...");
		process.exit(0);
	} catch (error) {
		console.error("💥 Error in enhanced task:", error);
		process.exit(1);
	}
}

async function main(): Promise<void> {
	// Set up command line argument parsing
	const program = new Command();
	program
		.option("--task <task>", "The task number to run (1 or 2)", "1")
		.option("--enhanced", "Run with enhanced troubleshooting strategies", false)
		.option("--both", "Run both tasks sequentially", false)
		.parse();

	const options = program.opts();
	const taskNumber = parseInt(options.task);

	// Validate task number
	if (![1, 2].includes(taskNumber) && !options.both) {
		console.error('Error: task must be either "1" or "2"');
		console.log("Task 1: Sortable list reordering");
		console.log("Task 2: Excalidraw triangle drawing");
		console.log("Options:");
		console.log("  --task 1       : Run sortable list task");
		console.log("  --task 2       : Run excalidraw task");
		console.log("  --enhanced     : Use enhanced troubleshooting");
		console.log("  --both         : Run both tasks");
		process.exit(1);
	}

	console.log(`🤖 Using Google Gemini (gemini-2.5-flash)`);

	if (options.both) {
		console.log("🎮 Running Both Tasks\n");
		await runBothTasks();
	} else if (options.enhanced) {
		console.log(
			`🔧 Running Enhanced Task ${taskNumber} with Troubleshooting\n`,
		);
		await runTaskWithTroubleshooting(taskNumber);
	} else {
		console.log(`🎮 Running Task ${taskNumber}\n`);
		await runTask(taskNumber);
	}
}

// Alternative function to run both tasks sequentially
async function runBothTasks(): Promise<void> {
	console.log("🎯 Running both tasks sequentially...\n");

	try {
		// Create modified versions that don't wait for user input
		await runTaskInternal(1, false); // Don't wait for input
		console.log("\n" + "=".repeat(50) + "\n");
		await runTaskInternal(2, false); // Don't wait for input

		// Wait for user input only once at the end
		console.log("\nBoth tasks completed! Press Enter to exit...");
		await new Promise((resolve) => {
			process.stdin.once("data", () => {
				resolve(void 0);
			});
		});

		// Force exit after user input
		console.log("🔚 Exiting...");
		process.exit(0);
	} catch (error) {
		console.error("💥 Error running tasks:", error);
		process.exit(1);
	}
}

// Internal function without user input wait
async function runTaskInternal(
	taskNumber: number,
	waitForInput: boolean = true,
): Promise<void> {
	// Select the task based on user input
	const selectedTask = taskNumber === 2 ? task2 : task1;
	const taskName =
		taskNumber === 2
			? "Excalidraw Triangle Drawing"
			: "Sortable List Reordering";

	console.log(`🚀 Starting task ${taskNumber}: ${taskName}`);
	console.log(`📝 Task description: ${selectedTask.trim()}\n`);

	try {
		// Initialize the language model
		const llm = initializeLlm();

		// Create controller with enhanced capabilities
		const controller = new Controller();

		// Add enhanced drag and drop instruction
		if (taskNumber === 1) {
			console.log("💡 Enhanced Task 1 Strategy:");
			console.log("   - Use scrollToText to find 'sortable' or 'example' text");
			console.log("   - Look for any list with draggable items");
			console.log("   - Try alternative element selectors\n");
		}

		// Create agent with extended timeout and more steps
		const agent = new Agent(selectedTask, llm, {
			controller: controller,
			useVision: true,
			maxActionsPerStep: 1,
		});

		console.log("🎯 Agent execution started...\n");

		// Run the agent with more steps for complex tasks
		const maxSteps = taskNumber === 1 ? 35 : 25; // Give more steps for the sortable task
		const history = await agent.run(maxSteps);

		console.log("\n✅ Agent execution completed!");

		// Safe access to finalResult with null check
		const finalResult = history.finalResult();
		const resultText = finalResult || "No result available";
		console.log("Final result:", resultText);

		// Show success/failure status with null check
		const isSuccess = finalResult
			? finalResult.toLowerCase().includes("success") ||
				(!finalResult.toLowerCase().includes("could not") &&
					!finalResult.toLowerCase().includes("unable"))
			: false;

		console.log(
			`\n${isSuccess ? "🎉" : "❌"} Task Status: ${isSuccess ? "SUCCESS" : "INCOMPLETE"}`,
		);

		// Wait for user input only if requested
		if (waitForInput) {
			console.log("\nPress Enter to exit...");
			await new Promise((resolve) => {
				process.stdin.once("data", () => {
					resolve(void 0);
				});
			});

			// Force exit after user input
			console.log("🔚 Exiting...");
			process.exit(0);
		}
	} catch (error) {
		console.error("💥 Error running agent:", error);
		if (waitForInput) {
			process.exit(1);
		}
		throw error; // Re-throw for batch processing
	}
}

// Export functions for potential reuse
export {
	runTask,
	runBothTasks,
	runTaskWithTroubleshooting,
	task1,
	task2,
	initializeLlm,
};

// Run the main function
main().catch(console.error);
