// Link hygiene for chat markdown. Rendering uses `solid-markdown` with
// `renderingStrategy="reconcile"` so streaming updates only patch changed nodes.

export function safeHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const t = href.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith('#') || t.startsWith('/') || t.startsWith('./') || t.startsWith('../')) return t;
  return null;
}

/** `solid-markdown` transformLinkUri: keep http(s) and relative, drop the rest. */
export function transformLinkUri(href: string): string {
  return safeHref(href) ?? '';
}
