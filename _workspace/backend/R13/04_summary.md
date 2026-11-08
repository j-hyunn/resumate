# R13 요약 — 새 설정 다이얼로그 백엔드 후속 (settings-dialog, SD-*)

- 날짜: 2026-11-05 · 기준 PRD v4.14 · UX v5.17 · AI v4.12 · DM v4.12
- 명세: DM 11.7 14개 항목 · 요약 `decisions.md` 4.16 · 배경 3.22
- 상태: **로컬 적용·검증 완료. 원격(운영) 반영 안 함** — 순서는 `05_release.md`

## 무엇을 만들었나

11.7의 14개 항목 **전부 완주**(backend-qa 확인). #9(표시 7행 묶음)·#14(개선 요청)는 명세대로 DB 작업이 없다.

### 마이그레이션 16개 (`supabase/migrations/`)

계획표 ①~⑭ + 끼워 넣은 2건. 전부 원격 마지막 적용분(`20261113001400`) 뒤로 정렬된다.

| 파일 | 내용 |
|------|------|
| `20261113001500_r13_profile_options.sql` | 참조 테이블 + **시드 101행**(PRD 9.7 7종: 7·9·11·8·52·8·6) + RLS + 인덱스. **라벨 → `snake_case` 코드 매핑 표 전체가 파일 머리 주석** |
| `…001600_r13_profiles_basics_columns.sql` | 내 정보 새 컬럼 10개(전부 null 허용, 길이 100/100/20 CHECK, 1일 고정, `end >= start`) |
| `…001700_r13_profile_job_interests.sql` | PK `(user_id, sort_order)` + `CHECK (1..2)` + **`unique nulls not distinct (user_id, job_family, job_role)`** + RLS 본인 |
| `…001800_r13_validate_profile_options.sql` | `private.validate_profile_options()` — 4컬럼 + 쌍의 상하 관계, `is_active=false`는 신규 선택만 거부 |
| `…001900_r13_interested_industry_backfill.sql` | 배열 1원소 + 라벨 글자 그대로 일치만, 건수 notice |
| `…002000_r13_compute_total_experience_months.sql` | `private` 계산 함수, **`p_as_of` 기본값 없음** |
| `…002100_r13_save_profile_basics.sql` | 저장 RPC, 오류 6종 |
| `…002200_r13_get_data_readiness_profile_removed.sql` | `counts.profile_filled` **키 삭제** + `hints` `"profile"` 삭제 + `thin`에서 프로필 제거 |
| `…002300_r13_ai_usage_cost_columns.sql` | 비용 2컬럼 + 인덱스 + 백필(`private.usage_split_cost` / `private.backfill_usage_split_costs`) |
| `…002400_r13_get_ai_usage_summary_providers.sql` | 응답을 `providers[]` 교차 집계로 교체 |
| `…002500_r13_policy_versions_ai_data_use.sql` | `policy_type`에 `ai_data_use` + 행 1건 |
| `…002600_r13_evidence_profile_source.sql` | insert 트리거 `profile` 거부 + 저장 RPC 5곳 허용 출처 5종 |
| `…002700_r13_ai_writer_profile_grants.sql` | `app_ai_writer`의 `profiles` select를 `id`·`career_data_updated_at`·`updated_at`만으로 |
| `…002750_r13_delete_account_profile_job_interests.sql` | 탈퇴 RPC가 새 테이블을 직접 지움 (계획표 밖, R13-DB-5) |
| `…002760_r13_public_compute_total_experience_months.sql` | public 얇은 래퍼 (계획표 밖, R13-AI-3 수용) |
| **`…002800_r13_drop_profile_legacy_columns.sql`** | **파괴적 ★** `-- DESTRUCTIVE:` — 컬럼 3개 drop. **파일 순서 마지막** |

### 서버 코드

- **AI** (`src/server/ai/`): `loadCareerRows`가 `profiles`를 아예 조회하지 않고 `CareerRows.profile`이 없어졌다. 팩 `<profile>` 블록 삭제(빈 블록도 없음), 요약 팩 `PROFILE` 줄, AI-12·13 `<chat>`의 `desired_job_title` 줄, `career_snapshot_hash`의 프로필 항목 삭제. 근거 `source_type` `profile`·별칭 `PROFILE` 폐기 → 코드 쪽 커리어 출처 5종. V-4 예외 2줄 삭제, V-7 범위에서 프로필 제거, `checkEvidence`에 모르는 출처 → V-1 가드. 신규 `context-pack/total-experience.ts`가 public RPC를 KST 오늘로 호출, 팩 머리 줄·"기간 미입력 경력 N건"을 같은 호출에서. V-5 허용값에 년·개월·총 개월 추가. AI-02 판정 규칙 교체.
- **API** (`src/lib/contracts/`, `src/server/{actions,services,jobs}/`, `src/lib/data/`, `src/types/db.ts`): `contracts/profile.ts` 전면 개정(`MAX_JOB_INTERESTS=2`, `PROFILE_LIMITS` 50/100/100/20), `enums.ts`에 `PROFILE_OPTION_CATEGORIES` 7종. 내 정보 조회 3읽기 + 저장 RPC, 신규 `src/lib/data/profile.ts` + 화면 보조(`optionsOf`/`jobRolesOf`/`optionLabel`). 오류 6종 매핑. readiness 응답 키 삭제를 계약·데이터 계층·타입에 반영. `cost.ts`가 `{inputCostUsd, outputCostUsd, estimatedCostUsd}` 반환, 기록 경로가 세 열을 함께 insert. 사용량 조회 `getAiUsageSummaryV412()` 신설(+기존은 `@deprecated` 레거시 어댑터), 7행 묶음은 데이터 계층 상수 `USAGE_FEATURE_DISPLAY_GROUPS`만. `POLICY_DOCUMENT_TYPES` 4종. `contracts/feedback.ts` + `.env.example`.
- **프롬프트 버전**: `common.v2→v3` · `ai-02.match.v4→v5` · `ai-02.synthesize.v4→v5` · `ai-03.generate.v3→v4` · `ai-04.generate.v3→v4` · `ai-04.adjust.v3→v4` · `ai-05.generate.v3→v4` · `ai-06.evaluate.v3→v4` · `ai-12.reply.v6→v7` · `ai-13.reply.v2→v3`. 안 올림: `ai-01.extract` · `ai-07.summarize` · `ai-11.rank` · `ai-12.extract` · `ai-13.extract` · `ai-13.compose`. **과거 결과 행의 `prompt_version`·`input_hash`를 고치는 마이그레이션 없음**(QA 확인).

## 검사 결과 (QA 2라운드, SKIP 없음)

| 검사 | 결과 |
|------|------|
| typecheck · lint | 통과 |
| Vitest | **154 파일 / 2496 tests**, skipped 0 (통합 15개가 실제 로컬 스택에 붙어 돌았다) |
| pgTAP | **65 파일 / 3048 tests**, `db reset` 없이도 통과 |
| 로컬 스모크 | **7/7** (실제 의존 팩토리 — 내 정보 왕복, 실패 4종, 실제 `app_ai_writer`로 팩 조립, 실제 usage store로 비용 2열 insert, grant 42501, `duplicate_job_interest` 두 경로 동일) |
| 생성 타입 freshness | 통과 — `pnpm exec supabase gen types`가 커밋본과 바이트 동일 |

## QA 이슈

1라운드 7건 → **해결 6 · 철회 1**. 2라운드 신규 1건(Minor, 리더가 수정). **Critical 0.**

| ID | 심각도 | 결과 |
|----|--------|------|
| QA-R13-01 | Major | 해결 — `duplicate_job_interest`의 `details`가 RPC 경로와 사전 검사 경로에서 같은 `{ field: "job_interests.{n}", sortOrder: n }` |
| QA-R13-03 | Major | 해결 — `05_release.md` 2단 배포를 실행 가능한 절차로 교체 |
| QA-R13-04 | Minor(릴리스 전 필수) | 해결 — 백필 SQL을 `cost.ts`에 맞췄다. 아래 별항 |
| QA-R13-02 · 06 · 07 | Minor | 해결 |
| QA-R13-05 | Minor | **철회** — QA 1라운드 근거가 틀렸다. 아래 별항 |
| QA-R13-08 | Minor | 리더 수정 — 아래 별항 |

### QA-R13-04 — 이 슬라이스에서 가장 위험했던 자리

⑨ 백필 SQL과 `src/server/jobs/cost.ts`의 비용 식이 갈라져 있었다. (a) 캐시 단가 null일 때 TS는 그 구간의 입력 단가로 대체(과소 추정 금지, S3a 결정)인데 SQL은 0 취급. (b) 장문 판정 조건이 달랐다.

**리더 판정: `cost.ts`가 정본이고 백필 SQL이 베껴 간다** — 같은 가격표 행에서 과거 행과 새 행의 비용이 달라지면 안 된다. SQL을 그쪽에 맞추고, 식·백필을 `private.usage_split_cost` / `private.backfill_usage_split_costs` 두 함수로 빼서 pgTAP가 **실제 UPDATE 경로까지** 같은 함수로 돌게 했다.

**로컬 `ai_usage_records`가 0행이라 이 백필은 원격에서 처음 돈다.** 그래서 두 구현을 골든 표로 묶었다 — 단가가 서로 다른 11행 × 대표 usage 3조합 = 33칸을 Vitest(`cost-backfill-parity.test.ts`)와 pgTAP(`ai_usage_cost_backfill.test.sql`) 양쪽에 리터럴로. QA가 세 방향으로 교차 대조했다: TS ↔ pgTAP 기계 대조 33/33, 명세 본문에서 독립 재구현(정확 10진)으로 33/33, 시드 리터럴 ↔ 라이브 가격표 11행 × 9칸 어긋남 0.

(b)에 대한 정정: 그런 가격 행은 `ai_price_tables_long_context_check`가 애초에 저장을 거부한다(그 CHECK는 R13이 아니라 `20261028000400`부터 있었다). "마이그레이션 중단"은 데이터로 도달 불가였고 지금 조건은 그 위의 방어선이다 — 리더의 1라운드 심각도 판단이 과했다. 실제 갈라짐은 (a) 하나였다.

### QA-R13-05 — 철회

`database.types.ts`의 뷰 컬럼 nullability가 커밋본과 재생성에서 1행 다르다는 지적이었는데, **커밋본이 프로젝트 명령의 충실한 출력**이었다. 원인은 CLI 빌드 차이: 핀한 `supabase@2.121.0`(`pnpm db:types`)은 뷰 컬럼을 `| null`로, 이 기계의 전역 Homebrew `2.122.0`은 non-null로 낸다. QA가 1라운드에 pnpm 밖에서 전역 CLI를 돌려 오판했다. `src/types/db.ts`의 손 좁힘은 사실에도 맞다(뷰가 조인·식 없는 단순 투영이고 기반 7컬럼이 전부 `is_nullable = NO`) — **유지한다**.

### QA-R13-08 — 리더 수정

생성 타입이 어떤 `supabase` 바이너리로 돌렸는지에 따라 1행 갈리는데, 번들 검사 스크립트가 전역 CLI를 먼저 골랐다(QA 오판의 경로). 핀한 CLI를 먼저 고르게 고쳤다:
- `.claude/skills/backend-integration-qa/scripts/run-checks.sh` — `node_modules/.bin/supabase` 우선 + 이유 주석
- `package.json` — `db:reset`·`db:test`·`db:types`를 `pnpm exec supabase`로

CLI 핀을 승급할지(`package.json` 버전 변경)는 R13 범위 밖의 사용자 결정이다(R13-DB-9).

## 릴리스 영향

- **파괴적 1건** — `…002800`이 `profiles.total_years_of_experience`·`desired_job_title`·`interested_industries`의 모든 사용자 값을 지운다(복구 불가). **사용자 확인 필요.** 원격은 ⑧·⑬ + 코드 배포 뒤 2단으로.
- **응답 키가 사라진다** — `get_data_readiness`의 `counts.profile_filled`·`hints` `"profile"`, `get_ai_usage_summary`의 최상위 `by_feature`·`by_provider`. DB와 코드를 같은 배포로 묶어야 한다.
- **새 환경 변수** `NEXT_PUBLIC_FEEDBACK_FORM_URL` — 빈 값 유지 가능(비면 화면 "준비 중"). 주소는 `[결정 필요]` SD-Q1.
- **UI 후속 없이 배포하면** 설정의 내 정보 입력 화면이 옛 세 컬럼 그대로이고(2단 drop 뒤 저장 실패), S-42가 빈 값을 보인다. UI 후속을 1단과 같은 머지에 묶는 것이 안전하다.

## UI 소유 파일 수정 4건 ("Minimal UI edits" 범위 — QA 확인)

`src/components/career/profile-form.tsx`(삭제 3컬럼 입력 제거 → 이름 한 칸) · `src/lib/mock/fixtures.ts`(profiles 3컬럼 제거 + 새 컬럼 null, 사용 기록 비용 2열) · `src/lib/mock/ai.ts`(비용 2열) · `src/components/account/policy-content.ts`(`POLICY_DOCUMENTS`에 `ai_data_use: []` 한 줄).

## UI 요청 7건 (`resumate-ui`)

S-24 ① 내 정보 구현 · S-04 폐기 + `/career/profile` 리다이렉트 · S-42 재구현(`getAiUsageSummaryV412` + 7행 묶음 상수) · 약관 탭 4문서 + `/policies/ai_data_use` 페이지 · 개선 요청 탭 분기 · mock 미리보기 데이터(쌍·코드 표·`ai_data_use` 행) · `profile` 근거 칩의 "원본으로 이동" 비활성.

## 기획 문서 정정 10건 (`resumate-planning`)

리포트 표에 전체. 큰 것:

- **쌍 상한이 네 군데에 틀린 값으로 남아 있다** — 확정은 **2쌍**(SD-Q3 (가))인데 DM 7장 "4쌍 이상" · DM 2.1.2 "최대 3쌍" · DM 변경이력 "CHECK 1..3" · UX "sort_order(1~3)". 구현은 2쌍으로 일관하다.
- **프롬프트 버전 표가 구현 현행값보다 뒤처졌다** — 표의 절대값(`common.v1→v2`)을 그대로 쓰면 프로필 삭제가 버전에 반영되지 않거나 번호가 뒤로 간다. 0.v412 본문의 "현행 `v{n}` → `v{n+1}`" 규칙을 적용했다(QA 타당 판정).
- **AI-06을 "올리지 않음"에 둔 전제가 틀렸다** — 구현 AI-06 system에 A10 프로필 규칙 문장이 실제로 있었다(git diff 확인).
- **DM 6.2 "공개 RPC 없음"** → "화면이 쓰는 RPC 없음"으로. `private` 스키마는 PostgREST에 노출되지 않아 래퍼 없이는 호출 경로가 없다.
- **DM 2.1.5의 `active_ai_provider` grant** — 동작 문제 없음(사용자 세션과 definer 게이트만 읽는다) → "읽는 경로"와 "grant 목록"을 분리해 적을 것.
- 그 외: DM 2.1.2 RLS update 줄 ↔ 5장 "update 없음"(5장이 맞다) · "최종 학력 6칸"인데 열거는 7개 · UX "저장 오류 5종" → 6종 · `ai_data_use` 잠정 버전 확정 · 연월 `'YYYY-MM'` 형식 명시.

## 사용자 몫

1. **⑭ 파괴적 drop 확인** (값 복구 불가)
2. `policy_versions.ai_data_use`의 `version`·`effective_at` 법무 확정 — 확정 뒤에는 **행을 고치지 말고 새 행 추가** (R13-DB-3)
3. SD-Q1 개선 요청 폼 주소
4. CLI 핀 승급 여부 (R13-DB-9 / QA-R13-08)
5. 기획 문서 정정 10건
6. UI 후속 런

## 내린 `[가정]`

`spec-gaps.md`의 R13 항목 19건(AI 5 · API 4 · DB 9 + 내려간 1)에 전부 기록. 핵심:
- `save_profile_basics`의 `p_values`는 **섹션 전체 덮어쓰기**(키가 없으면 null로 비움) — UX가 섹션 단위 저장이고 화면이 섹션 전체를 보낸다
- 연월 전송 형식 `'YYYY-MM'` (커리어 DM-4 관행)
- 백필 식의 정본 = `cost.ts`, 함수 2개 분리 (리더 판정, 계획표 밖)
- public 래퍼 (R13-AI-3 / R13-DB-2)
- `ai_data_use` 잠정 버전 `2026-11-05`
- 폐기 출처를 단 항목은 zod enum에서 먼저 걸려 항목째 버려진다(명세의 "근거만 제거"보다 엄격, R13-AI-5)
- 연차 요건 비교 대상은 `<jd>`의 `seniority` 라벨 줄(입력에 `min_years` 숫자가 없다, R13-AI-4)
