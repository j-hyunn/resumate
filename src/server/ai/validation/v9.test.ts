import { describe, expect, it } from "vitest";
import { baseInput, emptyProject, filledProject, GREETING, msgId, output, rows } from "../__fixtures__/AI-12/conversations";
import { buildWritingChatContext, type WritingChatTurnInput } from "../context-pack/writing-chat";
import { plainForValidation } from "../context-pack/deliverable-text";
import type { Ai12ExtractOutput } from "../schemas/AI-12";
import { STAR_FIELD_MAX_LENGTH, toDraftPatch } from "../schemas/structured-draft";
import { KOREAN_SUFFIXES, wordForm } from "./v9-lexicon";
import { PERSONAL_SENTENCES, WORK_SENTENCES } from "../__fixtures__/AI-12/sensitive-probes";
import {
  checkMonthValue,
  checkNumberValue,
  checkQuotes,
  checkSources,
  checkTextNumbers,
  contentWords,
  detectSensitive,
  findUnsupportedNames,
  isActorAmbiguous,
  isDelegationRequest,
  MAX_PATCHES_PER_TURN,
  mergedStarLength,
  nominalStems,
  normalizeMessageAlias,
  preservesExisting,
  containsNormalized,
  remainingStarChars,
  stripKoreanSuffix,
  uncoveredRatio,
  V9E_MAX_UNCOVERED_RATIO,
  validateExtractOutput,
  type V9Message,
} from "./v9";

const user = (alias: string, content: string, sequence = 2): V9Message => ({ alias, id: `id-${alias}`, role: "user", sequence, content });
const assistant = (alias: string, content: string): V9Message => ({ alias, id: `id-${alias}`, role: "assistant", sequence: 1, content });

describe("normalizeMessageAlias", () => {
  it.each([
    ["M3", "M3"],
    ["M-3", "M3"],
    ["m3", "M3"],
    [" M03 ", "M3"],
    ["DET-1", "DET-1"],
  ])("%s → %s", (raw, expected) => expect(normalizeMessageAlias(raw)).toBe(expected));
});

describe("V-9a checkSources", () => {
  const messages = new Map([
    ["M1", assistant("M1", "어떤 프로젝트였나요? 응답 시간을 30% 줄이셨나요?")],
    ["M2", user("M2", "네 맞아요")],
    ["M3", user("M3", "알아서 그럴듯하게 채워 주세요", 3)],
    ["M4", user("M4", "알아서 잘 정리해 두었어요. 문서화를 맡았어요", 4)],
  ]);
  it.each([
    ["no sources", [], "V-9a"],
    ["assistant message", ["M1"], "V-9a"],
    ["mixed user + assistant", ["M2", "M1"], "V-9a"],
    ["unknown alias", ["M9"], "V-9a"],
    ["only a delegation request", ["M3"], "V-9a.delegation"],
  ])("rejects %s", (_name, ids, check) => {
    expect(checkSources(ids as string[], messages)).toEqual({ ok: false, check });
  });
  it("accepts user messages (any alias spelling) and dedupes", () => {
    const r = checkSources(["M2", "M-2"], messages);
    expect(r.ok && r.sources.map((s) => s.alias)).toEqual(["M2"]);
  });
  it("'알아서' alone is not a delegation request", () => {
    expect(isDelegationRequest("알아서 잘 정리해 두었어요")).toBe(false);
    expect(checkSources(["M4"], messages).ok).toBe(true);
  });
  it.each(["알아서 채워 줘", "그럴듯하게 써 주세요", "적당히 만들어 주세요", "대충 지어내 줘", "있어 보이게 작성해 줘"])(
    "delegation: %s",
    (text) => expect(isDelegationRequest(text)).toBe(true),
  );
});

describe("V-9b checkQuotes", () => {
  const src = [user("M2", "APM으로 병목 쿼리를 찾아서, 인덱스를 다시 설계했어요！")];
  it.each([
    ["exact", ["병목 쿼리를 찾아서"], ["병목 쿼리를 찾아서"]],
    ["spacing variant", ["병목쿼리를  찾아서"], ["병목 쿼리를 찾아서"]],
    ["punctuation variant (full-width, comma)", ["찾아서 인덱스를 다시 설계했어요!"], ["찾아서, 인덱스를 다시 설계했어요"]],
    ["case-insensitive Latin", ["apm으로"], ["APM으로"]],
  ])("accepts %s and stores the original span", (_name, quotes, expected) => {
    expect(checkQuotes(quotes, src)).toEqual({ ok: true, quotes: expected });
  });
  it.each([
    ["empty list", []],
    ["empty quote", ["  "]],
    ["paraphrase", ["인덱스를 재설계했어요"]],
    ["partial overlap (no 70% rule in V-9b)", ["병목 쿼리를 찾아서 캐시를 붙였어요"]],
    ["one of two quotes invented", ["병목 쿼리를", "캐시를 붙였어요"]],
  ])("rejects %s", (_name, quotes) => {
    expect(checkQuotes(quotes, src)).toEqual({ ok: false });
  });
});

describe("V-9c numbers in text", () => {
  it.each([
    ["30%", ["응답이 30% 빨라졌어요"], true],
    ["30퍼센트", ["응답이 30% 빨라졌어요"], true],
    ["30%", ["30명이 썼어요"], false],
    ["1,200명", ["1200명이 썼어요"], true],
    ["1200명", ["1,200명이 썼어요"], true],
    ["3배", ["처리량이 3배가 됐어요"], true],
    ["3배", ["서버 3개를 줄였어요"], false],
    ["2년 6개월", ["2년 6개월 동안 운영했어요"], true],
    ["2년 6개월", ["2년 동안 운영했어요"], false],
    ["1.2만 건", ["하루 12000건"], true],
    ["12,000건", ["하루 1.2만 건"], true],
    ["0.7초", ["1.2초에서 0.7초로"], true],
    ["0.7초", ["1.2에서 0.7로"], true],
    ["2023년", ["23년 3월부터"], true],
    ["40%", ["많이 줄었어요"], false],
    ["숫자 없는 문장", ["아무 말"], true],
  ])("%s vs %j → %s", (value, quotes, ok) => {
    expect(checkTextNumbers(`값: ${value}`, quotes)).toBe(ok);
  });
});

describe("V-9c numeric fields", () => {
  it.each([
    [4, ["저 포함 4명이었어요"], ["명", "인"], true],
    [4, ["저 포함 네 명이었어요"], ["명", "인"], true],
    [4, ["4인 팀"], ["명", "인"], true],
    [4, ["팀이 4개였어요"], ["명", "인"], false],
    [5, ["저 포함 4명"], ["명", "인"], false],
    [1.2, ["1.2초 걸리던 게"], undefined, true],
    [0.7, ["1.2초 걸리던 게 0.7초로"], ["초"], true],
    [4, ["4시간에서 50분으로"], ["분"], false],
    [50, ["4시간에서 50분으로"], ["분"], true],
  ])("%s in %j (units %j) → %s", (value, quotes, units, ok) => {
    expect(checkNumberValue(value, quotes, units)).toBe(ok);
  });
});

describe("V-9c months", () => {
  it.each([
    ["2023-03", ["23년 3월부터"], true],
    ["2023-03", ["2023년 3월에 시작"], true],
    ["2023-03", ["2023.03 ~ 2023.12"], true],
    ["2023-12", ["2023.03 ~ 2023.12"], true],
    ["2023-03", ["2023-3부터"], true],
    ["2023-04", ["23년 3월부터"], false],
    ["2023-03", ["작년 봄부터"], false],
    ["2023-03", ["2023년부터"], false],
    ["2023-3", ["2023년 3월"], false],
    ["1999-07", ["99년 7월"], true],
  ])("%s from %j → %s", (value, quotes, ok) => {
    expect(checkMonthValue(value, quotes)).toBe(ok);
  });
});

describe("V-9d names", () => {
  it.each([
    ["Kafka로 이벤트를 받았다", ["Kafka로 이벤트를 받아서"], []],
    ["kafka로 이벤트를 받았다", ["KAFKA로 받아서"], []],
    ["Kafka로 이벤트를 받았다", ["카프카로 이벤트를 받아서"], []],
    ["카프카로 이벤트를 받았다", ["Kafka를 썼어요"], []],
    ["Redis 캐시를 붙였다", ["캐시를 붙였어요"], ["latin"]],
    ["레디스 캐시를 붙였다", ["캐시를 붙였어요"], ["skill"]],
    ["응답 시간을 120ms로 줄였다", ["120밀리초"], []],
    ["에이비씨페이에서 결제를 맡았다", ["결제를 맡았어요"], ["org"]],
    ["에이비씨페이에서 결제를 맡았다", ["에이비씨페이 다닐 때 결제를 맡았어요"], []],
    ["A/B 테스트를 했다", ["A/B 테스트"], []],
  ])("%s with %j → %j", (value, sources, failures) => {
    expect(findUnsupportedNames(value, sources)).toEqual(failures);
  });
});

describe("V-9e content overlap", () => {
  it("strips particles and endings", () => {
    expect(contentWords("인덱스를 재설계했다")).toEqual(["인덱스", "재설계"]);
  });
  it.each([
    ["APM으로 병목 쿼리를 찾아 인덱스를 재설계했다", ["APM으로 병목 쿼리를 찾아서 인덱스를 다시 설계했어요"], "ok"],
    ["배포 시간이 크게 줄었다", ["배포 시간이 확 줄었어요"], "ok"],
    ["결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다", ["APM으로 병목 쿼리를 찾아서 인덱스를 다시 설계했어요"], "ok"],
    ["전사 결제 플랫폼 아키텍처를 주도적으로 설계하고 팀 생산성을 높였다", ["결제 쪽 일을 했어요"], "review"],
    ["추천 클릭률이 개선되었다", ["알아서 그럴듯하게 채워 주세요"], "review"],
  ])("%s → %s", (value, quotes, expected) => {
    const ratio = uncoveredRatio(value, quotes);
    expect(ratio > V9E_MAX_UNCOVERED_RATIO ? "review" : "ok").toBe(expected);
  });
});

describe("V-9f actor", () => {
  it.each([
    ["캐시를 붙였다", ["저희가 캐시를 붙였어요"], true],
    ["캐시를 붙였다", ["저희 팀이 캐시를 붙였어요"], true],
    ["캐시를 붙였다", ["우리 팀이 캐시를 붙였어요"], true],
    ["캐시를 붙였다", ["팀이 함께 캐시를 붙였어요"], true],
    ["우리가 캐시를 붙였다", ["캐시를 붙였어요"], true],
    ["TTL 규칙을 설계했다", ["저희 팀이 캐시를 붙였고 제가 TTL 규칙을 설계했어요"], false],
    ["캐시를 붙였다", ["우리 서비스에 제가 캐시를 붙였어요"], false],
    ["캐시를 붙였다", ["우리 서비스에 캐시를 붙였어요"], false],
    ["캐시를 붙였다", ["저희 팀 서비스에 캐시를 붙였어요"], false],
    ["캐시를 붙였다", ["직접 캐시를 붙였어요"], false],
  ])("%s / %j → %s", (value, quotes, ambiguous) => {
    expect(isActorAmbiguous(value, quotes)).toBe(ambiguous);
  });
});

describe("V-9g sensitive (v4.9 RQ-6, C-7 민감정보 판정 — R8 QA-02·QA-03)", () => {
  it.each(WORK_SENTENCES)("work: %s → clean", (text) => {
    expect(detectSensitive(text)).toEqual([]);
  });

  it.each(PERSONAL_SENTENCES)("personal: %s → %j", (text, categories) => {
    expect(detectSensitive(text)).toEqual(categories);
  });

  it("the whole work set in one message stays clean; one personal sentence among them is caught", () => {
    expect(detectSensitive(WORK_SENTENCES.join(". "))).toEqual([]);
    expect(detectSensitive(`${WORK_SENTENCES.slice(0, 5).join(". ")}. 입원함.`)).toEqual(["health"]);
  });

  it.each([
    ["장애 대응을 맡았어요"],
    ["성능 문제를 진단했어요"],
    ["이번 팀장님이 오셨어요"],
    ["정말 팀장님이 많이 도와주셨어요"],
    ["부장님께 보고했어요"],
    ["정산 팀장님이 요청했어요"],
    ["정산팀 팀장님이 요청했어요"],
    ["이사님이 승인했어요"],
    ["고객님 문의가 많았어요"],
    ["전임 과장이 만든 코드"],
    ["결제 API 응답 시간을 줄였어요"],
    ["환자가 입원함"],
  ])("other clean: %s", (text) => {
    expect(detectSensitive(text)).toEqual([]);
  });

  it.each([
    ["받았음", "finite"],
    ["냄", "finite"],
    ["휴직했어요", "finite"],
    ["조합원임", "finite"],
    ["받는", "adnominal"],
    ["가입한", "adnominal"],
    ["받을", "adnominal"],
    ["받아", "connective"],
    ["하고", "connective"],
  ] as const)("wordForm(%s) = %s", (word, form) => {
    expect(wordForm(word)).toBe(form);
  });
});

// ---------------------------------------------------------------------------
// validateExtractOutput (composite)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// validateExtractOutput (composite, v4.5 schema v3)
// ---------------------------------------------------------------------------

const SAY = "23년 3월부터 했어요. 피크 시간에 결제 승인 API가 느려졌어요. 제가 병목 쿼리를 찾아 인덱스를 다시 설계했어요.";

function ctxFor(extra: Partial<WritingChatTurnInput> = {}, turns: readonly (readonly ["user" | "assistant", string])[] = [["assistant", GREETING], ["user", SAY]]) {
  return buildWritingChatContext(baseInput({ messages: rows(turns), ...extra }));
}

function run(out: Ai12ExtractOutput, ctx = ctxFor()) {
  return validateExtractOutput(out, ctx.v9);
}

const star = (field: string, value: string, quotes: string[], op: "set" | "append" = "set", ids = ["M2"]) =>
  ({ field, op, value, source_message_ids: ids, source_quotes: quotes }) as Ai12ExtractOutput["star_patches"][number];

const SITUATION = star("situation", "피크 시간에 결제 승인 API가 느려졌다", ["피크 시간에 결제 승인 API가 느려졌어요"]);
const ACTION = star("action", "병목 쿼리를 찾아 인덱스를 재설계했다", ["병목 쿼리를 찾아 인덱스를 다시 설계했어요"]);

const field = (value: string | string[] | null, extra: Record<string, unknown> = {}) => ({
  value,
  origin: "ai",
  source_message_ids: [msgId(2)],
  source_quotes: [],
  review: "ok",
  reviewed_at: null,
  applied_at: null,
  ...extra,
});

describe("validateExtractOutput — period and STAR", () => {
  it("applies valid patches with UUID sources and the original quote span", () => {
    const r = run(output({
      project_patches: [{ field: "start_month", op: "set", value: "2023-03", source_message_ids: ["M-2"], source_quotes: ["23년 3월부터  했어요"] }],
      star_patches: [SITUATION, ACTION],
    }));
    expect(r.rejections).toEqual([]);
    expect(r.changes.period).toEqual([{ field: "start_month", value: "2023-03", source_message_ids: [msgId(2)], source_quotes: ["23년 3월부터 했어요"], review: "ok" }]);
    expect(r.changes.star.map((s) => `${s.field}:${s.op}:${s.review}`)).toEqual(["situation:set:ok", "action:set:ok"]);
    expect(r.report).toMatchObject({ proposed: 3, applied: 3, rejected: 0 });
  });

  it.each([
    ["V-9a assistant source", star("situation", "어떤 상황이었나", ["어떤 상황에서"], "set", ["M1"]), "V-9a"],
    ["V-9b paraphrased quote", star("situation", "API가 느렸다", ["API가 느렸어요"]), "V-9b"],
    ["V-9c number not in quote", star("result", "응답 시간이 30% 줄었다", ["인덱스를 다시 설계했어요"]), "V-9c"],
    ["V-9c 1,200명 not said", star("result", "사용자 1,200명이 썼다", ["인덱스를 다시 설계했어요"]), "V-9c"],
    ["V-9c 2년 6개월 not said", star("situation", "2년 6개월 동안 운영했다", ["피크 시간에 결제 승인 API가 느려졌어요"]), "V-9c"],
    ["V-9d invented tech", star("action", "Redis로 병목 쿼리를 찾아 인덱스를 재설계했다", ["병목 쿼리를 찾아 인덱스를 다시 설계했어요"]), "V-9d"],
    ["empty value", star("task", "   ", ["피크 시간"]), "type"],
  ])("%s → %s", (_name, patch, check) => {
    const r = run(output({ star_patches: [patch] }));
    expect(r.rejections).toEqual([{ check, target: `star.${patch.field}` }]);
    expect(r.changes.star).toEqual([]);
  });

  it("V-9c accepts numbers stated in the quotes (30%, 1,200명)", () => {
    const ctx = ctxFor({}, [["assistant", GREETING], ["user", "응답이 30% 빨라졌고 1200명이 쓰게 됐어요"]]);
    const r = run(output({ star_patches: [star("result", "응답이 30% 빨라졌고 1,200명이 쓰게 되었다", ["응답이 30% 빨라졌고 1200명이 쓰게 됐어요"])] }), ctx);
    expect(r.rejections).toEqual([]);
  });

  it("V-9e marks a loose summary needs_review and flags it", () => {
    const r = run(output({ star_patches: [star("action", "전사 결제 플랫폼 아키텍처를 주도적으로 설계하고 팀 생산성을 높였다", ["인덱스를 다시 설계했어요"])] }));
    expect(r.changes.star[0]).toMatchObject({ field: "action", review: "needs_review" });
    expect(r.flags.needsReview).toEqual([{ section: "star", field: "action" }]);
    expect(r.report.needs_review).toBe(1);
  });

  it("rejects a bad month and period patches the project already has (V-9h), and end_month on an ongoing project", () => {
    const bad = run(output({ project_patches: [{ field: "start_month", op: "set", value: "2023-3", source_message_ids: ["M2"], source_quotes: ["23년 3월부터"] }] }));
    expect(bad.rejections).toEqual([{ check: "type", target: "project.start_month" }]);
    const filled = run(output({ project_patches: [{ field: "start_month", op: "set", value: "2023-03", source_message_ids: ["M2"], source_quotes: ["23년 3월부터"] }] }), ctxFor({ project: emptyProject({ startMonth: "2022-01-01" }) }));
    expect(filled.rejections).toEqual([{ check: "V-9h", target: "project.start_month" }]);
    const ongoing = run(output({ project_patches: [{ field: "end_month", op: "set", value: "2023-03", source_message_ids: ["M2"], source_quotes: ["23년 3월부터"] }] }), ctxFor({ project: emptyProject({ isCurrent: true }) }));
    expect(ongoing.rejections).toEqual([{ check: "V-9h", target: "project.end_month" }]);
  });

  it("V-9h (v4.9): a filled project field takes a merged set; a legacy append is still accepted", () => {
    const ctx = ctxFor({ project: filledProject() }, [["assistant", GREETING], ["user", "실행 계획도 EXPLAIN으로 확인했어요"]]);
    const merged = run(output({ star_patches: [star("action", "병목 쿼리를 찾아 인덱스를 재설계하고 실행 계획을 EXPLAIN으로 확인함", ["실행 계획도 EXPLAIN으로 확인했어요"])] }), ctx);
    expect(merged.rejections).toEqual([]);
    expect(merged.changes.star).toMatchObject([{ field: "action", op: "set", review: "ok", source_message_ids: [msgId(2)], source_quotes: ["실행 계획도 EXPLAIN으로 확인했어요"] }]);
    expect(merged.report).toMatchObject({ merged: 1, preservation_review: 0 });
    expect(toDraftPatch(merged.changes).ops[0]).toMatchObject({ op: "set", target: { section: "star", field: "action" } });
    // R8 QA-01: a legacy append becomes a merged set = current value + "\n" + the new sentence.
    const appended = run(output({ star_patches: [star("action", "실행 계획도 EXPLAIN으로 확인했다", ["실행 계획도 EXPLAIN으로 확인했어요"], "append")] }), ctx);
    expect(appended.changes.star).toMatchObject([{ field: "action", op: "set", value: "병목 쿼리를 찾아 인덱스를 재설계했다\n실행 계획도 EXPLAIN으로 확인했다", review: "ok" }]);
    expect(appended.report).toMatchObject({ merged: 1, append_merged: 1 });
  });

  it("append onto an empty project and an empty proposal becomes set; a second append becomes a merged set (QA-01)", () => {
    const r = run(output({ star_patches: [star("situation", SITUATION.value, SITUATION.source_quotes, "append"), star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append")] }));
    expect(r.changes.star.map((s) => s.op)).toEqual(["set", "set"]);
    expect(r.changes.star[1].value).toBe(`${SITUATION.value}\n인덱스를 다시 설계했다`);
    expect(r.changes.star[1].source_message_ids).toEqual([msgId(2)]);
  });

  it("append onto a pending proposal becomes a merged set (QA-01); a set equal to the pending value is unchanged", () => {
    const draft = { star: { situation: field(SITUATION.value) } };
    const r = run(output({ star_patches: [SITUATION, star("action", ACTION.value, ACTION.source_quotes, "append")] }), ctxFor({ structuredDraft: draft }));
    expect(r.report.unchanged).toBe(1);
    expect(r.changes.star.map((s) => `${s.field}:${s.op}`)).toEqual(["action:set"]);
    const appended = run(output({ star_patches: [star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append")] }), ctxFor({ structuredDraft: draft }));
    expect(appended.changes.star.map((s) => s.op)).toEqual(["set"]);
    expect(appended.changes.star[0].value).toBe(`${SITUATION.value}\n인덱스를 다시 설계했다`);
    expect(appended.changes.star[0].new_object).toBeUndefined();
    // A pending merged set on a filled field: the append goes after the pending text, not after the form value.
    const onMerged = run(
      output({ star_patches: [star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append")] }),
      ctxFor({ project: filledProject({ situation: "결제가 느렸다" }), structuredDraft: { star: { situation: field("결제가 느렸고 피크 시간에 결제 승인 API가 느려졌음", { op: "set" }) } } }),
    );
    expect(onMerged.changes.star).toMatchObject([{ op: "set", value: "결제가 느렸고 피크 시간에 결제 승인 API가 느려졌음\n인덱스를 다시 설계했다" }]);
    expect(toDraftPatch(onMerged.changes).ops.map((o) => o.op)).toEqual(["set"]);
    // v4.6: an append whose sentence is already in the pending proposal adds nothing.
    const repeated = run(output({ star_patches: [star("situation", "결제 승인 API가 느려졌다", ["결제 승인 API가 느려졌어요"], "append")] }), ctxFor({ structuredDraft: draft }));
    expect(repeated.changes.star).toEqual([]);
    expect(repeated.report.unchanged).toBe(1);
  });

  it.each([
    ["user_edit", { origin: "user_edit" }],
    ["accepted", { review: "accepted" }],
  ])("does not overwrite a %s field that is not applied yet", (_name, extra) => {
    const r = run(output({ star_patches: [SITUATION] }), ctxFor({ structuredDraft: { star: { situation: field("내가 쓴 상황", extra) } } }));
    expect(r.rejections).toEqual([{ check: "protected", target: "star.situation" }]);
  });

  it("an applied user_edit field is no longer protected", () => {
    const r = run(
      output({ star_patches: [star("situation", "결제 승인 API가 느려졌다", ["결제 승인 API가 느려졌어요"], "append")] }),
      ctxFor({ project: emptyProject({ situation: "내가 쓴 상황" }), structuredDraft: { star: { situation: field("내가 쓴 상황", { origin: "user_edit", applied_at: "2026-11-02T00:00:00Z" }) } } }),
    );
    expect(r.rejections).toEqual([]);
  });

  it("C-14 length: an append that would pass 2,000 chars is rejected and flagged", () => {
    const long = "가".repeat(1990);
    const ctx = ctxFor({ project: emptyProject({ situation: long }) });
    expect(mergedStarLength("situation", ctx.v9.project, ctx.v9.draft)).toBe(1990);
    expect(remainingStarChars("situation", ctx.v9.project, ctx.v9.draft)).toBe(9);
    const r = run(output({ star_patches: [star("situation", "결제 승인 API가 느려졌다", ["결제 승인 API가 느려졌어요"], "append")] }), ctx);
    expect(r.rejections).toEqual([{ check: "length", target: "star.situation" }]);
    expect(r.flags.lengthFull).toEqual(["situation"]);
  });

  it("C-14 length counts the pending proposal too", () => {
    const ctx = ctxFor({ project: emptyProject({ situation: "가".repeat(1000) }), structuredDraft: { star: { situation: field("나".repeat(990), { op: "append" }) } } });
    expect(mergedStarLength("situation", ctx.v9.project, ctx.v9.draft)).toBe(1991);
    const r = run(output({ star_patches: [star("situation", "결제 승인 API가 느려졌다", ["결제 승인 API가 느려졌어요"], "append")] }), ctx);
    expect(r.rejections[0]).toMatchObject({ check: "length" });
  });

  it("C-14 limit: patches beyond 10 per turn are rejected", () => {
    // Alternating sentences: a sentence already in the previous patch would be a no-op (v4.6 dedupe).
    const many = Array.from({ length: MAX_PATCHES_PER_TURN + 2 }, (_, i) =>
      i % 2 === 0 ? star("situation", "결제 승인 API가 느려졌다", ["결제 승인 API가 느려졌어요"]) : star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"]),
    );
    const r = run(output({ star_patches: many }));
    expect(r.rejections.filter((x) => x.check === "limit")).toHaveLength(2);
    expect(r.changes.star).toHaveLength(MAX_PATCHES_PER_TURN);
  });
});

describe("validateExtractOutput — V-9f actor", () => {
  const TEAM = "저희 팀이 Redis 캐시를 붙여서 조회가 빨라졌어요.";
  const teamCtx = (extra: Partial<WritingChatTurnInput> = {}) => ctxFor(extra, [["assistant", GREETING], ["user", TEAM]]);
  const teamAction = star("action", "Redis 캐시를 붙여 조회 속도를 높였다", [TEAM]);

  it("moves a team action to a needs_review situation when both situations are empty", () => {
    const r = run(output({ star_patches: [teamAction] }), teamCtx());
    expect(r.changes.star).toEqual([expect.objectContaining({ field: "situation", op: "set", review: "needs_review" })]);
    expect(r.changes.clarifications).toEqual([{ kind: "actor_ambiguous", field: "action" }]);
    expect(r.flags.actorAmbiguous).toEqual([{ section: "star", field: "action" }]);
    expect(r.report.actor_ambiguous).toBe(1);
  });

  it.each([
    ["the project has a situation", { project: emptyProject({ situation: "기존 상황" }) }],
    ["the proposal has a situation", { structuredDraft: { star: { situation: field("제안된 상황") } } }],
  ])("drops the value when %s", (_name, extra) => {
    const r = run(output({ star_patches: [teamAction] }), teamCtx(extra as Partial<WritingChatTurnInput>));
    expect(r.changes.star).toEqual([]);
    expect(r.changes.clarifications).toEqual([{ kind: "actor_ambiguous", field: "action" }]);
  });

  it("resolves an old actor_ambiguous clarification when an own action arrives, keeps others", () => {
    const draft = { clarifications: [{ kind: "actor_ambiguous", field: "action" }, { kind: "period_unclear", field: "start_month" }] };
    const r = run(output({ star_patches: [ACTION] }), ctxFor({ structuredDraft: draft }));
    expect(r.changes.clarifications).toEqual([{ kind: "period_unclear", field: "start_month" }]);
  });

  it("keeps clarifications unchanged (null) when nothing changes", () => {
    const draft = { clarifications: [{ kind: "number_vague", field: "result" }] };
    expect(run(output({ star_patches: [SITUATION] }), ctxFor({ structuredDraft: draft })).changes.clarifications).toBeNull();
  });

  it("maps model clarifications without their note", () => {
    const r = run(output({ clarifications: [{ kind: "period_unclear", field: null, note: "작년 봄" }, { kind: "number_vague", field: null, note: "정도만" }] }));
    expect(r.changes.clarifications).toEqual([{ kind: "period_unclear", field: "start_month" }, { kind: "number_vague", field: "result" }]);
    expect(JSON.stringify(r)).not.toContain("작년 봄");
  });
});

describe("validateExtractOutput — V-9g sensitive", () => {
  it("rejects sensitive values and counts once per pending message and category", () => {
    const text = "우울증 치료로 쉬었다가 복귀했어요. 결제 모듈 리팩터링을 맡았어요.";
    const ctx = ctxFor({}, [["assistant", GREETING], ["user", text]]);
    const r = run(
      output({
        star_patches: [
          star("situation", "우울증 치료로 쉬었다가 복귀했다", ["우울증 치료로 쉬었다가 복귀했어요"]),
          star("action", "결제 모듈 리팩터링을 맡았다", ["결제 모듈 리팩터링을 맡았어요"]),
        ],
        sensitive_flags: [{ category: "health", message_id: "M2" }, { category: "religion", message_id: "M1" }],
      }),
      ctx,
    );
    expect(r.rejections.map((x) => x.check)).toEqual(["V-9g"]);
    expect(r.changes.sensitive_flags_add).toBe(1);
    expect(r.flags.sensitiveAdded).toBe(1);
    expect(r.changes.star.map((s) => s.field)).toEqual(["action"]);
  });

  it("v4.9: only the value is checked — a sensitive quote the value did not carry over passes", () => {
    const text = "우울증 치료로 쉬었다가 복귀해서 결제 모듈 리팩터링을 맡았어요.";
    const ctx = ctxFor({}, [["assistant", GREETING], ["user", text]]);
    const r = run(output({ star_patches: [star("action", "결제 모듈 리팩터링을 맡음", ["우울증 치료로 쉬었다가 복귀해서 결제 모듈 리팩터링을 맡았어요"])] }), ctx);
    expect(r.rejections).toEqual([]);
    expect(r.changes.star).toMatchObject([{ field: "action", review: "ok" }]);
    expect(r.changes.sensitive_flags_add).toBe(0);
  });

  it("v4.9: a work-domain value is kept (no V-9g)", () => {
    const text = "제가 병원 예약 시스템의 출산 휴가 신청 기능을 개발했어요.";
    const ctx = ctxFor({}, [["assistant", GREETING], ["user", text]]);
    expect(ctx.sensitiveNotice).toEqual([]);
    const r = run(output({ star_patches: [star("action", "병원 예약 시스템의 출산 휴가 신청 기능을 개발함", ["병원 예약 시스템의 출산 휴가 신청 기능을 개발했어요"])] }), ctx);
    expect(r.rejections).toEqual([]);
  });

  it("does not count messages already extracted", () => {
    const ctx = ctxFor({ lastExtractedSequence: 2 }, [["assistant", GREETING], ["user", "우울증이 있었어요"], ["assistant", "네"], ["user", "결제 일을 했어요"]]);
    const r = run(output({ sensitive_flags: [{ category: "health", message_id: "M2" }] }), ctx);
    expect(r.changes.sensitive_flags_add).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// v4.9 (RQ-5) merged proposals: existing text as a source, V-9j, unchanged, length
// ---------------------------------------------------------------------------

describe("validateExtractOutput — merged proposal (v4.9 RQ-5)", () => {
  const RESULT = "응답 시간이 1.2초에서 0.7초로 줄었다";
  const NEW = "에러율도 절반으로 줄었어요";
  const turns = [["assistant", GREETING], ["user", NEW]] as const;
  const filledResult = () => ctxFor({ project: filledProject({ result: RESULT }) }, turns);

  it("V-9c / V-9e: the existing text is a source for the merged value", () => {
    const value = "응답 시간이 1.2초에서 0.7초로 줄었고 에러율도 절반으로 줄었음";
    const r = run(output({ star_patches: [star("result", value, [NEW])] }), filledResult());
    expect(r.rejections).toEqual([]);
    expect(r.changes.star).toMatchObject([{ field: "result", op: "set", value, review: "ok" }]);
    // The same value on an empty field: 1.2초 / 0.7초 are not in the quote.
    const empty = run(output({ star_patches: [star("result", value, [NEW])] }), ctxFor({}, turns));
    expect(empty.rejections).toEqual([{ check: "V-9c", target: "star.result" }]);
  });

  it("V-9a / V-9b still need a user message and a real quote", () => {
    expect(run(output({ star_patches: [star("result", `${RESULT}음`, [])] }), filledResult()).rejections).toEqual([{ check: "V-9b", target: "star.result" }]);
    expect(run(output({ star_patches: [star("result", `${RESULT}음`, ["응답 시간이 1.2초에서"])] }), filledResult()).rejections).toEqual([{ check: "V-9b", target: "star.result" }]);
  });

  it("an append's sources stay the quotes only (legacy)", () => {
    const r = run(output({ star_patches: [star("result", "응답 시간이 0.7초가 되었다", [NEW], "append")] }), filledResult());
    expect(r.rejections).toEqual([{ check: "V-9c", target: "star.result" }]);
  });

  it("V-9j: a missing existing number → needs_review (counted, flagged)", () => {
    const r = run(output({ star_patches: [star("result", "응답 시간이 줄었고 에러율도 절반으로 줄었음", [NEW])] }), filledResult());
    expect(r.rejections).toEqual([]);
    expect(r.changes.star).toMatchObject([{ field: "result", op: "set", review: "needs_review" }]);
    expect(r.report).toMatchObject({ merged: 1, preservation_review: 1, needs_review: 1 });
    expect(r.flags.needsReview).toEqual([{ section: "star", field: "result" }]);
  });

  it("V-9j: a missing existing name (English token, skill) → needs_review", () => {
    const ctx = ctxFor({ project: filledProject({ action: "APM과 Redis로 병목 쿼리를 찾음" }) }, [["assistant", GREETING], ["user", "인덱스를 다시 설계했어요"]]);
    const kept = run(output({ star_patches: [star("action", "APM과 Redis로 병목 쿼리를 찾고 인덱스를 다시 설계함", ["인덱스를 다시 설계했어요"])] }), ctx);
    expect(kept.changes.star[0].review).toBe("ok");
    const dropped = run(output({ star_patches: [star("action", "APM으로 병목 쿼리를 찾고 인덱스를 다시 설계함", ["인덱스를 다시 설계했어요"])] }), ctx);
    expect(dropped.changes.star[0].review).toBe("needs_review");
    expect(dropped.report.preservation_review).toBe(1);
  });

  it.each([
    ["30%", "응답 시간이 30% 줄었다", "응답 시간이 30% 줄었음", true],
    ["30% → 30명", "응답 시간이 30% 줄었다", "응답 시간이 줄고 30명이 썼음", false],
    ["1,200명", "1,200명이 사용했다", "1200명이 사용함", true],
    ["2년 6개월", "2년 6개월 운영했다", "2년 동안 운영함", false],
    ["Kafka ↔ 카프카", "Kafka로 이벤트를 받았다", "카프카로 이벤트를 받음", true],
    ["no facts", "결제가 느렸다", "결제 승인 지연을 해결함", true],
  ])("preservesExisting %s", (_name, existing, value, ok) => {
    expect(preservesExisting(value, [existing])).toBe(ok);
  });

  it("the merged value equal to the existing text (normalized) or part of it is unchanged", () => {
    const same = run(output({ star_patches: [star("result", "응답 시간이 1.2초에서  0.7초로 줄었다.", [NEW])] }), filledResult());
    expect(same.changes.star).toEqual([]);
    expect(same.report.unchanged).toBe(1);
    const part = run(output({ star_patches: [star("result", "0.7초로 줄었다", [NEW])] }), filledResult());
    expect(part.changes.star).toEqual([]);
    expect(part.report.unchanged).toBe(1);
  });

  it("existing text = form value + pending proposal: both are sources and both are kept; sources carried", () => {
    const say = "배포도 주 1회에서 매일로 바뀌었어요";
    const ctx = ctxFor(
      { project: filledProject({ result: RESULT }), structuredDraft: { star: { result: field("에러율이 3%에서 1%로 줄었음", { op: "set", source_quotes: ["에러율이 3%에서 1%로"] }) } }, lastExtractedSequence: 3 },
      [["assistant", GREETING], ["user", "에러율이 3%에서 1%로 줄었어요"], ["assistant", "네"], ["user", say]],
    );
    const value = "응답 시간이 1.2초에서 0.7초로 줄고 에러율이 3%에서 1%로 줄었으며 배포가 주 1회에서 매일로 바뀌었음";
    const r = run(output({ star_patches: [star("result", value, [say], "set", ["M4"])] }), ctx);
    expect(r.rejections).toEqual([]);
    expect(r.changes.star).toMatchObject([{ op: "set", review: "ok", source_message_ids: [msgId(4), msgId(2)], source_quotes: [say, "에러율이 3%에서 1%로"] }]);
    expect(r.changes.star[0].new_object).toBeUndefined();
    // Dropping the pending proposal's numbers → V-9j.
    const dropped = run(output({ star_patches: [star("result", "응답 시간이 1.2초에서 0.7초로 줄고 배포가 주 1회에서 매일로 바뀌었음", [say], "set", ["M4"])] }), ctx);
    expect(dropped.changes.star[0].review).toBe("needs_review");
  });

  it("C-14 length: a merged set is checked by its own length (replacement), not current + value", () => {
    const existing = "결제 승인 지연을 줄임. ".repeat(100).trim();
    expect(existing.length).toBeGreaterThan(1000);
    const ctx = ctxFor({ project: filledProject({ result: existing }) }, [["assistant", GREETING], ["user", "인덱스를 다시 설계했어요"]]);
    const value = `${existing} 인덱스를 다시 설계함.`;
    expect(existing.length + 1 + value.length).toBeGreaterThan(STAR_FIELD_MAX_LENGTH);
    const r = run(output({ star_patches: [star("result", value, ["인덱스를 다시 설계했어요"])] }), ctx);
    expect(r.rejections).toEqual([]);
    expect(r.changes.star[0].op).toBe("set");
    const over = run(output({ star_patches: [star("result", `${value}${"가".repeat(STAR_FIELD_MAX_LENGTH)}`, ["인덱스를 다시 설계했어요"])] }), ctx);
    expect(over.rejections).toEqual([{ check: "length", target: "star.result" }]);
  });

  it("mergedStarLength: a pending set replaces the field; a pending append adds to it", () => {
    const project = { ...ctxFor({ project: filledProject({ result: "가".repeat(100) }) }).v9.project };
    const setDraft = ctxFor({ structuredDraft: { star: { result: field("나".repeat(300), { op: "set" }) } } }).v9.draft;
    const appendDraft = ctxFor({ structuredDraft: { star: { result: field("나".repeat(300), { op: "append" }) } } }).v9.draft;
    expect(mergedStarLength("result", project, setDraft)).toBe(300);
    expect(mergedStarLength("result", project, appendDraft)).toBe(401);
  });
});

describe("R8 QA round 1: review_reason, source cap, legacy append", () => {
  const RESULT = "응답 시간이 1.2초에서 0.7초로 줄었다";
  const NEW = "에러율도 절반으로 줄었어요";
  const filledResult = () => ctxFor({ project: filledProject({ result: RESULT }) }, [["assistant", GREETING], ["user", NEW]]);

  it("review_reason: V-9j → existing_missing, V-9e → content_unverified, ok → null; toDraftPatch sends it next to review", () => {
    const missing = run(output({ star_patches: [star("result", "응답 시간이 줄었고 에러율도 절반으로 줄었음", [NEW])] }), filledResult());
    expect(missing.changes.star[0]).toMatchObject({ review: "needs_review", review_reason: "existing_missing" });
    expect(toDraftPatch(missing.changes).ops[0]).toMatchObject({ review: "needs_review", review_reason: "existing_missing" });

    const loose = run(output({ star_patches: [star("action", "전사 결제 플랫폼 아키텍처를 주도적으로 설계하고 팀 생산성을 높였다", ["인덱스를 다시 설계했어요"])] }));
    expect(loose.changes.star[0]).toMatchObject({ review: "needs_review", review_reason: "content_unverified" });

    const ok = run(output({ star_patches: [star("result", "응답 시간이 1.2초에서 0.7초로 줄었고 에러율도 절반으로 줄었음", [NEW])] }), filledResult());
    expect(ok.changes.star[0]).toMatchObject({ review: "ok", review_reason: null });
    expect(toDraftPatch(ok.changes).ops[0]).not.toHaveProperty("review_reason");
  });

  it("V-9j wins over V-9e when both apply", () => {
    const r = run(output({ star_patches: [star("result", "전사 매출 구조와 조직 문화를 혁신했음", [NEW])] }), filledResult());
    expect(r.changes.star[0]).toMatchObject({ review: "needs_review", review_reason: "existing_missing" });
  });

  it("QA-06: carried sources beyond 20 are clamped by toDraftPatch (new sources first), so the RPC never sees > 20", () => {
    const priorIds = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`);
    const priorQuotes = Array.from({ length: 20 }, (_, i) => `이전 인용 ${i}`);
    const ctx = ctxFor(
      { project: filledProject({ result: RESULT }), structuredDraft: { star: { result: field("에러율이 3%에서 1%로 줄었음", { op: "set", source_message_ids: priorIds, source_quotes: priorQuotes }) } } },
      [["assistant", GREETING], ["user", NEW]],
    );
    const r = run(output({ star_patches: [star("result", "응답 시간이 1.2초에서 0.7초로 줄고 에러율이 3%에서 1%로 줄었으며 에러율도 절반으로 줄었음", [NEW])] }), ctx);
    expect(r.changes.star[0].source_message_ids).toHaveLength(21);
    const op = toDraftPatch(r.changes).ops[0] as { source_message_ids: string[]; source_quotes: string[] };
    expect(op.source_message_ids).toHaveLength(20);
    expect(op.source_message_ids[0]).toBe(msgId(2));
    expect(op.source_quotes).toHaveLength(20);
    expect(op.source_quotes[0]).toBe(NEW);
  });

  it("QA-01: no op `append` reaches the RPC for a field with existing text", () => {
    const r = run(output({ star_patches: [star("result", "에러율도 절반으로 줄었다", [NEW], "append")] }), filledResult());
    expect(toDraftPatch(r.changes).ops).toMatchObject([{ op: "set", value: `${RESULT}\n에러율도 절반으로 줄었다` }]);
    // An append whose sentence is already there is still a no-op.
    const dup = run(output({ star_patches: [star("result", "0.7초로 줄었다", [NEW], "append")] }), filledResult());
    expect(dup.changes.star).toEqual([]);
  });
});

describe("V-9e ㅁ 명사형 (R8 QA-04)", () => {
  it.each([
    ["만듦", ["만들"]],
    ["이끎", ["이끌"]],
    ["맡음", ["맡으", "맡"]],
    ["높임", ["높이", "높"]],
    ["설계", []],
    ["프로그램", []],
  ])("nominalStems(%s) = %j", (token, stems) => {
    expect(nominalStems(token)).toEqual(stems);
  });

  it.each([
    ["관리자 대시보드를 만듦", ["관리자 대시보드를 만들었어요"]],
    ["백엔드 API 개발을 맡음", ["백엔드 API 개발을 맡았어요"]],
    ["전환율을 높임", ["전환율을 높였어요"]],
    ["처리 시간을 줄임", ["처리 시간을 줄였어요"]],
    ["배포 파이프라인을 바꿈", ["배포 파이프라인을 바꿨어요"]],
    ["프로젝트를 이끎", ["프로젝트를 이끌었어요"]],
  ])("%s ↔ %j → 0 uncovered", (value, quotes) => {
    expect(uncoveredRatio(value, quotes)).toBe(0);
  });

  it("a one-syllable stem must start a word in the quotes", () => {
    expect(uncoveredRatio("시간을 줄임", ["시간이 오줄었어요"])).toBeGreaterThan(0);
  });
});

describe("-음 체 (v4.9 RQ-4): suffixes and V-9e", () => {
  it.each([
    ["설계함", "설계"],
    ["줄었음", "줄었"],
    ["개선했음", "개선"],
    ["정리하였음", "정리"],
    ["도입됨", "도입"],
    ["도입되었음", "도입"],
    ["기능임", "기능"],
    ["바뀌었음", "바뀌"],
    ["만들었음", "만들"],
    ["포함", "포함"],
    ["처음", "처음"],
  ])("stripKoreanSuffix(%s) = %s", (word, stem) => {
    expect(stripKoreanSuffix(word)).toBe(stem);
  });

  it("each -음 ending comes before every shorter entry it ends with (longest first)", () => {
    for (const suffix of ["하였음", "했었음", "되었음", "했음", "됐음", "었음", "였음", "았음", "함", "됨", "음", "임"]) {
      const at = KOREAN_SUFFIXES.indexOf(suffix);
      expect(at).toBeGreaterThanOrEqual(0);
      for (const other of KOREAN_SUFFIXES) {
        if (other !== suffix && suffix.endsWith(other)) expect(KOREAN_SUFFIXES.indexOf(other)).toBeGreaterThan(at);
      }
    }
  });

  it.each([
    ["캐시 무효화 규칙을 설계함", ["캐시 무효화 규칙을 설계했어요"]],
    ["배포 시간이 40분에서 10분으로 줄었음", ["배포 시간이 40분에서 10분으로 줄었어요"]],
    ["결제 실패 문의가 많았음", ["결제 실패 문의가 많았어요"]],
    ["주문 조회 캐시를 도입함", ["주문 조회에 캐시를 도입했습니다"]],
  ])("V-9e: %s passes against %j", (value, quotes) => {
    expect(uncoveredRatio(value, quotes)).toBeLessThanOrEqual(V9E_MAX_UNCOVERED_RATIO);
    expect(uncoveredRatio(value, quotes)).toBe(0);
  });

  it("a -음 체 STAR value passes V-9 end to end with review ok", () => {
    const ctx = ctxFor({}, [["assistant", GREETING], ["user", "저는 캐시 무효화 규칙을 설계했어요"]]);
    const r = run(output({ star_patches: [star("action", "캐시 무효화 규칙을 설계함", ["캐시 무효화 규칙을 설계했어요"])] }), ctx);
    expect(r.changes.star).toMatchObject([{ field: "action", review: "ok" }]);
  });
});

// ---------------------------------------------------------------------------
// v4.10 (UP-14): STAR markdown — validators compare plain text, the stored value is the model's markdown
// ---------------------------------------------------------------------------

describe("validateExtractOutput — markdown STAR (v4.10 UP-14)", () => {
  const LIST = "1. 결제 실패 문의가 줄었음\n2. **정산 오류**가 사라졌음";
  const NEW = "배치 시간도 30분에서 5분으로 줄었어요";
  const turns = [["assistant", GREETING], ["user", NEW]] as const;
  const listResult = (result = LIST) => ctxFor({ project: filledProject({ result }) }, turns);

  it("a merged set that adds an item to a numbered list passes: list numbers are not numbers (V-9c, V-9j)", () => {
    const value = "1. 결제 실패 문의가 줄었음\n2. 정산 오류가 사라졌음\n3. 배치 시간이 30분에서 5분으로 줄었음";
    const r = run(output({ star_patches: [star("result", value, [NEW])] }), listResult());
    expect(r.rejections).toEqual([]);
    // Stored as the model returned it (markdown list kept).
    expect(r.changes.star).toMatchObject([{ field: "result", op: "set", value, review: "ok", review_reason: null }]);
    expect(r.report).toMatchObject({ merged: 1, preservation_review: 0 });
  });

  it("dropping the numbering (one paragraph) is not existing_missing", () => {
    const value = "결제 실패 문의가 줄었고 정산 오류가 사라졌으며 배치 시간이 30분에서 5분으로 줄었음";
    const r = run(output({ star_patches: [star("result", value, [NEW])] }), listResult());
    expect(r.changes.star).toMatchObject([{ review: "ok" }]);
  });

  it("V-9j still catches a real number missing from a list item", () => {
    const ctx = listResult("1. 문의가 40% 줄었음\n2. 정산 오류가 사라졌음");
    const value = "1. 문의가 줄었음\n2. 정산 오류가 사라졌음\n3. 배치 시간이 30분에서 5분으로 줄었음";
    const r = run(output({ star_patches: [star("result", value, [NEW])] }), ctx);
    expect(r.changes.star).toMatchObject([{ review: "needs_review", review_reason: "existing_missing" }]);
  });

  it("V-9c still rejects a new number that only looks like a list item elsewhere", () => {
    const value = "1. 결제 실패 문의가 줄었음\n2. 정산 오류가 사라졌음\n3. 배치 시간이 30분에서 3분으로 줄었음";
    expect(run(output({ star_patches: [star("result", value, [NEW])] }), listResult()).rejections).toEqual([{ check: "V-9c", target: "star.result" }]);
  });

  it("existing markdown (headings, emphasis, escapes, &lt;) is a plain source for V-9c / V-9d / V-9e", () => {
    const existing = "### 지표\n- **p99** 지연 1.2초 \\[측정\\]\n- `Redis` 캐시 &lt;hit> 비율 80%";
    const ctx = ctxFor({ project: filledProject({ result: existing }) }, turns);
    const value = "### 지표\n- p99 지연 1.2초 [측정]\n- Redis 캐시 &lt;hit> 비율 80%\n- 배치 시간이 30분에서 5분으로 줄었음";
    const r = run(output({ star_patches: [star("result", value, [NEW])] }), ctx);
    expect(r.rejections).toEqual([]);
    expect(r.changes.star).toMatchObject([{ value, review: "ok" }]);
    // A raw `<hit>` in the model's markdown is an HTML tag (not shown) → the existing name is missing.
    const tag = run(output({ star_patches: [star("result", value.replace("&lt;hit>", "<hit>"), [NEW])] }), ctx);
    expect(tag.changes.star).toMatchObject([{ review: "needs_review", review_reason: "existing_missing" }]);
  });

  it("a formatting-only rewrite of the existing text is unchanged (no new content)", () => {
    const r = run(output({ star_patches: [star("result", "- 결제 실패 문의가 줄었음\n- 정산 오류가 사라졌음", [NEW])] }), listResult());
    expect(r.report.unchanged).toBe(1);
    expect(r.changes.star).toEqual([]);
  });

  it("a pending proposal the editor re-escaped on [반영] still counts as in the form", () => {
    const proposal = "1. a < b 조건의 [메모] _초안_ 비율이 2배 늘었음";
    const ctx = ctxFor(
      { project: filledProject({ result: "1. a < b 조건의 \\[메모\\] *초안* 비율이 2배 늘었음" }), structuredDraft: { star: { result: field(proposal) } } },
      turns,
    );
    const r = run(output({ star_patches: [star("result", "1. a < b 조건의 [메모] 초안 비율이 2배 늘었음\n2. 배치 시간이 30분에서 5분으로 줄었음", [NEW])] }), ctx);
    expect(r.changes.star).toMatchObject([{ field: "result", new_object: true }]);
  });

  // R9 QA-02: a line-leading number that is not a list marker is a body number
  it("V-9c checks line-leading body numbers (QA-02 probes)", () => {
    const quotes = ["서비스를 출시했어요"];
    expect(checkTextNumbers(plainForValidation("2024. 서비스를 출시함"), quotes)).toBe(false);
    expect(checkTextNumbers(plainForValidation("300) 명이 가입함"), quotes)).toBe(false);
    expect(checkTextNumbers(plainForValidation("1. 서비스를 출시함"), quotes)).toBe(true);
  });

  it("V-9j keeps a line-leading year of the existing text (QA-02 probes)", () => {
    expect(preservesExisting("3월부터 결제 개선을 맡음", ["2023. 03 ~ 결제 개선을 맡음"])).toBe(false);
    expect(preservesExisting("2023. 03부터 결제 개선을 맡음", ["2023. 03 ~ 결제 개선을 맡음"])).toBe(true);
  });

  it("containsNormalized finds one list item cut out of a list (QA-02 fragment)", () => {
    expect(containsNormalized("1. 응답 개선\n2. 오류 감소", "2. 오류 감소")).toBe(true);
    expect(containsNormalized("2023. 03 ~ 결제 개선", "2023. 03 ~ 결제 개선")).toBe(true);
    expect(containsNormalized("결제 개선", "2023. 03 ~ 결제 개선")).toBe(false);
  });

  it("V-9c accepts an existing line-leading year rewritten as 2023년 (QA-02 probes)", () => {
    const existing = plainForValidation("2023. 3월 입사");
    expect(checkTextNumbers(plainForValidation("2023년 3월 입사"), [existing])).toBe(true);
  });

  it("preservesExisting compares plain text", () => {
    expect(preservesExisting("응답 2초 → 0.5초, 오류 감소", ["1. 응답 2초 → 0.5초\n2. 오류 감소"])).toBe(true);
    expect(preservesExisting("응답이 줄었음", ["1. 응답 **2초** → 0.5초"])).toBe(false);
  });
});

describe("validateExtractOutput — V-9i classification", () => {
  const ready = () => ctxFor({ project: emptyProject({ situation: "상황", action: "행동" }) });
  const sugg = (s: Partial<Ai12ExtractOutput["classification_suggestions"]>) =>
    output({ classification_suggestions: { project_type: null, experience_type: null, competencies: null, ...s } });

  it("accepts keys from the list with user sources and a clean reason", () => {
    const r = run(
      sugg({
        project_type: { value: "improvement", source_message_ids: ["M2"], reason: "M2에서 말한 성능 개선 작업" },
        experience_type: { value: "problem_solving", source_message_ids: ["M1", "M2"], reason: null },
      }),
      ready(),
    );
    expect(r.changes.classification).toEqual([
      { field: "project_type", value: "improvement", source_message_ids: [msgId(2)], reason: "말한 성능 개선 작업" },
      { field: "experience_type", value: "problem_solving", source_message_ids: [msgId(2)], reason: null },
    ]);
    expect(r.report.applied).toBe(2);
  });

  it("① drops a value outside the CR-17 list (cast past zod)", () => {
    const out = sugg({ project_type: { value: "rocket_science" as never, source_message_ids: [], reason: null } });
    expect(run(out, ready()).rejections).toEqual([{ check: "V-9i", target: "classification.project_type" }]);
  });

  it("②: competencies — unknown keys dropped, duplicates removed, first 3 kept", () => {
    const value = ["analysis", "analysis", "bogus", "planning", "execution", "leadership"] as never;
    const r = run(sugg({ competencies: { value, source_message_ids: [], reason: null } }), ready());
    expect(r.changes.classification).toEqual([{ field: "competencies", value: ["analysis", "planning", "execution"], source_message_ids: [], reason: null }]);
  });

  it("③ drops a suggestion for a field the user already chose (competencies: any chosen)", () => {
    const ctx = ctxFor({ project: emptyProject({ situation: "상황", action: "행동", projectType: "operation", competencies: ["analysis"] }) });
    const r = run(
      sugg({
        project_type: { value: "improvement", source_message_ids: [], reason: null },
        competencies: { value: ["planning"], source_message_ids: [], reason: null },
        experience_type: { value: "impact", source_message_ids: [], reason: null },
      }),
      ctx,
    );
    expect(r.rejections.map((x) => x.target)).toEqual(["classification.project_type", "classification.competencies"]);
    expect(r.changes.classification.map((c) => c.field)).toEqual(["experience_type"]);
  });

  it("③ drops a suggestion over a user_edit proposal", () => {
    const ctx = ctxFor({ project: emptyProject({ situation: "상황", action: "행동" }), structuredDraft: { classification: { project_type: field("operation", { origin: "user_edit" }) } } });
    expect(run(sugg({ project_type: { value: "improvement", source_message_ids: [], reason: null } }), ctx).rejections).toHaveLength(1);
  });

  it("④ removes non-user source ids, keeps the suggestion", () => {
    const r = run(sugg({ project_type: { value: "improvement", source_message_ids: ["M1", "M9"], reason: null } }), ready());
    expect(r.changes.classification[0].source_message_ids).toEqual([]);
  });

  it("⑤ drops suggestions until situation and action exist (proposal or this turn counts)", () => {
    const s = sugg({ project_type: { value: "improvement", source_message_ids: [], reason: null } });
    expect(run(s).rejections).toEqual([{ check: "V-9i", target: "classification.project_type" }]);
    const sameTurn = run({ ...s, star_patches: [SITUATION, ACTION] });
    expect(sameTurn.changes.classification).toHaveLength(1);
  });

  it("clips the reason to 100 chars and drops a sensitive reason", () => {
    const long = run(sugg({ project_type: { value: "improvement", source_message_ids: [], reason: "가".repeat(300) } }), ready());
    expect(long.changes.classification[0].reason).toHaveLength(100);
    const health = run(sugg({ project_type: { value: "improvement", source_message_ids: [], reason: "우울증 치료 뒤 복귀" } }), ready());
    expect(health.changes.classification[0].reason).toBeNull();
  });

  it("UP-6 [무시]: a suggestion for a dismissed field (value null, rev ≥ 2) is dropped silently — counted, not a rejection", () => {
    const ctx = ctxFor({
      project: emptyProject({ situation: "상황", action: "행동" }),
      structuredDraft: { classification: { project_type: field(null, { rev: 2, reviewed_at: "2026-11-04T00:00:00Z", source_message_ids: [] }) } },
    });
    const r = run(
      sugg({
        project_type: { value: "improvement", source_message_ids: [], reason: null },
        experience_type: { value: "impact", source_message_ids: [], reason: null },
      }),
      ctx,
    );
    expect(r.changes.classification.map((c) => c.field)).toEqual(["experience_type"]);
    expect(r.rejections).toEqual([]);
    expect(r.report).toMatchObject({ classification_dismissed: 1, rejected: 0, applied: 1 });
  });

  it("UP-6: an empty rev-1 slot (never written by the RPC) is not dismissed", () => {
    const ctx = ctxFor({ project: emptyProject({ situation: "상황", action: "행동" }), structuredDraft: { classification: { project_type: field(null, { rev: 1 }) } } });
    const r = run(sugg({ project_type: { value: "improvement", source_message_ids: [], reason: null } }), ctx);
    expect(r.changes.classification).toHaveLength(1);
    expect(r.report.classification_dismissed).toBe(0);
  });

  it("same value as the pending suggestion is unchanged", () => {
    const ctx = ctxFor({ project: emptyProject({ situation: "상황", action: "행동" }), structuredDraft: { classification: { competencies: field(["analysis"]) } } });
    const r = run(sugg({ competencies: { value: ["analysis"], source_message_ids: [], reason: null } }), ctx);
    expect(r.report.unchanged).toBe(1);
    expect(r.changes.classification).toEqual([]);
  });
});

describe("toDraftPatch (v3 ops)", () => {
  it("orders ops: sensitive first, period, STAR, classification, clarifications — no aliases", () => {
    const ctx = ctxFor({}, [["assistant", GREETING], ["user", `${SAY} 우울증 치료도 받았어요.`]]);
    const r = validateExtractOutput(
      output({
        project_patches: [{ field: "start_month", op: "set", value: "2023-03", source_message_ids: ["M2"], source_quotes: ["23년 3월부터 했어요"] }],
        star_patches: [SITUATION, ACTION],
        classification_suggestions: { project_type: { value: "improvement", source_message_ids: ["M2"], reason: null }, experience_type: null, competencies: null },
        clarifications: [{ kind: "number_vague", field: "result", note: null }],
        sensitive_flags: [{ category: "health", message_id: "M2" }],
      }),
      ctx.v9,
    );
    const patch = toDraftPatch(r.changes);
    expect(patch.ops.map((o) => ("target" in o ? `${o.op}:${o.target.section}.${o.target.field}` : o.op))).toEqual([
      "add_sensitive_flags",
      "set:project.start_month",
      "set:star.situation",
      "set:star.action",
      "set:classification.project_type",
      "set_clarifications",
    ]);
    expect(JSON.stringify(patch)).not.toMatch(/"M-?\d+"/);
  });
});
