# BrowserNode Examples

This workspace contains various examples demonstrating how to use BrowserNode for browser automation and AI agent tasks.

## Setup

1. From the root directory, install dependencies:
   ```bash
   npm install
   ```

2. Navigate to the examples directory:
   ```bash
   cd examples
   ```

3. Set up your environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

## Running Examples

### Simple Example
```bash
npm run simple
```

### Other Examples
```bash
# Run any TypeScript file directly
npm run dev path/to/example.ts

# Or use tsx directly
npx tsx simple.ts
npx tsx use-cases/google_sheets.ts
npx tsx custom-functions/2fa.ts
```

## Example Categories

- **`simple.ts`** - Basic usage example
- **`browser/`** - Browser-specific examples (profiles, sessions, etc.)
- **`custom-functions/`** - Custom action examples (2FA, file upload, etc.)
- **`features/`** - Feature demonstrations (multi-tab, validation, etc.)
- **`models/`** - Different LLM model examples
- **`use-cases/`** - Real-world automation scenarios
- **`ui/`** - User interface examples

## Dependencies

This workspace includes additional dependencies needed for specific examples:
- `csv-writer`, `csv-parse` - For CSV file operations
- `pdf-parse` - For PDF content extraction
- `otplib` - For 2FA/OTP functionality
- `dotenv` - For environment variable management
- `zod` - For parameter validation

## Environment Variables

Most examples require API keys. Create a `.env` file with:

```
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
GOOGLE_API_KEY=your_google_api_key
OTP_SECRET_KEY=your_otp_secret_for_2fa_examples
``` 