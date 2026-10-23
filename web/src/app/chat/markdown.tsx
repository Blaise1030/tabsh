// Efficient chat markdown via solid-markdown: Solid elements (no markup
// injection) and reconcile so streaming only re-renders changed AST nodes.
import remarkGfm from 'remark-gfm';
import type { JSX } from 'solid-js';
import { SolidMarkdown } from 'solid-markdown';
import { openInPane } from '../files/open.tsx';
import { encodeFileHref, parseFileHref, remarkAutolinkPaths, transformLinkUri } from './markdown.ts';

export function Markdown(props: { text: string; class?: string; sessionId?: string }): JSX.Element {
  return (
    <SolidMarkdown
      class={props.class ?? 'chat-md'}
      renderingStrategy="reconcile"
      skipHtml
      remarkPlugins={[remarkGfm, remarkAutolinkPaths]}
      transformLinkUri={transformLinkUri}
      linkTarget="_blank"
      components={{
        a: (p) => {
          const file = parseFileHref(p.href);
          if (file && props.sessionId) {
            return (
              <a
                href={p.href || encodeFileHref(file.text, file.line)}
                title={p.title ?? file.text}
                class="badge chat-md-path"
                onClick={(e) => {
                  e.preventDefault();
                  openInPane({ id: props.sessionId!, closed: false }, file);
                }}
              >
                {p.children}
              </a>
            );
          }
          // Absolute paths from markdown links (e.g. `/Users/…/a.ts`) open in the pane.
          const href = p.href?.trim() ?? '';
          if (props.sessionId && href.startsWith('/') && !href.startsWith('//') && !/^https?:/i.test(href)) {
            return (
              <a
                href={href}
                title={p.title ?? href}
                class="badge chat-md-path"
                onClick={(e) => {
                  e.preventDefault();
                  openInPane({ id: props.sessionId!, closed: false }, { text: href });
                }}
              >
                {p.children}
              </a>
            );
          }
          return (
            <a href={p.href} title={p.title} target="_blank" rel="noopener noreferrer">
              {p.children}
            </a>
          );
        },
        pre: (p) => <pre class="chat-md-code">{p.children}</pre>,
        code: (p) =>
          p.inline ? <code class="chat-md-codespan">{p.children}</code> : <code class={p.class}>{p.children}</code>,
        table: (p) => (
          <div class="chat-md-table">
            <table>{p.children}</table>
          </div>
        ),
      }}
    >
      {props.text}
    </SolidMarkdown>
  );
}
