# PR Pilot Review

> **Intelligent Multi-Model Consensus AI PR Reviewer** — Automated code reviews with consensus from multiple Gemini AI models.

[![Build Status](https://github.com/bishalprasad321/prpilot-review/actions/workflows/ci.yml/badge.svg)](https://github.com/bishalprasad321/prpilot-review/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

PR Pilot Review is a GitHub Action that performs intelligent, consensus-based code reviews on pull requests using Google's Gemini AI models. Unlike single-model reviewers, it runs **3 independent AI reviewers in parallel** and uses a **judge model to reach consensus**, ensuring more thorough and balanced code quality feedback.

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

### 1. Get a Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Create API Key"
3. Copy the key

### 2. Add to GitHub Secrets

Go to your repository:

- **Settings** → **Secrets and variables** → **Actions**
- Add secret: `GEMINI_API_KEY` (paste your key)

### 3. Use the Action

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
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
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
  gemini_api_key: ${{ secrets.GEMINI_API_KEY }}

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

Use stable Gemini `v1beta` model codes. If you still pass legacy aliases such as `gemini-3.0-flash` or `gemini-3.1-pro`, the action will try to remap them to supported 2.x models before calling the API.

### Model Presets

Choose models based on your needs:

#### Default (Recommended) ✅

```yaml
reviewer_models: "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.5-pro"
judge_model: "gemini-2.5-pro"
```

Best balance of speed, quality, and cost.

#### High Capability (Best Quality)

```yaml
reviewer_models: "gemini-2.5-pro,gemini-2.5-flash,gemini-2.5-flash-lite"
judge_model: "gemini-2.5-pro"
```

Uses most capable models. Higher cost but best findings.

#### Cost Optimized (Lowest Cost)

```yaml
reviewer_models: "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.5-flash-lite"
judge_model: "gemini-2.5-flash"
```

Uses lighter models. Lower cost but lighter analysis.

#### Quality Optimized (Most Findings)

```yaml
reviewer_models: "gemini-2.5-pro,gemini-2.5-flash,gemini-2.5-flash-lite"
judge_model: "gemini-2.5-pro"
```

Maximum detection power. Highest cost, most comprehensive reviews.

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
- **ADR-002** — Gemini API Integration & Model Selection
- **ADR-003** — Inline Comment Mapping
- **ADR-004** — Idempotency & State Management

### Project Structure

```
prpilot-review/
├── src/
│   ├── index.ts                 # Main orchestrator (13-step pipeline)
│   ├── llm/
│   │   └── llm-client.ts       # Gemini API abstraction
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

### Getting a Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Create API Key"
3. Select/create a project
4. Copy the key and add to GitHub repo secrets

### Free Tier Quotas

The free tier has limits:

- ~1,500 requests/minute per model
- ~1 million tokens/day per model

If you hit quota errors:

1. **Upgrade to paid plan** — Recommended for production
2. **Use lighter models** — `gemini-2.5-flash-lite` uses fewer tokens
3. **Reduce reviewer count** — Use 2 instead of 3 reviewers
4. **Schedule reviews** — Spread runs across off-peak hours

See [quota documentation](https://ai.google.dev/gemini-api/docs/rate-limits).

### Costs

Typical cost per PR review:

- **Default config** — $0.001-0.005 per review (3 reviewers + optional judge)
- **Cost-optimized** — $0.0005-0.002 per review
- **Quality-optimized** — $0.005-0.02 per review

Pricing based on [Gemini API rates](https://ai.google.dev/pricing).

## Troubleshooting

### Action not running?

- Check `GEMINI_API_KEY` is set in repo secrets
- Verify branch triggers (pull_request, branches)
- Check action logs for errors

### Zero findings even with code changes?

- Enable debug mode to see full model responses
- Check if models are available in v1beta API
- Try different model preset
- Verify PR has actual code changes

### Quota exceeded errors?

- Check your billing plan at [Google Cloud Console](https://console.cloud.google.com)
- Switch to paid plan or upgrade quota
- Use lighter models (flash-lite variants)

### Model not found errors?

- Verify model names match available list
- Models must be in `v1beta` API
- Check [available models](https://ai.google.dev/gemini-api/docs/models/gemini)

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

- Built with [Gemini AI API](https://ai.google.dev/)
- GitHub Actions integration via [@actions/core](https://github.com/actions/toolkit)
- Code bundling via [@vercel/ncc](https://github.com/vercel/ncc)

## Support

- 📖 [Architecture Docs](./docs/adr/)
- 🐛 [Report Issues](https://github.com/bishalprasad321/prpilot-review/issues)
- 💬 [Discussions](https://github.com/bishalprasad321/prpilot-review/discussions)

---

**Made with ❤️ by [Bishal Prasad](https://github.com/bishalprasad321)**

**Questions?** Check the [docs/adr/](./docs/adr/) for detailed architecture decisions, or open an issue!
