/**
 * Flight Search Example with Structured Data Extraction
 *
 * This example demonstrates how to:
 * 1. Define structured output models using Zod schemas for flight data
 * 2. Use the Controller with output validation
 * 3. Extract structured flight data from Google Flights
 * 4. Parse and display the flight search results
 *
 * Required Environment Variables:
 * - OPENAI_API_KEY: Your OpenAI API key
 *
 * Installation:
 * 1. npm install
 * 2. Copy .env.example to .env and add your API key
 * 3. npx tsx examples/use-cases/flight_search.ts
 */

import { Agent, Controller } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { z } from "zod";

// Zod schemas for Flight and FlightResults
const FlightSchema = z.object({
	flight_price: z.string().describe("The price of the flight"),
	airline_name: z.string().describe("The name of the airline"),
	departure_time: z.string().describe("The departure time"),
	arrival_time: z.string().describe("The arrival time"),
	number_of_stops: z.number().describe("Number of stops in the flight"),
	total_travel_time: z.string().describe("Total travel time for the flight"),
	flight_number: z.string().optional().describe("Flight number if available"),
});

const FlightResultsSchema = z.object({
	flights: z
		.array(FlightSchema)
		.describe("Array of flight search results from Google Flights"),
});

type Flight = z.infer<typeof FlightSchema>;
type FlightResults = z.infer<typeof FlightResultsSchema>;

async function main() {
	// Check for required environment variable
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not set in environment variables");
	}

	// Initialize controller with output model for structured data extraction
	const controller = new Controller([], FlightResultsSchema);

	// Task to search flights and extract structured data from Google Flights
	const task = `
  Go to Google Flights and search for:
  - Click on the departure city input field
  - Type Singapore as the departure city and press enter
  - Click on the destination city input field
  - Type Tokyo as the destination city and press enter
  - Click on the departure date input field
  - Type 30.07.2025 as the departure date and press enter
  - Click on the return date input field
  - Type 07.08.2025 as the return date and press enter
  - Search for flights
  - Sort by price
  - Extract the following information and provide them as the final result in JSON format:
    * Flight price
    * Airline name
    * Departure time
    * Arrival time
    * Number of stops
    * Total travel time
    * Flight number (if available)
  `;

	// Initialize the language model
	const model = new ChatOpenAI({
		model: "gpt-4.1",
		apiKey: process.env.OPENAI_API_KEY,
	});

	// Create and run the agent
	const agent = new Agent({
		task: task,
		llm: model,
		controller: controller,
	});

	try {
		console.log("🚀 Starting agent to search flights and extract data...\n");

		const history = await agent.run();

		// Extract the final result from the agent history
		const result = history.finalResult();

		if (result) {
			// Parse the structured result using Zod
			const parsed: FlightResults = FlightResultsSchema.parse(
				JSON.parse(result),
			);

			console.log("🎯 Extracted Flight Results from Google Flights:\n");

			// Display each flight with formatting
			for (const [index, flight] of parsed.flights.entries()) {
				console.log(`\n${index + 1}. --------------------------------`);
				console.log(`Price:            ${flight.flight_price}`);
				console.log(`Airline:          ${flight.airline_name}`);
				console.log(`Departure:        ${flight.departure_time}`);
				console.log(`Arrival:          ${flight.arrival_time}`);
				console.log(`Stops:            ${flight.number_of_stops}`);
				console.log(`Travel Time:      ${flight.total_travel_time}`);
				if (flight.flight_number) {
					console.log(`Flight Number:    ${flight.flight_number}`);
				}
			}

			console.log("\n✅ Successfully extracted structured flight data!");
		} else {
			console.log("❌ No result returned from agent");
		}
	} catch (error) {
		console.error("💥 Error running agent:", error);

		// If it's a Zod validation error, provide more details
		if (error instanceof z.ZodError) {
			console.error("Validation errors:", error.errors);
		}
	}
}

// Run the main function
main().catch(console.error);
