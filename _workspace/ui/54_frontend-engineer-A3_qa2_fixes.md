# 54 런 A3 — UI QA 라운드 2 수정 (`53_ui-qa_cover-letter_round2.md`)

- 날짜: 2026-11-09 · 담당: frontend-engineer (A3) · 기준 HEAD `c7afdfe`
- 범위: **UQ-756(Major) · UQ-757 · UQ-758 · UQ-760**, 그리고 리더가 허락한 mock `stale_write` 조건(CF-S7)
- 손대지 않은 것: **UQ-759**(백엔드 — 계약·서버 미수정, 화면 정규식의 대소문자 무시도 그대로) · **UQ-761**(기획 확인)
- **커밋하지 않았다.** lint 0/0 · typecheck 통과 · test **155파일 2,487건 전부 통과** · build 통과

## 요약

| ID | 결과 |
|---|---|
| **UQ-756** Major | **고쳤다.** 발급기에 번호가 들어오는 길을 `slotsInUse()` 하나로 모았다. 정본·열린 제안·이번 방문 발급분·복원분이 모두 지난다. `invalid_slot`은 원인을 알리는 문구로 바꿨다 |
| **UQ-757** | **고쳤다.** UQ-756과 같은 길이다. 발급할 때마다 **지금 열린 대화**의 제안 슬롯을 본다 |
| **UQ-758** | **고쳤다.** 대화의 `applicationProjectId`가 이 화면의 지원 건과 다르면 열지 않는다. 화면은 대화 없이 정상으로 열린다 |
| **UQ-760** | **고쳤다.** 턴 뒤 다시 읽기는 지금 열린 대화 id가 그 턴의 대화와 같을 때만 반영한다. 기록에서 열기에도 같은 경쟁이 있어 최신 요청만 반영하게 막았다 |
| mock `stale_write` (CF-S7) | **맞췄다.** 행이 있는데 기대 버전이 null이어도 거부한다 |
| 못 고친 것 | 없다 |

---

## UQ-756 (Major) — 입력 보존 복원이 슬롯 발급기를 모른다

**원인**: 발급기는 정본과 첫 렌더의 `open_chat`만 알고 시작했다. 입력 보존 복원(`setForms(copy.forms)`)으로 되살아난 q_4는
발급기에 들어가지 않았다. 그래서 새로 고침 뒤 "+ 문항 추가"가 q_4를 한 번 더 냈다.

**고친 것 — 번호가 들어오는 길을 한 함수로 모았다**

- `src/components/applications/cover-letter/question-form.ts`
  - **`slotsInUse({ forms, document, chat })`**(130행 신설) — 지금 폼(복원분 포함) · 저장된 정본 · 지금 열린 대화의 제안 슬롯을 한 곳에서 모은다.
  - `createSlotAllocator().allocate(inUse?)`(102·116행)가 발급하는 그 순간 이 값을 받아 "쓴 번호"로 친 뒤 다음 번호를 낸다. 발급기가 따로 기억하지 못한 길로 들어온 번호도 이렇게 빠지지 않는다.
- `src/components/applications/cover-letter/cover-letter-screen.tsx`
  - 발급기 초기값도 `slotsInUse({ forms: [], document, chat: open_chat })`로 만든다.
  - **`allocateSlot`**(131행)은 `slots.allocate(slotsInUse(slotSourcesRef.current))`다.
  - `slotSourcesRef`(130행)는 폼·정본·열린 대화가 바뀔 때마다 맞춘다(402행). "+ 문항 추가"는 이벤트라서 그때의 최신 값을 읽는다.
  - 복원 지점(193행)에서도 `slots.markUsed(slotsInUse({ forms: copy.forms }))`로 같은 함수를 지난다.
- **`invalid_slot` 처리**(screen 299행)
  - "저장 실패"로 뭉개지 않는다. 거부 detail의 슬롯으로 문항 번호를 찾아 머리 아래에 원인을 보인다.
  - 문구: `invalidSlotCopy()` — "문항 {n}의 키가 다른 문항과 겹쳐 저장하지 못했어요. 그 문항을 지우고 다시 추가해 주세요" `[UI-가정]`. 번호를 못 찾으면 일반 문구를 쓴다.
  - 같은 내용으로 다시 눌러도 같은 거부라서 "다시 시도"가 아니라 검증 오류(`invalid`)로 둔다.
  - 옛 주석 "생기지 않아야 하는 거부"는 걷었다.

**테스트** (`question-form.test.ts` › "슬롯 발급은 지금 화면의 모든 슬롯을 본다 (UQ-756·757)")
- **"UQ-756 재현 순서: q_4 추가 → 저장 없이 새로 고침 → 입력 보존 복원 → '+ 문항 추가'는 q_4가 아니라 q_5"** — 방문 1과 방문 2의 발급기를 따로 만들어 순서를 그대로 단정한다. 결과 슬롯이 겹치지 않는다는 것도 확인한다.
- "UQ-756: 복원분을 markUsed로 미리 넣어도 같은 함수를 지나 같은 결과다"
- "한 번 발급한 번호는 그 문항을 지워도 다시 주지 않는다 (지금 화면에 없어도)"
- "invalid_slot 문구는 원인을 알린다 — '저장 실패'로 뭉개지 않는다 (UQ-756)"

## UQ-757 — 기록에서 연 대화의 제안 슬롯

- 위 정리로 함께 풀렸다. 발급할 때마다 `panel.chat`(지금 열린 대화)의 `structured_draft.document.questions[].slot`을 본다.
- 그래서 첫 렌더 뒤 기록에서 연 대화의 제안 슬롯도 "쓴 번호"가 된다.
- **테스트**: "UQ-757: 기록에서 나중에 연 대화의 제안 슬롯도 쓴 번호다 (첫 렌더의 open_chat만이 아니다)"

## UQ-758 — `?chat=`으로 다른 지원 건의 대화가 열린다

- `src/lib/data/cover-letter-chats.ts`
  - `getCoverLetterChat(chatId, applicationProjectId)` — 인자를 더했다.
  - 실제 분기는 `dto.applicationProjectId !== applicationProjectId`면 **`null`**(81행)이다. mock 분기도 같은 대조를 한다.
  - `startCoverLetterChat`도 시작한 대화가 이 지원 건 것이 아니면 거부한다(105행).
- 호출하는 곳 셋이 이 지원 건 id를 넘긴다:
  - `page.tsx` 67행 `getCoverLetterChat(chatIdParam, id)` — 맞지 않으면 대화 없이 화면이 정상으로 열린다. 이 줄의 `catch → null`은 **대화에만** 있다는 주석을 달았다. 정본 읽기에는 여전히 catch가 없다.
  - `getCoverLetterChatAction(chatId, applicationProjectId)`
  - 패널의 기록에서 열기·턴 뒤 다시 읽기
- **테스트** (`cover-letter-chats.read.test.ts`):
  - "UQ-758: 같은 사용자의 **다른 지원 건** 대화는 열지 않는다 (null — 화면은 대화 없이 정상)"
  - "UQ-758: 시작한 대화가 이 지원 건 것이 아니면 거부한다"

## UQ-760 — 늦게 도착한 턴 뒤 다시 읽기

- `src/components/applications/cover-letter/use-cover-letter-panel.ts`
  - `openChatIdRef`(123행)가 지금 열린 대화 id를 들고 있고, `chat?.id`가 바뀔 때마다 맞춘다.
  - 턴 뒤 다시 읽기는 **`shouldAdoptReread(openChatIdRef.current, target.id, r.data.id)`**일 때만 반영한다(391행).
  - 그 사이 기록에서 다른 대화를 열었거나 "+ 새 대화"로 비웠으면 버린다.
- 같은 경쟁이 기록에서 열기에도 있었다. 두 대화를 빠르게 연달아 열면 느린 응답이 나중 것을 덮을 수 있었다. `openSeq`(128·459·463행)로 **마지막 요청만** 반영한다.
- 판정은 순수 함수로 떼어 냈다: 신설 `src/components/applications/cover-letter/panel-rules.ts`.
- **테스트** (`panel-rules.test.ts`):
  - "지금 열린 대화가 그 턴의 대화일 때만 반영한다"
  - "그 사이 기록에서 다른 대화를 열었으면 버린다"
  - "'+ 새 대화'로 비웠으면 버린다"
  - "응답이 다른 대화면 버린다"

## mock `stale_write` 조건을 CF-S7로 (라운드 2 "남은 연결 대기" 1번)

- `src/lib/data/cover-letters.ts` 276행: 조건을 `doc && expected && doc.updated_at !== expected`에서 **`doc && (expected == null || doc.updated_at !== expected)`**로 바꿨다.
- 행이 **있는데** 기대 버전 null이면 `stale_write`와 `details.current_updated_at`을 돌려준다. 행이 **없을 때만** 기대 버전 없이 만든다.
- 서버 동작이 이미 기획 확정(CF-S7)이라 mock이 먼저 맞춰도 어긋나지 않는다(리더 허락).
- 화면 쪽은 손댈 것이 없다 — 문항 설정 상태의 [작성 시작]도 같은 충돌 다이얼로그로 간다(52 보고 ③).
- **테스트** (`cover-letters.slot.test.ts` › "CF-S7 — 행이 있는데 기대 버전 null이면 stale_write"):
  - "정본 행이 있는데 기대 버전 없이 저장하면 거부하고 지금 버전을 돌려준다 (빈 기본 문항으로 덮지 않는다)"
  - "'내 내용으로 저장'(받은 지금 버전을 다시 보냄)은 통과한다"
  - "행이 없으면 기대 버전 null로 만든다 (첫 저장 = [자기소개서 작성 시작])"

## `[UI-가정]`

| # | 가정 | 자리 |
|---|---|---|
| 38 | `invalid_slot` 문구 "문항 {n}의 키가 다른 문항과 겹쳐 저장하지 못했어요. 그 문항을 지우고 다시 추가해 주세요"(번호를 못 찾으면 "문항 키가 겹쳐 저장하지 못했어요. 마지막에 추가한 문항을 지우고 다시 추가해 주세요") | `question-form.ts` `invalidSlotCopy` |
| 39 | 다른 지원 건의 대화를 `?chat=`으로 열면 안내 없이 대화를 열지 않는다(화면은 정상) | `cover-letter-chats.ts` |

## 기획 확인 필요

**0건.** UQ-761은 리더가 넘긴 기획 확인이라 손대지 않았다.

## 검증

| 명령 | 결과 |
|---|---|
| `pnpm lint` | 통과 (0 errors, 0 warnings) |
| `pnpm typecheck` | 통과 |
| `pnpm test` | **155 파일 2,487건 전부 통과** (+14: `question-form.test.ts` +5 · `cover-letter-chats.read.test.ts` +2 · `cover-letters.slot.test.ts` +3 · 신설 `panel-rules.test.ts` 4). 정본 읽기 소스 가드("page.tsx의 getCoverLetterDocument 호출에 catch가 없다")도 그대로 통과 |
| `pnpm build` | 통과 |
| 브라우저 | 미확인 — 대상 화면이 로그인 게이트 뒤다 |
