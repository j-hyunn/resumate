import type { CareerRows } from "../../context-pack/career-rows";
import { splitJdSentences, type JdRequirementInput } from "../../context-pack/jd";
import type { EvidenceSourceType } from "../../evidence-rules";
import type { InsightContext, InsightContextInput } from "../../pipelines/AI-02";
import type { Ai02Match, Ai02MatchOutput, Ai02SynthesisOutput } from "../../schemas/AI-02";
import { careerRowsFixture, IDS } from "../career-rows";

/**
 * Synthetic AI-02 fixtures (fictional company and person; no real postings or
 * résumés). Model outputs are built from the context so aliases (DET-n, PRJ-n …)
 * always match the pack the pipeline builds.
 */

export const JD_ID = "70000000-0000-4000-8000-000000000001";
export const JD_EN_ID = "70000000-0000-4000-8000-000000000002";
export const JD_UPDATED_AT = "2026-10-01T00:00:00.000Z";

/** 10 requirements → batches of 8 + 2. */
export const KO_JD_RAW = [
  "가상페이 결제 백엔드 엔지니어",
  "[주요 업무]",
  "- 결제 승인 API 설계 및 운영",
  "- 정산 배치 시스템 개선",
  "- 장애 대응 체계 운영",
  "[자격 요건]",
  "- Spring Boot 기반 서버 개발 경험",
  "- Kotlin 사용 경험",
  "- 대용량 트래픽 서비스 성능 개선 경험",
  "- RDBMS 인덱스 설계 경험",
  "- 백엔드 개발 경력 5년 이상",
  "[우대 사항]",
  "- Kafka 등 메시지 큐 운영 경험",
  "- 팀 리딩 경험",
  "- 쿠버네티스 운영 경험",
].join("\n");

const KO_REQS: Array<[JdRequirementInput["category"], string, string]> = [
  ["responsibility", "결제 승인 API 설계 및 운영", "결제 승인 API"],
  ["responsibility", "정산 배치 시스템 개선", "정산 배치"],
  ["responsibility", "장애 대응 체계 운영", "장애 대응"],
  ["required", "Spring Boot 기반 서버 개발 경험", "Spring Boot"],
  ["required", "Kotlin 사용 경험", "Kotlin"],
  ["required", "대용량 트래픽 서비스 성능 개선 경험", "대용량 트래픽"],
  ["required", "RDBMS 인덱스 설계 경험", "RDBMS"],
  ["preferred", "Kafka 등 메시지 큐 운영 경험", "Kafka"],
  ["preferred", "팀 리딩 경험", "팀 리딩"],
  ["preferred", "쿠버네티스 운영 경험", "쿠버네티스"],
];

export function reqId(n: number): string {
  return `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function requirementsFor(raw: string, defs: ReadonlyArray<[JdRequirementInput["category"], string, string]>, idOf: (n: number) => string): JdRequirementInput[] {
  const sentences = splitJdSentences(raw);
  return defs.map(([category, content, needle], i) => {
    const sentence = sentences.find((s) => s.text.includes(needle));
    if (!sentence) throw new Error(`fixture: no sentence for ${needle}`);
    return { id: idOf(i + 1), category, content, importance: i < 3 ? "high" : "normal", source_sids: [sentence.sid], sort_order: i, updated_at: JD_UPDATED_AT };
  });
}

export function koInput(rows: CareerRows = careerRowsFixture()): InsightContextInput {
  return {
    careerRows: rows,
    asOf: { year: 2026, month: 10 },
    jobDescriptionId: JD_ID,
    jobDescriptionUpdatedAt: JD_UPDATED_AT,
    sentences: splitJdSentences(KO_JD_RAW),
    requirements: requirementsFor(KO_JD_RAW, KO_REQS, reqId),
    positionTitle: "결제 백엔드 엔지니어",
    seniorityLabel: "백엔드 개발 경력 5년 이상",
  };
}

/** English JD with one requirement (content summarized in Korean, C-4). */
export const EN_JD_RAW = ["Backend Engineer (fictional)", "Requirements:", "- Experience tuning PostgreSQL queries in production."].join("\n");

export function enInput(rows: CareerRows = careerRowsFixture()): InsightContextInput {
  return {
    careerRows: rows,
    asOf: { year: 2026, month: 10 },
    jobDescriptionId: JD_EN_ID,
    jobDescriptionUpdatedAt: JD_UPDATED_AT,
    sentences: splitJdSentences(EN_JD_RAW),
    requirements: requirementsFor(EN_JD_RAW, [["required", "운영 환경 PostgreSQL 쿼리 튜닝 경험", "PostgreSQL"]], (n) => `81000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
    positionTitle: "Backend Engineer",
    seniorityLabel: null,
  };
}

/** Thin data: one experience, one project with one detail, no quantitative achievement. */
export function thinRows(): CareerRows {
  const rows = careerRowsFixture();
  const keepProjects = new Set<string>([IDS.prjSettle]);
  return {
    ...rows,
    projects: rows.projects.filter((p) => keepProjects.has(p.id)),
    projectDetails: rows.projectDetails.filter((d) => keepProjects.has(d.project_id)),
    achievements: [],
  };
}

// ---------- alias helpers ----------

export function alias(ctx: InsightContext, type: EvidenceSourceType, id: string): string {
  const a = ctx.aliases.aliasOf(type, id);
  if (!a) throw new Error(`fixture: no alias for ${type} ${id}`);
  return a;
}

export function sidOf(ctx: InsightContext, needle: string): string {
  const entry = [...ctx.aliases.values()].find((e) => e.sourceType === "jd_sentence" && (e.fields[""] ?? "").includes(needle));
  if (!entry) throw new Error(`fixture: no sentence ${needle}`);
  return entry.alias;
}

type Ev = Ai02Match["evidence"][number];

export const ev = {
  action: (ctx: InsightContext, detailId: string, quote: string): Ev => ({ source_type: "project_detail", ref: alias(ctx, "project_detail", detailId), field: "action", quote }),
  result: (ctx: InsightContext, detailId: string, quote: string): Ev => ({ source_type: "project_detail", ref: alias(ctx, "project_detail", detailId), field: "result", quote }),
  situation: (ctx: InsightContext, detailId: string, quote: string): Ev => ({ source_type: "project_detail", ref: alias(ctx, "project_detail", detailId), field: "situation", quote }),
  learnings: (ctx: InsightContext, detailId: string, quote: string): Ev => ({ source_type: "project_detail", ref: alias(ctx, "project_detail", detailId), field: "learnings", quote }),
  achievement: (ctx: InsightContext, achId: string): Ev => ({ source_type: "achievement", ref: alias(ctx, "achievement", achId), field: "metric", quote: null }),
  skill: (ctx: InsightContext, skillId: string): Ev => ({ source_type: "skill", ref: alias(ctx, "skill", skillId), field: "name", quote: null }),
  project: (ctx: InsightContext, projectId: string): Ev => ({ source_type: "project", ref: alias(ctx, "project", projectId), field: "name", quote: null }),
  sentence: (ctx: InsightContext, needle: string): Ev => ({ source_type: "jd_sentence", ref: sidOf(ctx, needle), field: null, quote: null }),
};

export function match(ref: string, status: Ai02Match["status"], evidence: Ev[] = [], extra: Partial<Ai02Match> = {}): Ai02Match {
  return {
    requirement_ref: ref,
    status,
    rationale: status === "no_evidence" ? "입력된 데이터에서 근거를 찾지 못함" : "관련 경험이 데이터에 있습니다.",
    missing_aspect: status === "met" ? null : "구체적인 운영 경험",
    evidence,
    ...extra,
  };
}

export function matchOutput(matches: Ai02Match[]): Ai02MatchOutput {
  return { schema_version: 1, matches };
}

/**
 * Recorded-style stage-1 outputs for the Korean JD (rich career).
 * REQ-1 결제 승인 API → met (action + achievement)
 * REQ-2 정산 배치    → met (action)
 * REQ-3 장애 대응    → met (action + result)
 * REQ-4 Spring Boot  → met claimed with a skill tag only → partial (server)
 * REQ-5 Kotlin       → partial (skill)
 * REQ-6 대용량 트래픽 → met claimed with situation only → partial (server)
 * REQ-7 RDBMS 인덱스  → met (action, quote partly reworded → V-3 adjusted)
 * REQ-8 Kafka        → no_evidence
 * REQ-9 팀 리딩      → met claimed with learnings only → V-8 → no_evidence
 * REQ-10 쿠버네티스   → skipped by the model → filled no_evidence
 */
export function koMatchOutputs(ctx: InsightContext): [Ai02MatchOutput, Ai02MatchOutput] {
  return [
    matchOutput([
      match("REQ-1", "met", [ev.action(ctx, IDS.detPay1, "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다"), ev.achievement(ctx, IDS.achPay)]),
      match("REQ-2", "met", [ev.action(ctx, IDS.detSettle, "정산 배치를 청크 단위로 재설계했다")]),
      match("REQ-3", "met", [ev.action(ctx, IDS.detPay2, "런북을 작성하고 알림 규칙을 정리했다"), ev.result(ctx, IDS.detPay2, "장애 복구 시간이 줄었다")]),
      match("REQ-4", "met", [ev.skill(ctx, IDS.sklSpring)]),
      match("REQ-5", "partial", [ev.skill(ctx, IDS.sklKotlin)], { missing_aspect: "Kotlin 사용 서술" }),
      match("REQ-6", "met", [ev.situation(ctx, IDS.detPay1, "피크 시간 결제 승인 API 응답이 1.2초까지 늘었다")]),
      match("REQ-7", "met", [ev.action(ctx, IDS.detPay1, "결제 승인 API의 병목 쿼리를 찾아 인덱스를 새로 설계했다")]),
      match("REQ-8", "no_evidence", []),
    ]),
    matchOutput([match("REQ-9", "met", [ev.learnings(ctx, IDS.detPay1, "측정 없이 최적화하면 안 된다는 것을 배웠다")])]),
  ];
}

/** Recorded-style stage-2 output for the Korean JD. */
export function koSynthesis(ctx: InsightContext): Ai02SynthesisOutput {
  const prjPay = alias(ctx, "project", IDS.prjPay);
  const prjSettle = alias(ctx, "project", IDS.prjSettle);
  return {
    schema_version: 1,
    strengths: [
      {
        title: "결제 승인 API 성능 개선",
        description: "결제 승인 API 응답 시간을 1.2초에서 0.7초로 줄인 경험이 결제 API 운영 요건과 맞닿습니다.",
        requirement_refs: ["REQ-1", "REQ-7"],
        evidence: [ev.action(ctx, IDS.detPay1, "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다"), ev.achievement(ctx, IDS.achPay), { source_type: "jd_requirement", ref: "REQ-1", field: null, quote: null }],
      },
      {
        title: "정산 배치 재설계",
        description: "정산 배치를 청크 단위로 재설계한 경험이 있습니다.",
        requirement_refs: ["REQ-2"],
        evidence: [ev.action(ctx, IDS.detSettle, "정산 배치를 청크 단위로 재설계했다")],
      },
    ],
    gaps: [
      {
        requirement_refs: ["REQ-8"],
        gap_kind: "no_evidence",
        description: "Kafka 기반 메시지 큐 운영 경험이 입력된 데이터에서 확인되지 않습니다.",
        actions: [
          { type: "add_data", text: "메시지 큐를 다룬 프로젝트가 있다면 추가해 주세요.", evidence: [] },
          {
            type: "prepare_answer",
            text: "비동기 처리 경험을 묻는 질문에 대비해 캐시 무효화 메시지 발행 경험을 정리해 두세요.",
            evidence: [ev.action(ctx, IDS.detEdu, "쓰기 시 무효화 메시지를 발행했다")],
          },
        ],
        evidence: [ev.sentence(ctx, "Kafka")],
      },
      {
        requirement_refs: ["REQ-5"],
        gap_kind: "partial",
        description: "Kotlin을 프로젝트에서 어떻게 썼는지 서술이 없습니다.",
        actions: [{ type: "reframe", text: "결제 승인 API 개선 상세 내용에 Kotlin 사용 범위를 함께 설명해 보세요.", evidence: [ev.skill(ctx, IDS.sklKotlin)] }],
        evidence: [],
      },
    ],
    strategy: {
      positioning: "결제 도메인에서 응답 시간과 장애 대응을 개선해 온 백엔드 엔지니어로 포지셔닝합니다.",
      positioning_evidence: [ev.achievement(ctx, IDS.achPay)],
      project_priorities: [
        { rank: 1, ref: prjPay, reason: "결제 승인 API 요건과 가장 직접적으로 연결됩니다.", requirement_refs: ["REQ-1", "REQ-3"] },
        { rank: 2, ref: prjSettle, reason: "정산 배치 개선 요건과 연결됩니다.", requirement_refs: ["REQ-2"] },
      ],
    },
  };
}
