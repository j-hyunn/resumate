# 55 런 A3 — 백엔드 R15 후속 3(`8473a58`) 연결

- 날짜: 2026-11-09 · 담당: frontend-engineer (A3) · 기준 HEAD `6a7e429`(병합 커밋 — typecheck가 깨진 상태에서 시작)
- 지시 1~6번을 모두 처리했다. **커밋하지 않았다.** `src/lib/contracts/`·`src/server/`·`supabase/`는 읽기만 했다.
- 검증: lint 0/0 · typecheck 통과 · test **155파일 2,501건 전부 통과** · build 통과

## 1. 저장 반환 11키 (`slotHighWater`)

| 자리 | 처리 |
|---|---|
| `src/lib/data/cover-letters.ts` mock 반환(364행) | `slotHighWater: doc.slot_high_water`를 더해 계약 `SaveApplicationDocumentResult`(11키)와 같게 했다. `skipped: [] as …["skipped"]`로 타입을 계약에 맞췄다 — 전에는 `never[]`로 추론돼 실제 분기 반환 타입과 어긋났다(348행 오류) |
| mock 계산(300행) | 실제 RPC처럼 **`greatest(기존, 이번 body 최대 번호)`**. 문항을 지워도 내려가지 않는다 |
| 화면 `cover-letter-screen.tsx`(326·337·350행) | 저장 응답의 `slotHighWater`를 **발급기(`slots.markHighWater`)와 화면의 정본 행**에 넣는다 |

**테스트** (`cover-letters.slot.test.ts` › "R15 후속 3 — 슬롯 최고 번호와 정체"):
- "저장 반환은 11키 — slotHighWater = greatest(기존, 이번 body 최대 번호)"
- "문항을 지워도 slot_high_water는 내려가지 않는다"

## 2. `ApplicationDocument.slot_high_water` · `doc` null 오류

- 픽스처 `src/lib/mock/fixtures.ts` 두 행(1024·1041행)에 **`slot_high_water: 3`**을 넣었다(q_1~q_3).
- mock 저장이 새 행(322행)·기존 행(332행) 모두에 값을 쓴다. 화면이 첫 저장 뒤 만드는 행(screen 350행)에도 넣는다.

**`doc` null 오류(306·334~341행)의 원인**
- 새 오류가 아니라 **293행 오류의 연쇄**였다.
- mock 저장은 `let doc = … ?? null` 뒤에 행이 없으면 `doc = { … }`로 새 행을 넣는다. 그런데 이 객체에 새 필수 칸 `slot_high_water`가 없어 **대입 자체가 타입 오류**가 났다.
- 그 결과 TypeScript가 그 아래에서 `doc`을 `ApplicationDocument`로 좁히지 못하고 `ApplicationDocument | null`로 남겨 뒀다.
- `slot_high_water`를 채우자 대입이 통과하고 좁히기가 돌아와 오류가 모두 사라졌다. **코드 흐름은 바꾸지 않았다.**

**읽기 실패를 null로 접지 않는다는 조건은 그대로다**
- `getCoverLetterDocument`는 여전히 `unwrap`으로 `{error}`를 던진다.
- `page.tsx`에 catch가 없다는 소스 가드 테스트도 통과한다.

## 3. 새 문항 번호 = `max(slot_high_water, 열린 제안, 이번 방문 발급분) + 1`

- **`createSlotAllocator(…, { highWater })`**에 **읽은 행의 `slot_high_water`**를 넣는다(screen 126행, 행이 없으면 0). 이전의 `0` 고정과 "연결 대기" 주석을 걷었다.
- 발급기에 `markHighWater(n)`을 더했다(question-form.ts 106~113행) — 저장 응답이 더 큰 값을 알려 오면 따른다(내려가지 않는다). 서버는 저장한 번호를, 화면은 저장하지 않은 번호(열린 제안·이번 방문 발급분·복원분)를 맡는다.
- **`invalid_slot` 문구가 그 slot을 쓴다**(screen 299~310행):
  - 거부 detail의 `field`(= 그 slot)로 문항 번호를 찾아 "문항 {n}의 키가 다른 문항과 겹쳐…"를 보인다.
  - 이번에 하나 더했다: 그 slot을 발급기의 "쓴 번호"로 넣는다(307행). 사용자가 그 문항을 지우고 다시 추가하면 **서버가 이미 쓴 번호보다 큰 번호**를 받는다.
- **테스트** (`question-form.test.ts`) "slot_high_water를 저장 응답으로 받으면 다음 번호는 그것 + 1 (지운 최고 번호도 다시 쓰지 않는다)"
- **mock도 RPC와 같다** (`cover-letters.slot.test.ts`) "저장돼 있지 않은 새 슬롯의 번호가 slot_high_water 이하이면 invalid_slot (details.field = 그 slot)"

## 4. 슬롯 정체 = 번호 + `question_id`

**확인한 것** — `question_id`를 새로 만드는 곳은 둘뿐이다:
- `newQuestionId()`를 부르는 `seedQuestionForms()` — 행이 없는 문항 설정 상태의 기본 3문항
- `newQuestionForm(slot)` — "+ 문항 추가"

정본에서 온 문항은 `toQuestionForms()`가 **읽어 온 `question_id`를 그대로** 폼에 둔다. `toCoverLetterBody()`가 그대로 싣는다.
입력 보존 복사본도 폼 전체를 JSON으로 들고 있어 id를 잃지 않는다. 첫 폼은 한 번만 만든다(QA 1) — 기준선과 id가 어긋나지 않는다.

**mock**(cover-letters.ts 274~297행) — RPC와 같은 규칙을 둔다:
- 저장된 슬롯인데 `question_id`가 다르면 `invalid_slot`
- **생략하면 저장된 id를 물려받는다**
- 새 슬롯은 번호가 `slot_high_water` 이하이면 `invalid_slot`

**테스트**:
- `question-form.test.ts` › "question_id는 정본·입력 보존을 지나도 잃지 않는다 (R15 후속 3)"
  - "정본에서 온 문항은 저장 입력에 읽어 온 question_id를 그대로 싣는다 (새로 만들지 않는다)"
  - "입력 보존(JSON 왕복)으로 되살린 문항도 같은 question_id를 싣는다"
  - "새 문항만 새 question_id를 받는다"
- `cover-letters.slot.test.ts`
  - "같은 번호에 다른 question_id면 invalid_slot"
  - "question_id를 생략하면 저장된 id를 물려받는다"

## 5. 서류 `draft_done.draft` — [반영]은 저장된 제안을 읽는다

| 자리 | 처리 |
|---|---|
| `src/lib/data/cover-letter-chat-types.ts` | `draft_done`에 **`draft: CoverLetterProposalDraft`**(저장 모양, 계약 타입 별칭)를 더했다 |
| `src/lib/data/ai-stream-client.ts` `realCoverLetterTurn` | `ev.draft`를 **그대로 통과**시킨다(snake_case — `draft_block.block`과 같은 규칙) |
| `use-cover-letter-panel.ts` `draft_done`(240행) | 그 문항의 제안 = **`ev.draft`**(보정 뒤 `blocks`·`value`·서버 `base_body_hash`·`answer_title`·`sources`·`rev`). `draft_block`은 **스트리밍 보기(`provisional`)에만** 쓴다 |
| `src/lib/mock/cover-letter-turn.ts` | mock도 `draft_done.draft`를 싣는다. `base_body_hash`는 서버가 하듯 그 턴이 본 본문으로 만든 값이다 |

**걷어 낸 우회**
1. **`draft_block`을 모아 제안으로 올리던 것** — `pendingBlocks`는 시도별 스트리밍 보기에만 남겼다.
2. **턴 시작 때 `computeBodyHash`로 `base_body_hash`를 다시 계산하던 것**(`baseHashes`) — 서버 값을 쓴다.
3. **턴 뒤 저장 대화를 다시 읽던 보정용 우회**(52 보고서 3절) — `draft_done.draft`가 저장본이다. "기록에서 열기"와 새로 고침 복원(`?chat=`)의 읽기는 남겼다.

**남긴 것**
- 제안 카드의 `computeBodyHash`는 남겼다. 이것은 `base_body_hash`를 다시 계산하는 것이 아니라, **지금 답변**을 해시해 서버의 `base_body_hash`와 비교하는 자리다(UQ-747 "초안을 만든 뒤 답변이 바뀌었어요").
- **UQ-760 경쟁 방어**: 남은 다시 읽기 길("기록에서 열기")에 그대로 둔다.
  - `openSeq` 순번을 `openRequestRef`(마지막으로 열기를 요청한 대화 id)로 바꿨다.
  - 응답이 오면 `shouldAdoptReread(요청 id, 이 요청 id, 응답 id)`일 때만 반영한다.
  - "+ 새 대화"는 요청을 비워, 늦은 응답이 비운 패널을 다시 채우지 않는다.

**테스트** (`cover-letter-chat-types.test.ts`) "draft_done이 그 슬롯의 저장된 제안을 싣고 rev가 같다 · base_body_hash는 서버 값이다"
- `rev === draft.rev`
- `value` = 블록 이어 붙임
- `sources` 있음
- 저장 모양 키(`base_body_hash`·`block_id`)

## 6. CF-S7 — 409가 문항 오류(400)보다 먼저

- 화면은 이미 맞다: 두 상태가 같은 다이얼로그를 쓰고, "내 내용으로 저장"은 `current_updated_at`을 재전송한다.
- mock은 순서가 달랐다 — 문항 수·슬롯·글자 수 검사를 먼저 하고 그 뒤에 기대 버전을 봤다.
- **`stale_write` 검사를 정본 행을 찾은 바로 다음(249행)으로 옮겨** RPC와 같은 순서로 맞췄다.
- **테스트**: "409(stale_write)가 문항 오류(400)보다 먼저 나온다 — 서버 RPC와 같은 순서"
  - 겹치는 슬롯 + 기대 버전 null
  - 겹치는 슬롯 + 기대 버전 불일치
  - 둘 다 `stale_write`

## 결정 대기 (손대지 않았다)

- **저장하지 않은 새 문항은 AI 초안을 받을 수 없다.** 서버 컨텍스트가 저장된 문항만 돈다(`cover-letter-chat.ts:213-234`). 백엔드가 기획에 판단을 올렸다:
  - (a) 화면이 초안 요청 전에 저장한다
  - (b) 서버가 스냅숏의 새 슬롯도 넣는다
- 지금 동작대로 둔다 — 깨지지 않고 AI가 새 문항을 건너뛸 뿐이다.

## `[UI-가정]`

새로 생긴 것 없다(앞 런의 `invalidSlotCopy` 문구를 그대로 쓴다).

## 기획 확인 필요

0건(위 "결정 대기"는 백엔드가 이미 올린 건이다).

## 검증

| 명령 | 결과 |
|---|---|
| `pnpm lint` | 통과 (0 errors, 0 warnings) |
| `pnpm typecheck` | 통과 (병합 직후 깨져 있던 12건 해소) |
| `pnpm test` | **155 파일 2,501건 전부 통과**. 이번에 더한 것: `cover-letters.slot.test.ts` +6 · `question-form.test.ts` +4 · `cover-letter-chat-types.test.ts` +1 |
| `pnpm build` | 통과 |
| 브라우저 | 미확인 — 대상 화면이 로그인 게이트 뒤다 |
