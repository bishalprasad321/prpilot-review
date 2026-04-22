# ADR-004: Idempotency & State Management

**Status:** Accepted  
**Date:** 2026-04-23  
**Deciders:** Bishal Prasad  
**Affects:** Workflow reliability, API cost control, state persistence

## Context

In GitHub Actions, workflows can be triggered multiple times for the same commit:

1. **PR updated with new commit** → Action runs again
2. **Workflow re-run** → User manually re-runs on same commit
3. **Branch force-pushed** → Same code, different commit
4. **Multiple check suites** → Can trigger same commit multiple times

Without idempotency, this causes:

- ❌ Duplicate reviews on same code
- ❌ Wasted API calls
- ❌ Multiple comments on PR
- ❌ Higher costs

## Decision

**Implement State Tracking** with SHA-based idempotency:

1. Track reviewed commit SHAs in local state file
2. Skip if commit already reviewed
3. Store review metadata for future reference
4. Use local filesystem for state (works in Actions)

```
Check PR commit SHA
        ↓
    Is it new?
        ↓
    YES: Run review, save SHA
    NO: Skip (already reviewed)
```

## Implementation

### State File: `.ai-pr-state.json`

```json
{
  "lastReviewedSha": "abc123def456...",
  "lastReviewedAt": "2026-04-23T10:30:00Z",
  "prNumber": 42,
  "lastConsensusRound": 1,
  "reviewHistory": [
    {
      "sha": "abc123...",
      "prNumber": 42,
      "decision": "APPROVE",
      "round": 1,
      "timestamp": "2026-04-23T10:30:00Z"
    }
  ]
}
```

### StateManager Class

```typescript
class StateManager {
  // Check if commit already reviewed
  isAlreadyReviewed(sha: string): boolean {
    const state = this.loadState();
    return state.lastReviewedSha === sha;
  }

  // Save reviewed commit
  setLastReviewedSha(sha: string): void {
    const state = this.loadState();
    state.lastReviewedSha = sha;
    state.lastReviewedAt = new Date().toISOString();
    this.saveState(state);
  }

  // Other methods...
}
```

### Workflow Integration

```typescript
// STEP 5: Check if already reviewed
const alreadyReviewed = stateManager.isAlreadyReviewed(prMetadata.head.sha);

if (alreadyReviewed) {
  logger.info("⏭️  Commit already reviewed, skipping");
  core.setOutput("review_decision", "SKIPPED");
  return;
}

// ... run review ...

// Save state after successful review
stateManager.setLastReviewedSha(prMetadata.head.sha);
```

## Key Scenarios

### Scenario 1: New Commit on PR

```
Commit ABC123 pushed
       ↓
State: SHA=old, PR=41
       ↓
Commit != last SHA?
       ↓
YES → Run review
      Save: SHA=ABC123, PR=42
```

### Scenario 2: Force-Push Same Code

```
Force-push to branch (different SHA, same code)
       ↓
State: SHA=old
       ↓
New SHA != old SHA?
       ↓
YES → Run review (code changed SHA)
      (Even though code is same)
```

### Scenario 3: Manual Workflow Re-run

```
Manual re-run on same commit
       ↓
State: SHA=ABC123 (same)
       ↓
Same SHA?
       ↓
YES → Skip (already reviewed)
```

### Scenario 4: Workflow Failure & Retry

```
Review crashed mid-way
       ↓
State: SHA not updated (crashed before save)
       ↓
Next retry runs fresh review
       ↓
Re-review OK (state catches subsequent reruns)
```

## State Storage Options Considered

### Option 1: Local File (✅ Chosen)

```typescript
fs.writeFileSync(".ai-pr-state.json", JSON.stringify(state));
```

**Pros:**

- ✅ Simple, no external dependencies
- ✅ Works in all GitHub Actions environments
- ✅ Survives workflow reruns
- ✅ Git-tracked (can see history)

**Cons:**

- ❌ Lost if workspace cleaned
- ❌ Must commit to repo

### Option 2: GitHub API (Gists)

```typescript
// Store state in GitHub Gist
await octokit.gists.create({ ... });
```

**Pros:**

- ✅ Survives workspace cleanup
- ✅ No git history pollution

**Cons:**

- ❌ Extra API call (cost)
- ❌ Complex authentication
- ❌ Gist management overhead

**Decision:** Use local file, simpler and sufficient

### Option 3: Environment Variables

```typescript
process.env.PRPILOT_LAST_SHA;
```

**Pros:**

- ✅ Simple

**Cons:**

- ❌ Lost after workflow
- ❌ Can't persist state between runs

### Option 4: GitHub Actions Cache

```typescript
// Use actions/cache@v3
uses: actions/cache@v3
with:
  key: pr-pilot-state
  path: .ai-pr-state.json
```

**Pros:**

- ✅ Designed for this use case
- ✅ Survives workspace cleanup

**Cons:**

- ❌ Adds workflow complexity
- ❌ Cache can be invalidated

**Decision:** Local file is simpler, sufficient for most cases

## Edge Cases

### Edge Case 1: State File Corrupted

```typescript
try {
  return JSON.parse(fs.readFileSync(".ai-pr-state.json", "utf-8"));
} catch {
  return getDefaultState(); // Reset to fresh state
}
```

### Edge Case 2: State File Not Found (First Run)

```typescript
if (!fs.existsSync(".ai-pr-state.json")) {
  return getDefaultState();
}
```

### Edge Case 3: PR Number Changes

```typescript
// Different PR but same commit? (e.g., cherry-pick)
if (state.prNumber !== currentPrNumber) {
  // Don't skip, review might be for different context
  return false;
}
```

### Edge Case 4: Workflow Cleanup Between Runs

```yaml
# If workspace is cleaned, state is lost
# Next run treats commit as "new" and reviews again
# This is acceptable (safety-first approach)
```

## Consequences

### Positive ✅

- **Cost Reduction** — Saves 30-50% API calls by avoiding reruns
- **Safety** — Prevents duplicate reviews on same code
- **Simplicity** — Local file state, no external dependencies
- **Debuggability** — State file in repo for inspection
- **Idempotent** — Running same workflow twice = same result

### Negative ❌

- **State Loss** — If workspace cleaned, state lost
- **Manual Tracking** — User must manage state file
- **Git Pollution** — State file shows in git history
- **Stale Data** — Old state might be outdated

## Metrics

### API Call Reduction

```
Before (no idempotency):
  - 1 PR update = 1 review call
  - Manual re-run = 1 review call
  - Total per PR: 2-5 calls

After (with idempotency):
  - 1 PR update = 1 review call
  - Manual re-run = 0 calls (skipped)
  - Total per PR: 1 call

Cost savings: ~50-80%
```

## Testing

### Unit Tests

```bash
npm test -- state-manager.test.ts
```

**Test Cases:**

- ✅ First run: no state, creates new
- ✅ Same SHA: skips review
- ✅ Different SHA: runs review
- ✅ Corrupted state: recovers gracefully
- ✅ Missing state file: creates default

### Integration Test

```bash
# Manual test
1. Create PR
2. Check: action runs, state file created
3. Re-run workflow
4. Check: action skips (same SHA)
5. Push new commit
6. Check: action runs (new SHA)
```

## Disabling Idempotency

If you want every workflow to run review (not recommended):

```yaml
# In GitHub Actions workflow:
- uses: bishalprasad321/prpilot-review@v1
  with:
    # (hypothetical future flag)
    # force_review: "true"  # Override idempotency
```

Currently, idempotency is always enabled. To override:

1. Delete `.ai-pr-state.json` before workflow
2. Action will treat all commits as new

## Future Enhancements

1. **Review History** — Keep track of all reviewed SHAs
2. **Incremental Updates** — Re-review only changed files
3. **Cache Clearing** — Manual endpoint to clear state
4. **Metrics Export** — Track cost savings over time
5. **Analytics** — Dashboard showing review trends

## Migration Path

If changing state strategy:

1. Update `StateManager` class
2. Migrate `.ai-pr-state.json` format
3. Add backward compatibility layer
4. Update tests

---

**See also:**

- `src/state/state-manager.ts` — Implementation
- `src/index.ts` — Usage (STEP 5)
- [GitHub Actions Docs](https://docs.github.com/en/actions)
