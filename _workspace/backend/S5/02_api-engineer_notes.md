# S5 API 구현 노트 (지원 프로젝트·JD, AI-01)

> 상태: 완료. `pnpm typecheck`, `pnpm lint`(경고 0), `pnpm test`(62 파일, 로컬 스택 통합 포함), `pnpm build` 통과. 커밋하지 않음.
> 연결(wiring): UI 화면(S-13, S-14, S-31, S-15, S-39) 없음 → A3 applications, A4 board "연결 대기".

## 엔드포인트 (DM §7 ↔ 파일)
| 작업 | 방식 | 파일 · 함수 |
|------|------|-------------|
| 기업 JD 추가 (S-14) | Server Action → RPC `create_application_project` | `src/server/actions/application.ts` `createApplicationProject` |
| 이름·마감일·메모 수정 (S-31) | Server Action → `application_projects` update(사용자 grant 3컬럼) | `updateApplicationProject` |
| 삭제 (FL-06) | Server Action: 진행 중 `ai_jobs`에 `request_ai_job_cancel` → delete | `deleteApplicationProject` |
| 단계 이동 (C-12, 드래그) | Server Action → RPC `move_application_stage` | `moveApplicationStage` |
| 결과 기록 (C-13) | Server Action → RPC `set_application_outcome` | `setApplicationOutcome` |
| 목록 (S-13) / 보드 (S-39) / 허브 (S-31) / JD·요건 (S-15) | 서비스(Server Component용) + 같은 이름 액션 | `src/server/services/application/read.ts` `listApplicationProjects`, `getBoard`, `getApplicationHub`, `getJdView` |
| JD 요건 추출 (AI-01, 동기) | Route Handler `POST /api/application-projects/[id]/jd-extraction` | `src/app/api/application-projects/[id]/jd-extraction/route.ts` → `services/application/extraction-response.ts` `runJdExtraction` |
| 선행 추출 (D-30, S6–S8 첫 단계) | 서비스 | `services/application/extraction.ts` `ensureJdExtracted(deps, applicationProjectId)` |
| AI-12 게이트 요건 (R-31) | 턴 의존성 | `services/writing-chat/pipelines.ts` `loadGateRequirements` → `WritingChatTurnInput.gateRequirements` |
| 대화 시작 소유 확인 | 서비스 | `services/writing-chat/chat.ts` `startWritingChat` → `assertApplicationProjectOwned` |

- 서비스(Next 비의존): `services/application/` — `write.ts`, `read.ts`, `extraction.ts`, `extraction-response.ts`, `db.ts`(JD 읽기·begin/apply/fail RPC 래퍼, 소유 확인).
- 운영 연결(Next): `src/server/jobs/jd-extraction.ts` `createJdExtractionDeps` — S3b·S4와 같은 연결 경로(`connections()`), AI-01은 `extractJdRequirements`.

## 계약 (`src/lib/contracts/application.ts`, `enums.ts`)
- enums 추가: `APPLICATION_STAGES`, `STAGE_OUTCOMES`, `INTERVIEW_STAGES`, `STAGE_EVENT_TYPES`, `NAME_SOURCES`, `JD_FIELD_SOURCES`, `JD_EXTRACTION_STATUSES`, `REQUIREMENT_CATEGORIES`, `REQUIREMENT_IMPORTANCES`, `REQUIREMENT_ORIGINS`.
- 생성 입력 `{ id(uuid), rawText(공백만 거부, ≤ 50,000), companyName?, positionTitle?(≤ 200), name?(≤ 100), deadline?(YYYY-MM-DD) }`. 빈 문자열은 없는 값. 원문은 trim하지 않고 그대로 저장(문장 오프셋 기준).
- 생성 결과 `{ applicationProjectId, jobDescriptionId, name, nameSource, displayName, extractionStatus, shouldExtract, created, warnings }`.
  - `shouldExtract` = RPC `ai_run_allowed` && 상태 pending/failed. 화면은 true면 바로 추출 라우트를 부른다.
  - `warnings`: `short_jd`(< 200자), `long_jd`(> 24,000자). 저장은 막지 않는다.
  - `created: false` = 같은 id 재시도(입력 무시).
- 수정 `{ id, name?, deadline?: date|null, memo?: string|null }`. 빈 이름 거부, 바꿀 것이 없으면 거부, 빈 메모는 null.
- 단계 이동 결과 `{ applicationProjectId, stage, stageOutcome, stageChangedAt, changed, interviewPrompt: {interviewType:'job'|'culture_fit', inProgressSessionId:null} | null }`. 키 없음 변형은 화면이 S3b 연결 상태로 판단.
- 결과 기록 `{ id, outcome: 'passed'|'failed'|null }`(null = 결과 지우기 [가정]).
- 목록 행 = 보드 카드 `ApplicationProjectListItem`: 이름·`displayName`(name → "회사명 – 포지션명" → "새 기업 JD"), 회사명·포지션명, 마감일, 단계·결과·이동 시각, `lastActivityAt`, `extractionStatus`, `progress`.
  - `progress`는 이번에 `{ insight:'none', draftCount:0, interviewCount:0, interviewInProgress:false }` 고정. 확장 지점 `read.ts` `loadProgress`(S6–S8).
- 보드 `{ columns: 6개(고정 순서, 열마다 count, cards는 stage_changed_at desc), total }`.
- 허브 = 목록 행 + `memo`, 회사명·포지션명 source, `jd: { jobDescriptionId, extractionStatus, requirementCount, extractionProvider, extractionModel }`.
- JD 보기 `JdView`: 원문, 문장, 언어, 회사명·포지션명(+source), 상태, 요건(`id, category, content, keywords, importance, sourceSids, sortOrder, origin, isUserEdited`), 기술 키워드, `seniority`, `isLikelyJd`(false → S-15 경고), `extractionWarnings`, `extractedBy`(C-19 배지), `lastFailure`(상태 failed일 때 최근 실패 작업: SSE `error` 필드 + `jobId`, `failedAt`).
- 추출 라우트 응답 (200 `{ data }`):
  - `{ status:'succeeded', jobId, jd }`
  - `{ status:'failed', jobId | null, error, jd }` — `error` = SSE `error` 이벤트 필드(`code, category, failureCause, message, retryable, retryAfter, quotaResetsAt`). 연결 게이트(작업 생성 전)는 `jobId: null`.
  - JSON 오류: 401, 404 `not_found`, 409 `already_extracted`(D-19, 재추출은 실패 재시도뿐), 409 `extraction_in_progress`.

### 오류 코드 (`src/server/db/errors.ts`)
- 404 `not_found`: `application_project_not_found`, `job_description_not_found`.
- 409: `already_extracted`, `extraction_in_progress`, `not_closed`, `user_edited_requirements_exist`, `application_project_id_conflict` → `conflict`.
- 400: `invalid_outcome`(자기 코드 유지, "전형 종료에서만"), `invalid_input` ← `invalid_id`, `invalid_raw_text`, `invalid_name`, `invalid_company_name`, `invalid_position_title`, `invalid_stage`.
- 500 `internal_error`(서버가 만든 인자): `invalid_raw_text_hash`, `invalid_sentences`, `invalid_extraction_result`.

## 동기 추출 흐름 (`ensureJdExtracted`)
1. JD 읽기(사용자 세션, RLS = 소유) → 없으면 404, `succeeded`면 `already_extracted`(작업 없음).
2. 연결 게이트: 활성 공급자·키·실행 동의(`providerContext`). 없음/동의 필요 → `key_missing`, 무효 → `key_invalid`. 작업·호출 없음.
3. `ai_jobs` insert(`jd_extraction`, `target_type = job_description`, `application_project_id`, 경량 등급, 공급자·등급 고정). 같은 JD 진행 중이면 409 `extraction_in_progress`. 단, 그 작업의 heartbeat가 45초 넘게 없으면 `failed/stalled`로 닫고 새로 만든다(키 검증과 같은 방식).
4. claim → `check_ai_run_allowed`(막히면 작업 failed + 그 코드, 호출 없음).
5. `begin_jd_extraction`. 거부(`already_extracted` 등)면 작업 `canceled`.
6. AI-01 호출(30초 상한, 호출 캡 유료 25초·무료 28초). 재시도: 즉시(timeout 1회)는 바로, 대기 5초 이하는 요청 안에서 대기 후, 그 밖은 최종 실패 + C-11.3 최종 `retry_after`. `schema_invalid`·`not_a_jd`는 파이프라인이 재시도 불가로 던진다.
7. 성공 → `ai_jobs.prompt_version`·`model` 기록 → `apply_jd_extraction(p_result = payload, run_generation)` → `complete_ai_job`.
   - `applied:false`(늦은 실행) → 작업 `canceled`.
   - `job_description_not_found`(삭제) → `canceled`.
   - 그 밖 DB 오류 → `fail_jd_extraction` + `stalled`.
8. 실패 → `fail_jd_extraction` + 작업 `failed`(`error_code`, `retry_after`/`quota_resets_at`).
9. 모든 경로: 호출마다 사용 기록 1행(`feature = jd_extraction`, `settle`). 키 상태: key_invalid → 무효, 다른 키 원인 → `recordFailure`, 성공 → `recordSuccess`.
- heartbeat(10초): `cancel_requested_at` 또는 행 없음(삭제 연쇄) → 호출 중단, `canceled`.
- 클라이언트 끊김으로는 중단하지 않는다(결과 저장 우선, spec-gaps ③).
- 로그: 작업 id·코드·개수만. JD 원문·키 없음(통합 테스트가 확인).

### 삭제 후 실행기 쓰기 (확인 항목)
- 비동기 실행기(`runner.ts`): 행이 사라지면 `heartbeat` → `current:false` → 단계 abort("lost"), 쓰기 0행 → `LostJob` → `lost`로 끝난다. 호출을 더 하지 않고 `settle`로 사용 기록만 남긴다 = canceled와 같은 결과. 실행 게이트(`check_ai_run_allowed`)가 `ai_job_not_found`로 실패해도 `finish`가 0행 → `lost`. **고칠 것 없음.**
- **고친 것**: 사용 기록 insert가 삭제된 프로젝트의 복합 FK에 걸리면(23503) 기록이 사라졌다(재시도 2회 후 로그만). `supabase-usage.ts`가 23503이면 `application_project_id = null`로 다시 넣는다. 통합 테스트로 확인.
- 범용 재시도 라우트는 `jd_extraction`을 409 `ai_job_not_retryable`로 거부한다(등록된 단계가 없어 `stalled`로 끝나던 경로를 막음).

## AI-12 연결 (R-31)
- `pipelines.ts` `loadPackInputs`: `return_target`이 있으면 readiness와 함께 `loadGateRequirements(writer, application_project_id)` → `WritingChatTurnInput.gateRequirements`.
  - 요건 행 `(id, category, content, keywords, importance, sort_order)`, `skillNames` = `normalized_name ?? name`, `texts` = 완료 프로젝트(name, role, summary)와 완료 상세 내용(title, S/T/A/R). `learnings`는 넣지 않았다(V-8 취지).
  - JD 없음·요건 없음·삭제·다른 사용자 → `[]`(블록 없음). 응답 호출에만 붙는다(ai 쪽 규칙).
- 대화 시작: `returnTarget.applicationProjectId`가 본인 것이 아니면 404 `not_found`(RLS 읽기).

## 테스트
- `services/application/extraction.test.ts`(19, 가짜 공급자 + 실제 createLlm + 실제 AI-01 파이프라인): 성공(경량 1회, payload·세대, 사용 기록 1행, 키 비노출), 사용자 입력값만 모델에, 이미 추출됨, 없는 프로젝트, 연결 게이트 3종, 실행 게이트, 진행 중 409·죽은 작업 교체, begin 거부, timeout 즉시 재시도, 짧은 rate_limited 대기, 긴 대기 → 최종 retry_after ≥ 1분 + 키 실패 기록, 일일 한도, key_invalid, not_a_jd, 수동 재시도, 삭제(apply not_found / 늦은 실행 / heartbeat 행 없음) → canceled + 사용 기록 유지.
- `services/application/application.integration.test.ts`(9, 로컬 스택): 키 없이 생성(기본 이름, 문장 오프셋 = 원문, 멱등) / 회사명·포지션명 이름 + 짧은 JD 경고 / 다른 사용자 RLS(읽기·이동·삭제·대화 시작) / **동기 추출 전체**(실제 begin/apply RPC: 요건 6개, 이름 default → ai, 회사명 ai, 배지, 작업 succeeded, 사용 기록, 409, 로그 원문·키 없음) / 실패 후 원문 유지·`lastFailure` / 단계 이동·결과 규칙·이력 6건(`from_outcome` 보존) / 보드·목록 정렬·필터·수정 / R-31 요건 선별(다른 사용자 빈 목록) / **삭제**(취소 요청 1건, 연쇄, 사용 기록 null 유지, 삭제 후 늦은 사용 기록 insert 유지).
- `lib/contracts/application.test.ts`(5): 입력 경계·경고·표시명.
- `runner.test.ts`: 범용 재시도 거부에 `jd_extraction` 추가.
- 실행: `pnpm test`(통합은 `supabase start` 상태에서 자동), 이 슬라이스만 `pnpm vitest run src/server/services/application src/lib/contracts/application.test.ts`.

## 스펙 차이·가정 (spec-gaps 2026-10-31 S5 (api))
- 동기 추출의 재시도 대기는 5초 이하만 요청 안에서, 나머지는 최종 실패 + `retry_after`.
- 실패 응답은 200 + `status:'failed'`(SSE `error` 필드 모양), 이미 추출됨·진행 중은 409.
- 클라이언트 끊김으로 추출을 중단하지 않는다.
- 삭제 후 사용 기록은 FK 위반 시 project null로 다시 넣는다.
- 범용 재시도에서 `jd_extraction` 제외.
- 계획서 `[가정]` 1~8은 db·ai와 같이 그대로 따름(이름 규칙은 DB가 판단, 경고 기준 200/24,000자 등).

## 다른 담당자와의 인터페이스
- db: 노트 시그니처 그대로 사용(`apply_jd_extraction`의 `p_run_generation`, 반환 `applied`, `create_application_project`의 `ai_run_allowed`·`created`). 요청 없음.
- ai: `extractJdRequirements` 결과의 `payload`를 `p_result`로 그대로 넘긴다. 초기에 db·ai 노트의 `p_result` 모양(회사명 객체/문자열, `sort_order` 0/1 기준)이 달라 리더에게 알렸고, 리더가 맞춰졌다고 확인했다. 통합 테스트(실제 RPC)가 통과한다.
- ai: AI-12 응답 prompt_version v2 변경 — api 테스트 중 버전 값을 고정한 것은 없어 수정 없음.

## 남은 일
- UI 연결(S-13, S-14, S-31, S-15, S-39): 액션·읽기 서비스·추출 라우트.
- S6–S8: `loadProgress` 채우기, 각 작업 첫 단계에서 `ensureJdExtracted` 호출(같은 deps), `get_deletion_impact`의 지원 프로젝트 집계, C-14 `inProgressSessionId`.

## QA 1차 반영 (2026-10-31, `03_backend-qa_report.md`)
| 이슈 | 반영 |
|------|------|
| QA-S5-01 [Major] | 리더 결정: DB가 빈 `sentences`를 받고 ai가 분할기를 고친다. api 쪽은 바꾼 코드 없이 확인만 했다. 기호만 있는 원문도 생성은 성공한다(500 없음). 문장 0개 JD의 추출은 파이프라인이 호출 없이 `not_a_jd`를 던진다. 그 결과 `failed` 본문(`input` 범주, `retryable:false`)이 나오고, 공급자 호출과 사용 기록은 0, JD는 `failed`, `lastFailure = not_a_jd`다. 단위 테스트 1개와 통합 테스트 1개를 추가했다 |
| QA-S5-02 [Major] | (1) `user_edited_requirements_exist`: 작업을 `canceled`로 닫기 **전에** `fail_jd_extraction`을 불러 JD를 `failed`로 둔다. 응답은 409 그대로다. DB 트리거(작업이 성공 아닌 상태로 끝나면 `running` JD → `failed`)와 이중 방어다. (2) 읽기: 실패 표시는 JD의 `extraction_job_id` 작업에서 읽는다. 대상 상태는 failed와 canceled이고, 코드가 없는 canceled는 `canceled`로 본다. 예전에는 "그 프로젝트의 최근 failed 작업"을 읽었다. `getJdView.lastFailure`와 함께 목록·보드·허브 행에 **`lastExtractionFailure`**(새 필드, JD가 `failed`일 때만)를 추가했다. (3) 통합 테스트: begin → 작업을 `failed/stalled`로 닫으면(sweep과 같은 끝) JD `failed`, `lastFailure.code = stalled`(보기·목록·허브)가 되고, 같은 라우트로 복구된다 |
- 계약 변경: `ApplicationProjectListItem.lastExtractionFailure: JdExtractionFailure | null`. 보드 카드와 허브에도 들어 있다.
- db 트리거 `ai_jobs_release_jd_extraction`(작업 failed/canceled → `running` JD `failed`)와 함께 확인: 통합 테스트는 작업을 `failed/stalled`로 닫는 것만으로 JD가 `failed`가 되는지 본다(api 읽기 계산 없이). api의 `fail_jd_extraction` 선호출은 그대로 둔다. 트리거가 먼저 처리했으면 `false`를 받고, 결과는 같다.
- 검사: typecheck, lint(경고 0), vitest 61 파일 1,021개 통과. 통합 테스트는 skip 0이고 S5 통합 11개를 포함한다. 커밋하지 않음.
