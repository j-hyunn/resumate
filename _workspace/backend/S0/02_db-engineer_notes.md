# S0 DB 구현 노트

## 만든 것
- `pnpm exec supabase init`(CLI 2.121.0, 기본이 비대화형 — IDE 설정 프롬프트 없음) → `supabase/config.toml`, `supabase/.gitignore`(`.branches`, `.temp`, `.env.keys`, `.env.local`, `.env.*.local`).
- `supabase/migrations/.gitkeep`, `supabase/tests/.gitkeep`, `supabase/seed.sql`(주석만).
- 테이블·RLS·역할·RPC·pgTAP 테스트: 없음(S0 범위 밖).

## config.toml 변경점 (나머지는 CLI 기본값)
| 항목 | 값 | 이유 |
|------|----|------|
| `project_id` | `resumate` | 기본값이 워크트리 디렉터리 이름(`backend-work-495ef2`)이라 교체. 로컬 Docker 컨테이너 이름 접두사로 쓰인다 |
| `auth.site_url` | `http://localhost:3000` | Next dev 서버 |
| `auth.additional_redirect_urls` | `http://localhost:3000`, `http://localhost:3000/auth/callback`, `http://127.0.0.1:3000`, `http://127.0.0.1:3000/auth/callback` | 매직 링크 `emailRedirectTo`·OAuth 콜백(`/auth/callback`). 127.0.0.1 변형은 브라우저를 IP로 열었을 때 대비. 정확 일치 목록(와일드카드 없음) |
| `[auth.email]` | `enable_signup = true`(기본 유지), `enable_confirmations = false`(기본 유지) | 매직 링크는 별도 스위치가 없고 이메일 provider가 켜져 있으면 `signInWithOtp`로 동작. 첫 로그인 시 사용자 생성. 로컬 메일은 Mailpit/Inbucket(`http://127.0.0.1:54324`)에서 확인 |
| `[auth.external.google]` | `enabled = false`, `client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"`, `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`, `skip_nonce_check = false` | D-09 Google 로그인 자리. 실제 자격 증명 생기면 `supabase/.env`(루트 `.gitignore`의 `.env*`로 무시됨)에 넣고 `enabled = true`. `skip_nonce_check`는 ID 토큰 로그인(One Tap)용이라 리다이렉트(PKCE) 흐름에선 끄지 않음 |
| `[db.seed]` | 기본 유지(`sql_paths = ["./seed.sql"]`) | |

- 검증: `pnpm exec supabase status`가 config 파싱을 통과하고 Docker 부재 단계(`docker: command not found`)에서 멈춤 → TOML·`env()` 구문 문제 없음. 로컬 스택 기동은 미검증.

## env
- `.env.example`에 추가(기존 줄은 그대로): `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`(더미). Next 앱이 아니라 Supabase CLI가 읽는 키 — `src/server/env.ts` 스키마에는 넣지 않는다.

## git ignore
- `supabase/.temp`, `supabase/.branches`: `supabase/.gitignore`와 루트 `.gitignore` 둘 다에서 무시됨(`git check-ignore` 확인). `supabase/.env`도 루트 `.env*`로 무시됨.

## 확인
- `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(2 파일, 24 테스트).

## 미룬 것 (S1, Docker 필요)
- `supabase start` / `db reset` / `test db`, `src/server/db/database.types.ts` 생성.
- Google provider 실제 활성화(자격 증명 필요). 원격 프로젝트 `config push`는 하지 않음.
- 매직 링크 이메일 템플릿 커스터마이즈(`[auth.email.template.magic_link]`)는 기획에 요구 없어 기본 템플릿 유지.

## 스펙 차이
- 없음(`spec-gaps.md` 추가 없음).
