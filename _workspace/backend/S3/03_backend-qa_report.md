# S3 백엔드 QA 리포트 (라운드 2 · 최종)

> 라운드 1 내용은 아래에 그대로 두고, 라운드 2 재확인 결과를 이 절과 각 이슈의 상태에 반영했다.

## 판정 (라운드 2)
**S3 `done` 가능 — 미해결 Minor 1건(QA-S3-06)과 새 Minor 3건은 리더에게 넘긴다.**
- Major 4건(QA-S3-01~04)은 모두 수정을 확인했다. Minor 5건 중 4건(05, 07, 08, 09)도 수정을 확인했다.
- 원장 출구 경로가 이제 예약 id + 실행 세대 단위로 닫힌다. 성공은 `complete_ai_job` 하나로 그 예약 1건만 확정하고, 그 밖의 출구는 자기 예약만 해제한다.
- QA-S3-06은 DB grant만 들어가고 팩 코드는 그대로다. 수정 라운드 한도(2회)를 다 써서 미해결로 둔다.
- 라운드 2에서 새로 찾은 Minor 3건(QA-S3-10~12)은 모두 S4 이전에 고치면 되는 좁은 경쟁·UX 문제다. 사용량이 이중으로 차감되는 경로는 없다.

## 라운드 2 검사 실행 결과 (최종)
`run-checks.sh --build`, 로컬 스택 실행 중

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 35파일 460개, skip 0. 통합 테스트 포함(라운드 1 대비 +28, 회귀 테스트) |
| build (`--build`) | 통과 | |
| pgTAP | 통과 | Files=14, Tests=489 |
| 생성 타입 | 통과 | `supabase gen types --local` = `database.types.ts`. `complete_ai_job` 4인자 반영 |

## 라운드 2 이슈 상태
| ID | 심각도 | 담당 | 상태 | 확인 근거 |
|----|--------|------|------|-----------|
| QA-S3-01 | Major | api, db | 수정됨(확인 완료) | **확정·해제가 예약 id 단위로 바뀜.** `complete_ai_job(p_job_id, p_usage_event_id, p_attempt_count, p_progress)`는 세대가 일치할 때만 그 예약 1건을 확정하고, 오류가 나면 전체를 롤백한다(`…000600:42-76`). 실행기의 모든 해제는 `release(meta.usageEventId)`다(`runner.ts` `release`). **수동 재시도는 점유에 이긴 쪽만 원장을 건드린다.** 순서는 `failed→queued` 조건부 점유(세대 일치, `supabase-store.ts` `requeueFailed`) → 남은 예약 해제(`releaseJob`) → 새 예약 → `_meta` 저장이다. 진 쪽은 원장을 부르지 않는다. **예약 id가 없는 유료 작업은 실행하지 않는다**(`runner.ts` "never run it free"). 단위·통합 회귀 테스트가 있다 |
| QA-S3-02 | Major | api, ai | 수정됨(확인 완료) | `sse.ts`가 실제로 보낸 마지막 종료 이벤트로 판정한다(`error`→failed, `done`→completed, 종료 이벤트 없음→`error` 송출+failed). 종료 이벤트 뒤의 이벤트는 버린다. 파이프라인은 종료 이벤트를 정확히 하나만 마지막에 보낸다. 오류 문구는 `aiErrorEvent(code, retryable)` 하나로 통일했다 |
| QA-S3-03 | Major | api, db | 수정됨(확인 완료) | 시작 전에 `findInFlight`로 진행 중 작업을 찾으면 그 작업을 따라간다(`inProgress: true`, 예약 없음). 부분 유니크 인덱스 `ai_jobs_in_flight_input_key`가 있고, 동시 시작에서 진 쪽은 23505 → 자기 예약 해제 → 이긴 작업을 따라간다. 재시도와 맞물리는 부분은 QA-S3-12 |
| QA-S3-04 | Major | api | 수정됨(확인 완료) | `requeueFailed`가 `heartbeat_at = now`를 쓴다. "재시도 직후 폴링 → stalled 아님" 테스트가 있다 |
| QA-S3-05 | Minor | api, db | 수정됨(확인 완료) | `attempt_count`가 단조 증가하는 실행 세대가 됐다. DB 가드가 감소를 거부한다. update·체크포인트·heartbeat·finish·complete·requeue가 모두 `attempt_count = gen` 조건이다. 지연 멈춤 감지도 읽은 세대 조건이고, 이겼을 때만 해제한다 |
| **QA-S3-06** | Minor | ai-pipeline | **미해결 → 리더** | DB 쪽은 반영됐다(`…000300:149-150` `profiles.updated_at` grant). 하지만 `career-rows.ts:14·28`은 아직 `updated_at`을 읽지 않고, `career-pack.ts:131`은 여전히 `p.career_data_updated_at`을 스냅샷으로 쓴다. 증상(거짓 "변경됨")이 그대로다. 수정은 `PROFILE_COLUMNS`/`ProfileRow`에 `updated_at`을 넣고 `:131`을 `p.updated_at`으로 바꾸는 두 줄이다. 화면에 근거 칩이 나오는 S5 전에 고쳐야 한다 |
| QA-S3-07 | Minor | ai | 수정됨(확인 완료) | `REFUSAL_FALLBACKS_ENABLED`(`models.ts:46`, true)가 켜져 있으면 `refused`는 retryable이 아니다(`errors.ts:31-41`). 실행기·SSE의 `retryable`이 같은 함수를 쓴다. 토큰은 `usage.iterations` 합계(`anthropic-client.ts:167`), 대체 여부는 `fallback_message`(`:69`)로 판정한다. contracts의 `RETRYABLE_CODES`는 삭제됐다 |
| QA-S3-08 | Minor | db | 수정됨(확인 완료) | authenticated는 ai_jobs를 컬럼 단위로 select하고 `params`·`step_outputs`는 빠졌다(`…000100` grant). pgTAP가 `select *` 거부까지 검사한다 |
| QA-S3-09 | Minor | db | 수정됨(확인 완료) | 가드의 `failed → queued` 분기에서 `cancel_requested_at := null`. pgTAP 있음 |
| QA-S3-10 | Minor | api | 열림(신규) → 리더 | 아래 |
| QA-S3-11 | Minor | api(S4) | 열림(신규) → 리더 | 아래 |
| QA-S3-12 | Minor | api | 열림(신규) → 리더 | 아래 |

### sweep 변경(리더 승인 편차) 확인
- 변경 내용: 성공 작업에 남은 reserved 행을 charged가 아니라 **released**로 바꾼다(`…000600:115-126`).
- 판정: **안전하다.** 성공 작업의 이긴 예약은 `complete_ai_job`이 같은 트랜잭션에서 확정한다. 그러니 성공 작업에 남은 reserved 행은 진 쪽이거나 이전 세대의 예약뿐이다.
  - 성공했는데 확정되지 않는 경로가 없다. 유료 작업이 `p_usage_event_id = null`로 complete를 부를 수 없다(예약 id 없는 유료 작업은 실행 거부).
  - 진행 중(queued/running) 작업의 예약은 2분이 지나도 건드리지 않는다. 그래서 여러 번 이어 실행되는 긴 작업도 영향이 없다.

### 라운드 2 신규 이슈

#### QA-S3-10 [Minor] 수동 재시도의 점유와 `_meta` 저장 사이에 다른 점유자가 끼면 새 예약이 `reserved`로 남을 수 있음
- 근거:
  - `runner.ts` `retryJob`은 `requeueFailed`(`_meta.usageEventId = null`, queued) → `releaseJob` → `reserve` → `saveStepOutputs(_meta = 새 id)` 순서로 진행한다.
  - 이 사이에 queued 작업을 점유할 수 있는 경로가 있다. 사용자가 바로 취소를 누르면 `settleCancelIfQueued` → `runJob`이 점유하고, 오래된 이어 실행 토큰을 재사용한 요청도 점유할 수 있다.
  - 점유자는 `_meta`가 null인 행을 읽는다. 그다음 `saveStepOutputs`가 먼저 성공하고(같은 세대, 상태 running = active), 점유자가 그 뒤에 `finish(canceled|failed)` + `release(null)`을 하면 새 예약이 아무도 해제하지 않은 채 남는다.
  - 크론 스윕만 이를 정리하는데 Hobby에서는 하루 1회다. 그동안 한도 1회가 묶이고, 차감은 없다.
- 수정 제안: 예약을 먼저 하고 `requeueFailed` 한 번에 `_meta`를 함께 쓴다. 점유에서 지면 그 예약을 해제한다. 아니면 `finish` 시점에 `_meta`를 다시 읽어 해제한다.

#### QA-S3-11 [Minor · S4 주의] 스트림이 저장(`finalize`)까지 끝낸 뒤 클라이언트가 끊으면 `aborted`로 보고됨
- 근거: `structured-stream.ts`는 `finalize`(결과 저장) → `validated` → `done` 순서다. `sse.ts` 루프는 `abort.signal.aborted`이면 다음 이벤트를 보내지 않는다. 그 결과 outcome은 `aborted`이고, 계획대로 S4가 aborted에서 해제하면 **저장된 결과가 무차감**으로 남는다. 저장 직후에 끊어야 해서 경로는 좁다.
- 수정 제안(S4 스트리밍 라우트): 차감 여부를 "결과 행 저장 여부"(`resultId`/finalize 성공)로 정한다. 아니면 `finalize`가 성공한 뒤에는 abort가 와도 `completed`로 본다. S4 계획에 명시한다.

#### QA-S3-12 [Minor] 같은 입력의 다른 작업이 진행 중일 때 실패 작업을 재시도하면 일반 409 `conflict`
- 근거: `requeueFailed`가 부분 유니크 인덱스에 걸리면 23505가 난다 → `mapDbError` → `conflict`(409, 일반 문구). 원장은 건드리지 않으므로 안전하다. 다만 화면은 진행 중인 작업으로 안내받지 못한다.
- 수정 제안: `retryJob`에서 conflict이면 `findInFlight`로 그 작업을 `inProgress: true`로 돌려준다.

---

# (라운드 1 원문)

> 범위: DB(마이그레이션 6개 `20261026000100`~`000600`, pgTAP 5개 + grants 갱신, 생성 타입) + API(`src/server/jobs/*`, `src/server/sse.ts`, `src/app/api/ai-jobs/**`, `src/app/api/cron/stalled-jobs`, `src/lib/contracts/{ai,enums}.ts`, 사용량 action·service) + AI(`src/server/ai/**`). 실제 AI-xx 기능·화면 연결 없음.
> 기준: DM §2.8–2.9, §5, A.14–A.16 / AI C-1~C-9 / UI patterns §1·§3 / decisions.md / spec-gaps.md(2026-10-26 항목).

## 판정
**S3 `done` 보류 — Major 4건 수정 후 라운드 2.** 검사 5종은 모두 통과했고, 열거형·RPC 시그니처·SSE 이벤트 이름·RLS·app_ai_writer 허용 목록·로그 개인정보 경계는 맞다. 문제는 **사용량 원장의 경계**에 몰려 있다.
- QA-S3-01 수동 재시도 경로가 작업 단위로 예약을 정산해서 **무차감 실행**과 **이중 차감**이 둘 다 가능하다.
- QA-S3-02 스트리밍 파이프라인은 오류를 `error` 이벤트로 **내보내고**, SSE 헬퍼는 오류를 **던질 때만** `failed`로 본다. 계획대로 S4가 `onFinish`에서 정산하면 실패한 스트림이 차감된다.
- QA-S3-03 같은 입력의 진행 중 작업을 재사용하지 않아, 버튼을 두 번 누르면 두 번 차감된다.
- QA-S3-04 재시도한 작업의 `heartbeat_at = null` → `created_at` 기준 "멈춤"으로 바로 실패 처리될 수 있다.

## 검사 실행 결과
`bash .claude/skills/backend-integration-qa/scripts/run-checks.sh --build` (로컬 스택 실행 중, 2026-10-26)

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `next typegen && tsc --noEmit` |
| lint | 통과 | |
| vitest | 통과 | 35파일 432개, skip 0 (`runner.integration.test.ts` 12건 등 로컬 스택 통합 실제 실행) |
| build (`--build`) | 통과 | Next 16.4.2, AI 작업 라우트 모두 동적 |
| pgTAP | 통과 | Files=14, Tests=471 |
| 생성 타입 | 통과 | `supabase gen types typescript --local` 결과 = `src/server/db/database.types.ts` (diff 없음) |
| 실제 API 호출 | 없음 | `anthropic-client.test.ts`는 가짜 SDK 주입, 그 밖은 `createFakeAiClient` |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM ↔ 마이그레이션 | 통과 | A.15 job_type 10종·status 5종·error_code 10종·재사용 인덱스, A.16 feature 5종·reason 4종·한도 4행(insight 10, draft 20, interview_session 5, writing_chat 10), A.14 owner_type 6종·source_type 11종(§2.8)·인덱스 3개 일치. FK(application_project_id)·보관 기간은 spec-gaps 기록대로 S5·크론 슬라이스로 미룸 |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과 | 타입 최신. `supabase-store.ts` COLUMNS, `career-rows.ts` 컬럼 목록이 실제 컬럼·app_ai_writer grant(profiles 컬럼 단위 포함)와 일치, `display_name` 미조회 |
| Q3 | RPC 시그니처 ↔ 호출자 | 통과 | `reserve_usage(p_feature,p_units,p_reason,p_ai_job_id)`, `release_usage_for_job(p_ai_job_id)`, `complete_ai_job(p_job_id,p_progress)`, `request_ai_job_cancel(p_job_id)` → `{job_id,status,cancel_requested_at}`, `sweep_stalled_ai_jobs(p_stalled_before)`, `get_usage_summary()` 모두 호출부와 일치 |
| Q4 | raise 코드 ↔ 오류 매핑 | 통과 | S3 RPC의 `message` 전부 `src/server/db/errors.ts`에 매핑(`not_authenticated` 42501 포함), `invalid_ai_job_transition`은 store에서 "lost"로 처리 |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 | 통과(조건부) | 상태 응답이 `useAiJob { status, progress, partial, error }` + id를 주고 `step_outputs`·`params`·`input_hash`를 숨김(`status.ts`, 테스트 있음). 재시도 흐름은 QA-S3-04 |
| Q6 | SSE 이벤트 | **이슈** | 이름·필드는 `streaming/events.ts` ↔ `contracts/ai.ts` ↔ C-6 6종 일치(테스트로 고정). 종료 판정이 어긋남 → QA-S3-02 |
| Q7 | AI 출력 ↔ 저장 | 통과(Minor) | `toEvidenceLinkRows` 컬럼 = A.14, `user_id` 미기입(DB 기본값), `writing_chat_message` 거부, `stripEvidence`, source_field null/허용값이 DB CHECK와 같은 규칙. profile 스냅샷 시각 → QA-S3-06 |
| Q8 | 열거형 DB ↔ TS | 통과 | `AI_JOB_TYPES`, `AI_JOB_STATUSES`, `AI_ERROR_CODES`, `USAGE_*`, `EVIDENCE_*`가 CHECK와 일치. `errorCategoryOf`(contracts) ↔ generated `error_category` ↔ spec C-6 범주 일치. `RETRYABLE_CODES`(contracts) = `RETRYABLE_AI_ERRORS`(ai/errors). source_field 허용값: `evidence-rules.ts` = `evidence_links_source_field_check` = C-3 표 |
| Q9 | 사용량 원장 | **이슈** | 성공(complete_ai_job 한 트랜잭션)·실패·취소(queued/running)·timeout·멈춤(지연·크론)·좀비·insert 실패·complete 실패/거절·yield는 모두 charged/released로 끝나고 테스트가 있다. 재시도·스트리밍·중복 시작에서 깨짐 → QA-S3-01, 02, 03, 04, 05 |
| Q10 | 보안·개인정보 | 통과(Minor) | 새 테이블 4개 모두 A/B 격리 pgTAP, app_ai_writer 쓰기 허용 목록 = ai_jobs·evidence_links 컬럼뿐(커리어 쓰기 없음), definer RPC 모두 `search_path = ''` + 소유 검사, service role은 `stalled-sweep.ts` 한 곳·RPC 하나, 로그는 id·코드·토큰·지연만(C-7), 비밀값 커밋 없음, `.env*` 무시. step_outputs 노출 → QA-S3-08 |
| Q11 | UI ↔ 백엔드 | 해당 없음 | `src/types`, `src/lib/data`, `src/lib/mock` 없음(화면 미구현). build만 확인 |

### 그 밖의 확인 결과 (통과)
- **이어 실행 토큰**: HMAC-SHA256(`resumate:ai-job-continue:v1:` + secret), `timingSafeEqual`, 작업 id 바인딩, 만료 120초. 재사용(replay)은 같은 사용자의 queued 작업을 점유하는 것뿐이고 점유는 조건부 update라 중복 실행이 없다. 보낼 곳은 운영에서 `NEXT_PUBLIC_SITE_URL`(Host 헤더 미사용). 크론은 `CRON_SECRET`(16자 이상) 상수 시간 비교.
- **한도 경쟁**: `pg_advisory_xact_lock(user·KST 월·feature)` 후 합계 조회(READ COMMITTED라 대기 뒤 새 스냅샷) → 초과 불가. db 노트의 두 세션 실측과 pgTAP 일치.
- **C-1 팩**: complete 행만 로드 + draft·미로드 부모의 자식 제외, 정렬은 코드포인트 비교(로케일 무관), 같은 행 다른 순서 → 같은 바이트(테스트), `display_name` 제외, `learnings`는 `<reflection>` + V-5 원천 제외, `<`/`>` 전각 치환. 로더는 app_ai_writer로 컬럼 명시.
- **검증기 vs C-3**: 근거별 V-1 → V-2 → V-3 → V-8 → V-7, 항목별 V-4(judgment 제거 / match 강등 / draft_block `evidence_check_needed` / reference 유지), V-3 임계값 0.7 상수 + 최소 6자, V-5 learnings 숫자 거부·계산 기간 허용·별칭/EC2 무시, V-6 1회 재요청, C-5 6종 고정·개수 불일치 집계. 규칙마다 잘못된 출력을 잡는 테스트가 있다.
- **SSE 이름**: `block_started{blockId,path}`, `block_delta{blockId,text}`, `block_completed{blockId,block}`, `validated{result,validationReport}`, `done{meta{promptVersion,model,resultId}}`, `error{code,category,message,retryable}` — 양쪽 동일, `category`는 `formatSseEvent`가 채움.

## 이슈

### QA-S3-01 [Major] 수동 재시도가 "작업 단위" 해제·확정을 써서 무차감 실행·이중 차감이 생김
- 담당: api-engineer (DB 쪽 보완을 고르면 db-engineer)
- 근거:
  - `src/server/jobs/runner.ts:201` 재시도는 같은 `jobId`로 새 예약 → `:205-213` requeue 실패·예외 시 `settle(scope, job.id, "release")` → `src/server/jobs/ledger.ts:28-31` `release_usage_for_job(p_ai_job_id)` = **그 작업의 reserved 전부** 해제.
  - `supabase/migrations/20261026000600_s3_complete_ai_job.sql:42-44` 성공 시 그 작업의 reserved **전부** charged.
- 도달 경로:
  1. **동시 재시도(더블 클릭·탭 두 개)**: A·B가 둘 다 `status = failed`를 읽고 각각 예약(r1, r2) → A requeue 성공, B requeue 실패 → B가 `release_usage_for_job`으로 r1·r2를 모두 해제 → A의 실행이 성공해도 `complete_ai_job`이 확정할 행이 0 → **무차감 성공**(한도 우회 가능).
  2. **남은 예약 + 재시도**: 실패 처리 때 해제가 2회 모두 실패하면(`runner.ts:120-131`, 로그만) r1이 `reserved`로 남는다. 실패 작업의 누수 예약은 크론 스윕만 정리하는데 크론은 Hobby에서 하루 1회다. 그 사이 재시도 → r2 예약 → 성공 → `complete_ai_job`이 r1·r2를 모두 확정 → **1회 성공에 2회 차감**.
- 수정 제안:
  - `Ledger.reserve`가 돌려주는 usage_event id를 들고, 재시도 쪽 정산은 `release_usage(p_usage_event_id)`로 **그 예약만** 해제한다.
  - `retryJob`은 예약하기 전에 `releaseJob(jobId)`로 이전 예약을 먼저 정리한다(멱등). 아니면 `complete_ai_job`이 "가장 최근 예약 1건만 확정 + 나머지 해제"로 바꾸는 DB 쪽 방법도 있다.
  - 테스트 2건 추가: 동시 재시도 → 최종 charged 1, 남은 reserved + 재시도 → charged 1·released 1.
- 상태: 라운드 2 표 참조

### QA-S3-02 [Major] 스트리밍 오류가 SSE `onFinish`에 `completed`로 보고됨 (파이프라인 ↔ SSE 헬퍼 종료 판정 불일치)
- 담당: api-engineer (`sse.ts`) · ai-pipeline-engineer와 합의
- 근거:
  - `src/server/ai/streaming/structured-stream.ts:84-91` 모델 오류·`schema_invalid`·잘린 JSON을 **던지지 않고** `{ type: "error", … }`를 yield하고 정상 종료한다.
  - `src/server/sse.ts:112-131` `outcome`은 예외가 날 때만 `failed`, 이터러블이 끝까지 돌면 `{ kind: "completed" }`. `sse.test.ts:33-60`도 "던진 오류 → failed"만 검증한다.
  - api 노트 "원장 정산은 `onFinish`에서(S4 스트리밍 라우트가 사용)" → S4가 `completed`에서 확정하면 **실패한 스트림(오류 이벤트로 끝남)이 차감**된다(PRD 6.5 위반).
  - 같은 원인으로 오류 문구도 갈린다: 던진 오류는 `AI_ERROR_MESSAGES[category]`("사용량은 차감되지 않았습니다" 포함), 파이프라인 이벤트는 `AiError` 코드별 문구(차감 안내 없음).
- 수정 제안: `createSseResponse`가 내보낸 종료 이벤트를 기록해 `error` 이벤트가 나갔으면 `{ kind: "failed" }`(코드 포함), `done`이 나갔을 때만 `completed`로 보고한다. `done`·`error` 없이 끝나면 `failed`로 본다. 오류 이벤트 문구도 `aiErrorEvent(code)`로 통일한다. 테스트: "파이프라인이 error를 yield → onFinish failed", "done 없이 종료 → failed".
- 상태: 라운드 2 표 참조

### QA-S3-03 [Major] 같은 입력의 진행 중 작업을 재사용하지 않아 중복 시작이 두 번 차감됨
- 담당: api-engineer
- 근거: `src/server/jobs/runner.ts:141-149` 재사용 조회는 `status = 'succeeded'`만 본다(`supabase-store.ts:98-110`). 그 뒤 `:153-162`에서 매번 새 작업 + 새 예약. 같은 `input_hash`로 거의 동시에 두 번 시작하면(더블 클릭, 새로고침 후 재전송) 작업 2개가 돌고 둘 다 성공하면 2회 차감된다. C-6·PRD 6.4 "같은 입력은 차감 없이 기존 결과"의 취지와 어긋난다(스펙은 진행 중 중복을 따로 말하지 않음).
- 수정 제안: 시작 전에 같은 `(user_id, application_project_id, job_type, input_hash)`의 `queued`/`running` 작업이 있으면 그 `jobId`를 돌려준다(예약 없음, `reused: false` 또는 `inProgress: true`). `regenerate`도 같은 규칙을 적용한다(진행 중인 같은 재생성을 또 만들 이유가 없음). 동시 요청 두 개가 둘 다 "없음"을 보는 경쟁은 부분 유니크 인덱스(`… where status in ('queued','running')`, db-engineer)나 advisory lock으로 닫는다. 테스트 추가.
- 상태: 라운드 2 표 참조

### QA-S3-04 [Major] 재시도한 작업이 `heartbeat_at = null` → `created_at` 기준으로 곧바로 "멈춤" 처리될 수 있음
- 담당: api-engineer
- 근거:
  - `src/server/jobs/supabase-store.ts:203-207` `requeueFailed`가 `heartbeat_at: null`로 되돌리고, 인터페이스가 넘기는 `now`(`types.ts:106`, `runner.ts:205` `iso()`)는 **쓰지 않는다**.
  - 멈춤 판정은 `heartbeat_at ?? created_at`(`runner.ts:431-434`, `20261026000600_s3_complete_ai_job.sql:72-73`). 실패한 작업은 대개 2분보다 오래전에 만들어졌으므로, 재시도 직후 점유되기 전까지 이 작업은 "멈춤" 조건을 이미 만족한다.
  - `getStatus`는 `markStalledIfNeeded`를 `resumeIfWaiting`보다 **먼저** 부른다(`runner.ts:474-475`). 그래서 `after()` 점유가 늦거나 실패하면(`runner.ts:243-246` "poll이 이어받는다") 첫 폴링이 이어 실행 대신 `failed/stalled`로 끝낸다. 크론 스윕도 같다.
- 수정 제안: requeue 때 `heartbeat_at = now`로 둔다(direct 점유 조건 `heartbeat_at < now+1s`는 그대로 통과하고, 폴링 대체 경로는 10초 유예 뒤 이어 실행). "오래된 작업 재시도 → 바로 상태 조회 → stalled 아님" 테스트를 추가한다.
- 상태: 라운드 2 표 참조

### QA-S3-05 [Minor] 종료·해제가 "상태만" 조건이라, 늦은 실행기·지연 멈춤 감지가 재시도된 새 실행을 건드릴 수 있음
- 담당: api-engineer
- 근거: `supabase-store.ts:148,180-186` update·finish 조건이 `status in (queued, running)`뿐이고, `runner.ts:258-259`·`:308`·`:448`은 이기든 지든 `release_usage_for_job`(작업 전체)을 부른다. 예: 지연 감지가 작업을 stalled로 읽음 → 그사이 스윕이 실패 처리 → 사용자가 재시도(새 예약, queued) → 앞의 `finish(failed/stalled)`가 **새로 queued된 작업을 실패시키고** 새 예약을 해제. 함수 60초 상한 < 멈춤 기준 2분이라 실제 확률은 낮다.
- 수정 제안: 점유 때 받은 `heartbeat_at`(또는 `updated_at`)을 조건에 더해 낙관적 동시성으로 바꾸거나 점유 토큰 컬럼을 둔다. 해제는 QA-S3-01처럼 예약 id 단위로 한다.
- 상태: 라운드 2 표 참조

### QA-S3-06 [Minor] 프로필 근거의 `source_snapshot_at`이 프로필 수정 시각이 아님 → 거짓 "변경됨"
- 담당: ai-pipeline-engineer (grant는 db-engineer)
- 근거: `src/server/ai/context-pack/career-pack.ts:131` 프로필 별칭의 `snapshotAt` = `profiles.career_data_updated_at`. 이 값은 **커리어 7개 테이블**이 바뀔 때 갱신되고(DM A.1, `20261024000100_s1_common_functions.sql:22-26`) 프로필 자체 수정과는 상관이 없다. 이 값이 `storage/evidence-links.ts:62`를 거쳐 저장된다. 화면 규칙은 "원본 `updated_at` > `source_snapshot_at` → 변경됨"(UI patterns §5, DM §2.8)이므로, 마지막 커리어 변경보다 뒤에 프로필을 고친 사용자는 팩을 만든 뒤 아무것도 안 바꿔도 "근거 수정됨"이 뜬다. 값이 null이면 `now`로 대체되어 반대로 실제 변경을 놓칠 수 있다. app_ai_writer는 `profiles.updated_at`을 읽을 수 없다(`20261024000300_s1_profiles.sql:47-49`).
- 수정 제안: app_ai_writer에 `profiles.updated_at` select grant를 추가하고(+ `grants.test.sql` 갱신), 로더·팩이 그 값을 쓴다.
- 상태: 라운드 2 표 참조

### QA-S3-07 [Minor] 거절(refusal) 처리: 서버 측 대체가 켜진 상태에서 실행기가 `refused`를 또 자동 재시도, 대체 사용 시 토큰 집계 누락
- 담당: ai-pipeline-engineer (재시도 정책은 api-engineer와 합의)
- 근거:
  - `src/server/ai/anthropic-client.ts:128` `fallbacks: "default"` → `refused`는 대체 체인 **전체**가 거절했을 때만 나온다. 그런데 `ai/errors.ts:26-32`가 `refused`를 retryable로 두어 `runner.ts:313`이 같은 요청을 한 번 더 보낸다(체인 전체 다시 실행, 비용 2배, 결과가 바뀔 가능성 낮음).
  - `anthropic-client.ts:68`은 최상위 `usage`만 쓴다. SDK·claude-api 문서상 대체가 일어나면 최상위 `usage`는 마지막 시도만 담고 시도별 값은 `usage.iterations`에 있다. 그래서 C-7 로그·`ai_jobs.usage`의 토큰이 실제보다 적게 남는다.
  - `:56` `fallbackUsed`를 `fallback` 블록 유무로 판정한다. 문서상 대체 여부의 신호는 `usage.iterations`의 `fallback_message`이고, 대체가 이어진 경우(sticky routing)에는 블록이 없다.
- 수정 제안: 서버 측 대체를 켜 둔다면 `refused`는 자동 재시도하지 않는다(C-6 문구 "실패로 처리하고 재시도 안내"와도 맞음). 토큰은 `usage.iterations` 합계, `fallbackUsed`는 iterations 기준으로 바꾼다. 테스트를 갱신한다.
- 상태: 라운드 2 표 참조

### QA-S3-08 [Minor] `step_outputs`를 사용자 세션이 PostgREST로 직접 읽을 수 있음 — 검증 전 출력이 체크포인트되면 노출
- 담당: db-engineer · api-engineer(기능 슬라이스 규칙)
- 근거: `20261026000100_s3_ai_jobs.sql:123` authenticated에 ai_jobs 테이블 단위 select(`step_outputs`, `output`, `params`, `usage` 포함). 상태 응답은 숨기지만(`status.ts`) 사용자는 `/rest/v1/ai_jobs`로 직접 읽을 수 있다. 다른 사용자의 데이터는 아니라 유출은 아니다. 다만 S5부터 단계가 **검증 전** 모델 출력(예: AI-02 match 배치 원본, 근거 배열 포함)을 체크포인트하면 C-3 "검증 전 출력은 저장·표시하지 않음"을 우회하는 경로가 된다. 사용자 세션 코드에는 ai_jobs 조회가 없다(전부 app_ai_writer) — 컬럼 grant로 빼도 깨지는 호출이 없다(db 노트의 `select('*')` 우려는 현재 해당 없음).
- 수정 제안: 둘 중 하나. ① authenticated는 컬럼 단위 select로 바꿔 `step_outputs`(+`params`)를 뺀다. ② "단계 체크포인트에는 검증을 마친 저장 형태만 넣는다"를 `registry.ts` 주석과 기능 슬라이스 규칙(decisions.md)으로 못박는다. ①을 권장한다.
- 상태: 라운드 2 표 참조

### QA-S3-09 [Minor] 취소 요청 뒤 실패한 작업을 재시도하면 곧바로 `canceled`가 됨
- 담당: db-engineer
- 근거: `20261026000100_s3_ai_jobs.sql:84-87` `failed → queued` 때 `error_code`·`finished_at`만 비우고 `cancel_requested_at`은 남긴다. app_ai_writer는 이 컬럼을 update할 수 없다(`:129-130`). 재시도 후 점유하면 `runner.ts:268`이 즉시 `canceled` 처리한다. 상태 응답은 이 작업에 `canRetry: true`를 준다. 경로: 실행 중 취소 요청 → 다음 heartbeat 전에 단계가 비재시도 오류로 실패, 또는 취소 요청된 작업이 멈춤 처리됨.
- 수정 제안: 가드 트리거의 `failed → queued` 분기에서 `new.cancel_requested_at := null`. pgTAP 1건 추가.
- 상태: 라운드 2 표 참조

## 거절 대체 [가정]에 대한 QA 의견 (spec-gaps 2026-10-26 "거절(refusal) 처리와 서버 측 대체 모델")
- **스펙과 다르다.** C-6은 거절을 "실패로 처리하고 재시도 안내"라고 하고, 대체 모델은 "장애 시"에만 둔다. 서버 측 대체를 켜면 사용자에게 보이는 동작이 바뀐다(거절이 대부분 성공으로 바뀌고, 결과 모델이 품질 평가(6장) 대상 모델과 다를 수 있음). 그러니 [가정]으로 두고 사용자 결정을 받는 처리는 맞다.
- **켜는 쪽이 낫다고 본다.** 이유:
  1. 경력·JD 데이터에서 나는 거절은 대부분 분류기 오탐이다(보안·생명과학 직무 JD 등). 대체로 살리는 편이 "재시도 안내"보다 사용자에게 낫다.
  2. 대체 모델 출력도 같은 V-1~V-8 검증을 거쳐 저장되므로 근거 보장은 그대로다.
  3. 스트리밍 중간 거절에서도 API가 부분 출력 뒤에 이어 쓰므로, 텍스트 블록을 이어 붙이는 현재 방식(`anthropic-client.ts:61-64`)으로 JSON이 유지된다.
- **켜 둔다면 조건이 있다.** QA-S3-07 세 가지(`refused` 자동 재시도 제외, iterations 기준 토큰·`fallbackUsed`)를 고치고, 결과·`ai_jobs.model`에 실제 응답 모델을 남기는 것은 기능 슬라이스가 지켜야 한다.
- **`input_hash`는 그대로 둔다.** 해시는 요청 모델 기준이라, 대체 모델 결과도 같은 입력의 결과로 재사용된다. 의도와 맞다.

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- 새로 넘긴 항목 없음. QA-S3-03(진행 중 중복 시작)은 스펙이 다루지 않지만, 차감 규칙(PRD 6.4/6.5)의 취지로 판단 가능한 구현 문제라 담당자 이슈로 남겼다.
- 기존 2026-10-26 S3 항목(step_outputs, target_type·전이 가드, 근거 저장 직전 원본 삭제, 보유 기간, 미분류 예외 코드, refused 재시도, 수동 재시도 사용량, career_snapshot_hash, 거절 대체, V-5 세부, 미등록 자리 표시)의 구현이 노트·코드와 일치함을 확인했다. "refused 자동 재시도 포함" [가정]은 거절 대체를 켠 상태와 같이 두면 맞지 않는다 → QA-S3-07.

## 남은 위험 (이슈 아님, 리더 참고)
- Vercel Cron 미설정 + Hobby 하루 1회: 실패 작업의 누수 예약은 크론만 정리한다(QA-S3-01 ②의 원인). 상태 조회의 지연 감지는 진행 중 작업만 처리한다.
- Vercel Preview는 Deployment Protection이 기본으로 켜져 있어 `/continue` 자기 호출이 401로 막힐 수 있다. 그러면 폴링 대체 경로(10초 유예)로만 이어 실행된다. 배포 때 우회 헤더나 보호 설정을 확인해야 한다.
- 함수 실행 예산은 `runJob` 시작부터 잰다(55초). 앞의 라우트 처리 시간은 Vercel 60초 한도에 들어가지만 예산에는 빠진다. 5초 여유로 덮이는 수준이다.

## 라운드 후 조치 (리더, 2026-10-26)
- QA-S3-06 → **해결**: ai-pipeline-engineer가 프로필 근거 스냅샷 시각을 `profiles.updated_at`으로 바꿨다. 리더가 `run-checks.sh --build`를 다시 실행해 5종 모두 PASS를 확인했다.
- QA-S3-10, QA-S3-12 → **열림 (Minor)**: 실행기를 다시 손보는 S4에서 api-engineer가 처리한다.
- QA-S3-11 → **S4 규칙**: 스트림 정산은 "결과가 저장됐는가"로 판정한다(`aborted`여도 저장됐으면 확정).
