import { Logger } from "winston";
import type { BaseMessage, UserMessage } from "../../llm/messages";
import bnLogger from "../../logging_config";

const logger: Logger = bnLogger.child({
	module: "browsernode/agent/message_manager/views",
});

/** Represents a single agent history item with its data and string representation */
class HistoryItem {
	stepNumber: number | null = null;
	evaluationPreviousGoal: string | null = null;
	memory: string | null = null;
	nextGoal: string | null = null;
	actionResults: string | null = null;
	error: string | null = null;
	systemMessage: string | null = null;

	constructor(
		params: {
			stepNumber?: number | null;
			evaluationPreviousGoal?: string | null;
			memory?: string | null;
			nextGoal?: string | null;
			actionResults?: string | null;
			error?: string | null;
			systemMessage?: string | null;
		} = {},
	) {
		this.stepNumber = params.stepNumber ?? null;
		this.evaluationPreviousGoal = params.evaluationPreviousGoal ?? null;
		this.memory = params.memory ?? null;
		this.nextGoal = params.nextGoal ?? null;
		this.actionResults = params.actionResults ?? null;
		this.error = params.error ?? null;
		this.systemMessage = params.systemMessage ?? null;

		// Validate that error and systemMessage are not both provided
		if (this.error !== null && this.systemMessage !== null) {
			throw new Error(
				"Cannot have both error and systemMessage at the same time",
			);
		}
	}

	/** Get string representation of the history item */
	toString(): string {
		const stepStr =
			this.stepNumber !== null ? `step_${this.stepNumber}` : "step_unknown";

		if (this.error) {
			return `<${stepStr}>
${this.error}
</${stepStr}>`;
		} else if (this.systemMessage) {
			return `<sys>
${this.systemMessage}
</sys>`;
		} else {
			const contentParts = [
				`Evaluation of Previous Step: ${this.evaluationPreviousGoal}`,
				`Memory: ${this.memory}`,
				`Next Goal: ${this.nextGoal}`,
			];

			if (this.actionResults) {
				contentParts.push(this.actionResults);
			}

			const content = contentParts.join("\n");

			return `<${stepStr}>
${content}
</${stepStr}>`;
		}
	}
}

/** History of messages */
class MessageHistory {
	messages: BaseMessage[] = [];

	/**
	 * Add a message to the history
	 * @param message - The message to add
	 * @param position - The position to add the message at
	 */
	addMessage(message: BaseMessage, position?: number): void {
		if (position === undefined) {
			this.messages.push(message);
		} else {
			this.messages.splice(position, 0, message);
		}
	}

	/**
	 * Get all messages
	 */
	getMessages(): BaseMessage[] {
		return this.messages;
	}

	/**
	 * Remove the last state message from the history
	 */
	removeLastStateMessage(): void {
		if (
			this.messages.length > 2 &&
			this.messages[this.messages.length - 1]!.role === "user"
		) {
			this.messages.pop();
		}
	}
}

/** Holds the state for MessageManager */
export class MessageManagerState {
	/** Holds the state for MessageManager */
	history: MessageHistory = new MessageHistory();
	toolId: number = 1;
	agentHistoryItems: HistoryItem[] = [
		new HistoryItem({ stepNumber: 0, systemMessage: "Agent initialized" }),
	];
	readStateDescription: string = "";
}

export { HistoryItem, MessageHistory };
