# Development Guide

This guide outlines how to set up the PR Pilot Review project for local development, run tests, and build the action.

## Prerequisites

Ensure you have the following installed on your development machine:

- Node.js (Version 20 or higher)
- npm (Version 10 or higher)
- Git

## Initial Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/bishalprasad321/prpilot-review.git
   cd prpilot-review
   ```

2. Install project dependencies:
   ```bash
   npm install
   ```

## Development Workflow

The source code is located in the `src/` directory. The project uses TypeScript.

### Available Scripts

The following npm scripts are available for development:

- `npm run typecheck`: Validates TypeScript types.
- `npm run lint`: Runs ESLint to check for code quality issues.
- `npm run format`: Automatically fixes formatting issues using Prettier.
- `npm run test`: Runs the Jest test suite.
- `npm run build`: Bundles the action using `@vercel/ncc` into the `dist/` directory.
- `npm run verify`: Verifies the generated bundle.
- `npm run all`: Runs formatting, linting, typechecking, tests, and the build process sequentially.

### Making Changes

1. Create a new branch for your feature or bugfix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your modifications within the `src/` directory.
3. Ensure your code passes all checks:
   ```bash
   npm run all
   ```
4. **Important**: The GitHub Action runs from the compiled `dist/index.js` file. You must build the project and commit the `dist/` directory for your changes to take effect in the action.
   ```bash
   npm run build
   git add dist/
   git commit -m "Build dist bundle"
   ```

## Testing

### Local Testing

The project uses Jest for unit testing. You can run the tests locally:

```bash
npm test                    # Run all tests
npm test -- --watch         # Run tests in watch mode
npm test -- --coverage      # Generate a coverage report
```

### Integration Testing

Integration tests are defined in `.github/workflows/action-test.yml`. You can trigger these manually via the GitHub Actions UI:

1. Navigate to the **Actions** tab in your repository.
2. Select the **Test Action - Multi-Model Consensus Review Integration** workflow.
3. Click **Run workflow**. You can configure options like `debug_enabled` and `model_preset` before running.

### Testing on a Pull Request

To test your changes in a real PR environment:

1. Push your branch and create a Pull Request against the `develop` or `main` branch.
2. The action will automatically run against your PR if the workflow is configured.
3. Review the action logs and the generated PR comments to verify behavior.
