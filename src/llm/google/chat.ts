import { GoogleGenAI } from "@google/genai";
import type {
	GenerateContentConfig,
	GenerateContentResponse,
	HttpOptions,
	ThinkingConfig,
} from "@google/genai";
import type { Credentials } from "google-auth-library";

import type { BaseChatModel } from "../base";
import { ModelProviderError } from "../exceptions";
import type { BaseMessage } from "../messages";
import { SchemaOptimizer } from "../schema";
import type { ChatInvokeCompletion, ChatInvokeUsage } from "../views";
import { GoogleMessageSerializer } from "./serializer";

export type VerifiedGeminiModels =
	| "gemini-2.0-flash"
	| "gemini-2.0-flash-exp"
	| "gemini-2.0-flash-lite-preview-02-05"
	| "Gemini-2.0-exp"
	| "gemini-2.5-flash"
	| "gemini-2.5-flash-lite-preview-06-17"
	| "gemini-2.5-pro";

function isRetryableError(exception: any): boolean {
	const errorMsg = String(exception).toLowerCase();

	// Rate limit patterns
	const rateLimitPatterns = [
		"rate limit",
		"resource exhausted",
		"quota exceeded",
		"too many requests",
		"429",
	];

	// Server error patterns
	const serverErrorPatterns = [
		"service unavailable",
		"internal server error",
		"bad gateway",
		"503",
		"502",
		"500",
	];

	// Connection error patterns
	const connectionPatterns = [
		"connection",
		"timeout",
		"network",
		"unreachable",
	];

	const allPatterns = [
		...rateLimitPatterns,
		...serverErrorPatterns,
		...connectionPatterns,
	];
	return allPatterns.some((pattern) => errorMsg.includes(pattern));
}

function parsed(response: GenerateContentResponse): any | null {
	return response?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

export interface GoogleGenAIChatInput {
	// Model configuration
	model: VerifiedGeminiModels | string;
	temperature?: number | null;
	thinkingBudget?: number | null;
	config?: GenerateContentConfig | null;

	// Client initialization parameters
	apiKey?: string | null;
	vertexai?: boolean | null;
	credentials?: Credentials | null;
	project?: string | null;
	location?: string | null;
	httpOptions?: HttpOptions | null;
}

/**
 * A wrapper around Google's Gemini chat model using the genai client.
 *
 * This class accepts all genai.Client parameters while adding model,
 * temperature, and config parameters for the LLM interface.
 *
 * @param:
 * 	model: The Gemini model to use
 * 	temperature: Temperature for response generation
 * 	config: Additional configuration parameters to pass to generateContent(e.g., tools, safety_settings, etc.).
 * 	apiKey: Google API key
 * 	vertexAi: Whether to use Vertex AI
 * 	credentials: Google credentials object
 * 	project: Google Cloud project ID
 * 	location: Google Cloud location
 * 	httpOptions: HTTP options for the client
 * @example:
 * 	import { ChatGoogle } from "@browsernode/llm/google/chat";
 * 	const llm = new ChatGoogle("gemini-2.0-flash-exp", 0.5, {
 * 		tools: [new Tool("get_weather", "Get the weather for a given city")],
 * 	});
 * 	const response = await llm.ainvoke(["What is the weather in Tokyo?"]);
 * 	console.log(response);
 */
export class ChatGoogle implements BaseChatModel {
	// Model configuration
	public model: VerifiedGeminiModels | string;
	public temperature?: number | null;
	public thinkingBudget?: number | null;
	public config?: GenerateContentConfig | null;

	// Client initialization parameters
	public apiKey?: string | null;
	public vertexai?: boolean | null;
	public credentials?: Credentials | null;
	public project?: string | null;
	public location?: string | null;
	public httpOptions?: HttpOptions | null;

	constructor(config: GoogleGenAIChatInput) {
		this.model = config.model;
		this.temperature = config.temperature;
		this.thinkingBudget = config.thinkingBudget;
		this.config = config.config;
		this.apiKey = config.apiKey;
		this.vertexai = config.vertexai;
		this.credentials = config.credentials;
		this.project = config.project;
		this.location = config.location;
		this.httpOptions = config.httpOptions;
	}

	get provider(): string {
		return "google";
	}

	get name(): string {
		return this.model;
	}

	get modelName(): string {
		return this.model;
	}

	/**
	 * Prepare client parameters dictionary.
	 *
	 * @returns A dictionary of client parameters.
	 */
	getClientParams(): Record<string, any> {
		// Define base client params
		const baseParams = {
			apiKey: this.apiKey,
			vertexai: this.vertexai,
			credentials: this.credentials,
			project: this.project,
			location: this.location,
			httpOptions: this.httpOptions,
		};

		// Create client_params dict with non-None values
		const clientParams: Record<string, any> = {};
		for (const [k, v] of Object.entries(baseParams)) {
			if (v !== null && v !== undefined) {
				clientParams[k] = v;
			}
		}
		return clientParams;
	}

	/**
	 * Returns a genai.Client instance.
	 *
	 * @returns An instance of the Google genai client.
	 */
	getClient(): GoogleGenAI {
		const clientParams = this.getClientParams();
		return new GoogleGenAI(clientParams);
	}

	getUsage(response: GenerateContentResponse): ChatInvokeUsage | null {
		if (!response.usageMetadata) return null;

		let imageTokens = 0;
		if (response.usageMetadata.promptTokensDetails) {
			imageTokens = response.usageMetadata.promptTokensDetails
				.filter((detail: any) => detail.modality === "IMAGE")
				.reduce(
					(sum: number, detail: any) => sum + (detail.tokenCount || 0),
					0,
				);
		}

		return {
			promptTokens: response.usageMetadata.promptTokenCount || 0,
			completionTokens:
				(response.usageMetadata.candidatesTokenCount || 0) +
				(response.usageMetadata.thoughtsTokenCount || 0),
			totalTokens: response.usageMetadata.totalTokenCount || 0,
			promptCachedTokens: response.usageMetadata.cachedContentTokenCount,
			promptCacheCreationTokens: null,
			promptImageTokens: imageTokens,
		} as ChatInvokeUsage;
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
	 * @param messages: List of chat messages
	 * @param outputFormat: Optional Zod model class for structured output
	 * @returns:
	 * 	Either a string response or an instance of outputFormat
	 */
	async ainvoke<T = string>(
		messages: BaseMessage[],
		outputFormat?: new (...args: any[]) => T,
	): Promise<ChatInvokeCompletion<T | string>> {
		// Serialize messages to Google format
		const [contents, systemInstruction] =
			GoogleMessageSerializer.serializeMessages(messages);

		// Build config dictionary starting with user-provided config
		const config: GenerateContentConfig = {};
		if (this.config) {
			Object.assign(config, this.config);
		}

		// Apply model-specific configuration (these can override config)
		if (this.temperature !== null && this.temperature !== undefined) {
			config.temperature = this.temperature;
		}

		// Add system instruction if present
		if (systemInstruction) {
			config.systemInstruction = systemInstruction;
		}

		if (this.thinkingBudget !== null && this.thinkingBudget !== undefined) {
			const thinkingConfig: ThinkingConfig = {
				thinkingBudget: this.thinkingBudget,
			};
			config.thinkingConfig = thinkingConfig;
		}

		const makeApiCall = async (): Promise<ChatInvokeCompletion<T | string>> => {
			const client = this.getClient();

			if (!outputFormat) {
				// Return string response
				const response = await client.models.generateContent({
					model: this.model,
					contents,
					config,
				});
				// Handle case where response.text might be null
				const text = response.text || "";
				const usage = this.getUsage(response);

				return {
					completion: text,
					usage,
				};
			} else {
				// Return structured response
				config.responseMimeType = "application/json";
				// Optimize schema for Gemini
				const optimizedSchema =
					SchemaOptimizer.createOptimizedJsonSchema(outputFormat);
				const geminiSchema = this.fixGeminiSchema(optimizedSchema);
				config.responseSchema = geminiSchema;

				const response = await client.models.generateContent({
					model: this.model,
					contents,
					config,
				});

				const usage = this.getUsage(response);

				// Handle case where response.parsed might be None
				if (response.candidates === null || response.candidates === undefined) {
					// When using responseSchema, Gemini returns JSON as text
					if (response.text) {
						try {
							// Parse the JSON text and validate with the type
							const parsedData = JSON.parse(response.text);
							return {
								completion: parsedData as T,
								usage,
							};
						} catch (e) {
							throw new ModelProviderError(
								`Failed to parse or validate response: ${String(e)}`,
								500,
								this.model,
							);
						}
					} else {
						throw new ModelProviderError(
							"No response from model",
							500,
							this.model,
						);
					}
				}
				// Ensure we return the correct type
				if (parsed(response) instanceof outputFormat) {
					return {
						completion: parsed(response),
						usage,
					} as ChatInvokeCompletion;
				} else {
					// If it's not the expected type, try to validate it
					return {
						completion: JSON.parse(parsed(response)),
						usage,
					} as ChatInvokeCompletion;
				}
			}
		};

		try {
			// Use manual retry loop for Google API calls
			let lastException: any = null;
			for (let attempt = 0; attempt < 10; attempt++) {
				// Match our 10 retry attempts from other providers
				try {
					return await makeApiCall();
				} catch (e) {
					lastException = e;
					if (!isRetryableError(e) || attempt === 9) {
						// Last attempt
						break;
					}

					// Simple exponential backoff
					const delay = Math.min(60.0, 1.0 * Math.pow(2.0, attempt)); // Cap at 60s
					await new Promise((resolve) => setTimeout(resolve, delay * 1000));
				}
			}

			// Re-raise the last exception if all retries failed
			if (lastException) {
				throw lastException;
			} else {
				// This should never happen, but ensure we don't return undefined
				throw new ModelProviderError(
					"All retry attempts failed without exception",
					500,
					this.name,
				);
			}
		} catch (error: any) {
			// Handle specific Google API errors
			const errorMessage = String(error);
			let statusCode: number | null = null;

			// Check if this is a rate limit error
			if (
				[
					"rate limit",
					"resource exhausted",
					"quota exceeded",
					"too many requests",
					"429",
				].some((indicator) => errorMessage.toLowerCase().includes(indicator))
			) {
				statusCode = 429;
			} else if (
				[
					"service unavailable",
					"internal server error",
					"bad gateway",
					"503",
					"502",
					"500",
				].some((indicator) => errorMessage.toLowerCase().includes(indicator))
			) {
				statusCode = 503;
			}

			// Try to extract status code if available
			if (error.response && error.response.statusCode) {
				statusCode = error.response.statusCode;
			}

			throw new ModelProviderError(
				errorMessage,
				statusCode || 502, // Use default if null
				this.name,
			);
		}
	}

	/**
	 * Convert a JSON schema to a Gemini-compatible schema.
	 *
	 * This function removes unsupported properties like 'additionalProperties' and resolves
	 * $ref references that Gemini doesn't support.
	 */
	private fixGeminiSchema(schema: Record<string, any>): Record<string, any> {
		// Handle $defs and $ref resolution
		if ("$defs" in schema) {
			const defs = schema.$defs;
			delete schema.$defs;

			const resolveRefs = (obj: any): any => {
				if (typeof obj === "object" && obj !== null) {
					if (Array.isArray(obj)) {
						return obj.map(resolveRefs);
					}

					if ("$ref" in obj) {
						const ref = obj.$ref;
						delete obj.$ref;
						const refName = ref.split("/").pop();
						if (refName && refName in defs) {
							// Replace the reference with the actual definition
							const resolved = { ...defs[refName] };
							// Merge any additional properties from the reference
							for (const [key, value] of Object.entries(obj)) {
								if (key !== "$ref") {
									resolved[key] = value;
								}
							}
							return resolveRefs(resolved);
						}
						return obj;
					} else {
						// Recursively process all dictionary values
						const result: Record<string, any> = {};
						for (const [k, v] of Object.entries(obj)) {
							result[k] = resolveRefs(v);
						}
						return result;
					}
				}
				return obj;
			};

			schema = resolveRefs(schema);
		}

		// Remove unsupported properties
		const cleanSchema = (obj: any): any => {
			if (typeof obj === "object" && obj !== null) {
				if (Array.isArray(obj)) {
					return obj.map(cleanSchema);
				}

				// Remove unsupported properties
				const cleaned: Record<string, any> = {};
				for (const [key, value] of Object.entries(obj)) {
					if (!["additionalProperties", "title", "default"].includes(key)) {
						const cleanedValue = cleanSchema(value);
						// Handle empty object properties - Gemini doesn't allow empty OBJECT types
						if (
							key === "properties" &&
							typeof cleanedValue === "object" &&
							Object.keys(cleanedValue).length === 0 &&
							obj.type?.toUpperCase() === "OBJECT"
						) {
							// Convert empty object to have at least one property
							cleaned.properties = { _placeholder: { type: "string" } };
						} else {
							cleaned[key] = cleanedValue;
						}
					}
				}

				// If this is an object type with empty properties, add a placeholder
				if (
					cleaned.type?.toUpperCase() === "OBJECT" &&
					"properties" in cleaned &&
					typeof cleaned.properties === "object" &&
					Object.keys(cleaned.properties).length === 0
				) {
					cleaned.properties = { _placeholder: { type: "string" } };
				}

				return cleaned;
			}
			return obj;
		};

		return cleanSchema(schema);
	}
}
