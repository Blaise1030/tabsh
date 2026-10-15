// Where the service worker lives for a page path, or null when this page
// has none: only the real app at /app/ is installable, not the demo.
// Pure, so node --test can load it.
export function serviceWorkerUrl(pathname: string): string | null {
  if (pathname !== '/app' && !pathname.startsWith('/app/')) return null;
  return '/app/sw.js';
}

// Registers the service worker that makes the app installable as a PWA.
// Needs a secure context (localhost or https); the daemon also serves the
// app over plain http on other devices, where registration simply fails
// and the page keeps working as a normal (home-screen) page.
export function initPwa(): void {
  const url = serviceWorkerUrl(location.pathname);
  if (!url || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(url, { scope: '/app/' }).catch(() => {});
}
