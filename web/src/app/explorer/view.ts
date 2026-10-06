// The tree itself, drawn by @pierre/trees. This is the only module that
// imports it, and it is only reached through `import()` (see explorer.ts), so
// the library stays out of the page's first load. Names come from the disk
// and are untrusted: the library renders them as text, and nothing here puts
// one in markup.
import { FileTree } from '@pierre/trees';

let tree: FileTree | null = null;

// Shows `paths` in `mount`: the first call builds the tree, later ones
// replace its paths (open folders and the selection stay where they still
// exist). `onFile` hears a click on a file row, with its relative path.
export function showTree(mount: HTMLElement, paths: string[], onFile: (path: string) => void): void {
  if (tree) {
    tree.resetPaths(paths);
    return;
  }
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
