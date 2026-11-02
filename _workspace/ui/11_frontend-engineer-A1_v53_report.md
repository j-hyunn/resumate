# A1 계정·설정 구현 보고 — 기획 v5.3 (브리프 1-1 · 1-2 · 1-3)

> 2026-10-30. 기준: 플로우 v5.3(FL-07 · S-02 · S-25 · S-40 · C-21 · 5.1c), design-system v3 `(v3)` 문단(6 A1 S-25, 5.7 공급자 카드, 3.19, 3.21, G-33/G-36/G-38), 파운데이션 보고 `09_…A0_v53_report.md`(QA 1차 수정 포함), 파운데이션 QA `10_…foundation_review.md`(A1 몫: UQ-410, S-25 위치·S-02 콜백). mock만, 커밋 없음.
> 검사: `pnpm lint` 통과(경고 3건, 모두 A2 `chat-screen.tsx`) · `pnpm typecheck` **A2 파일 1건만 실패**(`career/writing-chat/chat-screen.tsx:496`, A2 수정 중) — A1 파일 오류 없음 · build는 지시대로 생략. dev 서버(:3000) SSR 200 확인: `/settings/withdraw`(+`deletion-busy`), `/settings/withdraw/finalize`(+`deletion-incomplete`: 카드만, 사이드바 없음 / 상태값 없음: `/settings/withdraw`로 307), `/settings/ai?state=consent-required`, `/sign-in?state=deletion-incomplete`. **클릭 흐름(동의 창 → 카드 갱신, 탈퇴 결과별 분기)은 브라우저로 보지 못했다** → ui-qa 확인 필요.

## 완료 화면

| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---------|--------|--------------|------|
| S-25 회원 탈퇴 | `/settings/withdraw` | loading · error · unauth · empty · save-failed(그 밖 오류) · **deletion-busy**(첫 요청이 busy) · **deletion-incomplete**(→ 탈퇴 마무리로 이동) | 1-1 |
| S-25 탈퇴 마무리 상태 (신설 경로) | `/settings/withdraw/finalize` (`(public)` 그룹 → 셸 밖, 동의 게이트 밖) | loading · **deletion-incomplete**(실상태 없이 카드) · **save-failed**(마무리 실패 한 줄) | 1-1 · 1-2. 실상태가 `deletion_incomplete`가 아니면 `/settings/withdraw`로 보냄 |
| S-02 가입/로그인 | `/sign-in` | 기존 + **deletion-incomplete**(로그인하면 탈퇴 마무리로) | 1-2 |
| S-40 AI 연결 (페이지 + 설정 다이얼로그 "AI 연결" 섹션) | `/settings/ai` | 기존 + **consent-required** | 1-3 |
| S-24 설정 계정 섹션 "AI 연결" 한 줄 | 다이얼로그 · `/settings` | (연결 상태 따라) | 동의 필요형 배지 |

### 1-1 S-25 (`components/account/withdraw-form.tsx`, `app/(dashboard)/settings/withdraw/page.tsx`)
- 문구 입력 제거 → **확인 체크**(`rounded-md border border-input p-4` + Checkbox + `label text-base`) "모든 데이터가 즉시 삭제되고 되돌릴 수 없다는 것을 이해했어요". 체크해야 **"탈퇴하기"**(destructive, 오른쪽, 요청 중 Loader2) 활성.
- 요청: `deleteAccountConfirmedAction({ confirm: true }, { fail, simulate })`.
  - 성공 → 로그아웃(`signOutAction`) → `/`, 토스트 없음(G-38, 기존 완료 토스트 제거).
  - `account_deletion_busy` → 버튼 위 `Alert warning` + `Hourglass`, "다른 작업과 겹쳐 탈퇴를 마치지 못했어요. **지운 것은 없어요.** 잠시 후 다시 시도해 주세요." 요약·체크 그대로, Alert 안 버튼 없음(다시 "탈퇴하기").
  - `account_deletion_incomplete` → 탈퇴 마무리 상태 경로로 `replace`.
  - 그 밖 → ST-SAVE-FAILED 한 줄 "탈퇴를 처리하지 못했어요. 잠시 후 다시 시도해 주세요"(명세 문구, 기존 `actionFailedMessage("탈퇴")` 대신).
  - 오류 표시 뒤 포커스를 오류로 옮김.
- 페이지 서버에서 `get_account_deletion_state()`가 `deletion_incomplete`면 탈퇴 마무리 경로로 redirect.

### 1-1 · 1-2 탈퇴 마무리 상태 (`components/account/withdraw-finalize-card.tsx`, `app/(public)/settings/withdraw/finalize/page.tsx`)
- design-system 6 A1 (v3) 카드 그대로: `Card max-w-md mx-auto mt-16 p-8`, 경고 원형 아이콘, 제목 "데이터는 모두 지웠지만 계정 정보 삭제를 마치지 못했어요.", 본문 "잠시 후 다시 시도해 주세요.", "탈퇴 마무리하기"(destructive 전체 폭) · "로그아웃"(ghost 전체 폭). 요약·체크·AI 연결 안내 없음.
- `(public)` 레이아웃(상단 h-14 로고만) → 셸 사이드바·메뉴 없음, 약관 동의 게이트 밖. 경로가 `routes.withdraw()` 아래라 셸 가드(`startsWith`) 통과.
- 탈퇴 마무리하기 = 같은 요청(`confirm: true`) 다시 → 성공 시 로그아웃 → `/`(토스트 없음). 실패 시 카드 그대로 + 버튼 위 ST-SAVE-FAILED 한 줄.
- 도착 시 제목에 포커스.

### 1-2 S-02 로그인 → 탈퇴 마무리 먼저 (`components/account/actions.ts`, `sign-in-form.tsx`, `app/(public)/sign-in/page.tsx`)
- `completeSignIn()` 결과 `deletion_incomplete: true`면 **S-03·`next`·S-08보다 먼저** `/settings/withdraw/finalize`(`next`는 버림). 매직 링크(개발용 "메일의 로그인 링크 열기")와 Google 둘 다.
- 실데이터 재현: `/dev/states?state=mock-controls` "계정 상태 → 탈퇴 미완료" 뒤 픽스처 이메일 또는 Google로 로그인. 미리보기: `/sign-in?state=deletion-incomplete`.
- 셸(대시보드) · S-03 쪽은 파운데이션 가드(`deletion-guard.tsx`)가 `/settings/withdraw`로 보내고, 그 페이지가 서버에서 다시 마무리 경로로 보낸다.

### 1-3 S-40 (`components/account/ai-connection-panel.tsx`, `provider-card.tsx`, `ai-status-line.tsx`)
- 활성 카드 **"동의 필요"**(`ai_connection.consent_required = true`, 키 `valid`·`needs_check`일 때만): 1행 C-19 배지 동의 필요형("{공급자} · {등급} · 동의 필요", ScrollText, warning — `StaticConnectionBadge consent`), 키 상태 줄 아래 둘째 줄 `ScrollText text-warning` + "{공급자}({등급})의 데이터 사용 고지가 바뀌어 다시 동의해야 AI를 쓸 수 있어요"(`ProviderConsentLine`), 3열 앞 **"동의하기"**(default sm).
- "동의하기" → `DataUseConsentDialog`(활성 공급자·등급, `confirmLabel="동의하기"`) → 동의 저장 → 다시 읽기 → 카드 "연결됨"(둘째 줄 사라짐). 동의 뒤 토스트 없음(G-36).
- 복귀 배너: 동의가 남아 있으면 "돌아가기"는 outline, 동의하면 default(5.7 (v3)).
- 활성 변경 확인 문구 → "다음 실행부터 {공급자}({등급})로 실행돼요. 다시 시도·다시 생성·다시 채점도 {공급자}로 해요. 진행 중인 작업만 원래 공급자로 끝까지 해요"(`switchConfirmText`, 조사 로/으로 자동). 재동의 판정은 기존대로 서버(`needsDataUseConsentAction`, A20 `requires_reconsent` 규칙) → 필요할 때만 S-41 ①②.
- 설정 다이얼로그의 "AI 연결" 섹션은 같은 패널이라 그대로 반영. 계정 섹션 "AI 연결" 한 줄도 동의 필요형 배지·접근 이름("… · 동의 필요").
- UQ-410: 파운데이션이 `aiRetry={false}`를 이미 넣어 해소된 상태 그대로 둠.
- 설정 "화면" 섹션(테마)은 건드리지 않음.

## 미완료 / 부분 구현
- 없음. 단, 클릭 흐름은 브라우저로 확인하지 못함(위).

## [UI-가정]

| 화면 ID | 파일:줄 | 내용 |
|---------|---------|------|
| S-25 | `components/account/withdraw-routes.ts` | 탈퇴 마무리 상태를 별도 경로 `/settings/withdraw/finalize`(`(public)` 그룹, 셸 밖)로 둠. `routes.withdrawFinalize()`가 생길 때까지 A1 로컬 헬퍼 |
| S-25 | `app/(public)/settings/withdraw/finalize/page.tsx` | 실상태가 미완료가 아니면 `/settings/withdraw`로 보냄. 개발 미리보기 값이 있으면 실상태와 상관없이 카드 표시 |
| S-25 | `components/account/withdraw-finalize-card.tsx` | 마무리 재요청 실패는 busy/incomplete/그 밖 모두 같은 ST-SAVE-FAILED 한 줄 |
| S-25 | `components/account/withdraw-form.tsx` | "취소"(→ 설정) 버튼 유지(명세 행 없음, 기존 동작) |
| S-25 | `components/account/withdraw-form.tsx` `signOutToLanding` | 로그아웃 실패는 보이지 않고 `/`로 감(S-24 로그아웃과 같음). 탈퇴 마무리의 "로그아웃"도 `/`로 |
| S-02 | `components/account/actions.ts` `destinationHref` | 탈퇴 미완료 계정은 `next`를 버림(다른 화면으로 갈 수 없음) |
| S-40 | `components/account/ai-connection-panel.tsx` | 동의 필요 중 복귀 배너 "돌아가기"는 outline(동의하면 default) |
| S-40 | 같은 파일 `applyPreview` `consent-required` | 미리보기는 재동의 Alert를 켠 채 동의 창을 연다(명세 문구가 "고지가 바뀌어") |

## 기획 확인 필요

| 화면 ID | 질문 | 스펙 위치 |
|---------|------|-----------|
| S-25 | 탈퇴 마무리 재요청이 `account_deletion_busy`를 돌려줄 때 문구를 busy 문구로 할지(지금은 그 밖 오류 한 줄) | 02 S-25 표 "탈퇴 마무리 상태" 행 |
| S-25 | 탈퇴 마무리 상태의 "로그아웃" 뒤 이동 위치(S-01 `/` 가정) | 02 S-25 · FL-07 |
| S-40 | 동의 필요 카드 문구가 "고지가 바뀌어"로 고정 — 동의 기록이 아예 없는 활성 공급자(이론상 키 등록 때 동의를 받으므로 드묾)에도 같은 문구인지 | 02 S-40 공급자 카드 "동의 필요" |

## 파운데이션 요청
1. `lib/routes.ts`에 `withdrawFinalize: () => "/settings/withdraw/finalize"` 추가 → A1 `withdraw-routes.ts` 대체(호출부 3곳: `withdraw-form.tsx`, `actions.ts`, `settings/withdraw/page.tsx`).
2. (선택) `deletion-guard.tsx`가 `/settings/withdraw` 대신 바로 마무리 경로로 보내면 한 번 덜 돈다. 지금도 S-25 페이지 서버 redirect로 동작함.
3. (참고) `deleteAccount`(옛 문구 입력용)와 `deleteAccountAction`(A1 `actions.ts`)은 이제 화면에서 쓰지 않음. A1 `deleteAccountAction`은 남겨 둠 — 정리 여부는 리더 판단.

## 검사 결과
- `pnpm lint`: 오류 0, 경고 3(전부 A2 `src/components/career/writing-chat/chat-screen.tsx` 미사용 변수).
- `pnpm typecheck`: 실패 1건, **A2 파일만** — `src/components/career/writing-chat/chat-screen.tsx(496,21) TS2322`(`error_code` 누락). A1 파일 오류 없음.
- `pnpm build`: 지시대로 실행 안 함.
