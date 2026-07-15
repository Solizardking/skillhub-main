# On-chain artifacts

## Files

| Path | Committed? | Purpose |
|------|------------|---------|
| `publish-plan.json` | yes | Dry-run / last plan for **catalog** Arweave + Solana memo |
| `publish-receipt.json` | yes | Last successful **catalog** anchor (public explorer links only) |
| `public-ledger.json` | yes | **Redacted** community submissions (safe for GitHub) |
| `agentregistry-mirror.json` | yes | Proof map for importing skills into local agentregistry |
| `submissions/` | **no** (gitignored) | Private job store: full files, scan detail, payment memos |

## Security

Never store in git:

- Solana keypairs / `SOLANA_KEYPAIR` JSON
- Merchant private keys
- `.env` files
- Raw blocked skill bodies that may contain secrets

The public ledger exporter (`npm run ledger:export`) strips:

- Private key / mnemonic / secret patterns
- Finding excerpts and file bodies for blocked jobs
- Anything matching long base58 secret-like blobs in free text

Public fields kept: slug, hashes, risk level, payment signature, explorer URLs, Arweave IDs, payer **public** keys.

## Commands

```bash
npm run ledger:export          # rebuild public-ledger.json + public/api/submissions.json
npm run publish:onchain        # catalog plan (writes publish-plan.json)
npm run publish:onchain -- --execute --devnet   # Arweave pin + Solana memo
npm run publish:agentregistry:onchain           # push proofs into local agentregistry
npm run publish:agentregistry:onchain:dry       # preview payloads / mirror only
npm run publish:agentregistry:onchain:plan      # rewrite agentregistry-mirror.json only
npm run relay                  # full catalog rebuild + mirror/ledger refresh
npm run relay:fast             # light path + mirror/ledger refresh
npm run relay:upload           # community upload API + UI
```

`npm run relay` / `relay:fast` always refresh `agentregistry-mirror.json` and
`public-ledger.json` so those files cannot lag behind a catalog re-anchor
(the previous drift mode was mirror stuck at 568 skills while the registry had 570).

## agentregistry bridge

Every skill in the on-chain registry has a `bundleHash` + `merkleLeaf`. The catalog
anchor (`publish-receipt.json`) pins the Merkle root on Solana and the full registry
on Arweave.

```bash
# 1) Ensure local registry is up
arctl daemon start

# 2) (optional) re-anchor if catalog changed
npm run build:catalog
npm run publish:onchain -- --execute --devnet

# 3) Mirror proofs into agentregistry (websiteUrl + ar:// packages)
npm run publish:agentregistry:onchain
```

This writes:

- `onchain/agentregistry-mirror.json` — git-safe full proof map
- `public/api/agentregistry.json` — same file for the static site
- One agentregistry skill per catalog slug, versioned `1.0.0-onchain.<catalogHash8>`
- A special skill `skillhub-catalog-anchor` holding the root + explorer links

Open http://localhost:12121 and look for skills with Arweave packages and verification URLs.

## Hubs

- Primary: https://skills.x402.wtf
- Alias: https://skills.onchainai.fund
- Cheshire: https://cheshireterminal.ai/skills
- Ledger UI: https://skills.x402.wtf/submissions
- API: https://skills.x402.wtf/api/submissions.json
- agentregistry mirror: https://skills.x402.wtf/api/agentregistry.json
