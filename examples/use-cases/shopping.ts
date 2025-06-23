import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import {
	Agent,
	Browser,
	BrowserConfig,
	BrowserContextConfig,
} from "browsernode";

const task = `
### Prompt for Shopping Agent – Migros Online Grocery Order

**Objective:**
Visit [Migros Online](https://www.migros.ch/en), search for the required grocery items, add them to the cart, select an appropriate delivery window, and complete the checkout process using TWINT.

**Important Instructions:**
- Wait for pages to fully load before taking any actions
- If an element is not found, wait 3 seconds and try again
- Make sure that you don't buy more than it's needed for each article.
- After your search, if you click the "+" button, it adds the item to the basket.
- If you open the basket side window menu, you can close it by clicking the X button on the top right. This will help you navigate easier.
- If you encounter any "Element with index X does not exist" errors, wait for the page to load completely and refresh the page if necessary.
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
- If the total order **is below CHF 99**, add **a liquid soap refill** to reach the minimum. If it's still below, you can buy some bread, dark chocolate.
- At this step, check if you have bought MORE items than needed. If the price is more than CHF200, you MUST remove items.
- If an item is not available, choose an alternative.
- If age verification is needed, remove alcoholic products, we haven't verified yet.

---

### Step 5: Select Delivery Window
- Choose a **delivery window within the current week**. It's ok to pay up to CHF2 for the window selection.
- Preferably select a slot within the workweek.

---

### Step 6: Checkout
- Proceed to checkout.
- Select **TWINT** as the payment method.
- Check out.
- If needed, the username is: nikoskalio.dev@gmail.com
- and the password is: TheCircuit.Migros.dev!

---

### Step 7: Confirm Order & Output Summary
- Once the order is placed, output a summary including:
  - **Final list of items purchased** (including any substitutions).
  - **Total cost**.
  - **Chosen delivery time**.

**Important:** Ensure efficiency and accuracy throughout the process.
`;

async function main(task: string, max_steps: number = 108) {
	const llm = new ChatOpenAI({
		modelName: "gpt-4o",
		temperature: 0.0,
		streaming: true,
		openAIApiKey: process.env.OPENAI_API_KEY,
	});
	// 创建浏览器配置，提高稳定性
	const browser = new Browser(
		new BrowserConfig({
			headless: false, // 设置为非headless模式便于调试
			newContextConfig: new BrowserContextConfig({
				highlightElements: true,
				viewportExpansion: 100, // 增加视口扩展，确保更多元素被检测到
				waitBetweenActions: 1.0, // 添加延迟，让页面有时间加载
			}),
		}),
	);

	const agent = new Agent(task, llm, {
		useVision: true,
		maxFailures: 3, // 增加最大失败次数
		retryDelay: 3, // 减少重试延迟
		maxActionsPerStep: 5, // 减少每步最大动作数
		browser: browser, // 使用自定义浏览器配置
	});
	await agent.run(max_steps);
}

await main(task);
