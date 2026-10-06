// The tree itself, drawn by @pierre/trees. This is the only module that
// imports it, and it is only reached through `import()` (see explorer.ts), so
// the library stays out of the page's first load. Names come from the disk
// and are untrusted: the library renders them as text, and nothing here puts
// one in markup.
import { type ContextMenuItem, type ContextMenuOpenContext, FileTree } from '@pierre/trees';
import { el } from '../ui/dom.ts';
import { type RowAction, rowActions } from './listing.ts';

const LABELS: Record<RowAction, string> = { insert: 'Insert path', cd: 'cd here', tab: 'Open in new tab' };

let tree: FileTree | null = null;

// Shows `paths` in `mount`: the first call builds the tree, later ones
// replace its paths (open folders and the selection stay where they still
// exist). `onFile` hears a click on a file row, with its relative path.
// `onAction` hears a pick from a row's menu (right-click, its button, or
// Shift+F10), with the row's path as listed (a directory ends in `/`).
export function showTree(
  mount: HTMLElement,
  paths: string[],
  onFile: (path: string) => void,
  onAction: (action: RowAction, path: string) => void,
): void {
  if (tree) {
    tree.resetPaths(paths);
    return;
  }
  tree = new FileTree({
    paths,
    initialExpansion: 'closed',
    flattenEmptyDirectories: false,
    composition: {
      contextMenu: {
        triggerMode: 'both',
        buttonVisibility: 'when-needed',
        render: (item, ctx) => rowMenu(item, ctx, onAction),
      },
    },
  });
  tree.render({ containerWrapper: mount });
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
  return menu;
}
