import { Anthropic } from "@anthropic-ai/sdk/client";
import type {
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartTextParam,
	SupportedImageMediaType,
	SystemMessage,
	UserMessage,
} from "../messages";

type Base64ImageSource = Anthropic.Base64ImageSource;
type CacheControlEphemeral = Anthropic.CacheControlEphemeral;
type ImageBlockParam = Anthropic.ImageBlockParam;
type MessageParam = Anthropic.MessageParam;
type TextBlockParam = Anthropic.TextBlockParam;
type ToolUseBlockParam = Anthropic.ToolUseBlockParam;
type URLImageSourceParam = Anthropic.URLImageSource;

type NonSystemMessage = UserMessage | AssistantMessage;

export class AnthropicMessageSerializer {
	/**Serializer for converting between custom message types and Anthropic message param types.*/

	static isBase64Image(url: string): boolean {
		/**Check if the URL is a base64 encoded image.*/
		return url.startsWith("data:image/");
	}

	static parseBase64Url(url: string): [SupportedImageMediaType, string] {
		/**Parse a base64 data URL to extract media type and data.*/
		// Format: data:image/jpeg;base64,<data>
		if (!url.startsWith("data:")) {
			throw new Error(`Invalid base64 URL: ${url}`);
		}

		const [header, data] = url.split(",", 2);
		if (!header || !data) {
			throw new Error(`Invalid base64 URL format: ${url}`);
		}
		let mediaType = header.split(";")[0]?.replace("data:", "") || "";

		// Ensure it's a supported media type
		const supportedTypes = [
			"image/jpeg",
			"image/png",
			"image/gif",
			"image/webp",
		];
		if (!supportedTypes.includes(mediaType)) {
			// Default to png if not recognized
			mediaType = "image/png";
		}

		return [mediaType as SupportedImageMediaType, data];
	}

	static serializeCacheControl(
		useCache: boolean,
	): CacheControlEphemeral | null {
		/**Serialize cache control.*/
		if (useCache) {
			return { type: "ephemeral" };
		}
		return null;
	}

	static serializeContentPartText(
		part: ContentPartTextParam,
		useCache: boolean,
	): TextBlockParam {
		/**Convert a text content part to Anthropic's TextBlockParam.*/
		return {
			text: part.text,
			type: "text",
			cache_control: AnthropicMessageSerializer.serializeCacheControl(useCache),
		};
	}

	static serializeContentPartImage(
		part: ContentPartImageParam,
	): ImageBlockParam {
		/**Convert an image content part to Anthropic's ImageBlockParam.*/
		const url = part.imageUrl.url;

		if (AnthropicMessageSerializer.isBase64Image(url)) {
			// Handle base64 encoded images
			const [mediaType, data] = AnthropicMessageSerializer.parseBase64Url(url);
			return {
				source: {
					data,
					media_type: mediaType,
					type: "base64",
				} as Base64ImageSource,
				type: "image",
			};
		} else {
			// Handle URL images
			return {
				source: {
					url,
					type: "url",
				} as URLImageSourceParam,
				type: "image",
			};
		}
	}

	static serializeContentToStr(
		content: string | ContentPartTextParam[],
		useCache: boolean = false,
	): TextBlockParam[] | string {
		/**Serialize content to a string.*/
		const cacheControl =
			AnthropicMessageSerializer.serializeCacheControl(useCache);

		if (typeof content === "string") {
			if (cacheControl) {
				return [{ text: content, type: "text", cache_control: cacheControl }];
			} else {
				return content;
			}
		}

		const serializedBlocks: TextBlockParam[] = [];
		for (const part of content) {
			if (part.type === "text") {
				serializedBlocks.push(
					AnthropicMessageSerializer.serializeContentPartText(part, useCache),
				);
			}
		}

		return serializedBlocks;
	}

	static serializeContent(
		content: string | (ContentPartTextParam | ContentPartImageParam)[],
		useCache: boolean = false,
	): string | (TextBlockParam | ImageBlockParam)[] {
		/**Serialize content to Anthropic format.*/
		if (typeof content === "string") {
			if (useCache) {
				return [
					{ text: content, type: "text", cache_control: { type: "ephemeral" } },
				];
			} else {
				return content;
			}
		}

		const serializedBlocks: (TextBlockParam | ImageBlockParam)[] = [];
		for (const part of content) {
			if (part.type === "text") {
				serializedBlocks.push(
					AnthropicMessageSerializer.serializeContentPartText(part, useCache),
				);
			} else if (part.type === "image_url") {
				serializedBlocks.push(
					AnthropicMessageSerializer.serializeContentPartImage(
						part as ContentPartImageParam,
					),
				);
			}
		}

		return serializedBlocks;
	}

	/**Convert tool calls to Anthropic's ToolUseBlockParam format.*/
	static serializeToolCallsToContent(
		toolCalls: any[],
		useCache: boolean = false,
	): ToolUseBlockParam[] {
		const blocks: ToolUseBlockParam[] = [];
		for (const toolCall of toolCalls) {
			// Parse the arguments JSON string to object
			let inputObj: any;
			try {
				inputObj = JSON.parse(toolCall.function.arguments);
			} catch (error) {
				// If arguments aren't valid JSON, use as string
				inputObj = { arguments: toolCall.function.arguments };
			}

			blocks.push({
				id: toolCall.id,
				input: inputObj,
				name: toolCall.function.name,
				type: "tool_use",
				cache_control:
					AnthropicMessageSerializer.serializeCacheControl(useCache),
			});
		}
		return blocks;
	}

	// region - Serialize overloads
	static serialize(message: UserMessage): MessageParam;
	static serialize(message: SystemMessage): SystemMessage;
	static serialize(message: AssistantMessage): MessageParam;
	static serialize(message: BaseMessage): MessageParam | SystemMessage {
		/**Serialize a custom message to an Anthropic MessageParam.

		Note: Anthropic doesn't have a 'system' role. System messages should be
		handled separately as the system parameter in the API call, not as a message.
		If a SystemMessage is passed here, it will be converted to a user message.
		*/
		if (message.role === "user") {
			const userMessage = message as UserMessage;
			const content = AnthropicMessageSerializer.serializeContent(
				userMessage.content,
				userMessage.cache || false,
			);
			return { role: "user", content };
		} else if (message.role === "system") {
			// Anthropic doesn't have system messages in the messages array
			// System prompts are passed separately. Convert to user message.
			return message as SystemMessage;
		} else if (message.role === "assistant") {
			const assistantMessage = message as AssistantMessage;
			// Handle content and tool calls
			const blocks: (TextBlockParam | ToolUseBlockParam)[] = [];

			// Add content blocks if present
			if (
				assistantMessage.content !== null &&
				assistantMessage.content !== undefined
			) {
				if (typeof assistantMessage.content === "string") {
					blocks.push({
						text: assistantMessage.content,
						type: "text",
						cache_control: AnthropicMessageSerializer.serializeCacheControl(
							assistantMessage.cache || false,
						),
					});
				} else {
					// Process content parts (text and refusal)
					for (const part of assistantMessage.content) {
						if (part.type === "text") {
							blocks.push(
								AnthropicMessageSerializer.serializeContentPartText(
									part,
									assistantMessage.cache || false,
								),
							);
						}
						// # Note: Anthropic doesn't have a specific refusal block type,
						// # so we convert refusals to text blocks
						// elif part.type == 'refusal':
						// 	blocks.append(TextBlockParam(text=f'[Refusal] {part.refusal}', type='text'))
					}
				}
			}

			// Add tool use blocks if present
			if (assistantMessage.toolCalls) {
				const toolBlocks =
					AnthropicMessageSerializer.serializeToolCallsToContent(
						assistantMessage.toolCalls,
						assistantMessage.cache || false,
					);
				blocks.push(...toolBlocks);
			}

			// If no content or tool calls, add empty text block
			// (Anthropic requires at least one content block)
			if (blocks.length === 0) {
				blocks.push({
					text: "",
					type: "text",
					cache_control: AnthropicMessageSerializer.serializeCacheControl(
						assistantMessage.cache || false,
					),
				});
			}

			// If caching is enabled or we have multiple blocks, return blocks as-is
			// Otherwise, simplify single text blocks to plain string
			let content: any;
			if (assistantMessage.cache || blocks.length > 1) {
				content = blocks;
			} else {
				// Only simplify when no caching and single block
				const singleBlock = blocks[0];
				if (
					singleBlock &&
					singleBlock.type === "text" &&
					!singleBlock.cache_control
				) {
					content = (singleBlock as TextBlockParam).text;
				} else {
					content = blocks;
				}
			}

			return {
				role: "assistant",
				content,
			};
		} else {
			throw new Error(`Unknown message type: ${(message as any).role}`);
		}
	}

	static cleanCacheMessages(messages: NonSystemMessage[]): NonSystemMessage[] {
		/**Clean cache settings so only the last cache=True message remains cached.

		Because of how Claude caching works, only the last cache message matters.
		This method automatically removes cache=True from all messages except the last one.

		Args:
			messages: List of non-system messages to clean

		Returns:
			List of messages with cleaned cache settings
		*/
		if (messages.length === 0) {
			return messages;
		}

		// Create a copy to avoid modifying the original
		const cleanedMessages = messages.map((msg) => ({ ...msg }));

		// Find the last message with cache=True
		let lastCacheIndex = -1;
		for (let i = cleanedMessages.length - 1; i >= 0; i--) {
			if (cleanedMessages[i]?.cache) {
				lastCacheIndex = i;
				break;
			}
		}

		// If we found a cached message, disable cache for all others
		if (lastCacheIndex !== -1) {
			for (let i = 0; i < cleanedMessages.length; i++) {
				if (i !== lastCacheIndex && cleanedMessages[i]?.cache) {
					// Set cache to False for all messages except the last cached one
					cleanedMessages[i]!.cache = false;
				}
			}
		}

		return cleanedMessages;
	}

	static serializeMessages(
		messages: BaseMessage[],
	): [MessageParam[], TextBlockParam[] | string | null] {
		/**Serialize a list of messages, extracting any system message.

		Returns:
		    A tuple of (messages, system_message) where system_message is extracted
		    from any SystemMessage in the list.
		*/
		const messagesCopy = messages.map((m) => ({ ...m }));

		// Separate system messages from normal messages
		const normalMessages: NonSystemMessage[] = [];
		let systemMessage: SystemMessage | null = null;

		for (const message of messagesCopy) {
			if (message.role === "system") {
				systemMessage = message as SystemMessage;
			} else {
				normalMessages.push(message as NonSystemMessage);
			}
		}

		// Clean cache messages so only the last cache=True message remains cached
		const cleanedNormalMessages =
			AnthropicMessageSerializer.cleanCacheMessages(normalMessages);

		// Serialize normal messages
		const serializedMessages: Anthropic.MessageParam[] = [];
		for (const message of cleanedNormalMessages) {
			if (message.role === "user") {
				serializedMessages.push(
					AnthropicMessageSerializer.serialize(message as UserMessage),
				);
			} else if (message.role === "assistant") {
				serializedMessages.push(
					AnthropicMessageSerializer.serialize(message as AssistantMessage),
				);
			}
		}

		// Serialize system message
		let serializedSystemMessage: TextBlockParam[] | string | null = null;
		if (systemMessage) {
			serializedSystemMessage =
				AnthropicMessageSerializer.serializeContentToStr(
					systemMessage.content,
					systemMessage.cache || false,
				);
		}

		return [serializedMessages, serializedSystemMessage];
	}
}
