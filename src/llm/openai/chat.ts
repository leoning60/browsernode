// Import OpenAI types
import { APIConnectionError, APIError, OpenAI, RateLimitError } from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ChatModel } from "openai/resources/shared";
import type { ReasoningEffort } from "openai/resources/shared";
import type { ResponseFormatJSONSchema } from "openai/resources/shared";
import { z } from "zod";
// import { Client as UndiciClient } from "undici";

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { modelValidateJson } from "../../bn_utils";
import type { BaseChatModel } from "../base";
import { ModelProviderError } from "../exceptions";
import type { BaseMessage } from "../messages";
import { SchemaOptimizer } from "../schema";
import type { ChatInvokeCompletion, ChatInvokeUsage } from "../views";
import { OpenAIMessageSerializer } from "./serializer";

type JSONSchema = ResponseFormatJSONSchema.JSONSchema;

const ReasoningModels: Array<ChatModel | string> = [
	"o4-mini",
	"o3",
	"o3-mini",
	"o1",
	"o1-pro",
	"o3-pro",
];

/**
 * A wrapper around AsyncOpenAI that implements the BaseLLM protocol.
 *
 * This class accepts all OpenAI parameters while adding model
 * and temperature parameters for the LLM interface.
 */

export interface OpenAIBaseInput {
	model: ChatModel | string;
	temperature?: number | null;
	reasoningEffort?: ReasoningEffort;
	apiKey?: string | null;
	organization?: string | null;
	project?: string | null;
	baseUrl?: string | URL | null;
	websocketBaseUrl?: string | URL | null;
	timeout?: number | null;
	maxRetries?: number;
	defaultHeaders?: Record<string, string> | null;
	defaultQuery?: Record<string, any> | null;
	httpClient?: typeof fetch | null;
	strictResponseValidation?: boolean;
}

export class ChatOpenAI implements BaseChatModel {
	model: ChatModel | string;

	// Model params
	temperature?: number | null;
	reasoningEffort?: ReasoningEffort;

	// Client initialization parameters
	apiKey?: string | null;
	organization?: string | null;
	project?: string | null;
	baseUrl?: string | URL | null;
	websocketBaseUrl?: string | URL | null;
	timeout?: number | null;
	maxRetries?: number;
	defaultHeaders?: Record<string, string> | null;
	defaultQuery?: Record<string, any> | null;
	httpClient?: typeof fetch | null;
	strictResponseValidation?: boolean;

	constructor(config: OpenAIBaseInput) {
		this.model = config.model;
		this.temperature = config.temperature;
		this.reasoningEffort = config.reasoningEffort;
		this.apiKey = config.apiKey;
		this.organization = config.organization;
		this.project = config.project;
		this.baseUrl = config.baseUrl;
		this.websocketBaseUrl = config.websocketBaseUrl;
		this.timeout = config.timeout;
		this.maxRetries = config.maxRetries;
		this.defaultHeaders = config.defaultHeaders;
		this.defaultQuery = config.defaultQuery;
		this.httpClient = config.httpClient;
		this.strictResponseValidation = config.strictResponseValidation;
	}

	get provider(): string {
		return "openai";
	}

	get modelName(): string {
		return this.model;
	}

	getClientParams(): Record<string, any> {
		const baseParams = {
			apiKey: this.apiKey,
			organization: this.organization,
			project: this.project,
			baseUrl: this.baseUrl,
			websocketBaseUrl: this.websocketBaseUrl,
			timeout: this.timeout,
			maxRetries: this.maxRetries || 10, // Increase default retries for automation reliability
			defaultHeaders: this.defaultHeaders,
			defaultQuery: this.defaultQuery,
			strictResponseValidation: this.strictResponseValidation || false,
		};

		// Create client params dict with non-null values
		const clientParams: Record<string, any> = {};
		for (const [key, value] of Object.entries(baseParams)) {
			if (value !== null && value !== undefined) {
				clientParams[key] = value;
			}
		}

		// Add httpClient if provided
		if (this.httpClient !== null && this.httpClient !== undefined) {
			clientParams.httpClient = this.httpClient;
		}

		return clientParams;
	}

	/**
	 * Returns an OpenAI client.
	 *
	 * @returns
	 * 	OpenAI: An instance of the OpenAI client.
	 */
	getClient(): OpenAI {
		const clientParams = this.getClientParams();
		return new OpenAI(clientParams);
	}

	get name(): string {
		return this.model;
	}

	getUsage(response: ChatCompletion): ChatInvokeUsage | null {
		if (response.usage) {
			let completionTokens = response.usage.completion_tokens;
			const completionTokenDetails = response.usage.completion_tokens_details;

			if (completionTokenDetails) {
				const reasoningTokens = completionTokenDetails.reasoning_tokens;
				if (reasoningTokens) {
					completionTokens += reasoningTokens;
				}
			}

			const usage: ChatInvokeUsage = {
				promptTokens: response.usage.prompt_tokens,
				promptCachedTokens: response.usage.prompt_tokens_details
					? response.usage.prompt_tokens_details.cached_tokens
					: null,
				promptCacheCreationTokens: null,
				promptImageTokens: null,
				completionTokens: completionTokens,
				totalTokens: response.usage.total_tokens,
			};

			return usage;
		} else return null;
	}

	async ainvoke(
		messages: BaseMessage[],
		outputFormat?: undefined,
	): Promise<ChatInvokeCompletion<string>>;
	async ainvoke<T>(
		messages: BaseMessage[],
		outputFormat: new (...args: any[]) => T,
	): Promise<ChatInvokeCompletion<T>>;

	/**
	 * Invoke the model with the given messages.
	 *
	 * @param messages
	 * 	List of chat messages
	 * @param outputFormat
	 * 	Optional Pydantic model class for structured output
	 * @returns
	 * 	Either a string response or an instance of output_format
	 */
	async ainvoke<T>(
		messages: BaseMessage[],
		outputFormat?: (new (...args: any[]) => T) | undefined,
	): Promise<ChatInvokeCompletion<T> | ChatInvokeCompletion<string>> {
		const openaiMessages: ChatCompletionMessageParam[] =
			OpenAIMessageSerializer.serializeMessages(messages);
		try {
			let reasoningEffortDict: Record<string, any> | undefined = undefined;
			if (ReasoningModels.includes(this.model)) {
				reasoningEffortDict = { reasoning_effort: this.reasoningEffort };
			}

			if (!outputFormat) {
				// Return string response
				const response = await this.getClient().chat.completions.create({
					model: this.model,
					messages: openaiMessages,
					temperature: this.temperature,
					...reasoningEffortDict,
				});

				if (!response.choices || response.choices.length === 0) {
					throw new ModelProviderError(
						"No response choices received from model",
						500,
						this.name,
					);
				}

				const usage = this.getUsage(response);
				const firstChoice = response.choices[0];
				if (!firstChoice) {
					throw new ModelProviderError(
						"No response choice received from model",
						500,
						this.name,
					);
				}
				return {
					completion: firstChoice.message.content || "",
					usage,
				} as ChatInvokeCompletion;
			} else {
				// Return structured response
				const responseFormat: JSONSchema = {
					name: "agent_output",
					strict: true,
					schema: SchemaOptimizer.createOptimizedJsonSchema(outputFormat),
				};

				const response = await this.getClient().chat.completions.create({
					model: this.model,
					messages: openaiMessages,
					temperature: this.temperature,
					response_format: {
						type: "json_schema",
						json_schema: responseFormat,
					},
					...reasoningEffortDict,
				});

				if (!response.choices || response.choices.length === 0) {
					throw new ModelProviderError(
						"No response choices received from model",
						500,
						this.name,
					);
				}

				const firstChoice = response.choices[0];
				if (!firstChoice) {
					throw new ModelProviderError(
						"No response choice received from model",
						500,
						this.name,
					);
				}
				if (!firstChoice.message.content) {
					throw new ModelProviderError(
						"Failed to parse structured output from model response",
						500,
						this.name,
					);
				}

				const usage = this.getUsage(response);

				// Parse and validate the JSON response
				const parsed = JSON.parse(firstChoice.message.content) as T;

				return {
					completion: parsed,
					usage,
				};
			}
		} catch (error: any) {
			// Handle rate limit errors
			if (error instanceof RateLimitError) {
				let errorMessage = "Rate limit exceeded";

				try {
					const errorData = error.error as any;
					errorMessage = errorData?.message || errorMessage;
				} catch {
					// Ignore JSON parsing errors
				}

				throw new ModelProviderError(errorMessage, 429, this.name);
			}

			// Handle API connection errors
			if (error instanceof APIConnectionError) {
				throw new ModelProviderError(
					error.message || "Connection error",
					500,
					this.name,
				);
			}

			// Handle general API errors
			if (error instanceof APIError) {
				let errorMessage = "Unknown model error";
				const statusCode = error.status || 500;

				try {
					const errorData = error.error as any;
					errorMessage = errorData?.message || errorMessage;
				} catch {
					// If parsing fails, use the error message
					errorMessage = error.message || errorMessage;
				}

				throw new ModelProviderError(errorMessage, statusCode, this.name);
			}

			// Handle any other errors
			throw new ModelProviderError(
				error.message || "Unknown error",
				500,
				this.name,
			);
		}
	}
}
