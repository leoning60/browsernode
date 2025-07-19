import {
	AIMessage,
	HumanMessage,
	BaseMessage as LangChainBaseMessage,
	SystemMessage,
} from "@langchain/core/messages";

import type { ToolCall as LangChainToolCall } from "@langchain/core/messages/tool";

import type {
	AssistantMessage,
	BaseMessage,
	SystemMessage as BrowserNodeSystemMessage,
	ContentImage,
	ContentRefusal,
	ContentText,
	ToolCall,
	UserMessage,
} from "browsernode/llm";

export class LangChainMessageSerializer {
	/**Serializer for converting between browsernode message types and LangChain message types.*/

	/**Convert user message content for LangChain compatibility.*/
	private static _serializeUserContent(
		content: string | Array<ContentText | ContentImage>,
	): string | Array<Record<string, any>> {
		if (typeof content === "string") {
			return content;
		}

		const serializedParts: Array<Record<string, any>> = [];
		for (const part of content) {
			if (part.type === "text") {
				serializedParts.push({
					type: "text",
					text: part.text,
				});
			} else if (part.type === "image_url") {
				// LangChain format for images
				serializedParts.push({
					type: "image_url",
					image_url: {
						url: part.imageUrl.url,
						detail: part.imageUrl.detail,
					},
				});
			}
		}

		return serializedParts;
	}

	/**Convert system message content to text string for LangChain compatibility.*/
	private static _serializeSystemContent(
		content: string | Array<ContentText>,
	): string {
		if (typeof content === "string") {
			return content;
		}

		const textParts: string[] = [];
		for (const part of content) {
			if (part.type === "text") {
				textParts.push(part.text);
			}
		}

		return textParts.join("\n");
	}

	/**Convert assistant message content to text string for LangChain compatibility.*/
	private static _serializeAssistantContent(
		content: string | Array<ContentText | ContentRefusal> | null,
	): string {
		if (content === null) {
			return "";
		}
		if (typeof content === "string") {
			return content;
		}

		const textParts: string[] = [];
		for (const part of content) {
			if (part.type === "text") {
				textParts.push(part.text);
			}
			// elif part.type == 'refusal':
			// 	// Include refusal content as text
			// 	textParts.push(`[Refusal: ${part.refusal}]`);
		}

		return textParts.join("\n");
	}

	/**Convert browser-use ToolCall to LangChain ToolCall.*/
	private static _serializeToolCall(toolCall: ToolCall): LangChainToolCall {
		// Parse the arguments string to a dict for LangChain
		let argsDict: Record<string, any>;
		try {
			argsDict = JSON.parse(toolCall.function.arguments);
		} catch (error) {
			// If parsing fails, wrap in a dict
			argsDict = { arguments: toolCall.function.arguments };
		}

		return {
			name: toolCall.function.name,
			args: argsDict,
			id: toolCall.id,
		};
	}

	// region - Serialize overloads
	static serialize(message: UserMessage): HumanMessage;
	static serialize(message: BrowserNodeSystemMessage): SystemMessage;
	static serialize(message: AssistantMessage): AIMessage;
	static serialize(message: BaseMessage): LangChainBaseMessage;
	/**Serialize a browsernode message to a LangChain message.*/
	static serialize(message: BaseMessage): LangChainBaseMessage {
		if (message.role === "user") {
			const userMessage = message as UserMessage;
			const content = LangChainMessageSerializer._serializeUserContent(
				userMessage.content,
			);
			return new HumanMessage({
				content: content as any,
				name: userMessage.name ?? undefined,
			});
		} else if (message.role === "system") {
			const systemMessage = message as BrowserNodeSystemMessage;
			const content = LangChainMessageSerializer._serializeSystemContent(
				systemMessage.content,
			);
			return new SystemMessage({
				content,
				name: systemMessage.name ?? undefined,
			});
		} else if (message.role === "assistant") {
			const assistantMessage = message as AssistantMessage;
			// Handle content
			const content = LangChainMessageSerializer._serializeAssistantContent(
				assistantMessage.content,
			);

			// Handle tool calls if present
			const toolCalls = assistantMessage.toolCalls?.map((toolCall) =>
				LangChainMessageSerializer._serializeToolCall(toolCall),
			);

			return new AIMessage({
				content,
				name: assistantMessage.name ?? undefined,
				tool_calls: toolCalls,
			});
		} else {
			throw new Error(`Unknown message type: ${(message as any).role}`);
		}
	}

	/**Serialize a list of browsernode messages to LangChain messages.*/
	static serializeMessages(messages: BaseMessage[]): LangChainBaseMessage[] {
		return messages.map((m) => LangChainMessageSerializer.serialize(m));
	}
}
