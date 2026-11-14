# R17 채용 공고 AI 처리 제거 (JD 원문 그대로 사용) — 슬라이스 계획

- 날짜: 2026-11-14
- 근거: 사용자 결정 2026-11-14 "채용 공고는 AI 부분 필요 없어. 원문 텍스트 그대로만 사용". 기획 문서 개정은 별도 세션(jd-raw-planning)이 동시에 진행 → 이 슬라이스는 기획 문서를 고치지 않는다. 기획과 어긋날 수 있는 지점은 `spec-gaps.md` "R17" 절과 `R17/spec-gaps-R17.md`에 남긴다.
- 브랜치: `claude/jd-raw-text-backend-610f7b`
- URL 가져오기(`POST /api/job-descriptions/fetch`, R16 마크다운)는 AI가 아니므로 **그대로 유지**.

## 0. 영향 범위 맵 (시작 시점 grep: 148개 파일)

| 영역 | 파일 | 처리 |
|------|------|------|
| AI-01 본체 | `ai/pipelines/AI-01*`, `ai/prompts/AI-01/`, `ai/schemas/AI-01.ts`, `ai/validation/jd-extraction*`, `ai/storage/jd-extraction*`, `ai/__fixtures__/AI-01/` | **삭제** |
| JD 컨텍스트 | `ai/context-pack/jd.ts`(+test) | 요건(REQ-n)·`computeRequirementsHash` 제거, 원문 문장 전체(S-n) 블록 + `jdTextHash` |
| 게이트 요건 | `ai/context-pack/gate-requirements*`, `ai/prompts/AI-12` `<gate_requirements>`, `writing-chat/pipelines.ts` `loadGateRequirements` | **삭제** `[가정 R17-4]` |
| 입력 해시 | `ai/input-hash.ts` | `requirementsHash` → `jdTextHash`, `INPUT_HASH_VERSION` 3 |
| AI-02 | `ai/pipelines/AI-02*`, `ai/prompts/AI-02`, `ai/schemas/AI-02.ts`, `ai/validation/insight*`, `ai/storage/insight.ts`, `__fixtures__/AI-02` | 원문 문장 입력, 요건 식별+판정을 1단계 한 호출로, 결과 `schema_version` 2 (§3) |
| AI-04 | `ai/pipelines/AI-04*`, `ai/prompts/AI-04`, `ai/schemas/AI-04.ts`, `context-pack/cover-letter-chat*`, `validation/cover-letter*`, `validation/draft-blocks.ts` | 요건 블록·`requirement_refs`·`no_requirements` 알림 제거, 원문 문장 전체(S-n) (§4) |
| 오류·enum | `ai/errors.ts`, `lib/contracts/{enums,errors,ai,application,insight}.ts` | `not_a_jd`·`jd_extraction`(실행 가능 job_type)·`jd_preview` 제거. 사용량 표시용 과거 기능 값은 "legacy"로만 남김 |
| 잡 러너 | `jobs/{jd-extraction,jd-preview}.ts` 삭제, `jobs/{runner,cron,cost,insight,connections}.ts`, `services/ai-jobs` | jd_extraction 분기·미리 보기 정리 크론 제거, insight 첫 단계의 "추출 먼저(D-30)" 제거 |
| 라우트 | `api/job-descriptions/extract-preview`, `api/application-projects/[id]/jd-extraction` | **삭제** |
| 서비스 | `services/application/{extraction,extraction-response,preview}*` 삭제, `write.ts`·`read.ts`·`db.ts`·`raw-text.ts`, `services/insight/*`, `services/evidence`, `services/shell` | 생성 = 사용자 입력 + 원문만, 인사이트 = 원문 해시 |
| 데이터 계층 | `lib/data/{jd-preview-store}` 삭제, `lib/data/{applications,applications-real,ai-jobs,labels,usage-display,ai-errors,cover-letters,cover-letter-copy,deletion,evidence*,shell,account,jd-raw-text}.ts` | 계약 맞춤 |
| UI(최소) | `add-application-dialog.tsx`, `jd-view.tsx`, `extract-first.tsx`, `insight-parse.ts`, `insight-view.tsx`, `cover-letter/*`, `ai-error-notice.tsx`, `ai-progress.tsx`, dev 갤러리, `lib/mock/*`, `preview-state.ts`, `applications/_lib/*` | 컴파일·계약 깨지는 곳만. 화면 개정은 UI 후속 목록 |
| DB | 새 마이그레이션 1단(비파괴), pgTAP, 타입 | §2 |

## 1. 결정 (`[가정]` — 기획 확정 전, 가장 덜 파괴적인 안)

- **R17-1 JD 근거 = 원문 인용.** JD를 가리키는 근거는 `jd_sentence`(S-n, `job_descriptions.sentences`의 결정적 분할 — AI 아님)만 새로 만든다. `jd_requirement` 근거는 더 이상 생성하지 않는다. DB의 허용 목록에는 과거 행 때문에 남겨 둔다.
- **R17-2 `jd_requirements` 테이블 보존, 쓰기만 중단.** 테이블·트리거·삭제 경로(계정 삭제 등)·과거 근거 행은 그대로. 새로 쓰는 코드는 없다. 읽기는 과거 인사이트(v1) 표시용으로만.
- **R17-3 `job_descriptions` 추출 컬럼 보존.** `extraction*`, `requirements_hash`, `tech_keywords`, `detected_language`, `extraction_status` 컬럼은 남기고 쓰지 않는다. 새 공고의 `extraction_status`는 기본값 `pending` 그대로이며 **어떤 게이트·화면도 이 값을 보지 않는다**.
- **R17-4 AI-12 게이트 진입 대화의 JD 요건 조향 블록 제거.** 원문으로 대체할지는 기획 결정 필요(spec gap).
- **R17-5 AI-02 결과 v2.** 모델이 원문 문장에서 요건을 직접 읽어(라벨+분류+중요도+인용 S-n) 판정한다. 결과 jsonb 키 이름은 v1과 같게 두고(`requirement_matches`, `requirement_id(s)`) 값만 인사이트 내부 키 `M1…Mn`으로 바꾼다 → 화면 계약 형태 유지. 과거 v1 인사이트는 보존된 `jd_requirements` 행으로 계속 읽는다.
- **R17-6 원문 편집(`update_failed_jd_raw_text`) 그대로.** 새 공고는 `pending`이라 편집 RPC가 거부한다(화면은 실패 상태에서만 편집 버튼). 원문 편집 허용 규칙은 기획 결정 필요(spec gap).
- **R17-7 과거 `jd_extraction` 사용량·잡 행 보존.** `ai_jobs.job_type`·`ai_usage_records.feature` CHECK는 그대로(값 축소는 2단). 사용량 화면은 과거 행을 "채용 공고 분석(이전)" 라벨로 계속 보여 준다.

## 2. DB (db-engineer) — 1단 마이그레이션, 비파괴

파일: `supabase/migrations/20261113004800_r17_jd_raw_text.sql` (마지막 `…004700` 다음). **DESTRUCTIVE 아님**(데이터 삭제·컬럼 삭제·CHECK 축소 없음). 함수 삭제는 포함 — 데이터 손실이 아니라 배포 순서 문제(§6).

1. `create_application_project`: 10인자 버전 drop → `p_preview_job_id` 없는 **9인자** 재생성 `(p_id, p_raw_text, p_raw_text_hash, p_sentences, p_company_name, p_position_title, p_name, p_deadline, p_source_url)`. 미리 보기 적용 블록 삭제. 반환 jsonb에서 `extraction_status`·`preview_applied`·`preview_skip_reason` 제거 → `{application_project_id, job_description_id, name, name_source, ai_run_allowed, created}`. 이름 규칙: `p_name` → 없으면 기업명으로 compose → 둘 다 없으면 `application_fallback_name`(키 유무와 무관하게 — 추출이 이름을 채우던 경로가 사라졌으므로) `[가정 R17-8]`. 게이트(key_invalid, ai_consent_required)는 그대로 유지할지: 생성 자체는 AI를 안 쓰므로 **게이트 제거** `[가정 R17-9]`(공고 등록은 키 없이도 된다). grant 동일.
2. 삭제: `public.begin_jd_extraction`, `public.apply_jd_extraction`, `public.fail_jd_extraction`, `public.purge_unused_jd_preview_outputs`, `private.jd_apply_extraction_result`, `private.jd_extraction_job_matches`, `private.jd_extraction_mark_failed`, `private.jd_extraction_result_valid`. (참조하는 다른 함수가 없는지 확인 — `update_failed_jd_raw_text`가 쓰면 그 부분만 재정의.) `private.ai_jobs_release_jd_extraction` 트리거는 남겨도 무해하면 남김(판단은 db-engineer, 남기면 이유를 notes에).
3. `begin_insight`: `jd_not_extracted` 게이트 → "프로젝트에 JD 행이 있는지"만 확인, 없으면 `job_description_not_found`.
4. `insights`: 컬럼 `jd_text_hash text` 추가(CHECK null 또는 1..128). `insights_ready_check`를 `(requirements_hash is not null or jd_text_hash is not null)`로 완화. `insight_payload_valid`: `hashes`는 `jd_text_hash`·`career_snapshot_hash`·`input_hash` 필수(`requirements_hash`는 받지 않음). `complete_insight`는 `jd_text_hash`를 쓰고 `requirements_hash`는 null. 근거 source_type 허용 목록은 그대로.
5. `start_document_writing_chat`: `v_requirements_ready` = JD 행 존재 여부(사실상 항상 true). `writing_chat_document_greeting`의 "요건 정리 전" 문구 분기는 남겨도 되지만 도달하지 않게.
6. pgTAP: 삭제된 함수를 부르는 테스트 정리(`jd_extraction.test.sql`, `r15_jd_preview_and_deadline.test.sql`, `s6_lock_order`, `retention_purge`, `grants`, `insights*`, `update_failed_jd_raw_text`(셋업에서 apply를 썼다면 직접 update로 셋업), `ai_jobs`, `retry_ai_job` 등). 새 테스트 `r17_jd_raw_text.test.sql`: 9인자 생성(키 없이·동의 없이 성공, 이름 규칙, 반환 키), 옛 함수들 부재, begin_insight JD 존재 게이트, complete_insight `jd_text_hash` 저장·ready_check, payload에 `requirements_hash`만 있으면 거부, start_document_writing_chat 인사말.
7. 타입 재생성(`src/server/db/database.types.ts`). `jd_requirements`·추출 컬럼은 타입에 남는다(보존).
8. **2단 초안(적용 안 함)**: `_workspace/backend/R17/phase2-destructive-draft.sql` — `jd_requirements` drop(근거 행 처리 포함), `job_descriptions` 추출 컬럼 drop, `insights.requirements_hash` drop, `ai_jobs`/`ai_usage_records` CHECK에서 `jd_extraction`·`jd_preview`·`not_a_jd` 제거(과거 행 처리 방법 필요), 옛 트리거 정리. 각 항목에 무엇이 사라지는지 주석. `supabase/migrations/`에 넣지 않는다.

## 3. AI-02 v2 (ai-pipeline-engineer)

- 컨텍스트: `<jd>` = `position_title`(사용자 입력) + `<sentences>` **전체** S-n(정규화된 `raw_text`의 결정적 분할). 요건 블록 없음, seniority 없음(추출 산물).
- 1단계 `match`: 배치 없이 **한 번 호출**. 출력 `matches[]` (≤ 20 `[가정]`): `{ requirement: string(≤200, 공고 표현을 살린 짧은 요건), category: responsibility|required|preferred, importance: high|normal, sentence_refs: S-n[] (≥1), status, rationale, missing_aspect, evidence }`. 서버 검증: 없는 S-n 제거, 인용 문장이 0개면 그 항목 버림, 중복 요건 정리는 하지 않음(모델 책임). 남은 순서대로 `M1…Mn` 부여.
- 2단계 `synthesize`: 입력에 `M-n [상태] 요건 (S-n…)` 목록. `requirement_refs`는 `M-n`을 가리킨다.
- 결과 jsonb v2 (`schema_version` 2): `requirement_matches[]` = `{ item_key: "requirement_matches.M{n}", requirement_id: "M{n}", requirement: {content, category, importance, sentence_ids: ["S3",…]}, status, rationale, missing_aspect }`. strengths/gaps/project_priorities의 `requirement_ids`는 `M{n}` 목록. 근거: 각 match 항목에 인용 문장들이 `jd_sentence` 근거 행(quote = 문장 원문, locator `{sid,start,end}`)으로 들어가고, 커리어 근거는 기존대로.
- `match_stage_result`: v2 형태(위 match 목록) — DB는 object/array만 확인.
- 해시: `hashes = { jd_text_hash, career_snapshot_hash, input_hash }`. `jd_text_hash` = `job_descriptions.raw_text_hash`. `computeInsightInputHash({provider, model, careerSnapshotHash, jdTextHash})`.
- `AI02_PROMPT_VERSION`(및 match/synthesize 하위 버전) 올림.
- **api-engineer와 맞출 인터페이스는 `02_ai-pipeline_notes.md` 맨 위 "인터페이스" 절에 먼저 쓴다**: `buildInsightContext` 입력, 1단계 함수 시그니처(단일 호출), 단계 출력 직렬화 형태, `finalizeInsight` 출력.

## 4. AI-04 (자소서 작성 대화) · AI-12

- AI-04: JD 블록 = 원문 문장 전체(S-n). `REQ-n`, `requirement_refs`(모델 스키마), `no_requirements` 알림, "회사·직무 소개 문장(other_sids)" 구분 제거. 서버가 내보내는 블록/선택의 `requirement_ids`는 **계약 유지를 위해 항상 `[]`** `[가정 R17-10]`. JD 인용은 `jd_sentence` 근거로. input_hash가 있으면 `jdTextHash`. prompt_version 올림.
- AI-12: `<gate_requirements>` 블록·관련 규칙 제거, prompt_version 올림.
- `buildJdContext` 새 시그니처(예): `{ jobDescriptionId, jobDescriptionUpdatedAt, sentences, positionTitle, rawTextHash }` → `{ text, aliases, jdTextHash, numberTexts }`.

## 5. API·잡·데이터 계층 (api-engineer) — ai-pipeline notes의 인터페이스를 읽고 시작

- 삭제: `api/job-descriptions/extract-preview`, `api/application-projects/[id]/jd-extraction`, `jobs/jd-extraction.ts`, `jobs/jd-preview.ts`, `services/application/{extraction,extraction-response,preview}*`, `lib/data/jd-preview-store.ts`, `src/test/jd-extraction-fakes.ts`(필요 없으면).
- 생성: `createApplicationProject` 계약에서 `previewJobId` 제거, 응답에서 `extractionStatus`·`previewApplied`·`previewSkipReason` 제거. 생성 후 추출 잡을 띄우는 코드 제거.
- 러너: `jd_extraction` 분기, 크론의 미리 보기 정리 호출, cost 표의 jd_extraction 실행 항목 제거. insight 잡의 "JD 추출 먼저(D-30)" 단계 제거, `begin_insight` 오류 `job_description_not_found` 매핑.
- 인사이트 서비스: 원문 문장·`raw_text_hash`로 컨텍스트, 1단계 단일 호출, `jd_text_hash` 저장, 재사용 조회는 input_hash. 읽기(`read.ts`): v2는 결과 안의 `requirement`로 `InsightView.requirements`를 만들고, v1(과거)은 보존된 `jd_requirements` 행으로. 오래됨 판정: `staleReasons.requirements` → JD 원문이 바뀌었는지(`jd_text_hash` ≠ 현재 `raw_text_hash`, v1은 항상 true) — 키 이름은 유지하고 의미만 바꾼다고 주석.
- 자소서 대화(`writing-chat/pipelines.ts` 등): `loadInsightRequirements`/`other_sids` 대신 원문 문장 전체. `loadGateRequirements` 삭제.
- enum·오류: 실행 가능한 `JOB_TYPES`에서 `jd_extraction` 제거, `jd_preview` target 제거, `not_a_jd` 원인 제거. 사용량 표시용 과거 feature 라벨은 유지(`[가정 R17-7]`).
- 데이터 계층·UI 최소 수정: 컴파일되고 계약이 맞도록만. 추가 모달의 [다음] 미리 추출 호출 제거(사용자 입력 그대로 다음 단계), JD 탭의 "요건 정리" 상태/버튼/요건 목록은 원문 보기만 남도록 최소 축소, `insight-parse.ts`는 v2 키 수용. 화면 문구·레이아웃 개정은 "UI 요청"으로 `04_summary.md`에 목록화.

## 6. 릴리스 영향

- 마이그레이션 1개(비파괴). 단, `create_application_project` 시그니처가 바뀌고 추출 RPC가 사라지므로 **`db push` 직후 바로 머지**해야 한다(그 사이 옛 코드의 공고 추가·추출은 실패). 운영 사용자 1명 수준이라 짧은 창은 허용 `[가정]`.
- 새 env 없음. UI 변경과 같은 PR(최소 수정 포함)이라 함께 배포.
- 2단 파괴 마이그레이션은 기획 확정 후 별도 슬라이스.

## 7. 순서

1. db-engineer ∥ ai-pipeline-engineer (서로 독립)
2. api-engineer (db 타입 + ai 인터페이스 이후) — UI 최소 수정 포함
3. backend-qa (typecheck·lint·Vitest·pgTAP, grep 잔여 확인) → 수정 ≤ 2라운드
