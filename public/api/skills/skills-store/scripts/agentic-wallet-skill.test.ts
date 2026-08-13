/**
 * Prove Coinbase agentic-wallet skill is on the real hub surfaces:
 * - skills/agentic-wallet (community collection)
 * - skills-store/agentic-wallet (curated store package)
 * - listStoreSkills() API listing
 * - imported-skills.json index
 *
 * Run: pnpm exec tsx skills-store/scripts/agentic-wallet-skill.test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listStoreSkills } from "../../server/routes/skills-store.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const communitySkillMd = join(repoRoot, "skills/agentic-wallet/SKILL.md");
const storeSkillMd = join(repoRoot, "skills-store/agentic-wallet/SKILL.md");
const importedPath = join(repoRoot, "skills-store/imported-skills.json");
const catalogPath = join(repoRoot, "skills-store/catalog.json");
const hubCatalogPath = join(repoRoot, "skills/catalog.json");

function mustExist(path: string, label: string) {
  if (!existsSync(path)) throw new Error(`missing ${label}: ${path}`);
}

function parseFrontmatter(markdown: string): Record<string, string> {
  if (!markdown.startsWith("---")) return {};
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return {};
  const attrs: Record<string, string> = {};
  for (const line of markdown.slice(3, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match || !match[2].trim() || [">", "|"].includes(match[2].trim())) continue;
    attrs[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return attrs;
}

// --- Filesystem packages ---
mustExist(communitySkillMd, "community agentic-wallet SKILL.md");
mustExist(storeSkillMd, "store agentic-wallet SKILL.md");
mustExist(join(repoRoot, "skills/agentic-wallet/references/auth.md"), "auth reference");
mustExist(join(repoRoot, "skills-store/agentic-wallet/references/auth.md"), "store auth reference");

const communityMd = readFileSync(communitySkillMd, "utf8");
const storeMd = readFileSync(storeSkillMd, "utf8");
const communityFm = parseFrontmatter(communityMd);
const storeFm = parseFrontmatter(storeMd);

if (!communityFm.name || communityFm.name !== "agentic-wallet") {
  throw new Error(`community frontmatter name invalid: ${JSON.stringify(communityFm.name)}`);
}
if (!communityFm.description || communityFm.description.length < 20) {
  throw new Error("community description missing/too short");
}
if (!storeFm.name || storeFm.name !== "agentic-wallet") {
  throw new Error(`store frontmatter name invalid: ${JSON.stringify(storeFm.name)}`);
}
if (!storeFm.description || storeFm.description.length < 20) {
  throw new Error("store description missing/too short");
}

// --- Command families agents must see (drive real skill markdown) ---
const bodies = [communityMd, storeMd, readFileSync(join(repoRoot, "skills/agentic-wallet/references/auth.md"), "utf8")];
const commandFamilies = [
  { label: "auth login", re: /awal(?:@[\d.]+)?\s+auth\s+login/i },
  { label: "auth verify", re: /awal(?:@[\d.]+)?\s+auth\s+verify/i },
  { label: "status", re: /awal(?:@[\d.]+)?\s+status/i },
];
for (const { label, re } of commandFamilies) {
  if (!bodies.some((b) => re.test(b))) {
    throw new Error(`command family missing from shipped skill content: ${label}`);
  }
}
// flowId documented for OTP completion path
if (!bodies.some((b) => /flowId|flow-id|flow id/i.test(b))) {
  throw new Error("skill content missing flowId documentation for OTP verify path");
}

// --- Curated store listing (same function the API uses) ---
const storeSkills = listStoreSkills();
const listed = storeSkills.find((s) => s.name === "agentic-wallet" || s.dirName === "agentic-wallet");
if (!listed) {
  throw new Error(
    `agentic-wallet missing from listStoreSkills(); got: ${storeSkills.map((s) => s.name).join(", ")}`,
  );
}
if (!listed.validation?.ok) {
  throw new Error(`agentic-wallet store validation not ok: ${JSON.stringify(listed.validation)}`);
}
if (!listed.skillMd || !/auth\s+login/i.test(listed.skillMd)) {
  throw new Error("listStoreSkills skillMd missing auth login guidance");
}
if (!listed.install?.local?.includes("skills-store/agentic-wallet")) {
  throw new Error(`install.local unexpected: ${listed.install?.local}`);
}

// --- Machine indexes ---
const imported = JSON.parse(readFileSync(importedPath, "utf8")) as {
  count: number;
  skills: Array<{ slug?: string; name?: string; path?: string }>;
};
if (!Array.isArray(imported.skills) || imported.count !== imported.skills.length) {
  throw new Error(`imported-skills.json incomplete: count=${imported.count}`);
}
const importedHit = imported.skills.find((s) => s.slug === "agentic-wallet");
if (!importedHit) {
  throw new Error("imported-skills.json missing slug agentic-wallet");
}
if (importedHit.path !== "skills/agentic-wallet") {
  throw new Error(`imported path unexpected: ${importedHit.path}`);
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
  skills: Array<{ name?: string; path?: string }>;
};
if (!catalog.skills.some((s) => s.name === "agentic-wallet" && s.path === "agentic-wallet")) {
  throw new Error("skills-store/catalog.json missing agentic-wallet entry");
}

const hubCatalog = JSON.parse(readFileSync(hubCatalogPath, "utf8")) as Array<{ slug?: string }>;
if (!Array.isArray(hubCatalog) || !hubCatalog.some((s) => s.slug === "agentic-wallet")) {
  throw new Error("skills/catalog.json missing agentic-wallet slug");
}

const out = {
  ok: true,
  community: { name: communityFm.name, descriptionLength: communityFm.description.length },
  store: {
    name: listed.name,
    dirName: listed.dirName,
    validation: listed.validation,
    install: listed.install,
    references: listed.references,
  },
  imported: importedHit,
  storeCatalogNames: catalog.skills.map((s) => s.name),
  listStoreCount: storeSkills.length,
};

console.log(JSON.stringify(out, null, 2));
console.log("agentic-wallet-skill.test.ts: ALL PASSED");
