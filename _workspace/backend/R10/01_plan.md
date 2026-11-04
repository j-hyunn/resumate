# R10 계획 — 분류 [무시] 슬롯의 AI 패치 DB 가드 (R9 QA-05, DM 11.5 #1 후보 a)

## 왜
R9는 분류 [무시]를 서버 파이프라인(V-9i)에서만 걸렀다(후보 b). V-9 컨텍스트는 턴 시작 때 읽은 초안이라, 턴이 도는 중에 사용자가 [무시]하면 그 턴의 AI 분류 추천이 `apply_structured_draft_patch`를 거쳐 비운 슬롯을 다시 채운다(R9 QA-05). DB 함수가 정본 판정을 하게 한다.

## 범위
- DB: `private.wc_patch_star` 교체(새 비파괴 마이그레이션 1개, `20261113000400_r10_classification_dismiss_guard.sql`). 시그니처·반환 모양·권한·`apply_structured_draft_patch(_impl)` 그대로. 테이블·컬럼·CHECK·`schema_version` 변경 없음.
- 판정(TS `isDismissedClassification`과 같음): 분류 슬롯이 객체로 있고, `value`가 null(또는 없음), `rev ≥ 2`. AI 경로는 분류에 null을 쓸 수 없고(`invalid_value`) 첫 객체는 rev 1이라, 이 상태는 사용자 [무시](`set` null)에서만 생긴다.
- 동작: AI `set`(분류)이 이런 슬롯을 겨누면 **`rejected`에 `{index, op:'set', reason:'classification_dismissed'}`** 를 남기고 슬롯은 그대로. 같은 패치의 다른 op는 그대로 적용.
  - 조용히 버리기 대신 거부 코드를 고른 이유: AI 액터의 `rejected` 배열은 원래 "비치명 거부" 용도(`protected_field`·`invalid_value`·`invalid_source`·`field_not_patchable`)이고, 파이프라인(`createTurnChatDb.applyAiPatch`)은 이를 `writing_chat.patch_rejected` 로그(이유 코드만)로 남기고 턴을 정상 진행한다. 거부 코드가 있으면 경합이 실제로 얼마나 생기는지 로그로 보인다. 코드 이름은 V-9i 카운터(`classification_dismissed`)와 같게.
  - 사용자 경로는 바꾸지 않는다: 사용자가 [무시]한 슬롯에 직접 값을 고르는 `set`(값 있음), 다시 `set` null(rev + 1)은 그대로.
- pgTAP: `r9_classification_dismiss.test.sql`의 "(b) RPC가 수락" 단언을 거부로 바꾸고, 경합 케이스(같은 패치 안 다른 op는 적용, 무시 뒤 사용자 직접 선택 → AI 패치 보호, rev 1 빈 슬롯은 무시 아님 등)를 추가.
- API/파이프라인: 코드 변경 없음 예상. 확인 = 로컬 스택 통합 테스트로 경합을 재현(턴 2의 extract 중에 사용자가 [무시] → 그 턴의 AI 추천이 RPC에서 거부, 턴 성공·슬롯 비운 채·로그 `classification_dismissed`).

## 팀 운영
작은 수정 슬라이스라 리더가 직접 db-engineer·api 확인 몫을 하고, QA는 `run-checks.sh`로 최대 2라운드.

## 배포 영향
- 비파괴 마이그레이션 1개(함수 교체만). 새 환경 변수 없음.
- 앱 코드와 순서 의존 없음: 마이그레이션이 먼저 나가도(옛 코드) 옛 코드는 `rejected`를 로그만 하므로 안전, 코드가 먼저 나가도 V-9i가 대부분 거름.

## 연결
- UI 변경 없음(화면 `localStorage` 기억 대체는 DM 11.5 #1의 별도 UI 후속, 이번 범위 밖).

## 관련 [가정]
- 없음(판정은 R9의 `isDismissedClassification`과 같음).
