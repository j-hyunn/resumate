# R13 — 새 설정 다이얼로그 백엔드 후속 (settings-dialog, SD-*) 계획

- 날짜: 2026-11-05
- 기준 문서: PRD v4.14 · UX v5.17 · AI 명세 v4.12 · 데이터 모델 v4.12
- 작업 명세: `docs/planning/04-data-model.md` 11.7 (14개 항목) · 요약 `decisions.md` 4.16 · 배경 3.22
- 성격: 개정 슬라이스. **파괴적 변경 1건**(`profiles` 컬럼 3개 drop) — 반영 순서 필수.

## 범위

| # | 내용 | 담당 |
|---|------|------|
| 1 | `profile_options` 신설 + 시드(PRD 9.7 7종) + RLS + 인덱스 | db |
| 2 | `profiles` 새 컬럼 11개 추가 → `interested_industry` 백필 → (마지막) 컬럼 3개 drop | db |
| 3 | `profile_job_interests` 신설(최대 2쌍, `unique nulls not distinct`) | db |
| 4 | `private.validate_profile_options()` 검증 트리거 | db |
| 5 | RPC `save_profile_basics` (오류 6종) + zod 계약 + 데이터 계층 | db · api |
| 6 | `get_data_readiness`에서 `counts.profile_filled`·`hints` `"profile"` 제거 | db · api |
| 7 | `private.compute_total_experience_months(p_user_id, p_as_of)` (필수 인자) | db · ai |
| 8 | `ai_usage_records` 비용 2컬럼 + 백필 + 인덱스 + `get_ai_usage_summary` `providers[]` 교체 | db · api |
| 9 | 표시 7행 묶음 — **DB·RPC 작업 없음** (화면 상수) | — |
| 10 | `policy_versions.policy_type`에 `ai_data_use` + 행 1건 | db |
| 11 | `evidence_links` insert 트리거 `profile` 거부 + 결과 저장 RPC 허용 출처 6종 → 5종 | db |
| 12 | `app_ai_writer` 내 정보 권한 미부여 + 컨텍스트 팩에서 `profiles` 조회 제거 | db · ai |
| 13 | `prompt_version` 8종 상향 (과거 행 수정 없음) | ai |
| 14 | 개선 요청 — 상수 자리만 (`[결정 필요]` SD-Q1) | api |

### 하지 않는 것
- UI 구현(S-24 탭 4개, S-04 폐기, `/policies/ai_data_use` 페이지) → `resumate-ui`
- 원격(운영) Supabase 반영 — 로컬 적용·검증까지. 순서는 `05_release.md`에 문서로만
- 과거 결과 행의 `prompt_version`·`input_hash` 수정 (#13)
- `evidence_links.source_type` CHECK 목록 변경·기존 `profile` 행 삭제·`source_deleted_at` 백필 (#11)

## 마이그레이션 순서 (db-engineer)

기존 최신 파일 `20261113001400`. 새 파일은 `20261113001500`부터.

| 순서 | 파일 | 파괴성 |
|------|------|--------|
| ① | `…001500_r13_profile_options.sql` — 테이블 + RLS + 인덱스 `(category, sort_order)` + 시드. **라벨 → `snake_case` 코드 매핑 표를 파일 주석으로** | 비파괴 |
| ② | `…001600_r13_profiles_basics_columns.sql` — `job_search_status`·`interested_company_type`·`interested_industry`·`highest_education_{school_name,degree,status,start_month,end_month,major,gpa}` 추가. 길이 CHECK(100/100/20), 1일 고정 CHECK, `end >= start` CHECK. `career_data_updated_at` 트리거 대상 **아님** | 비파괴 |
| ③ | `…001700_r13_profile_job_interests.sql` — PK `(user_id, sort_order)`, `CHECK (sort_order between 1 and 2)`, **`unique nulls not distinct (user_id, job_family, job_role)`**, FK cascade, RLS 본인 4종 | 비파괴 |
| ④ | `…001800_r13_validate_profile_options.sql` — `private.validate_profile_options()` + `profiles`·`profile_job_interests` BEFORE insert/update 트리거. `is_active = false`는 **새로 고를 때만** 거부(기존 값 재저장 통과) | 비파괴 |
| ⑤ | `…001900_r13_interested_industry_backfill.sql` — 배열 원소 정확히 1개 + `industry` 라벨 글자 그대로 일치만. 건수 `raise notice` | 비파괴(읽기) |
| ⑥ | `…002000_r13_compute_total_experience_months.sql` — `private.compute_total_experience_months(p_user_id uuid, p_as_of date)` → `(total_months int, open_ended_experience_count int, as_of_month date)`. **기본값 없음**, stable, security definer, `app_ai_writer`·`authenticated` execute. 규칙은 AI C-1 / DM 6.2 | 비파괴 |
| ⑦ | `…002100_r13_save_profile_basics.sql` — RPC(security invoker). 오류 6종 | 비파괴 |
| ⑧ | `…002200_r13_get_data_readiness_profile_removed.sql` — RPC 교체. `counts.profile_filled` 키 삭제, `hints`의 `"profile"` 삭제, `data_sufficiency` `thin` 정의에서 "프로필 또는" 삭제 | 비파괴(응답 키 삭제) |
| ⑨ | `…002300_r13_ai_usage_cost_columns.sql` — `input_cost_usd`·`output_cost_usd` numeric(12,6) not null default 0, 인덱스 `(user_id, period_month, provider, feature)`, 과거 행 백필(가격표 재계산, `unpriced`면 0, 합계 어긋나도 `estimated_cost_usd` 미수정) | 비파괴 |
| ⑩ | `…002400_r13_get_ai_usage_summary_providers.sql` — RPC 교체: `providers[]` 교차 집계. 최상위 `by_feature`·`by_provider` 삭제, `totals` 유지, `include_previous` 유지 | 비파괴(응답 교체) |
| ⑪ | `…002500_r13_policy_versions_ai_data_use.sql` — `policy_type` CHECK에 `ai_data_use` + 행 1건(`document_path = '/policies/ai_data_use/{version}'`, `requires_reconsent = false`). `consents.consent_type`은 **건드리지 않음** | 비파괴 |
| ⑫ | `…002600_r13_evidence_profile_source.sql` — insert 트리거에 `source_type = 'profile'` → `invalid_evidence_source` + **결과 저장 RPC 전부**(인사이트·경력기술서·직무 면접 질문·평가·종합·자소서 문항)의 커리어 허용 출처 5종으로 | 비파괴 |
| ⑬ | `…002700_r13_ai_writer_profile_grants.sql` — `app_ai_writer`에 내 정보 컬럼·`profile_job_interests`·`profile_options` select 미부여(기존에 `profiles` 전체 select가 있으면 컬럼 단위로 조정). AI 실행 경로가 읽는 것은 `active_ai_provider`·`career_data_updated_at`뿐 | 비파괴 |
| ⑭ | `…002800_r13_drop_profile_legacy_columns.sql` — **`-- DESTRUCTIVE:`** `drop column total_years_of_experience, desired_job_title, interested_industries` | **파괴적 ★** |

- `database.types.ts` 재생성 **2회**: ②~⑬ 적용 뒤, ⑭ 적용 뒤.
- ⑭는 **⑧(readiness)·⑬(권한)·컨텍스트 팩 코드 제거가 배포된 뒤에만** 원격에 올린다 (DM 11.7 "원격 반영 순서 주의"). 로컬에서는 같은 `db reset`에 포함해도 된다.

## 계약 스케치

### `save_profile_basics(p_values jsonb, p_job_interests jsonb, p_expected_updated_at timestamptz)`
- security invoker, 한 트랜잭션: `profiles` update + `profile_job_interests` delete → insert(`sort_order` 1..n)
- 응답 `{ updated_at }`
- 오류: `stale_write`(409) · `invalid_profile_option`(400) · `field_too_long`(400) · `invalid_period`(400) · `too_many_job_interests`(400, 3쌍 이상) · `duplicate_job_interest`(400, null 직무끼리도 중복, 23505도 같은 코드로 변환)
- `p_values` 키 = 내 정보 컬럼명 그대로(`display_name` 포함), 없는 키는 변경하지 않음 vs 전체 덮어쓰기 → **섹션 전체 덮어쓰기**(키가 없으면 null로 비움)로 간다 `[가정]`. UX는 섹션 단위 저장이고 화면이 섹션 전체를 보낸다.

### `get_ai_usage_summary` 응답
DM 2.9.5 JSON 그대로. `providers[]` 정렬 `ai_providers.display_order`, 기록 있는 공급자만. `providers[].by_feature` = 저장 `feature` 값 그대로(묶음 없음).

### 비용 분할 (AI C-13, R-SD-5)
- `input_cost_usd` = 비캐시 입력 × 입력 단가 + 캐시 읽기 × 캐시 읽기 단가 + **캐시 쓰기 × 캐시 쓰기 단가**
- `output_cost_usd` = `output_tokens` × 출력 단가 (`reasoning_tokens`는 이미 포함, 다시 더하지 않음)
- `estimated_cost_usd` = 두 값의 합. **세 값 모두 numeric(12,6)에서 반올림하고 합을 다시 반올림하지 않는다**
- 장문 구간 판정은 호출 단위(캐시 포함 전체 입력 토큰) → 걸리면 **네 단가를 함께** 장문 단가로
- `unpriced` → 세 값 모두 0

### 프롬프트 버전 (AI v4.12 0.v412)
`common.v1 → common.v2` · `ai-02.match.v2 → v3` · `ai-02.synthesize.v2 → v3` · AI-03 생성 +1 · AI-04 생성 +1 · AI-05 +1 · `ai-12.reply.v6 → v7` · `ai-13.reply.v2 → v3`.
올리지 않음: `ai-01.extract`, `ai-12.extract`, `ai-13.extract`, `ai-13.compose`, AI-06·07·08·11 (단, `common.v2` 접미사로 저장 문자열은 전부 바뀐다).

## 읽는 코드 제거 대상 (#2 ③, #12)

`total_years_of_experience` / `desired_job_title` / `interested_industries`:
- `src/server/ai/context-pack/{career-pack,summary-pack,writing-chat,deliverable-chat,interview,career-rows}.ts` (+ 각 테스트, `__fixtures__/career-rows.ts`)
- `src/server/ai/evidence-rules.ts` · `src/server/ai/prompts/common.ts` · `src/server/ai/prompts/AI-02/index.ts`
- `src/server/actions/profile.ts` · `src/server/services/profile/index.ts`(+테스트)
- `src/lib/data/{career,evidence,readiness}.ts`

`profile_filled`:
- `src/lib/contracts/career.ts`(+테스트) · `src/lib/data/readiness.ts`(+`readiness-v44.test.ts`) · `src/types/db.ts` · `supabase/tests/get_data_readiness.test.sql`

UI 소유 파일(`src/components/career/profile-form.tsx`, `src/lib/mock/fixtures.ts`)은 **응답 키·컬럼이 사라져 타입이 깨지는 범위에서만** 최소 수정하고 "UI 요청"으로 남긴다 (S-04 폐기·S-24 재구현은 `resumate-ui`).

## pgTAP

| 대상 | 단정 |
|------|------|
| `profile_options` | PK·CHECK 카테고리 7종, 시드 건수(7/9/11/8/52/8/6), RLS select 인증, 쓰기 거부 |
| `profile_job_interests` | 3번째 쌍 거부, 같은 직군 + 직무 null 두 행 거부, 타 사용자 격리 |
| 검증 트리거 | 없는 코드 / 다른 카테고리 코드 / 직군과 안 맞는 직무 / `is_active=false` 신규 거부 · 기존 값 재저장 통과 |
| `save_profile_basics` | 오류 6종 각각, 쌍 전체 덮어쓰기, `updated_at` 반환 |
| `compute_total_experience_months` | 양 끝 포함, 겹치는 두 경력, 재직 중, 종료월 미입력(제외 + 건수), `draft` 제외, 타 사용자 격리, 팩 조립과 같은 `complete` 정의 |
| `get_data_readiness` | `profile_filled` 키 없음, `hints`에 `profile` 없음, `thin` 정의 |
| `get_ai_usage_summary` | 두 공급자·두 등급 섞인 달, 기록 없는 공급자 제외, `include_previous`, 비용 2열 합 |
| `evidence_links` | 기존 `profile` 행 select·update 생존, 새 insert 거부, 저장 RPC가 `profile` 출처 거부 |
| `policy_versions` | `ai_data_use` 행 1건, 동의 게이트 불변 |
| grants | `app_ai_writer`가 내 정보 컬럼·`profile_job_interests`·`profile_options` select 불가 |

## 릴리스 영향

- **파괴적 1건**: ⑭ 컬럼 drop (값 복구 불가). 원격은 ⑧·⑬ + 코드 배포 뒤에만.
- 새 환경 변수: `NEXT_PUBLIC_FEEDBACK_FORM_URL` (#14, SD-Q1 미정 → 빈 값이면 화면 "준비 중") `[가정]`
- `get_data_readiness`·`get_ai_usage_summary` 응답 키가 바뀌므로 **타입 재생성 + 참조 제거 + 화면을 같은 배포로** 묶는다.
- UI 재구현 없이 배포하면 S-24 내 정보/S-42 사용량 화면이 빈 값을 보인다(기존 화면이 읽던 키가 사라짐) — 사용자에게 보고.
