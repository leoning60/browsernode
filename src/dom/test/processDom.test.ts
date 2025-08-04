import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
	type Browser,
	type BrowserContext,
	type Page,
	chromium,
} from "playwright";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

describe("DOM Tree Processing", () => {
	let browser: Browser;
	let context: BrowserContext;
	let page: Page;

	// Setup before tests
	beforeAll(async () => {
		browser = await chromium.launch({
			headless: false,
		});
	});

	// Cleanup after tests
	afterAll(async () => {
		await browser.close();
	});

	// Setup before each test
	beforeEach(async () => {
		context = await browser.newContext();
		page = await context.newPage();
	});

	// Cleanup after each test
	afterEach(async () => {
		await context.close();
	});

	test("should process DOM tree from xxx.com", { timeout: 20000 }, async () => {
			try {
				// Navigate to the test page
				console.log("Navigating to xxx.com...");
				await page.goto(
					"https://www.npmjs.com/package/@google-cloud/vertexai",
					{
						waitUntil: "networkidle", // wait for network requests to finish
					},
				);

				// Wait for the body element to be present
				console.log("Waiting for body element...");
				await page.waitForSelector("body", { state: "attached" });

				// Wait a bit longer for dynamic content
				console.log("Waiting for 3 seconds...");
				await page.waitForTimeout(3000);

				// Read the JavaScript file
				console.log("Reading buildDomTree.js file...");
				const jsCode = readFileSync(
					join(__dirname, "../buildDomTree.js"),
					"utf-8",
				);
				console.log("jsCode:", jsCode.substring(0, 100) + "...");

				// Add error handling wrapper around the evaluation
				console.log("Executing DOM tree processing...");
				const startTime = Date.now();
				const domTree = await page.evaluate(`(function() {
					try {
						console.log('Starting evaluation in browser...');
						const fn = ${jsCode};
						console.log('Function defined, now executing...');
						const result = fn();
						console.log('Function executed, result:', result);
						return result;
					} catch (error) {
						console.error('Browser error:', error);
						return { error: error.toString() };
					}
				})()`);
				console.log("domTree:", domTree);

				if (!domTree) {
					throw new Error("DOM tree processing returned undefined");
				}

				console.log(
					"DOM tree result:",
					JSON.stringify(domTree).substring(0, 100) + "...",
				);
				const endTime = Date.now();

				console.log(`Time: ${(endTime - startTime) / 1000}s`);

				// Save results to file
				mkdirSync("./tmp", { recursive: true });
				writeFileSync("./tmp/dom.json", JSON.stringify(domTree, null, 2));
			} catch (error) {
				console.error("Test error:", error);
				throw error;
			}
		},
	);
});
