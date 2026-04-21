/**
 * State Manager - Persist processing state for idempotency
 *
 * Tracks:
 * - Last reviewed commit SHA
 * - Ensures we don't re-review the same code
 *
 * Storage: Local file (.ai-pr-state.json)
 */

import * as fs from "fs";
import * as path from "path";
import { Logger } from "../utils/logger.js";
import { ReviewStateData } from "../utils/types.js";

const STATE_FILE = ".ai-pr-state.json";

export class StateManager {
  private logger: Logger;
  private stateFilePath: string;
  private state: ReviewStateData;

  constructor(workingDir?: string, debug: boolean = false) {
    this.logger = new Logger(debug);
    this.stateFilePath = path.join(workingDir || process.cwd(), STATE_FILE);
    this.state = this.loadState();
  }

  /**
   * Load state from file
   */
  private loadState(): ReviewStateData {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const content = fs.readFileSync(this.stateFilePath, "utf-8");
        const parsed = JSON.parse(content) as ReviewStateData;
        this.logger.debug(`Loaded state from ${this.stateFilePath}`);
        return parsed;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to load state file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Return default state
    return {
      lastReviewedSha: null,
      lastReviewedAt: null,
      prNumber: null,
      lastConsensusRound: null,
    };
  }

  /**
   * Get last reviewed SHA
   */
  getLastReviewedSha(): string | null {
    return this.state.lastReviewedSha;
  }

  /**
   * Set last reviewed SHA
   */
  setLastReviewedSha(sha: string): void {
    this.state.lastReviewedSha = sha;
    this.state.lastReviewedAt = new Date().toISOString();
    this.saveState();
    this.logger.debug(`Updated last reviewed SHA to ${sha.slice(0, 7)}`);
  }

  /**
   * Get PR number
   */
  getPRNumber(): number | null {
    return this.state.prNumber;
  }

  /**
   * Set PR number
   */
  setPRNumber(prNumber: number): void {
    this.state.prNumber = prNumber;
    this.saveState();
    this.logger.debug(`Set PR number to ${prNumber}`);
  }

  /**
   * Get last consensus round
   */
  getLastConsensusRound(): number | null {
    return this.state.lastConsensusRound;
  }

  /**
   * Set last consensus round
   */
  setLastConsensusRound(round: number): void {
    this.state.lastConsensusRound = round;
    this.saveState();
    this.logger.debug(`Set last consensus round to ${round}`);
  }

  /**
   * Check if SHA was already reviewed
   */
  isAlreadyReviewed(sha: string): boolean {
    return this.state.lastReviewedSha === sha;
  }

  /**
   * Clear state
   */
  clear(): void {
    this.state = {
      lastReviewedSha: null,
      lastReviewedAt: null,
      prNumber: null,
      lastConsensusRound: null,
    };
    this.saveState();
    this.logger.debug("State cleared");
  }

  /**
   * Get full state
   */
  getState(): ReviewStateData {
    return { ...this.state };
  }

  /**
   * Save state to file
   */
  private saveState(): void {
    try {
      fs.writeFileSync(
        this.stateFilePath,
        JSON.stringify(this.state, null, 2),
        "utf-8"
      );
      this.logger.debug(`State saved to ${this.stateFilePath}`);
    } catch (error) {
      this.logger.error(
        `Failed to save state file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
