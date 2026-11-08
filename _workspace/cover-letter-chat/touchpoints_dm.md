# 데이터 모델 편집 자리 목록 — 사이클 `cover-letter-chat` (기준 DM v4.12)

- 작성: data-architect, 2026-11-05
- 기준 판: 설정 다이얼로그 사이클이 끝난 판의 `04-data-model.md` (**DM v4.12**, 커밋 `b161410`). `docs/planning/04-data-model.md`(v4.11)는 한 판 뒤처졌으므로 기준이 아니다
- 목표 버전: **DM v4.13**
- 결정 원문: `_workspace/00_input/planning-decisions-cover-letter-chat.md` (CL-1~CL-8 사용자 확정, CL-A1~CL-A10 리더 판단)
- ★ **이 문서는 편집 자리 목록뿐이다.** `docs/planning/`의 어떤 파일도, `_workspace/0x_*.md`도 고치지 않았고 마이그레이션 SQL도 쓰지 않았다. 설정 사이클 PR이 main에 머지된 뒤에 실제 편집을 시작한다
- 인용은 기준 판의 **절 제목 + 행 번호**로 적는다. 추측은 `[가정]`

---

## 0. 먼저 — 이 사이클의 구조적 전제 하나

CL-3은 "서류 본문·섹션·근거를 **대화의 `structured_draft`에 담고** `drafts` 계열은 폐기"라고 적었다. 그런데 CL-2·CL-4가 지목한 본인 모델(산출물 상세 S-44)에서는 **본문이 `structured_draft`에 없다** — 본문은 `project_deliverables.body`(정본 행)에 있고, `structured_draft.deliverable.body`는 **그 대화가 만든 제안 초안 하나**일 뿐이다(2.5.0, 526행 "초안 **하나만** 둔다(이력 없음)", 3.3 "카드 상태 3단계", 1248행).

CL-A1(한 서류에 대화 여러 개)·CL-4(기존 본문을 '현재 값'으로 읽음)·CL-8(**AI 연결 없이도** 문항 편집)이 동시에 성립하려면 **서류 본문·문항의 정본이 대화 밖에** 있어야 한다. 대화 안에만 있으면 ① 대화가 여러 개일 때 어느 `structured_draft`가 정본인지 정의할 수 없고 ② 대화를 지우면 본문이 사라지고(3.4 "대화만 삭제 → 반영된 STAR는 그대로"와 모순) ③ 대화를 만들 수 없는 상태(키 없음·동의 필요)에서 문항을 고칠 수 없다.

그래서 아래 표는 **CL-3을 "`drafts`·`draft_sections`·`draft_section_sources` 3개 테이블 폐기 + 제안은 `structured_draft`로 통일"로 읽고**, 정본 본문을 담을 얇은 테이블 **`application_documents` 1개**를 두는 안으로 짚었다. 이 읽기 자체가 사용자 확인이 필요한 1순위 쟁점이다 — 아래 `결정이 답을 주지 않는 것` **Q-DM-1**.

---

## 1. 고칠 자리

| # | 자리(절·테이블·컬럼) | 기준 v4.12의 현재 내용 | 무엇으로 바꿀지 | 근거 CL-ID | 파괴적/★ | 난이도 |
|---|----------------------|------------------------|-----------------|------------|----------|--------|
| D-1 | **0장 DM-5** (19행) | "AI 결과는 jsonb + `schema_version`, 재생성은 새 행(**자소서 문항은 덮어쓰기**)" | 서류는 결과 행이 아니라 **대화 제안 + 사용자가 저장한 정본**이 된다. "재생성 = 새 행"의 대상에서 서류를 뺀다 | CL-3·CL-6 | — | 작음 |
| D-2 | **0장 DM-12** (28행) | "지원 프로젝트 하위 결과의 소유 키는 `application_project_id` 하나" | 유지. 새 `application_documents`와 **서류 대화**도 이 키를 따른다는 문장을 더한다 | CL-1·CL-3 | — | 작음 |
| D-3 | **0장 DM-13·DM-21** (29·30행) | 커리어 쓰기는 사용자 세션만 / 전체 페이지는 페이지 단위 저장 RPC 하나 | **서류 쓰기도 같은 원칙**으로 확장한다 — [반영] = 화면 폼 채우기, 확정 = "저장하기"(새 RPC). DM-21의 적용 대상에 서류 작성 화면을 더한다 | CL-2·CL-3 | — | 보통 |
| D-4 | **0장 DM-15** (34행) | "AI 작성 대화의 출처는 `structured_draft` 안에. `evidence_links`에는 넣지 않는다" | **서류만 예외**가 된다 — CL-5가 "섹션 근거를 `evidence_links`에 그대로 연결"이라고 했다. DM-15에 "단 서류 대화의 **섹션 근거는 저장 때 `evidence_links`로 간다**(근거 칩·V-* 유지)"를 더한다. 사실(`facts`)·블록 출처는 지금처럼 대화 안에만 | CL-5 | — | 보통 |
| D-5 | **0장 AI 출력 공통 메타** (41·42행) | v4 적용 테이블 목록에 `drafts`·`draft_sections` 포함 | 두 테이블을 목록에서 뺀다. 서류의 공급자·모델 메타는 **`writing_chat_messages`(assistant 행)**이 이미 가지고 있다(같은 목록에 있음) → 결과 배지 F-AI-09의 원천이 메시지·제안 카드로 바뀐다 | CL-3 | ★ | 보통 |
| D-6 | **0장 결과 테이블 내부 컬럼** (46·47행) | `run_generation`·`completed_at` 적용 테이블에 `drafts`·`draft_sections` | 목록에서 뺀다. 세대 검사(`run_generation`)는 턴 작업 쪽만 남는다 | CL-3 | ★ | 작음 |
| D-7 | **1장 ERD** (89·90·91행) | `application_projects ||--o{ drafts` / `drafts ||--o{ draft_sections` / `draft_sections ||--o{ draft_section_sources` | 세 줄 삭제. **`application_projects ||--o{ application_documents`**(서류 2종, unique), **`application_projects ||--o{ writing_chats : "서류 작성 대화"`** 추가 | CL-1·CL-3 | — | 작음 |
| D-8 | **1장 ERD** (80·81행 + 109행 주석) | `projects ||--o{ writing_chats` / `project_deliverables |o--o{ writing_chats`, "대상은 `project_deliverable_id`가 있으면 산출물, 없으면 프로젝트" | 대상이 **세 가지**가 된다(프로젝트 STAR / 산출물 / 서류). 주석을 3분기로 다시 쓴다 | CL-1 | — | 작음 |
| D-9 | **1장 ERD** (105행) | `draft_section_sources }o..|| projects : "pick (soft)"` | 삭제. 근거 선택이 섹션 근거(`evidence_links`)로 합쳐진다 | CL-5 | — | 작음 |
| **D-10** | **2.5 `writing_chats.project_id`** (396행) | `uuid` **not null**, 복합 FK → `projects on delete cascade` | **null 허용**으로 바꾸고 서류 대화 대상 열 2개(`application_project_id`·`document_kind`)를 더한 뒤 **대상 배타 CHECK**를 넣는다(아래 2장 추천안 A). 또는 자매 테이블(안 B) | CL-1 | **★ 제약 변경** | 큼 |
| **D-11** | **2.5 `writing_chats` 신설 열** | 없음 | **`application_project_id`** uuid null, 복합 FK `(application_project_id, user_id)` → `application_projects(id, user_id) on delete cascade` / **`document_kind`** text null, CHECK in (`career_description`, `cover_letter`) | CL-1 | ★ | 큼 |
| D-12 | **2.5 대상 규칙** (408~411행) | "대상은 정확히 하나: `project_deliverable_id`가 있으면 산출물, 없으면 프로젝트. 둘 다 없는 대화는 `project_id` not null로 생기지 않는다" | 3분기 규칙으로 다시 쓴다. 새 CHECK 3개: `num_nonnulls(project_id, application_project_id) = 1`, `(application_project_id is null) = (document_kind is null)`, `(project_deliverable_id is null or project_id is not null)` | CL-1 | ★ | 큼 |
| D-13 | **2.5 트리거 `writing_chats_check_target`** (410행) | `project_deliverable_id`가 null이면 `project_id`가 **소속 프로젝트**여야 한다(아니면 `writing_chat_requires_affiliated_project`). 대상 열은 update 불가(가드 트리거) | 서류 대화(`application_project_id` not null)는 **이 검사를 건너뛴다**. 대상 열 불변 가드에 새 두 열을 더한다. 거부 코드 신설 `writing_chat_target_invalid`(또는 기존 코드 재사용) | CL-1 | ★ | 보통 |
| D-14 | **2.5 `title`** (398행) | null, ≤ 100자. **첫 사용자 메시지의 앞 30자**로 `append_writing_chat_message`가 채운다 | 변경 없음 — 서류 대화도 같은 규칙을 쓴다. CL-A5의 이관 대화에 제목을 미리 넣는지만 결정(아래 Q-DM-6) | CL-A1 | — | 작음 |
| D-15 | **2.5 `status`·전이** (399·413~421행) | `active`/`closed`, `message_count > 38`이면 definer RPC가 `closed`. 되돌림 없음 | 변경 없음(CL-A1). "`closed` 대화는 열람·제안 수정·수락/거절·반영만"에 **서류 본문 저장도 된다**를 더한다(반영됨 기록 대상) | CL-A1 | — | 작음 |
| D-16 | **2.5 `message_count`** (400행) | not null default 0, `CHECK (message_count BETWEEN 0 AND 40)` | 변경 없음(상한 40 그대로, CL-A1). 다만 자소서는 문항 10개를 한 대화에서 채우므로(CL-1) **40턴이 충분한지**는 UX·AI 확인 사항(아래 Q-DM-7) | CL-A1 | — | 작음 |
| D-17 | **2.5 `return_target`** (406행) | null, `CHECK (project_deliverable_id IS NULL OR return_target IS NULL)` | 서류 대화는 **게이트 진입이 없다**(서류가 곧 복귀 대상이다) → CHECK를 `project_deliverable_id is null and application_project_id is null or return_target is null`로 넓힌다. 즉 서류 대화도 항상 null | CL-1 | ★ | 작음 |
| D-18 | **2.5 인덱스** (474행) | `(project_id, last_activity_at desc)`, `(user_id) where status='active'`, `(project_deliverable_id, last_activity_at desc) where not null` | 신설 **`(application_project_id, document_kind, last_activity_at desc) where application_project_id is not null`**(작성 화면의 대화 기록 목록 + FK cascade 삭제) | CL-1·CL-A1 | ★ | 작음 |
| D-19 | **2.5 대상별 패치 범위** (461행) | "STAR 대화에는 `project`·`star`·`classification`…만, 산출물 대화에는 산출물 모양의 키만. 다른 대상의 키가 오면 `invalid_patch`(400)" | **서류 모양 키**를 세 번째 분기로 더한다 | CL-3 | ★ | 보통 |
| D-20 | **2.5 쓰기 주체 요약** (471행) | `start_writing_chat` / `start_deliverable_writing_chat` / `append_writing_chat_message` / `begin`·`finish_assistant_message` / `apply_structured_draft_patch` / `private.wc_mark_proposal_applied` | **`start_document_writing_chat` 신설**을 더한다. 나머지 RPC는 그대로 재사용(안 A의 가장 큰 이점) | CL-1·CL-A7 | ★ | 보통 |
| D-21 | **2.5 대화 개수 상한** (475행) | "프로젝트·산출물당 대화 개수 상한은 두지 않는다 `[가정]`" | 서류당도 같다(`[가정]` 유지). product-planner 확인 대상 | CL-A1 | — | 작음 |
| **D-22** | **2.5.0 절 제목·범위** (493행) | "산출물 대화의 `structured_draft`" — `target: "project_deliverable"` 하나 | 절을 **"대상별 `structured_draft` 모양"**으로 넓히고 **`target: "career_description"` / `"cover_letter"` 모양**을 더한다(초안은 3장) | CL-3·CL-5 | ★ | 큼 |
| D-23 | **2.5.0 `facts[]`** (525행) | `id`·`slot`·`text`(≤500자)·`actor`·출처·`review`·`origin`, 개수 ≤ 80 | 그대로 재사용한다(CL-A7 공통 규칙). 서류 대화의 `slot` 값 목록만 AI 명세에서 받아 더한다 | CL-A7 | — | 보통 |
| D-24 | **2.5.0 `deliverable.body`** (526행) | 초안 **하나**(`value`·`blocks`·`rev`·`generated_at`·`base_body_hash`·`replace_allowed`·`missing_slots`·`dropped_block_count`·`applied_*`) | 서류는 **섹션(문항)이 여러 개**라 같은 모양을 **섹션별 1개**로 둔다 → `document.sections[].draft` / `document.questions[].draft`. `base_body_hash`도 **섹션별**(각 섹션 본문 기준) | CL-5·CL-A4 | ★ | 큼 |
| D-25 | **2.5.0 `base_body_hash` 공백 정규화** (527~533행, OD-P5) | 5단계 정규화 + `sha256:` 접두, 서버·화면이 같은 함수 | 규칙 그대로 쓰고 **섹션 본문에 적용**한다는 한 줄만 더한다 | CL-A4 | — | 작음 |
| D-26 | **2.5.0 `draft_count`** (534행) | 0~6, 6이면 `writing_chat_draft_limit_reached`(409) | 서류는 섹션·문항이 여러 개라 "대화당 초안 6회"의 의미가 다르다. **섹션별 6회 / 대화 전체 6회** 중 하나를 골라야 한다(아래 Q-DM-8). 권고: **대화 전체 상한은 높이고(예: 섹션 수 × 2, 상한 40) 섹션별로는 6회** `[가정]` | CL-6 | ★ | 보통 |
| D-27 | **2.5.0 문체 메타** | 없음(`drafts.options.tone`에 있었다) | CL-A3이 "마지막으로 쓰인 값을 `structured_draft` 메타에 남긴다"고 했으나 **대화가 여러 개**라 새 대화에서 잊힌다 → **정본 쪽(`application_documents.meta.tone`)에 두기**를 권고한다(아래 Q-DM-3) | CL-A3 | ★ | 보통 |
| D-28 | **2.5.0 패치 연산 이름** (537행, R5-DB-4) | AI = `add_facts`/`replace_draft`/`count_draft`/`set_writing_kind`/`set_clarifications`/`add_sensitive_flags`, 사용자 = `accept_fact`/`reject_fact`/`accept_block`/`remove_block` | 서류는 **대상 섹션을 지정**해야 하므로 연산에 `section_id` 인자가 붙는다(`replace_draft`·`count_draft`·`accept_block`·`remove_block`). 서류에 `set_writing_kind`는 없다. 신설 후보 `set_tone` | CL-5·CL-A3 | ★ | 보통 |
| D-29 | **2.5.0 초안 `value` 조립** (538행, R5-DB-5) | "**DB가 정본 조립기**다. `replace_draft`의 `value`는 무시하고 `blocks`로 다시 조립" | 그대로 쓴다(섹션마다). 조립 규칙 노트 위치(`_workspace/backend/R5/02_db_notes.md`)도 그대로 | CL-A4 | — | 작음 |
| D-30 | **2.5.0 DB의 V-10 방어 범위** (539행, R5-DB-6) | 블록 출처 `source_fact_ids`가 그 대화의 사실 id인지만 본다 | 서류 블록은 **커리어 근거**(`evidence_links`로 갈 값)도 가진다 → 방어 범위에 "섹션 근거 원소의 모양·길이"를 더한다. 소유·존재 검사는 저장 RPC가 한다(근거 insert 트리거와 같은 기준) | CL-5 | ★ | 보통 |
| **D-31** | **2.5.1 절 제목·범위** (546행) | "페이지 저장 RPC" — `save_project_page`·`save_project_deliverable` 2개가 본 | **세 번째 RPC `save_application_document`**를 더한다. 공통 규칙 표(550~563행: 실행 주체 invoker, 만들기/고치기, 멱등 키 `p_client_id`, 기대 버전 `p_expected_updated_at` → `stale_write`, 반영됨 기록 `p_applied_proposals`, `skipped[].reason` 6값, 잠금 순서, 반환, 로그)는 **그대로 상속** | CL-2·CL-3 | ★ | 큼 |
| D-32 | **2.5.1 `skipped[].reason`** (559행) | `not_found`/`already_applied`/`proposal_changed`/`needs_review`/`invalid_entry`/`mark_failed` | 그대로. 서류 원소 모양은 `{writing_chat_id, section_id, rev, mode}` `[가정]` | CL-2 | — | 작음 |
| D-33 | **2.5.1 `form_snapshot`** (595행) | S-10 = 프로젝트 폼, S-44 = `{title, body}`. 저장·로그 없음, 길이 검사 후 `invalid_form_snapshot`(400) | **서류 모양**을 더한다: 경력기술서 `{sections: [{section_id, kind, heading, body}]}`, 자소서 `{questions: [{question_id, question_text, char_limit, user_note, body}]}` `[가정]`. 길이 상한은 4.5 "서류" 행과 맞춘다 | CL-4 | ★ | 보통 |
| D-34 | **2.6 `application_projects`** (599행~) | 변경 없음 | 서류 정본을 지원 프로젝트 쪽 컬럼으로 두지 않는다는 결론(별도 테이블)을 한 줄 적는다. 컬럼 변경 없음 | CL-3 | — | 작음 |
| **D-35** | **2.7 `drafts`** (740·750·751행 + A.9 2055~2057행) | `draft_type`·`title`·`status`(5값)·`options`(포함 항목·`project_order`·`selection_origin`·`ranking`·`tone`)·`edited_at`·`first_copied_at`·`regenerated_from_id`·`completed_at`·`run_generation` + AI 메타 | **테이블 폐기 ★**(파괴적). 컬럼별 행선지는 4장 대응표 | CL-3 | **파괴적 ★** | 큼 |
| **D-36** | **2.7 `draft_sections`** (741·751행 + A.10 2059~2061행) | `section_kind`(4값)·`experience_id`·`education_id`·`heading`·`question_text`·`template_key`·`char_limit`·`count_basis`·`user_note`·`source_selection_mode`·`sources_modified_at`·`generation_no`·`question_class`·`status`(4값)·`ai_content`·`edited_content`·`ai_char_count`·`correction_applied`·`validation_report`·`completed_at`·`run_generation` | **테이블 폐기 ★**(파괴적). 문항 메타는 정본 jsonb로, 생성 상태·세대·검증은 대화·턴으로 | CL-3·CL-8 | **파괴적 ★** | 큼 |
| **D-37** | **2.7 `draft_section_sources`** (742·758~763행 + A.11 2063·2064행) | `experience_id`·`education_id`·`project_id`(soft)·`role`·`origin`·`rationale`·`reuse_reason`·`requirement_ids`·`sort_order`·`source_label`·`source_deleted_at` + CHECK 2개 + 삭제 트리거 3개(`draft_sources_mark_project_deleted`·`_education_deleted`·`draft_source_label`·`draft_source_parent_name`) | **테이블 폐기 ★**(파괴적). 근거는 `evidence_links` 하나로 모은다(DM-6 복귀). **딸린 헬퍼·트리거 4개도 함께 폐기** — 단 `private.education_display_name`은 다른 경로(근거 `source_label`)가 쓰므로 남긴다 | CL-5 | **파괴적 ★** | 큼 |
| **D-38** | **신설 2.7.x `application_documents`** | 없음 | 서류 정본 1행 = 지원 프로젝트 × 서류 종류. `application_project_id`(복합 FK cascade), `document_kind`(CHECK 2값), **`unique (application_project_id, document_kind)`**, `body jsonb`(섹션/문항 배열), `meta jsonb`(문체 등), `first_copied_at`, 공통 컬럼(`updated_at` = 기대 버전 기준). 상세는 3장 | CL-3·CL-5·CL-8 | ★ 신설 | 큼 |
| D-39 | **2.7 v4.2 표 `drafts` 행** (750행) | `tone` 2값·null 정규화, `selection_origin` 3값, `ranking` 복사 규칙, 자소서 초안의 공급자 메타 = 마지막 완료 문항, 자소서 `status` 계산 | **전부 폐기**(화면이 없어짐). A17(문체)·A23(`selection_origin`)은 8장에서 "폐기(CL-2)"로 표시 | CL-2·CL-A3 | ★ | 보통 |
| D-40 | **2.7 v4.2 표 `drafts`/`draft_sections` A21 행** (751행) | "저장하지 않는 AI 출력: `omitted`·`notes_for_user`·`char_adjust_needed` 컬럼 없음. 글자 수 경고는 `validation_report.char_adjust_needed`" | 대화형에서는 이 안내가 **제안 카드·턴 응답**으로 간다. 글자 수 초과 안내는 **정본 문항의 계산값**(`char_count` vs `char_limit`, 화면 계산)으로 바꾼다 `[가정]` | CL-A4 | ★ | 보통 |
| **D-41** | **2.7.1 Q53-7 경력기술서 중단** (773·788~799행) | 중단 시 `status = 'composing'` 복귀, `drafts_type_status_check`에 `composing` 추가, `composing` 행은 프로젝트당 1개, `begin_career_description`이 지운다 | **절 전체 폐기 ★** — CL-A6이 `composing` 개념을 명시적으로 폐기했고, 설정 화면이 없어져 "설정만 하고 생성 전" 상태가 없다. 8장·9장·A.9의 `composing` 언급도 함께 지운다 | CL-A6 | ★ | 보통 |
| D-42 | **2.7.1 Q53-1 생성 RPC 게이트** (769·778~781행) | `create_application_project`가 insert 전에 활성 공급자·동의를 본다 | 변경 없음(자기소개서 만들기 경로는 그대로). 서류 **대화 시작** 쪽 게이트는 `start_writing_chat` 계열 규칙(활성 키 확인만, 468행)을 따른다 | CL-6 | — | 작음 |
| D-43 | **2.7.2 지원 프로젝트 삭제 뒤 남는 면접 기록** (829~869행, OD-I6) | `BEFORE DELETE` 트리거가 `completed` 세션을 떼어 내고 나머지를 지운다. `get_deletion_impact('application_project')` 반환 `{cascade: {insights, drafts, interview_sessions, stage_events}, kept: {interview_sessions}}` | 반환 키 **`cascade.drafts` → `cascade.documents` + `cascade.document_chats`** ★. 서류와 서류 대화는 **면접과 달리 남기지 않는다**(지금 `drafts`와 같은 처리) — 트리거 본문 변경은 없고 FK cascade로 지워진다. 트리거의 잠금 순서(851행)에 새 두 테이블을 넣는지 확인 | CL-3 | ★ | 보통 |
| **D-44** | **2.8 `evidence_links.owner_type`** (A.14 2101행) | CHECK in (`insight`, **`draft_section`**, `interview_question`, `answer_evaluation`, `session_feedback`, `chat_message`) | 신설 **`application_document_section`**. 기존 `draft_section` 값은 **CHECK에서 빼지 않는다**(옮기지 못한 행이 남을 수 있다 — SD-A19 `profile` 선례, 889행) + **insert 트리거가 새 행을 차단**. 이관으로 모든 행을 옮겼다면 빼도 되지만, CL-A5의 "옮기지 못한 행"이 있으면 남겨야 한다 | CL-5·CL-A5 | ★ | 큼 |
| D-45 | **2.8 `evidence_links.owner_id`·`item_key`** (A.14 2101행) | `owner_id` soft, `item_key` = 초안 `block_id`, 그 밖 점 경로 | 서류 근거의 `owner_id` = **섹션(문항) uuid**, `item_key` = null 또는 `'section'` `[가정]`. **이관에서 섹션 id로 기존 `draft_sections.id`를 그대로 쓰면 `owner_id`를 바꿀 필요가 없다 → 권고**(4장 대응표·5장 이관 3단계) | CL-5 | ★ | 보통 |
| D-46 | **2.8 `source_type` 목록** (875행) | `profile`(새 행 차단), `experience`, `education`, `project`, `project_deliverable`, `skill`, `jd_requirement`, `jd_sentence`, `interview_answer`, `user_note` | **값 목록 변경 없음.** 단 `user_note`의 `source_id`가 바뀐다 → D-47 | CL-5 | — | 작음 |
| **D-47** | **2.8 `user_note` 규칙** (904행) | "`source_id` = 메모가 있는 문항의 **`draft_sections.id`**. 같은 지원 프로젝트가 아니면 거부, 문항이 없으면 '원본 삭제됨'" | `source_id` = **`application_documents.body` 안의 문항 uuid**(soft). 테이블 행이 아니라 jsonb 안 원소라 **"문항이 없으면 원본 삭제됨" 판정을 트리거가 할 수 없다** → 저장 RPC가 판정하고 트리거는 모양만 본다 `[가정]`. 대안: 문항을 별도 테이블로 쪼개기(Q-DM-2 (c)) | CL-5·CL-8 | ★ | 큼 |
| D-48 | **2.8 소유자별 허용 출처** (893·907행, SD-A19·R-SD-9) | 커리어 **5종**(`experience`·`education`·`project`·`project_deliverable`·`skill`), "**경력기술서 = 커리어 5종만**", 자소서 문항도 같은 5종 + `interview_answer`·`user_note` 등. "insert 트리거와 저장 RPC 허용 목록이 같은 5종을 쓴다" | 소유자 이름만 `draft_section` → `application_document_section`으로 바꾸고 **목록은 그대로**. 자소서 문항에 `jd_requirement`·`jd_sentence`를 더할지는 AI 확인(지금 목록에는 없다) | CL-5 | ★ | 보통 |
| D-49 | **2.8 `learnings` 근거 거부** (907행 끝) | "직무 면접 질문·경력기술서·`job_competency` 문항은 `source_type='project' AND source_field='learnings'` 근거를 RPC가 거부(V-8 DB 방어)" | 유지. 거부 주체가 새 저장 RPC가 된다 | CL-5 | ★ | 작음 |
| D-50 | **2.8 쓰기 주체** (908행) + **5장 `evidence_links`** (1469행) + **A24**(1482행) | "결과 저장 RPC 안에서만(소유·세대 검사). `app_ai_writer`의 직접 INSERT 권한 없음" | 서류 근거는 **사용자 세션 저장 RPC**(`save_application_document`, invoker)가 쓴다 → **사용자 경로에서 `evidence_links`를 쓰는 첫 사례**다. definer 내부 헬퍼(`private.doc_replace_section_evidence` `[가정]`)로 넣고 사용자 세션에 직접 insert grant는 주지 않는다 | CL-5 | ★ | 큼 |
| D-51 | **2.8 삭제 트리거 대상** (895행) | `profiles`(해당 없음), `experiences`, `educations`, `projects`, `project_deliverables`, `skills` | 변경 없음 — 서류 근거도 같은 트리거가 "원본 삭제됨"을 찍는다(CL-5 "원본 삭제됨 규칙 현행대로") | CL-5 | — | 작음 |
| **D-52** | **2.9.1 `ai_jobs.target_type`** (935행) | `writing_chat`(`writing_chat_turn`, **이때 `application_project_id is null` CHECK**) | 서류 대화 턴은 **지원 프로젝트에 묶인다**(사용량 귀속·보드 표시) → **그 CHECK를 완화해야 한다 ★**. 안: `target_type='writing_chat'`이면 `application_project_id`는 null이거나 그 대화의 지원 프로젝트 | CL-1·CL-A8 | **★ 구현 변경** | 큼 |
| D-53 | **2.9.1 `job_type`** (917행, A.15 2104행) | `jd_extraction`, `insight`, **`career_description`**, **`draft_source_ranking`**, **`cover_letter`**, `interview_questions`, `interview_evaluation`, `writing_chat_turn`, `key_verification`, (Should) `writing_assist`, `chat_reply` | 서류 생성은 전부 `writing_chat_turn`이 된다 → 세 값은 **새 작업에서 생기지 않는다**. CHECK에서 빼지 않는다(90일 보관 행이 위반한다 — SD-A19 선례) | CL-6·CL-A7 | ★ | 보통 |
| D-54 | **2.9.1 경력기술서 동시 실행 인덱스** (938행) | `ai_jobs_career_description_in_flight_key` = `(user_id, application_project_id) where job_type='career_description' and status in ('queued','running')`, 위반 = 409 `career_description_in_progress` | **폐기 ★**. 대화 턴은 이미 "대화당 진행 중 1개"로 막힌다(동시 실행 1개 partial unique). 서류별 동시 턴 1개를 따로 막을지 결정 필요 | CL-6 | ★ | 보통 |
| D-55 | **2.9.1 target_type `draft`·`draft_section`** (935행) | `draft`(`career_description` — api가 먼저 초안 id를 넣는다), `draft_section`(`cover_letter`) | 새 작업에서 생기지 않는다(값은 CHECK에 남김). "api가 먼저 초안을 만든다"는 경로도 폐기 | CL-6 | ★ | 보통 |
| D-56 | **2.9.1 요청 범위 작업 목록** (949행) + 7장 다시 시도 표(1732행) | `jd_extraction`, `draft_source_ranking`, `career_description`, `cover_letter`, `key_verification`, `writing_chat_turn` | 서류 3종이 빠지고 `writing_chat_turn`만 남는다. "서류 3종의 다시 생성 = 생성 라우트 재호출"(2.9.1 (2) 945행, 7장)은 **대화 턴 다시 보내기**(OD-P11)로 대체된다 | CL-6·CL-A7 | ★ | 보통 |
| D-57 | **2.9.1 `output` jsonb** (A.15 2104행) | "`draft_source_ranking` 전용" | AI-11이 대화 안 단계로 남으므로(CL-5) **턴 작업의 `output`(또는 `step_outputs`)에 정렬 결과를 둔다** `[가정]`. 저장 테이블은 두지 않는다(현행 `drafts.options.ranking` 폐기) | CL-5 | ★ | 보통 |
| **D-58** | **2.9.2 `ai_usage_records.feature`** (980행) | CHECK 10값 유지. "AI-11 기본 선택은 `career_description`, 자소서 글자 수 보정은 `cover_letter`. v4.5: 산출물 작성 대화도 `writing_chat`" + "작업은 같은 `job_type='writing_chat_turn'`" | **저장 값은 바꾸지 않는다**(CL-A8). 하지만 **`feature`↔`job_type` 쌍이 새로 생긴다** — `job_type='writing_chat_turn'`인데 `feature`가 `career_description`/`cover_letter`. 이 조합이 성립함을 **본문에 명시**해야 한다(지금은 `writing_chat`만 전제). AI C-13.1 표가 원천 | CL-A8 | ★ | 보통 |
| D-59 | **2.9.2 `call_key`** (984행) | `insight.match.2`, `writing_chat.turn.7.extract`, `writing_chat.turn.7.compose` | 서류 턴의 `call_key` 규칙을 더한다(예: `document_chat.turn.7.compose.s3`) `[가정]`. AI 명세가 원천 | CL-6 | ★ | 작음 |
| D-60 | **2.9.4 품질·안전 제한** (1038행~) | 메시지 40 CHECK 등 | 서류 대화 쪽 제한(초안 횟수·섹션 수·문항 수)이 여기 들어가는지 확인 | CL-6 | — | 작음 |
| D-61 | **2.9.5 `get_ai_usage_summary`** (1050행~, 1087행) | 공급자 × 기능 교차. "**7행 묶음은 표시 단계에서만**(`career_description` + `cover_letter` → '자기소개서 작성 AI 채팅'). RPC·SQL에 묶음을 넣지 않는다 — **자기소개서 작성이 채팅형으로 바뀌는 다음 사이클에 묶음이 또 바뀐다(SD-4)**" | **지금 사이클이 그 '다음 사이클'이다.** CL-A8이 "저장 값·묶음 그대로"라고 했으므로 **RPC·응답 변경 없음**. 1087행의 "다음 사이클에 또 바뀐다"는 문장을 "**CL-A8로 바뀌지 않기로 확정**"으로 고친다 | CL-A8 | — | 작음 |
| **D-62** | **4.1 개별 삭제 — 지원 프로젝트 행** (1351행) | "v2 목록 + `application_stage_events`. `completed` 면접 세션은 남는다" | 함께 삭제 목록에 **`application_documents`**와 **서류 대화 → 메시지**를 명시한다(FK cascade). 진행 중 서류 턴은 취소 요청(기존 `writing_chats_cancel_jobs` 트리거가 돈다 — pgTAP 확인) | CL-1·CL-3 | ★ | 보통 |
| D-63 | **4.1 — AI 작성 대화 행** (1350행) | "메시지 cascade / 프로젝트 `source_writing_chat_id` null, 저장된 STAR·산출물 본문 유지 / 근거 처리 없음(근거 원본 아님)" | **서류 대화를 지워도 저장된 서류 본문·섹션 근거는 남는다**를 더한다. 서류 쪽에는 `source_writing_chat_id` 같은 역참조 컬럼을 둘지 결정(권고: **두지 않는다** — 섹션별 마지막 반영 대화가 섹션 객체 `applied_*`에 있다) | CL-3·CL-4 | ★ | 보통 |
| **D-64** | **4.2 결과 영향 집계** (1365~1372행) | 키 `insights` / **`drafts`**(삭제 대상을 근거로 단 블록이 있거나 **섹션 머리글이 삭제 대상 경력·교육인** 경력기술서 문서 수) / **`draft_sections`**(근거 또는 **근거 선택**이 걸린 자소서 문항 수) / `interview_sessions` | 키 이름을 **`documents`·`document_sections`**로 바꾸고 **집계 기준을 `evidence_links` 하나로** 모은다(`draft_section_sources`가 없어진다). "섹션 머리글이 삭제 대상 경력·교육" 판정은 **jsonb 안 soft id를 봐야 한다 ★** — 비용·정확도 때문에 권고: **근거로만 센다** + 섹션 머리글은 저장 시점 라벨(`heading_label`)이라 삭제돼도 남는다 `[가정]` | CL-5 | **★** | 큼 |
| D-65 | **4.2 `delete_career_item(delete_results)` 범위** (1373~1377행) | 경력기술서 = **문서 삭제** / 자소서 문항 = 생성 결과·편집본·근거·선택 목록·AI 메타를 지우고 `source_selection_mode='ai'`로 되돌림(문구·메모·글자 수·`generation_no` 유지) | 새 구조로 다시 쓴다 — 경력기술서 = **그 섹션 삭제**(문서 행을 지우지 않는다. 섹션이 0개가 되면 문서 행은 남고 "초안 수"에서 빠진다, CL-A6) / 자소서 = **그 문항의 본문·근거만 비우고 문구·글자 수·메모는 유지**(지금과 같은 뜻). `source_selection_mode`·`generation_no`는 폐기 | CL-3·CL-A6 | ★ | 큼 |
| D-66 | **4.2 `get_deletion_impact` `entity_type`** (1361행) | 커리어 6종 + `application_project` | 변경 없음. `writing_chat` 종류의 반환 `{message_count, last_applied_at}`은 서류 대화에도 그대로(화면 문구는 "저장한 서류 본문은 남아요") | CL-3 | — | 작음 |
| D-67 | **4.3 `get_account_deletion_summary`** (1383행) | "자기소개서(지원 프로젝트 수, 인사이트, **초안**, 면접 세션, 전형 이력)" / "AI 작성 대화 수는 STAR + 산출물 합계 한 값 `[가정]`" | "초안" 셈 기준을 새 구조로(문서 행 수 또는 내용 있는 섹션 수 — CL-A6과 같은 기준). **AI 작성 대화 합계에 서류 대화를 더한다**(행 기준 count면 자동) | CL-3·CL-A6 | ★ | 보통 |
| D-68 | **4.4 보유 기간** (1391행 AI 작성 대화 행) | "프로젝트 삭제·산출물 삭제·대화 삭제·탈퇴까지. **자동 삭제 없음**" | 서류 대화는 **지원 프로젝트 삭제·대화 삭제·탈퇴까지**를 더한다. 자동 삭제 없음 유지(3.4) | CL-1 | — | 작음 |
| **D-69** | **4.5 초기값·길이 상한 — "서류" 행** (1432행) | "자소서 시드 문항 글자 수 1,000자·공백 포함, 문항 ≤ 10개, 문구 ≤ 1,000자, 글자 수 제한 1~10,000, **사용자 근거 선택 ≤ 5개**, 블록 ≤ 500개·블록 텍스트 ≤ 5,000자·`block_id` 형식, **섹션 ≤ 30개**, 상세 id ≤ 20·요건 id ≤ 50" | 새 구조 기준으로 **전면 개정**: 문항 ≤ 10·문구 ≤ 1,000자·글자 수 제한 1~10,000·메모 ≤ 300자는 **유지**(CL-8). 섹션 ≤ 30 유지. 신설 — 섹션 본문 길이(권고 **≤ 8,000자**, 산출물 초안 상한과 같게), 섹션 근거 ≤ 10개 `[가정]`, 문서 `body` jsonb 전체 크기, `p_applied_proposals` ≤ 50(상속) | CL-8·CL-A4 | ★ | 큼 |
| D-70 | **4.5 "AI 작성 대화 패치" 행** (1428행) | STAR ≤ 2,000자, 산출물 사실 ≤ 80·각 ≤ 500자, 초안 `value` ≤ 8,000자·블록 ≤ 200개, `draft_count` ≤ 6 | 서류 대화 값을 더한다(사실은 산출물과 같게, 섹션 초안 ≤ 8,000자·블록 ≤ 200, `draft_count`는 D-26 결론) | CL-A4 | ★ | 보통 |
| D-71 | **4.5 자소서 초안 `status` 계산** (1433행) | "생성 중 문항 → `generating` / 모두 `ready` → `ready` / 섞임 → `partially_failed` / `failed`만 → `failed` / 그 밖 → `composing`. ready 초안에 문항을 추가하면 `composing`" | **행 전체 폐기 ★**(`drafts.status`가 없어진다, CL-A6) | CL-A6 | ★ | 작음 |
| **D-72** | **5장 RLS 결과 테이블 행** (1468행) | `insights, **drafts, draft_sections, draft_section_sources**, interview_*, …` = 소유·세대 검사 definer RPC만. "사용자 편집은 사용자 세션의 해당 컬럼·RPC(**F-DOC-04 편집본, F-DOC-08 근거 선택**, 답변 `answer_text`)" | 세 테이블을 목록에서 빼고 **`application_documents` 행 신설** — select 본인 / insert·update = `save_application_document`(invoker, 사용자 RLS) / delete 본인·연쇄. F-DOC-04·08의 사용자 편집 경로는 이 RPC 하나로 합쳐진다 | CL-3·CL-8 | ★ | 큼 |
| D-73 | **5장 `writing_chats` 행** (1463행) | insert = definer RPC 2개, `project_id`·`project_deliverable_id`는 insert 뒤 불변 | `start_document_writing_chat` 추가, 불변 열에 새 두 열 추가 | CL-1 | ★ | 작음 |
| D-74 | **5장 `app_ai_writer` 읽기 권한** (1479행) | 커리어 6개 테이블, `application_projects`(컬럼 단위, `memo` 제외), `job_descriptions`·`jd_requirements`, **결과 테이블**, `evidence_links`, `ai_jobs`, `ai_usage_records` | 결과 테이블에서 세 테이블을 빼고 **`application_documents` select**를 더한다(대화 턴이 '현재 본문'을 읽는다 — CL-4. 단 `form_snapshot`이 우선이라 DB 읽기는 백업 경로) | CL-4 | ★ | 보통 |
| D-75 | **5장 RPC 실행 주체** (1488행) | `save_project_page`·`save_project_deliverable`·`delete_career_item`·`reorder_project_deliverables`는 invoker | `save_application_document`도 **invoker** + 근거 쓰기 내부 definer 헬퍼를 더한다 | CL-2 | ★ | 작음 |
| D-76 | **6장 `get_data_readiness()`** (1494행~) | `features.draft`(`ready`·`missing`·`hints`·`next_action`·`suggested_project_id`), 기능 키 ↔ `return_target.feature` 매핑에 `career_description`/`cover_letter` | **응답 모양 변경 없음.** 게이트 지점이 "서류 생성 버튼" → "작성 화면의 첫 제안"으로 옮기므로 **서술만 고친다**. AI-12·AI-13처럼 판정 대상에서 뺄지는 결정 필요(Q-DM-9) — 권고: **빼지 않는다**(근거가 없으면 제안 품질이 무너진다) | CL-6 | ★ | 보통 |
| D-77 | **6-A `profile_filled` 삭제** (1538~1549행, SD-A18) | `counts.profile_filled`·`hints:"profile"` 삭제, `data_sufficiency` `thin`에서 "프로필 또는" 삭제 | **이 사이클에서 추가로 바꿀 것 없음.** 서류 readiness가 프로필을 쓰지 않음을 1547행 "읽는 곳 — UX"와 함께 **재확인**만 한다(겹치는 자리는 6장) | SD-A18 | — | 작음 |
| D-78 | **6장 U-5 복귀 흐름** (1568~1573행) | 게이트 → 대화 → 저장하기 → readiness 재확인 → `return_target` 복귀 | 복귀 **대상 주소**가 새 작성 화면으로 바뀐다(화면 몫). 데이터 규칙 변경 없음. `return_target.feature` 값 2개 유지 | CL-7 | — | 작음 |
| **D-79** | **6.1 매트릭스 — F-DOC-01** (1611행) | "R 커리어(팩), `jd_requirements`, `insights`; W **`drafts`, `draft_sections`, `evidence_links`**, `ai_jobs`(+`draft_source_ranking` `output`), `ai_usage_records` / RPC `get_data_readiness`" | W를 **`application_documents`, `writing_chats`, `writing_chat_messages`, `evidence_links`, `ai_jobs`(`writing_chat_turn`), `ai_usage_records`**로. RPC = `start_document_writing_chat`·`append_writing_chat_message`·`apply_structured_draft_patch`·`save_application_document` | CL-1·CL-3 | ★ | 보통 |
| D-80 | **6.1 — F-DOC-02** (1612행) | "W `drafts`(composing, 기본 3문항 시드), `draft_sections`, `evidence_links`, `ai_jobs`, `ai_usage_records`" | 기본 3문항 시드는 **`save_application_document` 만들기 분기**(또는 전용 RPC)가 넣는다. `composing` 삭제 | CL-8·CL-A6 | ★ | 보통 |
| D-81 | **6.1 — F-DOC-03·04·08·09** (1613~1616행) | `draft_sections.edited_content`·`drafts.edited_at`·`first_copied_at` / `draft_section_sources`·`source_selection_mode`·`sources_modified_at`·`generation_no` / `draft_sections.user_note` | 네 줄 모두 **`application_documents.body`(섹션·문항 객체)**와 `evidence_links`로 다시 쓴다. `first_copied_at`은 문서 행 컬럼으로 유지(권고) | CL-5·CL-8 | ★ | 보통 |
| D-82 | **6.1 — F-COM-04 개별 삭제** (1628행) | 대상 테이블 목록에 `draft_section_sources`, 결과 테이블 | 목록 교체(`application_documents`, 서류 대화) | CL-3 | ★ | 작음 |
| D-83 | **6.1 — F-AP-02·03, F-ST-01 보드** (1597·1598·1601행) + 7장 보드 조회(1715행) | "R … `drafts`(수)" | **서류 수 셈이 바뀐다** — `application_documents`의 **내용 있는 섹션·문항 수**(CL-A6). S-13·S-31·S-39 카드와 C-05 영향 N이 같은 기준을 쓴다 | CL-A6 | ★ | 보통 |
| **D-84** | **7장 API 경계 — 서류 관련 행** | 현행 표에 서류 생성·편집 행이 **따로 없다**(결과 저장 RPC로만 다뤘다) | 신설 4행: ① **서류 작성 화면 조회**(Server Component — `application_documents` 1행 + 그 서류의 `writing_chats` 목록 + 연 대화 메시지·`structured_draft`, S-44 조회 행(1700행)이 본) ② **서류 저장하기**(Server Action → `save_application_document`) ③ **서류 대화 시작**(→ `start_document_writing_chat`) ④ **서류 대화 턴**(Route Handler `POST /api/writing-chats/{id}/turns` **재사용**, SSE 이벤트는 AI-13 모양 + 섹션 지정) | CL-1·CL-2·CL-6 | ★ | 큼 |
| D-85 | **7장 대화 턴 행** (1710행) | 요청 본문 camelCase `{content, requestedSlot?, requestedAction?, style?, formSnapshot?}`, `requestedAction` ∈ `compose_draft`/`ask_from_project`, `?retry=1` 계약, SSE 이벤트 목록 | 서류 분기를 더한다 — `requestedSection?`(섹션·문항 지정), `requestedAction`에 서류 값(`compose_all`·`compose_section`·`shorten` 등 AI 명세가 정함), `formSnapshot`은 D-33 모양. **라우트·RPC는 그대로 재사용**(안 A의 이점) | CL-6·CL-A7 | ★ | 큼 |
| D-86 | **7장 지원 프로젝트 삭제 영향/삭제 행** (1720행) | 반환 `{cascade: {insights, drafts, interview_sessions, stage_events}, kept: {...}}` | `drafts` → `documents`·`document_chats`(D-43과 같은 변경) | CL-3 | ★ | 작음 |
| **D-87** | **8장 결정 필요 표** | A17(`tone` 2값)·A21(서류 안내 미저장)·A23(AI-11 대체 선택 없음)·Q53-7(`composing`)·D-DM-06(이전 생성본 미보관)·D-UX-23 | 폐기·대체되는 줄에 "**폐기 (v4.13, CL-n)**" 표시를 붙인다. **새 `[결정 필요]` 줄**로 Q-DM-1~Q-DM-9(아래 6장)를 넣는다 | CL-* | — | 보통 |
| D-88 | **9장 테이블 목록** (1799~1803행) | 사용자 테이블 **29**, 참조·운영 6 | **28**(= 29 − `drafts`·`draft_sections`·`draft_section_sources` + `application_documents`). 목록에서 세 이름을 빼고 새 이름을 넣는다 | CL-3 | ★ | 작음 |
| D-89 | **10장 변경 이력** (1810행~) | v4.12까지 | **v4.13 줄 신설** — CL-1~CL-8·CL-A1~CL-A10 인용, 파괴적 마이그레이션 표시, 기준 PRD v4.15 · UX v5.18 · AI v4.13 | — | 보통 |
| **D-90** | **11장 백엔드 후속 — 신설 11.8** | 11.3(v4.5)·11.4(v4.8)·11.5(v4.10)·11.6(v4.11)·11.7(v4.12) | **11.8 v4.13 백엔드 후속** 신설. 영향 마이그레이션·객체(아래) + 5장 이관 단계 + **파괴적 여부 표시**. SQL은 쓰지 않는다 | CL-3·CL-A5 | ★ | 큼 |
| D-91 | **11.8이 가리킬 기존 마이그레이션** | — | `20261102000100_s7_drafts`, `20261102000200_s7_draft_source_triggers`, `20261102000300_s7_cover_letter_user_rpcs`(1861행에 이미 이름이 있다), `20261109100800_r4_writing_chats_v44`, `20261109101000_r4_structured_draft_patch_v3`, `20261109101300_r4_career_deletion_rpcs`, `20261109101500_r4_account_deletion`, `20261103000100_s8_interview_tables`(target_type CHECK), `evidence_links` 트리거 파일 | CL-3 | **파괴적 ★** | 큼 |
| D-92 | **11.8 코드 쪽 ★** | — | `src/server/services/drafts/*`(읽기·저장·근거 선택), `src/server/actions/*`의 서류 액션, 서류 생성 라우트(AI-03·AI-04 파이프라인), `src/server/services/writing-chat/turn.ts`(대상 3분기), `src/server/db/database.types.ts`·`src/types/db.ts` 재생성, `src/lib/data/deletion.ts`(`countsAsDraft`) | CL-3 | **구현 변경 ★** | 큼 |

**짚은 자리: 92곳.** 이 가운데 이미 구현된 스키마·RPC·코드를 반드시 바꿔야 하는 것(★)은 **65곳**이고, 그중 **파괴적**(테이블 drop·제약 해제)은 **4곳** — D-35(`drafts`)·D-36(`draft_sections`)·D-37(`draft_section_sources`)·D-91(딸린 트리거·RPC·인덱스 정리)이다. D-10(`project_id` not null 해제)은 데이터를 지우지는 않지만 **되돌릴 수 없는 제약 변경**이다.

---

## 2. `writing_chats` 확장 vs 자매 테이블 — 두 안 비교와 추천

### 안 A — `writing_chats`를 늘린다 (대상 열 추가 + `project_id` null 허용 + 배타 CHECK)

```
writing_chats
  project_id              uuid null   -- 현행 not null → null 허용 ★
  project_deliverable_id  uuid null   -- 현행 그대로
  application_project_id  uuid null   -- 신설, 복합 FK cascade
  document_kind           text null   -- 신설, CHECK (career_description, cover_letter)

  CHECK num_nonnulls(project_id, application_project_id) = 1
  CHECK (application_project_id is null) = (document_kind is null)
  CHECK (project_deliverable_id is null or project_id is not null)
```

### 안 B — 자매 테이블 `document_chats` + `document_chat_messages`를 새로 둔다

| 항목 | 안 A (확장) | 안 B (자매 테이블) |
|------|-------------|---------------------|
| **복합 FK** | 서류는 `(application_project_id, user_id)` → `application_projects` 하나로 끝. 산출물처럼 2단 FK가 필요 없다(서류는 지원 프로젝트 직속) | 같다. 차이 없음 |
| **`project_id` not null** | **깨진다 ★.** 이 전제에 기대는 곳: 트리거 `writing_chats_check_target`(410행), 인덱스 2개(474행), `get_deletion_impact`의 `cascade.writing_chats`(1363행), `delete_career_item`, S-10·S-44 목록 쿼리, 턴 파이프라인의 대상 판정, `get_account_deletion_summary`. 전부 "서류 대화는 제외" 조건을 더해야 한다 | 그대로 유지. **커리어 쪽 코드를 한 줄도 안 건드린다** |
| **RLS** | 정책 문장 변경 없음(`user_id = auth.uid()`). insert 경로에 RPC 1개 추가 | 새 테이블 2개에 정책·grant를 처음부터 쓴다(복붙 ~10줄 × 2) |
| **연쇄 삭제** | 지원 프로젝트 삭제 → FK cascade. **단 2.7.2 `BEFORE DELETE` 트리거(OD-I6)와 같은 문장에서 돈다** → 잠금 순서(851행)에 서류 대화를 끼워 넣어야 한다. 반대로 커리어 삭제(경력→프로젝트→대화)는 `project_id is not null` 조건이 필요 | 같은 cascade. 커리어 삭제 경로는 **애초에 서류 대화를 만나지 않는다**(깨끗함) |
| **`message_count` 상한 40** | CHECK·RPC·전이 **그대로 공유**. 상한 규칙이 한 곳 | CHECK를 복제. 상한을 바꾸면 두 곳을 고친다 |
| **`status` 전이** | `finish_assistant_message`의 `active → closed` 전이 **그대로 공유** | 전이 RPC 복제(또는 공통 private 함수 추출) |
| **`title` 자동 채움** | `append_writing_chat_message`의 "첫 사용자 메시지 앞 30자" **그대로 공유** | 복제 |
| **`return_target`** | 서류 대화는 항상 null → CHECK 한 줄 확장(D-17) | 컬럼을 아예 두지 않는다(더 깨끗) |
| **`structured_draft`·`rev`·`new_object`·보호 규칙** | `apply_structured_draft_patch` 한 함수에 세 번째 분기를 더한다. 함수가 커진다(이미 3대상 분기) | 새 함수. 하지만 `rev` 단조·보호·`needs_review` 규칙을 **전부 다시 쓴다**(449~460행 분량) |
| **턴 라우트·SSE** | `POST /api/writing-chats/{id}/turns` **그대로**(OD-P11 다시 보내기 계약, 중단 처리, 상한 계산 포함) | 새 라우트 + 계약 복제. OD-P10·OD-P11을 두 번 구현 |
| **`ai_jobs`** | `job_type='writing_chat_turn'`, `target_type='writing_chat'` 재사용. **단 `application_project_id is null` CHECK를 완화 ★**(D-52) | 새 `target_type='document_chat'` 값 추가. CHECK 완화도 결국 필요(또는 값별로 분기) |
| **사용량** | `feature`는 CL-A8대로 `career_description`/`cover_letter`, `job_type`은 `writing_chat_turn` → 조합만 새로 생긴다 | 같다 |
| **CL-A7 공통 규칙 공유** | **구조가 곧 공통 규칙**이다. AI 명세가 AI-12·AI-13·AI-03·AI-04에 같은 턴 계약을 쓰기로 했으므로(CL-A7) 테이블도 하나인 쪽이 어긋날 여지가 없다 | 규칙은 문서로만 공유된다. 한쪽만 고치는 사고가 생긴다 |
| **삭제 집계·탈퇴** | "AI 작성 대화 N개"가 **자동으로 한 값**(4.3의 `[가정]`과 맞는다) | 두 테이블을 합산해야 한다 |
| **pgTAP** | 기존 대화 테스트에 대상 3분기 케이스를 더한다 | 새 테스트 파일 한 벌 |
| **마이그레이션 성격** | 제약 변경 1건(not null drop) + 열 2개 + CHECK 3개 + 인덱스 1개 + 트리거·RPC 교체 — **데이터 파괴 없음** | 테이블 2개 생성 — **데이터 파괴 없음**, 기존 객체 무변경 |

### 추천: **안 A (확장)**

근거 세 가지.

1. **CL-A7이 "공통 규칙 공유"를 결정으로 못 박았다.** 턴 구조·추출·제안·반영·민감정보·"-음" 체·인용 되묻기·꼬리 질문 상한을 AI-12·AI-13과 공유하기로 한 기능을 **다른 테이블·다른 라우트·다른 RPC**에 올리면, 규칙이 갈라지는 것은 시간 문제다. v4.5가 산출물 대화를 `writing_chats`에 넣기로 한 근거(409행)와 같은 판단이다.
2. **안 B가 피하는 비용이 작다.** 깨지는 `project_id not null` 전제는 위 표에서 7곳이고, 모두 "`where project_id is not null`" 또는 "`where application_project_id is null`" 한 조건을 더하는 일이다. 반면 안 B가 복제하는 것은 컬럼 ~14개, RPC 5개(`start`·`append`·`begin`·`finish`·`patch`), 라우트 1개, SSE 계약 1벌, 테스트 1벌이다.
3. **`project_id` not null을 지키는 중간안이 없다.** 서류는 프로젝트에 속하지 않으므로 어떤 프로젝트 id도 넣을 수 없다(산출물 대화가 부모 프로젝트를 넣을 수 있었던 것과 다르다). 그래서 안 A를 고르면 not null 해제는 피할 수 없다 — 이것이 안 A의 유일한 실질 비용이다.

**안 A를 고를 때 반드시 함께 할 것** (전부 ★): D-10·D-11·D-12·D-13(제약·트리거), D-17(`return_target` CHECK), D-18(인덱스), D-52(`ai_jobs` CHECK 완화), 그리고 `project_id is not null` 조건을 더해야 하는 4곳 — `get_deletion_impact`의 `cascade.writing_chats`, `delete_career_item`, S-10·S-44 목록 쿼리, 턴 파이프라인 대상 판정.

**안 A의 세 번째 대안(기각)**: 대상을 일반화한 `(target_type, target_id)` 쌍 한 벌로 바꾸기. 복합 FK를 걸 수 없어 "대상이 같은 사용자의 것"을 DB가 보장하지 못하고(트리거로 대체), 연쇄 삭제도 트리거로 흉내 내야 한다 — 409행이 이미 같은 이유로 배타 모양을 기각했다.

---

## 3. `structured_draft`의 서류 모양 초안 (2.5.0에 더할 것)

STAR 대화(`schema_version 3`)·산출물 대화(`target: "project_deliverable"`)와 **`target` 키로 구분**한다(495행 규칙 그대로 — `target`과 대화의 대상 열이 어긋나면 RPC가 거부).

### 경력기술서 대화 (`target: "career_description"`)

```json
{
  "schema_version": 1,
  "target": "career_description",
  "facts": [
    { "id": "uuid", "slot": "contribution", "text": "결제 승인 지연을 인덱스 재설계로 줄였음", "actor": "self",
      "source_message_ids": ["uuid"], "source_quotes": ["…"], "review": "ok", "reviewed_at": null, "origin": "ai" }
  ],
  "document": {
    "sections": [
      { "section_id": "uuid",
        "kind": "experience",
        "heading_label": "토스페이먼츠 › 결제 승인 개선",
        "experience_id": "uuid", "education_id": null, "project_ids": ["uuid"],
        "draft": {
          "value": "- 결제 승인 API 응답 시간을 1.2초에서 0.7초로 줄였음\n- …",
          "blocks": [
            { "block_id": "b1", "type": "bullet_list", "text": "…", "basis": "new",
              "source_fact_ids": ["uuid"],
              "source_evidence": [
                { "source_type": "project", "source_id": "uuid", "source_field": "result",
                  "quote": "결제 승인 API 응답 시간이 1.2초에서 0.7초로 줄었음",
                  "source_locator": null, "label": "PRJ-3" }
              ],
              "placeholders": [], "flags": [], "review": "ok" }
          ],
          "rev": 2, "generated_at": "2026-11-05T10:00:00Z",
          "base_body_hash": "sha256:…", "replace_allowed": true,
          "missing_slots": [], "dropped_block_count": 0,
          "applied_at": null, "applied_mode": null, "applied_rev": null
        } }
    ],
    "section_order_proposal": ["uuid", "uuid"],
    "source_ranking": { "origin": "ai_ranking", "items": [{ "project_id": "uuid", "rank": 1, "reason": "…" }],
                        "generated_at": "2026-11-05T10:00:00Z" }
  },
  "meta": { "tone": "concise", "tone_origin": "chat", "tone_updated_at": "2026-11-05T10:00:00Z" },
  "clarifications": [ { "kind": "number_vague", "section_id": "uuid", "note": "…" } ],
  "sensitive_flags_count": 0,
  "draft_count": 2
}
```

### 자소서 문항 대화 (`target: "cover_letter"`)

```json
{
  "schema_version": 1,
  "target": "cover_letter",
  "facts": [ "… 위와 같은 모양 …" ],
  "document": {
    "questions": [
      { "question_id": "uuid",
        "question_text": "지원 동기를 작성해 주세요",
        "template_key": "motivation", "question_class": "motivation",
        "char_limit": 800, "count_basis": "with_spaces", "user_note": "핀테크 경험을 앞에",
        "draft": {
          "value": "…", "blocks": [ "… 위와 같은 모양 …" ],
          "rev": 1, "generated_at": "…", "base_body_hash": "sha256:…", "replace_allowed": true,
          "char_count": 812, "char_limit_at_generation": 800, "char_adjust_needed": false,
          "missing_slots": [], "dropped_block_count": 0,
          "applied_at": null, "applied_mode": null, "applied_rev": null
        } }
    ],
    "question_edit_proposal": [ { "question_id": "uuid", "op": "add", "question_text": "…", "char_limit": 600 } ]
  },
  "meta": { "tone": "detailed", "tone_origin": "chat", "tone_updated_at": "…" },
  "clarifications": [],
  "sensitive_flags_count": 0,
  "draft_count": 3
}
```

### 키 설명과 `[가정]`

| 키 | 설명 | 상태 |
|----|------|------|
| `target` | `career_description` / `cover_letter`. 대화의 `document_kind`와 같아야 한다(어긋나면 `invalid_patch`) | 확정안 |
| `facts[]` | 산출물 대화와 **같은 모양**(525행). `slot` 값 목록만 AI 명세가 정한다 | ai-feature-designer 확인 |
| `document.sections[]` / `document.questions[]` | 서류 종류별로 **키 이름이 다르다**(산출물의 `deliverable`과 같은 자리). 한 이름(`items`)으로 통일할 수도 있다 — AI 확인 | `[가정]` |
| `section_id` / `question_id` | **uuid**. 이관에서 기존 `draft_sections.id`를 그대로 쓰면 `evidence_links.owner_id`를 바꿀 필요가 없다(D-45) | 확정안 |
| `heading_label` | 저장 시점 머리글 라벨("부모 › 프로젝트" — `private.draft_source_label`과 같은 규칙, 교육은 표시 이름). 경력·교육이 지워져도 남는다 → 4.2 집계가 jsonb 안 soft id를 보지 않아도 되는 근거(D-64) | 확정안 |
| `experience_id`·`education_id`·`project_ids` | 섹션이 가리키는 커리어 항목(**제안 쪽은 참고용**, 정본 쪽이 본). 삭제 트리거는 돌지 않는다 | `[가정]` |
| `draft` | 산출물 `deliverable.body`와 **같은 모양을 섹션마다**. `rev`·`base_body_hash`·`replace_allowed`·`applied_*` 의미 모두 그대로(526~533행) | 확정안 |
| `blocks[].source_evidence[]` | **CL-5의 "섹션별 근거 배열".** 저장 때 `evidence_links` 행이 된다. 산출물 대화에는 없던 키다(산출물은 근거를 `evidence_links`에 넣지 않는다, 544행) | **CL-5 근거** |
| `blocks[].placeholders`·`flags` | `drafts` 시절 `ai_content` 블록 키를 그대로 가져온다(`[수치 확인 필요]`·`number_check_needed` 등, CL-A4·CL-5) | 확정안 |
| `draft.char_count`·`char_limit_at_generation`·`char_adjust_needed` | **자소서 문항만.** 글자 수 제한 준수 판정(제한의 90~110%, 최대 10% 초과 허용 — CL-A4)을 제안 단계에서 남긴다. 정본 쪽 초과 안내는 화면 계산 | `[가정]` |
| `document.source_ranking` | **AI-11 결과**(CL-5 "AI-11도 유지, 대화 안의 한 단계"). `drafts.options.selection_origin`·`ranking`을 대체한다. 턴 작업의 `output`에도 남는다(D-57) | `[가정]` |
| `document.question_edit_proposal` | AI가 문항 추가·수정을 **제안**할 자리(F-DOC-10 Could). MVP에서 비워 둬도 되지만 키 자리는 지금 잡아 둔다 | `[가정]` |
| `meta.tone` | CL-A3의 문체 메타. **권고는 정본(`application_documents.meta.tone`)에 두고 여기에는 "이번 대화에서 지시받은 값"만** 두는 것이다(D-27·Q-DM-3) | **결정 필요** |
| `clarifications[]` | 산출물과 같은 모양 + `section_id`/`question_id` 지정 | 확정안 |
| `draft_count` | D-26 결론(섹션별 6 / 대화 전체 상한)에 따라 모양이 달라진다 — 섹션별이면 `draft.draft_count`로 내려간다 | **결정 필요** |

---

## 4. `drafts` 계열 → 새 구조 대응표

**S = `application_documents`(정본, 신설)** / **C = 대화 `structured_draft`(제안)** / **E = `evidence_links`** / **J = `ai_jobs`·`writing_chat_messages`(턴 메타)** / **—** = 폐기.

### `drafts` (A.9, 2056행)

| 컬럼 | 현재 값·의미 | 행선지 | 새 값·처리 |
|------|--------------|--------|------------|
| `id` | 초안 1건(다시 생성 = 새 행) | **S** | 서류 1건(지원 프로젝트 × 종류). 다시 생성이 없어 행이 늘지 않는다 |
| `application_project_id` | 소유 키 | **S** | 그대로(복합 FK cascade) |
| `insight_id` | 생성 기준 인사이트(FK set null) | **—** (+ J) | 대화형은 **매 제안 턴에 최신 인사이트를 읽는다**. 어떤 인사이트를 썼는지는 턴 작업 `params`에 `[가정]` |
| `draft_type` | `career_description` / `cover_letter` | **S** | `document_kind`(같은 2값) + `unique (application_project_id, document_kind)` |
| `title` | 초안 제목 | **—** | 화면 제목이 서류 종류로 고정된다. 쓰는 곳이 있으면 ux-planner 확인 |
| `status` `composing` | 설정만 하고 생성 전 | **—** | **폐기(CL-A6 명시).** 설정 화면이 없어져 이 상태가 생기지 않는다 |
| `status` `generating` | 생성 중 | **J** | 그 서류의 **진행 중 턴 작업**(`ai_jobs` `queued`/`running`, `target_id` = 대화)으로 읽는다 |
| `status` `ready` | 완료 | **S** | 저장된 상태 자체. "초안 있음" = **내용 있는 섹션·문항 ≥ 1**(CL-A6) |
| `status` `partially_failed` | 일부 문항 실패 | **—** | 문항 단위 생성이 없다. 실패는 **턴 하나의 실패**(메시지 `status='failed'` + 작업 `error_code`, 486행) |
| `status` `failed` | 전부 실패 | **—** | 같음 |
| `options.included_experience_ids`·`included_education_ids`·`included_project_ids`·`project_order` | 포함 항목 설정 화면의 선택 | **—** (+ C) | **폐기(CL-2).** 섹션 배열 자체가 "포함된 것"의 정본. AI 제안 단계의 순서 제안은 `C.document.section_order_proposal` |
| `options.selection_origin` (`insight`/`ai_ranking`/`user`) | 기본 선택의 출처 | **C** | `C.document.source_ranking.origin`. 저장 테이블에는 남기지 않는다(A23은 폐기) |
| `options.ranking` | AI-11 출력 복사 | **C** (+ J) | `C.document.source_ranking.items` + 턴 작업 `output` |
| `options.tone` (`concise`/`detailed`/null→`concise`) | 문체 선택 | **S.meta.tone** (권고) | 화면 선택은 폐기(CL-2), **값은 남긴다**(CL-A3). 대화가 여럿이라 정본 쪽이 맞다(Q-DM-3). null 정규화 규칙(750행)은 그대로 |
| `edited_at` | 사용자 편집 시각 | **S.updated_at** | 공통 컬럼으로 대체(기대 버전 기준도 이 컬럼) |
| `first_copied_at` | 첫 복사 시각 | **S** | 그대로 유지 권고(지표용, PRD 7장) |
| `regenerated_from_id` | 다시 생성 원본(FK set null) | **—** | 다시 생성이 없다. 이력 역할은 **대화 기록**이 한다 |
| `completed_at` | 결과 시각 | **—** | 턴 작업 `finished_at` |
| `run_generation` | 실행 세대(내부) | **—** | 결과 행이 없어 세대 검사 대상이 아니다 |
| `provider`·`model`·`model_tier`·`connection_tier` | AI 공통 메타(자소서는 "마지막 완료 문항" 값, 750행) | **J** | **`writing_chat_messages`(assistant 행)**의 같은 컬럼. 배지(F-AI-09)는 제안 카드·메시지 기준 |
| `prompt_version`·`input_hash`·`career_snapshot_hash` | 재사용·추적 | **J** | 턴 작업 쪽. **`input_hash` 재사용(같은 입력이면 호출 안 함)은 대화에 쓰지 않는다** — 턴마다 발화가 다르다 |
| `validation_report` | 결과 검증 기록 | **C** | 블록 `review`·`flags`·`clarifications`. 저장 컬럼 없음 |
| `usage` | 결과 단위 토큰 합계 | **J** | 턴 작업 `usage` + `ai_usage_records` |

### `draft_sections` (A.10, 2060행)

| 컬럼 | 현재 값·의미 | 행선지 | 새 값·처리 |
|------|--------------|--------|------------|
| `id` | 섹션·문항 1건 | **S.body[].section_id / question_id** | **같은 uuid를 재사용**(D-45) → `evidence_links.owner_id` 무변경 |
| `draft_id` | 부모 초안 | **—** | 배열 소속으로 대체 |
| `sort_order` (unique per draft) | 순서 | **S.body[].sort_order** | 배열 순서 + 명시 키 둘 다(권고: 배열 순서를 정본) |
| `section_kind` (`experience`/`education`/`standalone_projects`/`cover_letter_question`) | 섹션 종류 | **S.body[].kind** | 앞 3값은 경력기술서 섹션, `cover_letter_question`은 자소서 문항 → **`document_kind`로 이미 갈라지므로 자소서는 `kind`를 두지 않아도 된다** `[가정]` |
| `experience_id`·`education_id` (soft) | 섹션 머리글의 경력·교육 | **S.body[].experience_id / education_id** + `heading_label` | jsonb 안 soft id. **삭제 트리거가 돌지 않는다** → 삭제 영향 집계는 `evidence_links`로(D-64), 표시는 `heading_label`로 |
| `heading` | 섹션 머리글 | **S.body[].heading_label** | 저장 시점 라벨 |
| `question_text` | 문항 문구(≤ 1,000자) | **S.body[].question_text** | 그대로(CL-8) |
| `template_key` (`motivation`/`job_competency`/`future_plan`) | 기본 3문항 식별 | **S.body[].template_key** | 그대로. 기본 3문항 시드는 문서 만들기 분기가 넣는다 |
| `char_limit` (1~10,000) | 글자 수 제한 | **S.body[].char_limit** | 그대로(CL-8) |
| `count_basis` (`with_spaces`/`without_spaces`) | 셈 기준 | **S.body[].count_basis** | 그대로 |
| `user_note` (≤ 300자) | 문항 메모 | **S.body[].user_note** | 그대로(CL-8). `user_note` 근거의 `source_id`는 D-47 |
| `source_selection_mode` (`ai`/`user`) | 근거 선택이 AI 기본인지 사용자 변경인지 | **—** (+ C) | **폐기.** 근거를 사용자가 고친 사실은 `evidence_links` 행의 존재·`sort_order`로 충분하다. AI 제안 여부는 `C.document.source_ranking.origin` |
| `sources_modified_at` | 근거 변경 시각(다시 생성 권유 판정) | **—** | **폐기.** 대화형은 사용자가 그 섹션을 다시 제안받으면 된다 — "근거를 바꿨으니 다시 생성하세요" 배너의 근거 데이터가 없어진다 → ux-planner 확인(Q-DM-5) |
| `generation_no` | 문항 재생성 세대 | **—** | **폐기.** 제안 횟수는 `C.draft_count`(D-26) |
| `question_class` (`motivation`/`job_competency`/`future_plan`/`experience_story`) | AI가 판정한 문항 종류 | **S.body[].question_class** | 그대로(AI 제안 → 저장) |
| `status` (`pending`/`generating`/`ready`/`failed`) | 문항별 생성 상태 | **—** | **폐기.** 문항별 생성이 없다. 진행 중 표시는 턴 작업 |
| `ai_content` (블록 jsonb) | AI가 만든 본문 블록 | **C.…draft.blocks** | **제안 쪽으로 간다.** 정본은 마크다운 문자열 |
| `edited_content` (블록 jsonb) | 사용자 편집본 | **S.body[].body** (마크다운 text) | **이원화 폐기.** S-44 `project_deliverables.body`와 같은 모양 — 사용자가 확정한 마크다운 문자열 하나. ★ **블록 단위 근거(`item_key = block_id`)가 섹션 단위 근거로 내려간다**(CL-5와 일치, UX 확인) |
| `ai_char_count` | 생성 본문 글자 수 | **—** | 계산값(화면). 제안 쪽은 `C.…draft.char_count` |
| `correction_applied` | 글자 수 보정 호출 여부 | **—** | 보정이 대화 요청("더 짧게")이 된다 |
| `validation_report`(+ `char_adjust_needed`) | 검증 기록·글자 수 경고 | **C** (+ 화면 계산) | 제안 블록 `review`·`flags`. 정본의 초과 안내는 `char_count` vs `char_limit` 계산(D-40) |
| `completed_at`·`run_generation` | 내부 | **—** | 턴 작업 쪽 |
| AI 공통 메타 7종 | 문항 단위 공급자·모델 등 | **J** | `writing_chat_messages` |

### `draft_section_sources` (A.11, 2064행)

| 컬럼 | 현재 값·의미 | 행선지 | 새 값·처리 |
|------|--------------|--------|------------|
| `id` | 근거 선택 1건 | **E** | `evidence_links` 행으로 합친다(DM-6 복귀) |
| `draft_section_id` | 부모 문항 | **E.owner_id** | 섹션·문항 uuid(`owner_type = 'application_document_section'`) |
| `application_project_id` | 소유 키 | **E.application_project_id** | 그대로 |
| `experience_id`·`education_id`·`project_id` (soft) | 고른 커리어 항목 | **E.source_type + E.source_id** | `experience`/`education`/`project` 출처로 1:1 대응 |
| `role` (`primary`/`supporting`) | 주/보조 | **—** 또는 E.`item_key` | 쓰는 화면이 남는지 ux-planner 확인. 권고: **폐기**(근거 칩에 등급 표시가 없다) |
| `origin` (`ai`/`user`) | 선택 주체 | **—** (+ C) | `C.document.source_ranking.origin`. 행 단위로는 남기지 않는다 |
| `rationale` (≤ 300자) | 선택 이유 | **C** | `C.document.source_ranking.items[].reason`(제안 카드에만) |
| `reuse_reason` | 재사용 이유 | **—** | 쓰는 곳 확인 뒤 폐기 |
| `requirement_ids` uuid[] | 대응 JD 요건 | **E.item_key** 또는 블록 `source_evidence` | 요건 대응은 블록 쪽(`jd_requirement` 근거)으로 이미 표현된다 → 권고 **폐기** |
| `sort_order` | 표시 순서 | **E.sort_order** | 그대로(같은 이름 컬럼이 있다) |
| `source_label` (≤ 300자, v4.8 ED-3) | 저장 시점 "부모 › 프로젝트" 라벨 | **E.source_label** | **같은 이름·같은 규칙 컬럼이 이미 있다**(883행). `private.draft_source_label`·`draft_source_parent_name`은 폐기하고 근거 쪽 라벨 생성 경로를 쓴다 — 단 `private.education_display_name`은 남긴다 |
| `source_deleted_at` | 원본 삭제 표시 | **E.source_deleted_at** | **같은 이름 컬럼이 이미 있다.** 삭제 트리거도 이미 `evidence_links`를 대상으로 돈다(895행) → **트리거 3개(`draft_sources_mark_project_deleted`·`_mark_education_deleted`·`draft_sources_remove_project_detail` 잔재)를 폐기**할 수 있다 ★ |
| CHECK `num_nonnulls(...) >= 1` / `<= 1` | 출처 1개 이상·경력·교육 배타 | **E의 insert 트리거** | 근거 쪽 "원본·소유자 검사" 트리거가 같은 역할을 한다 |

**요약**: `drafts` 20컬럼 중 **S 5 / C 4 / J 6 / 폐기 5**, `draft_sections` 23컬럼 중 **S 10 / C 3 / J 1 / 폐기 9**, `draft_section_sources` 14컬럼 중 **E 7 / C 2 / 폐기 5**. 없어지는 개념은 `composing`(CL-A6), 문체 선택 화면(CL-2), 포함 항목 설정(CL-2), 다시 생성 새 행(CL-6), 문항별 생성 상태·세대(CL-6), `ai_content`/`edited_content` 이원화(CL-3), `source_selection_mode`·`sources_modified_at`(CL-2).

---

## 5. 마이그레이션 단계 (SQL 없이)

**원칙**: 비파괴 단계(1~3)를 먼저 배포하고 **코드가 새 경로로 완전히 넘어간 것을 확인한 뒤** 이관(4~6)을 돌리고, 파괴 단계(7)는 **별도 배포·별도 날짜**로 뺀다. 기존 마이그레이션 파일은 고치지 않고 새 파일만 더한다(11.3 머리말 규칙, 1893행).

| 단계 | 내용 | 파괴적 | 되돌릴 수 있나 |
|------|------|--------|----------------|
| **1** | `application_documents` 생성 — 테이블·CHECK·`unique (application_project_id, document_kind)`·`updated_at` 트리거·RLS 정책·grant. **아무 코드도 아직 쓰지 않는다** | 아니다 | 예(테이블 drop) |
| **2** | `writing_chats` 대상 열 확장 — `application_project_id`·`document_kind` 추가, 복합 FK, **`project_id` not null 해제 ★**, CHECK 3개 교체, 인덱스 1개 추가, 트리거 `writing_chats_check_target`·가드 교체, `return_target` CHECK 확장. 함께 **`ai_jobs`의 `target_type='writing_chat'` ↔ `application_project_id is null` CHECK 완화 ★** | 아니다(데이터 손실 없음). **단 not null 해제는 되돌릴 때 위반 행이 있으면 막힌다** | 조건부 — 서류 대화 행이 생긴 뒤에는 not null 복구 불가 |
| **3** | RPC 신설·교체 — `start_document_writing_chat` 신설, `save_application_document` 신설, `apply_structured_draft_patch` 교체(서류 분기), `get_deletion_impact`·`delete_career_item`·`get_account_deletion_summary` 교체(새 키·새 집계), 근거 쓰기 내부 헬퍼 신설. **기존 서류 RPC는 아직 지우지 않는다** | 아니다 | 예(이전 함수 정의 복원) |
| **— 여기서 코드 배포**: 화면·서버가 새 경로만 쓰도록 바꾼다. 읽기는 아직 양쪽이 가능 | | | |
| **4** | **본문 이관** — `drafts` + `draft_sections` → `application_documents.body` jsonb 조립. 규칙: 서류당 1행(`draft_type`별 **가장 최근 `ready`/`partially_failed` 행**, 없으면 가장 최근 행), 섹션 본문 = `coalesce(edited_content, ai_content)`의 블록을 **마크다운으로 조립**(조립 함수 = 화면 복사 규칙과 같은 것 `[가정]`), `section_id`/`question_id` = **기존 `draft_sections.id` 그대로**, 문항 메타(문구·`char_limit`·`count_basis`·`user_note`·`template_key`·`question_class`) 그대로, `heading` → `heading_label`, `options.tone` → `meta.tone`(null은 `concise`), `first_copied_at` 복사. 멱등(이미 있는 `(application_project_id, document_kind)`는 건너뜀) | 아니다(읽기만 + 새 테이블 insert) | 예(새 행 삭제) |
| **5** | **근거 재지정** — `evidence_links` 중 `owner_type = 'draft_section'`이고 `owner_id`가 4단계에서 옮긴 섹션인 행의 **`owner_type`만 `'application_document_section'`으로 바꾼다**(`owner_id`는 그대로 — D-45 권고를 쓰면 이 단계가 한 컬럼 update다). 옮기지 못한 섹션의 근거 행은 **`draft_section`으로 남긴다**. 이어서 **`draft_section_sources` → `evidence_links`**: 근거로는 없고 "사용한 경력·프로젝트" 선택으로만 있던 행을 근거 행으로 옮길지 결정 필요(Q-DM-4) — 권고: **옮기지 않는다**(선택은 제안 입력 범위이고 근거가 아니다. 섹션 근거는 이미 `evidence_links`에 있다) | 아니다 | 예(`owner_type` 되돌리기) |
| **6** | **이관하지 못한 행 기록** — 4단계가 건너뛴 `drafts`(본문 블록이 하나도 없음, `status in ('composing','generating')`, 조립 실패, 지원 프로젝트가 이미 없음)를 **운영자 JSON 덤프로 보관**(DB 테이블을 새로 만들지 않는다 `[가정]`)하고 `application_documents`에 `migration_note`(text null)를 남기거나 빈 문서 행을 만들지 않는다. 화면은 "이전 초안을 옮기지 못했어요" 안내(문구 UX, CL-A5) | 아니다 | 예 |
| **— 관찰 기간**: 새 경로만 쓰이고 서류가 정상 저장·조회되는지 확인(권고 최소 1주 `[가정]`) | | | |
| **7 ★** | **파괴 단계** — `draft_section_sources` → `draft_sections` → `drafts` **drop**(FK 순서). 함께: 트리거·함수 `draft_sources_mark_project_deleted`·`draft_sources_mark_education_deleted`·`draft_source_label`·`draft_source_parent_name`·`backfill_education_display_labels` 정리(`education_display_name`·`trim_js_whitespace`는 **남긴다**), 서류 결과 RPC 폐기(`begin`/`complete`/`fail_career_description`, `begin`/`complete`/`fail_cover_letter`, 자소서 문항 사용자 RPC `20261102000300` 일괄, `ai_jobs_release_drafts`), `ai_jobs_career_description_in_flight_key` 인덱스 삭제, grant 회수, `database.types.ts` 재생성 | **예 — 되돌릴 수 없는 지점** | **아니다.** 7단계 이전 상태로는 백업 복원만 |
| **8** | 뒷정리 — `evidence_links.owner_type` CHECK에서 `draft_section`을 뺄 수 있는지 판정(남은 행 0이면 빼고, 하나라도 있으면 **남기고 insert 트리거로 새 행 차단** — SD-A19 선례). `ai_jobs.job_type`·`target_type`의 서류 값은 **90일 보관 행 때문에 빼지 않는다** | 조건부 | — |

**되돌릴 수 없는 지점**: 7단계. 그 전까지는 `drafts` 계열이 읽기 가능한 상태로 공존하므로 코드 배포만 되돌리면 복구된다. 그래서 **7단계는 반드시 별도 마이그레이션 파일·별도 배포**로 뺀다(설정 사이클이 `profile` CHECK에서 같은 판단을 했다 — 889행).

**옮기지 못한 행 처리 방침**(CL-A5 "읽기 전용으로 남기고 사용자에게 알린다"): 7단계가 테이블을 지우므로 **"읽기 전용으로 남긴다"는 7단계 이전까지만 가능하다**. 그래서 권고는 ① 6단계 덤프를 운영자가 보관하고 ② 관찰 기간 동안 화면에 "옮기지 못한 이전 초안이 있어요 — 복사해 두세요" 안내를 띄우고 ③ 7단계 뒤에는 안내만 남긴다. 이 3단계가 사용자 결정 CL-A5의 뜻에 맞는지 **product-planner 확인 필요**.

**CL-A5와 다른 점 1곳**: CL-A5는 "`drafts` → 서류별 **대화 1개**(본문만, 메시지 없음)"로 옮기라고 했다. 정본을 `application_documents`에 두는 안에서는 **그 대화를 만들 이유가 없다**(본문이 대화 밖에 있고, 메시지 없는 빈 대화는 화면 대화 목록을 어지럽힌다). 권고: **대화를 만들지 않고** 사용자가 작성 화면에서 "새 대화"로 시작한다. 이것도 Q-DM-1에 딸린 확인 사항이다.

---

## 6. 설정 사이클(SD-*)과 겹치는 자리

| 자리 | 설정 사이클이 한 것 | 이 사이클이 조심할 점 |
|------|---------------------|------------------------|
| **2.8 `source_type = 'profile'`** (885~893행, SD-A19) | CHECK 목록에 **남기고** insert 트리거로 새 행 차단, 기존 행·라벨 유지, `source_deleted_at` 소급 없음, 화면은 "원본으로 이동"만 비활성 | **겹치지 않는다**(출처 쪽, 이번은 소유자 쪽). 하지만 **같은 패턴을 그대로 쓴다** — `owner_type = 'draft_section'` 폐기도 "CHECK 유지 + 트리거 차단 + 기존 행 유지"다(D-44·8단계). 두 규칙이 같은 트리거 안에 들어가므로 **한 함수를 두 번 교체하지 않도록** db-engineer가 순서를 잡는다 |
| **2.8 허용 출처 커리어 5종** (893·907행, SD-A19·R-SD-9) | 모든 소유자에서 **5종**(`profile` 제외). "경력기술서 = 커리어 5종만", 자소서 문항도 같은 기준. **insert 트리거와 저장 RPC 허용 목록이 같은 5종** | 소유자 이름만 바뀐다(D-48). **5종 목록·"트리거와 RPC가 같은 목록" 문장은 그대로 들고 간다.** 새 저장 RPC(`save_application_document`)가 그 목록을 쓰는 세 번째 호출자가 된다 |
| **6-A `profile_filled`·`hints:"profile"` 삭제** (1538~1549행, SD-A18) | 응답에서 **키가 사라진다**. `data_sufficiency` `thin`에서 "프로필 또는" 삭제 | **서류 readiness에 남은 영향은 없다.** `features.draft`는 `complete_experience`·`complete_project`만 보고 프로필을 보지 않는다(1535·1536행). 1547행 "읽는 곳 — UX"의 "S-16·S-17 데이터 부족 게이트" 서술이 S-17 개정과 겹치므로 **그 문장만 ux-planner와 함께 확인**(D-77) |
| **SD-6 컨텍스트 팩 프로필 블록 삭제** (2.1.5, 214행) | `app_ai_writer`에 `profiles` 내 정보 컬럼·`profile_job_interests`·`profile_options` grant **없음**. 팩이 `profiles`를 읽지 않는다 | 서류 대화의 입력 컨텍스트도 **프로필 없는 상태**를 전제로 설계한다. `app_ai_writer` grant에 더할 것은 **`application_documents` select 하나**(D-74) — `profiles` 쪽은 건드리지 않는다 |
| **SD-2 `computed_total_months`** (6.2, 1650행~) | 연차는 저장 컬럼이 아니라 전용 함수 `private.compute_total_experience_months(p_user_id, p_as_of)`, `p_as_of` 필수 인자(R-SD-23) | 경력기술서 제안이 연차를 말할 때 이 함수를 쓴다. **DM 쪽 변경 없음**, 호출자가 하나 늘 뿐이다 |
| **SD-4·SD-A12 사용량 7행 묶음** (2.9.5, 1087행) | "묶음은 **표시 단계에서만**. RPC·SQL에 넣지 않는다 — **자기소개서 작성이 채팅형으로 바뀌는 다음 사이클에 묶음이 또 바뀐다**" | **그 '다음 사이클'이 지금이다.** CL-A8이 "저장 `feature` 값·묶음 그대로"라고 했으니 **RPC·응답 변경 없음**이고, 1087행의 예고 문장을 "**CL-A8로 바뀌지 않기로 확정**"으로 고친다(D-61). 대신 **`feature`↔`job_type` 조합이 새로 생기는 것**(D-58)이 설정 사이클이 보지 못한 지점이다 — AI C-13.1 표가 같이 바뀌어야 한다 |
| **SD-6 `prompt_version` 문자열 변경** (10장 v4.12 (11)) | 과거 결과 행을 **고치지 않는다**. `input_hash` 재사용이 배포 시점에 **한 번 전부 끊긴다**(의도) | 서류는 **`input_hash` 재사용 자체가 없어진다**(대화 턴은 발화가 매번 다르다) → `drafts.input_hash` 폐기(4장). AI-03·AI-04의 재사용 규칙을 AI 명세에서 함께 지운다 |
| **v4.12 테이블 수 29 + 참조 6** (9장, 1799행) | `profile_job_interests` 추가로 29 | 세 테이블 폐기 + 하나 신설로 **28**이 된다(D-88). 설정 사이클 숫자 위에 쌓는다 |
| **2.1.6 개선 요청은 테이블 없음** (220행, SD-3) | 테이블 없음 | 겹치지 않는다 |

---

## 7. 결정이 답을 주지 않는 것

| ID | 질문 | 리더/담당 추천 |
|----|------|-----------------|
| **Q-DM-1** | **CL-3의 "`structured_draft`로 통일"을 문자 그대로 읽으면 서류 본문·문항의 정본이 대화 안에만 있게 된다.** 그러면 CL-A1(대화 여러 개)·CL-4(기존 본문을 현재 값으로)·CL-8(AI 없이 문항 편집)이 성립하지 않는다. 정본을 어디 둘까? | **(권고) 얇은 정본 테이블 `application_documents` 1개 + 제안은 `structured_draft`.** `drafts`·`draft_sections`·`draft_section_sources` 3개는 CL-3대로 폐기되고 순수 테이블 수는 **−2**다. 산출물 대화(S-44)가 정확히 이 모양이고(본문은 `project_deliverables`, 제안은 `structured_draft`), CL-2가 "산출물 상세와 같은 방식"이라고 했으므로 결정의 정신에 맞는다. 대안 (a) 대화 안에만 두기 = 위 3개 결정이 깨진다 / (b) `application_projects`에 jsonb 컬럼 2개 = 서류별 `updated_at`(기대 버전)·RLS·삭제 집계가 지원 프로젝트와 섞인다 |
| **Q-DM-2** | 정본의 **섹션·문항을 jsonb 배열로 둘까, 행으로 쪼갤까?** | **(권고) jsonb 배열.** 이유: ① 저장이 페이지 단위 1회(DM-21)라 행 단위 동시성이 필요 없다 ② 문항 ≤ 10·섹션 ≤ 30이라 크기가 작다 ③ 문항별 생성 상태·세대가 없어져 행으로 둘 이점이 사라졌다. **대가 2개**: `user_note` 근거의 `source_id`가 행이 아니라 jsonb 안 uuid가 되어 "원본 삭제됨" 판정을 트리거가 할 수 없다(D-47), 4.2 집계가 jsonb를 봐야 한다(D-64 — `heading_label`로 회피). 대가가 받아들여지지 않으면 **(c) 문항·섹션만 행으로 쪼갠 `application_document_sections`** — 결국 `draft_sections`의 축소판이 된다 |
| **Q-DM-3** | **문체(CL-A3)를 대화의 `structured_draft` 메타에 둘까, 정본에 둘까?** | **(권고) 정본 `application_documents.meta.tone`.** CL-A3이 "다음 제안에 이어 쓴다"고 했는데 대화가 여러 개라(CL-A1) 대화 안에 두면 새 대화에서 잊힌다. 대화 안에는 "이번 대화에서 지시받은 값"만 두고 저장 때 정본으로 올린다. **CL-A3 문장을 이 방향으로 수정 제안** |
| **Q-DM-4** | `draft_section_sources`의 "사용한 경력·프로젝트 **선택**"(F-DOC-08)은 근거(`evidence_links`)와 성질이 다르다 — 선택은 **제안 입력 범위**, 근거는 **출력의 출처**다. 선택을 정본에 저장할까? | **(권고) 저장하지 않는다.** 대화에서 "이 문항은 A·B 프로젝트로" 말하면 그 턴의 입력 범위가 되고, 결과 근거는 `evidence_links`에 남는다. 이관에서도 선택만 있던 행은 옮기지 않는다(5단계). **대가**: "근거를 바꿨으니 다시 생성" 배너(F-DOC-08)의 판정 데이터(`sources_modified_at`)가 없어진다 → Q-DM-5 |
| **Q-DM-5** | `sources_modified_at` 폐기로 **"근거를 바꿨으니 다시 생성하세요" 배너**의 근거가 없어진다. 대체할까? | **(권고) 대체하지 않는다.** 대화형에서는 사용자가 그 섹션을 다시 제안받으면 되고, 배너는 "한 번에 생성" 모델의 장치였다. ux-planner가 배너를 유지하고 싶다면 섹션 객체에 `sources_changed_at`을 두는 것이 최소 비용 |
| **Q-DM-6** | CL-A5의 **"서류별 대화 1개(본문만, 메시지 없음)" 이관 대화**를 만들까? | **(권고) 만들지 않는다.** Q-DM-1 권고에서는 본문이 대화 밖에 있어 빈 대화에 담을 것이 없고, 메시지 0개 대화가 대화 목록에 남는다. 사용자는 작성 화면에서 "새 대화"로 시작한다. **CL-A5 문장 수정 제안** |
| **Q-DM-7** | 자소서는 **문항 10개를 한 대화에서** 채우는데(CL-1) 메시지 상한 **40**(시작 인사 제외)이 충분한가? 문항당 사용자 2턴 + AI 2턴이면 10문항에 40턴이 꽉 찬다 | **(권고) 상한 40은 그대로 두고**(CL-A1, CHECK 변경은 파괴적이지 않지만 규칙이 셋으로 갈라진다) 사용자가 "새 대화"로 이어 가게 한다(`closed` 뒤 새 행, 421행 규칙 그대로). 정본이 대화 밖에 있어 **대화를 새로 열어도 본문은 그대로다** — Q-DM-1 권고의 부수 이점이다. 상한을 올려야 한다면 ux-planner·ai-feature-designer가 턴 수를 추정해 와야 한다 |
| **Q-DM-8** | **`draft_count` 상한 6**(2.5.0, 534행)을 서류에 어떻게 적용할까? 섹션·문항이 여러 개다 | **(권고) 섹션(문항)별 6회 + 대화 전체 상한은 두지 않는다.** 6은 "같은 대상을 몇 번 다시 쓰게 할까"의 숫자이고 서류의 대상은 섹션이다. 저장 모양은 `draft.draft_count`(섹션 객체 안)로 내려간다. 거부 코드 `writing_chat_draft_limit_reached`는 재사용하고 details에 `section_id`를 넣는다 `[가정]`. 대화 전체는 메시지 40이 이미 막는다 |
| **Q-DM-9** | 서류 대화를 **`get_data_readiness` 게이트 대상**에 둘까? AI-12·AI-13은 판정 대상이 아니다(1562행) | **(권고) 둔다(`features.draft` 유지).** AI-12·AI-13은 "커리어를 만드는" 대화라 데이터가 없는 것이 당연하지만, 서류 대화는 **커리어를 근거로 쓰는** 대화다. 근거가 없으면 제안이 전부 자리 표시가 된다. 게이트 지점만 "생성 버튼" → "작성 화면의 전체 초안 제안"으로 옮기고, 문항 편집·본문 편집은 게이트 밖(CL-8) |
| **Q-DM-10** | `drafts.title`·`first_copied_at`·`draft_section_sources.role`·`reuse_reason`·`requirement_ids`를 **쓰는 화면이 지금 있는가?** | `first_copied_at`은 PRD 7장 지표가 쓰므로 **유지**, 나머지는 **폐기 권고**. 쓰는 곳 확인은 ux-planner |
| **Q-DM-11** | **서류별 동시 턴 1개**를 막을까? 지금은 "경력기술서 생성은 지원 프로젝트당 1개"(D-54) | **(권고) 대화당 1개(기존 동시 실행 partial unique)로 충분하다.** 서류별로 더 막으면 사용자가 두 대화를 번갈아 쓸 수 없다. 서류 내용은 섹션 단위 저장이라 충돌이 `stale_write`로 잡힌다 |

---

## 8. 다른 담당자에게 확인할 것

### → ux-planner

1. **저장 단위** — 서류 작성 화면의 "저장하기"가 **서류 전체 1회**인가(권고, DM-21과 같은 모양), 섹션·문항별인가? 자소서 10문항을 한 번에 보내면 요청이 커진다(길이 상한 D-69와 연동).
2. **근거 칩의 단위** — 지금은 **블록 단위**(`evidence_links.item_key = block_id`)인데, 정본 본문이 마크다운 문자열이 되면 블록 id가 없어진다. CL-5가 "섹션(문항)마다 근거 배열"이라고 했으니 **섹션 아래 근거 목록**으로 내려가는 것으로 읽었다 — 맞는가? 본문 안 하이라이트가 필요하면 블록 id를 정본에도 남겨야 한다(비용 큼).
3. **F-DOC-08 "사용한 경력·프로젝트" 화면**이 남는가? CL-2는 경력기술서의 **포함 항목 설정 화면**만 폐기했다. 남는다면 그 선택을 저장할 자리가 필요하다(Q-DM-4).
4. **"근거를 바꿨으니 다시 생성" 배너**를 유지하는가?(Q-DM-5) 유지하면 섹션 객체에 `sources_changed_at`을 둔다.
5. **"초안 수" 표시 기준**(S-13·S-31·S-39 카드, C-05 영향 N) — CL-A6의 "내용이 있는 서류만"을 **문서 행 수**(최대 2)로 셀지 **내용 있는 섹션·문항 수**로 셀지. 집계 쿼리 모양이 달라진다(D-83).
6. **섹션 추가·삭제·순서 변경**(CL-A2)이 저장 요청에 어떻게 들어오는가? 전체 배열 덮어쓰기(권고)인가 연산 목록인가.
7. **문항 삭제 확인**(CL-8 "삭제 확인 규칙 현행 그대로")에서 그 문항의 **본문·근거도 함께 지워진다**는 안내가 필요하다 — 문구.
8. `drafts.title`·`first_copied_at`·`role`·`reuse_reason`을 **쓰는 화면이 있는지**(Q-DM-10).
9. **이관하지 못한 이전 초안 안내**(CL-A5) 문구와 그 안내가 어디 뜨는가 — 작성 화면인가 목록(S-17)인가.
10. **작성 화면 주소**(CL-A10 `[가정]`) 확정값 — 데이터 쪽은 영향 없지만 7장 API 경계 표에 적는다.

### → ai-feature-designer

1. **`structured_draft` 서류 모양의 정본 키 이름** — 3장 초안(`document.sections[]` / `document.questions[]` / `draft` / `source_evidence` / `heading_label`)을 그대로 쓸지, `deliverable`처럼 한 이름으로 통일할지. **DM이 이름의 정본이지만(5행) 모양은 AI 명세 출력 스키마가 원천**이므로 합의가 필요하다.
2. **`facts[].slot` 값 목록** — 서류 대화의 슬롯(경력기술서 섹션용 / 자소서 문항 종류별).
3. **섹션 지정 패치 연산**(D-28) — `replace_draft`에 `section_id`를 붙이는 모양, `set_tone` 신설 여부, 자소서 문항 추가·수정 제안(`question_edit_proposal`)을 패치로 받을지.
4. **`draft_count` 상한**(Q-DM-8) — 섹션별 6회 권고에 동의하는가.
5. **`base_body_hash`를 섹션별로** 두는 것(D-25)과 "기준 본문이 바뀐 경우" 안내를 섹션 단위로 내는 것.
6. **AI-11 결과 저장 위치**(D-57) — `structured_draft.document.source_ranking` + 턴 작업 `output`으로 충분한가. `drafts.options.ranking`은 폐기한다.
7. **글자 수 보정**(현행 AI-04의 별도 호출, `adjust_length` 단계)이 대화 턴 안에서 어떻게 되는가 — `requestedAction`에 `shorten` 같은 값을 두는가. `ai_usage_records.call_key` 규칙(D-59)이 여기에 딸린다.
8. **`input_hash` 재사용 폐기** 확인 — 서류 생성의 "같은 입력이면 호출 안 함"이 없어진다(4장 `drafts.input_hash` 행).
9. **`feature`↔`job_type` 새 조합**(D-58) — `job_type='writing_chat_turn'`인데 `feature='career_description'`/`'cover_letter'`. **AI C-13.1 표를 이 조합으로 고쳐야 한다**(CL-A8은 저장 값만 보장했다).
10. **섹션 근거를 `evidence_links`에 넣는 것**(D-4·D-50) — 산출물 대화는 넣지 않았다(544행). 서류만 예외가 되는 것이 V-* 설계와 맞는지. 특히 **V-8(배운 점 근거 거부)**·숫자 가드가 제안 단계와 저장 단계 중 어디서 도는지.
11. **`job_competency` 문항의 `learnings` 근거 거부**(D-49)가 새 저장 RPC로 옮겨 가는 것.

### → product-planner

1. **Q-DM-1(정본 테이블 신설)** — CL-3을 "3개 테이블 폐기 + 제안은 `structured_draft`"로 읽고 얇은 정본 테이블 1개를 두는 것에 사용자 확인이 필요하다. **이 사이클에서 가장 큰 결정**이다.
2. **CL-A3 수정 제안**(문체는 정본 쪽, Q-DM-3)과 **CL-A5 수정 제안**(이관 대화를 만들지 않음, Q-DM-6).
3. **이관하지 못한 행 정책**(CL-A5) — "읽기 전용으로 남긴다"가 테이블 drop 뒤에는 불가능하다. 5장 6단계의 3단계 처리(운영자 덤프 + 안내 + drop)가 괜찮은가. 사용자 데이터 손실 안내 문구가 필요하다.
4. **파기·보유 정책**(4.4) — 서류 대화는 지원 프로젝트 삭제·대화 삭제·탈퇴까지(자동 삭제 없음). PIPA 쪽 추가 판단이 필요한가.
5. **서류당 대화 수 상한**(Q-DM-11, D-21) — 두지 않는 `[가정]`을 확정할지.
6. **PRD 7장 지표** — "초안 활용률"의 분모가 "생성된 초안"에서 바뀐다(PRD 쪽 P-17과 같은 건). `first_copied_at`을 유지하는 근거가 이 지표다.
7. **F-DOC-08·F-DOC-09의 기능 범위**(Q-DM-4·Q-DM-5) — 근거 선택 화면과 다시 생성 배너를 MVP에 남길지.
8. **메시지 상한 40**(Q-DM-7)이 자소서 10문항에 충분한지 — 사용자 경험 판단.
9. **`composing` 폐기(CL-A6)로 사라지는 사용자 가시 상태** — "작성 중" 배지가 없어진다. S-13·S-31·S-39 카드 표기를 PRD 쪽에서 확인.
