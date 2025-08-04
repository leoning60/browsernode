import { Logger } from "winston";
import bnLogger from "../logging_config";
import { timeExecution } from "../utils";
import { HistoryTreeProcessor } from "./history_tree_processor/service";
import type {
	CoordinateSet,
	DOMHistoryElement,
	HashedDomElement,
	ViewportInfo,
} from "./history_tree_processor/view";
import { capTextLength } from "./util";

const logger: Logger = bnLogger.child({
	module: "browsernode/dom/views",
});

// Define the interface for DOMBaseNode
abstract class DOMBaseNode {
	constructor(
		public isVisible: boolean,
		public parent?: DOMElementNode | null,
	) {}

	abstract __json__(): any;
}

class DOMTextNode extends DOMBaseNode {
	constructor(
		public isVisible: boolean,
		public parent: DOMElementNode | null,
		public text: string,
		public type: string = "TEXT_NODE",
	) {
		super(isVisible, parent);
	}

	hasParentWithHighlightIndex(): boolean {
		let current = this.parent;
		while (current !== null) {
			// stop if the element has a highlight index (will be handled separately)
			if (current.highlightIndex !== null) {
				return true;
			}
			if (current.parent === undefined) {
				return false;
			}
			current = current.parent;
		}
		return false;
	}

	isParentInViewport(): boolean {
		if (this.parent === null) {
			return false;
		}
		return this.parent.isInViewport;
	}

	isParentTopElement(): boolean {
		if (this.parent === null) {
			return false;
		}
		return this.parent.isTopElement;
	}

	__json__(): any {
		return {
			text: this.text,
			type: this.type,
		};
	}
}

const DEFAULT_INCLUDE_ATTRIBUTES = [
	"title",
	"type",
	"checked",
	"name",
	"role",
	"value",
	"placeholder",
	"data-date-format",
	"alt",
	"aria-label",
	"aria-expanded",
	"data-state",
	"aria-checked",
];

class DOMElementNode extends DOMBaseNode {
	// xpath: the xpath of the element from the last root node (shadow root or iframe OR document if no shadow root or iframe).
	// To properly reference the element we need to recursively switch the root node until we find the element (work you way up the tree with `.parent`)
	private _hash: HashedDomElement | null = null;

	constructor(
		public isVisible: boolean,
		public parent: DOMElementNode | null,
		public tagName: string,
		public xpath: string,
		public attributes: { [key: string]: string },
		public children: DOMBaseNode[],
		public isInteractive: boolean = false,
		public isTopElement: boolean = false,
		public isInViewport: boolean = false,
		public shadowRoot: boolean = false,
		public highlightIndex: number | null = null,
		public viewportCoordinates: CoordinateSet | null = null,
		public pageCoordinates: CoordinateSet | null = null,
		public viewportInfo: ViewportInfo | null = null,
		/**
		 * State injected by the browser context.
		 * The idea is that the clickable elements are sometimes persistent from the previous page -> tells the model which objects are new/how the state has changed
		 */
		public isNew: boolean | null = null,
	) {
		super(isVisible, parent);
	}

	__json__(): any {
		return {
			tagName: this.tagName,
			xpath: this.xpath,
			attributes: this.attributes,
			isVisible: this.isVisible,
			isInteractive: this.isInteractive,
			isTopElement: this.isTopElement,
			isInViewport: this.isInViewport,
			shadowRoot: this.shadowRoot,
			highlightIndex: this.highlightIndex,
			viewportCoordinates: this.viewportCoordinates,
			pageCoordinates: this.pageCoordinates,
			children: this.children.map((child) => child.__json__()),
		};
	}

	toString(): string {
		let tagStr = `<${this.tagName}`;

		// Add attributes
		for (const [key, value] of Object.entries(this.attributes)) {
			tagStr += ` ${key}="${value}"`;
		}
		tagStr += ">";

		// Add extra info
		const extras: string[] = [];
		if (this.isInteractive) extras.push("interactive");
		if (this.isTopElement) extras.push("top");
		if (this.shadowRoot) extras.push("shadow-root");
		if (this.highlightIndex !== null)
			extras.push(`highlight:${this.highlightIndex}`);
		if (this.isInViewport) extras.push("in-viewport");

		if (extras.length > 0) {
			tagStr += ` [${extras.join(", ")}]`;
		}

		return tagStr;
	}

	get hash(): HashedDomElement {
		if (this._hash === null) {
			this._hash = HistoryTreeProcessor._hashDomElement(this);
		}
		return this._hash;
	}

	getAllTextTillNextClickableElement(maxDepth: number = -1): string {
		const textParts: string[] = [];

		const collectText = (node: DOMBaseNode, currentDepth: number): void => {
			if (maxDepth !== -1 && currentDepth > maxDepth) return;

			if (
				node instanceof DOMElementNode &&
				node !== this &&
				node.highlightIndex !== null
			) {
				return;
			}

			if (node instanceof DOMTextNode) {
				textParts.push(node.text);
			} else if (node instanceof DOMElementNode) {
				for (const child of node.children) {
					collectText(child, currentDepth + 1);
				}
			}
		};

		collectText(this, 0);
		return textParts.join("\n").trim();
	}

	@timeExecution("--clickableElementsToString")
	clickableElementsToString(includeAttributes?: string[]): string {
		/**
		 * Convert the processed DOM content to HTML.
		 */
		const formattedText: string[] = [];

		if (!includeAttributes) {
			includeAttributes = DEFAULT_INCLUDE_ATTRIBUTES;
		}

		const processNode = (node: DOMBaseNode, depth: number): void => {
			let nextDepth = depth;
			const depthStr = "\t".repeat(depth);

			if (node instanceof DOMElementNode) {
				// Add element with highlightIndex
				if (node.highlightIndex !== null) {
					nextDepth += 1;

					const text = node.getAllTextTillNextClickableElement();
					let attributesHtmlStr: string | null = null;

					if (includeAttributes) {
						const attributesToInclude: { [key: string]: string } = {};

						// Filter attributes to include
						for (const [key, value] of Object.entries(node.attributes)) {
							if (includeAttributes.includes(key) && value.trim() !== "") {
								attributesToInclude[key] = value.trim();
							}
						}

						// If value of any of the attributes is the same as ANY other value attribute only include the one that appears first in includeAttributes
						// WARNING: heavy vibes, but it seems good enough for saving tokens (it kicks in hard when it's long text)

						// Pre-compute ordered keys that exist in both lists (faster than repeated lookups)
						const orderedKeys = includeAttributes.filter(
							(key) => key in attributesToInclude,
						);

						if (orderedKeys.length > 1) {
							const keysToRemove = new Set<string>();
							const seenValues: { [value: string]: string } = {};

							for (const key of orderedKeys) {
								const value = attributesToInclude[key];
								if (value && value.length > 5) {
									// to not remove false, true, etc
									if (value in seenValues) {
										// This value was already seen with an earlier key, so remove this key
										keysToRemove.add(key);
									} else {
										// First time seeing this value, record it
										seenValues[value] = key;
									}
								}
							}

							// Remove duplicate keys
							for (const key of keysToRemove) {
								delete attributesToInclude[key];
							}
						}

						// Easy LLM optimizations
						// if tag == role attribute, don't include it
						if (node.tagName === attributesToInclude.role) {
							delete attributesToInclude.role;
						}

						// Remove attributes that duplicate the node's text content
						const attrsToRemoveIfTextMatches = [
							"aria-label",
							"placeholder",
							"title",
						];
						for (const attr of attrsToRemoveIfTextMatches) {
							if (
								attributesToInclude[attr] &&
								attributesToInclude[attr].trim().toLowerCase() ===
									text.trim().toLowerCase()
							) {
								delete attributesToInclude[attr];
							}
						}

						if (Object.keys(attributesToInclude).length > 0) {
							// Format as key1='value1' key2='value2'
							attributesHtmlStr = Object.entries(attributesToInclude)
								.map(([key, value]) => `${key}=${capTextLength(value, 15)}`)
								.join(" ");
						}
					}

					// Build the line
					const highlightIndicator = node.isNew
						? `*[${node.highlightIndex}]`
						: `[${node.highlightIndex}]`;
					let line = `${depthStr}${highlightIndicator}<${node.tagName}`;

					if (attributesHtmlStr) {
						line += ` ${attributesHtmlStr}`;
					}

					if (text) {
						// Add space before >text only if there were NO attributes added before
						const trimmedText = text.trim();
						if (!attributesHtmlStr) {
							line += " ";
						}
						line += `>${trimmedText}`;
					} else if (!attributesHtmlStr) {
						// Add space before /> only if neither attributes NOR text were added
						line += " ";
					}

					// makes sense to have if the website has lots of text -> so the LLM knows which things are part of the same clickable element and which are not
					line += " />"; // 1 token
					formattedText.push(line);
				}

				// Process children regardless
				for (const child of node.children) {
					processNode(child, nextDepth);
				}
			} else if (node instanceof DOMTextNode) {
				// Add text only if it doesn't have a highlighted parent
				if (node.hasParentWithHighlightIndex()) {
					return;
				}

				if (node.parent && node.parent.isVisible && node.parent.isTopElement) {
					formattedText.push(`${depthStr}${node.text}`);
				}
			}
		};

		processNode(this, 0);
		return formattedText.join("\n");
	}

	getFileUploadElement(checkSiblings: boolean = true): DOMElementNode | null {
		if (this.tagName === "input" && this.attributes["type"] === "file") {
			return this;
		}

		for (const child of this.children) {
			if (child instanceof DOMElementNode) {
				const result = child.getFileUploadElement(false);
				if (result) return result;
			}
		}

		if (checkSiblings && this.parent) {
			for (const sibling of this.parent.children) {
				if (sibling !== this && sibling instanceof DOMElementNode) {
					const result = sibling.getFileUploadElement(false);
					if (result) return result;
				}
			}
		}

		return null;
	}
}

// SelectorMap type
type SelectorMap = { [key: number]: DOMElementNode };

class DOMState {
	constructor(
		public elementTree: DOMElementNode,
		public selectorMap: SelectorMap,
	) {}
}

export {
	DOMBaseNode,
	DOMState,
	DOMElementNode,
	DOMTextNode,
	DEFAULT_INCLUDE_ATTRIBUTES,
};
export type { SelectorMap };
