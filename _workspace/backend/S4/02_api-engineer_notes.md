# S4 API 구현 노트 (AI 작성 대화, AI-12)

> 상태: 완료. `pnpm typecheck`, `pnpm lint`(내 파일 경고 0), `pnpm test`(51 파일 891개, 로컬 스택 통합 포함), `pnpm build` 통과. 커밋하지 않음.
> 연결(wiring): UI 화면(S-36, S-08) 없음 → "연결 대기".

## 엔드포인트 (DM §7 ↔ 파일)
| DM §7 행 | 방식 | 파일 · 함수 |
|----------|------|-------------|
| AI 작성 대화 시작 | Server Action → RPC `start_writing_chat` | `src/server/actions/writing-chat.ts` `startWritingChat` |
| 대화 조회(이어 하기) | Server Action | `getWritingChat` → `WritingChatDto` |
| 미리보기 수정 / 수락 / 거절 | Server Action → `apply_structured_draft_patch`(사용자 세션) | `applyDraftEdit`, `acceptDraftField`, `rejectDraftField`, `editDraftSkill`, `editDraftDetail`, `editDraftAchievement` |
| 소속 확정 | Server Action → `set_writing_chat_affiliation` | `setWritingChatAffiliation`(`clearSuggestionOnly` = [아니요]) |
| 저장 / 폼으로 전환 | Server Action → `save_writing_chat` / `hand_off_writing_chat` | `saveWritingChat`, `handOffWritingChat` → `WritingChatSaveResult` |
| 그만두기 / 대화만 삭제 | Server Action | `abandonWritingChat`(status 컬럼 update), `deleteWritingChat`(`delete_career_item('writing_chat')`) |
| 복귀 후 비우기 | Server Action | `clearWritingChatReturnTarget` |
| 대화 턴 | Route Handler SSE | `src/app/api/writing-chats/[id]/turns/route.ts` (`?retry=1` = 다시 보내기) |
| 커리어 계층(작성 중 대화) | 서비스 | `getCareerTree`에 `activeWritingChats` 추가 |
| 삭제 영향 | 기존 액션 | `getDeletionImpact({ entityType: 'writing_chat' })` → `{ message_count, linked_saved_rows }` |

- 서비스(Next 비의존): `src/server/services/writing-chat/` — `turn.ts`(턴), `chat.ts`(액션 서비스), `db.ts`(RPC 래퍼), `pipelines.ts`(ai 파이프라인 어댑터), `draft.ts`(diff·진행 단계), `mappers.ts`, `types.ts`.
- 운영 연결(Next): `src/server/jobs/writing-chat-turn.ts` `createWritingChatTurnDeps` — S3b와 같은 연결 경로(`app-runner.ts`의 `connections()`를 export해 재사용).

## 계약 (`src/lib/contracts/writing-chat.ts`, `enums.ts`)
- enums 추가: `WRITING_CHAT_MODES`, `WRITING_CHAT_STATUSES`, `WRITING_CHAT_MESSAGE_ROLES`, `WRITING_CHAT_MESSAGE_STATUSES`, `DRAFT_FIELD_ORIGINS`, `DRAFT_FIELD_REVIEWS`, `CLARIFICATION_KINDS`, `RETURN_TARGET_FEATURES`, `DRAFT_PROJECT_FIELDS`·`DRAFT_DETAIL_FIELDS`·`DRAFT_ACHIEVEMENT_FIELDS`, `WRITING_CHAT_SLOTS`(ai `SlotId`와 같음, `basic_info`…). `DELETABLE_ENTITY_TYPES`에 `writing_chat`.
- `StructuredDraft` zod = DM 2.5 + db 구현 추가 키(`achievements[].achievement_key`, `clarifications[].existing_detail_id`). snake_case 그대로(저장 형식).
- 필드 경로 `DraftFieldPath`: `{section:'project', field}` / `{section:'detail', detail:{detailKey}|{existingDetailId}, field}` / `{section:'achievement', achievementKey, field}` → db 패치 target으로 변환(`chat.ts` `toPatchTarget`).
- `career.ts`: `DeletionImpact`·`DeleteCareerItemResult`가 대화용 모양과의 union. `getDeletionImpact`는 entityType으로 타입을 좁힌다(`DeletionImpactFor<T>`). `CareerTreeDto.activeWritingChats`.
- 턴 요청: `{ content(1..4000, trim), requestedSlot?: {slot, detailKey, existingDetailId} }`, 다시 보내기 `?retry=1` + `{ requestedSlot? }`.

### SSE 이벤트 (zod discriminated union `WritingChatTurnEventSchema`)
| 이벤트 | 필드 |
|--------|------|
| `turn_started` | `jobId`, `userMessage`(MessageDto), `assistantMessageId`, `provider`, `connectionTier`, `messageCount`, `retry` |
| `reply_delta` | `text` |
| `reply_done` | `message`(저장된 assistant MessageDto) |
| `draft_patch` | `structuredDraft`(RPC가 돌려준 전체), `changed: DraftFieldPath[]` |
| `draft_flags` | `needsReview: DraftFieldPath[]`, `clarifications`, `sensitiveAdded`, `sensitiveFlagsCount` |
| `turn_done` | `jobId`, `messageCount`, `limitReached`, `draftUpdated`(정리 실패면 false), `progress` |
| `error` | 공통 모양(S3a: code, category, failureCause, message, retryable, retryAfter, quotaResetsAt) |
- 종료 이벤트: `turn_done` 또는 `error` 하나. `draft_patch`/`draft_flags`는 정리가 성공하고 바뀐 게 있을 때만, 응답 이벤트 뒤(응답 실패 시 `error` 앞)에 보낸다.
- **DM 대비 추가**: `turn_started`(작업 id → 중단 버튼 `POST /api/ai-jobs/{id}/cancel`, 사용자 메시지 번호, 턴별 공급자 배지). `useAiStream`의 `{ status, error, cancel }`과 맞는다(블록 대신 대화 이벤트).
- 플래그(`needsReview`, `sensitiveAdded`)는 ai의 `flags` 대신 **RPC가 돌려준 전·후 draft의 차이**로 계산한다(RPC가 거부한 op가 플래그에 섞이지 않게).

### 오류 코드 (`src/server/db/errors.ts`)
- 409: `writing_chat_not_active`(+`invalid_writing_chat_transition`), `message_limit_reached`, `turn_in_progress`, `nothing_to_retry`(+`no_pending_user_message`), `affiliation_not_editable`, `field_already_filled`, `protected_field`→`conflict`, `detail_not_found`, `achievement_not_found`, `invalid_review_transition`.
- 404: `writing_chat_not_found`·`project_not_found`·`affiliation_not_found` → `not_found`.
- 400 `invalid_input`: `invalid_content`, `invalid_mode`, `project_required`, `project_not_allowed`, `invalid_return_target`, `invalid_affiliation`, `invalid_period`, `invalid_patch`, `invalid_value`, `invalid_source`.
- 500 `internal_error`(서버가 만든 인자): `invalid_ai_metadata`, `invalid_ai_job`, `invalid_message_status`, `invalid_message_state`, `message_not_found`, `invalid_sequence`.

## 턴 흐름 (`turn.ts`)
1. `prepareTurn`(SSE 열기 전, 실패는 JSON 오류): 대화 읽기(사용자 세션) → active·상한(`count ≤ 38`)·다시 보내기 대상 확인 → 진행 중 턴 409 → 공급자 문맥(없음·동의 필요 → `key_missing`, 무효 → `key_invalid`: **SSE error 1개**, 작업·메시지 없음) → `ai_jobs` insert(`writing_chat_turn`, 대상 대화, provider·tier 고정, model_tier default) → claim → `check_ai_run_allowed`(막히면 작업 failed + SSE error) → 사용자 메시지 append(사용자 세션 RPC, 거부되면 작업 canceled) → `begin_assistant_message`(app_ai_writer, 다시 보내기면 행 재사용·개수 불변, `is_final`).
2. `runTurn`: 유료는 reply ∥ extract, 무료는 reply → 6초 간격 → extract. 호출마다 따로 `createLlm`(등급·마감·취소 signal), 각자 즉시 재시도(첫 토큰 전, `decideRetry`의 `retry_now`만), 대기 원인은 바로 실패(`retry_after` 기록). 한쪽 성공을 다시 부르지 않는다(QA-S3a-08).
3. reply 성공 → `finish_assistant_message(done)` → `reply_done`. 실패 → `failed` + 받은 부분 보존.
4. extract 성공 → (빈 패치면 생략) app_ai_writer `apply_structured_draft_patch` → `mark_writing_chat_extracted(processedThroughSequence)`. 실패·RPC 오류 → 미처리로 남김(다음 턴). `rejected`는 개수·사유만 로그.
5. 끝: reply 성공이면 `turn_done` + `complete_ai_job`, 실패면 `error` + 작업 failed(`canceled`면 canceled). 모든 Llm `settle` → 호출마다 사용 기록 1행(끊긴 호출 포함). 키 상태: key_invalid → 무효, 응답 최종 실패가 키 원인 → `recordFailure`, 성공 → `recordSuccess`.
- 취소: 클라이언트 끊김(요청 signal) 또는 heartbeat(10초)에서 `cancel_requested_at` → 두 호출 중단, 작업 canceled.
- 시간: 전체 58초 − settle 5초 안. reply 마감 유료 25초·무료 35초, extract 20초·25초, 남은 시간이 5초 미만이면 재시도·정리 생략.
- 사용 기록 `model_tier`는 호출 등급(extract light, reply default). `jobs/types.ts` `LlmCallRecord.modelTier?` 추가, 기록기는 없으면 작업 등급.
- 범용 재시도(`POST /api/ai-jobs/{id}/retry`)는 `writing_chat_turn`을 409 `ai_job_not_retryable`로 거부(다시 보내기 경로만).
- 로그: 작업 id·코드·개수만. 대화 원문·draft 값 없음(통합 테스트가 로그 전체를 검사).

## 다른 담당자와의 인터페이스
- db: 노트의 패치 계약·RPC 시그니처 그대로 사용. 요청 없음. 생성 타입은 로컬 DB로 재생성한 것과 같다.
- ai: `buildWritingChatContext` / `extract` / `reply` / `isEmptyDraftPatch` 사용(`pipelines.ts`). 턴마다 문맥 1회 생성(두 호출 공유). 입력 로드는 app_ai_writer(소속 후보, 보강 대상, `desired_job_title`, 게이트면 `get_data_readiness`의 `missing`; 기능 키 매핑 career_description·cover_letter → `draft`).
  - 마지막 안내: ai 입력이 `messageCountAfterReply`(≥ 40 판정 → 최대 39라 켜지지 않음)에서 `isFinalReply`로 바뀌었다. api는 `begin_assistant_message.is_final`을 넘긴다(해소).
  - callKey: api가 `writing_chat.turn.{n}.extract/.reply`를 ai deps로 넘기고 그대로 기록된다(QA-S4-03).
  - SendMessage로 ai-pipeline-engineer에게 위 내용을 보내려 했으나 닿지 않았다(리더 경유).

## 테스트
- `turn.test.ts`(15, 가짜 공급자 + 실제 createLlm): 유료 병렬 전체 이벤트·사용 기록 2행(호출 등급)·키 비노출, 정리 실패 → 응답 유지·다음 턴에 함께 정리, 응답 rate_limited → 정리 유지·error·작업 failed + retry_after → 다시 보내기(행 재사용, 개수 불변, 정리 재호출 없음, 실패 응답은 입력 제외), timeout 즉시 1회 재시도, 첫 토큰 뒤 끊김(재시도 없음, 부분 보존), key_invalid → 무효 표시, 클라이언트 끊김 → canceled + 열린 호출 2행 기록, 무료 순차(등급 순서·6초 간격·간격 대기), 무료 응답 실패 시 정리 생략, 상한 39, 게이트 3종, 실행 게이트, 동시 턴 409, 닫힌 대화·다시 보낼 것 없음·없는 대화, append 거부 → 작업 canceled.
- `writing-chat.test.ts`(10): draft diff·진행 단계·패치 target·메시지 번호·90일 남은 일수·입력 계약·게이트 SSE error 모양·S4 오류 매핑.
- `writing-chat.integration.test.ts`(7, 로컬 스택): 시작(인사 = 1, 키 없으면 열람만), **전체 턴**(실제 AI-12 파이프라인 + 가짜 공급자 → 응답 저장, AI 패치·소속 제안, 커리어 행 0, 작업 succeeded, 사용 기록 light/default 2행, `last_extracted_sequence`), 응답 실패 + 다시 보내기, 미리보기 수정·수락 오류·소속 연결 → **저장**(projects·project_details에 값·소속·`source_writing_chat_id`, 이후 턴 거부, 트리에서 빠짐), **폼 전환**(draft) → 대화만 삭제(행 유지, source null), 그만두기, 로그에 대화 원문·키 없음.
- `runner.test.ts`: writing_chat_turn 범용 재시도 거부 추가. `career.test.ts`: writing_chat 삭제 허용으로 갱신.
- 실행: `pnpm test`(통합은 `supabase start` 상태에서 자동), 이 슬라이스만 `pnpm vitest run src/server/services/writing-chat`.

## 스펙 차이·가정 (spec-gaps 2026-10-30 S4 (api) 항목)
- 무료 등급 호출 간격은 요청 안에서 최대 6초 대기.
- 무료 등급 응답 실패 시 정리 생략, 다시 보내기는 미처리 발화가 있을 때만 정리.
- `limitReached` = `message_count ≥ 39`(db 상한 규칙).
- 연결 게이트 차단 = SSE `error` 1개(`key_missing`/`key_invalid`), 사용자 메시지 저장 안 함.
- 그 밖 구현 결정: `turn_started` 이벤트 추가, 플래그는 draft diff로 계산, 주인 없는 `streaming` 행은 조회 시 `failed`로 표시(작업이 끝났을 때), 90일 남은 일수는 올림·최소 0.

## 남은 일
- UI 연결(S-36, S-08): `getWritingChat`·턴 SSE·액션. S-36 저장 확인 다이얼로그의 "검토하지 않은 항목 N개"는 `progress.needsReviewCount`.
- 90일 정리 크론은 S9. 게이트 진입 요건 목록(R-31)은 S5.

## QA 1차 반영 (2026-10-30, `03_backend-qa_report.md`)
| 이슈 | 반영 |
|------|------|
| QA-S4-01 [Major] | 스트림 안에서 기다릴 수 없는 대기 원인은 최종 실패로 보고 `retry_after = finalRetryAfter(err, 재시도 수, now)`로 기록한다(rate_limited: 다음 대기와 1분 중 큰 값, provider_unavailable: +1분). SSE `error.retryAfter`와 `ai_jobs.retry_after`가 같다. 테스트: rate_limited ≥ 60초, provider_unavailable = 60초 |
| QA-S4-02 | 운영 파이프라인에 `consoleAiLogger`와 턴 jobId를 넘긴다(`ai_validation` 개수 로그). V-9 거부는 `writing_chat.v9_rejected`(개수, 검사 번호, 필드 경로만) 로그. 통합 테스트가 그 job의 `ai_validation` 로그와 원문 없음 확인 |
| QA-S4-03 (ai 반영 후 연결) | `extract`·`reply`에 `callKey`(`writing_chat.turn.{n}.extract/.reply`)를 넘긴다. 통합 테스트가 실제 파이프라인 경로의 `ai_usage_records.call_key`를 검사 |
| QA-S4-04 | (1) 진행 중 턴 잠금: api는 **사용자 메시지 append 전에** `ai_jobs` insert(대화당 진행 중 1개 unique)를 하므로 두 탭 경합은 두 번째가 409 `turn_in_progress`(append 안 함). db가 append에 진행 중 검사를 더하면 이중 방어가 된다. (2) 잠금을 잡은 뒤 마지막 응답이 `streaming`이면 그 턴은 끝난 것이므로 바로 `finish_assistant_message(failed)`로 닫는다 → 다시 보내기가 2분 규칙을 기다리지 않는다. 클라이언트 끊김은 원래대로 그 자리에서 `failed`로 닫는다. 테스트 추가 |
| QA-S4-05 | `turn_done.draftStatus` = `updated` / `unchanged`(대기 발화 없음·변경 없음) / `failed` 추가. `draftUpdated` = `draftStatus !== "failed"`(정리할 게 없으면 true). 계약·테스트 갱신 |
| QA-S4-07 | 턴 테스트: `daily_quota_exhausted`(재시도 0, `quotaResetsAt` = 공급자 값, `retry_after` null), `provider_unavailable`(재시도 0, +1분, 키 실패 기록) |

- 검사: typecheck, lint, test(53 파일 910개, 통합 포함), build 통과.
