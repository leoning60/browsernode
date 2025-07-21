import { Client } from "@gradio/client";
import { Agent, ChatOpenAI } from "browsernode";
import type { ActionResult, AgentHistoryList } from "browsernode";
import cors from "cors";
import { config } from "dotenv";
import express from "express";

// Load environment variables
config();

interface ActionResultData {
	isDone: boolean;
	extractedContent: string | null;
	error: string | null;
	includeInMemory: boolean;
}

interface AgentHistoryData {
	allResults: ActionResultData[];
	allModelOutputs: Record<string, any>[];
}

/**
 * Parse agent history and return formatted string for display
 */
function parseAgentHistory(history: AgentHistoryList): string {
	const results: string[] = [];

	try {
		// Get all action results from the history
		const actionResults = history.history;

		actionResults.forEach((step, index) => {
			if (step.result && step.result.length > 0) {
				const result = step.result[0];
				if (result && result.extractedContent) {
					results.push(`Step ${index + 1}:\n${result.extractedContent}\n`);
				}
			}
		});

		// If no extracted content, show the final result
		if (results.length === 0) {
			const finalResult = history.finalResult();
			if (finalResult) {
				results.push(`Final Result:\n${finalResult}`);
			}
		}

		return (
			results.join("\n---\n") || "No content extracted from the task execution."
		);
	} catch (error) {
		return `Error parsing history: ${error}`;
	}
}

/**
 * Run browser automation task using browsernode
 */
async function runBrowserTask(
	task: string,
	apiKey: string,
	model: string = "gpt-4o",
	headless: boolean = true,
): Promise<string> {
	if (!apiKey.trim()) {
		return "Please provide an API key";
	}

	// Set the API key for the session
	process.env.OPENAI_API_KEY = apiKey;

	try {
		// Initialize the LLM
		const llm = new ChatOpenAI({
			model: model,
			temperature: 0.0,
			apiKey: apiKey,
		});

		// Create and run the agent
		const agent = new Agent(task, llm, {
			useVision: true,
			maxActionsPerStep: 10,
		});

		const result = await agent.run();

		// Parse and format the result for display
		const formattedResult = parseAgentHistory(result);

		return formattedResult;
	} catch (error) {
		return `Error: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/**
 * Create and configure the Gradio interface
 */
async function createUI() {
	try {
		// Initialize Gradio client
		const app = await Client.connect("http://localhost:7860", {
			hf_token: undefined, // No HuggingFace token needed for local
		});

		console.log("Gradio client connected successfully");

		return app;
	} catch (error) {
		console.error("Failed to connect to Gradio:", error);
		throw error;
	}
}

/**
 * Simple web server alternative using Express (since @gradio/client needs a server)
 */
async function createExpressUI() {
	const app = express();
	const port = 3000;

	app.use(cors());
	app.use(express.json());
	app.use(express.static("public"));

	// Serve the HTML interface
	app.get("/", (req: any, res: any) => {
		res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Browsernode Task Automation</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .container { display: flex; gap: 20px; }
        .input-section, .output-section { flex: 1; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input, textarea, select, button { width: 100%; padding: 8px; }
        textarea { min-height: 100px; }
        button { background-color: #007bff; color: white; border: none; cursor: pointer; }
        button:hover { background-color: #0056b3; }
        button:disabled { background-color: #6c757d; cursor: not-allowed; }
        #output { border: 1px solid #ccc; padding: 10px; min-height: 200px; white-space: pre-wrap; background-color: #f8f9fa; }
        .loading { color: #007bff; }
        .error { color: #dc3545; }
        .success { color: #28a745; }
    </style>
</head>
<body>
    <h1>🤖 Browsernode Task Automation</h1>
    
    <div class="container">
        <div class="input-section">
            <div class="form-group">
                <label for="apiKey">OpenAI API Key:</label>
                <input type="password" id="apiKey" placeholder="sk-...">
            </div>
            
            <div class="form-group">
                <label for="task">Task Description:</label>
                <textarea id="task" placeholder="E.g., Find flights from New York to London for next week"></textarea>
            </div>
            
            <div class="form-group">
                <label for="model">Model:</label>
                <select id="model">
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                    <option value="gpt-4">gpt-4</option>
                    <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>
                    <input type="checkbox" id="headless" checked> Run Headless
                </label>
            </div>
            
            <button onclick="runTask()">Run Task</button>
        </div>
        
        <div class="output-section">
            <h3>Output:</h3>
            <div id="output">Ready to run tasks...</div>
        </div>
    </div>

    <script>
        async function runTask() {
            const apiKey = document.getElementById('apiKey').value;
            const task = document.getElementById('task').value;
            const model = document.getElementById('model').value;
            const headless = document.getElementById('headless').checked;
            const output = document.getElementById('output');
            const button = document.querySelector('button');
            
            if (!apiKey.trim()) {
                output.textContent = 'Please provide an API key';
                output.className = 'error';
                return;
            }
            
            if (!task.trim()) {
                output.textContent = 'Please provide a task description';
                output.className = 'error';
                return;
            }
            
            button.disabled = true;
            output.textContent = 'Running task...';
            output.className = 'loading';
            
            try {
                const response = await fetch('/run-task', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task, apiKey, model, headless })
                });
                
                const result = await response.text();
                output.textContent = result;
                output.className = response.ok ? 'success' : 'error';
            } catch (error) {
                output.textContent = 'Error: ' + error.message;
                output.className = 'error';
            }
            
            button.disabled = false;
        }
    </script>
</body>
</html>
        `);
	});

	// API endpoint to run tasks
	app.post("/run-task", async (req: any, res: any) => {
		try {
			const { task, apiKey, model, headless } = req.body;
			console.log(`Running task: ${task}`);

			const result = await runBrowserTask(task, apiKey, model, headless);
			res.send(result);
		} catch (error) {
			console.error("Error running task:", error);
			res
				.status(500)
				.send(
					`Error: ${error instanceof Error ? error.message : String(error)}`,
				);
		}
	});

	return new Promise<void>((resolve) => {
		app.listen(port, () => {
			console.log(`🚀 Browsernode UI running at http://localhost:${port}`);
			resolve();
		});
	});
}

/**
 * Main function
 */
async function main() {
	try {
		console.log("Starting Browsernode Gradio Demo...");

		// For now, we'll use Express instead of Gradio since @gradio/client
		// is primarily designed to connect to existing Gradio servers
		await createExpressUI();
	} catch (error) {
		console.error("Failed to start UI:", error);
		process.exit(1);
	}
}

// Run if this file is executed directly

main().catch(console.error);

export { runBrowserTask, parseAgentHistory, createUI, createExpressUI };
