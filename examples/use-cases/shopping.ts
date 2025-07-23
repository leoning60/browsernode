/**
 * Goal: Automates online grocery shopping on Migros Online with comprehensive item selection,
 * delivery scheduling, and checkout using TWINT payment.
 *
 * Migros Online Shopping Agent using browsernode
 * ---------------------------------------------
 *
 * This example demonstrates how to use browsernode to:
 * - Navigate to Migros Online website
 * - Search for specific grocery items
 * - Add items to cart with quantity management
 * - Handle out-of-stock items with substitutions
 * - Manage minimum order requirements
 * - Select delivery windows
 * - Complete checkout with TWINT payment
 * - Generate order summary
 *
 * @dev You need to add OPENAI_API_KEY to your environment variables.
 */

import { Agent, BrowserSession } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// Check required environment variables
if (!process.env.OPENAI_API_KEY) {
	throw new Error(
		"OPENAI_API_KEY is not set. Please add it to your environment variables.",
	);
}

// Shopping task definition
const task = `
### Prompt for Shopping Agent – Migros Online Grocery Order

**Objective:**
Visit [Migros Online](https://www.migros.ch/en), search for the required grocery items, add them to the cart, select an appropriate delivery window, and complete the checkout process using TWINT.

**Important:**
- Make sure that you don't buy more than it's needed for each article.
- After your search, if you click the "+" button, it adds the item to the basket.
- if you open the basket sidewindow menu, you can close it by clicking the X button on the top right. This will help you navigate easier.
---

### Step 1: Navigate to the Website
- Open [Migros Online](https://www.migros.ch/en).
- You should be logged in as Nikolaos Kaliorakis

---

### Step 2: Add Items to the Basket

#### Shopping List:

**Meat & Dairy:**
- Beef Minced meat (1 kg)
- Gruyère cheese (grated preferably)
- 2 liters full-fat milk
- Butter (cheapest available)

**Vegetables:**
- Carrots (1kg pack)
- Celery
- Leeks (1 piece)
- 1 kg potatoes

At this stage, check the basket on the top right (indicates the price) and check if you bought the right items.

**Fruits:**
- 2 lemons
- Oranges (for snacking)

**Pantry Items:**
- Lasagna sheets
- Tahini
- Tomato paste (below CHF2)
- Black pepper refill (not with the mill)
- 2x 1L Oatly Barista(oat milk)
- 1 pack of eggs (10 egg package)

#### Ingredients I already have (DO NOT purchase):
- Olive oil, garlic, canned tomatoes, dried oregano, bay leaves, salt, chili flakes, flour, nutmeg, cumin.

---

### Step 3: Handling Unavailable Items
- If an item is **out of stock**, find the best alternative.
- Use the following recipe contexts to choose substitutions:
  - **Pasta Bolognese & Lasagna:** Minced meat, tomato paste, lasagna sheets, milk (for béchamel), Gruyère cheese.
  - **Hummus:** Tahini, chickpeas, lemon juice, olive oil.
  - **Chickpea Curry Soup:** Chickpeas, leeks, curry, lemons.
  - **Crispy Slow-Cooked Pork Belly with Vegetables:** Potatoes, butter.
- Example substitutions:
  - If Gruyère cheese is unavailable, select another semi-hard cheese.
  - If Tahini is unavailable, a sesame-based alternative may work.

---

### Step 4: Adjusting for Minimum Order Requirement
- If the total order **is below CHF 99**, add **a liquid soap refill** to reach the minimum. If it's still you can buy some bread, dark chocolate.
- At this step, check if you have bought MORE items than needed. If the price is more than CHF200, you MUST remove items.
- If an item is not available, choose an alternative.
- if an age verification is needed, remove alcoholic products, we haven't verified yet.

---

### Step 5: Select Delivery Window
- Choose a **delivery window within the current week**. It's ok to pay up to CHF2 for the window selection.
- Preferably select a slot within the workweek.

---

### Step 6: Checkout
- Proceed to checkout.
- Select **TWINT** as the payment method.
- Check out.
- 
- if it's needed the username is: nikoskalio.dev@gmail.com 
- and the password is : TheCircuit.Migros.dev!
---

### Step 7: Confirm Order & Output Summary
- Once the order is placed, output a summary including:
  - **Final list of items purchased** (including any substitutions).
  - **Total cost**.
  - **Chosen delivery time**.

**Important:** Ensure efficiency and accuracy throughout the process.
`;

// Create browser session
const browserSession = new BrowserSession();

// Create agent
const agent = new Agent(
	task,
	new ChatOpenAI({ model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY! }),
	{
		browserSession: browserSession,
		useVision: true,
	},
);

async function main(): Promise<void> {
	try {
		console.log("🛒 Starting Migros Online shopping automation...");
		await agent.run();
		console.log("✅ Shopping task completed successfully!");
	} catch (error) {
		console.error("❌ Error during shopping task:", error);
	} finally {
		// Clean up browser session
		if (browserSession) {
			await browserSession.close();
		}
	}
}

// Run the main function
main().catch(console.error);
