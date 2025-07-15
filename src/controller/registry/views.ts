import { modelDumpExcludedUnset } from "../../bn_utils";
import type { BrowserSession } from "../../browser/session";
import type { Page } from "../../browser/types";
import type { FileSystem } from "../../filesystem/file_system";
import type { BaseChatModel } from "../../llm/base";
import bnLogger from "../../logging_config";
import { matchUrlWithDomainPattern } from "../../utils";

const logger = bnLogger.child({
	label: "browsernode/controller/registry/views",
});

/**
 * Model for a registered action
 */
class RegisteredAction {
	name: string;
	description: string;
	function: (...args: any[]) => any; // type Callable
	paramModel: Record<string, any> | undefined;

	// filters: provide specific domains or a function to determine whether the action should be available on the given page or not
	domains?: string[] | null; // e.g. ['*.google.com', 'www.bing.com', 'yahoo.*']
	pageFilter?: ((page: Page) => boolean) | null;

	constructor(params: {
		name: string;
		description: string;
		function: (...args: any[]) => any;
		paramModel?: Record<string, any>;
		domains?: string[] | null;
		pageFilter?: ((page: Page) => boolean) | null;
	}) {
		this.name = params.name;
		this.description = params.description;
		this.function = params.function;
		this.paramModel = params.paramModel;
		this.domains = params.domains;
		this.pageFilter = params.pageFilter;
	}

	/**
	 * Get a description of the action for the prompt
	 */
	promptDescription(): string {
		const skipKeys = ["title"];

		if (!this.paramModel) {
			return `${this.description}: \n{${this.name}: {}}`;
		}

		const transformedParams = Object.entries(this.paramModel).reduce(
			(acc, [k, v]) => {
				// Add null/undefined check for v before calling Object.entries
				if (v && typeof v === "object") {
					const filteredProps = Object.fromEntries(
						Object.entries(v).filter(([subK]) => !skipKeys.includes(subK)),
					);
					acc[k] = filteredProps;
				} else {
					// If v is not an object, just use it as is
					acc[k] = v;
				}
				return acc;
			},
			{} as Record<string, any>,
		);

		return `${this.description}: \n{${this.name}: ${JSON.stringify(transformedParams)}}`;
	}
}

/**
 * Base model for dynamically created action models
 */
class ActionModel {
	[key: string]: any;

	constructor(params: Record<string, any>) {
		Object.assign(this, params);
	}

	/**
	 * Get the index of the action
	 */
	getIndex(): number | null {
		// Get all parameter values
		const params = Object.values(modelDumpExcludedUnset(this, true));
		if (!params.length) {
			return null;
		}

		// Check each parameter for an index
		for (const param of params) {
			if (param && typeof param === "object" && "index" in param) {
				return param.index ?? null;
			}
		}
		return null;
	}

	/**
	 * Overwrite the index of the action
	 */
	setIndex(index: number): void {
		// Get the action name and params
		const actionData = modelDumpExcludedUnset(this, true);
		const actionName = Object.keys(actionData)[0] as keyof ActionModel;
		const actionParams = this[actionName];

		// Update the index directly on the model
		if (
			actionParams &&
			typeof actionParams === "object" &&
			"index" in actionParams
		) {
			actionParams.index = index;
		}
	}
}

/**
 * Model representing the action registry
 */
class ActionRegistry {
	actions: Map<string, RegisteredAction> = new Map();

	/**
	 * Match a list of domain glob patterns against a URL.
	 *
	 * @param domains A list of domain patterns that can include glob patterns (* wildcard)
	 * @param url The URL to match against
	 * @returns True if the URL's domain matches the pattern, False otherwise
	 */
	public static _matchDomains(
		domains: string[] | null | undefined,
		url: string,
	): boolean {
		if (domains === null || domains === undefined || !url) {
			return true;
		}

		// Use the centralized URL matching logic from utils
		for (const domainPattern of domains) {
			if (matchUrlWithDomainPattern(url, domainPattern)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Match a page filter against a page
	 */
	public static _matchPageFilter(
		pageFilter: ((page: Page) => boolean) | null | undefined,
		page: Page,
	): boolean {
		if (pageFilter === null || pageFilter === undefined) {
			return true;
		}
		return pageFilter(page);
	}

	/**
	 * Get a description of all actions for the prompt
	 *
	 * @param page If provided, filter actions by page using pageFilter and domains.
	 * @returns A string description of available actions.
	 *          - If page is null: return only actions with no pageFilter and no domains (for system prompt)
	 *          - If page is provided: return only filtered actions that match the current page (excluding unfiltered actions)
	 */
	getPromptDescription(page?: Page | null): string {
		if (page === null || page === undefined) {
			// For system prompt (no page provided), include only actions with no filters
			// Accept both null and undefined as "no filters"
			return Array.from(this.actions.values())
				.filter(
					(action) =>
						(action.pageFilter === null || action.pageFilter === undefined) &&
						(action.domains === null || action.domains === undefined),
				)
				.map((action) => action.promptDescription())
				.join("\n");
		}

		// only include filtered actions for the current page
		const filteredActions: RegisteredAction[] = [];
		for (const action of Array.from(this.actions.values())) {
			if (!(action.domains || action.pageFilter)) {
				// skip actions with no filters, they are already included in the system prompt
				continue;
			}

			const domainIsAllowed = ActionRegistry._matchDomains(
				action.domains,
				page.url(),
			);
			const pageIsAllowed = ActionRegistry._matchPageFilter(
				action.pageFilter,
				page,
			);

			if (domainIsAllowed && pageIsAllowed) {
				filteredActions.push(action);
			}
		}

		return filteredActions
			.map((action) => action.promptDescription())
			.join("\n");
	}
}

/**
 * Model defining all special parameters that can be injected into actions
 */
class SpecialActionParameters {
	// optional user-provided context object passed down from Agent(context=...)
	// e.g. can contain anything, external db connections, file handles, queues, runtime config objects, etc.
	// that you might want to be able to access quickly from within many of your actions
	// browsernode code doesn't use this at all, we just pass it down to your actions for convenience
	context?: any | null = null;

	// browsernode session object, can be used to create new tabs, navigate, access playwright objects, etc.
	browserSession?: BrowserSession | null = null;

	// legacy support for actions that ask for the old model names
	browser?: BrowserSession | null = null;
	browserContext?: BrowserSession | null = null; // extra confusing, this is actually not referring to a playwright BrowserContext,
	// but rather the name for Browsernode's own old BrowserContext object from <v0.2.0
	// should be deprecated then removed after v0.3.0 to avoid ambiguity
	// we can't change it too fast because many people's custom actions out in the wild expect this argument

	// actions can get the playwright Page, shortcut for page = await browserSession.getCurrentPage()
	page?: Page | null = null;

	// extra injected config if the action asks for these arg names
	pageExtractionLlm?: BaseChatModel | null = null;
	fileSystem?: FileSystem | null = null;
	availableFilePaths?: string[] | null = null;
	hasSensitiveData?: boolean = false;

	constructor(params: Partial<SpecialActionParameters> = {}) {
		Object.assign(this, params);
	}

	/**
	 * Get parameter names that require browserSession
	 */
	static getBrowserRequiringParams(): Set<string> {
		return new Set(["browserSession", "browser", "browserContext", "page"]);
	}
}

export {
	RegisteredAction,
	ActionModel,
	ActionRegistry,
	SpecialActionParameters,
};
