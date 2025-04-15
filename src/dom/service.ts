import fs from "fs";
import path from "path";
import type { Page } from "playwright";
import { DOMBaseNode, DOMElementNode, DOMState, DOMTextNode } from "./views";
import type { SelectorMap } from "./views";

import bnLogger from "../logging_config";
import { timeExecution } from "../utils";
import type { ViewportInfo } from "./history_tree_processor/view";
const logger = bnLogger.child({
	module: "browser_node/dom/service",
});

// interface EvalPageResult {
// 	map: Record<string, unknown>;
// 	rootId: number;
// 	perfMetrics?: Record<string, unknown>;
// }

export class DomService {
	private page: Page;
	private xpathCache: Record<string, any> = {};
	private jsCode: string;

	constructor(page: Page) {
		this.page = page;
		this.xpathCache = {};

		this.jsCode = fs.readFileSync(
			path.join(__dirname, "..", "dom", "buildDomTree.js"),
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

	@timeExecution("--buildDomTree(domService)")
	private async buildDomTree(
		highlightElements: boolean,
		focusElement: number,
		viewportExpansion: number,
	): Promise<[DOMElementNode, SelectorMap]> {
		if ((await this.page.evaluate("1+1")) !== 2) {
			throw new Error("The page cannot evaluate javascript code properly");
		}

		// NOTE: We execute JS code in the browser to extract important DOM information.
		//       The returned hash map contains information about the DOM tree and the
		//       relationship between the DOM elements.
		const debugMode = logger.level === "debug";
		const args = {
			doHighlightElements: highlightElements,
			focusHighlightIndex: focusElement,
			viewportExpansion: viewportExpansion,
			debugMode: debugMode,
		};

		try {
			const evalPage = (await this.page.evaluate(
				`(function() {
					try {
						console.log('Starting evaluation in browser...');
						const fn = ${this.jsCode};
						console.log('Function defined, now executing...');
						const result = fn();
						console.log('Function executed, result:', result);
						return result;
					} catch (error) {
						console.error('Browser error:', error);
						return { error: error.toString() };
					}
				})()`,
				args,
			)) as any;
			console.log("---evalPage---:", evalPage);

			// Only log performance metrics in debug mode
			if (debugMode && "perfMetrics" in evalPage) {
				logger.debug(
					`DOM Tree Building Performance Metrics:\n${JSON.stringify(evalPage.perfMetrics, null, 2)}`,
				);
			}

			return await this.constructDomTree(evalPage);
		} catch (e: any) {
			logger.error(`Error evaluating JavaScript: ${e}`);
			logger.error(`Error stack: ${e.stack}`);
			throw e;
		}
	}

	@timeExecution("--constructDomTree(domService)")
	private async constructDomTree(
		evalPage: any,
	): Promise<[DOMElementNode, SelectorMap]> {
		console.log(
			"constructDomTree - Starting with evalPage:",
			JSON.stringify(evalPage, null, 2),
		);
		const jsNodeMap = evalPage.map;
		console.log(
			"constructDomTree - jsNodeMap:",
			JSON.stringify(jsNodeMap, null, 2),
		);
		const jsRootId = evalPage["rootId"];
		console.log("constructDomTree - jsRootId:", jsRootId);

		const selectorMap: SelectorMap = {};
		const nodeMap: Record<string, DOMBaseNode> = {};

		for (const [id, nodeData] of Object.entries(jsNodeMap)) {
			console.log(
				`constructDomTree - Processing node ${id}:`,
				JSON.stringify(nodeData, null, 2),
			);
			try {
				const result = this.parseNode(nodeData as any);
				console.log(
					`constructDomTree - parseNode result for node ${id}:`,
					result,
				);
				if (!Array.isArray(result) || result.length !== 2) {
					logger.warn(
						`Invalid result from parseNode for node ${id}: ${result}`,
					);
					continue;
				}
				const [node, childrenIds] = result;
				if (!node) {
					console.log(`constructDomTree - Node ${id} is null, skipping`);
					continue;
				}

				nodeMap[id] = node;
				console.log(`constructDomTree - Added node ${id} to nodeMap`);

				if (
					node instanceof DOMElementNode &&
					typeof node.highlightIndex === "number"
				) {
					selectorMap[node.highlightIndex] = node;
					console.log(
						`constructDomTree - Added node to selectorMap with index ${node.highlightIndex}`,
					);
				}

				// NOTE: We know that we are building the tree bottom up
				//       and all children are already processed.
				if (node instanceof DOMElementNode) {
					console.log(
						`constructDomTree - Processing children for node ${id}, children:`,
						childrenIds,
					);
					for (const childId of childrenIds) {
						if (!(childId in nodeMap)) {
							console.log(
								`constructDomTree - Child ${childId} not in nodeMap, skipping`,
							);
							continue;
						}

						const childNode = nodeMap[childId.toString()];
						if (!childNode) {
							console.log(
								`constructDomTree - Child node ${childId} is null, skipping`,
							);
							continue;
						}

						childNode.parent = node;
						node.children.push(childNode);
						console.log(
							`constructDomTree - Added child ${childId} to node ${id}`,
						);
					}
				}
			} catch (e: any) {
				logger.error(`Error processing node ${id}: ${e}`);
				logger.error(`Error stack while processing node ${id}: ${e.stack}`);
				continue;
			}
		}

		const htmlToDict = nodeMap[jsRootId.toString()];
		console.log(
			`constructDomTree - Retrieved root node with ID ${jsRootId}:`,
			htmlToDict,
		);

		if (!htmlToDict || !(htmlToDict instanceof DOMElementNode)) {
			console.log(
				`constructDomTree - Failed to find root node. nodeMap:`,
				Object.keys(nodeMap),
			);
			throw new Error("Failed to parse HTML to dictionary");
		}

		return [htmlToDict, selectorMap];
	}

	private parseNode(nodeData: any): [DOMBaseNode | null, number[]] {
		console.log(
			"parseNode - Starting with nodeData:",
			JSON.stringify(nodeData, null, 2),
		);
		if (!nodeData) {
			console.log(
				"parseNode - nodeData is null or undefined, returning [null, []]",
			);
			return [null, []];
		}

		// Process text nodes immediately
		if (nodeData.type === "TEXT_NODE") {
			console.log("parseNode - Processing TEXT_NODE");
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
				console.log("parseNode - Set viewportInfo:", viewportInfo);
			}

			if ("viewportCoordinates" in nodeData && nodeData.viewportCoordinates) {
				viewportCoordinates = nodeData.viewportCoordinates;
				console.log(
					"parseNode - Set viewportCoordinates:",
					viewportCoordinates,
				);
			}

			if ("pageCoordinates" in nodeData && nodeData.pageCoordinates) {
				pageCoordinates = nodeData.pageCoordinates;
				console.log("parseNode - Set pageCoordinates:", pageCoordinates);
			}

			console.log("parseNode - Creating DOMElementNode with parameters:", {
				isVisible: nodeData.isVisible || false,
				tagName: nodeData.tagName,
				xpath: nodeData.xpath,
				attributes: nodeData.attributes || {},
				isInteractive: nodeData.isInteractive || false,
				isTopElement: nodeData.isTopElement || false,
				isInViewport: nodeData.isInViewport || false,
				shadowRoot: nodeData.shadowRoot || false,
				highlightIndex: nodeData.highlightIndex,
			});

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
				console.log(
					"parseNode - Created node is not an instance of DOMBaseNode:",
					elementNode,
				);
				logger.warn(
					`Invalid node created for data: ${JSON.stringify(nodeData)}`,
				);
				return [null, []];
			}
			const childrenIds = nodeData.children || [];
			console.log(
				"parseNode - Successfully created element node, returning with children:",
				childrenIds,
			);

			return [elementNode, childrenIds];
		} catch (e: any) {
			console.log("parseNode - Error occurred:", e, "Stack:", e.stack);
			logger.error(`Error parsing node: ${e}`);
			logger.error(`Error parsing node stack: ${e.stack}`);
			return [null, []];
		}
	}
}
