import type { WritingChatMessageRow, WritingChatProjectInput, WritingChatTurnInput } from "../../context-pack/writing-chat";
import type { Ai12ExtractOutput } from "../../schemas/AI-12";

/**
 * Synthetic AI-12 v4.5 conversations (no real people, companies, or résumés).
 * Every chat belongs to one affiliated project (CR-5·CR-6). Message ids are
 * fake UUIDs "00000000-0000-4000-8000-0000000000NN" where NN is the sequence,
 * so tests can map M{n} → id.
 */

export const CHAT_ID = "11111111-1111-4111-8111-111111111111";
export const EXP_ID = "22222222-2222-4222-8222-222222222201";
export const PROJECT_ID = "33333333-3333-4333-8333-333333333301";

export const GREETING =
  "'결제 승인 API 개선'을 함께 정리해 볼게요. 하나씩 여쭤보고, 정리한 내용은 왼쪽에 반영하기 전에 먼저 보여 드릴게요. 회사 기밀이나 민감한 개인정보는 적지 말아 주세요. 이 프로젝트는 어떤 상황에서 시작됐나요?";

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

/** An affiliated project with an empty STAR and no classification. */
export function emptyProject(overrides: Partial<WritingChatProjectInput> = {}): WritingChatProjectInput {
  return {
    id: PROJECT_ID,
    name: "결제 승인 API 개선",
    startMonth: null,
    endMonth: null,
    isCurrent: false,
    parent: { type: "experience", name: "에이비씨페이", status: "complete" },
    projectType: null,
    experienceType: null,
    competencies: [],
    situation: null,
    task: null,
    action: null,
    result: null,
    learnings: null,
    ...overrides,
  };
}

/** A project whose STAR is filled (v4.9: merged set, V-9h). */
export function filledProject(overrides: Partial<WritingChatProjectInput> = {}): WritingChatProjectInput {
  return emptyProject({
    startMonth: "2023-03-01",
    situation: "피크 시간에 결제 승인 API가 느려졌다",
    task: "응답 시간을 낮추는 것",
    action: "병목 쿼리를 찾아 인덱스를 재설계했다",
    result: "응답 시간이 줄었다",
    learnings: "측정을 먼저 해야 한다",
    ...overrides,
  });
}

export function baseInput(overrides: Partial<WritingChatTurnInput> = {}): WritingChatTurnInput {
  return {
    messages: rows([["assistant", GREETING]]),
    structuredDraft: {},
    lastExtractedSequence: 0,
    project: emptyProject(),
    desiredJobTitle: "백엔드 개발자",
    gate: null,
    requestedSlot: null,
    isFinalReply: false,
    ...overrides,
  };
}

const empty = (): Omit<Ai12ExtractOutput, "schema_version"> => ({
  project_patches: [],
  star_patches: [],
  classification_suggestions: { project_type: null, experience_type: null, competencies: null },
  clarifications: [],
  sensitive_flags: [],
});

export function output(partial: Partial<Ai12ExtractOutput> = {}): Ai12ExtractOutput {
  return { schema_version: 3, ...empty(), ...partial };
}

// ---------- Scenario 1: cooperative user ----------

export const cooperative = {
  messages: rows([
    ["assistant", GREETING],
    ["user", "23년 3월부터 했어요. 결제 승인 API가 피크 시간에 느려져서 결제 실패 문의가 많았어요."],
    ["assistant", "그 안에서 본인이 직접 한 일은 무엇인가요?"],
    ["user", "제가 APM으로 병목 쿼리를 찾아서 인덱스를 다시 설계했어요."],
  ]),
  output: output({
    project_patches: [{ field: "start_month", op: "set", value: "2023-03", source_message_ids: ["M2"], source_quotes: ["23년 3월부터 했어요"] }],
    star_patches: [
      {
        field: "situation",
        op: "set",
        value: "결제 승인 API가 피크 시간에 느려져 결제 실패 문의가 많았다",
        source_message_ids: ["M2"],
        source_quotes: ["결제 승인 API가 피크 시간에 느려져서 결제 실패 문의가 많았어요"],
      },
      {
        field: "action",
        op: "set",
        value: "APM으로 병목 쿼리를 찾아 인덱스를 재설계했다",
        source_message_ids: ["M4"],
        source_quotes: ["APM으로 병목 쿼리를 찾아서 인덱스를 다시 설계했어요"],
      },
    ],
    classification_suggestions: {
      project_type: { value: "improvement", source_message_ids: ["M4"], reason: "기존 결제 API의 성능을 개선한 작업" },
      experience_type: { value: "problem_solving", source_message_ids: ["M2", "M4"], reason: "병목을 찾아 해결한 경험" },
      competencies: { value: ["problem_solving", "analysis"], source_message_ids: ["M4"], reason: null },
    },
  }),
};

// ---------- Scenario 2: everything at once ----------

export const allAtOnce = {
  messages: rows([
    ["assistant", GREETING],
    [
      "user",
      "배치가 매일 새벽 4시간씩 걸려서 아침 정산 리포트가 늦게 나왔어요. 목표는 1시간 안에 끝내는 거였고, 제가 Kafka로 이벤트를 받아 증분 처리하도록 바꿨어요. 결국 4시간에서 50분으로 줄었고, 처음부터 데이터 양을 측정했어야 했다는 걸 배웠어요.",
    ],
  ]),
  output: output({
    star_patches: [
      { field: "situation", op: "set", value: "배치가 매일 새벽 4시간씩 걸려 아침 정산 리포트가 늦게 나왔다", source_message_ids: ["M2"], source_quotes: ["배치가 매일 새벽 4시간씩 걸려서 아침 정산 리포트가 늦게 나왔어요"] },
      { field: "task", op: "set", value: "배치를 1시간 안에 끝내는 것", source_message_ids: ["M2"], source_quotes: ["목표는 1시간 안에 끝내는 거였고"] },
      { field: "action", op: "set", value: "Kafka로 이벤트를 받아 증분 처리하도록 바꿨다", source_message_ids: ["M2"], source_quotes: ["제가 Kafka로 이벤트를 받아 증분 처리하도록 바꿨어요"] },
      { field: "result", op: "set", value: "배치 시간이 4시간에서 50분으로 줄었다", source_message_ids: ["M2"], source_quotes: ["결국 4시간에서 50분으로 줄었고"] },
      { field: "learnings", op: "set", value: "처음부터 데이터 양을 측정했어야 했다", source_message_ids: ["M2"], source_quotes: ["처음부터 데이터 양을 측정했어야 했다는 걸 배웠어요"] },
    ],
  }),
};

// ---------- Scenario 3: "우리 팀" ----------

export const teamSubject = {
  messages: rows([
    ["assistant", GREETING],
    ["user", "저희 팀이 Redis 캐시를 붙여서 조회가 빨라졌어요."],
  ]),
  output: output({
    star_patches: [
      // The model wrongly drops the subject and claims it as the user's action.
      { field: "action", op: "set", value: "Redis 캐시를 붙여 조회 속도를 높였다", source_message_ids: ["M2"], source_quotes: ["저희 팀이 Redis 캐시를 붙여서 조회가 빨라졌어요"] },
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
    star_patches: [
      { field: "result", op: "set", value: "배포 시간이 크게 줄었다", source_message_ids: ["M2"], source_quotes: ["배포 시간이 확 줄었어요"] },
      // The model invents a number anyway → V-9c.
      { field: "result", op: "append", value: "배포 시간이 30분에서 10분으로 줄었다", source_message_ids: ["M2"], source_quotes: ["배포 시간이 확 줄었어요"] },
    ],
    clarifications: [{ kind: "number_vague", field: "result", note: "정도 표현만 있음" }],
  }),
};

// ---------- Scenario 5: sensitive information ----------

export const sensitive = {
  messages: rows([
    ["assistant", GREETING],
    ["user", "그 무렵 우울증 치료를 받느라 3개월 쉬었다가 복귀해서 결제 모듈 리팩터링을 맡았어요. 김민수 팀장님이 리뷰를 해 주셨어요."],
  ]),
  output: output({
    star_patches: [
      { field: "situation", op: "set", value: "우울증 치료로 3개월 쉬었다가 복귀했다", source_message_ids: ["M2"], source_quotes: ["우울증 치료를 받느라 3개월 쉬었다가 복귀해서"] },
      { field: "action", op: "set", value: "결제 모듈 리팩터링을 맡았다", source_message_ids: ["M2"], source_quotes: ["결제 모듈 리팩터링을 맡았어요"] },
      { field: "task", op: "set", value: "김민수 팀장의 리뷰를 받았다", source_message_ids: ["M2"], source_quotes: ["김민수 팀장님이 리뷰를 해 주셨어요"] },
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
    star_patches: [
      { field: "result", op: "set", value: "추천 클릭률이 개선되었다", source_message_ids: ["M4"], source_quotes: ["알아서 그럴듯하게 채워 주세요"] },
      // Sourcing the AI's own question is V-9a.
      { field: "task", op: "set", value: "수치로 결과를 확인", source_message_ids: ["M3"], source_quotes: ["수치로 알고 있는 게 있나요"] },
    ],
  }),
};

// ---------- Scenario 7: filled project — merged set (v4.9 RQ-5) ----------

export const filledAppend = {
  messages: rows([
    ["assistant", GREETING],
    ["user", "결과에 덧붙이면, 결제 실패 문의도 절반으로 줄었어요. 시작은 22년 1월이었어요."],
  ]),
  /** v6 extract: a merged set (form value "응답 시간이 줄었다" + the new sentence, -음 체); the period is V-9h. */
  output: output({
    project_patches: [{ field: "start_month", op: "set", value: "2022-01", source_message_ids: ["M2"], source_quotes: ["시작은 22년 1월이었어요"] }],
    star_patches: [
      { field: "result", op: "set", value: "응답 시간이 줄었고 결제 실패 문의도 절반으로 줄었음", source_message_ids: ["M2"], source_quotes: ["결제 실패 문의도 절반으로 줄었어요"] },
    ],
  }),
  /** v5-style output (old prompt / retry): an append with the new sentence only — still accepted. */
  legacyOutput: output({
    star_patches: [
      { field: "result", op: "append", value: "결제 실패 문의도 절반으로 줄었다", source_message_ids: ["M2"], source_quotes: ["결제 실패 문의도 절반으로 줄었어요"] },
    ],
  }),
};
