#!/usr/bin/env node
/**
 * Build script — reads manifest.json + src/ files, produces dist/bundle.json.
 *
 * dist/bundle.json format:
 * {
 *   "manifest": { ...AppManifest },
 *   "files": { "index.html": "...", "style.css": "..." }
 * }
 *
 * Upload dist/bundle.json as a GitHub release asset. The hub installs it via
 * POST /api/apps/install with the release asset URL.
 */

import fs from "fs";
import path from "path";

const ROOT = new URL(".", import.meta.url).pathname;
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

// Read manifest
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

// Read all src files recursively
function readDir(dir, base = "") {
  const files = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(files, readDir(path.join(dir, entry.name), rel));
    } else {
      files[rel] = fs.readFileSync(path.join(dir, entry.name), "utf8");
    }
  }
  return files;
}

const files = readDir(SRC);

if (!files["index.html"]) {
  console.error("Error: src/index.html is required");
  process.exit(1);
}

const bundle = { manifest, files };

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, "bundle.json"), JSON.stringify(bundle, null, 2), "utf8");

const totalBytes = Object.values(files).reduce((s, v) => s + v.length, 0);
console.log(`Built ${Object.keys(files).length} file(s) — ${(totalBytes / 1024).toFixed(1)} KB → dist/bundle.json`);
