# CoinGecko documentation index

Fetch the complete documentation index at: https://docs.coingecko.com/llms.txt
Use this file to discover all available pages before exploring further.

| Source | URL |
|--------|-----|
| LLM docs index | https://docs.coingecko.com/llms.txt |
| CoinGecko Agent SKILL | https://docs.coingecko.com/docs/skills |
| Official GitHub package | https://github.com/coingecko/skills |
| API pricing / keys | https://www.coingecko.com/en/api/pricing |
| MCP server (companion) | https://docs.coingecko.com/ai-integration/mcp-server |

## Install (agents)

```bash
# Skill Hub
npx github:Solizardking/skills install coingecko

# Official CoinGecko package (all agents)
npm install -g skills
npx skills add coingecko/skills -g -y
```

## Claude Web

1. Download [skills-main.zip](https://github.com/coingecko/skills/archive/refs/heads/main.zip).
2. Upload at [claude.ai/customize/skills](https://claude.ai/customize/skills) → **+** → **Upload a skill**.
3. Allowlist `api.coingecko.com` and `pro-api.coingecko.com` at [claude.ai/settings/capabilities](https://claude.ai/settings/capabilities).
4. Artifacts cannot call the API directly — fetch with `bash_tool`/`curl` first, then pass static data into the Artifact.

For the best experience — especially on the Claude free plan — set up the [CoinGecko MCP Server](https://docs.coingecko.com/ai-integration/mcp-server) alongside this SKILL.

## Try it

- If I invested $100 in Bitcoin back in December 2018, how much would it be worth today?
- What was the ATH of XPL?
- What is the current market cap of `DZnQi17HFgSM8mJ4nhVicz32B97XyTsd6MUVuDJgP9Jo` from Solana?
- What are the top NFT collections this week?

Feedback: https://forms.gle/oiZ86EwNxeTxCVEL7
