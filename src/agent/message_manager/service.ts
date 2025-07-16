import type {
	AssistantMessage,
	BaseMessage,
	ContentPartTextParam,
	SystemMessage,
	UserMessage,
} from "../../llm/messages";
import {
	createAssistantMessage,
	createSystemMessage,
	createUserMessage,
	getMessageText,
} from "../../llm/messages";

import { modelDump } from "../../bn_utils";
import type { BrowserStateSummary } from "../../browser/views";
import type { FileSystem } from "../../filesystem/file_system";
import bnLogger from "../../logging_config";
import { matchUrlWithDomainPattern } from "../../utils";
import { timeExecution } from "../../utils_old";
import { AgentMessagePrompt } from "../prompts";
import type { ActionResult, AgentOutput, AgentStepInfo } from "../views";
import { HistoryItem, MessageManagerState } from "./views";

// Create logger
const logger = bnLogger.child({
	module: "browsernode/agent/message_manager/service",
});

// ========== Logging Helper Functions ==========
// These functions are used ONLY for formatting debug log output.
// They do NOT affect the actual message content sent to the LLM.
// All logging functions start with _log_ for easy identification.

function _logGetMessageEmoji(message: BaseMessage): string {
	/**Get emoji for a message type - used only for logging display*/
	const emojiMap: Record<string, string> = {
		UserMessage: "💬",
		SystemMessage: "🧠",
		AssistantMessage: "🔨",
	};
	return emojiMap[message.constructor.name] || "🎮";
}

function _logFormatMessageLine(
	message: BaseMessage,
	content: string,
	isLastMessage: boolean,
	terminalWidth: number,
): string[] {
	/**Format a single message for logging display*/
	try {
		const lines: string[] = [];

		// Get emoji and token info
		const emoji = _logGetMessageEmoji(message);
		// TODO: fix the token count
		const tokenStr = "??? (TODO)";
		const prefix = `${emoji}[${tokenStr}]: `;

		// Calculate available width (emoji=2 visual cols + [token]: =8 chars)
		const contentWidth = terminalWidth - 10;

		// Handle last message wrapping
		if (isLastMessage && content.length > contentWidth) {
			// Find a good break point
			const breakPoint = content.lastIndexOf(" ", contentWidth);
			let firstLine: string;
			let rest: string;
			if (breakPoint > contentWidth * 0.7) {
				// Keep at least 70% of line
				firstLine = content.substring(0, breakPoint);
				rest = content.substring(breakPoint + 1);
			} else {
				// No good break point, just truncate
				firstLine = content.substring(0, contentWidth);
				rest = content.substring(contentWidth);
			}

			lines.push(prefix + firstLine);

			// Second line with 10-space indent
			if (rest) {
				if (rest.length > terminalWidth - 10) {
					rest = rest.substring(0, terminalWidth - 10);
				}
				lines.push(" ".repeat(10) + rest);
			}
		} else {
			// Single line - truncate if needed
			if (content.length > contentWidth) {
				content = content.substring(0, contentWidth);
			}
			lines.push(prefix + content);
		}

		return lines;
	} catch (e) {
		logger.warn(`Failed to format message line for logging: ${e}`);
		// Return a simple fallback line
		return ["❓[   ?]: [Error formatting message]"];
	}
}

// ========== End of Logging Helper Functions ==========

export class MessageManager {
	private task: string;
	state: MessageManagerState;
	systemPrompt: SystemMessage;
	fileSystem: FileSystem;
	sensitiveDataDescription: string = "";
	availableFilePaths: string[] | null;
	private useThinking: boolean;
	private maxHistoryItems: number | null;

	// Store settings as direct attributes instead of in a settings object
	private includeAttributes: string[];
	private messageContext: string | null;
	private sensitiveData: Record<string, string | Record<string, string>> | null;
	private lastInputMessages: BaseMessage[] = [];

	constructor(params: {
		task: string;
		systemMessage: SystemMessage;
		fileSystem: FileSystem;
		availableFilePaths?: string[] | null;
		state?: MessageManagerState;
		useThinking?: boolean;
		includeAttributes?: string[] | null;
		messageContext?: string | null;
		sensitiveData?: Record<string, string | Record<string, string>> | null;
		maxHistoryItems?: number | null;
	}) {
		this.task = params.task;
		this.state = params.state || new MessageManagerState();
		this.systemPrompt = params.systemMessage;
		this.fileSystem = params.fileSystem;
		this.availableFilePaths = params.availableFilePaths || null;
		this.useThinking = params.useThinking ?? true;
		this.maxHistoryItems = params.maxHistoryItems || null;

		// Validate maxHistoryItems
		if (this.maxHistoryItems !== null && this.maxHistoryItems <= 5) {
			throw new Error("maxHistoryItems must be null or greater than 5");
		}

		// Store settings as direct attributes
		this.includeAttributes = params.includeAttributes || [];
		this.messageContext = params.messageContext || null;
		this.sensitiveData = params.sensitiveData || null;

		// Only initialize messages if state is empty
		if (this.state.history.messages.length === 0) {
			this.initMessages();
		}
	}

	/**Build agent history description from list of items, respecting maxHistoryItems limit*/
	get agentHistoryDescription(): string {
		if (this.maxHistoryItems === null) {
			// Include all items
			return this.state.agentHistoryItems
				.map((item) => item.toString())
				.join("\n");
		}

		const totalItems = this.state.agentHistoryItems.length;

		// If we have fewer items than the limit, just return all items
		if (totalItems <= this.maxHistoryItems) {
			return this.state.agentHistoryItems
				.map((item) => item.toString())
				.join("\n");
		}

		// We have more items than the limit, so we need to omit some
		const omittedCount = totalItems - this.maxHistoryItems;

		// Show first item + omitted message + most recent (maxHistoryItems - 1) items
		// The omitted message doesn't count against the limit, only real history items do
		const recentItemsCount = this.maxHistoryItems - 1; // -1 for first item

		const itemsToInclude = [
			this.state.agentHistoryItems[0]?.toString() ?? "", // Keep first item (initialization)
			`<sys>[... ${omittedCount} previous steps omitted...]</sys>`,
		];
		// Add most recent items
		itemsToInclude.push(
			...this.state.agentHistoryItems
				.slice(-recentItemsCount)
				.map((item) => item.toString()),
		);

		return itemsToInclude.join("\n");
	}

	private initMessages(): void {
		/**Initialize the message history with system message, context, task, and other initial messages*/
		this.addMessageWithType(this.systemPrompt);

		const placeholderMessage = createUserMessage(
			"<example1>\nHere is an example output of thinking and tool call. You can use it as a reference but do not copy it exactly.",
			null,
			true,
		);
		this.addMessageWithType(placeholderMessage);

		// Create base example content
		const exampleContent: Record<string, any> = {
			evaluationPreviousGoal:
				"Navigated to GitHub explore page. Verdict: Success",
			memory:
				"Found initial repositories such as bytedance/UI-TARS-desktop and ray-project/kuberay.",
			nextGoal:
				"Create todo.md checklist to track progress, initialize github.md for collecting information, and click on bytedance/UI-TARS-desktop.",
			action: [
				{
					writeFile: {
						path: "todo.md",
						content:
							"# Interesting Github Repositories in Explore Section\n\n## Tasks\n- [ ] Initialize a tracking file for GitHub repositories called github.md\n- [ ] Visit each Github repository and find their description\n- [ ] Visit bytedance/UI-TARS-desktop\n- [ ] Visit ray-project/kuberay\n- [ ] Check for additional Github repositories by scrolling down\n- [ ] Compile all results in the requested format\n- [ ] Validate that I have not missed anything in the page\n- [ ] Report final results to user",
					},
				},
				{
					writeFile: {
						path: "github.md",
						content: "# Github Repositories:\n",
					},
				},
				{
					clickElementByIndex: {
						index: 4,
					},
				},
			],
		};

		// Add thinking field only if useThinking is True
		if (this.useThinking) {
			exampleContent.thinking = `I have successfully navigated to https://github.com/explore and can see the page has loaded with a list of featured repositories. The page contains interactive elements and I can identify specific repositories like bytedance/UI-TARS-desktop (index [4]) and ray-project/kuberay (index [5]). The user's request is to explore GitHub repositories and collect information about them such as descriptions, stars, or other metadata. So far, I haven't collected any information.
My navigation to the GitHub explore page was successful. The page loaded correctly and I can see the expected content.
I need to capture the key repositories I've identified so far into my memory and into a file.
Since this appears to be a multi-step task involving visiting multiple repositories and collecting their information, I need to create a structured plan in todo.md.
After writing todo.md, I can also initialize a github.md file to accumulate the information I've collected.
The file system actions do not change the browser state, so I can also click on the bytedance/UI-TARS-desktop (index [4]) to start collecting information.`;
		}

		const exampleToolCall1 = createAssistantMessage(
			JSON.stringify(exampleContent),
			null,
			null,
			undefined,
			true,
		);
		this.addMessageWithType(exampleToolCall1);
		this.addMessageWithType(
			createUserMessage(
				"Data written to todo.md.\nData written to github.md.\nClicked element with index 4.\n</example1>",
				null,
				true,
			),
		);
	}

	addNewTask(newTask: string): void {
		this.task = newTask;
		const taskUpdateItem = new HistoryItem({
			systemMessage: `User updated <userRequest> to: ${newTask}`,
		});
		this.state.agentHistoryItems.push(taskUpdateItem);
	}

	/**Update the agent history description*/
	private updateAgentHistoryDescription(
		modelOutput: AgentOutput | null = null,
		result: ActionResult[] | null = null,
		stepInfo: AgentStepInfo | null = null,
	): void {
		if (result === null) {
			result = [];
		}
		const stepNumber = stepInfo?.stepNumber || null;

		this.state.readStateDescription = "";

		let actionResults = "";
		const resultLen = result.length;
		for (let idx = 0; idx < result.length; idx++) {
			const actionResult = result[idx];
			if (!actionResult) continue;

			if (
				actionResult.includeExtractedContentOnlyOnce &&
				actionResult.extractedContent
			) {
				this.state.readStateDescription += actionResult.extractedContent + "\n";
				logger.debug(
					`Added extractedContent to readStateDescription: ${actionResult.extractedContent}`,
				);
			}

			if (actionResult.longTermMemory) {
				actionResults += `Action ${idx + 1}/${resultLen}: ${actionResult.longTermMemory}\n`;
				logger.debug(
					`Added longTermMemory to actionResults: ${actionResult.longTermMemory}`,
				);
			} else if (
				actionResult.extractedContent &&
				!actionResult.includeExtractedContentOnlyOnce
			) {
				actionResults += `Action ${idx + 1}/${resultLen}: ${actionResult.extractedContent}\n`;
				logger.debug(
					`Added extractedContent to actionResults: ${actionResult.extractedContent}`,
				);
			}

			if (actionResult.error) {
				actionResults += `Action ${idx + 1}/${resultLen}: ${actionResult.error.substring(0, 200)}\n`;
				logger.debug(
					`Added error to actionResults: ${actionResult.error.substring(0, 200)}`,
				);
			}
		}

		if (actionResults) {
			actionResults = `Action Results:\n${actionResults}`;
		}
		const finalActionResults = actionResults.replace(/\n$/, "") || null;

		// Build the history item
		if (modelOutput === null) {
			// Only add error history item if we have a valid step number
			if (stepNumber !== null && stepNumber > 0) {
				const historyItem = new HistoryItem({
					stepNumber,
					error: "Agent failed to output in the right format.",
				});
				this.state.agentHistoryItems.push(historyItem);
			}
		} else {
			const historyItem = new HistoryItem({
				stepNumber,
				evaluationPreviousGoal: modelOutput.currentState.evaluationPreviousGoal,
				memory: modelOutput.currentState.memory,
				nextGoal: modelOutput.currentState.nextGoal,
				actionResults: finalActionResults,
			});
			this.state.agentHistoryItems.push(historyItem);
		}
	}

	private getSensitiveDataDescription(currentPageUrl: string): string {
		const sensitiveData = this.sensitiveData;
		if (!sensitiveData) {
			return "";
		}

		// Collect placeholders for sensitive data
		const placeholders = new Set<string>();

		for (const [key, value] of Object.entries(sensitiveData)) {
			if (typeof value === "object" && value !== null) {
				// New format: {domain: {key: value}}
				if (matchUrlWithDomainPattern(currentPageUrl, key, true)) {
					Object.keys(value).forEach((k) => placeholders.add(k));
				}
			} else {
				// Old format: {key: value}
				placeholders.add(key);
			}
		}

		if (placeholders.size > 0) {
			const placeholderList = Array.from(placeholders).sort();
			let info = `Here are placeholders for sensitive data:\n${JSON.stringify(placeholderList)}\n`;
			info += "To use them, write <secret>the placeholder name</secret>";
			return info;
		}

		return "";
	}

	@timeExecution("--addStateMessage")
	addStateMessage(
		browserStateSummary: BrowserStateSummary,
		modelOutput: AgentOutput | null = null,
		result: ActionResult[] | null = null,
		stepInfo: AgentStepInfo | null = null,
		useVision: boolean = true,
		pageFilteredActions: string | null = null,
		sensitiveData: any = null,
	): void {
		/**Add browser state as human message*/

		this.updateAgentHistoryDescription(modelOutput, result, stepInfo);
		if (sensitiveData) {
			this.sensitiveDataDescription = this.getSensitiveDataDescription(
				browserStateSummary.url,
			);
		}
		// otherwise add state message and result to next message (which will not stay in memory)
		const stateMessage = new AgentMessagePrompt(
			browserStateSummary,
			this.fileSystem,
			this.agentHistoryDescription,
			this.state.readStateDescription,
			this.task,
			this.includeAttributes,
			stepInfo ?? undefined,
			pageFilteredActions,
			40000, // maxClickableElementsLength
			this.sensitiveDataDescription,
			this.availableFilePaths,
		).getUserMessage(useVision);

		this.addMessageWithType(stateMessage);
	}

	addPlan(plan: string | null, position: number | null = null): void {
		if (!plan) {
			return;
		}

		const msg = createAssistantMessage(plan);
		this.addMessageWithType(msg, position);
	}

	private logHistoryLines(): string {
		/**Generate a formatted log string of message history for debugging / printing to terminal*/
		// TODO: fix logging
		return "";
	}

	@timeExecution("--getMessages")
	getMessages(): BaseMessage[] {
		/**Get current message list, potentially trimmed to max tokens*/

		// Log message history for debugging
		logger.debug(this.logHistoryLines());
		this.lastInputMessages = [...this.state.history.messages];
		return this.lastInputMessages;
	}

	/**
	 * Add message to history
	 * position: null for last, -1 for second last, etc.
	 */
	addMessageWithType(message: BaseMessage, position?: number | null): void {
		// filter out sensitive data from the message
		if (this.sensitiveData) {
			message = this.filterSensitiveData(message);
		}

		this.state.history.addMessage(message, position || undefined);
	}

	/**
	 * Filter out sensitive data from the message
	 */
	@timeExecution("--filterSensitiveData")
	private filterSensitiveData(message: BaseMessage): BaseMessage {
		const replaceSensitive = (value: string): string => {
			if (!this.sensitiveData) {
				return value;
			}

			// Collect all sensitive values, immediately converting old format to new format
			const sensitiveValues: Record<string, string> = {};

			// Process all sensitive data entries
			for (const [keyOrDomain, content] of Object.entries(this.sensitiveData)) {
				if (typeof content === "object" && content !== null) {
					// Already in new format: {domain: {key: value}}
					for (const [key, val] of Object.entries(content)) {
						if (val) {
							// Skip empty values
							sensitiveValues[key] = val;
						}
					}
				} else if (content) {
					// Old format: {key: value} - convert to new format internally
					// We treat this as if it was {'http*://*': {keyOrDomain: content}}
					sensitiveValues[keyOrDomain] = content;
				}
			}

			// If there are no valid sensitive data entries, just return the original value
			if (Object.keys(sensitiveValues).length === 0) {
				logger.warn("No valid entries found in sensitiveData dictionary");
				return value;
			}

			// Replace all valid sensitive data values with their placeholder tags
			for (const [key, val] of Object.entries(sensitiveValues)) {
				value = value.replace(val, `<secret>${key}</secret>`);
			}

			return value;
		};

		if (typeof message.content === "string") {
			message.content = replaceSensitive(message.content);
		} else if (Array.isArray(message.content)) {
			for (let i = 0; i < message.content.length; i++) {
				const item = message.content[i];
				if (typeof item === "object" && item !== null && "text" in item) {
					(item as ContentPartTextParam).text = replaceSensitive(
						(item as ContentPartTextParam).text,
					);
					message.content[i] = item;
				}
			}
		}
		return message;
	}

	/**Remove last state message from history*/
	removeLastStateMessage(): void {
		this.state.history.removeLastStateMessage();
	}
}
