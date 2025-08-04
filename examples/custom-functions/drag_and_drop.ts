/**
 * Drag and Drop Custom Action Example
 *
 * This example demonstrates how to implement drag and drop functionality as a custom action.
 * The drag and drop action supports both element-based and coordinate-based operations,
 * making it useful for canvas drawing, sortable lists, sliders, file uploads, and UI rearrangement.
 */

import { ActionResult, Agent, Controller } from "browsernode";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Drag and drop action parameters schema
const DragDropActionSchema = z.object({
	// Element-based approach
	elementSource: z
		.string()
		.optional()
		.describe("CSS selector or XPath for the source element to drag"),
	elementTarget: z
		.string()
		.optional()
		.describe("CSS selector or XPath for the target element to drop on"),
	elementSourceOffset: z
		.object({
			x: z.number().describe("X coordinate"),
			y: z.number().describe("Y coordinate"),
		})
		.optional()
		.describe("Optional offset from source element center (x, y)"),
	elementTargetOffset: z
		.object({
			x: z.number().describe("X coordinate"),
			y: z.number().describe("Y coordinate"),
		})
		.optional()
		.describe("Optional offset from target element center (x, y)"),

	// Coordinate-based approach
	coordSourceX: z
		.number()
		.optional()
		.describe("Source X coordinate for drag start"),
	coordSourceY: z
		.number()
		.optional()
		.describe("Source Y coordinate for drag start"),
	coordTargetX: z
		.number()
		.optional()
		.describe("Target X coordinate for drag end"),
	coordTargetY: z
		.number()
		.optional()
		.describe("Target Y coordinate for drag end"),

	// Operation parameters
	steps: z
		.number()
		.default(10)
		.describe("Number of intermediate steps during drag (default: 10)"),
	delayMs: z
		.number()
		.default(5)
		.describe("Delay in milliseconds between steps (default: 5)"),
});

type DragDropAction = z.infer<typeof DragDropActionSchema>;
type Position = { x: number; y: number };

async function createDragDropController(): Promise<Controller> {
	const controller = new Controller();

	// Register the drag and drop action
	controller.action(
		"Drag and drop elements or between coordinates on the page - useful for canvas drawing, sortable lists, sliders, file uploads, and UI rearrangement",
		{
			paramModel: DragDropActionSchema,
		},
	)(async function dragDrop(
		params: DragDropAction,
		page: Page,
	): Promise<ActionResult> {
		/**
		 * Get source and target elements with appropriate error handling
		 */
		async function getDragElements(
			page: Page,
			sourceSelector: string,
			targetSelector: string,
		): Promise<[any | null, any | null]> {
			let sourceElement: any = null;
			let targetElement: any = null;

			try {
				// Use page.locator() which auto-detects CSS and XPath
				const sourceLocator = page.locator(sourceSelector);
				const targetLocator = page.locator(targetSelector);

				// Check if elements exist
				const sourceCount = await sourceLocator.count();
				const targetCount = await targetLocator.count();

				if (sourceCount > 0) {
					sourceElement = await sourceLocator.first().elementHandle();
					console.log(`Found source element with selector: ${sourceSelector}`);
				} else {
					console.log(`Source element not found: ${sourceSelector}`);
				}

				if (targetCount > 0) {
					targetElement = await targetLocator.first().elementHandle();
					console.log(`Found target element with selector: ${targetSelector}`);
				} else {
					console.log(`Target element not found: ${targetSelector}`);
				}
			} catch (e) {
				console.log(`Error finding elements: ${e}`);
			}

			return [sourceElement, targetElement];
		}

		/**
		 * Get coordinates from elements with appropriate error handling
		 */
		async function getElementCoordinates(
			sourceElement: any,
			targetElement: any,
			sourcePosition?: Position | null,
			targetPosition?: Position | null,
		): Promise<[[number, number] | null, [number, number] | null]> {
			let sourceCoords: [number, number] | null = null;
			let targetCoords: [number, number] | null = null;

			try {
				// Get source coordinates
				if (sourcePosition) {
					sourceCoords = [sourcePosition.x, sourcePosition.y];
				} else {
					const sourceBox = await sourceElement.boundingBox();
					if (sourceBox) {
						sourceCoords = [
							Math.round(sourceBox.x + sourceBox.width / 2),
							Math.round(sourceBox.y + sourceBox.height / 2),
						];
					}
				}

				// Get target coordinates
				if (targetPosition) {
					targetCoords = [targetPosition.x, targetPosition.y];
				} else {
					const targetBox = await targetElement.boundingBox();
					if (targetBox) {
						targetCoords = [
							Math.round(targetBox.x + targetBox.width / 2),
							Math.round(targetBox.y + targetBox.height / 2),
						];
					}
				}
			} catch (e) {
				console.log(`Error getting element coordinates: ${e}`);
			}

			return [sourceCoords, targetCoords];
		}

		/**
		 * Execute the drag operation with comprehensive error handling
		 */
		async function executeDragOperation(
			page: Page,
			sourceX: number,
			sourceY: number,
			targetX: number,
			targetY: number,
			steps: number,
			delayMs: number,
		): Promise<[boolean, string]> {
			try {
				// Try to move to source position
				try {
					await page.mouse.move(sourceX, sourceY);
					console.log(`Moved to source position (${sourceX}, ${sourceY})`);
				} catch (e) {
					console.log(`Failed to move to source position: ${e}`);
					return [false, `Failed to move to source position: ${e}`];
				}

				// Press mouse button down
				await page.mouse.down();

				// Move to target position with intermediate steps
				for (let i = 1; i <= steps; i++) {
					const ratio = i / steps;
					const intermediateX = Math.round(
						sourceX + (targetX - sourceX) * ratio,
					);
					const intermediateY = Math.round(
						sourceY + (targetY - sourceY) * ratio,
					);

					await page.mouse.move(intermediateX, intermediateY);

					if (delayMs > 0) {
						await new Promise((resolve) => setTimeout(resolve, delayMs));
					}
				}

				// Move to final target position
				await page.mouse.move(targetX, targetY);

				// Move again to ensure dragover events are properly triggered
				await page.mouse.move(targetX, targetY);

				// Release mouse button
				await page.mouse.up();

				return [true, "Drag operation completed successfully"];
			} catch (e) {
				return [false, `Error during drag operation: ${e}`];
			}
		}

		try {
			// Initialize variables
			let sourceX: number | null = null;
			let sourceY: number | null = null;
			let targetX: number | null = null;
			let targetY: number | null = null;

			// Normalize parameters
			const steps = Math.max(1, params.steps || 10);
			const delayMs = Math.max(0, params.delayMs || 5);

			// Case 1: Element selectors provided
			if (params.elementSource && params.elementTarget) {
				console.log("Using element-based approach with selectors");

				const [sourceElement, targetElement] = await getDragElements(
					page,
					params.elementSource,
					params.elementTarget,
				);

				if (!sourceElement || !targetElement) {
					const errorMsg = `Failed to find ${!sourceElement ? "source" : "target"} element`;
					return new ActionResult({
						error: errorMsg,
						includeInMemory: true,
					});
				}

				const [sourceCoords, targetCoords] = await getElementCoordinates(
					sourceElement,
					targetElement,
					params.elementSourceOffset,
					params.elementTargetOffset,
				);

				if (!sourceCoords || !targetCoords) {
					const errorMsg = `Failed to determine ${!sourceCoords ? "source" : "target"} coordinates`;
					return new ActionResult({
						error: errorMsg,
						includeInMemory: true,
					});
				}

				[sourceX, sourceY] = sourceCoords;
				[targetX, targetY] = targetCoords;

				// Case 2: Coordinates provided directly
			} else if (
				params.coordSourceX !== undefined &&
				params.coordSourceY !== undefined &&
				params.coordTargetX !== undefined &&
				params.coordTargetY !== undefined
			) {
				console.log("Using coordinate-based approach");
				sourceX = params.coordSourceX;
				sourceY = params.coordSourceY;
				targetX = params.coordTargetX;
				targetY = params.coordTargetY;
			} else {
				const errorMsg =
					"Must provide either source/target selectors or source/target coordinates";
				return new ActionResult({
					error: errorMsg,
					includeInMemory: true,
				});
			}

			// Validate coordinates
			if (
				sourceX === null ||
				sourceY === null ||
				targetX === null ||
				targetY === null
			) {
				const errorMsg = "Failed to determine source or target coordinates";
				return new ActionResult({
					error: errorMsg,
					includeInMemory: true,
				});
			}

			// Perform the drag operation
			const [success, message] = await executeDragOperation(
				page,
				sourceX,
				sourceY,
				targetX,
				targetY,
				steps,
				delayMs,
			);

			if (!success) {
				console.log(`Drag operation failed: ${message}`);
				return new ActionResult({
					error: message,
					includeInMemory: true,
				});
			}

			// Create descriptive message
			let msg: string;
			if (params.elementSource && params.elementTarget) {
				msg = `🖱️ Dragged element '${params.elementSource}' to '${params.elementTarget}'`;
			} else {
				msg = `🖱️ Dragged from (${sourceX}, ${sourceY}) to (${targetX}, ${targetY})`;
			}

			console.log(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
				longTermMemory: msg,
			});
		} catch (e) {
			const errorMsg = `Failed to perform drag and drop: ${e}`;
			console.log(errorMsg);
			return new ActionResult({
				error: errorMsg,
				includeInMemory: true,
			});
		}
	});

	return controller;
}

async function exampleDragDropSortableList(): Promise<void> {
	/**
	 * Example: Drag and drop to reorder items in a sortable list
	 */
	const controller = await createDragDropController();

	// Initialize LLM
	const llm = new ChatOpenAI({
		model: "gpt-4.1-mini",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create the agent
	const agent = new Agent({
		task: "Go to a drag and drop demo website like https://jqueryui.com/sortable/ and reorder some list items using drag and drop",
		llm: llm,
		controller: controller,
	});

	// Run the agent
	console.log("🚀 Starting drag and drop sortable list example...");
	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

async function exampleDragDropCoordinates(): Promise<void> {
	/**
	 * Example: Direct coordinate-based drag and drop
	 */
	const controller = await createDragDropController();

	const llm = new ChatOpenAI({
		model: "gpt-4.1-mini",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	const agent = new Agent({
		task: "Go to a canvas drawing website like https://sketch.io/sketchpad/ and draw a simple line using drag and drop from coordinates (200, 200) to (400, 300)",
		llm: llm,
		controller: controller,
	});

	console.log("🎨 Starting coordinate-based drag and drop example...");
	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

async function exampleDragDropFileUpload(): Promise<void> {
	/**
	 * Example: Drag and drop for file upload
	 */
	const controller = await createDragDropController();

	const llm = new ChatOpenAI({
		model: "gpt-4.1-mini",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	const agent = new Agent({
		task: "Go to a file upload demo website that supports drag and drop, find a file input area, and simulate dragging a file to upload it",
		llm: llm,
		controller: controller,
	});

	console.log("📁 Starting drag and drop file upload example...");
	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

async function main(): Promise<void> {
	// You can run different examples by commenting/uncommenting the lines below

	console.log("Choose an example:");
	console.log("1. Sortable list drag and drop");
	console.log("2. Coordinate-based drawing");
	console.log("3. File upload drag and drop");

	// For demo purposes, we'll run the sortable list example
	// In a real scenario, you could use process.argv or a prompt library to get user input
	const choice = process.argv[2] || "1";

	switch (choice) {
		case "1":
			await exampleDragDropSortableList();
			break;
		case "2":
			await exampleDragDropCoordinates();
			break;
		case "3":
			await exampleDragDropFileUpload();
			break;
		default:
			console.log("Invalid choice, running sortable list example...");
			await exampleDragDropSortableList();
			break;
	}
}

main().catch(console.error);
