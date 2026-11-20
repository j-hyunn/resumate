/**
 * 2026-11-10 사용자 요청 — S-46 탭에서 지운 안내와 바꾼 표시. 이 안내들은 AI 연결 상태(브라우저)를 읽은 뒤에야
 * 그려져 서버 렌더로는 확인할 수 없어 소스로 묶는다.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (p: string) => readFileSync(join(__dirname, p), "utf8")

describe("S-46 탭 안내 정리", () => {
  it("① 자소서 탭 빈 상태에 잠금 안내·근거 안내·민감정보 안내를 두지 않는다", () => {
    const src = read("answer-tab.tsx")
    expect(src).not.toMatch(/<AiLock entry="draft"/)
    expect(src).not.toMatch(/\{ANSWER_NOTE\}/)
    expect(src).not.toMatch(/<InputGuide guide="G-2"/)
  })

  // (v5.21, JR-1) the 요건 영역 ("요건 정리하기", 요건 목록) is gone — the tab is the raw text only.
  it("② 채용 공고 탭: 요건 목록 열·AI 진입점이 없다 (v5.21)", () => {
    const src = read("../jd-view.tsx")
    expect(src).not.toMatch(/requirements|techKeywords|seniority/)
    expect(src).not.toMatch(/<AiLock\b/)
    expect(src).not.toMatch(/retryJdExtractionAction/)
  })

  it("③ 채용 공고 원문은 읽기 전용 마크다운으로 보인다 (강조할 문장이 있을 때만 일반 글)", () => {
    const src = read("../jd-view.tsx")
    expect(src).toMatch(/shown\.length === 0 \? \(/)
    expect(src).toMatch(/<DocTextarea value=\{rawText\}.*\breadOnly\b/)
  })

  it("③-2 공고 원문 편집도 공통 마크다운 편집기(일반 입력칸 아님)", () => {
    const src = read("../jd-raw-edit.tsx")
    expect(src).toMatch(/<DocTextarea\s+ref=\{focusOnce\}/)
    expect(src).not.toMatch(/<Textarea\b/)
  })

  it("⑤ 채용 공고 탭: 원문은 카드 없이 전체 폭", () => {
    const src = read("../jd-view.tsx")
    expect(src).not.toMatch(/xl:grid-cols-2/)
    expect(src).toMatch(/<section aria-label="공고 원문" className="flex min-w-0 flex-col gap-3">/)
  })

  it("⑥ 자기소개서 추가 모달에도 AI 잠금 안내를 두지 않는다 (R17: 요건 미리 보기 호출이 없다)", () => {
    const src = read("../add-application-dialog.tsx")
    expect(src).not.toMatch(/<AiLock\b/)
    expect(src).not.toMatch(/extractJdPreviewAction/)
  })

  it("⑦ 추가 모달 ② 공고 내용 칸은 마크다운 편집기 — 고치기 전에는 값을 다시 내보내지 않는다(가져온 원문 그대로)", () => {
    const src = read("../add-application-dialog.tsx")
    expect(src).toMatch(/<DocTextarea\s+id="add-ap-raw"/)
    const editor = readFileSync(join(__dirname, "../../common/doc-markdown-editor.tsx"), "utf8")
    expect(editor).toMatch(/setContent\(value, \{ contentType: "markdown", emitUpdate: false \}\)/)
    expect(editor).toMatch(/editor\.setEditable\(!readOnly, false\)/)
  })

  it("④ 인사이트 탭 잠금 안내는 카드 없이 컨테이너에 바로", () => {
    const src = read("../insight-view.tsx")
    expect(src).toMatch(/<AiLock entry="insight" size="area" bare /)
    const lock = readFileSync(join(__dirname, "../../common/ai-lock.tsx"), "utf8")
    expect(lock).toMatch(/return bare \? <div \{\.\.\.props\} \/> : <Card \{\.\.\.props\} \/>/)
  })

  it("UQ-614: 같은 페이지의 채용 공고 탭 링크는 클라이언트에서 탭을 바꾸고 nonce로 강조를 다시 건다 — 이탈 확인보다 먼저", () => {
    const src = read("cover-letter-screen.tsx")
    const listener = src.indexOf('document.addEventListener("click", onClick, true)')
    const guard = src.indexOf("useLeaveGuard({")
    expect(listener).toBeGreaterThan(0)
    expect(listener).toBeLessThan(guard)
    // UQ-622: preventDefault only — the link's own onClick (e.g. C-02 panel close) must still run
    expect(src).toMatch(/e\.preventDefault\(\)/)
    expect(src).not.toMatch(/e\.stopImmediatePropagation\(\)/)
    expect(src).toMatch(/nonce: \(prev\?\.nonce \?\? 0\) \+ 1/)
    const view = read("../jd-view.tsx")
    expect(view).toMatch(/useJdHighlightRequest\(\)/)
    expect(view).toMatch(/tabIndex=\{sid === first \? -1 : undefined\}/)
  })
})
