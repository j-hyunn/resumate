# UI QA — A1 계정 BYOK (S-01, S-03, S-24, S-25, S-30, S-40, S-41, S-42) (라운드 1)

기준: 브리프 `05_brief_byok.md`, A1 보고 "BYOK 반영 (2026-10-28)", A0 보고 "BYOK 파운데이션", 파운데이션 리뷰 `06_ui-qa_byok_foundation_review.md`, 플로우 v5.2(S-01·S-03·S-24·S-25·S-30·S-40·S-41·S-42, C-05 키 삭제, C-21, FL-07·FL-18~21, D-UX-14~18), PRD v4.2(F-AI-01~09, F-COM-02/03, NFR-KEY, NFR-PRV-06 v4.1), 데이터 모델 v4.1a, 디자인 시스템 v2(3.18~3.21, 5.7, 6 A1). 이슈 ID는 UQ-260부터.

리더 결정이라 이슈로 보지 않은 것: S-41이 모든 폭에서 셸 없는 집중 화면이라는 점(그래서 좁은 화면 sticky 하단 동작 줄도 적용 안 함), S-40·S-42가 설정 다이얼로그 섹션이면서 라우트 페이지이기도 하다는 점, 공급자 로고가 없다는 점, S-03 v5에서 가입 동의에서 `cross_border_transfer`를 뺀 점.

파운데이션 리뷰에 이미 있는 항목은 다시 올리지 않았다: UQ-202~209, UQ-211(입력 토큰 합계 정의, C-20 live region, `text-xs` 안내 문장, C-19 경고 배지 목적지 등).

## 요약 — Critical 0 / Major 0 / Minor 11

- 기계 검사: lint 통과 · typecheck 통과 · build 통과(39페이지).
- dev 스모크: 포트 3613에서 확인하고 검수 후 종료했다. A1 URL 27개(요청한 21개 + `?state=` 변형)가 모두 200이고, 개발 로그 오류는 0이다.
- 서버 렌더로 확인한 것:
  - S-41: 단계 표시 "1 / 3 · 등급", "2 / 3 · 데이터 사용 동의", "3 / 3 · 키 등록". 교체 모드는 "1 / 1 · 키 등록" + "새 Gemini 키 등록".
  - S-41: 공급자 선택 + "이미 연결됨", "Gemini 키 형식이 아니에요", 확인 보류 "키는 연결됐어요…", 무료 가이드 "오후 4~5시에 다시 채워져요", C-21 무료 등급 별도 체크.
  - S-25: AI 연결 묶음, 키 폐기 권고.
  - S-03: v5 한 줄 고지만 있고 국외 이전 항목은 없음.
- 확인하지 못한 것:
  - S-40·S-42 본문은 클라이언트에서 불러오므로 코드 경로로만 확인했다.
  - Claude in Chrome 확장이 연결되지 않아 브라우저 클릭 검수를 하지 못했다. 카드 메뉴 → 키 삭제 AlertDialog, 활성 전환 확인, 다이얼로그 섹션 전환, FL-19 복귀, 포커스 이동이 여기에 해당한다.
- 이전 A1 이슈 재확인: UQ-200 해결, UQ-201 해결, UQ-90 해결(아래 "재확인 결과").
- 키 노출 점검:
  - 화면에는 `KeyMask`의 `••••{key_last4}`만 보인다. 입력란은 `type="password"`, `autoComplete="off"`, `spellCheck={false}`이다.
  - 저장에 성공하면 입력값을 비운다(`key-connect-flow.tsx:210`). 실패하면 명세대로 입력을 그대로 둔다.
  - mock은 `key_last4 = raw.slice(-4)`만 저장한다(`lib/data/ai-connection.ts:217-256`). 계정·데이터 계층 어디에도 `console.log`는 없다.
  - 예외: dev 미리보기(`?state=key-*`)는 가짜 키 문자열을 password 입력의 value로 서버에서 렌더한다. 실제 키가 아니므로 이슈로 보지 않았다.

## 화면별 점검표

| 화면 ID | Q1 요소·동작 | Q2 문구 | Q3–4 필드·타입 | Q5 이동 | Q6 상태 | Q9 접근성 | Q10 좁은 화면 |
|---------|-------------|---------|----------------|---------|---------|-----------|----------------|
| S-01 | ✅ | ✅ v5 문구 그대로 | — | ✅ | — | ✅ | ✅ |
| S-03 | ✅ 서비스 동의 4개(필수 2·선택 2) | ✅ "AI 기능은 선택이에요…" 그대로 | ✅ | ✅ | ✅ | ✅ | ✅ |
| S-24 | ✅ AI 연결 줄·AI 사용량 섹션·고지 다시 보기 | ✅ F-COM-03 v4 | ✅ | ✅ | ✅ | ⚠️ UQ-266 | ✅ |
| S-25 | ✅ AI 연결 묶음 + 폐기 권고 + 대시보드 링크 | ✅ | ✅ `summary.ai.*` | ✅ | ✅ | ✅ | ✅ |
| S-30 | ✅ BYOK 국외 이전 고지·보유 기간 | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| S-40 | ✅ 카드 상태 6종·활성 라디오·전환 확인·재동의·카드 메뉴 5개·C-05 키 삭제·사용량 입구·원칙 | ⚠️ UQ-260 | ✅ `ai_provider_keys_public` 필드만 | ⚠️ UQ-267 | ✅ loading·error·unauth·ai-locked·key-invalid·key-check·no-active·paused·recheck-failed·save-failed·ai-return | ✅ (브라우저 미확인) | ✅ |
| S-41 | ✅ 공급자 선택·①②③·교체 ③만·등급 변경 ①②만·저장 안 함 실패 4종·확인 보류 저장·성공·그만두기 확인 | ⚠️ UQ-260, UQ-261, UQ-268 | ✅ | ⚠️ UQ-263 | ✅ 16개 미리보기 | ⚠️ UQ-264 | — (집중 화면, 리더 결정) |
| S-42 | ✅ 상시 고지(닫기 없음)·기간·합계 3칸·기능별 8행(0 흐림, 정렬 `aria-sort`)·공급자별(무료 행 안내)·가격표 펼침·포함 범위·반영 지연 | ✅ | ✅ | ✅ | ✅ loading·error(다시 불러오기)·unauth·ai-locked(C-18 영역형 + 고지 유지)·empty·키 삭제 후 기록 유지 | ⚠️ UQ-265 | ✅ 두 줄 행 + 정렬 Select |

Q7(AI 응답 방식)은 키 확인 동기 호출만 해당한다. 유료 "최대 5초", 무료 "최대 10초 정도"가 맞다(S-40 다시 확인 중, S-41 검증 중). Q8(토큰)은 A1 폴더에 원색 사용이 없다. 남은 서비스 한도 문구("N회 남음", "/10", 차감 문구)도 없다.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-260 | Minor | A1 | S-40 복귀 배너, S-41 성공 주 버튼 | 02 S-40 복귀 배너 "{원래 기능}으로 돌아가려면 AI를 연결해 주세요", S-41 ③ 성공 "**{원래 기능}으로 돌아가기**"(자리 표시 뒤 조사) | `src/components/account/ai-connection-panel.tsx:275`, `src/components/account/key-connect-flow.tsx:162` | 받침에 따라 으로/로: 이미 있는 `directionParticle()`(`lib/data/labels.ts:251`) 사용 | "으로"를 고정해서 실제 `feature_label` 대부분이 틀린다. "인사이트으로", "자기소개서으로", "AI 작성 대화으로", "요건 정리으로", "AI와 상세 내용 추가으로"가 나온다. FL-19 핵심 경로의 주 버튼 글자다 |
| UQ-261 | Minor | A1 | S-41 등급 변경 완료 | 문구 규칙(조사) | `src/components/account/key-connect-flow.tsx:690` | "무료 등급으로 바꿨어요" / "유료로 바꿨어요" | `{등급}(으)로 바꿨어요`. 라벨이 고정 두 값이라 조사를 정할 수 있는데 "(으)로"를 그대로 보인다 |
| UQ-262 | Minor | foundation | S-40·S-41·S-42 등급 표기 | 02 S-41 ① "무료 / 유료", C-19 배지 "Gemini · 무료 등급"(디자인 3.19) | `src/lib/data/labels.ts:84-87` `CONNECTION_TIER_LABELS = { free: "무료 등급", paid: "유료" }` | 두 값이 같은 형식("무료 등급"/"유료 등급" 또는 "무료"/"유료") | 짝이 맞지 않는다. S-41 ① 카드 제목이 "무료 등급 / 유료", S-40 상태 줄이 "… · 유료", 전환 확인이 "Claude(유료)로" / "Gemini(무료 등급)로", S-42 등급 배지도 섞여 보인다 |
| UQ-263 | Minor | A1 | S-41 교체(③만) 중 동의 필요 | 02 S-41 "교체는 ③만", 04 `save_provider_key` "유효한 동의가 없으면 거부" | `src/components/account/key-connect-flow.tsx:217-220`, `:100`, `:302`, `:455` | 교체 중 `consent_required`면 ②를 단계에 넣거나(②③) 단계 표시를 다시 계산 | `catch`가 무조건 `setStep("consent")` → `steps = ["key"]`라 `stepIndex = -1`. 좁은 화면은 "0 / 1 · undefined", 넓은 화면은 현재 단계 없음이 된다. ②의 "이전"은 단계에 없는 ①로 간다. 고지 버전이 바뀐 뒤 교체할 때 생긴다. 또 `catch`가 모든 예외(저장 실패·네트워크)를 "동의 필요"로 취급해 오류 문구 없이 ②로 보낸다 → `AiConnectionError("consent_required")`일 때만 ②, 나머지는 실패 줄 |
| UQ-264 | Minor | A1 | S-41 공급자 선택 | 디자인 5.7 "카드 전체가 선택 버튼", HTML 내용 모델(버튼 안에는 phrasing content만) | `src/components/account/key-connect-flow.tsx:481-503` → `provider-card.tsx:195` `<h3>` | 버튼 안에 제목 요소를 두지 않는다(카드 이름은 `span`, 또는 `RadioGroup` 카드형) | `<button>` 안에 `<h3>`, `<p>`, 배지가 들어 있다. 스크린 리더는 버튼 이름을 카드 전체 글자로 이어 읽고, 제목 탐색에서 공급자 이름이 빠지거나 두 번 잡힌다 |
| UQ-265 | Minor | A1 | S-42 | 디자인 7 A-3(제목 계층), 5.7 section-title "기능별"/"공급자별" | `src/components/account/ai-usage-panel.tsx:249, 315` | 페이지 h1 아래 h2 | `PageHeader`(h1) 바로 아래가 `h3`("기능별"·"공급자별")라 h2를 건너뛴다. 다이얼로그 안에서도 섹션 제목 바로 아래 같은 문제 |
| UQ-266 | Minor | A1 | S-24 AI 연결 줄 | 02 S-24 v5 "현재 상태 한 줄: '연결 안 됨' / C-19 배지 + 마지막 4자리", 디자인 A-7 | `src/components/account/ai-status-line.tsx:57, 62` | 접근 이름에 상태가 들어간다(예: "AI 연결: Gemini · 무료 등급 ••••1a2b. 설정 열기") | `aria-label="AI 연결 설정 열기"`가 내용을 덮어써서 스크린 리더는 연결 상태(연결 안 됨·배지·마지막 4자리)를 듣지 못한다. C-19 배지는 같은 경우 상태를 aria-label에 넣었다(`provider-badge.tsx:62`) |
| UQ-267 | Minor | A1 | S-40 카드 앵커 | 02 C-19 경고 상태 "클릭 → **S-40 해당 카드**"(파운데이션 UQ-208에서 "A1이 S-40 카드 id를 맞출 것") | `src/components/account/provider-card.tsx:185-191` | 카드 루트에 `id="{provider}"`(또는 정한 앵커)와 `scroll-mt` | 카드에 id가 없어 파운데이션이 링크를 `/settings/ai#gemini`로 바꿔도 해당 카드로 갈 수 없다. UQ-208(foundation)과 같이 닫아야 함 |
| UQ-268 | Minor | A1 | S-41 등급 변경(①②) 완료 | FL-19 복귀, 02 S-41 성공 주 버튼 규칙 | `src/components/account/key-connect-flow.tsx:143-152, 256, 693` | 복귀 대상이 있으면 주 버튼 글자가 그 목적지를 말하고, 도착하면 풀린 버튼을 강조(`completeAiConnectReturn`) | `tier_done`이면 `finishSuccess()`를 부르지 않아 버튼은 늘 "AI 연결로 돌아가기"다. 그런데 `leave()`는 복귀 대상이 있으면 `clearAiConnectReturn()` 후 원래 기능 화면으로 보낸다. 글자와 목적지가 다르고 강조도 없다(C-18 → S-40 → 재동의가 필요한 활성 전환 → S-41 ①② 경로) |
| UQ-269 | Minor | A1 | S-40 키 삭제 확인 | 02 C-05 "API 키 삭제": "진행 중인 AI 작업 {N}건은 실패로 끝나고…" | `src/components/account/ai-connection-panel.tsx:576-590, 627-629` | 그 공급자로 실행 중인 작업 수 | 전체 실행 중 작업 수(`getRunningAiJobCountAction`, 공급자 구분 없음)를 활성 카드일 때만 보인다. 활성 전환 직후에는 이전 공급자 작업이 남아 있어 수가 틀릴 수 있다. A1 파운데이션 요청 5(공급자별 집계)와 같이 처리하면 된다. 그 전까지 [UI-가정] 주석은 있다 |
| UQ-270 | Minor | A1 | S-42 가격표 펼침 | 디자인 5.7 "작은 Table (모델 · 입력/출력 $/MTok)", 금액 표기 규칙 | `src/components/account/ai-usage-panel.tsx:413-414` | 단가를 같은 자릿수로(예: `0.10`, `3.00`) + `tabular-nums` 정렬 | 원시 숫자(`0.1`, `3`, `0.075`)를 그대로 써서 소수 자릿수가 행마다 다르다 |

## 기획 확인 필요

A1 보고서의 "기획 확인 필요(BYOK)" 6건을 확인했고, 1건은 문서에서 답이 나온다.

| # | 내용 | 판단 |
|---|------|------|
| S-25 AI 연결 동의 이력 보존 | 04 §2.11.5 "보유: `consents`와 같다 — 탈퇴 시 삭제, 파기 증빙은 `account_deletion_logs`(비식별)만(D-DM-02 (b))" | **문서로 해결.** 지금의 "함께 삭제" 표기가 맞다. 기획에 올리지 않아도 된다 |
| S-24 고지 다시 보기 대상, S-40 재동의 비교 기준, 무효 키 활성 선택, S-41 `key_invalid` 등록 문구, 집중 화면/셸 페이지 구분 | 문서 공백 그대로 | A1 보고대로 유지(집중 화면은 리더 결정으로 닫힘) |

QA가 추가로 찾은 문서 공백은 없다.

## 재확인 결과

| ID | 결과 | 메모 |
|----|------|------|
| UQ-200 (Major, A1) | 해결 | `deletion-summary.tsx:34-64`: "AI 연결" 묶음(등록한 API 키 N · 토큰 사용 기록 N · AI 연결 동의 이력 N), 요약 줄 "API 키는 즉시 파기되고…", 키가 있을 때 Alert info "공급자 사이트에서도 키를 폐기하는 것을 권해요" + 대시보드 링크 3개. dev 렌더 확인 |
| UQ-201 (Minor, A1) | 해결 | `ai-status-line.tsx`: "연결 안 됨" / C-19 모양 배지 + `••••1a2b`. `settings-sections.tsx:71-87`: F-COM-03 v4 문구 + "연결한 공급자의 데이터 사용 고지 다시 보기"(다이얼로그는 섹션 전환, 페이지는 S-40). 접근 이름 문제는 새로 UQ-266으로 |
| UQ-90 (Major, 기획) | 해결 | PRD NFR-PRV-06 v4.1·D-DM-09("13개월 보관, 탈퇴 시 즉시 삭제")로 S-25(`deletion-summary.tsx:47`)·S-30(`policy-content.ts` 보유 기간 "AI 토큰 사용 기록 13개월(탈퇴하면 즉시 삭제)")이 같은 말을 한다 |

## 점검 메모 (이슈 아님)

- **S-40**
  - 카드 순서는 Gemini → Claude → OpenAI. Gemini만 추천 배지와 `default` "연결하기"를 쓴다.
  - 상태 줄 문구는 명세 그대로다(확인 필요·일시 중지 문구).
  - 무효 카드에는 "키 교체", 확인 필요 카드에는 "다시 확인"이 강조 동작으로 붙는다. 다시 확인 중에는 카드 메뉴가 `disabled`가 된다. 확인에 실패하면 카드 아래에 C-20 inline이 붙는다.
  - 활성 라디오는 저장 전까지 원래 값을 유지한다. 전환 확인 문구는 명세 그대로이고, 재동의가 필요하면 S-41 `mode=tier&activate=1`로 간다.
  - 활성 없음 경고 문구가 명세와 같다.
  - 카드 메뉴 5개(일시 중지 카드는 고지 다시 보기와 삭제만 남음). 키 삭제는 C-05 문구, 활성 카드면 잠금 안내, 대시보드 외부 링크를 갖는다.
  - 사용량 입구는 다이얼로그에서는 섹션 전환, 페이지에서는 S-42로 간다. 원칙 문구가 명세와 같다.
- **S-41**
  - 고지·동의 없이 ③으로 못 간다. 클라이언트는 단계 순서로, 서버는 `consent_required`로 막는다.
  - 실패 처리: 형식·인증·결제·모델 실패는 저장하지 않고 입력을 유지한다. "키 다시 붙여넣기"는 포커스 + 전체 선택을 한다. 결제는 결제 설정 링크, 모델은 업그레이드 링크, 대시보드 링크가 붙는다. 교체 중이면 "기존 키는 그대로 쓰여요"가 나온다.
  - 분당 한도·일일 한도는 `needs_check`로 저장하고 보류 화면을 보인다(일일 한도면 시각 줄).
  - 첫 키면 "활성 공급자로 지정했어요" + C-19를 보인다.
  - 그만두기: 키를 입력했을 때만 확인 창("연결을 그만둘까요? 입력한 키는 저장되지 않아요" / "그만두기")을 띄운다. 복귀 대상이 있으면 그 화면으로(FL-19 취소), 없으면 S-40으로 간다.
  - 단계가 바뀌면 단계 제목으로 포커스가 이동한다. 단계 표시는 `aria-current="step"`, 완료 단계는 sr-only "(완료)".
- **S-42**
  - 금액은 `$` + 소수 2자리, 0 < x < 0.01이면 "< $0.01". 토큰은 ko-KR 천 단위. 기간은 "{N}년 {M}월 1일 ~ 오늘 (KST)".
  - 무료 등급 행 안내 문구가 명세와 같다. 연결 전에도 상시 고지는 위에 남는다.
- **S-03 / S-01 / S-30**: 문구가 v5 명세와 글자까지 같다. S-30 국외 이전 고지에는 "동의하지 않아도 가입·비 AI 기능 사용 가능"이 들어 있다.

## 기계 검사 출력

- `pnpm lint` — `eslint` 오류·경고 0
- `pnpm typecheck` — `tsc --noEmit` 오류 0
- `pnpm build` — "Compiled successfully", "Generating static pages (39/39)". A1: `/` ○, `/consent` `/policies` `/settings` `/settings/ai` `/settings/ai/connect` `/settings/ai/usage` `/settings/withdraw` `/sign-in` ◐
- `pnpm exec next dev -p 3613`(검수 후 종료): 모두 200, 로그 오류 0
  - 공개 화면: `/`, `/sign-in`, `/consent`, `/policies`, `/policies?doc=cross_border_transfer`
  - 설정: `/settings`, `/settings/withdraw`
  - S-40: `/settings/ai`(기본·ai-locked·key-invalid·key-check·no-active·paused·ai-return)
  - S-42: `/settings/ai/usage`(기본·ai-locked·empty·error)
  - S-41: `/settings/ai/connect`(공급자 선택·gemini·step-consent·step-key·anthropic key-billing·gemini mode=replace·mode=tier success·openai limited·key-format)
- 브라우저: Claude in Chrome 확장 미연결로 실행하지 못함
