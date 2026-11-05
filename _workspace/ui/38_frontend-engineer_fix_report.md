# 38 런 — frontend-engineer 수정 보고 (foundation + A2 + A4, QA 라운드 1 지적 수정)

- 기준: 브랜치 `claude/qa-36-37-r12-status`, 리뷰 `_workspace/ui/38_ui-qa_36-37_review.md`
- 손대지 않은 곳: `docs/`, `supabase/`, `src/server/`, `src/app/api/`, `src/lib/contracts/` (읽기만)
- 브라우저 확인: **하지 않음**(이번 런 범위 밖). 아래 화면은 `QA 통과 (mock·브라우저 미확인)`까지만.

## 이슈별 수정

| ID | 무엇을 바꿨나 | 파일 |
|----|---------------|------|
| UQ-380 | `GRADE_LABELS` = 우수 / 양호 / 보완 필요 / 미흡 / 해당 없음 (UX C-17 v5.13, OD-I2, 서버 근거 문구와 같은 말). `[UI-가정]` 주석 삭제. 색 매핑은 그대로. 옛 라벨을 단정하는 테스트·fixture는 없었음 | `src/lib/data/labels.ts` |
| UQ-381 | S-22 답변 카드: `score_status === 'scored'`이면 질문 문장 아래에 `answer.score_rationale`(`text-sm text-muted-foreground`) + 기존 고지. mock 답변에도 서버 형식 근거 추가("구체성 양호 · 의도 부합 양호 · 구조 보완 필요 · JD 연관성 해당 없음 → 69점", 미응답 "미응답 · 0점"). 펼치기로 할지는 ui-designer(UQ-387) 몫이라 일단 한 줄로 보임 | `src/components/interviews/result-view.tsx`, `src/lib/mock/fixtures.ts` |
| UQ-382 | `regradeFailedAnswers` real 분기: contracts `INTERVIEW_EVALUATION_REFUSAL_CODES` 전부(`interview_session_read_only` 포함)를 `refused`로 매핑. mock도 서버처럼 `application_project_id === null` 세션은 `interview_session_read_only`로 거절. `InterviewEvaluationRefusalCode`(types/db.ts view model)에 코드 추가. S-22·S-37은 이 코드일 때 서버 문구 토스트 "자기소개서가 삭제된 면접 기록은 볼 수만 있어요." + `router.refresh()`(상수 `INTERVIEW_READ_ONLY_MESSAGE`) | `src/lib/data/ai-jobs.ts`, `src/types/db.ts`, `src/lib/data/labels.ts`, `src/components/interviews/result-view.tsx`, `src/components/interviews/session-list.tsx` |
| UQ-383 | 공통 헬퍼 `applicationObjectPhrase(name, {quoted})`·`applicationDeletedToast(name)`(labels.ts): 이름에 "자기소개서"가 있으면 뒤 " 자기소개서" 생략(U36-7, S-31 제목 규칙). 기본 이름 "새 자기소개서 (2026-11-05)"는 끝 숫자를 한국어로 읽어 을/를을 고름("'새 자기소개서 (2026-11-05)'를 삭제할까요?"). C-05 첫 줄, S-13·S-31(`useDeleteApplication`), S-39(칸반) 토스트가 모두 같은 헬퍼 → "{이름} 자기소개서를 삭제했어요" / "{기본 이름}를 삭제했어요", 셋 다 `toast.success`. 토스트 문구는 `[UI-가정]` 한 곳(헬퍼)에만 남김 | `src/lib/data/labels.ts`, `src/components/common/delete-confirm-dialog.tsx`, `src/components/applications/shared.tsx`, `src/components/board/kanban-board.tsx` |
| UQ-384 | mock 자기소개서 삭제가 실제 트리거와 같게: 남는 근거의 `application_project_id = null`, 지운 JD 요건·공고 문장을 가리키는 근거는 `quote = null`, `source_deleted_at = now`(R11 `application_projects_detach_interviews` + `evidence_mark_source_deleted`) | `src/lib/data/deletion.ts` |
| UQ-385 | `getInterviewSessionLocation` 낡은 주석·`as string \| null` 캐스트 삭제(mock도 null을 그대로 읽음). `MockInterviewSession` 삭제 → `InterviewSession`. 세션 15(삭제된 자기소개서) fixture를 실제 모양(`application_project_id: null`)으로. `row()` 주석 갱신. `DeletionImpact.affected_results.detached_interview_sessions` 필수로(R11 RPC 항상 줌); mock 영향 계산이 이제 이 값을 셈(프로젝트 없는 근거 → 세션 수), writing_chat·산출물은 0. 다이얼로그의 `?? 0` 삭제 | `src/lib/data/interviews.ts`, `src/lib/mock/fixtures.ts`, `src/types/db.ts`, `src/lib/data/deletion.ts`, `src/components/common/delete-confirm-dialog.tsx` |
| UQ-386 | `PANEL_COPY.turnInProgress`·`nothingToRetry` 주석의 `[UI-가정]`·"no spec row" → "UX v5.14 U36-3" | `src/lib/data/career-v45-shared.ts` |
| UQ-389 | 새 `?state=ai-failed-daily-quota-reset`: C-20 `daily_quota_exhausted` + 초기화 줄(현재 시각 정시 + 3시간). `AiErrorNotice`가 `quotaResetsAt`이 없을 때만 미리보기 값을 씀(`useSyncExternalStore`로 `window.location` 읽음 — Suspense 불필요, production·서버에서는 항상 null). 기존 `ai-failed-daily-quota`는 "제목만" 변형 그대로. `/dev/states` 갤러리에 초기화 줄 변형 카드 추가 | `src/lib/preview-state.ts`, `src/components/common/ai-error-notice.tsx`, `src/components/common/dev-state-gallery.tsx` |
| S-16 "정량 성과" | thin 안내를 "입력된 커리어가 적어 판단 근거가 제한적이에요. 프로젝트와 STAR를 더 채우면 더 정확해져요"로. 명세 S-16에 이 문구 행이 없어 `[UI-가정]` 유지(CR-11 사유 주석) | `src/components/applications/insight-view.tsx` |
| 분류 [무시] 서버 판정 (decisions 4.11 UI #3 / DM 11.5 #1, R10) | 브라우저 `localStorage` 기억(`ignored-classification.ts`) 삭제. `career-v45-shared.ts`에 클라이언트용 `isDismissedClassification`(서버 `src/server/ai/schemas/structured-draft.ts`와 같은 규칙: 객체 있음 + 값 null 또는 빈 배열 + `rev ≥ 2`)·`dismissedClassifications(draft)`. 카드(`fillableFields`·분류 행)는 대화의 `structured_draft`에서 무시된 분류를 숨김. [무시]를 누르면 패치가 돌아올 때까지만 그 행을 바로 숨기고(대화 id + 필드 키), 패치가 실패·거절되면 다시 보임. 서버 코드는 import하지 않음 | `src/lib/data/career-v45-shared.ts`, `src/components/career/star-proposal-card.tsx`, (삭제) `src/components/career/ignored-classification.ts` |
| 디자이너 추가 (session-list 넘침) | S-37 표·카드의 세션 이름 줄 부모 flex에 `min-w-0`, 이름 링크에 `min-w-0 truncate`, 새 결과 점 `shrink-0`(배지는 이미 `shrink-0`) → 긴 이름이 넘치지 않고 말줄임 | `src/components/interviews/session-list.tsx` |

## 추가한 테스트

- `src/lib/data/deletion.detach.test.ts` (새 파일): mock 삭제 뒤 남는 세션 근거 `application_project_id = null`·`quote = null`·`source_deleted_at` 채움, 세션 프로젝트 id null (UQ-384) / U36-7 겹침 규칙·을를 (UQ-383)
- `src/lib/data/career-v45-shared.test.ts`: `isDismissedClassification`·`dismissedClassifications`
- `src/lib/data/interviews.deleted.test.ts`: 삭제된 자기소개서 세션 다시 채점 → `interview_session_read_only`, 작업 없음 (UQ-382)

## `?state=` 값

- 새로 추가: `ai-failed-daily-quota-reset` (C-20 공통 — `previewErrorCode`를 쓰는 모든 화면 + `/dev/states`). screen-status 맨 위 표에 기록 필요(리더).

## `[UI-가정]` 남은 것 (이번 변경분)

1. 자기소개서 삭제 성공 토스트 문구 `applicationDeletedToast` — `src/lib/data/labels.ts` (기획 확인 필요 1)
2. S-16 thin 안내 문구 — `src/components/applications/insight-view.tsx`

## 기획 확인 필요

1. **자기소개서 삭제 성공 토스트 문구** (UQ-383): 지금 S-13·S-31·S-39 모두 "{이름} 자기소개서를 삭제했어요"(겹침 생략)로 맞춤. 면접 세션처럼 이름 없이 "자기소개서를 삭제했어요"로 할지 기획 결정.
2. **S-16 thin 안내 문구**: 명세에 행이 없음. "프로젝트와 STAR를 더 채우면 더 정확해져요"로 바꿈 — 확정 문구 필요.
3. (참고) S-22 질문별 근거를 늘 보일지 펼치기로 할지 — design-system 3.16(UQ-387, ui-designer).

## foundation 요청

- 없음(이번 런은 단독 엔지니어라 공용 파일을 직접 고침: `labels.ts`, `types/db.ts` view model, `preview-state.ts`, `ai-error-notice.tsx`, `delete-confirm-dialog.tsx`, `dev-state-gallery.tsx`, mock fixtures, `deletion.ts`).

## 백엔드 요청

- 없음. UQ-382는 데이터 계층 매핑만(contracts 변경 없음). `_workspace/backend/spec-gaps.md`의 분류 "dismissed" 항목은 R10으로 이미 서버에 있음 — 이번에 UI가 그 판정을 쓰게 됨(리더가 spec-gaps 닫기).

## 범위 밖으로 본 것

- `src/components/career/achievement-list.tsx`·`achievement-dialog.tsx`·`input-guide.tsx` G-3·`delete-confirm-dialog.tsx` `achievement` 라벨에 "정량 성과"가 남아 있음 — S-11(폐기) 시절 컴포넌트·라벨. 지금 화면 경로에서 쓰이는지 별도 정리 필요(이번에 손대지 않음).

## 기계 검사

| 검사 | 결과 |
|------|------|
| `pnpm lint` | 통과 (경고 0) |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 통과 — Test Files 147 passed (147), Tests 2386 passed (2386) |
| `pnpm build` | 통과 — Compiled successfully, 46/46 static pages |

브라우저 확인: 안 함.
