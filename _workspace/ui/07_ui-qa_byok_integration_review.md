# UI QA — BYOK 통합 (최종 라운드)

- 검수일: 2026-10-28
- 기준:
  - 기획: PRD v4.2 · 플로우 v5.2 · AI v4.2 · 데이터 모델 v4.1a
  - 디자인 시스템 v2
  - 브리프 `05_brief_byok.md`
  - BYOK 리뷰 `06_ui-qa_byok_{foundation,A1,A2,A3,A4}_review.md`
  - 보고서 BYOK 절: A0 "BYOK 파운데이션"·"BYOK 파운데이션 배치", A1~A4 "BYOK 반영"·"BYOK 라운드 1 수정"
- 리더 결정이라 이슈로 보지 않은 것:
  - UQ-206: 다시 하기 주석은 `caption` 12px 유지(디자인 3.22)
  - 등급 글자 "무료 등급"/"유료 등급": 기획 답을 기다리며 유지
  - S-41: 모든 폭에서 집중 레이아웃
  - S-31 키 없음: 명세의 표식 사용
  - AI-11 자동 호출: 키가 있는 상태로 첫 진입할 때만. AI 연결에서 돌아온 뒤에는 하지 않고, 사용자 선택을 덮어쓰지 않음
  - `key_missing` 작업: 다시 연결하면 "다시 시도"를 보임(자동 실행 없음)
- 이슈 ID: UQ-350부터.
- 확인 방법:
  - 코드 대조와 기계 검사.
  - `pnpm exec next dev -p 3701` 서버 렌더 스모크. 3000 포트는 쓰지 않았고, 확인 후 종료해 포트가 비었다.
  - 브라우저: 연결된 Chrome이 없다(`list_connected_browsers` = 빈 목록). 그래서 아래 흐름은 코드만 읽고 판단했다: FL-19 왕복(링·토스트·입력 복원), 카운트다운, 설정 다이얼로그 섹션 전환, C-14 키 없음 팝업.

## 요약 — 새 이슈 Critical 0 / Major 0 / Minor 5

**라운드 1 재확인**
- 대상 50건(파운데이션 11, A1 11, A2 9, A3 12, A4 7). Major 4건(UQ-200, UQ-230, UQ-320, UQ-321)은 모두 해결됐다.
- 해결 46
- 리더 결정으로 닫힘 2: UQ-206 다시 하기 주석, UQ-262 등급 글자
- 기획 대기 1: UQ-297
- 미해결 1: UQ-240(ui-designer 문서. 새 이슈 UQ-354에 묶음)
- 재발 0

**기계 검사**
- `pnpm lint` exit 0
- `pnpm typecheck` exit 0
- `pnpm build` exit 0(39 페이지)

**dev 스모크**
- 다섯 영역과 `/dev/states`의 경로 38개(`?state=` 포함)가 모두 200이다. 개발 로그 `Error`/`⨯`는 0건이다.
- 렌더된 HTML 전체에서 "차감", "회 남음", "/10회", "남은 횟수"는 0건이다.

**서비스 한도 문구 (저장소 전체)**
- `차감|회 남음|/10회|남은 횟수|UsageHint|LimitNotice|한도(`는 주석에만 남았다(`ai-run-button.tsx:4`, `answer-sheet.tsx:11`, `lib/data/drafts.ts:158`, `ai-jobs.ts:386`, `applications.ts:193`).
- 화면에 보이는 "한도"는 공급자 한도 문구(C-20 `daily_quota`, C-19 `needs_check` 툴팁, S-40 카드)뿐이다.

**새 이슈 5건**
- 대부분 FL-19 왕복의 마무리 문제다.
  - 원래 기능 이름이 진입점마다 다르게 잡힌다(UQ-350).
  - S-20·S-36 시작 화면의 선택값이 왕복 뒤 사라진다(UQ-351, UQ-352).
- 나머지: S-22 카운트다운 접근 이름(UQ-353), 디자인 문서와 리더 결정의 차이(UQ-354).

## 라운드 1 재확인

### 파운데이션 (UQ-200~211)

| ID | 결과 | 확인 근거 |
|----|------|-----------|
| UQ-200 (Major) | 해결 | `deletion-summary.tsx:34-64` "AI 연결" 묶음 + 폐기 권고 + 대시보드 링크. dev `/settings/withdraw`에 "공급자 사이트에서도 키를 폐기" 렌더 |
| UQ-201 | 해결 | `ai-status-line.tsx`, `settings-sections.tsx:71-87` 고지 다시 보기 |
| UQ-202 | 해결 | `ai-error-notice.tsx:330-336`: 바뀌지 않는 제목을 sr-only `role=status`로 한 번만 알림. 보이는 블록에 `aria-live` 0건. RetryButton 카운트다운은 `aria-label` 고정(`:247`) |
| UQ-203 | 해결 ([UI-가정], 기획 B-7) | `labels.ts:301` `displayInputTokens`. S-42 합계 카드(`ai-usage-panel.tsx:186`)와 표 행의 정의가 같음 |
| UQ-204 | 해결 | `preview-state.ts:34, 46` `ai-failed-safety`, `consent`. dev `/dev/states?state=ai-failed-safety`에 "안전 정책으로 응답을 받지 못했어요" |
| UQ-205 | 해결 | 사용자에게 보이는 "ST-LIMIT" 0건(주석만) |
| UQ-206 | 리더 결정으로 닫힘 | C-18·C-21·"이미 만들고 있어요"는 `text-sm`. 남은 `text-xs`는 다시 하기 주석 하나(`ai-run-button.tsx:155`)이고 디자인 3.22 `caption` 그대로 |
| UQ-207 | 해결 | `ai-run-button.tsx:88-105`: `!loaded`면 비활성. 서버 `connection`이 있으면 기다리지 않음 |
| UQ-208 | 해결 | `routes.aiConnection(provider)` → `/settings/ai#provider-card-{p}`(`routes.ts:90`), `provider-badge.tsx:62`(경고 상태일 때만 공급자 지정) |
| UQ-209 | 해결 | `AI_TRAINING_NOTICE` 한 곳(`labels.ts:297`). `policy-content.ts`는 다시 내보내기만 하고, `RESUMATE_AI_PRINCIPLE`도 같은 상수 |
| UQ-211 | 해결 | `data-use-consent.tsx:200` `aria-describedby={reasonId}` |

### A1 (UQ-260~270)

| ID | 결과 | 확인 근거 |
|----|------|-----------|
| UQ-260 | 해결 | `ai-connection-panel.tsx:284`, `key-connect-flow.tsx:174` `directionParticle()`. 다만 넘어오는 `feature_label` 자체가 진입점마다 다르다 → UQ-350 |
| UQ-261 | 해결 | `key-connect-flow.tsx:724` |
| UQ-262 | 리더 결정으로 닫힘 (기획 B-6) | `CONNECTION_TIER_LABELS = 무료 등급 / 유료 등급`(`labels.ts:84-87`) |
| UQ-263 | 해결 | `key-connect-flow.tsx:233-249`: `needsDataUseConsentAction()`으로 실제 동의 필요 여부를 확인한 뒤에만 ②로 보냄. 그 밖의 예외는 `verifyFailed`. `stepIndex = Math.max(0, …)`(`:252`) |
| UQ-264 | 해결 | `provider-card.tsx:161-199` `inButton`: 버튼 안에는 span만 둠 |
| UQ-265 | 해결 | `ai-usage-panel.tsx:249, 315` h2 |
| UQ-266 | 해결 | `ai-status-line.tsx:67, 72` 접근 이름에 상태 포함 |
| UQ-267 | 해결 | `provider-card.tsx:155, 215` `id=provider-card-{p}` + `scroll-mt-24`. 해시 스크롤은 `ai-connection-panel.tsx:184-189`. 해시는 UQ-208 경로와 같음 |
| UQ-268 | 해결 | `key-connect-flow.tsx:191-197`: 등급 변경도 `finishSuccess()` → `completeAiConnectReturn()`, 주 버튼 글자 = 실제 목적지 |
| UQ-269 | 해결 | 파운데이션 `getRunningAiJobCount(provider)`(`lib/data/account.ts:229-232`, 모든 작업 유형, 공급자로 거름). S-40 키 삭제는 공통 `DeleteConfirmDialog` `api_key` 대상(`delete-confirm-dialog.tsx:138`, `ai-connection-panel.tsx:441`) |
| UQ-270 | 해결 | `ai-format.ts:17` `formatUnitPrice`, `tabular-nums` |

### A2 (UQ-290~298)

| ID | 결과 | 확인 근거 |
|----|------|-----------|
| UQ-290 | 해결 | `chat-screen.tsx:492-499`: 문장만 `role=status`, 초는 `aria-hidden` |
| UQ-291 | 해결 | `gate-next-step.tsx:95-103` `chatLock()`. 적용처는 S-08·S-10·S-36 시작·완료 카드 5곳. 다만 이 기능 이름이 FL-19 복귀 글자에도 그대로 쓰인다 → UQ-350 |
| UQ-292 | 해결 | `chat-start.tsx:64-68`. dev p18에서 대안 링크가 `projects/new?experience_id=…`인 것 확인 |
| UQ-293 | 해결 | `chat-screen.tsx:79` `resumate.chat-draft.{id}` |
| UQ-294 | 해결 | `chat-screen.tsx:129, 201, 237, 635` `showLock()` |
| UQ-295 | 해결 | `chat-screen.tsx:827` "이 답변부터 공급자가 바뀌었어요" + `ProviderResultTag` |
| UQ-296 | 해결 | 파운데이션 `ChatView.turnFailures`(실패 턴 작업 원인) → `chat-screen.tsx:442-443`. 원인을 모르면 "답을 받지 못했어요. 잠시 후 다시 시도해 주세요"(`:788`) |
| UQ-297 | 기획 대기 | 02 v5.2 안에 BYOK 이전 문구 3곳(B-21) |
| UQ-298 | 해결 | `gate-next-step.tsx:44` 로딩 스켈레톤 |

### A3 (UQ-230~241)

| ID | 결과 | 확인 근거 |
|----|------|-----------|
| UQ-230 (Major) | 해결 | `application-new-form.tsx:262-289`: 진입 경로별 sessionStorage 저장·복원, "작성하던 내용을 불러왔어요"(`:130`) |
| UQ-231 | 해결 | 파운데이션 `ensureJdRequirementsInDb`가 prepare 안에서 AI-01을 먼저 끝냄. 클라이언트의 요건 선행 호출 0건(`grep ensureRequirements` 없음). S-19 `?generate=`는 `waitJd`일 때 트리거를 보관(`draft-editor.tsx:296-`) |
| UQ-232 | 해결 | 위와 같음(`startInsight`·`prepare*`·`startInterviewSession`) |
| UQ-233 | 해결 | `application-new-form.tsx:124-125` 키 유무로 분기 |
| UQ-234 | 해결 | 파운데이션 `kstDateString`·`defaultApplicationName`, `applicationDisplayName`·`formatDate` KST |
| UQ-235 | 해결 | `draft-editor.tsx:510, 792` `AiRunButton rerun` |
| UQ-236 | 해결 (리더 결정대로) | `drafts-view.tsx:153-243`: `autoRank`는 첫 렌더의 서버 readiness 기준(키가 있을 때만). `returnedAtMount`면 자동 호출 없이 "직접 고르기 · 전체". `touched`·`restored`면 결과로 선택을 덮지 않음 |
| UQ-237 | 해결 | 세 곳 `text-sm leading-5` |
| UQ-238 | 해결 | `_lib/actions.ts:126-133` 순서: 키 없음 → 무효 → 데이터 |
| UQ-239 | 해결 | 스트림 `error` 이벤트에 `provider`·`retry_after`·`quota_resets_at`. `draft-editor.tsx:271-277` `errorInfo` → `failInfo` → C-20. dev p30 렌더 |
| UQ-240 | 미해결 (ui-designer) | `docs/ui/design-system.md:1249`에 여전히 "(v2) 이름 입력란은 항상 보이고…" |
| UQ-241 | 해결 | `cover-letter-questions.tsx:361` 문항마다 "이 문항만 생성" AiRunButton |

### A4 (UQ-320~326)

| ID | 결과 | 확인 근거 |
|----|------|-----------|
| UQ-320 (Major) | 해결 | `lib/data/interviews.ts:217-227`: 상태 검사 → `assertAiRunnable(db)` → 그다음 답변·세션 변경. A4 보고서에서 dev 재현으로 `{rejected:"key_missing"}`이고 세션·답변은 바뀌지 않음을 확인. 같은 가드가 모든 AI 시작 함수에 걸림(`withAiGuard`) |
| UQ-321 (Major) | 해결 (리더 결정대로) | `ai-error-notice.tsx:384-475`: 다시 연결되면 `key_missing`/`key_invalid`에도 RetryButton. `answer-sheet.tsx:287`, `result-view.tsx:220-235`가 `onRetry`를 넘김. 자동 실행 경로 없음. dev p33 "키가 삭제되어 작업을 끝냈어요. 입력은 저장돼 있어요" |
| UQ-322 | 해결 | 서버 `startInterviewSession` 체인. `interview-prep.tsx:318-325` 진행 문구, 추출 실패면 C-20. dev p32 `extract-failed` 200 |
| UQ-323 | 해결 | `result-view.tsx:359-396` `SessionRescore` = AiRunButton rerun. 카운트다운 접근 이름은 → UQ-353 |
| UQ-324 | 해결 | S-20·S-33·S-22 페이지 모두 `serverConnection`(`interview/page.tsx:118`, `[sessionId]/page.tsx:83`, `result/page.tsx:141`) |
| UQ-325 | 해결 | 작업이 없으면 활성 연결의 공급자·등급으로 대신. dev p34 "결제 설정 (새 탭)" |
| UQ-326 | 해결 | `stage-menu.tsx:465` `AiLockDialog onConnect` → `setNavOrigin`·`markBoardStageMove` |

## 교차 흐름 점검

| 흐름 | 결과 | 메모 |
|------|------|------|
| FL-08 키 확인 → 데이터 → 실행 → 실패 | ✅ | 화면: AiRunButton이 키부터 확인(로딩 전 비활성) → C-09(데이터) → 실행 → C-20. 서버: `withAiGuard`·`assertAiRunnable`이 같은 순서로 거절하고 아무것도 바꾸지 않음. S-19 거절 사유 순서도 같음(UQ-238) |
| FL-18 연결 | ✅ | S-40 → S-41 ①②③(동의 없이 ③ 불가, 서버 `consent_required`) → 첫 키 자동 활성 → C-19 |
| FL-19 C-18 → S-41 → 원래 화면 | ⚠️ UQ-350, UQ-351, UQ-352 | 복귀 대상 = 현재 URL(`ai-connect-return.ts:34-40`). S-41 성공 `completeAiConnectReturn()` → 도착한 AiRunButton에 링 4초 + 토스트. 자동 실행 0(S-17 AI-11 포함, 리더 결정대로). 입력 복원: S-14(UQ-230)·S-36 대화(UQ-293)·S-33/S-19/S-18(자동 저장)은 됨. S-20 유형·질문 수, S-36 시작 소속 선택은 안 됨. 진입점: S-16(영역형·인라인)·S-19·S-20·S-36·S-14(인라인 한 줄)·C-14(`AiLockDialog`, 보드 출발 표시 유지) 모두 같은 `useConnectLinks` |
| FL-20 교체·다시 확인·삭제·활성 전환 | ✅ | `notifyAiConnectionChanged()` → 컨텍스트가 다시 읽음 → NavAiStatus·C-19·AiRunButton·C-18이 다 같이 바뀜. 실행 중 삭제: mock이 진행 중 작업을 `key_missing`으로 끝냄 → C-03 자리에 C-20 + 보존 줄(S-16 p27, S-33 p33). 대화 턴은 C-20 inline, 스트림 생성(S-19)은 거절 토스트. 키 삭제 확인의 N = 그 공급자로 실행 중인 작업 수 |
| FL-21 원인별 회복 | ✅ | 7원인 + 시스템·입력 + `key_missing`. 다시 시도는 `retryAiJob`이 지금 활성 공급자·등급으로 다시 고정(파운데이션). `rate_limited`는 `retry_after`까지 비활성 |
| NavAiStatus · 설정 다이얼로그 ↔ 라우트 | ✅ | NavAiStatus → 다이얼로그 "AI 연결" 섹션(`openSettings("ai-connection")`). 다이얼로그 안 링크는 S-41 `routes.aiConnect`, 사용량 입구는 섹션 전환. 페이지 `/settings/ai`·`/settings/ai/usage`·`/settings/ai/connect` 200. C-19 경고 배지·C-09 "AI 연결 확인"은 페이지 카드 앵커로 감 |
| 공급자별 장애 배너 | ✅ | `/career?state=ai-outage`에 상태 페이지 외부 링크 2개(펼침·좁은 화면), 활성 공급자만 |

## 일관성 점검

| 항목 | 결과 | 메모 |
|------|------|------|
| C-18 문구·변형 | ✅ / ⚠️ UQ-350 | 기능 설명 8종이 `ai-lock.tsx:43-49` 한 곳에 있음. 영역형은 S-15·S-16·S-36 시작·S-42, 인라인은 그 밖(D-UX-15). FL-19 복귀 이름만 제각각 |
| C-19 배지 | ✅ | `hideBadge`를 쓰는 영역 0건. 모든 AiRunButton 옆에 배지가 있음. 결과 배지는 S-16·S-17·S-19·S-22·S-36(공급자 바뀜) |
| C-20 | ✅ | 영역 모두 `AiErrorNotice`. 외부 링크는 `ExternalProviderLink`(새 탭 표기). 직접 만든 외부 링크 2곳(S-41 키 발급, S-03 보기)도 `rel`과 "(새 탭)" sr-only가 있음 |
| `?state=` 새 값 | ✅ | 공통 목록 + 화면 전용 값(`ai-return`, `extract-failed`, `insufficient-key-invalid`, `insufficient-chat-failed`, `step-*`, `key-format` 등)이 각 영역 보고서에 적혀 있음. 스모크 38개 |
| live region·카운트다운 | ✅ / ⚠️ UQ-353 | C-20·C-03·S-36 대기 줄은 한 번만 알림. S-22 세션 다시 채점 버튼만 이름이 매초 바뀜 |

## 새 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-350 | Minor | foundation (+A2·A3·A4 호출부) | FL-19 복귀 글자 (S-40 복귀 배너, S-41 성공 주 버튼) | 02 S-40 "{원래 기능}으로 돌아가려면 AI를 연결해 주세요", S-41 ③ "{원래 기능}으로 돌아가기" | `src/components/common/ai-lock.tsx:100`(`featureLabel ?? actionName`), `ai-run-button.tsx:101`(문자열 children을 `actionName`으로). 호출부: `career/gate-next-step.tsx:95-100`(`chatLock`이 버튼 글자를 `featureLabel`로), `chat-start.tsx:190`(`chatLock("대화 시작")`), `chat-screen.tsx:926`, `career-tree.tsx:157, 193`, `project-form.tsx:321`, `applications/draft-editor.tsx:510, 792`(`actionName` "경력기술서 다시 생성"/"이 문항 다시 생성"), `cover-letter-questions.tsx:172, 362`(`문항 ${index} 이 문항만 생성`), `interview-prep.tsx:309`("면접 연습") ↔ `ai-lock.tsx:200`(C-14 "면접 준비") ↔ `interview-prep.tsx:279`(C-09 "직무 면접") | 복귀 글자는 **기능 이름**이다(인사이트 / 서류 초안 / 자기소개서 / 직무 면접 / AI 작성 대화 / 요건 정리 / AI 사용량). 진입점(`entry`)마다 기본 기능 이름을 하나 두고, 버튼 글자(`actionName`)는 접근 이름에만 쓴다 | `featureLabel`이 없으면 버튼 글자가 기능 이름이 된다. 그래서 FL-19의 핵심 문장이 이렇게 나온다: "대화 시작으로 돌아가기", "문항 2 이 문항만 생성으로 돌아가기", "경력기술서 다시 생성으로 돌아가려면 AI를 연결해 주세요", "이 프로젝트에 상세 내용 더 추가하기로 돌아가기". 같은 S-20인데도 시작하기는 "면접 연습", C-14 팝업은 "면접 준비", C-09는 "직무 면접"으로 다르다. C-18 진입점 표에 기능 이름 열이 없어 기획 확인 B-24도 함께 올림 |
| UQ-351 | Minor | A4 | S-20 (FL-19) | 02 FL-19 "연결 성공 → 원래 화면으로 복귀 · **설정 복원**" | `src/components/interviews/interview-prep.tsx:98-99`(`type`·`count`는 컴포넌트 상태), `:309`(lock에 `returnHref` 없음 → 현재 URL) | 키 없이 유형·질문 수를 고른 뒤 C-18 "AI 연결하기"로 다녀오면 고른 값이 남아 있다. 예: C-09처럼 sessionStorage, 또는 `returnHref = routes.interviewPrep(id, type)` + 질문 수 보관 | 돌아오면 `?type=`이 없을 때 유형은 선택 없음, 질문 수는 5로 초기화된다. 키 없이도 유형·질문 수는 고를 수 있으므로 왕복 뒤 다시 골라야 한다 |
| UQ-352 | Minor | A2 | S-36 시작 (FL-19) | 위와 같음 | `src/components/career/writing-chat/chat-start.tsx:54-58`(소속 선택 상태), `:115`(C-18 영역형, 복귀 = 현재 URL) | 키 없는 시작 화면에서 고른 소속(경력/교육/없음)이 왕복 뒤에도 남는다 | 현재 URL로 돌아오므로 쿼리 기본값(게이트 `experience_id` 등)으로 다시 시작한다. 사용자가 바꾼 소속은 사라진다. 영향이 작은 편(선택 1개) |
| UQ-353 | Minor | A4 | S-22 세션 다시 채점 | 디자인 7 A-11 "카운트다운은 매초 낭독하지 않는다", 공통 `RetryButton`은 `aria-label` 고정(`ai-error-notice.tsx:247`) | `src/components/interviews/result-view.tsx:380-394` | 대기 중에는 버튼 이름을 "다시 채점"으로 고정하고, 남은 시간은 `aria-describedby`로 한 번만 준다(RetryButton과 같게) | 버튼 글자(= 접근 이름)가 "다시 채점 (0:42)"처럼 1초마다 바뀐다. 포커스가 버튼에 있으면 일부 스크린 리더가 다시 읽는다. 또 문자열 children이 `actionName`이 되어, 키가 없으면 C-18 접근 이름·FL-19 글자에 그 순간의 초가 들어갈 수 있다(UQ-350과 연결) |
| UQ-354 | Minor | ui-designer | 디자인 문서 ↔ 리더 결정 | 리더 결정: S-31 키 없음은 명세의 표식(02 S-31 v5 "AI 연결 필요" 표식) | `docs/ui/design-system.md:751` "영역형 (… **S-31 인사이트 카드 본문** …)", `:1249` S-14 "(v2) 이름 입력란은 항상 보이고"(UQ-240 미해결) | 디자인 문서가 구현·명세와 같다 | 두 곳이 아직 예전 규칙이다. 다음 영역 작업자가 문서를 따르면 되돌아간다. A3 보고 "디자인 문서 정렬 예정"이 아직 반영되지 않음 |

## 기획 확인 필요 (BYOK) — 전체 통합 (중복 제거)

출처 표기:
- D: 디자이너 P-7~P-10
- A0: 파운데이션 보고·리뷰(P-B1·P-B2)
- A1~A4: 각 영역 보고·리뷰(P-A3B-x 포함)
- Q: 이번 통합 검수

리더 결정으로 닫힌 것은 목록에서 뺐다:
- S-41 집중 화면
- S-31 표식
- S-17 AI-11 자동 호출(P-A3B-1)
- `key_missing` 재연결 뒤 다시 시도
- 등급 글자는 B-6에 "결정 유지, 문서 확인"으로 남김

S-25 AI 연결 동의 이력은 04 §2.11.5로 답이 나와(A1 리뷰) 뺐다.

### 공통 컴포넌트 (C-18~C-21, 배지·문구)

| # | 대상 | 내용 | 출처 |
|---|------|------|------|
| B-1 | C-19 결과 배지 | 명세 예시 "Gemini · 기본로 만든 결과"의 조사(기본으로 / 경량으로 / 고성능으로). 지금은 명세 글자 그대로 | D P-7, A0 |
| B-2 | C-20 `daily_quota_exhausted` | 제목이 "무료 한도"로 고정돼 있다. 유료 등급의 일일 한도(Claude·OpenAI tier 한도)에도 같은 문구를 쓰는지 | A0 |
| B-3 | C-20 보존 문구 | "입력·부분 결과 보존"이 규칙으로만 있고 화면 문구가 없음(지금 "입력과 지금까지 만든 결과는 그대로 있어요") | D P-8 |
| B-4 | C-20 외부 링크 범위 | 공통 "각 안내에 공급자 대시보드 링크" ↔ 행별 버튼 표(input_rejected·시스템은 링크 없음). 구현은 표를 따름 | A0 P-B1 |
| B-5 | C-09 키 없음 | 주 버튼 "직접 입력하기"일 때 C-20 한 줄을 보이지 않게 함(키 무효·대화 실패일 때만 보임). 맞는지 | A0 |
| B-6 | C-19 등급 글자 | 구현 "무료 등급 / 유료 등급"(리더 결정으로 유지) ↔ 02 C-19 예시 "Claude · 유료". 문서를 어느 쪽으로 맞출지 | A0, A1 (UQ-262) |
| B-7 | C-19 유료 툴팁, C-21 재동의 알림, S-42 불러오기 오류 | 화면 문구 없음(임시 문구 사용) | D P-10 |
| B-8 | C-14 키 없음 변형 | 작성 중 세션이 있을 때 키 없음 변형보다 "이어서 쓰기" 팝업이 먼저인지(지금은 이어서 쓰기 우선) | A0 |
| B-9 | 거절 토스트 | `notifyAiRejected`의 `key_missing` 토스트 "AI 연결하면 사용할 수 있어요" ↔ C-20 `key_missing` 제목 "키가 삭제되어…". 하나로 맞출지 | A4 (디자이너와 함께) |

### 계정·연결 (A1)

| # | 대상 | 내용 | 출처 |
|---|------|------|------|
| B-10 | S-24 | "S-40 고지 다시 보기 링크"의 대상: 활성 공급자 고지를 바로 열지, S-40으로만 보낼지 | A1 |
| B-11 | S-40 | 활성 전환 때 재동의 비교 기준: 현재 활성의 동의와 비교하는지, 대상 공급자의 기존 동의와 비교하는지 | A1 |
| B-12 | S-40 | 무효 키를 활성으로 고를 수 있는지(지금은 불가) | A1 |
| B-13 | S-41 ③ | 새 키 등록 중 `key_invalid` 문구. C-20의 "더 이상 작동하지 않아요"는 새 키에 맞지 않음 | A1 |
| B-14 | S-41 ③ | 교체 중 실패할 때 "기존 키 유지" 안내 문구(지금 "기존 키는 그대로 쓰여요") | D P-9 |
| B-15 | S-42 | 입력 토큰 정의: 행의 입력 토큰에 캐시 읽기·쓰기를 넣는지(지금은 넣음, `totals` RPC 컬럼은 캐시 제외) | A0 P-B2 (UQ-203) |
| B-16 | S-25 | 탈퇴 요약의 `ai` 세 개수(키·동의·사용 기록)를 보이는 게 맞는지(04에 RPC 반환 형태 없음) | A0 |

### 커리어 (A2)

| # | 대상 | 내용 | 출처 |
|---|------|------|------|
| B-17 | S-36 | 키가 없을 때 진행 중 대화의 입력창: 잠그고 입력 보존(지금)인지, 숨기는지 | A2 |
| B-18 | S-36 | 키 없는 상태에서 보낼 때 C-18을 보일지, C-20 `key_missing`을 보일지(지금은 미리 C-18. 실행 중 삭제만 C-20) | A2 |
| B-19 | S-08 | 트리 행 "AI와 상세 내용 추가"에도 C-18 인라인형이 필요한지 | A2 |
| B-20 | S-36 | 메시지 상한의 [새 보강 대화]를 새 프로젝트 대화(프로젝트가 아직 없음)에서는 어떻게 할지 | A2 |
| B-21 | S-36 · FL-14 | v5.2 안에 BYOK 이전 문구 3곳: 상한 도달 입력창 문구 vs 상태 문구, FL-14 "대화 1회 사용 안내", `usage_event_id` 데이터 줄 (UQ-297) | A2 |

### 기업 JD (A3)

| # | 대상 | 내용 | 출처 |
|---|------|------|------|
| B-22 | S-14 | 키 없을 때 입력한 회사명·포지션명을 `job_descriptions.company_name`/`position_title`(`source = user`)에도 저장하는지. 지금은 저장함(파운데이션 배치) | A3 |
| B-23 | S-16~S-19 · S-20 | "요건 추출 먼저"(D-30)를 화면에 어떻게 보일지(별도 진행 단계 vs 안내 한 줄, 지금은 한 줄). 요건 추출이 실패(`not_a_jd`)하면 면접 시작을 막는지(지금은 막고 C-20을 보임) | A3, A4 |
| B-24 | C-18 / FL-19 | "{원래 기능}" 자리에 들어갈 기능 이름이 진입점마다 정해져 있지 않음(C-18 진입점 표에 기능 이름 열 없음) — UQ-350 | Q |
| B-25 | S-15 | 요건 추출 결과에도 C-19 결과 배지(`extraction_provider`)를 붙이는지(명세는 S-16·S-19·S-22만) | A3 |

### 면접·보드 (A4)

| # | 대상 | 내용 | 출처 |
|---|------|------|------|
| B-26 | S-20·S-37·S-22 | 세션 "실행 공급자"의 단계 이름. `interview_sessions`에 `model_tier` 컬럼이 없음. 지금은 ai_jobs에서 도출 | A4 |
| B-27 | S-22 | 다시 채점 잠금(C-18)의 기능 설명 문구(C-18 진입점 표에 다시 채점 행 없음) | A4 |
| B-28 | S-37 | 키 무효일 때 "새 면접"이 C-16 선택까지 막는지(지금은 누르면 C-20 `key_invalid`). FL-16은 무효 키를 "있음" 경로로 보냄 | A4 |
| B-29 | S-33 | 키가 없는 상태에서 `key_missing`이 아닌 다른 원인의 실패를 볼 때, 다시 시도 자리를 어떻게 처리할지 | A4 |

**합계: 29건**(B-1~B-29).

먼저 정할 것:
- B-24: FL-19 핵심 문장이고 UQ-350의 기대 동작이 여기에 달림
- B-6: 리더 결정을 문서에 고정
- B-2: 유료 사용자에게 틀린 문구가 나갈 수 있음

## 기계 검사 출력

- `pnpm lint` (`eslint`): exit 0, 오류·경고 0
- `pnpm typecheck` (`tsc --noEmit`): exit 0
- `pnpm build`: exit 0, `✓ Generating static pages using 11 workers (39/39)`
- `pnpm exec next dev -p 3701`(확인 후 종료, 포트 해제 확인): 아래 38개 모두 200, 개발 로그 `Error`/`⨯` 0건
  - **A1**: `/`, `/consent`, `/policies`, `/settings`(기본·`ai-locked`), `/settings/ai`(기본·`ai-return`), `/settings/ai/usage`(기본·`ai-locked`), `/settings/ai/connect`(선택·`provider=gemini`·`mode=replace`), `/settings/withdraw`
  - **A2**: `/career`(기본·`ai-locked`·`ai-outage`), S-10 `ai-locked`, S-36 새 대화(게이트 + `experience_id` + `ai-locked`), S-36 대화(`key-missing`·`ai-waiting`)
  - **A3**: S-13, S-14(`ai-locked`, `from=board&ai-locked`), S-31 `ai-locked`, S-15 `ai-locked`, S-16(`ai-failed-daily-quota`·`key-missing`), S-17 `ai-locked`, S-18 `ai-locked`, S-19 `ai-failed-rate-limited`
  - **A4**: S-20(`type=job&ai-locked`·`extract-failed`), S-33 `key-missing`, S-22 `ai-failed-billing`, S-37 `ai-locked`, S-39 `ai-locked`
  - **공통**: `/dev/states`(기본·`ai-failed-safety`)
  - 확인한 문구:
    - C-18 "AI 연결하면 사용할 수 있어요"(`/career?state=ai-locked` 15곳)
    - NavAiStatus "AI 연결 안 됨"
    - S-36 게이트 대안 `projects/new?experience_id=…`
    - S-25 "공급자 사이트에서도 키를 폐기"
    - 장애 배너 "상태 페이지"
    - C-20 "무료 한도를 다 썼어요", "키가 삭제되어 작업을 끝냈어요. 입력은 저장돼 있어요", "결제 수단이나 크레딧을 확인해 주세요" + "결제 설정 (새 탭)", "안전 정책으로 응답을 받지 못했어요"
  - S-40 본문·복귀 배너(`ai-return`)는 클라이언트에서 불러와 HTML로는 확인하지 못함(코드로 확인)
