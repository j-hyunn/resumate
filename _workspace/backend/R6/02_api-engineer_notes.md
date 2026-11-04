# R6 api-engineer 노트 — 로그인 Google 단일화

근거: decisions.md 3.11 · 4.5, PRD F-COM-01 (Google 로그인만, 매직 링크 제거).

## 바뀐 파일
| 파일 | 변경 |
|------|------|
| `src/lib/contracts/auth.ts` | `SendMagicLinkInput`·`SendMagicLinkResult` 제거. `AUTH_ERROR_CODES`에서 `auth_rate_limited` 제거(남은 코드: `auth_failed`, `consent_required`). 주석 Google 전용으로 |
| `src/server/services/auth/index.ts` | `sendMagicLink` 제거. `mapAuthError`는 이메일 전용 분기(발송 rate limit → 429, `email_address_invalid`/`validation_failed` → invalid_input) 제거, 모든 Auth 오류 → `auth_failed`(502, 한국어 메시지). `EMAIL_OTP_TYPES`·`verifyOtp` 분기 제거, `completeAuthCallback`은 `code`만 받음. `CallbackParams`에서 `tokenHash`·`type` 제거 |
| `src/server/actions/auth.ts` | `sendMagicLink` 서버 액션 제거 (`signInWithGoogle`, `signOut`만 남음) |
| `src/app/auth/callback/route.ts` | `token_hash`·`type` 전달 제거, 주석 갱신 |
| `src/lib/data/account.ts` (연결 계층) | 실제 경로의 `authActions.sendMagicLink` 호출 제거 → 비미리보기 요청은 `AccountRequestError("magic link sign-in was removed (D-09 변경)")`. `sendMagicLink`(@deprecated)·`completeSignIn({ method: "magic_link" \| "google" })` 시그니처 유지, 미리보기(mock) 경로 그대로. "UI 재작업 때 제거(decisions.md 4.5)" 주석 |
| `src/lib/contracts/routes.ts`, `src/server/auth/site-url.ts`, `src/server/env.ts` | 주석에서 매직 링크 언급 정리(동작 변경 없음) |
| `src/server/services/auth/auth.test.ts` | sendMagicLink·rate-limit·invalid email·verifyOtp 케이스 제거. mapAuthError는 "모든 오류 → auth_failed" 케이스로 교체. **추가**: token_hash/type만 오고 code가 없는 콜백 → `LOGIN_CALLBACK_ERROR`, 세션 교환·동의 조회 호출 없음 |
| `src/lib/contracts/s1-contracts.test.ts` | `SendMagicLinkInput` 케이스 제거, `SignInWithGoogleInput` 케이스만 유지 |
| `src/server/services/auth/magic-link.integration.test.ts` | 삭제(작업 트리에서만, 스테이징 안 함) |

## 제거된 export
- `@/lib/contracts/auth`: `SendMagicLinkInput`(값·타입), `SendMagicLinkResult`, `AuthErrorCode`의 `"auth_rate_limited"`
- `@/server/services/auth`: `sendMagicLink`
- `@/server/actions/auth`: `sendMagicLink`
- `CallbackParams.tokenHash`, `CallbackParams.type`

`auth_rate_limited`는 src 전체 grep 결과 contracts·service·테스트 외 사용처가 없어서(UI 파일 포함) 제거했다.

## UI에 남은 일 (이 슬라이스에서는 손대지 않음)
- `src/components/account/sign-in-form.tsx`: 이메일 입력·재발송·"링크 열기" 대체 UI 제거, Google 버튼만
- `src/components/account/actions.ts`: `sendMagicLinkAction`, `openMagicLinkAction`(`completeSignIn({ method: "magic_link" })`) 제거
- 그 뒤 연결 계층 `src/lib/data/account.ts`의 `sendMagicLink` 삭제, `completeSignIn`의 `method`를 `"google"`로 좁히기 (UI 재작업과 같은 변경으로)
- 그때까지 실제(비미리보기) 환경에서 이메일 폼을 제출하면 `AccountRequestError` → 폼의 일반 오류 표시로 끝난다.

## 확인 결과
- `pnpm typecheck` (next typegen + tsc --noEmit): 통과
- `pnpm lint`: 통과(경고·오류 없음)
- `pnpm exec vitest run` 전체: 125 파일, 1967 테스트 통과 (auth·s1-contracts 2 파일 28 테스트 포함). 로컬 Supabase 스택이 필요한 통합 테스트는 기존처럼 skipIf로 건너뜀
- 참고: 이 worktree에 node_modules가 없어 `pnpm typecheck` 실행 시 pnpm이 의존성을 설치했다(lockfile 변경 없음)

## UI 재작업 후 정리

- 확인: UI 코드(`src/app`, `src/components`)에서 `sendMagicLink`·`completeSignIn` import가 더 이상 없음(grep).
- `src/lib/data/account.ts`
  - `sendMagicLink`(deprecated) 삭제.
  - `completeSignIn` 삭제 — 호출처가 `signInWithGoogle` 하나뿐이라 그 preview 본문에 인라인. `method: "magic_link"` 분기와 이메일 비교(fixture 사용자 판별) 제거.
  - `signInWithGoogle` preview 동작은 그대로: `fail` → `AccountRequestError`, `forceNewUser` → `consent`(신규), `account_deletion_state = deletion_incomplete` → `consent` + `deletion_incomplete: true`, 그 외 필수 동의 여부로 `career`/`consent`. 지연은 500ms(이전 500+400ms) 한 번으로 줄어듦. 실제 요청 경로(provider URL 반환)는 변경 없음.
  - 헤더 주석을 "Supabase Auth (Google)"로 정리.
- `src/lib/data` 테스트에 매직 링크 케이스 없음 — 수정 불필요.
- 검증: `pnpm typecheck`, `pnpm lint` 통과, `vitest run src/lib/data src/lib/contracts`(integration 제외) 16 files / 175 tests 통과.

## UQ-732 수정 — 콜백 실패 시 `next` 유지 (2026-11-04)

- 원인: `completeAuthCallback`이 `next`를 `safeNextPath`로 검사한 뒤 실패 경로(Google 취소 `?error=`, `code` 없음, 코드 교환 실패)에서 모두 `LOGIN_CALLBACK_ERROR`(`/sign-in?error=auth_callback`)를 돌려줘 `next`가 사라졌다. Google에서 취소하고 다시 로그인하면 S-08로 갔다(02 S-02 "원래 URL" 위반).
- 수정(`src/server/services/auth/index.ts`): `loginCallbackErrorUrl(next)`를 추가했다. 검사를 마친 `next`가 기본 목적지(`/career`)가 아니면 `/sign-in?error=auth_callback&next=<encoded>`를 만든다. 기본 목적지면 `next`를 붙이지 않는다(`routes.signIn`·`withNext`와 같은 방식). 실패 경로 네 곳 모두 이 값을 쓴다.
- `LOGIN_CALLBACK_ERROR`는 `next`가 없는 형태로 그대로 export한다(테스트에서 씀).
- `profile_missing`(로그아웃 후 S-02)도 `next`를 유지한다. 사용자는 로그아웃된 상태로 S-02에서 다시 시도하므로 붙여도 해가 없고, 실패 경로를 한 규칙으로 맞췄다. 탈퇴 미완료(S-25)는 이전처럼 `next`보다 먼저 간다.
- 열린 리디렉션: `next`는 여전히 `safeNextPath`를 거친다. `//host`, 절대 URL, `/\`, `/sign-in`, `/auth/callback`은 버려져 `next` 없는 오류 URL이 된다.
- UI 확인(읽기만): `src/app/(public)/sign-in/page.tsx`는 `isLoginError(sp.error)`로 Alert를, `safeNextPath(sp.next)`로 `next`를 함께 읽는다. UI는 고칠 것이 없다.
- 테스트(`src/server/services/auth/auth.test.ts`): Google 취소 + `next`(쿼리 포함 경로 인코딩), 코드 교환 실패 + `next`, 위험한·인증 페이지·기본 `next`는 빠짐, `profile_missing` + `next`, 기존 magic-link 형태 콜백 기대값을 `&next=%2Fboard`로 갱신. 19개 통과.
- 검사: `pnpm typecheck` 통과, `pnpm lint` 통과, `vitest src/server/services/auth` 19/19, `vitest src/lib/contracts` 82/82.
- 손대지 않음(참고): `signInWithGoogleAction(next, …)`은 실제 경로에서 인자 `next`를 쓰지 않고 `src/lib/data/account.ts`의 `nextFromSignInUrl()`이 요청 헤더에서 다시 읽는다. 결과는 같다. `src/components/account/actions.ts`는 내 수정 범위 밖이라 이번에는 정리하지 않았다.
