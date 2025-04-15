// For hashing (replacing hashlib)
import { createHash } from "crypto"; // Node.js crypto module
// If you're in a browser environment, you might need a different crypto library like:
// import { sha256 } from 'js-sha256';

import winston from "winston";
import bnLogger from "../../logging_config";
import { DOMElementNode } from "../views";
import type { CoordinateSet, HashedDomElement, ViewportInfo } from "./view";
import { DOMHistoryElement } from "./view";

const logger = bnLogger.child({
	module: "browser_node/dom/history_tree_processor/service",
});

class BrowserContext {
	// Stub - actual implementation would be needed
	static _enhancedCssSelectorForElement(element: DOMElementNode): string {
		return ""; // Placeholder
	}
}

class HistoryTreeProcessor {
	/**
	 * Operations on the DOM elements
	 *
	 * @dev be careful - text nodes can change even if elements stay the same
	 */

	static convertDomElementToHistoryElement(
		domElement: DOMElementNode,
	): DOMHistoryElement {
		const parentBranchPath =
			HistoryTreeProcessor._getParentBranchPath(domElement);
		const cssSelector =
			BrowserContext._enhancedCssSelectorForElement(domElement);

		return new DOMHistoryElement(
			domElement.tagName,
			domElement.xpath,
			domElement.highlightIndex,
			parentBranchPath,
			domElement.attributes,
			domElement.shadowRoot,
			cssSelector,
			domElement.pageCoordinates,
			domElement.viewportCoordinates,
			domElement.viewportInfo,
		);
	}

	static findHistoryElementInTree(
		domHistoryElement: DOMHistoryElement,
		tree: DOMElementNode,
	): DOMElementNode | null {
		const hashedDomHistoryElement =
			HistoryTreeProcessor._hashDomHistoryElement(domHistoryElement);

		const processNode = (node: DOMElementNode): DOMElementNode | null => {
			if (node.highlightIndex !== null) {
				const hashedNode = HistoryTreeProcessor._hashDomElement(node);
				if (
					JSON.stringify(hashedNode) === JSON.stringify(hashedDomHistoryElement)
				) {
					return node;
				}
			}
			for (const child of node.children) {
				if (child instanceof DOMElementNode) {
					const result = processNode(child);
					if (result !== null) return result;
				}
			}
			return null;
		};

		return processNode(tree);
	}

	static compareHistoryElementAndDomElement(
		domHistoryElement: DOMHistoryElement,
		domElement: DOMElementNode,
	): boolean {
		const hashedDomHistoryElement =
			HistoryTreeProcessor._hashDomHistoryElement(domHistoryElement);
		const hashedDomElement = HistoryTreeProcessor._hashDomElement(domElement);
		return (
			JSON.stringify(hashedDomHistoryElement) ===
			JSON.stringify(hashedDomElement)
		);
	}

	static _hashDomHistoryElement(
		domHistoryElement: DOMHistoryElement,
	): HashedDomElement {
		const branchPathHash = HistoryTreeProcessor._parentBranchPathHash(
			domHistoryElement.entireParentBranchPath,
		);
		const attributesHash = HistoryTreeProcessor._attributesHash(
			domHistoryElement.attributes,
		);
		const xpathHash = HistoryTreeProcessor._xpathHash(domHistoryElement.xpath);

		return { branchPathHash, attributesHash, xpathHash };
	}

	static _hashDomElement(domElement: DOMElementNode): HashedDomElement {
		const parentBranchPath =
			HistoryTreeProcessor._getParentBranchPath(domElement);
		const branchPathHash =
			HistoryTreeProcessor._parentBranchPathHash(parentBranchPath);
		const attributesHash = HistoryTreeProcessor._attributesHash(
			domElement.attributes,
		);
		const xpathHash = HistoryTreeProcessor._xpathHash(domElement.xpath);

		return { branchPathHash, attributesHash, xpathHash };
	}

	static _getParentBranchPath(domElement: DOMElementNode): string[] {
		const parents: DOMElementNode[] = [];
		let currentElement: DOMElementNode | null = domElement;

		while (currentElement?.parent !== null) {
			parents.push(currentElement);
			currentElement = currentElement.parent;
		}

		parents.reverse();
		return parents.map((parent) => parent.tagName);
	}

	static _parentBranchPathHash(parentBranchPath: string[]): string {
		const parentBranchPathString = parentBranchPath.join("/");
		return createHash("sha256").update(parentBranchPathString).digest("hex");
	}

	static _attributesHash(attributes: { [key: string]: string }): string {
		const attributesString = Object.entries(attributes)
			.map(([key, value]) => `${key}=${value}`)
			.join("");
		return createHash("sha256").update(attributesString).digest("hex");
	}

	static _xpathHash(xpath: string): string {
		return createHash("sha256").update(xpath).digest("hex");
	}

	static _textHash(domElement: DOMElementNode): string {
		const textString = domElement.getAllTextTillNextClickableElement();
		return createHash("sha256").update(textString).digest("hex");
	}
}

export { HistoryTreeProcessor };
