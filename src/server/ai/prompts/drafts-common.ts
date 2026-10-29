/** Data can't close a tag (C-4). Single-line form for list items. */
export function escLine(text: string): string {
  return text.replace(/</g, "＜").replace(/>/g, "＞").replace(/[\r\n]+/g, " ");
}

/** Multi-line data (notes): tags escaped, line breaks kept. */
export function escBlock(text: string): string {
  return text.replace(/</g, "＜").replace(/>/g, "＞");
}

/** QA-S6-04 rule shared by the document prompts: aliases only in reference fields. */
export const ALIAS_RULE = `별칭은 참조 칸에만
- EXP-1, EDU-1, PRJ-2, DET-3, ACH-4, SKL-5, REQ-1, S6, NOTE-1 같은 별칭은 *_ref, *_refs, evidence에만 씁니다.
- 사용자에게 보이는 문장(text, rationale, reason, reuse_reason, notes_for_user)에는 별칭을 쓰지 않고 이름으로 씁니다. 예: "PRJ-3에서" (X) → "'정산 시스템' 프로젝트에서" (O).`;
