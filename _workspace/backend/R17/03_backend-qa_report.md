# R17 백엔드 QA 리포트 (라운드 1)

- 작성: backend-qa, 2026-11-14
- 대상: 커밋 전 작업 트리(`git status` 139항목), `01_plan.md`, `02_db_notes.md`, `02_ai-pipeline_notes.md`, `02_api_notes.md`
- 코드는 고치지 않았다. 커밋하지 않았다.

## 검사 실행 결과

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck (`next typegen && tsc --noEmit`) | 통과 | 오류 0 |
| lint (`eslint`) | 통과 | 경고·오류 0 |
| Vitest | 통과 | **157 파일, 2620 테스트**, 건너뜀 0 (로컬 스택이 떠 있어 통합 테스트 13개 파일 모두 실행) |
| pgTAP (`supabase test db`) | 통과 | **66 파일, 2613 단정**, `r17_jd_raw_text.test.sql` ok |
| 타입 최신성 | 통과 | `supabase gen types typescript --local` 결과 = `src/server/db/database.types.ts` (diff 없음) |
| 로컬 스모크 | 통과(통합 테스트 경로) | 아래 참고. `pnpm dev` + HTTP 호출은 SKIP: 앱 로그인이 Google 전용(R6)이라 브라우저 세션 없이 라우트를 칠 수 없음. 스킬이 허용하는 "실제 deps 팩토리를 통하는 Vitest 통합 테스트"로 대체 |

### 로컬 스모크 (127.0.0.1:54322, R17 마이그레이션 적용 상태)

`pnpm exec vitest run src/lib/data/w3.integration.test.ts src/server/services/insight/insight.integration.test.ts src/server/services/application/application.integration.test.ts` → 3 파일 25 테스트 통과.

- `w3.integration` — 화면 데이터 함수 → Server Action → 서비스 → 실제 RPC·트리거·RLS, 실제 러너와 production `connections`(공급자 어댑터·키 복호화만 대체).
  - 정상: S-14 키 있음 → 9인자 `create_application_project`, 잡 없음, 이름 = 기업명. S-16 인사이트 시작 → generating → 실제 AI-02 파이프라인 → ready, 칩·item_key 읽기.
  - 실패 경로(공급자 불필요): 키 없음 생성 → 기본 이름·잡 없음·AI 시작 거부, 동의 철회 상태에서도 생성(R17-9), 새 JD 원문 수정 → `jd_raw_text_locked`(R17-6).
- `insight.integration` — 실 AI-02 파이프라인 + 스크립트 공급자: prepare → match(호출 1) → synthesize → `complete_insight` v2(`jd_text_hash` = `raw_text_hash`, `requirements_hash` null, `jd_sentence` 근거 행), 사용 기록 2행(`insight.match`, `insight.synthesize`), input_hash 재사용(잡·사용 기록 없음), 경력 수정 → stale, 실패 → C-20, 수동 재시도 재개, 로그에 커리어 문장·키 없음.
- 종료 코드가 `stalled`로 새는 경로 없음(정상 잡 `succeeded`).

## 경계면 검사

| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | 계획 §2 ↔ 마이그레이션 | 통과 | 계획의 1~6 모두 반영. `begin_insight`·`complete_insight`·`start_document_writing_chat`는 이전 정의와 diff 해 R17 줄 외 변경 없음 확인(그 밖의 의미 동일, grant는 `create or replace`로 유지) |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과 | 재생성 diff 없음. `insights.select(… jd_text_hash …)`, `job_descriptions.select(… raw_text_hash …)` 컬럼 존재 |
| Q3 | RPC 시그니처 ↔ 호출부 | 통과 | `create_application_project` 9인자(`p_id … p_source_url`) ↔ `services/application/write.ts:60` 인자 이름 일치, 반환 6키 ↔ 파싱(`application_project_id, job_description_id, name, name_source, ai_run_allowed, created`) 일치. `complete_insight` `hashes{jd_text_hash, career_snapshot_hash, input_hash}` ↔ `storage/insight.ts` `toCompleteInsightPayload` ↔ `finalizeInsight` 일치. 삭제 RPC(`begin/apply/fail_jd_extraction`, `purge_unused_jd_preview_outputs`, `p_preview_job_id`) 호출부 0(주석·부재 단정만) |
| Q4 | `raise` 코드 ↔ 오류 매핑 | 이슈 | 새 `job_description_not_found` 매핑 있음(`errors.ts:99,229`). 죽은 매핑 5개 → QA-01 |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 | 통과(스펙 차이 있음) | `CreateApplicationProjectInput`(previewJobId 없음) ↔ 서비스 ↔ `createApplicationAction` ↔ 추가 모달 일치. 화면 명세와 어긋나는 부분은 계획의 `[가정]`(아래 "스펙 차이") |
| Q6 | SSE 이벤트 | 해당 없음 | 이벤트 이름·형태 변경 없음. AI-04 블록 `requirement_ids`는 항상 `[]`(`validation/cover-letter.ts:159`, `draft-blocks.ts:130`) — 계약 형태 유지 |
| Q7 | AI 출력 ↔ 저장 | 통과 | 1단계 zod `requirement/category/importance/sentence_refs` ↔ 프롬프트 문구 일치. 결과 `requirement_matches[].{item_key: requirement_matches.M{n}, requirement_id: M{n}, requirement{content,category,importance,sentence_ids}}`, 결과 안 evidence 없음(DB `insight_payload_valid`가 다시 거부). 인용 문장마다 `jd_sentence` 행(quote = 문장, 2000자 자름, locator `{sid,start,end}`). `read.ts`(v2: 결과의 requirement, v1: `jd_requirements`) ↔ `applications-real.ts normalizeInsightResult` ↔ `insight-parse.ts requirementsByIdFrom` ↔ `insight-tab.tsx` 일치. 부분 결과(`partial.ts`)도 v2 `requirement` 사용 |
| Q8 | enum DB ↔ TS | 통과 | DB `ai_jobs_job_type_check` = `AI_JOB_TYPE_CHECK_VALUES`(legacy `jd_extraction` + 실행 가능 8개, 순서 동일), `error_code` CHECK = `AI_ERROR_CODES` + `LEGACY_AI_ERROR_CODES`(`not_a_jd`), `ai_usage_records.feature` = `USAGE_FEATURES`(`jd_extraction` 유지), `evidence_links.source_type`에 `jd_requirement`·`jd_sentence` 유지. 자동 대조 테스트는 없음(수동 대조) |
| Q9 | AI 잡 종료·사용 기록 | 통과(경미 이슈) | insight: prepare 호출 없음 → match 1회 → synthesize → (regen) → validate. 재시도 예약·타임아웃·취소·stale_run·JD 원문 변경(`insight.jd_text_changed` → stalled)·`begin_insight` 거부·옛 체크포인트(`{batches}`, `jdTextHash` 없음) → stalled 각각 테스트 있음(`job.test.ts:202-389`). 과거 `jd_extraction` 큐 잡 → 정의 없음 → `stalled`(`runner.ts:471-473`), 재시도 409(`runner.ts:285`). 과거 행 처리의 빈틈 → QA-02, QA-03 |
| Q10 | 보안·로그 | 통과 | 새 테이블 없음. `create_application_project` definer·`search_path=''`·`auth.uid()` 소유 확인, 실행 권한 authenticated·service_role만(app_ai_writer·anon 불가 — DB 조회로 확인). `begin_insight`에 `jd.user_id = v_uid` 추가. 새 로그 3개는 jobId·stage·raise 이름만. 새 env·비밀 없음 |
| Q11 | UI ↔ 백엔드 | 통과(경미 이슈) | `pnpm build`는 api notes 기준 성공(이번 라운드 `--build`는 안 돌림). `types/db.ts`의 낡은 타입 → QA-04 |
| Q12 | 실제 의존성 배선 | 통과 | `jobs/insight.ts` = `createAi02InsightPipeline(consoleAiLogger)` + `createInsightStore`, `definitions.ts:9`에 등록. 라우트·액션 모두 `productionInsightPipeline` 사용(start·read 같은 빌더 → 해시 비교 일관). jd_extraction 정의·크론 호출 제거 확인 |
| Q13 | 릴리스 준비 | 통과 | 원격(`list_migrations`) 마지막 `20261113004700` → 새 파일 `20261113004800` 정렬 OK. 비파괴(행·컬럼·CHECK 값 삭제 없음, 함수·트리거만 삭제)라 `-- DESTRUCTIVE:` 불필요. 2단 초안은 `supabase/migrations/` 밖. 새 env 없음 |

추가 확인:
- prompt_version → input_hash: AI-02 `computeInsightInputHash`가 `AI02_PROMPT_VERSION`(`ai-02.match.v6+ai-02.synthesize.v6+common.v5`)과 `INPUT_HASH_VERSION 3`을 넣는다 → 과거 결과 재사용 안 됨(의도). `computeInputHash`를 쓰는 기능은 AI-02뿐.
- AI-04 컨텍스트: `buildJdContext`가 모든 문장을 S-n으로 넣고 `jdTextHash = raw_text_hash`. `loadDocumentInputs`는 `extraction`·요건 행을 더 읽지 않음. AI-12 `<gate_requirements>`·`loadGateRequirements` 제거 확인.
- `position_title`은 input_hash에 안 들어가지만, 이제 바꾸는 경로가 없어(apply_jd_extraction 삭제) 문제 없음.
- 문장 0개 공고: 인사이트를 막지 않음(`[가정 R17-api1]`), 빈 `requirement_matches`로 저장.

## 이슈

### QA-01 [Minor] 삭제된 RPC의 raise 코드 매핑이 남음 (Q4 죽은 코드)
- 담당: api-engineer
- 근거: `src/server/db/errors.ts:112-114,118,145,240` — `already_extracted`, `extraction_in_progress`, `user_edited_requirements_exist`, `jd_not_extracted`, `invalid_extraction_result`. 로컬 DB의 `public`·`private` 함수 본문 전체에서 이 문자열을 raise하는 함수 없음(`begin_insight`의 `jd_not_extracted`는 주석). 같은 맥락으로 `src/server/db/errors.test.ts:65`의 "create_application_project gate key_invalid / ai_consent_required → 409 (Q53-1)"는 R17-9로 없어진 게이트를 설명하는 테스트 이름(코드 자체는 다른 RPC가 여전히 raise하므로 매핑은 유지).
- 재현: `psql … -Atc "select string_agg(prosrc, E'\n') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')" | grep -c "'already_extracted'"` → 0 (나머지 4개도 0).
- 수정 제안: 5개 매핑 삭제(또는 phase-2까지 남긴다면 "R17 legacy" 주석), 테스트 이름에서 create_application_project 언급 제거.
- 상태: 열림

### QA-02 [Minor] 과거 `not_a_jd` 잡 행: 화면 판정과 재시도 판정이 어긋나고 상태 응답 `message`가 빠짐
- 담당: api-engineer
- 근거:
  - `src/server/services/insight/read.ts:243` — 모르는 코드(과거 insight 잡의 `not_a_jd`, D-30 선행 추출 실패로 생긴 행)는 `stalled`로 바뀌어 C-20에 "중단됨 + 다시 시도"(system)로 보인다.
  - `src/lib/contracts/ai.ts:57` + `src/server/jobs/runner.ts:280` — 같은 행의 재시도는 `errorCategoryOf("not_a_jd") → "input"`이라 409 `ai_job_not_retryable`. 사용자가 누르는 "다시 시도"가 항상 거부된다.
  - `src/server/jobs/status.ts:64` — `GET /api/ai-jobs/{id}`가 그 행에 `error: { code: "not_a_jd", category: "input", message: undefined }`를 돌려준다. `AiJobStatusResponseSchema`(`contracts/ai.ts:178`, `message: z.string()`, code는 `AiErrorCodeSchema`)와 어긋남.
- 재현: 로컬에서 insight 잡 행 하나를 `status='failed', error_code='not_a_jd', finished_at=now()`로 넣고(서비스 롤) `getInsight` → `lastFailure.code === "stalled"`, 같은 id로 `runner.retryJob` → 409; `toAiJobStatusResponse(record)` → `AiJobStatusResponseSchema.parse` 실패.
- 수정 제안: 한 규칙으로 맞춘다. 예) `read.ts toFailure`와 `status.ts`에서 legacy 코드를 `input_too_long`처럼 input 범주의 표시 코드로 바꾸거나(재시도 버튼 없음), `AI_ERROR_MESSAGES`에 legacy 문구를 별도 표(`LEGACY_AI_ERROR_MESSAGES`)로 두고 status 응답에서 code를 `stalled`/input 대체값으로 정규화. 테스트 1개(legacy 행 → 화면·재시도·상태 응답 일관).
- 상태: 열림

### QA-03 [Minor] R17 이전 실패 insight 잡의 "다시 시도"는 항상 `stalled`로 끝남
- 담당: api-engineer
- 근거: 수동 재시도는 step_outputs를 유지하고(QA-S6-01) 재개한다. 옛 prepare 체크포인트에는 `snapshot.jdTextHash`가 없어 `src/server/services/insight/job.ts:140`에서 곧바로 `stalled`. 재시도는 409가 아니라 받아들여진 뒤 실패하므로, 원격에 남은 R17 이전 실패 잡(90일 보존)마다 "다시 시도 → 또 중단됨"이 된다. 노트 `[가정 R17-api2]`는 진행 중 잡만 다룬다.
- 재현: 과거 형태 prepare 출력(`{insightId, snapshot:{careerSnapshotHash, requirementsHash}}`)을 가진 failed insight 잡을 만들고 `retryJob` → 수락 → 실행 → `failed/stalled`.
- 수정 제안: insight 정의에 `retryBlocked`(prepare 체크포인트에 `jdTextHash` 없음 → 409 `ai_job_not_retryable`, 화면은 "다시 생성")를 두거나, 재시도 시 옛 체크포인트를 버리고 prepare부터 돌린다. 테스트 추가.
- 상태: 열림

### QA-04 [Minor] `src/types/db.ts`의 생성 거부 코드 타입이 R17-9와 어긋남
- 담당: api-engineer (R17에서 `types/db.ts`를 고친 쪽)
- 근거: `src/types/db.ts:1274-1275` `ApplicationCreateRefusalCode = "ai_consent_required" | "key_invalid"` + 주석 "⑥ create_application_project … HTTP 409". DB는 더 이상 던지지 않고 `CREATE_APPLICATION_ERROR_CODES`(`contracts/application.ts:50`)에서도 빠짐. 사용처 없음(죽은 타입).
- 수정 제안: 타입 삭제 또는 legacy 주석. UI 소유 파일이면 UI 요청 목록에 추가.
- 상태: 열림

### QA-05 [Minor, R17 범위 밖 기존 결함] AI-04 인사이트 신호의 포지셔닝이 항상 null
- 담당: api-engineer
- 근거: `src/server/services/writing-chat/pipelines.ts:402`가 `result.positioning`(최상위)을 읽지만 저장 결과는 `result.strategy.positioning`(`ai/storage/insight.ts` `InsightResult`, ai notes 인터페이스 §4). api notes "관찰"에도 적힘.
- 수정 제안: `obj(r.strategy).positioning`을 읽고 테스트 1개. R17과 따로 처리해도 됨.
- 상태: 열림

## 잔여 grep 판정

`grep -rnE "jd_requirements|REQ-|jd_extraction|jd_preview|not_a_jd|p_preview_job_id|extract-preview|requirements_hash|requirementsHash" src supabase/tests` (`database.types.ts` 제외) — 90개 파일. **버그로 분류된 잔여는 QA-01(죽은 매핑, 이 grep 밖)과 QA-02(legacy `not_a_jd` 처리)뿐. 나머지는 모두 의도된 잔여.**

| 분류 | 위치 |
|------|------|
| DB CHECK 거울·legacy enum | `lib/contracts/enums.ts`(LEGACY_AI_JOB_TYPES, USAGE_FEATURES `jd_extraction`, `jd_requirements` category/importance/origin), `lib/contracts/errors.ts` LEGACY_AI_ERROR_CODES, `lib/contracts/ai.ts:56`, `types/db.ts`(AiJobType/AiErrorCode/AiUsageFeature, JdRequirement, InsightResult v1/v2 주석), `server/ai/errors.ts:185-189` |
| 보존 테이블 읽기(v1 인사이트·legacy 근거 칩) | `server/services/insight/{db,read,requirements}.ts`, `server/services/evidence/index.ts:58`, `lib/data/{applications-real,evidence-real,evidence}.ts`, `lib/contracts/insight.ts`, `components/applications/{insight-parse.ts,cover-letter/insight-tab.tsx}` |
| `update_failed_jd_raw_text` 거울(R17-6, RPC 그대로) | `server/services/application/read.ts:170-252`, `lib/data/applications.ts:390-392`, `lib/data/jd-raw-text.ts` |
| legacy 잡 제외 필터 | `server/services/{shell,ai-jobs}/index.ts`, `lib/data/{shell,ai-jobs,applications}.ts` |
| legacy 사용량 라벨 | `lib/data/{usage-display,labels}.ts` "채용 공고 분석(이전)" |
| 산문 별칭 가드·legacy 근거 규칙 | `server/ai/evidence-rules.ts:66`(REQ-n → V-1에서 떨어짐), `server/ai/validation/alias-text.ts`, `insight-parse.ts:55-59` |
| R17 설명 주석 | `server/ai/{input-hash,context-pack/jd,context-pack/cover-letter-chat,pipelines/AI-02,schemas/AI-02,storage/insight,prompts/common,prompts/AI-02}.ts`, `server/jobs/{runner,cron,cost}.ts`, `server/services/application/db.ts`, `app/api/ai-jobs/[id]/retry/route.ts`, `lib/contracts/application.ts:20`, `lib/preview-state.ts`, `lib/data/account.ts` |
| mock·dev 갤러리·과거 행 표시 UI (UI 소유, api notes UI 요청 5·6·7·8·10) | `lib/mock/{fixtures,ai}.ts`, `lib/data/deletion.ts`(mock), `components/common/{ai-error-notice,ai-progress,dev-state-gallery,dev-state-gallery-v53}.tsx`, `components/applications/insight-view.tsx`, `lib/routes.ts`, `lib/data/ai-errors.ts` |
| 테스트(부재·legacy 단정, legacy 행 셋업) | `supabase/tests/*`(r17, update_failed_jd_raw_text, grants, insights, s5/s6, retention_purge, r15_*, account_deletion 등), `src/**/*.test.ts`, `server/services/account/__fixtures__/all-slices.sql` |

## 릴리스 메모 (이슈 아님)

- `db push` 직후 같은 PR 배포(계획 §6). 그 사이 옛 코드의 공고 추가(10인자)는 실패한다.
- 원격 읽기 전용 사전 확인 권장: `select count(*) from ai_jobs where job_type='jd_extraction' and status in ('queued','running')` (새 러너가 `stalled`로 끝냄 — 트리거가 없어 오류는 없음).
- R17 이전에 "키 있음·기업명 없음"으로 만든 프로젝트는 `name`이 null로 남아 추출이 이름을 채우지 않는다. 화면은 "새 자기소개서"로 보여 주므로 깨지지 않음. 원하면 2단에서 `application_fallback_name`으로 백필.

## 스펙 차이 (spec-gaps.md로 넘길 항목)

`_workspace/backend/spec-gaps.md`에 아직 R17 절이 없고 계획이 말한 `R17/spec-gaps-R17.md`도 없다. 계획상 리더 기록 대상이라 QA는 쓰지 않았다. 기록할 항목:
1. `[가정 R17-9]` 생성 게이트 제거 ↔ DM 2.7.1 / 2.11.7 경로 ⑥(Q53-1).
2. `[가정 R17-6]` 새 공고는 원문 수정이 항상 `jd_raw_text_locked` — 원문 수정 허용 규칙 미정.
3. `[가정 R17-4]` AI-12 게이트 대화의 JD 조향 블록 제거(원문 대체 여부).
4. `[가정 R17-5/AI-1/AI-3]` AI-02 v2 결과 형태(`M{n}`, 상한 20, 0개 허용)와 `staleReasons.requirements`의 의미 변경("JD 원문 바뀜", v1은 항상 true).
5. `[가정 R17-10]` AI-04 `requirement_ids` 항상 `[]`.
6. AI-02·AI-04가 공고 전체 문장을 받으므로 C-2 토큰 상한(8k 토큰 [가정])과 비용 추정 재검토.

## 다음

- 라운드 1 열린 이슈: Critical 0, Major 0, Minor 5 (QA-01~05). 모두 머지 차단 사유 아님. QA-02·QA-03은 원격의 과거 행에서만 드러난다.
- 수정 후 재확인: QA-01~04는 해당 파일 diff와 테스트로, 전체 검사 재실행.

---

# R17 백엔드 QA 리포트 (라운드 2)

- 작성: backend-qa, 2026-11-14
- 근거: `02_api_notes.md` "QA 1라운드 수정", 작업 트리 diff(`contracts/ai.ts`, `jobs/status.ts`, `db/errors.ts`, `types/db.ts`, `services/insight/{job,read}.ts`, 테스트)
- 코드는 고치지 않았다. 커밋하지 않았다.

## 검사 실행 결과 (`run-checks.sh --build`)

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | 오류 0 |
| lint | 통과 | 경고·오류 0 |
| Vitest | 통과 | **157 파일, 2624 테스트**(1라운드 대비 +4, QA-02/03 테스트), 건너뜀 0 — 통합 테스트 포함 |
| build (`pnpm build`) | 통과 | |
| pgTAP | 통과 | **66 파일, 2613 단정** (DB 변경 없음) |

## 이슈 재확인

| 이슈 | 확인 | 상태 |
|------|------|------|
| QA-01 죽은 raise 매핑 | `db/errors.ts`에서 5개 메시지 + `invalid_extraction_result` 별칭 삭제, R17 주석. `errors.test.ts` 테스트 이름 정리. 남은 매핑 키를 로컬 DB 함수 본문과 다시 대조 → raise하지 않는 R17 관련 키 없음 | 수정됨(확인 완료) |
| QA-02 legacy `not_a_jd` 행 | 규칙 하나로 통일: `errorCategoryOf("not_a_jd") = input`(DB 생성 컬럼 `error_category`의 `not_a_jd → input`과 일치, 로컬 DB에서 확인), `failureCauseOf = null`, `isManuallyRetryable = false` → 러너 재시도 409(`runner.ts:280`). `status.ts:73` `jobErrorMessageOf`로 문구를 채우고 `AiJobErrorSchema.code = JobErrorCodeSchema`(현재 + legacy)라 `AiJobStatusResponseSchema` 통과. `insight/read.ts:243-246` `toFailure`가 `{code: not_a_jd, category: input, retryable: false, 전용 문구}`. 화면·상태 응답·재시도가 모두 "input, 재시도 없음". SSE `ErrorEvent`는 좁은 그대로(새 실행은 이 코드를 만들지 않음). 모르는 코드의 기본 범주는 `system`(DB 생성 컬럼의 else와 같은 쪽). 테스트: `job.test.ts:411`, `read.test.ts:180` | 수정됨(확인 완료) |
| QA-03 R17 이전 실패 insight 잡의 재시도 | `insight/job.ts:114` `hasPreR17Checkpoint`(prepare 스냅숏에 `jdTextHash` 없음 또는 match 출력에 `matches` 배열 없음) → 정의 `retryBlocked`(`job.ts:305`) → 러너 `runner.ts:288` 409. `status.ts` `retryBlockedByCheckpoint`가 기본 인자로 들어가 `canRetry: false`, `retry: null` — 유일한 호출부 `app/api/ai-jobs/[id]/route.ts:27`가 인자를 넘기지 않으므로 적용됨. R17 이후 잡(prepare 출력에 `jdTextHash` 있음, 또는 prepare 전 실패)은 막히지 않음. 테스트: `job.test.ts:432-450`. "다시 생성"(새 잡)은 그대로 | 수정됨(확인 완료) |
| QA-04 낡은 거부 코드 타입 | `types/db.ts`의 `ApplicationCreateRefusalCode` 삭제, R17 주석. 사용처 없음(typecheck·build 통과) | 수정됨(확인 완료) |
| QA-05 AI-04 포지셔닝 신호 null (R17 범위 밖) | 의도적으로 미수정(리더 결정: 후속 작업) — `writing-chat/pipelines.ts:402` 그대로 | 미해결(범위 밖, 리더 인계) |

## 잔여 grep 재실행

같은 패턴, `database.types.ts` 제외 → 93개 파일(1라운드 90 + 3). 늘어난 것은 QA-02/03 수정에 따른 legacy 코드 표(`contracts/ai.ts` `LEGACY_AI_ERROR_MESSAGES`, `JobErrorCodeSchema` 주석), `insight/read.ts:243` 주석, 그리고 legacy 행 단정 테스트(`job.test.ts`, `read.test.ts`, `support.test.ts`)뿐. 모두 의도된 잔여(legacy 행 처리·테스트). **버그로 분류된 잔여 없음.**

## 최종 판정

- 열린 이슈: **Critical 0 / Major 0 / Minor 0** (R17 범위). 범위 밖 Minor 1건(QA-05)은 리더에게 후속으로 넘긴다.
- 모든 검사 통과(typecheck, lint, Vitest 2624, build, pgTAP 2613). R17 슬라이스는 백엔드 QA 기준으로 머지 가능.
- 남은 일(코드 밖): `spec-gaps.md` R17 절 기록(1라운드 "스펙 차이" 6항목), 릴리스 메모(`db push` 직후 배포, 원격 `jd_extraction` queued/running 잡 수 읽기 전용 확인).
- `[가정 R17-api8]` 옛 insight 잡을 prepare부터 다시 돌리려면 `retry_ai_job`에 재시작 인자가 필요(DB 변경) — 지금은 재시도를 막고 "다시 생성"으로 안내. 기능 요구가 생기면 db-engineer 후속.

---

# 정렬 라운드 1 (2026-11-16)

- 작성: backend-qa, 2026-11-16 · 대상: 커밋 안 된 정렬 변경(기획 PR #77 — decisions 3.29·4.24, DM v4.16 11.11, AI v4.16 0.v416) vs HEAD `8542ae6`
- 근거: `01b_plan-align.md`, `02_db_notes.md` "정렬 (2026-11-16)", `02_ai-pipeline_notes.md` "정렬 인터페이스", `02_api_notes.md` "정렬 (2026-11-16)", `release-counts.md`, `git diff HEAD`
- 코드는 고치지 않았다. 커밋하지 않았다. 원격에는 아무것도 하지 않았다.

## 이전 라운드 이슈 재확인

| 이슈 | 확인 | 상태 |
|------|------|------|
| QA-01~04 | 정렬 diff에서 되살아난 것 없음(`db/errors.ts`에 폐기 코드 매핑 없음 — 마이그레이션 B의 raise 코드 30개 전부 매핑 대조, 남은 `invalid_reason`은 내부 `delete_account_data` 전용) | 수정됨 유지 |
| QA-05 AI-04 포지셔닝 null | `8542ae6` + 정렬: 저장 `storage/insight.ts:197` `result.strategy.positioning` → 조회 `writing-chat/pipelines.ts:388-407`(insights.result 그대로) → 읽기 `context-pack/insight-result.ts:51-55` `strategy.positioning` → 프롬프트 `cover-letter-chat.ts:470` "지원 방향: …". 테스트 `cover-letter-chat.test.ts:56`. **경로는 맞다** — 다만 저장 → 읽기 왕복 테스트는 없다(QA-08) | 수정됨(확인 완료) |

## 검사 실행 결과 (`run-checks.sh --build`, 로컬 `supabase db reset` 직후)

| 검사 | 결과 | 비고 |
|------|------|------|
| `supabase db reset` | 통과 | `…004700` 뒤 A `…004800_r17_jd_raw_text_cleanup` → B `…004810_r17_jd_raw_text_rpcs` → C `…004820_r17_drop_jd_extraction` 오류 없이 적용, seed 적용 |
| typecheck | 통과 | 오류 0 |
| lint | 통과 | 경고·오류 0 |
| Vitest | 통과 | **159 파일, 2660 테스트**, 건너뜀 0(통합 테스트 14파일 포함 — 로컬 스택 대상) |
| build (`pnpm build`) | 통과 | |
| pgTAP | 통과 | **65 파일, 2648 단정** |
| 타입 | 통과 | 고정 CLI로 `gen types --local` 다시 만들어 `database.types.ts`와 diff → 동일 |
| 로컬 스모크 | 통과(통합 테스트 경로) / `pnpm dev` HTTP 스모크는 SKIP | 아래 |

### 로컬 스모크 (실제 Server Action·서비스·RPC 경로, 127.0.0.1:54322)

`w3.integration.test.ts`(실제 `lib/data` → Server Action → 서비스 → RPC, LLM·연결만 대체), `application/insight/document-chat/writing-chat/runner` 통합 테스트를 `--reporter=verbose`로 다시 돌려 56개 통과 확인:
- 생성 + 자동 시작(#10): 키 없음 → `insight_skip_reason: ai_not_connected`, 작업 없음 / 동의 철회 → JD는 저장, `consent_required`(#9 게이트 없음) / 키·커리어 있음 → `insight_job_id` 반환, 작업 `succeeded`, `ai_usage_records` `feature = insight` 2행(#20) / 이름 "{회사명} 자기소개서"(`user`), 없으면 "새 자기소개서 (YYYY-MM-DD)"(`default`) — DB 함수 직접 호출로도 확인
- 0문장 원문 → `jd_no_sentences` 400, 행 없음
- `update_jd_raw_text`: 판정 순서, 인사이트 작업 중만 잠김(자소서 턴은 안 잠김), 거부 코드 → 화면 코드 매핑
- 인사이트: 단계 1 한 호출 → v2 저장(`raw_text_hash` = JD 해시, `match_stage_result {prompt_version, items}`, `step_outputs.match.latencyMs`), 재사용, 원문 수정 → `staleReasons.rawText` true / 되돌리면 false, schema 1 행 → 본문 없음·재사용 안 함, `autoStartInsight` 실제 DB
- 실패 경로(공급자 없이): readiness 미달 → `insufficient_data`, 작업 없음 / 키 없음 → 자동 시작 건너뜀 / `rate_limited` 스케줄 / 수동 재시도
- `pnpm dev`로 HTTP 엔드포인트를 직접 친 스모크는 **하지 않았다**(SKIP — 위 통합 테스트가 같은 액션·서비스·실제 의존 팩토리를 탄다. `/api/job-descriptions/fetch`는 외부 네트워크가 필요해 단위 테스트만).

## 마이그레이션 A·B·C 검토 (Q1·Q13)

| 항목 | 결과 |
|------|------|
| `-- DESTRUCTIVE:` 머리 | A 1행(근거 행·대화 출처 삭제, 작업 출력 비움, 해시 덮어씀), B 1행(public RPC drop), C 1행(테이블·8컬럼·CHECK 값) — 3개 모두 |
| 순서 | A: 집계 notice → 트리거 `ai_jobs_release_jd_extraction` drop(`…004800:53`) → 정리 함수(취소 → 미리 보기 출력 → 이름 백필 `application_default_name`(`:112`) → 근거 삭제(`:117`) → 대화 출처 제거) → rename(`:156`, ready CHECK 재생성). B: 추출 RPC·헬퍼 drop → 생성 RPC → **가드 교체(`…004810:151`)** → `update_jd_raw_text` → 허용 목록 → 인사이트 RPC(**rename된 `raw_text_hash` 사용**) → 인사 3종·`start_writing_chat`·`delete_account_data`. C: drop(`…004820:11·20`) → CHECK(`:33`) → 단언(`:86`). **가드 교체가 컬럼 drop보다 먼저, rename이 RPC보다 먼저** — 맞음 |
| 최종 단언 | `private.r17_jd_raw_text_assert()` — DM 11.11 8단계 5항목 그대로, 어기면 `P0001 r17_assert_failed`(파일 한 트랜잭션 → C 롤백). pgTAP `r17_jd_raw_text.test.sql`이 정리 전 실패·후 통과·조건별 실패를 단정 |
| 집계 10항목 | A의 notice ①~⑩ = `release-counts.md` SQL = DM 11.11 0단계 목록(항목·순서 일치). `jsonb_path_exists('strict $.** ? (…)')`과 `private.r17_strip_jd_sources`를 깊은 중첩·비객체 원소 섞인 값으로 직접 실행해 감지·제거 확인 |
| 죽은 참조 | 적용 뒤 `public`·`private` 함수 본문에서 `extraction_status|jd_requirements|tech_keywords|extraction_job_id|extraction_provider|detected_language|requirements_hash|jd_sids_|jd_preview|p_preview_job_id` 검색 → 일회성 정리·단언 함수와 주석뿐 |
| 남긴 과거 값(#8) | `ai_jobs_job_type_check`·`ai_usage_records_{job_type,feature}_check`의 `jd_extraction`, `ai_jobs_error_code_check`의 `not_a_jd`, `ai_jobs_jd_extraction_check`(두 분기) 그대로. `evidence_links_source_type_check` = `profile, experience, education, project, project_deliverable, skill, jd_sentence, user_note` |
| 파일 순서 | 세 파일 모두 `…004700`(원격 마지막, notes 기준) 뒤. 새 env 없음 |
| 레거시 행 위 적용 | 직접 재현은 하지 않았다 — db-engineer의 일회 확인(`db reset --version …004700` → 레거시 시드 → `migration up`)과 pgTAP 정리 함수 단정(135개)을 근거로 둔다. 영향 테이블 트리거(`ai_jobs_guard_status`, `writing_chats_guard`, `insights_set_updated_at`)를 읽어 A의 update가 걸리지 않음을 확인 |

## 경계면 검사

| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM 11.11 ↔ 마이그레이션 | 통과 — (1)~(4) 객체·단계 전부 대응. 이름 `r16` → `r17`은 `[가정 R17b-db-12]` | — |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과 — 타입 재생성 동일. `getJdView`·`loadInsightInputs`·`loadDocumentInputs`·`loadGateGaps`의 select 컬럼이 모두 존재 | — |
| Q3 | RPC ↔ 호출 | 통과 — `create_application_project` 9인자(`write.ts:64-74`) ↔ B:37, 반환 5키 읽기(`write.ts:76-`). `update_jd_raw_text` 4인자(`write.ts:104-109`) ↔ B:180, 반환 3키. `complete_insight` `{applied, reason}` ↔ `insight/db.ts:114`, `stale_run` → `job.ts:314` `AiError("canceled")`. `start_writing_chat` params ↔ `chat.ts:71`(그대로 전달) ↔ UI `insight-view.tsx:417·430` `{insight_id, insight_item_key: g.item_key}` ↔ B:855-860 패턴 `^gaps\.[0-9]{1,2}$` ↔ 저장 키 `gaps.{n}` | — |
| Q4 | raise ↔ 매핑 | 통과 — B의 raise 30종 매핑 존재, 폐기 4종(`jd_has_results`·`jd_raw_text_locked`·`jd_failure_not_input`·`jd_not_extracted`) 매핑 없음. `jd_no_sentences` 400(생성·수정) / 인사이트 시작은 서비스가 먼저 409(`start.ts:52`) — `[가정 R17b-api-1]` | — |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 | 통과 — 생성 응답 `insightJobId`·`insightSkipReason`(이유 7종 = DM 2.6.2 목록·순서) → `applications-real.ts:117` → UI 액션 `insight_job_id`·`insight_skip_reason`. `JdView.rawTextEditable`·`rawTextLockedReason`(`read.ts:172-199`, 판정 = RPC 조건 3과 같은 쿼리). fetch `{rawText}`(`fetch.ts:820`, `jd-fetch.ts:73`). `InsightResultView.schemaVersion`·`staleReasons.{career, rawText}`(`read.ts:111·199-201·352`). 칩 "변경됨" 규칙만 어긋남 | QA-06 |
| Q6 | SSE | 해당 없음(이벤트 이름·모양 변경 없음. 진행 단계 값 그대로) | — |
| Q7 | AI 출력 ↔ 저장 | 통과 — `CompleteInsightPayload`(MT-n·`match_key(s)`·`requirement_text`·`sids`·`strategy.positioning`) ↔ `insight_payload_valid`(B:399, `hashes.raw_text_hash`, `schema_version` 2, 결과 안 evidence 금지, 근거 = insight 허용 목록) ↔ 조회 `read.ts:119-209` ↔ UI `insight-parse.ts`(`match_key → requirement_text`, `{prompt_version, items}`). 요건 행 근거는 커리어만, `jd_sentence`는 단계 2 항목에만 — 저장 함수가 요구하지 않음(pgTAP `:597`) | QA-08(테스트) |
| Q8 | 열거 DB ↔ TS | 통과 — `AI_JOB_TYPE_CHECK_VALUES`(9) = DB, `USAGE_FEATURES`(8) = DB, `EVIDENCE_SOURCE_TYPES`(8) = DB CHECK, `EVIDENCE_ALLOWED_SOURCE_TYPES`(`enums.ts:274-277`) = `private.evidence_allowed_sources`(B:268) = AI-04 `AI04_EVIDENCE_SOURCE_TYPES`(`cover-letter-chat.ts:415`, `jd_sentence` 없음, V-1 거부 테스트 `AI-04.test.ts:104`), `AI_ERROR_CODES` + `LEGACY_AI_ERROR_CODES` = DB `error_code` CHECK | — |
| Q9 | 작업 종료·사용량 | 통과(1건 제외) — 자동 시작은 수동과 같은 `startInsight` → 러너 사용량 그대로(w3 2행). `stale_run` → `canceled`, 이미 한 호출 사용량 남음(`job.test.ts`). 원문 수정 뒤 옛 실패 작업의 재시도 경로만 `stalled` 반복 | QA-07 |
| Q10 | 보안·개인정보 | 통과 — `update_jd_raw_text`는 `authenticated`만(anon·service_role 회수, pgTAP grants·r17). definer RPC 전부 `search_path = ''`·`auth.uid()`/`current_uid()` 소유 검사. 새 파일(`auto-start.ts`·`gate-gaps.ts`·`insight-result.ts`)에 `console.` 없음, 로그는 id·코드만(`auto-start.ts:93·97`). AI-04는 JD `raw_text`·`sentences`를 읽지 않음(`pipelines.ts:388`) | — |
| Q11 | UI ↔ 백엔드 | 통과(UI 소유 잔여는 UI 요청) — `types/db.ts` `JdRawTextRefusalCode`·`InsightSkipReason`·`EvidenceSourceType` = 계약. build 통과. UI 쪽 남은 것: `question-proposal-card.tsx:274` `jd_requirement` 칩 분기, `jd-raw-edit.tsx:315` 미리 보기 `jd_raw_text_locked`, `ai-progress.tsx:145` `jd_extraction`, `ai-error-notice.tsx`의 `not_a_jd`(과거 행이라 정당) — api notes UI 요청 U2·U5·U6로 넘어가 있음 | — |
| Q12 | 실제 의존 연결 | 통과 — 생성 액션(`actions/application.ts:55-65`)이 `connections().context`·`createAppJobRunner(getSiteOrigin())`·`productionInsightPipeline`를 넘김(수동 시작 액션과 같은 팩토리). 같은 `id` 재호출(`created: false`)은 자동 시작 안 함(`:54`) | — |
| Q13 | 릴리스 준비 | 통과 — 위 표. 원격 push는 사용자, `release-counts.md` "주의"(A~B 사이 옛 `complete_insight` 실패 가능, push 직후 코드 배포) 확인 | — |

검증 규칙: AI-02 단계 1 서버 검증 1~6(`requirement_text` ≤ 120 `validation/insight.ts:108`, `sids` 1~5, 최대 15, 0개 → 1회 재호출 → `schema_invalid`)과 AI-04 `jd_sentence` V-1 거부, AI-12 `<gate_gaps>` 출처 아님(`AI-12.gate.test.ts`) 각각 테스트 있음.

프롬프트 버전(AI 0.v416 표 ↔ `src/server/ai/prompts/`): `common.v5`, `ai-02.match.v6`·`ai-02.synthesize.v6`, `ai-04.generate.v7`·`adjust.v7`·`extract.v2`·`reply.v2`, `ai-12.extract.v7`·`ai-12.reply.v8`, AI-13 번호 그대로 — **전부 일치**(`ai-04.extract.v1`·`ai-02.match.v1` 등 문자열은 주석 속 이력뿐). `prompt-versions.test.ts`가 표를 단정.

## 이슈

### QA-06 [Minor] 인사이트의 `jd_sentence` 근거 칩이 `staleReasons.rawText`를 따르지 않음
- 담당: api-engineer
- 근거: DM v4.16 2.6.1 "stale 판정"(그 인사이트의 `jd_sentence` 칩 "변경됨"도 `rawText` 하나로 — 원문 강조 금지), 2.7.0, 11.11 (5) "근거" 행(`services/evidence/`) ↔ `src/server/services/evidence/index.ts:110` `else if (type === "jd_sentence") state = "current";`, `src/server/services/insight/read.ts:114` `chipsOf`가 칩 상태를 그대로 넘김(`:352`에서 `rawText`를 계산하지만 칩에 반영하지 않음). mock `src/lib/data/evidence.ts:194`도 같음
- 재현: 인사이트 생성(단계 2 항목에 `jd_sentence` 근거) → `update_jd_raw_text`로 원문 수정 → `getInsight` 응답 `staleReasons.rawText = true`인데 같은 응답의 `jd_sentence` 칩 `state = "current"` + 옛 `sid`·오프셋 → 화면이 새 분할에 옛 오프셋을 강조
- 수정 제안: `read.ts`에서 `ctx.stale.rawText`면 `jd_sentence` 칩을 `changed`로(문구·강조 끄기는 UI U3) 내리고 테스트 추가. UI에서만 처리하기로 하면 DM 11.11 (5)와 어긋나므로 leader가 spec-gaps에 남긴다
- 상태: 열림

### QA-07 [Minor] 원문 수정 전에 실패한 인사이트 작업을 재시도하면 매번 `stalled`
- 담당: api-engineer
- 근거: `src/server/services/insight/job.ts:174-185` `contextFor` — prepare 스냅숏 `rawTextHash` ≠ 현재 JD 해시면 `systemFailure()`(`:143`, `stalled`). 재시도 차단 `retryBlocked`(`:328`)·`status.ts:12`는 `hasPreR17Checkpoint`만 보고 해시 변화는 보지 않음. `update_jd_raw_text`는 실패·취소 작업을 막지 않으므로(B:229-234, 정상) 이 상태가 생긴다. DM 2.6.1은 해시 불일치를 `stale_run` → `canceled`로 정했다. 화면은 `read.ts:235·242` `isFailureBeforeRawTextEdit`로 그 실패를 숨겨 S-16 버튼으로는 안 닿지만, `GET /api/ai-jobs/{id}`는 `canRetry: true`를 주고 `POST /api/ai-jobs/{id}/retry`는 받는다
- 재현: 인사이트가 단계 2에서 최종 실패(예: `provider_unavailable`) → 원문 수정(성공) → `POST /api/ai-jobs/{jobId}/retry` → synthesize의 `contextFor` 불일치 → `stalled`. 다시 재시도해도 같은 결과(사용자에게는 시스템 오류)
- 수정 제안: `retryBlocked`에서 prepare 스냅숏 해시를 현재 JD 해시와 비교해 409(`ai_job_not_retryable`, "다시 생성" 안내), 또는 불일치를 `AiError("canceled")`로 끝내 `stale_run`과 같게. 테스트 1개
- 상태: 열림

### QA-08 [Minor] AI-02 저장값 → AI-04·AI-12 읽기 왕복 테스트 없음 (QA-05 같은 결함을 못 잡음)
- 담당: ai-pipeline-engineer
- 근거: 읽기 쪽 테스트는 손으로 쓴 픽스처만 쓴다(`__fixtures__/S7/cover-letter-chat.ts:50` `insightResultV2()`, `AI-12.gate.test.ts`). 저장 쪽 `storage/insight.ts:112` `toCompleteInsightPayload`의 `result`를 `readInsightResultV2`/`selectGateGaps`/AI-04 `<insight>` 렌더로 넘겨 보는 테스트가 없다. 지금 경로는 정적으로 맞다(위 QA-05 재확인)
- 수정 제안: AI-02 파이프라인 픽스처의 `finalizeInsight(...).payload.result`를 `readInsightResultV2(2, result)`에 넣어 `strategy.positioning`·`gaps[].match_keys → requirement_text`·`requirement_matches`가 읽히고 AI-04 블록에 "지원 방향:" 줄이 나오는지 단정
- 상태: 열림

### QA-09 [Minor] 낡은 주석·테스트 이름 (동작 영향 없음)
- 담당: api-engineer(UI 파일 1개는 resumate-ui)
- 근거: `src/lib/contracts/errors.ts:31-32` "phase-2 narrows it"(2단 초안은 삭제, 4.24 #8은 `not_a_jd`를 영구 유지), `src/server/services/insight/insight.integration.test.ts:265` 제목 "jd_text_hash"(단정은 `raw_text_hash`), `src/server/services/application/application.integration.test.ts` 제목 "'회사명 – 포지션명'"(단정은 "가나다랩 자기소개서"), `src/lib/contracts/draft.ts:137·190` `jd_not_extracted`, UI `src/components/common/return-target.ts:18` insight params 설명 `{ gap_item_key, requirement_ids }`(실제 `{insight_id, insight_item_key}`)
- 수정 제안: 문구만 정리
- 상태: 열림

Critical 0 · Major 0 · Minor 4.

## 잔여 grep 판정

`grep -rnE "jd_requirements|jd_requirement|REQ-|jd_extraction|jd_preview|not_a_jd|p_preview_job_id|extract-preview|requirements_hash|requirementsHash|jdTextHash|jd_text_hash|update_failed_jd_raw_text" src supabase/tests` → **262줄 / 83파일**. 분류:

| 분류 | 위치(대표) | 판정 |
|------|-----------|------|
| 과거 CHECK 값 거울(#8) | `contracts/enums.ts:149·166·234`(`LEGACY_AI_JOB_TYPES`, `USAGE_FEATURES`), `contracts/errors.ts:34`(`LEGACY_AI_ERROR_CODES`), `types/db.ts:160-219` | 의도 |
| 과거 행 처리(표시·재시도 거부·진행 중 제외) | `contracts/ai.ts:57-63·165`, `server/ai/errors.ts:185-189`, `jobs/runner.ts:67·284`, `jobs/types.ts:76`, `services/ai-jobs/index.ts:40`, `services/shell/index.ts:32`, `insight/read.ts:250`, `lib/data/{ai-errors,jd-raw-text,shell,ai-jobs,applications,labels,usage-display}.ts`, `api/ai-jobs/[id]/retry/route.ts:19` | 의도 |
| R17 설명 주석 | `server/ai/{input-hash,evidence-rules,storage/insight,prompts/common,prompts/AI-02,pipelines/AI-02}.ts`, `db/errors.ts:163`, `jobs/{cron,cost}.ts`, `application/db.ts:9`, `contracts/{application,insight,evidence}.ts`, `lib/data/{evidence-real,deletion,applications-real,account}.ts` | 의도(`contracts/errors.ts:31` 문구만 QA-09) |
| 산문 별칭 가드 | `server/ai/validation/alias-text.ts:16`, `components/applications/insight-parse.ts:39·43`(`REQ-` 표시 가드) | 의도 |
| mock·UI 소유 | `lib/mock/{fixtures,ai}.ts`, `lib/data/evidence-real.ts:50`(`jd_requirements: []` mock 모양), `lib/data/deletion.ts:431`, `lib/data/applications.ts:414`, `components/common/{ai-error-notice,ai-progress,dev-state-gallery*}.tsx`, `components/applications/insight-view.tsx:246·263`, `cover-letter/question-proposal-card.tsx:274`, `lib/{routes,preview-state}.ts` | UI 요청 U2·U3·U5·U6·U9로 넘어감(백엔드 결함 아님) |
| 테스트 | `supabase/tests/*`(부재·legacy 거부·legacy CHECK 단정), `insight/job.test.ts`(옛 체크포인트 거부), `insight/read.test.ts`, `ai/**/*.test.ts`, `runner.test.ts`, `account/__fixtures__/all-slices.sql:66`(주석) | 의도(제목 1개만 QA-09) |

**살아 있는 코드가 지워진 DB 객체·라우트·RPC를 부르는 곳 없음.** 버그로 분류된 잔여 없음.

## 4.24 #1~#21 대조

| # | 할 일 | 판정 | 근거 |
|---|-------|------|------|
| 1 | `jd_requirements` drop | 완료 | `…004820:11`, pgTAP r17 스키마 끝 상태 |
| 2 | JD 8컬럼 + CHECK·FK·인덱스 drop | 완료 | `…004820:19-27` |
| 3 | 추출 RPC 5개·private 헬퍼·트리거·`jd_sids_valid` drop | 완료 | `…004800:53-54`(트리거·함수), `…004810:15-25`, `…004820:15`, `s6_lock_order.test.sql:10` |
| 4 | JD 근거 행·자소서 `jd_sentence`·대화 JD 출처 삭제 | 완료 | `…004800` 정리 함수, pgTAP r17 "step 3"·멱등 |
| 5 | CHECK에서 `jd_requirement` 제거 | 완료 | `…004820:32-35`, psql로 CHECK 확인 |
| 6 | 추출·미리 보기 API, 크론 purge 호출 삭제 | 완료 | `src/app/api/job-descriptions/`에 `fetch`만, `application-projects/[id]/`에 `insights`만, `jobs/cron.ts:37` 주석뿐 |
| 7 | AI-01 코드·`REQ-n`·AI-04/12 원문 입력·자소서 JD 출처·오류 매핑 4종·조회 계약 | 완료(백엔드) / UI 잔여 | `server/ai`에 AI-01·`gate-requirements` 없음, `pipelines.ts:388`(JD는 해시·회사·포지션만), `db/errors.ts`. UI `question-proposal-card.tsx:274` 칩 분기는 UI 요청 U5 |
| 8 | 과거 값·옛 인사이트 보존 | 완료 | psql CHECK 목록, pgTAP r17 v1 보존, `insight.integration` schema 1 읽기 |
| 9 | 생성 RPC 9인자·게이트 삭제·이름 항상 결정·`jd_no_sentences`·5키 | 완료 | `…004810:37-142`, `application.integration` 0문장 400, w3 동의 철회 → 저장 |
| 10 | 생성 뒤 자동 시작 | 완료 | `insight/auto-start.ts`, `actions/application.ts:53-66`(재호출 제외 `:54`), `auto-start.test.ts`, w3 키 있음/없음/동의 철회 |
| 11 | `update_jd_raw_text`·가드·`rawTextEditable`/`rawTextLockedReason` | 완료 | `…004810:151-259`, `read.ts:172-199`, `application.integration` "JR-7" |
| 12 | 근거 허용 목록(트리거·저장·패치) | 완료 | `…004810:268-282`, `enums.ts:274-277`, pgTAP r17 `:529·553`, `r15_document_sources`(`invalid_patch`) |
| 13 | `raw_text_hash` rename·payload·schema 2·`stale_run`·`jd_no_sentences`·`schemaVersion`·`staleReasons` | 완료 (칩 규칙은 QA-06, 재시도 가장자리 QA-07) | `…004800:156`, `…004810:437·540·660`, `job.ts:314`, `read.ts:111·352` |
| 14 | `start_writing_chat` params·인사 3종·`delete_account_data` | 완료 | `…004810:692-720·855-868·926`, UI `insight-view.tsx:417·430`, `loadGateGaps` `pipelines.ts:59-78` |
| 15 | fetch `{rawText}` | 완료 | `fetch.ts:820`, `jd-fetch.ts:73`, `add-application-dialog.tsx` 채움 삭제 |
| 16 | A·B·C·집계 10항목·최종 단언 | 완료(로컬) — 원격 push는 사용자 | 위 "마이그레이션 검토", `release-counts.md` |
| 17 | readiness·usage summary·deletion impact 변경 없음 | 완료(확인) | R17 마이그레이션 3개에 세 함수 없음 |
| 18 | AI-02 임시 최소 수정 + 단계 1 지연 실측 | 완료 — 실측 **장치**만(실제 공급자 수치는 아직 없음) | `schemas/AI-02.ts`, `validation/insight.ts`, `prompts/AI-02`, `step_outputs.match.latencyMs`(통합 테스트), `ai_stage_timing` 로그. 실제 키로 1회 돌려 값을 남기는 일은 남음 |
| 19 | AI-04 인사이트 블록·`jd_sentence` 거부·AI-12 보완점·프롬프트 버전 | 완료 | `cover-letter-chat.ts:415·440-485`, `insight-result.ts`, `gate-gaps.ts`, `prompts/*`(0.v416 표 일치). AI-09(Should)는 구현 없음 — 해당 없음 |
| 20 | 자동 시작도 사용량 기록 | 완료 | w3 통합 테스트 `ai_usage_records` 2행 |
| 21 | 평가 세트 AI-01 항목 삭제 | 완료(할 일 없음) | `__fixtures__`에 AI-01 없음, `AI-13/eval-set.ts`에 AI-01 없음 |

요약: **21행 중 완료 21**(그중 #7은 UI 잔여, #13은 Minor 2건, #18은 실측값 미기록, #16은 원격 push 대기). 미완료 0.

## 스펙 차이 (leader가 `spec-gaps-R17.md`에 반영할 항목)

- AI v4.16 AI-04 "시작 인사"는 인사이트 상태 줄을 시작 인사 안에 두고(`03-ai-features.md` 시작 인사 절 "(v4.16, JR-5·JR-6) 인사이트 상태 줄"), DM v4.16 2.5 `start_document_writing_chat`은 "화면이 인사이트 조회로 그리는 고정 문구, 시작 인사 메시지에 저장하지 않음 `[가정]`"으로 정했다. 구현은 DM(인사 3종, 상태 줄 없음, `[가정 R17b-AI-7]`) — 두 문서 중 하나를 고쳐야 한다.
- QA-06을 UI에서만 처리하기로 하면 DM 11.11 (5) "근거" 행의 담당 경로를 고쳐야 한다.

## 판정

- Critical 0 / Major 0 / Minor 4(QA-06~09). 모든 검사 통과(typecheck, lint, Vitest 2660, build, pgTAP 2648, 타입 재생성 동일).
- 정렬 변경은 4.24 #1~#21을 모두 덮는다. Minor는 머지를 막지 않는다 — 1라운드 수정 여부는 리더 판단.

---

# 정렬 라운드 2 (2026-11-16)

- 작성: backend-qa · 근거: `02_api_notes.md` "정렬 QA 1라운드 수정", 새 테스트 `src/server/ai/pipelines/AI-02.readers.test.ts`, 작업 트리 diff
- 코드는 고치지 않았다. 커밋하지 않았다.

## 검사 실행 결과 (`run-checks.sh --build`)

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | 오류 0 |
| lint | 통과 | 경고·오류 0 |
| Vitest | 통과 | **160 파일, 2666 테스트**(라운드 1 대비 +1 파일·+6 테스트), 건너뜀 0 — 통합 테스트 포함(로컬 스택) |
| build | 통과 | |
| pgTAP | 통과 | **65 파일, 2648 단정**(DB 변경 없음) |

수정 관련 테스트(`AI-02.readers.test.ts`, `insight/{read,job}.test.ts`, `insight.integration.test.ts`)를 `--reporter=verbose`로 따로 돌려 53개 통과 확인.

## 이슈 재확인

| 이슈 | 확인 | 상태 |
|------|------|------|
| QA-06 `jd_sentence` 칩 ↔ `staleReasons.rawText` | `insight/read.ts:116` `chipsOf`가 `ctx.stale.rawText`면 `withRawTextStale`(`:218-222`) 적용 — `jd_sentence`만 `state: "changed"`(이미 `deleted`면 유지), `target`의 `sid/start/end` = null(옛 오프셋 강조 안 함), 커리어 칩 그대로. 공용 `services/evidence`의 "jd_sentence = current" 규칙은 인사이트 조회에서만 덮음(해시 비교에 인사이트 행이 필요 — 타당). 테스트: `read.test.ts` "QA-06…", 통합 "JR-7 … jd_sentence chips 'changed', QA-06"(되돌리면 current). 문구·강조 끄기는 UI U3 | 수정됨(확인 완료) |
| QA-07 원문 수정 전 실패 작업의 재시도 | ① `insight/job.ts:169-182` `insightRetryBlocked` — `hasPreR17Checkpoint` 또는 prepare `rawTextHash` ≠ 현재 `job_descriptions.raw_text_hash` → 정의 `retryBlocked`(`:374-375`) → 러너 `runner.ts:288` 409. 러너가 `scope.db`를 넘기므로 실제 의존 연결 맞음. ② `jobs/status.ts:21-24` `loadRetryBlocked`(실패한 insight만 DB 읽기) → `app/api/ai-jobs/[id]/route.ts:26`이 사용 → `canRetry: false`. ③ 실행 중 불일치(`contextFor` `:229`)와 AI `requirements_changed`(`:285`)는 `AiError("canceled")` — DM 2.6.1 "해시 불일치 = `stale_run` → canceled"와 일치. 같은 원문으로 되돌리면 다시 허용. 테스트: `job.test.ts` QA-07·"raw text changed after prepare → canceled"·"requirements_changed … canceled"·막지 않는 경우 3종, 통합 테스트(실제 DB: 실패 → 수정 → `loadRetryBlocked` true·재시도 409). `[가정 R17b-api-9]`(다른 공급자 재시도도 해시가 바뀌었으면 막음 → "다시 생성")는 DM과 충돌하지 않는다 — leader 확인 목록에 추가 | 수정됨(확인 완료) |
| QA-08 저장 → 읽기 왕복 테스트 | `AI-02.readers.test.ts` — `finalizeInsight`(→ `toCompleteInsightPayload`) 결과를 JSON 왕복(jsonb처럼) 뒤 `readInsightResultV2`가 모든 원소를 읽음, AI-04 `<insight>` 블록에 판정·강점·보완점 요건 문구·`지원 방향: {strategy.positioning}`·우선순위, `selectGateGaps`가 `gaps.1` 키·전체 모두 맞음. QA-05 같은 키 어긋남을 이제 잡는다 | 수정됨(확인 완료) |
| QA-09 낡은 주석·제목 | `contracts/errors.ts:30-31`(4.24 #8 영구 유지), `contracts/draft.ts:138`(폐기됐다고 명시), `insight.integration.test.ts` 제목(`raw_text_hash`), `application.integration.test.ts` 제목, UI `return-target.ts:19` `{ insight_id, insight_item_key }`(주석만, UI 소유 파일 최소 수정) | 수정됨(확인 완료) |

## 잔여 grep 재실행

같은 패턴(`src supabase/tests`) → **261줄 / 77파일**. 라운드 1과 비교해 빠진 것은 `insight.integration.test.ts`의 옛 제목 1줄뿐이고 새로 생긴 줄은 없다. (라운드 1 본문의 "83파일"은 셈 오류 — 같은 결과를 다시 세면 77파일.) 분류는 라운드 1 표 그대로. **살아 있는 코드가 지워진 객체를 부르는 곳 없음, 버그 잔여 없음.**

## 4.24 #1~#21 최종 상태

| # | 상태 | 비고 |
|---|------|------|
| 1~6 | 완료 | 라운드 1 근거 그대로 |
| 7 | 완료(백엔드) | UI 잔여 `question-proposal-card.tsx:274` 칩 분기 — UI 요청 U5 |
| 8~12 | 완료 | |
| 13 | **완료** | QA-06(칩 `rawText`)·QA-07(재시도 해시 검사, 실행 중 불일치 → canceled) 해소 |
| 14~15 | 완료 | |
| 16 | 완료(로컬) | 원격 push는 사용자 — `release-counts.md` 집계 먼저 |
| 17 | 완료(변경 없음 확인) | |
| 18 | 완료 | 지연 측정 장치(`step_outputs.match.latencyMs`, `ai_stage_timing`) 있음. 실제 공급자 실측값은 아직 없음(실제 키 1회 실행 필요 — 재설계 사이클 입력) |
| 19~21 | 완료 | #19 AI-09(Should)는 구현 없음 — 해당 없음 |

**21행 전부 완료, 미완료 0.**

## 최종 판정

- 열린 이슈: **Critical 0 / Major 0 / Minor 0**. QA-06~09 모두 수정 확인. 2라운드 안에 닫힘.
- 모든 검사 통과(typecheck, lint, Vitest 160/2666, build, pgTAP 65/2648).
- R17 정렬 변경은 백엔드 QA 기준으로 **머지 가능**.
- 남은 일(코드 밖, leader):
  - `spec-gaps-R17.md`에 라운드 1 "스펙 차이" 2항목(AI-04 시작 인사의 인사이트 상태 줄 — AI 명세 vs DM 2.5), `[가정 R17b-api-9]`를 기록
  - #18 실제 공급자 실측값을 기록
  - 원격 push 전에 `release-counts.md` 집계를 확인하고, push 직후 코드를 배포
