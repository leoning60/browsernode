#!/usr/bin/env node

import { spawn } from "child_process";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get tsx path
let tsxPath;
try {
	tsxPath = require.resolve("tsx/cli");
} catch (error) {
	console.error("tsx not found. Please install tsx: npm install tsx");
	process.exit(1);
}

// TypeScript source file path
const cliSourcePath = join(__dirname, "../src/cli.ts");

const child = spawn(
	"node",
	[tsxPath, cliSourcePath, ...process.argv.slice(2)],
	{
		stdio: "inherit",
		env: process.env,
	},
);

child.on("exit", (code) => {
	process.exit(code || 0);
});
