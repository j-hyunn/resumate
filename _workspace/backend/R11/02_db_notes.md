# R11 DB 구현 노트 (db-engineer, 2026-11-05)

기준: DM v4.11 11.6 #1~#5·#7~#9·#11·#12, 2.7.2, A.12 "점수 산식 d14.v1", 2.5.1, 2.11.6 / AI v4.11 4.2·4.3.
로컬만 적용(`supabase migration up --local`), 원격 반영·`db push` 안 함, 커밋 안 함.

## 마이그레이션 파일 (모두 신규, `20261113000400` 뒤)

| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261113000500_r11_interview_detach_schema.sql` | OD-I6 스키마: `interview_sessions.application_project_id` null 허용, FK `interview_sessions_application_project_fkey` → `on delete set null (application_project_id)`, `company_name_snapshot`·`position_title_snapshot`(text null, 1~200자 CHECK), `interview_sessions_detached_check`, `evidence_links.application_project_id` null 허용 + `evidence_links_detached_check`(null이면 owner_type ∈ 면접 3종). evidence FK는 cascade 그대로 |
| `…000600_r11_application_projects_detach_interviews.sql` | `private.application_projects_detach_interviews()`(security definer, `search_path = ''`, 외부 execute 없음) + `BEFORE DELETE` 행 트리거 `application_projects_detach_interviews` |
| `…000700_r11_interview_read_only_guard.sql` | `private.interview_grading_decision`(분리 세션 = `none`), `begin_interview_evaluation`(읽기 전용 가드), `create_interview_session`(재시도 id 비교 `is distinct from`) |
| `…000800_r11_deletion_impact_application_project.sql` | `get_deletion_impact`(`application_project` 추가, 커리어 종류에 `detached_interview_sessions`), `delete_career_item`(`application_project` 거부) |
| `…000900_r11_interview_score_d14v1.sql` | OD-I1: 헬퍼 2개, `interview_evaluation_open`·`save_answer_evaluation`·`complete_interview_evaluation`·`submit_interview_session` 교체, `backfill_interview_scores` 신설 |
| `…001000_r11_page_save_client_id.sql` | OD-C6: `save_project_page`·`save_project_deliverable` 옛 시그니처 drop → `p_client_id` 붙여 다시 생성·재권한 |
| `…001100_r11_ai_disclosures_v2026_11_05.sql` | OD-L2·L2a: CHECK `ai_disclosures_free_tier_ack_check` 삭제 + `v2026-11-05` 6행 insert(on conflict do nothing) |
| `…001200_r11_consent_free_tier_ack_by_disclosure.sql` | R11-DB-1 리더 판단 (R-OD-15): 동의 CHECK `ai_data_use_consents_free_tier_acknowledged_check` 삭제, `private.ai_data_use_consents_before_insert`가 인용한 고지 행의 `requires_free_tier_ack = true`일 때만 `free_tier_acknowledged = true` 요구(아니면 23514 `free_tier_acknowledgement_required`). 기존 행은 모두 더 엄격한 규칙을 지켰으므로 그대로 유효 |

트리거 동작(잠금 순서 프로젝트 → JD(읽기) → `interview_sessions`(id 순 for update) → `evidence_links` → `ai_jobs`):
1. 그 프로젝트의 `completed` 세션에 JD `company_name`·`position_title` 복사(JD 없거나 빈 값이면 null).
2. 그 세션들의 질문·평가·종합 근거 `application_project_id = null`.
3. 그 밖의 세션 delete → 기존 `interview_sessions_cancel_jobs`가 queued/running 작업에 취소 요청, 하위·근거는 기존 연쇄·소유자 트리거.
4. 이어서 원래 연쇄: JD·요건 삭제 → 남은 JD 근거 `quote = null`·`source_deleted_at`("원본 삭제됨"), 남은 세션은 FK set null.
- 예외: `auth.users` 연쇄로 프로젝트가 지워질 때(사용자 행이 이미 없음)는 그 프로젝트 세션을 모두 지운다(탈퇴 = 전부 삭제와 같은 결과, spec-gaps R11-DB-7).
- `delete_account`·장기 미접속 파기(`private.delete_account_data`)는 프로젝트 삭제 뒤 `interview_sessions`를 `user_id`로 다시 지우므로 남은 세션도 지워진다 — pgTAP으로 확인(분리 세션이 이미 있던 경우 포함).

## RPC 시그니처 (변경 전 → 후)

| RPC | 변경 |
|-----|------|
| `save_project_page(p_project_id uuid, p_values jsonb, p_expected_updated_at timestamptz default null, p_applied_proposals jsonb default null)` | → **`…, p_client_id uuid default null)`** (옛 시그니처 drop). 반환 모양 그대로 `{project_id, status, updated_at, applied, skipped}`. security invoker, `authenticated`만 |
| `save_project_deliverable(p_project_deliverable_id uuid, p_project_id uuid, p_title text, p_body text, p_expected_updated_at timestamptz default null, p_applied_proposals jsonb default null)` | → **`…, p_client_id uuid default null)`** (옛 시그니처 drop). 반환 그대로 `{project_deliverable_id, project_id, sort_order, updated_at, applied, skipped}` |
| `get_deletion_impact(p_entity_type text, p_entity_id uuid, p_affiliation_mode text default 'delete_projects')` | 시그니처 그대로. `p_entity_type = 'application_project'` 추가 → `{"cascade": {"insights": n, "drafts": n, "interview_sessions": n, "stage_events": n}, "kept": {"interview_sessions": n}}`(affiliation_mode 무시, 남의·없는 프로젝트 → `not_found`). 커리어 종류 `affected_results`에 **`detached_interview_sessions`**(int) 추가 — 기존 키 `by_application_project` 그대로 |
| `delete_career_item(…)` | 시그니처 그대로. `'application_project'` → `invalid_entity_type`(프로젝트 삭제는 지금처럼 테이블 직접 delete) |
| `begin_interview_evaluation(uuid, uuid, text, text)` | 시그니처·반환 그대로. 분리 세션이면 맨 앞(작업 검사 전)에서 `interview_session_read_only` |
| `save_answer_evaluation(uuid, uuid, integer, jsonb)` | 시그니처 그대로. 질문 점수를 같은 트랜잭션에서 `d14.v1`로 씀(이전 `pending_method`). 반환에 키 추가: `score_status`(`scored`/`not_scored`), `score_value`(int\|null). 분리 세션 → `interview_session_read_only` |
| `complete_interview_evaluation(uuid, uuid, integer)` | 시그니처 그대로. `completed`면 미응답 0점 + 세션 점수. 반환 `score_status` = `scored`/`not_scored`(더는 `pending_method` 아님), 키 추가 `score_value`(int\|null), `score_counted_count` = 채점된 응답 수. 분리 세션 → `interview_session_read_only` |
| `submit_interview_session(uuid)` | 시그니처·반환 그대로. 응답 0개 분기: 세션 `scored` 0점·"질문 N개 모두 미응답, 0점", 각 질문 0/100/`d14.v1`/"미응답 · 0점"(이전 `not_scored`) |
| `create_interview_session(uuid, text, integer, text, uuid)` | 시그니처 그대로. `p_session_id`가 분리 세션이면 `session_id_conflict`(이전엔 null 비교로 재시도로 보고 그 세션을 돌려줌). 항상 `application_project_id`를 넣음(유일한 세션 생성 RPC — 세션 복사 RPC(F-P3-08)는 아직 없음) |
| **신설 `backfill_interview_scores(p_limit integer default 500) returns jsonb`** | security definer, **`service_role`만** execute. 반환 `{"sessions": n, "answers": n}`(이번 호출에 쓴 세션 점수 수·질문 점수 수). 멱등, `for update of s skip locked`, `p_limit` 1~10000 밖이면 `invalid_limit`. **원격 실행 안 함·마이그레이션 안에서 부르지 않음** — 배포 직후 운영자가 0/0이 될 때까지 반복 |
| `begin_assistant_message(…)` (OD-P11) | **변경 없음** — 아래 참고 |
| `private.interview_grading_decision(uuid, uuid)` | 분리 세션은 항상 `decision = 'none'`(`cause` null, 개수 필드는 그대로 계산) → `get_interview_grading_decisions`도 `none` |
| 신설 `private.interview_answer_score_d14v1(jsonb)` | immutable. `{value: int\|null, rationale: text\|null}` |
| 신설 `private.interview_apply_scores_d14v1(uuid, boolean)` | definer. 세션 질문·세션 점수 쓰기, 반환 `{answers, session_written, score_status, score_value, score_counted_count}` |

### OD-C6 `p_client_id` 계약 (만들기 요청 = 대상 id 인자 null일 때만)
- 같은 사용자의 그 id 행이 있으면 새로 만들지 않고 그 행을 **고치기 규칙**으로 저장(기대 버전 `p_expected_updated_at`은 무시, 값이 같으면 update 없음). 행 모양이 다르면 고치기 코드: 페이지 = 독립 프로젝트 `project_not_affiliated`, 산출물 = `p_project_id`가 부모와 다르면 `not_found`.
- 없으면 그 id로 insert(행 id = `p_client_id`).
- 남의 행 id면(PK 충돌) `not_found`.
- **(QA-02 수정)** 같은 사용자의 같은 `p_client_id` 만들기가 동시에 오면, 나중 요청은 insert에서 앞 요청 커밋을 기다린 뒤 PK 충돌이 난다. 이때 그 id 행이 **호출자 것이면** 함수를 같은 인자로 한 번 더 불러(아직 쓴 것 없음) 다시 보내기 경로로 저장한다 — 두 요청 모두 성공, 행 1개, 나중 요청 값이 남음. 남의 행일 때만 `not_found`. `20261113001000`(원격 미반영)을 직접 고쳤다.
- null이면 서버 id(이전과 같음). 고치기 요청에서는 무시.
- 다시 보낸 `p_applied_proposals`는 이미 기록됐으면 `skipped[].reason = 'already_applied'`(화면은 성공으로 봄). 응답에 `created` 없음.

### OD-P11 `begin_assistant_message` 계약 (api-engineer `turn.ts` retryTarget용)
- RPC 교체 없음. 지금 RPC(20261109100900)가 이미: 마지막 메시지가 `user`(뒤에 assistant 없음)면 **새 assistant 행**(`streaming`, sequence = 마지막 + 1)을 만들고 `message_count + 1`, `reused = false`. 사용자 메시지는 다시 만들지 않는다(재시도 경로는 `append_writing_chat_message`를 부르지 말 것).
- 그대로인 검사: `message_count >= 40` → `message_limit_reached`, 살아 있는 `streaming` assistant → `turn_in_progress`, 마지막이 실패/죽은 assistant → 같은 행 재사용(`reused = true`, 수 그대로), 그 밖(인사만·끝난 답) → `no_pending_user_message`, 닫힌 대화 → `writing_chat_closed`.
- 반환 `table (message_id uuid, sequence smallint, message_count smallint, reused boolean, is_final boolean)` 그대로.

### d14.v1 문구 (AI 4.3, 등급 이름 AI 4.2)
- 질문: `"{항목} {등급} · … → {점수}점"`, 항목 순서 구체성·의도 부합·구조·JD 연관성, 등급 우수/양호/보완 필요/미흡/해당 없음. 예: "구체성 보완 필요 · 의도 부합 양호 · 구조 양호 · JD 연관성 해당 없음 → 66점".
- 미응답 질문: 0 / 100 / `d14.v1` / "미응답 · 0점". 채점 실패: `not_scored`, 값·만점·방식·문구 null.
- 세션: "질문 N개 중 채점 n개 평균" + (m > 0) ", 미응답 m개는 0점으로 포함" + (k > 0) ", 채점하지 못한 k개는 빼고 계산". 모두 미응답: "질문 N개 모두 미응답, 0점". 응답 ≥ 1·채점 0개: `not_scored`(값 null).
- 다시 채점 시작(`interview_evaluation_open`)은 세션 점수 슬롯 전체(`score_value`·`score_max`·`score_method_version`·`score_rationale` 포함)를 비운다.

## 새 오류 코드
| 코드 | 위치 | API 매핑 제안 |
|------|------|---------------|
| `interview_session_read_only` | `begin_interview_evaluation`, `save_answer_evaluation`, `complete_interview_evaluation` | 409 (DM 2.7.2) — `src/server/db/errors.ts`에 없음, 추가 필요 |
| `free_tier_acknowledgement_required` (23514) | 동의 insert 가드 — Gemini 무료(`v2026-11-05`)·옛 버전 무료 행에 확인 없이 동의 | 기존 23514 매핑(400) 그대로 |
| `invalid_limit` | `backfill_interview_scores` | 운영 스크립트 전용(사용자 경로 없음) |
| `not_found` (새 경로) | `get_deletion_impact('application_project')`, `save_project_*` 남의 id | 기존 `not_found` 404 그대로 |
| `invalid_entity_type` (새 경로) | `delete_career_item('application_project')` | 기존 그대로 |

## 생성 타입 변경 (`src/server/db/database.types.ts`, `pnpm db:types`와 같은 명령)
- `interview_sessions.application_project_id`: `string` → **`string | null`**, 새 컬럼 `company_name_snapshot`·`position_title_snapshot: string | null`.
- `evidence_links.application_project_id`: `string` → **`string | null`**.
- Functions: `backfill_interview_scores { p_limit?: number } → Json` 추가, `save_project_page`·`save_project_deliverable` Args에 `p_client_id?: string`.
- 이 변경으로 `pnpm tsc --noEmit`이 깨지는 곳(2026-11-05 기준, 고친 것 없음):
  - 서버(api 소관): `src/server/services/interview/progress.ts:49`, `src/server/services/interview/start.ts:73`
  - 데이터 계층·화면·mock(UI 소관): `src/lib/data/deletion.ts:254`, `src/lib/data/evidence.ts:187,190,197,208`, `src/lib/data/interview-rows.ts:108,122`, `src/lib/data/interviews.ts:219`(새 컬럼 2개 없음), `src/lib/mock/fixtures.ts:1205`, `src/components/interviews/interviews-overview.tsx:131-132`, `session-list.tsx:160,173`, `session-status.tsx:68-69`

## API 쪽이 바꿔야 할 것
1. `errors.ts`: `interview_session_read_only` → 409 매핑(+ 화면 문구 키).
2. 다시 채점 경로(`services/interview/start.ts`)는 `get_interview_grading_decisions`가 분리 세션에 `none`을 주므로 지금은 `interview_evaluation_not_retryable`이 된다. DM 2.7.2대로 "연결 게이트보다 먼저" `interview_session_read_only`를 내려면 세션 `application_project_id is null`을 먼저 보고 거부해야 한다(작업 행을 만들기 전). 만들면 `begin_interview_evaluation`이 마지막 방어선으로 같은 코드를 낸다.
3. 읽기 DTO: `application_project_id` null 처리, 이름은 `company_name_snapshot`·`position_title_snapshot`, `read_only` 플래그(#6). 근거 읽기(`services/evidence`)는 `application_project_id` null 근거를 견뎌야 함.
4. `complete_interview_evaluation` 반환 `score_status`가 이제 `scored`/`not_scored` — `job.ts`가 `pending_method`를 기대하면 정리(#7). 모델 점수 슬롯은 DB가 무시하므로 `score_overridden` 보고는 유지해도 무방.
5. `save_project_page`·`save_project_deliverable` 호출에 `p_client_id` 전달(zod·서버 액션, #9).
6. 지원 프로젝트 삭제 영향은 `rpc('get_deletion_impact', { p_entity_type: 'application_project', p_entity_id })`(#5). 커리어 삭제 영향 타입에 `affected_results.detached_interview_sessions: number` 추가.
7. **동의 버전**: `v2026-11-05`가 현재 시행 버전이 되어 `ai_data_use_consents` insert 가드가 `v2026-10-29`를 `disclosure_version_not_current`로 거부한다. 고칠 테스트·fixture: `src/server/services/ai-connection/ai-connection.integration.test.ts:166,182,369`, `src/server/services/account/__fixtures__/all-slices.sql:49`(Vitest 통합 테스트). 화면 고지 본문 모듈은 같은 배포(UI).
8. **무료 등급 확인(R11-DB-1, 해결 — 리더 판단 R-OD-15)**: `20261113001200` 뒤로 OpenAI·Claude 무료 등급 동의는 `free_tier_acknowledged = false`로 보내도 된다. Gemini 무료는 여전히 `true` 필요(아니면 23514 `free_tier_acknowledgement_required`). 앱 `consent.ts`가 읽는 `requires_free_tier_ack`로 화면·서버가 판정하면 DB와 같다.

## [가정]
- 점수 못 내는 성공 평가(쓸 수 있는 등급 0개) → 질문 `not_scored`, 같은 키 중복은 첫 항목, 모르는 키·등급 무시, `not_applicable`은 어느 키든 제외 (R11-DB-4).
- 응답 있는데 채점 0개인 `completed` 세션은 `not_scored` + `score_method_version = 'd14.v1'`(백필 재선택 방지), `score_max` null (R11-DB-5).
- 세션 문구에서 미응답 0개면 미응답 구절 생략 (R11-DB-3).
- 백필은 `completed` 세션 점수 외에 끝나지 않은 제출 세션의 `pending_method` 질문 점수도 채움 (R11-DB-6). `p_limit` 상한 10000.
- 등급 표시명은 AI 4.2(우수·양호·보완 필요·미흡) — 화면 `GRADE_LABELS`와 다름 (R11-DB-2).
- 고지 `effective_at = 2026-11-05 00:00 KST`(DM `[가정]` 그대로).
- 분리 세션 판정 `none`일 때도 `regrade_target_count` 등 개수 필드는 실제 값을 돌려준다(화면은 decision만 봄).

## 테스트 (`supabase test db`)
- **Result: PASS** — `supabase db reset`(처음부터 전체 체인 적용) 뒤 58 파일, 2,896 assertions, 전부 통과(QA-02 수정 뒤 `db reset` + `test db` 다시 통과). 타입 재생성 결과 변경 없음.
- QA-02: pgTAP 한 트랜잭션으로는 경합을 재현할 수 없어(트리거로 만든 "먼저 저장된 행"이 실패한 insert와 함께 롤백됨) 넣지 않았다. 대신 psql 두 세션으로 확인: 세션 1이 만들기 후 3초 커밋 보류 → 세션 2가 같은 `p_client_id`로 만들기 → 커밋 뒤 세션 2도 같은 id로 성공, 행 1개(값 = 세션 2). 페이지·산출물 둘 다. 확인 뒤 데이터 삭제.
- R11-DB-1 추가 assertion: 동의 CHECK 없어짐, OpenAI·Claude 무료 `false` → 통과, Gemini 무료 `false` → 23514 거부, Gemini 무료 `true` → 통과, 옛 행 그대로.
- 신규 `supabase/tests/r11_open_decisions.test.sql`(99개): 스키마(nullable·FK set null·트리거 definer), CHECK 3종, `get_deletion_impact('application_project')`(cascade·kept·not_found·affiliation_mode 무시), 사용자 삭제 → 남는 세션 2개·지워지는 3개·복사 값·하위 행 유지·근거 분리·JD 근거 "원본 삭제됨"·커리어 근거 유지·작업 취소 요청·나머지 연쇄·다른 사용자 무영향, 읽기 전용(판정 none·열람 표식 허용·`session_id_conflict`·begin/save/complete 거부·B의 RLS 격리), 커리어 삭제 `detached_interview_sessions` + `delete_results`로 남은 세션 삭제, 사용자 직접 삭제, `delete_account`·장기 미접속 파기 본문·`auth.users` 연쇄 모두 남김없음, d14.v1 헬퍼(66 예시·82.5→83·100·25·빈 criteria·중복/모르는 키), 실제 경로(save 66 → complete 33, 문구·개수, 질문 행 3종, 다시 채점 시 슬롯 비움), not_scored 세션, 백필(권한·`invalid_limit`·p_limit·멱등 0/0·44점·0점·질문 행 d14.v1), OD-C6(같은 `p_client_id` 3번 → 1행·`already_applied`·같은 id·기대 버전 무시·고치기 요청 무시·독립 프로젝트 `project_not_affiliated`·null 서버 id·남의 id `not_found`, 산출물 같은 규칙), OD-P11(답 없는 사용자 메시지 → 새 assistant 행 1회 셈), OD-L2(Claude 동의자 `consent_required = true`, Gemini·OpenAI `false`, Claude 재동의 후 `false`).
- 기존 테스트 수정(새 동작 반영): `interviews.test.sql`(평가 payload에 실제 criteria, pending_method → scored, 응답 0개 = 0점 + 질문 행 확인 추가), `career_deletion_rpcs`·`drafts_career_deletion`(`detached_interview_sessions` 키), `grants`(service_role 전용 목록에 백필), `r5_page_save`(새 시그니처), `ai_data_use_consents`(두 버전 seed 검사, CHECK 삭제 반영, 현재 버전), 동의 fixture가 있는 13개 파일 `v2026-10-29` → `v2026-11-05`(`account_deletion`, `application_projects`, `check_ai_run_allowed`, `create_application_project_gate`, `get_provider_key_secret`, `r1_planning_decisions`, `interview_grading`, `jd_extraction`, `readiness_consent_required`, `retry_ai_job`, `s3b_first_call_privileges`, `signup_consent_ai_gate`, `update_failed_jd_raw_text`) + `ai_provider_keys`.
- 리더 지시로 `supabase db reset`을 한 번 실행해 전체 마이그레이션 체인을 처음부터 적용·확인했다(로컬 공유 DB 데이터 초기화됨).

## 파괴적 마이그레이션
없음(행·컬럼 삭제 없음). 단 `20261113000500`은 FK 동작 변경(cascade → set null), `20261113001100`·`001200`은 CHECK 삭제(규칙 완화) — 원격 반영 전 확인 표시.

## 원격 반영
미반영. 배포 체크리스트: `db push` → UI 고지 본문 모듈·`p_client_id` 화면과 같은 배포 → 직후 `select public.backfill_interview_scores();`(service_role)를 `{"sessions":0,"answers":0}`이 될 때까지.
