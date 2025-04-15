import bnLogger from "../logging_config";
import { timeExecution } from "../utils";
import { HistoryTreeProcessor } from "./history_tree_processor/service";
import type {
	CoordinateSet,
	DOMHistoryElement,
	HashedDomElement,
	ViewportInfo,
} from "./history_tree_processor/view";

const logger = bnLogger.child({
	module: "browser_node/dom/views",
});

// Define the interface for DOMBaseNode
class DOMBaseNode {
	constructor(
		public isVisible: boolean,
		// Optional parent property using TS optional chaining
		// Forward reference to DOMElementNode using string literal type
		public parent?: DOMElementNode | null,
	) {}
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
			if (
				current.highlightIndex !== null &&
				current.highlightIndex !== undefined
			) {
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
}

class DOMElementNode extends DOMBaseNode {
	// xpath: the xpath of the element from the last root node (shadow root or iframe OR document if no shadow root or iframe).
	// To properly reference the element we need to recursively switch the root node until we find the element (work you way up the tree with `.parent`)
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
	) {
		super(isVisible, parent);
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

	// This could be implemented with a getter and private cache variable
	// TODO: implement this
	get hash(): HashedDomElement {
		return HistoryTreeProcessor._hashDomElement(this);
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
		const formattedText: string[] = [];

		const processNode = (node: DOMBaseNode, depth: number): void => {
			if (node instanceof DOMElementNode) {
				if (node.highlightIndex !== null) {
					let attributesStr = "";
					const text = node.getAllTextTillNextClickableElement();
					if (includeAttributes) {
						const attributes = Object.entries(node.attributes)
							.filter(
								([key, value]) =>
									includeAttributes.includes(key) && value !== node.tagName,
							)
							.map(([_, value]) => String(value));
						if (attributes.includes(text)) {
							attributes.splice(attributes.indexOf(text), 1);
						}
						attributesStr = attributes.join(";");
					}
					let line = `[${node.highlightIndex}]<${node.tagName} `;
					if (attributesStr) line += attributesStr;
					if (text) line += attributesStr ? `>${text}` : `${text}`;
					line += "/>";
					formattedText.push(line);
				}

				for (const child of node.children) {
					processNode(child, depth + 1);
				}
			} else if (node instanceof DOMTextNode) {
				if (!node.hasParentWithHighlightIndex() && node.isVisible) {
					formattedText.push(node.text);
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

export { DOMBaseNode, DOMState, DOMElementNode, DOMTextNode };
export type { SelectorMap };
