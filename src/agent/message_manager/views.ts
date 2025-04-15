import {
	AIMessage,
	BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import winston from "winston";

const logger = winston.createLogger({
	level: "info",
	format: winston.format.combine(
		winston.format.label({
			label: "browser_node/agent/message_manager/views",
		}),
		winston.format.timestamp(),
		winston.format.errors({ stack: true }),
		winston.format.printf(({ level, message, timestamp, stack }) => {
			return `${timestamp} [${level}]: ${message}${stack ? `\n${stack}` : ""}`;
		}),
	),
	transports: [new winston.transports.Console()],
});
class MessageMetadata {
	/** Metadata for a message */
	tokens: number = 0;
}

class ManagedMessage {
	message: BaseMessage;
	metadata: MessageMetadata;

	constructor(message: BaseMessage, metadata: MessageMetadata) {
		this.message = message;
		this.metadata = metadata;
	}
}

class MessageHistory {
	messages: ManagedMessage[] = [];
	currentTokens: number = 0;

	addMessage(
		message: BaseMessage,
		metadata: MessageMetadata,
		position?: number,
	): void {
		if (position === undefined) {
			this.messages.push(new ManagedMessage(message, metadata));
		} else {
			this.messages.splice(position, 0, new ManagedMessage(message, metadata));
		}
		this.currentTokens += metadata.tokens;
	}

	addModelOutput(output: any): void {
		const toolCalls = [
			{
				name: "AgentOutput",
				args: output,
				id: "1",
				type: "tool_call" as const,
			},
		];

		const msg = new AIMessage({
			content: "",
			tool_calls: toolCalls,
		});
		const metadata = new MessageMetadata();
		metadata.tokens = 100;
		this.addMessage(msg, metadata);

		// Empty tool response
		const toolMessage = new ToolMessage({
			content: "",
			tool_call_id: "1",
		});
		const toolMetadata = new MessageMetadata();
		toolMetadata.tokens = 10;
		this.addMessage(toolMessage, toolMetadata);
	}

	getMessages(): BaseMessage[] {
		return this.messages.map((m) => m.message);
	}

	getTotalTokens(): number {
		return this.currentTokens;
	}

	removeOldestMessage(): void {
		for (let i = 0; i < this.messages.length; i++) {
			if (!(this.messages[i]!.message instanceof SystemMessage)) {
				this.currentTokens -= this.messages[i]!.metadata.tokens;
				this.messages.splice(i, 1);
				break;
			}
		}
	}

	removeLastStateMessage(): void {
		if (
			this.messages.length > 2 &&
			this.messages[this.messages.length - 1]!.message instanceof HumanMessage
		) {
			this.currentTokens -=
				this.messages[this.messages.length - 1]!.metadata.tokens;
			this.messages.pop();
		}
	}
}

export class MessageManagerState {
	history: MessageHistory = new MessageHistory();
	toolId: number = 1;
}
