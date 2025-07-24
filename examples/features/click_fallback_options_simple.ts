import * as fs from "fs";
import { createServer } from "http";
import * as path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { ActionResult, Agent, Controller } from "browsernode";
import type { Page } from "browsernode/browser/types";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define the HTML content for the test page
const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Click Test Page</title>
  <style>
    .custom-select {
      position: relative;
      width: 200px;
      font-family: Arial, sans-serif;
      margin-bottom: 20px;
    }

    .select-display {
      padding: 10px;
      border: 1px solid #ccc;
      background-color: #fff;
      cursor: pointer;
    }

    .select-options {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      border: 1px solid #ccc;
      border-top: none;
      background-color: #fff;
      display: none;
      max-height: 150px;
      overflow-y: auto;
      z-index: 100;
    }

    .select-option {
      padding: 10px;
      cursor: pointer;
    }

    .select-option:hover {
      background-color: #f0f0f0;
    }
  </style>
</head>
<body>
  <h1>Click Test Page</h1>
  
  <div class="custom-select">
    <div class="select-display">Select a fruit</div>
    <div class="select-options">
      <div class="select-option" data-value="option1">Apples</div>
      <div class="select-option" data-value="option2">Oranges</div>
      <div class="select-option" data-value="option3">Pineapples</div>
    </div>
  </div>

  <div class="custom-select">
    <div class="select-display">Select a fruit</div>
    <div class="select-options">
      <div class="select-option" data-value="option1">Apples</div>
      <div class="select-option" data-value="option2">Oranges</div>
      <div class="select-option" data-value="option3">Pineapples</div>
    </div>
  </div>

  <label for="cars">Choose a car:</label>
  <select name="cars" id="cars">
    <option value="volvo">Volvo</option>
    <option value="bmw">BMW</option>
    <option value="mercedes">Mercedes</option>
    <option value="audi">Audi</option>
  </select>

  <button onclick="alert('Button clicked!')">Click me</button>

  <script>
    document.querySelectorAll('.custom-select').forEach(customSelect => {
      const selectDisplay = customSelect.querySelector('.select-display');
      const selectOptions = customSelect.querySelector('.select-options');
      const options = customSelect.querySelectorAll('.select-option');

      selectDisplay.addEventListener('click', (e) => {
        // Close all other dropdowns
        document.querySelectorAll('.select-options').forEach(opt => {
          if (opt !== selectOptions) opt.style.display = 'none';
        });

        // Toggle current dropdown
        const isVisible = selectOptions.style.display === 'block';
        selectOptions.style.display = isVisible ? 'none' : 'block';

        e.stopPropagation();
      });

      options.forEach(option => {
        option.addEventListener('click', () => {
          selectDisplay.textContent = option.textContent;
          selectDisplay.dataset.value = option.getAttribute('data-value');
          selectOptions.style.display = 'none';
        });
      });
    });

    // Close all dropdowns if clicking outside
    document.addEventListener('click', () => {
      document.querySelectorAll('.select-options').forEach(opt => {
        opt.style.display = 'none';
      });
    });
  </script>
</body>
</html>
`;

// Function to start HTTP server
function startHttpServer(): Promise<{ server: any; port: number }> {
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			if (req.url === "/") {
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(HTML_CONTENT);
			} else {
				res.writeHead(404);
				res.end("Not found");
			}
		});

		server.listen(8000, () => {
			console.log("HTTP server running on http://localhost:8000");
			resolve({ server, port: 8000 });
		});
	});
}

// Initialize controller
const controller = new Controller();

async function main() {
	// Start the HTTP server
	const { server } = await startHttpServer();

	// Initialize the language model
	const llm = new ChatOpenAI({
		model: "gpt-4o",
		temperature: 0.0,
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Simple, explicit tasks that should work
	const tasks = [
		"Go to http://localhost:8000/ and click the first dropdown, then click on Oranges",
		"Go to http://localhost:8000/ and click the second dropdown, then click on Apples",
		"Go to http://localhost:8000/ and select BMW from the car dropdown",
		"Go to http://localhost:8000/ and click the button",
	];

	// Run different agent tasks
	for (let i = 0; i < tasks.length; i++) {
		const task = tasks[i];
		console.log(`\n🎯 Running task ${i + 1}/${tasks.length}: ${task}`);

		const agent = new Agent(task, llm, {
			controller: controller,
		});

		try {
			const result = await agent.run();
			console.log(`✅ Task ${i + 1} completed: ${result}`);
		} catch (error) {
			console.error(`❌ Task ${i + 1} failed:`, error);
		}

		// Add a small delay between tasks
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}

	// Wait for user input before shutting down
	console.log("\nPress Enter to close...");
	await new Promise((resolve) => {
		process.stdin.once("data", () => {
			resolve(void 0);
		});
	});

	// Close the server
	server.close(() => {
		console.log("HTTP server stopped.");
	});
}

// Run the main function
main().catch(console.error);
