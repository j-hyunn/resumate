/**
 * S-24 설정 다이얼로그 — 조작 요소의 모서리 · 연한 초록 채움 농도를 정하는 **한 곳** (design-system 5.11.0, v5.12).
 *
 * 확정 2026-11-06 (사용자, design-system 8.5):
 * - DR-13 모서리: 원본 화면 약 6~8px 대신 브랜드 `rounded-control` 12px 유지.
 * - DR-14 연한 초록 채움(secondary 버튼 [연결]·[전문 확인]·[+ 관심 직무 추가], 사용량 공급자 알약):
 *   원본 화면 약 20% 대신 `secondary` 10% 유지 (hover는 자동으로 +5%).
 * 다시 바꾸게 되면 여기 두 값만 고친다.
 *
 * 다이얼로그 본체(`DialogContent`)와 다이얼로그 안에서 여는 팝오버(최종 학력 기간 칸)에 같은 style을 준다.
 * 주의: 그 밖의 포털 요소(셀렉트 목록 · ⋯ 메뉴 · 미저장 확인/활성 전환/키 삭제 AlertDialog · C-21 동의 창)는 body로
 * 포털되어 이 변수를 물려받지 않는다 — 값을 바꾸면 그 요소들은 따라가지 않고 앱 기본값(12px · 10%)으로 남는다.
 * `--control-radius`는 `rounded-control`(globals.css), `--tint-strength`는 `bg-tint`(globals.css)가 읽는다.
 * 활성 공급자 행·선택 탭 알약(primary 10%)은 화면과 이미 같아 이 값을 따르지 않는다.
 */
import type * as React from "react"

export const SETTINGS_CONTROL_RADIUS = "12px" // DR-13
export const SETTINGS_TINT_STRENGTH = "10%" // DR-14

export const SETTINGS_VISUAL_STYLE = {
  "--control-radius": SETTINGS_CONTROL_RADIUS,
  "--tint-strength": SETTINGS_TINT_STRENGTH,
} as React.CSSProperties
