/**
 * Google Sheets Automation Example
 *
 * This example demonstrates how to use browsernode to automate Google Sheets operations:
 * - Opening and reading Google Sheets
 * - Setting up column headers
 * - Researching Fortune 100 CEOs and adding data
 * - Fact-checking entries
 *
 * The controller includes built-in Google Sheets actions:
 * - select_cell_or_range: Select specific cells or ranges (Ctrl+G navigation)
 * - get_range_contents: Get contents of cells using clipboard
 * - get_sheet_contents: Get entire sheet contents
 * - clear_selected_range: Clear selected cells
 * - input_selected_cell_text: Input text into selected cells
 * - update_range_contents: Batch update ranges with TSV data
 *
 * For more Google Sheets keyboard shortcuts and automation ideas, see:
 * - https://github.com/philc/sheetkeys/blob/master/content_scripts/sheet_actions.js
 * - https://github.com/philc/sheetkeys/blob/master/content_scripts/commands.js
 * - https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop#zippy=%2Cmac-shortcuts
 *
 * Tip: LLM is bad at spatial reasoning, don't make it navigate with arrow keys relative to current cell
 * if given arrow keys, it will try to jump from G1 to A2 by pressing Down, without realizing needs to go Down+LeftLeftLeftLeft
 */

import { Agent, BrowserProfile, BrowserSession, Controller } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { config } from "dotenv";

// Load environment variables
config();

// Check required environment variables
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

// Use the default controller with built-in Google Sheets actions
const controller = new Controller();

async function main() {
	const browserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			executablePath:
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			userDataDir: "~/.config/browsernode/profiles/default",
			keepAlive: true,
		}),
	});

	try {
		await browserSession.start();

		const model = new ChatOpenAI({
			model: "gpt-4o",
			apiKey: process.env.OPENAI_API_KEY!,
		});

		// Uncomment to clear existing data first
		// const eraser = new Agent(
		// 	`Clear all the existing values in columns A through M in this Google Sheet:
		// 	https://docs.google.com/spreadsheets/d/1INaIcfpYXlMRWO__de61SHFCaqt1lfHlcvtXZPItlpI/edit`,
		// 	model,
		// 	{
		// 		browserSession: browserSession,
		// 		controller: controller,
		// 	}
		// );
		// await eraser.run();

		const researcher = new Agent(
			`Open this Google Sheet and read it to understand the structure: https://docs.google.com/spreadsheets/d/1INaIcfpYXlMRWO__de61SHFCaqt1lfHlcvtXZPItlpI/edit
			Make sure column headers are present and all existing values in the sheet are formatted correctly.
			Columns should be labeled using the top row of cells:
				A: "Company Name"
				B: "CEO Full Name"
				C: "CEO Country of Birth"
				D: "Source URL where the information was found"
			Then Google to find the full name and nationality of each CEO of the top Fortune 100 companies and for each company,
			append a row to this existing Google Sheet. You can do a few searches at a time,
			but make sure to check the sheet for errors after inserting a new batch of rows.
			At the end, double check the formatting and structure and fix any issues by updating/overwriting cells.`,
			model,
			{
				browserSession: browserSession,
				controller: controller,
			},
		);

		console.log("🚀 Starting Google Sheets automation...");
		const result = await researcher.run();
		console.log("✅ Research task completed:", result);

		// Uncomment for additional tasks
		// const improvisedContinuer = new Agent(
		// 	`Read the Google Sheet https://docs.google.com/spreadsheets/d/1INaIcfpYXlMRWO__de61SHFCaqt1lfHlcvtXZPItlpI/edit
		// 	Add 3 more rows to the bottom continuing the existing pattern, make sure any data you add is sourced correctly.`,
		// 	model,
		// 	{
		// 		browserSession: browserSession,
		// 		controller: controller,
		// 	}
		// );
		// console.log("🔄 Adding more rows...");
		// await improvisedContinuer.run();

		// const finalFactChecker = new Agent(
		// 	`Read the Google Sheet https://docs.google.com/spreadsheets/d/1INaIcfpYXlMRWO__de61SHFCaqt1lfHlcvtXZPItlpI/edit
		// 	Fact-check every entry, add a new column F with your findings for each row.
		// 	Make sure to check the source URL for each row, and make sure the information is correct.`,
		// 	model,
		// 	{
		// 		browserSession: browserSession,
		// 		controller: controller,
		// 	}
		// );
		// console.log("🔍 Fact-checking entries...");
		// await finalFactChecker.run();
	} catch (error) {
		console.error("❌ Error during automation:", error);
	} finally {
		// Clean up browser session
		await browserSession.close();
		console.log("🧹 Browser session closed");
	}
}

// Run the main function
main().catch(console.error);
