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

interface GeminiModelsListResponse {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

interface LLMClientOptions {
  debug?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}

type ModelPurpose = "reviewer" | "judge";

class GeminiApiError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "GeminiApiError";
    this.statusCode = statusCode;
  }
}

const MODEL_ALIASES: Record<string, string> = {
  "gemini-3.0-flash": "gemini-2.5-flash",
  "gemini-3.1-pro": "gemini-2.5-pro",
  "gemini-2.0-flash-thinking": "gemini-2.5-pro",
  "gemini-2.0-flash-thinking-exp": "gemini-2.5-pro",
};

const REVIEWER_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-pro",
];

const JUDGE_FALLBACK_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
];

export class LLMClient {
  private apiKey: string;
  private logger: Logger;
  private maxRetries: number;
  private retryDelayMs: number;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
  private availableGenerateContentModels: Set<string> | null = null;
  private resolvedModelCache = new Map<string, string>();

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
    const resolvedModel = await this.resolveModelName(model, "reviewer");

    this.logger.debug(
      `Calling reviewer model '${resolvedModel}' (requested: '${model}', ID: ${reviewerId})...`
    );

    try {
      const response = await this.callGeminiAPI(
        resolvedModel,
        prompt,
        this.getReviewerResponseSchema()
      );
      const opinion = this.parseReviewerResponse(
        response,
        resolvedModel,
        reviewerId
      );

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
    const resolvedModel = await this.resolveModelName(model, "judge");

    this.logger.debug(
      `Calling judge model '${resolvedModel}' (requested: '${model}') for round ${roundNumber}...`
    );

    try {
      const response = await this.callGeminiAPI(
        resolvedModel,
        prompt,
        this.getJudgeResponseSchema()
      );
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
    responseSchema: Record<string, unknown>,
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
        responseMimeType: "application/json",
        responseJsonSchema: responseSchema,
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
        throw new GeminiApiError(
          response.status,
          `Gemini API error: ${response.status} - ${errorData.error?.message || "Unknown error"}`
        );
      }

      return (await response.json()) as GeminiResponse;
    } catch (error) {
      if (attempt < this.maxRetries && this.isRetryableError(error)) {
        this.logger.warn(
          `API call failed (attempt ${attempt}/${this.maxRetries}), retrying in ${this.retryDelayMs}ms...`
        );
        await this.delay(this.retryDelayMs);
        return this.callGeminiAPI(model, prompt, responseSchema, attempt + 1);
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

      const parsed = this.parseStructuredJson<{
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
      }>(text, "response");

      return {
        reviewerId,
        modelName,
        decision: this.normalizeDecision(parsed.decision),
        reasoning: parsed.reasoning || "No reasoning provided.",
        findings: this.normalizeFindings(parsed.findings || []),
        summary: parsed.summary || "No summary provided.",
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

      const parsed = this.parseStructuredJson<{
        decision: ReviewDecision;
        reasoning: string;
        confidence: number;
        needsRetry?: boolean;
        roundsNeeded: number;
      }>(text, "judge response");

      return {
        decision: this.normalizeDecision(parsed.decision),
        reasoning: parsed.reasoning || "No reasoning provided.",
        confidence: this.normalizeConfidence(parsed.confidence),
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
    const text =
      response.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") || "";
    return text.trim();
  }

  /**
   * Resolve a requested model against the current v1beta model list.
   *
   * This keeps legacy aliases working when users still pass stale model IDs.
   */
  private async resolveModelName(
    requestedModel: string,
    purpose: ModelPurpose
  ): Promise<string> {
    const normalizedRequestedModel = this.normalizeModelName(requestedModel);
    const cacheKey = `${purpose}:${normalizedRequestedModel}`;
    const cached = this.resolvedModelCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const aliasedModel =
      MODEL_ALIASES[normalizedRequestedModel] || normalizedRequestedModel;

    try {
      const availableModels = await this.getAvailableGenerateContentModels();

      if (availableModels.has(normalizedRequestedModel)) {
        this.resolvedModelCache.set(cacheKey, normalizedRequestedModel);
        return normalizedRequestedModel;
      }

      if (availableModels.has(aliasedModel)) {
        this.logger.warn(
          `Model '${normalizedRequestedModel}' is not available in v1beta. Using '${aliasedModel}' instead.`
        );
        this.resolvedModelCache.set(cacheKey, aliasedModel);
        return aliasedModel;
      }

      const fallbackCandidates =
        purpose === "judge" ? JUDGE_FALLBACK_MODELS : REVIEWER_FALLBACK_MODELS;
      const fallback = fallbackCandidates.find((candidate) =>
        availableModels.has(candidate)
      );

      if (fallback) {
        this.logger.warn(
          `Model '${normalizedRequestedModel}' is unavailable for generateContent. Falling back to '${fallback}'.`
        );
        this.resolvedModelCache.set(cacheKey, fallback);
        return fallback;
      }
    } catch (error) {
      this.logger.warn(
        `Could not fetch Gemini model list for validation: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    this.resolvedModelCache.set(cacheKey, aliasedModel);
    return aliasedModel;
  }

  /**
   * Fetch the current set of models that support generateContent in v1beta.
   */
  private async getAvailableGenerateContentModels(): Promise<Set<string>> {
    if (this.availableGenerateContentModels) {
      return this.availableGenerateContentModels;
    }

    const availableModels = new Set<string>();
    let pageToken: string | undefined;

    do {
      const url = new URL(this.baseUrl);
      url.searchParams.set("key", this.apiKey);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = (await response.json()) as GeminiModelsListResponse;
        throw new GeminiApiError(
          response.status,
          `Gemini model list error: ${response.status} - ${errorData.error?.message || "Unknown error"}`
        );
      }

      const data = (await response.json()) as GeminiModelsListResponse;

      for (const model of data.models || []) {
        const name = this.normalizeModelName(model.name || "");
        if (
          name &&
          model.supportedGenerationMethods?.includes("generateContent")
        ) {
          availableModels.add(name);
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    this.availableGenerateContentModels = availableModels;
    return availableModels;
  }

  /**
   * JSON schema for reviewer responses.
   */
  private getReviewerResponseSchema(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        decision: {
          type: "string",
          enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
        },
        reasoning: { type: "string" },
        summary: { type: "string" },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file: { type: "string" },
              lineStart: { type: "integer" },
              lineEnd: { type: ["integer", "null"] },
              severity: {
                type: "string",
                enum: ["critical", "warning", "info"],
              },
              message: { type: "string" },
              suggestion: { type: ["string", "null"] },
            },
            required: ["file", "lineStart", "severity", "message"],
          },
        },
      },
      required: ["decision", "reasoning", "summary", "findings"],
    };
  }

  /**
   * JSON schema for judge responses.
   */
  private getJudgeResponseSchema(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        decision: {
          type: "string",
          enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
        },
        reasoning: { type: "string" },
        confidence: { type: "number" },
        needsRetry: { type: "boolean" },
        roundsNeeded: { type: "integer" },
      },
      required: ["decision", "reasoning", "confidence", "roundsNeeded"],
    };
  }

  /**
   * Parse a JSON object from Gemini output.
   */
  private parseStructuredJson<T>(text: string, label: string): T {
    try {
      return JSON.parse(text) as T;
    } catch {
      const stripped = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      try {
        return JSON.parse(stripped) as T;
      } catch {
        const jsonMatch = stripped.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error(`Could not find JSON in ${label}`);
        }

        return JSON.parse(jsonMatch[0]) as T;
      }
    }
  }

  /**
   * Normalize model names so both `models/foo` and `foo` inputs work.
   */
  private normalizeModelName(modelName: string): string {
    return modelName.replace(/^models\//, "").trim();
  }

  /**
   * Normalize reviewer findings before they enter the rest of the pipeline.
   */
  private normalizeFindings(
    findings: Array<{
      file: string;
      lineStart: number;
      lineEnd?: number;
      severity: "critical" | "warning" | "info";
      message: string;
      suggestion?: string;
    }>
  ): ReviewerOpinion["findings"] {
    return findings
      .filter(
        (finding) =>
          Boolean(finding.file) &&
          Number.isFinite(finding.lineStart) &&
          finding.lineStart > 0 &&
          Boolean(finding.message)
      )
      .map((finding) => ({
        ...finding,
        file: finding.file.trim(),
        lineStart: Math.trunc(finding.lineStart),
        lineEnd:
          typeof finding.lineEnd === "number"
            ? Math.trunc(finding.lineEnd)
            : undefined,
        severity: finding.severity || "info",
        message: finding.message.trim(),
        suggestion: finding.suggestion?.trim() || undefined,
      }));
  }

  /**
   * Clamp judge confidence into the expected 0-1 range.
   */
  private normalizeConfidence(confidence: number): number {
    if (!Number.isFinite(confidence)) {
      return 0;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Ensure the parsed decision is a supported review state.
   */
  private normalizeDecision(decision: string): ReviewDecision {
    if (
      decision === "APPROVE" ||
      decision === "REQUEST_CHANGES" ||
      decision === "COMMENT"
    ) {
      return decision;
    }

    return "COMMENT";
  }

  /**
   * Retry only transient failures. 4xx model/config errors should fail fast.
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof GeminiApiError) {
      return error.statusCode === 429 || error.statusCode >= 500;
    }

    return true;
  }

  /**
   * Create a failed reviewer opinion
   */
  private createFailedReviewerOpinion(
    modelName: string,
    reviewerId: string,
    error: unknown
  ): ReviewerOpinion {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Log if this is a model availability or quota issue
    if (errorMsg.includes("404") || errorMsg.includes("not found")) {
      this.logger.error(
        `⚠️ Model not available: '${modelName}' - Check Gemini API documentation for available models in v1beta`
      );
    } else if (errorMsg.includes("429") || errorMsg.includes("quota")) {
      this.logger.error(
        `⚠️ API Quota exceeded for model '${modelName}' - Upgrade billing or wait for quota reset`
      );
    }

    return {
      reviewerId,
      modelName,
      decision: "COMMENT",
      reasoning: `Reviewer model '${modelName}' failed: ${errorMsg}. Fallback to COMMENT decision.`,
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
