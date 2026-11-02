# UI QA — 기획 v5.3 A1 계정·설정 (라운드 1)

> 2026-10-30. 범위: 브리프 `08_brief_v53.md` 1-1~1-3 (S-25 확인 체크·오류 2종·탈퇴 마무리 상태, S-02 미완료 계정 재진입, S-40 동의 필요·활성 변경 확인 문구, S-24 계정 줄·설정 다이얼로그 "AI 연결" 섹션) + 파운데이션 수정 재확인 UQ-400 · UQ-410.
> 기준: 플로우 v5.3(FL-07 · S-02 · S-25 · S-40 · C-18 · C-20 · C-21), design-system v3(3.19 · 3.21 · 5.7 · 6 A1 (v3) · G-33/G-36/G-38), 엔지니어 보고 `11_frontend-engineer-A1_v53_report.md`, 파운데이션 보고 `09_…A0_v53_report.md`.
> 방법: 코드 정적 대조 + dev 서버(:3000) curl(SSR HTML·리다이렉트). **브라우저 클릭 흐름(동의 창 → 카드 갱신, 탈퇴 결과 분기)과 좁은 화면 렌더는 눈으로 보지 못했다** — 코드 경로로 확인했고, 좁은 화면 항목은 폭 계산 추정이다.

## 요약

- **Critical 0 / Major 0 / Minor 4** (UQ-450 ~ UQ-453)
- 재확인: UQ-400 해결 · UQ-410 해결
- 기계 검사: `pnpm lint` 통과(경고 0) · `pnpm typecheck` 통과 · `pnpm build` 생략(지시). A2 `chat-screen.tsx` 오류는 지금 시점에는 사라졌다(A2 수정 반영).

브리프 1-1~1-3의 흐름은 모두 명세대로 이어진다. 확인 체크 → `confirm: true` → 성공 시 로그아웃 → `/`(토스트 없음), `account_deletion_busy` → 같은 화면 Alert(요약·체크 유지), `account_deletion_incomplete` → 셸 밖 탈퇴 마무리 카드(요약·체크 없음, "탈퇴 마무리하기"·"로그아웃"), 미완료 계정 로그인 → `next`·S-03·S-08보다 먼저 탈퇴 마무리, S-40 활성 카드 "동의 필요" → C-21 → 다시 읽기 → "연결됨"·"돌아가기" 강조. 남은 것은 활성 변경 확인 문구의 조사 표기(UQ-450), 가드를 거치는 재진입 때 셸이 잠깐 그려지는 것(UQ-451), 좁은 화면 배지 넘침 추정(UQ-452), 탈퇴 마무리 페이지의 `?state=` 처리(UQ-453)다.

## 화면별 점검표

| 화면 ID | Q1 스펙 행 | Q2 문구 | Q3–4 타입·필드 | Q5 경로 | Q6 상태 | Q7 AI 방식 | Q8 디자인 | Q9 접근성 | Q10 좁은 화면 | 메모 |
|---------|-----------|---------|----------------|---------|---------|------------|-----------|-----------|---------------|------|
| S-25 정상 (`/settings/withdraw`) | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | 확인 체크·busy Alert(Hourglass, "지운 것은 없어요." 굵게)·그 밖 오류 한 줄·오류로 포커스. "취소" 버튼은 [UI-가정] |
| S-25 탈퇴 마무리 (`/settings/withdraw/finalize`) | ✅ | ✅ | ✅ | ⚠️ UQ-451 | ⚠️ UQ-453 | — | ✅ | ✅ | ✅ | `(public)` 셸 밖, 사이드바 없음(SSR 확인), 도착 시 제목 포커스, 재실패 시 버튼 위 한 줄 |
| S-02 가입/로그인 | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | `deletion_incomplete`면 `next` 버림 → 마무리(매직 링크·Google 둘 다). `?state=deletion-incomplete` |
| S-40 AI 연결 (페이지 + 다이얼로그 섹션) | ✅ | ⚠️ UQ-450 | ✅ | ✅ | ✅ | ✅(동기 키 확인만) | ✅ | ✅ | ⚠️ UQ-452 | 동의 필요형 배지·둘째 줄·"동의하기"(default sm, 3열 앞)·C-21 `confirmLabel="동의하기"`·동의 뒤 토스트 없음·`돌아가기` outline→default |
| S-24 계정 "AI 연결" 한 줄 | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | 동의 필요형 배지 + 접근 이름 "… · 동의 필요" |
| C-21 동의 창 (S-40 사용처) | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ✅ | — | 동의 저장 → `markConsentGiven` → 셸 연결 컨텍스트 갱신. 닫으면 아무것도 저장 안 함 |

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-450 | Minor | A1 | S-40 활성 변경 확인 | 02 S-40 "활성 공급자 선택" 행: "다음 실행부터 {공급자}({등급})로 실행돼요. 다시 시도·다시 생성·다시 채점도 **{공급자}로** 해요. 진행 중인 작업만 원래 공급자로 끝까지 해요" (브리프 1-3) | `src/components/account/ai-connection-panel.tsx:552` (`${name}${directionParticle(name)} 해요`) · `src/lib/data/labels.ts:305-307` (한글이 아니면 `"(으)로"`) | "…다시 채점도 Gemini로 해요" (Claude로 / OpenAI로) | 공급자 이름이 모두 영문(`Gemini`·`Claude`·`OpenAI`)이라 `directionParticle`이 늘 `"(으)로"`를 돌려줌 → **"다시 채점도 Gemini(으)로 해요"**. 같은 문장 앞쪽은 "Gemini(무료 등급)로"로 고정이라 한 문장 안에서도 어긋남. 보고서의 "조사 로/으로 자동"은 영문 이름에서 동작하지 않음(node로 함수 그대로 실행해 확인). 세 공급자 이름이 모두 "로"이므로 고정 "로"로 충분 |
| UQ-451 | Minor | 파운데이션 | S-25 탈퇴 마무리 재진입 (L-01 가드 · S-03 가드) | 02 FL-07 A7 "이 상태에서는 다른 메뉴로 갈 수 없고", S-25 "재진입" 행, DS 6 A1 (v3) "셸 사이드바와 메뉴 없이 … 셸 밖 배치"(G-38) | `src/components/common/shell/deletion-guard.tsx:38` (`router.replace(routes.withdraw())`) → `src/app/(dashboard)/settings/withdraw/page.tsx:49-50` (`ScreenSuspense` 안의 `redirect`) | 대시보드 경로·S-03에서 미완료가 판정되면 셸 없이 곧바로 탈퇴 마무리 카드 | 가드가 대시보드 경로인 `/settings/withdraw`로 보내고(이 경로는 가드 면제라 덮개도 없음), 그 페이지가 Suspense 안에서 다시 `redirect` → 스트리밍 리다이렉트가 된다. curl `/settings/withdraw?state=deletion-incomplete`: HTML에 셸(`data-sidebar`)이 먼저 그려지고 `<meta http-equiv="refresh" content="1;url=/settings/withdraw/finalize…">` + `NEXT_REDIRECT`. 클라이언트 이동 전까지 사이드바 메뉴가 보이고 눌린다. A1 보고의 파운데이션 요청 1·2(`routes.withdrawFinalize()` 추가 → 가드가 바로 그 경로로, A1 `withdraw-routes.ts` 대체)로 함께 고칠 것 |
| UQ-452 | Minor | A1 | S-40 공급자 카드 (좁은 화면) | DS 5.7 (v3) 동의 필요 행(1행 C-19 동의 필요형 배지 + 3열 "동의하기"), UX-9 좁은 화면 | `src/components/account/provider-card.tsx:72` (배지 글자 `whitespace-nowrap`), `:213-245` (`grid-cols-[auto_1fr_auto]`, 2열 `min-w-0`) | 375px에서도 배지가 2열 안에 들어가거나 줄바꿈되어 버튼과 겹치지 않음 | **추정(브라우저 미확인)**: 375px 페이지에서 카드 안쪽 약 311px, 3열 "동의하기"+⋯ 약 116px → 2열 약 155px인데 "Gemini · 무료 등급 · 동의 필요" 배지는 약 190px(text-xs, 줄바꿈 금지) → 3열 버튼 쪽으로 넘침. `needs_check` + 동의 필요면 "다시 확인"까지 붙어 2열이 약 70px. 설정 다이얼로그 섹션(좁은 화면)은 더 좁음. 배지 줄을 3열 아래로 내리거나(좁은 화면) 배지 `whitespace-normal`/`max-w-full truncate` 등. 같은 구조의 "· 확인 필요" 배지 + "다시 확인"도 같은 문제 |
| UQ-453 | Minor | A1 | S-25 탈퇴 마무리 | 02 S-25 "탈퇴 마무리 상태"는 `deletion_incomplete`일 때만, ui-context `?state=` 미리보기 규칙(그 상태의 ST 화면) | `src/app/(public)/settings/withdraw/finalize/page.tsx:42` (`if (!state && …) redirect(...)`) | 지원하는 미리보기(`loading`·`deletion-incomplete`·`save-failed`)만 실상태 판정을 건너뜀. `error`·`unauth`는 ST 화면 | `?state=` 값이 무엇이든(예: `bogus`, `error`, `unauth`) 실상태 확인 없이 카드를 그림(curl `?state=bogus` → 200 카드). 개발 미리보기 한정이지만 `error`/`unauth`가 ST 화면이 아닌 카드로 보임 |

## 기획 확인 필요

A1 보고의 세 항목을 그대로 유지한다(QA가 새로 찾은 스펙 모순은 없음).

| 화면 | 질문 | 스펙 위치 |
|------|------|-----------|
| S-25 | 탈퇴 마무리 재요청이 `account_deletion_busy`·`account_deletion_incomplete`를 다시 받을 때 문구. 표는 "탈퇴 마무리하기 → 같은 요청 다시"만 적고 재실패 문구가 없다(지금은 "그 밖 오류" 한 줄, DS 6 A1 (v3) [가정]) | 02 S-25 "탈퇴 마무리 상태" 행 · FL-07 `F -->|탈퇴 마무리하기| C` |
| S-25 | 탈퇴 마무리 상태의 "로그아웃" 뒤 이동 위치(지금 `/` 가정). FL-07은 성공 뒤만 S-01로 적음 | 02 FL-07 · S-25 |
| S-40 | 동의 필요 카드 문구가 "고지가 바뀌어 다시 동의해야"로 고정 — `consent_required`의 다른 원인(활성 공급자·등급에 살아 있는 동의가 아예 없음, DM 2.11.5)에도 같은 문구인지 | 02 S-40 공급자 카드 "동의 필요" vs C-18 `consent_required` 정의 |

## 재확인 결과

| ID | 결과 | 메모 |
|----|------|------|
| UQ-400 (A0, Major) | 해결 | `AiErrorNotice aiRetry` prop(기본 true) 추가. `false`면 `onRetry`를 `consent.guard`로 감싸지 않고(`src/components/common/ai-error-notice.tsx:420`), 다시 시도 옆 활성 공급자 배지(`:480`)와 "처음부터 다시" 줄(`:664`)도 뺀다. 토큰 주석 "다시 시도하면 토큰을 다시 써요"는 남음 — 키 확인도 토큰을 쓰므로(S-42 `key_verification`) 문제 없음 |
| UQ-410 (A1, Minor) | 해결 | S-40 카드 키 "다시 확인" 실패 줄 `src/components/account/ai-connection-panel.tsx:431`이 `aiRetry={false}` → 활성 공급자 배지·활성 공급자 C-21 게이트 없음. 다른 공급자 카드의 다시 확인이 활성 공급자 동의에 막히지 않음 |

## 브리프 항목별 확인 메모

- **1-1 S-25**: 문구 입력 없음, 확인 체크(`rounded-md border border-input p-4`, `Checkbox` + `label htmlFor`)를 켜야 "탈퇴하기"(destructive, 오른쪽, `Loader2`) 활성. `deleteAccountConfirmedAction({ confirm: true })`. busy → 버튼 위 `Alert warning` + `Hourglass`, Alert 안 버튼 없음, 체크 유지 → "탈퇴하기" 다시(G-38). incomplete → `router.replace` 마무리 경로. 그 밖 → "탈퇴를 처리하지 못했어요. 잠시 후 다시 시도해 주세요". 성공 → `signOutAction` → `/`, 토스트 없음. mock busy는 아무것도 지우지 않고, incomplete는 `account_deletion_state`를 세워 재진입을 재현함. 마무리 성공 시 `resetMockDb`로 제어값도 초기화.
- **1-2 재진입**: `completeSignIn` → `deletion_incomplete: true` → `destinationHref`가 S-03·`next`·S-08보다 먼저 마무리(매직 링크·Google 공통, `src/components/account/actions.ts:33-42`). 셸 경로와 S-03은 파운데이션 가드 → `/settings/withdraw` → 서버 redirect(UQ-451). 마무리 페이지는 `(public)` 레이아웃(상단 h-14 로고만), SSR에 `data-sidebar` 없음 확인.
- **1-3 S-40**: 동의 필요는 키 `valid`·`needs_check`이고 `connection.active_provider`가 그 카드일 때만(`ai-connection-panel.tsx:246-251`). 무효 키가 먼저(DS 3.18). 배지 "{공급자} · {등급} · 동의 필요" + `ScrollText`(`provider-card.tsx:56-63`), 둘째 줄 명세 문구 일치(`:159`). "동의하기" → `DataUseConsentDialog`(활성 공급자·등급) → `markConsentGiven`(셸 컨텍스트 갱신) → `fetchData` → "연결됨". 재동의 판정은 서버 `needsDataUseConsentAction`(A20 `requires_reconsent` 규칙) — 필요할 때만 S-41 ①②. 확인 문구는 UQ-450 외 일치. 설정 다이얼로그 "AI 연결" 섹션은 같은 패널이라 동일. 설정 "화면" 섹션은 변경 없음.
- `?state=`: S-25 `loading`·`error`·`unauth`·`empty`·`save-failed`·`deletion-busy`·`deletion-incomplete` / 마무리 `loading`·`deletion-incomplete`·`save-failed` / S-02 `deletion-incomplete` / S-40 `consent-required` — 모두 200 응답 확인. `/settings/ai/page.tsx` 상단 주석의 상태 목록에 `consent-required`가 빠져 있음(동작 영향 없음, 고칠 때 같이).
- 정리 대상(리더 판단): 옛 문구 입력용 `deleteAccount`(`lib/data/account.ts`)·`deleteAccountAction`(`components/account/actions.ts:121`)은 화면에서 더 이상 쓰지 않음.

## 기계 검사 출력

- `pnpm lint`: `eslint` — 오류 0, 경고 0 (종료 코드 0).
- `pnpm typecheck`: `tsc --noEmit` — 오류 0 (종료 코드 0). A1 보고 시점의 A2 `chat-screen.tsx:496` 오류는 지금은 없음.
- `pnpm build`: 지시대로 실행하지 않음.
- dev 서버 curl: `/settings/withdraw`(기본·`deletion-busy`·`save-failed`) 200, `?state=deletion-incomplete` 200 + 스트리밍 리다이렉트(→ 마무리), `/settings/withdraw/finalize`(기본) 200 + 스트리밍 리다이렉트(→ `/settings/withdraw`, 실상태 active), `?state=deletion-incomplete`·`save-failed` 200 카드, `/sign-in?state=deletion-incomplete`·`/settings/ai?state=consent-required`·`/settings`·`/consent` 200.
