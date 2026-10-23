// Link hygiene for chat markdown. Rendering uses `solid-markdown` with
// `renderingStrategy="reconcile"` so streaming updates only patch changed nodes.
// GFM autolinks cover bare URLs; remarkAutolinkPaths also wraps file paths from
// the same finder the terminal uses.
import type { Link, Parents, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';
import { findLinks } from '../links/links.ts';

const FILE_SCHEME = 'tabsh-file:';

export function safeHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const t = href.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith(FILE_SCHEME)) return t;
  if (t.startsWith('#') || t.startsWith('/') || t.startsWith('./') || t.startsWith('../')) return t;
  return null;
}

/** `solid-markdown` transformLinkUri: keep http(s), file links, and relative; drop the rest. */
export function transformLinkUri(href: string): string {
  return safeHref(href) ?? '';
}

export function encodeFileHref(path: string, line?: number): string {
  const base = `${FILE_SCHEME}${encodeURIComponent(path)}`;
  return line != null && Number.isFinite(line) ? `${base}#${line}` : base;
}

export function parseFileHref(href: string | undefined | null): { text: string; line?: number } | null {
  if (!href?.startsWith(FILE_SCHEME)) return null;
  const rest = href.slice(FILE_SCHEME.length);
  const hash = rest.indexOf('#');
  const body = hash >= 0 ? rest.slice(0, hash) : rest;
  const lineRaw = hash >= 0 ? rest.slice(hash + 1) : '';
  try {
    const text = decodeURIComponent(body);
    if (!text) return null;
    const line = lineRaw ? Number(lineRaw) : undefined;
    return line != null && Number.isFinite(line) ? { text, line } : { text };
  } catch {
    return null;
  }
}

/** Turn bare URLs and paths in text nodes into link nodes (skips existing links). */
export function remarkAutolinkPaths() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent: Parents | undefined) => {
      if (index == null || !parent || parent.type === 'link' || parent.type === 'linkReference') return;
      const found = findLinks(node.value);
      if (!found.length) return;
      const kids: Array<Text | Link> = [];
      let cursor = 0;
      for (const f of found) {
        if (f.start > cursor) kids.push({ type: 'text', value: node.value.slice(cursor, f.start) });
        const label = node.value.slice(f.start, f.end);
        kids.push({
          type: 'link',
          url: f.kind === 'url' ? f.text : encodeFileHref(f.text, f.line),
          children: [{ type: 'text', value: label }],
        });
        cursor = f.end;
      }
      if (cursor < node.value.length) kids.push({ type: 'text', value: node.value.slice(cursor) });
      parent.children.splice(index, 1, ...kids);
      return index + kids.length;
    });
  };
}
