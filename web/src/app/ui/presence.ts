// A list that keeps leaving items in place while they animate out. Pure, so
// its test runs in Node.

// `next`, with each item of `prev` whose key is gone put back at its old
// index, or at the end when the list has since shrunk.
export function mergePresence<T>(prev: T[], next: T[], by: (t: T) => string): T[] {
  const merged = [...next];
  const keys = new Set(next.map(by));
  prev.forEach((item, i) => {
    if (!keys.has(by(item))) merged.splice(Math.min(i, merged.length), 0, item);
  });
  return merged;
}
