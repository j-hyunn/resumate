# A0 파운데이션 구현 보고 — L-02 셸 · 문서형 입력 · v4.5 데이터 계층 · Resumate AI 패널 코어

- 작성: frontend-engineer (A0) / 2026-11-03
- 기준: 브리프 `21_brief_project-add.md`, 디자이너 메모 `21_ui-designer_project-add_notes.md` §5, 디자인 시스템 v4, 플로우 v5.6, AI v4.6, DM v4.5
- 리더 판정 반영: Q-7 버튼 반경 6px 유지 / Q-8 L-02는 사이드바 레이아웃 밖 라우트 그룹 `(page)` (게이트는 `(dashboard)/(gated)`와 같은 `ConsentGate`) / Q-9 L-01 로고 마크 재사용(`LogoMark`, 표기 "Resumate") / Q-10 L-01 그대로(민트는 L-02만)

## 완료 — 무엇을 만들었나

| 요청(§5) | 결과 | 파일 |
|---|---|---|
| 1 토큰 | `--shell`·`--panel`(+foreground) 라이트/다크, `@theme`의 `--color-shell*`·`--color-panel*`. `rounded-2xl/3xl`은 건드리지 않음 | `src/app/globals.css` |
| 2 버튼 | `variant="chip"`, `"chip-dashed"` (`max-md:h-11`) | `src/components/ui/button.tsx` |
| 3 셀렉트 | `SelectTrigger variant="chip"` (기존 `size` 유지) | `src/components/ui/select.tsx` |
| 4 L-02 셸 | `PageShell`, `ShellBar`(로고 · [Resumate AI] 다시 열기 · C-06 · 저장하기 · 계정 메뉴 5항목), `SaveButton`(idle/dirty/saving/saved/failed/invalid/stale + 표식 점 + ⌘/Ctrl+S + 좁은 화면 토스트), `SaveStatusText`, `StaleWriteDialog`, `CrumbRow`(넓은 화면 이동 경로 / 좁은 화면 "← {상위}"), `useLeaveGuard` + `LeaveGuardDialog`(3버튼, `beforeunload`, 앱 안 `<a>` 클릭 가로채기, `usePageLeave()`), `useInputPreservation` + `preservationKey` + `InputRestoreBanner`, `ShellBanners` | `src/components/common/shell/page-shell.tsx` |
| 4 공유 | 계정 메뉴 상수, 로고 마크(L-01 사이드바도 이 컴포넌트로 교체 — 모양 동일), L-02 로딩 스켈레톤 | `shell/account-menu-items.ts`, `shell/logo-mark.tsx`, `shell/page-shell-skeleton.tsx` |
| 5 라우트 | `(page)/layout.tsx`(AiConnectionProvider · PreviewStateSwitcher · AiJobWatcher · DeletionIncompleteGuard, 사이드바 없음), `(page)/(gated)/layout.tsx`(ConsentGate). 토스트는 `useToasterPosition("bottom-left")`로 PageShell이 떠 있는 동안 왼쪽 아래 | `src/app/(page)/…`, `shell/shell-parts.tsx` |
| 5 레이아웃 | `DocBody` — 넓은 화면 2단(왼쪽 42rem · `ResizeHandle` · 패널 420/360/640, 카드 50%·왼쪽 448 보장), 좁은 화면(<1024 또는 카드 <820) 한 단 + 떠 있는 "Resumate AI" 버튼 → `Sheet`(768 미만 전체 폭). `useDocBodyMode()`로 패널이 시트 머리 "STAR 보기"/"본문 보기"를 그림 | `shell/doc-body.tsx` |
| 6 입력 | `DocTitleInput`(attention 링 = "이름 먼저" 상태), `DocTextarea`(목록 줄 Enter 이어쓰기·빈 항목 Enter 지움·Tab/Shift+Tab 들여쓰기, 그 밖 Tab은 포커스 이동), `highlightRange(textarea, {start,end}|{quote})`, `flashElement`, `ResizeHandle`(드래그 + ←/→ 16·Shift 64·Home·End·Enter=420, `role=separator` 값 속성) | `src/components/common/doc-inputs.tsx` |
| 7 머리 | `FieldRows`/`FieldRow`(dl 2열, <768 한 열), `ChipSelect`("미선택" 자리 표시 + "선택 안 함"), `CompetencyChips`(최대 3, 선택 순서 유지, 3개면 나머지 비활성 + "최대 3개까지 고를 수 있어요", 메뉴 안 닫힘), `MonthField size="sm" labelHidden invalid` | `doc-inputs.tsx`, `common/input-guide.tsx` |
| 8 출처 칩 | `SourceChip` 4종(발화 "내 답변 #n" / 사실 "이 말에서 정리했어요 · #n(외 k)" / "지금 본문에서" / "프로젝트 내용에서" = `span tabIndex=0` + Tooltip), `SourceChips`, `PROJECT_FIELD_LABELS` | `src/components/common/source-chip.tsx` |
| 타입 | v4.5 추가분만: `WritingChatV45`(`project_deliverable_id`), `ProjectStructuredDraft`(필드 객체 `rev`·`applied_at`), `DeliverableStructuredDraft`(`writing_kind`·`facts[]`·`deliverable.body`(blocks·`rev`·`base_body_hash`·`replace_allowed`·`missing_slots`·`dropped_block_count`·`applied_at/mode/rev`)·`draft_count`), 블록 타입·`basis`·`PRJ.*` 출처, `PageSaveSkipReason` 6종, `PageSaveErrorCode`, `WritingChatErrorCode` | `src/types/db.ts` |
| 라벨 | 분류 3종 표시명, STAR 칸 제목, `writing_kind` 표시명, AI-13 종류별 슬롯 표, `projectSpanLabel`(C-25 개월 수, 진행 중 = 이번 달까지) | `src/lib/data/labels.ts` |
| 라우트 헬퍼 | `careerItem`, `projectPageNew({experience}|{education})`, `projectPage(id,{chat})`, `deliverableNew(projectId)`, `deliverable(id,{chat})` (기존 `projectNew`·`project`는 그대로 — A2가 옮길 때 정리) | `src/lib/routes.ts` |
| 칩 | `quickChips(state)` + `projectQuickChips`·`deliverableQuickChips`·`quickChipsVisible`·`PROJECT_CHIP_TABLE`·`DELIVERABLE_CHIP_COPY` + 테스트 15개 | `src/lib/data/quick-chips.ts`, `.test.ts` |
| 데이터 계층 | 아래 표 | `src/lib/data/career-v45*.ts`, `writing-chat-turn-v45.ts`, `src/lib/mock/career-v45.ts`, `src/lib/mock/writing-chat-turn-v45.ts` |
| 패널 코어 | `useAiPanel` 컨트롤러 + `<AiPanel>` (아래 API) | `src/components/career/ai-panel/` |
| 개발용 데모 | `/dev/page-shell` — 위 전부를 v4.5 mock으로 이어 붙인 참고 화면(S-10/S-44 본문 아님, 제안 카드 자리는 자리 표시 카드). 운영 빌드는 404 | `src/app/(page)/dev/page-shell/page.tsx`, `src/components/common/dev-page-shell-demo.tsx` |

## 라우트 · `?state=`

| 라우트 | 내용 | 지원 `?state=` |
|---|---|---|
| `/dev/page-shell` (`?target=deliverable`, `?new=1`) | A0 데모 (S-10 모양 / S-44 모양) | `new` · `dirty` · `saving`(저장 20초 대기) · `save-failed` · `stale`(첫 저장 `stale_write` → "내 내용으로 저장"은 성공) · `ai-locked` · `key-invalid` · `consent-required` · `chat-closed` · `ai-stream`(질문 턴 자동 재생) · `draft-streaming`(S-44 초안 턴 자동 재생, 블록 천천히) · `draft-ready` · `needs-review` · `empty` · `not-found` · `loading` · `ai-failed*`(턴 실패, C-20) |

같은 값들은 데이터 계층(`pagePreviewHints`, `PAGE_PREVIEW_STATES`)이 계산하므로 A2의 실제 S-10/S-44 라우트에서도 그대로 쓴다.

## 데이터 계층 함수 — 실제 / mock

서버 전용 `src/lib/data/career-v45.ts`, 클라이언트용 액션 `career-v45-actions.ts`(`…Action`), 계약·문구 `career-v45-shared.ts`(client-safe). 미리보기(`?state=`, `/dev/`)는 모두 `previewOr`로 mock.

| 함수 (DM 이름) | 실제 경로 | 비고 |
|---|---|---|
| `getProjectPage(id, {chatId, previewState})` | **실제** — v4.4 `getProjectPage` + 대화 요약 + 연 대화(`getProjectChat`) + 소속 목록(`getCareerList`) | 독립 프로젝트 id → `{kind:"standalone"}`, 없음 → `not_found`. 연 대화 = `?chat=` 또는 최근 active [UI-가정] |
| `getNewProjectPage({experience|education})` | **실제** — 소속 이름 조회(v4.4 패널) | 소속 없음/남의 것 → `not_found` |
| `getDeliverablePage(id)` | **실제(본문)** — v4.4 `getDeliverable` / 대화 목록은 **빈 배열** | `// 연결 대기 (DM v4.5 11.3)` (`project_deliverable_id` 없음) |
| `getNewDeliverablePage(projectId)` | **실제** — v4.4 `getStandaloneProject`(50개 상한) | 소속 프로젝트 → `{kind:"affiliated"}` |
| `getWritingChat(chatId)` | **실제(STAR 대화)** | 산출물 대화는 mock만 |
| `saveProjectPage({project_id, values, expected_updated_at, applied_proposals})` | **브리지** — 만들기 = v4.4 `createProject` → `saveProjectSection`(페이지 전체 한 번), 고치기 = `saveProjectSection(expectedUpdatedAt)`. `conflict` → `stale_write` | `p_applied_proposals`는 **기록 안 됨**(v4.5 RPC 없음) — 응답은 전부 `applied`로 돌려줌, 새로 고치면 카드가 ①로 돌아감. `// 연결 대기` |
| `saveProjectDeliverable({…})` | **브리지** — v4.4 `saveDeliverable`(만들기는 클라이언트 id) | `sort_order` 0, 반영 기록 동일하게 미기록. `// 연결 대기` |
| `checkAiConnection()` | **실제** — `get_data_readiness().ai_connection` 경로(`getAiConnection`) | 첫 메시지 ② |
| `startWritingChat(projectId, returnTarget, formSnapshot)` | **실제** — v4.4 `startProjectChat` | `p_form_snapshot` 미전달(인사 분기는 DB 값). `// 연결 대기` |
| `startDeliverableWritingChat(deliverableId, formSnapshot)` | **mock만** | 실제 경로 = `backend_pending` |
| `deleteWritingChat(chatId)` | **실제** — v4.4 `deleteProjectChat` | |
| `applyStructuredDraftPatch(chatId, patch)` | **실제(STAR 수정·수락·거절)** — v4.4 `editProposalField`/`reviewProposalField` | 사실·블록 패치는 mock만(`backend_pending`). mock은 DM 규칙(반영된 필드 `field_already_applied`, 블록 [빼기] `rev`+1, 수락 `rev` 그대로) |
| `prepareWritingChatTurn(…)` + 클라이언트 `streamTurn(request)` | **실제(STAR)** — v4.4 `/api/writing-chats/{id}/turns` SSE를 v4.5 이벤트로 매핑, `form_snapshot`은 실려 가지만 v4.4가 무시 | AI-13 전체(질문 턴 `facts_patch`, 초안 턴 `draft_started`/`draft_block`/`draft_done`, `turn_done.draft_count`, 6회 상한 409)는 **mock만** |
| `recordMockTurn` | mock만 | 클라이언트 mock 턴 결과를 mock 행에 남겨 저장·재열기와 맞춤 |

결과 타입: `SaveProjectPageResult` / `SaveProjectDeliverableResult` = `{ok:true, …DM 반환}` | `{ok:false, error:{code, field?, current_updated_at?}}`. 코드 = `stale_write`, `project_name_required`, `project_affiliation_required`, `project_not_affiliated`, `deliverable_title_required`, `invalid_period`, `invalid_classification`, `invalid_fields`, `field_too_long`, `not_found`, `project_scope_change_not_allowed`, `deliverable_limit_reached`, `deliverable_requires_standalone_project`, `save_failed`(그 밖). `skipped[].reason` 6종 + 문구 `PAGE_SAVE_SKIP_COPY`. 저장 거부 문구 `PAGE_SAVE_ERROR_COPY`, `fieldTooLongCopy(n)`. 턴 거부: `invalid_patch`·`invalid_form_snapshot`·`writing_chat_draft_limit_reached`·`writing_chat_closed`·`field_already_applied`.

보조: `toProjectPValues`, `toProjectFormSnapshot`(월 'YYYY-MM' 변환, 진행 중이면 종료월 null), `blankProjectValues`, `normalizedText`/`isBlank`(C-14 공백 정규화), `projectGreeting`/`deliverableGreeting`/`guessWritingKind`(행 없을 때 화면이 먼저 보이는 고정 인사), `blocksToMarkdown`(DM 2.5.0 `value` 조립), `bodyHash`(`base_body_hash` 비교용), `withChatParam`.

## 패널 코어 · 슬롯 API (A2용)

```tsx
const panel = useAiPanel({
  target: "project" | "deliverable",
  targetId,                       // null = 새 페이지(행 없음)
  initialChats, initialChat,      // PageData.chats / open_chat
  formSnapshot,                   // 지금 폼 값(저장 전 포함) — 칩·인사·턴 form_snapshot
  preview,                        // PageData.preview
  returnTarget, gateFeatureLabel, // S-10 C-09 진입
  deliverableLimitReached,        // S-44 새 산출물
  requireName: () => boolean,     // ① false면 페이지가 제목 칸 포커스 + "대화를 시작하려면 … 먼저 입력해 주세요"
  savePage: () => Promise<string | null>, // ③ 페이지 저장(행 생성) → 새 id, 실패 null(페이지가 칸 오류 표시)
  onChatChange, onTurnEvent, onDraftChange,
})
<PageShell guard={guard} save={<SaveButton …/>} aiReopen={panel.reopen}>
  … <DocBody placement={panel.placement} left={…} aside={
      <AiPanel panel={panel}
        renderProposal={(p) => <StarProposalCard … />}   // 제안 독 슬롯 (입력창 위, max-h 55%)
        renderClosedActions={(p) => <모두 반영 버튼/>}      // 닫힌 대화 상자 안
        renderAboveInput={(p) => …}                       // 예: ready_to_return "돌아가기"
        onUserMessageClick={(m) => …}                      // 발화 → 카드 섹션 강조
        onDirectInput={() => …} />                         // C-18 대안 "직접 입력"
  } />
</PageShell>
```

카드가 쓰는 컨트롤러 값: `chat`(열린 대화: `messages`·`structured_draft`·`status`·`message_count`), `phase`(`idle|starting|streaming|patching|drafting|failed` — "정리 중"은 `patching`), `provisionalBlocks`·`draftStarted`(S-44 "초안 작성 중" 임시 블록), `responding`, `locked`, `closed`, `patchDraft(patch)`(카드 직접 고치기·수락·거절·사실 수락/거절·블록 수락/빼기 → `apply_structured_draft_patch`, 실패 시 토스트 + false), `setDraft(draft)`, `markApplied(chatIds)`(저장 응답 `applied` 후), `flashMessage(messageId, quotes)`(C-15 "내 답변 #n"·사실 칩 → 메시지 스크롤 + 인용 강조 2초), `send(text, {requested_slot, requested_action, style})`(빈 슬롯 칩·"AI에게 물어보기"), `newChat()`, `show()`/`hide()`(왼쪽 "AI 제안 있음" → 패널 열기), `focusInput()`.

코어가 하는 것: 머리(Sparkles·이름·C-19·기록·새 대화·⋯ 삭제(C-05)·× / 시트 "STAR 보기"·"본문 보기"), 기록 보기(제목/"새 대화"·상대 시각·n/40·"끝난 대화"·빈 목록·현재 행), 메시지(AI 아바타·사용자 말풍선 "내 답변 #n"·스트리밍 커서·민감정보 안내·실패 턴 C-20 inline + "다시 보내기"·완료 때만 낭독), 시작 영역(인사 + 고정 안내 + 무료 등급 한 줄), 칩 줄(숨김 규칙·응답 중 비활성·`new_chat` 칩), 빠른 응답 ghost 버튼, 입력(Enter 보내기·Shift+Enter·한글 조합 중 안 보냄·중단·첫 메시지 처리 중 스피너), 막힘(키 무효 C-20 / `invalid_form_snapshot` / 닫힌 대화·초안 상한 + [새 대화] / 50개 상한 / 첫 저장 실패 · 다시 시도 / 대화 시작 실패 / 연결 대기), C-18 영역형(대화 없음)·인라인형(대화 있음), 닫힌 대화 상자(40 / `closed`), C-21 동의 창(보내기·다시 보내기 전), 첫 메시지 순서 ①→②→③→④→⑤ + 토스트 "대화를 시작하려고 …을 저장했어요", 패널 열림·너비 기억(localStorage), 닫을 때 [Resumate AI]로 포커스 / 다시 열면 입력창 포커스, 미리보기 자동 재생.

카드가 할 것(A2): STAR 제안 카드·본문 초안 카드 전부(상태 ①~⑤, [반영]/[모두 반영]/[본문 교체]/[뒤에 덧붙이기]/[본문에 넣기], 채우기 규칙·2,000/20,000자, "폼에 채움" 로컬 상태와 `p_applied_proposals` 기억, 되돌리기 토스트, 교체 확인·해시 비교, 블록 렌더링, "확인이 필요한 내용", `missing_slots` `chip-dashed`, 초안 남은 횟수, 저장 응답 `skipped` 줄).

## [UI-가정]

| 화면 | 파일 | 내용 |
|---|---|---|
| L-02 | `shell/page-shell.tsx` | 이탈 확인 설명 줄 "저장하지 않고 나가면 이번에 고친 내용이 사라져요"(명세는 제목·버튼만) |
| L-02 | `shell/page-shell.tsx` | 브라우저 뒤로/앞으로는 가로채지 않음(SPA에서 신뢰할 훅 없음) — `beforeunload`·앱 안 링크·셸 버튼만 |
| L-02 | `shell/page-shell.tsx` | 저장 툴팁 "저장하기 (⌘S)"/"(Ctrl+S)", 좁은 화면 실패 토스트 |
| L-02 | `shell/account-menu-items.ts` | L-01 `NavUser`는 아직 설정·로그아웃 2항목(Q-10: L-01 변경 안 함) — L-02만 5항목 |
| L-02 | `globals.css` | `--radius-3xl`이 기존 정의로 20px(디자이너 메모는 24px 가정) — 다른 화면 영향 때문에 바꾸지 않음. 입력 알약은 20px |
| S-10 | `doc-inputs.tsx` | `ChipSelect` 맨 위 "선택 안 함" |
| 패널 | `use-ai-panel.ts` | 열 대화 기본값 = `?chat=` 없으면 가장 최근 active 대화 |
| 패널 | `panel-input.tsx` | "AI가 질문 중" = 마지막 AI 메시지에 "?"가 있을 때 빠른 응답 표시 |
| 패널 | `panel-input.tsx` | 대화 시작 RPC 실패 문구 "대화를 시작하지 못했어요" + 다시 시도(C-20 행 없음) |
| 패널 | `career-v45-shared.ts` | 실제 경로에 v4.5 백엔드가 없는 호출 = "아직 연결 준비 중인 기능이에요…" |
| AI-13 칩 | `quick-chips.ts` | 초안 6회: 초안 칩 자리를 순서대로 "빠진 부분 물어봐 줘"·"새 대화 시작"으로, 중복 제거, 없으면 "새 대화 시작" 덧붙임(최대 3) |
| AI-13 칩 | `quick-chips.ts` | "무엇을 쓰면 좋을지 알려 줘"는 첫 빈 슬롯, "프로젝트 내용을 바탕으로 물어봐 줘"는 `requested_slot` 없음 |
| AI-13 | `career-v45-shared.ts` | `bodyHash` = CRLF→LF 후 SHA-256 hex, "sha256:" 접두(백엔드와 맞춰야 함) |
| AI-13 | `career-v45-shared.ts` | 새 산출물 인사의 종류 짐작 키워드(서버 상수 대용) |
| 데이터 | `career-v45.ts` | 실제 브리지 저장은 반영 기록을 남기지 않고 `applied`로 돌려줌 |

## 기획 확인 필요

| 화면 | 질문 | 스펙 위치 |
|---|---|---|
| S-44 · AI-13 | 회고 슬롯 1 "무엇을 했나(범위)"가 출력 스키마 19개 키에 따로 없어 `scope`를 재사용했다 — 맞는지 | AI v4.6 AI-13 출력 스키마 `facts[].slot` |
| S-44 | `base_body_hash` 정규화 규칙(공백·줄바꿈)과 형식 | AI-13 "기준 본문이 바뀐 경우", S-44 반영 규칙 "구현에서 공유" |
| S-44 · AI-13 | 초안 6회 때 칩 3개 구성(위치·중복) — 위 가정으로 구현 | AI-13 칩 표 아래 |
| L-02 | L-01 계정 메뉴(기본 프로필·AI 연결·처리방침 포함 5항목)를 L-01에도 맞출지 — 지금 L-01은 2항목 | 1.3 L-01 메뉴 하단 / 1.3a |
| L-02 | 이탈 확인 다이얼로그 설명 문구 | 1.3a 이탈 확인 |

## 다음 영역(A2)·리더에게

- **라우트 이동**: S-10·S-44 페이지는 `src/app/(page)/(gated)/career/projects/[id]/page.tsx`, `…/projects/new/page.tsx`, `…/career/deliverables/[id]/page.tsx`, `…/career/projects/[id]/deliverables/new/page.tsx`에 만들고, **같은 URL의 `(dashboard)/(gated)/career/projects/[id]/page.tsx`·`projects/new/page.tsx`는 지워야** 빌드가 된다(같은 경로 두 페이지 금지). 폐기 경로(`projects/[id]/details/*`, `writing-chats/*`)는 redirect.
- 새 프로젝트 URL 교체 시 `?state=`를 유지해야 미리보기가 mock에 남는다(`router.replace`에 search 유지).
- 왼쪽 "AI 제안 있음"·[반영] 강조는 `panel.show()` + `flashElement(el)` / 스크린 리더 알림은 페이지의 `aria-live`.
- 파운데이션 후속(백엔드 v4.5 후): `career-v45.ts`의 `// 연결 대기 (DM v4.5 11.3)` 지점만 실제 RPC로 바꾸면 화면은 그대로.

## 검사 결과

- `pnpm lint`: 통과(오류·경고 0)
- `pnpm typecheck`: 통과
- `pnpm test`: 새 테스트 `quick-chips.test.ts` 15개 통과, `mock-isolation.test.ts` 통과. 전체 1,787개 중 **3개 실패 — 모두 로컬 Supabase 통합 테스트**(`career.integration.test.ts` 1, `writing-chat.integration.test.ts` 2): 로컬 DB에 `apply_writing_chat_proposal` 함수가 없다는 PostgREST `PGRST202`. 이번 변경이 건드리지 않은 `src/server/services/writing-chat/*` 경로이고 로컬 스택 스키마 문제로 보인다(백엔드 확인 필요).
- `pnpm build`: 이 워크트리에 `.env.local`이 없어 그대로는 `/career/skills` 프리렌더에서 `NEXT_PUBLIC_SUPABASE_URL` 누락 오류. 공개 값 2개만 임시 값으로 주고(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder`) 빌드 **성공**, `/dev/page-shell` 포함.
- 개발 서버 스모크(`/dev/page-shell` 8가지 조합 SSR 200): 기본·산출물·`new`·`draft-ready`·`chat-closed`(닫힌 대화 문구)·`ai-locked`(C-18)·새 산출물·`empty` 확인. 브라우저 상호작용(저장·턴 스트림·이탈 확인)은 직접 눌러 보지 못했다 — QA 확인 필요.

## QA 1라운드 수정 (`23_ui-qa_A0_project-add_review.md`)

| ID | 심각도 | 상태 | 수정 내용 | 파일 |
|---|---|---|---|---|
| UQ-PA-1 | Critical | 해결 | 입력 보존을 순수 store로 분리. 이전 방문 보존본은 배너 응답 전까지 쓰기·지우기 보류, `write(null)`은 이번 방문이 쓴 사본만 지움, `clear()`만 항상 지움, 언마운트·`pagehide` 때 대기 값 즉시 기록. 훅에 `resolve()`("이어서 편집", `dismiss`는 별칭) | `shell/input-preservation.ts`(+test), `shell/page-shell.tsx`, 데모 |
| UQ-PA-2 | Major | 해결 | `DeliverableSlot` 19개 키 그대로(`limits`·`reaction` 추가), 설계 문서 슬롯 5 = `limits`, 발표 슬롯 5 = `reaction`. 기획 확인 항목 삭제(회고 슬롯 1 `scope` 재사용만 확인 요청) | `types/db.ts`, `labels.ts` |
| UQ-PA-3 | Major | 해결 `[UI-가정]` | 실제 경로 저장을 `career-v45-bridge.ts`로 분리. 새 페이지는 `client_id`를 한 번 만들어 재시도마다 같은 id로 만들기(v4.4 retry-safe create). 만들기 성공 뒤 섹션 저장이 실패하면 거부 응답에 `error.created {project_id, updated_at}` → 화면이 id를 잡아 다음 저장은 고치기. 산출물도 `client_id`. 데모가 이 흐름대로 배선 | `career-v45-bridge.ts`(+test), `career-v45-shared.ts`, `career-v45.ts`, 데모 |
| UQ-PA-4 | Major | 해결 | "새로 불러오기"를 일반 outline 버튼으로, `onOpenAutoFocus`로 첫 포커스 = "내 내용으로 저장" | `shell/page-shell.tsx` |
| UQ-PA-5 | Major | 해결 `[UI-가정]` | 목록 키를 순수 함수로 분리. Tab/Shift+Tab은 할 일이 있을 때만(0칸 내어쓰기·깊이 6칸 초과 들여쓰기 = `null` → 기본 포커스 이동), Esc 뒤 다음 Tab은 항상 칸을 떠남, 선택 영역이 있으면 Tab 기본. **ui-designer가 5.9에 규칙 추가 필요**: "Esc 후 Tab = 칸 나가기", 들여쓰기 깊이 상한 | `doc-list-keys.ts`(+test), `doc-inputs.tsx` |
| UQ-PA-6 | Major | 해결 | ② 막힘별 안내: 조회 실패 → "연결 상태를 확인하지 못했어요 · 다시 시도" `[UI-가정]`, 공급자 없음 → C-18 인라인, 키 무효 → C-20, `consent_required` → C-21 연 뒤 동의하면 ②부터 이어감(행은 그때까지 안 만듦). ② 때 연결 컨텍스트도 새로 읽음. 턴 직전 `ai_consent_required`/`key_missing` 거부도 C-21 / C-18로 | `ai-panel/use-ai-panel.ts`, `panel-input.tsx` |
| UQ-PA-7 | Major | 해결 | `(page)/error.tsx` = S-28 `ErrorState`(셸 밖, 다시 시도) | `src/app/(page)/error.tsx` |
| UQ-PA-8 | Major | 해결 | `?state=` 추가: `skipped`, `first-save-failed`, `start-failed`, `invalid-form-snapshot`, `chat-closed-other-tab`, `draft-failed`(초안 턴 중간 실패·이전 초안 유지), `draft-limit`(6회), `deliverable-limit`(50개), `standalone`(→ S-43), `affiliated-parent`(→ S-10). 모두 데이터 계층 `pagePreviewHints`라 A2 실제 라우트에서도 같음 | `career-v45.ts`, `career-v45-shared.ts`, `mock/writing-chat-turn-v45.ts` |
| UQ-PA-9 | Minor | 해결 | `send`가 ① 이름 확인을 C-21·키 무효 확인보다 먼저 | `use-ai-panel.ts` |
| UQ-PA-10 | Minor | 해결 | `refused`의 `backend_pending`을 그대로 넘겨 패널 블록 "아직 연결 준비 중…"으로 | `writing-chat-turn-v45.ts` |
| UQ-PA-11 | Minor | 해결 `[UI-가정]` | 실제 경로(v4.4)는 반영 기록을 못 남기므로 `applied: []`, 원소마다 `skipped: mark_failed`("일부 반영 기록을 남기지 못했어요. 저장한 내용은 그대로예요") — 저장 안 된 "반영됨" 경로 없음. 리더가 다른 판단이면 알려 달라 | `career-v45-bridge.ts` |
| UQ-PA-12 | Minor | 해결 | `saveErrorOf`: v4.5 이름 거부 코드는 그대로 통과, `details.field` camelCase → v4.5 키, 기간 검증(`invalid_input` + 월 칸) → `invalid_period` | `career-v45-bridge.ts`(+test) |
| UQ-PA-13 | Minor | 해결 | 규칙을 코드대로 정함: "무엇을 쓰면 좋을지 알려 줘" = 첫 빈 슬롯(종류 모르면 null), "프로젝트 내용을 바탕으로 물어봐 줘"만 슬롯 없음. 주석 정정 | `quick-chips.ts` |
| UQ-PA-14 | Minor | 해결 | 떠 있는 버튼을 시트가 열린 동안에도 남기고(invisible·aria-hidden·tabIndex -1), `onCloseAutoFocus`로 그 버튼에 포커스 | `shell/doc-body.tsx` |
| UQ-PA-15 | Minor | 해결 | 좁은 화면 왼쪽 `pb-24`, 첫 페인트("wide" 기본값)에서도 패널·손잡이는 `max-lg:hidden`, 왼쪽 최소 폭은 `lg:`만 | `shell/doc-body.tsx` |
| UQ-PA-16 | Minor | 해결 | 사용자 말풍선은 `onUserMessageClick`이 있을 때만 버튼, 민감정보 "대화 삭제"는 C-05를 직접 엶 | `ai-panel/ai-panel.tsx` |
| UQ-PA-17 | Minor | 해결 (리더 판정) | L-02에 장애 배너: `(page)/layout`의 `PageShellOutageSlot`(서버) → ShellBar 아래 자리로 portal(`registerOutageSlot`). `?state=ai-outage`도 보임 | `shell/page-shell-outage.tsx`, `shell/server-slots.tsx`, `(page)/layout.tsx`, `page-shell.tsx` |
| UQ-PA-18 | Minor | 해결 | `guard.reloadDiscarding()` = 이탈 확인 우회 + 입력 보존 지움 + 다시 읽기. 데모가 사용 | `shell/page-shell.tsx`, 데모 |
| UQ-PA-19 | Minor | 해결 | 새 테스트 4개 파일 39개: 목록 키, 입력 보존 store, 저장 브리지·`saveErrorOf`, `toProjectPValues`·`blocksToMarkdown`·`bodyHash`. mock `skipped` 판정은 서버 store 의존이라 미포함 | `*.test.ts` |

### A2 배선 변경점
- 새 페이지는 `client_id`(한 번 생성)를 저장 입력에 넣고, 실패 응답에 `error.created`가 있으면 `project_id`/`updated_at`을 그 값으로 바꾼다.
- 입력 보존: "이어서 편집" = `preserved.resolve()` 후 값 적용, "버리기" = `clear()`. 페이지는 매 렌더 `write(dirty ? 값 : null)`만 하면 된다.
- 충돌 "새로 불러오기" = `guard.reloadDiscarding`.
- 새 페이지 첫 저장 성공 또는 `error.created`를 받으면, id로 키가 바뀌기 **전에** `preserved.clear()`로 옛 `:new` 보존 키를 지운다(UQ-PA-21, 데모 참고).

### 검사 결과 (QA 1라운드 수정 후)
- `pnpm lint` 통과(0), `pnpm typecheck` 통과
- 새/관련 테스트 6개 파일 54개 통과(`doc-list-keys`, `input-preservation`, `career-v45-bridge`, `career-v45-shared`, `quick-chips`, `mock-isolation`)
- `pnpm build` 성공(공개 env 임시 값 2개)
- 개발 서버 `/dev/page-shell` 새 `?state=` 9개 조합 SSR 200, 서버 로그 오류 0. 브라우저 상호작용은 여전히 미확인

## 후속 요청 처리 (E2 산출물 삭제 · QA 2라운드 UQ-PA-20·21)

| 요청 | 상태 | 내용 | 파일 |
|---|---|---|---|
| 1a 타입 | 완료 | `DeletionEntityType`에 `project_deliverable`, `DeletionImpact.cascade.project_deliverables` 추가(`writing_chats`는 기존 칸 — 산출물 대상이면 그 산출물 대화 수, 독립 프로젝트면 산출물 대화 수) | `src/types/db.ts` |
| 1b 다이얼로그 | 완료 | `DeleteTarget kind:"career"`가 `entity_type:"project_deliverable"`을 받음(이름 "산출물"). 선택 필드 `scope`(`affiliated`/`standalone`)·`unsavedChanges` 추가. 문구는 UX v5.6 C-05 원문과 대조 — 요청 문구와 같음: 산출물 "'{산출물 제목}'을 삭제할까요?" + (대화 있으면) "이 산출물의 AI 대화 {N}개도 함께 삭제돼요", 결과 처리 선택지는 `by_application_project`가 있을 때만(산출물만), 프로젝트 소속 "STAR 내용과 이 프로젝트의 AI 대화 {N}개가 함께 삭제돼요" / 독립 "산출물 {N}개와 산출물의 AI 대화 {M}개가 함께 삭제돼요"(`scope` 없으면 `project_deliverables > 0`으로 판정), 저장 안 한 변경 "저장하지 않은 수정도 함께 사라져요", AI 대화 "대화 메시지 {message_count}개가 삭제돼요. 이미 반영해 저장한 내용은 그대로예요" | `src/components/common/delete-confirm-dialog.tsx` |
| 1c 데이터 | 완료 | `getDeletionImpact`·`deleteCareerItem('project_deliverable', …)`: mock = v4.5 mock 산출물 + 그 대화(영향 집계, 삭제 시 연쇄), 독립 프로젝트 삭제도 v4.5 산출물·대화를 함께 지움, v4.5 대화 삭제 영향은 v4.5 mock 메시지 수. 실제 = v4.4 `get_deletion_impact` / `delete_career_item`(`project_deliverable` 이미 허용), `cascade.project_deliverables`를 그대로 넘김. `components/career/actions.ts`의 `deleteCareerItemAction`은 그대로(A2 파일, 수정 없음) — 이 data 함수를 부르므로 바로 동작 | `src/lib/data/deletion.ts`, `src/lib/mock/career-v45.ts`(`mockV45DeletionImpact`·`mockV45Delete`) |
| 2 UQ-PA-20 | 해결 | ②·③·④에서 막힌 메시지 `{content, sendOpts}`를 기억하고, 블록의 "다시 시도"는 `panel.retryBlocked()`로 그 메시지를 다시 보냄(입력창 글자가 아님) | `ai-panel/use-ai-panel.ts`, `panel-input.tsx` |
| 3 UQ-PA-21 | 해결 | 데모: `error.created` 때 키가 바뀌기 전에 `:new` 보존 키를 지움(첫 저장 성공 경로는 원래 지우고 있었음). A2 배선 절에 한 줄 추가 | `dev-page-shell-demo.tsx`, 이 보고서 |
| 4 주석 | 완료 | `doc-list-keys.ts` — 규칙이 디자인 시스템 5.9에 있음으로 정정 | `doc-list-keys.ts` |
| 리더 추가분 | 유지 | `listProjectDeliverables`(`career-v45.ts`) · `mockProjectDeliverables`(`mock/career-v45.ts`) 그대로 둠 | |

검사: `pnpm lint` 0건, `pnpm typecheck` 통과, `pnpm test` 1,836개 중 1,833 통과 — 실패 3개는 앞과 같은 로컬 Supabase 통합 테스트(`PGRST202`, 범위 밖). `mock-isolation` 통과(새 mock 호출은 미리보기 분기 안).

## 영역 요청 처리 (E1 S-10 · E2 S-43/S-44)

| 요청 | 상태 | 내용 | 파일 |
|---|---|---|---|
| 1 ReturnBanner | 완료 | 다음 단계 링크를 v5.6으로: `writing_chat` + 제안 프로젝트 → 그 S-10(`?focus=star`, 패널이 대화를 시작, 복귀 대상은 세션에 남음), 새 프로젝트 → 방금 저장한 경력의 S-10 새 페이지, 둘 다 없으면 링크 없음. S-10(`/career/projects/{id|new}`)에서는 "AI와 대화하며 채우기"를 숨김(UQ-24) | `common/return-banner.tsx` |
| 2 C-23 진입 | 완료 | 공통 훅 `useChooseProjectAffiliation()`(`common/choose-project-affiliation.tsx`)이 경력·교육 목록을 읽어 E2의 `AddProjectDialog mode="choose"`를 엶(기본 선택 = 가장 최근 완료 경력 [가정], 독립 "만들기" → S-08 `?item=project:`). 데이터 `listProjectAffiliations()` / `listProjectAffiliationsAction()`(mock = 저장소 경력·교육 + 기간, 실제 = v4.4 커리어 목록). C-09(`data-gate.tsx`): 새 프로젝트 대화·"직접 입력(하기)"이 소속을 모를 때 이 다이얼로그로, 보강 대화 → 그 프로젝트 S-10 `?focus=star`, `project_fields` → S-10 `?focus=star`, "이어서 대화하기" → `writingChatRedirect`(S-10/S-44 패널로 redirect). S-16 보완점(`insight-view.tsx`): "AI와 대화하며 추가"·"직접 입력" 모두 복귀 대상 기록 후 C-23, 어필 프로젝트 링크 → `projectPage` | `common/data-gate.tsx`, `applications/insight-view.tsx`, `lib/data/career-v45*.ts`, `lib/mock/career-v45.ts` |
| 2 라우트 정리 | 완료 | `routes.projectNew`·`project`·`projectDetail`·`projectDetailNew`·`writingChatNew`·`writingChat` 삭제. 남은 호출(레거시 `experience-form`·`education-form`·`achievement-list`)은 `projectPageNew`·`projectPage`·`writingChatRedirect`로 교체. `projectPageNew`에 `requirement_id` 추가 | `lib/routes.ts` 외 |
| 3 근거 링크 | 완료 | `routes.projectPage(id, { focus })` — `focus` = STAR 칸 키(`situation`·`task`·`action`·`result`·`learnings`) 또는 `star`(E1의 `parseFocus`와 같은 값). C-02: 소속 프로젝트 근거 → S-10 그 칸, 독립 → S-08 `?item=project:`, 레거시 상세 내용·정량 성과 → S-10(`result`). **S-44 근거 구간 = `?range={start}-{end}`** `[UI-가정]` — `routes.deliverable(id, { range: {start, end} })`가 만들고 `parseRangeParam(searchParams.range)`가 `{start,end} | null`로 읽음. `evidence.ts`가 산출물 본문 근거의 `source_locator {start,end}`로 채움 | `lib/routes.ts`, `lib/data/evidence.ts`, `lib/routes-v56.test.ts` |

### E2에게 전달할 것
- S-44는 `?range=`를 `parseRangeParam`(from `@/lib/routes`)으로 읽어 `highlightRange(bodyTextarea, range)`를 부르면 된다(본문을 고치면 강조 해제 — 명세).
- S-16 보완점의 `requirement_ids`는 복귀 대상 `params`에 들어가지만, `AddProjectDialog`의 "계속"이 `routes.projectPageNew`에 `requirement_id`를 넘기지 않아 S-10 "관련 요건" 줄이 안 나온다. 다이얼로그에 `requirementId?` prop을 받아 `projectPageNew({ …, requirement_id })`로 넘겨 주면 공통 훅이 넘기겠다(지금은 넘기지 않음).

검사: `pnpm lint` 0건, `pnpm typecheck` 통과(`.next/dev` 삭제 후), `pnpm test` 1,839개 중 1,836 통과 — 실패 3개는 같은 로컬 Supabase 통합 테스트(`PGRST202`), 새 `routes-v56.test.ts` 3개 통과, `mock-isolation` 통과. `pnpm build` 성공(공개 env 임시 값).

## 영역 QA 후속 (`25_ui-qa_A2-S10_review.md` · `25_ui-qa_A2-S44_review.md` + E1·E2 추가 요청)

| 항목 | 상태 | 내용 | 파일 | 영역이 할 일 |
|---|---|---|---|---|
| UQ-S10-10 | 해결 | G-1 문구를 명세 그대로("…배경은 상황에 써 주세요", 괄호 삭제) | `common/input-guide.tsx` | — |
| UQ-S10-11 | 해결 `[UI-가정]` | 시작 인사 조사를 이름 끝 글자 받침에 맞춤(`objectParticle`, 종류 "로/으로"는 `directionParticle`), 게이트 줄 "{기능}을/를"도 같음. 이름이 비면 자리 표시를 인용하지 않고 "이 프로젝트를 / 이 프로젝트에서", 산출물은 "이 산출물을". 테스트 추가 | `lib/data/career-v45-shared.ts`(+test) | E1: `project-page.tsx`의 자체 `toward()`는 `directionParticle`(labels)로 바꿀 수 있음(선택). 이름 빔 문장은 기획 확인 유지 |
| UQ-S10-12 | 해결 | `ReturnBanner`가 L-02(`/career/projects/…`, `/career/deliverables/…`, `/dev/page-shell`)에서는 sticky 없이 `ShellBanners` 안 둥근 배너로. `placement="page" \| "shell"` prop으로 강제 가능 | `common/return-banner.tsx` | — (자동 판정) |
| UQ-S10-13 | 해결 | `panel.patchDraft(patch, { inline: true })`면 `field_already_applied`를 토스트로 띄우지 않음. 거부된 패치와 코드는 `panel.patchRefusal { patch, code }`로 노출, 문구 상수 `PANEL_COPY.alreadyApplied` | `ai-panel/use-ai-panel.ts`, `career-v45-shared.ts` | **E1**: STAR 카드에서 `{ inline: true }`로 부르고, `patchRefusal.patch.field`가 그 섹션이면 섹션 아래 `text-sm text-muted-foreground` 줄로 그리기. E2 카드도 같은 방식으로 쓸 수 있음 |
| UQ-S10-14 | 백엔드 후속 | 칩 표가 `src/server/ai/context-pack/focus-slots.ts`(v4.4 `turn_done` 칩)에 한 번 더 있다. v4.5 연결(DM 11.3) 때 서버 쪽 칩 계산을 지우거나 `src/lib/data/quick-chips.ts` 상수를 쓰도록 `resumate-backend`에 전달 필요. 서버 코드는 건드리지 않음 | — | 백엔드 |
| UQ-S44-1 | 해결(이전 배치) | 산출물 근거 → `routes.deliverable(id, { range })` | `lib/data/evidence.ts` | — |
| UQ-S44-6 | 해결 | mock 초안 턴이 초안을 만들 때의 폼 본문 `bodyHash`를 `base_body_hash`에 넣음 → 본문을 고친 뒤 교체하면 "본문 바뀜" 확인을 미리보기 밖에서도 볼 수 있음 | `lib/mock/writing-chat-turn-v45.ts` | — |
| UQ-S44-7 | 해결 | `?state=deliverable-limit`에서 새 산출물 "저장하기"도 `deliverable_limit_reached`로 거부(아무것도 안 씀) | `lib/data/career-v45.ts` | — |
| UQ-S44-16 | 해결 | 산출물 삭제의 결과 처리 선택지는 영향 조회가 끝나고 결과가 있을 때만(조회 중 숨김) | `common/delete-confirm-dialog.tsx` | — |
| UQ-S44-17 | 해결(이전 배치) | C-09·S-16 → C-23 `mode="choose"` | `common/data-gate.tsx`, `common/choose-project-affiliation.tsx`, `applications/insight-view.tsx` | — |
| requirement_id | 해결 | `useChooseProjectAffiliation().open({ requirementId })` → `AddProjectDialog requirementId`(E2 추가분) → S-10 새 페이지 `?requirement_id=`. S-16 보완점이 첫 요건 id를 넘김 | `common/choose-project-affiliation.tsx`, `applications/insight-view.tsx` | — |
| E2 (4) | 해결 | `<AiPanel hideDraftTurnFailure>` — 실패한 턴이 초안 턴(`failure.requested_action === "compose_draft"`)이면 메시지 목록의 C-20을 숨김 | `ai-panel/ai-panel.tsx` | **E2**: S-44에서 이 prop을 켜고 카드에서 `panel.failure` + `panel.retry`로 실패 줄·다시 시도를 그리기 |
| E2 (5) | 해결 | = UQ-S44-6 | | — |
| E2 (6) | 해결 | 호환 `Project` 타입에 `description?: string \| null`. 읽기: 실제 = `projects.description`, mock = `description ?? summary`(독립만, 소속은 null). 쓰기: 패치에 `description`이 있으면 그 값(실제 섹션 저장 `description`, mock은 `summary`도 같이 맞춤) | `types/db.ts`, `lib/data/career.ts` | **E2**: S-43이 `summary` 대신 `description`을 읽고 쓰도록 바꾸기 |
| E2 (7) | 해결 | `DRAFT_STAGE_COPY { compose: "초안 작성 중", slow: "긴 글이라 조금 더 걸려요", failed: "초안을 만들지 못했어요. 이전 초안은 그대로예요", previous: "이전 초안" }`, `DRAFT_SLOW_AFTER_MS = 15000` | `lib/data/career-v45-shared.ts` | **E2**: 카드의 같은 문구를 이 상수로 바꾸기 |
| E1 describedBy | 해결 | `ChipSelect`·`CompetencyChips`에 `describedBy` → 트리거 `aria-describedby`(역량 추가 버튼은 `aria-invalid`도) | `common/doc-inputs.tsx` | **E1**: S-10의 DOM 속성 우회 코드를 지우고 `describedBy`로 넘기기 |

검사: `pnpm lint` 0건, `pnpm typecheck` 통과(`.next/dev` 삭제 후), `pnpm test` 1,840개 중 1,837 통과(실패 3 = 같은 로컬 Supabase 통합 테스트 `PGRST202`), `pnpm build` 성공(exit 0, 공개 env 임시 값). 작업 중 한 번 `project-page.tsx`(E1 파일, 동시 편집 중)에서 일시적인 타입 오류가 보였고 다시 돌리니 사라졌다.

## 통합 QA 후속 (`26_ui-qa_project-add_round2-integration.md`)

| 항목 | 상태 | 내용 | 파일 | 영역이 할 일 |
|---|---|---|---|---|
| UQ-INT-4 (Major) | 해결 | **화면 readiness 타입을 DM §6 v4.4 이름으로**: `ReadinessHint`에 `project_star`(옛 `complete_project_detail`은 deprecated), `next_action`에 `create_project`, `counts.projects_without_complete_star`·`standalone_projects_without_description`(옛 이름은 같은 값으로 유지), `suggested_mode`는 deprecated(호환용으로만 채움). **실제 경로**: 백엔드는 이미 v4.4 모양을 준다(`getDataReadinessV44`, zod 검증) — 손실 변환이던 shim `toLegacyReadiness`를 그대로 통과로 바꿨다(`create_project` 유지, `project_star` 유지). 백엔드에서 더 필요한 것은 없다. **mock**(`computeReadiness`)도 v4.4 판정 순서 ①경력 없음 → form ②STAR 미완 소속 프로젝트 → AI 가능 `writing_chat` / 불가 `form`, 둘 다 `suggested_project_id` + `project_star` ③내용 빈 독립 프로젝트 → `form` + `project_fields` ④그 밖 → `create_project` / `form`. **C-09**(`data-gate.tsx`): `create_project` → "AI와 대화하며 채우기" = C-23 소속 선택, `writing_chat` + 제안 → S-10 `?focus=star`, `form` + 제안 → "'{프로젝트명}' 마저 채우기"(`project_star` → S-10 `?focus=star`, `project_fields` → S-08 `?item=project:{id}&edit=content`), 제목 `project_fields` = "한 칸만 채우면 바로 쓸 수 있어요", 보조 안내 `project_star` "프로젝트는 있지만 STAR의 상황·행동이 비어 있어요 · 현재 N건" / `project_fields` "'{프로젝트명}'의 프로젝트 내용이 비어 있어요", 키 무효면 원인 줄은 "마저 채우기" 위에도 보임, 제안 없는 `form`은 경력이 없으면 "경력 먼저 입력하기" 아니면 "직접 입력하기", 보조 "직접 입력"은 작성 중 경력·교육 → S-08 항목. **C-10**(`return-banner.tsx`): `create_project`도 다음 단계(방금 저장한 경력의 S-10 새 페이지). 미리보기: `insufficient-create-project`, `insufficient-star-form` 추가, `insufficient-project-fields`는 독립 프로젝트(prj 6), `insufficient-key-invalid`는 제안 프로젝트 유지. 테스트 `readiness-v44.test.ts` | `types/db.ts`, `lib/data/readiness.ts`(+test), `common/data-gate.tsx`, `common/return-banner.tsx`, `applications/_lib/gate-preview.ts` | **S-08(E2/A2)**: `?edit=content`를 읽어 S-43 "프로젝트 내용" 섹션 편집을 열 것(아래 UQ-INT-3과 같은 신호) |
| UQ-INT-3 | 파운데이션 쪽 해결 | C-23 ② "만들기" → `routes.careerItem("project", id, { edit: "info" })` = `/career?item=project:{id}&edit=info` `[UI-가정]` | `common/choose-project-affiliation.tsx`, `lib/routes.ts` | **S-08(E2, `career-overview.tsx`)**: `?edit=info|content`를 읽어 기존 `pendingEdit`(C-22 경로와 같은 편집 열림)에 넣고, 연 뒤 URL에서 `edit`을 지울 것 — S-08이 읽기 전에는 S-43 선택만 된다 |
| UQ-INT-5 | 해결 | dev 갤러리 C-18 대안 링크 → `routes.projectPageNew({ experience: 경력 1 })` | `common/dev-state-gallery.tsx` | — |
| UQ-S44-4 (파운데이션 쪽) | 해결 | `TurnFailure.draft_turn` — `draft_started`가 왔거나 compose_draft 요청이면 true. `<AiPanel hideDraftTurnFailure>`는 `true`면 `draft_turn`으로 숨기고, 함수 `(failure) => boolean`도 받는다(페이지가 자기 `draftFailed`로 판정 가능). `draft_started` 전에 실패한 자유 입력 "초안 써 줘"는 질문 턴과 구분할 수 없어 목록에 남는다 | `ai-panel/use-ai-panel.ts`, `ai-panel/ai-panel.tsx` | **E2**: 지금 `hideDraftTurnFailure` 그대로 두면 `draft_started` 뒤 실패도 숨겨진다. 카드의 `draftFailed` 기준과 맞추려면 `hideDraftTurnFailure={(f) => f.draft_turn \|\| draftFailed}`처럼 함수로 |

검사: `pnpm lint` 0건, `pnpm typecheck` 통과(`.next/dev` 삭제 후), `pnpm test` 1,842개 중 1,839 통과(실패 3 = 같은 로컬 Supabase 통합 테스트 `PGRST202`), 새 `readiness-v44.test.ts` 2개 통과, `pnpm build` 성공(exit 0, 공개 env 임시 값).

## 브랜드 토큰 정합 (`27_ui-qa_v5-brand-conformance.md`, 디자인 시스템 v5 / main v4 variant)

| ID | 상태 | 수정 | 파일 |
|---|---|---|---|
| UQ-BR-1 | 해결 | 이탈 확인 "저장하지 않고 나가기" = `Button variant="destructive-ghost"`(색 덧씌우기 제거) | `common/shell/page-shell.tsx` |
| UQ-BR-2 | 해결 | 삭제 메뉴 3곳(프로젝트 삭제·이 대화 삭제·산출물 삭제) = `DropdownMenuItem variant="destructive"`, 항목·아이콘 색 class 제거 | `project-page/project-page.tsx`, `ai-panel/ai-panel.tsx`, `deliverable/deliverable-page.tsx` |
| UQ-BR-3 | 해결 | S-43 산출물 행 = `<Item asChild><Link>…</Link></Item>`(C-25 카드와 같은 hover·반경), 아이콘 muted 덧씌우기 제거 | `career/career-overview.tsx` |
| UQ-BR-4 | 해결 | 패널 대화 기록 행 = `<Item asChild active={현재}>`(hover·선택 `bg-primary/10`, `aria-current`는 Item) | `ai-panel/ai-panel.tsx` |
| UQ-BR-5 | 해결 (리더 판정) | `Button chip`·`chip-dashed`: 평소 바탕 그대로(회색 채움 / 투명 점선), hover·열림 `hover:bg-primary/10 hover:text-primary-text aria-expanded:…`. `SelectTrigger variant="chip"`: 같은 hover + `data-[state=open]:bg-primary/10 data-[state=open]:text-primary-text` | `ui/button.tsx`, `ui/select.tsx` |
| UQ-BR-6 | 해결 | ghost 버튼의 `text-muted-foreground` 제거 4곳("산출물 추가" 2, "AI에게 물어보기", 본문 빈 칸 AI 버튼). `-ml-2` 레이아웃은 유지 | `career-overview.tsx`, `project-page.tsx`, `deliverable-page.tsx` |
| UQ-BR-7 | 해결 (디자이너 결정) | `ghost` variant에 `aria-pressed:bg-primary/10 aria-pressed:font-medium aria-pressed:text-primary-text` 추가, "대화 기록" 아이콘은 ghost icon `Button` + `aria-pressed`(`bg-accent` 덧씌우기 제거). 처음 적용했던 `Toggle`은 되돌림(머리 아이콘 버튼과 크기·반경을 맞추려는 디자이너 결정) | `ui/button.tsx`, `ai-panel/ai-panel.tsx` |
| UQ-BR-8 | 해결 | "끝난 대화" = `Badge variant="muted"` | `ai-panel/ai-panel.tsx` |
| UQ-BR-9 | 해결 (디자이너 결정) | `Button` variant `warning-ghost` 신설(`text-warning-subtle-foreground hover:bg-warning-subtle … aria-expanded:…`), S-44 "확인이 필요한 내용 N개" 트리거 = `variant="warning-ghost" size="sm" className="-ml-2"`(글자 색 class 제거, 아이콘 `text-warning` 유지) | `ui/button.tsx`, `deliverable-draft-card.tsx` |
| UQ-BR-10 | 해결 | 초안 표 머리 행 `bg-muted/50` 제거 | `deliverable-draft-card.tsx` |
| UQ-BR-11 | 해결 | 이전 초안 접기 = `CollapsibleTrigger asChild` + `Button variant="ghost" size="xs"`(포커스 링·초록 hover), 떠 있는 "Resumate AI" 버튼의 `bg-card` 제거, 역량 메뉴 라벨의 중복 muted 제거 | `deliverable-draft-card.tsx`, `common/shell/doc-body.tsx`, `common/doc-inputs.tsx` |

동작 변경 없음(클릭 대상·키보드·문구 동일). 검사: `pnpm lint` 0건, `pnpm typecheck` 통과, `pnpm test` 126개 파일 1,975개 전부 통과(머지 뒤 로컬 통합 테스트도 통과), `pnpm build` 성공(exit 0, 공개 env 임시 값). 실행 중인 dev 서버(:3000)에서 `/career?state=default`·`/dev/page-shell`(S-10·S-44 모양) SSR 200, S-43 산출물 행이 `data-slot="item"`으로 렌더되는 것 확인. 브라우저 상호작용(hover 색 실제 확인)은 하지 않았다.

- 디자이너 §6 후속(2026-11-03): UQ-BR-7·9를 위 표대로 반영. `SELECT_TRIGGER_CHIP`(hover·open 초록, `hover:bg-accent` 없음)과 떠 있는 버튼 `bg-card` 제거는 이미 들어가 있어 §6 2·6번과 일치. 재검사: lint 0건, typecheck 통과, `pnpm test` 전부 통과.
