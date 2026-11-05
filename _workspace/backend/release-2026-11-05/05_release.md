# 원격 반영 2026-11-05 — R11 + R12

- 대상: Supabase `resumate` (ref `rxtnguarpotkcgdazkbw`, 운영 겸용 단일 프로젝트)
- 요청: 사용자 "원격 반영 먼저해" (2026-11-05). R12 코드(PR #50)는 아직 머지 전
- 적용 전 원격 마지막 마이그레이션: `20261113000400_r10_classification_dismiss_guard`
- 순서 확인: 아래 9개 파일 모두 원격 마지막 항목 뒤에 정렬됨 → 이름 변경 불필요

## 적용 순서 (모두 비파괴 — `-- DESTRUCTIVE` 표시 없음)

| 순서 | 파일 | 내용 |
|---|---|---|
| 1 | `20261113000500_r11_interview_detach_schema` | 면접 세션 자기소개서 FK nullable·`on delete set null`, 스냅샷 컬럼, CHECK |
| 2 | `20261113000600_r11_application_projects_detach_interviews` | BEFORE DELETE 트리거 `private.application_projects_detach_interviews()` |
| 3 | `20261113000700_r11_interview_read_only_guard` | 분리된 세션 읽기 전용 가드 |
| 4 | `20261113000800_r11_deletion_impact_application_project` | `get_deletion_impact` kept/cascade, `detached_interview_sessions` |
| 5 | `20261113000900_r11_interview_score_d14v1` | 점수 `d14.v1`, `backfill_interview_scores`(service_role) |
| 6 | `20261113001000_r11_page_save_client_id` | 저장 RPC `p_client_id` 멱등 키 |
| 7 | `20261113001100_r11_ai_disclosures_v2026_11_05` | AI 고지 `v2026-11-05` 6행(Claude 재동의) |
| 8 | `20261113001200_r11_consent_free_tier_ack_by_disclosure` | 무료 등급 확인을 고지 기준으로 |
| 9 | `20261113001300_r12_ui36_followups` | 정책 2026-11-05판 3행, 기본 제목·인사 문구, 무료 등급 문장 Gemini 무료만 |

## 배포 관계
- R11 코드는 이미 main에 머지되어 운영에 배포됨(#49·#48) → DB가 뒤처진 상태라 먼저 적용해야 함
- R12 DB를 코드(#50)보다 먼저 적용해도 깨지지 않음(함수 본문·insert만, AI-12 라벨 문구 차이만 잠시 생김)
- 새 환경 변수 없음
- 적용 즉시 AI 고지 `v2026-11-05` 시행 → Claude 사용자는 다음 AI 사용 때 재동의

## 실행
- `supabase link --project-ref rxtnguarpotkcgdazkbw` → `supabase db push --dry-run` → `supabase db push`

## 결과
- 2026-11-05 `supabase db push --linked`로 9개 모두 적용(dry-run 목록과 일치)
- `list_migrations`/`schema_migrations`: 마지막 `20261113001300`, 새로 적용 9건
- 데이터 확인: `ai_disclosures` v2026-11-05 6행, `policy_versions` 2026-11-05 3행
- 백필: `backfill_interview_scores(500)` → sessions 0, answers 0 (원격 면접 세션 0건) — 운영 백필 항목 종료
- 보안 advisor: 기존 항목뿐(authenticated SECURITY DEFINER RPC 22건, `account_deletion_logs` 정책 없음 INFO, 유출 비밀번호 보호 꺼짐, MFA 옵션 부족). 이번 반영으로 새로 생긴 항목 없음
- 성능 advisor: INFO만(인덱스 없는 FK 51, 미사용 인덱스 46 — 데이터가 거의 없어 생기는 항목)
- 남은 것: PR #50 머지(R12 코드). Vercel 배포 상태 확인은 머지 뒤

## 2차 반영 (2026-11-05, R12 QA 수정 — 사용자 요청 "올리고 머지")
- `supabase db push --dry-run` → `20261113001400_r12_free_tier_greeting_copy.sql` 1개(비파괴, `private.writing_chat_greeting`·`private.writing_chat_deliverable_greeting` `create or replace`) → `supabase db push --linked` 적용
- 확인: `list_migrations` 마지막 `20261113001400 r12_free_tier_greeting_copy`(로컬과 일치). security advisors — 새 항목 없음(기존 수용 항목: `account_deletion_logs` 정책 없음 INFO, authenticated SECURITY DEFINER 22개, Auth 비밀번호·MFA 경고 — 이번 함수는 private 스키마라 해당 없음)
- 이후 PR #51 머지(운영 배포)
