# R2 백엔드 QA 리포트 (라운드 1)

대상: 같은 행 다시 시도 = 활성 공급자 (A1 변경·A1 세부·R-63·R-64). 기준 문서: 갱신된 기획 문서(`planning-backend-gaps-3192d0/docs/planning/`) DM 2.9.1 경우 (1)/(2)·2.11.7, AI C-11.4·공통 실패 처리, decisions A1 / A1 세부 / R-63 / R-64 / `[가정]` 면접 질문 행 다시 열기.

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `pnpm -s typecheck` |
| lint | 통과 | 경고 0 |
| vitest | 통과 | 90 파일, 1433개, skip 0 (로컬 Supabase 통합 포함, R2 마이그레이션 `20261106000100` 적용 상태 확인) |
| pgTAP | 통과 | `supabase test db` 45 파일, 2150개 |
| build | 통과 | `pnpm -s build` (Compiled successfully) |

## 확정 규칙 1~4 확인
| 규칙 | 결과 | 근거 |
|------|------|------|
| 1. 모든 재실행 = 누른 시점의 활성 공급자·등급, 진행 중 작업만 시작 공급자 고정 | 통과 (QA-01 경쟁 예외) | `runner.ts` retryJob이 `providerContext.forUser()`로 활성 연결을 읽고 `resolveModel(활성, def.modelTier)`; RPC가 `profiles.active_ai_provider` + 그 키 행에서 공급자·등급을 다시 읽어 씀(`migration:107-122,137-148`). 가드 트리거가 `provider`·`model_tier`·`connection_tier` 변경을 `failed → queued`에서만 허용(`migration:229-236`), pgTAP 294-298행 |
| 2. 같은 행 다시 시도: 다르면 `step_outputs` 비움 + 결과 행 전부 다시 엶, 같으면 유지 + 실패 행만, 이전 세대 완료 `stale_run`, 결과 행·세션 메타 = 새 실행 값 | 통과 (가정 ②③ 포함) | `migration:125-188`. 인사이트: `failed` 행 → `generating` + 새 메타, `complete_insight`가 `provider`·`model`·tier를 작업 행에서 씀(`s6_insight_rpcs.sql:350-357`). 질문: 세션 질문 삭제 + `generating`, `complete_interview_questions`가 `question_provider = v_job.provider`·`question_model`을 씀(`r1_interview_question_set_report.sql:83-85`). 평가: 이 작업의 `answer_evaluations` 전부 `pending`, 세션 `evaluating`, `evaluation_provider`/`evaluation_model` 갱신. 같은 공급자: `step_outputs` 유지, `_meta` 교체 + 옛 partials 보존(`migration:127-133`), 기존 begin_*의 세대 검사 재개. 옛 세대 완료 `stale_run`: pgTAP 193/229/372/458행. 사용 기록 공급자 = 새 공급자: `runner.integration.test.ts` R2 "another active provider"(usage `openai`×2) |
| 3. 거부 코드 경로 ② 409 `key_missing`/`ai_consent_required`/`key_invalid`, 행 `failed` 유지 / 경로 ① `ai_not_connected`/`ai_consent_required`/`key_invalid` | 통과 (QA-03 순서 차이) | TS 사전 확인(`runner.ts` retryJob) + RPC 재판정(`migration:107-120`) + `errors.ts` 매핑(409). 통합 테스트가 DB 쪽 3코드를 실제로 확인(TS 정적 문맥은 통과시키고 RPC가 거부). 경로 ①은 변경 없음, 요청 범위 경로의 `key_missing` 합침은 spec-gaps R2 (api) ①로 넘어감 |
| 4. 새 작업 재실행은 활성 공급자 | 통과 | 인사이트 다시 생성·요청 범위 재생성·다시 채점·남은 질문·다시 보내기 모두 `startJob`/`forUser()` 경로, 이번에 바뀐 것 없음 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM 2.9.1·2.11.7 ↔ 마이그레이션 | 통과 (가정은 spec-gaps R2 (db) ①~⑦) | — |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과: `database.types.ts:995` `retry_ai_job` Args 5개 = SQL 시그니처, 호출 인자 이름 일치(`supabase-store.ts` requeueFailed) | — |
| Q3 | RPC 시그니처 ↔ 호출자 | 통과: 반환 `{requeued:false,status,run_generation}` → `parseRetryResult` null → 러너가 다시 읽어 진행 중이면 따라가기, 아니면 409 `ai_job_not_retryable`. `{requeued:true,restarted,provider,connection_tier,run_generation}` 키 이름 일치, 형식 어긋나면 500. 단 활성 공급자 경쟁 | QA-01 |
| Q4 | RPC raise ↔ 오류 매핑 | 통과: `ai_job_not_found`(404), `not_authenticated`(401), `key_missing`·`key_invalid`·`ai_consent_required`·`ai_job_not_retryable`(409), `invalid_ai_metadata`·`invalid_run_meta`(500 internal), 23505 → `conflict` → 진행 중 작업 찾기. 죽은 매핑 없음 | — |
| Q5 | 계약 ↔ 핸들러 | 통과: `RetryAiJobResponseSchema` = `{jobId, reused, inProgress, restarted}`, 상태 응답 `retry: {provider|null, fromScratch} | null`(canRetry일 때만, 요청 범위 유형은 fromScratch false). 화면 연결은 "연결 대기" | QA-04 (문서) |
| Q6 | SSE | 해당 없음 | — |
| Q7 | AI 출력 ↔ 저장 | 해당 없음 (파이프라인 변경 없음; 인사이트 partials는 `step_outputs._meta.partials`에만 있어 restarted 때 함께 버려짐 확인) | — |
| Q8 | enum DB ↔ TS | 통과: `model_tier` CHECK 3값, `AI_PROVIDERS`·`CONNECTION_TIERS`로 반환 검증 | — |
| Q9 | 작업 종료·사용 기록 | 통과: 거부 경로 공급자 호출 0·사용 기록 0(단위·통합), restarted 경로 두 단계 재호출·사용 기록 새 공급자, 재시도 예산 새로(`p_run_meta` = `{runBase, waitBase: retry_wait_total_ms, retries:{}}`) | QA-01 (경쟁 시 `model_not_available`) |
| Q10 | 보안·개인정보 | 통과: `retry_ai_job` execute = app_ai_writer만(`grants.test.sql` R2 행렬, `retry_ai_job.test.sql:87-95`), authenticated 불가. definer + `search_path = ''` + 모든 조회에 `user_id = private.current_uid()`. 키 행은 `status`·`connection_tier`만 읽음(암호문 없음). 새 로그(`ai_job.retried`, `ai_job.retry_provider_race`)는 id·공급자·세대만. career 테이블 쓰기 없음 | — |
| Q11 | UI ↔ 백엔드 | 해당 없음 (UI 연결 대기) | — |

## 이슈

### QA-01 [Major] 활성 공급자 경쟁: 새 공급자 작업에 옛 공급자의 모델 id가 기록됨
- 담당: db-engineer(RPC 시그니처·pgTAP) + api-engineer(호출자·매핑·테스트)
- 근거:
  - `src/server/jobs/runner.ts` retryJob: `forUser()`로 읽은 `context.provider`로 `model = resolveModel(context.provider, modelTier)`를 정한 뒤 `store.requeueFailed`(RPC) 호출. 사이에 사용자가 다른 탭에서 활성 공급자를 바꾸면
  - `supabase/migrations/20261106000100_r2_retry_ai_job.sql:107,137-143`: RPC는 새 활성 공급자를 `provider`로, 호출자가 준 `p_model`(옛 공급자 모델 id)을 `model`로 같은 행에 씀. 서로 어긋난 `(provider, model)` 쌍을 막는 검사가 없음.
  - `runner.ts`는 `result.provider !== context.provider`를 감지하고도 로그(`ai_job.retry_provider_race`)만 남기고 `scheduleRun`으로 실행을 계속함.
  - 결과: 공급자가 모르는 모델 id → 404 → `model_not_available`(`openai.ts:202`, `gemini.ts:176`, `anthropic.ts:165`). 이 원인은 `KEY_FAILURE_CAUSES`(`provider-context.ts:69-75`)라 사용자의 **새 키**에 `last_failure_cause = model_not_available`이 남아 설정 화면이 키 문제처럼 보이고, 작업은 다시 실패한다. 처음부터 다시 도는 경우라 결과 행을 이미 다시 열어 둔 상태에서 실패한다.
  - 창은 좁지만(동의·키 메타 읽기 몇 번) 탭 두 개로 재현 가능하고, 감지한 뒤 알고도 진행한다는 점에서 "드묾"으로 둘 일이 아니다.
- 수정 제안:
  1. db: `retry_ai_job`에 `p_expected_provider text`(필수)와 `p_expected_connection_tier text`(선택, 배지와 판정을 맞추려면 권장)를 더한다. 연결 게이트 통과 후 `v_active is distinct from p_expected_provider` (또는 등급 불일치)면 행을 바꾸지 않고 `raise P0001 'ai_connection_changed'`. pgTAP: 불일치 → 거부·행 `failed` 그대로·결과 행 그대로.
  2. api: 호출 인자 추가, `ai_connection_changed`를 잡으면 `forUser()`를 한 번 다시 읽어 RPC를 한 번만 다시 부르고, 그래도 어긋나면 409 `ai_connection_changed`(재시도 가능, 문구 "AI 연결이 바뀌었어요. 다시 시도해 주세요")로 답한다. `errors.ts` 매핑 + 단위 테스트(MemoryJobStore가 RPC 안에서 활성 연결을 바꾸는 경우). `retry_provider_race` 로그 분기는 없앤다.
  3. 생성 타입 재생성.
- 상태: 수정됨(라운드 2 확인 완료)

### QA-02 [Minor] 면접 질문·채점의 "다른 공급자 다시 시도"에 TS 통합 테스트 없음
- 담당: api-engineer
- 근거: `runner.integration.test.ts` R2 describe와 `insight.integration.test.ts`는 인사이트만 다룬다. 면접 쪽은 `retry_ai_job.test.sql:337-470`(pgTAP)로 DB 동작만 확인됐다.
- 판단: Minor. TS 면접 단계는 저장된 질문을 DB에서 다시 읽고(`interview/job.ts:396` `existingQuestions`) 채점은 `begin_interview_evaluation`의 `answers_to_evaluate`를 따르며, 둘 다 진행 상태를 `_meta.partials`에만 둔다. RPC가 질문을 지우고 partials를 버리므로 코드상 어긋남은 찾지 못했다. 다만 이 경로는 "질문 삭제 + partials 버림 + `next_sequence = 1` + `complete_*`의 `question_provider` 기록"이 함께 맞아야 R-63이 지켜지는 곳이라 회귀 위험이 인사이트보다 크다.
- 수정 제안: 로컬 DB 통합 1건씩 — (a) 질문 2개 저장 후 실패한 `interview_questions` 작업을 다른 활성 공급자로 다시 시도 → 질문이 1번부터 새로 저장되고 세션 `question_provider`/`question_model` = 새 값, 옛 공급자 질문 0개. (b) 성공 1·실패 1인 `interview_evaluation` 작업을 다른 공급자로 → 두 답변 모두 다시 채점, `answer_evaluations.provider`·세션 `evaluation_provider` = 새 값, 사용 기록 공급자 = 새 공급자.
- 상태: 수정됨(라운드 2 확인 완료)

### QA-03 [Minor] 경로 ② 판정 순서가 TS 사전 확인과 RPC에서 다름 (키 무효 + 동의 필요가 겹칠 때)
- 담당: api-engineer
- 근거: `src/server/services/ai-connection/keys.ts` `forUser()`는 동의를 먼저 보고 `ai_consent_required`를 던진 뒤에야 `keyStatus`를 돌려준다. `runner.ts` retryJob의 `key_invalid` 판정은 그 뒤. RPC(`migration:112-120`)와 `check_ai_run_allowed`는 `key_missing → key_invalid → ai_consent_required` 순서. 둘 다 해당하면 TS는 `ai_consent_required`(C-21 재동의)를, DB는 `key_invalid`(키 교체)를 고른다 — 사용자는 재동의를 한 뒤 다시 `key_invalid`를 받는다.
- 수정 제안: retryJob 사전 확인을 RPC와 같은 순서로(키 메타를 먼저 읽어 `invalid`면 `key_invalid`, 그다음 동의). 또는 TS 사전 확인을 없애고 RPC 판정에 맡긴다(어차피 행 잠금 아래에서 다시 판정함; 모델 결정을 위해 공급자는 필요하므로 `peekActive` + QA-01의 기대 공급자 검사로 충분). 단위 테스트 1건.
- 상태: 수정됨(라운드 2 확인 완료)

### QA-04 [Minor] `JobStore.requeueFailed` 주석이 실행 역할을 "user session"이라 적음
- 담당: api-engineer
- 근거: `src/server/jobs/types.ts` requeueFailed 주석 "RPC `retry_ai_job`, user session" ↔ `migration:202-203`(app_ai_writer만 execute), `supabase-store.ts`(app_ai_writer 클라이언트). 동작 문제는 없고, 다음 사람이 사용자 세션 클라이언트로 부르면 42501로 깨진다.
- 수정 제안: "app_ai_writer (forUser scope, owner = JWT sub)"로 고친다.
- 상태: 수정됨(라운드 2 확인 완료)

## 확인만 하고 이슈로 두지 않은 것
- 실행 역할을 계획의 `authenticated` 대신 `app_ai_writer`로 바꾼 것: 사용자가 `p_model`·`p_run_meta`를 넣지 못하게 하는 편이 안전하다. authenticated·anon·service_role 실행 불가를 pgTAP로 확인.
- `restarted` 판정을 공급자·등급만으로 한 것(spec-gaps R2 (db) ⑥): 문서 문구("활성 공급자·등급")와 같다. 배지(`retryPreviewOf`)도 같은 기준.
- 완결된 결과 묶음(인사이트 `ready`, 질문 `ready`, 평가 `completed`)을 다시 열지 않는 것(⑦/③ 가정): 섞일 결과가 없으므로 R-63 취지와 충돌하지 않음. 기획 확인은 spec-gaps에 이미 있음.
- 다시 채점(새 작업)으로 앞 작업의 성공 평가가 다른 공급자 것으로 남는 경우: R-63은 "그 작업이 저장한 결과 행"만 말하므로 범위 밖.
- 인사이트 행이 끝 트리거의 `skip locked` 때문에 `generating`으로 남은 채 작업만 `failed`인 경우: RPC는 그 행을 건드리지 않지만 `complete_insight`가 `generating` 행을 받고 공급자 메타를 작업 행에서 쓰므로 결과는 새 공급자로 맞음.
- `input_hash` 비우기(⑤): 비용만 영향, 정확성 문제 없음.

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- 새로 넘긴 것 없음. db ①~⑦, api ①~⑤가 이미 "2026-11-06 · R2"에 있다. QA-01이 고쳐지면 api ④(경쟁 `[가정]`)는 해소로 표시해야 한다.

---

# R2 백엔드 QA 리포트 (라운드 2)

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | 경고 0 |
| vitest | 통과 | 90 파일, 1439개(+6), skip 0, 로컬 Supabase 통합 포함 |
| pgTAP | 통과 | 45 파일, 2158개(+8) |
| build | 통과 | `pnpm -s build` |

## 이슈 재확인
| 이슈 | 결과 | 근거 |
|------|------|------|
| QA-01 [Major] 활성 공급자 경쟁 | 수정됨(확인 완료) | RPC 7인자 `(…, p_run_meta, p_expected_provider text, p_expected_connection_tier text default null)`. 키·동의 게이트 뒤, 행 갱신 전에 불일치면 P0001 `ai_connection_changed`(`migration:131-134`), 인자 검사에 공급자·등급 값 범위 포함(105-106행). 생성 타입 `database.types.ts:996` 일치, 로컬 DB에는 7인자 함수 하나만 있음(`pg_proc` 확인), execute = app_ai_writer만(`migration:217-219`). TS: `RequeueFailedInput.expectedProvider`·`expectedConnectionTier`가 필수 타입이고 store가 `p_expected_provider`·`p_expected_connection_tier`를 **늘** 넘김(`supabase-store.ts:317-318`) — 기본값 null 경로를 쓰지 않음. 러너가 `ai_connection_changed`면 한 번 다시 읽어 새 모델로 다시 부르고, 또 어긋나면 409(`errors.ts:47`). 옛 `retry_provider_race` 분기 삭제. pgTAP: 공급자·등급 불일치 거부, 작업 행·결과 행 그대로(`retry_ai_job.test.sql:177-197`). 단위: 재호출 성공, 두 번 어긋나면 409·행 failed·실행 예약 없음(`runner.test.ts:872,895`) |
| QA-02 [Minor] 면접 TS 통합 테스트 | 수정됨(확인 완료) | `interview.integration.test.ts`: 질문 2개 저장 후 실패 → openai로 다시 시도 → 옛 질문 0, 새 질문 3개, 세션 `question_provider`/`question_model` = openai. 채점 성공 1개 후 실패 → openai로 두 답변 모두 다시 채점, 종합·세션 `evaluation_provider`·사용 기록 3건 모두 openai |
| QA-03 [Minor] 판정 순서 | 수정됨(확인 완료) | retryJob이 `peekActive`(동의 규칙 없음, `ProviderContext` 반환)로 `key_missing → key_invalid`를 먼저 보고 그다음 `forUser`(동의). 단위 `runner.test.ts:1072`(키 무효 + 동의 필요 → `key_invalid`, RPC 호출 0). 경로 ①(`startJob`)의 순서는 바꾸지 않음 — 2.11.7 표가 순서를 정하지 않아 이슈로 두지 않음 |
| QA-04 [Minor] 주석 | 수정됨(확인 완료) | `types.ts:186-187` "app_ai_writer — forUser-scoped client, owner = JWT sub; the user session can't execute it" |

## 회귀 확인
- 409 `ai_connection_changed`·경로 ② 거부: retryJob은 RPC 전에 공급자 호출·사용 기록·실행 예약을 하지 않는다(BYOK, 서비스 쪽 예약 없음 — D-34). RPC 거부는 트랜잭션 롤백이라 작업 행·결과 행(인사이트·질문 삭제·평가 pending 전환 포함)이 바뀌지 않는다(행 갱신·다시 열기는 모두 불일치 검사 뒤). 단위 테스트가 두 번째 불일치 때 `scheduleRun` 없음과 공급자 호출 0을 확인.
- 상태 응답 `retry` 미리보기: `peekActive` 반환형이 `ProviderContext`로 넓어졌지만 `retryPreviewOf`는 `provider`·`connectionTier`만 쓰고 오류는 null로 삼킨다 — 계약 변화 없음.
- 진행 중 작업 따라가기(23505 → `FollowJob`)는 첫 시도·재시도 모두 같은 처리.
- 로그 `ai_job.retry_connection_changed`는 작업 id만 담는다. raise `detail`(`공급자/등급`)에도 키·경력 내용 없음.

## 참고 (이슈 아님)
- 마이그레이션 `20261106000100`을 제자리에서 고쳤다. 커밋 전이고 원격에 적용한 적이 없어 문제는 없다. 다만 5인자 버전을 적용했던 로컬 DB를 `db reset` 없이 다시 쓰면 옛 오버로드(기대 공급자 검사 없음, app_ai_writer 실행 가능)가 남으므로 다른 작업 트리의 로컬 DB는 reset해야 한다.
- `ai_connection_changed`는 DM 2.11.7 표에 없는 API 코드다 — spec-gaps R2 (db) ⑧로 기획에 넘어가 있다(UX C-20 문구 필요).

## 남은 이슈
- 없음 (Critical 0 / Major 0 / Minor 0).
