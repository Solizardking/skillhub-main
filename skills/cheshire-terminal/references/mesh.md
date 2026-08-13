# Cheshire Terminal skill mesh

Cheshire Terminal is the live product hub. Skill Hub (`skillhub-main` / skills.x402.wtf) is the canonical `SKILL.md` inventory. These five trees must stay wired together:

| Tree | Role | Live surface |
|------|------|----------------|
| `skills-store/` | Curated Agent Skills pack (API, PostHog, Google registry, Stripe, scanner) | `https://cheshireterminal.ai/skills-store` · `GET /api/skills-store` |
| `skills/` | Community / Skill Hub dump served by the catalog API | `https://cheshireterminal.ai/skills` · `GET /api/skills` |
| `client/` | Product UI (`SkillsPage`, `SkillsStorePage`, `CliPage`) | `/skills` · `/skills-store` · `/cli` |
| `cli/` | `cheshire-terminal-cli` — `skills`, `skills:store`, `skills:publish` | `https://cheshireterminal.ai/cli` |
| `server/` | Express + MCP — `server/routes/skills.ts`, `skills-store.ts`, `server/mcp/tools.ts` | `/api/skills` · `/api/skills-store` · `POST /mcp` |

Google Agent Registry cards live at `registry/google/` (A2A card, MCP tools list, OpenAPI). Public mirrors:

- `GET https://cheshireterminal.ai/.well-known/agent-card.json`
- `GET https://cheshireterminal.ai/.well-known/mcp`
- `GET https://cheshireterminal.ai/.well-known/mcp/server-card.json`

## Data flow

```
client /skills  ──GET──►  server/routes/skills.ts
cli skills      ──GET──►       ├─ skills-store/
                               ├─ skills/          (local dump)
                               ├─ sibling skillhub-main/skills  (when present)
                               └─ https://skills.x402.wtf/api/skills  (remote)

client /skills-store  ──GET──►  server/routes/skills-store.ts
cli skills:store      ──GET──►       └─ skills-store/catalog.json
                                         + imported-skills.json → ../skills
```

## Install

```bash
# Curated store (Cheshire repo)
npx skills add Solizardking/cheshire-terminal --path skills-store

# Full Skill Hub catalog
npx skills add Solizardking/skills
npx github:Solizardking/skills install

# CLI against the live hub
npx cheshire-terminal-cli skills
npx cheshire-terminal-cli skills:store
```

When this repo sits next to `skillhub-main`, the server also loads `../skillhub-main/skills` (override with `SKILLHUB_SKILLS_ROOT`). Remote catalog base: `SKILLS_LIVE_BASE_URL` or `https://skills.x402.wtf`.
