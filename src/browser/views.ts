import { Logger } from "winston";
import { modelDump } from "../bn_utils";
import type { DOMHistoryElement } from "../dom/history_tree_processor/view";
import type {
	DOMElementNode,
	DOMState,
	DOMTextNode,
	SelectorMap,
} from "../dom/views";
import bnLogger from "../logging_config";

const logger: Logger = bnLogger.child({
	module: "browsernode/browser/views",
});

/**
 * Represents information about a browser tab
 */
export class TabInfo {
	constructor(
		public pageId: number,
		public url: string,
		public title: string,
		public parentPageId: number | null, // parent page that contains this popup or cross-origin iframe
	) {}
}

/**
 * The summary of the browser's current state designed for an LLM to process
 */
export class BrowserStateSummary implements DOMState {
	// provided by DOMState:
	// elementTree: DOMElementNode
	// selectorMap: SelectorMap
	constructor(
		public elementTree: DOMElementNode,
		public selectorMap: SelectorMap,
		public url: string,
		public title: string,
		public tabs: TabInfo[],
		public screenshot: string | null,
		public pixelsAbove: number,
		public pixelsBelow: number,
		public browserErrors: string[],
	) {}
}

/**
 * The summary of the browser's state at a past point in time to usse in LLM message history
 */
export class BrowserStateHistory {
	constructor(
		public url: string,
		public title: string,
		public tabs: TabInfo[],
		public interactedElement: (DOMHistoryElement | null)[],
		public screenshot: string | null,
	) {}

	toDict(): Record<string, any> {
		const data: Record<string, any> = {};
		data["tabs"] = this.tabs.map((tab) => modelDump(tab));
		data["screenshot"] = this.screenshot;
		data["interactedElement"] = this.interactedElement.map((el) =>
			el ? el.toDict() : null,
		);
		data["url"] = this.url;
		data["title"] = this.title;
		return data;
	}
}

/**
 * Base class for all browser errors
 */
export class BrowserError extends Error {
	constructor(message: string) {
		super(message);
	}
}

/**
 * Error raised when a URL is not allowed
 */
export class URLNotAllowedError extends BrowserError {
	constructor(message: string) {
		super(message);
	}
}
