# A2 (E1) 구현 보고 — S-10 프로젝트 상세 v5.6

- 작성: frontend-engineer A2-E1 / 2026-11-03
- 기준: 플로우 v5.6 S-10·L-02·FL-05·FL-14·C-05·C-09/C-10·C-15, AI v4.6 AI-12, DM v4.5 2.5.1, 디자인 시스템 v4 3.14·3.24·5.8~5.10, 파운데이션 보고 22(QA 1라운드 포함), 리더 메시지 UQ-PA-21·C-05 `scope`/`unsavedChanges`

## 완료 화면

| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---|---|---|---|
| S-10 기존 | `/career/projects/{id}` (`?chat=`, `?focus=situation…learnings|star|fields`, `?requirement_id=`) | `loading` · `new`(같은 소속의 새 페이지 모양) · `dirty` · `invalid`(이름 비움 + 검증 오류) · `saving` · `save-failed` · `stale` · `skipped` · `not-found` · `standalone`(→ S-08 `?item=project:`) · `ai-locked` · `key-invalid` · `consent-required` · `chat-closed` · `chat-closed-other-tab` · `invalid-form-snapshot` · `start-failed` · `ai-stream` · `needs-review` · `empty` · `ai-failed*` · `return-banner` · `ai-outage` | mock id: 프로젝트 `00000000-0000-4e03-8000-000000000001`, 독립 `…-000000000006` |
| S-10 새 | `/career/projects/new?experience={id}` · `?education={id}` (옛 `experience_id`/`education_id`도 받음, `?requirement_id=`) | `new` · `first-save-failed` · `start-failed` · `ai-locked` · `not-found`(→ S-08 + 토스트) 외 위와 같음 | mock 경력 `00000000-0000-4e01-8000-000000000001`. 소속 없음/모름 → S-08 + "찾을 수 없는 항목이에요" |
| 폐기 경로 | `/career/projects/{id}/details/**` → S-10 (`?focus=` STAR 칸 유지), `/career/writing-chats/{id}` → 프로젝트 S-10 `?chat=`(산출물 대화면 S-44 `?chat=`, 없으면 S-08), `/career/writing-chats/new` → `project_id` S-10 / `experience_id`·`education_id` S-10 새 / 그 밖 S-08 | — | 서버 redirect |

개발 서버 SSR 스모크 14개 조합 200(위 상태 + 폐기 경로 redirect) 확인. 브라우저 상호작용(반영·저장·스트림·이탈 확인)은 직접 눌러 보지 못함 — QA 확인 필요.

### S-10 구성 (명세 행 대조)

- L-02 `PageShell` + `SaveButton`(전 상태, ⌘/Ctrl+S) + `CrumbRow` "{회사명/기관명} › {프로젝트명|새 프로젝트} › 프로젝트 상세"(소속 변경 시 따라감, 좁은 화면 "← {상위}")
- 배너: C-10 `ReturnBanner` → 관련 요건(S-16) → 입력 보존 "이어서 편집/버리기"(`resolve()`/`clear()`) → 페이지 오류(소속 없음 → "커리어로 가기", 소속 변경 거부)
- 머리: `DocTitleInput`(자리 표시·100자·필수·"이름 먼저" 링 + 경고 줄·오류 줄), ⋯ 메뉴(소속 변경 / 구분선 / 프로젝트 삭제 — 새 페이지는 소속 변경만), 종류·경험 유형 `ChipSelect`, 역량 `CompetencyChips`(최대 3), 진행 기간 `MonthField sm` ×2 + 진행 중(켜면 종료 비움·비활성) + 개월 수(C-25)
- 화면 검사: 이름 필수, 종료<시작 "종료월은 시작월보다 빠를 수 없어요", 시작 없이 종료 "시작월을 먼저 골라 주세요", 역량 3개, 칸별 2,000자 → 첫 오류 칸 포커스. 서버 거부 코드 표 전부 칸·페이지에 매핑(`project_not_affiliated` → S-43 + 토스트, `not_found` → ST-NOTFOUND)
- STAR 5칸: 명세 자리 표시, AI 근거 도움말(저장값 기준), "AI 제안 있음"(→ 패널 열고 카드 섹션 스크롤·강조), 빈 칸 + 키 있음 "AI에게 물어보기"(`requested_slot`, 새 페이지면 ①~⑤ 순서), G-1(행동), G-4(역할·결과/성과·배운 점이 빌 때), 글자 수(포커스 또는 90% 초과), 반영 강조 + `aria-live` "{섹션}에 채웠어요. 저장하기를 눌러야 저장돼요"
- 저장: `saveProjectPageAction`(`client_id` 한 번 생성, `p_expected_updated_at`, `p_applied_proposals`), `error.created` 처리, 성공 시 기준값·`updated_at` 갱신, 보낸 반영 원소 제거, 응답 `applied` → 열린 대화 필드 `applied_at`(⑤ 반영됨) + `markApplied`, `skipped` → 카드 아래 줄, `notifyCareerSaved()` + 복귀 재판정, 새 페이지는 `history.replaceState`로 `/career/projects/{id}`(+`?chat=`, `?state=` 유지 — 컴포넌트 유지라 첫 턴이 끊기지 않음)
- **UQ-PA-21**: 새 페이지 저장 성공·부분 성공(`error.created`) 때 키가 행 id로 바뀌기 전에 `{소속}:new` 보존본을 `clear()`
- 충돌: `StaleWriteDialog` "내 내용으로 저장"(`expected=null`, 반영 원소 그대로) / "새로 불러오기"(`guard.reloadDiscarding`)
- 이탈 확인·입력 보존(값 + 반영 원소), 삭제 후·`not_found`·독립 전환 때는 이탈 확인 없이 이동
- ⋯ 프로젝트 삭제: C-05 `scope: "affiliated"`, `unsavedChanges: dirty` → `deleteCareerItemAction` → S-08 `?item={소속}`
- 소속 변경: 이 사용자 경력·교육 라디오 다이얼로그(지금 소속 체크) → 폼·이동 경로만 바뀜, 저장하기로 확정
- 패널: `useAiPanel`(returnTarget·gateFeatureLabel = 세션 복귀 대상, requireName, savePage, onChatChange → `?chat=` replace), `renderProposal` = STAR 제안 카드, `renderClosedActions` = [모두 반영 (n)], `renderAboveInput` = 준비되면 "{기능}으로 돌아가기", `onUserMessageClick` → 그 발화를 출처로 가진 섹션 강조, `onDirectInput` → 상황 칸

### STAR 제안 카드 (`src/components/career/star-proposal-card.tsx`)

- 머리(접기) "STAR 제안" + "반영할 수 있는 섹션 n · 검토 필요 m" / "정리 중"
- 섹션: (기간) → 상황·역할·행동·결과/성과·배운 점 → 분류 추천. 빈 칸 = "새 값", 내용 있는 칸 = "현재 내용 뒤에 붙어요" + 현재 마지막 줄 + 덧붙일 문장 강조(지금 폼 값 기준)
- 상태: ① 반영 + 직접 고치기(→ `edit` 패치) / 검토 필요 상자 + [수락]/[거절(비우기)] / 수락함 / 직접 수정 / ④ "폼에 채움" + "저장하기를 눌러야 저장돼요"(좁은 화면 "STAR에서 보기") / ⑤ "반영됨"(접힘, 눌러 펼침) / "새 제안이 있어요"(`proposal_changed` 또는 채운 뒤 rev가 바뀜) / 갱신 강조 / 본인 역할 확인 중 배지(→ 마지막 AI 질문)
- C-15 "내 답변 #n" 칩 → `flashMessage(id, source_quotes)`
- 분류 추천: 종류·경험 유형 "추천: {값}" + [반영], 역량 체크 칩(기본 모두 체크, 일부만 체크 → 그 값만, 0개 → 원소 없음) — 원소는 `{writing_chat_id, field:'competencies', rev}` 하나
- 바닥: "검토하지 않은 섹션 N개는 반영되지 않아요" + 채우기 건너뜀 문구 5종 + 저장 응답 `skipped` 문구, [모두 반영 (n)]. 2,000자 초과는 섹션 아래 명세 문구
- 응답 중·정리 중·패치 중에는 모든 버튼 비활성
- 채우기 규칙은 순수 함수 `star-proposal-fill.ts`(+ 테스트 7개): 대상 판정, STAR 덧붙임(줄바꿈 1개)·2,000자, 기간 빈 칸만('YYYY-MM' → 'YYYY-MM-01', 진행 중이면 종료 건너뜀), 분류 빈 값만, `mergeApplied`(대화·필드당 원소 하나, 최신 rev), `markDraftApplied`
- 되돌리기 토스트 "{섹션}에 채웠어요 · 되돌리기"(8초, 칸이 채운 값 그대로일 때만 되돌림 + 원소 제거)

## 파일

- 새로: `src/app/(page)/(gated)/career/projects/[id]/page.tsx`, `src/app/(page)/(gated)/career/projects/new/page.tsx`, `src/app/(page)/(gated)/career/projects/_focus.ts`, `src/app/(page)/(gated)/career/projects/[id]/details/[[...rest]]/page.tsx`, `src/components/career/project-page/project-page.tsx`, `src/components/career/project-page/affiliation-dialog.tsx`, `src/components/career/project-page/redirect-notice.tsx`, `src/components/career/star-proposal-card.tsx`, `src/components/career/star-proposal-fill.ts`, `src/components/career/star-proposal-fill.test.ts`
- 다시 씀(redirect): `src/app/(dashboard)/(gated)/career/writing-chats/[id]/page.tsx`, `src/app/(dashboard)/(gated)/career/writing-chats/new/page.tsx`

## 삭제

- 라우트: `src/app/(dashboard)/(gated)/career/projects/new/page.tsx`, `…/projects/[id]/page.tsx`, `…/projects/[id]/details/new/page.tsx`, `…/projects/[id]/details/[detailId]/page.tsx`
- 컴포넌트(다른 곳에서 import 없음 확인): `src/components/career/project-form.tsx`, `detail-form.tsx`, `star-fill.tsx`, `writing-chat/` 전체(`abandon.tsx`, `chat-screen.tsx`, `chat-start.tsx`, `draft-preview.tsx`, `gate.tsx`, `source-chip.tsx`)
- 남김: `achievement-dialog.tsx`·`achievement-list.tsx`(`experience-form.tsx`가 아직 씀), `related-requirement.tsx`(S-10이 씀), `gate-next-step.tsx`·`fresh-key.tsx`·`screen-state.tsx`(다른 화면이 씀). `components/career/actions.ts`의 S-36 액션은 import가 없어졌지만 파일 공유라 손대지 않음

## [UI-가정]

| 화면 ID | 파일 | 내용 |
|---|---|---|
| S-10 | `project-page.tsx` | "←"는 늘 S-08 `?item={소속}`(브라우저 기록 판정 안 함) |
| S-10 | `project-page.tsx` | G-4 예시 문구(v4 S-35 예시 재사용) |
| S-10 | `project-page.tsx` | "AI에게 물어보기" 고정 메시지 "{섹션} 부분을 물어봐 줘" |
| S-10 | `project-page.tsx` | G-1/G-4와 "AI에게 물어보기"를 도움 줄에 함께 둠 |
| S-10 | `project-page.tsx` | 되돌리기 토스트 8초, [모두 반영]이면 섹션 이름을 이어 씀, 되돌리기는 칸이 채운 값 그대로일 때만 |
| S-10 | `project-page.tsx` | 새 페이지에서 대화를 바꿔도 행이 생기기 전에는 URL 그대로 |
| S-10 | `project-page.tsx` | 삭제 완료 토스트 "프로젝트를 삭제했어요" |
| S-10 | `project-page.tsx` | `?state=invalid`, `?state=new`(기존 id에서 새 페이지 모양) 미리보기 |
| S-10 | `affiliation-dialog.tsx` | 다이얼로그 설명·버튼 "바꾸기" |
| S-10 | `[id]/page.tsx` | `?focus=star|fields` = 빈 STAR 칸(상황 → 행동), 없으면 상황 |
| S-10 | `star-proposal-card.tsx` | 기간 제안 섹션(시작월·종료월) 모양·이름 — 명세에 카드 모양 없음 |
| S-10 | `star-proposal-card.tsx` | 직접 고치기 버튼 "저장"(제안 고치기) |
| S-10 | `star-proposal-card.tsx` | 채우기 건너뜀 줄은 다음 턴 시작 때 지움, 저장 응답 줄은 다음 [반영] 때 지움 |
| S-10 | `star-proposal-card.tsx` | "본인 역할 확인 중" 클릭 → 마지막 AI 메시지(질문 id를 데이터가 주지 않음) |
| S-10 | `writing-chats/new/page.tsx` | 옛 게이트 URL의 `application_project_id`·`feature`는 버림(복귀 대상은 세션 저장값만) |

## 기획 확인 필요

| 화면 ID | 질문 | 스펙 위치 |
|---|---|---|
| S-10 | "AI에게 물어보기"가 보내는 고정 문구 | S-10 STAR "빈 칸" / AI-12 `requested_slot` |
| S-10 | 기간 제안(`structured_draft.project.*`)을 카드에 어떻게 보일지 | S-10 반영 규칙 "이름·기간(빈 기간만 제외)" · 디자인 3.24에 없음 |
| S-10 | "본인 역할 확인 중" 클릭 목적지(되묻기 질문 메시지 id가 `clarifications[]`에 없음) | C-15 보조 배지 |
| S-10 | [모두 반영] 되돌리기 범위(전체 한 번 vs 섹션별) | S-10 반영 규칙 되돌리기 |

## 파운데이션 요청

1. `ReturnBanner`/`gateContinuationHref`(`common/return-banner.tsx`)가 아직 `routes.writingChatNew`(폐기된 S-36)를 만든다 — 지금은 redirect로 이어지지만 v5.6 경로(S-10 `projectPage` / C-23 → `projectPageNew`)로 바꾸고 S-10 안에서는 "AI와 대화하며 채우기"를 숨겨 달라. 배너 클래스 `sticky top-16`도 L-02에는 맞지 않음.
2. `data-gate.tsx`·`insight-view.tsx`(A3)가 소속 없이 `routes.projectNew()` / `projectNew({requirement_id})`로 보낸다 → S-10 새 페이지가 소속 없음으로 S-08 + 토스트. C-23 소속 선택으로 바꿔야 함. `routes.projectNew`·`project`·`projectDetail*`·`writingChat*` 헬퍼 정리(→ `projectPageNew`/`projectPage`)도 요청.
3. `lib/data/evidence.ts`가 `routes.projectDetail(…, field)`(폐기)로 링크 — redirect가 `?focus=`를 살려 S-10으로 보내지만 `routes.projectPage(id) + ?focus=`로 바꾸는 편이 낫다(`routes.projectPage`에 `focus` 쿼리 추가 요청).
4. `useAiPanel`에 "열린 대화의 `structured_draft` 필드 `applied_at` 반영" 헬퍼가 있으면 좋겠다(지금은 `setDraft(markDraftApplied(…))`로 처리).
5. `RelatedRequirement`의 `mx-auto mb-6 max-w-3xl`이 L-02 배너 자리에 맞지 않음(A2 파일이라 원하면 다음에 정리).

## 검사 결과

- `pnpm lint`: 통과(0)
- `pnpm typecheck`(`next typegen && tsc`): `.next/dev/types/validator.ts`가 지운 `(dashboard)…/projects/*` 페이지를 참조해 실패 — 다른 dev 서버가 만든 낡은 생성물. 소스만 본 `tsc --noEmit`은 `.next/dev` 밖 오류 0. dev 서버를 다시 띄우면 사라짐
- 테스트: `star-proposal-fill.test.ts` 7개 + 관련 6파일 → 7파일 62개 통과
- `pnpm build`(공개 env 임시 값 2개): 성공, 새 라우트 `/career/projects/[id]`, `/new`, `/[id]/details/[[...rest]]`, `/career/writing-chats/*` 포함
- dev SSR 스모크 14조합 200, 서버 오류 0(redirect 페이지의 `instant` 검증 경고는 `ScreenSuspense`로 감싸 해결)

## QA 1라운드 수정 (`25_ui-qa_A2-S10_review.md`)

| ID | 심각도 | 상태 | 수정 내용 | 파일 |
|---|---|---|---|---|
| UQ-S10-1 | Minor | 해결 | `projectSpanLabel`이 붙이는 괄호를 그대로 쓰고, 빈 문자열이면 그리지 않음 ("((7개월))" · "()" 없음) | `project-page/project-page.tsx` |
| UQ-S10-2 | Major | 해결 | 저장 응답 `skipped` 중 열린 카드에 그려지지 않는 것(지워진 대화 `not_found`, 다른 대화, 카드가 없을 때 전부)은 머리 필드 아래 페이지 줄(`Info` + 명세 문구, `aria-live`)로. 열린 대화 것은 카드 바닥 그대로. `?state=skipped`에서 [반영] 없이 저장하면 mock의 `"preview"` 원소가 이 페이지 줄로 보임(파운데이션 mock 수정 없이). 다음 [반영] 때 지움 | `project-page.tsx` |
| UQ-S10-3 | Minor | 해결 | 닫힌 대화에서는 카드 바닥 [모두 반영]을 빼고 닫힘 상자의 버튼 하나만 | `star-proposal-card.tsx` |
| UQ-S10-4 | Minor | 해결 | `fillableFields`가 `planFill(...).fills` 기준(폼 값 판정 포함)으로 셈 — 요약 n·[모두 반영 (n)]·비활성 판정이 실제 채움과 같음. 인자에 `values` 추가 | `star-proposal-card.tsx`, `project-page.tsx` |
| UQ-S10-5 | Minor | 해결 | 삭제 뒤 이동은 저장값(`baseline`) 소속의 S-08 `?item=` | `project-page.tsx` |
| UQ-S10-6 | Minor | 해결 | 저장 성공 때 열린 되돌리기 토스트를 모두 닫고, 저장 세대 번호로 저장 이전 토스트의 되돌리기를 무시 | `project-page.tsx` |
| UQ-S10-7 | Minor | 해결 | "AI 제안 있음" 버튼 `aria-label` = "{섹션} AI 제안 보기" | `project-page.tsx` |
| UQ-S10-8 | Minor | 해결 | 분류 오류 포커스 = 그 행의 트리거 버튼(`focusError`), 오류 줄 `id="err-{필드}"`를 트리거 버튼 `aria-describedby`로 연결(공통 입력에 prop이 없어 DOM 속성으로 — 아래 파운데이션 요청 6) | `project-page.tsx` |
| UQ-S10-9 | Minor | 해결 | `details/**` redirect가 `focus`·`requirement_id`·`chat`을 `routes.projectPage(id, {...})`로 넘김, `writing-chats/new`도 `requirement_id` 유지 | `projects/[id]/details/[[...rest]]/page.tsx`, `writing-chats/new/page.tsx` |
| K1 (리더 판정) | — | 반영 | 분류 이미 고름 = UX 문구 "이미 직접 고른 분류는 바꾸지 않았어요"만(AI-12 "이미 고른 값이 있어요" 제거). 그 분류 행 아래에만 보이고 바닥 줄에서는 중복 제거 | `star-proposal-card.tsx` |
| K2 (리더 판정) | — | 유지 | 이름 없음 문구는 이미 UX "대화를 시작하려면 프로젝트명을 먼저 입력해 주세요" | — |
| UQ-S10-10~14 | — | 파운데이션 | 손대지 않음 | — |

추가 파운데이션 요청
6. `ChipSelect`·`CompetencyChips`에 `describedBy`(또는 `aria-describedby` 전달) prop — 지금은 페이지가 DOM 속성으로 붙인다.

검사(수정 후): `pnpm lint` 통과(0) · `pnpm typecheck` 통과(이번엔 `.next/dev` 낡은 참조 없음) · 관련 테스트 7파일 62개 통과 · `pnpm build` 성공(공개 env 임시 값 3개). 브라우저 상호작용은 여전히 직접 누르지 못함.

## 파운데이션 후속 반영 (22 보고 "영역 QA 후속")

- UQ-S10-13: STAR 카드의 직접 고치기·수락·거절이 `panel.patchDraft(patch, { inline: true })`를 부르고, `panel.patchRefusal`이 `field_already_applied`이면서 그 섹션 필드면 섹션 아래 `text-sm text-muted-foreground` "이미 반영했어요. 왼쪽 칸에서 고쳐 주세요"(`PANEL_COPY.alreadyApplied`) — 토스트 없음 (`star-proposal-card.tsx`)
- describedBy: `ChipSelect`·`CompetencyChips`에 `describedBy="err-{필드}"`로 넘기고 DOM 속성 우회 effect 삭제 (파운데이션 요청 6 해결) (`project-page.tsx`)
- 자체 `toward()` 삭제 → `directionParticle`(labels)로 "{기능}으로 돌아가기"
- 검사: lint 0 · typecheck 통과 · 관련 테스트 7파일 통과 · build 성공(공개 env 임시 값)

## 통합 QA 반영 (`26_ui-qa_project-add_round2-integration.md`)

- UQ-INT-1: S-10 ⋯ 프로젝트 삭제가 `refresh()` 없는 새 액션 `deleteAffiliatedProjectAction(projectId, resultMode)`(`components/career/actions.ts`에 추가만, 기존 함수 그대로)을 부르고 바로 저장된 소속의 S-08 `?item=`로 `replace` — 지운 S-10이 다시 그려져 ST-NOTFOUND가 비치는 일 없음. 소속 프로젝트 삭제라 `affiliation_mode`는 넘기지 않음
- 검사: lint 0 · typecheck 통과 · 관련 테스트 5파일 37개 통과
