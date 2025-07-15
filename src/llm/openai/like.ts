import type { ChatModel } from "openai/resources/shared";
import type { ReasoningEffort } from "openai/resources/shared";
import { ChatOpenAI } from "./chat";
import type { OpenAIBaseInput } from "./chat";

/**
 * Configuration interface for ChatOpenAILike that extends OpenAIBaseInput
 */
export interface ChatOpenAILikeConfig extends OpenAIBaseInput {
	model: string;
}

/**
 * A class for to interact with any provider using the OpenAI API schema.
 *
 * @param config - Configuration object including the model name
 */
export class ChatOpenAILike extends ChatOpenAI {
	constructor(config: ChatOpenAILikeConfig) {
		super(config);
	}
}
