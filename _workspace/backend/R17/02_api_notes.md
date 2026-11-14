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
