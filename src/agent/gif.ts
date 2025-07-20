import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { Logger } from "winston";
import bnLogger from "../logging_config";

const logger: Logger = bnLogger.child({
	module: "browsernode/agent/gif",
});

import { CONFIG } from "../config";
import { FreeTypeFont, ImageFont, load_default, truetype } from "./font_util";
import type { AgentHistoryList } from "./views";

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

/**
 * Handle decoding any unicode escape sequences embedded in a string
 * (needed to render non-ASCII languages like chinese or arabic in the GIF overlay text)
 */
function decodeUnicodeEscapesToUtf8(text: string): string {
	if (!text.includes("\\u")) {
		// doesn't have any escape sequences that need to be decoded
		return text;
	}

	try {
		// Try to decode Unicode escape sequences using JSON.parse
		// We wrap in quotes and use JSON.parse to handle the escape sequences
		return JSON.parse(`"${text}"`);
	} catch (error) {
		// logger.debug(`Failed to decode unicode escape sequences while generating gif text: ${text}`);
		return text;
	}
}

/**
 * Create a GIF from the agent's history with overlaid task and goal text.
 * @param task - The task to create the GIF for
 * @param history - The history of the agent
 * @param options - The options for the GIF
 */
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

	// Try to load nicer fonts with fallback
	let regularFont!: FreeTypeFont;
	let titleFont!: FreeTypeFont;
	let goalFont!: FreeTypeFont;

	try {
		// Try different font options in order of preference
		// ArialUni is a font that comes with Office and can render most non-alphabet characters
		const fontOptions = [
			"Microsoft YaHei", // 微软雅黑
			"SimHei", // 黑体
			"SimSun", // 宋体
			"Noto Sans CJK SC", // 思源黑体
			"WenQuanYi Micro Hei", // 文泉驿微米黑
			"Helvetica",
			"Arial",
			"DejaVuSans",
			"Verdana",
		];

		let fontLoaded = false;

		for (const fontName of fontOptions) {
			try {
				let actualFontName = fontName;

				// Handle Windows font paths
				if (os.platform() === "win32") {
					// Try to construct the font path for Windows
					const windowsFontDir = path.join(
						os.homedir(),
						"AppData/Local/Microsoft/Windows/Fonts",
					);
					const systemFontDir = "C:/Windows/Fonts";

					for (const dir of [windowsFontDir, systemFontDir]) {
						const fontPath = path.join(dir, `${fontName}.ttf`);
						if (fs.existsSync(fontPath)) {
							actualFontName = fontPath;
							break;
						}
					}
				}

				regularFont = truetype(actualFontName, fontSize);
				titleFont = truetype(actualFontName, titleFontSize);
				goalFont = truetype(actualFontName, goalFontSize);
				fontLoaded = true;
				break;
			} catch (error) {
				continue;
			}
		}

		if (!fontLoaded) {
			throw new Error("No preferred fonts found");
		}
	} catch (error) {
		// Fallback to default fonts
		regularFont = load_default(fontSize);
		titleFont = load_default(titleFontSize);
		goalFont = load_default(goalFontSize);
	}

	// At this point, fonts are guaranteed to be assigned

	// Load logo if requested
	let logo: Buffer | null = null;
	if (showLogo) {
		try {
			const logoPath =
				"./static/BrowserNode-Banner-Text-White-narrow-Transparent.png";
			if (fs.existsSync(logoPath)) {
				// Resize logo to be small (e.g., 150px height)
				const logoHeight = 150;
				const logoBuffer = fs.readFileSync(logoPath);
				const logoMetadata = await sharp(logoBuffer).metadata();

				if (logoMetadata.width && logoMetadata.height) {
					const aspectRatio = logoMetadata.width / logoMetadata.height;
					const logoWidth = Math.round(logoHeight * aspectRatio);

					logo = await sharp(logoBuffer)
						.resize(logoWidth, logoHeight)
						.toBuffer();
				}
			}
		} catch (error) {
			logger.warn(`Could not load logo: ${error}`);
		}
	}

	// Create task frame if needed
	if (showTask && task) {
		const taskFrame = await createTaskFrame(
			task,
			history.history[0].state.screenshot,
			titleFont,
			regularFont,
			logo,
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

		if (showGoals && item.modelOutput) {
			image = await addOverlayToImage(
				image,
				i + 1,
				item.modelOutput.currentState.nextGoal,
				regularFont,
				goalFont, // Use goal font specifically for goal text
				margin,
				logo,
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

/**
 * Create initial frame showing the task.
 * @param task - The task to create the frame for
 * @param firstScreenshot - The first screenshot of the agent
 * @param titleFont - The font to use for the title
 * @param regularFont - The font to use for regular text
 * @param logo - The logo buffer to display
 * @param lineSpacing - The line spacing for text
 */
async function createTaskFrame(
	task: string,
	firstScreenshot: string,
	titleFont: FreeTypeFont,
	regularFont: FreeTypeFont,
	logo: Buffer | null,
	lineSpacing: number = 1.5,
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

	// Calculate vertical center of image
	const centerY = metadata.height! / 2;

	// Draw task text with dynamic font size based on task length
	const margin = 140; // Increased margin
	const maxWidth = metadata.width! - 2 * margin;

	// Dynamic font size calculation based on task length
	// Start with base font size (regular + 16)
	const baseFontSize = regularFont.size + 16;
	const minFontSize = Math.max(regularFont.size - 10, 16); // Don't go below 16pt
	const maxFontSize = baseFontSize; // Cap at the base font size

	// Calculate dynamic font size based on text length and complexity
	// Longer texts get progressively smaller fonts
	const textLength = task.length;
	let fontSize: number;
	if (textLength > 200) {
		// For very long text, reduce font size logarithmically
		fontSize = Math.max(
			baseFontSize - Math.floor(10 * (textLength / 200)),
			minFontSize,
		);
	} else {
		fontSize = baseFontSize;
	}

	// Create larger font for the task text
	const largerFont = truetype(regularFont.family, fontSize);

	// Generate wrapped text with the calculated font size
	const wrappedText = wrapText(task, largerFont, maxWidth);

	// Calculate line height with spacing
	const lineHeight = fontSize * lineSpacing;

	// Split text into lines
	const lines = wrappedText.split("\n");
	const totalHeight = lineHeight * lines.length;

	// Start position for first line
	let textY = centerY - totalHeight / 2 + 50; // Shifted down slightly

	// Add logo and text overlay
	const compositeInputs: sharp.OverlayOptions[] = [];

	// Add logo if available (top right corner)
	if (logo) {
		const logoMetadata = await sharp(logo).metadata();
		const logoMargin = 20;
		const logoX = metadata.width! - logoMetadata.width! - logoMargin;

		compositeInputs.push({
			input: logo,
			top: logoMargin,
			left: logoX,
		});
	}

	// Create SVG with multiple text lines
	let svgTextElements = "";
	for (const line of lines) {
		// Calculate line width for centering
		const [lineWidth] = largerFont.getsize(line);
		const textX = (metadata.width! - lineWidth) / 2;

		svgTextElements += `
			<text x="${textX}" y="${textY}" class="text task" fill="white">
				${line}
			</text>
		`;
		textY += lineHeight;
	}

	const svgText = `
        <svg width="${metadata.width}" height="${metadata.height}">
            <style>
                .text { font-family: ${largerFont.family}; }
                .task { font-size: ${fontSize}px; }
            </style>
            ${svgTextElements}
        </svg>
    `;

	compositeInputs.push({
		input: Buffer.from(svgText),
		top: 0,
		left: 0,
	});

	const processedImage = await image.composite(compositeInputs).toBuffer();
	return processedImage;
}

/**
 * Add step number and goal overlay to an image.
 * @param image - Sharp image instance
 * @param stepNumber - Step number to display
 * @param goalText - Goal text to display
 * @param regularFont - Font to use for regular text
 * @param titleFont - Font to use for title text
 * @param margin - Margin for positioning
 * @param logo - Optional logo buffer
 * @param displayStep - Whether to display step number
 * @param textColor - Color for text (RGBA)
 * @param textBoxColor - Color for text background (RGBA)
 * @returns Sharp image instance with overlay
 */
async function addOverlayToImage(
	image: sharp.Sharp,
	stepNumber: number,
	goalText: string,
	regularFont: FreeTypeFont,
	titleFont: FreeTypeFont,
	margin: number,
	logo: Buffer | null = null,
	displayStep: boolean = true,
	textColor: { r: number; g: number; b: number; alpha: number } = {
		r: 255,
		g: 255,
		b: 255,
		alpha: 1,
	},
	textBoxColor: { r: number; g: number; b: number; alpha: number } = {
		r: 0,
		g: 0,
		b: 0,
		alpha: 1,
	},
): Promise<sharp.Sharp> {
	const decodedGoalText = decodeUnicodeEscapesToUtf8(goalText);
	const metadata = await image.metadata();
	const imageWidth = metadata.width!;
	const imageHeight = metadata.height!;

	const compositeInputs: sharp.OverlayOptions[] = [];

	// Create SVG elements for text overlays
	let svgElements = "";

	// Variables to track step position for goal positioning
	let yStep = imageHeight - margin - 10; // Default bottom position

	if (displayStep) {
		// Add step number (bottom left)
		const stepText = stepNumber.toString();
		const [stepWidth, stepHeight] = titleFont.getsize(stepText);

		// Position step number in bottom left
		const xStep = margin + 10;
		yStep = imageHeight - margin - stepHeight - 10;

		// Draw rounded rectangle background for step number
		const padding = 20;
		const stepBgX = xStep - padding;
		const stepBgY = yStep - padding;
		const stepBgWidth = stepWidth + 2 * padding;
		const stepBgHeight = stepHeight + 2 * padding;

		svgElements += `
			<rect x="${stepBgX}" y="${stepBgY}" 
				  width="${stepBgWidth}" height="${stepBgHeight}" 
				  rx="15" ry="15" 
				  fill="rgba(${textBoxColor.r}, ${textBoxColor.g}, ${textBoxColor.b}, ${textBoxColor.alpha})" />
			<text x="${xStep}" y="${yStep + stepHeight}" 
				  font-family="${titleFont.family}" font-size="${titleFont.size}px" 
				  fill="rgba(${textColor.r}, ${textColor.g}, ${textColor.b}, ${textColor.alpha})">
				${stepText}
			</text>
		`;
	}

	// Draw goal text (centered, bottom)
	const maxWidth = imageWidth - 4 * margin;
	const wrappedGoal = wrapText(decodedGoalText, titleFont, maxWidth);
	const [goalWidth, goalHeight] = titleFont.getsize(wrappedGoal);

	// Center goal text horizontally, place above step number
	const xGoal = (imageWidth - goalWidth) / 2;
	const padding = 20;
	const yGoal = yStep - goalHeight - padding * 4; // More space between step and goal

	// Draw rounded rectangle background for goal
	const paddingGoal = 25;
	const goalBgX = xGoal - paddingGoal;
	const goalBgY = yGoal - paddingGoal;
	const goalBgWidth = goalWidth + 2 * paddingGoal;
	const goalBgHeight = goalHeight + 2 * paddingGoal;

	svgElements += `
		<rect x="${goalBgX}" y="${goalBgY}" 
			  width="${goalBgWidth}" height="${goalBgHeight}" 
			  rx="15" ry="15" 
			  fill="rgba(${textBoxColor.r}, ${textBoxColor.g}, ${textBoxColor.b}, ${textBoxColor.alpha})" />
	`;

	// Add multiline goal text (centered alignment)
	const goalLines = wrappedGoal.split("\n");
	const lineHeight = titleFont.size * 1.2;
	goalLines.forEach((line, index) => {
		// Calculate center position for each line
		const [lineWidth] = titleFont.getsize(line);
		const lineX = (imageWidth - lineWidth) / 2;
		const lineY = yGoal + titleFont.size + index * lineHeight;

		svgElements += `
			<text x="${lineX}" y="${lineY}" 
				  font-family="${titleFont.family}" font-size="${titleFont.size}px" 
				  fill="rgba(${textColor.r}, ${textColor.g}, ${textColor.b}, ${textColor.alpha})" 
				  text-anchor="start">
				${line}
			</text>
		`;
	});

	// Add logo if provided (top right corner)
	if (logo) {
		const logoMetadata = await sharp(logo).metadata();
		const logoMargin = 20;
		const logoX = imageWidth - logoMetadata.width! - logoMargin;

		compositeInputs.push({
			input: logo,
			top: logoMargin,
			left: logoX,
		});
	}

	// Create SVG overlay
	if (svgElements) {
		const svgOverlay = `
			<svg width="${imageWidth}" height="${imageHeight}">
				${svgElements}
			</svg>
		`;

		compositeInputs.push({
			input: Buffer.from(svgOverlay),
			top: 0,
			left: 0,
		});
	}

	// Apply all overlays
	if (compositeInputs.length > 0) {
		return image.composite(compositeInputs);
	}

	return image;
}

/**
 * Wrap text to fit within a given width.
 * @param text - Text to wrap
 * @param font - Font to use for text
 * @param maxWidth - Maximum width in pixels
 * @returns Wrapped text with newlines
 */
function wrapText(text: string, font: FreeTypeFont, maxWidth: number): string {
	const decodedText = decodeUnicodeEscapesToUtf8(text);
	const words = decodedText.split(" ");
	const lines: string[] = [];
	let currentLine: string[] = [];

	for (const word of words) {
		currentLine.push(word);
		const line = currentLine.join(" ");
		const bbox = font.getbbox(line);

		if (bbox[2] > maxWidth) {
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
