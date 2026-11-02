/**
 * S-15 공고 원문 수정 state (Q53-2). Pure, so the refusal path can be tested alone.
 *
 * A save refused because the conditions changed keeps the editor open with what was typed (02 S-15 "저장
 * 실패"), whichever way the read-back goes: the server's `editable` may turn false, or stay true.
 */
export interface JdRawEditState {
  editing: boolean
  /** the last save was refused because the conditions changed. Cleared by closing or reopening */
  refused: boolean
  saved: boolean
}

export type JdRawEditEvent = "start" | "stop" | "saved" | "refused" | "clear_saved"

export function jdRawEditReducer(s: JdRawEditState, e: JdRawEditEvent): JdRawEditState {
  switch (e) {
    case "start":
      return { editing: true, refused: false, saved: false }
    case "stop":
      return { ...s, editing: false, refused: false }
    case "saved":
      return { editing: false, refused: false, saved: true }
    case "refused":
      return { ...s, refused: true }
    case "clear_saved":
      return { ...s, saved: false }
  }
}

export function jdRawEditView(s: JdRawEditState, serverEditable: boolean): { editorOpen: boolean; editable: boolean } {
  return {
    // another tab may have taken the condition away: the server's answer wins, except over a refused save
    editorOpen: s.editing && (serverEditable || s.refused),
    // false turns "저장" off and hides the entry buttons
    editable: serverEditable && !s.refused,
  }
}
