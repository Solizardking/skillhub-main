#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHECK = process.argv.includes("--check");
const SITE_URL = "https://skills.onchainai.fund";

const CATEGORY_ORDER = [
  "Dev Tools / Agents",
  "Google / Ads",
  "Google / Analytics",
  "Google / Cloud",
  "Local / Web Services",
  "Media / Devices",
  "Productivity / Messaging",
  "Solana / Blockchain",
  "Utilities",
];

const IGNORED_TOP_LEVEL_DIRS = new Set([
  ".git",
  ".vercel",
  "assets",
  "bin",
  "node_modules",
  "onchain",
  "public",
  "scripts",
]);

const IGNORED_NESTED_DIRS = new Set([
  ".git",
  ".lake",
  ".vercel",
  "node_modules",
  "target",
]);

const PUBLIC_RESOURCE_DIRS = ["references", "scripts", "assets", "agents"];
const PUBLIC_ROOT_RESOURCE_EXTENSIONS = new Set([".md", ".json", ".yaml", ".yml"]);
const PUBLIC_COPY_EXCLUDES = new Set([".DS_Store", ".git", "node_modules"]);
const CATEGORY_OVERRIDES = new Map([
  ["ask-mcp", "Solana / Blockchain"],
  ["compressed-pda", "Solana / Blockchain"],
  ["compressed-token", "Solana / Blockchain"],
  ["solana-redpill-verifier", "Solana / Blockchain"],
  ["solana-rent-free-dev", "Solana / Blockchain"],
  ["testing", "Solana / Blockchain"],
  ["zk", "Solana / Blockchain"],
  ["zkrouter", "Solana / Blockchain"],
]);

async function main() {
  const existingCategories = await readExistingCategories();
  const skills = await readSkills(existingCategories);
  const outputs = await buildOutputs(skills);

  if (CHECK) {
    await checkOutputs(outputs);
    return;
  }

  await writeOutputs(outputs);
  console.log(`Generated ${skills.length} skills in catalog.json, README.md, and public/.`);
}

async function readExistingCategories() {
  const catalogPath = path.join(ROOT, "catalog.json");
  try {
    const raw = await readFile(catalogPath, "utf8");
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries.map((entry) => [entry.slug, entry.category]).filter(([slug, category]) => slug && category));
  } catch {
    return new Map();
  }
}

async function readSkills(existingCategories) {
  const skills = [];

  await collectSkills(ROOT, [], existingCategories, skills);

  skills.sort((a, b) => {
    const categoryDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.slug.localeCompare(b.slug);
  });

  return skills;
}

async function collectSkills(directory, segments, existingCategories, skills) {
  const skillPath = path.join(directory, "SKILL.md");
  if (segments.length > 0 && existsSync(skillPath)) {
    const content = await readFile(skillPath, "utf8");
    const frontmatter = parseFrontmatter(content);
    const slug = segments.join("/");
    const name = normalizeText(frontmatter.name) || slug;
    const description = normalizeText(frontmatter.description) || fallbackDescription(content);
    const category = categorize({ slug, name, description }, existingCategories);

    skills.push({
      slug,
      name,
      description,
      category,
      skillPath,
      content,
    });
  }

  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (segments.length === 0 && IGNORED_TOP_LEVEL_DIRS.has(entry.name)) continue;
    if (segments.length > 0 && IGNORED_NESTED_DIRS.has(entry.name)) continue;

    await collectSkills(path.join(directory, entry.name), [...segments, entry.name], existingCategories, skills);
  }
}

function parseFrontmatter(content) {
  if (!content.startsWith("---")) return {};

  const end = content.indexOf("\n---", 3);
  if (end === -1) return {};

  const yaml = content.slice(3, end).replace(/^\r?\n/, "");
  const fields = {};
  const lines = yaml.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(lines[i]);
    if (!match) continue;

    const [, key, rawValue = ""] = match;
    const blockStyle = rawValue.trim();
    if (/^[>|][+-]?$/.test(blockStyle)) {
      const folded = blockStyle.startsWith(">");
      const block = [];
      while (i + 1 < lines.length && /^(?:\s{2,}|\t)/.test(lines[i + 1])) {
        i += 1;
        block.push(lines[i].trim());
      }
      fields[key] = block.join(folded ? " " : "\n");
      continue;
    }

    let scalar = parseScalar(rawValue);
    if (rawValue.trim()) {
      const continuation = [];
      while (i + 1 < lines.length && /^(?:\s{2,}|\t)/.test(lines[i + 1])) {
        i += 1;
        continuation.push(lines[i].trim());
      }
      if (continuation.length > 0) {
        scalar = [scalar, ...continuation].join(" ");
      }
    }

    fields[key] = scalar;
  }

  return fields;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const quote = trimmed[0];
  if ((quote === `"` || quote === `'`) && trimmed.endsWith(quote)) {
    const inner = trimmed.slice(1, -1);
    return quote === `"` ? inner.replace(/\\"/g, `"`) : inner.replace(/''/g, "'");
  }

  return trimmed;
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function fallbackDescription(content) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  return heading ? normalizeText(heading) : "Agent skill.";
}

function categorize(skill, existingCategories) {
  if (CATEGORY_OVERRIDES.has(skill.slug)) {
    return CATEGORY_OVERRIDES.get(skill.slug);
  }

  if (existingCategories.has(skill.slug)) {
    return existingCategories.get(skill.slug);
  }

  if (skill.slug.startsWith("google/ads/")) {
    return "Google / Ads";
  }

  if (skill.slug.startsWith("google/analytics/")) {
    return "Google / Analytics";
  }

  if (skill.slug.startsWith("google/cloud/")) {
    return "Google / Cloud";
  }

  const text = `${skill.slug} ${skill.name} ${skill.description}`.toLowerCase();

  if (/\b(solana|anchor|pinocchio|codama|litesvm|mollusk|surfpool|magicblock|wallet|token|crypto|blockchain|dflow|kalshi|phantom|dex|pump|clawd|vulcan|imperial|phoenix|perp|tee|zk|gateway|swarm|light protocol|zkcompression|compressed)\b/.test(text)) {
    return "Solana / Blockchain";
  }

  if (/\b(audio|image|images|pdf|video|camera|frames|gif|tts|speech|transcribe|whisper|hue|sonos|spotify|canvas)\b/.test(text)) {
    return "Media / Devices";
  }

  if (/\b(notes|reminders|message|messaging|email|gmail|calendar|slack|discord|whatsapp|imessage|notion|obsidian|trello|things|workspace|contacts)\b/.test(text)) {
    return "Productivity / Messaging";
  }

  if (/\b(food|order|places|weather|local|web service|restaurant|forecast)\b/.test(text)) {
    return "Local / Web Services";
  }

  if (/\b(github|agent|agents|mcp|cli|tmux|session|skill|code|codex|claude|oracle|clawdhub|mcporter)\b/.test(text)) {
    return "Dev Tools / Agents";
  }

  return "Utilities";
}

async function buildOutputs(skills) {
  const publicFiles = await renderPublic(skills);
  const catalog = skills.map(({ slug, name, description, category }) => ({ slug, name, description, category }));
  const outputs = new Map();

  outputs.set("catalog.json", `${JSON.stringify(catalog, null, 2)}\n`);
  outputs.set("skills.sh.json", renderSkillsShConfig(catalog));
  outputs.set("README.md", renderReadme(catalog));
  outputs.set("assets/hub-banner.svg", renderHeroBanner(catalog));
  outputs.set("assets/chain-divider.svg", renderChainDivider());
  outputs.set(path.join("public", "assets", "hub-banner.svg"), renderHeroBanner(catalog));
  outputs.set(path.join("public", "assets", "chain-divider.svg"), renderChainDivider());

  for (const [file, content] of publicFiles) {
    outputs.set(path.join("public", file), content);
  }

  return outputs;
}

async function renderPublic(skills) {
  const files = new Map();
  const catalog = skills.map(({ slug, name, description, category }) => ({ slug, name, description, category }));
  const catalogJson = `${JSON.stringify(catalog, null, 2)}\n`;

  files.set("catalog.json", catalogJson);
  files.set("api/skills.json", catalogJson);
  files.set("api/skills/index.json", catalogJson);
  files.set("CNAME", `${new URL(SITE_URL).hostname}\n`);
  files.set("robots.txt", "User-agent: *\nAllow: /\n");
  files.set("sitemap.xml", renderSitemap(catalog));
  files.set(".nojekyll", "");
  files.set("favicon.svg", renderFavicon());
  files.set("index.html", renderIndexHtml(catalog));
  files.set("skills/index.html", renderIndexHtml(catalog));

  const verifications = [];

  for (const skill of skills) {
    const metadata = {
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      skill: `/api/skills/${skill.slug}/SKILL.md`,
    };
    files.set(`api/skills/${skill.slug}/metadata.json`, `${JSON.stringify(metadata, null, 2)}\n`);
    files.set(`api/skills/${skill.slug}/SKILL.md`, skill.content);
    await addPublicResources(files, skill);

    const verification = renderSkillVerification(skill, getSkillBundleFiles(files, skill.slug));
    files.set(`api/skills/${skill.slug}/verification.json`, `${JSON.stringify(verification, null, 2)}\n`);
    verifications.push({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      bundleHash: verification.bundleHash,
      merkleLeaf: verification.merkleLeaf,
      fileCount: verification.files.length,
      metadata: `/api/skills/${skill.slug}/metadata.json`,
      verification: `/api/skills/${skill.slug}/verification.json`,
    });
  }

  const registry = renderOnchainRegistry(catalog, verifications);
  files.set("api/verification.json", `${JSON.stringify(registry, null, 2)}\n`);
  files.set(".well-known/onchain-skill-registry.json", `${JSON.stringify(registry, null, 2)}\n`);
  files.set("api/site.json", `${JSON.stringify(renderSiteManifest(catalog, registry), null, 2)}\n`);
  files.set(".well-known/skills-hub.json", `${JSON.stringify(renderSiteManifest(catalog, registry), null, 2)}\n`);

  return files;
}

async function addPublicResources(files, skill) {
  await addPublicRootResources(files, skill);

  for (const resourceDir of PUBLIC_RESOURCE_DIRS) {
    const absoluteDir = path.join(ROOT, skill.slug, resourceDir);
    if (!existsSync(absoluteDir)) continue;
    await addPublicResourceDir(files, absoluteDir, `api/skills/${skill.slug}/${resourceDir}`);
  }
}

async function addPublicRootResources(files, skill) {
  const skillDir = path.join(ROOT, skill.slug);
  const entries = await readdir(skillDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "SKILL.md") continue;
    if (entry.name === "metadata.json" || entry.name === "verification.json") continue;
    if (entry.name.startsWith(".") || PUBLIC_COPY_EXCLUDES.has(entry.name)) continue;
    if (!PUBLIC_ROOT_RESOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    files.set(`api/skills/${skill.slug}/${entry.name}`, await readFile(path.join(skillDir, entry.name)));
  }
}

async function addPublicResourceDir(files, absoluteDir, publicDir) {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.name.startsWith(".") || PUBLIC_COPY_EXCLUDES.has(entry.name)) continue;

    const absolutePath = path.join(absoluteDir, entry.name);
    const publicPath = `${publicDir}/${entry.name}`;

    if (entry.isDirectory()) {
      await addPublicResourceDir(files, absolutePath, publicPath);
    } else if (entry.isFile()) {
      files.set(publicPath, await readFile(absolutePath));
    }
  }
}

const CATEGORY_META = {
  "Dev Tools / Agents": { emoji: "🛠️", tagline: "Build, orchestrate, and ship with agent tooling", anchor: "️-dev-tools--agents" },
  "Google / Ads": { emoji: "📣", tagline: "Google Ads APIs, campaigns, and reporting", anchor: "-google--ads" },
  "Google / Analytics": { emoji: "📈", tagline: "GA4 data APIs and measurement", anchor: "-google--analytics" },
  "Google / Cloud": { emoji: "☁️", tagline: "GCP, GKE, BigQuery, Vertex, and friends", anchor: "️-google--cloud" },
  "Local / Web Services": { emoji: "📍", tagline: "Weather, places, food, and everyday web services", anchor: "-local--web-services" },
  "Media / Devices": { emoji: "🎬", tagline: "Audio, video, images, TTS, cameras, and gadgets", anchor: "-media--devices" },
  "Productivity / Messaging": { emoji: "💬", tagline: "Notes, tasks, chat, and mail on autopilot", anchor: "-productivity--messaging" },
  "Solana / Blockchain": { emoji: "🟣", tagline: "The deep end: DeFi, perps, tokens, ZK, and on-chain agents", anchor: "-solana--blockchain" },
  "Utilities": { emoji: "🧰", tagline: "Handy one-off power tools", anchor: "-utilities" },
};

function categoryMeta(category) {
  return CATEGORY_META[category] || { emoji: "✨", tagline: "More playbooks", anchor: category.toLowerCase().replace(/[^a-z0-9]+/g, "-") };
}

function meterBar(count, max, width = 18) {
  const filled = Math.max(1, Math.round((count / max) * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function renderReadme(catalog) {
  const byCategory = groupByCategory(catalog);
  const maxCount = Math.max(...byCategory.map(([, skills]) => skills.length));
  const featuredRuns = [
    ["🌞 Helius mode", "Helius infra: Sender, DAS, LaserStream + Jupiter, DFlow, OKX, Phantom, SVM internals", catalog.filter((skill) => skill.slug.startsWith("helius-skills/"))],
    ["🎰 Pump.fun mode", "launch → curve → fees → security, the whole token lifecycle", catalog.filter((skill) => skill.slug === "pumpfun" || skill.slug.startsWith("pump-") || skill.slug.startsWith("pumpfun-"))],
    ["🌋 Vulcan / Phoenix mode", "perps trading: TA, grids, TWAP, TP/SL, risk", catalog.filter((skill) => skill.slug === "vulcan" || skill.slug.startsWith("vulcan-"))],
    ["👑 Imperial mode", "the imperial trading deck: execution, margin, portfolio intel", catalog.filter((skill) => skill.slug === "imperial" || skill.slug.startsWith("imperial-"))],
    ["🎲 DFlow / Kalshi mode", "prediction markets: scan, trade, portfolio, KYC", catalog.filter((skill) => skill.slug.startsWith("dflow-"))],
    ["🗜️ ZK compression mode", "Light Protocol: compressed tokens + PDAs, ~400x cheaper", catalog.filter((skill) => ["ask-mcp", "compressed-pda", "compressed-token", "zk", "zkrouter", "solana-rent-free-dev", "solana-redpill-verifier"].includes(skill.slug))],
  ];

  const lines = [
    '<div align="center">',
    "",
    '<img src="./assets/hub-banner.svg" alt="Skill Hub — an animated constellation of agent skills" width="100%" />',
    "",
    `[![skills.sh](https://skills.sh/b/Solizardking/skills)](https://skills.sh/Solizardking/skills)`,
    `![Skills](https://img.shields.io/badge/skills-${catalog.length}-8A2BE2?style=flat-square) ![Categories](https://img.shields.io/badge/categories-${byCategory.length}-00C2FF?style=flat-square) ![Verified](https://img.shields.io/badge/merkle-verified-14F195?style=flat-square) ![Arweave](https://img.shields.io/badge/arweave-permanent-222222?style=flat-square) ![Solana](https://img.shields.io/badge/solana-anchored-9945FF?style=flat-square)`,
    "",
    `**${catalog.length} installable agent skills.** Every one is a \`SKILL.md\` playbook your agent can pull off the shelf —`,
    "hashed, Merkle-rooted, and ready to be pinned to Arweave and anchored on Solana.",
    "",
    "*Pick a cabinet. Pull the lever. The right playbook lights up.* 🕹️",
    "",
    "</div>",
    "",
    "---",
    "",
    "## 🗺️ Choose Your Quest",
    "",
    "Nine zones. Every skill lives in exactly one. Click a zone to jump to its catalog.",
    "",
    "| Zone | Skills | Power level | What lives here |",
    "|---|---:|---|---|",
  ];

  for (const [category, skills] of byCategory) {
    const meta = categoryMeta(category);
    lines.push(`| [${meta.emoji} **${category}**](#${meta.anchor}) | ${skills.length} | \`${meterBar(skills.length, maxCount)}\` | ${meta.tagline} |`);
  }

  lines.push(
    "",
    "## 🚀 Install in 10 Seconds",
    "",
    "The whole hub:",
    "",
    "```bash",
    "npx skills add Solizardking/skills        # via skills.sh",
    "npx github:Solizardking/skills install    # straight from GitHub",
    "```",
    "",
    "Or grab a focused stack:",
    "",
    "```bash",
    "# Solana dev core",
    "npx github:Solizardking/skills install solana-dev solana-formal-verification magicblock",
    "",
    "# Pump.fun token lifecycle",
    "npx github:Solizardking/skills install pumpfun pump-token-lifecycle pump-bonding-curve pump-security",
    "",
    "# ZK compression lane",
    "npx github:Solizardking/skills install compressed-pda compressed-token zk zkrouter",
    "",
    "# Google Cloud starter",
    "npx github:Solizardking/skills install google/cloud/gcloud google/cloud/gke-basics google/cloud/bigquery-basics",
    "```",
    "",
    "Point it at any agent skill root:",
    "",
    "```bash",
    "npx github:Solizardking/skills install --target ~/.codex/skills   # Codex",
    "npx github:Solizardking/skills install --claude                   # Claude Code",
    "npx github:Solizardking/skills install --eve                      # eve (agent/skills/)",
    "```",
    "",
    "## 🌟 Featured Runs",
    "",
    "Curated multi-skill loadouts — install a run and your agent speaks the whole dialect:",
    "",
  );

  for (const [label, blurb, skills] of featuredRuns) {
    if (!skills.length) continue;
    lines.push(
      "<details>",
      `<summary><strong>${label}</strong> — ${blurb} <em>(${skills.length} skills)</em></summary>`,
      "",
      skills.map((skill) => markdownSkillLink(skill)).join(" · "),
      "",
      "</details>",
      "",
    );
  }

  lines.push(
    "## 📚 The Full Catalog",
    "",
    "Every skill, every zone. Click a zone to expand it — descriptions keep the exact trigger text agents match on.",
  );

  for (const [category, skills] of byCategory) {
    const meta = categoryMeta(category);
    lines.push(
      "",
      `### ${meta.emoji} ${category}`,
      "",
      `> ${meta.tagline} — **${skills.length} skills**`,
      "",
      "<details>",
      `<summary>Open the ${category} cabinet</summary>`,
      "",
      "| Skill | Name | Description |",
      "|---|---|---|",
    );
    for (const skill of skills) {
      lines.push(`| ${markdownSkillLink(skill)} | ${escapeTable(skill.name)} | ${escapeTable(skill.description)} |`);
    }
    lines.push("", "</details>");
  }

  lines.push(
    "",
    '<div align="center">',
    "",
    '<img src="./assets/chain-divider.svg" alt="" width="100%" />',
    "",
    "</div>",
    "",
    "## ⛓️ On-Chain: Arweave × Solana",
    "",
    "This hub doesn't just live on GitHub — every build is designed to be **permanent and verifiable**:",
    "",
    "1. **Hash** — every skill bundle gets a SHA-256 `bundleHash`; all leaves roll up into one Merkle root in [`.well-known/onchain-skill-registry.json`](./public/.well-known/onchain-skill-registry.json).",
    "2. **Pin** — `npm run publish:onchain` uploads the registry + catalog to **Arweave** (paid in SOL via Irys), so the catalog can never be memory-holed.",
    "3. **Anchor** — the same command writes a **Solana memo transaction** carrying the Merkle root and the Arweave tx IDs, timestamping the whole catalog on SVM.",
    "",
    "```bash",
    "npm run build:catalog          # regenerate catalog + hashes + merkle root",
    "npm run publish:onchain        # dry-run: shows the plan, costs, and memo payload",
    "npm run publish:onchain -- --execute   # uploads to Arweave + anchors on Solana",
    "```",
    "",
    "Verify any skill later: fetch its `verification.json`, re-hash the bundle, check the leaf against the anchored root. See [ONCHAIN.md](./ONCHAIN.md) for the full protocol.",
    "",
    "| Artifact | Where |",
    "|---|---|",
    `| Catalog JSON | [\`catalog.json\`](./catalog.json) · ${SITE_URL}/api/skills.json |`,
    `| Merkle registry | [\`.well-known/onchain-skill-registry.json\`](./public/.well-known/onchain-skill-registry.json) |`,
    `| Per-skill proof | ${SITE_URL}/api/skills/solana-dev/verification.json |`,
    `| Live catalog UI | ${SITE_URL}/skills |`,
    "| Publish receipts | `onchain/publish-receipt.json` (created by `publish:onchain`) |",
    "",
    "## 🔄 How It Stays Fresh",
    "",
    "- Everything you just read is **generated** by `npm run build:catalog` — README, banner SVGs, catalog JSON, the public site, and the Merkle registry all rebuild from the skills on disk.",
    "- Nested skills are discovered recursively (`google/ads`, `google/analytics`, `google/cloud` publish through the same pipeline).",
    `- The production mirror is ${SITE_URL} — same build output, served statically.`,
    "- Add a skill folder with a `SKILL.md`, rebuild, and it appears everywhere: README, JSON API, site, and the next on-chain anchor.",
    "",
    '<div align="center">',
    "",
    "**Built for agents, hashed for history, anchored for keeps.** 🟣",
    "",
    "</div>",
    "",
  );

  return `${lines.join("\n")}`;
}

function renderHeroBanner(catalog) {
  const byCategory = groupByCategory(catalog);
  const emojis = byCategory.map(([category]) => categoryMeta(category).emoji).join("  ");
  const seeded = (i, m) => ((i * 2654435761) % m + m) % m;
  const stars = Array.from({ length: 42 }, (_, i) => {
    const x = 30 + seeded(i + 7, 1140);
    const y = 20 + seeded(i * 13 + 3, 260);
    const r = 1 + (i % 3);
    const dur = 2 + (i % 5);
    const begin = (i % 10) * 0.35;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#a78bfa"><animate attributeName="opacity" values="0.15;1;0.15" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
  }).join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b0217">
        <animate attributeName="stop-color" values="#0b0217;#120b2e;#0b0217" dur="8s" repeatCount="indefinite"/>
      </stop>
      <stop offset="100%" stop-color="#1a0533">
        <animate attributeName="stop-color" values="#1a0533;#062131;#1a0533" dur="8s" repeatCount="indefinite"/>
      </stop>
    </linearGradient>
    <linearGradient id="title" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#9945FF"/>
      <stop offset="50%" stop-color="#00C2FF"/>
      <stop offset="100%" stop-color="#14F195"/>
      <animateTransform attributeName="gradientTransform" type="translate" values="-0.3 0;0.3 0;-0.3 0" dur="6s" repeatCount="indefinite"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="300" fill="url(#bg)" rx="16"/>
  <g opacity="0.8">
    ${stars}
  </g>
  <g transform="translate(600 128)" text-anchor="middle">
    <text font-size="72" font-weight="800" fill="url(#title)" letter-spacing="6">⚡ SKILL HUB</text>
  </g>
  <g transform="translate(600 178)" text-anchor="middle">
    <text font-size="24" fill="#c4b5fd">${catalog.length} agent skills · ${byCategory.length} zones · merkle-verified · arweave-permanent · solana-anchored</text>
  </g>
  <g transform="translate(600 232)" text-anchor="middle">
    <text font-size="30">${emojis}
      <animate attributeName="opacity" values="0.55;1;0.55" dur="3s" repeatCount="indefinite"/>
    </text>
  </g>
  <rect x="8" y="8" width="1184" height="284" rx="12" fill="none" stroke="#9945FF" stroke-width="2" stroke-dasharray="14 10" opacity="0.6">
    <animate attributeName="stroke-dashoffset" values="0;-96" dur="4s" repeatCount="indefinite"/>
  </rect>
</svg>
`;
}

function renderChainDivider() {
  const links = Array.from({ length: 24 }, (_, i) => {
    const x = 25 + i * 50;
    const begin = (i * 0.12).toFixed(2);
    return `<circle cx="${x}" cy="20" r="6" fill="none" stroke="#14F195" stroke-width="2"><animate attributeName="stroke" values="#14F195;#9945FF;#00C2FF;#14F195" dur="3s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
  }).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 40">
  <line x1="0" y1="20" x2="1200" y2="20" stroke="#4c1d95" stroke-width="2" stroke-dasharray="8 8">
    <animate attributeName="stroke-dashoffset" values="0;-64" dur="3s" repeatCount="indefinite"/>
  </line>
  ${links}
</svg>
`;
}

function groupByCategory(catalog) {
  return CATEGORY_ORDER
    .map((category) => [category, catalog.filter((skill) => skill.category === category)])
    .filter(([, skills]) => skills.length > 0);
}

function markdownSkillLink(skill) {
  return `[\`${skill.slug}\`](./${skill.slug}/SKILL.md)`;
}

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function renderSkillsShConfig(catalog) {
  const config = {
    $schema: "https://skills.sh/schemas/skills.sh.schema.json",
    notGrouped: "bottom",
    groupings: groupByCategory(catalog).map(([category, skills]) => ({
      title: category,
      description: categoryDescription(category),
      skills: skills.map((skill) => skill.slug),
    })),
  };

  return `${JSON.stringify(config, null, 2)}\n`;
}

function categoryDescription(category) {
  const descriptions = {
    "Dev Tools / Agents": "Coding-agent, MCP, GitHub, terminal, and skill-development workflows.",
    "Google / Ads": "Google Ads and mobile ads workflows for agent-assisted implementation.",
    "Google / Analytics": "Google Analytics account, property, and reporting workflows.",
    "Google / Cloud": "Google Cloud deployment, operations, infrastructure, and AI platform skills.",
    "Local / Web Services": "Local services, places, orders, and weather workflows.",
    "Media / Devices": "Media generation, device control, transcription, and visual processing skills.",
    "Productivity / Messaging": "Notes, messaging, workspace, and personal productivity integrations.",
    "Solana / Blockchain": "Solana, wallets, trading, verification, ZK, and on-chain agent workflows.",
    "Utilities": "General utility skills for local tools and everyday agent operations.",
  };
  return descriptions[category] || "Repo-local agent skills.";
}

function getSkillBundleFiles(files, slug) {
  const prefix = `api/skills/${slug}/`;
  return [...files.entries()]
    .filter(([file]) => file.startsWith(prefix))
    .filter(([file]) => !file.endsWith("/metadata.json") && !file.endsWith("/verification.json"))
    .map(([file, content]) => ({
      path: file.slice(prefix.length),
      content: toBuffer(content),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function renderSkillVerification(skill, bundleFiles) {
  const files = bundleFiles.map(({ path: filePath, content }) => ({
    path: filePath,
    bytes: content.byteLength,
    sha256: `sha256-${sha256(content)}`,
  }));
  const bundleHash = hashBundle(bundleFiles);
  const merkleLeaf = `sha256-${sha256(`${skill.slug}\0${bundleHash}`)}`;

  return {
    schemaVersion: "skill-verification/v1",
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    source: `${SITE_URL}/api/skills/${skill.slug}/SKILL.md`,
    metadata: `${SITE_URL}/api/skills/${skill.slug}/metadata.json`,
    bundleHash,
    merkleLeaf,
    files,
    registry: `${SITE_URL}/.well-known/onchain-skill-registry.json`,
    solana: {
      cluster: "mainnet-beta",
      status: "anchor-ready",
      registryProgramId: null,
      registryPda: null,
    },
  };
}

function renderOnchainRegistry(catalog, verifications) {
  return {
    schemaVersion: "onchain-skill-registry/v1",
    name: "Onchain AI Skill Hub",
    url: SITE_URL,
    generatedAt: "1970-01-01T00:00:00.000Z",
    chain: "solana",
    cluster: "mainnet-beta",
    status: "anchor-ready",
    hashAlgorithm: "sha256",
    totalSkills: verifications.length,
    catalogHash: `sha256-${sha256(JSON.stringify(catalog))}`,
    merkleRoot: computeMerkleRoot(verifications.map((entry) => entry.merkleLeaf)),
    solana: {
      registryProgramId: null,
      registryPda: null,
      authority: null,
      seedHint: ["skill-registry", new URL(SITE_URL).hostname],
      instruction: "Anchor this merkleRoot and catalogHash in a Solana registry account controlled by the hub authority.",
    },
    endpoints: {
      catalog: `${SITE_URL}/api/skills.json`,
      skillVerification: `${SITE_URL}/api/skills/{skill}/verification.json`,
      skillSource: `${SITE_URL}/api/skills/{skill}/SKILL.md`,
    },
    skills: verifications,
  };
}

function hashBundle(bundleFiles) {
  const hash = createHash("sha256");
  hash.update("skill-bundle-v1\0");
  for (const file of bundleFiles) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return `sha256-${hash.digest("hex")}`;
}

function computeMerkleRoot(leaves) {
  if (leaves.length === 0) return `sha256-${sha256("")}`;

  let level = leaves.map((leaf) => leaf.replace(/^sha256-/, ""));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] || left;
      next.push(sha256(Buffer.concat([Buffer.from(left, "hex"), Buffer.from(right, "hex")])));
    }
    level = next;
  }

  return `sha256-${level[0]}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value));
}

function renderSiteManifest(catalog, registry) {
  return {
    name: "Onchain AI Skill Hub",
    url: SITE_URL,
    generatedAt: "1970-01-01T00:00:00.000Z",
    totalSkills: catalog.length,
    categories: Object.fromEntries(groupByCategory(catalog).map(([category, skills]) => [category, skills.length])),
    endpoints: {
      ui: `${SITE_URL}/skills`,
      catalog: `${SITE_URL}/api/skills.json`,
      catalogIndex: `${SITE_URL}/api/skills`,
      skillMetadata: `${SITE_URL}/api/skills/{skill}/metadata.json`,
      skillSource: `${SITE_URL}/api/skills/{skill}/SKILL.md`,
      skillVerification: `${SITE_URL}/api/skills/{skill}/verification.json`,
      onchainRegistry: `${SITE_URL}/.well-known/onchain-skill-registry.json`,
    },
    skillsSh: {
      install: "npx skills add Solizardking/skills",
      repoConfig: "skills.sh.json",
    },
    verification: {
      chain: "solana",
      status: registry.status,
      merkleRoot: registry.merkleRoot,
      catalogHash: registry.catalogHash,
    },
  };
}

function renderSitemap(catalog) {
  const urls = [
    SITE_URL,
    `${SITE_URL}/skills`,
    `${SITE_URL}/api/skills.json`,
    `${SITE_URL}/.well-known/skills-hub.json`,
    `${SITE_URL}/.well-known/onchain-skill-registry.json`,
    ...catalog.flatMap((skill) => [
      `${SITE_URL}/api/skills/${encodeSkillPath(skill.slug)}/metadata.json`,
      `${SITE_URL}/api/skills/${encodeSkillPath(skill.slug)}/verification.json`,
      `${SITE_URL}/api/skills/${encodeSkillPath(skill.slug)}/SKILL.md`,
    ]),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join("\n")}
</urlset>
`;
}

function encodeSkillPath(slug) {
  return slug.split("/").map(encodeURIComponent).join("/");
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[char]);
}

function renderIndexHtml(catalog) {
  const grouped = Object.fromEntries(groupByCategory(catalog));
  const data = JSON.stringify(catalog).replace(/</g, "\\u003c");
  const categoryOptions = CATEGORY_ORDER.filter((category) => grouped[category]).map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Skills Catalog</title>
  <link rel="canonical" href="${SITE_URL}/skills">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f2;
      --panel: #ffffff;
      --ink: #18201d;
      --muted: #5e6964;
      --line: #d8ddd5;
      --accent: #0f766e;
      --accent-2: #8a5a11;
      --spark: #2563eb;
      --chip: #ecf4f1;
      --shadow: 0 1px 2px rgba(24, 32, 29, 0.08);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }

    a {
      color: inherit;
    }

    .shell {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }

    header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      align-items: end;
      padding: 18px 0 22px;
      border-bottom: 1px solid var(--line);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .mark {
      width: 42px;
      height: 42px;
      border: 1px solid #0f766e;
      border-radius: 8px;
      background:
        linear-gradient(90deg, transparent 47%, rgba(15, 118, 110, 0.22) 47% 53%, transparent 53%),
        linear-gradient(0deg, transparent 47%, rgba(138, 90, 17, 0.24) 47% 53%, transparent 53%),
        #ffffff;
      flex: 0 0 auto;
      animation: mark-shift 8s ease-in-out infinite;
    }

    h1 {
      margin: 0;
      font-size: 32px;
      line-height: 1.08;
      letter-spacing: 0;
    }

    .subhead {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 15px;
    }

    .install {
      margin: 0;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      font-size: 13px;
      white-space: nowrap;
    }

    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(180px, 260px);
      gap: 12px;
      margin: 20px 0;
    }

    input,
    select {
      width: 100%;
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      font: inherit;
      padding: 0 12px;
    }

    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 18px;
    }

    .stat {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--chip);
      color: #25423b;
      font-size: 13px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
    }

    .skill-card {
      display: flex;
      min-height: 188px;
      flex-direction: column;
      justify-content: space-between;
      gap: 16px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      animation: rise-in 420ms ease both;
      transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
    }

    .skill-card:hover {
      border-color: rgba(37, 99, 235, 0.38);
      box-shadow: 0 10px 24px rgba(24, 32, 29, 0.11);
      transform: translateY(-2px);
    }

    .skill-card h2 {
      margin: 0;
      font-size: 17px;
      line-height: 1.25;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }

    .skill-card p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
    }

    .meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .category {
      color: var(--accent-2);
      font-size: 12px;
      font-weight: 650;
      line-height: 1.2;
    }

    .open {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      padding: 0 10px;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      font-size: 13px;
      font-weight: 650;
      text-decoration: none;
      white-space: nowrap;
      transition: background-color 160ms ease, transform 160ms ease;
    }

    .open:hover {
      background: var(--spark);
      transform: translateY(-1px);
    }

    .empty {
      display: none;
      padding: 30px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--muted);
      text-align: center;
    }

    @media (max-width: 720px) {
      .shell {
        width: min(100% - 24px, 1180px);
        padding-top: 18px;
      }

      header,
      .toolbar {
        grid-template-columns: 1fr;
      }

      .install {
        white-space: normal;
      }

      h1 {
        font-size: 27px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 1ms !important;
      }
    }

    @keyframes rise-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes mark-shift {
      0%, 100% {
        background-position: 0 0, 0 0, 0 0;
      }
      50% {
        background-position: 8px 0, 0 8px, 0 0;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div class="brand">
        <div class="mark" aria-hidden="true"></div>
        <div>
          <h1>Skills Catalog</h1>
          <p class="subhead">${catalog.length} repo-local skills, searchable by pack, trigger, and platform.</p>
        </div>
      </div>
      <pre class="install">npx github:Solizardking/skills install</pre>
    </header>

    <section class="toolbar" aria-label="Catalog filters">
      <input id="search" type="search" autocomplete="off" placeholder="Search skills">
      <select id="category" aria-label="Category">
        <option value="">All categories</option>
        ${categoryOptions}
      </select>
    </section>

    <section class="stats" id="stats" aria-label="Category totals"></section>
    <section class="grid" id="grid"></section>
    <p class="empty" id="empty">No skills match the current filters.</p>
  </main>

  <script id="skills-data" type="application/json">${data}</script>
  <script>
    const skills = JSON.parse(document.getElementById("skills-data").textContent);
    const search = document.getElementById("search");
    const category = document.getElementById("category");
    const grid = document.getElementById("grid");
    const stats = document.getElementById("stats");
    const empty = document.getElementById("empty");

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]);
    }

    function renderStats(items) {
      const counts = items.reduce((acc, skill) => {
        acc[skill.category] = (acc[skill.category] || 0) + 1;
        return acc;
      }, {});
      stats.innerHTML = Object.entries(counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, count]) => \`<span class="stat">\${escapeHtml(label)}: \${count}</span>\`)
        .join("");
    }

    function render() {
      const q = search.value.trim().toLowerCase();
      const selectedCategory = category.value;
      const filtered = skills.filter((skill) => {
        const haystack = \`\${skill.slug} \${skill.name} \${skill.description} \${skill.category}\`.toLowerCase();
        return (!q || haystack.includes(q)) && (!selectedCategory || skill.category === selectedCategory);
      });

      grid.innerHTML = filtered.map((skill, index) => \`
        <article class="skill-card" style="animation-delay: \${Math.min(index, 24) * 18}ms">
          <div>
            <h2>\${escapeHtml(skill.slug)}</h2>
            <p>\${escapeHtml(skill.description)}</p>
          </div>
          <div class="meta">
            <span class="category">\${escapeHtml(skill.category)}</span>
            <a class="open" href="/api/skills/\${encodeSkillPath(skill.slug)}/SKILL.md">Open</a>
          </div>
        </article>
      \`).join("");

      renderStats(filtered);
      empty.style.display = filtered.length ? "none" : "block";
    }

    function encodeSkillPath(slug) {
      return slug.split("/").map(encodeURIComponent).join("/");
    }

    search.addEventListener("input", render);
    category.addEventListener("change", render);
    render();
  </script>
</body>
</html>
`;
}

function renderFavicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#ffffff"/>
  <path d="M12 20h40M12 32h40M12 44h40" stroke="#0f766e" stroke-width="6" stroke-linecap="round"/>
  <path d="M22 12v40M42 12v40" stroke="#8a5a11" stroke-width="6" stroke-linecap="round"/>
</svg>
`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

async function checkOutputs(outputs) {
  const mismatches = [];
  const generatedFiles = new Set(outputs.keys());

  for (const [relativePath, expected] of outputs) {
    const absolutePath = path.join(ROOT, relativePath);
    let actual;
    try {
      actual = await readFile(absolutePath);
    } catch {
      mismatches.push(relativePath);
      continue;
    }
    const expectedBuffer = Buffer.isBuffer(expected) ? expected : Buffer.from(expected);
    if (!actual.equals(expectedBuffer)) mismatches.push(relativePath);
  }

  for (const file of await listFiles(path.join(ROOT, "public"))) {
    const relativePath = path.relative(ROOT, file);
    if (!generatedFiles.has(relativePath)) mismatches.push(relativePath);
  }

  if (mismatches.length > 0) {
    console.error("Catalog outputs are stale:");
    for (const file of mismatches.slice(0, 40)) {
      console.error(`  - ${file}`);
    }
    if (mismatches.length > 40) {
      console.error(`  ... and ${mismatches.length - 40} more`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Catalog outputs are up to date.");
}

async function writeOutputs(outputs) {
  await rm(path.join(ROOT, "public"), { recursive: true, force: true });

  for (const [relativePath, content] of outputs) {
    const absolutePath = path.join(ROOT, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
}

async function listFiles(dir) {
  if (!existsSync(dir)) return [];

  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath));
    } else {
      files.push(absolutePath);
    }
  }
  return files;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
