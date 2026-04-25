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
      const data = await this.listAllFiles(prNumber);

      return data.map((file) => ({
        filename: file.filename,
        previousFilename: file.previous_filename,
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
      const data = await this.listAllCommits(prNumber);

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
      const files = await this.listAllFiles(prNumber);
      return this.buildUnifiedDiff(files);
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
   * Check whether PR Pilot already reviewed the current head commit.
   */
  async hasReviewForCommit(
    prNumber: number,
    headSha: string
  ): Promise<boolean> {
    try {
      const reviews = await this.listAllReviews(prNumber);

      return reviews.some(
        (review) =>
          review.commit_id === headSha &&
          Boolean(review.body?.includes("Reviewed by PR Pilot Review"))
      );
    } catch (error) {
      this.logger.warn(
        `Failed to inspect existing reviews for PR #${prNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
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
    summaryBody: string,
    commitSha?: string
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

      const { data } = await this.createReview(
        prNumber,
        event,
        summaryBody,
        reviewComments,
        commitSha
      );

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
      if (comments.length > 0 && this.isUnresolvableReviewCommentError(error)) {
        this.logger.warn(
          "Inline comments could not be resolved by GitHub. Retrying with summary-only review."
        );

        try {
          const event = this.convertDecisionToEvent(decision);
          const { data } = await this.createReview(
            prNumber,
            event,
            `${summaryBody}\n\n> Inline comments were skipped because GitHub could not resolve at least one target line in the patch.`,
            [],
            commitSha
          );

          return {
            reviewId: data.id,
            state: this.convertEventToDecision(data.state),
            user: {
              login: data.user?.login || "unknown",
            },
            body: data.body || "",
          };
        } catch (retryError) {
          this.logger.error(
            `Failed to submit fallback summary-only review: ${
              retryError instanceof Error
                ? retryError.message
                : String(retryError)
            }`
          );
        }
      }

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

  /**
   * List every changed file on a PR, not just the first page.
   */
  private async listAllFiles(prNumber: number) {
    const files = [];
    let page = 1;

    while (true) {
      const { data } = await this.octokit.pulls.listFiles({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: 100,
        page,
      });

      files.push(...data);

      if (data.length < 100) {
        break;
      }

      page += 1;
    }

    return files;
  }

  /**
   * List every commit on a PR.
   */
  private async listAllCommits(prNumber: number) {
    const commits = [];
    let page = 1;

    while (true) {
      const { data } = await this.octokit.pulls.listCommits({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: 100,
        page,
      });

      commits.push(...data);

      if (data.length < 100) {
        break;
      }

      page += 1;
    }

    return commits;
  }

  /**
   * List every review on a PR.
   */
  private async listAllReviews(prNumber: number) {
    const reviews = [];
    let page = 1;

    while (true) {
      const { data } = await this.octokit.pulls.listReviews({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: 100,
        page,
      });

      reviews.push(...data);

      if (data.length < 100) {
        break;
      }

      page += 1;
    }

    return reviews;
  }

  /**
   * Build a synthetic unified diff from the PR file list patches.
   */
  private buildUnifiedDiff(
    files: Array<{
      filename: string;
      previous_filename?: string;
      patch?: string;
      status?: string;
    }>
  ): string {
    return files
      .filter((file) => Boolean(file.patch))
      .map((file) => {
        const oldPath =
          file.status === "renamed"
            ? file.previous_filename || file.filename
            : file.filename;
        const fromPath = file.status === "added" ? "/dev/null" : `a/${oldPath}`;
        const toPath =
          file.status === "removed" ? "/dev/null" : `b/${file.filename}`;

        return [
          `diff --git ${fromPath} ${toPath}`,
          `--- ${fromPath}`,
          `+++ ${toPath}`,
          file.patch || "",
        ].join("\n");
      })
      .join("\n");
  }

  /**
   * Create a review against the current PR head.
   */
  private async createReview(
    prNumber: number,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body: string,
    comments: Array<{
      path: string;
      line: number;
      side: "RIGHT";
      body: string;
    }>,
    commitSha?: string
  ) {
    return this.octokit.pulls.createReview({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      commit_id: commitSha,
      event,
      body,
      comments,
    });
  }

  /**
   * Detect GitHub's unresolved-line validation error for inline review comments.
   */
  private isUnresolvableReviewCommentError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("Unprocessable Entity") &&
      message.includes("Line could not be resolved")
    );
  }
}
