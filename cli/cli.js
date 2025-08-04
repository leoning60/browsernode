#!/usr/bin/env node

import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Compiled JavaScript file path
const cliDistPath = join(__dirname, "../dist/cli.js");

const child = spawn("node", [cliDistPath, ...process.argv.slice(2)], {
	stdio: "inherit",
	env: process.env,
});

child.on("exit", (code) => {
	process.exit(code || 0);
});
