import * as fs from "fs";
import * as path from "path";
import { Canvas, CanvasRenderingContext2D, createCanvas } from "canvas";

/**
 * Font object that mimics PIL ImageFont.FreeTypeFont
 */
export class FreeTypeFont {
	private fontFamily: string;
	private fontSize: number;
	private canvas: Canvas;
	private ctx: CanvasRenderingContext2D;

	constructor(fontFamily: string, fontSize: number) {
		this.fontFamily = fontFamily;
		this.fontSize = fontSize;
		this.canvas = createCanvas(1, 1); // Small canvas for measurements
		this.ctx = this.canvas.getContext("2d");
		this.updateFont();
	}

	private updateFont(): void {
		this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
	}

	/**
	 * Get the size of text when rendered with this font
	 * Mimics PIL's getsize() method
	 */
	getsize(text: string): [number, number] {
		const metrics = this.ctx.measureText(text);
		const width = metrics.width;
		const height = this.fontSize; // Approximate height based on font size
		return [Math.ceil(width), Math.ceil(height)];
	}

	/**
	 * Get detailed text metrics
	 * Similar to PIL's getbbox() method
	 */
	getbbox(text: string): [number, number, number, number] {
		const metrics = this.ctx.measureText(text);
		const width = metrics.width;
		const actualBoundingBoxAscent =
			metrics.actualBoundingBoxAscent || this.fontSize * 0.8;
		const actualBoundingBoxDescent =
			metrics.actualBoundingBoxDescent || this.fontSize * 0.2;

		return [
			0, // left
			-actualBoundingBoxAscent, // top
			Math.ceil(width), // right
			actualBoundingBoxDescent, // bottom
		];
	}

	/**
	 * Get the font family name
	 */
	get family(): string {
		return this.fontFamily;
	}

	/**
	 * Get the font size
	 */
	get size(): number {
		return this.fontSize;
	}

	/**
	 * Create a new font with different size
	 */
	font_variant(size: number): FreeTypeFont {
		return new FreeTypeFont(this.fontFamily, size);
	}
}

/**
 * ImageFont class that mimics PIL ImageFont
 */
export class ImageFont {
	private static registeredFonts: Map<string, string> = new Map();

	/**
	 * Register a font file for use
	 * @param fontPath Path to the font file
	 * @param fontFamily Name to register the font as
	 */
	static registerFont(fontPath: string, fontFamily: string): void {
		if (fs.existsSync(fontPath)) {
			// In a real implementation with node-canvas, you would use registerFont
			// registerFont(fontPath, { family: fontFamily });
			this.registeredFonts.set(fontFamily, fontPath);
		}
	}

	/**
	 * Load a TrueType font file
	 * Mimics PIL's ImageFont.truetype()
	 */
	static truetype(fontName: string, fontSize: number): FreeTypeFont {
		// If it's a file path, extract just the family name
		let fontFamily = fontName;

		if (fontName.includes("/") || fontName.includes("\\")) {
			// It's a file path, try to register and use it
			const baseName = path.basename(fontName, path.extname(fontName));
			fontFamily = baseName;

			if (fs.existsSync(fontName)) {
				this.registerFont(fontName, fontFamily);
			}
		}

		// Common font mappings for better cross-platform compatibility
		const fontMappings: { [key: string]: string } = {
			arial: "Arial, sans-serif",
			helvetica: "Helvetica, Arial, sans-serif",
			times: 'Times, "Times New Roman", serif',
			courier: 'Courier, "Courier New", monospace',
			verdana: "Verdana, sans-serif",
			georgia: "Georgia, serif",
			trebuchet: "Trebuchet MS, sans-serif",
			comic: "Comic Sans MS, cursive",
			impact: "Impact, sans-serif",
			lucida: "Lucida Console, monospace",
		};

		// Check if we have a mapping for this font
		const lowerFontName = fontFamily.toLowerCase();
		for (const [key, value] of Object.entries(fontMappings)) {
			if (lowerFontName.includes(key)) {
				fontFamily = value;
				break;
			}
		}

		return new FreeTypeFont(fontFamily, fontSize);
	}

	/**
	 * Load the default font
	 * Mimics PIL's ImageFont.load_default()
	 */
	static load_default(size: number = 11): FreeTypeFont {
		// Use a common system font as default
		return new FreeTypeFont("Arial, sans-serif", size);
	}

	/**
	 * Get list of available system fonts (simplified)
	 */
	static getAvailableFonts(): string[] {
		return [
			"Times New Roman",
			"Courier New",
			"Georgia",
			"Trebuchet MS",
			"Comic Sans MS",
			"Impact",
			"Lucida Console",
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
	}
}

// Export individual functions to match PIL's interface
export function truetype(fontName: string, fontSize: number): FreeTypeFont {
	return ImageFont.truetype(fontName, fontSize);
}

export function load_default(size: number = 11): FreeTypeFont {
	return ImageFont.load_default(size);
}

// Type definitions to match PIL interface
export type { FreeTypeFont as FreeTypeFontType };

// Example usage:
/*
// Similar to PIL usage:
const regular_font = ImageFont.truetype('Arial', 12);
const title_font = ImageFont.truetype('Arial', 18);
const goal_font = ImageFont.truetype('Arial', 14);

// Or with default fonts:
const regular_font_default = ImageFont.load_default();
const title_font_default = ImageFont.load_default(16);

// Getting text dimensions:
const [width, height] = regular_font.getsize('Hello World');
const [left, top, right, bottom] = regular_font.getbbox('Hello World');
*/
