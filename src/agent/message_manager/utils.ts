import fs from "fs";
import path from "path";
import {
	AIMessage,
	BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import bnLogger from "../../logging_config";

const logger = bnLogger.child({
	module: "browser_node/agent/message_manager/utils",
});

// Extract JSON from model output
export function extractJsonFromModelOutput(
	content: string,
): Record<string, any> {
	try {
		let cleanedContent = content;

		if (content.includes("```json")) {
			// extract the content between ```json and ```
			const matches = content.match(/```json\s*([\s\S]*?)\s*```/);
			if (matches && matches[1]) {
				cleanedContent = matches[1].trim();
			}
		} else if (content.includes("```")) {
			// try to extract the content between ``` and ```
			const matches = content.match(/```\s*([\s\S]*?)\s*```/);
			if (matches && matches[1]) {
				cleanedContent = matches[1].trim();
			}
		}
		return JSON.parse(cleanedContent);
	} catch (e: any) {
		logger.warn("Failed to parse model output", e);
		throw new Error("Could not parse response.");
	}
}

/**
 * Convert input messages to a format that is compatible with the planner model
 *
 * @param inputMessages - The input messages to convert
 * @param modelName - The name of the model to convert the messages for
 * @returns The converted messages
 */
export function convertInputMessages(
	inputMessages: BaseMessage[],
	modelName?: string,
): BaseMessage[] {
	if (!modelName) return inputMessages;

	if (
		modelName.includes("deepseek-reasoner") ||
		modelName.includes("deepseek-r1")
	) {
		let convertedMessages =
			convertMessagesForNonFunctionCallingModels(inputMessages);
		let mergedInputMessages = mergeSuccessiveMessages(
			convertedMessages,
			HumanMessage,
		);
		const mergedOutputMessages = mergeSuccessiveMessages(
			mergedInputMessages,
			AIMessage,
		);
		return mergedOutputMessages;
	}
	return inputMessages;
}

export function convertMessagesForNonFunctionCallingModels(
	inputMessages: BaseMessage[],
): BaseMessage[] {
	const outputMessages: BaseMessage[] = [];

	for (const message of inputMessages) {
		if (message instanceof HumanMessage) {
			outputMessages.push(message);
		} else if (message instanceof SystemMessage) {
			outputMessages.push(message);
		} else if (message instanceof ToolMessage) {
			outputMessages.push({ content: message.content } as HumanMessage);
		} else if (message instanceof AIMessage) {
			if (message.tool_calls) {
				const toolCalls = JSON.stringify(message.tool_calls);
				outputMessages.push({ content: toolCalls } as AIMessage);
			} else {
				outputMessages.push(message);
			}
		} else {
			throw new Error(`Unknown message type: ${typeof message}`);
		}
	}
	return outputMessages;
}

export function mergeSuccessiveMessages(
	messages: BaseMessage[],
	classToMerge: typeof BaseMessage,
): BaseMessage[] {
	const mergedMessages: BaseMessage[] = [];
	let streak = 0;

	for (const message of messages) {
		if (message instanceof classToMerge) {
			streak++;
			if (streak > 1) {
				if (Array.isArray(message.content)) {
					const contentItem = message.content[0];
					if (typeof contentItem === "object" && contentItem?.type === "text") {
						mergedMessages[mergedMessages.length - 1]!.content +=
							contentItem.text;
					}
				} else {
					mergedMessages[mergedMessages.length - 1]!.content += message.content;
				}
			} else {
				mergedMessages.push(message);
			}
		} else {
			mergedMessages.push(message);
			streak = 0;
		}
	}
	return mergedMessages;
}

// Save conversation to file
export function saveConversation(
	inputMessages: BaseMessage[],
	response: any,
	target: string,
	encoding?: BufferEncoding,
): void {
	// Create folders if not exists
	const dir = path.dirname(target);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	const writer = fs.createWriteStream(target, {
		encoding: encoding,
	});

	writeMessagesToFile(writer, inputMessages);
	writeResponseToFile(writer, response);

	writer.end();
}

export function writeMessagesToFile(
	writer: any,
	messages: BaseMessage[],
): void {
	for (const message of messages) {
		writer.write(` ${message.constructor.name} \n`);

		if (Array.isArray(message.content)) {
			for (const item of message.content) {
				if (typeof item === "object" && item.type === "text") {
					writer.write(`${item.text.trim()}\n`);
				}
			}
		} else if (typeof message.content === "string") {
			try {
				const content = JSON.parse(message.content);
				writer.write(`${JSON.stringify(content, null, 2)}\n`);
			} catch {
				writer.write(`${message.content.trim()}\n`);
			}
		}
		writer.write("\n");
	}
}

export function writeResponseToFile(writer: any, response: any): void {
	writer.write(" RESPONSE\n");
	const responseJson = JSON.parse(JSON.stringify(response));
	writer.write(JSON.stringify(responseJson, null, 2));
}
