// Efficient chat markdown via solid-markdown: Solid elements (no markup
// injection) and reconcile so streaming only re-renders changed AST nodes.
import type { JSX } from 'solid-js';
import { SolidMarkdown } from 'solid-markdown';
import { transformLinkUri } from './markdown.ts';

export function Markdown(props: { text: string; class?: string }): JSX.Element {
  return (
    <SolidMarkdown
      class={props.class ?? 'chat-md'}
      renderingStrategy="reconcile"
      skipHtml
      transformLinkUri={transformLinkUri}
      linkTarget="_blank"
      components={{
        a: (p) => (
          <a href={p.href} title={p.title} target="_blank" rel="noopener noreferrer">
            {p.children}
          </a>
        ),
        pre: (p) => <pre class="chat-md-code">{p.children}</pre>,
        code: (p) =>
          p.inline ? <code class="chat-md-codespan">{p.children}</code> : <code class={p.class}>{p.children}</code>,
      }}
    >
      {props.text}
    </SolidMarkdown>
  );
}
