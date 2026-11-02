# W4 API 구현 노트 (모의 면접·보드 연결)

커밋, 원격, 배포, 실제 공급자 호출, `supabase db reset` 없음. 로컬 스택에서 내가 만든 시험 계정만 썼고, 끝날 때 지웠다(통합 시험 계정은 시험이 스스로 지운다).

## 연결한 함수
| 파일 | 함수 | 경유 |
|------|------|------|
| `lib/data/interviews.ts` | `listInterviewSessions`, `getInterviewSession` | 새 `lib/data/interview-rows.ts` (직접 조회, `resolveSessionRun`, `get_interview_grading_decisions`, `get_interview_question_reveals`) |
| `lib/data/interviews.ts` | `startInterviewSession`, `submitInterviewSession`, `restartInterviewSession` | `services/interview/start` + `interviewStartDeps` (라우트와 같은 호출) |
| `lib/data/interviews.ts` | `saveInterviewAnswer`, `abandonInterviewSession`, `markResultViewed` | `server/actions/interview` |
| `lib/data/deletion.ts` | `getInterviewSessionDeletionImpact`, `deleteInterviewSession` | 조회, `server/actions/interview` |
| `lib/data/applications.ts` | `moveApplicationStage`, `setApplicationOutcome`, `updateApplicationProject` | 새 `lib/data/board-real.ts` → `server/actions/application` |
| `lib/data/applications.ts` | `getBoard` | `listApplicationProjects`(W3 연결)를 단계별로 묶음. 미리보기·실제 모두 이 경로 |
| 수정 없음 | `regradeFailedAnswers`, `startRemainingQuestions`, `getLatestJobFor`, `retryAiJob`, `cancelAiJob` | W1에서 이미 실제. 흐름으로 확인 |
| 수정 없음 | `lib/data/interview-grading.ts` | 화면 미리보기·`clearsNewResultOnView`·`hasNewResult`가 그대로 쓴다. `grading`은 실제 경로에서 RPC 값이고 이 파일로 다시 계산하지 않는다 |

서버 쪽 변경:
- `services/interview/start.ts`: 새 `restartInterviewSession`. `시작하기`와 같은 판정(직무 readiness, 연결·키·동의)을 **그만두기 전에** 하고, 그 뒤 abandon → start. 이미 진행 중이 아닌 세션이면 새 세션만 만든다.
- `MarkInterviewResultViewedResult`에 `changed` 추가(RPC 값을 전달, 추가 필드뿐).

### 왜 Action이 아니라 직접 조회인가
화면은 `InterviewSessionRow`·`InterviewSessionDetail`로 행 필드와 저장 `result`를 그대로 읽는다. `getInterviewResult`의 camelCase 뷰에는 이 값이 없고, 첫 열람 표시 부수 효과도 있다. S-22의 표시는 화면 effect가 `markResultViewed`로 따로 부른다.

### 변환에서 정한 것
- `status`·`generation_status`는 **실효 값**이다. 작업이 끝난 `generating`·`evaluating` 행은 `failed`·`evaluation_failed`로 내려간다. 판정 RPC와 같은 규칙이다.
- `grading`은 RPC 값이고 제출한 세션만 묻는다. `failed_answer_count`는 RPC의 `regrade_target_count`(완료·채점 실패 행만).
- 사용자 권한이 없는 컬럼은 조회하지 않는다. `intent`는 제출 뒤 RPC 값, `good_answer_signals`는 항상 `null`.
- `consistency_notes`를 문자열로 변환(`spec-gaps` ㉘). 안 하면 S-22가 렌더 오류로 깨진다.
- 잘못된 UUID 경로는 조회 없이 `null`·`[]`.

## 연결하지 않은 함수
| 함수 | 이유 |
|------|------|
| `row`, mock 분기 전부 | `?state=` 미리보기용으로 유지 |
| `opts.fail`, `opts.rate_wait`, `input.fail` | 미리보기 전용 인자. 실제 분기는 무시 |

`src/types/db.ts`, 페이지, `src/components/`, `src/lib/mock/`, W1이 금지한 공용 파일은 건드리지 않았다.

## ㉕·㉖ 결론
- ㉖: 코드 수정 없음. S-33 버튼이 뜨는 조건과 실제 수락 조건이 같다. 생성 완료 뒤에는 `null`.
- ㉕: 영향 없음.
둘 다 `spec-gaps.md`에 닫았다. 새 항목은 ㉘~㉜.

## 실제 행으로 돌린 것
### 1. 데이터 함수 + 로컬 스택 (`lib/data/interviews.integration.test.ts`, 14건 통과)
대체한 것은 세션(쿠키 없음)과 공급자(스크립트 응답)뿐이다. AI-01·05·06·07 파이프라인, 작업 실행기, RPC는 진짜다. 시험 계정은 `record_consents`로 동의시켰다(⑲).

| 항목 | 결과 |
|------|------|
| 세션 시작 → 질문 생성 → 자동 저장 → 제출 → 채점 → 결과 | 통과. 제출 전 `intent`·`good_answer_signals` 노출 없음, 제출 뒤 `intent` 공개 |
| 판정표: `evaluation_failed` + 대상 ≥ 1 → `regrade` | 통과. 표식 유지, 다시 채점으로 나머지만 채점 후 완료 |
| 판정표: `evaluation_failed` + 대상 0 + 성공 ≥ 1 + 종합 실패 → `resummarize` | 통과. 새 작업에서 AI-07 1회만(사용 기록 1건) |
| 판정표: `evaluation_failed` + 대상 0 + 성공 ≥ 1 + 종합 입력 원인 → `input_only` | 통과. 원인은 종합, 표식 해제, 라우트 거부 |
| 판정표: `evaluation_failed` + 대상 0 + 성공 0 → `input_only` | 통과. 원인은 답변 |
| 판정표: `completed` + 대상 ≥ 1 → `regrade` | 통과 |
| 판정표: `completed` + 대상 0 + 입력 원인 답변 → `input_only` | 통과. 다시 채점 거부에 `cause` |
| 판정표: 그 밖 → `none` | 통과. 전부 미응답 → `not_scored`, 작업 없음 |
| S-22·S-37 일치 | 표의 모든 행에서 상세와 목록의 `grading`·`failed_answer_count`·`has_new_result`가 같음 |
| `markResultViewed` | 판정별 `changed`, L-01 배지 수가 1 줄어듦 |
| 남은 질문(㉖), 취소 후 실효 `failed`, 같은 행 재시도 거부 | 통과 |
| 다시 시작: C-09·연결 없음·키 무효에서 세션 그대로 → 통과 시 그만둠 + 새 세션 | 통과. 동의 필요 거부는 같은 게이트(`forUser`)지만 이 시험은 정적 컨텍스트라 직접 돌리지 않음 |
| 삭제 영향·삭제, 다른 사용자 격리 | 통과 |
| 보드: 단계 이동, 면접 열 프롬프트(진행 세션 있음·없음), 같은 단계, 전형 종료 + 결과, 종료 해제, 마감일, `getBoard` | 통과 |
| `?state=` 미리보기 | 읽기·쓰기 모두 mock, 실제 행 변화 없음 |

### 2. `next start` + HTTP (실제 세션 쿠키, 임시 시험 계정)
- 페이지 27개 응답 200, 오류 표식 없음: S-37, S-39, S-13, S-20, 상태별 S-22·S-33(진행, 그만둠).
- 판정별 S-22 HTML에 문구 확인: "실패한 답변 1개 다시 채점", "종합 평가 다시 정리", 입력 원인 문구 2종("안전 정책", "공급자 한도").
- Server Action 실제 호출: `saveInterviewAnswerAction`, `getAnswerSheetStateAction`, `moveApplicationStageAction`, `setApplicationOutcomeAction`(`not_closed` → `null`), `getInProgressSessionAction`, `markInterviewResultViewedAction`, `regradeFailedAnswersAction`(거부 값), `abandonInterviewSessionAction`, 삭제 영향·삭제. 반환 뒤 REST로 행 확인.
- 시작·제출·재시도 Action은 HTTP로 부르지 않았다. 작업이 공급자 호출까지 갈 수 있어서다. 이 경로는 위 1번에서만 확인했다.

## 단위 시험만 / 하지 않은 것
- **브라우저 확인 없음.** 클릭, 드래그, 폴링 전환, S-22 effect의 표식 해제, C-14 팝업 표시는 눈으로 보지 못했다. HTTP로 Action과 HTML까지만 봤다.
- **실제 SSE·실제 공급자 호출 없음.** 채점은 스크립트 공급자다.
- 동의 필요(`ai_consent_required`) 거부를 다시 시작 경로에서 직접 돌리지 않았다.
- 무료 등급 순차 실행은 W4 흐름에 없다(기존 `job.test.ts`).
- 근거 칩은 W3의 `getEvidenceForOwners`를 그대로 쓰며 내 시험에서 내용을 검사하지 않았다.
- `toUiInterviewPrompt` 등 변환은 별도 단위 시험 없이 흐름 시험으로 확인했다. `toUiEvaluationResult`만 단위 시험이 있다.

## 시험 결과
| 명령 | 결과 |
|------|------|
| `pnpm typecheck` | 통과 |
| `pnpm lint` | 오류 0, 경고 0 |
| `pnpm build` | 성공 |
| `pnpm test` | 2회 실행 모두 `src/lib/data/w3.integration.test.ts`만 실패. 1회차 6건, 2회차 4건(총 1,595건 중 1,591건 통과). 내 파일이 아니고 실행 사이 건수가 바뀌어 W3 진행 중 작업으로 본다. 원인은 조사하지 않았다. 드래프트·JD 쪽 시험이고 보드·면접 함수 실패는 아니다 |

## UI 요청
1. **S-33 취소한 생성(㉚)**: 작업이 `canceled`이고 질문이 0개면 화면이 공급자 오류 문구를 보이고 같은 행 재시도를 보내 거부된다. `job.status === "canceled"`면 `startRemainingQuestionsAction`으로 보내고 문구도 바꾸는 편이 맞다. 서버 쪽은 이미 동작한다.
2. **S-22 일관성 메모(㉘)**: 인용·근거를 보이려면 UI 타입과 카드 변경이 필요하다. 지금은 본문만 나온다.
3. **`deleteInterviewSessionAction`(㉛)**: 이미 지워진 행이면 실패 토스트가 나온다. 목록을 다시 읽게 할지 UI에서 정하면 된다.

## 다른 engineer와 겹친 곳
- `applications.ts`는 W3와 같이 고쳤다. 내 몫은 위 네 함수와 `board-real.ts` import뿐이고 W3가 내 수정 위에 얹었다.
- `updateApplicationProject`(마감일 포함)는 지시 범위의 "deadlines"로 내가 연결했다. S-31 이름·메모 수정도 같은 함수를 지난다.
- 개발 서버(포트 3000)가 내 확인 도중 한동안 모든 면접 경로에 500을 돌려주어 `next start`(3104)로 옮겼다. 파일이 동시에 바뀌던 때라 원인은 확정하지 못했다. 끝에 `/sign-in`은 200이다. 3104는 종료했다. `pnpm build`가 공유 `.next`를 다시 썼으므로 다른 engineer가 띄운 `next start`는 재시작이 필요할 수 있다.
