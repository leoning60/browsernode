import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { BrowserStateHistory } from "../browser/views";

import winston from "winston";
import bnLogger from "../logging_config";

const logger = bnLogger.child({
	module: "browser_node/agent/gif",
});

interface CreateHistoryGifOptions {
	outputPath?: string;
	duration?: number;
	showGoals?: boolean;
	showTask?: boolean;
	showLogo?: boolean;
	fontSize?: number;
	titleFontSize?: number;
	goalFontSize?: number;
	margin?: number;
	lineSpacing?: number;
}

interface ModelOutput {
	current_state: {
		next_goal: string;
	};
}

interface HistoryItem {
	state: {
		screenshot: string | null;
	};
	model_output?: ModelOutput;
}

interface AgentHistoryList {
	history: HistoryItem[];
}

export async function createHistoryGif(
	task: string,
	history: AgentHistoryList,
	options: CreateHistoryGifOptions = {},
): Promise<void> {
	const {
		outputPath = "agent_history.gif",
		duration = 3000,
		showGoals = true,
		showTask = true,
		showLogo = false,
		fontSize = 40,
		titleFontSize = 56,
		goalFontSize = 44,
		margin = 40,
		lineSpacing = 1.5,
	} = options;

	if (!history.history.length) {
		logger.warn("No history to create GIF from");
		return;
	}

	if (!history.history[0]?.state.screenshot) {
		logger.warn("No history or first screenshot to create GIF from");
		return;
	}

	const images: Buffer[] = [];

	// Create task frame if needed
	if (showTask && task) {
		const taskFrame = await createTaskFrame(
			task,
			history.history[0].state.screenshot,
			titleFontSize,
			fontSize,
			showLogo,
			lineSpacing,
		);
		images.push(taskFrame);
	}

	// Process each history item
	for (let i = 0; i < history.history.length; i++) {
		const item = history.history[i];
		if (!item?.state.screenshot) continue;

		const imageBuffer = Buffer.from(item.state.screenshot, "base64");
		let image = sharp(imageBuffer);

		if (showGoals && item.model_output) {
			image = await addOverlayToImage(
				image,
				i + 1,
				item.model_output.current_state.next_goal,
				fontSize,
				titleFontSize,
				margin,
				showLogo,
			);
		}

		const processedImage = await image.toBuffer();
		images.push(processedImage);
	}

	if (images.length) {
		// Create GIF using sharp
		await sharp(images[0], { animated: true })
			.gif({
				delay: duration,
				loop: 0,
			})
			.toFile(outputPath);
		logger.info(`Created GIF at ${outputPath}`);
	} else {
		logger.warn("No images found in history to create GIF");
	}
}

async function createTaskFrame(
	task: string,
	firstScreenshot: string,
	titleFontSize: number,
	regularFontSize: number,
	showLogo: boolean,
	lineSpacing: number,
): Promise<Buffer> {
	const imageBuffer = Buffer.from(firstScreenshot, "base64");
	const metadata = await sharp(imageBuffer).metadata();

	// Create black background
	const image = sharp({
		create: {
			width: metadata.width!,
			height: metadata.height!,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 1 },
		},
	});

	// Add text overlay
	const svgText = `
        <svg width="${metadata.width}" height="${metadata.height}">
            <style>
                .text { fill: white; font-family: Arial, sans-serif; }
                .title { font-size: ${titleFontSize}px; }
                .regular { font-size: ${regularFontSize}px; }
            </style>
            <text x="50%" y="50%" class="text regular" text-anchor="middle">
                ${wrapText(task, regularFontSize, metadata.width! - 2 * 140)}
            </text>
        </svg>
    `;

	const processedImage = await image
		.composite([
			{
				input: Buffer.from(svgText),
				top: 0,
				left: 0,
			},
		])
		.toBuffer();

	return processedImage;
}

async function addOverlayToImage(
	image: sharp.Sharp,
	stepNumber: number,
	goalText: string,
	regularFontSize: number,
	titleFontSize: number,
	margin: number,
	showLogo: boolean,
): Promise<sharp.Sharp> {
	const metadata = await image.metadata();

	const svgOverlay = `
        <svg width="${metadata.width}" height="${metadata.height}">
            <style>
                .text { fill: white; font-family: Arial, sans-serif; }
                .title { font-size: ${titleFontSize}px; }
                .regular { font-size: ${regularFontSize}px; }
                .bg { fill: rgba(0,0,0,0.8); rx: 15; ry: 15; }
            </style>
            
            <!-- Step number background -->
            <rect x="${margin + 10}" y="${metadata.height! - margin - 60}" 
                  width="60" height="60" class="bg"/>
            
            <!-- Step number -->
            <text x="${margin + 40}" y="${metadata.height! - margin - 20}" 
                  class="text title" text-anchor="middle">${stepNumber}</text>
            
            <!-- Goal text background -->
            <rect x="${margin}" y="${metadata.height! - margin - 120}" 
                  width="${metadata.width! - 2 * margin}" height="100" class="bg"/>
            
            <!-- Goal text -->
            <text x="50%" y="${metadata.height! - margin - 60}" 
                  class="text title" text-anchor="middle">
                ${wrapText(goalText, titleFontSize, metadata.width! - 4 * margin)}
            </text>
        </svg>
    `;

	return image.composite([
		{
			input: Buffer.from(svgOverlay),
			top: 0,
			left: 0,
		},
	]);
}

function wrapText(text: string, fontSize: number, maxWidth: number): string {
	const words = text.split(" ");
	const lines: string[] = [];
	let currentLine: string[] = [];

	for (const word of words) {
		currentLine.push(word);
		const line = currentLine.join(" ");
		// Approximate text width (this is a rough estimation)
		const lineWidth = line.length * fontSize * 0.6;

		if (lineWidth > maxWidth) {
			if (currentLine.length === 1) {
				lines.push(currentLine.pop()!);
			} else {
				currentLine.pop();
				lines.push(currentLine.join(" "));
				currentLine = [word];
			}
		}
	}

	if (currentLine.length) {
		lines.push(currentLine.join(" "));
	}

	return lines.join("\n");
}
