import { BrowserSession } from "../../browser/session";
import type { Page } from "../../browser/types";
import type { FileSystem } from "../../filesystem/file_system";
import type { BaseChatModel } from "../../llm/base";
import bnLogger from "../../logging_config";
import { ProductTelemetry } from "../../telemetry/service";
import { matchUrlWithDomainPattern } from "../../utils";
import { timeExecution } from "../../utils_old";
import {
	ActionModel,
	ActionRegistry,
	RegisteredAction,
	SpecialActionParameters,
} from "./views";

const logger = bnLogger.child({
	label: "browsernode/controller/registry/service",
});

/**
 * Service for registering and managing actions
 */
export class Registry<Context = any> {
	public registry: ActionRegistry;
	public telemetry: ProductTelemetry;
	public excludeActions: string[];

	constructor(excludeActions?: string[] | null) {
		this.registry = new ActionRegistry();
		this.telemetry = new ProductTelemetry();
		this.excludeActions = excludeActions || [];
	}

	/**
	 * Get the expected types for special parameters from SpecialActionParameters
	 */
	private getSpecialParamTypes(): Record<string, any> {
		// Manually define the expected types to avoid issues with Optional handling.
		// we should try to reduce this list to 0 if possible, give as few standardized objects to all the actions
		// but each driver should decide what is relevant to expose the action methods,
		// e.g. playwright page, 2fa code getters, sensitive_data wrappers, other context, etc.
		return {
			context: null, // Context is a generic, so we can't validate type
			browserSession: BrowserSession,
			browser: BrowserSession, // legacy name
			browserContext: BrowserSession, // legacy name
			page: Object, // Page type
			pageExtractionLlm: Object, // BaseChatModel type
			availableFilePaths: Array,
			hasSensitiveData: Boolean,
			fileSystem: Object, // FileSystem type
			sensitiveData: Object, // Record<string, string | Record<string, string>>
		};
	}

	/**
	 * Normalize action function to accept only kwargs.
	 *
	 * @returns
	 * - Normalized function that accepts (params: Record<string, any>, ...specialParams)
	 * - The param model to use for registration
	 */
	private normalizeActionFunctionSignature(
		func: Function,
		description: string,
		paramModel?: Record<string, any> | null,
	): [Function, Record<string, any>] {
		const specialParamTypes = this.getSpecialParamTypes();
		const specialParamNames = new Set(Object.keys(specialParamTypes));

		// Get function parameter names using reflection
		const funcStr = func.toString();
		const paramMatch = funcStr.match(/\(([^)]*)\)/);
		const paramStr = paramMatch?.[1] ?? "";
		const parameters = paramStr
			.split(",")
			.map((p) => p.trim().split("=")[0]!.trim().split(":")[0]!.trim())
			.filter((p) => p && p !== "") as string[];

		// Step 1: Validate no destructured parameters in original function signature
		// if it needs default values it must use a dedicated paramModel instead
		for (const param of parameters) {
			if (param.includes("{") || param.includes("}")) {
				throw new Error(
					`Action '${func.name}' has destructured parameter '${param}' which is not allowed. ` +
						"Actions must have explicit positional parameters only.",
				);
			}
		}

		// Step 2: Separate special and action parameters
		const actionParams: string[] = [];
		const specialParams: string[] = [];
		const paramModelProvided = paramModel !== null && paramModel !== undefined;

		for (let i = 0; i < parameters.length; i++) {
			const param = parameters[i]!;

			// Check if this is a Type 1 pattern (first param is paramModel)
			if (i === 0 && paramModelProvided && !specialParamNames.has(param)) {
				// This is Type 1 pattern - skip the params argument
				continue;
			}

			if (specialParamNames.has(param)) {
				specialParams.push(param);
			} else {
				actionParams.push(param);
			}
		}

		// Step 3: Create or validate param model
		let finalParamModel: Record<string, any>;
		if (!paramModelProvided) {
			// Type 2: Generate param model from action params
			if (actionParams.length > 0) {
				finalParamModel = {};
				for (const param of actionParams) {
					finalParamModel[param] = { type: "any" }; // Basic type definition
				}
			} else {
				// No action params, create empty model
				finalParamModel = {};
			}
		} else {
			finalParamModel = paramModel;
		}

		// Step 4: Create normalized wrapper function
		const normalizedWrapper = async (...args: any[]) => {
			const [params, ...kwargs] = args;
			const specialContext = kwargs[0] || {};

			// Validate no extra positional args beyond params and specialContext
			if (args.length > 2) {
				throw new TypeError(
					`${func.name}() accepts at most 2 arguments, got ${args.length}`,
				);
			}

			// Prepare arguments for original function
			const callArgs: any[] = [];

			// Handle Type 1 pattern (first arg is the param model)
			if (
				paramModelProvided &&
				parameters.length > 0 &&
				!specialParamNames.has(parameters[0]!)
			) {
				if (params === null || params === undefined) {
					throw new Error(`${func.name}() missing required 'params' argument`);
				}
				callArgs.push(params);
			}

			// Build call args by iterating through original function parameters in order
			const paramsDict = params || {};

			for (let i = 0; i < parameters.length; i++) {
				const param = parameters[i]!;

				// Skip first param for Type 1 pattern (it's the model itself)
				if (paramModelProvided && i === 0 && !specialParamNames.has(param)) {
					// Already handled above
					continue;
				} else if (specialParamNames.has(param)) {
					// This is a special parameter
					if (param in specialContext) {
						const value = specialContext[param];
						// Check if required special param is null
						if (value === null || value === undefined) {
							if (param === "browserSession") {
								throw new Error(
									`Action ${func.name} requires browserSession but none provided.`,
								);
							} else if (param === "pageExtractionLlm") {
								throw new Error(
									`Action ${func.name} requires pageExtractionLlm but none provided.`,
								);
							} else if (param === "fileSystem") {
								throw new Error(
									`Action ${func.name} requires fileSystem but none provided.`,
								);
							} else if (param === "page") {
								throw new Error(
									`Action ${func.name} requires page but none provided.`,
								);
							} else if (param === "availableFilePaths") {
								throw new Error(
									`Action ${func.name} requires availableFilePaths but none provided.`,
								);
							} else if (
								param === "sensitiveData" ||
								param === "hasSensitiveData" ||
								param === "context"
							) {
								// These parameters are optional and can be null/undefined
								// Allow them to be passed as null/undefined
							} else {
								throw new Error(
									`${func.name}() missing required special parameter '${param}'`,
								);
							}
						}
						callArgs.push(value);
					} else {
						// Special param not provided and no default
						if (param === "browserSession") {
							throw new Error(
								`Action ${func.name} requires browserSession but none provided.`,
							);
						} else if (param === "pageExtractionLlm") {
							throw new Error(
								`Action ${func.name} requires pageExtractionLlm but none provided.`,
							);
						} else if (param === "fileSystem") {
							throw new Error(
								`Action ${func.name} requires fileSystem but none provided.`,
							);
						} else if (param === "page") {
							throw new Error(
								`Action ${func.name} requires page but none provided.`,
							);
						} else if (param === "availableFilePaths") {
							throw new Error(
								`Action ${func.name} requires availableFilePaths but none provided.`,
							);
						} else {
							throw new Error(
								`${func.name}() missing required special parameter '${param}'`,
							);
						}
					}
				} else {
					// This is an action parameter
					if (param in paramsDict) {
						callArgs.push(paramsDict[param]);
					} else {
						throw new Error(
							`${func.name}() missing required parameter '${param}'`,
						);
					}
				}
			}

			// Call original function with positional args
			return await Promise.resolve(func.apply(null, callArgs));
		};

		return [normalizedWrapper, finalParamModel];
	}

	/**
	 * Creates a parameter model from function signature
	 */
	private createParamModel(func: Function): Record<string, any> {
		const specialParamNames = new Set(
			Object.keys(new SpecialActionParameters()),
		);

		// Get function parameter names using reflection
		const funcStr = func.toString();
		const paramMatch = funcStr.match(/\(([^)]*)\)/);
		const paramStr = paramMatch?.[1] ?? "";
		const parameters = paramStr
			.split(",")
			.map((p) => p.trim().split("=")[0]!.trim().split(":")[0]!.trim())
			.filter((p) => p && p !== "" && !specialParamNames.has(p)) as string[];

		// TODO: make the types here work
		const params: Record<string, any> = {};
		for (const param of parameters) {
			params[param] = { type: "any" }; // Basic type definition
		}
		return params;
	}

	/**
	 * Decorator for registering actions
	 */
	action(
		description: string,
		paramModel?: Record<string, any> | null,
		domains?: string[] | null,
		allowedDomains?: string[] | null,
		pageFilter?: ((page: Page) => boolean) | null,
	) {
		// Handle aliases: domains and allowedDomains are the same parameter
		if (
			allowedDomains !== null &&
			allowedDomains !== undefined &&
			domains !== null &&
			domains !== undefined
		) {
			throw new Error(
				"Cannot specify both 'domains' and 'allowedDomains' - they are aliases for the same parameter",
			);
		}

		const finalDomains =
			allowedDomains !== null && allowedDomains !== undefined
				? allowedDomains
				: domains;

		return (func: Function) => {
			// Skip registration if action is in excludeActions
			if (this.excludeActions.includes(func.name)) {
				return func;
			}

			// Normalize the function signature
			const [normalizedFunc, actualParamModel] =
				this.normalizeActionFunctionSignature(func, description, paramModel);

			const action = new RegisteredAction({
				name: func.name,
				description: description,
				function: normalizedFunc as (...args: any[]) => any,
				paramModel: actualParamModel,
				domains: finalDomains,
				pageFilter: pageFilter,
			});

			this.registry.actions.set(func.name, action);

			// Return the normalized function so it can be called with kwargs
			return normalizedFunc;
		};
	}

	/**
	 * Execute a registered action with simplified parameter handling
	 */
	@timeExecution("--execute_action")
	async executeAction(
		actionName: string,
		params: Record<string, any>,
		browserSession?: BrowserSession | null,
		pageExtractionLlm?: BaseChatModel | null,
		fileSystem?: FileSystem | null,
		sensitiveData?: Record<string, string | Record<string, string>> | null,
		availableFilePaths?: string[] | null,
		context?: Context | null,
	): Promise<any> {
		if (!this.registry.actions.has(actionName)) {
			throw new Error(`Action ${actionName} not found`);
		}

		const action = this.registry.actions.get(actionName)!;
		try {
			// Create the validated parameters
			let validatedParams: Record<string, any>;
			try {
				validatedParams = { ...params }; // Simple validation for now
			} catch (e) {
				throw new Error(
					`Invalid parameters ${JSON.stringify(params)} for action ${actionName}: ${e}`,
				);
			}

			if (sensitiveData) {
				// Get current URL if browserSession is provided
				let currentUrl: string | null = null;
				if (browserSession) {
					if (browserSession.agentCurrentPage) {
						currentUrl = await browserSession.agentCurrentPage.url();
					} else {
						const currentPage = await browserSession.getCurrentPage();
						currentUrl = currentPage ? await currentPage.url() : null;
					}
				}
				validatedParams = this.replaceSensitiveData(
					validatedParams,
					sensitiveData,
					currentUrl,
				);
			}

			// Build special context dict
			const specialContext: Record<string, any> = {
				context: context,
				browserSession: browserSession,
				browser: browserSession, // legacy support
				browserContext: browserSession, // legacy support
				pageExtractionLlm: pageExtractionLlm,
				availableFilePaths: availableFilePaths,
				hasSensitiveData: actionName === "inputText" && Boolean(sensitiveData),
				fileSystem: fileSystem,
				sensitiveData: sensitiveData,
			};

			// Handle async page parameter if needed
			if (browserSession) {
				// Check if function signature includes 'page' parameter
				const funcStr = action.function.toString();
				if (funcStr.includes("page")) {
					specialContext["page"] = await browserSession.getCurrentPage();
				}
			}

			// All functions are now normalized to accept kwargs only
			// Call with params and unpacked special context
			try {
				return await action.function(validatedParams, specialContext);
			} catch (e) {
				// Retry once if it's a page error
				logger.warn(
					`⚠️ Action ${actionName}() failed: ${e}, trying one more time...`,
				);
				if (browserSession) {
					specialContext["page"] = await browserSession.getCurrentPage();
				}
				try {
					return await action.function(validatedParams, specialContext);
				} catch (retryError) {
					throw new Error(
						`Action ${actionName}() failed: ${e} (page may have closed or navigated away mid-action)`,
					);
				}
			}
		} catch (e) {
			// Preserve Error messages from validation
			if (
				e instanceof Error &&
				(e.message.includes("requires browserSession but none provided") ||
					e.message.includes("requires pageExtractionLlm but none provided"))
			) {
				throw new Error(e.message);
			} else {
				throw new Error(`Error executing action ${actionName}: ${e}`);
			}
		}
	}

	/**
	 * Log when sensitive data is being used on a page
	 */
	private logSensitiveDataUsage(
		placeholdersUsed: Set<string>,
		currentUrl?: string | null,
	): void {
		if (placeholdersUsed.size > 0) {
			const urlInfo =
				currentUrl && currentUrl !== "about:blank" ? ` on ${currentUrl}` : "";
			logger.info(
				`🔒 Using sensitive data placeholders: ${Array.from(placeholdersUsed).sort().join(", ")}${urlInfo}`,
			);
		}
	}

	/**
	 * Replaces sensitive data placeholders in params with actual values.
	 *
	 * @param params The parameter object containing <secret>placeholder</secret> tags
	 * @param sensitiveData Dictionary of sensitive data, either in old format {key: value}
	 *                     or new format {domain_pattern: {key: value}}
	 * @param currentUrl Optional current URL for domain matching
	 * @returns The parameter object with placeholders replaced by actual values
	 */
	private replaceSensitiveData(
		params: Record<string, any>,
		sensitiveData: Record<string, string | Record<string, string>>,
		currentUrl?: string | null,
	): Record<string, any> {
		const secretPattern = /<secret>(.*?)<\/secret>/g;

		// Set to track all missing placeholders across the full object
		const allMissingPlaceholders = new Set<string>();
		// Set to track successfully replaced placeholders
		const replacedPlaceholders = new Set<string>();

		// Process sensitive data based on format and current URL
		const applicableSecrets: Record<string, string> = {};

		for (const [domainOrKey, content] of Object.entries(sensitiveData)) {
			if (typeof content === "object" && content !== null) {
				// New format: {domain_pattern: {key: value}}
				// Only include secrets for domains that match the current URL
				if (currentUrl && currentUrl !== "about:blank") {
					// it's a real url, check it using our custom allowedDomains scheme://*.example.com glob matching
					if (matchUrlWithDomainPattern(currentUrl, domainOrKey)) {
						Object.assign(applicableSecrets, content);
					}
				}
			} else {
				// Old format: {key: value}, expose to all domains (only allowed for legacy reasons)
				applicableSecrets[domainOrKey] = content as string;
			}
		}

		// Filter out empty values
		Object.keys(applicableSecrets).forEach((key) => {
			if (!applicableSecrets[key]) {
				delete applicableSecrets[key];
			}
		});

		const recursivelyReplaceSecrets = (value: any): any => {
			if (typeof value === "string") {
				let result = value;
				let match: RegExpExecArray | null;

				while ((match = secretPattern.exec(value)) !== null) {
					const placeholder = match[1]!;
					if (placeholder in applicableSecrets) {
						result = result.replace(
							`<secret>${placeholder}</secret>`,
							applicableSecrets[placeholder]!,
						);
						replacedPlaceholders.add(placeholder);
					} else {
						// Keep track of missing placeholders
						allMissingPlaceholders.add(placeholder);
						// Don't replace the tag, keep it as is
					}
				}

				return result;
			} else if (typeof value === "object" && value !== null) {
				if (Array.isArray(value)) {
					return value.map((v) => recursivelyReplaceSecrets(v));
				} else {
					const result: Record<string, any> = {};
					for (const [k, v] of Object.entries(value)) {
						result[k] = recursivelyReplaceSecrets(v);
					}
					return result;
				}
			}
			return value;
		};

		const processedParams = recursivelyReplaceSecrets(params);

		// Log sensitive data usage
		this.logSensitiveDataUsage(replacedPlaceholders, currentUrl);

		// Log a warning if any placeholders are missing
		if (allMissingPlaceholders.size > 0) {
			logger.warn(
				`Missing or empty keys in sensitive_data dictionary: ${Array.from(allMissingPlaceholders).join(", ")}`,
			);
		}

		return processedParams;
	}

	/**
	 * Creates a Union of individual action models from registered actions,
	 * used by LLM APIs that support tool calling & enforce a schema.
	 *
	 * Each action model contains only the specific action being used,
	 * rather than all actions with most set to None.
	 */
	@timeExecution("--createActionModel")
	createActionModel(
		includeActions?: string[] | null,
		page?: Page | null,
	): ActionModel {
		// Filter actions based on page if provided:
		//   if page is null, only include actions with no filters
		//   if page is provided, only include actions that match the page

		const availableActions: Map<string, RegisteredAction> = new Map();

		logger.info(
			`---->createActionModel started, includeActions: ${includeActions}, page: ${page?.url() || "null"}`,
		);

		for (const [name, action] of this.registry.actions.entries()) {
			if (
				includeActions !== null &&
				includeActions !== undefined &&
				!includeActions.includes(name)
			) {
				continue;
			}

			// If no page provided, only include actions with no filters
			if (page === null || page === undefined) {
				// Accept both null and undefined as "no filters"
				if (
					(action.pageFilter === null || action.pageFilter === undefined) &&
					(action.domains === null || action.domains === undefined)
				) {
					availableActions.set(name, action);
					logger.debug(
						`---->createActionModel added action without filters: ${name}`,
					);
				}
				continue;
			}

			// Check page_filter if present
			const domainIsAllowed = ActionRegistry._matchDomains(
				action.domains,
				page.url(),
			);
			const pageIsAllowed = ActionRegistry._matchPageFilter(
				action.pageFilter,
				page,
			);

			// Include action if both filters match (or if either is not present)
			if (domainIsAllowed && pageIsAllowed) {
				availableActions.set(name, action);
				logger.debug(
					`---->createActionModel added action with filters: ${name}`,
				);
			}
		}

		logger.info(
			`---->createActionModel availableActions.size: ${availableActions.size}`,
		);

		// If no actions available, return empty ActionModel
		if (availableActions.size === 0) {
			const emptyModel = new ActionModel({});
			logger.info(
				`---->createActionModel returning empty model: ${JSON.stringify(emptyModel)}`,
			);
			return emptyModel;
		}

		// Create action model with available actions
		// but we can create an ActionModel that contains only the available actions
		const actionModelData: Record<string, any> = {};

		for (const [name, action] of availableActions.entries()) {
			// Each action gets its parameter model as the value
			actionModelData[name] = action.paramModel || {};
		}

		// logger.info(
		// 	`---->createActionModel actionModelData: ${JSON.stringify(actionModelData, null, 2)}`,
		// );

		const result_model = new ActionModel(actionModelData);
		// logger.info(
		// 	`---->createActionModel result_model: ${JSON.stringify(result_model, null, 2)}`,
		// );
		// logger.info(
		// 	`---->createActionModel result_model keys: ${JSON.stringify(Object.keys(result_model))}`,
		// );
		logger.info(
			`---->createActionModel result_model keys length: ${Object.keys(result_model).length}`,
		);
		return result_model;
	}

	/**
	 * Get a description of all actions for the prompt
	 *
	 * If page is provided, only include actions that are available for that page
	 * based on their filter_func
	 */
	getPromptDescription(page?: Page | null): string {
		return this.registry.getPromptDescription(page);
	}
}
