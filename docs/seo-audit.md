# SEO audit — tabsh

**Scope:** marketing pages (`/`, `/docs/`, `/changelog/`), demo (`/demo/`), hosted app (`/app/`), plus robots/sitemap/_headers infrastructure.

## Findings

1. **Homepage metadata is stale vs. the new value proposition (highest priority).**
   - Title: `tabsh: every project, one list`
   - Description: `A tiny Rust daemon runs your shells and agents locally. The list view keeps every card, across every project, in one browser tab.`
   - Neither mentions the calmer framing; neither leads with the promise. The value prop now lives in the masthead, h1 and README, but not in the metadata that drives SERP snippets and social previews. Needs to follow the value-prop update (see `docs/landing-value-prop-audit.md`).

2. **OG image alt is generic:** `tabsh board beside a terminal` — no value prop.

3. **`SoftwareApplication` JSON-LD: `operatingSystem: "macOS"` only** — the product ships macOS and Linux.

4. **No `<meta name="robots" content="noindex">`** on `/app/` and `/demo/`; they rely solely on the Cloudflare `X-Robots-Tag: noindex` edge rules in `web/public/_headers`. Works today; add meta tags for defense in depth.

5. **Infrastructure looks sound:** robots.txt allows all + sitemap ref ✓; sitemap lists only `/`, `/docs/`, `/changelog/` (app/demo correctly absent) ✓; canonical absolute + trailing-slash normalized ✓; robots `index, follow` ✓; OG 1200×630 ✓; twitter `summary_large_image` ✓; theme-color ✓.

6. **App page metadata is bare:** `<title>tabsh</title>`, no description/OG — acceptable only because of the edge noindex.

## Verdict

The SEO *mechanics* are in place, but the *content* lags the value-prop work: home title/description/OG alt should reflect "a calmer way to work with agents, in a browser tab", and the SoftwareApplication OS field is incomplete.

## Status: applied

- Home title is now `tabsh: a calmer way to work with agents`; the description
  leads with the promise.
- OG alt is `A calmer way to work with agents in a browser tab`.
- `operatingSystem` is `macOS and Linux`.
- `/app/` and `/demo/` carry `<meta name="robots" content="noindex">` (and the
  embedded copy in `src/app.html` does too).
- `web/src/seo.test.ts` pins the new strings.
