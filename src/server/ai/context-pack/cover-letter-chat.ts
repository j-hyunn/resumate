import type { CountBasis, QuestionClass } from "@/lib/contracts/enums";
import { WHOLE_SOURCE_FIELD } from "../evidence-rules";
import type { AiTextBlock } from "../providers/types";
import type { SensitiveCategory } from "../schemas/AI-12";
import { COVER_LETTER_DRAFT_LIMIT, parseCoverLetterDraft, type CoverLetterDraft, type CoverLetterFact } from "../schemas/cover-letter-draft";
import { escBlock, escLine } from "../prompts/drafts-common";
import { literalAliasTokens } from "../validation/alias-text";
import { buildTermCorpus, type DraftCheckEnv } from "../validation/draft-blocks";
import { buildAllowedNumbers } from "../validation/numbers";
import { detectSensitive, isDelegationRequest, type V9Message } from "../validation/v9";
import { AliasMap } from "./aliases";
import { buildCareerPack, type CareerPack } from "./career-pack";
import type { CareerRows } from "./career-rows";
import { bodyForModel, bodyHash, charLength, esc, factAlias, isComposeRequest, type BodyForModel } from "./deliverable-chat";
import { buildJdContext, type JdRequirementInput, type JdSentence } from "./jd";
import type { YearMonth } from "./months";
import { sourceLabel } from "./selection";
import type { WritingChatMessageRow } from "./writing-chat";

/**
 * AI-04 자소서 문항 답변 작성 AI 채팅 — 입력 컨텍스트 (AI spec v4.15 AI-04,
 * C-1·C-2·C-15, DM 2.5.0b·2.7.3).
 *
 * | 원천 | 쓰는 호출 |
 * |------|-----------|
 * | 커리어 컨텍스트 팩 **전체** (`EXP`·`EDU`·`PRJ`·`DLV`·`SKL`) | extract(참조 없음) · reply · compose |
 * | JD 요건 (`REQ-n`) + 회사·직무 소개 문장 (`S-n`) | reply · compose |
 * | 문항 정의와 **지금 답변**(`form_snapshot` 우선, 없으면 정본) | reply · compose |
 * | 문항 메모 (`NOTE-{문항 번호}`) | reply · compose |
 * | 대화 메시지 (`M{sequence}`) · 정리된 사실 (`F{n}`) | extract · reply · compose |
 *
 * **(CL-Q1, 확정 2026-11-08) RAG 전까지 모든 턴에 전체 팩.** 커리어 컨텍스트
 * 조립은 이 파일의 `buildCareerPack` 호출 **한 지점**뿐이다 — 서류 턴이 팩을
 * 우회 조립하지 않는다. 조각 단위 검색(RAG)으로 갈 때도 조각마다 같은 출처
 * 별칭을 달아 V-* 근거 검증이 그대로 돌아야 한다. 요약형 팩·조건부 안은
 * 구현하지 않는다 (AI 명세 C-1.1은 채택하지 않은 (a)의 기록이다).
 */

// ---------------------------------------------------------------------------
// 상한 (CF-5, CL-10, C-14, DM 2.5.1)
// ---------------------------------------------------------------------------

/** CF-5: 문항 최대 5개. */
export const MAX_QUESTIONS = 5;
/** CL-10: 초안 턴 1회에 문항 ≤ 3개. */
export const MAX_QUESTIONS_PER_DRAFT_TURN = 3;
/**
 * [가정] AI-04 "문항 글자 수 제한 합계가 3,000자를 넘으면 서버가 턴당 2문항으로
 * 줄인다" — 한 호출의 출력이 커져 지연·절단 위험이 커지기 때문이다.
 */
export const DRAFT_TURN_CHAR_LIMIT_SUM = 3000;
export const REDUCED_QUESTIONS_PER_DRAFT_TURN = 2;
/** DM 2.5.1: 메모 ≤ 300자, 문항 문구 ≤ 1,000자, 본문 ≤ 8,000자. */
export const USER_NOTE_MAX = 300;
export const QUESTION_TEXT_MAX = 1000;
export const ANSWER_BODY_MAX = 8000;
/** [가정] 모델에 넣는 다른 문항 본문 요약 길이 (토큰 보호). */
export const OTHER_ANSWER_PREVIEW_CHARS = 200;

// ---------------------------------------------------------------------------
// inputs (the runner loads these)
// ---------------------------------------------------------------------------

/** 정본 `application_documents.body.questions[]` 원소 (DM 2.7.3). */
export type CoverLetterQuestionRow = {
  slot: string;
  question_id: string;
  question_text: string;
  /** null = 사용자 추가 문항 (모델이 `question_class`를 정한다). */
  template_key: QuestionClass | null;
  char_limit: number | null;
  count_basis: CountBasis;
  user_note: string | null;
  user_note_updated_at?: string | null;
  answer_title: string | null;
  /** 지금 답변 본문. */
  body: string;
};

/**
 * S-46 폼 스냅숏 (턴 요청 `form_snapshot`, 저장·로그에 남기지 않는다):
 * `{questions:[{slot, question_text, char_limit, count_basis, user_note, answer_title, body}]}`.
 * 정본에 없는 슬롯은 무시한다 (문항을 만드는 길은 저장 RPC뿐이다).
 */
export type CoverLetterFormSnapshot = {
  questions?: ReadonlyArray<{
    slot: string;
    question_text?: string | null;
    char_limit?: number | null;
    count_basis?: CountBasis | null;
    user_note?: string | null;
    answer_title?: string | null;
    body?: string | null;
  }>;
};

export type CoverLetterJdInput = {
  jobDescriptionId: string;
  jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];
  /** `job_descriptions.extraction.other_sids` (회사·직무 소개 문장). */
  companySids: readonly string[];
  requirements: readonly JdRequirementInput[];
  positionTitle: string | null;
};

export type CoverLetterInsightSignal = {
  strengths: ReadonlyArray<{ title: string; description: string }>;
  positioning: string | null;
} | null;

export type CoverLetterChatTurnInput = {
  messages: readonly WritingChatMessageRow[];
  /** `writing_chats.structured_draft` (cover_letter shape). */
  structuredDraft: unknown;
  lastExtractedSequence: number;
  /** 정본 문항 (저장된 순서). */
  questions: readonly CoverLetterQuestionRow[];
  formSnapshot?: CoverLetterFormSnapshot | null;
  careerRows: CareerRows;
  asOf?: YearMonth;
  jd: CoverLetterJdInput;
  insightSignal?: CoverLetterInsightSignal;
  /** 턴 요청: 이 문항만 / 이 문항부터. */
  requestedSlot?: string | null;
  /** 턴 요청 `requested_action`. */
  requestedAction?: "compose_draft" | null;
  /** 칩 "이 문항만"·"남은 문항": 사용자가 고른 대상 문항. */
  requestedSlots?: readonly string[] | null;
  /** 칩 "글자 수 맞춰 줘" / "더 간결하게". */
  style?: "fit_length" | "shorter" | null;
  /** 이 응답이 대화의 마지막 메시지(40번째)다. */
  isFinalReply?: boolean;
  now?: Date;
};

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------

/** 한 문항의 턴 컨텍스트 (정본 + 폼 스냅숏을 합친 값). */
export type CoverLetterQuestionContext = {
  slot: string;
  questionId: string;
  /** 1-based position in the document (문항 번호, 화면 문구와 같은 번호). */
  index: number;
  questionText: string;
  templateKey: QuestionClass | null;
  charLimit: number | null;
  countBasis: CountBasis;
  userNote: string | null;
  userNoteUpdatedAt: string | null;
  answerTitle: string | null;
  /** 지금 답변 본문 (스냅숏 우선). */
  body: string;
  bodyForModel: BodyForModel;
  baseBodyHash: string;
  charCount: number;
  /** 본문이 비어 있다 (제목만 있는 문항도 "비어 있음"으로 센다 — 저장 RPC와 같은 규칙). */
  empty: boolean;
  /** `NOTE-{index}` or null when the question has no note. */
  noteAlias: string | null;
  valueSource: "form_snapshot" | "db";
};

export type CoverLetterChatContext = {
  input: CoverLetterChatTurnInput;
  draft: CoverLetterDraft;
  questions: CoverLetterQuestionContext[];
  bySlot: ReadonlyMap<string, CoverLetterQuestionContext>;
  pack: CareerPack;
  aliases: AliasMap;
  /** V-1..V-5 환경 (문항별 scope는 compose 단계에서 더한다). */
  env: DraftCheckEnv;
  packText: string;
  jdText: string;
  referenceText: string | null;
  careerSnapshotHash: string;
  requirementsHash: string;
  /** usable facts by alias (`F{n}` over draft.facts). */
  factAliases: ReadonlyMap<string, CoverLetterFact>;
  messages: ReadonlyMap<string, V9Message>;
  messageAliasById: ReadonlyMap<string, string>;
  pendingAliases: ReadonlySet<string>;
  processThroughSequence: number | null;
  draftCount: number;
  draftLimitReached: boolean;
  tone: "concise" | "detailed" | null;
  sensitiveNotice: SensitiveCategory[];
  delegationRequested: boolean;
  composeRequested: "requested_action" | "text" | null;
  lastMessage: boolean;
  /** 프롬프트 공통 접두 블록 (C-8 캐시 순서): pack → jd → reference. */
  sharedBlocks: AiTextBlock[];
  /** 대화 블록 (<chat> + messages), extract·reply만 쓴다. */
  chatBlocks: AiTextBlock[];
};

function clip(text: string | null | undefined, max: number): string | null {
  if (text === null || text === undefined) return null;
  const t = text.trim();
  if (t === "") return null;
  const chars = Array.from(t);
  return chars.length > max ? chars.slice(0, max).join("") : t;
}

/** `NOTE-{문항 번호}` [가정]: 한 턴에 문항이 여러 개이므로 메모 별칭도 문항마다 둔다. */
export function noteAlias(index: number): string {
  return `NOTE-${index}`;
}

/** 정본 문항 + 폼 스냅숏 → 턴이 쓰는 문항 값. 스냅숏이 우선이고 없는 칸만 정본을 쓴다 (S-46). */
export function mergeQuestions(
  rows: readonly CoverLetterQuestionRow[],
  snapshot: CoverLetterFormSnapshot | null | undefined,
): Array<CoverLetterQuestionRow & { valueSource: "form_snapshot" | "db" }> {
  const snap = new Map((snapshot?.questions ?? []).filter((q) => typeof q?.slot === "string").map((q) => [q.slot, q]));
  return rows.slice(0, MAX_QUESTIONS).map((row) => {
    const s = snap.get(row.slot);
    if (!s) return { ...row, valueSource: "db" as const };
    // 스냅숏에 **있는 키**가 이긴다 — 명시적 null은 "사용자가 지웠다"는 뜻이다.
    const present = (a: string | null | undefined, b: string | null) => (a === undefined ? b : a);
    return {
      ...row,
      question_text: clip(present(s.question_text, row.question_text), QUESTION_TEXT_MAX) ?? row.question_text,
      char_limit: s.char_limit === undefined ? row.char_limit : s.char_limit,
      count_basis: s.count_basis ?? row.count_basis,
      user_note: clip(present(s.user_note, row.user_note), USER_NOTE_MAX),
      answer_title: clip(present(s.answer_title, row.answer_title), 100),
      body: (s.body === undefined || s.body === null ? row.body : s.body).slice(0, ANSWER_BODY_MAX),
      valueSource: "form_snapshot" as const,
    };
  });
}

export function buildCoverLetterChatContext(input: CoverLetterChatTurnInput): CoverLetterChatContext {
  const draft = parseCoverLetterDraft(input.structuredDraft);

  // ① 커리어 컨텍스트 팩 — 전체 (CL-Q1). 이 호출이 유일한 조립 지점이다.
  const pack = buildCareerPack(input.careerRows, { asOf: input.asOf });

  // ② JD: 요건 전부 + 회사·직무 소개 문장만 (AI-04 입력 컨텍스트).
  const companySids = new Set(input.jd.companySids);
  const jd = buildJdContext({
    jobDescriptionId: input.jd.jobDescriptionId,
    jobDescriptionUpdatedAt: input.jd.jobDescriptionUpdatedAt,
    sentences: input.jd.sentences.filter((s) => companySids.has(s.sid)),
    requirements: input.jd.requirements,
    includeSentences: "all",
    positionTitle: input.jd.positionTitle,
  });

  // ③ 문항 (정본 + 폼 스냅숏) + 메모 별칭.
  const merged = mergeQuestions(input.questions, input.formSnapshot);
  const noteMap = new AliasMap();
  const questions: CoverLetterQuestionContext[] = merged.map((row, i) => {
    const index = i + 1;
    const note = clip(row.user_note, USER_NOTE_MAX);
    const alias = note ? noteAlias(index) : null;
    if (note && alias) {
      noteMap.add({
        alias,
        sourceType: "user_note",
        id: row.question_id,
        fields: { [WHOLE_SOURCE_FIELD]: note },
        snapshotAt: row.user_note_updated_at ?? null,
        label: NOTE_LABEL,
        parents: [],
      });
    }
    const body = row.body ?? "";
    return {
      slot: row.slot,
      questionId: row.question_id,
      index,
      questionText: row.question_text,
      templateKey: row.template_key,
      charLimit: row.char_limit,
      countBasis: row.count_basis,
      userNote: note,
      userNoteUpdatedAt: row.user_note_updated_at ?? null,
      answerTitle: clip(row.answer_title, 100),
      body,
      bodyForModel: bodyForModel(body),
      baseBodyHash: bodyHash(body),
      charCount: charLength(body),
      empty: body.trim() === "",
      noteAlias: alias,
      valueSource: row.valueSource,
    };
  });

  const aliases = AliasMap.merge(pack.aliases, jd.aliases, noteMap);

  // ④ 숫자·용어 허용 범위: 팩 + JD + 메모 + 문항 문구 + 지금 답변 (V-5, 스킬명 가드).
  const numberTexts = [
    ...pack.numberSources.factualTexts,
    ...jd.numberTexts,
    ...questions.flatMap((q) => [q.questionText, q.userNote, q.body].filter((t): t is string => !!t)),
    ...draft.facts.map((f) => f.text),
  ];
  const env: DraftCheckEnv = {
    aliases,
    ctx: { aliases, learnings: "forbidden", scope: null },
    allowedNumbers: buildAllowedNumbers({ texts: numberTexts, numbers: pack.numberSources.computedNumbers }),
    literalAliasTokens: literalAliasTokens(numberTexts),
    termCorpus: buildTermCorpus(numberTexts),
  };

  // ⑤ 대화 메시지·사실.
  const done = [...input.messages].filter((m) => m.status === "done").sort((a, b) => a.sequence - b.sequence);
  const messages = new Map<string, V9Message>();
  const messageAliasById = new Map<string, string>();
  for (const m of done) {
    const alias = `M${m.sequence}`;
    messages.set(alias, { alias, id: m.id, role: m.role, sequence: m.sequence, content: m.content });
    messageAliasById.set(m.id, alias);
  }
  const pending = done.filter((m) => m.role === "user" && m.sequence > input.lastExtractedSequence);
  const factAliases = new Map<string, CoverLetterFact>();
  draft.facts.forEach((f, i) => {
    if (f.review === "ok" || f.review === "accepted") factAliases.set(factAlias(i), f);
  });

  const latestUser = [...done].reverse().find((m) => m.role === "user");
  const delegationRequested = !!latestUser && isDelegationRequest(latestUser.content);
  const composeRequested: CoverLetterChatContext["composeRequested"] = delegationRequested
    ? null
    : input.requestedAction === "compose_draft"
      ? "requested_action"
      : latestUser && pending.includes(latestUser) && isComposeRequest(latestUser.content)
        ? "text"
        : null;

  const referenceText = buildReference(input.insightSignal ?? null);
  const sharedBlocks: AiTextBlock[] = [{ text: pack.text, cache: true }, { text: jd.text, cache: true }];
  if (referenceText) sharedBlocks.push({ text: referenceText });

  const chatBlocks: AiTextBlock[] = [
    {
      text: ["<chat>", `문항 수: ${questions.length}`, `채워진 문항: ${questions.filter((q) => !q.empty).length}`, "</chat>"].join("\n"),
    },
  ];
  done.forEach((m, i) => {
    chatBlocks.push({
      text: `<message id="M${m.sequence}" role="${m.role}">\n${esc(m.content)}\n</message>`,
      ...(i === done.length - 1 ? { cache: true } : {}),
    });
  });

  return {
    input,
    draft,
    questions,
    bySlot: new Map(questions.map((q) => [q.slot, q])),
    pack,
    aliases,
    env,
    packText: pack.text,
    jdText: jd.text,
    referenceText,
    careerSnapshotHash: pack.careerSnapshotHash,
    requirementsHash: jd.requirementsHash,
    factAliases,
    messages,
    messageAliasById,
    pendingAliases: new Set(pending.map((m) => `M${m.sequence}`)),
    processThroughSequence: pending.length ? pending[pending.length - 1].sequence : null,
    draftCount: draft.draft_count,
    draftLimitReached: draft.draft_count >= COVER_LETTER_DRAFT_LIMIT,
    tone: draft.meta.tone_requested,
    sensitiveNotice: [...new Set(pending.flatMap((m) => detectSensitive(m.content)))],
    delegationRequested,
    composeRequested,
    lastMessage: input.isFinalReply ?? false,
    sharedBlocks,
    chatBlocks,
  };
}

export const NOTE_LABEL = "내 메모";

function buildReference(signal: CoverLetterInsightSignal): string | null {
  if (!signal) return null;
  const lines: string[] = [];
  if (signal.positioning) lines.push(`인사이트 지원 방향: ${escLine(signal.positioning)}`);
  for (const s of signal.strengths) lines.push(`인사이트 강점: ${escLine(s.title)} — ${escLine(s.description)}`);
  return lines.length ? ["<reference>", ...lines, "</reference>"].join("\n") : null;
}

// ---------------------------------------------------------------------------
// 초안 턴 분할 (CF-5 + CL-10)
// ---------------------------------------------------------------------------

/**
 * 한 초안 턴이 다룰 문항 수: 기본 3개(CL-10). 다룰 문항들의 글자 수 제한 합계가
 * 3,000자를 넘으면 2개로 줄인다 `[가정]`.
 */
export function questionsPerTurn(batchCandidates: readonly CoverLetterQuestionContext[]): number {
  const head = batchCandidates.slice(0, MAX_QUESTIONS_PER_DRAFT_TURN);
  const sum = head.reduce((n, q) => n + (q.charLimit ?? 0), 0);
  return head.length > REDUCED_QUESTIONS_PER_DRAFT_TURN && sum > DRAFT_TURN_CHAR_LIMIT_SUM
    ? REDUCED_QUESTIONS_PER_DRAFT_TURN
    : MAX_QUESTIONS_PER_DRAFT_TURN;
}

/**
 * 문항 전체를 한 바퀴 도는 초안 턴 분할. 문항 ≤ 3이면 1회, 4~5면 2회
 * (1~3번 → 4~5번, CF-5 "한 바퀴 초안 턴 2회").
 */
export function planDraftBatches(questions: readonly CoverLetterQuestionContext[]): CoverLetterQuestionContext[][] {
  const batches: CoverLetterQuestionContext[][] = [];
  let rest = [...questions];
  while (rest.length > 0) {
    const size = questionsPerTurn(rest);
    batches.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  return batches;
}

/**
 * 이번 초안 턴의 대상 문항. 사용자가 고른 문항(`requestedSlots` / `requestedSlot`)이
 * 있으면 그 문항만(≤ 3), 없으면 **비어 있는 문항부터** 다음 묶음을 가져온다
 * (전부 채워져 있으면 처음부터 — "다시 제안").
 */
export function selectDraftBatch(ctx: CoverLetterChatContext): CoverLetterQuestionContext[] {
  const picked = [...(ctx.input.requestedSlots ?? []), ...(ctx.input.requestedSlot ? [ctx.input.requestedSlot] : [])];
  if (picked.length > 0) {
    const unique = [...new Set(picked)];
    const chosen = ctx.questions.filter((q) => unique.includes(q.slot));
    return chosen.slice(0, questionsPerTurn(chosen));
  }
  const empty = ctx.questions.filter((q) => q.empty);
  const pool = empty.length > 0 ? empty : ctx.questions;
  return pool.slice(0, questionsPerTurn(pool));
}

/**
 * 첫 턴 문구 분기 (CF-5·R-CF-11 `[가정]`, 최종 문구는 UX):
 * 4~5문항이면 한 바퀴가 초안 턴 2회이므로 "먼저 1~3번 문항을", 3문항 이하면
 * 한 번에 돌아 "바로 초안을".
 */
export type FirstTurnVariant = "batched" | "all";

export function firstTurnVariant(questionCount: number): FirstTurnVariant {
  return questionCount > MAX_QUESTIONS_PER_DRAFT_TURN ? "batched" : "all";
}

/** 첫 턴 칩 1의 문구 (AI-04 "빠른 버튼 칩" 표, `[가정]`). */
export function firstDraftChipLabel(questions: readonly CoverLetterQuestionContext[]): string {
  if (firstTurnVariant(questions.length) === "all") return "초안 만들기";
  const batch = questions.slice(0, MAX_QUESTIONS_PER_DRAFT_TURN);
  return `먼저 ${batch[0].index}~${batch[batch.length - 1].index}번 문항 초안 만들기`;
}

// ---------------------------------------------------------------------------
// 데이터 블록 (C-4)
// ---------------------------------------------------------------------------

const CLASS_LABEL: Record<QuestionClass, string> = {
  motivation: "motivation(지원 동기)",
  job_competency: "job_competency(직무 역량)",
  future_plan: "future_plan(입사 후 포부)",
  experience_story: "experience_story(경험 서술형)",
};

/** `<questions>`: 이번 턴 대상 문항의 정의와 메모. */
export function renderQuestions(batch: readonly CoverLetterQuestionContext[]): string {
  const lines: string[] = ["<questions>"];
  for (const q of batch) {
    lines.push(`<question slot="${q.slot}" no="${q.index}">`);
    lines.push(`문항: ${escLine(q.questionText)}`);
    lines.push(`유형: ${q.templateKey ? CLASS_LABEL[q.templateKey] : "사용자 추가 문항(유형을 분류하세요)"}`);
    if (q.charLimit) lines.push(`글자 수 제한: ${q.charLimit}자 (${q.countBasis === "with_spaces" ? "공백 포함" : "공백 제외"}, 제목은 세지 않습니다)`);
    lines.push(q.answerTitle ? `현재 제목: ${escLine(q.answerTitle)} (제목이 이미 있으므로 answer_title은 null)` : "현재 제목: (없음 — answer_title을 제안하세요)");
    lines.push(q.noteAlias && q.userNote ? `<note ref="${q.noteAlias}">\n${escBlock(q.userNote)}\n</note>` : "<note>(메모 없음)</note>");
    lines.push("</question>");
  }
  lines.push("</questions>");
  return lines.join("\n");
}

/** `<document_state>`: 문항별 지금 답변 + 글자 수 + 현재 제목 (CL-4). */
export function renderDocumentState(ctx: CoverLetterChatContext): string {
  const lines: string[] = ["<document_state>"];
  for (const q of ctx.questions) {
    const basis = q.countBasis === "with_spaces" ? "공백 포함" : "공백 제외";
    lines.push(`<answer slot="${q.slot}" no="${q.index}" chars="${q.charCount}" limit="${q.charLimit ?? "없음"}" basis="${basis}">`);
    lines.push(`제목: ${q.answerTitle ? escLine(q.answerTitle) : "(없음)"}`);
    lines.push(q.body.trim() === "" ? "(본문 없음)" : escBlock(q.bodyForModel.text) + (q.bodyForModel.truncated ? "\n(…본문이 길어 일부만 보여 줍니다)" : ""));
    lines.push("</answer>");
  }
  lines.push("</document_state>");
  return lines.join("\n");
}

/** `<other_questions>`: 이번 턴 대상이 아닌 문항이 주 근거로 쓴 프로젝트 (F-DOC-08). */
export function renderOtherQuestions(ctx: CoverLetterChatContext, batch: readonly CoverLetterQuestionContext[]): string | null {
  const batchSlots = new Set(batch.map((q) => q.slot));
  const lines: string[] = [];
  for (const entry of ctx.draft.document.questions) {
    if (batchSlots.has(entry.slot)) continue;
    const refs = new Set<string>();
    for (const block of entry.draft.blocks) {
      for (const e of block.evidence) {
        if (e.source_type !== "project") continue;
        const alias = ctx.pack.aliases.aliasOf("project", e.source_id);
        if (alias) refs.add(`${alias} '${escLine(ctx.pack.aliases.get(alias)?.label ?? "")}'`);
      }
    }
    const q = ctx.bySlot.get(entry.slot);
    if (refs.size && q) lines.push(`- ${q.index}번 문항 "${escLine(q.questionText)}": 주 근거 ${[...refs].join(", ")}`);
  }
  return lines.length ? ["<other_questions>", ...lines, "</other_questions>"].join("\n") : null;
}

/** `<facts>`: 이 대화에서 정리된 사실 (`usable` = compose·reply, `all` = extract). */
export function renderFacts(ctx: CoverLetterChatContext, mode: "usable" | "all"): string {
  const lines: string[] = ["<facts>"];
  ctx.draft.facts.forEach((f, i) => {
    const alias = factAlias(i);
    const usable = f.review === "ok" || f.review === "accepted";
    if (mode === "usable" && !usable) return;
    const q = ctx.bySlot.get(f.slot);
    const state = mode === "all" ? ` review="${f.review}"` : "";
    lines.push(`<fact ref="${alias}" slot="${f.slot}"${q ? ` no="${q.index}"` : ""} actor="${f.actor}"${state}>\n${escBlock(f.text)}\n</fact>`);
  });
  if (lines.length === 1) lines.push("(아직 없음)");
  lines.push("</facts>");
  return lines.join("\n");
}

/** `<user_sources>`: 사용자가 이 대화에서 지정한 문항 근거 (extract `source_selection`의 누적). */
export function renderUserSources(ctx: CoverLetterChatContext, batch: readonly CoverLetterQuestionContext[]): string | null {
  const lines: string[] = [];
  for (const q of batch) {
    const entry = ctx.draft.document.questions.find((e) => e.slot === q.slot);
    const projectIds = new Set<string>();
    for (const block of entry?.draft.blocks ?? []) {
      for (const e of block.evidence) if (e.source_type === "project") projectIds.add(e.source_id);
    }
    for (const id of projectIds) {
      const alias = ctx.pack.aliases.aliasOf("project", id);
      if (!alias) continue;
      const parent = ctx.pack.aliases.get(alias)?.parents[0] ?? null;
      lines.push(`- ${q.index}번 문항: ${alias} '${escLine(sourceLabel(ctx.pack.aliases, { projectAlias: alias, parentAlias: parent }))}'`);
    }
  }
  return lines.length ? ["<user_sources>", ...lines, "</user_sources>"].join("\n") : null;
}

export { charLength };
