# R6 로그인 Google 단일화 — 요약 (2026-11-04)

## 만든 것
- 서버: 매직 링크 계약·서비스·액션 제거, 콜백은 PKCE `code`만 받음(`token_hash`/`verifyOtp` 분기 제거), `mapAuthError` 단순화(`auth_failed`만), `auth_rate_limited` 제거.
- 연결 계층 `src/lib/data/account.ts`: 실제 `sendMagicLink` 호출 제거 → 실요청은 `AccountRequestError`. 미리보기 경로·시그니처는 UI 재작업 때까지 유지(@deprecated).
- Supabase: `magic_link`·`confirmation` 템플릿 블록·파일 삭제, `[auth]`/`[auth.email]`/`[auth.external.google]` 주석 갱신. 로컬 `[auth.email]`은 통합 테스트용으로 켠 채 둠.
- 테스트: 매직 링크 케이스·통합 테스트 삭제, `token_hash`만 온 콜백 → 로그인 오류 케이스 추가.

## 검사
typecheck 통과 · lint 통과 · vitest 125파일/1967 통과 · build 통과(더미 env) · pgTAP 기존 잔여 데이터 실패 2건(R6 무관, 마이그레이션 없음) · auth 컨테이너 재기동 SKIP(공유 스택).

## 열린 항목
- QA-01 (Minor): 해결 — config `[auth]` 주석 수정(리더).
- QA-02 (사용자 조치): 호스팅 대시보드에서 Email 공급자 끄기, "Allow new users to sign up" 켜 둠, Google 공급자·리디렉트 URL 확인. 상세는 02_db-engineer_notes.md.
- UI 후속: S-02 sign-in-form·components/account/actions.ts·sign-in 페이지 콜백 오류 문구, 그 뒤 lib/data 잔여 제거 → `resumate-ui`.

## [가정]
- 로컬 Google OAuth는 자격 증명 없으면 꺼 둠(로컬 화면 로그인은 미리보기 또는 실제 자격 증명으로).
