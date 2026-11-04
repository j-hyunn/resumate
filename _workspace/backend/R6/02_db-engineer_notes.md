# R6 db-engineer 노트 — 로그인 Google 단일화

근거: docs/planning/decisions.md 3.11, 4.5. 마이그레이션·pgTAP·생성 타입 변경 없음.

## 변경 사항

| 파일 | 변경 |
|---|---|
| `supabase/config.toml` `[auth]` | `enable_signup = true` 유지 + 주석: 이 값은 `GOTRUE_DISABLE_SIGNUP`이며 Google 첫 로그인(=가입)도 막는다 |
| `supabase/config.toml` `[auth.rate_limit]` | `email_sent` 주석에 "앱이 인증 메일을 보내지 않음(미사용)" 추가, 값 유지 |
| `supabase/config.toml` `[auth.email]` | 주석 교체: 앱에서 이메일 로그인 제거(R6), 공급자는 로컬 통합 테스트(admin.createUser + signInWithPassword) 때문에만 켜 둠, 호스팅은 대시보드에서 끔. `enable_signup = true` 유지(아래 "계획과 다른 점") |
| `supabase/config.toml` `[auth.email.template.magic_link]`, `[auth.email.template.confirmation]` | 블록 삭제 |
| `supabase/templates/magic_link.html`, `confirmation.html` | 삭제(폴더도 비어 사라짐). 남은 참조는 `_workspace/` 이력 노트와 `src/server/services/auth/magic-link.integration.test.ts`(api-engineer가 삭제 예정) 주석뿐 |
| `supabase/config.toml` `[auth.external.google]` | 주석 교체: 유일한 로그인 수단, 커밋 값은 `enabled = false` 유지, 로컬에서 켜는 절차(콘솔 redirect URI `http://127.0.0.1:54321/auth/v1/callback`, `supabase/.env`에 두 env 변수, 로컬에서만 `enabled = true`, `supabase stop && supabase start`) |

`additional_redirect_urls`: `http://localhost:3000`, `http://localhost:3000/auth/callback`, `http://127.0.0.1:3000`, `http://127.0.0.1:3000/auth/callback` — `/auth/callback` 포함 확인, 변경 없음. `supabase/.env`는 루트 `.gitignore`의 `.env*`로 무시됨 확인.

## 계획과 다른 점 — `enable_signup = false` 적용 안 함

계획(01_plan.md db-engineer 1)은 `[auth.email] enable_signup = false`를 제안했지만 적용하지 않았다.

- Supabase CLI는 `[auth.email] enable_signup`을 `GOTRUE_EXTERNAL_EMAIL_ENABLED`(이메일 공급자 전체 on/off)로 넘긴다. 실행 중인 로컬 auth 컨테이너 env에서 `GOTRUE_EXTERNAL_EMAIL_ENABLED=true`, `GOTRUE_DISABLE_SIGNUP=false`(= `[auth] enable_signup`)를 확인했다. "가입만 막기" 스위치가 아니다.
- 공급자를 끄면 GoTrue가 `grant_type=password`를 "Email logins are disabled"로 거절한다. 통합 테스트 17개 파일(`src/**/*.integration.test.ts`, 예: `src/server/db/ai-writer.integration.test.ts:26,32`)이 `admin.auth.admin.createUser` 다음 `signInWithPassword`로 로그인하므로 전부 깨진다. admin.createUser가 이 설정을 우회한다는 계획의 전제와 별개로, signInWithPassword가 막힌다.
- `[auth] enable_signup = false`도 답이 아니다. 새 Google 사용자 생성이 막혀 첫 로그인이 실패한다.
- 앱에 이메일 로그인 UI·액션이 없으므로 로컬에서 공급자가 켜져 있어도 제품 경로는 열리지 않는다. 남는 것은 anon 키로 GoTrue `/signup`을 직접 부르는 경로인데, 로컬 전용이다. 호스팅에서는 대시보드에서 Email 공급자를 끈다(아래).
- 실제 auth 컨테이너를 false로 다시 띄워 확인하지는 않았다(공유 로컬 스택이고 api-engineer가 병렬로 쓰는 중). 근거는 CLI 매핑(컨테이너 env)과 GoTrue 동작에 대한 지식이다.

## 사용자가 호스팅 대시보드에서 직접 할 일

1. Authentication → Sign In / Providers → **Email**: 끈다(Enable Email provider off). 호스팅에서는 테스트가 비밀번호 로그인을 쓰지 않으므로 안전하다.
2. 같은 화면의 **Allow new users to sign up**(전체 가입 허용)은 **켜 둔다**. 끄면 Google 첫 로그인이 실패한다.
3. Authentication → Emails(Templates): Magic Link·Confirm signup 템플릿을 예전에 바꿨다면 기본값으로 돌리거나 그대로 둬도 된다(발송 경로가 없어짐). 커스텀 SMTP를 R6 목적으로 붙일 필요는 없어졌다.
4. Authentication → Providers → **Google**: 켜져 있는지, Client ID/Secret이 실제 값인지 확인. Google Cloud Console OAuth 클라이언트의 Authorized redirect URI에 `https://<project-ref>.supabase.co/auth/v1/callback`이 있는지 확인.
5. Authentication → URL Configuration: Site URL = 운영 Vercel 도메인. Redirect URLs에 `https://<운영 도메인>/auth/callback`(필요하면 `/**`), 미리보기 배포용 `https://*-<team>.vercel.app/auth/callback` 같은 와일드카드 패턴, 로컬 `http://localhost:3000/auth/callback`이 있는지 확인. `redirectTo`에 `?next=`가 붙으므로 정확 일치만 쓰면 `/**` 패턴이 필요할 수 있다.

## 확인 결과

- 템플릿 참조 grep: config.toml의 주석 처리된 기본 예시(invite, password_changed)만 남음.
- pgTAP 이메일 의존 확인: `supabase/tests/*.sql`은 `auth.users`에 직접 insert하고 `auth.identities`·공급자 설정을 쓰지 않음 → 이메일 공급자 의존 없음.
- `supabase status`(이 워크트리 config 로드): 정상, 파싱 오류 없음.
- `supabase test db`: 53 파일 / 2500 테스트 중 2개 실패 — `ai_provider_keys.test.sql` 35("nothing stored after the refusals", have 1), `drafts_qa1.test.sql` 14(기대 밖 job `0c734ddf…`, 2026-11-03 생성). 원인은 공유 로컬 DB에 남은 데이터(auth.users 1명, ai_provider_keys 1행, ai_jobs 잔여 행). 이번 config 변경과 무관. 사용자 로컬 데이터를 지우게 되므로 `supabase db reset`은 하지 않았다. 깨끗한 확인이 필요하면 리셋 후 재실행.
- auth 설정 변경은 auth 컨테이너 재시작(`supabase stop && supabase start`) 후에 반영된다. 공유 스택이라 재시작하지 않았다 → 새 config로 띄운 상태의 확인은 SKIP.
- 원격 프로젝트·커밋: 손대지 않음. `src/` 수정 없음.

## 추가 (2026-11-04, 리더)
- `[auth.external.google] enabled = true`로 바꿔 커밋한다(위 14행의 "커밋 값 false 유지"를 대체). 자격 증명 없이도 config 로드는 되고 Google 버튼만 실패함을 확인. `enabled = "env(...)"`는 변수가 없으면 "Expected boolean" 로드 오류라 쓰지 않음. 자격 증명은 체크아웃마다 `supabase/.env`(gitignored).
