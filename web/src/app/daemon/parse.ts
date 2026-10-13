// Accepts a pairing link, its `#token=…` fragment, or the bare token.
export function parseToken(text: string): string | null {
  const t = text.trim();
  return /token=([0-9a-f]+)/i.exec(t)?.[1] ?? (/^[0-9a-f]{32,}$/i.test(t) ? t : null);
}

// Whether the pairing link's token stays in the address bar: only on another
// device, which reaches the daemon by IP. Saving the page to an iPhone's home
// screen keeps the address but not the storage, so it needs the token there.
export function keepsTokenInAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !host.startsWith('127.');
  return host.includes(':') && host !== '::1' && !/^::ffff:127\./.test(host);
}
