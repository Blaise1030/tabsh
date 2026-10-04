// Accepts a pairing link, its `#token=…` fragment, or the bare token.
export function parseToken(text: string): string | null {
  const t = text.trim();
  return /token=([0-9a-f]+)/i.exec(t)?.[1] ?? (/^[0-9a-f]{32,}$/i.test(t) ? t : null);
}
