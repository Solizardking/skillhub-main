# Design Aesthetic Showcases — Sample Asset Index

> 8 scenarios × 3 aesthetics = 24 pre-built design samples
> Used in Phase 3 recommendation to directly show "what this aesthetic looks like when built"

## Aesthetic Notes

| Code | School | Style Name | Visual Character |
|------|-------|-----------|-----------------|
| **Pentagram** | Information Architecture | Pentagram / Michael Bierut | Black-and-white restraint, Swiss grid, strong type hierarchy, #9945FF Solana purple accent |
| **Build** | Minimalism | Build Studio | Luxury-grade whitespace (70%+), subtle weights (200-600), #14F195 Solana green warmth, refined |
| **Takram** | Eastern Philosophy | Takram | Soft tech feel, natural palette (beige/gray/green), rounded corners, charts as art |

## Scenario Quick Reference

### Content Design Scenarios

| # | Scenario | Spec | Pentagram | Build | Takram |
|---|---------|------|-----------|-------|--------|
| 1 | Brand Cover | 1200×510 | `cover/cover-pentagram` | `cover/cover-build` | `cover/cover-takram` |
| 2 | PPT Data Page | 1920×1080 | `ppt/ppt-pentagram` | `ppt/ppt-build` | `ppt/ppt-takram` |
| 3 | Vertical Infographic | 1080×1920 | `infographic/infographic-pentagram` | `infographic/infographic-build` | `infographic/infographic-takram` |

### Website Design Scenarios

| # | Scenario | Spec | Pentagram | Build | Takram |
|---|---------|------|-----------|-------|--------|
| 4 | Personal Homepage | 1440×900 | `website-homepage/homepage-pentagram` | `website-homepage/homepage-build` | `website-homepage/homepage-takram` |
| 5 | AI Navigator | 1440×900 | `website-ai-nav/ainav-pentagram` | `website-ai-nav/ainav-build` | `website-ai-nav/ainav-takram` |
| 6 | AI Writing Tool | 1440×900 | `website-ai-writing/aiwriting-pentagram` | `website-ai-writing/aiwriting-build` | `website-ai-writing/aiwriting-takram` |
| 7 | SaaS Landing Page | 1440×900 | `website-saas/saas-pentagram` | `website-saas/saas-build` | `website-saas/saas-takram` |
| 8 | Developer Docs | 1440×900 | `website-devdocs/devdocs-pentagram` | `website-devdocs/devdocs-build` | `website-devdocs/devdocs-takram` |

> Each entry has both `.html` (source) and `.png` (screenshot) files

## Usage

### Referencing during Phase 3 recommendation
After recommending a design direction, show the pre-built screenshot for the matching scenario:
```
"This is what a Pentagram-style brand cover looks like → [show cover/cover-pentagram.png]"
"Takram-style PPT data page feels like this → [show ppt/ppt-takram.png]"
```

### Scenario matching priority
1. Exact match for the user's scenario → show the matching scenario directly
2. No exact match but similar type → show the closest scenario (e.g. "product website" → show SaaS landing page)
3. No match at all → skip pre-built samples, go straight to Phase 3.5 live generation

### Side-by-side comparison display
All 3 aesthetics for the same scenario work well side by side, helping users compare intuitively:
- "This is the same brand cover implemented in 3 different aesthetics"
- Display order: Pentagram (rational restraint) → Build (luxurious minimalism) → Takram (soft warmth)

## Content Details

### Brand Cover (cover/)
- Content: Solana Agent Workflow — 8 parallel agent architecture
- Pentagram: giant purple "8" + Swiss grid lines + data bars
- Build: ultra-thin "Agent" floating in 70% whitespace + Solana green hairline
- Takram: 8-node radial flow diagram as artwork + beige background

### PPT Data Page (ppt/)
- Content: Solana performance breakthrough (TPS 800k / block time 400ms / finality 0.4s)
- Pentagram: 260px "800k" anchor + purple/gray/light-gray contrast bar chart
- Build: three 120px ultra-thin numbers floating + Solana gradient comparison bars
- Takram: SVG radar chart + three-color overlay + rounded data cards

### Vertical Infographic (infographic/)
- Content: Optimizing agent memory CLAUDE.md from 93KB down to 22KB
- Pentagram: giant "93→22" numbers + numbered blocks + CSS data bars
- Build: extreme whitespace + soft-shadow cards + Solana green connector lines
- Takram: SVG ring chart + organic curved flow diagram + frosted-glass cards

### Personal Homepage (website-homepage/)
- Content: an integrated portfolio homepage
- Pentagram: 112px large name + Swiss grid columns + editorial numbers
- Build: glass navigation + floating stat cards + ultra-thin weights
- Takram: paper texture + small circular avatar + hairline dividers + asymmetric layout

### AI Navigator (website-ai-nav/)
- Content: Solana Compass — 500+ Solana tools directory
- Pentagram: square-corner search box + numbered tool list + uppercase category labels
- Build: rounded search box + refined white tool cards + pill labels
- Takram: organic offset card layout + soft category labels + diagram-style connections

### AI Writing Tool (website-ai-writing/)
- Content: Inkwell — AI writing assistant
- Pentagram: 86px headline + wireframe editor mock + grid feature columns
- Build: floating editor card + Solana green CTA + luxurious writing experience
- Takram: poetic serif headline + organic editor + flow diagram

### SaaS Landing Page (website-saas/)
- Content: Meridian — business intelligence analytics platform
- Pentagram: black/white columns + structured dashboard + 140px "3x" anchor
- Build: floating dashboard cards + SVG area chart + Solana gradient
- Takram: rounded bar chart + flow nodes + soft earth palette

### Developer Docs (website-devdocs/)
- Content: Nexus API — unified AI model gateway
- Pentagram: left sidebar nav + square-corner code blocks + purple string highlighting
- Build: centered floating code card + soft shadow + Solana green icons
- Takram: beige code blocks + flow connections + dashed feature cards

## File Count

- HTML source files: 24
- PNG screenshots: 24
- Total assets: 48 files

---

**Version**: v1.0
**Created**: 2026-02-13
**Applies to**: design skill Phase 3 recommendation stage