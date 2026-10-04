export interface Found {
  kind: 'url' | 'path';
  start: number;
  end: number;
  text: string;
  line?: number;
  col?: number;
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const PATH_RE = /([\w.~@+/-]+)((?::(\d+)(?::(\d+))?)?)/g;
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

// Drop sentence punctuation and unbalanced closers, so "(see https://x/a)." works
// while a Wikipedia-style "Foo_(bar)" keeps its parenthesis. Counts each bracket
// once, then walks back from the end, so a long run of closers stays linear.
function trimUrl(url: string): string {
  // Closes minus opens, per closer.
  const balance: Record<string, number> = { ')': 0, ']': 0, '}': 0 };
  for (const ch of url) {
    if (ch in CLOSERS) balance[ch]++;
    else if (ch in OPENERS) balance[OPENERS[ch]]--;
  }
  let end = url.length;
  while (end > 0) {
    const last = url[end - 1];
    if ('.,;:!?'.includes(last)) {
      end--;
      continue;
    }
    if (last in CLOSERS && balance[last] > 0) {
      balance[last]--;
      end--;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

function acceptPath(base: string): boolean {
  // A leading // is a scheme-relative URL (ftp://x.dev), not a path.
  if (base.startsWith('//')) return false;
  if (base.includes('/')) return !/^\/+$/.test(base) && /[A-Za-z]/.test(base);
  // A bare name.ext: name starts with a letter, extension is 1-8 chars with a letter.
  const m = /^([A-Za-z][\w.-]*)\.([\w-]{1,8})$/.exec(base);
  if (!m || !/[A-Za-z]/.test(m[2])) return false;
  // Abbreviations like e.g. / i.e. are not files.
  return !base.split('.').every((seg) => seg.length === 1);
}

export function findLinks(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    if (/^https?:\/\/./.test(url)) {
      out.push({ kind: 'url', start: m.index, end: m.index + url.length, text: url });
    }
  }
  // Skip any run overlapping a URL, including its trimmed tail.
  const urlSpans = [...text.matchAll(URL_RE)].map((m) => [m.index, m.index + m[0].length]);
  for (const m of text.matchAll(PATH_RE)) {
    const start = m.index;
    const suffix = m[2];
    let base = m[1];
    if (!suffix) base = base.replace(/\.+$/, '');
    const end = start + base.length + suffix.length;
    if (urlSpans.some(([a, b]) => start < b && end > a)) continue;
    if (!acceptPath(base)) continue;
    const f: Found = { kind: 'path', start, end, text: base };
    if (m[3] !== undefined) f.line = Number(m[3]);
    if (m[4] !== undefined) f.col = Number(m[4]);
    out.push(f);
  }
  return out.sort((a, b) => a.start - b.start);
}
