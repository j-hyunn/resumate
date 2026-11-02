# A1 계정 구현 보고 (Phase 3, 2026-10-25)

기준: 플로우 v4.2b · PRD v3.2a · 데이터 모델 v3.2a · 디자인 시스템 v1 · A0 보고(라운드 1). 커밋하지 않음. 인증·동의·탈퇴는 모두 mock(실제 Supabase 호출 없음).

## 완료 화면

| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---------|--------|--------------|------|
| S-01 랜딩 | `/` | (정적, 없음) | `display` 제목 + 명세 가치 제안 3줄(Layers / Briefcase / KanbanSquare, `md:grid-cols-3`) + 주 버튼 "시작하기"(→ S-02), 하단 로그인·처리방침 링크. 일러스트 없음(G-12) |
| S-02 가입/로그인 | `/sign-in?next=` | `loading` `error`(링크 발송·Google 실패) `sent`(링크 보냄 + 재발송 쿨다운) `link-expired`(콜백 오류) `new-user`(로그인 후 S-03으로) | 이메일(react-hook-form + zod 검증) + "로그인 링크 받기"(전체 폭) / "또는" / "Google로 계속하기"(outline, 공식 G 로고). 보낸 뒤 Alert info + "링크 재발송"(60초 쿨다운) + "다른 이메일로 받기". 개발 모드에만 "메일의 로그인 링크 열기"(콜백 흉내). mock 규칙: 픽스처 이메일(`jiwoo.kim@example.com`)·Google = 기존 사용자 → S-08 또는 `next`, 다른 이메일 = 신규 → S-03(`next` 이어 전달). `next`는 같은 출처 상대 경로만 허용 |
| S-03 약관·개인정보 동의 | `/consent?next=` | `loading` `save-failed` `unauth` `error` | 모두 동의(부분 선택 시 indeterminate) + 5개 항목(`consents.consent_type`, 필수/선택 배지, 항목별 "보기" → S-30 해당 탭 새 탭), AI 처리 고지 스크롤 박스(`bg-muted p-4 max-h-48`, 키보드로 스크롤 가능): 국외 전송 항목에 **"AI 작성 대화 내용"** 포함(D-10), AI 학습 미사용(F-COM-03), 민감정보 주의(NFR-PRV-05), 약관 버전. 필수 미동의로 누르면 빠진 항목 안내. 동의 = 항목당 `consents` 1행 → S-08 또는 `next` |
| S-30 처리방침·약관 | `/policies?doc=terms\|privacy\|cross_border_transfer` | `loading` `error` `not-found` | `policy_versions.policy_type` 탭 3개(버전·시행일), 탭 바꾸면 `?doc=` 갱신. 본문은 확정된 사실만으로 만든 구조 초안(수집 항목, 보유 기간 4.4 표 전체, 국외 이전 항목, AI 학습 미사용) + "출시 전 법무 검토" 안내 |
| S-24 설정 | `/settings` | `loading` `error` `unauth` `save-failed`(선택 동의 변경 실패 → 원복 + 토스트 다시 시도) | 섹션 카드(`max-w-form`): 계정(이메일, 기본 프로필 편집 → S-04, 로그아웃 → S-01) / 동의 관리(필수: 동의일·버전 읽기 전용, 선택: 체크 즉시 저장 — 동의 = 새 행, 철회 = `withdrawn_at`, aria-live 알림) / AI 데이터 처리(학습 미사용, 국외 전송 항목) / 처리방침·약관 링크 3개 / 회원 탈퇴 → S-25 |
| S-25 회원 탈퇴 | `/settings/withdraw` | `loading` `error` `unauth` `empty`(모든 개수 0) `save-failed`(탈퇴 처리 실패, 데이터 그대로 안내) | `get_account_deletion_summary()` 형태: 커리어 — 경력·교육·프로젝트·상세 내용·정량 성과·스킬·AI 작성 대화 N / 기업 JD N개 — 인사이트·초안·면접 세션·전형 이력 N(C-05 영향 요약 스타일). 부가: 동의 이력·사용량 삭제, 진행 중 AI 작업 취소 건수, 백업 30일·비식별 탈퇴 기록 3년(04 §4.4). 확인 문구 '탈퇴' 입력 시에만 destructive 버튼 활성 → 삭제 → 토스트 → S-01(`replace`). 위험 강조는 버튼에만 |

### 파일

- 라우트: `src/app/(public)/page.tsx`, `src/app/(public)/sign-in/page.tsx`, `src/app/(public)/consent/page.tsx`, `src/app/(public)/policies/page.tsx`, `src/app/(dashboard)/settings/page.tsx`, `src/app/(dashboard)/settings/withdraw/page.tsx` (모두 `ScreenSuspense` 페이지 규칙; `(public)/layout.tsx`는 수정하지 않음)
- `src/components/account/`
  - `account-data.ts` — 임시 계정 데이터 계층(서버 전용, mock 스토어 직접 사용): `sendMagicLink`, `completeSignIn`, `signInWithGoogle`, `signOut`, `getConsentStatuses`, `recordConsents`, `setOptionalConsent`, `getAccountDeletionSummary`, `deleteAccount`, `safeNextPath`
  - `actions.ts` — 서버 액션(결과 `{ok}` 객체)
  - `policy-content.ts` — 동의 항목 정의, 국외 전송 항목, 고지 문구, mock `policy_versions`, S-30 본문
  - `policy-links.ts` — `policyHref(doc?)`
  - `sign-in-form.tsx`, `consent-form.tsx`, `consent-settings.tsx`, `sign-out-button.tsx`, `policies-view.tsx`, `deletion-summary.tsx`, `withdraw-form.tsx`
- 링크는 모두 `routes.*`(S-30 탭만 `policyHref`로 `?doc=` 덧붙임).

## 미완료 / 부분 구현

- **실제 인증 없음**: mock에는 세션이 없어 로그인 상태 판별·로그인 전 URL 보존(미들웨어)·로그아웃 후 접근 차단은 흉내 내지 않는다. `?next=`는 S-02 → S-03 → 목적지까지 전달만 한다.
- **탈퇴 시뮬레이션**: 사용자 행 삭제를 `resetMockDb()`(픽스처 재시드)로 대신한다 — 탈퇴 후에는 UI에서 이전 데이터를 볼 수 없고, 병렬 검수 중인 다른 화면이 빈 데이터로 깨지지 않게 하기 위함. 같은 dev 서버에서 다른 영역이 만든 변경도 초기화된다.
- **재동의(정책 버전 갱신)** 화면: 04 §2.1이 "정책 버전 갱신 → 재동의"라고만 하고 화면 명세가 없어 만들지 않음(기획 확인 필요).
- 브라우저 육안·클릭 흐름 검수는 하지 않음. `pnpm dev`에서 12개 URL(상태값 포함) 200 응답과 픽스처 렌더(이메일, 동의일, "기업 JD 6개")만 확인. QA가 브라우저로 로그인 링크 → 동의 → 커리어, 선택 동의 토글, 탈퇴 흐름 확인 필요.

## [UI-가정]

| 화면 ID | 파일:줄 | 내용 |
|---------|---------|------|
| S-01 | `(public)/page.tsx:16,35` | 가치 제안 각 줄의 보조 문장, 랜딩 제목·부제 문구 |
| S-02 | `sign-in-form.tsx:21` | 재발송 쿨다운 60초 |
| S-02 | `sign-in-form.tsx:117,127,190` | 링크 만료·링크 보냄·발송/Google/콜백 실패 문구 |
| S-02 | `sign-in/page.tsx:51` | 화면 부제 문구, 하단 "가입 시 다음 화면에서 동의" 안내 |
| S-02 | `account-data.ts` `completeSignIn` | 신규/기존 판정 mock 규칙(픽스처 이메일·Google = 기존), 기존이어도 활성 필수 동의가 없으면 S-03 |
| S-03 | `policy-content.ts:25` | 필수/선택 구분: `terms`·`privacy_required`·`cross_border_transfer` 필수, `service_improvement`·`marketing` 선택. 국외 이전은 AI 기능 전제라 필수로 봄 |
| S-03 | `policy-content.ts:44` | 항목 라벨·설명 문구(서비스 개선 = 이용 기록만, 마케팅 = 이메일) |
| S-03 | `consent-form.tsx:74,158` | "모두 동의" 행, 필수 누락 안내 문구, "동의하지 않고 나가기"(→ S-01), 저장 실패 문구 |
| S-03 | `consent/page.tsx:47` | 화면 부제 문구 |
| S-30 | `policy-content.ts:114,188` | 본문 구조·문구 전체(확정 사실만 사용), 국외 이전 수령자 이름·국가는 "출시 전 확정"으로 둠(D-10) |
| S-30 | `policies/page.tsx:43,49` | 기본 탭 = 개인정보 처리방침, "출시 전 법무 검토" 안내 Alert(최종 문구 반영 시 제거) |
| S-30 | `policy-links.ts:6` | 탭 선택을 `?doc=`로 전달 |
| S-24 | `settings/page.tsx:21` | 화면 구성 전체(계정·동의 관리·AI 데이터 처리·처리방침·탈퇴) — 명세 "v3와 같음" |
| S-24 | `sign-out-button.tsx:10` | 로그아웃을 계정 섹션에 둠 |
| S-24 | `consent-settings.tsx:37,45,78` | 변경 실패 토스트, 변경 알림 문구, "필수 동의는 회원 탈퇴로만 철회" |
| S-25 | `withdraw-form.tsx:18,39,64` | 확인 문구 '탈퇴', 완료 토스트, 실패 문구 |
| S-25 | `account-data.ts:203` | 진행 중 AI 작업 취소 건수 표시(RPC 반환에 없음, 화면 보조 정보) |
| S-25 | `account-data.ts:211` | mock 탈퇴 = 스토어 재시드 |
| 공통 | `account-data.ts:4` | 계정 데이터 계층을 영역 폴더에 임시로 둠(아래 파운데이션 요청 1) |

## 기획 확인 필요

| 화면 ID | 질문 | 스펙 위치 |
|---------|------|-----------|
| S-01·S-02·S-03·S-24·S-30 | "v3와 같음"인데 v3 문서가 저장소에 없음. 랜딩 제목, 로그인·동의 화면 문구, 설정 구성, 처리방침 본문의 원본 필요 | 02 §3 S-01~S-03, S-24, S-30 |
| S-03 | 5개 `consent_type` 중 무엇이 필수인지(특히 `cross_border_transfer`), 선택 항목(`service_improvement`·`marketing`)의 라벨·설명 | 04 A.2, PRD F-COM-02 |
| S-03 | 정책 버전 갱신 시 재동의 화면(진입 시점, 문구, 거부 시 처리) | 04 §2.1 |
| S-24 | 필수 동의 철회를 화면에서 허용하는지(현재: 탈퇴로만) | 04 A.2 RLS "update는 선택 동의의 withdrawn_at만" |
| S-25 | 확인 문구(입력 단어 또는 체크) 확정. 사용량 기록(`usage_events`)도 탈퇴 즉시 삭제가 맞는지(DM-1 연쇄 vs 4.4 "13개월") — 재가입으로 월 한도를 우회할 수 있음 | 02 FL-07, 04 DM-1·§4.4 |
| S-30 | 국외 이전 수령자(제공자 이름·국가·보관 기간) 고지 문구 | PRD D-10 |
| S-02 | 매직 링크 유효 시간·재발송 간격 | PRD F-COM-01 |

## 파운데이션 요청

1. **`src/lib/data/account.ts` 신설**: 인증(`sendMagicLink`, `completeSignIn`, `signInWithGoogle`, `signOut`), 동의(`getConsentStatuses`, `recordConsents`, `setOptionalConsent`), `getAccountDeletionSummary()`(RPC), `deleteAccount()`. 현재 `src/components/account/account-data.ts`에 같은 시그니처로 임시 구현 — 옮기면 A1은 import만 바꾼다.
2. **`routes.policies(doc?: PolicyType)`**: S-30 탭 지정. 지금은 `policyHref()`가 `?doc=`를 붙임.
3. **픽스처 `policy_versions`**(비사용자 테이블) 추가. 지금은 `policy-content.ts`의 `MOCK_POLICY_VERSIONS`.
4. **픽스처 동의 이력 날짜**: `consents`가 120일 전 동의인데 `policy_version`이 `2026-10-01`(동의일보다 뒤). 동의일을 시행일 이후로 맞추거나 버전을 이전 값으로.
5. **ST-UNAUTH "로그인" 버튼**에 현재 경로를 `routes.signIn()` + `?next=`로 넘기면 "로그인 후 원래 URL"(1.3, S-02)이 이어짐(routes.signIn에 next 인자 추가 권장).
6. (선택) mock 세션 상태(로그인 여부) — 로그아웃·탈퇴 후 셸 접근 차단을 흉내 내려면 필요.

## 검사 결과

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` — 통과
- `pnpm build` — 통과(36페이지). 첫 시도에서 A4 파일 `src/components/interviews/answer-sheet.tsx`의 TS2448/TS2454(`previewRetried` 선언 전 사용)로 실패했으나 A4 쪽 수정 후 재실행에서 통과 — A1 파일과 무관
- `pnpm dev`(포트 3107) 요청: `/`, `/sign-in`, `/sign-in?state=sent`, `/sign-in?state=link-expired&next=/board`, `/consent`, `/consent?state=unauth`, `/policies`, `/policies?doc=terms`, `/settings`, `/settings?state=loading`, `/settings/withdraw`, `/settings/withdraw?state=empty` 모두 200, 개발 로그 오류 0건

---

## 라운드 1 수정 (QA `03_ui-qa_A1_review.md` 반영, 2026-10-25)

### 이슈별 처리

| ID | 심각도 | 처리 | 내용 |
|----|--------|------|------|
| UQ-90 | Major(기획) | 보류 · 표시만 | 기획 결정 대기(리더 지시). 문구는 그대로 두고 두 곳에 `// [UI-가정] UQ-90` 주석: `deletion-summary.tsx`("사용량 기록도 함께 삭제", 04 DM-1 기준), `policy-content.ts`("사용량 기록 13개월", 04 §4.4 기준). 결정 후 둘을 맞춤 |
| UQ-91 | Minor | 수정 | S-01 첫 가치 제안 제목을 명세 그대로 "커리어를 정리하고(AI와 대화로도)"로. 보조 문장은 겹치지 않게 다듬음 (`(public)/page.tsx`) |
| UQ-92 | Minor | 변경 없음 | QA 판정 "mock으로 수용 가능". 공용 dev 서버에서 탈퇴를 누르지 않도록 하는 안내는 리더 몫, mock 세션 플래그는 파운데이션 요청 6과 함께 |
| UQ-93 | Minor | 수정 | S-24 필수 동의 행: 활성일 때만 `Check`(success), 기록이 없거나 철회됐으면 `CircleDashed`(muted) + "동의 기록 없음" (`consent-settings.tsx`) |
| UQ-94 | Minor | 수정 | S-30 맨 위에 "돌아가기" 링크 추가(`policies-back-link.tsx`): 이전 페이지가 이 앱이면 `router.back()`, 아니면 S-08. 라우트를 셸 안으로 옮길지는 리더 판단으로 남김 |
| UQ-95 | Minor | 파운데이션 | 수정 안 함(파운데이션 배치). 옮길 때 참고: 동의 항목 정의·`MOCK_POLICY_VERSIONS`는 lib로, 클라이언트의 `currentPolicyVersion()`은 페이지 prop으로, `running_ai_jobs`는 RPC 반환과 분리 |
| UQ-96 | Minor | 수정 | S-02 "다른 이메일로 받기" 뒤 이메일 입력에 포커스(`form.setFocus("email")`, 렌더 뒤 effect에서) |
| UQ-97 | Minor | 수정 | S-03 필수 누락 오류 문구에 `id="consent-missing-error"`, 누락된 체크박스의 `aria-describedby`가 설명 + 오류 문구를 함께 가리킴 |
| UQ-98 | Minor | 수정 | S-03 "보기" 링크 터치 영역 `inline-flex min-h-11`(행 높이는 음수 여백으로 유지). S-24 필수 동의 "보기"도 좁은 화면 `min-h-11` |
| UQ-99 | Minor | 수정 | `next` 검사를 `safeNextPath` 하나로 통일(S-02·S-03 페이지도 사용). 배열 값 처리, `/sign-in`·`/consent`(하위 경로·쿼리 포함) 거부 → 로그인 고리 방지 |
| UQ-100 | Minor | 파운데이션 | 수정 안 함(`routes.signIn(next?)` + ST-UNAUTH, A1 요청 5와 같음) |
| UQ-101 | Minor | 수정 | 로그아웃: `router.replace(S-01)`, `try/finally`로 실패해도 로딩에 멈추지 않고 S-01로 이동 |
| UQ-102 | Minor | 수정 | S-25 처리 중에는 "취소"를 disabled `Button`으로 렌더(링크 대신). 실패하면 오류 문구(`tabIndex=-1`)로 포커스 이동 |
| UQ-103 | Minor | 파운데이션 | 수정 안 함(공통 `FieldError` 아이콘) |
| UQ-104 | Minor | 리더 결정 | S-24 = `max-w-form` 유지(구현이 이미 `max-w-3xl`). design-system.md 정정은 리더 |
| UQ-105 | Minor | 파운데이션 | 수정 안 함(공통 `tabs` 높이) |
| UQ-106 | Minor | 파운데이션 | 수정 안 함(픽스처 동의일, A1 요청 4와 같음) |
| UQ-107 | Minor | 수정 | S-03 "동의하지 않고 나가기"를 버튼으로: `signOutAction` 후 `router.replace(S-01)`(진행 중 로딩 표시, 다른 버튼 비활성) |

### 바뀐 파일

- `src/app/(public)/page.tsx`, `src/app/(public)/sign-in/page.tsx`, `src/app/(public)/consent/page.tsx`, `src/app/(public)/policies/page.tsx`
- `src/components/account/`: `account-data.ts`, `consent-form.tsx`, `consent-settings.tsx`, `sign-in-form.tsx`, `sign-out-button.tsx`, `withdraw-form.tsx`, `deletion-summary.tsx`, `policy-content.ts`, 신규 `policies-back-link.tsx`
- lib/, types/, components/common/, components/ui/ 수정 없음

### 새 [UI-가정]

| 화면 ID | 파일 | 내용 |
|---------|------|------|
| S-30 | `policies-back-link.tsx` | "돌아가기" 대체 목적지 S-08(QA 권장) |
| S-24 | `sign-out-button.tsx` | 로그아웃 실패를 표시하지 않고 S-01로 이동 |
| S-25 / S-30 | `deletion-summary.tsx`, `policy-content.ts` | UQ-90 문구 충돌 표시(기획 결정 대기) |

### 검사 결과 (라운드 1)

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` — 통과
- `pnpm build` — 통과(36페이지). 다른 영역 실패 없음
- `pnpm exec next dev -p 3108`(확인 후 종료): `/`, `/sign-in?next=/sign-in`, `/sign-in?state=sent`, `/consent?next=/board`, `/policies`, `/settings`, `/settings/withdraw` 모두 200, 로그 오류 0, S-01 첫 줄 문구 렌더 확인. 브라우저 클릭(포커스 이동, 돌아가기, 나가기)은 QA 재확인 필요

---

## BYOK 반영 (2026-10-28)

기준: `_workspace/ui/05_brief_byok.md`, 플로우 v5.2(S-01·S-03·S-24·S-25·S-30·S-40·S-41·S-42, FL-07·FL-18~21, C-05 키 삭제, C-18~C-21), PRD v4.2(F-AI-01~09, F-COM-02/03/05 v4, NFR-KEY, NFR-PRV-06 v4.1), 데이터 모델 v4.1a, design-system v2(3.18~3.22, 5.1, 5.7, 6 A1), A0 "BYOK 파운데이션". 커밋하지 않음. 공통·ui·lib·types·셸 레이아웃·`(focus)/layout.tsx`는 수정하지 않음.

### 화면별

| 화면 | 라우트 | 지원 ?state= | 내용 |
|------|--------|--------------|------|
| S-40 AI 연결 | `/settings/ai` + 설정 다이얼로그 "AI 연결" | `loading` `error` `unauth` `ai-locked`(미연결) `key-invalid` `key-check` `no-active` `paused`(Claude 일시 중지) `recheck-failed` `save-failed`(활성 전환·키 삭제 실패) `ai-return`(C-18 복귀 배너) | `AiConnectionPanel`: 복귀 배너(FL-19, 연결되면 "돌아가기" default → `completeAiConnectReturn()`, 연결 전엔 "연결하지 않고 돌아가기"), 안내 문구, 활성 없음 경고, 공급자 카드 3개(Gemini → Claude → OpenAI, 상태 6종: 미연결·연결됨·활성·무효·확인 필요·다시 확인 중·일시 중지), 활성 라디오 + 전환 확인 AlertDialog(명세 문구, 재동의 필요하면 S-41 `mode=tier&activate=1`), 카드 메뉴(키 교체 / 다시 확인 / 등급 변경 / 데이터 사용 고지 다시 보기(C-21 읽기 전용 Dialog) / 키 삭제(C-05 "API 키 삭제" 문구 + 대시보드 링크)), 다시 확인 실패 시 카드 아래 C-20 inline, 사용량 입구(다이얼로그는 섹션 전환, 페이지는 S-42), Resumate 원칙 줄. 키 변경 후 `notifyAiConnectionChanged()` |
| S-41 키 연결 단계 | `/settings/ai/connect?provider=&mode=replace\|tier&activate=1` (`(focus)`) | `loading` `error` `unauth` `not-found` `step-consent` `step-key` `reconsent` `save-failed` `key-format` `key-rejected` `key-billing` `key-model` `key-limited` `key-quota` `success` `limited` | `KeyConnectFlow`: 상단 바(X 연결 그만두기 · 제목 · StepIndicator, 768 미만 "2 / 3 · 데이터 사용 동의"), 공급자 미지정이면 공급자 선택 카드, ① 등급(무료 Gift / 유료 CreditCard, Gemini 기본 무료·그 밖 유료), ② C-21 `DataUseConsent`(Gemini 무료 강조 상자 + 별도 체크, 저장 실패 줄), ③ 가이드 카드(단계·발급 페이지 새 탭·무료 제약/결제 필요 Alert·가이드 버전) + 비밀번호형 키 입력 + 검증(유료 "최대 5초"/무료 "최대 10초 정도"), 실패(저장 안 함: 형식·인증·결제·모델, 입력 유지 + 다시 붙여넣기·결제/업그레이드/대시보드 링크, 교체 중이면 "기존 키는 그대로 쓰여요"), 확인 보류(저장, needs_check, 일일 한도면 KST 시각), 성공("연결됐어요 · ••••1a2b", 첫 키면 "활성 공급자로 지정했어요" + C-19, 주 버튼 "{원래 기능}으로 돌아가기"/"AI 연결로 돌아가기"). 교체 = ③만, 등급 변경 = ①②만(→ `changeProviderTierAction`, `activate`면 활성 지정). 그만두기: 키 입력 중이면 확인 AlertDialog, 복귀 대상이 있으면 그 화면으로(FL-19 취소), 없으면 S-40. 단계가 바뀌면 단계 제목으로 포커스 |
| S-42 AI 사용량 | `/settings/ai/usage` + 다이얼로그 "AI 사용량" | `loading` `error`(본문 "다시 불러오기") `unauth` `ai-locked`(연결 전 C-18 영역형) `empty`(이번 달 기록 없음) | `AiUsagePanel`: 상시 고지(sticky, 닫기 없음, 공급자 대시보드 링크 3개), 기간 "{1일} ~ 오늘 (KST)", 합계 카드 3칸, 기능별 표 8행 고정 순서(0 행 흐림, 머리 정렬 버튼 `aria-sort`, 768 미만 두 줄 행 + 정렬 Select), 공급자별 표(등급 Badge, 무료 등급 행 아래 안내), 가격표 정보 + "가격표 보기" 펼침, 포함 범위·반영 지연 안내. 키를 지워도 기록이 있으면 표를 보임 |
| S-24 설정 | 다이얼로그 + `/settings` | 기존과 같음 | 계정 섹션에 "AI 연결" 한 줄(`AiStatusLine`: "연결 안 됨" / C-19 배지 모양 + `••••1a2b`, 다이얼로그는 섹션 전환·페이지는 S-40) — UQ-201. AI 데이터 처리 섹션: F-COM-03 v4 문구 유지 + "연결한 공급자의 데이터 사용 고지 다시 보기"(→ AI 연결 섹션/S-40) — UQ-201. `/settings` 카드에서는 S-40/S-42 패널을 page 변형으로(링크 이동) |
| S-25 회원 탈퇴 | `/settings/withdraw` | 기존과 같음 | 삭제 범위에 "AI 연결" 묶음(등록한 API 키 N · 토큰 사용 기록 N · AI 연결 동의 이력 N) + 요약 줄 "API 키는 즉시 파기되고, 서비스 동의 이력과 AI 토큰 사용 기록도 함께 삭제돼요" + Alert info "공급자 사이트에서도 키를 폐기하는 것을 권해요" + 공급자 대시보드 링크 3개 — UQ-200 |
| S-03 동의 | `/consent` | 기존과 같음 | 리더가 `consent-items.ts`에서 `cross_border_transfer`를 뺀 뒤 서비스 동의 4개(필수 2·선택 2)만 표시. AI 처리 고지 상자 삭제 → 명세 한 줄 "AI 기능은 선택이에요. 쓰려면 나중에 본인 AI 키를 연결하고, 그때 공급자별 데이터 사용에 동의해요"(meta + Info) + 약관 버전 |
| S-01 랜딩 | `/` | — | 가치 제안 3줄을 v5 문구로("커리어를 정리하고 / 기업 JD를 모아 지원 현황 보드로 관리하고 / 원하면 내 AI 키를 연결해 인사이트·서류·면접까지") + "AI는 본인 키(OpenAI·Gemini·Claude)로 쓰고, Gemini는 무료 키로 시작할 수 있어요" |
| S-30 처리방침·약관 | `/policies` | 기존과 같음 | 처리방침 수집 항목에 API 키(암호화·마지막 4자리)·토큰 사용 기록, 보유 기간에 "API 키 즉시 파기", "AI 토큰 사용 기록 13개월(탈퇴하면 즉시 삭제)". 국외 이전 고지 문서를 BYOK로 다시 씀(키를 연결하고 실행할 때만 전송, 활성 공급자 1곳, 공급자별 세부는 연결 때 C-21, 동의하지 않아도 가입·비 AI 기능 사용 가능) |

- 한도 문구: A1 폴더에 "N회 남음"·"/10"·차감 문구 없음(grep 확인). 남은 "한도"는 공급자 한도(C-20·무료 등급 설명)와 약관의 "별도 한도나 요금을 두지 않아요"뿐.
- UQ-90 해소: PRD NFR-PRV-06 v4.1("AI 사용 기록 13개월 보관, 탈퇴 시 즉시 삭제 `[가정]`")로 S-25·S-30 문구를 맞추고 UQ-90 `[UI-가정]` 주석을 지움.

### 파일

- 신규: `src/components/account/ai-format.ts`, `provider-card.tsx`(ProviderCardFrame·상태 줄·정적 연결 배지·추천 배지·KeyMask), `key-connect-flow.tsx`(S-41), `ai-status-line.tsx`(S-24)
- 교체: `src/components/account/ai-connection-panel.tsx`(S-40), `ai-usage-panel.tsx`(S-42), `src/app/(focus)/settings/ai/connect/page.tsx`
- 수정: `account/actions.ts`(`getAiPriceTablesAction`, `needsDataUseConsentAction`, `getRunningAiJobCountAction` — lib/data 함수를 감싸기만), `settings-sections.tsx`, `deletion-summary.tsx`, `consent-form.tsx`, `policy-content.ts`, `src/app/(public)/page.tsx`, `src/app/(dashboard)/settings/ai/page.tsx`, `settings/ai/usage/page.tsx`(`preview` 전달)

### 설계 메모

- 다이얼로그는 Suspense 밖이라 S-40/S-42 패널은 `?state=`를 직접 읽지 않고, 페이지가 `preview` prop으로 넘긴다. `?state=`를 읽는 공통 컴포넌트(`AiErrorNotice`, `AiLock`)는 패널 안 지역 `<Suspense>`로 감쌈. 다이얼로그 안 링크는 `onNavigate`로 닫고, `AiLock` 링크는 클릭 캡처로 닫음.
- S-40 카드의 C-19 배지는 링크가 아닌 같은 모양(`StaticConnectionBadge`)으로 그림 — S-40 자신이 배지 링크 목적지라서.

### [UI-가정] (BYOK)

| 화면 | 파일 | 내용 |
|------|------|------|
| S-01 | `(public)/page.tsx` | v5 가치 제안의 보조 문장, AI 줄 아이콘 `Sparkles` |
| S-40 | `ai-connection-panel.tsx` | 불러오기 실패 문구, 다시 확인 성공 토스트, 전환 확인 제목 "활성 공급자를 바꿀까요?"·버튼 "바꾸기", 전환·삭제 완료 토스트, 연결 전 복귀 배너의 "연결하지 않고 돌아가기" |
| S-40 | `ai-connection-panel.tsx` | 키 삭제의 "진행 중인 AI 작업 N건"은 활성 공급자 키를 지울 때만, N=0이면 그 줄 숨김. 무효 키는 활성 라디오 선택 불가 |
| S-40 | `ai-connection-panel.tsx` | 재동의가 필요한 활성 전환은 S-41 `mode=tier&activate=1`(①②) → 끝나면 활성 지정 |
| S-40 | `provider-card.tsx` | 카드 안 C-19는 링크 없는 같은 모양, 추천 배지는 `recommend` variant가 없어 같은 토큰을 className으로 |
| S-41 | `key-connect-flow.tsx` | 등급 카드 설명 2줄, 등급 자동 판별 불가 안내 문구, 가이드 단계 문구(공급자별), 등록 중 `key_invalid` 문구 "{공급자}가 이 키를 인증하지 않았어요…", 등급 변경 완료 문구, 확인 보류 보조 문구, `mode`인데 키가 없으면 전체 흐름 |
| S-41 | `key-connect-flow.tsx` | 그만두기: 복귀 대상이 있으면 그 화면(FL-19 취소)으로 + 대상 지움, 없으면 S-40. 키를 입력했을 때만 확인 창 |
| S-41 | `(focus)` | 좁은 화면도 집중 화면(파운데이션 가정 유지, design-system 5.7은 <1024 셸 안 페이지) |
| S-42 | `ai-usage-panel.tsx` | 오류 문구, 공급자별 기록 없음 문구, 가격표 펼침, "입력 토큰" 합계 = 입력 + 캐시 입력 + 캐시 쓰기 |
| S-24 | `settings-sections.tsx` | "고지 다시 보기"는 S-40(카드 메뉴에서 공급자별 읽기 전용 고지)로 보냄 |
| S-25 | `deletion-summary.tsx` | 키 폐기 권고 Alert는 키가 1개 이상일 때만, 대시보드 링크는 세 공급자 모두 |
| S-30 | `policy-content.ts` | 국외 이전 고지 문서 BYOK 문구 전체(법무 확정 전) |

### 기획 확인 필요 (BYOK)

| 화면 | 질문 | 스펙 위치 |
|------|------|-----------|
| S-24 | "S-40 고지 다시 보기 링크"가 가리킬 대상 — 활성 공급자의 고지를 바로 열지, S-40으로만 보낼지 | 02 S-24 v5 |
| S-40 | 활성 전환 시 "등급·고지 버전이 다르면 재동의"의 비교 기준(현재 활성 공급자의 동의와 비교인지, 대상 공급자의 기존 동의와 비교인지). 구현: 대상 공급자 × 키 등급의 현재 고지 동의 여부(`needsDataUseConsent`) | 02 S-40, FL-20 |
| S-40 | 무효(`invalid`) 키를 활성으로 고를 수 있는지(구현: 불가, 키 교체 먼저) | 02 S-40 |
| S-41 | 등록 중 인증 실패(`key_invalid`) 문구 — C-20 `key_invalid` 문구("더 이상 작동하지 않아요")가 새 키에 맞지 않음 | 02 S-41 ③ 실패 |
| S-41 | 넓은 화면 집중 화면 / 좁은 화면 셸 안 페이지 구분을 지킬지(지금은 모두 집중 화면) | design-system 5.7, 02 S-41 |
| S-25 | AI 연결 동의 이력은 "D-DM-02 보관 정책에 따름"인데 04 §2.11에 "탈퇴 시 삭제"로 되어 있어 "함께 삭제돼요"로 씀. 맞는지 | 02 S-25 v5, 04 §2.11 |

### 파운데이션 요청 (BYOK)

1. (완료 — 리더 반영) `consent-items.ts`에서 `cross_border_transfer`를 가입 동의에서 제외.
2. `routes.aiConnect()`에 `activate?: boolean` 추가(지금은 `connectHref()`가 `&activate=1`을 붙임).
3. `lib/data/actions.ts`에 `getAiPriceTablesAction`, `needsDataUseConsentAction`, `getRunningAiJobCountAction`(공급자별이면 더 좋음) 추가 — 지금은 `account/actions.ts`에서 감쌈.
4. `ui/badge.tsx`에 design-system `recommend` variant 추가.
5. `getRunningAiJobCount`를 공급자별로(`provider` 인자) — S-40 키 삭제 문구의 N.
6. `DeleteConfirmDialog`에 `provider_key` 대상 추가 여부 판단(지금은 A1이 같은 모양의 AlertDialog를 직접 그림).

### 검사 결과 (BYOK)

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` — 통과
- `pnpm build` — 통과(39페이지)
- `pnpm exec next dev -p 3139`(확인 후 종료, 3000 미사용): `/`, `/consent`, `/policies?doc=cross_border_transfer`, `/settings`, `/settings/withdraw`, `/settings/ai`(기본·ai-locked·key-invalid·no-active·paused), `/settings/ai/usage`(기본·ai-locked·empty·error), `/settings/ai/connect`(공급자 선택·gemini·step-key·anthropic key-billing·mode=replace·mode=tier success·limited) 모두 200, 로그 오류 0. 서버 렌더 문구 확인: S-25 "AI 연결"·폐기 권고·"등록한 API 키", S-03 한 줄 고지(국외 이전 항목 없음), S-41 등급 질문·단계 표시·공급자 선택·결제 오류·확인 보류, S-01 "본인 키", S-24 "고지 다시 보기". S-40/S-42 본문은 클라이언트에서 불러와 브라우저 확인 필요(카드 상태·메뉴·전환 확인·키 삭제·다이얼로그 섹션 전환·FL-19 복귀·포커스 이동)

---

## BYOK 라운드 1 수정 (QA `06_ui-qa_byok_A1_review.md` 반영, 2026-10-28)

| ID | 처리 | 내용 |
|----|------|------|
| UQ-260 | 수정 | S-40 복귀 배너, S-41 성공 주 버튼의 "{기능}으로"를 `directionParticle()`로(인사이트로 / 자기소개서로 / AI 작성 대화로 …) |
| UQ-261 | 수정 | S-41 등급 변경 완료 "{등급}(으)로" → `directionParticle()`("무료 등급으로" / "유료로") |
| UQ-262 | 파운데이션 | 수정 안 함(`CONNECTION_TIER_LABELS` 짝) |
| UQ-263 | 수정 | 교체(③만) 중 검증이 예외로 끝나면 `needsDataUseConsentAction()`으로 실제 동의 필요 여부를 확인해 그럴 때만 ②를 단계에 넣음(단계 = ②③, 단계 표시·"이전" 정상). 그 밖의 예외는 입력란 아래 저장 실패 줄(`submitFailedMessage("키")`). 단계 위치는 `Math.max(0, …)`로 보호 |
| UQ-264 | 수정 | S-41 공급자 선택 카드: `ProviderCardFrame inButton` — 버튼 안은 span만(제목 요소·p 없음) |
| UQ-265 | 수정 | S-42 "기능별"·"공급자별" 제목 h3 → h2 |
| UQ-266 | 수정 | S-24 AI 연결 줄의 접근 이름에 상태 포함: "AI 연결: {C-19 문구}, 키 끝자리 1a2b. AI 연결 설정 열기" / "AI 연결: 연결 안 됨. …" |
| UQ-267 | 수정 | S-40 카드 루트에 `id="provider-card-{provider}"` + `scroll-mt-24`(`providerCardId()` export). 카드는 클라이언트에서 불러오므로 준비되면 `#provider-card-…` 해시로 스크롤(페이지 변형). 파운데이션 UQ-208에서 배지 링크를 `/settings/ai#provider-card-{provider}`로 맞추면 닫힘 |
| UQ-268 | 수정 | 등급 변경(①②) 완료에도 `finishSuccess()` → `completeAiConnectReturn()`(도착 화면 버튼 강조) + 주 버튼이 실제 목적지 이름("{기능}으로 돌아가기"/"원래 화면으로 돌아가기"/"AI 연결로 돌아가기"). `leave()`는 결과가 있으면 항상 그 목적지로 |
| UQ-269 | 수정(부분) | 키 삭제 확인의 N = 그 공급자로 실행 중인 작업 수(`getRunningAiJobCountForProviderAction`, `listActiveAiJobs()`를 공급자로 거름). `listActiveAiJobs`는 요건 추출·대화 턴 작업을 빼므로 그만큼 적게 셀 수 있음 → 파운데이션 요청: 데이터 계층에 공급자별 집계 |
| UQ-270 | 수정 | S-42 가격표 단가를 소수 2~3자리로 통일(`formatUnitPrice`: 0.10 / 3.00 / 0.075), `tabular-nums` |

- 바뀐 파일: `src/components/account/`의 `key-connect-flow.tsx`, `ai-connection-panel.tsx`, `provider-card.tsx`, `ai-usage-panel.tsx`, `ai-status-line.tsx`, `ai-format.ts`, `actions.ts`
- 파운데이션 요청 추가: `getRunningAiJobCount(provider)`(모든 작업 종류 포함) — 기존 요청 5와 같음
- 검사: `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm build` 통과(39페이지). `pnpm exec next dev -p 3141`(확인 후 종료): `/settings`, `/settings/ai`, `/settings/ai/usage`, `/settings/ai/connect`(공급자 선택·gemini replace·gemini tier success·openai step-key) 200, 로그 오류 0, 공급자 선택 카드 버튼 안 h3 0개 확인. 교체 중 동의 필요 흐름·해시 스크롤·포커스는 브라우저 확인 필요
