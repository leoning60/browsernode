# browser-node

To install dependencies:

```bash
bun install
```

## Development

This project uses:
- Bun as the JavaScript runtime
- Biome for code formatting and linting
- Lefthook for Git hooks
- Winston for logging
- LangChain for AI integrations

### Development Workflow

Run the development server:

```bash
bun dev
```

Run tests:

```bash
bun test
```

### CI/CD

This project uses GitHub Actions for continuous integration:

- **Linting & Formatting**: Checks code with Biome
- **Testing**: Runs the test suite with Bun
- **Building**: Builds the project

The CI pipelines run automatically on pull requests and pushes to the main branch.