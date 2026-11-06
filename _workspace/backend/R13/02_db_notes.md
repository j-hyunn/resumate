# R13 DB 구현 노트 — 새 설정 다이얼로그 (settings-dialog, SD-*)

- 날짜: 2026-11-05
- 기준: DM v4.12 11.7(①~⑭) · 2.1.1·2.1.2·2.1.3·2.1.5·2.8·2.9.2·2.9.5·5장·6장+6-A·6.2·7장 · PRD v4.14 9.7 · AI v4.12 C-1·C-13
- 로컬만 적용했다. **원격(운영) 쓰기 없음**(`db push`·MCP `apply_migration`·`execute_sql` 쓰기 전부 안 함). 커밋·PR 없음.

## 마이그레이션 파일 (16개, 전부 `supabase/migrations/`)

| 순서 | 파일 | 하는 일 |
|------|------|---------|
| ① | `20261113001500_r13_profile_options.sql` | 참조 테이블 `profile_options`(PK `(category, code)`, `parent_code`, `label`, `sort_order`, `is_active`) + 카테고리 7종 CHECK + 인덱스 `(category, sort_order)` + RLS(select 인증 전체, 쓰기 정책 없음 = 운영자) + **PRD 9.7 시드 101행** + 시드 건수·`job_role` 부모 검증 `do` 블록. **라벨 → `snake_case` 코드 매핑 표 전체가 파일 머리 주석** |
| ② | `…001600_r13_profiles_basics_columns.sql` | `profiles`에 내 정보 10컬럼 추가(`job_search_status`·`interested_company_type`·`interested_industry` + `highest_education_*` 7개). 길이 CHECK 100/100/20, 1일 고정 CHECK 2개, `end >= start` CHECK. `authenticated`에 select·update 컬럼 grant. `career_data_updated_at` 트리거 대상 아님 |
| ③ | `…001700_r13_profile_job_interests.sql` | `profile_job_interests` 신설. PK `(user_id, sort_order)` + `CHECK (sort_order between 1 and 2)` + **`unique nulls not distinct (user_id, job_family, job_role)`** + FK cascade + RLS 본인 select·insert·delete(**update 정책 없음** — 전체 덮어쓰기, DM §5) |
| ④ | `…001800_r13_validate_profile_options.sql` | `private.profile_option_check(category, code, is_new, detail)` + `private.validate_profile_options()` + `profiles`·`profile_job_interests` BEFORE insert/update 트리거. 없는 코드는 **항상** 거부, `is_active = false`는 **새로 고를 때만** 거부(기존 값 재저장 통과), `job_role.parent_code = job_family` 확인 |
| ⑤ | `…001900_r13_interested_industry_backfill.sql` | `interested_industries` 원소 1개 + `industry` 라벨 글자 그대로 일치만 `interested_industry`로. 건수 `raise notice`(매핑/미일치/2개 이상) |
| ⑥ | `…002000_r13_compute_total_experience_months.sql` | `private.compute_total_experience_months(p_user_id uuid, p_as_of date)` → OUT `(total_months int, open_ended_experience_count int, as_of_month date)`. **기본값 없음**, stable, security definer, `authenticated`·`app_ai_writer` execute |
| ⑦ | `…002100_r13_save_profile_basics.sql` | RPC `save_profile_basics`(security invoker). 오류 6종 |
| ⑧ | `…002200_r13_get_data_readiness_profile_removed.sql` | `get_data_readiness` 교체. 가장 최근 정의(`20261109101200`)에서 **딱 3가지만** — `counts.profile_filled` 키 삭제, `hints`의 `"profile"` 삭제, `thin`에서 "프로필 또는" 삭제 |
| ⑨ | `…002300_r13_ai_usage_cost_columns.sql` | `ai_usage_records.input_cost_usd`·`output_cost_usd` numeric(12,6) not null default 0 + `>= 0` CHECK + 인덱스 `(user_id, period_month, provider, feature)` + `app_ai_writer` insert 컬럼 grant + **과거 행 백필**. 식은 함수 2개로 뺐다(QA-R13-04): `private.usage_split_cost(version, provider, model, 토큰 4개)` → `(input_cost_usd, output_cost_usd)`, `private.backfill_usage_split_costs()` → `{updated, mismatch, zero}`(마이그레이션이 호출, pgTAP가 같은 함수를 돌려 `cost.ts`와 묶는다. 다시 돌려도 안전) |
| ⑩ | `…002400_r13_get_ai_usage_summary_providers.sql` | `get_ai_usage_summary` 응답 교체 — `providers[]` 교차 집계 |
| ⑪ | `…002500_r13_policy_versions_ai_data_use.sql` | `policy_type` CHECK에 `ai_data_use` + 행 1건. `consents.consent_type` 미변경 |
| ⑫ | `…002600_r13_evidence_profile_source.sql` | `private.evidence_links_check_source()`에 `source_type = 'profile'` → `invalid_evidence_source` 한 줄 + **검증 함수·저장 RPC 5개**의 허용 출처 6종 → 5종 |
| ⑬ | `…002700_r13_ai_writer_profile_grants.sql` | `app_ai_writer`의 `profiles` 컬럼 grant 정리 + `profile_job_interests`·`profile_options` revoke all |
| ⑮ | `…002750_r13_delete_account_profile_job_interests.sql` | **계획표에 없던 추가분** — `private.delete_account_data`가 `profile_job_interests`도 지운다 |
| ⑯ | `…002760_r13_public_compute_total_experience_months.sql` | **추가 요청 R13-AI-3** — `public.compute_total_experience_months(p_as_of date)` 얇은 래퍼 |
| ⑭ | `…002800_r13_drop_profile_legacy_columns.sql` | **`-- DESTRUCTIVE:`** `drop column total_years_of_experience, desired_job_title, interested_industries`. **파일 순서 마지막** |

⑮·⑯은 ⑭보다 앞서도록 `002750`·`002760`을 썼다 — ⑭가 파일 정렬의 마지막이어야 한다는 제약을 지키면서 끼워 넣기 위함.

## 확정한 코드 키 (profile_options)

매핑 표의 **원천은 `supabase/migrations/20261113001500_r13_profile_options.sql`의 머리 주석**이다(라벨 → 코드 7종 전체). 요약:

- `job_search_status`(7): `employed_considering` · `employed_actively_looking` · `employed_not_looking` · `unemployed_job_seeking` · `on_leave_or_break` · `freelancer_seeking_next` · `founder_or_self_employed`
- `company_type`(9): `large_enterprise` · `mid_sized_enterprise` · `small_business` · `startup_seed_series_a` · `startup_series_b_plus` · `foreign_company` · `financial_institution` · `public_sector` · `agency_consulting`
- `industry`(11): `it_software_platform` · `b2b_saas` · `ecommerce_retail` · `finance_insurance_fintech` · `game` · `content_media_entertainment` · `education_edutech` · `healthcare_bio` · `manufacturing_hardware_mobility` · `logistics_distribution` · `advertising_marketing`
- `job_family`(8): `engineering` · `data_ai` · `product_planning` · `design` · `marketing` · `sales_bd` · `operations_cx` · `corporate_support`
- `job_role`(52): 위 8개 직군의 `parent_code` 아래. 예 `engineering` → `backend`·`frontend`·`fullstack`·`mobile`·`devops_infra`·`qa_test`·`security`·`embedded_firmware`
- `degree`(8): `high_school` · `associate` · `bachelor` · `master` · `mba` · `doctorate` · `non_degree_program` · `other`
- `graduation_status`(6): `graduated` · `expected_graduation` · `enrolled` · `on_leave` · `completed_coursework` · `dropped_out`

`sort_order`는 PRD 9.7의 표 순서이고 `job_role`은 **직군 안에서** 1부터 센다. 화면 셀렉트는 `is_active = true`만 보이고, 저장된 값이 비활성이면 그 행도 함께 읽어 라벨을 보인다(DM §2.1.1).

## RPC 시그니처·오류·응답 모양 (api·ai 담당이 읽는 부분)

### `public.save_profile_basics(p_values jsonb, p_job_interests jsonb default null, p_expected_updated_at timestamptz default null) → jsonb`
- security invoker. 한 트랜잭션: `profiles` update + `profile_job_interests` delete → insert(`sort_order` 1..n, 받은 순서).
- 응답: `{ "updated_at": "<timestamptz>" }` (그 저장 뒤의 새 버전. 다음 저장의 `p_expected_updated_at`에 그대로 쓴다)
- `p_values` 키 = `profiles` 컬럼명 그대로: `display_name`, `job_search_status`, `interested_company_type`, `interested_industry`, `highest_education_school_name`, `highest_education_degree`, `highest_education_status`, `highest_education_start_month`, `highest_education_end_month`, `highest_education_major`, `highest_education_gpa`.
  - **섹션 전체 덮어쓰기 `[가정]`**: 키가 없으면 **null로 비운다**. 공백만 있는 문자열도 null.
  - 연월 두 칸은 **`'YYYY-MM'` 문자열**(R5 페이지 저장과 같은 관행, DM-4). 모양이 다르면 `invalid_period`.
  - 내 정보 컬럼이 아닌 키는 무시한다.
- `p_job_interests` = `[{ "job_family": "engineering", "job_role": "backend" }, { "job_family": "data_ai" }]` (최대 2개, `job_role` 생략/`null` 허용)
- 오류(모두 `errcode = 'P0001'`, `message` = 코드, `detail` 관행은 R5 페이지 저장과 같음):

  | message | 언제 | detail |
  |---------|------|--------|
  | `stale_write` | `p_expected_updated_at`이 null이 아니고 `profiles.updated_at`과 다름 | 행의 현재 `updated_at`(ISO 8601 `YYYY-MM-DDTHH:MI:SS.ssssssZ`) |
  | `invalid_profile_option` | 코드가 그 카테고리에 없음 / 비활성 코드를 새로 고름 / `job_role`이 그 `job_family`의 것이 아님 / 쌍에 `job_family`가 없음 | 칸 이름(`job_search_status`·`interested_industry`·`highest_education_degree`·`job_family`·`job_role` 등) 또는 `job_role does not belong to job_family` |
  | `field_too_long` | `display_name` > 50 · 학교명/전공 > 100 · 학점 > 20 | 칸 이름 |
  | `invalid_period` | 연월이 `YYYY-MM`이 아님 / 종료월 < 시작월 | 칸 이름 |
  | `too_many_job_interests` | 쌍 3개 이상(**상한 2쌍**, SD-Q3 (가)) | 받은 쌍 수 |
  | `duplicate_job_interest` | 같은 `(job_family, job_role)`이 두 번(**직무를 비운 쌍끼리도 중복**). insert 전 사전 검사 + 제약 위반 23505도 같은 코드로 변환 | **중복된 쌍의 1-based 위치**(요청 R13-API-4 반영) |
  | `not_authenticated` (`42501`) | `auth.uid()` 없음 | — |
  | `invalid_payload` | `p_values`가 object가 아님 / `p_job_interests`가 array가 아님 | `p_values` 또는 `p_job_interests` |

### `public.compute_total_experience_months(p_as_of date) → table(total_months int, open_ended_experience_count int, as_of_month date)`
- **요청 R13-AI-3으로 추가한 public 얇은 래퍼.** security definer, stable, `p_as_of` **기본값 없음**, `authenticated`·`app_ai_writer` execute. 안에서 `private.current_uid()`(= `auth.uid()`)로 호출자 자신만 계산한다 — 다른 사용자 id를 넘길 자리가 없다.
- 원본 `private.compute_total_experience_months(p_user_id uuid, p_as_of date)`도 그대로 있고(동 execute 권한), `p_user_id <> private.current_uid()`면 `42501 not_authorized`. `p_as_of`가 null이면 `22004`.
- 규칙(AI C-1 / DM 6.2 그대로): `experiences` 중 본인·`status = 'complete'`만 · 월 단위 **합집합**(겹치는 달은 한 번) · 양 끝 포함 · `is_current`면 `p_as_of`의 달까지 · `is_current = false`이고 `end_month is null`이면 **합계에서 빼고** `open_ended_experience_count`에 1 · 교육·프로젝트 기간은 더하지 않는다.
- PostgREST 호출: `rpc('compute_total_experience_months', { p_as_of: 'YYYY-MM-DD' })` → 1행 배열. `career_snapshot_hash`·`input_hash`에는 **넣지 않는다**.

### `public.get_data_readiness()` — 응답에서 **사라진 키**
- `counts.profile_filled` **키 자체가 없다**(값 false가 아니다).
- `features.*.hints`에 `"profile"`이 **절대 들어가지 않는다**("ready여도 붙인다" 규칙도 삭제).
- `features.culture_fit_interview.data_sufficiency`의 `thin` = D-01 미충족 + complete 경력·교육·프로젝트가 하나라도 있음(**프로필은 더 이상 `thin`의 근거가 아니다** — 내 정보만 채운 계정은 `none`).
- 다른 판정(D-01 게이트, `next_action` 순서, `suggested_project_id`, `ai_connection`, `draft_item_ids`)은 **바뀌지 않았다**.

### `public.get_ai_usage_summary(p_period_month date default null, p_include_previous boolean default false) → jsonb`
시그니처·권한 그대로, 응답만 DM 2.9.5 모양으로 교체.
```json
{
  "period_month": "2026-11-01",
  "as_of": "…",
  "totals": { "input_tokens": 0, "cached_input_tokens": 0, "cache_write_tokens": 0, "output_tokens": 0,
              "input_cost_usd": 0, "output_cost_usd": 0, "estimated_cost_usd": 0, "calls": 0, "failed_calls": 0 },
  "providers": [
    { "provider": "gemini",
      "connection_tiers": ["free", "paid"],
      "totals": { …totals와 같은 9개 키… },
      "by_feature": [ { "feature": "insight", …같은 9개 키(feature 포함 10)… } ],
      "price_table_versions": [ { "version": "v2026-10-28", "source_checked_at": "2026-10-28" } ] }
  ],
  "price_table_versions": [ { "version": "v2026-10-28", "source_checked_at": "2026-10-28" } ]
}
```
- 최상위 `by_feature`·`by_provider` **삭제**. `totals`·`include_previous`(`previous_month`) 유지.
- `providers[]` 정렬 = `ai_providers.display_order`(gemini 1 · anthropic 2 · openai 3), **그 달 기록이 있는 공급자만**.
- `providers[].by_feature`는 **저장된 `feature` 값 그대로**, `feature` 오름차순. 화면 7행 묶음(`career_description` + `cover_letter`)은 **RPC가 하지 않는다**(AI C-13.1 상수 = 화면 몫).
- 비용 두 열은 저장 컬럼 합이고 `estimated_cost_usd`도 함께 돌려준다.

### 근거 저장 — 허용 출처 5종
`experience` · `education` · `project` · `project_deliverable` · `skill`. 고친 함수: `private.insight_payload_valid`, `private.interview_result_payload_valid`(답변 평가·세션 종합 공용), `public.save_interview_question`, `public.complete_career_description`, `public.complete_cover_letter_section`. insert 트리거도 같은 기준(`source_type = 'profile'` → `invalid_evidence_source`). CHECK 목록·기존 `profile` 행·`source_deleted_at`은 **건드리지 않았다**.

## RLS·권한 요약 (DM §5 대비)

| 테이블 | select | insert | update | delete |
|--------|--------|--------|--------|--------|
| `profile_options` | `authenticated` 전체(정책 `profile_options_select_all`) | 정책 없음(운영자/마이그레이션) | 없음 | 없음 |
| `profile_job_interests` | 본인 | 본인(RPC가 쓰지만 직접 grant도 둠 `[가정]`, DM §5) | **정책 없음**(전체 덮어쓰기) | 본인 |

### `app_ai_writer` 좁힌 범위 (⑬)
- **좁히기 전**(확인값): `profiles` 컬럼 단위 select = `id`, `career_data_updated_at`, `updated_at`, `desired_job_title`, `interested_industries`, `total_years_of_experience`. (테이블 전체 select는 원래 없었다.)
- **좁힌 뒤**: `id`, `career_data_updated_at`, `updated_at`만. 내 정보 10컬럼·`display_name`은 revoke로 못 박았고(미래의 전체 grant 사고 방지), `profile_job_interests`·`profile_options`는 `revoke all`.
- `active_ai_provider`는 **grant하지 않았다** — AI 실행 게이트는 security definer 함수(`check_ai_run_allowed` 등) 안에서 읽으므로 역할 grant가 필요 없다(현행도 없었다). DM 2.1.5의 "AI가 읽는 것은 `active_ai_provider`·`career_data_updated_at`뿐"은 **읽는 경로** 서술로 읽었다 `[가정]`.
- **그래서 ai 쪽 코드가 고쳐야 하는 것**: `src/server/ai/context-pack/career-rows.ts`가 `app_ai_writer` 클라이언트로 `profiles`에서 `desired_job_title`·`total_years_of_experience`·`interested_industries`·`updated_at`을 select한다(`PROFILE_COLUMNS`, `ProfileRow`). ⑬ 적용 뒤 **권한 오류**, ⑭ 적용 뒤 **컬럼 없음 오류**가 난다 — DM 11.7 #12대로 팩 조립에서 `profiles` 조회를 **없애야** 한다(테스트 `career-rows.test.ts`, `__fixtures__/career-rows.ts`도 함께). 근거 스냅샷용 `profiles.updated_at` 읽기는 권한이 남아 있으나 `profile` 출처 자체가 새로 생기지 않으므로 함께 정리 대상.

## 테스트 (`supabase test db`)

**Files=65, Tests=3048, Result: PASS** (QA 1라운드 수정 뒤 `supabase db reset` → `supabase test db`).

새로 쓴 파일
- `supabase/tests/profile_options.test.sql` (19) — PK·인덱스·RLS·카테고리 7종 CHECK·시드 건수 7/9/11/8/52/8/6·`parent_code` 규칙·코드 키 표본·쓰기 거부·anon 차단·`app_ai_writer` 차단
- `supabase/tests/profile_job_interests.test.sql` (26) — 3번째 쌍 거부, 같은 직군 + 직무 null 두 행 거부(`NULLS NOT DISTINCT` 제약 정의까지 단정), 같은 쌍 두 번 거부, update grant 없음, 검증 트리거 5갈래(없는 코드·다른 카테고리·직군 불일치·profiles 쪽·비활성), 비활성 기존 값 재저장 통과, 타 사용자 격리, `app_ai_writer` 차단
- `supabase/tests/save_profile_basics.test.sql` (30) — 전체 저장, 섹션 전체 덮어쓰기, 쌍 1..n, `{updated_at}`, 오류 6종 각각(+ `duplicate_job_interest`의 `detail` = 위치), 재학 중 종료월 비움 통과, 권한 4건
- `supabase/tests/compute_total_experience_months.test.sql` (19) — 양 끝 포함, 겹치는 두 경력 합집합(17개월), 재직 중이 `p_as_of`에 따라 늘어남, 종료월 미입력 제외 + 건수 1, `draft` 제외(= 팩과 같은 complete 정의), 타 사용자 거부, `p_as_of` null 거부, **기본값 없음**(private·래퍼 둘 다), `app_ai_writer` 경로, 래퍼 권한
- `supabase/tests/r13_settings_dialog.test.sql` (13) — `ai_data_use` 행 1건·`document_path`·CHECK, `consents.consent_type` 불변, 가입 동의 게이트 불변, 검증 함수가 `profile` 출처 거부, 허용 출처 배열에 `profile`이 남은 함수 없음

고친 기존 파일
- `ai_usage_summary.test.sql` 전면 교체(22) — `providers[]` 교차 집계, 한 달에 두 등급, 기록 없는 공급자 제외, 두 공급자·두 비용 열, `include_previous`, 빈 달
- `get_data_readiness.test.sql` — `profile_filled` 키 없음·`hints`에 `profile` 없음·내 정보만 채운 계정은 `none`
- `evidence_links.test.sql` — `profile` 새 insert 거부 + 기존 행 select·update 생존(트리거 끈 상태로 심어 재현) + CHECK에 `profile` 남아 있음. 전역 건수 단정 1건을 `user_id` 조건으로 좁힘
- `grants.test.sql` — `ai_usage_records` insert 컬럼 2개, 실행 허용 목록에 `save_profile_basics`·`compute_total_experience_months`, `app_ai_writer`의 내 정보 컬럼·두 테이블 차단 단정, `plan(44)`
- `profiles.test.sql` · `common_functions.test.sql` — 삭제된 세 컬럼 참조 제거(내 정보 컬럼으로 교체)
- `account_deletion.test.sql` — 사용자 테이블 목록에 `profile_job_interests` + 픽스처 2행
- `policy_versions.test.sql`(10 → 11행) · `r12_ui36_followups.test.sql`(R12의 세 문서만 보도록 `policy_type <> 'ai_data_use'`) · `r1_planning_decisions.test.sql`(`hints`에서 `profile` 제거)

(R13-DB-7 "공유 로컬 스택 오염"은 QA 재실행에서 재현되지 않아 내렸다. `evidence_links.test.sql`에 넣은 `user_id` 조건은 유지했다.)

## 타입 생성
`supabase gen types typescript --local > src/server/db/database.types.ts`를 **최종 상태(⑭·⑯ 포함)로** 재생성했다.

**QA-R13-05 결론: 재생성으로 복구되지 않는다 — 생성기(CLI) 차이다.**
- `ai_provider_keys_public` Row의 10컬럼이 HEAD는 non-null, 지금 재생성은 `| null`이다. 연속 2회 재생성이 **바이트 단위로 동일**해서 흔들림이 아니고, 이 슬라이스의 마이그레이션 중 그 뷰·`ai_provider_keys`를 건드린 것은 없다.
- 뷰 자체는 정상이다: 정의는 `ai_provider_keys`를 그대로 select하고 `reloptions = {security_invoker=true}`다(DM 2.11.1 요구대로).
- 원인은 생성기 버전이다. 리포가 핀한 CLI는 `supabase@^2.121.0`이고 설치본·`pnpm db:types`가 쓰는 것도 **2.121.0**인데, 이 버전은 뷰 컬럼을 nullable로 낸다. HEAD의 non-null은 다른 빌드(CLI v3로 보인다 — 로컬에서 v3 업그레이드 안내가 뜬다)로 생성된 것이다. 이 환경은 네트워크가 막혀 `npx supabase@3.0.0`을 받을 수 없어 재현·대조가 불가능했다.
- 그래서 **핀한 CLI의 출력을 그대로 두었다.** 손으로 그 한 줄만 non-null로 고치면 다음 `pnpm db:types`에서 되돌아가고(생성물 수정 금지), 더 오해를 부른다.
- **api 요청**: `src/types/db.ts`에서 손으로 좁힌 것을 **지우지 말고 그대로 두라**(그 뷰 컬럼은 실제로 null이 될 수 없다 — NOT NULL 컬럼을 그대로 select하는 뷰다). 짧은 주석으로 이유(생성기가 뷰 컬럼을 nullable로 낸다)를 달아 두면 다음 사람이 다시 묻지 않는다. CLI 버전을 팀이 v3로 통일하면 그때 좁힘을 지우면 된다 — 그건 R13 범위 밖이고 `package.json` 핀 변경이라 사용자 결정이 필요하다. 새로 생긴 것: `profile_options`·`profile_job_interests` Row/Insert/Update, `profiles`의 내 정보 10컬럼(옛 3컬럼 사라짐), `ai_usage_records.input_cost_usd`·`output_cost_usd`, Functions `save_profile_basics`(`{ p_values, p_job_interests?, p_expected_updated_at? } → Json`)·`compute_total_experience_months`(`{ p_as_of } → { total_months, open_ended_experience_count, as_of_month }[]`).

## backend-qa 1라운드 수정 (2026-11-05, 6건)

| 이슈 | 고친 것 |
|------|---------|
| **QA-R13-04** [릴리스 전 필수] | ⑨ 백필 SQL을 `src/server/jobs/cost.ts`(정본)와 맞췄다. (a) 캐시 읽기·쓰기 단가가 null이면 **그 구간의 입력 단가**로 대체(장문 캐시 단가 null → 일반 캐시 단가 → 입력 단가). 전엔 `coalesce(…, 0)`이라 캐시 토큰이 공짜가 됐다. (b) 장문은 `threshold`·장문 입력·장문 출력이 **모두 non-null**이고 전체 입력이 threshold를 넘을 때만 — 전엔 threshold만 봐서 장문 단가가 빈 행에서 `round(null)` → not null 컬럼 update 실패(원격 마이그레이션 중단)였다. 반올림 자리도 `cost.ts`와 같게 **마이크로 USD 정수 반올림 후 /1e6**. 식·백필을 함수 2개로 빼서 pgTAP가 실제 UPDATE 경로까지 돌린다 |
| **QA-R13-03** [Major] | `05_release.md` "2단 배포"를 실행 가능한 절차로 교체. `db push`에 "여기까지만" 옵션이 없다는 사실을 명시하고, **권장안**(2단을 별도 커밋·별도 PR로 분리, `20261113002800`은 그때까지 `_workspace/backend/R13/pending/`에 둠)과 **차선**(이미 커밋됐다면 push 직전 작업 폴더에서만 `mv`로 빼고 되돌림, git 이력 불변)을 둘 다 적었다. 두 단계 모두 push 전에 **`supabase migration list --linked`로 pending 목록을 눈으로 확인**하는 줄 + `db push --dry-run` 추가 |
| **QA-R13-06** [Minor] | 같은 문서 확인 항목 4를 바꿨다. "0/0인데 합계 > 0"은 가격표 행이 없어진 과거 행의 **의도된** 모습이라 오류 판정이 될 수 없다 → (a) `price_table_version <> 'unpriced'`이고 토큰이 있는데 0/0인 행을 `(version, provider, model)`별로 세는 쿼리(정상 경로에서 0이어야 함), (b) 합이 어긋나는 행 **건수만 기록**(고치지 않음), + push 로그의 백필 notice 확인 |
| **QA-R13-02** [Minor] | ④ 상하 관계 갈래의 `detail`을 문장 → **`'job_role'`**(다른 갈래와 같은 칸 이름 관행). pgTAP에 `detail` 단정 2건 추가 |
| **QA-R13-07** [Minor] | ⑫ `insight_payload_valid` 주석의 "career + profile + JD" → "career 5종 + JD (v4.12, SD-A19 — profile is gone)" |
| **QA-R13-05** [Minor] | **재생성으로 복구되지 않는다** — 아래 "타입 생성" 참고. 손으로 고치지 않았다 |

새 pgTAP: `supabase/tests/ai_usage_cost_backfill.test.sql` (13) — api-engineer의 골든 표(`02_api_notes.md` §3, TS 쪽 `cost-backfill-parity.test.ts`와 같은 표)를 그대로 베껴 **11 가격 행 × usage 3조합 = 33칸**을 ① 식 함수와 ② 실제 백필 UPDATE 두 경로로 단정. 더해서 규칙 (a)의 자리(`gpt-6-luna` U2 입력 = **0.0019**, `coalesce(…,0)`이면 0.0015), 규칙 (b)(threshold만 있고 장문 단가 null인 가격 행은 **CHECK가 애초에 거부**한다는 것 + 어떤 시드 행도 null 비용을 내지 않음), `unpriced`·가격 행 없음 → 0/0 유지, 합계 어긋나는 행의 `estimated_cost_usd` 불변, 두 번 돌려도 변화 없음.

## 파괴적 마이그레이션
- **`20261113002800_r13_drop_profile_legacy_columns.sql`** — 첫 줄 `-- DESTRUCTIVE: profiles.total_years_of_experience / desired_job_title / interested_industries 값 영구 삭제`. 값 복구 불가.
- **원격 반영 순서(DM 11.7)**: ⑧(`get_data_readiness`)·⑬(권한) + **옛 컬럼을 읽는 코드 제거 배포**가 끝난 뒤에만 ⑭를 올린다. 지금 상태로 ⑭만 먼저 올리면 컨텍스트 팩(`career-rows.ts`)이 깨져 AI 실행이 멈춘다. 로컬 `db reset`에는 포함했다.
- 그 밖 15개 파일은 비파괴(⑤·⑨는 값 채우기만, ⑩·⑧은 응답 키 교체).

## 원격 반영
**미반영.** 읽기 전용 확인도 이번 턴에 하지 않았다. 사용자 확인이 필요한 데이터 손실은 ⑭ 한 건.

## 스펙 차이·가정 (`_workspace/backend/spec-gaps.md` "R13 (db-engineer, 2026-11-05)")
- R13-DB-1 `too_many_job_interests` 기준(DM §7 "4쌍" vs 2.1.2 "최대 2쌍") → **2쌍 초과 거부** `[가정]`
- R13-DB-2 `private` 함수의 public 래퍼(DM 6.2 "공개 RPC 없음"을 "화면용 RPC 없음"으로 읽음) `[가정]`
- R13-DB-3 `ai_data_use`의 `version`·`effective_at`을 `2026-11-05`로 잠정 `[가정]` — 법무 확정 시 **새 행 추가**
- R13-DB-4 `profile_options` 코드 키의 원천 = 시드 마이그레이션 주석
- R13-DB-5 `delete_account`에 `profile_job_interests` 추가(계획표 밖)
- R13-DB-6 `evidence_links.source_field` CHECK에 남는 옛 컬럼 이름(문자열, 의존 없음 — 의도)
- R13-DB-7 **내려감** — QA가 스모크 뒤 재실행에서 재현되지 않았다(`db reset` 없이도 전역 건수 단정 통과). `evidence_links.test.sql`에 넣은 `user_id` 조건은 그대로 두었다(해롭지 않고 더 정확하다)
- R13-DB-8 **ⓐ 백필 식의 정본은 `cost.ts`** (QA-R13-04 리더 판정). SQL이 그 식을 베끼고 pgTAP·Vitest가 같은 골든 표로 둘을 묶는다. 백필·식을 `private` 함수 2개로 둔 것도 그 때문이다(계획표에 없던 모양) `[가정]`
- R13-DB-9 **`database.types.ts`의 뷰 컬럼 nullability가 CLI 버전에 달려 있다** (QA-R13-05). 핀한 2.121.0은 nullable, HEAD는 다른 빌드(v3 추정)로 non-null. 팀이 CLI 버전을 핀대로 통일할지 결정 필요 — 결정 전에는 `src/types/db.ts`의 손 좁힘을 유지해야 한다

## 안 한 것 (범위 밖)
- `src/server/ai/**`·`src/server/actions|services`·`src/lib/**`·`src/types/db.ts`·UI 소유 파일 수정 없음
- `evidence_links.source_type` CHECK 변경·기존 `profile` 행 삭제·`source_deleted_at` 백필 없음
- 과거 결과 행의 `prompt_version`·`input_hash` 수정 없음(#13)
- `ai_price_tables.version` 문자열은 이미 `v{YYYY-MM-DD}`(`v2026-10-28`·`v2026-12-01`·`v2027-01-01`) — 확인만 하고 바꾸지 않음(#8 ⓞ)

## UI 42 런 후속 수정 (리더, 2026-11-06)

- **내려간 쌍 코드 재저장** — `20261113002100`·`20261113001800`을 그대로 고쳤다(원격 미반영 파일). RPC가 delete 전에 기존 코드를 `set_config('resumate.held_job_codes', 'family:x,role:y,...', true)`로 넘기고, 트리거는 INSERT에서 그 코드면 `p_is_new = false`로 본다. pgTAP `save_profile_basics.test.sql` +7. 전체 pgTAP **65 파일 / 3055**.

