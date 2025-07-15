import { Anthropic } from "@anthropic-ai/sdk";

import {
	APIConnectionError,
	APIConnectionTimeoutError,
	APIError,
	APIUserAbortError,
	AnthropicError,
	AuthenticationError,
	BadRequestError,
	ConflictError,
	InternalServerError,
	NotFoundError,
	PermissionDeniedError,
	RateLimitError,
	UnprocessableEntityError,
} from "@anthropic-ai/sdk";

import type { BaseChatModel } from "../base";
import { ModelProviderError, ModelRateLimitError } from "../exceptions";
import type { BaseMessage } from "../messages";
import { SchemaOptimizer } from "../schema";
import type { ChatInvokeCompletion, ChatInvokeUsage } from "../views";
import { AnthropicMessageSerializer } from "./serializer";

type CacheControlEphemeral = Anthropic.CacheControlEphemeral;
type MessageParam = Anthropic.MessageParam;
type Tool = Anthropic.Tool;
type ModelParam = Anthropic.Model;
type TextBlock = Anthropic.TextBlock;
type ToolChoiceToolParam = Anthropic.ToolChoiceTool;

interface ChatAnthropicConfig {
	// Model configuration
	model: string | ModelParam;
	maxTokens?: number;
	temperature?: number | null;

	// Client initialization parameters
	apiKey?: string | null;
	authToken?: string | null;
	baseUrl?: string | URL | null;
	timeout?: number | null;
	maxRetries?: number;
	defaultHeaders?: Record<string, string> | null;
	defaultQuery?: Record<string, unknown> | null;
}

/**
 * A wrapper around Anthropic's chat model.
 */
export class ChatAnthropic implements BaseChatModel {
	// Model configuration
	model: string | ModelParam;
	maxTokens: number = 8192;
	temperature: number | null = null;

	// Client initialization parameters
	apiKey: string | null = null;
	authToken: string | null = null;
	baseUrl: string | URL | null = null;
	timeout: number | null = null;
	maxRetries: number = 10;
	defaultHeaders: Record<string, string> | null = null;
	defaultQuery: Record<string, unknown> | null = null;

	constructor(config: ChatAnthropicConfig) {
		this.model = config.model;
		this.maxTokens = config.maxTokens ?? 8192;
		this.temperature = config.temperature ?? null;
		this.apiKey = config.apiKey ?? null;
		this.authToken = config.authToken ?? null;
		this.baseUrl = config.baseUrl ?? null;
		this.timeout = config.timeout ?? null;
		this.maxRetries = config.maxRetries ?? 10;
		this.defaultHeaders = config.defaultHeaders ?? null;
		this.defaultQuery = config.defaultQuery ?? null;
	}

	// Static
	get provider(): string {
		return "anthropic";
	}

	private _getClientParams(): Record<string, unknown> {
		/**Prepare client parameters dictionary.*/
		// Define base client params
		const baseParams = {
			api_key: this.apiKey,
			auth_token: this.authToken,
			base_url: this.baseUrl,
			timeout: this.timeout,
			max_retries: this.maxRetries,
			default_headers: this.defaultHeaders,
			default_query: this.defaultQuery,
		};

		// Create clientParams dict with non-null values
		const clientParams: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(baseParams)) {
			if (v !== null && v !== undefined) {
				clientParams[k] = v;
			}
		}

		return clientParams;
	}

	private _getClientParamsForInvoke(): Record<string, unknown> {
		/**Prepare client parameters dictionary for invoke.*/

		const clientParams: Record<string, unknown> = {};

		if (this.temperature !== null) {
			clientParams["temperature"] = this.temperature;
		}

		// maxTokens is always a number, so always include it
		clientParams["max_tokens"] = this.maxTokens;

		return clientParams;
	}

	getClient(): Anthropic {
		/**
		 * Returns an Anthropic client.
		 *
		 * Returns:
		 *     Anthropic: An instance of the Anthropic client.
		 */
		const clientParams = this._getClientParams();
		return new Anthropic(clientParams as any);
	}

	get name(): string {
		return String(this.model);
	}

	private _getUsage(response: Anthropic.Message): ChatInvokeUsage | null {
		const usage: ChatInvokeUsage = {
			promptTokens:
				response.usage.input_tokens +
				(response.usage.cache_read_input_tokens || 0), // Total tokens in Anthropic are a bit fucked, you have to add cached tokens to the prompt tokens
			completionTokens: response.usage.output_tokens,
			totalTokens: response.usage.input_tokens + response.usage.output_tokens,
			promptCachedTokens: response.usage.cache_read_input_tokens,
			promptCacheCreationTokens: response.usage.cache_creation_input_tokens,
			promptImageTokens: null,
		};
		return usage;
	}

	async ainvoke<T = string>(
		messages: BaseMessage[],
		outputFormat?: new () => T,
	): Promise<ChatInvokeCompletion<T> | ChatInvokeCompletion<string>> {
		const [anthropicMessages, systemPrompt] =
			AnthropicMessageSerializer.serializeMessages(messages);

		try {
			if (outputFormat === undefined) {
				// Normal completion without structured output
				const response = await this.getClient().messages.create({
					model: this.model as string,
					messages: anthropicMessages,
					system: systemPrompt || undefined,
					max_tokens: this.maxTokens,
					...this._getClientParamsForInvoke(),
				});

				const usage = this._getUsage(response);

				// Extract text from the first content block
				const firstContent = response.content[0];
				let responseText: string;
				if (firstContent && "text" in firstContent) {
					responseText = firstContent.text;
				} else {
					// If it's not a text block, convert to string
					responseText = String(firstContent);
				}

				return {
					completion: responseText,
					usage,
				} as ChatInvokeCompletion<string>;
			} else {
				// Use tool calling for structured output
				// Create a tool that represents the output format
				const toolName = outputFormat.name;
				const schema = SchemaOptimizer.createOptimizedJsonSchema(outputFormat);

				// Remove title from schema if present (Anthropic doesn't like it in parameters)
				if ("title" in schema) {
					delete schema.title;
				}

				const tool: Tool = {
					name: toolName,
					description: `Extract information in the format of ${toolName}`,
					input_schema: {
						type: "object",
						...schema,
					},
					cache_control: { type: "ephemeral" },
				};

				// Force the model to use this tool
				const toolChoice: ToolChoiceToolParam = {
					type: "tool",
					name: toolName,
				};

				const response = await this.getClient().messages.create({
					model: this.model as string,
					messages: anthropicMessages,
					tools: [tool],
					system: systemPrompt || undefined,
					tool_choice: toolChoice,
					max_tokens: this.maxTokens,
					...this._getClientParamsForInvoke(),
				});

				const usage = this._getUsage(response);

				// Extract the tool use block
				for (const contentBlock of response.content) {
					if ("type" in contentBlock && contentBlock.type === "tool_use") {
						// Parse the tool input as the structured output
						try {
							return {
								completion: new outputFormat() as T,
								usage,
							} as ChatInvokeCompletion<T>;
						} catch (e) {
							// If validation fails, try to parse it as JSON first
							if (typeof contentBlock.input === "string") {
								const data = JSON.parse(contentBlock.input);
								return {
									completion: data as T,
									usage,
								} as ChatInvokeCompletion<T>;
							}
							throw e;
						}
					}
				}

				// If no tool use block found, raise an error
				throw new Error("Expected tool use in response but none found");
			}
		} catch (error) {
			if (error instanceof APIConnectionError) {
				throw new ModelProviderError(error.message, 502, this.name);
			} else if (error instanceof RateLimitError) {
				throw new ModelRateLimitError(error.message, 429, this.name);
			} else if (error instanceof AnthropicError) {
				throw new ModelProviderError(error.message, 502, this.name);
			} else {
				throw new ModelProviderError(String(error), 502, this.name);
			}
		}
	}
}
