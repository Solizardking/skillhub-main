#!/usr/bin/env node
/**
 * prepack/postpack helper: temporarily park build-artifact dirs so npm pack
 * stays under registry size limits. Restores everything after pack/publish.
 *
 * Usage: node scripts/npm-pack-exclude.mjs hide|restore
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = path.join(ROOT, ".npm-pack-exclude-state.json");
const PARK =
  process.env.SKILLHUB_PACK_EXCLUDE_DIR ||
  path.join(os.tmpdir(), "skillhub-npm-pack-excludes");

/** Directory basenames that must never ship (Cargo/Rust/build caches). */
const DIR_NAMES = new Set(["target", "node_modules", ".git", "__pycache__", ".venv", "coverage"]);

function walkDirs(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const full = path.join(dir, ent.name);
    if (DIR_NAMES.has(ent.name)) {
      acc.push(full);
      continue; // do not walk inside excluded trees
    }
    // skip hidden top-level tooling except we may need skills/*
    if (ent.name.startsWith(".") && dir === ROOT) continue;
    walkDirs(full, acc);
  }
  return acc;
}

function hide() {
  if (existsSync(STATE)) {
    // Already hidden (e.g. nested prepack) — leave as-is
    console.log("npm-pack-exclude: state exists, skip hide");
    return;
  }
  mkdirSync(PARK, { recursive: true });
  const found = walkDirs(path.join(ROOT, "skills")).filter((p) => existsSync(p));
  const moves = [];
  let i = 0;
  for (const src of found) {
    const rel = path.relative(ROOT, src);
    const dest = path.join(PARK, `park-${i++}-${path.basename(src)}`);
    renameSync(src, dest);
    moves.push({ src: rel, dest });
    console.log(`parked ${rel} -> ${dest}`);
  }
  writeFileSync(STATE, JSON.stringify({ park: PARK, moves }, null, 2));
  console.log(`npm-pack-exclude: parked ${moves.length} path(s)`);
}

function restore() {
  if (!existsSync(STATE)) {
    console.log("npm-pack-exclude: no state, skip restore");
    return;
  }
  const { moves } = JSON.parse(readFileSync(STATE, "utf8"));
  for (const { src, dest } of moves.reverse()) {
    const abs = path.join(ROOT, src);
    if (!existsSync(dest)) {
      console.warn(`missing park dest for ${src}: ${dest}`);
      continue;
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    if (existsSync(abs)) {
      // unexpected — keep parked copy under alt name
      console.warn(`restore target exists, leave parked: ${src}`);
      continue;
    }
    renameSync(dest, abs);
    console.log(`restored ${src}`);
  }
  rmSync(STATE, { force: true });
  console.log("npm-pack-exclude: restore done");
}

const cmd = process.argv[2];
if (cmd === "hide") hide();
else if (cmd === "restore") restore();
else {
  console.error("Usage: node scripts/npm-pack-exclude.mjs hide|restore");
  process.exit(1);
}
