import type { SelectionOrigin } from "@/lib/contracts/enums";
import { AliasMap, type AliasEntry } from "../context-pack/aliases";
import { buildCareerPack, type CareerPack } from "../context-pack/career-pack";
import type { CareerRows } from "../context-pack/career-rows";
import { buildJdContext, type JdRequirementInput } from "../context-pack/jd";
import type { YearMonth } from "../context-pack/months";
import { filterCareerRows, MAX_DRAFT_PROJECTS, packProjects } from "../context-pack/selection";
import type { EvidenceSourceType } from "../evidence-rules";
import { computeInputHash } from "../input-hash";
import type { Llm } from "../llm";
import { silentAiLogger, type AiLogger } from "../log";
import { AI03_PROMPT_VERSION, systemBlocks, userBlocks, type Ai03TaskSection } from "../prompts/AI-03";
import { escLine } from "../prompts/drafts-common";
import type { AiCallResult, ProviderId } from "../providers/types";
import { AI03_OUTPUT_SCHEMA_VERSION, Ai03OutputSchema, type Ai03Output, type Ai03Project } from "../schemas/AI-03";
import { clipText, toPayloadEvidence, type CompleteCareerDescriptionPayload } from "../storage/drafts";
import type { AiStreamEvent } from "../streaming/events";
import { runStructuredStream, type StreamFinalization } from "../streaming/structured-stream";
import { literalAliasTokens } from "../validation/alias-text";
import {
  addToReport,
  buildTermCorpus,
  checkDraftBlock,
  claimBlockId,
  cleanProse,
  emptyDraftReport,
  toEvidenceChips,
  type DraftBlock,
  type DraftCheckEnv,
  type DraftReport,
  type EvidenceChip,
  type RawDraftBlock,
} from "../validation/draft-blocks";
import { buildSelectionScope, type ValidatedEvidence } from "../validation/evidence";
import { buildAllowedNumbers } from "../validation/numbers";
import type { RankingItem } from "./AI-11";

/**
 * AI-03 경력기술서 초안 (F-DOC-01, 03, 04). Streaming (C-6), default tier,
 * low reasoning, one call + server post-processing:
 *
 *   planCareerDescription          (no call) options → normalized options + section plan (begin_career_description)
 *   buildCareerDescriptionContext  (no call) pack of the selected items only + JD + reference signals
 *   streamCareerDescription        block events → full validation → persist(p_payload) → validated → done
 *
 * Server-filled headers (company, period, rank / institution, program,
 * period, status / project name, period), ≤ 8 projects, ≤ 4 bullets each,
 * V-7 to the selection, V-8 learnings forbidden, V-5 + skill-name guard as flags,
 * situation/task-only bullets flagged, zero-evidence blocks kept and flagged (V-4).
 * No V-5 regeneration call (spec-gaps S7 ai ②): unsupported numbers are replaced and flagged.
 */

export const AI03_TIER = "default" as const;
export const AI03_JOB_TYPE = "career_description";
export const AI03_CALL_KEY = "career_description.generate";
export const AI03_MAX_BULLETS_PER_PROJECT = 4;
export const AI03_MAX_PROJECTS = MAX_DRAFT_PROJECTS;
/** Output ≈ 5k tokens incl. evidence JSON and reasoning (card 비용); headroom. */
export const AI03_MAX_OUTPUT_TOKENS = 16_000;
export const STANDALONE_HEADING = "기타 프로젝트";
export const TRUNCATED_PROJECTS_NOTE = `프로젝트는 최대 ${MAX_DRAFT_PROJECTS}개까지 넣었습니다. 빠진 프로젝트는 포함 항목에서 순서를 바꿔 다시 생성할 수 있습니다.`;

export { AI03_PROMPT_VERSION };

const ENROLLMENT_LABEL: Record<string, string> = { enrolled: "재학", graduated: "졸업", completed: "수료", dropped_out: "중퇴", on_leave: "휴학" };

// ---------- plan ----------

export type CareerDescriptionOptionsInput = {
  included_experience_ids: string[];
  included_education_ids: string[];
  included_project_ids: string[];
  project_order: string[];
  selection_origin: SelectionOrigin;
  ranking: RankingItem[] | null;
  tone: string | null;
};

export type SectionPlan = {
  sort_order: number;
  section_kind: "experience" | "education" | "standalone_projects";
  experience_id: string | null;
  education_id: string | null;
  heading: string;
  /** Projects of this section in output order. */
  project_ids: string[];
};

export type CareerDescriptionPlan = {
  /** Normalized `drafts.options` (pass to begin_career_description p_options). */
  options: CareerDescriptionOptionsInput;
  /** begin_career_description p_sections (+ project_ids, which the RPC ignores). */
  sections: SectionPlan[];
  /** Selected projects over the 8 cap (dropped, project_order last first). */
  truncatedProjectIds: string[];
};

/**
 * Options → normalized options + sections (no call). Ids not in today's pack
 * (deleted, draft, child of a draft parent) are dropped; parents of included
 * projects are added; projects ordered by `project_order` then pack order and
 * capped at 8. Sections: experiences (latest first) → educations (latest
 * first) → standalone projects (AI-03 처리 방식 [가정]). Empty `sections` = nothing to write.
 */
export function planCareerDescription(input: { careerRows: CareerRows; asOf?: YearMonth; options: CareerDescriptionOptionsInput }): CareerDescriptionPlan {
  const aliases = buildCareerPack(input.careerRows, { asOf: input.asOf }).aliases;
  const projects = packProjects(aliases);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const packOrder = projects.map((p) => p.id);
  const userOrder = dedupe(input.options.project_order.filter((id) => byId.has(id)));
  const order = [...userOrder, ...packOrder.filter((id) => !userOrder.includes(id))];
  const rank = new Map(order.map((id, i) => [id, i]));

  const wanted = dedupe(input.options.included_project_ids.filter((id) => byId.has(id))).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  const included = wanted.slice(0, AI03_MAX_PROJECTS);
  const truncatedProjectIds = wanted.slice(AI03_MAX_PROJECTS);

  const entries = [...aliases.values()];
  const idsOf = (type: EvidenceSourceType) => new Set(entries.filter((e) => e.sourceType === type).map((e) => e.id));
  const expIds = idsOf("experience");
  const eduIds = idsOf("education");
  const parentOf = (projectId: string) => byId.get(projectId)?.parent ?? null;
  const experiences = new Set(input.options.included_experience_ids.filter((id) => expIds.has(id)));
  const educations = new Set(input.options.included_education_ids.filter((id) => eduIds.has(id)));
  for (const id of included) {
    const parent = parentOf(id);
    if (parent?.sourceType === "experience") experiences.add(parent.id);
    if (parent?.sourceType === "education") educations.add(parent.id);
  }

  const sections: SectionPlan[] = [];
  const projectsUnder = (parentId: string | null) => included.filter((id) => (parentOf(id)?.id ?? null) === parentId);
  for (const e of entries) {
    if (e.sourceType === "experience" && experiences.has(e.id)) {
      sections.push({ sort_order: sections.length, section_kind: "experience", experience_id: e.id, education_id: null, heading: e.label ?? "", project_ids: projectsUnder(e.id) });
    }
  }
  for (const e of entries) {
    if (e.sourceType === "education" && educations.has(e.id)) {
      const heading = [e.label, e.fields.program_name].filter(Boolean).join(" ");
      sections.push({ sort_order: sections.length, section_kind: "education", experience_id: null, education_id: e.id, heading, project_ids: projectsUnder(e.id) });
    }
  }
  const standalone = projectsUnder(null);
  if (standalone.length) {
    sections.push({ sort_order: sections.length, section_kind: "standalone_projects", experience_id: null, education_id: null, heading: STANDALONE_HEADING, project_ids: standalone });
  }

  const inPackOrder = (set: Set<string>, type: EvidenceSourceType) => entries.filter((e) => e.sourceType === type && set.has(e.id)).map((e) => e.id);
  return {
    options: {
      included_experience_ids: inPackOrder(experiences, "experience"),
      included_education_ids: inPackOrder(educations, "education"),
      included_project_ids: included,
      project_order: order,
      selection_origin: input.options.selection_origin,
      ranking: input.options.ranking,
      tone: input.options.tone,
    },
    sections,
    truncatedProjectIds,
  };
}

// ---------- context ----------

export type CareerDescriptionInsightSignal = {
  positioning: string | null;
  projectPriorities: ReadonlyArray<{ project_id: string; rank: number; reason: string }>;
  requirementStatuses: ReadonlyArray<{ requirement_id: string; status: "met" | "partial" | "no_evidence" }>;
};

export type CareerDescriptionContext = {
  plan: CareerDescriptionPlan;
  pack: CareerPack;
  packText: string;
  jdText: string;
  referenceText: string | null;
  aliases: AliasMap;
  env: DraftCheckEnv;
  /** Full pack (C-1) hash — the same value every feature stores. */
  careerSnapshotHash: string;
  requirementsHash: string;
  /** Per plan section: its EXP/EDU alias and its project aliases. */
  taskSections: Ai03TaskSection[];
};

export function buildCareerDescriptionContext(input: {
  careerRows: CareerRows;
  asOf?: YearMonth;
  plan: CareerDescriptionPlan;
  jobDescriptionId: string;
  requirements: readonly JdRequirementInput[];
  insightSignal?: CareerDescriptionInsightSignal | null;
}): CareerDescriptionContext {
  const { plan } = input;
  const full = buildCareerPack(input.careerRows, { asOf: input.asOf });
  const rows = filterCareerRows(input.careerRows, {
    experienceIds: plan.options.included_experience_ids,
    educationIds: plan.options.included_education_ids,
    projectIds: plan.options.included_project_ids,
  });
  const pack = buildCareerPack(rows, { asOf: input.asOf });
  const jd = buildJdContext({ jobDescriptionId: input.jobDescriptionId, sentences: [], requirements: input.requirements, includeSentences: "none" });
  const aliases = AliasMap.merge(pack.aliases, jd.aliases);

  // V-7 (C-3): career evidence of the selected items only; JD and notes are never evidence in a career description (db: career sources only).
  const scope = new Set([...buildSelectionScope(pack.aliases, { refs: [...pack.aliases.values()].map((e) => e.alias) })].filter((a) => pack.aliases.has(a)));
  const numberTexts = [...pack.numberSources.factualTexts, ...jd.numberTexts];
  const env: DraftCheckEnv = {
    aliases,
    ctx: { aliases, learnings: "forbidden", scope },
    allowedNumbers: buildAllowedNumbers({ texts: numberTexts, numbers: pack.numberSources.computedNumbers }),
    literalAliasTokens: literalAliasTokens(numberTexts),
    termCorpus: buildTermCorpus(full.numberSources.factualTexts),
  };

  const alias = (type: EvidenceSourceType, id: string | null) => (id ? (pack.aliases.aliasOf(type, id) ?? null) : null);
  const taskSections: Ai03TaskSection[] = plan.sections.map((s) => ({
    kind: s.section_kind,
    ref: s.section_kind === "experience" ? alias("experience", s.experience_id) : s.section_kind === "education" ? alias("education", s.education_id) : null,
    projectRefs: s.project_ids.map((id) => alias("project", id)).filter((a): a is string => !!a),
  }));

  return {
    plan,
    pack,
    packText: pack.text,
    jdText: jd.text,
    referenceText: buildReference(input.insightSignal ?? null, plan.options.ranking, aliases),
    aliases,
    env,
    careerSnapshotHash: full.careerSnapshotHash,
    requirementsHash: jd.requirementsHash,
    taskSections,
  };
}

/** <reference>: insight priorities / requirement statuses and AI-11 relevance as aliases (card 입력: 참고 신호). */
function buildReference(signal: CareerDescriptionInsightSignal | null, ranking: readonly RankingItem[] | null, aliases: AliasMap): string | null {
  const prj = (id: string) => aliases.aliasOf("project", id);
  const req = (id: string) => aliases.aliasOf("jd_requirement", id);
  const lines: string[] = [];
  if (signal) {
    if (signal.positioning) lines.push(`인사이트 지원 방향: ${escLine(signal.positioning)}`);
    const priorities = [...signal.projectPriorities].sort((a, b) => a.rank - b.rank).filter((p) => prj(p.project_id));
    if (priorities.length) lines.push("인사이트 프로젝트 우선순위:", ...priorities.map((p) => `- ${p.rank}. ${prj(p.project_id)}: ${escLine(p.reason)}`));
    const statuses = signal.requirementStatuses.filter((s) => req(s.requirement_id));
    if (statuses.length) lines.push(`인사이트 요건 판정: ${statuses.map((s) => `${req(s.requirement_id)}=${s.status}`).join(", ")}`);
  }
  const ranked = (ranking ?? []).filter((r) => prj(r.project_id));
  if (ranked.length) {
    lines.push("관련도 정렬:", ...ranked.map((r) => `- ${prj(r.project_id)}: ${r.relevance}${r.requirement_ids.map(req).filter(Boolean).length ? ` (${r.requirement_ids.map(req).filter(Boolean).join(", ")})` : ""}`));
  }
  return lines.length ? ["<reference>", ...lines, "</reference>"].join("\n") : null;
}

// ---------- input hash ----------

export function computeCareerDescriptionInputHash(parts: {
  provider: ProviderId;
  model: string;
  careerSnapshotHash: string;
  requirementsHash: string;
  /** The normalized options (planCareerDescription). */
  options: CareerDescriptionOptionsInput;
}): string {
  const o = parts.options;
  return computeInputHash({
    feature: AI03_JOB_TYPE,
    promptVersion: AI03_PROMPT_VERSION,
    provider: parts.provider,
    model: parts.model,
    careerSnapshotHash: parts.careerSnapshotHash,
    requirementsHash: parts.requirementsHash,
    params: {
      included_experience_ids: [...o.included_experience_ids].sort(),
      included_education_ids: [...o.included_education_ids].sort(),
      included_project_ids: o.included_project_ids,
      project_order: o.project_order,
      tone: o.tone,
    },
  });
}

// ---------- stream ----------

export type Ai03Deps = {
  llm: Llm;
  persist: (payload: CompleteCareerDescriptionPayload) => Promise<{ resultId: string | null }>;
  signal?: AbortSignal;
  logger?: AiLogger;
  jobId?: string | null;
  now?: () => Date;
  callKey?: string;
};

export type CareerDescriptionView = {
  kind: "career_description";
  sections: Array<{
    section_id: string;
    sort_order: number;
    section_kind: SectionPlan["section_kind"];
    experience_id: string | null;
    education_id: string | null;
    heading: string;
    blocks: DraftBlock[];
  }>;
  omitted: CompleteCareerDescriptionPayload["omitted"];
  notes_for_user: string[];
  evidence: Array<EvidenceChip & { item_key: string; section_id: string }>;
};

/**
 * Streams one career description. `sections` = begin_career_description's
 * `sections` (section_id per sort_order). Exactly one terminal event.
 */
export function streamCareerDescription(
  input: { context: CareerDescriptionContext; sections: ReadonlyArray<{ section_id: string; sort_order: number }> },
  deps: Ai03Deps,
): AsyncGenerator<AiStreamEvent> {
  const { context } = input;
  const sectionIds = new Map(input.sections.map((s) => [s.sort_order, s.section_id]));
  for (const s of context.plan.sections) if (!sectionIds.has(s.sort_order)) throw new Error("streamCareerDescription: section ids don't match the plan");
  if (!context.plan.sections.length) throw new Error("streamCareerDescription: empty plan");

  return runStructuredStream<Ai03Output>({
    llm: deps.llm,
    request: {
      feature: "AI-03.generate",
      promptVersion: AI03_PROMPT_VERSION,
      callKey: deps.callKey ?? AI03_CALL_KEY,
      tier: AI03_TIER,
      systemBlocks: systemBlocks(),
      userBlocks: userBlocks({
        packText: context.packText,
        jdText: context.jdText,
        referenceText: context.referenceText,
        sections: context.taskSections,
        tone: context.plan.options.tone,
      }),
      maxOutputTokens: AI03_MAX_OUTPUT_TOKENS,
      reasoningLevel: "low",
      signal: deps.signal,
    },
    schema: Ai03OutputSchema,
    validateBlock: (raw, blockId, at) => provisionalBlock(raw, blockId, at, context),
    finalize: async (value, meta) => {
      const final = finalizeCareerDescription({ context, output: value, meta, sectionIds, llm: deps.llm, now: (deps.now ?? (() => new Date()))() });
      (deps.logger ?? silentAiLogger)({ event: "ai_validation", jobId: deps.jobId ?? null, feature: "AI-03", promptVersion: AI03_PROMPT_VERSION, stats: { ...final.report } });
      const { resultId } = await deps.persist(final.payload);
      return { result: final.view, validationReport: final.report, resultId, model: meta.model } satisfies StreamFinalization;
    },
  });
}

function kindFromPath(path: string): "summary" | "role_line" | "bullet" | null {
  if (/\.summary$/.test(path)) return "summary";
  if (/\.role_line$/.test(path)) return "role_line";
  if (/\.bullets\.\d+$/.test(path)) return "bullet";
  return null;
}

/** Project object that contains a block path (…projects.N.role_line / …projects.N.bullets.M / standalone_projects.N…). */
function projectRefAt(root: unknown, path: string): string | null {
  const m = /^(.*(?:projects|standalone_projects)\.\d+)\.(?:role_line|bullets\.\d+)$/.exec(path);
  if (!m) return null;
  let node: unknown = root;
  for (const key of m[1].split(".")) {
    if (node === null || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[key];
  }
  const ref = node && typeof node === "object" ? (node as Record<string, unknown>).project_ref : null;
  return typeof ref === "string" ? ref.trim() : null;
}

/** block_completed payload: block-level checks, evidence chips, no number replacement yet. */
function provisionalBlock(raw: Record<string, unknown>, blockId: string, at: { path: string; root: unknown }, context: CareerDescriptionContext): unknown | null {
  const kind = kindFromPath(at.path);
  if (!kind) return null;
  const parsed = toRawBlock(raw, blockId);
  if (!parsed) return null;
  const projectRef = kind === "summary" ? null : projectRefAt(at.root, at.path);
  const projectId = projectRef ? context.aliases.resolveId(projectRef, "project") : null;
  const checked = checkDraftBlock(parsed, { blockId, kind, projectId }, context.env, "provisional");
  return { ...checked.block, evidence: toEvidenceChips(checked.evidence, context.aliases) };
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

// ---------- finalize (pure) ----------

export type FinalizedCareerDescription = {
  payload: CompleteCareerDescriptionPayload;
  view: CareerDescriptionView;
  report: DraftReport;
  inputHash: string;
};

export function finalizeCareerDescription(input: {
  context: CareerDescriptionContext;
  output: Ai03Output;
  meta: AiCallResult;
  sectionIds: ReadonlyMap<number, string>;
  llm: Pick<Llm, "provider" | "connectionTier">;
  now: Date;
}): FinalizedCareerDescription {
  const { context, output } = input;
  const { aliases, env, plan } = context;
  const report = emptyDraftReport();
  const used = new Set<string>();
  let serverIdSeq = 0;
  const serverId = () => `b${++serverIdSeq}`;

  // Projects written anywhere in the output, placed by their real parent (keyed by row id).
  const planned = new Set(plan.sections.flatMap((s) => s.project_ids));
  const written = new Map<string, Ai03Project>();
  const allProjects = [...output.sections.flatMap((s) => s.projects), ...output.education_sections.flatMap((s) => s.projects), ...output.standalone_projects];
  for (const p of allProjects) {
    const id = aliases.resolveId(p.project_ref.trim(), "project");
    if (!id || !planned.has(id)) addToReport(report, { projects_out_of_scope: 1 });
    else if (written.has(id)) addToReport(report, { projects_duplicate: 1 });
    else written.set(id, p);
  }
  const summaries = new Map<string, RawDraftBlock>();
  for (const s of [...output.sections.map((x) => ({ ref: x.experience_ref, type: "experience" as const, summary: x.summary })), ...output.education_sections.map((x) => ({ ref: x.education_ref, type: "education" as const, summary: x.summary }))]) {
    const id = aliases.resolveId(s.ref.trim(), s.type);
    if (!id) {
      addToReport(report, { sections_out_of_scope: 1 });
      continue;
    }
    if (s.summary && !summaries.has(id)) summaries.set(id, s.summary);
  }

  const sections: CareerDescriptionView["sections"] = [];
  const payloadSections: CompleteCareerDescriptionPayload["sections"] = [];
  const evidenceItems: Array<{ sectionId: string; itemKey: string; evidence: ValidatedEvidence[] }> = [];

  const addAiBlock = (raw: RawDraftBlock, kind: "summary" | "role_line" | "bullet", projectId: string | null, sectionReport: DraftReport, sectionId: string): DraftBlock => {
    const blockId = claimBlockId(raw.block_id, used, serverId, sectionReport);
    const checked = checkDraftBlock(raw, { blockId, kind, projectId }, env, "final");
    addToReport(sectionReport, checked.report);
    if (checked.evidence.length) evidenceItems.push({ sectionId, itemKey: blockId, evidence: checked.evidence });
    return checked.block;
  };

  plan.sections.forEach((s, si) => {
    const sectionId = input.sectionIds.get(s.sort_order) as string;
    const sectionReport = emptyDraftReport();
    const blocks: DraftBlock[] = [];
    const parentEntry = s.experience_id ? findEntry(aliases, "experience", s.experience_id) : s.education_id ? findEntry(aliases, "education", s.education_id) : null;
    blocks.push(headerBlock(claimBlockId(`h${si + 1}`, used, serverId, sectionReport), s, parentEntry, null));
    const parentId = s.experience_id ?? s.education_id;
    const summary = parentId ? summaries.get(parentId) : undefined;
    if (summary) {
      if (s.section_kind === "education" && !parentEntry?.fields.description) addToReport(sectionReport, { education_summary_dropped: 1 });
      else blocks.push(addAiBlock(summary, "summary", null, sectionReport, sectionId));
    }
    s.project_ids.forEach((projectId, pi) => {
      const projectEntry = findEntry(aliases, "project", projectId);
      blocks.push(headerBlock(claimBlockId(`h${si + 1}-${pi + 1}`, used, serverId, sectionReport), s, projectEntry, projectId));
      const p = written.get(projectId);
      if (!p) return void addToReport(sectionReport, { projects_missing: 1 });
      if (p.role_line) blocks.push(addAiBlock(p.role_line, "role_line", projectId, sectionReport, sectionId));
      p.bullets.slice(0, AI03_MAX_BULLETS_PER_PROJECT).forEach((b) => blocks.push(addAiBlock(b, "bullet", projectId, sectionReport, sectionId)));
      if (p.bullets.length > AI03_MAX_BULLETS_PER_PROJECT) addToReport(sectionReport, { bullets_truncated: p.bullets.length - AI03_MAX_BULLETS_PER_PROJECT });
    });
    addToReport(report, sectionReport);
    payloadSections.push({ section_id: sectionId, blocks, validation_report: { ...sectionReport } });
    sections.push({ section_id: sectionId, sort_order: s.sort_order, section_kind: s.section_kind, experience_id: s.experience_id, education_id: s.education_id, heading: s.heading, blocks });
  });

  const omitted: CompleteCareerDescriptionPayload["omitted"] = [];
  for (const o of output.omitted) {
    const id = aliases.resolveId(o.ref.trim(), "project");
    if (id && !omitted.some((x) => x.project_id === id)) omitted.push({ project_id: id, reason: o.reason });
  }
  for (const id of plan.truncatedProjectIds) if (!omitted.some((x) => x.project_id === id)) omitted.push({ project_id: id, reason: "user_excluded" });
  const notes = output.notes_for_user.map((n) => clipText(cleanProse(n, env, report), 300)).filter((n): n is string => !!n);
  if (plan.truncatedProjectIds.length) {
    notes.push(TRUNCATED_PROJECTS_NOTE);
    addToReport(report, { projects_truncated: plan.truncatedProjectIds.length });
  }

  const evidence = evidenceItems.flatMap((item) =>
    toPayloadEvidence([{ itemKey: item.itemKey, evidence: item.evidence }], aliases, input.now).map((row) => ({ ...row, section_id: item.sectionId })),
  );
  const inputHash = computeCareerDescriptionInputHash({
    provider: input.llm.provider,
    model: input.meta.model,
    careerSnapshotHash: context.careerSnapshotHash,
    requirementsHash: context.requirementsHash,
    options: plan.options,
  });
  const payload: CompleteCareerDescriptionPayload = {
    sections: payloadSections,
    hashes: { input_hash: inputHash, career_snapshot_hash: context.careerSnapshotHash },
    meta: {
      schema_version: AI03_OUTPUT_SCHEMA_VERSION,
      prompt_version: AI03_PROMPT_VERSION,
      provider: input.llm.provider,
      model: input.meta.model,
      model_tier: AI03_TIER,
      connection_tier: input.llm.connectionTier,
      validation_report: { ...report },
      usage: input.meta.usage,
    },
    evidence,
    omitted,
    notes_for_user: notes,
  };
  const chips = evidenceItems.flatMap((item) =>
    toEvidenceChips(item.evidence, aliases).map((chip) => ({ ...chip, item_key: item.itemKey, section_id: item.sectionId })),
  );
  return {
    payload,
    view: { kind: "career_description", sections, omitted, notes_for_user: notes, evidence: chips },
    report,
    inputHash,
  };
}

function findEntry(aliases: AliasMap, type: EvidenceSourceType, id: string): AliasEntry | null {
  const alias = aliases.aliasOf(type, id);
  return alias ? (aliases.get(alias) ?? null) : null;
}

/** Server-filled header (card: 머리글은 서버가 채운다) from the rows as the pack saw them. */
function headerBlock(blockId: string, section: SectionPlan, entry: AliasEntry | null, projectId: string | null): DraftBlock {
  let header: Record<string, string | null>;
  if (projectId) {
    header = { kind: "project", name: entry?.fields.name ?? entry?.label ?? null, period: entry?.fields.period ?? null };
  } else if (section.section_kind === "experience") {
    header = {
      kind: "experience",
      company_name: entry?.label ?? null,
      period: entry?.fields.period ?? null,
      job_rank: entry?.fields.job_rank ?? null,
      job_position: entry?.fields.job_position ?? null,
    };
  } else if (section.section_kind === "education") {
    const status = entry?.fields.enrollment_status ?? null;
    header = {
      kind: "education",
      institution_name: entry?.label ?? null,
      program_name: entry?.fields.program_name ?? null,
      period: entry?.fields.period ?? null,
      enrollment_status: status,
      enrollment_status_label: status ? (ENROLLMENT_LABEL[status] ?? status) : null,
    };
  } else {
    header = { kind: "standalone_projects", title: STANDALONE_HEADING };
  }
  return {
    block_id: blockId,
    block_kind: "header",
    project_id: projectId,
    text: headerText(header),
    requirement_ids: [],
    placeholders: [],
    flags: [],
    generated_by: "server",
    user_modified: false,
    header,
  };
}

function headerText(h: Record<string, string | null>): string {
  const join = (...parts: Array<string | null | undefined>) => parts.filter((p): p is string => !!p && p.trim() !== "").join(" | ");
  switch (h.kind) {
    case "experience":
      return join(h.company_name, h.period, [h.job_rank, h.job_position].filter(Boolean).join(" / ") || null);
    case "education":
      return join([h.institution_name, h.program_name].filter(Boolean).join(" ") || null, h.period, h.enrollment_status_label);
    case "project":
      return join(h.name, h.period);
    default:
      return h.title ?? "";
  }
}

function dedupe<T>(list: readonly T[]): T[] {
  return [...new Set(list)];
}
