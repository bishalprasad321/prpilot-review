/**
 * Logger utility for consistent logging across all modules
 *
 * Provides debug, info, warn, and error logging with optional debug mode
 */
/* eslint-disable no-console */

export class Logger {
  private debugMode: boolean;

  constructor(debug: boolean = false) {
    this.debugMode = debug;
  }

  /**
   * Log info message
   */
  info(message: string): void {
    console.log(`[INFO] ${message}`);
  }

  /**
   * Log debug message (only when debug mode enabled)
   */
  debug(message: string): void {
    if (this.debugMode) {
      console.log(`[DEBUG] ${message}`);
    }
  }

  /**
   * Log warning message
   */
  warn(message: string): void {
    console.warn(`[WARN] ${message}`);
  }

  /**
   * Log error message
   */
  error(message: string): void {
    console.error(`[ERROR] ${message}`);
  }

  /**
   * Log with custom prefix
   */
  log(level: string, message: string): void {
    console.log(`[${level.toUpperCase()}] ${message}`);
  }

  /**
   * Log a section header
   */
  section(title: string): void {
    const separator = "=".repeat(70);
    console.log(`\n${separator}`);
    console.log(`📋 ${title}`);
    console.log(`${separator}\n`);
  }

  /**
   * Log a step in a process
   */
  step(stepNumber: number, title: string): void {
    console.log(`\n[STEP ${stepNumber}] ${title}`);
  }

  /**
   * Log success message
   */
  success(message: string): void {
    console.log(`✅ ${message}`);
  }

  /**
   * Log failure message
   */
  failure(message: string): void {
    console.log(`❌ ${message}`);
  }

  /**
   * Log timing information
   */
  timing(label: string, ms: number): void {
    this.debug(`⏱️ ${label}: ${ms}ms`);
  }
}
