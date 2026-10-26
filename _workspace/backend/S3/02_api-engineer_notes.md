# S3 API 구현 노트

S3는 AI 인프라만 만든다(실제 AI-xx 기능·화면 연결 없음). 실행기·SSE는 가짜 단계와 가짜 모델로 끝까지 검증했다.

## db-engineer 요청과 반영 결과
| 요청 | 결과 |
|------|------|
| `ai_jobs.step_outputs` 체크포인트 | 반영. 사용자 select에서도 보이므로 상태 응답에서 **내보내지 않는다**(`status.ts`, 테스트로 확인) |
| `charge_usage_for_job` / `release_usage_for_job` | 반영(멱등). 실행기는 `release_usage_for_job`만 쓴다. 확정은 이후 추가된 `complete_ai_job`(성공+확정 한 트랜잭션) |
| `sweep_stalled_ai_jobs` (service_role) | 반영. 누수 예약(작업 행 없음·failed/canceled)도 해제 |
| ai_jobs update grant | 반영(status, progress, step_outputs, attempt_count, error_code, heartbeat_at, started_at, finished_at 등) |

## QA 라운드 1 반영 (2026-10-26, decisions.md QA-S3-01/05)
| 이슈 | 반영 |
|------|------|
| QA-S3-01 예약 id 단위 정산 | 현재 실행 세대의 예약 id를 `step_outputs._meta { usageEventId, runBase }`에 저장(이어 실행·재시작에도 유지). 해제는 `release_usage(id)`, 확정은 `complete_ai_job(p_job_id, p_usage_event_id, p_attempt_count, p_progress)`(그 예약 1건만). 수동 재시도: `failed → queued` 조건부 점유(attempt_count 일치)에 이긴 쪽만 원장을 건드린다 — 남은 예약 `release_usage_for_job` → 새 예약 → `_meta` 저장. 진 쪽은 원장 호출 없이 현재 상태(`inProgress: true`) 또는 409. 남은 예약 해제·예약 실패 시 작업을 원래 오류로 `failed` 복귀. 예약 id 없는 유료 작업은 실행하지 않고 실패 처리(무료 실행 방지) |
| QA-S3-02 SSE 종료 판정 | `createSseResponse`가 **실제로 보낸 마지막 종료 이벤트**로 결정: `error` → `failed{code}`, 그 밖의 종료 이벤트(`done`, S4 `turn_done` — `terminalEvents` 옵션, 기본은 ai의 `AI_STREAM_TERMINAL_EVENT_TYPES`) → `completed`, 클라이언트 끊김 → `aborted`, 종료 이벤트 없이 끝나면 `error` 이벤트를 보내고 `failed`. 종료 이벤트 뒤의 이벤트는 버린다. 모든 `error` 이벤트는 `aiErrorEvent(code, retryable)` 한 모양으로 정규화(범주별 "차감되지 않았습니다" 문구) |
| QA-S3-07 후속 | contracts의 `RETRYABLE_CODES` 삭제. `aiErrorEvent(code, retryable)`가 retryable을 인자로 받고, SSE 쪽에서 ai의 `isRetryableAiErrorCode`(REFUSAL_FALLBACKS_ENABLED 반영)로 채운다 → `refused`는 현재 `retryable: false`로 실행기와 일치 |
| QA-S3-03 진행 중 중복 시작 | 시작 전에 같은 범위(user, application_project_id, job_type, input_hash)의 queued/running 작업이 있으면 그 jobId를 `inProgress: true`로 돌려준다(예약 없음, regenerate도 동일). 동시 시작 경쟁은 db의 부분 유니크 인덱스 → insert 23505 → `conflict` → 내 예약 해제 후 이긴 작업을 따라간다. `StartAiJobResponse`에 `inProgress` 추가 |
| QA-S3-04 | 재시도 점유 때 `heartbeat_at = now` |
| QA-S3-05 실행 세대 | `attempt_count` = 단조 증가 세대(되돌리지 않음; 자동 재시도 +1, 수동 재시도 +1, 이어 실행은 그대로). 모든 실행기 쓰기(update·체크포인트·heartbeat·finish·complete·재시도 점유)가 `attempt_count = gen` 조건. 지연 멈춤 감지도 읽은 세대 조건이고, 이겼을 때만 그 세대 예약을 해제. 자동 재시도 예산 = `attempt_count - runBase + 1 < 2`, `ctx.attempt`도 같은 식 |
| QA-S3-08 | 사용자 세션 코드에 ai_jobs 조회 없음(취소는 RPC). 실행기 조회는 명시 컬럼(`COLUMNS`). `registry.ts`에 "체크포인트에는 검증을 마친 저장 형태만" 규칙 주석 |

## 엔드포인트 (DM §7 행 ↔ 파일)
DM §7 v3에는 S3 행이 없다("그 밖 v2와 같음"). S3 계획 API 절과 C-6을 따랐다.

| 작업 | 방식 | 파일 |
|------|------|------|
| 비동기 작업 상태 (`useAiJob`, 2초 폴링) | `GET /api/ai-jobs/{id}` → `{ data: AiJobStatusResponse }`. 멈춤 지연 감지 + 끊긴 이어 실행 대체 경로 | `src/app/api/ai-jobs/[id]/route.ts` |
| 중단 버튼 | `POST /api/ai-jobs/{id}/cancel` → 사용자 세션 RPC `request_ai_job_cancel`. queued면 그 자리에서 canceled + 해제, running이면 다음 heartbeat에서 중단 | `.../[id]/cancel/route.ts` |
| 재시도 버튼 | `POST /api/ai-jobs/{id}/retry` → 202 `{ data: { jobId, reused:false } }`. 새 예약 + 실패 단계부터 | `.../[id]/retry/route.ts` |
| 이어 실행(내부) | `POST /api/ai-jobs/{id}/continue` — 쿠키 없음, HMAC 토큰. 202 후 `after()`에서 실행 | `.../[id]/continue/route.ts` |
| 멈춘 작업 정리 (Vercel Cron) | `GET /api/cron/stalled-jobs` (`Authorization: Bearer CRON_SECRET`) → `sweep_stalled_ai_jobs(now - 2분)` | `src/app/api/cron/stalled-jobs/route.ts` |
| 이번 달 사용량 | Server Action `getUsageSummary()` → RPC `get_usage_summary` | `src/server/actions/usage.ts`, `src/server/services/usage/` |

- 모든 AI 작업 라우트 `maxDuration = 60`. 모두 동적(ƒ) 라우트로 빌드됨(Cache Components: 쿠키·요청 헤더 사용).
- 기능 라우트(S4~)가 작업을 시작할 때: `createAppJobRunner(await getSiteOrigin()).startJob({...})` → `{ jobId, reused }`. 준비도(`get_data_readiness`)·`insufficient_data`는 **호출자가 먼저** 확인한다(작업·예약 생성 없음).

## 계약 (`src/lib/contracts/`)
- `enums.ts`: `AI_JOB_TYPES`, `AI_JOB_STATUSES`, `AI_JOB_TERMINAL_STATUSES`, `AI_ERROR_CODES`(errors.ts 재수출), `ERROR_CATEGORIES`, `AI_PROGRESS_STAGES`, `USAGE_FEATURES`, `USAGE_STATUSES`, `USAGE_REASONS`, `EVIDENCE_OWNER_TYPES`, `EVIDENCE_SOURCE_TYPES`.
- `ai.ts`:
  - `errorCategoryOf(code)` — DB generated 컬럼과 같은 매핑(테스트로 고정). `AI_ERROR_MESSAGES[category]` 공통 한국어 문구(모두 "사용량은 차감되지 않았습니다" 포함). 화면 문구는 UI가 category로 고른다.
  - `AiJobStatusResponse` = `useAiJob` 모양 + id: `{ jobId, jobType, status, progress{stage,done,total}, partial(null — 기능 슬라이스가 채움), error{code,category,message}|null, attemptCount, cancelRequested, canRetry, updatedAt }`. `canceled`도 error에 code/category가 실리지만 UI는 실패로 보이지 않는다(패턴 §3).
  - `StartAiJobResponse { jobId, reused, inProgress }`, `CancelAiJobResponse { jobId, status, cancelRequested: true }`.
  - 스트리밍 이벤트 `AiStreamEventSchema` — ai-pipeline `streaming/events.ts`와 **이름·필드 동일**: `block_started{blockId,path}`, `block_delta{blockId,text}`, `block_completed{blockId,block}`, `validated{result,validationReport}`, `done{meta{promptVersion,model,resultId}}`, `error{code,category,message,retryable}`. `category`는 파이프라인 이벤트에 없으므로 **SSE 직렬화 단계가 코드에서 채운다**(`formatSseEvent`). 이벤트 이름 목록 일치는 테스트로 고정. AI-12 턴 이벤트는 S4에서 추가.
  - `UsageSummary { periodMonth(KST 월 1일), features: 5개 전부 { limit, used, remaining } }` — RPC가 안 주는 기능(`chat_message`)은 `limit: null, remaining: null`.
- `src/server/db/errors.ts`: S3 RPC 오류 매핑 추가 — `usage_limit_reached`(429), `usage_limit_missing`(503), `invalid_ai_job_transition`(409), `ai_job_not_found`→`not_found`, 서버 프로그래밍 오류(`invalid_usage_feature/units/reason`, `usage_event_not_found`, `invalid_stalled_before`)→`internal_error`, `invalid_usage_transition`(409). `usage_limit_reached`의 detail JSON(`feature, limit, used`)은 아직 응답에 싣지 않는다(화면은 사용량 조회로 남은 횟수를 안다).

## SSE 헬퍼 (`src/server/sse.ts`, Next 비의존)
- `createSseResponse(produce, { requestSignal, keepAliveMs, onFinish })`: `produce`는 `ctx.emit`으로 보내거나 AsyncIterable을 돌려준다. 헤더 `text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`. 15초마다 `: keep-alive` 주석.
- 클라이언트 끊김(요청 signal abort 또는 reader cancel) → `ctx.signal` abort(모델 스트림 중단) → `onFinish({kind:"aborted"})`. 예외 → `error` 이벤트 1개(AiError면 그 코드, 아니면 `internal_error`, 메시지 노출 없음) → `onFinish({kind:"failed"})`. **원장 정산은 `onFinish`에서**(S4 스트리밍 라우트가 사용).

## 사용량·작업 흐름 (`src/server/jobs/`)
| 파일 | 역할 |
|------|------|
| `types.ts` | `JobStore`, `Ledger`, `StepContext`, `JobTypeDefinition`, `RunnerDeps` 인터페이스 |
| `runner.ts` | `createJobRunner(deps)` → `startJob`, `retryJob`, `runJob`, `getStatus`, `settleCancelIfQueued`, `markStalledIfNeeded`, `resumeIfWaiting` |
| `registry.ts` | `registerJobType({ jobType, steps: [{ stage, total?, timeoutMs?, run(ctx) }], usage?, output? })` |
| `supabase-store.ts` / `ledger.ts` | app_ai_writer 클라이언트로 ai_jobs·원장 RPC 구현 |
| `app-runner.ts` | 운영 연결(server-only): 사용자별 app_ai_writer, Anthropic AiClient(지연 생성), `after()`, 자기 호출 |
| `continue-token.ts` | 이어 실행 HMAC 토큰(작업·사용자·만료 120초) |
| `stalled-sweep.ts` | 크론 전용 service role 모듈 |
| `status.ts` | 행 → `AiJobStatusResponse` |
| `constants.ts` | `INVOCATION_BUDGET_MS 55s`, `STEP_TIMEOUT_MS 45s`, `HEARTBEAT_INTERVAL_MS 10s`, `STALLED_AFTER_MS 2분 [가정]`, `CONTINUE_CLAIM_GRACE_MS 10s`, `MAX_STEP_ATTEMPTS 2` |

### 수명 주기
1. `startJob`: (input_hash가 있으면) 같은 범위 진행 중 작업 → `{inProgress:true}` / (regenerate 아님) 성공 작업 → `{reused:true}`, 둘 다 예약 없음 → job id를 먼저 만들고 **예약 1회**(`reserve_usage`, 비멱등이라 재시도 루프 밖) → ai_jobs insert(`queued`, `attempt_count = 1`, `_meta {usageEventId, runBase: 1}`) — insert 실패 시 즉시 `release_usage(id)`, 유니크 충돌이면 이긴 작업 반환 → `after(runJob)`.
2. `runJob`: 조건부 update로 `queued → running` 점유(둘이 동시에 못 잡음) → 취소 요청 있으면 canceled → 미완료 단계마다 progress·heartbeat 갱신, 단계 실행(마감 타이머 + 10초 heartbeat가 `cancel_requested_at`·종료 상태 확인 → signal abort, 신호를 무시하는 단계도 race로 끊음) → 결과를 `step_outputs`에 저장.
3. 실패: 재시도 가능 코드 + `attempt_count < 2`면 같은 단계 1회 재시도, 아니면 `failed` + 해제. 취소 → `canceled`/`canceled` + 해제.
4. 60초 예산: 이번 실행에서 단계를 하나 이상 했고 `경과 + 다음 단계 마감 > 55초`면 `queued`로 돌려놓고(heartbeat = now) `/continue`를 자기 호출 → 새 함수 실행이 체크포인트 다음 단계부터. Next 16 문서상 `after()`는 해당 라우트의 maxDuration 안에서만 돌므로(중첩 after도 같은 실행) 자기 호출이 필요하다. 자기 호출이 유실되면 상태 조회가 10초 뒤 점유해 이어 실행, 그래도 없으면 2분 뒤 멈춤 처리.
5. 성공(decisions 2026-10-26): 최종 `output`이 있으면 먼저 update로 저장 → RPC `complete_ai_job(p_job_id, p_usage_event_id, p_attempt_count, p_progress)` 하나로 `running → succeeded` + **이 실행의 예약 1건** 확정(한 트랜잭션, 무차감 작업은 null). `charge_usage_for_job`·별도 succeeded update는 쓰지 않는다(`Ledger`에서 charge 제거, 확정은 `JobStore.complete`만).
   - `complete`가 일시 오류 → 1회 더 시도. 두 번 다 실패 → `failed`/`model_unavailable` + 해제(응답만 유실되고 실제로 완료됐다면 상태 가드가 succeeded를 지키고 해제는 0행).
   - `invalid_ai_job_transition`(스윕·취소가 먼저 끝냄) → 사용량 그대로이므로 해제 → `lost`.
6. 해제 실패는 2회 시도 후 로그만 남김 → 스윕이 정리(failed/canceled·행 없음 → released, succeeded에 남은 예약 → charged).
- `attempt_count`: 실행 세대(위 QA-S3-05). 첫 실행 1, 자동 재시도·수동 재시도마다 +1, 되돌리지 않음.
- 좀비 실행기: 모든 쓰기가 `status in (queued, running)` 조건부라 스윕 뒤에는 아무것도 바꾸지 못하고, DB 가드의 `invalid_ai_job_transition`도 "조용히 중단"으로 처리한다.

### service role 사용 (크론)
- 위치: `src/server/jobs/stalled-sweep.ts` 한 곳. env `SUPABASE_SERVICE_ROLE_KEY`(선택값, 없으면 크론만 500으로 닫힘 — 페이지·AI는 영향 없음). `.env.example`에 더미 추가.
- 이유: app_ai_writer 토큰은 RLS로 `sub` 한 사용자에 묶여 있어 전체 사용자의 멈춘 작업을 볼 수 없다. service role로 하는 일은 security definer RPC `sweep_stalled_ai_jobs` 호출 하나뿐이며 테이블을 직접 읽거나 쓰지 않는다.

### 이어 실행 토큰
- 키: `SUPABASE_JWT_SECRET` + 도메인 분리 접두어(새 env 없음). 토큰으로 할 수 있는 것은 그 사용자의 그 queued 작업 이어 실행뿐.
- 보낼 곳은 `getSiteOrigin()`(운영은 `NEXT_PUBLIC_SITE_URL`) — Host 헤더로 토큰이 새지 않게.

## ai-pipeline-engineer와의 합의
- 단계 ctx: 계획안 + `jobType`, `stage`, `attempt`. `ai`는 `AiClient`(운영 `createAnthropicAiClient`, 테스트 `createFakeAiClient`).
- abort 사유 규칙 공유: `"canceled"` = 사용자 취소, 그 외 = timeout(`signalReason`). 실행기는 추가로 `"lost"`(스윕이 먼저 끝냄)를 쓰며, 이때 결과를 버린다.
- 재시도 판단은 `AiError.retryable`을 그대로 쓴다. `generateStructured`의 단계 안 1회 재파싱과 실행기 재시도는 별개.
- 스트리밍 이벤트는 파이프라인 타입과 1:1, SSE가 `error.category`만 덧붙인다.

## 테스트
- `src/server/jobs/runner.test.ts`(32): 시작·재사용·regenerate·한도 초과(작업 행 없음)·insert 실패 해제·무차감 작업 / 성공 확정·점유 경쟁·**complete 일시 실패 → 재시도 후 확정, 계속 실패 → failed+해제, complete 거절 → lost+해제, output 저장이 complete보다 먼저** / **실패 경로 해제**: 비재시도 오류, schema_invalid 재시도 후 실패, 일시 오류 후 성공, 미분류 예외, 멈춘 단계 timeout, 단계 중 취소, 시작 전 취소, queued 취소 정산, 체크포인트 저장 DB 오류, finish 예외, release 재시도 / 멈춤(heartbeat, created_at), 좀비 실행기, heartbeat가 종료 상태 감지 / yield → 이어 실행, 상태 조회 대체 이어 실행 / 수동 재시도(완료 단계 유지, released→charged), 입력 오류 재시도 불가, 재시도 한도 초과. 모든 경우 "예약이 reserved로 남지 않음" 검사.
- `src/server/jobs/runner.integration.test.ts`(12, 로컬 스택 — 없으면 skip): 실제 ai_jobs·원장 RPC로 성공 확정, 재사용, schema_invalid 실패 후 수동 재시도, 입력 오류, timeout, 사용자 취소 RPC(running/queued), service role 스윕 + 좀비 finish·complete 거부(사용량 released 유지), complete 재호출 멱등, 지연 멈춤 감지, 다른 사용자 범위 not_found, interview_session 한도 5 소진 시 6번째 거부(작업 행 없음) + 사용량 요약, yield 이어 실행.
- `src/server/sse.test.ts`(7): 직렬화, category 보강, 오류 이벤트·메시지 비노출, 요청 abort·reader cancel → producer abort + onFinish, keep-alive.
- `src/server/jobs/support.test.ts`(10): 이어 실행 토큰 위·변조·만료, 크론 인증, 상태 응답 계약·step_outputs/params 비노출, category 매핑, 이벤트 이름 일치, KST 월 경계, 사용량 요약 채우기.
- QA 라운드 1 회귀 테스트: 단위(`runner.test.ts` "QA-S3 round 1 regressions" 9개 — 동시 재시도, 남은 예약 + 재시도, 남은 예약 해제 실패 시 복귀, 예약 id 없는 유료 작업, 순차·경쟁 중복 시작, 재시도 직후 폴링, 늦은 이전 세대 실행기, 오래된 스냅샷의 지연 멈춤 감지), SSE 3개(오류 이벤트로 끝난 스트림 → failed·정규화·종료 뒤 이벤트 버림, 종료 이벤트 없음 → failed, 사용자 지정 종료 이벤트), 통합 4개(무차감 작업 complete null, 동시 재시도, 중복 시작 경쟁, 재시도 heartbeat·세대 증가·이전 세대 쓰기 거부).
- 결과: `pnpm typecheck`, `pnpm lint`, `pnpm test`(35 파일 460개, 로컬 스택 통합 포함), `pnpm build` 통과. `next start` 스모크: 상태·취소·재시도·이어 실행 401(미로그인/잘못된 토큰), 잘못된 id 404, 크론 서비스 키 없음 500.

## 스펙 차이·가정 (spec-gaps.md에 기록)
- 미분류 예외 → `model_unavailable`(재시도 1회) [가정].
- `refused` 자동 재시도 포함 [가정].
- 수동 재시도 = 같은 행 `failed → queued`, 새 예약 `reason = 'initial'`, 입력 범주는 409 `ai_job_not_retryable` [가정].
- 멈춤 기준 2분 [가정, 계획].

## 남은 일·위험
- **Vercel Cron 설정(`vercel.json`) 미추가**: 배포 범위 밖. Hobby 플랜은 하루 1회만 가능 — 2분 기준을 살리려면 Pro(분 단위) 필요. 그 전에는 상태 조회의 지연 감지가 주 경로.
- `usage_limit_reached` detail(한도·사용량) 응답 노출, `partial` 채우기, AI-12 턴 이벤트·스트리밍 라우트는 S4 이후.
- 화면 연결(`useAiJob`/`useAiStream` 실제 경로)은 UI 화면이 생긴 뒤 연결 단계에서.
