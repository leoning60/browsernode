import { OpenAI as OpenAIClient } from "openai";
import type { ChatModel } from "openai/resources/shared";
import { ChatOpenAILike, type ChatOpenAILikeConfig } from "../openai/like";

/**
 * Configuration interface for ChatOpenRouter that extends ChatOpenAILikeConfig
 */
export interface ChatOpenRouterConfig extends ChatOpenAILikeConfig {
	httpReferer?: string | null;
	xTitle?: string | null;
}

/**
 * A class to interact with OpenRouter using the OpenAI API schema.
 *
 * @param config - Configuration object including OpenRouter-specific parameters
 */
export class ChatOpenRouter extends ChatOpenAILike {
	//   The name of the OpenAI model to use.
	model: string | ChatModel;

	// Client initialization parameters
	apiKey?: string | null;
	baseUrl?: string | null;
	httpReferer?: string | null;
	xTitle?: string | null;

	defaultHeaders?: Record<string, string> | null;
	defaultQuery?: Record<string, any> | null;

	client?: OpenAIClient | null;

	constructor(config: ChatOpenRouterConfig) {
		super(config);
		this.model = config.model;
		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl?.toString() || "https://openrouter.ai/api/v1";
		this.httpReferer = config.httpReferer;
		this.xTitle = config.xTitle;
		this.defaultHeaders = config.defaultHeaders;
		this.defaultQuery = config.defaultQuery;
		this.client = null;
	}

	get provider(): string {
		return "openrouter";
	}

	getClientParams(): Record<string, any> {
		const clientParams: Record<string, any> = {};

		const apiKey = this.apiKey || process.env.OPENROUTER_API_KEY;

		const paramsMapping = {
			apiKey: apiKey,
			organization: this.organization,
			baseURL: this.baseUrl,
			httpClient: this.httpClient,
		};

		// Prepare default headers
		const headers: Record<string, string> = {};

		// Add OpenRouter-specific headers
		if (this.httpReferer) {
			headers["HTTP-Referer"] = this.httpReferer;
		}
		if (this.xTitle) {
			headers["X-Title"] = this.xTitle;
		}

		// Merge with existing default headers
		if (this.defaultHeaders) {
			Object.assign(headers, this.defaultHeaders);
		}

		if (Object.keys(headers).length > 0) {
			clientParams.defaultHeaders = headers;
		}

		if (this.defaultQuery !== null) {
			clientParams.defaultQuery = this.defaultQuery;
		}

		// Add non-null values from paramsMapping
		for (const [key, value] of Object.entries(paramsMapping)) {
			if (value !== null && value !== undefined) {
				clientParams[key] = value;
			}
		}

		return clientParams;
	}

	getClient(): OpenAIClient {
		/**
		 * Returns an asynchronous OpenAI client configured for OpenRouter.
		 *
		 * Returns:
		 *     OpenAIClient: An instance of the asynchronous OpenAI client.
		 */
		if (this.client) {
			return this.client;
		}

		const clientParams: Record<string, any> = this.getClientParams();

		if (this.httpClient) {
			clientParams.httpClient = this.httpClient;
		}

		this.client = new OpenAIClient(clientParams);

		return this.client;
	}
}
