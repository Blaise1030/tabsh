// The New card dialog's tags: chips in a box, and under it a list of the tags
// in use to pick several from, filtered by what's typed, with a row creating
// the typed tag when it's new. Enter or a click toggles the highlighted row
// and the list stays open; a comma makes the typed text a chip, Backspace on an
// empty box takes the last chip off, Esc closes the list (not the dialog).
// With nothing typed and no row highlighted, Enter creates the card.

import van from 'vanjs-core';
import { addTag, tagColor, tagOptions } from '../sessions/labels.ts';
import { tagBadge, usedTags } from '../sessions/tags.ts';
import { moveActive } from './folders.ts';

const { button, i: dot, li, span } = van.tags;

export interface TagPicker {
  // Starts over for a freshly opened dialog, with these tags picked.
  reset(tags: string[]): void;
  // The picked tags, with a typed one not yet made a chip counted too.
  tags(): string[];
}

export function initTagPicker(input: HTMLInputElement, chips: HTMLElement, list: HTMLUListElement): TagPicker {
  let picked: string[] = [];
  let active = -1;
  let rows = tagOptions([], [], '');

  const drawChips = () => {
    chips.replaceChildren(
      ...picked.map((tag) =>
        tagBadge(
          tag,
          button(
            {
              type: 'button',
              class: 'tag-off',
              'aria-label': `Remove ${tag}`,
              onclick: () => {
                picked = picked.filter((t) => t !== tag);
                drawChips();
                input.focus();
                if (!list.hidden) drawList();
              },
            },
            '×',
          ),
        ),
      ),
    );
  };

  const highlight = (i: number) => {
    active = i;
    list.querySelectorAll('[role="option"]').forEach((li, n) => {
      li.toggleAttribute('data-active', n === i);
      if (n === i) li.scrollIntoView({ block: 'nearest' });
    });
    if (i >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${i}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const close = () => {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    highlight(-1);
  };

  // `keep` highlights that tag's row again after a toggle; otherwise the
  // first row is highlighted once something is typed, and none before.
  function drawList(keep?: string) {
    rows = tagOptions(usedTags(), picked, input.value);
    if (!rows.length) return close();
    list.replaceChildren(
      ...rows.map((row, i) =>
        li(
          {
            id: `${list.id}-${i}`,
            class: row.create ? 'create' : '',
            role: 'option',
            'aria-selected': String(row.on),
            // Keep focus in the box, so picking doesn't close the list on blur first.
            onmousedown: (e: MouseEvent) => e.preventDefault(),
            onclick: () => toggle(i),
          },
          ...(row.create
            ? [`Create "${row.tag}"`]
            : [dot({ style: `background: ${tagColor(row.tag)}` }), span(row.tag)]),
        ),
      ),
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    const kept = keep === undefined ? -1 : rows.findIndex((r) => r.tag === keep);
    highlight(kept >= 0 ? kept : input.value.trim() ? 0 : -1);
  }

  function toggle(i: number) {
    const { tag, on } = rows[i];
    picked = on ? picked.filter((t) => t !== tag) : [...picked, tag];
    input.value = '';
    drawChips();
    drawList(tag);
  }

  // What's typed becomes chips (a pasted list may hold several).
  const commit = () => {
    picked = addTag(picked, input.value);
    input.value = '';
    drawChips();
  };

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  // A click in the box, beside the chips, goes to its text.
  (input.parentElement as HTMLElement).onclick = (e) => e.target === e.currentTarget && input.focus();
  input.addEventListener('focus', () => drawList());
  input.addEventListener('blur', close);
  input.addEventListener('input', () => {
    // A pasted list is taken at once.
    if (input.value.includes(',')) commit();
    drawList();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const open = !list.hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return drawList();
      highlight(moveActive(active, e.key === 'ArrowDown' ? 1 : -1, rows.length));
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault();
      toggle(active);
    } else if ((e.key === 'Enter' && input.value.trim()) || e.key === ',') {
      e.preventDefault();
      commit();
      if (open) drawList();
    } else if (e.key === 'Backspace' && !input.value && picked.length) {
      picked = picked.slice(0, -1);
      drawChips();
      if (open) drawList();
    } else if (e.key === 'Escape' && open) {
      // Only the list closes; the dialog stays.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  return {
    reset(tags) {
      picked = tags;
      input.value = '';
      drawChips();
      close();
    },
    tags() {
      commit();
      return picked;
    },
  };
}
