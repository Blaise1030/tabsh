# Filter menu redesign

Follow-up to `2026-11-19-board-views-design.md`, shaped by trying it on a
local copy (21 Nov 2026).

## Why

The first views menu worked but felt busy: five stacked blocks and two text
fields. It should match tabsh's quiet style, let people build a filter by
clicking, and keep tags and views as different things.

## Decided (by the user, while trying it)

- The Filter icon opens a narrow menu of **Views, Tags and Folders**. Each
  section always shows, with a hint when empty.
- **Tags and folders are a quick filter of their own**: tick boxes, any ticked
  tag and any ticked folder, as before views. Ticking never changes a view.
  **Save these as a view** turns the ticks into one.
- **Views** are picked by a click (again to clear). A view's query shows only
  on hover, with a pencil to edit it.
- The board shows cards matching **both** the view and the ticks.
- The **query editor appears only for New view or Edit**: the name, the
  query, outlined **and / or / not** buttons and **tag / folder / status**
  buttons (a field's narrows the list below to its values to tick), the list,
  then Delete (grey, red on hover), Cancel and Save.
- `&` and `|` are short for `and` and `or` when typed; the buttons insert the
  words.
- Errors show as a **toast** on Enter or Save; while typing the field only
  gets a red outline.
- No bracket button; brackets can still be typed.

## Builder's calls

- A tick right after an operator just clicked joins with it; otherwise with
  `and` (a top-level `or` bracketed first).
- A tick box shows ticked wherever the query asks for that value, not only at
  the top level, also while the query ends in a dangling operator.
- While the editor is open the ticks step aside; Cancel puts back the view,
  query and ticks; Save restores the ticks unless they became the view.
- The filter saved before views (`{ tags, folders }`) reads back as ticks.
