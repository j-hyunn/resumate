import type { CareerRows, ProjectRow } from "../context-pack/career-rows";

/**
 * Synthetic career data (fictional person, no real résumé text), v4.4 model:
 * affiliated projects carry one STAR + classification, standalone projects
 * carry role/description/skills/deliverables (CR-2·CR-7·CR-8·CR-10).
 * Includes draft rows and children of draft parents to exercise C-1 inclusion.
 */
const T = "2026-01-10T00:00:00.000Z";
const T2 = "2026-02-01T00:00:00.000Z";

export const IDS = {
  expA: "10000000-0000-4000-8000-00000000000a",
  expB: "10000000-0000-4000-8000-00000000000b",
  expDraft: "10000000-0000-4000-8000-00000000000d",
  edu: "20000000-0000-4000-8000-000000000001",
  prjPay: "30000000-0000-4000-8000-000000000001",
  prjSettle: "30000000-0000-4000-8000-000000000002",
  prjEdu: "30000000-0000-4000-8000-000000000003",
  prjSide: "30000000-0000-4000-8000-000000000004",
  prjUnderDraftExp: "30000000-0000-4000-8000-000000000005",
  prjDraft: "30000000-0000-4000-8000-000000000006",
  dlvSide1: "70000000-0000-4000-8000-000000000001",
  dlvSide2: "70000000-0000-4000-8000-000000000002",
  dlvOfDraft: "70000000-0000-4000-8000-000000000003",
  prjSideDraft: "30000000-0000-4000-8000-000000000007",
  sklSpring: "60000000-0000-4000-8000-000000000001",
  sklKotlin: "60000000-0000-4000-8000-000000000002",
  sklManual: "60000000-0000-4000-8000-000000000003",
  sklOrphan: "60000000-0000-4000-8000-000000000004",
} as const;

/**
 * (v4.12, SD-2) What `private.compute_total_experience_months(user, 2026-11-01)`
 * returns for these rows: 2019-01…2021-02 (26) + 2021-03…2026-10 (68, ongoing
 * through the pack's asOf) = 94 months, no overlap, no open-ended experience.
 * The `draft` experience is excluded by the function, like the pack.
 */
export const TOTAL_EXPERIENCE_FIXTURE = {
  totalMonths: 94,
  openEndedExperienceCount: 0,
  asOfMonth: { year: 2026, month: 10 },
} as const;

export function careerRowsFixture(): CareerRows {
  return {
    totalExperience: { ...TOTAL_EXPERIENCE_FIXTURE, asOfMonth: { ...TOTAL_EXPERIENCE_FIXTURE.asOfMonth } },
    experiences: [
      {
        id: IDS.expB,
        status: "complete",
        company_name: "가상상사",
        start_month: "2019-01-01",
        end_month: "2021-02-01",
        is_current: false,
        job_rank: "사원",
        job_position: null,
        department: "플랫폼팀",
        employment_type: "full_time",
        summary: "사내 주문 시스템 유지보수",
        created_at: T,
        updated_at: T,
      },
      {
        id: IDS.expA,
        status: "complete",
        company_name: "예시페이",
        start_month: "2021-03-01",
        end_month: null,
        is_current: true,
        job_rank: "선임",
        job_position: "파트장",
        department: "결제개발팀",
        employment_type: "full_time",
        summary: "결제 플랫폼 백엔드 개발 및 운영 <리드>",
        created_at: T,
        updated_at: T2,
      },
      {
        id: IDS.expDraft,
        status: "draft",
        company_name: "작성중회사",
        start_month: null,
        end_month: null,
        is_current: false,
        job_rank: null,
        job_position: null,
        department: null,
        employment_type: null,
        summary: null,
        created_at: T,
        updated_at: T,
      },
    ],
    educations: [
      {
        id: IDS.edu,
        status: "complete",
        institution_name: "가상대학교",
        education_type: "degree",
        program_name: "컴퓨터공학",
        start_month: "2014-03-01",
        end_month: "2018-02-01",
        enrollment_status: "graduated",
        description: "분산 시스템 연구실 학부 연구생",
        created_at: T,
        updated_at: T,
      },
    ],
    projects: [
      project({
        id: IDS.prjPay,
        experience_id: IDS.expA,
        name: "결제 승인 API 개선",
        start_month: "2022-01-01",
        end_month: "2022-12-01",
        project_type: "improvement",
        experience_type: "problem_solving",
        competencies: ["problem_solving", "analysis"],
        situation: "피크 시간 결제 승인 API 응답이 1.2초까지 늘었다",
        task: "응답 시간을 1초 미만으로 낮추기",
        action: "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다",
        result: "응답 시간이 0.7초로 줄었다",
        learnings: "측정 없이 최적화하면 안 된다는 것을 배웠다. 팀 회고에서 99% 동의를 얻었다",
        content_updated_at: T2,
      }),
      project({
        id: IDS.prjSettle,
        experience_id: IDS.expA,
        name: "정산 배치 재설계",
        start_month: "2023-03-01",
        is_current: true,
        situation: "정산 배치가 새벽 내내 돌았다",
        action: "정산 배치를 청크 단위로 재설계했다",
        result: "정산 처리량이 분당 1,200건으로 늘었다",
      }),
      project({
        id: IDS.prjEdu,
        education_id: IDS.edu,
        name: "캡스톤 분산 캐시",
        start_month: "2017-03-01",
        end_month: "2017-12-01",
        project_type: "coursework",
        situation: "캐시 무효화가 늦었다",
        action: "쓰기 시 무효화 메시지를 발행했다",
      }),
      project({
        id: IDS.prjSide,
        name: "개인 가계부 앱",
        start_month: "2024-05-01",
        role: "1인 개발 (기획·백엔드)",
        description: "가계부 기록이 번거로워 문자 파싱으로 자동 기록을 만들었다. 월 사용자 300명",
      }),
      project({
        id: IDS.prjUnderDraftExp,
        experience_id: IDS.expDraft,
        name: "드래프트 경력 아래 프로젝트",
        situation: "숨김",
        action: "숨김",
      }),
      project({ id: IDS.prjDraft, status: "draft", experience_id: IDS.expA, name: "작성 중 프로젝트" }),
      project({ id: IDS.prjSideDraft, status: "draft", name: "작성 중 독립 프로젝트" }),
    ],
    deliverables: [
      {
        id: IDS.dlvSide2,
        project_id: IDS.prjSide,
        title: "출시 회고",
        body: "출시 후 **2주** 만에 리뷰 40건을 받았다.",
        sort_order: 2,
        created_at: T,
        updated_at: T,
      },
      {
        id: IDS.dlvSide1,
        project_id: IDS.prjSide,
        title: "문자 파싱 설계",
        body: "# 설계\n\n- 은행 문자 *10종*의 형식을 [정규식](https://example.com/re)으로 분류했다\n\n| 항목 | 값 |\n|---|---|\n| 정확도 | 97% |\n\n```\nparse(sms)\n```",
        sort_order: 1,
        created_at: T,
        updated_at: T2,
      },
      {
        id: IDS.dlvOfDraft,
        project_id: IDS.prjSideDraft,
        title: "숨겨질 산출물",
        body: "숨김",
        sort_order: 1,
        created_at: T,
        updated_at: T,
      },
    ],
    skills: [
      { id: IDS.sklSpring, name: "Spring Boot", normalized_name: "spring boot", is_manual: false, created_at: T, updated_at: T },
      { id: IDS.sklKotlin, name: "Kotlin", normalized_name: "kotlin", is_manual: false, created_at: T, updated_at: T },
      { id: IDS.sklManual, name: "PostgreSQL", normalized_name: "postgresql", is_manual: true, created_at: T, updated_at: T },
      { id: IDS.sklOrphan, name: "Hidden", normalized_name: "hidden", is_manual: false, created_at: T, updated_at: T },
    ],
    projectSkills: [
      { project_id: IDS.prjSide, skill_id: IDS.sklSpring },
      { project_id: IDS.prjSide, skill_id: IDS.sklKotlin },
      // CR-10: affiliated projects have no skills (DB trigger); the pack ignores a stray link.
      { project_id: IDS.prjPay, skill_id: IDS.sklOrphan },
      { project_id: IDS.prjSideDraft, skill_id: IDS.sklOrphan },
    ],
  };
}

/** One v4.4 project row with empty defaults (complete unless overridden). */
export function project(p: Partial<ProjectRow> & Pick<ProjectRow, "id" | "name">): ProjectRow {
  return {
    status: "complete",
    experience_id: null,
    education_id: null,
    start_month: null,
    end_month: null,
    is_current: false,
    project_type: null,
    experience_type: null,
    competencies: [],
    situation: null,
    task: null,
    action: null,
    result: null,
    learnings: null,
    role: null,
    description: null,
    content_updated_at: T,
    created_at: T,
    updated_at: T,
    ...p,
  };
}
