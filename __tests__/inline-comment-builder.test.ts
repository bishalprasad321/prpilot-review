import { InlineCommentBuilder } from "../src/review/inline-comment-builder";
import { CodeFinding, FileChange } from "../src/utils/types";

describe("InlineCommentBuilder", () => {
  it("maps findings to added lines from the file patch", () => {
    const builder = new InlineCommentBuilder();
    const files: FileChange[] = [
      {
        filename: "src/example.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        changes: 3,
        patch: [
          "@@ -8,3 +8,4 @@ export function demo() {",
          "   const a = 1;",
          "-  return a;",
          "+  const b = a + 1;",
          "+  return b;",
          " }",
        ].join("\n"),
      },
    ];

    const findings: CodeFinding[] = [
      {
        file: "src/example.ts",
        lineStart: 10,
        severity: "warning",
        message: "Line 10 should be reviewed.",
      },
    ];

    builder.buildFromFiles(files);
    const comments = builder.buildComments(findings);

    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      path: "src/example.ts",
      line: 10,
    });
  });

  it("skips findings that are outside commentable patch lines", () => {
    const builder = new InlineCommentBuilder();
    const files: FileChange[] = [
      {
        filename: "src/example.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: [
          "@@ -20,2 +20,2 @@ export function demo() {",
          "-  return oldValue;",
          "+  return newValue;",
        ].join("\n"),
      },
    ];

    const findings: CodeFinding[] = [
      {
        file: "src/example.ts",
        lineStart: 42,
        severity: "info",
        message: "This line is outside the patch.",
      },
    ];

    builder.buildFromFiles(files);
    const comments = builder.buildComments(findings);
    expect(comments).toHaveLength(0);
  });
});
