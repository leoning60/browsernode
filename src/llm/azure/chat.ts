import { AzureOpenAI as AzureOpenAIClient } from "openai";
import type { ChatModel } from "openai/resources/shared";
import type { ReasoningEffort } from "openai/resources/shared";
import { ChatOpenAILike, type ChatOpenAILikeConfig } from "../openai/like";

/**
 * Configuration interface for ChatAzureOpenAI that extends ChatOpenAILikeConfig
 */
export interface ChatAzureOpenAIConfig extends ChatOpenAILikeConfig {
	apiVersion?: string | null;
	azureEndpoint?: string | null;
	azureDeployment?: string | null;
	azureAdToken?: string | null;
	azureAdTokenProvider?: any | null;
}

/**
 * A class for to interact with any provider using the OpenAI API schema.
 *
 * @param config - Configuration object including Azure-specific parameters
 */
export class ChatAzureOpenAI extends ChatOpenAILike {
	//   The name of the OpenAI model to use.
	model: string | ChatModel;

	// Client initialization parameters
	apiKey?: string | null;
	apiVersion?: string | null;
	azureEndpoint?: string | null;
	azureDeployment?: string | null;
	baseUrl?: string | null;
	azureAdToken?: string | null;
	azureAdTokenProvider?: any | null;

	defaultHeaders?: Record<string, string> | null;
	defaultQuery?: Record<string, any> | null;

	client?: AzureOpenAIClient | null;

	constructor(config: ChatAzureOpenAIConfig) {
		super(config);
		this.model = config.model;
		this.apiKey = config.apiKey;
		this.apiVersion = config.apiVersion || "2024-10-21";
		this.azureEndpoint = config.azureEndpoint;
		this.azureDeployment = config.azureDeployment;
		this.baseUrl = config.baseUrl?.toString() || null;
		this.azureAdToken = config.azureAdToken;
		this.azureAdTokenProvider = config.azureAdTokenProvider;
		this.defaultHeaders = config.defaultHeaders;
		this.defaultQuery = config.defaultQuery;
		this.client = null;
	}

	get provider(): string {
		return "azure";
	}

	getClientParams(): Record<string, any> {
		const clientParams: Record<string, any> = {};

		const apiKey = this.apiKey || process.env.AZURE_OPENAI_API_KEY;
		const azureEndpoint =
			this.azureEndpoint || process.env.AZURE_OPENAI_ENDPOINT;
		const azureDeployment =
			this.azureDeployment || process.env.AZURE_OPENAI_DEPLOYMENT;

		const paramsMapping = {
			apiKey: apiKey,
			apiVersion: this.apiVersion,
			organization: this.organization,
			azureEndpoint: azureEndpoint,
			azureDeployment: azureDeployment,
			baseUrl: this.baseUrl,
			azureAdToken: this.azureAdToken,
			azureAdTokenProvider: this.azureAdTokenProvider,
			httpClient: this.httpClient,
		};

		if (this.defaultHeaders !== null) {
			clientParams.defaultHeaders = this.defaultHeaders;
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

	getClient(): AzureOpenAIClient {
		/**
		 * Returns an asynchronous OpenAI client.
		 *
		 * Returns:
		 *     AzureOpenAIClient: An instance of the asynchronous OpenAI client.
		 */
		if (this.client) {
			return this.client;
		}

		const clientParams: Record<string, any> = this.getClientParams();

		if (this.httpClient) {
			clientParams.httpClient = this.httpClient;
		}

		this.client = new AzureOpenAIClient(clientParams);

		return this.client;
	}
}
