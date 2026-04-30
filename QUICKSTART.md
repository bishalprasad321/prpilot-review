# Quick Start Guide

This guide will help you integrate PR Pilot Review into your GitHub repository to enable automated, multi-model consensus code reviews.

## Prerequisites

Before setting up the action, you need an API key from a supported LLM provider.

1. **Choose your LLM provider:** The action currently supports `gemini` and `groq`.
2. **Obtain an API key:** Register or log in to your chosen provider's platform to generate an API key.
   - For Gemini: Google AI Studio
   - For Groq: Groq Console

## Configuration Steps

### 1. Add the API key to GitHub Secrets

You need to store your API key securely in your GitHub repository.

1. Navigate to your repository on GitHub.
2. Go to **Settings** > **Secrets and variables** > **Actions**.
3. Click **New repository secret**.
4. Name the secret appropriately (e.g., `GROQ_API_KEY` or `GEMINI_API_KEY`).
5. Paste your API key as the secret value and save.

### 2. Enable GitHub Actions to Approve Pull Requests

For the bot to successfully submit an "APPROVE" or "REQUEST_CHANGES" review decision, you must explicitly grant this permission in your repository settings.

1. Navigate to your repository on GitHub.
2. Go to **Settings** > **Actions** > **General**.
3. Scroll down to the **Workflow permissions** section.
4. Ensure the checkbox for **Allow GitHub Actions to create and approve pull requests** is checked.
5. Click **Save**.

_(Note: If this setting is not enabled, the action will still be able to post regular comments, but may fail when attempting to submit a formal approval or change request)._

### 3. Set up the Workflow File

Create a new file in your repository at `.github/workflows/ai-review.yml` and add the following configuration:

```yaml
name: AI Code Review

on:
  pull_request:
    branches: [main, develop]

jobs:
  ai-review:
    name: Multi-Model AI Review
    runs-on: ubuntu-latest

    permissions:
      pull-requests: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: bishalprasad321/prpilot-review@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          llm_provider: groq
          llm_api_key: ${{ secrets.GROQ_API_KEY }}

          # Optional: Use Groq's OpenAI-compatible API
          llm_provider_url: https://api.groq.com/openai/v1
```

### 3. Advanced Configuration (Optional)

You can customize the models used for review and the behavior of the action.

```yaml
- uses: bishalprasad321/prpilot-review@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    llm_provider: groq
    llm_api_key: ${{ secrets.GROQ_API_KEY }}
    llm_provider_url: https://api.groq.com/openai/v1

    # Customize model configuration
    reviewer_models: "llama-3.1-8b-instant,openai/gpt-oss-20b,llama-3.3-70b-versatile"
    judge_model: "openai/gpt-oss-120b"

    # Adjust consensus parameters
    max_consensus_rounds: "3"

    # Feature toggles
    inline_comments_enabled: "true"
    max_diff_lines: "5000"
    enable_incremental_diff_processing: "true"
```

For more detailed information on inputs, outputs, and configuration options, please refer to the [API Reference](docs/api.md).
