/**
 * Inline Comment Builder - Map findings to specific code lines
 *
 * Responsibilities:
 * - Parse code findings and match them to file diffs
 * - Build line-specific comments for GitHub PR review
 * - Format comments with code context
 */

import { Logger } from "../utils/logger.js";
import { CodeFinding, FileChange, ReviewComment } from "../utils/types.js";

interface DiffLine {
  type: "add" | "remove" | "context";
  lineNumber: number;
  hunkId: number;
  content: string;
}

interface FileDiff {
  file: string;
  status: string;
  lines: DiffLine[];
}

export class InlineCommentBuilder {
  private logger: Logger;
  private fileDiffs: Map<string, FileDiff> = new Map();

  constructor(debug: boolean = false) {
    this.logger = new Logger(debug);
  }

  /**
   * Initialize with file changes
   *
   * Parse each file patch to build a commentable line map.
   */
  buildFromFiles(files: FileChange[]): void {
    this.logger.debug(
      `Building inline comment maps from ${files.length} files`
    );

    this.fileDiffs.clear();

    for (const file of files) {
      if (!file.patch) {
        continue;
      }

      const patchLines = this.parsePatch(file.patch);
      if (patchLines.length === 0) {
        continue;
      }

      this.fileDiffs.set(file.filename, {
        file: file.filename,
        status: file.status,
        lines: patchLines,
      });
    }

    this.logger.debug(
      `Indexed ${this.fileDiffs.size} files for inline comments`
    );
  }

  /**
   * Convert findings to GitHub PR review comments
   *
   * Returns array of ReviewComment objects ready to submit to GitHub
   */
  buildComments(findings: CodeFinding[]): ReviewComment[] {
    this.logger.debug(
      `Building inline comments from ${findings.length} findings`
    );

    const comments: ReviewComment[] = [];

    for (const finding of findings) {
      const fileDiff = this.fileDiffs.get(finding.file);

      if (!fileDiff) {
        this.logger.warn(
          `Could not find diff for file: ${finding.file}, skipping inline comment`
        );
        continue;
      }

      // Find the line in the diff that corresponds to this finding
      const diffLine = this.findLineInDiff(
        fileDiff.lines,
        finding.lineStart,
        finding.file
      );

      if (!diffLine) {
        this.logger.warn(
          `Could not find line ${finding.lineStart} in diff for ${finding.file}`
        );
        continue;
      }

      // Build comment body
      const body = this.buildCommentBody(finding);

      // Create review comment
      const comment: ReviewComment = {
        path: finding.file,
        line: diffLine.lineNumber,
        body,
      };

      comments.push(comment);
      this.logger.debug(
        `Added inline comment for ${finding.file}:${finding.lineStart}`
      );
    }

    this.logger.info(`Built ${comments.length} inline comments from findings`);
    return comments;
  }

  /**
   * Keep only findings that can be mapped to the current patch.
   */
  filterCommentableFindings(findings: CodeFinding[]): CodeFinding[] {
    return findings.filter((finding) => {
      const fileDiff = this.fileDiffs.get(finding.file);

      if (!fileDiff) {
        return false;
      }

      return Boolean(
        this.findLineInDiff(fileDiff.lines, finding.lineStart, finding.file)
      );
    });
  }

  /**
   * Build comment body from a finding
   */
  private buildCommentBody(finding: CodeFinding): string {
    const severityEmoji = this.getSeverityEmoji(finding.severity);
    const severityText = finding.severity.toUpperCase();

    let body = `${severityEmoji} **${severityText}**: ${finding.message}`;

    if (finding.suggestion) {
      body += `\n\n💡 **Suggestion**: ${finding.suggestion}`;
    }

    body += `\n\n_Found by PR Pilot Review_`;

    return body;
  }

  /**
   * Parse a single file patch into commentable lines.
   */
  private parsePatch(patch: string): DiffLine[] {
    const diffLines: DiffLine[] = [];
    const lines = patch.split("\n");
    let lineNumber = 0;
    let hunkId = 0;

    for (const line of lines) {
      if (line.startsWith("@@")) {
        const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
          lineNumber = parseInt(hunkMatch[1], 10) - 1;
          hunkId += 1;
        }
        continue;
      }

      if (line.startsWith("+")) {
        lineNumber += 1;
        diffLines.push({
          type: "add",
          lineNumber,
          hunkId,
          content: line.slice(1),
        });
        continue;
      }

      if (line.startsWith("-")) {
        diffLines.push({
          type: "remove",
          lineNumber,
          hunkId,
          content: line.slice(1),
        });
        continue;
      }

      if (!line.startsWith("\\")) {
        lineNumber += 1;
        diffLines.push({
          type: "context",
          lineNumber,
          hunkId,
          content: line.startsWith(" ") ? line.slice(1) : line,
        });
      }
    }

    return diffLines;
  }

  /**
   * Find the corresponding line in the diff
   *
   * GitHub PR review API requires the line number as it appears in the new version
   */
  private findLineInDiff(
    diffLines: DiffLine[],
    targetLine: number,
    file: string
  ): DiffLine | null {
    if (targetLine <= 0) {
      return null;
    }

    const exactAddedLine = diffLines.find(
      (line) => line.type === "add" && line.lineNumber === targetLine
    );
    if (exactAddedLine) {
      return exactAddedLine;
    }

    const matchingContextLine = diffLines.find(
      (line) => line.type === "context" && line.lineNumber === targetLine
    );

    if (matchingContextLine) {
      const sameHunkAddedLines = diffLines
        .filter(
          (line) =>
            line.type === "add" && line.hunkId === matchingContextLine.hunkId
        )
        .sort(
          (left, right) =>
            Math.abs(left.lineNumber - targetLine) -
            Math.abs(right.lineNumber - targetLine)
        );

      const nearestSameHunkAddedLine = sameHunkAddedLines[0];

      if (
        nearestSameHunkAddedLine &&
        Math.abs(nearestSameHunkAddedLine.lineNumber - targetLine) <= 5
      ) {
        this.logger.warn(
          `Line ${targetLine} in ${file} was unchanged in the patch. Using nearby added line ${nearestSameHunkAddedLine.lineNumber} instead.`
        );
        return nearestSameHunkAddedLine;
      }
    }

    this.logger.warn(
      `Line ${targetLine} in ${file} is not commentable in the current patch`
    );

    return null;
  }

  /**
   * Get emoji for severity
   */
  private getSeverityEmoji(severity: "critical" | "warning" | "info"): string {
    switch (severity) {
      case "critical":
        return "🔴";
      case "warning":
        return "🟡";
      case "info":
        return "🔵";
      default:
        return "ℹ️";
    }
  }

  /**
   * Clear cached diffs
   */
  clear(): void {
    this.fileDiffs.clear();
  }
}
