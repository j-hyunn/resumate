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
