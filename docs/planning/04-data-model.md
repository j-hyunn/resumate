# Resumate 데이터 모델 v3.2a

> 작성: data-architect / 기준 입력: `_workspace/01_product-planner_prd.md` (**PRD v3.2**), `_workspace/02_ux-planner_flows.md` (**화면 명세 v4.2**), `_workspace/02_ai-feature-designer_ai-spec.md` (**AI 명세 v3.2**), `_workspace/00_input/brief.md` (추가 수정 피드백 2차 포함), `product-context.md`
> 상태: v3.2a (확인 패스 R-35 반영) / v3.2 (리뷰 라운드 2 반영: R-27, R-28, R-29, R-13 잔여 / 사용자 결정 2026-10-24 반영: U-2, U-5, U-8, U-9 등, 8장). **문서만 작성했다. 마이그레이션·SQL은 적용하지 않았다.** `[가정]`·`[결정 필요]`·`[보류]` 항목은 확정이 아니다.
> 이 문서의 테이블·컬럼명이 **확정명**이다. UX v4·AI v3 문서와 다른 이름은 11장 `요청 회신`에 old → new로 정리했다. 버전별 변경은 10장.
> 표기: "프로젝트"(`projects`)는 커리어의 업무 단위. 지원 건 단위는 문서·데이터에서 **"지원 프로젝트"**(`application_projects`), 메뉴 라벨 **"기업 JD 관리"**, 화면 표기 **"기업 JD"**, JD 원문(`job_descriptions.raw_text`)은 화면에서 **"공고 원문"**(PRD D-20, UX D-UX-10). "상세 내용"(`project_details`)은 프로젝트 아래 STAR 기록. "AI 작성 대화"(`writing_chats`)는 커리어 채팅(`chat_threads`, Should)과 다르다.

---

## 0. 설계 원칙과 핵심 결정

| # | 결정 | 이유 |
|---|------|------|
| DM-1 | 모든 사용자 데이터 테이블은 `user_id ... references auth.users(id) on delete cascade` | 탈퇴 시 전체 파기를 DB가 보장 |
| DM-2 | 부모–자식은 복합 FK `(parent_id, user_id)` | 소유자 혼합 차단 |
| DM-3 | 열거값은 `text + CHECK` | 기획 중 값 변경이 잦다 |
| DM-4 | 년-월은 `date`(1일 고정) | 정렬·기간·연도 묶음 계산 |
| DM-5 | AI 결과는 jsonb + `schema_version`, 재생성은 새 행(자소서 문항은 덮어쓰기) | |
| DM-6 | 근거는 `evidence_links`에만 | 삭제 시 인용문 일괄 삭제 |
| DM-7 | 근거·근거 선택은 soft reference | "원본 삭제됨" 표시 |
| DM-8 | 커리어 데이터 자동 저장은 본 테이블 `status = 'draft'` | |
| DM-9 | AI 실행은 `ai_jobs`, 사용량은 `usage_events` 원장 | |
| DM-10 | RAG·pgvector 미사용 | |
| DM-11 | 커리어 테이블과 지원 프로젝트 테이블 분리, 둘 사이는 soft reference뿐 | |
| DM-12 | 지원 프로젝트 하위 결과의 소유 키는 `application_project_id` 하나 | D-19 (a) 전제 |
| DM-13 (v3 개정) | **커리어 데이터 쓰기는 사용자 세션에서만.** AI 작업용 DB 역할 `app_ai_writer`는 커리어 테이블을 읽기만 한다. AI 작성 대화의 "저장"·"폼으로 전환"은 AI 호출이 없는 **사용자 확정 동작**이며 사용자 세션 RPC로 실행한다(3.3절) | NFR-AI-05 v3 |
| **DM-14 (v3)** | **커리어 계층: 경력 / 교육 > 프로젝트 > 상세 내용(STAR) > 정량 성과.** 연도는 저장하지 않는 보기 계층(D-22) | PRD v3 F-P1-09, 14, 15 |
| **DM-15 (v3)** | **AI 작성 대화의 출처(필드별 발화)는 `writing_chats.structured_draft` 안에 둔다. `evidence_links`에는 넣지 않는다** | 커리어 데이터를 만드는 과정의 기록이며, 저장 후의 근거 원본은 커리어 항목 자체다(AI 명세 AI-12 동의) |

### 공통 컬럼
`id` uuid PK / `user_id` (DM-1) / `created_at` / `updated_at`(트리거, 모든 근거 원본 테이블 필수). 예외는 표에 명시.

### AI 출력 공통 메타
`ai_job_id`, `schema_version`, `prompt_version`, `model`, `input_hash`, `career_snapshot_hash`, `validation_report`, `usage` (v2와 같음).

---

## 1. ERD

```mermaid
erDiagram
  auth_users ||--|| profiles : "1:1"
  auth_users ||--o{ consents : agrees
  auth_users ||--o{ experiences : "커리어"
  auth_users ||--o{ educations : "커리어"
  auth_users ||--o{ projects : "커리어"
  auth_users ||--o{ skills : "커리어"
  auth_users ||--o{ writing_chats : "AI 작성 대화"
  auth_users ||--o{ application_projects : "지원 프로젝트"
  auth_users ||--o{ usage_events : "is charged"

  experiences |o--o{ projects : "소속 (최대 1)"
  educations |o--o{ projects : "소속 (최대 1)"
  projects ||--o{ project_details : "상세 내용 (STAR)"
  project_details ||--o{ achievements : "결과(R)의 정량 성과"
  experiences ||--o{ achievements : "경력 단위 성과"
  projects ||--o{ project_skills : tagged
  skills ||--o{ project_skills : tags

  projects |o--o{ writing_chats : "대화 (cascade)"
  writing_chats ||--o{ writing_chat_messages : has
  writing_chats |o..o{ projects : "source_writing_chat_id (set null)"
  writing_chats |o..o{ project_details : "source_writing_chat_id (set null)"

  application_projects ||--|| job_descriptions : "1:1 (D-19)"
  application_projects ||--o{ application_stage_events : "전형 이력"
  job_descriptions ||--o{ jd_requirements : "extracted into"
  application_projects ||--o{ insights : versions
  application_projects ||--o{ drafts : has
  drafts ||--o{ draft_sections : "문항 / 경력·교육 섹션"
  draft_sections ||--o{ draft_section_sources : "사용한 경력·프로젝트"
  application_projects ||--o{ interview_sessions : has
  interview_sessions ||--o{ interview_questions : has
  interview_questions ||--|| interview_answers : "1:1"
  interview_answers ||--o| answer_evaluations : evaluated
  interview_sessions ||--o| session_feedbacks : summarized
  application_projects ||--o{ ai_jobs : "scoped"
  application_projects ||--o{ evidence_links : "scoped"

  evidence_links }o..|| experiences : "source (soft)"
  evidence_links }o..|| educations : "source (soft)"
  evidence_links }o..|| projects : "source (soft)"
  evidence_links }o..|| project_details : "source (soft, STAR 필드)"
  evidence_links }o..|| achievements : "source (soft)"
  evidence_links }o..|| skills : "source (soft)"
  draft_section_sources }o..|| projects : "pick (soft)"
  draft_section_sources }o..|| project_details : "pick (soft, 배열)"
```

- 실선 = FK, 점선 = soft reference 또는 set null 참조. 커리어 → 지원 프로젝트 방향 FK 없음(v2와 같음).
- 비사용자 테이블(`policy_versions`, `usage_limits`, `account_deletion_logs`)과 Should 테이블(`chat_threads`, `chat_messages`, `result_ratings`, `ai_suggestions`)은 생략.

---

## 2. 테이블 정의

### 2.1 계정·동의
- `profiles`: v2와 같음. `career_data_updated_at` 트리거 대상에 `educations`, `project_details` 추가(7개 테이블: experiences, educations, projects, project_details, achievements, skills, project_skills).
- `consents` / `policy_versions`: v2와 같음. 국외 이전 항목에 AI 작성 대화 추가(NFR-PRV-03 v3)는 정책 버전 갱신 → 재동의로 처리, 스키마 영향 없음.

### 2.2 커리어 — 공통 규칙

- `experiences`, `educations`, `projects`, `project_details`, `achievements`는 `status text not null default 'draft' CHECK in ('draft','complete')`. 서버가 저장마다 다시 계산하고, 필수 필드는 `CHECK (status = 'draft' OR (필수 필드 not null))`로 강제한다(draft 행에서는 필수 컬럼 nullable).
- **완료 판정 (v3)**

  | 테이블 | complete 조건 | 판정 위치 |
  |--------|---------------|-----------|
  | experiences | `company_name`, `start_month`, (`job_rank` 또는 `job_position`) | 저장 시 + CHECK |
  | educations | `institution_name`, `education_type`, `start_month` | 저장 시 + CHECK |
  | project_details | `title`, `situation`, `action` | 저장 시 + CHECK |
  | **projects** | `name`, `role` **+ 이 프로젝트의 `complete` 상세 내용 ≥ 1** | 자식 의존이라 CHECK로 표현 불가 → `project_details` insert/update/delete 트리거가 부모 `projects.status`를 다시 계산. CHECK는 필드 조건만 강제 |
  | achievements | `description` 또는 (`metric_name` and (`value_before` or `value_after`)) | 저장 시 + CHECK |

- **AI 경력 팩·데이터 최소 기준 포함 규칙**: `complete` 행만. `draft` 부모(경력·교육·프로젝트·상세 내용)의 자식은 `complete`여도 제외(v2 확인 1을 교육·상세 내용까지 확장).
- **쓰기 주체**: 사용자 세션(RLS)만. `app_ai_writer`는 select만(3.3절).

### 2.3 커리어 테이블

#### experiences (v2와 같음)
`status`, `company_name`, `start_month`, `end_month`, `is_current`, `job_rank`, `job_position`, `department`, `employment_type`, `summary`. 인덱스 `(user_id, start_month desc)`, `(user_id) where status = 'draft'`.

#### educations (v3 신설)
- 설명: 학위 과정 또는 교육 과정(부트캠프·사내외 교육). 관련 기능: F-P1-14 / 요청: ux S-08·S-34 요청 1, ai C-1

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `status` | text | 공통 규칙 | |
| `institution_name` | text | complete 시 필수, ≤ 100자 | 학교·교육기관명 |
| `education_type` | text | complete 시 필수, CHECK in (`degree`, `course`) | 학위 과정 / 교육 과정 |
| `program_name` | text | null, ≤ 100자 | 전공·과정명 |
| `start_month` | date | complete 시 필수, 1일 고정 | |
| `end_month` | date | null, `>= start_month` | |
| `enrollment_status` | text | null, CHECK in (`enrolled`, `graduated`, `completed`, `dropped_out`, `on_leave`), `CHECK (enrollment_status <> 'enrolled' OR end_month IS NULL)` | 재학·수강 중 / 졸업 / 수료 / 중퇴 / 휴학 |
| `description` | text | null, ≤ 2,000자 | |

- **학점·성적 컬럼 없음**(NFR-PRV-01 v3). 자격증 `[보류]`.
- `unique (id, user_id)`. RLS 4개 동작 본인(사용자 세션). 인덱스 `(user_id, start_month desc)`, `(user_id) where status = 'draft'`.

#### projects (v3 개정)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `status` | text | 공통 규칙 (완료 = 필드 + complete 상세 내용 ≥ 1) | |
| `experience_id` | uuid | null, 복합 FK → `experiences on delete set null (experience_id)` | |
| `education_id` | uuid | **v3 신설**, null, 복합 FK → `educations on delete set null (education_id)` | |
| — | — | `CHECK (num_nonnulls(experience_id, education_id) <= 1)` | 경력 / 교육 / 없음 중 하나 |
| `name` | text | complete 시 필수 | |
| `role` | text | complete 시 필수 | 본인 역할 |
| `summary` | text | **v3 신설**, null, ≤ 200자 | 한 줄 요약 |
| `start_month`, `end_month` | date | null | |
| `team_size` | smallint | null | |
| `source_writing_chat_id` | uuid | **v3 신설**, null, FK → `writing_chats on delete set null` | 이 행을 만든 AI 작성 대화("출처 대화 보기") |

- **v3 삭제**: `contribution`(→ `project_details.action` 등 STAR), `team_context`(→ `project_details.situation`). D-AI-05 해소.
- 인덱스 `(user_id, experience_id)`, `(user_id, education_id)`, `(user_id, start_month desc)`.

#### project_details (v3 신설)
- 설명: 프로젝트 아래 STAR 에피소드. 프로젝트당 여러 개(D-23 (b)). 관련 기능: F-P1-15, F-P1-04 / 요청: ux S-08·S-10·S-35 요청 2, ai C-1(`DET-n`)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `project_id` | uuid | 복합 FK → `projects on delete cascade` | |
| `status` | text | 공통 규칙 | |
| `title` | text | complete 시 필수, ≤ 100자 | |
| `situation` | text | complete 시 필수, ≤ 2,000자 | 상황 S (배경·팀 구성, 기존 "팀·배경") |
| `task` | text | null, ≤ 2,000자 | 과제 T |
| `action` | text | complete 시 필수, ≤ 2,000자 | 행동 A (본인이 직접 한 일, 기존 "기여 내용") |
| `result` | text | null, ≤ 2,000자 | 결과 R 서술. 정량 성과는 `achievements.project_detail_id` |
| `learnings` | text | null, ≤ 2,000자 | 화면 표시명 **"회고 및 배운 점"**(사용자 결정 U-2, 2026-10-24). 컬럼명은 `learnings` 유지. **사용자의 회고** — AI는 사실 근거로 쓰지 않음(NFR-AI-06, AI V-8) |
| `sort_order` | smallint | not null, `unique (project_id, sort_order)` 지연 검사 | 프로젝트 안 순서 |
| `source_writing_chat_id` | uuid | null, FK → `writing_chats on delete set null` | |

- `unique (id, user_id)`. RLS 4개 동작 본인(사용자 세션). 인덱스 `(project_id, sort_order)`, `(user_id) where status = 'draft'`.
- 트리거: insert/update(status)/delete 시 부모 `projects.status` 재계산 + `profiles.career_data_updated_at` 갱신.

#### achievements (v3 개정, D-24 (b))

| 컬럼 | 변경 |
|------|------|
| `project_detail_id` | **v3 신설**, null, 복합 FK → `project_details on delete cascade`. **v2 `project_id` 대체** |
| `experience_id` | 유지 (경력 단위 성과: 연간 평가·수상) |
| — | `CHECK (num_nonnulls(project_detail_id, experience_id) = 1)` |
| `metric_name`, `value_before`, `value_after`, `unit`, `description`, `kind`(generated), `status` | 유지 |
| `source_writing_chat_id` | **v3 신설**, null, FK → `writing_chats on delete set null` |

- **v3 삭제**: `project_id`. 마이그레이션 시점에 기존 데이터가 없으므로 변환 규칙은 두지 않는다(planning only).
- 인덱스 `(user_id, project_detail_id)`, `(user_id, experience_id)`.

#### skills / project_skills (v2와 같음)

### 2.4 연도 보기 (D-22 (b)) — 저장하지 않는다

- 연도는 **컬럼·테이블로 저장하지 않는다.** 화면이 읽을 때 계산한다.
  - 경력·교육: `extract(year from start_month)` ~ `extract(year from coalesce(end_month, 현재월))`의 모든 연도에 표시(재직·재학 중이면 올해까지).
  - 프로젝트: `extract(year from coalesce(projects.start_month, 소속 경력·교육의 start_month))` 한 해. 소속도 기간도 없으면 "연도 미정"(UX 가정 수용, PRD 확인 대기).
  - 독립 프로젝트는 그 해의 "기타 프로젝트" 묶음.
- 지원 장치: 새 컬럼 없음. 기존 인덱스 `(user_id, start_month desc)`(experiences, educations, projects)로 충분하다(사용자당 수십 행). 서버가 한 번에 읽어 메모리에서 묶는다. 필요하면 읽기 전용 뷰 `career_year_entries`(security invoker, `user_id`, `year`, `entity_type`, `entity_id`)를 둘 수 있으나 MVP는 앱 계산을 권고 `[가정]`.
- 접힘 상태는 브라우저 저장(UX 가정), DB 없음.

### 2.5 AI 작성 대화 (v3 신설, F-P1-13)

#### writing_chats
- 설명: 프로젝트 1건을 AI와 대화하며 정리하는 세션. 관련 기능: F-P1-13, F-P1-06 / 요청: ux S-08·S-10·S-36 요청 5, ai AI-12

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `mode` | text | not null, CHECK in (`new_project`, `augment_project`) | 새 프로젝트 / 기존 프로젝트 보강 |
| `project_id` | uuid | null, 복합 FK → `projects on delete cascade` | 보강 대상, 또는 저장·폼 전환으로 만들어진 프로젝트. `new_project`는 저장 전 null. **프로젝트를 지우면 대화도 삭제**(NFR-PRV-06) |
| `experience_id` | uuid | null, FK → `experiences on delete set null` | 정해 둔 소속 경력 |
| `education_id` | uuid | null, FK → `educations on delete set null` | 정해 둔 소속 교육 |
| — | — | `CHECK (num_nonnulls(experience_id, education_id) <= 1)` | |
| `status` | text | not null default `active`, CHECK in (`active`, `saved`, `handed_off`, `abandoned`) | 진행 중 / 저장 완료 / 폼으로 전환 / 그만둠 |
| `structured_draft` | jsonb | not null default `'{}'` | 정리 결과(아래 형식). 저장 전 커리어 데이터가 아니며 팩에 들어가지 않는다 |
| `message_count` | smallint | not null default 0, `CHECK (message_count >= 0)`. **상한 40은 RPC `append_writing_chat_message`에서 검사**(행 잠금 후 `message_count < 40`일 때만 insert). 상한이 확정되면 `CHECK (message_count <= 40)` 추가 | 사용자 + AI 메시지 합계. 상한 40 `[가정]`(D-17 v3) |
| `usage_event_id` | uuid | null (soft) | 이 대화의 차감 기록. null = 아직 차감 전 |
| `last_activity_at` | timestamptz | not null default now() | "작성 중인 AI 대화" 정렬 |
| `saved_at` | timestamptz | null | |
| `return_target` | jsonb | null | **v3.2 신설 (U-5)**: 데이터 부족 게이트에서 시작한 대화의 복귀 대상 `{application_project_id, feature, params, created_at}`. `feature` ∈ `insight` / `career_description` / `cover_letter` / `job_interview`, `params`는 화면 설정(예: `{question_count: 5}`, 자소서 `draft_id`). soft reference(지원 프로젝트가 지워지면 무시). 저장·폼 전환 후 화면이 읽고 복귀하면 null로 비움 |

- **`structured_draft` 형식** (AI 명세 형식 채택, 출처는 메시지 UUID):

```json
{
  "schema_version": 1,
  "project": {
    "name": { "value": "결제 플랫폼 성능 개선", "origin": "ai", "source_message_ids": ["uuid"], "source_quotes": ["…"], "review": "ok", "reviewed_at": null },
    "summary": { "value": "…", "origin": "ai", "source_message_ids": ["uuid"], "source_quotes": ["…"], "review": "accepted", "reviewed_at": "2026-10-24T10:00:00Z" },
    "role": { "value": "백엔드 리드", "origin": "user_edit", "source_message_ids": [], "source_quotes": [], "review": "ok", "reviewed_at": null }
  },
  "affiliation_suggestion": { "type": "experience", "id": "uuid", "source_message_ids": ["uuid"] },
  "details": [
    {
      "detail_key": "D1",
      "existing_detail_id": null,
      "fields": { "title": { … }, "situation": { … }, "task": { … }, "action": { … }, "result": { … }, "learnings": { … } },
      "achievements": [ { "metric_name": { … }, "value_before": { … }, "value_after": { … }, "unit": { … } } ]
    }
  ],
  "skills": [ { "value": "Kafka", "source_message_ids": ["uuid"], "source_quotes": ["…"] } ],
  "clarifications": [ { "kind": "actor_ambiguous", "field": "action", "detail_key": "D1" } ],
  "sensitive_flags_count": 0
}
```
  - 필드 객체: `value`, `origin`(`ai` / `user_edit`), `source_message_ids`(uuid[], **`role = 'user'` 메시지만**, AI V-9a), `source_quotes`, `review`, `reviewed_at`.
  - **`review` 값 (v3.2, R-27·T-18)**: `ok`(AI가 검증 통과로 낸 값 또는 사용자 직접 입력) / `needs_review`(V-9e, 사용자 확인 전) / **`accepted`**(사용자가 수락). **거절**하면 `value = null`, `review = 'ok'`, `reviewed_at` 기록(빈 필드가 되어 다음 턴에 다시 질문됨). 수락·거절은 사용자 세션의 `apply_structured_draft_patch`로 `structured_draft`에 저장되므로 **대화를 이어 해도 유지**된다. `accepted` 필드는 이후 AI 패치가 덮어쓰지 않는다.
  - **쓰는 값 규칙**: 저장·폼 전환은 `review in ('ok','accepted')`이고 `value`가 있는 필드만 쓴다. **`needs_review` 필드는 두 RPC 모두 쓰지 않는다.**
  - `existing_detail_id`: `augment_project`에서 기존 상세 내용의 빈 필드를 채울 때.
  - **필드 키 = 저장 대상 컬럼명**(v3.1 명확화): `project`의 키는 `name`, `role`, `summary`, `start_month`, `end_month`, `team_size`. **소속(`experience_id`/`education_id`)은 `structured_draft`에 두지 않는다**(v3.2, R-28·T-19) — 확정 소속의 단일 원천은 `writing_chats.experience_id` / `education_id` 컬럼. `affiliation_suggestion`은 AI 제안일 뿐이며, 사용자가 [연결]하면 RPC `set_writing_chat_affiliation`이 컬럼을 채우고 제안을 지우고, [아니요]면 제안만 지운다. 값 형식은 컬럼 타입을 따른다 — `start_month`/`end_month`는 `'YYYY-MM'` 문자열(저장 시 1일 date), `team_size`는 정수, 정량 성과 `value_before`/`value_after`는 숫자. 스킬은 `project`가 아니라 최상위 `skills[]`. AI 출력의 `period`·`skills` 패치는 서버가 이 키로 바꿔 넣는다(AI-12 매핑은 R-02로 ai-feature-designer가 정리).
  - 민감정보로 걸러진 내용은 저장하지 않는다(개수만, NFR-PRV-05).
- **`structured_draft`는 RPC로만 바꾼다 (v3.2, R-29)** — `apply_structured_draft_patch(writing_chat_id, patch jsonb)`:
  - 호출 주체: **AI 턴 = `app_ai_writer`**(턴 처리 서버, 검증 V-9 통과분), **사용자 수정·수락·거절 = 사용자 세션**(미리보기 서버 액션). 행위자는 인자가 아니라 호출 역할로 판정한다(AI 패치는 `origin = 'ai'`, 사용자 패치는 `origin = 'user_edit'` 또는 review 변경).
  - 공통: 행 잠금(`select … for update`), `status = 'active'`인 대화만, 결과를 같은 트랜잭션에서 저장하고 `last_activity_at` 갱신.
  - AI 패치 규칙: `origin = 'user_edit'`이거나 `review = 'accepted'`인 필드는 덮어쓰지 않는다. `source_message_ids`가 이 대화의 `role = 'user'` 메시지가 아니면 거부(V-9a 재확인).
  - **V-9h 보장 (AI·사용자 공통)**: `augment_project`에서 `existing_detail_id`가 가리키는 기존 `project_details` 행의 해당 컬럼, 또는 대상 `projects` 행의 해당 컬럼이 **이미 채워져 있으면 그 필드 패치를 거부**한다(기존 값 보호). `save_writing_chat`의 "빈 필드에만" 규칙이 최종 방어로 남는다.
  - 사용자 패치 규칙: 필드 값 수정(→ `origin = 'user_edit'`, `review = 'ok'`), `needs_review` → `accepted` / 거절. 소속은 이 RPC가 아니라 `set_writing_chat_affiliation`.
- 쓰기 주체 요약: `app_ai_writer` = `apply_structured_draft_patch`(AI) + `message_count`·`last_activity_at`. 사용자 세션 = `apply_structured_draft_patch`(사용자), `set_writing_chat_affiliation`, `status`, `return_target`, 저장·전환 RPC. **`structured_draft` 컬럼에 대한 직접 update 권한은 누구에게도 주지 않는다.**
- RLS: select/delete 본인. insert는 서버 액션(사용자 세션). update는 위 RPC·제한 컬럼만.
- 인덱스: `(user_id) where status = 'active'`, `(user_id, project_id)`.

#### writing_chat_messages

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `writing_chat_id` | uuid | 복합 FK → `writing_chats on delete cascade` | |
| `sequence` | smallint | not null, `unique (writing_chat_id, sequence)` | 화면 "내 답변 #n"은 사용자 메시지만 다시 번호 매김 |
| `role` | text | not null, CHECK in (`user`, `assistant`) | |
| `content` | text | not null, ≤ 4,000자 `[가정]` | |
| `status` | text | not null default `done`, CHECK in (`streaming`, `done`, `failed`) | AI 응답 실패 턴 "다시 보내기" |
| `ai_job_id` | uuid | null (soft) | assistant 메시지를 만든 턴 작업. 시작 인사(고정 문구)는 null |

- 공통 컬럼 중 `updated_at`은 streaming → done 전환에만 쓰인다.
- RLS: select 본인. user 메시지 insert는 사용자 세션 RPC `append_writing_chat_message`(상한 검사 + `message_count` 증가를 한 트랜잭션). assistant 메시지 insert/update는 `app_ai_writer`. update·delete 개별 없음(대화 삭제로만).

### 2.6 지원 프로젝트 (AP + ST)

#### application_projects (v3 개정)

| 컬럼 | 변경 |
|------|------|
| `name`, `name_source`(user/ai/default), `deadline`, `memo`, `last_activity_at`, `duplicated_from_id` | v2와 같음 |
| `application_status` | **v3 삭제**(F-AP-07 폐기) → `stage` |
| `stage` | **v3 신설**, not null default `before_apply`, CHECK in (`before_apply`, `document`, `assignment`, `job_interview`, `culture_fit_interview`, `closed`) — 지원 전 / 서류 전형 / 과제 전형 / 직무 인터뷰 전형 / 컬처핏 전형 / 전형 종료 |
| `stage_outcome` | **v3 신설**, null, CHECK in (`passed`, `failed`), `CHECK (stage = 'closed' OR stage_outcome IS NULL)` — 최종 합격 / 불합격. null + closed = "결과 미기록" |
| `stage_changed_at` | **v3 신설**, not null default now() — 보드 열 안 정렬(D-26 (a) 최근 이동순) |

- `stage`·`stage_outcome`·`stage_changed_at`은 **직접 update 권한을 주지 않고** RPC로만 바꾼다(이력 누락 방지, 아래).
- 인덱스: `(user_id, stage, stage_changed_at desc)` (보드), 기존 `(user_id, last_activity_at desc)`, `(user_id, deadline)`.
- 복제(F-AP-09 Could)·신규 생성 시 `stage = 'before_apply'`, 생성 이벤트 기록.

#### application_stage_events (v3 신설, F-ST-05)
- 설명: 전형 단계·결과 변경 이력. 화면에 보이지 않아도 MVP부터 쌓는다. 불변.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `application_project_id` | uuid | 복합 FK → `application_projects on delete cascade` | 지원 프로젝트와 함께 삭제(F-AP-05) |
| `event_type` | text | not null, CHECK in (`created`, `stage_changed`, `outcome_changed`) | |
| `from_stage` | text | null | `created`면 null |
| `to_stage` | text | not null | |
| `from_outcome` | text | null | 종료에서 나가며 지워진 결과도 여기 남는다(D-UX-12) |
| `to_outcome` | text | null | |
| `created_at` | timestamptz | | 이동 시각. `updated_at` 없음(불변) |

- RLS: select 본인. insert는 RPC만(security definer, `auth.uid()` 소유 검사). update·delete 없음(연쇄만).
- 인덱스: `(application_project_id, created_at)`.
- **RPC `move_application_stage(application_project_id, to_stage, outcome default null)`** (한 트랜잭션):
  1. `to_stage = stage`이면 아무것도 하지 않음(이벤트 없음).
  2. 현재 `closed`이고 `to_stage <> 'closed'`이면 `stage_outcome = null`(D-UX-12 (a) 권고. 화면이 사전 확인).
  3. `to_stage = 'closed'`이고 `outcome`이 주어지면 함께 기록.
  4. `stage`, `stage_changed_at = now()`, `last_activity_at` 갱신 → `stage_changed` 이벤트 insert(이전·새 결과 포함).
  5. 반환: 새 상태 + `interview_prompt`(`to_stage`가 `job_interview`/`culture_fit_interview`일 때 `{interview_type, in_progress_session_id}`) — C-14 팝업용. **AI 호출·사용량 없음.**
- **RPC `set_application_outcome(application_project_id, outcome)`**: `stage = 'closed'`일 때만, `outcome_changed` 이벤트.

#### job_descriptions / jd_requirements (v2와 같음)

### 2.7 인사이트·서류·면접 (v2와 같음, 변경분만)

| 테이블 | v3 변경 |
|--------|---------|
| insights | 없음 |
| drafts | 없음 (`options.included_*`에 `included_education_ids` 키 추가) |
| draft_sections | `section_kind` CHECK에 **`education`** 추가(경력기술서 교육 섹션, AI-03). `experience_id`(soft) 옆에 **`education_id`**(soft) 추가 |
| draft_section_sources | **`education_id`**(soft, 교육 소속 프로젝트·교육만 선택) 추가, **`project_detail_ids`** uuid[] 추가(그 문항에서 실제 사용한 상세 내용). CHECK: `num_nonnulls(experience_id, education_id, project_id) >= 1` 그리고 `num_nonnulls(experience_id, education_id) <= 1` |
| interview_sessions / questions / answers / answer_evaluations / session_feedbacks | 없음 (F-ST-04 팝업은 세션을 만들지 않는다) |

- `draft_section_sources.project_detail_ids`의 원본 삭제: 배열 원소 단위 soft 표시가 어려우므로 삭제 트리거가 해당 ID를 배열에서 빼고 `source_deleted_at`은 프로젝트·경력·교육 삭제 때만 기록한다. 상세 내용 단위 "원본 삭제됨"은 같은 문항의 `evidence_links`(source_type `project_detail`)가 표시한다.

### 2.8 근거 (evidence_links)

| 항목 | v3 |
|------|----|
| `source_type` | CHECK에 **`education`**, **`project_detail`** 추가 → `profile`, `experience`, `education`, `project`, `project_detail`, `achievement`, `skill`, `jd_requirement`, `jd_sentence`, `interview_answer`, `user_note` |
| `source_field` | `project_detail`: `title`, `situation`, `task`, `action`, `result`, `learnings` / `education`: `institution_name`, `program_name`, `education_type`, `enrollment_status`, `period`, `description` / `project`: `name`, `role`, `team_size`, `summary`, `period`(v2의 `contribution`, `team_context` 제거) |
| 회고 근거 표시 | 별도 플래그 컬럼 없음. **`source_type = 'project_detail' AND source_field = 'learnings'`**이면 화면이 "회고 및 배운 점" 칩으로 표시(UX 요청 3 회신, U-2). V-8 검사는 저장 전에 끝난다 |
| `source_snapshot_at` | `project_detail`은 상세 내용 행의 `updated_at`(필드 단위 아님 — 다른 STAR 필드 수정도 "변경됨"이 될 수 있음 `[가정]`, v1 4.3과 같은 한계) |
| `writing_chat_message` | **넣지 않는다**(DM-15). AI 명세 C-3 표의 `writing_chat_message`는 `structured_draft` 안 출처로만 쓴다 |

- 삭제 트리거 대상 테이블에 `educations`, `project_details` 추가.

### 2.9 AI 작업·사용량

#### ai_jobs
- `job_type` CHECK에 **`writing_chat_turn`** 추가(AI-12 턴 1회 = 1행, `target_type = 'writing_chat'`, `application_project_id` null).
- `progress.stage` 키에 `extract`, `reply` 추가.
- 그 외 v2와 같음. 보관 90일.

#### usage_events
- `feature` CHECK에 **`writing_chat`** 추가 → `insight`, `draft`, `interview_session`, `writing_chat`, `chat_message`.
- `reason` 값 유지(`initial`, `explicit_regenerate`, `source_change_regenerate`, `retake`).

**차감 규칙 (D-17 v3)**

| 작업 | feature / units | 예약 → 확정 | 비고 |
|------|-----------------|-------------|------|
| 요건 추출, AI-11, 글자 수 보정, 채점, 남은 질문 재생성, 보드 이동, F-ST-04 팝업, 대화 저장·폼 전환 | 기록 없음 | — | 무차감 |
| 인사이트 | `insight` / 1 | 시작 → 성공 | |
| 경력기술서 / 자소서 문항 | `draft` / 1 (문항당) | 시작 → 성공 | |
| 면접 | `interview_session` / 1 | 시작 → 질문 생성 성공 | 재응시는 제출 시(`retake`) |
| **AI 작성 대화** | `writing_chat` / 1 | **첫 사용자 메시지 처리 시 예약 → 첫 턴 성공 시 확정**, `writing_chats.usage_event_id` 기록 | 같은 대화 이어 하기 무차감. 보강 대화도 1회 `[가정]`(PRD 확인 대기). 메시지 상한 40 |
| 커리어 채팅(Should) | `chat_message` / 1 | 응답 완료 | |

- 한도 도달: 새 대화(`writing_chats` insert + 첫 메시지)만 막고, `usage_event_id`가 있는 대화의 이어 하기는 허용(UX 가정 수용). 저장·폼 전환은 언제나 허용(PRD 6.4).
- `usage_limits`: `writing_chat` **10** (사용자 결정 U-8 확정, 2026-10-24. D-AI-10 해소).

### 2.10 Should·운영
- `chat_threads`/`chat_messages`(AI-09): v2와 같음. AI 작성 대화와 **별도 테이블**(용도: 지원 전략 대화 vs 커리어 데이터 생성 / 수명: 지원 프로젝트 vs 프로젝트 / 쓰기: 커리어 불변 vs 저장 경로 보유).
- `ai_suggestions`(AI-08, Should): `target_type`에 `project_detail` 추가(필드 단위 다듬기).
- `account_deletion_logs`: v2와 같음.

---

## 3. 쟁점 정리 (v3 확정안)

### 3.1 결과 소유 키 — v2와 같음 (`application_project_id`, D-19 (a) 전제)

### 3.2 성과 연결 (D-24 (b))
- 정량 성과는 **상세 내용의 결과(R)** 또는 **경력**에 정확히 하나 연결. 프로젝트 직속 성과는 없앤다(수치는 항상 에피소드 맥락을 가진다).
- 수치 가드(AI V-5)는 `achievements`의 구조화 값을 쓰고, `learnings`에만 있는 숫자는 사실로 인정하지 않는다(AI 규칙, 스키마 영향 없음).

### 3.3 AI 작성 대화의 "저장" 경로 (NFR-AI-05, DM-13)

| 동작 | AI 호출 | 실행 주체 | 쓰는 테이블 |
|------|---------|-----------|-------------|
| 대화 턴 (사용자 발화 → 응답 + 정리 패치) | 있음 | 사용자 메시지 insert = 사용자 세션 RPC / 응답·패치 = `app_ai_writer` | `writing_chat_messages`, `writing_chats.structured_draft` 등, `ai_jobs`, `usage_events` — **커리어 테이블 없음** |
| 미리보기 필드 직접 수정·`needs_review` 수락/거절 | 없음 | 사용자 세션 RPC `apply_structured_draft_patch` | `writing_chats.structured_draft` (`review = 'accepted'` 저장 → 이어 하기에도 유지) |
| 소속 확정 ([연결] / [아니요] / 직접 선택) | 없음 | 사용자 세션 RPC `set_writing_chat_affiliation(writing_chat_id, experience_id, education_id)` | `writing_chats.experience_id` / `education_id`, `structured_draft.affiliation_suggestion` 제거 |
| **저장** | 없음 | **사용자 세션 RPC `save_writing_chat(writing_chat_id)`** (security invoker → RLS 적용. v3.2: `accepted_review_paths` 인자 삭제 — 수락 상태는 `structured_draft`에서 읽음) | `projects`, `project_details`, `achievements`, `skills`, `project_skills` + `writing_chats.status = 'saved'`, `project_id`, `saved_at` |
| **폼으로 전환** (D-UX-11 (a)) | 없음 | 사용자 세션 RPC `hand_off_writing_chat(writing_chat_id)` | 같은 테이블에 정리 결과를 쓰고 `status`는 완료 판정대로(대부분 `draft`) + `writing_chats.status = 'handed_off'`, `project_id`. **`needs_review` 필드는 옮기지 않는다**(저장과 같은 규칙) |

- 근거: "저장"은 사용자가 확인 다이얼로그에서 확정하는 동작이고 모델 출력이 아니라 사용자가 검토한 `structured_draft`를 옮긴다. 그래서 AI 역할에 커리어 쓰기 권한을 주지 않고도 저장할 수 있다. AI 작업 코드 경로에는 커리어 쓰기 권한이 끝까지 없다.
- `save_writing_chat`·`hand_off_writing_chat` 공통 규칙(v3.2): `review in ('ok','accepted')`이고 값이 있는 필드만 쓴다. `needs_review` 필드는 쓰지 않는다(T-18). `augment_project`는 기존 행의 **빈 필드에만** 쓰고 새 상세 내용은 insert(`existing_detail_id` 지정분). 생성·수정한 행에 `source_writing_chat_id`. 완료 판정은 2.2절 규칙. 스킬은 `normalized_name`으로 기존 스킬에 연결. **소속 = `writing_chats.experience_id` / `education_id`**(T-19). 둘 다 null이면 독립 프로젝트. `augment_project`는 기존 프로젝트의 소속을 바꾸지 않는다.
- 저장 후 대화는 보관(D-27 (a)), 읽기 전용. 같은 프로젝트에 새 보강 대화는 새 `writing_chats` 행(1회 차감).

### 3.4 AI 작성 대화 보관 (D-27, PIPA)

- **확정 (사용자 결정 U-9, 2026-10-24)**: 프로젝트에 묶인 대화는 계속 보관하고 대화만 따로 삭제할 수 있다(D-27 (a)). 묶이지 않은 대화의 90일 자동 삭제는 `[가정]` 유지.

| 경우 | 처리 |
|------|------|
| 사용자가 "대화만 삭제" | `writing_chats` 행 삭제 → 메시지 연쇄 삭제, 커리어 행의 `source_writing_chat_id`는 null. 저장한 커리어 데이터는 그대로 |
| 프로젝트 삭제 | `writing_chats.project_id` FK cascade로 그 프로젝트의 대화 삭제 |
| 저장 전 대화(`project_id` null)로 남은 경우 | `active`·`abandoned` 상태로 **마지막 활동 후 90일이 지나면 자동 삭제** `[가정]` (D-DM-08, 사용자 결정 U-9에서 `[가정]` 유지). 사용자에게 S-08 "작성 중인 AI 대화"에서 남은 기간 안내 |
| 탈퇴 | DM-1 연쇄 |
| 로그 | 대화 원문은 로그·`ai_jobs`에 남기지 않는다(NFR-PRV-09) |
| 국외 이전 | 대화 내용은 LLM 처리 대상(NFR-PRV-03 v3 고지) |

- D-27 (b)(저장 후 30일 자동 삭제)로 바뀌면 `saved_at + 30일` 배치 삭제만 추가하면 된다.

### 3.5 이름 충돌 확정 (UX v4 vs AI v3)

| 대상 | UX v4 | AI v3 | 확정 | 근거 |
|------|-------|-------|------|------|
| 교육 구분 | `education_type` | `education_kind` | `education_type` | `employment_type`과 같은 패턴 |
| 교육 상태 | `enrollment_status` | `education_status` | `enrollment_status` | `status`(draft/complete)와 혼동 방지 |
| 정리 결과 | `structured_draft` | `draft_result` | `structured_draft` | PRD 용어집 "정리 결과 / Structured Draft" |
| 대화 대상 프로젝트 | `project_id` | `target_project_id` | `project_id` | FK 명명 규칙(`{table}_id`). cascade 대상임이 이름에서 보인다 |
| 대화 소속 | `target_experience_id` / `target_education_id` | `affiliation_type` / `affiliation_id` | `experience_id` / `education_id` | 다형 참조 대신 실제 FK(set null), `projects`와 같은 모양 |
| 대화 모드 | `new_project` / `enrich_project` | `new_project` / `augment_project` | `augment_project` | AI 동작 정의(빈 필드만 채움)를 따름 |
| 대화 상태 | active / saved / abandoned | active / saved / handed_off / closed | active / saved / **handed_off** / **abandoned** | 폼 전환은 별도 상태가 필요(AI), "그만둠"은 면접 세션과 같은 말(UX) |
| 대화 활동 시각 | `last_message_at` | `last_activity_at` | `last_activity_at` | 다른 테이블과 같은 이름 |
| 메시지 순서 | `sequence` | `seq` | `sequence` | `interview_questions.sequence`와 같음 |
| 근거 선택 상세 내용 | — | `detail_ids` | `project_detail_ids` | 테이블명과 일치 |
| 소속 일괄 처리 파라미터 | `experience_mode`(일반화 질문) | — | `affiliation_mode` | 경력·교육 공통 |

---

## 4. 삭제·보유 정책

### 4.1 개별 삭제 (v3)

| 삭제 대상 | 함께 삭제 (cascade) | 유지 / set null | 근거 처리 |
|-----------|---------------------|-----------------|-----------|
| 경력 | 경력 단위 성과. `affiliation_mode = 'delete_projects'`면 소속 프로젝트(→ 상세 내용 → 정량 성과, 태그, 대화) | 기본: 소속 프로젝트 독립으로 남김. `writing_chats.experience_id` set null | 트리거 |
| **교육** | `affiliation_mode = 'delete_projects'`면 소속 프로젝트(하위 전체) | 기본: 독립으로 남김. `writing_chats.education_id` set null | 트리거 |
| 프로젝트 | **상세 내용 → 그 정량 성과**, `project_skills`(고아 태그 스킬 정리), **그 프로젝트의 `writing_chats` → 메시지** | | 트리거 |
| **상세 내용** | 그 정량 성과 | 부모 프로젝트 `status` 재계산(마지막 complete 상세 내용이면 프로젝트가 `draft`로) | 트리거 |
| 성과 / 스킬 | v2와 같음 | | 트리거 |
| **AI 작성 대화** | 메시지 | 커리어 행의 `source_writing_chat_id` null | 없음(근거 원본 아님) |
| 지원 프로젝트 | v2 목록 + **`application_stage_events`** | `usage_events` | owner와 함께 |

### 4.2 커리어 항목 삭제의 지원 프로젝트 영향 (F-COM-04, D-UX-08 (a) 기본)

- **`get_deletion_impact(entity_type, entity_id, affiliation_mode)`**
  - `entity_type`: `experience`, `education`, `project`, `project_detail`, `achievement`, `skill`, `writing_chat`.
  - 반환: `cascade`(하위 종류별 개수: projects, project_details, achievements, project_skills, writing_chats), `affected_results.by_application_project[]`(v2 형식: 이름, insights, drafts, draft_sections, interview_sessions), `writing_chat`이면 `{ message_count, linked_saved_rows }`만(결과 영향 없음).
  - 집계 대상: 삭제될 행 전체(연쇄분 포함)를 가리키는 `evidence_links`(`source_type` in experience/education/project/project_detail/achievement/skill) + `draft_section_sources`(experience_id/education_id/project_id/project_detail_ids).
- **`delete_career_item(entity_type, entity_id, affiliation_mode, result_mode)`**: v2와 같은 결과 단위(인사이트 버전 / 경력기술서 문서 / 자소서 문항 생성 결과 초기화 / 면접 세션). `writing_chat`은 `result_mode` 무시.
- 상세 내용 삭제가 프로젝트를 `draft`로 되돌리면, 그 프로젝트를 근거로 한 결과의 근거 칩은 "변경됨"이 된다(프로젝트 `updated_at` 갱신).

### 4.3 탈퇴 전 삭제 범위 집계 (UX 요청 9)
- **별도 함수 `get_account_deletion_summary()`**: 커리어(경력, 교육, 프로젝트, 상세 내용, 정량 성과, 스킬, AI 작성 대화) / 기업 JD(지원 프로젝트 수, 인사이트, 초안, 면접 세션, 전형 이력) 개수. `get_deletion_impact`와 반환 모양·목적(결과 영향 vs 전체 개수)이 달라 분리.

### 4.4 보유 기간

| 데이터 | 보유 |
|--------|------|
| 커리어(교육·상세 내용 포함), 지원 프로젝트·결과·전형 이력, 근거, 동의 이력 | 탈퇴 또는 개별 삭제까지 |
| AI 작성 대화 (저장·폼 전환된 것) | 프로젝트 삭제·대화 삭제·탈퇴까지 (D-27 (a), **U-9 확정**) |
| AI 작성 대화 (프로젝트와 연결 안 된 것) | 마지막 활동 후 90일 `[가정]` (D-DM-08) |
| `ai_jobs` | 90일 / `usage_events` 13개월 / `account_deletion_logs` 3년 비식별 / 백업 ≤ 30일 |

---

## 5. RLS·권한 방향

| 테이블 | select | insert | update | delete |
|--------|--------|--------|--------|--------|
| experiences / **educations** / projects / **project_details** / achievements / skills / project_skills | 본인 | 사용자 세션 | 사용자 세션 | 사용자 세션 (`delete_career_item` 권장) |
| **writing_chats** | 본인 | 사용자 세션 | `structured_draft`는 **RPC `apply_structured_draft_patch`만**(AI 턴 = `app_ai_writer`, 사용자 수정·수락 = 사용자 세션). 소속은 `set_writing_chat_affiliation`(사용자 세션). 사용자 세션 직접 update: `status`, `return_target`. `app_ai_writer` 직접 update: `message_count`, `last_activity_at` | 본인 |
| **writing_chat_messages** | 본인 | user = 사용자 세션 RPC, assistant = `app_ai_writer` | `app_ai_writer`(assistant `status`, `content`) | 연쇄만 |
| application_projects | 본인 | RPC | 본인(`name`, `deadline`, `memo`). **`stage`·`stage_outcome`·`stage_changed_at`은 RPC만** | 본인 |
| **application_stage_events** | 본인 | RPC만 | 없음 | 연쇄만 |
| 그 밖 | v2와 같음 | | | |

- **`app_ai_writer` 권한 (v3)**: 커리어 7개 테이블 select만. `writing_chats`(3개 컬럼), `writing_chat_messages`(assistant), 지원 프로젝트 결과 테이블, `evidence_links`, `ai_jobs`, `usage_events` 쓰기. `application_stage_events`·`application_projects.stage*` 쓰기 없음(보드는 AI와 무관).
- RPC 실행 주체: `save_writing_chat`, `hand_off_writing_chat`, `append_writing_chat_message`, `delete_career_item`은 security invoker(사용자 RLS). `move_application_stage`, `set_application_outcome`은 security definer + 소유 검사(이벤트 insert를 사용자에게 직접 열지 않기 위해).
- Storage: v2와 같음(MVP 버킷 없음).

---

## 6. 데이터 최소 기준 판정 — `get_data_readiness()` (v3)

```json
{
  "counts": {
    "complete_experiences": 1, "complete_educations": 1,
    "complete_projects": 0, "projects_without_complete_detail": 1,
    "complete_project_details": 0, "draft_project_details": 1,
    "draft_experiences": 0, "draft_educations": 0, "draft_projects": 1,
    "profile_filled": true
  },
  "draft_item_ids": { "experiences": [], "educations": [], "projects": ["uuid"], "project_details": ["uuid"] },
  "features": {
    "insight":       { "ready": false, "missing": ["complete_project"], "hints": ["complete_project_detail"], "next_action": "writing_chat", "suggested_mode": "augment_project", "suggested_project_id": "uuid" },
    "draft":         { "ready": false, "missing": ["complete_project"], "hints": ["complete_project_detail"], "next_action": "writing_chat", "suggested_mode": "augment_project", "suggested_project_id": "uuid" },
    "job_interview": { "ready": false, "missing": ["complete_project"], "hints": ["complete_project_detail"], "next_action": "writing_chat", "suggested_mode": "augment_project", "suggested_project_id": "uuid" },
    "culture_fit_interview": { "ready": true, "data_sufficiency": "thin" }
  }
}
```

- `next_action` / `suggested_mode` / `suggested_project_id`는 `ready = false`일 때만 온다. `next_action` ∈ `writing_chat` / `form`, `suggested_mode` ∈ `new_project` / `augment_project`, `suggested_project_id`는 `augment_project`일 때만(완료 상세 내용이 없는 프로젝트). `ready = true`면 세 키 모두 생략.
- **기능 키 매핑 (readiness ↔ `writing_chats.return_target.feature`)**: 키 이름은 바꾸지 않고 매핑으로 둔다. 서류는 두 종류가 같은 기준(D-01)이라 readiness는 `draft` 하나로 판정하고, 복귀는 어느 화면으로 갈지 알아야 하므로 세분한다.

  | readiness `features` 키 | `return_target.feature` |
  |--------------------------|--------------------------|
  | `insight` | `insight` |
  | `draft` | `career_description` 또는 `cover_letter` (시작한 화면 기준) |
  | `job_interview` | `job_interview` |
  | `culture_fit_interview` | (복귀 없음 — 게이트 없음) |
- **D-01 v3**: `complete_experiences ≥ 1` **그리고** `complete_projects ≥ 1`. complete 프로젝트 = 이름·역할 + complete 상세 내용 ≥ 1, 팩 포함 규칙(부모가 draft면 제외) 적용. 소속은 경력·교육·없음 모두 센다. **교육만 있고 경력이 없으면 미충족**(`missing: ["complete_experience"]`).
- `missing` 값: `complete_experience`, `complete_project`. `hints` 값: `complete_project_detail`(완료 상세 내용이 없어 프로젝트가 미완료인 경우 — 화면 문구용), `profile`(참고).
- `data_sufficiency` (AI C-1 v3 정의): `ok` = D-01 충족 / `thin` = 미충족이지만 프로필 또는 complete 경력·교육·상세 내용 존재 / `none` = 없음.
- `draft_item_ids`에 **상세 내용 ID 포함**(UX 요청 8 회신).
- 같은 판정을 AI Route Handler가 다시 확인(v2와 같음). AI-12·AI-08은 판정 대상 아님.
- **데이터 부족 → AI 작성 대화 → 복귀 (사용자 결정 U-5, 2026-10-24)**:
  1. 기능(인사이트·경력기술서·자소서·직무 면접)에서 `ready = false`이면 화면은 단순 차단 대신 **"AI와 대화하며 채우기"**로 이끈다. `features.{feature}`에 `next_action: "writing_chat"`과 `suggested_mode`(`new_project` — 완료 프로젝트가 없을 때 / `augment_project` + `suggested_project_id` — 프로젝트는 있으나 complete 상세 내용이 없을 때)를 함께 돌려준다. `missing`에 `complete_experience`가 있으면 경력은 폼 입력이 필요하므로 `next_action: "form"`(F-P1-16 경력 대화 작성은 Could).
  2. 대화 시작 시 `writing_chats.return_target`에 `{application_project_id, feature, params}`를 저장한다(v3.2 신설 컬럼). **DB에 두는 이유**: 대화는 여러 번에 나눠 이어 할 수 있어(F-P1-06) 브라우저 세션만으로는 복귀 대상이 사라진다. 일반 폼 경유 복귀(C-10)는 기존처럼 브라우저 저장.
  3. 저장(`save_writing_chat`)·폼 전환 후 화면이 `get_data_readiness()`를 다시 불러 `ready = true`면 `return_target`으로 돌아가고 컬럼을 비운다. 아직 미달이면 C-10 배너에 남은 항목을 보여 준다.
  4. AI 결과는 여전히 complete 데이터가 있어야 생성된다(게이트 기준 D-01 v3는 그대로). 정리 결과(`structured_draft`)는 저장 전에는 기준에 세지 않는다.
  5. 컬처핏 면접 예외(데이터 없이 허용)는 `[가정]` 유지(U-5 리더 해석).

---

## 6.1 기능 ↔ 테이블·RPC 매트릭스 (PRD v3 5.1 Must 전체, R-26)

> R = 읽기, W = 쓰기. 저장 데이터가 없는 기능은 "없음(보기)". 커리어 테이블 쓰기는 모두 사용자 세션, AI 결과 쓰기는 `app_ai_writer`(5장).

| 기능 ID | 테이블 (R / W) | RPC·함수 |
|---------|----------------|----------|
| F-P1-01 기본 프로필 | R/W `profiles` | — |
| F-P1-02 경력 | R/W `experiences` | `delete_career_item` |
| F-P1-03 프로젝트 | R/W `projects`(+`education_id`, `summary`) | `delete_career_item` |
| F-P1-04 정량 성과 | R/W `achievements`(`project_detail_id` / `experience_id`) | `delete_career_item` |
| F-P1-05 스킬 | R/W `skills`, `project_skills` | — |
| F-P1-06 자동 저장·이어하기 | W 커리어 5개 테이블 `status = 'draft'`, R `writing_chats`(active) | — (트리거: 상태 재계산, `career_data_updated_at`) |
| F-P1-09 연도 계층 보기 | R `experiences`, `educations`, `projects`, `project_details`, `achievements`, `skills` | 없음(앱에서 연도 계산, 2.4) |
| F-P1-13 AI 작성 대화 | W `writing_chats`(+`return_target`), `writing_chat_messages`, `ai_jobs`(`writing_chat_turn`), `usage_events`(`writing_chat`); 저장 시 W `projects`, `project_details`, `achievements`, `skills`, `project_skills` | `append_writing_chat_message`, `apply_structured_draft_patch`, `set_writing_chat_affiliation`, `save_writing_chat`, `hand_off_writing_chat` |
| F-P1-14 교육 | R/W `educations` | `delete_career_item`(`affiliation_mode`) |
| F-P1-15 상세 내용 (STAR + 배운 점) | R/W `project_details`, `achievements` | `delete_career_item` |
| F-AP-01 지원 프로젝트 만들기 | W `application_projects`(`stage = before_apply`), `job_descriptions`, `application_stage_events`(`created`); AI-01 W `jd_requirements`, `ai_jobs` | `create_application_project` |
| F-AP-02 목록 | R `application_projects`, `job_descriptions`, `insights`, `drafts`, `interview_sessions` | — |
| F-AP-03 허브 | R 위 + `profiles.career_data_updated_at`, `ai_jobs` | — |
| F-AP-05 삭제 | W `application_projects` delete(하위 전체 + `application_stage_events` 연쇄) | — |
| F-AP-06 데이터 부족 안내 → AI 작성 대화 → 복귀 (U-5) | R 커리어 테이블(집계); W `writing_chats.return_target` | `get_data_readiness`(`next_action`, `suggested_mode`) |
| F-ST-01 보드 | R `application_projects`(`stage`, `stage_outcome`, `stage_changed_at`, `deadline`), `job_descriptions`, `insights`, `drafts`, `interview_sessions` | — |
| F-ST-02 단계 이동 | W `application_projects`, `application_stage_events` | `move_application_stage` |
| F-ST-03 전형 결과 | W `application_projects.stage_outcome`, `application_stage_events` | `move_application_stage`(outcome 인자), `set_application_outcome` |
| F-ST-04 인터뷰 전형 팝업 | R `interview_sessions`(작성 중 세션) — 세션·사용량 쓰기 없음 | `move_application_stage` 반환값 `interview_prompt` |
| F-ST-05 전형 이력 기록 | W `application_stage_events` | `move_application_stage`, `set_application_outcome`, `create_application_project` |
| F-P2-01 JD 등록 | W `job_descriptions` | `create_application_project` |
| F-P2-02 요건 추출 확인 | R/W `job_descriptions`(`extraction*`), `jd_requirements`, `ai_jobs` | — |
| F-P2-04 인사이트 | R 커리어(팩), `jd_requirements`; W `insights`, `evidence_links`, `ai_jobs`, `usage_events` | `get_data_readiness` |
| F-P2-05 근거 확인 | R `evidence_links` + 원본 테이블 | — |
| F-P2-09 보완점 → 커리어 | R `insights`; 이동 후 W 커리어 테이블 또는 `writing_chats` | — |
| F-DOC-01 경력기술서 | R 커리어(팩), `jd_requirements`, `insights`; W `drafts`, `draft_sections`, `evidence_links`, `ai_jobs`(+`draft_source_ranking` `output`), `usage_events` | `get_data_readiness` |
| F-DOC-02 자소서 문항·초안 | W `drafts`(composing, 기본 3문항 시드), `draft_sections`, `evidence_links`, `ai_jobs`, `usage_events` | — |
| F-DOC-03 근거·자리 표시 | R `draft_sections`(블록 `placeholders`, `flags`), `evidence_links` | — |
| F-DOC-04 편집·복사 | W `draft_sections.edited_content`, `drafts.edited_at`, `first_copied_at` | — |
| F-DOC-08 사용한 경력·프로젝트 | R/W `draft_section_sources`, `draft_sections`(`source_selection_mode`, `sources_modified_at`, `generation_no`) | — |
| F-DOC-09 문항 메모 | R/W `draft_sections.user_note` | — |
| F-P3-01 면접 준비 | R `interview_sessions`, `get_data_readiness`; W `interview_sessions`, `usage_events` | `get_data_readiness` |
| F-P3-02 질문 일괄 생성 | W `interview_questions`, `interview_answers`(빈 행), `evidence_links`, `ai_jobs` | — |
| F-P3-03 답변 작성·일괄 제출 | W `interview_answers.answer_text`, `interview_sessions` | `submit_interview_session` |
| F-P3-04 이어 쓰기 | R `interview_sessions`, `interview_questions`(공개 컬럼), `interview_answers` | — |
| F-P3-06 점수·평가 | W `answer_evaluations`, `session_feedbacks`, `evidence_links`, 점수 슬롯(`interview_answers.score_*`, `interview_sessions.score_*`), `ai_jobs` | — |
| F-P3-07 세션 기록 | R 위 테이블; W `interview_sessions.result_viewed_at` | — |
| F-P3-13 컬처핏 데이터 부족 허용 | R `interview_sessions.data_sufficiency` | `get_data_readiness`(`culture_fit_interview`) |
| F-P3-15 모의 면접 메뉴 | R `interview_sessions` + `application_projects.name` (필터 `application_project_id`, `interview_type`, `status`) | — |
| F-COM-01 가입·로그인 | W `auth.users`, `profiles`(가입 트리거) | — |
| F-COM-02 동의 | R `policy_versions`; W `consents` | — |
| F-COM-03 AI 학습 미사용 고지 | R `policy_versions` | 없음(보기) |
| F-COM-04 개별 삭제 | 커리어 테이블, `evidence_links`, `draft_section_sources`, 결과 테이블, `writing_chats` | `get_deletion_impact`, `delete_career_item` |
| F-COM-05 탈퇴 | W `auth.users` delete(전체 연쇄), `account_deletion_logs` | `get_account_deletion_summary` |
| F-COM-10 왼쪽 메뉴 | 없음(보기) | — |

- 확인: Must 기능 중 대응 테이블·RPC가 없는 것은 F-COM-03, F-COM-10뿐이며 둘 다 저장 데이터가 필요 없다.

## 7. API 경계 초안 (v3 변경분)

| 작업 | 방식 | 읽기/쓰기 | 화면 |
|------|------|-----------|------|
| 커리어 계층 조회(연도 묶음) | Server Component (앱에서 연도 계산) | R: experiences, educations, projects, project_details, achievements, skills, writing_chats(active) | S-08 |
| 교육·상세 내용 자동 저장 | Server Action (status 재계산, 상세 내용은 부모 프로젝트 재계산 트리거) | W: educations, project_details, achievements | S-34, S-35, S-11 |
| 상세 내용 순서 변경 | Server Action | W: project_details.sort_order | S-10 |
| **AI 작성 대화 시작** | Server Action (사용자 세션): `writing_chats` insert(데이터 부족 게이트에서 왔으면 `return_target` 포함) + 고정 시작 인사 assistant 메시지(AI 없음). 한도 확인만, 차감은 첫 턴 | W: writing_chats, writing_chat_messages | S-36, C-09 |
| 소속 확정 | Server Action → RPC `set_writing_chat_affiliation` | W: writing_chats | S-36 |
| 미리보기 수정·검토 수락/거절 | Server Action → RPC `apply_structured_draft_patch` (사용자 세션) | W: writing_chats.structured_draft | S-36 |
| **대화 턴** | Route Handler `POST /api/writing-chats/{id}/turns` (SSE: `reply_delta` → `reply_done` → `draft_patch` → `draft_flags` → `turn_done`). ① 사용자 세션 RPC `append_writing_chat_message`(상한 검사) ② 첫 턴이면 `usage_events` 예약 ③ `app_ai_writer`로 extract·reply 병렬 실행, V-9 검증 후 `apply_structured_draft_patch` ④ 성공 시 확정 | W: writing_chat_messages, writing_chats, ai_jobs(`writing_chat_turn`), usage_events | S-36 |
| 미리보기 필드 수정·검토 수락 | Server Action (`origin = 'user_edit'`) | W: writing_chats.structured_draft | S-36 |
| **저장** | Server Action → RPC `save_writing_chat(writing_chat_id)` (사용자 세션, 수락 상태는 `structured_draft`에서 읽음) | W: projects, project_details, achievements, skills, project_skills, writing_chats | S-36 → S-10 |
| **폼으로 전환** | Server Action → RPC `hand_off_writing_chat` (사용자 세션) | 같음 | S-36 → S-10/S-35 |
| 대화 그만두기 / 대화만 삭제 | Server Action | W: writing_chats | S-08, S-10, S-36 |
| 데이터 최소 기준 | RPC `get_data_readiness` | | C-09, C-10 |
| 커리어 삭제 영향 / 삭제 | RPC `get_deletion_impact` / `delete_career_item` (`affiliation_mode`, `result_mode`) | | C-05 |
| **보드 조회** | Server Component | R: application_projects(stage, stage_outcome, stage_changed_at, deadline), job_descriptions, insights(유무), drafts(수), interview_sessions(수·작성 중) | S-39 |
| **단계 이동** | Server Action → RPC `move_application_stage` (낙관적 반영, 실패 시 원위치) | W: application_projects, application_stage_events | S-39, S-13, S-31 (C-12, C-14) |
| **결과 기록** | Server Action → RPC `set_application_outcome` | 같음 | C-13 |
| 전형 이력 (Should) | Server Component | R: application_stage_events | S-38 |
| 모의 면접 전체 세션 | Server Component | R: interview_sessions(+ application_projects.name), 필터 `application_project_id`, `interview_type`, `status` | S-37 |
| 탈퇴 범위 | RPC `get_account_deletion_summary` | | S-25 |
| 정기 배치 (추가) | Vercel Cron: 연결 안 된 AI 작성 대화 90일 정리 | writing_chats | — |
| 그 밖 | v2와 같음 | | |

---

## 8. 결정 필요

| ID | 질문 | 권고 | 담당 / 상태 |
|----|------|------|-------------|
| D-DM-08 | 프로젝트와 연결되지 않은 AI 작성 대화의 보관 | 마지막 활동 후 90일 자동 삭제 | **`[가정]` 유지** (사용자 결정 U-9) |
| D-27 | 대화 기록 보관 | (a) 프로젝트에 묶어 보관, 대화만 삭제 가능 | **확정** (U-9) |
| D-UX-11 | 폼으로 전환 시 draft 저장 | (a) — `hand_off_writing_chat`, 미수락 `needs_review` 제외(T-18) | **확정** (T-6) |
| D-UX-12 | 종료에서 나갈 때 결과 삭제 | (a) — 이전 결과는 `application_stage_events.from_outcome`에 남음 | **확정** (T-7) |
| 보강 대화 차감 | 기존 프로젝트 보강 대화도 1회 | 대화 행마다 `usage_event_id` | **확정** (T-10). 월 한도 `writing_chat` **10** (U-8 확정) |
| 연도 미정 묶음 | 소속·기간 모두 없는 프로젝트 | 스키마 영향 없음(앱 계산) | **확정** (T-2) |
| `message_count` 상한 CHECK | 40 `[가정]`을 CHECK로 박을지 | 상한이 확정되면 CHECK, 그전엔 RPC `append_writing_chat_message` 검사만(2.5와 같음) | 구현 단계 (T-10) |
| D-14, D-16 | 점수 산식·미응답 반영 | 스키마는 점수 슬롯만(산식 없음). D-16 (b) `[가정]` 유지 | **사용자 정의 대기** (U-1) |
| D-25 | 전형 결과 종류 | `stage_outcome` = `passed` / `failed` | **확정** (U-3) |
| 사용자 결정 일괄 (2026-10-24) | U-2 "회고 및 배운 점"(표시명, 컬럼 `learnings` 유지) / U-4 메뉴 4개 / U-5 데이터 부족 → AI 작성 대화 → 복귀(6장) / U-6 JD 필수·교체 불가(D-19, DM-12 전제 확정) / U-7 면접 유형 `job`·`culture_fit` / U-8 대화 한도 10 / U-9 묶인 대화 계속 보관 / U-10 D-02·04·05·06·09·10·11·17·18 확정 | **확정** |
| 해소 | D-DM-06 (a), D-DM-07 무차감, D-AI-05 (STAR로 해소), D-AI-07~09 | PRD v3 9.2 | — |

### 8.1 리뷰 통합 결정 목록 중 데이터 모델 소관 회신 (v3.1, v3.2 갱신)

| 리뷰 # | 질문 | 데이터 모델 답 |
|--------|------|----------------|
| **T-18** (v3.2) | 검토 필요 필드 수락 상태 저장과 저장·전환 규칙 | `structured_draft` 필드 `review = 'accepted'`(+ `reviewed_at`)로 저장, 거절은 값 비움. 저장·전환 모두 `needs_review`는 쓰지 않음. `save_writing_chat`의 `accepted_review_paths` 인자 삭제 (2.5, 3.3) |
| **T-19** (v3.2) | 확정 소속의 위치 | `writing_chats.experience_id` / `education_id` 단일 원천, `structured_draft.project`에서 소속 키 제거, RPC `set_writing_chat_affiliation` (2.5, 3.3) |


| 리뷰 # | 질문 | 데이터 모델 답 |
|--------|------|----------------|
| T-6 | 폼으로 전환 시 draft 저장 | **(a)로 확정(데이터 측)**. `hand_off_writing_chat`이 사용자 확인 후 커리어 테이블에 쓰고(완료 판정대로, 대부분 `draft`), `writing_chats.status = 'handed_off'`, `project_id`를 채운다. 이 RPC는 v3부터 정의돼 있어 추가 변경 없음 |
| T-7 | 종료에서 다른 열로 옮길 때 결과 | **(a)로 확정(데이터 측)**. `move_application_stage`가 `stage_outcome = null`로 만들고 이전 값은 `application_stage_events.from_outcome`에 남는다 |
| T-10 (CHECK 시점) | `message_count` 상한을 언제 CHECK로 둘까 | **상한 확정 후 CHECK.** 그전엔 RPC 검사만(2.5, R-25). 나머지 사용량 세부(첫 턴 성공 시 차감, 보강 대화 1회, 40 = 합계, 한도 도달 시 이어 하기·저장·전환 허용)는 2.9 규칙표와 같다 — product-planner가 PRD 6.4 문구만 맞추면 된다 |
| T-16 | 완료 조건·D-01 v3 | **데이터 측 정의 확정**: 상세 내용 = `title` + `situation` + `action`, 프로젝트 = `name` + `role` + complete 상세 내용 ≥ 1(트리거), D-01 = complete 경력 ≥ 1 + complete 프로젝트 ≥ 1, 교육만으론 미충족(2.2, 6장). PRD `[가정]` 태그 해제는 product-planner |
| T-17 | 민감정보로 걸러진 발화의 원문 | **(a) 원문 보관을 데이터 측 권고로 확정**. `writing_chat_messages.content`는 사용자가 쓴 그대로 보관하고(가림 처리 컬럼·작업 없음), `structured_draft`에는 옮기지 않는다(개수만). 사용자는 대화만 따로 삭제할 수 있다(3.4). (b)로 바뀌면 `content` 마스킹 작업 + `redacted_at` 컬럼이 필요 |
| T-2 | 연도 미정 묶음 | 스키마 영향 없음(앱 계산, 2.4). 권고 (b) + "연도 미정"을 그대로 구현 가능 |
| T-9 | 답변란 여는 시점 / 점수 준비 중 표시 | 이미 반영: 답변 update RLS가 `generation_status = 'ready'`를 요구(A.13), 점수 슬롯 `score_status = 'pending_method'`(A.12) |

- U-9 확정(묶인 대화 계속 보관), D-DM-08(미연결 대화 90일)은 `[가정]` 유지.
- R-13 확정에 따라 머리글 표기를 고쳤다(v3.2).

---

## 9. 테이블 목록 (v3)

- MVP 사용자 테이블 **27**: profiles, consents, experiences, **educations**, projects, **project_details**, achievements, skills, project_skills, **writing_chats**, **writing_chat_messages**, application_projects, **application_stage_events**, job_descriptions, jd_requirements, insights, drafts, draft_sections, draft_section_sources, interview_sessions, interview_questions, interview_answers, answer_evaluations, session_feedbacks, evidence_links, ai_jobs, usage_events
- Should 4: chat_threads, chat_messages, result_ratings, ai_suggestions
- 참조·운영 3: policy_versions, usage_limits, account_deletion_logs
- 보류: resume_files

---

## 10. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|-----------|
| v1 | 2026-10-23 | 최초 작성. PRD v1·UX v1·AI v1 통합 |
| v2 | 2026-10-23 | PRD v2·UX v3·AI v2. `application_projects`(JD 1:1), 결과 소유 키 `application_project_id`, `draft_section_sources`, 면접 일괄 방식·점수 슬롯, D-17 사용량, `app_ai_writer` |
| v3 | 2026-10-23 | **PRD v3·UX v4·AI v3.** (1) **`educations` 신설**, `projects.education_id` + 소속 최대 1 CHECK, `projects.summary`, `contribution`·`team_context` 삭제. (2) **`project_details` 신설**(STAR + `learnings`, 여러 개), 프로젝트 완료 = complete 상세 내용 ≥ 1(트리거 재계산). (3) **`achievements.project_detail_id`**가 `project_id` 대체(D-24 (b)). (4) 연도 보기는 저장하지 않음(앱 계산, 기존 `start_month` 인덱스). (5) **`writing_chats` / `writing_chat_messages` 신설**, `structured_draft`(필드별 출처 메시지), 저장·폼 전환은 사용자 세션 RPC(`app_ai_writer`는 커리어 쓰기 없음 유지), `source_writing_chat_id`(projects, project_details, achievements), 대화만 삭제·프로젝트 연쇄·미연결 대화 90일(D-DM-08). (6) **지원 현황**: `application_projects.stage`·`stage_outcome`·`stage_changed_at`, `application_status` 삭제, **`application_stage_events` 신설**, `move_application_stage`·`set_application_outcome` RPC. (7) 사용량 `writing_chat`, `ai_jobs.job_type` `writing_chat_turn`. (8) 근거 `source_type` `education`·`project_detail`, STAR `source_field`. (9) `draft_sections.section_kind` `education`, `draft_section_sources.education_id`·`project_detail_ids`. (10) `get_data_readiness` v3, `get_deletion_impact`·`delete_career_item` 대상 확장(`affiliation_mode`로 일반화), `get_account_deletion_summary` 신설 |
| v3.1 | 2026-10-23 | 리뷰 라운드 1 반영. R-25: `writing_chats.message_count` 제약을 "RPC `append_writing_chat_message` 검사, 상한 확정 시 CHECK"로 통일(2.5·8장). R-26: 6.1절 기능 ↔ 테이블·RPC 매트릭스 신설(PRD v3 5.1 Must 전체). 2.5 `structured_draft.project` 필드 키 = 컬럼명·값 형식 명확화(R-02 지원, 이름 변경 없음). 8.1절 팀 해결 결정 회신(T-6, T-7, T-10, T-16, T-17, T-2, T-9). **이름 변경 없음** |
| v3.2 | 2026-10-24 | 리뷰 라운드 2 + 사용자 결정 반영. **R-27/T-18**: `structured_draft` 필드 `review`에 `accepted` 추가 + `reviewed_at`, 거절 = 값 비움, 저장·폼 전환 모두 미수락 `needs_review` 제외, `save_writing_chat`의 `accepted_review_paths` 인자 삭제. **R-28/T-19**: 확정 소속 = `writing_chats.experience_id`/`education_id`만, `structured_draft.project`에서 소속 키 제거, RPC `set_writing_chat_affiliation` 신설. **R-29**: `apply_structured_draft_patch` 호출 주체(AI 턴 = `app_ai_writer`, 사용자 = 사용자 세션)·규칙(`user_edit`·`accepted` 비덮어쓰기, V-9h 기존 값 보호), `structured_draft` 직접 update 금지. **R-13**: 머리글 표기(지원 프로젝트 / 기업 JD 관리 / 기업 JD / 공고 원문). **U-2** `learnings` 표시명 "회고 및 배운 점". **U-5** `writing_chats.return_target` 신설, `get_data_readiness`에 `next_action`·`suggested_mode`. **U-8** `usage_limits.writing_chat` = 10. **U-9** D-27 (a) 확정, D-DM-08 `[가정]` 유지. 확정 결정 표시(8장) |
| v3.2a | 2026-10-24 | 확인 패스 R-35: `get_data_readiness` 예시에 `next_action`·`suggested_mode`·`suggested_project_id` 추가, readiness 키 `draft` ↔ `return_target.feature`(`career_description`/`cover_letter`) 매핑 표, 머리글 기준 입력 버전(PRD v3.2, UX v4.2, AI v3.2), 2.8 "(본인 회고 표시)" 삭제. **이름 변경 없음** |

---

## 부록 A. v2에서 바뀌지 않은 테이블의 전체 정의

> 본문에서 "v2와 같음"으로 줄인 테이블의 컬럼 정의다. v3 변경분(본문 2장)은 여기에 이미 반영했다. 공통 컬럼(`id`, `user_id`, `created_at`, `updated_at`)과 AI 출력 공통 메타는 생략.

### A.1 profiles
| 컬럼 | 타입 | 제약 / 설명 |
|------|------|-------------|
| `id` | uuid | PK, FK `auth.users(id) on delete cascade` (`user_id` 없음) |
| `display_name` | text | null, ≤ 50자, AI에 보내지 않음 |
| `desired_job_title` | text | null, ≤ 100자 |
| `total_years_of_experience` | smallint | null, 0..50 |
| `interested_industries` | text[] | not null default `'{}'` |
| `career_data_updated_at` | timestamptz | 커리어 7개 테이블 변경 시 트리거 갱신 |
| `last_active_at`, `inactivity_notice_sent_at` | timestamptz | 장기 미접속(D-11) |
- RLS: select/update 본인, insert 가입 트리거, delete 없음.

### A.2 consents / policy_versions
| 테이블 | 컬럼 |
|--------|------|
| consents | `consent_type` CHECK in (`terms`, `privacy_required`, `cross_border_transfer`, `service_improvement`, `marketing`), `policy_version`, `agreed` boolean, `agreed_at`, `withdrawn_at`, `user_agent_hash`. 동의 1회 = 1행, 철회는 `withdrawn_at`, 재동의는 새 행. RLS select/insert 본인, update는 선택 동의의 `withdrawn_at`만 |
| policy_versions | `policy_type`(terms/privacy/cross_border_transfer), `version`, `effective_at`, `requires_reconsent`, `document_path`. 비사용자, 전체 select |

### A.3 experiences
`status`, `company_name`(complete 필수), `start_month`(complete 필수, 1일 고정), `end_month`(≥ start), `is_current`(true면 end_month null), `job_rank`, `job_position`(둘 중 하나 complete 필수), `department`, `employment_type` CHECK in (`full_time`, `contract`, `freelance`, `intern`, `other`), `summary`(≤ 2,000자). `unique (id, user_id)`.

### A.4 skills / project_skills
| 테이블 | 컬럼 |
|--------|------|
| skills | `name`(≤ 50자), `normalized_name`(`unique (user_id, normalized_name)`), `is_manual` boolean, `proficiency` CHECK in (`basic`, `practical`, `expert`) Could. `status` 없음. 고아 태그 스킬(`is_manual = false`, 연결 0) 자동 삭제 |
| project_skills | PK `(project_id, skill_id)`, `user_id`, `created_at`. 양쪽 복합 FK cascade |

### A.5 application_projects (v3 반영 전체)
`name`(≤ 100자, null = 추출 대기), `name_source` CHECK in (`user`, `ai`, `default`), `deadline` date, `memo`(≤ 2,000자, Should), `stage`, `stage_outcome`, `stage_changed_at`(본문 2.6), `last_activity_at`, `duplicated_from_id`(FK set null, Could). `unique (id, user_id)`. insert는 RPC `create_application_project`.

### A.6 job_descriptions
`application_project_id`(unique, 복합 FK cascade, 변경 불가), `raw_text`(1~50,000자, 변경 불가), `raw_text_hash`, `sentences` jsonb `[{sid, text, start, end}]`, `detected_language`, `company_name`, `company_name_source`(user/ai), `position_title`, `position_title_source`(user/ai), `extraction_status` CHECK in (`pending`, `running`, `succeeded`, `failed`), `extraction` jsonb, `extraction_job_id`, `tech_keywords` jsonb `[{keyword, source_sids}]`, `requirements_hash`. delete 정책 없음(지원 프로젝트 연쇄만).

### A.7 jd_requirements
`job_description_id`(복합 FK cascade), `category` CHECK in (`responsibility`, `required`, `preferred`), `content`, `keywords` text[], `importance` CHECK in (`high`, `normal`), `source_sids` text[], `sort_order`, `origin` CHECK in (`ai`, `user`), `is_user_edited`.

### A.8 insights
`application_project_id`(복합 FK cascade), `version_no`(`unique (application_project_id, version_no)`), `is_latest`(ready 행만), `status` CHECK in (`generating`, `ready`, `failed`), `result` jsonb(evidence 제거, `item_key`), `match_stage_result` jsonb, `requirements_hash`, `completed_at` + AI 메타. 인덱스 `unique (application_project_id) where is_latest`, `(user_id, application_project_id, input_hash) where status = 'ready'`.

### A.9 drafts
`application_project_id`, `insight_id`(FK set null), `draft_type` CHECK in (`career_description`, `cover_letter`), `title`, `status` CHECK in (`composing`, `generating`, `ready`, `partially_failed`, `failed`), `options` jsonb(`included_experience_ids`, `included_education_ids`, `included_project_ids`, `project_order`, `selection_origin` in insight/ai_ranking/user, `ranking`, `tone`), `edited_at`, `first_copied_at`, `regenerated_from_id`(FK set null) + AI 메타.

### A.10 draft_sections (v3 반영 전체)
`draft_id`(cascade), `sort_order`(unique per draft), `section_kind` CHECK in (`experience`, `education`, `standalone_projects`, `cover_letter_question`), `experience_id`(soft), `education_id`(soft), `heading`, `question_text`, `template_key` CHECK in (`motivation`, `job_competency`, `future_plan`), `char_limit`, `count_basis` CHECK in (`with_spaces`, `without_spaces`), `user_note`(≤ 300자), `source_selection_mode` CHECK in (`ai`, `user`), `sources_modified_at`, `generation_no`, `question_class` CHECK in (`motivation`, `job_competency`, `future_plan`, `experience_story`), `status` CHECK in (`pending`, `generating`, `ready`, `failed`), `ai_content` jsonb(블록: `block_id`, `block_kind` in header/summary/role_line/bullet/paragraph, `project_id`, `text`, `requirement_ids`, `placeholders`, `flags`, `generated_by`, `user_modified`), `edited_content` jsonb, `ai_char_count`, `correction_applied`, `validation_report`. 자소서 생성 시 기본 3문항 시드.

### A.11 draft_section_sources (v3 반영 전체)
`draft_section_id`(cascade), `application_project_id`(cascade), `experience_id`(soft), `education_id`(soft), `project_id`(soft), `project_detail_ids` uuid[], `role` CHECK in (`primary`, `supporting`), `origin` CHECK in (`ai`, `user`), `rationale`(≤ 300자), `reuse_reason`, `requirement_ids` uuid[], `sort_order`, `source_label`, `source_deleted_at`. CHECK `num_nonnulls(experience_id, education_id, project_id) >= 1`, `num_nonnulls(experience_id, education_id) <= 1`.

### A.12 interview_sessions
`application_project_id`, `insight_id`(set null), `source_session_id`(set null), `interview_type` not null 기본값 없음 CHECK in (`job`, `culture_fit`), `question_count` CHECK in (3, 5, 7) default 5, `data_sufficiency` CHECK in (`ok`, `thin`, `none`), `weak_requirement_ids` uuid[], `status` CHECK in (`in_progress`, `evaluating`, `completed`, `evaluation_failed`, `abandoned`), `generation_status` CHECK in (`generating`, `ready`, `failed`), `answered_count`, `unanswered_count`, `submitted_at`, `completed_at`, `result_viewed_at`, `abandoned_at`, `last_activity_at`, `career_snapshot_hash`, 점수 슬롯 `score_status`(pending_method/scored/not_scored), `score_value`, `score_max`, `score_method_version`, `score_rationale`, `score_counted_count`. `unique (application_project_id) where status = 'in_progress'`.

### A.13 interview_questions / interview_answers / answer_evaluations / session_feedbacks
| 테이블 | 컬럼 |
|--------|------|
| interview_questions | `session_id`, `sequence`(unique per session), `source_kind` CHECK in (`project_deep_dive`, `requirement_fit`, `gap_probe`, `collaboration`, `conflict`, `failure_growth`, `values`, `org_adaptation`, `motivation_career`), `anchor` CHECK in (`experience`, `jd`, `general`), `question_text`, `intent`, `focus_criteria` text[], `target_requirement_ids`, `target_gap_requirement_ids`, `good_answer_signals` jsonb, `copied_from_question_id` + AI 메타. 비공개 컬럼은 클라이언트 grant 없음 |
| interview_answers | `session_id`, `question_id`(unique), `answer_text`(≤ 5,000자), `status` CHECK in (`draft`, `submitted`, `unanswered`), 점수 슬롯 `score_status`(pending_method/scored/unanswered/not_scored), `score_value`, `score_max`, `score_method_version`, `score_rationale`. update는 `status = 'draft'` + 미제출 + 생성 완료일 때 `answer_text`만 |
| answer_evaluations | `session_id`, `answer_id`(unique), `status` CHECK in (`pending`, `succeeded`, `failed`), `result` jsonb(criteria, strengths, improvements, intent_reveal, model_answer, consistency_notes, answer_quotes) + AI 메타 |
| session_feedbacks | `session_id`(unique), `status` CHECK in (`pending`, `succeeded`, `failed`), `result` jsonb(headline, overall_strengths, overall_weaknesses, next_practice, criteria_summary, unanswered_note) + AI 메타 |

### A.14 evidence_links (v3 반영 전체)
`application_project_id`(복합 FK cascade), `owner_type` CHECK in (`insight`, `draft_section`, `interview_question`, `answer_evaluation`, `session_feedback`, `chat_message`), `owner_id`(soft), `item_key`(초안 `block_id`, 그 밖 점 경로), `sort_order`, `source_type`(본문 2.8 목록), `source_id`(soft), `source_locator`, `source_field`, `quote`(원본 삭제 시 null), `quote_adjusted`, `source_snapshot_at`, `source_deleted_at`, `source_label`. 인덱스 `(owner_type, owner_id)`, `(user_id, source_type, source_id)`, `(application_project_id)`.

### A.15 ai_jobs (v3 반영 전체)
`job_type` CHECK in (`jd_extraction`, `insight`, `career_description`, `draft_source_ranking`, `cover_letter`, `interview_questions`, `interview_evaluation`, `writing_assist`, `chat_reply`, `writing_chat_turn`), `application_project_id`(null 허용, cascade), `target_type`, `target_id`, `status` CHECK in (`queued`, `running`, `succeeded`, `failed`, `canceled`), `progress` jsonb `{stage, done, total}`, `params` jsonb, `attempt_count`, `error_code` CHECK in (`model_unavailable`, `rate_limited`, `schema_invalid`, `refused`, `not_a_jd`, `insufficient_data`, `input_too_long`, `timeout`, `stalled`, `canceled`), `error_category` generated(transient/input/timeout/canceled), `input_hash`, `prompt_version`, `model`, `usage`, `output` jsonb(`draft_source_ranking` 전용), `heartbeat_at`, `cancel_requested_at`, `started_at`, `finished_at`. 보관 90일.

### A.16 usage_events / usage_limits
| 테이블 | 컬럼 |
|--------|------|
| usage_events | `feature` CHECK in (`insight`, `draft`, `interview_session`, `writing_chat`, `chat_message`), `units`, `period_month`(KST 월 1일), `status` CHECK in (`reserved`, `charged`, `released`), `ai_job_id`(soft), `reason` CHECK in (`initial`, `explicit_regenerate`, `source_change_regenerate`, `retake`). 보관 13개월 |
| usage_limits | `plan`(MVP `free`), `feature`, `monthly_limit`(insight 10, draft 20, interview_session 5, writing_chat **10** — U-8 확정), `effective_from` |

### A.17 Should·운영
| 테이블 | 컬럼 |
|--------|------|
| chat_threads | `application_project_id`(cascade), `rolling_summary`, `summary_updated_at` |
| chat_messages | `thread_id`(cascade), `role` CHECK in (`user`, `assistant`), `content`, `status` CHECK in (`streaming`, `done`, `failed`) + AI 메타 |
| result_ratings | `target_type`(insight/draft/answer_evaluation/session_feedback), `target_id`, `rating`(up/down), `reason`(≤ 500자), `prompt_version`, `model`. unique per target |
| ai_suggestions | `target_type`(project_detail 등), `target_id`, `decision`(accepted/edited/rejected), `prompt_version`, `model` |
| account_deletion_logs | `subject_hash`, `requested_at`, `db_deleted_at`, `storage_deleted_at`, `reason`(user_request/inactivity). 3년, 비식별 |
