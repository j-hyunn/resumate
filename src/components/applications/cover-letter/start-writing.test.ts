/**
 * 회귀 가드 — 2026-11-10 사용자 보고 "자기소개서 작성 시작 버튼 누르면 아무 동작도 안 해".
 * 원인: [자기소개서 작성 시작]이 `void req.run(onStart)`로 결과를 버려, 요건 선행 추출이 AI 동의·키 문제로
 * **거절**되면 버튼이 잠깐 돌고 멈출 뿐 아무것도 보이지 않았다. 또 문항 설정 상태는 저장 상태 표시가 `idle`로
 * 고정(CF-S3·S5)이라 저장 실패도 보이지 않았다.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (p: string) => readFileSync(join(__dirname, p), "utf8")

describe("[자기소개서 작성 시작]은 실패를 삼키지 않는다", () => {
  it("선행 추출 결과를 버리지 않고 거절을 알린다", () => {
    const src = read("question-setup.tsx")
    expect(src).not.toMatch(/void\s+req\.run\(/)
    expect(src).toMatch(/isAiRejected\(r\)\)\s*notifyAiRejected\(r\)/)
  })

  it("문항 설정 상태의 첫 저장 실패(정본 행 만들기)를 알린다", () => {
    const src = read("cover-letter-screen.tsx")
    expect(src).toMatch(/if \(opts\.createRow\) toast\.error\(submitFailedMessage\("자기소개서"\)\)/)
  })

  it("선행 추출 요청이 던져도 '정리 중'에 묶이지 않는다", () => {
    const src = read("../extract-first.tsx")
    expect(src).toMatch(/catch \(err\) \{\s*\/\/[^\n]*\n\s*setBusy\(false\)\s*\n\s*throw err/)
  })
})

// 회귀 가드 — 2026-11-10 하이드레이션 오류: 문항 설정 상태의 기본 문항 `question_id`를 렌더마다 `randomUUID()`로
// 만들어 서버 HTML과 브라우저의 `id`·`htmlFor`가 어긋났다. id는 서버가 한 번 만들어 내려 준다.
import { seedQuestionForms, newQuestionForm } from "./question-form"

describe("문항 설정 상태의 첫 문항 id는 서버가 준 값을 쓴다 (하이드레이션)", () => {
  it("seedQuestionForms(ids)는 넘겨받은 id를 그대로 쓴다 — 같은 ids면 같은 폼", () => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]
    expect(seedQuestionForms(ids).map((f) => f.question_id)).toEqual(ids)
    expect(seedQuestionForms(ids)).toEqual(seedQuestionForms(ids))
    expect(newQuestionForm("q_4", "44444444-4444-4444-8444-444444444444").question_id).toBe("44444444-4444-4444-8444-444444444444")
  })

  it("페이지(서버)가 seed_question_ids를 만들고 화면은 그것으로 첫 폼을 만든다", () => {
    const page = readFileSync(join(__dirname, "../../../app/(page)/(gated)/applications/[id]/cover-letter/page.tsx"), "utf8")
    expect(page).toMatch(/seed_question_ids:\s*Array\.from\(/)
    const screen = read("cover-letter-screen.tsx")
    expect(screen).toMatch(/previewForms\(data\.document, previewState, data\.seed_question_ids\)/)
    expect(screen).not.toMatch(/seedQuestionForms\(\)/)
  })
})

// 회귀 가드 — 2026-11-10 "작성 시작 누르면 AI 연결해야만 쓸 수 있다고 토스트": 요건 선행 추출 판정이 AI 연결을 보지 않았다.
describe("요건 선행 추출은 AI를 쓸 수 있을 때만 (FL-03)", () => {
  it("needed = 요건 없음 && AI 사용 가능 — 키 없으면 추출 없이 바로 저장", () => {
    const src = read("question-setup.tsx")
    expect(src).toMatch(/needed:\s*extractFirst && aiUsable/)
    expect(src).toMatch(/aiUsable = Boolean\(connection\?\.active_provider\)/)
  })
})
