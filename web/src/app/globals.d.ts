// xterm.js and its fit addon load from the SRI-pinned CDN scripts in
// pages/app/index.astro; their npm packages provide the types only.
declare const Terminal: typeof import('@xterm/xterm').Terminal;
declare const FitAddon: { FitAddon: typeof import('@xterm/addon-fit').FitAddon };

// The subset of the Navigation API the router uses (nav/router.ts);
// TypeScript's DOM lib has only NavigationHistoryEntry so far.
interface NavigationResult {
  committed: Promise<NavigationHistoryEntry>;
  finished: Promise<NavigationHistoryEntry>;
}
interface NavigationDestination {
  readonly url: string;
  readonly sameDocument: boolean;
}
interface NavigateEvent extends Event {
  readonly navigationType: 'push' | 'replace' | 'reload' | 'traverse';
  readonly destination: NavigationDestination;
  readonly canIntercept: boolean;
  readonly hashChange: boolean;
  readonly downloadRequest: string | null;
  readonly info: unknown;
  readonly signal: AbortSignal;
  intercept(options?: { handler?: () => Promise<void> }): void;
}
interface Navigation extends EventTarget {
  readonly currentEntry: NavigationHistoryEntry | null;
  entries(): NavigationHistoryEntry[];
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly transition: { readonly finished: Promise<void> } | null; // a navigation still running
  navigate(url: string, options?: { history?: 'auto' | 'push' | 'replace'; info?: unknown }): NavigationResult;
  traverseTo(key: string): NavigationResult;
  back(): NavigationResult;
  forward(): NavigationResult;
  addEventListener(type: 'navigate', listener: (e: NavigateEvent) => void): void;
  addEventListener(type: 'navigatesuccess', listener: () => void): void;
}
declare const navigation: Navigation;
