# Sorted brand assets

A single place for Sorted's logo, colors, fonts, and social media graphics — collected from what's already live on the site, plus a first batch of new social posts.

## Logo

`logo/` holds the existing mark at every size currently used across the product:

- `favicon.svg` / `favicon-mark.svg` — the source vector mark (identical files; `favicon-mark.svg` is kept as the semantic name used for the brand mark elsewhere, `favicon.svg` as the browser-facing favicon)
- `apple-touch-icon.png` — iOS home-screen icon
- `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — PWA icons

The mark is a rounded square in `--green` (#0F2A24) holding three rounded bars — two in `--cream`, one shorter one in `--lime` — read as an abstract checklist/task mark. On a dark background, invert it: green bars on a `--lime` square (used in the social posts below).

Android adaptive-icon layers (background/foreground/monochrome, for the native app build) live in `mobile/assets/` at the repo root — not duplicated here since they're a build artifact of this same mark, not a separate design.

## Colors

```
--green:  #0F2A24   primary / dark backgrounds, headline text on light
--lime:   #9BE07A   accent — CTAs, highlighted words, the mark's third bar
--cream:  #F2EEE3   light background, body text on dark
--card:   #FBF9F4   card surface on a cream background
--muted:  #E6E1D3   subtle borders/dividers on a light background
```

Sourced from `index.html`'s `:root` — these are Sorted's only brand colors; don't introduce new ones without updating this file.

## Type

- **Headlines, logo wordmark:** Bricolage Grotesque, weight 700–800, tight tracking (`letter-spacing: -0.02em` to `-0.045em`)
- **Labels, eyebrows, footnotes, small UI text:** IBM Plex Mono, weight 500, uppercase, wide tracking (`letter-spacing: 0.14em`) for all-caps labels

Both load from Google Fonts:
```
https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,700;12..96,800&family=IBM+Plex+Mono:wght@500&display=swap
```

## Voice

Pulled from the site's own copy, not invented:
- Tagline: **"Consider it sorted."**
- What it is: "Skilled Nigerian artisans and professionals you can trust."
- The trust mechanic: **"Payment is only released once the job is done right."** (escrow, in plain words — never say "escrow" to users, say what it does.)
- Current live service: dry cleaning & laundry pickup in Yaba, Lagos — "Your clothes, picked up and returned. We sort the rest."

## Social posts

`social/` — four 1080×1080px posts (Instagram/LinkedIn square), covering brand, trust, the live service, and a how-it-works explainer:

1. `01-brand-tagline.png` — evergreen brand statement, good as a profile-grid anchor post
2. `02-trust-escrow.png` — the escrow/trust value prop
3. `03-live-now-promo.png` — promotes the current live dry-cleaning service in Yaba
4. `04-how-it-works.png` — three-step explainer

`social/source/` holds the editable HTML each was rendered from (1080×1080 CSS px, Chromium screenshot at 1:1 scale — open any of them in a browser to tweak copy/colors, no build step needed). To re-render after an edit, screenshot the file at viewport 1080×1080.

## Adding more

New social assets should: reuse the mark and wordmark exactly as shown in the existing four, pull color pairs from the palette above (not new ones), use Bricolage Grotesque for the headline and IBM Plex Mono for any small-caps label, and ground the copy in what the product actually does today — check `index.html` and `classic.html` for current live copy before writing something new.
