import { hashCanonical } from "../hash";
import { AliasMap, type AliasEntry } from "./aliases";
import type {
  AchievementRow,
  CareerRows,
  EducationRow,
  ExperienceRow,
  ProjectDetailRow,
  ProjectRow,
  SkillRow,
} from "./career-rows";
import { currentMonthInSeoul, formatDuration, formatMonth, mergedMonths, monthsInclusive, parseMonth, type YearMonth } from "./months";

/**
 * Career Context Pack (AI spec C-1). Pure and deterministic: the same rows
 * (in any order) and the same `asOf` month give the same bytes.
 *
 * Inclusion: `complete` rows only; a non-complete parent (experience,
 * education, project, detail) excludes its children even when they are
 * complete. Children whose parent row is missing (not loaded) are dropped
 * the same way. `display_name` and contact info never enter (C-7).
 *
 * Text format: one `<career_data>` block, nested tags per row with a `ref`
 * alias, `field: value` lines using the C-3 field names so the model can cite
 * `{ref, field, quote}` directly. `learnings` sits inside `<reflection>` (C-9).
 * `<`/`>` in user text are replaced with full-width forms so data can't close
 * a tag (C-4 지시와 데이터 분리); V-3 normalization folds them back.
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
   * V-5 inputs: factual text the model saw (everything except `learnings`)
   * and server-computed numbers (durations, years) that may appear in output.
   */
  numberSources: { factualTexts: string[]; computedNumbers: number[] };
  counts: { experiences: number; educations: number; projects: number; details: number; achievements: number; skills: number };
};

export type BuildCareerPackOptions = {
  /** Month used for ongoing durations. Defaults to the current month in Asia/Seoul. */
  asOf?: YearMonth;
};

const ONGOING = "현재";

export function buildCareerPack(rows: CareerRows, options: BuildCareerPackOptions = {}): CareerPack {
  const asOf = options.asOf ?? currentMonthInSeoul();
  const complete = <T extends { status: string }>(list: T[]) => list.filter((r) => r.status === "complete");

  const experiences = complete(rows.experiences).sort(byPeriodDesc);
  const educations = complete(rows.educations).sort(byPeriodDesc);
  const expIds = new Set(experiences.map((e) => e.id));
  const eduIds = new Set(educations.map((e) => e.id));

  // A project belongs to at most one parent (DB CHECK num_nonnulls <= 1). A
  // project whose parent is not included is excluded, not promoted to "other".
  const projects = complete(rows.projects).filter((p) =>
    p.experience_id ? expIds.has(p.experience_id) : p.education_id ? eduIds.has(p.education_id) : true,
  );
  const projectIds = new Set(projects.map((p) => p.id));
  const details = complete(rows.projectDetails).filter((d) => projectIds.has(d.project_id));
  const detailIds = new Set(details.map((d) => d.id));
  const achievements = complete(rows.achievements).filter((a) =>
    a.project_detail_id ? detailIds.has(a.project_detail_id) : a.experience_id ? expIds.has(a.experience_id) : false,
  );

  const skillById = new Map(rows.skills.map((s) => [s.id, s]));
  const skillIdsByProject = new Map<string, SkillRow[]>();
  for (const link of rows.projectSkills) {
    const skill = skillById.get(link.skill_id);
    if (!skill || !projectIds.has(link.project_id)) continue;
    const list = skillIdsByProject.get(link.project_id) ?? [];
    if (!list.some((s) => s.id === skill.id)) list.push(skill);
    skillIdsByProject.set(link.project_id, list);
  }
  for (const list of skillIdsByProject.values()) list.sort(bySkillName);

  const projectsOf = (key: "experience_id" | "education_id", id: string) => projects.filter((p) => p[key] === id).sort(byPeriodDesc);
  const otherProjects = projects.filter((p) => !p.experience_id && !p.education_id).sort(byPeriodDesc);
  const detailsOf = (projectId: string) => details.filter((d) => d.project_id === projectId).sort(byDetailOrder);
  const achievementsOf = (key: "project_detail_id" | "experience_id", id: string) =>
    achievements.filter((a) => a[key] === id).sort(byCreated);

  const aliases = new AliasMap();
  const counters = { EXP: 0, EDU: 0, PRJ: 0, DET: 0, ACH: 0, SKL: 0 };
  const skillAlias = new Map<string, string>();
  const factualTexts: string[] = [];
  const computedNumbers = new Set<number>();
  const out: string[] = ["<career_data>"];

  const field = (name: string, value: string | number | null | undefined, sink = factualTexts) => {
    if (value === null || value === undefined || value === "") return;
    const text = String(value);
    sink.push(text);
    out.push(`${name}: ${escapeData(text).replace(/\n/g, "\n  ")}`);
  };

  const periodOf = (start: string | null, end: string | null, ongoing: boolean) => {
    const s = parseMonth(start);
    const e = parseMonth(end);
    if (!s) return { text: null as string | null, months: null as number | null, interval: null as { start: YearMonth; end: YearMonth } | null };
    const endYm = e ?? (ongoing ? asOf : null);
    const text = `${formatMonth(s)} ~ ${e ? formatMonth(e) : ongoing ? ONGOING : ""}`.trim();
    const months = endYm ? monthsInclusive(s, endYm) : null;
    if (months !== null) addDurationNumbers(computedNumbers, months);
    return { text, months, interval: endYm && months !== null ? { start: s, end: endYm } : null };
  };

  // --- profile ---
  if (rows.profile) {
    const p = rows.profile;
    const industries = p.interested_industries.filter((s) => s.trim() !== "").join(", ");
    const expIntervals = experiences
      .map((e) => periodOf(e.start_month, e.end_month, e.is_current).interval)
      .filter((i): i is { start: YearMonth; end: YearMonth } => i !== null);
    const totalMonths = expIntervals.length ? mergedMonths(expIntervals) : null;
    if (totalMonths !== null) addDurationNumbers(computedNumbers, totalMonths);
    aliases.add(
      entry("PROFILE", "profile", p.id, {
        desired_job_title: p.desired_job_title,
        total_years_of_experience: p.total_years_of_experience === null ? null : String(p.total_years_of_experience),
        interested_industries: industries || null,
      }, p.updated_at, "프로필"),
    );
    out.push(`<profile ref="PROFILE">`);
    field("desired_job_title", p.desired_job_title);
    field("total_years_of_experience", p.total_years_of_experience);
    field("interested_industries", industries);
    if (totalMonths !== null) field("computed_total_experience", `${formatDuration(totalMonths)} (${totalMonths}개월, ${formatMonth(asOf)} 기준)`);
    out.push("</profile>");
  }

  const renderSkills = (projectId: string, projectAlias: string) => {
    const list = skillIdsByProject.get(projectId) ?? [];
    if (!list.length) return;
    const refs = list.map((s) => `${skillAliasFor(s, projectAlias)} ${s.name}`);
    out.push(`skills: ${escapeData(refs.join(", "))}`);
    for (const s of list) factualTexts.push(s.name);
  };

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

  const renderAchievement = (a: AchievementRow, parent: string) => {
    const alias = `ACH-${++counters.ACH}`;
    const metric = metricText(a);
    aliases.add(entry(alias, "achievement", a.id, { metric, description: a.description }, a.updated_at, a.metric_name ?? clip(a.description), [parent]));
    out.push(`<achievement ref="${alias}">`);
    field("metric", metric);
    field("description", a.description);
    out.push("</achievement>");
  };

  const renderProject = (p: ProjectRow, parent: string | null) => {
    const alias = `PRJ-${++counters.PRJ}`;
    const period = periodOf(p.start_month, p.end_month, false);
    aliases.add(
      entry(alias, "project", p.id, {
        name: p.name,
        role: p.role,
        team_size: p.team_size === null ? null : String(p.team_size),
        summary: p.summary,
        period: period.text,
      }, p.updated_at, p.name, parent ? [parent] : []),
    );
    out.push(`<project ref="${alias}">`);
    field("name", p.name);
    field("period", period.text);
    if (period.months !== null) field("computed_duration", durationText(period.months));
    field("role", p.role);
    field("team_size", p.team_size);
    field("summary", p.summary);
    renderSkills(p.id, alias);
    for (const d of detailsOf(p.id)) renderDetail(d, alias, p.name);
    out.push("</project>");
  };

  const renderDetail = (d: ProjectDetailRow, parent: string, projectName: string | null) => {
    const alias = `DET-${++counters.DET}`;
    aliases.add(
      entry(alias, "project_detail", d.id, {
        title: d.title,
        situation: d.situation,
        task: d.task,
        action: d.action,
        result: d.result,
        learnings: d.learnings,
      }, d.updated_at, [projectName, d.title].filter(Boolean).join(" › ") || null, [parent]),
    );
    out.push(`<detail ref="${alias}">`);
    field("title", d.title);
    field("situation", d.situation);
    field("task", d.task);
    field("action", d.action);
    field("result", d.result);
    for (const a of achievementsOf("project_detail_id", d.id)) renderAchievement(a, alias);
    if (d.learnings && d.learnings.trim() !== "") {
      // C-9: reflection is not a fact; its text is excluded from V-5 sources.
      out.push("<reflection>");
      field("learnings", d.learnings, []);
      out.push("</reflection>");
    }
    out.push("</detail>");
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
    for (const a of achievementsOf("experience_id", e.id)) renderAchievement(a, alias);
    for (const p of projectsOf("experience_id", e.id)) renderProject(p, alias);
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
      }, e.updated_at, e.institution_name),
    );
    out.push(`<education ref="${alias}">`);
    field("institution_name", e.institution_name);
    field("education_type", e.education_type);
    field("program_name", e.program_name);
    field("period", period.text);
    field("enrollment_status", e.enrollment_status);
    field("description", e.description);
    for (const p of projectsOf("education_id", e.id)) renderProject(p, alias);
    out.push("</education>");
  }

  if (otherProjects.length) {
    out.push("<other_projects>");
    for (const p of otherProjects) renderProject(p, null);
    out.push("</other_projects>");
  }

  // Manual skills not already listed under a project (C-1 "직접 추가 스킬은 별도 목록").
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

  const snapshot = {
    profile: rows.profile
      ? {
          desired_job_title: rows.profile.desired_job_title,
          total_years_of_experience: rows.profile.total_years_of_experience,
          interested_industries: rows.profile.interested_industries,
        }
      : null,
    experiences: experiences.map(({ id, company_name, start_month, end_month, is_current, job_rank, job_position, department, employment_type, summary }) => ({
      id, company_name, start_month, end_month, is_current, job_rank, job_position, department, employment_type, summary,
    })),
    educations: educations.map(({ id, institution_name, education_type, program_name, start_month, end_month, enrollment_status, description }) => ({
      id, institution_name, education_type, program_name, start_month, end_month, enrollment_status, description,
    })),
    projects: [...projects].sort(byId).map(({ id, experience_id, education_id, name, start_month, end_month, role, team_size, summary }) => ({
      id, experience_id, education_id, name, start_month, end_month, role, team_size, summary,
      skills: (skillIdsByProject.get(id) ?? []).map((s) => s.name),
    })),
    details: [...details].sort(byId).map(({ id, project_id, title, situation, task, action, result, learnings, sort_order }) => ({
      id, project_id, title, situation, task, action, result, learnings, sort_order,
    })),
    achievements: [...achievements].sort(byId).map(({ id, project_detail_id, experience_id, metric_name, value_before, value_after, unit, description }) => ({
      id, project_detail_id, experience_id, metric_name, value_before, value_after, unit, description,
    })),
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
      details: details.length,
      achievements: achievements.length,
      skills: skillAlias.size,
    },
  };
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

/** "응답 시간: 1.2 → 0.7 초" — the `metric` field text (C-3 achievement.metric). */
export function metricText(a: Pick<AchievementRow, "metric_name" | "value_before" | "value_after" | "unit">): string | null {
  const values =
    a.value_before !== null && a.value_after !== null
      ? `${a.value_before} → ${a.value_after}`
      : a.value_after !== null
        ? String(a.value_after)
        : a.value_before !== null
          ? String(a.value_before)
          : "";
  const body = [values, a.unit ?? ""].filter((s) => s !== "").join(" ");
  if (!a.metric_name && !body) return null;
  return a.metric_name ? (body ? `${a.metric_name}: ${body}` : a.metric_name) : body;
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

function clip(text: string | null, max = 40): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
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

function byDetailOrder(a: ProjectDetailRow, b: ProjectDetailRow): number {
  return a.sort_order - b.sort_order || cmp(a.id, b.id);
}

function byCreated(a: { created_at: string; id: string }, b: { created_at: string; id: string }): number {
  return cmp(a.created_at, b.created_at) || cmp(a.id, b.id);
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
