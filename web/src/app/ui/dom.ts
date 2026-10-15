// Small DOM helpers shared by the app's modules.

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

// A phone: a narrow touch screen. It has no tab mode, only the board, its
// terminals in the drawer; a narrow desktop window keeps its tabs.
export const phone = matchMedia('(max-width: 799px) and (pointer: coarse)');
