# ADR-002: LLM Provider Integration & Model Selection

**Status:** Accepted  
**Affects:** LLM integration, provider selection, model performance, API costs

## Context

The PR Pilot Review system needed to choose:

1. **Which LLM provider** to use (OpenAI, Gemini, Claude, etc.)
2. **Which specific models** for reviewers and judge
3. **How to structure API calls** (fetch vs SDK)
4. **How to handle model availability** across API versions

### Constraints

- Must support free/low-cost tier
- Must have parallel request capability
- Must be available in v1beta API (GitHub Actions accessible)
- Must support JSON structured output
- Performance: reviewers must complete in <5 seconds total

## Decision

**Provider:** Gemini or Groq (provider configured via `llm_provider`)  
**Approach:** Fetch-based HTTP client with structured outputs and runtime model validation  
**Model Configuration:**

- Reviewers: `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`
- Judge: `gemini-2.5-pro`

### Why Gemini or Groq?

| Criteria       | Gemini       | Groq | OpenAI | Claude | Reason                   |
| -------------- | ------------ | ---- | ------ | ------ | ------------------------ |
| Free tier      | Yes          | Yes  | No     | No     | Cost critical for OSS    |
| JSON output    | Yes          | Yes  | Yes    | Yes    | All equal                |
| API support    | v1beta       | v1   | Fast   | Fast   | Both providers available |
| Speed          | Flash models | Mini | Fast   | Fast   | Both support fast models |
| Parallel calls | Yes          | Yes  | Yes    | Yes    | All support it           |
| **Chosen**     | Yes          | Yes  | No     | No     |                          |

### Why These Models?

#### Reviewers (3 models)

```
gemini-2.5-flash      (Best speed/quality balance)
gemini-2.5-flash-lite (Ultra-fast, minimal quota usage)
gemini-2.5-pro        (High-capability fallback when 2.0 quotas are unavailable)
```

**Rationale:**

- **Diversity** — Mix of 2.5 flash/pro behaviors for varied perspective
- **Speed** — All flash variants designed for latency
- **Availability** — All available in v1beta
- **Cost** — Flash models use fewer tokens than pro
- **Parallel** — Can execute 3 simultaneously in ~2-3 seconds

#### Judge (1 model)

```
gemini-2.5-pro (Strongest stable v1beta judge model)
```

**Rationale:**

- **Capability** — Best at complex decision-making
- **Cost** — Only called ~10-20% of time (when consensus fails)
- **Quality** — Pro models better at tie-breaking logic
- **Reasoning** — Can explain complex consensus decisions

## API Integration Approach

### HTTP Fetch (Not SDK)

```typescript
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
```

**Why Fetch?**

- Smaller bundle size (NCC bundles all dependencies)
- No external SDK required
- More control over retry logic
- Easier to debug (raw HTTP requests)
- Works in GitHub Actions environment

### Response Parsing

**Structured JSON Output:**

```json
{
  "decision": "APPROVE|REQUEST_CHANGES|COMMENT",
  "reasoning": "Model's reasoning for decision",
  "summary": "Brief PR summary",
  "findings": [
    {
      "file": "src/module.ts",
      "lineStart": 42,
      "lineEnd": 45,
      "severity": "warning|critical|info",
      "message": "Issue description",
      "suggestion": "How to fix"
    }
  ]
}
```

The action requests JSON mode with a response schema, then falls back to tolerant JSON extraction only if a model still wraps the payload in prose or code fences.

## Model Availability Strategy

### v1beta API Models (As of April 2026)

| Model                 | Type       | Best For                          | Tier      |
| --------------------- | ---------- | --------------------------------- | --------- |
| gemini-2.5-pro        | Advanced   | Consensus judging, complex code   | Free/Paid |
| gemini-2.5-flash      | Fast       | Primary reviewer                  | Free/Paid |
| gemini-2.5-flash-lite | Ultra-fast | Low-cost reviewer                 | Free/Paid |
| gemini-2.0-flash      | Fast       | Optional legacy fallback reviewer | Free/Paid |
| gemini-2.0-flash-lite | Ultra-fast | Optional cost fallback reviewer   | Free/Paid |

### Handling Model Changes

If a model becomes unavailable:

1. **Runtime validation** — Calls `models.list` and only uses models that support `generateContent`
2. **Alias remapping** — Legacy 3.x names are remapped to supported 2.x models where possible
3. **Graceful degradation** — Falls back to a stable reviewer/judge model before giving up
4. **Error logging** — Reports 404 (not found) or 429 (quota) explicitly

## Cost Analysis

### Per-Review Costs

| Scenario                      | Models Used           | Tokens/Review | Approx Cost |
| ----------------------------- | --------------------- | ------------- | ----------- |
| Consensus Round 1 (all agree) | 3 reviewers           | 15,000        | $0.002      |
| Judge Called (1 round)        | 3 reviewers + 1 judge | 20,000        | $0.005      |
| Max Rounds (3x)               | 9-12 calls            | 45,000        | $0.01       |

**vs Alternatives:**

- OpenAI GPT-4o: ~$0.01-0.02 per review
- Single Gemini model: ~$0.0005-0.001 per review
- **Gemini consensus: ~$0.002-0.005 per review**

## Retry Logic

```typescript
// Retry with exponential backoff
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    return await callGeminiAPI(model, prompt);
  } catch (error) {
    if (attempt < maxRetries) {
      const delayMs = retryDelayMs * Math.pow(2, attempt - 1);
      await delay(delayMs);
    } else {
      throw error;
    }
  }
}
```

**Configuration:**

- Max retries: 3
- Initial delay: 1000ms
- Exponential backoff: 1s -> 2s -> 4s

## Error Handling

### 404 Errors (Model Not Found)

```
Warning: Model not available: 'gemini-1.5-pro'
         Check Gemini API docs for available models in v1beta
```

-> Falls back to COMMENT decision

### 429 Errors (Rate Limited)

```
Warning: API Quota exceeded for model 'gemini-2.0-flash'
         Upgrade billing plan or use lighter models
```

-> Falls back to COMMENT decision

### 401 Errors (Invalid Key)

```
Error: Unauthorized: Check the configured LLM provider API key
```

-> Throws error (fails workflow step)

## Consequences

### Positive Impacts

- Free tier available for testing/small projects
- Flash models are genuinely fast
- JSON output works well with structured parsing
- v1beta API is stable
- Good cost/performance ratio

### Negative Impacts

- Gemini still newer than OpenAI (fewer real-world examples)
- Model names change frequently (v1beta versioning)
- Some advanced features not yet in v1beta
- Rate limits lower on free tier

## Alternatives Considered

### Alternative 1: OpenAI GPT-4o

- **Cost:** $0.01-0.02 per review (2-10x more)
- **Reason for rejection:** No free tier, higher cost
- **When useful:** If budget allows, GPT-4o might have better quality

### Alternative 2: Open Source (Llama, Mistral)

- **Pro:** Full control, self-hosted
- **Con:** Requires infrastructure, slower, complex deployment
- **Rejection:** Too much overhead for GitHub Action

### Alternative 3: Mixed Models

- **Pro:** Use best tool for each job
- **Con:** Complexity, different API integrations
- **Rejection:** Simpler to stick with one provider

## Testing

### Unit Tests

```bash
npm test -- llm-client.test.ts
```

### Integration Tests

```bash
# Test actual API calls (requires a provider-specific LLM API key)
GROQ_API_KEY=... npm test -- --integration
```

### Manual Testing

```bash
# Create a test PR to trigger the workflow
# Monitor logs with: npm run build && PRPILOT_DEBUG=true node dist/index.js
```

## Configuration Examples

### Default (Balanced)

```yaml
reviewer_models: "llama-3.1-8b-instant,openai/gpt-oss-20b,llama-3.3-70b-versatile"
judge_model: "openai/gpt-oss-120b"
```

### Maximum Speed

```yaml
reviewer_models: "llama-3.1-8b-instant,openai/gpt-oss-20b,openai/gpt-oss-20b"
judge_model: "openai/gpt-oss-120b"
```

### Quality Optimized

```yaml
reviewer_models: "llama-3.3-70b-versatile,openai/gpt-oss-120b,openai/gpt-oss-20b"
judge_model: "openai/gpt-oss-120b"
```

## Migration Path

If switching away from Gemini:

1. **Create new LLM client** inheriting from base interface
2. **Update prompts** for new model format
3. **Update action.yml** inputs
4. **Test thoroughly** before switching

---

**See also:**

- `src/llm/llm-client.ts` — Implementation
- `action.yml` — Configuration inputs
- [Gemini API Docs](https://ai.google.dev/gemini-api/)
