#!/usr/bin/env node

/**
 * Verification script to ensure all dependencies and setup are correct
 *
 * Usage: npm run verify
 * or: node scripts/verify.js
 */

const fs = require("fs");
const path = require("path");

const checks = [];
let passed = 0;
let failed = 0;

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function dirExists(dirPath) {
  return fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory();
}

function log(level, message) {
  const icons = {
    success: "✅",
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
  };
  console.log(`${icons[level] || "•"} ${message}`);
}

// Configuration files
checks.push({
  name: "tsconfig.json",
  check: () => fileExists(path.join(process.cwd(), "tsconfig.json")),
});
checks.push({
  name: "package.json",
  check: () => fileExists(path.join(process.cwd(), "package.json")),
});
checks.push({
  name: "action.yml",
  check: () => fileExists(path.join(process.cwd(), "action.yml")),
});

// Directory structure
checks.push({
  name: "src/ directory",
  check: () => dirExists(path.join(process.cwd(), "src")),
});
checks.push({
  name: "__tests__/ directory",
  check: () => dirExists(path.join(process.cwd(), "__tests__")),
});

// Run checks
for (const check of checks) {
  if (check.check()) {
    log("success", check.name);
    passed++;
  } else {
    log("error", check.name);
    failed++;
  }
}

console.log("\n" + "=".repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
