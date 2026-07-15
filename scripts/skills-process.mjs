#!/usr/bin/env node

/**
 * Immediate skills process path — detect changes under skills/, scan, categorize
 * via the real catalog builder, and update README counters without optional
 * commit/push/on-chain/smoke-install steps.
 *
 * Modes:
 *   node scripts/skills-process.mjs              # one-shot: process current skills/
 *   node scripts/skills-process.mjs --watch      # poll skills/ and process on change
 *   node scripts/skills-process.mjs --once       # alias for one-shot (explicit)
 *
 * Env:
 *   SKILLHUB_PROCESS_INTERVAL_MS   poll interval in watch mode (default 1500)
 *   SKILLHUB_PROCESS_DEBOUNCE_MS   coalesce bursty drops before process (default 400)
 *   SKILLHUB_PROCESS_SKIP_SCAN=1   skip scanner (catalog/README only; not default)
 *
 * Pipeline on each cycle:
 *   1. inventory fingerprint / slug list
 *   2. scripts/build-catalog.mjs  (discover, categorize, write catalog + README)
 *   3. scanner/bin/scan-skills.mjs --all-local  (scan disk SKILL.md inventory)
 *   4. verify README counter == catalog length
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertReadmeMatchesCatalog,
  diffSkillSlugs,
  fingerprintSkills,
  listSkillSlugs,
} from "./lib/skills-inventory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SKILLS_ROOT = path.join(ROOT, "skills");
const STATE_PATH = path.join(ROOT, "onchain", "skills-process-state.json");
const SCAN_RESULTS_PATH = path.join(ROOT, "scanner", "results", "scan-results.json");

const args = process.argv.slice(2);
const WATCH = args.includes("--watch");
const SKIP_SCAN =
  args.includes("--skip-scan") || process.env.SKILLHUB_PROCESS_SKIP_SCAN === "1";
const INTERVAL_MS = Number(process.env.SKILLHUB_PROCESS_INTERVAL_MS || 1500);
const DEBOUNCE_MS = Number(process.env.SKILLHUB_PROCESS_DEBOUNCE_MS || 400);

/**
 * Run one full process cycle (catalog categorize + README + optional scan).
 * @param {{ reason?: string, skillsRoot?: string, root?: string, skipScan?: boolean }} options
 */
export async function processSkillsOnce(options = {}) {
  const reason = options.reason || "one-shot";
  const root = options.root || ROOT;
  const skillsRoot = options.skillsRoot || path.join(root, "skills");
  const skipScan = options.skipScan ?? SKIP_SCAN;
  const started = Date.now();

  console.log(`[${ts()}] skills-process start (${reason})`);

  const slugsBefore = await listSkillSlugs(skillsRoot);
  const fingerprintBefore = await fingerprintSkills(skillsRoot);
  console.log(
    `[${ts()}] inventory: ${slugsBefore.length} skills, fingerprint ${fingerprintBefore.slice(0, 12)}…`,
  );

  // 1) Categorize + write catalog.json, README.md, public mirrors
  await runNode(root, ["scripts/build-catalog.mjs"]);

  // 2) Scan local SKILL.md inventory (includes newly dropped skills)
  let scanSummary = null;
  if (!skipScan) {
    await runNode(root, [
      "scanner/bin/scan-skills.mjs",
      "--all-local",
      "--root",
      root,
    ]);
    scanSummary = await readScanSummary(root);
  } else {
    console.log(`[${ts()}] scan skipped (--skip-scan)`);
  }

  const catalog = JSON.parse(await readFile(path.join(root, "catalog.json"), "utf8"));
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  assertReadmeMatchesCatalog(readme, catalog.length);

  const slugsAfter = await listSkillSlugs(skillsRoot);
  const fingerprintAfter = await fingerprintSkills(skillsRoot);
  const { added, removed } = diffSkillSlugs(slugsBefore, slugsAfter);

  // Prefer catalog-vs-previous for "what landed" when process itself doesn't change tree
  const catalogSlugs = catalog.map((s) => s.slug).sort();
  const categorized = catalog.filter((s) => s.slug && s.category);

  const state = {
    schemaVersion: "skillhub-skills-process-state/v1",
    updatedAt: new Date().toISOString(),
    reason,
    totalSkills: catalog.length,
    inventorySlugs: slugsAfter.length,
    fingerprint: fingerprintAfter,
    addedDuringCycle: added,
    removedDuringCycle: removed,
    categorizedCount: categorized.length,
    readmeBadgeMatchesCatalog: true,
    scan: scanSummary,
    durationMs: Date.now() - started,
  };

  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  // State always under repo root (not custom root) unless writing tests use default
  const statePath =
    options.statePath ||
    (root === ROOT ? STATE_PATH : path.join(root, "onchain", "skills-process-state.json"));
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  console.log(
    `[${ts()}] catalog: ${state.totalSkills} skills; README counters match; categorized ${state.categorizedCount}`,
  );
  if (scanSummary) {
    console.log(
      `[${ts()}] scan: ${scanSummary.totalSkills} skills scanned, findings ${scanSummary.findingsTotal ?? "n/a"}`,
    );
  }
  console.log(`[${ts()}] skills-process done in ${state.durationMs}ms`);

  return {
    state,
    catalog,
    catalogSlugs,
    fingerprintBefore,
    fingerprintAfter,
  };
}

/**
 * Watch skillsRoot; on fingerprint change (after debounce), run processSkillsOnce.
 * Returns a controller { stop } when options.returnController is true; otherwise loops forever.
 */
export async function watchSkills(options = {}) {
  const root = options.root || ROOT;
  const skillsRoot = options.skillsRoot || path.join(root, "skills");
  const intervalMs = options.intervalMs ?? INTERVAL_MS;
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const maxCycles = options.maxCycles; // for tests
  let lastFingerprint = await fingerprintSkills(skillsRoot);
  let cycles = 0;
  let stopped = false;

  console.log(
    `skills-process watching ${path.relative(root, skillsRoot) || "skills"} (every ${intervalMs}ms, debounce ${debounceMs}ms)`,
  );

  // Always process once at start so catalog/README are current.
  await processSkillsOnce({
    ...options,
    reason: options.startupReason || "startup",
    root,
    skillsRoot,
  });
  lastFingerprint = await fingerprintSkills(skillsRoot);
  cycles += 1;

  if (maxCycles === 1) {
    return { cycles, lastFingerprint };
  }

  while (!stopped) {
    if (maxCycles != null && cycles >= maxCycles) break;
    await sleep(intervalMs);
    if (stopped) break;

    let next = await fingerprintSkills(skillsRoot);
    if (next === lastFingerprint) continue;

    // Coalesce multi-file drag-in bursts
    if (debounceMs > 0) {
      await sleep(debounceMs);
      next = await fingerprintSkills(skillsRoot);
    }
    if (next === lastFingerprint) continue;

    console.log(`\n[${ts()}] skills/ changed — processing`);
    await processSkillsOnce({
      ...options,
      reason: "watch-change",
      root,
      skillsRoot,
    });
    lastFingerprint = await fingerprintSkills(skillsRoot);
    cycles += 1;
  }

  return { cycles, lastFingerprint, stop: () => { stopped = true; } };
}

/**
 * Detect whether skills tree fingerprint differs from a prior value.
 */
export async function hasSkillsChanged(skillsRoot, previousFingerprint) {
  const next = await fingerprintSkills(skillsRoot);
  return { changed: next !== previousFingerprint, fingerprint: next };
}

async function readScanSummary(root) {
  try {
    const resultsPath = path.join(root, "scanner", "results", "scan-results.json");
    const results = JSON.parse(await readFile(resultsPath, "utf8"));
    return {
      totalSkills: results.summary?.totalSkills ?? results.skills?.length ?? 0,
      findingsTotal: results.summary?.findings?.total ?? null,
      scannedAt: results.scannedAt || null,
      mode: results.scanner?.mode || null,
      skillSlugs: Array.isArray(results.skills)
        ? results.skills.map((s) => s.slug).filter(Boolean)
        : [],
    };
  } catch (error) {
    console.warn(`[${ts()}] could not read scan results: ${error.message}`);
    return null;
  }
}

function runNode(cwd, nodeArgs) {
  return new Promise((resolve, reject) => {
    console.log(`$ node ${nodeArgs.join(" ")}`);
    const child = spawn(process.execPath, nodeArgs, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`node ${nodeArgs.join(" ")} exited with code ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ts() {
  return new Date().toISOString();
}

async function main() {
  if (WATCH) {
    await watchSkills({ root: ROOT, skillsRoot: SKILLS_ROOT });
    return;
  }
  await processSkillsOnce({ reason: "one-shot", root: ROOT, skillsRoot: SKILLS_ROOT });
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

export {
  ROOT,
  SKILLS_ROOT,
  STATE_PATH,
  SCAN_RESULTS_PATH,
  fingerprintSkills,
  listSkillSlugs,
  diffSkillSlugs,
};
