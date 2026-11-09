# UI QA — 자기소개서 관리 흐름 재설계 (45 런, 라운드 2 재검)

- 날짜: 2026-11-09 · 담당: ui-qa · 워크트리 `cover-letter-ui-469976` · HEAD `c7afdfe`(작업 트리 깨끗함)
- 기준: 라운드 1(`50_…review.md`) · 브리프 45(연결 대기 4건·읽기 실패 규칙·CF-S7 확정) · 기획 PR #68 `origin/claude/focused-mclaren-1a7881`(`eebed7d`, CF-S1~CF-S7, decisions 3.28 후속·4.23 UI #9~#12, 02 S-14·S-25·S-46, `docs/legal/*` 2026-11-09판)
- 대상 커밋: `5c7ed23..c7afdfe`(f56775e QA 1 수정 · 76f5682 리더 S-46 다이얼로그 문구 · 73dd3d0 백엔드 병합 · c7afdfe 읽기 연결)
- 보고서 51·52의 주장은 코드·문서 원문으로 다시 판정했다. 새 이슈 번호는 UQ-756부터.

## 요약

- 라운드 1 이슈: **UQ-740~755 16건 전부 해소**(재발 0).
- 새 이슈: **Critical 0 / Major 1 / Minor 4 / 기획 확인 1**
  - **UQ-756 (Major)** — 입력 보존 복원(localStorage)으로 되살린 문항의 슬롯을 발급기가 모른다 → "+ 문항 추가"가 **같은 슬롯을 다시 발급** → 저장이 `invalid_slot`으로 막힌다(UQ-740 수정의 남은 구멍).
- 덮어쓰기 방지 조건 3가지: **세 조건 모두 지켜진다**(깨지는 경로 0). 단 서버 쪽 CF-S7은 아직 없다(남은 연결 대기 — 그전에는 서버가 마지막 방어선이 아니다).
- 파괴 마이그레이션 전 확인: **실제 경로에서 옛 `drafts`·`draft_sections`·`draft_section_sources` 참조 0건**, `004700`이 drop하는 함수 43개 호출 0건. JD 추출 함수 보존.
- 되살리면 안 되는 것: **0건**(라운드 1과 같음).
- CF-S6 법무 본문: 바뀐 4곳이 PR #68 2026-11-09판과 **글자 그대로 같다**. 본문 "경력기술서" 0건(주석 2곳만).
- 기계 검사: lint 0 · typecheck 0 · test **154파일 2,473건** · build 0 (리더 수치와 같다).
- 브라우저: **미확인** — Claude in Chrome 미연결(`tabs_context_mcp` → not connected).
- screen-status 최종 상태: **`QA 진행 중 — Major 1 (UQ-756) 수정 뒤 재확인`**. UQ-756이 고쳐지면 `QA 통과 (mock·브라우저 미확인)`.

## 1. 라운드 1 이슈 해소 판정

| ID | 판정 | 근거 (코드·문서) |
|---|---|---|
| UQ-740 Critical | **해결** (남은 구멍 1 → 새 이슈 UQ-756·757) | `grep 'q_\${'` 결과 UI 쪽은 `question-form.ts:44`(`seedQuestionForms` 기본 3문항 — 정상), `:87`(`nextSlot`), `:105`(최고 번호) 3곳뿐. 저장 경로 `toCoverLetterBody`(`question-form.ts:159-176`)는 `slot: f.slot` 그대로·`sort_order`만 매김. mock 저장(`cover-letters.ts:258-281`)도 재번호 없음 + `invalid_slot` 거부 + "보내지 않은 슬롯 근거만 삭제". 실제 분기 `toDocumentBody`(`:381-390`)도 `slot` 유지. `cover-letter-screen.tsx:723`의 `nextSlot`은 `?state=questions-max` 미리 보기 전용. 픽스처 `fixtures.ts:971`·AI 픽스처는 테스트 데이터. **테스트가 불변식을 실제로 단정한다**: 순서 바꾸기 → `[slot, question_id]` 쌍 불변(`question-form.test.ts:126-134`), 삭제 후 추가 → q_4·q_5(`:102-113`), 저장 왕복 → slot·question_id·순서 불변(`:136-147`), mock 저장으로 "1번 삭제 → q_2·q_3 유지, q_1 근거만 삭제·q_2 근거 제자리"(`cover-letters.slot.test.ts:41-61`), 순서 바꿔 저장 → 근거 행 불변(`:64-76`). 다만 테스트는 순수 함수·mock 저장 수준이라 **화면이 발급기에 무엇을 넣는지**는 묶지 않는다 — 그 자리에서 UQ-756·757이 나왔다 |
| UQ-741 Major (백엔드) | **처리됨 — CF-S7 확정** | decisions 3.28 CF-S7 · 4.23 UI #12 · 02 S-46 1757행. UI 쪽 할 일(“내 내용으로 저장” = `current_updated_at` 재전송, 문항 설정 상태도 같은 다이얼로그)은 코드와 맞다(3절 ③). 서버 RPC 변경은 `20261113004690` 예정(남은 연결 대기) |
| UQ-742 Major | **해결** | `board-add-button.tsx:16-29`가 보드 위에서 `<AddApplicationDialog fromBoard />`를 띄운다. `kanban-board.tsx:314-318`(좁은 화면)·`:391-394`(열 머리 "+")·`board/page.tsx:109-113`(빈 상태) 모두 교체. 생성 뒤 `add-application-dialog.tsx:306-320`: 토스트 "열기"(`setNavOrigin("board")` → S-46) + `router.refresh()`로 보드에 남음. 주 버튼 "추가하기"(`:332`). S-14 명세 "이탈 … 닫기(×)·Esc → 출발 화면 그대로" · "보드에서 왔을 때: 생성 뒤 S-39 … '열기' 토스트 · 주 버튼 '추가하기'"(02 S-14 4·27·45행)와 일치. 옛 주소 `?new=1&from=board`는 닫을 때 보드로 `replace`(`add-application-launcher.tsx:51-57`, `[UI-가정]` 31) |
| UQ-743 (기록) | **해소** | 읽기 연결로 `notWired` 제거(`cover-letters.ts:186-196`). 실제 경로에서 S-46이 행 유무로 두 상태를 연다 |
| UQ-744 | **해결** | `applications/page.tsx:57` = 02 S-13 1490행 원문과 같다 |
| UQ-745 | **해결** | `add-application-dialog.tsx:337` `sm:max-h-[85dvh]` + `max-sm:h-dvh max-sm:max-h-dvh` |
| UQ-746 | **해결** | 보고서 51 5절대로 단계 전환 포커스(코드 확인, 브라우저 미확인) |
| UQ-747 | **해결** | `question-proposal-card.tsx:155-162`(해시 비교, `computeBodyHash`) · `:364-365` 명세 문구 그대로. `base_body_hash`는 턴 직전 `form_snapshot`으로 계산(`use-cover-letter-panel.ts` runTurn), 실제 경로는 턴 뒤 DTO로 다시 맞춘다 |
| UQ-748 | **해결** | `cover-letter-chat-types.ts:167` "다음 문항도 이어서 써 볼까요?" · `cover-letter-panel.tsx:162`(초안 상한이면 숨김) |
| UQ-749 | **해결** | `answer-tab.tsx:178` → `cover-letter-screen.tsx:562-567`(좁은 화면 시트 / 넓은 화면 패널) → `revealSlot` → 카드 `question-proposal-card.tsx:88-100` 펼침·스크롤 |
| UQ-750 | **해결** | `page-shell.tsx:256-329` `noShortcut` — ⌘S 처리·`aria-keyshortcuts`·툴팁 함께 끔, 기본 false(S-10·S-44 불변). S-46은 문항 설정 상태에서만(`cover-letter-screen.tsx:585`) |
| UQ-751 | **해결** | `form-draft.ts:26-31` `previewRefusalAction` — `ai_not_connected`·`key_missing` → 막지 않고 ②로. `add-application-dialog.tsx:221-238` |
| UQ-752 (백엔드) | **해결** | `evidence-links.ts:23-33` `["insight","chat_message"]` — `draft_section` 제거, `application_document`는 AI 경로 쓰기 금지라 의도적으로 없음(주석 근거 타당: 서류 근거는 저장 RPC만 쓴다, CF-S1) |
| UQ-753 (기획) | **해결** | PR #68 02 S-46 1674행 취소선 + "(CF-S3·S5) 문항 설정 상태에서는 비활성" · DM 667행 옛 문장 취소선 |
| UQ-754 (기획) | **해결 — CF-S6** | 4절 |
| UQ-755 (기획) | **해결** | `deletion-summary.tsx:30` `["자소서", a.drafts]` = 02 S-25 1897행 "자소서 N((v5.20, R-CF-12) …, 반환 키는 그대로)" |

리더 직접 수정 확인: `76f5682` `cover-letter-screen.tsx:680` `entity="cover_letter"` — 다이얼로그 문구 "이 자기소개서가". `policy-content.ts` 4곳·`deletion-summary.tsx` 라벨 — 위와 4절.

## 2. 새 이슈

| ID | 심각도 | 담당 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|---|---|---|---|---|---|---|
| **UQ-756** | **Major** | A3 | DM v4.15 2.5.1 "슬롯 키 `slot` (확정)" — 안정 키, 한 번 쓰면 재사용 안 함 · 02 L-02 1.3a 입력 보존(232행) | `cover-letter-screen.tsx:178-197`(복원: `setForms(copy.forms)` `:191`) ↔ 발급기 `:119-128`·`:134-138`(정본 슬롯 + 열린 대화 + 첫 폼만 `markUsed`) | 되살린 폼의 슬롯도 "쓴 번호"로 친다(`slots.markUsed(copy.forms.map(f => f.slot))`) | 재현(코드 추적): 정본 q_1~q_3 → "+ 문항 추가"(q_4, 저장 안 함) → 탭 닫기/새로 고침(입력 보존이 q_4를 localStorage에 남김, `base_updated_at` 일치) → 다시 열면 q_4가 복원되지만 발급기는 q_1~q_3만 앎 → "+ 문항 추가"가 **q_4를 또 발급** → 폼에 q_4 두 개. 저장은 RPC·mock 모두 중복 슬롯을 `invalid_slot`으로 거부 → 화면은 `[UI-가정]` 33대로 "저장 실패"만 보인다(원인 안내 없음, 사용자가 문항을 지우기 전에는 계속 실패). 문항 설정 상태에서도 같다([자기소개서 작성 시작]이 실패). 그 사이 [반영]은 `onFill`의 `fills.find(x => x.slot === f.slot)`(`:396`)로 **두 문항에 같은 답을 채운다**. 정본이 틀어지지는 않지만(서버가 거부) 사용자가 막힌다. 테스트 없음 |
| UQ-757 | Minor | A3 | DM 2.5.1(같음) · 보고서 51 1.3 "대화 제안이 가리키는 슬롯도 쓴 번호로 친다" | `use-cover-letter-panel.ts:443-465`(기록에서 대화 열기 → `adoptChat`) · `:378-379`(턴 뒤 다시 읽기) ↔ 발급기는 첫 렌더의 `data.open_chat`만 받는다(`cover-letter-screen.tsx:123`) | 이번 방문에 연 대화의 제안 슬롯도 발급기에 넣는다 | 기록 목록에서 연 다른 대화에 지워진 문항(q_4)의 제안이 남아 있으면 "+ 문항 추가"가 q_4를 다시 발급하고, 그 옛 제안이 새 문항의 "AI 제안 있음"·[반영]·`applied_proposals`에 붙는다. 보고서 51 1.4의 "방문을 건너는" 한계와 달리 **같은 방문 안**에서 화면이 막을 수 있는 경우다 |
| UQ-758 | Minor | A3 | 02 S-46 `?chat=` · DM 7장 25행(서류별 대화) | `cover-letter/page.tsx:65` · `cover-letter-chats.ts:69-82`(`target === "application_document"`만 검사) | 연 대화의 `application_project_id`가 이 페이지 id와 다르면 열지 않는다(null) | `/applications/A/cover-letter?chat={B의 대화}`이면 B 대화가 A 화면 패널에 열린다 — 제안 슬롯이 A 발급기에 들어가고, [반영]이 B의 제안을 A 문항에 채우며, 이어지는 턴이 A의 `form_snapshot`으로 B 대화에 기록된다. 서버가 `applied_proposals`를 건너뛰는지는 백엔드 판정이지만 화면이 막는 것이 맞다. 주소를 손으로 고치거나 옛 링크일 때만 생긴다 |
| UQ-759 | Minor | 백엔드 (A3 협의) | 02 S-14 27행 "생성이 **`invalid_source_url`(400)**로 거부되면 … '주소 없이 만들기'" | `src/server/db/errors.ts:242`(`invalid_source_url: "invalid_input"` 별칭) · `src/lib/contracts/application.ts:78-81`(`sourceUrl` zod `regex(/^https?:\/\//)` 대소문자 구분 → `invalid()` = `invalid_input`) ↔ 화면 `add-application-dialog.tsx:159`(`/^https?:\/\/\S+$/i` 대소문자 무시) · `actions.ts:61`(`e.code === "invalid_source_url"`) | 실제 경로에서도 생성 거부가 `invalid_source_url` 코드로 온다 | 실제 경로에서는 그 코드가 **화면까지 오지 않는다**(zod → `invalid_input`, RPC raise → 별칭 `invalid_input`, 서비스의 길이 검사 `write.ts:56-58`은 zod가 먼저 막아 닿지 않음). 그래서 A3의 "값으로 돌려주기" 수정은 mock에서만 동작한다. 닿는 예: `HTTPS://…`(화면 통과, zod 거부) → "주소 없이 만들기" 대신 일반 생성 실패. 별칭을 빼거나 zod 실패를 `invalid_source_url`로 내면 된다 |
| UQ-760 | Minor | A3 | 02 S-46 패널 "대화 기록 목록" | `use-cover-letter-panel.ts:376-380` — `!ac.signal.aborted` 검사가 `await getCoverLetterChatAction` **앞**에만 있다 | 턴 뒤 다시 읽기가 끝났을 때 지금 연 대화가 같은지 확인하고 맞춘다 | 턴이 끝나고 다시 읽기가 진행 중일 때 기록에서 다른 대화를 열면(`:446` abort, `:460` adoptChat), 늦게 도착한 옛 대화 DTO가 `adoptChat`으로 패널을 **옛 대화로 되돌린다**(주소의 `?chat=`은 새 대화). 짧은 창이지만 [반영] 대상이 섞일 수 있다 |

### 기획 확인 필요

| ID | 내용 | 양쪽 인용 | 화면 영향 |
|---|---|---|---|
| UQ-761 | **CF-S7 충돌 다이얼로그에서 문항 설정 상태 탭이 "내 내용으로 저장"을 고르면, 다른 탭 정본의 근거 행이 이 탭의 기본 문항에 붙는다** | ① CF-S7(decisions 3.28·4.23 UI #12, 02 S-46 1757행): "문항 설정 상태에서 연 탭이 [자기소개서 작성 시작]을 눌렀는데 … 같은 다이얼로그가 뜬다" — 덮어쓰기를 허용 ② CF-S1·백엔드 #14: "적용된 제안이 없는 슬롯은 기존 행 유지, 보내지 않은 슬롯은 삭제" ③ 문항 설정 상태 탭의 슬롯은 기본 q_1~q_3(`question-form.ts:44`) — 다른 탭 정본도 q_1~q_3으로 시작한다 | 다른 탭이 q_1~q_3에 초안을 반영해 근거(`q_n.sources.*`)를 만든 뒤, 이 탭이 빈 기본 문항으로 덮으면 q_1~q_3 근거 행이 **남아** 빈 답변 아래 C-11에 다른 내용의 근거가 보인다(q_4·q_5 근거는 삭제). 정할 것: 이 경우 근거도 비울지(예: 문항 설정 상태에서 온 덮어쓰기는 근거 전체 삭제), 아니면 다이얼로그에서 "새로 불러오기"만 권할지. 코드 결함이 아니라 두 규칙이 만나는 자리라 기획 판단 |

## 3. 덮어쓰기 방지 조건 3가지

**① 읽기 `{error}`를 null로 접지 않는다 — 지켜짐.**
- `getCoverLetterDocument` 실제 분기 = `unwrap(await getApplicationDocumentAction(...))`(`cover-letters.ts:194`). `unwrap`은 `{error}`를 `AppError`로 던진다(`source.ts:37-42`). 서버 액션 `getApplicationDocument`(`server/actions/application-document.ts:63-70`)는 zod 실패 → `invalid`, 그 밖 → `runAction`(오류는 `{error}`). 서비스 `read.ts:39-46`은 `.maybeSingle()` — 오류는 `mapDbError`로 던지고, **`null`은 행이 없을 때만**(`:46`).
- 호출자는 `cover-letter/page.tsx:57` 하나(`Promise.all`, try/catch·`.catch` 없음 → 오류 화면). `getCoverLetterDocumentAction`(`actions.ts:175`)은 정의만 있고 화면에서 부르지 않는다(grep). `:65`의 `.catch(() => null)`은 대화 열기뿐이라 정본 판정과 무관 — 허용(단 UQ-758). 소스 가드 테스트(`cover-letters.read.test.ts`)도 있다.
- `?state=questions*`가 정본 행을 무시하는 분기(`page.tsx:59`)는 미리 보기 전용: `getPreviewState`는 프로덕션 빌드에서 늘 null(`preview-state.ts` 머리 주석), `previewOr`는 개발에서도 비밀 헤더가 있어야 mock(`source.ts:24-33`) → 실제 정본에 닿지 않는다.

**② 읽은 `updated_at`을 기대 버전으로 — 지켜짐.**
- `updatedAt` 초기값 = `data.document?.updated_at ?? null`(`cover-letter-screen.tsx:144`), 저장 성공 때 응답 `updatedAt`으로 갱신(`:312`). 기대 버전은 `expectedVersion()`(`save-version.ts:13-23`)이 고르고 `runSave`가 쓴다(`:265`). null은 `rowUpdatedAt`이 null일 때만 = 행이 없을 때.
- 다른 길 확인: 복사 기록은 `updated_at`을 올리지 않는다(`server/actions/application-document.ts` 주석·RPC). 입력 보존 복원은 `base_updated_at`이 정본과 다르면 버린다(`:186-189`). 이탈 확인의 "저장하고 나가기"는 같은 `runSave`(`:354`). 실제 분기는 `expected_updated_at ?? undefined`로 보낸다(`cover-letters.ts:355`) — null과 같은 뜻.

**③ CF-S7 — 지켜짐(화면 쪽).**
- `stale_write`는 상태와 관계없이 같은 `StaleWriteDialog`(`:278-283` → `:678-689`). 이제 Server Action 경계에서 `code`·`details`가 살아 있다(`saveCoverLetterDocumentAction` = `runAction`, `actions.ts:184-186`; `unwrap`이 `details`를 넣어 다시 던지고 `runAction`이 `toErrorBody`로 실어 보냄; `mapDbError`가 `stale_write` detail → `{current_updated_at}`, `errors.ts` `raiseDetails`).
- "내 내용으로 저장" = `runSave({ overwrite: true, createRow: state === "questions" })`(`:686`) → `expectedVersion`이 `staleVersion`(= `details.current_updated_at`, `:279-280`)을 보낸다. 문항 설정 상태에서도 null이 아니다. `current_updated_at`이 없으면 아는 버전(행 없음이면 null)으로 — 이때 CF-S7 서버는 다시 `stale_write`를 줄 뿐 덮지 않는다.
- "다시 읽어 작성 상태로 열기"를 만들지 않았다 — CF-S7 확정(같은 다이얼로그)과 맞다. "새로 불러오기"는 `guard.reloadDiscarding` → 다시 열면 행이 있어 작성 상태.
- **남은 것(결함 아님)**: 서버의 "행 있음 + null → `stale_write`"는 `20261113004690` 예정. 그전까지는 두 탭이 모두 문항 설정 상태로 열린 경우 뒤 탭의 첫 저장이 서버에서 그대로 덮인다. mock(`cover-letters.ts:274`)도 아직 `doc && input.expected_updated_at && …`라 CF-S7을 흉내 내지 않는다 — 백엔드 커밋과 함께 맞출 것(5절).

## 4. QA 밖 A3 수정 2건 · 보드 모달 · CF-S6

- **계약 `.strict()` — `sort_order` 빼고 보냄: 맞게 고쳐짐.** `toDocumentBody`(`cover-letters.ts:381-390`)가 `sort_order` 순으로 정렬한 뒤 키를 빼고, `slot`은 그대로. 실제 분기가 이것만 보낸다(`:353`). 테스트(`cover-letters.slot.test.ts:109-123`)가 `SaveApplicationDocumentInput.safeParse` 통과를 단정.
- **Server Action 경계 `code`·`details` 보존: 저장은 맞게 고쳐짐, 생성은 실제 경로에서 효과 없음.** 저장 — 위 3절 ③. 대화 열기도 `getCoverLetterChatAction`이 `runAction`(`actions.ts:209-215`). 생성 — `createApplicationAction`이 `invalid_source_url`을 값으로 돌려주지만(`actions.ts:56-63`) 실제 경로에서는 그 코드가 오지 않는다 → **UQ-759**.
- **보드 "+" → 보드 위 모달: S-14와 맞다**(1절 UQ-742). 닫으면 보드 그대로, 생성 뒤 보드에 남아 `router.refresh()` + "열기" 토스트.
- **CF-S6: 글자 그대로 같다.** `git diff main origin/claude/focused-mclaren-1a7881 -- docs/legal`의 본문 변경 4곳과 `policy-content.ts` 대조:
  - 약관 제2조 5호 "…만든 인사이트, 자기소개서 초안, 대화 응답 등" = `:88` ✅
  - 약관 제5조 2호 "지원 프로젝트(채용 공고)별 요건 정리, 인사이트, 자기소개서 초안 작성" = `:112` ✅
  - 처리방침 1번 표 "…공고 원문(JD)과 요건, 인사이트, 자기소개서 초안, 자기소개서 메모, 전형 단계 이력" = `:211`(원문 "채용 공고 원문(JD)"과 앱의 "공고 원문(JD)" 차이는 이번 개정 전부터 있던 것, 이번 변경분은 같다) ✅
  - AI 데이터 처리 1번 첫 문단 = `:412` 전문 일치(원문의 굵게 표시만 없음) ✅
  - 시행일·공고일·부칙 날짜는 앱 본문에 없고 `policy_versions`(`20261113004680…sql:23-25`, 2026-11-09 행 3개)에서 온다 ✅. 본문 "경력기술서" 0건 — `:31`·`:399` 주석(변경 기록)만.

## 5. 남은 연결 대기 (결함으로 올리지 않음)

| # | 내용 | 화면 쪽 준비 |
|---|---|---|
| 1 | **CF-S7 RPC 변경**(`20261113004690`) — 행 있음 + 기대 버전 null → `stale_write` | 화면은 이미 맞춰져 있다(3절 ③). 들어올 때 **mock `saveCoverLetterDocument`의 `stale_write` 조건(`cover-letters.ts:274`)도 "행 있음 + null"을 거부하도록** 함께 맞출 것(A3) |
| 2 | **`slot_high_water`** | `createSlotAllocator(…, { highWater })` 자리 열림, 지금 `{ highWater: 0 }`(`cover-letter-screen.tsx:125-126`, "연결 대기" 주석). `types/db.ts`에 이름 미리 넣지 않음 — 맞다 |
| 3 | **서류 `draft_done.draft`** | 지금은 `draft_block` 임시 블록으로 제안을 만들고 실제 경로는 턴 뒤 DTO 다시 읽기로 맞춘다(`use-cover-letter-panel.ts:376-380`). 들어오면 해시 재계산·다시 읽기를 걷는다(보고서 52 3절) |
| 4 | **새로 고침 뒤 다시 연 대화의 제안 카드 "근거 목록"이 빈다** | 저장된 `draft.sources[]`에 라벨이 없다(백엔드 요청). [반영]·저장 근거에는 영향 없음 |

## 6. 되살리면 안 되는 것 — 0건 (재확인)

`src/app`·`src/components`·`src/lib/data`·`src/lib/mock`·`src/lib/routes.ts` grep(주석 제외):
- "이관"(픽스처 프로젝트 이름 1건뿐) · "초안 보기" 0 · "6~10" 0 · "AI 없이 계속" 0(주석 "두지 않는다"만) · "모의 면접" 0(`policy-content.ts:400` 주석만) · "보드로 보기" 0(주석만).
- "경력기술서": 주석·mock 전용(`drafts.ts`·`fixtures.ts`)·`legacy-redirects.ts` 표·enum 주석뿐 — 화면에 그려지는 자리 없음. "면접"은 `GAP_ACTION_LABELS.prepare_answer = "면접 대비"`(유지 결정값) 1건.
- 수치·용어(라운드 1 중점 2): 문항 최대 5 · 기본 800 · 탭 "자소서" · 머리 공고 `dt` "채용 공고"(CF-S4, `cover-letter-screen.tsx:479`) — 변경 없음.

## 7. 파괴 마이그레이션 전 확인 (재실행 — 병합 2회 뒤)

판정 기준: 브리프 45 "QA 판정 기준" — 실제 경로만. 결과: **실제 경로 참조 0건.**

- `.from("drafts"|"draft_sections"|"draft_section_sources")` — `src/` 전체 **0건**.
- `20261113004700`이 drop하는 함수 **43개**(`^drop function` 목록)의 이름을 `src/`에서 문자열로 검색(테스트·`database.types.ts` 제외) — **0건**.
- 라운드 1 뒤 바뀐 `src` 파일 중 세 테이블 이름이 나오는 곳: `applications/_lib/actions.ts:19`(주석) · `src/lib/data/evidence.ts:177`(주석) · `src/types/db.ts:883·896·935`(폐기 표시 타입 주석) — 모두 런타임 영향 없음. 새 서버 코드 `server/services/application-document/read.ts`·`server/actions/application-document.ts`·`server/services/writing-chat/chat.ts`, 새 마이그레이션 `20261113004670`·`004680`에 참조 0건.
- 라운드 1 이후 바뀌지 않은 파일 — 판정 유지:

| 파일 | 내용 | 판정 |
|---|---|---|
| `src/lib/data/drafts.ts` | 서류 함수 real 분기 no-op / `retryJdExtraction`(`:1153-1154`) → `realRetryJdExtraction`, `runJdExtraction = retryJdExtraction`(`:1158`) | mock 전용 + **JD 추출 보존 ✅** |
| `src/lib/data/applications.ts:555-559·716-734` | `jdRawTextLock(db: MockDb…)`·`listDrafts` 등 — `MockDb` 인자/ mock 분기 | mock 전용 |
| `src/lib/data/deletion.ts:111·256-263·315-320·436-437·461-475` | mock 본문(`getDraftDeletionImpact`·`deleteDraft` real = `{sections: 0}`·no-op) | mock 전용 |
| `src/lib/data/applications-real.ts:57` · `src/lib/data/evidence-real.ts:56` | 공용 헬퍼용 가짜 `MockDb` 빈 배열 | 안전(DB 접근 없음) |
| `src/server/services/application/read.ts:88-92` · `services/account/index.ts:53` · `lib/data/account.ts:310` · `lib/contracts/account.ts:24` | 키 이름 `drafts`(DM §4.3 유지) | 안전 |
| `src/lib/mock/fixtures.ts` · `src/lib/contracts/enums.ts:476-508` · `src/lib/contracts/draft.ts` · `src/components/common/streaming.tsx:50` | 픽스처 / 옛 CHECK 목록·주석 | 런타임 영향 없음 |

## 8. 기계 검사

| 명령 | 결과 |
|---|---|
| `pnpm lint` | `eslint` 종료 0 (0 errors, 0 warnings) |
| `pnpm typecheck` | `next typegen && tsc --noEmit` — "Types generated successfully", 종료 0 |
| `pnpm test` | `Test Files 154 passed (154)` · `Tests 2473 passed (2473)`, 종료 0 |
| `pnpm build` | 종료 0 (`/applications`·`/applications/[id]/cover-letter`·`/board` 등 생성) |

포트 3000의 `pnpm dev`는 건드리지 않았다.

## 9. 브라우저 범위

- **미확인.** Claude in Chrome 미연결(`tabs_context_mcp` → "not connected"). 실제 Google 계정 로그인은 하지 않았다. `?state=` 미리보기 패스도 하지 못했다.
- 그래서 코드로만 본 것: UQ-746 포커스 이동, 패널 열고 닫기 포커스 복귀, UQ-749 스크롤·포커스, 좁은 화면 시트(UQ-745), 보드 위 모달의 포커스 복귀(Radix 기본 동작에 의존).

## 10. screen-status에 적을 상태

- **지금: `QA 진행 중 — Major 1 (UQ-756)`**.
  근거: 라운드 1 Critical·Major는 모두 해소됐고 덮어쓰기 조건 3가지·파괴 전 확인·되살리면 안 되는 것·기계 검사가 통과했다. 그러나 UQ-756은 정상 사용(문항 추가 → 새로 고침 → 다시 추가)으로 닿고, 저장이 원인 안내 없이 계속 실패한다. 통과 표시를 하기엔 이르다.
- **UQ-756 수정 + 재확인 뒤: `QA 통과 (mock·브라우저 미확인)`**. Minor 4건(UQ-757~760)과 기획 확인 UQ-761은 통과를 막지 않는다(UQ-757은 UQ-756과 같은 자리라 함께 고치길 권함). 브라우저 확인은 확장이 연결되면 `?state=` 미리보기로 따로 한다.

## 11. 재확인 결과 — 보고서 주장 중 코드와 다른 것

1. 보고서 51 1.3 "대화 제안이 가리키는 슬롯도 쓴 번호로 친다" — **첫 렌더에 연 대화만**이다. 이번 방문에 기록에서 연 대화는 들어가지 않는다(UQ-757).
2. 보고서 51 3.2 "`createApplicationAction`은 `invalid_source_url`을 값으로 돌려준다" — 맞지만 **실제 경로에서는 그 코드가 오지 않아** 효과가 mock에만 있다(UQ-759).
3. 보고서 51·52의 "슬롯 불변식 테스트" — 테스트 자체는 불변식을 단정한다(1절). 다만 화면 결선(복원·대화 열기)을 묶지 않아 UQ-756·757을 잡지 못했다. 고칠 때 화면 쪽 단정(예: 복원 뒤 `allocate()`가 복원 슬롯보다 큰 번호)을 함께 두길 권한다.
