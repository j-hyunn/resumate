# R10 api·파이프라인 노트 — 새 거부의 처리 확인 (리더 작성)

## 코드 경로
- `services/writing-chat/turn.ts` `runExtract` → `deps.chats.applyAiPatch(chat.id, outcome.patch)` → `db.ts` `applyAiPatch`: `rejected`가 있으면 `writing_chat.patch_rejected` 로그(개수·이유 코드, 텍스트 없음 C-7)만 남기고 **RPC가 저장한 초안**을 돌려준다. 예외 아님 → `markExtracted` 진행, 턴 성공.
- `after`가 DB 초안이므로 `draft_patch` 이벤트는 무시된 슬롯(값 null, rev 2)을 그대로 화면에 보낸다(화면은 값 없는 슬롯을 제안으로 보이지 않음).
- 코드 변경: 주석만(`v9.ts` V-9i, `structured-draft.ts` `isDismissedClassification`에 DB 가드 언급). 동작 변경 없음.

## 통합 테스트 (로컬 스택)
- `writing-chat.integration.test.ts` "R10 (R9 QA-05)": 새 프로젝트(상황·행동 시드) → 턴 N이 `experience_type` 제안(rev 1) → 턴 N+1의 extract 호출 안에서 사용자 `applyDraftEdit(null)`([무시]) → 그 턴 extract가 다른 값 추천 → V-9i는 턴 시작 초안을 보므로 통과시키고 RPC가 거부.
- 확인: `error` 이벤트 없음, 마지막 `turn_done`, 작업 `succeeded`, `last_extracted_sequence` = 4, 로그 `writing_chat.patch_rejected` + `classification_dismissed`, 슬롯 `{value:null, origin:'ai', rev:2}`, `draft_patch`가 있으면 같은 상태.
- R8 함수로 되돌리면 이 테스트가 실패(로그에 `patch_rejected` 없음 — 슬롯이 다시 채워짐) → 경합 재현이 맞다.
- 주의: 같은 값 재추천은 V-9가 "unchanged"로 보고 패치를 만들지 않으므로 테스트는 다른 값(`leadership`)을 쓴다.
