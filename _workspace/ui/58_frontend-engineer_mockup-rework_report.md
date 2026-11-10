# 58 런 — 자기소개서 화면 시안·공통 컴포넌트 재작업 보고 (frontend-engineer, 2026-11-10)

기준: 브리프 `_workspace/ui/58_brief_mockup-rework.md` + 시안 3장(`_workspace/ui/58_mockup/`). 모양은 시안, 값·항목은 확정 결정을 따랐다. 커밋하지 않았다.

## 1. 화면별 시안 ↔ 구현 대조

### S-14 추가 모달 (`add-application-dialog.tsx`)
| 시안 요소 | 구현 | 쓴 공통 컴포넌트 |
|---|---|---|
| 넓은 모달 약 830px, 두 단계 같은 크기 | `sm:max-w-[52rem] sm:h-[min(52rem,90dvh)]` 고정 높이, `flex-col`(폼이 남은 높이를 채움). <640은 전체 화면 시트(기존 UQ-745 유지) | `Dialog`·`DialogContent`·`DialogHeader`·`DialogFooter` |
| 제목 "자기소개서 추가" + X | `DialogTitle` 보이게, X는 `DialogContent` 기본 닫기 → 기존 닫기 확인 가드 그대로 | `DialogTitle` |
| 단계 표시·부제 없음 | `StepIndicator` 삭제, 부제는 `sr-only` `DialogDescription`(단계 이름을 읽어 준다) | — |
| ① "JD 입력" · "포지션 공고"(`https://www.jd.com`) · "직접 입력"(큰 칸, "포지션 공고 내용을 입력해주세요.") · 오른쪽 [다음] | 그대로. "또는" 구분선 삭제 | `Label`·`Input`·`Textarea`·`Button` |
| ② "지원 기업 / 포지션" · 지원 기업("기업 명") · 지원 포지션("포지션 명") 세로 · "공고 내용" · 직접 입력 · [자기소개서 작성] | 그대로(2열 → 세로 한 열). 공고 칸이 남은 높이를 채운다 | 같음 |
| 상시 보조 문구 없음 | 배타 안내 = `sr-only` 설명, 길이 경고·글자 수 = 경고/90% 이상일 때만, U-6 안내 = 공고 칸 포커스 때만(낭독기는 늘), 키 없음 C-18 = ②에서만, C-19 배지 삭제, 진행 표시 = 버튼 안 스피너+글자 | `AiErrorNotice`·`AiLock`·`CharCount` |

### S-13 목록 머리 (`applications/page.tsx`, `application-list.tsx`, `add-application-launcher.tsx`)
| 시안 요소 | 구현 | 공통 |
|---|---|---|
| 위 바 "자기소개서 관리" | L-01 `PageCrumbs` 그대로 | `PageCrumbs` |
| 큰 페이지 제목 없음 | `PageHeader` 제거, `h1.sr-only` | — |
| 왼쪽 "최근 작성 순" 칩 | 회색 알약 모양의 **고정 표기**(`ApplicationSortNote`, 버튼·⌄ 없음) | `Button variant="chip"`과 같은 토큰(`bg-muted rounded-full h-8`) |
| 오른쪽 "⊕ 자기소개서 작성" | `AddApplicationLauncherButton` 아이콘을 `CirclePlus`로 | `Button` |

### S-46 공통 머리 (`cover-letter-screen.tsx`)
| 시안 요소 | 구현 | 공통 |
|---|---|---|
| L-02 셸(로고·저장하기·계정) | 그대로 | `PageShell`·`SaveButton` |
| 뒤로 버튼 + 이동 줄 | 그대로 "자기소개서 관리 › {이름}" (아래 4절 참고) | `CrumbRow` |
| 큰 굵은 제목 | 그대로 + 오른쪽 ⋯(자기소개서 삭제) | `DocTitleInput` |
| 라벨/값 줄(회색 라벨 열 + 컨트롤) | `InlineFields`(가로) → **`FieldRows`/`FieldRow`**(S-10 머리의 dl 2열)로 바꿈. 줄: 마감일(두 상태) · 지원 직무 · 채용 공고 "JD 상세"(작성 상태) | `FieldRows`·`FieldRow`·`Input type=date`·`Button link` |
| 전폭 구분선 | 그대로 | `Separator` |
| (시안에 없음) 요약 한 줄 | 머리에서 빼서 "자기소개서" 탭 머리 아래 작은 글로 옮김 | — |

### S-46 문항 설정 상태 (`question-setup.tsx`, `question-fields.tsx`)
| 시안 요소 | 구현 | 공통 |
|---|---|---|
| 가운데 좁은 열, 위아래 여백 | `max-w-[52rem] mx-auto`, `pt-16 pb-10` | — |
| "자기소개서 문항 추가" + 회색 부제 | 그대로(옛 안내 `Alert` 삭제) | — |
| 한 줄 = [문항 입력][800 자] | `QuestionTextField compact`(한 줄 높이에서 시작, 긴 문장만 늘어남, 자리 표시 = 기본 문항 문구) + 새 `CharLimitInput`(숫자 + 접미사 "자") | `Textarea`·**`InputGroup`/`InputGroupInput`/`InputGroupAddon`/`InputGroupText`** |
| 기준·메모·삭제·행 라벨 안 보임 | 행 끝 작은 ⋯ 메뉴: 글자 수 기준(라디오) · 메모 추가 · 문항 삭제. 메모는 열거나 값이 있으면 행 아래. 기준이 기본(공백 포함)이 아닐 때만 한 줄 표기. A12 안내는 글자 수 칸 포커스 때만 | `DropdownMenu`(RadioGroup) |
| 마지막 줄: 왼쪽 "+ 문항 추가 n/5"(고스트) · 오른쪽 [자기소개서 작성 시작] | 같은 줄 `justify-between`. 5개 상한·1개 하한 문구, 요건 선행 추출 진행/실패(`req.slot`)는 그 아래 | `Button ghost`·`Button` |

### S-46 작성 상태 (`cover-letter-screen.tsx`, `answer-tab.tsx`, `cover-letter-panel.tsx`)
| 시안 요소 | 구현 | 공통 |
|---|---|---|
| 왼쪽 세로 탭(약 190px, 선택 = 회색 알약, 구분선 없음) | `TabsList variant="pill"` 세로, `w-48`, `border-r` 제거, 선택 색을 `bg-muted`+`text-foreground`로 대체(같은 변형 접두사로 tailwind-merge) | `Tabs`·`TabsList`·`TabsTrigger` |
| 가운데 본문 + 손잡이 + 오른쪽 패널 | 그대로 S-10·S-44와 같은 `DocBody`(좌 스크롤 열 · `ResizeHandle` · 패널, 좁은 화면 시트) | `DocBody`·`ResizeHandle` |
| 본문 머리 "자기소개서" + ⋯ | `h2` + ⋯ 메뉴("전체 복사") | `DropdownMenu` |
| 문항 문장(작은 회색) → 제목(굵게, "제목") → 내용("내용") | 문항 문장 `text-sm muted`, 제목 = **`DocTitleInput`**(본문 크기 굵게), 내용 = **`DocTextarea grow`** | `DocTitleInput`·`DocTextarea` |
| 문항 ⋯·글자 수·AI 제안 표식은 작게, 필요할 때만 | ⋯는 마우스 올림/포커스 때 보임(터치 기기는 늘), 메뉴에 편집·복사·메모 추가·접기/펼치기·이동·삭제. 글자 수는 그 문항을 쓰는 중·90% 이상·초과·오류 때만(S-10 STAR 규칙). "AI 제안 있음"은 작은 `Badge variant="ai"` | `Badge`·`DropdownMenu` |
| 문항 사이 구분선 없음 | `Separator` 제거, 간격 `space-y-10` | — |
| Resumate AI 패널(머리 ☰·+·⋯·×, 칩 줄, "Resumate AI에게 물어보세요" + 보내기) | **공통 `<AiPanel>`** 그대로 — 아래 2절 어댑터 | `AiPanel`(내부: `Message`·`Bubble`·`MessageScroller`·`PanelInputArea`/`InputGroup`·`AiLock`·`AiErrorNotice`·`DeleteConfirmDialog`·`ProviderBadge`) |

## 2. 공통 `AiPanel` 어댑터 설계

- 새 파일 `src/components/applications/cover-letter/use-cover-letter-ai-panel.ts` — `useCoverLetterAiPanel(cl, placement): AiPanelController`. 서류 대화 로직은 **그대로 `useCoverLetterPanel`**에 있고, 어댑터는 모양만 맞춘다.
  - 입력창 글자는 어댑터가 들고, 보내기는 `cl.send(text, { onSent: () => setInput("") })` — **입력창은 턴이 실제로 나갈 때만 비운다(CF-S8 그대로)**. 칩은 입력창을 비우지 않는다(기존 동작).
  - CF-S8 저장 중(`preparing`) → 공통 `phase: "starting"`(입력 잠금 + 도는 표시). `replying`/답 글자 있음 → `streaming`, 초안·글자 수 맞춤 중 → `drafting`. `responding = phase≠idle || preparing`.
  - 메시지: 빈 AI 행 제외(기존 동작), `user_number` 매김, 상태 ok→done·pending→streaming·failed→failed. 대화 행은 있는데 메시지가 없으면 인사 행을 맨 위에(공통 패널은 `chat`이 있으면 `greeting`을 그리지 않으므로).
  - 칩: 서류 대화 칩 문자열 → `QuickChip`. 초안 칩 판정·style(`shorter`/`fit_length`)은 옛 `cover-letter-panel.tsx` 규칙(`isDraftChip`·`chipTurnOptions`) 그대로. **초안 6회를 다 쓰면 초안 칩을 줄에서 뺀다**(옛 화면은 비활성) `[UI-가정]` + 입력 위 한 줄 문구.
  - 끝난 대화·메시지 상한(서류 대화 규칙 그대로 39에서 막음) → 공통 `closed` 상자. 실패한 턴 → 공통 C-20(다시 보내기 = `cl.retry`), 초안 턴 실패는 `hideDraftTurnFailure`로 목록에서 숨기고 3.26 카드가 그린다(기존과 같음).
  - 기록 열기 → `cl.openChat(summary)`(UQ-760 경합 처리 그대로), 새 대화·삭제·중단 → `cl.*`. 패치/플래시/복귀 대상은 서류 대화에 없으므로 no-op.
  - 열기/닫기·너비·좁은 화면 시트는 화면의 `usePanelPlacement`(`DocPanelPlacement`)를 그대로 쓴다.
- `cover-letter-panel.tsx`는 `<AiPanel panel={…} lockEntry="draft" copy={{ lock, notice }} proposalInline hideDraftTurnFailure renderProposal={QuestionProposalCard + "다음 문항도…"} renderAboveInput={초안 상한 줄} onDirectInput />` 한 덩어리가 됐다(생 `Textarea`·자체 머리·자체 기록 팝오버 삭제).
- **공통 `AiPanel` 변경(하위 호환)**: `ai-panel.tsx`·`panel-input.tsx`에 선택 속성 `copy?: { lock?, notice? }`·`lockEntry?`(기본 `"writing_chat"`)만 더했다. 넘기지 않으면 지금과 같은 `PANEL_COPY.lock[target]`·`PANEL_NOTICE[target]`·`writing_chat` → **S-10·S-44 동작 불변**. `useAiPanel`(889줄)은 **건드리지 않았다**.
- 발견·수정: 옛 서류 대화 컨트롤러는 `useAiConsentGate()`의 `dialog`를 어디에도 그리지 않아 **동의 필요(C-21) 창이 뜨지 않았다**. 컨트롤러에 `consentDialog`를 더해 공통 패널이 그리게 했다(보내기 순서·로직은 그대로).

## 3. 바꾼 파일
- `src/components/career/ai-panel/ai-panel.tsx`, `panel-input.tsx` — 선택 속성 `copy`·`lockEntry`(기본값 = 지금 동작)
- `src/components/applications/cover-letter/use-cover-letter-ai-panel.ts` (신규) — 어댑터
- `src/components/applications/cover-letter/cover-letter-panel.tsx` — 공통 `AiPanel`로 교체
- `src/components/applications/cover-letter/use-cover-letter-panel.ts` — `consentDialog` 노출만
- `src/components/applications/cover-letter/cover-letter-screen.tsx` — 머리 `FieldRows`, 문항 설정 열, 세로 알약 탭, 패널 연결, 요약 줄 이동
- `src/components/applications/cover-letter/answer-tab.tsx` — 시안 3 문서형 본문
- `src/components/applications/cover-letter/question-setup.tsx`, `question-fields.tsx` — 시안 2 한 줄 행, `CharLimitInput`, `QuestionTextField compact`
- `src/components/applications/add-application-dialog.tsx` — 시안 1
- `src/app/(dashboard)/(gated)/applications/page.tsx`, `src/components/applications/application-list.tsx`, `add-application-launcher.tsx` — S-13 머리
- `src/lib/mock/store.ts` (파운데이션 파일, **확인 요청**) — dev 서버가 R15 이전에 만든 mock 저장소(`globalThis`)에 `cover_letter_chats` 표가 없어 작성 상태 미리 보기가 서버에서 `Cannot read properties of undefined (reading 'filter')`로 깨졌다(내 변경과 무관, 이미 떠 있던 서버 문제). 재시작 없이 검증하려고 **없는 최상위 표만 새 픽스처에서 채우는 백필**(저장소 객체당 1회)을 넣었다. 운영 경로 무관(production에서는 이 함수가 먼저 던진다). 파운데이션이 원치 않으면 되돌리고 dev 서버를 재시작하면 된다.

## 4. 기능 불변 확인
- `pnpm test` **158파일 2,550건 전부 통과**(변경 전과 같은 수 — 깨진 소스 가드 없음, 고친 테스트 없음). 관련 가드: `no-client-static-members.test.ts`(RSC 경계 — 정적 속성 없음, S-13이 `<AddApplicationLauncherButton />`를 그대로 씀), `cover-letters.read.test.ts`(page의 정본 읽기에 catch 없음 — page.tsx는 건드리지 않음), `question-form.test.ts`(슬롯 `slotsInUse`·`slot_high_water`), `save-version.test.ts`(기대 버전·CF-S9 `staleDialogReloadOnly`), `panel-rules.test.ts`(UQ-760), `form-draft.test.ts`(S-14 입력 보존), `unanswered.test.ts`(공통 패널).
- 로직 손대지 않음: `runSave`(기대 버전·CF-S7·`invalid_slot`·`slot_high_water`)·`beforeTurn`(CF-S8)·`StaleWriteDialog reloadOnly`(CF-S9)·슬롯 발급기·입력 보존·탭 `replaceState`·`useCoverLetterPanel`의 턴/SSE/상한/기록 열기·S-14의 `goNext`/`create`/Q53-1/입력 보존은 그대로다. JSX만 바꿨다.

## 5. `[UI-가정]` 목록
1. S-13 정렬 표기: 칩 모양 고정 글자, ⌄·버튼 없음(선택지가 없다, CF-9).
2. S-14: 배타 안내는 `sr-only` 설명으로만, 길이 경고·글자 수는 경고/90%↑일 때만, U-6 안내는 공고 칸 포커스 때만, 키 없음 C-18은 ②에서만, C-19 배지 없음, ②의 [이전] 유지(시안에 없지만 ①로 돌아가는 길).
3. S-46 문항 설정: 기준·메모·삭제 = 행 끝 ⋯ 메뉴, 기준은 기본이 아닐 때만 한 줄, A12 안내는 글자 수 칸 포커스 때만, C-19 배지 없음, 옛 안내 `Alert`(QUESTION_SETUP_NOTE) 대신 시안 부제.
4. S-46 작성 탭 선택 색 = 회색(`bg-muted`) — 공통 알약(연한 초록) 대신 시안 3.
5. 자소서 탭: "전체 복사"는 머리 ⋯로, 빈 상태는 상자 대신 작은 글 묶음(+ ANSWER_NOTE·G-2는 빈 상태에서만), 문항 ⋯는 hover/포커스 때(터치는 늘), 접기/메모 추가는 ⋯ 메뉴 항목, 글자 수는 쓰는 중·90%↑·초과·오류 때만, 요약 줄은 탭 머리 아래, "+ 문항 추가"는 고스트.
6. 패널: 초안 상한에 닿으면 초안 칩을 줄에서 빼고 입력 위 한 줄로 이유 표시, 끝난 대화 상자 문구는 공통 문구(39~40번째 메시지에서 "이 대화는 끝났어요…"/"이 대화가 길어졌어요…"), 패널 안 G-2 줄은 공통 패널에 없어 뺐다(시작 영역 안내 = PANEL_FIXED_NOTE), 대화 중 시작 인사는 대화가 비었을 때만.

## 6. 시안과 일부러 다르게 둔 자리
- 글자 수 기본 **800**(시안 600, CF-U2) — 폼 기본값 그대로.
- 마감일 **일 단위 날짜 칸 하나**(시안 연도·월 셀렉트 두 개, CF-4) — 같은 높이·테두리의 `Input type=date`.
- 정렬 "최근 작성 순" **선택지 없음**(CF-9).
- 작성 상태 머리에 **지원 직무·JD 상세** 줄 추가(확정 항목) — 마감일과 같은 라벨/값 모양.
- 사이드바 **"모의 면접" 메뉴 없음**(RM-1) — 손대지 않음.
- 이동 줄 **"자기소개서 관리 › {이름}"** — 시안 2의 세 번째 마디 "자기소개서 상세"는 쓰지 않는다. 브리프는 "S-10·S-44 규칙(… › 상세)"을 따르라 했지만 **CF-A11 확정**(UX 02 S-46 이동 줄 · design-system 5.12 1행)이 그 마디를 명시적으로 금지한다 → 확정을 따랐다.

## 7. 검증
- `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm test` 158/2,550 통과 · `pnpm build` 통과.
- dev 서버(:3000, 이 worktree에서 실행 중, 끄지 않음) `curl` 렌더 — 모두 **HTTP 200, "Element type is invalid" 0건**:
  | 주소 | 결과 · 확인한 문구 |
  |---|---|
  | `/applications?state=empty` | 200 · "최근 작성 순" |
  | `/applications?new=1&state=step1` | 200 · "최근 작성 순"(모달은 Radix Portal이라 SSR HTML에 없다 → 그 페이지가 싣는 클라이언트 청크 31개에서 "JD 입력"·"포지션 공고"·"https://www.jd.com"·"포지션 공고 내용을 입력해주세요."·"자기소개서 추가" 확인) |
  | `/applications?new=1&state=step2` | 200 · 같은 청크에서 "지원 기업 / 포지션"·"공고 내용"·"기업 명"·"포지션 명" 확인 |
  | `/applications/…0003/cover-letter?state=questions` | 200 · "자기소개서 문항 추가"·"작성하고자 하는 자기소개서 문항을 입력해주세요"·"문항 추가"·"자기소개서 작성 시작"·"마감일" |
  | `/applications/…0001/cover-letter?state=writing` | 200 · "자소서"·"채용 공고"·"인사이트"·"Resumate AI에게 물어보세요"·"마감일"·"지원 직무"·"JD 상세"·"대화 기록"·"새 대화"·"패널 닫기"·"지금까지 내용으로 초안 만들기"·자리 표시 "제목"/"내용" |
  | `…0001/cover-letter?state=draft-stream` | 200 · 같음 |
  | `…0001/cover-letter?state=save-conflict` | 200 · 같음 |
  | `/board?state=default` | 200 |
  - 작성 상태 3개 주소는 3절의 mock 저장소 백필 전에는 서버 오류(`cover_letter_chats` 없음 → 클라이언트 렌더 전환)였다. 백필 뒤 정상.
- 브라우저 확인: **못 했다**(브리프대로 Chrome 확장 미연결·Safari 권한 없음). 간격·크기·hover 노출·패널 손잡이 동작은 눈으로 확인하지 않았다 — ui-qa 브라우저 점검 필요.

## 8. 요청
- 파운데이션: `src/lib/mock/store.ts` 백필 유지 여부 결정. `src/components/career/ai-panel/`의 `copy`·`lockEntry` 속성 추가 검토(S-10·S-44 기본값 불변).
- 기획/디자인 문서 후속: design-system 5.12(S-46 머리 `InlineFields`→`FieldRows`, 문항 설정 카드형 → 한 줄 행, 자소서 탭 구분선·전체 복사 위치 등)와 5.6.2(S-14 StepIndicator 삭제)가 이번 시안 기준 구현과 다르다 — ui-designer 갱신 필요.
- 백엔드 요청 없음(연결 대기 함수 없음).

---

## 9. 공통 모달 (사용자 추가 지시: "경력 추가 모달을 공통 모달로 써서 모달을 만들어야지")

### 9.1 꺼낸 컴포넌트: `src/components/common/form-dialog.tsx`
S-08 "커리어 추가" 모달(`add-career-dialog.tsx`, C-22)이 파일 안에 직접 갖고 있던 틀을 그대로 옮겼다. 하위 조각은 모두 **이름 붙은 export**다(정적 속성 없음, RSC 경계 가드 통과).

| export | 모양 (클래스는 옛 커리어 모달 그대로) | API |
|---|---|---|
| `FormDialog` | `Dialog` + `DialogContent showCloseButton={false}` `flex max-h-[calc(100dvh-2rem)] w-[602px] flex-col gap-4 rounded-[20px] p-5 sm:max-w-[602px] lg:h-[calc(100dvh-200px)] lg:max-h-[840px]` (`FORM_DIALOG_CONTENT_CLASS`로도 export) | `open`, `onOpenChange`, `onCloseAutoFocus`(통과), `className`, `children` |
| `FormDialogForm` | `<form noValidate>` `flex min-h-0 flex-1 flex-col gap-4` | `form` 속성 전부(`onSubmit`, `id` …) |
| `FormDialogHeader` | `DialogTitle flex-1 text-xl leading-normal font-semibold` + `DialogDescription sr-only` + `DialogClose > Button ghost icon-sm aria-label="닫기"` + `X size-6` | `title`, `description` |
| `FormDialogBody` | `-mx-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1` | `className`, `children` |
| `FormDialogFooter` | `flex justify-end` | `className`(예: S-14 ②의 `justify-between`), `children` |
| `FormDialogSubmit` | `Button type="submit"` + 진행 중 `Loader2 animate-spin` | `pending`, `disabled`, `children` |
| `FormSection` | `section flex flex-col gap-2` + `h3 text-base font-medium` + `div flex flex-col` | `title`, `fill`(남은 높이 채움: `min-h-48 flex-1`) |
| `FormField` | `div flex flex-col gap-2 py-2` + `Label text-sm font-normal` + 입력 + `FormFieldError id="{id}-error"` | `id`, `label`, `error`, `fill` |
| `FormFieldError` | `p role="alert" text-sm text-destructive` + `CircleAlert size-4` (메시지 없으면 그리지 않음) | `id`, `message` |
| `FormFillField` | `section flex min-h-48 flex-1 flex-col gap-2` + `Label text-base font-medium` (커리어 모달의 "근무/교육/프로젝트 내용" 칸) | `id`, `label`, `children` |

### 9.2 커리어 추가 모달이 바뀌지 않았다는 근거
- `add-career-dialog.tsx`는 위 조각으로 바꾸고 파일 안의 `Section`·`Field`·`FieldError`·모달 틀을 지웠다. 폼 로직(검증·생성·수정·충돌·`client_id`·`afterCareerItemSaved`·`PeriodField`·`SkillsField`)은 한 줄도 안 바뀌었다.
- **마크업 동일 비교**: 임시 Vitest(Dialog를 통과용 태그로 mock)로 `git show HEAD`의 옛 `AddCareerDialog`와 새 것을 `renderToStaticMarkup`해 **경력·교육·프로젝트 3종의 HTML이 글자 그대로 같음**을 확인했다(3/3 통과, 확인 뒤 임시 파일은 지웠다). 수정 모드는 같은 코드 경로(제목·초기값만 다름)라 따로 비교하지 않았다.
- 기존 테스트 `career-overview.test.ts`·`education-derive.test.ts` 포함 전체 통과.
- `/career?new=experience|education|project&state=default` 렌더 200, "Element type is invalid" 0건, 클라이언트 청크에 "경력 추가"·"재직 정보"·"근무 내용"·`FormDialog`·`FormFillField` 있음. (`?state=` 없이는 로그인 페이지로 307 — 실제 인증 경로라 정상.)
- 같이 옮기지 않은 것: `add-project-dialog.tsx`(C-23)는 **다른 틀**(`sm:max-w-md` 작은 모달 + `DialogHeader`/`DialogFooter` + 라디오 목록)이라 옮기면 모양이 바뀐다 → 그대로 둠. `choose-project-affiliation.tsx`는 틀을 직접 그리지 않고 `AddCareerDialog`·`AddProjectDialog`를 부르기만 해서 자동으로 공통 틀을 쓴다.

### 9.3 S-14 대조표 (공통 모달 위에서 다시 짬)
| 시안 1 요소 | 구현 | 공통 조각 |
|---|---|---|
| 모달 폭(그림 836px ÷ 1.39 ≈ 602px), 두 단계 같은 크기 | 커리어 모달과 같은 틀 · 데스크톱 고정 높이 | `FormDialog` |
| 제목 "자기소개서 추가" + × | 같음. ×는 `DialogClose` → `onOpenChange(false)` → 기존 닫기 확인(CF-A17) 그대로 | `FormDialogHeader` |
| ① 섹션 "JD 입력" | 섹션(남은 높이 채움) | `FormSection fill` |
| "포지션 공고" + `https://www.jd.com` | URL 칸. 형식 오류는 그때만 칸 아래 | `FormField` + `FormFieldError`(`add-ap-url-error`) |
| "직접 입력" 큰 칸 | 남은 높이를 채우는 텍스트 영역(`min-h-48 flex-1`, 커리어 내용 칸과 같은 클래스) | `FormField fill` |
| 바닥 오른쪽 [다음] | 진행 중 스피너 + "공고를 가져오는 중"/"공고 내용을 정리하는 중" | `FormDialogFooter` + `FormDialogSubmit` |
| ② 섹션 "지원 기업 / 포지션" · "지원 기업"(기업 명) · "지원 포지션"(포지션 명) | 같음, 세로 | `FormSection` + `FormField` ×2 |
| 섹션 "공고 내용" · "직접 입력" 큰 칸 | 남은 높이 채움 | `FormSection fill` + `FormField fill` |
| 바닥 오른쪽 [자기소개서 작성] | 같음(보드에서 열면 "추가하기") | `FormDialogSubmit` |
| 상시 보조 문구 없음 | `invalid_source_url`·만들기 실패 = `FormFieldError`(그때만) + "주소 없이 만들기", 추출 실패·키 무효 = `AiErrorNotice`(그때만), 가져오기 실패 = `Alert warning`(그때만), 키 없음 C-18 = ②에서만, 배타 안내 = `sr-only`, U-6 = 공고 칸 포커스 때만 | `FormFieldError`·`AiErrorNotice`·`AiLock`·`Alert` |

- 로직 불변: `goNext`(가져오기 → 미리 보기 추출, 경로 ⑥ 원인별 처리), `submitStep1`(Q53-1 게이트·미리 보기 쓰기 막기·동의), `create`(`invalid_source_url`·`preview_skip_reason` 토스트·`fromBoard` 토스트+보드 유지), 닫기 확인, 세션 입력 보존(`readFormDraft`·`writeFormDraft`·`keepsFormDraftOnLeave`), 단계 전환 포커스(`add-ap-company`·`add-ap-url`/`add-ap-direct` id 유지)는 손대지 않았다. 폼 하나(`id="add-ap-step1"`/`"add-ap-step2"`)가 머리·본문·바닥을 감싸고 `onSubmit`이 단계별 함수다(옛 `form=` 연결 대신).
- `[UI-가정]` 추가: 좁은 화면(<640)은 공통 틀 그대로(화면 폭 − 2rem, 높이 `100dvh − 2rem`) — 옛 전체 화면 시트(UQ-745)는 커리어 모달과 맞추며 버렸다. ②의 [이전]은 시안에 없지만 남겼다(바닥 왼쪽).

### 9.4 검증 (공통 모달 반영 뒤)
- `pnpm lint`·`pnpm typecheck`·`pnpm test`(158파일 2,550건)·`pnpm build` 전부 통과.
- 렌더: `/applications?new=1&state=step1`·`step2`·`/applications?state=empty` 200 · `/career?new=experience|education|project&state=default` 200 — 모두 "Element type is invalid" 0건. 모달은 Portal이라 HTML에 없어 클라이언트 청크로 확인: "JD 입력"·"포지션 공고"·"지원 기업 / 포지션"·"공고 내용"·"자기소개서 추가"·`https://www.jd.com`·"포지션 공고 내용을 입력해주세요."·"기업 명"·"포지션 명"·`w-[602px]`(공통 틀) 있음.
- 브라우저 확인은 여전히 못 했다(ui-qa 필요).
