// Dropping files on the terminal types their paths at the prompt (as a
// paste, so TUIs like Claude Code pick up image paths). Browsers never
// reveal a dropped file's real path, so files are uploaded to the daemon
// first and the saved copy's path is used.
import { CARD_DRAG, drawer, shown } from '../board/view.ts';
import { daemonFetch } from '../daemon/client.ts';
import { store } from '../sessions/store.ts';
import { localPaths, shellQuote } from './drop-paths.ts';

// Not a card dragged on the board, nor anything while the board hides the
// terminals (with its drawer open, they show).
const isDroppable = (dt: DataTransfer | null): dt is DataTransfer =>
  !!dt &&
  (!shown.val || drawer.val) &&
  !dt.types.includes(CARD_DRAG) &&
  ['Files', 'text/uri-list', 'text/plain'].some((t) => dt.types.includes(t));

async function uploadFile(file: File): Promise<string> {
  const res = await daemonFetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  if (!res.ok) throw new Error(`upload ${file.name}: ${res.status}`);
  return (await res.json()).path;
}

async function textForDrop(dt: DataTransfer): Promise<string> {
  const local = localPaths(dt.getData('text/uri-list') || '');
  if (local.length) return `${local.map(shellQuote).join(' ')} `;
  const files = [...dt.files];
  if (files.length) {
    const paths = await Promise.all(files.map(uploadFile));
    return `${paths.map(shellQuote).join(' ')} `;
  }
  return dt.getData('text/plain') || '';
}

export function initDrop(): void {
  const glow = document.getElementById('drop-glow') as HTMLElement;
  window.addEventListener('dragenter', (e) => {
    if (isDroppable(e.dataTransfer)) glow.classList.add('active');
  });
  window.addEventListener('dragover', (e) => {
    if (!isDroppable(e.dataTransfer)) return;
    glow.classList.add('active');
    e.preventDefault(); // allow the drop (and stop the browser opening the file)
    const allowed = e.dataTransfer.effectAllowed;
    e.dataTransfer.dropEffect = allowed === 'move' || allowed === 'link' ? allowed : 'copy';
  });
  // relatedTarget is null only when the pointer leaves the window.
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) glow.classList.remove('active');
  });
  window.addEventListener('dragend', () => glow.classList.remove('active'));
  window.addEventListener('drop', async (e) => {
    glow.classList.remove('active');
    // A drop the page already took (a card dropped on a board column, which
    // carries its id as text) isn't for the terminal.
    if (e.defaultPrevented || !isDroppable(e.dataTransfer)) return;
    e.preventDefault();
    const target = store.active;
    if (!target) return;
    try {
      const text = await textForDrop(e.dataTransfer);
      if (text && !target.closed) {
        target.term.paste(text);
        target.term.focus();
      }
    } catch (err) {
      console.error(err);
    }
  });
}
