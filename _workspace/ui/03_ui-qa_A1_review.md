# UI QA — A1 계정 (S-01, S-02, S-03, S-24, S-25, S-30) (라운드 1)

기준: 플로우 v4.2b · PRD v3.2a · 데이터 모델 v3.2a · 디자인 시스템 v1 · A0 보고(라운드 1 규칙) · A1 보고(2026-10-25). 이슈 ID는 UQ-90부터(A2 리뷰가 UQ-60~82 사용).

## 요약 — Critical 0 / Major 1 / Minor 17

- 기계 검사: `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm build` 통과(36페이지, `/consent` `/policies` `/settings` `/settings/withdraw` `/sign-in` Partial Prerender, `/` 정적).
- dev 서버(포트 3611, 검수 후 종료)에서 A1 15개 URL(`?state=` 포함) 모두 200, 개발 로그 오류 0. 픽스처 렌더 확인: 이메일, 동의일·버전, 탈퇴 요약(경력 3, 기업 JD 6개, 전형 이력 11, 진행 중 AI 작업 3건), `?state=empty` 0개.
- 브라우저 육안·클릭 검수는 하지 않았다(브라우저 도구 미사용). 클라이언트 동작(로그인 링크 → 동의 → 커리어, 선택 동의 토글, 탈퇴)은 코드 경로로 확인했다. 실제 탈퇴는 같은 dev 서버의 mock DB를 재시드하므로 실행하지 않았다.
- 소유권: A1은 `src/components/account/`, `src/app/(public)/{page,sign-in,consent,policies}`, `src/app/(dashboard)/settings/**`만 수정. `(public)/layout.tsx`(수정 시각 10-24 20:55, A1 작업 이전)·공통 파일은 건드리지 않음 ✅.
- Major 1건은 기획 모순(사용량 기록 보관)이 화면 두 곳의 고지 문구 충돌로 드러난 것이다. A1 자체 결함 중 Major 이상은 없다.

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 |
|---------|----|----|------|----|----|----|----|----|-----|
| S-01 랜딩 | ✅ | ⚠️ UQ-91 | — | ✅ | — (정적) | — | ✅ | ✅ | ✅ |
| S-02 가입/로그인 | ✅ | ✅ (v3 문구 없음, [UI-가정]) | ✅ | ⚠️ UQ-99, UQ-100 | ✅ loading·error·sent·link-expired·new-user | — | ✅ (Google 로고 예외 허용) | ⚠️ UQ-96, UQ-103 | ✅ |
| S-03 동의 | ✅ (5개 consent_type, AI 처리 고지에 "AI 작성 대화 내용") | ✅ | ✅ | ✅ (`next` 전달) | ✅ loading·save-failed·unauth·error | — | ✅ | ⚠️ UQ-97, UQ-98 | ✅ |
| S-30 처리방침·약관 | ✅ (policy_type 탭 3개, 버전·시행일) | ⚠️ UQ-90 | ✅ | ⚠️ UQ-94 | ✅ loading·error·not-found, 잘못된 `doc` → 기본 탭 | — | ✅ | ✅ | ⚠️ UQ-105 |
| S-24 설정 | ✅ | ✅ | ✅ | ✅ (S-04, S-25, S-30 ×3, 로그아웃 → S-01) | ✅ loading·error·unauth·save-failed | — | ⚠️ UQ-104 | ⚠️ UQ-93, UQ-101 | ✅ |
| S-25 회원 탈퇴 | ✅ (`get_account_deletion_summary` 12개 개수) | ⚠️ UQ-90 | ✅ | ✅ (`replace` → S-01) | ✅ loading·error·unauth·empty·save-failed | — | ✅ (위험 강조는 버튼만) | ⚠️ UQ-102 | ✅ |
| 공통 (account-data) | — | — | ⚠️ UQ-95, UQ-106 | — | — | — | — | — | — |

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-90 | **Major** | 기획 | S-25, S-30 | 04 DM-1 "모든 사용자 데이터 테이블 … on delete cascade"(탈퇴 시 전체 파기) ↔ 04 §4.4 "`usage_events` 13개월", A.10 usage_events "보관 13개월"; PRD NFR-PRV-06 "탈퇴 시 전체 파기" | `src/components/account/deletion-summary.tsx:33` "동의 이력과 기능 사용량 기록도 함께 삭제돼요" ↔ `src/components/account/policy-content.ts:164` "AI 작업 기록 90일, 사용량 기록 13개월" | 탈퇴 시 사용량 기록을 지우는지 하나로 정하고, 두 화면 문구를 그 결정에 맞춘다 | 같은 사용자에게 S-25는 "삭제", S-30은 "13개월 보관"이라고 고지(법적 고지 문구 충돌). 스펙 자체가 모순이라 어느 쪽도 고르지 않음. 재가입으로 월 한도를 우회하는 문제(A1 보고)도 이 결정에 달림. 결정 후 A1이 두 문구를 맞춘다 |
| UQ-91 | Minor | A1 | S-01 | 02 S-01 "커리어를 정리하고(AI와 대화로도) / 기업 JD마다 인사이트·서류·면접 / 지원 현황 보드로 관리" | `src/app/(public)/page.tsx:15` | 첫 줄 "커리어를 정리하고(AI와 대화로도)" 그대로 | 제목이 "커리어를 정리하고"로 줄고 "(AI와 대화로도)"는 보조 문장으로 풀어 씀(의미는 유지, 문구 변형) |
| UQ-92 | Minor | A1 | S-25 | 04 F-COM-05 "W `auth.users` delete(전체 연쇄)", FL-07 "즉시 로그아웃" | `src/components/account/account-data.ts:215-219` | mock으로는 허용. 다만 "삭제됐다"가 관찰 가능해야 함 | `resetMockDb()`는 비우기가 아니라 **픽스처 재시드**라서 탈퇴 후 픽스처 이메일로 다시 로그인하면 이전 데이터가 그대로 보이고("되돌릴 수 없어요" 고지와 모순되어 보임), 같은 dev 서버를 쓰는 다른 영역 검수 중 변경도 모두 사라진다. 판정: **mock으로는 수용 가능**(사용자 노출 없음, 실제 백엔드는 `auth.users` delete로 교체). 권장: (a) 검수 기간에는 그대로 두되 공용 dev 서버에서 탈퇴를 누르지 않도록 리더가 안내, (b) 파운데이션이 mock 세션(요청 6)을 넣을 때 "탈퇴됨 → 신규 사용자로 취급" 플래그로 바꾸기 |
| UQ-93 | Minor | A1 | S-24 | 디자인 시스템 A-2 "상태는 색 + 아이콘 + 글자" | `src/components/account/consent-settings.tsx:61-66` | 동의 기록이 없으면 체크 아이콘 대신 다른 표시 | 필수 동의 행에 `Check text-success`를 항상 그림 — "동의 기록 없음"일 때도 초록 체크가 보임 |
| UQ-94 | Minor | A1 | S-30 | 02 1.3 메뉴 하단 "처리방침 링크"(셸 안에서 진입), S-30 "공통" | `src/app/(public)/policies/page.tsx:46-55`, 레이아웃 `src/app/(public)/layout.tsx:9` | 셸에서 연 사용자가 원래 화면으로 돌아갈 길 | S-30은 (public) 레이아웃이라 셸 메뉴가 사라지고 로고는 S-01(랜딩)로만 감. 로그인 사용자는 브라우저 뒤로만 돌아갈 수 있음. A1 페이지 안에 "돌아가기"(history back, 없으면 S-08) 링크 추가 권장. 라우트 위치 자체를 바꿀지는 리더 판단 |
| UQ-95 | Minor | foundation | 공통 | ui-context "Screens read through `src/lib/data/*`", A1 파운데이션 요청 1·3 | `src/components/account/account-data.ts:13`, `src/components/account/consent-form.tsx:24,147`, `src/components/account/policies-view.tsx:11,34` | `lib/data/account.ts`로 옮길 때 그대로 import만 바꿔 되는 구조 | 옮기면 깨지는 지점: ① `account-data.ts`가 `./policy-content`(components 폴더)의 `CONSENT_ITEMS`·`REQUIRED_CONSENT_TYPES`·`currentPolicyVersion`를 import → lib가 components에 의존하게 됨. 동의 항목 정의·필수 목록은 `lib/data/labels.ts`(또는 `lib/data/account` 상수)로, `MOCK_POLICY_VERSIONS`는 `lib/mock/fixtures`로 함께 옮겨야 함. ② 클라이언트 컴포넌트(S-03 `consent-form.tsx:147`, S-30 `policies-view.tsx:34`)가 `currentPolicyVersion()`을 동기로 부름 — `policy_versions`가 서버 스토어로 가면 클라이언트에서 못 읽으므로 페이지가 버전을 prop으로 내려 주도록 바꿔야 함. ③ `getAccountDeletionSummary()` 반환에 RPC에 없는 `running_ai_jobs`가 섞임(`account-data.ts:184,204`) — 옮길 때 RPC 반환(`AccountDeletionSummary`)과 보조 조회를 분리해야 실제 RPC로 교체 가능(UI는 이미 optional로 받음) |
| UQ-96 | Minor | A1 | S-02 | 디자인 시스템 7 A-3(포커스), 다이얼로그·패널 포커스 관리 원칙 | `src/components/account/sign-in-form.tsx:103-108,147` | "다른 이메일로 받기" 후 이메일 입력으로 포커스 | 버튼이 사라지면서 포커스가 body로 떨어짐(`form.setFocus("email")` 필요) |
| UQ-97 | Minor | A1 | S-03 | 디자인 시스템 A-10 "`aria-invalid` + `aria-describedby`" | `src/components/account/consent-form.tsx:95-96,155-160` | 누락된 필수 체크박스가 오류 문구를 가리킴 | `aria-invalid`만 있고 `aria-describedby`는 설명 문구만 가리킴. 오류 문구(`role="alert"`)에 id를 주고 연결 |
| UQ-98 | Minor | A1 | S-03 | 디자인 시스템 A-4 "좁은 화면 터치 대상 44×44px" | `src/components/account/consent-form.tsx:115-121` | "보기" 링크 터치 영역 44px | `text-sm` 글자 링크만(약 20px 높이). `min-h-11 inline-flex items-center` 등으로 확장 |
| UQ-99 | Minor | A1 | S-02, S-03 | 02 1.3 "로그인 전 요청한 URL이 있으면 그 URL" | `src/app/(public)/sign-in/page.tsx:44`, `src/app/(public)/consent/page.tsx:40` ↔ `src/components/account/account-data.ts:28-32` | `next` 검사는 한 함수로 | 페이지는 백슬래시(`/\`) 검사가 빠진 별도 인라인 검사, 서버 액션은 `safeNextPath`. 지금은 액션이 다시 걸러 안전하지만 두 규칙이 갈라져 있음. 또 `next=/sign-in`·`/consent`처럼 인증 화면 자체를 허용해 로그인 후 다시 로그인 화면으로 가는 고리가 생길 수 있음 → `safeNextPath`가 공개 인증 경로(`/sign-in`, `/consent`)를 거르고 페이지도 이 함수를 쓰도록 |
| UQ-100 | Minor | foundation | S-02 (ST-UNAUTH 경유) | 02 1.3 첫 화면 "로그인 전 요청한 URL", S-02 "로그인 후 S-08 또는 원래 URL" | `src/components/common/state-views.tsx:123` `routes.signIn()` | ST-UNAUTH "로그인" 버튼이 현재 경로를 `?next=`로 전달 | `next` 없이 `/sign-in`으로 감 → mock에서는 "원래 URL로 복귀"를 실제로 탈 경로가 없음. `routes.signIn(next?)` 추가(A1 요청 5와 같음) |
| UQ-101 | Minor | A1 | S-24 | FL-07/로그아웃 후 접근 차단 취지 | `src/components/account/sign-out-button.tsx:18-22` | 로그아웃 후 `router.replace` + 실패 처리 | `router.push`라 뒤로 가기로 설정 화면이 다시 보임. `signOutAction` 실패 시 버튼이 계속 로딩 상태로 남을 수 있음(try/finally 없음) |
| UQ-102 | Minor | A1 | S-25 | 디자인 시스템 A-3, 6 A1 "확인 입력/체크 후 destructive 버튼" | `src/components/account/withdraw-form.tsx:70-72`, `:73` | 처리 중에는 취소도 막고, 실패 후 포커스를 오류 근처로 | `Button asChild disabled`는 `<Link>`에 적용되지 않아 탈퇴 처리 중에도 "취소"가 눌림. 처리 중 제출 버튼이 disabled 되면서 포커스가 사라지고, 실패해도 돌아오지 않음 |
| UQ-103 | Minor | foundation | S-02 (FieldError 전반) | 디자인 시스템 A-10 "필드 아래 `text-sm text-destructive` + `CircleAlert`" | `src/components/ui/field.tsx:215-223` (사용처 `sign-in-form.tsx:178`) | 오류 문구 앞 `CircleAlert` 아이콘 | 공통 `FieldError`가 글자만 그림(아이콘 없음). 다른 영역 폼에도 같은 영향 |
| UQ-104 | Minor | ui-designer | S-24 | `docs/ui/design-system.md:450` "`max-w-page` … S-24" ↔ `:858` "S-24 설정: `max-w-form`" | `src/app/(dashboard)/settings/page.tsx:63` (`max-w-3xl` = form) | 디자인 시스템이 한 값 | 문서 안에서 S-24 폭이 두 가지. 구현은 6장 A1(form)을 따름 — 5장 표를 정정 |
| UQ-105 | Minor | foundation | S-30 | 디자인 시스템 A-4 (44px) | `src/components/ui/tabs.tsx:27` (`h-8`), 사용처 `policies-view.tsx:26` | 좁은 화면에서 탭 높이 44px | 탭 목록 `h-8`(32px). 360px 폭에서 세 탭 이름은 한 줄에 들어감(계산상 약 304px / 328px) — 높이만 문제 |
| UQ-106 | Minor | foundation | S-24 | 04 A.2 consents `policy_version` ↔ policy_versions `effective_at` | `src/lib/mock/fixtures.ts:1186-1188` | 동의일 ≥ 그 버전 시행일 | 렌더 결과 "2026.06.27 동의 · 버전 2026-10-01" — 시행 전 버전에 동의한 기록(A1 요청 4와 같음) |
| UQ-107 | Minor | A1 | S-03 | FL-09 "필수 동의 완료 → S-08", 동의 거부 시 처리(스펙 없음) | `src/components/account/consent-form.tsx:175-177` | 거부 = 로그아웃 후 S-01(세션이 남지 않게) | "동의하지 않고 나가기"가 단순 링크라, 실제 인증이 붙으면 동의 없는 로그인 세션이 남는다. 지금은 mock이라 영향 없음 — `signOutAction` 후 이동하도록 바꿔 두면 백엔드 연결 시 그대로 맞음 |

## 기획 확인 필요

| # | 화면 | 내용 | 양쪽 인용 |
|---|------|------|-----------|
| P-A1-1 (= UQ-90) | S-25, S-30 | 탈퇴 시 `usage_events` 삭제 여부 | 04 DM-1 "모든 사용자 데이터 테이블은 … on delete cascade / 탈퇴 시 전체 파기를 DB가 보장" ↔ 04 §4.4 "`usage_events` 13개월" |
| P-A1-2 | S-03 | 5개 `consent_type` 중 필수/선택 구분(구현: `terms`·`privacy_required`·`cross_border_transfer` 필수). 국외 이전을 필수로 볼지가 가입 가능 여부를 정함 | PRD F-COM-02 "필수/선택 분리, 국외 이전, AI 처리" — 항목별 표시 없음 / 04 A.2 CHECK 목록만 |
| P-A1-3 | S-03 | 정책 버전 갱신 시 재동의 화면(진입 시점·문구·거부 처리) — 구현 없음 | 04 §2.1 "국외 이전 항목에 AI 작성 대화 추가는 정책 버전 갱신 → 재동의로 처리" / 02에는 화면 없음 |
| P-A1-4 | S-25 | 확인 문구 형식(입력 단어 '탈퇴' vs 체크) | 02 FL-07 "확인 문구" / 디자인 시스템 6 A1 "확인 입력/체크" |
| P-A1-5 | S-01~S-03, S-24, S-30 | "v3와 같음"의 v3 원문 부재 → 제목·부제·설정 구성·처리방침 본문이 모두 [UI-가정] | 02 §3 S-01~S-03 "나머지 v3와 같음", S-24·S-30 "v3와 같음" |
| P-A1-6 | S-30 | 국외 이전 수령자(제공자 이름·국가·보관 기간) | PRD D-10 "출시 전 확인" |
| P-A1-7 | S-24 | 필수 동의 철회를 화면에서 허용하는지(구현: 탈퇴로만) | 04 A.2 RLS "update는 선택 동의의 `withdrawn_at`만" |

A1 보고의 기획 확인 항목과 겹치는 것은 그대로 이어 받았다(P-A1-2~7). 리더가 resumate-planning으로 넘길 때 P-A1-1을 먼저 처리해야 S-25·S-30 문구를 고칠 수 있다.

## 검수 메모 (이슈 아님)

- 리다이렉트 경로: S-02 → (신규) S-03 `?next=` 유지 → `next` 또는 S-08 / (기존) `next` 또는 S-08, 기존이어도 활성 필수 동의가 없으면 S-03 — FL-09·1.3과 일치 ✅. `next`는 서버 액션에서 같은 출처 상대 경로만 허용 ✅(오픈 리다이렉트 방지).
- 동의 기록: 동의 1회 = 1행, 선택 철회 = `withdrawn_at`, 재동의 = 새 행, 필수는 서버에서도 거부(`setOptionalConsent`) — 04 A.2와 일치 ✅.
- `types/db.ts`의 `Consent`·`ConsentType`·`PolicyType`·`PolicyVersion`·`AccountDeletionSummary` 이름·enum이 04 A.2/§4.3과 일치, UI 전용 필드(`running_ai_jobs`, `ConsentStatus`)는 db 타입 밖에 둠 ✅.
- 탈퇴 확인: 확인 문구 일치 전 destructive 버튼 비활성, 실패 시 "데이터는 그대로예요" + `role="alert"`, 성공 시 토스트 + `replace(S-01)` ✅. 위험 강조는 버튼에만 ✅.
- 선택 동의 토글: 낙관적 반영 → 실패 시 원복 + 토스트 "다시 시도", 성공 시 `aria-live` 한 번 ✅.
- 원색·팔레트 클래스: Google 로고 SVG fill 외 없음(디자인 시스템 허용 예외) ✅.

## 재확인 결과

라운드 1이라 없음.

## 기계 검사 출력

- `pnpm lint` — `eslint` 오류·경고 0
- `pnpm typecheck` — `tsc --noEmit` 오류 0
- `pnpm build` — 성공. "Generating static pages (36/36)", A1 라우트 `/` ○, `/sign-in` `/consent` `/policies` `/settings` `/settings/withdraw` ◐
- `pnpm exec next dev -p 3611`(검수 후 종료): `/`, `/sign-in`, `/sign-in?state=sent|loading`, `/sign-in?state=link-expired&next=/board`, `/consent`, `/consent?state=unauth`, `/policies`, `/policies?doc=cross_border_transfer|bogus`, `/policies?state=not-found`, `/settings`, `/settings?state=error`, `/settings/withdraw`, `/settings/withdraw?state=empty` — 모두 200, 개발 로그 오류 0

---

# 라운드 2 (최종, 2026-10-25)

기준: A1 "라운드 1 수정"(`03_frontend-engineer-A1_report.md`) + 파운데이션 배치 Phase 3(`02_frontend-engineer-A0_report.md`: `lib/data/account.ts`·`lib/data/consent-items.ts` 이동, `routes.signIn(next)`·`routes.consent(next)`·`routes.policies(doc)`, `safeNextPath` → `lib/routes.ts`, ST-UNAUTH `SignInLink`, FieldError 아이콘, 탭 44px, 픽스처 `policy_versions` 2026-04-01).

## 요약 — 판정: **통과**

- 새 Critical 0 / 새 Major 0 / 새 Minor 0.
- 라운드 1 이슈 18건: 해결 16 · 미해결(기획 대기) 1(UQ-90) · 수용(변경 없음) 1(UQ-92). 재발 0.
- 남은 Major UQ-90은 A1 결함이 아니라 기획 결정 대기다. 결정이 나면 A1이 두 문구만 맞추면 된다(두 곳 모두 `[UI-가정] UQ-90` 주석으로 표시됨). A1 화면 완료 처리를 막지 않는다고 본다.
- 기계 검사: lint 통과 · typecheck 통과 · build 통과(36페이지). dev 스모크(포트 3612, 검수 후 종료) A1 경로 17개 모두 200, 로그 오류 0.
- 브라우저 클릭 검수는 이번에도 하지 않았다. 포커스 이동(UQ-96·102), "돌아가기"(UQ-94), "나가기"(UQ-107)는 코드 경로로만 확인했다.

## 재확인 결과

| ID | 결과 | 메모 (코드 위치) |
|----|------|------------------|
| UQ-90 | 미해결 (기획 대기) | 문구 그대로, 두 곳에 `[UI-가정] UQ-90` 주석: `src/components/account/deletion-summary.tsx:33-35`, `src/components/account/policy-content.ts:100-102`. 기획 결정 후 A1이 맞춤 |
| UQ-91 | 해결 | `src/app/(public)/page.tsx:15` 제목 "커리어를 정리하고(AI와 대화로도)". 렌더 확인 |
| UQ-92 | 수용 (변경 없음) | `src/lib/data/account.ts:231-236` 여전히 `resetMockDb()`. 라운드 1 판정(mock으로 수용 가능) 유지. 공용 dev 서버 탈퇴 금지 안내는 리더 몫 |
| UQ-93 | 해결 | `src/components/account/consent-settings.tsx:61-65` 활성일 때만 `Check`, 아니면 `CircleDashed` + "동의 기록 없음" |
| UQ-94 | 해결 | `src/components/account/policies-back-link.tsx` — 같은 출처 이전 페이지면 `router.back()`, 아니면 S-08. `/policies`에 "돌아가기" 렌더 확인 |
| UQ-95 | 해결 | `lib/data/account.ts`는 `./consent-items`만 import(components 의존 없음). `currentPolicyVersion()` 제거, S-03(`consent/page.tsx:53`)·S-30(`policies/page.tsx:57`)이 `getPolicyVersions()`를 prop으로 전달. `getAccountDeletionSummary()`는 RPC 모양만, `getRunningAiJobCount()` 별도(`withdraw/page.tsx:59`). `account-data`·`policy-links`·`currentPolicyVersion` 참조 잔존 0 |
| UQ-96 | 해결 | `src/components/account/sign-in-form.tsx:57-60,114` 렌더 뒤 `form.setFocus("email")` |
| UQ-97 | 해결 | `src/components/account/consent-form.tsx:108-119,179` 누락 체크박스 `aria-describedby`가 설명 + 오류 문구 id |
| UQ-98 | 해결 | `consent-form.tsx:141` `inline-flex min-h-11`(음수 여백으로 행 높이 유지), S-24 필수 "보기"도 `min-h-11 sm:min-h-0`(`consent-settings.tsx:74`) |
| UQ-99 | 해결 | `src/lib/routes.ts:113-122` `safeNextPath` 하나로 통일(배열·`//`·`/\` 거부, `/sign-in`·`/consent` 하위·쿼리 포함 거부). S-02·S-03 페이지도 사용(`sign-in/page.tsx:43`, `consent/page.tsx:41`) |
| UQ-100 | 해결 | `src/components/common/sign-in-link.tsx` — `?state=` 빼고 현재 경로를 `next`로. 렌더: `/settings?state=unauth` → `/sign-in?next=%2Fsettings`, `/career?state=unauth` → `/sign-in?next=%2Fcareer`, `/consent?state=unauth` → `/sign-in`(인증 경로라 `next` 생략, 고리 방지) |
| UQ-101 | 해결 | `src/components/account/sign-out-button.tsx:22-30` `try/catch/finally` + `router.replace(S-01)` |
| UQ-102 | 해결 | `src/components/account/withdraw-form.tsx:76-84` 처리 중 "취소"를 disabled 버튼으로, `:30-32,68` 실패 시 오류 문구로 포커스 |
| UQ-103 | 해결 | `src/components/ui/field.tsx:216-226` `CircleAlert` + `flex items-start gap-1.5` |
| UQ-104 | 해결 | `docs/ui/design-system.md:450` `max-w-page` 목록에서 S-24 제거, `:858` `max-w-form`만 남음 |
| UQ-105 | 해결 | `src/components/ui/tabs.tsx:27` 탭 목록 `h-11`, `md` 이상 `h-9` |
| UQ-106 | 해결 | 픽스처 `policy_versions` 2026-04-01(시행 2026-04-01) — 렌더 "2026.06.27 동의 · 버전 2026-04-01". 동의일이 시행일 뒤 |
| UQ-107 | 해결 | `consent-form.tsx:57-64,198-201` "동의하지 않고 나가기" = `signOutAction` 후 `router.replace(S-01)`, 진행 중 로딩 + 다른 버튼 비활성 |

## 이동에 따른 회귀 점검

- 동의 기록 버전: `recordConsents`·`setOptionalConsent`가 `currentVersion(db, …)`(시행일 지난 최신 행)으로 `policy_version`을 채움(`lib/data/account.ts:143,173`). S-03 고지 버전과 S-30 탭 버전이 같은 출처(`getPolicyVersions`)라 서로 어긋나지 않음 ✅.
- `policy-content.ts`는 `consent-items`를 다시 export만 하고 문서 본문은 영역에 남음 — 클라이언트 컴포넌트가 서버 모듈을 끌어오지 않음 ✅(build 통과).
- 링크: `routes.policies(doc)` 생성값 `/policies?doc=terms|privacy|cross_border_transfer`, S-25 `routes.withdraw()`, S-24 `routes.profile()` 모두 존재하는 라우트 ✅.
- `SignInLink`는 `useSearchParams`를 쓰지만 A1 페이지에서는 `ScreenSuspense` 안의 `ErrorState`로만 그려져 Cache Components 규칙 위반 없음(build 통과) ✅.
- 사소한 관찰(이슈로 올리지 않음): `consent-form.tsx:57-64`의 `decline()`은 `try/finally`만 있어 `signOutAction`이 실패하면 처리되지 않은 rejection이 콘솔에 남을 수 있다. 이동은 그대로 되므로 사용자 영향 없음. 실제 인증 연결 때 `sign-out-button.tsx`처럼 `catch`를 두면 된다.

## 기획 확인 필요 (라운드 2 기준)

라운드 1의 P-A1-1~7 그대로 열림. P-A1-1(= UQ-90, 탈퇴 시 `usage_events` 삭제 여부)을 먼저 정해야 S-25·S-30 문구를 맞출 수 있다.

## 기계 검사 출력 (라운드 2)

- `pnpm lint` — `eslint` 오류·경고 0
- `pnpm typecheck` — `tsc --noEmit` 오류 0
- `pnpm build` — "Compiled successfully", "Generating static pages (36/36)". A1: `/` ○, `/consent` `/policies` `/settings` `/settings/withdraw` `/sign-in` ◐
- `pnpm exec next dev -p 3612`(검수 후 종료): `/`, `/sign-in`, `/sign-in?state=sent`, `/sign-in?next=/sign-in`, `/sign-in?next=/board`, `/sign-in?state=link-expired&next=/board`, `/consent?next=/board`, `/consent?state=unauth|save-failed`, `/policies`, `/policies?doc=terms`, `/policies?state=not-found`, `/settings`, `/settings?state=unauth`, `/settings/withdraw`, `/settings/withdraw?state=empty`, `/career?state=unauth` — 모두 200, 개발 로그 오류 0
