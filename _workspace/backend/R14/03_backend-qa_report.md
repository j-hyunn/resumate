# R14 백엔드 QA 리포트 (라운드 1)

- 작성: 2026-11-08 (backend-qa). 대상: R14 AI 모의 면접 MVP 제외 — `20261113002950`, `20261113003000`, api·ai 노트의 파일 목록.
- 요약: **Critical 0 · Major 0 · Minor 2**. 경계면 Q1~Q13 모두 통과 또는 해당 없음, 이슈 2건은 문구·죽은 매핑.
- 주의: 검사 도중(18:21:57) UI 런(`_workspace/ui/44_brief_remove-mock-interview.md`)이 같은 워크트리에서 시작됐다. typecheck는 UI 런이 파일을 바꾸기 전에 끝났다. vitest는 UI 런과 겹쳐 돌았다. UI 런이 끝나면 `run-checks.sh --build`를 다시 돌려야 한다.

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 실패 → **UI 요청 (예상)** | 오류 249건 모두 UI 쪽 파일. `src/app/(dashboard)/**`·`src/components/**`·`src/lib/mock/**` 248건, `src/lib/routes.ts:8` 1건(`InterviewType` export 삭제 — 표에 소유자가 없고 UI가 쓴 파일, api 노트 "UI 요청"에 있음). **백엔드 소유 파일 오류 0**. `RouteContext` 오류는 이번엔 0건(기존 항목, 지금은 재현 안 됨) |
| lint | 통과 | |
| vitest | 실패 → **UI 요청 (예상)** | 146 파일 중 144 통과, 2345 테스트 중 2344 통과. 실패 2개 모두 UI 소유: `src/components/account/usage-rows.test.ts`(7행 기대 → 5행), `src/components/interviews/session-status.test.ts`(지워진 모듈 import, UI 런이 지금 삭제함). 로컬 스택 통합 테스트(application·account·career·w3·insight)도 함께 돌았고 통과 |
| pgTAP | 통과 | 63 파일 / 2,732 단정, `Result: PASS` |
| 타입 재생성 | 통과 | 고정한 CLI로 `supabase gen types --local`을 다시 돌린 결과 = `database.types.ts`(diff 없음), `interview` 0건 |
| 로컬 스모크 | 통과 | 실제 서비스(`getDataReadiness`, `createApplicationProject`·`moveApplicationStage`)를 PostgREST와 로그인한 사용자로 호출(Vitest, 테스트 사용자를 만들고 지움). readiness `features` = `{draft, insight}`, 응답에 `data_sufficiency`·`interview` 없음. 이동 결과 키 = `{applicationProjectId, stage, stageOutcome, stageChangedAt, changed}`, 같은 단계면 `changed=false`, RPC 원시 반환 키 = `{changed, stage, stage_changed_at, stage_outcome}`. `job_interview` → RPC `invalid_stage` → 앱 `invalid_input`(기존 매핑). `closed`+`passed` 정상 |
| 가드(RM-4) | 통과 | 트랜잭션 안에서 stage CHECK를 잠시 지우고 `job_interview` 행 1개를 넣은 뒤 마이그레이션 0단계 블록을 실행 → `ERROR: … 1 application project(s) are on an interview stage`(행 수만 나옴), rollback 뒤 CHECK 원래대로 |
| 원격 | 해당 없음 | 읽지 않음. db 노트의 `list_migrations` 결과(마지막 적용 `20261113002900`)를 따름 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM 11.9 ↔ `20261113003000` | 통과 — 첫 줄 `-- DESTRUCTIVE:`, 파일 하나(CLI 트랜잭션 안에서 실행, 명시적 begin 없음), 순서 0 → R(교체 12) → 1~9, `cascade` 없음, CHECK에 `not valid` 없음. DM과 다른 점(함수 45개, 행 타입 함수 5개 먼저 drop, `insight_payload_valid` 교체)은 R14-DB-2~4로 기록됨 | — |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과 — 타입이 최신. 백엔드 쪽 typecheck 0이므로 지워진 테이블·RPC를 부르는 `.from`·`.rpc`가 남아 있지 않다 | — |
| Q3 | 교체 RPC ↔ 호출부 | 통과 — `get_data_readiness` ↔ `DataReadiness` zod(2키) ↔ `lib/data/readiness.ts`, `move_application_stage` ↔ `toStageChange`(스모크), `get_deletion_impact`(지원 프로젝트) ↔ `ApplicationProjectDeletionImpact` `{cascade:{insights,drafts,stage_events}}`, 커리어 ↔ `CareerDeletionImpact`/`AffectedApplicationProject`(면접 키 없음), `delete_career_item` ↔ `DeleteCareerItemResult`, `get_account_deletion_summary` ↔ account 서비스, `retry_ai_job` ↔ `supabase-store.requeueFailed`(인자 이름 같음, `loadRetryBlocked` 삭제), `start_writing_chat` return_target ↔ `RETURN_TARGET_FEATURES` 3값 ↔ CHECK. 보안 속성·`search_path=''`·grant 유지(`pg_proc` 확인) | — |
| Q4 | raise 코드 ↔ 앱 매핑 | 통과(죽은 매핑 1개) — 새 마이그레이션의 raise 코드는 모두 매핑돼 있다. 매핑에는 있는데 DB가 더는 내지 않는 코드가 1개 있다. (기존: `invalid_payload`·`invalid_reason`·`not_authorized`는 HEAD부터 매핑이 없었다. R14와 무관) | QA-R14-2 |
| Q5 | 계약 ↔ 핸들러 | 통과 — 면접 라우트·액션 삭제, `ai-jobs/[id]` 상태 응답에서 `retryBlocked` 호출 삭제(시그니처는 남김 `[가정]`) | — |
| Q6 | SSE | 해당 없음 | — |
| Q7 | AI 출력 ↔ 저장 | 통과 — AI 모듈의 `EVIDENCE_OWNER_TYPES` 3값 = CHECK, `EVIDENCE_SOURCE_TYPES`는 저장할 수 있는 값 = CHECK(profile은 기존 규칙대로 새 행 차단) | — |
| Q8 | enum DB ↔ TS | 통과 — 로컬 DB `pg_constraint` = `enums.ts` = `src/types/db.ts`: stage 4(프로젝트·이력 from/to), job_type 9(×2), feature 8, owner 3, source 9, return_target 3, `evidence_links.application_project_id` not null, `detached_check` 없음 | — |
| Q9 | 작업 종료·사용량 | 통과 — `definitions.ts` 면접 등록 2개 삭제, `cost.ts` `USAGE_FEATURE_BY_JOB_TYPE` 9키, `status.ts` 면접 분기 없음, `src/server/jobs` `interview` 0건. 표시 5행 = AI C-13.1 표(행 이름·순서·묶음 같음) | — |
| Q10 | 보안·로그 | 통과 — 새 테이블 없음, 남은 함수 본문·정책·트리거·제약에 `interview` 0건(실제 DB), `grants.test` 통과, 로그 변경 없음 | — |
| Q11 | UI ↔ 백엔드 | UI 요청 (예상) — 지운 export 목록이 api 노트 "UI 요청"에 있고 UI 런이 진행 중이다 | — |
| Q12 | 실제 의존 연결 | 통과 — 남은 작업 종류의 등록에는 변화 없음. 실제 서비스 경로를 스모크로 확인 | — |
| Q13 | 릴리스 준비 | 통과 — `002950`·`003000`이 원격 마지막 적용(`002900`) 뒤로 정렬됨, 파괴적 표시와 노트 있음, 새 환경 변수 없음. **push 전 운영자 덤프와 원격 읽기 전용 확인(DM 11.9 (5))은 사용자 몫** | — |

### 추가 대조
- **AI**: `common.v4`, 자리 표시 5종(`placeholders.ts`) = AI C-5 표, `src/types/db.ts` `PlaceholderToken` 5종. `ai-04.generate`/`adjust` 구현 번호 `v5` — AI 명세 0.v414가 "구현 번호 v4 → v5"로 적어 둠(R14-AI-1). 프롬프트 버전 테스트 통과.
- **법무**: `docs/legal/` git diff의 면접 문장 삭제 13곳이 `policy-content.ts` diff와 1:1로 대응하고 남은 문장도 같다. 약관 호 번호가 바뀐 부분은 앱 본문이 호 번호를 쓰지 않아 영향이 없다. 시행일·버전은 앱 본문에 없다(DB 행을 읽음). `docs/legal` 4문서와 앱 본문 모두 "면접" 0건. 기존 차이(privacy 2번 "서비스 제공" 축약)는 R14와 무관하고 api 노트에 UI 요청으로 있음.
- **정책 판 동률 정렬**: `002950` 4행(terms·cross_border `2026-11-08`, privacy·ai_data_use `2026-11-08.1`, 모두 `requires_reconsent=false`, 시행일 `2026-11-08 00:00+09`). `private.current_policy_version` 교체 뒤에도 invoker·stable·`search_path=''`·grant(authenticated·service_role) 그대로. 실제 DB 현재 판: terms/cross_border `2026-11-08`, privacy/ai_data_use `2026-11-08.1`. 앱 `loadPolicyVersions`(`effective_at desc, version desc`)를 PostgREST로 같은 순서로 조회 → 종류별 첫 행이 DB 현재 판과 같다. mock `currentVersion`도 같은 2차 정렬.
- **탈퇴·장기 미접속 파기**: `private.delete_account_data` 본문에 면접 테이블 없음. `delete_account`·`purge_inactive_account`는 그 함수를 부른다. pgTAP `r14_remove_mock_interview`(lives_ok + 데이터 0)·`inactive_account_deletion`·`account_deletion`·`retention_purge` 통과. 서비스 `account.integration.test`·`inactive-accounts.test` 통과.

### 남은 `interview` 문자열 (grep 7번 범위)
| 위치 | 판정 |
|------|------|
| `src/server/ai/**` 주석 7곳, `prompt-versions.test.ts` 음성 테스트 | 정당 — 삭제 이력 주석과 "프롬프트에 면접 규칙 없음" 테스트 |
| `career.integration.test.ts:314`, `application.integration.test.ts:203-204`, `w3.integration.test.ts:564` | 정당 — 면접 키·값이 없음을 확인하는 음성 단정 |
| `supabase/tests/*` (r14 새 파일, application_stage, writing_chats, retry_ai_job, grants, get_data_readiness, drafts 등) | 정당 — 부재·거부 단정과 이력 주석 |
| `src/lib/data/interview-grading.ts` | 없음 — UI 런이 `src/lib/mock/grading.ts`와 함께 지움(경과 파일 해소) |
| 한국어 "면접": AI-12 "면접 코치", AI-02 `prepare_answer` | 정당 — AI 명세가 남김 `[가정]` |
| 한국어 "면접": `src/types/db.ts:740`, `src/lib/data/applications.ts:148` 주석 | 무해(주석). 다음에 손댈 때 정리 |
| 한국어 "면접": `src/server/mail/inactivity-notice.ts:40` | **이슈** QA-R14-1 |

### 파일 소유 (8번)
- 대화 시작 때의 git 스냅숏에서 UI 소유 경로(`src/app/(dashboard)`·`(public)`·`src/components`) 중 바뀐 파일은 `src/components/account/policy-content.ts`(18:14, 리더 허용 예외, api 노트 "UI 소유 파일 수정")뿐이었다. `src/lib/mock/*` 수정 시각은 16:52이고, 이후 변화는 UI 런이 지운 `grading*.ts`뿐이다. 지금 status에 보이는 나머지 UI 파일 변경(`src/components/**`, `src/app/(dashboard)/**`, `src/lib/routes.ts`, `src/lib/preview-state.ts`)은 18:22 이후 UI 런이 만든 것이다. **백엔드가 허용 범위 밖의 UI 소유 파일을 고친 흔적은 없다.**

## 이슈
### QA-R14-1 [Minor] 장기 미접속 파기 안내 메일이 아직 "모의 면접 기록"을 파기 대상으로 적는다
- 담당: api-engineer
- 근거: `src/server/mail/inactivity-notice.ts:40` — "…모든 데이터(커리어 정보, 자기소개서, 지원 현황, **모의 면접 기록**, AI 연결 정보)를 파기합니다." ↔ 계획 `01_plan.md` 2절 api "`src/server/mail/inactivity-notice.ts`(면접 문구가 있으면)", 처리방침 2026-11-08.1(면접 서술 삭제). 실제 사용자에게 가는 메일이다.
- 수정 제안: "모의 면접 기록, "을 지운다. 메일 본문 테스트가 있으면 같이 고친다(지금 `src/server/mail`에는 테스트 파일이 없다).
- 상태: 열림

### QA-R14-2 [Minor] `invalid_error_code` 매핑이 죽은 코드로 남았다
- 담당: api-engineer
- 근거: `src/server/db/errors.ts:138`(RAISE_MESSAGES), `:245`(RAISE_CODE_ALIASES) ↔ 이 코드를 내던 곳은 `20261107000300_w0_answer_evaluation_error_code.sql`(면접 채점)뿐이다. 실제 DB의 public·private 함수 본문 어디에도 이 문자열이 없다.
- 수정 제안: api 노트의 "면접 전용 4개 삭제"와 같은 이유로 두 줄을 지우고, `errors.test.ts`에 그 코드가 있으면 같이 지운다.
- 상태: 열림

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- R14-QA-1: DM 11.9 (3)은 진행 단계 `generate`를 지우라고 적었지만, 지금 구현된(11.8 전) 서류 생성이 이 값을 쓴다. 구현이 남긴 것이 맞다. DM 문장 정정 권장.

## 릴리스 메모 (리더용)
- UI 런이 끝난 뒤 `run-checks.sh --build`를 다시 돌린다(typecheck·vitest의 UI 쪽 실패가 0이 되는지 확인).
- push 순서는 계획 3절 그대로다. `20261113003000`은 되돌릴 수 없다. push 전에 운영자 덤프와 원격 읽기 전용 수 확인이 필요하다(면접 단계 행 0, 면접 작업 queued/running, 지울 사용량 행, `return_target` job_interview 행).
