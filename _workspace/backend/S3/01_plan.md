# S3 AI infrastructure 계획

## 범위
- 기획 근거: DM §2.8–2.9, 부록 A.14–A.16, §5(app_ai_writer 쓰기 권한) / AI C-1~C-9 / PRD 6.4·6.5(사용량·실패 시 무차감)
- 테이블: `ai_jobs`, `usage_events`, `usage_limits`, `evidence_links`
- 트리거: 근거 원본 삭제 → `evidence_links.quote = null`, `source_deleted_at = now()`(커리어 7개 테이블 + profiles는 해당 없음. JD·면접 답변·메모 원본은 해당 슬라이스에서 추가)
- AI 공통 모듈: Anthropic 클라이언트, 경력 팩(C-1), JD 컨텍스트 순수 함수(C-2), 검증기 V-1~V-8 + 자리 표시(C-5), evidence_links 매핑, 증분 JSON → SSE 블록 이벤트(C-6), input_hash
- 작업 실행기: ai_jobs 수명 주기, `after()` 단계 실행, heartbeat, 멈춤 감지, 재시도 1회, 사용량 원장(예약 → 확정/해제)
- **실제 AI 기능(AI-xx)은 없다.** 실행기와 스트리밍은 테스트용 가짜 단계/가짜 모델로 끝까지 검증한다.
- 연결: S3는 화면 연결 대상 없음.

## 앞 슬라이스 규칙
- `private` 헬퍼, `private.current_uid()`(app_ai_writer 정책·함수), 기본 권한 회수 → 모든 테이블·함수에 grant 명시, `grants.test.sql` 허용 목록 갱신(S4 전에 app_ai_writer 쓰기가 처음 생기므로 "쓰기 없음" 검사를 허용 목록 방식으로 바꾼다).
- 첫 호출 권한 회귀 테스트(`career_first_call_privileges` 방식)를 S3 테이블·RPC에도 둔다.

## 계약 초안 — DB
### 앞 슬라이스 테이블이 아직 없는 FK
- `ai_jobs.application_project_id`, `evidence_links.application_project_id`는 S5 `application_projects`를 가리킨다. **S3에서는 uuid 컬럼만 두고 FK는 S5에서 추가**(S2 `source_writing_chat_id`와 같은 방식). `evidence_links.application_project_id`는 DM상 cascade 소유 키라 not null이어야 하지만, S3에는 행을 넣는 기능이 없으므로 not null로 만든다.
### ai_jobs (A.15)
- 컬럼·CHECK는 A.15 그대로. `error_category` generated: transient = (`model_unavailable`, `rate_limited`, `schema_invalid`, `refused`), input = (`not_a_jd`, `insufficient_data`, `input_too_long`), timeout = (`timeout`, `stalled`), canceled = (`canceled`).
- RLS: 사용자 select 본인. 사용자 직접 insert/update 없음 — 생성은 서버가 app_ai_writer로, 취소 요청은 RPC `request_ai_job_cancel(p_job_id)`(security invoker이면 update grant가 필요하므로 **security definer + 소유 검사**, `cancel_requested_at`만 설정).
- app_ai_writer: insert, select, update(`status`, `progress`, `attempt_count`, `error_code`, `input_hash`, `prompt_version`, `model`, `usage`, `output`, `heartbeat_at`, `started_at`, `finished_at`). delete 없음.
- 인덱스: `(user_id, application_project_id, job_type, input_hash) where status = 'succeeded'`(C-6 재사용), `(status, heartbeat_at) where status in ('queued','running')`(멈춤 감지).
### usage_events / usage_limits (A.16)
- `period_month` = KST 월 1일. 사용자 select 본인, 쓰기 없음.
- 원장 RPC (app_ai_writer만 실행, security invoker — app_ai_writer insert/update grant 사용):
  - `reserve_usage(p_feature text, p_units int, p_reason text, p_ai_job_id uuid) returns uuid` — 같은 사용자·월에 `pg_advisory_xact_lock`으로 직렬화, `reserved + charged` 합계 + units > 한도면 `P0001 usage_limit_reached`. 한도는 `usage_limits`에서 `plan = 'free'`, 현재 시행 중인 행.
  - `charge_usage(p_usage_event_id uuid)`, `release_usage(p_usage_event_id uuid)` — `reserved`에서만 전이, 그 외는 `P0001 invalid_usage_transition`(이미 같은 상태면 멱등 성공).
  - 사용자용 조회 RPC `get_usage_summary() returns jsonb` — 기능별 `{ limit, used, remaining }`(이번 달, reserved 포함). UI "이번 달 {N}회 남음".
- `usage_limits` 초기 행(free): insight 10, draft 20, interview_session 5, writing_chat 10. `chat_message`는 D-12 미정 → 행 없음 = 한도 없음? → **행이 없으면 예약 거부(`usage_limit_missing`)** [가정 → spec-gaps].
### evidence_links (A.14, §2.8)
- 컬럼·CHECK A.14 그대로. 사용자 select 본인. app_ai_writer insert/select. 사용자·AI 모두 update 없음(삭제 트리거는 security definer).
- 삭제 트리거: 커리어 7개 테이블 after delete → `update evidence_links set quote = null, source_deleted_at = now() where user_id = old.user_id and source_type = <type> and source_id = old.id`. `project_skills`는 근거 원본 타입이 아니므로 제외(skill은 `skills` 삭제로 처리).
- 결과 단위 삭제(인사이트 등)는 owner 쪽 슬라이스에서.
### get_deletion_impact 확장
- S2 RPC의 `affected_results`는 결과 테이블이 S5 이후라 그대로 `[]`. S3에서는 바꾸지 않는다.

## 계약 초안 — AI (`src/server/ai/`)
- `client.ts`: 모델 id 상수(default `claude-sonnet-5-5`, light `claude-haiku-5-5`, heavy `claude-opus-5-5`), 대체 모델 설정, SDK 오류 → C-6 `error_code` 매핑, `usage`·지연 기록. **구조화 출력은 AI 명세 C-4대로 `output_config.format`(JSON 스키마)** — 하네스 스킬의 "강제 tool" 지침과 다르다. claude-api 스킬로 현재 SDK 지원을 확인하고 노트에 적는다. 테스트는 가짜 클라이언트(인터페이스 주입).
- `context-pack/`: `buildCareerPack(rows) → { text, aliases: Map<alias, {type, id}>, careerSnapshotHash }` 결정적(같은 입력 → 같은 바이트). complete 행만, draft 부모의 자식 제외, `display_name` 제외, `learnings`는 `<reflection>`. 행은 app_ai_writer로 허용 컬럼만 읽는 로더 `loadCareerRows(aiWriterClient)`와 분리.
- JD: `splitJdSentences(raw) → [{sid, text, start, end}]` 순수 함수(C-2), `buildJdContext(sentences, requirements)` 별칭 `REQ-n`. 테이블은 S5.
- `validation/`: V-1~V-5, V-7, V-8 순수 함수와 `validationReport` 집계. V-3 70% 임계값과 정규화 규칙은 상수로. V-5 수치 가드는 허용 수치 집합(팩·JD·답변 + 날짜에서 계산되는 연차·기간) 생성 함수 포함, learnings 숫자 제외. C-5 자리 표시 토큰 6종과 개수 일치 검사. V-6은 zod 파싱 래퍼(1회 재시도는 실행기 쪽 정책과 합의).
- `evidence/`(또는 validation 안): 검증된 근거 → `evidence_links` 행 매핑(alias → UUID, `source_snapshot_at`, `source_label`, `source_locator`).
- `streaming/`: 증분 JSON 파서 → 블록 이벤트(`block_started`, `block_delta`, `block_completed`, `validated`, `done`, `error`).
- `input-hash.ts`: `hash(feature, prompt_version, model, career_snapshot_hash, requirements_hash, params)` — 정규화된 JSON의 SHA-256.

## 계약 초안 — API (`src/server/jobs/`, `src/lib/contracts/`)
- `jobs/ledger.ts`: reserve / charge / release 래퍼. **모든 종료 경로에서 해제**(성공 확정, 실패·취소·멈춤·예외 해제). 실패 경로 테스트 필수.
- `jobs/runner.ts`: 단계 레지스트리 `registerJobType(jobType, { steps: [{ stage, total?, run(ctx) }], usage?: {feature, units} })`. `startJob({ userId, jobType, target, applicationProjectId, params, inputHash })`: ① readiness·한도는 호출자가 먼저 확인(`insufficient_data`는 작업 생성 없음) ② input_hash 재사용 조회 → 있으면 `{ reused: true, jobId }` ③ ai_jobs insert(`queued`) + reserve ④ `after(() => runJob(jobId))`. `runJob`: 단계마다 `running`, `progress`, `heartbeat_at`, 단계 결과 보존(재시작 시 완료 단계 건너뜀), 일시 오류 1회 재시도(`attempt_count`), 취소 요청 확인, 성공 → `succeeded` + charge, 실패 → `failed` + release. 한 함수 실행 60초 미만: 단계가 끝날 때 남은 단계가 있고 경과 시간이 임계값을 넘으면 다음 `after()`로 이어 실행(self-invoke 경로 필요 여부를 Next 16 문서로 확인).
- 멈춤 감지: `heartbeat_at`이 N분(상수, 2분 [가정]) 넘게 갱신 안 된 running/queued 작업 → `failed`/`stalled` + release. 실행 위치: 작업 상태 조회 시 지연 감지 + Vercel Cron `/api/cron/stalled-jobs`(`CRON_SECRET` Bearer). cron은 여러 사용자를 보므로 service role이 필요할 수 있다 → backend-context 규칙대로 `src/server/jobs/` 한 모듈에만 두고 이유를 적는다.
- 작업 상태: `GET /api/ai-jobs/[id]` → UI `useAiJob` 모양 `{ status, progress, partial, error: { code, category } | null }`(+ `jobId`). `POST /api/ai-jobs/[id]/cancel` → RPC.
- SSE 헬퍼 `src/server/sse.ts`(또는 `jobs/sse.ts`): 이벤트 직렬화, 하트비트 주석, abort 처리. 이벤트 타입은 `src/lib/contracts/ai.ts`에 zod/TS로(UI `useAiStream` `{ blocks, status, error, cancel }`가 바로 쓸 수 있게).
- 사용량 조회 Server Action `getUsageSummary()`.
- contracts `enums.ts`: `AI_JOB_TYPES`, `AI_JOB_STATUSES`, `AI_ERROR_CODES`(S0 것과 대조), `ERROR_CATEGORIES`, `USAGE_FEATURES`, `USAGE_STATUSES`, `USAGE_REASONS`, `EVIDENCE_OWNER_TYPES`, `EVIDENCE_SOURCE_TYPES`.

## 인터페이스 합의 (api ↔ ai)
- 단계 함수 시그니처: `run(ctx: { jobId, userId, params, previous: Record<stage, unknown>, ai: AiClient, db: AiWriterClient, signal: AbortSignal, reportProgress(done, total) }) → Promise<unknown>`.
- 스트리밍 파이프라인: `stream(input, ctx) → AsyncIterable<AiStreamEvent>`. 두 엔지니어가 노트에 최종안을 적는다. 다르면 리더가 정한다.

## 작업 순서
- 세 명 병렬. db는 마이그레이션 + 타입 먼저. ai는 순수 함수부터(타입 의존은 매핑 단계뿐). api는 contracts·SSE·실행기(가짜 의존성 주입)부터, 타입이 나오면 원장·상태 조회 연결.
- QA: 전체 + `--build`.

## 원격 브랜치 적용: 하지 않음
