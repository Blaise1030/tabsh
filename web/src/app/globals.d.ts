// xterm.js and its fit addon load from the SRI-pinned CDN scripts in
// pages/app/index.astro; their npm packages provide the types only.
declare const Terminal: typeof import('@xterm/xterm').Terminal;
declare const FitAddon: { FitAddon: typeof import('@xterm/addon-fit').FitAddon };
