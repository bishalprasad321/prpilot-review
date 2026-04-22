#!/usr/bin/env node

/**
 * PR Pilot Review - Main Entry Point
 *
 * Orchestrates the multi-model consensus PR review process:
 * 1. Parse inputs from GitHub Actions
 * 2. Extract GitHub context
 * 3. Initialize clients
 * 4. Fetch PR metadata and diff
 * 5. Check state (skip if already reviewed)
 * 6. Process diff
 * 7. Run multi-model consensus review
 * 8. Build inline comments
 * 9. Submit PR review
 * 10. Persist state
 * 11. Set action outputs
 */

import * as core from "@actions/core";
import fs from "fs";
import { Logger } from "./utils/logger.js";
import { GitHubClient } from "./github/github-client.js";
import { DiffProcessor } from "./diff/diff-processor.js";
import { StateManager } from "./state/state-manager.js";
import { ReviewOrchestrator } from "./review/review-orchestrator.js";
import { InlineCommentBuilder } from "./review/inline-comment-builder.js";
import { ActionConfig, LLMContext, ReviewComment } from "./utils/types.js";

interface GitHubEventPayload {
  action?: string;
  pull_request?: {
    number?: number;
  };
}

const logger = new Logger();
const DEFAULT_REVIEWER_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];
const DEFAULT_JUDGE_MODEL = "gemini-2.5-pro";

async function main() {
  const startTime = Date.now();
  logger.section("🚀 PR Pilot Review - Starting");

  try {
    // =========================================================================
    // STEP 1: PARSE INPUTS
    // =========================================================================
    logger.step(1, "Parsing inputs from action.yml");

    const config: ActionConfig = {
      githubToken: core.getInput("github_token"),
      geminiApiKey: core.getInput("gemini_api_key"),
      reviewerModels: (
        core.getInput("reviewer_models") || DEFAULT_REVIEWER_MODELS.join(",")
      )
        .split(",")
        .map((m) => m.trim()),
      judgeModel: core.getInput("judge_model") || DEFAULT_JUDGE_MODEL,
      maxConsensusRounds: parseInt(core.getInput("max_consensus_rounds")) || 3,
      inlineCommentsEnabled:
        core.getInput("inline_comments_enabled") !== "false",
      maxDiffLines: parseInt(core.getInput("max_diff_lines")) || 5000,
      enableIncrementalDiffProcessing:
        core.getInput("enable_incremental_diff_processing") !== "false",
      debug: core.getInput("debug") === "true",
    };

    if (!config.githubToken || !config.geminiApiKey) {
      throw new Error(
        "Missing required inputs: github_token or gemini_api_key"
      );
    }

    logger.success("✓ Inputs validated");
    logger.info(`  - Reviewer Models: ${config.reviewerModels.join(", ")}`);
    logger.info(`  - Judge Model: ${config.judgeModel}`);
    logger.info(`  - Max Consensus Rounds: ${config.maxConsensusRounds}`);
    logger.info(
      `  - Inline Comments: ${config.inlineCommentsEnabled ? "enabled" : "disabled"}`
    );

    // =========================================================================
    // STEP 2: EXTRACT GITHUB CONTEXT
    // =========================================================================
    logger.step(2, "Extracting GitHub context");

    const eventName = process.env.GITHUB_EVENT_NAME;
    const eventPath = process.env.GITHUB_EVENT_PATH;
    let eventPayload: GitHubEventPayload = {};

    if (eventPath) {
      if (!fs.existsSync(eventPath)) {
        throw new Error(`Event file not found at ${eventPath}`);
      }

      try {
        const rawData = fs.readFileSync(eventPath, "utf-8");
        eventPayload = JSON.parse(rawData) as GitHubEventPayload;
        logger.info(`✓ Loaded event payload from ${eventPath}`);
      } catch (fileError) {
        throw new Error(
          `Failed to read GitHub event payload from ${eventPath}: ${
            fileError instanceof Error ? fileError.message : String(fileError)
          }`
        );
      }
    }

    if (eventName !== "pull_request") {
      logger.info(`⏭️  Event is '${eventName}', not 'pull_request'. Exiting.`);
      core.info("Action only runs on pull_request events");
      return;
    }

    const prNumber = eventPayload?.pull_request?.number;
    const repoOwner = process.env.GITHUB_REPOSITORY?.split("/")[0];
    const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];

    if (!prNumber || !repoOwner || !repoName) {
      throw new Error(
        `Missing PR context. PR: ${prNumber}, Owner: ${repoOwner}, Repo: ${repoName}`
      );
    }

    logger.success(`✓ GitHub context extracted`);
    logger.info(`  - Repository: ${repoOwner}/${repoName}`);
    logger.info(`  - PR Number: #${prNumber}`);

    // =========================================================================
    // STEP 3: INITIALIZE CLIENTS
    // =========================================================================
    logger.step(3, "Initializing API clients");

    const gitHub = new GitHubClient(
      config.githubToken,
      { owner: repoOwner, repo: repoName },
      config.debug
    );
    const stateManager = new StateManager(process.cwd(), config.debug);
    const diffProcessor = new DiffProcessor(config.debug);

    logger.success("✓ Clients initialized");

    // =========================================================================
    // STEP 4: FETCH PR METADATA
    // =========================================================================
    logger.step(4, "Fetching PR metadata");

    const prMetadata = await gitHub.getPullRequest(prNumber);

    if (!prMetadata) {
      throw new Error(`Failed to fetch PR #${prNumber}`);
    }

    logger.success("✓ PR metadata fetched");
    logger.info(`  - Title: ${prMetadata.title.slice(0, 60)}...`);
    logger.info(`  - Base SHA: ${prMetadata.base.sha.slice(0, 7)}`);
    logger.info(`  - Head SHA: ${prMetadata.head.sha.slice(0, 7)}`);

    // =========================================================================
    // STEP 5: STATE CHECK (IDEMPOTENCY)
    // =========================================================================
    logger.step(5, "Checking state (idempotency)");

    const alreadyReviewedLocally = stateManager.isAlreadyReviewed(
      prMetadata.head.sha
    );
    const alreadyReviewedOnGitHub = await gitHub.hasReviewForCommit(
      prNumber,
      prMetadata.head.sha
    );

    if (alreadyReviewedLocally || alreadyReviewedOnGitHub) {
      logger.warn(
        `⚠️ This commit (${prMetadata.head.sha.slice(0, 7)}) was already reviewed`
      );
      logger.info("Skipping review to avoid duplicate work");
      core.setOutput("review_decision", "SKIPPED");
      core.setOutput(
        "consensus_reasoning",
        "PR already reviewed in previous run"
      );
      return;
    }

    logger.success("✓ State check passed, proceeding with review");

    // =========================================================================
    // STEP 6: FETCH DIFF
    // =========================================================================
    logger.step(6, "Fetching PR diff");

    const files = await gitHub.getChangedFiles(prNumber);
    let diffContent = await gitHub.getDiff(prNumber);

    if (!diffContent) {
      logger.warn("⚠️ Could not fetch diff, attempting alternative method");
      diffContent = "";
    }

    logger.success(`✓ Diff fetched`);
    logger.info(`  - Changed files: ${files.length}`);
    logger.info(`  - Diff size: ${diffContent.length} bytes`);

    // =========================================================================
    // STEP 7: PROCESS DIFF
    // =========================================================================
    logger.step(7, "Processing diff");

    const diffs = diffProcessor.processAndFilter(
      files,
      diffContent,
      config.maxDiffLines
    );

    logger.success(`✓ Diff processed`);
    logger.info(`  - Chunks extracted: ${diffs.length}`);

    // =========================================================================
    // STEP 8: PREPARE LLM CONTEXT
    // =========================================================================
    logger.step(8, "Preparing LLM context");

    const commits = await gitHub.getCommits(prNumber);
    const commitMessages = commits.map((c) => c.message);

    const llmContext: LLMContext = {
      chunks: diffs,
      commitMessages,
      prTitle: prMetadata.title,
      prDescription: prMetadata.body,
      files,
    };

    logger.success("✓ LLM context prepared");
    logger.info(`  - Commits: ${commitMessages.length}`);
    logger.info(`  - Files: ${files.length}`);
    logger.info(`  - Diff chunks: ${diffs.length}`);

    // =========================================================================
    // STEP 9: RUN MULTI-MODEL CONSENSUS REVIEW
    // =========================================================================
    logger.step(9, "Running multi-model consensus review");

    const orchestrator = new ReviewOrchestrator(config.geminiApiKey, {
      reviewerModels: config.reviewerModels,
      judgeModel: config.judgeModel,
      maxConsensusRounds: config.maxConsensusRounds,
      debug: config.debug,
    });

    const reviewResult = await orchestrator.runConsensusReview(llmContext);

    logger.success("✓ Consensus review complete");
    logger.info(`  - Decision: ${reviewResult.finalDecision}`);
    logger.info(`  - Findings: ${reviewResult.inlineFindings.length}`);
    logger.info(`  - Consensus Round: ${reviewResult.consensusRound}`);

    // =========================================================================
    // STEP 10: BUILD INLINE COMMENTS
    // =========================================================================
    logger.step(10, "Building inline comments");

    const inlineComments: ReviewComment[] = [];

    if (
      config.inlineCommentsEnabled &&
      reviewResult.inlineFindings.length > 0
    ) {
      const commentBuilder = new InlineCommentBuilder(config.debug);
      commentBuilder.buildFromFiles(files);
      inlineComments.push(
        ...commentBuilder.buildComments(reviewResult.inlineFindings)
      );
    }

    logger.success("✓ Inline comments built");
    logger.info(`  - Comments: ${inlineComments.length}`);

    // =========================================================================
    // STEP 11: SUBMIT PR REVIEW
    // =========================================================================
    logger.step(11, "Submitting PR review to GitHub");

    const reviewResponse = await gitHub.submitPRReview(
      prNumber,
      inlineComments,
      reviewResult.finalDecision,
      reviewResult.summaryComment,
      prMetadata.head.sha
    );

    if (!reviewResponse) {
      logger.warn("⚠️ Failed to submit PR review");
    } else {
      logger.success("✓ PR review submitted");
      logger.info(`  - Review ID: ${reviewResponse.reviewId}`);
      logger.info(`  - Decision: ${reviewResponse.state}`);
    }

    // =========================================================================
    // STEP 12: PERSIST STATE
    // =========================================================================
    logger.step(12, "Persisting state");

    stateManager.setLastReviewedSha(prMetadata.head.sha);
    stateManager.setPRNumber(prNumber);
    stateManager.setLastConsensusRound(reviewResult.consensusRound);

    logger.success("✓ State persisted");

    // =========================================================================
    // STEP 13: SET ACTION OUTPUTS
    // =========================================================================
    logger.step(13, "Setting action outputs");

    core.setOutput("review_decision", reviewResult.finalDecision);
    core.setOutput("consensus_reasoning", reviewResult.consensusReasoning);
    core.setOutput("consensus_round", reviewResult.consensusRound.toString());
    if (reviewResponse) {
      core.setOutput("review_id", reviewResponse.reviewId.toString());
    }

    logger.success("✓ Outputs set");

    // =========================================================================
    // STEP 14: COMPLETION
    // =========================================================================
    const executionTime = Date.now() - startTime;
    logger.section("✅ PR Pilot Review - Complete");
    logger.info(`Execution time: ${executionTime}ms`);
    logger.info(`Decision: ${reviewResult.finalDecision}`);
    logger.info(`Consensus rounds: ${reviewResult.consensusRound}`);
    logger.info(`Findings: ${reviewResult.inlineFindings.length}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(`Fatal error: ${errorMessage}`);

    // Don't fail the action - always allow PR to proceed
    logger.warn(
      "⚠️ Setting error as warning to avoid breaking the PR workflow"
    );
    core.warning(`PR Pilot Review encountered an error: ${errorMessage}`);

    // Set default outputs
    core.setOutput("review_decision", "ERROR");
    core.setOutput("consensus_reasoning", errorMessage);
  }
}

// Run main
main().catch((error) => {
  console.error("Uncaught error:", error);
  process.exit(1);
});
