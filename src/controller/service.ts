import { z } from "zod";
import { BrowserSession } from "../browser/session";
import type { BaseChatModel } from "../llm/base";
import { Registry } from "./registry/service";
import {
	ClickElementAction,
	CloseTabAction,
	DoneAction,
	GoToUrlAction,
	InputTextAction,
	NoParamsAction,
	ScrollAction,
	SearchGoogleAction,
	SendKeysAction,
	StructuredOutputAction,
	SwitchTabAction,
	UploadFileAction,
} from "./views";

import { ActionResult } from "../agent/views";
import type { FileSystem } from "../filesystem/file_system";
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
				StructuredOutputAction,
			)(async function done(params: z.infer<typeof StructuredOutputAction>) {
				return new ActionResult({
					isDone: true,
					success: params.success,
					extractedContent: JSON.stringify(params.data),
				});
			});
		} else {
			// If no output model is specified, use the default DoneAction model
			this.registry.action(
				"Complete task - provide a summary of results for the user. Set success=True if task completed successfully, false otherwise. Text should be your response to the user summarizing results. Include files you would like to display to the user in filesToDisplay.",
				DoneAction,
			)(
				async (
					params: z.infer<typeof DoneAction>,
					browserSession: BrowserSession,
					pageExtractionLlm?: BaseChatModel,
					fileSystem?: FileSystem,
				) => {
					let userMessage = params.text;

					const lenText = params.text.length;
					const lenMaxMemory = 100;
					let memory = `Task completed: ${params.success} - ${params.text.substring(0, lenMaxMemory)}`;
					if (lenText > lenMaxMemory) {
						memory += ` - ${lenText - lenMaxMemory} more characters`;
					}

					const attachments: string[] = [];
					if (params.filesToDisplay && fileSystem) {
						if (this.displayFilesInDoneText) {
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
								logger.warn(
									"Agent wanted to display files but none were found",
								);
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
				},
			);
		}
	}

	private registerDefaultActions() {
		// Basic Navigation Actions
		this.registry.action(
			"Search the query in Google, the query should be a search query like humans search in Google, concrete and not vague or super long.",
			SearchGoogleAction,
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

		this.registry.action(
			"Navigate to URL, set newTab=true to open in new tab, false to navigate in current tab",
			GoToUrlAction,
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
					// Navigate in current tab
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

		this.registry.action(
			"Go back",
			NoParamsAction,
		)(async function goBack(
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
		this.registry.action(
			"Click element by index",
			ClickElementAction,
		)(async function clickElementByIndex(
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

			// Check if element has file uploader
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

		this.registry.action(
			"Click and input text into a input interactive element",
			InputTextAction,
		)(async function inputText(
			params: z.infer<typeof InputTextAction>,
			browserSession: BrowserSession,
			pageExtractionLlm?: BaseChatModel,
			fileSystem?: FileSystem,
			sensitiveData?: Record<string, string>,
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

		this.registry.action(
			"Upload file to interactive element with file path",
			UploadFileAction,
		)(async function uploadFile(
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
		this.registry.action(
			"Switch tab",
			SwitchTabAction,
		)(async function switchTab(
			params: z.infer<typeof SwitchTabAction>,
			browserSession: BrowserSession,
		) {
			await browserSession.switchToTab(params.pageId);
			const page = await browserSession.getCurrentPage();
			try {
				await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
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

		this.registry.action(
			"Close an existing tab",
			CloseTabAction,
		)(async function closeTab(
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

		// Scroll Actions
		this.registry.action(
			"Scroll the page by one page (set down=true to scroll down, down=false to scroll up)",
			ScrollAction,
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
			SendKeysAction,
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
