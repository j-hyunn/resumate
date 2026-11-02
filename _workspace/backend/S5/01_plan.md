# S5 지원 프로젝트·JD (AI-01) 계획

## 범위와 근거
- 기획 근거
  - DM: §2.6(`application_projects`, `application_stage_events`, `move_application_stage`, `set_application_outcome`, 키 없는 JD D-30, `extraction_provider`/`extraction_model`), A.5–A.7, §3.1(소유 키 `application_project_id`), §4.1(지원 프로젝트 삭제 행), §5, §7(보드 조회·단계 이동·결과 기록)
  - AI: AI-01 카드 전체, C-2(문장 ID), C-6(동기 모드, `jd_extraction`), C-10~C-13, AI-12 입력의 "지원 프로젝트 요건(게이트 진입 시에만, R-31)"과 V-9d
  - UX: S-13, S-14, S-31, S-15(요건 부분), S-39, C-12~C-14, FL-06
  - PRD: F-AP-01·02·03·05, F-P2-01·02, F-ST-01~05, F-AI-06
- 앞 슬라이스 위에 쌓는다
  - S3a: 실행기, `createLlm`, 사용 기록, 재시도
  - S3b: 실행 게이트 `check_ai_run_allowed`, 키 공급
  - S4: `writing_chats.return_target`. 게이트 진입 요건 목록(R-31)을 이번에 붙인다.
- **이번에 하지 않는 것**
  - 결과 테이블(인사이트·서류·면접)이 아직 없다. 목록·보드의 진행 표시와 C-14 `in_progress_session_id`는 빈 값(0개 / null)으로 두고 S6–S8에서 채운다.
  - `get_deletion_impact`의 `by_application_project` 집계는 S6–S8에서 넣는다.
  - F-AP-09 복제(Could), F-P2-03 요건 수정(Could), F-ST-06 전형 이력 화면(Should)
  - 탈퇴 범위 집계는 S9에서 한다.
- 연결: UI 화면 없음(`docs/ui/` 없음) → A3 applications, A4 board "연결 대기"

## 계약 — DB (새 마이그레이션 `20261031xxxxxx_s5_*`)

1. **`application_projects`** (A.5 + 2.6)
   - 컬럼: `id`, `user_id`, `name`(≤ 100, null = 추출 대기), `name_source` CHECK in (`user`, `ai`, `default`), `deadline` date, `memo`(≤ 2,000), `stage`(6값, default `before_apply`), `stage_outcome`(`passed`/`failed`/null, `CHECK (stage = 'closed' OR stage_outcome IS NULL)`), `stage_changed_at`, `last_activity_at`, `duplicated_from_id`(FK set null), 공통 `created_at`·`updated_at`. `unique (id, user_id)`.
   - `name`이 null이면 `name_source`도 null이다(CHECK).
   - RLS
     - select·delete 본인.
     - insert는 RPC `create_application_project`만.
     - 사용자 update grant는 `name`, `deadline`, `memo`만. 사용자가 `name`을 바꾸면 트리거가 `name_source = 'user'`로 두고, 이름·마감일·메모 변경은 `last_activity_at`도 갱신한다.
     - `stage`, `stage_outcome`, `stage_changed_at` 직접 update는 아무에게도 주지 않는다.
     - app_ai_writer: select(필요 컬럼), update는 `name`, `name_source`, `last_activity_at`만. 이름은 추출 결과 반영 RPC만 바꾼다.
   - 인덱스: `(user_id, stage, stage_changed_at desc)`, `(user_id, last_activity_at desc)`, `(user_id, deadline)`.

2. **`application_stage_events`** (2.6)
   - 표 그대로이고 불변이다. 복합 FK cascade, `user_id` 포함, 인덱스 `(application_project_id, created_at)`.
   - RLS: select 본인. insert·update·delete 권한은 없고, RPC(definer)와 연쇄 삭제만 쓴다.

3. **`job_descriptions`** (A.6 + 2.6 v4)
   - 컬럼
     - `application_project_id`: unique, 복합 FK cascade, 변경 불가
     - `raw_text`: 1~50,000자, 변경 불가
     - `raw_text_hash`, `sentences` jsonb, `detected_language`
     - `company_name`·`company_name_source`, `position_title`·`position_title_source` (`user`/`ai`, 값이 null이면 source도 null)
     - `extraction_status` (`pending`, `running`, `succeeded`, `failed`, default `pending`)
     - `extraction`, `extraction_job_id`, `extraction_provider`, `extraction_model`, `tech_keywords`, `requirements_hash`
   - RLS
     - select 본인. insert는 `create_application_project`만. 사용자 update·delete는 없다(연쇄만).
     - app_ai_writer: select, `extraction_status` update(`running`/`failed`)와 추출 결과 반영 RPC.
   - `sentences` 검증(DB): 배열이고 원소마다 `sid ~ '^S[1-9][0-9]*$'`, `sid`는 차례대로 S1, S2, …, `start < end`.
     - 오프셋은 JS UTF-16 기준이라 DB에서 원문과 대조하지 않는다 `[가정]`.
     - 분할은 서버 TS(`splitJdSentences`)가 한다.

4. **`jd_requirements`** (A.7)
   - 복합 FK cascade.
   - 컬럼: `category`, `content`(≤ 500 `[가정]`), `keywords` text[], `importance`, `source_sids` text[](1개 이상), `sort_order`, `origin`(`ai`/`user`), `is_user_edited` default false.
   - RLS: select 본인. 쓰기는 추출 결과 반영 RPC만(F-P2-03 수정은 Could라 사용자 쓰기 없음).
   - 인덱스 `(job_description_id, sort_order)`.

5. **RPC**
   - `create_application_project(p_id uuid, p_raw_text text, p_raw_text_hash text, p_sentences jsonb, p_company_name text, p_position_title text, p_name text, p_deadline date) returns jsonb`
     - 사용자 세션, invoker로 충분하면 invoker로 하고 grant 경로는 db가 판단한다.
     - 한 트랜잭션에서 프로젝트, JD, `created` 이벤트(`to_stage = before_apply`)를 insert한다.
     - 이름 규칙
       - `p_name`이 있으면 `name_source = 'user'`.
       - 없으면 `name = null`(추출 대기)이다. 단, 활성 키가 없으면 회사명·포지션명으로 "회사명 – 포지션명"을 만들고(둘 다 있을 때, `user`), 그것도 없으면 기본 이름 "새 기업 JD (YYYY-MM-DD, KST)"(`default`)로 둔다.
       - 키 유무는 서버 액션이 판단해 `p_name`을 채워 넘기지 않는다. DB가 `check_ai_run_allowed`와 같은 기준(활성 공급자 + valid 키)을 직접 본다 `[가정]`.
     - 회사명·포지션명 입력값은 `*_source = 'user'`.
     - 멱등: 같은 `p_id`가 이미 본인 것이면 기존 행을 반환한다(S2 규칙).
     - 반환: `{application_project_id, job_description_id, name, name_source, extraction_status}`
   - `move_application_stage(p_application_project_id, p_to_stage, p_outcome default null) returns jsonb` — 2.6의 1~5 그대로다.
     - 반환: `{stage, stage_outcome, stage_changed_at, changed boolean, interview_prompt}`.
     - `interview_prompt`는 인터뷰 열이면 `{interview_type: 'job'|'culture_fit', in_progress_session_id: null}`이다(S8에서 `create or replace`로 채움).
     - `p_outcome`은 `to_stage = 'closed'`일 때만 허용하고, 아니면 `invalid_outcome`.
   - `set_application_outcome(p_application_project_id, p_outcome)`
     - `stage = 'closed'`가 아니면 `not_closed`. `p_outcome`은 `passed`/`failed`/null(결과 지우기 `[가정]`).
     - 값이 같으면 이벤트를 만들지 않는다.
   - `apply_jd_extraction(p_job_description_id, p_ai_job_id, p_attempt_count, p_result jsonb, p_provider, p_model) returns jsonb` — app_ai_writer 전용이다.
     - 행을 잠근다. `extraction_job_id = p_ai_job_id`이고, 그 작업의 `attempt_count`가 맞을 때만 반영한다. 늦게 도착한 실행은 무시한다.
     - 사용자 수정 요건(`is_user_edited` 또는 `origin = 'user'`)이 있으면 `user_edited_requirements_exist`로 거부한다. MVP에서는 생기지 않지만 규칙을 넣어 둔다.
     - 이전 `origin = 'ai'` 요건을 지우고 새로 insert한다(`sort_order` = 출력 순서).
     - `extraction`, `detected_language`, `tech_keywords`, `extraction_status = 'succeeded'`, `extraction_provider`, `extraction_model`을 쓴다.
     - `requirements_hash`는 서버가 계산해 `p_result` 안에 넣어 보낸다. 해시 규칙은 TS 한 곳에 둔다.
     - 회사명·포지션명은 비어 있을 때만 AI 값으로 채운다(`*_source = 'ai'`).
     - 이름은 `name_source`가 null이거나 `default`일 때만 "회사명 – 포지션명"으로 바꾼다(`ai`). 둘 다 없으면 null인 이름만 기본 이름(`default`)으로 바꾼다.
     - `last_activity_at`을 갱신한다.
     - `p_result` 모양은 ai·db가 노트에서 합의한다.
   - `begin_jd_extraction(p_job_description_id, p_ai_job_id) returns void` — app_ai_writer 전용이다.
     - `pending`/`failed`이면 `running`, `extraction_job_id`를 기록한다.
     - `succeeded`면 `already_extracted`, `running`이면 `extraction_in_progress`.
     - 실패 기록은 `fail_jd_extraction(p_job_description_id, p_ai_job_id)`로 `running` → `failed`(작업 id가 맞을 때만)로 한다. 실패 원인은 `ai_jobs`에 남는다.
   - **멈춘 추출 복구**: `running`인데 `extraction_job_id`의 작업이 이미 끝났으면(failed/canceled/stalled) 다음 시작 때 `begin_jd_extraction`이 `running`을 덮어쓸 수 있게 한다.

6. **기존 테이블 FK 마무리 (DM §3.1, §4.1)**
   - `ai_jobs.application_project_id` → 복합 FK `(application_project_id, user_id)` on delete cascade
   - `evidence_links.application_project_id` → 복합 FK on delete cascade
   - `ai_usage_records.application_project_id` → 복합 FK `on delete set null (application_project_id)`. 사용 기록은 남는다(F-AP-05).
   - 기존 행이 없다는 전제로 바로 건다. 로컬 데이터는 `db reset`으로 정리한다.
   - **멈춘 참조 주의**: 삭제된 프로젝트의 실행 중 작업은 행이 사라진다. 실행기 쓰기는 0행이 되고, 이것을 `canceled`와 같게 다룬다(api 확인 항목).

7. **grants·pgTAP**
   - `grants.test.sql` 허용 목록을 갱신한다.
   - 새 테스트
     - `application_projects.test.sql`: RLS 교차 사용자, 직접 update 금지 컬럼, 이름 규칙, 멱등 생성
     - `application_stage.test.sql`: 이동 1~5, 종료에서 나갈 때 결과 지움 + `from_outcome`, 같은 단계 무이벤트, outcome 규칙
     - `jd_extraction.test.sql`: begin / apply / fail, 세대 검사, 이름·회사명 덮어쓰기 규칙, 사용자 수정 요건 거부
     - 삭제 연쇄: 이벤트·JD·요건·ai_jobs·evidence_links 삭제, usage_records null
     - 첫 호출 권한 테스트(S4와 같은 방식)

## 계약 — AI (`src/server/ai/`)

1. **스키마 `schemas/AI-01.ts`**: 출력 스키마는 카드 그대로다(`schema_version: 1`).
   - 공급자 공통분모 규칙(C-10)을 따른다. nullable 필드는 필수 + null 허용이고, `seniority`가 없으면 null이다.
   - 문자열 길이 상한 `[가정]`: `text` ≤ 300, `keywords` ≤ 10개.
2. **프롬프트 `prompts/AI-01/index.ts`**: `prompt_version` `AI-01@1`. 카드의 프롬프트 전략을 따른다.
   - 카테고리 경계 사례 2개를 넣는다.
   - 데이터 분리(C-4): JD 문장은 `<jd>` 블록 안에 `S-n: …` 형식으로 넣는다.
   - 사용자 입력 회사명·포지션명은 참고로만 넣는다.
3. **파이프라인 `pipelines/AI-01.ts`**: `extractJdRequirements({ sentences, companyName, positionTitle }, llm, signal)`
   - 경량 등급, 구조화 출력, 사고 설정 낮음.
   - **서버 검증**: 이 결과로 지금 진행할지, 오류로 끝낼지를 정한다.
     - 존재하지 않는 sid는 지운다. sid가 0개가 된 요건은 버린다. 같은 텍스트 요건은 합친다.
     - `company_name`·`position_title`·`seniority`의 sid가 없으면 값을 버린다.
     - `tech_keywords`의 sid 검사도 같다. `other_sids`도 거른다.
     - 검증 후 요건이 0개일 때
       - `is_likely_jd = false`면 `not_a_jd` 오류로 끝낸다 `[가정]`.
       - 그렇지 않으면 `schema_invalid` 1회 재시도 경로를 탄다.
     - 버린 항목 수는 검증 보고서로 남긴다(로그에는 수만 남기고 내용은 남기지 않는다).
   - 반환: 정규화된 결과 + `requirements_hash`(정렬된 요건 `category`·`content`·`source_sids`의 해시, 기존 `hashCanonical`) + 검증 보고서.
4. **게이트 요건 선별 (R-31) `context-pack/gate-requirements.ts`**: `selectGateRequirements(requirements, careerSignals, max = 8)`
   - `importance = 'high'`를 먼저 고르고, 남은 자리는 "커리어 근거가 약해 보이는 요건"으로 채운다.
     - 약함의 판정: 요건 `keywords`가 스킬 `normalized_name`과도, 프로젝트·상세 내용 텍스트와도 겹치지 않는 경우 `[가정]`.
     - 결정적 규칙이고, 동점이면 `sort_order` 순이다.
   - AI-12 응답 호출에만 붙인다(`replyUserBlocks` 확장 지점, S4 노트).
     - 정리(extract) 호출에는 넣지 않는다.
     - V-9d는 사용자 발화와만 대조한다(이미 그렇다). 요건 문구가 패치 출처가 될 수 없음을 테스트로 고정한다.
   - 응답 프롬프트에 "요건은 질문 주제·순서 선택에만 쓰고, 요건의 기술명을 사용자 경험처럼 묻지 않는다" 지시를 넣는다. 프롬프트 버전은 올린다.
   - 게이트 진입이 아니거나 요건이 없으면 블록 자체가 없다.
5. **fixtures·테스트**: 한국어 JD 2개, 영문 JD 1개, JD 아님 1개, 인젝션 문장이 섞인 JD 1개. 검증 규칙 단위 테스트.

## 계약 — API

1. **contracts `src/lib/contracts/application.ts`** (+ `enums.ts`: `APPLICATION_STAGES`, `STAGE_OUTCOMES`, `NAME_SOURCES`, `JD_EXTRACTION_STATUSES`, `REQUIREMENT_CATEGORIES`)
   - 생성 입력
     - `id`(uuid, 클라이언트 생성), `rawText`(1~50,000), `companyName?`, `positionTitle?`, `name?`, `deadline?`
     - 200자 미만은 경고 플래그만 준다(F-P2-01 `[가정]`).
     - 8k 토큰 초과 추정 경고(C-2): 글자 수 기준 `[가정]` 24,000자 초과 시 `warnings: ['long_jd']`.
   - 응답·조회 DTO: 목록 행, 보드 카드, 허브, JD·요건.
2. **Server Actions `src/server/actions/application.ts`**
   - `createApplicationProject`
     - 원문을 분할하고 해시를 계산한 뒤 RPC를 부른다.
     - 반환 `{ applicationProjectId, name, nameSource, extractionStatus, shouldExtract }`. `shouldExtract`는 실행 게이트 통과 여부다.
     - 화면은 `shouldExtract`면 바로 추출 라우트를 부른다("공고를 분석하고 있어요"). 생성 자체는 AI와 분리해 원문 저장이 항상 성공하게 한다(PRD "원문 저장은 성공, 추출은 실패 안내").
   - `updateApplicationProject({ id, name?, deadline?, memo? })`: 이름 ≤ 100, 메모 ≤ 2,000, 빈 이름은 거부한다.
   - `deleteApplicationProject({ id })`: 그 프로젝트의 진행 중 `ai_jobs`에 `cancel_requested_at`을 건 다음 삭제한다(FL-06). 사용 기록은 남는다.
   - `moveApplicationStage({ id, toStage, outcome? })`, `setApplicationOutcome({ id, outcome })`: 결과를 그대로 돌려준다. C-14 팝업 판단은 화면이 한다(키 없음 변형 포함, 상태 조회는 S3b 함수 재사용).
3. **JD 요건 추출 (동기)**: Route Handler `POST /api/application-projects/[id]/jd-extraction`
   - 사용자 세션 확인 → `check_ai_run_allowed` → `ai_jobs`(`job_type = 'jd_extraction'`, `target_type = 'job_description'`, `application_project_id`) → `begin_jd_extraction` → AI-01 → `apply_jd_extraction` → 응답
   - 응답은 `{ status: 'succeeded', jd: JdView }` 또는 C-11 오류 응답이다(S3b 오류 형식 재사용).
   - 사용 기록 `feature = 'jd_extraction'`. 서버 타임아웃은 30초(C-6 `[가정]`)이고, `maxDuration`은 60으로 그대로 둔다.
   - 재시도: 같은 라우트를 다시 부르면 된다(`failed` → 다시 실행).
     - `succeeded`면 409 `already_extracted`(D-19, 재추출은 실패 재시도뿐).
     - 진행 중이면 409 `extraction_in_progress`.
   - **선행 단계 재사용 (D-30)**: `ensureJdExtracted(scope, applicationProjectId)` 서비스 함수를 이 라우트와 S6–S8 작업의 첫 단계가 함께 쓰도록 노출한다. 이번 슬라이스에서는 라우트만 쓴다.
   - 동기 실행 경로는 S3b 키 검증(`key_verification`)이 쓰는 동기 경로를 재사용한다. 없으면 실행기에 동기 실행 진입점을 추가하고 노트에 남긴다.
4. **조회 서비스 `src/server/services/application/`**
   - `listApplicationProjects({ sort: 'recent'|'deadline', stage? })` (S-13)
   - `getBoard()` (S-39): 6열, 열 안은 `stage_changed_at desc`, 열마다 카드 수
   - `getApplicationHub(id)` (S-31)
   - `getJdView(id)` (S-15: 원문, 문장, 요건, `extraction_status`, 공급자 배지, `is_likely_jd` 경고, 최근 실패 원인)
   - 진행 표시는 이번에는 `{ insight: 'none', draftCount: 0, interviewCount: 0, interviewInProgress: false }` 고정이고, S6–S8에서 채운다(확장 지점 주석).
   - 카드 표시명: `name` → 없으면 "회사명 – 포지션명" → 없으면 "새 기업 JD"(추출 대기).
5. **AI-12 연결 (R-31)**
   - `writing-chat` 턴 의존성에서 `return_target.application_project_id`가 있으면 그 JD 요건과 커리어 신호를 읽어 `selectGateRequirements` 결과를 응답 파이프라인에 넘긴다.
   - 요건이 없거나 프로젝트가 삭제됐으면 빈 목록이다.
   - 대화 시작 액션에서 `return_target.application_project_id` 소유를 확인한다(없으면 `not_found`).
6. **테스트**: 액션·라우트 단위 테스트(가짜 LLM), 로컬 DB 통합 테스트(생성 → 추출 → 이름 갱신, 삭제 연쇄와 사용 기록 유지, 단계 이동 이력).

## 팀 작업과 의존
| 담당 | 작업 | 의존 |
|------|------|------|
| db-engineer | 마이그레이션 1~6, grants, pgTAP, 타입 생성, `02_db-engineer_notes.md`(RPC 시그니처, `p_result` 모양) | 없음. 먼저 시그니처를 노트에 올린다 |
| ai-pipeline-engineer | AI-01 스키마·프롬프트·파이프라인·검증, `selectGateRequirements`, AI-12 응답 프롬프트 요건 블록, fixtures | 순수 코드는 바로 시작. `p_result` 모양은 db와 합의 |
| api-engineer | contracts, 액션, 추출 라우트, 조회 서비스, AI-12 턴 연결, 테스트 | contracts는 바로 시작. DB 호출은 타입 생성 후 |
| backend-qa | 모듈별 점진 검사 → 전체 검사(최대 2라운드) | 각 모듈 |

## 원격 브랜치
적용하지 않는다(사용자 요청 없음).

## 이 슬라이스가 쓰는 `[가정]` (spec-gaps에 기록)
1. 기본 이름 "새 기업 JD (YYYY-MM-DD)", KST 날짜. 추출 실패 때도 같은 이름이다(S-14의 "지원 프로젝트 YYYY-MM-DD"와 화면 표시 문구를 하나로).
2. 키 없이 만들면서 회사명·포지션명을 입력했다면 이름을 "회사명 – 포지션명"(`user`)으로 한다.
3. 생성과 추출을 분리한다. 생성 액션이 `shouldExtract`를 주고, 화면이 바로 추출 라우트를 부른다("생성 직후 자동 1회"의 구현 방식).
4. 요건이 0개이고 `is_likely_jd = false`면 `not_a_jd` 실패로 둔다. 요건이 있으면 경고만 하고 진행한다.
5. JD 길이 경고는 24,000자 초과(약 8k 토큰), 짧은 JD 경고는 200자 미만이다.
6. `set_application_outcome(null)`로 결과를 지울 수 있다(C-13 "닫기" 뒤 카드 메뉴 "결과 기록"과 짝).
7. R-31 "근거가 약해 보이는 요건"은 키워드 겹침이 없는 요건이다.
8. JD 문장 오프셋은 JS UTF-16 기준이고, DB는 구조만 검사한다.
