import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { BrowserState } from "../browser/views";

import { ActionResult, AgentStepInfo } from "./views";

import bnLogger from "../logging_config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = bnLogger.child({
	module: "browser_node/agent/prompt",
});
export class SystemPrompt {
	public defaultActionDescription: string;
	public maxActionsPerStep: number = 10;
	public overrideSystemMessage?: string | null = null;
	public extendSystemMessage?: string | null = null;
	public promptTemplate?: string;
	public systemMessage?: SystemMessage;

	constructor(params: {
		actionDescription: string;
		maxActionsPerStep: number;
		overrideSystemMessage?: string;
		extendSystemMessage?: string;
	}) {
		this.defaultActionDescription = params.actionDescription;
		this.maxActionsPerStep = params.maxActionsPerStep;
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

		this.systemMessage = new SystemMessage(prompt);
	}

	private loadPromptTemplate(): void {
		try {
			this.promptTemplate = readFileSync(
				join(__dirname, "system_prompt.md"),
				"utf-8",
			);
		} catch (e) {
			throw new Error(`Failed to load system prompt template: ${e}`);
		}
	}

	public getSystemMessage(): SystemMessage {
		if (!this.systemMessage) {
			throw new Error("System message not found");
		}
		return this.systemMessage;
	}
}

export class AgentMessagePrompt {
	private state: BrowserState;
	private result?: ActionResult[] | null;
	private includeAttributes: string[];
	private stepInfo?: AgentStepInfo;

	constructor(
		state: BrowserState,
		result?: ActionResult[] | null,
		includeAttributes: string[] = [],
		stepInfo?: AgentStepInfo,
	) {
		this.state = state;
		this.result = result;
		this.includeAttributes = includeAttributes;
		this.stepInfo = stepInfo;
	}

	public getUserMessage(useVision: boolean = true): HumanMessage {
		const elementsText = this.state.elementTree.clickableElementsToString(
			this.includeAttributes,
		);

		const hasContentAbove = (this.state.pixelsAbove || 0) > 0;
		const hasContentBelow = (this.state.pixelsBelow || 0) > 0;

		let formattedElementsText = "";
		if (elementsText !== "") {
			if (hasContentAbove) {
				formattedElementsText = `... ${this.state.pixelsAbove} pixels above - scroll or extract content to see more ...\n${elementsText}`;
			} else {
				formattedElementsText = `[Start of page]\n${elementsText}`;
			}
			if (hasContentBelow) {
				formattedElementsText = `${formattedElementsText}\n... ${this.state.pixelsBelow} pixels below - scroll or extract content to see more ...`;
			} else {
				formattedElementsText = `${formattedElementsText}\n[End of page]`;
			}
		} else {
			formattedElementsText = "empty page";
		}

		let stepInfoDescription = "";
		if (this.stepInfo) {
			stepInfoDescription = `Current step: ${this.stepInfo.stepNumber + 1}/${this.stepInfo.maxSteps}`;
		}
		const timeStr = new Date().toLocaleString();
		stepInfoDescription += `Current date and time: ${timeStr}`;

		let stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current url: ${this.state.url}
Available tabs:
${this.state.tabs}
Interactive elements from top layer of the current page inside the viewport:
${formattedElementsText}
${stepInfoDescription}
`;

		if (this.result) {
			this.result.forEach((result, i) => {
				if (result.extractedContent) {
					stateDescription += `\nAction result ${i + 1}/${this.result!.length}: ${result.extractedContent}`;
				}
				if (result.error) {
					const error = result.error.split("\n").pop();
					stateDescription += `\nAction error ${i + 1}/${this.result!.length}: ...${error}`;
				}
			});
		}

		if (this.state.screenshot && useVision) {
			return new HumanMessage({
				content: [
					{ type: "text", text: stateDescription },
					{
						type: "image_url",
						image_url: {
							url: `data:image/png;base64,${this.state.screenshot}`,
						},
					},
				],
			});
		}

		return new HumanMessage(stateDescription);
	}
}
/**
 * Get the system message for the planner prompt.
 * @returns The system message for the planner prompt.
 */
export class PlannerPrompt extends SystemPrompt {
	public getSystemMessage(): SystemMessage {
		return new SystemMessage(`You are a planning agent that helps break down tasks into smaller steps and reason about the current state.
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

Keep your responses concise and focused on actionable insights.`);
	}
}
