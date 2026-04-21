# Handoff: HomeHub Website (V2 · Indie Software, Life-Tracker Edition)

## Overview

Landing page for **HomeHub** — an open-source, self-hostable "quiet notebook" for tracking the small stuff of a life: events, food & groceries, plans with friends, runs/reads/meals, birthdays, moments. The site's job is to explain the product to a non-technical audience, convey that it's simple and calm (not another streak-based habit app), and surface the fact that it's open source / self-hostable for the more technical crowd.

Inspiration: paperclip.ing — quiet, indie-software tone, sans + mono, airy but dense, card-based product hero.

## About the Design Files

The files in this bundle are **design references created in HTML/JSX** — a prototype showing the intended look, tone, and information architecture. They are **not** production code to copy directly.

The task is to **recreate this design in the target codebase's environment** (Next.js / Astro / Remix / plain static HTML — whatever fits the HomeHub project) using its established patterns, component library, font-loading strategy, and deployment setup. If the repo has no web-frontend yet, choose what fits best — this is a marketing landing page, so a static-site generator (Astro, 11ty, or Next.js app-router with SSG) is ideal.

## Fidelity

**High-fidelity.** Pixel-perfect mockup with final colors, typography, spacing, copy, and card content. The developer should recreate the UI pixel-perfectly, translating the inline-styled React prototype into the codebase's component + styling system (CSS modules, Tailwind, vanilla-extract, whatever is in use).

The HTML prototype was rendered inside a 1280px-wide artboard — treat 1280px as the **desktop design width**. Responsive behavior (tablet/mobile) is NOT designed; see "Responsive" below for guidance.

---

## Page Structure

The page is a single scrollable landing page with these sections, top to bottom:

1. **Sticky top nav**
2. **Hero** (2-column: headline + CTAs on the left, card collage on the right)
3. **Social proof strip** (thin band, 5 items)
4. **Features grid** (2×2, full-width)
5. **"A week in HomeHub"** (calendar-like product preview)
6. **Self-host block** (2-column: copy + terminal snippet, warm background)
7. **Footer** (5-column: logo+tagline, product, open source, community, more)
8. **Footer meta strip**

### 1. Sticky Top Nav

- Height: ~60px, padding `20px 56px`
- Sticky at `top: 0`, `z-index: 10`, background matches page bg so content scrolls under it
- 1px bottom border in `rule` color
- Left group: logo SVG (18×18) + wordmark "homehub" (15px/600, tracking `-0.2`) + version pill "v0.8.2" (11px mono, `sub` color, 4px left margin)
- Center: 5 nav links (13px, `sub` color, 28px gap) — "Features", "Self-host", "Docs", "Changelog", "GitHub ↗"
- Right: "Sign in" (13px, `sub`, padding `7px 12px`) + primary CTA "Try it free" (13px/500, ink background, bg foreground, `border-radius: 3px`, padding `7px 14px`)

### 2. Hero

- Padding: `88px 56px 40px`
- CSS grid, `1.05fr 1fr`, 64px gap, `align-items: center`
- Min height: ~600px (driven by card collage's `height: 520`)

**Left column:**

- Eyebrow: 11px mono, accent color, `letter-spacing: 1`, a 6px dot in accent followed by `OPEN SOURCE · SELF-HOSTABLE · MIT`
- H1: 62px/600, `line-height: 1.02`, `letter-spacing: -2`, `text-wrap: balance`, three lines: `The quiet notebook / for everything / in your week.`
- Subhead: 18px/400, `line-height: 1.55`, `sub` color, `max-width: 480px`, margin-top 28px. Copy: "Track the dinners, the groceries, the running, the birthdays, the trips with friends — all in one place. No streaks, no nudges, no selling you anything. Just a calm home for the small stuff."
- CTA row (margin-top 36px, `align-items: center`, 10px gap):
  - Primary: "Start free →" — 14px/500, ink bg, bg fg, `border-radius: 3px`, padding `12px 20px`
  - Secondary (terminal-looking): `$ docker run homehub` — 14px mono, 1px `rule` border, padding `12px 20px`, the `$` in `sub` color
- Meta under CTAs: 12px mono, `sub` color, margin-top 20: `Free forever when self-hosted · $4/mo hosted`

**Right column — card collage** (`position: relative`, `height: 520px`):
Five absolutely-positioned cards with light rotations. All cards share: `background: #fff`, `border-radius: 6px`, 1px `rule` border, `box-shadow: 0 8px 24px -8px rgba(0,0,0,.1)`.

| #   | Card         | Position              | Size  | Rotate | Content                                                                                                                                                                                                                                                                                                                            |
| --- | ------------ | --------------------- | ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Grocery list | `top: 0, left: 0`     | 250px | −3°    | Eyebrow `GROCERIES · SAT` · count `3/7` · title "Weekend shop" · checklist of 7 items (Sourdough, Eggs — 12, Tomatoes checked; Olive oil, Lemons, Basil, Ricotta unchecked). Checked items have `line-through`, sub color, filled accent checkbox. Unchecked: empty 12×12 box, 1.4px sub border.                                   |
| 2   | Dinner plan  | `top: 40, right: 0`   | 270px | +2°    | Accent dot + `FRIDAY · 7:30PM` eyebrow · title "Dinner at Tala's" · line "bringing: roast chicken + the natural wine from ordinary habit" · 4 overlapping avatars (colors `#c9b89a #8a7864 #d4a88a #b5a38a`, 24px circles, 2px white border, −8px margin-left) + "+ Mika, Sam, Jo" in mono.                                        |
| 3   | Run log      | `top: 220, left: 30`  | 280px | 0°     | Eyebrow `TRACK · RUNS` + `APR · WEEK 3` · title "18.2 km this week" · 7-bar chart for M T W T F S S with values `[0,5,0,3,6,0,4.2]` — bars are accent colored (or `#ede8de` at 0.5 opacity if 0), max height 34px, flex:1, 6px gap, 9px mono day labels below · footer line "avg pace 5:42/km · best: 5:18 on Friday's park loop". |
| 4   | Birthday     | `top: 360, right: 10` | 240px | −2°    | Eyebrow `BIRTHDAY · IN 9 DAYS` · title "Mom turns 62" · line "last year: that gardening book + blue scarf. she loved both." · note block (bg `#f4f1ea`, 3px radius, 8px padding, 11px mono sub text) "idea · pottery class, Sat mornings"                                                                                          |
| 5   | Meal log     | `top: 430, left: 0`   | 200px | +3°    | Eyebrow `DINNER · TUES` · title "Miso cod, rice" · meta "made again — 3rd time · ★★★★★"                                                                                                                                                                                                                                            |

### 3. Social Proof Strip

- Padding: `28px 56px`
- 1px top + bottom `rule` borders
- Flex row, `space-between`, 12px mono, `sub` color, `letter-spacing: 0.5`
- Five items: `24,812 QUIET USERS` · `★ 4,281 GITHUB STARS` · `312 CONTRIBUTORS` · `MIT LICENSED` · `NO ADS · NO NUDGES`

### 4. Features Grid

- Padding: `80px 56px`
- Eyebrow: 11px mono, `sub`, `letter-spacing: 1`: `// WHAT IT'S FOR`
- Title: 36px/600, `letter-spacing: -1`, `max-width: 680`, margin-bottom 48: "The small stuff of a life — in one calm, searchable place."
- Grid: 2 cols, `gap: 2px`, backgrounded by `rule` color with a 1px `rule` border + 6px radius + overflow hidden (the 2px gap produces hairline dividers between cells)
- Each cell: padding 32px, page bg color. Contents:
  - 11px mono number in accent: `01 —` / `02 —` / `03 —` / `04 —`
  - 20px/600 title, `letter-spacing: -0.3`, margin-bottom 8
  - 14px/1.6 body in `sub` color

Feature copy (exact):

1. **Track what matters** — "Runs, reads, meals cooked, coffees tried, hours slept. Log a line, move on. Look back whenever you want — no streaks guilting you into it."
2. **Food & groceries** — "Weekly shops, meal ideas, a recipe you liked twice. HomeHub keeps the running list and remembers which tomatoes were actually good."
3. **Plans with people** — "Dinners, trips, birthdays. Who you owe a call. Who brought what. Keep the small threads with the people you care about from fraying."
4. **Events & moments** — "Concerts you went to, the hike that was actually hard, the movie you cried at. A quiet record of the year, in your own words."

### 5. "A Week" Preview

- Padding: `80px 56px`, 1px top `rule`
- Eyebrow `// A WEEK`, title "One view, everything in its place." (36px/600, `-1` tracking, 40px margin-bottom, max-width 640)
- Calendar container: white bg, 1px `rule` border, 6px radius, overflow hidden
- **Header row:** 7-col grid, 1px bottom `rule`. Each cell: padding `14px 16px`, 11px mono, `sub`, 0.5 tracking, 1px right `rule` (except last). Labels: `MON 14` → `SUN 20`. Friday cell (index 4) highlighted with `#f4f1ea` bg.
- **Body:** 7-col grid, `min-height: 280px`. Each cell: padding 10px, 1px right `rule` (except last), flex column, 6px gap. Friday cell highlighted with `#fbf8f2` bg.
- **Event chips:** padding `6px 8px`, page bg, 3px radius, 11px, `border-left: 2px solid <color>` where color is accent for highlighted entries, `rule` otherwise. Line 1: title (ink, 500, 2px margin-bottom). Line 2: 9px mono sub uppercase tag.

Week contents (day → chips):

- Mon: `5k run · park` [track, accent]
- Tue: `miso cod` [food], `pottery class idea` [note]
- Wed: `8hr sleep` [track, accent]
- Thu: `finish "klara"` [read]
- Fri: `dinner @ tala` [plan, accent], `bring wine` [food]
- Sat: `grocery shop` [food], `coffee w/ mika` [plan]
- Sun: `sunday roast` [food], `call mom` [plan]

### 6. Self-Host Block

- Background: `#f2efe8` (warm sand), 1px top + bottom `rule`
- Padding: `80px 56px`
- 2-col grid, `1fr 1fr`, 48px gap, center-aligned

**Left:**

- Eyebrow `// YOURS TO KEEP`
- Title "Free forever when you run it yourself." (36px/600, `-1` tracking, `text-wrap: balance`, margin-bottom 16)
- Body (15px/1.6 sub, max-width 440, margin-bottom 24): "HomeHub is a single Docker container. Run it on a Raspberry Pi in your closet, a cheap VPS, or your laptop. Your notes, lists, and logs live as plain files on your disk — portable, inspectable, yours."
- 4 check-bullet rows (14px, 10px gap, 10px bottom margin). Check icon is a 14×14 SVG stroke in accent color (stroke-width 1.8, `M3 7.5L5.5 10 11 4`). Items:
  - Single docker-compose file, 12 lines
  - SQLite database · one backup file
  - Notes stored as plain markdown
  - No telemetry, no analytics, no accounts

**Right — terminal:**

- Background `#1a1a17` (ink), 6px radius, 24px padding
- 13px mono, `line-height: 1.7`, color `#d8d3c8`
- Comment lines in `#77736c`, prompt `$` in `#77736c`, image name in accent color
- Contents exactly:

  ```
  # 1. pull and run
  $ docker run -d \
      -p 3000:3000 \
      -v ~/homehub:/data \
      homehub/homehub:latest

  # 2. open in your browser
  → http://localhost:3000

  # 3. you're done. no cloud, no accounts.
  ```

### 7. Footer

- Padding `56px 56px 28px`
- 5-col grid, cols `2fr 1fr 1fr 1fr 1fr`, 32px gap
- **Col 1:** Logo + wordmark (matches nav), 12px meta below (sub, mono, 1.7 line-height): `Built in the open / github.com/homehub / MIT licensed, forever`
- **Cols 2–5:** Link groups. Header is 11px mono, sub, 0.5 tracking, 12px margin-bottom. Links are 13px, 7px margin-bottom, ink color.
  - **product:** features, pricing, changelog, status
  - **open source:** github, docs, contribute, sponsors
  - **community:** discord, forum, blog, newsletter
  - **more:** about, contact, privacy, terms

### 8. Footer Meta Strip

- Padding `16px 56px`, 1px top `rule`
- 11px mono, sub, 0.5 tracking, flex `space-between`
- Left: `© 2026 · homehub collective · mit`
- Right: `made quietly · for the small stuff of a life`

---

## Design Tokens

```css
/* Colors */
--bg: #fafaf7; /* page background, off-white */
--card: #ffffff; /* card surfaces */
--ink: #1a1a17; /* primary text, dark */
--sub: #77736c; /* secondary text, muted */
--accent: oklch(
  0.58 0.11 200
); /* muted teal — used for highlights, CTAs' accents, checkmarks, accent dots, highlighted chips */
--rule: rgba(26, 26, 23, 0.1); /* 1px borders, dividers, grid gaps */
--warm-sand: #f2efe8; /* self-host section bg */
--note-bg: #f4f1ea; /* inline note blocks, highlighted weekday header */
--friday-bg: #fbf8f2; /* highlighted weekday body cell */
--terminal-bg: #1a1a17; /* same as --ink */
--terminal-fg: #d8d3c8; /* terminal text */
--chart-empty: #ede8de; /* empty bar in the run chart */

/* Typography */
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

/* Spacing (no formal scale — uses these values) */
/* page horizontal padding: 56px
   section vertical padding: 80px (most), 88px/40px (hero)
   card padding: 14–18px
   terminal padding: 24px
   footer top: 56px */

/* Radii */
--radius-xs: 3px; /* buttons, pills, chips, note blocks */
--radius-sm: 6px; /* cards, calendar container, terminal, features grid */

/* Shadows */
--shadow-card: 0 8px 24px -8px rgba(0, 0, 0, 0.1);

/* Type scale used */
/* H1 hero: 62/600/-2 tracking / 1.02 line-height */
/* H2 section: 36/600/-1 tracking */
/* Card title: 15–17/600/-0.3 tracking */
/* Feature title: 20/600/-0.3 tracking */
/* Body: 18/400/1.55 (hero sub) or 15/400/1.6 (self-host) or 14/400/1.6 (features) */
/* Meta / eyebrow: 11 mono / 0.5–1 tracking, uppercase or lowercase */
/* Chip title: 11/500 */
/* Tag: 9 mono / 0.5 tracking uppercase */
```

---

## Interactions & Behavior

This is a marketing landing page, so interactions are minimal but should feel polished.

- **Nav links**: smooth-scroll to sections if using anchor links
- **Primary CTAs** ("Start free →", "Try it free"): link to signup / hosted-app URL
- **"$ docker run homehub" secondary CTA**: could open a modal with full install commands, or scroll to the self-host section — recommend scroll
- **Cards in hero collage**: purely decorative; no click behavior required. A subtle `transform: translateY(-2px)` + deeper shadow on hover feels right but is optional.
- **Nav on scroll**: nav is sticky; on scroll >8px, consider adding a subtle 1px bottom-shadow to reinforce it sitting above content. Nothing else changes.
- **Hero entry animation (optional, nice-to-have)**: cards in the collage fade + rise 12px in with a 60ms stagger on mount. Respect `prefers-reduced-motion`.
- No forms, no auth flow, no state management — that all lives in the app itself.

### Responsive behavior (NOT explicitly designed)

Developer discretion, but suggested behavior:

- **≥1200px**: as designed.
- **900–1199px**: shrink horizontal padding to 40px; scale hero H1 down to ~52px; features grid stays 2×2.
- **600–899px**: stack hero to one column (card collage above or below); features grid collapses to 1 col; week preview horizontally scrolls (keep the 7-col grid, overflow-x auto on container); footer collapses to 2 cols.
- **<600px**: hero card collage replaced by a single stacked list of the 5 cards (drop rotations); nav collapses to hamburger; week preview scrolls.

---

## Assets

No custom assets / images. Everything is CSS + inline SVG:

- **Logo**: 18×18 SVG — a small house (rect + triangle roof) with a teal dot for the door. Stroke `ink`, 1.4 stroke-width. Source in `v2-indie.jsx` lines 27–30 and again in the footer.
- **Check icon**: 14×14 SVG in accent color, path `M3 7.5L5.5 10 11 4`, stroke-width 1.8.
- **Fonts**: Inter (400/500/600/700) + JetBrains Mono (400/500) via Google Fonts. Load via `<link>` or self-host in the target codebase per its convention.

---

## Files in this bundle

- `README.md` — this document
- `v2-indie.jsx` — the full V2 design as a React component (inline styles; treat as visual reference, not a component contract)
- `HomeHub Website.html` — the parent prototype (canvas view with V1/V2/V3 side-by-side) — useful for context; **V2 is the target**
