#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const buildDirs = ["lib", "dist"];

for (const dir of buildDirs) {
  fs.rmSync(path.join(process.cwd(), dir), { recursive: true, force: true });
}
