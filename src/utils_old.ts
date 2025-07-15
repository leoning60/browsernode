import type { Logger } from "winston";

import bnLogger from "./logging_config";

const logger: Logger = bnLogger.child({
	module: "browser_node/utils",
});

type AnyFunction<T = unknown, R = unknown> = (this: unknown, ...args: T[]) => R;
function timeExecution(additionalText = "") {
	return function (
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor,
	): PropertyDescriptor {
		const originalMethod = descriptor.value;

		descriptor.value = function (...args: any[]) {
			const startTime = Date.now();
			const result = originalMethod.apply(this, args);

			// handle async result
			if (result instanceof Promise) {
				return result.then((value) => {
					const executionTime = (Date.now() - startTime) / 1000;
					logger.debug(
						`${additionalText} Execution time: ${executionTime.toFixed(2)} seconds`,
					);
					return value;
				});
			}

			// handle sync result
			const executionTime = (Date.now() - startTime) / 1000;
			logger.debug(
				`${additionalText} Execution time: ${executionTime.toFixed(2)} seconds`,
			);
			return result;
		};

		return descriptor;
	};
}
/**
 * Decorator for timing synchronous function execution
 */
function timeExecutionSync(additionalText = "") {
	return function (
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor,
	): PropertyDescriptor {
		const originalMethod = descriptor.value;

		descriptor.value = function (...args: any[]) {
			const startTime = Date.now();
			const result = originalMethod.apply(this, args);
			const executionTime = (Date.now() - startTime) / 1000;
			logger.debug(
				`${additionalText} Execution time: ${executionTime.toFixed(2)} seconds`,
			);
			return result;
		};

		return descriptor;
	};
}

/**
 * Decorator for timing asynchronous function execution
 */
function timeExecutionAsync(additionalText = "") {
	return function (
		target: any,
		propertyKey: string,
		descriptor: PropertyDescriptor,
	): PropertyDescriptor {
		const originalMethod = descriptor.value;

		descriptor.value = async function (...args: any[]) {
			const startTime = Date.now();
			const result = await originalMethod.apply(this, args);
			const executionTime = (Date.now() - startTime) / 1000;
			logger.debug(
				`${additionalText} Execution time: ${executionTime.toFixed(2)} seconds`,
			);
			return result;
		};

		return descriptor;
	};
}

/**
 * Singleton pattern decorator
 */
function singleton<T extends new (...args: any[]) => any>(constructor: T): T {
	let instance: InstanceType<T> | undefined;

	const wrapper = function (this: any, ...args: any[]): InstanceType<T> {
		if (instance === undefined) {
			instance = new constructor(...args);
		}
		return instance!;
	};

	// Copy prototype to ensure instanceof works correctly
	wrapper.prototype = constructor.prototype;

	// Copy static properties from the original constructor to the wrapper
	Object.setPrototypeOf(wrapper, constructor);
	Object.getOwnPropertyNames(constructor).forEach((name) => {
		if (name !== "prototype" && name !== "length" && name !== "name") {
			const descriptor = Object.getOwnPropertyDescriptor(constructor, name);
			if (descriptor) {
				Object.defineProperty(wrapper, name, descriptor);
			}
		}
	});

	return wrapper as unknown as T;
}

export { timeExecutionSync, timeExecutionAsync, singleton, timeExecution };
