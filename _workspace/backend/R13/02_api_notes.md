# R13 — api-engineer 구현 노트 (서버 API·계약·데이터 계층)

- 날짜: 2026-11-05
- 범위: 계획 `_workspace/backend/R13/01_plan.md`의 #5(내 정보 저장) · #6(readiness 축소) · #8(사용량 비용 분할·providers[]) · #10(약관 4종·선택 동의 확인) · #14(개선 요청 상수)
- 검증: `pnpm typecheck` · `pnpm lint` · `pnpm vitest run`(2458 passed) · `backend-integration-qa` 스모크(typecheck/lint/vitest/pgTAP **전부 PASS**)

---

## 1. 내 정보 저장·조회 (#5)

### 새 계약 — `src/lib/contracts/profile.ts` (전면 개정)

| 이름 | 모양 |
|------|------|
| `ProfileBasicsDto` | `{ updatedAt, displayName, jobSearchStatus, interestedCompanyType, interestedIndustry, highestEducation{ schoolName, degree, status, startMonth, endMonth, major, gpa }, jobInterests[{ sortOrder, jobFamily, jobRole }] }` |
| `ProfileOptionDto` | `{ category, code, parentCode, label, sortOrder, isActive }` (`profile_options` 행) |
| `ProfileBasicsViewDto` | `{ profile: ProfileBasicsDto, options: ProfileOptionDto[] }` — S-24 ① 한 번의 조회 |
| `SaveProfileBasicsInput` | `{ values: {…내 정보 전체…}, jobInterests: [{ jobFamily, jobRole }], expectedUpdatedAt }` |
| `SaveProfileBasicsResult` | `{ updatedAt }` |
| 상수 | `MAX_JOB_INTERESTS = 2`, `PROFILE_LIMITS`(이름 50 · 학교명 100 · 전공 100 · 학점 20), `PROFILE_SAVE_ERROR_CODES`(6종) |
| `enums.ts` | `PROFILE_OPTION_CATEGORIES` 7종(`profile_options.category` CHECK 미러) |
| 남긴 레거시 | `ProfileDto`·`UpdateProfileInput`은 **`display_name` 하나**만 (S-04 임시 경로) |

- **섹션 전체 덮어쓰기** `[가정]`: `values`의 모든 키가 필수(nullable)이고, null이면 컬럼을 비운다. 부분 패치 API는 없다(UX가 섹션 단위 저장).
- **연월 형식**: 저장 RPC가 `'YYYY-MM'`만 받으므로(정규식 `^[0-9]{4}-(0[1-9]|1[0-2])$`) 계약·DTO도 `'YYYY-MM'`으로 맞췄고, 조회는 date → `'YYYY-MM'`으로 잘라 돌려준다(커리어 DM-4 관행과 동일). spec-gaps **R13-API-3**.
- 종료 < 시작은 zod에서 먼저 막는다(`invalid_period` 경로를 화면이 두 번 처리하지 않게).

### 서버 (`src/server/services/profile/index.ts`, `src/server/actions/profile.ts`)

- `getProfileBasicsView` = 읽기 **3개**: `profiles`(내 정보 컬럼 + `updated_at`) + `profile_job_interests`(`sort_order` 순) + `profile_options`.
  - 옵션 목록은 `is_active = true` 전체 + **저장된 코드가 내려간 값이면 그 행도 추가로 읽어** 라벨을 보존한다(DM 2.1.1).
- `saveProfileBasics` → RPC `save_profile_basics(p_values, p_job_interests, p_expected_updated_at)`. `p_values`의 키는 **컬럼명 그대로**, `p_job_interests`는 순서 있는 배열(`sort_order`는 RPC가 1..n으로 매긴다).
- 사전 검사(`checkJobInterests`): 3쌍 이상 → `too_many_job_interests`, 목록 안 중복 → `duplicate_job_interest`(**null 직무끼리도 중복**). RPC·PK·`unique nulls not distinct`가 마지막 방어선.
- 액션: `getProfileBasics` / `saveProfileBasics` + 레거시 `getProfile` / `updateProfile`(display_name).

### 오류 매핑 표 (`src/server/db/errors.ts`)

| RPC raise | 응답 `code` | HTTP | `details` | 화면 문구(UX S-24 ①) |
|-----------|-------------|------|-----------|------------------------|
| `stale_write` (detail = 현재 `updated_at`) | `stale_write` | 409 | `{ current_updated_at }` | "다른 곳에서 내 정보가 바뀌었어요…" (기존 메시지 유지) |
| `invalid_profile_option` (detail = 칸 이름) | `invalid_profile_option` | 400 | `{ field, fields }` | "고를 수 없는 값이에요. 다시 골라 주세요." |
| `field_too_long` (detail = 칸 이름) | `field_too_long` | 400 | `{ field, fields }` | 기존 길이 초과 문구 |
| `invalid_period` (detail = 칸 이름) | `invalid_period` | 400 | `{ field, fields }` | "기간을 확인해 주세요…" |
| `too_many_job_interests` | `too_many_job_interests` | 400 | — | "관심 직군·직무는 최대 2개까지 고를 수 있어요." |
| `duplicate_job_interest` (detail = 중복 쌍의 1-based 위치) | `duplicate_job_interest` | 400 | `{ field: "job_interests.{n}", sortOrder: n }` | "이미 고른 직군·직무예요…" |
| 생(raw) `23505` on `profile_job_interests` | `duplicate_job_interest` | 400 | — | 같은 문구 (RPC가 먼저 변환하지만 마지막 그물도 둠) |

- **db 노트 확인 결과**: `20261113002100_r13_save_profile_basics.sql`이 insert 루프를 `exception when unique_violation` 으로 감싸 **23505를 `duplicate_job_interest`로 변환**하고, `check_violation`은 `too_many_job_interests`로 변환한다 — 계약과 일치.
- **`duplicate_job_interest`는 두 경로가 같은 모양을 준다 (QA-R13-01 수정)**: db가 요청(R13-API-4)을 반영해 RPC가 `detail = 중복 쌍의 1-based 위치`("2")를 붙인다. `errors.ts`는 이 코드를 `FIELD_DETAIL_RAISES`에서 빼고 `raiseDetails`에서 숫자를 풀어 **`{ field: "job_interests.{n}", sortOrder: n }`**(= 서비스 사전 검사와 같은 모양)으로 올린다. 숫자가 아니거나 1보다 작으면 `details`를 생략한다. `profile.test.ts`가 두 경로의 모양이 같은지 고정한다.

### 데이터 계층 `src/lib/data/profile.ts` (신설, 계획의 `[가정]` 이름)

- `getProfileBasics()` / `saveProfileBasics(input)` + 화면 보조 `optionsOf(options, category)` · `jobRolesOf(options, jobFamily)`(상하 관계) · `optionLabel(...)` · `MAX_JOB_INTERESTS` 재수출.
- `?state=` 미리보기: mock store에 아직 쌍·코드 표가 없어 `profile`은 이름만 채우고 `options: []`다 → "UI 요청" 참고.

### 삭제될 컬럼 참조 제거

`desired_job_title` · `total_years_of_experience` · `interested_industries`를 다음에서 전부 제거했다.

- `src/server/actions/profile.ts`, `src/server/services/profile/index.ts`(+`profile.test.ts` 재작성)
- `src/lib/data/career.ts` `updateProfile` 패치 타입 → `Partial<Pick<Profile, "display_name">>`
- `src/lib/data/evidence.ts` — `source_type = 'profile'` 칩은 `current_value: null`, `href: null`, `to_career: false`(원본 이동 비활성, SD-A19) `[가정]`
- `src/server/services/writing-chat/pipelines.ts` — 턴 팩 조립에서 **`profiles` 조회 자체를 삭제**(SD-6, DM 2.1.5). `Loaded`·`DeliverableLoaded`에서 `desiredJobTitle` 제거
- 테스트: `src/lib/contracts/s1-contracts.test.ts`, `src/lib/data/career.integration.test.ts`, `src/server/services/consent/consent.integration.test.ts`, `src/server/db/ai-writer.integration.test.ts`, `src/server/services/account/__fixtures__/all-slices.sql`(+`profile_job_interests` 픽스처 행 1건 — 탈퇴 범위 테스트가 모든 `user_id` 테이블에 행을 요구한다)

---

## 2. readiness 응답 축소 (#6)

- `counts.profile_filled` **키 삭제**, `features.*.hints`에서 `"profile"` **값 삭제**(false가 되는 게 아니다).
- 고친 곳: `src/lib/contracts/enums.ts`(`READINESS_HINTS`) · `src/lib/contracts/career.ts`(+`career.test.ts`에 "키 없음·`profile` 힌트 거부" 단정 추가) · `src/lib/data/readiness.ts`(mock 계산의 `profileFilled` 삭제, `toLegacyReadiness`에서 키 삭제) · `src/lib/data/readiness-v44.test.ts` · `src/types/db.ts`(`ReadinessHint`에서 `profile` 삭제, `DataReadiness.counts`에서 `profile_filled` 삭제).
- `data_sufficiency` `thin` = **complete 경력·교육·프로젝트가 하나라도 있음**("프로필 또는" 삭제, SD-6).
- 화면(`data-gate.tsx`)은 `project_star` / `project_fields`만 읽어 영향 없음.

---

## 3. 사용량 (#8)

### 비용 분할 구현과 반올림 — `src/server/jobs/cost.ts`

```
estimateCost(usage, price) → { inputCostUsd, outputCostUsd, estimatedCostUsd }
```

- `input_cost_usd` = 비캐시 × 입력 + 캐시 읽기 × 캐시 읽기 + **캐시 쓰기 × 캐시 쓰기**(캐시 쓰기는 입력 쪽)
- `output_cost_usd` = `output_tokens` × 출력. `reasoning_tokens`는 `output_tokens`에 포함이므로 **다시 더하지 않는다**(테스트로 고정)
- **반올림**: 두 쪽을 각각 **마이크로 USD 정수로 반올림**하고, 합계는 **두 정수의 합 / 1e6**이다. 즉 세 값 모두 numeric(12,6) 자리수이고 합계를 다시 반올림하지 않으면서, `0.035 + 0.02 = 0.05500000000000001` 같은 부동소수 오차가 **생기지 않는다**(화면 두 열 + 합계 열이 어긋나지 않는다).
- **장문 구간**: 판정은 호출 단위(캐시 포함 전체 입력 토큰). 걸리면 입력·캐시 읽기·캐시 쓰기·출력 **네 단가를 함께** 장문 단가로 바꾼다(한쪽만 바뀌는 경로 없음). 장문 캐시 단가가 null이면 일반 캐시 단가, 캐시 단가가 아예 없으면 그 구간의 입력 단가로 내려간다(기존 `[가정]` 유지).
- 가격표에 없는 모델 → `UNPRICED_COST`(**세 값 모두 0**) + `price_table_version = 'unpriced'`.
- `estimateCostUsd(usage, price)`는 합계만 주는 얇은 래퍼로 남겼다.

### 백필 SQL과의 동일성 — 골든 표 (QA-R13-04, 리더 판정: `cost.ts`가 정본)

백필 SQL(`20261113002300`)이 베껴 가야 하는 두 규칙을 `cost.ts` 주석에 못 박았다.

- **(a) 단가 null 대체**: 장문 캐시 읽기/쓰기 단가가 null → **일반 캐시 단가**, 캐시 단가 자체가 null → **그 구간(일반·장문)의 입력 단가**. **0으로 취급하지 않는다**(과소 추정 금지, S3a).
- **(b) 장문 판정**: `long_context_threshold_tokens`가 있고 **장문 입력·출력 단가가 둘 다 non-null**일 때만 장문. threshold만 보면 장문 단가 null 행에서 `round(NULL)` → not null 컬럼 update 실패.

로컬 `ai_usage_records`가 0행이어서 백필은 **원격에서 처음 돈다**. 그래서 기대값을 Vitest 골든 표로 고정했다: `src/server/jobs/cost-backfill-parity.test.ts` (37 tests). db가 같은 표로 pgTAP를 쓸 수 있다.

**대표 usage 3조합** (`reasoning_tokens` 없음, `usage_source = provider_reported`)

| 이름 | input | cached | cache_write | output | 전체 입력 |
|------|-------|--------|-------------|--------|-----------|
| U1 | 10,000 | 0 | 0 | 2,000 | 10,000 |
| U2 | 10,000 | 50,000 | 4,000 | 2,000 | 64,000 |
| U3 | 300,000 | 20,000 | 5,000 | 10,000 | 325,000 (OpenAI 272K·Haiku 100K 초과 → 장문) |

**기대값 (USD, numeric(12,6))** — `input_cost_usd` / `output_cost_usd` / `estimated_cost_usd`

| 공급자/모델 | 가격표 | U1 | U2 | U3 |
|-------------|--------|----|----|----|
| openai/gpt-6-luna | v2026-10-28 | 0.001 / 0.001 / 0.002 | 0.0019 / 0.001 / 0.0029 | **0.0614 / 0.0075 / 0.0689** (장문) |
| openai/gpt-6.1-terra | v2026-10-28 | 0.01 / 0.01 / 0.02 | 0.0165 / 0.01 / 0.0265 | **0.612 / 0.075 / 0.687** (장문) |
| openai/gpt-6.1-sol | v2026-10-28 | 0.02 / 0.02 / 0.04 | 0.033 / 0.02 / 0.053 | **1.224 / 0.15 / 1.374** (장문) |
| gemini/gemini-3.5-flash-lite | v2026-10-28 | 0.003 / 0.005 / 0.008 | 0.0057 / 0.005 / 0.0107 | 0.0921 / 0.025 / 0.1171 |
| gemini/gemini-3.8-flash | v2026-10-28 | 0.0075 / 0.0075 / 0.015 | 0.01425 / 0.0075 / 0.02175 | 0.23025 / 0.0375 / 0.26775 |
| gemini/gemini-4-argon | v2026-10-28 | 0.02 / 0.02 / 0.04 | 0.033 / 0.02 / 0.053 | 0.612 / 0.1 / 0.712 |
| anthropic/claude-haiku-5-5 | v2026-10-28 | 0.001 / 0.001 / 0.002 | 0.002 / 0.001 / 0.003 | **0.154125 / 0.025 / 0.179125** (장문) |
| anthropic/claude-sonnet-5-5 | v2026-10-28 | 0.02 / 0.02 / 0.04 | 0.035 / 0.02 / 0.055 | 0.6145 / 0.1 / 0.7145 |
| anthropic/claude-opus-5-5 | v2026-10-28 | 0.04 / 0.04 / 0.08 | 0.07 / 0.04 / 0.11 | 1.229 / 0.2 / 1.429 |
| gemini/gemini-4-argon | v2026-12-01 | 0.04 / 0.04 / 0.08 | 0.066 / 0.04 / 0.106 | 1.224 / 0.2 / 1.424 |
| gemini/gemini-3.8-flash | v2027-01-01 | 0.015 / 0.015 / 0.03 | 0.0285 / 0.015 / 0.0435 | 0.4605 / 0.075 / 0.5355 |

- 나머지 시드 행(27행 중 위에 없는 16행)은 같은 모델의 `v2026-10-28` 값과 **단가가 같아** 기대값이 동일하다(예정 변경은 `gemini-4-argon`·`gemini-3.8-flash` 두 행뿐).
- 규칙 (a)가 드러나는 칸: OpenAI·Gemini의 U2·U3 — 캐시 쓰기 단가가 null이라 **그 구간의 입력 단가**로 계산된다(예 luna U2 입력 = 10,000×0.10 + 50,000×0.01 + 4,000×**0.10** = 0.0019. `coalesce(...,0)`이면 0.0015가 되어 갈라진다).
- 규칙 (b)가 드러나는 칸: threshold가 있고 장문 단가가 null인 행은 시드에 없지만 테스트가 합성 행으로 고정했다(일반 단가와 같은 값, null 전파 없음).

### 기록 경로

- `src/server/jobs/types.ts` `UsageRecordRow`에 `inputCostUsd`·`outputCostUsd` 추가(합계도 유지).
- `src/server/jobs/usage-recorder.ts`: `...(price ? estimateCost(...) : UNPRICED_COST)` — 세 값을 **함께** 만든다.
- `src/server/jobs/supabase-usage.ts`: insert에 `input_cost_usd`·`output_cost_usd`·`estimated_cost_usd` 세 열을 함께 넣는다.
- 테스트(`support.test.ts`): 분할·사고 토큰 중복 금지·장문 네 단가·unpriced 세 값 0·반올림 규칙 + insert 행에 세 열이 들어가는지.

### 조회 계약 교체 — `providers[]`

- `src/lib/contracts/ai.ts` `AiUsageSummarySchema`: 최상위 `byFeature`·`byProvider` **삭제**, `providers[{ provider, connectionTiers[], totals, byFeature[], priceTableVersions[] }]` 신설. 버킷 수치 = `inputTokens`·`cachedInputTokens`·`cacheWriteTokens`·`outputTokens`·**`inputCostUsd`·`outputCostUsd`**·`estimatedCostUsd`·`calls`·`failedCalls`. `totals`·`include_previous`는 유지.
- `src/server/services/usage/index.ts` `toAiUsageSummary`: DM 2.9.5 JSON → camelCase. **7행 묶음을 하지 않는다**(저장 `feature` 8값 그대로).
- 데이터 계층 `src/lib/data/ai-usage.ts`
  - `getAiUsageSummaryV412(periodMonth?, includePrevious?)` — **새 응답 모양 그대로**(S-42 재구현이 쓸 함수). 미리보기용 `computeUsageSummaryV412(db, …)`도 함께.
  - `USAGE_FEATURE_DISPLAY_GROUPS` — **표시 7행 묶음 상수**(AI C-13.1): `writing_chat` / `jd_extraction` / `insight` / `career_description + cover_letter` / `interview_questions` / `interview_evaluation` / `key_verification`. **데이터 계층에 상수만** 두었고 RPC·SQL에는 넣지 않았다.
  - 기존 `getAiUsageSummary()`는 시그니처·화면 타입을 유지하고 새 응답에서 레거시 모양을 만든다(`by_feature`는 공급자를 가로질러 합산, `by_provider`는 공급자당 한 행 + 등급은 그 달 첫 등급) — S-42가 새 함수로 옮기면 어댑터와 화면 타입을 함께 지운다. `@deprecated` 표시.

---

## 4. 약관 (#10)

- `POLICY_TYPES`(contracts `enums.ts`)와 `src/types/db.ts` `PolicyType`에 **`ai_data_use`** 추가(`policy_versions.policy_type` CHECK 미러). **`consents.consent_type`은 건드리지 않았다**(DM 2.1.3).
- `src/lib/data/consent-items.ts`: `POLICY_TYPE_LABELS`에 "AI 데이터 처리" 추가 + **`POLICY_DOCUMENT_TYPES`(4종, 약관 탭이 읽는 목록)** 신설. 기존 `POLICY_TYPES`(S-30에 이미 구현된 3종)는 그대로 둬서 빈 문서 페이지가 내비게이션에 노출되지 않게 했다.
- `src/lib/data/account.ts` `getPolicyVersions()`가 **4종**을 돌려준다. 미리보기에서는 mock에 `ai_data_use` 행이 없으면 privacy 행의 버전·시행일을 빌려 같은 모양을 만든다 `[가정]`.
- **선택 동의 토글 2개는 이미 DM 2.1.4대로 있다**(새로 만들 것 없음): 읽기 `get_consent_status` → `setOptionalConsent(type, true)` = `record_consents` **새 행 insert**(정책 버전 = 그 시점 `privacy`), `false` = `withdraw_consent` → `withdrawn_at` update. 껐다 켜면 행이 쌓인다(의도). 가입 게이트(`terms`·`privacy_required`)는 변화 없음 — 새 `policy_type`이 게이트 판정에 들어가지 않는 것을 `record_consents`·`get_consent_status`에서 확인했다.

---

## 5. 개선 요청 (#14)

- `.env.example`에 `NEXT_PUBLIC_FEEDBACK_FORM_URL=`(빈 값), `src/server/env.ts` `PublicEnvSchema`에 선택 값(`z.url().optional()`).
- `src/lib/contracts/feedback.ts`(클라이언트 안전): `FEEDBACK_FORM_URL`(미정이면 null) · `IS_FEEDBACK_FORM_READY`. 비어 있으면 화면이 "준비 중"으로 읽는다. 주소는 `[결정 필요]` SD-Q1.

---

## 6. 새 환경 변수

| 키 | 값 | 비고 |
|----|----|------|
| `NEXT_PUBLIC_FEEDBACK_FORM_URL` | **빈 값**(주소 미정) | 공개 값·비밀 아님. 비어 있으면 개선 요청 탭이 "준비 중". 주소가 정해지면 Vercel(production·preview)에 설정 |

---

## 7. UI 소유 파일 수정 (타입이 깨져 최소 수정한 것만)

| 파일 | 수정 |
|------|------|
| `src/components/career/profile-form.tsx` | 삭제된 3컬럼 입력(희망 직무·총 경력·관심 산업) 제거 → **이름 한 칸**만. S-04 폐기·리다이렉트는 UI 후속 |
| `src/lib/mock/fixtures.ts` | `profiles` 행에서 3컬럼 삭제 + 새 내 정보 컬럼 10개를 null로; `ai_usage_records` 픽스처에 `input_cost_usd`·`output_cost_usd`(미리보기 값은 합계를 7:3으로 쪼갰다) |
| `src/lib/mock/ai.ts` | mock 사용 기록 insert에 두 비용 열 추가(가격표 단가로 입력·출력 각각) |
| `src/components/account/policy-content.ts` | `POLICY_DOCUMENTS`에 `ai_data_use: []` 한 줄(타입 채우기). 그 문서 본문은 정적 문구가 아니라 `policy_versions` 머리글 + `ai_disclosures` 6행이므로 UI가 구현하면 이 항목은 필요 없어진다 |
| `src/types/db.ts` | (백엔드 소유) `PolicyType` + `ai_data_use`, `ReadinessHint`/`DataReadiness` 축소, `AiProviderKeyPublic`의 뷰 nullable 되돌리기(아래) |

## 8. UI 요청 (resumate-ui)

1. **S-24 ① 계정 탭 "내 정보" 구현** — `src/lib/data/profile.ts`의 `getProfileBasics` / `saveProfileBasics` + `optionsOf` / `jobRolesOf` / `optionLabel` / `MAX_JOB_INTERESTS` 사용. 기대 버전(`expectedUpdatedAt`)은 조회의 `profile.updatedAt`, 저장 응답 `updatedAt`으로 갱신. 오류 6종 문구는 UX S-24 ① 표, `details.field`로 포커스 이동 가능.
2. **S-04 폐기 + `/career/profile` 리다이렉트** — 지금은 이름 한 칸만 남은 상태로 살아 있다.
3. **S-42 재구현** — `getAiUsageSummaryV412()`(공급자 탭 + 공급자 × 기능 교차 표, 비용 열 2개·토큰 보조 표기) + `USAGE_FEATURE_DISPLAY_GROUPS`(7행 묶음). 끝나면 `getAiUsageSummary()`·`src/types/db.ts`의 `AiUsageSummary`(레거시 8행 + `by_provider`)를 지운다.
4. **약관 탭 4문서** — `POLICY_DOCUMENT_TYPES`(4종)로 목록을 만들고 `/policies/ai_data_use` 페이지(= `policy_versions` 머리글 + `ai_disclosures` 6행)를 구현. 구현하면 `POLICY_TYPES`(3종)를 4종으로 올리고 `POLICY_DOCUMENTS`의 빈 항목을 치운다.
5. **개선 요청 탭** — `src/lib/contracts/feedback.ts`의 두 상수로 "준비 중" / 링크 분기.
6. **mock 미리보기 데이터** — `profile_job_interests`·`profile_options` 픽스처와 값 있는 내 정보 행이 없어 `?state=` 미리보기의 내 정보가 비어 있다(`src/lib/data/profile.ts` 미리보기 분기). `policy_versions`에도 `ai_data_use` 행이 없어 privacy 행을 빌린다. 사용 기록 두 비용 열은 임시로 7:3 분할값이다.
7. **근거 칩 `profile`** — 가리키던 컬럼이 사라져 `current_value`·`href`가 null이다(원본 이동 비활성, SD-A19 문구는 UX).

## 9. 내린 `[가정]`

- **섹션 전체 덮어쓰기**: `p_values`에 내 정보 전체를 늘 보낸다(없는 키 = null로 비움). 부분 패치 없음.
- **연월 전송 형식 `'YYYY-MM'`** (RPC·커리어 관행과 일치, DTO도 같은 형식).
- **`duplicate_job_interest`의 `details`**: 두 경로 모두 `{ field: "job_interests.{n}", sortOrder: n }`(1-based). 서비스가 요청 안 중복을 먼저 잡고, RPC·제약은 동시 저장 방어선(RPC raise의 숫자 detail을 같은 모양으로 변환).
- **`invalid_profile_option` / `field_too_long` / `invalid_period`의 `detail` = 칸 이름** → `details.field`(R5 페이지 저장과 같은 관행).
- **레거시 사용량 어댑터**: `by_provider`의 `connection_tier`는 그 달 기록의 **첫 등급**(새 응답은 등급으로 쪼개지 않는다). 레거시 화면이 사라지면 함께 삭제.
- **`evidence_links` `profile` 칩**: 현재 값·원본 링크 없음.
- **미리보기 비용 분할 7:3** (mock 전용, 실제 기록과 무관).

## 10. 남은 타입 오류 / 다른 팀원에게

- **남은 타입 오류 없음**: db-engineer가 `database.types.ts`를 재생성한 뒤 `pnpm typecheck`·`lint`·`vitest`·pgTAP **전부 PASS**. (재생성 전에는 `profile_options`·`profile_job_interests`·`save_profile_basics`·`input_cost_usd`/`output_cost_usd`가 없어 `src/server/services/profile/index.ts`·`src/server/jobs/supabase-usage.ts`에서만 오류가 났고, 재생성으로 모두 풀렸다.)
- **db-engineer에게**
  - 재생성된 타입에서 뷰 `ai_provider_keys_public`의 모든 컬럼이 nullable이 되어 UI(`provider-card`·`key-connect-flow`·`ai-status-line`)가 깨졌다 → `src/types/db.ts`의 `AiProviderKeyPublic`에서 `id`·`provider`·`connection_tier`·`status`·`key_last4`·`created_at`·`updated_at`을 **다시 not null로 좁혔다**(원본 컬럼이 not null). 참고만.
  - `20261113002700`의 grant 정리 뒤 `app_ai_writer`가 `profiles`에서 읽을 수 있는 컬럼은 `id`·`career_data_updated_at`·`updated_at`뿐이다 — DM 2.1.5가 적는 **`active_ai_provider`는 grant 목록에 없다**(게이트는 RPC가 보므로 지금 동작에는 문제 없음). 의도면 DM 문장을, 아니면 grant를 맞추면 좋겠다. 통합 테스트는 현재 grant 기준으로 갱신했다.
  - `duplicate_job_interest` raise의 `detail = 중복 쌍 위치` 요청은 **반영됐다**(`20261113002100`). 앱 쪽 매핑도 같은 모양으로 맞췄다(QA-R13-01).
  - **백필 SQL(⑨)은 `cost.ts`의 두 규칙으로 맞춘다**(리더 판정, QA-R13-04): (a) 캐시 단가 null → 그 구간의 입력 단가(0 아님), (b) 장문은 threshold + 장문 입력·출력 단가 둘 다 non-null일 때만. 기대값은 위 §3 골든 표 / `src/server/jobs/cost-backfill-parity.test.ts`를 pgTAP로 베껴 쓰면 된다.
- **ai-pipeline-engineer에게**: 턴 팩 조립의 `profiles` 조회를 `src/server/services/writing-chat/pipelines.ts`에서 제거하고 `WritingChatTurnInput`·`DeliverableChatTurnInput`의 `desiredJobTitle`을 더 이상 채우지 않는다(두 `Pick` 타입에서 제거).
- **기획 모순**: `_workspace/backend/spec-gaps.md`에 R13-API-1~4로 덧붙였다(쌍 상한 2 vs "4쌍 이상"·"1~3" 잔존, "저장 오류 5종" 머리글, 연월 형식 미명시, 오류 `detail` 규칙).
