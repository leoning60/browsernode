/**
 * Cloud sync service for sending events to the Browsernode cloud.
 */

import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs/promises";
import { Logger } from "winston";
import type {
	CreateAgentOutputFileEvent,
	CreateAgentSessionEvent,
	CreateAgentStepEvent,
	CreateAgentTaskEvent,
	UpdateAgentTaskEvent,
} from "../agent/cloud_events";
import { CONFIG } from "../config";
import bnLogger from "../logging_config";
import { DeviceAuthClient } from "./auth";

const logger: Logger = bnLogger.child({
	module: "browsernode/sync/service",
});

// Temporary user ID for unauthenticated users
const TEMP_USER_ID = "temp-user";

// Union type for all possible events
type BaseEvent =
	| CreateAgentSessionEvent
	| CreateAgentStepEvent
	| CreateAgentTaskEvent
	| UpdateAgentTaskEvent
	| CreateAgentOutputFileEvent;

/**
 * Service for syncing events to the Browsernode cloud
 */
export class CloudSync {
	private baseUrl: string;
	private enableAuth: boolean;
	private authClient: DeviceAuthClient | null;
	private pendingEvents: BaseEvent[] = [];
	private authTask: Promise<void> | null = null;
	private sessionId: string | null = null;

	constructor(baseUrl?: string, enableAuth: boolean = true) {
		// Backend API URL for all API requests - can be passed directly or defaults to env var
		this.baseUrl = baseUrl || CONFIG.browsernodeCloudApiUrl;
		this.enableAuth = enableAuth;
		this.authClient = enableAuth ? new DeviceAuthClient(this.baseUrl) : null;
		this.pendingEvents = [];
		this.authTask = null;
		this.sessionId = null;
	}

	/**
	 * Handle an event by sending it to the cloud
	 */
	async handleEvent(event: BaseEvent): Promise<void> {
		try {
			// Extract session ID from CreateAgentSessionEvent
			if ("agentSessionId" in event) {
				this.sessionId = String(event.id);
			}

			// Start authentication flow on first step (after first LLM response)
			if ("step" in event && typeof event.step === "number") {
				const step = event.step;
				// logger.debug(`Got CreateAgentStepEvent with step=${step}`);
				// Trigger on the first step (step=2 because n_steps is incremented before actions)
				if (
					step === 2 &&
					this.enableAuth &&
					this.authClient &&
					(!this.authTask || this.authTask === null)
				) {
					if (this.sessionId) {
						// logger.info('Triggering auth on first step event');
						// Always run auth to show the cloud URL, even if already authenticated
						this.authTask = this.backgroundAuth(this.sessionId);
					} else {
						logger.warn("Cannot start auth - sessionId not set yet");
					}
				}
			}

			// Send event to cloud
			await this.sendEvent(event);
		} catch (error: any) {
			logger.error(
				`Failed to handle ${this.getEventType(event)} event: ${error.constructor.name}: ${error.message}`,
				{ error },
			);
		}
	}

	/**
	 * Send event to cloud API
	 */
	private async sendEvent(event: BaseEvent): Promise<void> {
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};

			// Override user_id on event with auth client user_id if available
			if (this.authClient) {
				(event as any).userId = String(this.authClient.userId);
			} else {
				(event as any).userId = TEMP_USER_ID;
			}

			// Add auth headers if available
			if (this.authClient) {
				Object.assign(headers, this.authClient.getHeaders());
			}

			// Send event (batch format with direct BaseEvent serialization)
			const eventData = { ...event };
			if (this.authClient && this.authClient.deviceId) {
				(eventData as any).deviceId = this.authClient.deviceId;
			}

			const response = await fetch(
				`${this.baseUrl.replace(/\/$/, "")}/api/v1/events`,
				{
					method: "POST",
					headers,
					body: JSON.stringify({ events: [eventData] }),
					signal: AbortSignal.timeout(10000), // 10 second timeout
				},
			);

			if (
				response.status === 401 &&
				this.authClient &&
				!this.authClient.isAuthenticated
			) {
				// Store event for retry after auth
				this.pendingEvents.push(event);
			} else if (response.status >= 400) {
				// Log error but don't raise - we want to fail silently
				const responseText = await response.text();
				logger.debug(
					`Failed to send sync event: POST ${response.url} ${response.status} - ${responseText}`,
				);
			}
		} catch (error: any) {
			if (error.name === "TimeoutError") {
				logger.warn(`⚠️ Event send timed out after 10 seconds: ${event}`);
			} else if (
				error.name === "TypeError" &&
				error.message.includes("fetch")
			) {
				logger.warn(
					`⚠️ Failed to connect to cloud service at ${this.baseUrl}: ${error.message}`,
				);
			} else if (error.name === "AbortError") {
				logger.warn(
					`⚠️ HTTP error sending event ${event}: ${error.name}: ${error.message}`,
				);
			} else {
				logger.warn(
					`⚠️ Unexpected error sending event ${event}: ${error.constructor.name}: ${error.message}`,
				);
			}
		}
	}

	/**
	 * Run authentication in background or show cloud URL if already authenticated
	 */
	private async backgroundAuth(agentSessionId: string): Promise<void> {
		if (!this.authClient) {
			throw new Error(
				"enableAuth=true must be set before calling CloudSync.backgroundAuth()",
			);
		}
		if (!this.sessionId) {
			throw new Error(
				"sessionId must be set before calling CloudSync.backgroundAuth()",
			);
		}

		try {
			// If already authenticated, just show the cloud URL
			if (this.authClient.isAuthenticated) {
				// Use frontend URL for user-facing links
				const frontendUrl =
					CONFIG.browsernodeCloudUiUrl ||
					this.baseUrl.replace("//api.", "//cloud.");
				const sessionUrl = `${frontendUrl.replace(/\/$/, "")}/agent/${agentSessionId}`;

				logger.info("\n\n" + "─".repeat(70));
				logger.info("🌐  View the details of this run in Browsernode Cloud:");
				logger.info(`    👉  ${sessionUrl}`);
				logger.info("─".repeat(70) + "\n");
				return;
			}

			// Otherwise run full authentication
			const success = await this.authClient.authenticate(
				agentSessionId,
				true, // showInstructions
			);

			if (success) {
				// Resend any pending events
				await this.resendPendingEvents();

				// Update WAL events with real user_id
				await this.updateWalUserIds(agentSessionId);
			}
		} catch (error: any) {
			logger.debug(`Cloud sync authentication failed: ${error.message}`);
		}
	}

	/**
	 * Resend events that were queued during auth
	 */
	private async resendPendingEvents(): Promise<void> {
		if (this.pendingEvents.length === 0) {
			return;
		}

		// Send all pending events
		for (const event of this.pendingEvents) {
			try {
				await this.sendEvent(event);
			} catch (error: any) {
				logger.warn(`Failed to resend pending event: ${error.message}`);
			}
		}

		this.pendingEvents = [];
	}

	/**
	 * Update user IDs in WAL file after authentication
	 */
	private async updateWalUserIds(sessionId: string): Promise<void> {
		try {
			if (!this.authClient) {
				throw new Error(
					"Cloud sync must be authenticated to update WAL user ID",
				);
			}

			const walPath = path.join(
				CONFIG.browsernodeConfigDir,
				"events",
				`${sessionId}.jsonl`,
			);

			try {
				await fs.access(walPath);
			} catch {
				throw new Error(
					`CloudSync failed to update saved event user_ids after auth: Agent EventBus WAL file not found: ${walPath}`,
				);
			}

			// Read all events
			const events: any[] = [];
			const content = await fs.readFile(walPath, "utf8");
			for (const line of content.split("\n")) {
				if (line.trim()) {
					events.push(JSON.parse(line));
				}
			}

			// Update user_id and device_id
			const userId = this.authClient.userId;
			const deviceId = this.authClient.deviceId;
			for (const event of events) {
				if ("userId" in event) {
					event.userId = userId;
				}
				// Add device_id to all events
				event.deviceId = deviceId;
			}

			// Write back
			const updatedContent =
				events.map((event) => JSON.stringify(event)).join("\n") + "\n";
			await fs.writeFile(walPath, updatedContent);
		} catch (error: any) {
			logger.warn(`Failed to update WAL user IDs: ${error.message}`);
		}
	}

	/**
	 * Wait for authentication to complete if in progress
	 */
	async waitForAuth(): Promise<void> {
		if (this.authTask && this.authTask !== null) {
			await this.authTask;
		}
	}

	/**
	 * Authenticate with the cloud service
	 */
	async authenticate(showInstructions: boolean = true): Promise<boolean> {
		if (!this.authClient) {
			return false;
		}

		return await this.authClient.authenticate(
			this.sessionId || undefined,
			showInstructions,
		);
	}

	/**
	 * Get the event type for logging purposes
	 */
	private getEventType(event: BaseEvent): string {
		// Try to determine event type from the event structure
		if ("agentSessionId" in event && "browserSessionId" in event) {
			return "CreateAgentSessionEvent";
		}
		if ("step" in event && "agentTaskId" in event) {
			return "CreateAgentStepEvent";
		}
		if ("task" in event && "llmModel" in event) {
			return "CreateAgentTaskEvent";
		}
		if ("stopped" in event || "paused" in event) {
			return "UpdateAgentTaskEvent";
		}
		if ("fileName" in event && "fileContent" in event) {
			return "CreateAgentOutputFileEvent";
		}
		return "UnknownEvent";
	}
}
