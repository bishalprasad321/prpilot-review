# PR Pilot Review

**Intelligent Multi-Model Consensus AI PR Reviewer** — Automated code reviews with consensus from configurable LLM providers like Gemini and Groq.

[![Build Status](https://github.com/bishalprasad321/prpilot-review/actions/workflows/ci.yml/badge.svg)](https://github.com/bishalprasad321/prpilot-review/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

PR Pilot Review is a GitHub Action that performs intelligent, consensus-based code reviews on pull requests using configurable LLM providers. Unlike single-model reviewers, it runs three independent AI reviewers in parallel and employs a judge model to reach consensus, ensuring more thorough, balanced, and objective code quality feedback.

### Key Features

- **Multi-Model Consensus:** Utilizes 3 independent reviewers and 1 judge for balanced decisions.
- **Parallel Execution:** All reviewers run simultaneously, typically completing within seconds.
- **Inline Comments:** Provides specific code suggestions directly on exact lines in the pull request diff.
- **Idempotent Operations:** Skips previously reviewed commits to avoid redundant processing.
- **Smart Filtering:** Automatically ignores build artifacts, binary files, and dependencies to focus on critical changes.
- **Highly Configurable:** Allows selection of reviewer models to optimize for cost, speed, or quality.
- **Safe Defaults:** Employs `continue-on-error` behavior to ensure the action never blocks pull request workflows.
- **Production Ready:** Built with robust error handling and graceful degradation mechanisms.

## Documentation

Comprehensive documentation has been organized into specific guides:

- **[Quick Start Guide](QUICKSTART.md)**: Step-by-step instructions for integrating the action into your repository, configuring API keys, and setting up workflows.
- **[API Reference](docs/api.md)**: Detailed information on action inputs, outputs, model presets, and configuration options.
- **[Architecture Overview](docs/architecture.md)**: High-level explanation of the system's consensus algorithm, decision logic, and internal structure.
- **[Development Guide](DEVELOPMENT.md)**: Instructions for local environment setup, testing, and building the project.
- **[Contributing](CONTRIBUTING.md)**: Guidelines for opening issues, submitting pull requests, and adhering to code standards.

For in-depth architectural decisions, please refer to our Architecture Decision Records (ADRs) located in `docs/adr/`.

## API Keys & Billing

This action requires an API key from a supported LLM provider (e.g., Gemini or Groq). Please refer to the [API Reference](docs/api.md) for configuration details. Be aware of your provider's rate limits, free tier quotas, and potential costs associated with the models you select.

## Troubleshooting

If you encounter issues such as the action not running, zero findings being reported, or quota exceeded errors, please consult the troubleshooting section in the [Quick Start Guide](QUICKSTART.md). Enabling debug mode (`debug: "true"`) can provide detailed logs of the consensus process.

## Security

- **No Code Execution:** The action only reads pull request diffs and does not execute the source code.
- **API Key Security:** Keys are securely passed via GitHub Secrets and are not logged.
- **Audit Trail:** All reviews are submitted natively as GitHub PR comments, providing a clear history.
- **Fail-Safe Design:** Uses `continue-on-error` by default to prevent blocking critical CI/CD pipelines upon failure.

## License

This project is licensed under the MIT License — See the [LICENSE](./LICENSE) file for details.

---

**Developed by [Bishal Prasad](https://github.com/bishalprasad321)**

For further questions or discussions, please open an issue or refer to our [Discussions](https://github.com/bishalprasad321/prpilot-review/discussions) page.
