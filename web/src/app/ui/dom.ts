// Small DOM helpers shared by the app's modules.

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

// Creates an element with properties and children.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}
