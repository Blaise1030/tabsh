// Where a dragged tab lands among the others. No DOM here.

// The index a tab dropped at `x` takes among the other tabs, given their
// centers from left to right: it goes after every tab whose center it passed.
export function dropIndex(centers: number[], x: number): number {
  let i = 0;
  while (i < centers.length && centers[i] < x) i++;
  return i;
}

// `ids` in the order of `order`, with ids `order` doesn't name kept at the end.
export function inOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const at = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return [...items].sort((a, b) => at(a.id) - at(b.id));
}
