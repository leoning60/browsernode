import * as fsSync from "fs";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";

const INVALID_FILENAME_ERROR_MESSAGE =
	"Error: Invalid filename format. Must be alphanumeric with supported extension.";
const DEFAULT_FILE_SYSTEM_PATH = "browsernode_agent_data";

export class FileSystemError extends Error {
	/**
	 * Custom exception for file system operations that should be shown to LLM
	 */
	constructor(message: string) {
		super(message);
		this.name = "FileSystemError";
	}
}

export abstract class BaseFile {
	/**
	 * Base class for all file types
	 */
	public name: string;
	public content: string;

	constructor(name: string, content: string = "") {
		this.name = name;
		this.content = content;
	}

	// Subclass must define this
	abstract get extension(): string;

	public writeFileContent(content: string): void {
		/**
		 * Update internal content (formatted)
		 */
		this.updateContent(content);
	}

	public appendFileContent(content: string): void {
		/**
		 * Append content to internal content
		 */
		this.updateContent(this.content + content);
	}

	// These are shared and implemented here
	public updateContent(content: string): void {
		this.content = content;
	}

	public syncToDiskSync(dirPath: string): void {
		const filePath = path.join(dirPath, this.fullName);
		fsSync.writeFileSync(filePath, this.content, "utf8");
	}

	public async syncToDisk(dirPath: string): Promise<void> {
		const filePath = path.join(dirPath, this.fullName);
		await fs.writeFile(filePath, this.content, "utf8");
	}

	public async write(content: string, dirPath: string): Promise<void> {
		this.writeFileContent(content);
		await this.syncToDisk(dirPath);
	}

	public async append(content: string, dirPath: string): Promise<void> {
		this.appendFileContent(content);
		await this.syncToDisk(dirPath);
	}

	public read(): string {
		return this.content;
	}

	public get fullName(): string {
		return `${this.name}.${this.extension}`;
	}

	public get getSize(): number {
		return this.content.length;
	}

	public get getLineCount(): number {
		return this.content.split("\n").length;
	}

	public toObject(): Record<string, any> {
		return {
			name: this.name,
			content: this.content,
		};
	}
}

export class MarkdownFile extends BaseFile {
	/**
	 * Markdown file implementation
	 */
	get extension(): string {
		return "md";
	}
}

export class TxtFile extends BaseFile {
	/**
	 * Plain text file implementation
	 */
	get extension(): string {
		return "txt";
	}
}

export interface FileSystemState {
	/**
	 * Serializable state of the file system
	 */
	files: Record<string, { type: string; data: Record<string, any> }>;
	baseDir: string;
	extractedContentCount: number;
}

export class FileSystem {
	/**
	 * Enhanced file system with in-memory storage and multiple file type support
	 */
	baseDir: string;
	private dataDir: string;
	private fileTypes: Record<
		string,
		new (
			name: string,
			content?: string,
		) => BaseFile
	>;
	private files: Record<string, BaseFile>;
	private defaultFiles: string[];
	public extractedContentCount: number;

	constructor(baseDir: string, createDefaultFiles: boolean = true) {
		this.baseDir = baseDir;

		// Ensure base directory exists
		if (!fsSync.existsSync(this.baseDir)) {
			fsSync.mkdirSync(this.baseDir, { recursive: true });
		}

		// Create and use a dedicated subfolder for all operations
		this.dataDir = path.join(this.baseDir, DEFAULT_FILE_SYSTEM_PATH);
		if (fsSync.existsSync(this.dataDir)) {
			// Clean the data directory
			fsSync.rmSync(this.dataDir, { recursive: true, force: true });
		}
		fsSync.mkdirSync(this.dataDir, { recursive: true });

		this.fileTypes = {
			md: MarkdownFile,
			txt: TxtFile,
		};

		this.files = {};
		this.extractedContentCount = 0;

		if (createDefaultFiles) {
			this.defaultFiles = ["todo.md"];
			this.createDefaultFiles();
		} else {
			this.defaultFiles = [];
		}
	}

	public getAllowedExtensions(): string[] {
		/**
		 * Get allowed extensions
		 */
		return Object.keys(this.fileTypes);
	}

	private getFileTypeClass(
		extension: string,
	): (new (name: string, content?: string) => BaseFile) | null {
		/**
		 * Get the appropriate file class for an extension.
		 */
		return this.fileTypes[extension.toLowerCase()] || null;
	}

	private createDefaultFiles(): void {
		/**
		 * Create default results and todo files
		 */
		for (const fullFilename of this.defaultFiles) {
			const { name, extension } = this.parseFilename(fullFilename);
			const FileClass = this.getFileTypeClass(extension);
			if (!FileClass) {
				throw new Error(
					`Error: Invalid file extension '${extension}' for file '${fullFilename}'.`,
				);
			}

			const fileObj = new FileClass(name);
			this.files[fullFilename] = fileObj; // Use full filename as key
			fileObj.syncToDiskSync(this.dataDir);
		}
	}

	private isValidFilename(fileName: string): boolean {
		/**
		 * Check if filename matches the required pattern: name.extension
		 */
		// Build extensions pattern from fileTypes
		const extensions = Object.keys(this.fileTypes).join("|");
		const pattern = new RegExp(`^[a-zA-Z0-9_\\-]+\\.(${extensions})$`);
		return pattern.test(fileName);
	}

	private parseFilename(filename: string): { name: string; extension: string } {
		/**
		 * Parse filename into name and extension. Always check isValidFilename first.
		 */
		const lastDotIndex = filename.lastIndexOf(".");
		const name = filename.substring(0, lastDotIndex);
		const extension = filename.substring(lastDotIndex + 1).toLowerCase();
		return { name, extension };
	}

	public getDir(): string {
		/**
		 * Get the file system directory
		 */
		return this.dataDir;
	}

	public getFile(fullFilename: string): BaseFile | null {
		/**
		 * Get a file object by full filename
		 */
		if (!this.isValidFilename(fullFilename)) {
			return null;
		}

		// Use full filename as key
		return this.files[fullFilename] || null;
	}

	public listFiles(): string[] {
		/**
		 * List all files in the system
		 */
		return Object.values(this.files).map((file) => file.fullName);
	}

	public displayFile(fullFilename: string): string | null {
		/**
		 * Display file content using file-specific display method
		 */
		if (!this.isValidFilename(fullFilename)) {
			return null;
		}

		const fileObj = this.getFile(fullFilename);
		if (!fileObj) {
			return null;
		}

		return fileObj.read();
	}

	public readFile(fullFilename: string): string {
		/**
		 * Read file content using file-specific read method and return appropriate message to LLM
		 */
		if (!this.isValidFilename(fullFilename)) {
			return INVALID_FILENAME_ERROR_MESSAGE;
		}

		const fileObj = this.getFile(fullFilename);
		if (!fileObj) {
			return `File '${fullFilename}' not found.`;
		}

		try {
			const content = fileObj.read();
			return `Read from file ${fullFilename}.\n<content>\n${content}\n</content>`;
		} catch (error) {
			if (error instanceof FileSystemError) {
				return error.message;
			}
			return `Error: Could not read file '${fullFilename}'.`;
		}
	}

	public async writeFile(
		fullFilename: string,
		content: string,
	): Promise<string> {
		/**
		 * Write content to file using file-specific write method
		 */
		if (!this.isValidFilename(fullFilename)) {
			return INVALID_FILENAME_ERROR_MESSAGE;
		}

		try {
			const { name, extension } = this.parseFilename(fullFilename);
			const FileClass = this.getFileTypeClass(extension);
			if (!FileClass) {
				throw new Error(
					`Error: Invalid file extension '${extension}' for file '${fullFilename}'.`,
				);
			}

			// Create or get existing file using full filename as key
			let fileObj: BaseFile;
			if (fullFilename in this.files) {
				fileObj = this.files[fullFilename]!;
			} else {
				fileObj = new FileClass(name);
				this.files[fullFilename] = fileObj; // Use full filename as key
			}

			// Use file-specific write method
			await fileObj.write(content, this.dataDir);
			return `Data written to file ${fullFilename} successfully.`;
		} catch (error) {
			if (error instanceof FileSystemError) {
				return error.message;
			}
			return `Error: Could not write to file '${fullFilename}'. ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	public async appendFile(
		fullFilename: string,
		content: string,
	): Promise<string> {
		/**
		 * Append content to file using file-specific append method
		 */
		if (!this.isValidFilename(fullFilename)) {
			return INVALID_FILENAME_ERROR_MESSAGE;
		}

		const fileObj = this.getFile(fullFilename);
		if (!fileObj) {
			return `File '${fullFilename}' not found.`;
		}

		try {
			await fileObj.append(content, this.dataDir);
			return `Data appended to file ${fullFilename} successfully.`;
		} catch (error) {
			if (error instanceof FileSystemError) {
				return error.message;
			}
			return `Error: Could not append to file '${fullFilename}'. ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	public async saveExtractedContent(content: string): Promise<string> {
		/**
		 * Save extracted content to a numbered file
		 */
		const initialFilename = `extracted_content_${this.extractedContentCount}`;
		const extractedFilename = `${initialFilename}.md`;
		const fileObj = new MarkdownFile(initialFilename);
		await fileObj.write(content, this.dataDir);
		this.files[extractedFilename] = fileObj;
		this.extractedContentCount++;
		return `Extracted content saved to file ${extractedFilename} successfully.`;
	}

	/**
	 * List all files with their content information using file-specific display methods
	 */
	public describe(): string {
		const DISPLAY_CHARS = 400;
		let description = "";

		for (const fileObj of Object.values(this.files)) {
			// Skip todo.md from description
			if (fileObj.fullName === "todo.md") {
				continue;
			}

			const content = fileObj.read();

			// Handle empty files
			if (!content) {
				description += `<file>\n${fileObj.fullName} - [empty file]\n</file>\n`;
				continue;
			}

			const lines = content.split("\n");
			const lineCount = lines.length;

			// For small files, display the entire content
			const wholeFileDescription = `<file>\n${fileObj.fullName} - ${lineCount} lines\n<content>\n${content}\n</content>\n</file>\n`;
			if (content.length < Math.floor(1.5 * DISPLAY_CHARS)) {
				description += wholeFileDescription;
				continue;
			}

			// For larger files, display start and end previews
			const halfDisplayChars = Math.floor(DISPLAY_CHARS / 2);

			// Get start preview
			let startPreview = "";
			let startLineCount = 0;
			let charsCount = 0;
			for (const line of lines) {
				if (charsCount + line.length + 1 > halfDisplayChars) {
					break;
				}
				startPreview += line + "\n";
				charsCount += line.length + 1;
				startLineCount++;
			}

			// Get end preview
			let endPreview = "";
			let endLineCount = 0;
			charsCount = 0;
			for (let i = lines.length - 1; i >= 0; i--) {
				const line = lines[i];
				if (line && charsCount + line.length + 1 > halfDisplayChars) {
					break;
				}
				endPreview = line + "\n" + endPreview;
				if (!line) {
					break;
				}
				charsCount += line.length + 1;
				endLineCount++;
			}

			// Calculate lines in between
			const middleLineCount = lineCount - startLineCount - endLineCount;
			if (middleLineCount <= 0) {
				description += wholeFileDescription;
				continue;
			}

			startPreview = startPreview.replace(/\n$/, "").replace(/\s+$/, "");
			endPreview = endPreview.replace(/^\n/, "").replace(/\s+$/, "");

			// Format output
			if (!(startPreview || endPreview)) {
				description += `<file>\n${fileObj.fullName} - ${lineCount} lines\n<content>\n${middleLineCount} lines...\n</content>\n</file>\n`;
			} else {
				description += `<file>\n${fileObj.fullName} - ${lineCount} lines\n<content>\n${startPreview}\n`;
				description += `... ${middleLineCount} more lines ...\n`;
				description += `${endPreview}\n`;
				description += "</content>\n</file>\n";
			}
		}

		return description.replace(/\n$/, "");
	}

	public getTodoContents(): string {
		/**
		 * Get todo file contents
		 */
		const todoFile = this.getFile("todo.md");
		return todoFile ? todoFile.read() : "";
	}

	public getState(): FileSystemState {
		/**
		 * Get serializable state of the file system
		 */
		const filesData: Record<
			string,
			{ type: string; data: Record<string, any> }
		> = {};

		for (const [fullFilename, fileObj] of Object.entries(this.files)) {
			filesData[fullFilename] = {
				type: fileObj.constructor.name,
				data: fileObj.toObject(),
			};
		}

		return {
			files: filesData,
			baseDir: this.baseDir,
			extractedContentCount: this.extractedContentCount,
		};
	}

	public nuke(): void {
		/**
		 * Delete the file system directory
		 */
		if (fsSync.existsSync(this.dataDir)) {
			fsSync.rmSync(this.dataDir, { recursive: true, force: true });
		}
	}

	public static fromState(state: FileSystemState): FileSystem {
		/**
		 * Restore file system from serializable state at the exact same location
		 */
		// Create file system without default files
		const fs = new FileSystem(state.baseDir, false);
		fs.extractedContentCount = state.extractedContentCount;

		// Restore all files
		for (const [fullFilename, fileData] of Object.entries(state.files)) {
			const fileType = fileData.type;
			const fileInfo = fileData.data;

			// Create the appropriate file object based on type
			let fileObj: BaseFile;
			if (fileType === "MarkdownFile") {
				fileObj = new MarkdownFile(fileInfo.name, fileInfo.content);
			} else if (fileType === "TxtFile") {
				fileObj = new TxtFile(fileInfo.name, fileInfo.content);
			} else {
				// Skip unknown file types
				continue;
			}

			// Add to files dict and sync to disk
			fs.files[fullFilename] = fileObj;
			fileObj.syncToDiskSync(fs.dataDir);
		}

		return fs;
	}
}

// Test functions for development (equivalent to Python's if __name__ == '__main__')
export async function testFileSystem(): Promise<void> {
	// Test to understand what toObject() does
	const mdFile = new MarkdownFile("test");
	mdFile.updateContent("Hello, world!");
	console.log(mdFile.toObject());

	// Test to understand how state looks like
	const tempdir = os.tmpdir();
	const fs = new FileSystem(path.join(tempdir, "browsernode_test_data"));
	console.log(fs.getState());
	fs.nuke();

	// Test to understand creating a filesystem, getting its state, and restoring it
	const fs2 = new FileSystem(path.join(tempdir, "browsernode_test_data"));
	const state = fs2.getState();
	console.log(state);
	const fs3 = FileSystem.fromState(state);
	console.log(fs3.getState());
	fs3.nuke();
}
