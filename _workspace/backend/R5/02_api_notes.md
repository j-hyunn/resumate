# R5 API 구현 노트 (프로젝트 추가·산출물 상세 PA-1~PA-4, DM v4.5)

- 작성: api-engineer, 2026-11-03
- 기준: DM v4.5 2.5·2.5.0·2.5.1·3.3·3.7·4.1·7장·11.3, AI 명세 v4.6 AI-12·AI-13, `02_db_notes.md`, `02_ai_notes.md`(파이프라인 진입점·SSE 이벤트·"api-engineer에게" 표 그대로 반영)
- 커밋 안 함. 원격 Supabase 건드리지 않음. `src/server/ai/**`·UI 파일(src/app 페이지, src/components, src/lib/mock, docs/ui) 수정 없음.

## 결과 요약

| 검사 | 결과 |
|------|------|
| `pnpm typecheck` | 통과(0건) |
| `pnpm lint` | 통과(0건, 경고 0) |
| `pnpm vitest run` | **117 파일, 1,898개 전부 통과**(로컬 스택 통합 테스트 포함, 건너뜀 0) |
| `pnpm build` | 로컬 스택 env(`NEXT_PUBLIC_SUPABASE_URL`·`ANON_KEY`·`SUPABASE_JWT_SECRET`·`CRON_SECRET`)를 주면 통과. env 없이는 R4-API-9와 같은 이유로 실패(코드 무관) |
| pgTAP | 실행 안 함(db 몫, db 노트 기준 53파일 2,588개 통과) |

## 바꾼 파일

| 구분 | 파일 | 내용 |
|------|------|------|
| 계약 | `src/lib/contracts/enums.ts` | `PAGE_SAVE_SKIP_REASONS`(6개, RPC 판정 순서), `DELIVERABLE_APPLIED_MODES`, `AI_PROGRESS_STAGES`에 `compose`. `APPLY_PROPOSAL_SKIP_REASONS` 삭제. `APPLY_PROPOSAL_FIELDS`는 이름 유지·뜻 변경(= `p_applied_proposals[].field`) |
| 계약 | `src/lib/contracts/career.ts` | `ProjectPageValues`, `SaveProjectPageInput`, `SaveProjectDeliverableInput`, `AppliedProjectProposal`/`AppliedDeliverableProposal`, `SaveProjectPageRpcResult`/`SaveProjectDeliverableRpcResult`, 결과 DTO 2개, `DeliverableDetailDto.writingChats` |
| 계약 | `src/lib/contracts/writing-chat.ts` | 반영 계약(`ApplyProposalInput`·`ApplyProposalRpcResult`·`ApplyProposalResult`) 삭제. `ProjectFormSnapshotSchema`·`DeliverableFormSnapshotSchema`, `StartWritingChatInput.formSnapshot`, `StartDeliverableWritingChatInput`, `DeliverableWritingChatsInput`, `DeliverableDraftEditInput`, 턴 요청 `requestedAction`·`style`·`formSnapshot`, `RequestedSlot` = AI-12 ∪ AI-13 슬롯, `WritingChatDto.target`·chips 삭제, `DeliverableWritingChatDto`, `AnyWritingChatDto`, `DeliverableDraft*` 재수출, 산출물 SSE 이벤트(`DeliverableTurnEventSchema`), STAR `turn_done`에서 chips 삭제 |
| 오류 | `src/server/db/errors.ts` | 신설: `not_found`(404), `stale_write`(409), `project_name_required`, `project_affiliation_required`, `project_not_affiliated`, `deliverable_title_required`, `invalid_classification`, `invalid_form_snapshot`(이상 400), `project_deliverable_not_found` → `not_found`(404), `writing_chat_draft_limit_reached`(409). `invalid_period`·`invalid_fields` 별칭 해제(자기 코드 400). `field_too_long` 409 → 400. `classification_already_set` 삭제. detail 변환 `raiseDetails`: `stale_write` → `{current_updated_at}`, 필드 오류 → `{field, fields}` |
| 서비스 | `src/server/services/career/page-save.ts` **신규** | `saveProjectPage`, `saveProjectDeliverable`(RPC 호출, 만들기 null 인자 캐스트 한 곳, 반환 zod 파싱 → camelCase) |
| 서비스 | `services/career/index.ts`·`read.ts` | 내보내기, `getDeliverable`에 산출물 대화 목록 |
| 서비스 | `services/writing-chat/chat.ts` | `applyWritingChatProposal` 삭제, `startWritingChat`에 `p_form_snapshot`, `startDeliverableWritingChat`, `getWritingChat` → 대상별 DTO, `toDeliverableWritingChatDto`, `listDeliverableWritingChats`, `listProjectWritingChats`는 STAR 대화만, `editDeliverableDraft`(사실 수락·거절, 블록 수락·빼기), `loadProjectSlotState` 삭제 |
| 서비스 | `writing-chat/types.ts`·`mappers.ts`·`db.ts` | `ChatSnapshot.projectDeliverableId`·`deliverableDraft`, `TurnSnapshot.requestedAction`·`style`·`formSnapshot`, `DeliverablePipelines` 인터페이스, `TurnChatDb.applyDeliverablePatch`, `TurnTiming.composeTimeoutMs` |
| 서비스 | `writing-chat/pipelines.ts` | AI-12 입력에 `formSnapshot`, STAR 슬롯만 전달. **`createDeliverablePipelines`**(AI-13: 산출물 행·부모 독립 프로젝트(link_url 제외)·스킬·형제 제목 ≤20·희망 직무 읽기, 턴당 컨텍스트 1회 + 정리 패치 뒤 1회 재구성) |
| 서비스 | `writing-chat/turn.ts` | 대상별 옵션 검사(`checkTurnOptions`), 초안 상한 409를 사용자 메시지 저장 전에, `ai_jobs.params`에 스냅숏 없음, AI-13 질문 턴·초안 턴 러너, compose 스트림·재시도·진행 단계, 공용 `runReply`/`retryingCall`/`finishReply`/`failReply` 정리 |
| 연결 | `src/server/jobs/writing-chat-turn.ts` | `deliverablePipelines` 주입 |
| 라우트 | `src/app/api/writing-chats/[id]/turns/route.ts` | `requestedAction`·`style`·`formSnapshot` 전달(검사는 서비스) |
| 액션 | `src/server/actions/career.ts` | `saveProjectPage`, `saveProjectDeliverable` |
| 액션 | `src/server/actions/writing-chat.ts` | `applyWritingChatProposal` 삭제, `startDeliverableWritingChat`, `listDeliverableWritingChats`, `editDeliverableDraft`, 스냅숏 오류 → `invalid_form_snapshot` |
| 배선 | `src/lib/data/writing-chats-v44.ts` | `applyProposal` 삭제(UI import 없음 확인), `getProjectChat`/`startProjectChat`은 STAR 대화만 |
| 배선 | `src/lib/data/page-save-v45.ts` **신규(연결 대기)** | 아래 |
| 테스트 | `writing-chat.test.ts`, `turn.test.ts`, `writing-chat.integration.test.ts`, `lib/data/career.integration.test.ts`, **`deliverable-turn.test.ts`(9)**, **`deliverable-chat.integration.test.ts`(5)**, `src/test/writing-chat-fakes.ts`(`applyDeliverablePatch`, `fakeDeliverablePipelines`) | 아래 |

## 액션·계약

### 페이지 저장 (DM 2.5.1)

| 액션 | 입력 | 결과 | 오류 |
|------|------|------|------|
| `saveProjectPage` (S-10) | `{ projectId: uuid\|null, values: {name?, experienceId?, educationId?, startMonth?, endMonth?, isCurrent?, projectType?, experienceType?, competencies?, situation?, task?, action?, result?, learnings?}, expectedUpdatedAt?, appliedProposals?: [{writingChatId, field, rev}] ≤50 }` — 키 없음 = 유지, null = 비움 | `{ projectId, status, updatedAt, applied: [{writingChatId, field}], skipped: [{writingChatId\|null, field\|null, reason}] }` | `stale_write` {current_updated_at}, `project_name_required`, `project_affiliation_required`, `project_not_affiliated`, `field_too_long`·`invalid_period`·`invalid_classification`·`invalid_fields` {field}, `project_scope_change_not_allowed`, `not_found` |
| `saveProjectDeliverable` (S-44) | `{ projectDeliverableId: uuid\|null, projectId: uuid\|null, title, body\|null, expectedUpdatedAt?, appliedProposals?: [{writingChatId, rev, mode: replace\|append}] }` | `{ projectDeliverableId, projectId, sortOrder, updatedAt, applied: [{writingChatId}], skipped: [{writingChatId\|null, reason}] }` | `stale_write`, `deliverable_title_required`, `field_too_long` {field}, `deliverable_limit_reached`, `deliverable_requires_standalone_project`, `not_found` |

- zod는 모양만, 규칙은 RPC(R5-API-2). `skipped.reason` ∈ `not_found`·`already_applied`·`proposal_changed`·`needs_review`·`invalid_entry`·`mark_failed`. 키·동의·공급자 확인 없음(AI 호출 없음).
- 화면은 `updatedAt`을 다음 저장의 `expectedUpdatedAt`으로 쓰고, "내 내용으로 저장"은 `expectedUpdatedAt` 없이 다시 보낸다.

### 대화

| 액션 / 라우트 | 내용 |
|---------------|------|
| `startWritingChat` | `{projectId, returnTarget?, formSnapshot?}` → `start_writing_chat(…, p_form_snapshot)`. `{writingChatId}` |
| `startDeliverableWritingChat` | `{projectDeliverableId, formSnapshot?: {title?, body?}}` → `{writingChatId}`. 없는 산출물 → `not_found` |
| `getWritingChat` | 대상별 DTO: `target: "project"` (`WritingChatDto`, chips 없음) / `"project_deliverable"` (`DeliverableWritingChatDto`: `structuredDraft`(DM 2.5.0), `draftCount`, `draftLimit = 6`, `needsReviewCount` = 검토 필요 사실 수) |
| `listDeliverableWritingChats` | 산출물의 대화 목록(최근 활동순) |
| `editDeliverableDraft` | `{writingChatId, op: accept_fact\|reject_fact, factId}` / `{…, op: accept_block\|remove_block, blockId}` → `apply_structured_draft_patch`(사용자). 반영된 초안 → `field_already_applied` |
| `POST /api/writing-chats/{id}/turns` | 본문 `{content, requestedSlot?, requestedAction?, style?, formSnapshot?}` (`?retry=1`은 content 없이 같은 옵션). 서비스가 대화 대상을 읽은 뒤 검사: STAR = AI-12 슬롯만·`requestedAction`/`style` 금지(`invalid_input`), 산출물 = AI-13 슬롯. 스냅숏 모양·길이(이름·제목 100, STAR 2,000, 본문 20,000, 월 형식, 분류 키·역량 ≤3 중복 없음) 위반 → **`invalid_form_snapshot`(400)**, 아무것도 저장 안 함. `requestedAction = compose_draft` + `draft_count ≥ 6` → **409 `writing_chat_draft_limit_reached`, 사용자 메시지 저장 전**(작업·호출 없음) |

- `form_snapshot`: zod로 알려진 키만 남김 → 메모리의 `TurnSnapshot.formSnapshot`으로만 파이프라인에 전달. `ai_jobs.params`(`{retry, requested_slot, target?, requested_action?, style?}`)·DB·로그(`formSnapshot: true/false`만)에 없음. 통합 테스트로 `ai_jobs`·`writing_chats` 행에 본문 문자열 없음, 로그에 없음 확인.
- 대상별 분기: `chat.projectDeliverableId`가 있으면 AI-13, 없으면 AI-12. call_key `writing_chat.turn.{n}.extract|reply|compose`, 미터 `feature = writing_chat`(기존 job_type 매핑), 호출마다 `ai_usage_records` 1행.

### SSE 이벤트

- STAR(AI-12): 순서 그대로. `turn_done`에서 `chips` 삭제(R-PA-5).
- 산출물(AI-13) `DeliverableTurnEventSchema`:
  - 질문 턴: `turn_started` → `reply_delta`* → `reply_done` → `facts_patch {structuredDraft, added: factId[]}` → `draft_flags {needsReview: factId[], actorAmbiguous, numberVague, sensitiveAdded, sensitiveFlagsCount, clarifications}` → `turn_done`
  - 초안 턴: `turn_started` → (`facts_patch` → `draft_flags`) → `draft_started {attempt, reason}` → `draft_block {attempt, block}`* → `draft_done {body(정본), rev, draftCount, droppedBlockCount, needsReviewBlockIds, missingSlots, replaceAllowed}` → `reply_done`(고정 문구) → `turn_done`. 블록 0개면 `draft_done` 없음. 초안 불가(사실 부족·상한·의도 미확인)면 `reply_delta`* → `reply_done`(notice 포함 응답)
  - `turn_done {jobId, messageCount, remainingMessages, limitReached, closed, draftStatus, draftCount, readyToReturn: false, needsReviewCount}`
  - 실패: `error`(C-11 코드). 초안 실패면 이전 초안 유지·`draft_count` 그대로, assistant 행 `failed`.
- 진행 단계(`ai_jobs.progress`): 질문 턴 `extract`/`reply`(total 2), 초안 턴 `extract` → `compose` → `validate`(total 3, 중간 갱신은 best-effort).
- 재시도: 정리 = C-11.3 즉시 재시도(기존과 같음), 초안 = `draft_block`을 하나도 보내기 전까지만(R5-API-7), 응답 = 첫 토큰 전. 무료 등급: 순차 + 간격(질문 턴 reply → extract, 초안 턴 extract → compose/reply).

### 첫 메시지 순차 호출 (DM 7장, 화면이 순서대로)

① 이름·제목 비면 보내지 않음 → ② `getDataReadiness().ai_connection` → ③ `saveProjectPage`/`saveProjectDeliverable`(행 생성) → ④ `startWritingChat`/`startDeliverableWritingChat`(스냅숏 포함) → ⑤ 턴(`formSnapshot` 포함). 서버는 각 단계를 따로 제공(한 트랜잭션 아님).

### 삭제 영향

- `get_deletion_impact` 반환의 `cascade.writing_chats`는 계약(`DeletionCascadeCounts`)에 이미 있고 서비스·`lib/data/deletion.ts`가 그대로 전달한다 → 코드 변경 없음. 통합 테스트로 산출물 1 / 독립 프로젝트 1 확인.

## 배선 — 호환 껍데기·연결 대기

- UI가 import하는 `src/lib/data/*`·`src/types/db.ts`는 이번에 시그니처를 바꾸지 않았다. `writing-chats.ts`(옛 S-36 껍데기)는 손대지 않음 — 반영 RPC를 부르지 않았으므로 영향 없음.
- `writing-chats-v44.ts`(R4 연결 대기, UI import 없음): `applyProposal` **삭제**, `getProjectChat`/`startProjectChat`은 STAR 대화만(산출물 대화 id → `not_found`).
- **새 `src/lib/data/page-save-v45.ts`(연결 대기, UI import 없음)**: `saveProjectPage`, `saveDeliverablePage`, `startProjectChatWithSnapshot`, `startDeliverableChat`, `listDeliverableChats`, `getDeliverableChat`, `editDeliverableDraft`, `deliverableTurnRequest`. `?state=` 미리보기 분기 없음(mock이 옛 모델).
- `src/types/db.ts`: 변경 없음(새 화면이 쓸 때 `DeliverableWritingChatDto` 등은 contracts에서 import 권장).
- UI 재작업 때: S-10 섹션 저장 → `saveProjectPage`, S-44 → `page-save-v45`, 칩은 화면 계산(`quickChips`·`deliverableChips` — `src/server/ai/context-pack/*`는 순수 함수, 필요하면 `src/lib/`로 재수출), `draft.ts` `chipsFor` 정리.

## 테스트

- 단위 `writing-chat.test.ts`: 페이지 저장 입력·RPC 결과 파싱·`toPageValues`(생략 키 유지), 스냅숏 계약(길이·월·역량 중복·모르는 키 제거), 턴 옵션 계약, 산출물 SSE 파싱, R5 오류 매핑 전부(details 포함).
- 단위 `turn.test.ts`: chips 없음 반영. **`deliverable-turn.test.ts`(9)**: 질문 턴 유료·무료 순서, 스냅숏이 파이프라인에만 가고 job 행에 없음, 초안 턴 이벤트 순서·고정 문구·응답 호출 없음·진행 단계 `validate`·호출별 사용 기록, 빈 초안(draft_done 없음), 초안 호출 실패(이전 초안 유지·assistant failed·작업 failed), 상한 409(메시지·작업·호출 없음), 상한 notice 응답, 대상별 옵션 검사·`invalid_form_snapshot`.
- 통합(로컬 스택) `writing-chat.integration.test.ts`: 시작 스냅숏 오류, chips 없음, **[반영] = `saveProjectPage` + appliedProposals**(applied 순서, stale rev → `proposal_changed`, 다시 → `already_applied`, `stale_write` details, `source_writing_chat_id`), 저장 규칙 코드(`project_affiliation_required`·`project_name_required`·`field_too_long {field}`·`invalid_period {field}`·`invalid_classification`·`project_not_affiliated`), 대화 삭제 후 STAR 유지. **`deliverable-chat.integration.test.ts`(5)**: 산출물 페이지 저장 만들기·오류, 대화 시작(종류 짐작), 실제 AI-13 파이프라인 질문 턴(UUID 출처, 스냅숏 미저장, 사용 기록), 초안 턴(rev 1·draft_count 1·고정 문구) → `saveProjectDeliverable` 반영 기록(`applied_mode replace`) → 반영 뒤 블록 수정 거부 → `stale_write`, 삭제 영향 `cascade.writing_chats`, 로그에 원문·스냅숏·키 없음.
- `lib/data/career.integration.test.ts`: v44 `applyProposal` 대신 `page-save-v45.saveProjectPage`로 반영.

## [가정] / 스펙 차이 (spec-gaps.md "R5 (api-engineer)")

- R5-API-1 턴 본문 camelCase(`requestedAction`·`style`·`formSnapshot`), 스냅숏 내부는 DM 모양
- R5-API-2 페이지 저장 zod는 모양만, 규칙 코드는 RPC
- R5-API-3 `field_too_long` 400, `invalid_period`·`invalid_fields` 자기 코드, `not_found` raise 매핑, details `{field, fields}` / `{current_updated_at}`
- R5-API-4 chips 제거(STAR turn_done·DTO), `chipsFor` 잔존
- R5-API-5 초안 상한 경합 → 고정 문구 응답
- R5-API-6 RPC가 `replace_draft` 거부 → `schema_invalid`
- R5-API-7 초안 즉시 재시도는 블록 전송 전까지만
- R5-API-8 `DeliverableDetailDto.writingChats`, STAR 목록에서 산출물 대화 제외
- R5-API-9 산출물 `turn_done` 모양
- 통합 테스트에서 `draft_count = 6` 위조는 `writing_chats_guard` 때문에 불가 → 상한 409는 단위 테스트로만 확인(RPC raise는 pgTAP이 확인)

## 다른 팀원에게

- **db-engineer**: 요청 없음. (참고) 생성 타입이 nullable RPC 인자를 표시하지 않아 `page-save.ts`의 `nullableArg` 한 곳에서 캐스트.
- **ai-pipeline-engineer** ("AI에 요청"): 없음 — 노트 3장 인터페이스 그대로 사용. 참고로 `reject_draft_limit` 계획은 서버가 메시지 저장 전에 409로 막으므로, 파이프라인 `plan()` 래퍼에서는 경합 대비로 `compose`로 바꿔 `composeDecision`의 `draft_limit` notice가 응답하게 했다.
- **backend-qa**: 확인 포인트 — `apply_writing_chat_proposal` 코드 참조 0건(주석만), `form_snapshot` 로그·DB 미저장(통합 테스트 2곳), 오류 코드 DB ↔ `errors.ts`(R5 신설 10개), SSE 이름 API ↔ AI 노트 4장, `progress.stage` `compose`/`validate`, call_key `…compose`, 산출물 `turn_done`의 `draftCount`.

## QA 수정 (라운드 1, `03_backend-qa_report.md`)

| 이슈 | 처리 |
|------|------|
| QA-R5-02 | `deliverable-turn.test.ts`에 초안 턴 종료 경로 7개 추가(16개): 블록 전 compose 실패 → 즉시 재시도(이벤트 `draft_started` 2번, 사용 기록 failed+succeeded), 블록 뒤 실패 → 재시도 없음·`error timeout`·이전 초안 유지·assistant `failed`, 재생성(호출 2회) → compose 사용 기록 2행, RPC가 `replace_draft` 거부 → `schema_invalid`·작업 failed·초안 그대로, 저장 시 상한 경합 → 고정 문구 `reply_done`+`turn_done`(draft_done 없음)·작업 succeeded, 초안 중 클라이언트 끊김 → 작업 `canceled`·assistant `failed`·열린 호출 사용 기록 1행, 초안 시간 초과 2회(즉시 재시도 1회) → `timeout`·사용 기록 2행 |
| QA-R5-03 | `errors.ts`에서 `field_already_filled` 매핑 삭제(마이그레이션에는 R5 주석에만 남음, raise 0건) |
| QA-R5-04 | **연결 대기 항목으로 남김.** 옛 껍데기(`services/career/rows.ts` → `lib/data/career.ts` `toLegacyWritingChat`·프로젝트별 대화·`active_writing_chats`)가 산출물 대화를 STAR 대화처럼 섞을 수 있다. 지금은 산출물 대화를 만드는 UI 경로가 없어 영향 없음. **S-44 연결 단계 체크리스트**: 껍데기에서 `project_deliverable_id is null`만 쓰거나 껍데기 삭제 |
| QA-R5-05 | `page-save-v45.ts` `deliverableTurnRequest`: 다시 보내기를 `{ retry: true, requestedSlot?, requestedAction?, style?, formSnapshot? }`로 받아 `WritingChatRetryInput`으로 검사해 `?retry=1` 본문에 싣는다 |
| QA-R5-07 | 스냅숏 길이 검사를 코드포인트로(`codePointLength` = `Array.from(s).length`, DB `char_length`와 같음): 이름·제목 100, STAR 2,000, 본문 20,000. 이모지 100개 제목 통과·101개 거부 테스트 추가 |
| QA-R5-06 | db-engineer 몫(목록 항목·표 행 객체 강제) — api 변경 없음 |

재검사: `pnpm typecheck` 0건, `pnpm lint` 0건(경고 0), `pnpm vitest run` **117 파일 1,905개 전부 통과**.
