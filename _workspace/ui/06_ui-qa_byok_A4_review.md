# UI QA — A4 면접·보드 BYOK 반영 (라운드 1)

기준: 브리프 `05_brief_byok.md`, A4 보고 "BYOK 반영 (2026-10-28)", A0 보고 "BYOK 파운데이션", 파운데이션 리뷰 `06_ui-qa_byok_foundation_review.md`(UQ-200~211은 다시 올리지 않음), design-system v2, 플로우 v5.2 · PRD v4.2 · 데이터 모델 v4.1a. 리뷰 일자 2026-10-28. 이슈 ID는 **UQ-320부터** 붙였다.

## 요약 — Critical 0 / Major 2 / Minor 5

- 기계 검사는 모두 통과했다: `pnpm lint`(오류·경고 0, 전체), `pnpm typecheck`, `pnpm build`(39 페이지). A2가 같은 시간에 수정 중이었지만 실패는 없었다.
- `next dev -p 3473`로 A4 URL 33개를 `?state=` 포함 요청했다. 모두 200이고 개발 로그 오류는 0이다. 확인 후 서버를 종료했다.
- 서버 액션으로 시나리오 두 개를 직접 실행했다.
  - **정상 제출 → S-22**: 평가 카드 3개, 미응답 카드 2개, 종합 피드백이 나오고 결과 배지 "Gemini · 기본로 만든 결과"가 보인다. 이전 라운드(UQ-48) 수정은 그대로 동작한다.
  - **키 삭제 후 제출**: 세션이 `evaluating`인 채로 작업 없이 남는다(UQ-320).
- 화면에 차감·남은 횟수·한도 문구는 0건이다. `?state=limit`에서도 한도 문구가 렌더되지 않는다. 점수 산식은 만들지 않았다(D-14).
- 이전 라운드 수정에 재발은 없다.
  - UQ-41: 5,000자 상한
  - UQ-42: 폴링
  - UQ-45: 44px 대상(이제 `Button icon-sm`·`TabsList` 기본값이 `max-md` 44px)
  - UQ-50: C-16 확인 단계 첫 포커스가 "취소"로 감
  - UQ-51: 세션 다시 시도는 세션 단위 작업만 다시 돌림(`actions.ts:74`)
- Chrome 확장이 연결되지 않아 브라우저 상호작용은 확인하지 못했다. 대상은 C-14 키 없음 팝업 실제 표시, FL-19 복귀 링·토스트, 카운트다운이다. 코드 판독으로 대신했다.

## 점검표

| 화면 | Q1 스펙 행 | Q2 문구 | Q3–4 필드 | Q5 라우트 | Q6 상태 | 비고 |
|------|-----------|---------|-----------|-----------|---------|------|
| S-20 | ⚠️ UQ-322 | ✅ | ✅ | ✅ | ✅ | C-18 인라인 · C-19 배지 · 무료 등급 `Alert info` · 실행 공급자 열 · 세션 목록·배너는 키 없이 보임 |
| S-33 | ❌ UQ-321 | ✅ | ✅ | ✅ | ⚠️ UQ-325 | 제출 C-18 문구가 명세와 같음. C-20 원인별 문구 렌더, 키 없이 답변 작성·자동 저장 가능 |
| S-22 | ❌ UQ-321 · ⚠️ UQ-323 | ✅ | ✅ | ✅ | ⚠️ UQ-325 | C-19 결과 배지(모델 ID는 툴팁), 질문·채점 공급자가 다르면 한 줄 표시, 결과는 키 없이 열람 |
| S-37 | ✅ | ✅ | ✅ | ✅ | ✅ | 새 면접 = AiRunButton(키 없음 C-18 + 목록 열람), 실행 공급자 열·필터 |
| S-39 / C-14 | ⚠️ UQ-326 | ✅ | ✅ | ✅ | ✅ | `InterviewPromptBody`가 키 없음 + 작성 중 세션 없음이면 `AiLockDialog`(문구 명세 일치, 복귀 S-20 `?type=`) |
| C-16 | ✅ | ✅ | — | ✅ | ✅ | 변경 없음(AI 없음), 키 없으면 S-37 버튼에서 막힘(FL-17) |
| 데이터 계층(면접 제출) | — | — | ❌ UQ-320 | — | — | 파운데이션 |

### 확인한 일치 사항

- **C-18 진입점**
  - 새 면접(S-20 시작하기, S-37 새 면접), 면접 제출(S-33), 다시 채점(S-22 답변별·세션)은 모두 인라인형이다(D-UX-15, 결과가 있는 화면이라 영역형 없음).
  - 기능 설명은 명세 C-18 표 문구 그대로다: "공고와 커리어에 맞춘 면접 질문을 만들고 답변을 채점해요" / "제출하면 연결한 AI로 채점해요. 작성한 답변은 저장돼 있어요".
  - 키 무효(`?state=key-invalid`): 버튼은 보이고 배지는 경고형("키를 확인해 주세요")이다. `needs_check`는 "확인 필요" 배지를 달고 실행된다.
- **자동 실행 없음**: 복귀 후에는 `AiRunButton`이 링과 토스트만 보이고, 화면 코드에 마운트 시 실행하는 경로가 없다(D-UX-16).
- **키 없이 가능한 일(D-36)**
  - S-33: 답변 편집과 자동 저장(`saveInterviewAnswerAction`)이 키와 무관하다.
  - S-20: 작성 중 배너(이어서 쓰기·그만두기)와 세션 목록이 보인다.
  - S-22: 결과 전체를 열람할 수 있다(`?state=ai-locked`에서 피드백·평가 카드 렌더 확인).
- **C-20 원인별 문구**: daily_quota, rate_limited, billing, model, provider, input_rejected(대상 "공고 원문"), key_invalid("키 교체"), key_missing("키가 삭제되어 작업을 끝냈어요. 입력은 저장돼 있어요" + AI 연결하기), system(`schema_invalid`) 모두 명세 문구로 렌더된다. "다시 시도하면 토큰을 다시 써요"가 있고, 외부 링크는 `target=_blank rel=noopener` + "(새 탭)" 라벨이다.
- **무료 등급 안내**: S-20 시작하기 위에 "질문을 하나씩 만들어 조금 더 걸려요"가 있다. S-33·S-22 C-03에는 작업의 `connection_tier`가 들어간다. 대기 줄은 1초마다 줄지만 live region 밖이다(`AiProgress`는 sr-only `role=status` 한 번). C-20 카운트다운 낭독 문제는 파운데이션 UQ-202에 있다.
- **D-30**: JD가 `pending`·`failed`면 시작할 때 요건 추출을 먼저 호출하고(`actions.ts:31-33`), `running`일 때만 ST-WAIT-JD를 보인다. 다만 순서가 실제로 지켜지지 않는다(UQ-322).

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-320 | Major | foundation | S-33 → S-22 (제출) | 02 FL-12 "제출(채점)은 키가 있어야 한다 … 답변은 그대로 보존", FL-08 키 확인이 먼저, 04 `submit_interview_session` | `src/lib/data/interviews.ts:172-200` (`submitInterviewSession`), `src/lib/mock/ai.ts:101` | 키가 없으면 세션·답변을 바꾸기 전에 거절한다. 또는 작업 생성 실패 시 `evaluation_failed` + `key_missing` 작업을 남겨 S-22에서 C-20 → 다시 채점으로 이어지게 한다 | 답변을 `submitted`/`unanswered`로, 세션을 `submitted_at`·`evaluating`으로 바꾼 **뒤** `createMockJob`이 `key_missing`을 던진다. 재현(dev 3473): 새 세션 생성 → 질문 준비 → `deleteProviderKeyAction("gemini")` → `submitInterviewSessionAction`. 액션은 오류인데 세션은 `evaluating`으로 남고 채점 작업이 없다. 이후 S-33은 S-22로 redirect되고, S-22는 "면접 채점 진행 중"만 계속 보이며 다시 채점 버튼이 없다. 화면은 C-18로 막지만 연결 상태 로딩 전(UQ-207)이나 다른 탭에서 키를 지운 경우 이 상태에 빠진다. A4 보고 파운데이션 요청 1과 같은 건. 백엔드 RPC도 같은 순서를 지켜야 한다 |
| UQ-321 | Major | A4 | S-33, S-22 | 02 C-20 `key_missing` "입력 보존 + AI 연결하기", FL-21 "C4 … → 다시 시도", FL-19 "원래 화면으로 복귀 · 잠금이 풀린 버튼 강조" | `src/components/interviews/answer-sheet.tsx:264-283`, `src/components/interviews/result-view.tsx:208-221`; `src/components/common/ai-error-notice.tsx:450-460`(key_missing에는 다시 시도 없음) | 질문 생성·채점이 `key_missing`으로 끝난 뒤 키를 다시 연결해 돌아오면, 같은 자리에 "다시 시도"(남은 질문 다시 만들기) / "다시 채점"이 나와 작업을 이어 갈 수 있다 | `key_missing` 블록에는 다시 시도가 없다. 화면은 잠금이 아닐 때 다른 대체 버튼도 주지 않는다. 다시 연결해도 "키가 삭제되어 작업을 끝냈어요" + "AI 연결하기"만 남는다. S-33은 질문 생성이 끝나지 않아 답변란이 열리지 않고 그만두기밖에 없다. S-22는 세션 다시 채점 경로가 없다(답변 `score_status`가 `not_scored`가 아니라 답변별 버튼도 없음). 연결됐으면 `code="key_missing"`에 `AiRunButton`("다시 시도"/"다시 채점")을 함께 두거나, 연결 시 원인을 무시하고 재시도 버튼을 보이게 해야 한다 |
| UQ-322 | Minor | A4 | S-20 | 02 S-20 시작하기 비고 "요건이 없으면 질문 생성 **전** 요건 추출(D-30)", FL-12 "요건 없으면 요건 추출 먼저" | `src/components/interviews/actions.ts:29-34`, `src/lib/data/drafts.ts:834-858` | 요건 추출이 끝난 뒤 질문 생성을 시작하고, 추출이 실패하면(`not_a_jd` 등) 질문을 만들지 않고 그 원인을 보인다 | `runJdExtraction`은 추출 작업을 `running`으로 시작만 하고 바로 반환한다. 같은 요청 안에서 질문 생성 작업이 곧바로 시작되어 두 작업이 동시에 돈다. 화면 안내 "공고 요건을 먼저 정리한 뒤 질문을 만들어요"와 실제 동작이 다르고, 추출 실패도 질문 생성을 막지 않는다. mock에서는 질문이 요건에 의존하지 않아 드러나지 않음. 백엔드 연결 시 서버 순서로 맞추되, 화면 쪽 안내·실패 분기는 A4 몫 |
| UQ-323 | Minor | A4 | S-22 | 02 S-22 "'다시 채점하면 공급자 토큰을 다시 써요' 한 줄", 실행 버튼 공통 규칙 "다시 채점 … 옆에 C-19 배지" | `src/components/interviews/result-view.tsx:208-215` | 세션 단위 "다시 채점"(채점 실패 C-20 안)에도 C-19 배지와 "다시 채점하면…/다시 하면 공급자 토큰을 다시 써요"가 붙는다 | 답변별 다시 채점은 `AiRunButton rerun`으로 맞지만, 세션 실패 블록의 "다시 채점"은 `AiErrorNotice` 안 `RetryButton`이라 배지가 없고 문구도 공통 "다시 시도하면 토큰을 다시 써요"다 |
| UQ-324 | Minor | A4 | S-33 (S-22·S-37) | 02 실행 버튼 공통 규칙 "키가 없으면 버튼 자리가 C-18", FL-12 | `src/components/interviews/answer-sheet.tsx:93`, `result-view.tsx:98`, `src/app/(dashboard)/applications/[id]/interview/[sessionId]/page.tsx:80` | S-20처럼 서버에서 받은 `ai_connection`을 넘겨 첫 렌더부터 제출·다시 채점이 잠긴다 | S-20만 `serverConnection`을 넘긴다. S-33 제출 버튼은 클라이언트가 연결 상태를 받기 전 잠기지 않은 채로 보인다. 근본 원인은 파운데이션 UQ-207이다. 다만 S-33은 이 틈에 누르면 UQ-320 상태로 빠지는 화면이라, A4에서도 S-20과 같은 완화를 권한다 |
| UQ-325 | Minor | A4 | S-33, S-22 (`?state=` 미리보기) | ui-context "every ST-xx state can be rendered", 02 C-20 "공통: 공급자 이름과 등급을 문구에 넣는다", C-03 무료 등급 줄 | `answer-sheet.tsx:266, 298`, `result-view.tsx:210, 228` | 미리보기에서도 공급자 이름, 대시보드·결제·상태 페이지 링크, 무료 등급 순차 줄이 보인다(작업이 없으면 활성 연결의 공급자·등급으로 대신) | `provider`·`connectionTier`를 작업 행에서만 읽는다. 작업이 없는 미리보기 세션에서는 다음처럼 보인다(dev 확인). 실제 실패 작업에는 값이 있어 미리보기 정확도 문제다.<br>- "오늘 **공급자** 무료 한도를 다 썼어요"<br>- 대시보드·결제 설정·상태 페이지 링크 없음<br>- `?state=ai-pending`에 무료 등급 줄 없음 |
| UQ-326 | Minor | foundation | S-39 → C-14 키 없음 → S-20 | 02 S-20 진입 안내 "S-39에서 왔으면 …", L-01 이동 경로 "S-39에서 들어오면 첫 마디가 지원 현황" | `src/components/common/stage-menu.tsx:457-465` | 키 없음 변형에서 "AI 연결하기"를 눌러도 `setNavOrigin("board")`·`markBoardStageMove`를 기록해, 연결 후 돌아온 S-20에 진입 안내와 "지원 현황" 첫 마디가 보인다 | 일반 팝업의 `go()`만 두 표시를 남기고 `AiLockDialog` 경로는 남기지 않는다. 복귀한 S-20에 "지원 현황에서 … 옮겼어요"가 없고, 이동 경로는 "기업 JD 관리"로 시작한다 |

## 기획 확인 필요 (기존 A4·파운데이션 목록에 더하는 것만)

| 화면 | 내용 | 근거 |
|------|------|------|
| S-33 / S-22 | `key_missing`으로 끝난 작업을, 키를 다시 연결한 뒤 같은 세션에서 이어 하는 것이 맞는지(UQ-321의 기대 동작). 명세 C-20 `key_missing` 행에는 "다시 시도"가 없고 FL-21은 모든 원인이 다시 시도로 이어진다 | 02 C-20 표 `key_missing` ↔ FL-21 다이어그램 |
| S-20 | 요건 추출이 실패(`not_a_jd`)했을 때 면접 시작을 막는지, 일반 질문으로 진행하는지 | 02 S-20 D-30 비고 ↔ 03 AI-05 입력 "JD 요건 필수" |

(A4 보고의 기획 확인 4건(세션 `model_tier`, 다시 채점 잠금 문구, 키 무효 시 S-37 새 면접, 키 없이 실패를 볼 때 다시 시도 자리)과 파운데이션의 C-14 키 없음 + 작성 중 세션 우선순위는 그대로 유효하다.)

## 이전 라운드 회귀 확인

| ID | 결과 | 메모 |
|----|------|------|
| UQ-40 | 유지 | 세션 다시 채점 → `retryEvaluationAction`, 답변별 → `retryAnswerEvaluationAction`(AiRunButton) |
| UQ-41 | 유지 | `maxLength=5000` + `CharCount` |
| UQ-42 | 유지 | 폴링 조건 `answer-sheet.tsx:123-127` |
| UQ-45 / UQ-46 | 유지 | `button.tsx:33` `icon-sm` = `size-8 max-md:size-11`, `tabs.tsx:27` `h-11 md:h-9` |
| UQ-47 / UQ-50 | 유지 | C-16 분기 → "이어서 쓰기", 확인 단계 → "취소"에 포커스(`jd-picker-dialog.tsx:102`) |
| UQ-48 | 유지 | 정상 제출 → S-22 평가·피드백 생성 확인 |
| UQ-51 | 유지 | `getLatestJobFor(…, { sessionWide: true })` |

## 기계 검사 출력

- `pnpm lint` — 통과(exit 0, 오류·경고 0)
- `pnpm typecheck` — 통과(exit 0)
- `pnpm build` — 통과(exit 0, 39 페이지)
- `next dev -p 3473` 스모크(URL 33개, 모두 200). 로그 오류 0. 종료함.
  - S-20 8: 기본 · `ai-locked` · `key-invalid` · `key-check` · `ai-waiting` · `wait-jd` · `insufficient` · `limit`
  - S-33 13: 기본 · `ai-locked` · `key-invalid` · `key-missing` · C-20 원인 8종 · `ai-pending`
  - S-22 6: 기본 · `ai-locked` · `ai-failed-provider` · `key-missing` · `scored`
  - S-37 4: 기본 · `ai-locked` · `key-invalid` · `empty`
  - S-39 2: 기본 · `ai-locked`
- 서버 액션 시나리오: 정상 제출 → S-22, 키 삭제 후 제출(UQ-320 재현).
