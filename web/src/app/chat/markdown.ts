// Chat transcript markdown: parse with `marked`, never emit markup strings.
// The Solid view in markdown.tsx turns these tokens into elements.
import { marked, type Token, type Tokens } from 'marked';

export function safeHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const t = href.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith('#') || t.startsWith('/') || t.startsWith('./') || t.startsWith('../')) return t;
  return null;
}

export function lexMarkdown(src: string): Token[] {
  return marked.lexer(src ?? '');
}

export function blockTypes(src: string): string[] {
  return lexMarkdown(src)
    .filter((t) => t.type !== 'space')
    .map((t) => t.type);
}

export type { Token, Tokens };
