# 구현 결정

- 2026-10-24 (S0) Supabase CLI는 프로젝트 devDependency(`supabase` npm 패키지)로 설치하고 `pnpm exec supabase`로 실행한다. 이유: 로컬 Xcode Command Line Tools가 오래되어 Homebrew 설치가 실패함. `run-checks.sh`는 `node_modules/.bin/supabase`를 인식한다.
- 2026-10-24 (S0) 로컬에 Docker가 없다. 로컬 Supabase 스택(`supabase start`)과 pgTAP은 Docker 설치 전까지 SKIP. S1부터는 pgTAP이 한 번은 돌아야 슬라이스를 `done`으로 둘 수 있다.
- 2026-10-24 (S0) CLT 업데이트 후 Homebrew로 Supabase CLI 2.122.0을 전역 설치했다. 프로젝트 devDependency(2.121)도 그대로 둔다. `run-checks.sh`는 전역 `supabase`를 먼저 쓰고, 다른 개발 환경과 CI는 `pnpm exec supabase`로 버전을 고정해서 쓴다.
- 2026-10-24 (S1) Docker 런타임은 Colima 0.10.3(vz, 4CPU/8GB) + Docker CLI 29.9. `colima start`로 띄운다. 맥 재부팅 후에는 `colima start`가 다시 필요하다.
- 2026-10-24 (S1) Next.js 16은 `middleware.ts` 대신 `proxy.ts` 파일 규칙을 쓴다. 세션 갱신은 루트 `src/proxy.ts`(src 디렉터리 구조 기준 위치는 api-engineer가 Next 문서로 확인)에 둔다. 하네스 문서의 `middleware.ts`는 `proxy.ts`로 읽는다.
- 2026-10-24 (S1) `next.config.ts`의 `cacheComponents: true`는 유지한다. 인증·쿠키를 쓰는 코드는 Cache Components 규칙(동적 API는 Suspense 경계 안, `'use cache'`에 쿠키 금지)을 따른다.
- 2026-10-24 (S1, db-engineer 확인) 로컬 스택(CLI 2.122)의 GoTrue는 사용자 세션 JWT를 **ES256(비대칭)**으로 서명하고, PostgREST는 JWKS에 ES256 공개키와 레거시 대칭 키(oct, HS256)를 함께 갖는다. 서버가 레거시 JWT secret으로 HS256 서명한 `role: app_ai_writer`, `sub: <user id>`, `aud: authenticated` 토큰을 PostgREST가 받아들이는 것을 실제 요청으로 확인했다(허용 컬럼 select 200, `display_name`·`consents` 403). 따라서 `createAiWriterClient`는 `SUPABASE_JWT_SECRET` HS256 방식을 쓴다. 원격(호스팅) 프로젝트에서 레거시 secret이 폐기되면 재검토.
- 2026-10-24 (S1) 내부 헬퍼 함수(트리거 함수, 동의 매핑 등)는 PostgREST에 노출되지 않는 `private` 스키마에 둔다: `private.set_updated_at()`, `private.touch_career_data_updated_at()`, `private.current_uid()`. `app_ai_writer`는 `auth` 스키마 USAGE가 없어 `auth.uid()`를 못 부르므로, `app_ai_writer` 대상 정책과 AI 역할이 실행하는 함수는 `(select private.current_uid())`를 쓴다.
- 2026-10-24 (S1) `app_ai_writer` 클라이언트(`src/server/db/ai-writer.ts`): `node:crypto`로 HS256 서명한 토큰을 쓴다(`role=app_ai_writer`, `sub`, `aud=authenticated`, `iss`, `exp` ≤ 300초, 요청마다 다른 `jti`). supabase-js `accessToken` 콜백이 요청마다 새로 서명한다. **출시 전 위험**: 호스팅 Supabase에서 레거시 JWT secret을 폐기하면 이 토큰이 거부된다. 그때는 `signAiWriterToken`만 비대칭 키 서명으로 바꾼다.
- 2026-10-24 (S1) 오류 코드는 S0 계약에 맞춰 소문자(`unauthenticated`, `consent_required` 등)를 쓴다. 로그인·동의 경로 `/login`, `/onboarding/consent`는 `src/lib/contracts/routes.ts`의 [가정] 값이며, UI 하네스가 경로를 정하면 거기에 맞춘다.
- 2026-10-24 (S1, QA-04) public 스키마의 기본 권한에서 anon·authenticated를 뺐고, 함수 EXECUTE to PUBLIC은 전역으로 회수했다. **S2부터 새 테이블·함수는 public·private 모두 grant를 명시한다.** RLS 정책이나 invoker RPC가 부르는 헬퍼 함수도 `grant execute ... to authenticated`가 필요하다. 허용 목록은 `supabase/tests/grants.test.sql`이 지키며, DM §5가 바뀔 때만 함께 고친다.
- 2026-10-25 (S2) 커리어 `status`는 DB 트리거가 계산한다(클라이언트 값 무시). 프로젝트는 `project_details` 변경 트리거가 다시 계산한다.
- 2026-10-25 (S2) `source_writing_chat_id`는 S2에서 uuid 컬럼만 두고, FK는 S4에서 `writing_chats`를 만들 때 추가한다.
- 2026-10-25 (S2) `get_deletion_impact`의 결과 영향 집계와 `delete_career_item`의 결과 처리는 S2에서 비어 있다. 결과 테이블이 생기는 S3·S5–S7에서 `create or replace`로 확장한다. `writing_chat` 대상은 S4에서 추가한다.
- 2026-10-25 (S2, QA-S2-02/03) 새 행 id는 클라이언트가 만든다(UUID). 자동 저장 재시도가 같은 id로 오면 중복을 만들지 않는다(멱등 insert). id 검증은 `z.guid()`로 Postgres uuid와 같은 기준을 쓴다.
- 2026-10-25 (S2, QA-S2-04) 상세 내용 변경 때문에 부모 프로젝트를 다시 계산할 때는, `status`가 실제로 바뀔 때만 `projects.updated_at`을 갱신한다(DM §4.2 "변경됨" 표시는 그대로 유지된다). 상세 내용 저장·삭제 응답은 부모 프로젝트의 `status`와 `updatedAt`을 함께 돌려줘, 화면이 다음 자동 저장의 `expectedUpdatedAt`을 바꿀 수 있게 한다.
- 2026-10-25 (S2, QA-S2-07) S4에서 `source_writing_chat_id` FK를 추가할 때는 복합 FK `(source_writing_chat_id, user_id)`로 만든다.
- 2026-10-26 (S3) 구조화 출력은 AI 명세 C-4대로 `output_config.format`(JSON 스키마)을 쓴다. 하네스 `ai-pipeline-impl` 스킬의 "강제 tool 호출" 지침은 명세와 다르다. 명세를 따르고, 하네스 문서는 나중에 고친다.
- 2026-10-26 (S3) 작업 성공 처리와 사용량 확정은 RPC `complete_ai_job` 하나로 한 트랜잭션에서 한다(성공 후 확정만 실패해 예약이 `reserved`로 남는 경우를 없앤다). 안전망으로 `sweep_stalled_ai_jobs`는 성공한 작업에 남은 예약을 `charged`로 바꾼다.
- 2026-10-26 (S3) 멈춘 작업은 상태 조회 때 지연 감지하는 것이 주 경로다. Vercel Cron(`/api/cron/stalled-jobs`)은 배포 때 설정한다. Hobby 플랜은 크론이 하루 1회다.
- 2026-10-26 (S3, QA-S3-01) 사용량 확정·해제는 예약 id 단위로 한다. `complete_ai_job`은 `p_usage_event_id`를 받아 그 예약만 확정한다. 수동 재시도는 작업 행 점유(failed → queued 조건부 update)에 성공한 쪽만 원장을 건드린다. 점유한 쪽은 남은 예약을 먼저 해제한 뒤 새로 예약한다.
- 2026-10-26 (S3, QA-S3-05) 실행기의 모든 쓰기·정산 조건에 `attempt_count`(실행 세대)를 넣어, 늦게 도착한 이전 실행이 새 실행을 건드리지 못하게 한다.
- 2026-10-26 (S3, QA-S3-07) 거절 시 서버 측 모델 대체는 사용자 결정 전까지 켜 둔다. 대체가 켜져 있으면 `refused`는 자동 재시도하지 않고, 토큰은 `usage.iterations`까지 합산한다.
- 2026-10-26 (S3, QA 1차 반영) 위 "sweep이 성공 작업의 남은 예약을 charged로" 결정을 **바꾼다**. `complete_ai_job`이 예약 id 단위로 같은 트랜잭션에서 확정하므로, 성공 작업에 남은 reserved 행은 중복 예약이다. 따라서 sweep은 이를 **released**로 바꾼다(이중 차감 방지). `complete_ai_job`은 4인자(`p_job_id`, `p_usage_event_id`, `p_attempt_count`, `p_progress`)이고, 같은 세대에서 이미 성공한 작업을 다시 호출하면 멱등으로 처리한다.
- 2026-10-27 (S3 후속, 사용자 결정) AI 명세 C-6대로 거절 시 서버 측 모델 대체를 **끈다**(`REFUSAL_FALLBACKS_ENABLED = false`). 거절(`refused`)이 나오면 그 작업은 바로 실패 처리하고 자동 재시도하지 않는다. 화면에서 재시도를 안내하고, 사용량은 차감하지 않는다. 대체 설정을 다시 켜도 `refused`는 자동 재시도하지 않는다.

## 2026-10-28 BYOK 재작업 결정 (사용자 승인: 권고안 B-1~B-4)
- B-1: S1~S3 마이그레이션은 고치지 않고 **새 마이그레이션(전진 방식)**으로 BYOK 구조로 바꾼다. 원장 테이블은 생성 기록이 남고, 새 파일에서 삭제한다.
- B-2: 키 암호화는 **KMS 어댑터 인터페이스 + 출시 전 임시 환경 변수 마스터 키**로 구현한다. KMS 공급사(AWS / GCP)는 배포 전에 정한다.
- B-3: OpenAI·Gemini 모델 ID와 가격은 **S3a 착수 때 공급자 공식 문서로 조사해 매핑안을 제시하고, 사용자 확인 뒤 가격표 첫 버전에 넣는다.**
- B-4: `next_run_at` 재시도는 **상태 폴링이 깨우는 것을 주 경로로, 크론을 안전망으로** 한다(spec-gaps 기록).
- 하네스 R0 완료: 백엔드 스킬·에이전트와 Codex 사본을 BYOK 기준으로 갱신했다(`.claude/harness/CHANGELOG.md` 2026-10-28).
- 앞선 결정 중 BYOK로 무효가 된 것: 사용량 원장·`complete_ai_job`의 차감·sweep 예약 해제(2026-10-26), 거절 대체 끄기(2026-10-27, v4에서 대체 자체가 없어짐), 서비스 `ANTHROPIC_API_KEY`.
- 2026-10-28 (S3a, QA-S3a-02, 사용자 결정) 작업 단계 안에서 공급자 오류가 아닌 예외(코드 버그, DB 오류 등)는 재시도 없이 `stalled`로 끝낸다. 공급자 호출 중에 생긴 분류되지 않은 오류만 `provider_unavailable`(재시도 최대 2회)로 본다.
- 2026-10-28 (S3a, 사용자 결정) 사용자가 누른 수동 재시도는 새 실행으로 보고, 120초 대기 예산과 원인별 재시도 횟수를 새로 시작한다. `retry_count`·`retry_wait_total_ms`는 작업 전체 누계로 남긴다.
- 2026-10-29 (S3b, QA-S3b-01) 실행 중에 동의가 철회되거나 재동의가 필요해져 막힌 작업은 `error_code = key_missing`으로 끝낸다(`user_account` 범주, `failure_cause` null). 화면은 "AI 연결하기" 잠금 안내를 보이고, 재동의는 연결 화면에서 받는다. C-11.1에 맞는 코드가 없어 정한 것이다([가정], spec-gaps QA-S3b-01 항목).
- 2026-10-31 (S5) `apply_jd_extraction`의 `p_result` 모양은 db-engineer 노트를 기준으로 한다. 회사명·포지션명은 `{value, source_sids}` 객체(또는 null), 요건 `sort_order`는 0부터 시작한다. AI의 요건 길이 상한 300자는 DB 상한(1~500)보다 엄격하므로 그대로 둔다.

## 2026-11-02 백엔드 연결 (리더 결정)
- 페이지 주소는 UI가 소유하므로 `ROUTES`를 UI 주소에 맞춘다(`/sign-in`, `/consent`, `/settings/withdraw`). `accountDeletionFinalize = /settings/withdraw/finalize` 추가(api-engineer 제안 수용).
- QA-W0-02: 동의 검사는 `(dashboard)` 안 라우트 그룹 레이아웃에 두고, S-25(`/settings/withdraw`)는 그 그룹 밖에 둔다. URL은 바뀌지 않는다. A7(동의 게이트 밖)을 지키면서 셸은 유지한다.
- UI 소유 파일 예외: W1은 게이트 배치, S-25 이동, `/sign-in?error=` 표시, 미리보기 분기처럼 연결에 꼭 필요한 최소 수정만 허용한다. 그 밖의 화면 수정은 "UI 요청"으로 넘긴다. 사용자에게 보고한다.
- spec-gaps ⑲: 가입 필수 동의에서 `cross_border_transfer`를 뺀다. PRD F-COM-02, UX S-03, 사용자 확정 D-39(공급자별 고지·동의, 키 연결 때)가 이미 정한 내용이고 DB·DM A.2만 옛 상태였다. D-39의 법무 확인은 그대로 열려 있다.
- W5 재검증 항목: W1은 QA를 받지 않고 W2~W4와 병렬로 진행했다. W5에서 W1 전체(인증, 게이트, 미리보기 분리, `components/account/actions.ts`의 `provider_url` 수정)를 함께 본다.
- W5 확인 추가: AI 게이트 경로 ①·④·⑤(서비스 계층, 코드만 읽음), `registerProviderKey`가 공급자 호출 전에 동의를 확인하는지, `mapRunGate` 실제 실행. 기존 `cross_border_transfer` 행은 철회 불가로 남음(선택 동의 철회 규칙 밖). DM 머리말 버전을 v4.3b로 맞출 것.
- W5: UI 요청은 `frontend-engineer`가 일괄 처리한다(W1에서 준 예외를 넓히지 않음). 그 뒤 api-engineer가 중간 상태(`isMockRow`, `listActiveAiJobs` 병합, `startAiJob`)를 걷어내고, backend-qa·ui-qa가 통합 검증한다.

## 2026-11-07 R4 커리어 재설계 (db-engineer)
- `[가정]` 기존 데이터는 이관하지 않고 비운다(DM v4.4 11.2 권고, 운영 데이터 없음). 마이그레이션 `20261109100100_r4_clear_career_chat_data`가 `writing_chats`(+메시지), `projects`(+`project_details`·`achievements`·`project_skills` 연쇄, 고아 태그 스킬 정리), 경력 단위 `achievements`, 이것에 걸린 `evidence_links`(source_type `project`·`project_detail`·`achievement`)와 `draft_section_sources`(project_id 있는 행)를 지운다. 경력·교육·프로필·수동 스킬·지원 프로젝트와 그 결과(인사이트·서류·면접)는 남는다(근거 일부만 빠짐). 원격(스테이징 등)에 같은 마이그레이션을 적용하면 같은 데이터가 지워진다 — 적용 전에 확인할 것.
- `apply_structured_draft_patch` v3 payload 형식은 DB 노트(`R4/02_db_notes.md`)를 기준으로 한다(기존 `{ops:[…]}` 방식 유지, STAR `append` op 추가, 섹션 `project`/`star`/`classification`).

## 2026-11-04 원격 연동 (Supabase · Vercel)
- Supabase 원격 프로젝트: `resumate` (ref `rxtnguarpotkcgdazkbw`, ap-northeast-2 서울, 조직 Jehyun, Free 플랜, 월 $0). 운영 겸용 단일 프로젝트로 시작한다(사용자 결정).
- 원격 프로젝트에 레거시 anon 키(HS256)가 켜져 있어 레거시 JWT secret이 있다 → `app_ai_writer`·`app_key_reader` HS256 서명 방식을 그대로 쓴다. 레거시 키를 끄면 이 토큰이 거부되므로, 끄기 전에 `signRoleToken`을 비대칭 키(가져온 ES256 키) 서명으로 바꿀 것.
- 로그인: 매직 링크만 켠다. Google OAuth는 자격 증명이 준비되면 추가(사용자 결정). → **대체 (2026-11-04, R6·D-09 변경)**: Google 로그인만. 원격에서 Google 공급자 켜기(실제 자격 증명) + Email 공급자 끄기가 필요하다.
- 마이그레이션은 Supabase CLI `db push`로 적용한다(SQL 약 1MB라 MCP 개별 적용은 하지 않음). DB 비밀번호는 사용자가 `supabase link`에서 직접 입력한다.
- Vercel: 팀 jhyunn에 `resumate` 프로젝트를 만들고 GitHub `j-hyunn/resumate`와 연결, main = 운영 배포(사용자 결정).
- 2026-11-04 결과: 마이그레이션 108개 원격 적용(`supabase db push`). advisors 보안 WARN 21건은 설계된 authenticated용 SECURITY DEFINER RPC, `account_deletion_logs` 정책 없음은 service role 전용이라 의도대로. 성능은 INFO만.
- Vercel 프로젝트 `resumate`(prj_gLbcM3p9mET5bbx4Jj3pEMFbC2cZ, 팀 jhyunn), 운영 URL `https://resumate-zeta-sepia.vercel.app`, 함수 리전 icn1(`vercel.json` regions). 환경 변수는 production·preview 둘 다, 비밀 값은 Sensitive. Vercel MCP는 프로젝트 생성 권한이 없어(403) CLI(`vercel@65.11.0`)를 썼다.
- KEK(`AI_KEY_KEK_BASE64`, id env-v1)는 원격용으로 새로 생성했고 백업은 사용자 로컬 `~/.resumate/prod-kek.txt` → 비밀번호 관리자로 옮길 것. preview 배포도 같은 DB·같은 KEK를 쓴다.
- 원격 Auth: site_url = 운영 URL, 리디렉션 허용 = 운영·preview(`resumate-*-jehyuns-projects-85b35a5d.vercel.app`)·localhost의 `/auth/callback`. 메일 재전송 간격 60초(로컬 1초와 다름). 원격 반영은 로컬 `config.toml`을 고치지 않고 복사본으로 `supabase config push`(auth만) 했다.
- ~~출시 전 필수~~ (R6 이후 불필요 — 로그인 메일을 보내지 않음): 무료 플랜 기본 메일 발송기는 템플릿 변경 불가 + 조직 멤버 주소로만 발송 + 시간당 발송 한도가 낮다. 커스텀 SMTP(예: Resend)를 연결한 뒤 한국어 템플릿(`supabase/templates/`)을 올린다. 그전까지 원격 메일은 Supabase 기본(영문) 템플릿이며, 콜백은 `code`·`token_hash` 둘 다 처리하므로 로그인은 된다.

## 2026-11-04 장기 미접속 계정 파기 (처리방침 2026-11-04 §3)
- 안내 메일: Gmail SMTP(운영자 Gmail + 앱 비밀번호, nodemailer) — 사용자 결정. Supabase Auth SMTP는 인증 템플릿 메일만 보낼 수 있어 제외. 처리방침 처리 위탁에 Google LLC(Gmail)와 국외 처리 내용을 추가했다.
- 기준: 마지막 접속 = `coalesce(last_active_at, created_at)`. 1년 − 30일이 지나면 안내, 안내 30일 뒤 + 마지막 접속 1년이 지나면 파기. 메일 서버가 받은 뒤에만 `inactivity_notice_sent_at`을 기록해, 안내 없이 파기되는 일은 없게 했다(실패 시 다음 날 재발송).
- `last_active_at`은 proxy가 `touch_last_active`로 갱신한다(브라우저·사용자별 6시간 쿠키 `rm_last_active`로 제한, RPC도 1시간 안의 재기록은 건너뜀). 갱신하면 대기 중인 안내가 취소된다. `profiles.updated_at`도 함께 바뀐다.
- 파기 범위는 `delete_account`와 같다: 본문을 `private.delete_account_data(uid, hash, reason)`로 옮기고 `delete_account`·`purge_inactive_account`가 함께 쓴다.
- Auth 사용자 삭제 실패분은 크론의 auth cleanup 단계가 `get_account_deletion_state = deletion_incomplete`일 때만 지운다(사용자 탈퇴 미완료분 포함).
- 한도: 실행당 안내 30·파기 30·Auth 정리 20, 연속 3회 발송 실패 시 중단. Gmail 개인 계정 일 500통 한도 아래.
- 원격 반영 시 필요: 마이그레이션 `20261112000100_inactive_account_deletion`(파괴적 아님, `last_active_at` 백필), Vercel 환경 변수 `GMAIL_SMTP_USER`·`GMAIL_SMTP_APP_PASSWORD`(production·preview, Sensitive). 미설정 시 안내가 나가지 않으므로 파기도 일어나지 않는다(크론은 실패로 표시).
- (PT-7, 2026-11-04 사용자 결정) Gmail 보낸편지함의 안내 메일 사본은 파기·탈퇴한 계정 것만 운영자가 매월 한 번 직접 삭제한다. 유지된 계정의 메일은 계정이 있는 동안 보관한다. 자동 삭제 없음.
- 2026-11-04 원격 반영: `supabase db push`로 `20261111000100_policy_versions_2026_11_04`·`20261112000100_inactive_account_deletion` 적용. 확인: profiles 1행 백필 완료(`last_active_at` null 0), 크론 RPC 5개 service_role 전용, `touch_last_active` authenticated. 보안 advisor 새 항목은 `touch_last_active` SECURITY DEFINER(의도, 본인 행만 갱신) 1건. Vercel `GMAIL_SMTP_USER`·`GMAIL_SMTP_APP_PASSWORD`는 Production에만 등록(크론은 운영에서만 실행).
- 2026-11-04 원격 반영(사용자): `20261113000300_r8_star_merged_proposal`(비파괴, `private.wc_patch_star` 교체). 원격 `list_migrations` 마지막 항목으로 확인(backend-qa). 코드(R8 + UI 개정 ui-panel-doc)는 같은 머지로 나간다.
- 2026-11-04 원격 반영(사용자 요청, 상위 세션에서 실행): `20261113000400_r10_classification_dismiss_guard`(비파괴, `private.wc_patch_star` 교체). 원격 `list_migrations` 마지막 항목으로 확인. 보안 advisor는 기존 항목뿐(authenticated SECURITY DEFINER RPC 22건, `account_deletion_logs` 정책 없음 INFO, 유출 비밀번호 보호, MFA 옵션) — R10으로 새로 생긴 것 없음. 코드는 R8·R9·UI 개정과 같은 머지로 나간다.
- 2026-11-05 원격 반영(사용자 요청 "원격 반영 먼저해"): `supabase db push --linked`로 R11 `20261113000500`~`001200` 8개 + R12 `20261113001300` 적용(모두 비파괴). 확인: 원격 마지막 `20261113001300`, `ai_disclosures` v2026-11-05 6행, `policy_versions` 2026-11-05 3행, `backfill_interview_scores` 실행 결과 sessions 0·answers 0(원격 면접 세션 0건). 보안 advisor는 기존 항목뿐(authenticated SECURITY DEFINER RPC 22건, `account_deletion_logs` 정책 없음 INFO, 유출 비밀번호 보호, MFA) — 새 항목 없음. 성능은 INFO만. R11 코드는 이미 main(#48·#49), R12 코드는 PR #50. 상세 `_workspace/backend/release-2026-11-05/05_release.md`
- 2026-11-08 원격 반영(사용자 요청 "drop 진행"): R13 2단 **파괴적** `20261113002800_r13_drop_profile_legacy_columns` — `profiles`의 `total_years_of_experience`·`desired_job_title`·`interested_industries` drop. 이 워크트리가 `supabase link` 안 된 상태라 (`db push`는 사용자가 직접 넣는 DB 비밀번호 필요) **Supabase MCP `execute_sql` 한 트랜잭션**으로 DDL + `schema_migrations` 버전 행 insert를 함께 적용했다. 사전 확인: 읽는 코드 0건(남은 참조는 주석·`evidence_links.source_field` 문자열 값), 원격 함수·뷰·제약 의존 0건, 삭제 전 값은 1행뿐이고 셋 다 빈 값 (null·null·`[]`) → 실질 손실 없음. 로컬 pgTAP 65파일 3055건 통과. 적용 후: 컬럼 0개, 원격 마지막 `20261113002800`, advisors 새 항목 없음. 코드 변경·새 배포 없음(파일은 이미 main). 상세 `_workspace/backend/R13/05_release.md` "2단 결과"
- 2026-11-08 원격 반영(사용자 요청 "법무 2건 진행" → "머지해" → "다시 시도해줘"): `20261113002900_policy_versions_2026_11_08` (비파괴, `policy_versions`에 `privacy`·`ai_data_use` 2026-11-08 2행). **순서대로** PR #62 머지(`9ffd881`) → Vercel 운영 배포 성공 확인 → 행 반영. 첫 시도가 권한 분류기(Production Deploy)에 막혀, 배포 뒤 승인까지 **새 본문 + 옛 시행일**이 함께 보이는 구간이 있었다(기능 영향 없음). 워크트리가 link 안 돼 있어 `db push` 대신 MCP `execute_sql` 한 트랜잭션으로 2행 + `schema_migrations` 버전 행을 넣었다. 확인: `privacy`·`ai_data_use` 현재 버전 2026-11-08, `terms`·`cross_border_transfer`는 2026-11-05 그대로, 원격 마지막 `20261113002900`. advisors는 DDL 없는 insert라 실행하지 않았다. 브라우저 미확인. 상세 `_workspace/backend/release-2026-11-08/05_release.md`

## 2026-11-09 R15 리더 판정 — 옛 서류 코드 폐기와 UI 화면의 순서 충돌

**상황**: 11.8 배포 4단계(가드 + 테이블 3개 drop + 결과 RPC 폐기)를 **로컬에 적용하면** 생성 타입에서 `drafts`·`draft_sections`·`draft_section_sources`가 사라진다. 그런데 옛 서류 화면 S-17·S-19(`src/app/(dashboard)/(gated)/applications/[id]/drafts/**`)와 그 컴포넌트 4개가 `src/lib/data/drafts.ts` → `drafts-real.ts` → `src/server/services/drafts/*` + 폐기 라우트 3개(`career-descriptions`·`draft-source-ranking`·`draft-sections/[id]/generate`)를 쓰고 있다. 즉 **파괴 단계를 로컬 적용하면 typecheck가 깨진다.**

**판정 (리더, 2026-11-09)**: UX v5.20이 S-17·S-19·S-31·S-45를 폐기하지만 **화면 삭제는 UI 세션 몫**이므로 이 슬라이스에서 화면을 지우지 않는다. 대신:

1. 백엔드 소유분은 R15에서 **폐기한다** — `src/server/services/drafts/*`, 라우트 3개, `src/lib/data/drafts-real.ts`, 거부 코드 `career_description_in_progress`.
2. `src/lib/data/drafts.ts`를 **mock 전용 + `// 연결 대기`** 로 되돌린다(실제 경로 분기 제거, export 이름·시그니처 유지). backend-context "Minimal UI edits"가 허용하는 **preview/mock 스위치** 범위다 — 옛 화면은 `?state=` 미리 보기로만 컴파일·동작하고 실제 데이터는 붙지 않는다.
3. 옛 서류 화면·컴포넌트 삭제와 옛 주소 → S-46 리다이렉트는 **"UI 요청"**으로 넘긴다(4.23 UI 표 #4).
4. 그래서 **파괴 마이그레이션을 로컬에 적용할 수 있고** 타입·pgTAP·typecheck가 통과한다. 원격 반영은 사용자 승인 뒤, **코드 배포 뒤**(11.8 (2) 순서).

**근거**: 11.8 (2)의 "코드 배포 줄"이 요구하는 것은 "옛 `drafts` 계열을 읽고 쓰는 **코드**를 모두 지운다"이고, CF-M1로 관찰 기간 읽기 경로가 폐기됐으므로 옛 화면을 살려 둘 데이터 이유가 없다. 화면은 UI 세션이 지운다.

## 2026-11-09 R15 리더 판정 2건 (구현 세부)

**R15-L1 — AI-04 프롬프트 번호는 `v6`**(기획 4.23은 `v7`로 적었다). 4.23은 "main 병합: RM이 같은 날 v6을 먼저 썼다 — 구현 번호는 백엔드가 확인, MRG-AI-1 `[가정]`"으로 확인을 위임했다. 현행 코드 확인 결과 **R14가 쓴 것은 `ai-04.generate.v5`·`ai-04.adjust.v5`**이고 v6은 코드에 없었다 → 다음 번호 **v6**으로 올렸다. 출력 `schema_version`은 명세대로 **4**(현행 2 → 4, 3을 거치지 않음 — v4.13 채팅형 전환이 구현돼 있지 않아 3판 행이 없다). `common.v4`는 올리지 않았다(RM 판 그대로).

**R15-L2 — 서류 턴 SSE는 새 이벤트 이름을 만들지 않고 기존 payload에 칸을 더한다.** 한 턴에 문항이 최대 3개(CL-10)라 기존 `sources_selected`·`draft_started`·`draft_block`·`adjusting_length`·`draft_done`에 **`slot`·`questionNo`** 칸을 더한다(AI 명세 AI-04 "초안 턴 이벤트 순서"가 문항마다 반복한다고 적은 것의 구현 표현). UI의 `useAiStream` 반환 모양은 바뀌지 않는다. `[가정]`

## 2026-11-09 R15 구현 전제 차이 (보고용, 결정 아님)

**AI-04의 v4.13 채팅형 전환이 애초에 구현돼 있지 않았다.** 현행 코드는 문항 1개짜리 카드형 파이프라인(`selection_mode`, `complete_cover_letter_section` payload)이었다. 11.8이 미배포인 것과 같은 이유다(기획이 CL-* 사이클에서 설계만 하고 구현 슬라이스가 없었다). 그래서 R15의 AI 작업은 "`answer_title` 추가"가 아니라 **CL-* + CF-* 동시 구현**(서류 턴 파이프라인 신설)이 됐다. 슬라이스 범위가 계획서 1-D보다 넓어졌으나 결정 변경은 없다.

## 2026-11-09 CF-S1 (사용자 결정) — 자소서 슬롯 근거의 저장 원천

**배경**: R15 구현 중 발견한 기획 불일치(R15-AI-2). DM 2.8·AI-04는 슬롯 단위 근거 `{slot}.sources.{n}`이 생긴다고 단정하는데, v4.15가 `set_source_ranking`·`document.source_ranking`을 폐기해 AI-04가 낸 `sources[]`를 저장할 자리가 없었고 `body.questions[]`·`save_application_document` 인자에도 그 칸이 없었다. 기획 검토 세션(`local_6c265c4a-0a2e-4e53-8e52-a6fc0459717d`)에 선택지 3개와 구현 영향을 올려 사용자 결정을 받았다.

**확정 (2026-11-09, 사용자) — 안 (2) 변형 "AI 초안에 실어 저장"**:
- **새 패치 연산을 만들지 않는다.** 기존 `replace_draft`에 **`sources[]`** 인자를 붙인다 — 원소 `{source_type, source_id, role}`, `role` ∈ `primary`/`supporting`, **0~5개** `[가정]`. 저장 위치 `structured_draft.document.questions[].draft.sources[]`.
- **별칭 → `source_id` 변환은 서버(ai-pipeline)가 블록 `evidence[]`와 같은 경로로** 한다. `user_note`의 `source_id` = 그 문항의 `question_id`. 허용 출처는 2.8 목록 그대로.
- **`save_application_document` 근거 쓰기**: 그 슬롯 제안이 `p_applied_proposals`에서 **applied**면 **그 제안(같은 `rev`)의 `draft.sources[]`**로 `{slot}.sources.{n}`을 교체(`n` = 배열 순서, `primary` 먼저, **`role`은 행에 저장하지 않는다**). **적용 제안이 없는 슬롯은 기존 `sources` 행을 유지**하고 블록 근거만 본문대로 재작성 `[가정]`. 보내지 않은 슬롯은 양쪽 삭제.
- **화면은 `sources`를 보내지 않는다** — `p_body.questions[]`에 `sources` 키가 없고 **RPC 인자·`p_body` 모양은 변경 없다**.
- 설계 의도: 근거 출처가 AI 턴 결과뿐이라 화면 값을 `origin='ai'` 근거로 저장하는 **위조 경로가 생기지 않는다**(CF-A17과 같은 성질).
- **귀결**: 2.5.1의 "슬롯마다 근거를 전부 지우고 다시 넣는다"는 **블록 근거에만** 적용된다. `sources` 행은 적용 제안이 있을 때만 교체된다.

**문서 상태 주의**: CF-S1의 문서 반영(DM 2.5.0b·2.5.1·2.8, AI-04 "저장 매핑", UX S-46, decisions 3.28 후속 확정 3 + 4.23 백엔드 #14)은 **PR #68로 미머지**다. **이 워크트리의 `docs/planning/`에는 CF-S1이 없다** — R15는 이 결정 기록을 기준으로 구현했다. PR #68이 머지되면 문서와 대조할 것.

**CF-S1 번호 판단 (리더 승인 2026-11-09)**: AI-04 출력 `schema_version` **4 유지**, 프롬프트 **`ai-04.generate.v6` 유지**. `sources[]`(`role`·`rationale`·`reuse_reason`·`evidence`)는 이미 모델 출력 스키마에 있던 값이고 모델이 하는 일·선택 규칙·프롬프트 문장이 바뀌지 않았다 — 서버가 그 값을 저장하기 시작한 것뿐이다. 올리면 `input_hash` 재사용만 잃는다. `structured_draft.schema_version`도 **1 유지**(11.8 미배포로 1판 행이 없다).

**CF-S1 구현 계약 (db-engineer와 대조 대상)**: `sources` **키 없음 ≠ 빈 배열** — 키가 있으면(빈 배열 포함) 교체, 없으면 기존 행 유지. 화면이 보내지 않아 제안이 유일한 원천이므로 **초안 턴은 블록이 남은 문항마다 항상 키를 싣는다**(프로젝트 0개가 정상인 `motivation`·`future_plan`은 `[]`). 별칭 → `source_id` 변환은 블록 `evidence[]`와 **같은 함수**(`toStoredSourceRef`)를 쓴다.

## 2026-11-09 R15-DB-8 기획 문장 정정 (결정 아님)

DM §2.6.1 조건 5(`jd_has_results`)가 11.8 4단계에서 drop되는 `draft_sections.ai_content`를 읽고 있었다(R14가 면접 질문 행 조건을 지울 때 남은 줄). 기획 검토 세션에 올려 **문장 정정으로 처리**됐다 — 사용자 결정 사항이 아니었다.
- 정정 내용: 조건 5에서 `draft_sections.ai_content` 절 삭제, 설명 문단에 "서류 정본은 JD 문장을 담지 않아 조건 5가 서류를 보지 않는다 — 자기소개서만 있고 JD 근거(`jd_requirement`·`jd_sentence`)가 없으면 원문 수정 허용, JD 출처 블록 근거가 있으면 세 번째 절이 막는다" 추가.
- 구현(R15-DB-8)과 같은 모양이므로 **`[가정]` 표식을 해제**했다.
- R15-DB-9(거부 코드 `23514` → `P0001 invalid_evidence_source`)는 **문서 변경 불필요**로 합의 — 구현 세부 `[가정]`으로 유지.
- 문서 반영은 **PR #68(미머지)** 에 있다 — CF-S1과 같은 PR이다. 이 워크트리 `docs/planning/`에는 둘 다 없으므로, PR #68 머지 뒤 §2.6.1·2.5.0b·2.5.1·2.8·AI-04를 구현과 대조할 것(`04_summary.md` 후속 항목).

## 2026-11-09 R15 리더 판정 — 블록 `review` 강제는 DB 범위가 아니다 (구현 수정, 기획 충돌 아님)

**발견 경로**: ai-pipeline ↔ db-engineer 계약 대조(CF-S1 뒤 7항목). DB의 서류 블록 재조립 함수가 **`blocks[].evidence[]`가 비면 비제목 블록을 `review='needs_review'`·`review_reason='no_evidence'`로 강제**했다. 담당자는 기획 충돌로 올렸으나 문서를 확인한 결과 **구현이 명세 범위를 넘은 것**이었다.

**판정 근거**:
1. **판정 기준이 틀렸다** — DM §2.5.0b "`blocks[]` 출처 3종" = `evidence` / `source_fact_ids` / `source_body_quotes`. 다음 행의 "근거 0개면 `needs_review`"는 **3종 전부 0개**를 뜻한다. AI 명세 AI-04도 "블록의 출처 3종 … 모든 문단에 하나 이상 필요(없으면 V-4)". `evidence[]`만 보면 **이어 쓰기 블록**(출처가 대화 사실·지금 본문 인용뿐인 문단, CL-4의 주 경로)이 전부 `needs_review`가 되어 매번 사용자 [수락]을 요구한다 — 눈에 보이는 오동작.
2. **그 판정은 DB 몫이 아니다** — DM §2.5.0b "DB의 V-10 방어 범위 (서류)": 2.5.0a 범위 + `blocks[].evidence[]` 원소의 **모양·길이·개수만** 본다. §2.5.0a R5-DB-6: "제목 외 블록은 출처 1개 이상(V-10a) … 은 **파이프라인 몫이다**".

**지시**: DB의 `review`/`review_reason` 강제 분기 제거, 패치로 온 값을 그대로 저장. 유지할 것 — `evidence[]` 모양·길이·개수 검사, `source_type` 2.8 목록 검사, `quote` ≤ 2,000자, 블록당 ≤ 20개, 그리고 **V-8 마지막 안전망**(`job_competency` 문항의 `project.learnings` 거부 — 문서가 "저장 RPC에도 남긴다"고 적은 유일한 예외). pgTAP는 반대로 3건 추가(출처가 `source_fact_ids`뿐·`source_body_quotes`뿐인 블록은 `ok`로 저장, 파이프라인이 보낸 `needs_review`는 그대로 저장).

**기록 위치**: `spec-gaps.md`에 적지 않는다 — 기획 문제가 아니다.

## 2026-11-09 R15 계약 대조 결과 (CF-S1 뒤)

ai-pipeline이 db 노트와 7항목을 대조해 **불일치 2건을 잡았다**. 대조를 넣은 값이 확인된 지점이다.
- **`replace_draft` payload 모양 (중대)**: AI 쪽이 `{op, body:{slot,…}}`로 보내는데 DB는 `{op, slot, question_id?, draft:{…}}`를 기대했다. 그대로 두면 **모든 서류 초안 턴이 `invalid_patch 'op N slot'`으로 실패**했을 것이다. AI 쪽을 DB 모양으로 고쳤다 — `value`는 보내지 않는다(DB가 `blocks`로 재조립), `question_id`는 DB가 새 슬롯 원소를 만들 때 쓰므로 함께 보낸다.
- **`char_limit_at_generation` null**: DB는 null 값을 `invalid_value`로 보고 **초안을 조용히 저장하지 않는다**(키 없음은 통과). AI 쪽이 null이면 키를 빼고 보내게 고쳤다.
- 일치 확인: `sources` 키 없음 ≠ 빈 배열 / `role` 2값 / 0~5개·`invalid_patch` detail / 허용 출처 8값 동일 집합 / R15-DB-3(슬롯 근거의 `source_field`·`source_locator` 부재) / 그 밖 `invalid_patch`·`invalid_value` 조건 전부 통과.

## 2026-11-09 R15 리더 판정 — `draft_count`는 **초안 턴당 1** (R15-API-7)

**발견**: api-engineer가 편입한 서류 대화 통합 테스트에서, `apply_structured_draft_patch`가 `draft_count`를 **`replace_draft` 연산마다** 올려 문항 2개를 쓴 초안 턴 한 번에 `draft_count`가 2가 됐다. 귀결 — 5문항 자소서는 한 바퀴가 턴 2회(3+2) = 연산 5개여서 **한 바퀴만 돌아도 6회 중 5회를 소모**하고 두 번째 바퀴가 `writing_chat_draft_limit_reached`로 막힌다.

**판정: 구현이 틀렸다. 턴당 1이 맞다.** 기획 세션에 올리지 않았다 — 문서가 답을 갖고 있다.
- **결정적 근거** — AI 명세 C-14 "서류 작성 대화" 행: "대화당 초안 제안 ≤ 6회 … **제안 단위가 (v4.15, CF-1·CF-5) '최대 3문항'이라 자소서 5문항이면 초안 턴 2회면 한 바퀴가 돈다**". **"제안 단위" = "최대 3문항"** = 한 제안은 한 초안 턴이고, 6회는 초안 턴 6회(= 세 바퀴)다.
- 보강 1 — AI 7.4의 비용 논거("초안 턴이 질문 턴의 약 10배 비용"): 비용 단위는 compose **호출**이고 한 턴이 문항 3개를 써도 호출은 1회다.
- 보강 2 — DM 2.5.0b가 부정한 것은 "**문항별** 6회"이지 "한 턴이 슬롯 수만큼 소모"가 아니다.
- 보강 3 — 화면이 "초안 남은 횟수 **6 − `draft_count`**"를 계산해 보인다. 연산당 세면 한 바퀴 뒤 "1회 남음"이 되어 "6회째 뒤에 칩을 숨기고 새 대화 권유"라는 흐름과 어긋난다.
- **왜 지금까지 드러나지 않았나**: 산출물 대화(2.5.0a)는 슬롯이 하나라 "연산당 = 턴당"이었다. 서류는 슬롯이 여럿이어서 처음 갈라졌다.

**지시**: `apply_structured_draft_patch` 서류 분기에서 `replace_draft`를 담은 **패치 호출당 +1**(연산 3개여도 +1). 산출물·STAR 분기는 변경 금지(회귀 방지). "내용 블록이 안 남은 초안도 횟수는 센다"는 유지. 통합 테스트 기대값 `[2,2]` → `[1,1]` + 초안 턴 6회 뒤 7번째 거부 단정 추가.

## 2026-11-09 R15 QA-02 정정 승인 — 와이어는 이미 정상이었다

backend-qa가 "화면이 실패 이벤트를 버려 C-20 안내가 뜨지 않는다"고 적었으나, api-engineer 확인 결과 **`src/server/sse.ts`의 `normalizeErrorEvent`가 내보내는 모든 `error` 이벤트를 다시 조립**해 **와이어 모양은 이미 완전했고 C-20도 떴다**. 실제 결함은 ① 턴이 만든 객체가 계약을 어겨 in-process 소비자(테스트)가 버린다 ② `as` 캐스팅이 타입 검사를 우회한다 두 가지다. **심각도 Major는 유지**한다 — 아래 이유로 ②가 실제 버그를 가리고 있었다.

**캐스팅 제거가 찾아낸 결함**: AI-04의 `sources_selected`가 저장 행 모양 **snake_case**(`sort_order`·`experience_id`…)인데 SSE 계약은 **camelCase**였다. 그대로 배포되면 **S-46의 근거 칩이 하나도 파싱되지 않는다.** `toDocumentSseEvent()` 한 자리에서 이름을 바꾸고 snake_case 키가 남지 않는지 테스트로 묶었다. `as` 캐스팅 7곳을 모두 지우라는 지시가 이것을 드러냈다 — 캐스팅을 남긴 채 계약만 채웠다면 못 찾았다.

## 2026-11-09 CF-S2·CF-S3 접수 (자소서 UI 세션 경유) — 백엔드 변경 없음

UI 세션(`local_7e541d52-…`, worktree `cover-letter-ui-469976`)이 전달한 2026-11-09 사용자 확정 2건. 둘 다 서버·DB 변경이 필요하지 않다.
- **CF-S2**: 문항 근거의 원천은 그 문항 초안 제안의 `sources[]`이고 **화면은 근거를 저장 요청에 싣지 않는다**(저장 입력은 `applied_proposals: [{writing_chat_id, slot, rev}]`만). 근거 행은 저장 RPC가 넣는다. 정본 C-11은 경로 한 줄만 보이므로 `role`·`origin`·`rationale`은 정본에 두지 않는다. → **R15의 CF-S1 구현과 일치**(확인 완료).
- **CF-S3**: 문항 설정 상태에서 정본 행을 만드는 첫 저장은 **[자기소개서 작성 시작] 하나**이고 상단 "저장하기"는 비활성(⌘S도 꺼짐). → **화면 쪽 게이트이고 RPC는 변경 없다**고 판단해 서버를 그대로 뒀다.

**문서 정정 결과 (2026-11-09)**: DM 2.5.1 "정본 행이 생기는 때"에 남아 있던 "문항 설정 상태의 '저장하기'만 누른 경우는 행이 생기므로 다음 방문은 작성 상태다" 문장이 CF-S3와 어긋난다는 것을 내가 지적했고, UI 세션이 기획 세션에 올려 **PR #68에 정정이 추가**됐다 — 그 문장은 취소선 처리되고 CF-S3 문장(화면 게이트·RPC 변경 없음·첫 저장 = [자기소개서 작성 시작])으로 교체, UX S-46 상단 바에도 "문항 설정 상태에서는 비활성·⌘S도 꺼짐" 표기. **즉 R15의 판단(RPC 그대로)이 정본이 됐다.**

**UI 세션과의 계약 합의**: 정본 키는 `get_deletion_impact` → `documents`·`document_chats`, 커리어 결과 영향 → `documents`·`document_sections`, 단 **`get_account_deletion_summary`는 반환 키 `drafts` 유지**(DM §4.3). `src/lib/data/drafts.ts`와 픽스처는 drop 커밋과 같은 머지에서 UI 세션이 걷되 **`retryJdExtraction`·`runJdExtraction`은 보존**(JD 요건 추출, S-15·D-30). UI 세션은 서버 통합 테스트를 돌리지 않으므로 공유 로컬 Supabase의 `db reset`은 이쪽이 자유롭게 쓴다. **R15 커밋 뒤 UI 세션에 알릴 것.**

## 2026-11-09 R15 후속 — 읽기 공백 4건 + 쓰기 우회 1건 (UI 세션 연결 중 발견)

**발견 경로**: 자소서 UI 세션(`local_7e541d52-…`)이 R15를 실제 경로에 연결하다가 **화면이 부를 서버 함수가 없는 자리** 4건을 보고했다. 리더가 코드로 4건 모두 확인했다.

**판정: 기획 공백이 아니라 R15 계획의 누락이다.** DM 7장 25행 "서류 작성 화면 조회"(정본 1행 + 그 서류의 대화 목록 + 연 대화의 메시지·`structured_draft` + `application_document` 근거 + JD 머리)와 33행 "보드 조회"(`filled_slot_count`·`slot_count`)가 이미 정해 둔 읽기다. 계획서 1-E가 "연결(wiring)은 하지 않는다"를 **"UI가 부를 서버 읽기도 만들지 않는다"로 잘못 넓혔다** — 연결은 `src/lib/data/`를 실제 경로로 바꾸는 일이고, 서버 서비스·액션은 R15 범위였다.

| # | 공백 | 영향 | 처리 |
|---|------|------|------|
| 1 | 사용자 세션으로 **정본 1행을 읽는 서비스·액션이 없다** | S-46이 늘 문항 설정 상태로 열려, 이미 쓴 자소서 위에 빈 기본 문항으로 [작성 시작]을 누르면 **정본을 덮어쓴다**(기대 버전 null = 덮어씀, 2.5.1). **코드 배포 순간 생기는 데이터 손실 경로** | `getApplicationDocument` → 행 또는 `null` |
| 2 | `loadDocumentCounts`가 0/1만 준다 | S-39 카드 "작성 중/작성됨"을 가를 수 없다 | `listDocumentSlotCounts` → `{slot_count, filled_slot_count}`, `body` 미독 |
| 3 | `first_copied_at`을 쓰는 경로가 없다 | 첫 복사 지표(PRD 7장) 미기록. 옛 `drafts_keep_first_copied_at`은 파괴 단계가 drop한다 | RPC `mark_application_document_copied` — 한 번만 기록, **`updated_at` 불변**(기대 버전 보호), 행 없으면 `null` |
| 4 | 서류 대화 DTO·목록·상세가 없다(`AnyWritingChatDto`에 서류 분기 없음) | 새로 고침하면 대화와 미반영 제안이 화면에서 사라지고, 초안 6회를 쓴 대화를 다시 열 수 없다(서버 데이터는 남는다) | `DocumentWritingChatDto` + 목록·상세, 산출물 대화 읽기 관례 그대로 |

**릴리스 판단**: **1이 해소되기 전에는 두 PR(#69 + UI)을 머지하지 않는다.** 4는 체감이 커서 함께, 2·3도 작아서 함께 넣는다.

### 쓰기 우회 (리더 발견, 위 작업 중)

**문제**: `20261113003100`이 `authenticated`에 `application_documents`의 **insert·update grant + RLS `insert_own`·`update_own`**을 둔다(저장 RPC가 `security invoker`라 필요했다 — R15-DB-1/2). 그 결과 로그인한 사용자가 **저장 RPC를 거치지 않고 REST로 자기 행을 직접 쓸 수 있다** — 문항 ≤ 5·`char_limit` 필수·슬롯 형식·`answer_title` ≤ 100·**`filled_slot_count`와 `body`의 정합성**을 모두 건너뛴다. 다른 사용자 행은 RLS가 막으므로 **교차 사용자 침해는 아니고 자기 행 무결성 문제**다. DM 2.7.3은 "insert·update = `save_application_document`"만 쓰기 경로로 둔다.

**판정 (리더)**: 저장 RPC는 **문서(2.5.1 공통 규칙)대로 `security invoker`를 유지**하고, **트랜잭션 로컬 설정 플래그 없이는 쓰기를 거부하는 `BEFORE INSERT OR UPDATE` 트리거**를 단다. 저장·복사 RPC만 플래그를 세운다. **delete는 막지 않는다**(DM 2.7.3 "delete 본인", 지원 프로젝트 cascade). 문서의 두 문장("invoker"·"쓰기는 RPC로만")을 둘 다 만족하는 **구현 세부**이므로 기획 세션에 올리지 않았다.

**마이그레이션**: 1단계 17개가 **원격에 이미 적용**됐으므로 기존 파일을 고치지 않고 **새 비파괴 파일 `20261113004670`** 하나로 한다(A 가드·B 복사 RPC·C 읽기 RLS 확인). **파괴 `004700`은 계속 마지막이다.** 이 파일도 **코드 배포 전에 push**해야 한다 → `05_release.md`를 고친다.

**경계**: `src/lib/data/cover-letters.ts`는 UI 세션 브랜치 소유(stub이 이름·시그니처까지 맞춰져 있다)라 백엔드가 만들지 않는다. 백엔드는 서버 서비스·액션·계약만 만들고 export 목록을 UI에 넘긴다.

**UI에 덧붙인 주의**: 문항 설정 상태는 `getCoverLetterDocument`가 **`null`일 때만** 들어가야 한다 — 읽기 **실패**를 `null`로 접으면 같은 덮어쓰기가 다시 생긴다.

### R15 후속 db 결과 (2026-11-09)
- 새 비파괴 `20261113004670_r15_document_write_guard_and_copy.sql` — 원격 미적용, **코드 배포 전에 push**. 순서 `004660`(원격) → `004670` → `004700`(파괴, 마지막). 원격 적용분 17개는 무변경(리더 확인).
- **A 쓰기 가드**: 트리거 `application_documents_guard_write`, 트랜잭션 로컬 플래그 `app.application_document_write`, 거부 `direct_write_not_allowed`(P0001 → api **403**, 리더 승인). delete는 허용. 플래그가 켜져도 RLS는 그대로(남의 행 insert는 `42501`). `delete_career_item`의 definer 헬퍼는 소유자로 돌아 가드에 걸리지 않음(pgTAP 확인).
- **B 복사 RPC** `mark_application_document_copied` — 한 번만 기록, 행 없음·남의 행은 `null`, **`updated_at` 불변**(전용 트리거가 `updated_at`·`first_copied_at`·`slot_count` 외 변화가 없으면 유지). ⚠ 생성 타입은 `Returns: string`이지만 **실제 `null`이 온다** → api는 `string | null`로 받는다.
- **C 읽기 RLS**: 빠진 정책 없음, 새로 연 것 없음(4종 모두 `user_id = auth.uid()`).
- pgTAP **65파일 2,649 단정**, 잔여 행을 심은 상태로도 통과.

### R15 범위 밖 후속 후보 — `profile_job_interests` 쓰기 우회 (db-engineer 관찰)
R13의 `profile_job_interests`도 **같은 구조**다 — 저장 RPC `save_profile_basics`가 `security invoker`이고 `authenticated`에 insert grant가 있어, 로그인한 사용자가 RPC를 거치지 않고 REST로 자기 관심 직무 행을 직접 쓸 수 있다(상한·검증 우회, 자기 행 무결성 문제 — 교차 사용자 침해 아님). **R15 범위가 아니라 이 슬라이스에서 고치지 않는다.** 같은 가드 패턴(`004670`)으로 막을 수 있다. 다른 invoker 저장 RPC 대상 테이블도 같은 감사가 필요하다 — 별도 슬라이스 후보.

## 2026-11-09 UQ-741 — 서류 저장의 기대 버전 null = 덮어쓰기 (기획 회부, 미결)

**발견**: UI 세션 UI QA UQ-741(Major). `save_application_document`가 행이 있어도 `p_expected_updated_at`이 null이면 검사 없이 덮어쓴다.

**판정: 버그가 아니라 문서에 적힌 공통 계약**이라 리더가 바꾸지 않았다. DM §2.5.1 공통 규칙 "기대 버전": "null이면 덮어쓴다(화면 '내 내용으로 저장'은 이 인자 없이 다시 보낸다)". 저장 RPC 5개가 같은 규칙을 쓴다(리더 코드 확인: `save_project_page`·`save_project_deliverable`·`save_profile_basics`·`save_application_document`·R11 `p_client_id` 판).

**서류에만 생기는 모호함**: S-10·S-44는 만들기와 고치기가 인자로 갈리고(대상 id null + `p_client_id`) 화면이 늘 `updated_at`을 들고 있어, null은 "내 내용으로 저장"에서만 나온다. 서류는 "행이 없으면 만들고 있으면 고친다"(구분 인자 없음)라서 **null이 "첫 저장"과 "강제 덮어쓰기" 두 뜻**을 갖는다. 행이 생기기 전에 연 탭은 보낼 `updated_at`이 없어서 **화면에서 고칠 수 없다** → 두 탭 경로로 정본이 빈 기본 문항으로 조용히 덮인다.

**회부**: 기획 검토 세션(`local_6c265c4a-…`)에 선택지 4개와 구현 영향을 올렸다. **권고 (a)** — 서류 RPC만 "행이 있는데 null이면 `stale_write`", 첫 저장은 지금처럼, "내 내용으로 저장"은 `stale_write`의 `details.current_updated_at`을 다시 보낸다, S-10·S-44·프로필은 변경 없음. 확정되면 R15 후속 묶음에 새 비파괴 마이그레이션(`004700`보다 앞 번호)으로 넣는다. **두 PR 머지는 이 건 정리 뒤.**

**정정 (UI QA)**: 공백 1번(정본 읽기 없음)의 현재 증상은 "늘 문항 설정 상태"가 아니라 **"S-46이 늘 오류 화면"**이다(`notWired`가 throw하고 page가 catch하지 않는다). 그래서 **현재 코드로는 덮어쓰기가 일어나지 않는다.** 위험은 "읽기를 연결할 때 실패를 `null`로 처리하면 생기는 경로"였고, UI가 `catch → null`을 넣지 않기로 했다.

**UQ-752 (Minor)**: `src/server/ai/storage/evidence-links.ts:23`의 쓰는 곳 없는 타입 목록에 옛 `drafts` 이름 잔여. 런타임 영향 없음. QA가 끝난 뒤 정리한다.

**파괴 전 점검 — 충족 (UI 세션 판정, 그쪽 브랜치 기준)**: 실제 경로에서 옛 `drafts`·`draft_sections`·`draft_section_sources` 참조 0건(`.from(...)` 0, 옛 RPC 호출 0, `drafts-real.ts`·`services/drafts/`·옛 생성 라우트 없음). 이름만 걸리는 실제 경로 파일 4곳은 안전 판정. `retryJdExtraction`·`runJdExtraction` 보존(`drafts.ts:1153-1158`).

## 2026-11-09 CF-S6 (사용자 확정) — 법무 3종 2026-11-09판 `policy_versions` 행

**출처**: 기획 검토 세션 회신. decisions 4.23 백엔드 #15, 문서 반영은 **PR #68(미머지)** — 이 워크트리 `docs/`에는 없다.

**원문 확인 (리더, PR #68 브랜치 `docs/legal/` 읽기 전용)**: terms·privacy·ai_data_use 모두 **버전 `2026-11-09`, 시행일 2026-11-09, 재동의 없음**(경력기술서 삭제 — 제공 서비스·수집 항목 축소). cross_border_transfer는 대상 아님. 원격 직전 판은 terms `2026-11-08`, privacy·ai_data_use `2026-11-08.1`. 새 판의 시행일이 더 늦어 R14 동률 정렬과 무관하다.

**구현**: `20261113004680_r15_policy_versions_cf1.sql`(R14 `20261113002950` 패턴 — 새 행만, `on conflict do nothing`). 번호는 `004670` 뒤·파괴 `004700` 앞. **QA 진행 중이라 스크래치패드에 준비만 했다** → QA 뒤 db-engineer가 넣고 현재 판을 박아 둔 pgTAP 7곳(`policy_versions` 개수 17→20, `consents`·`r12_ui36_followups`·`account_deletion`·`r13_settings_dialog`·`r14_remove_mock_interview`·`signup_consent_ai_gate`)을 고친다. 앱 코드 `src/server/services/shell/index.ts`는 **주석만** 걸려 변경 없음(테스트는 자체 픽스처).

**릴리스 결합**: UI 소유 `src/components/account/policy-content.ts`와 **같은 머지**. 마이그레이션은 코드 배포 전에 push되므로 **push ~ 머지 사이 화면이 옛 본문에 새 시행일**을 보인다(R14와 같은 창 — push 직후 머지).

## 2026-11-09 CF-S7 (사용자 확정) — 서류 저장의 기대 버전 null

UQ-741 회부 결과 **(a) 확정**. `save_application_document`만: **정본 행이 있는데 `p_expected_updated_at`이 null이면 `stale_write`**(409, `details.current_updated_at`). 행 없음 + null(첫 저장)은 통과. 다른 저장 RPC 3종(`save_project_page`·`save_project_deliverable`·`save_profile_basics`)은 변경 없음. "내 내용으로 저장"은 `stale_write`의 `current_updated_at`을 실어 재전송(UI 커밋 `f56775e`에 이미 반영). 문서는 PR #68(DM 2.5.1 "기대 버전" 행 서류 예외, UX S-46, decisions 3.28 CF-S7·4.23 백엔드 #16·UI #12). → 새 비파괴 `20261113004690`.

## 2026-11-09 R15 후속 3 리더 판정 2건 (UI QA 라운드 1에서 나온 백엔드 요청)

**① 슬롯 번호 재사용 금지 수단 — `application_documents.slot_high_water`** (UQ-740 수정 중 발견)
DM 2.5.0b "번호는 그 서류에서 한 번 쓰면 재사용하지 않는다"는 **이미 정해진 규칙**인데 정본에 지킬 수단이 없었다 — 지우고 **저장한** 번호는 `body`에서 사라져 다음 방문의 화면이 알 수 없다. 그러면 옛 대화의 같은 번호 제안이 새 문항에 붙어 같은 `slot`·`rev`로 [반영]·저장이 통과한다(근거 행은 저장 때 지워지지만 제안은 `structured_draft`에 남는다). **판정**: 규칙을 지키는 수단이라 구현 세부로 정했다 — 컬럼 `slot_high_water integer not null default 0` `[가정: 이름]`. 저장 RPC가 **저장돼 있던 body에 없는 새 슬롯**의 번호가 이 값 이하이면 `invalid_slot`, 쓴 뒤 `greatest(기존, 이번 최대 번호)`. `meta`에 두지 않은 이유: `p_meta`는 `{tone}`만 받는 계약(2.5.1). `updated_at` 트리거 예외 목록에 추가(메타라 기대 버전을 깨지 않게). CF-S7과 같은 함수라 **같은 마이그레이션 `004690`**. 화면은 `max(slot_high_water, 열린 제안, 이번 방문 발급분) + 1`로 새 번호를 정한다.

**② 서류 `draft_done`에 확정 초안 `draft`** — 틀린 문장을 [반영]할 수 있던 자리
산출물 `draft_done`은 `body: StoredDraftBodySchema`를 싣고 계약 주석이 "`draft_block`은 임시 — `draft_done.body`가 정본"인데, **서류 `draft_done`에는 확정 초안이 없었다**. 화면이 임시 `draft_block`을 모아 제안을 만들기 때문에 **글자 수 보정(`correctionApplied`)이 일어나면 [반영]이 보정 전 문장을 채운다**. `base_body_hash`도 없어 화면이 재계산했다. **판정**: S-44와 계약을 맞추는 구현 세부(새 이벤트 이름 없음, R15-L2와 같은 종류) — 서류 `draft_done`에 그 슬롯의 **저장된** 초안 객체를 `draft`로 싣는다(저장 모양 snake_case). **DB가 `value`를 블록으로 재조립하므로 파이프라인 객체가 아니라 패치 적용 뒤 저장본**을 싣는다 — 통합 테스트로 "SSE 초안 == 저장 초안" 단정.

## 2026-11-09 R15 후속 3 QA — 슬롯 정체는 번호 + `question_id` (QA-07·QA-08, 리더 판정)

**QA 후속 라운드 2 결과**: CF-S7·`draft_done.draft` 통과(동시 첫 저장 25회 독립 재현 — 매번 성공 1·`stale_write` 1, 500 0건, 이중 성공 0건. 우회 시도: 먼 미래·과거·`±infinity`·형식 오류·밀리초 절삭·`p_client_id` 모두 실패). 슬롯 재사용 규칙에 Major 1·Minor 1.

**QA-07 (Major)** — 재사용 검사가 **슬롯 이름만** 본다(`004690:233-237`). 같은 `q_3` 이름에 다른 `question_id`가 오면 "기존 `q_3`"으로 통과해 **옛 문항의 AI 제안이 새 문항에 `applied`**된다(S-swap). `question_id`를 빼면 서버가 기존 슬롯에 새 uuid를 발급해 정체가 바뀌고 `user_note` 근거가 끊긴다(S-swapnull). 실제 패치 RPC(`app_ai_writer`)로 만든 제안으로 사용자 세션 REST에서 끝까지 재현됐다. 올바른 UI는 닿지 않지만 옛 탭·버그 화면·`question_id`를 빼는 클라이언트가 조용히 일으킨다. 교차 사용자 영향 없음.

**QA-08 (Minor)** — 한 저장에서 지운 슬롯의 제안을 같이 보내면 "반영됨"으로 기록된다(`003700`부터). 근거 행은 생기지 않음.

**판정**: DM 2.5.0b 재사용 금지와 2.5.1 반영됨 기록을 제대로 지키는 **구현 수정** — 기획에 올리지 않았다.
1. 저장된 슬롯과 같은 번호 + **다른 `question_id`** → 새 문항으로 보고 `invalid_slot`.
2. 저장된 슬롯과 같은 번호 + **`question_id` 생략** → 저장된 id를 **물려받는다**(새 uuid 금지).
3. 저장된 body에 없는 새 슬롯은 지금처럼 번호 > `slot_high_water`.
4. 심층 방어: 제안의 저장된 `question_id` ≠ 이번 body 그 슬롯의 `question_id` → `skipped: not_found` `[가정: 사유]`(2.5.1 "대화가 이 대상의 것이 아님" — `proposal_changed`는 `rev` 차이용). 이번 방문에 추가해 아직 저장되지 않은 슬롯은 1로 막히지 않으므로 필요하다.
5. QA-08: 제안의 슬롯이 이번 저장된 body에 없으면 `skipped: not_found`.

**마이그레이션**: `004690`은 아직 커밋·원격 push 전이라 **그 파일을 고친다**(새 파일 없음).

**관찰 (결함 아님)**: `draft_done.draft`와 저장본은 [반영]이 읽는 모든 필드가 같지만, TS 스키마 정규화로 항상 빈 배열인 키 2개(`requirement_ids`·`source_project_fields`)가 바이트 단위로 다르다. 다시 읽기 DTO도 같은 정규화를 거친다. 계약 주석 "exactly as … holds it"이 과장이라 리더가 문구를 고쳤다(`src/lib/contracts/writing-chat.ts`).

## 2026-11-10 CF-S8 (사용자 확정) — 저장하지 않은 새 문항의 AI 초안: (a) 자동 저장 후 요청

리더가 기획 세션에 올린 건(저장하지 않은 새 문항은 AI 초안 컨텍스트에 들어가지 않는다)이 **(a)로 확정**됐다. **백엔드 변경 없음.**
- **서버 — 지금 동작을 정본으로 확정**: `mergeQuestions`(`src/server/ai/context-pack/cover-letter-chat.ts:213-234`)는 정본 문항만 돌고, `form_snapshot`은 저장된 문항의 **값만** 덮어쓴다. 코드는 바꾸지 않는다.
- **화면(UI #13)**: S-46은 턴을 보내기 전에 저장하지 않은 문항 추가·삭제·순서 변경이 있으면 `save_application_document`로 **먼저 저장하고, 성공하면 턴을 보낸다**. 저장이 실패하면(검증 오류·`too_many_questions`·`stale_write`·네트워크) 턴을 보내지 않는다. 값만 바뀐 경우는 저장하지 않고 스냅숏으로 보낸다 `[가정]`.
- **R15와 맞물리는 점**: 자동 저장도 일반 저장과 같은 경로라서 CF-S7(정본이 있으면 기대 버전 필수)과 슬롯 정체 규칙(번호 + `question_id`, `slot_high_water`)을 그대로 거친다. 그래서 저장된 문항에만 제안이 붙고, QA-07에서 막은 혼선이 다시 열리지 않는다.
- 문서: PR #68 커밋 `99ce3d9` — DM 2.5.1 `form_snapshot` 단락, AI-04 `<document_state>` 행, decisions 3.28 CF-S8, 4.23 백엔드 #17(변경 없음)·UI #13. 이 워크트리의 `docs/planning/`에는 아직 없다(PR #68 미머지).
