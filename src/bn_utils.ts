import { z } from "zod";

/**
 * simplify Zod Schema object to readable structure
 * @param schema Zod Schema object
 * @returns simplified structure, showing the type name of each field
 */
export function simplifyZodSchema(schema: z.ZodObject<any>) {
	interface SchemaInfo {
		[key: string]: string | Record<string, string>;
	}

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
	if (!obj) return null;

	// Handle array types
	if (Array.isArray(obj)) {
		return obj.map((item) => modelDump(item, excludeNone));
	}

	// Handle object types
	if (typeof obj === "object" && obj !== null) {
		const result: Record<string, any> = {};

		for (const [key, value] of Object.entries(obj)) {
			// Skip null/undefined values if excludeNone is true
			if (excludeNone && (value === null || value === undefined)) {
				continue;
			}

			result[key] = modelDump(value, excludeNone);
		}

		return result;
	}

	// Return primitive values as is
	return obj;
}

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
