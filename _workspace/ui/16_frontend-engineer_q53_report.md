# 프론트엔드 — 기획 결정 Q53-1~10 반영

> 2026-10-30. 입력: `15_brief_q53.md`, 플로우 v5.4, 데이터 모델 v4.3. mock만 수정, 커밋 없음. `docs/planning`과 테마 파일은 건드리지 않았다. dev 서버는 시작·종료하지 않았다.

## 결과

10건과 "함께 고칠 것"을 모두 반영했다. 임시 처리 UQ-580(S-14 추출 없이 저장)과 UQ-588(S-17 "직접 고르기"로 시작)은 덧대지 않고 제거했다. `runnableKey`, `preview_skip_extraction`, S-14 안내 문구, `AiLock`의 `title={null}`·`actionLabel`, S-22 옛 `InputCausedGradingNotice` 내용이 코드에서 사라졌다.

**작업 방식 한 가지:** 지시는 Edit 도구였지만 작업 초반 첫 묶음(`types/db.ts`, `lib/mock/ai.ts`, `lib/data/ai-jobs.ts`, `lib/data/interviews.ts`, `fixtures.ts` 일부)은 Python 치환 스크립트로 고쳤다. 적용 여부는 grep과 typecheck로 확인했고 그 뒤로는 Edit만 썼다.

## 공용 판정 함수

`src/lib/data/interview-grading.ts`의 `gradingDecision()`이 DM 2.7.1 표 전체다. 저장소 값을 사실로 바꾸는 곳은 `src/lib/mock/grading.ts`의 `gradingFactsOf()` 하나다.

| 사용처 | 어떻게 쓰나 |
|--------|-------------|
| S-22 | `session.grading`만 보고 버튼·안내를 고른다 |
| S-37 메뉴 | `row.grading` |
| 다시 채점 | `regradeFailedAnswers` → `gradingRefusal()` |
| 첫 열람 | `markResultViewed`와 S-22 effect → `clearsNewResultOnView()` |
| 같은 행 다시 시도 | `retryGate` → `regradeTargetIds()` |
| 미리보기 | S-22 `?state=`도 같은 함수를 다시 돌린다 |
| `hasNewResult`·L-01 배지 | 같은 모듈의 `hasNewResult` |

`hasNewResult` 자체는 `result_viewed_at`을 읽기만 한다. 판정은 그 컬럼을 언제 채우는지(`clearsNewResultOnView`)에서 쓰인다. 명세의 표시 조건이 컬럼 기준이라 표를 한 번 더 태우지 않았다.

## 결정별 변경

| # | 변경 | 주요 파일 (`src/` 기준) |
|---|------|-------------------------|
| Q53-1 | S-14 "만들기": 키 무효 → 요청 없이 버튼 아래 C-20, 동의 필요 → 요청 없이 C-21, 동의 뒤 그 만들기를 이어 보냄. `createApplicationProject`는 insert 전에 `key_invalid`/`ai_consent_required`로 거부(경로 ⑥), 화면은 같은 처리. 키 없음·`needs_check`는 그대로. 입력은 기존 브라우저 세션 복원을 사용 | `applications/application-new-form.tsx`, `lib/data/applications.ts`, `applications/_lib/actions.ts` |
| Q53-2 | S-15 "공고 원문 수정" 표 전 행. `update_failed_jd_raw_text` mock(거부 코드 포함), `raw_text_edited_at`, `raw_text_editable`. 저장 시점 이전 실패 숨김: C-03(`failuresAfter`), S-16 문구, S-33 안내, S-37은 원래 표시 없음. S-16·S-17·S-18의 C-20 버튼 연결 | `components/applications/jd-raw-edit.tsx`(신규), `jd-view.tsx`, `applications/[id]/jd/page.tsx`, `lib/data/applications.ts`, `lib/data/ai-feature-status.ts`, `lib/data/jd-raw-text.ts`(신규), `extract-first.tsx`, `insight-view.tsx` |
| Q53-3 | `answer_evaluations.error_code`, 입력 원인 답변은 대상 제외, `interview_evaluation_input_only`, S-22 원인 + "이 기업 JD로 새 면접 시작", 카드에 다시 채점 없음 | `lib/data/ai-jobs.ts`, `components/interviews/result-view.tsx` |
| Q53-4 | 기본 "AI에게 맡기기". 요건 없는 JD: "새 경력기술서" → 추출 → 설정 + AI-11 1회. 동의 필요·키 무효: 설정 화면 먼저, 자동 호출 없음, "AI에게 맡기기"를 누를 때 C-21 / 키 교체. `composing` 복원·연결 직후 복귀도 자동 호출 없음 | `components/applications/drafts-view.tsx` |
| Q53-5 | "종합 평가 다시 정리": AI-06 없음, `prepare`→`summarize`→`score`→`complete`, `{n}` = 대상 수, 대상 0의 같은 행 다시 시도는 `ai_job_not_retryable` | `lib/mock/ai.ts`, `lib/data/ai-jobs.ts`, `result-view.tsx` |
| Q53-6 | S-37 메뉴를 `grading`으로: 채점 실패 행 + 완료인데 실패 답변이 남은 행, 입력 원인만 남으면 없음, 종합만 실패면 "종합 평가 다시 정리" | `components/interviews/session-list.tsx` |
| Q53-7 | 중단: 다시 생성 → 새 행 삭제하고 기존 초안으로, 첫 생성 → `composing`(options 유지)으로 S-17. C-20 없음. `validated`가 먼저면 완료. S-17 "작성 중" 행, 설정 복원, 삭제. 새 초안 시작 때 `composing` 행 제거. S-13·S-31·S-39·C-05 N 제외 | `lib/data/drafts.ts`, `draft-editor.tsx`, `drafts-view.tsx`, `lib/data/labels.ts`, `lib/data/deletion.ts`, S-19 페이지 |
| Q53-8 | C-09 제목: 한 칸 / 두 칸 / 읽기 전 기본 문구. `getProjectFieldsAction`으로 교체 | `components/common/data-gate.tsx`, `lib/data/actions.ts` |
| Q53-9 | S-33 입력 원인 → S-15(요건 없음 "공고 원문 고치기", 있음 "공고 확인하기"). S-15 "요건이 있는 공고" 안내. S-20 "그만두고 새로 시작"(판정 먼저, 걸리면 세션 유지, 프리필), "시작하기" 숨김. 질문 0개 그만둔 세션 표시·수 제외. `prepare` 추출 실패가 같은 원인으로 작업을 실패시킴 | `answer-sheet.tsx`, `interview-prep.tsx`, `session-list.tsx`, `lib/data/interviews.ts`, `lib/mock/grading.ts` |
| Q53-10 | 대상도 없고 다시 정리도 안 되는 실패 세션은 첫 열람에 표식 지움. `changed` 반환 | `lib/data/interviews.ts`, `result-view.tsx` |

### 미리보기가 저장소를 바꾸지 않게

`gate-preview.ts`와 `insufficientReadinessPreview`는 원래 순수 함수였다. 저장소를 바꾸던 것은 미리보기 화면에서 누른 실행이었다.

- `components/common/preview-write-guard.ts` 신규. `?state=`가 있으면 쓰기 대신 토스트.
- 적용: S-14 만들기, S-15 저장·요건 정리하기, S-16 생성, S-17 생성·실패 다시 시도, S-19 생성, S-20 시작·그만두기·새로 시작, S-22·S-37 다시 채점, S-33 다시 시도·제출, C-05 삭제, C-21 동의 기록.
- 요건 선행 추출은 미리보기에서 저장 없이 흉내 낸다.
- **동작이 바뀐 값:** S-20 `?state=ai-failed*`·`ai-waiting`은 전에 실패 세션을 실제로 만들었다. 이제 만들지 않는다. 같은 화면은 S-33의 같은 `?state=`로 본다(`ai-waiting` 신설). 실제 흐름 재현은 `/dev/states` mock 제어를 쓴다.
- **남은 예외(건드리지 않음):** 자동 저장(S-18·S-19·S-33·커리어 폼), C-12 단계 이동, S-31 이름·마감일 인라인 수정, S-36 대화. 이 쓰기는 미리보기에서도 저장소를 바꾼다. 막을지 정해 주면 같은 가드를 붙인다.

## 새 `?state=`

| 화면 | 값 |
|------|-----|
| S-14 | `create-refused-consent`, `create-refused-key-invalid` (`consent-required`·`key-invalid`는 의미 변경) |
| S-15 | `raw-editable`, `raw-edit`, `raw-save-failed`, `raw-save-refused`, `raw-saved`, `raw-unknown-cause`, `raw-has-requirements` |
| S-16 | `raw-edited` |
| S-17 | `no-requirements`, `no-requirements-consent`, `no-requirements-key-invalid` |
| S-20 | `failed-session`, `failed-session-partial` |
| S-22 | `grading-regrade`, `grading-summary-only`, `grading-summary-input`, `grading-input-only`, `grading-mixed`, `grading-completed-regrade`, `grading-completed-input` |
| S-33 | `input-failed-has-requirements`, `abandoned-no-questions`, `raw-edited-stale`, `raw-edited-no-job`, `ai-waiting` |
| `/dev/states` | `q53` (전체 링크 모음), mock 제어에 "다음 요건 추출 실패: input_too_long" 추가 |

## 새 픽스처

| 행 | 내용 |
|----|------|
| AP 7 + JD 7 + job 15·16·17 | `not_a_jd` 실패 JD, 요건 0개, 원문 수정 가능. 인사이트·질문 생성도 같은 원인 |
| 세션 6 (AP 7) | 작성 중, 질문 생성 실패 → S-15 공고 원문 고치기 |
| 세션 12 (AP 7) | 질문 0개 그만둔 세션 |
| 세션 13 (AP 2) + job 21 | 요건 있는 공고의 `safety_blocked` → "공고 확인하기" |
| 세션 7 (AP 5) | 입력 원인만 |
| 세션 8 (AP 5) | 종합만 실패 |
| 세션 9 (AP 5) | 종합이 입력 원인 |
| 세션 14 (AP 5) | 입력 원인 + 다른 원인, `{n}` = 1 |
| 세션 10 (AP 4) | 완료 + 입력 원인 답변만 |
| 세션 11 (AP 4) | 완료 + 대상 1개 |
| 초안 4 (AP 3) | 첫 생성 중단 뒤 `composing` |

**:3000 저장소에는 이 행들이 없다.** dev 서버를 다시 켜야 들어온다.

## `[UI-가정]`

| 화면 | 내용 |
|------|------|
| S-17 | 요건 없는 JD의 "새 경력기술서" 버튼. 지금 화면은 패널이 항상 열려 있어 그런 버튼이 없었다. 요건 없는 JD에만 이 단계를 넣었고 D-30 때문에 진입만으로 추출하지 않는다 |
| S-17 | C-11 "자동 실행이 없는 진입"의 별도 "AI에게 맡기기" 버튼. 라디오가 이미 선택돼 있으면 누를 수 없어서 안내 아래에 둔다 |
| S-17 | 키 없음은 라디오를 고를 수 없어 지금처럼 "직접 고르기"로 연다 |
| S-15 | 떠날 때 확인은 `window.confirm` + 링크 클릭 가로채기 + `beforeunload`. 문구 "고친 공고를 저장하지 않았어요. 이 화면을 떠날까요?" |
| S-15 | 돌아가기 문구 "인사이트로 돌아가기", "서류 초안으로 돌아가기", "자기소개서 문항으로 돌아가기" |
| S-19 | 중단 토스트 "생성을 중단했어요" |
| S-20 | 재시작 뒤 호출 실패 토스트. `actionFailedMessage("면접 시작")` 재사용 |
| S-22 | 입력 원인인데 원인 값이 없는 행: "채점을 마치지 못했어요." |
| S-22 | 작업 원인이 입력 원인이고 다시 채점 대상도 있는 세션: 원인만 보이고 새 면접 버튼은 없음 |
| S-22 | 종합 평가 다시 정리의 키 없음 잠금 설명 |
| S-20·S-37 | 넓은 표에서 "질문을 만들지 못함"은 점수·공급자 두 칸을 합친 한 칸 |
| C-09 | 이름·역할이 이미 다 있으면(판정 뒤 저장) 칸 수를 말하지 않고 기본 문구 |
| 개발용 | 미리보기 토스트 "미리보기라 실제로 저장하거나 실행하지 않았어요" |

## 기획 확인 필요

1. **S-17 "새 경력기술서" 버튼 (S-17, FL-03):** 명세는 이 버튼이 있다고 전제하지만 설계된 화면에는 없다. 위 `[UI-가정]`으로 구현했다. 요건 있는 JD는 지금처럼 진입 때 AI-11이 돈다.
2. **S-15 수정 조건 ③ vs DM 2.6.1 조건 1:** UX는 "요건 추출·인사이트·면접 질문 생성 작업", DM은 "유형 무관"이다. DM이 차이 없다고 적어 더 좁게 막는 DM을 따랐다.
3. **`tech_keywords` (DM 2.6.1 "null" vs A.6·`types/db.ts` 배열):** 저장 때 null이라고 되어 있으나 타입은 null을 허용하지 않아 `[]`로 넣었다. `detected_language`는 null 허용이라 그대로다.
4. **S-33 "작업이 없어 비교할 수 없으면":** 원문 수정이 있었던 경우로 읽었다. 수정 기록도 작업도 없는 실패 세션은 기존처럼 C-20 `provider_unavailable`을 보인다.
5. **C-05 N의 면접 세션 수:** 질문 0개 세션 제외는 S-13·S-31·S-39만 명시돼 있어 C-05에서는 그대로 센다. 서류는 명세대로 뺐다.
6. **S-14 입력 복원 시점:** 명세는 "돌아오거나 만들기가 성공하면 지운다"이다. 실제로는 입력이 바뀔 때마다 세션에 쓰는 기존 방식이라 돌아와도 남고, 성공·취소 때 지운다. 탭을 닫으면 사라지는 것은 같다.
7. **S-22 `evaluation_failed` + 대상 0 + 성공 0 + 입력 원인 답변도 0:** 표 4행이 그대로 적용되어 버튼 없음이 된다. 정상 경로에서는 안 생기는 조합이다.

## 디자인 시스템 메모 (ui-designer용)

- **S-15 수정 상태:** 공고 원문 카드 머리에 outline sm "공고 원문 고치기"(PenLine). 수정 중에는 본문이 `min-h-80` Textarea로 바뀌고 글자 수, 경고 Alert, 오른쪽 아래 "취소" outline + "저장" default. 요건 영역 C-20은 유지하고 "요건 정리하기"는 비활성 + 그 아래 muted 한 줄. `xl:sticky` 카드 안이라 넓은 화면에서 Textarea가 max-height 스크롤 안에 들어간다.
- **S-15 저장 뒤:** 카드 안 기본 Alert(CircleCheck, `text-success`). `alert`에 success 변형이 없어 이렇게 뒀다.
- **S-15 요건이 있는 공고:** 2열 위 전체 폭 warning Alert + outline sm 버튼 2개.
- **S-15 돌아가기:** 2열 위 outline sm + ArrowLeft.
- **S-14 키 무효:** 버튼 줄 아래 C-20 inline. 오른쪽 정렬 칸 안이라 줄바꿈을 봐야 한다.
- **S-17 진입 단계:** 설정 트리 대신 AiRunButton 하나 + muted 한 줄. 빈 듯 보일 수 있다.
- **S-17 자동 실행 없는 안내:** 라디오 아래 muted 한 줄 + outline sm 버튼. 그 아래 트리는 비활성이다.
- **S-20 실패 배너:** 기존 warning 카드에 "그만두고 새로 시작"(outline, C-19 배지 포함) + "이어서 쓰기". 배지 때문에 버튼 줄이 길어진다.
- **S-22 입력 원인:** C-20 block 모양, 제목 + 본문 + 보존 줄 + outline sm "이 기업 JD로 새 면접 시작". 답변 카드는 `AiFailedInline` 한 줄.
- **S-37 표:** "질문을 만들지 못함"은 `text-sm text-muted-foreground`, colSpan 2.

## 확인한 것

**기계 검사:** `pnpm lint` 종료 0(경고 없음), `pnpm typecheck` 종료 0, `pnpm build` 종료 0. 빌드 후 :3000 응답 200.

**데이터 계층 실행: 84건 통과, 실패 0.** 일회성 스크립트 `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-ui-work-a25919/9210b571-1278-40e3-934e-71c9c27ff730/scratchpad/verify/check.mts`. 별도 Node 프로세스의 새 fixture 저장소에서 돌렸고 :3000 저장소는 건드리지 않았다. 저장소에 넣지 않는 파일이다.

- 판정표 6행 + 경계값, 픽스처 세션 전부의 판정
- Q53-10: 표식 기록·유지·배지 감소
- Q53-3·5: 거부 코드, 작업 미생성, 같은 행 거부, 단계에 `evaluate` 없음, 평가 보존, 종합 재생성
- 혼합 세션 다시 채점: 대상만 평가, 입력 원인은 `not_scored` 유지
- Q53-1: 거부 때 행 0개, `needs_check` 통과, 키 없음 저장
- Q53-2: 거부 코드, 저장값, 이름·단계 유지, 지난 실패 숨김, 재추출 재실패 → 수정 가능, 성공 → 잠김·이름 `ai`
- Q53-7: 첫 생성 중단, 다시 생성 중단, 실패는 그대로, 수 제외
- Q53-9: 배너 값, 수 제외, 재시작 거부 때 세션 유지, 통과 때 새 세션

**SSR (:3000 curl, `?state=` 값 + 기존 픽스처):** 위 새 `?state=` 대부분의 문구 유무를 확인했다. `grading-input-only`와 `grading-completed-input`에 "다시 채점" 없음, `grading-summary-input`에 "종합 평가 다시 정리" 없음, S-14에 옛 안내 없음. 이 과정에서 서버 컴포넌트가 클라이언트 함수를 부르던 S-15 오류와 S-17 미리보기가 인사이트 우선순위에 가려지던 문제를 찾아 고쳤다.

**코드로만 읽은 것:** 새 픽스처 행의 화면 렌더링(저장소가 옛것이라 :3000으로 볼 수 없다. 값은 위 스크립트로 확인).

## 브라우저에서 확인하지 않은 것

브라우저로 클릭해 본 항목은 없다. 클라이언트 상호작용과 effect는 모두 미확인이다.

- **S-14:** C-21 동의 뒤 이어서 생성, 키 교체 왕복과 입력 복원, 서버 거부 미리보기
- **S-15:** 수정 진입, 저장·취소, 떠날 때 확인, `?edit=1` 제거, 저장 뒤 "요건 정리하기", 재추출 뒤 돌아가기 링크
- **S-16:** C-20 버튼 이동
- **S-17:** "새 경력기술서" → 추출 → AI-11, "AI에게 맡기기" → C-21, `composing` 복원과 `#new-draft` 스크롤
- **S-19:** 중단 뒤 이동 (스트림 + 서버 액션 결합은 코드만 확인)
- **S-20:** "그만두고 새로 시작" 전체 흐름
- **S-22 → L-01:** 첫 열람 때 배지 감소, 종합 다시 정리의 진행 표시
- **S-33:** `ai-waiting` 대기 줄 (`useNow`가 SSR에서 0이라 curl로 안 보인다)
- **S-37:** 메뉴 항목과 동작, 합쳐진 칸의 정렬
- **C-09:** 제목이 읽은 뒤 한 칸 / 두 칸으로 바뀌는 것 (SSR은 기본 문구까지만 확인)
- 좁은 화면 줄바꿈 전부
