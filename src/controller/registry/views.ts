class RegisteredAction {
	name: string;
	description: string;
	function: (...args: any[]) => any;
	paramModel: Record<string, any>;

	constructor(params: Omit<RegisteredAction, "promptDescription">) {
		this.name = params.name;
		this.description = params.description;
		this.function = params.function;
		this.paramModel = params.paramModel;
	}

	promptDescription(): string {
		const skipKeys = ["title"];

		const transformedParams = Object.entries(this.paramModel).reduce(
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

interface ActionModelParams {
	index?: number;
	[key: string]: any;
}

class ActionModel {
	[key: string]: ActionModelParams | any;

	constructor(params: Record<string, ActionModelParams>) {
		Object.assign(this, params);
	}

	getIndex(): number | null {
		// Get all parameter values
		const params = Object.values(this.modelDump());
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

	setIndex(index: number): void {
		// Get the action name and params
		const actionData = this.modelDump();
		const actionName = Object.keys(actionData)[0] as string;
		const actionParams = this[actionName];

		// Update the index if it exists on the params
		if (actionParams && "index" in actionParams) {
			actionParams.index = index;
		}
	}

	private modelDump(): Record<string, ActionModelParams> {
		// Filter out undefined/null values and function properties
		return Object.fromEntries(
			Object.entries(this).filter(
				([_, value]) =>
					value !== undefined && value !== null && typeof value !== "function",
			),
		);
	}
}

class ActionRegistry {
	actions: Map<string, RegisteredAction> = new Map();

	getPromptDescription(): string {
		return Array.from(this.actions.values())
			.map((action) => action.promptDescription())
			.join("\n");
	}
}
export { RegisteredAction, ActionModel, ActionRegistry };
