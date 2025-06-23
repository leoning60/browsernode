import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BrowserContext } from "../../browser/context";
import bnLogger from "../../logging_config";
import { timeExecution } from "../../utils";
import { ActionModel, ActionRegistry, RegisteredAction } from "./views";

const logger = bnLogger.child({
	label: "browser_node/controller/registry/service",
});

export class Registry<Context = any> {
	public registry: ActionRegistry;
	public excludeActions: string[];

	constructor(excludeActions: string[] | null = null) {
		this.registry = new ActionRegistry();
		this.excludeActions = excludeActions ?? [];
	}

	@timeExecution("--createParamModel")
	private createParamModel(function_: Function): Record<string, any> {
		return {
			type: "object",
			properties: {},
			required: [],
		};
	}

	action(description: string, paramModel?: Record<string, any>) {
		return (fn: (...args: any[]) => any) => {
			// Create parameter model if not provided
			const actualParamModel = paramModel || this.createParamModel(fn);

			// Create registered action
			const action = new RegisteredAction({
				name: fn.name || "anonymous",
				description,
				function: fn,
				paramModel: actualParamModel,
			});

			this.registry.actions.set(action.name, action);
			return fn;
		};
	}

	@timeExecution("--executeAction(registry)")
	async executeAction(
		actionName: string,
		params: Record<string, any>,
		browser?: BrowserContext,
		pageExtractionLlm?: BaseChatModel,
		sensitiveData?: Record<string, string>,
		availableFilePaths?: string[],
		context?: Context,
	): Promise<any> {
		const action = this.registry.actions.get(actionName);

		if (!action) {
			throw new Error(`Action ${actionName} not found`);
		}

		try {
			const validatedParams = new ActionModel(params);
			const functionParams = action.function.length;
			const functionString = action.function.toString();
			const parameterMatch = functionString.match(/\(([^)]*)\)/);
			const parameterNames = parameterMatch
				? parameterMatch[1]!.split(",").map((param) => param.trim())
				: Array.from({ length: functionParams }, (_, i) => `param${i}`);

			// Check required parameters
			if (parameterNames.includes("browser") && !browser) {
				throw new Error(
					`Action ${actionName} requires browser but none provided.`,
				);
			}
			if (parameterNames.includes("pageExtractionLlm") && !pageExtractionLlm) {
				throw new Error(
					`Action ${actionName} requires pageExtractionLlm but none provided.`,
				);
			}
			if (
				parameterNames.includes("availableFilePaths") &&
				!availableFilePaths
			) {
				throw new Error(
					`Action ${actionName} requires availableFilePaths but none provided.`,
				);
			}
			if (parameterNames.includes("context") && !context) {
				throw new Error(
					`Action ${actionName} requires context but none provided.`,
				);
			}

			// Replace sensitive data if needed
			if (sensitiveData) {
				this.replaceSensitiveData(validatedParams, sensitiveData);
			}
			const extraArgs: Record<string, any> = {};
			if (parameterNames.includes("context")) extraArgs.context = context;
			if (parameterNames.includes("browser")) extraArgs.browser = browser;
			if (parameterNames.includes("pageExtractionLlm"))
				extraArgs.pageExtractionLlm = pageExtractionLlm;
			if (parameterNames.includes("availableFilePaths"))
				extraArgs.availableFilePaths = availableFilePaths;
			if (actionName === "inputText" && sensitiveData)
				extraArgs.hasSensitiveData = true;

			return await action.function.call(
				null,
				validatedParams,
				...Object.values(extraArgs),
			);
		} catch (error) {
			throw new Error(
				`Error executing action ${actionName}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private replaceSensitiveData(
		params: ActionModel,
		sensitiveData: Record<string, string>,
	): void {
		const secretPattern = /<secret>(.*?)<\/secret>/g;
		const placeholderPattern = /\[PLACEHOLDER:(.*?)\]/g;

		const replaceSecrets = (value: any): any => {
			if (typeof value === "string") {
				value = value.replace(secretPattern, (match, placeholder) => {
					return sensitiveData[placeholder] || match;
				});
				value = value.replace(placeholderPattern, (match, placeholder) => {
					return sensitiveData[placeholder] || match;
				});
				return value;
			} else if (Array.isArray(value)) {
				return value.map(replaceSecrets);
			} else if (typeof value === "object" && value !== null) {
				return Object.fromEntries(
					Object.entries(value).map(([k, v]) => [k, replaceSecrets(v)]),
				);
			}
			return value;
		};

		Object.entries(params).forEach(([key, value]) => {
			params[key] = replaceSecrets(value);
		});
	}

	@timeExecution("--createActionModel(registry)")
	createActionModel(includeActions?: string[]): ActionModel {
		const actionModel = new ActionModel({});
		for (const [name, action] of this.registry.actions.entries()) {
			if (includeActions === undefined || includeActions.includes(name)) {
				actionModel[name] = action.paramModel;
			}
		}
		return actionModel;
	}

	getPromptDescription(): string {
		return this.registry.getPromptDescription();
	}
}
