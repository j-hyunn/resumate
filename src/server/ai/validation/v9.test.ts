import { describe, expect, it } from "vitest";
import { baseInput, emptyProject, filledProject, GREETING, msgId, output, rows } from "../__fixtures__/AI-12/conversations";
import { buildWritingChatContext, type WritingChatTurnInput } from "../context-pack/writing-chat";
import type { Ai12ExtractOutput } from "../schemas/AI-12";
import { toDraftPatch } from "../schemas/structured-draft";
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
  normalizeMessageAlias,
  remainingStarChars,
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

describe("V-9g sensitive", () => {
  it.each([
    ["우울증 치료를 받느라 쉬었어요", ["health"]],
    ["병가를 냈어요", ["health"]],
    ["주말엔 교회에 가요", ["religion"]],
    ["노조 활동을 했어요", ["union"]],
    ["지지 정당 얘기가 나왔어요", ["politics"]],
    ["연락처는 010-1234-5678이에요", ["contact"]],
    ["메일 test.user@example.com", ["contact"]],
    ["김민수 팀장님이 리뷰를 했어요", ["third_party_name"]],
    ["박지연님과 협업했어요", ["third_party_name"]],
    ["장애 대응을 맡았어요", []],
    ["성능 문제를 진단했어요", []],
    ["이번 팀장님이 오셨어요", []],
    ["정말 팀장님이 많이 도와주셨어요", []],
    ["부장님께 보고했어요", []],
    ["정산 팀장님이 요청했어요", []],
    ["정산팀 팀장님이 요청했어요", []],
    ["남궁민 대리가 도와줬어요", ["third_party_name"]],
    ["이사님이 승인했어요", []],
    ["고객님 문의가 많았어요", []],
    ["전임 과장이 만든 코드", []],
    ["결제 API 응답 시간을 줄였어요", []],
  ])("%s → %j", (text, categories) => {
    expect(detectSensitive(text)).toEqual(categories);
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

const field = (value: string | string[], extra: Record<string, unknown> = {}) => ({
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

  it("V-9h: a filled project field takes append only", () => {
    const ctx = ctxFor({ project: filledProject() });
    const r = run(output({ star_patches: [star("action", "병목 쿼리를 찾았다", ["병목 쿼리를 찾아"]), star("action", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append")] }), ctx);
    expect(r.rejections).toEqual([{ check: "V-9h", target: "star.action" }]);
    expect(r.changes.star.map((s) => `${s.field}:${s.op}`)).toEqual(["action:append"]);
  });

  it("append onto an empty project and an empty proposal becomes set; a second append stays append", () => {
    const r = run(output({ star_patches: [star("situation", SITUATION.value, SITUATION.source_quotes, "append"), star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append")] }));
    expect(r.changes.star.map((s) => s.op)).toEqual(["set", "append"]);
  });

  it("append onto a pending proposal stays append; a set equal to the pending value is unchanged", () => {
    const draft = { star: { situation: field(SITUATION.value) } };
    const r = run(output({ star_patches: [SITUATION, star("action", ACTION.value, ACTION.source_quotes, "append")] }), ctxFor({ structuredDraft: draft }));
    expect(r.report.unchanged).toBe(1);
    expect(r.changes.star.map((s) => `${s.field}:${s.op}`)).toEqual(["action:set"]);
    const appended = run(output({ star_patches: [star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append")] }), ctxFor({ structuredDraft: draft }));
    expect(appended.changes.star.map((s) => s.op)).toEqual(["append"]);
    expect(appended.changes.star[0].new_object).toBeUndefined();
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
      i % 2 === 0 ? star("situation", "결제 승인 API가 느려졌다", ["결제 승인 API가 느려졌어요"], "append") : star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append"),
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
          star("task", "치료 후 복귀했다", ["우울증 치료로 쉬었다가"]),
          star("action", "결제 모듈 리팩터링을 맡았다", ["결제 모듈 리팩터링을 맡았어요"]),
        ],
        sensitive_flags: [{ category: "health", message_id: "M2" }, { category: "religion", message_id: "M1" }],
      }),
      ctx,
    );
    expect(r.rejections.map((x) => x.check)).toEqual(["V-9g", "V-9g"]);
    expect(r.changes.sensitive_flags_add).toBe(1);
    expect(r.flags.sensitiveAdded).toBe(1);
    expect(r.changes.star.map((s) => s.field)).toEqual(["action"]);
  });

  it("does not count messages already extracted", () => {
    const ctx = ctxFor({ lastExtractedSequence: 2 }, [["assistant", GREETING], ["user", "우울증이 있었어요"], ["assistant", "네"], ["user", "결제 일을 했어요"]]);
    const r = run(output({ sensitive_flags: [{ category: "health", message_id: "M2" }] }), ctx);
    expect(r.changes.sensitive_flags_add).toBe(0);
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
