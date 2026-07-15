#!/usr/bin/env node

/**
 * Skill Hub relay — rebuild catalog when skills change, optionally commit,
 * push, and re-anchor on-chain.
 *
 * Modes:
 *   node scripts/skill-relay.mjs              # one-shot rebuild + verify
 *   node scripts/skill-relay.mjs --watch      # poll skills/ and rebuild on change
 *   node scripts/skill-relay.mjs --fast       # light path: catalog + scan only (no smoke/install)
 *   node scripts/skill-relay.mjs --commit     # git add/commit generated artifacts
 *   node scripts/skill-relay.mjs --push       # git push after commit
 *   node scripts/skill-relay.mjs --onchain    # dry-run on-chain plan after build
 *   node scripts/skill-relay.mjs --onchain --execute [--devnet]
 *
 * After every catalog rebuild the relay also refreshes local on-chain surfaces:
 *   - onchain/agentregistry-mirror.json + public/api/agentregistry.json  (--plan-only)
 *   - onchain/public-ledger.json + public/api/submissions.json + onchain.json
 * so the hub never ships a stale 568-skill mirror after a 570-skill re-anchor.
 *
 * For immediate detect→scan→categorize→README without relay extras, prefer:
 *   npm run skills:process / npm run skills:watch  (scripts/skills-process.mjs)
 *
 * Env:
 *   SKILLHUB_RELAY_INTERVAL_MS  poll interval in watch mode (default 2000)
 *   SKILLHUB_RELAY_COMMIT_MSG   commit message template (default auto)
 *   SKILLHUB_RELAY_SKIP_ONCHAIN_SURFACES=1  skip mirror/ledger refresh (tests only)
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { fingerprintSkills } from "./lib/skills-inventory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SKILLS_ROOT = path.join(ROOT, "skills");
const STATE_PATH = path.join(ROOT, "onchain", "relay-state.json");

const args = process.argv.slice(2);
const WATCH = args.includes("--watch");
const FAST = args.includes("--fast");
const COMMIT = args.includes("--commit");
const PUSH = args.includes("--push");
const ONCHAIN = args.includes("--onchain");
const EXECUTE = args.includes("--execute");
const DEVNET = args.includes("--devnet");
const INTERVAL_MS = Number(process.env.SKILLHUB_RELAY_INTERVAL_MS || 2000);
const SKIP_ONCHAIN_SURFACES =
  args.includes("--skip-onchain-surfaces") ||
  process.env.SKILLHUB_RELAY_SKIP_ONCHAIN_SURFACES === "1";

const GENERATED_PATHS = [
  "catalog.json",
  "skills.sh.json",
  "HUB.md",
  "README.md",
  "assets/hub-banner.svg",
  "assets/chain-divider.svg",
  "public",
  "onchain/publish-plan.json",
  "onchain/publish-receipt.json",
  "onchain/relay-state.json",
  "onchain/skills-process-state.json",
  "onchain/agentregistry-mirror.json",
  "onchain/public-ledger.json",
];

async function main() {
  if (WATCH) {
    console.log(`Skill relay watching ${path.relative(ROOT, SKILLS_ROOT)} (every ${INTERVAL_MS}ms)`);
    let lastFingerprint = await fingerprintSkills(SKILLS_ROOT);
    // Always run once at start so catalog is current.
    await runPipeline({ reason: "startup" });
    lastFingerprint = await fingerprintSkills(SKILLS_ROOT);

    for (;;) {
      await sleep(INTERVAL_MS);
      const next = await fingerprintSkills(SKILLS_ROOT);
      if (next === lastFingerprint) continue;
      console.log(`\n[${ts()}] skills/ changed — rebuilding`);
      await runPipeline({ reason: "watch-change" });
      lastFingerprint = await fingerprintSkills(SKILLS_ROOT);
    }
  }

  await runPipeline({ reason: "one-shot" });
}

/**
 * Refresh git-safe on-chain surfaces so the static hub never serves a stale
 * agentregistry mirror / public ledger after catalog or anchor changes.
 * @param {{ root?: string, skip?: boolean }} [options]
 */
export async function refreshOnchainSurfaces(options = {}) {
  const root = options.root || ROOT;
  const skip = options.skip ?? SKIP_ONCHAIN_SURFACES;
  if (skip) {
    console.log(`[${ts()}] onchain surfaces: skipped`);
    return { skipped: true };
  }

  // Mirror plan is local-only (no arctl POST). Always keep counts/hashes current.
  await run("node", ["scripts/sync-onchain-agentregistry.mjs", "--plan-only"], root);
  // Redacted submissions ledger + /api/onchain.json + /api/submissions.json
  await run("node", ["scripts/export-public-ledger.mjs"], root);

  const registry = JSON.parse(
    await readFile(path.join(root, "public", ".well-known", "onchain-skill-registry.json"), "utf8"),
  );
  const mirror = JSON.parse(
    await readFile(path.join(root, "onchain", "agentregistry-mirror.json"), "utf8"),
  );
  const ledger = JSON.parse(
    await readFile(path.join(root, "onchain", "public-ledger.json"), "utf8"),
  );

  if (mirror.catalog?.merkleRoot !== registry.merkleRoot) {
    throw new Error(
      `agentregistry-mirror merkleRoot out of sync: ${mirror.catalog?.merkleRoot} !== ${registry.merkleRoot}`,
    );
  }
  if (Number(mirror.catalog?.totalSkills) !== Number(registry.totalSkills)) {
    throw new Error(
      `agentregistry-mirror totalSkills out of sync: ${mirror.catalog?.totalSkills} !== ${registry.totalSkills}`,
    );
  }
  if (Number(mirror.catalog?.selected) !== Number(registry.totalSkills)) {
    throw new Error(
      `agentregistry-mirror selected out of sync: ${mirror.catalog?.selected} !== ${registry.totalSkills}`,
    );
  }

  const receipt = existsSync(path.join(root, "onchain", "publish-receipt.json"))
    ? JSON.parse(await readFile(path.join(root, "onchain", "publish-receipt.json"), "utf8"))
    : null;
  if (receipt?.merkleRoot && ledger.catalogAnchor?.receipt?.merkleRoot !== receipt.merkleRoot) {
    throw new Error(
      `public-ledger catalogAnchor.receipt.merkleRoot out of sync with publish-receipt.json`,
    );
  }

  console.log(
    `[${ts()}] onchain surfaces: mirror ${mirror.catalog.selected}/${mirror.catalog.totalSkills} (${mirror.catalog.anchorStatus}), ledger submissions ${ledger.count}`,
  );
  return { skipped: false, mirror, ledger, registry };
}

async function runPipeline({ reason }) {
  const started = Date.now();
  console.log(`[${ts()}] relay start (${reason}${FAST ? ", fast" : ""})`);

  // Light/immediate path: categorize + README via catalog builder, then scan.
  if (FAST) {
    const { processSkillsOnce } = await import("./skills-process.mjs");
    const { state: processState } = await processSkillsOnce({
      reason: `relay-fast:${reason}`,
      root: ROOT,
      skillsRoot: SKILLS_ROOT,
    });

    if (ONCHAIN) {
      const onchainArgs = ["scripts/publish-onchain.mjs"];
      if (EXECUTE) onchainArgs.push("--execute");
      if (DEVNET) onchainArgs.push("--devnet");
      await run("node", onchainArgs);
    }

    const surfaces = await refreshOnchainSurfaces();

    const catalog = JSON.parse(await readFile(path.join(ROOT, "catalog.json"), "utf8"));
    const nvidiaCount = catalog.filter((s) => s.slug.startsWith("nvidia/")).length;
    let merkleRoot = null;
    let catalogHash = null;
    try {
      const registry = JSON.parse(
        await readFile(path.join(ROOT, "public", ".well-known", "onchain-skill-registry.json"), "utf8"),
      );
      merkleRoot = registry.merkleRoot;
      catalogHash = registry.catalogHash;
    } catch {
      // Registry may be mid-rebuild; not fatal for fast path.
    }

    const state = {
      schemaVersion: "skillhub-relay-state/v1",
      updatedAt: new Date().toISOString(),
      reason: `fast:${reason}`,
      totalSkills: catalog.length,
      nvidiaSkills: nvidiaCount,
      merkleRoot,
      catalogHash,
      process: processState,
      onchainSurfaces: surfaces.skipped
        ? { skipped: true }
        : {
            mirrorSelected: surfaces.mirror?.catalog?.selected ?? null,
            mirrorTotal: surfaces.mirror?.catalog?.totalSkills ?? null,
            anchorStatus: surfaces.mirror?.catalog?.anchorStatus ?? null,
            ledgerCount: surfaces.ledger?.count ?? null,
          },
      durationMs: Date.now() - started,
    };
    await mkdir(path.dirname(STATE_PATH), { recursive: true });
    await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
    console.log(`[${ts()}] catalog: ${state.totalSkills} skills (${state.nvidiaSkills} nvidia)`);
    if (state.merkleRoot) console.log(`[${ts()}] merkle : ${state.merkleRoot}`);
    console.log(`[${ts()}] state  : onchain/relay-state.json`);

    if (COMMIT) await gitCommit(state);
    if (PUSH) await run("git", ["push"]);
    console.log(`[${ts()}] relay done in ${state.durationMs}ms`);
    return;
  }

  await run("node", ["scripts/build-catalog.mjs"]);
  // Scan after catalog so new skills are in inventory and risk results stay current.
  await run("node", ["scanner/bin/scan-skills.mjs", "--all-local"]);
  await run("node", ["scripts/smoke-test-skills.mjs"]);

  // Sample install of a few NVIDIA skills into a temp root to prove installer paths.
  const sampleTarget = path.join(ROOT, ".relay-install-check");
  await run("node", [
    "bin/skills.mjs",
    "install",
    "nvidia/jetson-quick-start",
    "nvidia/cudaq-guide",
    "nvidia/deepstream-dev",
    "--force",
    "--target",
    sampleTarget,
  ]);

  if (ONCHAIN) {
    const onchainArgs = ["scripts/publish-onchain.mjs"];
    if (EXECUTE) onchainArgs.push("--execute");
    if (DEVNET) onchainArgs.push("--devnet");
    await run("node", onchainArgs);
  }

  // Keep agentregistry mirror + public ledger aligned with the rebuilt catalog/anchor.
  const surfaces = await refreshOnchainSurfaces();

  const catalog = JSON.parse(await readFile(path.join(ROOT, "catalog.json"), "utf8"));
  const nvidiaCount = catalog.filter((s) => s.slug.startsWith("nvidia/")).length;
  const registry = JSON.parse(
    await readFile(path.join(ROOT, "public", ".well-known", "onchain-skill-registry.json"), "utf8"),
  );

  const state = {
    schemaVersion: "skillhub-relay-state/v1",
    updatedAt: new Date().toISOString(),
    reason,
    totalSkills: catalog.length,
    nvidiaSkills: nvidiaCount,
    merkleRoot: registry.merkleRoot,
    catalogHash: registry.catalogHash,
    onchainSurfaces: surfaces.skipped
      ? { skipped: true }
      : {
          mirrorSelected: surfaces.mirror?.catalog?.selected ?? null,
          mirrorTotal: surfaces.mirror?.catalog?.totalSkills ?? null,
          anchorStatus: surfaces.mirror?.catalog?.anchorStatus ?? null,
          ledgerCount: surfaces.ledger?.count ?? null,
        },
    durationMs: Date.now() - started,
  };
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`[${ts()}] catalog: ${state.totalSkills} skills (${state.nvidiaSkills} nvidia)`);
  console.log(`[${ts()}] merkle : ${state.merkleRoot}`);
  console.log(`[${ts()}] state  : onchain/relay-state.json`);

  if (COMMIT) {
    await gitCommit(state);
  }
  if (PUSH) {
    await run("git", ["push"]);
  }

  console.log(`[${ts()}] relay done in ${state.durationMs}ms`);
}

async function gitCommit(state) {
  const status = await capture("git", ["status", "--porcelain", ...GENERATED_PATHS, "scripts", ".github"]);
  if (!status.trim()) {
    console.log(`[${ts()}] git: nothing to commit`);
    return;
  }

  await run("git", ["add", ...GENERATED_PATHS, "scripts/build-catalog.mjs", "scripts/skill-relay.mjs", "package.json", ".github/workflows/skill-relay.yml"].filter((p) => existsSync(path.join(ROOT, p))));

  const msg = process.env.SKILLHUB_RELAY_COMMIT_MSG
    || `chore(relay): rebuild catalog (${state.totalSkills} skills, ${state.nvidiaSkills} nvidia)`;

  // Avoid failing when hooks rewrite or when there's nothing staged after filter.
  const staged = await capture("git", ["diff", "--cached", "--name-only"]);
  if (!staged.trim()) {
    console.log(`[${ts()}] git: nothing staged after add`);
    return;
  }

  await run("git", ["commit", "-m", msg]);
  console.log(`[${ts()}] git: committed — ${msg}`);
}

function run(command, commandArgs, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${command} ${commandArgs.join(" ")}`);
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function capture(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${command} failed: ${err || out || code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ts() {
  return new Date().toISOString();
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}