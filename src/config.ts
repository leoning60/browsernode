/**
 * Lazy-loading configuration system for browsernode environment variables.
 */

import fs from "fs";
import os from "os";
import path from "path";

// Cache for docker detection
let dockerCheckCache: boolean | null = null;

/**
 * Detect if we are running in a docker container, for the purpose of optimizing chrome launch flags (dev shm usage, gpu settings, etc.)
 */
function isRunningInDocker(): boolean {
	if (dockerCheckCache !== null) {
		return dockerCheckCache;
	}

	try {
		if (fs.existsSync("/.dockerenv")) {
			dockerCheckCache = true;
			return true;
		}

		if (fs.existsSync("/proc/1/cgroup")) {
			const cgroupContent = fs
				.readFileSync("/proc/1/cgroup", "utf8")
				.toLowerCase();
			if (cgroupContent.includes("docker")) {
				dockerCheckCache = true;
				return true;
			}
		}
	} catch (error) {
		// Ignore errors, continue to next check
	}

	try {
		// Check if we're in a container-like environment by looking at process info
		// This is a simplified version since we don't have direct access to psutil
		const isContainerLike =
			process.env.container !== undefined ||
			process.env.DOCKER_CONTAINER !== undefined;
		if (isContainerLike) {
			dockerCheckCache = true;
			return true;
		}
	} catch (error) {
		// Ignore errors
	}

	dockerCheckCache = false;
	return false;
}

/**
 * Lazy-loading configuration class for environment variables
 * (env vars can change at runtime so we need to get them fresh on every access)
 */
class Config {
	// Cache for directory creation tracking
	private static _dirsCreated = false;

	get browsernodeLoggingLevel(): string {
		return (process.env.BROWSERNODE_LOGGING_LEVEL || "info").toLowerCase();
	}

	get anonymizedTelemetry(): boolean {
		return ["t", "y", "1"].includes(
			(process.env.ANONYMIZED_TELEMETRY ?? "true").toLowerCase().charAt(0),
		);
	}

	get browsernodeCloudSync(): boolean {
		return ["t", "y", "1"].includes(
			(
				process.env.BROWSERNODE_CLOUD_SYNC ??
				this.anonymizedTelemetry.toString()
			)
				.toLowerCase()
				.charAt(0),
		);
	}

	get browsernodeCloudApiUrl(): string {
		const url =
			process.env.BROWSERNODE_CLOUD_API_URL || "https://api.browsernode.com";
		if (!url.includes("://")) {
			throw new Error("BROWSERNODE_CLOUD_API_URL must be a valid URL");
		}
		return url;
	}

	get browsernodeCloudUiUrl(): string {
		const url = process.env.BROWSERNODE_CLOUD_UI_URL || "";
		// Allow empty string as default, only validate if set
		if (url && !url.includes("://")) {
			throw new Error("BROWSERNODE_CLOUD_UI_URL must be a valid URL if set");
		}
		return url;
	}

	// Path configuration
	get xdgCacheHome(): string {
		return path.resolve(
			process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
		);
	}

	get xdgConfigHome(): string {
		return path.resolve(
			process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
		);
	}

	get browsernodeConfigDir(): string {
		const configPath = path.resolve(
			process.env.BROWSERNODE_CONFIG_DIR ||
				path.join(this.xdgConfigHome, "browsernode"),
		);
		this._ensureDirs();
		return configPath;
	}

	get browsernodeConfigFile(): string {
		return path.join(this.browsernodeConfigDir, "config.json");
	}

	get browsernodeProfilesDir(): string {
		const profilesPath = path.join(this.browsernodeConfigDir, "profiles");
		this._ensureDirs();
		return profilesPath;
	}

	get browsernodeDefaultUserDataDir(): string {
		return path.join(this.browsernodeProfilesDir, "default");
	}

	/**
	 * Create directories if they don't exist (only once)
	 */
	private _ensureDirs(): void {
		if (!Config._dirsCreated) {
			const configDir = path.resolve(
				process.env.BROWSERNODE_CONFIG_DIR ||
					path.join(this.xdgConfigHome, "browsernode"),
			);
			fs.mkdirSync(configDir, { recursive: true });
			fs.mkdirSync(path.join(configDir, "profiles"), { recursive: true });
			Config._dirsCreated = true;
		}
	}

	// LLM API key configuration
	get openaiApiKey(): string {
		return process.env.OPENAI_API_KEY || "";
	}

	get anthropicApiKey(): string {
		return process.env.ANTHROPIC_API_KEY || "";
	}

	get googleApiKey(): string {
		return process.env.GOOGLE_API_KEY || "";
	}

	get deepseekApiKey(): string {
		return process.env.DEEPSEEK_API_KEY || "";
	}

	get grokApiKey(): string {
		return process.env.GROK_API_KEY || "";
	}

	get novitaApiKey(): string {
		return process.env.NOVITA_API_KEY || "";
	}

	get azureOpenaiEndpoint(): string {
		return process.env.AZURE_OPENAI_ENDPOINT || "";
	}

	get azureOpenaiKey(): string {
		return process.env.AZURE_OPENAI_KEY || "";
	}

	get skipLlmApiKeyVerification(): boolean {
		return ["t", "y", "1"].includes(
			(process.env.SKIP_LLM_API_KEY_VERIFICATION ?? "false")
				.toLowerCase()
				.charAt(0),
		);
	}

	// Runtime hints
	get inDocker(): boolean {
		return (
			["t", "y", "1"].includes(
				(process.env.IN_DOCKER ?? "false").toLowerCase().charAt(0),
			) || isRunningInDocker()
		);
	}

	get isInEvals(): boolean {
		return ["t", "y", "1"].includes(
			(process.env.IS_IN_EVALS ?? "false").toLowerCase().charAt(0),
		);
	}

	get winFontDir(): string {
		return process.env.WIN_FONT_DIR || "C:\\Windows\\Fonts";
	}
}

// Create a singleton instance
export const CONFIG = new Config();
