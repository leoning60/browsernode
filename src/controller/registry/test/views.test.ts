import { beforeEach, describe, expect, test } from "vitest";
import { ActionModel, ActionRegistry, RegisteredAction } from "../views";

describe("RegisteredAction", () => {
	let action: RegisteredAction;

	beforeEach(() => {
		action = new RegisteredAction({
			name: "testAction",
			description: "Test action description",
			function: () => {},
			paramModel: {
				param1: { title: "Title 1", type: "string", description: "Desc 1" },
				param2: { title: "Title 2", required: true },
			},
		});
	});

	test("should create instance correctly", () => {
		expect(action.name).toBe("testAction");
		expect(action.description).toBe("Test action description");
		expect(typeof action.function).toBe("function");
	});

	test("promptDescription should exclude title from params", () => {
		const description = action.promptDescription();
		expect(description).toContain("Test action description");
		expect(description).toContain(
			'"param1":{"type":"string","description":"Desc 1"}',
		);
		expect(description).toContain('"param2":{"required":true}');
		expect(description).not.toContain("Title 1");
		expect(description).not.toContain("Title 2");
	});
});

describe("ActionModel", () => {
	let model: ActionModel;

	beforeEach(() => {
		model = new ActionModel({
			action1: { index: 1, param: "value1" },
			action2: { param: "value2" },
		});
	});

	test("should create instance correctly", () => {
		expect(model.action1).toEqual({ index: 1, param: "value1" });
		expect(model.action2).toEqual({ param: "value2" });
	});

	test("getIndex should return correct index", () => {
		expect(model.getIndex()).toBe(1);
	});

	test("getIndex should return null when no index exists", () => {
		model = new ActionModel({ action1: { param: "value" } });
		expect(model.getIndex()).toBeNull();
	});

	test("setIndex should update index correctly", () => {
		model.setIndex(2);
		expect(model.action1.index).toBe(2);
	});
});

describe("ActionRegistry", () => {
	let registry: ActionRegistry;

	beforeEach(() => {
		registry = new ActionRegistry();
	});

	test("should create empty registry", () => {
		expect(registry.actions.size).toBe(0);
	});

	test("getPromptDescription should return combined descriptions", () => {
		const action1 = new RegisteredAction({
			name: "action1",
			description: "First action",
			function: () => {},
			paramModel: { param: { type: "string" } },
		});

		const action2 = new RegisteredAction({
			name: "action2",
			description: "Second action",
			function: () => {},
			paramModel: { param: { type: "number" } },
		});

		registry.actions.set("action1", action1);
		registry.actions.set("action2", action2);

		const description = registry.getPromptDescription();
		expect(description).toContain("First action");
		expect(description).toContain("Second action");
		expect(description).toContain('"param":{"type":"string"}');
		expect(description).toContain('"param":{"type":"number"}');
	});
});
