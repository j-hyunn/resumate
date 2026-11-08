# R13 백엔드 QA 리포트 (라운드 2 — 최종)

- 날짜: 2026-11-05 · 슬라이스 R13 (새 설정 다이얼로그, settings-dialog / SD-*)
- 라운드 1 이슈 7건 재확인 + 회귀 + 검사 재실행. **오케스트레이터 규칙상 라운드는 여기까지다.**
- 원격(운영) 쓰기·실제 공급자 호출·커밋·PR **없음**

## Critical 유무

**Critical 없음** (`done`을 막는 것 없음).

라운드 1의 7건 중 **6건 해결**, **1건은 "이슈가 아니었음"으로 철회**(QA-R13-05 — 내 근거가 틀렸다, 아래). 2라운드에서 새로 찾은 것은 **QA-R13-08(Minor) 1건**.

### 남은 열린 이슈

| ID | 심각도 | 담당 | 한 줄 |
|----|--------|------|-------|
| QA-R13-08 | Minor | db-engineer (실행은 사용자 결정) | `database.types.ts`를 만드는 CLI가 호출 방식에 따라 갈린다 — `pnpm db:types`는 핀한 2.121.0, 맨 `supabase`는 전역 2.122.0이고 **두 출력이 1행 다르다**. 번들 검사 스크립트·문서가 전역 CLI를 쓰므로 다음 사람이 그 1행을 다시 뒤집는다. `spec-gaps` R13-DB-9과 같은 뿌리 |

그 밖에 **기획 문서 정정 10건**(아래 표)이 사용자 몫으로 남는다 — 코드 문제가 아니다.

## 검사 실행 결과 (2라운드 재실행)

| 검사 | 결과 | 숫자 / 비고 |
|------|------|-------------|
| typecheck (`pnpm typecheck`) | **통과** | |
| lint (`pnpm lint`) | **통과** | |
| Vitest (`pnpm test`) | **통과** | **Test Files 154 / Tests 2496**, skipped 0 (1라운드 153/2458 → 신규 `cost-backfill-parity.test.ts` 1파일 38건). integration 15개가 로컬 스택에 붙어 실제로 돌았다 |
| pgTAP (`supabase test db`) | **통과** | **Files=65 / Tests=3048** (1라운드 64/3033 → 신규 `ai_usage_cost_backfill.test.sql` 1파일 13건 + QA-R13-02 pgTAP 2건). `db reset` 없이 통과 |
| 로컬 스모크 | **통과 7/7** | 1라운드 5건 + QA-R13-01 재확인 2건. QA가 임시 테스트로 실행 후 삭제(작업 트리·DB 잔여 0 확인) |
| 생성 타입 freshness | **통과** | `pnpm exec supabase gen types --local` 출력이 커밋본과 **바이트 동일** (1라운드 판정 철회 — QA-R13-05) |

db·api가 보고한 숫자(2496 / 3048)와 **일치한다**.

## 1라운드 이슈 재확인

### QA-R13-01 [Major] `duplicate_job_interest`의 `details` — **해결**
- 근거: `src/server/db/errors.ts:293-294`가 `FIELD_DETAIL_RAISES`에서 그 코드를 빼면서 **이유를 주석으로** 남겼고(`invalid_profile_option`만 남았다), `:307-312`에 전용 분기가 생겼다 — `{ field: "job_interests.{n}", sortOrder: n }`. 사전 검사 경로(`src/server/services/profile/index.ts:145`)와 **같은 모양**이다.
- 스모크로 직접 확인(단정을 추가해 돌렸다):
  - RPC를 **직접 호출**해(사전 검사 우회) 중복 쌍 raise를 받고 `mapDbError`에 통과시킨 결과 `details = { field: "job_interests.2", sortOrder: 2 }` — 사전 검사가 던지는 `details`와 `toEqual`로 **동일**
  - `detail`이 `"abc"` · `"0"` · `"-1"` · `"2.5"` · `null`이면 `details`가 **생략**된다(`Number.isInteger` + `< 1` 가드). `"3"`은 `job_interests.3`
  - **다른 코드는 영향 없음**: `invalid_profile_option` → `{field:"job_role",fields:["job_role"]}`, `field_too_long` → `{field:"display_name",…}`, `stale_write` → `{current_updated_at:…}` 그대로. `git diff`로도 `FIELD_DETAIL_RAISES`에서 빠진 것이 `duplicate_job_interest` 하나임을 확인했다(슬라이스 전 5종 + `invalid_profile_option` 추가, 손실 없음)
- 상태: **수정됨(확인 완료)**

### QA-R13-04 [Major로 재평가 → 해결] 비용 분할 식 정본화 — **해결 (이번 라운드 핵심)**
골든 표 33칸을 **세 방향으로** 교차 대조했다. "둘이 서로 베꼈다"가 아니라 **베낀 값 자체가 맞는지**를 독립적으로 확인한 결과다.

1. **TS ↔ pgTAP 기계 대조**: `src/server/jobs/cost-backfill-parity.test.ts`의 `EXPECTED` 33개와 `supabase/tests/ai_usage_cost_backfill.test.sql`의 `t_gold` 33행을 파싱해 키별로 비교 → **33/33 완전 일치, 누락·여분 0**. 요청하신 `gpt-6-luna` U2는 양쪽 모두 `(0.0019, 0.001, 0.0029)` — **입력 0.0019 맞다**(규칙 (a)가 적용된 값. `coalesce(…,0)`이면 0.0015)
2. **독립 재계산**: 두 구현을 쓰지 않고 AI C-13 / R-SD-5 본문에서 식을 직접 구현해(Python, **정확 10진 `Decimal`** — 부동소수 아님) **로컬 DB의 실제 `ai_price_tables` 행**으로 33칸을 다시 계산 → **33/33 골든 표와 일치**. 세 값의 합 관계(`input + output == estimated`)도 33칸 모두 정확히 성립
3. **시드 전제 확인**: TS 테스트가 리터럴로 박은 `SEED` 11행을 라이브 `ai_price_tables`와 전수 비교 → **11행 × 9칸 전부 일치, 어긋남 0**. "값이 다른 11행"이라는 전제도 맞다(v2026-10-28 9행 + `gemini-4-argon` v2026-12-01 + `gemini-3.8-flash` v2027-01-01 = 서로 다른 단가 조합 전부)

**SQL 함수가 `cost.ts`와 규칙 단위로 같아졌다** (`private.usage_split_cost` 본문 대조):
- 장문 판정 = `threshold is not null and lc_input is not null and lc_output is not null and prompt > threshold` — TS와 동일
- 캐시 읽기·쓰기 단가 null → `coalesce(…, v_input)` = **그 구간의 입력 단가** (`, 0`이 사라졌다 — 1라운드 (a) 해소)
- 반올림 위치 = 마이크로 USD 정수 반올림 후 `/1000000` — TS `Math.round(...)/1e6`과 같은 자리. 세 값 모두 비음수이므로 PG `round`(half away from zero)와 JS `Math.round`(half up)가 같은 결과
- `unpriced` / 가격표 행 없음 → 0/0 즉시 반환, 바깥 `coalesce(round(...), 0)`로 **어떤 경로에서도 null이 나오지 않는다**

**함수 2개 분리의 모양도 맞다**:
- 재실행 안전: `where (r.input_cost_usd, r.output_cost_usd) is distinct from (c.input_cost_usd, c.output_cost_usd)` → 2회차는 0행. pgTAP "a second run updates no row"가 고정
- 권한: 두 함수 모두 `proacl = {postgres=X/postgres}` — **소유자 외 EXECUTE 없음**(PUBLIC·anon·authenticated·app_ai_writer 전부 없음), `proconfig = search_path=""`. 마이그레이션 120·160행의 `revoke all`이 실제로 반영됐다
- `estimated_cost_usd`는 **건드리지 않는다**(저장 당시 값 보존) + `mismatch` 건수를 notice로 보고

**규칙 (b)에 대한 db의 주장 — 사실이다. 1라운드 내 심각도 판단이 과했다.**
`ai_price_tables_long_context_check`를 직접 읽었다:
```
CHECK ( (threshold IS NULL AND lc_input IS NULL AND lc_output IS NULL AND lc_cached IS NULL AND lc_cache_write IS NULL)
     OR (threshold > 0 AND lc_input IS NOT NULL AND lc_output IS NOT NULL) )
```
→ "threshold만 있고 장문 입력·출력 단가가 null"인 행은 **애초에 저장될 수 없다**. 이 CHECK는 R13이 아니라 `20261028000400_s3a_ai_price_tables.sql`에 **이미 있었다**(이번에 맞추려고 넣은 것이 아니다). pgTAP의 `throws_ok … '23514'`가 그 거부를 단정한다. 따라서 **1라운드에 내가 적은 "`round(NULL)` → not null 컬럼 update 실패로 마이그레이션 중단" 시나리오는 데이터로 도달 불가였다** — 지금의 3중 조건은 그 CHECK 위에 덧붙인 방어선이다. 실제 갈라짐이었던 것은 (a) 쪽 하나다.

- 잔여 관찰(이슈 아님): TS는 `tokens × 단가`를 float64로 더한 뒤 반올림하고 SQL은 exact numeric이다. 정확 산술에서 합이 딱 `.5` 마이크로 USD에 떨어지는 조합이 생기면 이론상 **6번째 소수 1단위**(0.000001 USD) 차가 날 수 있다. 현 단가·토큰 조합에서는 33칸 전부(정확 10진 재계산 포함) 일치했으므로 지금 문제가 되는 경로는 없다.
- 상태: **수정됨(확인 완료)**

### QA-R13-03 [Major] 2단 배포 실행 가능성 — **해결**
- `05_release.md`가 "`db push`에는 '여기까지만 올리기' 옵션이 없다 — 작업 폴더의 `supabase/migrations/`에 있는 미반영 파일을 전부 올린다"를 명시하고, 권장안(2단을 별도 커밋·별도 PR, 그때까지 `_workspace/backend/R13/pending/`에 보관)과 차선(push 직전 작업 폴더에서만 `mv`, 끝나고 되돌리고 `git status` 확인)을 **그대로 복사해 실행할 명령**으로 적었다.
- **"`_workspace/` 안이면 집히지 않는다"를 확인했다**: `supabase/config.toml`의 `[db.migrations]`는 `enabled = true` · `schema_paths = []`뿐이고 마이그레이션 경로 재지정이 없다(`declarative_schema_path`도 주석 처리). CLI는 `supabase/migrations/`만 읽으므로 `supabase/` **밖**인 `_workspace/backend/R13/pending/`은 `db push`도 `db reset`도 집지 않는다.
- **2단 확인 조건도 맞다**: 1단에서 15개가 원격에 적용되므로, 2단 시점에 `supabase migration list --linked`의 Local 전용 항목은 `20261113002800` **한 개**가 된다. 두 단계 모두 `migration list --linked` + `db push --dry-run`을 앞에 두었고, 1단에는 "2800이 목록에 보이면 멈춘다"는 중단 조건이 있다.
- 플래그도 유효하다(`migration list --linked`, `db push --dry-run`).
- 상태: **수정됨(확인 완료)**

### QA-R13-05 [철회 — 이슈가 아니었다. 1라운드 내 근거가 틀렸다]
db의 "생성기 차이" 결론이 **맞다.** 원인까지 특정했다:

| 호출 방식 | CLI 버전 | 뷰 `ai_provider_keys_public` Row |
|-----------|----------|----------------------------------|
| `pnpm db:types` / `pnpm exec supabase` (= `node_modules/.bin`, `package.json`의 `supabase: ^2.121.0`) | **2.121.0** | `\| null` — **커밋본과 바이트 동일** |
| 맨 `supabase` (Homebrew 전역) | **2.122.0** | non-null |

- `pnpm exec supabase gen types typescript --local`의 출력을 커밋본과 `diff` → **차이 없음**. 즉 `database.types.ts`는 **프로젝트가 정한 명령의 충실한 출력이고 손으로 고친 것이 아니다.**
- 1라운드에 내가 "재생성과 1행 다르다"고 적은 것은 **pnpm 밖에서 맨 `supabase`(전역 2.122.0)를 돌렸기 때문**이다. db가 "네트워크가 막혀 v3 대조 불가"로 남긴 미지의 빌드는 추정과 달리 v3가 아니라 **이 기계에 깔린 2.122.0**이다(재현했다).
- **런타임 위험이 아니라 생성물 메타 문제로 분류하는 것이 맞다**. 그리고 `src/types/db.ts`의 손 좁힘은 **유지돼 있고(`:1109-1117`) 사실에도 맞다**:
  - 뷰 정의가 `SELECT id, provider, … FROM ai_provider_keys` — 조인·식 없는 단순 투영이라 행이 존재하면 null이 될 수 없다
  - 기반 7컬럼(`id`·`provider`·`connection_tier`·`status`·`key_last4`·`created_at`·`updated_at`)이 `information_schema`에서 전부 `is_nullable = NO`
  → 좁힘은 올바른 보정이다. **지우지 말라는 db의 요청이 맞다.**
- 상태: **철회(이슈 아님)**. 남은 뿌리는 QA-R13-08로 옮겼다.

### QA-R13-02 [Minor] `invalid_profile_option`의 `detail` — **해결**
- `private.validate_profile_options()`의 상하 관계 갈래가 `detail = 'job_role'`로 바뀌었고(사유는 주석), 두 `job_role` 갈래가 같은 관행을 쓴다. 문장형 detail은 사라졌다.
- 스모크 2(직군과 맞지 않는 직무)가 `invalid_profile_option`으로 올라오는 것을 재확인했고, `mapDbError`가 `{ field: "job_role", fields: ["job_role"] }`를 주는 것을 단정으로 확인했다. pgTAP 2건 추가됨.
- 상태: **수정됨(확인 완료)**

### QA-R13-06 [Minor] 릴리스 확인 4 — **해결**
- `05_release.md` 확인 4가 "가격표 행이 없어진 과거 행은 **의도적으로** 0/0으로 남기므로 '0/0인데 합계가 0보다 큼'은 오류가 아니다"를 먼저 적고, 실행 가능한 읽기 전용 쿼리 두 개(⒜ unpriced도 아니고 토큰도 있는데 0/0인 `(version, provider, model)` 집계 ⒝ 두 열의 합이 저장 합계와 다른 건수 — 고치지 않고 기록만)로 교체됐다. notice 문구를 먼저 보라는 순서도 들어갔다.
- 상태: **수정됨(확인 완료)**

### QA-R13-07 [Minor] `insight_payload_valid` 주석 — **해결**
- 라이브 함수 본문이 `-- AI-02 sources: career 5종 + JD (v4.12, SD-A19 — profile is gone).`로 바뀌었다.
- 상태: **수정됨(확인 완료)**

## 2라운드 신규 이슈

### QA-R13-08 [Minor] 생성 타입이 "어떤 `supabase` 바이너리로 돌렸는지"에 따라 갈린다
- 담당: **db-engineer** (CLI 핀 변경 여부는 사용자 결정 — `spec-gaps` R13-DB-9)
- 근거: `pnpm exec supabase --version` → `2.121.0`(핀, 커밋본과 동일 출력) vs `supabase --version` → `2.122.0`(뷰 컬럼 non-null). 같은 로컬 DB·같은 명령인데 **출력이 1행 다르다**. 그리고 **번들 검사 스크립트가 전역 CLI를 먼저 고른다** — `.claude/skills/backend-integration-qa/scripts/run-checks.sh`의 `sb="supabase"; command -v supabase >/dev/null 2>&1 || sb="node_modules/.bin/supabase"` (전역이 있으면 전역). 1라운드에 내가 오판한 경로가 그것이다.
- 영향: 런타임 위험 없음(위 QA-R13-05 참고). 다음 사람이 pnpm 밖에서 타입을 재생성하면 그 1행이 조용히 뒤집히고, 그때 `src/types/db.ts`의 손 좁힘이 "불필요한 좁힘"으로 보여 지워질 수 있다 — 그러면 CLI를 다시 핀 버전으로 돌릴 때 UI 타입이 깨진다.
- 권고: ① `package.json`의 `db:types`·`db:reset`·`db:test`를 `pnpm exec supabase …`로 못 박거나 `supabase` 호출을 전부 `pnpm` 스크립트 경유로 쓰도록 노트에 한 줄 ② `database.types.ts` 머리에 "`pnpm db:types`(핀한 CLI)로만 재생성 — 전역 CLI는 뷰 컬럼 nullability가 다르다"는 주석 ③ CLI를 올릴지는 사용자 결정(R13-DB-9)이고, 올릴 때 이 1행과 `src/types/db.ts` 좁힘을 **함께** 본다
- 상태: **열림**

## 회귀 확인 (1라운드에 통과했던 것)

| 항목 | 2라운드 |
|------|---------|
| 삭제 3컬럼 런타임 참조 | **0건** (주석·`as never` 테스트·픽스처·옛 마이그레이션·`source_field` CHECK 문자열만 — 의도된 잔존) |
| readiness 응답 키 양쪽 삭제 | 유지 — `enums.ts:138 READINESS_HINTS = ["project_star","project_fields"]`, `types/db.ts:1156 ReadinessHint`에 `profile` 없음, `career.ts`·`readiness.ts`에 `profile_filled` 없음 |
| 근거 허용 출처 5종 | 유지 — `public`/`private` 함수 중 `'profile'`을 가진 것은 거부 트리거 `evidence_links_check_source` **하나뿐** |
| `career_snapshot_hash` 미포함 | 유지 (`career-pack.test.ts`의 "기준월만 바뀌면 해시 동일" 단정 통과) |
| grant 42501 | 유지 — 스모크 5에서 `app_ai_writer`가 내 정보 컬럼·`profile_job_interests`·`profile_options` 전부 거부 |
| 시드 101행 / `parent_code` | 유지 — 101행, `job_role`의 부모 위반 **0** |
| 마이그레이션 순서 | 유지 — 새로 늘어난 것은 `supabase/tests/`의 pgTAP 1파일이라 `migrations/` 정렬에 영향 없음. `20261113002800`이 **여전히 마지막**, `002750` < `002760` < `002800`, `-- DESTRUCTIVE:` 헤더 파일은 그 1개뿐 |
| 과거 결과 행 `prompt_version`·`input_hash` 수정 마이그레이션 | **없음** (`set prompt_version` / `set input_hash` 검색 0건) |
| 새 로깅 | **0건** (`src/server/` 변경분에 새 `console.`/logger 호출 없음) |
| 로컬 스택 오염 | 1라운드와 같이 재현 안 됨. `db reset` 없이 pgTAP 65파일 통과. db가 `spec-gaps` R13-DB-7을 내린 것은 타당 |

## 기획 문서 정정 (사용자가 `resumate-planning`으로 고칠 것)

코드 문제가 아니다. 구현이 맞고 문서의 잔여 문장이 틀렸다고 **QA가 판정한** 것들이다.

| ID | 문서·위치 | 어긋남 | 판정 |
|----|-----------|--------|------|
| **D1** | DM 2.1.2 "별도 테이블로 둔 이유 ②"의 **"최대 3쌍"**, DM §7 내 정보 저장 행의 **"4쌍 이상"**, DM 머리글·9장·변경이력의 "최대 3쌍"·"`CHECK 1..3`", UX S-24 ① 쌍 행의 "`sort_order`(1~3)" | 쌍 상한 | **2쌍이 맞다.** 같은 2.1.2 본문("최대 2쌍", `CHECK (sort_order between 1 and 2)")과 D-DM-14 닫힘(SD-Q3 (가)), 11.7 #3이 모두 2쌍이고 구현도 2로 **일관**하다(`c_max_pairs = 2` · DB CHECK 1..2 · `MAX_JOB_INTERESTS = 2` · 오류 문구 "최대 2개"). 흔들림 없음. 기존 `spec-gaps` R13-DB-1 / R13-API-1 확인 |
| **D2** | DM 2.1.2 RLS 줄 "select/insert/update/delete **전부 본인**" | DM §5 표는 같은 테이블의 update를 "없음(전체 덮어쓰기)"로 적는다 | **§5가 맞다.** 구현은 update 정책을 두지 않았고(전체 덮어쓰기 설계), pgTAP가 "update grant 없음"을 단정한다. 2.1.2의 그 줄을 §5와 같은 말로 |
| **D3** | DM 2.1.1·변경이력의 "최종 학력 **6칸**" | 바로 뒤에 열거된 컬럼은 **7개**(`school_name`·`degree`·`status`·`start_month`·`end_month`·`major`·`gpa`) | 열거가 맞다(구현도 7컬럼). 숫자만 7로 |
| **D4** | DM 6.2 / AI C-1("**공개 RPC 없음**") | 구현은 `public.compute_total_experience_months(p_as_of date)` 얇은 래퍼를 둔다 | **래퍼가 타당하다.** 팩 조립은 TS이고 DB 접근은 PostgREST인데 `supabase/config.toml`이 `private`를 노출하지 않는다(ai가 "막힘 ★"으로 올린 건). 래퍼에 판정 로직이 없고, security definer로 `private.current_uid()`만 쓰므로 타 사용자 계산 경로가 없다. 문서를 "화면이 쓰는 RPC는 없다 / 서버 실행 경로용 public 래퍼는 둔다"로. 기존 R13-AI-3·R13-DB-2 |
| **D5** | DM 2.1.5·§5의 "AI 실행 경로가 `profiles`에서 읽는 것은 **`active_ai_provider`**·`career_data_updated_at`뿐" | 실제 grant에는 `active_ai_provider`가 없다(남은 것은 `id`·`career_data_updated_at`·`updated_at`) | **동작 문제 없다 → 문서 정정.** `active_ai_provider`는 사용자 세션(`loadActiveProvider(supabase: UserSupabaseClient)`, `src/server/services/ai-connection/keys.ts:68`)과 security definer 게이트 RPC만 읽고 `app_ai_writer` 경로는 읽지 않는다. 스모크·통합 테스트·pgTAP 모두 현재 grant로 통과. 문서를 "읽는 경로" 서술과 "grant 목록"으로 나눠 적기 |
| **D6** | AI 0.v412 프롬프트 버전 표의 절대값 — `common.v1 → common.v2`, `ai-02.match.v2 → v3`, `ai-02.synthesize.v2 → v3` | 구현 현행값이 이미 `common.v2`·`ai-02.match.v4`·`ai-02.synthesize.v4`였다 (**`git diff HEAD`로 before 값 확인**) | **ai의 `common.v3`·`match.v5`·`synthesize.v5`가 타당하다.** 같은 절이 "이 문서에 적혀 있지 않은 기능은 **현행 `v{n}` → `v{n+1}`**"이라는 규칙을 두고 있고, 표의 절대값을 그대로 쓰면 프로필 삭제가 버전에 전혀 반영되지 않거나(common) 번호가 뒤로 간다(match v4 → v3). 표의 세 행을 구현 현행값 기준으로 정정. 기존 R13-AI-1 |
| **D7** | AI 0.v412 "올리지 않음" 목록에 **AI-06** | 구현의 AI-06 system 블록은 A10 프로필 규칙 문장(`PROFILE_PREFERENCE_RULE`)을 **실제로 품고 있었다** — `git diff src/server/ai/prompts/AI-06/index.ts`에 `-${PROFILE_PREFERENCE_RULE}` 삭제 라인이 있다 | **`ai-06.evaluate.v4`로 올린 판단이 타당하다.** 문서의 "올리지 않음"은 "AI-06은 프로필 텍스트를 쓰지 않는다"는 전제인데 그 전제가 틀렸다. 목록에서 AI-06을 빼거나 "+1"로. 기존 R13-AI-2 |
| **D8** | UX S-24 ① "저장 오류 **5종**" 머리글 | 바로 아래 표가 6행(`duplicate_job_interest` 추가, R-SD-18) | 6으로. 기존 R13-API-2 |
| **D9** | DM 2.1.3 `ai_data_use`의 `version`·`effective_at`("법무 확인 뒤") | 구현은 `2026-11-05`를 잠정 넣었다 | 확정 값 필요. 바꿀 때는 **행 수정이 아니라 새 행 추가**(버전 이력 보존, `requires_reconsent = false`라 게이트 영향 없음). 기존 R13-DB-3 |
| **D10** | DM 2.1.1 / 7장 — 최종 학력 연월의 전송 형식 미명시 | 구현·계약·RPC가 `'YYYY-MM'`(저장은 1일 고정) | 커리어 관행(DM-4)과 같으므로 한 줄 명시 권장. 기존 R13-API-3 |

`spec-gaps.md`에 **새로 넘길 항목은 없다** — 위 10건은 전부 db·api·ai가 이미 R13-DB-1~7 / R13-API-1~4 / R13-AI-1~5로 적어 둔 것이고, QA가 그 판정(구현이 맞음/문서가 틀림)을 확정했다. R13-AI-3("막힘 ★")는 db의 ⑯ 래퍼로 **해소됨**, R13-API-4("db가 detail을 붙이지 않는다")는 **db가 반영했고 api 매핑이 안 따라감**(QA-R13-01) 상태로 갱신이 필요하다.

## UI 소유 파일 수정 범위 (backend-context "Minimal UI edits")

| 파일 | 수정 | 판정 |
|------|------|------|
| `src/components/career/profile-form.tsx` | 삭제된 3컬럼 입력 제거 → 이름 한 칸(-95/+? 행, 거의 전부 삭제) | **범위 내.** 컬럼이 사라져 타입·런타임이 깨지는 수정이고, 삭제만 하고 새 UI를 만들지 않았다. S-04 폐기·리다이렉트는 "UI 요청"으로 남겼다 |
| `src/lib/mock/fixtures.ts` | `profiles` 3컬럼 삭제 + 새 10컬럼 null, `ai_usage_records`에 비용 2열 | **범위 내**(미리보기 스위치·타입 채우기). 7:3 분할값은 mock 전용이고 노트에 적혀 있다 |
| `src/lib/mock/ai.ts` | mock 사용 기록 insert에 비용 2열(+3행) | **범위 내** |
| `src/components/account/policy-content.ts` | `POLICY_DOCUMENTS`에 `ai_data_use: []` 한 줄(+4행, 주석 3줄) | **범위 내**(`Record<PolicyType, …>`가 새 키를 요구) |
| ai가 고친 3건 (`src/test/draft-fakes.ts`, `src/server/services/{interview,insight}/job.test.ts`) | `profile: null` → `emptyCareerRows(...)` | **UI 소유가 아니다**(`src/test/`·`src/server/`는 백엔드 소유). 범위 문제 없음 |

→ **범위를 넘은 수정 없음.** 되돌릴 것 없음. 네 건 모두 `02_api_notes.md` §7에 기재되어 있고 "UI 요청" 7건이 §8에 분리되어 있다.

## 라운드 정리 (최종)

- **Critical 없음** → `done`을 막는 것 없음
- 1라운드 7건: **해결 6** (QA-R13-01·02·03·04·06·07) · **철회 1** (QA-R13-05 — 내 근거가 틀렸다)
- 2라운드 신규: **QA-R13-08 (Minor, 열림)** — CLI 호출 방식에 따라 생성 타입 1행이 갈린다
- 검사: typecheck · lint · Vitest(154파일/2496) · pgTAP(65파일/3048) · 로컬 스모크(7/7) **전부 통과, SKIP 없음**
- 사용자 몫으로 남는 것: 기획 문서 정정 10건(위 표) · `spec-gaps` R13-DB-3(`ai_data_use` 확정 값) · R13-DB-9 / QA-R13-08(CLI 핀) · ⑭ 파괴적 drop 확인
- 라운드는 여기까지다(오케스트레이터 규칙). 열린 Minor 1건은 리더에게 넘긴다
