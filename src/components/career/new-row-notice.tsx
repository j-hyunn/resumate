/**
 * 새 행 표시 (S-10 새 프로젝트 · S-44 새 산출물) — A2 영역.
 *
 * "+ 프로젝트 추가" / "+ 산출물 추가"로 들어온 빈 페이지가 기존 행 상세와 똑같아 보이는 문제를 이동 줄 현재 위치
 * 문구로 구분한다(33 런). 행이 생기면(첫 저장 성공 → `project_id` / `project_deliverable_id` 상태) "… 상세"로 바뀐다.
 *
 * 머리 맨 위 "아직 추가되지 않았어요" 안내 배너는 두 화면 모두 없앴다(사용자 결정 2026-11-05).
 */

export type NewRowKind = "project" | "deliverable"

/** 이동 줄의 현재 위치 문구: 행이 없으면 "새 … 추가", 있으면 기존 "… 상세" */
export const CRUMB_CURRENT: Record<NewRowKind, { new: string; existing: string }> = {
  project: { new: "새 프로젝트 추가", existing: "프로젝트 상세" },
  deliverable: { new: "새 산출물 추가", existing: "산출물 상세" },
}
