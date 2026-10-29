import type { CountBasis, DraftSourceRole, QuestionClass } from "@/lib/contracts/enums";
import { AliasMap, type AliasEntry } from "../context-pack/aliases";
import { buildCareerPack, type CareerPack } from "../context-pack/career-pack";
import type { CareerRows } from "../context-pack/career-rows";
import { buildJdContext, type JdRequirementInput, type JdSentence } from "../context-pack/jd";
import type { YearMonth } from "../context-pack/months";
import { filterCareerRows, sourceLabel } from "../context-pack/selection";
import { WHOLE_SOURCE_FIELD } from "../evidence-rules";
import { isProviderError } from "../errors";
import { computeInputHash } from "../input-hash";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import {
  AI04_ADJUST_PROMPT_VERSION,
  AI04_PROMPT_VERSION,
  adjustUserBlocks,
  generateUserBlocks,
  systemBlocks,
  type Ai04QuestionInput,
} from "../prompts/AI-04";
import { escLine } from "../prompts/drafts-common";
import { addUsage, type AiCallResult, type NormalizedUsage, type ProviderId } from "../providers/types";
import {
  AI04_OUTPUT_SCHEMA_VERSION,
  Ai04AdjustOutputSchema,
  Ai04OutputSchema,
  Ai04SourceSchema,
  type Ai04Output,
  type Ai04Paragraph,
  type Ai04Source,
} from "../schemas/AI-04";
import {
  RATIONALE_MAX,
  clipText,
  sourceItemKey,
  toPayloadEvidence,
  type CompleteCoverLetterSectionPayload,
  type CoverLetterPayloadSource,
} from "../storage/drafts";
import type { AiStreamEvent, SelectedSourceView } from "../streaming/events";
import { runStructuredStream } from "../streaming/structured-stream";
import { generateStructured } from "../structured";
import { literalAliasTokens } from "../validation/alias-text";
import {
  addToReport,
  buildTermCorpus,
  checkDraftBlock,
  cleanProse,
  emptyDraftReport,
  toEvidenceChips,
  type DraftBlock,
  type DraftCheckEnv,
  type DraftReport,
  type EvidenceChip,
  type RawDraftBlock,
} from "../validation/draft-blocks";
import { PARAGRAPH_SEPARATOR, buildSourceScope, countChars, isLengthOutOfRange, lengthTarget, type SourceScopeItem } from "../validation/drafts";
import { validateItem, type LearningsPolicy, type ValidatedEvidence } from "../validation/evidence";
import { buildAllowedNumbers } from "../validation/numbers";

/**
 * AI-04 자기소개서 문항별 초안 (F-DOC-02, 03, 04, 08, 09). Streaming (C-6),
 * default tier, low reasoning. One call per question with a two-part output
 * (① sources → ② paragraphs); `sources_selected` is emitted as soon as the
 * sources array closes. After the stream: full validation, server char count
 * (count_basis), and at most one correction call (ai-04.adjust) when outside
 * ±10% of the limit; then persist(p_payload) → validated → done.
 *
 * V-1..V-5, V-7 (sources' subtree + profile, JD, note), V-8 (learnings only in
 * motivation / future_plan / experience_story, reflection wording), per-class
 * source counts, user-mode list kept as is.
 */

export const AI04_TIER = "default" as const;
export const AI04_JOB_TYPE = "cover_letter";
export const AI04_CALL_KEY = "cover_letter.generate";
export const AI04_ADJUST_CALL_KEY = "cover_letter.adjust";
/** Output ≈ 2k tokens incl. reasoning (card 비용); headroom for long limits. */
export const AI04_MAX_OUTPUT_TOKENS = 8192;
export const AI04_QUESTION_REF = "CLQ-1";
export const AI04_NOTE_REF = "NOTE-1";
export const NOTE_LABEL = "내 메모";

export { AI04_PROMPT_VERSION, AI04_ADJUST_PROMPT_VERSION };

/** C-9: classes where learnings may support a reflection sentence. */
export const LEARNINGS_ALLOWED_CLASSES: ReadonlySet<QuestionClass> = new Set<QuestionClass>(["motivation", "future_plan", "experience_story"]);

/** Card 문항 유형별 작성 규칙: project count per class (AI mode). */
export const SOURCE_COUNT_RULES: Readonly<Record<QuestionClass, { min: number; max: number }>> = {
  motivation: { min: 0, max: 1 },
  job_competency: { min: 1, max: 2 },
  future_plan: { min: 0, max: 1 },
  experience_story: { min: 1, max: 2 },
};
/** Card: "detail_refs, 1~2개". */
export const MAX_DETAIL_REFS = 2;

// ---------- context ----------

export type CoverLetterQuestion = {
  section_id: string;
  question_text: string;
  template_key: "motivation" | "job_competency" | "future_plan" | null;
  char_limit: number | null;
  count_basis: CountBasis;
  user_note: string | null;
  user_note_updated_at?: string | null;
};

export type UserSourceInput = {
  experience_id: string | null;
  education_id: string | null;
  project_id: string | null;
  project_detail_ids: string[];
  role: DraftSourceRole;
};

/** A user source resolved to this call's aliases. */
type ResolvedUserSource = UserSourceInput & { projectAlias: string | null; parentAlias: string | null; detailAliases: string[] };

export type CoverLetterContext = {
  question: CoverLetterQuestion;
  mode: "ai" | "user";
  pack: CareerPack;
  aliases: AliasMap;
  env: DraftCheckEnv;
  promptPrefix: { packText: string; jdText: string; referenceText: string | null };
  questionInput: Ai04QuestionInput;
  otherQuestionsText: string | null;
  userSourcesText: string | null;
  userSources: ResolvedUserSource[];
  /** Primary projects of the other questions (reuse check, F-DOC-08). */
  otherPrimaryProjectIds: ReadonlySet<string>;
  careerSnapshotHash: string;
  requirementsHash: string;
  targetChars: number | null;
  /** Report counts from building the context (user sources gone from the pack). */
  contextReport: Record<string, number>;
};

export function buildCoverLetterContext(input: {
  careerRows: CareerRows;
  asOf?: YearMonth;
  jobDescriptionId: string;
  jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];
  /** job_descriptions.extraction.other_sids (회사·직무 소개 문장). */
  companySids: readonly string[];
  requirements: readonly JdRequirementInput[];
  positionTitle: string | null;
  question: CoverLetterQuestion;
  mode: "ai" | "user";
  userSources?: readonly UserSourceInput[];
  otherSections?: ReadonlyArray<{ question_text: string; primary_project_ids: readonly string[] }>;
  insightSignal?: { strengths: ReadonlyArray<{ title: string; description: string }>; positioning: string | null } | null;
}): CoverLetterContext {
  const full = buildCareerPack(input.careerRows, { asOf: input.asOf });
  const userInput = input.mode === "user" ? (input.userSources ?? []) : [];
  const rows =
    input.mode === "user"
      ? filterCareerRows(input.careerRows, {
          projectIds: userInput.map((s) => s.project_id).filter((v): v is string => !!v),
          wholeExperienceIds: userInput.filter((s) => !s.project_id && s.experience_id).map((s) => s.experience_id as string),
          wholeEducationIds: userInput.filter((s) => !s.project_id && s.education_id).map((s) => s.education_id as string),
        })
      : input.careerRows;
  const pack = input.mode === "user" ? buildCareerPack(rows, { asOf: input.asOf }) : full;

  const companySids = new Set(input.companySids);
  const jd = buildJdContext({
    jobDescriptionId: input.jobDescriptionId,
    jobDescriptionUpdatedAt: input.jobDescriptionUpdatedAt,
    sentences: input.sentences.filter((s) => companySids.has(s.sid)),
    requirements: input.requirements,
    includeSentences: "all",
    positionTitle: input.positionTitle,
  });

  const note = input.question.user_note?.trim() ? input.question.user_note : null;
  const noteMap = new AliasMap();
  if (note) {
    noteMap.add({
      alias: AI04_NOTE_REF,
      sourceType: "user_note",
      id: input.question.section_id,
      fields: { [WHOLE_SOURCE_FIELD]: note },
      snapshotAt: input.question.user_note_updated_at ?? null,
      label: NOTE_LABEL,
      parents: [],
    });
  }
  const aliases = AliasMap.merge(pack.aliases, jd.aliases, noteMap);

  const contextReport: Record<string, number> = {};
  const userSources: ResolvedUserSource[] = [];
  for (const s of userInput) {
    const resolved = resolveUserSource(s, pack.aliases);
    if (resolved) userSources.push(resolved);
    else addToReport(contextReport, { user_sources_missing: 1 });
  }

  const numberTexts = [...pack.numberSources.factualTexts, ...jd.numberTexts, ...(note ? [note] : []), input.question.question_text];
  const env: DraftCheckEnv = {
    aliases,
    ctx: { aliases, learnings: "forbidden", scope: null },
    allowedNumbers: buildAllowedNumbers({ texts: numberTexts, numbers: pack.numberSources.computedNumbers }),
    literalAliasTokens: literalAliasTokens(numberTexts),
    termCorpus: buildTermCorpus([...full.numberSources.factualTexts, ...jd.numberTexts, ...(note ? [note] : []), input.question.question_text]),
  };

  const otherPrimary = new Set<string>();
  const otherLines: string[] = [];
  for (const o of input.otherSections ?? []) {
    const refs = o.primary_project_ids
      .map((id) => {
        otherPrimary.add(id);
        const a = pack.aliases.aliasOf("project", id);
        return a ? `${a} '${escLine(pack.aliases.get(a)?.label ?? "")}'` : null;
      })
      .filter(Boolean);
    if (refs.length) otherLines.push(`- 문항 "${escLine(o.question_text)}": 주 근거 ${refs.join(", ")}`);
  }

  const targetChars = input.question.char_limit ? lengthTarget(input.question.char_limit) : null;
  return {
    question: input.question,
    mode: input.mode,
    pack,
    aliases,
    env,
    promptPrefix: { packText: pack.text, jdText: jd.text, referenceText: buildReference(input.insightSignal ?? null) },
    questionInput: {
      ref: AI04_QUESTION_REF,
      questionText: input.question.question_text,
      templateKey: input.question.template_key,
      charLimit: input.question.char_limit,
      countBasis: input.question.count_basis,
      note,
    },
    otherQuestionsText: otherLines.length ? ["<other_questions>", ...otherLines, "</other_questions>"].join("\n") : null,
    userSourcesText: input.mode === "user" ? userSourcesBlock(userSources, pack.aliases) : null,
    userSources,
    otherPrimaryProjectIds: otherPrimary,
    careerSnapshotHash: full.careerSnapshotHash,
    requirementsHash: jd.requirementsHash,
    targetChars,
    contextReport,
  };
}

function resolveUserSource(s: UserSourceInput, aliases: AliasMap): ResolvedUserSource | null {
  if (s.project_id) {
    const projectAlias = aliases.aliasOf("project", s.project_id);
    if (!projectAlias) return null;
    const parentAlias = aliases.get(projectAlias)?.parents[0] ?? null;
    const detailAliases = s.project_detail_ids
      .map((id) => aliases.aliasOf("project_detail", id))
      .filter((a): a is string => !!a && (aliases.get(a)?.parents.includes(projectAlias) ?? false));
    return { ...s, projectAlias, parentAlias, detailAliases };
  }
  const parentAlias = s.experience_id ? aliases.aliasOf("experience", s.experience_id) : s.education_id ? aliases.aliasOf("education", s.education_id) : undefined;
  return parentAlias ? { ...s, projectAlias: null, parentAlias, detailAliases: [] } : null;
}

function userSourcesBlock(sources: readonly ResolvedUserSource[], aliases: AliasMap): string {
  const lines = sources.map((s, i) => {
    const target = s.projectAlias ? `${s.projectAlias}${s.parentAlias ? ` (${s.parentAlias})` : ""}` : `${s.parentAlias} 전체`;
    const label = sourceLabel(aliases, { projectAlias: s.projectAlias, parentAlias: s.parentAlias });
    const details = s.detailAliases.length ? ` | 상세 내용: ${s.detailAliases.join(", ")}` : "";
    return `${i + 1}. ${s.role} | ${target} '${escLine(label)}'${details}`;
  });
  return ["<user_sources>", ...(lines.length ? lines : ["(사용자가 모든 프로젝트를 제외했습니다)"]), "</user_sources>"].join("\n");
}

function buildReference(signal: { strengths: ReadonlyArray<{ title: string; description: string }>; positioning: string | null } | null): string | null {
  if (!signal) return null;
  const lines: string[] = [];
  if (signal.positioning) lines.push(`인사이트 지원 방향: ${escLine(signal.positioning)}`);
  for (const s of signal.strengths) lines.push(`인사이트 강점: ${escLine(s.title)} — ${escLine(s.description)}`);
  return lines.length ? ["<reference>", ...lines, "</reference>"].join("\n") : null;
}

// ---------- input hash ----------

export function computeCoverLetterInputHash(parts: {
  provider: ProviderId;
  model: string;
  careerSnapshotHash: string;
  requirementsHash: string;
  question: Pick<CoverLetterQuestion, "question_text" | "template_key" | "char_limit" | "count_basis" | "user_note">;
  mode: "ai" | "user";
  userSources: readonly UserSourceInput[];
}): string {
  const q = parts.question;
  return computeInputHash({
    feature: AI04_JOB_TYPE,
    promptVersion: `${AI04_PROMPT_VERSION}+${AI04_ADJUST_PROMPT_VERSION.split("+")[0]}`,
    provider: parts.provider,
    model: parts.model,
    careerSnapshotHash: parts.careerSnapshotHash,
    requirementsHash: parts.requirementsHash,
    params: {
      question_text: q.question_text,
      template_key: q.template_key,
      char_limit: q.char_limit,
      count_basis: q.count_basis,
      user_note: q.user_note?.trim() || null,
      mode: parts.mode,
      user_sources:
        parts.mode === "user"
          ? parts.userSources.map((s) => ({ ...s, project_detail_ids: [...s.project_detail_ids].sort() }))
          : [],
    },
  });
}

// ---------- sources ----------

export type ValidatedSource = {
  projectAlias: string | null;
  parentAlias: string | null;
  detailAliases: string[];
  view: SelectedSourceView;
  evidence: ValidatedEvidence[];
};

function learningsFor(questionClass: QuestionClass): LearningsPolicy {
  return LEARNINGS_ALLOWED_CLASSES.has(questionClass) ? "reflection_only" : "forbidden";
}

/** Server question class: the template key wins; user-added questions take the model's class. */
export function resolveQuestionClass(context: CoverLetterContext, modelClass: QuestionClass | null, report?: Record<string, number>): QuestionClass {
  const fixed = context.question.template_key;
  if (fixed) {
    if (modelClass && modelClass !== fixed && report) addToReport(report, { question_class_overridden: 1 });
    return fixed;
  }
  return modelClass ?? "experience_story";
}

/**
 * AI mode: refs → rows (V-1), real parent (model's parent corrected), details
 * of that project (≤ 2), one source per project, evidence within the source
 * (V-1..V-3, V-8, V-7) — a source with no valid evidence is dropped (V-4,
 * "선택마다 근거 인용 1개 이상"), roles normalized (one primary), per-class
 * count cap (truncate). User mode: exactly the user's list; the model only
 * supplies rationale / requirement refs / evidence for matching entries.
 */
export function validateSources(raw: readonly Ai04Source[], questionClass: QuestionClass, context: CoverLetterContext, report: Record<string, number>): ValidatedSource[] {
  const { aliases, env } = context;
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

  const build = (
    s: Ai04Source | null,
    target: { projectAlias: string | null; parentAlias: string | null; detailAliases: string[]; role: DraftSourceRole },
  ): ValidatedSource | null => {
    const scope = buildSourceScope(aliases, [target]);
    const outcome = s
      ? validateItem({ key: "source", kind: "judgment", evidence: s.evidence, learnings, scope }, env.ctx)
      : { outcome: { evidence: [] as ValidatedEvidence[], action: "drop" as const }, report: {} };
    addToReport(report, outcome.report);
    const requirementIds: string[] = [];
    for (const ref of s?.requirement_refs ?? []) {
      const id = aliases.resolveId(ref.trim(), "jd_requirement");
      if (!id) addToReport(report, { requirement_refs_dropped: 1 });
      else if (!requirementIds.includes(id)) requirementIds.push(id);
    }
    const id = (alias: string | null, type: "project" | "experience" | "education") => (alias ? aliases.resolveId(alias, type) : null);
    const parentEntry = target.parentAlias ? aliases.get(target.parentAlias) : undefined;
    return {
      projectAlias: target.projectAlias,
      parentAlias: target.parentAlias,
      detailAliases: target.detailAliases,
      evidence: outcome.outcome.action === "drop" ? [] : outcome.outcome.evidence,
      view: {
        sort_order: 0,
        role: target.role,
        project_id: id(target.projectAlias, "project"),
        experience_id: parentEntry?.sourceType === "experience" ? parentEntry.id : null,
        education_id: parentEntry?.sourceType === "education" ? parentEntry.id : null,
        project_detail_ids: target.detailAliases.map((a) => aliases.resolveId(a, "project_detail")).filter((v): v is string => !!v),
        label: sourceLabel(aliases, target),
        rationale: s ? (clipText(cleanProse(s.rationale, env, report), RATIONALE_MAX) ?? "") : "",
        reuse_reason: s?.reuse_reason ? clipText(cleanProse(s.reuse_reason, env, report), RATIONALE_MAX) : null,
        requirement_ids: requirementIds,
      },
    };
  };

  let out: ValidatedSource[] = [];
  if (context.mode === "user") {
    const byKey = new Map<string, Ai04Source>();
    for (const s of raw) {
      const r = resolveModel(s);
      const k = r ? key(r) : null;
      const listed = k && context.userSources.some((u) => key(u) === k);
      if (!listed) addToReport(report, { sources_dropped_not_in_user_list: 1 });
      else if (k && !byKey.has(k)) byKey.set(k, s);
    }
    for (const u of context.userSources) {
      const v = build(byKey.get(key(u)) ?? null, { projectAlias: u.projectAlias, parentAlias: u.parentAlias, detailAliases: u.detailAliases, role: u.role });
      if (v) out.push(v);
    }
  } else {
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
      const details = r.projectAlias
        ? s.detail_refs.map((d) => d.trim()).filter((d, i, all) => all.indexOf(d) === i && (aliases.get(d)?.parents.includes(r.projectAlias as string) ?? false))
        : [];
      if (details.length !== s.detail_refs.length) addToReport(report, { detail_refs_dropped: s.detail_refs.length - details.length });
      const v = build(s, { ...r, detailAliases: details.slice(0, MAX_DETAIL_REFS), role: s.role });
      if (!v || v.evidence.length === 0) {
        addToReport(report, { sources_dropped_no_evidence: 1 });
        continue;
      }
      if (v.view.project_id && context.otherPrimaryProjectIds.has(v.view.project_id) && !v.view.reuse_reason) addToReport(report, { reuse_without_reason: 1 });
      out.push(v);
    }
    // One primary, listed first.
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
  }
  return out.map((s, i) => ({ ...s, view: { ...s.view, sort_order: i } }));
}

function paragraphScope(context: CoverLetterContext, sources: readonly ValidatedSource[]): Set<string> {
  const items: SourceScopeItem[] = sources.map((s) => ({ projectAlias: s.projectAlias, parentAlias: s.parentAlias, detailAliases: s.detailAliases }));
  return buildSourceScope(context.aliases, items);
}

// ---------- stream ----------

export type Ai04Deps = {
  llm: Llm;
  persist: (payload: CompleteCoverLetterSectionPayload) => Promise<{ resultId: string | null }>;
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
  now?: () => Date;
  callKey?: string;
  adjustCallKey?: string;
};

export type CoverLetterView = {
  kind: "cover_letter_section";
  section_id: string;
  question_class: QuestionClass;
  selection_mode: "ai" | "user";
  sources: SelectedSourceView[];
  blocks: DraftBlock[];
  ai_char_count: number;
  char_limit: number | null;
  count_basis: CountBasis;
  correction_applied: boolean;
  char_adjust_needed: boolean;
  notes_for_user: string[];
  evidence: Array<EvidenceChip & { item_key: string }>;
};

/** Final paragraph ids are unique within the draft (db: block_id unique per draft): `q<section8>-p<n>`. */
export function paragraphBlockId(sectionId: string, n: number): string {
  return `q${sectionId.replace(/-/g, "").slice(0, 8)}-p${n}`;
}

export function streamCoverLetterSection(input: { context: CoverLetterContext }, deps: Ai04Deps): AsyncGenerator<AiStreamEvent> {
  const { context } = input;
  const state: { sources: ValidatedSource[] | null; questionClass: QuestionClass | null } = { sources: null, questionClass: null };
  const now = () => (deps.now ?? (() => new Date()))();

  const classFromRoot = (root: unknown): QuestionClass | null => {
    const v = root && typeof root === "object" ? (root as Record<string, unknown>).question_class : null;
    return typeof v === "string" && ["motivation", "job_competency", "future_plan", "experience_story"].includes(v) ? (v as QuestionClass) : null;
  };

  return runStructuredStream<Ai04Output>({
    llm: deps.llm,
    request: {
      feature: "AI-04.generate",
      promptVersion: AI04_PROMPT_VERSION,
      callKey: deps.callKey ?? AI04_CALL_KEY,
      tier: AI04_TIER,
      systemBlocks: systemBlocks(),
      userBlocks: generateUserBlocks({
        ...context.promptPrefix,
        question: context.questionInput,
        otherQuestionsText: context.otherQuestionsText,
        userSourcesText: context.userSourcesText,
        targetChars: context.targetChars,
      }),
      maxOutputTokens: AI04_MAX_OUTPUT_TOKENS,
      reasoningLevel: "low",
      signal: deps.signal,
    },
    schema: Ai04OutputSchema,
    watchPaths: ["sources"],
    onValue: (_path, value, root) => {
      const parsed = Ai04SourceSchema.array().safeParse(value);
      if (!parsed.success) return [];
      const questionClass = resolveQuestionClass(context, classFromRoot(root));
      state.questionClass = questionClass;
      state.sources = validateSources(parsed.data, questionClass, context, {});
      return [{ type: "sources_selected", selectionMode: context.mode, questionClass, sources: state.sources.map((s) => s.view) }];
    },
    validateBlock: (raw, blockId, at) => {
      if (!/^paragraphs\.\d+$/.test(at.path)) return null;
      const parsed = toRawBlock(raw, blockId);
      if (!parsed) return null;
      const questionClass = state.questionClass ?? resolveQuestionClass(context, classFromRoot(at.root));
      // Sources not seen yet (unusual key order): user mode knows its list; AI mode stays strict (profile/JD/note only).
      const sources = state.sources ?? (context.mode === "user" ? validateSources([], questionClass, context, {}) : []);
      const checked = checkDraftBlock(
        parsed,
        { blockId, kind: "paragraph", projectId: null, learnings: learningsFor(questionClass), scope: paragraphScope(context, sources) },
        context.env,
        "provisional",
      );
      return { ...checked.block, evidence: toEvidenceChips(checked.evidence, context.aliases) };
    },
    finalize: (value, meta) => finalizeStream(value, meta, context, deps, now),
  });
}

function toRawBlock(raw: Record<string, unknown>, blockId: string): RawDraftBlock | null {
  if (typeof raw.text !== "string") return null;
  return {
    block_id: blockId,
    text: raw.text,
    evidence: Array.isArray(raw.evidence) ? (raw.evidence as RawDraftBlock["evidence"]).filter((e) => e && typeof e === "object" && typeof e.ref === "string") : [],
    placeholders: Array.isArray(raw.placeholders) ? (raw.placeholders as RawDraftBlock["placeholders"]).filter((p) => p && typeof p.token === "string") : [],
    requirement_refs: Array.isArray(raw.requirement_refs) ? (raw.requirement_refs as unknown[]).filter((r): r is string => typeof r === "string") : [],
  };
}

type CheckedParagraphs = {
  blocks: DraftBlock[];
  evidence: Array<{ itemKey: string; evidence: ValidatedEvidence[] }>;
  unsupportedNumbers: string[];
  charCount: number;
  report: DraftReport;
};

/** Provisional (numbers kept) or final (numbers replaced) check of all paragraphs + server char count. */
function checkParagraphs(
  paragraphs: readonly Ai04Paragraph[],
  context: CoverLetterContext,
  sources: readonly ValidatedSource[],
  questionClass: QuestionClass,
  mode: "provisional" | "final",
): CheckedParagraphs {
  const report = emptyDraftReport();
  const scope = paragraphScope(context, sources);
  const blocks: DraftBlock[] = [];
  const evidence: CheckedParagraphs["evidence"] = [];
  const numbers = new Set<string>();
  paragraphs.forEach((p, i) => {
    const blockId = paragraphBlockId(context.question.section_id, i + 1);
    const checked = checkDraftBlock(p, { blockId, kind: "paragraph", projectId: null, learnings: learningsFor(questionClass), scope }, context.env, mode);
    addToReport(report, checked.report);
    for (const n of checked.unsupportedNumbers) numbers.add(n);
    blocks.push(checked.block);
    if (checked.evidence.length) evidence.push({ itemKey: blockId, evidence: checked.evidence });
  });
  const charCount = countChars(blocks.map((b) => b.text).join(PARAGRAPH_SEPARATOR), context.question.count_basis);
  return { blocks, evidence, unsupportedNumbers: [...numbers], charCount, report };
}

async function* finalizeStream(
  value: Ai04Output,
  meta: AiCallResult,
  context: CoverLetterContext,
  deps: Ai04Deps,
  now: () => Date,
): AsyncGenerator<AiStreamEvent, { result: CoverLetterView; validationReport: DraftReport; resultId: string | null; model: string }, void> {
  const report = emptyDraftReport();
  addToReport(report, context.contextReport);
  const questionClass = resolveQuestionClass(context, value.question_class, report);
  const sources = validateSources(value.sources, questionClass, context, report);
  if (value.selection_mode !== context.mode) addToReport(report, { selection_mode_corrected: 1 });

  let paragraphs: readonly Ai04Paragraph[] = value.paragraphs;
  let usage: NormalizedUsage = meta.usage;
  const draft = checkParagraphs(paragraphs, context, sources, questionClass, "provisional");
  const limit = context.question.char_limit;
  let correctionApplied = false;
  let charAdjustNeeded = false;

  if (limit && isLengthOutOfRange(draft.charCount, limit)) {
    yield {
      type: "adjusting_length",
      charCount: draft.charCount,
      charLimit: limit,
      countBasis: context.question.count_basis,
      reasons: draft.unsupportedNumbers.length ? ["length", "numbers"] : ["length"],
    };
    try {
      const adjusted = await adjustCoverLetterLength({ context, paragraphs, charCount: draft.charCount, unsupportedNumbers: draft.unsupportedNumbers }, deps);
      usage = addUsage(usage, adjusted.usage);
      paragraphs = adjusted.paragraphs;
      correctionApplied = true;
      addToReport(report, { length_adjusted: 1, number_violations: draft.unsupportedNumbers.length });
    } catch (err) {
      // A user cancel ends the run; any other failure keeps the first draft (flagged) instead of losing it.
      if (isProviderError(err) && err.code === "canceled") throw err;
      addToReport(report, { length_adjust_failed: 1 });
    }
  }

  const final = checkParagraphs(paragraphs, context, sources, questionClass, "final");
  addToReport(report, final.report);
  if (limit && isLengthOutOfRange(final.charCount, limit)) {
    charAdjustNeeded = true;
    addToReport(report, { char_adjust_needed: 1 });
  }

  const notes = value.notes_for_user.map((n) => clipText(cleanProse(n, context.env, report), 300)).filter((n): n is string => !!n);
  const evidenceItems = [
    ...sources.map((s, n) => ({ itemKey: sourceItemKey(n), evidence: s.evidence })).filter((i) => i.evidence.length),
    ...final.evidence,
  ];
  const payloadSources: CoverLetterPayloadSource[] = sources.map((s) => ({
    project_id: s.view.project_id,
    experience_id: s.view.experience_id,
    education_id: s.view.education_id,
    project_detail_ids: s.view.project_detail_ids,
    role: s.view.role,
    rationale: s.view.rationale || null,
    requirement_ids: s.view.requirement_ids,
    reuse_reason: s.view.reuse_reason,
    source_label: clipText(s.view.label, 300),
  }));
  const inputHash = computeCoverLetterInputHash({
    provider: deps.llm.provider,
    model: meta.model,
    careerSnapshotHash: context.careerSnapshotHash,
    requirementsHash: context.requirementsHash,
    question: context.question,
    mode: context.mode,
    userSources: context.userSources.map(({ experience_id, education_id, project_id, project_detail_ids, role }) => ({ experience_id, education_id, project_id, project_detail_ids, role })),
  });
  const payload: CompleteCoverLetterSectionPayload = {
    question_class: questionClass,
    blocks: final.blocks,
    ai_char_count: final.charCount,
    correction_applied: correctionApplied,
    sources: payloadSources,
    hashes: { input_hash: inputHash, career_snapshot_hash: context.careerSnapshotHash },
    meta: {
      schema_version: AI04_OUTPUT_SCHEMA_VERSION,
      prompt_version: correctionApplied ? `${AI04_PROMPT_VERSION.split("+")[0]}+${AI04_ADJUST_PROMPT_VERSION}` : AI04_PROMPT_VERSION,
      provider: deps.llm.provider,
      model: meta.model,
      model_tier: AI04_TIER,
      connection_tier: deps.llm.connectionTier,
      validation_report: { ...report },
      usage,
    },
    evidence: toPayloadEvidence(evidenceItems, context.aliases, now()),
    char_adjust_needed: charAdjustNeeded,
    notes_for_user: notes,
  };
  (deps.logger ?? silentAiLogger)({ event: "ai_validation", jobId: deps.jobId ?? null, feature: "AI-04", promptVersion: payload.meta.prompt_version, stats: { ...report } });
  const { resultId } = await deps.persist(payload);
  const chips = evidenceItems.flatMap((item) => toEvidenceChips(item.evidence, context.aliases).map((c) => ({ ...c, item_key: item.itemKey })));
  return {
    result: {
      kind: "cover_letter_section",
      section_id: context.question.section_id,
      question_class: questionClass,
      selection_mode: context.mode,
      sources: sources.map((s) => s.view),
      blocks: final.blocks,
      ai_char_count: final.charCount,
      char_limit: limit,
      count_basis: context.question.count_basis,
      correction_applied: correctionApplied,
      char_adjust_needed: charAdjustNeeded,
      notes_for_user: notes,
      evidence: chips,
    },
    validationReport: report,
    resultId,
    model: meta.model,
  };
}

/**
 * The one correction call (ai-04.adjust): same prefix (cache), the draft as
 * data, a target of 95% of the limit, and any unsupported numbers to drop.
 * Its output is validated again by the caller with the same rules.
 */
export async function adjustCoverLetterLength(
  input: { context: CoverLetterContext; paragraphs: readonly Ai04Paragraph[]; charCount: number; unsupportedNumbers: readonly string[] },
  deps: Pick<Ai04Deps, "llm" | "signal" | "adjustCallKey">,
): Promise<{ paragraphs: Ai04Paragraph[]; usage: NormalizedUsage; model: string }> {
  const { context } = input;
  const result = await generateStructured(
    deps.llm,
    {
      feature: "AI-04.adjust",
      promptVersion: AI04_ADJUST_PROMPT_VERSION,
      callKey: deps.adjustCallKey ?? AI04_ADJUST_CALL_KEY,
      tier: AI04_TIER,
      systemBlocks: systemBlocks(),
      userBlocks: adjustUserBlocks({
        ...context.promptPrefix,
        question: context.questionInput,
        draftJson: JSON.stringify({ paragraphs: input.paragraphs }),
        charCount: input.charCount,
        targetChars: context.targetChars,
        unsupportedNumbers: input.unsupportedNumbers,
      }),
      maxOutputTokens: AI04_MAX_OUTPUT_TOKENS,
      reasoningLevel: "low",
      signal: deps.signal,
    },
    Ai04AdjustOutputSchema,
    { accept: (v) => v.paragraphs.length > 0 },
  );
  return { paragraphs: result.value.paragraphs, usage: result.meta.usage, model: result.meta.model };
}

export { countChars };
export type { AliasEntry };
