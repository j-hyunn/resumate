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
