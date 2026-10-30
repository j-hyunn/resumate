# R2 API 구현 노트 — 같은 행 다시 시도 = 활성 공급자 (A1 변경·A1 세부·R-63·R-64)

## 바뀐 동작
| 규칙 | 구현 | 파일 |
|------|------|------|
| 1. 다시 시도는 누른 시점의 활성 공급자·등급 | `runner.retryJob`이 작업에 기록된 공급자로 `assertJobRunnable` 하던 것을 없앴다. 새 작업 시작과 같은 `providerContext.forUser()`로 활성 연결을 읽고, 모델은 `resolveModel(활성 공급자, 작업 유형 modelTier)`(새 작업과 같은 라우팅) | `src/server/jobs/runner.ts` |
| 2. 같은 행 다시 시도 → `retry_ai_job` | `store.requeueFailed`가 app_ai_writer 클라이언트로 `retry_ai_job(p_ai_job_id, p_expected_run_generation, p_model, p_model_tier, p_run_meta, p_expected_provider, p_expected_connection_tier)`를 부른다(QA-R2-01 뒤 7인자). `p_run_meta` = `{runBase: 새 세대, waitBase: retry_wait_total_ms, retries: {}}`(partials 없음 — 같으면 DB가 옛 partials를 붙이고, 다르면 버린다). 응답 `{requeued:false}` → null(진행 중이면 그 작업을 따라가고, 아니면 409 `ai_job_not_retryable`) | `src/server/jobs/supabase-store.ts` (`parseRetryResult`), `src/server/jobs/types.ts` (`RequeueFailedInput` / `RequeueFailedResult`) |
| 3. 경로 ② 거부 코드 | TS 쪽 사전 확인(DB와 같은 순서): 활성 공급자·키 없음 → `key_missing`, 활성 키 무효 → `key_invalid`, 동의 → `ai_consent_required`(forUser가 던짐). 모두 409, 작업 행 그대로. RPC가 행 잠금 아래에서 같은 세 코드를 다시 판정 → `mapDbError`에 `key_missing`·`key_invalid`·`ai_consent_required`·`ai_job_not_retryable`(409), `invalid_run_meta`(500 internal) 추가. `ai_job_not_found`·`invalid_ai_metadata`·42501 `not_authenticated`는 이미 매핑돼 있었다 | `runner.ts`, `src/server/db/errors.ts` |
| 경로 ① 확인 | 인사이트·면접 시작과 러너 `startJob`: `ai_not_connected` / `ai_consent_required` / `key_invalid` (409) — 2.11.7과 같다. 바꾼 것 없음. 서류 3종(SSE)·AI 작성 대화(SSE)·JD 추출(동기)은 응답 안에서 `key_missing`으로 합친다 — spec-gaps R2 (api) ① | — |
| 4. 새 작업 재실행 | 인사이트 다시 생성·요청 범위 재생성·다시 채점·남은 질문·다시 보내기는 모두 `forUser()` 활성 연결로 새 행을 만든다. 확인만, 변경 없음 | — |

### 응답 계약 (`src/lib/contracts/ai.ts`)
- `POST /api/ai-jobs/{id}/retry` → `RetryAiJobResponse` = `{ jobId, reused: false, inProgress, restarted }`. `restarted: true` = 공급자나 등급이 달라 처음부터(그 작업의 결과 행은 RPC가 다시 엶). 다른 진행 중 작업을 따라갈 때는 `inProgress: true, restarted: false`.
- `GET /api/ai-jobs/{id}` → `retry: { provider: AiProvider | null, fromScratch: boolean } | null` (`AiJobRetryPreviewSchema`). `canRetry`일 때만 값이 있다. `provider` = 지금 활성 공급자(없으면 null → "AI 연결 필요"), `fromScratch` = 같은 행 유형(insight·interview_questions·interview_evaluation)에서 활성 공급자·등급이 작업과 다를 때. 요청 범위 유형은 늘 false(어차피 새 작업). 표시 전용 — 동의 규칙을 보지 않고(`peekActive`), 읽기 실패는 null로 삼킨다.
- 상태 응답의 `provider`·`modelTier`·`connectionTier` 설명을 "현재 실행 값(다시 시도 때 갱신)"으로 고쳤다.

### 인터페이스 변경
- `ProviderContextSource.assertJobRunnable` 삭제 → `peekActive(userId): Promise<{provider, connectionTier} | null>` 추가(배지용). DB 구현은 `profiles.active_ai_provider` + 그 공급자 키 행의 `connection_tier`, dev-env 구현은 env 값.
- `createStaticProviderContext(context)`는 함수도 받는다(테스트가 활성 연결을 바꾸거나 동의 오류를 던짐). 두 번째 인자(`runnable`)는 없앴다.
- `MemoryJobStore.requeueFailed`가 RPC 의미를 흉내낸다(`activeConnection`, `requeues`, `models`).
- 주석의 "job's fixed provider"를 "현재 실행의 공급자(실행 중 고정)"로 바꿨다(`insight.ts`, `interview.ts`, `provider-context.ts`, 재시도 라우트).

## 결정·가정
- **활성 연결 경쟁 (QA-R2-01 해소)**: RPC가 7인자가 됐다 — `p_expected_provider`(필수)·`p_expected_connection_tier`(러너는 늘 넘김). 러너가 모델을 정할 때 쓴 활성 공급자·등급과 DB의 활성 값이 다르면 RPC가 P0001 `ai_connection_changed`로 거부하고 행은 그대로다. 러너는 활성 연결을 **한 번 더 읽고**(같은 경로 ② 게이트) 새 모델로 다시 부른다. 또 바뀌면 409 `ai_connection_changed`("AI 연결이 방금 바뀌었어요. 다시 시도해 주세요.", `errors.ts`). 로그만 남기고 진행하던 길(`ai_job.retry_provider_race`)은 없앴다. 재시도 때는 `ai_job.retry_connection_changed` 로그.
- **경로 ② 판정 순서 (QA-R2-03 해소)**: retryJob은 `peekActive()`(동의 판정 없이 키 메타)로 `key_missing` → `key_invalid`를 먼저 보고, 그다음 `forUser()`가 동의를 본다(`ai_consent_required`). DB(`retry_ai_job`·`check_ai_run_allowed`)와 같은 순서다. `forUser()` 자체 순서(동의 먼저)는 바꾸지 않았다 — 바꾸면 경로 ① 새 작업 시작에서 키 무효 + 동의 필요가 겹칠 때 코드가 `ai_consent_required` → `key_invalid`로 달라지기 때문(2.11.7 ①은 순서를 정하지 않음). 그래서 순서 변경은 다시 시도에만 둔다. 이를 위해 `peekActive`가 `keyStatus`도 돌려준다(`ProviderContext | null`).
- **`input_hash`**: RPC가 공급자·모델이 바뀌면 null로 비운다(db 노트 ⑤). 러너는 새 해시를 쓰지 않는다 — 해시 입력(경력 스냅샷 등)은 시작 서비스에만 있다. 영향: 그 작업의 성공 결과가 이후 "같은 입력 재사용"에 걸리지 않아 다음 시작이 한 번 더 실행될 수 있다(비용만, 정확성 문제 없음).
- 배지 미리보기는 판정이 아니다: 동의가 필요해도 활성 공급자를 보여 준다. 실제 다시 시도가 `ai_consent_required`로 거부되면 화면은 활성 공급자·등급으로 C-21을 연다(2.11.7).

## AI 파이프라인
- 변경 필요 없음. 단계는 `step_outputs` 체크포인트로만 건너뛰고(restarted면 빈 체크포인트), 결과 행 다시 열기·면접 질문 삭제는 RPC가 한다. 로컬 통합 테스트에서 인사이트·면접 질문·면접 채점 파이프라인이 다른 공급자로 처음부터 다시 돌아 결과를 덮어쓰는 것을 확인했다(QA-R2-02).

## 테스트
- 단위 `src/server/jobs/runner.test.ts` (QA 1차 뒤 추가): 연결이 한 번 바뀜 → 다시 읽고 새 공급자·새 모델로 RPC 재호출, 두 번 바뀜 → 409 `ai_connection_changed`(행 `failed`, 예약 0), 키 무효 + 동의 필요 → `key_invalid` 먼저(RPC 0).
- 단위 `src/server/jobs/runner.test.ts`: 같은 공급자(체크포인트·partials 유지, 모델 라우팅 = heavy 등급), 다른 공급자(처음부터, partials 버림, 두 단계 다시 호출, 로그), 등급만 다름, 거부 3코드(활성 연결 기준, RPC 호출 0·공급자 호출 0), 옛 공급자 키가 없어도 활성 공급자가 괜찮으면 실행, RPC 자체 거부(409·failed 유지), RPC 경쟁(null → 따라가기/409), 요청 범위 유형 거부(기존).
- 단위 `support.test.ts`: `retryPreviewOf`(같음/공급자 다름/등급 다름/활성 없음/요청 범위/재시도 불가), 상태 응답 계약, `loadActiveForPreview`(필요할 때만 읽음, 오류 → null), `parseRetryResult`. `errors.test.ts`: R2 raise 코드 5개.
- 로컬 DB 통합 `runner.integration.test.ts` (R2 describe): 같은 공급자(행 컬럼·`_meta` 갱신, match 유지, 호출 1회), 다른 활성 공급자(`provider`·`model`·`connection_tier` 갱신, `step_outputs`는 `_meta`만, 두 단계 재실행, 사용 기록 공급자 = openai), 경로 ② 거부 3코드(동의 철회 → `ai_consent_required`, 키 무효 → `key_invalid`, 활성 키 삭제 → `key_missing`, 행 그대로).
- 로컬 DB 통합 `interview.integration.test.ts` (QA-R2-02, 별도 지원 프로젝트): (a) 질문 2개 저장 뒤 `billing_required`로 실패한 `interview_questions` 작업을 openai로 다시 시도 → 옛 질문 2개 삭제, 새 출력의 질문 3개가 1번부터, 빈 답변 3개, 세션 `generation_status = ready`·`question_provider = openai`·`question_model` = openai 모델, 작업 `model` 같음. (b) 답변 1개 채점 성공·1개 `billing_required`로 실패한 `interview_evaluation` 작업을 openai로 → 두 답변 모두 다시 채점(공급자 호출 2 + 종합 1), `answer_evaluations.provider`·`session_feedbacks.provider`·세션 `evaluation_provider` = openai, 세션 `completed`, 마지막 사용 기록 3개 공급자 openai.
- 로컬 DB 통합 `insight.integration.test.ts`: 실패한 인사이트 작업을 다른 활성 공급자로 다시 시도 → 같은 `insights` 행이 `ready`·`provider = openai`·새 모델로 덮어써짐(R-63), 화면 조회의 공급자 배지도 openai. 이 테스트로 삭제 영향 개수가 3 → 4로 바뀌었다.
- 테스트 도우미 `src/test/ai-connection-db.ts`: 테스트 사용자에게 키 행(더미 암호문)·동의·활성 공급자를 만든다. `retry_ai_job`이 DB에서 활성 연결을 읽으므로 기존 다시 시도 통합 테스트(러너, QA-S6-01)도 이것을 쓴다. 러너 통합의 다시 시도 작업은 실제 지원 프로젝트 위에서 시작한다(RPC가 insight 작업에 프로젝트를 요구).

## 결과
- QA 1차 수정 뒤: `pnpm typecheck` 통과, `pnpm lint` 경고 0, `pnpm test` 90 파일 1439개 통과(로컬 Supabase 통합 포함, 7인자 `retry_ai_job` 적용 상태).
- QA-R2-04: `types.ts` `requeueFailed` 주석을 "app_ai_writer(forUser scope, owner = JWT sub), 사용자 세션은 실행 불가"로 고쳤다.

## 연결
- UI 없음 → "연결 대기". 화면이 쓸 것: 재시도 응답의 `restarted`, 상태 응답의 `retry`(배지 문구 "{공급자}로 처음부터 다시 해요"는 `fromScratch`일 때).
