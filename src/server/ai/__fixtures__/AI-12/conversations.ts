import type { WritingChatMessageRow, WritingChatTurnInput } from "../../context-pack/writing-chat";
import type { Ai12ExtractOutput } from "../../schemas/AI-12";

/**
 * Synthetic AI-12 conversations (no real people, companies, or résumés).
 * Message ids are fake UUIDs "00000000-0000-4000-8000-0000000000NN" where NN
 * is the sequence, so tests can map M{n} → id.
 */

export const CHAT_ID = "11111111-1111-4111-8111-111111111111";
export const EXP_ID = "22222222-2222-4222-8222-222222222201";
export const EDU_ID = "22222222-2222-4222-8222-222222222202";
export const PROJECT_ID = "33333333-3333-4333-8333-333333333301";
export const DETAIL_DRAFT_ID = "44444444-4444-4444-8444-444444444401";
export const DETAIL_DONE_ID = "44444444-4444-4444-8444-444444444402";

export const GREETING =
  "안녕하세요. 질문에 답해 주시면 프로젝트와 상세 내용으로 정리해 드릴게요. 회사 기밀이나 민감한 개인정보는 적지 말아 주세요. 어떤 프로젝트였나요?";

export function msgId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

/** Builds rows from [role, content] pairs; sequence starts at 1 (greeting). */
export function rows(turns: readonly (readonly ["user" | "assistant", string])[], failed: number[] = []): WritingChatMessageRow[] {
  return turns.map(([role, content], i) => ({
    id: msgId(i + 1),
    sequence: i + 1,
    role,
    content,
    status: failed.includes(i + 1) ? "failed" : "done",
  }));
}

export function baseInput(overrides: Partial<WritingChatTurnInput> = {}): WritingChatTurnInput {
  return {
    mode: "new_project",
    messages: rows([["assistant", GREETING]]),
    structuredDraft: {},
    lastExtractedSequence: 0,
    affiliation: { experienceId: null, educationId: null, parentStatus: null },
    candidates: {
      experiences: [{ id: EXP_ID, companyName: "에이비씨페이", startMonth: "2021-03-01", endMonth: null, isCurrent: true }],
      educations: [{ id: EDU_ID, institutionName: "가나다대학교", programName: "컴퓨터공학", startMonth: "2015-03-01", endMonth: "2019-02-01" }],
    },
    augmentTarget: null,
    desiredJobTitle: "백엔드 개발자",
    gate: null,
    requestedSlot: null,
    isFinalReply: false,
    ...overrides,
  };
}

/** Augment target: one draft detail with title only, one complete detail. */
export function augmentTarget(): NonNullable<WritingChatTurnInput["augmentTarget"]> {
  return {
    project: { id: PROJECT_ID, name: "정산 배치 개편", role: "백엔드 개발", summary: null, startMonth: "2022-01-01", endMonth: null, teamSize: null },
    details: [
      { id: DETAIL_DRAFT_ID, status: "draft", sortOrder: 1, title: "정산 지연 해결", situation: null, task: null, action: null, result: null, learnings: null },
      {
        id: DETAIL_DONE_ID,
        status: "complete",
        sortOrder: 2,
        title: "배치 모니터링",
        situation: "배치 실패를 늦게 알았다",
        task: null,
        action: "실패 알림을 만들었다",
        result: "실패 인지가 빨라졌다",
        learnings: null,
      },
    ],
  };
}

const empty = (): Omit<Ai12ExtractOutput, "schema_version"> => ({
  project_patches: [],
  detail_patches: [],
  achievements: [],
  skills: [],
  new_details: [],
  affiliation_suggestion: null,
  clarifications: [],
  sensitive_flags: [],
});

export function output(partial: Partial<Ai12ExtractOutput> = {}): Ai12ExtractOutput {
  return { schema_version: 2, ...empty(), ...partial };
}

// ---------- Scenario 1: cooperative user ----------

export const cooperative = {
  messages: rows([
    ["assistant", GREETING],
    ["user", "에이비씨페이 다닐 때 결제 승인 API 성능 개선 프로젝트를 했어요. 23년 3월부터 했고 저는 백엔드 개발을 맡았어요."],
    ["assistant", "그때 어떤 상황이었나요?"],
    ["user", "결제 승인 API가 피크 시간에 느려져서 결제 실패 문의가 많았어요. 저 포함 4명이었어요."],
  ]),
  output: output({
    project_patches: [
      { field: "name", op: "set", value: "결제 승인 API 성능 개선", source_message_ids: ["M2"], source_quotes: ["결제 승인 API 성능 개선 프로젝트를 했어요"] },
      { field: "start_month", op: "set", value: "2023-03", source_message_ids: ["M2"], source_quotes: ["23년 3월부터 했고"] },
      { field: "role", op: "set", value: "백엔드 개발", source_message_ids: ["M2"], source_quotes: ["저는 백엔드 개발을 맡았어요"] },
      { field: "team_size", op: "set", value: 4, source_message_ids: ["M4"], source_quotes: ["저 포함 4명이었어요"] },
    ],
    new_details: [{ detail_key: "D1", source_message_ids: ["M4"] }],
    detail_patches: [
      {
        detail_key: "D1",
        detail_ref: null,
        field: "situation",
        op: "set",
        value: "결제 승인 API가 피크 시간에 느려져 결제 실패 문의가 많았다",
        source_message_ids: ["M4"],
        source_quotes: ["결제 승인 API가 피크 시간에 느려져서 결제 실패 문의가 많았어요"],
      },
    ],
    affiliation_suggestion: { type: "experience", ref: "EXP-1", source_message_ids: ["M2"], source_quotes: ["에이비씨페이 다닐 때"] },
  }),
};

// ---------- Scenario 2: everything at once ----------

export const allAtOnce = {
  messages: rows([
    ["assistant", GREETING],
    [
      "user",
      "정산 배치 개편 프로젝트였어요. 배치가 매일 새벽 4시간씩 걸려서 아침 정산 리포트가 늦게 나왔어요. 목표는 1시간 안에 끝내는 거였고, 제가 Kafka로 이벤트를 받아 증분 처리하도록 바꿨어요. 결국 4시간에서 50분으로 줄었고, 처음부터 데이터 양을 측정했어야 했다는 걸 배웠어요.",
    ],
  ]),
  output: output({
    project_patches: [{ field: "name", op: "set", value: "정산 배치 개편", source_message_ids: ["M2"], source_quotes: ["정산 배치 개편 프로젝트였어요"] }],
    new_details: [{ detail_key: "D1", source_message_ids: ["M2"] }],
    detail_patches: [
      { detail_key: "D1", detail_ref: null, field: "title", op: "set", value: "정산 배치 증분 처리 전환", source_message_ids: ["M2"], source_quotes: ["정산 배치 개편", "증분 처리하도록 바꿨어요"] },
      { detail_key: "D1", detail_ref: null, field: "situation", op: "set", value: "배치가 매일 새벽 4시간씩 걸려 아침 정산 리포트가 늦게 나왔다", source_message_ids: ["M2"], source_quotes: ["배치가 매일 새벽 4시간씩 걸려서 아침 정산 리포트가 늦게 나왔어요"] },
      { detail_key: "D1", detail_ref: null, field: "task", op: "set", value: "배치를 1시간 안에 끝내는 것", source_message_ids: ["M2"], source_quotes: ["목표는 1시간 안에 끝내는 거였고"] },
      { detail_key: "D1", detail_ref: null, field: "action", op: "set", value: "Kafka로 이벤트를 받아 증분 처리하도록 바꿨다", source_message_ids: ["M2"], source_quotes: ["제가 Kafka로 이벤트를 받아 증분 처리하도록 바꿨어요"] },
      { detail_key: "D1", detail_ref: null, field: "result", op: "set", value: "배치 시간이 4시간에서 50분으로 줄었다", source_message_ids: ["M2"], source_quotes: ["결국 4시간에서 50분으로 줄었고"] },
      { detail_key: "D1", detail_ref: null, field: "learnings", op: "set", value: "처음부터 데이터 양을 측정했어야 했다", source_message_ids: ["M2"], source_quotes: ["처음부터 데이터 양을 측정했어야 했다는 걸 배웠어요"] },
    ],
    achievements: [
      { detail_key: "D1", detail_ref: null, metric_name: "배치 소요 시간", value_before: 4, value_after: 50, unit: "분", source_message_ids: ["M2"], source_quotes: ["4시간에서 50분으로 줄었고"] },
    ],
    skills: [{ value: "Kafka", source_message_ids: ["M2"], source_quotes: ["Kafka로 이벤트를 받아"] }],
  }),
};

// ---------- Scenario 3: "우리 팀" ----------

export const teamSubject = {
  messages: rows([
    ["assistant", GREETING],
    ["user", "주문 서비스 캐시 도입 프로젝트였어요."],
    ["assistant", "그 과제에서 본인이 직접 한 일은 무엇인가요?"],
    ["user", "저희 팀이 Redis 캐시를 붙여서 조회가 빨라졌어요."],
  ]),
  output: output({
    detail_patches: [
      // The model wrongly drops the subject and claims it as the user's action.
      { detail_key: "D1", detail_ref: null, field: "action", op: "set", value: "Redis 캐시를 붙여 조회 속도를 높였다", source_message_ids: ["M4"], source_quotes: ["저희 팀이 Redis 캐시를 붙여서 조회가 빨라졌어요"] },
    ],
  }),
};

// ---------- Scenario 4: unknown numbers ----------

export const unknownNumbers = {
  messages: rows([
    ["assistant", GREETING],
    ["user", "배포 자동화를 했어요. 배포 시간이 확 줄었어요. 정확한 수치는 몰라요."],
  ]),
  output: output({
    new_details: [{ detail_key: "D1", source_message_ids: ["M2"] }],
    detail_patches: [
      { detail_key: "D1", detail_ref: null, field: "result", op: "set", value: "배포 시간이 크게 줄었다", source_message_ids: ["M2"], source_quotes: ["배포 시간이 확 줄었어요"] },
    ],
    // The model invents a number anyway → V-9c.
    achievements: [
      { detail_key: "D1", detail_ref: null, metric_name: "배포 시간", value_before: 30, value_after: 10, unit: "분", source_message_ids: ["M2"], source_quotes: ["배포 시간이 확 줄었어요"] },
    ],
    clarifications: [{ kind: "number_vague", field: "result", detail_key: "D1", detail_ref: null, note: "정도 표현만 있음" }],
  }),
};

// ---------- Scenario 5: sensitive information ----------

export const sensitive = {
  messages: rows([
    ["assistant", GREETING],
    ["user", "그 무렵 우울증 치료를 받느라 3개월 쉬었다가 복귀해서 결제 모듈 리팩터링을 맡았어요. 김민수 팀장님이 리뷰를 해 주셨어요."],
  ]),
  output: output({
    new_details: [{ detail_key: "D1", source_message_ids: ["M2"] }],
    detail_patches: [
      { detail_key: "D1", detail_ref: null, field: "situation", op: "set", value: "우울증 치료로 3개월 쉬었다가 복귀했다", source_message_ids: ["M2"], source_quotes: ["우울증 치료를 받느라 3개월 쉬었다가 복귀해서"] },
      { detail_key: "D1", detail_ref: null, field: "action", op: "set", value: "결제 모듈 리팩터링을 맡았다", source_message_ids: ["M2"], source_quotes: ["결제 모듈 리팩터링을 맡았어요"] },
      { detail_key: "D1", detail_ref: null, field: "task", op: "set", value: "김민수 팀장의 리뷰를 받았다", source_message_ids: ["M2"], source_quotes: ["김민수 팀장님이 리뷰를 해 주셨어요"] },
    ],
    sensitive_flags: [{ category: "health", message_id: "M2" }],
  }),
};

// ---------- Scenario 6: "알아서 채워 줘" ----------

export const delegation = {
  messages: rows([
    ["assistant", GREETING],
    ["user", "추천 시스템 개선 프로젝트였어요."],
    ["assistant", "결과는 어땠나요? 수치로 알고 있는 게 있나요?"],
    ["user", "기억이 잘 안 나요. 알아서 그럴듯하게 채워 주세요."],
  ]),
  lastExtractedSequence: 2,
  output: output({
    new_details: [{ detail_key: "D1", source_message_ids: ["M4"] }],
    detail_patches: [
      { detail_key: "D1", detail_ref: null, field: "result", op: "set", value: "추천 클릭률이 개선되었다", source_message_ids: ["M4"], source_quotes: ["알아서 그럴듯하게 채워 주세요"] },
      // Sourcing the AI's own question is V-9a.
      { detail_key: "D1", detail_ref: null, field: "task", op: "set", value: "수치로 결과를 확인", source_message_ids: ["M3"], source_quotes: ["수치로 알고 있는 게 있나요"] },
    ],
  }),
};
