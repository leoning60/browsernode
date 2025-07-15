import type { ChatInvokeUsage } from "../llm/views";

/**
 * Single token usage entry
 */
export interface TokenUsageEntry {
	model: string;
	timestamp: Date;
	usage: ChatInvokeUsage;
}

/**
 * Token cost calculation
 */
export interface TokenCostCalculated {
	newPromptTokens: number;
	newPromptCost: number;

	promptReadCachedTokens: number | null;
	promptReadCachedCost: number | null;

	promptCachedCreationTokens: number | null;
	promptCacheCreationCost: number | null;
	/** Anthropic only: The cost of creating the cache. */

	completionTokens: number;
	completionCost: number;
}

/**
 * Token cost calculation with computed properties
 */
export class TokenCostCalculatedWithProperties implements TokenCostCalculated {
	newPromptTokens: number;
	newPromptCost: number;
	promptReadCachedTokens: number | null;
	promptReadCachedCost: number | null;
	promptCachedCreationTokens: number | null;
	promptCacheCreationCost: number | null;
	completionTokens: number;
	completionCost: number;

	constructor(data: TokenCostCalculated) {
		this.newPromptTokens = data.newPromptTokens;
		this.newPromptCost = data.newPromptCost;
		this.promptReadCachedTokens = data.promptReadCachedTokens;
		this.promptReadCachedCost = data.promptReadCachedCost;
		this.promptCachedCreationTokens = data.promptCachedCreationTokens;
		this.promptCacheCreationCost = data.promptCacheCreationCost;
		this.completionTokens = data.completionTokens;
		this.completionCost = data.completionCost;
	}

	get promptCost(): number {
		return (
			this.newPromptCost +
			(this.promptReadCachedCost || 0) +
			(this.promptCacheCreationCost || 0)
		);
	}

	get totalCost(): number {
		return (
			this.newPromptCost +
			(this.promptReadCachedCost || 0) +
			(this.promptCacheCreationCost || 0) +
			this.completionCost
		);
	}
}

/**
 * Pricing information for a model
 */
export interface ModelPricing {
	model: string;
	inputCostPerToken: number | null;
	outputCostPerToken: number | null;

	cacheReadInputTokenCost: number | null;
	cacheCreationInputTokenCost: number | null;

	maxTokens: number | null;
	maxInputTokens: number | null;
	maxOutputTokens: number | null;
}

/**
 * Cached pricing data with timestamp
 */
export interface CachedPricingData {
	timestamp: Date;
	data: Record<string, any>;
}

/**
 * Usage statistics for a single model
 */
export interface ModelUsageStats {
	model: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost: number;
	invocations: number;
	averageTokensPerInvocation: number;
}

/**
 * Usage tokens for a single model
 */
export interface ModelUsageTokens {
	model: string;
	promptTokens: number;
	promptCachedTokens: number;
	completionTokens: number;
	totalTokens: number;
}

/**
 * Summary of token usage and costs
 */
export interface UsageSummary {
	totalPromptTokens: number;
	totalPromptCost: number;

	totalPromptCachedTokens: number;
	totalPromptCachedCost: number;

	totalCompletionTokens: number;
	totalCompletionCost: number;
	totalTokens: number;
	totalCost: number;
	entryCount: number;

	byModel: Record<string, ModelUsageStats>;
}
