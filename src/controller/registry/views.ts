import { modelDumpExcludedUnset } from "../../bn_utils";
import bnLogger from "../../logging_config";

const logger = bnLogger.child({
	label: "browser_node/controller/registry/views",
});

class RegisteredAction {
	/**
	 * Model for a registered action
	 */
	name: string;
	description: string;
	function: (...args: any[]) => any; //type Callable
	paramModel: Record<string, any> | undefined;

	constructor(params: Omit<RegisteredAction, "promptDescription">) {
		this.name = params.name;
		this.description = params.description;
		this.function = params.function;
		this.paramModel = params.paramModel;
	}

	/**
	 * Get the prompt description for the action
	 * @returns The prompt description for the action
	 */
	promptDescription(): string {
		const skipKeys = ["title"];

		const transformedParams = Object.entries(this.paramModel!).reduce(
			(acc, [k, v]) => {
				const filteredProps = Object.fromEntries(
					Object.entries(v).filter(([subK]) => !skipKeys.includes(subK)),
				);
				acc[k] = filteredProps;
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
	// name: string;
	// paramModel: Record<string, any>;
	[key: string]: any;

	constructor(params: Record<string, any>) {
		Object.assign(this, params);
	}

	/**
	 * Get the index of the action
	 * @returns The index of the action
	 */
	getIndex(): number | null {
		// Get all parameter values
		const params = Object.values(modelDumpExcludedUnset(this, true));
		if (!params.length) {
			return null;
		}

		// Check each parameter for an index
		for (const param of params) {
			if (param && "index" in param) {
				return param.index ?? null;
			}
		}
		return null;
	}

	/**
	 * Set the index of the action
	 * @param index The index of the action
	 */
	setIndex(index: number): void {
		// Get the action name and params
		const actionData = modelDumpExcludedUnset(this, true);
		const actionName = Object.keys(actionData)[0] as keyof ActionModel;
		const actionParams = this[actionName];

		// Update the index if it exists on the params
		if (actionParams && "index" in actionParams) {
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
	 * Get a description of all actions for the prompt
	 * @returns The prompt description for the actions
	 */
	getPromptDescription(): string {
		return Array.from(this.actions.values())
			.map((action) => action.promptDescription())
			.join("\n");
	}
}
export { RegisteredAction, ActionModel, ActionRegistry };
