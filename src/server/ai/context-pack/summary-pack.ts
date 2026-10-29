import { buildCareerPack, type CareerPack } from "./career-pack";
import type { AliasEntry } from "./aliases";
import type { CareerRows } from "./career-rows";
import type { YearMonth } from "./months";

/**
 * Summary Career Context Pack for AI-11 (card 입력 컨텍스트: 경력·교육·프로젝트의
 * 이름·기간·역할·한 줄 요약, 상세 내용의 제목·행동 앞 200자, 스킬 태그, 연결 성과
 * 지표명; 회고 및 배운 점 제외).
 *
 * It is rendered from the full pack's alias map (same inclusion rules, same
 * aliases, same order), so `careerSnapshotHash` is the one C-1 hash and the
 * PRJ-n numbers match what other features see for the same rows.
 */

export const SUMMARY_ACTION_MAX = 200;
export const SUMMARY_TEXT_MAX = 200;

export type SummaryCareerPack = {
  /** `<career_data format="summary">…</career_data>`. Never log it. */
  text: string;
  full: CareerPack;
};

export function buildSummaryCareerPack(rows: CareerRows, options: { asOf?: YearMonth } = {}): SummaryCareerPack {
  const full = buildCareerPack(rows, options);
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
    // Parentless projects sit under the "기타 프로젝트" group line.
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
          line(e.alias, [e.label, f.program_name, f.period, f.description ? `요약: ${clip(f.description, SUMMARY_TEXT_MAX)}` : null]),
        );
        break;
      case "project": {
        if (!e.parents.length && !otherGroupOpen) {
          out.push("기타 프로젝트");
          otherGroupOpen = true;
        }
        const skills = skillsByProject.get(e.alias) ?? [];
        out.push(
          pad +
            line(e.alias, [
              f.name,
              f.period,
              f.role ? `역할: ${f.role}` : null,
              f.summary ? `요약: ${clip(f.summary, SUMMARY_TEXT_MAX)}` : null,
              skills.length ? `스킬: ${skills.join(", ")}` : null,
            ]),
        );
        break;
      }
      case "project_detail":
        // C-9: learnings are left out of the summary pack.
        out.push(pad + line(e.alias, [f.title, f.action ? `행동: ${clip(f.action, SUMMARY_ACTION_MAX)}` : null]));
        break;
      case "achievement":
        out.push(pad + line(e.alias, [`성과 지표: ${e.label ?? "-"}`]));
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
