# S1 foundation 요약

## 만든 것
- **DB** (마이그레이션 8개)
  - 공통 함수: `private` 스키마, `set_updated_at`, `touch_career_data_updated_at`, `current_uid`
  - `app_ai_writer` 역할: nologin noinherit, authenticator에 grant
  - `profiles`와 가입 트리거, 컬럼 단위 grant
  - `policy_versions`와 초기 3행 [가정]
  - `consents`와 insert·update 가드 트리거
  - RPC `get_consent_status()`, `record_consents()`
  - public 기본 권한 회수
- **API**
  - 클라이언트: Supabase 세션 클라이언트, `app_ai_writer` 클라이언트(HS256 토큰, 요청마다 새로 서명)
  - 인증 헬퍼: `requireUser`, `requireConsentedUser`
  - `src/proxy.ts`: 세션 갱신, 보호 경로 접근 시 로그인으로 리다이렉트
  - `/auth/callback`: code와 token_hash 모두 처리, 동의 게이트, 오픈 리다이렉트 차단
  - Server Actions: 매직 링크(재발송), Google, 로그아웃, 동의 조회·제출·철회, 프로필 조회·수정
  - 계약: `enums`, `routes`, `auth`, `consent`, `profile`
  - 이메일 템플릿 2종(token_hash 방식)

## 검사
typecheck / lint / Vitest 147개(로컬 스택 통합 14개 포함) / build / pgTAP 80개 모두 PASS

## QA
2라운드, Minor 10건(QA-01~10) 모두 해결. 열린 이슈 없음.

## spec-gaps (기획 확인 필요)
- 초기 정책 버전 값, 선택 동의가 따르는 버전 [가정]
- 재동의 판단 기준 [가정]

## 연결(wiring)
UI 화면 없음 → A1 account "연결 대기"

## 출시 전 확인 (배포 체크리스트: `02_api-engineer_notes.md`)
- production `NEXT_PUBLIC_SITE_URL`
- Auth Site URL과 Redirect URLs (와일드카드는 팀 도메인 범위로만)
- 이메일 템플릿 복사
- Google 리디렉션 URI
- 레거시 JWT secret 사용 여부
- SMTP
