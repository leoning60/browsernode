import { z } from "zod";
import bnLogger from "../logging_config";

// Setup logger
const logger = bnLogger.child({
	module: "browsernode/controller/views",
});

// Action Input Models

// SearchGoogleAction
export const SearchGoogleAction = z.object({
	query: z.string(),
});

// GoToUrlAction
export const GoToUrlAction = z.object({
	url: z.string(),
	newTab: z.boolean(), // True to open in new tab, False to navigate in current tab
});

// ClickElementAction
export const ClickElementAction = z.object({
	index: z.number(),
});

// InputTextAction
export const InputTextAction = z.object({
	index: z.number(),
	text: z.string(),
});

// DoneAction
export const DoneAction = z.object({
	text: z.string(),
	success: z.boolean(),
	filesToDisplay: z.array(z.string()).optional().default([]),
});

// StructuredOutputAction - Generic type will be handled at usage
export const StructuredOutputAction = z.object({
	success: z.boolean().default(true),
	data: z.any(), // Will be typed specifically when used
});

// SavePdfAction empty

// SwitchTabAction
export const SwitchTabAction = z.object({
	pageId: z.number(),
});

// CloseTabAction
export const CloseTabAction = z.object({
	pageId: z.number(),
});

// ScrollAction
export const ScrollAction = z.object({
	down: z.boolean(), // True to scroll down, False to scroll up
});

// SendKeysAction
export const SendKeysAction = z.object({
	keys: z.string(),
});

// UploadFileAction
export const UploadFileAction = z.object({
	index: z.number(),
	path: z.string(),
});

// ExtractStructuredDataAction
export const ExtractStructuredDataAction = z.object({
	query: z.string(),
	extractLinks: z.boolean(),
});

// ScrollToTextAction
export const ScrollToTextAction = z.object({
	text: z.string(),
});

// WriteFileAction
export const WriteFileAction = z.object({
	fileName: z.string(),
	content: z.string(),
});

// AppendFileAction
export const AppendFileAction = z.object({
	fileName: z.string(),
	content: z.string(),
});

// ReadFileAction
export const ReadFileAction = z.object({
	fileName: z.string(),
});

// GetDropdownOptionsAction
export const GetDropdownOptionsAction = z.object({
	index: z.number(),
});

// SelectDropdownOptionAction
export const SelectDropdownOptionAction = z.object({
	index: z.number(),
	text: z.string(),
});

// Google Sheets Actions
export const ReadCellContentsAction = z.object({
	cellOrRange: z.string(),
});

export const UpdateCellContentsAction = z.object({
	cellOrRange: z.string(),
	newContentsTsv: z.string(),
});

export const ClearCellContentsAction = z.object({
	cellOrRange: z.string(),
});

export const SelectCellOrRangeAction = z.object({
	cellOrRange: z.string(),
});

export const FallbackInputSingleCellAction = z.object({
	text: z.string(),
});

// ExtractPageContentAction
export const ExtractPageContentAction = z.object({
	value: z.string(),
});

// NoParamsAction - Accepts absolutely anything and discards it
export const NoParamsAction = z.object({}).passthrough();
/**
 * Accepts absolutely anything in the incoming data
 * and discards it, so the final parsed model is empty.
 */

// Position
export const Position = z.object({
	x: z.number(),
	y: z.number(),
});

// DragDropAction
export const DragDropAction = z.object({
	// Element-based approach
	elementSource: z
		.string()
		.optional()
		.describe("CSS selector or XPath of the element to drag from"),
	elementTarget: z
		.string()
		.optional()
		.describe("CSS selector or XPath of the element to drop onto"),
	elementSourceOffset: Position.optional().describe(
		"Precise position within the source element to start drag (in pixels from top-left corner)",
	),
	elementTargetOffset: Position.optional().describe(
		"Precise position within the target element to drop (in pixels from top-left corner)",
	),

	// Coordinate-based approach (used if selectors not provided)
	coordSourceX: z
		.number()
		.optional()
		.describe("Absolute X coordinate on page to start drag from (in pixels)"),
	coordSourceY: z
		.number()
		.optional()
		.describe("Absolute Y coordinate on page to start drag from (in pixels)"),
	coordTargetX: z
		.number()
		.optional()
		.describe("Absolute X coordinate on page to drop at (in pixels)"),
	coordTargetY: z
		.number()
		.optional()
		.describe("Absolute Y coordinate on page to drop at (in pixels)"),

	// Common options
	steps: z
		.number()
		.optional()
		.default(10)
		.describe(
			"Number of intermediate points for smoother movement (5-20 recommended)",
		),
	delayMs: z
		.number()
		.optional()
		.default(5)
		.describe(
			"Delay in milliseconds between steps (0 for fastest, 10-20 for more natural)",
		),
});
// Legacy actions for backward compatibility

// export const WaitAction = z.object({
// 	seconds: z.number(),
// });

// export const OpenTabAction = z.object({
// 	url: z.string(),
// });

// export const ExtractContentAction = z.object({
// 	goal: z.string(),
// });

// export const ScrollToTextAction = z.object({
// 	text: z.string(),
// });

// // GetDropdownOptions
// export const GetDropdownOptionsAction = z.object({
// 	index: z.number(),
// });

// // SelectDropdownOption
// export const SelectDropdownOptionAction = z.object({
// 	index: z.number(),
// 	text: z.string(),
// });
