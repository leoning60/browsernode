import {
	AIMessage,
	BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import winston from "winston";

import { modelDump } from "../../bn_utils";
import bnLogger from "../../logging_config";
import { timeExecution } from "../../utils";
import { AgentMessagePrompt } from "../prompt";
import type { AgentOutput } from "../views";
import { MessageManagerState } from "./views";

// Create logger
const logger = bnLogger.child({
	module: "browser_node/agent/message_manager/service",
});

export class MessageManagerSettings {
	maxInputTokens: number = 128000;
	estimatedCharactersPerToken: number = 3;
	imageTokens: number = 800;
	includeAttributes: string[] = [];
	messageContext?: string;
	sensitiveData?: Record<string, string>;
	availableFilePaths?: string[];

	constructor(settings: Partial<MessageManagerSettings> = {}) {
		Object.assign(this, settings);
	}
}

// Create the MessageMetadata class since it's not exported from views.ts
class MessageMetadata {
	tokens: number = 0;
}

export class MessageManager {
	task: string;
	settings: MessageManagerSettings;
	state: MessageManagerState;
	systemPrompt: SystemMessage;

	constructor(params: {
		task: string;
		systemMessage: SystemMessage;
		settings: Partial<MessageManagerSettings>;
		state: MessageManagerState;
	}) {
		this.task = params.task;
		this.settings = new MessageManagerSettings(params.settings);
		this.state = params.state;
		this.systemPrompt = params.systemMessage;

		// Only initialize messages if state is empty
		if (this.state.history.messages.length === 0) {
			this.initMessages();
		}
	}

	private initMessages(): void {
		/**
		 * Initialize the message history with system message, context, task, and other initial messages
		 */
		this.addMessageWithTokens(this.systemPrompt);

		if (this.settings.messageContext) {
			const contextMessage = new HumanMessage(
				"Context for the task" + this.settings.messageContext,
			);
			this.addMessageWithTokens(contextMessage);
		}

		const taskMessage = new HumanMessage(
			`Your ultimate task is: """${this.task}""". If you achieved your ultimate task, stop everything and use the done action in the next step to complete the task. If not, continue as usual.`,
		);
		this.addMessageWithTokens(taskMessage);

		if (this.settings.sensitiveData) {
			let info = `Here are placeholders for sensitve data: ${Object.keys(
				this.settings.sensitiveData,
			)}`;
			info += "To use them, write <secret>the placeholder name</secret>";
			const infoMessage = new HumanMessage(info);
			this.addMessageWithTokens(infoMessage);
		}

		const placeholderMessage = new HumanMessage("Example output:");
		this.addMessageWithTokens(placeholderMessage);

		const toolCalls = [
			{
				name: "AgentOutput",
				args: {
					current_state: {
						evaluation_previous_goal: "Success - I opend the first page",
						memory: "Starting with the new task. I have completed 1/10 steps",
						next_goal: "Click on company a",
					},
					action: [{ click_element: { index: 0 } }],
				},
				id: String(this.state.toolId),
				type: "tool_call" as const,
			},
		];

		const exampleToolCall = new AIMessage({
			content: "",
			tool_calls: toolCalls,
		});
		this.addMessageWithTokens(exampleToolCall);
		this.addToolMessage("Browser started");

		const placeholderMemoryMessage = new HumanMessage(
			"[Your task history memory starts here]",
		);
		this.addMessageWithTokens(placeholderMemoryMessage);

		if (this.settings.availableFilePaths) {
			const filepathsMsg = new HumanMessage(
				`Here are file paths you can use: ${this.settings.availableFilePaths}`,
			);
			this.addMessageWithTokens(filepathsMsg);
		}
	}

	addNewTask(newTask: string): void {
		const content = `Your new ultimate task is: """${newTask}""". Take the previous context into account and finish your new ultimate task. `;
		const msg = new HumanMessage(content);
		this.addMessageWithTokens(msg);
		this.task = newTask;
	}

	@timeExecution("--addStateMessage")
	addStateMessage(
		state: any,
		result?: any[],
		stepInfo?: any,
		useVision = true,
	): void {
		/**
		 * Add browser state as human message
		 */

		// If keep in memory, add directly to history and add state without result
		if (result) {
			for (const r of result) {
				if (r.includeInMemory) {
					if (r.extractedContent) {
						const msg = new HumanMessage(
							"Action result: " + String(r.extractedContent),
						);
						this.addMessageWithTokens(msg);
					}
					if (r.error) {
						// If endswith \n, remove it
						let error = r.error;
						if (error.endsWith("\n")) {
							error = error.substring(0, error.length - 1);
						}
						// Get only last line of error
						const lastLine = error.split("\n").pop() || "";
						const msg = new HumanMessage("Action error: " + lastLine);
						this.addMessageWithTokens(msg);
					}
					result = undefined; // If result in history, we don't want to add it again
				}
			}
		}

		// Otherwise add state message and result to next message (which will not stay in memory)
		const stateMessage = new AgentMessagePrompt(
			state,
			result,
			this.settings.includeAttributes || [],
			stepInfo,
		).getUserMessage(useVision);

		this.addMessageWithTokens(stateMessage);
	}

	addModelOutput(modelOutput: AgentOutput): void {
		/**
		 * Add model output as AI message
		 */
		const toolCalls = [
			{
				name: "AgentOutput",
				args: modelDump(modelOutput, true),
				id: String(this.state.toolId),
				type: "tool_call" as const,
			},
		];

		const msg = new AIMessage({
			content: "",
			tool_calls: toolCalls,
		});

		this.addMessageWithTokens(msg);
		// Empty tool response
		this.addToolMessage("");
	}

	addPlan(plan?: string, position?: number): void {
		if (plan) {
			const msg = new AIMessage(plan);
			this.addMessageWithTokens(msg, position);
		}
	}

	@timeExecution("--getMessages")
	getMessages(): BaseMessage[] {
		/**
		 * Get current message list, potentially trimmed to max tokens
		 */
		const messages = this.state.history.messages.map((m) => m.message);

		// Debug which messages are in history with token count
		let totalInputTokens = 0;
		logger.debug(`Messages in history: ${this.state.history.messages.length}:`);

		for (const m of this.state.history.messages) {
			totalInputTokens += m.metadata.tokens;
			logger.debug(
				`${m.message.constructor.name} - Token count: ${m.metadata.tokens}`,
			);
		}

		logger.debug(`Total input tokens: ${totalInputTokens}`);
		return messages;
	}

	public addMessageWithTokens(message: BaseMessage, position?: number): void {
		/**
		 * Add message with token count metadata
		 * position: undefined for last, -1 for second last, etc.
		 */

		// Filter out sensitive data from the message
		if (this.settings.sensitiveData) {
			message = this.filterSensitiveData(message);
		}

		const tokenCount = this.countTokens(message);
		const metadata = new MessageMetadata();
		metadata.tokens = tokenCount;
		this.state.history.addMessage(message, metadata, position);
	}

	@timeExecution("--filterSensitiveData")
	private filterSensitiveData(message: BaseMessage): BaseMessage {
		/**
		 * Filter out sensitive data from the message
		 */
		const replaceSensitive = (value: string): string => {
			if (!this.settings.sensitiveData) {
				return value;
			}

			for (const [key, val] of Object.entries(this.settings.sensitiveData)) {
				if (!val) {
					continue;
				}
				value = value.replace(val, `<secret>${key}</secret>`);
			}

			return value;
		};

		if (typeof message.content === "string") {
			message.content = replaceSensitive(message.content);
		} else if (Array.isArray(message.content)) {
			for (let i = 0; i < message.content.length; i++) {
				const item = message.content[i];
				if (typeof item === "object" && item !== null && "text" in item) {
					item.text = replaceSensitive(item.text as string);
					message.content[i] = item;
				}
			}
		}

		return message;
	}

	private countTokens(message: BaseMessage): number {
		/**
		 * Count tokens in a message using the model's tokenizer
		 */
		let tokens = 0;

		if (Array.isArray(message.content)) {
			for (const item of message.content) {
				if ("image_url" in item) {
					tokens += this.settings.imageTokens || 800;
				} else if (
					typeof item === "object" &&
					item !== null &&
					"text" in item
				) {
					tokens += this.countTextTokens(item.text as string);
				}
			}
		} else {
			let msg = message.content as string;
			if ("tool_calls" in message) {
				msg += String((message as AIMessage).tool_calls);
			}
			tokens += this.countTextTokens(msg);
		}

		return tokens;
	}

	private countTextTokens(text: string): number {
		/**
		 * Count tokens in a text string
		 */
		// Rough estimate if no tokenizer available
		const tokens = Math.floor(
			text.length / (this.settings.estimatedCharactersPerToken || 3),
		);
		return tokens;
	}

	cutMessages(): boolean | null {
		/**
		 * Get current message list, potentially trimmed to max tokens
		 */
		const diff =
			this.state.history.currentTokens -
			(this.settings.maxInputTokens || 128000);
		if (diff <= 0) {
			return null;
		}

		if (this.state.history.messages.length === 0) {
			return false;
		}

		const lastMsgIndex = this.state.history.messages.length - 1;
		const lastMsg = this.state.history.messages[lastMsgIndex];

		if (!lastMsg) {
			return false;
		}

		// If list with image, remove image
		if (Array.isArray(lastMsg.message.content)) {
			// Iterate through content and remove image if exists
			for (let i = 0; i < lastMsg.message.content.length; i++) {
				const item = lastMsg.message.content[i];
				if (typeof item === "object" && item !== null && "image_url" in item) {
					lastMsg.message.content.splice(i, 1);
					// Update token count
					lastMsg.metadata.tokens -= this.settings.imageTokens || 800;
					this.state.history.currentTokens -= this.settings.imageTokens || 800;
					diff - (this.settings.imageTokens || 800);
					return true;
				}
			}
		}

		// Remove the oldest non-system message
		// Find oldest non-system message
		let removedCount = 0;

		for (let i = 0; i < this.state.history.messages.length; i++) {
			if (i <= 1) {
				continue;
			}

			const msg = this.state.history.messages[i];
			if (!msg) continue;

			// Never remove system message
			if (msg.message instanceof SystemMessage) {
				continue;
			}

			// Remove message
			this.state.history.currentTokens -= msg.metadata.tokens;
			this.state.history.messages.splice(i, 1);
			removedCount += 1;
			break;
		}

		if (removedCount > 0) {
			return true;
		}

		// Failsafe: if we can't remove any more messages raise an error
		if (diff > 0) {
			throw new Error("Max token limit reached - history is too long");
		}

		return false;
	}

	public removeLastStateMessage(): void {
		/**
		 * Remove last state message from history
		 */
		this.state.history.removeLastStateMessage();
	}

	addToolMessage(content: string): void {
		/**
		 * Add tool message to history
		 */
		const msg = new ToolMessage({
			content: content,
			tool_call_id: String(this.state.toolId),
		});

		this.addMessageWithTokens(msg);
		this.state.toolId += 1;
	}
}
