# UI QA — A2 S-43 산출물 섹션 · S-44 산출물 상세 · 본문 초안 카드 · C-23 (라운드 1)

- 작성: ui-qa / 2026-11-03
- 대상: 엔지니어 E2 보고 `24_frontend-engineer-A2-S44_report.md`
- 기준: 플로우 v5.6 (1.3a L-02, FL-22, S-43, S-44, C-05, C-15, C-22, C-23) · AI v4.6 AI-13 · DM v4.5 2.5.0 · 2.5.1 · 3.3 · decisions 3.10 D-UX-28 (a) · 디자인 시스템 v4 (3.14 v4, 3.23, 3.25, 5.8~5.10, 6장 A2)
- 범위 밖(E1 진행 중): S-10 `(page)/(gated)/career/projects/new|[id]`, `star-proposal-card.tsx`, `(dashboard)/…/projects|writing-chats` 정리
- 점검 방법: 코드 정독 + 개발 서버 SSR 확인(포트 3611에 이미 떠 있던 같은 worktree 서버 사용 — 새 서버는 "Another next dev server is already running"으로 거부됨). 브라우저 도구 없이 HTML만 받아 봤으므로 **클릭·입력·포커스·좁은 화면 동작은 코드 판단**이다.

## 요약

- **Critical 0 / Major 3 / Minor 14**
- 기계 검사: lint 통과(경고 0) · typecheck 통과(첫 실행은 E1의 `routes.ts` 정리 중 10건 실패 → 다시 실행 통과) · 관련 vitest 8파일 72개 통과(전체 118파일 중 로컬 Supabase 통합 테스트 2파일 3건 실패 — v4.4 RPC `apply_writing_chat_proposal` 없음, 이번 범위와 무관) · build 통과(임시 공개 env)
- 블록 단위 채우기 규칙(`draft-fill.ts`)은 명세와 일치한다: 미수락 `needs_review` 제외, 자식 없는 제목 제외, 덧붙이기 = `basis = new` + 바로 앞 제목, 빈 본문 → [본문에 넣기] 하나(`replace`), `replace_allowed = false` → [본문 교체] 숨김 + 안내, `new` 없음 → [뒤에 덧붙이기] 비활성 + 이유 줄, 전부 미수락 → 전부 비활성 + 이유 줄, 20,000자 초과 → 채우지 않음, hash 불일치 → 교체 확인 문구 변형, 초안 상한 6, 초안 실패 시 이전 초안 유지. 저장 상태·변경 충돌·이탈 확인·입력 보존(UQ-PA-21 대응 포함)도 명세대로 배선됐다.
- Major는 모두 **진입 경로**다: C-02·C-08의 산출물 근거가 S-44로 가지 않고(href null), 근거 구간 강조가 없고, C-23 ②(소속 선택)가 C-09·S-16에 연결되지 않았다.

## 화면별 점검표

| 화면 ID | Q1 행 | Q2 문구 | Q3–4 타입 | Q5 라우트 | Q6 상태 | Q7 AI | Q8 디자인 | Q9 접근성 | Q10 좁은 화면 |
|---|---|---|---|---|---|---|---|---|---|
| S-43 산출물 섹션 | ✅ | ✅ | ✅ | ✅ | ✅ (`deliverable-limit`; 빈 목록은 `?state=` 없이 독립 프로젝트 `…0007`로 확인) | — | ✅ | ⚠️ (UQ-S44-15) | ✅ (행 `min-h-11`) |
| S-44 기존 (`/career/deliverables/{id}`) | ⚠️ (UQ-S44-2) | ✅ | ✅ | ❌ (UQ-S44-1) | ✅ | ✅ | ✅ | ⚠️ (UQ-S44-9) | ✅ (코드 판단) |
| S-44 새 (`/career/projects/{id}/deliverables/new`) | ✅ | ✅ | ✅ | ✅ (replace, 소속 → S-10 + 토스트) | ⚠️ (UQ-S44-7) | ✅ | ✅ | ✅ | ✅ (코드 판단) |
| 본문 초안 제안 카드 | ✅ | ⚠️ (UQ-S44-5) | ✅ | — | ⚠️ (UQ-S44-3·6) | ⚠️ (UQ-S44-4) | ⚠️ (UQ-S44-4·11) | ⚠️ (UQ-S44-10) | ✅ (sticky 바닥) |
| S-44 저장·충돌·이탈·보존 | ✅ | ✅ | ✅ | ⚠️ (UQ-S44-14) | ⚠️ (UQ-S44-8·12) | — | ✅ | ✅ | — |
| S-44 삭제 (C-05 `project_deliverable`) | ✅ | ✅ | ✅ | ✅ | ⚠️ (UQ-S44-13·16) | — | ✅ | ✅ | — |
| C-22 → C-23 ① 새 독립 프로젝트 | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ (Dialog, `[UI-가정]`) |
| C-23 ② 소속 선택 | ✅ (컴포넌트) | ✅ | ✅ | ❌ (UQ-S44-17) | — | — | ✅ | ✅ | ✅ |

SSR 확인(모두 200): S-44 `draft-ready`(본문 초안·새 내용·남은 횟수·아직 비어 있는 부분·뺀 문장·AI 초안 있음·[본문에 넣기]), `needs-review`(경고 문구·[수락]·[빼기]·"검토하지 않은 문장 N개"·"확인이 필요한 내용"), `draft-limit`("초안 남은 횟수 0" + 상한 문구 + 칩 "빠진 부분 물어봐 줘"·"새 대화 시작"), `not-found`(ST-NOTFOUND "커리어로 가기"), `affiliated-parent`·소속 프로젝트 새 산출물(스켈레톤 → 클라이언트 이동), `ai-locked`(C-18 + S-44 기능 설명, "AI와 초안 쓰기" 없음), `skipped`, `empty`, `loading`, 새 산출물 `new`(시작 인사·고정 안내·칩 3개)·`deliverable-limit`, S-08 `deliverable-limit`(비활성 + 이유 줄) · 산출물 행 2개 링크.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|---|---|---|---|---|---|---|---|
| UQ-S44-1 | **Major** | foundation | S-44 진입 (C-02·C-08) | 02 S-44 "진입: … C-02(산출물 근거 → 본문 구간 강조), C-08" · C-08 "산출물이 근거면 S-44로 이동"(v5.5) | `src/lib/data/evidence.ts:112-124` (`href: null`, 주석 "no S-44 route in the current UI yet") | 산출물 근거 칩·"커리어에 추가하기"가 `routes.deliverable(d.id)`(+ 구간)로 간다 | S-44 라우트가 생겼는데 근거 해석이 여전히 `href: null` → 인사이트·서류·면접의 산출물 근거에서 S-44로 갈 길이 없다(죽은 진입점). `evidence-real.ts`가 같은 해석을 쓰므로 실제 경로도 같음 |
| UQ-S44-2 | **Major** | E2 (UQ-S44-1 뒤) | S-44 근거 구간 강조 | 02 S-44 머리·본문 표 "근거 구간 강조: C-02에서 왔으면 `source_locator` `{start, end}` 구간을 강조하고 그 자리로 스크롤 · 본문을 고치면 강조를 지운다" | `src/components/career/deliverable/deliverable-page.tsx` (행 없음 — 보고서 "미완료") · `src/lib/routes.ts:64` (`deliverable(id, {chat})`에 구간 인자 없음) | 진입 시 본문 칸에서 그 구간 선택·스크롤, 입력하면 해제 | 행 자체가 없다. `highlightRange`(`doc-inputs`)는 이미 있으므로 foundation이 `routes.deliverable(id, { chat, range })`(id·오프셋만 — 내용은 URL에 넣지 않음)를 주면 E2가 `useEffect`로 한 번 강조하면 된다. 기획 결정은 필요 없다(아래 "기획 확인 필요" 참고) |
| UQ-S44-17 | **Major** | foundation (+ A3 `insight-view.tsx`) | C-23 ② 소속 선택 진입 | 02 C-23 "② 소속을 골라야 할 때 — C-09 `create_project`·'직접 입력하기'(작성 중 항목 없음)·'경력이 없을 때'의 후속, S-16 보완점 '관련 경험 추가하기'" · C-09 (v5.6) · FL-11·FL-13 (v5.6 "C-23 소속 선택 → S-10 새 프로젝트") | `src/components/common/data-gate.tsx:110-120` (옛 `routes.project`/`projectNew`/`writingChatNew`), `src/components/applications/insight-view.tsx:409-417` · 준비된 컴포넌트 `src/components/career/add-project-dialog.tsx:40-47` (`mode="choose"`) | C-09·S-16에서 `AddProjectDialog mode="choose"`가 열리고 "계속" → S-10 새 페이지(+ 복귀 대상) | 연결 없음(E2 보고 요청 2 "대기"). 진입점이 폐기 화면 경로(S-36 새 대화 등)를 그대로 가리킨다. 한 담당: foundation이 `data-gate.tsx`를 고치고 S-16은 리더가 A3에 같은 배선을 전달 |
| UQ-S44-3 | Minor | E2 | 본문 초안 카드 — 초안 실패 | 02 S-44 "초안 실패: … 카드 위 '초안을 만들지 못했어요. 이전 초안은 그대로예요 · 다시 시도'" (그 대화의 실패) | `deliverable-page.tsx:88`, `:257-266`, `:453` · `deliverable-draft-card.tsx:107`, `:207` | 실패 줄은 실패한 대화에서만, 다시 시도와 함께 | `draftFailed`는 페이지 상태라 대화를 바꿔도(`openChat`·`newChat`는 `panel.failure`만 지움) 남는다 → 다른 대화의 카드에 "초안을 만들지 못했어요"가 뜨고 `panel.failure`가 null이라 "다시 시도" 버튼도 없다. `onChatChange`에서 `setDraftFailed(false)`하거나 `draftFailed && panel.failure`로 판정 |
| UQ-S44-4 | Minor | E2 | 본문 초안 카드 — 초안 실패 표시 | 디자인 시스템 3.25 카드 상태 "초안 실패: 카드 맨 위에 **C-20 inline형** — 제목 줄 명세 문구 + 원인 문구 + `RetryButton`" | `deliverable-draft-card.tsx:196-223` (직접 만든 경고 상자 + `CAUSE_OK` 표) · `src/components/career/ai-panel/ai-panel.tsx:355-367` (같은 실패를 C-20 "다시 보내기"로 또 그림) | C-20(`AiErrorNotice size="inline"`)을 재사용하고, 같은 실패의 다시 시도는 한 곳 | 공통 컴포넌트를 쓰지 않고 색·아이콘·원인 문구 판정을 다시 구현했다(9개 코드만 원인 줄). 메시지 목록에도 실패한 턴 C-20이 그대로 나와 "다시 시도"와 "다시 보내기" 두 버튼이 같은 재시도를 한다. 초안 턴 실패면 목록 쪽을 숨기거나 카드 쪽을 `AiErrorNotice`로 바꾸고 하나만 남길 것 |
| UQ-S44-5 | Minor | E2 | 본문 초안 카드 — 초안 작성 중 머리 | 02 S-44 "`draft_started`: 카드 자리에 '초안 작성 중'(진행 단계 `compose`, **C-03 문구**)" · 3.25 "C-03 축약형 … (`compose` 단계 문구)" | `deliverable-draft-card.tsx:160-164`, `:186-189` | 단계 문구·무료 등급 문구를 C-03 공유 상수에서 | "초안 작성 중"·"무료 등급에서는 조금 더 걸릴 수 있어요"를 하드코딩. C-03에는 무료 등급 문구 함수(`ai-progress.tsx:164-167` "무료 등급이라 하나씩 처리해요 …")가 있다 — 같은 화면군에서 문구가 둘이 된다 |
| UQ-S44-6 | Minor | foundation (mock) | 본문 초안 카드 — hash 불일치 | 02 S-44 반영 규칙 "`base_body_hash`가 지금 폼 본문의 해시와 다르면 … '그래도 바꾸기'" · AI-13 "기준 본문이 바뀐 경우" | `src/lib/mock/writing-chat-turn-v45.ts:188-191` (`bodyHash` 안 넘김 → `base_body_hash: ""`) · `deliverable-draft-card.tsx:336` (`Boolean(body.base_body_hash) && …`) | 대화로 만든 초안도 만들 때의 폼 본문 해시를 갖고, 본문을 고친 뒤 교체하면 변형 확인이 뜬다 | mock 초안 턴의 해시가 빈 값이라 화면은 "같음"으로 본다 → `draft-ready` 미리보기 밖에서는 변형 확인을 볼 수 없다. mock이 `bodyHash(formBody)`를 넣을 것. (화면 쪽: 해시가 비어 있으면 "같음"으로 보는 것은 서버 계약상 빈 값이 오지 않으므로 그대로 둬도 된다) |
| UQ-S44-7 | Minor | foundation | S-44 새 산출물 `?state=deliverable-limit` | 02 S-44 "상한이면 `deliverable_limit_reached` → '산출물은 프로젝트당 50개까지 쓸 수 있어요'(입력 유지)" · ui-context `?state=` | `src/lib/data/career-v45.ts:357` (표시 개수만 50) · `:440-456` (저장 mock이 미리보기 힌트를 보지 않음) | 미리보기에서 "저장하기"도 상한 거부(머리 아래 줄)를 보인다 | 패널 첫 메시지만 막히고 "저장하기"는 성공해 mock 저장소에 행이 하나 더 생긴다(공유 mock 상태 변경). E2 보고의 "저장 거부 문구" 미리보기는 실제로 볼 수 없다 |
| UQ-S44-8 | Minor | E2 | S-44 저장 — 50개 상한 | 02 S-44 "`deliverable_limit_reached` → 문구(입력 유지)" · L-02 "실패: 활성 유지 + '저장하지 못했어요 · 다시 시도'" | `deliverable-page.tsx:185-188`, `:125-130` | 상한 거부는 검증 오류처럼 문구 하나, 다시 시도 권유 없음 | `setSaveState("failed")`라 "저장하기" 옆에 "저장하지 못했어요 · 다시 시도"가 함께 뜬다(다시 눌러도 같은 거부). `pageError`는 제목을 고칠 때만 지워지고 본문 입력으로는 안 지워진다. `"invalid"`(또는 별도 상태)로 두고 입력 때 지울 것 |
| UQ-S44-9 | Minor | E2 | S-44 본문 20,000자 오류 | 디자인 시스템 7장(오류 문구는 칸에 연결) · 스킬 Q9 | `deliverable-page.tsx:406-415`, `:432-436` | `aria-describedby`에 오류 문구 id | 본문 칸은 글자 수(`dlv-body-count`)만 연결하고 오류 `<span role="alert">`에는 id가 없다(제목 칸은 `dlv-title-error`로 연결됨). 칸에 다시 포커스했을 때 오류가 읽히지 않는다 |
| UQ-S44-10 | Minor | E2 | 본문 초안 카드 — 검토 버튼 이름 | 스킬 Q9 "accessible names" · UX-8 | `deliverable-draft-card.tsx:594-603`, `:694-699` | 버튼 이름으로 어느 블록·사실인지 구분된다 | 검토 필요 블록·사실이 여럿이면 이름이 같은 "수락"/"빼기"/"거절" 버튼이 여러 개다. `aria-label`에 블록 앞 문장(예: "‘지수 백오프…’ 수락")이나 `aria-describedby`로 블록 문장을 연결 |
| UQ-S44-11 | Minor | E2 | 본문 초안 카드 — [빼기] 뒤 | 02 S-44 "[빼기] → 블록 삭제(`rev` + 1)" · 3.25 "빼면 블록이 사라진다(`motion-layout`)" | `deliverable-draft-card.tsx:99` (`key` = `chat:rev:applied`) | 그 블록만 사라지고 카드의 펼침·스크롤은 그대로 | `rev`가 key에 있어 [빼기]마다 카드 전체가 다시 마운트된다 → 펼친 블록 목록이 28rem으로 다시 접히고 포커스가 사라진다(키보드 사용자는 다음 블록 [빼기]로 바로 못 감). key에서 `rev`를 빼고 반영됨 전환만 key로 |
| UQ-S44-12 | Minor | E2 | S-44 저장 중 채우기 | 02 S-44 "화면은 채울 때 그 초안의 `rev`와 방식을 기억하고, '저장하기'가 `p_applied_proposals`로 보낸다" | `deliverable-page.tsx:210` (`setApplied([])`), 카드 잠금 `deliverable-draft-card.tsx:115` | 저장 중에 다른 대화 초안을 채우면 그 기록이 다음 저장에 남는다 | 저장 요청이 도는 동안 카드가 잠기지 않고, 응답 뒤 `setApplied([])`가 그 사이 채운 기록까지 지운다 → 본문은 채워졌는데 다음 저장에서 반영됨 기록이 안 남는다. 보낸 원소만 지우거나(`a.filter(x => !sent.includes(x))`) 저장 중 반영 버튼 비활성 |
| UQ-S44-13 | Minor | E2 | S-44 산출물 삭제 뒤 | 02 C-05 산출물 삭제 "→ 삭제 후 S-08 `?item=project:{project_id}`(S-43)" | `deliverable-page.tsx:478-485` · `src/components/career/actions.ts:193-194` (`refresh()`) | 삭제 뒤 곧바로 S-43 | 서버 액션의 `refresh()`가 현재 라우트(S-44)를 먼저 다시 그려 ST-NOTFOUND "찾을 수 없는 페이지예요"가 잠깐 보인 뒤 `router.replace`가 이동할 가능성이 크다(코드 판단, 브라우저 확인 필요). 이동을 먼저 하거나 `refresh` 없는 삭제 액션을 쓸 것 |
| UQ-S44-14 | Minor | E2 | S-44 저장 — 부모가 소속으로 바뀜 | 02 S-44 "`deliverable_requires_standalone_project` → '이 프로젝트에는 산출물을 추가할 수 없어요' + S-10으로 `[가정]`" · 1.3a 입력 보존 | `deliverable-page.tsx:189-195` | 입력이 사라지기 전에 사용자가 알고, 남길 길이 있다 | 토스트와 동시에 `router.push`로 떠나 화면의 제목·본문이 사라진다. 보존본은 `{project}:new` 키에 남지만 그 키는 다시 열 수 없다(소속 프로젝트 새 산출물은 S-10으로 보냄) → 사실상 유실. 드문 경로라 Minor. 이동 전에 본문 복사 안내를 두거나 보존본을 지우고 "본문을 복사해 두세요" 확인을 받는 등 — 리더 판단 |
| UQ-S44-15 | Minor | E2 | C-22 안내 한 줄 | 02 C-22 프로젝트 행 비고 "회사·학교 안 프로젝트는 … 한 줄 안내 `[가정]`" | `src/components/career/career-overview.tsx:244-245` | 메뉴를 키보드·스크린 리더로 훑어도 안내가 읽힌다 | `DropdownMenuContent`(role=menu) 안의 일반 `<p>`라 화살표 이동으로 닿지 않고 읽히지 않는다. "프로젝트" 항목 hint에 붙이거나 `DropdownMenuLabel`/`aria-describedby`로 |
| UQ-S44-16 | Minor | foundation | C-05 산출물 삭제 — 결과 처리 | 02 C-05 산출물 삭제 "결과 처리 선택지(위 ①, **산출물이 근거로 쓰인 결과가 있을 때만**)" | `src/components/common/delete-confirm-dialog.tsx:228-229` | 영향 조회가 끝난 뒤에만 선택지를 보인다 | `impact === null`(조회 중)이면 조건이 참이라 결과 처리 라디오가 먼저 보였다가 결과가 없으면 사라진다(다이얼로그 높이가 튐, 그 사이 고른 값은 무의미). 산출물이면 조회가 끝날 때까지 숨길 것 |

## 기획 확인 필요

| # | 화면 | 내용 | 양쪽 |
|---|---|---|---|
| P-1 | C-22 → C-23 ① | (E2 질문 그대로 전달) 만든 직후 "프로젝트 정보 편집 중"을 C-24 인라인 대신 피그마 1009:2 수정 모달로 연다. 그리고 PR #8의 일괄 추가 모달(이름·역할·기간·기술·링크·내용 한 번에)을 이번에 이름 다이얼로그 → 수정 모달 2단계로 바꿨다 | 02 C-23 ① "'만들기' → … S-43, 프로젝트 정보 편집 중" + D-UX-28 **확정 (a) 이름 다이얼로그 유지** ↔ `screen-status` S-08(PR #8 사용자 선택 모달). 명세·결정은 2단계가 맞으므로 QA 판정은 "명세 일치". 사용자 의도 확인은 리더 몫 |
| P-2 | S-44 근거 구간 | E2 질문 "구간을 URL로 넘길지 세션으로 넘길지" — 기획 결정 사항이 아니라고 본다. 1.3a·FL-13의 원칙은 "내용은 URL에 넣지 않는다"이고 id·숫자 오프셋은 이미 `?chat=`·`?item=`처럼 넣고 있다. foundation이 `?range={start}-{end}` 같은 형식을 정하면 된다(UQ-S44-1·2) | 02 S-44 "근거 구간 강조" ↔ 1.3a 입력 보존 비고 "URL에는 넣지 않는다"(폼 내용 대상) |
| P-3 | S-44 초안 작성 중 | "마무리 중"을 언제 보일지 — 명세는 `draft_block` 임시 표시에 "마무리 중"을 붙이고, 디자인 시스템 3.25는 "마지막 블록 뒤 `draft_done` 전 머리 글자"로 적었지만 SSE에는 마지막 블록 표시가 없다(AI-13 `draft_block` → `draft_done`). 지금 코드는 임시 블록 아래에 늘 "마무리 중…"을 둔다(`deliverable-draft-card.tsx:267-268`, `[UI-가정]`) — 블록이 계속 오는 중에도 "마무리 중"이라 오해 소지. ui-designer가 규칙을 "작성 중 n번째 블록" 등으로 고치거나, 기획이 `draft_block`에 `last` 표시를 둘지 | 02 S-44 AI 응답 방식 ↔ 디자인 시스템 3.25 ↔ AI-13 SSE 이벤트 |

## 재확인 결과 (이전 라운드 이슈 중 이번 범위)

| ID | 결과 | 메모 |
|---|---|---|
| UQ-PA-21 | 해결 (S-44) | `deliverable-page.tsx:206` 첫 저장 성공 시 키가 바뀌기 전에 `:new` 사본 `clear()`, `:98-106` 키가 바뀐 뒤 effect로 `:new` 키를 한 번 더 지움(옛 store `dispose`의 대기 쓰기 대비 — React가 이전 effect 정리를 새 effect보다 먼저 돌리므로 순서 맞음). 산출물 저장은 한 번 호출이라 부분 성공 경로 자체가 없다. 첫 AI 메시지 ③ 저장도 같은 `doSave`라 같다 |
| UQ-PA-1 | 해결 유지 | S-44가 `resolve()`("이어서 편집" = 값 적용 + resolve) / `clear`("버리기")를 데모대로 배선(`:332-341`) |
| UQ-PA-4·18 | 해결 유지 | `StaleWriteDialog onReload={guard.reloadDiscarding}`, "내 내용으로 저장" = `expected_updated_at: null`(`:158`, `:468-471`) |
| UQ-PA-2 | 해결 유지 | 슬롯 칩 표시 `deliverableSlotLabel(slot, writing_kind)` — `limits`·`reaction` 포함 |

## 범위 밖 관찰 (이슈로 세지 않음)

- S-43 "프로젝트 내용"이 `p.summary`를 그린다(`career-overview.tsx:461`). 명세는 `projects.description`(DM v4.4에서 `summary` 삭제). 이번 범위는 산출물 섹션뿐이라 기록만 — 다음 S-43 라운드에서 확인.
- E2 보고의 S-08 `?state=empty`("목록 없음")는 커리어 전체를 비우므로 S-43 자체가 안 보인다. `listProjectDeliverables`의 `empty` 분기(`career-v45.ts:379`)는 닿지 않는 코드. 빈 산출물 상태는 독립 프로젝트 `…4e03-8000-000000000007`로 확인했다(문구 일치).
- `(dashboard)/…/writing-chats/[id]` → S-44 리다이렉트(`routes.deliverable(…, {chat})`)는 정상.

## 기계 검사 출력

| 검사 | 결과 |
|---|---|
| `pnpm lint` | 통과, 경고 0 (E2 보고의 `star-proposal-card.tsx` 경고는 이미 없어짐) |
| `pnpm typecheck` | 1차 실패 10건 — `insight-view.tsx`(3)·`data-gate.tsx`(6)·`return-banner.tsx`(1): `routes.projectNew/project/writingChatNew/writingChat` 없음. `src/lib/routes.ts`가 19:47에 수정 중(E1 정리)이었고 이번 범위 파일 오류는 0건. 빌드 뒤 다시 실행 → **통과** |
| `pnpm vitest run src/components/career src/components/common src/lib/data/{quick-chips,career-v45-shared,career-v45-bridge,mock-isolation}.test.ts` | 8파일 72개 통과 (`draft-fill.test.ts` 11개 포함) |
| `pnpm vitest run` (전체) | 118파일 중 116 통과, 3건 실패: `career.integration.test.ts`·`writing-chat.integration.test.ts` — 로컬 Supabase에 v4.4 RPC `apply_writing_chat_proposal` 없음(PGRST202). 백엔드 통합 테스트, 이번 UI 범위와 무관 |
| `pnpm build` (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder`) | 통과. `/career/deliverables/[id]`, `/career/projects/[id]/deliverables/new` 모두 ◐ |
| 개발 서버 SSR | 포트 3611(같은 worktree에서 이미 실행 중)로 14개 URL 200 + 문자열 확인(위 "SSR 확인"). 클릭·입력 상호작용은 미확인 — 채우기·되돌리기·교체 확인·저장 뒤 URL 교체·삭제 뒤 이동(UQ-S44-13)은 브라우저 확인 권장 |
