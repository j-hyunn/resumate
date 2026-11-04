# Resumate 데이터 모델 v4.8

> 작성: data-architect / 기준 입력: **v4.8: `_workspace/00_input/planning-decisions-education-name.md`(ED-1~ED-7, 확정 2026-11-04 (사용자)), 구현 PR #29·마이그레이션 `20261113000200_ui32_education_display_labels`, `_workspace/backend/UI32/06_db-engineer_notes.md`** / v4.5: `docs/planning/01-prd.md` PRD v4.6, `docs/planning/02-user-flows.md` 화면 명세 v5.6, `docs/planning/03-ai-features.md` AI 명세 v4.6, `_workspace/00_input/planning-decisions-project-add-figma.md`(PA-1~PA-4, 확정 2026-11-03 (사용자)), 요청 `_workspace/project-add-figma/{prd,ux,ai}_requests.md`, 리더 정렬 3건(2026-11-03)** / v4.4: `docs/planning/01-prd.md` PRD v4.5, `docs/planning/02-user-flows.md` 화면 명세 v5.5, `docs/planning/03-ai-features.md` AI 명세 v4.5, `_workspace/00_input/planning-decisions-career-redesign.md`(CR-1~CR-14)** / 이전: `_workspace/01_product-planner_prd.md` (PRD v4.3, BYOK), `_workspace/02_ux-planner_flows.md` (화면 명세 v5.3), `_workspace/02_ai-feature-designer_ai-spec.md` (AI 명세 v4.3), `_workspace/00_input/brief-2026-11-05.md` (백엔드 구현 반영 부분 재실행), `planning-decisions-2026-11-05.md` (사용자 확정 A1~A24), `spec-gaps-summary.md`, `product-context.md`
> 상태: **v4.8 — 교육 표시 이름 반영(ED-2·ED-3·ED-6, 확정 2026-11-04 (사용자))**: 교육 표시 이름 = trim한 `program_name`(화면 "교육 명") → 비면 trim한 `institution_name`(화면 "운영 기관") → 둘 다 비면 null(화면 "이름 없는 교육")(2.3 educations). 교육 `education_type`·`enrollment_status`는 화면 입력이 아니고 앱이 정한다(2.3, (v4.8, ED-7), 설명만). 커리어 목록 응답 `name`(2.4·7장), 근거·출처 저장 라벨 `source_label`(2.7·2.8, 기존 행 백필), DB 헬퍼 `private.education_display_name`·`private.trim_js_whitespace`. 테이블·컬럼 변경 없음. 구현 PR #29 반영(11.4). 이전: **v4.8 — 독립 프로젝트 생성 시점 변경(D-UX-28, 확정 2026-11-04 (사용자))**: 독립 프로젝트 행은 C-23 이름 다이얼로그가 아니라 S-43 새 독립 프로젝트의 첫 저장 때 만든다(같은 사용자 세션 insert, 이름 + 프로젝트 정보를 한 번에). **스키마·RPC 변경 없음**. 이전 **v4.6 — 처리방침·이용약관 확정과 장기 미접속 파기 반영(PT-1·PT-3, 확정 2026-11-04 (사용자))**: `policy_versions` `2026-11-04`(4.5·A.2), 접속 기록 최대 1년·장기 미접속 파기(4.4·4.6), `last_active_at`·`inactivity_notice_sent_at` 용도 확정(A.1). 구현 PR #24·#25 반영. 이전: **v4.5 — 프로젝트 추가·산출물 상세 Figma 결정 반영(PA-1~PA-4)**: `writing_chats.project_deliverable_id`(산출물 대화, PA-1), S-10·S-44 **페이지 저장 RPC** `save_project_page`·`save_project_deliverable`(만들기·고치기 한 번에, 기대 버전 `p_expected_updated_at` → `stale_write`, 반영됨 기록 `p_applied_proposals`를 같은 트랜잭션에서, 기록 실패는 저장을 막지 않음 — PA-3), **`apply_writing_chat_proposal` 폐기**(반영 = 화면 폼 채우기), 산출물 대화 시작 `start_deliverable_writing_chat`, `structured_draft` 필드 `rev`·산출물 대화 모양(`target = project_deliverable`), V-9h·분류·기간의 DB 거부를 낮춤으로 완화, 초안 6회 `writing_chat_draft_limit_reached`, 삭제 영향에 산출물 대화. PA-2·PA-4는 스키마 변경 없음. 회신은 `_workspace/project-add-figma/dm_replies.md`, 백엔드 후속 ★는 11.3. / **v4.4 — 커리어 화면 재설계 반영(`_workspace/00_input/planning-decisions-career-redesign.md`, CR-1~CR-14, 확정 2026-11-02 (사용자))**: 기준 입력 PRD v4.5·UX v5.5·AI v4.5와 요청 `_workspace/career-redesign/{prd,ux,ai}_requests.md`. STAR를 `projects` 컬럼으로 합치고 `project_details`·`achievements` 폐기(DM-19), 소속 / 독립 프로젝트 구성 CHECK(DM-20), 분류 3종·`description`·`link_url`·`project_deliverables` 신설, `writing_chats`를 프로젝트 필수·`active`/`closed`·반영 RPC `apply_writing_chat_proposal`로 개정, 미연결 대화 90일 정리 폐기, 근거 `project_deliverable`, readiness `create_project`. 회신은 `_workspace/career-redesign/dm_replies.md`, 백엔드 후속은 11장. / **v4.3b — 가입 필수 동의에서 `cross_border_transfer` 제외(spec-gaps ⑲, A.2)** / **v4.3a — 요건 0개로 성공한 JD의 공고 원문 수정(Q53-11, 2.6.1)** / **v4.3 — UI v5.3 QA 사용자 결정 반영(`_workspace/00_input/planning-decisions-v53-qa.md`, Q53-1~9)**: 입력 원인으로 요건 추출에 실패한 JD의 공고 원문 수정(Q53-2, 2.6.1), 생성 RPC 게이트(Q53-1), 답변별 실패 원인·종합만 다시 정리(Q53-3·5), 경력기술서 중단(Q53-7), 실패 세션과 새 면접, 입력 원인 실패 세션의 새 결과 표식(Q53-10)(2.7.1). UX v5.4와 맞췄다. ★ 표시는 이미 구현된 백엔드도 고쳐야 한다. / **v4.2 — 백엔드 구현 반영(2026-11-05)**: 사용자 확정 12건(A3, A5, A6, A8, A17~A24)과 구현이 정한 쓰기 경로·내부 컬럼·RPC 세부(spec-gaps B DM 전체)를 문서에 옮겼다. 구현이 정한 값(C)은 `[가정]`으로 둔다(4.5). ★ 표시 확정은 이미 구현된 백엔드도 후속 슬라이스에서 고쳐야 한다. / **v4.1a** (BYOK 리뷰 라운드 2: R-38 잔여, R-45) / **v4.1** (BYOK 리뷰 라운드 1: R-38, R-40, R-43, UB-2 (b) 반영) / **v4 (BYOK)** — 사용자 API 키·활성 공급자·공급자별 데이터 사용 동의·토큰 사용 미터 반영, 운영자 사용량 원장 삭제. 이전: v3.2a (확인 패스 R-35 반영) / v3.2 (리뷰 라운드 2 반영: R-27, R-28, R-29, R-13 잔여 / 사용자 결정 2026-10-24 반영: U-2, U-5, U-8, U-9 등, 8장). **문서만 작성했다. 마이그레이션·SQL은 적용하지 않았다.** `[가정]`·`[결정 필요]`·`[보류]` 항목은 확정이 아니다.
> 이 문서의 테이블·컬럼명이 **확정명**이다. v4.2에서 새로 생긴 이름은 11.5절에 정리했다. UX v5·AI v4 문서와 다른 이름은 11장 `요청 회신`에 old → new로 정리했다. 버전별 변경은 10장.
> 표기: "프로젝트"(`projects`)는 커리어의 업무 단위로, 경력·교육 아래 **소속 프로젝트**(STAR 1개 = `projects`의 컬럼)와 소속 없는 **독립 프로젝트**(프로젝트 정보·내용·산출물)가 있다. "산출물"은 `project_deliverables`. 지원 건 단위는 문서·데이터에서 **"지원 프로젝트"**(`application_projects`), 메뉴 라벨 **"자기소개서 관리"**(v4.4, CR-12. 이전 "기업 JD 관리"), 화면 표기 **"자기소개서"**(v4.4 후속 CR-23 확정 — 이전 화면 표기 "기업 JD". 내부 이름 `application_projects`·`job_descriptions`·"지원 프로젝트"는 그대로), JD 원문(`job_descriptions.raw_text`)은 화면에서 **"공고 원문"**(PRD D-20, UX D-UX-10). v3의 "상세 내용"(`project_details`)은 v4.4에서 폐기했다. "AI 작성 대화"(`writing_chats`)는 커리어 채팅(`chat_threads`, Should)과 다르다.

---

## 0. 설계 원칙과 핵심 결정

| # | 결정 | 이유 |
|---|------|------|
| DM-1 | 모든 사용자 데이터 테이블은 `user_id ... references auth.users(id) on delete cascade` | 탈퇴 시 전체 파기의 안전망. **v4.2**: 실제 탈퇴는 RPC가 public 데이터를 명시적으로 지운 뒤 서버가 auth 사용자를 지운다(6.1 F-COM-05, 4.5) |
| DM-2 | 부모–자식은 복합 FK `(parent_id, user_id)` | 소유자 혼합 차단 |
| DM-3 | 열거값은 `text + CHECK` | 기획 중 값 변경이 잦다 |
| DM-4 | 년-월은 `date`(1일 고정) | 정렬·기간·연도 묶음 계산 |
| DM-5 | AI 결과는 jsonb + `schema_version`, 재생성은 새 행(자소서 문항은 덮어쓰기) | |
| DM-6 | 근거는 `evidence_links`에만 | 삭제 시 인용문 일괄 삭제 |
| DM-7 | 근거·근거 선택은 soft reference | "원본 삭제됨" 표시 |
| DM-8 | 커리어 데이터 자동 저장은 본 테이블 `status = 'draft'` | |
| DM-9 (v4 개정) | AI 실행은 `ai_jobs`, **토큰 사용 기록은 `ai_usage_records`**(호출 1회 = 1행, 예상 비용은 버전 관리되는 `ai_price_tables`로 기록 시점 계산). 운영자 비용 통제용 예약·차감·무료 한도는 없다 | PRD v4 D-17 재정의, D-34 |
| **DM-16 (v4)** | **사용자 API 키는 앱 수준 봉투 암호화 + 외부 KMS로 저장하고, 어떤 DB 역할도 원문을 볼 수 없다.** 복호화는 작업 실행 시점 서버 메모리에서만, 실행 중인 작업에 묶인 전용 함수로만 암호문을 꺼낸다(2.11) | NFR-KEY-01~09, D-29 |
| **DM-17 (v4)** | **활성 공급자 1개**(`profiles.active_ai_provider`, 키 행에 FK). 작업은 실행 시점 공급자·등급을 `ai_jobs`에 기록하고(같은 행 다시 시도는 그 시점 활성 값으로 갱신, 2.9.1 A1), 모든 AI 결과 행에 `provider`·`model`을 남긴다 | D-28, F-AI-03 |
| DM-10 | RAG·pgvector 미사용 | |
| DM-11 | 커리어 테이블과 지원 프로젝트 테이블 분리, 둘 사이는 soft reference뿐 | |
| DM-12 | 지원 프로젝트 하위 결과의 소유 키는 `application_project_id` 하나 | D-19 (a) 전제 |
| DM-13 (v4.5 개정) | **커리어 데이터 쓰기는 사용자 세션에서만.** AI 작업용 DB 역할 `app_ai_writer`는 커리어 테이블을 읽기만 한다. **v4.5 (PA-3)**: AI 제안의 **[반영]은 화면이 폼을 채우는 동작**이라 DB를 쓰지 않고, 커리어 값은 사용자의 **"저장하기"**(사용자 세션 RPC `save_project_page` / `save_project_deliverable`, 2.5.1)만 바꾼다. "반영됨" 기록(`applied_at`)도 같은 저장 트랜잭션에서 남긴다. v4.4 `apply_writing_chat_proposal`(누르면 바로 DB 저장)은 폐기 | NFR-AI-05, CR-5, PA-3 |
| **DM-21 (v4.5)** | **전체 페이지(S-10·S-44)는 페이지 단위 저장 RPC 하나로 만들기·고치기를 함께 한다.** 행이 없으면 만들고(첫 "저장하기" 또는 첫 AI 메시지 직전의 자동 저장), 있으면 고친다. 기대 버전(`updated_at`)이 다르면 `stale_write`로 거부한다 | PA-3, UX DM-1·2·6·8. 섹션 단위 update로는 "반영됨 기록과 저장을 한 트랜잭션"·"다른 곳에서 바뀜" 판정을 만들 수 없다 |
| **DM-14 (v4.4 개정)** | **커리어 계층: 경력 / 교육 > 소속 프로젝트(STAR 1개), 그리고 독립 프로젝트 > 산출물.** 정량 성과·상세 내용 단계는 없다. 연도는 저장하지 않는 보기(시작 연도에 한 번, 2.4) | PRD v4.5 F-P1-03·09·15·17·18, CR-1·CR-2·CR-4·CR-11 |
| **DM-19 (v4.4)** | **STAR는 `projects`의 컬럼이다(`project_details` 1:1 테이블로 남기지 않는다)** | ① 프로젝트당 STAR 1개(CR-2)라 별도 행의 이점(여러 개·순서)이 없다. ② 1:1로 남기면 완료 판정이 두 단계(자식 트리거로 부모 재계산), 근거 `source_type` 2종, 삭제 트리거·readiness 카운트·RLS·복합 FK가 그대로 남아 복잡도만 는다. 합치면 완료 판정이 행 하나의 CHECK가 된다. ③ AI 명세 v4.5는 이미 STAR를 `PRJ-n`의 필드로 다루고 `DET-n`을 폐기했다. ④ 대가: 소속·독립 프로젝트 한쪽에서 쓰지 않는 컬럼이 생긴다 → DM-20 CHECK로 막는다. 필드 단위 "변경됨"은 `content_updated_at`(2.3)으로 보완 |
| **DM-20 (v4.4)** | **소속 프로젝트와 독립 프로젝트는 한 테이블. 구분은 소속 컬럼(`num_nonnulls(experience_id, education_id)`), 구성은 CHECK로 강제하고 둘 사이 전환은 막는다** | 두 종류는 이름·기간·근거 경로·삭제 규칙을 공유하고, 지원 프로젝트 쪽 참조(`draft_section_sources.project_id`, 근거 `project`, `drafts.options.included_project_ids`)가 하나라 테이블을 나누면 참조가 갈라진다. 구성이 다르므로(CR-7·CR-10) 쓰지 않는 컬럼은 CHECK로 비워 두고, 소속 ↔ 독립 전환은 거부(PRD F-P1-03 (7) `[가정]`) |
| **DM-15 (v3)** | **AI 작성 대화의 출처(필드별 발화)는 `writing_chats.structured_draft` 안에 둔다. `evidence_links`에는 넣지 않는다** | 커리어 데이터를 만드는 과정의 기록이며, 반영 후의 근거 원본은 커리어 항목(프로젝트 STAR) 자체다(AI 명세 AI-12 동의). v4.4: 반영한 STAR에는 필드 단위 출처를 남기지 않는다(MVP, UX D-11 회신) |
| **DM-18 (v4.3)** | **공고 원문은 만든 뒤 바꾸지 않는다(U-6·D-19). 예외는 입력 원인으로 요건 추출에 실패했거나 추출은 성공했는데 요건이 0개라서(Q53-11) 그 원문에서 나온 결과가 하나도 없는 JD뿐이고, RPC `update_failed_jd_raw_text`로만 바꾼다**(2.6.1) | 요건·근거의 문장 ID(`source_sids`, `jd_sentence`)가 원문에 묶여 있어 결과가 있으면 바꿀 수 없다. 결과가 없으면 깨질 것도 없다. 확정 2026-10-30 (사용자, Q53-2) |

### 공통 컬럼
`id` uuid PK / `user_id` (DM-1) / `created_at` / `updated_at`(트리거, 모든 근거 원본 테이블 필수). 예외는 표에 명시.

### AI 출력 공통 메타
`ai_job_id`, `schema_version`, `prompt_version`, **`provider`**(v4: `openai` / `gemini` / `anthropic`), `model`, **`model_tier`**(v4: `light` / `default` / `heavy`), **`connection_tier`**(v4: `free` / `paid`), `input_hash`(v4: 공급자·모델 포함), `career_snapshot_hash`, `validation_report`, `usage`.
- v4 적용 테이블: `insights`, `drafts`, **`draft_sections`**(문항 단위 재생성이 다른 공급자로 실행될 수 있어 섹션에도), `interview_questions`, `answer_evaluations`, `session_feedbacks`, **`writing_chat_messages`**(assistant 행), `chat_messages`(Should). JD 요건 추출은 `job_descriptions.extraction_provider` / `extraction_model`(2.6). 결과 배지(F-AI-03 (3), F-AI-09)가 이 값을 읽는다. 면접 세션의 공급자는 **`interview_sessions`의 4개 비정규화 컬럼**으로 둔다(v4.1, R-40, 아래 2.7).
- `usage` jsonb는 결과 행 단위 합계(표시용)로 남기고, 미터의 원천은 `ai_usage_records`다.
- **결과 테이블 내부 컬럼 (v4.2, 구현 반영)** — 화면·명세에는 노출하지 않는다.
  - `ai_job_id`는 soft가 아니라 **복합 FK `(ai_job_id, user_id) → ai_jobs on delete set null (ai_job_id)`**. 다른 사용자 작업 지정을 막고, 작업 90일 정리 때 null이 된다.
  - **`run_generation`** integer: `insights`, `drafts`, `draft_sections`, `interview_questions`, `answer_evaluations`, `session_feedbacks`. 이 행을 쓴 실행 세대(`ai_jobs.run_generation`, 2.9.1). 수동 재시도(같은 행 다시 시도)에서 **공급자·등급이 작업에 기록된 값과 다르면 `step_outputs`를 비우고, 그 작업이 이미 저장한 결과 행도 모두 다시 열어 새 결과로 덮어쓴다**(면접 질문·답변 평가·종합 등, 리뷰 R-63 리더 판단). **같으면 이전 세대에서 실패한 행만 다시 연다.** 어느 쪽이든 늦게 도착한 이전 세대의 완료는 `stale_run`으로 버린다.
  - `drafts`·`draft_sections`의 **`completed_at`**(결과 시각).
  - `interview_sessions`의 `question_job_id`·`question_run_generation`·`evaluation_job_id`·`evaluation_run_generation`(A.12).
- **결과 쓰기는 소유·세대 검사 RPC로만**(5장). 결과 jsonb 안의 별칭 참조는 UUID 키로 바꿔 저장한다(`requirement_ids`, `project_id`, `question_ids` 등, AI C-3).

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
  auth_users ||--o{ ai_usage_records : "토큰 사용 기록"
  auth_users ||--o{ ai_provider_keys : "API 키 (공급자별 1)"
  auth_users ||--o{ ai_data_use_consents : "공급자 동의"
  ai_provider_keys |o--|| profiles : "active_ai_provider (FK set null)"
  application_projects |o..o{ ai_usage_records : "set null"

  experiences |o--o{ projects : "소속 프로젝트 (cascade, STAR 1개 = 컬럼)"
  educations |o--o{ projects : "소속 프로젝트 (cascade)"
  projects ||--o{ project_deliverables : "산출물 (독립 프로젝트만)"
  projects ||--o{ project_skills : "사용 기술 (독립 프로젝트만)"
  skills ||--o{ project_skills : tags

  projects ||--o{ writing_chats : "대화 여러 개 (소속 프로젝트 = STAR 대화 / 독립 프로젝트 = 산출물 대화의 부모, cascade)"
  project_deliverables |o--o{ writing_chats : "산출물 대화 (v4.5, project_deliverable_id, cascade)"
  writing_chats ||--o{ writing_chat_messages : has
  writing_chats |o..o{ projects : "source_writing_chat_id = 마지막 반영 대화 (set null)"

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
  evidence_links }o..|| projects : "source (soft, STAR·담당 업무·내용 필드)"
  evidence_links }o..|| project_deliverables : "source (soft, 제목·본문)"
  evidence_links }o..|| skills : "source (soft)"
  draft_section_sources }o..|| projects : "pick (soft)"
```

- 실선 = FK, 점선 = soft reference 또는 set null 참조. 커리어 → 지원 프로젝트 방향 FK 없음(v2와 같음).
- **v4.5 (PA-1)**: 산출물 대화는 `project_id`(부모 독립 프로젝트) + `project_deliverable_id`(대상 산출물)를 함께 가진다. 대상은 `project_deliverable_id`가 있으면 산출물, 없으면 프로젝트(2.5).
- **v4.4 (CR-2·CR-8·CR-11)**: `project_details`·`achievements`는 없다. STAR는 `projects`의 컬럼이다(DM-19). 산출물 `project_deliverables` 신설.
- 비사용자 테이블(`policy_versions`, `ai_price_tables`, `ai_disclosures`, `ai_providers`, `account_deletion_logs`)과 Should 테이블(`chat_threads`, `chat_messages`, `result_ratings`, `ai_suggestions`)은 생략.

---

## 2. 테이블 정의

### 2.1 계정·동의
- `profiles`: v2와 같음. **v4.4**: `career_data_updated_at` 트리거 대상은 **6개 테이블**(experiences, educations, projects, **project_deliverables**, skills, project_skills). `project_details`·`achievements`는 테이블과 함께 빠졌다.
- `consents` / `policy_versions`: v2와 같음. 국외 이전 항목에 AI 작성 대화 추가(NFR-PRV-03 v3)는 정책 버전 갱신 → 재동의로 처리, 스키마 영향 없음.

### 2.2 커리어 — 공통 규칙

- `experiences`, `educations`, `projects`는 `status text not null default 'draft' CHECK in ('draft','complete')`. 서버(트리거)가 저장마다 다시 계산하고, 필수 필드는 `CHECK (status = 'draft' OR (필수 필드 not null))`로 강제한다(draft 행에서는 필수 컬럼 nullable). `project_deliverables`에는 `status`가 없다(아래).
- **완료 판정 (v4.4, CR-2·CR-7·CR-10·CR-11, PRD F-P1-03 (6)·F-P1-15 (3)·F-P1-17 (4)·D-01 `[가정]`)**

  | 대상 | complete 조건 | 판정 위치 |
  |------|---------------|-----------|
  | experiences | `company_name`, `start_month`, (`job_rank` 또는 `job_position`) | 저장 시 + CHECK (변경 없음) |
  | educations | `institution_name`, `education_type`, `start_month` | 저장 시 + CHECK (변경 없음. `education_type`은 앱이 채운다 — 2.3, (v4.8, ED-7)) |
  | **소속 프로젝트** (`experience_id` 또는 `education_id` 있음) | `name` + `situation` + `action` (공백만 있는 값은 빈 값) | 저장 시 + CHECK. **자식 의존이 없어져 CHECK 하나로 표현된다**(v3의 상세 내용 트리거 폐기) |
  | **독립 프로젝트** (소속 없음) | `name` + `description`(프로젝트 내용) | 저장 시 + CHECK. **산출물은 완료 조건이 아니다**(PRD F-P1-17 (4)). AI 명세 v4.5 제안 "내용 **또는** 산출물"은 PRD를 따라 채택하지 않았다 `[가정]` |
  | project_deliverables | 상태 없음. `title`은 항상 필수, `body`는 빈 문자열 허용 | AI 팩 포함 여부는 부모 독립 프로젝트의 `complete`로 정한다 |

  - 분류 3종·기간·`is_current`·`role`·`link_url`·사용 기술은 완료 조건이 아니다(F-P1-19, CR-17).
  - v3의 `role` 조건(T-16)과 "complete 상세 내용 ≥ 1"은 폐기했다(CR-10, CR-2).
- **`skills.normalized_name` 규칙 (v4.2, 구현 반영)**: 앞뒤 공백 제거 → 연속 공백 1칸 → 소문자. 표기 차이(`React.js` / `React`)는 합치지 않는다 `[가정]`.
- **길이 제한**: `experiences.company_name`·`job_rank`·`job_position`·`department`, `projects.name`·`role`은 DB CHECK 없이 서버 입력 검사로만 제한한다(100자). STAR 5필드·`description`·`link_url`·산출물은 아래 표의 DB CHECK.
- **AI 경력 팩·데이터 최소 기준 포함 규칙**: `complete` 행만. `draft` 부모(경력·교육)의 소속 프로젝트는 `complete`여도 제외. **산출물은 부모 독립 프로젝트가 `complete`일 때만** 들어간다(v4.4, PRD F-P1-18 (4)).
- **쓰기 주체**: 사용자 세션(RLS)만. `app_ai_writer`는 select만(5장).

### 2.3 커리어 테이블

#### experiences (v2와 같음)
`status`, `company_name`, `start_month`, `end_month`, `is_current`, `job_rank`, `job_position`, `department`, `employment_type`, `summary`(화면 "근무 내용", CR-13). 인덱스 `(user_id, start_month desc)`, `(user_id) where status = 'draft'`.

#### educations (v3 신설)
- 설명: 학위 과정 또는 교육 과정(부트캠프·사내외 교육). 관련 기능: F-P1-14 / 요청: ux S-08·S-34 요청 1, ai C-1

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `status` | text | 공통 규칙 | |
| `institution_name` | text | complete 시 필수, ≤ 100자 | 학교·교육기관명. **화면 라벨 "운영 기관 *"**(추가 모달·S-34 편집 공통, v4.8, ED-6). 필수·완료 판정은 변경 없음. 교육 명이 비면 표시 이름으로 쓴다(아래 "교육 표시 이름") |
| `education_type` | text | complete 시 필수, CHECK in (`degree`, `course`) | 학위 과정 / 교육 과정. **화면 입력이 아니다(v4.8, ED-7)** — 앱이 정한다: 새 교육 = `course`, 수정 때는 기존 값 유지(`add-career-dialog.tsx`). `degree`는 기존 데이터용으로 CHECK에 남지만 화면에서 만들 수 없다. 상세 보기에서도 숨김. 앱이 항상 채우므로 완료 판정(위 표)은 바뀌지 않는다 |
| `program_name` | text | null, ≤ 100자 | 전공·과정명. **화면 라벨 "교육 명"**(선택, 추가 모달·S-34 편집 공통, v4.8, ED-6 — 이전 S-34 편집 "전공/과정명", 피그마 "교육 직무" `[가정]`은 대체). 비어 있지 않으면 **교육 표시 이름**이 된다(v4.8, ED-2) |
| `start_month` | date | complete 시 필수, 1일 고정 | |
| `end_month` | date | null, `>= start_month` | |
| `enrollment_status` | text | null, CHECK in (`enrolled`, `graduated`, `completed`, `dropped_out`, `on_leave`), `CHECK (enrollment_status <> 'enrolled' OR end_month IS NULL)` | 재학·수강 중 / 졸업 / 수료 / 중퇴 / 휴학. **화면 입력이 아니다 — 앱이 기간에서 정한다(v4.8, ED-7, `add-career-dialog.tsx:175–178`)**: 진행 중 체크 → `enrolled`, 아니면 기존 값이 `enrolled`가 아닌 값(`graduated`·`completed`·`dropped_out`·`on_leave`)이면 유지, 없으면 종료 월이 있을 때 `completed`, 없으면 null. 위 `enrolled` ↔ `end_month` CHECK는 이 규칙으로 늘 지켜진다 |
| `description` | text | null, ≤ 2,000자 | 화면 "교육 내용"(CR-13) |

- **학점·성적 컬럼 없음**(NFR-PRV-01 v3). 자격증 `[보류]`.
- `unique (id, user_id)`. RLS 4개 동작 본인(사용자 세션). 인덱스 `(user_id, start_month desc)`, `(user_id) where status = 'draft'`.
- **교육 표시 이름 (v4.8, ED-2·ED-3)** — 저장하지 않는 계산 값. 컬럼 추가 없음.
  - 규칙: 앞뒤 공백을 지운 `program_name` → 비면 앞뒤 공백을 지운 `institution_name` → 둘 다 비면 **null**(화면이 "이름 없는 교육"으로 보인다. 저장 라벨에는 이 문구를 쓰지 않는다). 공백 집합은 JS `String.prototype.trim()`과 같다(U+3000 전각 공백·탭·줄바꿈·NBSP·BOM 포함, U+0085 제외).
  - 앱: `src/server/services/career/education-name.ts` `educationDisplayName(program_name, institution_name)`.
  - DB(v4.7 ★ 구현됨, `20261113000200`): `private.trim_js_whitespace(text)`(위 공백 집합으로 앞뒤 trim), `private.education_display_name(p_program_name, p_institution_name)`(위 규칙, null 가능). 둘 다 immutable·`search_path = ''`, public 실행 권한 회수 — 클라이언트·`app_ai_writer`가 직접 부르지 않고 라벨 빌더·트리거 안에서만 쓴다.
  - 적용: 커리어 목록 응답 `name`(2.4), S-08 목록 행·상세 제목·메뉴/삭제 확인 라벨, S-34 제목·브레드크럼, C-23·S-10/S-43 소속 목록·브레드크럼(UX 화면 명세, ED-2), **근거·출처 저장 라벨 `source_label`**(2.7·2.8).
  - 적용하지 않음(ED-4): AI 모델 입력. 컨텍스트 팩은 원본 필드 `institution_name`·`program_name`을 그대로 넣고, AI-03 교육 섹션 머리글(`draft_sections.heading`)은 "운영 기관 교육 명" 형식 그대로, AI-12 `affiliation`은 기관명 그대로. `prompt_version` 변경 없음. 근거 `source_field`의 `institution_name`·`program_name`(2.8)도 그대로다.

#### projects (v4.4 개정 — STAR 합침, 소속 / 독립 구분, CR-2·CR-7·CR-9·CR-10)

- 설명: 커리어의 업무 단위. **소속 프로젝트**(경력·교육 아래, STAR 1개 + 분류 3종)와 **독립 프로젝트**(소속 없음, 프로젝트 정보·내용 + 산출물·사용 기술)를 한 테이블에 두고, 어느 쪽인지는 소속 컬럼으로 정한다(DM-20). 관련 기능: F-P1-03, F-P1-13, F-P1-15, F-P1-17, F-P1-19 / 요청: ux D-1~D-5·D-13·D-17, ai 1·3·4·5·10, prd 1·3·4·6·8·10

| 컬럼 | 타입 | 제약 | 적용 | 설명 |
|------|------|------|------|------|
| `status` | text | 공통 규칙 | 공통 | 완료 조건은 2.2 표 |
| `experience_id` | uuid | null, 복합 FK → `experiences on delete cascade` (**v4.4: set null → cascade**, 아래) | 소속 | |
| `education_id` | uuid | null, 복합 FK → `educations on delete cascade` (v4.4) | 소속 | |
| — | — | `CHECK (num_nonnulls(experience_id, education_id) <= 1)` | | 경력 / 교육 / 없음(독립) 중 하나 |
| `name` | text | **v4.4: not null**, 공백 아님, ≤ 100자(서버) | 공통 | 독립 프로젝트는 ~~"커리어 추가 > 프로젝트"(C-23)에서 이름을 받고 만든다(CR-6)~~ → **(v4.7, D-UX-28)** S-43 새 독립 프로젝트의 첫 저장 때 이름과 프로젝트 정보를 함께 받아 만든다. **v4.5 (PA-3)**: 소속 프로젝트는 이름 다이얼로그 없이 빈 S-10에서 첫 "저장하기"(또는 첫 AI 메시지 직전 자동 저장) 때 `save_project_page`가 만든다. 이름이 비면 화면이 저장·첫 메시지를 막는다 — **임시 이름 없음**(리더 정렬 1, UX D-UX-25) |
| `start_month`, `end_month` | date | null, 1일 고정, `end_month >= start_month` | 공통 | |
| **`is_current`** | boolean | **v4.4 후속 신설(CR-22)**, not null default false, **`CHECK (NOT is_current OR end_month IS NULL)`** | 공통(소속·독립) | 화면 "진행 중" 체크. 체크하면 종료월 입력 비활성(경력 `is_current`와 같은 방식). 근거 필드(`content_updated_at` 갱신 대상, 기간 근거 `period`에 포함) |
| **`project_type`** | text | **v4.4 신설**, null, CHECK in (값 목록 아래) | 소속 | 화면 "프로젝트 종류"(카드 태그). 단일 선택 |
| **`experience_type`** | text | **v4.4 신설**, null, CHECK in (값 목록 아래) | 소속 | 화면 "경험 유형". 단일 선택 |
| **`competencies`** | text[] | **v4.4 신설**, not null default `'{}'`, 원소 CHECK(값 목록 아래), `cardinality(competencies) <= 3`, 중복 없음(`private.text_array_is_distinct` 불변 함수 CHECK) | 소속 | 화면 "역량". 복수 선택 최대 3(F-P1-19, **CR-17 확정**). 선택 순서를 저장 |
| **`situation`** | text | **v4.4 이동**(← `project_details`), null, ≤ 2,000자 | 소속 | 상황 S. 마크다운 텍스트 |
| **`task`** | text | v4.4 이동, null, ≤ 2,000자 | 소속 | 화면 **"역할"**(Task, CR-2). 이 프로젝트에서 맡은 일 |
| **`action`** | text | v4.4 이동, null, ≤ 2,000자 | 소속 | 행동 A (본인이 직접 한 일) |
| **`result`** | text | v4.4 이동, null, ≤ 2,000자 | 소속 | 화면 **"결과/성과"**. 서술만(수치도 서술 안에, CR-11) |
| **`learnings`** | text | v4.4 이동, null, ≤ 2,000자 | 소속 | 화면 **"배운 점"**(CR-2, U-2 "회고 및 배운 점" 대체). 컬럼명은 그대로. **사용자의 회고** — AI는 사실 근거로 쓰지 않음(NFR-AI-06, AI V-8) |
| `role` | text | null, ≤ 100자(서버). **v4.4: 필수 해제, 독립 프로젝트 전용** | 독립 | 화면 "담당 업무"(CR-7). 소속 프로젝트에서는 쓰지 않는다(CR-10, 역할은 STAR `task`) |
| **`description`** | text | **v4.4 신설**, null, ≤ 5,000자 | 독립 | 화면 **"프로젝트 내용"**(긴 본문, 마크다운). v3 `summary`(≤ 200자 한 줄 요약)와 다른 컬럼 |
| **`link_url`** | text | **v4.4 신설**, null, ≤ 2,048자, `CHECK (link_url ~* '^https?://')` | 독립 | 화면 "Link". URL 1개 `[가정]`(F-P1-17 (2)). AI 팩·해시에 넣지 않는다(AI C-1) |
| `source_writing_chat_id` | uuid | null, FK → `writing_chats on delete set null` | 소속 | 이 프로젝트에 **마지막으로 반영한** AI 작성 대화. **v4.5**: `save_project_page`가 반영됨 기록에 성공한 대화로 쓴다(v4.4 `apply_writing_chat_proposal` 폐기). 이 컬럼만 바뀌는 update는 `updated_at`을 올리지 않는다(아래) |
| **`content_updated_at`** | timestamptz | **v4.4 신설**, not null default now() | 공통 | 근거가 될 수 있는 필드(`name`, 기간·`is_current`, STAR 5필드, `role`, `description`)가 바뀔 때만 트리거가 갱신. 근거 "변경됨" 판정용(2.8). 분류·`link_url`·`source_writing_chat_id`만 바뀌면 그대로 `[가정]` |

- **v4.4 삭제**: `summary`(한 줄 요약 — 소속 프로젝트에는 화면이 없고 독립 프로젝트는 `description`이 대신함, PRD F-P1-03 (5)), `team_size`(피그마에 없음, PRD `[가정]`). 팀·배경은 STAR `situation`에 쓴다.
- **소속 / 독립 구성 CHECK (DM-20)**:
  ```
  CHECK (num_nonnulls(experience_id, education_id) = 1
         OR (situation IS NULL AND task IS NULL AND action IS NULL AND result IS NULL AND learnings IS NULL
             AND project_type IS NULL AND experience_type IS NULL AND competencies = '{}'
             AND source_writing_chat_id IS NULL))            -- 독립 프로젝트에는 STAR·분류·대화가 없다
  CHECK (num_nonnulls(experience_id, education_id) = 0
         OR (role IS NULL AND description IS NULL AND link_url IS NULL))   -- 소속 프로젝트에는 담당 업무·내용·Link가 없다
  CHECK (status = 'draft' OR (CASE WHEN num_nonnulls(experience_id, education_id) = 1
                                   THEN situation IS NOT NULL AND action IS NOT NULL
                                   ELSE description IS NOT NULL END))
  ```
  공백만 있는 값은 트리거 `projects_set_status`가 빈 값으로 보고 `draft`로 둔다(v3와 같은 방식).
- **소속 변경 규칙 (PRD F-P1-03 (7) `[가정]`)**: 경력 ↔ 교육 사이 이동만 허용한다. 소속 ↔ 독립 전환은 update 트리거가 `project_scope_change_not_allowed`로 거부한다(구성이 달라 CHECK와도 충돌). 이동 대상 경력·교육은 같은 사용자 행(복합 FK).
- **부모 삭제 FK를 cascade로 바꾼 이유**: 경력·교육이 지워질 때 소속 프로젝트를 독립으로 남기면(set null) STAR가 있는 독립 프로젝트가 되어 위 CHECK에 걸린다. **함께 지운다 — 확정 2026-11-02 (사용자), CR-15(D-UX-22 (a))**. 삭제 확인 창에 함께 지워지는 프로젝트 수·대화를 보인다(`get_deletion_impact`의 `cascade.projects`·`cascade.writing_chats`, 4.2).
- **분류 값 목록 (v4.4, PRD F-P1-19 그대로 — 확정 2026-11-02 (사용자), CR-17. 영문 키는 데이터 모델 확정)** — 화면 표시명은 앱 상수, DB에는 키만:

  | 컬럼 | 키 → 표시명 |
  |------|-------------|
  | `project_type` | `new_build` 신규 구축 / `improvement` 개선·고도화 / `operation` 운영·유지보수 / `research` 분석·리서치 / `marketing` 마케팅·캠페인 / `process_improvement` 프로세스·조직 개선 / `migration` 전환·마이그레이션 / `coursework` 교육·학습 과제 / `other` 기타 |
  | `experience_type` | `impact` 성과 창출 / `problem_solving` 문제 해결 / `collaboration` 협업·갈등 조정 / `leadership` 주도·리딩 / `failure_recovery` 실패·극복 / `new_challenge` 새로운 시도 / `customer_facing` 고객·사용자 대응 |
  | `competencies` 원소 | `problem_solving` 문제 해결력 / `analysis` 분석력 / `planning` 기획력 / `execution` 실행력 / `communication` 커뮤니케이션 / `collaboration` 협업 / `leadership` 리더십 / `technical_expertise` 기술 전문성 / `customer_insight` 고객 이해 / `learning_agility` 학습 민첩성 |

  - `text + CHECK`(DM-3). 값 목록이 나중에 바뀌면 CHECK만 바꾼다(CR-17로 현재 목록 확정). 같은 키(`problem_solving` 등)가 두 컬럼에 있어도 컬럼이 달라 충돌하지 않는다.
  - AI 팩에는 표시명 문자열로 넣는다(AI C-1.2). 근거 `source_field` 허용값이 아니다(2.8). `career_snapshot_hash` 포함 필드다(AI C-1).
- **기간 표시 (C-25, PRD F-P1-03 (3), v4.4 후속 CR-22)**: "(N년 N개월)"은 **저장하지 않고 앱이 계산**한다(뷰 없음). 개월 수 = (끝 달 − `start_month`)의 달 수 + 1(양 끝 달 포함).
  | 상태 | 표시 | 끝 달 |
  |------|------|-------|
  | `end_month` 있음 | "YYYY.MM - YYYY.MM (N년 N개월)" | `end_month` |
  | `is_current = true` | "YYYY.MM - 현재 (N년 N개월)" | 이번 달(KST) |
  | `is_current = false`, `end_month` 없음 | "YYYY.MM -", 개월 수 없음 | — |
  | `start_month` 없음 | 기간 줄 생략 | — |
  - AI 팩의 기간 표기도 같은 규칙이다(진행 중이면 "~ 현재", 서버가 이번 달까지 계산한 개월 수는 V-5 허용 값 목록에 넣는다). 연도 묶음은 `start_month`만 쓰므로 `is_current`의 영향이 없다(2.4).
- `unique (id, user_id)`. RLS 4개 동작 본인(사용자 세션). 인덱스 `(user_id, experience_id)`, `(user_id, education_id)`, `(user_id, start_month desc)`, **`(user_id) where experience_id is null and education_id is null`**(v4.4, 커리어 목록의 독립 프로젝트), `(user_id) where status = 'draft'`.
- 트리거: `projects_set_status`(완료 재계산, v4.4 위 조건), 범위 변경 거부, `content_updated_at` 갱신, `updated_at`, `profiles.career_data_updated_at` 갱신, 근거 원본 삭제 표시(2.8).
- **`updated_at` 규칙 (v4.5 ★, UX DM-8)**: `updated_at`은 S-10 "다른 곳에서 바뀜" 판정의 기대 버전으로 쓰인다(`save_project_page`의 `p_expected_updated_at`, 2.5.1). 그래서 **`source_writing_chat_id`만 바뀌는 update에서는 올리지 않는다** — 패널에서 대화를 지우면 FK `set null`이 프로젝트 행을 update하는데, 이것으로 열린 페이지의 저장이 `stale_write`가 되면 안 된다. 그 밖의 컬럼(분류·`is_current`·`link_url` 포함)이 바뀌면 올린다. 근거 "변경됨" 기준은 여전히 `content_updated_at`(2.8)이다.
- **쓰기 경로 (v4.5)**: 소속 프로젝트의 만들기·고치기(머리·STAR·소속 변경)는 S-10 페이지 저장 RPC `save_project_page`(2.5.1)로 한다. 독립 프로젝트(S-43)는 사용자 세션 insert(**v4.7: S-43 새 독립 프로젝트의 첫 저장**, D-UX-28 — v4.4의 C-23 이름 insert 대체)·섹션 update(C-24). RLS 직접 쓰기는 막지 않는다(같은 CHECK·트리거가 지킨다).

#### ~~project_details~~ (v4.4 폐기, CR-2)
- 프로젝트당 STAR 1개가 되어(D-23 폐기) 컬럼을 `projects`로 옮겼다(DM-19). `title`(프로젝트명이 제목), `sort_order`, 행 단위 `status`·`source_writing_chat_id`는 없어졌다. 별칭 `DET-n`, 근거 `source_type = 'project_detail'`, `draft_section_sources.project_detail_ids`, 트리거 `project_details_sync_project_status`, RPC `reorder_project_details`도 폐기.

#### ~~achievements~~ (v4.4 폐기, CR-11)
- 정량 성과(상세 내용 결과의 구조화 수치)와 경력 단위 성과를 모두 없앴다(F-P1-04 폐기, D-24 폐기). 수치는 `projects.result` 등 서술 안에 쓴다. 숫자 가드(AI V-5)의 원천은 사용자 서술 텍스트다 — 스키마 영향 없음. 근거 `source_type = 'achievement'`, `achievements.kind`, `structured_draft.details[].achievements[]`, 별칭 `ACH-n` 폐기.

#### project_deliverables (v4.4 신설, CR-8)
- 설명: 독립 프로젝트 아래 사용자가 직접 쓰는 산출물(제목 + 마크다운 본문), 여러 개. 파일 업로드가 아니다(Storage 없음). **AI 근거 원본**이다. 관련 기능: F-P1-18, F-P2-04, NFR-AI-01 / 요청: ux D-6, ai 6·7, prd 5

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `project_id` | uuid | not null, 복합 FK `(project_id, user_id)` → `projects(id, user_id) on delete cascade` | **독립 프로젝트만**(insert·update 트리거가 부모의 소속 컬럼을 보고 `deliverable_requires_standalone_project`로 거부. 프로젝트는 소속 ↔ 독립 전환이 없으므로 이 검사로 충분) |
| `title` | text | not null, 공백 아님, ≤ 100자 | 목록 한 줄. AI 명세 제안 200자 대신 화면 명세 100자 `[가정]` |
| `body` | text | not null default `''`, ≤ 20,000자 | 마크다운 원문. AI에는 앞부분만 들어간다(AI C-1.1: 산출물당 정규화 6,000자, 팩 전체 15,000자 `[가정]`) |
| `sort_order` | smallint | not null, `unique (project_id, sort_order)` 지연 검사 | 새 행은 마지막(최댓값 + 1) |

- 공통 컬럼(`id`, `user_id`, `created_at`, `updated_at`). `unique (id, user_id)`. **상태 컬럼 없음**(부모 프로젝트 `complete`가 팩 포함 조건).
- 개수 상한: 프로젝트당 **50개** `[가정]`(PRD F-P1-18 (3) "제한 없음, 남용 방지 상한은 구현 시"). insert 트리거가 `deliverable_limit_reached`로 거부.
- RLS 4개 동작 본인(사용자 세션). `app_ai_writer` select. 인덱스 `(project_id, sort_order)`, `(user_id)`.
- 트리거: `updated_at`, `profiles.career_data_updated_at` 갱신, 근거 원본 삭제 표시(2.8). 부모 프로젝트의 `status`·`content_updated_at`은 건드리지 않는다(산출물은 완료 조건이 아님).
- 순서 변경: RPC `reorder_project_deliverables(project_id, ordered_ids uuid[])`(security invoker, 지연 unique로 한 트랜잭션) `[가정]` — 화면에 순서 변경 UI가 없으면 쓰지 않는다.
- **v4.5 (PA-1·PA-2·PA-3)**
  - **분류 컬럼 없음 (PA-2, 확정 2026-11-03 (사용자))**: 산출물에는 `project_type`·`experience_type`·`competencies`를 두지 않는다. 분류는 부모가 아니라 **소속 프로젝트**에만 있다(독립 프로젝트에도 없음, DM-20). 변경 없음.
  - **만들기·고치기 = `save_project_deliverable`** (S-44 "저장하기", 2.5.1): 제목 + 본문을 한 번에. 새 행은 `sort_order` 맨 뒤(기존 insert 트리거), 50개 상한(`deliverable_limit_reached`)도 같은 트리거.
  - **`unique (id, project_id, user_id)` 추가 ★**: 산출물 대화의 복합 FK `(project_deliverable_id, project_id, user_id)`가 참조한다(2.5). 이 FK 때문에 대화가 있는 산출물의 `project_id`는 바꿀 수 없다(화면에 이동 기능도 없음).
  - **AI 작성 대화**: 산출물마다 대화 여러 개(`writing_chats.project_deliverable_id`, 2.5). 산출물을 지우면 대화도 함께 지워진다(FK cascade, F-COM-04).
  - **`source_writing_chat_id`는 두지 않는다** (AI DA-13 선택 요청 거절): 읽는 화면이 없고(카드의 "반영됨"은 `structured_draft`에, 마지막 반영 시각은 `writing_chats.last_applied_at`에 있음), 두면 산출물 ↔ 대화 사이 FK가 양방향이 되어 대화 삭제의 `set null`이 산출물 행을 update한다. 산출물 `updated_at`은 이미 `title`·`body`가 바뀔 때만 오르므로(구현 그대로) 기대 버전으로 쓸 수 있다.

#### skills / project_skills (v4.4 범위 축소, CR-10)
- 컬럼은 v2와 같다(부록 A.4).
- **`project_skills`는 독립 프로젝트에만 단다**(화면 "사용 기술"). insert 트리거가 소속 프로젝트면 `project_skill_requires_standalone_project`로 거부. 경력·교육 안 프로젝트에는 사용 기술이 없다(PRD F-P1-05, Q-CR-2 → CR-18 확정).
- `skills`는 독립 프로젝트 사용 기술의 자동완성 사전 겸 전체 스킬 목록이다. 직접 추가(`is_manual = true`)는 유지하되 화면 진입점은 S-12 `[보류]`(UX). 고아 태그 스킬 자동 삭제 규칙은 그대로.

### 2.4 커리어 목록 (연도 보기, v4.4 CR-4 — D-22 개정) — 저장하지 않는다

- 연도는 **컬럼·테이블로 저장하지 않는다.** 화면이 읽을 때 앱에서 계산한다(뷰·RPC 없음, UX D-14 회신).
  - 목록 항목 = **경력, 교육, 독립 프로젝트**. 각 항목은 **`start_month`의 연도 밑에 한 번만** 나온다(CR-4). 연도 밑에 소속 프로젝트 행은 없다(소속 프로젝트는 경력·교육 상세의 카드).
  - 같은 연도 안은 `start_month` 최신순, 같으면 `created_at` 최신순 `[가정]`.
  - 경력·교육은 화면이 처음 저장할 때 시작월을 받는다(UX P-3 `[가정]`). 그래도 `draft` 행에 `start_month`가 없거나, **독립 프로젝트에 시작월이 없으면 맨 아래 "연도 미정"** 묶음(PRD F-P1-09 (3) `[가정]`).
  - v3의 "경력·교육은 활동한 모든 연도에", "독립 프로젝트는 그 해의 '기타 프로젝트' 묶음"은 폐기(T-2 대체, CR-7).
- 화면 응답 모양(앱 타입, DB 아님): `{ entity_type: 'experience' | 'education' | 'project', id, name, start_month }`(UX `career_list` 가정과 같음). `name` = `company_name` / **교육 표시 이름**(v4.8, ED-2 — trim한 `program_name`, 비면 trim한 `institution_name`, 둘 다 비면 null → 화면 "이름 없는 교육". 이전 `institution_name`) / `projects.name`.
- 지원 장치: 기존 `(user_id, start_month desc)` 인덱스 + 독립 프로젝트 부분 인덱스(2.3). 사용자당 수십 행이라 한 번에 읽어 메모리에서 묶는다.
- 접힘 상태·선택 항목은 URL·브라우저 저장(UX), DB 없음.

### 2.5 AI 작성 대화 (v4.5 개정 — 산출물 대화·페이지 저장, F-P1-13, F-P1-18, CR-5·CR-6, PA-1·PA-3)

#### writing_chats
- 설명: AI와 대화하며 커리어 항목을 채우는 세션. **대상은 두 가지**(v4.5, PA-1): ① **소속 프로젝트 1건의 STAR**(프로젝트 상세 S-10 패널, AI 명세 AI-12) ② **산출물 1건의 본문**(산출물 상세 S-44 패널, AI-13). 모든 대화는 대상에 묶이고, 대상마다 여러 개다. 관련 기능: F-P1-13, F-P1-18, F-P1-06, F-AP-06 / 요청: ux D-8~D-11·DM-3~DM-9, ai 9·DA-1~DA-17, prd 7·(v4.6) 1~3

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `project_id` | uuid | **v4.4: not null**, 복합 FK → `projects on delete cascade` | **v4.5**: 대화가 속한 프로젝트. STAR 대화 = 대상 소속 프로젝트, 산출물 대화 = **그 산출물의 부모 독립 프로젝트**(목록·연쇄 삭제·소유 검사용). 프로젝트를 지우면 대화도 삭제(NFR-PRV-06) |
| **`project_deliverable_id`** | uuid | **v4.5 신설**, null, 복합 FK `(project_deliverable_id, project_id, user_id)` → `project_deliverables(id, project_id, user_id) on delete cascade` | 산출물 대화의 대상 산출물(PA-1). null이면 STAR 대화. FK가 "산출물은 같은 프로젝트·같은 사용자"를 보장하고, 산출물을 지우면 대화도 지워진다(F-COM-04) |
| **`title`** | text | **v4.4 신설**, null, ≤ 100자 | 대화 기록 목록 제목. **첫 사용자 메시지가 들어올 때 `append_writing_chat_message`가 앞 30자(연속 공백 1칸)로 채운다**(AI 호출 없음) `[가정]`. null이면 화면이 "새 대화"로 보인다. 사용자 이름 바꾸기는 없다 |
| `status` | text | **v4.4**: not null default `active`, **CHECK in (`active`, `closed`)** | 진행 중 / **상한 도달로 끝남**(열람·반영만). 아래 전이 |
| `structured_draft` | jsonb | not null default `'{}'` | 대화별 **제안**(아래 v3 형식). 반영 전에는 커리어 데이터가 아니며 팩에 들어가지 않는다 |
| `message_count` | smallint | not null default 0, `CHECK (message_count BETWEEN 0 AND 40)` | 사용자 + AI 메시지 합계, 시작 인사 제외(A5, 변경 없음) |
| `last_extracted_sequence` | smallint | not null default 0 | 변경 없음(v4.2) |
| `last_activity_at` | timestamptz | not null default now() | 대화 기록 목록 정렬(최근 활동순) |
| **`last_applied_at`** | timestamptz | **v4.4 신설**, null | 이 대화의 제안을 마지막으로 반영한 시각. **v4.5: 반영이 저장된 시각**(페이지 저장 RPC가 기록, 폼에 채운 시각이 아님) |
| `return_target` | jsonb | null, **v4.5: `CHECK (project_deliverable_id IS NULL OR return_target IS NULL)`** | v3.2 그대로(U-5). 게이트에서 패널 새 대화를 열 때 저장, 복귀하면 비움. 산출물 대화는 게이트 진입이 없어 항상 null(AI-13) |

- **대상 규칙 (v4.5, PA-1 — AI DA-1·UX DM-5)**:
  - **대상은 정확히 하나**: `project_deliverable_id`가 있으면 산출물, 없으면 프로젝트. 둘 다 없는 대화는 `project_id` not null로 생기지 않는다. 리더가 제안한 "프로젝트 / 산출물 중 하나만 채우는 배타 CHECK" 대신 **`project_id`를 늘 채우고 산출물 열을 더하는 모양**을 골랐다. 이유: ① 기존 `project_id` not null·인덱스·턴 파이프라인·삭제 집계를 그대로 쓴다(산출물 대화도 프로젝트 단위로 연쇄 삭제된다). ② 복합 FK 하나로 "산출물이 그 프로젝트의 것"을 DB가 보장한다(배타 모양이면 산출물 → 프로젝트를 트리거로 따라가야 함). ③ 독립 프로젝트에는 STAR 대화가 없으므로 한 프로젝트의 대화는 모두 STAR 대화이거나 모두 산출물 대화다 — S-10 목록 `where project_id = ?`가 그대로 맞다.
  - **트리거 `writing_chats_check_target`** (v4.4 `writing_chat_requires_affiliated_project` 대체, insert 시 ★): `project_deliverable_id`가 null이면 `project_id`가 **소속 프로젝트**여야 한다(아니면 `writing_chat_requires_affiliated_project`, v4.4 코드 유지). null이 아니면 FK가 같은 프로젝트를 보장하고, 산출물은 독립 프로젝트에만 있으므로(`deliverable_requires_standalone_project`) 부모는 자동으로 독립 프로젝트다. 대상 열(`project_id`·`project_deliverable_id`)은 update로 바꿀 수 없다(가드 트리거, 사용자 세션 grant 없음).
  - 독립 프로젝트 정보·내용(S-43, `projects.description`)의 대화는 여전히 없다(CR-19 남는 부분, AI D-AI-16 **확정 2026-11-03 (사용자): (a) MVP에 없음 유지** — 권고 (a) 유지). 생기면 대상 키가 하나 더 필요하다.
- **v4.4 삭제**: `mode`(`new_project` / `augment_project` — 모드는 하나), `experience_id`·`education_id`(소속은 프로젝트에 있음), `saved_at`, `status`의 `saved`·`handed_off`·`abandoned`, `structured_draft.affiliation_suggestion`. 프로젝트에 묶이지 않은 대화가 없어져 **90일 자동 삭제(D-DM-08)와 크론도 폐기**(3.4).
- **상태 전이 (v4.4)**:

  | 전이 | 주체 | 조건 |
  |------|------|------|
  | `active → closed` | definer RPC(`finish_assistant_message`, 또는 실패로 닫는 턴 정리) | 사용자 메시지를 더 받을 수 없게 된 때(`message_count > 38`이고 살아 있는 턴이 없음). 마지막 응답이 40번째가 되는 정상 경로에서는 그 응답 완료 시점 |

  - 되돌리는 전이는 없다. 사용자는 `status`를 직접 바꾸지 않는다(v4.2의 사용자 세션 `status` update 권한 회수).
  - **그만두기·재개 없음**: v4.2 A6의 `abandoned → active`는 대상이 없어 폐기(PRD 9.3 A6 "CR-5·CR-6으로 흡수"). `active` 대화는 대화 기록에서 언제든 다시 열어 이어 간다. 이어서 보내면 `message_count`가 누적된다.
  - `closed` 대화는 열람·제안 수정·수락/거절·반영만 된다. 화면은 "새 대화에서 이어 하기"를 권한다(새 행).
- **`structured_draft` v3 형식** (AI 명세 v4.5 AI-12 매핑 채택, 출처는 메시지 UUID):

```json
{
  "schema_version": 3,
  "project": {
    "start_month": { "value": "2023-03", "origin": "ai", "source_message_ids": ["uuid"], "source_quotes": ["23년 3월부터"], "review": "ok", "reviewed_at": null, "applied_at": null }
  },
  "star": {
    "action": { "value": "결제 승인 API의 병목 쿼리를 APM으로 찾아 인덱스를 재설계했다", "op": "set", "origin": "ai", "source_message_ids": ["uuid"], "source_quotes": ["…"], "review": "ok", "reviewed_at": null, "applied_at": null },
    "result": { "value": "결제 승인 API 응답 시간이 1.2초에서 0.7초로 줄었다", "op": "append", "origin": "ai", "source_message_ids": ["uuid"], "source_quotes": ["…"], "review": "needs_review", "reviewed_at": null, "applied_at": null }
  },
  "classification": {
    "experience_type": { "value": "problem_solving", "origin": "ai", "source_message_ids": ["uuid"], "reason": "장애 원인을 찾아 해결한 과정이 중심이에요", "review": "ok", "reviewed_at": null, "applied_at": null },
    "competencies": { "value": ["analysis", "execution"], "origin": "ai", "source_message_ids": ["uuid"], "reason": null, "review": "ok", "reviewed_at": null, "applied_at": null }
  },
  "clarifications": [ { "kind": "actor_ambiguous", "field": "action" } ],
  "sensitive_flags_count": 0
}
```
  - 키: `project`는 `start_month`·`end_month`만(**`is_current`는 AI가 제안하지 않는다** — 사용자가 S-10 기간 입력(페이지 저장)에서만 정한다, R-CR-15. v4.5 R-PA-9: 섹션 편집 → 페이지 저장), `star`는 `situation`·`task`·`action`·`result`·`learnings`, **`classification`은 `project_type`·`experience_type`·`competencies`**(v4.4 후속 CR-20). **필드 키 = 저장 대상 `projects` 컬럼명.** 이름·소속·`role`·스킬은 제안하지 않는다(UX A-3).
  - **분류 추천 (CR-20, 확정 2026-11-02 (사용자))**: AI가 대화 내용을 바탕으로 분류를 **추천**하고, 사용자가 반영해야 저장된다. 분류는 사실 근거가 아니다(AI C-1.2).
    - 필드 객체: `value`(`project_type`·`experience_type` = 키 문자열 1개, `competencies` = 키 배열 1~3개, 중복 없음), `origin`(`ai` / `user_edit`), `source_message_ids`(선택 — 판단의 실마리가 된 사용자 발화, 비어도 됨), **`reason`**(text null, ≤ 200자 `[가정]` — 추천 이유 한 줄, 카드에 표시, R-CR-14), `review` = `ok`(V-9e 대상 아님, `needs_review` 없음), `reviewed_at`, `applied_at`. **`op`는 두지 않는다**(채우기 하나뿐). `source_quotes`는 두지 않는다. AI 출력 키는 `classification_suggestions`(AI 명세), 저장 경로는 `structured_draft.classification.{…}`.
    - **값 검증**(AI V-9i의 DB 방어): `apply_structured_draft_patch`가 CHECK 값 목록 밖의 키를 **버린다**(`competencies`는 원소 단위로 걸러 내고 앞 3개까지). 남는 값이 없으면 그 필드 패치를 거부한다.
    - **빈 값만 추천 (리더 결정, AI 명세 `[가정]` 채택)**: AI는 프로젝트 값이 비어 있는 분류만 추천한다 — `project_type`/`experience_type`은 null일 때, `competencies`는 **사용자가 하나도 고르지 않았을 때**(`'{}'`)만. 바꾸기 제안은 없다. **v4.5 (PA-3)**: "비어 있음"은 **`form_snapshot` 기준으로 서버 앱 계층이 판정**한다. DB는 저장 전 폼을 모르므로 `apply_structured_draft_patch`는 DB 값이 있다는 이유로 분류 패치를 **거부하지 않는다**(v4.4 `classification_already_set` 거부 삭제 ★). 채우기 단계(화면)가 "이미 고른 값이 있어요"로 한 번 더 막는다. 사용자가 카드에서 직접 고친 값(`origin = 'user_edit'`)은 AI가 덮어쓰지 않는다(STAR와 같음).
  - 필드 객체: `value`, **`op`**(STAR만, `set` = 빈 필드에 넣을 값 / `append` = 현재 값 뒤에 붙일 **새 문장만**), `origin`(`ai` / `user_edit`), `source_message_ids`(uuid[], `role = 'user'` 메시지만, V-9a), `source_quotes`, `review`(`ok` / `needs_review` / `accepted`, v3.2와 같은 의미), `reviewed_at`, **`applied_at`**(v4.4, 반영 시각. null = 아직 반영 안 됨. **v4.5: "저장하기" 성공 때 `save_project_page`가 기록** — 폼에 채우기만 한 상태는 DB에 없다), **`rev`**(v4.5 신설 ★, 아래).
  - **`rev` (v4.5, AI DA-8)**: 정수, 1부터. **필드 키(슬롯) 단위로 단조 증가**한다 — `apply_structured_draft_patch`가 그 슬롯의 `value`를 바꿀 때마다(AI 패치, 사용자 직접 수정, 거절로 값 비움) +1, 슬롯을 **새 필드 객체로 바꿀 때도 이전 `rev` + 1**(1로 되돌리지 않는다 — 되돌리면 저장 때 보낸 옛 `rev`가 새 객체와 우연히 같아질 수 있음). `review`만 바뀌는 수락(`needs_review → accepted`)은 `rev`를 올리지 않는다. 화면은 [반영]으로 폼에 채운 시점의 `rev`를 기억해 저장 때 보낸다(2.5.1). `schema_version`은 3 그대로 두고, `rev`가 없는 기존 필드 객체는 1로 읽는다(마이그레이션이 채워도 됨).
  - 화면이 "기존 값 + 덧붙일 문장 강조"를 그릴 때: `op = 'append'`면 `value` 전체가 강조 부분이다. 현재 값은 `projects`에서 읽는다(UX A-3 회신).
  - **채운 뒤 들어온 AI 패치 (v4.5, AI DA-10)**: 서버 앱 계층이 "미반영 필드 객체의 `value`가 이번 턴 `form_snapshot`의 같은 필드에 (정규화 부분 문자열로) 이미 있다"고 판단하면 패치에 **`new_object: true`**를 단다. RPC는 그 슬롯을 **새 필드 객체로 바꾸고**(이전 객체는 버림, `rev` + 1) 이어 붙이지 않는다 — 이미 폼에 채운 문장이 카드에 다시 나와 두 번 채워지는 경로를 막는다. **같은 슬롯에 미반영 객체를 여러 개 두는 모양(배열·`star_prev`)은 두지 않는다**: 이전 객체의 내용은 이미 폼에 있고, 저장하면 그 반영 기록만 `proposal_changed`로 건너뛴다(저장은 성공, 데이터 손실 없음). `new_object`는 `app_ai_writer` 패치에서만 받는다.
  - `schema_version = 1`(v3) 행은 마이그레이션 때 비운다(`'{}'`) `[가정]` — 11장.
  - 민감정보로 걸러진 내용은 저장하지 않는다(개수만, NFR-PRV-05).
- **메시지 상한 규칙**: v4.2 A5 그대로(시작 인사 제외 40, 사용자 메시지는 `message_count ≤ 38`일 때만). 상한에 닿으면 위 전이로 `closed`.
- **`structured_draft`는 RPC로만 바꾼다** — `apply_structured_draft_patch(writing_chat_id, patch jsonb)` (v4.4 개정):
  - 호출 주체: AI 턴 = `app_ai_writer`, 사용자 수정·수락·거절 = 사용자 세션(행위자는 호출 역할로 판정, v3.2와 같음).
  - 공통: 행 잠금. **AI 패치는 `status = 'active'`만**, 사용자 패치는 `active`·`closed` 모두 `[가정]`(닫힌 대화도 검토·반영은 되므로).
  - AI 패치 규칙: `origin = 'user_edit'`이거나 `review = 'accepted'`이고 아직 반영 안 된 필드는 덮어쓰지 않는다. **`applied_at`이 있는 필드에 들어온 패치는 새 필드 객체로 바꾼다**(반영된 내용은 이미 프로젝트에 있으므로). 같은 필드의 미반영 제안이 있으면 `set`은 교체, `append`는 이어 붙인다(AI-12 매핑).
  - **V-9h (v4.5 완화 ★, AI DA-9)**: "이미 값이 있음"의 정본 판정은 **서버 앱 계층이 이번 턴 `form_snapshot`(없으면 DB 값)으로** 한다(AI 명세 AI-12 V-9h). DB RPC는 저장 전 편집을 모르므로 **거부하지 않고 낮추기만** 한다: DB `projects` 값이 있는 STAR 필드에 `op = 'set'`이 오면 `append`로 바꿔 저장한다(빈 필드의 `append`는 `set`으로 보는 규칙은 그대로). 기간·분류의 "비어 있을 때만"도 DB에서는 검사하지 않는다(v4.4 기간 거부·`classification_already_set` 거부 삭제). 최종 안전장치는 채우기 규칙(폼 값이 있으면 항상 덧붙임, 기간·분류는 빈 칸만 — 화면)이다. `project.is_current` 패치는 계속 거부한다(R-CR-15). 값 검증(STAR ≤ 2,000자, 기간 `YYYY-MM`, 분류 CHECK 목록 밖 키 버림)은 그대로.
  - 사용자 패치 규칙: 값 수정(→ `origin = 'user_edit'`, `review = 'ok'`, `op` 유지), `needs_review` → `accepted` / 거절(값 비움 + `ok`). **반영된 필드(`applied_at` 있음)는 사용자 패치도 거부**(`field_already_applied`) `[가정]` — 반영 뒤 고치기는 왼쪽 STAR 입력란에서(페이지 저장, PA-3. v4.5 R-PA-9).
- **대상별 패치 범위 (v4.5)**: STAR 대화에는 `project`·`star`·`classification`·`clarifications`·`sensitive_flags_count`만, 산출물 대화에는 아래 산출물 모양의 키만 받는다. 다른 대상의 키가 오면 `invalid_patch`(400).
- ~~**반영 RPC `apply_writing_chat_proposal`**~~ — **v4.5 폐기 ★** (PA-3, AI DA-7, UX DM-3). [반영]은 화면 폼 채우기(DB 호출 없음)이고, "반영됨" 기록은 페이지 저장 RPC 안의 내부 헬퍼가 한다(2.5.1, 3.3).

- v4: `usage_event_id` 없음(D-34). 대화의 토큰 사용은 `ai_usage_records.ai_job_id` → `ai_jobs`(`writing_chat_turn`, `target_id` = 대화)로 찾는다.
- **대화 시작 RPC (v4.5 ★, AI DA-2·UX DM-4·DM-9)**
  - **STAR 대화 `start_writing_chat(p_project_id uuid, p_return_target jsonb default null, p_form_snapshot jsonb default null)`**: v4.4 그대로 + `p_form_snapshot`(선택). 대상은 **이미 있는** 소속 프로젝트뿐이다. 시작 인사 4종(STAR 비어 있음 / 일부 / 다 채워짐 / 게이트 진입) 분기를 `p_form_snapshot.star`가 있으면 그 값으로, 없으면 DB 값으로 고른다. 스냅숏은 **저장하지 않는다**.
  - **산출물 대화 `start_deliverable_writing_chat(p_project_deliverable_id uuid, p_form_snapshot jsonb default null)`** (신설): 산출물 소유 확인 → `writing_chats` insert(`project_id` = 산출물의 부모, `project_deliverable_id`, `return_target` null, 빈 산출물 모양 `{schema_version: 1, target: 'project_deliverable', writing_kind: null, facts: [], deliverable: {}, clarifications: [], sensitive_flags_count: 0, draft_count: 0}`) + 고정 시작 인사 3종(본문 비고 종류 모름 / 제목으로 종류 짐작 / 본문 있음 — 본문 유무는 `p_form_snapshot.body` 우선, AI-13) + 민감정보 안내 줄(+ 무료 등급 안내). 제목 키워드로 짐작한 `writing_kind`를 빈 초안에 미리 넣는다 `[가정]`.
  - 둘 다 security definer + 소유 검사, `authenticated`만 execute, 활성 키 확인만(v4.4와 같음). 반환 `{ writing_chat_id, greeting_message }`(v4.4 반환 모양 유지).
  - **"새 대상"을 받아 행까지 만드는 모양(AI 제안 `p_target = {kind: 'new_project' | 'new_project_deliverable', …}`)은 두지 않는다.** 리더 정렬 2(UX D-UX-25 (a))에 따라 첫 AI 메시지는 **먼저 페이지를 저장해 행을 만든다** — 행 생성은 페이지 저장 RPC 하나로만 일어나고, 시작 RPC는 있는 행에 대화만 붙인다. 첫 메시지 순서는 7장.
- **쓰기 주체 요약 (v4.5)**: 대화 시작(`start_writing_chat` / `start_deliverable_writing_chat`), 사용자 메시지 추가(+ `title` 채움), assistant 메시지 시작·완료(+ `closed` 전이), 정리 완료 표시, `message_count`·`last_activity_at`은 **소유 검사 security definer RPC**로만. 사용자 세션 직접 update는 **`return_target`만**. `structured_draft`는 `apply_structured_draft_patch`와 **페이지 저장 RPC의 내부 헬퍼 `private.wc_mark_proposal_applied`**(`applied_at`·`applied_mode`·`applied_rev`, 2.5.1)만. **폐기 RPC**: `save_writing_chat`, `hand_off_writing_chat`, `set_writing_chat_affiliation`, `purge_unlinked_writing_chats`, **`apply_writing_chat_proposal`(v4.5)**.
- RLS: select/delete 본인. insert·update는 위 RPC와 `return_target`만. `service_role`은 select·delete(탈퇴).
- 죽은 스트리밍 턴: v4.2와 같다.
- 인덱스 (v4.4): **`(project_id, last_activity_at desc)`**(S-10 패널 대화 기록 목록), `(user_id) where status = 'active'`. v3 `(user_id, project_id)`와 미연결 정리용 `writing_chats_unlinked_last_activity_idx`는 삭제. **v4.5 ★**: `(project_deliverable_id, last_activity_at desc) where project_deliverable_id is not null`(S-44 대화 기록 목록, FK cascade 삭제도 이 인덱스를 쓴다).
- 프로젝트·산출물당 대화 개수 상한은 두지 않는다 `[가정]`.
- **메시지 상한·상태 (v4.5)**: 산출물 대화도 같은 규칙이다 — 시작 인사 제외 40(`message_count`, A5), 초안 턴의 고정 문구 AI 메시지도 센다(AI DA-17), `active → closed`만. `closed` 산출물 대화는 열람·초안 [빼기]·반영(폼 채우기)·저장 때 반영됨 기록이 된다.

#### writing_chat_messages

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `writing_chat_id` | uuid | 복합 FK → `writing_chats on delete cascade` | |
| `sequence` | smallint | not null, `unique (writing_chat_id, sequence)` | 화면 "내 답변 #n"은 사용자 메시지만 다시 번호 매김 |
| `role` | text | not null, CHECK in (`user`, `assistant`) | |
| `content` | text | not null, ≤ 4,000자 `[가정]` | |
| `status` | text | not null default `done`, CHECK in (`streaming`, `done`, `failed`) | AI 응답 실패 턴 "다시 보내기" |
| `ai_job_id` | uuid | null (soft) | assistant 메시지를 만든 턴 작업. 시작 인사(고정 문구)는 null — 메시지 상한에서 빠지는 행(A5) |

- 공통 컬럼 중 `updated_at`은 streaming → done 전환에만 쓰인다.
- RLS: select 본인. user 메시지 insert는 RPC `append_writing_chat_message`(security definer + 소유 검사, 상한 검사 + `message_count` 증가 + **첫 사용자 메시지면 `title` 채움**을 한 트랜잭션). **`closed` 대화에는 `writing_chat_closed`로 거부**(v4.4). assistant 메시지 insert/update는 `app_ai_writer`가 부르는 definer RPC(`begin_assistant_message` / `finish_assistant_message`). 직접 insert/update·개별 delete 없음(대화 삭제로만).
- 시작 인사 문구: 모드별 2종 → **STAR 상태별 4종(비어 있음 / 일부 / 다 채워짐 / 게이트 진입) + 무료 등급이면 서비스 개선 사용 안내 1문장**(AI 명세 AI-12 초안, 최종 문구 UX) `[가정]`. 고정 상수이며 `ai_job_id` null.

### 2.5.0 산출물 대화의 `structured_draft` (v4.5 신설, AI-13 — AI DA-11·DA-12·DA-14)

AI 명세 v4.6 AI-13 "저장" 모양을 채택한다. STAR 대화 모양(`schema_version 3`)과는 **`target` 키와 대화의 `project_deliverable_id`로 구분**한다(둘이 어긋나면 RPC가 거부 — 빈 초안은 시작 RPC가 대상에 맞게 만든다).

```json
{
  "schema_version": 1,
  "target": "project_deliverable",
  "writing_kind": "retrospective",
  "facts": [
    { "id": "uuid", "slot": "contribution", "text": "결제 모듈의 장애 대응 런북을 직접 작성했다", "actor": "self",
      "source_message_ids": ["uuid"], "source_quotes": ["장애 대응 런북은 제가 직접 썼어요"],
      "review": "ok", "reviewed_at": null, "origin": "ai" }
  ],
  "deliverable": {
    "body": {
      "value": "## 내가 맡은 일\n\n결제 모듈의 …",
      "blocks": [ { "block_id": "b2", "type": "paragraph", "text": "…", "basis": "new",
                    "source_fact_ids": ["uuid"], "source_body_quotes": [], "source_project_fields": [], "review": "ok" } ],
      "rev": 2, "generated_at": "2026-11-03T10:00:00Z", "base_body_hash": "sha256:…", "replace_allowed": true,
      "missing_slots": ["went_wrong"], "dropped_block_count": 1,
      "applied_at": null, "applied_mode": null, "applied_rev": null
    }
  },
  "clarifications": [ { "kind": "number_vague", "slot": "went_well", "note": "…" } ],
  "sensitive_flags_count": 0,
  "draft_count": 2
}
```

- **키 (모두 AI 명세 이름 그대로)**
  - `writing_kind` ∈ `planning_summary` / `design_doc` / `retrospective` / `presentation` / `other`, null 허용(아직 모름). **`structured_draft` 안에만** 둔다 — `project_deliverables`에 컬럼을 두지 않는다(PA-2, DA-12). 질문·초안 구성을 고르는 대화 안 설정이지 분류가 아니다.
  - `facts[]`: `id`(uuid, 서버가 매김), `slot`(AI 명세 슬롯 키), `text`(≤ 500자 `[가정]`), `actor` ∈ `self`/`team`/`unknown`, `source_message_ids`(uuid[], `role = 'user'`만), `source_quotes`, `review` ∈ `ok`/`needs_review`/`accepted`, `reviewed_at`, `origin` ∈ `ai`/`user_edit`. 개수 ≤ 80 `[가정]`.
  - `deliverable.body`: 초안 **하나만** 둔다(이력 없음, AI 명세 "초안 이력은 남기지 않는다"). `value` = 서버가 `blocks`로 조립한 마크다운(≤ 8,000자, 초안 출력 상한), `blocks[]`(≤ 200 `[가정]`, `type` ∈ `heading`/`paragraph`/`bullet_list`/`numbered_list`/`table`/`quote`/`code`, `basis` ∈ `new`/`current_body`, 출처 3종, `review` ∈ `ok`/`needs_review`/`accepted`), `rev`(STAR와 같은 슬롯 단조 규칙), `generated_at`, `base_body_hash`, `replace_allowed`, `missing_slots`, `dropped_block_count`, **반영됨 기록** `applied_at`·`applied_mode`(`replace`/`append`)·`applied_rev`(저장 RPC만 씀). 초안이 아직 없으면 `deliverable = {}`.
  - `draft_count`: 이 대화에서 만든 초안 수(0~6). **6에 닿으면 `apply_structured_draft_patch`가 새 초안 패치를 `writing_chat_draft_limit_reached`(409)로 거부**한다(서버도 초안 턴 시작 전에 같은 값으로 미리 막는다, AI 7.4). 컬럼이 아니라 jsonb에 두는 이유: 이 값으로 조회·필터하는 화면이 없고, 초안 교체와 같은 행 잠금 안에서 함께 바뀌어야 한다.
- **패치 규칙 (`apply_structured_draft_patch`, 산출물 대화)**
  - AI(`app_ai_writer`): `facts` 추가(서버 검증 통과분), 초안 교체(`deliverable.body` 전체를 새 객체로 — `rev` + 1, `applied_*` null, `draft_count` + 1), **초안 없이 횟수만 세기**(V-10으로 내용 블록이 하나도 안 남은 경우 — AI 명세 "초안 횟수는 셈"), `writing_kind`·`clarifications`·`sensitive_flags_count` 갱신. `status = 'active'`만.
  - 사용자 세션: 사실 수락/거절(`needs_review → accepted` / 값 비움), 블록 [빼기](블록 삭제 + `value` 다시 조립 → `rev` + 1), 블록 `needs_review` 수락(`rev` 그대로). **초안 전체 거절(비우기)은 패치 경로에 없다** — 검토는 블록마다 수락 / [빼기]로만 한다(리더 판정 2026-11-03, AI-13·S-44). **블록 문장 직접 수정은 받지 않는다**(UX-12 확인 — 반영 후 본문 폼에서 고침). `active`·`closed` 모두.
  - 반영된 초안(`applied_at` 있음)에 대한 사용자 패치는 `field_already_applied`로 거부(STAR와 같음). 새 AI 초안은 반영 여부와 관계없이 교체한다(반영된 내용은 이미 산출물에 있음).
  - 출처는 `evidence_links`에 넣지 않는다(DM-15, AI-13). 저장된 본문은 다른 기능에서 `project_deliverable` 근거 원본이 된다(2.8, 변경 없음).

### 2.5.1 페이지 저장 RPC (v4.5 신설 ★, PA-3, DM-21)

> S-10 프로젝트 상세·S-44 산출물 상세의 상단 바 **"저장하기"** 한 번 = RPC 한 번. 만들기와 고치기를 같은 RPC로 하고, 화면이 이번 방문에서 [반영]으로 폼에 채운 제안의 **"반영됨" 기록을 같은 트랜잭션에서** 남긴다. 요청: AI DA-3~DA-7, UX DM-1~DM-3·DM-6·DM-8, PRD 요청 2·3.

**공통 규칙**

| 항목 | 규칙 |
|------|------|
| 실행 주체 | **security invoker**(커리어 쓰기는 사용자 RLS), `authenticated`만 execute. 반영됨 기록은 내부 definer 헬퍼 `private.wc_mark_proposal_applied`(외부 execute 없음). **키·동의·활성 공급자를 보지 않는다**(AI 호출 없음 — 키가 없거나 무효여도 저장·반영됨 기록 가능) |
| 만들기 / 고치기 | 대상 id 인자가 null이면 만들기, 있으면 고치기. 고치기 대상이 없거나 남의 행이면 `not_found`(404) |
| 기대 버전 (UX DM-8) | `p_expected_updated_at timestamptz default null`. 고치기에서 값이 있고 행의 `updated_at`과 다르면 **아무것도 쓰지 않고** `stale_write`(409, details `{current_updated_at}`). null이면 덮어쓴다(화면 "내 내용으로 저장"은 이 인자 없이 다시 보낸다). 만들기에서는 무시. 기준 컬럼은 `updated_at`(프로젝트는 `source_writing_chat_id`만 바뀌면 오르지 않음, 산출물은 제목·본문이 바뀔 때만 오름 — 2.3) |
| 반영됨 기록 | `p_applied_proposals jsonb default null` — 배열, 최대 50개 `[가정]`. **커리어 값을 쓴 뒤** 원소마다 하위 트랜잭션(PL/pgSQL 예외 블록)에서 기록한다. **기록 실패는 저장을 막지 않는다**(리더 정렬 3): 실패한 원소는 `skipped`에 사유와 함께 돌려주고 커리어 저장은 커밋된다. 모양이 틀린 원소도 거부하지 않고 `skipped`(`invalid_entry`) |
| `skipped[].reason` (AI DA-6) | `not_found`(대화·필드 없음, 대화가 이 대상의 것이 아님) / `already_applied`(이미 `applied_at` 있음 — 다른 탭 등) / `proposal_changed`(보낸 `rev` ≠ 현재 `rev` — 채운 뒤 AI 턴·직접 수정·새 초안) / `needs_review`(필드 `review = 'needs_review'`. 산출물은 **채울 수 있는 내용 블록(`ok`·`accepted`)이 하나도 없음** — 수락하지 않은 `needs_review` 블록이 남아 있는 것만으로는 건너뛰지 않는다. 그 블록은 채우기 결과에서 이미 빠졌기 때문이다(3.3, 리더 판정 2026-11-03). 반영 뒤 남은 블록 수락은 `field_already_applied`로 거부) / `invalid_entry`(모양 오류) / `mark_failed`(그 밖의 예외). 판정 순서도 이 순서. v4.4의 `empty`·`period_already_set`·`classification_already_set`·`field_too_long`은 **화면 채우기 단계의 판정 이름**으로만 남는다(RPC는 돌려주지 않음) |
| 기록 내용 | 필드 객체 `applied_at = now()`(산출물은 + `applied_mode`·`applied_rev`), 대화 `last_applied_at`·`last_activity_at = now()`. 대화 `status`는 `active`·`closed` 모두 허용. "반영됨"은 "제안을 폼에 받아 저장했다"는 기록이며, 채운 뒤 사용자가 폼에서 값을 고쳐 저장해도 기록한다(값 일치를 검사하지 않음 — AI-12) |
| 잠금 순서 `[가정]` | 대상 행(`projects` 또는 `project_deliverables`, `for update`) → 대화 행(`writing_chats`, id 순). 턴 처리(`apply_structured_draft_patch`)는 대화 행만 잠그고 커리어 행을 잠그지 않으므로 교착이 없다. v4.4 "대화 → 프로젝트" 순서는 반영 RPC와 함께 폐기 |
| 반환 | 성공 200. `applied: [...]`, `skipped: [...]`는 기록 대상이 없으면 빈 배열 |
| 로그 | 입력 값·대화 원문을 로그에 남기지 않는다(NFR-PRV-09). 거부 코드·필드 이름만 |

**`save_project_page(p_project_id uuid, p_values jsonb, p_expected_updated_at timestamptz default null, p_applied_proposals jsonb default null)`** — S-10

- `p_values` 허용 키(이 밖의 키는 `invalid_fields` 400): `name`, `experience_id`, `education_id`, `start_month`, `end_month`(`'YYYY-MM'` 또는 null), `is_current`, `project_type`, `experience_type`, `competencies`(키 배열), `situation`, `task`, `action`, `result`, `learnings`. **키가 없으면 기존 값 유지**(만들기면 null·기본값), 값이 null이면 비운다. 화면은 페이지 전체를 보낸다.
- **만들기** (`p_project_id` null, UX DM-1): `name`과 소속(`experience_id` 또는 `education_id` 중 정확히 하나, 같은 사용자 행)이 필수. 소속이 없거나 둘 다면 `project_affiliation_required`(400). `status`는 트리거가 계산(대부분 `draft`). 독립 프로젝트는 이 RPC로 만들지 않는다(S-43 경로).
- **고치기** (UX DM-2): 대상이 **소속 프로젝트**여야 한다(독립 프로젝트면 `project_not_affiliated` 400 — S-43은 섹션 저장). **소속 변경**(D-UX-30)은 `experience_id`/`education_id`를 함께 보내 경력 ↔ 교육 사이로만(둘 다 null이면 v4.4 트리거가 `project_scope_change_not_allowed`).
- 값 검사(거부 코드, 모두 400, 아무것도 쓰지 않음): 이름 공백 → `project_name_required`, 이름 100자·STAR 2,000자 초과 → `field_too_long`(details `{field}`), 월 형식 오류·`end_month < start_month`·`is_current = true`인데 `end_month` 있음 → `invalid_period`(details `{field}`), 분류 키가 목록 밖·역량 3개 초과·중복 → `invalid_classification`(details `{field}`). DB CHECK가 같은 것을 다시 지킨다.
- `p_applied_proposals` 원소: `{writing_chat_id, field, rev}`. `field` ∈ `situation`·`task`·`action`·`result`·`learnings`·`start_month`·`end_month`·`project_type`·`experience_type`·`competencies`(v4.4 `p_fields` 허용 값과 같음, `is_current` 없음 — AI DA-5). 대화는 `project_id` = 이 프로젝트이고 `project_deliverable_id`가 null이어야 한다(아니면 `not_found`). 만들기 요청에도 올 수 있다(첫 메시지 뒤 대화가 생긴 다음 저장 — 이미 만든 행을 고치는 요청이 됨).
- 기록에 성공한 원소가 있으면 마지막 원소의 대화로 `projects.source_writing_chat_id`를 쓴다(`updated_at`은 그대로).
- 반환: `{ project_id, status, updated_at, applied: [{writing_chat_id, field}], skipped: [{writing_chat_id, field, reason}] }`. 화면은 `updated_at`을 다음 저장의 기대 버전으로 쓰고, 복귀 대상이 있으면 `get_data_readiness()`를 다시 부른다(6장).

**`save_project_deliverable(p_project_deliverable_id uuid, p_project_id uuid, p_title text, p_body text, p_expected_updated_at timestamptz default null, p_applied_proposals jsonb default null)`** — S-44

- **만들기** (`p_project_deliverable_id` null, UX DM-6): `p_project_id` 필수(독립 프로젝트만 — `deliverable_requires_standalone_project`, 50개 — `deliverable_limit_reached`, 기존 insert 트리거). `sort_order`는 맨 뒤.
- **고치기**: `p_project_id`는 null이거나 그 산출물의 부모와 같아야 한다(다르면 `not_found`). 산출물을 다른 프로젝트로 옮기는 경로는 없다.
- 값 검사: 제목 공백 → `deliverable_title_required`(400), 제목 100자·본문 20,000자 초과 → `field_too_long`(details `{field}`).
- `p_applied_proposals` 원소: `{writing_chat_id, rev, mode}`, `mode` ∈ `replace`/`append`(대상은 `deliverable.body` 하나라 `field`는 없다). 대화는 `project_deliverable_id` = 이 산출물이어야 한다. 한 저장에 여러 대화의 초안을 차례로 채웠으면 원소가 여러 개다.
- 반환: `{ project_deliverable_id, project_id, sort_order, updated_at, applied: [{writing_chat_id}], skipped: [{writing_chat_id, reason}] }`.

**거부 코드 (v4.5 신설)**: `stale_write`(409), `project_name_required`, `project_affiliation_required`, `project_not_affiliated`, `deliverable_title_required`, `invalid_period`, `invalid_classification`, `invalid_fields`, `invalid_patch`, `invalid_form_snapshot`(턴 요청, 이상 400), `writing_chat_draft_limit_reached`(409, 2.5.0). 기존 코드 재사용: `not_found`, `field_too_long`, `project_scope_change_not_allowed`, `deliverable_limit_reached`, `deliverable_requires_standalone_project`, `writing_chat_requires_affiliated_project`, `field_already_applied`.

**`form_snapshot` (AI DA-15·UX UX-6, 저장하지 않음)**: 대화 턴 요청 본문의 일시 입력이다(7장). **DB 컬럼·테이블이 없고 로그에도 남기지 않는다.** S-10 = `{name, start_month, end_month, is_current, project_type, experience_type, competencies, star: {situation, task, action, result, learnings}}`, S-44 = `{title, body}`. 서버는 DB 상한과 같은 길이(이름·제목 100자, STAR 2,000자, 본문 20,000자)와 형식만 검사하고 넘으면 턴을 `invalid_form_snapshot`(400)으로 거부한다 `[가정]`. AI는 스냅숏 값을 저장된 값보다 우선해 읽는다(리더 정렬 2). 스냅숏이 없으면 DB 값.

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
  5. 반환: 새 상태 + `interview_prompt`(`to_stage`가 `job_interview`/`culture_fit_interview`이고 **실제로 이동했을 때만**, `{interview_type, in_progress_session_id, in_progress_session}`) — C-14 팝업용. **AI 호출·사용량 없음.**
     - **v4.2 (구현 반영)**: `in_progress_session` = `{session_id, interview_type, answered_count, question_count, generation_status, last_activity_at}` 또는 null. 작성 중 세션은 유형과 무관하게 지원 프로젝트당 1개라 옮긴 열 유형과 다를 수 있다(UX C-14 반영 대상).
  - `closed → closed` + outcome은 1단계대로 아무것도 하지 않는다(결과 기록은 `set_application_outcome`).
- **RPC `set_application_outcome(application_project_id, outcome)`**: `stage = 'closed'`일 때만, `outcome_changed` 이벤트.

#### job_descriptions / jd_requirements (v2와 같음 + v4 변경)
- **v4 키 없는 JD (D-30)**: 키 없이 만들면 `extraction_status = 'pending'`(= 추출 전, 키 없음 포함), 이름은 사용자 입력(`name_source = 'user'`) 또는 기본 이름 "새 자기소개서 (날짜)"(`name_source = 'default'`, v4.4 후속 CR-23 — 이전 "새 기업 JD (날짜)"). 키를 연결한 뒤 그 JD의 첫 AI 기능(또는 "요건 정리하기")이 AI-01을 먼저 실행하고, `name_source`가 `default`면 AI 추출값으로 바꾼다(→ `ai`). 키 연결 시 기존 JD 일괄 추출은 하지 않는다.
- **v4 신설**: `job_descriptions.extraction_provider`, `extraction_model`(요건 탭 공급자 배지, `ai_jobs` 90일 정리 후에도 유지).
- **v4.2 (구현 반영)**
  - AI 쓰기 경로: `app_ai_writer`는 `application_projects`·`job_descriptions`·`jd_requirements`를 직접 update하지 않고 `begin_jd_extraction` / `apply_jd_extraction` / `fail_jd_extraction`(security definer + 소유 검사)만 부른다. `application_projects`는 컬럼 단위로 읽고 `memo`는 읽지 못한다(메모는 AI 입력 아님 `[가정]`).
  - 기본 이름: **"새 자기소개서 (YYYY-MM-DD)"**(v4.4 후속 CR-23, 화면 표기 변경에 맞춤 `[가정]` — 이전 "새 기업 JD …". 이미 저장된 기본 이름은 바꾸지 않는다. 백엔드 후속 ★ 11장)(지원 프로젝트 생성일 KST, `name_source = 'default'`). 키 없이 회사명·포지션명을 둘 다 입력했으면 "회사명 – 포지션명"(`user`, 앞 100자). 추출 실패 때도 `fail_jd_extraction`이 같은 규칙으로 null 이름을 채운다 `[가정]`.
  - `jd_extraction` 작업이 성공하지 못하고 끝나면(멈춤 처리 포함) 트리거가 그 작업으로 `running`인 JD를 `failed`로 바꾸고 대체 이름을 넣는다.
  - 길이 상한(4.5) `[가정]`.

#### 2.6.1 입력 원인 실패 JD의 공고 원문 수정 (v4.3, 확정 2026-10-30 (사용자, Q53-2) ★)

U-6·D-19 "JD 필수·교체 불가"의 유일한 예외다. 그 밖의 경우(추출 전, 요건이 있는 추출 성공, 공급자·키·시스템 원인 실패)에는 원문을 바꿀 수 없다. 키가 없어도 된다(AI 호출 없음, D-30).

**RPC**

```
update_failed_jd_raw_text(
  p_application_project_id uuid,
  p_raw_text text,
  p_raw_text_hash text,
  p_sentences jsonb
) returns jsonb  -- {application_project_id, job_description_id, extraction_status: 'pending', raw_text_edited_at, ai_run_allowed}
```

- security definer, `search_path = ''`, 소유 검사는 `auth.uid()`. 사용자 세션에서 Server Action이 부른다. 문장 분할(`splitJdSentences`)과 해시는 `create_application_project`와 같은 서버 코드로 만든다.
- 권한: `public`·`anon` revoke, **`authenticated`만 execute**. `app_ai_writer`·`service_role` execute 없음. 테이블 권한은 그대로다(`job_descriptions` 사용자 update grant 없음).
- 잠금 순서: `application_projects` → `job_descriptions`(다른 JD 쓰기 RPC와 같음). 그 아래에서 조건을 판정한다.
- 저장과 재추출은 별도 요청이다. RPC는 AI를 부르지 않고, 재추출은 기존 `POST /api/application-projects/{id}/jd-extraction`이다(게이트는 2.11.7 경로 ⑤).

**허용 조건 (모두 만족)**

| # | 조건 | 어기면 |
|---|------|--------|
| 1 | 같은 지원 프로젝트에 `queued`/`running` `ai_jobs`가 없다(유형 무관). 인사이트·면접의 `prepare` 선행 추출도 여기서 막힌다 | `jd_job_in_progress` |
| 2 | `extraction_status = 'failed'`. `running`인데 그 작업이 이미 `failed`로 끝난 행도 실패로 본다(읽기 규칙과 같음, 트리거가 `skip locked`로 건너뛴 경우). **또는 `extraction_status = 'succeeded'`(조건 3과 함께 요건 0개, 확정 2026-11-01 (사용자, Q53-11))** | `jd_raw_text_locked` |
| 3 | `jd_requirements` 0행(`origin` 무관) | `jd_raw_text_locked` |
| 4 | **실패 행에만 적용(`succeeded`는 건너뜀).** `extraction_job_id`의 작업이 `job_type = 'jd_extraction'`, `status = 'failed'`, `error_code in ('not_a_jd', 'input_too_long', 'safety_blocked')`. 원인은 **가장 최근 추출 실행**의 값이다 | `jd_failure_not_input` |
| 5 | 이 원문으로 만든 결과가 없다: `insights.status = 'ready'` 0행, `interview_questions` 0행, `draft_sections.ai_content` 있는 행 0행, `evidence_links.source_type in ('jd_requirement', 'jd_sentence')` 0행 | `jd_has_results` |
| 6 | 원문이 지금 값과 다르다 `[가정]` | `jd_raw_text_unchanged` |

- 조건 5는 실패 행에서는 방어용이다. 인사이트·서류·질문 생성은 모두 `extraction_status = 'succeeded'`를 요구하므로 실패 행에는 문장을 참조하는 AI 결과가 없다(UX S-15 "지우거나 다시 만들 AI 결과가 없다" 확인). **`succeeded` + 요건 0개 행은 뒤 기능이 돌았을 수 있어 이 조건이 실제로 막는다**(Q53-11).
- **`succeeded` + 요건 0개는 AI-01 정상 경로에서 생기지 않는 안전망이다**(AI-01: 요건 0개면 `not_a_jd` 또는 `schema_invalid`로 실패). 수정 저장으로만 `succeeded`가 `pending`으로 돌아가고, 저장 전 재추출은 `begin_jd_extraction`이 그대로 거부한다.
- 조건 1은 UX S-15 ③(요건 추출·인사이트·면접 질문 생성)보다 넓게 쓰여 있지만, 서류 작업은 추출 성공을 요구하므로 이 상태에서 실제 차이는 없다.
- `insufficient_data`는 제외한다. 커리어 데이터 부족이라 원문과 무관하고 AI-01이 내지도 않는다(C-09로 간다, Q53-9).
- **`ai_jobs` 90일 정리 뒤** `extraction_job_id`가 null이면 원인을 알 수 없어 `jd_failure_not_input`이다 `[가정]`. "요건 정리하기"를 다시 실행해 같은 원인이 나오면 수정할 수 있다. 원인을 JD 행에 복사하는 컬럼은 두지 않았다.

**거부 코드** (판정 순서대로. `P0001`, 앞에서 걸리면 뒤는 보지 않는다. `ai_jobs.error_code` 값이 아닌 API 응답 코드)

| 코드 | HTTP | 뜻 |
|------|------|-----|
| `not_authenticated` | 401 | 세션 없음(`42501`) |
| `invalid_raw_text` / `invalid_raw_text_hash` / `invalid_sentences` | 400 `[가정]` | `create_application_project`와 같은 검사(공백뿐, 50,000자 초과 등) |
| `job_description_not_found` | 404 `not_found` | 없음 또는 다른 사용자 |
| `jd_job_in_progress` | 409 | 조건 1 |
| `jd_raw_text_locked` | 409 | 조건 2·3. 수정한 뒤 재추출 전(`pending`)도 여기 걸린다 `[가정]` |
| `jd_failure_not_input` | 409 | 조건 4 |
| `jd_has_results` | 409 | 조건 5 |
| `jd_raw_text_unchanged` | 409 | 조건 6 |

**바꾸는 값** (한 트랜잭션)

| 대상 | 값 |
|------|-----|
| `raw_text`, `raw_text_hash`, `sentences` | 인자 값 |
| `detected_language`, `extraction`, `tech_keywords`, `requirements_hash` | null |
| `extraction_status` | `'pending'` |
| `extraction_job_id`, `extraction_provider`, `extraction_model` | null. 지난 실패가 현재 상태로 읽히지 않게 한다 |
| `company_name`·`position_title` | 출처가 `ai`면 값과 출처를 함께 null, **`user`면 유지** |
| **`raw_text_edited_at`** (v4.3 신설) | `now()` |
| `application_projects.last_activity_at` | `now()`. `name`·`name_source`는 그대로다(`default`면 재추출 성공 때 AI 값으로 바뀜, 2.6) |

- 이전 원문은 보관하지 않는다(덮어씀) `[가정]`. 전형 이력(`application_stage_events`)에도 남기지 않는다 `[가정]`.
- 끝난 `ai_jobs`·`ai_usage_records`는 바꾸지 않는다(토큰은 이미 썼다).
- 수정 횟수 제한은 없다. 다시 고치려면 그 사이에 재추출 실패가 필요하다.

**이미 묶인 행** — 조건에서 제외하지 않는다. 선행 추출 실패로 생긴 실패 행이 있는 JD가 바로 Q53-9가 S-15로 보내는 대상이기 때문이다.

| 대상 | 처리 |
|------|------|
| 실패한 `insight` 작업·`insights` 행 | 그대로 둔다. 다음 "다시 생성"이 새 행을 만든다 |
| `interview_sessions`(`generation_status = 'failed'`, 질문 0개) | 그대로 둔다. `in_progress` 세션은 지원 프로젝트당 1개라 새 세션은 `interview_in_progress`로 막힌다. S-20 **"그만두고 새로 시작"**으로 이어 간다(2.7.1) |
| `composing`·`failed` 초안(`drafts`, `draft_sections`) | 그대로 둔다. 자소서 문항은 사용자 입력이고 JD 문장을 담지 않는다. 다음 생성이 새 요건을 읽는다 |
| 같은 행 다시 시도가 가능한 예전 실패 작업(공급자 원인 등) | 그대로 둔다. 추출 실패로 끝난 작업에는 `prepare` 출력이 없어 다시 돌면 새 원문으로 추출한다 |

- **지난 실패 표시**: 작업의 `finished_at < job_descriptions.raw_text_edited_at`이면 그 실패는 지난 원문의 것이므로 `lastFailure`로 내리지 않는다(S-16 인사이트, S-33·S-37 질문 생성). 그 뒤의 빈 상태·버튼은 UX 담당.

**`input_hash`와의 관계** — 해시·재사용 규칙은 바꾸지 않고, RPC도 `input_hash`를 건드리지 않는다.
- AI-01은 `input_hash`를 쓰지 않는다(구현 `null`, `begin_jd_extraction`이 `succeeded`를 거부하는 것으로 충분). 그래서 재추출이 지난 결과로 재사용될 일이 없다.
- 뒤 기능의 `input_hash`는 `requirements_hash`를 포함하고 재사용 대상은 성공·`ready` 행뿐이다. 조건 5로 그런 행이 없고 `requirements_hash`는 null로 돌아가므로, 옛 원문의 결과가 재사용될 수 없다.
- `requirements_hash`에 원문이 들어가지 않아도(AI-01) 문제없다. 수정이 일어나는 시점에 비교할 이전 해시가 없다.

**백엔드 후속 (★, 문서만 고쳤고 구현은 아직 없다)**
1. 마이그레이션: `job_descriptions.raw_text_edited_at` timestamptz null, RPC + grant. **`private.job_descriptions_guard` 트리거 완화**: 지금은 모든 역할의 `raw_text`·`raw_text_hash`·`sentences` 변경을 `job_description_immutable`로 막는다. `old.extraction_status in ('failed', 'running', 'succeeded')`(Q53-11), `new.extraction_status = 'pending'`, `raw_text_edited_at` 변경을 함께 만족할 때만 통과시킨다. `application_project_id`·`user_id`는 계속 불변.
2. **`ensureJdExtracted` 순서 변경**: 지금은 `begin_jd_extraction` 전에 `sentences`를 읽는다. 읽은 직후 수정이 끼어들면 옛 문장 결과가 새 원문에 저장되므로, **`begin` 성공 뒤에 읽는다**(그 뒤로는 조건 1·2가 수정을 막는다).
3. 조회: `getJdView`에 `rawTextEditedAt`과 `rawTextEditable`(조건 1~5와 같은 판정, 최종 판정은 RPC). 인사이트·면접 조회에 위 지난 실패 규칙. Server Action과 거부 코드 → 메시지 매핑(`src/server/db/errors.ts`).
4. pgTAP: 조건별 거부, 다른 사용자, `anon`·`app_ai_writer` execute 거부, 초기화 값, 가드 트리거(그 밖 경로의 원문 변경 거부).

### 2.7 인사이트·서류·면접 (v2와 같음, 변경분만)

| 테이블 | v3 변경 |
|--------|---------|
| insights | 없음 |
| drafts | 없음 (`options.included_*`에 `included_education_ids` 키 추가) |
| draft_sections | `section_kind` CHECK에 **`education`** 추가(경력기술서 교육 섹션, AI-03). `experience_id`(soft) 옆에 **`education_id`**(soft) 추가 |
| draft_section_sources | **`education_id`**(soft, 교육 소속 프로젝트·교육만 선택) 추가. ~~`project_detail_ids` uuid[]~~(**v4.4 삭제**, CR-2 — 프로젝트당 STAR 1개라 `project_id`로 충분, AI-04 `detail_refs` 폐기). CHECK: `num_nonnulls(experience_id, education_id, project_id) >= 1` 그리고 `num_nonnulls(experience_id, education_id) <= 1` |
| interview_sessions | **v4.1 신설**: `question_provider`, `question_model`(질문 일괄 생성 작업의 공급자·모델, 생성 성공 시 기록) / `evaluation_provider`, `evaluation_model`(채점 작업 공급자·모델, 채점 시작 시 기록). 질문 생성과 채점은 별도 작업이라 활성 공급자가 바뀌면 서로 다를 수 있다. **세션 목록 "실행 공급자" 열**: 채점이 시작된 세션은 `evaluation_provider`, 그 전(작성 중)은 `question_provider`를 보이고, 둘이 다르면 "질문 {question_provider} · 채점 {evaluation_provider}"로 둘 다 표시. 재채점은 `evaluation_*`를 덮어쓴다. 원천은 각 작업의 `ai_jobs.provider`(90일 뒤 정리되므로 세션에 복사) |
| interview_questions / answers / answer_evaluations / session_feedbacks | 없음 (F-ST-04 팝업은 세션을 만들지 않는다) |

**v4.2 변경 (2026-11-05)**

| 테이블 | 변경 |
|--------|------|
| drafts | `options.tone` 값 = **`concise`(간결) / `detailed`(상세)**. 화면 기본 선택은 `concise`(UX S-17). DB는 null을 허용하고 **null은 `concise`로 처리**한다 — 생성 프롬프트와 `input_hash`에서 null을 `concise`로 정규화해 "간결 선택"과 "값 없음"이 같은 출력·같은 해시가 되게 한다(리더 판단 2026-11-05, 리뷰 R-54. 정규화 위치는 `[가정]`). 그 밖 값은 저장하지 않는다(**확정 2026-11-05 (사용자), A17**). `options.selection_origin` 3값(`insight` / `ai_ranking` / `user`) 유지 — AI-11 기본 선택이 실패하면 대체 선택 없이 체크 없는 상태에서 사용자가 고르고 `user`로 저장(**확정 2026-11-05 (사용자), A23 ★**). `ai_ranking`이면 `options.ranking`은 그 지원 프로젝트에서 가장 최근 성공한 `draft_source_ranking` 작업 출력을 복사(지금 팩에 없는 프로젝트 제외) `[가정]`. 자소서 초안의 `provider`·`model`·`model_tier`·`connection_tier`·`prompt_version`은 **마지막으로 생성 완료된 문항** 값 `[가정]`. 자소서 초안 `status` 계산(4.5) |
| drafts / draft_sections | **저장하지 않는 AI 출력 (확정 2026-11-05 (사용자), A21)**: 경력기술서 `omitted`·`notes_for_user`, 자소서 `notes_for_user`·`char_adjust_needed`는 컬럼을 두지 않는다. 생성 직후 스트림(`validated`)으로만 화면에 간다. 글자 수 경고는 `draft_sections.validation_report.char_adjust_needed`에 남는다 |
| interview_sessions | **`question_validation_report`** jsonb null, **`question_usage`** jsonb null 신설 (**확정 2026-11-05 (사용자), A22 ★**) — 질문 세트 단위 검증 기록(구성 규칙 경고 `composition_relaxed`·`composition_unmet` 등)과 세트 생성 사용량 합계. 질문 세트 확정 RPC(`complete_interview_questions`)가 쓴다. 질문 행의 AI 메타는 그대로 질문마다 |
| interview_sessions | 내부 컬럼 `question_job_id`, `question_run_generation`, `evaluation_job_id`, `evaluation_run_generation`(작업 FK는 복합 `(…, user_id)` `on delete set null`). `data_sufficiency` **not null**(생성 RPC가 서버 판정값을 항상 넣음). 구현 반영 |
| interview_answers | 그만둔(`abandoned`) 세션의 답변은 미제출이어도 편집 불가(**확정 2026-11-05 (사용자), A8**, A.13) |

- 세션 목록 "실행 공급자"는 `interview_sessions.provider`가 아니라 위 v4.1 규칙(`evaluation_*` / `question_*` / 둘 다)이다(UX S-20 반영 대상).

- **v4.8 (ED-3) `draft_section_sources.source_label`** — 근거 선택("사용한 경력·프로젝트")의 저장 라벨. 원본이 지워져도 보이도록 저장 시점 이름을 남긴다.
  - 형식: 소속 프로젝트 = "부모 › 프로젝트", 경력·교육만 = "부모", 독립 프로젝트 = "프로젝트". 부모 = 경력 `company_name` / **교육 표시 이름**(2.3). 부모 이름이 null이면 프로젝트 이름만.
  - 쓰는 곳: 저장 RPC(S7·R4 자소서 근거 선택 저장)가 `coalesce(private.draft_source_label(...), payload 라벨)`로 넣는다. `private.draft_source_label`은 `private.draft_source_parent_name(p_user_id, p_experience_id, p_education_id)`을 부르고, 이 함수의 교육 분기가 v4.7부터 `private.education_display_name`이다(★ 구현됨).
  - 삭제 때: 프로젝트 삭제 트리거(`private.draft_sources_mark_project_deleted`)는 위 부모 이름 함수를 따르고, **교육 삭제 트리거 `private.draft_sources_mark_education_deleted`는 `old.institution_name` 대신 `education_display_name(old.program_name, old.institution_name)`**으로 라벨을 굳힌다(★ 구현됨). 둘 다 `source_deleted_at = now()`. 삭제 시점 교육 표시 이름이 null이면(교육 명·운영 기관 둘 다 공백) 교육 삭제 트리거는 프로젝트 소속 여부와 관계없이 **기존 `source_label`을 그대로 둔다**(`coalesce(..., s.source_label, ...)`) — 위 "형식"의 "부모 이름이 null이면 프로젝트 이름만"은 저장 시점 규칙이고 삭제 시점에는 적용하지 않는다(v4.8, ED-3).
  - 기존 행: 마이그레이션 `20261113000200`이 백필했다(행 삭제 없음, 멱등). 원본 교육이 살아 있는 행만 다시 계산 — 살아 있는 출처는 `draft_source_label` 값으로, 프로젝트만 삭제된 행은 라벨이 정확히 "<기관명> › "로 시작할 때만 "<표시 이름> › <나머지>"로. **원본 교육이 삭제된 행은 그대로**(삭제 시점 라벨). 표시 이름이 null이면(v4.8, ED-3): 교육만 있는 행은 기존 라벨 유지(`draft_source_label`이 null이라 덮어쓰지 않음), **프로젝트 소속 행은 저장 규칙대로 프로젝트 이름만**으로 바뀐다(`concat_ws(' › ', 부모, 프로젝트)`에서 부모가 빠짐), 프로젝트만 삭제된 행은 그대로. 경력 소속·독립 프로젝트 행은 대상 아님. 백필 함수 `private.backfill_education_display_labels()`는 운영자 전용으로 남긴다(실행 권한 어떤 역할에도 주지 않음, 재실행은 postgres로만).
- **v4.4**: `draft_section_sources.project_detail_ids`와 그 원소 삭제 트리거(`draft_sources_remove_project_detail`)는 폐기. `source_deleted_at`은 프로젝트·경력·교육 삭제 때 기록한다(변경 없음). 독립 프로젝트의 산출물은 근거 선택 단위가 아니다 — 문항에서 독립 프로젝트를 고르면 그 산출물이 함께 팩에 들어간다(AI C-1.1 "선택된 독립 프로젝트의 산출물만").

#### 2.7.1 UI v5.3 QA 결정의 데이터 영향 (v4.3)

| 결정 | 데이터 변경 | 내용 |
|------|-------------|------|
| **Q53-1 (S-14 만들기 전 게이트)** | **`create_application_project` 거부 추가 ★** | 아래 |
| **Q53-3 (입력 원인 채점 실패)** | **`answer_evaluations.error_code` 신설 ★** | 아래 |
| **Q53-5 (종합만 실패)** | 컬럼 없음, **서버 분기 ★** | 아래 |
| Q53-6 (S-37 메뉴) | 없음 | `status`와 `answer_evaluations.status`로 읽는다. 세션 목록 조회에 집계만 더한다. 입력 원인을 빼는 데는 Q53-3 컬럼을 쓴다 |
| **Q53-7 (S-19 중단)** | **`drafts` CHECK 완화, 중단 처리 ★** | 아래 |
| Q53-4 · Q53-8 · Q53-9 | 없음 | 화면 흐름·문구. Q53-9의 "원문을 고칠 수 있는 곳"은 2.6.1 |
| S-20 실패 세션과 새 면접 (UX v5.4 요청) | 없음 | 아래 |
| **Q53-10 (입력 원인 실패 세션의 새 결과 표식)** | 컬럼 없음, **`mark_interview_result_viewed` 조건 변경 ★** | 아래 |

**Q53-1 — 생성 RPC 게이트** (만들기 전에 막는 것은 확정 2026-10-30 (사용자, Q53-1). 서버 검사와 코드는 `[가정]`)
- `create_application_project`가 insert **전에** 활성 공급자를 판정한다. 활성 공급자 없음 → 통과(추출 없이 저장, D-30) / 키 `invalid` → **`key_invalid`** / `private.ai_consent_allows_run` 거짓 → **`ai_consent_required`**. `needs_check`는 통과한다. 둘 다 HTTP 409이고 행을 만들지 않는다(2.11.7 경로 ⑥).
- 순서: 인자 검사 → 같은 `p_id` 기존 행 확인(있으면 지금처럼 `created: false`, 게이트 안 봄) → 게이트 → insert. 같은 `p_id`로 동의 뒤 다시 보내면 그대로 만들어진다.
- 화면은 `get_data_readiness().ai_connection`으로 먼저 막고, RPC는 그 사이 상태가 바뀐 경우의 방어다. 통과 뒤 추출 단계에서 상태가 바뀌면 기존 경로 ⑤대로 실패하고 JD는 남는다.

**Q53-5 — 종합만 다시 정리** (답변 재호출 없음은 확정 2026-10-30 (사용자, Q53-5). 경로는 `[가정]`)
- **새 작업 경로만 쓴다**: `POST /api/interview-sessions/{id}/evaluation/retry` → 새 `interview_evaluation` 작업 → `begin_interview_evaluation`. 평가 대상이 0개라 `evaluate`는 공급자 호출 없이 끝나고 종합만 다시 만든다(구현도 대상 0이면 호출 없음). 화면 진행은 `evaluate`를 건너뛴다. 답변 평가의 공급자 메타는 그대로이고 `session_feedbacks`·`evaluation_provider`·`evaluation_model`만 활성 값이 된다(A9와 같이 공급자가 섞일 수 있음).
- **2.9.1과의 충돌 해소**: 같은 행 다시 시도에서 공급자가 다르면 R-63이 답변 평가를 전부 다시 연다. 그래서 **다시 채점 대상이 0개인 세션의 `interview_evaluation` 작업은 같은 행 다시 시도를 `ai_job_not_retryable`로 거부**한다(공급자가 같아도). R-63 규칙 자체는 바꾸지 않는다. S-22는 원래 같은 행 경로를 쓰지 않으므로 직접 호출 방어다.
- 종합의 입력 원인은 `interview_sessions.evaluation_job_id` 작업의 `error_code`로 읽는다(이 상태에서 작업 실패 원인은 종합의 것). 작업이 90일 정리로 없으면 입력 원인이 아닌 것으로 본다.

**Q53-7 — 경력기술서 중단** (블록 없이 이전 상태로는 확정 2026-10-30 (사용자, Q53-7). 저장 방식은 `[가정]`)
- 이전 블록은 이미 보존된다. 블록은 `complete_career_description`(`validated`)에서만 저장하고, 다시 생성은 새 행이라 기존 초안의 블록·편집본·상태·`generation_no`는 건드리지 않는다.
- 지금 구현은 취소된 작업의 초안을 `failed`로 만든다(`ai_jobs_release_drafts`, 실행기의 `fail_career_description`). 이것을 바꾼다. 작업이 `canceled`이거나 `cancel_requested_at`이 있으면:

  | 경우 | 처리 |
  |------|------|
  | 다시 생성(`regenerated_from_id` 있음) | 새 초안 행을 삭제(문항·근거 연쇄). 기존 초안이 그대로 보인다 |
  | 첫 생성(`regenerated_from_id` 없음) | `status = 'composing'`, `options` 유지(포함 항목·문체 복원용), 문항 행 삭제, `ai_job_id`·AI 메타 null |

- `drafts_type_status_check`에 경력기술서 `composing`을 추가한다. 경력기술서 `composing` 행은 지원 프로젝트당 1개이고, `begin_career_description`이 새 초안을 만들 때 그 프로젝트의 `composing` 경력기술서 행을 같은 트랜잭션에서 지운다.
- `validated`가 먼저면 완료다(`generating`일 때만 위 처리). 조회의 "`generating`인데 작업이 끝남 → 실패" 규칙도 작업이 `canceled`면 위와 같이 본다. 다른 이유의 취소(커리어 항목 삭제, 동의 철회)도 같은 처리다.
- 쓴 토큰의 `ai_usage_records`는 남는다. 자소서 문항 중단은 이번 결정 범위 밖이라 그대로다(`ai_content`는 완료 때만 덮어씀).

**S-20 실패 세션과 새 면접** `[가정]`
- `unique (application_project_id) where status = 'in_progress'`는 유지한다. 푸는 경로는 **기존 RPC 두 번**: `abandon_interview_session` → `create_interview_session`(S-20 "그만두고 새로 시작"). 실패 세션의 답변은 비어 있고(생성 완료 전에는 편집 불가) 잃을 내용이 없으므로 새 RPC로 묶지 않는다. 뒤 호출이 게이트로 실패해도 잃는 것이 없다.
- 이 버튼은 실효 `generation_status = 'failed'`(`generating`인데 작업이 끝난 행 포함)에서만 보인다. 일부 질문이 저장된 뒤 실패한 세션도 그만둘 수 있고 답변은 비어 있다. 그만둔 세션은 S-37 "그만둔 면접" 묶음에 남고, 질문이 없으면 질문 없는 행으로 남는다.

**`answer_evaluations.error_code`** (text null, `ai_jobs.error_code`와 같은 CHECK, 확정 2026-10-30 (사용자, Q53-3)의 저장 근거 `[가정]`)
- 왜 필요한가: 지금 답변별 실패 원인은 `ai_jobs.step_outputs`(사용자 select 없음, 90일 정리)에만 있다. 일부 답변만 실패하면 작업은 `succeeded`(`error_code` null)로 끝나고, 전부 실패하면 첫 답변의 원인만 작업에 남는다. 그래서 작업 행으로는 Q53-3을 판정할 수 없다.
- 쓰기: `fail_answer_evaluation(p_answer_id, p_ai_job_id, p_error_code)`(인자 추가). `save_answer_evaluation` 성공과 R-63 다시 열기(`pending`)가 null로 비운다. 기존 행과 원인 없는 실패는 null이며 **다시 채점 대상**으로 본다(소급 없음).
- **입력 원인 답변**(`failed` + `error_code in ('input_too_long', 'safety_blocked')`)은 제출 뒤 고칠 수 없어 같은 입력이면 같은 원인으로 실패한다. `begin_interview_evaluation`의 평가 대상에서 뺀다 `[가정]`.
- `다시 채점 대상` = 제출 답변 중 평가 성공이 없고 입력 원인도 아닌 답변.
- **거부 코드 `interview_evaluation_input_only`** (HTTP 409, `[가정]`): 남은 실패가 입력 원인뿐이라 다시 할 것이 없을 때. 다시 채점 라우트가 작업을 만들기 전에 내고, `begin_interview_evaluation`도 같은 코드로 거부한다. 응답 details에 원인(`input_too_long`/`safety_blocked`)을 넣는다. 실패가 아예 없을 때의 기존 코드(라우트 `interview_evaluation_not_retryable`, RPC `interview_evaluation_not_needed`)는 그대로다. 라우트의 `completed` 판정(`score_status = 'not_scored'`)도 입력 원인 답변을 빼야 한다.

| 세션 `status` | 조건 | 동작 (S-22, S-37 메뉴도 같음) |
|---------------|------|------------------------------|
| `evaluation_failed` | 다시 채점 대상 ≥ 1 | 다시 채점 |
| `evaluation_failed` | 대상 0, 평가 성공 ≥ 1, 종합 실패가 입력 원인 아님 | **"종합 평가 다시 정리"**(Q53-5) |
| `evaluation_failed` | 대상 0, 평가 성공 ≥ 1, 종합 실패가 입력 원인 | 버튼 없음, 원인 + 새 면접(Q53-3). 서버 `interview_evaluation_input_only` |
| `evaluation_failed` | 대상 0, 평가 성공 0 | 버튼 없음, 원인 + "이 자기소개서로 새 면접 시작"(Q53-3, CR-23). 서버 `interview_evaluation_input_only` |
| `completed` | 다시 채점 대상 ≥ 1 | "실패한 답변 다시 채점"(Q53-6) |
| `completed` | 대상 0, 입력 원인 답변 ≥ 1 | 버튼 없음, 그 답변에 원인 표시(메뉴도 숨김, UX S-22·S-37). 서버 `interview_evaluation_input_only` |

**Q53-10 — 새 결과 표식** (확정 2026-10-30 (사용자, Q53-10))
- 위 표에서 **`evaluation_failed`이고 서버 판정이 `interview_evaluation_input_only`인 두 행**(다시 채점 대상 0이고 다시 정리할 종합도 없음)은 **첫 열람에 `result_viewed_at`을 기록**해 "새 결과" 표식을 지운다. 다시 할 수 있는 것이 없어 표식이 삭제 전까지 남기 때문이다.
- 다시 채점 대상이 있거나 "종합 평가 다시 정리"가 가능한 `evaluation_failed` 세션은 A9 그대로 열어도 표식이 남는다. 판정을 내릴 수 없는 경우(`error_code` null, 작업 정리 뒤 종합 원인 모름)는 위 규칙대로 다시 할 수 있는 쪽으로 보므로 표식도 남는다.
- **`mark_interview_result_viewed` 허용 조건**: `status = 'completed'` 또는 (`status = 'evaluation_failed'` + 위 판정). 그 밖은 지금처럼 오류 없이 `changed: false`. `completed`인데 입력 원인 답변만 남은 행은 원래 `completed` 규칙으로 지워진다.
- 판정은 `begin_interview_evaluation`·다시 채점 라우트·세션 조회·이 RPC가 **같은 헬퍼**를 쓴다 `[가정]`(이름은 구현이 정함).
- 다시 채점 시작 때 `result_viewed_at`을 비우는 규칙(A9)은 그대로다.
- **백엔드 후속 ★**: 위 RPC 조건 변경과 판정 헬퍼, 세션 조회(`read.ts` `getInterviewResult`의 `row.status === "completed"` 검사)가 이 세션에도 열람 RPC를 부르게 하기, `canRetryEvaluation`도 같은 판정으로 바꾸기, pgTAP(입력 원인 세션 기록, 다시 채점 가능 세션 `changed: false`). L-01 배지·S-20 목록은 같은 컬럼을 읽으므로 따로 고치지 않는다.

### 2.8 근거 (evidence_links)

| 항목 | v4.4 (CR-2·CR-8·CR-10·CR-11) |
|------|----|
| `source_type` | CHECK → `profile`, `experience`, `education`, `project`, **`project_deliverable`**(v4.4 신설), `skill`, `jd_requirement`, `jd_sentence`, `interview_answer`, `user_note`. **v4.4 삭제**: `project_detail`, `achievement` |
| `source_field` — `project` | 공통 `name`, `period` / **소속 프로젝트** `situation`, `task`, `action`, `result`, `learnings` / **독립 프로젝트** `role`, `description`. **v4.4 삭제**: `team_size`, `summary`. 분류 3종(`project_type`·`experience_type`·`competencies`)과 `link_url`은 허용값이 아니다(AI C-1.2). insert 트리거가 프로젝트 종류와 필드가 맞지 않으면(소속에 `role`/`description`, 독립에 STAR) `invalid_evidence_source`로 거부 `[가정]`(AI V-2의 DB 방어) |
| `source_field` — `project_deliverable` | `title`, `body` |
| `source_field` — 그 밖 | `education`: `institution_name`, `program_name`, `education_type`, `enrollment_status`, `period`, `description` (변경 없음) |
| `source_locator` — `project_deliverable` | `body`면 **원문 마크다운의 `{start, end}`**(JS UTF-16 오프셋). 모델은 정규화 평문으로 인용하고 서버가 정규화 오프셋 지도로 원문 구간을 계산해 넣는다(AI C-1.1). 화면 S-44가 이 구간을 강조한다(UX A-7 — 구간 단위는 문자 범위). `title`이면 null |
| 회고 근거 표시 | 별도 플래그 컬럼 없음. **v4.4: `source_type = 'project' AND source_field = 'learnings'`**이면 화면이 **"배운 점"** 칩으로 표시(CR-2). V-8 검사는 저장 전에 끝난다 |
| `source_snapshot_at` | `project`는 **`projects.content_updated_at`**(v4.4, 근거 필드가 바뀔 때만 갱신 — 분류·Link만 고쳐서는 "변경됨"이 되지 않음). 필드 단위는 아니어서 다른 STAR 필드 수정도 "변경됨"이 된다 `[가정]`(v3 상세 내용과 같은 한계). `project_deliverable`은 산출물 행의 `updated_at` |
| `writing_chat_message` | **넣지 않는다**(DM-15). 출처는 `structured_draft` 안에만 |
| `source_label` (v4.8, ED-3) | 근거 칩의 저장 시점 출처 이름(≤ 300자). 컨텍스트 팩 별칭의 label을 저장 RPC가 옮긴다. **`education` 근거 = 교육 표시 이름**(2.3, `EDU-n` 별칭의 저장 라벨 — 이전 `institution_name` 원문). 둘 다 비면 라벨 없음(null) — 화면 대체 문구 "이름 없는 교육"은 저장하지 않는다. 같은 `input_hash`로 재사용되는 이전 결과의 근거는 저장 당시 라벨을 그대로 가진다. 모델 입력은 바뀌지 않는다(ED-4). 기존 행은 마이그레이션 `20261113000200`이 백필: `source_type = 'education'`이고 원본 교육이 살아 있으며 표시 이름이 null이 아닌 행만 다시 계산, **원본이 삭제된 행은 그대로**, 행 삭제 없음. 다른 `source_type`(프로젝트 라벨은 부모 이름 없음)은 손대지 않는다 |

- 삭제 트리거(원본 삭제 표시) 대상 테이블: `profiles`(해당 없음), `experiences`, `educations`, `projects`, **`project_deliverables`**(v4.4), `skills`. `project_details`·`achievements`는 테이블과 함께 빠진다.
- 칩 라벨(UX C-01): `project` = "프로젝트 · {필드 표시명}", `project_deliverable` = "산출물 › {제목}".
- **v4.5: 근거 규칙 변경 없음.** 산출물 대화(AI-13)의 출처(사실·블록 출처)는 `structured_draft` 안에만 두고 `evidence_links`에 넣지 않는다(DM-15). 저장된 산출물 본문은 지금처럼 `project_deliverable` 근거 원본이며, 저장 RPC가 본문을 바꾸면 `updated_at`이 올라 기존 근거가 "변경됨"이 된다.

**v4.2 (구현 반영)** — v4.4에서 바뀐 부분 반영

| 항목 | 규칙 |
|------|------|
| 근거 저장 직전 원본 삭제 | 팩을 만든 뒤 저장 전에 원본이 지워지면 삭제 트리거가 이미 지나갔다. **insert 트리거**가 원본 행이 없으면 `quote = null`, `source_deleted_at = now()`로 저장한다("원본 삭제됨"). 다른 사용자·다른 지원 프로젝트 원본이면 `invalid_evidence_source`로 거부. v4.4: `project_deliverables`도 대상 |
| `user_note` | `source_id` = 메모가 있는 문항의 **`draft_sections.id`**. 같은 지원 프로젝트가 아니면 거부, 문항이 없으면 "원본 삭제됨". 인용은 저장 시점 문장 |
| `interview_answer` | `source_id` = **`interview_answers.id`**, 같은 지원 프로젝트의 답변만. **`source_field`는 null**(CHECK). 답변 삭제 시 "원본 삭제됨" 트리거. AI-06 등급·강점의 답변 인용도 이 근거 행으로 남는다(`criteria.<key>`, `strengths.<n>`) |
| `jd_sentence` | `source_locator {sid, start, end}`는 그 문장 범위 안의 부분 구간 허용(오프셋 JS UTF-16) |
| 소유자별 허용 출처 | **v4.4**: 인사이트 = 커리어 6종(`profile`, `experience`, `education`, `project`, `project_deliverable`, `skill`) + `jd_requirement`·`jd_sentence`. 경력기술서 = 커리어 6종만. 직무 면접 질문·경력기술서·`job_competency` 문항은 **`source_type = 'project' AND source_field = 'learnings'`** 근거를 RPC가 거부(V-8 DB 방어, v3 `project_detail.learnings`에서 변경) |
| 쓰기 주체 | **결과 저장 RPC 안에서만**(소유·세대 검사). `app_ai_writer`의 직접 INSERT 권한 없음(5장, A24) |
### 2.9 AI 작업·사용량 미터 (v4 BYOK)

> v4: 운영자 비용 통제 개념(`usage_events`의 예약·차감·해제, `usage_limits`의 무료 한도, 대화 월 한도)은 **삭제**했다(D-34). 남는 것은 사용자 화면의 **사용량 미터**(F-AI-07)를 위한 호출 단위 토큰 기록과 가격표다. 품질·안전 목적 제한(D-34 유지분)은 2.9.4.

#### 2.9.1 ai_jobs (v4 개정)

| 컬럼 | v4 변경 |
|------|---------|
| `job_type` | CHECK에 **`key_verification`** 추가(F-AI-01·02 확인 호출도 같은 실행·기록 경로). 전체: `jd_extraction`, `insight`, `career_description`, `draft_source_ranking`, `cover_letter`, `interview_questions`, `interview_evaluation`, `writing_chat_turn`, `key_verification`, (Should) `writing_assist`, `chat_reply` |
| `provider` | **신설**, not null, CHECK in (`openai`, `gemini`, `anthropic`). **실행 시작 시점의 활성 공급자**. 진행 중(`running`)에는 바뀌지 않는다(F-AI-03 (2): 공급자 변경은 다음 실행부터). 같은 행 다시 시도(`failed → queued`)는 다음 실행이므로 그 시점 활성 공급자로 갱신한다(2.9.1, **A1 변경**) |
| `model_tier` | **신설**, CHECK in (`light`, `default`, `heavy`) |
| `connection_tier` | **신설**, CHECK in (`free`, `paid`). 시작 시점 키의 등급. 무료면 순차 실행 경로(AI C-12) |
| `retry_count` | **v3 `attempt_count` 이름 변경**. 공급자 원인(1·6)과 시스템 원인 자동 재시도 합계 |
| `next_run_at` | **신설**, timestamptz null. 재시도·순차 단계의 다음 실행 예약 시각(스케줄러 내부용). 함수 안에서 기다리지 않는다(AI C-12) |
| `retry_wait_total_ms` | **v4.1a 신설**, integer not null default 0. 작업 전체의 재시도 대기 누적(ms). 함수 실행이 여러 번에 나뉘어도 합산되며, 120초(AI C-12 작업당 상한) 이상이면 더 재시도하지 않고 마지막 원인으로 종료 |
| `progress` | `{stage, done, total, waiting_retry_until}` — `waiting_retry_until`(신설 키)은 재시도 대기 중 화면 "한도 대기 중 n초"용 |
| `error_code` | CHECK 값 교체(AI C-11.1 + 아래 1개): 공급자 원인 `rate_limited`, `daily_quota_exhausted`, `billing_required`, `key_invalid`, `model_not_available`, `provider_unavailable`, `input_too_long`, `safety_blocked` / 키 상태 `key_missing`(**v4 신설**: 실행 중 키가 삭제되어 복호화할 키가 없음) / 시스템 `schema_invalid`, `timeout`, `stalled`, `canceled`, `insufficient_data`, `not_a_jd`. **삭제**: `model_unavailable`(→ `model_not_available`), `refused`(→ `safety_blocked`) |
| `error_category` | generated stored, **값 재정의**(AI C-11.1): `provider_limit`(rate_limited, daily_quota_exhausted) / `user_account`(billing_required, key_invalid, key_missing, model_not_available) / `transient`(provider_unavailable) / `input`(input_too_long, safety_blocked, insufficient_data, not_a_jd) / `system`(schema_invalid, timeout, stalled, canceled). 운영 실패율(PRD 6.6)은 `provider_limit`·`user_account`를 뺀다 |
| `failure_cause` | **신설, generated stored** — 화면 F-AI-08 7원인: `rate_limited` / `daily_quota_exhausted` / `billing_required` / `key_invalid` / `model_not_available` / `provider_unavailable` / `input_rejected`(input_too_long, safety_blocked). 그 외 코드는 null(시스템 원인 → ST-AI-FAILED 문구는 `error_category`) |
| `quota_resets_at` | **신설**, timestamptz null. `daily_quota_exhausted`일 때 공급자 일일 한도 초기화 시각(UTC 저장, 화면은 KST 변환, AI C-11.2 규칙) |
| `retry_after` | **신설**, timestamptz null. 최종 실패가 `rate_limited`·`provider_unavailable`일 때 사용자에게 안내할 "이 시각 이후 다시 시도" |
| `input_hash` | 재사용 해시에 **`provider`·`model` 포함**(C-6 v4). 인덱스 `(user_id, application_project_id, job_type, provider, input_hash) where status = 'succeeded'` |
| 키 | **작업 행에 키(원문·암호문)를 두지 않는다.** 실행 단계마다 2.11.2 경로로 받아 복호화(NFR-KEY-03) |
| `output` | v3과 같음(`draft_source_ranking` 전용) |
| `step_outputs` | **v4.2 (구현 반영)**, jsonb not null default `'{}'`. 단계 이름 → 완료된 단계 결과(AI C-6 "완료 단계 보존, 실패 단계부터 재실행"). `_meta`에 무료 등급 부분 결과(`partials`)·수동 재시도 대기 기준(`waitBase`, `retries`)을 둔다. `app_ai_writer`만 읽고 쓴다(사용자 select 권한 없음 — 검증 전 출력이 있을 수 있음). 보관은 작업과 같은 90일 |
| `run_generation` | **v4.2 (구현 반영)**, integer 내부 컬럼. 실행 세대. 수동 재시도·멈춤 처리 뒤 되살아난 이전 실행기가 결과를 덮어쓰지 못하게 한다. `retry_count`(재시도 횟수 누계, 화면·명세용)와 별개. 화면 노출 없음 |
| `target_type` | **v4.2 (구현 반영)** 값: `writing_chat`(`writing_chat_turn`, 이때 `application_project_id is null` CHECK), `application_project`(`insight`, `draft_source_ranking`), `job_description`(`jd_extraction`), `draft`(`career_description` — api가 먼저 만든 초안 id를 넣고 `begin_career_description`이 그 id로 초안을 만든다), `draft_section`(`cover_letter`), `interview_session`(`interview_questions`, `interview_evaluation`). `key_verification`의 대상은 키 행 `[가정]` |

- **동시 실행 1개 (D-34 유지)**: `unique (user_id, job_type, target_type, target_id) where status in ('queued','running')`. `insight`처럼 대상이 지원 프로젝트인 작업은 `target_type = 'application_project'`.
  - **v4.2**: 경력기술서 생성은 **지원 프로젝트당 진행 중 1개**를 별도 부분 unique 인덱스(`ai_jobs_career_description_in_flight_key`, `(user_id, application_project_id) where job_type = 'career_description' and status in ('queued','running')`)로 막는다. 위반은 API 409 `career_description_in_progress`.
- **상태 전이 (v4.2, 구현 반영)**: 트리거가 검사한다. `succeeded`·`canceled`는 종료(되돌릴 수 없음). `failed → queued`만 허용(수동 재시도 = 같은 행, `error_code`·`finished_at`을 비우고 `run_generation` 증가. `provider`·`model`·`model_tier`·`connection_tier`는 활성 값으로 갱신하고, 기록된 값과 다르면 `step_outputs`를 비우고 그 작업이 저장한 결과 행도 모두 다시 열며, 같으면 `step_outputs`를 유지하고 실패한 결과 행만 다시 연다 — 아래 A1 변경·R-63). 그 밖은 `invalid_ai_job_transition`.
- **"다시 시도"의 공급자 — 모든 다시 시도·재실행 = 활성 공급자 (v4.2, 확정 2026-11-05 (사용자, A1 변경))**: 같은 행 다시 시도를 포함해 **모든 재실행은 다시 시도를 누른 시점의 활성 공급자·등급으로 돈다.** 앞의 리뷰 R-48 리더 해석(같은 행 다시 시도 = 처음 공급자)은 폐기한다. 진행 중(`running`) 작업만 시작한 공급자로 끝까지 간다(공급자 변경은 다음 실행부터 — 다시 시도는 다음 실행이다).

  | 경우 | 해당 동작 | 작업 행 | 공급자·등급 |
  |------|-----------|---------|-------------|
  | (1) **같은 행 다시 시도** | 공용 라우트 `POST /api/ai-jobs/{id}/retry`(7장). 비동기 작업 `insight`, `interview_questions`, `interview_evaluation`의 `failed` 행(입력 원인 실패 제외 — 아래 R-69) | 같은 행 `failed → queued`(위 상태 전이). **`provider`·`model`·`model_tier`·`connection_tier`를 활성 값으로 갱신**. 활성 공급자·등급이 기록된 값과 **다르면 `step_outputs`를 비우고 처음 단계부터** 다시 실행하며, **그 작업이 이미 저장한 결과 행도 모두 다시 열어 새 결과로 덮어쓴다**(면접 질문·답변 평가·종합 등 — 한 결과가 두 공급자의 출력으로 섞이지 않게, 리뷰 R-63 리더 판단). **같으면 `step_outputs` 유지**(완료 단계 건너뜀)하고 **실패한 행만 다시 연다** — 리더 판단 | **현재 활성 공급자·등급**. 결과 행의 `provider`·`model`·`model_tier`·`connection_tier`와 `interview_sessions.question_*`/`evaluation_*`도 이 실행 값으로 기록(2.7). 거부 코드는 2.11.7 경로 ② |
  | (2) **새 작업 시작** | **인사이트 "다시 생성"**(F-P2-07, 새 `insight` 작업 행 + 새 `insights` 버전 행 `version_no + 1`, 성공하면 `is_latest`가 새 버전으로 옮겨 이전 인사이트를 대체하고 이전 버전 행은 남음 — A.8 버전 규칙, 리뷰 R-65), 요청 범위 작업(`jd_extraction`, 서류 3종 `draft_source_ranking`·`career_description`·`cover_letter`)의 다시 생성(같은 생성 라우트를 다시 부름), 면접 **"다시 채점"**·**"남은 질문 다시 만들기"**(begin RPC가 같은 세션을 다시 열고 새 `interview_evaluation`/`interview_questions` 작업, spec-gaps S8 ④), AI 작성 대화 "다시 보내기"(새 턴 작업) | 새 행(이전 실패 행은 그대로 남음) | **현재 활성 공급자·등급**. 결과 메타는 새 작업 값으로 기록(면접은 `evaluation_*`/`question_*`를 덮어씀, 2.7). 거부 코드는 인사이트 다시 생성·다시 채점·남은 질문 다시 만들기 = 2.11.7 경로 ①, 요청 범위 작업(요건 추출·서류 3종) = 경로 ⑤(리뷰 R-75) |

  - 두 경우 모두 공급자는 같다(활성). 차이는 작업 행을 새로 만드느냐, 같은 행을 다시 여느냐(`run_generation` 증가)뿐이다.
  - **같은 행 다시 시도 대상이 아닌 작업 (409 `ai_job_not_retryable`, 리뷰 R-69, 구현 42f7611과 같음)**: 경우 (1)의 공용 라우트는 아래 작업을 받지 않는다.
    - **요청 범위 작업 유형**: `jd_extraction`, `draft_source_ranking`, `career_description`, `cover_letter`, `key_verification`, `writing_chat_turn`(그리고 생산자가 아직 없는 Should 값 `writing_assist`·`chat_reply`). 각 생성 라우트를 다시 부른다(경우 (2)).
    - **입력 원인 실패**(`error_category = 'input'`): `input_too_long`, `safety_blocked`, `insufficient_data`, `not_a_jd`. 같은 입력으로 같은 행을 다시 돌리면 같은 원인으로 실패하므로, 입력을 고친 뒤 **새 실행**(인사이트 "다시 생성", 면접은 해당 실행 버튼 — 경우 (2))으로 간다. 고칠 입력이 공고 원문이면 2.6.1 RPC로 고친다(v4.3, Q53-2).
    - **다시 채점 대상이 0개인 세션의 `interview_evaluation` 작업**(v4.3 `[가정]`, Q53-5, 2.7.1): 종합만 다시 만들 때 R-63이 답변 평가를 다시 열지 않도록 새 작업 경로로만 간다. 작업 상태 응답의 다시 시도 미리보기(배지)도 이 작업에는 오지 않는다.
    - **`failed`가 아닌 종료 행**(`succeeded`·`canceled`)과 `error_code`가 없는 행, 결과 대상(인사이트의 지원 프로젝트·면접 세션)이 없어진 행.
    - `queued`/`running` 행은 거부하지 않고 그 작업을 따라간다(202 `inProgress: true`).
  - **경로 ② 전체 판정 순서**(구현 `retryJob`·`retry_ai_job` 기준, 2.11.7): 작업 없음 404 `not_found` → 작업이 진행 중이면 그 작업을 따라감(202 `inProgress`) → **`ai_job_not_retryable`(연결 게이트보다 먼저)** → `key_missing` → `key_invalid` → `ai_consent_required` → `ai_connection_changed` → 같은 대상의 다른 작업이 진행 중이면(진행 중 unique 위반) 그 작업을 따라감(202 `inProgress`). 경쟁으로 RPC가 행을 옮기지 못했으면(`requeued: false`) 그 사이 진행 중이 된 경우 따라가고, 아니면 `ai_job_not_retryable`.
  - **결과 행 다시 열기 — RPC 동작 (리뷰 R-63 리더 판단, R-70 구현 반영)**: 공급자·등급 비교와 결과 행 다시 열기는 **`retry_ai_job` 안에서** 작업 행 갱신(`failed → queued`)과 **같은 트랜잭션**으로 한다(잠금 순서 `application_projects` → `interview_sessions` → `ai_jobs`).
    - **다르면**(활성 공급자 또는 등급이 작업 행 값과 다름, `restarted = true`): 그 작업(`ai_job_id`)이 쓴 결과 행을 새 `run_generation`으로 바로 다시 연다. 다시 연 행에는 새 공급자 메타를 기록한다(다시 실패해도 새 공급자가 보임).
      - `insight`: 그 작업의 `failed` `insights` 행 → `generating`.
      - `interview_questions`: 세션이 이 작업의 진행 중 세션이고 `generation_status <> 'ready'`이면, 세션에 저장된 질문 중 **답변이 비어 있는(`draft` + 공백뿐) 질문을 지우고**(빈 답변은 연쇄 삭제, 근거는 소유자 트리거) `generation_status = 'generating'`으로 되돌린 뒤 새로 만든다 `[가정]`. 질문 생성이 끝나기 전에는 답변을 편집할 수 없어 실제로는 저장 질문 전부가 지워진다.
      - `interview_evaluation`: 세션이 `evaluation_failed`/`evaluating`이면 이 작업의 `answer_evaluations` 전부(성공이던 평가 포함, 상태 조건 없음) → `pending`, `session_feedbacks` 메타 갱신, 세션 `evaluating`, `interview_sessions.evaluation_provider`·`evaluation_model`도 새 값.
      - **이미 끝난 결과 묶음은 그대로 둔다** `[가정]`: 인사이트 `ready`, 질문 `generation_status = 'ready'`, 채점 완료 세션. `complete_*`는 성공했는데 작업 행 완료만 실패한 경우에만 생긴다.
      - 해당 행의 `evidence_links`는 새 결과를 저장하는 `complete_*` 안에서 교체한다.
    - **같으면**: `step_outputs` 유지(단계 출력·`_meta.partials`), `_meta`만 새 실행 값. 이전 세대에서 실패한 행만 `begin_*`/`save_*`/`complete_*`가 실행 중에 다시 연다(세대 검사, 기존 방식). 성공 행은 그대로.
    - `complete_*`는 세대 검사로 **이번 세대로 다시 열린 행만** 덮어쓴다. 이전 세대 실행기의 늦은 완료는 `stale_run`으로 버린다. 결과 행·`interview_sessions.question_*`/`evaluation_*`의 공급자 메타는 이번 실행 값으로 기록한다(2.7).
    - 새 작업인 면접 "다시 채점"(A9)은 이 규칙과 별개로 평가 성공이 없는 답변만 다시 평가한다(답변마다 공급자 메타가 달라질 수 있음, A.12).
  - 경우 (1)에서 호출당 재시도 횟수·120초 대기 예산은 새로 시작하고, `retry_count`·`retry_wait_total_ms` 컬럼은 작업 전체 누계로 계속 는다.
  - `input_hash`는 `provider`·`model`을 포함하므로(위) 공급자가 바뀐 다시 시도는 이전 해시로 재사용되지 않는다. 구현(42f7611): `retry_ai_job`이 공급자나 모델이 바뀌면 `input_hash`를 null로 비우고, 실행기가 새 값을 쓸 수 있다(`app_ai_writer`의 `input_hash` update) `[가정]`.
  - 화면: "처음 실행한 {공급자}로 다시 해요"·"실패한 작업의 다시 시도는 원래 공급자로" 안내는 없앤다. 다시 시도 버튼 옆 배지는 활성 공급자를 보이고, 작업에 기록된 공급자와 다르면 "{활성 공급자}로 처음부터 다시 해요"를 붙인다(UX C-20·S-40 담당).
  - **구현됨 (backend R2, 42f7611, 2026-11-06)**: 활성 공급자·등급으로 작업 행 메타 갱신, 다르면 `step_outputs` 비움과 결과 행 다시 열기(위 RPC 동작), 경로 ② 판정 순서와 `ai_connection_changed`(2.11.7), 공급자 변경을 `failed → queued` 밖에서 막는 가드 트리거(R-63, R-71, 11.5).
- 실행 단계마다 RPC **`check_ai_run_allowed(ai_job_id)`**(`app_ai_writer`, security definer)로 키·동의를 다시 확인한다. 동의 필요면 `key_missing`, 키 무효면 `key_invalid`로 끝난다(공급자 호출·사용 기록 0). 경로별 코드는 2.11.7.
- 보관 90일(v3과 같음). 정리 때 결과 행의 `ai_job_id`는 FK `set null`로 비워진다(그 행의 `updated_at`도 바뀐다 `[가정]`).

#### 2.9.2 ai_usage_records (v4 신설, F-AI-07, D-17 재정의, D-33)

- 설명: **공급자 호출 1회(재시도 각 시도 포함) = 1행.** 공급자가 보고한 토큰과 기록 시점 가격표로 계산한 예상 비용. 콘텐츠(프롬프트·응답)는 없다. 차감·예약 개념 없음.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `occurred_at` | timestamptz | not null | 호출 완료 시각 |
| `period_month` | date | not null | 달력 월 KST 1일 (`date_trunc('month', occurred_at at time zone 'Asia/Seoul')`) |
| `feature` | text | not null, CHECK in (`jd_extraction`, `insight`, `career_description`, `cover_letter`, `interview_questions`, `interview_evaluation`, `writing_chat`, `key_verification`, `writing_assist`, `chat_reply`) | 미터 표시 기능. AI-11 기본 선택은 `career_description`, 자소서 글자 수 보정은 `cover_letter`에 포함. **v4.5**: 산출물 작성 대화(AI-13)도 **`writing_chat`**(미터 "AI 작성 대화", STAR·산출물 합산 — AI DA-16·PRD PP-5). 새 값 없음, CHECK 변경 없음. 작업은 같은 `ai_jobs.job_type = 'writing_chat_turn'`·`target_type = 'writing_chat'`, `progress.stage`에 `compose`·`validate` 추가(jsonb 앱 상수, DB CHECK 없음) |
| `job_type` | text | not null | `ai_jobs.job_type`과 같은 값 |
| `ai_job_id` | uuid | null (soft) | 작업은 90일 뒤 정리되지만 기록은 남는다 |
| `call_key` | text | null | 작업 안 단계(예: `insight.match.2`, `writing_chat.turn.7.extract`, **v4.5** 산출물 초안 `writing_chat.turn.7.compose`) |
| `application_project_id` | uuid | null, 복합 FK → `application_projects on delete set null (application_project_id)` | 지원 프로젝트를 지워도 기록은 남는다(PRD 요청 2) |
| `provider` | text | not null, CHECK in (`openai`, `gemini`, `anthropic`) | |
| `model` | text | not null | 실제 호출 모델 ID |
| `model_tier` | text | not null, CHECK in (`light`, `default`, `heavy`) | |
| `connection_tier` | text | not null, CHECK in (`free`, `paid`) | 호출 시점 등급 |
| `input_tokens` | integer | not null default 0 | 캐시되지 않은 입력 |
| `cached_input_tokens` | integer | not null default 0 | 캐시 읽기 |
| `cache_write_tokens` | integer | not null default 0 | 캐시 쓰기(Claude) |
| `output_tokens` | integer | not null default 0 | 사고 토큰 포함 |
| `reasoning_tokens` | integer | null | 그중 사고 토큰(공급자가 따로 보고할 때, 표시용) |
| `usage_source` | text | not null, CHECK in (`provider_reported`, `unavailable`) | 실패 응답에 토큰 정보가 없으면 `unavailable` + 토큰 0 |
| `outcome` | text | not null, CHECK in (`succeeded`, `failed`) | 실패도 토큰이 보고되면 집계(F-AI-07 (7)) |
| `error_code` | text | null | `outcome = 'failed'`일 때 `ai_jobs.error_code`와 같은 값 |
| `price_table_version` | text | not null | 계산에 쓴 가격표 |
| `estimated_cost_usd` | numeric(12,6) | not null | AI C-13 식. 기록 시점 값, 가격표가 바뀌어도 다시 계산하지 않음. 무료 등급도 유료 환산 값 |

- 공통 컬럼 중 `updated_at` 없음(불변).
- 동일 입력 재사용으로 호출하지 않은 경우는 기록하지 않는다.
- RLS: select 본인. insert는 `app_ai_writer`(작업 실행 경로)만. **`app_ai_writer`도 본인 행 select**(v4.2, 구현 반영: 무료 등급 호출 간격용 마지막 `occurred_at` 조회, `insert … returning`). update·delete 없음(보관 정리·탈퇴만).
- 인덱스: `(user_id, period_month, feature)`, `(user_id, period_month, provider)`.
- **보관: 13개월** `[가정]`(월 선택 조회와 1년 추세 여유). v4.2: 13개월 = **이번 KST 달을 포함한 13개 달**(`period_month < 이번 KST 달 1일 − 12개월`이면 삭제), 매일 보관 크론이 같은 기준으로 지운다 `[가정]`(4.5). 키를 지워도 남는다(콘텐츠 없음). 탈퇴 시 삭제.
- 가격표에 없는 모델의 호출은 `price_table_version = 'unpriced'`, `estimated_cost_usd = 0`으로 기록 `[가정]`.
- 지원 프로젝트 삭제와 겹쳐 FK 위반이 나면 `application_project_id = null`로 다시 넣는다(4.1 "기록 유지"와 같은 결과).

#### 2.9.3 ai_price_tables (v4 신설, 비사용자 참조 테이블)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | PK, `user_id` 없음 |
| `version` | text | 가격표 버전(예: `2026-10-26.1`). `unique (version, provider, model)` |
| `effective_from` | date | 적용 시작일. 기록 시 `effective_from <= 오늘`인 최신 버전 사용 |
| `provider` | text | `openai` / `gemini` / `anthropic` |
| `model` | text | 모델 ID |
| `input_usd_per_mtok` | numeric(10,4) | 100만 토큰당 입력 단가 |
| `cached_input_usd_per_mtok` | numeric(10,4) null | 캐시 읽기 단가 |
| `cache_write_usd_per_mtok` | numeric(10,4) null | 캐시 쓰기 단가(Claude) |
| `output_usd_per_mtok` | numeric(10,4) | 출력 단가(사고 토큰 포함) |
| `long_context_threshold_tokens` | integer null | 장문 구간 시작 토큰 수(있는 모델만) |
| `long_context_input_usd_per_mtok` / `long_context_output_usd_per_mtok` | numeric(10,4) null | 장문 구간 단가 |
| `long_context_cached_input_usd_per_mtok` | numeric(10,4) null | **v4.2 (구현 반영)**: 장문 구간 캐시 읽기 단가(OpenAI 등) |
| `long_context_cache_write_usd_per_mtok` | numeric(10,4) null | **v4.2 (구현 반영)**: 장문 구간 캐시 쓰기 단가(Claude Haiku 등) |
| `source_checked_at` | date | 공급자 가격 페이지 확인일(화면 "기준일") |

- 비용 계산: 입력이 `long_context_threshold_tokens`를 넘으면 `long_context_*` 단가를 쓰고, 장문 캐시 단가가 null이면 일반 캐시 단가를 쓴다(AI C-13 식 반영 대상).

- RLS: select 인증 사용자 전체. 쓰기 운영자만. 행은 고치지 않고 새 버전을 추가한다(과거 기록의 기준 보존).

#### 2.9.4 품질·안전 제한 (D-34 유지분의 데이터 표현)

| 제한 | 데이터 표현 |
|------|-------------|
| **산출물 대화 초안 생성 횟수 (v4.5)** | 대화당 6회 `[가정]`(AI 7.4, PRD 품질 목적 제한) — `structured_draft.draft_count`, `apply_structured_draft_patch`가 6에서 `writing_chat_draft_limit_reached`(409)로 거부, 서버가 초안 턴 시작 전에도 검사 |
| AI 작성 대화 메시지 상한 40(사용자 + AI 합계, **시작 인사 제외** — A5) | **`writing_chats.message_count` `CHECK (message_count <= 40)`**(D-34 확정, PRD 요청 7) + RPC `append_writing_chat_message` 사전 검사(`message_count ≤ 38`일 때만 사용자 메시지 접수, 2.5). v4.4: 상한에 닿으면 `status = 'closed'`(열람·반영만), 이어 하려면 같은 프로젝트의 새 대화 |
| 입력 길이 상한 | 각 컬럼 길이 CHECK(공고 원문 50,000자, 문항 메모 300자, 답변 5,000자, 메시지 4,000자) |
| 지원 프로젝트당 작성 중 면접 세션 1개 | `interview_sessions` partial unique(v2와 같음) |
| 같은 대상 같은 AI 작업 동시 1개 | `ai_jobs` partial unique(2.9.1) |
| 동일 입력 재사용 | `input_hash`(공급자·모델 포함) 인덱스 |
| 서버 남용 방지 요청 제한 | DB 밖(앱·엣지 미들웨어). 사용자에게 "한도"로 노출하지 않음 `[가정: 수치]` |

#### 2.9.5 월 집계 RPC `get_ai_usage_summary(period_month date default 이번 달 KST, include_previous boolean default false)`

- security invoker(본인 RLS). 반환:

```json
{
  "period_month": "2026-10-01",
  "as_of": "2026-10-26T09:00:00Z",
  "totals": { "input_tokens": 0, "cached_input_tokens": 0, "cache_write_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0, "calls": 0, "failed_calls": 0 },
  "by_feature": [ { "feature": "insight", "input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0, "calls": 0 } ],
  "by_provider": [ { "provider": "gemini", "connection_tier": "free", "input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0, "calls": 0 } ],
  "price_table_versions": [ { "version": "2026-10-26.1", "source_checked_at": "2026-10-26" } ]
}
```
- `by_provider`는 공급자·등급별로 나눠 무료 등급을 "청구되지 않을 수 있음(유료 환산)"으로 표시할 수 있게 한다(F-AI-07 (5)).
- `price_table_versions`는 그 달 기록에 쓰인 버전 목록(화면 "가격표 버전·기준일").
- **v4.1 (UB-2 (b) `[가정]`)**: 기본 응답은 **요청한 달의 기능별(`by_feature`) + 공급자별(`by_provider`)** 과 합계만이다. 지난달 비교는 기본 응답에서 뺐고, `include_previous = true`일 때만 `"previous_month": {period_month, estimated_cost_usd, input_tokens, output_tokens}`를 더한다(화면이 쓰지 않으면 인자를 넘기지 않으면 된다). 다른 달은 `period_month` 인자로 조회한다.

### 2.10 Should·운영
- `chat_threads`/`chat_messages`(AI-09): v2와 같음. AI 작성 대화와 **별도 테이블**. `chat_messages`(assistant)에도 AI 출력 공통 메타(v4 `provider`·`model_tier` 포함).
- `ai_suggestions`(AI-08, Should): **v4.4** `target_type = 'project'` + **`target_field`**(STAR 5필드 중 하나)로 대상을 지정한다(`project_detail` 폐기, AI 요청 11). 다듬기는 소속 프로젝트의 STAR만.
- `account_deletion_logs`: v2와 같음.

### 2.11 AI 연결 (v4 BYOK 신설, F-AI-01~09, NFR-KEY-01~09)

#### 2.11.1 ai_provider_keys

- 설명: 사용자별 공급자 API 키. **사용자당 공급자별 1개**(최대 3개, F-AI-01 (1)).

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `provider` | text | not null, CHECK in (`openai`, `gemini`, `anthropic`), `unique (user_id, provider)` | |
| `connection_tier` | text | not null, CHECK in (`free`, `paid`) | 사용자가 고른 등급(F-AI-04 (2), Gemini 기본 `free`). 바꾸려면 재동의 |
| `key_ciphertext` | bytea | not null | **봉투 암호화된 키**(AES-256-GCM). `anon`·`authenticated`·`app_ai_writer`·`app_key_reader`·`service_role`은 컬럼 select 권한 없음. **v4.2 문구 정정**: Postgres 기본 역할 `pg_read_all_data`의 구성원(Supabase 플랫폼 역할 `supabase_read_only_user`, `supabase_etl_admin`), 테이블 소유자, 슈퍼유저는 컬럼 grant와 무관하게 읽을 수 있다. 이 역할들도 **KEK(외부 KMS) 없이는 암호문만** 본다 — 출시 전 KMS 전환(B-2)이 이 보호의 전제다 |
| `key_nonce` | bytea | not null | GCM nonce |
| `wrapped_dek` | bytea | not null | 키마다 무작위 데이터 키(DEK)를 외부 KMS의 마스터 키(KEK)로 감싼 값 |
| `kek_id` | text | not null | 사용한 KEK 식별자·버전(교체 대비) |
| `encryption_version` | smallint | not null default 1 | 암호화 형식 버전 |
| `key_last4` | text | not null, 4자 | 화면 표시용 마지막 4자리 |
| `status` | text | not null, CHECK in (`valid`, `invalid`, `needs_check`) | 유효 / 무효(401·403) / 확인 필요(검증 중 일시 오류·한도) |
| `last_verified_at` | timestamptz | null | 마지막 검증 성공 시각 |
| `last_failure_cause` | text | null, CHECK in (2.9.1 `failure_cause` 7값) | 마지막 실패 원인(설정 화면 표시) |
| `last_failure_at` | timestamptz | null | |

- `unique (user_id, provider)` + `unique (id, user_id)`.
- **화면 조회 컬럼**(컬럼 권한 grant): `id`, `provider`, `connection_tier`, `key_last4`, `status`, `last_verified_at`, `last_failure_cause`, `last_failure_at`, `created_at`, `updated_at`. 암호 컬럼 4개(`key_ciphertext`, `key_nonce`, `wrapped_dek`, `kek_id`)는 `authenticated`·`anon`·`app_ai_writer`에 **grant 없음**.
- **v4.2 (구현 반영)**: 이 목록에 `user_id`가 없어 `authenticated`는 `select *`를 할 수 없다. **화면·서버는 뷰 `ai_provider_keys_public`(security invoker, 위 메타 컬럼만, 본인 행)을 쓴다.** `delete_provider_key`는 `provider`로만 거르고 본인 범위는 RLS에 맡긴다. 운영자(`service_role`)는 `user_id`를 포함한 메타 컬럼 select만 가진다.
- pgTAP이 앱·API 역할의 암호 컬럼 권한 0과, 우회 가능한 플랫폼 역할 목록을 고정한다(새 구성원이 생기면 실패).

#### 2.11.2 암호화 방식 권고와 복호화 경로

**권고: 애플리케이션 수준 봉투 암호화 + 외부 KMS.** (Supabase Vault 대신)

| 기준 | Supabase Vault | **앱 봉투 암호화 + 외부 KMS (권고)** |
|------|----------------|--------------------------------------|
| DB 사본만으로 복원 불가 (NFR-KEY-02) | 루트 키가 DB 밖이라 충족 | KEK가 KMS에만 있어 충족 |
| 운영자 원문 접근 금지 (NFR-KEY-07) | 복호화가 DB 안(`vault.decrypted_secrets`)에서 일어나 권한 있는 DB 역할·SQL 콘솔로 원문 조회 가능 | 복호화가 앱 서버 메모리에서만. DB 역할을 다 가져도 암호문뿐. KMS 호출 권한은 서버 실행 계정에만 |
| 감사 | DB 로그 | KMS 복호화 호출이 모두 감사 로그에 남음(호출당 `user_id`·`ai_job_id` 문맥) |
| 키 교체 | Vault 재암호화 | `kek_id` 버전으로 DEK만 다시 감쌈(키 원문 재암호화 불필요) |

- 구현 방향: 키 등록 시 서버가 DEK를 만들고 원문을 AES-256-GCM으로 암호화(AAD = `user_id || provider || key 행 id`, 행 바꿔치기 방지), DEK를 KMS로 감싼다. 원문·DEK는 즉시 메모리에서 지운다. KMS는 클라우드 KMS(예: AWS KMS / GCP KMS) `[가정: 공급사는 구현 시 선택]`. KMS 도입 전 임시안은 Vercel 암호화 환경 변수의 마스터 키(권한 분리가 약하므로 출시 전 KMS로 전환) `[가정]`.
- **복호화 경로 (작업 실행 시점, NFR-KEY-03)**:
  1. 작업 실행기(Route Handler·`after()` 단계)는 `app_ai_writer`와 **별개 DB 역할 `app_key_reader`** 로 연결해 security definer 함수 **`get_provider_key_secret(ai_job_id)`** 만 호출할 수 있다. `app_key_reader`는 이 함수 실행 권한 외에 아무 테이블 권한도 없다.
  2. 함수는 `ai_jobs` 행이 `status = 'running'`이고 `heartbeat_at`이 최근(예: 2분 이내)이며, 그 작업의 `user_id`·`provider`와 일치하는 키 행이 있을 때만 `{key_id, key_ciphertext, key_nonce, wrapped_dek, kek_id, encryption_version}`를 돌려준다(v4.2: AAD 계산용 `key_id` 추가). 다른 사용자·다른 공급자·끝난 작업은 거부(NFR-KEY-08 격리).
     - **v4.2 (구현 반영) 거부와 키 없음의 구분**: 작업 조건(본인·running·heartbeat 2분 이내) 불충족 → 오류 `P0001 key_not_available`. 작업은 정상인데 그 공급자 키 행이 없으면 **0행** → 앱이 `key_missing`.
  3. 서버가 KMS로 DEK를 풀고 원문을 복호화해 그 단계의 공급자 호출에만 쓰고 버린다. 큐·작업 행·로그에 키를 싣지 않는다.
  4. 키 행이 없으면(실행 중 삭제) 작업은 `error_code = 'key_missing'`으로 끝나고 입력은 보존(D-36).
  - 탈퇴로 작업 행이 지워지면 heartbeat가 lost가 되고 복호화도 거부된다.
- 등록·교체·다시 확인도 같은 경로: 서버 액션이 `ai_jobs`(`job_type = 'key_verification'`)를 만들고 실행한다. 등록·교체는 사용자가 막 보낸 원문으로 검증한 뒤 **2.11.3 `save_provider_key`의 `valid` / `limited` 규칙**에 따라 저장한다: 2단계까지 성공이면 `valid`, 인증은 통과했지만 2단계가 `rate_limited`·`daily_quota_exhausted`·`provider_unavailable`이면 `limited`로 저장(`status = 'needs_check'`), `key_invalid`·`billing_required`·`model_not_available`이면 저장하지 않는다(F-AI-01 (2)).

#### 2.11.3 키 관련 RPC

> **v4.2 실행 주체 변경 (확정 2026-11-05 (사용자), A19 ★)**: `save_provider_key`·`record_provider_key_check`는 **서버 전용 역할에서 실행**한다. 서버(Server Action)가 사용자 세션을 확인한 뒤 서버 전용 역할로 연결해 **`p_user_id`를 넘긴다**. `authenticated`·`anon`에는 execute 권한이 없어 브라우저가 사용자 JWT로 직접 부를 수 없다(검증 없는 암호문 저장·상태 임의 변경 차단). 서버 전용 역할은 `service_role` 연결을 쓴다 `[가정]`(전용 역할 분리는 구현 선택). `delete_provider_key`·`set_active_ai_provider`는 사용자 세션 그대로(암호문·검증 결과를 받지 않음).

| RPC | 실행 주체 | 동작 |
|-----|-----------|------|
| `save_provider_key(p_user_id, p_key_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, p_encryption_version default 1, key_last4, disclosure_version, verification_result, p_failure_cause)` (`verification_result` ∈ `valid` / `limited`) | **v4.2: 서버 전용 역할**, security definer + `p_user_id` 소유 검사 | 검증 후 호출. **v4.2 인자 (구현 반영)**: `p_key_id`는 서버가 만든 키 행 id(AAD에 들어가므로 저장 전에 정함, 교체 시 기존 id 유지), `p_failure_cause`는 `limited`일 때 `rate_limited` / `daily_quota_exhausted` / `provider_unavailable` 중 하나 필수·`valid`면 null, `p_encryption_version` 기본 1. 해당 공급자·등급의 유효한 `ai_data_use_consents`가 2.11.5 재동의 규칙을 통과하지 못하면 거부(F-AI-04 (4)). `valid` 저장은 새 키이므로 `last_failure_*`를 비운다. "첫 키" = 활성 공급자가 null일 때 저장되는 키. insert 또는 교체(같은 행 덮어쓰기). **저장 규칙 (v4.1, R-38)**: 검증 1단계(인증) 통과 + 2단계 성공 → `status = 'valid'`, `last_verified_at = now()`. 1단계 통과 + 2단계가 `rate_limited`·`daily_quota_exhausted`·`provider_unavailable` → **`status = 'needs_check'`로 저장**, `last_failure_cause`·`last_failure_at` 기록, `last_verified_at = null`(키 자체는 쓸 수 있으므로 활성화 허용, AI 실행 시 같은 원인이면 F-AI-08 안내). `key_invalid`·`billing_required`·`model_not_available`는 저장하지 않는다(F-AI-01 (2)). 첫 키면 `profiles.active_ai_provider` 설정(F-AI-01 (5)) |
| `record_provider_key_check(p_user_id, provider, result_status, failure_cause)` | **v4.2: 서버 전용 역할**, security definer + `p_user_id` 소유 검사 | "다시 확인" 결과로 `status`, `last_verified_at` / `last_failure_*`만 갱신. v4.2: `result_status` ∈ (`valid`, `failed`), `failed`면 `failure_cause`는 `input_rejected`를 뺀 6값 중 하나. 성공은 `status`·`last_verified_at`만 바꾸고 실패 기록(`last_failure_*`)은 이력으로 남긴다. **규칙 (v4.1)**: 성공 → `valid`, `last_verified_at = now()` / `key_invalid` → `invalid` / `rate_limited`·`daily_quota_exhausted`·`provider_unavailable`·`billing_required`·`model_not_available` → `needs_check` + `last_failure_cause`(이미 저장된 키는 지우지 않음). `needs_check` 키는 다음 성공 실행 또는 다시 확인 성공 시 `valid`로 돌아간다 |
| **`mark_provider_key_invalid(ai_job_id, failure_cause)`** | `app_ai_writer`, security definer | AI 요청: 작업이 `key_invalid`로 실패하면 그 작업의 `user_id`·`provider` 키 행을 `status = 'invalid'`, `last_failure_cause = 'key_invalid'`, `last_failure_at`으로만 바꾼다. **암호 컬럼을 읽지 않는다**(NFR-KEY-09). `billing_required`·`daily_quota_exhausted` 등은 `last_failure_*`만 갱신하고 `status`는 유지. v4.2: 작업이 키 원인 6값(`rate_limited`, `daily_quota_exhausted`, `billing_required`, `key_invalid`, `model_not_available`, `provider_unavailable`) 중 하나로 **최종 실패**할 때만 부른다(자동 재시도 중간에는 부르지 않음) |
| **`record_provider_key_success(p_ai_job_id)`** (v4.2, 구현 반영) | `app_ai_writer`, security definer | 성공 실행으로 `needs_check → valid` 되돌림. 작업이 본인 것이고 `running`/`succeeded`이며 키가 `needs_check`일 때만 `status = 'valid'`, `last_verified_at = now()`. 암호 컬럼을 읽지 않는다 |
| `delete_provider_key(provider)` | 서버 액션(사용자 세션), security invoker | 행 **즉시 hard delete**(NFR-KEY-06). 활성 공급자였으면 FK로 `profiles.active_ai_provider = null`(자동 전환 없음, F-AI-02 (3)). 그 공급자의 현재 동의 행에 `withdrawn_at` 기록. 진행 중 작업은 다음 단계에서 `key_missing` 실패 |
| `set_active_ai_provider(provider)` | 서버 액션(사용자 세션) | 등록된 키가 있는 공급자만(FK가 보장) |
| **`check_ai_run_allowed(p_ai_job_id)`** (v4.2, 구현 반영) | `app_ai_writer`, security definer | 실행 단계마다 그 작업의 공급자 키 존재·`invalid` 아님·키 현재 등급의 동의가 2.11.5 규칙을 통과하는지 확인. 확인 오류면 닫힌 실패(`stalled`). 동의 필요 → `key_missing`, 키 무효 → `key_invalid`(작업 `error_code`, 2.11.7 경로 ③) |

- **등급 변경 (v4.2, 구현 반영)**: 별도 RPC 없이 "다시 확인" 경로로 처리한다 — 새 등급 동의 확인 → 저장된 키를 실행 시점 경로로 복호화해 검증 → `valid`/`limited`면 같은 행 id로 다시 암호화해 `save_provider_key`(이전 등급 동의 철회는 RPC가 함). 검증 실패면 등급은 그대로 두고 `record_provider_key_check`로 상태만 갱신. 사용자는 키를 다시 붙여넣지 않는다.
- 키 검증 작업(`key_verification`)의 사용 기록은 2단계 생성 호출만 1행(실패 포함). 작업 상태: 등록·교체·등급 변경에서 저장했으면 `succeeded`, 아니면 `failed` + 원인. "다시 확인"은 `valid`만 `succeeded` `[가정]`.

#### 2.11.4 profiles.active_ai_provider (v4 신설, D-28)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `active_ai_provider` | text | null, CHECK in (`openai`, `gemini`, `anthropic`), 복합 FK `(id, active_ai_provider) → ai_provider_keys(user_id, provider) on delete set null (active_ai_provider)` | 사용자당 1개. 키가 없으면 null = AI 잠금(F-AI-06). FK라 키가 없는 공급자는 고를 수 없다 |

- 별도 `ai_settings` 테이블은 두지 않는다(값 하나뿐, `profiles` 1:1과 같은 수명).

#### 2.11.5 ai_data_use_consents (v4 신설, F-AI-04, D-32, NFR-PRV-03·04)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `provider` | text | not null, CHECK in 3값 | |
| `connection_tier` | text | not null, CHECK in (`free`, `paid`) | |
| `disclosure_version` | text | not null | `ai_disclosures.version` |
| `free_tier_acknowledged` | boolean | not null default false, `CHECK (connection_tier <> 'free' OR free_tier_acknowledged)` | 무료 등급 별도 체크(학습·사람 검토 가능성 고지, F-AI-04 (3)) |
| `agreed_at` | timestamptz | not null default now() | |
| `withdrawn_at` | timestamptz | null | 키 삭제·등급 변경·사용자 철회 시 |

- 동의 1회 = 1행(`consents`와 같은 원칙), 재동의는 새 행.
- **재동의 판정(서버) — v4.2 통일 (확정 2026-11-05 (사용자), A20 ★)**: 키 등록·등급 변경과 AI 실행이 **같은 규칙**을 쓴다.
  1. `(provider, connection_tier)`의 최신 `withdrawn_at is null` 동의 행이 없으면 동의 필요.
  2. 있으면, 그 행의 `disclosure_version`보다 뒤에 시행된(`effective_at <= now()`) `ai_disclosures` 버전 중 **`requires_reconsent = true`인 버전이 하나라도 있을 때만** 재동의 필요. `requires_reconsent = false`인 새 버전은 등록도 실행도 막지 않는다.
  - 검사 위치: 등록 = `save_provider_key`(DB), 실행 = 시작 Route Handler + 단계마다 `check_ai_run_allowed`(DB). 기존 구현(등록 때 "현재 버전과 정확히 일치")은 후속 슬라이스에서 고친다.
  - 동의 철회 시 그 공급자·등급의 queued/running 작업에 취소를 요청한다(queued는 시작 전, running은 다음 heartbeat에서 중단).
- RLS: select/insert 본인. update는 `withdrawn_at`만(사용자 세션). delete 없음(탈퇴 연쇄).
- 보유: `consents`와 같다 — 탈퇴 시 삭제, 파기 증빙은 `account_deletion_logs`(비식별)만(D-DM-02 (b)).

#### 2.11.6 ai_disclosures / ai_providers (v4 신설, 비사용자 참조 테이블)

| 테이블 | 컬럼 | 용도 |
|--------|------|------|
| `ai_disclosures` | `provider`, `connection_tier`, `version`, `effective_at`, `requires_reconsent`, `requires_free_tier_ack`, `document_path`(고지 전문), `terms_checked_at` | F-AI-04 고지 문구 버전 관리(D-10 공급자·등급별 약관 확인 결과) |
| `ai_providers` | `provider`(PK), `display_order`, `is_available`(D-38 출시 게이트: 평가 통과 전 false = "준비 중"), `is_recommended`(Gemini `[가정]`), `dashboard_url`, `billing_url`, `key_guide_version`, `key_guide_checked_at` | 연결 화면 목록·가이드 버전(F-AI-05 (3))·F-AI-08 대시보드 링크 |

- RLS: select 전체(인증 사용자, `ai_disclosures`는 비로그인 처리방침 열람용으로 anon도). 쓰기 운영자.
- 초기값 (v4.2, 구현 반영) `[가정]`: `ai_disclosures` 6행(3 공급자 × 2 등급) `version = 'v2026-10-29'`, `effective_at` = 배포 즉시 유효(2026-10-28 00:00 KST), `document_path = '/policies/ai/{provider}/{tier}/{version}'`. 실제 문구는 법무 확인(D-39) 후 확정.

---

#### 2.11.7 AI 연결 게이트 거부 코드 — 경로별 한 곳 정리 (v4.2, 리뷰 R-49)

> 같은 상황(키 없음·동의 필요·키 무효)이라도 응답이 나가는 경로에 따라 코드가 다르다. 다른 절(2.9.1, 2.11.3, 7장)은 이 표를 가리킨다. UX C-20은 이 코드명을 따른다.

| 경로 | 응답 형태 | 키 없음 | **동의 필요**(2.11.5 규칙) | 키 무효 |
|------|-----------|---------|-----------------------------|---------|
| ① 새 작업 시작(작업 행 만들기 전, 생성·시작 Route Handler) | HTTP 409, 작업 행 없음 | `ai_not_connected`(활성 공급자 없음) `[가정]` | `ai_consent_required` `[가정]` ★ — 화면은 보통 C-21로 먼저 동의를 받으므로(S-40·FL-20) 서버에서 걸리는 경우는 드물다 | `key_invalid` |
| ② **같은 행 다시 시도** `POST /api/ai-jobs/{id}/retry`(2.9.1 경우 (1)) | HTTP 409, 작업 행 바꾸지 않음(`failed` 유지) | `key_missing`(**활성 공급자**의 키가 없음 — 화면 "AI 연결 필요") | **`ai_consent_required`** — **활성 공급자·활성 키 현재 등급**의 동의를 본다(A20 규칙) | `key_invalid`(활성 키 무효 — 키 교체) |
| ③ 실행 중 단계 확인 `check_ai_run_allowed`(비동기 실행기) | 작업 `failed`, `ai_jobs.error_code` | `key_missing` | **`key_missing`**(`error_code` CHECK에 동의 값이 없음. `failure_cause` null → 화면 "AI 연결하기" 잠금) | `key_invalid` |
| ④ AI 작성 대화 턴(SSE) | `error` 이벤트 1개, 사용자 메시지 저장 안 함 | `key_missing` | **`key_missing`** | `key_invalid` |
| ⑤ **요청 범위 작업 시작**(2026-11-06 추가) — JD 요건 추출(AI-01, 동기), 서류 3종 AI-11·AI-03·AI-04(동기·SSE) | 요건 추출: HTTP 200 응답 안 `failed` / 서류 3종: 동기 응답 또는 SSE `error` 이벤트 | `key_missing` | **`key_missing`** | `key_invalid` |
| ⑥ **지원 프로젝트 생성**(v4.3, Q53-1, `create_application_project`) | HTTP 409, 행 없음 | 거부 안 함(추출 없이 저장, D-30) | `ai_consent_required` `[가정]` | `key_invalid` `[가정]` |

- **규칙**: 동의 필요를 **별도 코드 `ai_consent_required`로 내는 곳은 HTTP 409로 바로 거부하는 경로(①·②·⑥)뿐**이다. 작업 행이나 응답·스트림 안에서 끝나는 경로(③·④·⑤)는 `key_missing`으로 합친다(⑤는 현재 구현과 같음, 2026-11-06 리더 판단). ②도 ①처럼 **활성 공급자·등급** 기준이다(A1 변경, 2026-11-05 후속) — 화면은 `ai_consent_required`를 받으면 **활성 공급자·등급**으로 C-21을 연다(작업에 기록된 옛 `provider`·`connection_tier`가 아님. UX C-20 행 추가 대상).
- **경로 ② 판정 순서**(2026-11-06, 2026-11-06 재검토 R-69로 전체 순서 보강 — 구현 42f7611과 같음): 작업 없음 404 `not_found` → 진행 중(`queued`/`running`)이면 그 작업을 따라감(202 `inProgress`) → **`ai_job_not_retryable`**(요청 범위 작업 유형, 입력 원인 실패 `input_too_long`/`safety_blocked`/`insufficient_data`/`not_a_jd`, `failed`가 아닌 행 — 2.9.1. **연결 게이트보다 먼저** 본다) → `key_missing` → `key_invalid` → `ai_consent_required` → `ai_connection_changed` → 같은 대상의 다른 작업이 진행 중이면 그 작업을 따라감(202). 앞에서 걸리면 뒤는 보지 않는다. 게이트 4개는 실행기가 먼저 보고 `retry_ai_job`이 행 잠금 아래에서 다시 본다.
- **경로 ② `ai_connection_changed`**(HTTP 409, 2026-11-06 추가 — 사용자가 판단 위임 → 리더 판단): 서버가 활성 공급자·등급을 읽은 뒤 작업 행에 기록하기 전에 사용자가 공급자나 등급을 바꾼 경우. 서버는 한 번 다시 읽어 재호출하고, 그래도 어긋날 때만 이 코드를 낸다. 작업 행은 `failed` 그대로이고, 사용자가 다시 시도하면 풀린다. 화면 문구는 UX C-20 "다시 시도 거부" 행.
- `ai_consent_required`·`ai_not_connected`·`ai_job_not_retryable`·`ai_connection_changed`는 API 응답 코드이며 `ai_jobs.error_code` 값이 아니다(CHECK 목록 변경 없음).
- ①의 코드(`ai_not_connected`, 동의 필요 `ai_consent_required`, `key_invalid`)는 spec-gaps S3a `[가정]`을 따른 것이고, 구현(42f7611 `startJob`)도 이 표와 같다(R-71).
- **화면이 동의 필요를 미리 아는 방법 (2026-11-06 재검토 R-67, 사용자 확정 2026-11-06 (a), 백엔드 후속 ★)**: 경로 ③·④·⑤는 동의 필요를 `key_missing`으로 합치므로 응답만으로는 화면이 C-21(동의)로 보낼 수 없다. 그래서 `get_data_readiness().ai_connection.consent_required`(6장)를 둔다 — 활성 공급자·활성 키 등급에 대해 2.11.5 규칙으로 (재)동의가 필요하면 true. 화면은 실행 전에 이 값이 true면 **활성 공급자·등급으로 C-21을 먼저 연다**(UX C-18/C-20·S-40 담당). 서버 코드는 바꾸지 않는다(경로 ③·④·⑤는 그대로 `key_missing`, 동의를 받기 전에 실행되거나 사이에 고지가 바뀐 경우의 대비).

## 3. 쟁점 정리 (v3 확정안)

### 3.1 결과 소유 키 — v2와 같음 (`application_project_id`, D-19 (a) 전제)

### 3.2 ~~성과 연결 (D-24 (b))~~ — v4.4 폐기 (CR-11)
- 정량 성과·경력 단위 성과가 없어졌다(`achievements` 폐기, 2.3). 결과·성과는 `projects.result` 서술만이다.
- 수치 가드(AI V-5)의 원천은 이번 호출에 넣은 사용자 서술 텍스트(소속 `situation`·`task`·`action`·`result`, 경력 `summary`, 교육 `description`, 독립 `role`·`description`, 팩에 들어간 산출물 본문)다. `learnings`에만 있는 숫자는 사실로 인정하지 않는다(AI 규칙, 스키마 영향 없음).

### 3.3 AI 작성 대화의 "반영" 경로 (v4.5 개정 — 반영 = 폼 채우기, 확정 = 저장하기, NFR-AI-05, DM-13, CR-5, PA-3)

| 동작 | AI 호출 | 실행 주체 | 쓰는 테이블 |
|------|---------|-----------|-------------|
| 대화 시작 (패널 "+ 새 대화", 게이트 진입) | 없음 | 사용자 세션 → definer RPC `start_writing_chat(p_project_id, p_return_target, p_form_snapshot)` / **`start_deliverable_writing_chat(p_project_deliverable_id, p_form_snapshot)`**(v4.5) | `writing_chats` insert + 고정 시작 인사 메시지. 대상 행이 있어야 한다 |
| **새 페이지에서 첫 AI 메시지 (v4.5)** | 턴부터 있음 | 화면 순서: AI 사용 가능 확인 → **페이지 저장 RPC로 행 생성** → 대화 시작 RPC → 턴 (7장) | `projects` 또는 `project_deliverables` insert → `writing_chats` → 메시지 |
| 대화 턴 (사용자 발화 → 응답 + 정리 패치 / 산출물 초안) | 있음 | 사용자 메시지 insert = definer RPC / 응답·패치 = `app_ai_writer` | `writing_chat_messages`, `writing_chats.structured_draft`·`title`·`status` 등, `ai_jobs`, `ai_usage_records` — **커리어 테이블 없음**. 입력에 `form_snapshot`(저장 안 함) |
| 제안 카드의 필드 직접 수정·`needs_review` 수락/거절(STAR 필드·사실)·초안 블록 수락/[빼기](산출물 — 초안 전체 거절 없음) | 없음 | 사용자 세션 RPC `apply_structured_draft_patch` | `writing_chats.structured_draft` |
| **반영** ([반영] / [모두 반영] / [본문 교체]·[뒤에 덧붙이기]) | 없음 | **화면만** — 폼에 채움. 서버 호출 없음 | 없음. 카드 상태 "폼에 채움"은 화면 로컬 상태 |
| **저장하기** (v4.5) | 없음 | 사용자 세션 RPC **`save_project_page`** / **`save_project_deliverable`**(2.5.1) | `projects` 또는 `project_deliverables` + 같은 트랜잭션에서 `writing_chats.structured_draft`(`applied_at` 등)·`last_applied_at`·`last_activity_at`, `projects.source_writing_chat_id` |
| 대화만 삭제 (패널 … 메뉴) | 없음 | 사용자 세션 delete(RLS) 또는 `delete_career_item('writing_chat', …)` | `writing_chats` → 메시지 연쇄. 프로젝트 `source_writing_chat_id` set null(`updated_at` 그대로). 저장된 STAR·본문은 남는다 |

- **카드 상태 3단계 (AI-12·AI-13, UX-4)**: ① 제안(DB `applied_at` null) ② "폼에 채움 — 저장하면 반영돼요"(**화면 로컬만**, DB에 없음) ③ "반영됨"(저장 성공 뒤 DB `applied_at`). ②에서 저장하지 않고 떠나면 다시 열 때 ①이다. 저장되지 않은 것을 "반영됨"으로 보이는 경로가 없다.
- **채우기 규칙은 화면 판정**(v4.4 `apply_writing_chat_proposal` 규칙을 폼으로 옮김, AI-12·UX S-10 "반영 규칙"): 대상 = `value` 있음 + `applied_at` null + `review in ('ok','accepted')`. STAR는 폼 값이 비면 넣고 있으면 "현재 값 + 줄바꿈 1개 + 제안", 합쳐 2,000자 초과면 채우지 않음. 기간·분류는 폼 칸이 빌 때만(`is_current`면 종료월 건너뜀). 산출물은 교체 / `basis = new` 블록만 덧붙이기, 결과 20,000자 초과면 막음. **산출물의 수락하지 않은 `needs_review` 블록은 교체·덧붙이기 결과에서 뺀다**(블록 `review in ('ok','accepted')`만 채움, 빠진 블록을 따라 자식이 없어진 제목 블록도 뺌). 채울 내용 블록이 하나도 없으면 채우기를 막는다(리더 판정 2026-11-03, AI-13·S-44, T-18). 서버는 이 판정을 다시 하지 않는다 — 저장되는 값은 사용자가 폼에서 확정한 값이고, DB CHECK가 형식·길이를 지킨다.
- 근거: 반영과 확정이 모두 사용자 동작이고, 저장 RPC는 사용자 세션에서 돈다. AI 작업 코드 경로에는 커리어 쓰기 권한이 끝까지 없다(NFR-AI-05).
- **v4.5 폐기**: `apply_writing_chat_proposal`(v4.4 "누르면 바로 DB 저장") — 이름을 남겨 "기록만" 하는 RPC로 바꾸지 않았다. 저장과 분리된 기록 경로가 있으면 저장하지 않은 제안이 "반영됨"이 될 수 있어서다(UX DM-3 선택지 중 "폐기하고 저장 RPC 안으로 합침"). 반영됨 기록 로직(`private.wc_proposal_mark_applied`, 구현됨)은 내부 헬퍼 `private.wc_mark_proposal_applied`로 이름·인자를 고쳐 재사용한다.
- **v4.4 폐기 (유지)**: `save_writing_chat`(일괄 저장), `hand_off_writing_chat`(폼으로 전환, T-6·D-UX-11), `set_writing_chat_affiliation`(소속 확정, T-19·A15).

### 3.4 AI 작성 대화 보관 (v4.4 개정, D-27, PIPA)

- **v4.5**: 산출물 대화도 같은 규칙이다(산출물에 묶여 보관, 대화만 삭제 가능, 자동 삭제 없음). 보관 기간을 따로 정할 이유가 없어 새 결정은 없다.
- **확정 (사용자 결정 U-9, 2026-10-24)**: 프로젝트에 묶인 대화는 계속 보관하고 대화만 따로 삭제할 수 있다(D-27 (a)). **v4.4 (CR-6, 확정 2026-11-02 (사용자))**: 모든 대화가 프로젝트에 묶이므로 "묶이지 않은 대화 90일 자동 삭제"(D-DM-08)와 크론 `purge_unlinked_writing_chats`를 폐기한다.

| 경우 | 처리 |
|------|------|
| 사용자가 "대화만 삭제" | `writing_chats` 행 삭제 → 메시지 연쇄 삭제, 프로젝트 `source_writing_chat_id`는 null. 반영된 STAR는 그대로 |
| 프로젝트 삭제 | `writing_chats.project_id` FK cascade로 그 프로젝트의 대화 전부 삭제(F-COM-04). **v4.5**: 독립 프로젝트면 산출물과 그 산출물 대화가 함께 지워진다 |
| **산출물 삭제 (v4.5)** | `writing_chats.project_deliverable_id` FK cascade로 그 산출물의 대화 전부 삭제(F-COM-04, PRD F-P1-18 (5)) |
| 경력·교육 삭제 | 소속 프로젝트가 함께 지워지므로(2.3, 4.2) 그 대화도 연쇄 삭제 |
| 상한 도달(`closed`) | 보관. 열람·반영만 |
| 탈퇴 | DM-1 연쇄 + `delete_account` 명시 삭제 |
| 로그 | 대화 원문은 로그·`ai_jobs`에 남기지 않는다(NFR-PRV-09) |
| 국외 이전 | 대화 내용은 LLM 처리 대상(NFR-PRV-03 v3 고지) |

- D-27 (b)(반영 후 30일 자동 삭제)로 바뀌면 `last_applied_at + 30일` 배치 삭제만 추가하면 된다.
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

- v4.4: 위 표의 대화 모드·대화 소속·대화 상태(saved/handed_off/abandoned)·`project_detail_ids` 행은 폐기된 이름이다(3.6).

### 3.6 이름 확정 (v4.4, 커리어 재설계 — UX v5.5 vs AI v4.5)

| 대상 | UX v5.5 | AI v4.5 | 확정 | 근거 |
|------|---------|---------|------|------|
| STAR 위치 | `projects` 합침(권고) 또는 1:1 | `projects` 합침(권고) | **`projects`의 컬럼** `situation`·`task`·`action`·`result`·`learnings` | DM-19 |
| 프로젝트 종류 | `project_type` | `project_kind` | **`project_type`** | `experience_type`·`education_type`·`employment_type`과 같은 `_type` 패턴, 같은 머리의 두 분류 이름을 맞춤 |
| 경험 유형 | `experience_type` | `experience_type` | `experience_type` | 같음 |
| 역량 | `competencies` text[] | `competencies` text[] | `competencies` text[] | 같음 |
| 프로젝트 내용 | `description` | `content` | **`description`** | `educations.description`("교육 내용")과 같은 말·같은 컬럼명. `content`는 메시지 본문(`writing_chat_messages.content`)·요건 본문(`jd_requirements.content`)에 쓰여 뜻이 겹친다 |
| 담당 업무 | `role` | `role` | `role`(독립 프로젝트 전용) | 같음 |
| Link | `link_url` | `link_url` | `link_url` | 같음 |
| 산출물 테이블 | `project_deliverables` | `project_artifacts` | **`project_deliverables`** | PRD 용어집 "산출물 / Deliverable"(8장) |
| 산출물 근거 `source_type` | — | `project_artifact` | **`project_deliverable`** | 테이블명 단수형(기존 `project_detail`·`interview_answer`와 같은 규칙) |
| 산출물 삭제 `entity_type` / `cascade` 키 | `deliverable` / `deliverables` | — | **`project_deliverable` / `project_deliverables`** | `get_deletion_impact`의 기존 값은 테이블 단수형·복수형(`project_skills`, `writing_chats`) |
| 산출물 근거 별칭 | — | `ART-n` | **`DLV-n` 권고** | 테이블명과 맞춤(PRD 요청 예시). 별칭은 AI 명세 소관이라 저장에 영향은 없다 |
| readiness hint (STAR 미완 프로젝트) | `complete_project_detail` → `project_star`(권고) | 삭제 | **`project_star`** | 화면 문구 분기에 쓰이므로 남기고 의미에 맞게 이름을 바꿈 |
| readiness count | `projects_without_complete_detail` 정리 | 삭제(`*_project_details`) | **`projects_without_complete_star`** | |
| readiness `next_action` | `create_project` | `create_project` | `create_project` | 같음 |
| 대화 상태 | `active` / `closed` | `active` / `closed` | `active` / `closed` | 같음 |
| 대화 제목 / 반영 시각 | `title` / `applied_at` | `title` / `applied_at`·`last_applied_at` | `title`, 필드 `applied_at`, 행 `last_applied_at` | 같음 |
| 반영 RPC | `apply_writing_chat_proposal(writing_chat_id, fields text[])` | 같음 | `apply_writing_chat_proposal(p_writing_chat_id, p_fields text[] default null)` | 같음(인자 접두어 `p_`는 구현 규칙) |
| 정리 결과 STAR 경로 | `structured_draft.fields.{star}` | `structured_draft.star.{field}` | **`structured_draft.star.{field}`** | AI 매핑 표(AI-12)와 같음. 기간은 `structured_draft.project.{start_month,end_month}` |
| **분류 추천 경로 (후속 CR-20)** | — | — | **`structured_draft.classification.{project_type,experience_type,competencies}`**, 채우기만(`op` 없음), AI 출력 키 `classification_suggestions` | STAR(`star`)와 나란히. 반영 RPC `p_fields`에 같은 키 |
| **진행 중 (후속 CR-22)** | — | — | **`projects.is_current`**(사용자 입력만, AI 제안 경로 없음) | `experiences.is_current`와 같은 이름 |

### 3.7 이름 확정 (v4.5, 프로젝트 추가·산출물 상세 — PRD v4.6 vs UX v5.6 vs AI v4.6)

| 대상 | PRD v4.6 | UX v5.6 | AI v4.6 | 확정 | 근거 |
|------|----------|---------|---------|------|------|
| 산출물 대화 대상 열 | — | `writing_chats.project_deliverable_id` `[가정]` | `writing_chats.project_deliverable_id` | **`writing_chats.project_deliverable_id`** (+ `project_id` = 부모 늘 채움) | FK 명명 규칙. 배타 CHECK 대신 복합 FK(2.5) |
| S-10 저장 RPC | — | 이름 미정 | `save_project_page(p_project_id, p_values, p_applied_proposals)` | **`save_project_page(p_project_id, p_values, p_expected_updated_at, p_applied_proposals)`** | AI 이름 + 기대 버전 인자(UX DM-8) |
| S-44 저장 RPC | — | 이름 미정 | `save_project_deliverable(p_deliverable_id, p_project_id, p_title, p_body, p_applied_proposal)` | **`save_project_deliverable(p_project_deliverable_id, p_project_id, p_title, p_body, p_expected_updated_at, p_applied_proposals)`** | 인자는 컬럼명(`project_deliverable_id`), 반영 기록은 두 RPC 모두 배열 `p_applied_proposals` |
| 반영 기록 인자 | — | `applied: [{writing_chat_id, fields: [...]}]` | `p_applied_proposals = [{writing_chat_id, field, rev}]` / 산출물 `p_applied_proposal = {writing_chat_id, rev, mode}` | **`p_applied_proposals`** — S-10 `[{writing_chat_id, field, rev}]`, S-44 `[{writing_chat_id, rev, mode}]` | `rev`가 필드마다 있어 평평한 배열이 맞다(`proposal_changed` 판정) |
| 기대 버전 인자 / 거부 코드 | — | 예: 페이지를 연 시점의 `updated_at` / `stale_write` | — | **`p_expected_updated_at`** / **`stale_write`**(409) | UX 제안 그대로 |
| 저장 반환의 상태 키 | — | `id`, `status`, `updated_at` | `project_id`, `project_status` | **`project_id`, `status`, `updated_at`** | 컬럼명 그대로(`projects.status`) |
| 저장 RPC `skipped[].reason` | — | `needs_review`·`already_applied`·`empty`·`period_already_set`·`classification_already_set` | `already_applied`·`proposal_changed`·`needs_review`·`not_found` | RPC: **`not_found`·`already_applied`·`proposal_changed`·`needs_review`·`invalid_entry`·`mark_failed`**. `empty`·`period_already_set`·`classification_already_set`는 **화면 채우기 판정 이름**으로만 | 채우기 판정이 화면으로 옮겼다(AI DA-6) |
| 반영 RPC | — | 폐기 또는 "기록만" | 폐기, 내부 헬퍼 `mark_writing_chat_proposal_applied` | **`apply_writing_chat_proposal` 폐기**, 내부 헬퍼 **`private.wc_mark_proposal_applied`** | 구현된 `private.wc_proposal_mark_applied`와 같은 `wc_` 접두어 |
| 대화 시작 | — | `start_writing_chat(p_project_id, p_return_target)` | `start_writing_chat(p_target jsonb, p_return_target)` (`new_project` 등 kind) | STAR = **`start_writing_chat(p_project_id, p_return_target, p_form_snapshot)`**, 산출물 = **`start_deliverable_writing_chat(p_project_deliverable_id, p_form_snapshot)`**. "새 대상" kind 없음 | 리더 정렬 2: 행은 페이지 저장이 먼저 만든다 |
| 필드 판 번호 | — | — | `rev` | **`rev`**(슬롯 단위 단조 증가) | 같음 |
| 채운 뒤 패치 표시 | — | — | `new_object` | **`new_object`**(패치 인자, 저장 안 함). 미반영 객체 여러 개 모양은 두지 않음 | 2.5 |
| 산출물 대화 정리 결과 | — | `structured_draft.deliverable.body` | 같음 + `target`·`facts[]`·`draft_count` | **AI 모양 그대로**(2.5.0) | 같음 |
| 산출물 종류 | — | — | `writing_kind` (`structured_draft` 안) | **`structured_draft.writing_kind`**, 컬럼 없음 | PA-2 |
| 초안 상한 | 6회 `[가정]` | — | `draft_count`, `writing_chat_draft_limit_reached` | **`structured_draft.draft_count`**, **`writing_chat_draft_limit_reached`** | 같음 |
| 폼 스냅숏 | — | (D-UX-26 저장된 값만 — 리더 정렬 2로 폐기) | `form_snapshot` | **`form_snapshot`**(턴 요청 본문, 저장 안 함) | 리더 정렬 2 |
| 산출물 "마지막 반영 대화" | — | — | `project_deliverables.source_writing_chat_id`(선택) | **두지 않음** | 2.3 |
| 첫 메시지 때 이름이 빈 경우 | 기본 이름으로 행 생성 `[가정]` | 보내지 않음(D-UX-25) | 보내지 않음 | **보내지 않음, 임시 이름 없음** | 리더 정렬 1 |

---

## 4. 삭제·보유 정책

### 4.1 개별 삭제 (v4.4)

| 삭제 대상 | 함께 삭제 (cascade) | 유지 / set null | 근거 처리 |
|-----------|---------------------|-----------------|-----------|
| 경력 | **소속 프로젝트 전부**(→ 그 프로젝트의 AI 작성 대화 → 메시지). v4.4: 경력 단위 성과 없음 | — (v4.4: "독립으로 남기기" 없음, 4.2) | 트리거 |
| **교육** | 소속 프로젝트 전부(→ 대화 → 메시지) | — | 트리거(v4.7: 남는 근거 선택 라벨은 삭제 시점 교육 표시 이름, 2.7) |
| 소속 프로젝트 | STAR(같은 행), **그 프로젝트의 `writing_chats` → 메시지** | — | 트리거 |
| 독립 프로젝트 | **`project_deliverables`**(→ **v4.5: 그 산출물의 AI 작성 대화 → 메시지**), `project_skills`(고아 태그 스킬 정리) | — | 트리거(프로젝트 + 산출물) |
| **산출물** (v4.4) | **v4.5: 그 산출물의 `writing_chats` → 메시지**(FK cascade, 진행 중 턴은 취소 요청) | 부모 프로젝트 `status` 영향 없음(완료 조건 아님) | 트리거 |
| 스킬 | `project_skills` | v2와 같음 | 트리거 |
| **AI 작성 대화** | 메시지 | 프로젝트 `source_writing_chat_id` null(`updated_at` 그대로), 저장된 STAR·산출물 본문 유지 | 없음(근거 원본 아님) |
| 지원 프로젝트 | v2 목록 + **`application_stage_events`** | `ai_usage_records`(`application_project_id`만 null) | owner와 함께 |
| **API 키** (v4) | — (행 hard delete, 복구 불가) | `profiles.active_ai_provider` null(FK), 그 공급자 현재 동의에 `withdrawn_at`. **기존 AI 결과·사용 기록은 유지**(D-36). 진행 중 작업은 `key_missing`으로 종료, 입력 보존 | — |

- v4.4 폐기 행: 상세 내용(`project_details`), 성과(`achievements`).

### 4.2 커리어 항목 삭제의 지원 프로젝트 영향 (F-COM-04, D-UX-08 (a) 기본)

- **모드 값 (v4.4)**: `result_mode` ∈ (`keep_results` 기본, `delete_results`) — 변경 없음. **`affiliation_mode`는 인자를 남기되 허용 값은 `delete_projects` 하나이고 기본값도 `delete_projects`**(**확정 2026-11-02 (사용자), CR-15** — D-UX-22 (a)). `keep_projects`는 `affiliation_mode_not_supported`(400)로 거부한다. 이유: 소속 프로젝트를 독립으로 남기면 STAR를 가진 독립 프로젝트가 되어 DM-20 CHECK에 걸린다(2.3). 삭제 확인 창은 `cascade.projects`·`cascade.writing_chats`로 함께 지워지는 프로젝트 수·대화를 보인다.
- **`get_deletion_impact(entity_type, entity_id, affiliation_mode)`**
  - `entity_type` (v4.4): `experience`, `education`, `project`, **`project_deliverable`**, `skill`, `writing_chat`. **삭제**: `project_detail`, `achievement`.
  - 반환: `cascade`(하위 종류별 개수: **`projects`, `project_deliverables`, `project_skills`, `writing_chats`**), `affected_results.by_application_project[]`(`{application_project_id, name, insights, drafts, draft_sections, interview_sessions}`), `writing_chat`이면 **`{ message_count, last_applied_at }`**만(결과 영향 없음. v4.2 `linked_saved_rows` 대체 — 반영한 적이 있으면 화면이 "반영된 STAR는 남아요"를 보인다).
  - **`cascade` 집계 (v4.2, v4.5 개정 ★)**: 삭제 대상 자신은 세지 않는다(하위만). 고아 태그 스킬 자동 삭제분도 세지 않는다(키 목록에 skills 없음). 경력·교육은 `projects`·`writing_chats`(소속 프로젝트의 대화), 독립 프로젝트는 `project_deliverables`·`project_skills`·**`writing_chats`(v4.5: 그 프로젝트 산출물들의 대화 수 = `project_id`가 그 프로젝트인 대화 수 — UX DM-7 가정 확정, 화면 "산출물 {N}개와 산출물의 AI 대화 {M}개")**, 소속 프로젝트는 `writing_chats`, **산출물(v4.5)은 `writing_chats`(그 산출물의 대화 수)**. `writing_chat`(대화만 삭제) 반환은 그대로 `{ message_count, last_applied_at }` — 산출물 대화도 같다(화면은 반영한 적이 있으면 "저장한 본문은 남아요").
  - 집계 대상: 삭제될 행 전체(연쇄분 포함)를 가리키는 `evidence_links`(`source_type` in experience/education/project/**project_deliverable**/skill) + `draft_section_sources`(experience_id/education_id/project_id).
  - **결과 영향 집계 (v4.2, 구현 반영)** — 한 값이라도 0보다 큰 지원 프로젝트만, 이름순:

    | 키 | 세는 것 |
    |----|---------|
    | `insights` | 삭제 대상을 근거로 단 인사이트 버전 수(같은 인사이트의 근거 여러 개는 1) |
    | `drafts` | 삭제 대상을 근거로 단 블록이 있거나 **섹션 머리글이 삭제 대상 경력·교육인** 경력기술서 문서 수 |
    | `draft_sections` | 근거 또는 근거 선택(`draft_section_sources`의 경력·교육·프로젝트)이 삭제 대상에 걸린 자소서 문항 수 |
    | `interview_sessions` | 삭제 대상을 근거로 단 질문·평가·종합이 있는 면접 세션 수 `[가정]` |
- **`delete_career_item(entity_type, entity_id, affiliation_mode, result_mode)`**: v2와 같은 결과 단위. `project_deliverable`은 근거 원본이므로 `result_mode`를 따르고, `writing_chat`은 `result_mode`를 무시한다. **`delete_results` 범위 (v4.2, 구현 반영)**:
  - 인사이트: 해당 버전 삭제. latest가 지워지면 남은 `ready` 중 `version_no`가 가장 큰 행을 latest로 올린다(없으면 latest 없음).
  - 경력기술서: 문서 삭제.
  - 자소서 문항: 생성 결과·편집본·근거·선택 목록·AI 메타를 지우고 `source_selection_mode = 'ai'`로 되돌린다(문구·메모·글자 수·`generation_no`는 유지).
  - 면접 세션: 세션 삭제(진행 중 질문·채점 작업에 취소 요청).
  - 영향받는 진행 중 작업에는 취소를 요청하고, 초기화된 대상에 늦게 도착한 완료는 `stale_run`으로 버린다(실행은 `canceled`).
  - v4.4: 진행 중인 AI 작성 대화 턴(`writing_chat_turn`)도 대화가 연쇄 삭제되면 취소 요청 대상이다(v4.2 탈퇴·대화 삭제와 같은 처리).
- v4.4: 프로젝트의 STAR 섹션을 비워 `draft`가 되면 그 프로젝트를 근거로 한 결과의 근거 칩은 "변경됨"이 된다(`content_updated_at` 갱신). 행을 지우지 않으므로 "원본 삭제됨"은 아니다.

### 4.3 탈퇴 전 삭제 범위 집계 (UX 요청 9)
- **별도 함수 `get_account_deletion_summary()`**: 커리어(**v4.4**: 경력, 교육, 프로젝트, **산출물**, 스킬, AI 작성 대화 — 상세 내용·정량 성과 삭제. **v4.5**: AI 작성 대화 수는 STAR 대화 + 산출물 대화 합계 한 값 `[가정]`(화면 S-25는 "AI 작성 대화 N개" 한 줄). 반환 키 변경 없음. `delete_account`는 이미 `writing_chats` 전체를 먼저 지우므로 변경 없음 — 삭제 순서 대화 → 산출물 → 프로젝트는 FK가 어느 순서든 막지 않는다) / 자기소개서(화면 표기, CR-23 — 지원 프로젝트 수, 인사이트, 초안, 면접 세션, 전형 이력) / **AI 연결(v4: 등록 키 수, 데이터 사용 동의 수, 토큰 사용 기록 수)** 개수. `get_deletion_impact`와 반환 모양·목적(결과 영향 vs 전체 개수)이 달라 분리.

### 4.4 보유 기간

| 데이터 | 보유 |
|--------|------|
| 커리어(교육·프로젝트 STAR·산출물 포함), 지원 프로젝트·결과·전형 이력, 근거, 동의 이력 | 탈퇴 또는 개별 삭제까지 |
| AI 작성 대화 (v4.4: 모두 프로젝트에 묶임, v4.5: 산출물 대화는 산출물에도 묶임) | 프로젝트 삭제(경력·교육 삭제로 인한 연쇄 포함)·**산출물 삭제(v4.5)**·대화 삭제·탈퇴까지 (D-27 (a), **U-9 확정**). **자동 삭제 없음**(v4.4, CR-6 — D-DM-08 90일 폐기) |
| `ai_jobs` | 90일 / `ai_usage_records` **13개월** `[가정]`(D-DM-09) / `account_deletion_logs` 3년 비식별 / 백업 ≤ 30일 |
| **API 키** (v4) | 키 삭제 또는 탈퇴 즉시 hard delete. 백업 안의 암호문은 백업 보관(≤ 30일) 뒤 소멸하며, KMS 없이는 복원 불가(NFR-KEY-02·06) |
| **AI 데이터 사용 동의** (v4) | `consents`와 같음(탈퇴 시 삭제, 비식별 파기 증빙만) |
| **접속 기록** (v4.6, PT-2) | **최대 1년**. 호스팅·인증 인프라(Vercel·Supabase)의 접속 로그(접속 일시·IP·브라우저 정보) — 각 인프라의 보관 기간을 따르고(1년보다 짧음) 따로 모아 두지 않는다. 서비스 테이블에는 `profiles.last_active_at`만 둔다 |
| **장기 미접속 계정** (v4.6, PT-3) | 마지막 접속(`coalesce(last_active_at, created_at)`) 1년 − 30일에 안내, 안내 30일 뒤 + 마지막 접속 1년이면 탈퇴와 같은 범위로 파기(`account_deletion_logs.reason = 'inactivity'`). 상세 4.6 |

### 4.5 구현이 정한 DB·보관·탈퇴 값 (v4.2, 모두 `[가정]`)

> 명세에 없어 백엔드 구현이 정한 값이다. 확인만 필요하며, 바꾸면 새 마이그레이션으로 반영한다.

**탈퇴 (F-COM-05)**

| 항목 | 값 |
|------|----|
| 순서 | `delete_account` RPC가 한 트랜잭션에서 `user_id`가 있는 public 테이블 전체와 `profiles`를 **명시적으로** 지운다(대화는 id 순서로 먼저 잠근 뒤 메시지 삭제) → 서버가 `auth.users`를 지운다. `auth.users` 연쇄는 안전망(`profiles`에서는 아무것도 연쇄되지 않음) |
| 진행 중 작업 | 취소 표시 없이 행째 삭제. 실행기는 heartbeat lost로 멈추고 키 복호화도 거부된다 |
| 파기 증빙 | `account_deletion_logs.subject_hash` = HMAC-SHA256(서버 비밀값, `"account:" + user id`), 소문자 hex 64자 CHECK, unique. 로그 행은 RPC 마지막에 한 번 insert(`requested_at`·`db_deleted_at` 함께). 같은 hash로 다시 부르면 첫 행 유지(멱등). 재가입 추적에는 쓰지 않는다. 비밀값이 없으면 아무것도 지우지 않고 실패 |
| auth 삭제 실패 | public 데이터는 이미 없고 세션은 남는다. 같은 RPC는 멱등으로 통과하고 auth 삭제만 다시 한다(이미 없는 auth 사용자는 성공). 재진입 경로는 UX FL-07·S-25(A7), 서버 판정(`get_account_deletion_state`)은 6.1 |
| 교착 | 대화 턴 완료(메시지 → 대화)·다른 탭 커리어 자동 저장(커리어 → `profiles`)과 겹치면 `40P01` 가능. 롤백되며 api가 1회 재시도 |

**보관 정리 크론**

| 항목 | 값 |
|------|----|
| 일정 | 보관 정리 매일 03:00 KST, 작업 안전망 매일 02:00 KST(Hobby 플랜 하루 1회. 작업 재개 주 경로는 화면 상태 폴링) |
| 배치 | 정리 RPC 1회 최대 `p_limit`(기본 5,000, 1~50,000)행, 잠긴 행은 건너뜀(`skip locked`). 꽉 차면 같은 실행에서 최대 4번 이어 부름 |
| `ai_usage_records` | 이번 KST 달 포함 13개 달 보관(2.9.2) |
| `ai_jobs` | 90일. 정리 때 결과 행 `ai_job_id`가 `set null` |
| ~~미연결 AI 작성 대화~~ | **v4.4 폐기**(CR-6, 3.4) — 크론 경로·`purge_unlinked_writing_chats`·인덱스 삭제 |

**초기값·길이 상한**

| 영역 | 값 |
|------|----|
| 정책 버전 (A.2) | **(v4.6, PT-1) 현재 = `2026-11-04` 3종**(시행 2026-11-04 00:00 KST, `terms`·`privacy` `requires_reconsent = true`, `cross_border_transfer` `false` — 가입 동의 대상이 아니라 게이트 영향 없음, 마이그레이션 `20261111000100_policy_versions_2026_11_04`). **`cross_border_transfer` `2026-11-04.1`**(같은 날 15:00 KST, 재동의 없음 — 연락처·보유 기간·Gmail 국외 처리 보완, PT-8, 마이그레이션 `20261113000100_policy_versions_cross_border_2026_11_04_1`)이 국외 이전 고지의 현재 행. `2026-10-01` 행은 기존 동의가 가리키므로 남긴다. 이전 값: `policy_versions` 3종 `version = '2026-10-01'`, `document_path = '/policies/{type}/{version}'`. 선택 동의는 `privacy` 버전을 따른다. ~~실제 문서·시행일은 출시 전 확정(D-10)~~ → **정책 문서 3종은 확정 2026-11-04 (사용자, PT-1)**, 이 행은 `[가정]`이 아니다(D-10은 AI 고지 `ai_disclosures`만 남음) |
| AI 고지 (2.11.6) | 6행 `v2026-10-29`, 배포 즉시 유효 |
| AI 작성 대화 패치 | **v4.4**: STAR 필드 값 ≤ 2,000자, 기간 `YYYY-MM`. 이름·역할·지표명·단위·스킬 패치는 없어짐. **v4.5**: 덧붙임 합계 검사는 화면 채우기 단계 + 저장 RPC 값 검사(`field_too_long`). 산출물 대화: 사실 ≤ 80개·각 ≤ 500자, 초안 `value` ≤ 8,000자·블록 ≤ 200개, `draft_count` ≤ 6, 저장 RPC `p_applied_proposals` ≤ 50개 `[가정]` |
| 커리어 (v4.4) | `projects.name`·`role` 100자(서버), STAR 각 2,000자·`description` 5,000자·`link_url` 2,048자(DB CHECK), 산출물 제목 100자·본문 20,000자·프로젝트당 50개, 대화 `title` 100자(서버가 30자로 채움) `[가정]` |
| JD | 회사명·포지션명 200자, 요건 500자·200개, 요건 키워드 1~100자, `detected_language` 1~16자, 해시 ≤ 128자 |
| 인사이트·근거 | 근거 원소 ≤ 2,000개, `item_key` ≤ 200자, `quote` ≤ 2,000자, `source_label` ≤ 300자, `prompt_version`·`model` ≤ 200자 |
| 서류 | 자소서 시드 문항 글자 수 1,000자·공백 포함, 문항 ≤ 10개, 문구 ≤ 1,000자, 글자 수 제한 1~10,000, 사용자 근거 선택 ≤ 5개, 블록 ≤ 500개·블록 텍스트 ≤ 5,000자·`block_id` `[A-Za-z0-9_.:-]{1,64}`, 섹션 ≤ 30개, 상세 id ≤ 20·요건 id ≤ 50 |
| 자소서 초안 `status` 계산 | 생성 중 문항(진행 중 작업 기준) 있음 → `generating` / 모두 `ready` → `ready` / `failed`·`ready` 섞임 → `partially_failed` / `failed`만(생성 전 포함) → `failed` / 그 밖 → `composing`. ready 초안에 문항을 추가하면 `composing` |
| 면접 | 질문·의도 1~1,000자, `good_answer_signals` 0~10개(각 ≤ 300자), `focus_criteria` 4키 중 0~4개, 대상·보완 요건 각 ≤ 20, `weak_requirement_ids` ≤ 50, `score_method_version` ≤ 100자. "응답됨" = 공백 아닌 글자가 있음 |

---


### 4.6 장기 미접속 계정 파기 (v4.6, PT-3, 구현 #25)

D-11에 더한 규칙이다(PRD NFR-PRV-06, 처리방침 3번). 화면은 없고 안내 메일만 있다.

| 단계 | 조건 · 처리 | RPC (실행 주체) |
|------|-------------|-----------------|
| 접속 기록 | 로그인한 요청마다 proxy가 호출(브라우저·사용자별 6시간에 한 번, RPC도 1시간 안 재기록은 건너뜀). `last_active_at := now()`, 대기 중 안내 취소(`inactivity_notice_sent_at := null`). 실패해도 페이지는 막지 않음 | `touch_last_active()` (authenticated, 본인 행) |
| 안내 대상 | 마지막 접속 + (1년 − 30일) 지남, 안내 전. Auth 이메일이 없는 계정은 건너뜀 | `list_inactivity_notice_targets(p_now, p_limit)` (service_role) |
| 안내 기록 | 운영자 Gmail(SMTP)로 보내고 **메일 서버가 받은 뒤에만** 기록. 행 잠금 아래 조건 재확인(그사이 접속하면 기록 안 함). 실패하면 다음 날 다시 | `mark_inactivity_notice_sent(p_user_id, p_sent_at)` (service_role) |
| 파기 대상 | 안내 후 30일 지남 + 마지막 접속 1년 지남 | `list_inactive_accounts_due(p_now, p_limit)` (service_role) |
| 파기 | 행 잠금 아래 재확인 뒤 `delete_account`와 같은 범위 삭제, `account_deletion_logs.reason = 'inactivity'` → 서버가 Auth 사용자 삭제 | `purge_inactive_account(p_user_id, p_subject_hash, p_now)` (service_role), 본문 `private.delete_account_data(uid, hash, reason)`를 `delete_account`와 공유 |
| Auth 정리 | 공개 데이터는 지웠지만 Auth 삭제가 실패한 사용자(`deletion_incomplete`, 사용자 탈퇴 미완료 포함)의 Auth 사용자 삭제 | `list_incomplete_account_deletions(p_limit)` (service_role) |

- 실행: 매일 보관 크론(`/api/cron/retention`)이 기존 보관 삭제 뒤에 돈다. 실행당 안내 30 · 파기 30 · Auth 정리 20, 연속 3회 발송 실패면 중단. 로그는 개수만 `[가정]`.
- **보낸편지함 사본 (R-PT-5, 확정 2026-11-04 (사용자))**: Gmail SMTP로 보낸 안내 메일은 운영자 보낸편지함에 사본이 남는다(이메일 주소·파기 예정일). **파기·탈퇴한 계정의 안내 메일만 운영자가 매월 한 번 직접 지운다**. 다시 접속해 유지된 계정의 안내 메일은 계정 정보와 같은 개인정보라 계정이 남아 있는 동안 따로 지우지 않는다(탈퇴·파기 뒤 같은 주기로 삭제). 자동 삭제는 없다.
- 안내 없는 파기는 없다: Gmail 설정(`GMAIL_SMTP_USER`·`GMAIL_SMTP_APP_PASSWORD`)이 없으면 안내가 나가지 않으므로 파기도 일어나지 않는다.
## 5. RLS·권한 방향

| 테이블 | select | insert | update | delete |
|--------|--------|--------|--------|--------|
| experiences / **educations** / projects / **project_deliverables**(v4.4) / skills / project_skills | 본인 | 사용자 세션 | 사용자 세션 | 사용자 세션 (`delete_career_item` 권장) |

- v4.4: `project_details`·`achievements` 정책·grant 삭제. `project_deliverables`·`project_skills`의 "독립 프로젝트만", `projects`의 소속 ↔ 독립 전환 금지는 RLS가 아니라 트리거·CHECK가 강제한다(2.3). `projects`의 STAR 컬럼 쓰기는 사용자 세션뿐이다 — **v4.5: S-10 페이지 저장 `save_project_page`(invoker)**. `apply_writing_chat_proposal`은 폐기. 산출물 쓰기는 S-44 `save_project_deliverable`(invoker).

| **writing_chats** | 본인 | definer RPC(`start_writing_chat`, **v4.5 `start_deliverable_writing_chat`**) | `structured_draft`는 **RPC `apply_structured_draft_patch`**(AI 턴 = `app_ai_writer`, 사용자 수정·수락 = 사용자 세션)와 **v4.5: 페이지 저장 RPC의 내부 헬퍼 `private.wc_mark_proposal_applied`**(`applied_at`·`applied_mode`·`applied_rev`)만. `project_id`·`project_deliverable_id`는 insert 뒤 바뀌지 않는다. **v4.4: 사용자 세션 직접 update는 `return_target`만**(`status` 직접 update 회수 — `closed` 전이는 definer RPC, 재개 전이 없음. `set_writing_chat_affiliation` 폐기). `message_count`·`last_activity_at`·`last_extracted_sequence`·`title`·`last_applied_at`은 definer RPC만 | 본인 |
| **writing_chat_messages** | 본인 | **v4.2: definer RPC만** — user = `append_writing_chat_message`(사용자 세션), assistant = `begin_assistant_message`(`app_ai_writer`) | definer RPC만(`finish_assistant_message`, `app_ai_writer`) | 연쇄만 |
| application_projects | 본인 | RPC | 본인(`name`, `deadline`, `memo`). **`stage`·`stage_outcome`·`stage_changed_at`은 RPC만**. v4.2: AI 쪽 `name`·`name_source`·`last_activity_at`은 `apply_jd_extraction` / `fail_jd_extraction`만 | 본인 |
| **application_stage_events** | 본인 | RPC만 | 없음 | 연쇄만 |
| job_descriptions / jd_requirements | 본인 | RPC(`create_application_project`, v4.3: 동의 필요·키 무효면 거부, 2.7.1), 요건은 추출 RPC | v4.2: AI 쪽은 `begin/apply/fail_jd_extraction`만. **v4.3: 사용자 쪽은 `update_failed_jd_raw_text`만**(직접 update grant 없음, 2.6.1) | 연쇄만 |
| 결과 테이블 (insights, drafts, draft_sections, draft_section_sources, interview_*, answer_evaluations, session_feedbacks) | 본인(면접 질문 비공개 컬럼 제외) | **v4.2: 소유·세대 검사 definer RPC만**(`begin_*` / `complete_*` / `fail_*` / `save_*`) | 같음. 사용자 편집은 사용자 세션의 해당 컬럼·RPC(F-DOC-04 편집본, F-DOC-08 근거 선택, 답변 `answer_text`) | 본인(지원 프로젝트·세션·초안 단위) |
| **evidence_links** | 본인 | **v4.2: 결과 저장 RPC 안에서만**. `app_ai_writer` 직접 INSERT 없음(A24) | 삭제 트리거만(원본 삭제 표시) | 연쇄·결과 삭제만 |
| **ai_provider_keys** (v4) / 뷰 **`ai_provider_keys_public`** (security invoker, 메타 컬럼만) | 본인, **메타 컬럼만**(암호 컬럼 grant 없음, `user_id`도 없음). 화면·서버는 뷰 `ai_provider_keys_public` 사용 | RPC `save_provider_key`(**v4.2: 서버 전용 역할**) | RPC(`save_provider_key` 교체·`record_provider_key_check` = **서버 전용 역할**, `mark_provider_key_invalid`·`record_provider_key_success` = `app_ai_writer`) | RPC `delete_provider_key`(사용자 세션) |
| **ai_data_use_consents** (v4) | 본인 | 사용자 세션 | `withdrawn_at`만 | 연쇄만 |
| **ai_usage_records** (v4) | 본인. v4.2: `app_ai_writer`도 본인 행 | `app_ai_writer` | 없음 | 보관 정리·탈퇴만 |
| `ai_price_tables` / `ai_disclosures` / `ai_providers` (v4) | 인증 사용자(`ai_disclosures`는 anon 포함) | 운영자 | 운영자 | 운영자 |
| 그 밖 | v2와 같음 | | | |

- **`app_ai_writer` 권한 (v4.2 개정, 구현 반영)**
  - 읽기: 커리어 6개 테이블 select(v4.4: experiences, educations, projects, **project_deliverables**, skills, project_skills — `project_details`·`achievements` grant는 테이블과 함께 삭제), `application_projects`(컬럼 단위, `memo` 제외), `job_descriptions`·`jd_requirements`, 결과 테이블, `evidence_links`, `ai_jobs`, `ai_usage_records`(본인 행).
  - 직접 쓰기: **`ai_jobs`**(상태·진행·`step_outputs` 등, 전이 트리거 적용), **`ai_usage_records` insert**. 그 밖 테이블에는 직접 insert/update 권한이 없다.
  - **RPC로만 쓰기**: 대화(`apply_structured_draft_patch`, `begin_assistant_message`, `finish_assistant_message` 등), JD 추출(`begin/apply/fail_jd_extraction`), 결과(`begin_*`·`complete_*`·`fail_*`), 근거(결과 RPC 안), 키 상태(`mark_provider_key_invalid`, `record_provider_key_success`), 실행 게이트(`check_ai_run_allowed`). 모든 쓰기 RPC는 security definer + 소유 검사 + 실행 세대(`run_generation`) 검사.
  - **`evidence_links` 직접 INSERT 권한 제거 (확정 2026-11-05 (사용자), A24 ★)**: 쓰는 코드가 없고, 직접 INSERT는 세대 검사를 거치지 않는다. 모든 근거는 소유·세대 검사 RPC로만 저장한다. 기존 컬럼 grant는 후속 마이그레이션에서 회수.
  - **`ai_provider_keys` 테이블 권한 없음**(암호문은 `app_key_reader`의 `get_provider_key_secret`으로만, 2.11.2).
- **서버 전용 역할 (v4.2, A19 ★)**: `save_provider_key`·`record_provider_key_check` 실행 권한. 서버가 세션 확인 뒤 `p_user_id`를 넘긴다. `authenticated`·`anon` execute 없음.
- **`app_key_reader` (v4 신설 역할)**: `get_provider_key_secret(ai_job_id)` 실행 권한만. 테이블 권한 없음. 작업 실행 서버만 이 역할로 연결한다.
- 운영자 SQL 역할·`pg_read_all_data` 구성원도 KEK 없이는 `ai_provider_keys` 암호문만 본다(KMS 권한이 서버 실행 계정에만 있음, NFR-KEY-07, 2.11.1 v4.2 문구). `application_stage_events`·`application_projects.stage*` 쓰기 없음(보드는 AI와 무관).
- RPC 실행 주체: **v4.5: `save_project_page`·`save_project_deliverable`**, `delete_career_item`, `reorder_project_deliverables`는 security invoker(사용자 RLS). 반영됨 기록 헬퍼 `private.wc_mark_proposal_applied`는 security definer + 소유 검사(대화 행 `user_id = auth.uid()`), 외부 execute 없음. `start_deliverable_writing_chat`은 security definer + 소유 검사. `apply_writing_chat_proposal`(v4.4)은 폐기. `save_writing_chat`·`hand_off_writing_chat`·`set_writing_chat_affiliation`은 폐기. **v4.2: `append_writing_chat_message`는 security definer + 소유 검사**(invoker면 사용자에게 메시지 직접 insert·`message_count` update를 열어야 해서 상한을 우회할 수 있음). `move_application_stage`, `set_application_outcome`은 security definer + 소유 검사(이벤트 insert를 사용자에게 직접 열지 않기 위해). **v4.3: `update_failed_jd_raw_text`도 security definer + 소유 검사**(`job_descriptions` update를 사용자에게 열지 않기 위해, `authenticated`만 execute, 2.6.1).
- `service_role`: 보관 정리·탈퇴 RPC, 서버 전용 키 RPC. 대화 테이블은 select·delete만(v4.4: 대화 보관 정리 크론은 없고 탈퇴에만 쓴다).
- Storage: v2와 같음(MVP 버킷 없음).

---

## 6. 데이터 최소 기준 판정 — `get_data_readiness()` (v4.4)

```json
{
  "counts": {
    "complete_experiences": 1, "complete_educations": 1,
    "complete_projects": 0, "projects_without_complete_star": 1,
    "standalone_projects_without_description": 0,
    "draft_experiences": 0, "draft_educations": 0, "draft_projects": 1,
    "profile_filled": true
  },
  "draft_item_ids": { "experiences": [], "educations": [], "projects": ["uuid"] },
  "features": {
    "insight":       { "ready": false, "missing": ["complete_project"], "hints": ["project_star"], "next_action": "writing_chat", "suggested_project_id": "uuid" },
    "draft":         { "ready": false, "missing": ["complete_project"], "hints": ["project_star"], "next_action": "writing_chat", "suggested_project_id": "uuid" },
    "job_interview": { "ready": false, "missing": ["complete_project"], "hints": ["project_star"], "next_action": "writing_chat", "suggested_project_id": "uuid" },
    "culture_fit_interview": { "ready": true, "data_sufficiency": "thin" }
  }
}
```

v4.4 다른 예:

```json
{ "ready": false, "missing": ["complete_project"], "hints": [], "next_action": "create_project" }
{ "ready": false, "missing": ["complete_project"], "hints": ["project_fields"], "next_action": "form", "suggested_project_id": "uuid" }
```

- **v4.4 변경 요약 (CR-2·CR-6·CR-7·CR-10, AI 요청 10, UX D-12)**:
  - `counts`: `complete_project_details`·`draft_project_details` **삭제**. `projects_without_complete_detail` → **`projects_without_complete_star`**(상황·행동이 비어 `draft`인 소속 프로젝트, 부모 경력·교육이 `complete`인 것만). **`standalone_projects_without_description`** 신설(프로젝트 내용이 비어 `draft`인 독립 프로젝트).
  - `draft_item_ids.project_details` **삭제**.
  - `suggested_mode` **삭제**(대화 모드가 하나). `next_action` 값에 **`create_project`** 추가.
  - `hints`: `complete_project_detail` → **`project_star`**(이름 변경), **`project_fields` 의미 변경**(아래), `profile` 그대로.
- `next_action` / `suggested_project_id`는 `ready = false`일 때만 온다. `next_action` ∈ `writing_chat` / `create_project` / `form`. `ready = true`면 둘 다 생략.
- **기능 키 매핑 (readiness ↔ `writing_chats.return_target.feature`)**: 변경 없음.

  | readiness `features` 키 | `return_target.feature` |
  |--------------------------|--------------------------|
  | `insight` | `insight` |
  | `draft` | `career_description` 또는 `cover_letter` (시작한 화면 기준) |
  | `job_interview` | `job_interview` |
  | `culture_fit_interview` | (복귀 없음 — 게이트 없음) |
- **D-01 v4.4** (PRD 9.1 D-01 `[가정]`): `complete_experiences ≥ 1` **그리고** `complete_projects ≥ 1`. complete 프로젝트 = **소속 프로젝트(이름 + 상황 + 행동, 부모 경력·교육이 `complete`) 또는 독립 프로젝트(이름 + 프로젝트 내용)**. 독립 프로젝트도 센다(AI 권고·PRD D-01 v4.5). **교육만 있고 경력이 없으면 미충족**(`missing: ["complete_experience"]`, 변경 없음).
- `missing` 값: `complete_experience`, `complete_project`. `hints` 값: **`project_star`**(STAR 미완으로 `draft`인 소속 프로젝트가 있음 — 화면 문구용), **`project_fields`**(아래), `profile`(참고).
- **`project_fields` (A18 ★ → v4.4 의미 변경)**: v4.2의 "이름·역할이 빠진 프로젝트"는 생기지 않는다(이름은 만들 때 필수, 소속 프로젝트에 `role` 없음). v4.4에서는 **프로젝트 내용이 비어 `draft`인 독립 프로젝트**가 판정 4단계에서 대상이 될 때 `hints`에 넣고 `next_action = "form"` + `suggested_project_id`(그 독립 프로젝트, 최근 수정순 1건)를 준다. 화면은 S-43 "프로젝트 내용" 섹션 편집을 연다(독립 프로젝트에는 AI 패널이 없음, D-AI-15 (a)).
- **`next_action` 판정 순서 (v4.4)** — "AI 사용 가능" = 활성 공급자 있음 + `key_status <> 'invalid'`(`needs_check`는 사용 가능, `consent_required`는 판정에 쓰지 않음 — v4.2와 같음):
  1. `missing`에 `complete_experience` → `form`, `suggested_project_id` 없음.
  2. `projects_without_complete_star > 0` → **AI 사용 가능이면 `writing_chat`, 아니면 `form`**, 둘 다 `suggested_project_id` = 그 소속 프로젝트(최근 수정순 1건), `hints`에 `project_star`. 화면: `writing_chat`이면 S-10 + 패널 새 대화, `form`이면 S-10 STAR 입력(페이지 저장, PA-3 — v4.5 R-PA-9) `[가정]`(v4.2는 AI 없으면 제안 없이 `form` — 이번에 대상 프로젝트를 함께 주도록 바꿈).
  3. `standalone_projects_without_description > 0` → `form` + `suggested_project_id` + `hints`에 `project_fields`.
  4. 그 밖(채울 프로젝트가 없음) → **AI 사용 가능이면 `create_project`**, **아니면 `form`**(제안 없음, 화면이 프로젝트 추가로 안내). **v4.5 (PA-3)**: `create_project`의 화면 경로는 "소속 고르기 → 빈 S-10(행 없음) + 패널"이다(이름 다이얼로그 없음, 경로는 UX). 행은 첫 저장 또는 첫 AI 메시지 직전 자동 저장 때 생기고, 게이트에서 왔으면 `start_writing_chat`의 `p_return_target`으로 복귀 대상이 들어간다(UX DM-9). 값·판정은 변경 없음.
- **세부 규칙 (v4.2 유지분)**
  - `missing`·`hints`는 항상 둔다(ready면 `missing: []`). `hints: ["profile"]`은 ready여도 붙인다(참고용). 세 기능(insight / draft / job_interview)은 같은 객체.
  - 카운트·`suggested_project_id`는 포함 규칙(소속 경력·교육이 draft면 제외)을 적용해 센다.
  - **`profile_filled`** = `desired_job_title`(공백 아님) / `total_years_of_experience` / `interested_industries`(비지 않음) 중 하나라도 있음(v4.2 그대로).
- `data_sufficiency` (AI C-1 정의): `ok` = D-01 충족 / `thin` = 미충족이지만 프로필 또는 complete 경력·교육·프로젝트 존재 / `none` = 없음.
- `draft_item_ids`는 경력·교육·프로젝트 ID만(v4.4).
- 같은 판정을 AI Route Handler가 다시 확인(v2와 같음). AI-12·**AI-13(v4.5)**·AI-08은 판정 대상 아님. 산출물은 완료 조건이 아니라 readiness 값에 변경 없음.
- **v4 AI 연결 상태**: 반환 최상위에 `"ai_connection": {"active_provider": "gemini" | null, "key_status": "valid" | "invalid" | "needs_check" | null, "connection_tier": "free" | "paid" | null}`를 더한다. 활성 공급자가 없거나 `key_status = 'invalid'`이면 AI 사용 불가로 보고 `writing_chat`·`create_project` 대신 **`form`**을 준다(키 없으면 섹션 직접 입력 안내, PRD 3.3, v4.4 판정 순서 2·4). AI 기능 자체의 잠금(F-AI-06)은 화면이 `ai_connection`으로 판단한다.
- **`ai_connection.consent_required`** boolean | null (2026-11-06 재검토 R-67, 사용자 확정 2026-11-06 (a), 백엔드 후속 ★): 활성 공급자의 `(provider, 활성 키 connection_tier)`에 2.11.5 재동의 규칙으로 동의가 필요하면 `true`(동의 행 없음, 또는 동의 뒤에 시행된 `requires_reconsent = true` 고지 있음). 판정은 `check_ai_run_allowed`·`retry_ai_job`과 같은 함수를 쓴다(구현 `private.ai_consent_allows_run`). 활성 공급자가 없으면 `null`. `key_status`와 따로 계산한다.
  - 예: `"ai_connection": {"active_provider": "gemini", "key_status": "valid", "connection_tier": "free", "consent_required": true}`
  - 화면: true면 AI 실행 버튼(요건 추출·서류 3종·인사이트·면접·AI 작성 대화·다시 시도)이 실행 전에 활성 공급자·등급으로 C-21을 연다. 경로 ③·④·⑤의 `key_missing`이 동의 필요 때문인지 화면이 구분하는 근거도 이 값이다(2.11.7).
  - `next_action` 판정 순서(위)는 바꾸지 않는다 `[가정]` — 동의는 C-21 한 번으로 풀리므로 폼으로 돌리지 않는다.
- **데이터 부족 → AI 작성 대화 → 복귀 (사용자 결정 U-5, 2026-10-24)**:
  1. 기능(인사이트·경력기술서·자소서·직무 면접)에서 `ready = false`이면 화면은 단순 차단 대신 **"AI와 대화하며 채우기"**로 이끈다. **v4.4**: `next_action: "writing_chat"` + `suggested_project_id`(STAR가 덜 찬 소속 프로젝트 → S-10 + 패널 새 대화) 또는 `next_action: "create_project"`(채울 프로젝트가 없음 → C-23 소속 선택 → 빈 S-10, 첫 저장하기 또는 첫 AI 메시지 때 `projects` 행 생성 후 그 패널에서 대화 — PA-3이 CR-6의 "이름만 넣어 먼저 만들기"를 대체, v4.5 R-PA-9). `missing`에 `complete_experience`가 있으면 경력은 폼 입력이 필요하므로 `next_action: "form"`(F-P1-16 경력 대화 작성은 Could). `suggested_mode`는 폐기.
  2. 패널에서 게이트 진입 새 대화를 시작할 때 `writing_chats.return_target`에 `{application_project_id, feature, params}`를 저장한다(v3.2 신설 컬럼). **DB에 두는 이유**: 대화는 여러 번에 나눠 이어 할 수 있어(F-P1-06) 브라우저 세션만으로는 복귀 대상이 사라진다. 일반 폼 경유 복귀(C-10)는 기존처럼 브라우저 저장.
  3. **v4.5: "저장하기"(`save_project_page`) 성공 후**(v4.4 반영 직후에서 바뀜 — 폼 채우기만으로는 커리어 데이터가 아님, AI UX-10) 화면이 `get_data_readiness()`를 다시 불러 `ready = true`면 `return_target`으로 돌아가고 컬럼을 비운다. 아직 미달이면 C-10 배너에 남은 항목을 보여 준다.
  4. AI 결과는 여전히 complete 데이터가 있어야 생성된다(게이트 기준 D-01 v4.4). 정리 결과(`structured_draft`)와 폼에 채운 저장 전 값은 기준에 세지 않는다. 저장으로 충족되면 패널에 "{기능}으로 돌아가기"(UX A-6, 자동 실행 없음).
  5. 컬처핏 면접 예외(데이터 없이 허용)는 `[가정]` 유지(U-5 리더 해석).

---

## 6.1 기능 ↔ 테이블·RPC 매트릭스 (PRD v3 5.1 Must 전체, R-26)

> R = 읽기, W = 쓰기. 저장 데이터가 없는 기능은 "없음(보기)". 커리어 테이블 쓰기는 모두 사용자 세션, AI 결과 쓰기는 `app_ai_writer`(5장).

| 기능 ID | 테이블 (R / W) | RPC·함수 |
|---------|----------------|----------|
| F-P1-01 기본 프로필 | R/W `profiles` | — |
| F-P1-02 경력 | R/W `experiences` | `delete_career_item` |
| F-P1-03 프로젝트 (v4.5) | R/W `projects`(이름·기간·분류 3종 `project_type`·`experience_type`·`competencies`·STAR). **소속 프로젝트는 S-10 페이지 저장으로 만들기·고치기**(PA-3), 독립 프로젝트는 이름만으로 `draft` 생성(CR-6) | **`save_project_page`**, `delete_career_item` |
| ~~F-P1-04 정량 성과~~ | v4.4 폐기(CR-11) — `achievements` 없음 | — |
| F-P1-05 스킬 (v4.4 범위 축소) | R/W `skills`, `project_skills`(독립 프로젝트만) | — |
| F-P1-06 자동 저장·이어하기 | W 커리어 테이블 `status = 'draft'`(섹션 편집 중 입력 보존은 화면, UX. **v4.5**: S-10·S-44는 페이지 단위 저장 + 이탈 확인·입력 보존(화면), 다른 곳에서 바뀜 = `stale_write`), R `writing_chats`(프로젝트별 대화 기록 — v4.4: 재개 전이 없음, `active`면 이어 씀) | — (트리거: 상태 재계산, `career_data_updated_at`) |
| F-P1-09 커리어 목록 + 상세 (v4.4) | R `experiences`, `educations`, `projects`(독립 = 목록 항목, 소속 = 카드), `project_deliverables`(제목), `project_skills`→`skills` | 없음(앱에서 시작 연도 계산, 2.4) |
| F-P1-13 AI 작성 대화 (v4.5) | W `writing_chats`(+`return_target`, `title`, `status`), `writing_chat_messages`, `ai_jobs`(`writing_chat_turn`), `ai_usage_records`; **저장하기 때** W `projects`(STAR·기간·분류·`source_writing_chat_id`) + `writing_chats`(`applied_at`, `last_applied_at`) | `start_writing_chat`, `append_writing_chat_message`, `apply_structured_draft_patch`, **`save_project_page`**(v4.4 `apply_writing_chat_proposal` 폐기) |
| F-P1-14 교육 | R/W `educations` | `delete_career_item`(`affiliation_mode = delete_projects`) |
| F-P1-15 STAR (v4.4) | R/W `projects.situation`·`task`·`action`·`result`·`learnings`(소속 프로젝트) | — |
| **F-P1-17 독립 프로젝트** (v4.4) | R/W `projects`(`role`, `description`, `link_url`, 기간), `project_skills` | `delete_career_item` |
| **F-P1-18 산출물** (v4.5) | R/W `project_deliverables`(페이지 저장). **산출물 AI 작성 대화(PA-1, F-P1-18 (6)~(8))**: W `writing_chats`(`project_deliverable_id`), `writing_chat_messages`, `ai_jobs`, `ai_usage_records`(`writing_chat`); 저장하기 때 W `writing_chats.structured_draft.deliverable.body.applied_*` | **`save_project_deliverable`**, **`start_deliverable_writing_chat`**, `append_writing_chat_message`, `apply_structured_draft_patch`, `delete_career_item`(`project_deliverable`), `reorder_project_deliverables` `[가정]` |
| **F-P1-19 분류 3종** (v4.4) | R/W `projects.project_type`·`experience_type`·`competencies` | — |
| F-AP-01 지원 프로젝트 만들기 | W `application_projects`(`stage = before_apply`), `job_descriptions`, `application_stage_events`(`created`); AI-01 W `jd_requirements`, `ai_jobs` | `create_application_project`(v4.3 게이트, 2.7.1) |
| F-AP-02 목록 | R `application_projects`, `job_descriptions`, `insights`, `drafts`, `interview_sessions` | — |
| F-AP-03 허브 | R 위 + `profiles.career_data_updated_at`, `ai_jobs` | — |
| F-AP-05 삭제 | W `application_projects` delete(하위 전체 + `application_stage_events` 연쇄) | — |
| F-AP-06 데이터 부족 안내 → AI 작성 대화 → 복귀 (U-5) | R 커리어 테이블(집계); W `projects`(v4.5: 빈 S-10 첫 저장·첫 메시지 직전 자동 저장 — `save_project_page`), `writing_chats.return_target` | `get_data_readiness`(`next_action` ∈ writing_chat/create_project/form, `suggested_project_id`) |
| F-ST-01 보드 | R `application_projects`(`stage`, `stage_outcome`, `stage_changed_at`, `deadline`), `job_descriptions`, `insights`, `drafts`, `interview_sessions` | — |
| F-ST-02 단계 이동 | W `application_projects`, `application_stage_events` | `move_application_stage` |
| F-ST-03 전형 결과 | W `application_projects.stage_outcome`, `application_stage_events` | `move_application_stage`(outcome 인자), `set_application_outcome` |
| F-ST-04 인터뷰 전형 팝업 | R `interview_sessions`(작성 중 세션) — 세션·사용량 쓰기 없음 | `move_application_stage` 반환값 `interview_prompt` |
| F-ST-05 전형 이력 기록 | W `application_stage_events` | `move_application_stage`, `set_application_outcome`, `create_application_project` |
| F-P2-01 JD 등록 | W `job_descriptions` | `create_application_project`. v4.3 입력 원인 실패 원문 수정: `update_failed_jd_raw_text`(2.6.1) |
| F-P2-02 요건 추출 확인 | R/W `job_descriptions`(`extraction*`), `jd_requirements`, `ai_jobs` | — |
| F-P2-04 인사이트 | R 커리어(팩: 소속 STAR, 독립 내용·산출물), `jd_requirements`; W `insights`, `evidence_links`(`project`·`project_deliverable` 포함), `ai_jobs`, `ai_usage_records` | `get_data_readiness` |
| F-P2-05 근거 확인 | R `evidence_links` + 원본 테이블 | — |
| F-P2-09 보완점 → 커리어 | R `insights`; 이동 후 W 커리어 테이블(C-23 프로젝트 추가 포함) 또는 `writing_chats` | — |
| F-DOC-01 경력기술서 | R 커리어(팩), `jd_requirements`, `insights`; W `drafts`, `draft_sections`, `evidence_links`, `ai_jobs`(+`draft_source_ranking` `output`), `ai_usage_records` | `get_data_readiness` |
| F-DOC-02 자소서 문항·초안 | W `drafts`(composing, 기본 3문항 시드), `draft_sections`, `evidence_links`, `ai_jobs`, `ai_usage_records` | — |
| F-DOC-03 근거·자리 표시 | R `draft_sections`(블록 `placeholders`, `flags`), `evidence_links` | — |
| F-DOC-04 편집·복사 | W `draft_sections.edited_content`, `drafts.edited_at`, `first_copied_at` | — |
| F-DOC-08 사용한 경력·프로젝트 | R/W `draft_section_sources`, `draft_sections`(`source_selection_mode`, `sources_modified_at`, `generation_no`) | — |
| F-DOC-09 문항 메모 | R/W `draft_sections.user_note` | — |
| F-P3-01 면접 준비 | R `interview_sessions`, `get_data_readiness`; W `interview_sessions`, `ai_jobs`, `ai_usage_records` | `get_data_readiness` |
| F-P3-02 질문 일괄 생성 | W `interview_questions`, `interview_answers`(빈 행), `evidence_links`, `ai_jobs`, `interview_sessions.question_validation_report`·`question_usage`(v4.2) | `complete_interview_questions` |
| F-P3-03 답변 작성·일괄 제출 | W `interview_answers.answer_text`, `interview_sessions` | `submit_interview_session` |
| F-P3-04 이어 쓰기 | R `interview_sessions`, `interview_questions`(공개 컬럼), `interview_answers` | — |
| F-P3-06 점수·평가 | W `answer_evaluations`(v4.3 `error_code`, 2.7.1), `session_feedbacks`, `evidence_links`, 점수 슬롯(`interview_answers.score_*`, `interview_sessions.score_*`), `ai_jobs` | — |
| F-P3-07 세션 기록 | R 위 테이블; W `interview_sessions.result_viewed_at`(v4.3 Q53-10, 2.7.1) | `mark_interview_result_viewed` |
| F-P3-13 컬처핏 데이터 부족 허용 | R `interview_sessions.data_sufficiency` | `get_data_readiness`(`culture_fit_interview`) |
| F-P3-15 모의 면접 메뉴 | R `interview_sessions` + `application_projects.name` (필터 `application_project_id`, `interview_type`, `status`) | — |
| F-COM-01 가입·로그인 | W `auth.users`, `profiles`(가입 트리거). (2026-11-04, D-09 변경) Auth 공급자는 **Google만** — 이메일(매직 링크) 공급자는 끈다. 테이블·컬럼 변경 없음 | — |
| F-COM-02 동의 | R `policy_versions`; W `consents` | — |
| F-COM-03 AI 학습 미사용 고지 | R `policy_versions` | 없음(보기) |
| F-COM-04 개별 삭제 | 커리어 테이블(+`project_deliverables`), `evidence_links`, `draft_section_sources`, 결과 테이블, `writing_chats`(v4.5: 산출물 대화 포함) | `get_deletion_impact`, `delete_career_item` |
| F-COM-05 탈퇴 | **v4.2**: RPC가 public 데이터(사용자 테이블 전체 + `profiles`)를 명시적으로 삭제하고 `account_deletion_logs` insert → 서버가 `auth.users` 삭제(연쇄는 안전망, 4.5). 약관 동의 게이트 없이 로그인만 확인. **탈퇴 미완료 판정**은 표 아래 | `get_account_deletion_summary`, `delete_account`, **`get_account_deletion_state`**(v4.2 `[가정]` ★) |
| F-COM-10 왼쪽 메뉴 | 없음(보기) | — |
| **F-AI-01 키 등록** (v4) | R `ai_providers`, `ai_disclosures`; W `ai_provider_keys`, `ai_jobs`(`key_verification`), `ai_usage_records`(`key_verification`), `profiles.active_ai_provider`(첫 키) | `save_provider_key`(v4.2 서버 전용 역할), `get_provider_key_secret` |
| **F-AI-02 교체·다시 확인·삭제** | W `ai_provider_keys`, `ai_jobs`, `ai_usage_records`, `ai_data_use_consents.withdrawn_at` | `save_provider_key`, `record_provider_key_check`(v4.2 서버 전용 역할), `record_provider_key_success`, `delete_provider_key` |
| **F-AI-03 활성 공급자** | R/W `profiles.active_ai_provider`; 결과 행 `provider`·`model` 기록 | `set_active_ai_provider` |
| **F-AI-04 데이터 사용 고지·동의** | R `ai_disclosures`; W `ai_data_use_consents` | — |
| **F-AI-05 Gemini 무료 키 가이드** | R `ai_providers`(`is_recommended`, `key_guide_version`) | 없음(보기) |
| **F-AI-06 AI 잠금 상태** | R `profiles.active_ai_provider`, `ai_provider_keys`(메타) | `get_data_readiness`(`ai_connection`) |
| **F-AI-07 사용량 미터** | R `ai_usage_records`, `ai_price_tables` | `get_ai_usage_summary` |
| **F-AI-08 한도·오류 안내** | R `ai_jobs`(`failure_cause`, `quota_resets_at`, `retry_after`, `error_category`), `ai_providers`(대시보드 링크); W `ai_provider_keys.status`·`last_failure_*` | `mark_provider_key_invalid` |
| **F-AI-09 공급자·등급 배지** | R 결과 행 `provider`·`model`·`connection_tier`, `ai_provider_keys` | — |

- 확인: Must 기능 중 대응 테이블·RPC가 없는 것은 F-COM-03, F-COM-10뿐이며 둘 다 저장 데이터가 필요 없다.
- **탈퇴 미완료 상태의 서버 판정 (v4.2, A7·리뷰 R-50, `[가정]` ★ 백엔드 후속)**
  - 상태: `delete_account` RPC가 public 데이터(`profiles`·동의 포함)를 지우고 `account_deletion_logs` 행을 넣은 뒤, 서버의 `auth.users` 삭제만 실패한 상태. 로그인 세션은 남는다(4.5 "auth 삭제 실패").
  - 판정 기준: **로그인한 auth 사용자에게 `profiles` 행이 없고, `account_deletion_logs`에 그 사용자의 `subject_hash` 행이 있으면 탈퇴 미완료**. `delete_account`는 한 트랜잭션이라 "public 일부만 지워짐"은 없고, 로그 행은 그 트랜잭션 마지막에 들어가므로 로그 행 = public 삭제 완료다.
  - 신규 가입자와의 구분: 신규 가입자는 가입 트리거로 `profiles`가 있고 동의 행만 없다 → 동의 게이트(S-03)로 간다. "동의 없음"만으로는 판정하지 않는다. `profiles`도 로그도 없으면 가입 트리거 누락(비정상)으로 보고 오류 로그 + 일반 오류 화면 `[가정]`.
  - 재가입과의 구분: `subject_hash`는 auth user id로 만들므로 탈퇴가 끝난 뒤 같은 이메일로 다시 가입하면 새 id → 다른 hash라 걸리지 않는다(재가입 추적에 쓰지 않는 원칙 유지, 4.5).
  - RPC: **`get_account_deletion_state(p_user_id)`** → `active`(`profiles` 있음) / `deletion_incomplete`(`profiles` 없음 + 로그 있음) / `profile_missing`(둘 다 없음). 실행 주체는 **서버 전용 역할**(security definer, A19와 같은 방식으로 서버가 세션의 user id를 넘김) — 사용자는 `account_deletion_logs`를 select할 수 없고 HMAC 서버 비밀값을 브라우저에 두지 않는다. hash 계산은 `delete_account`와 같은 함수·같은 비밀값을 쓴다.
  - 호출 시점: 로그인 직후·대시보드 레이아웃의 세션 확인에서 **`profiles` 행이 없을 때만** 부른다(정상 사용자는 매 요청 HMAC 계산 없음). `deletion_incomplete`면 동의 게이트보다 먼저 S-25 "탈퇴 마무리"(UX FL-07·S-25, A7)로 보낸다. 거기서 `delete_account`를 다시 부르면 멱등으로 통과하고 auth 삭제만 다시 한다(4.5).

## 7. API 경계 초안 (v3 변경분, v4.4 커리어 재설계, v4.5 페이지 저장·산출물 대화 반영)

| 작업 | 방식 | 읽기/쓰기 | 화면 |
|------|------|-----------|------|
| **커리어 목록 (v4.4)** | Server Component. 앱에서 시작 연도로 묶음(2.4) | R: `experiences`(id, company_name, start_month, status), `educations`(id, institution_name, **program_name**, start_month, status — v4.8: `name` = 교육 표시 이름, ED-2), `projects` **독립만**(`experience_id is null and education_id is null`: id, name, start_month, status) → 화면 타입 `{entity_type, id, name, start_month}` | S-08 왼쪽 |
| **경력·교육 상세 (v4.4)** | Server Component | R: 경력 또는 교육 1행 전체 + 소속 프로젝트 카드 `projects`(id, name, project_type, start_month, end_month, is_current) `where experience_id = ?`(또는 `education_id`) 정렬 `start_month desc nulls last, created_at desc` `[가정]` | S-08 오른쪽(S-09·S-34 패널) |
| **독립 프로젝트 상세 (v4.4)** | Server Component | R: `projects` 1행(name, start_month, end_month, is_current, role, description, link_url, status) + `project_skills`→`skills.name` + `project_deliverables`(id, title, sort_order, updated_at; 본문 제외) | S-43 |
| **산출물 상세 (v4.5)** | Server Component | R: `project_deliverables` 1행(id, project_id, title, body, updated_at) + 부모 `projects.name`(이동 경로) + `writing_chats`(id, title, status, message_count, last_activity_at, last_applied_at) `where project_deliverable_id = ?` `order by last_activity_at desc` + 연 대화의 메시지·`structured_draft`. 새 산출물은 행 없음(`/career/projects/{project_id}/deliverables/new`, UX S-44 — v4.5 R-PA-8) | S-44 |
| **산출물 저장하기 (v4.5 ★)** | Server Action → RPC `save_project_deliverable(p_project_deliverable_id, p_project_id, p_title, p_body, p_expected_updated_at, p_applied_proposals)` (사용자 세션, 동기, AI·키 불필요) | W: `project_deliverables`, `writing_chats`(반영됨 기록). 응답 `{project_deliverable_id, project_id, sort_order, updated_at, applied, skipped}`. 오류 `stale_write`·`deliverable_title_required`·`field_too_long`·`deliverable_limit_reached` | S-44 상단 바 "저장하기" |
| 산출물 삭제 | v4.4 그대로 `get_deletion_impact` / `delete_career_item('project_deliverable', …)` — `cascade.writing_chats` 포함(v4.5) | W: `project_deliverables`, `writing_chats`(연쇄) | S-44 ⋯ 메뉴, C-05 |
| **프로젝트 상세 (v4.4)** | Server Component | R: `projects` 1행(이름·기간·`is_current`·분류 3종·STAR 5필드·status) + 부모 경력/교육 이름(이동 경로) + `writing_chats`(id, title, status, message_count, last_activity_at, last_applied_at) `where project_id = ?` `order by last_activity_at desc` + 연 대화의 `writing_chat_messages`·`structured_draft` | S-10 |
| **섹션 저장 (v4.4, v4.5 범위 축소)** | Server Action(사용자 세션, 섹션 단위 update. 상태·`content_updated_at`은 트리거) | W: experiences / educations / projects(**독립 프로젝트 섹션만**: 정보·내용) / project_skills. v4.5: S-10은 섹션 저장을 쓰지 않는다 | S-08 패널(S-09·S-34·S-43, C-24) |
| **프로젝트 페이지 저장하기 (v4.5 ★)** | Server Action → RPC `save_project_page(p_project_id, p_values, p_expected_updated_at, p_applied_proposals)` (사용자 세션, 동기, AI·키 불필요). 행이 없으면 만들기(소속 + 머리 + STAR 전체) → 화면이 URL을 새 id로 바꿈 | W: `projects`, `writing_chats`(반영됨 기록). 응답 `{project_id, status, updated_at, applied, skipped}`. 오류 `stale_write`·`project_name_required`·`project_affiliation_required`·`field_too_long`·`invalid_period`·`invalid_classification`·`project_scope_change_not_allowed`. 복귀 대상이 있으면 이어서 `get_data_readiness` | S-10 상단 바 "저장하기" |
| **프로젝트 추가 (v4.4 CR-6 → v4.5 독립 프로젝트만 → v4.7 첫 저장 때)** | Server Action(사용자 세션 insert: `name` + 프로젝트 정보(`start_month`·`end_month`·`is_current`·`role`·`link_url`, 프로젝트 내용 `description`, 사용 기술 `project_skills`), 소속 없음) → 만들어진 id로 선택. **(v4.7, D-UX-28)** 이름만 받는 선행 insert는 없다 — S-43 새 독립 프로젝트를 처음 저장할 때 한 번 부른다. **소속 프로젝트는 v4.5부터 이 경로를 쓰지 않는다**(빈 S-10 → `save_project_page`, PA-3) | W: projects(`status = 'draft'`), project_skills | C-22 "프로젝트"·C-23 "소속 없음" → S-43 새 독립 프로젝트 |
| **AI 작성 대화 시작** (v4.5) | Server Action → definer RPC `start_writing_chat(p_project_id, p_return_target, p_form_snapshot)` / **`start_deliverable_writing_chat(p_project_deliverable_id, p_form_snapshot)`**: 대상 확인 → `writing_chats` insert + 고정 시작 인사(STAR 상태별 4종 / 산출물 3종, 스냅숏 우선, AI 없음). 활성 키 확인만 | W: writing_chats, writing_chat_messages | S-10·S-44 패널 "+ 새 대화", C-09 |
| **새 페이지의 첫 AI 메시지 (v4.5, 리더 정렬 1·2, UX D-UX-25 (a))** | 화면(Server Action 순차 호출, 한 트랜잭션 아님): ① 이름(S-10)·제목(S-44)이 비면 **보내지 않음**(화면이 칸에 포커스, 임시 이름 없음) ② AI 사용 가능 확인(`get_data_readiness().ai_connection` — 키 없음·무효·동의 필요면 여기서 멈추고 행도 만들지 않음) ③ **페이지 저장 RPC로 폼 전체 첫 저장**(행 생성, 실패 = 아무것도 안 생김) ④ 대화 시작 RPC(실패 = 행은 남음, URL 교체됨) ⑤ 대화 턴(이번 턴부터 `form_snapshot`) | W: projects 또는 project_deliverables → writing_chats → writing_chat_messages | S-10·S-44 패널 |
| 제안 카드 수정·검토 수락/거절 | Server Action → RPC `apply_structured_draft_patch` (사용자 세션) | W: writing_chats.structured_draft | S-10 패널 (C-15) |
| **대화 턴** (v4.5: 요청 본문 `{content, requested_slot?, requested_action?, style?, form_snapshot}` — `form_snapshot`은 2.5.1 모양, 저장·로그 없음, 서버가 AI 입력에서 DB 값보다 우선. 산출물 대화는 AI-13 이벤트 `facts_patch`·`draft_started`·`draft_block`·`draft_done` 추가, 초안 턴 전 `draft_count < 6` 검사) | Route Handler `POST /api/writing-chats/{id}/turns` (SSE: `turn_started` → `reply_delta` → `reply_done` → `draft_patch` → `draft_flags` → `turn_done`(`ready_to_return`, 산출물 대화는 + `draft_count`(R-PA-15). v4.5 R-PA-5: 빠른 버튼 3개는 화면이 AI-12·AI-13 칩 표로 계산하므로 내려 주지 않음) / `error`). ① definer RPC `append_writing_chat_message`(상한·`closed` 검사, 첫 메시지면 `title`) ② `app_ai_writer`로 extract·reply(입력은 요청의 `form_snapshot` 우선, 없으면 DB 값 — 리더 정렬 2, v4.5 R-PA-9) ③ V-9 검증 후 `apply_structured_draft_patch` ④ 호출마다 `ai_usage_records` insert ⑤ 상한이면 `closed` | W: writing_chat_messages, writing_chats, ai_jobs(`writing_chat_turn`), ai_usage_records | S-10·S-44 패널 |
| ~~반영 (v4.4)~~ | **v4.5 폐기 ★**: [반영]·[모두 반영]·[본문 교체]·[뒤에 덧붙이기]는 화면 폼 채우기(요청 없음). 확정은 위 "저장하기" 행 | — | S-10·S-44 패널 |
| 대화만 삭제 | Server Action → `delete_career_item('writing_chat', id)` 또는 직접 delete | W: writing_chats | S-10 패널 … 메뉴 |
| 데이터 최소 기준 | RPC `get_data_readiness` | | C-09, C-10 |
| 커리어 삭제 영향 / 삭제 | RPC `get_deletion_impact` / `delete_career_item` (`affiliation_mode`, `result_mode`) | | C-05 |
| **보드 조회** | Server Component | R: application_projects(stage, stage_outcome, stage_changed_at, deadline), job_descriptions, insights(유무), drafts(수), interview_sessions(수·작성 중) | S-39 |
| **단계 이동** | Server Action → RPC `move_application_stage` (낙관적 반영, 실패 시 원위치) | W: application_projects, application_stage_events | S-39, S-13, S-31 (C-12, C-14) |
| **결과 기록** | Server Action → RPC `set_application_outcome` | 같음 | C-13 |
| 전형 이력 (Should) | Server Component | R: application_stage_events | S-38 |
| 모의 면접 전체 세션 | Server Component | R: interview_sessions(+ application_projects.name), 필터 `application_project_id`, `interview_type`, `status` | S-37 |
| 탈퇴 범위 | RPC `get_account_deletion_summary` (v4: 키·동의·사용 기록 수 포함) | | S-25 |
| **AI 연결 화면** (v4) | Server Component | R: `ai_providers`, `ai_disclosures`, `ai_provider_keys`(메타), `ai_data_use_consents`, `profiles.active_ai_provider` | S-24 > AI 연결 |
| **키 등록·교체** (v4) | Server Action: 동의 insert → 원문으로 `key_verification` 작업(동기, 키 원문은 요청 메모리에만) → 성공 시 서버에서 키 행 id를 정하고 봉투 암호화 → **서버 전용 역할**로 RPC `save_provider_key(p_user_id, p_key_id, …)` (v4.2, A19) | W: `ai_data_use_consents`, `ai_jobs`, `ai_usage_records`, `ai_provider_keys`, `profiles` | AI 연결 |
| **다시 확인 / 등급 변경** (v4) | Server Action → `key_verification` 작업(`get_provider_key_secret`) → **서버 전용 역할**로 `record_provider_key_check(p_user_id, …)`. 등급 변경은 검증 통과 시 같은 행 id로 재암호화해 `save_provider_key`(2.11.3) | W: `ai_jobs`, `ai_usage_records`, `ai_provider_keys`, `ai_data_use_consents` | AI 연결 |
| **키 삭제 / 활성 공급자 변경** (v4) | Server Action → `delete_provider_key` / `set_active_ai_provider` | W: `ai_provider_keys`, `profiles`, `ai_data_use_consents` | AI 연결 |
| **사용량 미터** (v4) | Server Component → RPC `get_ai_usage_summary(period_month)` | R: `ai_usage_records`, `ai_price_tables` | 사용량 미터 화면 |
| **AI 실행 공통** (v4) | 모든 AI Route Handler: 활성 공급자·키 상태·동의 확인(**v4.2: 2.11.5 통일 규칙 — 동의 후 시행된 `requires_reconsent` 버전이 있을 때만 재동의**) → `ai_jobs`(provider·tier 기록, 실행 중 고정) → 단계마다 `check_ai_run_allowed` + `get_provider_key_secret` → 공급자 호출 → `ai_usage_records` insert → 결과는 소유·세대 검사 RPC로 저장 → 성공이면 `record_provider_key_success`, 키 원인 최종 실패면 `mark_provider_key_invalid` → 실패 시 `error_code`·`quota_resets_at`·`retry_after` | | 전체 |
| **실패 작업 다시 시도** (v4.2) | **경우 (1) 같은 행**: `POST /api/ai-jobs/{id}/retry`, 같은 행 `failed → queued`, **다시 시도 시점의 활성 공급자·등급으로**(A1 변경) — 작업 행 `provider`·`model`·`model_tier`·`connection_tier` 갱신, 다르면 `step_outputs` 비우고 그 작업이 저장한 결과 행(면접 질문·답변 평가·종합 등) 모두 다시 열어 덮어씀, 같으면 `step_outputs` 유지·실패한 행만 다시 엶(R-63). 결과 행 다시 열기는 `retry_ai_job` 안에서(R-70). 거부 코드는 2.11.7 경로 ②(활성 공급자 기준) — 다시 시도 대상 아님 409 `ai_job_not_retryable`(요청 범위 작업 유형, 입력 원인 실패 `input_too_long`/`safety_blocked`/`insufficient_data`/`not_a_jd`, `failed`가 아닌 행 — 연결 게이트보다 먼저, R-69), 키 없음 409 `key_missing`, 무효 409 `key_invalid`, 동의 필요 409 `ai_consent_required`, 준비 중 연결이 바뀜 409 `ai_connection_changed`(서버가 한 번 다시 읽은 뒤에도 어긋날 때만, 행 `failed` 유지). 진행 중이면 202 `inProgress`로 그 작업을 따라감. 판정 순서는 2.11.7. **경우 (2) 새 작업**: 인사이트 "다시 생성"(F-P2-07, 인사이트 생성 라우트를 다시 불러 새 `insight` 작업·새 버전, R-65), 요청 범위 작업의 다시 생성, 면접 "다시 채점"·"남은 질문 다시 만들기"는 각 생성·시작 라우트를 다시 불러 새 작업 행을 만들고 현재 활성 공급자로 돈다(거부 코드는 인사이트·면접 = 2.11.7 경로 ①, 요청 범위 작업 = 경로 ⑤, R-75). 두 경우 모두 활성 공급자, 구분은 2.9.1 | W: ai_jobs | 전체 |
| **공고 원문 수정** (v4.3, Q53-2) | Server Action(사용자 세션): 문장 분할·해시 → RPC `update_failed_jd_raw_text`. 재추출은 별도 요청(기존 추출 라우트) | W: `job_descriptions`, `application_projects.last_activity_at` | S-15 (S-16·S-33에서 이동) |
| 정기 배치 (v4 추가) | `ai_usage_records` 13개월 정리, 재시도 예약 스케줄러(`next_run_at`) — v4.2: 작업 재개 주 경로는 화면 상태 폴링, 크론은 안전망(4.5) | | — |
| ~~정기 배치: 연결 안 된 AI 작성 대화 90일 정리~~ | **v4.4 폐기**(CR-6). Vercel Cron 경로와 `purge_unlinked_writing_chats` 삭제 | — | — |
| 그 밖 | v2와 같음 | | |

---

## 8. 결정 필요

| ID | 질문 | 권고 | 담당 / 상태 |
|----|------|------|-------------|
| **D-DM-12** **확정 2026-11-03 (사용자): (a) 지금 범위 + 다음 고지 버전에 한 구절** (v4.5 신규) | 저장하지 않은 폼 값(`form_snapshot`)을 AI 공급자로 보내는 것을 지금 데이터 사용 고지·동의 범위로 볼까 (리더 정렬 2로 AI가 스냅숏을 읽게 됨. UX D-UX-26이 걱정한 점) | (a) **지금 범위로 본다** — 스냅숏은 사용자가 커리어 화면에 직접 쓴 값이고 저장 뒤 보내던 같은 필드다. 새 동의·`requires_reconsent` 없음, 고지 문구에 "작성 중인 내용 포함" 한 구절만 다음 고지 버전에 넣는다 (b) 새 고지 버전 + 재동의(`requires_reconsent = true`) — 모든 사용자가 AI 기능 전에 C-21을 다시 거친다 (c) 스냅숏을 보내지 않고 저장된 값만 읽는다(정렬 2 되돌림) | **권고 (a)**. 데이터 저장 모델은 어느 쪽이든 같다(스냅숏은 저장하지 않음, 2.5.1). (b)는 사용자 전원에게 재동의 부담이 생기고, (c)는 리더 정렬과 PA-3 흐름("채우고 바로 다음 질문")을 깬다. 법무 확인(D-39)과 함께 | **사용자 확인 대기** (product-planner·법무) |
| **PA-1~PA-4** (v4.5) | 산출물 AI 패널 / 산출물 분류 없음 / 페이지 단위 저장 / 머리 필드 통일 | PA-1 `writing_chats.project_deliverable_id`·산출물 모양·시작 RPC, PA-2 변경 없음, PA-3 `save_project_page`·`save_project_deliverable`·`apply_writing_chat_proposal` 폐기, PA-4 변경 없음(필드 그대로) | **확정 2026-11-03 (사용자)** |
| 리더 정렬 1~3 (v4.5) | 이름 없는 첫 메시지 / AI가 읽는 값 / 반영됨 기록 시점 | 1 = 보내지 않음(임시 이름 없음), 2 = `form_snapshot` 우선 + 첫 메시지는 폼 전체를 먼저 저장해 행 생성, 3 = 저장 트랜잭션 안에서 기록, 기록 실패는 저장을 막지 않음 | 리더 결정(2026-11-03), 2.5·2.5.1·7장 반영 |
| ~~D-DM-08~~ | 프로젝트와 연결되지 않은 AI 작성 대화의 보관 | — | **폐기 (v4.4, CR-6 확정 2026-11-02 (사용자))**: 묶이지 않은 대화가 없다 |
| **D-DM-11** (v4.4 신규) | 프로젝트 "진행 중" 표시(PRD F-P1-03 (3), UX D-15·P-2) | **(b) `projects.is_current` 추가** — 소속·독립 모두, `CHECK (NOT is_current OR end_month IS NULL)`, 표시 "YYYY.MM - 현재 (N년 N개월)"(2.3) | **확정 2026-11-02 (사용자), CR-22** (권고 (a)가 아님) |
| **D-UX-22** (v4.4 데이터 측) | 경력·교육 삭제 시 소속 프로젝트 | **(a) 함께 삭제** — FK cascade, `affiliation_mode = delete_projects`만(4.2). 확인 창에 프로젝트 수·대화 표시 | **확정 2026-11-02 (사용자), CR-15** |
| **Q-CR-1~4** (PRD v4.5 9.0) → CR-17·18·19·21 | 분류 값 목록 / 소속 프로젝트 기술 정보 / 독립 프로젝트 완료·대화 / 작성 중 배지 | 분류 값 목록·선택 방식 그대로(CR-17), 소속 프로젝트에 기술 정보 없음(CR-18, `project_skills` 독립 한정 유지), 독립 프로젝트 AI 대화 없음(CR-19, 트리거 유지 — **v4.5: 산출물 대화만 예외(PA-1), 정보·내용 대화는 AI D-AI-16 **확정 2026-11-03 (사용자): (a) MVP에 없음 유지****), 배지 대신 빈 STAR 도움말(CR-21, 스키마 영향 없음) | **확정 2026-11-02 (사용자)** |
| **D-AI-14 → CR-20** | AI 작성 대화가 분류 3종을 채우는가 | **추천 후 확인** — `structured_draft.classification` + 반영 RPC(2.5, 3.3). 빈 값만 추천, 덮어쓰기 없음(리더 결정, AI V-9i) | **확정 2026-11-02 (사용자)** (권고 (a)가 아님). 리더 결정으로 빈 값만 추천(AI 명세 `[가정]` 채택) |
| CR-16·CR-23·CR-24 | 스킬 목록 보류 / 화면 "기업 JD" → "자기소개서" / AI 연결 상태 줄 | 스키마 영향 없음. CR-23은 화면 문구만(내부 이름 그대로, 머리말 표기) | **확정 2026-11-02 (사용자)** |
| D-27 | 대화 기록 보관 | (a) 프로젝트에 묶어 보관, 대화만 삭제 가능 | **확정** (U-9). v4.4: 모든 대화가 프로젝트에 묶임 |
| D-UX-11 | 폼으로 전환 시 draft 저장 | (a) — `hand_off_writing_chat` | ~~확정 (T-6)~~ **대체됨 (v4.4, CR-5·CR-6)** — 폼 전환 없음, 반영(`apply_writing_chat_proposal`, D-UX-21) |
| D-UX-12 | 종료에서 나갈 때 결과 삭제 | (a) — 이전 결과는 `application_stage_events.from_outcome`에 남음 | **확정** (T-7) |
| 보강 대화 차감 | — | **v4 폐기**: 차감 개념 없음(D-34). 대화 월 한도(U-8 10회)도 BYOK 결정으로 대체 | 폐기 |
| 연도 미정 묶음 | 소속·기간 모두 없는 프로젝트 | 스키마 영향 없음(앱 계산) | **확정** (T-2) |
| `message_count` 상한 CHECK | 40 | **v4: CHECK 추가**(D-34에서 상한 확정). v4.2: 시작 인사 제외(A5) | **확정** |
| D-UX-21 (v4.4) | AI 제안을 커리어 데이터로 옮기는 방식 | (a) 대화당 제안 카드, 섹션별 반영, 있는 섹션은 덧붙임 | 데이터 측 수용. **v4.5 (PA-3)**: 반영 = 폼 채우기, 확정 = `save_project_page`(3.3). `apply_writing_chat_proposal` 폐기 |
| **D-DM-09** (v4 신규) | `ai_usage_records` 보관 | 13개월 | product-planner `[가정]` |
| **D-DM-10** (v4 신규) | 키 암호화 방식 | 앱 수준 봉투 암호화 + 외부 KMS(Vault 비권고, 2.11.2) | product-planner·구현 단계 |
| D-28, D-29, D-30, D-33, D-34, D-36, D-37 (v4) | 활성 공급자 1개 / 서버 암호화 저장 / 키 없는 JD pending / 미터 계산 / 운영비 개념 폐기·품질 제한 유지 / 키 삭제 시 결과 유지 / 무료 등급 재시도 | 스키마 반영(2.9, 2.11) | **확정** (PRD v4) |
| D-32 일부, D-39 | 등급 사용자 선택·고지 문구 / 법적 성격 | 동의 테이블이 공급자·등급·고지 버전별로 수용 | `[가정]` / 법무 |
| D-14, D-16 | 점수 산식·미응답 반영 | 스키마는 점수 슬롯만(산식 없음). D-16 (b) `[가정]` 유지 | **사용자 정의 대기** (U-1) |
| D-25 | 전형 결과 종류 | `stage_outcome` = `passed` / `failed` | **확정** (U-3) |
| 사용자 결정 일괄 (2026-10-24) | U-2 "회고 및 배운 점"(표시명, 컬럼 `learnings` 유지. **v4.4: 표시명 "배운 점"으로 대체, CR-2**) / U-4 메뉴 4개 / U-5 데이터 부족 → AI 작성 대화 → 복귀(6장) / U-6 JD 필수·교체 불가(D-19, DM-12 전제 확정. **v4.3 예외: 입력 원인 실패 JD의 원문 수정, Q53-2, 2.6.1**) / U-7 면접 유형 `job`·`culture_fit` / U-8 대화 한도 10(**v4에서 폐기**, D-34) / U-9 묶인 대화 계속 보관 / U-10 D-02·04·05·06·09·10·11·17·18 확정 | **확정** |
| **사용자 결정 일괄 (2026-11-05)** | A3 동의 재동의 현행 유지 / A5 메시지 40 = 사용자 + AI, 시작 인사 제외 / A6 그만둔 대화 재개(**v4.4 대상 없음**, CR-5·CR-6) / A8 그만둔 세션 답변 편집 불가 / A15 소속 제안 거절 미저장(**v4.4 대상 없음**) / A17 `tone` = `concise`·`detailed` / A18 hint `project_fields`(**v4.4 의미 변경**: 내용이 빈 독립 프로젝트, 6장) / A19 키 RPC 서버 전용 역할 / A20 재동의 규칙 통일 / A21 서류 안내 미저장 / A22 세션 `question_validation_report`·`question_usage` / A23 AI-11 대체 선택 없음(`user`) / A24 `evidence_links` 직접 INSERT 제거 | 2.5, 2.7, 2.11, 5장, 6장, A.2, A.9, A.12, A.13 반영 | **확정 2026-11-05 (사용자)**. ★(A5, A6, A18, A19, A20, A22, A23, A24)는 백엔드 후속 수정 |
| 구현이 정한 값 | 탈퇴 순서·파기 증빙, 보관 크론 기준, 초기 AI 고지 버전, 길이 상한 (정책 버전은 v4.6 PT-1로 확정) | 4.5 | `[가정]` (확인만) |
| 해소 | D-DM-06 (a), D-DM-07 무차감, D-AI-05 (STAR로 해소), D-AI-07~09 | PRD v3 9.2 | — |

### 8.1 리뷰 통합 결정 목록 중 데이터 모델 소관 회신 (v3.1, v3.2 갱신)

| 리뷰 # | 질문 | 데이터 모델 답 |
|--------|------|----------------|
| **T-18** (v3.2, v4.4 개정) | 검토 필요 필드 수락 상태 저장과 반영 규칙 | `structured_draft` 필드 `review = 'accepted'`(+ `reviewed_at`)로 저장, 거절은 값 비움. **v4.4: 저장·전환 RPC 폐기 — 반영(`apply_writing_chat_proposal`) 시 `needs_review`는 건너뜀** (2.5, 3.3). **v4.5**: 반영 = 화면 폼 채우기라 `needs_review`는 채우지 않고, 저장 RPC도 남은 `needs_review`는 반영됨으로 기록하지 않는다(`skipped` `needs_review`, 2.5.1) |
| **T-19** (v3.2) | 확정 소속의 위치 | **v4.4 폐기**(CR-6): 대화는 항상 프로젝트에 묶이고 소속은 `projects.experience_id`/`education_id`에 있다. `writing_chats.experience_id`/`education_id`·`set_writing_chat_affiliation` 삭제 |


| 리뷰 # | 질문 | 데이터 모델 답 |
|--------|------|----------------|
| T-6 | 폼으로 전환 시 draft 저장 | **(a)로 확정(데이터 측)**. `hand_off_writing_chat`이 사용자 확인 후 커리어 테이블에 쓰고(완료 판정대로, 대부분 `draft`), `writing_chats.status = 'handed_off'`, `project_id`를 채운다. 이 RPC는 v3부터 정의돼 있어 추가 변경 없음 |
| T-7 | 종료에서 다른 열로 옮길 때 결과 | **(a)로 확정(데이터 측)**. `move_application_stage`가 `stage_outcome = null`로 만들고 이전 값은 `application_stage_events.from_outcome`에 남는다 |
| T-10 (CHECK 시점) | `message_count` 상한을 언제 CHECK로 둘까 | **상한 확정 후 CHECK.** 그전엔 RPC 검사만(2.5, R-25). 나머지 사용량 세부(첫 턴 성공 시 차감, 보강 대화 1회, 40 = 합계, 한도 도달 시 이어 하기·저장·전환 허용)는 2.9 규칙표와 같다 — product-planner가 PRD 6.4 문구만 맞추면 된다. **v4 폐기**: 차감·대화 한도 부분은 BYOK로 폐기(D-34), CHECK ≤ 40은 v4에서 추가(2.9.4) |
| T-16 | 완료 조건·D-01 v3 | **데이터 측 정의 확정**: 상세 내용 = `title` + `situation` + `action`, 프로젝트 = `name` + `role` + complete 상세 내용 ≥ 1(트리거), D-01 = complete 경력 ≥ 1 + complete 프로젝트 ≥ 1, 교육만으론 미충족(2.2, 6장). PRD `[가정]` 태그 해제는 product-planner. **v4.4 대체(CR-2·CR-10)**: 소속 프로젝트 = `name` + `situation` + `action`, 독립 프로젝트 = `name` + `description`, 상세 내용·`role` 조건 폐기, D-01은 그대로 complete 경력 ≥ 1 + complete 프로젝트 ≥ 1(2.2, 6장) |
| T-17 | 민감정보로 걸러진 발화의 원문 | **(a) 원문 보관을 데이터 측 권고로 확정**. `writing_chat_messages.content`는 사용자가 쓴 그대로 보관하고(가림 처리 컬럼·작업 없음), `structured_draft`에는 옮기지 않는다(개수만). 사용자는 대화만 따로 삭제할 수 있다(3.4). (b)로 바뀌면 `content` 마스킹 작업 + `redacted_at` 컬럼이 필요 |
| T-2 | 연도 미정 묶음 | 스키마 영향 없음(앱 계산, 2.4). 권고 (b) + "연도 미정"을 그대로 구현 가능 |
| T-9 | 답변란 여는 시점 / 점수 준비 중 표시 | 이미 반영: 답변 update RLS가 `generation_status = 'ready'`를 요구(A.13), 점수 슬롯 `score_status = 'pending_method'`(A.12) |

- U-9 확정(묶인 대화 계속 보관). D-DM-08(미연결 대화 90일)은 v4.4에서 폐기(CR-6). T-6·T-18 저장·전환 규칙 중 "`needs_review`는 쓰지 않음"은 반영 RPC에 그대로 이어진다. T-19(확정 소속 위치)는 v4.4에서 대상이 없어졌다(소속은 프로젝트 컬럼).
- R-13 확정에 따라 머리글 표기를 고쳤다(v3.2).

---

## 9. 테이블 목록 (v3)

- MVP 사용자 테이블 **28** (v4: `usage_events` 삭제, `ai_provider_keys`·`ai_data_use_consents`·`ai_usage_records` 추가 / **v4.4: `project_details`·`achievements` 삭제, `project_deliverables` 추가**): profiles, consents, experiences, **educations**, projects, **project_deliverables**, skills, project_skills, **writing_chats**, **writing_chat_messages**, application_projects, **application_stage_events**, job_descriptions, jd_requirements, insights, drafts, draft_sections, draft_section_sources, interview_sessions, interview_questions, interview_answers, answer_evaluations, session_feedbacks, evidence_links, ai_jobs, **ai_usage_records**, **ai_provider_keys**, **ai_data_use_consents**
- Should 4: chat_threads, chat_messages, result_ratings, ai_suggestions
- 참조·운영 5: policy_versions, **ai_price_tables**, **ai_disclosures**, **ai_providers**, account_deletion_logs (v4: `usage_limits` 삭제)
- 뷰 1: **`ai_provider_keys_public`** (`ai_provider_keys`의 메타 컬럼만, security invoker — 본인 행만)
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
| **v4** | 2026-10-26 | **BYOK (PRD v4·UX v5·AI v4).** (1) **`ai_provider_keys` 신설**(공급자별 1개, 봉투 암호화 + 외부 KMS, 암호 컬럼 grant 없음, `app_key_reader` + `get_provider_key_secret(ai_job_id)`로 실행 시점 복호화, RPC `save_provider_key`·`record_provider_key_check`·`mark_provider_key_invalid`·`delete_provider_key`·`set_active_ai_provider`). (2) **`profiles.active_ai_provider`**(키 FK, set null). (3) **`ai_data_use_consents`** + 참조 `ai_disclosures`·`ai_providers`. (4) **`ai_usage_records`·`ai_price_tables` 신설, `get_ai_usage_summary`**. (5) **삭제**: `usage_events`, `usage_limits`, `writing_chats.usage_event_id`, 예약·차감·해제·무료 한도. (6) `writing_chats.message_count` CHECK ≤ 40(D-34). (7) `ai_jobs`: `provider`·`model_tier`·`connection_tier`, `attempt_count` → `retry_count`, `next_run_at`, `progress.waiting_retry_until`, `error_code` 교체(+`key_missing`), `error_category` 5값, `failure_cause`(generated 7값), `quota_resets_at`, `retry_after`, `job_type` `key_verification`, 동시 실행 1개 partial unique, 재사용 해시에 공급자·모델. (8) AI 출력 공통 메타에 `provider`·`model_tier`·`connection_tier`(+ `draft_sections`, `writing_chat_messages`), `job_descriptions.extraction_provider`/`extraction_model`. (9) 키 없는 JD `pending`·`default` 이름. (10) readiness `ai_connection`, 탈퇴 집계에 키·동의·사용 기록. (11) 11장 v4 회신·rename U5-1~U5-14 / A4-1~A4-12 |
| v4.1 | 2026-10-26 | BYOK 리뷰 라운드 1. **R-40**: `interview_sessions.question_provider`·`question_model`·`evaluation_provider`·`evaluation_model` 신설, 세션 목록 "실행 공급자" 표시 규칙. **R-38**: 검증 중 429·일일 한도·장애면 `needs_check`로 저장(`save_provider_key` 인자 `verification_result`), `record_provider_key_check` 상태 규칙. **R-43**: 3.3 "(1회 차감)" 삭제, T-10 행 "v4 폐기" 주석. **UB-2 (b) `[가정]`**: `get_ai_usage_summary` 기본 응답 = 요청 월 기능별 + 공급자별, 지난달 비교는 `include_previous` 인자로 선택. **이름 변경 없음**(신규 컬럼 4개, RPC 인자 2개 추가) |
| v4.1a | 2026-10-27 | BYOK 리뷰 라운드 2. R-38 잔여: 2.11.2 등록 저장 문구를 2.11.3 `valid`/`limited` 규칙으로 정렬. R-45: `ai_jobs.retry_wait_total_ms` 신설(재시도 대기 누적, 120초 상한), `save_provider_key` 시그니처에 `verification_result` 추가, `ai_provider_keys_public` 뷰를 5장·9장에 명시. **이름 변경 없음** |
| **v4.2** | 2026-11-05 | **백엔드 구현 반영(2026-11-05)** (PRD v4.3·UX v5.3·AI v4.3). **사용자 확정**: A3(A.2 재동의 판정), A5(시작 인사 제외 40, 2.5·2.9.4), A6(`abandoned → active` 재개, 2.5·3.4·7장), A8(A.13 그만둔 세션 답변 편집 불가), A15(소속 제안 거절 미저장), A17(`options.tone` `concise`/`detailed`), A18(hint `project_fields` + `form` + `suggested_project_id`, 판정 순서, 6장), A19(`save_provider_key`·`record_provider_key_check` 서버 전용 역할 + `p_user_id`), A20(재동의 규칙 통일, 2.11.5), A21(서류 안내 미저장), A22(`interview_sessions.question_validation_report`·`question_usage`), A23(대체 선택 없음 → `user`), A24(`app_ai_writer` `evidence_links` 직접 INSERT 제거). **구현 반영(B)**: 쓰기 경로를 definer RPC로 좁힘(대화·지원 프로젝트·JD·결과·근거, 5장), `app_ai_writer`의 `ai_usage_records` 본인 select, `ai_jobs.step_outputs`·`run_generation`·`target_type` 값·상태 전이·경력기술서 프로젝트당 1개 인덱스, `check_ai_run_allowed`, 가격표 `long_context_cached_input_usd_per_mtok`·`long_context_cache_write_usd_per_mtok`, `save_provider_key` 인자 `p_key_id`·`p_failure_cause`·`p_encryption_version`, `record_provider_key_success`, `get_provider_key_secret`의 `key_id`·`key_not_available`, 뷰 `ai_provider_keys_public` 사용 이유, 2.11.1 암호 컬럼 문구 정정, 결과 테이블 내부 컬럼(`run_generation`, `completed_at`, 세션 작업 컬럼, `ai_job_id` 복합 FK), `writing_chats.last_extracted_sequence`, `interview_prompt.in_progress_session`, 근거 규칙(`user_note`·`interview_answer`, 저장 직전 원본 삭제, 소유자별 허용 출처), 4.2 모드 값·집계·초기화 범위, S2 규칙(`kind`, `normalized_name`, `profile_filled`, readiness 세부), 6.1 탈퇴 표현. **구현 값(C)**: 4.5 신설 `[가정]`. **이름 변경 없음**(신규 이름은 11.5). **리뷰 R-48·R-49·R-50·R-53·R-54 반영**: 2.9.1 다시 시도 경우 구분(같은 행 / 새 작업), 2.11.7 연결 게이트 거부 코드 경로별 표(`ai_consent_required`는 HTTP 409 경로만), 6.1 탈퇴 미완료 판정 `get_account_deletion_state` `[가정]` ★, 2.5 재개 진입점 UX 기준, `tone` null = `concise`. **A1 변경(사용자, 2026-11-05 후속) 반영**: 모든 다시 시도·재실행 = 활성 공급자(R-48 리더 해석 "같은 행 = 처음 공급자" 폐기). 같은 행 다시 시도 때 `ai_jobs.provider`·`model`·`model_tier`·`connection_tier` 활성 값으로 갱신, 다르면 `step_outputs` 비움(0장 DM-17, 2.9.1 `provider`·상태 전이·다시 시도 표, 2.11.7 경로 ②, 7장, 11.1 표, 11.5). **리뷰 R-63·R-65 반영**: R-63 공급자·등급이 다른 같은 행 다시 시도는 그 작업이 저장한 결과 행도 모두 다시 열어 덮어씀(같으면 실패 행만) — 0장 결과 테이블 내부 컬럼, 2.9.1 상태 전이·표·RPC 동작·★, 7장, 11.5 ★. R-65 인사이트 "다시 생성"을 2.9.1 (2)·7장 새 작업 목록에 추가. R-62 DM 몫: 11.5 해소 항목 표시. **2026-11-06 추가(사용자가 판단 위임 → 리더 판단)**: 2.11.7 경로 ② `ai_connection_changed`(409)·판정 순서, 경로 ⑤ 요청 범위 작업 시작(동의 필요 = `key_missing`). **2026-11-06 재검토 반영**(리뷰 재검토 라운드 1, 버전 유지): R-67 리더 판단 (a) → **사용자 확정 2026-11-06** ★ — readiness `ai_connection.consent_required` 추가(6장, 2.11.7, 11.5). R-69 `ai_job_not_retryable` 대상을 구현에 맞춤(요청 범위 작업 유형·입력 원인 실패·`failed` 아닌 행) + 경로 ② 전체 판정 순서(not-retryable이 게이트보다 먼저, 2.9.1·2.11.7·7장). R-70 결과 행 다시 열기 주체 `begin_*` → `retry_ai_job`(같은 트랜잭션), 끝난 결과 묶음 제외 `[가정]`·질문 삭제 후 재생성 `[가정]`·`input_hash` 비움(2.9.1). R-71 2.9.1·11.5·2.11.7 ① ★를 "구현됨 (42f7611)"으로. R-72 7장 retry 행·11.5 표에 `ai_connection_changed`·경로 ⑤ 추가. 이름 변경 없음 |
| **v4.8** | 2026-11-04 | **교육 표시 이름 (결정 사이클 education-name, ED-2·ED-3·ED-6, 확정 2026-11-04 (사용자))**, 구현 PR #29·마이그레이션 `20261113000200` 반영. (1) **ED-2** 교육 표시 이름 규칙(trim한 `program_name` → trim한 `institution_name` → null, JS `trim()` 공백 집합) 신설(2.3 educations), 커리어 목록 응답 `name`(2.4·7장, 읽는 열에 `program_name` 추가). (2) **ED-3** `evidence_links.source_label`(교육 근거)·`draft_section_sources.source_label`("부모 › 프로젝트")의 교육 이름 = 표시 이름(2.7·2.8·A.11·A.14), 기존 행 백필(원본 교육이 삭제된 행은 그대로, 행 삭제 없음), DB 헬퍼 `private.education_display_name`·`private.trim_js_whitespace`, `private.draft_source_parent_name` 교육 분기·교육 삭제 트리거 `private.draft_sources_mark_education_deleted` 개정, 운영자 전용 `private.backfill_education_display_labels()`(4.1·11.4). (3) **ED-6** 화면 라벨 `program_name` = "교육 명"(선택), `institution_name` = "운영 기관 *"(필수·완료 판정 변경 없음), 피그마 "교육 직무" `[가정]` 대체. ED-4(AI 입력·`prompt_version` 불변)를 적용 범위 밖으로 명시. (4) **ED-7**(후속 결정, 설명만): `educations.education_type`·`enrollment_status`는 화면 입력이 아니고 앱이 정함 — 새 교육 `course`·수정 때 유지(`degree`는 CHECK에 남지만 화면에서 못 만듦), 상태는 기간에서 도출(2.3, `add-career-dialog.tsx:175–178`), 완료 판정 변경 없음, 백엔드 변경 없음(11.4). 테이블·컬럼·public RPC 시그니처 변경 없음 |
| **v4.7** | 2026-11-04 | **독립 프로젝트 생성 시점 — D-UX-28 변경 (확정 2026-11-04 (사용자))**. 독립 프로젝트 행은 S-43 새 독립 프로젝트의 첫 저장 때 이름 + 프로젝트 정보로 한 번에 insert(C-23 이름 다이얼로그 선행 insert 폐기). `projects.name` 비고, 2.5 쓰기 경로, API 경계 "프로젝트 추가" 행. 스키마·RPC·RLS 변경 없음. 리더가 직접 고쳤다 |
| **v4.6** | 2026-11-04 | **처리방침·이용약관 확정과 장기 미접속 파기 (확정 2026-11-04 (사용자), PT-1·PT-2·PT-3)**, PRD v4.8·UX v5.8. 구현 #24·#25를 반영. (1) 4.5 정책 버전 현재 `2026-11-04`(재동의 terms·privacy). (2) 4.4 접속 기록 최대 1년·장기 미접속 행. (3) **4.6 신설**: 장기 미접속 파기 단계와 RPC(`touch_last_active`, `list_inactivity_notice_targets`, `mark_inactivity_notice_sent`, `list_inactive_accounts_due`, `purge_inactive_account`, `list_incomplete_account_deletions`, `private.delete_account_data`). (4) A.1 `last_active_at`·`inactivity_notice_sent_at` 용도. 테이블·컬럼 변경 없음 |
| **v4.5** | 2026-11-03 | **프로젝트 추가·산출물 상세 Figma 결정 반영(PA-1~PA-4, 확정 2026-11-03 (사용자))**, PRD v4.6·UX v5.6·AI v4.6, 리더 정렬 3건. (1) **`writing_chats.project_deliverable_id`** 신설(복합 FK `(project_deliverable_id, project_id, user_id)` → `project_deliverables on delete cascade`, `project_id`는 부모 독립 프로젝트로 늘 채움, 대상 = 산출물 있으면 산출물), 트리거 `writing_chat_requires_affiliated_project` → `writing_chats_check_target`, `return_target` 산출물 대화 null CHECK, 인덱스 `(project_deliverable_id, last_activity_at desc)`, `project_deliverables` `unique (id, project_id, user_id)`. (2) **DM-21 페이지 저장 RPC** `save_project_page`·`save_project_deliverable`(만들기·고치기, `p_expected_updated_at` → `stale_write`, `p_applied_proposals`로 반영됨 기록을 같은 트랜잭션 하위 블록에서, 기록 실패는 `skipped`), 거부 코드 신설. (3) **`apply_writing_chat_proposal` 폐기**, 내부 헬퍼 `private.wc_mark_proposal_applied`, DM-13 개정, 3.3 표 재작성(반영 = 폼 채우기). (4) `start_writing_chat`에 `p_form_snapshot`(시작 인사 분기용), **`start_deliverable_writing_chat` 신설**, "새 대상" kind 없음 — 첫 메시지는 페이지 저장 → 대화 시작 → 턴(7장). (5) `structured_draft`: 필드 `rev`(슬롯 단조), `new_object` 패치, V-9h·기간·분류의 DB 거부 → 낮춤(`classification_already_set` 거부 삭제), 대상별 패치 범위, **산출물 모양 2.5.0**(`target`, `writing_kind`, `facts[]`, `deliverable.body`, `draft_count` ≤ 6 → `writing_chat_draft_limit_reached`). (6) `projects.updated_at`은 `source_writing_chat_id`만 바뀌면 오르지 않음, `projects.source_writing_chat_id` 기록 주체 = `save_project_page`. (7) 산출물 분류 컬럼·`source_writing_chat_id` 두지 않음(PA-2, DA-13). (8) 삭제: `cascade.writing_chats`에 산출물·독립 프로젝트의 산출물 대화, 탈퇴 집계 대화 합계. (9) 미터 `writing_chat` 공유, `call_key` `…compose`, `progress.stage` `compose`·`validate`. (10) readiness 값 변경 없음(복귀 재판정 시점 = 저장하기 뒤), 6.1·7장(`form_snapshot` 턴 계약, 첫 메시지 순서). (11) D-DM-12 **확정 2026-11-03 (사용자): (a) 지금 범위 + 다음 고지 버전에 한 구절**(스냅숏 고지 범위). (12) 3.7 이름 확정, 11.3 백엔드 후속. **이름 변경**: AI `p_deliverable_id` → `p_project_deliverable_id`, `p_applied_proposal`(객체) → `p_applied_proposals`(배열), `project_status` → `status`, `mark_writing_chat_proposal_applied` → `private.wc_mark_proposal_applied`, `start_writing_chat(p_target jsonb)` → `start_writing_chat(p_project_id, …)` + `start_deliverable_writing_chat`, `value_too_long` → `field_too_long` / UX `applied: [{writing_chat_id, fields}]` → `p_applied_proposals: [{writing_chat_id, field, rev}]`. 회신 `_workspace/project-add-figma/dm_replies.md`. **리뷰 라운드 1 수정(2026-11-03, `_workspace/03_spec-reviewer_review_project-add-figma.md`)**: R-PA-8 7장 산출물 상세 행의 새 산출물 URL을 UX `/career/projects/{project_id}/deliverables/new`로. R-PA-9 대체된 규칙 정리 — 2.5 사용자 패치(반영 뒤 고치기 = STAR 입력란·페이지 저장)·2.5 `is_current`(S-10 기간 입력), 6장 `next_action` ② `form`(S-10 STAR 입력), 6장 게이트 `create_project`(C-23 소속 선택 → 빈 S-10, 첫 저장·첫 AI 메시지 때 생성, PA-3), 7장 대화 턴 ②(`form_snapshot` 우선, 없으면 DB 값). 리더 판정(AI-13·S-44): 산출물의 수락하지 않은 `needs_review` 블록은 채우기 결과에서 뺌, 블록별 수락 / [빼기], 패치 경로에 초안 전체 거절 없음 — 2.5.0 사용자 패치·3.3 표·채우기 규칙에 명시, 2.5.1 `skipped` `needs_review`의 산출물 뜻을 "채울 내용 블록 없음"으로 좁힘. 테이블·컬럼 이름 변경 없음 |
| **v4.4** | 2026-11-02 | **커리어 화면 재설계 반영(CR-1~CR-14, 확정 2026-11-02 (사용자))**, PRD v4.5·UX v5.5·AI v4.5. (1) **DM-19**: STAR를 `projects` 컬럼(`situation`·`task`·`action`·`result`·`learnings`)으로 합치고 **`project_details` 폐기**(근거 기록 0장). (2) **`achievements` 폐기**(CR-11) — 관련 FK·`source_writing_chat_id`·근거 `achievement`·삭제 연쇄 제거. (3) **DM-20**: 소속 / 독립 프로젝트 구성 CHECK, 소속 ↔ 독립 전환 금지, 경력·교육 FK `set null → cascade`. (4) `projects`: `project_type`·`experience_type`·`competencies`(값 목록 키 확정, 역량 최대 3) / `description`(≤ 5,000)·`link_url` 신설 / `role` 독립 전용·필수 해제 / `name` not null / `summary`·`team_size` 삭제 / `content_updated_at` 신설 / `source_writing_chat_id` = 마지막 반영 대화. 완료 판정: 소속 = 이름 + 상황 + 행동, 독립 = 이름 + 내용(CHECK 하나, 자식 트리거 폐기). (5) **`project_deliverables` 신설**(독립 프로젝트만, 제목 ≤ 100·본문 ≤ 20,000, 50개 `[가정]`), `project_skills` 독립 프로젝트 한정. (6) **`writing_chats`**: `project_id` not null·소속 프로젝트만·프로젝트당 여러 개, `mode`·`experience_id`·`education_id`·`saved_at` 삭제, `status` `active`/`closed`, `title`·`last_applied_at` 신설, `structured_draft` v3(`project`·`star`, `op`, `applied_at`), V-9h 개정, **`apply_writing_chat_proposal` 신설**, `save_writing_chat`·`hand_off_writing_chat`·`set_writing_chat_affiliation` 폐기, A6 재개 전이 폐기, 사용자 `status` 직접 update 회수. (7) 미연결 대화 90일 정리(D-DM-08)·크론 폐기. (8) 근거: `source_type` `project_deliverable` 추가·`project_detail`·`achievement` 삭제, `project` 필드 재정의, 산출물 `source_locator`, `source_snapshot_at` = `content_updated_at`, V-8 조건 변경. (9) `draft_section_sources.project_detail_ids` 삭제, `ai_suggestions.target_field`. (10) readiness: `project_star`·`projects_without_complete_star`·`standalone_projects_without_description`, `create_project`, `project_fields` 재정의, `suggested_mode` 삭제, 판정 순서. (11) 삭제: `entity_type` `project_deliverable`, `cascade.project_deliverables`, `affiliation_mode = delete_projects`만(D-UX-22 `[결정 필요]`). (12) 연도 보기 = 시작 연도에 한 번(D-22 개정), 기간 계산 앱, `is_current` 미추가(D-DM-11 `[가정]`). (13) 3.6 이름 확정, 11장 백엔드 후속. **이름 변경**: AI 쪽 `project_kind` → `project_type`, `content` → `description`, `project_artifacts` → `project_deliverables`, `project_artifact` → `project_deliverable`(별칭 `DLV-n` 권고) / UX 쪽 `deliverable(s)` → `project_deliverable(s)`, `structured_draft.fields.{star}` → `structured_draft.star.{field}`. 회신 `_workspace/career-redesign/dm_replies.md`. **후속 결정 CR-15~24 (확정 2026-11-02 (사용자))** (CR-20은 리더 정렬로 `replace` 제거 — 빈 값만 추천. 라운드 3: R-CR-14 분류 추천 `reason` 추가, R-CR-15 `is_current` AI 제안 경로 삭제, R-CR-17 CR-18·CR-19 확정 표기): CR-15 경력·교육 삭제 시 함께 삭제 확정(`[결정 필요]` 해제), CR-17 분류 값 목록 확정(`[가정]` 해제), CR-20 `structured_draft.classification`(빈 값만 추천·덮어쓰기 없음, CHECK 밖 값 버림) + `apply_writing_chat_proposal` `p_fields`에 분류 3종·`is_current`, 사유 `classification_already_set`, CR-22 **`projects.is_current`**(소속·독립, CHECK, 기간 표시 "현재", 사용자 입력만, 데이터 접근 표·11장), CR-23 머리말 화면 표기 "자기소개서"(내부 이름 그대로), CR-16·18·19·21·24 스키마 영향 없음(8장). **리뷰 반영 R-CR-11**: 2.3 기간 표시의 "PRD와 다름" 문장 삭제, D-DM-11 상태 "PRD v4.5 반영됨, 사용자 확인 대기", 8장 A6·A15 "v4.4 대상 없음"·A18 "의미 변경", 8.1 T-18(반영 시 `needs_review` 건너뜀)·T-19(폐기) 표기, 머리말 기준 입력 버전 갱신 |
| **v4.3b** | 2026-11-02 | **spec-gaps ⑲ 해소**: A.2 필수 동의에서 `cross_border_transfer`를 뺐다(F-COM-02, UX S-03, D-39). `consent_type`·`policy_type` 값은 기존 행과 S-30 고지를 위해 유지. 구현 `20261108000100_w1_signup_consent_required_set.sql`. 이름 변경 없음 |
| **v4.3a** | 2026-11-01 | **Q53-11**: `succeeded` + 요건 0개 JD도 공고 원문 수정 허용. 2.6.1 조건 2·4, 조건 5 설명, 가드 트리거 후속 수정 |
| **v4.3** | 2026-10-30 | **UI v5.3 QA 사용자 결정 반영(Q53-1~9).** **Q53-2**: U-6·D-19 예외로 입력 원인(`not_a_jd`·`input_too_long`·`safety_blocked`) 요건 추출 실패 JD의 원문 수정 허용. RPC `update_failed_jd_raw_text`(security definer, `authenticated`), 허용 조건·거부 코드 6종·초기화 값·`input_hash` 무영향(2.6.1), `job_descriptions.raw_text_edited_at` 신설, 가드 트리거 완화와 `ensureJdExtracted` 읽기 순서 변경은 백엔드 후속 ★. DM-18, 5장, 6.1, 7장, A.6. **Q53-1**: `create_application_project`가 insert 전에 거부, 경로 ⑥(2.7.1, 2.11.7) ★. **Q53-3**: `answer_evaluations.error_code` 신설, `fail_answer_evaluation` 인자 추가, 입력 원인 답변은 다시 채점 대상에서 제외, 거부 코드 `interview_evaluation_input_only` `[가정]` ★(2.7.1, A.12, A.13). **Q53-5**: 종합만 다시 정리는 새 작업 경로, 대상 0 세션의 같은 행 다시 시도 거부 ★(2.7.1, 2.9.1). **Q53-7**: 중단 시 다시 생성은 새 행 삭제, 첫 생성은 `composing`, 경력기술서 `composing` 허용 ★(2.7.1, A.9). **S-20 실패 세션**: `in_progress` 1개 제약 유지, 그만두기 + 새로 만들기 `[가정]`(리뷰 R-90 반영: 2.6.1 복구 경로 문구, 일부 생성 세션). **Q53-10 (확정 2026-10-30 (사용자))**: 다시 할 것이 없는 입력 원인 채점 실패 세션은 첫 열람에 새 결과 표식을 지움, `mark_interview_result_viewed` 조건 변경 ★(2.7.1, A.12). Q53-4·6·8·9는 데이터 변경 없음. 이름 변경 없음(UX v5.4와 맞춤) |

---

## 11. 백엔드 후속 — v4.4 커리어 재설계의 구현 영향 (★)

> 이미 구현된 백엔드(`supabase/migrations/`, `src/server/`)는 v4.3b 모델 기준이다. 아래는 **새 마이그레이션으로 고칠 대상 목록**이며 SQL은 쓰지 않았다(기획 문서). 기존 마이그레이션 파일은 고치지 않고 새 파일을 더한다(resumate-backend 규칙). 순서는 db-engineer가 정한다.

### 11.1 영향받는 마이그레이션·객체

| 기존 마이그레이션 | 대상 객체 | v4.4 변경 |
|-------------------|-----------|-----------|
| `20261025000300_s2_projects` | `projects` 컬럼·CHECK·FK, `private.projects_set_status`, `private.project_is_complete` | STAR 5컬럼·분류 3종·`description`·`link_url`·`content_updated_at`·**`is_current`(CR-22, `CHECK (NOT is_current OR end_month IS NULL)`)** 추가, `summary`·`team_size` 삭제, `name` not null, `role` 필수 해제, DM-20 CHECK 3개, 경력·교육 FK cascade, 범위 변경 거부·`content_updated_at` 트리거, 완료 판정을 컬럼 조건으로(자식 조회 제거), 독립 프로젝트 부분 인덱스 |
| `20261025000400_s2_project_details`, `20261025000800_s2_reorder_project_details` | `project_details`, `private.project_details_*` 트리거, `reorder_project_details` | **삭제**(데이터 이관 11.2 뒤) |
| `20261025000500_s2_achievements` | `achievements`, `private.achievements_set_status` | **삭제** |
| `20261025000600_s2_skills` | `project_skills` | 독립 프로젝트 한정 insert 트리거, 소속 프로젝트에 달린 기존 행 삭제(고아 스킬 정리 트리거가 따라 돎) |
| (신규) | `project_deliverables` | 테이블·RLS·복합 FK·독립 한정·50개 트리거·`updated_at`·`career_data_updated_at`·근거 삭제 표시 트리거, `reorder_project_deliverables` `[가정]` |
| `20261024000300_s1_profiles` 등 `career_data_updated_at` 트리거 | 대상 테이블 | `project_details`·`achievements` 제거, `project_deliverables` 추가 |
| `20261024000200_s1_app_ai_writer_role`, `20261024000800_s1_default_privileges` | `app_ai_writer` grant | 삭제 테이블 grant는 테이블과 함께 사라짐. `project_deliverables` select grant 추가. `grants.test.sql` 갱신 |
| `20261025000700_s2_get_data_readiness`, `20261029000600_s3b_…_ai_connection`, `20261105000400_r1_…_project_fields`, `20261106000200_r3_readiness_consent_required` | `get_data_readiness` | 6장 v4.4(카운트·힌트 이름, `create_project`, `suggested_mode` 삭제, 판정 순서, D-01) |
| `20261025000900_s2_career_deletion_rpcs`, `20261030000600_s4_…_writing_chat`, `20261101000500_s6_…_insights`, `20261102000600_s7_…_drafts`, `20261103000700_s8_…_interviews` | `get_deletion_impact`, `delete_career_item` | `entity_type`(`project_detail`·`achievement` 삭제, `project_deliverable` 추가), `cascade` 키, `affiliation_mode = delete_projects`만, `writing_chat` 반환 `{message_count, last_applied_at}`, 근거 집계 `source_type` |
| `20261026000300_s3_evidence_links`, `20261101000200_s6_evidence_jd_sources`, `20261103000200_s8_evidence_interview_answer_source`, `20261105000700_r1_…_no_ai_writer_insert` | `evidence_links` CHECK, `private.evidence_links_check_source`, `private.evidence_mark_source_deleted` | `source_type`·`source_field` 목록, 프로젝트 종류별 필드 검사, 산출물 원본 확인·삭제 표시, V-8 조건 `project.learnings`, `source_snapshot_at` = `content_updated_at` |
| `20261030000100_s4_writing_chats` | `writing_chats`, `private.writing_chats_guard`, `private.writing_chat_empty_draft`, `private.writing_chat_greeting`, `start_writing_chat` | 컬럼 삭제·추가(2.5), `project_id` not null + 소속 프로젝트 트리거, `status` CHECK·전이, 인덱스, 빈 초안 v3, 시작 인사 4종, `start_writing_chat(p_project_id, p_return_target)` |
| `20261030000200_s4_source_writing_chat_fks` | `source_writing_chat_id` FK | `project_details`·`achievements` 쪽 삭제(테이블과 함께), `projects` 쪽 유지 |
| `20261030000300_s4_writing_chat_message_rpcs`, `20261105000100_r1_writing_chat_message_count` | `append_writing_chat_message`, `begin/finish_assistant_message` | `closed` 거부, 첫 메시지 `title`, 상한 도달 `closed` 전이 |
| `20261030000400_s4_structured_draft_patch` | `apply_structured_draft_patch`, `private.wc_*` 헬퍼 | v3 형식(`project`·`star`·**`classification`**, `op`(STAR `set`/`append`), `applied_at`), 분류 키 걸러 내기·`reason`(CR-20, R-CR-14), `project.is_current` 패치 거부(R-CR-15), V-9h 개정, 반영된 필드 규칙, 사용자 패치의 `closed` 허용. `wc_detail_index`·`wc_writable_numeric` 등 상세 내용·성과용 헬퍼 삭제 |
| `20261030000500_s4_save_writing_chat` | `save_writing_chat`, `hand_off_writing_chat`, `set_writing_chat_affiliation`, `private.commit_writing_chat`, `private.finalize_writing_chat` | **삭제**. 신규 `apply_writing_chat_proposal`(3.3, 분류 3종 반영 포함, `is_current` 제외) |
| `20261105000200_r1_writing_chat_resume` | `abandoned → active` 전이, 사용자 `status` update grant | **삭제**(전이·grant 회수) |
| `20261102000100_s7_drafts`, `20261102000200_s7_draft_source_triggers`, `20261102000300_s7_cover_letter_user_rpcs` | `draft_section_sources.project_detail_ids`, `private.draft_sources_remove_project_detail`, 근거 선택 RPC 인자 | 컬럼·트리거 삭제, 사용자 근거 선택 RPC에서 상세 내용 인자 제거 |
| `20261104000200_s9_account_deletion_rpcs` | `get_account_deletion_summary`, `delete_account` | 집계·삭제 테이블 목록(`project_details`·`achievements` 제거, `project_deliverables` 추가) |
| `20261031000400_s5_application_rpcs` | 기본 이름 상수(`create_application_project` 등) | "새 기업 JD (날짜)" → "새 자기소개서 (날짜)"(CR-23 `[가정]`). 기존 행은 그대로 |
| `20261104000300_s9_retention_purge_rpcs` | `purge_unlinked_writing_chats`, `writing_chats_unlinked_last_activity_idx` | **삭제**. 보관 정리 크론 라우트(`src/app/api/cron/retention`)에서 호출 제거 |
| pgTAP | `career_tables`, `career_deletion_rpcs`, `get_data_readiness`, `evidence_links`, `r1_planning_decisions`, `retention_purge`, `drafts*`, `account_deletion`, `grants`, 대화 관련 테스트 | 위 변경에 맞춰 갱신·추가(DM-20 CHECK, 범위 전환 거부, 산출물 독립 한정, 반영 RPC 덧붙임·`needs_review` 건너뜀·2,000자 초과 거부, `closed` 전이) |

- 앱 쪽(같은 후속에서 함께): `src/server/db/database.types.ts`·`src/types/db.ts` 재생성, `src/server/ai/context-pack/*`(STAR를 프로젝트에서 읽기, `DET-n`·`ACH-n` 제거, 산출물 별칭), `src/server/ai/schemas/structured-draft.ts`·`AI-12`, `src/server/ai/evidence-rules.ts`, `src/app/(dashboard)/(gated)/career/**`(상세 내용 경로 삭제, S-10·S-43·S-44). UI는 resumate-ui, 서버는 resumate-backend 몫이다.

### 11.2 기존 데이터 이관 규칙 `[가정]`

> 운영 데이터가 없고 개발·스테이징 데이터뿐이면 **커리어·대화 테이블을 비우고 새 스키마로 시작하는 것을 권고**한다. 남겨야 하면 아래 규칙.

| 기존 | 이관 |
|------|------|
| `project_details` (프로젝트당 여러 행) | `sort_order` 순으로 필드별로 이어 붙여 `projects`의 같은 컬럼에 넣는다. 행이 2개 이상이면 각 조각 앞에 `**{title}**` 한 줄을 붙인다. 2,000자를 넘으면 잘라 넣고 이관 로그에 남긴다 |
| `achievements` | 삭제(CR-11). 상세 내용에 연결된 행의 `description`은 버린다(결과 서술에 이미 수치가 있다고 본다) |
| 소속 프로젝트의 `role` | `task`가 비어 있으면 `task`로 옮기고, 아니면 버린다. 이후 `role = null` |
| `summary` | 독립 프로젝트는 `description`이 비어 있으면 옮긴다. 소속 프로젝트는 버린다 |
| `team_size` | 버린다 |
| `name`이 null인 프로젝트 | `'이름 없는 프로젝트'`로 채운다 |
| 소속 프로젝트의 `project_skills` | 삭제(고아 스킬 정리) |
| `writing_chats` `project_id` null | 삭제(메시지 연쇄) |
| `writing_chats` 상태 | `active`·`abandoned`·`saved`·`handed_off` → `active`. 단 `message_count > 38`이면 `closed`. `structured_draft`는 `'{}'`로 비운다(v1 형식은 v3로 옮기지 않음) |
| 독립 프로젝트에 묶인 대화 | 삭제(독립 프로젝트에는 패널 없음) |
| `evidence_links` `project_detail` | `source_type = 'project'`, `source_id` = 부모 프로젝트, `source_field` 그대로(`title`이면 `name`). 인용은 이어 붙인 텍스트의 부분 문자열로 남는다 |
| `evidence_links` `achievement` | `quote = null`, `source_deleted_at = now()`("원본 삭제됨") |
| `draft_section_sources.project_detail_ids` | 컬럼 삭제(값 버림) |

---

### 11.3 v4.5 백엔드 후속 — 페이지 저장·산출물 대화 (★)

> DM v4.4는 `20261109*_r4_*` 마이그레이션으로 구현돼 있다. 아래는 v4.5로 **새 마이그레이션을 더해** 고칠 대상이다(기존 파일 수정 금지, 순서는 db-engineer). SQL은 쓰지 않았다.

| 기존 마이그레이션 / 코드 | 대상 객체 | v4.5 변경 ★ |
|--------------------------|-----------|-------------|
| `20261109100500_r4_project_deliverables` | `project_deliverables` 제약 | `unique (id, project_id, user_id)` 추가(대화 복합 FK 대상). 분류·`source_writing_chat_id` 컬럼은 추가하지 않음 |
| `20261109100800_r4_writing_chats_v44` | `writing_chats` 컬럼·제약·인덱스, `private.writing_chats_require_affiliated_project`, `private.writing_chats_guard`, `private.writing_chat_empty_draft`, `private.writing_chat_greeting`, `start_writing_chat` | `project_deliverable_id` + 복합 FK cascade, `CHECK (project_deliverable_id IS NULL OR return_target IS NULL)`, 부분 인덱스 `(project_deliverable_id, last_activity_at desc)`, 트리거 → `writing_chats_check_target`(산출물 대화면 통과), 가드에 대상 열 불변 추가, 빈 초안을 대상별로, 산출물 시작 인사 3종, `start_writing_chat`에 `p_form_snapshot`(인사 분기, 저장 안 함), **`start_deliverable_writing_chat` 신설**. `writing_chats_cancel_jobs`(삭제 시 턴 취소)는 산출물 연쇄 삭제에도 그대로 돈다 — pgTAP로 확인 |
| `20261109101000_r4_structured_draft_patch_v3` | `apply_structured_draft_patch`, `private.wc_normalize_draft`, `private.wc_value_ok` 등 | 필드 `rev`(슬롯 단조, 없으면 1로 읽기), `new_object`(`app_ai_writer`만), V-9h `set → append` 낮춤만·기간/분류 DB 거부 삭제(`classification_already_set` 제거), 대상별 패치 범위(`invalid_patch`), **산출물 모양**(사실·초안 교체·블록 빼기·횟수만 세기·`draft_count` ≤ 6 → `writing_chat_draft_limit_reached`) |
| `20261109101100_r4_apply_writing_chat_proposal` | `apply_writing_chat_proposal`, `private.wc_proposal_lock`, `private.wc_proposal_mark_applied` | **`apply_writing_chat_proposal` 삭제**(execute grant 함께). 헬퍼는 `private.wc_mark_proposal_applied(p_writing_chat_id, p_target_kind, p_target_id, p_field, p_rev, p_mode)`로 바꿔 판정(`not_found`·`already_applied`·`proposal_changed`·`needs_review`)과 기록(`applied_at`·`applied_mode`·`applied_rev`, `last_applied_at`·`last_activity_at`)을 맡긴다 |
| (신규) | **`save_project_page`**, **`save_project_deliverable`** | 2.5.1 전체(invoker, 만들기·고치기, 값 검사 거부 코드, `p_expected_updated_at` → `stale_write`, 원소별 예외 블록으로 반영됨 기록, `projects.source_writing_chat_id`, 반환 모양). `authenticated`만 execute |
| `20261109100300_r4_projects_v44` | `projects` `updated_at` 트리거 | `source_writing_chat_id`만 바뀐 update에서는 `updated_at` 유지(FK `set null` 포함) |
| `20261109101300_r4_career_deletion_rpcs` | `get_deletion_impact`, `delete_career_item` | `project_deliverable`의 `cascade.writing_chats`, 독립 프로젝트의 `cascade.writing_chats`(= 그 프로젝트 대화 수). 결과 영향 집계는 변경 없음(대화는 근거 원본 아님) |
| `20261109101500_r4_account_deletion` | `get_account_deletion_summary`, `delete_account` | 대화 수가 산출물 대화를 포함하는지 확인만(행 기준 count면 그대로). 삭제 순서 변경 없음 |
| pgTAP | `writing_chats`·`structured_draft`·삭제·탈퇴·grants 테스트 | 산출물 대화 FK·CHECK·불변·cascade, 저장 RPC(만들기·고치기·`stale_write`·기록 실패가 저장을 막지 않음·`proposal_changed`), `rev` 단조, `new_object`, 초안 6회, `apply_writing_chat_proposal` 부재 |
| `src/server/services/writing-chat/*`, `src/server/services/career/save.ts`·`rpc.ts`, `src/server/actions/career.ts`·`writing-chat.ts` | 서비스·액션·턴 라우트 | 반영 액션 제거, 페이지 저장 액션 2개, 첫 메시지 순차 호출(7장), 턴 요청 `form_snapshot` zod 계약·길이 검사·로그 제외, AI-12 V-9h·분류·기간 판정을 스냅숏 기준으로, `new_object` 판정, AI-13 파이프라인(정리·초안·V-10·SSE `facts_patch`/`draft_*`), `call_key` `…compose` |
| `src/server/db/database.types.ts`, `src/types/db.ts` | 생성 타입 | 재생성 |

- 데이터 이관: 산출물 대화는 아직 없고 기존 STAR 대화는 `project_deliverable_id = null`로 그대로 맞다. 기존 필드 객체의 `rev`는 1로 채우거나 읽을 때 1로 본다. 이관할 행 없음.
- UI(resumate-ui)는 S-10·S-44 페이지 저장, [반영] = 폼 채우기, 카드 3단계, S-44 패널을 맡는다.

### 11.4 v4.8 백엔드 후속 — 교육 표시 이름 (★ 구현됨, ED-2·ED-3)

> PR #29로 이미 구현·원격 적용(2026-11-04)됐다. 아래는 문서와 구현을 맞춘 기록이며 추가 작업은 없다. 기존 마이그레이션 파일은 고치지 않았다(새 파일 `20261113000200_ui32_education_display_labels`).

| 대상 | 변경 ★ |
|------|--------|
| `private.trim_js_whitespace(text)`, `private.education_display_name(text, text)` | 신규 헬퍼(immutable, public 실행 권한 회수) |
| `private.draft_source_parent_name(uuid, uuid, uuid)` (`20261102000200`) | 교육 부모 = 표시 이름. `draft_source_label`·`draft_sources_mark_project_deleted`·이를 쓰는 저장 RPC는 본문 변경 없이 따라감 |
| `private.draft_sources_mark_education_deleted()` | 삭제 시점 라벨 = `education_display_name(old.program_name, old.institution_name)` |
| `private.backfill_education_display_labels()` | 1회 백필 후 남김(멱등, 운영자 전용, 어떤 역할에도 grant 금지) |
| 앱 | `educationDisplayName`(`src/server/services/career/education-name.ts`) — 커리어 목록·소속 이름(`services/career/read.ts`), 컨텍스트 팩 교육 별칭 label(`ai/context-pack/career-pack.ts`), 서류 출처 이름(`services/drafts/read.ts`) |
| pgTAP | `supabase/tests/ui32_education_display_labels.test.sql`(헬퍼·라벨 빌더·삭제 트리거·백필·권한) |

- public RPC 시그니처·테이블·컬럼 변경 없음 → `database.types.ts` 재생성 없음. 파괴적 아님(행 삭제 없음), 단 기존 `source_label` 값이 바뀐다(원본이 살아 있는 행만이라 기관명으로 다시 계산 가능).
- **ED-7 (v4.8)**: 교육 `education_type`·`enrollment_status`를 화면 입력에서 빼고 앱이 정하는 것(2.3)은 이미 `add-career-dialog.tsx`의 동작을 문서에 옮긴 것이다. 컬럼·CHECK(`degree` 포함)·완료 판정·RPC 변경 없음 → **백엔드 변경 필요 없음**, 마이그레이션 없음.
- UI 후속(resumate-ui)(v4.8, ED-3): S-08 추가·수정 모달 `src/components/career/add-career-dialog.tsx`는 이미 ED-6 라벨("교육 명"·"운영 기관")이다. 남은 곳은 예전 경로(`/career/educations/new`·`/career/educations/[id]`)의 `src/components/career/education-form.tsx` — 입력 라벨(:126 "기관명", :152 "전공/과정명")과 C-24 충돌 필드 라벨(`conflictFields`, :52 "기관명"·:54 "전공/과정명")을 "운영 기관 *"·"교육 명"으로 바꾼다(예전 경로를 없애기로 하면 이 항목도 함께 사라진다). 데이터·백엔드 변경 없음.

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
| `career_data_updated_at` | timestamptz | 커리어 테이블 변경 시 트리거 갱신(v4.4: 6개, 2.1) |
| `active_ai_provider` | text | **v4**: null, CHECK in (`openai`, `gemini`, `anthropic`), 복합 FK `(id, active_ai_provider) → ai_provider_keys(user_id, provider) on delete set null (active_ai_provider)` |
| `last_active_at`, `inactivity_notice_sent_at` | timestamptz | 장기 미접속(D-11). **(v4.6, PT-3)** `last_active_at` = 마지막 접속(`touch_last_active()`가 갱신, 기존 계정은 `greatest(coalesce(auth.users.last_sign_in_at, created_at), created_at)`으로 백필), `inactivity_notice_sent_at` = 파기 사전 안내를 보낸 시각(메일 서버가 받은 뒤 기록, 접속하면 null로 되돌림). 4.6 |
- RLS: select/update 본인, insert 가입 트리거, delete 없음.

### A.2 consents / policy_versions
| 테이블 | 컬럼 |
|--------|------|
| consents | `consent_type` CHECK in (`terms`, `privacy_required`, `cross_border_transfer`, `service_improvement`, `marketing`), `policy_version`, `agreed` boolean, `agreed_at`, `withdrawn_at`, `user_agent_hash`. 동의 1회 = 1행, 철회는 `withdrawn_at`, 재동의는 새 행. RLS select/insert 본인, update는 선택 동의의 `withdrawn_at`만. **`cross_border_transfer`는 필수가 아니다**(v4.3b, 2026-11-02, F-COM-02·D-39): 가입 때 받지 않고, 기존 행과 S-30 고지를 위해 값만 남는다. AI 공급자 국외 이전 동의는 키 연결 때 공급자별로 받는다(C-21, `ai_data_use_consents`) |
| policy_versions | `policy_type`(terms/privacy/cross_border_transfer), `version`, `effective_at`, `requires_reconsent`, `document_path`. 비사용자, 전체 select. 현재 값 4.5 — `2026-11-04` 3종 확정 2026-11-04 (사용자, PT-1) |

- **재동의 판정 (확정 2026-11-05 (사용자), A3 — 현행 유지)**
  - **선택 동의**(`service_improvement`, `marketing`)는 정책 버전이 바뀌어도 다시 묻지 않는다. 이전 선택 동의는 버전과 무관하게 유효(철회 전까지). 동의 게이트(`get_consent_status().needs_consent`)에 영향 없음. 선택 동의는 `privacy` 버전을 따른다 `[가정]`.
  - **필수 동의**(`terms`, `privacy_required`)는 동의한 버전보다 뒤이고 지금 시행 중인 버전 중 **하나라도 `requires_reconsent = true`면** 재동의 필요(중간 버전을 건너뛴 경우도 잡는다). AI 고지 재동의(2.11.5)와 같은 모양이다.
  - **`cross_border_transfer` (v4.3b, 2026-11-02)**: 필수 동의에서 뺐다. 근거는 PRD F-COM-02(AI 공급자 고지·동의는 키 연결 시점)와 D-39(공급자별 고지·동의, 2026-10-28 사용자 확정)이다. 동의 게이트에 영향이 없고(`required = false`, `needs_consent = false`), 새 버전이 시행돼도 재동의를 묻지 않는다. AI 실행 게이트는 이 행을 보지 않고 `ai_data_use_consents`만 본다(2.11.5, 2.11.7). D-39의 법무 확인은 아직 열려 있다.

### A.3 experiences
`status`, `company_name`(complete 필수), `start_month`(complete 필수, 1일 고정), `end_month`(≥ start), `is_current`(true면 end_month null), `job_rank`, `job_position`(둘 중 하나 complete 필수), `department`, `employment_type` CHECK in (`full_time`, `contract`, `freelance`, `intern`, `other`), `summary`(≤ 2,000자). `unique (id, user_id)`.

### A.4 skills / project_skills
| 테이블 | 컬럼 |
|--------|------|
| skills | `name`(≤ 50자), `normalized_name`(`unique (user_id, normalized_name)`), `is_manual` boolean, `proficiency` CHECK in (`basic`, `practical`, `expert`) Could. `status` 없음. 고아 태그 스킬(`is_manual = false`, 연결 0) 자동 삭제 |
| project_skills | PK `(project_id, skill_id)`, `user_id`, `created_at`. 양쪽 복합 FK cascade. **v4.4: 독립 프로젝트만**(insert 트리거, 2.3) |

### A.5 application_projects (v3 반영 전체)
`name`(≤ 100자, null = 추출 대기), `name_source` CHECK in (`user`, `ai`, `default`), `deadline` date, `memo`(≤ 2,000자, Should), `stage`, `stage_outcome`, `stage_changed_at`(본문 2.6), `last_activity_at`, `duplicated_from_id`(FK set null, Could). `unique (id, user_id)`. insert는 RPC `create_application_project`.

### A.6 job_descriptions
`application_project_id`(unique, 복합 FK cascade, 변경 불가), `raw_text`(1~50,000자, **변경 불가. 유일한 예외는 입력 원인으로 요건 추출에 실패했거나 요건 0개로 성공한 JD를 `update_failed_jd_raw_text`로 고칠 때, 확정 2026-10-30 (사용자, Q53-2)·2026-11-01 (사용자, Q53-11), 2.6.1**), `raw_text_hash`·`sentences` jsonb `[{sid, text, start, end}]`(`raw_text`와 함께만 바뀜), **`raw_text_edited_at`** timestamptz null(v4.3, 수정한 시각, null = 수정한 적 없음), `detected_language`, `company_name`, `company_name_source`(user/ai), `position_title`, `position_title_source`(user/ai), `extraction_status` CHECK in (`pending`(추출 전·키 없음 포함), `running`, `succeeded`, `failed`), `extraction` jsonb, `extraction_job_id`, `extraction_provider`, `extraction_model`(v4), `tech_keywords` jsonb `[{keyword, source_sids}]`, `requirements_hash`. delete 정책 없음(지원 프로젝트 연쇄만).

### A.7 jd_requirements
`job_description_id`(복합 FK cascade), `category` CHECK in (`responsibility`, `required`, `preferred`), `content`, `keywords` text[], `importance` CHECK in (`high`, `normal`), `source_sids` text[], `sort_order`, `origin` CHECK in (`ai`, `user`), `is_user_edited`.

### A.8 insights
`application_project_id`(복합 FK cascade), `version_no`(`unique (application_project_id, version_no)`), `is_latest`(ready 행만), `status` CHECK in (`generating`, `ready`, `failed`), `result` jsonb(evidence 제거, `item_key`), `match_stage_result` jsonb, `requirements_hash`, `completed_at` + AI 메타. 인덱스 `unique (application_project_id) where is_latest`, `(user_id, application_project_id, input_hash) where status = 'ready'`.

### A.9 drafts
`application_project_id`, `insight_id`(FK set null), `draft_type` CHECK in (`career_description`, `cover_letter`), `title`, `status` CHECK in (`composing`, `generating`, `ready`, `partially_failed`, `failed`), `options` jsonb(`included_experience_ids`, `included_education_ids`, `included_project_ids`, `project_order`, `selection_origin` in insight/ai_ranking/user, `ranking`, `tone` in `concise`/`detailed` 또는 null — null은 `concise`로 처리, 2.7 v4.2 표), `edited_at`, `first_copied_at`, `regenerated_from_id`(FK set null), `completed_at`, `run_generation`(내부) + AI 메타.
- v4.2 (**확정 2026-11-05 (사용자)**): `tone` 값 2개(A17). `selection_origin`에 대체 값 없음 — AI-11 실패 시 사용자가 직접 고르고 `user`(A23). `omitted`·`notes_for_user` 컬럼 없음(A21). 경력기술서 생성은 지원 프로젝트당 진행 중 1개(2.9.1). 생성 실패 초안은 블록 없이 `failed`, 다시 시도는 새 초안 행(A4, AI-03). **v4.3 (Q53-7)**: 중단은 실패가 아니다. 경력기술서도 `composing`을 쓸 수 있고(프로젝트당 1개), 다시 생성 중단은 새 행 삭제, 첫 생성 중단은 `composing`으로 돌아간다 `[가정]`(2.7.1).

### A.10 draft_sections (v3 반영 전체)
`draft_id`(cascade), `sort_order`(unique per draft), `section_kind` CHECK in (`experience`, `education`, `standalone_projects`, `cover_letter_question`), `experience_id`(soft), `education_id`(soft), `heading`, `question_text`, `template_key` CHECK in (`motivation`, `job_competency`, `future_plan`), `char_limit`, `count_basis` CHECK in (`with_spaces`, `without_spaces`), `user_note`(≤ 300자), `source_selection_mode` CHECK in (`ai`, `user`), `sources_modified_at`, `generation_no`, `question_class` CHECK in (`motivation`, `job_competency`, `future_plan`, `experience_story`), `status` CHECK in (`pending`, `generating`, `ready`, `failed`), `ai_content` jsonb(블록: `block_id`, `block_kind` in header/summary/role_line/bullet/paragraph, `project_id`, `text`, `requirement_ids`, `placeholders`, `flags`, `generated_by`, `user_modified`), `edited_content` jsonb, `ai_char_count`, `correction_applied`, `validation_report`, `completed_at`, `run_generation`(내부). 자소서 생성 시 기본 3문항 시드.
- v4.2: `notes_for_user`·`char_adjust_needed` 컬럼 없음 — 글자 수 경고는 `validation_report.char_adjust_needed`로만 남는다(**확정 2026-11-05 (사용자), A21**). 생성 중 문항은 문구·글자 수·메모·근거 선택·편집 저장을 막는다(`section_generating`).

### A.11 draft_section_sources (v3 반영 전체)
`draft_section_id`(cascade), `application_project_id`(cascade), `experience_id`(soft), `education_id`(soft), `project_id`(soft), ~~`project_detail_ids`~~(v4.4 삭제), `role` CHECK in (`primary`, `supporting`), `origin` CHECK in (`ai`, `user`), `rationale`(≤ 300자), `reuse_reason`, `requirement_ids` uuid[], `sort_order`, `source_label`(≤ 300자, 저장 시점 "부모 › 프로젝트" 라벨 — v4.7 교육 부모 = 교육 표시 이름, 2.7), `source_deleted_at`. CHECK `num_nonnulls(experience_id, education_id, project_id) >= 1`, `num_nonnulls(experience_id, education_id) <= 1`.

### A.12 interview_sessions
`application_project_id`, `insight_id`(set null), `source_session_id`(set null), `interview_type` not null 기본값 없음 CHECK in (`job`, `culture_fit`), `question_count` CHECK in (3, 5, 7) default 5, `data_sufficiency` not null CHECK in (`ok`, `thin`, `none`), `weak_requirement_ids` uuid[], `status` CHECK in (`in_progress`, `evaluating`, `completed`, `evaluation_failed`, `abandoned`), `generation_status` CHECK in (`generating`, `ready`, `failed`), `answered_count`, `unanswered_count`, `submitted_at`, `completed_at`, `result_viewed_at`, `abandoned_at`, `last_activity_at`, `career_snapshot_hash`, 점수 슬롯 `score_status`(pending_method/scored/not_scored), `score_value`, `score_max`, `score_method_version`, `score_rationale`, `score_counted_count`. `unique (application_project_id) where status = 'in_progress'`. v4.1: `question_provider`, `question_model`, `evaluation_provider`, `evaluation_model`.
- **v4.2**: **`question_validation_report`** jsonb null, **`question_usage`** jsonb null — 질문 세트 단위 검증 기록·사용량(**확정 2026-11-05 (사용자), A22 ★**). 내부 컬럼 `question_job_id`, `question_run_generation`, `evaluation_job_id`, `evaluation_run_generation`.
- **v4.2 다시 채점·결과 확인 표식 (확정 2026-11-05 (사용자), A9 — 구현과 같음)**: 다시 채점은 평가 성공이 없는 응답 답변만 다시 평가하고 종합(`session_feedbacks`)은 항상 다시 만든다(이전 result는 행에 남고 `pending`). 다시 채점이 시작되면 `score_status`·`completed_at`·`result_viewed_at`을 비운다. `result_viewed_at`은 `completed`일 때와 **다시 할 것이 없는 입력 원인 `evaluation_failed`일 때**(확정 2026-10-30 (사용자, Q53-10), 2.7.1)만 기록한다. 그 밖의 채점 중·채점 실패 화면을 열어도 "새 결과" 표식은 유지한다. `completed`인데 다시 할 답변이 없으면 `interview_evaluation_not_needed`(v4.3: 입력 원인 답변은 다시 할 답변에서 빼고, 입력 원인만 남으면 `interview_evaluation_input_only` `[가정]`, Q53-3, 2.7.1). 응답 0개 제출은 `completed` + `not_scored`(채점 작업 없음).
- 세션 삭제 트리거가 그 세션 대상 queued/running 질문·채점 작업에 취소를 요청한다. 그만두기는 질문 생성 작업만 취소 요청.

### A.13 interview_questions / interview_answers / answer_evaluations / session_feedbacks
| 테이블 | 컬럼 |
|--------|------|
| interview_questions | `session_id`, `sequence`(unique per session), `source_kind` CHECK in (`project_deep_dive`, `requirement_fit`, `gap_probe`, `collaboration`, `conflict`, `failure_growth`, `values`, `org_adaptation`, `motivation_career`), `anchor` CHECK in (`experience`, `jd`, `general`), `question_text`, `intent`, `focus_criteria` text[], `target_requirement_ids`, `target_gap_requirement_ids`, `good_answer_signals` jsonb, `copied_from_question_id` + AI 메타. 비공개 컬럼은 클라이언트 grant 없음 |
| interview_answers | `session_id`, `question_id`(unique), `answer_text`(≤ 5,000자), `status` CHECK in (`draft`, `submitted`, `unanswered`), 점수 슬롯 `score_status`(pending_method/scored/unanswered/not_scored, 제출 전 null), `score_value`, `score_max`, `score_method_version`, `score_rationale`. update는 `status = 'draft'` + 미제출 + 생성 완료 + **세션 `status = 'in_progress'`**일 때 `answer_text`만(**v4.2 확정 2026-11-05 (사용자), A8**: 그만둔 세션은 미제출이어도 편집 불가. RLS로 막아 조건 밖 update는 0행) |
| answer_evaluations | `session_id`, `answer_id`(unique), `status` CHECK in (`pending`, `succeeded`, `failed`), **`error_code`**(v4.3, 실패 원인, null = 원인 없음·성공, Q53-3, 2.7.1), `result` jsonb(criteria, strengths, improvements, intent_reveal, model_answer, consistency_notes, answer_quotes) + AI 메타. v4.2: `consistency_notes` 원소는 result에 `{text, answer_quotes}`, 근거는 `evidence_links`(`consistency_notes.<n>`) |
| session_feedbacks | `session_id`(unique), `status` CHECK in (`pending`, `succeeded`, `failed`), `result` jsonb(headline, overall_strengths, overall_weaknesses, next_practice, criteria_summary, unanswered_note) + AI 메타 |

### A.14 evidence_links (v3 반영 전체)
`application_project_id`(복합 FK cascade), `owner_type` CHECK in (`insight`, `draft_section`, `interview_question`, `answer_evaluation`, `session_feedback`, `chat_message`), `owner_id`(soft), `item_key`(초안 `block_id`, 그 밖 점 경로), `sort_order`, `source_type`(본문 2.8 목록), `source_id`(soft), `source_locator`, `source_field`, `quote`(원본 삭제 시 null), `quote_adjusted`, `source_snapshot_at`, `source_deleted_at`, `source_label`(≤ 300자, 저장 시점 출처 이름 — v4.7 교육 = 교육 표시 이름, 2.8). 인덱스 `(owner_type, owner_id)`, `(user_id, source_type, source_id)`, `(application_project_id)`. v4.2: insert 트리거(저장 직전 원본 삭제 → "원본 삭제됨"), `user_note`·`interview_answer` 출처 규칙, 직접 INSERT 권한 없음(2.8, 5장).

### A.15 ai_jobs (v4 반영 전체)
`job_type` CHECK in (`jd_extraction`, `insight`, `career_description`, `draft_source_ranking`, `cover_letter`, `interview_questions`, `interview_evaluation`, `writing_chat_turn`, `key_verification`, `writing_assist`, `chat_reply`), `application_project_id`(null 허용, cascade), `target_type`, `target_id`, `provider`(openai/gemini/anthropic, 실행 시작 시 활성 값 — 실행 중 고정, 같은 행 다시 시도 때 갱신), `model_tier`(light/default/heavy), `connection_tier`(free/paid), `status` CHECK in (`queued`, `running`, `succeeded`, `failed`, `canceled`), `progress` jsonb `{stage, done, total, waiting_retry_until}`, `params` jsonb, `retry_count`, `next_run_at`, `retry_wait_total_ms`(v4.1a), `error_code` CHECK in (`rate_limited`, `daily_quota_exhausted`, `billing_required`, `key_invalid`, `key_missing`, `model_not_available`, `provider_unavailable`, `input_too_long`, `safety_blocked`, `schema_invalid`, `timeout`, `stalled`, `canceled`, `insufficient_data`, `not_a_jd`), `error_category` generated(provider_limit/user_account/transient/input/system), `failure_cause` generated(rate_limited/daily_quota_exhausted/billing_required/key_invalid/model_not_available/provider_unavailable/input_rejected), `quota_resets_at`, `retry_after`, `input_hash`(공급자·모델 포함), `prompt_version`, `model`, `usage`, `output` jsonb(`draft_source_ranking` 전용), **`step_outputs`** jsonb(v4.2), **`run_generation`**(v4.2 내부), `heartbeat_at`, `cancel_requested_at`, `started_at`, `finished_at`. 키 없음. 동시 실행 1개 partial unique + 경력기술서 지원 프로젝트당 1개 인덱스(v4.2). `target_type` 값·상태 전이는 2.9.1. 보관 90일.

### A.16 AI 연결·사용량 (v4)
| 테이블 | 컬럼 |
|--------|------|
| ai_provider_keys | `provider`, `connection_tier`, `key_ciphertext`, `key_nonce`, `wrapped_dek`, `kek_id`, `encryption_version`, `key_last4`, `status`(valid/invalid/needs_check), `last_verified_at`, `last_failure_cause`, `last_failure_at`. `unique (user_id, provider)`. 암호 컬럼 grant 없음 (2.11) |
| ai_data_use_consents | `provider`, `connection_tier`, `disclosure_version`, `free_tier_acknowledged`, `agreed_at`, `withdrawn_at` |
| ai_usage_records | `occurred_at`, `period_month`, `feature`, `job_type`, `ai_job_id`, `call_key`, `application_project_id`(set null), `provider`, `model`, `model_tier`, `connection_tier`, `input_tokens`, `cached_input_tokens`, `cache_write_tokens`, `output_tokens`, `reasoning_tokens`, `usage_source`, `outcome`, `error_code`, `price_table_version`, `estimated_cost_usd`. 불변, 13개월 |
| ai_price_tables | `version`, `effective_from`, `provider`, `model`, `input_usd_per_mtok`, `cached_input_usd_per_mtok`, `cache_write_usd_per_mtok`, `output_usd_per_mtok`, `long_context_threshold_tokens`, `long_context_input_usd_per_mtok`, `long_context_output_usd_per_mtok`, `long_context_cached_input_usd_per_mtok`(v4.2), `long_context_cache_write_usd_per_mtok`(v4.2), `source_checked_at` (비사용자) |
| ai_disclosures / ai_providers | 2.11.6 (비사용자) |
| ~~usage_events / usage_limits~~ | **v4 삭제** (D-34) |

### A.17 Should·운영
| 테이블 | 컬럼 |
|--------|------|
| chat_threads | `application_project_id`(cascade), `rolling_summary`, `summary_updated_at` |
| chat_messages | `thread_id`(cascade), `role` CHECK in (`user`, `assistant`), `content`, `status` CHECK in (`streaming`, `done`, `failed`) + AI 메타 |
| result_ratings | `target_type`(insight/draft/answer_evaluation/session_feedback), `target_id`, `rating`(up/down), `reason`(≤ 500자), `prompt_version`, `model`. unique per target |
| ai_suggestions | `target_type`(v4.4: `project` 등), `target_id`, `target_field`(v4.4, STAR 필드), `decision`(accepted/edited/rejected), `prompt_version`, `model` |
| account_deletion_logs | `subject_hash`, `requested_at`, `db_deleted_at`, `storage_deleted_at`, `reason`(user_request/inactivity). 3년, 비식별 |
