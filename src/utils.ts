import { createLogger, format, transports } from "winston";
import type { Logger } from "winston";

const logger: Logger = createLogger({
	level: "debug",
	format: format.combine(
		format.timestamp(),
		format.printf(
			({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`,
		),
	),
	transports: [new transports.Console()],
});

type AnyFunction<T = unknown, R = unknown> = (this: unknown, ...args: T[]) => R;

function timeExecutionSync(additionalText = "") {
	return <T extends AnyFunction<Parameters<T>, ReturnType<T>>>(target: T): T =>
		function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
			const startTime = Date.now();
			const result = target.apply(this, args);
			const executionTime = (Date.now() - startTime) / 1000;
			logger.debug(
				`${additionalText} Execution time: ${executionTime.toFixed(2)} seconds`,
			);
			return result as ReturnType<T>;
		} as T;
}

function timeExecutionAsync(additionalText = "") {
	return <T extends AnyFunction<Parameters<T>, Promise<ReturnType<T>>>>(
		target: T,
	): T =>
		async function (
			this: unknown,
			...args: Parameters<T>
		): Promise<ReturnType<T>> {
			const startTime = Date.now();
			const result = await target.apply(this, args);
			const executionTime = (Date.now() - startTime) / 1000;
			logger.debug(
				`${additionalText} Execution time: ${executionTime.toFixed(2)} seconds`,
			);
			return result as ReturnType<T>;
		} as T;
}

export { timeExecutionSync, timeExecutionAsync };
