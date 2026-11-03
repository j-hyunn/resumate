# UI QA — 프로젝트 추가·산출물 상세 런: 영역 QA 2라운드(최종) + Phase 4 통합 QA

- 작성: ui-qa / 2026-11-03
- 범위: ① S-10·S-43/S-44 라운드 1 이슈 재확인(`25_ui-qa_A2-S10_review.md`, `25_ui-qa_A2-S44_review.md`) + 수정한 파일 회귀 ② 통합 Q5(화면 사이 경로, 폐기 경로, 남은 링크, L-01 ↔ L-02 셸) ③ 기계 검사 전체 ④ 이번 런 보고(`_workspace/ui/2*_*.md`)의 기획 확인 항목 모음
- 기준: 플로우 v5.6(1.3a L-02, S-08, S-10, S-43, S-44, C-02, C-05, C-08, C-09, C-10, C-22, C-23), AI v4.6(AI-12, AI-13), DM v4.5(2.5.0, 2.5.1, 6장 readiness v4.4), 디자인 시스템 v4, 수정 보고(24 E1·E2 "QA 1라운드 수정"·"파운데이션 후속 반영", 22 "영역 요청 처리"·"영역 QA 후속")
- 리더 판정 반영: K1·K2 = UX 문구만 / P-3 = S-44에 "마무리 중" 없음 / UQ-S44-14 처리 = `[UI-가정]`으로 수용 / P-1(C-22 일괄 모달 vs 이름 다이얼로그) = 사용자 답 대기
- 방법: 코드 정독(양쪽 대조) + 개발 서버(포트 3623, 임시 공개 env) SSR 42개 URL 확인. **브라우저 클릭·입력·포커스는 직접 확인하지 못했다** — 클릭 뒤 상태는 코드 경로로 판단.

## 요약

- **라운드 1 이슈 31건(UQ-S10 14 + UQ-S44 17) 중 해결 29 · 부분 해결 1 · 미해결(백엔드 이관) 1**. 기획 항목 K1·K2·P-2·P-3은 리더 판정대로 반영 확인
  - S-10: 14건 중 13 해결, UQ-S10-14는 백엔드 이관(화면 쪽 할 일 없음)
  - S-44: 17건 중 16 해결(UQ-S44-14는 `[UI-가정]` 수용), UQ-S44-4 부분 해결
- **새 이슈 UQ-INT-1~5: Critical 0 / Major 1 / Minor 4**
  - Major는 C-09 데이터 부족 게이트(파운데이션)가 아직 v4.3b readiness 모양을 읽는 문제다. 실제 경로에서 `next_action = 'create_project'`가 "경력 먼저 입력하기"(S-09 새 경력)로 바뀌어 C-23 소속 선택에 닿지 않고, `project_star`·`project_fields` 문구·이동 대상이 v5.5/v5.6 명세와 다르다(UQ-INT-4).
- 기계 검사: lint 통과 · typecheck 통과(`.next/dev` 삭제 후) · 테스트 1,840개 중 1,837 통과, 실패 3개는 알려진 로컬 Supabase `PGRST202` 3건뿐 · build 성공 · 개발 서버 SSR 42개 URL 모두 200, 서버 오류 0
- 남은 이슈(라운드 1 미완 + 새 이슈): **Major 1 / Minor 5**(UQ-S44-4 부분, UQ-INT-1·2·3·5) + 백엔드 이관 1(UQ-S10-14)

## 1. 라운드 1 이슈 재확인

### S-10 (`25_ui-qa_A2-S10_review.md`)

| ID | 심각도 | 결과 | 확인 내용 (코드 위치) |
|---|---|---|---|
| UQ-S10-1 | Minor | 해결 | `project-page.tsx:472`, `:604` — `projectSpanLabel` 결과를 그대로, 빈 문자열이면 그리지 않음. SSR `?state=needs-review` "(7개월)" 확인, "((" 0건 |
| UQ-S10-2 | Major | 해결 | `project-page.tsx:466-470`, `:609-618` — 열린 카드가 그리지 않는 건너뜀(지워진 대화 `not_found`, 다른 대화, 카드 없음)은 머리 아래 페이지 줄(`Info` + `PAGE_SAVE_SKIP_COPY`, `aria-live`). 다음 [반영] 때 지움(`:418`) |
| UQ-S10-3 | Minor | 해결 | `star-proposal-card.tsx:482-483` — 닫힌 대화면 카드 바닥 [모두 반영] 없음. SSR `?state=chat-closed`에서 "모두 반영" 1개 |
| UQ-S10-4 | Minor | 해결 | `star-proposal-card.tsx:124-134` — `planFill(...).fills` 기준(폼 값 판정 포함). 닫힘 영역 버튼(`project-page.tsx:723`)도 같은 함수 |
| UQ-S10-5 | Minor | 해결 | `project-page.tsx:770` — 삭제 뒤 `baseline` 소속의 S-08 `?item=` |
| UQ-S10-6 | Minor | 해결 | `project-page.tsx:323-326`(저장 성공 때 토스트 닫기 + 세대 번호 증가), `:399`(이전 세대 되돌리기 무시) |
| UQ-S10-7 | Minor | 해결 | `project-page.tsx:646` `aria-label="{섹션} AI 제안 보기"` |
| UQ-S10-8 | Minor | 해결 | `project-page.tsx:113-117`(분류 행은 트리거 버튼에 포커스), `:573-583` `describedBy="err-{필드}"` → `doc-inputs.tsx:214`, `:277` `aria-describedby`·`aria-invalid` (파운데이션 요청 6 반영, DOM 우회 코드 삭제 확인) |
| UQ-S10-9 | Minor | 해결 | `details/[[...rest]]/page.tsx:18-25`, `writing-chats/new/page.tsx:20-24`. SSR: `details/abc?focus=action&requirement_id=r1&chat=c1` → `/career/projects/{id}?focus=action&requirement_id=r1&chat=c1`, `writing-chats/new?experience_id=…&requirement_id=r1` → `/career/projects/new?experience=…&requirement_id=r1` |
| UQ-S10-10 | Minor | 해결 | `input-guide.tsx:17` 명세 문구 그대로("…배경은 상황에 써 주세요") |
| UQ-S10-11 | Minor | 해결 `[UI-가정]` | `career-v45-shared.ts` 받침 조사 + 이름 빔 = "이 프로젝트를 함께 정리해 볼게요…"(SSR `?state=new` 확인, "'새 프로젝트'을" 0건). 이름 빔 문장은 기획 확인 유지(아래 7번) |
| UQ-S10-12 | Minor | 해결 | `return-banner.tsx:116`, `:161-163` — L-02 경로에서는 sticky 없는 `ShellBanners` 배너 |
| UQ-S10-13 | Minor | 해결 | `star-proposal-card.tsx:243-251`, `:440` — `patchDraft(p, { inline: true })` + `panel.patchRefusal` → 섹션 아래 `PANEL_COPY.alreadyApplied`, 토스트 없음 |
| UQ-S10-14 | Minor | 미해결 — 백엔드 이관 | `src/server/ai/context-pack/focus-slots.ts`의 칩 표 중복은 그대로. v4.5 연결(DM 11.3) 때 `resumate-backend`가 지우거나 `quick-chips.ts` 상수 사용 — 화면 쪽 할 일 없음 |
| K1·K2 | 기획 | 리더 판정 반영 | K1: "이미 직접 고른 분류는 바꾸지 않았어요"만, 그 분류 행 아래에만(`star-proposal-card.tsx:647`). AI-12 문구 "이미 고른 값이 있어요"는 SSR에 0건. K2: UX 문구 유지 |

### S-43 / S-44 / C-23 (`25_ui-qa_A2-S44_review.md`)

| ID | 심각도 | 결과 | 확인 내용 (코드 위치) |
|---|---|---|---|
| UQ-S44-1 | Major | 해결 | `evidence.ts:120-131` — 산출물 근거 → `routes.deliverable(id, { range })`(본문 근거면 `source_locator` 구간). 소속 프로젝트 근거 → S-10 `?focus=` 칸, 독립 → S-43 |
| UQ-S44-2 | Major | 해결 | `deliverable-route.tsx:34` `parseRangeParam(sp.range)` → `deliverable-page.tsx:320-331` 한 번 `highlightRange` + 스크롤, 못 찾으면 토스트. SSR `?range=0-10` 200 (선택·스크롤은 브라우저 미확인) |
| UQ-S44-3 | Minor | 해결 | `deliverable-page.tsx:256-258`(대화 바뀌면 지움), `deliverable-draft-card.tsx:92`(`panel.failure !== null` 조건) |
| UQ-S44-4 | Minor | **부분 해결** | 카드 = 제목 문장 + C-20 `AiErrorNotice`(`deliverable-draft-card.tsx:202-215`), 목록 C-20은 `hideDraftTurnFailure`(`ai-panel.tsx:84`)로 숨김. 단 목록 숨김 조건은 `failure.requested_action === "compose_draft"`뿐이고 카드 조건은 `draftFailed`(초안 턴 중 실패)도 포함한다(`deliverable-draft-card.tsx:92`). 칩 없이 "초안 써 줘"처럼 입력해 초안 턴이 된 경우 **카드 "다시 시도"와 목록 "다시 보내기"가 함께 남는다**(E2 보고 `[UI-가정]`). → 페이지가 아는 `draftFailed`를 `AiPanel`에 넘겨 목록 숨김 조건에 더하기(foundation `hideDraftTurnFailure`를 boolean 판정 함수/값으로) |
| UQ-S44-5 | Minor | 해결 | `freeTierLine("writing_chat_turn")`(`deliverable-draft-card.tsx:190`), 단계 문구 `DRAFT_STAGE_COPY`(`career-v45-shared.ts`) — "초안 작성 중" 원천은 기획 확인(7번) |
| UQ-S44-6 | Minor | 해결 | `writing-chat-turn-v45.ts:192` `bodyHash: await bodyHash(formBody)` |
| UQ-S44-7 | Minor | 해결 | `career-v45.ts:446-447` 미리보기 `deliverable-limit`에서 새 산출물 저장 거부(아무것도 안 씀) |
| UQ-S44-8 | Minor | 해결 | `deliverable-page.tsx:187-190` `invalid`(다시 시도 권유 없음), 입력 때 문구 지움 |
| UQ-S44-9 | Minor | 해결 | `deliverable-page.tsx:433`, `:456` `dlv-body-error` 연결 |
| UQ-S44-10 | Minor | 해결 | `deliverable-draft-card.tsx:589-592`, `:693-696` `aria-label="‘{앞 문장}’ 수락/빼기/거절"` |
| UQ-S44-11 | Minor | 해결 | `deliverable-draft-card.tsx:101` key = `chat:applied`(rev 없음) |
| UQ-S44-12 | Minor | 해결 | `deliverable-page.tsx:212-213` 보낸 원소만 제거(참조 비교). 저장 중 같은 대화를 다시 채우면 새 원소가 남는 것도 확인(`:292`) |
| UQ-S44-13 | Minor | 해결 | `actions.ts:198-201` `deleteDeliverableAction`(refresh 없음) → `deliverable-page.tsx:504-508` 바로 S-43 `replace`. 같은 문제가 S-10 삭제에 남음 → UQ-INT-1 |
| UQ-S44-14 | Minor | 해결 `[UI-가정]` (리더 수용) | `deliverable-page.tsx:192-195` 입력 유지 + 머리 아래 문구 + "프로젝트로 가기" |
| UQ-S44-15 | Minor | 해결 | `career-overview.tsx:241-245` 안내 줄을 메뉴 항목 안으로 |
| UQ-S44-16 | Minor | 해결 | `delete-confirm-dialog.tsx:228-230` 산출물은 영향 조회 뒤 결과가 있을 때만 선택지 |
| UQ-S44-17 | Major | 해결 (mock 경로) | `data-gate.tsx:85`, `:131-145`, `insight-view.tsx:409-428`, `choose-project-affiliation.tsx` → `AddProjectDialog mode="choose"` → "계속" = S-10 새 페이지 `?requirement_id=`(`add-project-dialog.tsx:72-76`). **실제 readiness 경로에서는 C-23에 닿지 않는다** → UQ-INT-4 |
| P-2 | 기획 | 해결 `[UI-가정]` | 파운데이션이 `?range={start}-{end}`로 정함(`routes.ts:57-62`) |
| P-3 | 리더 판정 | 해결 | `deliverable-draft-card.tsx:261` "마무리 중" 없음, `draft_done`까지 "초안 작성 중" |
| (범위 밖 관찰) S-43 `summary` | — | 해결 | `career-overview.tsx:463-464` `p.description` 읽기, 수정 모달 `description ?? summary`(파운데이션 요청 6) |

### 수정 파일 회귀 점검

수정이 들어간 파일(`project-page.tsx`, `star-proposal-card.tsx`, `deliverable-page.tsx`, `deliverable-draft-card.tsx`, `deliverable-route.tsx`, `career-overview.tsx`, `add-project-dialog.tsx`, `actions.ts`, `data-gate.tsx`, `choose-project-affiliation.tsx`, `return-banner.tsx`, `delete-confirm-dialog.tsx`, `doc-inputs.tsx`, `input-guide.tsx`, `career-v45*.ts`, `evidence.ts`, `routes.ts`, 폐기 경로 3개)를 다시 읽었다. 회귀는 찾지 못했다. 라운드 1에서 고친 문제와 **같은 모양이 다른 화면에 남은 것** 두 건을 새 이슈로 올린다(UQ-INT-1 S-10 삭제 깜빡임 = UQ-S44-13과 같음, UQ-INT-2 S-44 건너뜀 줄 = UQ-S10-2와 같음).

## 2. 통합 Q5 — 화면 사이 경로

| 경로 | 결과 | 근거 |
|---|---|---|
| S-08 프로젝트 카드 → S-10 | ✅ | `career-overview.tsx:611` `routes.projectPage(p.id)` |
| S-08(S-09·S-34 패널) "+ 프로젝트 추가" → S-10 새 페이지 | ✅ | `career-overview.tsx:385`, `:419` `projectPageNew({experience|education})`. SSR `?item=experience:…`에 `/career/projects/new?experience=` 링크 |
| S-10 → 소속 S-08 복귀(이동 줄·삭제 뒤) | ✅ | `project-page.tsx:214` 이동 줄 = 폼 소속(소속 변경을 따라감), 삭제 뒤 = 저장된 소속(`:770`). 독립 id로 S-10 → `?item=project:` (SSR `NEXT_REDIRECT;replace;/career?item=project:…6`) |
| S-43 산출물 행 → S-44, "+ 산출물 추가" → S-44 새 | ✅ | `career-overview.tsx:490`, `:510`. SSR S-43 행 링크 2개, 빈 목록(`…0007`)은 빈 상태 + 추가 |
| S-44 이동 줄 → S-43, 삭제 → S-43 | ✅ | `crumbHref` = `careerItem("project", …)`, 삭제는 refresh 없는 액션 뒤 `replace` |
| 소속 프로젝트에 S-44 새 산출물 | ✅ | `deliverable-route.tsx:32` → `AffiliatedRedirect` → S-10 + 토스트 (SSR 확인) |
| C-22 → C-23 ① → S-43 "프로젝트 정보 편집 중" | ✅ | `career-overview.tsx:250-258` → `onAdded(…, { edit: true })` → 목록에 행이 생기면 수정 모달(`:150-160`) |
| C-09 / S-16 보완점 → C-23 ② 소속 선택 → S-10 새(`requirement_id` 유지) | ✅ (mock) / ❌ (실제 readiness) | `choose-project-affiliation.tsx:28-49` → `add-project-dialog.tsx:72-76`. `writing-chats/new` 옛 링크도 `requirement_id` 유지. 실제 경로 문제는 UQ-INT-4. C-23 ② "소속 없음 → 만들기" 뒤 편집 열림 없음은 UQ-INT-3 |
| C-02 / C-08 근거 → S-10 `?focus=`, S-44 `?range=` | ✅ | `evidence.ts:103-108`(소속 → `focus`, 독립 → S-43), `:120-131`(산출물 → `range`), 레거시 상세 내용 → S-10 `focus` |
| C-10 복귀 배너 다음 단계 | ✅ (mock 모양 기준) | `return-banner.tsx:55-60` — 제안 프로젝트 → S-10 `?focus=star`, 새 프로젝트 → 방금 저장한 경력의 S-10 새 페이지. S-10에서는 링크 숨김(`:62-64`). 실제 경로 모양 문제는 UQ-INT-4와 같은 뿌리(shim이 `create_project`를 `form`으로 바꿔 링크 없음) |
| 폐기 경로 `projects/[id]/details/**` | ✅ | → S-10(`focus`·`requirement_id`·`chat` 유지), `details/new` → S-10 |
| 폐기 경로 `writing-chats/new` | ✅ | `project_id` → S-10, `experience_id` → S-10 새(`?experience=`), 조건 없음 → S-08 |
| 폐기 경로 `writing-chats/{id}` | ✅ | 프로젝트 대화 → S-10 `?chat=`, 산출물 대화 → S-44 `?chat=`, 없는 id → S-08 (SSR 확인) |
| 지운 라우트 헬퍼·컴포넌트 남은 참조 (`src/` 전체 grep) | ✅ | `routes.projectNew/project/projectDetail/projectDetailNew/writingChatNew/writingChat` 호출 0건. `detail-form`·`project-form`·`star-fill`·`components/career/writing-chat/*` import 0건(주석의 "Moved from …" 3곳만). 문자열 경로는 `dev-state-gallery.tsx:202`의 `"/career/projects/new"`(소속 없음) 1건 → UQ-INT-5 |

### L-01 ↔ L-02 셸

| 항목 | L-01 (`(dashboard)`) | L-02 (`(page)`) | 판정 |
|---|---|---|---|
| 이동 경로 | `PageCrumbs`(S-08 "커리어") | `CrumbRow` "{소속} › {프로젝트명|새 프로젝트} › 프로젝트 상세" / "{프로젝트명} › {산출물} › 산출물 상세" (SSR 확인) | ✅ 명세대로 다름 |
| 계정 메뉴 | `NavUser` 2항목(설정·로그아웃) | 5항목 | 기획/리더 확인 대기(22 보고, 아래 7번) — 이슈로 세지 않음 |
| 장애 배너(S-28) | `AiOutageSlot` | `PageShellOutageSlot` → ShellBar 아래 portal, 같은 `AiOutageBanner`·`?state=ai-outage` | ✅ (UQ-PA-17 리더 판정) |
| 오류 경계 | `(dashboard)/error.tsx` | `(page)/error.tsx` | ✅ |
| C-10 배너 | sticky `top-16` | `ShellBanners` 안 둥근 배너 | ✅ |
| 동의 게이트·탈퇴 가드·미리보기 스위처·작업 감시 | 있음 | 같은 구성(`(page)/layout.tsx`) | ✅ |

## 3. 새 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|---|---|---|---|---|---|---|---|
| UQ-INT-1 | Minor | E1 | S-10 ⋯ 프로젝트 삭제 | 02 S-10 머리 메뉴 "프로젝트 삭제 → C-05 → 삭제 후 S-08(소속 선택)" (UQ-S44-13과 같은 규칙) | `src/components/career/project-page/project-page.tsx:763` → `src/components/career/actions.ts:187-194`(`deleteCareerItemAction`이 `refresh()`) · `src/app/(page)/(gated)/career/projects/[id]/page.tsx:41` | 삭제 뒤 곧바로 S-08 | 서버 액션의 `refresh()`가 지금 라우트(S-10)를 먼저 다시 그려 행이 없으니 ST-NOTFOUND "찾을 수 없는 페이지예요"가 잠깐 보인 뒤 `router.replace`가 이동한다(코드 판단, 브라우저 확인 필요). S-44는 refresh 없는 액션으로 고쳤는데 S-10은 그대로 → S-10도 refresh 없는 삭제(또는 S-44와 같은 area 액션)를 쓴다 |
| UQ-INT-2 | Minor | E2 | S-44 저장 응답 건너뜀 | 02 S-44 반영 규칙 "`skipped` 사유는 S-10 '저장 응답의 건너뜀'과 같은 문구" · S-10 "`not_found`(대화가 지워짐) '대화가 삭제돼 반영 기록은 남기지 않았어요'" · C-05 대화만 삭제 "저장은 성공하지만 그 반영 기록은 남지 않는다(`skipped` `not_found`)" | `src/components/career/deliverable/deliverable-page.tsx:230`(`r.skipped[0]`만), `:476`(`skip.chatId === p.chat?.id`일 때만 카드에) | 이번 저장의 건너뜀 줄이 보인다(S-10 UQ-S10-2 수정과 같은 모양) | 첫 원소 하나만 기억하고, 그 대화의 카드가 열려 있을 때만 그린다 → 채운 대화를 지운 뒤 저장하면(`not_found`) 문구가 나올 자리가 없고, 다른 대화의 건너뜀도 안 보인다. S-10처럼 열린 카드 밖 건너뜀은 페이지 줄로 |
| UQ-INT-3 | Minor | foundation | C-23 ② "소속 없음" → 만들기 | 02 C-23 주 버튼 "'만들기' → `projects` 행 생성(`draft`, 소속 없음) → **S-08 `?item=project:{id}`(S-43, 프로젝트 정보 편집 중)**" (①·②-독립 공통) | `src/components/common/choose-project-affiliation.tsx:48` (`router.push(routes.careerItem("project", id))`만) · 비교 `src/components/career/career-overview.tsx:150-160`(C-22 경로는 `{ edit: true }`로 수정 모달) | C-09·S-16에서 독립 프로젝트를 만들어도 S-43에서 프로젝트 정보 편집이 열린다 | S-43 선택만 되고 편집은 열리지 않는다. C-22 경로와 결과가 다르다. → URL로 넘길 신호(예: `?item=project:{id}&edit=info` `[UI-가정]`)를 S-08이 읽어 같은 `pendingEdit`를 쓰게 |
| UQ-INT-4 | **Major** | foundation | C-09 데이터 부족 게이트 (FL-13, C-10 포함) | DM v4.5 6장(v4.4) "`hints`: `complete_project_detail` → **`project_star`**, **`project_fields` 의미 변경**(프로젝트 내용이 빈 `draft` 독립 프로젝트) / `next_action` `create_project` / `suggested_mode` 삭제" · 02 C-09 "`create_project` → **C-23 소속 선택**", 보조 안내 "`project_star` → '프로젝트는 있지만 STAR의 상황·행동이 비어 있어요' + `counts.projects_without_complete_star` / `project_fields` → ''{프로젝트명}'의 프로젝트 내용이 비어 있어요'", `form` + `suggested_project_id` "**'{프로젝트명}' 마저 채우기**: `project_star` → S-10 빈 STAR 칸 / `project_fields` → S-08 `?item=project:{id}`(S-43), '프로젝트 내용' 섹션 편집 열림 … 독립 프로젝트를 S-10으로 보내지 않는다", 제목 `project_fields` "한 칸만 채우면 바로 쓸 수 있어요" | `src/lib/data/readiness.ts:127-140`(`toLegacyReadiness` shim: `create_project` → `form`, `project_star` → `complete_project_detail`) · `src/types/db.ts:1136`, `:1146`, `:1157-1159`(v4.2 이름 `complete_project_detail`·`suggested_mode`·`projects_without_complete_detail`) · `src/components/common/data-gate.tsx:70-72`, `:97-103`, `:122-127`, `:147`, `:182`, `:199`, `:251` · `src/components/common/return-banner.tsx:55-60` | C-09가 v4.4 readiness를 그대로 읽고 명세 v5.6 분기대로 간다 | ① **실제 경로**: shim이 `create_project`를 `form`으로 바꿔 주 버튼이 "경력 먼저 입력하기"(→ S-09 새 경력)가 된다 — 경력이 이미 있어도 C-23 소속 선택에 닿지 않는다(UQ-S44-17은 mock에서만 동작). C-10 다음 단계 링크도 같은 이유로 사라진다. ② `project_fields`: 제목·안내가 v5.3 A18 "두 칸만 / 이름이나 역할이 비어 있어요"(`:97-103`, `:199`)이고, 이동이 S-10 `?focus=star`(`:147`) → 독립 id라 S-43으로 redirect되지만 "프로젝트 내용" 편집은 열리지 않는다. ③ `project_star` 안내 줄 없음 — 옛 `complete_project_detail` 문구 "완료된 상세 내용이 없어요(제목·상황·행동)"(`:182`, mock에서 보임). ④ `form` + `project_star` + 제안 프로젝트(키 없음)에 "'{프로젝트명}' 마저 채우기" → S-10 빈 STAR 칸이 없다(지금은 "직접 입력하기" → 작성 중 첫 프로젝트). shim에 "연결 대기" 표시가 있지만 화면 문구는 mock에서도 틀리므로 지금 고칠 항목. → `DataReadinessV44`를 화면 타입으로 올리고(types/db.ts) C-09·C-10을 v5.6 분기로 다시 짜며, mock(`readiness.ts:68-69`)도 v4.4 모양으로 |
| UQ-INT-5 | Minor | foundation | 개발 상태 모음 | 02 S-10 URL "`/career/projects/new?experience=` 또는 `?education=`" · ui-context `?state=` 미리보기 | `src/components/common/dev-state-gallery.tsx:202` (`alternativeHref="/career/projects/new"`) | 대안 링크가 열리는 화면 | 소속 없는 새 페이지 → S-08 + "찾을 수 없는 항목이에요"(SSR `/career/projects/new?state=new` 확인). 개발 화면 한정. `routes.career()` 또는 mock 경력 id로 `projectPageNew` |

## 4. 기계 검사

| 검사 | 결과 |
|---|---|
| `pnpm lint` | 통과 (exit 0, 경고 0) |
| `pnpm typecheck` | `.next/dev` 지운 뒤 통과 (exit 0, `next typegen` + `tsc --noEmit`) |
| `pnpm test` | 119파일 중 117 통과, 1,840개 중 **1,837 통과 / 3 실패**. 실패는 `src/lib/data/career.integration.test.ts`(1) · `src/server/services/writing-chat/writing-chat.integration.test.ts`(2), 모두 `PGRST202 Could not find the function public.apply_writing_chat_proposal` — 알려진 로컬 Supabase 3건과 같고 **그 밖의 실패 없음** (범위 밖) |
| `pnpm build` | `.env.local` 없음 → 임시 공개 env(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `_ANON_KEY=placeholder`, `_SITE_URL`)로 **성공**(exit 0). `/career/projects/[id]`, `/new`, `/[id]/deliverables/new`, `/[id]/details/[[...rest]]`, `/career/deliverables/[id]`, `/career/writing-chats/*` 포함 |
| 개발 서버 SSR | `next dev --port 3623`(같은 임시 env), 42개 URL 모두 200, 서버 오류 0, 확인 뒤 종료. 아래 표 |

| 묶음 | URL(요약) | 결과 |
|---|---|---|
| S-08 / S-43 / S-09 패널 | `/career?state=default·empty·deliverable-limit`, `?item=project:…6`(산출물 2행), `…7`(빈 목록), `?item=experience:…` | 200, 링크 확인 |
| S-10 | `default·needs-review·skipped·chat-closed·return-banner·ai-outage·not-found·standalone`, `?focus=action&requirement_id=`, 독립 id | 200. `standalone`·독립 id → `/career?item=project:` redirect. "(7개월)", [모두 반영] 1개, 분류 문구 K1대로 |
| S-10 새 | `?experience=`·`?education=`·옛 `?experience_id=` `state=new`, 소속 없음 | 200. 시작 인사 "이 프로젝트를 함께 정리해 볼게요", 소속 없음 → S-08 + 토스트 |
| S-44 | `default·draft-ready·draft-failed·return-banner·ai-outage·not-found`, `?range=0-10`, 새 산출물 `new·deliverable-limit`, 소속 프로젝트 새 산출물 | 200. 소속 → `AffiliatedRedirect`(S-10) |
| 폐기 경로 | `details/abc`, `details/new`, `writing-chats/new`(3종), `writing-chats/{id}`·없는 id | 모두 기대한 `NEXT_REDIRECT;replace` |
| 그 밖 | S-16 인사이트 `default·empty`, S-13, `/dev/states` | 200 |

클라이언트에서만 그려지는 상태(`return-banner`·`ai-outage` 배너, 저장 뒤 `skipped` 줄, 초안 실패 줄, 구간 강조·포커스)는 SSR 문자열로는 보이지 않아 코드 경로로 확인했다. **브라우저 확인 권장**: UQ-INT-1 깜빡임, S-44 `?range=` 선택·스크롤, S-10/S-44 저장 중 채우기, C-23 ② "계속" 이동.

## 5. 남은 이슈 (이번 런 최종)

| 심각도 | ID | 담당 |
|---|---|---|
| Major | UQ-INT-4 (C-09 v4.4 readiness·v5.6 분기) | foundation |
| Minor | UQ-S44-4 (부분: 입력으로 시작한 초안 턴의 실패 다시 시도 2개) | foundation + E2 |
| Minor | UQ-INT-1 (S-10 삭제 뒤 ST-NOTFOUND 깜빡임) | E1 |
| Minor | UQ-INT-2 (S-44 건너뜀 줄 자리) | E2 |
| Minor | UQ-INT-3 (C-23 ② 독립 만들기 뒤 편집 안 열림) | foundation |
| Minor | UQ-INT-5 (개발 상태 모음 링크) | foundation |
| 이관 | UQ-S10-14 (서버 칩 표 중복) | 백엔드 |

## 6. 담당별 전달

- **foundation**: UQ-INT-4(Major), UQ-INT-3, UQ-INT-5, UQ-S44-4 패널 쪽(목록 C-20 숨김 조건에 페이지의 `draftFailed`를 더할 수 있게)
- **E1 (S-10)**: UQ-INT-1
- **E2 (S-44)**: UQ-INT-2, UQ-S44-4 카드 쪽(파운데이션 변경 뒤 prop 연결)
- **백엔드(`resumate-backend`)**: UQ-S10-14 — v4.5 연결 때 `focus-slots.ts` 칩 표 제거 또는 `quick-chips.ts` 상수 사용
- **ui-designer**: 22 보고 UQ-PA-5 후속 "Esc 후 Tab = 칸 나가기"·들여쓰기 깊이 상한 5.9 규칙(이전 라운드 요청, 반영 여부 확인 필요), 아래 P-15~P-20

## 7. 기획 확인 필요 — 이번 런 보고 모음 (`_workspace/ui/2*_*.md`)

| # | 출처 | 화면 | 내용 | 상태 |
|---|---|---|---|---|
| 1 | 24 E2 · 25 S44 P-1 | C-22 · C-23 ① | PR #8에서 사용자가 고른 피그마 1009:2 일괄 추가 모달(이름·역할·기간·기술·링크·내용)을 명세·D-UX-28 (a)대로 이름 다이얼로그 → 수정 모달 2단계로 바꿨다. 일괄 모달 유지가 사용자 의도면 되돌려야 함 | **사용자 답 대기** |
| 2 | 25 S10 K2 | AI-12 ↔ S-10 | 이름 없음 문구가 AI-12("프로젝트명을 먼저 입력해 주세요")와 UX("대화를 시작하려면 프로젝트명을 먼저 입력해 주세요")에서 다르다. K1도 AI-12 "이미 고른 값이 있어요" ↔ UX. 화면은 UX로 정리됨 — AI-12 문서를 UX에 맞춰 달라 | 리더 판정(UX) 완료, 문서 정리 요청 |
| 3 | 24 E1 | S-10 | "AI에게 물어보기"가 보내는 고정 문구 | 대기 |
| 4 | 24 E1 | S-10 | 기간 제안(`structured_draft.project.*`)을 카드에 어떻게 보일지(디자인 3.24에 없음) | 대기 |
| 5 | 24 E1 | S-10 · C-15 | "본인 역할 확인 중" 클릭 목적지(되묻기 메시지 id가 `clarifications[]`에 없음) | 대기 |
| 6 | 24 E1 | S-10 | [모두 반영] 되돌리기 범위(전체 한 번 vs 섹션별) | 대기 |
| 7 | 25 S10 UQ-S10-11 · 22 | S-10 · S-44 | 이름이 빈 새 페이지의 시작 인사 문장("이 프로젝트를 함께 정리해 볼게요…" `[UI-가정]`) | 대기 |
| 8 | 22 | S-44 · AI-13 | 회고 슬롯 1 "무엇을 했나(범위)"에 `scope`(기획서 슬롯 4와 같은 키)를 재사용하는 것이 맞는지 | 대기 |
| 9 | 22 | S-44 · AI-13 | `base_body_hash` 정규화 규칙(공백·줄바꿈)과 형식 | 대기 |
| 10 | 22 | S-44 · AI-13 | 초안 6회 상한 때 칩 3개 구성(위치·중복) | 대기 |
| 11 | 22 · 23 | L-01 ↔ L-02 | L-02 계정 메뉴 5항목(기본 프로필·AI 연결·처리방침 포함)을 L-01에도 맞출지 — 지금 L-01은 2항목(Q-10 리더: L-01 변경 안 함) | 대기 |
| 12 | 22 | L-02 | 이탈 확인 다이얼로그 설명 문구 | 대기 |
| 13 | 24 E2 · 22 | S-44 · C-03 | "초안 작성 중"(`compose` 단계 문구)의 원천 — C-03에 상수가 없어 `DRAFT_STAGE_COPY` `[UI-가정]`. 칩 없이 입력한 초안 턴을 패널이 초안 턴으로 알아볼 기준(UQ-S44-4 부분과 관련) | 대기 |
| 14 | 24 E2 · 22 | S-44 | C-02 근거 구간 전달을 `?range={start}-{end}`(id·오프셋만)로 정함 `[UI-가정]` — 명세에 형식 반영 여부 | 구현 완료, 명세 반영 확인 |
| 15 | 24 E2 · 리더 | S-44 | `deliverable_requires_standalone_project` 때 입력 유지 + "프로젝트로 가기"(UQ-S44-14 `[UI-가정]`) — 명세 "S-10으로 `[가정]`"과 다름 | 리더 수용, 명세 반영 확인 |
| 16 | 24 E2 | S-44 | "마무리 중" 제거(P-3 리더 판정) — 02 S-44 AI 응답 방식·디자인 시스템 3.25 문구 정리 필요 | 리더 판정 완료, 문서 정리 요청 |
| 17 | 21 ui-designer P-15 | S-08·S-09·S-34·C-22·C-24·C-25 | v5.5 커리어 화면 시각 규칙이 디자인 시스템에 없음(구현이 앞섬) | 대기 |
| 18 | 21 ui-designer P-16 | 패널 | "대화 목록 아래 고정"의 뜻 | 대기 |
| 19 | 21 ui-designer P-17 | 제안 카드 | 직접 고치기 완료 버튼 글자 | 대기 |
| 20 | 21 ui-designer P-18 | S-44 카드 | 블록 [빼기] 되돌리기 없음 | 대기 |
| 21 | 21 ui-designer P-19 | L-02 | "새로 불러오기" 경고 문구 | 대기 |
| 22 | 21 ui-designer P-20 | C-15 ⑤ | 반영됨에 방식(교체/덧붙임) 표시 여부 | 대기 |
| 23 | 20 (W5) | AI-03 | `omitted`의 표시 이름을 서버가 보낼지(생성 중 삭제된 프로젝트 이름 유지) | 대기 |
| 24 | 20 (W5) | AI-03 | `user_excluded`가 "직접 뺀 것"과 "8개 상한으로 잘린 것"을 함께 뜻함 — 문구를 나누려면 이유 값 분리 | 대기 |

이미 닫힌 것(참고): Q-7~Q-10(리더 판정, 22 보고 머리말), UQ-PA-17 L-02 장애 배너(리더 판정, 반영됨), P-2(파운데이션이 형식 결정), P-3(리더 판정).
