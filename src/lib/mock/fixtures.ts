/**
 * Fixture data for one realistic user (김지우, 결제 도메인 백엔드 7년차).
 *
 * Coverage (ui-implementation skill, foundation step 4):
 * - experiences across years (2 complete + 1 draft), educations (degree + course)
 * - projects under experience / education / none, with complete and draft details,
 *   one project with no period ("연도 미정")
 * - achievements on a detail result and on an experience
 * - writing chats: active new_project, saved augment, active with return_target
 * - application projects at different board stages, closed with/without outcome
 * - insight ready + insight generating (running ai_job), drafts, cover letter sections
 * - interview sessions: in_progress, completed (new result), evaluating, abandoned
 * - evidence links incl. one "변경됨" and one "원본 삭제됨"
 */
import type {
  AiJob,
  Achievement,
  AnswerEvaluation,
  ApplicationProject,
  ApplicationStageEvent,
  Draft,
  DraftSection,
  DraftSectionSource,
  Education,
  EvidenceLink,
  Experience,
  Insight,
  InterviewAnswer,
  InterviewQuestion,
  InterviewSession,
  JdRequirement,
  JobDescription,
  Profile,
  Project,
  ProjectDetail,
  ProjectSkill,
  SessionFeedback,
  Skill,
  AiProviderKey,
  AiDataUseConsent,
  AiUsageRecord,
  AiPriceTable,
  AiDisclosure,
  AiProviderName,
  WritingChat,
  WritingChatMessage,
  Consent,
  PolicyVersion,
  AiOutputMeta,
  DraftBlock,
  DraftBlockKind,
} from "@/types/db"
import type { AiErrorCode } from "@/types/db"
import { errorCategoryOf, failureCauseOf } from "@/lib/data/ai-errors"
import { IDS, USER_ID } from "./ids"
import { mockAiMeta, mockMessageMeta } from "./ai-meta"
import { DISCLOSURE_VERSION, MOCK_MODELS, PRICE_TABLE_VERSION, mockDisclosures, mockPriceTables } from "./ai-providers"
import { currentPeriodMonth, dateFromToday, daysAgo, minutesAgo, month } from "./time"

export interface MockDb {
  user: { id: string; email: string }
  profiles: Profile[]
  consents: Consent[]
  /** non-user reference table (04 A.2) */
  policy_versions: PolicyVersion[]
  experiences: Experience[]
  educations: Education[]
  projects: Project[]
  project_details: ProjectDetail[]
  achievements: Achievement[]
  skills: Skill[]
  project_skills: ProjectSkill[]
  writing_chats: WritingChat[]
  writing_chat_messages: WritingChatMessage[]
  application_projects: ApplicationProject[]
  application_stage_events: ApplicationStageEvent[]
  job_descriptions: JobDescription[]
  jd_requirements: JdRequirement[]
  insights: Insight[]
  drafts: Draft[]
  draft_sections: DraftSection[]
  draft_section_sources: DraftSectionSource[]
  interview_sessions: InterviewSession[]
  interview_questions: InterviewQuestion[]
  interview_answers: InterviewAnswer[]
  answer_evaluations: AnswerEvaluation[]
  session_feedbacks: SessionFeedback[]
  evidence_links: EvidenceLink[]
  ai_jobs: AiJob[]
  /** v4 BYOK (04 §2.9 ~ 2.11). usage_events / usage_limits removed (D-34) */
  ai_provider_keys: AiProviderKey[]
  ai_data_use_consents: AiDataUseConsent[]
  ai_usage_records: AiUsageRecord[]
  /** non-user reference tables */
  ai_price_tables: AiPriceTable[]
  ai_disclosures: AiDisclosure[]
  /** MOCK ONLY: fake AI-12 turn memory per chat (lib/mock/writing-chat-turn.ts). No table. */
  mock_chat_turns: Record<string, import("./writing-chat-turn").ChatMemory>
  /** S-28 공급자별 장애 배너 (no table; service status) — affected providers */
  service_status: { affected_providers: AiProviderName[] }
  /**
   * MOCK ONLY (v5.3): server-side outcomes the UI must be able to reproduce without a real
   * backend. Set through dev actions (lib/data/mock-controls.ts) or the /dev/states gallery.
   */
  mock_controls: MockControls
}

export function defaultMockControls(): MockControls {
  return { next_retry_refusal: null, account_deletion_failure: null, account_deletion_state: "active", next_send_refusal: null, next_jd_extraction_failure: null }
}

export interface MockControls {
  /** the next same-row retry (POST /api/ai-jobs/{id}/retry) answers 409 with this code, once */
  next_retry_refusal: import("@/types/db").AiRetryRefusalCode | null
  /** delete_account outcome: busy (nothing deleted) / incomplete (data gone, auth delete failed) */
  account_deletion_failure: import("@/types/db").AccountDeletionErrorCode | null
  /** get_account_deletion_state() of the signed-in user (A7: incomplete → S-25 탈퇴 마무리 first) */
  account_deletion_state: import("@/types/db").AccountDeletionState
  /** the next writing-chat send / 다시 보내기 is refused server-side (path ④), once (UQ-493) */
  next_send_refusal: "key_missing" | "key_invalid" | null
  /** the next JD requirement extraction (S-14 / S-15 / S-17 선행 추출) fails with this cause, once */
  next_jd_extraction_failure: import("@/types/db").AiErrorCode | null
}

const u = USER_ID

function base(id: string, createdDaysAgo: number, updatedDaysAgo = createdDaysAgo) {
  return { id, user_id: u, created_at: daysAgo(createdDaysAgo), updated_at: daysAgo(updatedDaysAgo) }
}

const aiMeta = (jobId: string | null): AiOutputMeta => mockAiMeta(jobId)

/** Current policy version. effective_at precedes the fixture consents (120 days ago) — A1 UQ-106. */
const POLICY_VERSION = "2026-04-01"

/** 04 §2.7.1 판정표 fixture sessions: each answer's outcome. "target" = failed, cause unknown (다시 채점 대상) */
const GRADED_SESSIONS = [7, 8, 9, 10, 11, 14] as const
const GRADED_OUTCOMES: Record<(typeof GRADED_SESSIONS)[number], Array<"ok" | "target" | "unanswered" | "input_too_long" | "safety_blocked">> = {
  7: ["input_too_long", "input_too_long", "unanswered"],
  8: ["ok", "ok", "ok"],
  9: ["ok", "ok", "ok"],
  10: ["ok", "ok", "safety_blocked"],
  11: ["ok", "target", "ok"],
  14: ["safety_blocked", "ok", "target"],
}
const GRADED_QUESTIONS = ["가장 어려웠던 장애를 어떻게 풀었나요?", "설계를 바꾼 결정을 설명해 주세요.", "부족한 경험은 어떻게 보완하겠어요?"]
const GRADED_ANSWERS = ["지표로 병목을 찾고 쿼리를 바꿔 해결했습니다.", "장애 범위를 줄이려고 모듈을 나눴습니다.", "사이드 프로젝트로 직접 운영해 보며 익히겠습니다."]

export function createFixtures(): MockDb {
  const thisYear = new Date().getFullYear()

  const experiences: Experience[] = [
    {
      ...base(IDS.exp(1), 120, 30),
      status: "complete",
      company_name: "그린페이먼츠",
      start_month: month(2021, 3),
      end_month: null,
      is_current: true,
      job_rank: "책임",
      job_position: "시니어 백엔드 엔지니어",
      department: "결제플랫폼팀",
      employment_type: "full_time",
      summary: "결제 승인·정산 플랫폼 백엔드 개발과 운영을 맡고 있습니다.",
    },
    {
      ...base(IDS.exp(2), 120, 90),
      status: "complete",
      company_name: "모아커머스",
      start_month: month(2018, 1),
      end_month: month(2021, 2),
      is_current: false,
      job_rank: "선임",
      job_position: "백엔드 엔지니어",
      department: "주문개발팀",
      employment_type: "full_time",
      summary: "주문·배송 도메인 서버 개발을 담당했습니다.",
    },
    {
      ...base(IDS.exp(3), 10, 10),
      status: "draft",
      company_name: "스타트업 해솔",
      start_month: month(2017, 7),
      end_month: month(2017, 12),
      is_current: false,
      job_rank: null,
      job_position: null,
      department: null,
      employment_type: "intern",
      summary: null,
    },
  ]

  const educations: Education[] = [
    {
      ...base(IDS.edu(1), 120),
      status: "complete",
      institution_name: "한빛대학교",
      education_type: "degree",
      program_name: "컴퓨터공학과 학사",
      start_month: month(2011, 3),
      end_month: month(2017, 2),
      enrollment_status: "graduated",
      description: null,
    },
    {
      ...base(IDS.edu(2), 120),
      status: "complete",
      institution_name: "코드스쿨",
      education_type: "course",
      program_name: "클라우드 백엔드 부트캠프",
      start_month: month(2017, 3),
      end_month: month(2017, 6),
      enrollment_status: "completed",
      description: "AWS 기반 서버 개발 과정을 수료했습니다.",
    },
  ]

  const projects: Project[] = [
    {
      ...base(IDS.prj(1), 100, 3),
      status: "complete",
      experience_id: IDS.exp(1),
      education_id: null,
      name: "결제 승인 API 성능 개선",
      role: "백엔드 리드",
      summary: "결제 승인 API 응답 시간을 절반 가까이 줄인 성능 개선 프로젝트",
      start_month: month(2022, 4),
      end_month: month(2022, 10),
      team_size: 4,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.prj(2), 80, 40),
      status: "complete",
      experience_id: IDS.exp(1),
      education_id: null,
      name: "정산 배치 재설계",
      role: "백엔드 엔지니어",
      summary: "일 정산 배치를 스트리밍 처리로 재설계",
      start_month: month(2023, 9),
      end_month: month(2024, 2),
      team_size: 3,
      source_writing_chat_id: IDS.wc(2),
    },
    {
      ...base(IDS.prj(3), 110, 90),
      status: "complete",
      experience_id: IDS.exp(2),
      education_id: null,
      name: "주문 시스템 MSA 전환",
      role: "주문 서비스 담당",
      summary: "모놀리식 주문 시스템을 서비스 단위로 분리",
      start_month: month(2019, 5),
      end_month: month(2020, 6),
      team_size: 8,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.prj(4), 60, 60),
      status: "draft",
      experience_id: IDS.exp(2),
      education_id: null,
      name: "사내 관리자 도구",
      role: "백엔드 개발",
      summary: null,
      start_month: month(2020, 2),
      end_month: null,
      team_size: null,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.prj(5), 115, 115),
      status: "complete",
      experience_id: null,
      education_id: IDS.edu(2),
      name: "중고거래 API 팀 프로젝트",
      role: "API 서버 개발",
      summary: "부트캠프 최종 팀 프로젝트",
      start_month: month(2017, 4),
      end_month: month(2017, 6),
      team_size: 4,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.prj(6), 20, 2),
      status: "draft",
      experience_id: null,
      education_id: null,
      name: "오픈소스 결제 SDK 기여",
      role: "컨트리뷰터",
      summary: null,
      start_month: month(thisYear - 1, 6),
      end_month: null,
      team_size: null,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.prj(7), 5, 5),
      status: "draft",
      experience_id: null,
      education_id: null,
      name: "개인 기술 블로그 운영",
      role: "작성자",
      summary: null,
      start_month: null,
      end_month: null,
      team_size: null,
      source_writing_chat_id: null,
    },
    // v5.3 A18 (UQ-489): complete detail but role empty → C-09 hint project_fields / S-10 ?focus=fields
    {
      ...base(IDS.prj(8), 6, 1),
      status: "draft",
      experience_id: IDS.exp(1),
      education_id: null,
      name: "결제 알림 재처리 개선",
      role: null,
      summary: null,
      start_month: month(thisYear - 1, 9),
      end_month: null,
      team_size: 3,
      source_writing_chat_id: null,
    },
  ]

  const project_details: ProjectDetail[] = [
    {
      ...base(IDS.det(1), 100, 3),
      project_id: IDS.prj(1),
      status: "complete",
      title: "결제 API 응답 속도 개선",
      situation:
        "트래픽이 몰리는 시간대에 결제 승인 API 응답이 1초를 넘기며 가맹점 이탈 문의가 늘었습니다. 4명의 백엔드 팀이 승인·취소 API를 함께 운영하고 있었습니다.",
      task: "승인 API p95 응답 시간을 0.8초 이하로 낮추는 목표를 맡았습니다.",
      action:
        "APM으로 병목 쿼리를 찾아 결제 승인 테이블 인덱스를 재설계했고, 가맹점 설정 조회에 Redis 캐시를 도입했습니다.",
      result: "p95 응답 시간이 1.2초에서 0.7초로 줄었고 관련 문의가 크게 감소했습니다.",
      learnings: "성능 문제는 추측보다 측정에서 시작해야 한다는 것을 배웠습니다.",
      sort_order: 1,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.det(2), 30, 1),
      project_id: IDS.prj(1),
      status: "draft",
      title: "장애 대응 매뉴얼 정비",
      situation: "야간 장애 때 대응 순서가 사람마다 달라 복구 시간이 들쭉날쭉했습니다.",
      task: null,
      action: null,
      result: null,
      learnings: null,
      sort_order: 2,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.det(3), 80, 40),
      project_id: IDS.prj(2),
      status: "complete",
      title: "정산 배치 처리 시간 단축",
      situation: "일 정산 배치가 2시간 가까이 걸려 아침 정산 확인이 늦어졌습니다.",
      task: "정산 처리 시간을 1시간 이내로 줄이는 것이 목표였습니다.",
      action: "배치를 이벤트 기반 스트리밍 처리로 바꾸고 실패 건 재시도 큐를 설계했습니다.",
      result: "처리 시간이 120분에서 35분으로 줄었습니다.",
      learnings: null,
      sort_order: 1,
      source_writing_chat_id: IDS.wc(2),
    },
    {
      ...base(IDS.det(4), 110, 90),
      project_id: IDS.prj(3),
      status: "complete",
      title: "주문 서비스 분리",
      situation: "모놀리식 구조라 주문 기능 배포가 전체 서비스 배포에 묶여 있었습니다.",
      task: "주문 도메인을 독립 서비스로 분리하는 일을 맡았습니다.",
      action: "주문 API를 별도 서비스로 분리하고 기존 DB와의 동기화를 위해 CDC 파이프라인을 구성했습니다.",
      result: "주문 기능 배포 주기가 2주에서 2일로 짧아졌습니다.",
      learnings: "점진적 전환이 빅뱅 전환보다 위험을 줄인다는 것을 배웠습니다.",
      sort_order: 1,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.det(5), 115, 115),
      project_id: IDS.prj(5),
      status: "complete",
      title: "거래 API 설계",
      situation: "4명 팀이 6주 안에 중고거래 서비스를 만들어야 했습니다.",
      task: "상품·거래 API 설계와 구현을 맡았습니다.",
      action: "Spring Boot로 거래 상태 머신을 설계하고 API 문서를 작성했습니다.",
      result: "발표회에서 우수 프로젝트로 뽑혔습니다.",
      learnings: null,
      sort_order: 1,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.det(6), 20, 2),
      project_id: IDS.prj(6),
      status: "draft",
      title: "웹훅 서명 검증 기능 추가",
      situation: null,
      task: null,
      action: "웹훅 서명 검증 유틸리티를 구현해 PR을 올렸습니다.",
      result: null,
      learnings: null,
      sort_order: 1,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.det(7), 6, 1),
      project_id: IDS.prj(8),
      status: "complete",
      title: "실패 알림 재처리 큐 도입",
      situation: "가맹점 결제 알림이 네트워크 오류로 유실되는 일이 잦았습니다.",
      task: null,
      action: "실패한 알림을 지수 백오프로 다시 보내는 재처리 큐를 설계하고 구현했습니다.",
      result: null,
      learnings: null,
      sort_order: 1,
      source_writing_chat_id: null,
    },
  ]

  const achievements: Achievement[] = [
    {
      ...base(IDS.ach(1), 100, 3),
      status: "complete",
      project_detail_id: IDS.det(1),
      experience_id: null,
      metric_name: "결제 승인 API p95 응답 시간",
      value_before: 1.2,
      value_after: 0.7,
      unit: "초",
      description: null,
      kind: null,
      source_writing_chat_id: null,
    },
    {
      ...base(IDS.ach(2), 80, 40),
      status: "complete",
      project_detail_id: IDS.det(3),
      experience_id: null,
      metric_name: "일 정산 배치 처리 시간",
      value_before: 120,
      value_after: 35,
      unit: "분",
      description: null,
      kind: null,
      source_writing_chat_id: IDS.wc(2),
    },
    {
      ...base(IDS.ach(3), 90, 90),
      status: "complete",
      project_detail_id: null,
      experience_id: IDS.exp(1),
      metric_name: null,
      value_before: null,
      value_after: null,
      unit: null,
      description: "2023년 상반기 우수 사원 선정",
      kind: null,
      source_writing_chat_id: null,
    },
  ]

  const skillNames = ["Java", "Spring Boot", "Kotlin", "MySQL", "Redis", "AWS", "Kafka"]
  const skills: Skill[] = skillNames.map((name, i) => ({
    ...base(IDS.skl(i + 1), 100),
    name,
    normalized_name: name.toLowerCase().replace(/\s+/g, ""),
    is_manual: name === "Kotlin",
    proficiency: null,
  }))

  const tag = (prj: number, skl: number): ProjectSkill => ({
    project_id: IDS.prj(prj),
    skill_id: IDS.skl(skl),
    user_id: u,
    created_at: daysAgo(90),
  })
  const project_skills: ProjectSkill[] = [
    tag(1, 1), tag(1, 2), tag(1, 4), tag(1, 5),
    tag(2, 1), tag(2, 2), tag(2, 7),
    tag(3, 1), tag(3, 2), tag(3, 4),
    tag(5, 1), tag(5, 2),
    tag(6, 3),
  ]

  const writing_chats: WritingChat[] = [
    {
      ...base(IDS.wc(1), 3, 0),
      mode: "new_project",
      project_id: null,
      experience_id: IDS.exp(1),
      education_id: null,
      status: "active",
      structured_draft: {
        schema_version: 1,
        project: {
          name: {
            value: "가맹점 정산 대시보드",
            origin: "ai",
            source_message_ids: [IDS.wcm(2)],
            source_quotes: ["가맹점이 직접 정산 내역을 보는 대시보드"],
            review: "ok",
            reviewed_at: null,
          },
          role: {
            value: "API 설계와 구현",
            origin: "ai",
            source_message_ids: [IDS.wcm(4)],
            source_quotes: ["제가 API 설계와 구현을 맡았어요"],
            review: "needs_review",
            reviewed_at: null,
          },
        },
        details: [
          {
            detail_key: "D1",
            existing_detail_id: null,
            fields: {
              situation: {
                value: "가맹점이 정산 내역을 확인하려면 고객센터에 문의해야 했습니다.",
                origin: "ai",
                source_message_ids: [IDS.wcm(2)],
                source_quotes: ["고객센터에 전화해서 물어봐야 했어요"],
                review: "ok",
                reviewed_at: null,
              },
            },
            achievements: [],
          },
        ],
        skills: [],
        clarifications: [{ kind: "actor_ambiguous", field: "action", detail_key: "D1" }],
        sensitive_flags_count: 0,
      },
      // v4.2 A5: the greeting (sequence 1) is not counted
      message_count: 5,
      last_activity_at: minutesAgo(90),
      saved_at: null,
      return_target: null,
      last_extracted_sequence: 6,
    },
    {
      ...base(IDS.wc(2), 82, 80),
      mode: "augment_project",
      project_id: IDS.prj(2),
      experience_id: IDS.exp(1),
      education_id: null,
      status: "saved",
      structured_draft: { schema_version: 1 },
      message_count: 14,
      last_activity_at: daysAgo(80),
      saved_at: daysAgo(80),
      return_target: null,
      last_extracted_sequence: 14,
    },
    {
      ...base(IDS.wc(3), 2, 1),
      mode: "augment_project",
      project_id: IDS.prj(6),
      experience_id: null,
      education_id: null,
      status: "active",
      structured_draft: { schema_version: 1, details: [] },
      message_count: 1,
      last_activity_at: daysAgo(1),
      saved_at: null,
      return_target: {
        application_project_id: IDS.ap(2),
        feature: "job_interview",
        params: { question_count: 5 },
        created_at: daysAgo(2),
      },
      last_extracted_sequence: 2,
    },
    // v4.2 A6: 그만둔 대화 (not linked to a project → auto-deleted 90 days after last activity)
    {
      ...base(IDS.wc(4), 25, 20),
      mode: "new_project",
      project_id: null,
      experience_id: IDS.exp(2),
      education_id: null,
      status: "abandoned",
      structured_draft: {
        schema_version: 1,
        project: {
          name: {
            value: "사내 배포 자동화",
            origin: "ai",
            source_message_ids: [IDS.wcm(10)],
            source_quotes: ["배포를 자동화하는 사내 도구"],
            review: "ok",
            reviewed_at: null,
          },
        },
        details: [],
        skills: [],
        clarifications: [],
        sensitive_flags_count: 0,
      },
      message_count: 3,
      last_activity_at: daysAgo(20),
      saved_at: null,
      return_target: null,
      last_extracted_sequence: 2,
    },
    // v5.3 A6 (UQ-489): abandoned augment chat linked to a project → S-10 대화 기록 "그만둠" + 다시 이어 하기
    {
      ...base(IDS.wc(5), 12, 9),
      mode: "augment_project",
      project_id: IDS.prj(6),
      experience_id: null,
      education_id: null,
      status: "abandoned",
      structured_draft: { schema_version: 1, details: [] },
      message_count: 1,
      last_activity_at: daysAgo(9),
      saved_at: null,
      return_target: null,
      last_extracted_sequence: 2,
    },
  ]

  const msg = (
    n: number,
    chat: number,
    sequence: number,
    role: "user" | "assistant",
    content: string,
    ago: number,
  ): WritingChatMessage => ({
    id: IDS.wcm(n),
    user_id: u,
    created_at: minutesAgo(ago),
    updated_at: minutesAgo(ago),
    writing_chat_id: IDS.wc(chat),
    sequence,
    role,
    content,
    status: "done",
    ai_job_id: role === "assistant" && sequence > 1 ? IDS.job(20 + n) : null,
    ...mockMessageMeta(role === "assistant" && sequence > 1 ? { provider: "gemini", connection_tier: "free" } : null),
  })
  const writing_chat_messages: WritingChatMessage[] = [
    msg(1, 1, 1, "assistant", "안녕하세요. 어떤 프로젝트를 정리해 볼까요? 프로젝트 이름과 어떤 문제를 풀려고 했는지 알려 주세요.", 200),
    msg(2, 1, 2, "user", "가맹점이 직접 정산 내역을 보는 대시보드를 만들었어요. 전에는 고객센터에 전화해서 물어봐야 했어요.", 190),
    msg(3, 1, 3, "assistant", "좋아요. 그 프로젝트에서 본인은 어떤 역할을 맡았나요?", 189),
    msg(4, 1, 4, "user", "팀에서 같이 만들었고 제가 API 설계와 구현을 맡았어요.", 120),
    msg(5, 1, 5, "assistant", "그중 본인이 직접 한 부분은 무엇인가요? 팀이 함께 한 일과 나눠서 알려 주세요.", 119),
    msg(6, 1, 6, "user", "잘 모르겠어요", 90),
    // fixed greeting (A5) — same text startWritingChat inserts for augment_project (UQ-491)
    msg(7, 3, 1, "assistant", "이 프로젝트에 상세 내용을 더해 볼게요. 비어 있는 부분부터 여쭤볼게요.", 60 * 26),
    msg(8, 3, 2, "user", "웹훅 서명 검증이 없어서 보안 이슈 제보가 있었어요.", 60 * 24),
    // chat 4 (abandoned)
    msg(9, 4, 1, "assistant", "안녕하세요. 어떤 프로젝트를 정리해 볼까요? 프로젝트 이름과 어떤 문제를 풀려고 했는지 알려 주세요.", 60 * 24 * 21),
    msg(10, 4, 2, "user", "배포를 자동화하는 사내 도구를 만들었어요.", 60 * 24 * 20 + 30),
    msg(11, 4, 3, "assistant", "좋아요. 그 도구를 만들기 전에는 배포를 어떻게 했나요?", 60 * 24 * 20 + 29),
    msg(12, 4, 4, "user", "수동으로 서버마다 접속했어요.", 60 * 24 * 20),
    // chat 5 (abandoned, linked to prj 6)
    msg(13, 5, 1, "assistant", "이 프로젝트에 상세 내용을 더해 볼게요. 비어 있는 부분부터 여쭤볼게요.", 60 * 24 * 10),
    msg(14, 5, 2, "user", "SDK에 재시도 옵션도 추가했어요.", 60 * 24 * 9),
  ]

  // --- application projects ------------------------------------------------
  const ap = (
    n: number,
    name: string | null,
    name_source: ApplicationProject["name_source"],
    stage: ApplicationProject["stage"],
    outcome: ApplicationProject["stage_outcome"],
    deadlineDays: number | null,
    stageChangedDaysAgo: number,
    lastActivityDaysAgo: number,
  ): ApplicationProject => ({
    ...base(IDS.ap(n), 40 - n, lastActivityDaysAgo),
    name,
    name_source,
    deadline: deadlineDays === null ? null : dateFromToday(deadlineDays),
    memo: null,
    stage,
    stage_outcome: outcome,
    stage_changed_at: daysAgo(stageChangedDaysAgo),
    last_activity_at: daysAgo(lastActivityDaysAgo),
    duplicated_from_id: null,
  })
  const application_projects: ApplicationProject[] = [
    ap(1, "그린뱅크 – 결제 백엔드 엔지니어", "ai", "job_interview", null, 10, 2, 0),
    ap(2, "하늘커머스 – 서버 개발자", "user", "document", null, 2, 5, 1),
    ap(3, "클라우드나인 – 플랫폼 엔지니어", "ai", "before_apply", null, 21, 3, 3),
    ap(4, "별빛증권 – 백엔드 개발", "ai", "closed", "failed", -12, 8, 8),
    ap(5, "스텔라랩스 – Senior Backend Engineer", "ai", "closed", null, -30, 15, 15),
    ap(6, null, null, "before_apply", null, null, 0, 0),
    // Q53-2 · 9: 입력 원인으로 요건 추출 실패 + 요건 0개 → 공고 원문 고치기 (JD 7, 세션 6 · 12)
    ap(7, "새 기업 JD (2026-10-29)", "default", "before_apply", null, 14, 1, 1),
    // Q53-11: 추출은 성공했는데 요건 0개, 이 원문으로 만든 결과 없음
    ap(8, "새 기업 JD (2026-10-30)", "default", "before_apply", null, 14, 1, 1),
  ]

  const stageEvent = (
    n: number,
    apN: number,
    event_type: ApplicationStageEvent["event_type"],
    from_stage: ApplicationStageEvent["from_stage"],
    to_stage: ApplicationStageEvent["to_stage"],
    ago: number,
    to_outcome: ApplicationStageEvent["to_outcome"] = null,
  ): ApplicationStageEvent => ({
    id: IDS.ase(n),
    user_id: u,
    application_project_id: IDS.ap(apN),
    event_type,
    from_stage,
    to_stage,
    from_outcome: null,
    to_outcome,
    created_at: daysAgo(ago),
  })
  const application_stage_events: ApplicationStageEvent[] = [
    stageEvent(1, 1, "created", null, "before_apply", 39),
    stageEvent(2, 1, "stage_changed", "before_apply", "document", 20),
    stageEvent(3, 1, "stage_changed", "document", "job_interview", 2),
    stageEvent(4, 2, "created", null, "before_apply", 38),
    stageEvent(5, 2, "stage_changed", "before_apply", "document", 5),
    stageEvent(6, 3, "created", null, "before_apply", 3),
    stageEvent(7, 4, "created", null, "before_apply", 36),
    stageEvent(8, 4, "stage_changed", "document", "closed", 8, "failed"),
    stageEvent(9, 5, "created", null, "before_apply", 35),
    stageEvent(10, 5, "stage_changed", "assignment", "closed", 15),
    stageEvent(11, 6, "created", null, "before_apply", 0),
    stageEvent(12, 7, "created", null, "before_apply", 1),
    stageEvent(13, 8, "created", null, "before_apply", 1),
  ]

  const jdText1 = [
    "그린뱅크 결제플랫폼팀에서 결제 백엔드 엔지니어를 찾습니다.",
    "대규모 결제 승인 API를 설계하고 운영합니다.",
    "Java/Kotlin 기반 Spring 서버 개발 경력 5년 이상이 필요합니다.",
    "RDBMS 성능 튜닝 경험이 필요합니다.",
    "Kafka 등 메시지 큐 기반 비동기 처리 경험을 우대합니다.",
    "정산 시스템 개발 경험을 우대합니다.",
  ]
  const sentences = (lines: string[]) => {
    let pos = 0
    return lines.map((text, i) => {
      const start = pos
      pos += text.length + 1
      return { sid: `S${i + 1}`, text, start, end: start + text.length }
    })
  }
  const jd = (
    n: number,
    apN: number,
    lines: string[],
    company: string | null,
    position: string | null,
    status: JobDescription["extraction_status"],
  ): JobDescription => ({
    ...base(IDS.jd(n), 40 - apN),
    application_project_id: IDS.ap(apN),
    raw_text: lines.join("\n"),
    raw_text_hash: `hash-${n}`,
    sentences: sentences(lines),
    detected_language: "ko",
    company_name: company,
    company_name_source: company ? "ai" : null,
    position_title: position,
    position_title_source: position ? "ai" : null,
    extraction_status: status,
    extraction:
      status === "succeeded"
        ? { is_likely_jd: true, seniority: n === 1 ? { min_years: 5, max_years: null, label: "5년 이상", source_sids: ["S3"] } : null }
        : null,
    extraction_job_id: IDS.job(n),
    extraction_provider: status === "succeeded" ? "gemini" : null,
    extraction_model: status === "succeeded" ? MOCK_MODELS.gemini.light : null,
    tech_keywords: status === "succeeded" ? [{ keyword: "Kafka", source_sids: ["S5"] }] : [],
    requirements_hash: status === "succeeded" ? `req-hash-${n}` : null,
    raw_text_edited_at: null,
  })
  const job_descriptions: JobDescription[] = [
    jd(1, 1, jdText1, "그린뱅크", "결제 백엔드 엔지니어", "succeeded"),
    jd(2, 2, ["하늘커머스 서버 개발자 채용", "주문·결제 서버 개발", "Spring 경력 3년 이상", "AWS 운영 경험 우대"], "하늘커머스", "서버 개발자", "succeeded"),
    jd(3, 3, ["클라우드나인 플랫폼 엔지니어", "쿠버네티스 운영 경험", "IaC 경험 우대"], "클라우드나인", "플랫폼 엔지니어", "succeeded"),
    jd(4, 4, ["별빛증권 백엔드 개발자", "주문 체결 시스템 개발"], "별빛증권", "백엔드 개발", "succeeded"),
    jd(5, 5, ["Stellar Labs Senior Backend Engineer", "Design distributed systems"], "스텔라랩스", "Senior Backend Engineer", "succeeded"),
    jd(6, 6, ["(붙여넣은 공고 원문)"], null, null, "running"),
    // Q53-2: S-15 공고 원문 수정 대상 (job 15 = not_a_jd). 회사명·포지션명 없음, 추출 전 이름 그대로
    {
      ...jd(7, 7, ["안녕하세요, 이번 주 팀 회의록입니다.", "다음 주 일정은 금요일에 다시 공유드릴게요."], null, null, "failed"),
      extraction_job_id: IDS.job(15),
    },
    {
      ...jd(8, 8, ["담당 업무와 자격 요건은 추후 안내드립니다."], null, null, "succeeded"),
      tech_keywords: [],
    },
  ]

  const req = (
    n: number,
    jdN: number,
    category: JdRequirement["category"],
    content: string,
    importance: JdRequirement["importance"],
    sids: string[],
    sort: number,
  ): JdRequirement => ({
    ...base(IDS.req(n), 39),
    job_description_id: IDS.jd(jdN),
    category,
    content,
    keywords: [],
    importance,
    source_sids: sids,
    sort_order: sort,
    origin: "ai",
    is_user_edited: false,
  })
  const jd_requirements: JdRequirement[] = [
    req(1, 1, "responsibility", "대규모 결제 승인 API 설계·운영", "high", ["S2"], 1),
    req(2, 1, "required", "Java/Kotlin 기반 Spring 서버 개발 5년 이상", "high", ["S3"], 2),
    req(3, 1, "required", "RDBMS 성능 튜닝 경험", "normal", ["S4"], 3),
    req(4, 1, "preferred", "Kafka 등 메시지 큐 기반 비동기 처리 경험", "normal", ["S5"], 4),
    req(5, 1, "preferred", "정산 시스템 개발 경험", "normal", ["S6"], 5),
    req(6, 2, "responsibility", "주문·결제 서버 개발", "high", ["S2"], 1),
    req(7, 2, "required", "Spring 경력 3년 이상", "high", ["S3"], 2),
    req(8, 2, "preferred", "AWS 운영 경험", "normal", ["S4"], 3),
    req(9, 3, "required", "쿠버네티스 운영 경험", "high", ["S2"], 1),
    req(10, 3, "preferred", "IaC 경험", "normal", ["S3"], 2),
    req(11, 4, "responsibility", "주문 체결 시스템 개발", "high", ["S2"], 1),
    req(12, 5, "responsibility", "Design distributed systems", "high", ["S2"], 1),
  ]

  // --- AI jobs (time-based mock progress, see mock/ai.ts) -------------------
  const job = (
    n: number,
    job_type: AiJob["job_type"],
    apN: number | null,
    target_type: string | null,
    target_id: string | null,
    status: AiJob["status"],
    progress: AiJob["progress"],
    startedMinutesAgo: number,
    params: Record<string, unknown> | null = null,
  ): AiJob => ({
    id: IDS.job(n),
    user_id: u,
    created_at: minutesAgo(startedMinutesAgo),
    updated_at: minutesAgo(Math.max(0, startedMinutesAgo - 1)),
    job_type,
    application_project_id: apN === null ? null : IDS.ap(apN),
    target_type,
    target_id,
    status,
    progress,
    params,
    provider: "gemini",
    model_tier: job_type === "jd_extraction" ? "light" : "default",
    connection_tier: "free",
    retry_count: 0,
    next_run_at: null,
    retry_wait_total_ms: 0,
    error_code: null,
    error_category: null,
    failure_cause: null,
    quota_resets_at: null,
    retry_after: null,
    input_hash: null,
    prompt_version: "mock.v1",
    model: MOCK_MODELS.gemini[job_type === "jd_extraction" ? "light" : "default"],
    usage: null,
    output: null,
    step_outputs: {},
    run_generation: 1,
    heartbeat_at: minutesAgo(0),
    cancel_requested_at: null,
    started_at: minutesAgo(startedMinutesAgo),
    finished_at: status === "succeeded" ? minutesAgo(Math.max(0, startedMinutesAgo - 1)) : null,
  })
  const failedJob = (n: number, job_type: AiJob["job_type"], apN: number, target_type: string, target_id: string, code: AiErrorCode, startedMinutesAgo: number): AiJob => ({
    ...job(n, job_type, apN, target_type, target_id, "failed", null, startedMinutesAgo),
    error_code: code,
    error_category: errorCategoryOf(code),
    failure_cause: failureCauseOf(code),
    finished_at: minutesAgo(startedMinutesAgo - 1),
  })
  const ai_jobs: AiJob[] = [
    job(1, "jd_extraction", 1, "job_description", IDS.jd(1), "succeeded", null, 60 * 24 * 39),
    job(6, "jd_extraction", 6, "job_description", IDS.jd(6), "running", { stage: "extract" }, 0),
    job(10, "insight", 1, "insight", IDS.ins(1), "succeeded", { stage: "validate", done: 1, total: 1 }, 60 * 24 * 6),
    // running jobs advance with wall-clock time in mock/ai.ts (mock_duration_ms)
    job(11, "insight", 2, "insight", IDS.ins(2), "running", { stage: "match", done: 0, total: 2 }, 0, {
      mock_duration_ms: 10 * 60_000,
    }),
    job(12, "interview_evaluation", 2, "interview_session", IDS.ses(3), "running", { stage: "evaluate", done: 1, total: 3 }, 0, {
      mock_duration_ms: 10 * 60_000,
    }),
    // v4.2: failed grading on another provider/tier → same-row retry shows "{활성 공급자}로 처음부터 다시 해요"
    {
      ...job(13, "interview_evaluation", 3, "interview_session", IDS.ses(5), "failed", { stage: "evaluate", done: 1, total: 3 }, 60 * 26),
      provider: "openai",
      connection_tier: "paid",
      model: MOCK_MODELS.openai.default,
      error_code: "provider_unavailable",
      error_category: "transient",
      failure_cause: "provider_unavailable",
      finished_at: minutesAgo(60 * 25),
    },
    // v4.2 A4: failed career description generation (request-scoped, not same-row retryable)
    {
      ...job(14, "career_description", 2, "draft", IDS.drf(3), "failed", { stage: "generate" }, 60 * 48),
      error_code: "schema_invalid",
      error_category: "system",
      finished_at: minutesAgo(60 * 48 - 1),
    },
    // Q53-2 · 9: 입력 원인 실패 JD (AP 7). 추출 · 인사이트 선행 추출 · 질문 생성 선행 추출이 같은 원인으로 실패
    failedJob(15, "jd_extraction", 7, "job_description", IDS.jd(7), "not_a_jd", 60 * 26),
    failedJob(16, "interview_questions", 7, "interview_session", IDS.ses(6), "not_a_jd", 60 * 25),
    failedJob(17, "insight", 7, "insight", IDS.ins(3), "not_a_jd", 60 * 24),
    // Q53-9: 요건이 있는 공고의 질문 생성 입력 원인 실패 (AP 2) → S-15 읽기 전용 + 안내
    failedJob(21, "interview_questions", 2, "interview_session", IDS.ses(13), "safety_blocked", 60 * 6),
    // 04 §2.7.1 판정표: 세션 7 입력 원인만 · 8 종합만 실패 · 9 종합이 입력 원인 · 14 입력 원인 + 다른 원인
    failedJob(18, "interview_evaluation", 5, "interview_session", IDS.ses(7), "input_too_long", 60 * 20),
    failedJob(19, "interview_evaluation", 5, "interview_session", IDS.ses(8), "provider_unavailable", 60 * 19),
    failedJob(20, "interview_evaluation", 5, "interview_session", IDS.ses(9), "input_too_long", 60 * 18),
    failedJob(22, "interview_evaluation", 5, "interview_session", IDS.ses(14), "provider_unavailable", 60 * 17),
  ]

  // --- insights --------------------------------------------------------------
  const insights: Insight[] = [
    {
      ...base(IDS.ins(1), 6),
      ...aiMeta(IDS.job(10)),
      application_project_id: IDS.ap(1),
      version_no: 1,
      is_latest: true,
      status: "ready",
      requirements_hash: "req-hash-1",
      completed_at: daysAgo(6),
      match_stage_result: null,
      result: {
        schema_version: 1,
        basis_note: "입력된 경력 데이터 기준 분석입니다",
        data_sufficiency: { level: "ok", hints: [] },
        requirement_matches: [
          { item_key: `requirement_matches.${IDS.req(1)}`, requirement_id: IDS.req(1), status: "met", rationale: "결제 승인 API 성능 개선을 직접 이끈 경험이 있습니다.", missing_aspect: null },
          { item_key: `requirement_matches.${IDS.req(2)}`, requirement_id: IDS.req(2), status: "partial", rationale: "Spring 기반 개발 경력은 충분하지만 Kotlin 사용 근거가 적습니다.", missing_aspect: "Kotlin 실무 사용 경험" },
          { item_key: `requirement_matches.${IDS.req(3)}`, requirement_id: IDS.req(3), status: "met", rationale: "인덱스 재설계로 응답 시간을 줄였습니다.", missing_aspect: null },
          { item_key: `requirement_matches.${IDS.req(4)}`, requirement_id: IDS.req(4), status: "no_evidence", rationale: "메시지 큐 기반 처리 경험이 입력된 데이터에서 확인되지 않습니다.", missing_aspect: "Kafka 운영 경험" },
          { item_key: `requirement_matches.${IDS.req(5)}`, requirement_id: IDS.req(5), status: "met", rationale: "정산 배치 재설계 경험이 있습니다.", missing_aspect: null },
        ],
        summary_counts: { met: 3, partial: 1, no_evidence: 1 },
        strengths: [
          { item_key: "strengths.0", title: "대규모 결제 트래픽 성능 개선", description: "결제 승인 API 응답 시간을 1.2초에서 0.7초로 줄인 경험이 JD의 결제 API 운영 요건과 직접 맞닿습니다.", requirement_ids: [IDS.req(1), IDS.req(3)] },
        ],
        gaps: [
          {
            item_key: "gaps.0",
            requirement_ids: [IDS.req(4)],
            gap_kind: "no_evidence",
            description: "Kafka 기반 이벤트 처리 경험이 입력된 데이터에서 확인되지 않습니다.",
            actions: [
              { item_key: "gaps.0.actions.0", type: "add_data", text: "메시지 큐를 다룬 프로젝트가 있다면 추가해 주세요." },
              { item_key: "gaps.0.actions.1", type: "prepare_answer", text: "비동기 처리 설계 경험을 묻는 질문에 대비해 정산 배치의 재시도 큐 설계를 정리해 두세요." },
            ],
          },
        ],
        strategy: {
          positioning: "결제 도메인에서 성능과 안정성을 수치로 개선해 온 백엔드 엔지니어로 포지셔닝합니다.",
          project_priorities: [
            { item_key: "strategy.project_priorities.1", rank: 1, project_id: IDS.prj(1), reason: "결제 API 운영 요건과 가장 직접적으로 연결", requirement_ids: [IDS.req(1), IDS.req(3)] },
            { item_key: "strategy.project_priorities.2", rank: 2, project_id: IDS.prj(2), reason: "정산 우대 요건과 연결", requirement_ids: [IDS.req(5)] },
          ],
        },
      },
    },
    {
      ...base(IDS.ins(2), 0),
      ...aiMeta(IDS.job(11)),
      application_project_id: IDS.ap(2),
      version_no: 1,
      is_latest: false,
      status: "generating",
      requirements_hash: "req-hash-2",
      completed_at: null,
      match_stage_result: null,
      result: null,
    },
  ]

  // --- drafts ---------------------------------------------------------------
  const drafts: Draft[] = [
    {
      ...base(IDS.drf(1), 5, 4),
      ...aiMeta(null),
      application_project_id: IDS.ap(1),
      insight_id: IDS.ins(1),
      draft_type: "career_description",
      title: "경력기술서",
      status: "ready",
      options: {
        included_experience_ids: [IDS.exp(1), IDS.exp(2)],
        included_education_ids: [],
        included_project_ids: [IDS.prj(1), IDS.prj(2), IDS.prj(3)],
        project_order: [IDS.prj(1), IDS.prj(2), IDS.prj(3)],
        selection_origin: "insight",
      },
      edited_at: daysAgo(4),
      first_copied_at: null,
      regenerated_from_id: null,
      completed_at: daysAgo(5),
    },
    {
      ...base(IDS.drf(2), 3, 1),
      ...aiMeta(null),
      application_project_id: IDS.ap(1),
      insight_id: null,
      draft_type: "cover_letter",
      title: "자기소개서",
      status: "composing",
      options: {},
      edited_at: null,
      first_copied_at: null,
      regenerated_from_id: null,
      completed_at: null,
    },
    // v4.2 A4: 생성 실패 경력기술서 — no blocks, retry makes a new draft row (S-17 실패 초안 행)
    {
      ...base(IDS.drf(3), 2, 2),
      ...aiMeta(IDS.job(14)),
      application_project_id: IDS.ap(2),
      insight_id: null,
      draft_type: "career_description",
      title: "경력기술서",
      status: "failed",
      options: {
        included_experience_ids: [IDS.exp(1)],
        included_education_ids: [],
        included_project_ids: [IDS.prj(1)],
        project_order: [IDS.prj(1)],
        selection_origin: "user",
        tone: "detailed",
      },
      edited_at: null,
      first_copied_at: null,
      regenerated_from_id: null,
      completed_at: null,
    },
    // Q53-7: 첫 생성을 중단한 경력기술서 — S-17 "작성 중" 행, 설정 복원, 초안 수에서 제외
    {
      ...base(IDS.drf(4), 1, 0),
      ...aiMeta(null),
      provider: null,
      model: null,
      model_tier: null,
      connection_tier: null,
      prompt_version: null,
      application_project_id: IDS.ap(3),
      insight_id: null,
      draft_type: "career_description",
      title: "경력기술서",
      status: "composing",
      options: {
        included_experience_ids: [IDS.exp(1)],
        included_education_ids: [],
        included_project_ids: [IDS.prj(1), IDS.prj(2)],
        project_order: [IDS.prj(1), IDS.prj(2)],
        selection_origin: "user",
        tone: "detailed",
      },
      edited_at: null,
      first_copied_at: null,
      regenerated_from_id: null,
      completed_at: null,
    },
  ]

  const block = (
    block_id: string,
    block_kind: DraftBlockKind,
    text: string,
    extra: Partial<Pick<DraftBlock, "project_id" | "requirement_ids" | "flags" | "placeholders">> = {},
  ): DraftBlock => ({
    block_id,
    block_kind,
    project_id: extra.project_id ?? null,
    text,
    requirement_ids: extra.requirement_ids ?? [],
    placeholders: extra.placeholders ?? [],
    flags: extra.flags ?? [],
    generated_by: "ai",
    user_modified: false,
  })

  const sectionBase = (n: number, draftN: number, sort: number): Omit<DraftSection, "section_kind"> => ({
    ...base(IDS.dsec(n), 5, 4),
    draft_id: IDS.drf(draftN),
    sort_order: sort,
    experience_id: null,
    education_id: null,
    heading: null,
    question_text: null,
    template_key: null,
    char_limit: null,
    count_basis: null,
    user_note: null,
    source_selection_mode: "ai",
    sources_modified_at: null,
    generation_no: 0,
    question_class: null,
    status: "pending",
    ai_content: null,
    edited_content: null,
    ai_char_count: null,
    correction_applied: false,
    ...aiMeta(null),
  })

  const draft_sections: DraftSection[] = [
    {
      ...sectionBase(1, 1, 1),
      section_kind: "experience",
      experience_id: IDS.exp(1),
      heading: "그린페이먼츠 · 2021.03 ~ 재직 중 · 시니어 백엔드 엔지니어",
      status: "ready",
      generation_no: 1,
      ai_content: {
        blocks: [
          block("e1-s", "summary", "결제 플랫폼 백엔드 개발 및 운영 담당"),
          block("p1-r", "role_line", "결제 승인 API 성능 개선 · 백엔드 리드 (4인 팀)", { project_id: IDS.prj(1) }),
          block("p1-b1", "bullet", "결제 승인 API 구조 개선으로 p95 응답 시간 1.2초 → 0.7초 단축", { project_id: IDS.prj(1), requirement_ids: [IDS.req(1)] }),
          block("p2-b1", "bullet", "정산 배치 재설계로 처리 시간 [수치 입력 필요] 단축", {
            project_id: IDS.prj(2),
            requirement_ids: [IDS.req(5)],
            flags: ["number_check_needed"],
            placeholders: [{ token: "[수치 입력 필요]", hint: "정산 배치 처리 시간의 개선 전후 값" }],
          }),
        ],
      },
    },
    {
      ...sectionBase(2, 2, 1),
      section_kind: "cover_letter_question",
      question_text: "지원 동기를 작성해 주세요.",
      template_key: "motivation",
      question_class: "motivation",
      char_limit: 800,
      count_basis: "with_spaces",
      user_note: "결제 도메인에 대한 관심을 강조하고 싶어요.",
      status: "ready",
      generation_no: 1,
      ai_content: {
        blocks: [
          block("q1-p1", "paragraph", "결제는 한 번의 실패가 곧 고객의 신뢰 손실로 이어지는 영역입니다. 저는 결제 승인 API 응답 시간을 1.2초에서 0.7초로 줄이며 그 무게를 체감했습니다. [지원 동기 입력 필요]"),
        ],
      },
    },
    {
      ...sectionBase(3, 2, 2),
      section_kind: "cover_letter_question",
      question_text: "직무 역량을 보여 줄 수 있는 경험을 작성해 주세요.",
      template_key: "job_competency",
      question_class: "job_competency",
      char_limit: 1000,
      count_basis: "with_spaces",
    },
    {
      ...sectionBase(4, 2, 3),
      section_kind: "cover_letter_question",
      question_text: "입사 후 포부를 작성해 주세요.",
      template_key: "future_plan",
      question_class: "future_plan",
      char_limit: 600,
      count_basis: "without_spaces",
    },
  ]

  const draft_section_sources: DraftSectionSource[] = [
    {
      ...base(IDS.dsrc(1), 3),
      draft_section_id: IDS.dsec(2),
      application_project_id: IDS.ap(1),
      experience_id: IDS.exp(1),
      education_id: null,
      project_id: IDS.prj(1),
      project_detail_ids: [IDS.det(1)],
      role: "primary",
      origin: "ai",
      rationale: "결제 도메인 관심을 보여 줄 가장 직접적인 경험",
      reuse_reason: null,
      requirement_ids: [IDS.req(1)],
      sort_order: 1,
      source_label: "그린페이먼츠 › 결제 승인 API 성능 개선 › 결제 API 응답 속도 개선",
      source_deleted_at: null,
    },
  ]

  // --- interviews -------------------------------------------------------------
  const session = (
    n: number,
    apN: number,
    type: InterviewSession["interview_type"],
    status: InterviewSession["status"],
    extra: Partial<InterviewSession>,
  ): InterviewSession => ({
    ...base(IDS.ses(n), 10 - n, 0),
    application_project_id: IDS.ap(apN),
    insight_id: null,
    source_session_id: null,
    interview_type: type,
    question_count: 5,
    data_sufficiency: "ok",
    weak_requirement_ids: [],
    status,
    generation_status: "ready",
    answered_count: 0,
    unanswered_count: 0,
    submitted_at: null,
    completed_at: null,
    result_viewed_at: null,
    abandoned_at: null,
    last_activity_at: daysAgo(0, 3),
    career_snapshot_hash: null,
    score_status: null,
    score_value: null,
    score_max: null,
    score_method_version: null,
    score_rationale: null,
    score_counted_count: null,
    question_provider: "gemini",
    question_model: MOCK_MODELS.gemini.default,
    evaluation_provider: status === "completed" || status === "evaluating" ? "gemini" : null,
    evaluation_model: status === "completed" || status === "evaluating" ? MOCK_MODELS.gemini.default : null,
    question_validation_report: null,
    question_usage: null,
    ...extra,
  })
  const gradedSession = (n: (typeof GRADED_SESSIONS)[number], apN: number, status: "evaluation_failed" | "completed", answered: number, unanswered: number): InterviewSession =>
    session(n, apN, "job", status, {
      created_at: daysAgo(2),
      question_count: 3,
      answered_count: answered,
      unanswered_count: unanswered,
      submitted_at: daysAgo(1),
      completed_at: status === "completed" ? daysAgo(1) : null,
      score_status: status === "completed" ? "pending_method" : null,
      score_counted_count: status === "completed" ? GRADED_OUTCOMES[n].filter((o) => o === "ok").length : null,
      last_activity_at: daysAgo(1),
      evaluation_provider: "gemini",
      evaluation_model: MOCK_MODELS.gemini.default,
    })
  const interview_sessions: InterviewSession[] = [
    session(1, 1, "job", "in_progress", { answered_count: 2, weak_requirement_ids: [IDS.req(4)], last_activity_at: minutesAgo(180) }),
    session(2, 1, "culture_fit", "completed", {
      question_count: 3,
      answered_count: 3,
      submitted_at: daysAgo(4),
      completed_at: daysAgo(4),
      result_viewed_at: null,
      score_status: "pending_method",
      score_counted_count: 3,
      last_activity_at: daysAgo(4),
    }),
    session(3, 2, "job", "evaluating", { question_count: 3, answered_count: 3, submitted_at: minutesAgo(1), last_activity_at: minutesAgo(1) }),
    // A8 읽기 전용: 질문이 있고 답변 1개를 쓰다 그만둔 세션 (UQ-609, 질문 40~42)
    session(4, 4, "job", "abandoned", { question_count: 3, answered_count: 1, abandoned_at: daysAgo(9), last_activity_at: daysAgo(9) }),
    // v4.2 A9: grading failed (2 of 3 answers) on another provider → "실패한 답변 2개 다시 채점"
    session(5, 3, "job", "evaluation_failed", {
      question_count: 3,
      answered_count: 3,
      submitted_at: daysAgo(1),
      last_activity_at: daysAgo(1),
      evaluation_provider: "openai",
      evaluation_model: MOCK_MODELS.openai.default,
    }),
    // Q53-9 질문 생성 입력 원인 실패: 요건 없음 → S-15 공고 원문 고치기 / 요건 있음 → S-15 안내
    session(6, 7, "job", "in_progress", { generation_status: "failed", question_provider: null, question_model: null, last_activity_at: daysAgo(1) }),
    session(13, 2, "culture_fit", "in_progress", { created_at: minutesAgo(60 * 6), generation_status: "failed", question_count: 3, question_provider: null, question_model: null, last_activity_at: minutesAgo(60 * 6) }),
    // Q53-9: 질문 0개인 그만둔 세션 — "질문을 만들지 못함", 면접 수에서 제외
    session(12, 7, "job", "abandoned", { created_at: daysAgo(3), generation_status: "failed", question_provider: null, question_model: null, abandoned_at: daysAgo(2), last_activity_at: daysAgo(2) }),
    // 04 §2.7.1 판정표 (ai_jobs 18~20, 22)
    gradedSession(7, 5, "evaluation_failed", 2, 1), // 입력 원인만 → 버튼 없음, 첫 열람에 표식 지움 (Q53-10)
    gradedSession(8, 5, "evaluation_failed", 3, 0), // 종합만 실패 → 종합 평가 다시 정리 (Q53-5)
    gradedSession(9, 5, "evaluation_failed", 3, 0), // 종합이 입력 원인 → 버튼 없음
    gradedSession(14, 5, "evaluation_failed", 3, 0), // 입력 원인 + 다른 원인 → 대상만 다시 채점 ({n} = 1)
    gradedSession(10, 4, "completed", 3, 0), // 완료 + 입력 원인 답변만 → 메뉴 없음, 답변에 원인
    gradedSession(11, 4, "completed", 3, 0), // 완료 + 대상 ≥ 1 → 실패한 답변 다시 채점 (Q53-6)
  ]

  const question = (n: number, sesN: number, sequence: number, text: string, kind: InterviewQuestion["source_kind"]): InterviewQuestion => ({
    ...base(IDS.q(n), 9),
    ...aiMeta(null),
    session_id: IDS.ses(sesN),
    sequence,
    source_kind: kind,
    anchor: kind === "values" || kind === "collaboration" ? "general" : "experience",
    question_text: text,
    intent: null,
    focus_criteria: [],
    target_requirement_ids: [],
    target_gap_requirement_ids: [],
    good_answer_signals: null,
    copied_from_question_id: null,
  })
  const interview_questions: InterviewQuestion[] = [
    question(1, 1, 1, "결제 승인 API 응답 시간을 줄일 때 병목을 어떻게 찾았나요?", "project_deep_dive"),
    question(2, 1, 2, "인덱스 재설계가 다른 쿼리에 준 영향은 어떻게 확인했나요?", "project_deep_dive"),
    question(3, 1, 3, "메시지 큐 기반 비동기 처리를 설계한다면 무엇부터 고려하겠어요?", "gap_probe"),
    question(4, 1, 4, "정산 배치를 재설계하며 데이터 정합성은 어떻게 지켰나요?", "requirement_fit"),
    question(5, 1, 5, "장애 상황에서 팀과 어떻게 협업했나요?", "collaboration"),
    question(6, 2, 1, "동료와 의견이 달랐던 경험을 말해 주세요.", "conflict"),
    question(7, 2, 2, "실패에서 배운 경험을 말해 주세요.", "failure_growth"),
    question(8, 2, 3, "일할 때 가장 중요하게 생각하는 가치는 무엇인가요?", "values"),
    // session 3 (채점 중) — so S-22 can show partial results (UQ-48)
    question(9, 3, 1, "주문·결제 서버에서 가장 어려웠던 장애를 어떻게 해결했나요?", "project_deep_dive"),
    question(10, 3, 2, "Spring 기반 서버를 설계할 때 무엇을 먼저 고려하나요?", "requirement_fit"),
    question(11, 3, 3, "AWS 운영 경험이 부족하다면 어떻게 보완하겠어요?", "gap_probe"),
    question(12, 5, 1, "플랫폼 팀에서 가장 먼저 개선하고 싶은 것은 무엇인가요?", "requirement_fit"),
    question(13, 5, 2, "배포 자동화를 도입하며 겪은 어려움을 말해 주세요.", "project_deep_dive"),
    question(14, 5, 3, "쿠버네티스 경험이 부족하다면 어떻게 보완하겠어요?", "gap_probe"),
    question(40, 4, 1, "가장 자신 있는 프로젝트에서 본인이 직접 한 일을 설명해 주세요.", "project_deep_dive"),
    question(41, 4, 2, "공고의 핵심 요건과 맞닿는 경험을 하나 들려주세요.", "requirement_fit"),
    question(42, 4, 3, "경험이 부족한 영역을 어떻게 보완하겠어요?", "gap_probe"),
    // 04 §2.7.1 판정표 세션: 세션마다 질문 3개 (15부터 3개씩, 세션 7 · 8 · 9 · 10 · 11 · 14 순서)
    ...GRADED_SESSIONS.flatMap((sesN, s) =>
      [0, 1, 2].map((i) => question(15 + s * 3 + i, sesN, i + 1, GRADED_QUESTIONS[i], i === 2 ? "gap_probe" : "project_deep_dive")),
    ),
  ]

  const answer = (n: number, qN: number, sesN: number, text: string, status: InterviewAnswer["status"], score: InterviewAnswer["score_status"] = null): InterviewAnswer => ({
    ...base(IDS.ans(n), 9, 0),
    session_id: IDS.ses(sesN),
    question_id: IDS.q(qN),
    answer_text: text,
    status,
    score_status: score,
    score_value: null,
    score_max: null,
    score_method_version: null,
    score_rationale: null,
  })
  const interview_answers: InterviewAnswer[] = [
    answer(1, 1, 1, "APM에서 p95 지표를 보고 결제 승인 테이블의 풀 스캔 쿼리를 찾았습니다.", "draft"),
    answer(2, 2, 1, "변경 전후로 슬로 쿼리 로그를 비교했습니다.", "draft"),
    answer(3, 3, 1, "", "draft"),
    answer(4, 4, 1, "", "draft"),
    answer(5, 5, 1, "", "draft"),
    answer(6, 6, 2, "코드 리뷰 기준을 두고 의견이 갈렸을 때 데이터를 모아 팀 회의에서 함께 정했습니다.", "submitted", "pending_method"),
    answer(7, 7, 2, "배포 체크리스트를 빠뜨려 장애가 났고, 이후 자동화된 배포 검증을 도입했습니다.", "submitted", "pending_method"),
    answer(8, 8, 2, "투명한 공유입니다. 문제를 일찍 알리면 팀 전체의 비용이 줄어듭니다.", "submitted", "pending_method"),
    answer(9, 9, 3, "결제 승인 지연 장애 때 APM으로 병목 쿼리를 찾아 인덱스를 바꿨습니다.", "submitted"),
    answer(10, 10, 3, "트랜잭션 경계와 장애 시 재시도 정책을 먼저 정합니다.", "submitted"),
    answer(11, 11, 3, "개인 프로젝트로 ECS 배포를 직접 해 보며 익히겠습니다.", "submitted"),
    answer(12, 12, 5, "배포 파이프라인의 수동 단계를 줄이는 것부터 하겠습니다.", "submitted", "pending_method"),
    answer(13, 13, 5, "사내 배포 도구를 만들며 서버별 설정 차이를 정리하는 일이 가장 어려웠습니다.", "submitted"),
    answer(14, 14, 5, "사이드 프로젝트로 클러스터를 직접 운영해 보며 익히겠습니다.", "submitted"),
    answer(40, 40, 4, "결제 승인 지연을 줄이려고 쿼리와 캐시 구조를 직접 바꿨습니다.", "draft"),
    answer(41, 41, 4, "", "draft"),
    answer(42, 42, 4, "", "draft"),
    ...GRADED_SESSIONS.flatMap((sesN, s) =>
      [0, 1, 2].map((i) => {
        const n = 15 + s * 3 + i
        const outcome = GRADED_OUTCOMES[sesN][i]
        if (outcome === "unanswered") return answer(n, n, sesN, "", "unanswered", "unanswered")
        return answer(n, n, sesN, GRADED_ANSWERS[i], "submitted", outcome === "ok" ? "pending_method" : "not_scored")
      }),
    ),
  ]

  const evaluation = (n: number, ansN: number): AnswerEvaluation => ({
    ...base(IDS.ev(n), 4),
    ...aiMeta(null),
    session_id: IDS.ses(2),
    answer_id: IDS.ans(ansN),
    status: "succeeded",
    error_code: null,
    result: {
      schema_version: 2,
      criteria: [
        { key: "specificity", grade: "good", reason: "상황과 본인 행동이 구체적입니다.", answer_quotes: [], missing: null },
        { key: "intent_fit", grade: "good", reason: "질문 의도에 맞게 답했습니다.", answer_quotes: [], missing: null },
        { key: "structure", grade: "fair", reason: "결과를 마지막에 한 번 더 정리하면 좋습니다.", answer_quotes: [], missing: "결과 요약" },
        { key: "job_relevance", grade: "not_applicable", reason: "컬처핏 질문이라 해당하지 않습니다.", answer_quotes: [], missing: null },
      ],
      strengths: [{ text: "본인 행동을 주어로 말했습니다.", answer_quotes: [] }],
      improvements: [{ item_key: "improvements.0", text: "결과를 수치나 변화로 마무리해 보세요.", how: "'그 뒤로 같은 유형의 장애가 0건이었습니다'처럼 끝맺어 보세요.", related_criteria: ["structure"] }],
      intent_reveal: "갈등을 다루는 방식과 협업 태도를 확인하려는 질문이었습니다.",
      model_answer: { text: "의견이 갈렸을 때 저는 먼저 근거 데이터를 모았습니다. [사례 입력 필요]", placeholders: [{ token: "[사례 입력 필요]", hint: "실제 합의 결과" }], suggestions_if_true: [] },
      consistency_notes: [],
      score: { status: "pending_method", value: null, max: null, method_version: null, rationale: null },
    },
  })
  const failedEvaluation = (n: number, ansN: number): AnswerEvaluation => ({
    ...evaluation(n, ansN),
    ...aiMeta(IDS.job(13)),
    session_id: IDS.ses(5),
    status: "failed",
    result: null,
  })
  const answer_evaluations: AnswerEvaluation[] = [
    evaluation(1, 6),
    evaluation(2, 7),
    evaluation(3, 8),
    { ...evaluation(4, 12), ...aiMeta(IDS.job(13)), session_id: IDS.ses(5) },
    failedEvaluation(5, 13),
    failedEvaluation(6, 14),
    ...GRADED_SESSIONS.flatMap((sesN, s) =>
      [0, 1, 2].flatMap((i): AnswerEvaluation[] => {
        const n = 15 + s * 3 + i
        const outcome = GRADED_OUTCOMES[sesN][i]
        if (outcome === "unanswered") return []
        const row: AnswerEvaluation = { ...evaluation(n, n), session_id: IDS.ses(sesN) }
        return [outcome === "ok" ? row : { ...row, status: "failed", result: null, error_code: outcome === "target" ? null : outcome }]
      }),
    ),
  ]

  const session_feedbacks: SessionFeedback[] = [
    {
      ...base(IDS.fb(1), 4),
      ...aiMeta(null),
      session_id: IDS.ses(2),
      status: "succeeded",
      result: {
        schema_version: 2,
        headline: "본인 행동을 분명히 말했지만, 결과로 마무리하는 연습이 필요합니다.",
        overall_strengths: [{ text: "상황을 구체적으로 설명합니다.", related_criteria: ["specificity"] }],
        overall_weaknesses: [{ text: "답변 끝에 결과 정리가 빠집니다.", related_criteria: ["structure"] }],
        next_practice: [{ type: "focus_session", text: "직무 면접 3문항으로 결과 중심 답변을 연습해 보세요.", interview_type: "job" }],
        unanswered_note: null,
      },
    },
    {
      ...base(IDS.fb(2), 1),
      ...aiMeta(IDS.job(13)),
      session_id: IDS.ses(5),
      status: "failed",
      result: null,
    },
    // 04 §2.7.1: 채점 실패 세션의 종합 행
    ...[7, 8, 9, 14].map(
      (sesN, i): SessionFeedback => ({ ...base(IDS.fb(3 + i), 1), ...aiMeta(null), session_id: IDS.ses(sesN), status: "failed", result: null }),
    ),
  ]

  // --- evidence links -------------------------------------------------------------
  const ev = (
    n: number,
    owner_type: EvidenceLink["owner_type"],
    owner_id: string,
    item_key: string,
    source_type: EvidenceLink["source_type"],
    source_id: string | null,
    source_field: string | null,
    quote: string | null,
    extra: Partial<EvidenceLink> = {},
  ): EvidenceLink => ({
    ...base(IDS.evl(n), 6),
    application_project_id: IDS.ap(1),
    owner_type,
    owner_id,
    item_key,
    sort_order: n,
    source_type,
    source_id,
    source_locator: null,
    source_field,
    quote,
    quote_adjusted: false,
    source_snapshot_at: daysAgo(6),
    source_deleted_at: null,
    source_label: null,
    ...extra,
  })
  const insightId = IDS.ins(1)
  const evidence_links: EvidenceLink[] = [
    // det1 was updated 3 days ago (> snapshot 6 days ago) → "변경됨"
    ev(1, "insight", insightId, `requirement_matches.${IDS.req(1)}`, "project_detail", IDS.det(1), "action", "APM으로 병목 쿼리를 찾아 결제 승인 테이블 인덱스를 재설계했고", { source_label: "결제 API 응답 속도 개선" }),
    ev(2, "insight", insightId, `requirement_matches.${IDS.req(1)}`, "achievement", IDS.ach(1), "metric", null, { source_label: "결제 승인 API p95 응답 시간" }),
    ev(3, "insight", insightId, `requirement_matches.${IDS.req(2)}`, "skill", IDS.skl(2), "name", null, { source_label: "Spring Boot", source_snapshot_at: daysAgo(1) }),
    ev(4, "insight", insightId, `requirement_matches.${IDS.req(3)}`, "project_detail", IDS.det(1), "result", "p95 응답 시간이 1.2초에서 0.7초로 줄었고", { source_label: "결제 API 응답 속도 개선" }),
    ev(5, "insight", insightId, `requirement_matches.${IDS.req(5)}`, "project_detail", IDS.det(3), "action", "배치를 이벤트 기반 스트리밍 처리로 바꾸고", { source_label: "정산 배치 처리 시간 단축", source_snapshot_at: daysAgo(1) }),
    ev(6, "insight", insightId, "strengths.0", "achievement", IDS.ach(1), "metric", null, { source_label: "결제 승인 API p95 응답 시간" }),
    ev(7, "insight", insightId, "strengths.0", "jd_requirement", IDS.req(1), null, null, { source_label: "대규모 결제 승인 API 설계·운영" }),
    ev(8, "insight", insightId, "gaps.0", "jd_sentence", null, null, null, { source_label: "Kafka 등 메시지 큐 기반 비동기 처리 경험을 우대합니다.", source_locator: { sid: "S5" } }),
    ev(9, "insight", insightId, "gaps.0.actions.1", "project_detail", IDS.det(3), "action", "실패 건 재시도 큐를 설계했습니다", { source_label: "정산 배치 처리 시간 단축", source_snapshot_at: daysAgo(1) }),
    ev(10, "insight", insightId, "strategy.positioning", "project_detail", IDS.det(1), "learnings", "성능 문제는 추측보다 측정에서 시작해야 한다는 것을 배웠습니다.", { source_label: "결제 API 응답 속도 개선" }),
    // deleted source → "원본 삭제됨" (quote null)
    ev(11, "insight", insightId, "strategy.positioning", "project", null, "summary", null, {
      source_label: "레거시 결제 모듈 이관",
      source_deleted_at: daysAgo(2),
    }),
    ev(12, "draft_section", IDS.dsec(1), "p1-b1", "achievement", IDS.ach(1), "metric", null, { source_label: "결제 승인 API p95 응답 시간" }),
    ev(13, "draft_section", IDS.dsec(1), "p2-b1", "project_detail", IDS.det(3), "action", "배치를 이벤트 기반 스트리밍 처리로 바꾸고", { source_label: "정산 배치 처리 시간 단축", source_snapshot_at: daysAgo(1) }),
    ev(14, "draft_section", IDS.dsec(1), "e1-s", "experience", IDS.exp(1), "summary", "결제 승인·정산 플랫폼 백엔드 개발과 운영", { source_label: "그린페이먼츠", source_snapshot_at: daysAgo(1) }),
    ev(15, "draft_section", IDS.dsec(2), "q1-p1", "achievement", IDS.ach(1), "metric", null, { source_label: "결제 승인 API p95 응답 시간" }),
    // v5.3 S-33 질문 근거 칩 (A4 request 3): owner interview_question (session 1)
    ev(16, "interview_question", IDS.q(1), "question", "project_detail", IDS.det(1), "action", "APM으로 병목 쿼리를 찾아 결제 승인 테이블 인덱스를 재설계했고", { source_label: "결제 API 응답 속도 개선" }),
    ev(17, "interview_question", IDS.q(1), "target_requirements", "jd_requirement", IDS.req(1), null, null, { source_label: "대규모 결제 승인 API 설계·운영" }),
    ev(18, "interview_question", IDS.q(3), "target_requirements", "jd_requirement", IDS.req(4), null, null, { source_label: "메시지 큐 기반 비동기 처리 경험" }),
  ]

  // --- AI 연결 (v4 BYOK): Gemini 무료 키 연결 + 활성 (05 brief) ----------------------
  const ai_provider_keys: AiProviderKey[] = [
    {
      ...base(IDS.usage(1), 20, 0),
      provider: "gemini",
      connection_tier: "free",
      key_ciphertext: "mock-ciphertext",
      key_nonce: "mock-nonce",
      wrapped_dek: "mock-dek",
      kek_id: "mock-kek-1",
      encryption_version: 1,
      key_last4: "1a2b",
      status: "valid",
      last_verified_at: minutesAgo(60 * 3),
      last_failure_cause: null,
      last_failure_at: null,
    },
  ]
  const ai_data_use_consents: AiDataUseConsent[] = [
    {
      ...base(IDS.usage(2), 20),
      provider: "gemini",
      connection_tier: "free",
      disclosure_version: DISCLOSURE_VERSION,
      free_tier_acknowledged: true,
      agreed_at: daysAgo(20),
      withdrawn_at: null,
    },
  ]
  // this month's token records (S-42) — tokens/costs are mock values
  const period = currentPeriodMonth()
  const rec = (
    n: number,
    feature: AiUsageRecord["feature"],
    job_type: AiUsageRecord["job_type"],
    input_tokens: number,
    output_tokens: number,
    cost: number,
    daysBack: number,
    outcome: AiUsageRecord["outcome"] = "succeeded",
  ): AiUsageRecord => ({
    id: IDS.usage(100 + n),
    user_id: u,
    created_at: daysAgo(daysBack),
    occurred_at: daysAgo(daysBack),
    period_month: period,
    feature,
    job_type,
    ai_job_id: null,
    call_key: `${feature}.${n}`,
    application_project_id: IDS.ap(1),
    provider: "gemini",
    model: MOCK_MODELS.gemini.default,
    model_tier: "default",
    connection_tier: "free",
    input_tokens,
    cached_input_tokens: 0,
    cache_write_tokens: 0,
    output_tokens,
    reasoning_tokens: null,
    usage_source: "provider_reported",
    outcome,
    error_code: outcome === "failed" ? "rate_limited" : null,
    price_table_version: PRICE_TABLE_VERSION,
    estimated_cost_usd: cost,
  })
  const ai_usage_records: AiUsageRecord[] = [
    rec(1, "key_verification", "key_verification", 20, 5, 0.00002, 20),
    rec(2, "jd_extraction", "jd_extraction", 3_500, 900, 0.0011, 6),
    rec(3, "insight", "insight", 11_500, 2_400, 0.0095, 6),
    rec(4, "insight", "insight", 11_200, 2_600, 0.0099, 6),
    rec(5, "career_description", "career_description", 10_500, 5_100, 0.0159, 5),
    rec(6, "cover_letter", "cover_letter", 9_000, 2_200, 0.0082, 3),
    rec(7, "interview_questions", "interview_questions", 8_100, 2_000, 0.0074, 4),
    rec(8, "interview_evaluation", "interview_evaluation", 11_500, 3_000, 0.0110, 4),
    rec(9, "interview_evaluation", "interview_evaluation", 11_400, 2_900, 0.0107, 4),
    rec(10, "writing_chat", "writing_chat_turn", 4_000, 600, 0.0027, 1),
    rec(11, "writing_chat", "writing_chat_turn", 4_200, 0, 0.0013, 1, "failed"),
  ]

  return {
    user: { id: u, email: "jiwoo.kim@example.com" },
    profiles: [
      {
        id: u,
        display_name: "김지우",
        desired_job_title: "결제 백엔드 엔지니어",
        total_years_of_experience: 7,
        interested_industries: ["핀테크", "커머스"],
        career_data_updated_at: daysAgo(1),
        active_ai_provider: "gemini",
        last_active_at: minutesAgo(5),
        inactivity_notice_sent_at: null,
        created_at: daysAgo(120),
        updated_at: daysAgo(30),
      },
    ],
    consents: [
      { ...base(IDS.con(1), 120), consent_type: "terms", policy_version: POLICY_VERSION, agreed: true, agreed_at: daysAgo(120), withdrawn_at: null, user_agent_hash: null },
      { ...base(IDS.con(2), 120), consent_type: "privacy_required", policy_version: POLICY_VERSION, agreed: true, agreed_at: daysAgo(120), withdrawn_at: null, user_agent_hash: null },
      { ...base(IDS.con(3), 120), consent_type: "cross_border_transfer", policy_version: POLICY_VERSION, agreed: true, agreed_at: daysAgo(120), withdrawn_at: null, user_agent_hash: null },
    ],
    policy_versions: (["terms", "privacy", "cross_border_transfer"] as const).map((policy_type, i) => ({
      id: `00000000-0000-4d05-8000-00000000000${i + 1}`,
      policy_type,
      version: POLICY_VERSION,
      effective_at: `${POLICY_VERSION}T00:00:00.000Z`,
      requires_reconsent: false,
      document_path: `policies/${policy_type}/${POLICY_VERSION}.md`,
      created_at: "2026-03-25T00:00:00.000Z",
    })),
    experiences,
    educations,
    projects,
    project_details,
    achievements,
    skills,
    project_skills,
    writing_chats,
    writing_chat_messages,
    application_projects,
    application_stage_events,
    job_descriptions,
    jd_requirements,
    insights,
    drafts,
    draft_sections,
    draft_section_sources,
    interview_sessions,
    interview_questions,
    interview_answers,
    answer_evaluations,
    session_feedbacks,
    evidence_links,
    ai_jobs,
    ai_provider_keys,
    ai_data_use_consents,
    ai_usage_records,
    ai_price_tables: mockPriceTables(),
    ai_disclosures: mockDisclosures(),
    mock_controls: defaultMockControls(),
    mock_chat_turns: {},
    service_status: { affected_providers: [] },
  }
}
