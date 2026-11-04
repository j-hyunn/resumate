# R10 백엔드 QA 리포트

## 라운드 1
| 항목 | 결과 |
|------|------|
| 마이그레이션 정렬 | 통과 — `20261113000400` > 원격 마지막 `20261113000300` |
| 비파괴·시그니처 | 통과 — `private.wc_patch_star`만 교체, 공개 RPC·권한·반환 모양 그대로, 타입 재생성 불필요 |
| DB 판정 ↔ TS `isDismissedClassification` | 일치 — 슬롯 있음·값 없음·rev ≥ 2 (DB는 빈 competencies 배열을 저장하지 않으므로 null 판정만으로 같음) |
| 거부 코드 ↔ 앱 처리 | 통과 — `rejected`는 `applyAiPatch`에서 로그만, 예외 아님. 사용자 액터는 이 분기에 오지 않아 `errors.ts` 매핑 불필요 |
| pgTAP r9 (41개) | 통과. 가드 없는 R8 함수로는 8개 실패 확인 |
| 경합 통합 테스트(로컬 스택) | 통과. R8 함수로는 실패 확인 |
| `run-checks.sh` | typecheck **FAIL** — 통합 테스트의 `suggest(value: string)` 타입(QA-R10-01). lint·vitest(130파일 2,245개)·pgTAP(57파일 2,772개) 통과 |

### QA-R10-01 [Minor] 테스트 헬퍼 인자 타입
- `writing-chat.integration.test.ts` `suggest`의 `value: string`이 `experience_type` 리터럴 유니언에 맞지 않음 → 리터럴 유니언으로 수정(리더). 상태: 해결.

## 라운드 2
- `run-checks.sh`: typecheck·lint·vitest(130파일 2,245개)·pgTAP(57파일 2,772개) 모두 PASS.
- 로컬 스모크(HTTP 경로): SKIP — 요청 경로·deps 변경 없음. 대신 실제 `runTurn` + 로컬 DB RPC 통합 테스트로 턴 경로를 확인.

## 최종
- Critical 0, Major 0, Minor 0 남음.
