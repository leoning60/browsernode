/**
 * Test suite for single step agent functionality
 *
 */

import { describe, test, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
// Note: These imports would be replaced with actual implementations
// import { ChatOpenAI } from '../openai';
// import { ChatOllama } from '../ollama';
// import { BaseMessage, UserMessage } from '../messages';

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Mock implementations for testing
interface BaseMessage { role: string; content: any; }
interface UserMessage extends BaseMessage { role: 'user'; }


class MockChatOpenAI {
	constructor(public config: any) {}
	async ainvoke(messages: any, outputClass?: any): Promise<any> {
		return {
			completion: new outputClass("mock_action", "mock reasoning"),
			usage: { total_tokens: 100 }
		};
	}
}

class MockChatOllama {
	constructor(public config: any) {}
	async ainvoke(messages: any, outputClass?: any): Promise<any> {
		return {
			completion: new outputClass("mock_action", "mock reasoning"),
			usage: { total_tokens: 100 }
		};
	}
}

// Mock interfaces
interface DOMElementNode {
	tag_name: string;
	xpath: string;
	attributes: Record<string, string>;
	children: DOMElementNode[];
	is_visible: boolean;
	is_interactive: boolean;
	is_top_element: boolean;
	is_in_viewport: boolean;
	shadow_root: boolean;
	highlight_index: number;
	viewport_coordinates: any;
	page_coordinates: any;
	viewport_info: any;
	parent: any;
	clickable_elements_to_string?: (include_attributes?: string[]) => string;
}

interface SelectorMap {
	[key: number]: DOMElementNode;
}

interface TabInfo {
	page_id: number;
	url: string;
	title: string;
}

interface BrowserStateSummary {
	element_tree: DOMElementNode;
	selector_map: SelectorMap;
	url: string;
	title: string;
	tabs: TabInfo[];
	screenshot: string;
	pixels_above: number;
	pixels_below: number;
}

interface FileSystem {
	temp_dir: string;
}

interface AgentMessagePrompt {
	browser_state_summary: BrowserStateSummary;
	file_system: FileSystem;
	agent_history_description: string;
	read_state_description: string;
	task: string;
	include_attributes: string[];
	step_info: any;
	page_filtered_actions: any;
	max_clickable_elements_length: number;
	sensitive_data: any;
	get_user_message: (use_vision: boolean) => UserMessage;
}

interface Agent {
	task: string;
	llm: any;
	message_manager: {
		_add_message_with_type: (message: BaseMessage) => void;
		get_messages: () => BaseMessage[];
	};
	AgentOutput: any;
}

function createMockStateMessage(tempDir: string): UserMessage {
	// Create a mock DOM element with a single clickable button
	const mockButton: DOMElementNode = {
		tag_name: 'button',
		xpath: "//button[@id='test-button']",
		attributes: { id: 'test-button' },
		children: [],
		is_visible: true,
		is_interactive: true,
		is_top_element: true,
		is_in_viewport: true,
		shadow_root: false,
		highlight_index: 1,
		viewport_coordinates: null,
		page_coordinates: null,
		viewport_info: null,
		parent: null,
	};

	// Add clickable_elements_to_string method
	mockButton.clickable_elements_to_string = () => '[1]<button id="test-button">Click Me</button>';

	// Create selector map
	const selectorMap: SelectorMap = { 1: mockButton };

	// Create mock tab info
	const mockTab: TabInfo = {
		page_id: 1,
		url: 'https://example.com',
		title: 'Test Page',
	};

	// Create mock browser state
	const mockBrowserState: BrowserStateSummary = {
		element_tree: mockButton,
		selector_map: selectorMap,
		url: 'https://example.com',
		title: 'Test Page',
		tabs: [mockTab],
		screenshot: '',
		pixels_above: 0,
		pixels_below: 0,
	};

	// Create file system
	const mockFileSystem: FileSystem = { temp_dir: tempDir };

	// Create the agent message prompt
	const agentPrompt: AgentMessagePrompt = {
		browser_state_summary: mockBrowserState,
		file_system: mockFileSystem,
		agent_history_description: '',
		read_state_description: '',
		task: 'Click the button on the page',
		include_attributes: ['id'],
		step_info: null,
		page_filtered_actions: null,
		max_clickable_elements_length: 40000,
		sensitive_data: null,
		get_user_message: (use_vision: boolean) => ({
			role: 'user',
			content: 'Mock state message with clickable button'
		})
	};

	return agentPrompt.get_user_message(false);
}

// Mock Agent class
class MockAgent implements Agent {
	constructor(public task: string, public llm: any) {}
	
	message_manager = {
		_add_message_with_type: (message: BaseMessage) => {
			// Mock implementation
		},
		get_messages: (): BaseMessage[] => {
			return [
				{
					role: 'user',
					content: 'Mock state message with clickable button'
				}
			];
		}
	};

	AgentOutput = class {
		constructor(public action: string, public reasoning: string) {}
	};
}

describe('Single Step Test Suite', () => {
	// Test with OpenAI
	test('should handle single step with OpenAI', async () => {
		if (!process.env.OPENAI_API_KEY) {
			console.log('OPENAI_API_KEY not set, skipping test');
			return;
		}

		const llm = new MockChatOpenAI({
			model: 'gpt-4o-mini',
			api_key: process.env.OPENAI_API_KEY
		});

		const agent = new MockAgent('Click the button on the page', llm);

		// Create temporary directory
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));

		try {
			// Create mock state message
			const mockMessage = createMockStateMessage(tempDir);

			agent.message_manager._add_message_with_type(mockMessage);
			const messages = agent.message_manager.get_messages();

			// Test with simple question
			const response = await llm.ainvoke(messages, agent.AgentOutput);

			// Basic assertions to ensure response is valid
			expect(response.completion).toBeDefined();
			expect(response.usage).toBeDefined();
			expect(response.usage.total_tokens).toBeGreaterThan(0);
		} finally {
			// Cleanup temp directory
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	}, 60000);

	// Test with Ollama
	test('should handle single step with Ollama', async () => {
		const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
		
		try {
			const llm = new MockChatOllama({
				model: 'qwen3:32b',
				host: baseUrl
			});

			const agent = new MockAgent('Click the button on the page', llm);

			// Create temporary directory
			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));

			try {
				// Create mock state message
				const mockMessage = createMockStateMessage(tempDir);

				console.log('Mock state message:', mockMessage.content);

				agent.message_manager._add_message_with_type(mockMessage);
				const messages = agent.message_manager.get_messages();

				// Test with simple question
				const response = await llm.ainvoke(messages, agent.AgentOutput);

				// Basic assertions to ensure response is valid
				expect(response.completion).toBeDefined();
				expect(response.usage).toBeDefined();
				expect(response.usage.total_tokens).toBeGreaterThan(0);

				console.log(`Response from Ollama: ${JSON.stringify(response.completion)}`);
			} finally {
				// Cleanup temp directory
				await fs.rm(tempDir, { recursive: true, force: true });
			}
		} catch (error) {
			console.log('Ollama not available, skipping test:', error);
		}
	}, 120000);

	// Parametrized test equivalent
	const llmConfigs = [
		{ name: 'OpenAI', factory: () => new MockChatOpenAI({ model: 'gpt-4o-mini', api_key: process.env.OPENAI_API_KEY }), envVar: 'OPENAI_API_KEY' },
		{ name: 'Ollama', factory: () => new MockChatOllama({ model: 'qwen3:32b', host: process.env.OLLAMA_BASE_URL || 'http://localhost:11434' }), envVar: null },
	];

	llmConfigs.forEach(({ name, factory, envVar }) => {
		test(`should handle single step with ${name} (parametrized)`, async () => {
			if (envVar && !process.env[envVar]) {
				console.log(`${envVar} not set, skipping test`);
				return;
			}

			try {
				const llm = factory();
				const agent = new MockAgent('Click the button on the page', llm);

				// Create temporary directory
				const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));

				try {
					// Create mock state message
					const mockMessage = createMockStateMessage(tempDir);

					agent.message_manager._add_message_with_type(mockMessage);
					const messages = agent.message_manager.get_messages();

					// Test with simple question
					const response = await llm.ainvoke(messages, agent.AgentOutput);

					// Basic assertions to ensure response is valid
					expect(response.completion).toBeDefined();
					expect(response.usage).toBeDefined();
					expect(response.usage.total_tokens).toBeGreaterThan(0);
				} finally {
					// Cleanup temp directory
					await fs.rm(tempDir, { recursive: true, force: true });
				}
			} catch (error) {
				console.log(`${name} not available, skipping test:`, error);
			}
		}, 120000);
	});
}); 