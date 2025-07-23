import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

export abstract class BaseEvent {
	// Base class for all events
}

export class EventBus extends EventEmitter {
	name: string;
	walPath: string;
	_stopped: boolean = false;

	constructor({ name, walPath }: { name: string; walPath: string }) {
		super();
		this.name = name;
		this.walPath = walPath;

		// 确保路径存在
		const dir = path.dirname(walPath);
		fs.mkdirSync(dir, { recursive: true });
	}

	emit(eventName: string, data: any) {
		// Don't emit events if stopped
		if (this._stopped) {
			return false;
		}

		const event = {
			timestamp: new Date().toISOString(),
			event: eventName,
			data: data,
			name: this.name,
		};

		// Write to WAL
		try {
			fs.appendFileSync(this.walPath, JSON.stringify(event) + "\n", "utf-8");
		} catch (error) {
			// Silently handle write errors when stopped
			if (!this._stopped) {
				throw error;
			}
		}

		// Call parent class emit
		return super.emit(eventName, data);
	}

	// Dispatch method for sending events through the bus
	dispatch(event: any) {
		if (!event || this._stopped) {
			return;
		}

		// Extract event type and data from the event object
		let eventType: string;
		let eventData: any;

		if (typeof event === "string") {
			eventType = event;
			eventData = {};
		} else if (event.type || event.eventType) {
			eventType = event.type || event.eventType;
			eventData = event;
		} else if (event.constructor && event.constructor.name) {
			// Use class name as event type for typed events
			eventType = event.constructor.name;
			eventData = event;
		} else {
			eventType = "unknown";
			eventData = event;
		}

		// Emit the event
		this.emit(eventType, eventData);
	}

	/**
	 * Stop the event bus gracefully
	 * @param timeout - Timeout in seconds to wait for pending events
	 */
	async stop(timeout: number = 5.0): Promise<void> {
		if (this._stopped) {
			return;
		}

		this._stopped = true;

		// Create a promise that resolves when all listeners are done
		const stopPromise = new Promise<void>((resolve) => {
			// Wait for any pending events to complete
			setImmediate(() => {
				try {
					// Remove all listeners
					this.removeAllListeners();

					// Final WAL entry to mark shutdown
					const shutdownEvent = {
						timestamp: new Date().toISOString(),
						event: "EventBusShutdown",
						data: { name: this.name },
						name: this.name,
					};

					fs.appendFileSync(
						this.walPath,
						JSON.stringify(shutdownEvent) + "\n",
						"utf-8",
					);
				} catch (error) {
					// Ignore errors during shutdown
				}
				resolve();
			});
		});

		// Race between timeout and graceful shutdown
		const timeoutPromise = new Promise<void>((resolve) => {
			setTimeout(() => {
				resolve();
			}, timeout * 1000);
		});

		await Promise.race([stopPromise, timeoutPromise]);
	}

	/**
	 * Check if the event bus is stopped
	 */
	get stopped(): boolean {
		return this._stopped;
	}
}
