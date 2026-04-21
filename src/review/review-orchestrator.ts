/**
 * Review Orchestrator - Multi-model consensus coordination
 *
 * Responsibilities:
 * - Call all 3 reviewer models in parallel
 * - Evaluate if consensus is achieved
 * - Call judge model if needed
 * - Manage retry loop (max 3 rounds)
 * - Collect findings from all reviewers
 */

import { Logger } from "../utils/logger.js";
import { LLMClient } from "../llm/llm-client.js";
import {
  LLMContext,
  ReviewerOpinion,
  ConsensusRound,
  ReviewResult,
  ReviewDecision,
  CodeFinding,
} from "../utils/types.js";

interface OrchestratorOptions {
  reviewerModels: string[];
  judgeModel: string;
  maxConsensusRounds: number;
  debug?: boolean;
}

export class ReviewOrchestrator {
  private llmClient: LLMClient;
  private logger: Logger;
  private reviewerModels: string[];
  private judgeModel: string;
  private maxConsensusRounds: number;

  constructor(apiKey: string, options: OrchestratorOptions) {
    this.llmClient = new LLMClient(apiKey, { debug: options.debug });
    this.logger = new Logger(options.debug);
    this.reviewerModels = options.reviewerModels;
    this.judgeModel = options.judgeModel;
    this.maxConsensusRounds = options.maxConsensusRounds;

    if (this.reviewerModels.length !== 3) {
      throw new Error("Exactly 3 reviewer models are required");
    }
  }

  /**
   * Run the complete consensus review process
   *
   * Returns final consensus decision after up to maxConsensusRounds
   */
  async runConsensusReview(context: LLMContext): Promise<ReviewResult> {
    const startTime = Date.now();
    const allRounds: ConsensusRound[] = [];
    const allOpinions: ReviewerOpinion[] = [];

    this.logger.info("=".repeat(70));
    this.logger.info("🔄 Starting Multi-Model Consensus Review Process");
    this.logger.info("=".repeat(70));
    this.logger.info(`Reviewer Models: ${this.reviewerModels.join(", ")}`);
    this.logger.info(`Judge Model: ${this.judgeModel}`);
    this.logger.info(`Max Consensus Rounds: ${this.maxConsensusRounds}`);

    let consensusRound = 0;
    let finalDecision: ReviewDecision = "COMMENT";
    let finalReasoning = "";

    // Consensus loop
    for (let round = 1; round <= this.maxConsensusRounds; round++) {
      consensusRound = round;
      this.logger.section(`Consensus Round ${round}`);

      // Step 1: Call all 3 reviewers in parallel
      const opinions = await this.callAllReviewers(context, round);
      allOpinions.push(...opinions);

      // Step 2: Evaluate if consensus already achieved
      const consensusCheck = this.evaluateConsensus(opinions);

      if (consensusCheck.isConsensus) {
        this.logger.success(
          `✅ Consensus achieved! All reviewers agree on: ${consensusCheck.decision}`
        );
        finalDecision = consensusCheck.decision;
        finalReasoning = this.formatConsensusReasoning(
          opinions,
          consensusCheck.decision,
          round
        );

        const round_data: ConsensusRound = {
          roundNumber: round,
          opinions,
          isConsensus: true,
          judge: undefined,
          needsRetry: false,
        };
        allRounds.push(round_data);

        break; // Exit loop, consensus achieved
      }

      // Step 3: Opinions differ - call judge model
      this.logger.warn(
        `❌ No consensus yet. Reviewers differ:${opinions
          .map((o) => ` ${o.reviewerId}:${o.decision}`)
          .join(",")}`
      );

      const judgeDecision = await this.llmClient.callJudgeModel(
        this.judgeModel,
        opinions,
        context,
        round
      );

      this.logger.info(
        `Judge Decision: ${judgeDecision.decision} (confidence: ${(judgeDecision.confidence * 100).toFixed(0)}%)`
      );

      const round_data: ConsensusRound = {
        roundNumber: round,
        opinions,
        isConsensus: false,
        judge: judgeDecision,
        needsRetry: round < this.maxConsensusRounds,
      };
      allRounds.push(round_data);

      // If this is the last round or judge is confident, use judge's decision
      if (round === this.maxConsensusRounds || judgeDecision.confidence > 0.8) {
        finalDecision = judgeDecision.decision;
        finalReasoning = judgeDecision.reasoning;

        if (round === this.maxConsensusRounds) {
          this.logger.warn(
            `⚠️ Max consensus rounds reached. Using judge's final decision.`
          );
        } else {
          this.logger.success(
            `✅ Judge achieved high-confidence consensus in round ${round}`
          );
        }

        break;
      }

      this.logger.warn(
        `⏳ Low judge confidence (${(judgeDecision.confidence * 100).toFixed(0)}%). Requesting another review round...`
      );
    }

    // Step 4: Consolidate findings
    const inlineFindings = this.consolidateFindings(allOpinions);

    const executionTime = Date.now() - startTime;

    // Build result
    const result: ReviewResult = {
      finalDecision,
      consensusReasoning: finalReasoning,
      consensusRound,
      totalRounds: consensusRound,
      inlineFindings,
      summaryComment: this.buildSummaryComment(
        finalDecision,
        finalReasoning,
        inlineFindings,
        consensusRound
      ),
      allOpinions,
      timestamp: new Date().toISOString(),
    };

    this.logger.info("=".repeat(70));
    this.logger.success(
      `✅ Consensus Review Complete (${executionTime}ms, ${consensusRound} rounds)`
    );
    this.logger.info(
      `Final Decision: ${result.finalDecision} | Findings: ${inlineFindings.length}`
    );
    this.logger.info("=".repeat(70));

    return result;
  }

  /**
   * Call all 3 reviewer models in parallel
   */
  private async callAllReviewers(
    context: LLMContext,
    _round: number
  ): Promise<ReviewerOpinion[]> {
    this.logger.step(1, "Calling all 3 reviewer models in parallel");

    const reviewerCalls = this.reviewerModels.map((model, index) =>
      this.llmClient.callReviewerModel(model, context, `Reviewer_${index + 1}`)
    );

    try {
      const opinions = await Promise.all(reviewerCalls);

      for (const opinion of opinions) {
        this.logger.info(
          `  ${opinion.reviewerId} (${opinion.modelName}): ${opinion.decision}`
        );
      }

      return opinions;
    } catch (error) {
      this.logger.error(
        `Failed to call reviewers: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Evaluate if consensus is achieved
   *
   * Consensus = all 3 reviewers have the same decision
   */
  private evaluateConsensus(opinions: ReviewerOpinion[]): {
    isConsensus: boolean;
    decision: ReviewDecision;
  } {
    if (opinions.length !== 3) {
      return { isConsensus: false, decision: "COMMENT" };
    }

    const decisions = opinions.map((o) => o.decision);
    const uniqueDecisions = new Set(decisions);

    if (uniqueDecisions.size === 1) {
      // All reviewers agree
      return {
        isConsensus: true,
        decision: decisions[0],
      };
    }

    return { isConsensus: false, decision: "COMMENT" };
  }

  /**
   * Format reasoning when all reviewers agree
   */
  private formatConsensusReasoning(
    opinions: ReviewerOpinion[],
    decision: ReviewDecision,
    round: number
  ): string {
    const reasons = opinions.map((o) => `- ${o.reasoning}`).join("\n");

    return `All 3 reviewers unanimously agree on **${decision}** (Round ${round}):

${reasons}`;
  }

  /**
   * Consolidate findings from all reviewers
   *
   * Merge overlapping findings from different reviewers
   */
  private consolidateFindings(opinions: ReviewerOpinion[]): CodeFinding[] {
    const findingsMap = new Map<string, CodeFinding>();

    for (const opinion of opinions) {
      for (const finding of opinion.findings) {
        const key = `${finding.file}:${finding.lineStart}`;

        if (findingsMap.has(key)) {
          // Enhance existing finding with additional context
          const existing = findingsMap.get(key)!;
          // Upgrade severity if any reviewer found critical
          if (finding.severity === "critical") {
            existing.severity = "critical";
          }
          // Append suggestions if not already present
          if (finding.suggestion && !existing.suggestion) {
            existing.suggestion = finding.suggestion;
          }
        } else {
          findingsMap.set(key, { ...finding });
        }
      }
    }

    // Convert to array and sort by file, then line
    return Array.from(findingsMap.values()).sort((a, b) => {
      if (a.file !== b.file) {
        return a.file.localeCompare(b.file);
      }
      return a.lineStart - b.lineStart;
    });
  }

  /**
   * Build summary comment for PR
   */
  private buildSummaryComment(
    decision: ReviewDecision,
    reasoning: string,
    findings: CodeFinding[],
    roundNumber: number
  ): string {
    const decisionEmoji = this.getDecisionEmoji(decision);
    const decisionText = this.formatDecision(decision);

    let comment = `## ${decisionEmoji} Multi-Model Consensus Review: ${decisionText}\n\n`;

    comment += `### Consensus Process\n`;
    comment += `- Consensus achieved in **Round ${roundNumber}**\n`;
    comment += `- Models reviewed: 3 independent reviewers + 1 judge\n`;
    comment += `- Code findings: ${findings.length} issue(s)\n\n`;

    comment += `### Judge Reasoning\n${reasoning}\n\n`;

    if (findings.length > 0) {
      comment += `### Code Issues Found\n`;
      const bySeverity = this.groupBySeverity(findings);

      if (bySeverity.critical.length > 0) {
        comment += `\n🔴 **Critical Issues** (${bySeverity.critical.length})\n`;
        for (const finding of bySeverity.critical) {
          comment += this.formatFinding(finding);
        }
      }

      if (bySeverity.warning.length > 0) {
        comment += `\n🟡 **Warnings** (${bySeverity.warning.length})\n`;
        for (const finding of bySeverity.warning) {
          comment += this.formatFinding(finding);
        }
      }

      if (bySeverity.info.length > 0) {
        comment += `\n🔵 **Info** (${bySeverity.info.length})\n`;
        for (const finding of bySeverity.info) {
          comment += this.formatFinding(finding);
        }
      }
    } else {
      comment += `### ✅ No Issues Found\n`;
      comment += `All reviewers agree this code looks good!\n`;
    }

    comment += `\n---\n`;
    comment += `*Reviewed by PR Pilot Review - AI-powered Multi-Model Consensus Review System*\n`;

    return comment;
  }

  /**
   * Group findings by severity
   */
  private groupBySeverity(
    findings: CodeFinding[]
  ): Record<"critical" | "warning" | "info", CodeFinding[]> {
    return {
      critical: findings.filter((f) => f.severity === "critical"),
      warning: findings.filter((f) => f.severity === "warning"),
      info: findings.filter((f) => f.severity === "info"),
    };
  }

  /**
   * Format a single finding for display
   */
  private formatFinding(finding: CodeFinding): string {
    const lineInfo =
      finding.lineEnd && finding.lineEnd !== finding.lineStart
        ? `Lines ${finding.lineStart}-${finding.lineEnd}`
        : `Line ${finding.lineStart}`;

    let text = `- **${finding.file}** (${lineInfo}): ${finding.message}\n`;
    if (finding.suggestion) {
      text += `  > 💡 Suggestion: ${finding.suggestion}\n`;
    }
    return text;
  }

  /**
   * Get emoji for decision
   */
  private getDecisionEmoji(decision: ReviewDecision): string {
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
  private formatDecision(decision: ReviewDecision): string {
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
}
