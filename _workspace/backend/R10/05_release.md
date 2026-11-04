# R10 배포 순서 (준비만 — 원격 쓰기·머지는 사용자 몫)

## 원격에 올릴 마이그레이션
| 순서 | 파일 | 파괴적 | 내용 |
|------|------|--------|------|
| 1 | `20261113000400_r10_classification_dismiss_guard.sql` | 아님 | `private.wc_patch_star` 교체(분류 [무시] 슬롯의 AI 패치 거부). 데이터 변경 없음 |

- 원격 마지막 적용(2026-11-04 기준, 상위 세션 안내): `20261113000300` → 새 파일은 그 뒤로 정렬된다. push 전에 `list_migrations`(읽기 전용)로 다시 확인할 것.
- 새 환경 변수 없음.

## 순서 의존
- 앱 코드와 강한 순서 의존 없음.
  - 마이그레이션 먼저(옛 코드): 옛 코드도 `rejected`를 로그만 하고 턴을 정상 진행 → 안전.
  - 코드 먼저: R9 V-9i가 턴 시작 시점의 [무시]는 거름. 경합만 남음(기존 상태와 같음).
- 권장: R8·R9·UI 개정(ui-panel-doc)과 같은 머지 묶음이면, **마이그레이션 push → 머지** 순서(main 머지는 운영 배포).

## 사용자가 실행할 명령
```bash
supabase db push
```
그 뒤 머지(이 브랜치 `claude/r10-dismiss-guard-c51181`은 `21b3442` 위에 쌓여 있으므로 R8·R9 브랜치와 함께 들어간다).

## push 뒤 확인(리더)
- `list_migrations`에 `20261113000400` 있음, `get_advisors`(security·performance) — 함수 교체만이라 새 항목은 없을 것으로 예상.

## 결과 (2026-11-04)
- 사용자 요청으로 상위 세션이 이 워크트리에서 `supabase db push` 실행 → `20261113000400_r10_classification_dismiss_guard.sql` 적용.
- 원격 `list_migrations` 마지막 항목: `20261113000400 r10_classification_dismiss_guard`.
- 보안 advisor: 기존 항목뿐(authenticated SECURITY DEFINER public RPC 22건, `account_deletion_logs` RLS 정책 없음 INFO, 유출 비밀번호 보호, MFA 옵션). R10은 `private.wc_patch_star`만 바꿔 새 항목 없음.
- 남은 것: 코드 머지(R8·R9·UI 개정과 같은 묶음).
- 참고: 이 워크트리는 `supabase link`로 원격 프로젝트에 연결됨(`supabase/.temp`, git 무시 대상).
