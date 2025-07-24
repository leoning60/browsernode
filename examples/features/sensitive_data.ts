/**
 * Show how to handle sensitive data securely with domain-specific credentials.
 * The model will see placeholder names but never the actual values.
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import * as os from "os";
import * as path from "path";
import { Agent } from "browsernode";
import { BrowserProfile, BrowserSession } from "browsernode/browser";
import { ChatOpenAI } from "browsernode/llm";

try {
} catch (error) {
	console.log(`Error initializing Laminar: ${error}`);
}

async function main() {
	// Initialize the model
	const llm = new ChatOpenAI({
		model: "gpt-4o", // Note: gpt-4.1 doesn't exist, using gpt-4o instead
		temperature: 0.0,
	});

	// Simple case: the model will see x_name and x_password, but never the actual values.
	// const sensitiveData = { x_name: "my_x_name", x_password: "my_x_password" };

	// Advanced case: domain-specific credentials with reusable data
	// Define a single credential set that can be reused
	const companyCredentials = {
		company_username: "user@example.com",
		company_password: "securePassword123",
	};

	// Map the same credentials to multiple domains for secure access control
	const sensitiveData: Record<string, string | Record<string, string>> = {
		"https://example.com": companyCredentials,
		"https://admin.example.com": companyCredentials,
		"https://*.example-staging.com": companyCredentials,
		"http*://test.example.com": companyCredentials,
		// You can also add domain-specific credentials
		"https://*.google.com": {
			g_email: "user@gmail.com",
			g_pass: "google_password",
		},
	};

	// Update task to use one of the credentials above
	const task =
		"Go to google.com and put the login information in the search bar.";

	// Always set allowedDomains when using sensitiveData for security
	const allowedDomains = [
		...Object.keys(sensitiveData),
		"https://*.trusted-partner.com", // Additional allowed domains
	];

	// Create browser session with domain restrictions
	const browserSession = new BrowserSession({
		browserProfile: new BrowserProfile({
			allowedDomains: allowedDomains,
			userDataDir: path.join(
				os.homedir(),
				".config",
				"browsernode",
				"profiles",
				"default",
			),
		}),
	});

	// Create agent with sensitive data
	const agent = new Agent(task, llm, {
		sensitiveData: sensitiveData,
		browserSession: browserSession,
	});

	try {
		// Start the browser session
		await browserSession.start();

		// Run the agent
		await agent.run();

		console.log("✅ Agent execution completed with secure credential handling");
	} catch (error) {
		console.error("Error running agent:", error);
	} finally {
		// Close the browser session
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
