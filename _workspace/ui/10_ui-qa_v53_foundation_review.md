# UI QA — 기획 v5.3 파운데이션(A0) (라운드 1)

> 2026-10-30. 기준: 플로우 v5.3(C-03·C-04·C-09·C-14·C-18~C-21·5.1c) · 데이터 모델 v4.2(2.11.7·6장·A.9·A.15) · design-system v3 `(v3)` 문단 · 브리프 `08_brief_v53.md` F1–F12 · 엔지니어 보고 `09_frontend-engineer-A0_v53_report.md`.
> 방법: 코드 경로 대조 + 실행 중인 dev 서버(:3000) SSR curl. **브라우저 클릭 흐름(동의 창 → 실행 이어짐, 카운트다운, 마무리 중 → 통째 교체)은 눈으로 보지 않았다** — 코드 경로로만 확인했다(클라이언트 연결 상태는 SSR에 없어서 "처음부터 다시"·대기 줄은 SSR HTML에 나오지 않는 것이 정상).

## 요약 — Critical 0 / Major 6 / Minor 8

- 기계 검사: `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm build` 통과(39 경로, 경고 0).
- F1–F12의 핵심 동작(동의 게이트, 다시 시도 배지·처음부터 다시, 거부 코드 5종, 입력 원인 실패, 요청 안 경로 카운트다운, 단계 문구, 진행 표시 우선순위, `validated` 통째 교체, C-09 `project_fields`, C-14, 타입)은 명세대로 들어와 있다. 경로 ② 판정 순서(`ai_job_not_retryable` → `key_missing` → `key_invalid` → `ai_consent_required` → (`ai_connection_changed`))도 DM 2.11.7과 같다.
- 파운데이션 Major 3건: ① `AiErrorNotice`가 모든 `onRetry`를 동의 게이트로 감싸고 활성 공급자 배지를 붙여 AI 실행이 아닌 S-40 키 "다시 확인"까지 바뀜 ② 스트림 실패 때 실패 문항의 임시 블록이 남음 ③ 요건 추출(경로 ⑤) 서버 게이트 없음.
- 영역 회귀 Major 3건: S-16 다시 시도 거부가 화면에 안 보임(A3), S-37 행 단계 문구가 채점 중 "공고 요건 정리 중"(A4), S-22 "다시 채점"이 취소된 작업에서 거부됨(A4).

## 화면별 점검표

| 항목 | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | 메모 |
|------|----|----|------|----|----|----|----|----|-----|------|
| F1 동의 게이트 (`useAiConsentGate`, AiRunButton) | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | 동의 뒤 누른 실행 이어감, 닫으면 아무것도 안 보냄. 동의 창 제목·버튼 글자는 [UI-가정] |
| F2 C-20 `key_missing` 동의 원인 | ✅ | ✅ | — | — | ✅ | — | ✅ | ⚠️ | — | UQ-403(첫 프레임 깜빡임), UQ-404(onRetry 없는 곳에서 동의 뒤 "AI 연결하기") |
| F3 다시 시도 배지·처음부터 다시 | ⚠️ | ✅ | — | — | ✅ | — | ✅ | — | — | UQ-400(AI 실행 아닌 다시 시도에도 배지·게이트) |
| F4 거부 코드·판정 순서 | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ✅ | — | 경로 ①②③④⑤ mock 일치. 경로 ⑤ 요건 추출만 누락(UQ-402), ③ 동의 미확인(UQ-405) |
| F5 입력 원인 실패 | ✅ | ✅ | — | — | ✅ | — | ✅ | — | — | 다시 시도·배지·토큰 주석 없음, caption [UI-가정] |
| F6 요청 안 경로 카운트다운 | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | — | mock 스트림 대기 옵션 잔존(UQ-408) |
| F7 단계 문구 | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | — | — | prepare 300ms 즉시 체크는 미구현([UI-가정] 기록됨) |
| F8 진행 표시 우선순위 | ✅ | ✅ | — | — | ✅ | — | ✅ | — | — | `resolveAiFeatureStatus` 순수 판정 OK |
| F9 스트리밍 `validated` 교체·마무리 중 | ⚠️ | ✅ | — | — | ✅ | ✅ | ✅ | — | — | UQ-401 |
| F10 C-09 `project_fields` | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | 판정 순서 DM 6장과 같음, S-10 `?focus=fields` 링크 |
| F11 C-14 | ✅ | ⚠️ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | "S-20에서" → "면접 준비에서" [UI-가정] (기획 확인) |
| F12 `types/db.ts` v4.2 | — | — | ⚠️ | — | — | — | — | — | — | UQ-406 |
| 탈퇴 미완료 가드 | ⚠️ | — | ✅ | ⚠️ | ✅ | — | — | — | — | UQ-407 |
| 새 `?state=` · `/dev/states` | — | — | — | ✅ | ✅ | — | ✅ | — | — | 14개 값 모두 200. 영역 화면 배선은 영역 몫(아래 메모) |

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-400 | Major | A0 | C-20 (S-40 등) | 02 C-18 "모든 AI 실행 시작 전"(새 작업·다시 시도·요청 범위 작업·대화 턴), DS 3.20 "(v3) 다시 시도 옆 공급자 배지"(AI 재실행 버튼 대상) | `src/components/common/ai-error-notice.tsx:412`(모든 `onRetry`를 `consent.guard`로 감쌈), `:472`(배지 기본 표시) · 호출부 `src/components/account/ai-connection-panel.tsx:381` | AI 실행이 아닌 다시 시도(S-40 카드 키 "다시 확인" = 키 검증)는 동의 게이트·활성 공급자 배지 대상이 아님. 끌 수 있는 prop 필요 | S-40 카드(예: OpenAI) 다시 확인 실패 줄의 "다시 시도" 옆에 **활성 공급자**(예: Gemini) 배지가 붙고, 활성 공급자가 `consent_required`면 누를 때 **활성 공급자** C-21이 열려 다른 공급자 키 확인을 막음. `hideRetryBadge`는 있으나 동의 게이트를 끄는 방법이 없음 |
| UQ-401 | Major | A0 | C-04 (S-19 자소서) | 02 C-04 "스트리밍 중 블록은 임시 … `validated`에서 통째로 교체", C-20 "자기소개서의 이미 완료된 문항" 보존, DS 3.4 `error` 행 | `src/components/common/streaming.tsx:176-177` | 실패하면 `validated`로 확정된 문항만 남고, 실패한 문항 자리는 C-20 inline만 | `prev.filter(b => b.state === "validated" \|\| b.state === "completed")` — 실패 문항의 **확정 안 된 `completed` 임시 블록이 남는다**(주석 "unconfirmed blocks are dropped"와 반대). 서버에 없는 글이 화면에 남고 편집·복사는 막힌 채로 보임 |
| UQ-402 | Major | A0 | S-15 요건 추출 (데이터 계층) | DM 2.11.7 경로 ⑤(키 없음·동의 필요 = `key_missing`, 무효 = `key_invalid`), DM 2.9.1 (2) 요청 범위 작업 다시 생성 = 새 작업, 02 C-20 경로 ⑤ readiness 재조회 | `src/lib/data/drafts.ts:860-888` (`retryJdExtraction` / `runJdExtraction`) | 시작 전에 `assertAiRunnable(db, "request")`, 거부는 `{ rejected }`로 돌려줌 → AiRunButton·C-20이 동의 원인/키 없음 구분 | 게이트를 부르지 않음: `consent_required`여도 서버가 그대로 추출을 돌리고, 키 없음·무효는 `false`만 돌려줘 화면이 아무 안내 없이 새로고침. 실패 행을 같은 행으로 다시 씀. F2/F4의 S-15 경로를 mock 데이터로 재현할 수 없음 |
| UQ-403 | Minor | A0 | C-20 `key_missing` | DS 3.20 `key_missing` 행 "읽는 동안 동작 줄 자리는 Skeleton … 잘못된 'AI 연결하기'가 잠깐 보이지 않게" | `src/components/common/ai-error-notice.tsx:389-395`, `src/components/common/ai-connection-context.tsx:124-133` | 첫 그림부터 Skeleton | `pending` 초깃값 false, 재조회는 effect에서 시작 → 첫 프레임에 "AI 연결하기"(또는 다시 시도)와 키 삭제 문구가 잠깐 보임. Provider 밖(ctx null)에서는 재조회 자체를 안 함 |
| UQ-404 | Minor | A0 | C-20 `key_missing` | 02 C-20 경로 ③④⑤ 끝 문장("이미 연결된 공급자에서 'AI 연결하기' → S-40 → … 반복되지 않게") | `src/components/common/ai-error-notice.tsx:584-603` · 예: `src/components/interviews/answer-sheet.tsx:386` | 동의(또는 재연결) 뒤 쓸 수 있는 키가 있으면 "AI 연결하기"를 보이지 않음 | `onRetry` 없이 쓰는 곳에서는 "동의하기" → 동의 → `reconnected && canRetry`가 false라 다시 "AI 연결하기"로 떨어짐 — 명세가 막으려는 반복 |
| UQ-405 | Minor | A0 | mock 경로 ③ | DM 2.11.7 ③ `check_ai_run_allowed`(동의 필요 → `key_missing`, 무효 → `key_invalid`) | `src/lib/mock/ai.ts:274-278` (`advanceMockJob`) | 실행 중 단계 확인이 동의·무효도 봄 | 키 삭제만 확인. mock 제어 "재동의 필요한 고지 게시"를 해도 진행 중 작업이 끝까지 돌아 F2(동의 원인 `key_missing`)를 실제 mock 데이터로 재현할 수 없음(`?state=`로만 가능) |
| UQ-406 | Minor | A0 | types | DM A.15 `ai_jobs` v4.2 `step_outputs` jsonb (`run_generation` 내부) | `src/types/db.ts:899` `AiJob` | 컬럼 이름을 그대로 둠 | `step_outputs`(및 결과 테이블·ai_jobs `run_generation`) 없음. 화면이 쓰지 않더라도 `supabase gen types` 교체 때 차이가 남 |
| UQ-407 | Minor | A0 | L-01 셸 · S-25 | 02 S-25/FL-07 A7 "S-08·원래 URL·S-03보다 먼저 S-25, 다른 메뉴 이동 없음 [가정]" | `src/components/common/shell/deletion-guard.tsx:20-31`, `src/app/(dashboard)/layout.tsx:47-49` | 첫 화면부터 S-25 | 클라이언트 effect에서 판정 → 원래 페이지·메뉴가 먼저 그려지고 잠깐 조작 가능. `/consent`(S-03)는 대시보드 레이아웃 밖이라 가드가 없음(S-02 콜백 처리는 A1 몫인지 확인 필요) |
| UQ-408 | Minor | A0 | C-04 mock · S-36 | 02 C-20 "요청 안에서 끝나는 경로의 대기"(A14: 대화 턴·서류 스트리밍은 대기 재시도 없음, 바로 실패) | `src/lib/mock/ai-stream.ts:77-83, 131, 171, 243`, `src/components/common/streaming.tsx` `waitSec` · 호출부 `src/components/career/writing-chat/chat-screen.tsx:190` (`?state=ai-waiting`) | 요청 안 경로에 첫 토큰 전 "한도 대기" 없음 | mock 스트림·대화 턴이 여전히 `rate_wait` 대기 이벤트를 낼 수 있고, S-36이 그 미리보기를 씀 → A14와 반대 모양. 옵션 제거(또는 비권장 표시) 필요, S-36 쪽은 A2가 정리 |
| UQ-409 | Major | A3 | S-16 인사이트 | 02 C-20 "다시 시도 거부" 행, DS 3.20 거부 표, 엔지니어 보고 5절 ②("`useAiJob.error`가 거부 코드를 더 이상 담지 않음 — `refusal` 사용") | `src/components/applications/insight-view.tsx:178-188` | `<AiErrorNotice {...aiErrorFromJob(job.job)} refusal={job.refusal} retrying={job.retrying} rerunLabel="다시 생성" … />` | `refusal`을 넘기지 않아 **같은 행 다시 시도가 409로 거부되면 화면에 아무것도 안 바뀜**(회귀: 전에는 `error`가 key_missing으로 바뀌어 보였음). `aiErrorFromJob`을 안 써서 `sameRow`·`jobTier`가 없어 "{활성 공급자}로 처음부터 다시 해요"도 안 나옴(F3), `rerunLabel` 없음 |
| UQ-410 | Minor | A1 | S-40 | DS 3.20 다시 시도 배지(AI 재실행 대상) | `src/components/account/ai-connection-panel.tsx:381` | 카드 키 다시 확인 줄에는 활성 공급자 배지 없음 | 회귀 ③: 활성 공급자 배지가 새로 붙음. `hideRetryBadge` 전달 + UQ-400 opt-out 반영 |
| UQ-411 | Major | A4 | S-37 | 02 C-03 단계 문구(채점 `prepare` "채점 준비 중", 질문 `generate` "질문 만드는 중 (n/N)", `complete` 문구 없음·직전 유지) | `src/components/interviews/session-list.tsx:34-38` (`<AiProgressInline progress={progress} />`) | `jobType={job?.job_type}` 전달 | 회귀 ④: mock이 이제 `prepare`·`complete`를 내므로 S-37 채점 행이 "공고 요건 정리 중"(명세가 틀린 안내라고 짚은 문구), 끝에서 "마무리 중", 질문 생성 행이 "작성 중 2/5"로 보임 |
| UQ-412 | Minor | A4 | S-22 | DS 3.20 다시 시도 배지 1개(RetryButton 바로 뒤) | `src/components/interviews/result-view.tsx:223-234` | 배지 하나 | 회귀 ③: `keyFixed`일 때 AiErrorNotice가 붙인 배지 + 바로 아래 `<ProviderBadge>`로 C-19가 두 번 보임 → `hideRetryBadge` 또는 아래 배지 삭제 |
| UQ-413 | Major | A4 | S-22 · S-33 | 02 FL-12 A9 "다시 채점" = 새 작업(DM 2.9.1 (2), 경로 ①), DM 2.11.7 ② `ai_job_not_retryable`(`failed` 아닌 행 = 취소 포함) | `src/components/interviews/actions.ts:86-120` (`retryEvaluation`·`retryQuestionGeneration` → 같은 행 `retryAiJob`), `result-view.tsx:135`, `answer-sheet.tsx:168` | 다시 채점은 `regradeFailedAnswersAction`(새 작업), "남은 질문 다시 만들기"도 새 작업 | 회귀 ⑤: 최신 채점·질문 작업이 **취소된** 경우 `retryAiJob`이 이제 `ai_job_not_retryable`로 거부 → 토스트 "이 작업은 다시 시도할 수 없어요…"만 나오고 다시 채점이 안 됨(전에는 다시 돌았음). 브리프 4-1 작업과 함께 고칠 것 |

## 영역 작업 메모 (회귀 아님 — 영역 리뷰에서 확인)

- **A2 S-36**: 보내기·다시 보내기가 `useAiConsentGate`를 안 거침(`consent_required`면 요청 전에 C-21이어야 함). 실패 턴 `AiErrorNotice`(`chat-screen.tsx:799`)에 `requestPath` 없음 → 제목이 "N분 뒤 다시 시도해 주세요"이고 "{N}초 뒤 다시 보낼 수 있어요" 줄이 없음. `message_count`가 인사 제외로 1 줄어든 것(보고 ⑥) 반영 확인.
- **A3**: `applications/_lib/gate-preview.ts:10-12`가 `?state=insufficient-project-fields`를 `projectFields: true`로 넘기지 않아 S-16/S-17/S-20 게이트에서 이 미리보기가 안 됨(지금은 `/dev/states`에서만 보임 — 보고 4절과 다름). S-15 `jd-view.tsx:196` 실패 줄에 `requestPath`·`rerunLabel="요건 정리하기"` 없음. 인사이트 시작(`insight-view.tsx` `start`)이 거부를 토스트로만 처리 — AiRunButton `onRun`에서 결과를 돌려주면 동의 창·잠금을 버튼이 처리함.
- **A4**: S-22 C-20 블록의 `lockEntry`(기본 "insight") — 다시 시도 거부 `key_missing` 때 면접 진입점 문구가 되게 지정 필요. S-39 카드 F8 `AiFeatureStatus`.
- **A1**: S-25 탈퇴 마무리 위치(G-38)와 S-02 `completeSignIn().deletion_incomplete` 처리(UQ-407의 S-03 우회와 같이).

## 기획 확인 필요

| 화면 | 내용 | 스펙 위치 |
|------|------|-----------|
| C-21 | 실행 전 동의 창의 제목·확인 버튼 글자(구현 "{공급자}({등급}) 데이터 사용 동의" / "동의하고 계속", [UI-가정] G-36). 명세 C-21은 S-41 ② 단계 글자("다음")만 있음 | 02 C-21 |
| C-20 | 입력 원인 실패 caption "고친 뒤 {실행 버튼}로 새로 실행해 주세요", 요청 안 경로 `rate_limited` 제목(명세 "{N}분 뒤" vs 초 단위 카운트다운 줄) | 02 C-20 `rate_limited` 행 · "요청 안에서 끝나는 경로의 대기" |
| C-14 | "S-20에서 그만두고"를 화면 문장으로 쓰는 표현(구현 "면접 준비에서") | 02 C-14 작성 중 세션 행 |
| S-36 | 대화 시작(시작 인사 삽입)도 동의를 먼저 받아야 하는지 — 구현은 첫 턴에서 동의 | 02 C-18 R-67 목록에 "AI 작성 대화 턴"만 있음 |
| DM | 인사이트 작업 `target_type` 픽스처가 `insight`, DM v4.2는 `application_project` — 백엔드 연결 때 정리 | 04 §2.9.1 `target_type` |

## 재확인 결과

이번 사이클(v5.3)의 첫 파운데이션 리뷰라 재확인할 파운데이션 이슈 없음. 직전 통합 리뷰(07)의 미해결 UQ-240·UQ-354는 ui-designer 문서 건이라 이번 범위 밖(다시 보지 않음).

## 기계 검사 출력

- `pnpm lint` → `eslint` 종료 코드 0, 출력 없음.
- `pnpm typecheck` → `tsc --noEmit` 종료 코드 0.
- `pnpm build` → Next.js 16.4.2 (Turbopack), "Compiled successfully", TypeScript 통과, 정적 페이지 39/39, 종료 코드 0, 경고 0.
- SSR(dev :3000): `/dev/states` + `?state=` 14개(consent-required, retry-other-provider, retry-refused-key-missing/consent/key-invalid, retry-connection-changed, retry-not-retryable, input-failed, request-wait, finalizing, insufficient-project-fields, interview-prompt, deletion-busy, deletion-incomplete) 모두 200. 문구 확인: "AI 연결이 필요해요. 작성한 내용은 저장돼 있어요", "AI 연결이 방금 바뀌었어요", "이 작업은 다시 시도할 수 없어요", "고친 뒤 …"(4), "마저 채우기", "이름이나 역할이 비어", "마지막 활동", "마무리 중", "동의 필요". `/career`·`/applications`·`/board`·`/interviews`·`/settings/ai`·`/settings/withdraw`(+`?state=deletion-*`)·`/applications/ap-1/insight?state=consent-required` 200.
