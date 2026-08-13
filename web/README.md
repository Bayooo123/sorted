# Sorted — landing page

Single static page (no framework, no build step) using the design tokens
from `HANDOFF.md` §6. Not part of the product spec — `HANDOFF.md` and
`SPEC.md` cover the mobile app and API only, so this is a placeholder
marketing/waitlist page, not a pixel-accurate implementation of anything in
`/screens`.

## Why this exists

`HANDOFF.md` §2 puts the API on Railway/Render, not Vercel. So whatever
Vercel project was returning `404: DEPLOYMENT_NOT_FOUND` for "sorted" was
never meant to serve the NestJS app in this repo — it's this landing page.

## Deploying

This folder has no `package.json` and needs no build command — it's
served as static files.

In the Vercel project's **Settings → General → Root Directory**, set it to
`web`. Framework preset can stay "Other" (no build command, no install
command, output directory `.`). Do **not** point the Vercel project at the
repo root — the root contains the NestJS API, which Vercel's static/edge
runtime is not set up to run in this repo (it deploys to Railway/Render
instead, per `HANDOFF.md` §2).

## Editing

Everything is in `index.html` — inline CSS, no dependencies. The email
capture form is a client-side-only placeholder right now (see the comment
in the `<script>` tag); it doesn't submit anywhere yet.
