# Design brief: NIPOST digital postcode inside Sorted

*A script to hand to Claude (or any design tool) to imagine the screens/visuals for this use case. Every fact below is real — drawn directly from this codebase, not invented for the pitch.*

---

## One-line pitch

**An 11-character string that a courier can find a dry-cleaning shop by, read aloud over a phone call, or type with one thumb on WhatsApp — turning Nigeria's new national postcode system into the thing that makes last-mile delivery actually work on Sorted.**

---

## The real problem (not a hypothetical)

Sorted already runs real courier dispatch — `DeliveryService` calls KWIK to pick up and drop off laundry and dry-cleaning jobs. That integration has existed for a while. But it has a hard requirement nobody ever satisfied: it needs **precise GPS coordinates** for both the client's pickup point and the professional's shop.

Nothing in the product — not the web form, not the mobile app, not the WhatsApp bot — has ever collected those coordinates. Every single courier dispatch has been **silently failing closed**: logged, a `DeliveryTask` row written with a failure reason, nothing surfaced to anyone. The code even already said so, in its own comment: *"client location has no geocoded coordinates... WhatsApp-originated gigs commonly lack this."*

The missing piece was never geocoding technology. It was that building a map-picker UI — across a website, a mobile app, and a WhatsApp conversation — is a real, expensive piece of design and engineering work that nobody had done. A map picker inside a WhatsApp chat barely even makes sense.

## The solution: a postcode is just a string

Nigeria's National Digital Postcode (NIPOST, launched 1 October 2026) turns a physical location into an 11-character alphanumeric code, e.g. `LA-11-W06-TC-10`. That's small enough to:
- type into a one-line text field,
- read aloud on a phone call,
- send as a WhatsApp message with zero formatting.

That collapses "add a map picker to three different clients" into "add one optional text field, resolve it to coordinates on the server." Sorted built exactly that:
- `Gig.postcode` and `User.professionalAddressPostcode` — new, optional fields, never required, never blocking existing flows.
- A `PostcodeService` that validates the format offline (free, instant, no network call for a typo) and then calls NIPOST's real API to resolve it to latitude/longitude — **confirmed working against NIPOST's live API**, not a mockup.
- That resolution automatically fills the exact two fields `DeliveryService` was always reading but never received: the client's pickup coordinates and the professional's shop coordinates.
- A plain-language field on the web app today: *"Got a NIPOST postcode? (optional) — pinpoints your exact pickup location for couriers. Don't have one yet? Just skip this."*

## The demo narrative — what the screens should show

This is the sequence worth designing and recording, because every step is either already built or one small step from it:

1. **Before** — a client tries to describe a shop's location in free text ("behind the blue gate, third house after the junction"). A courier app has nowhere to put that. Dispatch has nowhere to send a pin. (This is Sorted's actual status quo today, not dramatized.)
2. **A client posts a dry-cleaning pickup gig.** Instead of fighting with a map, they type one thing: their NIPOST postcode. One field, one hint line, clearly optional — skippable for anyone who doesn't have one yet.
3. **A professional's shop has its own postcode**, set once in their profile — the same one-field, same validation pattern, reused rather than reinvented.
4. **The resolve happens invisibly, server-side.** No spinner the user has to wait on in a meaningful way — the postcode becomes a pin on a map the moment it's typed.
5. **The payoff**: a courier dispatch that has, for the first time, a real pickup point and a real drop-off point — not a failure log entry. The same `DeliveryService` code that's been running for weeks, finally fed what it needed.
6. **The emotional beat**: this isn't "Sorted integrated a government API." It's "the thing that was quietly broken since launch — every laundry pickup silently failing to dispatch — got fixed by a single text field," because the real blocker was never the technology, it was the UI nobody had built.

## Direction for the design tool

Imagine this as a short, contrastive sequence — not a feature tour. Lead with the *failure state* (a courier app with no pin, a dispatch that silently died) before showing the fix. The visual hook is the contrast between "describing a location in words" (slow, ambiguous, fails) and "an 11-character code" (fast, exact, works) — not the postcode system itself, which is just infrastructure. Stay inside Sorted's real, already-live design system: deep green (`#0F2A24`), lime accent (`#9BE07A`), cream background (`#F2EEE3`), Bricolage Grotesque for headings, IBM Plex Mono for the postcode string itself (it reads like a code, so it should look like one). Reuse the existing field copy verbatim where it appears — it's already been written and shipped, not a placeholder.

What's **not** part of this story: Enough (the separate money-planning product), BVN/KYC, or anything about virtual accounts — this is specifically Sorted's gig-marketplace delivery problem, solved by one government API doing one job.
