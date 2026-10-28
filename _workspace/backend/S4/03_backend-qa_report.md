# S4 백엔드 QA 리포트 (라운드 1 → 2 최종)

## 최종 판정 (라운드 2, 2026-10-30)
**통과.**
- QA-S4-01~07은 모두 수정됐고, 재확인을 마쳤다.
- 회귀는 찾지 못했다.
- 미해결 이슈는 없다.
- 사용자 확인이 필요한 `[가정]` 7건(아래 "가정 판단")은 그대로 남는다. 리더가 사용자에게 보고한다.

### 라운드 2 검사 실행 결과
`run-checks.sh --build`, 로컬 스택. db가 S4 마이그레이션 파일을 제자리에서 고친 뒤 `db reset`한 상태다.

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 53 파일 910개(+6) |
| build | 통과 | |
| pgTAP | 통과 | Files=25, Tests=1074(+8) |

### 라운드 2 재확인과 회귀 점검

**QA-S4-01 (`retry_after`)**
- `turn.ts:493-495`는 대기 원인을 최종 실패로 보고 `finalRetryAfter(err, retries, now)`를 쓴다.
  - rate_limited는 max(다음 대기, 1분)이다.
  - provider_unavailable은 +1분이다.
  - 그 밖의 원인은 null이다.
- 같은 값이 SSE `error`와 `ai_jobs.retry_after`에 들어간다.
- `daily_quota_exhausted`는 `quotaResetsAt`만 채운다.
- 테스트 `turn.test.ts:252`, `:265`가 있다.

**QA-S4-02 (V-9 로그)**
- `writing-chat-turn.ts:36`이 `consoleAiLogger`와 `logJobEvent`를 넘긴다. `pipelines.ts:136`이 `jobId`와 `logger`를 넘긴다.
- `writing_chat.v9_rejected` 로그에는 개수, 검사 번호, 필드 경로(`detail.D1.action` 형태)만 들어간다. 원문·값·인용은 없다.

**QA-S4-03 (`call_key`)**
- `AI-12.ts:87,134`는 `deps.callKey`를 우선 쓴다.
- 턴은 `writing_chat.turn.{n}.extract|reply`를 넘긴다(`turn.ts:523`).
- 통합 테스트가 기록된 `call_key`를 확인한다.

**QA-S4-04 (진행 중 턴 판정)**
- 순서
  - 작업 insert는 원래도 append보다 앞이었다.
  - 대화당 진행 중 작업은 `ai_jobs_in_flight_target_key`(queued/running 부분 unique)로 1개뿐이다. DB에서 확인했다.
  - 그래서 잠금을 잡은 뒤 남아 있는 `streaming` 행은 끝난 턴의 행이다. `turn.ts:230-241`이 이를 `failed`로 닫아도 살아 있는 턴을 건드리지 않는다.
  - 작업 행은 메시지 수에 들어가지 않으므로 순서가 메시지 수에 영향이 없다.
- 실패 경로
  - insert 뒤 append가 실패하면 작업은 canceled로 닫힌다(기존과 같음).
  - append 뒤 begin이 실패하면 대답 없는 user 메시지가 남는다. 이 메시지는 다음 턴의 정리 대기 발화에 들어가고, 상한 계산(≤38/≥40)도 그대로 맞는다.
  - 이 상태에서는 "다시 보내기"가 `nothing_to_retry`이고 새 메시지만 보낼 수 있다. S4 이전부터 있던 동작이고 데이터는 깨지지 않는다(정보).
- `private.writing_chat_message_is_live`
  - 판정: `streaming`이고, 2분 안에 갱신됐고, 그 행의 작업이 끝나지 않음.
  - append는 살아 있는 행이 있으면 `turn_in_progress`로 거부한다(409 매핑 확인).
  - begin은 작업이 끝난 행을 바로 재사용한다.
  - definer 헬퍼이고 `revoke from public`이다. definer 함수 안에서만 쓰인다.
  - 작업이 실행 중이어도 행 갱신이 2분 넘게 없으면 죽은 턴으로 본다. 턴 예산이 58초라 실제로는 생기지 않는다.

**QA-S4-05 (`draftStatus`)**
- 계약 `TurnDoneEvent.draftStatus`(`updated|unchanged|failed`)와 `draftUpdated = draftStatus !== 'failed'`가 `turn.ts:598-625`와 맞는다.
- 정리를 건너뛰면 `unchanged`다.
- 테스트 `:278`이 있다.

**QA-S4-06 (행위자 확인)**
- impl이 `current_setting('role', true)`와 `p_actor`를 대조한다(`…_structured_draft_patch.sql:213-216`).
  - 이 값은 PostgREST의 SET ROLE 값이라 definer로 바뀐 뒤에도 남는다.
  - 맞지 않으면 `42501 actor_mismatch`이고, `errors.ts:147`이 `forbidden`으로 매핑한다.
- pgTAP 3건과 PostgREST 경유 통합 테스트(AI·사용자 패치)가 모두 통과한다. definer 안에서도 판정이 동작한다.

**QA-S4-07 (테스트·민감정보 개수)**
- 원인 2·6 턴 테스트를 추가했다.
- `toDraftPatch`는 `add_sensitive_flags`를 맨 앞에 두고 나머지를 99개로 자른다.

**재확인한 불변 조건**
- `app_ai_writer`의 커리어 쓰기는 0이다.
- `structured_draft` 직접 UPDATE 권한은 없다.
- 시그니처가 바뀌지 않아 생성 타입도 그대로다.

## 라운드 1 판정
**조건부 통과.** 검사 5종은 모두 PASS다. Critical 이슈는 없다. NFR-AI-05(턴 경로의 커리어 쓰기 0)와 "날조 없음" 경로(V-9 ↔ RPC ↔ 저장 규칙)는 경계면에서 맞물린다. 남은 것은 Major 1건(스트리밍 턴 최종 실패의 `retry_after`)과 Minor 6건이다. Major를 고치고 재확인한 뒤 `done`으로 둔다. 사용자 확인이 필요한 `[가정]`은 아래 "가정 판단"에 정리했다.

## 검사 실행 결과
`bash .claude/skills/backend-integration-qa/scripts/run-checks.sh --build` (로컬 스택 실행 중, 2026-10-28)

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `next typegen && tsc --noEmit` |
| lint | 통과 | 경고 0 |
| vitest | 통과 | 53 파일 904개 (로컬 스택 통합 테스트 포함, SKIP 없음) |
| build | 통과 | `pnpm build` |
| pgTAP | 통과 | Files=25, Tests=1066 |
| 생성 타입 최신 여부 | 통과 | `supabase gen types --local` 결과와 `database.types.ts` 차이 0 |
| DB 함수 = 마이그레이션 파일 | 통과(표본) | `append`(>38), `begin`(2분·>38) 정의가 파일과 같음 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM §2.5·§3.3·§3.4·§4.1·§4.2 ↔ 마이그레이션 | 통과(차이는 spec-gaps에 기록됨) | — |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과 | — |
| Q3 | RPC 시그니처 ↔ 호출부 (`db.ts`, `chat.ts`, `rpc.ts`) | 통과. RETURNS TABLE은 `data[0]`로 읽음 | — |
| Q4 | RPC `message` ↔ `errors.ts` | 통과. S4 SQL 코드 28개와 사용자 패치 거부 사유 9개가 모두 매핑됨 | — |
| Q5 | 계약 ↔ 핸들러 ↔ 화면(S-36, S-08) | 통과(경미한 의미 차이) | QA-S4-05 |
| Q6 | SSE: AI-12 / DM §7 ↔ `contracts/writing-chat.ts` ↔ `turn.ts` ↔ `sse.ts` | 통과. 종료 이벤트 1개를 보장함(작업 유실 시 `sse.ts`가 `error`를 보냄) | — |
| Q7 | AI 출력 ↔ V-9 ↔ 패치 ↔ `structured_draft` ↔ 저장 | 통과 | QA-S4-02 |
| Q8 | enum: DB CHECK ↔ `enums.ts` | 통과(mode, status, role, message status, return_target feature, clarification kind, field 키) | — |
| Q9 | 작업 종료·사용 기록·재시도 | **이슈** | QA-S4-01, QA-S4-03 |
| Q10 | 보안·개인정보 | 통과 | QA-S4-06(강화 제안) |
| Q11 | UI ↔ 백엔드 | 해당 없음(S-36·S-08 화면 없음, "연결 대기") | spec-gaps 기록(패턴 문서) |

### 중점 확인 결과 (요청 항목별)

**NFR-AI-05: 턴 경로의 커리어 쓰기 0**
- DB 실측에서 `app_ai_writer`가 쓸 수 있는 것은 `ai_jobs`·`ai_usage_records`·`evidence_links` 컬럼 insert/update뿐이다. 커리어 7개 테이블에는 쓰기 권한이 없다.
- 상속 역할: `app_ai_writer`는 `authenticated`의 멤버가 아니다(멤버십은 `postgres`, `authenticator`뿐).
- 실행 가능 함수는 `begin`·`finish_assistant_message`, `mark_writing_chat_extracted`, `apply_structured_draft_patch`(+impl), 기존 S3 함수다. `save`·`hand_off`·`commit`·`finalize`·`set_writing_chat_affiliation`은 실행할 수 없다.
- `structured_draft` 직접 UPDATE 권한은 어떤 역할에도 없다. 사용자 컬럼 UPDATE는 `status`·`return_target`뿐이다. `service_role`은 select·delete만 갖는다.
- 턴 코드(`turn.ts`, `pipelines.ts`, `db.ts`)는 커리어 테이블을 읽기만 한다. 통합 테스트도 "커리어 행 0"을 확인한다.

**"날조 없음" 경로 (사용자가 말하지 않은 값이 커리어 테이블에 닿는 길 찾기)**
- 각 필드의 방어선
  - 모든 텍스트·숫자·월·스킬 필드는 `checkClaim`에서 V-9a → b → g → c → d → e를 거친다.
  - V-9a는 이번 호출의 `role=user`·`done` 메시지만 출처로 인정하고, 위임 발화("알아서 채워 줘")는 거부한다.
  - V-9b는 인용을 발화 원문 구간으로 바꿔 저장한다.
  - 성과는 4필드를 모두 검사하고, `unit` 문자열도 인용에 있어야 한다.
  - 스킬은 값 자체가 출처 발화에 있어야 한다(사전 변형 허용).
  - 소속 제안은 후보 이름이 출처에 있어야 한다.
  - V-9f에 걸린 값은 `situation`에 `needs_review`로만 들어간다.
- DB가 다시 막는 것
  - V-9a: 이 대화의 user 메시지 id만 출처로 받는다. 인사·남의 대화·같은 사용자의 다른 대화는 거부한다.
  - 보호 필드(`user_edit`, `accepted`).
  - V-9h: AI·사용자 공통, 공백 값은 빈 값으로 본다.
  - 값 형식.
- 저장 규칙
  - `review ∈ (ok, accepted)`이고 값이 있는 필드만 쓴다. `needs_review`·거절(값 null)은 건너뛴다.
  - augment는 빈 컬럼만 채운다(공백 값은 빈 값). 프로젝트 소속은 바꾸지 않는다.
  - 소속은 `writing_chats` 컬럼에서만 온다. 그 컬럼은 사용자 세션 RPC만 쓴다. AI 제안은 `affiliation_suggestion`에만 남는다.
  - 스킬은 `normalized_name`으로 연결한다. `source_writing_chat_id`를 채운다.
- AI 질문 속 사실에 사용자가 "네"라고 답한 경우
  - 숫자는 V-9c, 기술명은 V-9d가 거부한다.
  - 숫자·고유명사가 없는 일반 문장은 V-9e에 걸려 `needs_review`가 된다. 사용자가 수락해야 저장된다(스펙 설계대로).
- **결론**: 사용자가 말하지 않은 값이 확인 없이 커리어 테이블에 닿는 경로는 찾지 못했다.
  - 단, V-9b~e는 앱에만 있고 DB는 V-9a·V-9h·보호 필드만 다시 막는다(DM 설계대로).
  - 그래서 V-9 로그가 운영에서 꺼져 있는 점(QA-S4-02)은 "날조 0%" 사후 검수를 막는다.

**패치 계약 3모듈 일치**
- op 이름·target 모양·값 형식·한도가 세 쪽에서 같다.
  - ai `toDraftPatch`: `new_detail`을 맨 앞에 두고, `append`는 합친 값으로 `set`을 보낸다. 출처 20개, ops 100개로 자른다.
  - db 노트 "패치 계약".
  - api `toPatchTarget`(`detail.{detailKey|existingDetailId}` → `detail_key|existing_detail_id`).
- 거부 처리
  - AI: op 단위로 건너뛰고 `rejected[]`로 받는다. 원문 없이 개수·사유만 로그에 남긴다.
  - 사용자: 첫 위반에서 예외를 내고, 409/400으로 매핑한다.

**메시지 수**
- 인사 = 1이다.
- 사용자 메시지는 `count ≤ 38`일 때만 받는다. DB `append`, api `hasRoomForTurn`(count+2 ≤ 40), DB `begin`(≥40 거부)이 서로 맞는다.
- `is_final = count > 38`(39·40)이고 `limitReached = count ≥ 39`이다.
- 다시 보내기는 실패 행을 재사용하고 개수가 그대로다. 상한에서도 다시 보낼 수 있다.
- pgTAP과 vitest 모두 38/39/40 경계를 덮는다.

**정리 대기 추적**
- 대기 메시지 = `sequence > last_extracted_sequence`인 user 메시지다.
- 정리 성공 뒤에만 `mark_writing_chat_extracted`가 값을 올린다. 값은 내려가지 않는다.
- 다시 보내기는 대기 메시지가 없으면 정리를 부르지 않는다(QA-S3a-08 충족).

**유료 병렬 / 무료 순차**
- 유료는 extract ∥ reply다. 무료는 응답 → 6초 간격 → 정리이고, 응답이 실패하면 정리를 생략한다.
- 호출마다 Llm·마감·재시도가 따로 있다. 성공한 호출은 다시 부르지 않는다.

**사용 기록**
- `createLlm`이 호출마다 1행을 남긴다(`modelTier` = 호출 등급: extract light, reply default).
- `feature = writing_chat`(`USAGE_FEATURE_BY_JOB_TYPE`).
- 끊긴 호출도 `settle`로 기록한다.

**실행 게이트**
- `check_ai_run_allowed`가 사용자 메시지 append보다 먼저 돈다. 막히면 작업은 failed + SSE `error`로 끝나고 메시지는 저장하지 않는다.

**스트리밍 재시도**
- 첫 토큰 전 `retry_now`(schema_invalid / timeout)만 즉시 재시도한다. 대기가 필요한 원인은 바로 실패한다.
- 단, 그때 남기는 `retry_after` 값이 틀렸다(QA-S4-01).

**삭제**
- 대화만 삭제하면 커리어 행이 남는다. `source_writing_chat_id`는 null이 되고 `updated_at`은 유지된다(트리거 순서 `set_updated_at` < `source_unlink`).
- 프로젝트를 삭제하면 대화와 메시지가 cascade로 지워진다. 경력을 삭제하면 대화의 `experience_id`가 null이 된다.
- `get_deletion_impact('writing_chat')`는 `{message_count, linked_saved_rows}`를 돌려준다. `cascade.writing_chats`는 실제 개수를 센다.
- 위 내용은 pgTAP으로 확인했다.

**커리어 트리**
- `activeWritingChats`: active만, `last_activity_at` 내림차순, `message_count / 40`.
- 남은 일수는 `project_id` null인 대화만 `ceil(90일 − 경과)`, 최소 0이다.

**개인정보**
- `src/server/ai`, `services/writing-chat`, `jobs/writing-chat-turn.ts`, 액션·라우트에 `console.*`가 없다.
- 로그 필드는 id·코드·개수뿐이다.
- `ai_jobs.params`에는 `retry`·`requested_slot`만 들어간다.
- 민감정보는 값·인용 모두 V-9g로 거부하고 개수만 저장한다(`sensitive_flags_count`).

## 이슈

### QA-S4-01 [Major] 스트리밍 턴 최종 실패의 `retry_after`가 C-11.3 최소 1분 규칙을 따르지 않음
- 담당: api-engineer
- 근거
  - `src/server/services/writing-chat/turn.ts:480-481`: `decision.kind === "retry_at"`이면 `decision.runAt`(= 지금 + 2~16초, 또는 공급자 Retry-After)을 `retryAfter`로 쓴다.
  - 스트리밍 턴에서 `rate_limited`·`provider_unavailable`은 거의 항상 `retry_at`이 나온다. 그래서 SSE `error.retryAfter`와 `ai_jobs.retry_after`가 몇 초 뒤로 찍힌다.
  - C-11.3 표: 원인 1은 "마지막 실패 시각 + 다음 대기 간격(최소 1분)", 원인 6은 "실패 시각 + 1분"이다.
  - `src/server/ai/errors.ts:167-172` `finalRetryAfter`가 이 규칙을 이미 구현했다. 그런데 `decideRetry`는 `fail`일 때만 이것을 부른다.
  - 테스트 `turn.test.ts:179-188`은 `retryAfter`가 null이 아닌지만 본다.
- 영향: 화면(C-20)의 "N분 후 다시 시도"가 "곧 다시"로 잘못 보인다. 사용자가 바로 다시 보내면 같은 분당 한도에 또 걸리고, 토큰이 또 든다.
- 수정 제안
  - 스트리밍 턴에서 대기 결정(`retry_at`)을 최종 실패로 바꿀 때는 `finalRetryAfter(err, retries, now)`로 `retryAfter`를 계산한다.
  - 테스트를 추가한다: rate_limited는 ≥ 60초, provider_unavailable은 = 60초.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-S4-02 [Minor] AI-12 V-9 검증 로그가 운영에서 꺼져 있음(로거·jobId 미전달)
- 담당: api-engineer (연결), ai-pipeline-engineer (확인)
- 근거
  - `src/server/jobs/writing-chat-turn.ts:34`는 `createWritingChatPipelines()`를 인자 없이 만든다.
  - `src/server/services/writing-chat/pipelines.ts:128`은 `extract`에 `logger`를 넘기지 않는다.
  - 그래서 `src/server/ai/pipelines/AI-12.ts:93`이 `silentAiLogger`를 쓰고, `jobId`도 항상 null이다.
  - `result.rejections`도 어댑터에서 버려진다.
- 스펙: AI-12 "거부된 패치는 … 로그(원문 없이 검사 번호·필드만)에 남긴다", 품질 기준 "날조 0%: 사람 검수 + V-9 로그".
- 수정 제안
  - 턴마다 `jobId`와 `logJobEvent` 기반 `AiLogger`를 `extract`에 넘긴다(턴 deps의 `log` 재사용).
  - `rejections`(check·target만)를 개수 로그로 남긴다.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-S4-03 [Minor] 사용 기록 `call_key`에 턴 번호가 없음
- 담당: ai-pipeline-engineer
- 근거
  - `turn.ts:418,505`는 `callKey: writing_chat.turn.{seq}.reply|extract`를 넘긴다. 그러나 `pipelines.ts:118-135`는 이를 쓰지 않는다.
  - `AI-12.ts:34-35,82,129`의 상수 `writing_chat.extract`/`writing_chat.reply`가 `ai_usage_records.call_key`로 기록된다.
  - C-13 예시는 `writing_chat.turn.7.extract`이다.
- 영향: 기능상 문제는 없다(턴 = 작업 1개라 `ai_job_id`로 구분된다). 다만 api 노트에 "넘긴다"고 적힌 값이 쓰이지 않는다.
- 수정 제안: `extract`/`reply`의 deps에 선택 `callKey`를 받아 우선 쓴다. 또는 api 노트에서 그 문장을 지운다.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-S4-04 [Minor] "주인 없는 streaming" 화면 표시와 `begin_assistant_message` 재사용 조건이 어긋남
- 담당: api-engineer, db-engineer
- 근거
  - `src/server/services/writing-chat/chat.ts:103-114`는 작업이 끝난 `streaming` 행을 `failed`로 보여 "다시 보내기"를 띄운다.
  - DB `20261030000300_s4_writing_chat_message_rpcs.sql:268-279`는 갱신 후 2분이 안 된 `streaming` 행에 `turn_in_progress`(409)를 낸다.
  - 그래서 `finish_assistant_message`가 실패한 직후(작업은 failed)에 누른 다시 보내기는 2분 동안 409가 난다.
  - 또 `append_writing_chat_message`(같은 파일 146-199)는 진행 중 턴을 검사하지 않는다. 두 탭이 거의 동시에 보내면 두 번째 `begin`이 첫 턴의 `streaming` 행을 `failed`로 닫는다(287-288). 그러면 첫 턴의 `finish`가 `invalid_message_state`로 실패한다. api의 진행 중 작업 409가 대부분 막지만 경합 창이 남는다.
- 수정 제안
  - `begin`이 "그 행의 `ai_job_id` 작업이 queued/running이 아니면" 2분을 기다리지 않고 재사용하게 한다.
  - `append`에서 마지막 메시지가 2분 이내 `streaming`이면 `turn_in_progress`를 낸다.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-S4-05 [Minor] `turn_done.draftUpdated`가 "정리할 것이 없음"과 "정리 실패"를 구분하지 않음
- 담당: api-engineer
- 근거
  - `turn.ts:583-587`: `extract.ok`만 true로 본다. 다시 보내기에서 대기 발화가 없어 정리를 건너뛴 경우(`skipped`)도 `draftUpdated: false`가 된다.
  - 계약 주석(`contracts/writing-chat.ts` TurnDoneEvent)은 "False when the extract call failed"이다.
- 영향: S-36이 "미리보기가 갱신되지 않았어요" 같은 안내를 잘못 띄울 수 있다(UI 연결 때 드러남).
- 수정 제안: `skipped`면 true로 보낸다. 또는 `draftStatus: 'updated'|'unchanged'|'failed'`로 바꾼다.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-S4-06 [Minor · 강화] `private.apply_structured_draft_patch_impl`이 행위자를 인자로 받고 authenticated에 실행 권한이 있음
- 담당: db-engineer
- 근거
  - `20261030000400_s4_structured_draft_patch.sql:149-153,290-292`: impl은 `p_actor`를 인자로 받는다. impl이 definer라서 안에서 `current_user`로 판정할 수 없어서다.
  - authenticated와 app_ai_writer 모두 EXECUTE 권한을 갖는다.
  - 지금은 `private`가 PostgREST 노출 스키마(`config.toml:13` `public`, `graphql_public`)가 아니라서 사용자가 `p_actor='ai'`로 부를 수 없다. DM "행위자는 인자가 아니라 호출 역할로 판정"은 노출 설정 하나에 기대고 있다.
- 수정 제안: impl 안에서 `current_setting('role', true)` 또는 `session_user`·JWT `role` 클레임으로 행위자를 다시 확인한다. 인자와 다르면 거부한다.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-S4-07 [Minor] 무료 등급 대기·테스트 공백
- 담당: api-engineer
- 근거
  - `turn.test.ts`에 `daily_quota_exhausted`(→ `quotaResetsAt`)와 `provider_unavailable`의 턴 단위 테스트가 없다(Q9 원인별 테스트).
  - `toDraftPatch`(`schemas/structured-draft.ts:264-267`)는 `add_sensitive_flags`를 맨 뒤에 두고 100개로 자른다. 그래서 ops가 100을 넘으면 민감정보 개수가 빠진다. 실제로 일어날 가능성은 낮다.
- 수정 제안: 원인 2·6 턴 테스트를 추가한다. 민감 개수 op를 잘림 대상에서 빼고 앞쪽에 둔다(ai-pipeline-engineer).
- 상태: 수정됨(확인 완료, 라운드 2)

## `[가정]` 판단 (2026-10-30 추가분)

### 사용자 확인이 필요한 것 (화면·동작이 바뀜)
1. **메시지 상한 실제 최대 39** (db ②, api ④): 사용자 메시지는 `count ≤ 38`일 때만 받는다. 그래서 화면 "n / 40"은 보통 39/40에서 입력이 막힌다. 바꿀 수 있는 방안:
   - (a) 지금대로 둔다.
   - (b) 표시를 "n / 39" 또는 "남은 질문 수"로 바꾼다.
   - (c) 40번째를 사용자 메시지로 받고 마지막 응답 없이 끝낸다.
2. **시작 인사도 40에 포함** (공통 ②): 1과 함께 정하면 된다.
3. **스트리밍 턴은 대기 재시도를 하지 않음** (공통 ③): `rate_limited`·`provider_unavailable`에서 C-11.3의 자동 재시도(4회·2회)가 대화 턴에서는 0회가 된다. 사용자가 "다시 보내기"를 누른다. 짧은 대기(예: 첫 토큰 전 2~4초)를 요청 안에서 허용할지 결정이 필요하다. QA-S4-01을 고치면 안내 시각은 정확해진다.
4. **무료 등급 요청 안 6초 대기** (api ①): 응답 첫 글자 목표(무료 6초)를 넘길 수 있다. 화면에 "호출 간격 대기" 표시가 필요한지 결정이 필요하다.
5. **거절한 소속 제안의 반복** (db ⑦, ai ③): 거절 기록을 저장할 곳이 없다. 사용자가 새 발화에서 같은 회사를 다시 말하면 다시 제안된다. `writing_chats`에 거절 목록 컬럼을 둘지 기획 결정이 필요하다.
6. **그만둔 대화 재개 불가·끝 상태 고정** (db ④): S-08 목록은 active만 보여 주고, abandoned는 90일 뒤 삭제될 때까지 열 수 없다. 재개를 허용할지 결정이 필요하다.
7. **시작 인사 문구와 무료 등급 안내** (db ⑨): 사용자에게 보이는 고정 문구다. UX·고지 문구(F-AI-04 공급자별 고지)와 맞추는 기획 확인이 필요하다.

### 구현 판단으로 충분한 것 (기획 문서만 갱신)
- 쓰기 경로를 definer RPC로 좁힘(db ①): DM §5보다 엄격해 보안상 낫다. DM §5 문구만 고친다.
- `last_extracted_sequence`(공통 ①), 죽은 streaming 2분 규칙(db ③, QA-S4-04 참고), 패치 형식·추가 키(db ⑤), AI op 단위 거부(db ⑥).
- 값 길이 제한(db ⑧), `return_target` uuid 모양만 검사(db ⑩, S5에서 보강).
- 무료 등급 응답 실패 시 정리 생략(api ②), 다시 보내기는 대기 발화가 있을 때만 정리(api ③), 연결 게이트 SSE `error` 1개(api ⑤).
- V-9f "situation 후보 = `needs_review`"(ai ①): 사용자가 수락해야 저장되므로 날조 위험이 없다.
- 위임 발화 서버 거부(ai ②): 스펙보다 엄격하다.
- V-9d·V-9g 판정 상수(ai ④): 사용자 결정이 아니라 평가 세트(NFR-AI-04)로 재현율·오탐을 조정할 항목이다.

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- 2026-10-30 · S4 QA · UI 패턴 문서(`ui-implementation/references/patterns.md`)의 AI-12 스트림 모양: 문서는 `block_*` 이벤트·`useAiStream → blocks`·"월간 대화 한도"이고, 기획·구현은 대화 이벤트와 한도 폐기다. S-36 연결 전에 UI 하네스 문서 갱신이 필요하다.
