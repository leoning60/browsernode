import winston from "winston";
import type { DOMHistoryElement } from "../dom/history_tree_processor/view";
import type {
	DOMElementNode,
	DOMState,
	DOMTextNode,
	SelectorMap,
} from "../dom/views";
import bnLogger from "../logging_config";

const logger = bnLogger.child({
	module: "browser_node/browser/views",
});

export class TabInfo {
	// Represents information about a browser tab
	constructor(
		public pageId: number,
		public url: string,
		public title: string,
	) {}

	toDict(): Record<string, any> {
		return {
			pageId: this.pageId,
			url: this.url,
			title: this.title,
		};
	}
}

export class BrowserState implements DOMState {
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
		data["tabs"] = this.tabs.map((tab) => tab.toDict());
		data["screenshot"] = this.screenshot;
		data["interactedElement"] = this.interactedElement.map((el) =>
			el ? el.toDict() : null,
		);
		data["url"] = this.url;
		data["title"] = this.title;
		return data;
	}
}

export class BrowserError extends Error {
	// Base class for all browser errors
	constructor(message: string) {
		super(message);
	}
}

export class URLNotAllowedError extends BrowserError {
	// Error raised when a URL is not allowed
	constructor(message: string) {
		super(message);
	}
}
