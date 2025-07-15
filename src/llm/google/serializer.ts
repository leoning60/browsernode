import {
	type Content,
	type ContentListUnion,
	type Part,
	createPartFromBase64,
	createPartFromText,
} from "@google/genai";

import type {
	AssistantMessage,
	BaseMessage,
	ContentPartImageParam,
	ContentPartTextParam,
	SupportedImageMediaType,
	SystemMessage,
	UserMessage,
} from "../messages";

/**
 * Serializer for converting messages to Google Gemini format.
 */
export class GoogleMessageSerializer {
	static serializeMessages(
		messages: BaseMessage[],
	): [ContentListUnion, string | null] {
		/**
		 * Convert a list of BaseMessages to Google format, extracting system message.
		 *
		 * Google handles system instructions separately from the conversation, so we need to:
		 * 1. Extract any system messages and return them separately as a string
		 * 2. Convert the remaining messages to Content objects
		 *
		 * @param messages: List of messages to convert
		 *
		 * @returns:
		 *     A tuple of (formattedMessages, systemMessage) where:
		 *     - formattedMessages: List of Content objects for the conversation
		 *     - systemMessage: System instruction string or None
		 */

		messages = structuredClone(messages);

		const formattedMessages: ContentListUnion = [];
		let systemMessage: string | null = null;

		for (const message of messages) {
			const role = message.role || null;

			// Handle system/developer messages
			if (message.role === "system" || ["developer", "system"].includes(role)) {
				// Extract system message content as string
				if (typeof message.content === "string") {
					systemMessage = message.content;
				} else if (message.content !== null && message.content !== undefined) {
					// Handle Iterable of content parts
					const parts: string[] = [];
					for (const part of message.content) {
						if (part.type === "text") {
							parts.push(part.text);
						}
					}
					systemMessage = parts.join("\n");
				}
				continue;
			}

			// Determine the role for non-system messages
			let messageRole: string;
			if (message.role === "user") {
				messageRole = "user";
			} else if (message.role === "assistant") {
				messageRole = "model";
			} else {
				// Default to user for any unknown message types
				messageRole = "user";
			}

			// Initialize message parts
			let messageParts: Part[] = [];

			// Extract content and create parts
			if (typeof message.content === "string") {
				// Regular text content
				messageParts = [createPartFromText(message.content)];
			} else if (message.content !== null && message.content !== undefined) {
				// Handle Iterable of content parts
				for (const part of message.content) {
					if (part.type === "text") {
						messageParts.push(createPartFromText(part.text));
					} else if (part.type === "refusal") {
						messageParts.push(createPartFromText(`[Refusal] ${part.refusal}`));
					} else if (part.type === "image_url") {
						// Handle images
						const url = part.imageUrl.url;

						// Format: data:image/png;base64,<data>
						const [header, data] = url.split(",", 2);
						// Use the base64 data directly
						if (!data) continue;
						const imageBytes = Buffer.from(data, "utf8").toString("base64");

						// Add image part
						const imagePart = createPartFromBase64(imageBytes, "image/png");

						messageParts.push(imagePart);
					}
				}
			}

			// Create the Content object
			if (messageParts.length > 0) {
				const finalMessage = {
					role: messageRole,
					parts: messageParts,
				} as Content;
				formattedMessages.push(finalMessage);
			}
		}

		return [formattedMessages, systemMessage];
	}
}
