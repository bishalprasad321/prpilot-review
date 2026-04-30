# API Reference

This document details the configuration inputs and the outputs provided by the PR Pilot Review action, as defined in `action.yml`.

## Inputs

All inputs are passed via the `with` block in your workflow step.

| Input Name                           | Required | Default                                                           | Description                                                                                                    |
| :----------------------------------- | :------: | :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `github_token`                       |   Yes    | N/A                                                               | GitHub token with permissions to read PR details and post reviews. Typically `${{ secrets.GITHUB_TOKEN }}`.    |
| `llm_provider`                       |    No    | `groq`                                                            | Language model provider to use. Supported values: `gemini` or `groq`.                                          |
| `llm_api_key`                        |    No    | N/A                                                               | API key for the chosen LLM provider. Should be stored as a GitHub Secret.                                      |
| `llm_provider_url`                   |    No    | N/A                                                               | Optional base URL for the LLM provider. For Groq's OpenAI compatibility, use `https://api.groq.com/openai/v1`. |
| `reviewer_models`                    |    No    | `llama-3.1-8b-instant,openai/gpt-oss-20b,llama-3.3-70b-versatile` | Comma-separated list of 3 review models. Use provider-specific model IDs.                                      |
| `judge_model`                        |    No    | `openai/gpt-oss-120b`                                             | Model used for consensus judgment when reviewer opinions differ.                                               |
| `max_consensus_rounds`               |    No    | `3`                                                               | Maximum number of consensus rounds before forcing a judge decision.                                            |
| `inline_comments_enabled`            |    No    | `true`                                                            | Enable inline code comments on specific lines. If false, only a summary comment is posted.                     |
| `max_diff_lines`                     |    No    | `5000`                                                            | Maximum diff lines to process. Exceeding diffs will be processed in chunks or summarized.                      |
| `enable_incremental_diff_processing` |    No    | `true`                                                            | Enable incremental diff processing to handle large diffs by processing them in chunks.                         |
| `debug`                              |    No    | `false`                                                           | Enable debug mode for verbose logging of consensus rounds and model interactions.                              |

## Outputs

These outputs can be used by subsequent steps in your workflow.

| Output Name           | Description                                                                                 |
| :-------------------- | :------------------------------------------------------------------------------------------ |
| `review_decision`     | Final consensus decision from the judge model (`APPROVE`, `REQUEST_CHANGES`, or `COMMENT`). |
| `consensus_reasoning` | The judge model's reasoning for the consensus decision.                                     |
| `consensus_round`     | The round (1-3) in which consensus was achieved, or the max round if forced.                |
| `review_id`           | The GitHub PR review ID if the review was successfully submitted.                           |

### Usage Example

```yaml
- name: Use review results
  run: |
    echo "Decision: ${{ steps.review.outputs.review_decision }}"
    echo "Reasoning: ${{ steps.review.outputs.consensus_reasoning }}"
    echo "Consensus reached in round: ${{ steps.review.outputs.consensus_round }}"
```

## Model Presets

Depending on your requirements for speed, cost, and quality, you can adjust the `reviewer_models` and `judge_model` inputs.

### Groq Presets

**Default Production (Balanced)**

```yaml
reviewer_models: "llama-3.1-8b-instant,openai/gpt-oss-20b,llama-3.3-70b-versatile"
judge_model: "openai/gpt-oss-120b"
```

**Maximum Speed**

```yaml
reviewer_models: "llama-3.1-8b-instant,openai/gpt-oss-20b,openai/gpt-oss-20b"
judge_model: "openai/gpt-oss-120b"
```

**Maximum Quality**

```yaml
reviewer_models: "llama-3.3-70b-versatile,openai/gpt-oss-120b,openai/gpt-oss-20b"
judge_model: "openai/gpt-oss-120b"
```

### Gemini Presets

_(Assuming `llm_provider: gemini`)_

**Default Production**

```yaml
reviewer_models: "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.5-pro"
judge_model: "gemini-2.5-pro"
```

## Quotas and Limitations

Be mindful of your provider's rate limits and quotas.

- Free tiers typically enforce requests-per-minute and tokens-per-day limits.
- If you encounter quota errors, consider using lighter models, reducing the frequency of runs, or upgrading to a paid tier.
