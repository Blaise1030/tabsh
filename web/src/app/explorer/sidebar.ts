// The sidebar's chrome: the root's name, the folders-only note, the tree's
// host and the message shown in its place, then the divider that resizes it.
// All of it follows explorer.ts's states; the tree's host is made once here
// and filled by view.ts. The root's name and path come from the disk: text
// and an attribute value only.
import van from 'vanjs-core';
import { message, note, open, root, width } from './explorer.ts';

const { aside, div, p } = van.tags;

export function Sidebar(): HTMLElement[] {
  return [
    aside(
      {
        id: 'explorer',
        hidden: () => !open.val,
        'aria-label': 'Files',
        // Unset until the settings apply: the stylesheet's default holds.
        style: () => (width.val === null ? '' : `--explorer-width: ${width.val}px`),
      },
      p(
        { id: 'explorer-root', hidden: () => !root.val, title: () => root.val?.path ?? '' },
        () => root.val?.name ?? '',
      ),
      p({ id: 'explorer-note', hidden: () => !note.val }, 'Too many files to list, so only folders are shown.'),
      div({ id: 'explorer-tree', hidden: () => message.val !== null }),
      p({ id: 'explorer-msg', hidden: () => !message.val }, () => message.val ?? ''),
    ),
    div({ id: 'explorer-divider', hidden: () => !open.val }),
  ];
}
