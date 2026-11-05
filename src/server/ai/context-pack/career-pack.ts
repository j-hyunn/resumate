import { educationDisplayName } from "@/server/services/career/education-name";
import { classificationLine } from "../classification";
import { hashCanonical } from "../hash";
import { STAR_FIELDS } from "../schemas/structured-draft";
import { AliasMap, type AliasEntry } from "./aliases";
import type { CareerRows, DeliverableRow, EducationRow, ExperienceRow, ProjectRow, SkillRow } from "./career-rows";
import {
  DELIVERABLE_PACK_MAX_CHARS,
  DELIVERABLE_PACK_TOTAL_CHARS,
  normalizeDeliverableMarkdown,
  plainForValidation,
  rawSpan,
  truncateNormalized,
} from "./deliverable-text";
import { currentMonthInSeoul, formatDuration, formatMonth, monthsInclusive, parseMonth, type YearMonth } from "./months";

/**
 * Career Context Pack (AI spec C-1, v4.5). Pure and deterministic: the same
 * rows (in any order) and the same `asOf` month give the same bytes.
 *
 * Structure (CR-2·CR-7·CR-8·CR-10): experience / education → affiliated
 * projects (STAR on `PRJ-n`, classification as reference); then standalone
 * projects (role, skills, description) → deliverables (`DLV-n`, normalized
 * markdown within the C-1.1 budget). No `DET-n` / `ACH-n` any more.
 *
 * Inclusion: `complete` rows only; a non-complete parent (experience,
 * education, project) excludes its children even when they are complete.
 * Deliverables have no status and enter with a complete standalone parent
 * [가정]. Contact info and `link_url` never enter (C-1, C-7).
 *
 * (v4.12, SD-6) **No profile block.** No `profiles` value reaches any prompt,
 * and the spec forbids leaving an empty block behind (0.v412). The only
 * profile-shaped number left is the server-computed total experience
 * (`computed_total_months`, SD-2), which comes from the DB function via
 * `rows.totalExperience` (DM 6.2) and is the single number 연차 요건 판정 uses.
 *
 * Text format: one `<career_data>` block, nested tags per row with a `ref`
 * alias, `field: value` lines using the C-3 field names so the model can cite
 * `{ref, field, quote}` directly. `learnings` sits inside `<reflection>` (C-9),
 * classification inside `<classification>` (C-1.2, not citable), deliverable
 * bodies inside `<deliverable>` (C-4 data). `<`/`>` in user text are replaced
 * with full-width forms so data can't close a tag; V-3 normalization folds
 * them back.
 */

export type CareerPack = {
  /** `<career_data>…</career_data>` user block. Never log it. */
  text: string;
  aliases: AliasMap;
  /**
   * Hash of the included content (not of `text`): durations of ongoing roles
   * change monthly and must not mark results "데이터 변경됨" (F-P2-07).
   */
  careerSnapshotHash: string;
  /**
   * V-5 inputs (v4.5): the user's narrative text the model saw (STAR except
   * `learnings`, summaries, role/description, deliverable text in the pack)
   * and server-computed numbers (durations, years) that may appear in output.
   */
  numberSources: { factualTexts: string[]; computedNumbers: number[] };
  counts: { experiences: number; educations: number; projects: number; deliverables: number; skills: number };
  /**
   * AI-02 `data_sufficiency` (C-14 v4.5): whether any number appears in an
   * affiliated project's result, a standalone description, or deliverable
   * text that entered the pack.
   */
  hasResultNumbers: boolean;
};

export type BuildCareerPackOptions = {
  /** Month used for ongoing durations. Defaults to the current month in Asia/Seoul. */
  asOf?: YearMonth;
  /**
   * Standalone projects whose deliverables enter the pack (C-1.1 기능별 포함
   * 범위, e.g. AI-06 = projects the session's questions cite). Undefined = all.
   * Projects outside the set still render their own fields.
   */
  deliverableProjectIds?: ReadonlySet<string>;
};

const ONGOING = "현재";
const NO_END = "(종료 미입력)";
const NUMBER = /\d/;

export function buildCareerPack(rows: CareerRows, options: BuildCareerPackOptions = {}): CareerPack {
  const asOf = options.asOf ?? currentMonthInSeoul();
  const complete = <T extends { status: string }>(list: T[]) => list.filter((r) => r.status === "complete");

  const experiences = complete(rows.experiences).sort(byPeriodDesc);
  const educations = complete(rows.educations).sort(byPeriodDesc);
  const expIds = new Set(experiences.map((e) => e.id));
  const eduIds = new Set(educations.map((e) => e.id));

  // A project belongs to at most one parent (DB CHECK num_nonnulls <= 1). A
  // project whose parent is not included is excluded, not promoted to standalone.
  const projects = complete(rows.projects).filter((p) =>
    p.experience_id ? expIds.has(p.experience_id) : p.education_id ? eduIds.has(p.education_id) : true,
  );
  const standaloneIds = new Set(projects.filter(isStandalone).map((p) => p.id));
  const deliverables = rows.deliverables.filter((d) => standaloneIds.has(d.project_id));

  // CR-10: skills hang off standalone projects only (DB trigger enforces it too).
  const skillById = new Map(rows.skills.map((s) => [s.id, s]));
  const skillsByProject = new Map<string, SkillRow[]>();
  for (const link of rows.projectSkills) {
    const skill = skillById.get(link.skill_id);
    if (!skill || !standaloneIds.has(link.project_id)) continue;
    const list = skillsByProject.get(link.project_id) ?? [];
    if (!list.some((s) => s.id === skill.id)) list.push(skill);
    skillsByProject.set(link.project_id, list);
  }
  for (const list of skillsByProject.values()) list.sort(bySkillName);

  const projectsOf = (key: "experience_id" | "education_id", id: string) => projects.filter((p) => p[key] === id).sort(byPeriodDesc);
  const standalone = projects.filter(isStandalone).sort(byPeriodDesc);
  const deliverablesOf = (projectId: string) => deliverables.filter((d) => d.project_id === projectId).sort(byDeliverableOrder);

  const aliases = new AliasMap();
  const counters = { EXP: 0, EDU: 0, PRJ: 0, DLV: 0, SKL: 0 };
  const skillAlias = new Map<string, string>();
  const factualTexts: string[] = [];
  const resultTexts: string[] = [];
  const computedNumbers = new Set<number>();
  const out: string[] = ["<career_data>"];
  let deliverableBudget = DELIVERABLE_PACK_TOTAL_CHARS;
  let deliverablesIncluded = 0;

  const field = (name: string, value: string | number | null | undefined, sink: string[] | null = factualTexts) => {
    if (value === null || value === undefined || value === "") return;
    const text = String(value);
    sink?.push(text);
    out.push(`${name}: ${escapeData(text).replace(/\n/g, "\n  ")}`);
  };

  /**
   * CR-22 period text: "YYYY-MM ~ YYYY-MM", ongoing "YYYY-MM ~ 현재" (months
   * through `asOf`), no end and not ongoing "YYYY-MM ~ (종료 미입력)" with no
   * month count (the model must not guess a duration).
   */
  const periodOf = (start: string | null, end: string | null, ongoing: boolean) => {
    const s = parseMonth(start);
    const e = parseMonth(end);
    if (!s) return { text: null as string | null, months: null as number | null };
    const endYm = e ?? (ongoing ? asOf : null);
    const text = `${formatMonth(s)} ~ ${e ? formatMonth(e) : ongoing ? ONGOING : NO_END}`;
    const months = endYm ? monthsInclusive(s, endYm) : null;
    if (months !== null) addDurationNumbers(computedNumbers, months);
    return { text, months };
  };

  // --- 경력 합계 (서버 계산, C-1 / SD-2) ---
  // Not a user statement: the line says 서버 계산 so the model does not quote it
  // as a career claim, and there is no `source_type` it could be cited as (C-3).
  // V-5: the years / remaining months / total months are allowed numbers.
  const total = rows.totalExperience;
  addDurationNumbers(computedNumbers, total.totalMonths);
  out.push(
    `computed_total_months: 등록된 경력 기간 합계 ${formatDuration(total.totalMonths)} (총 ${total.totalMonths}개월, 기준 ${formatMonth(total.asOfMonth)}, 서버 계산)`,
  );
  if (total.openEndedExperienceCount > 0) {
    out.push(`computed_open_ended_experiences: 기간 미입력 경력 ${total.openEndedExperienceCount}건(합계에 넣지 않음)`);
  }

  // Skill entries are added after rendering so `parents` lists every project that tags the skill (V-7 scope).
  const skillParents = new Map<string, { row: SkillRow; alias: string; parents: string[] }>();
  const skillAliasFor = (s: SkillRow, projectAlias: string | null) => {
    let alias = skillAlias.get(s.id);
    if (!alias) {
      alias = `SKL-${++counters.SKL}`;
      skillAlias.set(s.id, alias);
      skillParents.set(s.id, { row: s, alias, parents: [] });
    }
    if (projectAlias) skillParents.get(s.id)?.parents.push(projectAlias);
    return alias;
  };

  const renderAffiliatedProject = (p: ProjectRow, parent: string) => {
    const alias = `PRJ-${++counters.PRJ}`;
    const period = periodOf(p.start_month, p.end_month, p.is_current);
    aliases.add({
      ...entry(alias, "project", p.id, {
        name: p.name,
        period: period.text,
        situation: p.situation,
        task: p.task,
        action: p.action,
        result: p.result,
        learnings: p.learnings,
      }, p.content_updated_at, p.name, [parent]),
      // v4.10 (UP-14): the pack shows STAR as stored (markdown); V-3 matches its plain text.
      matchFields: Object.fromEntries(
        STAR_FIELDS.map((f) => [f, p[f] === null || p[f] === undefined ? null : plainForValidation(p[f]!)]),
      ),
      scope: "affiliated",
    });
    out.push(`<project ref="${alias}">`);
    field("name", p.name);
    field("period", period.text);
    if (period.months !== null) field("computed_duration", durationText(period.months));
    // C-1.2: the user's own label — reference only (not citable, not a V-5 source).
    const classification = classificationLine(p);
    if (classification) out.push(`<classification>${escapeData(classification)}</classification>`);
    field("situation", p.situation);
    field("task", p.task);
    field("action", p.action);
    field("result", p.result);
    if (p.result) resultTexts.push(p.result);
    if (p.learnings && p.learnings.trim() !== "") {
      // C-9: reflection is not a fact; its text is excluded from V-5 sources.
      out.push("<reflection>");
      field("learnings", p.learnings, null);
      out.push("</reflection>");
    }
    out.push("</project>");
  };

  const renderDeliverable = (d: DeliverableRow, projectAlias: string, includeBody: boolean) => {
    const alias = `DLV-${++counters.DLV}`;
    const normalized = normalizeDeliverableMarkdown(d.body);
    const room = includeBody ? Math.min(DELIVERABLE_PACK_MAX_CHARS, deliverableBudget) : 0;
    const cut = truncateNormalized(normalized, room);
    deliverableBudget -= cut.text.length;
    deliverablesIncluded++;
    const body = cut.text.trim() === "" ? null : cut.text;
    aliases.add({
      ...entry(alias, "project_deliverable", d.id, { title: d.title, body }, d.updated_at, d.title, [projectAlias]),
      // C-1.1: quotes are validated on the normalized text; storage keeps the raw markdown span.
      locate: (f, quote) => {
        if (f !== "body" || !body) return null;
        const at = body.indexOf(quote);
        return at < 0 ? null : rawSpan(cut, at, at + quote.length);
      },
    });
    out.push(`<deliverable ref="${alias}"${cut.truncated ? ' truncated="true"' : ""}>`);
    field("title", d.title);
    field("body", body);
    if (body) resultTexts.push(body);
    out.push("</deliverable>");
  };

  const renderStandaloneProject = (p: ProjectRow) => {
    const alias = `PRJ-${++counters.PRJ}`;
    const period = periodOf(p.start_month, p.end_month, p.is_current);
    aliases.add({
      ...entry(alias, "project", p.id, { name: p.name, period: period.text, role: p.role, description: p.description }, p.content_updated_at, p.name),
      scope: "standalone",
    });
    out.push(`<project ref="${alias}">`);
    field("name", p.name);
    field("period", period.text);
    if (period.months !== null) field("computed_duration", durationText(period.months));
    field("role", p.role);
    const skills = skillsByProject.get(p.id) ?? [];
    if (skills.length) {
      out.push(`skills: ${escapeData(skills.map((s) => `${skillAliasFor(s, alias)} ${s.name}`).join(", "))}`);
      for (const s of skills) factualTexts.push(s.name);
    }
    field("description", p.description);
    if (p.description) resultTexts.push(p.description);
    const withBodies = !options.deliverableProjectIds || options.deliverableProjectIds.has(p.id);
    if (withBodies) for (const d of deliverablesOf(p.id)) renderDeliverable(d, alias, deliverableBudget > 0);
    out.push("</project>");
  };

  for (const e of experiences) {
    const alias = `EXP-${++counters.EXP}`;
    const period = periodOf(e.start_month, e.end_month, e.is_current);
    aliases.add(
      entry(alias, "experience", e.id, {
        job_rank: e.job_rank,
        job_position: e.job_position,
        department: e.department,
        summary: e.summary,
        period: period.text,
      }, e.updated_at, e.company_name),
    );
    out.push(`<experience ref="${alias}">`);
    field("company_name", e.company_name);
    field("period", period.text);
    if (period.months !== null) field("computed_duration", durationText(period.months));
    const rankLine = [e.job_rank, e.job_position].map((v) => v ?? "-").join(" / ");
    if (e.job_rank || e.job_position) {
      factualTexts.push(rankLine);
      out.push(`job_rank / job_position: ${escapeData(rankLine)}`);
    }
    field("department", e.department);
    field("employment_type", e.employment_type);
    field("summary", e.summary);
    for (const p of projectsOf("experience_id", e.id)) renderAffiliatedProject(p, alias);
    out.push("</experience>");
  }

  for (const e of educations) {
    const alias = `EDU-${++counters.EDU}`;
    const period = periodOf(e.start_month, e.end_month, e.enrollment_status === "enrolled");
    aliases.add(
      entry(alias, "education", e.id, {
        institution_name: e.institution_name,
        program_name: e.program_name,
        education_type: e.education_type,
        enrollment_status: e.enrollment_status,
        period: period.text,
        description: e.description,
        // label = the education's display name (UQ-734 / UI32-2): 교육 명, else 운영 기관, else null.
        // It becomes evidence_links.source_label and the "부모 › 프로젝트" source labels; the model
        // still sees both raw fields below.
      }, e.updated_at, educationDisplayName(e.program_name, e.institution_name)),
    );
    out.push(`<education ref="${alias}">`);
    field("institution_name", e.institution_name);
    field("education_type", e.education_type);
    field("program_name", e.program_name);
    field("period", period.text);
    field("enrollment_status", e.enrollment_status);
    field("description", e.description);
    for (const p of projectsOf("education_id", e.id)) renderAffiliatedProject(p, alias);
    out.push("</education>");
  }

  if (standalone.length) {
    out.push("<standalone_projects>");
    for (const p of standalone) renderStandaloneProject(p);
    out.push("</standalone_projects>");
  }

  // Manual skills not already listed under a project (C-1 "직접 추가 스킬").
  const manual = rows.skills.filter((s) => s.is_manual && !skillAlias.has(s.id)).sort(bySkillName);
  if (manual.length) {
    out.push(`<manual_skills>`);
    for (const s of manual) {
      out.push(`${skillAliasFor(s, null)}: ${escapeData(s.name)}`);
      factualTexts.push(s.name);
    }
    out.push(`</manual_skills>`);
  }

  out.push("</career_data>");
  for (const { row, alias, parents } of [...skillParents.values()].sort((a, b) => skillNumber(a.alias) - skillNumber(b.alias))) {
    aliases.add(entry(alias, "skill", row.id, { name: row.name }, row.updated_at, row.name, parents));
  }
  // Deliverable text in the pack is a V-5 number source (C-3 V-5 v4.5).
  for (const e of aliases.values()) if (e.sourceType === "project_deliverable" && e.fields.body) factualTexts.push(e.fields.body);

  // C-1 hash: content fields of included rows (no link_url, no computed durations;
  // is_current yes; classification yes — it can change results, not evidence).
  // computed_total_months is deliberately absent: it changes with the reference
  // month and would mark untouched data "데이터 변경됨" every month (DM 6.2).
  const snapshot = {
    experiences: experiences.map(({ id, company_name, start_month, end_month, is_current, job_rank, job_position, department, employment_type, summary }) => ({
      id, company_name, start_month, end_month, is_current, job_rank, job_position, department, employment_type, summary,
    })),
    educations: educations.map(({ id, institution_name, education_type, program_name, start_month, end_month, enrollment_status, description }) => ({
      id, institution_name, education_type, program_name, start_month, end_month, enrollment_status, description,
    })),
    projects: [...projects].sort(byId).map((p) => ({
      id: p.id,
      experience_id: p.experience_id,
      education_id: p.education_id,
      name: p.name,
      start_month: p.start_month,
      end_month: p.end_month,
      is_current: p.is_current,
      project_type: p.project_type,
      experience_type: p.experience_type,
      competencies: p.competencies,
      situation: p.situation,
      task: p.task,
      action: p.action,
      result: p.result,
      learnings: p.learnings,
      role: p.role,
      description: p.description,
      skills: (skillsByProject.get(p.id) ?? []).map((s) => s.name),
    })),
    deliverables: [...deliverables].sort(byId).map(({ id, project_id, title, body, sort_order }) => ({ id, project_id, title, body, sort_order })),
    manualSkills: manual.map((s) => s.name),
  };

  return {
    text: out.join("\n"),
    aliases,
    careerSnapshotHash: hashCanonical(snapshot),
    numberSources: { factualTexts, computedNumbers: [...computedNumbers].sort((a, b) => a - b) },
    counts: {
      experiences: experiences.length,
      educations: educations.length,
      projects: projects.length,
      deliverables: deliverablesIncluded,
      skills: skillAlias.size,
    },
    hasResultNumbers: resultTexts.some((t) => NUMBER.test(t)),
  };
}

/** DM-20: a project with neither experience nor education is standalone. */
export function isStandalone(p: Pick<ProjectRow, "experience_id" | "education_id">): boolean {
  return !p.experience_id && !p.education_id;
}

function entry(
  alias: string,
  sourceType: AliasEntry["sourceType"],
  id: string,
  fields: Record<string, string | null>,
  snapshotAt: string | null,
  label: string | null,
  parents: string[] = [],
): AliasEntry {
  return { alias, sourceType, id, fields, snapshotAt, label, parents };
}

/** Durations the model may state: months, whole years, remaining months, and "N년차". */
function addDurationNumbers(set: Set<number>, months: number): void {
  const years = Math.floor(months / 12);
  set.add(months);
  set.add(years);
  set.add(months % 12);
  set.add(years + 1);
}

function durationText(months: number): string {
  return months < 12 ? `${months}개월` : `${formatDuration(months)} (${months}개월)`;
}

function skillNumber(alias: string): number {
  return Number(alias.slice(4));
}

function escapeData(text: string): string {
  return text.replace(/</g, "＜").replace(/>/g, "＞");
}

type Periodic = { id: string; start_month: string | null; end_month: string | null; created_at: string };

/** Latest first; ongoing (no end) before ended; no start last; ties by created_at then id. */
function byPeriodDesc(a: Periodic, b: Periodic): number {
  return (
    cmpDesc(a.start_month, b.start_month) ||
    cmpDesc(a.end_month ?? "9999-12", b.end_month ?? "9999-12") ||
    cmp(a.created_at, b.created_at) ||
    cmp(a.id, b.id)
  );
}

function byDeliverableOrder(a: DeliverableRow, b: DeliverableRow): number {
  return a.sort_order - b.sort_order || cmp(a.id, b.id);
}

function bySkillName(a: SkillRow, b: SkillRow): number {
  return cmp(a.normalized_name ?? a.name.toLowerCase(), b.normalized_name ?? b.name.toLowerCase()) || cmp(a.id, b.id);
}

function byId(a: { id: string }, b: { id: string }): number {
  return cmp(a.id, b.id);
}

/** Code-point comparison (locale-independent, so the bytes don't depend on the server's ICU). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Descending, nulls last. */
function cmpDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

export type { ExperienceRow, EducationRow };
