export abstract class BaseTelemetryEvent {
	abstract get name(): string;

	get properties(): Record<string, any> {
		const obj = { ...this } as any;
		const { name, ...properties } = obj;
		return properties;
	}
}

export class AgentTelemetryEvent extends BaseTelemetryEvent {
	// start details
	task: string;
	model: string;
	modelProvider: string;
	plannerLlm: string | null;
	maxSteps: number;
	maxActionsPerStep: number;
	useVision: boolean;
	useValidation: boolean;
	version: string;
	source: string;
	// step details
	actionErrors: (string | null)[];
	actionHistory: (Record<string, any>[] | null)[];
	urlsVisited: (string | null)[];
	// end details
	steps: number;
	totalInputTokens: number;
	totalDurationSeconds: number;
	success: boolean | null;
	finalResultResponse: string | null;
	errorMessage: string | null;

	constructor(data: {
		task: string;
		model: string;
		modelProvider: string;
		plannerLlm: string | null;
		maxSteps: number;
		maxActionsPerStep: number;
		useVision: boolean;
		useValidation: boolean;
		version: string;
		source: string;
		actionErrors: (string | null)[];
		actionHistory: (Record<string, any>[] | null)[];
		urlsVisited: (string | null)[];
		steps: number;
		totalInputTokens: number;
		totalDurationSeconds: number;
		success: boolean | null;
		finalResultResponse: string | null;
		errorMessage: string | null;
	}) {
		super();
		this.task = data.task;
		this.model = data.model;
		this.modelProvider = data.modelProvider;
		this.plannerLlm = data.plannerLlm;
		this.maxSteps = data.maxSteps;
		this.maxActionsPerStep = data.maxActionsPerStep;
		this.useVision = data.useVision;
		this.useValidation = data.useValidation;
		this.version = data.version;
		this.source = data.source;
		this.actionErrors = data.actionErrors;
		this.actionHistory = data.actionHistory;
		this.urlsVisited = data.urlsVisited;
		this.steps = data.steps;
		this.totalInputTokens = data.totalInputTokens;
		this.totalDurationSeconds = data.totalDurationSeconds;
		this.success = data.success;
		this.finalResultResponse = data.finalResultResponse;
		this.errorMessage = data.errorMessage;
	}

	get name(): string {
		return "agent_event";
	}
}
