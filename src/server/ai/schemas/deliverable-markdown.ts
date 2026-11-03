/**
 * Deterministic markdown of a deliverable draft (DM 2.5.0 "value = 서버가
 * blocks로 조립한 마크다운"). Mirrors `private.wc_block_markdown` /
 * `private.wc_deliverable_markdown` (r5 migration) character for character, so
 * the pipeline's 8,000-char check and the RPC's agree and the screen can build
 * the append preview from the same blocks. Dependency-free (client-safe).
 */

export type MarkdownSourceless = { text: string };
export type MarkdownBlock = {
  type: string;
  level?: number | null;
  text?: string | null;
  items?: ReadonlyArray<{ text: string }> | null;
  rows?: ReadonlyArray<{ cells: readonly string[] }> | null;
};

/** Postgres btrim(text) with no characters argument: spaces only. */
function btrim(s: string): string {
  return s.replace(/^ +| +$/g, "");
}

/** rtrim(text, ' \t\r\n'). */
function rtrimWs(s: string): string {
  return s.replace(/[ \t\r\n]+$/, "");
}

function cell(text: string): string {
  return btrim(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function blockMarkdown(b: MarkdownBlock): string {
  switch (b.type) {
    case "heading":
      return `${"#".repeat(b.level ?? 2)} ${btrim(b.text ?? "")}`;
    case "paragraph":
      return btrim(b.text ?? "");
    case "quote":
      return `> ${btrim(b.text ?? "").replace(/\n/g, "\n> ")}`;
    case "code":
      return "```\n" + rtrimWs(b.text ?? "") + "\n```";
    case "bullet_list":
      return (b.items ?? []).map((i) => `- ${btrim(i.text).replace(/\n/g, " ")}`).join("\n");
    case "numbered_list":
      return (b.items ?? []).map((i, n) => `${n + 1}. ${btrim(i.text).replace(/\n/g, " ")}`).join("\n");
    case "table": {
      const rows = b.rows ?? [];
      if (rows.length === 0) return "";
      const lines = rows.map((r) => `| ${r.cells.map(cell).join(" | ")} |`);
      const sep = `| ${rows[0].cells.map(() => "---").join(" | ")} |`;
      return [lines[0], sep, ...lines.slice(1)].join("\n");
    }
    default:
      return "";
  }
}

export function deliverableMarkdown(blocks: readonly MarkdownBlock[]): string {
  return blocks.map(blockMarkdown).join("\n\n");
}

/** AI-13 덧붙이기: form body + one blank line + the blocks (the screen's fill rule). */
export function appendToBody(currentBody: string, blocks: readonly MarkdownBlock[]): string {
  const add = deliverableMarkdown(blocks);
  if (currentBody.trim() === "") return add;
  return `${currentBody.replace(/\s+$/, "")}\n\n${add}`;
}
