/**
 * Formatter utility for converting review output to Markdown
 *
 * Handles:
 * - Format review findings as Markdown
 * - Format PR review comments
 * - Format inline code snippets
 */

import { ReviewResult, CodeFinding } from "./types.js";

export class Formatter {
  /**
   * Format review findings as a Markdown list
   */
  formatFindings(findings: CodeFinding[]): string {
    if (findings.length === 0) {
      return "No issues found.";
    }

    const grouped = this.groupFindingsByFile(findings);
    let markdown = "";

    for (const [file, fileFi] of Object.entries(grouped)) {
      markdown += `\n### 📄 ${file}\n`;

      for (const finding of fileFi) {
        const severity = this.formatSeverity(finding.severity);
        const lineInfo =
          finding.lineEnd && finding.lineEnd !== finding.lineStart
            ? `Lines ${finding.lineStart}-${finding.lineEnd}`
            : `Line ${finding.lineStart}`;

        markdown += `\n${severity} **${lineInfo}**: ${finding.message}`;

        if (finding.suggestion) {
          markdown += `\n> 💡 Suggestion: ${finding.suggestion}`;
        }

        markdown += "\n";
      }
    }

    return markdown;
  }

  /**
   * Format review result as PR comment
   */
  formatReviewComment(result: ReviewResult): string {
    const decisionText = this.formatDecision(result.finalDecision);
    const tokenCount = result.tokensUsed?.total ?? 0;
    const findingsText =
      result.inlineFindings.length === 0
        ? "No issues found."
        : result.inlineFindings.length === 1
          ? "1 issue found."
          : `${result.inlineFindings.length} issues found.`;

    return [
      `# Multi-Model Consensus Review: ${decisionText}`,
      `## Consensus Process`,
      `- Consensus Achieved: **Round ${result.consensusRound}**`,
      `- Models reviewed: Reviewers \`${result.reviewerModels.join(", ")}\` + Judge \`${result.judgeModel}\``,
      `- API Tokens Used: ${tokenCount}`,
      "",
      findingsText,
      "---",
      "*Reviewed by PR Pilot Review - AI-powered Multi-Model Consensus Review System*",
    ].join("\n");
  }

  /**
   * Group findings by file
   */
  private groupFindingsByFile(
    findings: CodeFinding[]
  ): Record<string, CodeFinding[]> {
    const grouped: Record<string, CodeFinding[]> = {};

    for (const finding of findings) {
      if (!grouped[finding.file]) {
        grouped[finding.file] = [];
      }
      grouped[finding.file].push(finding);
    }

    for (const file of Object.keys(grouped)) {
      grouped[file].sort((a, b) => a.lineStart - b.lineStart);
    }

    return grouped;
  }

  /**
   * Get emoji for severity level
   */
  private formatSeverity(severity: "critical" | "warning" | "info"): string {
    switch (severity) {
      case "critical":
        return "🔴 **CRITICAL**";
      case "warning":
        return "🟡 **WARNING**";
      case "info":
        return "🔵 **INFO**";
      default:
        return "ℹ️";
    }
  }

  /**
   * Format decision text
   */
  private formatDecision(
    decision: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
  ): string {
    switch (decision) {
      case "APPROVE":
        return "Approved";
      case "REQUEST_CHANGES":
        return "Request Changes";
      case "COMMENT":
        return "Comments on Improvement";
      default:
        return "Unknown";
    }
  }

  /**
   * Format code snippet with line numbers
   */
  formatCodeSnippet(
    code: string,
    startLine: number,
    context: number = 2
  ): string {
    const lines = code.split("\n");
    const start = Math.max(0, startLine - 1 - context);
    const end = Math.min(lines.length, startLine + context);

    let snippet = "```\n";
    for (let i = start; i < end; i++) {
      const lineNum = i + 1;
      const marker = lineNum === startLine ? "→ " : "  ";
      snippet += `${marker}${lineNum.toString().padStart(4, " ")}: ${lines[i]}\n`;
    }
    snippet += "```";

    return snippet;
  }
}
