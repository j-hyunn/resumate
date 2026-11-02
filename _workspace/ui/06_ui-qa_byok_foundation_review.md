# UI QA — BYOK 파운데이션 (A0, 라운드 1)

- 검수일: 2026-10-28
- 기준:
  - 기획: PRD v4.2 · 플로우 v5.2 · AI v4.2 · 데이터 모델 v4.1a
  - 디자인 시스템 v2 (3.3, 3.18~3.22, 4장, 5.1, 5.7, 7장)
  - `_workspace/ui/05_brief_byok.md`, `02_frontend-engineer-A0_report.md` "BYOK 파운데이션 (2026-10-28)"
- 이슈 ID는 UQ-200부터 쓴다.
- 결정 사항이라 이슈에서 뺀 것:
  - 공급자 로고 없음
  - S-41은 모든 폭에서 셸 없는 집중 레이아웃
  - 공급자 URL은 lib의 mock 상수
  - S-40/S-42는 설정 다이얼로그 섹션 + 라우트 페이지
  - 영역 최소 수정 4곳(S-14/S-15/S-16/S-36)은 영역에서 다듬음
  - S-40/S-41/S-42 실제 내용은 A1 몫(지금은 자리 표시)

## 요약 — Critical 0 / Major 1 / Minor 10

**기계 검사**: `pnpm lint`, `pnpm typecheck`, `pnpm build` 모두 통과했다(39 페이지).

**dev 스모크**: `next dev -p 3125`로 띄우고 확인 후 종료했다(3000 포트는 건드리지 않음).
- 요청한 경로: `/dev/states`(state 없음 + 15개 `?state=`), `/settings`, `/settings/ai`, `/settings/ai/usage`(+`ai-locked`), `/settings/ai/connect`(+`?provider=gemini`), S-16(`ai-locked`, `ai-failed-daily-quota`), S-15(`ai-locked`), S-20(`key-invalid`), S-36 새 대화(`ai-locked`), S-14, S-25, `/career?state=ai-outage`
- 결과: 30개 경로 모두 200, 개발 로그의 `Error`/`⨯` 0건.
- 브라우저 확인: Claude in Chrome 미연결이라 못 했다. 서랍, 토스트, 카운트다운, FL-19 링은 코드를 읽어서만 확인했다.

**통과한 부분**:
- `types/db.ts`가 v4.1a와 이름·enum까지 일치한다(아래 표).
- 한도·차감 UI가 사용자에게 보이는 코드에서 완전히 사라졌다. 남은 것은 주석과 개발용 자리 표시 문구 1건(UQ-205)뿐이다.
- C-18~C-21, AiRunButton 문구가 02 C-18~C-21과 글자 그대로 같다.
- mock이 기본 Gemini 무료 연결, 7원인, `needs_check`, 순차 2배, 대기 줄, `retry_after`/`quota_resets_at`, 실행 중 키 삭제 → `key_missing`을 모두 재현한다.

이번 범위에 열린 Critical은 없다. Major 1건은 A1 영역 화면(S-25)의 누락이고, 파운데이션 공통 코드에는 Major가 없다.

## 점검표

| 대상 | 결과 | 메모 |
|------|------|------|
| `types/db.ts` vs 04 v4.1a | ✅ | 아래 "타입 대조" 참고 |
| 데이터 계층·mock | ✅ / ⚠️ UQ-203 | 키 RPC 4종 + 등급 변경, readiness `ai_connection`과 키 없음/무효 시 `next_action = 'form'`, 사용 기록, 사용량 요약 |
| C-18 `AiLock` / `AiLockDialog` | ✅ / ⚠️ UQ-206 | 제목·기능 설명 8종·추천 줄·대안이 명세와 같음. 목적지 규칙(키 없음 → S-41, 있음 → S-40)과 복귀 기억도 맞음. C-14 키 없음 변형은 stage-menu에 연결됨 |
| C-19 `ProviderBadge` / `ProviderResultTag` / `providerRunLabel` | ✅ / ⚠️ UQ-208 | 세 상태 글자·아이콘·툴팁·aria-label이 3.19와 같음. 결과 배지의 모델 ID는 포커스 가능한 툴팁에만 있음. 목록 열 규칙(질문/채점 공급자가 다르면 둘 다)도 맞음 |
| C-20 `AiErrorNotice` / `RetryButton` / `ExternalProviderLink` | ✅ / ⚠️ UQ-202 | 원인 7종 + key_missing + 시스템·입력 문구가 02와 같음. 톤·아이콘·동작 순서는 3.20 표와 같음. 차감 문구 삭제됨, 보존 줄 있음. 외부 링크는 `target=_blank rel=noopener noreferrer` + "(새 탭)". 카운트다운은 버튼 aria-label로 이름을 고정해 읽히지 않음 |
| C-21 `DataUseConsent` / `FreeTierNotice` | ✅ / ⚠️ UQ-211 | 동의 체크 두 개가 따로 있고 "모두 동의" 없음. 둘 다 체크해야 "다음" 활성. Label 연결됨. 강조 상자는 Collapsible 밖. 읽기 전용 "동의함 · 시각" 모드 있음 |
| AiRunButton (3.22) | ✅ / ⚠️ UQ-206, UQ-207 | 키 없음 → 인라인 잠금, 무효 → 눌러야 C-20 inline, 확인 필요 → 실행, 진행 중 → "이미 만들고 있어요", 다시 실행 주석, FL-19 링 4초 + 토스트 |
| C-03 무료 등급·대기 줄 | ✅ | 순차 안내 줄, 대기 중 `Hourglass` + "(n초)"(live 아님), 축약형 " · 대기 n초"(aria-hidden) |
| C-09 키 무효·대화 실패 분기 | ✅ | 02 C-09 v5 행과 같음 |
| NavAiStatus · 설정 다이얼로그 섹션 | ✅ | 상태 글자 "AI 연결 안 됨" / C-19 / "키를 확인해 주세요" / "확인 필요". 점 색만이 아니라 아이콘·글자도 다름. 레일에서는 툴팁. 누르면 다이얼로그 "AI 연결". 섹션 "AI 연결"·"AI 사용량" 있음 |
| 공급자별 장애 배너 (S-28) | ✅ | 활성 공급자가 영향받을 때만, 문구 02와 같음, 상태 페이지 외부 링크, 세션 동안 공급자별로 닫기 |
| 한도 UI 삭제 (src 전체 grep) | ✅ / ⚠️ UQ-205 | `UsageHint`·`LimitNotice`·`AiFailed`·`AI_NOT_CHARGED`·`usage_events`·`reserve_units`·"회 남음"·"/10회"·"사용량은 차감" 모두 사용자 코드에 없음 |
| `?state=`·`/dev/states` | ✅ / ⚠️ UQ-204 | 신규 값 모두 동작, `limit` 삭제됨 |
| S-24 / S-25 (A1, 파운데이션이 호출부만 정리) | ❌ UQ-200, ⚠️ UQ-201 | 아래 |

### 타입 대조 (04 v4.1a ↔ `src/types/db.ts`)

| 04 | 코드 | 결과 |
|----|------|------|
| AI 출력 공통 메타 `provider`·`model_tier`·`connection_tier` (insights, drafts, draft_sections, interview_questions, answer_evaluations, session_feedbacks, writing_chat_messages) | `AiOutputMeta` 상속 + `WritingChatMessage` 4컬럼 | ✅ |
| `job_descriptions.extraction_provider`/`extraction_model` | `:545-546` | ✅ |
| `interview_sessions.question_*`/`evaluation_*` 4컬럼 | `:747-751` | ✅ |
| `ai_jobs`: `provider`, `model_tier`, `connection_tier`, `retry_count`(attempt_count 이름 변경), `next_run_at`, `retry_wait_total_ms`, `progress.waiting_retry_until`, `failure_cause`, `quota_resets_at`, `retry_after`, `job_type`에 `key_verification` | `:873-914`, `:163-175` | ✅ |
| `error_code` 15값(model_unavailable·refused 삭제, key_missing 추가) / `error_category` 5값 / `failure_cause` 7값 | `:178-205`. `ai-errors.ts`의 생성 규칙이 2.9.1과 같음 | ✅ |
| `ai_usage_records`(updated_at 없음), `ai_price_tables`, `ai_provider_keys`(암호 컬럼 4개 + `encryption_version`), 뷰 `ai_provider_keys_public`, `ai_data_use_consents`, `ai_disclosures`, `ai_providers` | `:920-1040` | ✅. `ai_providers`의 status/key_issue/upgrade URL은 lib 상수에 둠(리더 결정) |
| `profiles.active_ai_provider` | `:247` | ✅ |
| 삭제: `usage_events`, `usage_limits`, `writing_chats.usage_event_id`, `UsageFeature` | 없음 | ✅ |
| `get_data_readiness().ai_connection`, `get_ai_usage_summary`(include_previous일 때만 previous_month), 탈퇴 요약 `ai` | `:1082-1090`, `:1157-1181`, `:1131-1154` | ✅. 탈퇴 요약 `ai` 키 이름은 `[UI-가정]`(04에 형태 없음, 보고서의 기획 확인과 같음) |

## 이슈

| ID | 심각도 | 담당 | 대상 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-200 | Major | A1 (리더: A1 작업 목록에 추가) | S-25 삭제 범위 | 02 S-25 v5: 삭제 범위에 "**AI 연결** — 등록한 API 키 N개(즉시 파기), 토큰 사용 기록, AI 연결 동의 이력" + 안내 "공급자 사이트에서도 키를 폐기하는 것을 권해요"(NFR-KEY-09) | `src/components/account/deletion-summary.tsx:10-40` (커리어·기업 JD 두 묶음만), dev 확인 `/settings/withdraw` | `summary.ai` 세 개수를 "AI 연결" 묶음으로 보여 주고, 키 폐기 권고 줄을 넣는다 | 데이터 계층은 `ai {provider_keys, data_use_consents, usage_records}`를 돌려주는데 화면에는 AI 연결 묶음과 폐기 권고가 없다. 파운데이션 보고서 "영역에 남은 BYOK 작업"의 A1 목록에도 S-25가 빠져 있어 그대로 두면 놓친다. (탈퇴 시 사용 기록 보존 여부 UQ-90은 기존 기획 확인 항목) |
| UQ-201 | Minor | A1 | S-24 개인정보 섹션 | 02 S-24 v5: AI 학습 고지 변경 + "**S-40 고지 다시 보기 링크**" / "AI 연결" 항목 "연결 안 됨 / C-19 배지 + 마지막 4자리" | `src/components/account/settings-sections.tsx:66-80`, dev `/settings` | 고지 아래 "AI 데이터 사용 고지 다시 보기"(→ S-40 / C-21 읽기 전용). AI 연결 항목에 배지 + 마지막 4자리 | 고지 문구는 v4로 바뀌었지만 다시 보기 링크가 없다. AI 연결 항목은 "활성 공급자 · 불러오는 중" 자리 표시. A1 작업 목록에 S-24 항목이 없으므로 함께 넣어야 함 |
| UQ-202 | Minor | foundation | C-20 live region | 디자인 3.20 "`aria-live="polite"`로 제목 문장을 **한 번** 알린다(A-6)", "카운트다운을 읽히지 않고" | `src/components/common/ai-error-notice.tsx:124-125`(rate_limited 제목에 `now`로 계산한 {N}분), `:333-339`(시각 줄 "약 N분 뒤"), `:475, 488, 510-511`(제목·시각 줄·동작을 통째로 감싼 live region) | live region에는 처음 정해진 제목만 두고, 시간이 지나며 바뀌는 글자는 그 밖에 둔다 | 버튼 카운트다운은 aria-label 덕분에 읽히지 않는다. 하지만 ① 첫 렌더(now = 0)의 "잠시 후 다시 시도해 주세요"가 hydration 뒤 "3분 뒤 …"로 바뀌고, ② 이후 1분마다 {N}이 줄고, ③ "· 약 N분 뒤"가 바뀔 때마다 polite 알림이 다시 나간다. 제목은 sr-only `role=status`로 한 번만 알리고(AiProgress 방식), 보이는 블록에서는 live를 빼는 것을 권장 |
| UQ-203 | Minor | foundation | S-42 데이터 (`get_ai_usage_summary`) | 04 §2.9.5 반환: `totals.input_tokens`와 `cached_input_tokens`·`cache_write_tokens`는 따로, `by_feature[].input_tokens`·`by_provider[].input_tokens` | `src/lib/data/ai-usage.ts:44` vs `:54, 63` | 합계 카드와 표의 "입력 토큰"이 같은 정의(같은 합) | 표 행은 입력 + 캐시 읽기 + 캐시 쓰기를 더하고, `totals.input_tokens`는 캐시를 빼서 S-42 합계 카드와 표 합이 맞지 않는다(`previous_month`도 캐시 제외). 정의를 하나로 정하고 주석으로 남길 것. 백엔드 RPC가 같은 규칙을 따르도록 기획·백엔드에 공유 필요 |
| UQ-204 | Minor | foundation | `?state=` 목록 | ui-context "every ST-xx state can be rendered" | `src/lib/preview-state.ts:11-45` | `/dev/states`가 쓰는 값은 모두 개발용 전환 메뉴에서 고를 수 있다 | `consent`(C-21 섹션)가 `PREVIEW_STATES`에 없어 메뉴에 안 나온다. `safety_blocked`는 `?state=` 값이 없어(`ai-failed-input-rejected` = input_too_long) 화면에서 확인하려면 갤러리 기본 화면을 봐야 한다 |
| UQ-205 | Minor | foundation | 자리 표시 화면 문구 | 02 공통 상태 ST-LIMIT 폐기(D-34) | `src/components/common/placeholder-screen.tsx:47` | 폐기된 상태 이름이 화면에 나오지 않는다 | 개발용 자리 표시 문구에 "ST-LIMIT 등"이 아직 보인다(30여 개 자리 표시 화면 공통) |
| UQ-206 | Minor | foundation | C-18 / AiRunButton 글자 크기 | 디자인 3.18 인라인형 기능 설명·추천·대안 = `meta`(text-sm 14px), 3.22 "이미 만들고 있어요" = `meta` / 1.2 caption(12px)은 칩·배지용 | `src/components/common/ai-lock.tsx:128, 160, 171, 208`, `src/components/common/ai-run-button.tsx:147, 152` | `text-sm leading-5 text-muted-foreground` | `text-xs`(12px)를 써서 안내 문장이 caption 크기로 작아졌다(본문 16px 기준에서 두 단계 아래) |
| UQ-207 | Minor | foundation | AiRunButton 로딩 중 | 02 실행 버튼 공통 규칙 "키가 없으면 버튼 자리가 C-18 잠금", FL-08 키 확인이 먼저 | `src/components/common/ai-run-button.tsx:97`, `ai-connection-context.tsx:69-78` | 연결 상태를 불러오기 전에는 실행 버튼을 비활성(또는 로딩)으로 두거나 서버에서 받은 `connection`을 우선 쓴다 | 첫 fetch 전(`connection = null`)에는 잠기지 않은 버튼이 눌린다. 키 없는 사용자가 빨리 누르면 C-18 대신 서버 거절(`key_missing`/locked) 경로로 간다. 서버 검사가 있어서 실행되지는 않음 |
| UQ-208 | Minor | foundation | C-19 경고 배지 목적지 | 02 C-19 경고 상태: "클릭 → **S-40 해당 카드**" | `src/components/common/provider-badge.tsx:60-61` | `invalid`/`needs_check`면 S-40의 해당 공급자 카드로(예: `/settings/ai#gemini` 또는 `?provider=`) | 모든 상태에서 `/settings/ai` 맨 위로 간다. A1이 S-40 카드를 만들 때 앵커를 맞추면 된다(파운데이션은 링크만 바꿈) |
| UQ-209 | Minor | foundation | 문구 상수 중복 | F-COM-03 v4 문구 1개 | `src/components/account/policy-content.ts:35` `AI_TRAINING_NOTICE` ↔ `src/components/common/data-use-consent.tsx:26` `RESUMATE_AI_PRINCIPLE` | 한 곳에 두고 가져다 쓴다 | 같은 문장이 두 상수에 있다. 법무 확정 뒤 문구가 바뀌면 한쪽만 고쳐질 위험 |
| UQ-211 | Minor | foundation | C-21 "다음" 비활성 이유 | 디자인 3.21 "비활성일 때는 이유를 버튼 위 meta로" + 7장 A-10 | `src/components/common/data-use-consent.tsx:187, 195` | 이유 문장이 `aria-describedby`로 버튼에 연결된다 | 문장은 보이지만 연결이 없어 스크린 리더 사용자는 비활성 이유를 듣지 못한다. 문장도 `text-xs`(UQ-206과 같은 문제) |

(UQ-210은 표 대신 아래 기획 확인 P-B1로 옮겼다. 번호는 다시 쓰지 않는다.)

## 기획 확인 필요 (`기획`)

A0 보고서의 "기획 확인 필요" 5건(결과 배지 조사 "기본로", daily_quota 유료 문구, C-09 키 없음 시 C-20 줄, C-14 키 없음 + 작성 중 세션 우선순위, 탈퇴 요약 `ai` 노출)을 확인했다. 모두 실제 문서 공백이나 모순이 맞다. QA가 추가로 찾은 것:

| # | 대상 | 양쪽 인용 |
|---|------|-----------|
| P-B1 (UQ-210) | C-20 외부 링크 범위 | 02 C-20 공통 "각 안내에 **공급자 대시보드 링크**" ↔ 같은 표의 행별 버튼(billing_required = 결제 페이지, model_not_available = 업그레이드 안내, provider_unavailable = 상태 페이지, input_rejected·시스템 = 링크 없음). 디자인 3.20도 행별 표를 따랐다. 구현은 표대로 했다(`ai-error-notice.tsx:375-459`). 공통 문장과 표 중 어느 쪽이 맞는지 확인 필요 |
| P-B2 | S-42 입력 토큰 정의 | 04 §2.9.5 `totals`는 `input_tokens`·`cached_input_tokens`·`cache_write_tokens`를 나누는데, `by_feature`/`by_provider`는 `input_tokens` 하나뿐이다. 행의 입력 토큰에 캐시를 넣는지 정의가 없다(UQ-203과 연결) |

## 영역 이관 확인 (이슈 아님, 리더 배정용)

- **A1**
  - 이번에 발견: UQ-200(S-25), UQ-201(S-24)
  - 보고서 목록에 있음: S-40/S-41/S-42 실제 내용
  - 보고서에 S-03이 있지만 다시 강조: 가입 동의 화면에 아직 "개인정보 국외 이전 동의"(필수)가 있다(dev `/settings`의 동의 관리에도 보임). 02 S-03 v5는 AI 공급자 국외 이전 동의를 가입 때 받지 않고 C-21에서 받는다
  - S-42 자리 표시는 `?state=ai-locked`에서 C-18 영역형(`entry="usage"`)을 아직 그리지 않는다(`account/ai-usage-panel.tsx`)
- **A2 / A3 / A4**: 보고서의 "영역에 남은 BYOK 작업" 목록에 동의한다. 덧붙일 점:
  - C-19 경고 배지 앵커(UQ-208)는 A1의 S-40 카드 id와 맞출 것
  - `AiRunButton`을 쓰는 모든 영역은 UQ-207이 고쳐지면 별도 작업 없이 반영된다

## 기계 검사 출력

- `pnpm lint` (eslint): exit 0
- `pnpm typecheck` (`tsc --noEmit`): exit 0
- `pnpm build`: exit 0, `Generating static pages … (39/39)`
- `pnpm exec next dev -p 3125` (확인 후 종료): 30개 경로 모두 200. HTML에서 확인한 것:
  - `/dev/states` 기본: C-18~C-21 문구 전부, 장애 배너, 순차 안내 줄, 기본 연결 "Gemini · 무료 등급"
  - `?state=ai-locked`: C-18 + "AI 연결 안 됨"(NavAiStatus)
  - `key-invalid`: "키를 확인해 주세요"
  - `key-check`: "Gemini · 무료 등급 · 확인 필요"
  - `key-missing`: "키가 삭제되어 …" + 보존 줄
  - `consent`: 두 체크박스 문구
  - `ai-outage`: 공급자별 문구 + 상태 페이지
  - S-16 `ai-failed-daily-quota`: "오늘 Gemini 무료 한도를 다 썼어요." + 보존 줄
  - 화면 어디에도 "사용량은 차감", "회 남음", "한도(" 없음
  - 개발 로그 `Error`/`⨯` 0건
