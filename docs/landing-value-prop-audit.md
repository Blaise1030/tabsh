# Audit: does the landing page reflect the value proposition?

**Value proposition under test:** "A calmer way to work with agents, in a browser tab"

**Date:** 2026-10-25 · **Audited against:** working tree (contains in-flight landing-page edits)

## Verdict: partially reflected — the masthead yes, the page as a whole no

## Evidence

| Touchpoint | Location | Status |
|---|---|---|
| Masthead tagline | `web/src/layouts/Site.astro:48` | ✅ Reflects the value prop verbatim: "A CALMER WAY TO WORK WITH AGENTS, IN A BROWSER TAB" |
| Intro copy | `web/src/pages/index.astro:42-44` | ✅ "shells and agents … in the browser tab next to your work … one calm scroll" |
| "Why a browser tab?" | `web/src/pages/index.astro:113-134` | ✅ Browser-tab framing present (new wording in working tree) |
| Homepage `<h1>` | `web/src/pages/index.astro:39` | ❌ "YOUR WHOLE BOARD, ONE LIST" — old frame, not the value prop |
| SEO `<title>` | `web/src/pages/index.astro:36` | ❌ "tabsh: every project, one list" — old frame |
| Meta `<description>` | `web/src/pages/index.astro:37` | ❌ Mechanism-framed ("tiny Rust daemon… list view… one browser tab"); no "calmer", doesn't lead with the promise |
| OG image alt | `web/src/seo.ts` (`OG_IMAGE.alt`) | ❌ "tabsh board beside a terminal" — no value prop |
| README lead | `README.md:3` | ✅ Now leads with the value prop (uncommitted change) |

## Findings

1. **The value prop is editorially current but structurally absent.** The tagline and intro carry it; the h1, SEO title and meta description predate it and still speak the previous positioning ("every project, one list" / daemon/list mechanics).
2. **The first-screen promise and the meta data disagree.** A cold visitor (or crawler) gets h1 + meta that never mention calm or agents; only the masthead tagline does.
3. **The value-prop edit is uncommitted.** README, `Site.astro`, `index.astro`, `docs.astro` all show working-tree modifications — the site is mid-edit and should be re-audited after commit.
4. **Tests will fight the copy.** `web/src/seo.test.ts:6-8` hardcodes the old title and description; `landing-frames.test.ts` does not currently pin the tagline or h1, so value-prop coverage is thin either way.

## Bottom line

The landing page now reflects the proposition consistently: the masthead tagline,
h1, SEO title, meta description, OG alt and README all speak the same frame,
without the h1 repeating the masthead verbatim. `web/src/seo.test.ts` and
`web/src/demo/landing-frames.test.ts` pin the strings, so the copy cannot drift
back silently.

## Status: applied
