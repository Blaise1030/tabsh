// The tree itself, drawn by @pierre/trees. This is the only module that
// imports it, and it is only reached through `import()` (see explorer.ts), so
// the library stays out of the page's first load. Names come from the disk
// and are untrusted: the library renders them as text, and nothing here puts
// one in markup.
import { FileTree } from '@pierre/trees';
import type { Op } from './changes.ts';

let tree: FileTree | null = null;
let shown: string[] = []; // the paths the last `showTree` was given

// Applies a live update's operations, together: open folders and the
// selection stay where they are.
export function applyOps(ops: Op[]): void {
  if (tree && ops.length) tree.batch(ops);
}

// Shows `paths` in `mount`: the first call builds the tree, later ones
// replace its paths (open folders and the selection are carried over where
// they still exist: `resetPaths` alone would close every folder). `onFile` hears a click on a file row, with its relative path.
export function showTree(mount: HTMLElement, paths: string[], onFile: (path: string) => void): void {
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
  tree = new FileTree({ paths, initialExpansion: 'closed', flattenEmptyDirectories: false });
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
