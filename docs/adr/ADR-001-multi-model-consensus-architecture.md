# ADR-001: Multi-Model Consensus Architecture

**Status:** Accepted  
**Affects:** Core review logic, system reliability

## Context

When building an AI-powered PR reviewer, there are two main approaches:

1. **Single Model** — Query one AI model for review decisions
   - Pros: Fast, simple, low cost
   - Cons: Single point of failure, model bias, inconsistent quality

2. **Multi-Model Consensus** — Query multiple models and reach consensus
   - Pros: More thorough, balanced decisions, reliability
   - Cons: Slower, higher cost, complex logic

The team needed to decide which approach to take for production reliability and code quality.

## Decision

We chose **Multi-Model Consensus with 3 reviewers + 1 judge** architecture:

```
Parallel Reviewers (3 models)     Judge Model (1 model)
         |                                 |
    reviewer-1                         Judge (if needed)
    reviewer-2                         Makes final decision
    reviewer-3
         |
    Check Consensus
    (2+ agree? -> DONE)
    (all differ? -> JUDGE)
```

### Architecture Details

**Phase 1: Parallel Reviews**

- All 3 reviewers query simultaneously (parallel execution)
- Each independently analyzes the PR
- Returns decision + findings

**Phase 2: Consensus Evaluation**

- If 2 or 3 reviewers agree -> Use that decision (DONE)
- If all 3 disagree -> Call judge model for tie-breaking

**Phase 3: Judge Decision (Optional)**

- Judge model sees all 3 opinions
- Makes final decision considering all perspectives
- Used only when needed (cost optimization)

**Phase 4: Findings Consolidation**

- Merge duplicate findings from reviewers
- Keep highest severity level per issue
- Build inline comments

## Rationale

### Why 3 Reviewers?

- **Balance** — Odd number allows majority voting
- **Cost** — 3 models cheaper than 4+
- **Diversity** — Enough variety for balanced perspective
- **Speed** — Parallel execution keeps latency low

### Why Judge Model?

- **Quality** — Most capable model only used when needed
- **Cost** — Saves expensive model calls (used ~10-20% of time)
- **Tie-breaking** — Excellent reasoning for disagreements
- **Fallback** — Ensures a decision even in edge cases

### Why Parallel?

- **Speed** — 3 parallel calls faster than 3 sequential
- **Scalability** — Can add more reviewers without much latency increase
- **UX** — User gets feedback quickly (2-3 seconds vs 8-10)

## Consequences

### Positive Impacts

- **Reliability** — Consensus reduces single-point failures
- **Quality** — More thorough review with multiple perspectives
- **Consistency** — Less biased by individual model limitations
- **Explainability** — Can explain why consensus was reached
- **Graceful Degradation** — If one model fails, others continue
- **Production Ready** — More robust for mission-critical code reviews

### Negative Impacts

- **Cost** — ~3-4x more expensive than single model
- **Complexity** — More code to maintain (consensus logic)
- **Latency** — Slightly slower than single model
- **Token Usage** — Higher API quota consumption
- **Rate Limits** — More likely to hit API rate limits

## Alternatives Considered

### Alternative 1: Single Model

```
PR -> Model -> Decision
```

- **Pro:** Fast, cheap, simple
- **Con:** Single point of failure, model bias
- **Rejected:** Insufficient reliability for production

### Alternative 2: Sequential Multiple Models

```
PR -> Model-1 -> Decision?
     | (if no consensus)
     Model-2 -> Decision?
     | (if no consensus)
     Model-3 -> Decision
```

- **Pro:** Cheaper if consensus early
- **Con:** Slower latency, inconsistent timing
- **Rejected:** Parallel is faster

### Alternative 3: Weighted Voting

```
Reviewer-1: 40% weight
Reviewer-2: 30% weight
Reviewer-3: 30% weight
```

- **Pro:** Flexibility in model importance
- **Con:** Complex thresholds, harder to explain
- **Rejected:** Simple majority is clearer

## Implementation

### ReviewOrchestrator

- Runs all 3 reviewers in parallel via `Promise.all()`
- Evaluates consensus with simple majority (2+)
- Calls judge if no consensus
- Consolidates findings

### Retry Logic

- Up to 3 consensus rounds supported
- Each round queries all reviewers again
- Rare in practice (>95% consensus in Round 1)

### Error Handling

- Reviewer failures don't block consensus
- Fallback to default COMMENT if all fail
- Logs all failures for debugging

## Testing

```bash
# Test consensus logic
npm test -- review-orchestrator.test.ts

# Test with debug enabled
PRPILOT_DEBUG=true npm test
```

### Test Cases

- All 3 agree -> Use agreement
- 2 agree, 1 differs -> Use agreement
- All 3 differ -> Call judge
- One reviewer fails -> Continue with 2
- Two reviewers fail -> Use last one
- All three fail -> Return default

## Migration Path

If this decision needs revision:

1. **To Single Model** — Remove judge, use reviewer-1 only
2. **To Different Numbers** — Update ReviewOrchestrator to query N reviewers
3. **To Sequential** — Replace Promise.all() with await/if logic

## Related Decisions

- **ADR-002** — Which models to use as reviewers vs judge
- **ADR-004** — State management ensures idempotency with consensus

---

**See also:**

- `src/review/review-orchestrator.ts` — Implementation
- `src/llm/llm-client.ts` — LLM abstraction
- `docs/adr/ADR-002-api-api-integration.md` — Model selection
