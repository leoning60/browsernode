export class LLMException extends Error {
	public readonly statusCode: number;
	public readonly message: string;

	constructor(statusCode: number, message: string) {
		super(`Error ${statusCode}: ${message}`);
		this.statusCode = statusCode;
		this.message = message;
		this.name = "LLMException";
	}
}
