// Dropping files on the terminal types their paths at the prompt (as a
// paste, so TUIs like Claude Code pick up image paths). Browsers never
// reveal a dropped file's real path, so files are uploaded to the daemon
// first and the saved copy's path is used. On a chat card, image files
// attach as composer badges instead (uploaded when the message is sent).
import { CARD_DRAG, drawer, shown } from '../board/view.tsx';
import { isImageFile } from '../chat/attach.tsx';
import { deliverAgentImages, deliverAgentText } from '../chat/deliver.ts';
import { uploadFile } from '../daemon/client.ts';
import { go } from '../nav/router.ts';
import { isChatCard, onScreen } from '../sessions/store.ts';
import { localPaths, shellQuote } from './drop-paths.ts';

// Not a card dragged on the board, nor anything while the board hides the
// terminals (with its drawer open, they show).
const isDroppable = (dt: DataTransfer | null): dt is DataTransfer =>
  !!dt &&
  (!shown() || drawer()) &&
  !dt.types.includes(CARD_DRAG) &&
  ['Files', 'text/uri-list', 'text/plain'].some((t) => dt.types.includes(t));

async function textForFiles(files: File[]): Promise<string> {
  if (!files.length) return '';
  const paths = await Promise.all(files.map(uploadFile));
  return `${paths.map(shellQuote).join(' ')} `;
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
    const target = onScreen();
    if (!target || target.closed) return;
    const chat = isChatCard(target);
    try {
      const local = localPaths(e.dataTransfer.getData('text/uri-list') || '');
      if (local.length) {
        deliverAgentText(chat, target.id, `${local.map(shellQuote).join(' ')} `, target.term);
      } else {
        const files = [...e.dataTransfer.files];
        if (files.length) {
          if (chat) {
            const images = files.filter(isImageFile);
            const other = files.filter((f) => !isImageFile(f));
            if (images.length) deliverAgentImages(target.id, images);
            const text = await textForFiles(other);
            if (text) deliverAgentText(true, target.id, text, target.term);
          } else {
            const text = await textForFiles(files);
            if (text) deliverAgentText(false, target.id, text, target.term);
          }
        } else {
          const plain = e.dataTransfer.getData('text/plain') || '';
          if (plain) deliverAgentText(chat, target.id, plain, target.term);
        }
      }
      if (chat && onScreen() !== target) go({ term: null });
    } catch (err) {
      console.error(err);
    }
  });
}
