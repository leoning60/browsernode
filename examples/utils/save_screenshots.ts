import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

function getScreenshotsPath(
	outputPath: string,
	screenshotsDirName = "browsernode_screenshots",
) {
	const isoDate = new Date()
		.toISOString()
		.replace(/:/g, "-")
		.replace(/\./g, "-")
		.replace("Z", "Z");
	const outputDir = join(outputPath, screenshotsDirName, isoDate);
	mkdirSync(outputDir, { recursive: true });
	return outputDir;
}

export function saveScreenshots(
	screenshots: (string | null)[],
	parentDirPath: string,
) {
	if (!parentDirPath) {
		parentDirPath = dirname(fileURLToPath(import.meta.url));
	}
	const outputDir = getScreenshotsPath(parentDirPath);
	if (Array.isArray(screenshots) && screenshots.length > 0) {
		screenshots.forEach((b64, idx) => {
			const filePath = join(outputDir, `${idx + 1}.png`);
			writeFileSync(filePath, Buffer.from(b64!, "base64"));
			console.log(`Saved screenshot: ${filePath}`);
		});
	}
}
