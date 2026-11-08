# R13 — AI 파이프라인 구현 노트 (ai-pipeline-engineer)

- 날짜: 2026-11-05
- 기준: AI 명세 v4.12 (0.v412 · C-1 `computed_total_months` · C-3 · V-4 · V-5 · V-7 · AI-02 판정 기준 · AI-04 `future_plan` · AI-05 컬처핏) · 데이터 모델 v4.12 (2.1.5 · 6.2 · 2.8 · 11.7 #7·#12·#13) · `_workspace/backend/R13/01_plan.md`
- 범위: #12(컨텍스트 팩에서 프로필 제거) · #7(`computed_total_months`, AI 쪽) · #13(프롬프트 버전 상향) · #8(비용 분할 — 확인만)
- 검증: `pnpm lint` 통과 · `pnpm vitest run src/server/ai` **1243 통과 / 0 실패** · `pnpm typecheck`는 아래 "남은 타입 오류"만 남음

## 1. 컨텍스트 팩에서 프로필 블록 제거 (SD-6, #12)

- `src/server/ai/context-pack/career-rows.ts`
  - `PROFILE_COLUMNS`·`ProfileRow`·`CareerRows.profile` **삭제**. `loadCareerRows`가 **`profiles`를 아예 조회하지 않는다**(테이블 목록에서 빠짐 — 테스트가 고정).
  - 빠진 값: `desired_job_title` · `interested_industries` · `total_years_of_experience` · `display_name`(원래도 안 읽었음) · 설정 "내 정보"의 새 값 전부(읽지 않음).
  - 대신 `CareerRows.totalExperience`가 생겼다(아래 2).
  - 시그니처는 `loadCareerRows(db, { asOf? })`로 **인자 추가만** 했다(기존 호출부는 그대로 동작).
- `src/server/ai/context-pack/career-pack.ts` — `<profile ref="PROFILE">` 블록 삭제. **이름만 남긴 빈 블록도 두지 않았다**(0.v412). `career_snapshot_hash`의 `profile` 항목도 삭제.
- `src/server/ai/context-pack/summary-pack.ts` — 요약 팩의 `PROFILE` 줄 삭제.
- `src/server/ai/context-pack/selection.ts` — `filterCareerRows`가 `profile`을 넘기던 자리에 `totalExperience`를 넘긴다.
- `src/server/ai/context-pack/interview.ts` — `emptyCareerRows(asOf)`(인자 추가), 컬처핏 **고유명사 검사 예외를 "JD에 있는 말"만으로 축소**(`desired_job_title` 제외 규칙 삭제, AI 명세 4.1).
- `src/server/ai/context-pack/writing-chat.ts` · `deliverable-chat.ts` — 입력 타입의 `desiredJobTitle`과 `<chat>`의 `desired_job_title:` 줄 삭제(AI-12·AI-13).
- 근거 `source_type`:
  - `src/server/ai/evidence-rules.ts` — `EVIDENCE_SOURCE_TYPES`에서 `profile` 삭제 → 코드 쪽 커리어 출처 **5종**(`experience`·`education`·`project`·`project_deliverable`·`skill`)만 남는다. `EVIDENCE_RULES.profile`, `CAREER_SUPPORT_SOURCE_TYPES`의 `profile`, `PROFILE_PREFERENCE_FIELDS`·`isProfilePreferenceEvidence` 전부 삭제.
  - **DB CHECK 목록·기존 행은 건드리지 않았다**(SD-A19 — db-engineer 몫).
  - V-4: 프로필 예외 2줄 삭제 → `isCareerSupportEvidence`는 "출처 종류가 지원 집합에 있는가"만 본다. 남은 규칙은 "그 항목에 유효한 근거가 하나도 없으면 근거 0개" 하나.
  - V-7: `buildSelectionScope`(`validation/evidence.ts`)·`buildSourceScope`(`validation/drafts.ts`)의 항상 허용 출처에서 `profile` 삭제 → 선택 없는 AI-04 문항의 범위는 빈 집합 + JD·메모.
  - 별칭 `PROFILE`: `validation/alias-text.ts`(치환 표·토큰 패턴)·`validation/numbers.ts`(별칭 패턴)에서 삭제. `numbers.ts` 패턴에 빠져 있던 `DLV`를 함께 넣었다(별칭이 수치로 읽히지 않게).
  - `validation/evidence.ts` `checkEvidence`에 **모르는 `source_type` → V-1(`v1_ref`) 가드** 추가(명세 C-3 "모델이 그래도 프로필 근거를 달면 V-1로 제거된다"). 실제로는 zod enum이 먼저 걸러낸다 → spec-gaps R13-AI-5.
- 테스트·픽스처: `__fixtures__/career-rows.ts`(프로필 삭제 + `TOTAL_EXPERIENCE_FIXTURE`), `__fixtures__/AI-12|AI-13/conversations.ts`(`desiredJobTitle` 삭제), `career-pack.test.ts`(프로필 없음 단정으로 교체 + 합계 블록 3건 신설), `career-rows.test.ts`, `validation/{evidence,insight,drafts,alias-text}.test.ts`, `storage/evidence-links.test.ts`, `pipelines/AI-05.test.ts`, `context-pack/writing-chat.test.ts`.
- `prompts/profile-preference.test.ts` → **`prompts/prompt-versions.test.ts`로 교체**: ① 모든 system 블록에 프로필 필드명·`PROFILE`·"희망 직무"·"프로필"이 없음 ② SD-2/SD-6로 새로 들어간 문장 ③ R13 프롬프트 버전 문자열 전체(올린 것 10 / 안 올린 것 6)를 고정.

## 2. `computed_total_months` (SD-2, #7)

- 새 파일 **`src/server/ai/context-pack/total-experience.ts`**: `TotalExperience`(`totalMonths`·`openEndedExperienceCount`·`asOfMonth`), `loadTotalExperience(db, asOf)`, `parseTotalExperience`, `emptyTotalExperience`, `kstDateString`. 테스트 `total-experience.test.ts`.
- **호출 지점**: `loadCareerRows()`(`career-rows.ts`)가 커리어 행 조회와 **같은 `Promise.all`에서** 한 번 부른다. 팩 조립은 계산하지 않고 받은 값을 렌더링만 한다.
- **넘긴 `p_as_of`**: 그 실행의 **KST 오늘**(`kstDateString()`, `Asia/Seoul` 달력 날짜 `YYYY-MM-DD`). 호출자가 `loadCareerRows(db, { asOf })`로 고정 날짜를 줄 수 있다(테스트·재현). **기본값에 기대지 않고 항상 명시해 넘긴다**(DM 6.2 R-SD-23).
- 팩 머리 줄(`<career_data>` 바로 다음, SD-2 표기 규칙):
  - `computed_total_months: 등록된 경력 기간 합계 7년 10개월 (총 94개월, 기준 2026-10, 서버 계산)` — N년 M개월·총 X개월·기준월(= 반환값 `as_of_month`)·"서버 계산" 명시.
  - `open_ended_experience_count > 0`일 때만 한 줄 더: `computed_open_ended_experiences: 기간 미입력 경력 2건(합계에 넣지 않음)` — **따로 세지 않고 같은 호출의 값을 쓴다**.
- **해시에 넣지 않았다**: `career_snapshot_hash` 스냅숏에 `totalExperience`가 없다(테스트로 고정 — 합계·기준월만 바뀌면 해시 동일). `input_hash`는 `careerSnapshotHash`를 재료로 쓰므로 자동으로 제외된다.
- **V-5**: 합계의 개월 수·년 수·나머지 개월(+"N년차")을 `numberSources.computedNumbers`에 넣는다(기존 `addDurationNumbers` 재사용) → 생성 문장에 7·10·94가 나와도 수치 가드에 걸리지 않는다.
- **AI-02 판정**(`prompts/AI-02/index.ts`): 기존 "profile의 `total_years_of_experience`와 `computed_total_experience`로 판단" 문장을 지우고 4줄로 교체 — ① 연차 요건은 `computed_total_months` 하나로만, `<jd>`의 `seniority` 줄이 말하는 최소 연차와 견준다(직접 다시 세지 않음) ② 모자라면 `partial` ③ 영역 경험 자체가 없으면 `no_evidence` ④ `computed_open_ended_experiences`가 있으면 합계 부족만으로 `no_evidence`로 내리지 않는다 ⑤ 이유 문장에 "등록된 경력 기간 합계 기준", 근거 객체는 달 수 없음.

### db 담당 요청 (막힘 ★)

`20261113002000_r13_compute_total_experience_months.sql`은 `private` 전용이고 주석에 "No public RPC wrapper"라고 적혀 있다. **AI 실행 경로는 PostgREST만 쓰고 `private` 스키마는 노출되지 않는다**(`supabase/config.toml` `schemas = ["public", "graphql_public"]`) → 지금 상태로는 팩이 이 함수를 부를 수 없다. 다음 래퍼를 부탁한다(코드가 이 모양을 전제로 작성됨, spec-gaps **R13-AI-3**):

```sql
create or replace function public.compute_total_experience_months(p_as_of date)
returns record  -- (total_months integer, open_ended_experience_count integer, as_of_month date)
language sql stable security definer set search_path = ''
as $$ select * from private.compute_total_experience_months(private.current_uid(), p_as_of) $$;
revoke all on function public.compute_total_experience_months(date) from public, anon;
grant execute on function public.compute_total_experience_months(date) to authenticated, app_ai_writer;
```

- 이름·인자 이름(`p_as_of`)이 그대로여야 한다(`TOTAL_EXPERIENCE_RPC` 상수).
- 반환은 **한 행**이면 모양 무관하다 — `parseTotalExperience`가 객체와 1원소 배열 둘 다 받는다(`returns record` / `returns table(...)` 모두 가능).
- `app_ai_writer` execute가 필요하다(AI 실행 경로). 사용자 세션(`authenticated`)도 주면 좋다 — `src/lib/data/career.ts`가 같은 `loadCareerRows`를 쓴다.
- 정본 규칙은 `private` 함수 안에 그대로 두면 된다(래퍼는 위임만). 래퍼를 두지 않을 거라면 대신 어떤 호출 경로를 쓰라는 것인지 알려 달라.
- `app_ai_writer`가 `public.experiences`를 읽을 권한은 이미 있고, `private` 함수는 security definer라 권한은 래퍼 execute만 있으면 된다. `private.current_uid()`는 `app_ai_writer`·`authenticated` 양쪽에서 쓰이는 기존 패턴이다.

## 3. 프롬프트 버전 (#13)

| 상수 | before | after | 비고 |
|------|--------|-------|------|
| `COMMON_PROMPT_VERSION` | `common.v2` | **`common.v3`** | 표는 v1 → v2지만 구현은 이미 v2(R4) → 현행+1 규칙 적용. spec-gaps R13-AI-1 |
| `AI02_MATCH_PROMPT_VERSION` | `ai-02.match.v4` | **`v5`** | 표는 v2 → v3, 구현 현행 v4 → +1 |
| `AI02_SYNTHESIZE_PROMPT_VERSION` | `ai-02.synthesize.v4` | **`v5`** | 같은 system 블록 |
| `AI02_PROMPT_VERSION`(저장) | `…match.v4+…synthesize.v4` | **`…match.v5+…synthesize.v5`** | |
| `AI03_PROMPT_VERSION` | `ai-03.generate.v3` | **`v4`** | |
| `AI04_PROMPT_VERSION` | `ai-04.generate.v3` | **`v4`** | |
| `AI04_ADJUST_PROMPT_VERSION` | `ai-04.adjust.v3` | **`v4`** | 글자 수 보정이 같은 AI-04 system 블록을 쓴다(AI-02 두 단계와 같은 이유) |
| `AI05_PROMPT_VERSION` | `ai-05.generate.v3` | **`v4`** | |
| `AI06_PROMPT_VERSION` | `ai-06.evaluate.v3` | **`v4`** | 명세는 "올리지 않음"이지만 구현의 AI-06 system이 A10 프로필 문장을 품고 있었다. spec-gaps R13-AI-2 |
| `AI12_REPLY_PROMPT_VERSION` | `ai-12.reply.v6` | **`v7`** | 표와 일치 |
| `AI13_REPLY_PROMPT_VERSION` | `ai-13.reply.v2` | **`v3`** | 표와 일치 |

올리지 않은 것(접미사만 `common.v3`로 바뀜): `ai-01.extract.v1` · `ai-07.summarize.v1` · `ai-11.rank.v2` · `ai-12.extract.v7` · `ai-13.extract.v3` · `ai-13.compose.v2`. AI-08은 구현 없음.

**과거 결과 행의 `prompt_version`·`input_hash`는 손대지 않았다** — 동일 입력 재사용이 배포 시점에 한 번 전부 끊기는 것은 의도(0.v412).

### 프롬프트 본문 변경 (버전을 올린 이유)

- `prompts/common.ts` — 근거 형식 별칭 목록에서 `PROFILE` 삭제. `PROFILE_PREFERENCE_RULE` 상수 **삭제**(쓰던 5개 기능에서 제거).
- `prompts/AI-02/index.ts` — 연차 판정 규칙 교체(위 2).
- `prompts/AI-03/index.ts` — A10 프로필 문장 삭제(입력 팩·V-7 범위에서 프로필 사라짐).
- `prompts/AI-04/index.ts` — A10 문장 삭제, "메모·JD·프로필만으로" ×2 → "메모·JD만으로", `future_plan` 규칙에 **"성장 방향은 `<jd>`의 주요 업무 문장(S 번호)과 스킬 근거로 씁니다"** 추가.
- `prompts/AI-05/index.ts` — A10 문장 삭제, 컬처핏 `general`의 "프로필의 희망 직무는 쓸 수 있습니다" → **"직무 어휘는 `<jd>`의 직무명·요건 문장에서 가져옵니다"**.
- `prompts/AI-06/index.ts` — A10 문장 삭제.
- AI-12·AI-13 reply — `<chat>`의 `desired_job_title` 줄 삭제(본문 텍스트 변경 없음, 입력 블록 변경).

## 4. 비용 분할 (C-13, #8) — 확인만

- `src/server/ai/llm.ts`는 비용을 계산하지 않는다. 공급자 어댑터의 정규화 usage를 **그 모양 그대로** 기록 경로(`onCall` → `recordUsage`)에 넘긴다: `inputTokens`·`cachedInputTokens`·**`cacheWriteTokens`**·`outputTokens`·**`reasoningTokens`**·`usageSource`. R13에서 **변경 없음**.
- 식의 정본은 `src/server/jobs/cost.ts`(api 담당). 입력 쪽 3항(비캐시·캐시 읽기·캐시 쓰기) / 출력 쪽 1항으로 나누는 데 필요한 값이 모두 그 모양 안에 있어 **어댑터·llm 쪽 요청은 없다**. `reasoningTokens`가 `outputTokens`에 이미 포함된다는 전제(C-13)도 그대로다.

## api 담당(api-engineer)에게 남기는 요청

1. **`src/server/services/writing-chat/pipelines.ts`** — `WritingChatTurnInput`·`DeliverableChatTurnInput`에서 `desiredJobTitle`이 사라졌다. 25행·209행의 `Pick<…, "desiredJobTitle">`과 79행·253행의 `desiredJobTitle: profile.data?.desired_job_title ?? null`을 지워 달라(컬럼 drop 뒤에는 어차피 깨진다). 프로필 조회 자체가 다른 용도로 필요 없으면 쿼리도 함께 삭제.
2. **`src/server/db/ai-writer.integration.test.ts`** (35~38행) — 테스트 헬퍼가 `profiles`에 `desired_job_title`·`total_years_of_experience`를 쓴다. 컬럼 drop 뒤에는 실패한다(지금 로컬 스택에서 이미 `PGRST204`).
3. `loadCareerRows`는 이제 `{ asOf?: string }`(KST `YYYY-MM-DD`)를 받는다. 기본값은 KST 오늘이므로 **기존 호출부는 그대로 두어도 된다**. 서비스가 그 실행의 기준일을 이미 알고 있다면(예: 재현 테스트) 넘겨 주면 좋다.
4. **`src/lib/data/career.ts` `loadCareerData`** — `loadCareerRows`를 쓰므로 커리어 목록 화면에서도 합계 함수를 한 번 더 부른다(기존 조회와 같은 `Promise.all`, `stable`·경력 몇 건의 `generate_series`라 비용은 작다). 화면이 이 숫자를 안 쓰므로 호출을 끄는 옵션이 필요하다고 판단되면 알려 달라 — `loadCareerRows`에 `{ withTotalExperience: false }`를 더하는 쪽으로 맞추겠다.
5. `CareerRows`에서 `profile`이 빠지고 `totalExperience`가 생겼다 — 아래 "다른 사람 영역 최소 수정" 3곳은 이미 맞춰 두었다.

## 다른 사람 영역 최소 수정 (타입 유지용, 테스트 픽스처만)

`CareerRows` 리터럴에서 `profile: null`을 쓰던 곳을 `emptyCareerRows({ year: 2026, month: 11 })`로 바꿨다. 동작 변화 없음.

- `src/test/draft-fakes.ts:206`
- `src/server/services/interview/job.test.ts:295~296` 부근(`loadCareerRows` fake)
- `src/server/services/insight/job.test.ts:48`

## 내린 `[가정]`

1. **`common.v3`** — 명세 표의 `v1 → v2`가 구현 현행값(v2)과 어긋나므로 같은 절의 "현행 → +1" 규칙을 적용(R13-AI-1).
2. **`ai-02.match.v5` / `ai-02.synthesize.v5`** — 같은 이유.
3. **`ai-06.evaluate.v4`** — 명세는 "올리지 않음"이지만 실제 프롬프트 텍스트가 바뀌므로 올림(R13-AI-2).
4. **`ai-04.adjust.v4`** — 명세는 "AI-04 자소서 문항 초안 +1"만 적지만 보정 호출이 같은 system 블록을 공유하므로 함께 올림.
5. **public 래퍼 전제** — `public.compute_total_experience_months(p_as_of date)`를 호출한다(R13-AI-3). db 쪽이 다른 경로를 주면 `total-experience.ts` 한 파일만 고치면 된다.
6. **연차 요건의 최소 연차 비교 대상** — 입력에 `min_years` 숫자가 없어 `<jd>`의 `seniority` 라벨 줄을 기준으로 삼으라고 지시(R13-AI-4).
7. **폐기 출처를 단 항목의 처리** — zod enum이 먼저 걸러 그 항목(AI-05 질문)이 통째로 버려진다. 명세의 "근거만 제거"보다 엄격한 쪽(R13-AI-5).
8. **팩 머리 줄 키 이름** — `computed_total_months` / `computed_open_ended_experiences`. 공통 system의 "`computed_` 로 시작하는 줄은 서버가 계산한 값" 규칙에 맞춘 이름이고 명세에 문자열 지정은 없다.
9. **`months.ts`의 `mergedMonths` 삭제** — 월 합집합 계산이 DB 함수로 옮겨져 TS 쪽 중복 정의를 남기지 않았다(DM 6.2 "정의가 갈라지지 않게"). 관련 단위 테스트도 삭제(같은 단정은 db-engineer의 pgTAP에 있다).
10. **빈 커리어의 합계 줄** — `complete` 경력이 없어도 머리 줄은 넣는다(`등록된 경력 기간 합계 0개월`). C-1에서 이 블록은 필수이고, 줄이 없으면 모델이 "합계를 모른다"와 "0"을 구분할 수 없다.

## 남은 타입 오류 (`pnpm typecheck`)

내 담당 파일에서 **1건**, 전부 db-engineer의 `database.types.ts` 재생성으로 풀린다:

- `src/server/ai/context-pack/total-experience.ts:58` — `db.rpc("compute_total_experience_months", …)`가 생성 타입의 RPC 목록에 없다(TS2345). **위 public 래퍼 마이그레이션 + 타입 재생성**이면 사라진다. 래퍼가 없으면 타입 오류가 남고 런타임에도 실패한다(막힘 ★).

내 영역 밖의 오류(참고, 각 담당이 해결):

- `src/server/services/profile/index.ts` — `profile_options`·`profile_job_interests`·`save_profile_basics`(타입 재생성 대기)
- `src/server/jobs/supabase-usage.ts`·`support.test.ts`·`runner.integration.test.ts`·`application.integration.test.ts` — `input_cost_usd`/`output_cost_usd`·`get_ai_usage_summary` `providers[]`(타입 재생성 대기)
- `src/server/services/writing-chat/pipelines.ts` — 위 api 요청 1
- `src/lib/contracts/s1-contracts.test.ts`·`src/server/services/profile/profile.test.ts`·`consent.integration.test.ts`·`src/lib/data/career.integration.test.ts` — 프로필 계약 변경(api 담당)

## 기획 문서 모순

`_workspace/backend/spec-gaps.md` "R13 (ai-pipeline-engineer, 2026-11-05)" 5건: R13-AI-1(`common` 버전 번호) · R13-AI-2(AI-06 올리지 않음) · R13-AI-3(`private` 함수 호출 경로) · R13-AI-4(`min_years` vs `seniority.label`) · R13-AI-5(폐기 출처의 처리 단위).
