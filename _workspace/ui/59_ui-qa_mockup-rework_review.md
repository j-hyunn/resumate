# 59 런 UI QA — 자기소개서 화면 시안 재작업(58 런) 검수 (ui-qa, 2026-11-10)

- 대상: 워크트리 `cover-letter-ui-469976`(브랜치 `claude/cover-letter-ui-mockup`, 커밋 전 작업 트리)
- 기준: 시안 3장 `_workspace/ui/58_mockup/` (모양·배치) + 브리프 `58_brief_mockup-rework.md`의 확정 결정(값·항목) + `docs/planning/02-user-flows.md` S-13·S-14·S-46
- 방법: 코드 ↔ 시안 이미지 대조, 공통 컴포넌트 추적, 어댑터 prop 따라가기, 기계 검사, dev 서버 `curl`. **브라우저 캡처 없음**(Chrome 확장 미연결·Safari 권한 거절) — 눈으로만 확인되는 것은 끝의 "브라우저 확인 필요"에 따로 적었다.
- **작업 트리가 검수 중에 바뀌었다**: 11:37~11:39에 `src/components/common/form-dialog.tsx`(신규)·`src/components/career/add-career-dialog.tsx`·`src/components/applications/add-application-dialog.tsx`가 다른 작업으로 바뀌었다(58 보고서에 없는 변경 — S-14를 S-08 커리어 추가 모달 틀 `FormDialog` 602px로 옮기는 중). 아래 S-14 판정은 **11:41 시점 트리** 기준이고, 기계 검사는 그 시점에 다시 돌렸다.

## 요약

| 심각도 | 건수 | ID |
|---|---|---|
| Critical | 0 | — |
| Major | 3 | UQ-762(문항 설정 열 폭), UQ-763(S-14 모달 폭·공통 틀 — 진행 중 변경으로 해소 중, 재확인 필요), UQ-764(메시지 상한 39에서 "끝났어요" 문구) |
| Minor | 8 | UQ-765 ~ UQ-772 |

- **공통 컴포넌트 지적은 실질적으로 해소됐다.** `cover-letter-panel.tsx`는 65줄짜리 `<AiPanel>` 한 덩어리가 됐고 자체 메시지 목록·`Textarea` 입력창·자체 머리·기록 팝오버가 모두 사라졌다. 본문은 `DocTitleInput`·`DocTextarea`, 머리는 `CrumbRow`·`DocHead`·`FieldRows`, 3단은 `DocBody`(+`ResizeHandle`), 탭은 `Tabs variant="pill"`, 글자 수 칸은 `InputGroup`이다. S-14는 11:39 이후 S-08과 같은 `FormDialog` 틀로 옮겨지는 중이다.
- **시안 모양(문구·순서·배치·테두리 없는 문서형 본문·회색 알약 탭·⊕ 버튼)은 대부분 맞다.** 남은 가장 큰 차이는 **크기 비례**다 — 브리프가 시안 그림의 픽셀(약 830px)을 CSS 픽셀로 옮겨, 문항 설정 열이 시안보다 약 1.4배 넓다(UQ-762). 같은 이유로 S-14 모달이 832×832 정사각이었는데(시안은 세로로 긴 모양), 이것은 진행 중 변경(602px)으로 고쳐지는 중이다(UQ-763).
- **회귀 없음(코드 기준)**: 공통 `AiPanel`·`PanelInputArea`에 더한 `copy`·`lockEntry`는 넘기지 않으면 이전과 같은 값이다. CF-S1~S9·슬롯 키·정본 읽기·CF-S8 로직 파일은 바뀌지 않았고 JSX 연결도 이어져 있다. 다만 어댑터가 공통 "끝난 대화" 상자를 쓰면서 **39번째 메시지 상한 문구가 틀어졌다**(UQ-764).
- 기계 검사: lint·typecheck·test(158파일 2,550건)·build 모두 통과(11:34~11:35 1회, 동시 변경 뒤 11:41 2회째도 통과). dev 서버 미리 보기 9개 주소 모두 200, "Element type is invalid" 0건.

**사용자가 "시안과 같다"고 볼 만한가 — 한 줄 판단**: 구성·문구·공통 컴포넌트 사용은 "같다"고 볼 만하지만, 문항 설정 열(그리고 진행 중 수정 전의 추가 모달)이 시안보다 눈에 띄게 넓고 패널 머리 아이콘이 달라, 브라우저로 보면 "거의 같은데 비율이 다르다"는 지적이 다시 나올 가능성이 높다 — UQ-762·UQ-763을 고친 뒤 브라우저로 한 번 보여 주는 것이 안전하다.

### 크기 판정의 근거 (시안 배율)
시안 그림은 2000px 폭이다. 공통 값이 이미 정해진 요소로 배율을 재면 **약 1.39배**(그림 px ÷ 1.39 ≈ CSS px)로 서로 맞는다.

| 요소 | 시안 그림 | 코드의 값 | 배율 |
|---|---|---|---|
| Resumate AI 패널 폭 (시안 3, x 1371→1950) | 579 | `PANEL_WIDTH.default` 420 | 1.38 |
| 입력 칸 높이 (시안 1·2) | 56 | `Input` `h-10` 40 | 1.40 |
| 라벨 열 "마감일" (시안 2·3, x 49→188) | 140 | `FieldRows` `6.25rem` 100 | 1.40 |
| S-14 모달 폭 (시안 1) | 836 | 진행 중 `FormDialog` 602 (S-08 C-22 틀) | 1.39 |

배율과 상관없는 비교도 같은 결론이다 — 시안 2의 "입력 칸 높이 : 문항 열 폭" = 56 : 833 = 1 : 14.9, 구현은 40 : 832 = 1 : 20.8. 시안 1 모달은 836 × 1166(세로로 긴 모양)인데 보고서 시점 구현은 832 × 832였다.

---

## A. 화면별 시안 대조표

### 시안 1 — S-13 머리 (뒤 배경)

| 요소 | 시안 | 구현 | 판정 |
|---|---|---|---|
| 위 바 | 사이드바 토글 + "자기소개서 관리" | L-01 `PageCrumbs` (`applications/page.tsx:67`) | 맞음 |
| 큰 페이지 제목 | 없음 | `h1.sr-only` (`page.tsx:68`) | 맞음 |
| 정렬 표기 | 왼쪽 "최근 작성 순 ⌄", 회색 바탕, 둥근 사각 | 회색 바탕 고정 글자, ⌄ 없음(확정 CF-9 + `[UI-가정]`), **`rounded-full` 알약** (`application-list.tsx:36`) | 다름(모서리 모양, UQ-768) / ⌄ 없음은 확정 |
| 주 버튼 | 오른쪽 "⊕ 자기소개서 작성" | `CirclePlus` + "자기소개서 작성" (`add-application-launcher.tsx:72`) | 맞음 |
| 배치 | 한 줄, 좌·우 끝 | `flex justify-between` (`page.tsx:69`) | 맞음 |
| 사이드바 "모의 면접" | 있음 | 없음 | 확정(RM-1) |
| 빈·오류 상태 | (시안 없음) | 정렬 표기가 빈 상태·오류 상태에도 보임 (`page.tsx:70`) | 다름(UQ-768) |

### 시안 1 — S-14 추가 모달 ①·② (11:41 트리, `FormDialog` 이전 진행 중)

| 요소 | 시안 | 구현 | 판정 |
|---|---|---|---|
| 모달 폭·모양 | 그림 836 × 1166(CSS 약 602 × 840, 세로로 긴 모양) | 보고서 시점 `sm:max-w-[52rem] sm:h-[min(52rem,90dvh)]`(832 정사각) → **11:39 이후 `FormDialog` 602px · `lg:h-[calc(100dvh-200px)]` 최대 840** | 진행 중(UQ-763 재확인 필요) |
| 두 단계 같은 크기 | 같음 | 고정 높이 틀 하나 | 맞음 |
| 머리 | "자기소개서 추가" + X | `FormDialogHeader title="자기소개서 추가"` + `DialogClose`(닫기 확인 가드 유지) | 맞음 |
| 단계 표시·부제 | 없음 | 없음(설명은 `sr-only`) | 맞음 (명세와 다름 → UQ-772) |
| ① 섹션 제목 | "JD 입력" | `FormSection title="JD 입력"` | 맞음 |
| ① 라벨·자리 표시 | "포지션 공고" / `https://www.jd.com` | 같음 | 맞음 (명세 "포지션 공고 URL"과 다름 → UQ-772) |
| ① 직접 입력 | "직접 입력" + 큰 칸 "포지션 공고 내용을 입력해주세요." | 같음, 남은 높이 채움 | 맞음 |
| ① 바닥 | 오른쪽 [다음] | `FormDialogSubmit` 오른쪽, 진행 중엔 버튼 안 스피너 + 글자 | 맞음 |
| 상시 보조 문구 | 없음 | 배타 안내 `sr-only`, 길이 경고·글자 수는 문제 있을 때만, U-6은 공고 칸 포커스 때만 | 맞음 (`[UI-가정]`) |
| ② 섹션·라벨 | "지원 기업 / 포지션" · "지원 기업"(기업 명) · "지원 포지션"(포지션 명) 세로 · "공고 내용" · "직접 입력" | 같음 | 맞음 |
| ② 큰 칸 글자 | "포지션 내용" | "포지션 공고 내용을 입력해주세요." | 다름(Minor, UQ-772에 포함 — 시안 글자가 자리 표시인지 모호) |
| ② 바닥 | 오른쪽 [자기소개서 작성]만 | 오른쪽 [자기소개서 작성] + **왼쪽 [이전]** | 다름(`[UI-가정]` 명세 S-14 ② "[이전]" 행이 있음 → 명세 쪽이 맞다) |

### 시안 2·3 — S-46 공통 머리

| 요소 | 시안 | 구현 | 판정 |
|---|---|---|---|
| L-02 셸 | 로고 · [저장하기] · 계정 | `PageShell` + `SaveButton` | 맞음 |
| 뒤로 + 이동 줄 | 둥근 사각 ← + "자기소개서 관리 › {기업 명} 자기소개서" (시안 2는 "› 자기소개서 상세" 하나 더) | `CrumbRow` "자기소개서 관리 › {이름}" (`cover-letter-screen.tsx:630`) | 맞음 / 세 번째 마디 생략은 확정(D절) |
| 큰 제목 | "{기업 명} 자기소개서" 굵게 | `DocTitleInput`(text-xl bold) + 오른쪽 ⋯(자기소개서 삭제) | 맞음 / ⋯는 확정(CF-A9) |
| 라벨/값 줄 | 회색 라벨 열(그림 140 ≈ CSS 100) + 컨트롤 | `FieldRows`(라벨 열 6.25rem = 100px, `text-sm text-muted-foreground`) | 맞음 |
| 마감일 컨트롤 | 연도 ⌄ · 월 ⌄ 두 셀렉트 | `Input type=date` 하나(w-[11rem]) + 비우기 X | 확정(CF-4) — 높이·테두리 같은지는 브라우저 확인 |
| 지원 직무·JD 상세 | 없음 | 작성 상태에만 두 줄 더함(dt "지원 직무"·"채용 공고") | 확정(CF-S4) |
| 구분선 | 전폭 1줄 | `Separator` | 맞음 |

### 시안 2 — S-46 문항 설정 상태

| 요소 | 시안 | 구현 | 판정 |
|---|---|---|---|
| 가운데 열 폭 | 그림 833(CSS 약 600) | `max-w-[52rem]` = 832px (`cover-letter-screen.tsx:651`) | **다름(UQ-762)** |
| 위 여백 | 구분선 → 제목 그림 약 180(CSS 약 130) | `pt-16`(64px) | 브라우저 확인 |
| 제목 + 부제 | "자기소개서 문항 추가" 굵게 + 회색 "작성하고자 하는 자기소개서 문항을 입력해주세요" | 같은 문구, `text-lg font-semibold` + `text-base text-muted-foreground` (`question-setup.tsx:97-99`) | 맞음 |
| 행 | [문항 입력(넓게)] [600 · 자] | [`QuestionTextField compact`] [`CharLimitInput` 800 · 자] (`InputGroup`) | 맞음 / 800은 확정(CF-U2) |
| 글자 수 칸 폭 | 그림 138(CSS 약 100) | `w-[8.75rem]` = 140px (`question-fields.tsx:105`) | 다름(UQ-765) |
| 문항 칸 글자 | 회색 짧은 이름("지원 동기") | 기본 3문항은 K-28 문장 값으로 채워짐(자리 표시도 K-28 문장) | 확정(K-28) |
| 행 끝 | 없음 | 작은 ⋯(기준·메모·삭제) (`question-setup.tsx:138-141`) | 다름(`[UI-가정]`, 오른쪽 끝 정렬 어긋남 UQ-767) |
| 라벨 | 없음 | 보이는 라벨 없음, `sr-only` "문항 문장"·`aria-label` "글자 수 제한" | 맞음 / 접근성 UQ-769 |
| 마지막 줄 | 왼쪽 "+ 문항 추가 3/5"(회색 고스트) · 오른쪽 [자기소개서 작성 시작], 같은 줄 | 같음(`justify-between`, ghost `text-muted-foreground`) (`question-setup.tsx:186-196`) | 맞음 |
| C-19 배지 | 없음 | 없음 | 맞음 (design-system 1085행 "주 버튼 + C-19 배지"와 다름 → UQ-772) |

### 시안 3 — S-46 작성 상태

| 요소 | 시안 | 구현 | 판정 |
|---|---|---|---|
| 3단 배치 | 탭 열 · 본문 · 손잡이 · 패널 | `TabsList`(세로) + `DocBody`(left · `ResizeHandle` · aside) — S-10·S-44와 같은 `DocBody` | 맞음 |
| 탭 문구·순서 | 자소서 · 채용 공고 · 인사이트 | 같음 | 맞음 |
| 탭 열 폭 | 그림 194(CSS 약 140) | `w-48` = 192px (`cover-letter-screen.tsx:682`) | 다름(UQ-765) |
| 선택 탭 | 회색 바탕 둥근 사각, 검은 글자, 보통 굵기 | `bg-muted text-foreground`, `rounded-control`, 공통 알약의 `font-medium` 유지 | 맞음(굵기는 브라우저 확인) |
| 탭 열 구분선 | 없음 | `border-r` 제거(넓은 화면) | 맞음 |
| 본문 머리 | "자기소개서" 굵게 + 오른쪽 ⋯ | `h2 text-xl font-bold` + ⋯("전체 복사") (`answer-tab.tsx:124-145`) + 아래 작은 요약 한 줄 | 맞음 / 요약 줄은 `[UI-가정]` |
| 문항 문장 | 작은 회색 | `text-sm text-muted-foreground`, 번호는 `sr-only` | 맞음 (명세 "번호 + 문항 문장"과 다름 → UQ-772) |
| 제목 | 굵게, "제목", 테두리 없음 | `DocTitleInput`(`text-base font-bold`), "제목" | 맞음 |
| 내용 | "내용", 테두리 없음 | `DocTextarea grow`, "내용" | 맞음 |
| 문항 사이 | 구분선 없음, 넉넉한 간격 | `space-y-10`, `Separator` 제거 | 맞음 |
| 문항 ⋯·글자 수·AI 제안 | 보이지 않음 | ⋯는 hover/포커스 때(터치는 늘), 글자 수는 쓰는 중·90%↑·초과·오류 때, "AI 제안 있음"은 작은 배지 | 맞음(hover 동작은 브라우저 확인) |
| 빈 상태 | 없음(빈 문서) | 답변이 없으면 작은 글 묶음(안내 + "AI와 초안 쓰기" + ANSWER_NOTE + G-2) (`answer-tab.tsx:149-169`) | 확정(R-CF-8·NFR-AI) — 상자 대신 작은 글로 시안 모양을 덜 해친 것은 적절 |
| "+ 문항 추가" | 없음 | 목록 아래 고스트 | 확정(CL-8) |
| 손잡이 | 본문과 패널 사이 세로 막대 | `ResizeHandle`(`h-10 w-1 rounded-full bg-border`) | 맞음(드래그는 브라우저 확인) |
| 패널 머리 | "Resumate AI"(회색) · ☰ · + · ⋯ · × | 공통 `PanelHeader`: Sparkles + "Resumate AI"(전경색) · **History(시계) 아이콘** · + · ⋯ · × | 다름(UQ-766 — 공통 컴포넌트 쪽 결정) |
| 칩 줄 | 회색 알약 칩 여러 개 | 공통 `ChipRow`(`Button variant="chip"`) | 맞음 |
| 입력창 | 흰 알약 "Resumate AI에게 물어보세요" + 오른쪽 초록 원 보내기 | 공통 `InputPill`: 같은 자리 표시 + 첨부(비활성) · n/40 · C-19 · 원형 보내기(ArrowUp) | 맞음 / 추가 요소는 명세(n/40·C-19) |

---

## B. 공통 컴포넌트

| 역할 | 공통 조각 | S-46 / S-14 / S-13 사용 | 판정 |
|---|---|---|---|
| Resumate AI 패널 | `AiPanel`(`career/ai-panel/`) | `cover-letter-panel.tsx:44` `<AiPanel panel={useCoverLetterAiPanel(…)} …>` — 자체 메시지 목록·`Textarea`·머리·기록 팝오버 **모두 삭제**(이전 256줄 → 65줄). 메시지는 공통 `Message`·`Bubble`·`MessageScroller`, 입력은 `PanelInputArea`/`InputGroup` | 해소 |
| 어댑터 | `AiPanelController` 모양 | `use-cover-letter-ai-panel.ts` — 로직 없이 모양만 맞춤, `useAiPanel` 미수정 | 적절 (상한 문구 UQ-764) |
| 제목·본문 입력 | `DocTitleInput`·`DocTextarea` | 머리 제목, 문항 제목·내용 | 해소 |
| L-02 머리·이동 줄·뒤로 | `PageShell`·`CrumbRow`·`DocHead` | 그대로 | 해소 |
| 라벨/값 줄 | `FieldRows`·`FieldRow`(doc-inputs) | 머리 마감일·지원 직무·채용 공고 | 사용 적절. 단 보고서의 "S-10 머리의 FieldRows" 설명은 사실과 다름(S-10은 `InlineFields`, design-system 615·1768행) → S-46이 첫 사용처(UQ-771) |
| 3단·손잡이 | `DocBody`·`ResizeHandle`·`usePanelPlacement` | 그대로 | 해소 |
| 탭 | `Tabs variant="pill"` | 세로 탭, 선택 색만 같은 변형 접두사로 덮음(`TAB_PILL`) | 적절(덮어쓰기는 tailwind-merge 접두사 일치 확인) |
| 모달 | `Dialog` → (11:39~) `FormDialog`(S-08 C-22 틀) | 진행 중 | 보고서 시점엔 C-22 틀을 쓰지 않았다 — 지금 고쳐지는 중(UQ-763) |
| 입력 | `Input`·`InputGroup`(접미사 "자")·`Textarea`·`Button`·`DropdownMenu`·`Badge` | 사용 | 해소 |
| 정렬 표기 | (공통 없음) | `<p>`에 `Button variant="chip"` 클래스 일부를 손으로 복사 | 토큰만 씀, 모서리 모양 UQ-768 |

**하드코딩 점검**(`git diff` 추가 줄): `#hex` 색 0건, `text-[..px]` 0건. 임의 크기는 `max-w-[52rem]`(문항 설정 열 — 기존 토큰 `max-w-prose-edit`을 임의값으로 바꿈, UQ-762), `w-[8.75rem]`(UQ-765), `sm:h-[24rem]`·`sm:max-w-[52rem]`·`sm:h-[min(52rem,90dvh)]`(S-14, 진행 중 변경으로 없어짐), `leading-[1.75]`(공통 패널과 같은 값), `w-[11rem]`(기존 값 이동).

---

## 이슈

| ID | 심각도 | 위치 (`파일:줄`) | 근거 | 기대 vs 실제 | 담당 |
|---|---|---|---|---|---|
| UQ-762 | Major | `src/components/applications/cover-letter/cover-letter-screen.tsx:651` | 시안 2 문항 열 x 583→1416(그림 833 ≈ CSS 600). 배율표(위) | 기대: 시안 비례 약 600px(예: 입력 모달과 같은 602 계열 토큰 또는 기존 `max-w-prose-edit` 검토). 실제: `max-w-[52rem]`(832px) — 입력 칸 대비 열이 약 1.4배 넓다. 브리프의 "약 830px"이 그림 px였다 | frontend-engineer(A3) · 리더(브리프 수치 정정) |
| UQ-763 | Major (진행 중) | `src/components/applications/add-application-dialog.tsx:348` (11:41 트리) | 시안 1 모달 836 × 1166 그림(세로로 긴 모양), S-08 C-22 모달 틀 | 보고서 시점: `Dialog` + `sm:max-w-[52rem] sm:h-[min(52rem,90dvh)]`(832 정사각), C-22 공통 틀 미사용. 11:39 이후 `FormDialog`(602 · 고정 높이 최대 840)로 바뀌는 중 — **이 변경은 58 보고서에 없고 S-08 `add-career-dialog.tsx`도 함께 바뀌었다** → 끝난 뒤 S-14·S-08 둘 다 다시 검수 | frontend-engineer · 리더 |
| UQ-764 | Major | `src/components/applications/cover-letter/use-cover-letter-ai-panel.ts:76` · `src/components/career/ai-panel/panel-input.tsx:44` | 02 S-46 패널 "메시지 상한 40 … S-10·S-44 패널과 같다"; 공통 문구 `PANEL_COPY.messageLimit`("이 대화가 길어졌어요 …") | 서류 대화는 39에서 막는데(`messageLimitReached = count >= 40 - 1`) 공통 상자는 `message_count >= 40`일 때만 상한 문구를 고른다 → 39에서 **"이 대화는 끝났어요"(끝난 대화 문구)**와 "39/40"이 함께 보인다. 이전 구현의 S-46 문구 "메시지 한도에 닿았어요"는 이제 어디에도 쓰이지 않는다. 기대: 상한에 닿은 대화는 상한 문구 | frontend-engineer |
| UQ-765 | Minor | `cover-letter-screen.tsx:682` (`w-48`) · `question-fields.tsx:105` (`w-[8.75rem]`) | 시안 3 탭 열 그림 194(≈140), 시안 2 글자 수 칸 그림 138(≈100) | 기대 약 140px·100px, 실제 192px·140px (UQ-762와 같은 원인) | frontend-engineer |
| UQ-766 | Minor | `src/components/career/ai-panel/ai-panel.tsx:178-185` | 시안 3 패널 머리 "Resumate AI"(회색, 아이콘 없음) + ☰ | 공통 머리는 Sparkles + 전경색 제목 + History(시계) 아이콘. S-10·S-44와 같은 공통 컴포넌트라 S-46만 바꾸면 안 된다 — 세 화면 공통으로 시안을 따를지 결정 필요 | ui-designer |
| UQ-767 | Minor | `src/components/applications/cover-letter/question-setup.tsx:138-141` | 시안 2 행 = [문항][글자 수]만, 오른쪽 끝이 [자기소개서 작성 시작] 오른쪽 끝과 일치 | 행 끝 ⋯(32px + 간격)가 붙어 글자 수 칸의 오른쪽 끝이 주 버튼보다 안쪽으로 들어간다(`[UI-가정]` 자체는 브리프 허용). 기대: 칸 끝 정렬을 맞추거나 ⋯를 칸 밖 여백에 | frontend-engineer |
| UQ-768 | Minor | `src/components/applications/application-list.tsx:36` · `src/app/(dashboard)/(gated)/applications/page.tsx:70` | 시안 1 정렬 칩은 작은 모서리의 둥근 사각; 02 S-13 머리 | `rounded-full` 알약. 또 정렬 표기가 빈 상태·오류·권한 없음 화면에도 보인다(정렬할 행이 없음) | frontend-engineer |
| UQ-769 | Minor | `question-fields.tsx:49-51, 114` · `question-setup.tsx:110` | 접근성(라벨), 이전 구현은 보이는 "문항 n" | 행마다 라벨이 똑같이 "문항 문장"·"글자 수 제한"이라 낭독기에서 몇 번째 문항인지 구분되지 않는다(`sr-only` "문항 n" span은 칸과 연결 안 됨). 기대: "문항 n 문장"·"문항 n 글자 수 제한" | frontend-engineer |
| UQ-770 | Minor | `use-cover-letter-ai-panel.ts:104-106` · `cover-letter-panel.tsx:61-64` | 02 S-46 "초안 남은 횟수 … 0이면 고정 칩 3개(OD-P6) + [새 대화]", 패널 행 "상한에 닿으면 … + [새 대화]" | 서류 대화 칩은 전부 초안 칩이라 상한에 닿으면 칩 줄이 통째로 사라진다(이전: 비활성 표시). [새 대화] 버튼은 없고 머리 + 아이콘뿐(이전에도 없음). 명세 문구 해석 확인 필요 | 기획 확인 → frontend-engineer |
| UQ-771 | Minor | `_workspace/ui/58_frontend-engineer_mockup-rework_report.md` 1절 · `docs/ui/design-system.md:615, 1768` | design-system "S-10은 `InlineFields`만, `FieldRows`는 쓰지 않는다" | 보고서가 `FieldRows`를 "S-10 머리의 dl 2열"이라 적었다(사실과 다름). 사용 자체는 공통 컴포넌트라 문제 없음 — design-system에 "S-46 머리 = `FieldRows`" 반영 필요 | ui-designer |
| UQ-772 | Minor | (문서) `02-user-flows.md` S-14 ①·② 표, S-46 문항 설정 "안내 1줄"·자소서 탭 "문항 목록"·"복사"·머리 "요약 한 줄"; `design-system.md` 5.6.2·5.12·1085행 | 시안 우선(브리프)으로 구현이 명세와 달라진 곳 | 머리 "자기소개서 작성"+단계 표시 → "자기소개서 추가"·없음 / 라벨 "포지션 공고 URL" → "포지션 공고" / 자리 표시 "공고 내용을 붙여넣어 주세요" → "포지션 공고 내용을 입력해주세요." / ① 키 없음 C-18 줄·[다음] 옆 C-19 배지 → ②에서만·없음 / 문항 설정 안내 1줄 → 시안 부제 / 작성 상태 문항 번호 숨김 / 제목 자리 표시 "답변 제목" → "제목" / 요약 한 줄 머리 → 탭 머리 / "전체 복사" 머리 → ⋯ 메뉴 / [자기소개서 작성 시작] 옆 C-19 배지 없음. **어느 쪽이 맞는지 정하지 않았다** — 시안을 확정으로 문서를 맞출지 결정 필요 | 기획 · ui-designer |

---

## C. 회귀 판정

| 항목 | 확인 방법 | 판정 |
|---|---|---|
| `AiPanel` `copy`·`lockEntry` 기본값 | `ai-panel.tsx` — `lockCopy = copy?.lock ?? PANEL_COPY.lock[panel.target]`, `notice = copy?.notice ?? PANEL_NOTICE[panel.target]`, `lockEntry = "writing_chat"`; `PanelInputArea`의 `lockCopy`·`lockEntry` 기본도 같은 값, `BlockNotice` `key_invalid`·`ai_not_connected`도 같은 기본값. S-10(`project-page.tsx:715`)·S-44(`deliverable-page.tsx:502`)·dev 데모는 두 속성을 넘기지 않는다 | **S-10·S-44 동작 불변** |
| S-10 렌더 | `curl /career/projects/…4e03…0001?state=default`·`?state=no-key` → 200, "Element type is invalid" 0, 입력 자리 표시 있음 | 이상 없음 (S-44 미리 보기 주소는 픽스처 id를 찾지 못해 렌더 확인 못 함 — 코드 기준 판정) |
| `src/lib/mock/store.ts` 백필 | `getMockDb()` 안, `NODE_ENV === "production"`이면 그 전에 던진다. 없는 최상위 표만 새 픽스처에서 채움(저장소 객체당 1회, `WeakSet`) | mock 전용, 운영 무관. 파운데이션 승인 필요(보고서 요청대로) |
| CF-S1~S9 · 슬롯 키 · 정본 읽기 | `question-form.ts`·`save-version.ts`·cover-letter `page.tsx` 미변경. `cover-letter-screen.tsx` diff는 머리 JSX·문항 설정 열·탭 클래스·패널 prop뿐(`runSave`·`StaleWriteDialog reloadOnly`·`onStart` 그대로). 문항 목록 `key={f.question_id}` 유지 | 끊긴 곳 없음 |
| CF-S8 턴 전 저장 | `use-cover-letter-panel.ts`는 `consentDialog` 노출만 추가. 어댑터 `send`는 입력창을 `onSent`에서만 비움, `preparing` → 공통 `starting`(입력 비활성 + 도는 표시), 이중 전송은 `cl.send`의 `preparingRef`·`phase` 가드가 막음 | 유지 |
| 초안 턴 실패·제안 카드 | `hideDraftTurnFailure={() => panel.draftFailed}`, 3.26 카드는 `cl` 직접 읽음(drafting 진행 문구 포함) | 유지 |
| C-21 동의 창 | 이전엔 `consent.dialog`를 아무 데도 그리지 않았다 → 공통 패널이 `panel.consentDialog`로 그림(화면에 중복 렌더 없음) | 개선 |
| 키 잠금 | 이전: 잠기면 늘 영역형. 지금: 대화가 없을 때만 영역형, 있으면 기록 열람 + 입력 자리 인라인 C-18 | 명세 "S-10과 같다"에 맞음 |
| 메시지 상한 | 39에서 공통 끝난 대화 상자 | **문구 회귀(UQ-764)** |

---

## D. 확정과 다르게 둔 자리

| 자리 | 문서 | 구현 | 판정 |
|---|---|---|---|
| 글자 수 기본 800 | CF-U2 (02 S-46 문항 설정 표 "기본값 800 … 시안의 600은 쓰지 않는다") | `newQuestionForm` `COVER_LETTER_DEFAULT_CHAR_LIMIT` | 맞음 |
| 마감일 일 단위 | CF-4 (02 S-46 머리 "시안의 연도/월 선택은 자리표시자") | `Input type=date` 하나 + 비우기 | 맞음 |
| 정렬 고정 표기 | CF-9·CF-A8 (02 S-13 머리 "바꿀 수 없는 표기, 정렬 선택 없음") | 버튼·⌄ 없는 글자 | 맞음 |
| 지원 직무·JD 상세 | 02 S-46 머리 표(작성 상태만, dt "채용 공고" CF-S4) | 작성 상태에만 `FieldRow` 두 줄 | 맞음 |
| "모의 면접" 메뉴 없음 | RM-1 (02 UX-1) | 손대지 않음 | 맞음 |
| 이동 줄 세 번째 마디 생략 | 02 1.3a 이동 줄 행(228행) "S-46 '자기소개서 관리 › {자기소개서 이름}'(두 상태 공통, 시안의 세 번째 마디 '자기소개서 상세'는 쓰지 않는다)" + S-46 레이아웃(1649행) "자리표시자로 보고 쓰지 않는다(CF-A11)" | "자기소개서 관리 › {이름}" | **담당 판단이 문서와 맞다.** 브리프의 "S-10·S-44 규칙을 따르라"보다 명세가 명시적으로 우선한다 |

---

## 검증 결과

| 검사 | 결과 |
|---|---|
| `pnpm lint` | 통과(11:34, 11:41 재실행 통과) |
| `pnpm typecheck` | 통과(11:34, 11:41 재실행 통과) |
| `pnpm test` | 158파일 2,550건 통과(11:34, 11:41 재실행 통과) |
| `pnpm build` | 통과(11:35, 11:41 재실행 통과) |
| dev 서버 :3000 (이 워크트리, 끄지 않음) `curl` | 아래 모두 200 · "Element type is invalid" 0 · `BAILOUT_TO_CLIENT` 0 |

| 주소 | 상태 | SSR에서 확인한 글자 |
|---|---|---|
| `/applications?state=empty` | 200 | "최근 작성 순" |
| `/applications?new=1&state=step1` | 200 (11:41 재확인 200) | 모달은 Portal이라 SSR HTML에 없음 — 모달 문구는 코드로 대조 |
| `/applications?new=1&state=step2` | 200 (11:41 재확인 200) | 같음 |
| `/applications/…0003/cover-letter?state=questions` | 200 | "자기소개서 문항 추가"·부제·"자기소개서 작성 시작" |
| `/applications/…0001/cover-letter?state=writing` | 200 | "자소서"·"지원 직무"·"JD 상세"·"대화 기록"·"Resumate AI에게 물어보세요"·"제목"·"내용"·`aria-label="대화 메시지"`(공통 스크롤러) |
| `…0001/cover-letter?state=draft-stream` | 200 | 같음 |
| `…0001/cover-letter?state=save-conflict` | 200 | 같음 |
| `/board?state=default` | 200 | — |
| `/career/projects/…4e03…0001?state=default` (S-10 회귀) | 200 | 공통 패널 입력 자리 표시 |

SSR HTML 읽기는 브라우저 확인이 아니다 — Q12(브라우저 패스)는 **미확인**.

## 브라우저 확인 필요 목록
1. 문항 설정 열·탭 열·글자 수 칸·S-14 모달(`FormDialog` 반영 뒤)의 실제 폭이 시안 비례와 맞는지(1440px 창 기준 열 약 600px, 탭 약 140px).
2. 문항 설정 위 여백(`pt-16`)과 시안의 구분선 → 제목 간격(약 130px).
3. 마감일 `Input type=date`가 시안 셀렉트와 같은 높이·테두리로 보이는지(브라우저마다 date 칸 모양이 다르다).
4. 작성 상태 문항 ⋯의 hover/포커스 노출(`[@media(hover:hover)]:opacity-0` 과 `group-hover/question:opacity-100`의 CSS 순서), 터치 기기 상시 노출.
5. `ResizeHandle` 드래그·키보드 조절, 패널 닫기 → 상단 바 [Resumate AI]로 다시 열기, 좁은 화면 시트("본문 보기").
6. 세로 탭 선택 색(회색)·굵기, 좁은 화면(<1024) 가로 탭 전환.
7. C-18 "직접 입력" → `[aria-label="문항 1 내용"]` 포커스가 실제로 `DocTextarea`에 들어가는지(첫 문항이 접혀 있으면 아무 일도 없음).
8. S-14: 두 단계 높이 동일, 공고 칸이 남은 높이를 채움, U-6 안내가 공고 칸 포커스 때만 보임(`sr-only` ↔ `not-sr-only`), 닫기 확인.
9. 좁은 화면(375px) 문항 설정 행: [문항][140px 글자 수][⋯]가 한 줄에서 문항 칸이 너무 좁지 않은지.
10. 패널 스트리밍·초안 턴 중 자동 스크롤(초안 턴 시작은 공통 `FollowOnSend`가 따라가지 않는다 — `starting`/`streaming`만).
11. 실제 백엔드 연결 상태에서 로컬 테스트 계정으로 S-14 → S-46 문항 설정 → 작성 → 패널 턴 한 번(이번 런은 못 함).

## 요청
- 리더: UQ-762 수치 정정(시안 그림 ÷ 약 1.39), 진행 중인 `FormDialog` 변경(S-14·S-08)이 끝나면 재검수 요청, UQ-770·UQ-772 기획 판단.
- frontend-engineer: UQ-762·UQ-764·UQ-765·UQ-767·UQ-768·UQ-769.
- ui-designer: UQ-766(공통 패널 머리 아이콘을 시안에 맞출지 — S-10·S-44 함께), UQ-771·UQ-772(design-system 5.6.2·5.12·615행 갱신).
- 파운데이션: `src/lib/mock/store.ts` 백필 유지 여부.
