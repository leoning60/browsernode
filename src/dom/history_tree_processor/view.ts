import { Logger } from "winston";
import bnLogger from "../../logging_config";

// Setup logger
const logger: Logger = bnLogger.child({
	module: "browser_node/dom/history_tree_processor/view",
});

interface HashedDomElement {
	/**
	 * Hash of the dom element to be used as a unique identifier
	 */
	branchPathHash: string;
	attributesHash: string;
	xpathHash: string;
	// text_hash: string;
}

// Interface for Coordinates
interface Coordinates {
	x: number;
	y: number;
}

// Interface for CoordinateSet
interface CoordinateSet {
	topLeft: Coordinates;
	topRight: Coordinates;
	bottomLeft: Coordinates;
	bottomRight: Coordinates;
	center: Coordinates;
	width: number;
	height: number;
}

// Interface for ViewportInfo
interface ViewportInfo {
	scrollX: number;
	scrollY: number;
	width: number;
	height: number;
}

class DOMHistoryElement {
	constructor(
		public tagName: string,
		public xpath: string,
		public highlightIndex: number | null,
		public entireParentBranchPath: string[],
		public attributes: { [key: string]: string },
		public shadowRoot: boolean = false,
		public cssSelector: string | null = null,
		public pageCoordinates: CoordinateSet | null = null,
		public viewportCoordinates: CoordinateSet | null = null,
		public viewportInfo: ViewportInfo | null = null,
	) {}

	toDict(): { [key: string]: any } {
		return {
			tagName: this.tagName,
			xpath: this.xpath,
			highlightIndex: this.highlightIndex,
			entireParentBranchPath: this.entireParentBranchPath,
			attributes: this.attributes,
			shadowRoot: this.shadowRoot,
			cssSelector: this.cssSelector,
			pageCoordinates: this.pageCoordinates
				? { ...this.pageCoordinates }
				: null,
			viewportCoordinates: this.viewportCoordinates
				? { ...this.viewportCoordinates }
				: null,
			viewportInfo: this.viewportInfo ? { ...this.viewportInfo } : null,
		};
	}
}

export type { HashedDomElement, Coordinates, CoordinateSet, ViewportInfo };
export { DOMHistoryElement };
