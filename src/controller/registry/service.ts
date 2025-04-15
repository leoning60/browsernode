import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
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
		// In TypeScript, we'll use a simpler approach since we don't have Pydantic
		// We'll create a basic parameter model based on the function's type
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

			// Add to registry
			logger.debug(
				`this.registry.actions.set(action.name, action); ${action.name} : ${action.description} + ${action.paramModel} + ${action.function}`,
			);
			this.registry.actions.set(action.name, action);
			// logger.debug(
			// 	`after action this.registry.actions: ${JSON.stringify(Object.fromEntries(this.registry.actions))}`,
			// );
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
		logger.debug(
			`this.registry.executeAction browser.contextId:${browser?.contextId}}`,
		);
		logger.debug(
			`this.registry.executeAction this.registry.actions:${JSON.stringify(Array.from(this.registry.actions.entries()), null, 2)}`,
		);
		const action = this.registry.actions.get(actionName);
		logger.debug(
			`this.registry.executeAction action:${JSON.stringify(action, null, 2)}`,
		);
		logger.debug(
			`this.registry.executeAction function source: ${action?.function.toString()}`,
		);
		if (!action) {
			throw new Error(`Action ${actionName} not found`);
		}

		try {
			// Validate parameters (simplified version without Pydantic)
			const validatedParams = new ActionModel(params);
			logger.debug(
				`this.registry.executeAction validatedParams:${JSON.stringify(validatedParams, null, 2)}`,
			);

			logger.debug(
				`this.registry.executeAction functionParams:${action.function.length}`,
			);
			// Get function signature
			const functionParams = action.function.length;
			const functionString = action.function.toString();
			const parameterMatch = functionString.match(/\(([^)]*)\)/);
			const parameterNames = parameterMatch
				? parameterMatch[1]!.split(",").map((param) => param.trim())
				: Array.from({ length: functionParams }, (_, i) => `param${i}`);

			logger.debug(
				`this.registry.executeAction parameterNames:${JSON.stringify(parameterNames, null, 2)}`,
			);

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

			// Prepare extra arguments
			logger.debug(
				`this.registry.executeAction browserContent parameterNames: ${parameterNames}`,
			);
			const extraArgs: Record<string, any> = {};
			if (parameterNames.includes("context")) extraArgs.context = context;
			if (parameterNames.includes("browser")) extraArgs.browser = browser;
			if (parameterNames.includes("pageExtractionLlm"))
				extraArgs.pageExtractionLlm = pageExtractionLlm;
			if (parameterNames.includes("availableFilePaths"))
				extraArgs.availableFilePaths = availableFilePaths;
			if (actionName === "inputText" && sensitiveData)
				extraArgs.hasSensitiveData = true;

			// logger.debug(
			// 	`this.registry.executeAction browserContent extraArgs.browser.contextId: ${extraArgs.browser.contextId}`,
			// );
			// logger.debug(
			// 	`this.registry.executeAction extraArgs.browser: ${extraArgs.browser}`,
			// );
			// logger.debug(
			// 	`this.registry.executeAction browserContent extraArgs.availableFilePaths: ${extraArgs.availableFilePaths}`,
			// );

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

		const replaceSecrets = (value: any): any => {
			if (typeof value === "string") {
				return value.replace(secretPattern, (match, placeholder) => {
					return sensitiveData[placeholder] || match;
				});
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

	createActionModelV1(includeActions?: string[]): typeof ActionModel {
		const fields: Record<string, any> = {};

		this.registry.actions.forEach((action, name) => {
			logger.debug(
				`createActionModel this.registry.actions.forEach: name: ${name} + action: ${action}`,
			);
			if (!includeActions || includeActions.includes(name)) {
				fields[name] = {
					type: "object",
					description: action.description,
					properties: action.paramModel,
				};
			}
		});
		// Get the prototype to dynamically add methods
		const proto = ActionModel.prototype;

		// Iterate through the filtered actions from fields
		Object.keys(fields).forEach((actionName) => {
			// Add a method for each action that calls its function
			proto[actionName] = function (...args: any[]) {
				const registeredAction = this.actions.get(actionName);
				if (!registeredAction) {
					throw new Error(`Action "${actionName}" not found`);
				}
				return registeredAction.function(...args);
			};
		});
		return ActionModel;
	}

	createActionModelV2(includeActions?: string[]): typeof ActionModel {
		logger.debug(`createActionModel includeActions: ${includeActions}`);

		// Create fields dictionary similar to Python implementation
		const fields: Record<string, any> = {};

		this.registry.actions.forEach((action, name) => {
			// Only include specified actions if includeActions is provided
			if (!includeActions || includeActions.includes(name)) {
				fields[name] = {
					type: "object",
					description: action.description,
					properties: action.paramModel,
					schema: z.object(action.paramModel).optional(),
				};
			}
		});

		logger.debug(`createActionModel fields: ${JSON.stringify(fields)}`);

		// Create a derived class from ActionModel to support Zod validation
		class ZodActionModel extends ActionModel {
			constructor(params: Record<string, any>) {
				// Validate with Zod schemas before passing to parent constructor
				Object.entries(fields).forEach(([name, field]) => {
					if (params[name]) {
						field.schema.parse(params[name]);
					}
				});
				super(params);
			}
		}

		// Add action methods to prototype like in createActionModelV1
		Object.keys(fields).forEach((actionName) => {
			ZodActionModel.prototype[actionName] = function (...args: any[]) {
				const registeredAction = this.registry.actions.get(actionName);
				if (!registeredAction) {
					throw new Error(`Action "${actionName}" not found`);
				}
				return registeredAction.function(...args);
			};
		});

		return ZodActionModel;
	}

	// createActionModel 方法
	createActionModelZod(includeActions?: string[]): z.ZodObject<any> {
		// logger.debug(`---create_action_model include_actions: ${includeActions}`);
		// logger.debug(
		// 	`---create_action_model this.registry.actions: ${JSON.stringify(
		// 		Object.fromEntries(this.registry.actions),
		// 	)}`,
		// );

		// 创建动态字段
		const fields: Record<string, z.ZodOptional<any>> = {};

		for (const [name, action] of this.registry.actions.entries()) {
			if (includeActions === undefined || includeActions.includes(name)) {
				// 每个字段是可选的，使用 param_model 并添加描述
				fields[name] = z
					.object(action.paramModel)
					.optional()
					.describe(action.description);
			}
		}
		return z.object(fields);
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
