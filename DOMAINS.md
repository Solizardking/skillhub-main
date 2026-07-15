# Domains

## Live production (2026-07-15)

| Host | Status | Notes |
|------|--------|--------|
| **https://skills.clawdcode.net** | **Live primary** | Render static site `skillhub` (570 skills). Publish UI at `/publish` |
| **https://skillhub-upload-relay.fly.dev** | **Live upload API (primary)** | Fly.io Node relay — `/api/health`, scan, pay confirm |
| **https://skillhub-upload-relay.onrender.com** | Fallback upload API | Render Node relay (legacy) |
| **https://skillhub-red.vercel.app** | Live mirror | Vercel static deploy of same repo |
| `skills.x402.wtf` | DNS not resolving | Intended alias; point CNAME at skillhub / clawdcode |
| `skills.onchainai.fund` | Stale/partial | Re-point to skillhub project |

Render static: `skillhub` (`srv-d962hc1oagis73eler8g`, `skillhub-buja.onrender.com`)  
Fly web: `skillhub-upload-relay` → https://skillhub-upload-relay.fly.dev  
Render web (fallback): `skillhub-upload-relay` (`srv-d9bumppkh4rs73dmkumg`)  
Vercel project: `mynameisjeffspicoli-2862s-projects/skillhub` (repo `Solizardking/skillhub-main`).

### Publish pipeline hosts

The static site cannot handle `POST /api/skills/upload`. The publish page loads the UI
from `skills.clawdcode.net` and calls the upload relay at
`https://skillhub-upload-relay.fly.dev` (overridable via `?api=` or
`public/api/upload-config.json`).

```bash
# Deploy / update Fly relay
fly deploy -c fly.upload-relay.toml

# Verify relay
curl -sS https://skillhub-upload-relay.fly.dev/api/health
curl -sS https://skillhub-upload-relay.fly.dev/api/config

# Optional: open UI pinned to relay
open 'https://skills.clawdcode.net/publish?api=https://skillhub-upload-relay.fly.dev'
```

Set secrets on the **Fly** upload-relay:

```bash
fly secrets set -c fly.upload-relay.toml \
  SKILLHUB_MERCHANT_WALLET=<your-sol-address> \
  SKILLHUB_PAYMENT_NETWORK=devnet
# optional anchor keypair (JSON byte array as string):
# fly secrets set -c fly.upload-relay.toml SOLANA_KEYPAIR_JSON='[1,2,3,...]'
```

| Env | Purpose |
|-----|---------|
| `SKILLHUB_MERCHANT_WALLET` | **Required for Pay** — Solana fee recipient |
| `SKILLHUB_PAYMENT_NETWORK` | `devnet` (default) or `mainnet` |
| `SKILLHUB_PUBLISH_FEE_LAMPORTS` | default `10000000` (0.01 SOL) |
| `SOLANA_KEYPAIR_JSON` | Optional — keypair JSON for Arweave + memo anchor |
| `SKILLHUB_CORS_ORIGIN` | `*` or `https://skills.clawdcode.net` |

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
