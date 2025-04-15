import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { Agent, Controller } from "browser-node";

const controller = new Controller();

class WebpageInfo {
	link: string;

	constructor(link: string) {
		this.link =
			"https://appointment.mfa.gr/en/reservations/aero/ireland-grcon-dub/";
	}
}

controller.action("WebpageInfo", {
	paramModel: WebpageInfo,
})(async function goToMFAWebpage(params: WebpageInfo) {
	return params.link;
});

async function main() {
	const task =
		"Go to the Greece MFA webpage via the link I provided you,https://appointment.mfa.gr/en/reservations/aero/ireland-grcon-dub/." +
		"Check the visa appointment dates. If there is no available date in this month, check the next month." +
		"If there is no available date in both months, tell me there is no available date.";

	const model = new ChatOpenAI({
		modelName: "gpt-4o-mini",
		apiKey: process.env.OPENAI_API_KEY,
		streaming: true,
		configuration: {
			baseURL: "https://openrouter.ai/api/v1",
			defaultHeaders: {
				"HTTP-Referer": null,
				"X-Title": null,
			},
		},
	});
	const agent = new Agent(task, model, { controller, useVision: true });

	await agent.run();
}

main();
