# S7 API 구현 노트 (서류 초안: AI-11 · AI-03 · AI-04)

> 상태: 구현 완료. `pnpm typecheck`·`pnpm lint` 통과, `pnpm test` 77 파일 1237개 전부 통과(로컬 스택 통합 포함, skip 0). 커밋하지 않음.
> 연결(wiring): UI 화면(S-17/S-18/S-19) 없음 → "연결 대기".

## 엔드포인트 (DM §7 / 계획 "계약 — API" ↔ 파일)
| 작업 | 방식 | 파일 · 함수 |
|------|------|-------------|
| 기본 선택 (AI-11, 동기) | Route Handler `POST /api/application-projects/[id]/draft-source-ranking` | `src/app/api/application-projects/[id]/draft-source-ranking/route.ts` → `services/drafts/ranking.ts` `rankDraftSourcesForProject` |
| 경력기술서 생성 (AI-03, SSE) | Route Handler `POST /api/application-projects/[id]/career-descriptions` | `.../career-descriptions/route.ts` → `services/drafts/career-description.ts` `prepareCareerDescription` / `runCareerDescription` |
| 자소서 문항 생성·다시 생성 (AI-04, SSE) | Route Handler `POST /api/draft-sections/[id]/generate` | `src/app/api/draft-sections/[id]/generate/route.ts` → `services/drafts/cover-letter.ts` `prepareCoverLetterSection` / `runCoverLetterSection` |
| 자소서 만들기(시드 3문항)·문항 추가/수정/삭제/순서·메모·글자 수·근거 변경 | Server Actions | `src/server/actions/draft.ts` `createCoverLetterDraft`, `addCoverLetterQuestion`, `updateCoverLetterQuestion`, `deleteCoverLetterQuestion`, `reorderCoverLetterQuestions`, `setSectionSources` → `services/drafts/cover-letter.ts` |
| 편집·복사·이름 바꾸기·삭제 (키 불필요) | Server Actions | `saveSectionEdit`, `markDraftCopied`, `renameDraft`, `deleteDraft` → `services/drafts/edit.ts` |
| 조회 S-17 / S-19 | 서비스(Server Component용) + 같은 이름 액션 | `services/drafts/read.ts` `listDrafts`, `getDraft`; 액션 `listDrafts`, `getDraft` |
| 진행 표시 서류 초안 수 | `loadProgress` 확장 | `services/drafts/progress.ts` `loadDraftCounts` ← `services/application/read.ts` |
| 운영 연결 | deps·파이프라인 어댑터 | `src/server/jobs/drafts.ts` `createDraftAiDeps`, `productionDraftPipelines`; `src/server/drafts-sse.ts`(SSE + `after()`), `src/server/request-body.ts` |

- 공통 실행 뼈대: `services/drafts/ai-run.ts` — `openAiJob`(연결 게이트 → ai_jobs insert(대상당 진행 중 1개, heartbeat 75초 끊긴 작업은 `stalled`로 닫고 교체) → claim → 실행 게이트) + `AiRun`(heartbeat·취소, 호출마다 Llm + 사용 기록, C-11.3 즉시/짧은 대기 재시도, 스트림은 첫 이벤트 전만 재시도, succeed/fail/close + 키 상태 보고). 세 경로가 같이 쓴다. Next 비의존.
- 인터페이스: `services/drafts/types.ts`(`DraftAiDeps`, `DraftPipelines`), DB: `services/drafts/db.ts`(입력 읽기, `DraftStore` = begin/complete/fail RPC 래퍼), 블록: `services/drafts/blocks.ts`.

## 계약 (`src/lib/contracts/draft.ts`, `enums.ts`, `ai.ts`)
- enums: `DRAFT_TYPES`, `DRAFT_STATUSES`, `DRAFT_SECTION_KINDS`, `DRAFT_SECTION_STATUSES`, `COVER_LETTER_TEMPLATE_KEYS`, `COUNT_BASES`, `SOURCE_SELECTION_MODES`, `QUESTION_CLASSES`, `DRAFT_BLOCK_KINDS`, `DRAFT_SOURCE_ROLES`, `DRAFT_SOURCE_ORIGINS`, `SELECTION_ORIGINS`, `RANKING_RELEVANCES`. `DRAFT_TONES = concise | detailed` [가정].
- `ai.ts` `AI_STREAM_EVENT_TYPES`에 `sources_selected`, `adjusting_length` 추가(파이프라인 목록과 같음, support.test가 비교).
- 기본 선택: 입력 `{ refresh?: boolean }`. 응답 `DraftSourceRankingResponse` `{ origin: insight|ai_ranking|fallback, fallback, reused, jobId, insightId, includedExperienceIds, includedEducationIds, includedProjectIds, projectOrder, ranking[]|null, fallbackReason }`. 422 `{ error: insufficient_data, readiness }`(`features.draft`).
- 경력기술서 입력 `CreateCareerDescriptionInput { includedExperienceIds, includedEducationIds, includedProjectIds(≤8), projectOrder, selectionOrigin, tone?, regeneratedFromId? }`(빈 선택 400, 계획 결과가 비면 422 `empty_selection`).
- SSE 이벤트 `DraftStreamEventSchema`(종료 `done` / `error` 1개):
  - `generation_started { jobId, draftId, sectionId|null, provider, model, modelTier, connectionTier }`(C-19 배지)
  - `preparing { stage: "jd_extraction" }`(D-30)
  - `sources_selected { sectionId, selectionMode, questionClass, sources[] }`(AI-04)
  - `block_started` / `block_delta` / `block_completed { block: StreamedDraftBlock(evidence 포함) }`
  - `adjusting_length { sectionId, charCount, charLimit, countBasis, reasons }`(AI-04, 보정 시)
  - `validated { result, validationReport }` — 저장된 최종본. **스트리밍 블록 id는 모델 id라 최종 id와 다를 수 있다 → 화면은 `validated`에서 블록 전체를 바꾼다**(ai ⑧).
  - `done { draftId, sectionId, reused, meta }` / `error`(S3 공통 모양)
  - 순서: AI-03 `generation_started → (preparing) → 블록 → validated → done`, AI-04 `(preparing) → generation_started → sources_selected → 문단 블록 → (adjusting_length) → validated → done`.
- 액션 입력: `CreateCoverLetterDraftInput`, `AddCoverLetterQuestionInput`, `UpdateCoverLetterQuestionInput`(생략 = 그대로, `template_key` 유지), `DeleteCoverLetterQuestionInput`, `ReorderCoverLetterQuestionsInput`(전체 id), `SetSectionSourcesInput`(0~5개, `{projectId?, experienceId?, educationId?, projectDetailIds?, role?, requirementIds?}`), `SaveSectionEditInput { sectionId, blocks: [{blockId, text}] }`, `DraftIdInput`, `RenameDraftInput`(1~100자), `ListDraftsInput`, `GetDraftInput`.
- 조회: `DraftList { drafts: DraftListItem[] }`(최신순, 문항 수·ready 수, 출처, 배지, `generating`), `DraftView { options, badge, sections: DraftSectionView[], activeJobs, failures }`. 섹션은 블록(`text` 편집본 우선 + `aiText` 원본, `userModified`, `placeholders`, `flags`, 근거 칩 `item_key = block_id`), C-11 sources(현재 이름 `affiliationName`·`projectName`·`detailTitles`, `sourceLabel`/`sourceDeletedAt`, 선택 이유 근거 `sources.{n}`), `currentCharCount`(AI-04와 같은 세는 법), `flags`(`validation_report.char_adjust_needed` → `char_adjust_needed`), `notesForUser`.
- 오류 코드 추가(`src/server/db/errors.ts`): `draft_not_found`·`section_not_found` → 404 `not_found`, `last_question` 409, `section_generating` 409, `section_in_progress` 409, `question_limit_reached` 409, `invalid_section_order` → 409 `conflict`, `invalid_sources` → 400, `source_not_found` 409, `invalid_title`·`invalid_question`·`invalid_draft_options`·`invalid_draft_sections` → 400, `draft_id_conflict`·`section_id_conflict` → 409, `invalid_draft_payload` → 500. 서비스 코드: `empty_selection` 422, `nothing_to_edit` 409, `extraction_in_progress` 409.

## 작업 흐름
- **AI-11**: 소유 → readiness(422) → (1) 최신 인사이트 `project_priorities`(호출 없음) → D-30 추출(실패 → 대체) → 연결(없으면 대체) → (2) 같은 해시의 성공 작업 `ai_jobs.output` 재사용 → (3) `draft_source_ranking` 작업(대상 프로젝트, 경량, 단계 `rank`) → 성공이면 `output`·모델 저장 후 `complete_ai_job`. 실패는 모두 조용한 대체(`fallbackSelection`).
- **AI-03**: prepare(JSON 오류) → 스트림 안에서 (`preparing` + 추출) → 작업(`target_type = draft`, `target_id` = api가 만든 새 초안 id) → `begin_career_description`(`planCareerDescription`의 섹션) → `generation_started` → `streamCareerDescription`(begin이 준 섹션 id) → 파이프라인이 `persist` = `complete_career_description`(`hashes.input_hash`는 api 재사용 키로 덮어씀, `applied:false`면 throw → error) → `validated` → `complete_ai_job` → `done`. 실패 → `fail_career_description` + 작업 failed(retry_after / quota_resets_at) + `error`.
- **AI-04**: prepare에서 작업을 연다(문항당 1개 → 409 `section_in_progress`, 실행 게이트 거부 → SSE `error` 1개). 스트림 안: (추출) → 입력(요건, 커리어, 사용자 근거(user 모드), 다른 문항 주 근거, 인사이트 신호, `other_sids`) → `begin_cover_letter_section` → 스트림(생성 + 보정 호출 = 사용 기록 2행, 미터 `cover_letter`) → `complete_cover_letter_section`(편집본 초기화) → `done`. 추출 실패로 끝나면 키 상태는 추출이 이미 보고했으므로 다시 보고하지 않는다.
- 공통: 클라이언트 끊김은 실행을 멈추지 않는다(`after()`). 함수 예산 58초 − 정리 5초. 공급자 호출마다 사용 기록 1행(실패·끊김 포함, `settle`). 로그는 id·코드·횟수만.

## 테스트
- `services/drafts/drafts.test.ts`(21, 실제 createLlm + 스크립트 공급자 + 가짜 Supabase): 기본 선택 422·인사이트·재사용·호출·실패 대체(호출 2건 기록)·키 없음/무효·D-30 실패 대체 / AI-03 이벤트 순서·RPC 순서·작업 성공·키 비노출, 422·409·잠금, 재사용, 첫 토큰 전 재시도, 공급자 실패(fail RPC·retry_after·키 실패 보고), stale_run, 끊김 후 저장, D-30 실패 / AI-04 이벤트 순서(보정 포함)·사용 기록 2행·다른 문항 주 근거·user 모드 근거·409 동시 실행·첫 토큰 뒤 실패(재시도 없음)·404/422/게이트·추출 실패 시 키 이중 보고 없음.
- `services/drafts/read.test.ts`(10): 상태 보정 규칙, 블록 뷰, 글자 수, getDraft(칩 changed·C-11 이름·실패 정보), listDrafts, 편집 저장(user_modified·edited_at)·거부 3종, 첫 복사.
- `services/drafts/drafts.integration.test.ts`(6, 로컬 스택, 실제 RPC·트리거·AI-01/03/04/11 파이프라인): 추출 → AI-11 실패 대체 → AI-11 성공(`output`) → 재사용, 사용 기록 미터; 경력기술서 저장·근거·`options.ranking` 복사·조회·로그 비노출; 같은 입력 재사용·다시 생성 새 행; 자소서 시드 → 생성 → 근거 변경(user) → 편집 → 다시 생성(편집본 초기화, generation_no 2) → 복사; 최소 1문항·다른 사용자 404·진행 수; 삭제 영향·초안 삭제·프로젝트 삭제 연쇄.
- 실행: `pnpm vitest run src/server/services/drafts`(통합은 `supabase start` 상태에서 자동).
- 테스트 도구: `src/test/fake-supabase.ts`(쿼리 빌더 흉내), `src/test/draft-fakes.ts`.

## 스펙 차이·가정
- spec-gaps "2026-11-02 · S7 (api)" ①~⑫. 계획서 `[가정]` 1~6을 따른다.

## 다른 담당자와의 인터페이스
- db: 노트 시그니처 그대로. `begin_career_description`의 `p_title`은 쓰지 않음(기본 제목). 사용자 RPC의 멱등 id 인자(`p_draft_id`, `p_section_id`)는 쓰지 않음(필요하면 화면 연결 때 추가).
- ai: `planCareerDescription` → begin → `streamCareerDescription({context, sections})`, `streamCoverLetterSection`, `rankDraftSources` / `selectionFromRankingOutput` / `selectionFromInsightPriorities` / `fallbackSelection` / 각 input_hash 함수를 `jobs/drafts.ts`에서 감쌌다.

## 남은 일
- UI 연결(S-17/S-18/S-19): 액션·조회 서비스·세 라우트, `useAiStream`이 `validated`에서 블록을 교체하도록.
- 실제 Vercel에서 끊김 후 `after()` 유지 확인(배포 때).

## QA 1차 반영 (2026-11-02, `03_backend-qa_report.md`)
| 이슈 | 반영 |
|------|------|
| QA-S7-01 [Major] 경력기술서 동시 실행 | 작업을 **스트림 전 prepare에서** 연다(대상 = 새 초안 id). 먼저 같은 지원 프로젝트의 queued/running `career_description` 작업을 찾아, heartbeat가 살아 있으면 409 `career_description_in_progress` + `error.details.jobId`(기존 작업), 75초 넘게 끊긴 작업이면 `stalled`로 닫고 새로 연다. 경합으로 DB 인덱스 `ai_jobs_career_description_in_flight_key`가 23505를 내면 저장소의 `conflict` → 같은 409(진행 중 작업 id 조회)로 바꾼다. `AppError`·`ErrorBody`에 선택 필드 `details`를 더했다(기존 응답 모양은 그대로). D-30 추출은 이제 열린 작업 안에서 돈다(추출 실패 → 그 코드로 작업 failed, 키 상태는 추출이 보고하므로 다시 보고하지 않음). 테스트: 단위(409 + jobId, 끊긴 작업 교체), 통합(실제 DB 409 + 인덱스가 경합 insert 거부) |
| QA-S7-02 [Major] 공통 재시도 | `runner.ts` `REQUEST_SCOPED_JOB_TYPES`에 `draft_source_ranking`, `career_description`, `cover_letter`를 더해 409 `ai_job_not_retryable`. `DraftFailure` 주석에 "다시 시도 = 생성 라우트 재호출". `runner.test` it.each에 3종 추가 |
| QA-S7-03 [Major] 무료 등급 간격 | `AiRun`이 무료 등급이면 Llm을 감싸 **모든 호출 직전**에 사용자·공급자 마지막 호출(이번 실행의 마지막 호출 끝 시각과 `usage.lastCallAt` 중 늦은 것) + 6초까지 요청 안에서 기다린다(최대 6초). 그래서 D-30 추출 → 생성, AI-11 앞, AI-04 생성 → 보정, "전체 생성"의 다음 문항이 모두 간격을 지킨다. 기다리면 예산이 모자라면 `timeout`을 던진다 → 보정 호출이면 ai ④대로 보정 전 초안 저장(`char_adjust_needed`). 테스트: 가짜 시계로 생성 → 보정 6초, 2초 뒤 다음 문항 4초, 유료는 대기 없음 |
| QA-S7-05 [Minor] 편집 후 자리 표시 | 저장 때 AI 블록의 자리 표시 중 **편집 텍스트에 그 토큰이 남은 것만** `placeholders`로 저장하고, 뷰도 텍스트 기준으로 거른다(`blocks.ts` `presentPlaceholders`) |
| QA-S7-06 [Minor] 모두 지운 편집 | `edited_content`가 null이 아니면 빈 배열도 편집본이다(빈 화면, `edited: true`, 글자 수 0). 정책: 블록을 모두 지우는 저장은 허용한다 |
| QA-S7-07 [Minor] 생성 중 판정 | `services/drafts/active.ts` — "이 문항(또는 초안)을 대상으로 queued/running인 작업이 있는가"로 판정한다(DB `draft_section_job_active`, 조회 `effectiveSectionStatus`와 같은 기준). 문항 수정·근거 변경·문항 삭제·편집 저장에 쓴다. prepare·추출 구간도 막히고, 작업이 끝난 `generating` 잔여 행은 막지 않는다. 테스트 추가 |
| QA-S7-08 [Minor] 잘못된 `regeneratedFromId` | prepare에서 같은 프로젝트의 경력기술서인지 확인 → 아니면 404(작업·스트림 없음). 테스트 추가 |
| QA-S7-09 [Minor] delete_results 중 진행 작업 | db가 취소 요청을 기록한다. api: 실패가 (a) `complete_*`의 `applied:false`(stale_run, 초기화·인계), (b) 대상 삭제 raise(`draft_not_found`·`section_not_found`·`invalid_ai_job`), (c) 작업에 취소 요청이 있거나 작업 행이 없음(`AiRun.stoppedFromOutside`) 중 하나면 `canceled`로 끝낸다(SSE `error(canceled)`, `stalled` 아님). 테스트 추가 |

- 검증: `pnpm typecheck`·`pnpm lint` 통과, `pnpm test` 77 파일 1246개 전부 통과(통합 7개 포함).
- 새 파일: `src/server/services/drafts/active.ts`. 바뀐 파일: `ai-run.ts`(간격·외부 중지 판정), `career-description.ts`(prepare에서 작업 열기), `cover-letter.ts`, `edit.ts`, `blocks.ts`, `read.ts`, `src/server/jobs/runner.ts`, `src/lib/contracts/{errors,draft}.ts`, 테스트·`src/test/draft-fakes.ts`(sleep이 가짜 시계를 움직이고 기록).
