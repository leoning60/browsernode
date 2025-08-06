<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/2a91581a-623c-40a7-94d0-04aa720e1ff9">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/9101f203-8fc7-4d64-b116-7ad3db0f6ff0">
  <img alt="Shows a black Browser Use Logo in light color mode and a white one in dark color mode." src="https://github.com/user-attachments/assets/9101f203-8fc7-4d64-b116-7ad3db0f6ff0"  width="full">
</picture>


<h1 align="center">Enable AI to control your browser 🤖</h1>
<h3 align="center">Browsernode is TypeScript implementation of <a href="https://browser-use.com/">Browser-use</a> </h3>

🌐 Browsernode is the easiest way to connect your AI agents with the browser.
✅ Browsernode is compatible with all of <a href="https://browser-use.com/"> Browser-use</a> APIs and features.


# Quick start

with [Node.js](https://nodejs.org/en/download) (v20.19.4 or higher) and npm

❌ Bun environment , has a Playwright bug.

```bash
npm install browsernode
```
Install Playwright:
[Installation | Playwright](https://playwright.dev/docs/intro)
```bash
npm init playwright@latest
```

```bash
playwright install chromium
```


Add your API keys for the provider you want to use to your `.env` file.
```bash
mv .env.example .env
```

```bash
OPENAI_API_KEY=
```
For other settings, models, and more, check out the [documentation 📕](https://docs.browsernode.com).

Spin up your agent:

### Commonjs style
```javascript
const { Agent } = require("browsernode");
const { ChatOpenAI } = require("browsernode/llm");

(async () => {
  const llm = new ChatOpenAI({
    model: "gpt-4.1",
    temperature: 0.0,
    apiKey: process.env.OPENAI_API_KEY,
  });

  const task = "Search for the latest tesla stock price";
  const agent = new Agent({
    task,
    llm,
  });

  const history = await agent.run();
  console.log(history.usage);
})();
```


### ESM style
package.json
```javascript
{
  // ... other properties
  "type": "module"
  // ... other properties
}
```


```javascript
import { Agent } from "browsernode";
import { ChatOpenAI } from "browsernode/llm";

const llm = new ChatOpenAI({
	model: "gpt-4.1",
	temperature: 0.0,
	apiKey: process.env.OPENAI_API_KEY,
});

const task = "Search for the latest tesla stock price";
const agent = new Agent({
	task: task,
	llm: llm,
});
agent.run();
```

run
```js
npx tsx quickstart.ts
```

## Test with UI
You can test browsernode using [gadio_demo](./examples/ui/gradio_demo.ts)
## Test with an interactive CLI
You can also use our browsernode-cli

# Demos

[Task](./examples/custom-functions/save_to_file_top20_companies.ts):**look up the world's most valuable companies, save top 5 companies and their value to companies.txt.**

![AI Did Search And Save](https://github.com/user-attachments/assets/ac2e1fa6-f455-4f89-a710-877aebfcd590)

output: companies.txt
```txt
1. Microsoft: $3.530 T
2. NVIDIA: $3.462 T
3. Apple: $2.934 T
4. Amazon: $2.251 T
5. Alphabet (Google): $2.125 T
```
<br/><br/>
[Task](./examples/custom-functions/google_doc.ts):**Write a letter in Google Docs to my Papa, thanking him for everything, and save the document as a PDF.**

![Write google doc And Save pdf](https://github.com/user-attachments/assets/615a8581-7a08-4a7a-85ad-2ac8cebdf74c)

<br/><br/>

[Task](./examples/use-cases/wikipedia_banana_to_quantum.ts):**go to https://en.wikipedia.org/wiki/Banana and click on buttons on the wikipedia page to go as fast as possible from banna to Quantum mechanics**

![from banana to Quantum mechanics](https://github.com/user-attachments/assets/ae3ce541-a710-4941-a28a-6f26be704c9f)
result:
```javascript
// ... previous actions
🛠️ Action 1/1: {
  "clickElement": {
    "index": 41
  }
}
// ... more actions
 🛠️ Action 1/1: {
"done": {
    "success": false,
    "text": "I navigated through the Banana Wikipedia page, reaching the section on Fusarium wilt TR4. However, I did not complete the task of reaching Quantum mechanics."
  }
}
// ... final result
📄 Result: I navigated through the Banana Wikipedia page, reaching the section on Fusarium wilt TR4. However, I did not complete the task of reaching Quantum mechanics.
```
<br/><br/>

## More examples

For more examples see the [examples](examples) folder

# Vision

Tell your computer what to do, and it gets it done.

## Contributing

We love contributions! Feel free to open issues for bugs or feature requests. To contribute to the docs, check out the `/docs` folder.
