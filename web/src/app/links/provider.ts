// URLs and paths in terminal output are Cmd/Ctrl-clickable: URLs open in a
// new tab, paths in the file pane.
import type { ILink, ILinkProvider, Terminal as XTerm } from '@xterm/xterm';
import { daemonFetch } from '../daemon/client.ts';
import { exists } from '../files/api.ts';
import { openInPane } from '../files/open.ts';
import { isMac } from '../ui/dom.ts';
import { findLinks } from './links.ts';

type LinkSession = { id: string; closed: boolean };

const existsCache = new Map<string, { at: number; ok: Promise<boolean> }>(); // `${session}\0${path}`

// A path is underlined only once the daemon says it resolves.
function pathExists(s: LinkSession, path: string): Promise<boolean> {
  const key = `${s.id}\0${path}`;
  const now = Date.now();
  const hit = existsCache.get(key);
  if (hit && now - hit.at < 5000) return hit.ok;
  if (existsCache.size > 500) {
    for (const [k, v] of existsCache) if (now - v.at >= 5000) existsCache.delete(k);
  }
  const ok = exists(daemonFetch, s.id, path).catch(() => false);
  existsCache.set(key, { at: now, ok });
  return ok;
}

// `session()` because the session object is created after the terminal.
export function linkProvider(session: () => LinkSession, term: XTerm, el: HTMLElement): ILinkProvider {
  return {
    provideLinks(y, cb) {
      // Join the wrapped rows of this logical line, cell by cell, keeping
      // each UTF-16 unit's cell so offsets map back to 1-based {x, y}.
      const buf = term.buffer.active;
      let top = y - 1;
      while (top > 0 && buf.getLine(top)?.isWrapped) top--;
      let text = '';
      const cells: { x: number; y: number; w: number }[] = [];
      for (let row = top; ; row++) {
        const line = buf.getLine(row);
        if (!line || (row > top && !line.isWrapped)) break;
        for (let x = 0; x < line.length; x++) {
          const cell = line.getCell(x);
          if (!cell || cell.getWidth() === 0) continue; // trailing half of a wide character
          const chars = cell.getChars() || ' ';
          for (let i = 0; i < chars.length; i++) cells.push({ x: x + 1, y: row + 1, w: cell.getWidth() });
          text += chars;
        }
      }
      const s = session();
      Promise.all(
        findLinks(text).map(async (f): Promise<ILink | null> => {
          const a = cells[f.start];
          const b = cells[f.end - 1];
          if (!a || !b || y < a.y || y > b.y) return null; // not on the hovered row
          if (f.kind === 'path' && !(await pathExists(s, f.text))) return null;
          return {
            range: { start: { x: a.x, y: a.y }, end: { x: b.x + b.w - 1, y: b.y } },
            text: f.text,
            decorations: { underline: true, pointerCursor: true },
            hover: () => {
              el.title = isMac ? '⌘-click to open' : 'Ctrl-click to open';
            },
            leave: () => {
              el.title = '';
            },
            activate(e) {
              if (!(isMac ? e.metaKey : e.ctrlKey)) return;
              if (f.kind === 'url') window.open(f.text, '_blank', 'noopener,noreferrer');
              else openInPane(s, f);
            },
          };
        }),
      ).then(
        (links) => cb(links.filter((l): l is ILink => l !== null)),
        () => cb(undefined),
      );
    },
  };
}
