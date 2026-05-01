# Aicorn — Brand Guide

> **Crack the page once. Share the kernel.**

This is a 5-hour hackathon brand kit. Everything here is meant to be paste-able into the build by any team member without a designer in the loop.

---

## 1. Essence

**Aicorn is a shared aicorn-cache for the agent web.** Agents drop bloated HTML onto the network, the network cracks the page once, and stores the kernel — clean, agent-readable markdown — for everyone else to harvest. Contributors earn credits when their kernel is read.

The brand sits at an unusual intersection: warm and folkloric (squirrels, oaks, hoards) on top of cold infrastructure (proxies, ledgers, edges). Lean into both — the mascot energy is what people remember; the engineering credibility is what makes the pitch land.

**One-liner for slides:** *The shared cache for the agent web.*
**One-liner for devs:** *Stop scraping. Start hoarding.*
**One-liner for site owners:** *One aicorn. Every agent reads from it.*

---

## 2. Name

- **Aicorn** — title case. This is the canonical brand spelling.
- **AICORN** — all caps, allowed in headlines, banners, t-shirts. Never in body copy.
- ❌ Never: AiCorn, aiCorn, aicorn (lowercase outside URLs / code).

**Pronunciation:** /ˈeɪkɔːrn/ — same as "acorn." If anyone reads it as "A-I-corn" in conversation, smile and nod; the pun lands either way.

**Domain:** aicorn.tech

---

## 3. Voice & tone

**Smart, warm, slightly mischievous.** Like a friend who knows the system inside out and is about to show you a shortcut.

- **DO:** "Crack the page once."
- **DON'T:** "Aicorn revolutionizes how AI agents consume web content."
- **DO:** "10 credits per read. 9 go back to the contributor."
- **DON'T:** "Pioneering blockchain-incentivized web extraction infrastructure."
- **DO:** One small squirrel/oak metaphor per page. Make it count.
- **DON'T:** Lard the copy with nut puns. One delight, not a dozen.
- **DO:** Use numbers. "8,000 tokens → 400 tokens." "$0.02 → $0."
- **DON'T:** Use words like *revolutionary*, *seamless*, *next-generation*, *paradigm*.

The voice is **specific**, not vague. Specifics are funny and trustworthy. Vague is neither.

---

## 4. Color palette

Six colors. That's the whole palette.

| Role | Name | Hex | Use |
|---|---|---|---|
| Anchor | **Oak** | `#4A2F1B` | The cap. Headlines on cream, the deepest brand color. |
| Primary | **Acorn** | `#B17F4A` | The body. Mid-tones, illustrations, secondary surfaces. |
| Accent | **Spark** | `#F5B538` | The AI kernel. Highlights, CTAs, the lightning-bolt. **Use sparingly** — one element per screen. |
| Secondary | **Moss** | `#2F5D3F` | Success states, "cache HIT" indicators, positive numbers. |
| Background | **Cream** | `#FBF6EC` | Default page background. Warm, never sterile white. |
| Text | **Ink** | `#1C1814` | Body copy on cream. Almost-black with a brown tint, never pure `#000`. |

### CSS variables — paste this into the project

```css
:root {
  --oak:    #4A2F1B;
  --acorn:  #B17F4A;
  --spark:  #F5B538;
  --moss:   #2F5D3F;
  --cream:  #FBF6EC;
  --ink:    #1C1814;
}
```

### Combinations that work

- `--cream` background + `--ink` text + `--oak` headlines + `--spark` highlights = **default surface**
- `--oak` background + `--cream` text + `--spark` CTAs = **dark mode / hero section**
- `--moss` for cache HIT, `--acorn` for cache MISS, `--spark` for "you earned" credit moments

### Combinations that don't

- `--spark` on `--cream` for body text (terrible contrast — accent only)
- `--oak` on `--moss` (mud)
- `--acorn` on `--cream` for small text (washes out)

---

## 5. Typography

Three Google Fonts. Free, fast, no licensing.

| Use | Font | Weights |
|---|---|---|
| Display / headlines | **Fraunces** | 600, 800 |
| Body / UI | **Inter** | 400, 500, 700 |
| Code / numbers / dashboards | **JetBrains Mono** | 400, 700 |

### One-line include

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Inter:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
```

### Type scale (rem-based)

```css
--font-display: 'Fraunces', Georgia, serif;
--font-body:    'Inter', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', ui-monospace, monospace;

h1 { font-family: var(--font-display); font-weight: 800; font-size: 3.5rem; line-height: 1.05; letter-spacing: -0.02em; }
h2 { font-family: var(--font-display); font-weight: 600; font-size: 2.25rem; line-height: 1.15; }
h3 { font-family: var(--font-display); font-weight: 600; font-size: 1.5rem; line-height: 1.25; }
p, li { font-family: var(--font-body); font-weight: 400; font-size: 1rem; line-height: 1.55; }
.metric { font-family: var(--font-mono); font-weight: 700; font-variant-numeric: tabular-nums; }
```

### Voice in type

- Big metric numbers in JetBrains Mono Bold. *Always* tabular-nums (`font-variant-numeric: tabular-nums`) so digits don't shimmy as they update on the dashboard.
- Headlines in Fraunces (warm, slightly bookish).
- Body in Inter (no-nonsense, modern).
- Never mix Fraunces and Inter in the same line. Pick one per element.

---

## 6. Logo

**The Aicorn logo is the wordmark itself.** No icon. The word *Aicorn* set in Fraunces 800, deep oak, slight negative letter-spacing. That's the entire mark.

This is intentional. In a 5-hour hackathon a confident wordmark looks far more grown-up than a half-baked icon, and it never breaks. Linear, Vercel, Stripe, Substack, and Cursor all stayed wordmark-only for years — we're in good company.

The squirrel illustration is a separate asset. It lives in marketing surfaces (landing-page hero, dashboard empty states, slide decks) — never inside the logo. Keeping the warm mascot and the restrained mark as two distinct assets is what gives the brand its character.

### Files in this repo

- `assets/logo.svg` — primary wordmark, oak on transparent
- `assets/logo-on-dark.svg` — cream wordmark, for dark backgrounds (oak hero sections, dark slides)
- `assets/logo-spark.svg` — variant with a `--spark` dot replacing the tittle of the *i*, suggesting the AI kernel without literalism. Use sparingly.
- `assets/favicon.svg` — single capital *A* in Fraunces 800, for browser tabs and app icons. Aicorn doesn't compress to anything smaller.
- `assets/mascot.svg` (or .png) — *separate asset*, the squirrel illustration; not the logo

### Construction

- **Typeface:** Fraunces, weight 800
- **Color:** `--oak` (#4A2F1B) on light backgrounds; `--cream` (#FBF6EC) on dark
- **Letter-spacing:** −0.035em (slight negative for confidence)
- **Optional flourish:** a single `--spark` (#F5B538) dot replacing the tittle of the *i*. Reserved for hero sections and the launch site — not for default product chrome.

### Rules

- ✅ Always Fraunces 800 — never another weight or another font
- ✅ When rendering live HTML, ensure Fraunces is loaded before the logo paints (use `font-display: swap` and accept a brief fallback flash)
- ✅ For exports that need to render without the webfont (favicon, social previews), outline the text in Figma or Illustrator first
- ❌ Don't put the squirrel mascot next to the wordmark. They are separate assets that share a palette.
- ❌ Don't apply italic, drop-shadow, gradient, outline, or stretch
- ❌ Don't substitute Georgia, Times, or another serif except as fallback in code
- ❌ Don't all-caps it inside the logo (`AICORN` is allowed in headlines and t-shirts, never in the wordmark mark)

### Mascot direction (separate asset, not the logo)

A small chubby squirrel cradling a glowing aicorn. Lives in marketing only — landing page hero, dashboard empty-states, slide decks, social cards. Same palette. Generate via Midjourney/DALL-E with: *"flat illustration of a chubby brown squirrel holding a golden glowing acorn, warm cream background, cozy children's book style, palette: deep oak brown, warm acorn tan, honey gold spark, soft cream"*.

---

## 7. UI motifs

A few small details that make the brand feel cohesive across the proxy responses, the dashboard, and the landing page:

- **Cache HIT badge:** small pill, `--moss` background, `--cream` text, label `HIT`. Pair with a tiny ⚡︎ in `--spark` to imply "free harvest."
- **Cache MISS badge:** small pill, `--acorn` background, `--ink` text, label `MISS`. The first miss is the sowing; not a failure, a planting.
- **Token-savings counter:** large JetBrains Mono Bold number in `--oak`, label below in Inter Regular `--ink` 60% opacity. *Animate the count-up* — judges love the moment.
- **Credit transactions:** mono number, `+9` in `--moss`, `−10` in a muted `--ink`. Don't use red; Aicorn doesn't shame readers, it just meters them.
- **Background texture (optional):** a very faint repeating cap-stitch pattern at 4% opacity on the cream surface. Makes the brand feel tactile.

---

## 8. Five-hour implementation kit

Everything you need, in one block, paste and ship:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Aicorn — Crack the page once. Share the kernel.</title>
  <link rel="icon" href="/assets/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Inter:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --oak: #4A2F1B; --acorn: #B17F4A; --spark: #F5B538;
      --moss: #2F5D3F; --cream: #FBF6EC; --ink: #1C1814;
      --font-display: 'Fraunces', Georgia, serif;
      --font-body: 'Inter', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body { background: var(--cream); color: var(--ink); font-family: var(--font-body); margin: 0; }
    h1, h2, h3 { font-family: var(--font-display); color: var(--oak); margin: 0 0 .5em; }
    h1 { font-weight: 800; font-size: 3.5rem; line-height: 1.05; letter-spacing: -0.02em; }
    .metric { font-family: var(--font-mono); font-weight: 700; font-variant-numeric: tabular-nums; color: var(--oak); }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: .75rem; font-weight: 700; letter-spacing: .05em; }
    .badge-hit  { background: var(--moss); color: var(--cream); }
    .badge-miss { background: var(--acorn); color: var(--ink); }
    .cta { background: var(--spark); color: var(--ink); padding: .75rem 1.25rem; border-radius: 8px; font-weight: 700; border: 0; cursor: pointer; }
  </style>
</head>
<body>
  <!-- ship it -->
</body>
</html>
```

---

## 9. Don't worry about

For a 5-hour build, skip:

- Multiple logo lockup variations (square, stacked, monochrome — make these later)
- Animation systems (one count-up animation on the demo metric is enough)
- Light/dark theme parity (the brand is light by default; a dark hero section is fine)
- Illustration set beyond the logo
- A type scale beyond h1/h2/h3/p/.metric
- Custom icons (use [Lucide](https://lucide.dev) — set color to `currentColor`, size to `1em`, done)

The brand exists to make the demo look intentional in five hours, not to win a Webby. Ship the demo. Brand polish comes after.
