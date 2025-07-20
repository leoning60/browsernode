import { z } from "zod";
import "reflect-metadata";
import { instanceToPlain, plainToInstance } from "class-transformer";

/**
 * simplify Zod Schema object to readable structure
 * @param schema Zod Schema object
 * @returns simplified structure, showing the type name of each field
 */
interface SchemaInfo {
	[key: string]: string | Record<string, string>;
}

export function simplifyZodSchema(schema: z.ZodObject<any>): SchemaInfo {
	const schemaStructure: SchemaInfo = {};
	const shape = schema.shape;

	for (const key of Object.keys(shape)) {
		const field = shape[key];

		if (field instanceof z.ZodObject) {
			const nestedInfo: Record<string, string> = {};
			const nestedShape = field.shape;

			for (const subKey of Object.keys(nestedShape)) {
				const subField = nestedShape[subKey];
				nestedInfo[subKey] = subField.constructor.name;
			}

			schemaStructure[key] = nestedInfo;
		} else {
			schemaStructure[key] = field.constructor.name;
		}
	}

	return schemaStructure;
}

export function modelDump(obj: any, excludeNone = false): any {
	return instanceToPlain(obj);
}

// export function modelDump(obj: any, excludeNone = false): any {
// 	console.debug("----> modelDump start:", obj);
// 	if (!obj) return null;

// 	// Handle primitive types first (string, number, boolean, null, undefined)
// 	if (typeof obj !== "object" || obj === null) {
// 		return obj;
// 	}

// 	// Handle array types
// 	if (Array.isArray(obj)) {
// 		return obj.map((item) => modelDump(item, excludeNone));
// 	}

// 	// Handle RegExp objects - convert to string
// 	if (obj instanceof RegExp) {
// 		return obj.toString();
// 	}

// 	// Handle Date objects - convert to ISO string
// 	if (obj instanceof Date) {
// 		return obj.toISOString();
// 	}

// 	// Handle regular object types
// 	if (typeof obj === "object") {
// 		const result: Record<string, any> = {};

// 		for (const [key, value] of Object.entries(obj)) {
// 			// Skip null/undefined values if excludeNone is true
// 			if (excludeNone && (value === null || value === undefined)) {
// 				continue;
// 			}

// 			// Special handling for executablePath - ensure it's a string or undefined
// 			if (key === "executablePath") {
// 				if (value === null || value === undefined) {
// 					result[key] = undefined;
// 				} else if (typeof value === "string") {
// 					result[key] = value;
// 				} else {
// 					// If executablePath is set to an object or function, skip it
// 					// This prevents the "expected string, got object" error
// 					console.warn(
// 						`Skipping invalid executablePath value of type ${typeof value}:`,
// 						value,
// 					);
// 					result[key] = undefined;
// 				}
// 				continue;
// 			}

// 			result[key] = modelDump(value, excludeNone);
// 		}

// 		return result;
// 	}
// 	console.debug("----> modelDump return:", obj);
// 	// Return primitive values as is
// 	return obj;
// }

export function modelDumpExcludedUnset<T>(
	model: T,
	excludeUnset: boolean = false,
): Partial<T> {
	const result: Partial<T> = {};

	for (const key in model) {
		if (Object.prototype.hasOwnProperty.call(model, key)) {
			const value = model[key];
			// If excludeUnset is true, only include fields that are neither undefined nor null
			if (!excludeUnset || (value !== undefined && value !== null)) {
				result[key] = value;
			}
		}
	}

	return result;
}

/**
 * TypeScript implementation of Pydantic's model_copy method
 * Creates a copy of an object with optional field updates
 * @param original The original object to copy
 * @param update Optional object with fields to override
 * @returns A new object with original fields and any overrides applied
 */
export function modelCopy<T extends Record<string, any>>(
	original: T,
	update?: Partial<T>,
): T {
	// Create a deep copy of the original object
	const copy = JSON.parse(JSON.stringify(original)) as T;

	// Apply updates if provided
	if (update) {
		for (const key in update) {
			if (Object.prototype.hasOwnProperty.call(update, key)) {
				copy[key] = update[key] as T[typeof key];
			}
		}
	}

	return copy;
}

/**
 * Alternative implementation with more sophisticated deep cloning
 * Handles Date objects, functions, and other complex types better
 * @param original The original object to copy
 * @param update Optional object with fields to override
 * @returns A new object with original fields and any overrides applied
 */
export function modelCopyDeep<T extends Record<string, any>>(
	original: T,
	update?: Partial<T>,
): T {
	// Deep clone function that handles various types
	function deepClone<U>(obj: U): U {
		if (obj === null || typeof obj !== "object") {
			return obj;
		}

		if (obj instanceof Date) {
			return new Date(obj.getTime()) as U;
		}

		if (obj instanceof Array) {
			return obj.map((item) => deepClone(item)) as U;
		}

		if (typeof obj === "object") {
			const cloned = {} as U;
			for (const key in obj) {
				if (Object.prototype.hasOwnProperty.call(obj, key)) {
					cloned[key] = deepClone(obj[key]);
				}
			}
			return cloned;
		}

		return obj;
	}

	// Create a deep copy of the original object
	const copy = deepClone(original);

	// Apply updates if provided
	if (update) {
		for (const key in update) {
			if (Object.prototype.hasOwnProperty.call(update, key)) {
				copy[key] = update[key] as T[typeof key];
			}
		}
	}

	return copy;
}

/**
 * Utility type for ensuring type safety when using modelCopy
 */
export type ModelCopyUpdate<T> = Partial<T>;

/**
 * Enhanced version with validation support
 * @param original The original object to copy
 * @param update Optional object with fields to override
 * @param validator Optional validation function
 * @returns A new object with original fields and any overrides applied
 */
export function modelCopyWithValidation<T extends Record<string, any>>(
	original: T,
	update?: Partial<T>,
	validator?: (obj: T) => boolean,
): T {
	const result = modelCopy(original, update);

	if (validator && !validator(result)) {
		throw new Error("Model validation failed after copy");
	}

	return result;
}

/**
 * TypeScript implementation of Pydantic's model_validate_json method
 * Parses JSON string and validates it against a Zod schema
 * @param schema Zod schema to validate against
 * @param jsonString JSON string to parse and validate
 * @returns Validated and parsed object
 * @throws Error if JSON parsing fails or validation fails
 */
export function modelValidateJson<T>(
	schema: z.ZodType<T>,
	jsonString: string,
): T {
	try {
		// Parse the JSON string
		const parsedData = JSON.parse(jsonString);

		// Validate against the schema
		const validatedData = schema.parse(parsedData);

		return validatedData;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Invalid JSON: ${error.message}`);
		}
		if (error instanceof z.ZodError) {
			throw new Error(
				`Validation error: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
			);
		}
		throw error;
	}
}

/**
 * Safe version of modelValidateJson that returns a result object instead of throwing
 * @param schema Zod schema to validate against
 * @param jsonString JSON string to parse and validate
 * @returns Result object with success/failure status and data/error
 */
export function modelValidateJsonSafe<T>(
	schema: z.ZodType<T>,
	jsonString: string,
): { success: true; data: T } | { success: false; error: string } {
	try {
		const validatedData = modelValidateJson(schema, jsonString);
		return { success: true, data: validatedData };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Batch validation of multiple JSON strings against the same schema
 * @param schema Zod schema to validate against
 * @param jsonStrings Array of JSON strings to validate
 * @returns Array of validated objects
 */
export function modelValidateJsonBatch<T>(
	schema: z.ZodType<T>,
	jsonStrings: string[],
): T[] {
	return jsonStrings.map((jsonString) => modelValidateJson(schema, jsonString));
}

/**
 * Example usage of modelValidateJson function
 *
 * // Define a Zod schema
 * const UserSchema = z.object({
 *   id: z.number(),
 *   name: z.string(),
 *   email: z.string().email(),
 *   age: z.number().optional(),
 * });
 *
 * // JSON string to validate
 * const userJson = '{"id": 1, "name": "John Doe", "email": "john@example.com", "age": 30}';
 *
 * // Validate and parse
 * try {
 *   const user = modelValidateJson(UserSchema, userJson);
 *   console.log(user); // { id: 1, name: "John Doe", email: "john@example.com", age: 30 }
 * } catch (error) {
 *   console.error(error.message);
 * }
 *
 * // Safe version
 * const result = modelValidateJsonSafe(UserSchema, userJson);
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 */
