/**
 * GitHub API Client - Wrapper for GitHub operations
 *
 * Handles:
 * - Fetch PR details, files, commits
 * - Retrieve diffs
 * - Submit PR reviews (inline comments + summary)
 * - Update PR state
 */

import { Octokit } from "@octokit/rest";
import { Logger } from "../utils/logger.js";
import {
  PRMetadata,
  CommitInfo,
  FileChange,
  GitHubClientConfig,
  UpdatePROptions,
  ReviewComment,
  ReviewDecision,
  PRReviewResponse,
} from "../utils/types.js";

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private logger: Logger;

  constructor(
    githubToken: string,
    config: GitHubClientConfig,
    debug: boolean = false
  ) {
    this.octokit = new Octokit({ auth: githubToken });
    this.owner = config.owner;
    this.repo = config.repo;
    this.logger = new Logger(debug);
  }

  /**
   * Fetch pull request metadata
   */
  async getPullRequest(prNumber: number): Promise<PRMetadata | null> {
    try {
      const { data } = await this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      });

      return {
        title: data.title,
        body: data.body || "",
        base: {
          sha: data.base.sha,
        },
        head: {
          sha: data.head.sha,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch PR #${prNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  /**
   * Get list of files changed in the PR
   */
  async getChangedFiles(prNumber: number): Promise<FileChange[]> {
    try {
      const { data } = await this.octokit.pulls.listFiles({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: 100,
      });

      return data.map((file) => ({
        filename: file.filename,
        status: file.status as FileChange["status"],
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch changed files for PR #${prNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return [];
    }
  }

  /**
   * Get commit history for a PR
   */
  async getCommits(prNumber: number): Promise<CommitInfo[]> {
    try {
      const { data } = await this.octokit.pulls.listCommits({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: 100,
      });

      return data.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author?.name || "Unknown",
        date: commit.commit.author?.date || new Date().toISOString(),
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch commits for PR #${prNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return [];
    }
  }

  /**
   * Get the full diff for a PR (base...head)
   */
  async getDiff(prNumber: number): Promise<string> {
    try {
      const { data } = await this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      });

      const diff = await this.octokit.repos.compareCommits({
        owner: this.owner,
        repo: this.repo,
        base: data.base.sha,
        head: data.head.sha,
      });

      return (
        diff.data.files
          ?.map((file) => {
            let diffContent = `diff --git a/${file.filename} b/${file.filename}\n`;
            diffContent += `index ${file.sha?.slice(0, 7)}...${file.sha?.slice(0, 7)} 100644\n`;
            diffContent += `--- a/${file.filename}\n`;
            diffContent += `+++ b/${file.filename}\n`;
            diffContent += file.patch || "";
            return diffContent;
          })
          .join("\n") || ""
      );
    } catch (error) {
      this.logger.error(
        `Failed to fetch diff for PR #${prNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "";
    }
  }

  /**
   * Get incremental diff between two commits
   */
  async getDiffBetween(baseSha: string, headSha: string): Promise<string> {
    try {
      const diff = await this.octokit.repos.compareCommits({
        owner: this.owner,
        repo: this.repo,
        base: baseSha,
        head: headSha,
      });

      return (
        diff.data.files
          ?.map((file) => {
            let diffContent = `diff --git a/${file.filename} b/${file.filename}\n`;
            diffContent += `index ${file.sha?.slice(0, 7)}...${file.sha?.slice(0, 7)} 100644\n`;
            diffContent += `--- a/${file.filename}\n`;
            diffContent += `+++ b/${file.filename}\n`;
            diffContent += file.patch || "";
            return diffContent;
          })
          .join("\n") || ""
      );
    } catch (error) {
      this.logger.error(
        `Failed to fetch diff between ${baseSha.slice(0, 7)} and ${headSha.slice(0, 7)}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "";
    }
  }

  /**
   * Submit a PR review with inline comments and summary
   *
   * This creates a single review with:
   * - Multiple inline comments (one per code finding)
   * - A summary comment
   * - A decision (APPROVE, REQUEST_CHANGES, or COMMENT)
   */
  async submitPRReview(
    prNumber: number,
    comments: ReviewComment[],
    decision: ReviewDecision,
    summaryBody: string
  ): Promise<PRReviewResponse | null> {
    try {
      this.logger.debug(
        `Submitting PR review with ${comments.length} inline comments, decision: ${decision}`
      );

      // Convert decision to GitHub review event
      const event = this.convertDecisionToEvent(decision);

      // Build comments for review
      const reviewComments = comments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: "RIGHT" as const,
        body: comment.body,
      }));

      // Submit review
      const { data } = await this.octokit.pulls.createReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        event,
        body: summaryBody,
        comments: reviewComments,
      });

      this.logger.success(
        `PR review submitted successfully (ID: ${data.id}, Decision: ${data.state})`
      );

      return {
        reviewId: data.id,
        state: this.convertEventToDecision(data.state),
        user: {
          login: data.user?.login || "unknown",
        },
        body: data.body || "",
      };
    } catch (error) {
      this.logger.error(
        `Failed to submit PR review: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  /**
   * Update PR description
   */
  async updatePullRequest(
    prNumber: number,
    options: UpdatePROptions
  ): Promise<boolean> {
    try {
      await this.octokit.pulls.update({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        body: options.body,
        state: options.state,
      });

      this.logger.success(`PR #${prNumber} updated successfully`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to update PR #${prNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * Post a comment on a PR
   */
  async commentOnPR(prNumber: number, body: string): Promise<number | null> {
    try {
      const { data } = await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
        body,
      });

      this.logger.success(`Comment posted on PR #${prNumber} (ID: ${data.id})`);
      return data.id;
    } catch (error) {
      this.logger.error(
        `Failed to post comment on PR #${prNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  /**
   * Convert ReviewDecision to GitHub review event
   */
  private convertDecisionToEvent(
    decision: ReviewDecision
  ): "APPROVE" | "REQUEST_CHANGES" | "COMMENT" {
    return decision;
  }

  /**
   * Convert GitHub review state to ReviewDecision
   */
  private convertEventToDecision(state: string): ReviewDecision {
    switch (state) {
      case "APPROVED":
        return "APPROVE";
      case "CHANGES_REQUESTED":
        return "REQUEST_CHANGES";
      case "COMMENTED":
        return "COMMENT";
      default:
        return "COMMENT";
    }
  }
}
