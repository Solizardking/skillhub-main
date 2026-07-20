---
name: rh-crypto-agent
description: >
  Robinhood Crypto Agent open stack — pack index for Robinhood Chain / Uniswap EVM
  agent skills (bonded launch, LaunchpadV3, swaps, LP, DCA, copy-trade, payments,
  viem, Cheshire agent registries). Use when installing the RH pack, pointing
  clawdbot at the open stack, or choosing which RH/EVM skill to load next.
---

# Robinhood Crypto Agent Open Stack

Open-source skill pack for **anyone** building Robinhood Chain / EVM trading and launch agents (Zero Clawd / clawdbot).

This Skill Hub entry is the **pack index**. Member skills are installed as top-level hub slugs (not nested under this path) so catalog names stay unique.

## Member skills (21)

- [`cheshire-agent-identity-registry`](../cheshire-agent-identity-registry/SKILL.md)
- [`cheshire-agent-registries`](../cheshire-agent-registries/SKILL.md)
- [`cheshire-agent-reputation-registry`](../cheshire-agent-reputation-registry/SKILL.md)
- [`cheshire-agent-validation-registry`](../cheshire-agent-validation-registry/SKILL.md)
- [`cheshire-zk-omni`](../cheshire-zk-omni/SKILL.md)
- [`copy-trade`](../copy-trade/SKILL.md)
- [`dca-bot`](../dca-bot/SKILL.md)
- [`deployer`](../deployer/SKILL.md)
- [`index-bot`](../index-bot/SKILL.md)
- [`liquidity-planner`](../liquidity-planner/SKILL.md)
- [`lp-integration`](../lp-integration/SKILL.md)
- [`pay-with-any-token`](../pay-with-any-token/SKILL.md)
- [`pay-with-app`](../pay-with-app/SKILL.md)
- [`rh-bonded-launch`](../rh-bonded-launch/SKILL.md)
- [`rh-launchpad-v3`](../rh-launchpad-v3/SKILL.md)
- [`swap-integration`](../swap-integration/SKILL.md)
- [`swap-planner`](../swap-planner/SKILL.md)
- [`v4-hook-generator`](../v4-hook-generator/SKILL.md)
- [`v4-sdk-integration`](../v4-sdk-integration/SKILL.md)
- [`v4-security-foundations`](../v4-security-foundations/SKILL.md)
- [`viem-integration`](../viem-integration/SKILL.md)

## When to use this skill

- User asks for the **RH crypto agent pack**, open stack, or full Robinhood/EVM skill set
- Pointing clawdbot / go-bot at a skills directory for RH work
- Deciding which member skill to open next (launch vs swap vs LP vs registry)

## Point clawdbot at the pack (upstream checkout)

In the upstream `robinhood-agents` or `go-bot` tree the pack is a **skills root** (`CLAWDBOT_SKILLS_DIR=…/skills/rh-crypto-agent`). On Skill Hub, install members by name:

```bash
npx github:Solizardking/skills install rh-bonded-launch rh-launchpad-v3 viem-integration swap-planner
npx github:Solizardking/skills install cheshire-agent-registries robinhood-agent-forge zk-omni-messaging
```

Pack metadata: [pack-index.json](./pack-index.json) · [README.md](./README.md)

## Robinhood use cases

- Permissionless bonded token launch (`rh-bonded-launch`) and V3 graduation (`rh-launchpad-v3`)
- Swaps / LP / Uniswap v4 hooks
- DCA, index baskets, and copy-trade
- Cheshire agent identity / reputation / validation registries + zk-omni
- EVM reads/writes with `viem-integration`

## License

MIT (same as parent unless a member skill notes otherwise).
