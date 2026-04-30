# Contributing to PR Pilot Review

We welcome contributions to the PR Pilot Review project! Whether you're fixing bugs, improving documentation, or proposing new features, your help is appreciated.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/prpilot-review.git
   cd prpilot-review
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/bishalprasad321/prpilot-review.git
   ```

## Development Process

Please refer to the [Development Guide](DEVELOPMENT.md) for detailed instructions on setting up your local environment, available scripts, and testing procedures.

### Workflow

1. Ensure your local `main` branch is up to date with the `upstream` repository.
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**. Keep your commits focused and provide clear, descriptive commit messages.
4. **Test thoroughly**. Run the full suite of checks to ensure your changes meet the project's quality standards:
   ```bash
   npm run all
   ```
5. **Build the distributable**. The GitHub Action consumes the compiled bundle in the `dist/` directory. You must rebuild it before committing:
   ```bash
   npm run build
   git add dist/
   ```
6. **Commit your changes**:
   ```bash
   git commit -m "Brief description of the changes"
   ```
7. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

## Pull Request Guidelines

- **Open a Pull Request** against the `main` or `develop` branch of the upstream repository.
- **Describe your changes** clearly in the PR description. Detail what was changed, why it was changed, and any related issue numbers.
- Ensure all CI status checks pass. If tests fail, investigate and fix the underlying issues.
- Be prepared to discuss your code and address review feedback.

## Code Standards

- **TypeScript**: The project is written in TypeScript. Ensure all new code is strongly typed and passes the `npm run typecheck` validation.
- **Formatting**: We use Prettier for consistent code formatting. Run `npm run format` before committing.
- **Linting**: We use ESLint to catch potential errors and enforce code style. Address any warnings or errors reported by `npm run lint`.
- **Testing**: Include tests for new features and bug fixes. Existing tests must not be broken by your changes.

Thank you for contributing!
