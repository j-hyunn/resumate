import type { DraftSourceRole, QuestionClass } from "@/lib/contracts/enums";
import type { AliasMap } from "../context-pack/aliases";
import { charLength, normalizeFactAlias } from "../context-pack/deliverable-chat";
import { sourceLabel } from "../context-pack/selection";
import type { CoverLetterQuestionContext } from "../context-pack/cover-letter-chat";
import type { Ai04Clarification, Ai04ExtractOutput, Ai04Paragraph, Ai04Source } from "../schemas/AI-04";
import type { CoverLetterBlock, CoverLetterFact, StoredEvidence, StoredSource } from "../schemas/cover-letter-draft";
import { MAX_QUESTION_SOURCES, paragraphBlockId } from "../schemas/cover-letter-draft";
import { STORABLE_SOURCE_TYPES } from "../evidence-rules";
import type { SelectedSourceView } from "../streaming/events";
import { addToReport, checkDraftBlock, cleanProse, emptyDraftReport, type DraftCheckEnv, type DraftReport, type RawDraftBlock } from "./draft-blocks";
import { buildSourceScope, countChars, PARAGRAPH_SEPARATOR, type SourceScopeItem } from "./drafts";
import type { ValidatedEvidence } from "./evidence";
import { normalizeForMatch } from "./normalize";
import {
  checkQuotes,
  checkSources,
  checkTextNumbers,
  detectSensitive,
  findUnsupportedNames,
  isActorAmbiguous,
  normalizeMessageAlias,
  uncoveredRatio,
  V9E_MAX_UNCOVERED_RATIO,
  type V9Message,
} from "./v9";

/**
 * AI-04 자소서 대화 서버 검증 (AI spec v4.15 AI-04 "서버 검증"): 문항마다
 * V-1~V-5 + V-7(그 문항의 근거 배열 + 메모 + JD + 지금 답변) + V-8(배운 점은
 * `future_plan`·`experience_story`·`motivation`의 회고 문장에서만) + V-9a~e·g
 * + V-9j + 스킬명 가드, 그리고 답변 제목 검증(validation/answer-title.ts).
 *
 * 순수 함수다. 숫자·검사 번호만 보고하고 텍스트는 보고하지 않는다(C-7).
 */

/** C-9: 배운 점을 회고 문장으로 쓸 수 있는 문항 유형. `job_competency`는 금지. */
export const LEARNINGS_ALLOWED_CLASSES: ReadonlySet<QuestionClass> = new Set<QuestionClass>(["motivation", "future_plan", "experience_story"]);

/** AI-04 문항 유형별 프로젝트 근거 개수. */
export const SOURCE_COUNT_RULES: Readonly<Record<QuestionClass, { min: number; max: number }>> = {
  motivation: { min: 0, max: 1 },
  job_competency: { min: 1, max: 2 },
  future_plan: { min: 0, max: 1 },
  experience_story: { min: 1, max: 2 },
};

/** C-14: 턴당 사실 ≤ 10, 대화당 ≤ 60, 사실 `text` ≤ 300자. */
export const MAX_FACTS_PER_TURN = 10;
export const MAX_FACTS_PER_CHAT = 60;
export const FACT_TEXT_MAX = 300;
export const CLARIFICATION_NOTE_MAX = 200;

export function learningsFor(questionClass: QuestionClass) {
  return LEARNINGS_ALLOWED_CLASSES.has(questionClass) ? ("reflection_only" as const) : ("forbidden" as const);
}

/** 정본 `template_key`가 이긴다 — 사용자 추가 문항만 모델의 분류를 쓴다. */
export function resolveQuestionClass(question: CoverLetterQuestionContext, modelClass: QuestionClass | null, report?: Record<string, number>): QuestionClass {
  if (question.templateKey) {
    if (modelClass && modelClass !== question.templateKey && report) addToReport(report, { question_class_overridden: 1 });
    return question.templateKey;
  }
  return modelClass ?? "experience_story";
}

// ---------------------------------------------------------------------------
// 근거 선택 (sources)
// ---------------------------------------------------------------------------

export type ValidatedSource = {
  projectAlias: string | null;
  parentAlias: string | null;
  view: SelectedSourceView;
  evidence: ValidatedEvidence[];
};

export type SourcesEnv = {
  aliases: AliasMap;
  env: DraftCheckEnv;
  /** 다른 문항이 주 근거로 쓴 프로젝트 id (F-DOC-08 재사용 판정). */
  otherPrimaryProjectIds: ReadonlySet<string>;
  /** 이 문항의 메모 별칭 (V-7 범위). */
  noteAlias: string | null;
};

const RATIONALE_MAX = 300;

function clip(text: string | null, max: number): string | null {
  if (text === null) return null;
  const t = text.trim();
  if (t === "") return null;
  return Array.from(t).length > max ? `${Array.from(t).slice(0, max - 1).join("")}…` : t;
}

/**
 * V-1~V-4·V-7·V-8을 근거 선택에 적용한다: 별칭 → 행(V-1), 부모 교정, 프로젝트
 * 중복 제거, 선택마다 근거 1개 이상(없으면 버림), 역할 정규화(primary 1개),
 * 문항 유형별 개수 상한(초과분 자름). (v4.15, CL-*) `selection_mode`는 없다 —
 * 사용자 지정 근거도 같은 V-7 한 규칙으로 본다.
 */
export function validateSources(
  raw: readonly Ai04Source[],
  questionClass: QuestionClass,
  senv: SourcesEnv,
  report: Record<string, number>,
): ValidatedSource[] {
  const { aliases, env } = senv;
  const learnings = learningsFor(questionClass);
  addToReport(report, { sources_total: raw.length });

  const resolveModel = (s: Ai04Source): { projectAlias: string | null; parentAlias: string | null } | null => {
    const prj = s.project_ref?.trim() || null;
    if (prj) {
      const entry = aliases.get(prj);
      if (!entry || entry.sourceType !== "project") return null;
      const parent = entry.parents[0] ?? null;
      const claimed = s.experience_ref?.trim() || s.education_ref?.trim() || null;
      if (claimed && claimed !== parent) addToReport(report, { source_parent_corrected: 1 });
      return { projectAlias: prj, parentAlias: parent };
    }
    const parent = s.experience_ref?.trim() || s.education_ref?.trim() || null;
    const entry = parent ? aliases.get(parent) : undefined;
    if (!entry || (entry.sourceType !== "experience" && entry.sourceType !== "education")) return null;
    return { projectAlias: null, parentAlias: parent };
  };
  const key = (r: { projectAlias: string | null; parentAlias: string | null }) => r.projectAlias ?? `parent:${r.parentAlias}`;

  let out: ValidatedSource[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    const r = resolveModel(s);
    if (!r) {
      addToReport(report, { sources_dropped_unknown_ref: 1 });
      continue;
    }
    if (seen.has(key(r))) {
      addToReport(report, { sources_dropped_duplicate: 1 });
      continue;
    }
    seen.add(key(r));
    const scope = questionScope(aliases, [r], senv.noteAlias);
    const outcome = validateJudgmentEvidence(s.evidence, { learnings, scope }, env, report);
    if (outcome.length === 0) {
      addToReport(report, { sources_dropped_no_evidence: 1 });
      continue;
    }
    const requirementIds: string[] = [];
    for (const ref of s.requirement_refs) {
      const id = aliases.resolveId(ref.trim(), "jd_requirement");
      if (!id) addToReport(report, { requirement_refs_dropped: 1 });
      else if (!requirementIds.includes(id)) requirementIds.push(id);
    }
    const parentEntry = r.parentAlias ? aliases.get(r.parentAlias) : undefined;
    const view: SelectedSourceView = {
      sort_order: 0,
      role: s.role as DraftSourceRole,
      project_id: r.projectAlias ? aliases.resolveId(r.projectAlias, "project") : null,
      experience_id: parentEntry?.sourceType === "experience" ? parentEntry.id : null,
      education_id: parentEntry?.sourceType === "education" ? parentEntry.id : null,
      label: sourceLabel(aliases, r),
      rationale: clip(cleanProse(s.rationale, env, report), RATIONALE_MAX) ?? "",
      reuse_reason: s.reuse_reason ? clip(cleanProse(s.reuse_reason, env, report), RATIONALE_MAX) : null,
      requirement_ids: requirementIds,
    };
    if (view.project_id && senv.otherPrimaryProjectIds.has(view.project_id) && !view.reuse_reason) addToReport(report, { reuse_without_reason: 1 });
    out.push({ ...r, view, evidence: outcome });
  }

  // 역할 정규화: primary 1개를 맨 앞에.
  const primary = out.findIndex((s) => s.view.role === "primary");
  if (primary > 0) out = [out[primary], ...out.slice(0, primary), ...out.slice(primary + 1)];
  out = out.map((s, i) => ({ ...s, view: { ...s.view, role: i === 0 ? "primary" : "supporting" } }));

  const rule = SOURCE_COUNT_RULES[questionClass];
  const projectSources = out.filter((s) => s.projectAlias);
  if (projectSources.length > rule.max) {
    addToReport(report, { sources_truncated: projectSources.length - rule.max });
    const keep = new Set(projectSources.slice(0, rule.max));
    out = out.filter((s) => !s.projectAlias || keep.has(s));
  }
  if (out.filter((s) => s.projectAlias).length < rule.min) addToReport(report, { sources_below_minimum: 1 });
  return out.map((s, i) => ({ ...s, view: { ...s.view, sort_order: i } }));
}

/** V-7 범위: 그 근거의 프로젝트·부모 + JD + 그 문항의 메모 (다른 문항의 메모는 범위 밖). */
export function questionScope(aliases: AliasMap, items: readonly SourceScopeItem[], noteAliasOfQuestion: string | null): Set<string> {
  const scope = buildSourceScope(aliases, items);
  for (const entry of aliases.values()) {
    if (entry.sourceType === "user_note" && entry.alias !== noteAliasOfQuestion) scope.delete(entry.alias);
  }
  return scope;
}

function validateJudgmentEvidence(
  evidence: Ai04Source["evidence"],
  meta: { learnings: ReturnType<typeof learningsFor>; scope: ReadonlySet<string> },
  env: DraftCheckEnv,
  report: Record<string, number>,
): ValidatedEvidence[] {
  // 선택 이유는 판단(judgment)이므로 근거가 하나도 통과하지 못하면 그 선택을 버린다 (V-4).
  const checked = checkDraftBlock(
    { block_id: "source", text: "", evidence, placeholders: [] },
    { blockId: "source", kind: "paragraph", projectId: null, learnings: meta.learnings, scope: meta.scope },
    env,
    "provisional",
  );
  addToReport(report, checked.report);
  return checked.evidence;
}

// ---------------------------------------------------------------------------
// 문단 (paragraphs)
// ---------------------------------------------------------------------------

export type CheckedQuestionDraft = {
  blocks: CoverLetterBlock[];
  /** `evidence_links` 매핑에 쓰는 검증 통과 근거 (item_key별). */
  evidence: Array<{ itemKey: string; evidence: ValidatedEvidence[] }>;
  unsupportedNumbers: string[];
  charCount: number;
  droppedBlockCount: number;
  report: DraftReport;
};

export type ParagraphsEnv = SourcesEnv & {
  question: CoverLetterQuestionContext;
  questionClass: QuestionClass;
  sources: readonly ValidatedSource[];
  /** 쓸 수 있는 사실 (`F{n}` → 행). */
  factAliases: ReadonlyMap<string, CoverLetterFact>;
};

function toRawBlock(p: Ai04Paragraph, blockId: string): RawDraftBlock {
  return { block_id: blockId, text: p.text, evidence: p.evidence, placeholders: p.placeholders, requirement_refs: p.requirement_refs };
}

/**
 * 한 문항의 문단 전체를 검사한다. `provisional`은 숫자를 그대로 두고(스트리밍
 * 중 표시), `final`은 확인되지 않는 숫자를 `[수치 확인 필요]`로 바꾼다.
 * 출처 3종(근거·사실·지금 본문 인용)이 모두 비면 `needs_review` +
 * `review_reason = 'no_evidence'`다 (DM 2.5.0b, `[가정]`: 셋 중 하나라도
 * 있으면 근거가 있는 것으로 본다).
 */
export function checkQuestionParagraphs(
  paragraphs: readonly Ai04Paragraph[],
  penv: ParagraphsEnv,
  mode: "provisional" | "final",
): CheckedQuestionDraft {
  const report = emptyDraftReport();
  const scope = questionScope(
    penv.aliases,
    penv.sources.map((s) => ({ projectAlias: s.projectAlias, parentAlias: s.parentAlias })),
    penv.noteAlias,
  );
  const body = normalizeForMatch(penv.question.bodyForModel.text);
  const blocks: CoverLetterBlock[] = [];
  const evidence: CheckedQuestionDraft["evidence"] = [];
  const numbers = new Set<string>();
  let dropped = 0;

  paragraphs.forEach((p, i) => {
    const blockId = paragraphBlockId(penv.question.slot, i + 1);
    const checked = checkDraftBlock(
      toRawBlock(p, blockId),
      { blockId, kind: "paragraph", projectId: null, learnings: learningsFor(penv.questionClass), scope },
      penv.env,
      mode,
    );
    addToReport(report, checked.report);
    for (const n of checked.unsupportedNumbers) numbers.add(n);

    // 사실 출처: 쓸 수 있는 사실만 (모르는 `F-n`은 버린다).
    const factIds: string[] = [];
    for (const ref of p.source_fact_ids) {
      const fact = penv.factAliases.get(normalizeFactAlias(ref));
      if (!fact) {
        addToReport(report, { fact_refs_dropped: 1 });
        continue;
      }
      if (!factIds.includes(fact.id)) factIds.push(fact.id);
    }
    // 지금 본문 인용: 모델이 본 본문 안에 실제로 있어야 한다.
    const bodyQuotes: string[] = [];
    for (const quote of p.source_body_quotes) {
      const q = normalizeForMatch(quote).text;
      if (!q || !body.text.includes(q)) {
        addToReport(report, { body_quotes_dropped: 1 });
        continue;
      }
      if (!bodyQuotes.includes(quote.trim())) bodyQuotes.push(quote.trim());
    }

    if (checked.block.text.trim() === "") {
      dropped++;
      addToReport(report, { blocks_dropped_empty: 1 });
      return;
    }
    const storedEvidence = toStoredEvidence(checked.evidence, penv.aliases);
    const hasSource = storedEvidence.length + factIds.length + bodyQuotes.length > 0;
    blocks.push({
      block_id: blockId,
      type: "paragraph",
      text: checked.block.text,
      basis: factIds.length > 0 ? "new" : "current_body",
      evidence: storedEvidence,
      source_fact_ids: factIds,
      source_body_quotes: bodyQuotes,
      requirement_ids: checked.block.requirement_ids,
      placeholders: checked.block.placeholders.map((ph) => ({ token: ph.token, hint: ph.hint ?? null })),
      flags: checked.block.flags,
      review: hasSource ? "ok" : "needs_review",
      review_reason: hasSource ? null : "no_evidence",
    });
    if (checked.evidence.length) evidence.push({ itemKey: `${penv.question.slot}.blocks.${blockId}`, evidence: checked.evidence });
  });

  const charCount = countChars(blocks.map((b) => b.text).join(PARAGRAPH_SEPARATOR), penv.question.countBasis);
  return { blocks, evidence, unsupportedNumbers: [...numbers], charCount, droppedBlockCount: dropped, report };
}

/**
 * **별칭 → 저장 출처 한 경로** (C-3). 블록 근거(`evidence[]`)와 문항 근거
 * (`sources[]`, CF-S1)가 같은 함수로 변환된다 — 별칭 항목의 `sourceType`·`id`를
 * 그대로 쓰므로 `user_note` 출처의 `source_id`는 **그 문항의 `question_id`**가
 * 된다(메모 별칭을 그 id로 등록했다). 저장 가능 목록(DM 2.8 = `STORABLE_SOURCE_TYPES`)
 * 밖이면 null이다(`writing_chat_message`는 `evidence_links`에 가지 않는다).
 */
export function toStoredSourceRef(alias: string, aliases: AliasMap): { source_type: StoredEvidence["source_type"]; source_id: string; label: string | null; locator: Record<string, unknown> | null } | null {
  const entry = aliases.get(alias);
  if (!entry) return null;
  if (!(STORABLE_SOURCE_TYPES as readonly string[]).includes(entry.sourceType)) return null;
  return { source_type: entry.sourceType, source_id: entry.id, label: entry.label ?? null, locator: entry.locator ?? null };
}

/** 검증 통과 근거 → `structured_draft` 블록의 저장 모양 (별칭 → UUID, C-3). */
export function toStoredEvidence(evidence: readonly ValidatedEvidence[], aliases: AliasMap): StoredEvidence[] {
  const out: StoredEvidence[] = [];
  for (const e of evidence) {
    const ref = toStoredSourceRef(e.ref, aliases);
    if (!ref) continue;
    out.push({
      source_type: ref.source_type,
      source_id: ref.source_id,
      source_field: e.field,
      source_locator: ref.locator,
      quote: e.quote,
      label: ref.label,
    });
  }
  return out;
}

/**
 * (CF-S1, 확정 2026-11-09 사용자 — 문서 PR #68 미머지) 검증을 통과한 문항 근거
 * → `structured_draft.document.questions[].draft.sources[]`.
 *
 * 변환은 블록 근거와 **같은 경로**(`toStoredSourceRef`)다. 대상은 V-1이 해석한
 * 선택 대상(프로젝트 / 소속 경력 / 교육)이고, 허용 출처 목록은 DM 2.8 그대로다
 * — 목록 밖이거나 별칭이 사라진 선택은 버린다. 순서는 `primary` 먼저이고
 * (`validateSources`가 이미 정규화했다) ≤ 5개다.
 */
export function toStoredSources(sources: readonly ValidatedSource[], aliases: AliasMap, report?: Record<string, number>): StoredSource[] {
  const out: StoredSource[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const alias = s.projectAlias ?? s.parentAlias;
    const ref = alias ? toStoredSourceRef(alias, aliases) : null;
    if (!ref) {
      if (report) addToReport(report, { question_sources_dropped: 1 });
      continue;
    }
    const key = `${ref.source_type}|${ref.source_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.length >= MAX_QUESTION_SOURCES) {
      if (report) addToReport(report, { question_sources_truncated: 1 });
      continue;
    }
    out.push({ source_type: ref.source_type, source_id: ref.source_id, role: s.view.role });
  }
  return out;
}

/** 조립된 본문 (`value`). DB가 정본 조립기이지만 서버도 같은 규칙으로 센다. */
export function composeValue(blocks: readonly CoverLetterBlock[]): string {
  return blocks.map((b) => b.text).join(PARAGRAPH_SEPARATOR);
}

// ---------------------------------------------------------------------------
// 정리 턴 (facts / tone / clarifications)
// ---------------------------------------------------------------------------

export type FactCheck = "V-9a" | "V-9b" | "V-9c" | "V-9d" | "V-9g" | "slot" | "type" | "length" | "limit";
export const FACT_CHECKS: readonly FactCheck[] = ["V-9a", "V-9b", "V-9c", "V-9d", "V-9g", "slot", "type", "length", "limit"];

export type FactChange = {
  slot: string;
  text: string;
  actor: "self" | "team" | "unknown";
  source_message_ids: string[];
  source_quotes: string[];
  review: "ok" | "needs_review";
};

export type CoverLetterFactsReport = {
  proposed: number;
  added: number;
  needs_review: number;
  rejected: number;
  team_marked: number;
  unchanged: number;
  sensitive_added: number;
  by_check: Record<FactCheck, number>;
};

export type CoverLetterFactsResult = {
  facts: FactChange[];
  /** null = 바뀐 것 없음. */
  clarifications: Ai04Clarification[] | null;
  tone: "concise" | "detailed" | null;
  intent: "compose_draft" | null;
  sensitiveAdd: number;
  report: CoverLetterFactsReport;
  rejections: Array<{ check: FactCheck; target: string }>;
};

export function emptyFactsReport(): CoverLetterFactsReport {
  return {
    proposed: 0,
    added: 0,
    needs_review: 0,
    rejected: 0,
    team_marked: 0,
    unchanged: 0,
    sensitive_added: 0,
    by_check: Object.fromEntries(FACT_CHECKS.map((c) => [c, 0])) as Record<FactCheck, number>,
  };
}

const ALIAS_IN_TEXT = /\b[MF]-?\d+(?:에서|에게|에|의|을|를|이|가|은|는|와|과|처럼)?(?![\w가-힣])/g;

function cleanNote(note: string | null): string | null {
  if (!note) return null;
  const text = note.replace(ALIAS_IN_TEXT, "").replace(/\s+/g, " ").trim();
  if (!text || detectSensitive(text).length > 0) return null;
  const chars = Array.from(text);
  return chars.length > CLARIFICATION_NOTE_MAX ? `${chars.slice(0, CLARIFICATION_NOTE_MAX - 1).join("")}…` : text;
}

/**
 * 정리 출력 검증: V-9a(사용자 발화 출처) · V-9b(인용은 부분 문자열) ·
 * V-9g(민감정보는 버리고 센다) · V-9c(숫자) · V-9d(고유명사) ·
 * V-9e(> 40% 미포함 → needs_review), 그리고 V-9f는 `actor` 표시로 바뀐다.
 * 정본에 없는 슬롯의 사실은 버린다(모델이 문항을 만들지 못한다).
 */
export function validateCoverLetterFacts(
  output: Ai04ExtractOutput,
  ctx: {
    messages: ReadonlyMap<string, V9Message>;
    pendingAliases: ReadonlySet<string>;
    knownSlots: ReadonlySet<string>;
    storedFacts: readonly CoverLetterFact[];
    storedClarifications: readonly Ai04Clarification[];
  },
): CoverLetterFactsResult {
  const report = emptyFactsReport();
  const rejections: CoverLetterFactsResult["rejections"] = [];
  const sensitiveKeys = new Set<string>();
  const reject = (check: FactCheck, target: string) => {
    report.rejected++;
    report.by_check[check]++;
    rejections.push({ check, target });
  };
  const norm = (t: string) => normalizeForMatch(t).text;
  const known = new Set(ctx.storedFacts.map((f) => norm(f.text)));
  const room = Math.max(0, MAX_FACTS_PER_CHAT - ctx.storedFacts.length);
  const facts: FactChange[] = [];

  output.facts.forEach((f, i) => {
    report.proposed++;
    const target = `facts.${i}.${f.slot}`;
    if (i >= MAX_FACTS_PER_TURN || facts.length >= room) return reject("limit", target);
    if (!ctx.knownSlots.has(f.slot)) return reject("slot", target);
    const text = f.text.replace(/\s+/g, " ").trim();
    if (!text) return reject("type", target);
    if (charLength(text) > FACT_TEXT_MAX) return reject("length", target);

    const a = checkSources(f.source_message_ids, ctx.messages);
    if (!a.ok) return reject(a.check === "V-9a.delegation" ? "V-9a" : "V-9a", target);
    const b = checkQuotes(f.source_quotes, a.sources);
    if (!b.ok) return reject("V-9b", target);
    const sensitive = detectSensitive(text);
    if (sensitive.length > 0) {
      for (const s of a.sources) if (ctx.pendingAliases.has(s.alias)) for (const c of sensitive) sensitiveKeys.add(`${s.alias}|${c}`);
      return reject("V-9g", target);
    }
    if (!checkTextNumbers(text, b.quotes)) return reject("V-9c", target);
    if (findUnsupportedNames(text, a.sources.map((s) => s.content)).length > 0) return reject("V-9d", target);

    const key = norm(text);
    if (known.has(key)) {
      report.unchanged++;
      return;
    }
    known.add(key);
    const teamOnly = isActorAmbiguous(text, b.quotes);
    const actor = teamOnly ? "team" : f.actor;
    if (teamOnly && f.actor !== "team") report.team_marked++;
    const review = uncoveredRatio(text, b.quotes) > V9E_MAX_UNCOVERED_RATIO ? "needs_review" : "ok";
    facts.push({ slot: f.slot, text, actor, source_message_ids: a.sources.map((s) => s.id), source_quotes: b.quotes, review });
  });

  // clarifications: 해소된 옛 항목을 빼고 새 항목을 더한다.
  const okFacts = facts.filter((f) => f.review === "ok");
  const clarKey = (c: Ai04Clarification) => `${c.kind}|${c.slot ?? ""}`;
  const resolved = (c: Ai04Clarification) =>
    c.kind === "actor_ambiguous"
      ? okFacts.some((f) => (c.slot === null || f.slot === c.slot) && f.actor === "self")
      : okFacts.some((f) => (c.slot === null || f.slot === c.slot) && /\d/.test(f.text));
  const incoming: Ai04Clarification[] = output.clarifications
    .filter((c) => c.slot === null || ctx.knownSlots.has(c.slot))
    .map((c) => ({ kind: c.kind, slot: c.slot, note: cleanNote(c.note) }));
  const next: Ai04Clarification[] = [];
  const seen = new Set<string>();
  for (const c of ctx.storedClarifications) {
    if (resolved(c) || seen.has(clarKey(c))) continue;
    seen.add(clarKey(c));
    next.push(c);
  }
  for (const c of incoming) {
    if (seen.has(clarKey(c)) || resolved(c)) continue;
    seen.add(clarKey(c));
    next.push(c);
  }
  const same = next.map(clarKey).join("\n") === ctx.storedClarifications.map(clarKey).join("\n");

  for (const flag of output.sensitive_flags) {
    const msg = ctx.messages.get(normalizeMessageAlias(flag.message_id));
    if (msg && msg.role === "user" && ctx.pendingAliases.has(msg.alias)) sensitiveKeys.add(`${msg.alias}|${flag.category}`);
  }

  report.added = facts.length;
  report.needs_review = facts.filter((f) => f.review === "needs_review").length;
  report.sensitive_added = sensitiveKeys.size;
  return {
    facts,
    clarifications: same ? null : next.slice(0, 50),
    tone: output.tone,
    intent: output.intent,
    sensitiveAdd: sensitiveKeys.size,
    report,
    rejections,
  };
}
