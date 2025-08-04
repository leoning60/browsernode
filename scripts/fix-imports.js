#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, "..", "dist");

// Function to recursively find all .js files
function findJsFiles(dir) {
	const files = [];
	const items = fs.readdirSync(dir);

	for (const item of items) {
		const fullPath = path.join(dir, item);
		const stat = fs.statSync(fullPath);

		if (stat.isDirectory()) {
			files.push(...findJsFiles(fullPath));
		} else if (item.endsWith(".js")) {
			files.push(fullPath);
		}
	}

	return files;
}

// Function to fix imports in a file
function fixImports(filePath) {
	let content = fs.readFileSync(filePath, "utf8");
	let modified = false;

	// Fix import statements
	content = content.replace(
		/import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]*)['"]/g,
		(match, importPath) => {
			// Only fix relative imports that don't already have .js extension
			if (
				importPath.startsWith(".") &&
				!importPath.endsWith(".js") &&
				!importPath.includes("*")
			) {
				modified = true;
				// Check if the path points to a directory (no file extension)
				const targetPath = path.join(path.dirname(filePath), importPath);
				if (
					fs.existsSync(targetPath) &&
					fs.statSync(targetPath).isDirectory()
				) {
					// It's a directory, add /index.js
					return match.replace(importPath, importPath + "/index.js");
				} else {
					// It's a file, add .js
					return match.replace(importPath, importPath + ".js");
				}
			}
			return match;
		},
	);

	// Fix export statements
	content = content.replace(
		/export\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+['"]([^'"]*)['"]/g,
		(match, importPath) => {
			// Only fix relative imports that don't already have .js extension
			if (
				importPath.startsWith(".") &&
				!importPath.endsWith(".js") &&
				!importPath.includes("*")
			) {
				modified = true;
				// Check if the path points to a directory (no file extension)
				const targetPath = path.join(path.dirname(filePath), importPath);
				if (
					fs.existsSync(targetPath) &&
					fs.statSync(targetPath).isDirectory()
				) {
					// It's a directory, add /index.js
					return match.replace(importPath, importPath + "/index.js");
				} else {
					// It's a file, add .js
					return match.replace(importPath, importPath + ".js");
				}
			}
			return match;
		},
	);

	if (modified) {
		fs.writeFileSync(filePath, content, "utf8");
		console.log(`Fixed imports in: ${path.relative(process.cwd(), filePath)}`);
	}
}

// Main execution
console.log("Fixing imports in dist directory...");
const jsFiles = findJsFiles(distDir);

for (const file of jsFiles) {
	fixImports(file);
}

console.log("Import fixing completed!");
