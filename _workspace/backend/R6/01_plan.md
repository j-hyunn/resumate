# R6 로그인 Google 단일화 — 계획 (2026-11-04)

근거: docs/planning/decisions.md 3.11·4.5 (D-09 변경, 확정 2026-11-04 사용자), PRD v4.7 F-COM-01, UX v5.7 S-02, DM F-COM-01 행.
S1 foundation의 인증 부분을 고치는 수정 슬라이스. 스키마 변경 없음(마이그레이션 없음). 원격 개발 브랜치 적용 없음.

## 범위

### api-engineer
1. `src/lib/contracts/auth.ts`: `SendMagicLinkInput`·`SendMagicLinkResult` 제거, `AUTH_ERROR_CODES`에서 `auth_rate_limited` 제거(다른 곳에서 쓰는지 grep 후). 주석의 "magic link + Google" → Google만.
2. `src/server/services/auth/index.ts`: `sendMagicLink` 제거, `mapAuthError`에서 이메일 전용 분기(이메일 발송 rate limit, `email_address_invalid`) 정리 — Google OAuth 시작 실패용으로 단순화. `completeAuthCallback`에서 `token_hash`/`verifyOtp` 분기와 `EMAIL_OTP_TYPES` 제거 → `code`만 받음. `CallbackParams`에서 `tokenHash`·`type` 제거.
3. `src/app/auth/callback/route.ts`: `token_hash`·`type` 전달 제거, 주석 갱신.
4. `src/server/actions/auth.ts`: `sendMagicLink` 액션 제거.
5. 테스트: `auth.test.ts`의 sendMagicLink·rate-limit·verifyOtp 케이스 제거/수정(token_hash만 오면 로그인 오류 경로로 가는 케이스 추가), `s1-contracts.test.ts`의 SendMagicLinkInput 케이스 제거, `magic-link.integration.test.ts` 삭제.
6. 연결 계층 `src/lib/data/account.ts`(wiring 소유): 실제 경로의 `authActions.sendMagicLink` 호출 제거. **UI(sign-in-form.tsx, components/account/actions.ts)는 이 슬라이스에서 고치지 않는다** — 그래서 `sendMagicLink`/`completeSignIn({method:"magic_link"})` 함수 시그니처는 남기되, 실제(비미리보기) 요청에서는 `AccountRequestError`로 실패시키고 "D-09 변경: UI 재작업 때 제거" 주석. 미리보기(mock) 경로는 그대로 둬서 UI 빌드·미리보기가 깨지지 않게 한다.
7. 문서 주석(`proxy.ts`, `site-url.ts` 등)에 매직 링크 언급이 있으면 정리.

### db-engineer
1. `supabase/config.toml`: `[auth.email]` 주석을 "이메일 로그인 끔(D-09 변경), 테스트용 admin.createUser·signInWithPassword만"으로, `enable_signup = false`(자가 가입 차단; admin.createUser는 영향 없음 — 통합 테스트가 이것을 씀). `[auth.email.template.magic_link]`·`[auth.email.template.confirmation]` 블록 제거, `supabase/templates/magic_link.html`·`confirmation.html` 삭제. `[auth.rate_limit] email_sent` 주석 정리(값은 그대로 둬도 됨).
2. `[auth.external.google]` 주석 갱신: 이제 유일한 로그인 수단. 로컬에서 로그인하려면 실제 OAuth 자격 증명 + `enabled = true` 필요(값은 false 유지 — 더미 키로 켜면 Google 화면에서 실패). redirect 허용 목록(`additional_redirect_urls`) 확인.
3. pgTAP·마이그레이션 변경 없음. 기존 테스트(`signup_consent_ai_gate.test.sql` 등)가 이메일 공급자에 의존하는지만 확인.
4. 원격(호스팅) 설정은 손대지 않는다 — 대시보드에서 Email 공급자 끄기·템플릿은 사용자 할 일로 노트에 적는다.

## 가정
- `[가정]` 통합 테스트는 admin.createUser + signInWithPassword로 사용자를 만든다 → 로컬 `[auth.email]`의 비밀번호 로그인은 테스트용으로 남긴다(앱 화면에는 노출 없음).
- `[가정]` 로컬 Google OAuth는 자격 증명이 없으면 꺼 둔다. 로컬 화면 로그인은 미리보기(`?state=`) 또는 실제 자격 증명으로.

## 연결(UI)
UI 몫(S-02 화면, components/account/actions.ts, mock의 magic_link)은 `resumate-ui`로 — decisions.md 4.5.
