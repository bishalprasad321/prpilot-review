/**
 * Shared type definitions for PR Pilot Review
 *
 * This file contains all core types used across the multi-model consensus PR review system.
 */

// ============================================================================
// GitHub/PR Related Types
// ============================================================================

export interface PRMetadata {
  title: string;
  body: string;
  base: {
    sha: string;
  };
  head: {
    sha: string;
  };
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export type FileChangeStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "unchanged"
  | "type-changed";

export interface FileChange {
  filename: string;
  previousFilename?: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface DiffChunk {
  file: string;
  status: string;
  additions: number;
  deletions: number;
  content: string;
  language?: string;
}

export interface GitHubClientConfig {
  owner: string;
  repo: string;
}

export interface UpdatePROptions {
  body: string;
  state?: "open" | "closed";
}

// ============================================================================
// LLM Context & Configuration
// ============================================================================

export interface LLMContext {
  chunks: DiffChunk[];
  commitMessages: string[];
  prTitle: string;
  prDescription: string;
  files: FileChange[];
}

export type LLMProvider = "gemini";

export interface LLMClientOptions {
  provider?: LLMProvider;
  baseUrl?: string;
  debug?: boolean;
}

export interface LLMOutput {
  summary: string;
  keyPoints: string[];
  highlights: string[];
}

// ============================================================================
// Multi-Model Consensus Types
// ============================================================================

export type ReviewDecision = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface CodeFinding {
  file: string;
  lineStart: number;
  lineEnd?: number;
  severity: "critical" | "warning" | "info";
  message: string;
  suggestion?: string;
}

export interface ReviewerOpinion {
  reviewerId: string;
  modelName: string;
  decision: ReviewDecision;
  reasoning: string;
  findings: CodeFinding[];
  summary: string;
  timestamp: string;
}

export interface ConsensusDecision {
  decision: ReviewDecision;
  reasoning: string;
  confidence: number; // 0-1, represents how confident the judge is
  roundsNeeded: number;
  forcedAfterMaxRounds: boolean;
}

export interface ConsensusRound {
  roundNumber: number;
  opinions: ReviewerOpinion[];
  isConsensus: boolean;
  judge?: ConsensusDecision;
  needsRetry: boolean;
}

export interface ReviewResult {
  finalDecision: ReviewDecision;
  consensusReasoning: string;
  consensusRound: number;
  totalRounds: number;
  reviewerModels: string[];
  judgeModel: string;
  inlineFindings: CodeFinding[];
  summaryComment: string;
  allOpinions: ReviewerOpinion[];
  timestamp: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

// ============================================================================
// GitHub Review Submission Types
// ============================================================================

export interface ReviewComment {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
}

export interface PRReviewSubmission {
  event: ReviewDecision;
  body: string;
  comments: ReviewComment[];
}

export interface PRReviewResponse {
  reviewId: number;
  state: ReviewDecision;
  user: {
    login: string;
  };
  body: string;
}

// ============================================================================
// Action Configuration Types
// ============================================================================

export interface ActionConfig {
  githubToken: string;
  geminiApiKey: string;
  reviewerModels: string[];
  judgeModel: string;
  maxConsensusRounds: number;
  inlineCommentsEnabled: boolean;
  maxDiffLines: number;
  enableIncrementalDiffProcessing: boolean;
  debug: boolean;
}

// ============================================================================
// State Management Types
// ============================================================================

export interface ReviewStateData {
  lastReviewedSha: string | null;
  lastReviewedAt: string | null;
  prNumber: number | null;
  lastConsensusRound: number | null;
}

// ============================================================================
// Inline Comment Building Types
// ============================================================================

export interface LineRangeComment {
  file: string;
  startLine: number;
  endLine: number;
  body: string;
}

export interface InlineCommentMap {
  [file: string]: {
    [line: number]: string[];
  };
}

// ============================================================================
// Process/Execution Types
// ============================================================================

export interface ExecutionContext {
  prNumber: number;
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
  config: ActionConfig;
  startTime: Date;
}

export interface ProcessMetrics {
  totalExecutionTime: number;
  llmCallCount: number;
  llmTokensUsed: number;
  reviewersQueried: number;
  consensusAchievedInRound: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class ReviewProcessError extends Error {
  constructor(
    public code: string,
    message: string,
    public recoverable: boolean = false
  ) {
    super(message);
    this.name = "ReviewProcessError";
  }
}

export interface ErrorContext {
  operation: string;
  error: Error;
  recoverable: boolean;
  context?: Record<string, unknown>;
}
