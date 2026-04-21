#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const distDir = path.join(process.cwd(), "dist");

if (!fs.existsSync(distDir)) {
  process.exit(0);
}

for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue;
  }

  fs.chmodSync(path.join(distDir, entry.name), 0o644);
}
