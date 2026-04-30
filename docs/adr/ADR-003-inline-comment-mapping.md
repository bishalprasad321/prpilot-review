# ADR-003: Inline Comment Mapping & Line Accuracy

**Status:** Accepted  
**Affects:** Comment accuracy, user experience, debugging

## Context

When AI models identify issues in code, they report line numbers from the diff context. However, GitHub's API requires:

1. **Exact line numbers** in the unified diff format
2. **Mapping** between model-reported lines and actual diff positions
3. **Handling** of added vs removed vs context lines
4. **Support** for multi-line comments (lineStart/lineEnd)

This ADR documents how we solve the line mapping problem.

## Decision

**Use Unified Diff Format Parser** to build accurate line mappings:

1. Parse PR diff (unified format)
2. Build a line number map for each file
3. Track: added lines, removed lines, context lines
4. Map model findings to actual diff positions
5. Post GitHub review with precise line numbers

```
Model Finding: "src/app.ts, lines 42-45, unused variable"
             |
             Line Mapper
             |
GitHub Comment: "Posted on line 45 in unified diff"
                (actual position in diff, not in full file)
```

## How It Works

### Step 1: Parse Unified Diff

```diff
diff --git a/src/app.ts b/src/app.ts
@@ -40,10 +40,8 @@ export class App {

   // Line 40: Context
   private cache = {};
-  private debug = false;   // Line 42: REMOVED
-  private verbose = false; // Line 43: REMOVED
+  private debug = true;    // Line 42: ADDED

   constructor() {
     this.init();
   }
 }
```

### Step 2: Build Line Map

For each file, track:

```typescript
{
  file: "src/app.ts",
  baseLineNumber: 40,  // @@ -40,10 ...
  lines: [
    { type: "context", number: 40, content: " " },
    { type: "context", number: 41, content: " // Line 40: Context" },
    { type: "context", number: 42, content: " private cache = {};" },
    { type: "removed", number: 43, content: "-  private debug = false;" },
    { type: "removed", number: 44, content: "-  private verbose = false;" },
    { type: "added",   number: 42, content: "+  private debug = true;" },
    { type: "context", number: 45, content: " " },
    { type: "context", number: 46, content: "   constructor() {" },
    // ...
  ]
}
```

### Step 3: Map Model Findings

**Model says:** "Line 42-43, unused variable `verbose`"

**Lookup in map:**

1. File: `src/app.ts` (Found)
2. Lines 42-43 in the diff
3. Found: REMOVED lines (old code being removed)
4. **GitHub doesn't support comments on removed lines**
5. **Fallback:** Use line 44 (next line) or post as general comment

### Step 4: Create GitHub Comment

```typescript
{
  path: "src/app.ts",
  line: 44,  // Position in diff
  side: "LEFT",  // or "RIGHT" for added lines
  body: "Warning: Unused variable `verbose` — consider removing",
  commit_id: "abc123...",
}
```

## Key Challenges

### Challenge 1: Removed vs Added Lines

**Problem:** GitHub API only comments on added lines (side: "RIGHT")

**Solution:**

- Skip comments on removed lines (already being removed)
- Post general comment for removed line issues

### Challenge 2: Multi-line Comments

**Problem:** GitHub requires separate comments for each line

**Solution:**

- Combine multi-line findings into single comment
- Report range: "lines 42-45"

### Challenge 3: Line Number Mismatches

**Problem:** Model might report wrong line numbers

**Solution:**

- Tolerance band (+/- 5 lines) to find intended line
- Fall back to general comment if no match found

### Challenge 4: Diff Size

**Problem:** Large diffs slow to parse

**Solution:**

- Cache parsed diffs
- Incremental processing for very large diffs

## Implementation Details

### File: `src/review/inline-comment-builder.ts`

```typescript
async buildComments(
  findings: CodeFinding[],
  files: FileChange[],
  diffContent: string
): Promise<ReviewComment[]> {
  // 1. Parse diff into line maps
  const diffMaps = this.buildDiffMaps(files, diffContent);

  // 2. For each finding, map to actual diff line
  const comments: ReviewComment[] = [];
  for (const finding of findings) {
    const comment = this.mapFindingToComment(finding, diffMaps);
    if (comment) {
      comments.push(comment);
    }
  }

  return comments;
}
```

### Unified Diff Format

```
diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -startLine,lineCount +startLine,lineCount @@ context
 context line
 context line
-removed line
+added line
 context line
```

**Parsing Logic:**

1. Split by `diff --git` lines to separate files
2. For each file, find `@@` lines (hunk headers)
3. Parse hunk to build line map
4. Track file positions and content

## Line Type Classification

```typescript
type LineType = "context" | "added" | "removed";

// Line starts with:
//   " " -> context line (unchanged)
//   "-" -> removed line (old code)
//   "+" -> added line (new code)
```

## GitHub API Constraints

### Can Comment On:

- Added lines (side: "RIGHT")
- Multiple lines in same file
- Multiple files

### Cannot Comment On:

- Removed lines (would comment on deleted code)
- Context lines outside hunk
- File sections not in diff

### Handling:

- Comments on removed lines -> Post general PR comment instead
- Comments on context -> Map to nearest added line or skip

## Consequences

### Positive Impacts

- Accurate line mapping ensures right feedback on right code
- Comments appear at exact location where user writes code
- Supports complex diffs with multiple files
- Handles edge cases gracefully

### Negative Impacts

- Cannot comment on removed lines (GitHub limitation)
- Performance impact for very large diffs
- Complex parsing logic requires maintenance
- Potential for line mapping errors

## Alternatives Considered

### Alternative 1: Only General Comments

**Approach:** Post all findings as PR-level comment (no inline)

- **Pro:** Simple, always works
- **Con:** Less specific feedback, harder to read
- **Rejected:** Inline comments are much better UX

### Alternative 2: Use GitHub REST API Suggestions

**Approach:** Use `/suggest` endpoint for auto-fix suggestions

- **Pro:** One-click fix application
- **Con:** Limited to small code changes
- **Rejected:** Most findings need manual review

### Alternative 3: Post on Line 1 of File

**Approach:** Group all file findings on line 1

- **Pro:** Simpler parsing
- **Con:** Comments far from actual issues
- **Rejected:** Defeats purpose of inline comments

## Testing

### Unit Tests

```bash
npm test -- inline-comment-builder.test.ts
```

**Test Cases:**

- Parse simple diff with added/removed lines
- Map findings to correct line numbers
- Handle multi-line hunks
- Skip comments on removed lines
- Handle missing files in diff
- Tolerance band for line number mismatch

### Test Fixtures

```typescript
const diff = `
diff --git a/test.ts b/test.ts
@@ -10,5 +10,6 @@
  const x = 1;
  const y = 2;
- const debug = false;
+ const debug = true;
  return x + y;
`;

const finding: CodeFinding = {
  file: "test.ts",
  lineStart: 13, // In diff
  lineEnd: 13,
  message: "Debug flag enabled",
};

// Should map to line 13 in diff (the +const debug line)
```

## Future Improvements

1. **Suggestion Mode** — Auto-generate fix suggestions using GitHub API
2. **Multi-File Context** — Link related comments across files
3. **Conversation Mode** — Ask model to clarify findings
4. **Performance** — Stream large diff processing
5. **Visualization** — Better formatting for complex issues

## Migration Path

If changing comment strategy:

1. Update `inline-comment-builder.ts`
2. Adjust GitHub API calls in `github-client.ts`
3. Update tests to match new behavior

---

**See also:**

- `src/review/inline-comment-builder.ts` — Implementation
- `src/github/github-client.ts` — GitHub API integration
- [GitHub REST API Docs](https://docs.github.com/en/rest/pulls/reviews)
