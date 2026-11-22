---
name: awesome-design-md
description: Library of 84 ready-made DESIGN.md design-system analyses of real sites (Airbnb, Notion, Linear, Stripe, Apple, Uber, Spotify, Vercel, ...), from VoltAgent/awesome-design-md. Use when the user wants a UI to "look like" or "feel like" a known product, wants a reference design system, or wants to create/seed a project DESIGN.md (colors, type, radii, spacing, components) before building UI.
---

# Awesome DESIGN.md

Bundled copy of [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT, see `LICENSE`).
Each file in `designs/<site>.md` is a DESIGN.md (Google Stitch format): YAML front matter with
design tokens (`colors`, `typography`, `rounded`, `spacing`, ...) followed by prose rules for
layout, components, motion and do/don't guidance.

## Workflow

1. **Pick references.** Read `INDEX.md` (one line per site) and choose 1–3 files whose mood fits
   the product. For a travel / scheduling product, good starting points are `airbnb` (warm consumer
   marketplace), `notion` / `cal` (calm scheduling and docs), `linear.app` / `superhuman`
   (dense, fast productivity), `uber` (maps, transport). Say why each one fits.
2. **Read the chosen file(s) in full** from `designs/`. Do not guess tokens from memory.
3. **Write the project's own `DESIGN.md`** at the project root. Never copy a brand wholesale:
   keep the structure and the reasoning, but replace brand names, logos, proprietary fonts
   (e.g. Airbnb Cereal → an open Google Font) and signature brand colors with the project's own.
   Blending two references (e.g. Airbnb's warmth + Linear's density) is encouraged; say which
   parts came from where.
4. **Build from the DESIGN.md.** Map its tokens to CSS custom properties / Tailwind theme first,
   then build components. Re-read the DESIGN.md when making any new visual decision.

## Notes

- These are analyses of public sites, not official brand systems. Do not reproduce trademarks,
  logos or a site's exact look for a product that is not that brand.
- Combines well with: `impeccable` (`/impeccable init`, `/impeccable document` also read/write
  DESIGN.md), `emil-design-eng` for motion, and `design-taste-frontend` when it is installed
  (not committed to this repo because of its 38MB assets).
- Upstream updates: https://getdesign.md and the GitHub repo.
