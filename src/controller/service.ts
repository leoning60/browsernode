import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { PromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { BrowserContext } from "../browser/context";
import { Registry } from "./registry/service";
import {
	ClickElementAction,
	DoneAction,
	ExtractContentAction,
	GetDropdownOptionsAction,
	GoToUrlAction,
	InputTextAction,
	NoParamsAction,
	OpenTabAction,
	ScrollAction,
	ScrollToTextAction,
	SearchGoogleAction,
	SelectDropdownOptionAction,
	SendKeysAction,
	SwitchTabAction,
	WaitAction,
} from "./views";

import { ActionResult } from "../agent/views";
import bnLogger from "../logging_config";
import { timeExecution } from "../utils";
import type { ActionModel } from "./registry/views";

// Setup logger
const logger = bnLogger.child({
	name: "browser_node/controller/service",
});

// Generic type for Context
type Context = any;

export class Controller<T = Context> {
	public registry: Registry<T>;

	constructor(
		public excludeActions: string[] = [],
		public outputModel: any = null,
	) {
		// Initialize registry
		this.registry = new Registry<T>(excludeActions);
		// Register all default browser actions
		if (outputModel !== null) {
			const CustomizedOutputModelAction = z.object({
				data: outputModel,
				success: z.boolean(),
			});
			this.registry.action(
				"Complete task - with return text and if the task is finished (success=True) or not yet completely finished (success=False), because last step is reached",
				{ paramModel: CustomizedOutputModelAction },
			)(async function done(
				params: z.infer<typeof CustomizedOutputModelAction>,
			) {
				return new ActionResult({
					isDone: true,
					success: params.success,
					extractedContent: JSON.stringify(params.data),
				});
			});
		} else {
			// console.debug(
			// 	"No output model specified, using default DoneAction model",
			// );
			// If no output model is specified, use the default DoneAction model
			this.registry.action(
				"Complete task - with return text and if the task is finished (success=True) or not yet completely finished (success=False), because last step is reached",
				{ paramModel: DoneAction },
			)(async function done(params: z.infer<typeof DoneAction>) {
				return new ActionResult({
					isDone: true,
					success: params.success,
					extractedContent: params.text,
				});
			});
		}

		// Basic Navigation Actions
		this.registry.action(
			"Search the query in Google in the current tab, the query should be a search query like humans search in Google, concrete and not vague or super long. More the single most important items.",
			{ paramModel: SearchGoogleAction },
		)(async function searchGoogle(
			params: z.infer<typeof SearchGoogleAction>,
			browser: BrowserContext,
		) {
			const page = await browser.getCurrentPage();
			await page.goto(`https://www.google.com/search?q=${params.query}&udm=14`);
			// await page.goto(`https://search.brave.com/search?q=${params.query}&source=web`,);
			await page.waitForLoadState();
			const msg = `🔍 Searched for "${params.query}" in Google`;
			logger.info(msg);
			return new ActionResult({ extractedContent: msg, includeInMemory: true });
		});

		this.registry.action("Navigate to URL in the current tab", {
			paramModel: GoToUrlAction,
		})(async function goToUrl(
			params: z.infer<typeof GoToUrlAction>,
			browser: BrowserContext,
		) {
			if (!browser) {
				throw new Error("Browser context is required but was not provided");
			}

			const page = await browser.getCurrentPage();
			await page.goto(params.url);
			await page.waitForLoadState();
			const msg = `🔗 Navigated to ${params.url}`;
			logger.info(msg);
			return new ActionResult({ extractedContent: msg, includeInMemory: true });
		});

		this.registry.action("Go back", { paramModel: NoParamsAction })(
			async function goBack(
				_: z.infer<typeof NoParamsAction>,
				browser: BrowserContext,
			) {
				if (!browser) {
					throw new Error("Browser context is required but was not provided");
				}
				await browser.goBack();
				const msg = "🔙 Navigated back";
				logger.info(msg);
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
				});
			},
		);

		// Wait for x seconds
		this.registry.action("Wait for x seconds default 3", {
			paramModel: WaitAction,
		})(async function wait(params: z.infer<typeof WaitAction>) {
			const msg = `🕒 Waiting for ${params.seconds} seconds`;
			logger.info(msg);
			await new Promise((resolve) =>
				setTimeout(resolve, params.seconds * 1000),
			);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
			});
		});

		// Element Interaction Actions
		this.registry.action("Click element", {
			paramModel: ClickElementAction,
		})(async function clickElement(
			params: z.infer<typeof ClickElementAction>,
			browser: BrowserContext,
		) {
			const session = await browser.getSession();

			if (
				!Object.keys(await browser.getSelectorMap()).includes(
					params.index.toString(),
				)
			) {
				throw new Error(
					`Element with index ${params.index} does not exist - retry or use alternative actions`,
				);
			}

			const elementNode = await browser.getDomElementByIndex(params.index);
			const initialPages = session.context.pages.length;

			// Check if element has file uploader
			if (await browser.isFileUploader(elementNode)) {
				const msg = `Index ${params.index} - has an element which opens file upload dialog. To upload files please use a specific function to upload files`;
				logger.info(msg);
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
				});
			}

			let msg = null;

			try {
				const downloadPath = await browser.clickElementNode(elementNode);
				if (downloadPath) {
					msg = `💾 Downloaded file to ${downloadPath}`;
				} else {
					msg = `🖱️ Clicked button with index ${params.index}: ${elementNode.getAllTextTillNextClickableElement(2)}`;
				}

				logger.info(msg);
				logger.debug(`Element xpath: ${elementNode.xpath}`);

				if (session.context.pages.length > initialPages) {
					const newTabMsg = "New tab opened - switching to it";
					msg += ` - ${newTabMsg}`;
					logger.info(newTabMsg);
					await browser.switchToTab(-1);
				}

				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
				});
			} catch (e: any) {
				logger.warn(
					`Element not clickable with index ${params.index} - most likely the page changed`,
				);
				return new ActionResult({ error: e.toString() });
			}
		});

		this.registry.action("Input text into a input interactive element", {
			paramModel: InputTextAction,
		})(async function inputText(
			params: z.infer<typeof InputTextAction>,
			browser: BrowserContext,
			hasSensitiveData: boolean = false,
		) {
			if (
				!Object.keys(await browser.getSelectorMap()).includes(
					params.index.toString(),
				)
			) {
				throw new Error(
					`Element index ${params.index} does not exist - retry or use alternative actions`,
				);
			}

			const elementNode = await browser.getDomElementByIndex(params.index);
			await browser.inputTextElementNode(elementNode, params.text);

			const msg = !hasSensitiveData
				? `⌨️ Input ${params.text} into index ${params.index}`
				: `⌨️ Input sensitive data into index ${params.index}`;

			logger.info(msg);
			logger.debug(`Element xpath: ${elementNode.xpath}`);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
			});
		});

		// Save PDF
		this.registry.action("Save the current page as a PDF file", {
			paramModel: NoParamsAction,
		})(async function savePdf(
			_: z.infer<typeof NoParamsAction>,
			browser: BrowserContext,
		) {
			const page = await browser.getCurrentPage();
			const shortUrl = page.url().replace(/^https?:\/\/(?:www\.)?|\/$/g, "");
			const slug = shortUrl
				.replace(/[^a-zA-Z0-9]+/g, "-")
				.replace(/^-|-$/g, "")
				.toLowerCase();
			const sanitizedFilename = `${slug}.pdf`;

			await page.emulateMedia({
				media: "screen",
			});
			await page.pdf({
				path: sanitizedFilename,
				format: "A4",
				printBackground: false,
			});
			const msg = `Saving page with URL ${page.url()} as PDF to ./${sanitizedFilename}`;
			logger.info(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
			});
		});

		// Tab Management Actions
		this.registry.action("Switch tab", { paramModel: SwitchTabAction })(
			async function switchTab(
				params: z.infer<typeof SwitchTabAction>,
				browser: BrowserContext,
			) {
				await browser.switchToTab(params.pageId);
				// Wait for tab to be ready
				const page = await browser.getCurrentPage();
				await page.waitForLoadState();
				const msg = `🔄 Switched to tab ${params.pageId}`;
				logger.info(msg);
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
				});
			},
		);

		this.registry.action("Open url in new tab", {
			paramModel: OpenTabAction,
		})(async function openTab(
			params: z.infer<typeof OpenTabAction>,
			browser: BrowserContext,
		) {
			if (!browser) {
				throw new Error("Browser context is required but was not provided");
			}
			await browser.createNewTab(params.url);
			const msg = `🔗 Opened new tab with ${params.url}`;
			logger.info(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
			});
		});

		// Content Actions
		this.registry.action(
			"Extract page content to retrieve specific information from the page, e.g. all company names, a specifc description, all information about, links with companies in structured format or simply links",
			{ paramModel: ExtractContentAction },
		)(async function extractContent(
			params: z.infer<typeof ExtractContentAction>,
			browser: BrowserContext,
			pageExtractionLlm: BaseChatModel,
		) {
			const page = await browser.getCurrentPage();
			// Note: You'll need to install markdownify or use an equivalent TS library
			// For now, we'll assume markdownify functionality is available
			const content = await page.content(); // Use content as-is or implement markdownify equivalent

			const prompt =
				"Your task is to extract the content of the page. You will be given a page and a goal and you should extract all relevant information around this goal from the page. If the goal is vague, summarize the page. Respond in json format. Extraction goal: {goal}, Page: {page}";
			const template = new PromptTemplate({
				inputVariables: ["goal", "page"],
				template: prompt,
			});

			try {
				const output = await pageExtractionLlm.invoke(
					await template.format({ goal: params.goal, page: content }),
				);
				const msg = `📄 Extracted from page\n: ${output.content}\n`;
				logger.info(msg);
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
				});
			} catch (e: any) {
				logger.debug(`Error extracting content: ${e}`);
				const msg = `📄 Extracted from page\n: ${content}\n`;
				// logger.info(msg);
				return new ActionResult({ extractedContent: msg });
			}
		});

		this.registry.action(
			"Scroll down the page by pixel amount - if no amount is specified, scroll down one page",
			{ paramModel: ScrollAction },
		)(async function scrollDown(
			params: z.infer<typeof ScrollAction>,
			browser: BrowserContext,
		) {
			if (!browser) {
				throw new Error("Browser context is required but was not provided");
			}
			const page = await browser.getCurrentPage();
			if (params.amount !== null && params.amount !== undefined) {
				await page.evaluate(`window.scrollBy(0, ${params.amount});`);
			} else {
				await page.evaluate("window.scrollBy(0, window.innerHeight);");
			}

			const amount =
				params.amount !== null && params.amount !== undefined
					? `${params.amount} pixels`
					: "one page";
			const msg = `🔍 Scrolled down the page by ${amount}`;
			logger.info(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
			});
		});

		// scroll up
		this.registry.action(
			"Scroll up the page by pixel amount - if no amount is specified, scroll up one page",
			{ paramModel: ScrollAction },
		)(async function scrollUp(
			params: z.infer<typeof ScrollAction>,
			browser: BrowserContext,
		) {
			if (!browser) {
				throw new Error("Browser context is required but was not provided");
			}
			const page = await browser.getCurrentPage();
			if (params.amount !== null && params.amount !== undefined) {
				await page.evaluate(`window.scrollBy(0, -${params.amount});`);
			} else {
				await page.evaluate("window.scrollBy(0, -window.innerHeight);");
			}

			const amount =
				params.amount !== null && params.amount !== undefined
					? `${params.amount} pixels`
					: "one page";
			const msg = `🔍 Scrolled up the page by ${amount}`;
			logger.info(msg);
			return new ActionResult({
				extractedContent: msg,
				includeInMemory: true,
			});
		});

		// send keys
		this.registry.action(
			"Send strings of special keys like Escape,Backspace, Insert, PageDown, Delete, Enter, Shortcuts such as `Control+o`, `Control+Shift+T` are supported as well. This gets used in keyboard.press.",
			{ paramModel: SendKeysAction },
		)(async function sendKeys(
			params: z.infer<typeof SendKeysAction>,
			browser: BrowserContext,
		) {
			if (!browser) {
				throw new Error("Browser context is required but was not provided");
			}
			const page = await browser.getCurrentPage();

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
			});
		});

		this.registry.action(
			"If you dont find something which you want to interact with, scroll to it",
			{ paramModel: ScrollToTextAction },
		)(async function scrollToText(
			params: z.infer<typeof ScrollToTextAction>,
			browser: BrowserContext,
		) {
			if (!browser) {
				throw new Error("Browser context is required but was not provided");
			}
			const page = await browser.getCurrentPage();
			try {
				// Try different locator strategies
				const locators = [
					page.getByText(params.text, { exact: false }),
					page.locator(`text=${params.text}`),
					page.locator(`//*[contains(text(), '${params.text}')]`),
				];

				for (const locator of locators) {
					try {
						// First check if element exists and is visible
						if (
							(await locator.count()) > 0 &&
							(await locator.first().isVisible())
						) {
							await locator.first().scrollIntoViewIfNeeded();
							await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for scroll to complete
							const msg = `🔍 Scrolled to text: ${params.text}`;
							logger.info(msg);
							return new ActionResult({
								extractedContent: msg,
								includeInMemory: true,
							});
						}
					} catch (e) {
						logger.debug(`Locator attempt failed: ${e}`);
						continue;
					}
				}

				const msg = `Text '${params.text}' not found or not visible on page`;
				logger.info(msg);
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
				});
			} catch (e: any) {
				const msg = `Failed to scroll to text '${params.text}': ${e.message}`;
				logger.error(msg);
				return new ActionResult({
					error: msg,
					includeInMemory: true,
				});
			}
		});

		this.registry.action("Get all options from a native dropdown", {
			paramModel: GetDropdownOptionsAction,
		})(async function getDropdownOptions(
			params: z.infer<typeof GetDropdownOptionsAction>,
			browser: BrowserContext,
		): Promise<ActionResult> {
			const page = await browser.getCurrentPage();
			const selectorMap = await browser.getSelectorMap();
			const domElement = selectorMap[params.index]!;

			try {
				// Frame-aware approach since we know it works
				const allOptions: string[] = [];
				let frameIndex = 0;

				for (const frame of page.frames()) {
					try {
						const options = (await frame.evaluate(
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
						)) as {
							options: Array<{ text: string; value: string; index: number }>;
							id?: string;
							name?: string;
						} | null;

						if (options) {
							logger.debug(`Found dropdown in frame ${frameIndex}`);
							logger.debug(
								`Dropdown ID: ${options["id"]}, Name: ${options["name"]}`,
							);

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
					let msg = allOptions.join("\n");
					msg += "\nUse the exact text string in select_dropdown_option";
					logger.info(msg);
					return new ActionResult({
						extractedContent: msg,
						includeInMemory: true,
					});
				} else {
					const msg = "No options found in any frame for dropdown";
					logger.info(msg);
					return new ActionResult({
						extractedContent: msg,
						includeInMemory: true,
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

		this.registry.action(
			"Select dropdown option for interactive element index by the text of the option you want to select",
			{ paramModel: SelectDropdownOptionAction },
		)(async function selectDropdownOption(
			params: z.infer<typeof SelectDropdownOptionAction>,
			browser: BrowserContext,
		): Promise<ActionResult> {
			const page = await browser.getCurrentPage();
			const selectorMap = await browser.getSelectorMap();
			const domElement = selectorMap[params.index]!;

			// Validate that we're working with a select element
			if (domElement.tagName !== "select") {
				logger.error(
					`Element is not a select! Tag: ${domElement.tagName}, Attributes: ${JSON.stringify(domElement.attributes)}`,
				);
				const msg = `Cannot select option: Element with index ${params.index} is a ${domElement.tagName}, not a select`;
				return new ActionResult({
					extractedContent: msg,
					includeInMemory: true,
				});
			}

			logger.debug(
				`Attempting to select '${params.text}' using xpath: ${domElement.xpath}`,
			);
			logger.debug(
				`Element attributes: ${JSON.stringify(domElement.attributes)}`,
			);
			logger.debug(`Element tag: ${domElement.tagName}`);

			const xpath = "//" + domElement.xpath;

			try {
				let frameIndex = 0;
				for (const frame of page.frames()) {
					try {
						logger.debug(`Trying frame ${frameIndex} URL: ${frame.url()}`);

						// First verify we can find the dropdown in this frame
						const findDropdownJs = `
							(xpath) => {
								try {
									const select = document.evaluate(xpath, document, null,
										XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
									if (!select) return null;
									if (select.tagName.toLowerCase() !== 'select') {
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
									return {error: e.toString(), found: false};
								}
							}
						`;

						const dropdownInfo = (await frame.evaluate(
							findDropdownJs,
							domElement.xpath,
						)) as {
							id?: string;
							name?: string;
							found: boolean;
							error?: string;
							tagName?: string;
							optionCount?: number;
							currentValue?: string;
							availableOptions?: string[];
						} | null;

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
								.locator("//" + domElement.xpath)
								.nth(0)
								.selectOption({ label: params.text }, { timeout: 1000 });

							const msg = `selected option ${params.text} with value ${selectedOptionValues}`;
							logger.info(msg + ` in frame ${frameIndex}`);

							return new ActionResult({
								extractedContent: msg,
								includeInMemory: true,
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
				});
			} catch (e: any) {
				const msg = `Selection failed: ${e.message}`;
				logger.error(msg);
				return new ActionResult({
					error: msg,
					includeInMemory: true,
				});
			}
		});
	}

	// Register actions decorator
	action(description: string, options?: any) {
		return this.registry.action(description, options);
	}

	// Execute an action
	@timeExecution("--act")
	async act(
		action: ActionModel,
		browserContext: BrowserContext,
		pageExtractionLlm?: BaseChatModel,
		sensitiveData?: Record<string, string>,
		availableFilePaths?: string[],
		context?: Context,
	): Promise<ActionResult> {
		try {
			// Iterate through action's model properties, excluding unset fields
			for (const [actionName, params] of Object.entries(action)) {
				if (params !== undefined) {
					const result = await this.registry.executeAction(
						actionName,
						params,
						browserContext,
						pageExtractionLlm,
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
