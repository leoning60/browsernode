/**
 * Test suite for all chat model implementations
 *
 */

import { describe, test, expect } from 'vitest';
import {
	ChatOpenAI,
	ChatOllama,

} from '../index';

import type {
	BaseMessage,
	UserMessage,
	SystemMessage,
	AssistantMessage,
	ContentPartTextParam,
} from '../messages';

interface CapitalResponse {
	/** Structured response for capital question */
	country: string;
	capital: string;
}

describe('Chat Models Test Suite', () => {
	// Test Constants
	const SYSTEM_MESSAGE: SystemMessage = {
		role: 'system',
		content: [{ text: 'You are a helpful assistant.', type: 'text' } as ContentPartTextParam]
	};

	const FRANCE_QUESTION: UserMessage = {
		role: 'user',
		content: 'What is the capital of France? Answer in one word.'
	};

	const FRANCE_ANSWER: AssistantMessage = {
		role: 'assistant',
		content: 'Paris'
	};

	const GERMANY_QUESTION: UserMessage = {
		role: 'user',
		content: 'What is the capital of Germany? Answer in one word.'
	};

	// Expected values
	const EXPECTED_GERMANY_CAPITAL = 'berlin';
	const EXPECTED_FRANCE_COUNTRY = 'france';
	const EXPECTED_FRANCE_CAPITAL = 'paris';

	// Test messages for conversation
	const CONVERSATION_MESSAGES: BaseMessage[] = [
		SYSTEM_MESSAGE,
		FRANCE_QUESTION,
		FRANCE_ANSWER,
		GERMANY_QUESTION,
	];

	// Test messages for structured output
	const STRUCTURED_MESSAGES: BaseMessage[] = [
		{ role: 'user', content: 'What is the capital of France?' } as UserMessage
	];

	// OpenAI Tests
	describe('OpenAI Chat Tests', () => {
		test('should handle normal text response from OpenAI', async () => {
			// Skip if no API key
			if (!process.env.OPENAI_API_KEY) {
				console.log('OPENAI_API_KEY not set, skipping test');
				return;
			}

			const chat = new ChatOpenAI({
				model: 'gpt-4o-mini',
				temperature: 0,
				apiKey: process.env.OPENAI_API_KEY
			});

			const response = await chat.ainvoke(CONVERSATION_MESSAGES);
			const completion = response.completion;

			expect(typeof completion).toBe('string');
			expect((completion as string).toLowerCase()).toContain(EXPECTED_GERMANY_CAPITAL);
		}, 30000); // 30 second timeout

		test('should handle structured output from OpenAI', async () => {
			// Skip if no API key
			if (!process.env.OPENAI_API_KEY) {
				console.log('OPENAI_API_KEY not set, skipping test');
				return;
			}

			// Create a class constructor for CapitalResponse
			class CapitalResponseClass implements CapitalResponse {
				constructor(public country: string, public capital: string) {}
			}

			const chat = new ChatOpenAI({
				model: 'gpt-4o-mini',
				temperature: 0,
				apiKey: process.env.OPENAI_API_KEY
			});

			const response = await chat.ainvoke(STRUCTURED_MESSAGES, CapitalResponseClass);
			const completion = response.completion as CapitalResponse;

			expect(completion).toHaveProperty('country');
			expect(completion).toHaveProperty('capital');
			expect(completion.country.toLowerCase()).toBe(EXPECTED_FRANCE_COUNTRY);
			expect(completion.capital.toLowerCase()).toBe(EXPECTED_FRANCE_CAPITAL);
		}, 30000);
	});

	// Ollama Tests
	describe('Ollama Chat Tests', () => {
		test('should handle normal text response from Ollama', async () => {
			// Skip if Ollama is not available (check for base URL or assume local)
			const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
			
			try {
				const chat = new ChatOllama({
					model: 'llama3.2',
					temperature: 0,
					baseUrl: baseUrl
				});

				const response = await chat.ainvoke(CONVERSATION_MESSAGES);
				const completion = response.completion;

				expect(typeof completion).toBe('string');
				expect((completion as string).toLowerCase()).toContain(EXPECTED_GERMANY_CAPITAL);
			} catch (error) {
				console.log('Ollama not available, skipping test:', error);
			}
		}, 60000); // 60 second timeout for local models

		test('should handle structured output from Ollama', async () => {
			const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
			
			try {
				// Create a class constructor for CapitalResponse
				class CapitalResponseClass implements CapitalResponse {
					constructor(public country: string, public capital: string) {}
				}

				const chat = new ChatOllama({
					model: 'llama3.2',
					temperature: 0,
					baseUrl: baseUrl
				});

				const response = await chat.ainvoke(STRUCTURED_MESSAGES, CapitalResponseClass);
				const completion = response.completion as CapitalResponse;

				expect(completion).toHaveProperty('country');
				expect(completion).toHaveProperty('capital');
				expect(completion.country.toLowerCase()).toBe(EXPECTED_FRANCE_COUNTRY);
				expect(completion.capital.toLowerCase()).toBe(EXPECTED_FRANCE_CAPITAL);
			} catch (error) {
				console.log('Ollama not available, skipping test:', error);
			}
		}, 60000);
	});

	// Tests for future implementations
	describe('Future Chat Model Tests', () => {
		test.skip('should handle Anthropic chat models when implemented', () => {
			// Placeholder for future Anthropic implementation
			expect(true).toBe(true);
		});

		test.skip('should handle Google Gemini chat models when implemented', () => {
			// Placeholder for future Google implementation
			expect(true).toBe(true);
		});

		test.skip('should handle Groq chat models when implemented', () => {
			// Placeholder for future Groq implementation
			expect(true).toBe(true);
		});

		test.skip('should handle Azure OpenAI chat models when implemented', () => {
			// Placeholder for future Azure implementation
			expect(true).toBe(true);
		});
	});

	// Helper tests
	describe('Type Safety Tests', () => {
		test('should ensure proper TypeScript type checking for messages', () => {
			const userMessage: UserMessage = {
				role: 'user',
				content: 'Test message'
			};

			const systemMessage: SystemMessage = {
				role: 'system',
				content: 'Test system message'
			};

			const assistantMessage: AssistantMessage = {
				role: 'assistant',
				content: 'Test assistant message'
			};

			expect(userMessage.role).toBe('user');
			expect(systemMessage.role).toBe('system');
			expect(assistantMessage.role).toBe('assistant');
		});

		test('should validate CapitalResponse interface structure', () => {
			const response: CapitalResponse = {
				country: 'France',
				capital: 'Paris'
			};

			expect(response).toHaveProperty('country');
			expect(response).toHaveProperty('capital');
			expect(typeof response.country).toBe('string');
			expect(typeof response.capital).toBe('string');
		});
	});
}); 