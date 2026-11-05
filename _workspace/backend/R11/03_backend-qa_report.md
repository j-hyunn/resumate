# R11 백엔드 QA 리포트 (라운드 1)

- 날짜: 2026-11-05 / 대상: 커밋 안 된 작업 트리(`claude/od-backend-followups-ba655d`), 마이그레이션 `20261113000500`~`001200` 8개, api 1·2단계 변경
- 기준: DM v4.11 §11.6 #1~#15, §2.7.2, §A.12(d14.v1), §2.5.0, §2.5.1, §2.11.6, §7 / AI v4.11 §4.3 / decisions §4.12
- 로컬 DB: 공유 스택의 적용 마이그레이션 목록 = 이 worktree 파일 목록(같음 확인). `db reset` 안 함. 원격 접근·커밋 없음.

## 검사 실행 결과

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck (`next typegen && tsc --noEmit`) | 통과 | |
| lint (`eslint`) | 통과 | |
| vitest | 통과 | 141 파일 / 2,333 테스트, 로컬 DB 통합 테스트 포함(건너뜀 없음) |
| pgTAP (`supabase test db`) | 통과 | 58 파일 / 2,896 assertions |
| 생성 타입 최신성 | 통과 | `supabase gen types --local`과 비교: R11 관련 차이 없음(유일한 차이는 기존부터 있던 `ai_provider_keys_public` 뷰 nullability, HEAD와 같음) |
| 로컬 스모크 | 통과 | `next dev -p 3031`(로컬 스택), 실제 라우트 핸들러·실제 deps 팩토리·쿠키 세션. 아래 표 |
| `p_client_id` 동시 요청 재현 | 실패 재현 | QA-02 |

로컬 스모크(스크립트 `scratchpad/smoke.mjs`, 사용자 2명 생성 후 삭제):

| 경로 | 결과 |
|------|------|
| `POST /api/writing-chats/{id}/turns?retry=1` — 마지막이 답 없는 사용자 메시지(OD-P11), 키 없음 | 200 SSE `event: error` `key_missing`(잠금 상태, `stalled` 아님). `retryTarget`이 대상으로 받아 `nothing_to_retry`가 아님을 확인. 메시지 수 2/2, `message_count` 1/1 그대로, 작업 행 0 |
| 사용자 세션 RLS `delete from application_projects`(OD-I6 트리거) | `completed` 세션 남음(`application_project_id` null, 복사 이름 `스모크사/백엔드`), `in_progress` 세션 삭제 |
| `POST /api/interview-sessions/{분리 세션}/evaluation/retry` | 409 `interview_session_read_only`(연결 게이트 전, 키 없는데도 이 코드) |
| `POST /api/interview-sessions/{분리 세션}/submit` | 409 `interview_session_read_only` |
| 사용자 B가 `interview_sessions`·`evidence_links` `application_project_id is null` 조회 | 0행 / 0행 |
| `auth.admin.deleteUser`(auth 연쇄) 뒤 남은 세션 | 0 |

## 경계면 검사

| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM ↔ 마이그레이션 | 통과 — §2.7.2 컬럼·FK `set null (application_project_id)`·CHECK 3종·트리거(definer, `search_path=''`, 외부 execute 없음 — anon/authenticated/app_ai_writer/service_role 모두 false 확인)·잠금 순서(프로젝트 → JD 읽기 → 세션 id 순 `for update` → 근거 → 작업 연쇄), `get_deletion_impact('application_project')` 모양·셈(데이터 계층 `getApplicationDeletionImpact`·`countsAsDraft`와 같음), `ai_disclosures v2026-11-05` 6행(anthropic 2행 `requires_reconsent=true`, gemini free만 `requires_free_tier_ack=true`, `terms_checked_at=2026-11-05`, `document_path`) | — |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과 — nullable 2곳·복사 컬럼 2개·`backfill_interview_scores`·`p_client_id` 반영, `SESSION_COLUMNS`·`SESSION_SELECT`에 복사 컬럼 | — |
| Q3 | RPC 시그니처 ↔ 호출부 | 통과 — `save_project_page`/`save_project_deliverable` 옛 시그니처 drop(각 1개만 존재), `page-save.ts`가 만들기에서만 `p_client_id` 전달, `getApplicationProjectDeletionImpact` → `p_entity_type: "application_project"`, `complete_interview_evaluation` 새 반환(`score_status` scored/not_scored·`score_value`)을 `db.ts`가 읽음. 단 동시 만들기 경합은 QA-02 | QA-02 |
| Q4 | RPC raise ↔ 오류 매핑 | 통과 — `interview_session_read_only` 409(`errors.ts`) ↔ DB 3곳(begin/save/complete) ↔ 계약 `INTERVIEW_EVALUATION_REFUSAL_CODES`, `free_tier_acknowledgement_required` 23514 → 기존 400, `not_found` 새 경로 404 | — |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 | 이슈 — 동의 계약 zod refine이 R-OD-15/`001200`과 어긋남 | QA-01 |
| Q6 | SSE 이벤트 | 해당 없음(이벤트 이름·모양 변경 없음. `turnFailure`는 상세 DTO 전용, SSE에선 null) | — |
| Q7 | AI 출력 ↔ 저장 | 통과 — 모델 점수 슬롯 무시, `save_answer_evaluation`이 같은 트랜잭션에서 d14.v1로 질문 점수. d14.v1 대조(AI §4.3): 가중 30·30·20·20, 등급 100/75/50/25, `not_applicable` 분모 재배분, `round(numeric)`(양수 .5 올림), 미응답 0/100/`d14.v1`/"미응답 · 0점", 채점 실패 분자·분모·`score_counted_count` 제외, 모두 미응답 = `scored` 0 "질문 N개 모두 미응답, 0점", 응답 ≥1·채점 0 = `not_scored`, 질문·세션 rationale 문구 일치(미응답 0개면 구절 생략은 `[가정]` R11-DB-3) | — |
| Q8 | enum DB ↔ TS | 통과 — CHECK 목록 변경 없음 | — |
| Q9 | AI 작업 출구·사용량 | 통과 — 재시도 턴은 기존 출구 그대로(RPC 거부 → `canceled`, 호출 0 테스트), 분리 세션은 작업 행을 만들기 전에 거부(통합 테스트 작업 0개 + 스모크) | — |
| Q10 | 보안·개인정보 | 통과 — 면접 4테이블·`evidence_links` RLS 전부 `user_id` 기준(프로젝트 null이 접근을 열지 않음, pgTAP + 스모크 B 0행), 사용자 컬럼 쓰기 grant 없음, 새 definer 함수 전부 `search_path=''`, `backfill_interview_scores` execute = service_role만(anon/authenticated/app_ai_writer/app_key_reader false), 새 로그에 본문 없음 | — |
| Q11 | UI ↔ 백엔드 | 통과(경고) — UI 소유 파일 9개 수정은 타입·null 처리만(33줄). 같은 배포 결합 3건은 QA-04 | QA-04 |
| Q12 | 실제 의존성 연결 | 통과 — 스모크가 `createWritingChatTurnDeps`·면접 라우트 실제 팩토리로 돌아 기대 종료 코드(`key_missing`, 409) | — |
| Q13 | 릴리스 준비 | 통과 — 8개 파일이 `20261113000400` 뒤, `-- DESTRUCTIVE` 대상 없음(행·컬럼 삭제 없음; FK 동작 변경·CHECK 2개 삭제는 노트에 "원격 반영 전 확인" 표시), 새 env 없음 | — |

## 이슈

### QA-01 [Major] 동의 계약 zod가 OpenAI·Claude 무료 등급 동의를 여전히 거부 (R-OD-15 미반영)
- 담당: api-engineer
- 근거: `src/lib/contracts/ai-connection.ts:72-75` — `.refine((v) => v.connectionTier !== "free" || v.freeTierAcknowledged)` ↔ `supabase/migrations/20261113001200_r11_consent_free_tier_ack_by_disclosure.sql:33`(인용한 고지 행 `requires_free_tier_ack = true`일 때만 요구) ↔ `src/components/common/data-use-consent.tsx:124,222`(`needsFreeAck = provider === "gemini" && tier === "free"`, 보내는 값 `needsFreeAck && ack`) ↔ `src/lib/data/ai-connection.ts:323`(`freeTierAcknowledged: input.free_tier_acknowledged`) ↔ `src/server/actions/ai-connection.ts:48`(`safeParse` 실패 → `invalid`).
- 실패 시나리오: OpenAI(또는 Claude) 무료 등급 키를 연결하는 사용자가 S-41 ② 동의에서 [다음]을 누르면 화면은 확인 체크박스 없이 `free_tier_acknowledged: false`를 보낸다 → 서버 액션 zod가 400 검증 오류로 막아 DB 가드(이제 허용)에 닿지 못함 → 동의 기록 불가 → 키 등록·AI 기능 전부 잠김. DB 쪽 R11-DB-1 해결이 API 경계에서 무력화된다. 테스트 `ai-connection.test.ts:81-85`는 gemini free만 보고 openai/anthropic free + false 경우가 없다.
- 수정 제안: refine 삭제(판정은 DB 가드와 `consent.ts`가 읽는 `requires_free_tier_ack`에 맡김), 계약 주석 갱신. 테스트 추가: openai free `false` → 계약 통과 + 통합 테스트에서 insert 성공, gemini free `false` → 23514 → 400.
- 상태: 열림

### QA-02 [Minor] `p_client_id` 동시 만들기 두 건 중 늦은 쪽이 자기 행인데 `not_found`
- 담당: db-engineer
- 근거: `supabase/migrations/20261113001000_r11_page_save_client_id.sql:77-84`(재생 판정은 insert 전 `perform … where id = p_client_id`, 잠금 없음) → `:219-223`(`unique_violation` → 무조건 `not_found`). 산출물 `:337-343` → `:356-360` 같음. 재현: 같은 사용자·같은 `p_client_id`로 두 트랜잭션 — A가 insert 후 3초 대기, B가 1초 뒤 호출 → A 커밋 시 B `ERROR: not_found`(`save_project_page … line 202 at RAISE`), 행은 1개.
- 실패 시나리오: 새 페이지에서 저장 요청이 응답 전에 다시 나가는 경우(저장 두 번 클릭, 느린 응답 중 재시도, 첫 AI 메시지 ③의 저장과 겹침) — 행은 이미 그 사용자 것으로 생겼는데 늦은 요청이 404 "찾을 수 없음"을 받아 화면이 저장 실패를 보인다. 멱등 키가 막으려는 바로 그 "응답 유실·재시도"의 동시 변형이다. DM 2.5.1은 "남의 행과 충돌일 때만 `not_found`".
- 수정 제안: `unique_violation` 처리에서 `exists (… where id = p_client_id and user_id = v_uid)`를 다시 보고 참이면 재생 경로(고치기 규칙)로 한 번 다시 진행, 아니면 `not_found`. pgTAP은 동시성 재현이 어려우니 "PK 충돌 직후 같은 사용자 행 → 재생" 분기를 직접 치는 테스트(예: 첫 판정을 건너뛰게 만든 헬퍼 분리)나 노트에 수동 재현 절차를 남긴다.
- 상태: 열림

### QA-03 [Minor] 분리 세션에서 "새 면접(restart)" 경로가 409 대신 404
- 담당: api-engineer
- 근거: `src/server/services/interview/start.ts:188-189` — `session.application_project_id !== applicationProjectId` → `sessionNotFound()`(404). 분리 세션은 프로젝트 id가 null이라 어떤 입력이든 404. DM 2.7.2 가드 표: "이 기업 JD로 새 면접 … 원본 세션이 이 세션이면 `interview_session_read_only`(409)".
- 실패 시나리오: 오래 열려 있던 S-22 탭(삭제 전 로드)에서 [새 면접]을 누르면 "세션을 찾을 수 없음"이 떠 읽기 전용 안내(UX 문구)가 아닌 일반 오류가 보인다. 데이터 손상은 없다(화면은 버튼을 숨기는 게 정상 경로).
- 수정 제안: `loadSessionCore` 뒤 `requireWritableSession(session)`을 먼저 호출(다른 세 경로와 같게) + 단위 테스트 1건.
- 상태: 열림

### QA-04 [Minor] 같은 배포로 묶어야 하는 UI 후속 3건(지금 서버만 바뀜)
- 담당: api-engineer(노트·릴리스 체크리스트 반영) → 리더가 UI(`od-ui`)에 전달
- 근거:
  1. 해시: 서버 `src/server/ai/context-pack/deliverable-chat.ts:193`은 정규화 해시, 화면 `src/lib/data/career-v45-shared.ts:641`은 아직 정규화 없는 해시 → 끝 줄바꿈·CRLF·줄 끝 공백이 있는 본문은 [본문 교체] 때마다 "기준 본문이 바뀐 경우"로 잘못 간다.
  2. 분리 세션 링크: `src/components/interviews/session-status.tsx:67-72`(R11 최소 수정)가 빈 프로젝트 세그먼트로 링크 → S-37에서 분리 세션을 누르면 not found 페이지. S-22 읽기 전용 경로가 UI에 생기기 전까지 끊긴 링크.
  3. 고지 `v2026-11-05`는 마이그레이션 적용 즉시 시행(effective 2026-11-05 00:00 KST) — 화면 고지 본문 모듈이 같은 배포가 아니면 옛 본문으로 새 버전 동의가 기록된다(노트에 이미 있음).
- 수정 제안: 02_api_notes "UI 남은 일"에 1·2를 "배포 차단(같은 PR/배포)"로 표시하고 리더 릴리스 체크리스트(`db push` → UI 머지 순서)에 넣는다. 코드 수정은 UI 소관.
- 상태: 열림(리더 전달)

## 확인만 한 것(이슈 아님)
- OD-I6 트리거: `auth.users` 연쇄 분기(사용자 행 없음 → 그 프로젝트 세션 전부 삭제), `delete_account`·장기 미접속 파기 경로 pgTAP 통과 + 스모크에서 auth 삭제 뒤 0행. 분리 세션은 상태를 `completed` 밖으로 못 바꾼다(CHECK) — 가드 없는 세션 쓰기 RPC(`save_session_feedback`·`fail_answer_evaluation`·`save_interview_question` 등)는 작업 일치 검사가 필요하고 그 작업 행은 프로젝트와 함께 연쇄 삭제되므로 도달 불가.
- `create_interview_session`의 `is distinct from` 비교로 분리 세션 id 재사용 → `session_id_conflict`.
- `backfill_interview_scores`: 멱등(완료 세션은 어느 분기든 `d14.v1` 기록 → 재선택 안 됨), `for update of s skip locked`, `invalid_limit`, 마이그레이션 안에서 호출 안 함.
- OD-P11: `begin_assistant_message`(20261109100900)가 마지막 `user` → 새 assistant 행·`message_count + 1`, `>= 40` 거부 — 재시도 경로가 `appendUserMessage`를 부르지 않음(`turn.ts:336-337`). db·api 결론 일치.
- `turnFailure`: `settleOrphanedStreaming` 뒤 failed 응답의 작업만 조회, 모르는 status/코드 걸러냄.
- body-hash: DM 2.5.0 1~5단계와 일치(맨 앞 줄바꿈 보존은 규칙 밖이라 그대로 — 노트에 명시).

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- 없음(QA-01~04는 코드·릴리스 문제). db-engineer의 R11-DB-1~7은 이미 spec-gaps에 있음.

---

# 2라운드 (재확인, 2026-11-05)

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck / lint | 통과 | |
| vitest | 통과 | 141 파일 / 2,335 테스트(로컬 DB 통합 포함). 한 번에 통과, w3.integration 훅 타임아웃 재발 없음 |
| pgTAP | 통과 | 58 파일 / 2,896 assertions |
| QA-02 동시 요청 재현(두 RPC) | 통과 | 1라운드와 같은 2-트랜잭션 절차: 늦은 요청이 성공(같은 행, `skipped` 빈 배열), 행 1개. 로컬 DB 함수 본문에 수정본 적용 확인 |

## 이슈 상태
### QA-01 [Major] → 수정됨(확인 완료)
- `src/lib/contracts/ai-connection.ts:64-75`: refine 삭제, `freeTierAcknowledged` 기본 false만 남음.
- `src/server/services/ai-connection/consent.ts:159-182`: `needsFreeTierAck`(고지 행 `requires_free_tier_ack` 기준)로 먼저 검사 → `free_tier_acknowledgement_required` 400(`details.field`), 그 뒤 DB 가드가 다시 막음.
- `src/server/db/errors.ts:312-316`: DB 23514 `free_tier_acknowledgement_required` → 같은 코드 400(일반 `invalid_input`보다 먼저). 서비스·DB 두 경로가 같은 코드.
- 계약 목록: 이 저장소의 닫힌 목록은 `APP_ERROR_CODES`(일반 7종)·`AI_ERROR_CODES`뿐이고 슬라이스 코드는 문자열(`ErrorCode`의 `string & {}`)이라 추가할 목록 없음 — `interview_session_read_only`도 같은 방식(계약은 `INTERVIEW_EVALUATION_REFUSAL_CODES`에 있음). 계약 주석에 코드 명시.
- 테스트: `ai-connection.test.ts:85-101`(openai free 계약 통과, 행별 판정), `ai-connection.integration.test.ts:176-182`(서비스 코드·DB 직접 insert 매핑).

### QA-02 [Minor] → 수정됨(확인 완료)
- `20261113001000:221-232`(페이지)·`:364-375`(산출물): `unique_violation` 뒤 같은 사용자 행이면 같은 인자로 함수를 한 번 다시 부름 → 재전송(고치기) 경로, 아니면 `not_found`.
- 반복 가능성 검토: 다시 부르는 것은 `exists(같은 사용자 행)`가 참일 때뿐이다. READ COMMITTED에서는 다시 부른 호출의 첫 판정(새 문장 스냅샷)이 그 행을 보고 insert 없이 update 경로로 가므로 `unique_violation`이 다시 날 수 없다 → 최대 1단계. REPEATABLE READ 이상에서는 처리부의 `exists`가 첫 판정과 같은 스냅샷이라 거짓 → `not_found`(재귀 없음). 실패한 insert는 예외 블록 하위 트랜잭션과 함께 롤백되어 다시 부르기 전에 쓴 것이 없다. 무한 반복 경로 없음.
- 원격에 아직 안 올린 파일을 고친 것이라 순서·`db push` 문제 없음(노트에 기재).

### QA-03 [Minor] → 수정됨(확인 완료)
- `src/server/services/interview/start.ts:190`: `requireWritableSession(session) !== applicationProjectId` → 분리 세션은 409 `interview_session_read_only`, 다른 프로젝트 id는 그대로 404. `interview.integration.test.ts:574`가 확인.

### QA-04 [Minor] → 미해결(리더 전달 항목, UI 소관)
- 바뀐 것 없음: 화면 해시 공통 함수 전환, 분리 세션 S-22 경로, 고지 본문 모듈을 같은 배포로 묶는 일이 남아 있음.

## 결론
열린 이슈: Critical 0 / Major 0 / Minor 1(QA-04, UI·릴리스 결합 — 백엔드 코드 수정 불필요).
