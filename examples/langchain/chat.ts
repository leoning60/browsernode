import { BaseChatModel as LangChainBaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage as LangChainAIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "browsernode/llm";
import { ModelProviderError } from "browsernode/llm";
import type { ChatInvokeCompletion, ChatInvokeUsage } from "browsernode/llm";
import { extractJsonFromModelOutput } from "../../src/agent/message_manager/utils";
import { SchemaOptimizer } from "../../src/llm/schema";
import { LangChainMessageSerializer } from "./serializer";

/**
 * A wrapper around LangChain BaseChatModel that implements the browsernode BaseChatModel protocol.
 *
 * This class allows you to use any LangChain-compatible model with browsernode.
 */
export class ChatLangchain {
	// The LangChain model to wrap
	chat: LangChainBaseChatModel;

	constructor(chat: LangChainBaseChatModel) {
		this.chat = chat;
	}

	get model(): string {
		return this.name;
	}

	/**Return the provider name based on the LangChain model class.*/
	get provider(): string {
		const modelClassName = this.chat.constructor.name.toLowerCase();
		if (modelClassName.includes("openai")) {
			return "openai";
		} else if (
			modelClassName.includes("anthropic") ||
			modelClassName.includes("claude")
		) {
			return "anthropic";
		} else if (
			modelClassName.includes("google") ||
			modelClassName.includes("gemini")
		) {
			return "google";
		} else if (modelClassName.includes("groq")) {
			return "groq";
		} else if (modelClassName.includes("ollama")) {
			return "ollama";
		} else if (modelClassName.includes("deepseek")) {
			return "deepseek";
		} else {
			return "langchain";
		}
	}

	/**Return the model name.*/
	get name(): string {
		// Try to get model name from the LangChain model using property access to avoid type errors
		const modelName = (this.chat as any).modelName;
		if (modelName) {
			return String(modelName);
		}

		const modelAttr = (this.chat as any).model;
		if (modelAttr) {
			return String(modelAttr);
		}

		return this.chat.constructor.name;
	}

	private getUsage(response: LangChainAIMessage): ChatInvokeUsage | null {
		const usage = (response as any).usage_metadata;
		if (usage === null || usage === undefined) {
			return null;
		}

		const promptTokens = usage.input_tokens || 0;
		const completionTokens = usage.output_tokens || 0;
		const totalTokens = usage.total_tokens || 0;

		const inputTokenDetails = usage.input_token_details;

		let promptCachedTokens: number | null = null;
		let promptCacheCreationTokens: number | null = null;

		if (inputTokenDetails !== null && inputTokenDetails !== undefined) {
			promptCachedTokens = inputTokenDetails.cache_read || null;
			promptCacheCreationTokens = inputTokenDetails.cache_creation || null;
		}

		return {
			promptTokens,
			promptCachedTokens,
			promptCacheCreationTokens,
			promptImageTokens: null,
			completionTokens,
			totalTokens,
		} as ChatInvokeUsage;
	}

	// Overload signatures
	async ainvoke(messages: BaseMessage[]): Promise<ChatInvokeCompletion<string>>;
	async ainvoke<T>(
		messages: BaseMessage[],
		outputFormat: new (...args: any[]) => T,
	): Promise<ChatInvokeCompletion<T>>;
	async ainvoke<T>(
		messages: BaseMessage[],
		outputFormat?: new (...args: any[]) => T,
	): Promise<ChatInvokeCompletion<T> | ChatInvokeCompletion<string>> {
		/**
		 * Invoke the LangChain model with the given messages.
		 *
		 * @param:
		 *     messages: List of browsernode chat messages
		 *     outputFormat: Optional constructor function for structured output (not supported in basic LangChain integration)
		 *
		 * @returns:
		 *     Either a string response or an instance of outputFormat
		 */

		// Convert browsernode messages to LangChain messages
		const langchainMessages =
			LangChainMessageSerializer.serializeMessages(messages);
		// console.log(
		// 	"---->ChatLangchain ainvoke langchainMessages:",
		// 	JSON.stringify(langchainMessages, null, 2),
		// );

		try {
			if (outputFormat === undefined || outputFormat === null) {
				// Return string response
				const response = (await this.chat.invoke(
					langchainMessages,
				)) as LangChainAIMessage;
				if (!(response instanceof LangChainAIMessage)) {
					throw new ModelProviderError(
						`Response is not an AIMessage: ${typeof response}`,
						502,
						this.name,
					);
				}

				// Extract content from LangChain response
				const content = (response as LangChainAIMessage).content
					? (response as LangChainAIMessage).content
					: String(response);

				const usage = this.getUsage(response);
				return {
					completion: String(content),
					usage,
				} as ChatInvokeCompletion;
			} else {
				// Use LangChain's structured output capability
				// console.log(
				// 	"---->ChatLangchain ainvoke outputFormat:",
				// 	outputFormat
				// 		? `[Function: ${outputFormat.name || "anonymous"}]`
				// 		: "undefined",
				// );
				try {
					// Use SchemaOptimizer to get the proper schema, similar to other LLM implementations
					const jsonSchema =
						SchemaOptimizer.createOptimizedJsonSchema(outputFormat);
					// console.log(
					// 	"---->ChatLangchain ainvoke jsonSchema from SchemaOptimizer:",
					// 	JSON.stringify(jsonSchema, null, 2),
					// );

					// Try different approaches based on the LangChain model type
					let structuredChat;
					try {
						// First try with the JSON schema directly
						structuredChat = this.chat.withStructuredOutput(jsonSchema);
					} catch (schemaError) {
						// console.log(
						// 	"---->ChatLangchain ainvoke fallback to outputFormat class:",
						// 	schemaError,
						// );
						// If that fails, try with the class directly (some LangChain models might prefer this)
						structuredChat = this.chat.withStructuredOutput(outputFormat);
					}

					// console.log(
					// 	"---->ChatLangchain ainvoke structuredChat:",
					// 	JSON.stringify(structuredChat, null, 2),
					// );
					const parsedObject = await structuredChat.invoke(langchainMessages);
					// console.log(
					// 	"---->ChatLangchain ainvoke parsedObject:",
					// 	JSON.stringify(parsedObject, null, 2),
					// );

					// For structured output, usage metadata is typically not available
					// in the parsed object since it's a constructor result, not an AIMessage
					const usage = null;

					// Type cast since LangChain's withStructuredOutput returns the correct type
					return {
						completion: parsedObject as T,
						usage,
					} as ChatInvokeCompletion;
				} catch (attributeError) {
					// Fall back to manual parsing if withStructuredOutput is not available
					// console.error(
					// 	`---->ChatLangchain ainvoke fallback to manual parsing: ${attributeError}`,
					// );
					const response = (await this.chat.invoke(
						langchainMessages,
					)) as LangChainAIMessage;

					if (!(response instanceof LangChainAIMessage)) {
						throw new ModelProviderError(
							`Response is not an AIMessage: ${typeof response}`,
							502,
							this.name,
						);
					}

					const content = (response as LangChainAIMessage).content
						? (response as LangChainAIMessage).content
						: String(response);

					try {
						if (typeof content === "string") {
							// Try to extract JSON from the content using the utility function
							const extractedJson = extractJsonFromModelOutput(content);
							if (extractedJson && typeof extractedJson === "object") {
								// For AgentOutput, ensure proper field mapping
								if (
									outputFormat.name === "CustomAgentOutput" ||
									outputFormat.name === "AgentOutput"
								) {
									// Map the fields correctly for AgentOutput
									const mappedJson = {
										evaluationPreviousGoal:
											extractedJson.evaluationPreviousGoal || "Unknown",
										memory: extractedJson.memory || "",
										nextGoal: extractedJson.nextGoal || "",
										action: extractedJson.action || [],
										thinking: extractedJson.thinking || null,
									};

									// If action is empty, add a default action to prevent error
									if (!mappedJson.action || mappedJson.action.length === 0) {
										console.warn(
											"No actions found in model output, adding default wait action",
										);
										mappedJson.action = [{ wait: { seconds: 1 } }];
									}

									const parsedObject = new outputFormat(
										mappedJson.evaluationPreviousGoal,
										mappedJson.memory,
										mappedJson.nextGoal,
										mappedJson.action,
										mappedJson.thinking,
									);
									const usage = this.getUsage(response);
									return {
										completion: parsedObject as T,
										usage,
									} as ChatInvokeCompletion;
								} else {
									// For other types, use the extracted JSON directly
									const parsedObject = new outputFormat(extractedJson);
									const usage = this.getUsage(response);
									return {
										completion: parsedObject as T,
										usage,
									} as ChatInvokeCompletion;
								}
							} else {
								throw new Error("Parsed JSON is not a dictionary");
							}
						} else {
							throw new Error(
								"Content is not a string and structured output not supported",
							);
						}
					} catch (parseError) {
						throw new ModelProviderError(
							`Failed to parse response as ${outputFormat.name}: ${parseError}`,
							502,
							this.name,
						);
					}
				}
			}
		} catch (e) {
			// Convert any LangChain errors to browsernode ModelProviderError
			throw new ModelProviderError(
				`LangChain model error: ${String(e)}`,
				502,
				this.name,
			);
		}
	}
}
