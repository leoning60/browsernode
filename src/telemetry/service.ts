import fs from "fs";
import os from "os";
import path from "path";
import { PostHog } from "posthog-node";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "winston";

import { CONFIG } from "../config";
import bnLogger from "../logging_config";
import { singleton } from "../utils_old";
import { BaseTelemetryEvent } from "./views";

const logger: Logger = bnLogger.child({
	module: "browsernode/telemetry/service",
});

// interface Config {
// 	anonymizedTelemetry?: boolean;
// 	browsernodeLoggingLevel?: string;
// 	xdgCacheHome?: string;
// }

// Configuration from environment variables
// const CONFIG: Config = {
// 	anonymizedTelemetry: process.env.ANONYMIZED_TELEMETRY !== "false",
// 	browsernodeLoggingLevel: process.env.BROWSERNODE_LOGGING_LEVEL || "info",
// 	xdgCacheHome: process.env.XDG_CACHE_HOME,
// };

const POSTHOG_EVENT_SETTINGS = {
	processPersonProfile: true,
};

function xdgCacheHome(): string {
	const defaultPath = path.join(os.homedir(), ".cache");
	if (CONFIG.xdgCacheHome && path.isAbsolute(CONFIG.xdgCacheHome)) {
		return CONFIG.xdgCacheHome;
	}
	return defaultPath;
}

@singleton
export class ProductTelemetry {
	/**
	 * Service for capturing anonymized telemetry data.
	 *
	 * If the environment variable `ANONYMIZED_TELEMETRY=false`, anonymized telemetry will be disabled.
	 */

	private static readonly USER_ID_PATH = path.join(
		xdgCacheHome(),
		"browsernode",
		"telemetry_user_id",
	);
	private static readonly PROJECT_API_KEY =
		"phc_F8JMNjW1i2KbGUTaW1unnDdLSPCoyc52SGRU0JecaUh";
	private static readonly HOST = "https://eu.i.posthog.com";
	private static readonly UNKNOWN_USER_ID = "UNKNOWN";

	private currentUserId: string | null = null;
	private posthogClient: PostHog | null = null;
	private debugLogging: boolean;

	constructor() {
		const telemetryDisabled = !CONFIG.anonymizedTelemetry;
		this.debugLogging = CONFIG.browsernodeLoggingLevel === "debug";

		if (telemetryDisabled) {
			this.posthogClient = null;
		} else {
			logger.info(
				"Anonymized telemetry enabled. See https://docs.browsernode.com/development/telemetry for more information.",
			);
			this.posthogClient = new PostHog(ProductTelemetry.PROJECT_API_KEY, {
				host: ProductTelemetry.HOST,
				disableGeoip: false,
				enableExceptionAutocapture: true,
			});

			// Silence PostHog logging if not in debug mode
			if (!this.debugLogging) {
				// PostHog Node.js client uses different logging approach
				// We'll handle this at the application level
			}
		}

		if (this.posthogClient === null) {
			logger.debug("Telemetry disabled");
		}
	}

	capture(event: BaseTelemetryEvent): void {
		if (this.posthogClient === null) {
			return;
		}

		this.directCapture(event);
	}

	private directCapture(event: BaseTelemetryEvent): void {
		/**
		 * Should not be thread blocking because PostHog handles it asynchronously
		 */
		if (this.posthogClient === null) {
			return;
		}

		try {
			this.posthogClient.capture({
				distinctId: this.userId,
				event: event.name,
				properties: { ...event.properties, ...POSTHOG_EVENT_SETTINGS },
			});
		} catch (error) {
			logger.error(`Failed to send telemetry event ${event.name}: ${error}`);
		}
	}

	flush(): void {
		if (this.posthogClient) {
			try {
				this.posthogClient.flush();
				logger.debug("PostHog client telemetry queue flushed.");
			} catch (error) {
				logger.error(`Failed to flush PostHog client: ${error}`);
			}
		} else {
			logger.debug("PostHog client not available, skipping flush.");
		}
	}

	async shutdown(): Promise<void> {
		if (this.posthogClient) {
			try {
				await this.posthogClient.shutdown();
				logger.debug("PostHog client shut down.");
			} catch (error) {
				logger.error(`Failed to shutdown PostHog client: ${error}`);
			}
		}
	}

	get userId(): string {
		if (this.currentUserId) {
			return this.currentUserId;
		}

		// File access may fail due to permissions or other reasons. We don't want to
		// crash so we catch all exceptions.
		try {
			const userIdPath = path.join(
				xdgCacheHome(),
				"browsernode",
				"telemetry_user_id",
			);

			if (!fs.existsSync(userIdPath)) {
				fs.mkdirSync(path.dirname(userIdPath), {
					recursive: true,
				});
				const newUserId = uuidv4();
				fs.writeFileSync(userIdPath, newUserId);
				this.currentUserId = newUserId;
			} else {
				this.currentUserId = fs.readFileSync(userIdPath, "utf8");
			}
		} catch (error) {
			this.currentUserId = ProductTelemetry.UNKNOWN_USER_ID;
		}
		return this.currentUserId;
	}
}
