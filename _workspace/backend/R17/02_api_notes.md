# R17 API 구현 노트 (채용 공고 AI 처리 제거 — 원문 그대로)

- 작성: api-engineer, 2026-11-14
- 근거: `01_plan.md` §5, `02_db_notes.md`(9인자 생성 RPC·begin_insight·complete_insight 해시), `02_ai-pipeline_notes.md` "인터페이스"·§8
- 커밋 안 함. `src/server/ai/**`, `supabase/**`, `database.types.ts`, `docs/planning/`는 건드리지 않음.

## 결과

| 검사 | 결과 |
|------|------|
| `pnpm exec next typegen && pnpm exec tsc --noEmit` | 오류 0 |
| `pnpm lint` | 경고·오류 0 |
| `pnpm exec vitest run` | **157 파일, 2620 테스트 전부 통과** (로컬 Supabase 127.0.0.1:54322 실행 중 — 통합 테스트 건너뜀 없음) |
| `pnpm build` | 성공 |

## 삭제한 파일

| 파일 | 내용 |
|------|------|
| `src/app/api/job-descriptions/extract-preview/route.ts` | S-14 ① 요건 미리 보기(AI-01) 라우트 |
| `src/app/api/application-projects/[id]/jd-extraction/route.ts` | 동기 요건 추출 라우트 |
| `src/server/jobs/jd-extraction.ts`, `src/server/jobs/jd-preview.ts` | 추출·미리 보기 production deps |
| `src/server/services/application/extraction.ts`(+test), `extraction-response.ts` | `ensureJdExtracted`·`runJdExtraction` |
| `src/server/services/application/preview.ts`(+test) | `extractJdPreview` |
| `src/lib/data/jd-preview-store.ts` | mock 미리 보기 저장소 |
| `src/test/jd-extraction-fakes.ts` | AI-01 테스트 추출기 |

`POST /api/job-descriptions/fetch`(URL 가져오기)는 그대로.

새 파일: `src/server/services/insight/requirements.ts`(+test) — v2/v1 요건 해석, `src/test/jd-fixtures.ts` — 통합 테스트용 가상 공고 원문(지워진 AI-01 픽스처에서 원문만 옮김).

## 계약 변경 (before → after)

### 생성 `createApplicationProject` (Server Action, `lib/contracts/application.ts`)

- 요청: `previewJobId` 삭제. 나머지(`id, rawText, companyName, positionTitle, name, deadline, sourceUrl`) 동일. 서비스는 9인자 RPC 호출(`p_preview_job_id` 없음).
- 응답 before: `{applicationProjectId, jobDescriptionId, name, nameSource, displayName, extractionStatus, shouldExtract, created, previewApplied, previewSkipReason, warnings}`
- 응답 after: `{applicationProjectId, jobDescriptionId, name, nameSource, displayName, aiRunAllowed, created, warnings}` (`shouldExtract` → `aiRunAllowed`: 연결 상태 표시용일 뿐, 생성 뒤 아무것도 시작하지 않음)
- `CREATE_APPLICATION_ERROR_CODES`: `key_invalid`·`ai_consent_required` 삭제 → `["invalid_source_url", "application_project_id_conflict"]` (DB 게이트 제거 `[가정 R17-9]`에 맞춤)
- 삭제 타입: `ExtractJdPreviewInput`, `ExtractJdPreviewResult`, `PreviewSkipReason`, `PREVIEW_SKIP_REASONS`, `PREVIEW_TTL_HOURS`, `JdExtractionResponse`, `JdExtractionFailure`, `JdRequirementDto`, `JdExtractionStatusSchema`, `RequirementCategorySchema`

### 원문 수정 `updateFailedJdRawText`

- 응답에서 `extractionStatus: "pending"` 삭제 → `{applicationProjectId, jobDescriptionId, rawTextEditedAt, aiRunAllowed, warnings}`. RPC·거부 코드는 그대로(R17-6).

### 목록·보드·허브·JD 보기 (`read.ts`)

- `ApplicationProjectListItem`: `extractionStatus`, `lastExtractionFailure` 삭제
- `ApplicationHub.jd`: `{jobDescriptionId, extractionStatus, requirementCount, extractionProvider, extractionModel}` → `{jobDescriptionId}`
- `JdView`: `detectedLanguage, extractionStatus, requirements, techKeywords, seniority, isLikelyJd, extractionWarnings, extractedBy, lastFailure` 삭제. 남은 것: `applicationProjectId, jobDescriptionId, rawText, rawTextEditedAt, rawTextEditable, rawTextLock, sentences, companyName(+Source), positionTitle(+Source)`
- 삭제 함수: `resolveExtraction`, `extractionJobToCheck`, `loadExtractionJobs`, `parseTechKeywords`, `parseSeniority`; `createJdExtractionDb`(db.ts)
- `jdRawTextLockOf`는 **유지** — `update_failed_jd_raw_text`가 바뀌지 않아(R17-6) 거울도 과거 `extraction_status`·`extraction_job_id`·`jd_requirements` 개수를 읽는다. 새 공고(`pending`)는 `jd_raw_text_locked`.

### 인사이트 (`lib/contracts/insight.ts`, `services/insight/*`)

- `InsightRequirement`에 `sentenceIds: string[]` 추가(v2: 인용 S-n, v1: 행의 `source_sids`). `id`는 v2면 `M{n}`, v1이면 `jd_requirements.id`.
- `InsightView`: `extractionStatus` 삭제. `requirements` 의미 변경 — "지금 JD 요건" → **보여 주는 인사이트의 요건**(v2는 결과 안의 `requirement_matches[].requirement`, v1은 보존된 `jd_requirements` 행, 인사이트 없으면 `[]`).
- `InsightResultView.staleReasons.requirements`: 키 유지, 의미는 **"JD 원문이 바뀜"**(`insights.jd_text_hash` ≠ 현재 `raw_text_hash`). v1 행(`jd_text_hash` 없음)은 항상 `true`. 계약 주석에 명시.
- `InsightJobPartial.requirementMatches[]`에 `requirement: InsightRequirement | null` 추가. `batchesDone`/`batchesTotal`은 키 유지, 1단계가 한 번 호출이라 항상 1/1(부분 결과는 match 체크포인트가 저장된 뒤에만 존재).
- 시작 응답(`StartInsightResponse`)·오류 코드 그대로. 재사용 input_hash = `computeInsightInputHash({provider, model, careerSnapshotHash, jdTextHash})`.

### enum·오류 (`enums.ts`, `errors.ts`, `ai.ts`)

- `AI_JOB_TYPES`(실행 가능)에서 `jd_extraction` 제거 → `LEGACY_AI_JOB_TYPES = ["jd_extraction"]`, DB CHECK 거울은 `AI_JOB_TYPE_CHECK_VALUES`(= legacy + 실행 가능).
- `AI_JOB_TARGET_TYPES`에서 `jd_preview` 제거(전역 CHECK 없음, 조합 CHECK는 DB에 남음).
- `AI_ERROR_CODES`에서 `not_a_jd` 제거 → `LEGACY_AI_ERROR_CODES = ["not_a_jd"]`. `errorCategoryOf`는 모르는 코드(과거 `not_a_jd` 행)를 `input`으로(재시도 불가) 돌려준다. `AI_ERROR_MESSAGES`·카테고리 표에서 `not_a_jd` 삭제.
- `USAGE_FEATURES`는 `jd_extraction` **유지**(DB CHECK 거울 + 과거 사용량 행 표시, R17-7). `USAGE_FEATURE_BY_JOB_TYPE`에서는 삭제(더 이상 기록하지 않음).
- `src/types/db.ts`(화면용 행 타입): `AiJobType`/`AiErrorCode`/`AiUsageFeature`의 `jd_extraction`·`not_a_jd`는 DB 행 거울이라 유지하고 legacy 주석만 추가. `InsightResultRequirement` 타입과 `InsightResult.requirement_matches[].requirement?` 추가.

## 작업 흐름 (러너·크론·인사이트 잡)

- `insight` 잡: `prepare`(입력 로드 → 스냅숏 `{careerSnapshotHash, jdTextHash}` → `begin_insight`; **호출 없음 → `callsProvider: false`**) → `match`(1회 호출, 진행 0/1→1/1) → `synthesize` → `synthesize_regen` → `validate`. 배치·`savePartial`·`batchIds`·`savedBatches`·`pickFailure`·`InsightJdExtractor`(`ensureJd`) 삭제.
- 매 단계 컨텍스트의 `jdTextHash` ≠ prepare 스냅숏이면 `stalled`(재시도 없음, 로그 `insight.jd_text_changed`). AI의 `requirements_changed`(이름 유지, 의미 = JD 원문 변경)도 그대로 `stalled`.
- `begin_insight`의 `job_description_not_found`·`insight_in_progress` 등 → `InsightRpcError` → `stalled`(로그 `insight.begin_refused`). JD가 없으면(`loadInsightInputs` null) 호출 없이 `stalled`.
- 배포 직전에 돌던 R17 이전 잡: prepare 체크포인트에 `jdTextHash`가 없거나 match 체크포인트가 `{batches}`이면 `stalled`(테스트 있음). 원격에 남은 `queued` jd_extraction 잡은 정의가 없어 러너가 `stalled`로 끝내고, 수동 재시도는 `ai_job_not_retryable`(409).
- 크론: `purge_unused_jd_preview_outputs` 호출과 `CronResult.previewOutputsPurged` 삭제.
- 사용 기록: insight는 match 1 + synthesize 1(+ regen) 행. 실패 호출도 기록(테스트).
- 문장 0개 공고(기호만 붙여넣은 원문)도 인사이트를 막지 않는다 `[가정 R17-api1]` — AI는 빈 결과를 정상으로 처리(`[가정 R17-AI-3]`), 서비스 게이트를 새로 두지 않음.

## 자소서·AI 작성 대화 파이프라인 (`services/writing-chat/pipelines.ts`)

- AI-04: JD 입력 = `{jobDescriptionId, jobDescriptionUpdatedAt, sentences(전체), positionTitle, rawTextHash}`. `loadInsightRequirements`·`other_sids`(`otherSidsOf`)·`extraction` 컬럼 읽기 삭제.
- AI-12: `loadGateRequirements`(R-31)와 `gateRequirements` 입력 삭제 `[가정 R17-4]`.

## 연결 (`src/lib/data/`)

| 파일 | 변경 |
|------|------|
| `applications-real.ts` | 생성 뒤 `startJdExtractionInBackground` 호출 삭제, `preview_job_id` 삭제, `realRetryJdExtraction` 삭제, JD 행을 저장값 그대로(`extraction_status` 덮어쓰기 없음), `normalizeInsightResult`가 v2 `requirement` 보존, 가짜 generating 행에 `jd_text_hash: null` |
| `applications.ts` (mock 분기) | mock AI-01(advance/complete/fail, `ensureJdRequirementsInDb`) 삭제, mock 생성은 게이트·잡 없음·이름 규칙 R17-8, mock 인사이트는 추출 없이 1 unit·`jd_text_hash`, `CreateApplicationResult` = 행 그대로, `preview_*` 입력 삭제 |
| `ai-jobs.ts` (mock) | 재시도 시 추출 재실행·`mock_fail_at_prepare`의 jd_extraction 사용량 삭제 |
| `cover-letters.ts` | `extractJdPreview` 삭제 |
| `drafts.ts` | `retryJdExtraction`/`runJdExtraction` 삭제 |
| `usage-display.ts`, `labels.ts` | `jd_extraction` 라벨 "요건 추출" → **"채용 공고 분석(이전)"** (R17-7) |

## UI 소유 파일 수정 (최소 — 컴파일·계약 맞춤)

| 파일 | 수정 |
|------|------|
| `app/(dashboard)/(gated)/applications/_lib/actions.ts` | `extractJdPreviewAction`, `retryJdExtractionAction`, `getJdExtractionStateAction`(+`JdExtractionState`) 삭제. `createApplicationAction`에서 `preview_job_id`·`preview_deadline`·`withAiGuard` 삭제, 결과 `{ id }` |
| `app/(dashboard)/(gated)/applications/_lib/jd-state.ts` | `jdRunState`가 항상 `{waitJd:false, jdFailed:false, extractFirst:false}` (`?state=wait-jd` 미리 보기만 예외), `extractFirstPreviewFail` 항상 null |
| `components/applications/extract-first.tsx` | `useRequirementsFirst`를 통과형으로(`run(next)` = `next()`, busy·slot 없음). `refusalOf`는 유지(공용) |
| `components/applications/add-application-dialog.tsx` | ① [다음]의 AI-01 미리 보기 호출 삭제 → ②는 사용자 입력 + URL `JobPosting` 값. ①의 키 무효·동의 게이트 삭제(공고 등록은 AI 미사용). 생성의 `AiRejected` 분기·미리 보기 버려짐 토스트 삭제 |
| `components/applications/jd-view.tsx` | `ExtractionFailed`·`ExtractingLine`·`RunExtraction`(요건 정리하기) 삭제, 요건·키워드·경력 조건이 모두 비면 오른쪽 열을 그리지 않음 |
| `components/applications/cover-letter/jd-tab.tsx` | 추출 상태 판정(분석 중·실패·요건 정리 전·JD 판별 경고) 삭제, 원문만 표시(요건 열에 빈 값 전달). 원문 수정·잠금 안내·돌아가기는 유지 |
| `components/applications/cover-letter/insight-tab.tsx` | 요건 표시용 맵 = 결과의 v2 요건(+부분 결과) 우선, 과거 `jd_requirements` 행 보조 |
| `components/applications/insight-parse.ts` | `parseMatchStage`가 v2 `matches[].requirement` 보존, `requirementsByIdFrom` 추가 |
| `lib/preview-state.ts` | `ai-failed-input` → `input_too_long`(반환 유니온에서 `not_a_jd` 삭제) |
| `lib/mock/fixtures.ts` | insights 고정 행 2개에 `jd_text_hash: null`(생성 타입에 새 컬럼) |
| UI 테스트 | `start-writing.test.ts`(선행 추출 → 통과형 확인), `tab-copy.test.ts`(②·⑥ 소스 단정 갱신), `usage-rows.test.ts`(라벨) |

## UI 요청 (하지 않은 화면 변경 — resumate-ui로)

1. **S-14 추가 모달 ②**: "공고에서 요건 {n}개를 미리 정리해 두었어요" 줄, `extract-failed` C-20 축약, `extracting` 단계(`Phase`), `requirementCount`·`previewJobId`·`previewDeadline` 상태와 폼 임시 저장 키(`form-draft.ts`의 `preview_job_id`/`requirement_count`), 키 무효 인라인 안내(`keyInvalidShown`)가 미리 보기(`?state=`) 전용으로만 남음 — 정리 필요. ①의 키 없음 분기 문구도 재검토.
2. **S-15 채용 공고 탭**: 오른쪽 요건 목록 영역 자체(카테고리·핵심 배지·기술 키워드·"원문" 하이라이트 버튼)를 화면에서 걷어내거나 원문 전용 레이아웃으로 재설계. `JdView`의 `requirements/techKeywords/seniority/requirementsSlot` props 정리. 미리 보기 상태 `wait-jd`·`ai-sync`·`raw-unknown-cause`·`extracting=self` 정리.
3. **원문 수정 규칙**(R17-6): 새 공고는 RPC가 항상 `jd_raw_text_locked` → "공고 원문 고치기" 버튼이 사실상 안 보임. 기획 결정 후 화면·RPC 함께 개정.
4. **요건 선행 추출 흔적**: `useRequirementsFirst`·`extractFirst` props(`question-setup.tsx`, `insight-view.tsx`, `cover-letter-screen.tsx`의 `requirementsPending`), `EXTRACT_FIRST_NOTE`, `coverLetterGreeting`의 "공고 요건을 먼저 정리하고 있어요", `QUESTION_COPY.requirementsFirst` "공고 요건 정리 중", 관련 주석(FL-03/D-30) 삭제.
5. **S-16 인사이트**: 요건 표시가 v2 결과의 `M{n}` 기준으로 바뀜 — 인용 문장(`sentenceIds`) 보기(원문 하이라이트), "데이터 변경됨" 사유 문구를 "공고 원문이 바뀌었어요"로(현재 `staleReasons.requirements`), v1 결과의 항상-변경됨 표시 확인. `rawTextEdited` 판정이 `extraction_status === "pending"`을 보는 부분 정리. 입력 원인 실패의 "공고 원문 고치기" 이동(`isInputCausedJdFailure`)·`routes.coverLetter({cause: "not_a_jd"})` 정리.
6. **오류 안내 `not_a_jd`**: `ai-error-notice.tsx`의 `not_a_jd` 분기(문구 "채용 공고가 아닌 텍스트로 보여요", 아이콘, "입력 화면으로"), `ai-errors.ts`·`jd-raw-text.ts`의 입력 원인 목록은 **과거 행 표시용으로 남김** — 삭제 여부는 UI 결정(과거 `not_a_jd` 인사이트 잡 행이 화면에 올 수 있음).
7. **dev 갤러리**: `dev-state-gallery.tsx`·`dev-state-gallery-v53.tsx`의 `not_a_jd` 견본, "다음 요건 추출 실패" 버튼(`mock_controls.next_jd_extraction_failure` — 이제 아무 효과 없음) 정리. `lib/mock/fixtures.ts`의 `next_jd_extraction_failure` 필드도 같이.
8. **mock 인사이트 v2**: mock 인사이트 결과는 아직 v1 모양(`jd_requirements` 행 id). 새 mock 공고는 요건 행이 없어 빈 판정 표가 나온다 → mock이 v2(`requirement` 포함, `M{n}`)를 만들도록.
9. **사용량 표**: 5행 중 "채용 공고 분석(이전)"을 과거 기록이 없으면 숨길지(현재는 항상 0으로 표시).
10. `ai-progress.tsx`의 `jd_extraction: 15`(예상 시간 표)는 타입 때문에 남김 — 정리 시 함께.

## 잔여 grep (`grep -rnE "jd_extraction|jd_preview|not_a_jd|p_preview_job_id|extract-preview|requirements_hash|REQ-" src`, `src/server/ai`·`database.types.ts` 제외)

| 위치 | 이유 |
|------|------|
| `lib/contracts/enums.ts` (`LEGACY_AI_JOB_TYPES`, `USAGE_FEATURES`의 `jd_extraction`, target 주석) | DB CHECK 거울·과거 사용량 라벨(R17-7) |
| `lib/contracts/errors.ts` `LEGACY_AI_ERROR_CODES`, `lib/contracts/ai.ts` 주석 | 과거 `not_a_jd` 행 |
| `types/db.ts` `AiJobType`/`AiErrorCode`/`AiUsageFeature` | DB 행 거울(과거 행) |
| `lib/data/usage-display.ts`, `lib/data/labels.ts` | legacy 사용량 라벨 "채용 공고 분석(이전)" |
| `server/jobs/runner.ts`(legacy 재시도 거부), `cost.ts`·`cron.ts` 주석 | R17 설명 |
| `server/services/ai-jobs/index.ts`, `server/services/shell/index.ts`, `lib/data/shell.ts`, `lib/data/ai-jobs.ts`, `lib/data/applications.ts:83` | 과거 jd_extraction 행이 진행 중·완료 토스트에 섞이지 않게 계속 제외 |
| `server/services/application/read.ts` `jdRawTextLockOf`, `lib/data/applications.ts:392`(mock 거울), `lib/data/jd-raw-text.ts` | 바뀌지 않은 `update_failed_jd_raw_text` 조건 4의 거울(R17-6) |
| `server/services/insight/read.ts:61` 주석 | v1 행의 `requirements_hash`(읽지 않음) 설명 |
| `lib/data/applications.ts`·`applications-real.ts`의 `requirements_hash: null` | insights 행 타입의 필수 키(새 행은 null) |
| `lib/mock/fixtures.ts`, `lib/mock/ai.ts` | 과거 행을 흉내 낸 mock 데이터·job_type별 표(UI 소유, UI 요청 7·8) |
| `components/common/ai-error-notice.tsx`, `ai-progress.tsx`, `dev-state-gallery*.tsx`, `applications/insight-view.tsx`, `lib/routes.ts`, `lib/data/ai-errors.ts`, `lib/data/account.ts` 주석 | UI 소유, 과거 행 표시 — UI 요청 5·6·7·10 |
| `components/applications/insight-parse.ts` `REQ-` | 산문에서 내부 별칭을 지우는 표시 가드(과거 결과 포함) |
| `app/api/ai-jobs/[id]/retry/route.ts` 주석 | legacy `not_a_jd` 재시도 불가 설명 |
| 테스트(`runner.test`, `read.test`×2, `write.test`, `insight.integration`, `application.integration`) | legacy 행 거부·부재를 확인하는 단정 |

## `[가정]`

- `[가정 R17-api1]` 문장 0개 공고의 인사이트를 서비스에서 막지 않는다(DB `begin_insight`도 JD 존재만 확인).
- `[가정 R17-api2]` 배포 시점에 돌던 R17 이전 insight 잡(체크포인트 형태가 다름)은 이어 가지 않고 `stalled`로 끝낸다 — 사용자는 "다시 생성".
- `[가정 R17-api3]` `InsightView.requirements`는 "보여 주는 인사이트의 요건". 인사이트가 없으면 `[]`(이전엔 추출된 JD 요건).
- `[가정 R17-api4]` 부분 결과 `batchesDone/Total` 키는 화면 호환을 위해 유지하고 1/1로 채움.
- `[가정 R17-api5]` `errorCategoryOf`의 모르는 코드 → `input`(과거 `not_a_jd`가 input이었음, 재시도 버튼 안 보임).
- `[가정 R17-api6]` 공고 추가 모달 ①에서 키 무효·동의 필요 게이트를 지움(DB 게이트 제거 R17-9와 일치). 기획 Q53-1 경로 ⑥과 어긋남 — spec gap(리더 기록 대상).
- `[가정 R17-api7]` 사용량 legacy 라벨 문구 "채용 공고 분석(이전)"(계획 R17-7 문구 그대로).

## 관찰 (R17 밖, 고치지 않음)

- `writing-chat/pipelines.ts` `insightSignalOf`가 `result.positioning`(최상위)을 읽는데 저장 결과는 `strategy.positioning`에 있다 → 자소서 대화의 포지셔닝 신호가 늘 null로 보임. 별도 확인 권장.

## 새 환경 변수

없음.

## QA 1라운드 수정 (2026-11-14, `03_backend-qa_report.md` QA-01~04)

| 이슈 | 수정 |
|------|------|
| QA-01 죽은 raise 매핑 | `src/server/db/errors.ts`에서 `already_extracted`, `extraction_in_progress`, `user_edited_requirements_exist`, `jd_not_extracted`, `invalid_extraction_result`(메시지 표 + 별칭 표) 삭제, R17 주석. `errors.test.ts`의 테스트 이름에서 create_application_project 게이트 언급 제거(`key_invalid`·`ai_consent_required` 매핑은 다른 RPC가 쓰므로 유지) |
| QA-02 과거 `not_a_jd` 행 | 규칙 하나로 통일: **input 실패, 다시 시도 없음, 코드는 그대로, 전용 문구**. `contracts/ai.ts`에 `LEGACY_AI_ERROR_MESSAGES`, `JobErrorCode`(= 현재 + legacy), `JobErrorCodeSchema`, `isLegacyAiErrorCode`, `jobErrorMessageOf` 추가. `errorCategoryOf(not_a_jd)` = `input`(그 밖의 모르는 코드는 `system`), `failureCauseOf` = null, `isManuallyRetryable` = false. `AiJobErrorSchema.code`·`AiFailureSchema.code`가 legacy 코드를 받도록 넓힘(SSE `ErrorEvent`는 그대로). `JobRecord.errorCode` 타입을 `JobErrorCode`로. `jobs/status.ts`는 `jobErrorMessageOf`로 문구를 채워 `AiJobStatusResponseSchema`를 통과(canRetry false). `insight/read.ts` `toFailure`는 legacy 행을 `{code: "not_a_jd", category: "input", retryable: false, 전용 문구}`로(이전: `stalled` + 다시 시도). 러너 재시도는 input 범주라 409 `ai_job_not_retryable` — 화면·상태·재시도 일치 |
| QA-03 R17 이전 실패 insight 잡의 재시도 | `retry_ai_job`에 재시작 플래그가 없어(서버가 step outputs를 유지) prepare부터 다시 돌릴 수 없다 → **재시도를 미리 거부**하고 "다시 생성"(새 잡)은 그대로 둔다. `insight/job.ts` `hasPreR17Checkpoint`(prepare 스냅숏에 `jdTextHash` 없음 또는 match 출력에 `matches` 배열 없음) → 정의의 `retryBlocked` → 러너 409. `jobs/status.ts` `retryBlockedByCheckpoint`가 상태 응답의 `canRetry: false`, `retry: null`을 맞춘다(버튼이 안 보임). `[가정 R17-api8]` 재시작 지원이 필요하면 `retry_ai_job`에 재시작 인자를 더하는 DB 변경이 필요(db-engineer 요청 후보) |
| QA-04 낡은 거부 코드 타입 | `src/types/db.ts`의 `ApplicationCreateRefusalCode` 삭제(사용처 없음, R17 주석). UI 소유 파일 최소 수정 |

테스트 추가: `insight/job.test.ts` "pre-R17 job rows" 4개(QA-02: 범주·상태 응답 스키마·문구·재시도 409 / QA-03: 옛 prepare 체크포인트 → 409·canRetry false·호출 없음, 옛 match 체크포인트 판정, 새 run은 정상), `insight/read.test.ts`(legacy 행 → input·retryable false로 기대값 변경), `jobs/support.test.ts` 고정 job의 match 체크포인트를 R17 형태로(옛 형태면 재시도가 막혀 원래 단정과 어긋남).

재실행: `tsc --noEmit` 0, `pnpm lint` 0, `vitest run` **157 파일 / 2624 테스트 통과**. QA-05(범위 밖)는 손대지 않음.

---

## 정렬 (2026-11-16)

- 작성: api-engineer(2차), 2026-11-16 · 근거: `01b_plan-align.md` §1, decisions 3.29·4.24, DM v4.16 2.6.1·2.6.2·2.7.0·§7, `02_db_notes.md` "정렬 (2026-11-16)", `02_ai-pipeline_notes.md` "정렬 인터페이스 (2026-11-16)"
- 위 1차 절의 `aiRunAllowed`·`jd_text_hash`·`update_failed_jd_raw_text`·`InsightRequirement(M{n})`·`staleReasons.requirements`·`batchesDone` 등은 **이 절로 대체**된다. 커밋 안 함. `supabase/`·`database.types.ts`·`src/server/ai/**`·`docs/planning/`는 건드리지 않음.

### 결과

| 검사 | 결과 |
|------|------|
| `pnpm exec tsc --noEmit` | 오류 0 |
| `pnpm lint` | 경고·오류 0 |
| `pnpm exec vitest run` | **159 파일, 2660 테스트 전부 통과**(로컬 Supabase 127.0.0.1:54322 — 통합 테스트 건너뜀 없음, w3·insight·application 통합 포함) |
| `pnpm build` | 성공 |

### 계약 before → after

| 계약 | before (1차 R17) | after |
|------|------------------|-------|
| `createApplicationProject`(Server Action) 응답 | `{…, aiRunAllowed, created, warnings}` | `{applicationProjectId, jobDescriptionId, name, nameSource, displayName, created, warnings, insightJobId, insightSkipReason}` — `aiRunAllowed` 삭제(RPC 반환에서 빠짐). 새 행일 때만 자동 시작, 같은 `id` 재호출은 둘 다 null |
| `INSIGHT_SKIP_REASONS`(신설, `contracts/application.ts`) | — | `ai_not_connected`·`key_invalid`·`consent_required`·`insufficient_data`·`no_sentences`·`in_progress`·`start_failed` (판정 순서) |
| `CREATE_APPLICATION_ERROR_CODES` | `invalid_source_url`, `application_project_id_conflict` | + `jd_no_sentences`(400) |
| 원문 수정 액션 | `updateFailedJdRawText` / `UpdateFailedJdRawTextInput` → RPC `update_failed_jd_raw_text`, 응답에 `aiRunAllowed` | **`updateJdRawText` / `UpdateJdRawTextInput`** → RPC **`update_jd_raw_text`**, 응답 `{applicationProjectId, jobDescriptionId, rawTextEditedAt, warnings}` |
| `JD_RAW_TEXT_REFUSAL_CODES` | `jd_job_in_progress`, `jd_raw_text_locked`, `jd_failure_not_input`, `jd_has_results`, `jd_raw_text_unchanged` | `jd_no_sentences`(400), `jd_job_in_progress`(409), `jd_raw_text_unchanged`(409) |
| `JdView` | `rawTextEditable` + `rawTextLock: JdRawTextLock` | `rawTextEditable` + **`rawTextLockedReason: "job_in_progress" \| null`**(`JD_RAW_TEXT_LOCKED_REASONS`). 판정 = 같은 지원 건에 `queued`/`running` `insight` 작업 |
| `src/server/db/errors.ts` | `jd_raw_text_locked`·`jd_failure_not_input`·`jd_has_results` 매핑 | 삭제(→ `internal_error`). `jd_no_sentences` 400 신설, `jd_job_in_progress` 문구 "인사이트를 만드는 중에는 …" |
| `POST /api/job-descriptions/fetch` | `{rawText, companyName, positionTitle}` | **`{rawText}`** (`FetchJobDescriptionResult`) |
| `StartInsight`(라우트·액션) | 오류 401/404/422/409 | + **409 `jd_no_sentences`**(문장 0개 JD — `begin_insight`와 같은 규칙을 시작 전에). 재사용은 latest ready **`schema_version = 2`**만 |
| `InsightJobPartial`(`GET /api/ai-jobs/{id}`) | `{kind, batchesDone, batchesTotal, requirementMatches[{requirementId, requirement, …}]}` | `{kind: "insight_matches", requirementMatches[{matchKey, requirementText, sentenceIds, status, rationale, missingAspect}]}` — step output `match.v === 3`·`items`일 때만 |
| `InsightView` | `requirements: InsightRequirement[]` 포함 | `requirements` 삭제(요건은 결과 안에) |
| `InsightResultView` | `staleReasons {career, requirements}`, `requirementMatches[{requirementId, requirement}]`, `requirementIds` | **`schemaVersion`**(1이면 본문 빈 값), **`staleReasons {career, rawText}`**(`rawText` = `insights.raw_text_hash ≠ job_descriptions.raw_text_hash`), `requirementMatches[{itemKey, matchKey, requirementText, sentenceIds, …}]`, 강점·보완점·우선순위 `matchKeys`, `add_data` 행동 `relatedMatchKeys` |
| `InsightRequirement`, `REQUIREMENT_CATEGORIES/IMPORTANCES/ORIGINS`, `JD_EXTRACTION_STATUSES` | 있음 | 삭제(테이블·컬럼 drop) |
| `EVIDENCE_SOURCE_TYPES` / `EVIDENCE_ALLOWED_SOURCE_TYPES` / `EVIDENCE_KIND_LABELS` / `EvidenceTarget` | `jd_requirement` 포함, 자소서 허용 목록에 `jd_requirement`·`jd_sentence` | `jd_requirement` 삭제. `insight` = 커리어 5 + `jd_sentence`, `application_document` = 커리어 5 + `user_note` (DB `private.evidence_allowed_sources`와 같음) |
| `ReturnTargetInput.params` | 자유 | 그대로(자유 object) + 문서화: 보완점에서 연 대화는 `insight_id`·`insight_item_key`(`gaps.{n}`), 검사는 `start_writing_chat`(→ `invalid_return_target` → `invalid_input` 400) |
| `src/types/db.ts` | `JobDescription`에 추출 컬럼 덮어쓰기, `JdRequirement = Row<"jd_requirements">`, `InsightResult`(v1 `requirement_id`) | 추출 컬럼 삭제, `JdRequirement`는 **mock 전용 평범한 interface(@deprecated)**, `InsightResult`/`InsightMatchStageResult` = schema 2(`match_key`·`requirement_text`·`sids`·`match_keys` / `{prompt_version, items}`), `InsightSkipReason` 추가, `JdRawTextRefusalCode` 새 목록, `EvidenceSourceType`에서 `jd_requirement` 삭제 |

### 서비스·작업 흐름

- **인사이트 작업**(`services/insight/job.ts`): `InsightMatchStage = {v: 3, rawTextHash, latencyMs, items[MT-n]}`, 스냅숏 `{careerSnapshotHash, rawTextHash}`. match 단계 출력이 AI의 `MatchStageResult` 그대로라 **단계 1 실측 `latencyMs`가 `ai_jobs.step_outputs.match`에 남는다**(4.24 #18, 테스트). `hasPreR17Checkpoint` = prepare 스냅숏에 `rawTextHash` 없음 또는 match `v !== 3` → 수동 재시도 409(1차 R17 미반영 판 체크포인트도 포함). `complete_insight`가 `{applied:false, reason:'stale_run'}`이면 **`AiError("canceled")` → 러너가 작업 `canceled`**(새 error_code 없음, 사용 기록은 이미 한 호출만큼 남음). reason 없는 `applied:false`는 종전대로 `stalled`.
- **시작**(`start.ts`): 문장 0개 → 409 `jd_no_sentences`(작업 안 만듦). `findReusableInsight`가 `schema_version = 2`만 재사용.
- **자동 시작**(`services/insight/auto-start.ts` 신설, JR-6): 조건 순서 = 연결(`forUser`: 없음 → `ai_not_connected`, `invalid` → `key_invalid`, `ai_consent_required` 예외 → `consent_required`) → D-01(`insufficient_data`) → 문장 ≥ 1(`no_sentences`) → 진행 중 `insight` 작업 없음(`in_progress`) → **수동 시작과 같은 `startInsight`**(`regenerate: false`). 모든 예외를 삼키고 `start_failed`(공용 경로의 코드면 그 이유로), 로그는 ids·코드만. 생성 액션(`server/actions/application.ts`)이 `created: true`일 때만 부른다. 사용량은 러너가 수동과 똑같이 기록(4.24 #20 — w3 통합 테스트에서 2행 확인).
- **조회**(`read.ts`): schema 1 행은 본문·근거 칩을 읽지 않고 `schemaVersion: 1`로만. `staleReasons.rawText`는 컬럼 비교(같은 원문으로 되돌리면 false — 통합 테스트).
- **AI-04**(`writing-chat/pipelines.ts` `loadDocumentInputs`): JD는 `raw_text_hash, company_name, position_title`만 읽고 **`sentences`·`raw_text`는 읽지 않는다**. 최신 ready `schema_version = 2` 인사이트(`id, result, schema_version, career_snapshot_hash, raw_text_hash`) → `insight`, 없으면 null. `application = {companyName, positionTitle}`. `insightSignalOf` 삭제.
- **AI-12 게이트**(`loadGateGaps` 신설): `return_target.params.insight_id`(그 지원 건·ready) → 없거나 사라졌으면 그 지원 건 latest ready schema 2 → `selectGateGaps({schemaVersion, result, insightItemKey})`. 빈 배열이면 `gateGaps` 생략. JD는 읽지 않는다.
- **근거 칩**(`services/evidence`): `jd_requirement` 원본 테이블·타깃 분기 삭제.

### 4.24 대조 (api 담당분)

| # | 내용 | 상태 | 위치 |
|---|------|------|------|
| 6 | 추출·미리 보기 라우트, 크론 purge 호출 삭제 | 완료(1차) — 재확인 | `src/app/api` 해당 라우트 없음, `jobs/cron.ts` |
| 7 | AI-01 코드, `REQ-n`, AI-04·AI-12 원문 입력, 자소서 근거 허용 목록·칩의 JD 출처, 오류 매핑 4종, 조회 계약 `extraction*`·`detectedLanguage`·요건 목록 | 완료(서버·계약·`lib/data`). 화면 칩 1곳은 UI 요청 5 | `contracts/enums.ts`·`evidence.ts`, `services/evidence`, `db/errors.ts`, `writing-chat/pipelines.ts`, `lib/data/evidence*.ts`·`labels.ts`·`deletion.ts` |
| 9 | 생성 RPC 5키 반환·`jd_no_sentences` | 완료(호출 쪽) | `application/write.ts`, `contracts/application.ts` |
| 10 | 생성 뒤 인사이트 자동 시작, `insightJobId`·`insightSkipReason`, 재호출은 안 함 | **완료** | `insight/auto-start.ts`, `actions/application.ts`, `lib/data/applications*.ts`, UI `createApplicationAction` |
| 11 | `update_jd_raw_text` 액션, `rawTextEditable`·`rawTextLockedReason`, 폐기 코드 매핑 삭제 | **완료** | `application/write.ts`·`read.ts`, `actions/application.ts`, `db/errors.ts` |
| 13 (조회) | `schemaVersion`, `staleReasons.{career, rawText}`, `stale_run` → 취소, `jd_no_sentences` 409, 재사용 schema 2만 | **완료** | `insight/read.ts`·`job.ts`·`start.ts` |
| 14 (호출) | `insight_id`·`insight_item_key` 전달, 게이트 보완점 로드 | **완료**(서버 + S-16 보완점 버튼의 params 최소 수정) | `writing-chat/pipelines.ts` `loadGateGaps`, `insight-view.tsx` |
| 15 | fetch `{rawText}`만 | **완료** | `job-description/fetch.ts`, `contracts/jd-fetch.ts`, 라우트 주석 |
| 17 | readiness·usage summary·deletion impact 변경 없음 | 확인(호출부 변경 없음) | — |
| 20 | 자동 시작도 사용량 기록 | **완료**(러너 그대로, 통합 테스트로 확인) | `lib/data/w3.integration.test.ts` |

### 새 테스트·바꾼 테스트

- 신설: `insight/auto-start.test.ts`(이유 7종·`needs_check` 통과·예외 삼킴·러너 게이트 코드 유지·진행 중), `writing-chat/pipelines.test.ts`(→ `loadGateGaps` 5건; 옛 `insightSignalOf` 테스트 대체)
- `insight/job.test.ts`: v3 체크포인트·`insight.match.1`·`latencyMs` 보존·부분 결과 새 모양·`stale_run` → canceled(사용 기록 2행)·`hasPreR17Checkpoint`(v2/`jdTextHash` 판 거부)
- `insight/start.test.ts`: schema 1 재사용 안 함, 0문장 409 / `insight/read.test.ts`: schema 2 매핑·rawText stale·schema 1 빈 본문
- `insight/insight.integration.test.ts`: MT-n 저장·`raw_text_hash`·`match_stage_result {prompt_version, items}`·`latencyMs`, 원문 수정 → `rawText` stale(되돌리면 false), schema 1 행 → 본문 없음·재사용 안 함(psql로 행 나이 먹임), `autoStartInsight` 실제 DB(시작·`in_progress`·`ai_not_connected`·사용 2행)
- `application/application.integration.test.ts`: 0문장 생성 → 400·행 없음, `update_jd_raw_text` 판정 순서·`cover_letter` 작업은 잠그지 않음·`insight` 작업은 잠금
- `lib/data/w3.integration.test.ts`(실제 Server Action 경로): 키 없음 → `ai_not_connected`, 동의 철회 → `consent_required`, 키·커리어 있음 → **자동 시작 작업 succeeded + 사용 2행**, 원문 수정 거부 코드 매핑
- `db/errors.test.ts`·`application/write.test.ts`·`read.test.ts`·`job-description/fetch*.test.ts`·`jobs/support.test.ts`·`account/__fixtures__/all-slices.sql`(`jd_requirements` insert 삭제)
- 삭제: `insight/requirements.ts`(+test) — v1/v2 요건 해석기(테이블 drop으로 불필요)

### `[가정 R17b-api-n]`

- `[가정 R17b-api-1]` `jd_no_sentences`는 매핑 표 하나라 **400**(생성·원문 수정 — DM 2.6·2.6.1)으로 매핑하고, 인사이트 시작은 서비스가 먼저 **409**로 막는다(DM 2.7.0 `begin_insight` 409). 작업 안의 `begin_insight` 거부는 종전대로 `stalled`.
- `[가정 R17b-api-2]` `complete_insight` `stale_run`은 세대 불일치와 JD 해시 불일치가 같은 reason이라 둘 다 `canceled`로 끝낸다(세대 불일치면 러너 `finish`가 맞지 않아 lost — 결과 같음).
- `[가정 R17b-api-3]` 게이트 `insight_id`의 인사이트가 지워졌거나 ready가 아니면 그 지원 건 latest ready schema 2로 대신한다(키는 그대로 `insight_item_key`를 시도).
- `[가정 R17b-api-4]` 자동 시작에서 `startInsight`가 `reused: true`를 돌려주면(새 지원 건이라 실제로는 없음) `{insightJobId: null, insightSkipReason: null}`.
- `[가정 R17b-api-5]` 자동 시작은 Server Action 안의 `after()`로 첫 단계를 돌린다(수동 시작 액션 `actions/insight.ts`와 같은 방식, 페이지 `maxDuration` 설정 없음 — 이어 달리기는 continue 토큰 경로).
- `[가정 R17b-api-6]` mock 생성은 자동 시작을 흉내 내지 않고 `insight_skip_reason: "ai_not_connected"`를 돌려준다(`?state=` 미리 보기 전용).
- `[가정 R17b-api-7]` `JdRequirement` 타입·mock `jd_requirements` 배열·`getJdRequirement`(real은 늘 null)는 화면(S-15 요건 열·S-10 "관련 요건")이 아직 import해서 남겼다 — UI 요청 2·7로 걷는다.
- `[가정 R17b-api-8]` 원문 수정 data 계층 함수 이름 `updateFailedJdRawText`·UI 액션 `updateFailedJdRawTextAction`은 화면 시그니처 유지를 위해 그대로 두고 본문만 `updateJdRawText`로 바꿨다.

### 잔여 grep (`grep -rnE "jd_requirements|jd_requirement|REQ-|jd_extraction|jd_preview|not_a_jd|p_preview_job_id|extract-preview|requirements_hash|requirementsHash|jdTextHash|jd_text_hash|update_failed_jd_raw_text" src`, `database.types.ts` 제외)

| 위치 | 이유 |
|------|------|
| `lib/contracts/enums.ts`(`LEGACY_AI_JOB_TYPES`, `USAGE_FEATURES`의 `jd_extraction`, target 주석, R17 주석), `types/db.ts`(`AiJobType`·`AiErrorCode`·`AiUsageFeature`) | 4.24 #8 과거 CHECK 값 거울 |
| `lib/contracts/errors.ts` `LEGACY_AI_ERROR_CODES`, `lib/contracts/ai.ts`(`LEGACY_AI_ERROR_MESSAGES`·주석), `server/ai/errors.ts`, `server/jobs/types.ts` 주석, `api/ai-jobs/[id]/retry` 주석, `insight/read.ts` `toFailure` 주석 | 과거 `not_a_jd` 행 표시·재시도 거부(#8) |
| `lib/data/labels.ts`·`usage-display.ts` "채용 공고 분석(이전)", `components/account/usage-rows.test.ts` | legacy 사용량 라벨(문구 변경은 UI 요청 8) |
| `server/services/ai-jobs/index.ts`, `server/services/shell/index.ts`, `lib/data/shell.ts`, `lib/data/ai-jobs.ts`(195·286), `lib/data/applications.ts:83`, `lib/data/account.ts` 주석 | 과거 `jd_extraction` 행을 진행 중 표시에서 제외 |
| `server/jobs/runner.ts`·`cost.ts`·`cron.ts`, `server/db/errors.ts:163`, `application/db.ts`·`raw-text.ts`, `contracts/application.ts`(21·138·315)·`insight.ts:15`·`evidence.ts:28`·`enums.ts:290·465`, `lib/data/evidence-real.ts:27`·`deletion.ts:439`·`applications-real.ts:153`·`applications.ts:3`, `types/db.ts:88·735`, `account/__fixtures__/all-slices.sql:66`, `server/ai/*`(input-hash·evidence-rules·AI-02·storage·prompts 주석) | R17 설명 주석 |
| `components/applications/insight-parse.ts` `REQ-` | 산문 내부 별칭 표시 가드(과거 결과 포함) |
| `server/ai/validation/alias-text.ts` `REQ-1` | 산문 별칭 가드 예시(실제 티켓 번호는 건드리지 않음) |
| `lib/data/evidence-real.ts:50` `jd_requirements: []`, `lib/data/deletion.ts:431`, `lib/data/applications.ts:414`, `lib/mock/fixtures.ts`(`jd_requirements` 배열·`jd_extraction`/`not_a_jd` 작업·`next_jd_extraction_failure`), `lib/mock/ai.ts`(job_type별 표) | mock 저장소 모양(`MockDb.jd_requirements`)·과거 행 흉내 — UI 소유, UI 요청 7·9 |
| `components/common/ai-error-notice.tsx`, `ai-progress.tsx`(`jd_extraction: 15`), `dev-state-gallery*.tsx`, `applications/insight-view.tsx`(246·263), `applications/cover-letter/question-proposal-card.tsx:274`, `lib/routes.ts:92`, `lib/preview-state.ts`, `lib/data/ai-errors.ts`, `lib/data/jd-raw-text.ts` | UI 소유 — UI 요청 3·5·6 |
| 테스트(`insight/job.test`·`read.test`·`insight.integration`, `application/read.test`·`write.test`, `jobs/runner.test`, `lib/data/education-labels.test`, `server/ai/**/*.test`) | 부재·legacy 거부를 단정하는 테스트, 옛 체크포인트 모양 |

### UI 소유 파일 수정 (최소 — 컴파일·계약 맞춤)

| 파일 | 수정 | 4.24 UI |
|------|------|---------|
| `app/(dashboard)/(gated)/applications/_lib/actions.ts` | `createApplicationAction` 결과에 `insight_job_id`·`insight_skip_reason` 통과(`CreateApplicationOutcome`), 주석 | 1·9 |
| `app/(dashboard)/(gated)/applications/_lib/jd-state.ts` | `jdRunState` 인자 타입 `Pick<JobDescription, "id">`(추출 컬럼 drop) | — |
| `components/applications/add-application-dialog.tsx` | fetch 응답의 `companyName`·`positionTitle` 채움 삭제(②는 빈 칸에서 시작) | 1 |
| `components/applications/insight-parse.ts` | `MatchRow` = schema 2 행, `parseMatchStage`가 `{prompt_version, items}` 읽음, `requirementsByIdFrom(rows)` = `match_key → requirement_text` | 3·9 |
| `components/applications/insight-view.tsx` | `requirement_id(s)` → `match_key(s)`, 요건 문구 = `requirement_text`, `RequirementInfo.category/importance` 선택값, **보완점 버튼의 return params = `{insight_id, insight_item_key}`**(4.24 #14 호출 쪽), "관련 요건" 링크용 `requirementId` = null | 3·7 |
| `components/applications/cover-letter/insight-tab.tsx` | 과거 `jd_requirements` 보조 맵 삭제, `rawTextEdited` = 미리 보기만 | 3 |
| `components/applications/cover-letter/jd-tab.tsx` | 요건 있는 공고 잠금 안내 = `?state=raw-has-requirements` 미리 보기만 | 2 |
| `lib/mock/fixtures.ts` | JD 행에서 추출 컬럼 삭제, 인사이트 1을 schema 2(MT-n)로, 2를 `raw_text_hash`, `jd_requirement` 근거 1행 → `jd_sentence` | 9 |

`lib/data/`(백엔드 소유) 변경: `applications-real.ts`(생성 결과 + 자동 시작 필드, JD 조회 `raw_text_locked_reason`, 원문 수정 → `updateJdRawText`, `getJdRequirement` = null, `normalizeInsightResult` schema 2·schema 1 빈 목록), `applications.ts`(mock 원문 수정 규칙 = 인사이트 진행 중만 잠금, `CreateApplicationResult`, 요건 판정 삭제), `ai-jobs.ts`(mock 단계 1 = JD 문장에서 MT-n, `match_stage_result {prompt_version, items}`), `evidence*.ts`·`deletion.ts`·`labels.ts`(`jd_requirement` 삭제).

### UI 요청 (하지 않은 화면 변경 — resumate-ui로)

| # | 4.24 UI | 요청 |
|---|---------|------|
| U1 | 1 | S-14 ② **마감일 칸(일 단위) 신설** — `createApplicationAction`은 이미 `deadline`을 받는다(지금 화면은 `deadline: null`). AI 연결 시 "인사이트를 자동으로 만들어요" 안내 줄(C-19), `jd_no_sentences` 문구, `previewJobId`·`requirementCount`·`extracting` 단계·`form-draft`의 미리 보기 키 정리. `insight_job_id`가 있으면 문항 설정 상태에 "인사이트를 만드는 중이에요" |
| U2 | 2 | S-46 채용 공고 탭: 요건 목록 열(`JdView`의 `requirements/techKeywords/seniority/requirementsSlot`)·`JdLockedNotice`·`?state=raw-has-requirements` 삭제, [공고 내용 수정] 늘 보이고 `raw_text_locked_reason = job_in_progress`면 비활성 + "인사이트를 만드는 중에는 수정할 수 없어요", 원문 강조 `?tab=jd&s=S3,S4`, 저장 거부 미리 보기 코드(`jd-raw-edit.tsx`의 `jd_raw_text_locked` 예시)를 새 코드로 |
| U3 | 3 | S-46 인사이트 탭: 판정 표 = `requirement_text` + "공고 원문" 링크(`sids` 전체 강조), 카테고리·핵심 배지 표시 삭제, `schema_version = 1` → "공고 처리 방식이 바뀌어 다시 만들어야 해요" + [다시 생성](본문 없음 — 지금은 빈 표가 나온다), 원문 변경 stale 표시("공고가 바뀌었어요 — 다시 생성", 실제 경로는 `getInsightState`에 아직 stale 값이 없음 → 필요하면 `getInsight` 액션의 `staleReasons.rawText` 사용 또는 data 함수 추가 요청), 자동 시작 진행·완료 토스트, `jd_sentence` 칩은 rawText stale이면 강조 안 함, `isInputCausedJdFailure`·`routes.coverLetter({cause: "not_a_jd"})`·`extractFirst`·`EXTRACT_FIRST_NOTE` 정리 |
| U4 | 4 | 자소서 작성: "AI가 읽는 내용" = 커리어 + 최신 인사이트 + 대화, 인사이트 없음/만드는 중 안내 줄 |
| U5 | 5 | `question-proposal-card.tsx:274`의 `jd_requirement` "공고 요건에서" 칩 분기 삭제(자소서에 JD 출처 없음), C-01·C-11·C-15의 `REQ` 칩 삭제 |
| U6 | 6 | C-03 인사이트 진행 문구(`match` "요건별로 내 커리어와 맞춰 보는 중", 처리 단위 없음), AI-01 진행 문구·`ai-progress.tsx` `jd_extraction: 15`, C-20 `not_a_jd` 행(`ai-error-notice.tsx`·dev 갤러리) 정리 |
| U7 | 7 | S-16 보완점 → S-10: "관련 요건" 줄을 `insight_id`·`insight_item_key`로 다시 만들기(지금 `RelatedRequirement`는 `jd_requirements`를 읽어 늘 비어 있음 — `getJdRequirement`·`JdRequirement` 타입 삭제와 함께), `AI_FEATURE_NAMES`의 "요건 정리", C-05 "JD·요건" → "공고" |
| U8 | 8 | 사용량 표: 과거 기록이 있는 달에만 맨 아래 "JD 요건 추출(종료)" 행(지금 라벨 "채용 공고 분석(이전)", 늘 표시) |
| U9 | 9 | mock: `MockDb.jd_requirements`·`next_jd_extraction_failure`·`jd_extraction` 견본 작업 정리, mock 생성의 자동 시작 흉내(지금은 늘 `ai_not_connected`) |

### 새 환경 변수

없음.

---

## 정렬 QA 1라운드 수정 (2026-11-16, `03_backend-qa_report.md` "정렬 라운드 1" QA-06·07·09)

| 이슈 | 수정 |
|------|------|
| QA-06 인사이트 `jd_sentence` 칩이 `staleReasons.rawText`를 안 따름 | `services/insight/read.ts` — `staleReasons.rawText`가 true면 그 인사이트의 `jd_sentence` 칩을 **`state: "changed"`**(이미 `deleted`면 그대로)로 내리고 `target`의 `sid`·`start`·`end`를 **null**로 비운다(옛 분할 오프셋으로 강조하지 않게, DM 2.6.1·2.7.0·11.11 (5)). 헬퍼 `withRawTextStale` export. 커리어 칩은 그대로. 공용 `services/evidence`의 "`jd_sentence`는 늘 current" 규칙은 그대로 두고 인사이트 조회에서만 덮는다(원문 해시 비교는 인사이트 행이 있어야 가능). 문구·강조 끄기 화면 처리는 UI 요청 U3. mock(`lib/data/evidence.ts`)은 stale 개념이 없어 손대지 않음 |
| QA-07 원문 수정 전에 실패한 인사이트 작업 재시도 → 매번 `stalled` | ① `services/insight/job.ts` `insightRetryBlocked(db, job, readHash?)` 신설 — `hasPreR17Checkpoint` **또는** prepare 스냅숏 `rawTextHash` ≠ 현재 `job_descriptions.raw_text_hash`면 재시도 거부. 정의의 `retryBlocked`가 이걸 쓴다 → 러너 409 `ai_job_not_retryable`(테스트용 `loadRawTextHash` 의존성 추가). ② `jobs/status.ts` `loadRetryBlocked(job, db)` 신설(실패한 insight 작업만 DB 읽기), `GET /api/ai-jobs/{id}`가 넘겨 **`canRetry: false`, `retry: null`**. ③ 실행 중 해시 불일치(`contextFor`)와 AI의 `requirements_changed`도 `stalled` → **`AiError("canceled")`**(DM 2.6.1 "해시 불일치 = stale_run → canceled", 새 error_code 없음). 같은 원문으로 되돌리면 재시도 다시 허용 |
| QA-09 낡은 주석·테스트 이름 | `contracts/errors.ts`(phase-2 → 4.24 #8 영구 유지), `contracts/draft.ts` 2곳(`jd_not_extracted`·`extraction_in_progress` 언급), `insight.integration.test.ts` 제목(`jd_text_hash` → `raw_text_hash`), `application.integration.test.ts` 제목('{회사명} 자기소개서'), **UI** `components/common/return-target.ts` insight params 설명 → `{ insight_id, insight_item_key }`(UI 소유 파일 최소 수정, 주석만) |

테스트: `insight/read.test.ts`(QA-06: rawText stale → `jd_sentence` 칩 changed·locator null, 커리어 칩 current, 안 바뀌면 그대로, deleted 유지), `insight/job.test.ts`(실행 중 원문 변경 → canceled, `requirements_changed` → canceled, QA-07: 실패 뒤 해시 변경 → `insightRetryBlocked` true·상태 `canRetry: false`·재시도 409·호출 없음 → 되돌리면 재시도 성공, prepare 없음/JD 없음/다른 job_type은 막지 않음), `insight/insight.integration.test.ts`(실제 DB: billing_required로 실패 → 원문 수정 → `jd_sentence` 칩 changed·locator null, `loadRetryBlocked` true, `retryJob` 409 → 되돌리면 칩 current; 삭제 영향 기대값 주석 정리 — 그 실패 행은 근거가 없어 세지 않음).

`[가정 R17b-api-9]` QA-07은 "막기"와 "취소로 끝내기"를 **둘 다** 했다: 상태·재시도 경로는 미리 막고(사용자에게 "다시 생성"), 그래도 실행 중에 불일치가 나면(경합) `canceled`. 공급자가 바뀌어 처음부터 다시 도는 재시도(A1)도 해시가 바뀌었으면 막는다(단순함 우선 — 새 실행은 "다시 생성").

재실행: `tsc --noEmit` 0, `pnpm lint` 0, `vitest run` **160 파일 / 2666 테스트 통과**(로컬 Supabase). `src/server/ai`는 건드리지 않음(QA-08은 ai-pipeline-engineer).
