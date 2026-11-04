import { describe, expect, it } from "vitest";
import { baseInput, emptyProject, filledProject, GREETING, msgId, PROJECT_ID, rows } from "../__fixtures__/AI-12/conversations";
import { buildWritingChatContext, renderDraftForExtract, renderPeriod, renderProjectForExtract, renderProjectForReply, STAR_FULL_THRESHOLD, toMonth } from "./writing-chat";

const field = (value: string | string[], extra: Record<string, unknown> = {}) => ({
  value,
  origin: "ai",
  source_message_ids: [msgId(2)],
  source_quotes: ["결제"],
  review: "ok",
  reviewed_at: null,
  applied_at: null,
  ...extra,
});

describe("buildWritingChatContext", () => {
  it("aliases messages by sequence and keeps only status = done", () => {
    const ctx = buildWritingChatContext(baseInput({ messages: rows([["assistant", GREETING], ["user", "a"], ["assistant", "실패"], ["user", "b"]], [3]) }));
    expect([...ctx.v9.messages.keys()]).toEqual(["M1", "M2", "M4"]);
    expect(ctx.pendingUserSequences).toEqual([2, 4]);
    expect(ctx.processThroughSequence).toBe(4);
    expect(ctx.messageAliasById.get(msgId(4))).toBe("M4");
  });

  it("pending = user messages after last_extracted_sequence; none → null", () => {
    const messages = rows([["assistant", GREETING], ["user", "a"], ["assistant", "q"], ["user", "b"]]);
    expect(buildWritingChatContext(baseInput({ messages, lastExtractedSequence: 2 })).pendingUserSequences).toEqual([4]);
    const none = buildWritingChatContext(baseInput({ messages, lastExtractedSequence: 4 }));
    expect(none.pendingUserSequences).toEqual([]);
    expect(none.processThroughSequence).toBeNull();
  });

  it("sensitive notice and delegation come from pending user messages", () => {
    const ctx = buildWritingChatContext(baseInput({ messages: rows([["assistant", GREETING], ["user", "우울증 치료를 받았어요. 알아서 채워 주세요"]]) }));
    expect(ctx.sensitiveNotice).toEqual(["health"]);
    expect(ctx.delegationRequested).toBe(true);
  });

  it("v4.9 (RQ-6): the notice uses the personal-context rule — work-domain words alone give no notice", () => {
    const notice = (say: string) => buildWritingChatContext(baseInput({ messages: rows([["assistant", GREETING], ["user", say]]) })).sensitiveNotice;
    expect(notice("병원 예약 시스템을 개발했어요. 기획자 선배가 리뷰해 줬고 사업부 부장님께 보고했어요.")).toEqual([]);
    expect(notice("교회 출석 앱 외주와 파업 대응 공지 시스템을 만들었어요")).toEqual([]);
    expect(notice("제가 우울증 진단을 받아서 휴직했어요")).toEqual(["health"]);
    expect(notice("김민수 팀장님과 했어요. 010-1234-5678")).toEqual(["contact", "third_party_name"]);
  });

  it("<chat> block: name, affiliation, desired job — no STAR text, no ids; cache on the last message", () => {
    const ctx = buildWritingChatContext(
      baseInput({ messages: rows([["assistant", GREETING], ["user", "a"], ["user", "b"]]), project: filledProject() }),
    );
    const chat = ctx.sharedBlocks[0].text;
    expect(chat).toContain("project_name: 결제 승인 API 개선");
    expect(chat).toContain("affiliation: 경력 '에이비씨페이'");
    expect(chat).toContain("desired_job_title: 백엔드 개발자");
    expect(chat).not.toContain("병목");
    expect(chat).not.toContain(PROJECT_ID);
    const cached = ctx.sharedBlocks.filter((b) => b.cache);
    expect(cached).toHaveLength(1);
    expect(cached[0].text).toContain('id="M3"');
  });

  it("V-9 project state: months normalized, classification copied", () => {
    const ctx = buildWritingChatContext(baseInput({ project: emptyProject({ startMonth: "2023-03-01", isCurrent: true, competencies: ["analysis"] }) }));
    expect(ctx.v9.project).toMatchObject({ startMonth: "2023-03", endMonth: null, isCurrent: true, competencies: ["analysis"] });
    expect(renderPeriod(ctx.v9.project)).toBe("2023-03 ~ 현재(진행 중)");
  });

  it("remaining chars and full fields (C-14)", () => {
    const ctx = buildWritingChatContext(baseInput({ project: emptyProject({ action: "가".repeat(1990) }) }));
    expect(ctx.remainingChars.action).toBe(9);
    expect(ctx.remainingChars.situation).toBe(2000);
    expect(9).toBeLessThan(STAR_FULL_THRESHOLD);
    expect(ctx.focus.fullFields).toEqual(["action"]);
  });

  it("chips follow the current state", () => {
    expect(buildWritingChatContext(baseInput()).chips[0].requested_slot).toBe("situation");
    expect(buildWritingChatContext(baseInput({ project: filledProject() })).chips[0].label).toBe("행동 보강하기");
  });

  it("flags the last message from begin_assistant_message is_final", () => {
    expect(buildWritingChatContext(baseInput({ isFinalReply: false })).lastMessage).toBe(false);
    expect(buildWritingChatContext(baseInput({ isFinalReply: true })).lastMessage).toBe(true);
  });
});

describe("rendering", () => {
  it("renderProjectForExtract: period, classification as reference, STAR with remaining chars and <reflection>", () => {
    const ctx = buildWritingChatContext(baseInput({ project: filledProject({ projectType: "improvement", learnings: "다음엔 <먼저> 측정" }) }));
    const text = renderProjectForExtract(ctx);
    expect(text).toContain("period: 2023-03 ~ (종료 미입력)");
    expect(text).toContain("project_type: improvement (개선·고도화)");
    expect(text).toContain("experience_type: (비어 있음)");
    expect(text).toMatch(/action \[남은 글자 수 \d+\]: 병목 쿼리를 찾아 인덱스를 재설계했다/);
    expect(text).toContain("<reflection>다음엔 ＜먼저＞ 측정</reflection>");
  });

  it("renderDraftForExtract: values with op/origin/review and source aliases, not UUIDs", () => {
    const ctx = buildWritingChatContext(
      baseInput({
        messages: rows([["assistant", GREETING], ["user", "결제 프로젝트"]]),
        structuredDraft: {
          star: { result: field("응답이 줄었다", { op: "append" }), task: field("과제", { origin: "user_edit" }), action: field("적용됨", { applied_at: "2026-11-01T00:00:00Z" }) },
          classification: { competencies: field(["analysis", "planning"]) },
        },
      }),
    );
    const text = renderDraftForExtract(ctx);
    expect(text).toContain("result [append/ai/ok]: 응답이 줄었다 (출처 M2)");
    expect(text).toContain("task [set/user_edit/ok]: 과제");
    expect(text).toContain("action: (제안 없음)");
    expect(text).toContain("competencies [ai]: analysis, planning");
    expect(text).not.toContain(msgId(2));
  });

  it("renderProjectForReply: form values and pending proposals, no classification values, no remaining chars (R7)", () => {
    const ctx = buildWritingChatContext(
      baseInput({
        project: emptyProject({ situation: "결제 승인이 느렸다", learnings: "먼저 <측정>하기", projectType: "improvement", competencies: ["analysis"] }),
        structuredDraft: {
          star: { situation: field("트래픽이 몰렸다", { op: "append" }), action: field("인덱스를 재설계했다", { review: "needs_review" }) },
          classification: { experience_type: field("problem_solving") },
        },
      }),
    );
    const text = renderProjectForReply(ctx);
    expect(text.startsWith("<project_state>")).toBe(true);
    expect(text).toContain("  situation: 결제 승인이 느렸다");
    expect(text).toContain("  learnings: <reflection>먼저 ＜측정＞하기</reflection>");
    expect(text).toContain("  task: (비어 있음)");
    expect(text).toContain("  situation [합친 제안]: 트래픽이 몰렸다");
    expect(text).toContain("  action [새로 채움, 검토 필요]: 인덱스를 재설계했다");
    expect(text).toContain("classification_recommended: experience_type");
    expect(text).not.toContain("improvement");
    expect(text).not.toContain("analysis");
    expect(text).not.toContain("problem_solving");
    expect(text).not.toContain("남은 글자 수");
    expect(text).not.toContain(msgId(2));
    expect(text).not.toContain("M2");
  });

  it("renderProjectForReply: a proposal already in the form is not repeated; period proposal shown while period is empty", () => {
    const ctx = buildWritingChatContext(
      baseInput({
        project: emptyProject({ action: "인덱스를 재설계했다" }),
        structuredDraft: { project: { start_month: field("2023-03") }, star: { action: field("인덱스를 재설계했다") } },
      }),
    );
    const text = renderProjectForReply(ctx);
    expect(text).toContain("period: (비어 있음)");
    expect(text).toContain("  period: 2023-03 ~ (없음)");
    expect(text.match(/인덱스를 재설계했다/g)).toHaveLength(1);
  });

  it("toMonth accepts date and month strings", () => {
    expect(toMonth("2023-03-01")).toBe("2023-03");
    expect(toMonth("2023-03")).toBe("2023-03");
    expect(toMonth(null)).toBeNull();
  });
});
