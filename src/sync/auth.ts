/**
 * OAuth2 Device Authorization Grant flow client for browsernode.
 */

import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { Logger } from "winston";
import { CONFIG } from "../config";
import bnLogger from "../logging_config";

const logger: Logger = bnLogger.child({
	module: "browsernode/sync/auth",
});

// Temporary user ID for pre-auth events (matches cloud backend)
const TEMP_USER_ID = "99999999-9999-9999-9999-999999999999";

/**
 * OAuth2 device authorization response
 */
interface DeviceAuthResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	expires_in: number;
	interval?: number;
}

/**
 * OAuth2 token response
 */
// interface TokenResponse {
// 	access_token?: string;
// 	user_id?: string;
// 	error?: string;
// 	error_description?: string;
// 	interval?: number;
// }

/**
 * Get or create a persistent device ID for this installation.
 */
function getOrCreateDeviceId(): string {
	const deviceIdPath = path.join(CONFIG.browsernodeConfigDir, "device_id");

	// Try to read existing device ID
	if (fs.existsSync(deviceIdPath)) {
		try {
			const deviceId = fs.readFileSync(deviceIdPath, "utf8").trim();
			if (deviceId) {
				return deviceId;
			}
		} catch (error) {
			// If we can't read it, we'll create a new one
		}
	}

	// Create new device ID
	const deviceId = randomUUID();

	// Ensure config directory exists
	fs.mkdirSync(CONFIG.browsernodeConfigDir, { recursive: true });

	// Write device ID to file
	fs.writeFileSync(deviceIdPath, deviceId);

	return deviceId;
}

/**
 * Configuration for cloud authentication
 */
export class CloudAuthConfig {
	apiToken?: string | null;
	userId?: string | null;
	authorizedAt?: Date | null;

	constructor(
		data: {
			apiToken?: string | null;
			userId?: string | null;
			authorizedAt?: Date | null;
		} = {},
	) {
		this.apiToken = data.apiToken;
		this.userId = data.userId;
		this.authorizedAt = data.authorizedAt;
	}

	/**
	 * Load auth config from local file
	 */
	static loadFromFile(): CloudAuthConfig {
		const configPath = path.join(
			CONFIG.browsernodeConfigDir,
			"cloud_auth.json",
		);

		if (fs.existsSync(configPath)) {
			try {
				const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
				return new CloudAuthConfig({
					apiToken: data.apiToken || data.api_token || null,
					userId: data.userId || data.user_id || null,
					authorizedAt:
						data.authorizedAt || data.authorized_at
							? new Date(data.authorizedAt || data.authorized_at)
							: null,
				});
			} catch (error) {
				// Return empty config if file is corrupted
				logger.warn("Failed to load cloud auth config, using empty config", {
					error,
				});
			}
		}
		return new CloudAuthConfig();
	}

	/**
	 * Save auth config to local file
	 */
	saveToFile(): void {
		fs.mkdirSync(CONFIG.browsernodeConfigDir, { recursive: true });

		const configPath = path.join(
			CONFIG.browsernodeConfigDir,
			"cloud_auth.json",
		);
		const data = {
			apiToken: this.apiToken,
			userId: this.userId,
			authorizedAt: this.authorizedAt?.toISOString() || null,
		};

		fs.writeFileSync(configPath, JSON.stringify(data, null, 2));

		// Set restrictive permissions (owner read/write only) for security
		try {
			fs.chmodSync(configPath, 0o600);
		} catch (error) {
			// Some systems may not support chmod, continue anyway
			logger.warn("Failed to set restrictive permissions on auth config file", {
				error,
			});
		}
	}
}

/**
 * Client for OAuth2 device authorization flow
 */
export class DeviceAuthClient {
	private baseUrl: string;
	private clientId: string;
	private scope: string;
	private tempUserId: string;
	deviceId: string;
	private authConfig: CloudAuthConfig;

	constructor(baseUrl?: string) {
		// Backend API URL for OAuth requests - can be passed directly or defaults to env var
		this.baseUrl =
			baseUrl || CONFIG.browsernodeCloudApiUrl || "https://api.browsernode.com";
		this.clientId = "library";
		this.scope = "read write";

		// Temporary user ID for pre-auth events
		this.tempUserId = TEMP_USER_ID;

		// Get or create persistent device ID
		this.deviceId = getOrCreateDeviceId();

		// Load existing auth if available
		this.authConfig = CloudAuthConfig.loadFromFile();
	}

	/**
	 * Check if we have valid authentication
	 */
	get isAuthenticated(): boolean {
		return !!(this.authConfig.apiToken && this.authConfig.userId);
	}

	/**
	 * Get the current API token
	 */
	get apiToken(): string | null | undefined {
		return this.authConfig.apiToken;
	}

	/**
	 * Get the current user ID (temporary or real)
	 */
	get userId(): string {
		return this.authConfig.userId || this.tempUserId;
	}

	/**
	 * Start the device authorization flow.
	 * Returns device authorization details including user code and verification URL.
	 */
	async startDeviceAuthorization(
		agentSessionId?: string,
	): Promise<DeviceAuthResponse> {
		const url = `${this.baseUrl.replace(/\/$/, "")}/api/v1/oauth/device/authorize`;
		const body = new URLSearchParams({
			client_id: this.clientId,
			scope: this.scope,
			device_id: this.deviceId,
		});

		if (agentSessionId) {
			body.append("agent_session_id", agentSessionId);
		}

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: body.toString(),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			return (await response.json()) as DeviceAuthResponse;
		} catch (error) {
			logger.error("Failed to start device authorization", { error, url });
			throw error;
		}
	}

	/**
	 * Poll for the access token.
	 * Returns token info when authorized, null if timeout.
	 */
	async pollForToken(
		deviceCode: string,
		interval: number = 3.0,
		timeout: number = 1800.0,
	): Promise<any | null> {
		const startTime = Date.now();
		const url = `${this.baseUrl.replace(/\/$/, "")}/api/v1/oauth/device/token`;

		while (Date.now() - startTime < timeout * 1000) {
			try {
				const body = new URLSearchParams({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					device_code: deviceCode,
					client_id: this.clientId,
				});

				const response = await fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: body.toString(),
				});

				if (response.status === 200) {
					const data = (await response.json()) as any;

					// Check for pending authorization
					if (data.error === "authorization_pending") {
						await this.sleep(interval * 1000);
						continue;
					}

					// Check for slow down
					if (data.error === "slow_down") {
						interval = data.interval || interval * 2;
						await this.sleep(interval * 1000);
						continue;
					}

					// Check for other errors
					if (data.error) {
						logger.error(
							`OAuth error: ${data.error_description || data.error}`,
						);
						return null;
					}

					// Success! We have a token
					if (data.access_token) {
						return data;
					}
				} else if (response.status === 400) {
					// Error response
					const data = (await response.json()) as any;
					if (
						!["authorization_pending", "slow_down"].includes(data.error || "")
					) {
						logger.error(
							`OAuth error: ${data.error_description || "Unknown error"}`,
						);
						return null;
					}
				} else {
					logger.error(`Unexpected status code: ${response.status}`);
					return null;
				}
			} catch (error) {
				logger.error("Error polling for token", { error });
			}

			await this.sleep(interval * 1000);
		}

		return null;
	}

	/**
	 * Run the full authentication flow.
	 * Returns true if authentication successful.
	 */
	async authenticate(
		agentSessionId?: string,
		showInstructions: boolean = true,
	): Promise<boolean> {
		try {
			// Start device authorization
			const deviceAuth = await this.startDeviceAuthorization(agentSessionId);

			// Use frontend URL for user-facing links
			const frontendUrl =
				CONFIG.browsernodeCloudUiUrl ||
				this.baseUrl.replace("//api.", "//cloud.");

			// Replace backend URL with frontend URL in verification URIs
			const verificationUri = deviceAuth.verification_uri.replace(
				this.baseUrl,
				frontendUrl,
			);
			const verificationUriComplete =
				deviceAuth.verification_uri_complete.replace(this.baseUrl, frontendUrl);

			const terminalWidth = process.stdout.columns || 80;
			if (showInstructions) {
				logger.info("─".repeat(terminalWidth - 1));
				logger.info("🌐  View the details of this run in BrowserNode Cloud:");
				logger.info(`    👉  ${verificationUriComplete}`);
				logger.info("─".repeat(terminalWidth - 1) + "\n");
			}

			// Poll for token
			const tokenData = await this.pollForToken(
				deviceAuth.device_code,
				deviceAuth.interval || 5,
			);

			if (tokenData && tokenData.access_token) {
				// Save authentication
				this.authConfig.apiToken = tokenData.access_token;
				this.authConfig.userId = tokenData.user_id || this.tempUserId;
				this.authConfig.authorizedAt = new Date();
				this.authConfig.saveToFile();

				if (showInstructions) {
					logger.info(
						"✅  Authentication successful! Cloud sync is now enabled.",
					);
				}

				return true;
			}
		} catch (error: any) {
			// Handle different types of errors
			if (error.message?.includes("404")) {
				logger.warn(
					"Cloud sync authentication endpoint not found (404). Check your BROWSERNODE_CLOUD_API_URL setting.",
				);
			} else if (error.message?.includes("HTTP")) {
				logger.warn(
					`Failed to authenticate with cloud service: ${error.message}`,
				);
			} else {
				logger.warn(
					`Failed to connect to cloud service: ${error.constructor.name}: ${error.message}`,
				);
			}
		}

		if (showInstructions) {
			logger.info("❌ Authentication failed or timed out");
		}

		return false;
	}

	/**
	 * Get headers for API requests
	 */
	getHeaders(): Record<string, string> {
		if (this.apiToken) {
			return { Authorization: `Bearer ${this.apiToken}` };
		}
		return {};
	}

	/**
	 * Clear stored authentication
	 */
	clearAuth(): void {
		this.authConfig = new CloudAuthConfig();
		this.authConfig.saveToFile();
	}

	/**
	 * Sleep utility function
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

export { getOrCreateDeviceId, TEMP_USER_ID };
