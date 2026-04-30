# Architecture Overview

PR Pilot Review is designed as an intelligent, multi-model consensus system. It aims to provide robust, balanced, and highly reliable automated code reviews by leveraging multiple LLM models in parallel and employing a deterministic consensus mechanism.

## Core System Flow

The system operates through a structured pipeline upon receiving a pull request event.

1. **Initialization**: Validates inputs, initializes the GitHub client, and parses configurations.
2. **Diff Extraction**: Retrieves the pull request diff, filters out excluded files (e.g., binaries, lockfiles), and prepares the content for analysis.
3. **Idempotency Check**: Verifies the current commit hash against previously reviewed commits to avoid redundant processing.
4. **Parallel Review Execution**: Dispatches the filtered diff to the configured reviewer models concurrently.
5. **Consensus Resolution**: Analyzes the feedback from all reviewers. If consensus is not immediately reached, a judge model acts as a tie-breaker.
6. **Comment Formulation**: Maps the agreed-upon findings to specific lines in the diff to generate inline comments and a summary report.
7. **Publishing**: Submits the review to the GitHub pull request.

## Consensus Algorithm

The cornerstone of the architecture is the consensus algorithm, designed to mitigate the biases or hallucinations of any single model.

```
[ PR Submitted ]
       |
       v
[ Query Reviewers in Parallel ]
  - Reviewer 1 (e.g., llama-3.1-8b-instant)
  - Reviewer 2 (e.g., openai/gpt-oss-20b)
  - Reviewer 3 (e.g., llama-3.3-70b-versatile)
       |
       v
[ Evaluate Consensus ]
       |
   +---+---+
   |       |
[YES]     [NO]
   |       |
   v       v
[Use]   [Query Judge Model]
[Dec.]     |
           v
        [Judge Decision] (e.g., openai/gpt-oss-120b)
           |
           v
     [Final Decision] (APPROVE / REQUEST_CHANGES / COMMENT)
```

### Decision Logic Rules

- **Immediate Consensus**: If two or more reviewers agree on a decision, that decision is adopted.
- **Tie-breaker**: If all three reviewers propose different decisions, the judge model is invoked to make the final determination.
- **Retry Mechanism**: The system can perform up to a configurable number of consensus rounds if transient errors occur or if responses are malformed.
- **Finding Consolidation**: Duplicate or overlapping findings from multiple reviewers are merged to prevent spamming the pull request.

## Project Structure

The codebase is organized modularly to separate concerns and facilitate testing.

- `src/index.ts`: The main entry point orchestrating the high-level pipeline.
- `src/llm/`: Contains abstractions for interacting with various LLM providers (e.g., Groq, Gemini).
- `src/review/`: Implements the consensus logic (`review-orchestrator.ts`) and the logic for mapping findings to the diff (`inline-comment-builder.ts`).
- `src/github/`: Encapsulates interactions with the GitHub REST API.
- `src/diff/`: Handles the parsing, filtering, and chunking of pull request diffs.
- `src/state/`: Manages idempotency state to track reviewed commits.
- `src/utils/`: Shared utilities for logging, formatting, and type definitions.
- `docs/adr/`: Architecture Decision Records detailing the rationale behind significant design choices.

## Architecture Decision Records (ADRs)

For an in-depth understanding of specific architectural choices, refer to the ADRs:

- [ADR 001: Multi-Model Consensus Architecture](adr/ADR-001-multi-model-consensus-architecture.md)
- [ADR 002: LLM API Integration](adr/ADR-002-llm-api-integration.md)
- [ADR 003: Inline Comment Mapping](adr/ADR-003-inline-comment-mapping.md)
- [ADR 004: Idempotency State Management](adr/ADR-004-idempotency-state-management.md)
