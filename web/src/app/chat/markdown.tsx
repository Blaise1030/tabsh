// Render chat markdown as Solid elements from `marked` tokens — no markup
// strings, so CSP / no-markup stays happy.
import { For, Match, Show, Switch, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { lexMarkdown, safeHref, type Token, type Tokens } from './markdown.ts';

export function Markdown(props: { text: string; class?: string }): JSX.Element {
  const tokens = () => lexMarkdown(props.text);
  return (
    <div class={props.class ?? 'chat-md'}>
      <For each={tokens()}>{(t) => <Block token={t} />}</For>
    </div>
  );
}

function Block(props: { token: Token }): JSX.Element {
  return (
    <Switch>
      <Match when={props.token.type === 'paragraph' ? (props.token as Tokens.Paragraph) : undefined}>
        {(p) => (
          <p>
            <Inlines tokens={p().tokens} />
          </p>
        )}
      </Match>
      <Match when={props.token.type === 'heading' ? (props.token as Tokens.Heading) : undefined}>
        {(h) => (
          <Dynamic component={`h${Math.min(6, Math.max(1, h().depth))}` as 'h1'}>
            <Inlines tokens={h().tokens} />
          </Dynamic>
        )}
      </Match>
      <Match when={props.token.type === 'code' ? (props.token as Tokens.Code) : undefined}>
        {(c) => (
          <pre class="chat-md-code">
            <Show when={c().lang}>
              <span class="chat-md-lang">{c().lang}</span>
            </Show>
            <code>{c().text}</code>
          </pre>
        )}
      </Match>
      <Match when={props.token.type === 'blockquote' ? (props.token as Tokens.Blockquote) : undefined}>
        {(q) => (
          <blockquote>
            <For each={q().tokens}>{(child) => <Block token={child} />}</For>
          </blockquote>
        )}
      </Match>
      <Match when={props.token.type === 'list' ? (props.token as Tokens.List) : undefined}>
        {(list) => {
          const items = (
            <For each={list().items}>
              {(item) => (
                <li>
                  <Inlines tokens={item.tokens} />
                </li>
              )}
            </For>
          );
          return list().ordered ? (
            <ol start={typeof list().start === 'number' ? list().start : undefined}>{items}</ol>
          ) : (
            <ul>{items}</ul>
          );
        }}
      </Match>
      <Match when={props.token.type === 'hr'}>
        <hr />
      </Match>
      <Match when={props.token.type === 'space'}>
        <></>
      </Match>
      <Match when={props.token.type !== 'space' ? props.token : undefined}>
        {(t) => <p>{rawText(t())}</p>}
      </Match>
    </Switch>
  );
}

function Inlines(props: { tokens: Token[] | undefined }): JSX.Element {
  return <For each={props.tokens ?? []}>{(t) => <Inline token={t} />}</For>;
}

function Inline(props: { token: Token }): JSX.Element {
  return (
    <Switch fallback={<>{rawText(props.token)}</>}>
      <Match when={props.token.type === 'text' ? (props.token as Tokens.Text) : undefined}>
        {(text) => (text().tokens?.length ? <Inlines tokens={text().tokens} /> : <>{text().text}</>)}
      </Match>
      <Match when={props.token.type === 'strong' ? (props.token as Tokens.Strong) : undefined}>
        {(s) => (
          <strong>
            <Inlines tokens={s().tokens} />
          </strong>
        )}
      </Match>
      <Match when={props.token.type === 'em' ? (props.token as Tokens.Em) : undefined}>
        {(e) => (
          <em>
            <Inlines tokens={e().tokens} />
          </em>
        )}
      </Match>
      <Match when={props.token.type === 'del' ? (props.token as Tokens.Del) : undefined}>
        {(d) => (
          <del>
            <Inlines tokens={d().tokens} />
          </del>
        )}
      </Match>
      <Match when={props.token.type === 'codespan' ? (props.token as Tokens.Codespan) : undefined}>
        {(c) => <code class="chat-md-codespan">{c().text}</code>}
      </Match>
      <Match when={props.token.type === 'br'}>
        <br />
      </Match>
      <Match when={props.token.type === 'link' ? (props.token as Tokens.Link) : undefined}>
        {(link) => {
          const href = () => safeHref(link().href);
          const body = () =>
            link().tokens?.length ? <Inlines tokens={link().tokens} /> : <>{link().text}</>;
          return (
            <Show when={href()} fallback={<span>{body()}</span>}>
              {(h) => (
                <a href={h()} target="_blank" rel="noopener noreferrer">
                  {body()}
                </a>
              )}
            </Show>
          );
        }}
      </Match>
      <Match when={props.token.type === 'escape' ? (props.token as Tokens.Escape) : undefined}>
        {(e) => <>{e().text}</>}
      </Match>
    </Switch>
  );
}

function rawText(token: Token): string {
  if ('text' in token && typeof (token as { text?: unknown }).text === 'string') {
    return (token as { text: string }).text;
  }
  if ('raw' in token && typeof token.raw === 'string') return token.raw;
  return '';
}
