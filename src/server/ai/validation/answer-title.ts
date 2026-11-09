import type { AliasMap } from "../context-pack/aliases";
import { ANSWER_TITLE_MAX } from "../schemas/AI-04";
import { replaceAliasesInText } from "./alias-text";
import { buildTermCorpus, findUnknownTechTerms } from "./drafts";
import { buildAllowedNumbers, findUnsupportedNumbers, NUMBER_CHECK_TOKEN } from "./numbers";
import { findPlaceholderTokens } from "./placeholders";
import { detectSensitive } from "./v9";

/**
 * (v4.15, CF-6·CF-A4) 답변 제목 (`answer_title`) 서버 검증 — AI-04
 * "답변 제목 검증". 제목도 사실을 주장할 수 있으므로 검증을 걸되, **걸리면
 * 치환이나 `needs_review` 없이 제목만 버린다**(`null`). 본문은 그대로 살린다.
 *
 * | 순서 | 검사 | 결과 |
 * |------|------|------|
 * | ① | 숫자 가드 (V-5): 제목의 숫자가 **보정을 마친 그 문항의 문단 텍스트**·근거 인용·서버 계산 값에 있어야 한다 | 버림 |
 * | ② | 고유명사·기술명 (스킬명 가드와 같은 기준) — 같은 범위에 있어야 한다 | 버림 |
 * | ③ | 민감정보 (V-9g·C-7) | 버림 |
 * | ④ | 별칭이 남아 있으면 C-3 표시 문장 규칙으로 바꾼다 | 치환 |
 * | ⑤ | 자리 표시 토큰·줄바꿈·100자 초과 | 버림 (줄바꿈은 먼저 한 줄로 합친다) |
 *
 * `[가정]` **④(별칭 치환)를 ①~③보다 먼저** 돌린다 — 별칭 토큰(`PRJ-3`)이 남아
 * 있으면 숫자·고유명사 가드가 그 토큰 때문에 멀쩡한 제목을 버리기 때문이다.
 * 블록 검사(`checkDraftBlock`)도 같은 순서다(치환 뒤 스킬명 가드).
 *
 * 제목에는 `evidence`가 없다 — 근거는 그 답변의 문단이 진다(V-4를 걸지 않는
 * 이유). 글자 수 제한·보정·`char_count`에도 넣지 않는다(CF-6).
 */

export type AnswerTitleCheck = "numbers" | "names" | "sensitive" | "placeholder" | "length" | "empty";

export type AnswerTitleOutcome = {
  /** 검증을 통과한 제목, 또는 null (제안 없음과 같은 모양). */
  title: string | null;
  /** 버린 이유 (제안이 없었으면 null). */
  rejected: AnswerTitleCheck | null;
  /** 별칭을 이름으로 바꾼 횟수 (보고용 카운트). */
  aliasesReplaced: number;
};

export type AnswerTitleEnv = {
  /** 보정까지 끝낸 그 문항의 문단 텍스트. */
  paragraphTexts: readonly string[];
  /** 그 문단들이 인용한 근거 텍스트(quote 등). */
  evidenceTexts: readonly string[];
  /** 서버가 계산한 숫자(기간 개월 수 등). */
  computedNumbers?: readonly number[];
  aliases: AliasMap;
  literalAliasTokens: ReadonlySet<string>;
};

/** 한 줄로 합치고 앞뒤 공백을 없앤다 (제목은 문장이 아니라 한 줄이다). */
export function normalizeAnswerTitle(raw: string): string {
  return raw.replace(/\s*[\r\n]+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function validateAnswerTitle(raw: string | null | undefined, env: AnswerTitleEnv): AnswerTitleOutcome {
  if (raw === null || raw === undefined) return { title: null, rejected: null, aliasesReplaced: 0 };
  const title = normalizeAnswerTitle(raw);
  if (title === "") return { title: null, rejected: "empty", aliasesReplaced: 0 };

  const texts = [...env.paragraphTexts, ...env.evidenceTexts];

  // ④ 별칭 → 표시 이름 (①~③보다 먼저, 위 `[가정]`).
  const scrubbed = replaceAliasesInText(title, env.aliases, env.literalAliasTokens);
  const text0 = normalizeAnswerTitle(scrubbed.text);
  if (text0 === "") return { title: null, rejected: "empty", aliasesReplaced: scrubbed.stats.replaced };
  const aliasesReplaced = scrubbed.stats.replaced;

  // ① 숫자 가드 (V-5).
  const allowed = buildAllowedNumbers({ texts, numbers: env.computedNumbers ?? [] });
  if (findUnsupportedNumbers(text0, allowed).length > 0) return { title: null, rejected: "numbers", aliasesReplaced };

  // ② 고유명사·기술명 (스킬명 가드와 같은 기준).
  if (findUnknownTechTerms(text0, buildTermCorpus(texts)).length > 0) return { title: null, rejected: "names", aliasesReplaced };

  // ③ 민감정보.
  if (detectSensitive(text0).length > 0) return { title: null, rejected: "sensitive", aliasesReplaced };

  // ⑤ 자리 표시 토큰(숫자 치환 토큰 포함)·100자.
  if (findPlaceholderTokens(text0).length > 0 || text0.includes(NUMBER_CHECK_TOKEN)) {
    return { title: null, rejected: "placeholder", aliasesReplaced };
  }
  if (Array.from(text0).length > ANSWER_TITLE_MAX) return { title: null, rejected: "length", aliasesReplaced };

  return { title: text0, rejected: null, aliasesReplaced };
}

/** 버린 제목을 알리는 AI 메시지 한 줄 (AI-04, 최종 문구는 UX). */
export function droppedTitleNotice(questionNo: number): string {
  return `${questionNo}번 문항 제목은 확인되지 않는 내용이 있어 넣지 않았어요 — 직접 써 주세요.`;
}
