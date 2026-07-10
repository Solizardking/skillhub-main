#!/usr/bin/env node
/**
 * Exercises the real published layout: npm pack → extract → run shipped CLI.
 * Proves catalog.json + skills/ + bin resolve after packaging (not only in git).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRATCH =
  process.env.SKILLHUB_PACK_SCRATCH ||
  path.join(os.tmpdir(), "skillhub-npm-pack-test");

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

async function main() {
  mkdirSync(SCRATCH, { recursive: true });
  const work = path.join(SCRATCH, `pack-test-${Date.now()}`);
  mkdirSync(work, { recursive: true });

  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  log(`package: ${pkg.name}@${pkg.version}`);
  log(`bin.skills: ${pkg.bin?.skills}`);
  assert(pkg.bin?.skills, "package.json must declare bin.skills");
  assert(Array.isArray(pkg.files) && pkg.files.includes("catalog.json"), "files must include catalog.json");
  assert(pkg.files.includes("skills") || pkg.files.includes("skills/"), "files must include skills");
  assert(pkg.files.includes("bin") || pkg.files.includes("bin/"), "files must include bin");
  assert(
    !pkg.dependencies || Object.keys(pkg.dependencies).length === 0 || !pkg.dependencies["@irys/upload"],
    "published CLI must not require @irys/upload as a runtime dependency",
  );

  // Pack from repo root (do not use --json: prepack lifecycle logs pollute stdout)
  const packLog = path.join(work, "npm-pack.log");
  let packOut;
  try {
    packOut = execFileSync("npm", ["pack", "--pack-destination", work], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false" },
    });
  } catch (err) {
    writeFileSync(packLog, String(err.stdout || "") + String(err.stderr || err.message));
    fail(`npm pack failed: ${err.message}`);
  }
  writeFileSync(packLog, packOut);
  // npm pack prints the tarball filename as the last non-empty line
  const packLines = packOut
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tarballName = packLines.reverse().find((l) => l.endsWith(".tgz"));
  assert(tarballName, `npm pack must print .tgz filename; got:\n${packOut.slice(-500)}`);
  const tarballPath = path.isAbsolute(tarballName) ? tarballName : path.join(work, path.basename(tarballName));
  assert(existsSync(tarballPath), `tarball missing: ${tarballPath}`);
  const tarballSize = statSync(tarballPath).size;
  log(`tarball: ${tarballName} (${(tarballSize / 1024 / 1024).toFixed(2)} MB)`);
  // npm soft limit ~100MB compressed; hard rejections often around that
  assert(tarballSize < 100 * 1024 * 1024, `tarball too large for npm: ${tarballSize} bytes`);

  // List contents via tar -tzf (portable) then extract
  const listProc = spawnSync("tar", ["-tzf", tarballPath], { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 });
  assert(listProc.status === 0, `tar -tzf failed: ${listProc.stderr}`);
  const listing = listProc.stdout.split("\n").filter(Boolean);
  writeFileSync(path.join(work, "pack-list.txt"), listing.join("\n") + "\n");

  const hasBin = listing.some((p) => p.endsWith("bin/skills.mjs") || p === "package/bin/skills.mjs");
  const hasCatalog = listing.some((p) => p.endsWith("catalog.json"));
  const hasSkills = listing.some((p) => /\/skills\/[^/]+\/SKILL\.md$/.test(p) || /skills\/[^/]+\/SKILL\.md$/.test(p));
  const hasTarget = listing.some((p) => p.includes("/target/") || p.includes("skills/solana-formal-verification/target"));
  const hasRootNodeModules = listing.some((p) => p.includes("package/node_modules/") || p.startsWith("node_modules/"));

  assert(hasBin, "pack must include bin/skills.mjs");
  assert(hasCatalog, "pack must include catalog.json");
  assert(hasSkills, "pack must include skill sources (SKILL.md)");
  assert(!hasTarget, "pack must NOT include skills/**/target build dirs");
  assert(!hasRootNodeModules, "pack must NOT include root node_modules");

  // Extract and install as a local package into a clean consumer dir
  const extractDir = path.join(work, "extract");
  mkdirSync(extractDir, { recursive: true });
  const extractProc = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDir], { encoding: "utf8" });
  assert(extractProc.status === 0, `tar extract failed: ${extractProc.stderr}`);

  const pkgRoot = path.join(extractDir, "package");
  assert(existsSync(path.join(pkgRoot, "bin", "skills.mjs")), "extracted bin/skills.mjs missing");
  assert(existsSync(path.join(pkgRoot, "catalog.json")), "extracted catalog.json missing");

  const cli = path.join(pkgRoot, "bin", "skills.mjs");
  const list1 = spawnSync(process.execPath, [cli, "list", "--json"], {
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
    cwd: pkgRoot,
  });
  assert(list1.status === 0, `skills list --json failed (1): ${list1.stderr}`);
  const list2 = spawnSync(process.execPath, [cli, "list", "--json"], {
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
    cwd: pkgRoot,
  });
  assert(list2.status === 0, `skills list --json failed (2): ${list2.stderr}`);

  writeFileSync(path.join(work, "cli-list-1.json"), list1.stdout);
  writeFileSync(path.join(work, "cli-list-2.json"), list2.stdout);

  let catalog1;
  let catalog2;
  try {
    catalog1 = JSON.parse(list1.stdout);
    catalog2 = JSON.parse(list2.stdout);
  } catch (e) {
    fail(`list output is not JSON: ${e.message}`);
  }
  assert(Array.isArray(catalog1) && catalog1.length > 0, "list must return non-empty skill array");
  assert(catalog1.every((s) => s && typeof s.slug === "string" && s.slug.length > 0), "each skill needs slug");
  assert(catalog1.length === catalog2.length, "two list runs must return same length");
  assert(catalog1[0].slug === catalog2[0].slug, "two list runs must return same primary content");

  // Install a small known skill into a temp target
  const small =
    catalog1.find((s) => s.slug === "find-skills") ||
    catalog1.find((s) => s.slug === "bird") ||
    catalog1[0];
  const installTarget = path.join(work, "install-target");
  mkdirSync(installTarget, { recursive: true });
  const install = spawnSync(
    process.execPath,
    [cli, "install", small.slug, "--force", "--target", installTarget],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, cwd: pkgRoot },
  );
  writeFileSync(path.join(work, "cli-install.log"), (install.stdout || "") + (install.stderr || ""));
  assert(install.status === 0, `install ${small.slug} failed: ${install.stderr}`);
  const skillMd = path.join(installTarget, small.slug, "SKILL.md");
  assert(existsSync(skillMd), `installed skill missing SKILL.md at ${skillMd}`);

  // Also prove npm install of the tarball works (bin link path)
  const consumer = path.join(work, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({ name: "skillhub-pack-consumer", private: true, type: "module" }, null, 2),
  );
  const npmInstall = spawnSync("npm", ["install", tarballPath, "--no-fund", "--no-audit"], {
    encoding: "utf8",
    cwd: consumer,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert(npmInstall.status === 0, `npm install tarball failed: ${npmInstall.stderr}`);
  const binPath = path.join(consumer, "node_modules", ".bin", "skills");
  assert(existsSync(binPath), "npm install must create .bin/skills");
  const consumerList = spawnSync(binPath, ["list", "--json"], {
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
    cwd: consumer,
  });
  assert(consumerList.status === 0, `consumer skills list failed: ${consumerList.stderr}`);
  const consumerCatalog = JSON.parse(consumerList.stdout);
  assert(Array.isArray(consumerCatalog) && consumerCatalog.length === catalog1.length, "consumer list length mismatch");

  writeFileSync(
    path.join(work, "summary.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        tarball: tarballName,
        tarballBytes: tarballSize,
        skillCount: catalog1.length,
        installedSkill: small.slug,
        work,
      },
      null,
      2,
    ),
  );

  log(`OK pack test: ${catalog1.length} skills, installed ${small.slug}, work=${work}`);
  // Keep artifacts for goal verification (do not rm work)
  process.stdout.write(JSON.stringify({ ok: true, work, skillCount: catalog1.length, tarball: tarballPath }) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
