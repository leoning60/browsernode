/**
 * Usage information for a chat model invocation
 */
export interface ChatInvokeUsage {
	/** The number of tokens in the prompt (this includes the cached tokens as well. When calculating the cost, subtract the cached tokens from the prompt tokens) */
	promptTokens: number;

	/** The number of cached tokens */
	promptCachedTokens?: number | null;

	/** Anthropic only: The number of tokens used to create the cache */
	promptCacheCreationTokens?: number | null;

	/** Google only: The number of tokens in the image (prompt tokens is the text tokens + image tokens in that case) */
	promptImageTokens?: number | null;

	/** The number of tokens in the completion */
	completionTokens: number;

	/** The total number of tokens in the response */
	totalTokens: number;
}

/**
 * Response from a chat model invocation
 */
export interface ChatInvokeCompletion<T = string> {
	/** The completion of the response */
	completion: T;

	/** Thinking stuff */
	thinking?: string | null;
	redactedThinking?: string | null;

	/** The usage of the response */
	usage?: ChatInvokeUsage | null;
}
