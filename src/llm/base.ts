import type { BaseMessage } from "./messages";
import type { ChatInvokeCompletion } from "./views";

/**
 * Base interface for chat models
 */
export interface BaseChatModel {
	/** Whether API keys have been verified */
	verifiedApiKeys?: boolean;

	/** Model identifier/name */
	model: string;

	/** Provider name (e.g., 'openai', 'anthropic', etc.) */
	readonly provider: string;

	/** Model name */
	readonly name: string;

	/** Legacy support for model name */
	// readonly modelName: string;

	/**
	 * Invoke the model with messages - overload for no output format
	 * @param messages List of chat messages
	 * @param outputFormat Optional output format (undefined for string response)
	 * @returns Chat completion response with string content
	 */
	ainvoke(
		messages: BaseMessage[],
		outputFormat?: undefined,
	): Promise<ChatInvokeCompletion<string>>;

	/**
	 * Invoke the model with messages - overload with output format
	 * @param messages List of chat messages
	 * @param outputFormat Class constructor for structured output
	 * @returns Chat completion response with typed content
	 */
	ainvoke<T>(
		messages: BaseMessage[],
		outputFormat: new (...args: any[]) => T,
	): Promise<ChatInvokeCompletion<T>>;

	/**
	 * Invoke the model with messages - general implementation
	 * @param messages List of chat messages
	 * @param outputFormat Optional class for structured output
	 * @returns Chat completion response
	 */
	ainvoke<T>(
		messages: BaseMessage[],
		outputFormat?: (new (...args: any[]) => T) | undefined,
	): Promise<ChatInvokeCompletion<T> | ChatInvokeCompletion<string>>;
}
