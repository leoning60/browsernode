import type {
	AssistantMessage,
	BaseMessage,
	SystemMessage,
	ToolCall,
	UserMessage,
} from "../messages";

import type { Message, ToolCall as OllamaToolCall } from "ollama";

/**Serializer for converting between custom message types and Ollama message types.*/
class OllamaMessageSerializer {
	/**Extract text content from message content, ignoring images.*/
	static extractTextContent(content: any): string {
		if (content === null || content === undefined) {
			return "";
		}
		if (typeof content === "string") {
			return content;
		}

		const textParts: string[] = [];
		for (const part of content) {
			if (part.type) {
				if (part.type === "text") {
					textParts.push(part.text);
				} else if (part.type === "refusal") {
					textParts.push(`[Refusal] ${part.refusal}`);
				}
			}
			// Skip image parts as they're handled separately
		}

		return textParts.join("\n");
	}

	/**Extract images from message content.*/
	static extractImages(content: any): string[] {
		if (
			content === null ||
			content === undefined ||
			typeof content === "string"
		) {
			return [];
		}

		const images: string[] = [];
		for (const part of content) {
			if (part.type && part.type === "image_url") {
				const url = part.image_url.url;
				if (url.startsWith("data:")) {
					// Handle base64 encoded images
					// Format: data:image/png;base64,<data>
					const [, data] = url.split(",", 2);
					// Use the base64 data directly
					images.push(data);
				} else {
					// Handle URL images (Ollama will download them)
					images.push(url);
				}
			}
		}

		return images;
	}

	/**Convert browsernode ToolCalls to Ollama ToolCalls.*/
	static serializeToolCalls(toolCalls: ToolCall[]): OllamaToolCall[] {
		const ollamaToolCalls: OllamaToolCall[] = [];

		for (const toolCall of toolCalls) {
			// Parse arguments from JSON string to dict for Ollama
			let argumentsDict: any;
			try {
				argumentsDict = JSON.parse(toolCall.function.arguments);
			} catch (error) {
				// If parsing fails, wrap in a dict
				argumentsDict = { arguments: toolCall.function.arguments };
			}

			const ollamaToolCall: OllamaToolCall = {
				function: {
					name: toolCall.function.name,
					arguments: argumentsDict,
				},
			};
			ollamaToolCalls.push(ollamaToolCall);
		}

		return ollamaToolCalls;
	}

	// region - Serialize overloads
	static serialize(message: UserMessage): Message;
	static serialize(message: SystemMessage): Message;
	static serialize(message: AssistantMessage): Message;
	static serialize(message: BaseMessage): Message;
	/**Serialize a custom message to an Ollama Message.*/
	static serialize(message: BaseMessage): Message {
		if (message.constructor.name === "UserMessage") {
			const userMessage = message as UserMessage;
			const textContent = OllamaMessageSerializer.extractTextContent(
				userMessage.content,
			);
			const images = OllamaMessageSerializer.extractImages(userMessage.content);

			const ollamaMessage: Message = {
				role: "user",
				content: textContent,
			};

			if (images.length > 0) {
				ollamaMessage.images = images;
			}

			return ollamaMessage;
		} else if (message.constructor.name === "SystemMessage") {
			const systemMessage = message as SystemMessage;
			const textContent = OllamaMessageSerializer.extractTextContent(
				systemMessage.content,
			);

			return {
				role: "system",
				content: textContent,
			};
		} else if (message.constructor.name === "AssistantMessage") {
			const assistantMessage = message as AssistantMessage;
			// Handle content
			let textContent: string | undefined;
			if (
				assistantMessage.content !== null &&
				assistantMessage.content !== undefined
			) {
				textContent = OllamaMessageSerializer.extractTextContent(
					assistantMessage.content,
				);
			}

			const ollamaMessage: Message = {
				role: "assistant",
				content: textContent || "serializer is null",
			};

			// Handle tool calls
			if (assistantMessage.toolCalls) {
				ollamaMessage.tool_calls = OllamaMessageSerializer.serializeToolCalls(
					assistantMessage.toolCalls,
				);
			}

			return ollamaMessage;
		} else {
			throw new Error(`Unknown message type: ${message.constructor.name}`);
		}
	}

	/**Serialize a list of browsernode messages to Ollama Messages.*/
	static serializeMessages(messages: BaseMessage[]): Message[] {
		return messages.map((m) => OllamaMessageSerializer.serialize(m));
	}
}

export { OllamaMessageSerializer };
