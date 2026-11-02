# W0 API 구현 노트 (Q53-1, 2, 3, 5, 6/7, 10, 11 + 주소 계약)

커밋, 원격 적용, 배포, 실제 공급자 호출은 하지 않았다. `src/server/ai/`는 고치지 않았다. `src/proxy.ts`, `src/lib/data/`, `src/types/db.ts`, 페이지, `src/components/`, `src/lib/mock/`, `docs/`도 건드리지 않았다.

## 결정별 변경

| 결정 | 변경 | 파일 |
|------|------|------|
| Q53-1 | 서비스 코드는 그대로다. `key_invalid`·`ai_consent_required`가 생성 RPC에서도 409로 나가는지 확인하고 시험을 더했다 | `db/errors.test.ts`, `application/write.test.ts` |
| Q53-2·11 | 원문 수정 Action·서비스, `getJdView`의 `rawTextEditedAt`·`rawTextEditable`·`rawTextLock`, `ensureJdExtracted`가 `begin` 뒤에 JD를 다시 읽음, 지난 실패 규칙(S-16, S-33) | `actions/application.ts`, `application/write.ts`·`read.ts`·`extraction.ts`, `insight/db.ts`·`read.ts`, `interview/view.ts`·`read.ts` |
| Q53-3 | `job.ts`가 `err.code`를 `fail_answer_evaluation`에 넘김, 라우트 판정을 RPC로 교체, 답변별 `evaluationErrorCode` | `interview/job.ts`·`db.ts`·`start.ts`·`read.ts`, 라우트 주석 |
| Q53-5 | 대상 0개면 `evaluate`를 진행 표시에서 뺌(호출·간격 없음), 같은 행 다시 시도를 연결 게이트 전에 거부, 상태 응답의 `canRetry`·`retry` 끔 | `jobs/types.ts`·`runner.ts`·`status.ts`, `api/ai-jobs/[id]/route.ts`, `interview/job.ts` |
| Q53-6 | 세션 목록 항목에 `grading` | `interview/read.ts`·`view.ts` |
| Q53-7 | 조회 규칙: 중단된 첫 생성은 `composing`, 중단된 다시 생성은 목록에서 빠지고 열면 404. 초안 수에서 경력기술서 `composing` 제외. `draft_not_found`·`invalid_ai_job`은 이미 `TARGET_GONE_RAISES`에 있어 고치지 않고 시험만 더함 | `drafts/read.ts`·`progress.ts` |
| Q53-10 | `getInterviewResult`가 `evaluation_failed`에서도 열람 RPC를 부름(판정은 RPC), `canRetryEvaluation`은 같은 판정 사용 | `interview/read.ts`, 새 `interview/grading.ts` |
| 주소 | `login → /sign-in`, `consent → /consent`, `accountDeletion → /settings/withdraw`, `PROTECTED_PREFIXES` 교체, 옛 경로를 적은 시험 수정 | `contracts/routes.ts`, 시험 5개 |

**계획에 없던 변경 1건**: `ROUTES.accountDeletionFinalize`를 더하고 탈퇴 미완료 이동을 그쪽으로 바꿨다(`session.ts`, `services/auth/index.ts`). 이유는 `spec-gaps.md` ⑩. 되돌리려면 세 곳의 이름만 바꾸면 되지만, 그러면 W1 레이아웃 게이트에서 고리가 생긴다.

`errors.ts`: 새 코드 6개. `interview_evaluation_input_only`는 raise의 `detail`을 응답 `details.cause`로 옮긴다.

## 새 시그니처 (W1~W4 연결용)

### 공고 원문 수정 (W3)
```ts
// src/server/actions/application.ts
updateFailedJdRawText(input: unknown): Promise<ActionResult<UpdateFailedJdRawTextResult>>
// src/server/services/application/write.ts
updateFailedJdRawText(supabase: UserSupabaseClient, input: { id: string; rawText: string }): Promise<UpdateFailedJdRawTextResult>
// src/lib/contracts/application.ts
UpdateFailedJdRawTextInput                // { id: uuid, rawText: 공백뿐 금지, 50,000자 이하, trim 안 함 }
UpdateFailedJdRawTextResult               // { applicationProjectId, jobDescriptionId, extractionStatus: "pending", rawTextEditedAt, aiRunAllowed, warnings }
JD_RAW_TEXT_REFUSAL_CODES                 // 409 5개
JdRawTextLock                             // jd_job_in_progress | jd_raw_text_locked | jd_failure_not_input | jd_has_results
isFailureBeforeRawTextEdit(finishedAt, rawTextEditedAt): boolean
```
저장은 AI를 시작하지 않는다. 그래서 생성과 달리 `shouldExtract`가 없고, "요건 정리하기"는 기존 `POST /api/application-projects/{id}/jd-extraction`이다.

### 응답에 더한 필드
| 타입 | 필드 |
|------|------|
| `JdView` | `rawTextEditedAt`, `rawTextEditable`, `rawTextLock` |
| `InsightView` | `rawTextEditedAt` ("공고를 고쳤어요" 문구는 `extractionStatus = pending`일 때만) |
| `AnswerSheetView.generation` | `failureHidden: "raw_text_edited" \| "job_gone" \| null`. 값이 있으면 `failure`는 null, `canRetry`는 false |
| `InterviewResultView` | `grading` |
| `InterviewResultItem` | `evaluationErrorCode` |
| `InterviewSessionListItem` | `grading` |

### 판정
```ts
// src/lib/contracts/interview.ts
type InterviewGradingDecision = { kind: "regrade"; count: number } | { kind: "resummarize" } | { kind: "input_only"; cause: AiErrorCode | null } | { kind: "none" }
INTERVIEW_EVALUATION_REFUSAL_CODES
// src/server/services/interview/grading.ts
loadGradingDecisions(db, sessionIds): Promise<Map<string, GradingDecisionRow>>  // { sessionId, decision, regradeTargetCount, succeededCount }
```
UI의 `GradingDecision`(`lib/data/interview-grading.ts`)과 같은 모양이다.

### 다시 채점 라우트 (W4)
`POST /api/interview-sessions/{id}/evaluation/retry`는 그대로다. `regrade`·`resummarize`는 새 작업을 만든다. 거부 409: `interview_evaluation_input_only`(`details.cause`), `interview_evaluation_not_retryable`, 그 뒤 연결 코드. `activeJob`이 평가 작업이면 판정 없이 그 작업을 따라간다.

### 작업 진행
종합만 다시 정리: `prepare → summarize → score → complete`. `evaluate` 단계는 실행되어 체크포인트(`succeededCount`)를 남기지만 `progress`에는 나타나지 않는다. 공급자 호출과 무료 등급 간격이 없다. 답변 평가의 공급자 메타는 그대로이고 종합만 활성 공급자로 저장된다.

### 실행기 확장 (`jobs/types.ts`)
- `JobStep.hiddenFromProgress?: (previous) => boolean`
- `JobTypeDefinition.retryBlocked?: ({ db, job }) => Promise<boolean>`: `retryJob`이 연결 게이트 전에 본다
- `toAiJobStatusResponse(job, partial, active, retryBlocked = false)`, `loadRetryBlocked(job, db)`

## 주소 확인 결과

| 경로 | 익명 | 로그인 |
|------|------|--------|
| `/`, `/sign-in`, `/policies`, `/auth/callback` | 통과 | 통과 |
| `/consent` | `/sign-in?next=%2Fconsent` | 통과 |
| `/settings/withdraw`, `/settings/withdraw/finalize` | `/sign-in?next=...` | 통과. 프록시에 동의 게이트 없음 |

`/settings/withdraw/finalize`는 `(public)` 레이아웃이라 셸과 동의 게이트 밖이다. 프록시 단위 시험으로 확인했고, 브라우저로 보지는 않았다. 지금 프록시는 Supabase 환경값이 없는 개발 모드에서 우회한다(W1 끝에서 제거 예정).

## UI 요청

1. **S-02 `?error=auth_callback`**: 콜백 실패 때 서버가 `/sign-in?error=auth_callback`으로 보내는데, 페이지와 `SignInForm`은 `?state=` 미리보기만 읽는다. 지금은 링크 만료 문구가 실제로 나오지 않는다. `?error=auth_callback`을 `link-expired` 표시로 연결해야 한다.
2. **`/settings/withdraw`가 `(dashboard)` 안에 있음**: A7상 동의 게이트 밖이어야 한다(`spec-gaps.md` ⑪). W1에서 레이아웃 게이트가 이 경로를 빼거나, 페이지를 셸 게이트 밖으로 옮겨야 한다.
3. **`/dev/states`**: `PROTECTED_PREFIXES`에 없어 익명으로 열리고 빌드에도 포함된다. 운영 빌드에서 뺄지 정해야 한다.
4. **S-15**: `jd.raw_text_lock`·`raw_text_editable`은 `rawTextLock`·`rawTextEditable`에서 온다. S-33은 `generation.failureHidden`으로 "공고를 고쳤어요" 문구를 고른다. S-16은 `rawTextEditedAt`.
5. **S-22·S-37**: 버튼과 메뉴는 `grading`과 `canRetryEvaluation`으로 판단한다. `canRetryEvaluation`은 평가가 진행 중이면 false이고 목록 항목에는 없으므로, S-37은 `activeJob`도 함께 본다.

## 시험

| 명령 | 결과 |
|------|------|
| `pnpm lint` | 오류 0, 경고 0 |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 92파일 1,526건 통과. 로컬 스택 통합 시험 포함(작업 전 90파일 1,440건) |
| `pnpm build` | 성공 |
| `pnpm db:test` | 50파일 2,335건 PASS. 이번에 SQL을 바꾸지 않았고 회귀 확인용 |

새 시험: `application/write.test.ts`, `interview/grading.test.ts`. 기존 파일에 더함: `db/errors.test.ts`, `application/extraction.test.ts`·`read.test.ts`·`application.integration.test.ts`, `insight/read.test.ts`, `interview/view.test.ts`·`job.test.ts`·`interview.integration.test.ts`, `jobs/support.test.ts`, `drafts/read.test.ts`, `auth/proxy-session.test.ts`, `contracts/routes.test.ts`.

로컬 스택에서 실제 RPC로 끝까지 돈 흐름:
- 입력 원인 실패 → 수정 가능 → 저장 → 문장 재분할 → 재추출 성공 → 다시 잠김. 거부 코드: `jd_raw_text_unchanged`, `jd_raw_text_locked`, `jd_failure_not_input`, `jd_job_in_progress`, 다른 사용자 `not_found`.
- 답변 1개 차단 + 종합 실패 → `resummarize` → 같은 행 다시 시도 거부 → 새 작업(AI-07 1회, 사용 기록 1건) → `completed` + `input_only` → 라우트 409 `details.cause`.

## 실행하지 않은 것

- **`getJdView`의 `jd_has_results` 긍정 경로를 실제 행으로 확인하지 않았다.** 결과 행을 만들려면 AI 작성자 전체 흐름이 필요하고 `service_role`은 insert 권한이 없다. 네 조회가 빈 결과로 오류 없이 도는 것까지는 로컬 스택에서 확인했고, 판정은 `jdRawTextLockOf` 단위 시험, RPC 쪽은 pgTAP이 맡는다.
- `succeeded` + 요건 0개를 로컬 스택 서비스 경로로 돌리지 않았다(단위 시험과 pgTAP만).
- S-33·S-16 지난 실패 규칙은 단위 시험만이다. 조회 컬럼은 통합 시험이 실제로 읽는다.
- 동시성(수정 ↔ 추출 시작 경쟁), 브라우저 확인, 실제 공급자 호출.

## 스펙 차이·가정

`spec-gaps.md`의 "2026-11-02 · W0 (api)" ⑩~⑱.
