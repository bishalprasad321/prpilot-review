/**
 * Diff Processor - Intelligent diff filtering and chunking
 *
 * Responsibilities:
 * - Filter out binary files and build artifacts
 * - Detect programming language by file extension
 * - Chunk diffs for processing
 * - Extract meaningful code changes
 */

import { Logger } from "../utils/logger.js";
import { FileChange, DiffChunk } from "../utils/types.js";

const IGNORED_PATTERNS = [
  /node_modules\//,
  /dist\//,
  /build\//,
  /\.git\//,
  /coverage\//,
  /\.lock$/,
  /\.tsbuildinfo$/,
  /\.min\.(js|css)$/,
];

const BINARY_EXTENSIONS = [".jpg", ".png", ".gif", ".pdf", ".zip", ".exe"];

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".java": "java",
  ".cpp": "cpp",
  ".c": "c",
  ".go": "go",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".rs": "rust",
  ".md": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".xml": "xml",
  ".html": "html",
  ".css": "css",
  ".sql": "sql",
};

export class DiffProcessor {
  private logger: Logger;

  constructor(debug: boolean = false) {
    this.logger = new Logger(debug);
  }

  /**
   * Process and filter files and diff
   *
   * Returns array of meaningful diff chunks
   */
  processAndFilter(
    files: FileChange[],
    diffContent: string,
    maxDiffLines: number = 5000
  ): DiffChunk[] {
    this.logger.debug(
      `Processing ${files.length} files with max ${maxDiffLines} lines`
    );

    const filteredFiles = this.filterFiles(files);

    this.logger.debug(
      `Filtered to ${filteredFiles.length} meaningful files (ignored ${files.length - filteredFiles.length})`
    );

    const chunks = this.extractDiffChunks(filteredFiles, diffContent);

    // Truncate if necessary
    if (chunks.length > 0) {
      const totalLines = chunks.reduce(
        (sum, c) => sum + c.content.split("\n").length,
        0
      );
      if (totalLines > maxDiffLines) {
        this.logger.warn(
          `Diff too large (${totalLines} lines), truncating to ${maxDiffLines}`
        );
        return this.truncateChunks(chunks, maxDiffLines);
      }
    }

    return chunks;
  }

  /**
   * Filter out ignored files and binary files
   */
  private filterFiles(files: FileChange[]): FileChange[] {
    return files.filter((file) => {
      // Skip removed files
      if (file.status === "removed") {
        return false;
      }

      // Check against ignored patterns
      for (const pattern of IGNORED_PATTERNS) {
        if (pattern.test(file.filename)) {
          this.logger.debug(`Ignoring file (pattern): ${file.filename}`);
          return false;
        }
      }

      // Check for binary files
      for (const ext of BINARY_EXTENSIONS) {
        if (file.filename.endsWith(ext)) {
          this.logger.debug(`Ignoring binary file: ${file.filename}`);
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Extract diff chunks from files
   */
  private extractDiffChunks(
    files: FileChange[],
    diffContent: string
  ): DiffChunk[] {
    const chunks: DiffChunk[] = [];
    const lines = diffContent.split("\n");
    let currentFile: FileChange | null = null;
    let currentDiff: string[] = [];
    let inDiff = false;

    for (const line of lines) {
      // Detect file header
      if (line.startsWith("diff --git")) {
        // Save previous chunk if exists
        if (currentFile && currentDiff.length > 0) {
          chunks.push(
            this.createDiffChunk(currentFile, currentDiff.join("\n"))
          );
        }

        // Find matching file
        const match = line.match(/b\/(.+)$/);
        const filename = match ? match[1] : null;

        if (filename) {
          currentFile = files.find((f) => f.filename === filename) || null;
          currentDiff = [line];
          inDiff = !!currentFile;
        }
      } else if (inDiff && currentFile) {
        currentDiff.push(line);
      }
    }

    // Add last chunk
    if (currentFile && currentDiff.length > 0) {
      chunks.push(this.createDiffChunk(currentFile, currentDiff.join("\n")));
    }

    this.logger.debug(`Extracted ${chunks.length} diff chunks`);
    return chunks;
  }

  /**
   * Create a diff chunk with language detection
   */
  private createDiffChunk(file: FileChange, diff: string): DiffChunk {
    const language = this.detectLanguage(file.filename);

    return {
      file: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      content: diff,
      language,
    };
  }

  /**
   * Detect programming language from filename
   */
  private detectLanguage(filename: string): string | undefined {
    const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
    return LANGUAGE_MAP[ext];
  }

  /**
   * Truncate chunks to max lines
   */
  private truncateChunks(chunks: DiffChunk[], maxLines: number): DiffChunk[] {
    const result: DiffChunk[] = [];
    let totalLines = 0;

    for (const chunk of chunks) {
      const chunkLines = chunk.content.split("\n").length;

      if (totalLines + chunkLines > maxLines) {
        // Truncate this chunk
        const remainingLines = maxLines - totalLines;
        const truncatedContent = chunk.content
          .split("\n")
          .slice(0, remainingLines)
          .join("\n");

        result.push({
          ...chunk,
          content: truncatedContent + "\n... (truncated)",
        });

        break;
      }

      result.push(chunk);
      totalLines += chunkLines;
    }

    return result;
  }
}
