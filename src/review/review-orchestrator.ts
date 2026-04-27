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
import { Formatter } from "../utils/formatter.js";
import {
  LLMContext,
  LLMProvider,
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
  provider?: LLMProvider;
  providerUrl?: string;
}

export class ReviewOrchestrator {
  private llmClient: LLMClient;
  private logger: Logger;
  private reviewerModels: string[];
  private judgeModel: string;
  private maxConsensusRounds: number;
  private formatter: Formatter;

  constructor(apiKey: string, options: OrchestratorOptions) {
    this.llmClient = new LLMClient(apiKey, {
      debug: options.debug,
      provider: options.provider,
      baseUrl: options.providerUrl,
    });
    this.logger = new Logger(options.debug);
    this.reviewerModels = options.reviewerModels;
    this.judgeModel = options.judgeModel;
    this.maxConsensusRounds = options.maxConsensusRounds;
    this.formatter = new Formatter();

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
          `✅ Consensus achieved! Majority decision: ${consensusCheck.decision}`
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
    finalDecision = this.normalizeReviewDecision(finalDecision, inlineFindings);

    const executionTime = Date.now() - startTime;

    // Collect token usage data
    const tokensUsed = this.llmClient.getTokensUsed();

    // Build result
    const result: ReviewResult = {
      finalDecision,
      consensusReasoning: finalReasoning,
      consensusRound,
      totalRounds: consensusRound,
      reviewerModels: [...this.reviewerModels],
      judgeModel: this.judgeModel,
      inlineFindings,
      summaryComment: this.formatter.formatReviewComment({
        finalDecision,
        consensusReasoning: finalReasoning,
        consensusRound,
        totalRounds: consensusRound,
        reviewerModels: [...this.reviewerModels],
        judgeModel: this.judgeModel,
        inlineFindings,
        summaryComment: "",
        allOpinions,
        timestamp: new Date().toISOString(),
        tokensUsed,
      }),
      allOpinions,
      timestamp: new Date().toISOString(),
      tokensUsed,
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
   * Consensus = a majority (2 of 3) reviewers agree on the same decision
   */
  private evaluateConsensus(opinions: ReviewerOpinion[]): {
    isConsensus: boolean;
    decision: ReviewDecision;
  } {
    if (opinions.length !== 3) {
      return { isConsensus: false, decision: "COMMENT" };
    }

    const decisionCounts = opinions.reduce<Record<ReviewDecision, number>>(
      (counts, opinion) => {
        counts[opinion.decision] += 1;
        return counts;
      },
      {
        APPROVE: 0,
        REQUEST_CHANGES: 0,
        COMMENT: 0,
      }
    );

    const majorityEntry = Object.entries(decisionCounts).find(
      ([, count]) => count >= 2
    );

    if (majorityEntry) {
      return {
        isConsensus: true,
        decision: majorityEntry[0] as ReviewDecision,
      };
    }

    return { isConsensus: false, decision: "COMMENT" };
  }

  /**
   * Format reasoning when a consensus is reached
   */
  private formatConsensusReasoning(
    opinions: ReviewerOpinion[],
    decision: ReviewDecision,
    round: number
  ): string {
    const reasons = opinions.map((o) => `- ${o.reasoning}`).join("\n");
    const agreeingReviewers = opinions.filter((o) => o.decision === decision);

    return `${agreeingReviewers.length} of 3 reviewers agreed on **${decision}** (Round ${round}):

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

  private normalizeReviewDecision(
    decision: ReviewDecision,
    findings: CodeFinding[]
  ): ReviewDecision {
    if (findings.length > 0) {
      return "REQUEST_CHANGES";
    }

    return decision;
  }
}
