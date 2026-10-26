# S2 career data 계획

## 범위
- 기획 근거: DM §2.2(공통 규칙·완료 판정), §2.3(테이블), §2.4(연도 보기), §4.1–4.2(삭제), §5(RLS), §6(get_data_readiness), §7(API 행), 부록 A.3·A.4 / PRD F-P1-01~06, 09, 14, 15, F-COM-04 / UX S-08~S-12, S-34, S-35
- 테이블: `experiences`, `educations`, `projects`, `project_details`, `achievements`, `skills`, `project_skills`
- RPC: `get_data_readiness()`, `get_deletion_impact(...)`, `delete_career_item(...)`, 상세 내용 순서 변경(아래)
- AI 기능 없음 → ai-pipeline-engineer 호출 안 함
- 연결: UI 화면 없음 → A2 career "연결 대기"

## 앞 슬라이스 결정 (반드시 따른다)
- 헬퍼는 `private` 스키마. `app_ai_writer` 정책은 `(select private.current_uid())`.
- public 기본 권한이 회수돼 있다 → **테이블·함수마다 grant 명시**(anon 없음, authenticated 최소, app_ai_writer는 커리어 7개 테이블 select만 — 컬럼 단위 또는 테이블 단위 select, `grants.test.sql` 허용 목록 갱신 필요).
- `private.set_updated_at()`, `private.touch_career_data_updated_at()`를 7개 테이블에 연결(DM §2.1).

## 계약 초안 (DB)
### status 계산 — DB가 단일 원천
- `experiences`, `educations`, `project_details`, `achievements`: BEFORE INSERT/UPDATE 트리거가 필드 조건으로 `status`를 계산(클라이언트가 보낸 status는 무시). CHECK `(status = 'draft' OR 필수 필드 not null)`도 둔다.
- `projects`: 필드 조건(`name`, `role`) **그리고** complete 상세 내용 ≥ 1. 자기 BEFORE 트리거 + `project_details` AFTER insert/update(status, project_id)/delete 트리거가 부모 재계산. 부모 재계산은 `updated_at`도 바뀐다(DM §4.2 마지막 줄).
- 이렇게 하면 "서버가 저장마다 재계산"을 Server Action 버그와 무관하게 보장한다 [구현 결정].

### 컬럼·제약 메모
- 모든 테이블 `unique (id, user_id)`, 자식은 복합 FK `(parent_id, user_id)` (DM-2). `on delete set null (experience_id)` 같은 컬럼 지정 set null은 PG15+ 문법.
- 년-월은 date이고 1일 고정(DM-4): CHECK `extract(day from x) = 1`.
- experiences: `is_current`면 `end_month is null` CHECK. `end_month >= start_month`.
- `source_writing_chat_id` (projects, project_details, achievements): **uuid 컬럼만 추가하고 FK는 S4에서** `writing_chats` 생성 시 추가 [가정 → decisions].
- achievements `kind` generated: DM에 정의가 없다 → `kind text generated always as (case when metric_name is not null and (value_before is not null or value_after is not null) then 'quantitative' else 'qualitative' end) stored` [가정 → spec-gaps]. `value_before`/`value_after`는 numeric.
- skills `normalized_name`: `lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))` generated stored [가정 → spec-gaps]. 고아 태그 스킬 자동 삭제: `project_skills` delete 후 트리거(`is_manual = false`이고 연결 0이면 삭제).
- project_details `sort_order`: `unique (project_id, sort_order) deferrable initially deferred`.

### RPC
- `get_data_readiness() returns jsonb` — §6 JSON 모양 그대로. security invoker, authenticated. 포함 규칙: complete 행만, draft 부모의 자식 제외.
- `reorder_project_details(p_project_id uuid, p_ordered_ids uuid[]) returns void` — security invoker. 지연 unique 덕에 한 트랜잭션에서 재번호. 목록이 그 프로젝트의 상세 내용 전체와 같지 않으면 예외.
- `get_deletion_impact(p_entity_type text, p_entity_id uuid, p_affiliation_mode text default 'keep_projects') returns jsonb` — `cascade` 개수(projects, project_details, achievements, project_skills, writing_chats). `affected_results.by_application_project`는 **S2에서는 항상 `[]`**: 결과 테이블(evidence_links, draft_section_sources, insights…)이 S3·S5–S7에서 생긴다. 해당 슬라이스가 `create or replace`로 집계를 확장한다. `writing_chats` 개수도 S4 전에는 0. `entity_type = 'writing_chat'`은 S4에서 추가(지금은 `invalid_entity_type`).
- `delete_career_item(p_entity_type text, p_entity_id uuid, p_affiliation_mode text default 'keep_projects', p_result_mode text default 'keep') returns jsonb`(삭제 개수) — security invoker(DM §5). `affiliation_mode` ∈ (`keep_projects`, `delete_projects`) [값 이름 가정, DM에 기본값 설명만 있음], `result_mode` ∈ (`keep`, `delete`) — S2에서는 결과 테이블이 없어 `delete`도 커리어 삭제만 한다.
- `entity_type` 목록: `experience`, `education`, `project`, `project_detail`, `achievement`, `skill` (+ S4 `writing_chat`).
- 모든 RPC: `revoke all from public`, `grant execute to authenticated`. app_ai_writer는 `get_data_readiness`만 실행 가능해야 하는지? → AI Route Handler가 다시 확인(§6)하므로 **app_ai_writer에도 execute grant** [구현 결정].

### pgTAP
교차 사용자 격리(7개 테이블), 복합 FK가 남의 부모 연결 차단, status 계산(각 테이블 + 상세 내용 추가·삭제로 프로젝트 상태 변화), CHECK, career_data_updated_at 갱신, 고아 스킬 삭제, readiness 각 분기(교육만, 경력만, draft 부모의 complete 자식 제외, augment_project 제안), deletion impact·delete 양 모드, reorder, app_ai_writer는 select만, grants 가드 갱신.

## 계약 초안 (API)
- contracts `src/lib/contracts/career.ts`: 테이블별 저장 입력 zod(전부 optional 부분 저장 — 자동 저장은 draft 허용), 길이 제한은 DM과 같게, 년-월은 `'YYYY-MM'` 문자열 ↔ date 변환. `enums.ts`에 `EMPLOYMENT_TYPES`, `EDUCATION_TYPES`, `ENROLLMENT_STATUSES`, `CAREER_STATUSES`, `SKILL_PROFICIENCIES`, `ACHIEVEMENT_KINDS`, `DELETABLE_ENTITY_TYPES`, `AFFILIATION_MODES`, `RESULT_MODES`.
- Server Actions `src/server/actions/career.ts` (모두 `requireConsentedUser`):
  - 자동 저장: `saveExperience`, `saveEducation`, `saveProject`, `saveProjectDetail`, `saveAchievement` — `{ id? , ...fields }` upsert(id 없으면 insert해서 id 반환), 반환 `{ id, status, updated_at }`. 낙관적 동시성: 입력에 `expectedUpdatedAt`이 있으면 다르면 `conflict` 오류 [구현 결정, UI 자동 저장 충돌 대비].
  - 스킬: `addProjectSkill({ projectId, name })`(normalized_name으로 기존 스킬 재사용, 없으면 `is_manual=false` 생성), `removeProjectSkill`, `addManualSkill`, `updateSkill`.
  - `reorderProjectDetails`, `getDeletionImpact`, `deleteCareerItem`, `getDataReadiness`.
- 서비스 `src/server/services/career/`: 조회 `getCareerTree()` — 7개 테이블을 한 번에 읽고(§7 첫 행) **연도 묶음 계산은 순수 함수** `groupCareerByYear(rows, today)` (§2.4 규칙: 경력·교육은 활동한 모든 연도, 프로젝트는 시작 연도 또는 소속 시작 연도, 독립 = "기타 프로젝트", 기간 없음 = "연도 미정", 최신 연도 위). Vitest로 규칙 전부 테스트. writing_chats(active)는 S4에서 추가.
- 통합 테스트(로컬 스택): 자동 저장 → status 변화, 다른 사용자 id로 저장 시도 차단, 삭제 영향/삭제.

## 작업 순서
- db-engineer 먼저 마이그레이션 + 타입 → api-engineer는 계약·연도 묶음 순수 함수부터 병렬로 시작, 타입이 나오면 서비스·액션 연결.
- QA: 모듈별 → 전체 + `--build`.

## 원격 브랜치 적용: 하지 않음
