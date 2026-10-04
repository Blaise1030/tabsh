// Which daemon this page talks to. The tabsh-daemon meta tag names it
// (`?daemon=` overrides it); it's empty when the daemon serves this page.
const meta = document.querySelector<HTMLMetaElement>('meta[name="tabsh-daemon"]');
export const DAEMON = (
  new URLSearchParams(location.search).get('daemon') ??
  (meta?.content || location.origin)
).replace(/\/+$/, '');

// WebKit (Safari, and every iOS browser) blocks an https page from
// calling a daemon over plain http, even on loopback. Those browsers use
// the copy of this page the daemon serves; `/open` pairs it.
export const MIXED_BLOCKED =
  location.protocol === 'https:' && DAEMON.startsWith('http:') && navigator.vendor === 'Apple Computer, Inc.';

export const LOCAL_APP = `${DAEMON.replace(/:\/\/(127\.0\.0\.1|localhost):/, '://tabsh.localhost:')}/open`;
