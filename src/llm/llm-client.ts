/**
 * LLM Client - Multi-model Gemini API abstraction
 *
 * Responsibilities:
 * - Call Gemini API for different models (reviewers & judge)
 * - Build appropriate prompts for reviewer vs. judge roles
 * - Handle API calls with retries
 * - Parse and validate responses
 */

import fetch from "node-fetch";
import { Logger } from "../utils/logger.js";
import {
  LLMContext,
  ReviewerOpinion,
  ConsensusDecision,
  ReviewDecision,
} from "../utils/types.js";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
    finishMessage?: string;
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface LLMClientOptions {
  debug?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class LLMClient {
  private apiKey: string;
  private logger: Logger;
  private maxRetries: number;
  private retryDelayMs: number;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

  constructor(apiKey: string, options: LLMClientOptions = {}) {
    this.apiKey = apiKey;
    this.logger = new Logger(options.debug);
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;
  }

  /**
   * Call a reviewer model independently
   *
   * Returns a ReviewerOpinion with the model's decision and findings
   */
  async callReviewerModel(
    model: string,
    context: LLMContext,
    reviewerId: string
  ): Promise<ReviewerOpinion> {
    const prompt = this.buildReviewerPrompt(context);

    this.logger.debug(
      `Calling reviewer model '${model}' (ID: ${reviewerId})...`
    );

    try {
      const response = await this.callGeminiAPI(model, prompt);
      const opinion = this.parseReviewerResponse(response, model, reviewerId);

      this.logger.debug(
        `Reviewer '${reviewerId}' decision: ${opinion.decision}`
      );
      return opinion;
    } catch (error) {
      this.logger.error(
        `Failed to call reviewer model '${model}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );

      // Return a default opinion if API call fails
      return this.createFailedReviewerOpinion(model, reviewerId, error);
    }
  }

  /**
   * Call the judge model to reconcile reviewer opinions
   *
   * Returns a consensus decision based on reviewer opinions
   */
  async callJudgeModel(
    model: string,
    opinions: ReviewerOpinion[],
    context: LLMContext,
    roundNumber: number
  ): Promise<ConsensusDecision> {
    const prompt = this.buildJudgePrompt(opinions, context, roundNumber);

    this.logger.debug(
      `Calling judge model '${model}' for round ${roundNumber}...`
    );

    try {
      const response = await this.callGeminiAPI(model, prompt);
      const decision = this.parseJudgeResponse(response, roundNumber);

      this.logger.debug(`Judge decision: ${decision.decision}`);
      return decision;
    } catch (error) {
      this.logger.error(
        `Failed to call judge model '${model}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );

      // Return a default consensus decision
      return this.createFailedJudgeDecision(error, roundNumber);
    }
  }

  /**
   * Build prompt for reviewer model
   */
  private buildReviewerPrompt(context: LLMContext): string {
    const filesInfo = context.files
      .map(
        (f) => `- ${f.filename} (${f.status}): +${f.additions}/-${f.deletions}`
      )
      .join("\n");

    const diffPreview = context.chunks
      .slice(0, 3)
      .map(
        (c) =>
          `\n\`\`\`${c.language || "diff"}\n${c.content.slice(0, 500)}\n...\n\`\`\``
      )
      .join("\n");

    return `You are an expert code reviewer. Analyze this pull request and provide your review opinion.

**PR Title:** ${context.prTitle}

**PR Description:** ${context.prDescription || "No description provided"}

**Changed Files:**
${filesInfo}

**Code Changes:**
${diffPreview}

Please provide your review in the following JSON format:
{
  "decision": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "reasoning": "Your reasoning for this decision",
  "summary": "Brief summary of the PR",
  "findings": [
    {
      "file": "path/to/file",
      "lineStart": 10,
      "lineEnd": 12,
      "severity": "critical" | "warning" | "info",
      "message": "What's wrong",
      "suggestion": "How to fix it"
    }
  ]
}

Be thorough but concise. Focus on:
1. Code quality and best practices
2. Potential bugs or issues
3. Performance concerns
4. Security implications
5. Testing coverage`;
  }

  /**
   * Build prompt for judge model
   */
  private buildJudgePrompt(
    opinions: ReviewerOpinion[],
    context: LLMContext,
    roundNumber: number
  ): string {
    const opinionsText = opinions
      .map(
        (op, i) =>
          `Reviewer ${i + 1} (${op.modelName}):
- Decision: ${op.decision}
- Reasoning: ${op.reasoning}
- Findings: ${op.findings.length} issue(s) found`
      )
      .join("\n\n");

    return `You are a senior code review judge. You must reconcile different reviewer opinions and reach a consensus decision.

**PR Title:** ${context.prTitle}

**Consensus Round:** ${roundNumber}

**Reviewer Opinions:**
${opinionsText}

Your task:
1. Analyze each reviewer's opinion
2. Identify areas of agreement and disagreement
3. Make a final consensus decision considering all perspectives
4. If opinions strongly differ, you may request another round of reviews OR make a final judgment call

Respond in JSON format:
{
  "decision": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "reasoning": "Your reasoning synthesizing all opinions",
  "confidence": 0.95,
  "needsRetry": false,
  "roundsNeeded": ${roundNumber}
}

Guidelines:
- If 2+ reviewers agree, typically that's consensus
- If all 3 disagree, use your judgment to find the best path forward
- confidence: how confident you are (0-1)
- needsRetry: true only if you think another round would help (max 3 rounds)`;
  }

  /**
   * Call Gemini API with retry logic
   */
  private async callGeminiAPI(
    model: string,
    prompt: string,
    attempt: number = 1
  ): Promise<GeminiResponse> {
    const url = `${this.baseUrl}/${model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as GeminiResponse;
        throw new Error(
          `Gemini API error: ${response.status} - ${errorData.error?.message || "Unknown error"}`
        );
      }

      return (await response.json()) as GeminiResponse;
    } catch (error) {
      if (attempt < this.maxRetries) {
        this.logger.warn(
          `API call failed (attempt ${attempt}/${this.maxRetries}), retrying in ${this.retryDelayMs}ms...`
        );
        await this.delay(this.retryDelayMs);
        return this.callGeminiAPI(model, prompt, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Parse reviewer model response
   */
  private parseReviewerResponse(
    response: GeminiResponse,
    modelName: string,
    reviewerId: string
  ): ReviewerOpinion {
    try {
      const text = this.extractResponseText(response);
      if (!text) {
        throw new Error("Empty response from model");
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not find JSON in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        decision: ReviewDecision;
        reasoning: string;
        summary: string;
        findings?: Array<{
          file: string;
          lineStart: number;
          lineEnd?: number;
          severity: "critical" | "warning" | "info";
          message: string;
          suggestion?: string;
        }>;
      };

      return {
        reviewerId,
        modelName,
        decision: parsed.decision,
        reasoning: parsed.reasoning,
        findings: parsed.findings || [],
        summary: parsed.summary,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to parse reviewer response: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Parse judge model response
   */
  private parseJudgeResponse(
    response: GeminiResponse,
    roundNumber: number
  ): ConsensusDecision {
    try {
      const text = this.extractResponseText(response);
      if (!text) {
        throw new Error("Empty response from judge model");
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not find JSON in judge response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        decision: ReviewDecision;
        reasoning: string;
        confidence: number;
        needsRetry?: boolean;
        roundsNeeded: number;
      };

      return {
        decision: parsed.decision,
        reasoning: parsed.reasoning,
        confidence: parsed.confidence,
        roundsNeeded: parsed.roundsNeeded || roundNumber,
        forcedAfterMaxRounds: false,
      };
    } catch (error) {
      this.logger.error(
        `Failed to parse judge response: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Extract text from Gemini response
   */
  private extractResponseText(response: GeminiResponse): string {
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return text.trim();
  }

  /**
   * Create a failed reviewer opinion
   */
  private createFailedReviewerOpinion(
    modelName: string,
    reviewerId: string,
    error: unknown
  ): ReviewerOpinion {
    return {
      reviewerId,
      modelName,
      decision: "COMMENT",
      reasoning: `Reviewer model failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      findings: [],
      summary: "Review could not be completed due to API error",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a failed judge decision
   */
  private createFailedJudgeDecision(
    error: unknown,
    roundNumber: number
  ): ConsensusDecision {
    return {
      decision: "COMMENT",
      reasoning: `Judge model failed: ${
        error instanceof Error ? error.message : String(error)
      }. Using fallback consensus.`,
      confidence: 0,
      roundsNeeded: roundNumber,
      forcedAfterMaxRounds: true,
    };
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
