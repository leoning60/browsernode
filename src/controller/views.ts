import { z } from "zod";
import bnLogger from "../logging_config";

// Setup logger
const logger = bnLogger.child({
	module: "browser_node/controller/views",
});

// DoneAction
export const DoneAction = z.object({
	text: z.string(),
	success: z.boolean(),
});

// SearchGoogleAction
export const SearchGoogleAction = z.object({
	query: z.string(),
});

// GoToUrlAction
export const GoToUrlAction = z.object({
	url: z.string(),
});

// GoBackAction empty

// WaitAction
export const WaitAction = z.object({
	seconds: z.number(),
});

// ClickElementAction
export const ClickElementAction = z.object({
	index: z.number(),
	xpath: z.string().optional(),
});

// InputTextAction
export const InputTextAction = z.object({
	index: z.number(),
	text: z.string(),
	xpath: z.string().optional(),
});

// SavePdfAction empty

// SwitchTabAction
export const SwitchTabAction = z.object({
	pageId: z.number(),
});

// OpenTabAction
export const OpenTabAction = z.object({
	url: z.string(),
});

// extractContentAction
export const ExtractContentAction = z.object({
	goal: z.string(),
});

// ScrollAction
export const ScrollAction = z.object({
	amount: z.number().optional(),
});

// SendKeysAction
export const SendKeysAction = z.object({
	keys: z.string(),
});

// scrollToText
export const ScrollToTextAction = z.object({
	text: z.string(),
});

// GetDropdownOptions
export const GetDropdownOptionsAction = z.object({
	index: z.number(),
});

// SelectDropdownOption
export const SelectDropdownOptionAction = z.object({
	index: z.number(),
	text: z.string(),
});

// ExtractPageContentAction
export const ExtractPageContentAction = z.object({
	value: z.string(),
});

// NoParamsAction
export const NoParamsAction = z.object({});
