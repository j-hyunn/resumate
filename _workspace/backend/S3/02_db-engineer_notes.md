# S3 DB 구현 노트

> 상태: QA 라운드 1 반영 완료. `supabase db reset` OK, `supabase test db` PASS(14파일 489개), 타입 재생성. `pnpm typecheck`/`pnpm test`는 api-engineer가 실행기를 새 시그니처로 바꾸는 중이라 `src/server/jobs/*`·`src/test/job-fakes.ts`에서 실패(DB 원인 아님).

## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261026000100_s3_ai_jobs.sql` | ai_jobs + `step_outputs` + 상태 전이 가드 트리거 + RLS + grant |
| `supabase/migrations/20261026000200_s3_usage.sql` | usage_limits(초기 4행) + usage_events + RLS + grant, `private.current_usage_period()` |
| `supabase/migrations/20261026000300_s3_evidence_links.sql` | evidence_links + insert 가드 + 커리어 6개 테이블 삭제 트리거 + RLS + grant |
| `supabase/migrations/20261026000400_s3_usage_rpcs.sql` | `reserve_usage`, `charge_usage`, `release_usage`, `charge_usage_for_job`, `release_usage_for_job`, `get_usage_summary` |
| `supabase/migrations/20261026000500_s3_ai_job_rpcs.sql` | `request_ai_job_cancel`, `sweep_stalled_ai_jobs` |
| `supabase/migrations/20261026000600_s3_complete_ai_job.sql` | `complete_ai_job` 신설, `sweep_stalled_ai_jobs` 교체(succeeded 작업의 남은 예약 확정 추가) — decisions.md 2026-10-26 |

## 테이블·컬럼 (스펙 대비 차이 포함)

### ai_jobs (A.15)
- 컬럼 A.15 그대로 + `step_outputs jsonb not null default '{}'`(리더 승인, 단계 체크포인트) + `created_at`, `updated_at`(트리거). `unique (id, user_id)`(이후 결과 테이블 복합 FK용).
- `user_id` 기본값 `private.current_uid()`(app_ai_writer는 `auth.uid()`를 못 부름) — insert 때 생략 가능.
- `application_project_id`: uuid만, FK(cascade)는 S5.
- `target_type`: 스펙에 값 목록이 없어 CHECK 없음(자유 text). `writing_chat_turn`이면 `target_type = 'writing_chat'` + `application_project_id is null` CHECK(DM §2.9).
- `error_category` generated: transient(`model_unavailable`,`rate_limited`,`schema_invalid`,`refused`) / input(`not_a_jd`,`insufficient_data`,`input_too_long`) / timeout(`timeout`,`stalled`) / canceled(`canceled`), 그 외 null.
- `progress`는 null 또는 object, `params`·`step_outputs`는 object, `attempt_count >= 0`.
- **상태 전이 가드 트리거 `ai_jobs_guard_status`** [구현 결정, 스펙 침묵]:
  - `succeeded`, `canceled`: 종료. status 변경 시 `P0001 invalid_ai_job_transition`.
  - `failed`: `queued`로만(명시적 재시도). 이때 `error_code`, `finished_at`을 null로 비운다.
  - `queued`/`running`: 어느 상태로든.
  - status가 그대로인 update(heartbeat, progress, step_outputs 등)는 항상 허용.
  - `running` 진입 시 `started_at`이 비어 있으면 now(), 종료 상태 진입 시 `finished_at`이 비어 있으면 now().
  - 목적: 크론이 stalled로 실패 처리한 뒤 살아난 실행기가 `succeeded`로 덮어쓰는 것을 막는다(그 경우 실행기는 이 오류를 받고 결과를 버려야 한다. 사용량은 이미 released).
- 인덱스: `(user_id, application_project_id, job_type, input_hash) where status='succeeded'`, `(status, heartbeat_at) where status in ('queued','running')`, `(user_id, created_at desc)`, `(application_project_id)`.

### usage_limits / usage_events (A.16)
- usage_limits: `plan`(CHECK `free`), `feature`, `monthly_limit >= 0`, `effective_from`, `unique (plan, feature, effective_from)`. 초기 4행 effective_from `2026-10-01 00:00+09`: insight 10, draft 20, interview_session 5, writing_chat 10. `chat_message` 행 없음 → 예약 거부 [가정].
- usage_events: `feature`, `units >= 1`(기본 1), `period_month`(KST 월 1일 CHECK), `status`(기본 reserved), `ai_job_id`(soft, FK 없음 — 실행기가 작업 행보다 먼저 예약), `reason`(기본 initial). `unique (id, user_id)`.
- **직접 쓰기 경로 없음**: 사용자·app_ai_writer 모두 select만. 쓰기는 security definer RPC로만(한도·전이 규칙 우회 불가). 계획(invoker + insert/update grant)과 다름 — 시그니처는 같다.
- 인덱스 `(user_id, period_month, feature) where status in ('reserved','charged')`, `(ai_job_id) where not null`.

### evidence_links (A.14, §2.8)
- 컬럼 A.14 그대로 + `created_at`, `updated_at`. `application_project_id not null`(FK는 S5), `owner_id`·`source_id` not null(soft).
- CHECK: `owner_type` 6종, `source_type` 11종, **`source_field`를 source_type별 허용값으로 제한**(C-3 표 = V-2를 DB도 강제. jd·답변·메모는 null만) [구현 결정], `source_locator`는 null 또는 object, `source_deleted_at`이 있으면 `quote`는 null.
  - 허용 필드: profile(`desired_job_title`,`total_years_of_experience`,`interested_industries`), experience(`job_rank`,`job_position`,`department`,`summary`,`period`), education(`institution_name`,`program_name`,`education_type`,`enrollment_status`,`period`,`description`), project(`name`,`role`,`team_size`,`summary`,`period`), project_detail(`title`,`situation`,`task`,`action`,`result`,`learnings`), achievement(`metric`,`description`), skill(`name`).
- **insert 가드 `evidence_links_check_source`** [구현 결정]: 커리어 6종 + profile 원본이 없거나 다른 사용자 것이면 insert는 성공하되 `quote = null`, `source_deleted_at = now()`로 저장(팩 생성 후 저장 전 원본 삭제 경쟁 → 삭제된 원문 인용이 남지 않게). JD·답변·메모는 해당 슬라이스에서.
- **삭제 트리거** `private.evidence_mark_source_deleted(source_type)`: experiences, educations, projects, project_details, achievements, skills **after delete** → 그 원본을 가리키는 링크 `quote = null`, `source_deleted_at = now()`(이미 표시된 행은 그대로). project_skills는 근거 원본 타입이 아니어서 제외. 연쇄 삭제(경력 → 프로젝트 → 상세 내용 → 성과)도 행마다 동작.
- 인덱스 `(owner_type, owner_id)`, `(user_id, source_type, source_id)`, `(application_project_id)`.

## RPC 시그니처와 반환 형태
오류는 `errcode` / `message`(소문자). 생성 타입: `Database['public']['Functions'][name]`.

### 사용량 원장 — app_ai_writer만 실행, security definer, JWT 사용자(`auth.uid()`) 행만
| 함수 | 반환 | 오류 |
|------|------|------|
| `reserve_usage(p_feature text, p_units int default 1, p_reason text default 'initial', p_ai_job_id uuid default null)` | `uuid`(usage_event id) | `42501 not_authenticated`, `P0001 invalid_usage_feature`, `invalid_usage_units`(<1/null), `invalid_usage_reason`, `usage_limit_missing`(한도 행 없음 = chat_message), `usage_limit_reached`(detail = `{"feature","limit","used"}` JSON 문자열) |
| `charge_usage(p_usage_event_id uuid)` | `void` | `42501 not_authenticated`, `P0001 usage_event_not_found`(없음·남의 것), `invalid_usage_transition`(released → charged). charged에 다시 호출 = 성공(멱등) |
| `release_usage(p_usage_event_id uuid)` | `void` | 같음(charged → released는 `invalid_usage_transition`). released에 다시 = 성공 |
| `charge_usage_for_job(p_ai_job_id uuid)` | `integer`(reserved → charged로 바뀐 행 수) | `42501 not_authenticated`. 행이 없거나 이미 정산됐으면 0(멱등, 오류 아님) |
| `release_usage_for_job(p_ai_job_id uuid)` | `integer`(reserved → released 행 수) | 같음 |

- reserve 규칙: `pg_advisory_xact_lock(사용자, KST 월, feature)`로 직렬화 → 시행 중 최신 `usage_limits`(plan free, `effective_from <= now()`) → 이번 달 `reserved + charged` 합 + units > 한도면 거부. 동시 예약은 트랜잭션 커밋까지 대기하므로 한도를 넘지 않는다.
- reserve는 **멱등이 아니다**: 같은 `p_ai_job_id`로 두 번 부르면 2행. 재시도 시 호출자가 막을 것.
- 예약 후 ai_jobs insert가 실패하면 실행기가 `release_usage(id)` 또는 `release_usage_for_job(jobId)`로 즉시 해제할 것(놓치면 크론이 정리 — 아래).
- 타입: `Args: { p_feature: string; p_units?: number; p_reason?: string; p_ai_job_id?: string }; Returns: string` 등. `charge_usage`/`release_usage`의 Returns는 `undefined`.

### `complete_ai_job(p_job_id uuid, p_usage_event_id uuid, p_attempt_count int, p_progress jsonb default null) returns integer` (QA-S3-01/05 최종)
- security definer, app_ai_writer만 실행. 소유 검사 `private.current_uid()`. 생성 타입 `Args: { p_job_id: string; p_usage_event_id: string; p_attempt_count: number; p_progress?: Json }; Returns: number` — null 예약을 보내려면 `null as unknown as string` 단언 필요(gen types가 null 허용을 모름).
- 한 트랜잭션:
  1. 작업 행 잠금. 없거나 남의 것 → `P0001 ai_job_not_found`.
  2. `attempt_count <> p_attempt_count`(null 포함) 또는 상태가 running/succeeded가 아니면 → `P0001 invalid_ai_job_transition`.
  3. running이면 `succeeded` + `finished_at = now()` + `p_progress`가 있으면 progress 교체. **이미 succeeded이고 세대가 같으면 재호출로 보고 상태 변경 없이 진행**(네트워크 재시도 멱등) [구현 결정].
  4. `p_usage_event_id` null → 반환 0(사용량 없는 작업).
  5. 예약은 같은 사용자 + `ai_job_id = p_job_id`여야 함(아니면 `usage_event_not_found`). reserved → charged 반환 1, 이미 charged 반환 0, released → `invalid_usage_transition`.
- 어떤 오류든 전체 롤백(상태·사용량 그대로). 그 작업의 다른 예약은 건드리지 않는다.
- `charge_usage_for_job`·`release_usage_for_job`·`release_usage(id)`는 그대로 있다.

### ai_jobs 가드 추가 (QA-S3-05, 09)와 진행 중 중복 인덱스 (QA-S3-03)
- `attempt_count`가 줄어드는 update → `P0001 invalid_ai_job_transition`(detail `attempt_count a -> b`). 같은 값·증가는 허용.
- `failed → queued`에서 `cancel_requested_at`도 null로 비운다.
- 부분 유니크 인덱스 `ai_jobs_in_flight_input_key`: `(user_id, coalesce(application_project_id, '0…0'), job_type, input_hash) where status in ('queued','running') and input_hash is not null`. 충돌 시 `23505`. 재시도(`failed → queued`)도 같은 입력의 진행 중 작업이 있으면 23505가 난다.

### `get_usage_summary() returns jsonb`
- security invoker, stable. 실행: authenticated, app_ai_writer.
- 반환(시행 중 한도 행이 있는 기능만, 이번 KST 월, reserved 포함):
```json
{ "draft": { "limit": 20, "used": 0, "remaining": 20 },
  "insight": { "limit": 10, "used": 2, "remaining": 8 },
  "interview_session": { "limit": 5, "used": 0, "remaining": 5 },
  "writing_chat": { "limit": 10, "used": 1, "remaining": 9 } }
```
- `remaining = max(limit - used, 0)`. 오류 `42501 not_authenticated`.

### `request_ai_job_cancel(p_job_id uuid) returns jsonb`
- security definer + 소유 검사. 실행: authenticated만.
- `queued`/`running`이고 아직 요청 전이면 `cancel_requested_at = now()`. 이미 요청됐거나 종료 상태면 변경 없이 현재 값 반환(멱등).
- 반환 `{ "job_id": "uuid", "status": "running", "cancel_requested_at": "timestamptz | null" }`.
- 오류 `42501 not_authenticated`, `P0001 ai_job_not_found`(없음·남의 것).
- 실행기는 `cancel_requested_at`을 보고 `canceled`(+ `error_code = 'canceled'` 권장) + `release_usage_for_job`.

### `sweep_stalled_ai_jobs(p_stalled_before timestamptz) returns integer`
- security definer, **service_role만** 실행. 반환: 실패 처리한 작업 수.
- ① `status in (queued, running)`이고 `coalesce(heartbeat_at, created_at) < p_stalled_before` → `failed`, `error_code = 'stalled'`, `finished_at = now()` ② 그 작업들의 reserved 사용량 → released ③ **누수 예약 정리**: `ai_job_id`가 있고 `created_at < p_stalled_before`인 reserved 행 중, 작업 행이 없거나(예약 후 insert 실패) 작업이 failed/canceled인 것 → released. succeeded 작업의 reserved는 건드리지 않는다.
- ③ 변경(QA 라운드 1): 누수 예약 정리 대상 = 작업 행이 없거나 작업이 **queued/running이 아닌 모든 경우(succeeded 포함)** → released. 이전 ④ "succeeded 작업의 남은 예약 → charged"는 **제거**했다. `complete_ai_job`이 이긴 예약을 같은 트랜잭션에서 확정하므로, succeeded 작업에 남은 reserved는 진 쪽(중복) 예약이고 확정하면 QA-S3-01 ②의 이중 차감이 된다.
- 한 트랜잭션. 오류 `P0001 invalid_stalled_before`(null).

## RLS·권한 요약 (DM §5 대비)
| 테이블 | authenticated | app_ai_writer | anon |
|--------|---------------|---------------|------|
| ai_jobs | select 본인, **컬럼 단위**(`params`, `step_outputs` 제외 — QA-S3-08, `select *` 불가) | select·insert·update 본인. insert 컬럼: id, user_id, job_type, application_project_id, target_type, target_id, status, progress, params, step_outputs, attempt_count, error_code, input_hash, prompt_version, model, usage, output, heartbeat_at, started_at, finished_at. update 컬럼: status, progress, step_outputs, attempt_count, error_code, input_hash, prompt_version, model, usage, output, heartbeat_at, started_at, finished_at. delete 없음 | 없음 |
| usage_events | select 본인 | select 본인. 쓰기는 RPC만 | 없음 |
| usage_limits | select 전체 | select 전체 | 없음 |
| evidence_links | select 본인 | select·insert 본인(insert 컬럼: `source_deleted_at` 제외 전부). update·delete 없음 | 없음 |

- api 요청 (4) 확인: app_ai_writer update grant에 `status, heartbeat_at, attempt_count, started_at, progress, error_code, finished_at, step_outputs` 모두 포함. `cancel_requested_at`, `params`, `target_*`, `user_id`는 update 불가.
- `step_outputs`·`params` 사용자 select: QA-S3-08로 제외(컬럼 grant). src/에 사용자 세션의 ai_jobs 조회는 없다(통합 테스트의 `select('*')`는 service role).
- QA-S3-06: app_ai_writer에 `profiles.updated_at` select 추가(프로필 근거 스냅샷).
- app_ai_writer는 `select *`가 ai_jobs·usage_events·evidence_links에서 가능(테이블 단위 select). profiles는 여전히 컬럼 단위.

## 테스트 (`supabase test db` 결과)
**Files=13, Tests=443, PASS** (S3 신규 4파일 + grants 갱신).
- `supabase/tests/ai_jobs.test.sql`: RLS·정책 목록, app_ai_writer insert(기본 user_id)·남의 user_id 거부·`cancel_requested_at`/`params` 쓰기 거부·delete 거부, CHECK(job_type, error_code, writing_chat_turn), 조건부 update로 점유 + started_at 자동, error_category, **전이 가드**(failed→succeeded/running 거부, failed→queued 허용 + 오류 초기화, succeeded 종료, 종료 행의 비상태 update 허용), A/B 격리(app_ai_writer·authenticated), 사용자 쓰기 거부, `request_ai_job_cancel`(설정·첫 시각 유지·종료 작업 무변경·없음/남의 것·sub 없음), 실행 권한(app_ai_writer·anon·authenticated sweep 불가), **sweep**(두 사용자 stalled 실패, 새 heartbeat 유지, 해당 reserved 해제, 누수 예약 해제, 최근 예약·charged 유지, 2회차 0, null 오류), 멈춤 후 실행기 succeeded 거부, anon 거부, 탈퇴 cascade.
- `supabase/tests/usage_ledger.test.sql`: RLS·정책, 초기 한도 4행, KST 월, 원장 함수 실행 권한(사용자 불가), app_ai_writer 직접 쓰기 거부, reserve 검증 오류 5종, advisory lock 보유, 한도(units 합, 정확히 한도까지 허용, 초과 거부), release 후 여유 복구, charge/release 멱등과 반대 전이 거부, 없는 이벤트, `*_for_job`(행 수·멱등·다른 작업 영향 없음), summary 형태·키, B 격리(남의 이벤트·작업 정산 불가, 자기 한도), sub 없음, 지난 달 미집계·미래 한도 미적용·새 한도 행 적용, 사용자 읽기만, period_month CHECK, 탈퇴 cascade.
- `supabase/tests/evidence_links.test.sql`: RLS·정책, 삭제 트리거 6개 존재, 11종 source_type insert, CHECK(source_field 허용값·필드 필요·jd 필드 없음·writing_chat_message 불가·owner_type), `source_deleted_at` 쓰기 거부, 남의 user_id 거부, update/delete 거부, **insert 가드**(없는 원본·남의 원본 → 삭제 표시, 인용문 없음), 사용자 쓰기 거부, **테이블별 삭제 트리거**(project_details, achievements, skills, educations, experiences, `delete_career_item` 연쇄로 projects·상세 내용), 형제·비커리어 링크 유지, 삭제 링크에 인용문 없음, 탈퇴 cascade.
- `supabase/tests/s3_first_call_privileges.test.sql`: 첫 호출을 실제 역할로 — authenticated(summary, 읽기, 취소, 원본 삭제 트리거), app_ai_writer(summary → reserve → ai_jobs insert → 점유 → evidence insert → succeeded → charge_for_job, release_for_job, charge/release), service_role(sweep).
- `supabase/tests/complete_ai_job.test.sql`: 실행 권한(app_ai_writer만), running → succeeded + 예약 2건 확정 + progress·finished_at, 재호출 0(멱등)·progress 유지, 예약 없는 작업 0, queued/failed 거부(사용량 그대로), 없는 작업, succeeded 작업의 늦은 예약을 재호출로 확정, B가 A 작업 완료 불가(작업·사용량 불변), sub 없음, sweep이 succeeded 작업의 오래된 예약만 확정(최근 예약·running 작업 예약 유지).
- `supabase/tests/grants.test.sql`(10개): **app_ai_writer 쓰기 검사를 허용 목록으로 전환** — 컬럼 단위 INSERT/UPDATE/REFERENCES가 정확히 ai_jobs(insert 20·update 13컬럼) + evidence_links(insert 15컬럼). 테이블 단위는 커리어 7개 + S3 4개 SELECT. authenticated는 S3 테이블 쓰기 없음, app_ai_writer는 usage_events 직접 쓰기 없음. app_ai_writer 실행 가능 함수 = get_data_readiness, get_usage_summary, reserve/charge/release_usage, charge/release_usage_for_job, complete_ai_job.
- **실제 동시성 확인**(pgTAP 밖, 로컬 psql 두 세션): 9/10 사용 상태에서 두 세션이 동시에 `reserve_usage('insight')` → 둘째 세션은 첫째 커밋까지 대기한 뒤 `usage_limit_reached`(detail used 10). 결과 reserved 1 + charged 9. 테스트 사용자는 지웠다.

## 원격 브랜치 적용 여부
하지 않음(계획대로 로컬 전용).

## 스펙 차이·가정
- 기존 계획 항목 그대로: `chat_message` 한도 행 없음 → `usage_limit_missing`, application_project_id FK는 S5.
- 구현 결정(노트에만): ai_jobs 상태 전이 가드, `target_type` CHECK 없음, evidence `source_field` CHECK, evidence insert 가드, usage_events 직접 쓰기 없음(definer RPC), sweep의 누수 예약 정리, reserve 비멱등.

## QA 라운드 1 반영 (2026-10-26)
S3 파일 안에서 수정(로컬 전용·미커밋): `20261026000100`(가드·인덱스·사용자 컬럼 grant), `20261026000300`(profiles.updated_at grant), `20261026000600`(complete_ai_job 4인자, sweep).
- QA-S3-01: `complete_ai_job` 예약 id 단위 + 세대 검사. sweep의 succeeded 남은 예약 확정 → 해제로 변경(리더 확인 필요 — 위 sweep ③).
- QA-S3-03: 진행 중 중복 부분 유니크 인덱스. QA-S3-05: attempt_count 감소 금지. QA-S3-06: grant. QA-S3-08: 컬럼 grant. QA-S3-09: 재시도 시 취소 요청 비움.
- 테스트: `complete_ai_job.test.sql` 재작성(세대 불일치·null, 예약 1건만 확정, 같은 세대 재호출 0, 다른 세대 거부, 다른 작업 예약·해제된 예약 거부 + 롤백, null 예약, queued 거부, B 교차 거부, sweep이 진 예약 해제·이긴 예약 유지·최근 예약 유지), `ai_jobs.test.sql`(사용자 step_outputs·params·`select *` 거부, 재시도 시 cancel 비움, attempt_count 감소 거부, 진행 중 중복 23505·다른 지원 프로젝트/사용자/null 해시 허용·종료 후 허용), `grants.test.sql`(12개: profiles.updated_at, ai_jobs 사용자 컬럼 grant), first-call(새 시그니처). **Files=14, Tests=489 PASS.**
