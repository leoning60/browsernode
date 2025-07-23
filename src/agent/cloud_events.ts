import * as crypto from "crypto";
import { EventEmitter } from "events";
import * as path from "path";
import base64 from "base64-js";
import * as fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { BaseEvent } from "./eventbus_util";

const maxStringLength = 100000; // 100K chars ~ 25k tokens should be enough
const maxUrlLength = 100000;
const maxTaskLength = 100000;
const maxCommentLength = 2000;
const maxFileContentSize = 50 * 1024 * 1024; // 50MB

export class UpdateAgentTaskEvent extends BaseEvent {
	// Required fields for identification
	id: string; // The task ID to update
	userId: string; // For authorization
	deviceId: string | null; // Device ID for auth lookup

	// Optional fields that can be updated
	stopped: boolean | null;
	paused: boolean | null;
	doneOutput: string | null;
	finishedAt: Date | null;
	agentState: object | null;
	userFeedbackType: string | null; // UserFeedbackType enum value as string
	userComment: string | null;
	gifUrl: string | null;

	constructor(data: {
		id: string;
		userId: string;
		deviceId?: string | null;
		stopped?: boolean | null;
		paused?: boolean | null;
		doneOutput?: string | null;
		finishedAt?: Date | null;
		agentState?: object | null;
		userFeedbackType?: string | null;
		userComment?: string | null;
		gifUrl?: string | null;
	}) {
		super();
		this.id = data.id;
		this.userId = data.userId;
		this.deviceId = data.deviceId || null;
		this.stopped = data.stopped || null;
		this.paused = data.paused || null;
		this.doneOutput = data.doneOutput || null;
		this.finishedAt = data.finishedAt || null;
		this.agentState = data.agentState || null;
		this.userFeedbackType = data.userFeedbackType || null;
		this.userComment = data.userComment || null;
		this.gifUrl = data.gifUrl || null;
	}

	/**Create an UpdateAgentTaskEvent from an Agent instance*/
	static fromAgent(agent: any): UpdateAgentTaskEvent {
		if (!agent._taskStartTime) {
			throw new Error("Agent must have _taskStartTime attribute");
		}

		const doneOutput = agent.state.history?.finalResult
			? agent.state.history.finalResult()
			: null;
		return new UpdateAgentTaskEvent({
			id: String(agent.taskId),
			userId: "", // To be filled by cloud handler
			deviceId: agent.cloudSync?.authClient?.deviceId || null,
			stopped: agent.state.stopped || false,
			paused: agent.state.paused || false,
			doneOutput: doneOutput,
			finishedAt: agent.state.history?.isDone() ? new Date() : null,
			agentState: agent.state.modelDump ? agent.state.modelDump() : {},
			userFeedbackType: null,
			userComment: null,
			gifUrl: null,
			// userFeedbackType and userComment would be set by the API/frontend
			// gifUrl would be set after GIF generation if needed
		});
	}
}

export class CreateAgentOutputFileEvent extends BaseEvent {
	// Model fields
	id: string;
	userId: string;
	deviceId: string | null; // Device ID for auth lookup
	taskId: string;
	fileName: string;
	fileContent: string | null; // Base64 encoded file content
	contentType: string | null; // MIME type for file uploads
	createdAt: Date;

	constructor(data: {
		id?: string;
		userId: string;
		deviceId?: string | null;
		taskId: string;
		fileName: string;
		fileContent?: string | null;
		contentType?: string | null;
		createdAt?: Date;
	}) {
		super();
		this.id = data.id || uuidv4();
		this.userId = data.userId;
		this.deviceId = data.deviceId || null;
		this.taskId = data.taskId;
		this.fileName = data.fileName;
		this.fileContent = this.validateFileSize(data.fileContent || null);
		this.contentType = data.contentType || null;
		this.createdAt = data.createdAt || new Date();
	}

	private validateFileSize(v: string | null): string | null {
		/**Validate base64 file content size.*/
		if (v === null) {
			return v;
		}
		// Remove data URL prefix if present
		if (v.includes(",")) {
			v = v.split(",")[1] || null;
		}
		// Check if v is still valid after split
		if (v === null) {
			return v;
		}
		// Estimate decoded size (base64 is ~33% larger)
		const estimatedSize = (v.length * 3) / 4;
		if (estimatedSize > maxFileContentSize) {
			throw new Error(
				`File content exceeds maximum size of ${maxFileContentSize / 1024 / 1024}MB`,
			);
		}
		return v;
	}

	static async fromAgentAndFile(
		agent: any,
		outputPath: string,
	): Promise<CreateAgentOutputFileEvent> {
		/**Create a CreateAgentOutputFileEvent from a file path*/

		const gifPath = path.resolve(outputPath);

		try {
			await fs.access(gifPath);
		} catch {
			throw new Error(`File not found: ${outputPath}`);
		}

		const stats = await fs.stat(gifPath);
		const gifSize = stats.size;

		// Read GIF content for base64 encoding if needed
		let gifContent: string | null = null;
		if (gifSize < 50 * 1024 * 1024) {
			// Only read if < 50MB
			const gifBytes = await fs.readFile(gifPath);
			gifContent = base64.fromByteArray(new Uint8Array(gifBytes));
		}

		return new CreateAgentOutputFileEvent({
			userId: "", // To be filled by cloud handler
			deviceId: agent.cloudSync?.authClient?.deviceId || null,
			taskId: String(agent.taskId),
			fileName: path.basename(gifPath),
			fileContent: gifContent, // Base64 encoded
			contentType: "image/gif",
		});
	}
}

export class CreateAgentStepEvent extends BaseEvent {
	// Model fields
	id: string;
	userId: string; // Added for authorization checks
	deviceId: string | null; // Device ID for auth lookup
	createdAt: Date;
	agentTaskId: string;
	step: number;
	evaluationPreviousGoal: string;
	memory: string;
	nextGoal: string;
	actions: Array<object>;
	screenshotUrl: string | null; // ~50MB for base64 images
	url: string;

	constructor(data: {
		id?: string;
		userId: string;
		deviceId?: string | null;
		createdAt?: Date;
		agentTaskId: string;
		step: number;
		evaluationPreviousGoal: string;
		memory: string;
		nextGoal: string;
		actions: Array<object>;
		screenshotUrl?: string | null;
		url?: string;
	}) {
		super();
		this.id = data.id || uuidv4();
		this.userId = data.userId;
		this.deviceId = data.deviceId || null;
		this.createdAt = data.createdAt || new Date();
		this.agentTaskId = data.agentTaskId;
		this.step = data.step;
		this.evaluationPreviousGoal = data.evaluationPreviousGoal;
		this.memory = data.memory;
		this.nextGoal = data.nextGoal;
		this.actions = data.actions;
		this.screenshotUrl = this.validateScreenshotSize(
			data.screenshotUrl || null,
		);
		this.url = data.url || "";
	}

	private validateScreenshotSize(v: string | null): string | null {
		/**Validate screenshot URL or base64 content size.*/
		if (v === null || !v.startsWith("data:")) {
			return v;
		}
		// It's base64 data, check size
		if (v.includes(",")) {
			const base64Part = v.split(",")[1];
			if (!base64Part) {
				return v;
			}
			const estimatedSize = (base64Part.length * 3) / 4;
			if (estimatedSize > maxFileContentSize) {
				throw new Error(
					`Screenshot content exceeds maximum size of ${maxFileContentSize / 1024 / 1024}MB`,
				);
			}
		}
		return v;
	}

	static fromAgentStep(
		agent: any,
		modelOutput: any,
		result: Array<any>,
		actionsData: Array<object>,
		browserStateSummary: any,
	): CreateAgentStepEvent {
		/**Create a CreateAgentStepEvent from agent step data*/
		// Get first action details if available
		const firstAction = modelOutput.action?.[0] || null;

		// Extract current state from model output
		const currentState = modelOutput.currentState || null;

		// Capture screenshot as base64 data URL if available
		let screenshotUrl: string | null = null;
		if (browserStateSummary.screenshot) {
			screenshotUrl = `data:image/png;base64,${browserStateSummary.screenshot}`;
		}

		return new CreateAgentStepEvent({
			userId: "", // To be filled by cloud handler
			deviceId: agent.cloudSync?.authClient?.deviceId || null,
			agentTaskId: String(agent.taskId),
			step: agent.state.nSteps,
			evaluationPreviousGoal: currentState?.evaluationPreviousGoal || "",
			memory: currentState?.memory || "",
			nextGoal: currentState?.nextGoal || "",
			actions: actionsData, // List of action dicts
			url: browserStateSummary.url,
			screenshotUrl: screenshotUrl,
		});
	}
}

export class CreateAgentTaskEvent extends BaseEvent {
	// Model fields
	id: string;
	userId: string; // Added for authorization checks
	deviceId: string | null; // Device ID for auth lookup
	agentSessionId: string;
	llmModel: string; // LLMModel enum value as string
	stopped: boolean;
	paused: boolean;
	task: string;
	doneOutput: string | null;
	scheduledTaskId: string | null;
	startedAt: Date;
	finishedAt: Date | null;
	agentState: object;
	userFeedbackType: string | null; // UserFeedbackType enum value as string
	userComment: string | null;
	gifUrl: string | null;

	constructor(data: {
		id?: string;
		userId: string;
		deviceId?: string | null;
		agentSessionId: string;
		llmModel: string;
		stopped?: boolean;
		paused?: boolean;
		task: string;
		doneOutput?: string | null;
		scheduledTaskId?: string | null;
		startedAt?: Date;
		finishedAt?: Date | null;
		agentState?: object;
		userFeedbackType?: string | null;
		userComment?: string | null;
		gifUrl?: string | null;
	}) {
		super();
		this.id = data.id || uuidv4();
		this.userId = data.userId;
		this.deviceId = data.deviceId || null;
		this.agentSessionId = data.agentSessionId;
		this.llmModel = data.llmModel;
		this.stopped = data.stopped || false;
		this.paused = data.paused || false;
		this.task = data.task;
		this.doneOutput = data.doneOutput || null;
		this.scheduledTaskId = data.scheduledTaskId || null;
		this.startedAt = data.startedAt || new Date();
		this.finishedAt = data.finishedAt || null;
		this.agentState = data.agentState || {};
		this.userFeedbackType = data.userFeedbackType || null;
		this.userComment = data.userComment || null;
		this.gifUrl = data.gifUrl || null;
	}

	static fromAgent(agent: any): CreateAgentTaskEvent {
		/**Create a CreateAgentTaskEvent from an Agent instance*/
		return new CreateAgentTaskEvent({
			id: String(agent.taskId),
			userId: "", // To be filled by cloud handler
			deviceId: agent.cloudSync?.authClient?.deviceId || null,
			agentSessionId: String(agent.sessionId),
			task: agent.task,
			llmModel: agent.llm.modelName,
			agentState: agent.state.modelDump ? agent.state.modelDump() : {},
			stopped: false,
			paused: false,
			doneOutput: null,
			startedAt: new Date(agent._taskStartTime * 1000),
			finishedAt: null,
			userFeedbackType: null,
			userComment: null,
			gifUrl: null,
		});
	}
}

export class CreateAgentSessionEvent extends BaseEvent {
	// Model fields
	id: string;
	userId: string;
	deviceId: string | null; // Device ID for auth lookup
	browserSessionId: string;
	browserSessionLiveUrl: string;
	browserSessionCdpUrl: string;
	browserSessionStopped: boolean;
	browserSessionStoppedAt: Date | null;
	isSourceApi: boolean | null;
	browserState: object;
	browserSessionData: object | null;

	constructor(data: {
		id?: string;
		userId: string;
		deviceId?: string | null;
		browserSessionId: string;
		browserSessionLiveUrl: string;
		browserSessionCdpUrl: string;
		browserSessionStopped?: boolean;
		browserSessionStoppedAt?: Date | null;
		isSourceApi?: boolean | null;
		browserState?: object;
		browserSessionData?: object | null;
	}) {
		super();
		this.id = data.id || uuidv4();
		this.userId = data.userId;
		this.deviceId = data.deviceId || null;
		this.browserSessionId = data.browserSessionId;
		this.browserSessionLiveUrl = data.browserSessionLiveUrl;
		this.browserSessionCdpUrl = data.browserSessionCdpUrl;
		this.browserSessionStopped = data.browserSessionStopped || false;
		this.browserSessionStoppedAt = data.browserSessionStoppedAt || null;
		this.isSourceApi = data.isSourceApi || null;
		this.browserState = data.browserState || {};
		this.browserSessionData = data.browserSessionData || null;
	}

	static fromAgent(agent: any): CreateAgentSessionEvent {
		/**Create a CreateAgentSessionEvent from an Agent instance*/
		return new CreateAgentSessionEvent({
			id: String(agent.sessionId),
			userId: "", // To be filled by cloud handler
			deviceId: agent.cloudSync?.authClient?.deviceId || null,
			browserSessionId: agent.browserSession.id,
			browserSessionLiveUrl: "", // To be filled by cloud handler
			browserSessionCdpUrl: "", // To be filled by cloud handler
			browserState: {
				viewport: agent.browserProfile?.viewport || {
					width: 1280,
					height: 720,
				},
				userAgent: agent.browserProfile?.userAgent || null,
				headless: agent.browserProfile?.headless || true,
				initialUrl: null, // Will be updated during execution
				finalUrl: null, // Will be updated during execution
				totalPagesVisited: 0, // Will be updated during execution
				sessionDurationSeconds: 0, // Will be updated during execution
			},
			browserSessionData: {
				cookies: [],
				secrets: {},
				// TODO: send secrets safely so tasks can be replayed on cloud seamlessly
				// 'secrets': dict(agent.sensitive_data) if agent.sensitive_data else {},
				allowedDomains: agent.browserProfile?.allowedDomains || [],
			},
		});
	}
}
