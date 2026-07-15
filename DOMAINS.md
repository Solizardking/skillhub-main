# Domains

## Live production (2026-07-15)

| Host | Status | Notes |
|------|--------|--------|
| **https://skillhub-red.vercel.app** | **Live** | Current production deploy (568 skills, on-chain ledger APIs) |
| `skills.x402.wtf` | DNS not resolving | Intended primary; point CNAME at the Vercel project above |
| `skills.onchainai.fund` | Stale | Still serves old `skills-sepia` (~192 skills); re-point to skillhub project |

Vercel project: `mynameisjeffspicoli-2862s-projects/skillhub` (repo `Solizardking/skillhub-main`).

## Primary (intended): `skills.x402.wtf`

Canonical Skill Hub hostname for catalog, publish, scanner, and on-chain ledger.

| Record | Value |
|--------|--------|
| Type | `CNAME` (or A/ALIAS per host) |
| Name | `skills` |
| Target | Vercel project `skillhub` / `skillhub-red.vercel.app` |

After DNS:

1. Add domain in Vercel → Project → Settings → Domains → `skills.x402.wtf`
2. Keep redirect/alias for `skills.onchainai.fund` → `skills.x402.wtf` (optional 308)
3. Redeploy: `npm run build:catalog` writes `public/CNAME` as `skills.x402.wtf`

## Aliases

| Host | Role |
|------|------|
| `skills.x402.wtf` | **Primary** (intended) |
| `skillhub-red.vercel.app` | **Live production** until custom DNS is wired |
| `skills.onchainai.fund` | Legacy alias (re-point away from skills-sepia) |
| `cheshireterminal.ai/skills` | Cheshire UI proxying hub API |
| `cheshireterminal.ai/skills-store` | Curated store (repo `skills-store/`) |

## Env

```bash
# Skill Hub build
export SKILLHUB_SITE_URL=https://skillhub-red.vercel.app
# After DNS: export SKILLHUB_SITE_URL=https://skills.x402.wtf

# Cheshire (Vercel / Fly)
export SKILLS_LIVE_BASE_URL=https://skillhub-red.vercel.app
```

## Verify

```bash
curl -sI https://skillhub-red.vercel.app | head
curl -sS https://skillhub-red.vercel.app/api/skills.json | head -c 200
curl -sS https://skillhub-red.vercel.app/api/onchain.json | head -c 400
curl -sS https://skillhub-red.vercel.app/api/submissions.json | head -c 200
curl -sS https://skillhub-red.vercel.app/.well-known/onchain-skill-registry.json | head -c 200
```
