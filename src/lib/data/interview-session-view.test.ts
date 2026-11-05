import { describe, expect, it } from "vitest"
import {
  answerScoreView,
  DELETED_APPLICATION_NAME,
  DELETED_APPLICATION_SEGMENT,
  deletedApplicationName,
  isApplicationDeleted,
  sessionApplicationSegment,
  sessionScoreView,
  showsCriterionGrades,
  showsNextPractice,
} from "./interview-session-view"

const base = { score_value: null, score_max: null, score_counted_count: null, unanswered_count: 0, question_count: 3 as const }

describe("C-17 sessionScoreView (02 v5.13, OD-I1 / R-OD-3)", () => {
  it("before submission (null) shows nothing; pending_method is its own state", () => {
    expect(sessionScoreView({ ...base, score_status: null })).toEqual({ kind: "hidden" })
    expect(sessionScoreView({ ...base, score_status: "pending_method" })).toEqual({ kind: "pending" })
  })

  it("scored: the stored value out of 100, counted questions and unanswered count", () => {
    expect(sessionScoreView({ ...base, score_status: "scored", score_value: 46, score_max: 100, score_counted_count: 3, unanswered_count: 1 })).toEqual({
      kind: "scored",
      value: 46,
      max: 100,
      counted: 3,
      unanswered: 1,
      allUnanswered: false,
    })
  })

  it("every question unanswered → 0 / 100 (scored), never not_scored", () => {
    const v = sessionScoreView({ ...base, score_status: "scored", score_value: 0, score_max: 100, score_counted_count: 3, unanswered_count: 3 })
    expect(v).toMatchObject({ kind: "scored", value: 0, max: 100, allUnanswered: true, unanswered: 3 })
  })

  it("[UI-가정] a pre-backfill not_scored row with no answer at all also reads as 0 / 100", () => {
    expect(sessionScoreView({ ...base, score_status: "not_scored", unanswered_count: 3 })).toMatchObject({ kind: "scored", value: 0, max: 100, allUnanswered: true })
  })

  it("not_scored only when answers exist but none was graded", () => {
    expect(sessionScoreView({ ...base, score_status: "not_scored", unanswered_count: 1 })).toEqual({ kind: "not_scored" })
  })

  it("a missing score_max falls back to 100", () => {
    expect(sessionScoreView({ ...base, score_status: "scored", score_value: 70 })).toMatchObject({ value: 70, max: 100 })
  })
})

describe("C-17 answerScoreView", () => {
  it("maps every status", () => {
    expect(answerScoreView(null, null, null)).toEqual({ kind: "hidden" })
    expect(answerScoreView("pending_method", null, null)).toEqual({ kind: "pending" })
    expect(answerScoreView("unanswered", 0, 100)).toEqual({ kind: "unanswered" })
    expect(answerScoreView("not_scored", null, null)).toEqual({ kind: "not_scored" })
    expect(answerScoreView("scored", 69, 100)).toEqual({ kind: "scored", value: 69, max: 100 })
    expect(answerScoreView("scored", 69, null)).toEqual({ kind: "scored", value: 69, max: 100 })
  })
})

describe("OD-I2: criterion grades and 다음 연습 only with a score", () => {
  it("hidden while pending_method, shown when scored", () => {
    expect(showsCriterionGrades("pending_method")).toBe(false)
    expect(showsCriterionGrades("not_scored")).toBe(false)
    expect(showsCriterionGrades(null)).toBe(false)
    expect(showsCriterionGrades("scored")).toBe(true)
    expect(showsNextPractice("pending_method")).toBe(false)
    expect(showsNextPractice(null)).toBe(false)
    expect(showsNextPractice("scored")).toBe(true)
  })
})

describe("OD-I6 자기소개서 삭제됨 (R-OD-12 name, route segment)", () => {
  it("snapshot name: both → 'company – position', one → that value, none → 삭제된 자기소개서", () => {
    expect(deletedApplicationName("한빛소프트", "백엔드 개발자")).toBe("한빛소프트 – 백엔드 개발자")
    expect(deletedApplicationName("한빛소프트", null)).toBe("한빛소프트")
    expect(deletedApplicationName(" ", "백엔드 개발자")).toBe("백엔드 개발자")
    expect(deletedApplicationName(null, undefined)).toBe(DELETED_APPLICATION_NAME)
  })

  it("rows without the flag are not deleted; deleted rows route under the deleted segment", () => {
    expect(isApplicationDeleted({})).toBe(false)
    expect(isApplicationDeleted({ application_deleted: true })).toBe(true)
    expect(sessionApplicationSegment({ application_project_id: "ap-1" })).toBe("ap-1")
    expect(sessionApplicationSegment({ application_project_id: "", application_deleted: true })).toBe(DELETED_APPLICATION_SEGMENT)
  })
})
