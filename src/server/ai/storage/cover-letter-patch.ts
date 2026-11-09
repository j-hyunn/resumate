import type { CoverLetterTone } from "../schemas/AI-04";
import type { CoverLetterBlock, StoredSource } from "../schemas/cover-letter-draft";
import type { Ai04Clarification } from "../schemas/AI-04";
import type { FactChange } from "../validation/cover-letter";

/**
 * AI-04 → `apply_structured_draft_patch(p_writing_chat_id, p_patch)` for a
 * **자소서 대화** (AI caller = app_ai_writer). 연산 목록은 DM v4.15 2.5.0b
 * "패치 연산 (서류 대화)": `add_facts` / `replace_draft`(**`slot` 필수**,
 * `answer_title`을 함께 실을 수 있다) / `count_draft` / `set_clarifications` /
 * `add_sensitive_flags` / `set_tone` / `set_question_edit_proposal` 뿐이다.
 * `set_section_order_proposal`·`set_source_ranking`·`set_writing_kind`는 없다
 * (CF-1, RM-1).
 *
 * 초안 `value`는 **DB가 블록으로 다시 조립**하므로 보내지 않는다 (R5-DB-5).
 * `answer_title`은 `value`에 들어가지 않는다 (CF-6).
 *
 * (CF-S1, 확정 2026-11-09 사용자 — 문서 PR #68 미머지) `replace_draft`에
 * **`sources[]`**(`{source_type, source_id, role}`, 0~5개)를 함께 싣는다. 새 연산을
 * 만들지 않는다. **키 없음과 빈 배열은 다르다**:
 * - `sources: [...]` / `sources: []` → 그 슬롯의 `{slot}.sources.{n}` 행을 **그 값으로 교체**
 *   (빈 배열 = 근거 행 없음. 문항 유형상 프로젝트 0개가 정상인 `motivation`·`future_plan`이 그렇다);
 * - **키 없음** → db는 "제안에 `sources`가 없다"로 보고 **기존 행을 유지**한다.
 *
 * 화면은 `sources`를 보내지 않으므로(`p_body.questions[]`에 키가 없다) **이 제안이
 * 저장의 유일한 원천**이다. 그래서 초안 턴은 블록이 남은 문항마다 `sources`를
 * **항상 싣는다**(빈 배열이라도) — 빼먹으면 그 슬롯 근거가 영구히 비거나 옛 행이 남는다.
 */

/**
 * 한 문항의 초안 제안 (파이프라인 → 패치). **패치 payload에서는 `slot`·
 * `question_id`가 연산 바깥, 나머지는 `draft` 키 안에 들어간다**(db-engineer
 * R15 노트 ②-5: `{op, slot, question_id?, draft}` — `body`가 아니다).
 */
export type CoverLetterDraftBodyInput = {
  slot: string;
  /** 새 슬롯 원소를 만들 때 db가 쓰는 uuid (있으면 보낸다). */
  questionId?: string | null;
  /** (v4.15, CF-6) 검증을 통과한 제목 또는 null. 100자 초과는 `invalid_patch`. */
  answer_title: string | null;
  blocks: CoverLetterBlock[];
  /**
   * (CF-S1) 문항 근거. **생략(undefined)과 빈 배열의 뜻이 다르다** — 위 머리 주석.
   * 초안 턴은 언제나 값을 싣는다.
   */
  sources?: StoredSource[];
  base_body_hash: string;
  replace_allowed: boolean;
  char_count: number;
  /** null이면 **키를 보내지 않는다** — db는 `null` 값을 `invalid_value`로 본다. */
  char_limit_at_generation: number | null;
  char_adjust_needed: boolean;
  correction_applied: boolean;
  missing_slots: string[];
  dropped_block_count: number;
};

export type CoverLetterPatchOp =
  | { op: "add_sensitive_flags"; count: number }
  | { op: "add_facts"; facts: FactChange[] }
  | { op: "set_clarifications"; items: Ai04Clarification[] }
  | { op: "set_tone"; value: CoverLetterTone | null }
  | { op: "replace_draft"; slot: string; question_id?: string; draft: CoverLetterDraftOp }
  | { op: "count_draft" };

/** `replace_draft`의 `draft` 키 (db-engineer R15 노트 ②-5의 목록 그대로). */
export type CoverLetterDraftOp = {
  answer_title: string | null;
  blocks: CoverLetterBlock[];
  char_count: number;
  /** 키가 없으면 db는 "제한 없음"으로 읽는다. `null`을 보내면 `invalid_value`다. */
  char_limit_at_generation?: number;
  char_adjust_needed: boolean;
  correction_applied: boolean;
  base_body_hash: string;
  replace_allowed: boolean;
  missing_slots: string[];
  dropped_block_count: number;
  /** (CF-S1) 키 없음 = 기존 행 유지 / 빈 배열 = 행 삭제. */
  sources?: StoredSource[];
};

export type CoverLetterPatch = { ops: CoverLetterPatchOp[] };

/** RPC limits (DM 2.5.0a·2.5.0b). */
export const COVER_LETTER_PATCH_MAX_SENSITIVE_ADD = 100;
export const COVER_LETTER_PATCH_MAX_CLARIFICATIONS = 50;
export const COVER_LETTER_PATCH_MAX_DROPPED = 999;
/** (CF-S1 `[가정]`) 문항 근거 ≤ 5개. */
export const COVER_LETTER_PATCH_MAX_SOURCES = 5;

export function isEmptyCoverLetterPatch(patch: CoverLetterPatch): boolean {
  return patch.ops.length === 0;
}

/** 정리 턴 결과 → 연산: 민감정보 수 → 사실 → 문체 → clarifications. */
export function factsPatch(result: {
  facts: FactChange[];
  clarifications: Ai04Clarification[] | null;
  tone: CoverLetterTone | null;
  sensitiveAdd: number;
  /** 저장된 값과 같으면 `set_tone`을 보내지 않는다. */
  storedTone?: CoverLetterTone | null;
}): CoverLetterPatch {
  const ops: CoverLetterPatchOp[] = [];
  if (result.sensitiveAdd > 0) ops.push({ op: "add_sensitive_flags", count: Math.min(result.sensitiveAdd, COVER_LETTER_PATCH_MAX_SENSITIVE_ADD) });
  if (result.facts.length > 0) ops.push({ op: "add_facts", facts: result.facts });
  if (result.tone !== null && result.tone !== (result.storedTone ?? null)) ops.push({ op: "set_tone", value: result.tone });
  if (result.clarifications !== null) ops.push({ op: "set_clarifications", items: result.clarifications.slice(0, COVER_LETTER_PATCH_MAX_CLARIFICATIONS) });
  return { ops };
}

/**
 * 초안 턴 결과 → 연산. 문항마다 `replace_draft` 하나이고, 남은 블록이 하나도
 * 없으면(모든 문항) 턴만 세는 `count_draft`다. `count_draft`는 **턴당 1회**다
 * (초안 상한은 대화 전체 6회 — DM 2.5.0b).
 */
export function draftPatch(input: {
  bodies: readonly CoverLetterDraftBodyInput[];
  sensitiveAdded: number;
}): CoverLetterPatch {
  const ops: CoverLetterPatchOp[] = [];
  if (input.sensitiveAdded > 0) ops.push({ op: "add_sensitive_flags", count: Math.min(input.sensitiveAdded, COVER_LETTER_PATCH_MAX_SENSITIVE_ADD) });
  const kept = input.bodies.filter((b) => b.blocks.length > 0);
  if (kept.length === 0) {
    ops.push({ op: "count_draft" });
    return { ops };
  }
  for (const body of kept) {
    const draft: CoverLetterDraftOp = {
      answer_title: body.answer_title,
      blocks: body.blocks,
      char_count: body.char_count,
      char_adjust_needed: body.char_adjust_needed,
      correction_applied: body.correction_applied,
      base_body_hash: body.base_body_hash,
      replace_allowed: body.replace_allowed,
      missing_slots: body.missing_slots,
      dropped_block_count: Math.min(body.dropped_block_count, COVER_LETTER_PATCH_MAX_DROPPED),
      // 숫자일 때만 키를 둔다 (null을 보내면 db가 invalid_value로 버린다).
      ...(typeof body.char_limit_at_generation === "number" ? { char_limit_at_generation: body.char_limit_at_generation } : {}),
      // 키가 있으면 교체, 없으면 유지 — 값이 있을 때만 자른다 (키를 만들어 내지 않는다).
      ...(body.sources === undefined ? {} : { sources: body.sources.slice(0, COVER_LETTER_PATCH_MAX_SOURCES) }),
    };
    ops.push({
      op: "replace_draft",
      slot: body.slot,
      ...(body.questionId ? { question_id: body.questionId } : {}),
      draft,
    });
  }
  return { ops };
}
