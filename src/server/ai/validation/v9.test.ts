import { describe, expect, it } from "vitest";
import {
  augmentTarget,
  baseInput,
  DETAIL_DONE_ID,
  DETAIL_DRAFT_ID,
  EXP_ID,
  GREETING,
  msgId,
  output,
  rows,
} from "../__fixtures__/AI-12/conversations";
import { buildWritingChatContext } from "../context-pack/writing-chat";
import type { Ai12ExtractOutput } from "../schemas/AI-12";
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
  normalizeMessageAlias,
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

function ctxFor(turns: readonly (readonly ["user" | "assistant", string])[], extra: Parameters<typeof baseInput>[0] = {}) {
  return buildWritingChatContext(baseInput({ messages: rows(turns), ...extra }));
}

function run(out: Ai12ExtractOutput, ctx = ctxFor([["assistant", GREETING], ["user", "결제 승인 API 성능 개선 프로젝트였고 저 포함 4명이었어요."]])) {
  return validateExtractOutput(out, ctx.v9);
}

describe("validateExtractOutput", () => {
  it("applies a valid project patch with UUID sources and the original quote span", () => {
    const r = run(output({ project_patches: [{ field: "team_size", op: "set", value: 4, source_message_ids: ["M2"], source_quotes: ["저 포함 4명이었어요"] }] }));
    expect(r.changes.fields).toEqual([
      {
        target: "project",
        detail_key: null,
        existing_detail_id: null,
        field: "team_size",
        value: 4,
        source_message_ids: [msgId(2)],
        source_quotes: ["저 포함 4명이었어요"],
        review: "ok",
      },
    ]);
    expect(r.report).toMatchObject({ proposed: 1, applied: 1, rejected: 0 });
  });

  it("rejects AI-sourced facts (V-9a) and logs only check + path", () => {
    const ctx = ctxFor([
      ["assistant", GREETING],
      ["user", "결제 프로젝트였어요"],
      ["assistant", "팀은 몇 명이었나요? 4명 정도였나요?"],
      ["user", "네 맞아요"],
    ]);
    const r = run(output({ project_patches: [{ field: "team_size", op: "set", value: 4, source_message_ids: ["M3"], source_quotes: ["4명 정도였나요"] }] }), ctx);
    expect(r.changes.fields).toEqual([]);
    expect(r.rejections).toEqual([{ check: "V-9a", target: "project.team_size" }]);
    expect(JSON.stringify(r.rejections)).not.toContain("4명");
  });

  it("rejects a type error, a bad month, and a too-long value", () => {
    const r = run(
      output({
        project_patches: [
          { field: "team_size", op: "set", value: "네 명", source_message_ids: ["M2"], source_quotes: ["4명"] },
          { field: "start_month", op: "set", value: "2023-3", source_message_ids: ["M2"], source_quotes: ["4명"] },
          { field: "summary", op: "set", value: "가".repeat(201), source_message_ids: ["M2"], source_quotes: ["4명"] },
        ],
      }),
    );
    expect(r.rejections.map((x) => x.check)).toEqual(["type", "type", "length"]);
  });

  it("does not overwrite user_edit or accepted fields", () => {
    const draft = {
      project: {
        name: { value: "내가 고친 이름", origin: "user_edit", source_message_ids: [], source_quotes: [], review: "ok", reviewed_at: null },
        role: { value: "개발", origin: "ai", source_message_ids: [msgId(2)], source_quotes: ["x"], review: "accepted", reviewed_at: "2026-10-28T00:00:00Z" },
      },
    };
    const ctx = ctxFor([["assistant", GREETING], ["user", "결제 승인 API 성능 개선 프로젝트였고 백엔드 리드였어요"]], { structuredDraft: draft });
    const r = run(
      output({
        project_patches: [
          { field: "name", op: "set", value: "결제 승인 API 성능 개선", source_message_ids: ["M2"], source_quotes: ["결제 승인 API 성능 개선"] },
          { field: "role", op: "set", value: "백엔드 리드", source_message_ids: ["M2"], source_quotes: ["백엔드 리드였어요"] },
        ],
      }),
      ctx,
    );
    expect(r.changes.fields).toEqual([]);
    expect(r.report.by_check.protected).toBe(2);
  });

  it("merges append with the current value and its sources", () => {
    const draft = {
      details: [
        {
          detail_key: "D1",
          existing_detail_id: null,
          fields: { action: { value: "쿼리를 분석했다", origin: "ai", source_message_ids: [msgId(2)], source_quotes: ["쿼리를 분석했어요"], review: "ok", reviewed_at: null } },
          achievements: [],
        },
      ],
    };
    const ctx = ctxFor(
      [
        ["assistant", GREETING],
        ["user", "제가 쿼리를 분석했어요"],
        ["assistant", "그다음엔요?"],
        ["user", "제가 인덱스를 추가했어요"],
      ],
      { structuredDraft: draft, lastExtractedSequence: 2 },
    );
    const r = run(
      output({ detail_patches: [{ detail_key: "D1", detail_ref: null, field: "action", op: "append", value: "인덱스를 추가했다", source_message_ids: ["M4"], source_quotes: ["인덱스를 추가했어요"] }] }),
      ctx,
    );
    expect(r.changes.fields[0]).toMatchObject({
      field: "action",
      value: "쿼리를 분석했다 인덱스를 추가했다",
      source_message_ids: [msgId(2), msgId(4)],
      source_quotes: ["쿼리를 분석했어요", "인덱스를 추가했어요"],
      review: "ok",
    });
    expect(r.changes.new_details).toEqual([]);
  });

  it("creates a missing detail key and rejects a patch naming both / neither target", () => {
    const r = run(
      output({
        detail_patches: [
          { detail_key: "D1", detail_ref: null, field: "title", op: "set", value: "결제 승인 API 성능 개선", source_message_ids: ["M2"], source_quotes: ["결제 승인 API 성능 개선"] },
          { detail_key: "D1", detail_ref: "DET-1", field: "task", op: "set", value: "성능 개선", source_message_ids: ["M2"], source_quotes: ["성능 개선"] },
          { detail_key: null, detail_ref: null, field: "task", op: "set", value: "성능 개선", source_message_ids: ["M2"], source_quotes: ["성능 개선"] },
        ],
      }),
    );
    expect(r.changes.new_details).toEqual([{ detail_key: "D1" }]);
    expect(r.rejections.map((x) => x.check)).toEqual(["target", "target"]);
  });

  it("V-9e marks a loose summary needs_review", () => {
    const r = run(
      output({
        detail_patches: [
          { detail_key: "D1", detail_ref: null, field: "result", op: "set", value: "전사 결제 플랫폼의 안정성과 확장성을 크게 끌어올렸다", source_message_ids: ["M2"], source_quotes: ["결제 승인 API 성능 개선"] },
        ],
      }),
    );
    expect(r.changes.fields[0].review).toBe("needs_review");
    expect(r.flags.needsReview).toEqual([{ target: "detail", detail_key: "D1", existing_detail_id: null, field: "result" }]);
  });

  it("V-9f moves a team action to a situation candidate and asks again", () => {
    const ctx = ctxFor([["assistant", GREETING], ["user", "저희 팀이 Redis 캐시를 붙여서 조회가 빨라졌어요."]]);
    const r = run(
      output({ detail_patches: [{ detail_key: "D1", detail_ref: null, field: "action", op: "set", value: "Redis 캐시를 붙였다", source_message_ids: ["M2"], source_quotes: ["저희 팀이 Redis 캐시를 붙여서"] }] }),
      ctx,
    );
    expect(r.changes.fields).toEqual([
      expect.objectContaining({ field: "situation", value: "Redis 캐시를 붙였다", review: "needs_review", detail_key: "D1" }),
    ]);
    expect(r.changes.clarifications).toEqual([{ kind: "actor_ambiguous", field: "action", detail_key: "D1", existing_detail_id: null }]);
    expect(r.flags.actorAmbiguous).toHaveLength(1);
    expect(r.report.actor_ambiguous).toBe(1);
  });

  it("V-9f keeps an existing situation and only adds the clarification", () => {
    const draft = {
      details: [{ detail_key: "D1", existing_detail_id: null, fields: { situation: { value: "조회가 느렸다", origin: "ai", source_message_ids: [msgId(2)], source_quotes: ["x"], review: "ok", reviewed_at: null } }, achievements: [] }],
    };
    const ctx = ctxFor([["assistant", GREETING], ["user", "저희가 캐시를 붙였어요"]], { structuredDraft: draft });
    const r = run(
      output({ detail_patches: [{ detail_key: "D1", detail_ref: null, field: "action", op: "set", value: "캐시를 붙였다", source_message_ids: ["M2"], source_quotes: ["저희가 캐시를 붙였어요"] }] }),
      ctx,
    );
    expect(r.changes.fields).toEqual([]);
    expect(r.changes.clarifications).toHaveLength(1);
  });

  it("resolves an old actor_ambiguous clarification when an own action arrives", () => {
    const draft = { clarifications: [{ kind: "actor_ambiguous", field: "action", detail_key: "D1", existing_detail_id: null }], details: [{ detail_key: "D1" }] };
    const ctx = ctxFor([["assistant", GREETING], ["user", "제가 캐시 무효화 규칙을 설계했어요"]], { structuredDraft: draft });
    const r = run(
      output({ detail_patches: [{ detail_key: "D1", detail_ref: null, field: "action", op: "set", value: "캐시 무효화 규칙을 설계했다", source_message_ids: ["M2"], source_quotes: ["제가 캐시 무효화 규칙을 설계했어요"] }] }),
      ctx,
    );
    expect(r.changes.clarifications).toEqual([]);
  });

  it("V-9h: augment rejects filled existing fields and unknown DET refs, accepts empty ones", () => {
    const ctx = ctxFor(
      [["assistant", GREETING], ["user", "정산이 하루 늦게 끝나서 고객 문의가 많았어요. 제가 배치 순서를 바꿨어요. 팀은 5명이었어요."]],
      { mode: "augment_project", augmentTarget: augmentTarget() },
    );
    const r = run(
      output({
        project_patches: [
          { field: "name", op: "set", value: "정산 배치", source_message_ids: ["M2"], source_quotes: ["정산"] },
          { field: "team_size", op: "set", value: 5, source_message_ids: ["M2"], source_quotes: ["팀은 5명이었어요"] },
        ],
        detail_patches: [
          { detail_key: null, detail_ref: "DET-1", field: "situation", op: "set", value: "정산이 하루 늦게 끝나 고객 문의가 많았다", source_message_ids: ["M2"], source_quotes: ["정산이 하루 늦게 끝나서 고객 문의가 많았어요"] },
          { detail_key: null, detail_ref: "DET-1", field: "title", op: "set", value: "정산 지연", source_message_ids: ["M2"], source_quotes: ["정산이 하루 늦게"] },
          { detail_key: null, detail_ref: "DET-2", field: "action", op: "set", value: "배치 순서를 바꿨다", source_message_ids: ["M2"], source_quotes: ["제가 배치 순서를 바꿨어요"] },
          { detail_key: null, detail_ref: "DET-9", field: "task", op: "set", value: "배치 순서", source_message_ids: ["M2"], source_quotes: ["배치 순서"] },
        ],
      }),
      ctx,
    );
    expect(r.changes.fields.map((f) => [f.target, f.existing_detail_id, f.field])).toEqual([
      ["project", null, "team_size"],
      ["detail", DETAIL_DRAFT_ID, "situation"],
    ]);
    expect(r.rejections).toEqual([
      { check: "V-9h", target: "project.name" },
      { check: "V-9h", target: "detail.DET-1.title" },
      { check: "V-9h", target: "detail.DET-2.action" },
      { check: "V-9h", target: "detail.?.task" },
    ]);
    expect(DETAIL_DONE_ID).toBeTruthy();
  });

  it("V-9h: detail_ref is not allowed in new_project", () => {
    const r = run(
      output({ detail_patches: [{ detail_key: null, detail_ref: "DET-1", field: "task", op: "set", value: "성능 개선", source_message_ids: ["M2"], source_quotes: ["성능 개선"] }] }),
    );
    expect(r.rejections).toEqual([{ check: "V-9h", target: "detail.?.task" }]);
  });

  it("achievements: all four fields checked, numbers with units", () => {
    const ctx = ctxFor([["assistant", GREETING], ["user", "결제 승인 API 응답 시간이 1.2초 걸리던 게 0.7초로 줄었어요"]]);
    const ok = run(
      output({
        achievements: [
          { detail_key: "D1", detail_ref: null, metric_name: "결제 승인 API 응답 시간", value_before: 1.2, value_after: 0.7, unit: "초", source_message_ids: ["M2"], source_quotes: ["결제 승인 API 응답 시간이 1.2초 걸리던 게 0.7초로 줄었어요"] },
        ],
      }),
      ctx,
    );
    expect(ok.changes.achievements).toHaveLength(1);
    expect(ok.changes.achievements[0].fields.value_after?.value).toBe(0.7);
    expect(ok.changes.new_details).toEqual([{ detail_key: "D1" }]);

    const bad = run(
      output({
        achievements: [
          { detail_key: "D1", detail_ref: null, metric_name: "응답 시간", value_before: 1.5, value_after: 0.7, unit: "초", source_message_ids: ["M2"], source_quotes: ["1.2초 걸리던 게 0.7초로"] },
          { detail_key: "D1", detail_ref: null, metric_name: "응답 시간", value_before: 1.2, value_after: 0.7, unit: "ms", source_message_ids: ["M2"], source_quotes: ["1.2초 걸리던 게 0.7초로"] },
          { detail_key: "D1", detail_ref: null, metric_name: "응답 시간", value_before: null, value_after: null, unit: null, source_message_ids: ["M2"], source_quotes: ["1.2초"] },
        ],
      }),
      ctx,
    );
    expect(bad.changes.achievements).toEqual([]);
    expect(bad.rejections.map((x) => x.check)).toEqual(["V-9c", "V-9c", "type"]);
  });

  it("skills: dictionary spellings, dedupe, and invented skills", () => {
    const draft = { skills: [{ value: "redis", source_message_ids: [msgId(2)], source_quotes: ["레디스"] }] };
    const ctx = ctxFor([["assistant", GREETING], ["user", "카프카로 이벤트를 받고 레디스에 캐시했어요"]], { structuredDraft: draft });
    const r = run(
      output({
        skills: [
          { value: "Kafka", source_message_ids: ["M2"], source_quotes: ["카프카로 이벤트를 받고"] },
          { value: "Redis", source_message_ids: ["M2"], source_quotes: ["레디스에 캐시했어요"] },
          { value: "Kubernetes", source_message_ids: ["M2"], source_quotes: ["이벤트를 받고"] },
          { value: "kafka", source_message_ids: ["M2"], source_quotes: ["카프카로"] },
        ],
      }),
      ctx,
    );
    expect(r.changes.skills.map((s) => s.value)).toEqual(["Kafka"]);
    expect(r.rejections).toEqual([{ check: "V-9d", target: "skill.2" }]);
    expect(r.report.unchanged).toBe(2);
  });

  it("affiliation: suggests a named candidate, rejects unnamed or unknown ones, ignores in augment", () => {
    const ctx = ctxFor([["assistant", GREETING], ["user", "에이비씨페이 다닐 때 한 프로젝트예요"], ["assistant", "네"], ["user", "전 회사에서 한 거예요"]]);
    const ok = run(output({ affiliation_suggestion: { type: "experience", ref: "EXP-1", source_message_ids: ["M2"], source_quotes: ["에이비씨페이 다닐 때"] } }), ctx);
    expect(ok.changes.affiliation_suggestion).toEqual({ type: "experience", id: EXP_ID, source_message_ids: [msgId(2)] });
    const unnamed = run(output({ affiliation_suggestion: { type: "experience", ref: "EXP-1", source_message_ids: ["M4"], source_quotes: ["전 회사에서"] } }), ctx);
    expect(unnamed.rejections).toEqual([{ check: "V-9d", target: "affiliation" }]);
    const wrongType = run(output({ affiliation_suggestion: { type: "education", ref: "EXP-1", source_message_ids: ["M2"], source_quotes: ["에이비씨페이"] } }), ctx);
    expect(wrongType.rejections).toEqual([{ check: "ref", target: "affiliation" }]);
    // Re-suggesting from an already-extracted message (the user may have declined it) is blocked.
    const old = ctxFor([["assistant", GREETING], ["user", "에이비씨페이 다닐 때 한 프로젝트예요"], ["assistant", "네"], ["user", "백엔드였어요"]], { lastExtractedSequence: 2 });
    expect(run(output({ affiliation_suggestion: { type: "experience", ref: "EXP-1", source_message_ids: ["M2"], source_quotes: ["에이비씨페이"] } }), old).rejections).toEqual([
      { check: "declined", target: "affiliation" },
    ]);
    const declined = ctxFor([["assistant", GREETING], ["user", "에이비씨페이 다닐 때"]], { declinedAffiliationIds: [EXP_ID] });
    expect(run(output({ affiliation_suggestion: { type: "experience", ref: "EXP-1", source_message_ids: ["M2"], source_quotes: ["에이비씨페이"] } }), declined).changes.affiliation_suggestion).toBeNull();
    const augment = ctxFor([["assistant", GREETING], ["user", "에이비씨페이 다닐 때"]], { mode: "augment_project", augmentTarget: augmentTarget() });
    expect(run(output({ affiliation_suggestion: { type: "experience", ref: "EXP-1", source_message_ids: ["M2"], source_quotes: ["에이비씨페이"] } }), augment).changes.affiliation_suggestion).toBeNull();
  });

  it("V-9g: rejects sensitive values, counts flags once per pending message and category", () => {
    const ctx = ctxFor(
      [
        ["assistant", GREETING],
        ["user", "예전에 노조 일을 했어요"],
        ["assistant", "네"],
        ["user", "우울증 치료를 받느라 쉬었다가 복귀해서 결제 모듈을 맡았어요"],
      ],
      { lastExtractedSequence: 2 },
    );
    const r = run(
      output({
        detail_patches: [
          { detail_key: "D1", detail_ref: null, field: "situation", op: "set", value: "치료 후 복귀했다", source_message_ids: ["M4"], source_quotes: ["우울증 치료를 받느라 쉬었다가 복귀해서"] },
          { detail_key: "D1", detail_ref: null, field: "task", op: "set", value: "노조 일을 했다", source_message_ids: ["M2"], source_quotes: ["노조 일을 했어요"] },
        ],
        sensitive_flags: [
          { category: "health", message_id: "M4" },
          { category: "health", message_id: "M4" },
          { category: "union", message_id: "M2" },
          { category: "religion", message_id: "M1" },
        ],
      }),
      ctx,
    );
    expect(r.changes.fields).toEqual([]);
    expect(r.rejections.map((x) => x.check)).toEqual(["V-9g", "V-9g"]);
    // M2 is not pending (already extracted) and M1 is the assistant: only M4|health counts.
    expect(r.changes.sensitive_flags_add).toBe(1);
  });

  it("drops the model's clarification note and maps detail_ref", () => {
    const ctx = ctxFor([["assistant", GREETING], ["user", "정산이 늦었어요"]], { mode: "augment_project", augmentTarget: augmentTarget() });
    const r = run(
      output({
        clarifications: [
          { kind: "number_vague", field: "result", detail_key: null, detail_ref: "DET-1", note: "'확 줄었다'만 있음" },
          { kind: "actor_ambiguous", field: "action", detail_key: null, detail_ref: "DET-7", note: null },
        ],
      }),
      ctx,
    );
    expect(r.changes.clarifications).toEqual([{ kind: "number_vague", field: "result", detail_key: null, existing_detail_id: DETAIL_DRAFT_ID }]);
    expect(JSON.stringify(r)).not.toContain("확 줄었다");
  });
});
