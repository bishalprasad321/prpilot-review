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
    const decisionEmoji = this.getDecisionEmoji(result.finalDecision);
    const decisionText = this.formatDecision(result.finalDecision);

    let comment = `## ${decisionEmoji} PR Review - ${decisionText}\n\n`;

    comment += `**Consensus reached in round ${result.consensusRound} of ${result.totalRounds}**\n\n`;

    comment += `### Judge Reasoning\n${result.consensusReasoning}\n\n`;

    if (result.inlineFindings.length > 0) {
      comment += `### Code Findings\n`;
      comment += this.formatFindings(result.inlineFindings);
      comment += "\n";
    }

    comment += `---\n`;
    comment += `*Reviewed by PR Pilot Review - Multi-Model Consensus AI Review*\n`;
    comment += `📅 ${new Date(result.timestamp).toLocaleString()}\n`;

    return comment;
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

    // Sort findings within each file by line number
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
   * Get emoji for decision
   */
  private getDecisionEmoji(
    decision: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
  ): string {
    switch (decision) {
      case "APPROVE":
        return "✅";
      case "REQUEST_CHANGES":
        return "❌";
      case "COMMENT":
        return "💬";
      default:
        return "❓";
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
        return "Changes Requested";
      case "COMMENT":
        return "Comment";
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
