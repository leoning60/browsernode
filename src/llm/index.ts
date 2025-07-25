/**
 * We have switched all of our code from langchain to openai.types.chat.chat_completion_message_param.
 * For easier transition we have created this file to export the types we need.
 */

// Chat models
export { ChatAnthropic } from "./anthropic/chat";
// export { ChatAnthropicBedrock } from "./aws/chatAnthropic";
// export { ChatAWSBedrock } from "./aws/chatBedrock";
export { ChatAzureOpenAI } from "./azure/chat";
export { ChatGoogle } from "./google/chat";
// export { ChatGroq } from "./groq/chat";
export { ChatOllama } from "./ollama/chat";
export { ChatOpenAI } from "./openai/chat";
export { ChatOpenRouter } from "./openrouter/chat";

// Core types and interfaces
export type { BaseChatModel } from "./base";

// Message types -> for easier transition from langchain
export type {
	BaseMessage,
	UserMessage,
	SystemMessage,
	AssistantMessage,
} from "./messages";

// Content parts with better names
export type {
	ContentPartTextParam as ContentText,
	ContentPartRefusalParam as ContentRefusal,
	ContentPartImageParam as ContentImage,
} from "./messages";

// Additional message types
export type {
	ImageURL,
	Function,
	ToolCall,
	SupportedImageMediaType,
} from "./messages";

export { getMessageText } from "./messages";

export type { ChatInvokeUsage, ChatInvokeCompletion } from "./views";
export {
	ModelError,
	ModelProviderError,
	ModelRateLimitError,
} from "./exceptions";
export { SchemaOptimizer } from "./schema";
