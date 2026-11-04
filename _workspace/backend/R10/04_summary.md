# R10 요약 — 분류 [무시] 슬롯의 AI 패치 DB 가드 (R9 QA-05, DM 11.5 #1 후보 a)

- 상태: done (2026-11-04). QA 2라운드 — 남은 이슈 없음.
- 비파괴 마이그레이션 1개, 새 환경 변수 없음, UI 변경 없음. 원격 미반영(`05_release.md`).

## 만든 것
- `supabase/migrations/20261113000400_r10_classification_dismiss_guard.sql`: `private.wc_patch_star` 교체. AI 분류 `set`이 사용자가 [무시]한 슬롯(객체·값 null·rev ≥ 2)을 겨누면 `rejected`에 `classification_dismissed`(비치명)로 거부하고 슬롯·rev를 그대로 둔다. 같은 패치의 다른 op는 적용. 사용자 경로(값 선택·다시 비우기) 그대로.
- 거부 코드를 고른 이유: AI `rejected`는 비치명 거부 체계(`protected_field` 등)이고 앱은 이유 코드만 로그로 남기며 턴을 정상 진행 → 경합 빈도가 로그(`writing_chat.patch_rejected`)에 보인다.
- pgTAP `r9_classification_dismiss.test.sql` 25 → 41개: "(b) RPC 수락" 단언을 거부로 교체, 경합·섞인 패치·자기 제안 교체·rev 1 빈 슬롯·무시 뒤 사용자 선택(`protected_field`) 추가.
- 통합 테스트(`writing-chat.integration.test.ts`): 실제 `runTurn` 중 extract 호출 안에서 사용자 [무시] → 그 턴 추천이 RPC에서 거부, 턴 성공·작업 succeeded·추출 표시 진행·슬롯 비운 채.
- 두 테스트 모두 R8 함수로 되돌리면 실패함을 확인.
- 주석: `v9.ts` V-9i, `structured-draft.ts` `isDismissedClassification`.
- 문서: DM 11.5 #1 결과 한 줄, decisions 4.11 진행 한 줄.

## 검사
- typecheck·lint 통과, vitest 130파일 2,245개 통과, pgTAP(로컬) 57파일 2,772개 통과.
- HTTP 로컬 스모크 SKIP(요청 경로 변경 없음, 통합 테스트로 대신). 브라우저 확인 없음.
- 로컬 공유 Supabase 스택에 마이그레이션을 적용함(다른 워크트리도 같은 DB를 씀 — 비파괴라 영향 없음).

## 남은 것
- UI 후속(범위 밖): 화면 `localStorage` [무시] 기억을 서버 판정(값 null·rev ≥ 2)으로 대체 — DM 11.5 #1, resumate-ui.
- DM 2.x 본문(분류 [무시] 설명, "후속(미구현, 11.5)") 문구 갱신은 기획 쪽 정리 몫.
- `[가정]` 새로 없음.
