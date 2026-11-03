import type { DeliverableChatTurnInput, DeliverableParentProject } from "../../context-pack/deliverable-chat";
import type { WritingChatMessageRow } from "../../context-pack/writing-chat";
import type { Ai13BlockOutput, Ai13ComposeOutput, Ai13ExtractOutput } from "../../schemas/AI-13";
import type { StoredFact } from "../../schemas/deliverable-draft";

/**
 * Synthetic AI-13 deliverable chats (no real people, companies, or documents).
 * Message ids are fake UUIDs "00000000-0000-4000-8000-0000000000NN" (NN =
 * sequence); fact ids "aaaaaaaa-0000-4000-8000-0000000000NN" (NN = index + 1).
 */

export const DELIVERABLE_ID = "44444444-4444-4444-8444-444444444401";
export const PROJECT_ID = "33333333-3333-4333-8333-333333333399";

export const GREETING =
  "'결제 장애 회고'을 회고로 정리해 볼게요. 회고하려는 일은 무엇이었나요? 기간과 범위를 알려 주세요. 회사 기밀, 민감정보, 다른 사람의 개인정보는 쓰지 말아 주세요.";

export function msgId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

export function factId(n: number): string {
  return `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function rows(turns: readonly (readonly ["user" | "assistant", string])[]): WritingChatMessageRow[] {
  return turns.map(([role, content], i) => ({ id: msgId(i + 1), sequence: i + 1, role, content, status: "done" }));
}

export function parentProject(overrides: Partial<DeliverableParentProject> = {}): DeliverableParentProject {
  return {
    id: PROJECT_ID,
    name: "간편결제 서비스",
    startMonth: "2023-01-01",
    endMonth: "2023-12-01",
    isCurrent: false,
    role: "결제 백엔드 담당",
    description: "간편결제 서비스의 결제 승인 모듈을 맡았다. 제가 장애 대응 절차를 정리했다.",
    skills: ["Kotlin", "Kafka"],
    ...overrides,
  };
}

export function fact(n: number, overrides: Partial<StoredFact> = {}): StoredFact {
  return {
    id: factId(n),
    slot: "contribution",
    text: "결제 모듈의 장애 대응 런북을 직접 작성했다",
    actor: "self",
    source_message_ids: [msgId(2)],
    source_quotes: ["장애 대응 런북은 제가 직접 썼어요"],
    review: "ok",
    reviewed_at: null,
    origin: "ai",
    ...overrides,
  };
}

/** Two usable facts: F1 contribution (self), F2 went_well (team) with a number. */
export function twoFacts(): StoredFact[] {
  return [
    fact(1),
    fact(2, {
      slot: "went_well",
      text: "배포 후 하루 장애 알림이 40건에서 10건으로 줄었다",
      actor: "team",
      source_message_ids: [msgId(4)],
      source_quotes: ["저희 팀 배포 후에 하루 장애 알림이 40건에서 10건으로 줄었어요"],
    }),
  ];
}

export function storedDraft(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    target: "project_deliverable",
    writing_kind: "retrospective",
    facts: [] as StoredFact[],
    deliverable: {},
    clarifications: [],
    sensitive_flags_count: 0,
    draft_count: 0,
    ...overrides,
  };
}

export const SAY_1 = "결제 장애가 반복돼서 회고를 쓰려고 해요. 장애 대응 런북은 제가 직접 썼어요.";
export const SAY_2 = "저희 팀 배포 후에 하루 장애 알림이 40건에서 10건으로 줄었어요.";

export function baseInput(overrides: Partial<DeliverableChatTurnInput> = {}): DeliverableChatTurnInput {
  return {
    messages: rows([
      ["assistant", GREETING],
      ["user", SAY_1],
    ]),
    structuredDraft: storedDraft(),
    lastExtractedSequence: 1,
    deliverable: { id: DELIVERABLE_ID, title: "결제 장애 회고", body: "" },
    formSnapshot: null,
    project: parentProject(),
    siblingTitles: ["결제 승인 설계 문서"],
    desiredJobTitle: "백엔드 개발자",
    requestedSlot: null,
    requestedAction: null,
    style: null,
    isFinalReply: false,
    now: new Date("2026-11-03T00:00:00Z"),
    ...overrides,
  };
}

/** Input after two facts are stored (user said SAY_1 and SAY_2). */
export function factsInput(overrides: Partial<DeliverableChatTurnInput> = {}): DeliverableChatTurnInput {
  return baseInput({
    messages: rows([
      ["assistant", GREETING],
      ["user", SAY_1],
      ["assistant", "잘된 점은 무엇이었나요?"],
      ["user", SAY_2],
      ["assistant", "지금까지 내용으로 초안을 만들어 볼까요?"],
      ["user", "초안 써 줘"],
    ]),
    lastExtractedSequence: 5,
    structuredDraft: storedDraft({ facts: twoFacts() }),
    ...overrides,
  });
}

export function extractOutput(partial: Partial<Ai13ExtractOutput> = {}): Ai13ExtractOutput {
  return { schema_version: 1, writing_kind: null, intent: null, style: null, facts: [], clarifications: [], sensitive_flags: [], ...partial };
}

const noSources = { source_fact_ids: [] as string[], source_body_quotes: [] as string[], source_project_fields: [] as Ai13BlockOutput["source_project_fields"] };

export function heading(text: string, level = 2): Ai13BlockOutput {
  return { type: "heading", level, text, items: null, rows: null, basis: null, ...noSources };
}

export function paragraph(text: string, sources: Partial<typeof noSources> = {}, basis: "new" | "current_body" | null = "new"): Ai13BlockOutput {
  return { type: "paragraph", level: null, text, items: null, rows: null, basis, ...noSources, ...sources };
}

export function list(items: Array<{ text: string } & Partial<typeof noSources>>, type: "bullet_list" | "numbered_list" = "bullet_list"): Ai13BlockOutput {
  return { type, level: null, text: null, items: items.map((i) => ({ ...noSources, ...i })), rows: null, basis: "new", ...noSources };
}

export function table(rowsIn: Array<{ cells: string[] } & Partial<typeof noSources>>): Ai13BlockOutput {
  return { type: "table", level: null, text: null, items: null, rows: rowsIn.map((r) => ({ ...noSources, ...r })), basis: "new", ...noSources };
}

/** A good retrospective draft over twoFacts(). */
export function goodCompose(partial: Partial<Ai13ComposeOutput> = {}): Ai13ComposeOutput {
  return {
    schema_version: 1,
    writing_kind: "retrospective",
    replace_mode: true,
    blocks: [
      heading("내가 맡은 일"),
      paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.", { source_fact_ids: ["F1"] }),
      heading("잘된 점"),
      paragraph("팀이 배포한 뒤 하루 장애 알림이 40건에서 10건으로 줄었다.", { source_fact_ids: ["F2"] }),
    ],
    missing_slots: ["went_wrong", "learnings"],
    ...partial,
  };
}
