import { ChatOllama } from "@langchain/ollama";
import { Agent } from "browsernode";

// Initialize the model
const llm = new ChatOllama({
	model: "qwen3:32b",
	numCtx: 64000,
});

// Create agent with the model and configure for Ollama
// const tast= "your task here"
const task =
	"use https://search.brave.com/ to Search for the latest tesla stock price";
const agent = new Agent(task, llm);
agent.run();
