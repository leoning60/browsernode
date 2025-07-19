import bnLogger from "./logging_config";
export const logger = bnLogger;

export { Agent } from "./agent/service";
export { SystemPrompt } from "./agent/prompts";

export { ActionModel } from "./controller/registry/views";
export {
	AgentOutput,
	AgentState,
	AgentHistory,
	AgentHistoryList,
	ActionResult,
} from "./agent/views";
export { Controller } from "./controller/service";
export { Browser, BrowserConfig } from "./browser/browser";
export {
	BrowserContext,
	BrowserContextConfig,
	BrowserSession,
} from "./browser/context";
export { DomService } from "./dom/service";

export {
	BrowserProfile,
	createBrowserProfile,
	STEALTH_PROFILE,
	HEADLESS_PROFILE,
	DEVELOPMENT_PROFILE,
	BrowserChannel,
	ColorScheme,
	ServiceWorkers,
	RecordHarContent,
	RecordHarMode,
	type BrowserProfileOptions,
	type BrowserLaunchArgs,
	type BrowserNewContextArgs,
	type BrowserConnectArgs,
	type BrowserLaunchPersistentContextArgs,
} from "./browser/profile";

export { ChatAnthropic } from "./llm/anthropic/chat";
export { ChatAzureOpenAI } from "./llm/azure/chat";
export { ChatGoogle } from "./llm/google/chat";
// export { ChatGroq } from "./llm/groq/chat";
export { ChatOllama } from "./llm/ollama/chat";
export { ChatOpenAI } from "./llm/openai/chat";

// Export message types
// export type {
// 	BaseMessage,
// 	UserMessage,
// 	SystemMessage,
// 	AssistantMessage,
// 	ContentText,
// 	ContentRefusal,
// 	ContentImage,
// 	ImageURL,
// 	Function,
// 	ToolCall,
// 	SupportedImageMediaType,
// } from "./llm";
