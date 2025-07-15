/**
 * Utilities for creating optimized JSON schemas for LLM usage
 */

export class SchemaOptimizer {
	/**
	 * Create the most optimized schema by flattening all $ref/$defs while preserving
	 * FULL descriptions and ALL action definitions. Also ensures OpenAI strict mode compatibility.
	 *
	 * @param model - The class/type to optimize (should have a way to generate JSON schema)
	 * @returns Optimized schema with all $refs resolved and strict mode compatibility
	 */
	static createOptimizedJsonSchema(model: any): Record<string, any> {
		// Validate input - should not be undefined or null
		if (model === undefined || model === null) {
			throw new Error(
				`--->SchemaOptimizer.createOptimizedJsonSchema() received ${model === null ? "null" : "undefined"} model. A valid class constructor is required.`,
			);
		}

		// Generate original schema - this assumes the model has a method to generate JSON schema
		// In practice, you might need to use a library like @apidevtools/json-schema-ref-parser
		// or implement your own schema generation logic
		const originalSchema = this.generateSchemaFromModel(model);

		// Extract $defs for reference resolution, then flatten everything
		const defsLookup = originalSchema.$defs || {};

		/**
		 * Apply all optimization techniques including flattening all $ref/$defs
		 */
		const optimizeSchema = (
			obj: any,
			defsLookup: Record<string, any> | null = null,
		): any => {
			if (typeof obj === "object" && obj !== null) {
				if (Array.isArray(obj)) {
					return obj.map((item) => optimizeSchema(item, defsLookup));
				}

				const optimized: Record<string, any> = {};
				let flattenedRef: Record<string, any> | null = null;

				// Skip unnecessary fields AND $defs (we'll inline everything)
				const skipFields = ["additionalProperties", "$defs"];

				for (const [key, value] of Object.entries(obj)) {
					if (skipFields.includes(key)) {
						continue;
					}

					// Skip titles completely
					if (key === "title") {
						continue;
					}

					// Preserve FULL descriptions without truncation
					else if (key === "description") {
						optimized[key] = value;
					}

					// Handle type field
					else if (key === "type") {
						optimized[key] = value;
					}

					// FLATTEN: Resolve $ref by inlining the actual definition
					else if (key === "$ref" && defsLookup) {
						const refPath = (value as string).split("/").pop()!; // Get the definition name from "#/$defs/SomeName"
						if (refPath in defsLookup) {
							// Get the referenced definition and flatten it
							const referencedDef = defsLookup[refPath];
							flattenedRef = optimizeSchema(referencedDef, defsLookup);

							// Don't return immediately - store the flattened ref to merge with siblings
						}
					}

					// Keep all anyOf structures (action unions) and resolve any $refs within
					else if (key === "anyOf" && Array.isArray(value)) {
						// Clean up problematic anyOf structures
						const cleanedAnyOf = this.cleanAnyOfStructure(value, defsLookup);
						if (cleanedAnyOf.length > 0) {
							optimized[key] = cleanedAnyOf;
						}
					}

					// Handle 'not' conditions - remove empty ones or ensure they have proper structure
					else if (key === "not") {
						const cleanedNot = this.cleanNotCondition(value, defsLookup);
						if (cleanedNot !== null) {
							optimized[key] = cleanedNot;
						}
					}

					// Recursively optimize nested structures
					else if (["properties", "items"].includes(key)) {
						optimized[key] = optimizeSchema(value, defsLookup);
					}

					// Keep essential validation fields
					else if (
						[
							"type",
							"required",
							"minimum",
							"maximum",
							"minItems",
							"maxItems",
							"pattern",
							"default",
						].includes(key)
					) {
						optimized[key] =
							typeof value === "object" || Array.isArray(value)
								? optimizeSchema(value, defsLookup)
								: value;
					}

					// Recursively process all other fields
					else {
						optimized[key] =
							typeof value === "object" || Array.isArray(value)
								? optimizeSchema(value, defsLookup)
								: value;
					}
				}

				// If we have a flattened reference, merge it with the optimized properties
				if (flattenedRef !== null && typeof flattenedRef === "object") {
					// Start with the flattened reference as the base
					const result = { ...flattenedRef };

					// Merge in any sibling properties that were processed
					for (const [key, value] of Object.entries(optimized)) {
						// Preserve descriptions from the original object if they exist
						if (key === "description" && !("description" in result)) {
							result[key] = value;
						} else if (key !== "description") {
							// Don't overwrite description from flattened ref
							result[key] = value;
						}
					}

					return result;
				} else {
					// No $ref, just return the optimized object
					// CRITICAL: Add additionalProperties: false to ALL objects for OpenAI strict mode
					if (optimized.type === "object") {
						optimized.additionalProperties = false;
					}

					return optimized;
				}
			}

			return obj;
		};

		// Create optimized schema with flattening
		const optimizedResult = optimizeSchema(originalSchema, defsLookup);

		// Ensure we have a dictionary (should always be the case for schema root)
		if (typeof optimizedResult !== "object" || optimizedResult === null) {
			throw new Error("Optimized schema result is not an object");
		}

		const optimizedSchema: Record<string, any> = optimizedResult;

		// Additional pass to ensure ALL objects have additionalProperties: false
		this.ensureAdditionalPropertiesFalse(optimizedSchema);
		this.makeStrictCompatible(optimizedSchema);

		return optimizedSchema;
	}

	/**
	 * Generate a JSON schema from a model/type
	 * This is a placeholder implementation - in practice you'd use a proper schema generation library
	 */
	private static generateSchemaFromModel(model: any): Record<string, any> {
		// Validate input
		if (model === undefined || model === null) {
			throw new Error(
				`--->generateSchemaFromModel() received ${model === null ? "null" : "undefined"} model. Cannot generate schema from invalid input.`,
			);
		}

		// This is a simplified implementation
		// In practice, you'd integrate with libraries like:
		// - @apidevtools/json-schema-ref-parser
		// - typescript-json-schema
		// - Or use runtime type information from decorators/metadata

		if (typeof model === "function" && model.getJsonSchema) {
			return model.getJsonSchema();
		}

		if (typeof model === "object" && model.schema) {
			return model.schema;
		}
		// Fallback to basic object schema
		// return {
		//   type: "object",
		//   properties: {},
		//   required: [],
		//   additionalProperties: false,
		// };
		// If we reach here, the model doesn't have expected schema generation capabilities
		throw new Error(
			`--->generateSchemaFromModel() received invalid model type: ${typeof model}. Expected a class constructor with getJsonSchema method or an object with schema property.`,
		);
	}

	/**
	 * Clean up anyOf structures to ensure OpenAI strict mode compatibility
	 */
	private static cleanAnyOfStructure(
		anyOfArray: any[],
		defsLookup: Record<string, any> | null = null,
	): any[] {
		const cleanedItems: any[] = [];

		for (const item of anyOfArray) {
			// Skip empty or null items
			if (item === null || item === undefined) {
				continue;
			}

			// If it's an object, recursively clean it
			if (typeof item === "object" && !Array.isArray(item)) {
				const cleanedItem = this.cleanSchemaObject(item, defsLookup);
				if (cleanedItem !== null) {
					cleanedItems.push(cleanedItem);
				}
			} else {
				// For non-object items, include them as-is
				cleanedItems.push(item);
			}
		}

		return cleanedItems;
	}

	/**
	 * Clean up not conditions to ensure they have proper structure
	 */
	private static cleanNotCondition(
		notCondition: any,
		defsLookup: Record<string, any> | null = null,
	): any | null {
		// If it's an empty object, remove it entirely
		if (
			typeof notCondition === "object" &&
			!Array.isArray(notCondition) &&
			Object.keys(notCondition).length === 0
		) {
			return null;
		}

		// If it's a valid object, recursively clean it
		if (typeof notCondition === "object" && !Array.isArray(notCondition)) {
			return this.cleanSchemaObject(notCondition, defsLookup);
		}

		// For other types, return as-is
		return notCondition;
	}

	/**
	 * Clean a schema object to ensure it has proper structure for OpenAI strict mode
	 */
	private static cleanSchemaObject(
		obj: any,
		defsLookup: Record<string, any> | null = null,
	): any | null {
		if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
			return obj;
		}

		const cleaned: Record<string, any> = {};

		// Handle each property
		for (const [key, value] of Object.entries(obj)) {
			if (key === "anyOf" && Array.isArray(value)) {
				const cleanedAnyOf = this.cleanAnyOfStructure(value, defsLookup);
				if (cleanedAnyOf.length > 0) {
					cleaned[key] = cleanedAnyOf;
				}
			} else if (key === "not") {
				const cleanedNot = this.cleanNotCondition(value, defsLookup);
				if (cleanedNot !== null) {
					cleaned[key] = cleanedNot;
				}
			} else if (typeof value === "object" && !Array.isArray(value)) {
				// Recursively clean nested objects
				const cleanedValue = this.cleanSchemaObject(value, defsLookup);
				if (cleanedValue !== null) {
					cleaned[key] = cleanedValue;
				}
			} else {
				// Keep other properties as-is
				cleaned[key] = value;
			}
		}

		// If the object is empty after cleaning, return null
		if (Object.keys(cleaned).length === 0) {
			return null;
		}

		return cleaned;
	}

	/**
	 * Ensure all objects have additionalProperties: false
	 */
	private static ensureAdditionalPropertiesFalse(obj: any): void {
		if (typeof obj === "object" && obj !== null) {
			if (Array.isArray(obj)) {
				for (const item of obj) {
					if (typeof item === "object" || Array.isArray(item)) {
						this.ensureAdditionalPropertiesFalse(item);
					}
				}
			} else {
				// If it's an object type, ensure additionalProperties is false
				if (obj.type === "object") {
					obj.additionalProperties = false;
				}

				// Recursively apply to all values
				for (const value of Object.values(obj)) {
					if (typeof value === "object" || Array.isArray(value)) {
						this.ensureAdditionalPropertiesFalse(value);
					}
				}
			}
		}
	}

	/**
	 * Ensure all properties are required for OpenAI strict mode
	 */
	private static makeStrictCompatible(
		schema: Record<string, any> | any[],
	): void {
		if (Array.isArray(schema)) {
			for (const item of schema) {
				this.makeStrictCompatible(item);
			}
		} else if (typeof schema === "object" && schema !== null) {
			// First recursively apply to nested objects
			for (const [key, value] of Object.entries(schema)) {
				if (
					(typeof value === "object" || Array.isArray(value)) &&
					key !== "required"
				) {
					this.makeStrictCompatible(value);
				}
			}

			// Then update required for this level
			if (
				"properties" in schema &&
				"type" in schema &&
				schema.type === "object"
			) {
				// Add all properties to required array
				const allProps = Object.keys(schema.properties);
				schema.required = allProps; // Set all properties as required
			}
		}
	}
}
