# S4 AI 작성 대화 (AI-12) 계획

## 범위와 근거
- 기획 근거
  - DM: §2.5(`writing_chats`, `writing_chat_messages`, `structured_draft` 형식), §3.3(저장 경로), §3.4(보관), §4.1·§4.2(삭제와 `writing_chat` 대상), §5, §7 대화 관련 행
  - AI: AI-12 카드 전체(슬롯 순서, 입력 컨텍스트, V-9a~h, 출력 스키마, 패치 → `structured_draft` 매핑, 이벤트, 모델 등급), C-10~C-13
  - UX: S-36(실패한 턴 "다시 보내기"는 메시지 수를 늘리지 않음 `[가정]`, `requested_slot`, 공급자 배지), S-08 "작성 중인 AI 대화"
  - PRD: F-P1-13, F-P1-06, NFR-PRV-05·06
- 앞 슬라이스 위에 쌓는다
  - S3a: 실행기, `createLlm`, 사용 기록, 재시도 규칙(스트리밍은 첫 토큰 전 오류만 재시도)
  - S3b: 실행 게이트, 키 공급, 동의
  - 열린 QA-S3a-08: 병렬 단계 재시도 규칙. 이 슬라이스의 정리·응답 병렬 호출에 처음 적용한다.
- **S5 이전이라 하지 않는 것**: 게이트 진입 대화의 지원 프로젝트 요건 목록(`jd_requirements`, R-31). `return_target`은 저장·반환만 하고, 요건 목록은 S5에서 추가한다(노트에 "S5 확장 지점"으로 기록).
- 90일 자동 정리 크론은 S9에서 한다.
- 연결: UI 없음 → A2 career(S-36, S-08) "연결 대기".

## 계약 — DB (새 마이그레이션 `20261030xxxxxx_s4_*`)

1. **`writing_chats`** (2.5)
   - 컬럼·CHECK는 표 그대로다(`usage_event_id` 없음, `message_count` 0..40). `unique (id, user_id)`.
   - FK: `project_id`는 복합 FK cascade, `experience_id`·`education_id`는 복합 FK `on delete set null (col)`.
   - RLS
     - select·delete 본인, insert 사용자 세션(시작 액션).
     - 사용자 직접 update는 `status`, `return_target` 컬럼 grant만.
     - app_ai_writer는 `message_count`, `last_activity_at` update와 필요한 컬럼 select만.
     - **`structured_draft` 직접 update grant는 아무에게도 주지 않는다.**
   - 인덱스: `(user_id) where status = 'active'`, `(user_id, project_id)`.
   - **정리 대기 발화 추적**: AI-12의 "직전 미처리 발화 ID 목록을 서버가 관리"를 위해 `last_extracted_sequence smallint not null default 0`을 둔다(app_ai_writer update) `[가정 → spec-gaps]`.

2. **`writing_chat_messages`** (2.5)
   - `sequence` unique, `content` ≤ 4000, `status` CHECK, `ai_job_id` soft.
   - assistant 행에 결과 메타 `provider`, `model`, `model_tier`, `connection_tier`(null 허용, 시작 인사는 null). DM 공통 메타 v4.
   - RLS: select 본인. user insert는 RPC로만. assistant insert·update는 app_ai_writer(`status`, `content`, 메타 컬럼).

3. **S2 FK 마무리 (QA-S2-07)**: `projects`·`project_details`·`achievements`의 `source_writing_chat_id`에 복합 FK `(source_writing_chat_id, user_id) → writing_chats(id, user_id) on delete set null (source_writing_chat_id)`. 대화를 삭제해도 커리어 행은 남는다(3.4).

4. **RPC** (모두 오류 코드는 소문자 `message`)
   - `start_writing_chat(p_mode, p_project_id, p_return_target jsonb) returns uuid`
     - 사용자 세션. 이 RPC는 테이블 insert와 고정 시작 인사 assistant 메시지 insert를 한 트랜잭션에서 한다.
     - 시작 인사는 sequence 1, `message_count = 1`(AI 메시지 합계에 포함, AI 미호출) `[가정: 시작 인사도 40개에 포함]`.
     - `augment_project`는 프로젝트 소유를 검사한다.
     - 인사 문구는 인자로 받지 않고 SQL 상수로 둔다. 민감정보 주의 안내를 포함한다(NFR-PRV-05).
   - `append_writing_chat_message(p_writing_chat_id, p_content) returns table(message_id uuid, sequence smallint)`
     - security invoker. 행을 잠근 뒤 `status = 'active'`, 상한 검사(40)를 하고, user 메시지를 insert하면서 `message_count`·`last_activity_at`을 갱신한다.
     - 상한이면 `message_limit_reached`.
   - `begin_assistant_message(p_writing_chat_id, p_ai_job_id, p_provider, p_model, p_model_tier, p_connection_tier) returns uuid`
     - app_ai_writer. `status = 'streaming'` 행을 만들고 count를 증가시킨다. 상한이면 `message_limit_reached`.
     - **다시 보내기**: 직전 assistant가 `failed`면 그 행을 재사용해 `streaming`으로 되돌리고 count를 늘리지 않는다(UX S-36 `[가정]`).
   - `finish_assistant_message(p_message_id, p_status done|failed, p_content)`: app_ai_writer.
   - `apply_structured_draft_patch(p_writing_chat_id, p_patch jsonb) returns jsonb`(새 `structured_draft`)
     - 호출 역할로 행위자를 판정한다(app_ai_writer = AI, authenticated = 사용자).
     - AI 패치: `user_edit`·`accepted` 필드 보호, V-9a(출처 = 이 대화의 user 메시지), V-9h(augment 대상 행의 이미 채워진 컬럼은 거부).
     - 사용자 패치: 값 수정(→ `user_edit`, `ok`), `needs_review → accepted`, 거절(값 null + `ok` + `reviewed_at`).
     - `status = 'active'`만 허용한다. 행 잠금.
     - 패치 jsonb의 정확한 모양은 db·ai·api 셋이 노트에서 합의한다. 초안은 "필드 경로 + 필드 객체" 목록이다.
   - `set_writing_chat_affiliation(p_writing_chat_id, p_experience_id, p_education_id, p_clear_suggestion boolean)`: 사용자 세션.
   - `save_writing_chat(p_writing_chat_id) returns jsonb`(`{project_id, created/updated 개수}`)
     - security invoker. 쓰는 값 규칙(`review in ok/accepted` + 값 있음), augment는 빈 필드만, 새 상세 내용은 insert.
     - 소속은 컬럼에서 가져온다. 스킬은 `normalized_name`으로 연결한다. `source_writing_chat_id`를 채운다. 완료 판정은 S2 트리거에 맡긴다.
     - `status = 'saved'`, `project_id`, `saved_at`.
   - `hand_off_writing_chat(p_writing_chat_id) returns jsonb`: 같은 규칙에 `status = 'handed_off'`.
   - `mark_writing_chat_extracted(p_writing_chat_id, p_sequence)`: app_ai_writer. `last_extracted_sequence`를 올리기만 한다.
5. **`get_deletion_impact` / `delete_career_item` 확장**: `entity_type = 'writing_chat'`(→ `{message_count, linked_saved_rows}`, 결과 영향 없음). 프로젝트 삭제 영향의 `cascade.writing_chats` 개수를 실제로 센다.
6. **pgTAP**
   - 격리와 권한: `structured_draft` 직접 update 불가(전 역할), app_ai_writer는 커리어 쓰기 0.
   - RPC 분기 전부: 상한 40, 다시 보내기는 count 불변, V-9a·V-9h 거부, 보호 필드, 수락·거절, 저장·전환 규칙(needs_review 건너뜀, augment 빈 필드만, 소속, 스킬 연결).
   - 삭제: 대화만 삭제하면 커리어 행 유지와 `source_writing_chat_id` null, 프로젝트 삭제 시 대화 cascade.
   - grants 허용 목록, 첫 호출 권한.

## 계약 — AI (`src/server/ai/`)
1. `prompts/AI-12/`: extract와 reply의 system 블록. 공통 블록에 기능 블록을 더하고 `prompt_version`을 붙인다(`AI-12.extract.v1`, `AI-12.reply.v1`). 경계 사례 3개.
2. `schemas/AI-12.ts`: 정리 패치 출력 zod와 정본 JSON 스키마(schema_version 2). C-10.2 규칙을 지킨다(선택 값은 null, 깊이 5 이하).
3. `context-pack/writing-chat.ts`: 대화 기록(`done`만, 별칭 `M-n`), 현재 `structured_draft` 요약, `focus_slots` 계산(순수 함수: 슬롯 순서, `requested_slot` 우선, 게이트 진입 시 readiness `missing` 우선, D-01 충족 예상 시 `ready_to_return`), 소속 후보(`EXP-n`/`EDU-n`), augment 대상(`PRJ-n`/`DET-n`과 빈 필드 표시), 프로필 직무.
4. `validation/v9.ts`: V-9a~V-9g 순수 함수(V-9h는 RPC가 최종 방어, 앱에서도 미리 검사). V-9e 임계 40%는 상수, 스킬 사전은 작은 상수 목록에서 시작한다. 결과는 반영할 패치, `needs_review` 필드, clarifications, sensitive 개수, 거부 통계(원문 없이).
5. `pipelines/AI-12.ts`
   - `extract(input, deps)`: 경량 등급, 구조화 출력 → V-9 → 저장 형식 패치(별칭 → UUID).
   - `reply(input, deps)`: 기본 등급, 텍스트 스트림. 사실 제안 금지 프롬프트.
   - 두 호출의 순서·병렬 결정은 runner가 한다(무료 등급은 reply 다음 extract).
6. 테스트: 픽스처 대화(협조적, 몰아서 말함, "우리 팀", 수치 모름, 민감정보, "알아서 채워 줘")로 V-9 결과를 검증한다. 공급자는 가짜만 쓴다.

## 계약 — API
1. **Server Actions** (`src/server/actions/writing-chat.ts`)
   - `startWritingChat`: 키가 없어도 시작은 허용한다. 열람·저장은 키 없이 가능하고, 메시지 전송에서 잠금이 걸린다(PRD 3.3, UX S-36).
   - `getWritingChat`(메시지, 정리 결과, 확정 소속, 진행 단계, 공급자 배지)
   - `applyDraftEdit` / `acceptField` / `rejectField`(→ RPC)
   - `setAffiliation`, `saveWritingChat`, `handOffWritingChat`, `abandonWritingChat`, `deleteWritingChat`
   - `getCareerTree`에 active 대화를 추가한다(S-08 "작성 중인 AI 대화": 대상, 마지막 활동, `n/40`, 묶이지 않은 대화의 남은 일수 = 90일 − 경과 `[가정]`).
2. **턴 Route Handler** `POST /api/writing-chats/[id]/turns` (SSE)
   - 처리 순서
     1. 인증
     2. 연결·동의 게이트(S3b, 막히면 SSE `error`에 F-AI-08 원인)
     3. 사용자 메시지 append(RPC)
     4. `ai_jobs`(`writing_chat_turn`, 대상 `writing_chat`/id) 생성
     5. reply 스트림 → `reply_delta`… → `reply_done`
     6. extract → V-9 → `apply_structured_draft_patch`(app_ai_writer) → `draft_patch`, `draft_flags`
     7. `mark_writing_chat_extracted` → `turn_done`
   - 유료 등급은 reply와 extract를 병렬로, 무료 등급은 reply 다음 extract(C-12).
   - 사용 기록: 호출마다(`feature = writing_chat`).
   - extract 실패는 reply를 막지 않는다. 다음 턴에 미처리 발화를 함께 정리한다.
   - reply 실패: 첫 토큰 전이면 C-11.3 재시도. 함수 안에서 기다려야 하는 대기는 SSE에서 할 수 없으므로 **스트리밍 턴은 즉시 재시도만 하고**, 대기가 필요한 원인은 실패로 끝낸다. assistant 메시지 `failed`, SSE `error`(retryAfter 등). 사용자는 "다시 보내기".
   - QA-S3a-08: 병렬 두 호출은 각각 자기 사용 기록과 재시도를 가진다. 한쪽 성공을 다시 부르지 않는다.
   - 다시 보내기: `POST /api/writing-chats/[id]/turns?retry=1`(같은 사용자 메시지, 실패한 assistant 행 재사용).
   - 클라이언트가 끊으면 공급자 스트림을 중단하고 assistant 메시지를 `failed`로 둔다(사용 기록은 settle).
   - 메시지 상한에 닿은 마지막 AI 메시지 안내.
3. **계약** `src/lib/contracts/writing-chat.ts`: SSE 이벤트 5종 + `error`(zod discriminated union), `structured_draft` 타입, 액션 입출력. `useAiStream`과 맞춘다.
4. **삭제 연결**: `deleteCareerItem`의 `writing_chat` 대상, 커리어 트리의 cascade 개수.
5. 테스트
   - 턴 전체 흐름(가짜 공급자): 유료 병렬, 무료 순차, extract 실패, reply 실패 후 다시 보내기, 상한 40, 키 없음, 동의 철회, 끊김.
   - 저장·전환 통합 테스트(로컬 스택).

## 인터페이스 합의
- 패치 jsonb 모양(ai 출력 → api → RPC 인자)은 셋이 노트로 합의한다. **db 노트가 기준**이고, 충돌하면 리더가 정한다.
- SSE 이벤트 모양은 api가 기준이다(contracts).

## 진행
- db·ai·api 병렬. 에이전트 정의가 main 체크아웃의 옛 버전이므로 이 워크트리의 하네스 파일을 읽으라고 지시한다.
- QA 중점: V-9와 RPC의 이중 방어, `structured_draft` 쓰기 경로, 커리어 쓰기는 사용자 세션 RPC로만(NFR-AI-05), 메시지 수, SSE 이벤트 ↔ 계약, 사용 기록.

## 원격 브랜치 적용: 하지 않음
