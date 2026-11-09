# 51 런 A3 — UI QA 라운드 1 수정 (`50_ui-qa_cover-letter_review.md`)

- 날짜: 2026-11-09 · 담당: frontend-engineer (A3) · 기준 HEAD `5c7ed23`
- 범위: **UQ-740(Critical) · UQ-742(Major) · UQ-744~751(Minor)**. UQ-741·752는 백엔드, UQ-753~755는 기획 확인이라 손대지 않았다.
- **커밋하지 않았다.**
- 작업 트리에 내가 고치지 않은 변경이 있다 — `docs/ui/screen-status.md` · `src/components/account/deletion-summary.tsx` ·
  `src/components/account/policy-content.ts` · `_workspace/ui/45_brief…md`. 다른 세션 몫(UQ-754·755 쪽)으로 보이고 건드리지 않았다.

## 요약

| ID | 결과 |
|---|---|
| **UQ-740** Critical | **고쳤다** — 슬롯은 처음 생길 때 한 번 정하고 바꾸지 않는다. 순서는 `sort_order`만. mock도 같은 규칙. 테스트 11건 |
| **UQ-742** Major | **고쳤다** — 보드가 `<AddApplicationDialog fromBoard />`를 직접 띄운다(`BoardAddButton`). 주소가 바뀌지 않는다 |
| UQ-744 | 고쳤다 — S-13 빈 상태 문구를 v5.20 원문대로 |
| UQ-745 | 고쳤다 — 좁은 화면은 높이 제한 없이 전체 화면 시트 |
| UQ-746 | 고쳤다 — ①→② 지원 기업 칸 / ②→① 쓰던 입력칸으로 포커스 |
| UQ-747 | 고쳤다 — 명세 문구가 있어 그대로 넣었다(해시 비교 포함) |
| UQ-748 | 고쳤다 — 명세에 문구가 있어 넣었다 |
| UQ-749 | 고쳤다 — "AI 제안 있음" → 패널을 열고 그 문항의 [자세히] 자리로 |
| UQ-750 | 고쳤다 — 문항 설정 상태에서만 `aria-keyshortcuts`를 뺀다(S-10·S-44 그대로) |
| UQ-751 | 고쳤다 — 원인별로 가른다(순수 함수 + 테스트) |
| 기대 버전 null 경로 확인 | **한 경로가 있었다** — "내 내용으로 저장"이 정본이 있는데 null을 보냈다. 고쳤다(아래 1.4) |
| **QA 밖에서 찾은 결함 2건** | ① 실제 저장이 **늘 `invalid_input`으로 거부**됐을 것(`sort_order`를 실음) ② 저장·생성 거부 코드가 **Server Action 경계에서 사라졌다**. 둘 다 고쳤다(아래 3절) |

---

## 1. UQ-740 (Critical) — 슬롯 재번호

### 1.1 원인

`toCoverLetterBody()`가 저장할 때마다 `slot: q_${i + 1}`로 다시 매겼고(mock `saveCoverLetterDocument`도 같음),
새 문항은 `slot: ""`로 만들었다. 주석 "서버도 같은 규칙"은 사실이 아니었다 — RPC는 받은 슬롯을 그대로 쓴다.
정본은 DM v4.15 2.5.1 "슬롯 키 `slot` (확정)": **짧은 안정 키, 그 서류에서 한 번 쓰면 재사용하지 않는다.**

### 1.2 고친 것

| 파일 | 내용 |
|---|---|
| `src/components/applications/cover-letter/question-form.ts` | `toCoverLetterBody`가 **`slot: f.slot`을 그대로** 보내고 `sort_order`만 화면 순서(1부터)로 매긴다. 새로: `slotNumber()` · `nextSlot(used)`(쓴 적 있는 번호의 최댓값 + 1) · **`createSlotAllocator(initiallyUsed)`**(한 방문 동안 발급한 번호를 지워도 기억). `newQuestionForm(slot)`은 슬롯을 **인자로만** 받는다(빈 슬롯을 만들 길이 없다). `toQuestionForms`는 `sort_order`로 정렬해 되살린다 |
| `cover-letter-screen.tsx` | 화면이 발급기를 하나 들고 있다. 처음 쓴 번호로 **저장된 정본의 슬롯 + 열린 대화의 제안 슬롯**을 넣고, 첫 폼(기본 3문항 포함)의 슬롯도 표시한다. 첫 폼은 **한 번만** 만든다(전에는 세 번 만들어 `question_id`가 기준선과 어긋났다). `formSnapshot`·패널 문항 목록의 `f.slot \|\| q_${i+1}` 대체값을 지웠다 |
| `question-setup.tsx` · `answer-tab.tsx` | "+ 문항 추가"가 `newQuestionForm(allocateSlot())`로 만든다 |
| `question-proposal-card.tsx` | 제안 목록을 **슬롯 번호가 아니라 화면 순서**로 정렬한다(슬롯 번호는 순서가 아니다) |
| `src/lib/data/cover-letters.ts` (mock) | 슬롯을 **그대로** 저장하고 `sort_order`만 매긴다. RPC와 같이 형식(`^q_[0-9]{1,3}$`)·중복을 **`invalid_slot`**(details.field = 그 슬롯)으로 거부한다. **보내지 않은 슬롯의 근거 행만 지우고** 남은 슬롯의 근거는 그대로 둔다(RPC `doc_replace_slot_evidence`와 같다 — CF-S2 "손편집만 한 문항은 기존 근거 유지"). `invalid_fields`의 경로를 `questions.{실제 슬롯}.char_limit`으로 바꿨다(전에는 순서 번호였다) |
| `src/lib/data/cover-letter-copy.ts` | 순서에서 슬롯을 계산하던 **`seedCoverLetterQuestions`·`newCoverLetterQuestion(sortOrder)`를 지웠다** — 같은 결함이었고 쓰는 곳도 없었다. 잘못된 규칙이 되살아나지 않게 |

### 1.3 테스트로 묶은 불변식

- `question-form.test.ts`(+6, 기존 1건은 **결함을 단정하던 것**이라 고쳐 썼다):
  다음 번호 = 최댓값 + 1(빈 번호를 채우지 않음) · **삭제 후 추가 → 새 번호**(q_3 지우고 추가 → q_4, 또 지우고 추가 → q_5) ·
  빈 번호가 있는 정본(q_1, q_3) → q_4 · 대화 제안이 가리키는 지워진 슬롯도 쓴 번호로 친다 ·
  **순서 바꾸기 → slot·question_id 불변** · **저장 왕복(폼 → 정본 → 폼) → slot·순서 불변**.
- 신설 `src/lib/data/cover-letters.slot.test.ts`(6건, mock 저장을 실제로 돌린다):
  **1번을 지우고 저장 → 남은 문항 q_2·q_3 그대로, 지운 q_1의 근거만 사라지고 q_2의 근거는 제 문항에 남는다**
  (QA가 적은 증상 — 옛 코드는 q_3 근거를 지우고 q_1·q_2에 옛 근거를 남겼다) ·
  순서 바꿔 저장 → 근거 행이 하나도 움직이지 않음 · 빈 번호 정본 그대로 저장 · 겹치는/형식 아닌 슬롯 → `invalid_slot` + 아무것도 안 바뀜 ·
  `stale_write`가 지금 버전을 돌려줌 · 실제 저장 입력이 계약(`SaveApplicationDocumentInput`, strict)을 통과.

### 1.4 남은 한계 (백엔드 요청)

**방문을 건너서는 "재사용 금지"를 화면이 보장할 수 없다.** 문항을 지우고 저장하면 그 번호는 정본에서 사라지고, 다음 방문의
화면은 그 번호를 알 길이 없다(대화 제안에 남아 있으면 그것으로 막는다). 예: q_1~q_3에서 q_3를 지우고 저장 → 다음 방문에
"+ 문항 추가" → q_3. 그 슬롯의 근거 행은 RPC가 이미 지웠으므로 근거가 섞이지는 않지만, 지워진 q_3을 가리키는
**다른 대화의 옛 제안**(지금 열려 있지 않은 대화)이 새 q_3에 붙을 수 있다.
→ **백엔드 요청**: 정본에 **최고 번호(high-water mark)**를 두거나(예: `body.next_slot_no` / 생성 컬럼) 저장 RPC가 "쓴 적 있는 번호"를
거부해 주면 화면이 그 값으로 발급기를 시작한다. 그전까지 화면은 정본 + 열린 대화 + 이번 방문을 근거로 최선을 다한다.

---

## 2. UQ-742 (Major) — 보드 "+" 경로

| 파일 | 내용 |
|---|---|
| 신설 `src/components/board/board-add-button.tsx` | `BoardAddButton` — 버튼이 열림 상태를 들고 `<AddApplicationDialog fromBoard />`를 **보드 위에** 띄운다. 만든 뒤 모달이 `router.refresh()`하므로 **이 보드**가 다시 그려져 새 카드가 "지원 전" 열 맨 위에 오고 "열기" 토스트가 뜬다. 닫으면 보드 그대로 |
| `src/components/board/kanban-board.tsx:313-317`(좁은 화면 탭 버튼) · `:391-394`(넓은 화면 열 머리 "+") | `<Link href={routes.applicationNew({ from: "board" })}>` → `BoardAddButton` |
| `src/app/(dashboard)/(gated)/board/page.tsx:107-111`(빈 상태 버튼) | 같은 교체 |
| `add-application-launcher.tsx` | **주석을 사실대로** 고쳤다. `?new=1&from=board`로 S-13에 오는 길은 이제 옛 주소(`/applications/new?from=board`)뿐이고, 그때는 닫거나 만든 뒤 **보드로 돌려보낸다** `[UI-가정]` |
| `dev-state-gallery-v53.tsx` | "S-39 보드 (지원 전 + → 추가 모달)" 링크가 S-13으로 가던 것을 보드로 |

보드 파일은 이 이슈 범위 안에서만 고쳤다(버튼 3곳 + import 1줄).

---

## 3. QA 밖에서 찾은 결함 2건 (고쳤다)

### 3.1 실제 저장이 늘 `invalid_input`으로 거부됐을 것

계약 `DocumentQuestion`은 **`.strict()`이고 `sort_order`를 받지 않는다**(서버가 보낸 순서로 다시 매긴다). 그런데 화면의
`toCoverLetterBody`는 `sort_order`를 싣고, 실제 분기가 그것을 그대로 보냈다 → **모든 실제 저장이 zod에서 거부**됐을 것이다.
지금까지 드러나지 않은 이유는 실제 경로에서 S-46이 정본 읽기 연결 대기로 오류 화면이었기 때문이다(UQ-743).
작은 확인 테스트로 계약이 `sort_order`를 거부하는 것을 확인했다.
→ `cover-letters.ts`에 **`toDocumentBody()`**(정렬 뒤 `sort_order` 제외, `slot`은 그대로)를 두고 실제 분기가 그것을 보낸다.
테스트: 그 출력이 `SaveApplicationDocumentInput`을 통과한다.

### 3.2 거부 코드가 Server Action 경계에서 사라졌다

Server Action에서 **던진** `AppError`는 경계를 넘으면 `code`·`details`를 잃는다(메시지만 남는다). 그래서
- S-46 저장의 `stale_write`·`too_many_questions`·`invalid_fields`가 전부 "저장 실패"로 떨어졌고,
- S-14 생성의 `invalid_source_url` → "주소 없이 만들기"가 뜰 수 없었다.

→ `saveCoverLetterDocumentAction`을 **`runAction()`으로 감싸 `ActionResult`를 돌려주고**, 화면이 `result.error.code`·`details`로 가른다.
`createApplicationAction`은 `invalid_source_url`을 **값**(`{ refused: "invalid_source_url" }`)으로 돌려준다. 화면 쪽 `errorCode()`·`isInvalidSourceUrl()`(던진 오류를 뒤지던 것)은 지웠다.
저장 거부 처리도 계약 목록(`DOCUMENT_SAVE_ERROR_CODES`)에 맞춰 `field_too_long`·`invalid_slot`·`application_project_not_found`를 더했다.

---

## 4. 기대 버전(`expected_updated_at`) — 화면 쪽 확인

리더 요청대로 "정본이 있는 상태에서 null을 보내는 경로"를 찾았다. **하나 있었다**: 변경 충돌 확인의 **"내 내용으로 저장"**이
`expected_updated_at: null`을 보냈다(`opts.overwrite ? null : updatedAt`) — 정본이 **있는** 상태에서다. RPC는 null이면 검사 없이
덮으므로(UQ-741) 그 사이 또 바뀐 내용까지 조용히 덮을 수 있었다.
→ `stale_write`의 `details.current_updated_at`을 기억했다가 "내 내용으로 저장"이 **그 값**을 기대 버전으로 보낸다
(`cover-letter-screen.tsx` `staleVersion`). mock도 `stale_write`에 `current_updated_at`을 싣는다(테스트 있음).

이제 null을 보내는 경우는 **정본 행이 없을 때의 첫 저장**([자기소개서 작성 시작]) 하나뿐이다 — 그때 이미 다른 탭이 행을 만들었다면
덮어쓰는 것은 RPC 쪽 결정(UQ-741, 백엔드)이다. 정본 읽기도 그대로 실패를 던지고 `page.tsx`에 `catch → null`이 없다(QA 조건 유지).

---

## 5. Minor 이슈별

| ID | 고친 자리 | 내용 |
|---|---|---|
| **UQ-744** | `src/app/(dashboard)/(gated)/applications/page.tsx` 빈 상태 | UX v5.20 S-13 상태 원문 그대로: "지원하려는 공고를 **넣어** 첫 자기소개서를 **만들어** 보세요. 커리어 정리 전에도 **만들** 수 있어요" |
| **UQ-745** | `add-application-dialog.tsx` `DialogContent` | `max-h-[85dvh]` → **`sm:max-h-[85dvh]`**, 좁은 화면은 `max-sm:h-dvh max-sm:max-h-dvh` — 640px 미만에서 화면 높이 전체 |
| **UQ-746** | `add-application-dialog.tsx` 단계 전환 효과 | ②로 가면 **지원 기업**(`#add-ap-company`), ①로 돌아오면 쓰던 칸(URL이 비활성이면 직접 입력)에 포커스. 첫 마운트에는 움직이지 않는다 |
| **UQ-747** | `question-proposal-card.tsx` 반영 확인 · `use-cover-letter-panel.ts` | 명세 문구가 있다(UX v5.20 S-46 반영 규칙) — **"초안을 만든 뒤 답변이 바뀌었어요. 바꾸면 바뀐 내용도 사라져요"**를 그대로 넣었다. 판정: 제안의 `base_body_hash` ≠ 지금 답변의 해시면 이 문구. 해시는 **서버와 같은 함수** `computeBodyHash`(`src/lib/body-hash.ts`, OD-P5 정규화)로 **문항별** 계산한다. ⚠ 서류 `draft_done`이 `base_body_hash`를 싣지 않아(계약 `DocumentDraftDoneEvent`) 화면이 **그 턴이 보낸 `form_snapshot` 본문**으로 같은 값을 만든다 — 서버가 같은 본문으로 계산하므로 값은 같다(아래 백엔드 요청 ②) |
| **UQ-748** | `cover-letter-chat-types.ts` `PANEL_COPY.continueNext` · `cover-letter-panel.tsx` · 컨트롤러 `offerNext` | 명세에 있다(UX v5.20 S-46 "첫 턴 제안" `[가정]`): 초안 턴이 성공으로 끝났고 **아직 제안이 없는 문항이 남았으면** "다음 문항도 이어서 써 볼까요?". 초안 상한에 닿았으면 보이지 않는다 |
| **UQ-749** | `answer-tab.tsx` · `cover-letter-screen.tsx` · 컨트롤러 `revealSlot`/`focusRequest` · 카드 | "AI 제안 있음" → 패널을 열고(좁은 화면은 시트) 카드의 [자세히]를 펼쳐 **그 문항 묶음으로 스크롤·포커스**한다(UP-4). "AI와 초안 쓰기"(입력창 포커스)와 따로 둔다. 같은 문항을 다시 눌러도 다시 펼친다(`seq`) |
| **UQ-750** | `src/components/common/shell/page-shell.tsx` `SaveButton` | 앞 런의 `hideTooltip`을 **`noShortcut`**으로 바꿨다 — "이 상태에는 저장 단축키가 없다": ⌘S 처리 · **`aria-keyshortcuts`** · 툴팁을 함께 끈다. 기본값 `false`라 S-10·S-44는 그대로이고, S-46은 **문항 설정 상태에서만** 켠다 |
| **UQ-751** | `form-draft.ts` `previewRefusalAction()`(신설, 순수) · `add-application-dialog.tsx` | 미리 보기 거부를 원인별로: `key_invalid` → ①에 머물고 C-20 / `ai_consent_required` → C-21 / `ai_not_connected`·`key_missing` → **막지 않고 AI-01 없이 ②로(안내 없음)** / 그 밖 → ②로 + C-20 축약. 테스트 1건(6 단정) |

---

## 6. 백엔드 요청 (새로 생긴 것)

1. **슬롯 최고 번호** — 방문을 건너 "재사용 금지"(DM 2.5.1)를 지키려면 정본에 쓴 적 있는 최고 번호가 필요하다(1.4).
2. **서류 `draft_done`에 확정 블록·`base_body_hash`** — 지금은 메타만 온다. 화면은 `draft_block`(임시)을 시도별로 모아 확정 제안으로
   올리고, `base_body_hash`는 보낸 `form_snapshot`으로 다시 계산한다. **`correction_applied = true`(글자 수 보정)이면 서버가 저장한
   최종 문장과 화면이 모은 임시 문장이 다를 수 있다** — 그 경우 [반영]이 보정 전 문장을 채운다. `draft_done`이 그 문항의 `blocks[]`·
   `value`·`base_body_hash`를 싣거나, 서류 대화 읽기 계약(49 보고 5절 ④)이 생기면 턴 뒤 다시 읽어 맞춘다.
3. (앞 런에서 이어짐) UQ-741 — 행이 있는데 기대 버전 null이면 `stale_write`. 화면은 4절대로 정본이 있을 때 null을 보내지 않는다.

## 7. `[UI-가정]` (이번에 더한 것)

| # | 가정 | 자리 |
|---|---|---|
| 31 | 옛 주소 `/applications/new?from=board`로 S-13에 왔으면 닫거나 만든 뒤 보드로 돌려보낸다 | `add-application-launcher.tsx` |
| 32 | ①로 돌아올 때 포커스 = URL 칸(비활성이면 직접 입력 칸) | `add-application-dialog.tsx` |
| 33 | `invalid_slot` 거부는 생기지 않아야 하는 거부라 입력을 지키고 "저장 실패"로만 둔다 | `cover-letter-screen.tsx` |
| 34 | `field_too_long` 거부 문구 "글자 수 한도를 넘은 칸이 있어요"(칸별 문구는 화면 검증이 먼저 막는다) | 같음 |

## 8. 기획 확인 필요

**0건.** UQ-753~755는 리더가 기획 세션에 넘긴 것이라 손대지 않았다. 이번 수정에서 새로 생긴 기획 질문은 없다
(1.4·6절의 한계는 계약 쪽이다).

## 9. 검증

| 명령 | 결과 |
|---|---|
| `pnpm lint` | 통과 (0 errors, 0 warnings) |
| `pnpm typecheck` | 통과 |
| `pnpm test` | **150 파일 2,446건 전부 통과** (+13: `question-form.test.ts` +6 · 신설 `cover-letters.slot.test.ts` 6 · `form-draft.test.ts` +1) |
| `pnpm build` | 통과 |
| 브라우저 | **미확인** — 대상 화면이 로그인 게이트 뒤다(QA와 같은 사유). Claude in Chrome도 연결돼 있지 않다 |
