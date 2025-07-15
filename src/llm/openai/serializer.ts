import type {
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartRefusalParam,
	ContentPartTextParam,
	SystemMessage,
	UserMessage,
} from "../messages";

import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionContentPartImage,
	ChatCompletionContentPartRefusal,
	ChatCompletionContentPartText,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
	ChatCompletionSystemMessageParam,
	ChatCompletionUserMessageParam,
} from "openai/resources/chat/completions";

type ImageURL = ChatCompletionContentPartImage.ImageURL;
type Function = ChatCompletionMessageToolCall.Function;

/**
 * Serializer for converting between custom message types and OpenAI message param types.
 */
export class OpenAIMessageSerializer {
	private static serializeContentPartText(
		part: ContentPartTextParam,
	): ChatCompletionContentPartText {
		return {
			type: "text",
			text: part.text,
		};
	}

	/**
	 * Serialize content part for image
	 */
	private static serializeContentPartImage(
		part: ContentPartImageParam,
	): ChatCompletionContentPartImage {
		return {
			type: "image_url",
			image_url: {
				url: part.imageUrl.url,
				detail: part.imageUrl.detail,
			} as ImageURL,
		};
	}

	/**
	 * Serialize content part for refusal
	 */
	private static serializeContentPartRefusal(
		part: ContentPartRefusalParam,
	): ChatCompletionContentPartRefusal {
		return {
			type: "refusal",
			refusal: part.refusal,
		};
	}

	/**
	 * Serialize content for user messages (text and images allowed)
	 */
	private static serializeUserContent(
		content: string | (ContentPartTextParam | ContentPartImageParam)[],
	):
		| string
		| (ChatCompletionContentPartText | ChatCompletionContentPartImage)[] {
		if (typeof content === "string") {
			return content;
		}

		const serializedParts: (
			| ChatCompletionContentPartText
			| ChatCompletionContentPartImage
		)[] = [];
		for (const part of content) {
			if (part.type === "text") {
				serializedParts.push(this.serializeContentPartText(part));
			} else if (part.type === "image_url") {
				serializedParts.push(this.serializeContentPartImage(part));
			}
		}
		return serializedParts;
	}

	/**
	 * Serialize content for system messages (text only)
	 */
	private static serializeSystemContent(
		content: string | ContentPartTextParam[],
	): string | ChatCompletionContentPartText[] {
		if (typeof content === "string") {
			return content;
		}

		const serializedParts: ChatCompletionContentPartText[] = [];
		for (const part of content) {
			if (part.type === "text") {
				serializedParts.push(this.serializeContentPartText(part));
			}
		}
		return serializedParts;
	}

	/**
	 * Serialize content for assistant messages (text and refusal allowed)
	 */
	private static serializeAssistantContent(
		content: string | (ContentPartTextParam | ContentPartRefusalParam)[] | null,
	):
		| string
		| (ChatCompletionContentPartText | ChatCompletionContentPartRefusal)[]
		| null {
		if (content === null || content === undefined) {
			return null;
		}
		if (typeof content === "string") {
			return content;
		}

		const serializedParts: (
			| ChatCompletionContentPartText
			| ChatCompletionContentPartRefusal
		)[] = [];
		for (const part of content) {
			if (part.type === "text") {
				serializedParts.push(this.serializeContentPartText(part));
			} else if (part.type === "refusal") {
				serializedParts.push(this.serializeContentPartRefusal(part));
			}
		}
		return serializedParts;
	}

	/**
	 * Serialize tool call
	 */
	private static serializeToolCall(
		toolCall: any,
	): ChatCompletionMessageToolCall {
		return {
			id: toolCall.id,
			type: "function",
			function: {
				name: toolCall.function.name,
				arguments: toolCall.function.arguments,
			} as Function,
		};
	}

	/**
	 * Serialize a message based on its type
	 */
	static serialize(message: UserMessage): ChatCompletionUserMessageParam;
	static serialize(message: SystemMessage): ChatCompletionSystemMessageParam;
	static serialize(
		message: AssistantMessage,
	): ChatCompletionAssistantMessageParam;
	static serialize(message: BaseMessage): ChatCompletionMessageParam {
		/**
		 * Serialize a custom message to an OpenAI message param.
		 */

		if (message.role === "user") {
			const userMessage = message as UserMessage;
			const userResult: ChatCompletionUserMessageParam = {
				role: "user",
				content: this.serializeUserContent(userMessage.content),
			};

			if (userMessage.name !== null && userMessage.name !== undefined) {
				userResult.name = userMessage.name;
			}

			return userResult;
		}

		if (message.role === "system") {
			const systemMessage = message as SystemMessage;
			const systemResult: ChatCompletionSystemMessageParam = {
				role: "system",
				content: this.serializeSystemContent(systemMessage.content),
			};

			if (systemMessage.name !== null && systemMessage.name !== undefined) {
				systemResult.name = systemMessage.name;
			}

			return systemResult;
		}

		if (message.role === "assistant") {
			const assistantMessage = message as AssistantMessage;

			// Handle content serialization
			let content:
				| string
				| (ChatCompletionContentPartText | ChatCompletionContentPartRefusal)[]
				| null = null;
			if (
				assistantMessage.content !== null &&
				assistantMessage.content !== undefined
			) {
				content = this.serializeAssistantContent(assistantMessage.content);
			}

			const assistantResult: ChatCompletionAssistantMessageParam = {
				role: "assistant",
			};

			// Only add content if it's not null
			if (content !== null) {
				assistantResult.content = content;
			}

			if (
				assistantMessage.name !== null &&
				assistantMessage.name !== undefined
			) {
				assistantResult.name = assistantMessage.name;
			}
			if (
				assistantMessage.refusal !== null &&
				assistantMessage.refusal !== undefined
			) {
				assistantResult.refusal = assistantMessage.refusal;
			}
			if (assistantMessage.toolCalls && assistantMessage.toolCalls.length > 0) {
				assistantResult.tool_calls = assistantMessage.toolCalls.map((tc) =>
					this.serializeToolCall(tc),
				);
			}

			return assistantResult;
		}

		throw new Error(`Unknown message type: ${(message as any).role}`);
	}

	/**
	 * Serialize user message
	 */
	static serializeUserMessage(
		message: UserMessage,
	): ChatCompletionUserMessageParam {
		const result: ChatCompletionUserMessageParam = {
			role: "user",
			content: this.serializeUserContent(message.content),
		};

		if (message.name !== null && message.name !== undefined) {
			result.name = message.name;
		}

		return result;
	}

	/**
	 * Serialize system message
	 */
	static serializeSystemMessage(
		message: SystemMessage,
	): ChatCompletionSystemMessageParam {
		const result: ChatCompletionSystemMessageParam = {
			role: "system",
			content: this.serializeSystemContent(message.content),
		};

		if (message.name !== null && message.name !== undefined) {
			result.name = message.name;
		}

		return result;
	}

	/**
	 * Serialize assistant message
	 */
	static serializeAssistantMessage(
		message: AssistantMessage,
	): ChatCompletionAssistantMessageParam {
		const result: ChatCompletionAssistantMessageParam = {
			role: "assistant",
		};

		// Handle content serialization
		const content = this.serializeAssistantContent(message.content);
		if (content !== null) {
			result.content = content;
		}

		if (message.name !== null && message.name !== undefined) {
			result.name = message.name;
		}
		if (message.refusal !== null && message.refusal !== undefined) {
			result.refusal = message.refusal;
		}
		if (message.toolCalls && message.toolCalls.length > 0) {
			result.tool_calls = message.toolCalls.map((tc) =>
				this.serializeToolCall(tc),
			);
		}

		return result;
	}

	/**
	 * Serialize multiple messages
	 */
	static serializeMessages(
		messages: BaseMessage[],
	): ChatCompletionMessageParam[] {
		return messages.map((message) => {
			switch (message.role) {
				case "user":
					return this.serializeUserMessage(message as UserMessage);
				case "system":
					return this.serializeSystemMessage(message as SystemMessage);
				case "assistant":
					return this.serializeAssistantMessage(message as AssistantMessage);
				default:
					throw new Error(`Unknown message type: ${(message as any).role}`);
			}
		});
	}
}
