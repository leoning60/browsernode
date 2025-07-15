import path from "path";
import fs from "fs/promises";
import winston from "winston";
import { CONFIG } from "../config";
import type { BaseChatModel } from "../llm/base";
import type { ChatInvokeUsage } from "../llm/views";
import type {
	CachedPricingData,
	ModelPricing,
	ModelUsageStats,
	ModelUsageTokens,
	TokenCostCalculated,
	TokenUsageEntry,
	UsageSummary,
} from "./views";

const logger = winston.createLogger({
	level: "debug",
	format: winston.format.combine(
		winston.format.label({ label: "browsernode/tokens" }),
		winston.format.timestamp(),
		winston.format.errors({ stack: true }),
		winston.format.printf(({ level, message, timestamp, stack }) => {
			if (stack) {
				return `${timestamp} ${level}: ${message}\n${stack}`;
			}
			return `${timestamp} ${level}: ${message}`;
		}),
	),
	transports: [new winston.transports.Console()],
});

const costLogger = winston.createLogger({
	level: "info",
	format: winston.format.combine(
		winston.format.label({ label: "cost" }),
		winston.format.timestamp(),
		winston.format.printf(({ message }) => message as string),
	),
	transports: [new winston.transports.Console()],
});

function xdgCacheHome(): string {
	const defaultPath = path.join(
		process.env.HOME || process.env.USERPROFILE || "",
		".cache",
	);
	if (CONFIG.xdgCacheHome && path.isAbsolute(CONFIG.xdgCacheHome)) {
		return CONFIG.xdgCacheHome;
	}
	return defaultPath;
}

export class TokenCost {
	private static readonly CACHE_DIR_NAME = "browsernode/token_cost";
	private static readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 1 day in milliseconds
	private static readonly PRICING_URL =
		"https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

	private readonly includeCost: boolean;
	private readonly usageHistory: TokenUsageEntry[] = [];
	private readonly registeredLLMs: Map<string, BaseChatModel> = new Map();
	private pricingData: Record<string, any> | null = null;
	private initialized = false;
	private readonly cacheDir: string;

	constructor(includeCost = false) {
		this.includeCost =
			includeCost ||
			process.env.BROWSERNODE_CALCULATE_COST?.toLowerCase() === "true";
		this.cacheDir = path.join(xdgCacheHome(), TokenCost.CACHE_DIR_NAME);
	}

	async initialize(): Promise<void> {
		if (!this.initialized) {
			if (this.includeCost) {
				await this.loadPricingData();
			}
			this.initialized = true;
		}
	}

	private async loadPricingData(): Promise<void> {
		// Try to find a valid cache file
		const cacheFile = await this.findValidCache();

		if (cacheFile) {
			await this.loadFromCache(cacheFile);
		} else {
			await this.fetchAndCachePricingData();
		}
	}

	private async findValidCache(): Promise<string | null> {
		try {
			// Ensure cache directory exists
			await fs.mkdir(this.cacheDir, { recursive: true });

			// List all JSON files in the cache directory
			const files = await fs.readdir(this.cacheDir);
			const cacheFiles = files
				.filter((file) => file.endsWith(".json"))
				.map((file) => path.join(this.cacheDir, file));

			if (cacheFiles.length === 0) {
				return null;
			}

			// Sort by modification time (most recent first)
			const fileStats = await Promise.all(
				cacheFiles.map(async (file) => ({
					file,
					mtime: (await fs.stat(file)).mtime,
				})),
			);
			fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

			// Check each file until we find a valid one
			for (const { file } of fileStats) {
				if (await this.isCacheValid(file)) {
					return file;
				} else {
					// Clean up old cache files
					try {
						await fs.unlink(file);
					} catch {
						// Ignore errors when cleaning up
					}
				}
			}

			return null;
		} catch {
			return null;
		}
	}

	private async isCacheValid(cacheFile: string): Promise<boolean> {
		try {
			const content = await fs.readFile(cacheFile, "utf-8");
			const cached: CachedPricingData = JSON.parse(content);

			// Check if cache is still valid
			const cacheTime = new Date(cached.timestamp);
			const now = new Date();
			return now.getTime() - cacheTime.getTime() < TokenCost.CACHE_DURATION_MS;
		} catch {
			return false;
		}
	}

	private async loadFromCache(cacheFile: string): Promise<void> {
		try {
			const content = await fs.readFile(cacheFile, "utf-8");
			const cached: CachedPricingData = JSON.parse(content);
			this.pricingData = cached.data;
		} catch (error) {
			console.error(
				`Error loading cached pricing data from ${cacheFile}:`,
				error,
			);
			// Fall back to fetching
			await this.fetchAndCachePricingData();
		}
	}

	private async fetchAndCachePricingData(): Promise<void> {
		try {
			const response = await fetch(TokenCost.PRICING_URL);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			this.pricingData = (await response.json()) as Record<string, any>;

			// Create cache object with timestamp
			const cached: CachedPricingData = {
				timestamp: new Date(),
				data: this.pricingData || {},
			};

			// Ensure cache directory exists
			await fs.mkdir(this.cacheDir, { recursive: true });

			// Create cache file with timestamp in filename
			const timestampStr = new Date()
				.toISOString()
				.replace(/[:.]/g, "-")
				.replace("T", "_")
				.split(".")[0];
			const cacheFile = path.join(
				this.cacheDir,
				`pricing_${timestampStr}.json`,
			);

			await fs.writeFile(cacheFile, JSON.stringify(cached, null, 2));
		} catch (error) {
			console.error("Error fetching pricing data:", error);
			// Fall back to empty pricing data
			this.pricingData = {};
		}
	}

	async getModelPricing(modelName: string): Promise<ModelPricing | null> {
		// Ensure we're initialized
		if (!this.initialized) {
			await this.initialize();
		}

		if (!this.pricingData || !(modelName in this.pricingData)) {
			return null;
		}

		const data = this.pricingData[modelName];
		return {
			model: modelName,
			inputCostPerToken: data.input_cost_per_token ?? null,
			outputCostPerToken: data.output_cost_per_token ?? null,
			maxTokens: data.max_tokens ?? null,
			maxInputTokens: data.max_input_tokens ?? null,
			maxOutputTokens: data.max_output_tokens ?? null,
			cacheReadInputTokenCost: data.cache_read_input_token_cost ?? null,
			cacheCreationInputTokenCost: data.cache_creation_input_token_cost ?? null,
		};
	}

	async calculateCost(
		model: string,
		usage: ChatInvokeUsage,
	): Promise<TokenCostCalculated | null> {
		if (!this.includeCost) {
			return null;
		}

		const data = await this.getModelPricing(model);
		if (data === null) {
			return null;
		}

		const uncachedPromptTokens =
			usage.promptTokens - (usage.promptCachedTokens || 0);

		return {
			newPromptTokens: usage.promptTokens,
			newPromptCost: uncachedPromptTokens * (data.inputCostPerToken || 0),
			// Cached tokens
			promptReadCachedTokens: usage.promptCachedTokens || null,
			promptReadCachedCost:
				usage.promptCachedTokens && data.cacheReadInputTokenCost
					? usage.promptCachedTokens * data.cacheReadInputTokenCost
					: null,
			// Cache creation tokens
			promptCachedCreationTokens: usage.promptCacheCreationTokens || null,
			promptCacheCreationCost:
				data.cacheCreationInputTokenCost && usage.promptCacheCreationTokens
					? usage.promptCacheCreationTokens * data.cacheCreationInputTokenCost
					: null,
			// Completion tokens
			completionTokens: usage.completionTokens,
			completionCost: usage.completionTokens * (data.outputCostPerToken || 0),
		};
	}

	addUsage(model: string, usage: ChatInvokeUsage): TokenUsageEntry {
		const entry: TokenUsageEntry = {
			model,
			timestamp: new Date(),
			usage,
		};

		this.usageHistory.push(entry);
		return entry;
	}

	private async logUsage(model: string, usage: TokenUsageEntry): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}

		// ANSI color codes
		const C_CYAN = "\u001b[96m";
		const C_YELLOW = "\u001b[93m";
		const C_GREEN = "\u001b[92m";
		const C_BLUE = "\u001b[94m";
		const C_RESET = "\u001b[0m";

		// Always get cost breakdown for token details (even if not showing costs)
		const cost = await this.calculateCost(model, usage.usage);

		// Build input tokens breakdown
		const inputPart = this.buildInputTokensDisplay(usage.usage, cost);

		// Build output tokens display
		const completionTokensFmt = this.formatTokens(usage.usage.completionTokens);
		const outputPart =
			this.includeCost && cost && cost.completionCost > 0
				? `📤 ${C_GREEN}${completionTokensFmt} ($${cost.completionCost.toFixed(4)})${C_RESET}`
				: `📤 ${C_GREEN}${completionTokensFmt}${C_RESET}`;

		costLogger.info(
			`🧠 ${C_CYAN}${model}${C_RESET} | ${inputPart} | ${outputPart}`,
		);
	}

	private buildInputTokensDisplay(
		usage: ChatInvokeUsage,
		cost: TokenCostCalculated | null,
	): string {
		const C_YELLOW = "\u001b[93m";
		const C_BLUE = "\u001b[94m";
		const C_RESET = "\u001b[0m";

		const parts: string[] = [];

		// Always show token breakdown if we have cache information, regardless of cost tracking
		if (usage.promptCachedTokens || usage.promptCacheCreationTokens) {
			// Calculate actual new tokens (non-cached)
			const newTokens = usage.promptTokens - (usage.promptCachedTokens || 0);

			if (newTokens > 0) {
				const newTokensFmt = this.formatTokens(newTokens);
				if (this.includeCost && cost && cost.newPromptCost > 0) {
					parts.push(
						`🆕 ${C_YELLOW}${newTokensFmt} ($${cost.newPromptCost.toFixed(4)})${C_RESET}`,
					);
				} else {
					parts.push(`🆕 ${C_YELLOW}${newTokensFmt}${C_RESET}`);
				}
			}

			if (usage.promptCachedTokens) {
				const cachedTokensFmt = this.formatTokens(usage.promptCachedTokens);
				if (this.includeCost && cost && cost.promptReadCachedCost) {
					parts.push(
						`💾 ${C_BLUE}${cachedTokensFmt} ($${cost.promptReadCachedCost.toFixed(4)})${C_RESET}`,
					);
				} else {
					parts.push(`💾 ${C_BLUE}${cachedTokensFmt}${C_RESET}`);
				}
			}

			if (usage.promptCacheCreationTokens) {
				const creationTokensFmt = this.formatTokens(
					usage.promptCacheCreationTokens,
				);
				if (this.includeCost && cost && cost.promptCacheCreationCost) {
					parts.push(
						`🔧 ${C_BLUE}${creationTokensFmt} ($${cost.promptCacheCreationCost.toFixed(4)})${C_RESET}`,
					);
				} else {
					parts.push(`🔧 ${C_BLUE}${creationTokensFmt}${C_RESET}`);
				}
			}
		}

		if (parts.length === 0) {
			// Fallback to simple display when no cache information available
			const totalTokensFmt = this.formatTokens(usage.promptTokens);
			if (this.includeCost && cost && cost.newPromptCost > 0) {
				parts.push(
					`📥 ${C_YELLOW}${totalTokensFmt} ($${cost.newPromptCost.toFixed(4)})${C_RESET}`,
				);
			} else {
				parts.push(`📥 ${C_YELLOW}${totalTokensFmt}${C_RESET}`);
			}
		}

		return parts.join(" + ");
	}

	registerLLM(llm: BaseChatModel): BaseChatModel {
		// Use instance ID as key to avoid collisions between multiple instances
		const instanceId = String(Math.random());

		// Check if this exact instance is already registered
		if (this.registeredLLMs.has(instanceId)) {
			logger.debug(
				`LLM instance ${instanceId} (${llm.provider}_${llm.model}) is already registered`,
			);
			return llm;
		}

		this.registeredLLMs.set(instanceId, llm);

		// Store the original method
		const originalAinvoke = llm.ainvoke.bind(llm);
		// Store reference to self for use in the closure
		const tokenCostService = this;

		// Create a wrapped version that tracks usage
		const trackedAinvoke = async function <T>(
			messages: any[],
			outputFormat?: (new (...args: any[]) => T) | undefined,
		): Promise<any> {
			// Call the original method
			const result = await originalAinvoke(messages, outputFormat);

			// Track usage if available
			if (result.usage) {
				const usage = tokenCostService.addUsage(llm.model, result.usage);
				logger.debug(`Token cost service: ${JSON.stringify(usage)}`);
				// Don't await the logging to avoid blocking
				tokenCostService.logUsage(llm.model, usage).catch((error) => {
					logger.error("Error logging usage:", error);
				});
			}

			return result;
		};

		// Replace the method with our tracked version
		llm.ainvoke = trackedAinvoke as any;

		return llm;
	}

	getUsageTokensForModel(model: string): ModelUsageTokens {
		const filteredUsage = this.usageHistory.filter((u) => u.model === model);

		return {
			model,
			promptTokens: filteredUsage.reduce(
				(sum, u) => sum + u.usage.promptTokens,
				0,
			),
			promptCachedTokens: filteredUsage.reduce(
				(sum, u) => sum + (u.usage.promptCachedTokens || 0),
				0,
			),
			completionTokens: filteredUsage.reduce(
				(sum, u) => sum + u.usage.completionTokens,
				0,
			),
			totalTokens: filteredUsage.reduce(
				(sum, u) => sum + u.usage.promptTokens + u.usage.completionTokens,
				0,
			),
		};
	}

	async getUsageSummary(model?: string, since?: Date): Promise<UsageSummary> {
		let filteredUsage = this.usageHistory;

		if (model) {
			filteredUsage = filteredUsage.filter((u) => u.model === model);
		}

		if (since) {
			filteredUsage = filteredUsage.filter((u) => u.timestamp >= since);
		}

		if (filteredUsage.length === 0) {
			return {
				totalPromptTokens: 0,
				totalPromptCost: 0.0,
				totalPromptCachedTokens: 0,
				totalPromptCachedCost: 0.0,
				totalCompletionTokens: 0,
				totalCompletionCost: 0.0,
				totalTokens: 0,
				totalCost: 0.0,
				entryCount: 0,
				byModel: {},
			};
		}

		// Calculate totals
		const totalPrompt = filteredUsage.reduce(
			(sum, u) => sum + u.usage.promptTokens,
			0,
		);
		const totalCompletion = filteredUsage.reduce(
			(sum, u) => sum + u.usage.completionTokens,
			0,
		);
		const totalTokens = totalPrompt + totalCompletion;
		const totalPromptCached = filteredUsage.reduce(
			(sum, u) => sum + (u.usage.promptCachedTokens || 0),
			0,
		);

		// Calculate per-model stats with record-by-record cost calculation
		const modelStats: Record<string, ModelUsageStats> = {};
		let totalPromptCost = 0.0;
		let totalCompletionCost = 0.0;
		let totalPromptCachedCost = 0.0;

		for (const entry of filteredUsage) {
			if (!(entry.model in modelStats)) {
				modelStats[entry.model] = {
					model: entry.model,
					promptTokens: 0,
					completionTokens: 0,
					totalTokens: 0,
					cost: 0,
					invocations: 0,
					averageTokensPerInvocation: 0,
				};
			}

			const stats = modelStats[entry.model];
			if (!stats) {
				continue;
			}

			stats.promptTokens += entry.usage.promptTokens;
			stats.completionTokens += entry.usage.completionTokens;
			stats.totalTokens +=
				entry.usage.promptTokens + entry.usage.completionTokens;
			stats.invocations += 1;

			if (this.includeCost) {
				// Calculate cost record by record using the updated calculateCost function
				const cost = await this.calculateCost(entry.model, entry.usage);
				if (cost) {
					const promptCost =
						cost.newPromptCost + (cost.promptCacheCreationCost || 0);
					totalPromptCost += promptCost;
					totalCompletionCost += cost.completionCost;
					totalPromptCachedCost += cost.promptReadCachedCost || 0;
					stats.cost +=
						promptCost + cost.completionCost + (cost.promptReadCachedCost || 0);
				}
			}
		}

		// Calculate averages
		for (const stats of Object.values(modelStats)) {
			if (stats.invocations > 0) {
				stats.averageTokensPerInvocation =
					stats.totalTokens / stats.invocations;
			}
		}

		return {
			totalPromptTokens: totalPrompt,
			totalPromptCost: totalPromptCost,
			totalPromptCachedTokens: totalPromptCached,
			totalPromptCachedCost: totalPromptCachedCost,
			totalCompletionTokens: totalCompletion,
			totalCompletionCost: totalCompletionCost,
			totalTokens: totalTokens,
			totalCost: totalPromptCost + totalCompletionCost + totalPromptCachedCost,
			entryCount: filteredUsage.length,
			byModel: modelStats,
		};
	}

	private formatTokens(tokens: number): string {
		if (tokens >= 1000000000) {
			return `${(tokens / 1000000000).toFixed(1)}B`;
		}
		if (tokens >= 1000000) {
			return `${(tokens / 1000000).toFixed(1)}M`;
		}
		if (tokens >= 1000) {
			return `${(tokens / 1000).toFixed(1)}k`;
		}
		return String(tokens);
	}

	async logUsageSummary(): Promise<void> {
		if (this.usageHistory.length === 0) {
			return;
		}

		const summary = await this.getUsageSummary();

		if (summary.entryCount === 0) {
			return;
		}

		// ANSI color codes
		const C_CYAN = "\u001b[96m";
		const C_YELLOW = "\u001b[93m";
		const C_GREEN = "\u001b[92m";
		const C_BLUE = "\u001b[94m";
		const C_MAGENTA = "\u001b[95m";
		const C_RESET = "\u001b[0m";
		const C_BOLD = "\u001b[1m";

		// Log overall summary
		const totalTokensFmt = this.formatTokens(summary.totalTokens);
		const promptTokensFmt = this.formatTokens(summary.totalPromptTokens);
		const completionTokensFmt = this.formatTokens(
			summary.totalCompletionTokens,
		);

		// Format cost breakdowns for input and output (only if cost tracking is enabled)
		const totalCostPart =
			this.includeCost && summary.totalCost > 0
				? ` ($${C_MAGENTA}${summary.totalCost.toFixed(4)}${C_RESET})`
				: "";
		const promptCostPart = this.includeCost
			? ` ($${summary.totalPromptCost.toFixed(4)})`
			: "";
		const completionCostPart = this.includeCost
			? ` ($${summary.totalCompletionCost.toFixed(4)})`
			: "";

		if (Object.keys(summary.byModel).length > 1) {
			costLogger.info(
				`💲 ${C_BOLD}Total Usage Summary${C_RESET}: ${C_BLUE}${totalTokensFmt} tokens${C_RESET}${totalCostPart} | ` +
					`⬅️ ${C_YELLOW}${promptTokensFmt}${promptCostPart}${C_RESET} | ➡️ ${C_GREEN}${completionTokensFmt}${completionCostPart}${C_RESET}`,
			);
		}

		// Log per-model breakdown
		costLogger.info(`📊 ${C_BOLD}Per-Model Usage Breakdown${C_RESET}:`);

		for (const [model, stats] of Object.entries(summary.byModel)) {
			// Format tokens
			const modelTotalFmt = this.formatTokens(stats.totalTokens);
			const modelPromptFmt = this.formatTokens(stats.promptTokens);
			const modelCompletionFmt = this.formatTokens(stats.completionTokens);
			const avgTokensFmt = this.formatTokens(
				Math.round(stats.averageTokensPerInvocation),
			);

			// Format cost display (only if cost tracking is enabled)
			const costPart =
				this.includeCost && stats.cost > 0
					? ` ($${C_MAGENTA}${stats.cost.toFixed(4)}${C_RESET})`
					: "";

			// Calculate per-model costs for display
			let promptPart = `${C_YELLOW}${modelPromptFmt}${C_RESET}`;
			let completionPart = `${C_GREEN}${modelCompletionFmt}${C_RESET}`;

			if (this.includeCost) {
				// Calculate costs for this model
				let modelPromptCost = 0.0;
				let modelCompletionCost = 0.0;

				for (const entry of this.usageHistory) {
					if (entry.model === model) {
						const cost = await this.calculateCost(entry.model, entry.usage);
						if (cost) {
							modelPromptCost +=
								cost.newPromptCost + (cost.promptCacheCreationCost || 0);
							modelCompletionCost += cost.completionCost;
						}
					}
				}

				if (modelPromptCost > 0) {
					promptPart = `${C_YELLOW}${modelPromptFmt} ($${modelPromptCost.toFixed(4)})${C_RESET}`;
				}
				if (modelCompletionCost > 0) {
					completionPart = `${C_GREEN}${modelCompletionFmt} ($${modelCompletionCost.toFixed(4)})${C_RESET}`;
				}
			}

			costLogger.info(
				`  🤖 ${C_CYAN}${model}${C_RESET}: ${C_BLUE}${modelTotalFmt} tokens${C_RESET}${costPart} | ` +
					`⬅️ ${promptPart} | ➡️ ${completionPart} | ` +
					`📞 ${stats.invocations} calls | 📈 ${avgTokensFmt}/call`,
			);
		}
	}

	async getCostByModel(): Promise<Record<string, ModelUsageStats>> {
		const summary = await this.getUsageSummary();
		return summary.byModel;
	}

	clearHistory(): void {
		this.usageHistory.length = 0;
	}

	async refreshPricingData(): Promise<void> {
		if (this.includeCost) {
			await this.fetchAndCachePricingData();
		}
	}

	async cleanOldCaches(keepCount = 3): Promise<void> {
		try {
			// List all JSON files in the cache directory
			const files = await fs.readdir(this.cacheDir);
			const cacheFiles = files
				.filter((file) => file.endsWith(".json"))
				.map((file) => path.join(this.cacheDir, file));

			if (cacheFiles.length <= keepCount) {
				return;
			}

			// Sort by modification time (oldest first)
			const fileStats = await Promise.all(
				cacheFiles.map(async (file) => ({
					file,
					mtime: (await fs.stat(file)).mtime,
				})),
			);
			fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

			// Remove all but the most recent files
			const filesToRemove = fileStats.slice(0, -keepCount);
			await Promise.all(
				filesToRemove.map(async ({ file }) => {
					try {
						await fs.unlink(file);
					} catch {
						// Ignore errors when cleaning up
					}
				}),
			);
		} catch (error) {
			console.error("Error cleaning old cache files:", error);
		}
	}

	async ensurePricingLoaded(): Promise<void> {
		if (!this.initialized && this.includeCost) {
			// This will run in the background and won't block
			await this.initialize();
		}
	}
}
