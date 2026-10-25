# Landing page content audit — redundancy & length

**Scope:** `web/src/layouts/Site.astro` (masthead), `web/src/pages/index.astro` (hero, sections, FAQ, install), SEO/README echoes.

## Redundancies found

1. **Hero repeats itself (introduced by the recent header fix).**
   The masthead tagline and the new `<h1>` now carry the same sentence —
   "A CALMER WAY TO WORK WITH AGENTS, IN A BROWSER TAB" (+ `#` mark) — so the
   value prop appears twice in the first screen. Redundant.

2. **Value prop tripled in the first screen.** Masthead + h1 (same line) and the
   intro paragraph ("runs your shells and agents in the browser tab next to your
   work… one calm scroll") restate the same idea. The intro is doing subhead work
   the h1 already did.

3. **Install copy duplicated.** The hero install block (§fig. 1 context: `curl`,
   `tabsh`, how?) overlaps with the GET IT install block (`$ curl`, `$ tabsh`).

4. **FAQ restates body copy.** Worktree Q ≈ agents section; agents/providers Q ≈
   providers section; safety Q ≈ features ("nothing leaves localhost").

5. **Features table overlaps body.** "Shells outlive the tab", "A bell, not a feed",
   "Nothing leaves localhost" are said in the body sections too.

## Length

Page flow: masthead → h1 → intro → install → why → list → agents → remote →
features → FAQ → install → EOF sig. Long-form for a landing page; FAQ + duplicate
install + hero repeat are the main inflation points.

## Recommended cuts (applied)

- Differentiate the h1 from the masthead: the h1 is now "YOUR SHELLS AND AGENTS,
  ONE CALM SCROLL"; the masthead keeps the value prop.
- Tighten the intro to a single beat.
- Dedupe install blocks: the closing footer links to the docs instead of
  repeating the command.
- FAQ entries already covered by body copy (worktree, agents/providers) were
  removed with the section rewrite. The board-vs-list and safety entries stay:
  both are questions visitors still arrive with.

**Verdict (before):** redundant, and longer than it needs to be.
**Verdict (after):** the first screen says one thing once; the body carries the
mechanism, and the closing CTA no longer repeats the hero install block.
