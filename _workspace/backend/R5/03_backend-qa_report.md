# R5 백엔드 QA 리포트 (라운드 1 → 라운드 2)

- 범위: R5 프로젝트 추가·산출물 상세(PA-1~PA-4, DM v4.5 / AI v4.6). 기준 `01_plan.md` QA 절, `02_db_notes.md`, `02_ai_notes.md`, `02_api_notes.md`, DM 2.5·2.5.0·2.5.1·3.3·3.7·4.1·7장·11.3, AI-12·AI-13.
- 작성: backend-qa, 2026-11-03. 코드 수정 없음(리포트·spec-gaps 1건만 씀).
- 결론: **Critical 0 / Major 0 / Minor 7**. 경계면에서 동작이 깨지는 불일치는 없다. Minor는 테스트 공백, 죽은 매핑, 연결 대기 껍데기의 정리 항목이다.

## 검사 실행 결과

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `run-checks.sh` |
| lint | 통과 | 경고 0 |
| vitest | 통과 | 117 파일 / 1,898개, 건너뜀 0 (로컬 스택 통합 테스트 포함) |
| pgTAP | 통과 | 53 파일 / 2,588개 (`supabase test db`). 로컬 DB 마이그레이션 최신 = `20261110000600` 확인 |
| `pnpm build` | 통과 | 로컬 스택 env(`NEXT_PUBLIC_SUPABASE_URL`·`ANON_KEY`·`SUPABASE_JWT_SECRET`·`CRON_SECRET`)로 실행 |
| 생성 타입 최신 여부 | 통과 | `supabase gen types typescript --local` 결과와 `src/server/db/database.types.ts` 차이 없음 |
| 마크다운 조립 TS ↔ DB | 통과 | `deliverableMarkdown` vs `private.wc_deliverable_markdown` 10가지 경계 입력(공백·탭·줄바꿈·`|`·CRLF·표 1행 등) 글자 단위 동일. 단 QA-R5-06 |
| 교차 사용자 수동 확인 | 통과 | 트랜잭션 안에서 실행 후 rollback: B가 A 산출물 고치기 → `not_found`, B가 A 대화를 `p_applied_proposals`로 기록 → `skipped not_found`, B(사용자·`app_ai_writer`)가 A 산출물 대화 패치 → `writing_chat_not_found`, B delete → 0행, `app_ai_writer`의 `project_deliverables` update·`save_project_deliverable` 실행 → permission denied |

## 경계면 검사

| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM v4.5 ↔ 마이그레이션 | 통과 | `project_deliverables unique (id, project_id, user_id)`, `writing_chats.project_deliverable_id` 복합 FK cascade, CHECK `project_deliverable_id is null or return_target is null`, 부분 인덱스, 트리거 `writing_chats_check_target`, 가드(대상 열 불변), `start_writing_chat` 3인자(옛 2인자 함수 없음 확인)·`start_deliverable_writing_chat`, `save_project_page`·`save_project_deliverable`(invoker, authenticated만), `private.wc_mark_proposal_applied` 인자 = DM 11.3, `apply_writing_chat_proposal` 삭제, 산출물 `updated_at`은 제목·본문(·project_id)만. 이름은 DM 3.7 그대로 |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과 | 타입 재생성 일치. `CHAT_COLUMNS`에 `project_deliverable_id`, `.rpc()` 이름 전부 존재 |
| Q3 | RPC 시그니처 ↔ 호출부 | 통과 | `page-save.ts`(만들기 null 인자 캐스트 1곳), `chat.ts` 시작 2종(uuid 반환 ↔ `typeof data === "string"`), 반환 jsonb 키 ↔ `SaveProject*RpcResult` zod 일치. `updated_at`은 문자열 그대로 전달(마이크로초 보존 → `stale_write` 오탐 없음) |
| Q4 | raise 코드 ↔ `errors.ts` | 통과(Minor 1) | R5 마이그레이션 raise 27종 전부 매핑. `classification_already_set` 삭제 확인. 라이브 DB에서 `field_too_long`·`invalid_period`·`not_found`를 raise하는 함수는 저장 RPC 2개뿐(400 변경 영향 없음). 죽은 매핑 1건 → QA-R5-03 |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 명세 | 통과(연결 대기) | 턴 요청 `requestedAction`·`style`·`formSnapshot`, 대상별 검사, `invalid_form_snapshot`이 사용자 메시지·작업 전에, 초안 상한 409가 작업 insert 전에. S-10·S-44 화면은 아직 없음 → QA-R5-05 |
| Q6 | SSE 이벤트 | 통과(spec-gap 1) | AI 노트 4장 ↔ `DeliverableTurnEventSchema` ↔ `turn.ts` 이름 일치(`facts_patch`·`draft_flags`·`draft_started`·`draft_block`·`draft_done`·`turn_done.draftCount`). 페이로드는 R5-API-1(camelCase)로 변환. 초안 턴의 `draft_flags`는 명세 순서에 없음 → spec-gaps R5-QA-1 |
| Q7 | AI 출력 ↔ 저장 | 통과(Minor 1) | `factsPatch`·`draftPatch` op 이름·모양 = SQL `c_ai_ops`, AI 상한(블록 120·사실 10/턴·300자·제목 깊이 3)이 DB 상한(200·80·500·6) 안. 슬롯 19개·종류 5개 TS = DB. `new_object` 키 일치. 출처는 `evidence_links`에 넣지 않음. `draft_count ≥ 6` → DB raise + 서버 선검사. 마크다운 조립 일치 → QA-R5-06 |
| Q8 | enum DB ↔ TS | 통과 | `PAGE_SAVE_SKIP_REASONS` = DM 2.5.1 6종, `DELIVERABLE_APPLIED_MODES`, `AI_PROGRESS_STAGES`에 `compose`·`validate`, `WRITING_KINDS`·`DELIVERABLE_SLOTS`·`FACT_ACTORS`·`DRAFT_BLOCK_TYPES` = SQL 상수, 종류 짐작 키워드 목록·순서 동일 |
| Q9 | AI 작업 종료·사용 기록 | 통과(Minor 1) | 질문 턴·초안 턴·초안 실패(작업 failed, 이전 초안 유지, `draft_count` 그대로)·빈 초안(`count_draft`, `draft_done` 없음)·상한 409(작업·호출 없음)·RPC 경합·RPC 거부 경로 모두 작업을 끝내고 `llms` 전체 `settle`. `call_key` `writing_chat.turn.{n}.compose`, 진행 단계 `extract → compose → validate`. 일부 경로 테스트 없음 → QA-R5-02 |
| Q10 | 보안·개인정보 | 통과(Minor 1) | `ai_jobs.params`에 스냅숏 없음(`{retry, requested_slot, target, requested_action, style}`), 로그는 `formSnapshot: true/false`·코드·통계만, `src/server/ai`의 AI-13 로그는 `ai_validation` 통계만, `console.` 직접 호출은 기존 로거 4곳뿐. private 스키마는 API 미노출(`config.toml schemas = public, graphql_public`), definer 헬퍼 2개 모두 `auth.uid()` 소유 검사·`search_path = ''`. `.env.local` 미추적. 교차 사용자 pgTAP 일부 공백 → QA-R5-01 |
| Q11 | UI ↔ 백엔드 | 통과(Minor 2) | `git diff`/`git status`: `src/app`(api 제외)·`src/components`·`src/lib/mock`·`docs/ui`·`src/types` 변경 없음. 변경은 `src/app/api/writing-chats/[id]/turns/route.ts`(백엔드 소유), `src/lib/data/writing-chats-v44.ts`·신규 `page-save-v45.ts`(연결 대기, UI import 없음). build 통과. 껍데기 정리 항목 → QA-R5-04, QA-R5-05 |

V-10a~h: `src/server/ai/validation/v10.test.ts`(40)에서 규칙마다 잘못된 출력을 잡는 테스트 확인. V-9(스냅숏 기준) `v9.snapshot.test.ts`(16).

## 이슈

### QA-R5-01 [Minor] 산출물 대화·산출물 저장의 교차 사용자 pgTAP 공백
- 담당: db-engineer
- 근거: `supabase/tests/r5_page_save.test.sql:158-162`는 B의 `save_project_page`만 본다. `supabase/tests/r5_deliverable_writing_chats.test.sql:150-158`은 B의 select·시작만 본다. 다음 경우는 테스트가 없다: ① B가 A의 산출물 id로 `save_project_deliverable` 고치기 ② B가 자기 산출물 저장에 A의 `writing_chat_id`를 `p_applied_proposals`로 보냄(A 대화에 `applied_at`이 찍히면 안 됨) ③ B 세션·`app_ai_writer`(sub=B)가 A 산출물 대화에 `apply_structured_draft_patch`. 동작은 수동 확인으로 맞다(검사 실행 결과 표 마지막 행).
- 수정 제안: 위 3건(+ A 대화의 `structured_draft`가 그대로인지)을 `r5_page_save.test.sql`·`r5_structured_draft_patch.test.sql`에 추가.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-R5-02 [Minor] AI-13 초안 턴 러너의 일부 종료 경로 테스트 없음
- 담당: api-engineer
- 근거: `src/server/services/writing-chat/turn.ts:722-760`(compose 즉시 재시도: 블록 전 재시도 / 블록 뒤 재시도 안 함, R5-API-7), `turn.ts:851-857`(RPC가 `replace_draft`를 거부 → `schema_invalid`, R5-API-6), `turn.ts:858-863`(RPC 경합 `writing_chat_draft_limit_reached` → 고정 문구, R5-API-5). `deliverable-turn.test.ts`의 9개 테스트(106~207행)에 이 경로가 없고, 재생성(호출 2회) 때 `ai_usage_records` 2행·초안 중 취소(`canceled`)·시간 초과도 없다.
- 수정 제안: 가짜 파이프라인으로 각 경로 1개씩: 이벤트 순서, 작업 최종 상태·`error_code`, 이전 초안 유지, 사용 기록 수.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-R5-03 [Minor] 죽은 오류 매핑 `field_already_filled`
- 담당: api-engineer
- 근거: `src/server/db/errors.ts:141`. 라이브 DB의 `public`·`private` 함수 중 이 메시지를 쓰는 함수 없음(`pg_proc.prosrc` 검색 0건). R5에서 V-9h 기간 거부가 사라짐(DM 2.5 v4.5).
- 수정 제안: 매핑 삭제(같이 지운 `classification_already_set`과 같은 처리).
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-R5-04 [Minor] 옛 커리어 껍데기가 산출물 대화를 STAR 대화처럼 섞어 보여 줌
- 담당: api-engineer
- 근거: `src/server/services/career/rows.ts:31`(모든 `writing_chats`) → `src/lib/data/career.ts:189`(`toLegacyWritingChat`, 모두 `augment_project`), `:342`(프로젝트별 `writing_chats` — 독립 프로젝트에 산출물 대화가 붙음), `:482`(`active_writing_chats` — 대시보드 이어하기에 산출물 대화가 들어가 옛 S-36 화면으로 열림). 지금은 UI에서 산출물 대화를 만들 경로가 없어(S-44 연결 대기) 실제 영향은 없다.
- 수정 제안: 껍데기에서 `project_deliverable_id is null`만 쓰거나, S-44 연결 단계 체크리스트에 넣기.
- 상태: 미해결 — S-44 연결 단계로 넘김(리더 결정, 라운드 2)

### QA-R5-05 [Minor] `deliverableTurnRequest`의 다시 보내기가 턴 옵션을 버림
- 담당: api-engineer
- 근거: `src/lib/data/page-save-v45.ts:120-124` — `body === null`이면 `{ endpoint: …?retry=1, body: {} }`. 라우트·계약은 다시 보내기에도 같은 옵션을 받는다(`WritingChatRetryInput`, `src/lib/contracts/writing-chat.ts:270-271`, api 노트 "`?retry=1`은 content 없이 같은 옵션"). 이 함수로는 칩 초안 턴(`requestedAction: compose_draft`)을 다시 보낼 때 옵션과 `formSnapshot`을 실을 수 없어, 질문 턴이 되거나 DB 값으로 돌 수 있다.
- 수정 제안: retry일 때도 `{requestedSlot, requestedAction, style, formSnapshot}`을 받아 `WritingChatRetryInput`으로 검사해 싣기. 연결 대기 파일이라 S-44 연결 전에만 고치면 된다.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-R5-06 [Minor] DB가 받는 블록 모양이 TS 저장 스키마·마크다운 함수보다 넓음
- 담당: db-engineer (계약 정리), ai-pipeline-engineer (TS 쪽 대안)
- 근거: DB 조립기 `supabase/migrations/20261110000200_r5_structured_draft_patch_v4.sql:76-94`(`wc_md_text`·`wc_md_cells`)는 목록 항목 문자열·표 행 배열도 받는다(DB 노트 "문자열 또는 {text, 출처…}"). TS `StoredBlockSchema`(`src/server/ai/schemas/deliverable-draft.ts:57,67-69`)는 객체만 받고, `blockMarkdown`(`src/server/ai/schemas/deliverable-markdown.ts:43-50`)은 문자열 항목에서 `TypeError`(수동 실행으로 확인). 그런 블록이 저장되면 `parseDeliverableDraft`가 실패해 대화 열기가 500이 된다. 지금 블록을 쓰는 경로는 파이프라인(`draftPatch`, 늘 객체)뿐이라 실제 경로는 없다.
- 수정 제안: DB `replace_draft` 검증에서 항목·행을 객체로 강제(또는 객체로 정규화해 저장). 아니면 TS 스키마·마크다운이 두 모양을 모두 받기.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-R5-07 [Minor] 스냅숏 길이 검사의 글자 단위 차이 (zod UTF-16 ↔ DB 코드포인트)
- 담당: api-engineer
- 근거: `src/lib/contracts/writing-chat.ts:100,110,134-135` — zod `.max(n)`은 UTF-16 코드 단위를 센다. DB 시작 RPC(`20261110000100…:261-274,337-339`)·저장 RPC·AI `replace_allowed`(코드포인트)는 `char_length`(코드포인트)로 센다. 이모지가 많은 본문은 DB 상한 안이어도 턴이 `invalid_form_snapshot`으로 거부될 수 있다.
- 수정 제안: `.refine((s) => [...s].length <= n)`처럼 코드포인트로 세기(제목 100·본문 20,000·STAR 2,000·이름 100).
- 상태: 수정됨(확인 완료, 라운드 2)

## 담당자별 요약

| 담당 | 이슈 |
|------|------|
| db-engineer | QA-R5-01, QA-R5-06(계약) |
| api-engineer | QA-R5-02, QA-R5-03, QA-R5-04, QA-R5-05, QA-R5-07 |
| ai-pipeline-engineer | QA-R5-06(TS 대안을 고를 경우) |

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- **R5-QA-1** AI-13 초안 턴 SSE 순서에 `draft_flags`가 없음 ↔ 구현은 `facts_patch` 뒤에 보냄(질문 턴과 같은 모양). 구현 유지, planning 확인 요청.
- 기존 기록 재확인(새로 넘기지 않음): R5-DB-1 시작 RPC 반환 `uuid` ↔ DM 2.5 "`{writing_chat_id, greeting_message}`".

## 라운드 2 (2026-11-03)

### 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| `supabase db reset` | 통과 | 최신 마이그레이션 `20261110000700` 적용 확인 |
| typecheck / lint | 통과 | 경고 0 |
| vitest | 통과 | 117 파일 / 1,905개 (라운드 1보다 7개 늘어남), 건너뜀 0 |
| pgTAP | 통과 | 53 파일 / 2,602개 (14개 늘어남) |
| `pnpm build` | 통과 | 로컬 스택 env |
| 생성 타입 | 통과 | 재생성 결과와 `database.types.ts` 같음(시그니처 변경 없음) |
| UI 소유 파일 | 통과 | `src/app`(api 제외)·`src/components`·`src/lib/mock`·`docs/ui`·`src/types` 변경 없음 |

### 이슈별 재확인
| 이슈 | 결과 | 확인한 것 |
|------|------|-----------|
| QA-R5-01 | 닫힘 | `r5_page_save.test.sql:427~`: B의 A 산출물 고치기·A 프로젝트 아래 만들기 → `not_found`, B 저장에 A 산출물·STAR 대화 → `skipped not_found`, A 데이터 그대로. `r5_structured_draft_patch.test.sql:304-317`: B 세션·`app_ai_writer`(sub = B) 패치 → `writing_chat_not_found`. pgTAP 통과 |
| QA-R5-02 | 닫힘 | `deliverable-turn.test.ts:243-336`에 7개: 블록 전 즉시 재시도, 블록 뒤 재시도 없음, 재생성 사용 기록 2행, RPC `replace_draft` 거부 → `schema_invalid`, 상한 경합 → 고정 문구, 클라이언트 끊김 → `canceled` + 열린 호출 기록, 시간 초과 2회 → 기록 2행. vitest 통과 |
| QA-R5-03 | 닫힘 | `errors.ts`에 `field_already_filled` 없음 |
| QA-R5-04 | 미해결(넘김) | 리더 결정으로 S-44 연결 단계 체크리스트(`02_api_notes.md` QA 수정 표)로 넘김. 지금은 산출물 대화를 만드는 UI 경로가 없어 영향 없음 |
| QA-R5-05 | 닫힘 | `page-save-v45.ts` `deliverableTurnRequest`: `{retry: true, …옵션}`을 `WritingChatRetryInput`으로 검사해 `?retry=1` 본문에 실음 |
| QA-R5-06 | 닫힘 | 새 마이그레이션 `20261110000700_r5_qa1_block_shape.sql`. `…000200`의 `wc_block_sources`·`wc_deliverable_block`과 비교하면 바뀐 부분은 세 가지뿐이다: 목록 항목 객체 강제, 표 행 `{cells: string[]}` 강제(어기면 `invalid_patch` raise), `source_project_fields`를 `PRJ.*` 5개로 제한(= TS `PROJECT_SOURCE_FIELDS`, 밖이면 `invalid_source`). 파이프라인 `draftPatch`는 늘 객체를 보내므로 정상 경로에는 영향이 없다. 혹시 raise가 나면 `turn.ts`가 `draft_store_failed`로 기록하고 `stalled`로 끝내며 이전 초안은 그대로다 |
| QA-R5-07 | 닫힘 | `src/lib/contracts/writing-chat.ts:100-141` `codePointLength`(= DB `char_length`)로 이름·제목 100, STAR 2,000, 본문 20,000. 이모지 100/101개 테스트(`writing-chat.test.ts:165`) |

### 라운드 2 결과
- 열린 이슈: Critical 0 / Major 0 / Minor 0. QA-R5-04 한 건만 미해결로 S-44 연결 단계에 넘겼다.
- 스펙 차이: R5-QA-1(초안 턴 `draft_flags` 순서)은 planning 확인 대기, 그대로.
