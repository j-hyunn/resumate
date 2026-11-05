"use client"

/**
 * "새 프로젝트" · "새 산출물" 페이지를 다시 열 때 이전 트리를 버리는 장치 (버그 보고 2026-11-05).
 *
 * 왜 필요한가: Next 16은 떠난 라우트의 React 트리를 **언마운트하지 않고 숨겨 두고**(`<Activity>`), 같은
 * 주소로 돌아오면 그 상태를 그대로 되살린다(서버 데이터만 새로 받는다). S-10 · S-44의 새 행 페이지는 첫
 * 저장 때 행을 만들고 `window.history.replaceState`로 URL만 바꾸므로(컴포넌트를 마운트된 채 두는 게 설계
 * 의도다 — 33 런) 그 트리의 상태 = **방금 만든 행**이다. 그래서 경력·교육 상세의 "+ 프로젝트 추가",
 * S-43의 "+ 산출물 추가"로 새 행 주소에 다시 들어오면 서버는 빈 새 행을 주지만 화면은 되살아난 상태 그대로
 * 방금 만든 프로젝트·산출물을 보여 준다.
 *
 * 고치는 방법: 행을 만든 트리를 기억해 두고, 다시 보일 때 그 행의 주소가 아니면(= 새 행 주소로 돌아왔으면)
 * `key`를 바꿔 페이지를 서버 데이터로 다시 마운트한다. 숨겨진 트리가 다시 보일 때 effect가 다시 실행되는
 * 것을 이용한다. 주소에 행 ID가 있으면(기존 행 페이지, 뒤로·앞으로) 그대로 둔다.
 */
import * as React from "react"

export interface NewRowRemount {
  /** 페이지 컴포넌트에 주는 `key` */
  key: number
  /** 행이 생겼을 때(또는 그 행의 URL로 바꿀 때) 호출 */
  markRow: (rowId: string) => void
}

export function useNewRowRemount(): NewRowRemount {
  const [key, setKey] = React.useState(0)
  const rowRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const rowId = rowRef.current
    // 첫 마운트(rowId 없음) / 기존 행 주소에서 되살아난 경우는 그대로
    if (!rowId || window.location.pathname.includes(rowId)) return
    rowRef.current = null
    setKey((k) => k + 1)
  }, [])
  const markRow = React.useCallback((rowId: string) => {
    rowRef.current = rowId
  }, [])
  return { key, markRow }
}
