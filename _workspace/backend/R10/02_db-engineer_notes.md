# R10 db 노트 — 분류 [무시] 가드 (리더가 db-engineer 몫으로 작성)

## 마이그레이션
- `supabase/migrations/20261113000400_r10_classification_dismiss_guard.sql` — 비파괴. `private.wc_patch_star`만 교체(R8 `20261113000300` 정의 + 가드 1곳). `public.apply_structured_draft_patch`·`private.apply_structured_draft_patch_impl`·권한·반환 모양 그대로. 테이블·컬럼·CHECK·`schema_version` 변경 없음 → `database.types.ts` 재생성 불필요(시그니처 같음).
- 원격 마지막 적용 `20261113000300`보다 뒤로 정렬됨.

## 가드
AI `set`(분류) 분기에서 `protected_field` 검사 다음, 값 검사 앞:

| 조건 | 결과 |
|------|------|
| 슬롯이 객체 + `value` null/없음 + `private.wc_rev(slot) ≥ 2` | `rejected += {index, op:'set', reason:'classification_dismissed'}`, 슬롯·rev 그대로, 같은 패치의 다른 op는 적용 |
| 슬롯 없음, 또는 값 있는 rev 1 이상의 대기 제안 | 이전과 같음(AI 제안 기록·교체, rev + 1) |
| 값 null + rev 1(RPC로는 생기지 않는 데이터) | 무시 아님 → AI 제안 수락 |
| 무시한 슬롯에 사용자가 값 선택(`set` 값) | 이전과 같음 → `origin user_edit`, 이후 AI 패치는 `protected_field` |
| AI null(무시한 슬롯) | 가드가 먼저 → `classification_dismissed` (무시 안 한 슬롯은 기존대로 `invalid_value`) |

- 거부 코드를 고른 이유: AI 액터의 `rejected`는 비치명 거부 목록이고 앱(`createTurnChatDb.applyAiPatch`)은 이유 코드만 로그(`writing_chat.patch_rejected`)로 남기고 저장된 초안을 돌려준다. 조용히 버리면 경합 빈도가 보이지 않는다. 사용자 액터는 이 분기에 오지 않으므로 `errors.ts` 매핑은 필요 없다.

## pgTAP
- `supabase/tests/r9_classification_dismiss.test.sql` 25 → 41개. "(b) RPC가 수락" 2개를 거부 단언으로 교체, R10 경합(턴 N 제안 rev 1 → 사용자 [무시] rev 3 → 턴 N+1 패치 거부·rev 그대로), 섞인 패치(무시한 op만 거부), AI가 자기 대기 제안 교체, rev 1 빈 슬롯, 무시 뒤 사용자 선택 → `protected_field` 추가.
- 가드 없는 R8 함수로 되돌려 돌리면 8개 실패(24–27, 33–35, 40) — 테스트가 가드를 실제로 잡는다.

## 로컬 적용
- `supabase migration up --local`로 로컬(공유 스택)에 적용. 원격 쓰기 없음.
