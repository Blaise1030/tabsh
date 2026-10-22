// The tags panel: every tag in use, checked when picked, and a field making
// a new one; toggling keeps it open. The card menu's Tags submenu shows it
// for a card (its "Tags ›" row opens it beside the menu), and New card's Tags
// chip for the card being made (`TagsPanel`). Basecoat's dropdown has no
// submenus, so the panel is the card menu's own: fixed beside the row (the
// popover scales and clips, so it can't hold it), and kept out of Basecoat's
// [role="menu"], whose clicks close the dropdown.
// Its handlers are native: the menu stops clicks and keys at its root, before
// Solid's delegated handlers on the document would see them.
// biome-ignore-all lint/a11y/useFocusableInteractive: Basecoat's rows: the menu keeps focus and marks the active row
import { createSignal, For, Show } from 'solid-js';
import { menuStep } from '../explorer/listing.ts';
import { addTag, tagColor, toggleTag } from '../sessions/labels.ts';
import type { Session } from '../sessions/store.ts';
import { setTags, usedTags } from '../sessions/tags.tsx';
import { icons } from '../ui/icons.tsx';

export interface TagsSubmenu {
  row: HTMLElement; // in the menu
  panel: HTMLElement; // beside it
  open(focus: boolean): void;
  close(): void;
}

export interface TagsPanel {
  panel: HTMLElement;
  field: HTMLInputElement; // making a new tag
  open(focus: boolean): void;
  close(): void;
}

// The panel for the tags `get` reads and `set` writes; `back` hears Escape
// (and ←, with `left`), for its opener to close it and take focus back.
export function TagsPanel(
  get: () => string[],
  set: (tags: string[]) => void,
  back: () => void,
  left = false,
): TagsPanel {
  const [shown, setShown] = createSignal(false);
  // The tags offered: those in use when it opened, and any made since.
  const [offered, setOffered] = createSignal<string[]>([]);
  const has = (tag: string) => get().includes(tag);

  const items = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>('input')];
  const field = (
    <input
      class="input"
      placeholder="New tag…"
      maxLength={24}
      autocomplete="off"
      spellcheck={false}
      aria-label="New tag"
      on:keydown={(e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        const added = addTag(get(), field.value);
        set(added);
        setOffered([...new Set([...offered(), ...added])].sort());
        field.value = '';
      }}
    />
  ) as HTMLInputElement;
  const panel = (
    <div
      class="tags-submenu"
      role="menu"
      aria-label="Tags"
      hidden={!shown()}
      // Arrows, Home and End move; Escape or ← goes back to the menu.
      on:keydown={(e) => {
        e.stopPropagation(); // Basecoat's dropdown would take these keys
        const all = items();
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape' || (left && e.key === 'ArrowLeft' && document.activeElement !== field)) {
          e.preventDefault();
          back();
          return;
        }
        if (document.activeElement === field && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const to = menuStep(at, all.length, e.key);
        if (to === null) return;
        e.preventDefault();
        all[to]?.focus();
      }}
    >
      {field}
      <div class="tags-submenu-list">
        <Show when={!offered().length}>
          <div class="tags-submenu-empty">No tags yet</div>
        </Show>
        <For each={offered()}>
          {(tag) => {
            const dot = `background:${tagColor(tag)}`;
            let box!: HTMLInputElement;
            return (
              <label class="label menu-check">
                <input
                  ref={box}
                  type="checkbox"
                  class="input"
                  tabindex="-1"
                  checked={has(tag)}
                  on:change={() => set(toggleTag(get(), tag, box.checked))}
                />
                <i style={dot} />
                <span>{tag}</span>
              </label>
            );
          }}
        </For>
      </div>
    </div>
  ) as HTMLElement;

  function open(focus: boolean) {
    if (!shown()) setOffered([...new Set([...usedTags(), ...get()])].sort());
    setShown(true);
    // Once it's laid out (and placed, by a submenu's frame queued first).
    if (focus) requestAnimationFrame(() => items()[0]?.focus());
  }
  function close() {
    setShown(false);
  }
  return { panel, field, open, close };
}

export function TagsSubmenu(s: () => Session | null): TagsSubmenu {
  const tags = TagsPanel(
    () => {
      const session = s();
      return session ? session.tags() : [];
    },
    (next) => {
      const session = s();
      if (session) setTags(session, next);
    },
    () => {
      close();
      row.focus();
    },
    true,
  );
  const { panel } = tags;

  // Beside the row: to the right of the menu, or to its left when there's
  // no room.
  const place = () => {
    const menu = row.closest('[data-popover]')?.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (!menu) return;
    panel.style.top = `${Math.max(8, Math.min(r.top - 5, innerHeight - panel.offsetHeight - 8))}px`;
    const width = panel.offsetWidth || 200;
    if (menu.right + width + 4 <= innerWidth) {
      panel.style.left = `${menu.right + 4}px`;
      panel.style.right = '';
    } else {
      panel.style.right = `${innerWidth - menu.left + 4}px`;
      panel.style.left = '';
    }
  };
  function open(focus: boolean) {
    // Laid out by the next frame: placed, then focused (queued next).
    requestAnimationFrame(place);
    tags.open(focus);
    row.setAttribute('aria-expanded', 'true');
  }
  function close() {
    tags.close();
    row.setAttribute('aria-expanded', 'false');
  }

  // A menu row: its click (and Basecoat's Enter, which clicks it) must not
  // reach the menu, whose handler would close the dropdown.
  const row = (
    <div
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded="false"
      class="tags-row"
      // Opens it (pointing at the row already may have): never toggles shut.
      on:click={(e) => {
        e.stopPropagation();
        open(false);
      }}
      on:mouseenter={() => open(false)}
    >
      {icons.tag()}
      <span>Tags</span>
      {icons.chevronRight()}
    </div>
  ) as HTMLElement;
  return { row, panel, open, close };
}
