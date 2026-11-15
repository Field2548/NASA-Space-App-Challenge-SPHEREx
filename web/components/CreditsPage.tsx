// /credits body: renders the repo-root CREDITS.md with a tiny markdown reader:
// headings, paragraphs, bullet lists, block quotes, pipe tables, and inline bold, code, links and
// bare URLs. Server component; the page reads the file at build time.

import { Fragment, type ReactNode } from "react";
import BackLink from "./BackLink";
import styles from "./InfoPage.module.css";

export const CREDITS_URL = "https://github.com/Field2548/NASA-Space-App-Challenge-SPHEREx/blob/web/CREDITS.md";
const REPO_BLOB = "https://github.com/Field2548/NASA-Space-App-Challenge-SPHEREx/blob/main/";

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());

const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");

/** Markdown subset to blocks. HTML comments are dropped. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      out.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, text: h[2].trim() });
    } else if (line.trimStart().startsWith("|") && i + 1 < lines.length && isDivider(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trimStart().startsWith("|")) rows.push(splitRow(lines[i++]));
      i--;
      out.push({ kind: "table", head, rows });
    } else if (line.startsWith(">")) {
      flush();
      const q = [line.replace(/^>\s?/, "")];
      while (i + 1 < lines.length && lines[i + 1].startsWith(">")) q.push(lines[++i].replace(/^>\s?/, ""));
      out.push({ kind: "quote", text: q.join(" ").trim() });
    } else if (/^\s*[-*]\s+/.test(line)) {
      flush();
      const items = [line.replace(/^\s*[-*]\s+/, "")];
      while (i + 1 < lines.length && /^\s*[-*]\s+/.test(lines[i + 1])) items.push(lines[++i].replace(/^\s*[-*]\s+/, ""));
      out.push({ kind: "list", items });
    } else para.push(line.trim());
  }
  flush();
  return out;
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>|)]+[^\s<>|).,;:!?"'])/g;

/** Inline markdown to React nodes. Relative links point at the file on GitHub. */
export function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={k++}>{inline(m[1])}</strong>);
    else if (m[2] !== undefined) nodes.push(<code key={k++}>{m[2]}</code>);
    else if (m[3] !== undefined) {
      const href = /^[a-z]+:/i.test(m[4]) ? m[4] : REPO_BLOB + m[4].replace(/^\.?\//, "");
      nodes.push(
        <a key={k++} href={href} rel="noreferrer">
          {m[3]}
        </a>,
      );
    } else
      nodes.push(
        <a key={k++} href={m[5]} rel="noreferrer">
          {m[5]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Blocks to HTML. The first heading is the page's one h1; every later one is an h2 or h3. */
export function CreditsBlocks({ blocks, after }: { blocks: Block[]; after?: ReactNode }) {
  const firstH1 = blocks.findIndex((b) => b.kind === "heading" && b.level === 1);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          const level = b.level === 1 && i !== firstH1 ? 2 : b.level;
          const H = `h${level}` as "h1" | "h2" | "h3";
          return (
            <Fragment key={i}>
              <H>{inline(b.text)}</H>
              {i === firstH1 ? after : null}
            </Fragment>
          );
        }
        if (b.kind === "paragraph") return <p key={i}>{inline(b.text)}</p>;
        if (b.kind === "quote") return <blockquote key={i}>{inline(b.text)}</blockquote>;
        if (b.kind === "list")
          return (
            <ul key={i}>
              {b.items.map((t, j) => (
                <li key={j}>{inline(t)}</li>
              ))}
            </ul>
          );
        return (
          <div key={i} className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} scope="col">
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, l) => (
                      <td key={l}>{inline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

/** The credits page: the parsed file, or a short message with a GitHub link when it is missing. */
export default function CreditsPage({ markdown, intro }: { markdown: string | null; intro?: ReactNode }) {
  const blocks = markdown ? parseMarkdown(markdown) : [];
  const hasH1 = blocks.some((b) => b.kind === "heading" && b.level === 1);
  return (
    <main className={styles.page}>
      <BackLink />
      {markdown && blocks.length > 0 ? (
        <>
          {!hasH1 && <h1>Credits</h1>}
          {!hasH1 && intro}
          <CreditsBlocks blocks={blocks} after={hasH1 ? intro : undefined} />
        </>
      ) : (
        <>
          <h1>Credits</h1>
          {intro}
          <p>
            The credits list is not available here. Read it on <a href={CREDITS_URL}>GitHub</a>.
          </p>
        </>
      )}
    </main>
  );
}
