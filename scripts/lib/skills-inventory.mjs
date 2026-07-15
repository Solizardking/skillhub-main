/**
 * Shared skills/ inventory helpers used by the immediate process path,
 * skill-relay, and tests.
 *
 * Discovery rule (matches build-catalog): a skill is a directory under
 * skillsRoot that owns a SKILL.md (path segments relative to skillsRoot).
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const FINGERPRINT_EXTS = new Set([
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".py",
  ".sh",
  ".ts",
  ".js",
  ".mjs",
  ".toml",
  ".txt",
]);

const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".lake",
  ".vercel",
  "node_modules",
  "target",
  "__pycache__",
]);

/**
 * SHA-256 fingerprint of skill source files under skillsRoot (paths + mtime + size).
 * Used for change detection when skills are dropped or edited.
 */
export async function fingerprintSkills(skillsRoot) {
  const files = [];
  await walkSkillFiles(skillsRoot, skillsRoot, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(String(file.mtimeMs));
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\n");
  }
  return hash.digest("hex");
}

/**
 * List skill slugs (directory paths relative to skillsRoot that own SKILL.md).
 * Same leaf rule as build-catalog: once SKILL.md is found, nested dirs are not extra skills.
 */
export async function listSkillSlugs(skillsRoot) {
  const slugs = [];
  await collectSkillSlugs(skillsRoot, [], slugs);
  slugs.sort((a, b) => a.localeCompare(b));
  return slugs;
}

/**
 * Diff two slug lists. Returns { added, removed, unchanged }.
 */
export function diffSkillSlugs(before, after) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((s) => !beforeSet.has(s));
  const removed = before.filter((s) => !afterSet.has(s));
  const unchanged = after.filter((s) => beforeSet.has(s));
  return { added, removed, unchanged };
}

/**
 * Extract the skills badge count and "N installable agent skills" number from README text.
 * Returns { badgeCount, installableCount } or nulls if not found.
 */
export function extractReadmeSkillsCounts(readmeText) {
  const badgeMatch = readmeText.match(
    /!\[Skills\]\(https:\/\/img\.shields\.io\/badge\/skills-(\d+)-8A2BE2/,
  );
  const installableMatch = readmeText.match(/\*\*(\d+) installable agent skills\*\*/);
  return {
    badgeCount: badgeMatch ? Number(badgeMatch[1]) : null,
    installableCount: installableMatch ? Number(installableMatch[1]) : null,
  };
}

/**
 * Build the badge / installable counter strings the catalog writer uses.
 * Pure: derived only from catalog length (and optional category/google/nvidia counts).
 */
export function formatReadmeSkillsCounterStrings(catalogLength) {
  return {
    badge: `![Skills](https://img.shields.io/badge/skills-${catalogLength}-8A2BE2?style=flat-square)`,
    installable: `**${catalogLength} installable agent skills**`,
  };
}

/**
 * Assert README counters match catalog length. Throws if mismatch.
 */
export function assertReadmeMatchesCatalog(readmeText, catalogLength) {
  const { badgeCount, installableCount } = extractReadmeSkillsCounts(readmeText);
  if (badgeCount !== catalogLength) {
    throw new Error(
      `README skills badge count ${badgeCount} !== catalog length ${catalogLength}`,
    );
  }
  if (installableCount !== catalogLength) {
    throw new Error(
      `README installable count ${installableCount} !== catalog length ${catalogLength}`,
    );
  }
  return true;
}

/**
 * Whether a path under skillsRoot looks like a complete skill (has readable SKILL.md).
 */
export async function isCompleteSkillDir(skillDir) {
  const skillMd = path.join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) return false;
  try {
    const content = await readFile(skillMd, "utf8");
    return content.trim().length > 0;
  } catch {
    return false;
  }
}

async function collectSkillSlugs(directory, segments, slugs) {
  const skillPath = path.join(directory, "SKILL.md");
  if (segments.length > 0 && existsSync(skillPath)) {
    slugs.push(segments.join("/"));
    return;
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    await collectSkillSlugs(
      path.join(directory, entry.name),
      [...segments, entry.name],
      slugs,
    );
  }
}

async function walkSkillFiles(root, dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkSkillFiles(root, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!FINGERPRINT_EXTS.has(ext)) continue;
    const info = await stat(full);
    out.push({
      path: path.relative(root, full),
      mtimeMs: info.mtimeMs,
      size: info.size,
    });
  }
}
