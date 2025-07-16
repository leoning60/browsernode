import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type {
	ContentPartImageParam,
	ContentPartTextParam,
	ImageURL,
	SystemMessage,
	UserMessage,
} from "../llm/messages";
import {
	createContentPartImage,
	createContentPartText,
	createImageURL,
	createSystemMessage,
	createUserMessage,
} from "../llm/messages";

import type { BrowserStateSummary } from "../browser/views";
import type { FileSystem } from "../filesystem/file_system";
import type { ActionResult, AgentStepInfo } from "./views";

import bnLogger from "../logging_config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = bnLogger.child({
	module: "browsernode/agent/prompt",
});

export class SystemPrompt {
	public actionDescription: string;
	public maxActionsPerStep: number = 10;
	public overrideSystemMessage?: string | null = null;
	public extendSystemMessage?: string | null = null;
	public useThinking: boolean = true;
	public promptTemplate?: string;
	public systemMessage?: SystemMessage;

	constructor(params: {
		actionDescription: string;
		maxActionsPerStep: number;
		overrideSystemMessage?: string;
		extendSystemMessage?: string;
		useThinking?: boolean;
	}) {
		this.actionDescription = params.actionDescription;
		this.maxActionsPerStep = params.maxActionsPerStep;
		this.useThinking = params.useThinking ?? true;
		let prompt = "";

		if (params.overrideSystemMessage) {
			prompt = params.overrideSystemMessage;
		} else {
			this.loadPromptTemplate();
			prompt = this.promptTemplate!.replace(
				"{max_actions}",
				this.maxActionsPerStep.toString(),
			);
		}

		if (params.extendSystemMessage) {
			prompt += `\n${params.extendSystemMessage}`;
		}

		this.systemMessage = createSystemMessage(prompt, null, true);
	}

	private loadPromptTemplate(): void {
		/**
		 * Load the prompt template from the markdown file.
		 */
		try {
			// Choose the appropriate template based on useThinking setting
			const templateFilename = this.useThinking
				? "system_prompt.md"
				: "system_prompt_no_thinking.md";

			this.promptTemplate = readFileSync(
				join(__dirname, templateFilename),
				"utf-8",
			);
		} catch (e) {
			throw new Error(`Failed to load system prompt template: ${e}`);
		}
	}

	public getSystemMessage(): SystemMessage {
		/**
		 * Get the system prompt for the agent.
		 *
		 * @returns Formatted system prompt
		 */
		if (!this.systemMessage) {
			throw new Error("System message not found");
		}
		return this.systemMessage;
	}
}

// Functions:
// {this.defaultActionDescription}

// Example:
// {this.exampleResponse()}
// Your AVAILABLE ACTIONS:
// {this.defaultActionDescription}

export class AgentMessagePrompt {
	private browserStateSummary: BrowserStateSummary;
	private fileSystem: FileSystem | null;
	private agentHistoryDescription: string | null;
	private readStateDescription: string | null;
	private task: string | null;
	private includeAttributes: string[];
	private stepInfo: AgentStepInfo | null;
	private pageFilteredActions: string | null;
	private maxClickableElementsLength: number;
	private sensitiveData: string | null;
	private availableFilePaths: string[] | null;

	constructor(
		browserStateSummary: BrowserStateSummary,
		fileSystem: FileSystem | null = null,
		agentHistoryDescription: string | null = null,
		readStateDescription: string | null = null,
		task: string | null = null,
		includeAttributes: string[] = [],
		stepInfo: AgentStepInfo | null = null,
		pageFilteredActions: string | null = null,
		maxClickableElementsLength: number = 40000,
		sensitiveData: string | null = null,
		availableFilePaths: string[] | null = null,
	) {
		this.browserStateSummary = browserStateSummary;
		this.fileSystem = fileSystem;
		this.agentHistoryDescription = agentHistoryDescription;
		this.readStateDescription = readStateDescription;
		this.task = task;
		this.includeAttributes = includeAttributes;
		this.stepInfo = stepInfo;
		this.pageFilteredActions = pageFilteredActions;
		this.maxClickableElementsLength = maxClickableElementsLength;
		this.sensitiveData = sensitiveData;
		this.availableFilePaths = availableFilePaths;
	}

	private getBrowserStateDescription(): string {
		const elementsText =
			this.browserStateSummary.elementTree.clickableElementsToString(
				this.includeAttributes,
			);

		let processedElementsText = elementsText;
		let truncatedText = "";

		if (elementsText.length > this.maxClickableElementsLength) {
			processedElementsText = elementsText.substring(
				0,
				this.maxClickableElementsLength,
			);
			truncatedText = ` (truncated to ${this.maxClickableElementsLength} characters)`;
		}

		const hasContentAbove = (this.browserStateSummary.pixelsAbove || 0) > 0;
		const hasContentBelow = (this.browserStateSummary.pixelsBelow || 0) > 0;

		let formattedElementsText = "";
		if (processedElementsText !== "") {
			if (hasContentAbove) {
				formattedElementsText = `... ${this.browserStateSummary.pixelsAbove} pixels above - scroll to see more or extract structured data if you are looking for specific information ...\n${processedElementsText}`;
			} else {
				formattedElementsText = `[Start of page]\n${processedElementsText}`;
			}
			if (hasContentBelow) {
				formattedElementsText = `${formattedElementsText}\n... ${this.browserStateSummary.pixelsBelow} pixels below - scroll to see more or extract structured data if you are looking for specific information ...`;
			} else {
				formattedElementsText = `${formattedElementsText}\n[End of page]`;
			}
		} else {
			formattedElementsText = "empty page";
		}

		let tabsText = "";
		const currentTabCandidates: number[] = [];

		// Find tabs that match both URL and title to identify current tab more reliably
		for (const tab of this.browserStateSummary.tabs) {
			if (
				tab.url === this.browserStateSummary.url &&
				tab.title === this.browserStateSummary.title
			) {
				currentTabCandidates.push(tab.pageId);
			}
		}

		// If we have exactly one match, mark it as current
		// Otherwise, don't mark any tab as current to avoid confusion
		const currentTabId =
			currentTabCandidates.length === 1 ? currentTabCandidates[0] : null;

		for (const tab of this.browserStateSummary.tabs) {
			tabsText += `Tab ${tab.pageId}: ${tab.url} - ${tab.title.substring(0, 30)}\n`;
		}

		const currentTabText =
			currentTabId !== null ? `Current tab: ${currentTabId}` : "";

		const browserState = `${currentTabText}
Available tabs:
${tabsText}
Interactive elements from top layer of the current page inside the viewport${truncatedText}:
${formattedElementsText}
`;
		return browserState;
	}

	private getAgentStateDescription(): string {
		let stepInfoDescription = "";
		if (this.stepInfo) {
			stepInfoDescription = `Step ${this.stepInfo.stepNumber + 1} of ${this.stepInfo.maxSteps} max possible steps\n`;
		}
		const timeStr = new Date().toLocaleString("en-US", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
		stepInfoDescription += `Current date and time: ${timeStr}`;

		const todoContents = this.fileSystem?.getTodoContents() || "";
		const finalTodoContents =
			todoContents.length > 0
				? todoContents
				: "[Current todo.md is empty, fill it with your plan when applicable]";

		let agentState = `
<userRequest>
${this.task || ""}
</userRequest>
<fileSystem>
${this.fileSystem?.describe() || "No file system available"}
</fileSystem>
<todoContents>
${finalTodoContents}
</todoContents>
`;

		if (this.sensitiveData) {
			agentState += `<sensitive_data>\n${this.sensitiveData}\n</sensitive_data>\n`;
		}

		agentState += `<step_info>\n${stepInfoDescription}\n</step_info>\n`;

		if (this.availableFilePaths) {
			agentState +=
				"<available_file_paths>\n" +
				this.availableFilePaths.join("\n") +
				"\n</available_file_paths>\n";
		}

		return agentState;
	}

	public getUserMessage(useVision: boolean = true): UserMessage {
		// Don't pass screenshot to model if page is about:blank, step is 0, and there's only one tab
		let actualUseVision = useVision;
		if (
			this.browserStateSummary.url === "about:blank" &&
			this.stepInfo !== null &&
			this.stepInfo.stepNumber === 0 &&
			this.browserStateSummary.tabs.length === 1
		) {
			actualUseVision = false;
		}

		let stateDescription =
			"<agentHistory>\n" +
			(this.agentHistoryDescription
				? this.agentHistoryDescription.trim()
				: "") +
			"\n</agentHistory>\n";

		stateDescription +=
			"<agentState>\n" +
			this.getAgentStateDescription().trim() +
			"\n</agentState>\n";
		stateDescription +=
			"<browser_state>\n" +
			this.getBrowserStateDescription().trim() +
			"\n</browser_state>\n";
		stateDescription +=
			"<read_state>\n" +
			(this.readStateDescription ? this.readStateDescription.trim() : "") +
			"\n</read_state>\n";

		if (this.pageFilteredActions) {
			stateDescription +=
				"For this page, these additional actions are available:\n";
			stateDescription += this.pageFilteredActions + "\n";
		}

		if (this.browserStateSummary.screenshot && actualUseVision) {
			// Format message for vision model
			return createUserMessage([
				createContentPartText(stateDescription),
				createContentPartImage(
					createImageURL(
						`data:image/png;base64,${this.browserStateSummary.screenshot}`,
						"auto",
						"image/png",
					),
				),
			]);
		}

		return createUserMessage(stateDescription);
	}
}

export class PlannerPrompt {
	private availableActions: string;

	constructor(availableActions: string) {
		this.availableActions = availableActions;
	}
	/**
	 * Get the system message for the planner prompt.
	 *
	 * @param isPlannerReasoning If true, return as UserMessage for chain-of-thought
	 * @param extendedPlannerSystemPrompt Optional text to append to the base prompt
	 * @returns SystemMessage or UserMessage depending on isPlannerReasoning
	 */
	public getSystemMessage(
		isPlannerReasoning: boolean = false,
		extendedPlannerSystemPrompt?: string,
	): SystemMessage | UserMessage {
		let plannerPromptText = `
You are a planning agent that helps break down tasks into smaller steps and reason about the current state.
Your role is to:
1. Analyze the current state and history
2. Evaluate progress towards the ultimate goal
3. Identify potential challenges or roadblocks
4. Suggest the next high-level steps to take

Inside your messages, there will be AI messages from different agents with different formats.

Your output format should be always a JSON object with the following fields:
{
    "state_analysis": "Brief analysis of the current state and what has been done so far",
    "progress_evaluation": "Evaluation of progress towards the ultimate goal (as percentage and description)",
    "challenges": "List any potential challenges or roadblocks",
    "next_steps": "List 2-3 concrete next steps to take",
    "reasoning": "Explain your reasoning for the suggested next steps"
}

Ignore the other AI messages output structures.

Keep your responses concise and focused on actionable insights.
`;

		if (extendedPlannerSystemPrompt) {
			plannerPromptText += `\n${extendedPlannerSystemPrompt}`;
		}

		if (isPlannerReasoning) {
			return createUserMessage(plannerPromptText);
		} else {
			return createSystemMessage(plannerPromptText);
		}
	}
}
