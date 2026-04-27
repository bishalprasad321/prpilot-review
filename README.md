# PR Pilot Review

> **Intelligent Multi-Model Consensus AI PR Reviewer** — Automated code reviews with consensus from configurable LLM providers like Gemini and Groq.

[![Build Status](https://github.com/bishalprasad321/prpilot-review/actions/workflows/ci.yml/badge.svg)](https://github.com/bishalprasad321/prpilot-review/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

PR Pilot Review is a GitHub Action that performs intelligent, consensus-based code reviews on pull requests using configurable LLM providers such as Gemini or Groq. Unlike single-model reviewers, it runs **3 independent AI reviewers in parallel** and uses a **judge model to reach consensus**, ensuring more thorough and balanced code quality feedback.

### Key Features

- 🤖 **Multi-Model Consensus** — 3 independent reviewers + 1 judge for balanced decisions
- ⚡ **Parallel Execution** — All reviewers run simultaneously (~2-3 seconds total)
- 🎯 **Inline Comments** — Specific code suggestions on exact lines
- 💾 **Idempotent** — Skips already-reviewed commits to avoid duplicate work
- 🔍 **Smart Filtering** — Ignores build artifacts, binary files, dependencies
- 📊 **Configurable** — Choose reviewer models for cost/quality trade-offs
- 🛡️ **Safe Defaults** — Uses `continue-on-error` to never block PRs
- 🚀 **Production Ready** — Battle-tested error handling & graceful degradation

## Quick Start

### 1. Choose your LLM provider

This action supports multiple providers today, including `gemini` and `groq`.

### 2. Add the API key to GitHub Secrets

Go to your repository:

- **Settings** → **Secrets and variables** → **Actions**
- Add a provider-specific secret, e.g. `GROQ_API_KEY`

### 3. Optional base URL for Groq

If you are using Groq OpenAI-compatible models, set `llm_provider_url` to the Groq OpenAI endpoint:

```yaml
llm_provider_url: https://api.groq.com/openai/v1
```

### 4. Use the Action

Create `.github/workflows/ai-review.yml`:

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
          llm_provider_url: https://api.groq.com/openai/v1
          # Optional: customize model configuration
          # reviewer_models: "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.5-pro"
          # judge_model: "gemini-2.5-pro"
          # max_consensus_rounds: "3"
          # inline_comments_enabled: "true"
```

That's it! The action will run on every PR and post reviews as comments.

## Configuration

All inputs are optional (sensible defaults provided):

```yaml
with:
  # Required
  github_token: ${{ secrets.GITHUB_TOKEN }}
  llm_provider: groq
  llm_api_key: ${{ secrets.GROQ_API_KEY }}
  llm_provider_url: https://api.groq.com/openai/v1

  # Optional: Model Configuration
  reviewer_models: "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.5-pro" # 3 models
  judge_model: "gemini-2.5-pro" # Consensus judge
  max_consensus_rounds: "3" # Max retry rounds

  # Optional: Features
  inline_comments_enabled: "true" # Post inline code comments
  max_diff_lines: "5000" # Max diff to process
  enable_incremental_diff_processing: "true" # Handle large diffs
  debug: "false" # Verbose logging
```

Use stable provider-specific model IDs. For Gemini, use `v1beta` model codes. For Groq, use free-tier model IDs such as `groq-1.5-mini` or `groq-1.5-small`.

### Groq Example

```yaml
with:
  github_token: ${{ secrets.GITHUB_TOKEN }}
  llm_provider: groq
  llm_api_key: ${{ secrets.GROQ_API_KEY }}
  reviewer_models: "llama-3.1-8b-instant,openai/gpt-oss-20b,llama-3.3-70b-versatile"
  judge_model: "openai/gpt-oss-120b"
  max_consensus_rounds: "3"
  inline_comments_enabled: "true"
```

### Model Presets

Choose models based on your needs:

#### Groq Default Production ✅

```yaml
reviewer_models: "llama-3.1-8b-instant,openai/gpt-oss-20b,llama-3.3-70b-versatile"
judge_model: "openai/gpt-oss-120b"
```

Best balance of production reliability and coverage.

#### Groq Maximum Speed ✅

```yaml
reviewer_models: "llama-3.1-8b-instant,openai/gpt-oss-20b,openai/gpt-oss-20b"
judge_model: "openai/gpt-oss-120b"
```

Optimized for faster review cycles with lighter reviewer models.

#### Groq Maximum Quality ✅

```yaml
reviewer_models: "llama-3.3-70b-versatile,openai/gpt-oss-120b,openai/gpt-oss-20b"
judge_model: "openai/gpt-oss-120b"
```

Highest quality review configuration for the deepest analysis.

## How It Works

### Consensus Algorithm

```
┌─────────────────────────────────────────────┐
│ PR Submitted                                │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ Round 1: Query 3 Reviewers in Parallel      │
│ - Reviewer 1: gemini-2.5-flash              │
│ - Reviewer 2: gemini-2.5-flash-lite         │
│ - Reviewer 3: gemini-2.5-pro                │
└────────────────┬────────────────────────────┘
                 │
          ┌──────▼──────┐
          │ Consensus?  │
          └──────┬──────┘
                 │
        ┌────────┴────────┐
        │                 │
    YES │                 │ NO
        │                 │
        ▼                 ▼
    ✅ Use Decision   Query Judge
    (2 or 3 agree)   (tie-breaker)
                         │
                         ▼
                    🏛️ gemini-2.5-pro
                    Makes final decision
                         │
                         ▼
                    ✅ Final Decision
                    (APPROVE/REQUEST_CHANGES/COMMENT)
```

### Decision Logic

- **Immediate Consensus (Round 1)** — If 2+ reviewers agree, use that decision
- **Judge Called** — If all 3 disagree, judge model makes final call
- **Consensus Rounds** — Can retry up to 3 rounds if needed (rare)
- **Findings Consolidation** — Merges duplicate findings from multiple reviewers

### Output

The action posts a GitHub review with:

- ✅/❌ Final decision (APPROVE, REQUEST_CHANGES, or COMMENT)
- 📋 Summary reasoning from consensus process
- 📍 Inline comments with specific code suggestions
- 🔄 Consensus round info

## Architecture

See detailed architecture in [docs/adr/](./docs/adr/):

- **ADR-001** — Multi-Model Consensus Architecture
- **ADR-002** — LLM Provider Integration & Model Selection
- **ADR-003** — Inline Comment Mapping
- **ADR-004** — Idempotency & State Management

### Project Structure

```
prpilot-review/
├── src/
│   ├── index.ts                 # Main orchestrator (13-step pipeline)
│   ├── llm/
│   │   └── llm-client.ts       # LLM provider abstraction
│   ├── review/
│   │   ├── review-orchestrator.ts  # Consensus logic
│   │   └── inline-comment-builder.ts   # Line mapping
│   ├── github/
│   │   └── github-client.ts    # GitHub API wrapper
│   ├── diff/
│   │   └── diff-processor.ts   # Diff parsing & filtering
│   ├── state/
│   │   └── state-manager.ts    # Idempotency state
│   └── utils/
│       ├── types.ts            # Central type definitions
│       ├── logger.ts           # Unified logging
│       └── formatter.ts        # Markdown formatting
├── .github/workflows/
│   ├── ci.yml                  # Build & quality checks
│   ├── action-test.yml         # Integration tests
│   └── security.yml            # Security audits
├── docs/
│   └── adr/                    # Architecture Decision Records
├── action.yml                  # Action manifest
└── package.json                # Dependencies
```

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- git

### Setup

```bash
# Clone the repository
git clone https://github.com/bishalprasad321/prpilot-review.git
cd prpilot-review

# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Build (bundles with NCC)
npm run build
```

### Scripts

```bash
npm run typecheck    # TypeScript validation
npm run lint         # ESLint checks
npm run format       # Auto-fix formatting
npm run test         # Run Jest tests
npm run build        # Bundle with NCC
npm run verify       # Verify bundle
npm run all          # Run all checks
```

### Making Changes

1. Create a branch: `git checkout -b feature/your-feature`
2. Make changes in `src/`
3. Run tests: `npm test`
4. Type check: `npm run typecheck`
5. Lint: `npm run lint`
6. Build: `npm run build` (updates `dist/index.js`)
7. Commit dist changes: `git add dist/` (NCC bundle)
8. Push & create PR

## API Keys & Billing

### Getting an API Key

1. Choose your provider: `gemini` or `groq`
2. Create an API key in the provider console
3. Copy the key and add it to GitHub repo secrets

### Free Tier Quotas

The free tier has limits:

- ~1,500 requests/minute per model
- ~1 million tokens/day per model

If you hit quota errors:

1. **Upgrade to paid plan** — Recommended for production
2. **Use lighter models** — `gemini-2.5-flash-lite` or `groq-1.5-mini` use fewer tokens
3. **Reduce reviewer count** — Use 2 instead of 3 reviewers
4. **Schedule reviews** — Spread runs across off-peak hours

See provider-specific quota documentation for your chosen LLM.

### Costs

Typical cost per PR review will vary by provider and model selection:

- **Default config** — Low-cost balanced review
- **Cost-optimized** — Minimal token usage and fastest reviewers
- **Quality-optimized** — More comprehensive analysis with higher cost

Pricing is provider-dependent. For Gemini, see [Gemini pricing](https://ai.google.dev/pricing).

## Troubleshooting

### Action not running?

- Check `llm_provider` and `llm_api_key` are configured correctly
- Verify branch triggers (pull_request, branches)
- Check action logs for errors

### Zero findings even with code changes?

- Enable debug mode to see full model responses
- Check whether the selected models are valid for your provider
- Try a different model preset
- Verify the PR has actual code changes

### Quota exceeded errors?

- Check your provider billing or free tier quota
- Switch to paid plan or upgrade quota if available
- Use lighter models where supported

### Model not found errors?

- Verify model names match your provider's available models
- For Gemini, check [Gemini models](https://ai.google.dev/gemini-api/docs/models/gemini)
- For Groq, check your Groq account model docs

### Slow reviews?

- All 3 reviewers run in parallel (typical: 2-3 seconds)
- If taking longer, check API latency or diff size
- Enable debug mode to see timing breakdown

## Performance

| Metric             | Default Config                |
| ------------------ | ----------------------------- |
| Reviewer speed     | ~2-3 seconds (parallel)       |
| Consensus time     | 2-4 seconds (Round 1 usually) |
| Total action time  | 3-5 seconds                   |
| Model availability | 100% (v1beta)                 |
| Code findings      | 5-15 per review               |

## Testing

### Local Testing

```bash
npm test                    # Run all tests
npm test -- --watch       # Watch mode
npm test -- --coverage    # Coverage report
```

### Integration Testing

The repository includes integration tests in `.github/workflows/action-test.yml`:

```bash
# Manually trigger via GitHub Actions UI:
# 1. Go to Actions tab
# 2. Select "Test Action - Multi-Model Consensus Review Integration"
# 3. Click "Run workflow"
# 4. Set: debug_enabled=true, model_preset=default
# 5. Click "Run workflow"
```

### Testing on Your PR

1. Create a test PR against develop/main
2. The action automatically runs
3. Check the PR for review comments
4. Check action logs for debug info

## Outputs

The action provides outputs for downstream jobs:

```yaml
outputs:
  review_decision: # APPROVE, REQUEST_CHANGES, or COMMENT
  consensus_reasoning: # Why the judge made this decision
  consensus_round: # Which round (1-3) consensus achieved
  review_id: # GitHub review ID if submitted
```

Use in subsequent workflow steps:

```yaml
- name: Use review results
  run: |
    echo "Decision: ${{ steps.review.outputs.review_decision }}"
    echo "Round: ${{ steps.review.outputs.consensus_round }}"
    echo "ID: ${{ steps.review.outputs.review_id }}"
```

## Security

- 🔐 **No code execution** — Only reads PR diffs, doesn't execute code
- 🔒 **API key secure** — Key passed via secrets, not logged
- 📝 **Audit trail** — All reviews submitted as GitHub reviews (visible in history)
- ✅ **Safe defaults** — Uses `continue-on-error` to never break workflows
- 🛡️ **Error handling** — Gracefully handles API failures without crashing

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/name`
3. Make changes and test thoroughly
4. Ensure all checks pass: `npm run all`
5. Build the dist: `npm run build`
6. Commit dist changes
7. Push and create a pull request

## License

MIT License — See [LICENSE](./LICENSE) file

## Acknowledgments

- Built with configurable LLM providers such as Gemini or Groq
- GitHub Actions integration via [@actions/core](https://github.com/actions/toolkit)
- Code bundling via [@vercel/ncc](https://github.com/vercel/ncc)

## Support

- 📖 [Architecture Docs](./docs/adr/)
- 🐛 [Report Issues](https://github.com/bishalprasad321/prpilot-review/issues)
- 💬 [Discussions](https://github.com/bishalprasad321/prpilot-review/discussions)

---

**Made with ❤️ by [Bishal Prasad](https://github.com/bishalprasad321)**

**Questions?** Check the [docs/adr/](./docs/adr/) for detailed architecture decisions, or open an issue!
