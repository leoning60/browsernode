import fs from "fs";
import path, { dirname } from "path";
import type { Logger } from "winston";
import type { Page } from "../browser/types";
import type { ViewportInfo } from "./history_tree_processor/view";
import { DOMBaseNode, DOMElementNode, DOMState, DOMTextNode } from "./views";
import type { SelectorMap } from "./views";

import { fileURLToPath } from "url";
import bnLogger from "../logging_config";
import { timeExecution } from "../utils_old";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = bnLogger.child({
	module: "browsernode/dom/service",
});

export class DomService {
	private page: Page;
	private xpathCache: Record<string, any> = {};
	private jsCode: string;
	private logger: Logger;

	constructor(page: Page, logger?: Logger) {
		this.page = page;
		this.xpathCache = {};
		this.logger =
			logger || bnLogger.child({ module: "browsernode/dom/service" });

		this.jsCode = fs.readFileSync(
			path.join(__dirname, "dom_tree", "index.js"),
			"utf-8",
		);
	}

	// region - Clickable elements
	@timeExecution("--getClickableElements(domService)")
	async getClickableElements(
		highlightElements: boolean = true,
		focusElement: number = -1,
		viewportExpansion: number = 0,
	): Promise<DOMState> {
		const [elementTree, selectorMap] = await this.buildDomTree(
			highlightElements,
			focusElement,
			viewportExpansion,
		);
		return {
			elementTree,
			selectorMap,
		};
	}

	@timeExecution("--getCrossOriginIframes(domService)")
	async getCrossOriginIframes(): Promise<string[]> {
		// invisible cross-origin iframes are used for ads and tracking, dont open those
		const hiddenFrameUrls = (await this.page
			.locator("iframe")
			.filter({ visible: false })
			.evaluateAll((elements) => elements.map((e) => e.src))) as string[];

		const isAdUrl = (url: string): boolean => {
			try {
				const hostname = new URL(url).hostname;
				return ["doubleclick.net", "adroll.com", "googletagmanager.com"].some(
					(domain) => hostname.includes(domain),
				);
			} catch {
				return false;
			}
		};

		const currentHostname = new URL(this.page.url()).hostname;

		return this.page
			.frames()
			.map((frame) => frame.url())
			.filter((url) => {
				try {
					const parsedUrl = new URL(url);
					return (
						parsedUrl.hostname && // exclude data:urls and about:blank
						parsedUrl.hostname !== currentHostname && // exclude same-origin iframes
						!hiddenFrameUrls.includes(url) && // exclude hidden frames
						!isAdUrl(url)
					); // exclude most common ad network tracker frame URLs
				} catch {
					return false;
				}
			});
	}

	@timeExecution("--buildDomTree(domService)")
	private async buildDomTree(
		highlightElements: boolean,
		focusElement: number,
		viewportExpansion: number,
	): Promise<[DOMElementNode, SelectorMap]> {
		if ((await (this.page as any).evaluate("1+1")) !== 2) {
			throw new Error("The page cannot evaluate javascript code properly");
		}

		if (this.page.url() === "about:blank") {
			// short-circuit if the page is a new empty tab for speed, no need to inject buildDomTree.js
			return [
				new DOMElementNode(
					false, // isVisible
					null, // parent
					"body", // tagName
					"", // xpath
					{}, // attributes
					[], // children
					false, // isInteractive
					false, // isTopElement
					false, // isInViewport
					false, // shadowRoot
					undefined, // highlightIndex
					undefined, // viewportCoordinates
					undefined, // pageCoordinates
					undefined, // viewportInfo
				),
				{},
			];
		}

		// NOTE: We execute JS code in the browser to extract important DOM information.
		//       The returned hash map contains information about the DOM tree and the
		//       relationship between the DOM elements.
		const debugMode = this.logger.level === "debug";
		const args = {
			doHighlightElements: highlightElements,
			focusHighlightIndex: focusElement,
			viewportExpansion: viewportExpansion,
			debugMode: debugMode,
		};

		try {
			// const evalPage = (await this.page.evaluate(
			//   `(function() {
			//     try {
			//       console.log('Starting evaluation in browser...');
			//       const fn = ${this.jsCode};
			//       console.log('Function defined, now executing...');
			//       const result = fn();
			//       console.log('Function executed, result:', result);
			//       return result;
			//     } catch (error) {
			//       console.error('Browser error:', error);
			//       return { error: error.toString() };
			//     }
			//   })()`,
			//   args,
			// )) as any;

			// console.log(
			// 	"---->DomService buildDomTree this.jsCode:",
			// 	JSON.stringify(this.jsCode, null, 2),
			// );
			// console.log(
			// 	"---->DomService buildDomTree args:",
			// 	JSON.stringify(args, null, 2),
			// );
			// console.log("---->DomService buildDomTree this.page:", this.page);
			let evalPage: any;
			try {
				// console.log("---->DomService about to evaluate JavaScript code");
				// Use a simpler approach - pass the function as a string and execute it with parameters
				// Playwright requires wrapping multiple arguments in an object
				evalPage = (await (this.page as any).evaluate(
					({
						jsCodeString,
						evaluationArgs,
					}: { jsCodeString: string; evaluationArgs: any }) => {
						try {
							// Remove any trailing semicolon from the function code
							const cleanCode = jsCodeString.trim().replace(/;$/, "");
							// Create the function and call it immediately
							const buildDomTreeFn = eval(`(${cleanCode})`);
							const result = buildDomTreeFn(evaluationArgs);
							return result;
						} catch (error) {
							console.error("Error in browser evaluate:", error);
							return { error: (error as any).toString() };
						}
					},
					{ jsCodeString: this.jsCode, evaluationArgs: args },
				)) as any;
				// console.log(
				// 	"---->DomService JavaScript evaluation completed, result type:",
				// 	typeof evalPage,
				// );
				// console.log(
				// 	"---->DomService JavaScript evaluation result keys:",
				// 	evalPage ? Object.keys(evalPage) : "null/undefined",
				// );
			} catch (e: any) {
				this.logger.error("Error evaluating JavaScript: %s", e);
				throw e;
			}

			// NOTE: We execute JS code in the browser to extract important DOM information.
			//       The returned hash map contains information about the DOM tree and the
			//       relationship between the DOM elements.

			// Check if evalPage is valid before proceeding
			if (!evalPage) {
				this.logger.error("JavaScript evaluation returned undefined or null");
				throw new Error("JavaScript evaluation failed: returned undefined");
			}

			// Only log performance metrics in debug mode
			if (debugMode && "perfMetrics" in evalPage) {
				const perf = evalPage.perfMetrics;

				// Get key metrics for summary
				const totalNodes = perf?.nodeMetrics?.totalNodes || 0;

				// Count interactive elements from the DOM map
				let interactiveCount = 0;
				if ("map" in evalPage) {
					for (const nodeData of Object.values(evalPage.map)) {
						if (
							typeof nodeData === "object" &&
							nodeData &&
							"isInteractive" in nodeData &&
							nodeData.isInteractive
						) {
							interactiveCount++;
						}
					}
				}

				// Create concise summary
				const urlShort =
					this.page.url().length > 50
						? this.page.url().substring(0, 50) + "..."
						: this.page.url();
				this.logger.debug(
					`🔎 Ran buildDOMTree.js interactive element detection on: ${urlShort} interactive=${interactiveCount}/${totalNodes}`, // processed_nodes,
				);
			}

			return await this.constructDomTree(evalPage);
		} catch (e: any) {
			this.logger.error(`Error evaluating JavaScript: ${e}`);
			this.logger.error(`Error stack: ${e.stack}`);
			throw e;
		}
	}

	@timeExecution("--constructDomTree(domService)")
	private async constructDomTree(
		evalPage: any,
	): Promise<[DOMElementNode, SelectorMap]> {
		const jsNodeMap = evalPage.map;
		const jsRootId = evalPage["rootId"];

		const selectorMap: SelectorMap = {};
		const nodeMap: Record<string, DOMBaseNode> = {};

		for (const [id, nodeData] of Object.entries(jsNodeMap)) {
			try {
				const result = this.parseNode(nodeData as any);
				if (!Array.isArray(result) || result.length !== 2) {
					this.logger.warn(
						`Invalid result from parseNode for node ${id}: ${result}`,
					);
					continue;
				}
				const [node, childrenIds] = result;
				if (!node) {
					continue;
				}

				nodeMap[id] = node;

				if (
					node instanceof DOMElementNode &&
					typeof node.highlightIndex === "number"
				) {
					selectorMap[node.highlightIndex] = node;
				}

				// NOTE: We know that we are building the tree bottom up
				//       and all children are already processed.
				if (node instanceof DOMElementNode) {
					for (const childId of childrenIds) {
						if (!(childId in nodeMap)) {
							continue;
						}

						const childNode = nodeMap[childId.toString()];
						if (!childNode) {
							continue;
						}

						childNode.parent = node;
						node.children.push(childNode);
					}
				}
			} catch (e: any) {
				this.logger.error(`Error processing node ${id}: ${e}`);
				this.logger.error(
					`Error stack while processing node ${id}: ${e.stack}`,
				);
				continue;
			}
		}

		const htmlToDict = nodeMap[jsRootId.toString()];

		// Clean up references
		delete (evalPage as any).map;
		delete (evalPage as any).rootId;

		if (!htmlToDict || !(htmlToDict instanceof DOMElementNode)) {
			throw new Error("Failed to parse HTML to dictionary");
		}

		return [htmlToDict, selectorMap];
	}

	private parseNode(nodeData: any): [DOMBaseNode | null, number[]] {
		if (!nodeData) {
			return [null, []];
		}

		// Process text nodes immediately
		if (nodeData.type === "TEXT_NODE") {
			const textNode = new DOMTextNode(nodeData.isVisible, null, nodeData.text);
			return [textNode, []];
		}

		try {
			// Process coordinates if they exist for element nodes
			let viewportInfo: ViewportInfo | undefined = undefined;
			let viewportCoordinates = null;
			let pageCoordinates = null;

			if ("viewport" in nodeData && nodeData.viewport) {
				const viewport = nodeData.viewport;
				viewportInfo = {
					scrollX: viewport.scrollX || 0,
					scrollY: viewport.scrollY || 0,
					width: viewport.width || 0,
					height: viewport.height || 0,
				};
			}

			if ("viewportCoordinates" in nodeData && nodeData.viewportCoordinates) {
				viewportCoordinates = nodeData.viewportCoordinates;
			}

			if ("pageCoordinates" in nodeData && nodeData.pageCoordinates) {
				pageCoordinates = nodeData.pageCoordinates;
			}

			const elementNode = new DOMElementNode(
				nodeData.isVisible || false,
				null,
				nodeData.tagName,
				nodeData.xpath,
				nodeData.attributes || {},
				[],
				nodeData.isInteractive || false,
				nodeData.isTopElement || false,
				nodeData.isInViewport || false,
				nodeData.shadowRoot || false,
				nodeData.highlightIndex,
				viewportCoordinates,
				pageCoordinates,
				viewportInfo,
			);

			if (!(elementNode instanceof DOMBaseNode)) {
				this.logger.warn(
					`Invalid node created for data: ${JSON.stringify(nodeData)}`,
				);
				return [null, []];
			}

			const childrenIds = nodeData.children || [];
			return [elementNode, childrenIds];
		} catch (e: any) {
			this.logger.error(`Error parsing node: ${e}`);
			this.logger.error(`Error parsing node stack: ${e.stack}`);
			return [null, []];
		}
	}
}
