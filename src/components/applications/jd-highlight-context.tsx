"use client"

/**
 * S-15 문장 하이라이트 요청 (UQ-614). S-46 안에서 "공고 원문" 링크(S-16 요건 행)나 `jd_sentence` 근거 칩(C-01 → C-02)을
 * 누르면 서버 재렌더 없이 **클라이언트에서** 채용 공고 탭으로 바꾸고 강조를 다시 건다. `nonce`가 요청마다 바뀌므로 같은
 * 링크를 다시 눌러도, 탭을 떠났다 와도 강조가 다시 걸린다.
 */
import * as React from "react"

export interface JdHighlightRequest {
  sids: string[]
  nonce: number
}

export const JdHighlightRequestContext = React.createContext<JdHighlightRequest | null>(null)

export function useJdHighlightRequest(): JdHighlightRequest | null {
  return React.useContext(JdHighlightRequestContext)
}
