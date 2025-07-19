import { z } from "zod";
import { BrowserSession } from "../browser/session";
import type { BaseChatModel } from "../llm/base";
import { Registry } from "./registry/service";
import {
	AppendFileAction,
	ClearCellContentsAction,
	ClickElementAction,
	CloseTabAction,
	DoneAction,
	ExtractStructuredDataAction,
	FallbackInputSingleCellAction,
	GetDropdownOptionsAction,
	GoToUrlAction,
	InputTextAction,
	NoParamsAction,
	ReadCellContentsAction,
	ReadFileAction,
	ScrollAction,
	ScrollToTextAction,
	SearchGoogleAction,
	SelectCellOrRangeAction,
	SelectDropdownOptionAction,
	SendKeysAction,
	StructuredOutputAction,
	SwitchTabAction,
	UpdateCellContentsAction,
	UploadFileAction,
	WriteFileAction,
} from "./views";

import TurndownService from "turndown";
import { ActionResult } from "../agent/views";
import type { FileSystem } from "../filesystem/file_system";
import { createUserMessage } from "../llm/messages";
import bnLogger from "../logging_config";
import { timeExecution } from "../utils_old";
import type { ActionModel } from "./registry/views";

// Setup logger
const logger = bnLogger.child({
	label: "browsernode/controller/service",
});

// Helper function to retry async operations
async function retryAsyncFunction<T>(
	func: () => Promise<T>,
	errorMessage: string,
	retries: number = 3,
	sleepSeconds: number = 1,
): Promise<[T | null, ActionResult | null]> {
	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const result = await func();
			return [result, null];
		} catch (e: any) {
			await new Promise((resolve) => setTimeout(resolve, sleepSeconds * 1000));
			logger.debug(`Error (attempt ${attempt + 1}/${retries}): ${e}`);
			if (attempt === retries - 1) {
				return [null, new ActionResult({ error: errorMessage + e.toString() })];
			}
		}
	}
	return [null, new ActionResult({ error: errorMessage })];
}

// Generic type for Context
type Context = any;

export class Controller<T = Context> {
	public registry: Registry<T>;
	public displayFilesInDoneText: boolean;

	constructor(
		public excludeActions: string[] = [],
		public outputModel: any = null,
		displayFilesInDoneText: boolean = true,
	) {
		// Initialize registry
		this.registry = new Registry<T>(excludeActions);
		this.displayFilesInDoneText = displayFilesInDoneText;

		// Register all default browser actions
		this.registerDoneAction(outputModel);
		this.registerDefaultActions();
	}

	/*
	 * Custom done action for structured output
	 */
	private registerDoneAction(outputModel: any) {
		if (outputModel !== null) {
			this.registry.action(
				"Complete task - with return text and if the task is finished (success=True) or not yet completely finished (success=False), because last step is reached",
				{
					paramModel: StructuredOutputAction,
				},
			)(async function done(params: z.infer<typeof StructuredOutputAction>) {
				return new ActionResult({
					isDone: true,
					success: params.success,
					extractedContent: JSON.stringify(params.data),
				});
			});
		} else {
			// If no output model is specified, use the default DoneAction model
			const displayFilesInDoneText = this.displayFilesInDoneText;
			this.registry.action(
				"Complete task - provide a summary of results for the user. Set success=True if task completed successfully, false otherwise. Text should be your response to the user summarizing results. Include files you would like to display to the user in filesToDisplay.",
				{
					paramModel: DoneAction,
				},
			)(async function done(
				params: z.infer<typeof DoneAction>,
				browserSession: BrowserSession,
				pageExtractionLlm?: BaseChatModel,
				fileSystem?: FileSystem,
			) {
				let userMessage = params.text;

				const lenText = params.text.length;
				const lenMaxMemory = 100;
				let memory = `Task completed: ${params.success} - ${params.text.substring(0, lenMaxMemory)}`;
				if (lenText > lenMaxMemory) {
					memory += ` - ${lenText - lenMaxMemory} more characters`;
				}

				const attachments: string[] = [];
				if (params.filesToDisplay && fileSystem) {
					if (displayFilesInDoneText) {
						let fileMsg = "";
						for (const fileName of params.filesToDisplay) {
							if (fileName === "todo.md") continue;
							const fileContent = await fileSystem.displayFile(fileName);
							if (fileContent) {
								fileMsg += `\n\n${fileName}:\n${fileContent}`;
								attachments.push(fileName);
							}
						}
						if (fileMsg) {
							userMessage += "\n\nAttachments:";
							userMessage += fileMsg;
						} else {
							logger.warn("Agent wanted to display files but none were found");
						}
					} else {
						for (const fileName of params.filesToDisplay) {
							if (fileName === "todo.md") continue;
							const fileContent = await fileSystem.displayFile(fileName);
							if (fileContent) {
								attachments.push(fileName);
							}
						}
					}
				}

				return new ActionResult({
					isDone: true,
					success: params.success,
					extractedContent: userMessage,
					longTermMemory: memory,
				});
			});
		}
	}

	private registerDefaultActions() {
		// Basic Navigation Actions
		// searchGoogle
		this.registry.action(
			"Search the query in Google, the query should be a search query like humans search in Google, concrete and not vague or super long.",
			{
				paramModel: SearchGoogleAction,
			},
		)(async function searchGoogle(
			params: z.infer<typeof SearchGoogleAction>,
			browserSession: BrowserSession,
		) {
			const searchUrl = `https://www.google.com/search?q=${params.query}&udm=14`;

			const page = await browserSession.getCurrentPage();
			if (page.url().trim().replace(/\/$/, "") === "https://www.google.com") {
				await browserSession.navigateTo(searchUrl);
			} else {
				await browserSession.createNewTab(searchUrl);
			}

			const msg = `🔍 Searched for "${params.query}" in Google`;
			logger.info(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
				longTermMemory: `Searched Google for '${params.query}'`,
			});
		});

		// goToUrl
		this.registry.action(
			"Navigate to URL, set newTab=true to open in new tab, false to navigate in current tab",
			{
				paramModel: GoToUrlAction,
			},
		)(async function goToUrl(
			params: z.infer<typeof GoToUrlAction>,
			browserSession: BrowserSession,
		) {
			try {
				if (params.newTab) {
					// Open in new tab
					const page = await browserSession.createNewTab(params.url);
					const tabIdx = browserSession.tabs.indexOf(page);
					const memory = `Opened new tab with URL ${params.url}`;
					const msg = `🔗 Opened new tab #${tabIdx} with url ${params.url}`;
					logger.info(msg);
					return new ActionResult({
						extractedContent: msg,
						includeInMemory: true,
						longTermMemory: memory,
					});
				} else {
					// Navigate in current tab (original logic)
					// SECURITY FIX: Use browserSession.navigateTo() instead of direct page.goto()
					// This ensures URL validation against allowedDomains is performed
					await browserSession.navigateTo(params.url);
					const memory = `Navigated to ${params.url}`;
					const msg = `🔗 ${memory}`;
					logger.info(msg);
					return new ActionResult({
						extractedContent: msg,
						includeInMemory: true,
						longTermMemory: memory,
					});
				}
			} catch (e: any) {
				const errorMsg = e.toString();
				// Check for network-related errors
				const networkErrors = [
					"ERR_NAME_NOT_RESOLVED",
					"ERR_INTERNET_DISCONNECTED",
					"ERR_CONNECTION_REFUSED",
					"ERR_TIMED_OUT",
					"net::",
				];

				if (networkErrors.some((err) => errorMsg.includes(err))) {
					const siteUnavailableMsg = `Site unavailable: ${params.url} - ${errorMsg}`;
					logger.warn(siteUnavailableMsg);
					return new ActionResult({
						success: false,
						error: siteUnavailableMsg,
						includeInMemory: true,
						longTermMemory: siteUnavailableMsg,
					});
				} else {
					// Re-raise non-network errors
					throw e;
				}
			}
		});

		// goBack
		this.registry.action("Go back", {
			paramModel: NoParamsAction,
		})(async function goBack(
			_: z.infer<typeof NoParamsAction>,
			browserSession: BrowserSession,
		) {
			await browserSession.goBack();
			const msg = "🔙 Navigated back";
			logger.info(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
				longTermMemory: "Navigated back",
			});
		});

		// Wait for x seconds
		this.registry.action("Wait for x seconds default 3")(async function wait(
			seconds: number = 3,
		) {
			const msg = `🕒 Waiting for ${seconds} seconds`;
			logger.info(msg);
			await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
				longTermMemory: `Waited for ${seconds} seconds`,
			});
		});

		// Element Interaction Actions
		this.registry.action("Click element by index", {
			paramModel: ClickElementAction,
		})(async function clickElementByIndex(
			params: z.infer<typeof ClickElementAction>,
			browserSession: BrowserSession,
		) {
			// Check if element exists in current selector map
			let selectorMap = await browserSession.getSelectorMap();
			if (!Object.keys(selectorMap).includes(params.index.toString())) {
				// Force a state refresh in case the cache is stale
				logger.info(
					`Element with index ${params.index} not found in selector map, refreshing state...`,
				);
				await browserSession.getStateSummary(true); // This will refresh the cached state
				selectorMap = await browserSession.getSelectorMap();

				if (!Object.keys(selectorMap).includes(params.index.toString())) {
					// Return informative message with the new state instead of error
					const maxIndex = Math.max(
						...Object.keys(selectorMap).map(Number),
						-1,
					);
					const msg = `Element with index ${params.index} does not exist. Page has ${Object.keys(selectorMap).length} interactive elements (indices 0-${maxIndex}). State has been refreshed - please use the updated element indices or scroll to see more elements`;
					return new ActionResult({
						extractedContent: msg,
						includeInMemory: true,
						success: false,
						longTermMemory: msg,
					});
				}
			}

			const elementNode = await browserSession.getDomElementByIndex(
				params.index,
			);
			const initialPages = browserSession.tabs.length;

			// if element has file uploader then dont click
			// Check if element is actually a file input (not just contains file-related keywords)
			if (elementNode && BrowserSession.isFileInput(elementNode)) {
				const msg = `Index ${params.index} - has an element which opens file upload dialog. To upload files please use a specific function to upload files`;
				logger.info(msg);
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
					success: false,
					longTermMemory: msg,
				});
			}

			try {
				if (!elementNode) {
					throw new Error(`Element with index ${params.index} does not exist`);
				}

				const downloadPath =
					await browserSession._clickElementNode(elementNode);
				let msg: string;
				let emoji: string;

				if (downloadPath) {
					emoji = "💾";
					msg = `Downloaded file to ${downloadPath}`;
				} else {
					emoji = "🖱️";
					msg = `Clicked button with index ${params.index}: ${elementNode.getAllTextTillNextClickableElement(2)}`;
				}

				logger.info(`${emoji} ${msg}`);
				logger.debug(`Element xpath: ${elementNode.xpath}`);

				if (browserSession.tabs.length > initialPages) {
					const newTabMsg = "New tab opened - switching to it";
					msg += ` - ${newTabMsg}`;
					emoji = "🔗";
					logger.info(`${emoji} ${newTabMsg}`);
					await browserSession.switchToTab(-1);
				}

				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
					longTermMemory: msg,
				});
			} catch (e: any) {
				const errorMsg = e.toString();
				if (
					errorMsg.includes("Execution context was destroyed") ||
					errorMsg.includes("Cannot find context with specified id")
				) {
					// Page navigated during click - refresh state and return it
					logger.info("Page context changed during click, refreshing state...");
					await browserSession.getStateSummary(true);
					return new ActionResult({
						error: "Page navigated during click. Refreshed state provided.",
						includeInMemory: true,
						success: false,
					});
				} else {
					logger.warn(
						`Element not clickable with index ${params.index} - most likely the page changed`,
					);
					return new ActionResult({ error: errorMsg, success: false });
				}
			}
		});

		// inputText
		this.registry.action(
			"Click and input text into a input interactive element",
			{
				paramModel: InputTextAction,
			},
		)(async function inputText(
			params: z.infer<typeof InputTextAction>,
			browserSession: BrowserSession,
			pageExtractionLlm?: BaseChatModel,
			fileSystem?: FileSystem,
			availableFilePaths?: string[],
			hasSensitiveData: boolean = false,
		) {
			const selectorMap = await browserSession.getSelectorMap();
			if (!Object.keys(selectorMap).includes(params.index.toString())) {
				throw new Error(
					`Element index ${params.index} does not exist - retry or use alternative actions`,
				);
			}

			const elementNode = await browserSession.getDomElementByIndex(
				params.index,
			);
			if (!elementNode) {
				throw new Error(`Element with index ${params.index} does not exist`);
			}

			try {
				await browserSession._inputTextElementNode(elementNode, params.text);
			} catch (error) {
				const msg = `Failed to input text into element ${params.index}.`;
				return new ActionResult({ error: msg });
			}

			const msg = !hasSensitiveData
				? `⌨️ Input ${params.text} into index ${params.index}`
				: `⌨️ Input sensitive data into index ${params.index}`;

			logger.info(msg);
			logger.debug(`Element xpath: ${elementNode.xpath}`);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
				longTermMemory: `Input '${params.text}' into element ${params.index}.`,
			});
		});

		// uploadFile
		this.registry.action("Upload file to interactive element with file path", {
			paramModel: UploadFileAction,
		})(async function uploadFile(
			params: z.infer<typeof UploadFileAction>,
			browserSession: BrowserSession,
			pageExtractionLlm?: BaseChatModel,
			fileSystem?: FileSystem,
			sensitiveData?: Record<string, string>,
			availableFilePaths?: string[],
		) {
			if (!availableFilePaths || !availableFilePaths.includes(params.path)) {
				return new ActionResult({
					error: `File path ${params.path} is not available`,
				});
			}

			// Check if file exists (simplified check)
			try {
				// This is a simplified existence check - in a real implementation
				// you'd use fs.promises.access or similar
				const fileUploadDomEl =
					await browserSession.findFileUploadElementByIndex(params.index, 3, 3);

				if (!fileUploadDomEl) {
					const msg = `No file upload element found at index ${params.index}`;
					logger.info(msg);
					return new ActionResult({ error: msg });
				}

				const fileUploadEl =
					await browserSession.getLocateElement(fileUploadDomEl);
				if (!fileUploadEl) {
					const msg = `No file upload element found at index ${params.index}`;
					logger.info(msg);
					return new ActionResult({ error: msg });
				}

				await fileUploadEl.setInputFiles(params.path);
				const msg = `📁 Successfully uploaded file to index ${params.index}`;
				logger.info(msg);
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
					longTermMemory: `Uploaded file ${params.path} to element ${params.index}`,
				});
			} catch (e: any) {
				const msg = `Failed to upload file to index ${params.index}: ${e.toString()}`;
				logger.info(msg);
				return new ActionResult({ error: msg });
			}
		});

		// Tab Management Actions
		this.registry.action("Switch tab", {
			paramModel: SwitchTabAction,
		})(async function switchTab(
			params: z.infer<typeof SwitchTabAction>,
			browserSession: BrowserSession,
		) {
			await browserSession.switchToTab(params.pageId);
			const page = await browserSession.getCurrentPage();
			try {
				await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
				// page was already loaded when we first navigated, this is additional to wait for onfocus/onblur animations/ajax to settle
			} catch (e) {
				// Ignore timeout errors
			}
			const msg = `🔄 Switched to tab #${params.pageId} with url ${page.url()}`;
			logger.info(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
				longTermMemory: `Switched to tab ${params.pageId}`,
			});
		});

		// closeTab
		this.registry.action("Close an existing tab", {
			paramModel: CloseTabAction,
		})(async function closeTab(
			params: z.infer<typeof CloseTabAction>,
			browserSession: BrowserSession,
		) {
			await browserSession.switchToTab(params.pageId);
			const page = await browserSession.getCurrentPage();
			const url = page.url();
			await page.close();
			const newPage = await browserSession.getCurrentPage();
			const newPageIdx = browserSession.tabs.indexOf(newPage);
			const msg = `❌ Closed tab #${params.pageId} with ${url}, now focused on tab #${newPageIdx} with url ${newPage.url()}`;
			logger.info(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
				longTermMemory: `Closed tab ${params.pageId} with url ${url}, now focused on tab ${newPageIdx} with url ${newPage.url()}.`,
			});
		});

		// Extract Structured Data Action
		this.registry.action(
			"Extract structured, semantic data (e.g. product description, price, all information about XYZ) from the current webpage based on a textual query. Only use this for extracting info from a single product/article page, not for entire listings or search results pages. Set extractLinks=true ONLY if your query requires extracting links/URLs from the page.",
			{
				paramModel: ExtractStructuredDataAction,
			},
		)(async function extractStructuredData(
			params: z.infer<typeof ExtractStructuredDataAction>,
			browserSession: BrowserSession,
			pageExtractionLlm?: BaseChatModel,
			fileSystem?: FileSystem,
		) {
			if (!pageExtractionLlm) {
				return new ActionResult({
					error:
						"Page extraction LLM is required for structured data extraction",
				});
			}

			if (!fileSystem) {
				return new ActionResult({
					error: "File system is required for structured data extraction",
				});
			}

			const page = await browserSession.getCurrentPage();
			const turndownService = new TurndownService();

			// Configure turndown to strip links and images if not needed
			if (!params.extractLinks) {
				turndownService.remove(["a", "img"]);
			}

			// Try getting page content with retries
			const [pageHtml, actionResult] = await retryAsyncFunction(
				() => page.content(),
				"Couldn't extract page content due to an error.",
			);
			if (actionResult) {
				return actionResult;
			}

			let content = turndownService.turndown(pageHtml || "");

			// Manually append iframe text into the content so it's readable by the LLM (includes cross-origin iframes)
			for (const frame of page.frames()) {
				try {
					await frame.waitForLoadState("load", { timeout: 5000 }); // extra on top of already loaded page
				} catch (e: any) {
					// Ignore timeout errors
				}

				if (frame.url() !== page.url() && !frame.url().startsWith("data:")) {
					content += `\n\nIFRAME ${frame.url()}:\n`;
					try {
						const iframeHtml = await frame.content();
						const iframeMarkdown = turndownService.turndown(iframeHtml);
						content += iframeMarkdown;
					} catch (e: any) {
						logger.debug(
							`Error extracting iframe content from within page ${page.url()}: ${e.constructor.name}: ${e.message}`,
						);
					}
				}
			}

			// Limit to 40000 characters - remove text in the middle this is approx 20000 tokens
			const maxChars = 40000;
			if (content.length > maxChars) {
				content =
					content.substring(0, maxChars / 2) +
					"\n... left out the middle because it was too long ...\n" +
					content.substring(content.length - maxChars / 2);
			}

			const prompt = `You convert websites into structured information. Extract information from this webpage based on the query. Focus only on content relevant to the query. If 
1. The query is vague
2. Does not make sense for the page
3. Some/all of the information is not available

Explain the content of the page and that the requested information is not available in the page. Respond in JSON format.
Query: ${params.query}
Website:
${content}`;

			try {
				const userMessage = createUserMessage(prompt);
				const response = await pageExtractionLlm.ainvoke([userMessage]);

				const extractedContent = `Page Link: ${page.url()}\nQuery: ${params.query}\nExtracted Content:\n${response.completion}`;

				// If content is small include it to memory
				const MAX_MEMORY_SIZE = 600;
				let memory: string;
				let includeExtractedContentOnlyOnce = false;

				if (extractedContent.length < MAX_MEMORY_SIZE) {
					memory = extractedContent;
				} else {
					// Find lines until MAX_MEMORY_SIZE
					const lines = extractedContent.split("\n");
					let display = "";
					let displayLinesCount = 0;

					for (const line of lines) {
						if (display.length + line.length < MAX_MEMORY_SIZE) {
							display += line + "\n";
							displayLinesCount++;
						} else {
							break;
						}
					}

					const saveResult =
						await fileSystem.saveExtractedContent(extractedContent);
					memory = `Extracted content from ${page.url()}\n<query>${params.query}\n</query>\n<extracted_content>\n${display}${lines.length - displayLinesCount} more lines...\n</extracted_content>\n<file_system>${saveResult}</file_system>`;
					includeExtractedContentOnlyOnce = true;
				}

				logger.info(`📄 ${memory}`);
				return new ActionResult({
					extractedContent,
					includeExtractedContentOnlyOnce,
					longTermMemory: memory,
				});
			} catch (e: any) {
				logger.debug(`Error extracting content: ${e.message}`);
				const msg = `📄 Extracted from page: ${content}`;
				logger.info(msg);
				return new ActionResult({ error: e.toString() });
			}
		});

		// Scroll Actions
		/**
		 * (a) Use browser._scroll_container for container-aware scrolling.
		 * (b) If that JavaScript throws, fall back to window.scrollBy().
		 */
		this.registry.action(
			"Scroll the page by one page (set down=true to scroll down, down=false to scroll up)",
			{
				paramModel: ScrollAction,
			},
		)(async function scroll(
			params: z.infer<typeof ScrollAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();

			// Get window height with retries
			const [dyResult, actionResult] = await retryAsyncFunction(
				() => (page as any).evaluate("() => window.innerHeight"),
				"Scroll failed due to an error.",
			);
			if (actionResult) {
				return actionResult;
			}

			// Set direction based on down parameter
			const dy = params.down ? dyResult || 0 : -(dyResult || 0);

			try {
				await browserSession._scrollContainer(dy as number);
			} catch (e: any) {
				// Hard fallback: always works on root scroller
				await (page as any).evaluate("(y) => window.scrollBy(0, y)", dy);
				logger.debug("Smart scroll failed; used window.scrollBy fallback", e);
			}

			const direction = params.down ? "down" : "up";
			const msg = `🔍 Scrolled ${direction} the page by one page`;
			logger.info(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
				longTermMemory: `Scrolled ${direction} the page by one page`,
			});
		});

		// Send Keys Actions
		this.registry.action(
			"Send strings of special keys to use Playwright page.keyboard.press - examples include Escape, Backspace, Insert, PageDown, Delete, Enter, or Shortcuts such as `Control+o`, `Control+Shift+T`",
			{
				paramModel: SendKeysAction,
			},
		)(async function sendKeys(
			params: z.infer<typeof SendKeysAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();

			try {
				await page.keyboard.press(params.keys);
			} catch (e: any) {
				if (e.message.includes("Unknown key")) {
					// loop over the keys and try to send each one
					for (const key of params.keys) {
						try {
							await page.keyboard.press(key);
						} catch (keyError: any) {
							logger.debug(`Error sending key ${key}: ${keyError.message}`);
							throw keyError;
						}
					}
				} else {
					throw e;
				}
			}
			const msg = `⌨️ Sent keys: ${params.keys}`;
			logger.info(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
				longTermMemory: `Sent keys: ${params.keys}`,
			});
		});

		// Scroll To Text Action
		this.registry.action("Scroll to a text in the current page", {
			paramModel: ScrollToTextAction,
		})(async function scrollToText(
			params: z.infer<typeof ScrollToTextAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();

			try {
				// Try different locator strategies
				const locators = [
					page.getByText(params.text, { exact: false }),
					page.locator(`text=${params.text}`),
					page.locator(`//*[contains(text(), '${params.text}')]`),
				];

				for (const locator of locators) {
					try {
						const count = await locator.count();
						if (count === 0) {
							continue;
						}

						const element = locator.first();
						const isVisible = await element.isVisible();
						const bbox = await element.boundingBox();

						if (isVisible && bbox && bbox.width > 0 && bbox.height > 0) {
							await element.scrollIntoViewIfNeeded();
							await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for scroll to complete
							const msg = `🔍 Scrolled to text: ${params.text}`;
							logger.info(msg);
							return new ActionResult({
								extractedContent: msg,
								includeInMemory: true,
								longTermMemory: `Scrolled to text: ${params.text}`,
							});
						}
					} catch (e: any) {
						logger.debug(`Locator attempt failed: ${e.message}`);
						continue;
					}
				}

				const msg = `Text '${params.text}' not found or not visible on page`;
				logger.info(msg);
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
					longTermMemory: `Tried scrolling to text '${params.text}' but it was not found`,
				});
			} catch (e: any) {
				const msg = `Failed to scroll to text '${params.text}': ${e.message}`;
				logger.error(msg);
				return new ActionResult({ error: msg, includeInMemory: true });
			}
		});

		// File System Actions
		this.registry.action(
			"Write content to fileName in file system, use only .md or .txt extensions.",
			{
				paramModel: WriteFileAction,
			},
		)(async function writeFile(
			params: z.infer<typeof WriteFileAction>,
			browserSession: BrowserSession,
			pageExtractionLlm?: BaseChatModel,
			fileSystem?: FileSystem,
		) {
			if (!fileSystem) {
				return new ActionResult({
					error: "File system is required for file operations",
				});
			}

			const result = await fileSystem.writeFile(
				params.fileName,
				params.content,
			);
			logger.info(`💾 ${result}`);
			return new ActionResult({
				extractedContent: result,
				includeInMemory: true,
				longTermMemory: result,
			});
		});

		this.registry.action("Append content to fileName in file system", {
			paramModel: AppendFileAction,
		})(async function appendFile(
			params: z.infer<typeof AppendFileAction>,
			browserSession: BrowserSession,
			pageExtractionLlm?: BaseChatModel,
			fileSystem?: FileSystem,
		) {
			if (!fileSystem) {
				return new ActionResult({
					error: "File system is required for file operations",
				});
			}

			const result = await fileSystem.appendFile(
				params.fileName,
				params.content,
			);
			logger.info(`💾 ${result}`);
			return new ActionResult({
				extractedContent: result,
				includeInMemory: true,
				longTermMemory: result,
			});
		});

		this.registry.action("Read fileName from file system", {
			paramModel: ReadFileAction,
		})(async function readFile(
			params: z.infer<typeof ReadFileAction>,
			browserSession: BrowserSession,
			pageExtractionLlm?: BaseChatModel,
			fileSystem?: FileSystem,
			sensitiveData?: Record<string, string | Record<string, string>>,
			availableFilePaths?: string[],
		) {
			if (!fileSystem) {
				return new ActionResult({
					error: "File system is required for file operations",
				});
			}

			let result: string;
			if (availableFilePaths && availableFilePaths.includes(params.fileName)) {
				// Read from available file paths (simplified file system access)
				try {
					// In a real implementation, you'd use fs.promises.readFile or similar
					result = `Read from file ${params.fileName}.\n<content>\n[Content would be read from file system]\n</content>`;
				} catch (e: any) {
					result = `Error reading file: ${e.message}`;
				}
			} else {
				result = fileSystem.readFile(params.fileName);
			}

			const MAX_MEMORY_SIZE = 1000;
			let memory: string;
			if (result.length > MAX_MEMORY_SIZE) {
				const lines = result.split("\n");
				let display = "";
				let linesCount = 0;
				for (const line of lines) {
					if (display.length + line.length < MAX_MEMORY_SIZE) {
						display += line + "\n";
						linesCount++;
					} else {
						break;
					}
				}
				const remainingLines = lines.length - linesCount;
				memory =
					remainingLines > 0
						? `${display}${remainingLines} more lines...`
						: display;
			} else {
				memory = result;
			}

			logger.info(`💾 ${memory}`);
			return new ActionResult({
				extractedContent: result,
				includeInMemory: true,
				longTermMemory: memory,
				includeExtractedContentOnlyOnce: true,
			});
		});

		// Dropdown Actions
		this.registry.action("Get all options from a native dropdown", {
			paramModel: GetDropdownOptionsAction,
		})(async function getDropdownOptions(
			params: z.infer<typeof GetDropdownOptionsAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();
			const selectorMap = await browserSession.getSelectorMap();
			const domElement = selectorMap[params.index];

			if (!domElement) {
				return new ActionResult({
					error: `Element with index ${params.index} does not exist`,
				});
			}

			try {
				// Frame-aware approach since we know it works
				const allOptions: string[] = [];
				let frameIndex = 0;

				for (const frame of page.frames()) {
					try {
						const options = await (frame as any).evaluate(
							`
							(xpath) => {
								const select = document.evaluate(xpath, document, null,
									XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
								if (!select) return null;

								return {
									options: Array.from(select.options).map(opt => ({
										text: opt.text, //do not trim, because we are doing exact match in select_dropdown_option
										value: opt.value,
										index: opt.index
									})),
									id: select.id,
									name: select.name
								};
							}
						`,
							domElement.xpath,
						);

						if (options) {
							logger.debug(`Found dropdown in frame ${frameIndex}`);
							logger.debug(`Dropdown ID: ${options.id}, Name: ${options.name}`);

							const formattedOptions: string[] = [];
							for (const opt of options.options) {
								// encoding ensures AI uses the exact string in select_dropdown_option
								const encodedText = JSON.stringify(opt.text);
								formattedOptions.push(`${opt.index}: text=${encodedText}`);
							}

							allOptions.push(...formattedOptions);
						}
					} catch (frameE: any) {
						logger.debug(
							`Frame ${frameIndex} evaluation failed: ${frameE.message}`,
						);
					}

					frameIndex++;
				}

				if (allOptions.length > 0) {
					const msg =
						allOptions.join("\n") +
						"\nUse the exact text string in select_dropdown_option";
					logger.info(msg);
					return new ActionResult({
						extractedContent: msg,
						includeInMemory: true,
						longTermMemory: `Found dropdown options for index ${params.index}.`,
						includeExtractedContentOnlyOnce: true,
					});
				} else {
					const msg = "No options found in any frame for dropdown";
					logger.info(msg);
					return new ActionResult({
						extractedContent: msg,
						includeInMemory: true,
						longTermMemory: "No dropdown options found",
					});
				}
			} catch (e: any) {
				logger.error(`Failed to get dropdown options: ${e.message}`);
				const msg = `Error getting options: ${e.message}`;
				logger.info(msg);
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
				});
			}
		});

		// Select Dropdown Option Action
		this.registry.action(
			"Select dropdown option for interactive element index by the text of the option you want to select",
			{
				paramModel: SelectDropdownOptionAction,
			},
		)(async function selectDropdownOption(
			params: z.infer<typeof SelectDropdownOptionAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();
			const selectorMap = await browserSession.getSelectorMap();
			const domElement = selectorMap[params.index];

			if (!domElement) {
				return new ActionResult({
					error: `Element with index ${params.index} does not exist`,
				});
			}

			// Validate that we're working with a select element
			if (domElement.tagName !== "select") {
				logger.error(
					`Element is not a select! Tag: ${domElement.tagName}, Attributes: ${domElement.attributes}`,
				);
				const msg = `Cannot select option: Element with index ${params.index} is a ${domElement.tagName}, not a select`;
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
					longTermMemory: msg,
				});
			}

			logger.debug(
				`Attempting to select '${params.text}' using xpath: ${domElement.xpath}`,
			);
			logger.debug(`Element attributes: ${domElement.attributes}`);
			logger.debug(`Element tag: ${domElement.tagName}`);

			try {
				let frameIndex = 0;
				for (const frame of page.frames()) {
					try {
						logger.debug(`Trying frame ${frameIndex} URL: ${frame.url()}`);

						// First verify we can find the dropdown in this frame
						const dropdownInfo = await (frame as any).evaluate(
							`
							(xpath) => {
								try {
									const select = document.evaluate(xpath, document, null,
										XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
									if (!select) return null;
									if (select.tagName.toLowerCase() !== "select") {
										return {
											error: \`Found element but it's a \${select.tagName}, not a SELECT\`,
											found: false
										};
									}
									return {
										id: select.id,
										name: select.name,
										found: true,
										tagName: select.tagName,
										optionCount: select.options.length,
										currentValue: select.value,
										availableOptions: Array.from(select.options).map(o => o.text.trim())
									};
								} catch (e) {
									return { error: e.toString(), found: false };
								}
							}
						`,
							domElement.xpath,
						);

						if (dropdownInfo) {
							if (!dropdownInfo.found) {
								logger.error(
									`Frame ${frameIndex} error: ${dropdownInfo.error}`,
								);
								continue;
							}

							logger.debug(
								`Found dropdown in frame ${frameIndex}: ${JSON.stringify(dropdownInfo)}`,
							);

							// "label" because we are selecting by text
							// nth(0) to disable error thrown by strict mode
							// timeout=1000 because we are already waiting for all network events, therefore ideally we don't need to wait a lot here (default 30s)
							const selectedOptionValues = await frame
								.locator(`//${domElement.xpath}`)
								.nth(0)
								.selectOption({ label: params.text }, { timeout: 1000 });

							const msg = `selected option ${params.text} with value ${selectedOptionValues}`;
							logger.info(msg + ` in frame ${frameIndex}`);

							return new ActionResult({
								extractedContent: msg,
								includeInMemory: true,
								longTermMemory: `Selected option '${params.text}'`,
							});
						}
					} catch (frameE: any) {
						logger.error(
							`Frame ${frameIndex} attempt failed: ${frameE.message}`,
						);
						logger.error(`Frame type: ${typeof frame}`);
						logger.error(`Frame URL: ${frame.url()}`);
					}

					frameIndex++;
				}

				const msg = `Could not select option '${params.text}' in any frame`;
				logger.info(msg);
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
					longTermMemory: msg,
				});
			} catch (e: any) {
				const msg = `Selection failed: ${e.message}`;
				logger.error(msg);
				return new ActionResult({ error: msg, includeInMemory: true });
			}
		});

		// Google Sheets Actions
		this.registry.action(
			"Google Sheets: Get the contents of the entire sheet",
			{ domains: ["https://docs.google.com"] },
		)(async function readSheetContents(
			params: z.infer<typeof NoParamsAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();

			// select all cells
			await page.keyboard.press("Enter");
			await page.keyboard.press("Escape");
			await page.keyboard.press("ControlOrMeta+A");
			await page.keyboard.press("ControlOrMeta+C");

			const extractedTsv = await (page as any).evaluate(
				"() => navigator.clipboard.readText()",
			);
			return new ActionResult({
				extractedContent: extractedTsv,
				includeInMemory: true,
				longTermMemory: "Retrieved sheet contents",
				includeExtractedContentOnlyOnce: true,
			});
		});

		this.registry.action(
			"Google Sheets: Get the contents of a cell or range of cells",
			{
				paramModel: ReadCellContentsAction,
				domains: ["https://docs.google.com"],
			},
		)(async function readCellContents(
			params: z.infer<typeof ReadCellContentsAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();

			await Controller.selectCellOrRangeHelper(params.cellOrRange, page);

			await page.keyboard.press("ControlOrMeta+C");
			await new Promise((resolve) => setTimeout(resolve, 100));
			const extractedTsv = await (page as any).evaluate(
				"() => navigator.clipboard.readText()",
			);
			return new ActionResult({
				extractedContent: extractedTsv,
				includeInMemory: true,
				longTermMemory: `Retrieved contents from ${params.cellOrRange}`,
				includeExtractedContentOnlyOnce: true,
			});
		});

		this.registry.action(
			"Google Sheets: Update the content of a cell or range of cells",
			{
				paramModel: UpdateCellContentsAction,
				domains: ["https://docs.google.com"],
			},
		)(async function updateCellContents(
			params: z.infer<typeof UpdateCellContentsAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();

			await Controller.selectCellOrRangeHelper(params.cellOrRange, page);

			// simulate paste event from clipboard with TSV content
			await (page as any).evaluate(
				`
				(newContentsTsv) => {
					const clipboardData = new DataTransfer();
					clipboardData.setData('text/plain', newContentsTsv);
					document.activeElement?.dispatchEvent(
						new ClipboardEvent('paste', { clipboardData })
					);
				}
			`,
				params.newContentsTsv,
			);

			return new ActionResult({
				extractedContent: `Updated cells: ${params.cellOrRange} = ${params.newContentsTsv}`,
				includeInMemory: false,
				longTermMemory: `Updated cells ${params.cellOrRange} with ${params.newContentsTsv}`,
			});
		});

		this.registry.action(
			"Google Sheets: Clear whatever cells are currently selected",
			{
				paramModel: ClearCellContentsAction,
				domains: ["https://docs.google.com"],
			},
		)(async function clearCellContents(
			params: z.infer<typeof ClearCellContentsAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();

			await Controller.selectCellOrRangeHelper(params.cellOrRange, page);

			await page.keyboard.press("Backspace");
			return new ActionResult({
				extractedContent: `Cleared cells: ${params.cellOrRange}`,
				includeInMemory: false,
				longTermMemory: `Cleared cells ${params.cellOrRange}`,
			});
		});

		this.registry.action(
			"Google Sheets: Select a specific cell or range of cells",
			{
				paramModel: SelectCellOrRangeAction,
				domains: ["https://docs.google.com"],
			},
		)(async function selectCellOrRange(
			params: z.infer<typeof SelectCellOrRangeAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();
			await Controller.selectCellOrRangeHelper(params.cellOrRange, page);
			return new ActionResult({
				extractedContent: `Selected cells: ${params.cellOrRange}`,
				includeInMemory: false,
				longTermMemory: `Selected cells ${params.cellOrRange}`,
			});
		});

		this.registry.action(
			"Google Sheets: Fallback method to type text into (only one) currently selected cell",
			{
				paramModel: FallbackInputSingleCellAction,
				domains: ["https://docs.google.com"],
			},
		)(async function fallbackInputSingleCell(
			params: z.infer<typeof FallbackInputSingleCellAction>,
			browserSession: BrowserSession,
		) {
			const page = await browserSession.getCurrentPage();
			await page.keyboard.type(params.text, { delay: 100 });
			await page.keyboard.press("Enter"); // make sure to commit the input so it doesn't get overwritten by the next action
			await page.keyboard.press("ArrowUp");
			return new ActionResult({
				extractedContent: `Inputted text ${params.text}`,
				includeInMemory: false,
				longTermMemory: `Inputted text '${params.text}' into cell`,
			});
		});
	}

	// Helper function for Google Sheets cell selection
	private static async selectCellOrRangeHelper(
		cellOrRange: string,
		page: any,
	): Promise<void> {
		await page.keyboard.press("Enter"); // make sure we dont delete current cell contents if we were last editing
		await page.keyboard.press("Escape"); // to clear current focus (otherwise select range popup is additive)
		await new Promise((resolve) => setTimeout(resolve, 100));
		await page.keyboard.press("Home"); // move cursor to the top left of the sheet first
		await page.keyboard.press("ArrowUp");
		await new Promise((resolve) => setTimeout(resolve, 100));
		await page.keyboard.press("Control+G"); // open the goto range popup
		await new Promise((resolve) => setTimeout(resolve, 200));
		await page.keyboard.type(cellOrRange, { delay: 50 });
		await new Promise((resolve) => setTimeout(resolve, 200));
		await page.keyboard.press("Enter");
		await new Promise((resolve) => setTimeout(resolve, 200));
		await page.keyboard.press("Escape"); // to make sure the popup still closes in the case where the jump failed
	}

	useStructuredOutputAction(outputModel: any) {
		this.registerDoneAction(outputModel);
	}

	// Register ---------------------------------------------------------------

	// Register actions decorator
	/**
	 * Decorator for registering custom actions
	 *
	 * @param description: Describe the LLM what the function does (better description == better function calling)
	 */
	action(description: string, options?: any) {
		return this.registry.action(description, options);
	}

	// Act --------------------------------------------------------------------

	/**
	 * Execute an action
	 *
	 * @param action: The action to execute
	 * @param browserSession: The browser session
	 */
	@timeExecution("--act")
	async act(
		action: ActionModel,
		browserSession: BrowserSession,
		pageExtractionLlm?: BaseChatModel,
		sensitiveData?: Record<string, string | Record<string, string>>,
		availableFilePaths?: string[],
		fileSystem?: FileSystem,
		context?: Context,
	): Promise<ActionResult> {
		try {
			// Iterate through action's model properties, excluding unset fields
			for (const [actionName, params] of Object.entries(action)) {
				if (params !== undefined) {
					const result = await this.registry.executeAction(
						actionName,
						params,
						browserSession,
						pageExtractionLlm,
						fileSystem,
						sensitiveData,
						availableFilePaths,
						context,
					);

					if (typeof result === "string") {
						return new ActionResult({
							extractedContent: result,
							includeInMemory: true,
						});
					} else if (result instanceof ActionResult) {
						return result;
					} else if (result === undefined) {
						return new ActionResult({ extractedContent: result });
					} else {
						throw new Error(`Invalid action result type: ${typeof result}`);
					}
				}
			}
			return new ActionResult({});
		} catch (e) {
			throw e;
		}
	}
}
