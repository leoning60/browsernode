import fetch from "node-fetch";
import { Ollama as OllamaClient } from "ollama";
import type { BaseChatModel } from "../base";
import { ModelProviderError } from "../exceptions";
import type { BaseMessage } from "../messages";
import { SchemaOptimizer } from "../schema";
import type { ChatInvokeCompletion, ChatInvokeUsage } from "../views";
import { OllamaMessageSerializer } from "./serializer";

/**
 * A wrapper around Ollama's chat model.
 */
export class ChatOllama implements BaseChatModel {
	model: string;

	// # Model params
	// temperature: number | null = null;

	// Client initialization parameters
	host: string | null = null;
	clientParams: Record<string, any> | null = null;

	constructor(options: {
		model: string;
		host?: string | null;
		fetch?: typeof fetch | null;
		clientParams?: Record<string, any> | null;
	}) {
		this.model = options.model;
		this.host = options.host ?? null;

		this.clientParams = options.clientParams ?? null;
	}

	// Static
	get provider(): string {
		return "ollama";
	}

	/**
	 * Prepare client parameters dictionary.
	 */
	private _getClientParams(): Record<string, any> {
		return {
			host: this.host,
			clientParams: this.clientParams,
		};
	}

	getClient(): OllamaClient {
		/**
		 * Returns an OllamaClient client.
		 */
		return new OllamaClient({
			host: this.host || undefined,
			...(this.clientParams || {}),
		});
	}

	get name(): string {
		return this.model;
	}

	async ainvoke(
		messages: BaseMessage[],
		outputFormat?: null,
	): Promise<ChatInvokeCompletion<string>>;
	async ainvoke<T>(
		messages: BaseMessage[],
		outputFormat: new () => T,
	): Promise<ChatInvokeCompletion<T>>;
	async ainvoke<T>(
		messages: BaseMessage[],
		outputFormat?: (new () => T) | null,
	): Promise<ChatInvokeCompletion<T> | ChatInvokeCompletion<string>> {
		const ollamaMessages = OllamaMessageSerializer.serializeMessages(messages);

		try {
			if (outputFormat === null || outputFormat === undefined) {
				const response = await this.getClient().chat({
					model: this.model,
					messages: ollamaMessages,
				});

				return {
					completion: response.message.content || "",
					usage: null,
				} as ChatInvokeCompletion;
			} else {
				const schema = SchemaOptimizer.createOptimizedJsonSchema(outputFormat);

				const response = await this.getClient().chat({
					model: this.model,
					messages: ollamaMessages,
					format: schema,
				});

				let completion: any = response.message.content || "";
				if (outputFormat !== null) {
					completion = JSON.parse(completion);
				}

				return { completion: completion, usage: null };
			}
		} catch (e) {
			throw new ModelProviderError(String(e), 502, this.name);
		}
	}
}
