/**
 * 새 행 안내 (S-10 새 프로젝트 · S-44 새 산출물) — A2 영역 컴포넌트.
 *
 * "+ 프로젝트 추가" / "+ 산출물 추가"로 들어온 빈 페이지가 기존 행 상세와 머리글까지 똑같아서 "아무것도 추가되지
 * 않고 기존 상세로 넘어왔다"고 읽히는 문제를 표시로 푼다(33 런 브리프, 사용자 결정 2026-11-04: 화면 전환 구조와
 * 첫 저장 때 행 생성(PA-3)은 그대로, 표시만 바꾼다).
 *
 * 행이 생기면(첫 저장 성공 → `project_id` / `project_deliverable_id` 상태) 호출 쪽에서 더 이상 그리지 않으므로
 * URL이 아니라 상태를 따라 사라진다(새로 고침 없이 전환).
 *
 * [UI-가정] 이 안내 줄은 UX v5.6 S-10·S-44 머리 표에 없다(기획 확인 필요).
 * [UI-가정] design-system 5.8의 "L-02에 `draft` 배지·Alert를 두지 않는다"(CR-11)는 저장된 행의 완료/작성 중
 * 표시를 뜻하므로, 아직 저장조차 되지 않은 새 행 안내는 그 금지에 해당하지 않는다고 본다. 문구에서 "작성 중"은
 * 쓰지 않아 C-06 저장 상태 문구·draft 배지와 섞이지 않게 한다.
 */
import { FilePlus2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export type NewRowKind = "project" | "deliverable"

/** [UI-가정] 문구 (명세에 없음) — "저장하기"가 추가 동작임을 한 줄로 말한다 */
const COPY: Record<NewRowKind, { title: string; body: string }> = {
  project: {
    title: "아직 추가되지 않았어요",
    body: '새 프로젝트를 쓰는 중이에요. 위 "저장하기"를 누르면 이 프로젝트가 커리어에 추가돼요',
  },
  deliverable: {
    title: "아직 추가되지 않았어요",
    body: '새 산출물을 쓰는 중이에요. 위 "저장하기"를 누르면 이 산출물이 프로젝트에 추가돼요',
  },
}

/** 이동 줄의 현재 위치 문구: 행이 없으면 "새 … 추가", 있으면 기존 "… 상세" */
export const CRUMB_CURRENT: Record<NewRowKind, { new: string; existing: string }> = {
  project: { new: "새 프로젝트 추가", existing: "프로젝트 상세" },
  deliverable: { new: "새 산출물 추가", existing: "산출물 상세" },
}

/**
 * 머리 맨 위 안내. 점선 테두리 + `info` 톤으로 기존 행 화면과 눈에 띄게 구분된다(토큰만 사용).
 * `role="note"`: 화면을 열 때 바로 읽히는 정적 안내라 `alert`의 즉시 알림을 쓰지 않는다.
 */
export function NewRowNotice({ kind }: { kind: NewRowKind }) {
  const copy = COPY[kind]
  return (
    <Alert role="note" variant="info" className="border-dashed">
      <FilePlus2 aria-hidden />
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>{copy.body}</AlertDescription>
    </Alert>
  )
}
