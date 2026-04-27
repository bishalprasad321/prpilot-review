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
  LLMProvider,
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

interface GroqResponse {
  output?: Array<{
    id?: string;
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  choices?: Array<{
    text?: string;
    message?: {
      content?: string;
    };
  }>;
  data?: Array<Record<string, unknown>>;
  models?: Array<Record<string, unknown>>;
  error?: {
    code?: number | string;
    message?: string;
    type?: string;
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
  provider?: LLMProvider;
  baseUrl?: string;
  debug?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}

type LLMResponse = GeminiResponse | GroqResponse;

type ModelPurpose = "reviewer" | "judge";

class LLMApiError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "LLMApiError";
    this.statusCode = statusCode;
  }
}

const MODEL_ALIASES: Record<string, string> = {
  "gemini-3.0-flash": "gemini-2.5-flash",
  "gemini-3.1-pro": "gemini-2.5-pro",
  "gemini-2.0-flash-thinking": "gemini-2.5-pro",
  "gemini-2.0-flash-thinking-exp": "gemini-2.5-pro",
};

const FALLBACK_MODELS: Record<
  LLMProvider,
  { reviewer: string[]; judge: string[] }
> = {
  gemini: {
    reviewer: [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
    ],
    judge: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-2.5-flash-lite",
    ],
  },
  groq: {
    reviewer: ["groq-1.5-mini", "groq-1.5-small"],
    judge: ["groq-1.5-small", "groq-1.5-mini"],
  },
};

export class LLMClient {
  private apiKey: string;
  private provider: LLMProvider;
  private logger: Logger;
  private maxRetries: number;
  private retryDelayMs: number;
  private baseUrl: string;
  private availableGenerateContentModels: Set<string> | null = null;
  private resolvedModelCache = new Map<string, string>();
  private totalTokens = { prompt: 0, completion: 0, total: 0 };

  constructor(apiKey: string, options: LLMClientOptions = {}) {
    this.apiKey = apiKey;
    this.provider = options.provider || "gemini";
    this.logger = new Logger(options.debug);
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;
    this.baseUrl =
      options.baseUrl ||
      (this.provider === "groq"
        ? "https://api.groq.com/openai/v1"
        : "https://generativelanguage.googleapis.com/v1beta/models");
  }

  /**
   * Get total tokens used across all API calls in this session
   */
  getTokensUsed(): { prompt: number; completion: number; total: number } {
    return { ...this.totalTokens };
  }

  /**
   * Reset token counter (useful for new reviews)
   */
  resetTokenCounter(): void {
    this.totalTokens = { prompt: 0, completion: 0, total: 0 };
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
    let resolvedModel = await this.resolveModelName(model, "reviewer");

    this.logger.debug(
      `Calling reviewer model '${resolvedModel}' (requested: '${model}', ID: ${reviewerId})...`
    );

    try {
      let response: LLMResponse;

      try {
        response = await this.callModelAPI(
          resolvedModel,
          prompt,
          this.getReviewerResponseSchema()
        );
      } catch (error) {
        const backupModel = await this.resolveBackupModel("reviewer", [
          resolvedModel,
          model,
        ]);

        if (backupModel && this.isModelFailureError(error)) {
          this.logger.warn(
            `Reviewer model '${resolvedModel}' failed. Retrying once with backup model '${backupModel}'.`
          );
          resolvedModel = backupModel;
          response = await this.callModelAPI(
            resolvedModel,
            prompt,
            this.getReviewerResponseSchema()
          );
        } else {
          throw error;
        }
      }

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
    let resolvedModel = await this.resolveModelName(model, "judge");

    this.logger.debug(
      `Calling judge model '${resolvedModel}' (requested: '${model}') for round ${roundNumber}...`
    );

    try {
      let response: LLMResponse;

      try {
        response = await this.callModelAPI(
          resolvedModel,
          prompt,
          this.getJudgeResponseSchema()
        );
      } catch (error) {
        const backupModel = await this.resolveBackupModel("judge", [
          resolvedModel,
          model,
        ]);

        if (backupModel && this.isModelFailureError(error)) {
          this.logger.warn(
            `Judge model '${resolvedModel}' failed. Retrying once with backup model '${backupModel}'.`
          );
          resolvedModel = backupModel;
          response = await this.callModelAPI(
            resolvedModel,
            prompt,
            this.getJudgeResponseSchema()
          );
        } else {
          throw error;
        }
      }

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

    const diffPreview = this.buildDiffPreview(context);

    return `You are an expert code reviewer. Analyze this pull request and provide your review opinion.

**PR Title:** ${context.prTitle}

**PR Description:** ${context.prDescription || "No description provided"}

**Changed Files:**
${filesInfo}

**Code Changes:**
${diffPreview}

CRITICAL INSTRUCTIONS FOR RESPONSE FORMAT:
- Your ENTIRE response MUST be a single valid JSON object
- DO NOT include ANY markdown formatting, code blocks, or explanatory prose
- DO NOT use triple backticks or any code fence markers
- DO NOT include ANY text outside the JSON structure
- Start your response with '{' and end with '}'

Respond ONLY with this exact JSON structure (all fields required, do NOT add any text before or after):
{
  "decision": "APPROVE" or "REQUEST_CHANGES" or "COMMENT",
  "reasoning": "Your detailed reasoning for this decision",
  "summary": "Brief 1-2 sentence summary of the PR",
  "findings": [
    {
      "file": "path/to/file.ts",
      "lineStart": 10,
      "lineEnd": 12,
      "severity": "critical" or "warning" or "info",
      "message": "Specific code issue found",
      "suggestion": "How to fix it (optional)"
    }
  ]
}

INSTRUCTIONS FOR FINDINGS:
- Analyze the code and find actual issues if any exist
- Report findings for specific lines shown in the diff
- Use exact file names and line numbers from the diff
- Each finding MUST reference a specific changed line
- Severity levels: "critical" = security/crash bugs, "warning" = quality/performance issues, "info" = minor improvements
- Return empty array [] if code is good with no issues found

Examples of good findings:
- "Missing null check on user object before accessing .email property"
- "SQL injection vulnerability: user input not sanitized in query"
- "Variable declared but never used"
- "Inefficient O(n²) loop can be optimized to O(n)"

RESPOND ONLY WITH THE JSON OBJECT. NO OTHER TEXT.`;
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

CRITICAL INSTRUCTIONS FOR RESPONSE FORMAT:
- Your ENTIRE response MUST be a single valid JSON object
- DO NOT include ANY markdown formatting, code blocks, or explanatory prose
- DO NOT use triple backticks or any code fence markers
- DO NOT include ANY text outside the JSON structure
- Start your response with '{' and end with '}'

Respond ONLY with this exact JSON structure (all fields required, do NOT add any text before or after):
{
  "decision": "APPROVE" or "REQUEST_CHANGES" or "COMMENT",
  "reasoning": "Your reasoning synthesizing all reviewer opinions",
  "confidence": 0.95,
  "needsRetry": false,
  "roundsNeeded": ${roundNumber}
}

Decision rules:
- "APPROVE": All reviewers agree OR 2+ approve with no critical findings
- "REQUEST_CHANGES": 2+ found critical issues OR unanimous REQUEST_CHANGES
- "COMMENT": Mixed opinions with minor issues

RESPOND ONLY WITH THE JSON OBJECT. NO OTHER TEXT.`;
  }

  /**
   * Call the configured LLM provider with retry logic
   */
  private async callModelAPI(
    model: string,
    prompt: string,
    responseSchema: Record<string, unknown>,
    attempt: number = 1
  ): Promise<LLMResponse> {
    if (this.provider === "groq") {
      return this.callGroqAPI(model, prompt, responseSchema, attempt);
    }

    return this.callGeminiAPI(model, prompt, responseSchema, attempt);
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
        throw new LLMApiError(
          response.status,
          `Gemini API error: ${response.status} - ${errorData.error?.message || "Unknown error"}`
        );
      }

      const data = (await response.json()) as GeminiResponse;

      // Track token usage from response metadata
      if (data.usageMetadata) {
        if (data.usageMetadata.promptTokenCount) {
          this.totalTokens.prompt += data.usageMetadata.promptTokenCount;
        }
        if (data.usageMetadata.candidatesTokenCount) {
          this.totalTokens.completion +=
            data.usageMetadata.candidatesTokenCount;
        }
        if (data.usageMetadata.totalTokenCount) {
          this.totalTokens.total += data.usageMetadata.totalTokenCount;
        }
      }

      return data;
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
   * Call Groq API with retry logic
   */
  private async callGroqAPI(
    model: string,
    prompt: string,
    _responseSchema: Record<string, unknown>,
    attempt: number = 1
  ): Promise<GroqResponse> {
    const trimmedBase = this.baseUrl.replace(/\/$/, "");
    const useOpenAICompat = trimmedBase.includes("/openai/v1");
    const openAIBase = trimmedBase.replace(/\/models$/, "");
    const url = useOpenAICompat
      ? `${openAIBase}/completions`
      : `${trimmedBase}/${model}/generate`;

    const body = useOpenAICompat
      ? {
          model,
          prompt,
          temperature: 0.7,
          top_p: 0.95,
          max_tokens: 2048,
          top_k: 40,
        }
      : {
          input: prompt,
          temperature: 0.7,
          top_p: 0.95,
          max_output_tokens: 2048,
          top_k: 40,
        };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as GroqResponse;
        throw new LLMApiError(
          response.status,
          `Groq API error: ${response.status} - ${errorData.error?.message || "Unknown error"}`
        );
      }

      const data = (await response.json()) as GroqResponse;
      return data;
    } catch (error) {
      if (attempt < this.maxRetries && this.isRetryableError(error)) {
        this.logger.warn(
          `API call failed (attempt ${attempt}/${this.maxRetries}), retrying in ${this.retryDelayMs}ms...`
        );
        await this.delay(this.retryDelayMs);
        return this.callGroqAPI(model, prompt, _responseSchema, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Parse reviewer model response
   */
  private parseReviewerResponse(
    response: LLMResponse,
    modelName: string,
    reviewerId: string
  ): ReviewerOpinion {
    const text = this.extractResponseText(response);
    if (!text) {
      throw new Error("Empty response from model");
    }

    try {
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
      const errorDetails =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Reviewer '${modelName}' returned non-JSON output. Falling back to text parsing. Error details: ${errorDetails}`
      );

      // Extract findings from text response (don't lose findings!)
      const findings = this.extractFindingsFromText(text);

      return {
        reviewerId,
        modelName,
        decision: this.extractDecisionFromText(text),
        reasoning: text,
        findings,
        summary: text.slice(0, 300),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Parse judge model response
   */
  private parseJudgeResponse(
    response: LLMResponse,
    roundNumber: number
  ): ConsensusDecision {
    const text = this.extractResponseText(response);
    if (!text) {
      throw new Error("Empty response from judge model");
    }

    try {
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
      const errorDetails =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Judge response was not valid JSON. Falling back to heuristic parsing. Error details: ${errorDetails}`
      );

      return {
        decision: this.extractDecisionFromText(text),
        reasoning: text,
        confidence: 0.35,
        roundsNeeded: roundNumber,
        forcedAfterMaxRounds: false,
      };
    }
  }

  /**
   * Extract text from Gemini response
   */
  private extractResponseText(response: LLMResponse): string {
    if (this.provider === "groq") {
      const groqResponse = response as GroqResponse;
      const openAIText = groqResponse.choices
        ?.map((choice) => choice.text || choice.message?.content || "")
        .join("");

      if (openAIText) {
        return openAIText.trim();
      }

      const groqText = groqResponse.output
        ?.map((out) => out.content?.map((item) => item.text || "").join(""))
        .join("") || "";
      return groqText.trim();
    }

    const geminiResponse = response as GeminiResponse;
    const text =
      geminiResponse.candidates?.[0]?.content?.parts
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
        purpose === "judge"
          ? FALLBACK_MODELS[this.provider].judge
          : FALLBACK_MODELS[this.provider].reviewer;
      const fallback = fallbackCandidates.find((candidate) =>
        availableModels.has(candidate)
      );

      if (fallback) {
        this.logger.warn(
          `Model '${normalizedRequestedModel}' is unavailable for ${this.provider} generation. Falling back to '${fallback}'.`
        );
        this.resolvedModelCache.set(cacheKey, fallback);
        return fallback;
      }
    } catch (error) {
      this.logger.warn(
        `Could not fetch ${this.provider.toUpperCase()} model list for validation: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    this.resolvedModelCache.set(cacheKey, aliasedModel);
    return aliasedModel;
  }

  /**
   * Choose a backup model when the requested model is blocked or unavailable.
   */
  private async resolveBackupModel(
    purpose: ModelPurpose,
    excludedModels: string[]
  ): Promise<string | null> {
    const normalizedExclusions = new Set(
      excludedModels.map((model) => this.normalizeModelName(model))
    );

    try {
      const availableModels = await this.getAvailableGenerateContentModels();
      const fallbackCandidates =
        purpose === "judge"
          ? FALLBACK_MODELS[this.provider].judge
          : FALLBACK_MODELS[this.provider].reviewer;

      const backupModel = fallbackCandidates.find(
        (candidate) =>
          !normalizedExclusions.has(candidate) && availableModels.has(candidate)
      );

      return backupModel || null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch the current set of models that support generateContent in v1beta.
   */
  private async getAvailableGenerateContentModels(): Promise<Set<string>> {
    if (this.availableGenerateContentModels) {
      return this.availableGenerateContentModels;
    }

    if (this.provider === "groq") {
      const availableModels = new Set<string>();
      const trimmedBase = this.baseUrl.replace(/\/$/, "");
      const url = trimmedBase.endsWith("/models")
        ? new URL(trimmedBase)
        : new URL(`${trimmedBase}/models`);

      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new LLMApiError(
            response.status,
            `Groq model list error: ${response.status} - ${(errorData as any).error?.message || "Unknown error"}`
          );
        }

        const data = (await response.json()) as Record<string, unknown>;

        const models = Array.isArray(data.data)
          ? (data.data as Array<Record<string, unknown>>)
          : Array.isArray(data.models)
          ? (data.models as Array<Record<string, unknown>>)
          : [];

        for (const model of models) {
          const modelName = this.normalizeModelName(
            String(model.id || model.name || model.model || "")
          );
          if (modelName) {
            availableModels.add(modelName);
          }
        }

        if (availableModels.size === 0) {
          this.logger.warn(
            "Could not parse Groq model list response. Falling back to known Groq models."
          );
          FALLBACK_MODELS.groq.reviewer.forEach((model) =>
            availableModels.add(model)
          );
          FALLBACK_MODELS.groq.judge.forEach((model) => availableModels.add(model));
        }

        this.availableGenerateContentModels = availableModels;
        return availableModels;
      } catch (error) {
        this.logger.warn(
          `Could not fetch Groq model list from ${url.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        const fallbackModels = new Set<string>([
          ...FALLBACK_MODELS.groq.reviewer,
          ...FALLBACK_MODELS.groq.judge,
        ]);
        this.availableGenerateContentModels = fallbackModels;
        return fallbackModels;
      }
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
        throw new LLMApiError(
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
   * Handles multiple response formats:
   * - Pure JSON
   * - JSON wrapped in markdown code blocks
   * - JSON embedded in text
   * - Malformed JSON with trailing/leading text
   */
  private parseStructuredJson<T>(text: string, label: string): T {
    if (!text || text.trim().length === 0) {
      throw new Error(`Empty response received for ${label}`);
    }

    // Attempt 1: Direct parse
    try {
      return JSON.parse(text) as T;
    } catch {
      // Continue to next attempt
    }

    // Attempt 2: Strip markdown code blocks
    const stripped = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    try {
      return JSON.parse(stripped) as T;
    } catch {
      // Continue to next attempt
    }

    // Attempt 3: Extract the most promising JSON object
    // Find all potential JSON objects and try the largest/most complete one
    const jsonMatches = Array.from(
      stripped.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)
    );

    if (jsonMatches.length > 0) {
      // Try each match, prioritizing the longest (most complete)
      const sortedMatches = jsonMatches.sort(
        (a, b) => b[0].length - a[0].length
      );

      for (const match of sortedMatches) {
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          // Try next match
          continue;
        }
      }
    }

    // Attempt 4: Last resort - try to find JSON by looking for key patterns
    const keyPattern =
      /"(decision|reasoning|findings|confidence|summary)"\s*:/i;
    const keyMatch = stripped.match(keyPattern);

    if (keyMatch) {
      const keyStartIndex = stripped.indexOf(keyMatch[0]);
      if (keyStartIndex >= 0) {
        const jsonStart = Math.max(0, stripped.lastIndexOf("{", keyStartIndex));
        const jsonEnd = stripped.length - 1;

        if (jsonStart >= 0) {
          try {
            return JSON.parse(stripped.substring(jsonStart, jsonEnd + 1)) as T;
          } catch {
            // Last attempt failed
          }
        }
      }
    }

    throw new Error(
      `Could not find valid JSON in ${label}. Response was: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`
    );
  }

  /**
   * Build a bounded diff preview so reviewers have enough context without
   * exhausting prompt budget.
   */
  private buildDiffPreview(context: LLMContext): string {
    const sections: string[] = [];
    let totalChars = 0;
    const maxChars = 12000;

    for (const chunk of context.chunks) {
      const snippet = [
        `File: ${chunk.file}`,
        `\`\`\`${chunk.language || "diff"}`,
        chunk.content.slice(0, 1200),
        `\`\`\``,
      ].join("\n");

      if (totalChars + snippet.length > maxChars) {
        break;
      }

      sections.push(snippet);
      totalChars += snippet.length;
    }

    return sections.join("\n\n");
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
   * Heuristic fallback when a model ignored JSON mode but still returned text.
   * Extracts decision with higher confidence from plain text responses.
   */
  private extractDecisionFromText(text: string): ReviewDecision {
    const normalized = text.toUpperCase();

    // Strong indicators for REQUEST_CHANGES
    const requestChangesPatterns = [
      /\bREQUEST[S]?\s+CHANGES?\b/,
      /\bREQUEST[S]?\s+MORE?\s+CHANGES?\b/,
      /\bCHANGES\s+REQUESTED\b/,
      /\breject(?:ed)?\b/,
      /\bdo\s+not\s+approve\b/,
      /\bcritical\s+issue/,
      /\bsecurity\s+vulnerability/,
      /\bdo\s+not\s+merge\b/,
    ];

    for (const pattern of requestChangesPatterns) {
      if (pattern.test(normalized)) {
        return "REQUEST_CHANGES";
      }
    }

    // Strong indicators for APPROVE
    const approvePatterns = [
      /\bAPPROV(?:ED?)?\b/,
      /\blooks\s+good\b/,
      /\bthis\s+is\s+good\b/,
      /\bno\s+issues\b/,
      /\bno\s+problems\b/,
      /\bcan\s+merge\b/,
      /\bready\s+to\s+merge\b/,
      /\blegit\b/,
    ];

    for (const pattern of approvePatterns) {
      if (pattern.test(normalized)) {
        return "APPROVE";
      }
    }

    return "COMMENT";
  }

  /**
   * Extract findings from text when JSON parsing fails.
   * Looks for patterns like "file.ts:line" or common issue descriptions.
   */
  private extractFindingsFromText(text: string): Array<{
    file: string;
    lineStart: number;
    lineEnd?: number;
    severity: "critical" | "warning" | "info";
    message: string;
    suggestion?: string;
  }> {
    const findings = [];

    // Pattern 1: "file.ts:123 - message" or "file.ts (line 123) - message"
    const fileLinePattern =
      /([^\s:]+\.(?:ts|js|tsx|jsx|py|go|java|rs|cpp|c|h|rb|php|cs|swift))[:\s]*(?:line\s*)?(\d+)[\s-]*([^\n]+)/gi;
    let match;

    while ((match = fileLinePattern.exec(text)) !== null) {
      const [, file, lineStr, message] = match;
      const lineNum = parseInt(lineStr, 10);

      if (file && !isNaN(lineNum)) {
        findings.push({
          file,
          lineStart: lineNum,
          severity: this.detectSeverityFromText(message),
          message: message.trim().slice(0, 200),
        });
      }
    }

    // Deduplicate findings by file+line+message
    const seen = new Set<string>();
    return findings.filter((f) => {
      const key = `${f.file}:${f.lineStart}:${f.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Detect severity level from text patterns
   */
  private detectSeverityFromText(
    text: string
  ): "critical" | "warning" | "info" {
    const normalized = text.toUpperCase();

    if (
      normalized.includes("CRITICAL") ||
      normalized.includes("SECURITY") ||
      normalized.includes("BUG") ||
      normalized.includes("ERROR")
    ) {
      return "critical";
    }

    if (
      normalized.includes("WARNING") ||
      normalized.includes("ISSUE") ||
      normalized.includes("PROBLEM")
    ) {
      return "warning";
    }

    return "info";
  }

  /**
   * Retry only transient failures. 4xx model/config errors should fail fast.
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof LLMApiError) {
      return error.statusCode === 429 || error.statusCode >= 500;
    }

    return true;
  }

  /**
   * Detect errors where another model is worth trying.
   */
  private isModelFailureError(error: unknown): boolean {
    if (error instanceof LLMApiError) {
      return error.statusCode === 404 || error.statusCode === 429;
    }

    const message = error instanceof Error ? error.message : String(error);
    return message.includes("404") || message.includes("429");
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
        `⚠️ Model not available: '${modelName}' - Check ${this.provider.toUpperCase()} API documentation for available models`
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
