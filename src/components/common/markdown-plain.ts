/**
 * Stored markdown (doc-markdown-editor.tsx) → the text a reader sees, for places that show a value as plain text
 * (STAR 제안 values, [기존 내용과 비교], highlightRange quotes).
 *
 * The editor escapes literal markup characters (`\*` `\_` `\[` …) and writes `&lt;` for a tag-like `<`, so an
 * unescaped `*` / `~` / `` ` `` is always markup; `_` is markup only at a word edge (snake_case stays). Escapes are
 * protected first, markup stripped, then the escaped characters come back as plain text.
 */

export interface ReadableOptions {
  /** keep list bullets / numbers at line start (default true); false drops them (search quotes) */
  keepListMarkers?: boolean
}

export function markdownToReadable(md: string, opts: ReadableOptions = {}): string {
  const keepList = opts.keepListMarkers ?? true
  const kept: string[] = []
  const protectedText = md.replace(/\\([\\`*_[\]~|#>().!+-])/g, (_, ch: string) => {
    kept.push(ch)
    return `\u0000${kept.length - 1}\u0000`
  })
  return protectedText
    .split("\n")
    .map((line) => {
      if (/^\s*&nbsp;\s*$/.test(line)) return ""
      let l = line
        .replace(/^(\s*)#{1,6}\s+/, "$1")
        .replace(/^(\s*)>\s?/, "$1")
        .replace(/^\s*```.*$/, "")
      l = keepList ? l.replace(/^(\s*)[-*+]\s+/, "$1• ") : l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      return l
        .replace(/(\*\*|~~|\*|`)/g, "")
        .replace(/(?<![\p{L}\p{N}])__?|__?(?![\p{L}\p{N}])/gu, "")
    })
    .join("\n")
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)] ?? "")
    .replace(/&lt;/g, "<")
}
