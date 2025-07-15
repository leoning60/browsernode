/**
 * Exception classes for LLM models
 *
 */

export class ModelError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelError";
	}
}

export class ModelProviderError extends ModelError {
	/** Exception raised when a model provider returns an error. */
	public readonly statusCode: number;
	public readonly model?: string | null;

	constructor(
		message: string,
		statusCode: number = 502,
		model?: string | null,
	) {
		super(message);
		this.name = "ModelProviderError";
		this.statusCode = statusCode;
		this.model = model;
	}
}

export class ModelRateLimitError extends ModelProviderError {
	/** Exception raised when a model provider returns a rate limit error. */
	constructor(
		message: string,
		statusCode: number = 429,
		model?: string | null,
	) {
		super(message, statusCode, model);
		this.name = "ModelRateLimitError";
	}
}
