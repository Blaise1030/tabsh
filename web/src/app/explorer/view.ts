// The tree itself, drawn by @pierre/trees. This is the only module that
// imports it, and it is only reached through `import()` (see explorer.ts), so
// the library stays out of the page's first load. Names come from the disk
// and are untrusted: the library renders them as text, and nothing here puts
// one in markup.
import { type ContextMenuItem, type ContextMenuOpenContext, FileTree } from '@pierre/trees';
import { el } from '../ui/dom.ts';
import type { Op } from './changes.ts';
import { enterAction, menuStep, type RowAction, rowActions } from './listing.ts';

const LABELS: Record<RowAction, string> = { insert: 'Insert path', cd: 'cd here', tab: 'Open in new tab' };

// Names are never cut with `…`: the whole name is laid out, and only one too
// long for the row fades out in its last 1.5rem, so the sidebar melts into the
// terminals. The unused decoration lane and the action lane are dropped so
// names get the room (a row's menu button floats over the faded end on its
// own), and the tree's side padding is cut to 4px. (A rename's input is left
// unfaded.)
const TREE_CSS = `
  :host { --trees-padding-inline-override: 4px; }
  [data-item-section="decoration"]:empty, [data-item-section="action"] { display: none; }
  [data-item-section="content"] {
    flex: 1 1 0;
    mask-image: linear-gradient(to right, #000 calc(100% - 1.5rem), transparent);
  }
  [data-item-section="content"]:has(input) { mask-image: none; }
  [data-truncate-segment-priority], [data-truncate-container] { flex: none; }
  [data-truncate-grid] { grid-template-columns: max-content; }
  [data-truncate-marker-cell] { display: none; }
`;

let tree: FileTree | null = null;
let shown: string[] = []; // the paths the last `showTree` was given

// Applies a live update's operations, together: open folders and the
// selection stay where they are.
export function applyOps(ops: Op[]): void {
  if (tree && ops.length) tree.batch(ops);
}

export const openSearch = (): void => tree?.openSearch();
export const closeSearch = (): void => tree?.closeSearch();
export const isSearchOpen = (): boolean => !!tree?.isSearchOpen();

// Shows `paths` in `mount`: the first call builds the tree, later ones
// replace its paths (open folders and the selection are carried over where
// they still exist: `resetPaths` alone would close every folder). `onFile` hears a click on a file row, with its relative path.
// `onAction` hears a pick from a row's menu (right-click, its button, or
// Shift+F10), with the row's path as listed (a directory ends in `/`).
export function showTree(
  mount: HTMLElement,
  paths: string[],
  onFile: (path: string) => void,
  onAction: (action: RowAction, path: string) => void,
): void {
  if (tree) {
    const open = shown.filter((p) => {
      const item = p.endsWith('/') ? tree?.getItem(p) : null;
      return !!item && 'isExpanded' in item && item.isExpanded();
    });
    const selected = tree.getSelectedPaths();
    tree.resetPaths(paths, { initialExpandedPaths: open });
    shown = paths;
    for (const p of selected) tree.getItem(p)?.select();
    return;
  }
  shown = paths;
  tree = new FileTree({
    paths,
    initialExpansion: 'closed',
    flattenEmptyDirectories: false,
    search: true,
    fileTreeSearchMode: 'hide-non-matches',
    unsafeCSS: TREE_CSS,
    composition: {
      contextMenu: {
        triggerMode: 'both',
        buttonVisibility: 'when-needed',
        render: (item, ctx) => rowMenu(item, ctx, onAction),
      },
    },
  });
  tree.render({ containerWrapper: mount });
  // Enter on the focused match opens it like a click would (a folder toggles).
  // This runs before the library's own Enter, which closes the search.
  mount.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' || !tree?.isSearchOpen()) return;
      const path = tree.getFocusedPath();
      const action = enterAction(path);
      if (!path || !action) return;
      if (action === 'open') onFile(path);
      else {
        const item = tree.getItem(path);
        if (item && 'toggle' in item) item.toggle();
      }
    },
    true,
  );
  // A click is read from the row it lands on, not from the selection, so
  // clicking the open file again opens it again.
  mount.addEventListener('click', (e) => {
    for (const node of e.composedPath()) {
      if (!(node instanceof HTMLElement) || node.dataset.type !== 'item') continue;
      const path = node.dataset.itemPath;
      if (node.dataset.itemType === 'file' && path) onFile(path);
      return;
    }
  });
}

// A row's menu. The names it shows are fixed labels; the row's name never
// reaches the markup. A pick closes the menu without taking focus back to the
// row: the caller sends it to the terminal.
function rowMenu(
  item: ContextMenuItem,
  ctx: ContextMenuOpenContext,
  onAction: (action: RowAction, path: string) => void,
): HTMLElement {
  const path = item.kind === 'directory' && !item.path.endsWith('/') ? `${item.path}/` : item.path;
  const menu = el('div', { className: 'row-menu', role: 'menu', ariaLabel: 'File actions' });
  for (const action of rowActions(path)) {
    const button = el('button', { type: 'button', role: 'menuitem', textContent: LABELS[action] });
    button.onclick = () => {
      ctx.close({ restoreFocus: false });
      onAction(action, path);
    };
    menu.append(button);
  }
  // Keys: arrows, Home and End move between items (buttons already take Enter
  // and Space); Escape closes and the row gets focus back. The menu is in the
  // DOM only after this returns, so focus waits a frame (and leaves it alone
  // if a key already moved it by then).
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  menu.addEventListener('keydown', (e) => {
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = menuStep(at, items.length, e.key);
    if (e.key !== 'Escape' && to === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (to === null) ctx.close({ restoreFocus: true });
    else items[to]?.focus();
  });
  queueMicrotask(() => requestAnimationFrame(() => menu.contains(document.activeElement) || items[0]?.focus()));
  return menu;
}
