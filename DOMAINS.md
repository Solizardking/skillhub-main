# Domains

## Current live (2026-11-27)

The Skill Hub static site in this repo (`public/` after `npm run build:catalog`) is
**only reachable at [https://clawdcompute.us/skills](https://clawdcompute.us/skills)**
right now.

| Host | Status | Notes |
|------|--------|--------|
| **https://clawdcompute.us/skills/** | **Live** | Cloudflare in front of the Skill Hub `public/` build, mounted under the `/skills/` path. Slightly stale vs `main` (live catalog still includes `1password`; `main` does not). |
| `skills.clawdcompute.us` | **Not created** | NXDOMAIN. This is the hostname to add so the same catalog is served at the subdomain root. |
| `skills.clawdcode.net` | Down | CNAME to Render `skillhub-buja.onrender.com`; the service is **suspended** (`503`, `x-render-routing: suspend`). |
| `skillhub-red.vercel.app` | Down | Vercel `DEPLOYMENT_DISABLED`. |
| `skills.x402.wtf` | Down | Zone exists on Cloudflare; the `skills` name has no A/AAAA/CNAME. |
| `skills.x402agent.io` / `hub.x402agent.io` | Down | NXDOMAIN. |
| `skills.onchainai.fund` | Down | Vercel `DEPLOYMENT_DISABLED`. |

`clawdcompute.us` itself is a Cloudflare zone (registrar Cloudflare, NS
`craig.ns.cloudflare.com` / `gene.ns.cloudflare.com`). The apex gateway worker is
[Solizardking/musebook-ai-gateway](https://github.com/Solizardking/musebook-ai-gateway)
(`musebook-ai-gateway` Worker). The committed worker still has a `/skills` handler
that would mirror `musebook.trade/api/skills`, but that is **not** what production
serves at `/skills/` — production serves this repo's static Skill Hub (Pages-style
headers: `cache-control: public, max-age=0, must-revalidate`).

GitHub `Solizardking/skills` redirects to `themusebook/skills`. That catalog is a
different, older tree (629 skills) and is **not** what `clawdcompute.us/skills` shows.

### Add `skills.clawdcompute.us` (needs owner approval — do not do this yet)

Do **not** attach this hostname to the `musebook-ai-gateway` Worker. That worker's
`/api/*` namespace and `/skills` handler are the wrong origin. Attach it to the
same Cloudflare Pages (or static) project that already serves
`https://clawdcompute.us/skills/*`, so the subdomain serves `public/` at **`/`**.

Serving at the hostname root is what makes root-relative `/api` and `/assets`
links work. This branch also switches the catalog HTML to relative links so the
existing `/skills/` path mount keeps working after the next deploy.

Exact steps after approval:

1. **Cloudflare Dashboard → Pages** (or Workers & Pages) → the Skill Hub project
   that publishes this repo's `public/` folder. If you need a new project:
   `wrangler pages project create skillhub` then
   `wrangler pages deploy public --project-name skillhub` after `npm run build:catalog`.
2. **Pages → Custom domains → Add** `skills.clawdcompute.us`.
   Cloudflare will provision the certificate.
3. **Cloudflare DNS** for `clawdcompute.us` — add a **proxied** (orange-cloud) record:
   - Type: `CNAME`
   - Name: `skills`
   - Target: `<your-pages-project>.pages.dev` (Pages often creates this record
     for you when you add the custom domain)
   - Proxy: **ON**
4. If `/skills*` is today a **more-specific Worker/Pages route** on the apex
   (`clawdcompute.us/skills*`), add a second route on the **same** Skill Hub
   project: `skills.clawdcompute.us/*`. Do not add that route to
   `musebook-ai-gateway`.
5. Redeploy this repo's `public/` build so the catalog includes the full Emil
   Kowalski skill set and the relative-path fix.
6. Verify, after DNS has propagated:
   ```bash
   dig +short skills.clawdcompute.us CNAME
   curl -sI https://skills.clawdcompute.us/ | head
   curl -sS https://skills.clawdcompute.us/api/skills.json | head -c 200
   curl -sS https://skills.clawdcompute.us/api/skills/ask-emil/SKILL.md | head
   ```
   The subdomain root should show the same Skill Hub as
   `https://clawdcompute.us/skills/`.

No billing, plan, DNS, or custom-domain change is included in this PR.

---


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
