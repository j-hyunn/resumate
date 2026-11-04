import { classificationLine } from "../classification";
import { buildCareerPack, type CareerPack } from "./career-pack";
import type { AliasEntry } from "./aliases";
import type { CareerRows } from "./career-rows";
import type { YearMonth } from "./months";

/**
 * Summary Career Context Pack for AI-11 (card 입력 컨텍스트 v4.5: 경력·교육·프로젝트의
 * 이름·기간, 소속 프로젝트의 분류 3종(참고)·역할(task) 앞 100자·행동 앞 200자·
 * 결과/성과 앞 150자, 독립 프로젝트의 담당 업무·내용 앞 200자·사용 기술, 산출물
 * 제목 + 앞 200자; 배운 점 제외).
 *
 * It is rendered from the full pack's alias map (same inclusion rules, same
 * aliases, same order), so `careerSnapshotHash` is the one C-1 hash and the
 * PRJ-n numbers match what other features see for the same rows.
 */

export const SUMMARY_TASK_MAX = 100;
export const SUMMARY_ACTION_MAX = 200;
export const SUMMARY_RESULT_MAX = 150;
export const SUMMARY_TEXT_MAX = 200;

export type SummaryCareerPack = {
  /** `<career_data format="summary">…</career_data>`. Never log it. */
  text: string;
  full: CareerPack;
};

export function buildSummaryCareerPack(rows: CareerRows, options: { asOf?: YearMonth } = {}): SummaryCareerPack {
  const full = buildCareerPack(rows, options);
  const projectRows = new Map(rows.projects.map((p) => [p.id, p]));
  const entries = [...full.aliases.values()];
  const byAlias = new Map(entries.map((e) => [e.alias, e]));
  const skillsByProject = new Map<string, string[]>();
  for (const e of entries) {
    if (e.sourceType !== "skill") continue;
    for (const p of e.parents) skillsByProject.set(p, [...(skillsByProject.get(p) ?? []), e.fields.name ?? e.label ?? ""]);
  }
  const depthOf = (e: AliasEntry): number => {
    let depth = 0;
    let cur: AliasEntry | undefined = e;
    while (cur && cur.parents.length) {
      depth++;
      cur = byAlias.get(cur.parents[0]);
    }
    // Standalone projects sit under the "독립 프로젝트" group line.
    return cur?.sourceType === "project" ? depth + 1 : depth;
  };

  const out: string[] = [`<career_data format="summary">`];
  let otherGroupOpen = false;
  for (const e of entries) {
    const f = e.fields;
    const pad = "  ".repeat(depthOf(e));
    switch (e.sourceType) {
      case "profile":
        out.push(line("PROFILE", [`희망 직무: ${f.desired_job_title ?? "-"}`, f.total_years_of_experience ? `총 경력(연): ${f.total_years_of_experience}` : null]));
        break;
      case "experience":
        out.push(
          line(e.alias, [
            e.label,
            f.period,
            [f.job_rank, f.job_position].filter(Boolean).join(" / ") || null,
            f.summary ? `요약: ${clip(f.summary, SUMMARY_TEXT_MAX)}` : null,
          ]),
        );
        break;
      case "education":
        out.push(
          line(e.alias, [f.institution_name, f.program_name, f.period, f.description ? `요약: ${clip(f.description, SUMMARY_TEXT_MAX)}` : null]),
        );
        break;
      case "project": {
        if (e.scope === "standalone") {
          if (!otherGroupOpen) {
            out.push("독립 프로젝트");
            otherGroupOpen = true;
          }
          const skills = skillsByProject.get(e.alias) ?? [];
          out.push(
            pad +
              line(e.alias, [
                f.name,
                f.period,
                f.role ? `담당 업무: ${clip(f.role, SUMMARY_TEXT_MAX)}` : null,
                f.description ? `내용: ${clip(f.description, SUMMARY_TEXT_MAX)}` : null,
                skills.length ? `사용 기술: ${skills.join(", ")}` : null,
              ]),
          );
        } else {
          // C-1.2: classification is reference only; C-9: learnings are left out.
          const row = projectRows.get(e.id);
          const classification = row ? classificationLine(row) : null;
          out.push(
            pad +
              line(e.alias, [
                f.name,
                f.period,
                classification ? `분류(참고): ${classification}` : null,
                f.task ? `역할: ${clip(f.task, SUMMARY_TASK_MAX)}` : null,
                f.action ? `행동: ${clip(f.action, SUMMARY_ACTION_MAX)}` : null,
                f.result ? `결과/성과: ${clip(f.result, SUMMARY_RESULT_MAX)}` : null,
              ]),
          );
        }
        break;
      }
      case "project_deliverable":
        out.push(pad + line(e.alias, [`산출물: ${e.fields.title ?? "-"}`, f.body ? clip(f.body, SUMMARY_TEXT_MAX) : null]));
        break;
      default:
        break;
    }
  }
  out.push("</career_data>");
  return { text: out.join("\n"), full };
}

function line(alias: string, parts: ReadonlyArray<string | null | undefined>): string {
  return `${alias} ${parts.filter((p): p is string => !!p && p.trim() !== "").map(escapeData).join(" | ")}`.trimEnd();
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function escapeData(text: string): string {
  return text.replace(/</g, "＜").replace(/>/g, "＞").replace(/\n/g, " ");
}
