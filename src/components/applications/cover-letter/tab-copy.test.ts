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

  it("② 채용 공고 탭: AI 미연결이면 원문 오른쪽 잠금 영역을 그리지 않는다", () => {
    const src = read("../jd-view.tsx")
    expect(src).toMatch(/if \(connection && !connection\.active_provider\) return null/)
    expect(src).not.toMatch(/<AiLock entry="requirements" size="area"/)
  })

  it("③ 채용 공고 원문은 읽기 전용 마크다운으로 보인다 (강조할 문장이 있을 때만 일반 글)", () => {
    const src = read("../jd-view.tsx")
    expect(src).toMatch(/!active \? \(/)
    expect(src).toMatch(/<DocTextarea value=\{rawText\}.*\breadOnly\b/)
  })

  it("④ 인사이트 탭 잠금 안내는 카드 없이 컨테이너에 바로", () => {
    const src = read("../insight-view.tsx")
    expect(src).toMatch(/<AiLock entry="insight" size="area" bare /)
    const lock = readFileSync(join(__dirname, "../../common/ai-lock.tsx"), "utf8")
    expect(lock).toMatch(/return bare \? <div \{\.\.\.props\} \/> : <Card \{\.\.\.props\} \/>/)
  })
})
