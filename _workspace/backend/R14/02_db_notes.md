# R14 DB 구현 노트 — AI 모의 면접 MVP 제외 (db-engineer, 2026-11-08)

## 마이그레이션 파일
| 파일 | 내용 | 파괴적 |
|------|------|--------|
| `supabase/migrations/20261113002950_r14_policy_versions_rm1.sql` (후속에서 이름 변경, 미push) | `policy_versions` 4행: terms·cross_border_transfer `2026-11-08`, privacy·ai_data_use `2026-11-08.1`(모두 `requires_reconsent = false`, `on conflict do nothing`) + `private.current_policy_version` 동률 정렬 보강. 머리 주석: RM-1, 새 .1 판, 재동의 없음 | 아님 |
| `supabase/migrations/20261113003000_r14_remove_mock_interview.sql` | 첫 줄 `-- DESTRUCTIVE:`. 한 파일 = CLI가 감싸는 한 트랜잭션 | **예** |

`20261113002900`은 **이미 원격에 있어서**(아래 "원격 확인") 고치지 않고 새 파일 `…002950`을 만들었다(계획의 "원격에 있으면 새 파일" 분기). 리더 후속으로 privacy·ai_data_use도 새 `2026-11-08.1` 판을 같은 파일에 넣었다.

### `20261113003000` 구조 (순서)
0. 가드 — `application_projects.stage in (면접 2값)` 행 수 > 0이면 `raise`(행 수만). 같은 블록에서 DM 2단계의 사전 검사(`source_type = 'interview_answer'`인데 소유자가 면접 3종이 아닌 행 > 0이면 `raise`).
R. 교체 RPC 12개 (`create or replace`, 로컬 DB의 현재 정의 `pg_get_functiondef`를 그대로 가져와 면접 분기만 뺐다 — 보안 속성·search_path·grant·소유자 유지)
1. `application_projects_detach_interviews`·`ai_jobs_release_interview` 트리거와 함수 drop
2. `evidence_links` 면접 소유자 3종 / `interview_answer` 출처 행 delete
3. `ai_usage_records`(feature 또는 job_type 면접) → `ai_jobs`(job_type 면접 또는 `target_type = 'interview_session'`) delete
4. `application_stage_events` 면접 단계 이력 delete
5. `writing_chats.return_target` `feature = 'job_interview'` → null
6. 행 타입 의존 함수 5개 drop → 테이블 5개 drop(자식 → 부모, cascade 없음)
7. 나머지 면접 함수 38개 drop (DM 37 + `answer_evaluations_clear_error_code`)
8. CHECK 9개 drop → add (`not valid` 없음)
9. `evidence_links_detached_check` drop → `application_project_id set not null`

## DM 11.9와 달랐던 것 (실물 기준, spec-gaps R14-DB-1~5)
- 이름·시그니처는 DM 목록과 로컬 `pg_proc`가 **모두 일치**(public 16 + private 28).
- **추가 1개**: `private.answer_evaluations_clear_error_code()` — 이름에 interview가 없어 DM grep에서 빠짐. → 지운 함수 **45개**.
- **순서 보정**: `interview_sessions` 행 타입을 인자/반환으로 쓰는 private 함수 5개(`interview_evaluation_run_state`, `interview_questions_run_state`, `interview_job_matches`, `interview_session_create_json`, `interview_lock_session`)는 `pg_depend`로 테이블 타입에 묶여 있어 테이블 drop 앞에서 지웠다.
- `private.insight_payload_valid`도 교체(주석의 `interview_answer`만 고침, 로직 동일) — "남는 함수 본문 interview 0건" 조건 때문. `purge_old_ai_jobs`는 실물 본문에 interview가 없어 교체 안 함.
- 5단계 update가 `set_updated_at` 트리거로 해당 대화의 `updated_at`을 바꾼다 `[가정]`.

## 지운 객체 수
- 테이블 5 (`session_feedbacks`, `answer_evaluations`, `interview_answers`, `interview_questions`, `interview_sessions`) — 함께 사라진 것: 트리거 12(테이블 위 11 + `answer_evaluations_clear_error_code`), 정책 12, grant, 인덱스, 테이블 CHECK
- 다른 테이블의 트리거 2
- 함수 45 (public 16, private 29)
- CHECK 1 drop(`evidence_links_detached_check`), 9개 재정의
- 확인 쿼리(`pg_proc` 이름·본문, `pg_class`, `pg_trigger`, `pg_policy`, `pg_constraint` 정의, `pg_type`)에서 `interview` 잔존 **0**. 고아 트리거 함수 0. 이 확인은 `r14_remove_mock_interview.test.sql`에 단정으로 들어 있다.

## 교체 RPC와 바뀐 반환 모양 (api가 읽을 것)
시그니처는 **전부 그대로**다(인자·반환 타입 jsonb 동일). 바뀐 것은 키와 허용 값뿐.

| RPC | 변화 |
|-----|------|
| `public.get_data_readiness()` | `features` = `{insight, draft}` **2키만**. `job_interview`·`culture_fit_interview` 키 삭제, `data_sufficiency`는 응답 어디에도 없다. 나머지(`ai_connection`·`counts`·`draft_item_ids`·각 feature의 `ready/missing/hints/next_action/suggested_project_id`) 그대로 |
| `public.move_application_stage(uuid, text, text)` | 허용 stage 4값(`before_apply`, `document`, `assignment`, `closed`) — 면접 값은 `invalid_stage`. 반환 `{stage, stage_outcome, stage_changed_at, changed}` — **`interview_prompt` 키 삭제**(같은 단계 분기 포함) |
| `public.get_deletion_impact('application_project', id)` | `{cascade: {insights, drafts, stage_events}}` — `cascade.interview_sessions`, `kept` 삭제 |
| `public.get_deletion_impact(커리어 종류, …)` | `affected_results = {by_application_project: [{application_project_id, name, insights, drafts, draft_sections}]}` — 행의 `interview_sessions`, `affected_results.detached_interview_sessions` 삭제. `cascade`·`writing_chat` 분기 그대로 |
| `public.delete_career_item(…)` | 반환 = 위 impact를 합친 모양(같은 키 삭제). 면접 세션 삭제 분기 없음 |
| `public.get_account_deletion_summary()` | `applications` = `{application_projects, insights, drafts, application_stage_events}` — `interview_sessions` 삭제 |
| `private.delete_account_data(uuid, text, text)` | 면접 테이블 delete 5줄 삭제(`delete_account`·`purge_inactive_account`가 씀). 반환 그대로 |
| `public.retry_ai_job(…)` | 같은 행 다시 시도 대상 = `insight`만. 면접 job_type·세션 잠금·"다시 채점 0개" 거부 분기 삭제. `ai_job_not_retryable` 판정: `job_type <> 'insight'` 또는 원인 없음/입력 오류 또는 지원 프로젝트 없음. 반환 그대로 |
| `public.update_failed_jd_raw_text(…)` | 조건 5의 면접 질문 검사 삭제 |
| `public.start_writing_chat(uuid, jsonb, jsonb)` | `p_return_target.feature` 허용 3값(`insight`, `career_description`, `cover_letter`) — `job_interview`는 `invalid_return_target` |
| `private.writing_chat_greeting` | 게이트 인사의 `job_interview` 문구 분기 삭제(그 값이 오면 기본 "이 기능을") |
| `private.evidence_links_check_source()` | `interview_answer` 분기 삭제(CHECK가 값 자체를 막음) |

### CHECK 목록 (enums.ts와 대조할 것)
- `application_projects.stage`, `application_stage_events.from_stage`/`to_stage`: `before_apply, document, assignment, closed`
- `ai_jobs.job_type` = `ai_usage_records.job_type` (9): `jd_extraction, insight, career_description, draft_source_ranking, cover_letter, writing_chat_turn, key_verification, writing_assist, chat_reply`
- `ai_usage_records.feature` (8): `jd_extraction, insight, career_description, cover_letter, writing_chat, key_verification, writing_assist, chat_reply`
- `evidence_links.owner_type`: `insight, draft_section, chat_message` (11.8 미구현이라 `application_document` 없음)
- `evidence_links.source_type`: `profile, experience, education, project, project_deliverable, skill, jd_requirement, jd_sentence, user_note`
- `writing_chats.return_target.feature`: `insight, career_description, cover_letter`
- `evidence_links.application_project_id` **not null** 복귀(OD-I6 되돌림)

## 테스트 (`supabase test db`)
- `supabase db reset`(로컬) 뒤 **63 파일 / 2,730 단정 전부 통과** (`Result: PASS`). 후속(.1 판) 반영 뒤 다시 reset → **63 파일 / 2,732 단정 통과**.
- 삭제: `interviews.test.sql`, `interview_grading.test.sql`, `interviews_career_deletion.test.sql`.
- 정리(면접 단정 제거·대체): `account_deletion`, `ai_jobs`, `application_stage`, `career_deletion_rpcs`, `complete_ai_job`, `drafts_career_deletion`, `evidence_links`, `get_data_readiness`, `grants`(plan 44 → 40), `insights_career_deletion`, `r11_open_decisions`(OD-I6·OD-I1 절 삭제 — 지원 프로젝트 삭제는 새 파일로), `r13_settings_dialog`, `r1_planning_decisions`, `retention_purge`, `retry_ai_job`(면접 다시 시도 절 삭제), `s6_lock_order`, `s7_first_call_privileges`, `update_failed_jd_raw_text`, `writing_chats`.
- 정책 버전 때문에 고친 것: `consents`, `policy_versions`(13 → 15행), `r12_ui36_followups`, `signup_consent_ai_gate`, `account_deletion`(terms 현재 판이 2026-11-08이 됨).
- `drafts.test.sql`의 `'interview_answer source'` 거부 단정은 남겼다(지워진 값을 여전히 거부하는지 보는 음성 단정). 테스트의 나머지 `interview` 문자열은 모두 R14 음성 단정·주석.
- 새 `supabase/tests/r14_remove_mock_interview.test.sql` (38): 면접 테이블·함수·트리거·정책·제약 부재, 남는 함수 본문 interview 0, 고아 트리거 함수 0, CHECK 9개 값 목록, detached_check 없음·not null, 거부값 insert(stage·이력 from/to·job_type·owner_type·return_target), readiness 2키·`data_sufficiency` 없음, `move_application_stage` 반환 키(이동·같은 단계), `get_deletion_impact`(지원 프로젝트·커리어), 탈퇴 요약 키, `start_writing_chat` 거부, 지원 프로젝트 삭제 뒤 잔존 0, `delete_account_data` 정상, 정책 2행.
- **가드(RM-4) 확인 방법** (pgTAP 밖, 마이그레이션 적용 전 DB가 필요): `supabase db reset --version 20261113002950` → psql로 `begin; insert auth.users …; insert application_projects (…, stage = 'job_interview'); \i supabase/migrations/20261113003000_r14_remove_mock_interview.sql; rollback;` → `ERROR: r14_remove_mock_interview: 1 application project(s) are on an interview stage` 확인, 테이블은 그대로. 확인 뒤 `supabase db reset`으로 되돌렸다.

## 타입 재생성
- `pnpm db:types`(= `supabase gen types typescript --local > src/server/db/database.types.ts`, 핀한 CLI 2.121.0). 216줄 삭제·4줄 추가, 파일 안 `interview` **0건**. 면접 테이블 5개·면접 RPC 16개 타입이 사라졌다 → `src/types/db.ts`와 면접 코드는 컴파일이 깨진다(api·ai 몫).

## 파괴적 마이그레이션
- `20261113003000_r14_remove_mock_interview.sql` — 면접 테이블 5개와 그 데이터, `evidence_links` 면접 행, `ai_jobs`·`ai_usage_records` 면접 행(이번 달 미터 합계 감소, RM-A2), `application_stage_events` 면접 이력, `writing_chats.return_target`의 `job_interview` 값. **되돌릴 수 없다.** push 전 운영자 덤프 권고, 사용자 확인 필요.

## 원격 확인 (읽기 전용)
- Supabase MCP `list_migrations` (project `rxtnguarpotkcgdazkbw`, 2026-11-08): 마지막 적용 = `20261113002900 policy_versions_2026_11_08`. → `002950`·`003000` 둘 다 그 뒤로 정렬되고 원격에 없음. 원격 쓰기 도구는 쓰지 않았다.
- push 전 원격에서 읽기 전용으로 볼 것(DM 11.9 (5)): 면접 단계 행 수(0이어야 함), `ai_jobs` 면접 작업 `queued/running` 수, 지울 `ai_usage_records` 행 수, `return_target ->> 'feature' = 'job_interview'` 행 수.

## 남은 `[가정]`
- RM-A1 `return_target` null 처리(대화는 남김), 그에 따른 `updated_at` 갱신(R14-DB-5).
- RM-A2 면접 사용량 행 삭제 → 이번 달 합계 감소.
- `get_data_readiness` 키가 줄어드는 것을 옛 화면이 견딘다(DM 11.9 (5)) — 같은 배포로 내보낼 것.

## 후속 (리더 요청, 2026-11-08) — privacy·ai_data_use `2026-11-08.1`
- `20261113002950`을 `…_r14_policy_versions_rm1.sql`로 이름을 바꾸고(원격 미반영), privacy·ai_data_use `2026-11-08.1` 2행을 더했다. 시행일은 `2026-11-08 00:00:00+09`로 2026-11-08 판과 **같다**.
- **정렬 점검 결과**:
  - DB `private.current_policy_version`(동의 insert 가드·`get_consent_status`의 현재 판)은 `order by effective_at desc`**만** 썼다. 시행일이 같으면 2026-11-08과 .1 중 어느 쪽이 나올지 정해져 있지 않았다. (`2026-11-04.1` 선례는 시행일을 15:00으로 달리해서 문제가 없었다.) → 같은 파일에서 `order by effective_at desc, version collate "C" desc`로 교체했다. 이제 `.1`이 현재 판으로 나온다(pgTAP `r12_ui36_followups`에 3단정 추가, `consents`는 privacy 계열 `2026-11-08.1` 인용 확인).
  - `get_consent_status`의 재동의 판정은 `effective_at >` 비교다. 그래서 같은 시행일의 .1 판에는 `requires_reconsent`가 걸리지 않는다. 지금은 두 행 모두 false라 영향 없음.
  - **앱 코드(api 몫, 고치지 않음)**: `src/server/services/shell/index.ts` `loadPolicyVersions`는 `.order("effective_at", { ascending: false })`만 하고, `src/lib/data/account.ts`가 `rows.find(type)`으로 첫 행을 고른다. 같은 시행일에서는 2026-11-08과 .1 중 어느 쪽이 나올지 정해져 있지 않다. 그래서 **`.order("version", { ascending: false })` 2차 정렬이 필요하다**(JS 문자열 비교로도 `"2026-11-08.1" > "2026-11-08"`). mock `currentVersion`(`src/lib/data/account.ts`)도 `effective_at`만 비교한다. UI·ai 쪽의 `ai_disclosures` 정렬(`consent.ts`·`policies.ts`)은 정책 판과 무관하다.
- 타입: 다시 생성했고 변화 없음(함수 시그니처 동일).
