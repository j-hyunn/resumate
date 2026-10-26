import { WHOLE_SOURCE_FIELD } from "../evidence-rules";
import { hashCanonical } from "../hash";
import { AliasMap } from "./aliases";

/**
 * JD context (AI spec C-2). Splitting is deterministic and done by the server
 * at JD save time (never by the LLM); the result is
 * `job_descriptions.sentences` `[{sid, text, start, end}]` (DM A.6).
 */

export type JdSentence = {
  sid: string;
  text: string;
  /** Offsets into raw_text (UTF-16 code units, JS string indices); `raw.slice(start, end) === text`. */
  start: number;
  end: number;
};

/** Leading list markers stripped from a sentence (the offsets skip them too). */
const BULLET = /^(?:[-*•·▪■□○●◦✓✔☑➢▶►※>]+|\(?\d{1,2}[.)]|\(?[a-zA-Z가-힣][.)](?=\s))\s*/;

/**
 * Splits by line breaks, then within a line after `.`, `!`, `?`, `。` followed
 * by whitespace (so "3.5년" and "Node.js" stay whole). Empty and
 * marker-only segments are skipped. IDs are S1, S2, … in text order.
 */
export function splitJdSentences(raw: string): JdSentence[] {
  const sentences: JdSentence[] = [];
  const pushSegment = (from: number, to: number) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(raw[start])) start++;
    while (end > start && /\s/.test(raw[end - 1])) end--;
    const bullet = BULLET.exec(raw.slice(start, end));
    if (bullet) start += bullet[0].length;
    while (start < end && /\s/.test(raw[start])) start++;
    if (end <= start) return;
    const text = raw.slice(start, end);
    if (!/[0-9A-Za-z가-힣ぁ-んァ-ン一-龥]/.test(text)) return;
    sentences.push({ sid: `S${sentences.length + 1}`, text, start, end });
  };

  let lineStart = 0;
  for (let i = 0; i <= raw.length; i++) {
    const ch = raw[i];
    if (i === raw.length || ch === "\n" || ch === "\r") {
      splitLine(lineStart, i);
      lineStart = i + 1;
    }
  }

  function splitLine(from: number, to: number) {
    let segStart = from;
    for (let i = from; i < to; i++) {
      const ch = raw[i];
      const next = raw[i + 1];
      if ((ch === "." || ch === "!" || ch === "?" || ch === "。") && (i + 1 >= to || /\s/.test(next))) {
        pushSegment(segStart, i + 1);
        segStart = i + 1;
      }
    }
    pushSegment(segStart, to);
  }

  return sentences;
}

/** Minimal requirement shape the context needs (jd_requirements, DM A.7). */
export type JdRequirementInput = {
  id: string;
  category: "responsibility" | "required" | "preferred";
  content: string;
  importance: "high" | "normal";
  source_sids: readonly string[];
  sort_order: number;
  updated_at: string | null;
};

export type JdContext = {
  /** `<jd>…</jd>` user block. Never log it. */
  text: string;
  aliases: AliasMap;
  /** Hash of the requirement list as given to the model (C-6 requirements_hash). */
  requirementsHash: string;
  /** V-5 sources: requirement and sentence texts. */
  numberTexts: string[];
};

const CATEGORY_LABEL: Record<JdRequirementInput["category"], string> = {
  responsibility: "주요 업무",
  required: "자격 요건",
  preferred: "우대 사항",
};

/**
 * Builds the JD block: requirements as REQ-1… (by sort_order), and — only for
 * steps that need them (AI-02 stage 1) — the sentences, either all or just
 * those cited by the requirements. `jobDescriptionId` is the source_id of
 * sentence evidence (sentences are not rows).
 */
export function buildJdContext(input: {
  jobDescriptionId: string;
  jobDescriptionUpdatedAt?: string | null;
  sentences: readonly JdSentence[];
  requirements: readonly JdRequirementInput[];
  includeSentences: "none" | "cited" | "all";
  positionTitle?: string | null;
}): JdContext {
  const aliases = new AliasMap();
  const requirements = [...input.requirements].sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: string[] = ["<jd>"];
  const numberTexts: string[] = [];
  const escape = (s: string) => s.replace(/</g, "＜").replace(/>/g, "＞").replace(/\n/g, " ");

  if (input.positionTitle) {
    out.push(`position_title: ${escape(input.positionTitle)}`);
    numberTexts.push(input.positionTitle);
  }
  out.push("<requirements>");
  requirements.forEach((r, i) => {
    const alias = `REQ-${i + 1}`;
    aliases.add({
      alias,
      sourceType: "jd_requirement",
      id: r.id,
      fields: { [WHOLE_SOURCE_FIELD]: r.content },
      snapshotAt: r.updated_at,
      label: r.content.length > 40 ? `${r.content.slice(0, 40)}…` : r.content,
      parents: [],
    });
    const sids = r.source_sids.length ? ` (근거 문장: ${r.source_sids.join(", ")})` : "";
    out.push(`${alias} [${CATEGORY_LABEL[r.category]}${r.importance === "high" ? ", 중요" : ""}] ${escape(r.content)}${sids}`);
    numberTexts.push(r.content);
  });
  out.push("</requirements>");

  const cited = new Set(requirements.flatMap((r) => r.source_sids));
  const sentences =
    input.includeSentences === "all"
      ? input.sentences
      : input.includeSentences === "cited"
        ? input.sentences.filter((s) => cited.has(s.sid))
        : [];
  if (sentences.length) {
    out.push("<sentences>");
    for (const s of sentences) {
      aliases.add({
        alias: s.sid,
        sourceType: "jd_sentence",
        id: input.jobDescriptionId,
        fields: { [WHOLE_SOURCE_FIELD]: s.text },
        snapshotAt: input.jobDescriptionUpdatedAt ?? null,
        label: s.text.length > 40 ? `${s.text.slice(0, 40)}…` : s.text,
        locator: { sid: s.sid, start: s.start, end: s.end },
        parents: [],
      });
      out.push(`${s.sid}: ${escape(s.text)}`);
      numberTexts.push(s.text);
    }
    out.push("</sentences>");
  }
  out.push("</jd>");

  return {
    text: out.join("\n"),
    aliases,
    requirementsHash: hashCanonical(
      requirements.map((r) => ({ id: r.id, category: r.category, content: r.content, importance: r.importance, source_sids: [...r.source_sids] })),
    ),
    numberTexts,
  };
}
