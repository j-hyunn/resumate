# R11 — api-engineer 노트 (1단계: 마이그레이션과 무관한 순수 코드)

범위: DM v4.11 11.6 #10 · #11 · #13 · #15. 커밋하지 않았다.

## #10 OD-P5 — `base_body_hash` 공통 함수

- **새 모듈 `src/lib/body-hash.ts`** (서버·브라우저 공용, Node·DOM import 없음)
  - `normalizeBodyForHash(body: string): string` — DM 2.5.0 1~4단계
    1. `\r\n`·단독 `\r` → `\n`
    2. 각 줄 끝 공백(U+0020)·탭(U+0009) 제거
    3. `\n` 3개 이상 연속 → `\n\n` (공백만 있던 줄은 2단계에서 빈 줄이 되므로 함께 합쳐짐)
    4. 맨 끝 줄바꿈 제거 — **끝의 `\n`을 모두** 제거(`/\n+$/`). 3단계 뒤라 최대 2개
    - 줄 앞 들여쓰기·줄 안 공백·NBSP/전각 공백 등 다른 공백 문자·유니코드 정규화는 그대로. 본문 **맨 앞** 줄바꿈도 규칙에 없어 그대로 둔다
  - `computeBodyHash(body: string): Promise<string>` — 5단계 `"sha256:" + 소문자 hex(SHA-256(UTF-8(정규화 본문)))`. Web Crypto(`globalThis.crypto.subtle`) 사용 → 브라우저·Node 20+ 모두 동작
  - `BODY_HASH_PREFIX = "sha256:"`
- **서버 전환**: `src/server/ai/context-pack/deliverable-chat.ts` `bodyHash`(동기)가 `normalizeBodyForHash`를 거쳐 `node:crypto`로 해시. 정규화는 같은 함수, 다이제스트 원시 함수만 다름(결과 동일 — parity 테스트)
- **화면(UI 세션 `od-ui`) 할 일**: `src/lib/data/career-v45-shared.ts:641` `bodyHash`를 `import { computeBodyHash } from "@/lib/body-hash"`로 바꾸기(재수출 또는 호출부 `deliverable-draft-card.tsx:343`·`career-v45.ts:316` 교체). **`career-v45-shared.test.ts:37`의 `"가\n나" ≠ "가\r\n나"` 기대는 새 규칙에서 같아지므로 UI가 고쳐야 함.** `src/lib/data/`는 손대지 않았다
- 기존 서버 테스트 `deliverable-chat.test.ts`의 "정확한 본문" 기대(`bodyHash("본문") ≠ bodyHash("본문\n")`)를 새 규칙(같음)으로 고침
- 테스트 `src/lib/body-hash.test.ts`: `\r\n`/`\r`, 줄 끝 공백·탭, 빈 줄 2개 이상 축약·1개 유지·공백만 있는 줄, 끝 줄바꿈, 들여쓰기·줄 안 공백·NBSP·전각 공백·NFD 보존, 멱등, 5단계 형식, **브라우저(Web Crypto) ↔ 서버(node:crypto) 해시 일치**

## #11 OD-P11 — 답 없는 사용자 메시지 다시 보내기

- `src/server/services/writing-chat/turn.ts` `retryTarget`(이제 export): 마지막 메시지가 `user`면 그 메시지를 대상으로 반환. 사용자 메시지는 다시 만들지 않고(`appendUserMessage` 호출 없음) `begin_assistant_message`가 새 assistant 행을 만든다. 기존 대상(마지막 = 실패/고아 streaming 응답 → 그 앞 사용자 메시지, 행 재사용) 그대로. 그 밖(인사만, 마지막이 done 응답, 빈 대화) → `nothing_to_retry`
- **RPC 확인(직접)**: 최신 정의 `supabase/migrations/20261109100900_r4_writing_chat_message_rpcs.sql:71` `begin_assistant_message`가 이미 `v_last.role = 'user'` 분기에서 새 assistant 행 insert + `message_count + 1`, `v_count >= 40` → `message_limit_reached`. **RPC 교체 불필요**. (`02_db_notes.md`는 작업 종료 시점에 아직 없었음 — db-engineer 결론과 대조 필요)
- 상한·진행 중 턴 검사 그대로: 재시도는 `hasRoomForTurn` 검사 생략(기존과 같음) → 상한은 RPC가 지킴(사용자 메시지가 ≤ 38에서 받아졌으므로 응답은 ≤ 40), `findInFlight` → `turn_in_progress` 그대로
- 테스트(`turn.test.ts`): "AI-12 turn — resend for an unanswered user message" 4건 — 새 응답 행·사용자 메시지 재생성 없음·`turn_started.retry = true`·`userMessage.id` = 답 없던 메시지·`messageCount` +1 한 번 / 그 응답이 실패한 뒤 다시 보내기는 실패 행 재사용(셈 안 늘어남) / 진행 중 턴 거부 / 40에서 RPC 거부 → 작업 `canceled`, 호출 0. 기존 `nothing_to_retry` 테스트(인사만)는 유지하고 "마지막이 done 응답" 경우를 추가(작업 행도 안 만듦)
- 참고(내 소관 밖, 손대지 않음): `src/app/api/writing-chats/[id]/turns/route.ts:15` 주석이 "`?retry=1` = 마지막 실패 응답 다시 보내기"라고만 적혀 있음 — 동작엔 영향 없음, 나중에 주석만 "답 없는 사용자 메시지 포함"으로

## #13 OD-L1 — `EnvKms` 주석

- `src/server/keys/kms.ts:56-` "PRE-LAUNCH STAND-IN" → "LAUNCH KEK(`env-v1`), 클라우드 KMS 전환은 출시 후(KMS 어댑터 + `kek_id` 기준 `wrapped_dek` 재포장 스크립트)". 같은 문구가 있던 `src/server/env.ts:57`, `src/server/keys/app.ts:20`도 맞춤. 동작 변경 없음

## #15 OD-P10 / R-OD-8 — 중단된 턴 (확인 + 서버 DTO 보강)

확인 결과:
- **중단 = 메시지 `failed` + 작업 `canceled`**: `turn.ts:475`(클라이언트 끊김·중지 → `turnAbort.abort("canceled")`), `failReply`(`turn.ts:554-`)가 assistant 행을 `failed`(받은 부분 보존)로 닫고, 마무리 `turn.ts:996-1004`가 `code === "canceled"`(또는 lost)면 작업 `status = 'canceled'`, `error_code = 'canceled'`. 기존 테스트 `turn.test.ts` "client disconnect … reply failed, job canceled"가 지킴
- **응답 자리 1회 셈**: `begin_assistant_message` 새 행 insert 때만 `message_count + 1`, 실패 행 재사용(`reused`)은 셈 안 늘림(r4 RPC `:52-61`). 테스트 "a reply left streaming by a dead turn…"(`messageCount` 2 유지)와 이번 OD-P11 두 번째 테스트가 지킴
- **상세 DTO에 작업 상태가 없었음(보강함)**: S-10/S-44 패널이 쓰는 `getWritingChat` → `WritingChatDto`/`DeliverableWritingChatDto`의 메시지에는 `status`·`aiJobId`만 있어 새로고침 뒤 중단·실패를 가를 수 없었다(`writing-chat-view.ts:108`은 옛 S-36 보기에서 `loadTurnFailureJobs`로 따로 읽음). 서버 측에 추가:
  - 계약 `src/lib/contracts/writing-chat.ts`: `WritingChatTurnFailure = { jobStatus: AiJobStatus, errorCode: AiErrorCode | null, retryAfter, quotaResetsAt }`, `WritingChatMessageDto.turnFailure: WritingChatTurnFailure | null`
  - `src/server/services/writing-chat/chat.ts` `loadTurnFailures(supabase, chat)`(export): `failed` assistant 메시지의 작업만 `ai_jobs`에서 읽음(`settleOrphanedStreaming` 뒤에 실행 → 방금 failed로 바뀐 고아 응답 포함). `getWritingChat`이 DTO에 실어 보냄
  - `mappers.ts` `toMessageDto(m, userNumber, turnFailure = null)` — `failed` assistant 메시지에만 값, 그 밖·SSE 이벤트는 null
  - **화면 규칙(UI)**: `turnFailure?.jobStatus === "canceled"`(= `errorCode === "canceled"`) → 중립 "다시 보내기", 아니면 C-11 실패 문구(`errorCode`·`retryAfter`·`quotaResetsAt`). `career-v45.ts` `messagesOf`가 이 필드를 뷰로 옮기는 건 UI 소관
  - 테스트(`writing-chat.test.ts` "turn failure in the chat detail"): canceled/failed 구분, done·user 메시지 null, failed 응답 작업만 조회, 실패 응답 없으면 조회 없음, 작업 행 없으면 null

## 실행 결과

- `pnpm typecheck` 통과
- `pnpm vitest run` 전체 140 파일 / 2,324 테스트 통과(DB 통합 테스트는 로컬 DB 없을 때의 기존 처리 그대로)
- 바뀐 파일 eslint 오류 없음

## 바뀐 파일

- 새: `src/lib/body-hash.ts`, `src/lib/body-hash.test.ts`
- 고침: `src/server/ai/context-pack/deliverable-chat.ts`, `src/server/ai/context-pack/deliverable-chat.test.ts`, `src/server/services/writing-chat/turn.ts`, `turn.test.ts`, `chat.ts`, `mappers.ts`, `writing-chat.test.ts`, `src/lib/contracts/writing-chat.ts`, `src/server/keys/kms.ts`, `src/server/keys/app.ts`, `src/server/env.ts`

---

# 2단계 (DB 뒤: `02_db_notes.md` 기준)

## 1. `interview_session_read_only` (OD-I6, DM 2.7.2)

- `src/server/db/errors.ts`: `interview_session_read_only` → 409, 문구 "자기소개서가 삭제된 면접 기록은 볼 수만 있어요."(UX 문구 확정 시 교체)
- 계약 `src/lib/contracts/interview.ts` `INTERVIEW_EVALUATION_REFUSAL_CODES`에 추가(다시 채점 거부 목록)
- `src/server/services/interview/start.ts` `requireWritableSession(session)`(export): `application_project_id is null` → `interview_session_read_only`. **연결 게이트·작업 만들기 전에** 다음 쓰기 경로 맨 앞에서 호출: `retryInterviewEvaluation`(다시 채점·종합 다시 정리), `retryInterviewQuestions`, `submitInterviewSession`. 반환값(프로젝트 id)을 작업 생성에 씀. `restartInterviewSession`은 기존 `application_project_id !== 입력 id` → `not_found`가 그대로 막음
- "이 기업 JD로 새 면접"(세션 복사 생성)은 서버 경로가 아직 없음(DB 노트: 세션 복사 RPC 없음) → 해당 없음
- 마지막 방어선: DB `begin_interview_evaluation`·`save_answer_evaluation`·`complete_interview_evaluation`이 같은 코드

## 2. 읽기 DTO (S-37 목록·S-20·S-33·S-22)

- `view.ts`: `SESSION_COLUMNS`에 `company_name_snapshot`·`position_title_snapshot`, `SessionRow.application_project_id: string | null`
  - 새 export `detachedSessionName(row)`·`sessionProjectName(row, names, fallback)`·`DETACHED_SESSION_FALLBACK_NAME = "삭제된 자기소개서"` — DM 7장 R-OD-12 이름 규칙(둘 다 → "회사 – 포지션", 하나 → 그 값, 없음 → "삭제된 자기소개서")
  - `toListItem`·`toSessionHeader`: `readOnly: boolean`(= 프로젝트 id null)
  - `sessionScoreOf.noAnswers`: 모두 미응답 세션이 이제 `scored` 0점(R-OD-1)이라 `scored`/`not_scored` 둘 다에서 참
- 계약: `InterviewSessionListItem`·`InterviewSessionHeader`의 `applicationProjectId: string | null` + `readOnly`. `ListInterviewSessionsInput.detached?: boolean`(S-37 "삭제된 자기소개서" 필터 = `application_project_id is null`)
- `read.ts`: 프로젝트 이름은 붙은 세션만 조회(left join과 같은 결과), 분리 세션은 복사 이름. 답변지는 분리 세션이면 JD 조회 생략. 결과 `canRetryEvaluation`은 `readOnly`면 false(DB 판정도 `none`)
- `progress.ts` `foldInterviewProgress`: 분리 세션은 어느 프로젝트에도 세지 않음
- `services/evidence`: `application_project_id`를 읽지 않음 → null 근거 그대로 동작(통합 테스트로 결과 화면 근거 칩 확인)

## 3. 삭제 영향

- 계약 `src/lib/contracts/career.ts`: `ApplicationProjectDeletionImpact = { cascade: {insights, drafts, interview_sessions, stage_events}, kept: {interview_sessions} }`, `CareerDeletionImpact.affected_results.detached_interview_sessions: number`(필수 — `delete_career_item` 반환도 같은 계산이라 포함)
- 서비스 `src/server/services/career/rpc.ts` `getApplicationProjectDeletionImpact(supabase, applicationProjectId)`(career index에서 export), 서버 액션 `src/server/actions/application.ts` `getApplicationProjectDeletionImpact({ id })`
- **UI 할 일**: `src/lib/data/deletion.ts` `getApplicationDeletionImpact`를 위 서비스로 교체, C-05에 `kept`·`detached_interview_sessions` 문구

## 4. 페이지 저장 `clientId` (OD-C6)

- 계약 `SaveProjectPageInput.clientId`·`SaveProjectDeliverableInput.clientId`: `uuid` optional
- `page-save.ts`: 만들기(`projectId`/`projectDeliverableId` null)이고 `clientId`가 있을 때만 `p_client_id` 전달. 고치기에서는 보내지 않음
- 첫 AI 메시지 경로(DM 7장 ③, R-OD-9)는 서버가 따로 없음 — 화면이 같은 `saveProjectPage`/`saveDeliverablePage`(page-save-v45.ts → 이 서비스)를 먼저 부르므로 같은 `clientId`를 넘기면 됨(UI)
- 결과에 `created` 없음(DB 계약). 다시 보낸 반영 기록은 `skipped[].reason = 'already_applied'`

## 5. 채점 job (OD-I1)

- `job.ts`: 머리 주석·`score` 단계 주석 정리(점수는 DB가 `save_answer_evaluation`·`complete_interview_evaluation`에서 d14.v1로 씀), `score` 단계 출력 `{ method: "d14.v1" }`, `complete` 단계 출력에 `scoreStatus`·`scoreValue`
- `db.ts` `completeEvaluation`이 새 반환 `score_status`(`scored`/`not_scored`)·`score_value`를 읽음. `pending_method`를 기대하던 코드는 없었음(`status`·`not_scored_answer_ids`만 사용) → 동작 영향 없음
- `score_overridden` 보고는 유지, AI-06·AI-07 파이프라인·스키마 주석만 "DB가 d14.v1을 씀"으로 고침(ai-pipeline 소관 파일이지만 주석만)

## 6. 고지 버전 fixture

- `ai-connection.integration.test.ts:166,182,369`, `account/__fixtures__/all-slices.sql:49` → `v2026-11-05`

## UI 최소 수정 (UI 세션이 이어받을 것 — 타입·null 허용만, 화면·문구 변경 없음)

| 파일:줄 | 내용 |
|---------|------|
| `src/lib/data/interview-rows.ts:38` | `SESSION_SELECT`에 `company_name_snapshot, position_title_snapshot` 추가 |
| `src/lib/data/interview-rows.ts:109` | `application_name` = `sessionProjectName(s, names, "")`(분리 세션은 복사 이름) |
| `src/lib/data/interview-rows.ts:~123` | `loadNames`에 null 아닌 프로젝트 id만 |
| `src/lib/data/deletion.ts:254` | mock 영향 계산: 프로젝트 없는 근거는 건너뜀 |
| `src/lib/data/evidence.ts:187-212` | JD 요건·공고 원문·내 답변·문항 메모 링크: 프로젝트 id 없으면 `href: null` |
| `src/lib/data/interviews.ts:225` | mock 세션 리터럴에 복사 컬럼 2개 null |
| `src/lib/mock/fixtures.ts:1208` | 같음 |
| `src/components/interviews/interviews-overview.tsx:131` | 작성 중 세션 링크: `application_project_id!`(작성 중 세션은 늘 프로젝트가 있음) |
| `src/components/interviews/session-list.tsx:160` | `setNavOrigin`은 프로젝트 있을 때만 |
| `src/components/interviews/session-list.tsx:172` | "기업 JD로 가기" 메뉴는 프로젝트 있을 때만(DM 2.7.2 "링크 없음") |
| `src/components/interviews/session-status.tsx:67` | `sessionHref`: 프로젝트 없으면 빈 세그먼트(→ 페이지 not found). **분리 세션 S-22 읽기 전용 경로는 UI 결정 필요** |
| `src/lib/data/interviews.integration.test.ts:316,428` | 기대값을 d14.v1으로: 완료 세션 `score_status: "scored"`·`d14.v1`, 모두 미응답 = `scored` 0점(테스트 제목의 "not_scored"는 그대로 둠) |

UI 남은 일: S-37 "자기소개서 삭제됨" 표시·필터(`detached: true`/`application_project_id is null`), S-22·S-33 읽기 전용 모드와 분리 세션 경로, C-05 문구, 새 페이지 `clientId` 생성·전달, `interview_session_read_only` 화면 처리(`src/types/db.ts:1225` `InterviewEvaluationRefusalCode`는 UI 타입이라 안 고침), `turnFailure`·`computeBodyHash`(1단계).

## 2단계 테스트

- 새/고친 테스트: `interview.integration.test.ts`(d14.v1 점수 기대, OD-I6: 삭제 뒤 완료 세션 남음·`readOnly`·복사 이름·`detached` 필터·다른 사용자 격리·연결 없이도 다시 채점/질문 다시 만들기/제출 → `interview_session_read_only` 409·작업 0개·세션 삭제), `view.test.ts`(이름 규칙·`readOnly`·progress), `career/page-save.test.ts`(새, `p_client_id` 전달 규칙), `career.integration.test.ts`(같은 `clientId` 두 번 → 한 행·같은 id, 남의 id `not_found`, 산출물도, 커리어 영향 `detached_interview_sessions`), `application.integration.test.ts`(`getApplicationProjectDeletionImpact` 모양·남의 프로젝트 404), `job.test.ts` fake 반환 갱신
- `pnpm typecheck` 통과, `pnpm lint` 통과, `pnpm vitest run` 141 파일 / 2,333 테스트 통과(로컬 DB 통합 포함)

---

# QA 1차 수정 (`03_backend-qa_report.md`)

## QA-01 (Major) 무료 등급 확인 — 고지 행 기준으로

- `src/lib/contracts/ai-connection.ts` `RecordAiDataUseConsentInput`: "무료 등급이면 늘 확인 필요" refine 삭제(모양만 검사, `freeTierAcknowledged` 기본 false)
- `src/server/services/ai-connection/consent.ts`: `needsFreeTierAck(rows, provider, tier, version)`(export, 순수) — 동의하려는 **그 버전** 고지 행의 `requires_free_tier_ack`로 판정(v2026-11-05: Gemini 무료만). `recordAiDataUseConsent`가 insert 전에 확인해 거부 `free_tier_acknowledgement_required`(400, `details.field = "freeTierAcknowledged"`). 모르는 버전은 DB 가드에 맡김
- `src/server/db/errors.ts`: DB 가드(마이그레이션 20261113001200)의 23514 `free_tier_acknowledgement_required`도 같은 코드로 매핑(그 밖 23514는 그대로 `invalid_input`)
- 테스트: `ai-connection.test.ts`(계약이 세 공급자 무료 + false 모두 받음, `needsFreeTierAck` 규칙·옛 버전·모르는 버전), `ai-connection.integration.test.ts`(OpenAI·Claude 무료 + false → 동의됨, Gemini 무료 + false → 400, 직접 insert도 DB가 같은 코드로 거부·행 없음)
- UI 참고: 화면이 OpenAI·Claude 무료에서 체크박스를 없애고 false를 보내도 됨. Gemini 무료에서 false면 `free_tier_acknowledgement_required`(필드 표시)

## QA-03 (Minor) 분리 세션 "그만두고 새로 시작"

- `start.ts` `restartInterviewSession`: 맨 앞에서 `requireWritableSession` → 분리 세션은 404가 아니라 409 `interview_session_read_only`(받은 프로젝트 id와 상관없이)
- 테스트: `interview.integration.test.ts` OD-I6 케이스에 restart 거부 추가

## 실행

- `pnpm typecheck`·`pnpm lint` 통과
- `src/server/services/ai-connection`·`interview`·`src/server/db`·`src/lib/data` vitest 통과. `src/lib/data/w3.integration.test.ts`가 한 번 hook timeout(로컬 DB 부하/공유)으로 실패 → 단독 재실행 9/9 통과
