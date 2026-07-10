#!/usr/bin/env node

/**
 * Sync Skill Hub on-chain proofs into a local agentregistry.
 *
 * Reads:
 *   public/.well-known/onchain-skill-registry.json   (per-skill bundleHash / merkleLeaf)
 *   onchain/publish-receipt.json                      (Arweave + Solana anchor, if any)
 *   onchain/publish-plan.json                         (latest plan fallback)
 *   catalog.json
 *
 * Writes:
 *   onchain/agentregistry-mirror.json                 (full proof map, git-safe)
 *   public/api/agentregistry.json                     (public mirror + how to import)
 *
 * Publishes each skill to agentregistry with:
 *   - websiteUrl  → hub verification.json
 *   - packages[]  → Arweave registry/catalog identifiers (when receipt exists)
 *   - version     → 1.0.0-onchain.<catalogHash8> so re-anchors can republish
 *
 * Usage:
 *   node scripts/sync-onchain-agentregistry.mjs
 *   node scripts/sync-onchain-agentregistry.mjs --dry-run
 *   node scripts/sync-onchain-agentregistry.mjs --limit 20 --prefix solana
 *   node scripts/sync-onchain-agentregistry.mjs --registry-url http://localhost:12121
 *   node scripts/sync-onchain-agentregistry.mjs --plan-only   # write mirror only, no POST
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ONCHAIN_DIR = path.join(ROOT, "onchain");
const REGISTRY_PATH = path.join(ROOT, "public", ".well-known", "onchain-skill-registry.json");
const CATALOG_PATH = path.join(ROOT, "catalog.json");
const RECEIPT_PATH = path.join(ONCHAIN_DIR, "publish-receipt.json");
const PLAN_PATH = path.join(ONCHAIN_DIR, "publish-plan.json");
const MIRROR_PATH = path.join(ONCHAIN_DIR, "agentregistry-mirror.json");
const PUBLIC_API_PATH = path.join(ROOT, "public", "api", "agentregistry.json");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PLAN_ONLY = args.includes("--plan-only");
const REGISTRY_URL = (
  flagValue("--registry-url") ||
  process.env.REGISTRY_URL ||
  process.env.ARCTL_API_BASE_URL ||
  "http://localhost:12121"
).replace(/\/$/, "");
const LIMIT = Number(flagValue("--limit") || 0);
const PREFIXES = multiFlag("--prefix");
const REPO_URL = process.env.REPO_URL || "https://github.com/Solizardking/skills";
const SITE_URL = process.env.SITE_URL || "https://skills.x402.wtf";

function flagValue(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

function multiFlag(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1]) out.push(args[++i]);
  }
  return out;
}

function dnsName(slug) {
  let name = String(slug).trim().toLowerCase().replaceAll("/", "-").replaceAll("_", "-");
  name = name.replace(/[^a-z0-9.-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  if (!name) name = "skill";
  if (!/^[a-z0-9]/.test(name)) name = `s-${name}`;
  if (!/[a-z0-9]$/.test(name)) name = `${name}0`;
  if (name.length > 63) {
    const digest = createHash("sha1").update(slug).digest("hex").slice(0, 8);
    name = `${name.slice(0, 54).replace(/[-.]+$/g, "")}-${digest}`;
  }
  return name;
}

function shortHash(h) {
  return String(h || "").replace(/^sha256-/, "").slice(0, 8) || "00000000";
}

function verificationUrl(slug) {
  // public API uses slug path segments as-is
  return `${SITE_URL}/api/skills/${slug}/verification.json`;
}

function skillPageUrl(slug) {
  return `${SITE_URL}/#/skill/${encodeURIComponent(slug)}`;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readJsonIfExists(file) {
  if (!existsSync(file)) return null;
  return readJson(file);
}

async function main() {
  if (!existsSync(REGISTRY_PATH)) {
    console.error("Missing on-chain registry. Run: npm run build:catalog");
    process.exit(1);
  }
  if (!existsSync(CATALOG_PATH)) {
    console.error("Missing catalog.json. Run: npm run build:catalog");
    process.exit(1);
  }

  const onchainRegistry = await readJson(REGISTRY_PATH);
  const catalog = await readJson(CATALOG_PATH);
  const receipt = await readJsonIfExists(RECEIPT_PATH);
  const plan = await readJsonIfExists(PLAN_PATH);

  const bySlug = new Map((onchainRegistry.skills || []).map((s) => [s.slug, s]));
  const catalogBySlug = new Map((Array.isArray(catalog) ? catalog : []).map((s) => [s.slug, s]));

  const catalogHash = onchainRegistry.catalogHash;
  const merkleRoot = onchainRegistry.merkleRoot;

  const arweave = (receipt?.arweave || []).map((e) => ({
    label: e.label,
    id: e.id,
    url: e.arweaveUrl || e.url || `https://arweave.net/${e.id}`,
  }));
  const arRegistry = arweave.find((e) => /registry/i.test(e.label));
  const arCatalog = arweave.find((e) => /catalog/i.test(e.label));

  const anchorStatus =
    receipt && receipt.merkleRoot === merkleRoot
      ? "anchored"
      : receipt
        ? "anchor-stale"
        : "unanchored";

  // Version encodes catalog + anchor so each re-anchor can republish cleanly.
  const version = [
    "1.0.0-onchain",
    shortHash(catalogHash),
    receipt?.solana?.signature ? shortHash(receipt.solana.signature) : "noanchor",
  ].join(".");

  let selected = [...bySlug.keys()].sort();
  if (PREFIXES.length) {
    selected = selected.filter((slug) =>
      PREFIXES.some(
        (p) => slug === p || slug.startsWith(`${p.replace(/\/$/, "")}/`) || slug.startsWith(p),
      ),
    );
  }
  if (LIMIT > 0) selected = selected.slice(0, LIMIT);

  // DNS name de-dupe
  const used = new Set();
  const entries = selected.map((slug) => {
    const proof = bySlug.get(slug);
    const cat = catalogBySlug.get(slug) || {};
    let name = dnsName(slug);
    if (used.has(name)) {
      const digest = createHash("sha1").update(slug).digest("hex").slice(0, 6);
      name = `${name.slice(0, 56)}-${digest}`;
    }
    used.add(name);

    const packages = [];
    if (arRegistry?.id) {
      packages.push({
        registryType: "arweave",
        identifier: `ar://${arRegistry.id}`,
        version,
        transport: { type: "http" },
      });
    }
    if (arCatalog?.id) {
      packages.push({
        registryType: "arweave",
        identifier: `ar://${arCatalog.id}#${slug}`,
        version,
        transport: { type: "http" },
      });
    }

    const descriptionBase = (proof.description || cat.description || `Skill: ${slug}`)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1800);

    const onchainLine = [
      `[onchain ${anchorStatus}]`,
      `leaf=${proof.merkleLeaf}`,
      `bundle=${proof.bundleHash}`,
      `root=${merkleRoot}`,
      receipt?.solana?.signature ? `sol=${receipt.solana.signature.slice(0, 16)}…` : null,
      arRegistry?.id ? `ar=${arRegistry.id.slice(0, 12)}…` : null,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      slug,
      name,
      title: proof.name || cat.name || slug.split("/").pop(),
      category: proof.category || cat.category || "Uncategorized",
      description: `${descriptionBase}\n\n${onchainLine}`.slice(0, 2500),
      version,
      websiteUrl: verificationUrl(slug),
      skillPageUrl: skillPageUrl(slug),
      repository: { url: REPO_URL, source: "github" },
      packages,
      onchain: {
        bundleHash: proof.bundleHash,
        merkleLeaf: proof.merkleLeaf,
        merkleRoot,
        catalogHash,
        fileCount: proof.fileCount,
        verificationUrl: verificationUrl(slug),
        anchorStatus,
        solana: receipt?.solana
          ? {
              signature: receipt.solana.signature,
              explorer: receipt.solana.explorer,
              cluster: receipt.cluster || receipt.solana.cluster,
            }
          : null,
        arweave,
      },
    };
  });

  const mirror = {
    schemaVersion: "skillhub-agentregistry-mirror/v1",
    generatedAt: new Date().toISOString(),
    hub: SITE_URL,
    repository: REPO_URL,
    agentregistry: {
      url: REGISTRY_URL,
      versionField: version,
      importCommand: "npm run publish:agentregistry:onchain",
    },
    catalog: {
      totalSkills: onchainRegistry.totalSkills,
      catalogHash,
      merkleRoot,
      selected: entries.length,
      anchorStatus,
    },
    anchor: {
      plan: plan
        ? {
            cluster: plan.cluster,
            merkleRoot: plan.merkleRoot,
            catalogHash: plan.catalogHash,
            totalSkills: plan.totalSkills,
            createdAt: plan.createdAt,
          }
        : null,
      receipt: receipt
        ? {
            cluster: receipt.cluster,
            merkleRoot: receipt.merkleRoot,
            catalogHash: receipt.catalogHash,
            totalSkills: receipt.totalSkills,
            publishedAt: receipt.publishedAt,
            solana: receipt.solana,
            arweave: receipt.arweave,
          }
        : null,
      note:
        anchorStatus === "anchor-stale"
          ? "Catalog hash moved since last Solana/Arweave anchor. Re-run: npm run publish:onchain -- --execute --devnet"
          : anchorStatus === "unanchored"
            ? "No publish-receipt.json yet. Run: npm run publish:onchain -- --execute --devnet"
            : "Receipt merkle matches current catalog root.",
    },
    skills: entries.map((e) => ({
      slug: e.slug,
      name: e.name,
      version: e.version,
      websiteUrl: e.websiteUrl,
      packages: e.packages,
      onchain: e.onchain,
    })),
  };

  await mkdir(ONCHAIN_DIR, { recursive: true });
  await mkdir(path.dirname(PUBLIC_API_PATH), { recursive: true });
  await writeFile(MIRROR_PATH, `${JSON.stringify(mirror, null, 2)}\n`);
  await writeFile(PUBLIC_API_PATH, `${JSON.stringify(mirror, null, 2)}\n`);

  console.log("Skill Hub → agentregistry on-chain sync");
  console.log(`  skills selected : ${entries.length} / ${onchainRegistry.totalSkills}`);
  console.log(`  merkle root     : ${merkleRoot}`);
  console.log(`  catalog hash    : ${catalogHash}`);
  console.log(`  anchor status   : ${anchorStatus}`);
  console.log(`  version         : ${version}`);
  console.log(`  registry        : ${REGISTRY_URL}`);
  console.log(`  mirror          : onchain/agentregistry-mirror.json`);
  console.log(`  public api      : public/api/agentregistry.json`);
  if (receipt?.solana?.explorer) {
    console.log(`  solana          : ${receipt.solana.explorer}`);
  }
  for (const a of arweave) {
    console.log(`  arweave         : ${a.label} → ${a.url}`);
  }

  if (PLAN_ONLY || DRY_RUN) {
    console.log(DRY_RUN || PLAN_ONLY ? "\nPlan only / dry-run — no registry writes." : "");
    if (DRY_RUN && entries[0]) {
      console.log("Sample payload:");
      console.log(
        JSON.stringify(
          {
            name: entries[0].name,
            version: entries[0].version,
            websiteUrl: entries[0].websiteUrl,
            packages: entries[0].packages,
            onchain: entries[0].onchain,
          },
          null,
          2,
        ),
      );
    }
    return;
  }

  // Health check
  try {
    const health = await fetch(`${REGISTRY_URL}/v0/skills?limit=1`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (error) {
    console.error(`\nERROR: agentregistry not reachable at ${REGISTRY_URL}`);
    console.error("  Start it with: arctl daemon start");
    console.error(`  (${error.message})`);
    process.exit(1);
  }

  let ok = 0;
  let skip = 0;
  let err = 0;

  for (const entry of entries) {
    const payload = {
      name: entry.name,
      version: entry.version,
      title: entry.title,
      description: entry.description,
      category: entry.category,
      repository: entry.repository,
      websiteUrl: entry.websiteUrl,
      packages: entry.packages,
    };

    process.stdout.write(`  ${entry.name.padEnd(50)} `);
    try {
      const res = await fetch(`${REGISTRY_URL}/v0/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.text();
      if (res.ok) {
        console.log("✓ onchain");
        ok += 1;
      } else if (
        res.status === 409 ||
        /duplicate version|already exists/i.test(body)
      ) {
        console.log("· exists");
        skip += 1;
        ok += 1;
      } else {
        let detail = body.slice(0, 160);
        try {
          const j = JSON.parse(body);
          detail = j.errors?.[0]?.message || j.detail || j.title || detail;
        } catch {
          /* keep */
        }
        console.log(`✗ HTTP ${res.status}: ${detail}`);
        err += 1;
      }
    } catch (error) {
      console.log(`✗ ${error.message}`);
      err += 1;
    }
  }

  // Also register a synthetic catalog-anchor skill that holds the root proof.
  const anchorPayload = {
    name: "skillhub-catalog-anchor",
    version,
    title: "Skill Hub Catalog Anchor",
    description: [
      "On-chain commitment for the entire Skill Hub catalog.",
      `merkleRoot=${merkleRoot}`,
      `catalogHash=${catalogHash}`,
      `skills=${onchainRegistry.totalSkills}`,
      `status=${anchorStatus}`,
      receipt?.solana?.explorer ? `explorer=${receipt.solana.explorer}` : "",
      arRegistry?.url ? `registryArweave=${arRegistry.url}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    category: "Utilities",
    repository: { url: REPO_URL, source: "github" },
    websiteUrl: `${SITE_URL}/.well-known/onchain-skill-registry.json`,
    packages: packagesForAnchor(arweave, version),
  };

  process.stdout.write(`  ${"skillhub-catalog-anchor".padEnd(50)} `);
  try {
    const res = await fetch(`${REGISTRY_URL}/v0/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(anchorPayload),
    });
    const body = await res.text();
    if (res.ok) {
      console.log("✓ anchor");
      ok += 1;
    } else if (res.status === 409 || /duplicate version|already exists/i.test(body)) {
      console.log("· exists");
      skip += 1;
      ok += 1;
    } else {
      console.log(`✗ HTTP ${res.status}`);
      err += 1;
    }
  } catch (error) {
    console.log(`✗ ${error.message}`);
    err += 1;
  }

  console.log("\n=== Summary ===");
  console.log(`  Selected: ${entries.length}`);
  console.log(`  OK:       ${ok}`);
  console.log(`  Skipped:  ${skip}`);
  console.log(`  Error:    ${err}`);
  console.log(`  UI:       ${REGISTRY_URL}`);
  console.log(`  Mirror:   ${MIRROR_PATH}`);

  if (anchorStatus !== "anchored") {
    console.log(`\nNext (real chain):`);
    console.log(`  npm run publish:onchain -- --execute --devnet`);
    console.log(`  npm run publish:agentregistry:onchain`);
  }

  if (err > 0) process.exit(1);
}

function packagesForAnchor(arweave, version) {
  return arweave.map((e) => ({
    registryType: "arweave",
    identifier: `ar://${e.id}`,
    version,
    transport: { type: "http" },
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
