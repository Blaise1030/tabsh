// A session list from the daemon: cards, and each card's side terminals.
// A row whose parent isn't a card in the list is dropped.

export interface SplitRow {
  id: string;
  parent?: string | null;
}

export function splitSessions<T extends SplitRow>(list: T[]): { cards: T[]; sides: Map<string, T[]> } {
  const byId = new Map(list.map((row) => [row.id, row]));
  const cards = list.filter((row) => !row.parent);
  const sides = new Map<string, T[]>();
  for (const row of list) {
    if (!row.parent) continue;
    const parent = byId.get(row.parent);
    if (!parent || parent.parent) continue;
    const group = sides.get(row.parent);
    if (group) group.push(row);
    else sides.set(row.parent, [row]);
  }
  return { cards, sides };
}
