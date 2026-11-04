import { describe, expect, it } from "vitest";
import {
  baseInput,
  fact,
  factsInput,
  extractOutput,
  goodCompose,
  heading,
  list,
  paragraph,
  rows,
  storedDraft,
  table,
  twoFacts,
  GREETING,
  SAY_1,
} from "../__fixtures__/AI-13/conversations";
import { buildDeliverableChatContext, type DeliverableChatTurnInput } from "../context-pack/deliverable-chat";
import type { Ai13ExtractOutput } from "../schemas/AI-13";
import { deliverableMarkdown } from "../schemas/deliverable-markdown";
import { uncoveredRatio } from "./v9";
import {
  BLOCK_TEXT_MAX,
  DRAFT_VALUE_MAX,
  MAX_FACTS_PER_TURN,
  composeValidationContext,
  cutText,
  dropEmptyHeadings,
  validateComposeOutput,
  validateDraftBlock,
  validateFactsOutput,
  violationSummary,
  V10E_MAX_UNCOVERED_RATIO,
} from "./v10";

/** AI-13 server validation: facts (V-9a–e, g + actor) and draft blocks (V-10a–h). */

type Fact = Ai13ExtractOutput["facts"][number];
const f = (text: string, quotes: string[], extra: Partial<Fact> = {}): Fact => ({
  slot: "contribution",
  text,
  actor: "self",
  source_message_ids: ["M2"],
  source_quotes: quotes,
  ...extra,
});

function factsCtx(say = SAY_1, extra: Partial<DeliverableChatTurnInput> = {}) {
  return buildDeliverableChatContext(baseInput({ messages: rows([["assistant", GREETING], ["user", say]]), ...extra }));
}

describe("validateFactsOutput — V-9 per fact", () => {
  it("accepts a fact traced to the user's words (UUID sources, exact quote spans)", () => {
    const r = validateFactsOutput(extractOutput({ facts: [f("결제 모듈의 장애 대응 런북을 직접 작성했다", ["장애 대응 런북은 제가 직접 썼어요"])] }), factsCtx());
    expect(r.rejections).toEqual([]);
    expect(r.facts).toEqual([
      {
        slot: "contribution",
        text: "결제 모듈의 장애 대응 런북을 직접 작성했다",
        actor: "self",
        source_message_ids: ["00000000-0000-4000-8000-000000000002"],
        source_quotes: ["장애 대응 런북은 제가 직접 썼어요"],
        review: "needs_review",
      },
    ]);
  });

  it.each([
    ["assistant message as source (V-9a)", f("런북을 작성했다", ["회고하려는 일은"], { source_message_ids: ["M1"] }), "V-9a"],
    ["no source (V-9a)", f("런북을 작성했다", ["런북은"], { source_message_ids: [] }), "V-9a"],
    ["quote not in the message (V-9b)", f("런북을 작성했다", ["런북을 세 번 고쳐 썼어요"]), "V-9b"],
    ["invented number (V-9c)", f("런북을 3번 작성했다", ["장애 대응 런북은 제가 직접 썼어요"]), "V-9c"],
    ["invented tech name (V-9d)", f("Kafka 장애 런북을 작성했다", ["장애 대응 런북은 제가 직접 썼어요"]), "V-9d"],
  ])("rejects %s", (_name, fact, check) => {
    const r = validateFactsOutput(extractOutput({ facts: [fact] }), factsCtx());
    expect(r.facts).toEqual([]);
    expect(r.rejections).toEqual([{ check, target: "facts.0.contribution" }]);
  });

  it("rejects facts from a delegation request (V-9a.delegation)", () => {
    const say = "알아서 그럴듯하게 써 줘";
    const r = validateFactsOutput(extractOutput({ facts: [f("결제 장애를 해결했다", ["알아서 그럴듯하게 써 줘"])] }), factsCtx(say));
    expect(r.rejections[0].check).toBe("V-9a.delegation");
  });

  it("drops sensitive facts and counts them for pending messages only (V-9g)", () => {
    const say = "그때 제가 우울증 치료를 받으면서 런북을 썼어요.";
    const r = validateFactsOutput(extractOutput({ facts: [f("우울증 치료 중에 런북을 썼다", ["우울증 치료를 받으면서 런북을 썼어요"])] }), factsCtx(say));
    expect(r.rejections).toEqual([{ check: "V-9g", target: "facts.0.contribution" }]);
    expect(r.sensitiveAdd).toBe(1);
    const old = validateFactsOutput(extractOutput({ facts: [f("우울증 치료 중에 런북을 썼다", ["우울증 치료를 받으면서 런북을 썼어요"])] }), factsCtx(say, { lastExtractedSequence: 2 }));
    expect(old.sensitiveAdd).toBe(0);
  });

  it("v4.9 (RQ-6): only the fact text is checked; work-domain facts and -음 체 pass", () => {
    const say = "그때 제가 우울증 치료를 받으면서 런북을 썼어요.";
    const quoteOnly = validateFactsOutput(extractOutput({ facts: [f("런북을 작성함", ["우울증 치료를 받으면서 런북을 썼어요"])] }), factsCtx(say));
    expect(quoteOnly.rejections).toEqual([]);
    expect(quoteOnly.sensitiveAdd).toBe(0);
    const domain = "제가 병원 예약 시스템의 출산 휴가 신청 기능 런북을 썼어요.";
    const ok = validateFactsOutput(extractOutput({ facts: [f("병원 예약 시스템의 출산 휴가 신청 기능 런북을 작성함", ["병원 예약 시스템의 출산 휴가 신청 기능 런북을 썼어요"])] }), factsCtx(domain));
    expect(ok.rejections).toEqual([]);
    expect(ok.facts).toHaveLength(1);
  });

  it("V-9e: mostly new words → needs_review; close paraphrase → ok", () => {
    const say = "장애 대응 런북은 제가 직접 썼어요.";
    const ok = validateFactsOutput(extractOutput({ facts: [f("장애 대응 런북을 직접 썼다", ["장애 대응 런북은 제가 직접 썼어요"])] }), factsCtx(say));
    expect(ok.facts[0].review).toBe("ok");
  });

  it("V-9f → actor: a team-subject fact is kept with actor team and an actor_ambiguous clarification", () => {
    const say = "저희 팀이 결제 장애 런북을 만들었어요.";
    const r = validateFactsOutput(extractOutput({ facts: [f("팀이 결제 장애 런북을 만들었다", ["저희 팀이 결제 장애 런북을 만들었어요"])] }), factsCtx(say));
    expect(r.facts[0].actor).toBe("team");
    expect(r.report.team_marked).toBe(1);
    expect(r.clarifications).toEqual([{ kind: "actor_ambiguous", slot: "contribution", note: null }]);
  });

  it("dedupes against stored facts and within the turn", () => {
    const ctx = factsCtx(SAY_1, { structuredDraft: storedDraft({ facts: [fact(1, { text: "장애 대응 런북을 직접 썼다" })] }) });
    const r = validateFactsOutput(extractOutput({ facts: [f("장애 대응 런북을 직접 썼다.", ["장애 대응 런북은 제가 직접 썼어요"])] }), ctx);
    expect(r.facts).toEqual([]);
    expect(r.report.unchanged).toBe(1);
  });

  it("C-14: ≤ 10 facts per turn, text ≤ 300", () => {
    const many = Array.from({ length: MAX_FACTS_PER_TURN + 2 }, (_, i) => f(`런북 ${"가".repeat(i)}`, ["런북은"]));
    const r = validateFactsOutput(extractOutput({ facts: many }), factsCtx());
    expect(r.rejections.filter((x) => x.check === "limit")).toHaveLength(2);
    const long = validateFactsOutput(extractOutput({ facts: [f("가".repeat(301), ["런북은"])] }), factsCtx());
    expect(long.rejections[0].check).toBe("length");
  });

  it("clarifications: number_vague resolved by a fact with a number in the slot; notes lose aliases", () => {
    const ctx = factsCtx("하루 장애 알림이 40건에서 10건으로 줄었어요.", {
      structuredDraft: storedDraft({ clarifications: [{ kind: "number_vague", slot: "went_well", note: null }] }),
    });
    const r = validateFactsOutput(
      extractOutput({
        facts: [f("하루 장애 알림이 40건에서 10건으로 줄었다", ["하루 장애 알림이 40건에서 10건으로 줄었어요"], { slot: "went_well", actor: "unknown" })],
        clarifications: [{ kind: "number_vague", slot: "outcome", note: "M2에서 '많이' — 수치 없음" }],
      }),
      ctx,
    );
    expect(r.clarifications).toEqual([{ kind: "number_vague", slot: "outcome", note: "'많이' — 수치 없음" }]);
  });

  it("writing_kind: set when it changes, undefined when the same", () => {
    expect(validateFactsOutput(extractOutput({ writing_kind: "design_doc" }), factsCtx()).writingKind).toBe("design_doc");
    expect(validateFactsOutput(extractOutput({ writing_kind: "retrospective" }), factsCtx()).writingKind).toBeUndefined();
    expect(validateFactsOutput(extractOutput({ writing_kind: null }), factsCtx()).writingKind).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// V-10
// ---------------------------------------------------------------------------

function vctx(extra: Partial<DeliverableChatTurnInput> = {}) {
  return composeValidationContext(buildDeliverableChatContext(factsInput(extra)));
}

describe("validateDraftBlock — V-10a sources", () => {
  it.each([
    ["no source", paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.")],
    ["unknown fact alias", paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.", { source_fact_ids: ["F9"] })],
    ["body quote not in the body", paragraph("런북을 작성했다.", { source_body_quotes: ["본문에 없는 문장"] })],
    ["empty project field", paragraph("결제 백엔드를 담당했다.", { source_project_fields: ["PRJ.role"] })],
  ])("drops a block with %s", (_name, block) => {
    const ctx = _name === "empty project field" ? vctx({ project: { ...factsInput().project, role: null } }) : vctx();
    const r = validateDraftBlock(block, 0, ctx);
    expect(r.block).toBeNull();
    expect(r.rejections[0].check).toBe("V-10a");
  });

  it("a needs_review fact is citable only after the user accepts it", () => {
    const pending = vctx({ structuredDraft: storedDraft({ facts: [fact(1, { review: "needs_review" })] }) });
    expect(validateDraftBlock(paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.", { source_fact_ids: ["F1"] }), 0, pending).block).toBeNull();
    const accepted = vctx({ structuredDraft: storedDraft({ facts: [fact(1, { review: "accepted" })] }) });
    expect(validateDraftBlock(paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.", { source_fact_ids: ["F1"] }), 0, accepted).block).not.toBeNull();
  });

  it("stores fact UUIDs and exact body spans", () => {
    const ctx = vctx({ formSnapshot: { body: "## 개요\n결제   장애가 반복돼 회고를 쓴다." } });
    const r = validateDraftBlock(paragraph("결제 장애가 반복돼 회고를 쓴다.", { source_body_quotes: ["결제 장애가 반복돼"] }, "current_body"), 3, ctx);
    expect(r.block).toMatchObject({ block_id: "b4", basis: "current_body", source_body_quotes: ["결제   장애가 반복돼"] });
    const g = validateDraftBlock(paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.", { source_fact_ids: ["f-1"] }), 0, ctx);
    expect(g.block!.source_fact_ids).toEqual(["aaaaaaaa-0000-4000-8000-000000000001"]);
  });
});

describe("validateDraftBlock — V-10b / c / f", () => {
  it("V-10b: numbers must be in the cited sources", () => {
    const ok = validateDraftBlock(paragraph("팀이 배포한 뒤 하루 장애 알림이 40건에서 10건으로 줄었다.", { source_fact_ids: ["F2"] }), 0, vctx());
    expect(ok.block).not.toBeNull();
    const bad = validateDraftBlock(paragraph("팀이 배포한 뒤 장애 알림이 75% 줄었다.", { source_fact_ids: ["F2"] }), 0, vctx());
    expect(bad.rejections[0].check).toBe("V-10b");
    // A number only in another fact is not supported by this block's sources.
    const other = validateDraftBlock(paragraph("런북을 40건 작성했다.", { source_fact_ids: ["F1"] }), 0, vctx());
    expect(other.rejections[0].check).toBe("V-10b");
  });

  it("V-10b: the parent period's server-computed months are allowed when PRJ.period is cited", () => {
    const r = validateDraftBlock(paragraph("프로젝트는 12개월 동안 진행됐다.", { source_project_fields: ["PRJ.period"] }), 0, vctx());
    expect(r.block).not.toBeNull();
  });

  it("V-10c: tech names and URLs must be in the cited sources (PRJ.skills counts when cited)", () => {
    const bad = validateDraftBlock(paragraph("Redis로 런북을 작성했다.", { source_fact_ids: ["F1"] }), 0, vctx());
    expect(bad.rejections[0].check).toBe("V-10c");
    const withSkills = validateDraftBlock(paragraph("Kafka를 썼다.", { source_project_fields: ["PRJ.skills"] }), 0, vctx());
    expect(withSkills.block).not.toBeNull();
    const url = validateDraftBlock(paragraph("자세한 내용은 https://example.com/runbook 에 있다.", { source_fact_ids: ["F1"] }), 0, vctx());
    expect(url.block).toBeNull();
  });

  it("V-10f (v4.9): a work-domain block in -음 체 is kept", () => {
    const r = validateDraftBlock(paragraph("결제 모듈의 장애 대응 런북을 직접 작성함.", { source_fact_ids: ["F1"] }), 0, vctx());
    expect(r.rejections).toEqual([]);
    expect(r.block).not.toBeNull();
  });

  it("V-10f: sensitive text drops the unit and counts", () => {
    const r = validateDraftBlock(paragraph("우울증 치료 중에도 런북을 직접 작성했다.", { source_fact_ids: ["F1"] }), 0, vctx());
    expect(r.rejections[0].check).toBe("V-10f");
    expect(r.sensitive).toBe(1);
  });
});

describe("validateDraftBlock — V-10d / e (needs_review)", () => {
  it("V-10d: a self-action sentence from a team fact needs review", () => {
    const r = validateDraftBlock(paragraph("제가 배포해서 하루 장애 알림이 40건에서 10건으로 줄었다.", { source_fact_ids: ["F2"] }), 0, vctx());
    expect(r.block!.review).toBe("needs_review");
  });

  it("V-10d [가정]: a team-only unit without a team subject reads as the user's → needs_review; with the team subject → ok", () => {
    const noSubject = validateDraftBlock(paragraph("배포 후 하루 장애 알림이 40건에서 10건으로 줄었다.", { source_fact_ids: ["F2"] }), 0, vctx());
    expect(noSubject.block!.review).toBe("needs_review");
    const withTeam = validateDraftBlock(paragraph("팀이 배포한 뒤 하루 장애 알림이 40건에서 10건으로 줄었다.", { source_fact_ids: ["F2"] }), 0, vctx());
    expect(withTeam.block!.review).toBe("ok");
  });

  it("V-10d: a first-person parent description supports a self sentence", () => {
    const r = validateDraftBlock(paragraph("제가 장애 대응 절차를 정리했다.", { source_project_fields: ["PRJ.description"] }), 0, vctx());
    expect(r.block!.review).toBe("ok");
  });

  it("V-10e: more than 50% new content words → needs_review", () => {
    const r = validateDraftBlock(paragraph("직접 작성한 런북 덕분에 조직 전반의 운영 문화와 신뢰성 수준이 크게 향상되었고 협업 체계가 정착했다.", { source_fact_ids: ["F1"] }), 0, vctx());
    expect(r.block!.review).toBe("needs_review");
  });
});

describe("validateDraftBlock — V-10g format", () => {
  it("strips HTML and images; clamps heading depth to 3; one-line headings", () => {
    const p = validateDraftBlock(paragraph('<b>결제 모듈의</b> 장애 대응 런북을 직접 작성했다. ![x](http://a/b.png)', { source_fact_ids: ["F1"] }), 0, vctx());
    expect(p.block!.text).toBe("결제 모듈의 장애 대응 런북을 직접 작성했다.");
    const h = validateDraftBlock(heading("내가\n맡은 일", 5), 0, vctx());
    expect(h.block).toMatchObject({ level: 3, text: "내가 맡은 일" });
  });

  it("cuts a unit over 1,500 chars at a sentence end", () => {
    const text = `${"결제 모듈의 장애 대응 런북을 직접 작성했다. ".repeat(80)}`;
    expect(cutText(text, BLOCK_TEXT_MAX).length).toBeLessThanOrEqual(BLOCK_TEXT_MAX);
    expect(cutText(text, BLOCK_TEXT_MAX).endsWith("다.")).toBe(true);
  });

  it("a heading with an unsupported number or name is dropped", () => {
    expect(validateDraftBlock(heading("장애 90% 감소"), 0, vctx()).block).toBeNull();
    expect(validateDraftBlock(heading("Redis 도입기"), 0, vctx()).block).toBeNull();
  });

  it("lists: failing items are dropped one by one; the block stays with the rest", () => {
    const r = validateDraftBlock(
      list([
        { text: "장애 대응 런북을 직접 작성했다", source_fact_ids: ["F1"] },
        { text: "Redis 캐시를 도입했다", source_fact_ids: ["F1"] },
      ]),
      0,
      vctx(),
    );
    expect(r.units).toBe(2);
    expect(r.droppedUnits).toBe(1);
    expect(r.block!.items).toHaveLength(1);
    expect(r.block!.basis).toBe("new");
  });

  it("tables: header checked against all row sources; a header alone is dropped", () => {
    const ok = validateDraftBlock(table([{ cells: ["항목", "내용"] }, { cells: ["하루 장애 알림", "40건에서 10건"], source_fact_ids: ["F2"] }]), 0, vctx());
    expect(ok.block!.rows).toHaveLength(2);
    const onlyHeader = validateDraftBlock(table([{ cells: ["항목", "내용"] }, { cells: ["Redis", "도입"], source_fact_ids: ["F2"] }]), 0, vctx());
    expect(onlyHeader.block).toBeNull();
  });
});

describe("validateComposeOutput", () => {
  it("good draft: all kept, headings get basis, value assembled like the RPC", () => {
    const v = validateComposeOutput(goodCompose(), vctx());
    expect(v.droppedUnits).toBe(0);
    expect(v.blocks.map((b) => `${b.block_id}:${b.type}:${b.basis}`)).toEqual(["b1:heading:new", "b2:paragraph:new", "b3:heading:new", "b4:paragraph:new"]);
    expect(v.value).toBe(deliverableMarkdown(v.blocks));
    expect(v.value.startsWith("## 내가 맡은 일\n\n결제 모듈의")).toBe(true);
    expect(v.missingSlots).toEqual(["went_wrong", "learnings"]);
    expect(v.overDropLimit).toBe(false);
  });

  it("removes a heading whose content was all dropped", () => {
    const v = validateComposeOutput(
      goodCompose({ blocks: [heading("배운 점"), paragraph("Redis를 배웠다.", { source_fact_ids: ["F1"] }), heading("내가 맡은 일"), paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.", { source_fact_ids: ["F1"] })] }),
      vctx(),
    );
    expect(v.blocks.map((b) => b.block_id)).toEqual(["b3", "b4"]);
    expect(dropEmptyHeadings([])).toEqual([]);
  });

  it("> 30% of units dropped → overDropLimit; summary lists check ids only", () => {
    const v = validateComposeOutput(
      goodCompose({ blocks: [paragraph("결제 모듈의 장애 대응 런북을 직접 작성했다.", { source_fact_ids: ["F1"] }), paragraph("Redis를 도입했다.", { source_fact_ids: ["F1"] }), paragraph("장애가 99% 줄었다.", { source_fact_ids: ["F1"] })] }),
      vctx(),
    );
    expect(v.droppedUnits).toBe(2);
    expect(v.overDropLimit).toBe(true);
    expect(violationSummary(v.rejections)).toBe("V-10c 1건, V-10b 1건");
  });

  it("no content left → empty", () => {
    const v = validateComposeOutput(goodCompose({ blocks: [heading("내가 맡은 일"), paragraph("Redis를 도입했다.", { source_fact_ids: ["F1"] })] }), vctx());
    expect(v.blocks).toEqual([]);
    expect(v.value).toBe("");
  });

  it("V-10g: the assembled value is capped at 8,000 chars by dropping trailing blocks", () => {
    const longFact = "결제 모듈의 장애 대응 런북을 직접 작성했다";
    const blocks = Array.from({ length: 12 }, () => paragraph(`${longFact}. `.repeat(30).trim(), { source_fact_ids: ["F1"] }));
    const v = validateComposeOutput(goodCompose({ blocks }), vctx());
    expect(Array.from(v.value).length).toBeLessThanOrEqual(DRAFT_VALUE_MAX);
    expect(v.rejections.some((r) => r.check === "V-10g.length")).toBe(true);
  });

  it("V-10h: blocks sourced only from the body are current_body; missing slots outside the kind are dropped", () => {
    const ctx = vctx({ formSnapshot: { body: "결제 장애가 반복돼 회고를 쓴다." } });
    const v = validateComposeOutput(
      goodCompose({ blocks: [paragraph("결제 장애가 반복돼 회고를 쓴다.", { source_body_quotes: ["결제 장애가 반복돼 회고를 쓴다"] }, "new")], missing_slots: ["went_wrong", "audience"] }),
      ctx,
    );
    expect(v.blocks[0].basis).toBe("current_body");
    expect(v.missingSlots).toEqual(["went_wrong"]);
  });
});

it("fixtures: twoFacts has F1 self contribution and F2 team went_well", () => {
  expect(twoFacts().map((x) => `${x.slot}:${x.actor}`)).toEqual(["contribution:self", "went_well:team"]);
});

describe("V-10e -음 체 (R8 QA-04)", () => {
  it.each([
    ["관리자 대시보드를 만듦.", ["관리자 대시보드를 만들었어요"]],
    ["백엔드 API 개발을 맡음.", ["백엔드 API 개발을 맡았어요"]],
    ["전환율을 높임.", ["전환율을 높였어요"]],
    ["처리 시간을 줄임.", ["처리 시간을 줄였어요"]],
    ["배포 파이프라인을 바꿈.", ["배포 파이프라인을 바꿨어요"]],
    ["프로젝트를 이끎.", ["프로젝트를 이끌었어요"]],
    ["캐시 무효화 규칙을 설계함.", ["캐시 무효화 규칙을 설계했어요"]],
  ])("%s ↔ %j is covered", (text, sources) => {
    expect(uncoveredRatio(text, sources)).toBe(0);
    expect(uncoveredRatio(text, sources)).toBeLessThanOrEqual(V10E_MAX_UNCOVERED_RATIO);
  });

  it("a -음 체 block against a -했어요 body quote keeps review ok", () => {
    const r = validateDraftBlock(paragraph("결제 모듈의 장애 대응 런북을 직접 작성함.", { source_fact_ids: ["F1"] }), 0, vctx());
    expect(r.block).not.toBeNull();
    expect(r.rejections).toEqual([]);
  });
});
