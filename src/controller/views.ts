import bnLogger from "../logging_config";

// Setup logger
const logger = bnLogger.child({
	module: "browser_node/controller/views",
});
// DoneAction
export class DoneAction {
	text: string;
	success: boolean;

	constructor(text: string, success: boolean) {
		this.text = text;
		this.success = success;
	}
}
// SearchGoogleAction
export class SearchGoogleAction {
	query: string;

	constructor(query: string) {
		this.query = query;
	}
}

// GoToUrlAction
export class GoToUrlAction {
	url: string;

	constructor(url: string) {
		this.url = url;
	}
}
// GoBackAction empty

// WaitAction
export class WaitAction {
	seconds: number;

	constructor(seconds: number) {
		this.seconds = seconds;
	}
}
// ClickElementAction
export class ClickElementAction {
	index: number;
	xpath: string | undefined;

	constructor(index: number, xpath?: string) {
		this.index = index;
		this.xpath = xpath;
	}
}

// InputTextAction
export class InputTextAction {
	index: number;
	text: string;
	xpath: string | undefined;

	constructor(index: number, text: string, xpath?: string) {
		this.index = index;
		this.text = text;
		this.xpath = xpath;
	}
}
// SavePdfAction empty

// SwitchTabAction
export class SwitchTabAction {
	pageId: number;

	constructor(pageId: number) {
		this.pageId = pageId;
	}
}

// OpenTabAction
export class OpenTabAction {
	url: string;

	constructor(url: string) {
		this.url = url;
	}
}
// extractContentAction
export class ExtractContentAction {
	goal: string;

	constructor(goal: string) {
		this.goal = goal;
	}
}
// ScrollAction
export class ScrollAction {
	amount: number | undefined;

	constructor(amount?: number) {
		this.amount = amount;
	}
}

// SendKeysAction
export class SendKeysAction {
	keys: string;

	constructor(keys: string) {
		this.keys = keys;
	}
}

// scrollToText
export class ScrollToTextAction {
	text: string;

	constructor(text: string) {
		this.text = text;
	}
}

// GetDropdownOptions
export class GetDropdownOptionsAction {
	index: number;

	constructor(index: number) {
		this.index = index;
	}
}

// SelectDropdownOption
export class SelectDropdownOptionAction {
	index: number;
	text: string;

	constructor(index: number, text: string) {
		this.index = index;
		this.text = text;
	}
}

// ExtractPageContentAction
export class ExtractPageContentAction {
	value: string;

	constructor(value: string) {
		this.value = value;
	}
}

// NoParamsAction
export class NoParamsAction {
	constructor() {}
}

// ActionTypes
// export  ActionTypes =
// 	| SearchGoogleAction
// 	| GoToUrlAction
// 	| ClickElementAction
// 	| InputTextAction
// 	| DoneAction
// 	| SwitchTabAction
// 	| OpenTabAction
// 	| ScrollAction
// 	| SendKeysAction
// 	| ExtractPageContentAction
// 	| NoParamsAction;
