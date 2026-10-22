// The sidebar's chrome, on the workspace's right: the divider that resizes it,
// then the root's name, the folders-only note, the tree's host and the
// message shown in its place.
// All of it follows explorer.ts's states; the tree's host is made once here
// and filled by view.tsx. The root's name and path come from the disk: text
// and an attribute value only.
import { createRenderEffect, type JSX, untrack } from 'solid-js';
import { drawTree, message, note, open, root, treeToDraw, width } from './explorer.ts';

export function Sidebar(): JSX.Element {
  const shown = open;
  const dir = root;
  const folders = note;
  const msg = message;
  const px = width;
  const host = (<div id="explorer-tree" />) as HTMLDivElement;
  // One effect shows the host and then draws the listing's tree into it, so
  // the tree is never drawn into a hidden host, whatever order Solid runs its
  // effects in.
  createRenderEffect(() => {
    const treeShown = msg() === null;
    host.hidden = !treeShown;
    const tree = treeToDraw();
    if (tree && treeShown && shown()) untrack(() => drawTree(host, tree));
  });
  return (
    <>
      <div id="explorer-divider" hidden={!shown()} />
      <aside
        id="explorer"
        hidden={!shown()}
        aria-label="Files"
        // Unset until the settings apply: the stylesheet's default holds.
        style={px() === null ? '' : `--explorer-width: ${px()}px`}
      >
        <p id="explorer-root" hidden={!dir()} title={dir()?.path ?? ''}>
          {dir()?.name ?? ''}
        </p>
        <p id="explorer-note" hidden={!folders()}>
          Too many files to list, so only folders are shown.
        </p>
        {host}
        <p id="explorer-msg" hidden={!msg()}>
          {msg() ?? ''}
        </p>
      </aside>
    </>
  );
}
