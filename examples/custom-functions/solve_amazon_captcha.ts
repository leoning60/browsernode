import { ActionResult, Agent, Controller } from "browsernode";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Initialize controller
const controller = new Controller();

// 2captcha API configuration
const API_KEY = process.env.CAPTCHA_API_KEY || "";
const API_BASE_URL = "https://api.2captcha.com";

// Helper function to create task
async function createTask(taskData: any): Promise<string> {
	const response = await fetch(`${API_BASE_URL}/createTask`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			clientKey: API_KEY,
			task: taskData,
		}),
	});

	const result = (await response.json()) as any;

	if (result.errorId !== 0) {
		throw new Error(`Task creation failed: ${result.errorDescription}`);
	}

	return result.taskId;
}

// Helper function to get task result
async function getTaskResult(taskId: string): Promise<any> {
	const maxAttempts = 30; // 30 attempts with 5 second intervals = 2.5 minutes max
	let attempts = 0;

	while (attempts < maxAttempts) {
		const response = await fetch(`${API_BASE_URL}/getTaskResult`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				clientKey: API_KEY,
				taskId: taskId,
			}),
		});

		const result = (await response.json()) as any;

		if (result.errorId !== 0) {
			throw new Error(`Get result failed: ${result.errorDescription}`);
		}

		if (result.status === "ready") {
			return result.solution;
		}

		// Wait 5 seconds before next attempt
		await new Promise((resolve) => setTimeout(resolve, 5000));
		attempts++;
	}

	throw new Error("Task timeout: captcha solving took too long");
}

// Solve Amazon text based captcha - custom action
controller.action("Solve Amazon text based captcha", {
	domains: [
		"*.amazon.com",
		"*.amazon.co.uk",
		"*.amazon.ca",
		"*.amazon.de",
		"*.amazon.es",
		"*.amazon.fr",
		"*.amazon.it",
		"*.amazon.co.jp",
		"*.amazon.in",
		"*.amazon.cn",
		"*.amazon.com.sg",
		"*.amazon.com.mx",
		"*.amazon.ae",
		"*.amazon.com.br",
		"*.amazon.nl",
		"*.amazon.com.au",
		"*.amazon.com.tr",
		"*.amazon.sa",
		"*.amazon.se",
		"*.amazon.pl",
	],
	paramModel: z.object({}), // No parameters needed
})(async function solveAmazonCaptcha(params: Record<string, any>, page: Page) {
	// Find the captcha image and extract its src
	const captchaImg = page.locator('img[src*="amazon.com/captcha"]');
	const link = await captchaImg.getAttribute("src");

	if (!link) {
		throw new Error("Could not find captcha image on the page");
	}

	// Create task using 2captcha v2 API for image captcha
	const taskData = {
		type: "ImageToTextTask",
		body: link,
	};

	const taskId = await createTask(taskData);

	// Get the result
	const solution = await getTaskResult(taskId);

	if (!solution || !solution.text) {
		throw new Error("Captcha could not be solved");
	}

	const captchaText = solution.text;

	// Fill in the captcha solution and submit
	await page.locator("#captchacharacters").fill(captchaText);
	await page.locator('button[type="submit"]').click();

	return new ActionResult({
		extractedContent: captchaText,
		includeInMemory: true,
		longTermMemory: `Solved Amazon captcha: ${captchaText}`,
	});
});

async function main() {
	const task = `
	Go to https://www.amazon.com/errors/validateCaptcha and solve the captcha using the solve_amazon_captcha tool.
	`;

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent({
		task: task,
		llm: llm,
		controller: controller,
	});

	const result = await agent.run();
	console.log(`🎯 Task completed: ${result}`);
}

// Run the main function
main().catch(console.error);
