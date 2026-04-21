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
   * Initialize with file changes and diff content
   *
   * Parse the diff to build a line number map for each file
   */
  buildFromDiff(files: FileChange[], diffContent: string): void {
    this.logger.debug(
      `Building inline comment maps from ${files.length} files`
    );

    const diffSections = this.parseDiffSections(diffContent);

    for (const file of files) {
      const section = diffSections.find((s) => s.file === file.filename);
      if (section) {
        this.fileDiffs.set(file.filename, {
          file: file.filename,
          status: file.status,
          lines: section.lines,
        });
      }
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
   * Parse diff content into sections by file
   */
  private parseDiffSections(
    diffContent: string
  ): Array<{ file: string; lines: DiffLine[] }> {
    const sections: Array<{ file: string; lines: DiffLine[] }> = [];

    const lines = diffContent.split("\n");
    let currentFile: string | null = null;
    let currentLines: DiffLine[] = [];
    let lineNumber = 0;

    for (const line of lines) {
      // Detect file header: "diff --git a/path b/path"
      if (line.startsWith("diff --git")) {
        if (currentFile) {
          sections.push({
            file: currentFile,
            lines: currentLines,
          });
        }

        const match = line.match(/b\/(.+)$/);
        currentFile = match ? match[1] : null;
        currentLines = [];
        lineNumber = 0;
        continue;
      }

      // Skip hunk headers and other metadata
      if (line.startsWith("@@")) {
        // Parse hunk header to get line numbers
        const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
          lineNumber = parseInt(hunkMatch[1], 10) - 1;
        }
        continue;
      }

      if (!currentFile) {
        continue;
      }

      // Process diff lines
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lineNumber++;
        currentLines.push({
          type: "add",
          lineNumber,
          content: line.slice(1),
        });
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentLines.push({
          type: "remove",
          lineNumber: lineNumber,
          content: line.slice(1),
        });
      } else if (!line.startsWith("\\")) {
        // Context line (not starting with +/-)
        if (line.length > 0) {
          lineNumber++;
          currentLines.push({
            type: "context",
            lineNumber,
            content: line,
          });
        }
      }
    }

    // Add the last section
    if (currentFile) {
      sections.push({
        file: currentFile,
        lines: currentLines,
      });
    }

    return sections;
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
    // Find lines that were added or are context (visible in new version)
    const visibleLines = diffLines.filter(
      (l) => l.type === "add" || l.type === "context"
    );

    // The targetLine is based on line numbers in the new version
    // Find the nth visible line that corresponds to this line number
    for (const diffLine of visibleLines) {
      if (diffLine.lineNumber === targetLine) {
        return diffLine;
      }
    }

    // If exact match not found, try to find the closest line
    let closestLine: DiffLine | null = null;
    let closestDistance = Infinity;

    for (const diffLine of visibleLines) {
      const distance = Math.abs(diffLine.lineNumber - targetLine);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestLine = diffLine;
      }
    }

    if (closestLine) {
      this.logger.warn(
        `Line ${targetLine} not found in diff for ${file}, using closest line ${closestLine.lineNumber}`
      );
      return closestLine;
    }

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
