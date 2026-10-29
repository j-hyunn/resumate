# S7 서류 초안 (AI-11, AI-03, AI-04) 계획

## 범위와 근거
- 기획 근거
  - DM
    - A.9 `drafts`, A.10 `draft_sections`, A.11 `draft_section_sources`
    - §0 AI 메타(`drafts`·`draft_sections` 둘 다), §2.7 변경분(교육 섹션, `project_detail_ids`)
    - §2.9 `ai_jobs.output`(`draft_source_ranking` 전용)
    - §4.1·§4.2(커리어 삭제 영향 drafts·draft_sections, 결과 단위 "경력기술서 문서 / 자소서 문항 생성 결과 초기화"), §6.1 F-DOC 행
  - AI
    - AI-11, AI-03, AI-04 카드 전체
    - C-3(V-1~V-5, V-7, V-8, 저장 매핑 `item_key = block_id`, `sources.{n}`), C-5 자리 표시, C-6 스트리밍 블록 이벤트, C-9 회고 사용 규칙, C-10~C-13
  - UX: S-17, S-18, S-19, C-11, FL-03
  - PRD: F-DOC-01~04, 08, 09, D-DM-06(자소서 이전 생성본 미보관), D-30
- 앞 슬라이스 위에 쌓는다
  - S3: 스트리밍 증분 파서(`streaming/*`), 근거 검증, 자리 표시·수치 가드
  - S3a/S3b: 실행 게이트, 사용 기록, 스트리밍 재시도 규칙(첫 토큰 전만)
  - S5: `ensureJdExtracted`, `loadProgress`
  - S6: 근거 칩 공용 서비스(`services/evidence`), 인사이트(`strategy.project_priorities`, `strengths`), 별칭 정리(`validation/alias-text.ts`), 삭제 영향 확장 방식
- **이번에 하지 않는 것**
  - F-DOC-05 다시 쓰기(Should), F-DOC-06 이전 버전(Could), F-DOC-10 문항 자동 제안(Could)
  - 결과 평가(Should)
- 연결: UI 없음 → A3 "연결 대기"

## 계약 — DB (새 마이그레이션 `20261102xxxxxx_s7_*`)

1. **`drafts`** (A.9 + AI 메타)
   - 컬럼: `application_project_id` 복합 FK cascade, `insight_id` FK set null, `draft_type`, `title`(≤ 100 `[가정]`), `status`, `options` jsonb, `edited_at`, `first_copied_at`, `regenerated_from_id` FK set null, 공통 AI 메타
   - RLS
     - select·delete 본인. 개별 초안 삭제를 허용한다(S-17 `[가정]`).
     - 사용자 update는 `title`, `edited_at`, `first_copied_at`만.
     - insert
       - 자소서는 사용자 RPC `create_cover_letter_draft`(기본 3문항 시드, AI 없음, 키 불필요).
       - 경력기술서는 app_ai_writer definer RPC `begin_career_description`.
   - `options` 모양 검사: 키 `included_experience_ids`, `included_education_ids`, `included_project_ids`, `project_order`, `selection_origin` (`insight`/`ai_ranking`/`user`), `ranking`, `tone`
   - 인덱스: `(application_project_id, draft_type, created_at desc)`, `(user_id, application_project_id, input_hash) where status = 'ready'`

2. **`draft_sections`** (A.10 + AI 메타)
   - 컬럼
     - 표 그대로이고 `sort_order`는 draft 안에서 unique다.
     - `ai_content`는 사용자가 수정할 수 없다.
     - `edited_content`: 블록 배열, `block_id` 유지
   - RLS
     - select 본인.
     - 사용자 update: `question_text`, `char_limit`, `count_basis`, `user_note`, `edited_content`. `template_key`는 문구를 바꿔도 유지한다.
     - 자소서 문항 추가·삭제·순서 변경은 사용자 RPC로 한다(최소 1문항, 삭제 시 sources·evidence 연쇄).
   - app_ai_writer는 definer RPC로만 쓴다(아래).
   - 문항 편집은 키 없이 가능하다(F-DOC-02 `[가정]`).

3. **`draft_section_sources`** (A.11)
   - CHECK는 표 그대로다.
   - 쓰기
     - AI 선택은 `complete_cover_letter_section`이 교체 저장한다.
     - 사용자 선택은 사용자 RPC `set_section_sources(section_id, sources jsonb)`가 쓴다: `origin = 'user'` 행으로 교체하고, `source_selection_mode = 'user'`, `sources_modified_at`을 기록한다. 완료 상태의 커리어 행만 허용하고 소유를 검사한다.
   - **원본 삭제 트리거** (§2.7)
     - 경력·교육·프로젝트가 삭제되면 `source_deleted_at` + `source_label`(삭제 전 "회사명 › 프로젝트명")을 기록한다.
     - 상세 내용이 삭제되면 `project_detail_ids` 배열에서 뺀다.

4. **RPC (app_ai_writer 전용, 소유·세대 검사, S6와 같은 방식)**
   - **경력기술서**
     - `begin_career_description(p_application_project_id, p_ai_job_id, p_options jsonb, p_sections jsonb) returns jsonb`
       - `drafts` 행(`generating`)을 만든다. 다시 생성이면 `regenerated_from_id`를 채운다.
       - 섹션 행을 서버가 정한 순서로 만든다(`experience`/`education`/`standalone_projects`, `heading`, `pending`).
       - 같은 작업이면 멱등이다.
     - `complete_career_description(p_draft_id, p_ai_job_id, p_run_generation, p_payload jsonb)`
       - 섹션별 `ai_content` 블록(서버가 채운 `header` 포함), `validation_report`, 근거 `evidence_links`(`owner_type = 'draft_section'`, `item_key = block_id`), 메타를 쓴다.
       - `status = 'ready'`, 지원 프로젝트 `last_activity_at`.
       - 늦게 도착한 실행이면 `stale_run`.
   - **자기소개서**
     - `begin_cover_letter_section(p_section_id, p_ai_job_id)`: 섹션 `generating`, 초안 `generating`
     - `complete_cover_letter_section(p_section_id, p_ai_job_id, p_run_generation, p_payload jsonb)`
       - 쓰는 것
         - `ai_content`(문단 블록), `ai_char_count`, `correction_applied`, `question_class`, `validation_report`, 메타
         - `generation_no + 1`, `sources_modified_at = null`
         - **`edited_content = null`**: 다시 생성하면 편집본을 덮어쓴다. 화면이 미리 확인한다.
       - sources 교체
         - AI 선택 모드에서는 `origin = 'ai'` 행으로 바꾼다.
         - 사용자 모드에서는 사용자 행을 유지하고 `rationale`만 갱신한다.
       - 근거 교체: 본문 블록과 `sources.{n}`.
       - 초안 상태 재계산: 모든 문항 ready → `ready`, 일부 실패 → `partially_failed`, 생성 중이 있으면 `generating`, 생성 전 문항만 있으면 `composing`.
     - 이전 생성본은 보관하지 않는다(D-DM-06). 이전 근거는 지운다.
   - 공통: `fail_draft_section(p_section_id, p_ai_job_id)`, `fail_career_description(p_draft_id, p_ai_job_id)`. 작업 종료 트리거는 S6 방식(`skip locked`)으로 생성 중 행을 실패로 둔다.
   - 재시도 경로에서 실패 행을 다시 여는 규칙은 S6 `run_generation` 방식을 따른다.

5. **`ai_jobs`**
   - `career_description`: `target_type = 'draft'`
   - `cover_letter`: `target_type = 'draft_section'`
   - `draft_source_ranking`: `target_type = 'application_project'`, `output` jsonb는 app_ai_writer가 쓸 수 있다.
   - 기존 CHECK가 이 조합을 허용하는지 확인하고, 필요하면 넓힌다.

6. **커리어 삭제 영향 (§4.2)**
   - `by_application_project[].drafts`, `draft_sections`를 채운다. `evidence_links`(owner `draft_section`)와 `draft_section_sources`(경력·교육·프로젝트·상세 내용 배열)를 함께 집계한다.
   - `delete_career_item`의 `delete_results`
     - 경력기술서: 해당 문서(drafts 행)를 삭제한다.
     - 자소서: 해당 문항의 생성 결과를 초기화한다(`ai_content`·`edited_content` null, `status = 'pending'`, sources·근거 삭제). 문항 문구·메모는 남긴다.

7. **grants·pgTAP**: 허용 목록, RLS 교차 사용자, 시드 3문항, 최소 1문항, 직접 update 금지 컬럼(`ai_content` 등), begin/complete/fail와 세대, 상태 재계산, sources 사용자 교체·트리거, 삭제 영향·결과 모드, 첫 호출 권한.

## 계약 — AI (`src/server/ai/`)

1. **AI-11** `pipelines/AI-11.ts` `rankDraftSources({ pack(요약형), requirements }, deps)`
   - 경량 등급, 동기 실행.
   - 출력은 카드 그대로다. V-1(프로젝트 ref)과 요건 ref를 검증한다.
   - 포함 프로젝트는 최대 8개다. 경력·교육 포함 목록은 서버가 파생한다.
   - 반환: `{ includedProjectIds, projectOrder, includedExperienceIds, includedEducationIds, ranking(UUID로 변환) }`
   - 요약형 팩 빌더(회고 제외, 상세 내용의 행동은 앞 200자)를 `context-pack`에 추가한다.
2. **AI-03** `pipelines/AI-03.ts`
   - `streamCareerDescription({ pack(선택 항목만), requirements, insightSignal?, ranking?, options, sectionPlan }, deps)`
   - 구조화 스트리밍이다. 블록 이벤트(`block_started` / `block_delta` / `block_completed`)는 기존 `streaming/structured-stream.ts`를 쓴다.
   - `block_completed`마다 그 블록의 근거 검증 결과(근거 칩용)를 보낸다.
   - 전체 완료 후 처리
     - V-5 수치 가드와 스킬명 가드는 플래그로 표시한다.
     - V-7 범위: 선택 항목 밖 근거는 제거한다.
     - V-8: 회고는 경력기술서에서 금지한다.
     - 근거가 상황(S)·과제(T)뿐인 "본인 주어" 불릿은 `evidence_check_needed` 플래그를 단다.
     - 근거 0개 블록은 `evidence_check_needed`로 둔다(블록 유지).
     - 자리 표시는 C-5 규칙을 따른다.
   - **머리글은 서버가 채운다**
     - 경력: 회사명·기간·직급/직책
     - 교육: 기관명·과정명·기간·재학 상태
     - 프로젝트: 이름·기간
   - 불릿은 프로젝트당 4개, 프로젝트는 8개까지만 남긴다.
   - 별칭 텍스트 정리는 S6 `alias-text`를 재사용한다.
   - 반환: 섹션별 블록 배열 + 근거 행 + `validation_report` → `complete_career_description` payload 매퍼.
3. **AI-04** `pipelines/AI-04.ts`
   - `streamCoverLetterSection({ pack, requirements, companySentences, question, note, mode, userSources?, otherSections, insightSignal? }, deps)`
   - 구조화 스트리밍이다. `sources`가 먼저 완성되면 `sources_selected` 이벤트를 내고, 이어서 문단 블록 이벤트를 낸다.
   - 검증
     - V-1~V-5
     - V-7: `sources`의 경력·교육·프로젝트와 그 하위(`detail_refs`가 있으면 그 상세 내용만), 프로필, JD, 메모
     - V-8: `learnings`는 `future_plan`·`experience_story`·`motivation`에서만 허용하고, 회고 표현이어야 한다.
   - 사용자 모드: 목록 밖 `sources`를 제거하고, 선택을 바꾸지 않는다.
   - 문항 유형별 근거 개수 규칙을 검증한다(`job_competency` 1~2개 등). 어기면 자르고 보고서에 남긴다.
   - **글자 수 보정**
     - 서버가 `count_basis`로 글자 수를 센다.
     - 제한의 ±10% 밖이면 `adjustCoverLetterLength(...)`를 1회 호출한다(같은 미터 `cover_letter`, 낮은 사고 설정, 근거·자리 표시 유지, `adjusting_length` 이벤트).
     - 보정 후에도 벗어나면 `char_adjust_needed` 플래그를 단다.
     - 보정 결과도 같은 검증을 다시 거친다.
   - 반환: `complete_cover_letter_section` payload 매퍼.
4. **프롬프트**: `ai-03.generate.v1`, `ai-04.generate.v1`, `ai-04.adjust.v1`, `ai-11.rank.v1`(+common). few-shot은 가상 데이터를 쓴다. 메모와 사용자 입력은 데이터 블록으로 분리한다(C-4).
5. **input_hash**
   - AI-03: 선택 옵션과 tone을 포함한다.
   - AI-04: 문항, 메모, 글자 수, 모드, 사용자 근거를 포함한다.
   - AI-11: `career_snapshot_hash` + `requirements_hash`
6. **fixtures·테스트**
   - 성과 수치가 일부 비어 있는 프로필(자리 표시가 나와야 정답)
   - 메모 없는 지원 동기·포부(자리 표시)
   - 회고만 있는 포부
   - 사용자 모드 목록 밖 근거
   - 키워드 끼워 넣기(스킬명 가드)
   - 글자 수 초과 보정

## 계약 — API

1. **기본 선택 (AI-11, 동기)**: `POST /api/application-projects/[id]/draft-source-ranking`
   - 최신 인사이트가 있으면 호출 없이 `project_priorities`로 정하고 `selection_origin = 'insight'`.
   - 같은 해시의 `ai_jobs.output`이 있으면 재사용한다.
   - 그 밖에는 AI-11을 부른다(`job_type = 'draft_source_ranking'`, 미터 `career_description`).
   - 실패하면 오류 없이 "최신 경력순 전체 선택"으로 대체하고 `fallback: true`를 돌려준다.
   - readiness 미달이면 422. JD 미추출이면 `ensureJdExtracted`를 먼저 한다(D-30).
2. **경력기술서 생성 (스트리밍)**: Route Handler `POST /api/application-projects/[id]/career-descriptions` (SSE)
   - 입력: 선택 옵션, `tone?`, `regeneratedFromId?`
   - 순서: readiness → 실행 게이트 → JD 추출 선행(필요하면, `preparing` 이벤트) → `begin_career_description` → AI-03 스트림
   - 이벤트: `block_started` / `block_delta` / `block_completed`(+근거 칩) → `validated` → `done`(`draftId`) / `error`
   - 클라이언트 연결이 끊겨도 서버는 끝까지 실행하고 저장한다(S4 방식).
   - 실패하면 완료된 블록을 보존하지 않고 전체 재시도한다(카드 MVP 단순화). 실패 행은 `failed`로 남는다.
   - `maxDuration` 60을 지킨다.
3. **자기소개서**
   - Server Actions
     - `createCoverLetterDraft(applicationProjectId)`: 시드 3문항, 키 불필요
     - 문항 추가·수정·삭제·순서 변경
     - 메모·글자 수·기준 수정
     - `setSectionSources`
   - 문항 생성 (SSE): `POST /api/draft-sections/[id]/generate`
     - 이벤트: `sources_selected` → 블록 이벤트 → `validated` → (보정 시) `adjusting_length` → `done`
     - 다른 문항의 주 근거를 입력으로 넣는다.
     - "전체 생성"은 화면이 문항 순서대로 이 라우트를 차례로 부른다. 함수 한 번이 60초를 넘지 않게 하기 위해서다 `[가정]`.
4. **편집·복사 (키 불필요)**
   - Server Actions `saveSectionEdit(sectionId, blocks)`: 블록 id를 검증하고, `user_modified` 표시, `drafts.edited_at`을 갱신한다.
   - `markDraftCopied(draftId)`: `first_copied_at`은 처음 한 번만 기록한다.
   - `renameDraft`, `deleteDraft`
5. **조회**
   - `listDrafts(applicationProjectId)` (S-17)
   - `getDraft(draftId)` (S-19): 섹션, 블록(편집본 우선 + AI 원본), 근거 칩(S6 공용 서비스), C-11 sources, 플래그, 공급자 배지(초안·섹션), 진행 중 작업, 최근 실패
   - 진행 표시: `loadProgress`의 `draftCount`
6. **테스트**
   - 단위: 가짜 LLM 스트림, 이벤트 순서, 연결 끊김 후 저장, 첫 토큰 전 오류만 재시도, 보정 경로, 사용자 모드, 기본 선택 3경로와 대체
   - 로컬 DB 통합
     - 경력기술서 생성 → 근거 → 다시 생성(새 행)
     - 자소서 시드 → 문항 생성 → 근거 변경 → 다시 생성(편집본 초기화)
     - 커리어 삭제 결과 모드
     - 프로젝트 삭제 연쇄

## 팀 작업과 의존
| 담당 | 작업 | 의존 |
|------|------|------|
| db-engineer | 마이그레이션 1~7, pgTAP, 타입 생성, 노트(시그니처·payload 모양 먼저) | 없음 |
| ai-pipeline-engineer | AI-11·AI-03·AI-04 스키마·프롬프트·파이프라인·검증·보정·payload 매퍼·fixtures | payload 모양은 db 노트 |
| api-engineer | 기본 선택 라우트, 두 SSE 라우트, 자소서 액션, 편집·복사, 조회, 진행 표시, 테스트 | 시그니처(ai·db 노트), 타입 |
| backend-qa | 점진 → 전체 검사(최대 2라운드) | 각 모듈 |

## 원격 브랜치
적용하지 않는다.

## `[가정]` (spec-gaps에 기록)
1. 자소서 "전체 생성"은 화면이 문항별 라우트를 차례로 부른다(함수 60초 제한).
2. 경력기술서는 생성이 실패하면 블록을 보존하지 않고 전체 재시도한다(카드의 MVP 단순화를 따름).
3. 초안 개별 삭제를 허용한다.
4. 자소서 문항 다시 생성은 편집본을 지운다(화면이 미리 확인).
5. 제목 상한은 100자, 기본 제목은 "경력기술서 (YYYY-MM-DD)" / "자기소개서 (YYYY-MM-DD)"다.
6. 자소서 문항 편집은 키 없이 가능하다(F-DOC-02 `[가정]` 유지).
