import fs from "fs";
import path from "path";
import type { BaseMessage } from "../../llm/messages";
import bnLogger from "../../logging_config";

const logger = bnLogger.child({
	module: "browsernode/agent/message_manager/utils",
});

/**
 * Save conversation history to file asynchronously.
 *
 * @param inputMessages - The input messages to save
 * @param response - The response to save
 * @param target - The target file path
 * @param encoding - The file encoding (defaults to 'utf-8')
 */
export async function saveConversation(
	inputMessages: BaseMessage[],
	response: any,
	target: string,
	encoding?: BufferEncoding,
): Promise<void> {
	// Create folders if not exists
	const dir = path.dirname(target);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const conversationContent = await formatConversation(inputMessages, response);

	await fs.promises.writeFile(target, conversationContent, {
		encoding: encoding || "utf-8",
	});
}

/**
 * Note: writeMessagesToFile and writeResponseToFile have been merged into formatConversation
 * This is more efficient for async operations and reduces file I/O
 */

/**
 * Format the conversation including messages and response.
 *
 * @param messages - The messages to format
 * @param response - The response to format
 * @returns The formatted conversation string
 */
async function formatConversation(
	messages: BaseMessage[],
	response: any,
): Promise<string> {
	const lines: string[] = [];

	// Format messages
	for (const message of messages) {
		lines.push(` ${message.constructor.name} `);
		if (Array.isArray(message.content)) {
			for (const item of message.content) {
				if (typeof item === "object" && item.type === "text") {
					lines.push(item.text.trim());
				}
			}
		} else if (typeof message.content === "string") {
			try {
				const content = JSON.parse(message.content);
				lines.push(JSON.stringify(content, null, 2));
			} catch {
				lines.push(message.content.trim());
			}
		}
		lines.push(""); // Empty line after each message
	}

	// Format response
	lines.push(" RESPONSE");
	const responseJson = JSON.parse(JSON.stringify(response));
	lines.push(JSON.stringify(responseJson, null, 2));

	return lines.join("\n");
}

// Extract JSON from model output
export function extractJsonFromModelOutput(
	content: string,
): Record<string, any> {
	try {
		let cleanedContent = content;

		// Debug: Log the original content to understand what we're dealing with
		logger.debug("Raw model output:", content.substring(0, 1000));
		logger.debug(
			`Raw model output length: ${content.length}, type: ${typeof content}`,
		);

		// Check for common problematic outputs
		if (
			content.includes("[object Object]") ||
			content.trim().startsWith("[object")
		) {
			logger.warn("Model returned [object Object] instead of JSON", {
				content: content.substring(0, 200),
			});
			throw new Error("Model returned [object Object] instead of valid JSON");
		}

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

		// Additional cleanup for potential issues with Gemini output
		// Remove any trailing/leading whitespace and newlines
		cleanedContent = cleanedContent.trim();

		// Debug: Log the cleaned content
		logger.debug(
			"Cleaned content for JSON parsing:",
			cleanedContent.substring(0, 500),
		);
		logger.debug(
			`Cleaned content starts with '{': ${cleanedContent.startsWith("{")}, ends with '}': ${cleanedContent.endsWith("}")}`,
		);

		// Try to parse and fix common issues
		try {
			const parsed = JSON.parse(cleanedContent);

			// Fix common Ollama issue: actions wrapped in paramModel
			if (parsed.action && Array.isArray(parsed.action)) {
				for (let i = 0; i < parsed.action.length; i++) {
					const action = parsed.action[i];
					// Check each action for incorrect paramModel wrapping
					for (const [actionName, actionParams] of Object.entries(action)) {
						if (
							actionParams &&
							typeof actionParams === "object" &&
							"paramModel" in actionParams &&
							Object.keys(actionParams).length === 1
						) {
							// Unwrap the paramModel
							action[actionName] = actionParams.paramModel;
							logger.debug(`Fixed paramModel wrapping in ${actionName} action`);
						}
					}
				}
			}

			return parsed;
		} catch (firstError) {
			// If first parse fails, try fixing common escape issues
			logger.debug(
				"First JSON parse failed, attempting to fix escape characters",
			);

			// First, fix invalid single quote escapes (common with Gemini)
			// JSON doesn't require single quotes to be escaped
			let fixedContent = cleanedContent.replace(/\\'/g, "'");

			// Fix common Gemini issue: extra closing brace after currentState
			// Pattern: "}}, "action"" should be "}, "action""
			fixedContent = fixedContent.replace(/\}\},\s*"action"/g, '}, "action"');

			// Fix missing commas after property values
			// Pattern: }"property" should be },"property"
			fixedContent = fixedContent.replace(/\}([^,\s}])"(\w+)"/g, '},$1"$2"');

			// Fix other missing commas between properties
			// Pattern: "value""nextProperty" should be "value","nextProperty"
			fixedContent = fixedContent.replace(
				/"([^"]+)"\s*"(\w+)":/g,
				'"$1", "$2":',
			);

			// Fix missing commas between array elements
			fixedContent = fixedContent.replace(/\}\s*\{/g, "}, {");

			// Fix common Ollama issue: extra closing braces at the end
			// Count opening and closing braces
			const openBraces = (fixedContent.match(/{/g) || []).length;
			const closeBraces = (fixedContent.match(/}/g) || []).length;

			if (closeBraces > openBraces) {
				// Remove extra closing braces from the end
				const extraBraces = closeBraces - openBraces;
				const lastBraceIndex = fixedContent.lastIndexOf("}");
				if (lastBraceIndex !== -1) {
					// Remove the extra closing braces
					fixedContent = fixedContent.substring(
						0,
						lastBraceIndex - extraBraces + 1,
					);
					logger.debug(`Removed ${extraBraces} extra closing braces from end`);
				}
			}

			// Log the fix for debugging
			if (cleanedContent !== fixedContent) {
				logger.debug("Fixed invalid escape sequences or structure in JSON");
			}

			// Don't modify valid escape sequences like \", \\, \n, \t, etc.

			try {
				return JSON.parse(fixedContent);
			} catch (secondError) {
				// If that also fails, try one more approach - extract JSON object manually
				logger.debug("Second JSON parse failed, attempting manual extraction");

				// Try to find the JSON object boundaries
				const openBrace = cleanedContent.indexOf("{");
				const closeBrace = cleanedContent.lastIndexOf("}");

				if (openBrace !== -1 && closeBrace !== -1 && closeBrace > openBrace) {
					const jsonCandidate = cleanedContent.substring(
						openBrace,
						closeBrace + 1,
					);
					try {
						return JSON.parse(jsonCandidate);
					} catch (thirdError) {
						// Try a more aggressive approach - find the first complete JSON object
						logger.debug(
							"Third JSON parse failed, attempting bracket matching",
						);

						let braceCount = 0;
						let jsonEnd = -1;
						let inString = false;
						let escapeNext = false;

						// Properly count braces, accounting for strings
						for (let i = openBrace; i < cleanedContent.length; i++) {
							const char = cleanedContent[i];

							if (escapeNext) {
								escapeNext = false;
								continue;
							}

							if (char === "\\") {
								escapeNext = true;
								continue;
							}

							if (char === '"' && !inString) {
								inString = true;
							} else if (char === '"' && inString) {
								inString = false;
							}

							if (!inString) {
								if (char === "{") {
									braceCount++;
								} else if (char === "}") {
									braceCount--;
									if (braceCount === 0) {
										jsonEnd = i;
										break;
									}
								}
							}
						}

						if (jsonEnd !== -1) {
							const jsonCandidate = cleanedContent.substring(
								openBrace,
								jsonEnd + 1,
							);
							try {
								return JSON.parse(jsonCandidate);
							} catch (fourthError) {
								logger.warn("All JSON parsing attempts failed", {
									firstError:
										firstError instanceof Error
											? firstError.message
											: String(firstError),
									secondError:
										secondError instanceof Error
											? secondError.message
											: String(secondError),
									thirdError:
										thirdError instanceof Error
											? thirdError.message
											: String(thirdError),
									fourthError:
										fourthError instanceof Error
											? fourthError.message
											: String(fourthError),
									content: cleanedContent.substring(0, 500), // Log first 500 chars for debugging
									originalContent: content.substring(0, 200), // Also log original content
								});
								throw firstError; // Throw the original error
							}
						} else {
							logger.warn("Could not find matching braces in content", {
								content: cleanedContent.substring(0, 200),
								hasOpenBrace: openBrace !== -1,
								hasCloseBrace: closeBrace !== -1,
							});
							throw firstError;
						}
					}
				} else {
					logger.warn("Could not find JSON object boundaries in content", {
						content: cleanedContent.substring(0, 200),
						openBraceIndex: openBrace,
						closeBraceIndex: closeBrace,
					});
					throw firstError;
				}
			}
		}
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

// export function convertInputMessages(
// 	inputMessages: BaseMessage[],
// 	modelName?: string,
// ): BaseMessage[] {
// 	if (!modelName) return inputMessages;

// 	if (
// 		modelName.includes("deepseek-reasoner") ||
// 		modelName.includes("deepseek-r1")
// 	) {
// 		let convertedMessages =
// 			convertMessagesForNonFunctionCallingModels(inputMessages);
// 		let mergedInputMessages = mergeSuccessiveMessages(
// 			convertedMessages,
// 			HumanMessage,
// 		);
// 		const mergedOutputMessages = mergeSuccessiveMessages(
// 			mergedInputMessages,
// 			AIMessage,
// 		);
// 		return mergedOutputMessages;
// 	}
// 	return inputMessages;
// }

// export function convertMessagesForNonFunctionCallingModels(
// 	inputMessages: BaseMessage[],
// ): BaseMessage[] {
// 	const outputMessages: BaseMessage[] = [];

// 	for (const message of inputMessages) {
// 		if (message instanceof HumanMessage) {
// 			outputMessages.push(message);
// 		} else if (message instanceof SystemMessage) {
// 			outputMessages.push(message);
// 		} else if (message instanceof ToolMessage) {
// 			outputMessages.push(new HumanMessage({ content: message.content }));
// 		} else if (message instanceof AIMessage) {
// 			if (message.tool_calls) {
// 				const toolCalls = JSON.stringify(message.tool_calls);
// 				outputMessages.push(new AIMessage({ content: toolCalls }));
// 			} else {
// 				outputMessages.push(message);
// 			}
// 		} else {
// 			throw new Error(`Unknown message type: ${typeof message}`);
// 		}
// 	}
// 	return outputMessages;
// }

// export function mergeSuccessiveMessages(
// 	messages: BaseMessage[],
// 	classToMerge: typeof BaseMessage,
// ): BaseMessage[] {
// 	const mergedMessages: BaseMessage[] = [];
// 	let streak = 0;

// 	for (const message of messages) {
// 		if (message instanceof classToMerge) {
// 			streak++;
// 			if (streak > 1) {
// 				if (Array.isArray(message.content)) {
// 					const contentItem = message.content[0];
// 					if (typeof contentItem === "object" && contentItem?.type === "text") {
// 						mergedMessages[mergedMessages.length - 1]!.content +=
// 							contentItem.text;
// 					}
// 				} else {
// 					mergedMessages[mergedMessages.length - 1]!.content += message.content;
// 				}
// 			} else {
// 				mergedMessages.push(message);
// 			}
// 		} else {
// 			mergedMessages.push(message);
// 			streak = 0;
// 		}
// 	}
// 	return mergedMessages;
// }

// // Save conversation to file
// export function saveConversation(
// 	inputMessages: BaseMessage[],
// 	response: any,
// 	target: string,
// 	encoding?: BufferEncoding,
// ): void {
// 	// Create folders if not exists
// 	const dir = path.dirname(target);
// 	if (!fs.existsSync(dir)) {
// 		fs.mkdirSync(dir, { recursive: true });
// 	}
// 	const writer = fs.createWriteStream(target, {
// 		encoding: encoding,
// 	});

// 	writeMessagesToFile(writer, inputMessages);
// 	writeResponseToFile(writer, response);

// 	writer.end();
// }

// export function writeMessagesToFile(
// 	writer: any,
// 	messages: BaseMessage[],
// ): void {
// 	for (const message of messages) {
// 		writer.write(` ${message.constructor.name} \n`);

// 		if (Array.isArray(message.content)) {
// 			for (const item of message.content) {
// 				if (typeof item === "object" && item.type === "text") {
// 					writer.write(`${item.text.trim()}\n`);
// 				}
// 			}
// 		} else if (typeof message.content === "string") {
// 			try {
// 				const content = JSON.parse(message.content);
// 				writer.write(`${JSON.stringify(content, null, 2)}\n`);
// 			} catch {
// 				writer.write(`${message.content.trim()}\n`);
// 			}
// 		}
// 		writer.write("\n");
// 	}
// }

// export function writeResponseToFile(writer: any, response: any): void {
// 	writer.write(" RESPONSE\n");
// 	const responseJson = JSON.parse(JSON.stringify(response));
// 	writer.write(JSON.stringify(responseJson, null, 2));
// }
