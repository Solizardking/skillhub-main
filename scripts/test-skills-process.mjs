#!/usr/bin/env node

/**
 * Durable proof for skills detect → process → catalog categorize → README counter.
 * Drives the real shipped modules (skills-inventory, skills-process, build-catalog, scanner).
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertReadmeMatchesCatalog,
  diffSkillSlugs,
  extractReadmeSkillsCounts,
  fingerprintSkills,
  formatReadmeSkillsCounterStrings,
  listSkillSlugs,
} from "./lib/skills-inventory.mjs";
import {
  hasSkillsChanged,
  processSkillsOnce,
} from "./skills-process.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SKILLS_ROOT = path.join(ROOT, "skills");

const FIXTURE_SLUG = `_tmp-skills-process-${Date.now().toString(36)}`;
const FIXTURE_DIR = path.join(SKILLS_ROOT, FIXTURE_SLUG);

let failures = 0;

function ok(name) {
  console.log(`  ok  ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`  FAIL ${name}: ${error?.stack || error?.message || error}`);
}

async function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testFingerprintDetectsAdd() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skillhub-fp-"));
  try {
    const skillA = path.join(tmp, "alpha-skill");
    await mkdir(skillA, { recursive: true });
    await writeFile(
      path.join(skillA, "SKILL.md"),
      "---\nname: alpha-skill\ndescription: Fingerprint fixture A\n---\n\n# Alpha\n",
    );
    const fp1 = await fingerprintSkills(tmp);
    await assert(typeof fp1 === "string" && fp1.length === 64, "fingerprint is sha256 hex");

    const skillB = path.join(tmp, "beta-skill");
    await mkdir(skillB, { recursive: true });
    await writeFile(
      path.join(skillB, "SKILL.md"),
      "---\nname: beta-skill\ndescription: Fingerprint fixture B for solana wallet\n---\n\n# Beta\n",
    );
    const fp2 = await fingerprintSkills(tmp);
    await assert(fp2 !== fp1, "fingerprint changes when a skill is added");

    const { changed, fingerprint } = await hasSkillsChanged(tmp, fp1);
    await assert(changed === true, "hasSkillsChanged reports change");
    await assert(fingerprint === fp2, "hasSkillsChanged returns new fingerprint");

    const { changed: stable } = await hasSkillsChanged(tmp, fp2);
    await assert(stable === false, "stable tree is unchanged");

    ok("fingerprint/diff detects skill add");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function testListSkillSlugsAndDiff() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "skillhub-slugs-"));
  try {
    await mkdir(path.join(tmp, "nested", "leaf"), { recursive: true });
    await writeFile(
      path.join(tmp, "nested", "leaf", "SKILL.md"),
      "---\nname: leaf\ndescription: Nested leaf skill\n---\n\n# Leaf\n",
    );
    // Nested under a skill leaf must not create extra slugs (bundle dirs).
    await mkdir(path.join(tmp, "nested", "leaf", "references"), { recursive: true });
    await writeFile(path.join(tmp, "nested", "leaf", "references", "notes.md"), "notes\n");

    await mkdir(path.join(tmp, "solo"), { recursive: true });
    await writeFile(
      path.join(tmp, "solo", "SKILL.md"),
      "---\nname: solo\ndescription: Top-level solo skill\n---\n\n# Solo\n",
    );

    const slugs = await listSkillSlugs(tmp);
    await assert(slugs.includes("solo"), "discovers solo");
    await assert(slugs.includes("nested/leaf"), "discovers nested/leaf");
    await assert(!slugs.includes("nested/leaf/references"), "does not treat bundle subdir as skill");

    const before = ["solo"];
    const { added, removed } = diffSkillSlugs(before, slugs);
    await assert(added.includes("nested/leaf"), "diff reports added nested skill");
    await assert(removed.length === 0, "diff reports no removals");

    ok("listSkillSlugs + diffSkillSlugs match hub discovery rules");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function testReadmeCounterHelpers() {
  const n = 42;
  const { badge, installable } = formatReadmeSkillsCounterStrings(n);
  const fakeReadme = `${badge}\n\n${installable} — sample\n`;
  const counts = extractReadmeSkillsCounts(fakeReadme);
  await assert(counts.badgeCount === n, "badge count parsed");
  await assert(counts.installableCount === n, "installable count parsed");
  assertReadmeMatchesCatalog(fakeReadme, n);
  ok("README counter strings derive from catalog length");
}

/**
 * Real path: drop a skill under skills/, run processSkillsOnce, assert catalog
 * category + README counters. Cleans up the fixture skill and rebuilds.
 */
async function testProcessAddsSkillAndUpdatesReadme() {
  const baselineCatalog = JSON.parse(await readFile(path.join(ROOT, "catalog.json"), "utf8"));
  const baselineLen = baselineCatalog.length;
  const baselineReadme = await readFile(path.join(ROOT, "README.md"), "utf8");
  const baselineCounts = extractReadmeSkillsCounts(baselineReadme);

  await assert(
    baselineCounts.badgeCount === baselineLen && baselineCounts.installableCount === baselineLen,
    `precondition: README counters match catalog (${baselineLen})`,
  );

  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(
    path.join(FIXTURE_DIR, "SKILL.md"),
    [
      "---",
      `name: ${FIXTURE_SLUG}`,
      "description: Temporary solana wallet skill used to prove skills-process detect/scan/categorize and README counter updates.",
      "---",
      "",
      `# ${FIXTURE_SLUG}`,
      "",
      "Fixture skill for skills-process integration test. Safe to delete.",
      "",
    ].join("\n"),
  );

  try {
    const { state, catalog } = await processSkillsOnce({
      reason: "test-add-skill",
      root: ROOT,
      skillsRoot: SKILLS_ROOT,
    });

    await assert(state.totalSkills === baselineLen + 1, `catalog grew by 1 (${baselineLen} → ${state.totalSkills})`);

    const entry = catalog.find((s) => s.slug === FIXTURE_SLUG);
    await assert(entry, `catalog includes fixture slug ${FIXTURE_SLUG}`);
    await assert(
      typeof entry.category === "string" && entry.category.length > 0,
      "fixture has non-empty category",
    );
    // description mentions solana wallet → Solana / Blockchain
    await assert(
      entry.category === "Solana / Blockchain",
      `expected Solana / Blockchain, got ${entry.category}`,
    );

    const readmeAfter = await readFile(path.join(ROOT, "README.md"), "utf8");
    const afterCounts = extractReadmeSkillsCounts(readmeAfter);
    await assert(afterCounts.badgeCount === state.totalSkills, "badge updated to new count");
    await assert(
      afterCounts.installableCount === state.totalSkills,
      "installable line updated to new count",
    );
    assertReadmeMatchesCatalog(readmeAfter, catalog.length);

    // Scan must have included the new skill (all-local path)
    await assert(state.scan && Array.isArray(state.scan.skillSlugs), "scan summary present");
    await assert(
      state.scan.skillSlugs.includes(FIXTURE_SLUG),
      `scan results include ${FIXTURE_SLUG}`,
    );

    // Scan results file has severity/findings structure
    const scanResults = JSON.parse(
      await readFile(path.join(ROOT, "scanner", "results", "scan-results.json"), "utf8"),
    );
    const scanned = scanResults.skills.find((s) => s.slug === FIXTURE_SLUG);
    await assert(scanned, "scan-results.json contains fixture");
    await assert(scanned.findings !== undefined, "scan entry has findings");
    await assert(scanned.risk && scanned.risk.level, "scan entry has risk.level");

    ok("processSkillsOnce categorizes new skill, scans it, updates README counters");
  } finally {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
    // Restore catalog/README to baseline inventory so the tree stays clean.
    await processSkillsOnce({
      reason: "test-cleanup-restore",
      root: ROOT,
      skillsRoot: SKILLS_ROOT,
    });
    const restored = JSON.parse(await readFile(path.join(ROOT, "catalog.json"), "utf8"));
    await assert(
      !restored.some((s) => s.slug === FIXTURE_SLUG),
      "cleanup removed fixture from catalog",
    );
    await assert(
      restored.length === baselineLen,
      `cleanup restored catalog length ${baselineLen} (got ${restored.length})`,
    );
  }
}

async function testTwoStableProcessCycles() {
  const run1 = await processSkillsOnce({
    reason: "stable-run-1",
    root: ROOT,
    skillsRoot: SKILLS_ROOT,
  });
  const run2 = await processSkillsOnce({
    reason: "stable-run-2",
    root: ROOT,
    skillsRoot: SKILLS_ROOT,
  });

  await assert(run1.state.totalSkills === run2.state.totalSkills, "stable runs agree on catalog length");
  await assert(
    run1.fingerprintAfter === run2.fingerprintAfter,
    "stable tree fingerprint unchanged across consecutive process cycles",
  );
  await assert(run1.state.readmeBadgeMatchesCatalog === true, "run1 README matched");
  await assert(run2.state.readmeBadgeMatchesCatalog === true, "run2 README matched");

  ok("two consecutive process cycles are consistent on stable skills/");
}

async function main() {
  console.log("test-skills-process: driving real inventory + process path\n");

  // Unit-style (temp trees) first — fast feedback
  try {
    await testFingerprintDetectsAdd();
  } catch (e) {
    fail("fingerprint/diff detects skill add", e);
  }
  try {
    await testListSkillSlugsAndDiff();
  } catch (e) {
    fail("listSkillSlugs + diffSkillSlugs", e);
  }
  try {
    await testReadmeCounterHelpers();
  } catch (e) {
    fail("README counter helpers", e);
  }

  // Integration against real skills/ + build-catalog + scanner
  try {
    await testProcessAddsSkillAndUpdatesReadme();
  } catch (e) {
    fail("process adds skill + README", e);
    // Best-effort cleanup if fixture still present
    if (existsSync(FIXTURE_DIR)) {
      await rm(FIXTURE_DIR, { recursive: true, force: true }).catch(() => {});
      try {
        await processSkillsOnce({
          reason: "test-emergency-cleanup",
          root: ROOT,
          skillsRoot: SKILLS_ROOT,
        });
      } catch {
        /* ignore */
      }
    }
  }

  try {
    await testTwoStableProcessCycles();
  } catch (e) {
    fail("two stable process cycles", e);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll skills-process tests passed.");
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
