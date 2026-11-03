# UI QA — A2 S-10 프로젝트 상세 + STAR 제안 카드 + 폐기 경로 redirect (라운드 1)

- 작성: ui-qa / 2026-11-03
- 범위: S-10(기존 `/career/projects/{id}`, 새 `/career/projects/new?experience=|education=`), `StarProposalCard`·`star-proposal-fill.ts`, 폐기 경로 redirect(`projects/[id]/details/**`, `writing-chats/new`, `writing-chats/[id]`)
- 기준: 플로우 v5.6(S-10, L-02 1.3a, FL-05, FL-14, C-05, C-09/C-10, C-15), AI v4.6 AI-12, DM v4.5 2.5.1, 디자인 시스템 v4(3.24, 5.8~5.10), 엔지니어 보고 `24_frontend-engineer-A2-S10_report.md`, 파운데이션 보고 22 / QA 23
- 방법: 양쪽 대조(코드 읽기) + 개발 서버(포트 3611, 임시 공개 env) SSR로 `?state=` 22개·redirect 13개 조합을 가져와 렌더 문자열 확인. **브라우저 상호작용(반영·저장·스트림·이탈 확인 클릭)은 직접 누르지 않았다** — 클릭 뒤 상태(saving / save-failed / stale / skipped / 되돌리기 등)는 코드 경로로 확인.
- 동시 작업: 파운데이션이 `lib/routes.ts`·`data-gate.tsx`·`return-banner.tsx`를 고치는 중이었다(첫 lint·typecheck 실패 → 재실행 통과). 파운데이션 항목은 기록만 하고 쫓지 않았다.

## 요약 — Critical 0 / Major 1 / Minor 13 (+ 기획 확인 2)

- 기계 검사: lint 통과 · typecheck 통과(재실행, `.next/dev` 삭제 불필요) · 테스트 1,833 통과 / 3 실패(로컬 Supabase 통합 테스트 — UI 무관) · build 성공(임시 공개 env 3개).
- S-10의 핵심 동작(머리 5필드 상시 입력, STAR 5칸, 페이지 단위 저장, 첫 AI 메시지 ①~⑤ 순서, [반영] = 폼 채우기, ④ 폼에 채움 → ⑤ 반영됨, 분류 추천 빈 값만·역량 부분 체크 원소 1개, 2,000자, 덧붙임 줄바꿈 1개, 거부 코드 → 칸 매핑, stale 2버튼, 독립 id → S-43, 폐기 경로 redirect)은 명세와 맞다.
- **UQ-PA-21(새 페이지 보존 키) 해결 확인** — 성공·`error.created` 두 경로 모두 키가 바뀌기 전에 `{소속}:new`를 `clear()` 하고, 옛 store의 `dispose()`는 대기 값이 비어 커밋하지 않는다.
- Major 1건: 저장 응답 `skipped`의 줄이 **열린 대화의 카드 안에서만** 보여, `not_found`(대화 삭제) 문구는 구조상 나올 수 없다(UQ-S10-2).

## 화면별 점검표

| 화면 ID | Q1 행 | Q2 문구 | Q3–4 타입·필드 | Q5 라우트 | Q6 상태 | Q7 AI 방식 | Q8 디자인 | Q9 접근성 | Q10 좁은 화면 |
|---|---|---|---|---|---|---|---|---|---|
| S-10 기존 | ✅ | ⚠️ (UQ-S10-1, 10, 11) | ✅ | ✅ | ⚠️ (UQ-S10-2) | ✅ | ✅ (원색·임의 px 0건) | ⚠️ (UQ-S10-7, 8) | ✅ (코드 확인) |
| S-10 새 | ✅ | ⚠️ (UQ-S10-11) | ✅ | ✅ | ✅ | ✅ (①~⑤) | ✅ | ✅ | ✅ |
| STAR 제안 카드 | ✅ | ✅ | ✅ | — | ⚠️ (UQ-S10-2, 3) | ✅ | ✅ (3.24 표와 일치) | ✅ | ✅ ("STAR에서 보기") |
| 폐기 경로 redirect | — | — | ✅ | ⚠️ (UQ-S10-9) | — | — | — | — | — |

### Q1 행 대조 메모 (S-10)

- L-02: `PageShell` + `SaveButton` + `CrumbRow` "{회사명} › {프로젝트명|새 프로젝트} › 프로젝트 상세" — SSR에서 "그린페이먼츠 › 새 프로젝트 › 프로젝트 상세" 확인 ✅
- 머리 5필드(PA-4): 종류 `ChipSelect` / 경험 유형 `ChipSelect` / 역량 `CompetencyChips`(최대 3) / 진행 기간 `MonthField sm`×2 + 개월 수 / 진행 중(켜면 종료 비움·비활성) ✅. ⋯ 메뉴: 소속 변경 / 구분선 / 프로젝트 삭제, 새 페이지는 소속 변경만 ✅. 소속 다이얼로그에 "소속 없음" 없음 ✅
- STAR: 자리 표시 5종 명세 그대로 ✅, AI 근거 도움말(저장값 기준) ✅, G-1(행동)·G-4(역할·결과/성과·배운 점이 빌 때) ✅, "AI 제안 있음" ✅, "AI에게 물어보기"(키 있음·빈 칸, `requested_slot`) ✅, 반영 강조 + `aria-live` "{섹션}에 채웠어요. 저장하기를 눌러야 저장돼요" ✅
- 저장: `save_project_page` 계약 이름 그대로(`project_id`·`client_id`·`values`·`expected_updated_at`·`applied_proposals`), 성공 시 기준값·`updated_at` 갱신, 보낸 원소만 제거, `applied` → ⑤, `notifyCareerSaved()` + `gate.recheck()` ✅. 거부 코드 8종 → 칸/페이지 매핑 표와 일치(`project-page.tsx:131-150`, `:284-317`) ✅
- 첫 AI 메시지(`use-ai-panel.ts:552-641`): ① 이름(`requireName`, C-21·키 판정보다 먼저) → ② `checkAiConnectionAction` fresh(키 없음·무효·동의 — 행 없이 멈춤) → ③ `savePage` → 토스트 "대화를 시작하려고 프로젝트를 저장했어요" → ④ `startWritingChat` → ⑤ 턴 ✅. 이름 없음 문구 "대화를 시작하려면 프로젝트명을 먼저 입력해 주세요" + 제목 포커스 ✅
- 카드(3.24): ① 반영 + 연필 / 검토 필요 상자 [수락]·[거절(비우기)] / 수락함 / 직접 수정 / ④ info 배지 "폼에 채움" + "저장하기를 눌러야 저장돼요"(좁은 화면 "STAR에서 보기") / ⑤ 반영됨(접힘·눌러 펼침) / "새 제안이 있어요" / 갱신 강조 ✅. 빈 칸 "새 값", 내용 있는 칸 "현재 내용 뒤에 붙어요" + 마지막 줄 + `ai-subtle` 강조(지금 폼 값 기준) ✅
- 채우기 규칙(`star-proposal-fill.ts`): 대상 판정(값 있음·`applied_at` null·`needs_review` 제외), STAR 빈 칸 = 값 / 있으면 `현재 + "\n" + 제안`, 2,000자 넘으면 그 섹션만 건너뜀, 기간 빈 칸만(진행 중이면 종료 건너뜀, `YYYY-MM` → `YYYY-MM-01`), 분류 빈 값만, 역량 부분 체크 → 그 값만·원소 `{writing_chat_id, field:'competencies', rev}` 1개, 체크 0개 → 채우기·원소 없음(버튼 비활성) ✅. 채우기 단계 건너뜀 문구 5종 명세 그대로 ✅. 저장 응답 `skipped` 문구 6종(`PAGE_SAVE_SKIP_COPY`) 명세 그대로 ✅
- 분류 추천: "분류 추천" + "이 대화를 보고 추천했어요" + 출처 칩, "추천: {값}" + [반영], 역량 체크 칩(기본 모두 체크) ✅ (SSR `?state=needs-review`에서 확인)

### Q6 `?state=` 결과 (SSR)

| 상태 | 결과 |
|---|---|
| `loading` · `new` · `dirty` · `invalid` · `not-found` · `ai-locked` · `chat-closed` · `needs-review` · `empty` | 렌더 문자열 확인 ✅ (`invalid` = 제목 빔 + "프로젝트명을 입력해 주세요", `chat-closed` = "이 대화가 길어졌어요…" + [모두 반영] / [새 대화], `ai-locked` = 기록 열람 + 카드 [반영] 가능 + C-18 인라인) |
| `saving` · `save-failed` · `stale` · `skipped` · `first-save-failed` · `start-failed` · `key-invalid` · `consent-required` · `chat-closed-other-tab` · `invalid-form-snapshot` · `ai-stream` · `ai-failed` · `return-banner` · `ai-outage` | 200, 클릭·턴 뒤에 나타나는 상태라 코드 경로로 확인 (`skipped`는 UQ-S10-2 참고) |
| `standalone` (독립 id) | `NEXT_REDIRECT;replace;/career?item=project:{id}` ✅ |
| 새 페이지 소속 없음 / `not-found` | `RedirectNotice` → S-08 + 토스트 "찾을 수 없는 항목이에요" ✅ |

### Q5 redirect 결과

| 요청 | 결과 |
|---|---|
| `/career/projects/{id}/details/abc?focus=action` | → `/career/projects/{id}?focus=action` ✅ |
| `/career/projects/{id}/details/new` | → `/career/projects/{id}` ✅ |
| `/career/writing-chats/new?project_id=` | → S-10 ✅ |
| `/career/writing-chats/new?experience_id=` | → `/career/projects/new?experience=` ✅ |
| `/career/writing-chats/new` (조건 없음) · `/career/writing-chats/{없는 id}` | → `/career` ✅ |
| `/career/projects/new?experience_id=` (옛 이름) | S-10 새 페이지 ✅ |
| 진입점 링크 | S-08 카드·"+ 프로젝트 추가", S-09/S-34 폼, C-23(`add-project-dialog.tsx:75`), C-09/C-10(`data-gate.tsx`, `return-banner.tsx`) 모두 `projectPage`/`projectPageNew` ✅ |

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|---|---|---|---|---|---|---|---|
| UQ-S10-1 | Minor | E1 | S-10 머리 진행 기간 | 02 S-10 머리 "진행 기간 … 옆에 개월 수 "(1년 11개월)"(C-25 규칙)" | `src/components/career/project-page/project-page.tsx:589` · `src/lib/data/labels.ts:550` | "(7개월)" | `projectSpanLabel`이 이미 괄호를 붙여 돌려주는데 페이지가 한 번 더 감싸 **"((7개월))"**로 보인다(SSR `?state=needs-review`에서 확인). 값이 ""이면 "()"만 남는다. → 바깥 괄호를 빼고 빈 문자열이면 그리지 않기 |
| UQ-S10-2 | **Major** | E1 | S-10 저장 응답 건너뜀 | 02 S-10 반영 규칙 "저장 응답의 건너뜀(`skipped[].reason`) … 저장 성공 표시(C-06)는 그대로 하고 카드 아래 한 줄: `not_found`(대화가 지워짐) "대화가 삭제돼 반영 기록은 남기지 않았어요" …" · 상태(페이지) "저장됨 + 반영 기록 일부 건너뜀(`skipped`)" | `src/components/career/star-proposal-card.tsx:242` (`saveSkips.filter(s => s.writing_chat_id === chat.id)`), `:202` (대화·초안 없으면 카드 없음) · `src/lib/data/career-v45.ts:430` (미리보기 기본 원소 `writing_chat_id: "preview"`) | 이번 저장의 건너뜀 줄이 사용자에게 보인다 | 줄이 **지금 열린 대화의 카드 안**에서만 그려진다. ① `not_found`는 대화가 지워진 경우라 그 대화의 카드는 이미 없고, 다른 대화를 열어 두면 필터에 걸려 — 이 문구는 어떤 경로로도 나오지 않는다. ② 다른 대화에서 채운 원소의 건너뜀도 안 보인다. ③ `?state=skipped`는 [반영] 없이 저장하면 `"preview"` 원소만 와서 아무 줄도 안 보인다(미리보기로 상태를 볼 수 없음). → 열린 대화와 무관한 건너뜀(특히 `not_found`)은 카드 밖(저장 토스트 또는 C-06 옆 한 줄)로 보이거나, 카드가 없을 때의 대체 자리를 정한다. 미리보기 기본 원소는 열린 대화 id를 쓰게(파운데이션 mock과 같이 정리) |
| UQ-S10-3 | Minor | E1 | S-10 메시지 상한 | 02 S-10 "메시지 상한 40 … 입력 비활성 + "이 대화가 길어졌어요 …" + [모두 반영] / [새 대화]" | `src/components/career/project-page/project-page.tsx:695-704` (`renderClosedActions`) · `src/components/career/star-proposal-card.tsx:472` | [모두 반영] 1개 | 닫힌 대화에서 카드 바닥과 입력창 자리에 **"모두 반영 (5)"가 두 개** 동시에 보인다(SSR `?state=chat-closed`). 같은 동작 버튼 중복 → 카드가 보일 때는 닫힘 영역 버튼을 빼거나 카드 쪽으로 스크롤하는 버튼으로 |
| UQ-S10-4 | Minor | E1 | STAR 제안 카드 요약·[모두 반영 (n)] | 02 S-10 "카드 아래 [모두 반영](반영할 수 있는 섹션 전부)" · 3.24 요약 "반영할 수 있는 섹션 n" | `src/components/career/star-proposal-card.tsx:122-128` (`fillableFields`) | n = 지금 누르면 실제로 채워지는 섹션 수 | `isFillable`만 보고 폼 값 판정을 안 해, 이미 고른 분류(`classification_already_set`)·이미 있는 기간(`period_already_set`)·2,000자 초과(`too_long`) 섹션까지 센다. 누르면 그 섹션은 건너뜀 줄로 빠져 n과 채워진 수가 어긋나고, 모두 건너뛸 때도 버튼이 활성이다. → `planFill(...).fills.length` 기준으로 세기 |
| UQ-S10-5 | Minor | E1 | S-10 ⋯ 프로젝트 삭제 | 02 S-10 머리 메뉴 "프로젝트 삭제 → C-05 → 삭제 후 S-08(소속 선택)" | `src/components/career/project-page/project-page.tsx:742` (`routes.careerItem(parentType, parentId)` — `:211-212` 폼 값 기준) | 삭제 뒤 저장된 소속의 S-08 `?item=` | 소속 변경을 고르고 저장하지 않은 채 삭제하면 **저장 안 된 새 소속**이 선택된 S-08로 간다(프로젝트는 원래 소속에서 지워짐). → 삭제 뒤 이동은 `baseline`(저장값) 소속으로 |
| UQ-S10-6 | Minor | E1 | S-10 되돌리기 토스트 | 02 S-10 반영 규칙 "되돌리기 = 그 칸을 채우기 직전 값으로, 다음 입력 전까지" · "되돌리기를 하면 그 원소를 뺀다" | `src/components/career/project-page/project-page.tsx:395-403`, `:423` | 저장으로 확정된 뒤에는 되돌리기가 저장 전 변경만 다룸(또는 토스트 닫힘) | 8초 안에 "저장하기"를 눌러 성공한 뒤 되돌리기를 누르면 칸 값은 채우기 전으로 돌아가지만(저장 전 변경 생김) 카드는 ⑤ "반영됨"으로 남는다 — 카드와 폼이 어긋난다. → 저장 성공 때 열린 되돌리기 토스트를 닫거나, 저장 뒤에는 되돌리기를 막는다 |
| UQ-S10-7 | Minor | E1 | S-10 "AI 제안 있음" | 디자인 시스템 7 접근성(접근 가능한 이름) · 02 S-10 STAR "반영 안 한 AI 제안" 행 | `src/components/career/project-page/project-page.tsx:619-631` | 버튼 이름에 섹션이 드러남(예: "행동 AI 제안 보기") | 다섯 칸의 버튼 이름이 모두 "AI 제안 있음"이라 스크린 리더 버튼 목록에서 구분되지 않는다. → `aria-label`에 섹션 이름 |
| UQ-S10-8 | Minor | E1 | S-10 검증 오류 포커스 | 02 L-02 "검증 오류: 저장을 막고 첫 오류 칸으로 포커스" | `src/components/career/project-page/project-page.tsx:112-117`, `:556-568` (`span id="head-…" tabIndex={-1}`) | 오류 난 분류 컨트롤 자체에 포커스 | 분류 오류(`invalid_classification`) 때 이름 없는 `span`에 포커스가 가서 스크린 리더가 아무것도 읽지 않고, 키보드 사용자는 한 번 더 Tab 해야 한다. 오류 줄도 컨트롤에 `aria-describedby`로 묶여 있지 않다. → 트리거에 포커스(ref 전달) + 오류 줄 연결 |
| UQ-S10-9 | Minor | E1 | 폐기 경로 redirect | 02 S-10 진입 "C-02(STAR 근거 → 해당 칸 포커스), C-09, S-16 보완점" · 사이트맵 폐기 경로 | `src/app/(page)/(gated)/career/projects/[id]/details/[[...rest]]/page.tsx:15-17` · `src/app/(dashboard)/(gated)/career/writing-chats/new/page.tsx:13-21` | 옛 링크의 `requirement_id`(S-16 관련 요건)·`chat`이 새 경로로 이어짐 | `focus`만 넘기고 `requirement_id`·`chat`은 버린다(옛 S-16 링크로 들어오면 관련 요건 배너가 사라짐). → 알려진 쿼리(`requirement_id`, `chat`)는 `routes.projectPage(id, {...})`로 넘기기 |
| UQ-S10-10 | Minor | foundation | S-10 G-1 | 02 C-07 G-1 "'우리 팀은'보다 '저는'으로 써 주세요. 팀이 한 일·배경은 상황에 써 주세요" | `src/components/common/input-guide.tsx:17` | 명세 문구 그대로 | "…배경은 **상황(S)에** 써 주세요" — 괄호가 덧붙음 |
| UQ-S10-11 | Minor | foundation | S-10 새 페이지 시작 인사 | AI-12 시작 인사 "STAR가 비어 있을 때: "'{프로젝트명}'을 함께 정리해 볼게요 …"" · 02 S-10 "새 프로젝트는 'STAR 비어 있음' 분기" | `src/lib/data/career-v45-shared.ts:496`, `:500`, `:506` | 이름이 비면 자연스러운 문장, 받침에 맞는 조사 | 이름이 빈 새 페이지에서 **"'새 프로젝트'을 함께 정리해 볼게요"**(SSR `new`에서 확인) — 자리 표시를 이름처럼 넣고 조사 "을"이 고정. 이름이 모음으로 끝나도 "을". 게이트 줄 "{기능}을"도 같음. → 받침 조사 함수(S-10에 `toward()`가 이미 있음 — 공유로), 이름 빔 문장은 기획 확인 |
| UQ-S10-12 | Minor | foundation | S-10 C-10 복귀 배너 | 02 L-02 "복귀 배너: C-10, 이동 줄 아래 페이지 전체 폭" · 5.8 | `src/components/common/return-banner.tsx:157` (`sticky top-16`) | L-02 배너 자리(`ShellBanners`) 모양 | L-01 상단 높이 기준 `sticky top-16`이 남아 있어 L-02 스크롤 시 엉뚱한 위치에 붙는다(엔지니어 요청 1 — "AI와 대화하며 채우기" 숨김은 `onProjectPage`로 해결됨, 클래스만 남음) |
| UQ-S10-13 | Minor | foundation | STAR 제안 카드 `field_already_applied` | 디자인 시스템 3.24 "다른 탭 등으로 `field_already_applied`가 오면 **섹션 아래** `text-sm text-muted-foreground` "이미 반영했어요. 왼쪽 칸에서 고쳐 주세요"" | `src/components/career/ai-panel/use-ai-panel.ts:729` (토스트) | 섹션 아래 줄 | 토스트로만 보인다(문구는 같음). → `patchDraft` 실패 코드를 돌려 카드가 섹션 아래에 그리게 |
| UQ-S10-14 | Minor | foundation | 빠른 버튼 칩 원천 | AI-12 "빠른 버튼 칩 계산 규칙 — 원천은 이 명세의 칩 표 하나 … 문구 변경은 공유 상수만 고친다(화면·서버 문구 중복 없음)" | `src/lib/data/quick-chips.ts:38-79` · `src/server/ai/context-pack/focus-slots.ts:188-210` | 칩 표 상수 1곳 | 같은 표가 화면용(`quick-chips.ts`)과 v4.4 서버용(`focus-slots.ts`, `turn_done` 칩)에 따로 있다. 지금 문구는 같지만 한쪽만 고치면 어긋난다. 서버 쪽은 백엔드 v4.5 연결(DM 11.3) 때 화면 상수를 쓰거나 지우도록 백엔드에 전달 필요 |

## 기획 확인 필요

| ID | 내용 | 양쪽 인용 | 지금 코드 |
|---|---|---|---|
| UQ-S10-K1 | 분류를 이미 고른 경우의 문구가 두 문서에서 다르다 | 02 S-10 "`classification_already_set` "이미 직접 고른 분류는 바꾸지 않았어요"" / AI-12 "채우는 시점에 폼에서 사용자가 이미 값을 골랐으면 채우지 않고 "이미 고른 값이 있어요"를 보인다" | 둘 다 보인다 — 카드 바닥 줄(`star-proposal-card.tsx:82`) + 그 분류 행 아래(`:630`). 하나로 정해 달라 |
| UQ-S10-K2 | 첫 메시지 이름 없음 문구가 두 문서에서 다르다 | 02 S-10 "머리 제목에 포커스 + "대화를 시작하려면 프로젝트명을 먼저 입력해 주세요"" / AI-12 ① "프로젝트명 칸에 포커스를 옮기고 "프로젝트명을 먼저 입력해 주세요"를 보인다" | UX 문구 사용(`project-page.tsx:551`). 화면 문구 원천은 UX라 문제는 없지만 AI-12를 맞춰 두면 좋다 |
| (엔지니어 보고 재전달) | "AI에게 물어보기" 고정 문구 / 기간 제안 카드 모양 / "본인 역할 확인 중" 클릭 목적지 / [모두 반영] 되돌리기 범위 / 이름이 빈 새 페이지의 시작 인사(UQ-S10-11) | `24_…_report.md` "기획 확인 필요" 4건 | `[UI-가정]` 표시 9곳 확인 |

## 재확인 결과 (이전 라운드 이슈 중 S-10 배선에 걸린 것)

| ID | 결과 | 메모 |
|---|---|---|
| UQ-PA-21 | 해결 | `project-page.tsx:277-282`(`error.created` → `wasNew`면 `preserved.clear()` 후 `setProjectId`) · `:321-323`(성공 → `clear()` 후 키 전환). `input-preservation.ts:85-101` — `clear()`가 대기 값을 비워 옛 store `dispose()`가 다시 쓰지 않는다. 저장 중 입력이 남으면 다음 렌더가 새 키(행 id)에 쓴다 |
| UQ-PA-20 | 해결(S-10 배선) | 막힌 메시지 `blockedSend`로 "다시 시도"가 칩·빠른 답도 같은 `sendOpts`로 다시 보냄(`use-ai-panel.ts:548`, `:644-650`) |
| UQ-PA-8 | 해결(S-10 값) | `first-save-failed`·`start-failed`·`invalid-form-snapshot`·`chat-closed-other-tab`·`standalone`·`skipped` 값 존재. 단 `skipped`는 UQ-S10-2 ③ |

## 기계 검사 출력

| 검사 | 결과 |
|---|---|
| `pnpm lint` | 1차: `data-gate.tsx:126` rules-of-hooks 1건(파운데이션 수정 중) → **재실행 exit 0**. S-10 범위 파일만 따로 돌린 eslint도 0 |
| `pnpm typecheck` | 1차: `insight-view.tsx`(A3)·`data-gate.tsx`·`return-banner.tsx`가 지워진 `routes.writingChatNew`/`projectNew`/`project`를 불러 TS2339(파운데이션 라우트 정리 진행 중) → **재실행 exit 0, 오류 0**. `.next/dev/types` 낡은 참조 문제는 이번엔 없어 `.next/dev`를 지우지 않았다 |
| `pnpm test` | 118파일 중 116 통과, 1,836개 중 **1,833 통과 / 3 실패** — `src/lib/data/career.integration.test.ts`, `src/server/services/writing-chat/writing-chat.integration.test.ts`(로컬 스택). 원인 `PGRST202 Could not find the function public.apply_writing_chat_proposal` — 로컬 DB 스키마와 v4.4 통합 테스트 불일치(백엔드 범위, UI 무관). S-10 관련 `star-proposal-fill.test.ts`·`quick-chips.test.ts`·`shell/*` 3파일 28개 통과 |
| `pnpm build` | `.env.local` 없음 → 임시 공개 env(`NEXT_PUBLIC_SUPABASE_URL`·`_ANON_KEY`·`_SITE_URL`)로 **성공**. 라우트 `/career/projects/[id]`, `/career/projects/new`, `/career/projects/[id]/details/[[...rest]]`, `/career/writing-chats/[id]`, `/career/writing-chats/new` 포함 |
| dev SSR | `next dev --port 3611`(같은 임시 env), S-10 `?state=` 22개·새 페이지 6개·redirect 7개 200, 서버 오류 0. 상태 미리보기 없는 실제 경로는 인증 없음 → `/sign-in` 307(정상) |
