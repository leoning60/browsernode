/**
 * Examples demonstrating browser window sizing features.
 *
 * This example shows how to:
 * 1. Set a custom window size for the browser
 * 2. Verify the actual viewport dimensions
 * 3. Use various browser configuration options
 *
 * Run this example with: `npx tsx examples/browser/window_sizing.ts`
 */

import { BrowserProfile, BrowserSession } from "browsernode";
import { config } from "dotenv";

config();

async function exampleCustomWindowSize(): Promise<void> {
	console.log("\n=== Example 1: Custom Window Size ===");

	// Create a browser profile with a specific window size
	const profile = new BrowserProfile({
		windowSize: { width: 800, height: 600 }, // Small size for demonstration
		// You can also use playwright device profiles:
		// device: playwright.devices['iPhone 13'],
		// deviceScaleFactor: 1.0, // change to 2~3 to emulate a high-DPI display for high-res screenshots
		// viewport: { width: 800, height: 600 }, // set the viewport (aka content size)
		// screen: { width: 800, height: 600 }, // hardware display size to report to websites via JS
		headless: false, // Use non-headless mode to see the window
	});

	let browserSession: BrowserSession | null = null;

	try {
		// Initialize and start the browser session
		browserSession = new BrowserSession({
			browserProfile: profile,
		});

		await browserSession.start();

		// Get the current page
		const page = await browserSession.getCurrentPage();

		// Navigate to a test page
		await page.goto("https://example.com", { waitUntil: "domcontentloaded" });

		// Wait a bit to see the window
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Get the actual viewport size using JavaScript
		const actualContentSize = await (page as any).evaluate(`() => ({
			width: window.innerWidth,
			height: window.innerHeight,
		})`);

		let expectedPageSize: { width: number; height: number };

		if (profile.viewport) {
			expectedPageSize = { ...profile.viewport };
		} else if (profile.windowSize) {
			expectedPageSize = {
				width: profile.windowSize.width,
				height: profile.windowSize.height - 87, // 87px is the height of the navbar, title, rim ish
			};
		} else {
			// Default expected size if neither viewport nor window_size is set
			expectedPageSize = { width: 800, height: 600 };
		}

		const logSize = (size: { width: number; height: number }) =>
			`${size.width}x${size.height}px`;
		console.log(
			`Expected ${logSize(expectedPageSize)} vs actual ${logSize(actualContentSize)}`,
		);

		// Validate the window size
		validateWindowSize(expectedPageSize, actualContentSize);

		// Wait a bit more to see the window
		await new Promise((resolve) => setTimeout(resolve, 2000));
	} catch (error) {
		console.error(`Error in example 1: ${error}`);
	} finally {
		// Close resources
		if (browserSession) {
			await browserSession.close();
		}
	}
}

async function exampleNoViewportOption(): Promise<void> {
	console.log("\n=== Example 2: Window Sizing with viewport configuration ===");

	const profile = new BrowserProfile({
		windowSize: { width: 1440, height: 900 },
		viewport: undefined, // Disable viewport override
		headless: false,
	});

	let browserSession: BrowserSession | null = null;

	try {
		browserSession = new BrowserSession({
			browserProfile: profile,
		});

		await browserSession.start();

		const page = await browserSession.getCurrentPage();
		await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Get viewport size (inner dimensions)
		const viewport = await (page as any).evaluate(() => ({
			width: window.innerWidth,
			height: window.innerHeight,
		}));

		if (profile.windowSize) {
			console.log(
				`Configured size: width=${profile.windowSize.width}, height=${profile.windowSize.height}`,
			);
		} else {
			console.log("No window size configured");
		}
		console.log(`Actual viewport size: ${JSON.stringify(viewport)}`);

		// Get the actual window size (outer dimensions)
		const windowSize = await (page as any).evaluate(() => ({
			width: window.outerWidth,
			height: window.outerHeight,
		}));
		console.log(`Actual window size (outer): ${JSON.stringify(windowSize)}`);

		await new Promise((resolve) => setTimeout(resolve, 2000));
	} catch (error) {
		console.error(`Error in example 2: ${error}`);
	} finally {
		if (browserSession) {
			await browserSession.close();
		}
	}
}

function validateWindowSize(
	configured: { width: number; height: number },
	actual: { width: number; height: number },
): void {
	/**
	 * Compare configured window size with actual size and report differences.
	 *
	 * @throws {Error} If the window size difference exceeds tolerance
	 */

	// Allow for small differences due to browser chrome, scrollbars, etc.
	const widthDiff = Math.abs(configured.width - actual.width);
	const heightDiff = Math.abs(configured.height - actual.height);

	// Tolerance of 5% or 20px, whichever is greater
	const widthTolerance = Math.max(configured.width * 0.05, 20);
	const heightTolerance = Math.max(configured.height * 0.05, 20);

	if (widthDiff > widthTolerance || heightDiff > heightTolerance) {
		console.log(
			`⚠️  WARNING: Significant difference between expected and actual page size! ±${widthDiff}x${heightDiff}px`,
		);
		throw new Error("Window size validation failed");
	} else {
		console.log(
			"✅ Window size validation passed: actual size matches configured size within tolerance",
		);
	}
}

async function main(): Promise<void> {
	/**
	 * Run all window sizing examples
	 */
	console.log("Browser Window Sizing Examples");
	console.log("==============================");

	// Run example 1
	await exampleCustomWindowSize();

	// Run example 2
	await exampleNoViewportOption();

	console.log("\n✅ All examples completed!");
}

// Run the examples
main().catch(console.error);
