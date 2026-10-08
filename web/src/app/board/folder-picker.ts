// The New card dialog's folder field as a search: typing lists the folders
// that complete it (the daemon's /api/files/folders), and until the field is
// edited the list offers recent folders. ↑↓ move, Enter picks, Tab picks and
// lists the picked folder's subfolders, Esc closes the list (not the dialog).
import van from 'vanjs-core';
import { daemonFetch } from '../daemon/client.ts';
import { expandHome, foldersUrl, moveActive, tildify } from './folders.ts';

const { li } = van.tags;

const SEARCH_DELAY_MS = 120;

export interface FolderPicker {
  // Starts over for a freshly opened dialog, with these recent folders and a
  // guess at the home folder (until the daemon says).
  reset(recent: string[], home: string | null): void;
  // What's typed, with `~` expanded once the home folder is known.
  value(): string;
}

export function initFolderPicker(input: HTMLInputElement, list: HTMLUListElement): FolderPicker {
  let home: string | null = null;
  let recent: string[] = [];
  let edited = false;
  let options: string[] = [];
  let active = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Answers can arrive out of order: only the latest request's is shown.
  let latest = 0;

  const close = () => {
    clearTimeout(timer);
    latest++;
    options = [];
    active = -1;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const highlight = (i: number) => {
    active = i;
    list.querySelectorAll('[role="option"]').forEach((li, n) => {
      li.setAttribute('aria-selected', String(n === i));
      if (n === i) li.scrollIntoView({ block: 'nearest' });
    });
    if (i >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${i}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const show = (folders: string[]) => {
    if (!folders.length) return close();
    options = folders;
    list.replaceChildren(
      ...folders.map((f, i) =>
        li(
          {
            id: `${list.id}-${i}`,
            title: f,
            role: 'option',
            // Keep focus in the field, so picking doesn't close the list on blur first.
            onmousedown: (e: MouseEvent) => e.preventDefault(),
            onclick: () => pick(i, false),
          },
          tildify(f, home),
        ),
      ),
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(0);
  };

  const search = async () => {
    clearTimeout(timer);
    const typed = input.value.trim();
    if (!edited || !typed) return show(recent);
    const mine = ++latest;
    try {
      const res = await daemonFetch(foldersUrl(typed));
      if (!res.ok) return;
      const body = (await res.json()) as { home: string; folders: string[] };
      home = body.home;
      if (mine === latest && document.activeElement === input) show(body.folders);
    } catch {
      // The daemon is unreachable: the field still takes a typed path.
    }
  };

  // Tab keeps going: the picked folder's subfolders are listed next.
  function pick(i: number, descend: boolean) {
    const path = tildify(options[i], home);
    input.value = descend ? `${path}/` : path;
    edited = true;
    if (descend) void search();
    else close();
  }

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  input.addEventListener('input', () => {
    edited = true;
    clearTimeout(timer);
    timer = setTimeout(search, SEARCH_DELAY_MS);
  });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    const open = !list.hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return void search();
      highlight(moveActive(active, e.key === 'ArrowDown' ? 1 : -1, options.length));
    } else if (open && active >= 0 && (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey))) {
      e.preventDefault();
      pick(active, e.key === 'Tab');
    } else if (open && e.key === 'Escape') {
      // Only the list closes; the dialog stays.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  return {
    reset(folders, guess) {
      recent = folders;
      home ??= guess;
      edited = false;
      close();
    },
    value: () => expandHome(input.value.trim(), home),
  };
}
