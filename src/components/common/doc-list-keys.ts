/**
 * DocTextarea 목록 편의 키 (design-system v4 5.9, G-50) — pure, unit-tested (doc-list-keys.test.ts).
 *
 * - Enter on a list line (`- `, `* `, `1. `) continues the list; Enter on an empty item removes the marker.
 * - Tab / Shift+Tab indent / outdent a list line by 2 spaces **only when there is something to do**:
 *   no outdent at column 0, no indent past MAX_INDENT. Otherwise `null` → the browser default (focus moves),
 *   so the field never traps the keyboard (WCAG 2.1.2, QA UQ-PA-5).
 * - Escape arms an exit: the next Tab / Shift+Tab is never captured (DocTextarea keeps the flag).
 *   The depth limit and the Escape exit rule are in design-system 5.9 (DocTextarea).
 */

export interface TextEdit {
  value: string
  caret: number
}

export const LIST_RE = /^(\s*)([-*]|\d+\.)\s+/
/** [UI-가정] 3 levels below the top (6 spaces) */
export const MAX_INDENT = 6

export function lineBounds(value: string, caret: number): { start: number; end: number; line: string } {
  const start = value.lastIndexOf("\n", caret - 1) + 1
  const nl = value.indexOf("\n", caret)
  const end = nl < 0 ? value.length : nl
  return { start, end, line: value.slice(start, end) }
}

/** Enter on a list line. `null` = not a list line (or a selection) → default newline. */
export function continueList(value: string, selectionStart: number, selectionEnd = selectionStart): TextEdit | null {
  if (selectionStart !== selectionEnd) return null
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1
  const before = value.slice(lineStart, selectionStart)
  const m = before.match(LIST_RE)
  if (!m) return null
  const [, indent, marker] = m
  if (before.trim() === marker && value.slice(selectionStart, lineBounds(value, selectionStart).end).trim() === "") {
    // empty item: drop the marker, the caret stays on this (now empty) line
    return { value: value.slice(0, lineStart) + value.slice(selectionStart), caret: lineStart }
  }
  const nextMarker = /^\d+\.$/.test(marker) ? `${Number(marker.slice(0, -1)) + 1}.` : marker
  const insert = `\n${indent}${nextMarker} `
  return { value: value.slice(0, selectionStart) + insert + value.slice(selectionEnd), caret: selectionStart + insert.length }
}

/** Tab (`outdent = false`) / Shift+Tab on a list line. `null` = nothing to do → default (focus moves). */
export function indentList(value: string, caret: number, outdent: boolean): TextEdit | null {
  const { start, line } = lineBounds(value, caret)
  const m = line.match(LIST_RE)
  if (!m) return null
  const current = m[1].length
  if (outdent) {
    const removed = line.startsWith("  ") ? 2 : line.startsWith(" ") ? 1 : 0
    if (!removed) return null
    return { value: value.slice(0, start) + line.slice(removed) + value.slice(start + line.length), caret: Math.max(start, caret - removed) }
  }
  if (current + 2 > MAX_INDENT) return null
  return { value: value.slice(0, start) + "  " + value.slice(start), caret: caret + 2 }
}
