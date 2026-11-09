# 52 런 A3 — R15 후속 읽기 연결 (`56ba1bf` 병합분)

- 날짜: 2026-11-09 · 담당: frontend-engineer (A3) · 기준 HEAD `73dd3d0`(병합 커밋, 작업 트리 깨끗한 상태에서 시작)
- **커밋하지 않았다.** `src/lib/contracts/`·`src/server/`·`supabase/`는 읽기만 했다.

## 요약

- 서버 액션 6개 가운데 **5개를 붙였다.** C-11 근거 칩은 일부러 붙이지 않았다(아래 1절 끝).
- **남은 연결 대기: 0건.** 자기소개서 흐름의 data layer 함수가 전부 실제 경로다. 코드에 "연결 대기"로 남은 자리는
  `slot_high_water` 하나뿐이고, 그것은 아직 커밋되지 않은 다음 백엔드 커밋 몫이다(입력 자리만 열어 뒀다).
- 반드시 지킬 것 3가지를 각각 코드와 테스트로 묶었다(2절).
- `correction_applied` 문항의 [반영]은 **막지 않았다.** 정정 지시대로 임시 방어를 만들지 않았다. 대신 실제 경로에서
  **턴이 끝나면 저장된 대화(DTO)를 다시 읽어 제안을 저장본으로 맞춘다**(3절).
- lint 0/0 · typecheck 통과 · test **154파일 2,473건 전부 통과** · build 통과.

---

## 1. 붙인 함수

| 화면 함수 (`src/lib/data/…`) | 서버 액션 | 처리 |
|---|---|---|
| `getCoverLetterDocument(id)` (`cover-letters.ts`) | `getApplicationDocument({applicationProjectId, documentKind: "cover_letter"})` | `unwrap` — **`{error}`는 던지고 `{data: null}`만 null** |
| `listCoverLetterSlotCounts()` (`cover-letters.ts`) | `listDocumentSlotCounts()` | 그대로. 행 없는 프로젝트는 키가 없다(배지 없음) |
| `markCoverLetterCopied(id)` (`cover-letters.ts`) | `markApplicationDocumentCopied(…)` | 반환을 `void` → **`firstCopiedAt: string \| null`**로 바꿨다(mock도 같다) |
| `listCoverLetterChats(id)` (`cover-letter-chats.ts`) | `listDocumentWritingChats({applicationProjectId, documentKind})` | camelCase 요약을 화면 요약으로 바꾼다(`toSummary`) |
| `getCoverLetterChat(chatId)` (`cover-letter-chats.ts`) | `getWritingChat({writingChatId})` | `target === "application_document"`가 아니면 `not_found`. **`structuredDraft`는 snake_case 그대로 넘긴다**(`toChatView`) |
| `startCoverLetterChat` (`cover-letter-chats.ts`) | `startDocumentWritingChat` → `getWritingChat` | 시작한 뒤 **그 대화를 읽어 연다**(앞 런은 빈 뷰를 화면이 직접 만들었다) |
| `deleteCoverLetterChat` (`cover-letter-chats.ts`) | `deleteWritingChat({writingChatId})` | 대화 대상과 관계없는 공용 삭제 |
| 신설 `getCoverLetterChatAction` (`applications/_lib/actions.ts`) | (위 `getCoverLetterChat`) | `ActionResult`로 돌려준다. 패널의 "기록에서 열기"와 "턴 뒤 다시 맞추기"가 쓴다 |

**패널**(`use-cover-letter-panel.ts`):
- 기록 목록의 대화 열기를 실제로 붙였다. 앞 런의 "아직 연결되지 않았어요" 토스트를 걷었다.
- `adoptChat()`이 DTO로 메시지·제안·초안 횟수를 다시 맞춘다.
- 이제 "새로 고침하면 대화가 사라진다"가 풀렸다. 페이지가 `?chat=`로 연 대화를 DTO로 읽어 들인다.

**S-39 보드**: `readCoverLetterLabels()`는 그대로 두고 주석만 바꿨다. A4의 서버 컴포넌트 라벨 map 방식이다.
`listCoverLetterSlotCounts()`가 실제 경로가 됐으니 배지가 실제 환경에서 보인다.
이 읽기가 실패하면 배지만 접는 동작은 유지했다. 정본 판정이 아니라 덮어쓰기 위험이 없는 곁가지 표시라서다.

**C-11 근거 칩 — `listApplicationDocumentEvidence`는 붙이지 않았다 (사유)**
- C-11 행은 **경로 한 줄**("회사명 또는 교육 표시 이름 › 프로젝트명", CF-S2)이다.
- 그런데 이 액션의 `EvidenceChip`에는 경로가 없다. `sourceLabel`·`kindLabel`·`target`뿐이고, 경력·교육 이름을 따로 조인해야 한다.
- 지금 쓰는 공용 읽기 `getEvidence("application_document", docId)`는 **이미 실제 경로**다. `evidence-real.ts` `loadEvidenceRows`가 `evidence_links`를 읽고 경력·교육·프로젝트를 조인해 `path`를 만든다. `owner_type = application_document`도 받는다.
- 그래서 근거를 읽는 길을 두 개로 만들지 않았다.
- 한 가지는 고쳤다. 실제 경로의 `user_note` 근거는 그 가짜 db에 `application_documents`가 없어 `.find`에서 깨졌을 것이다. 비어 있으면 기본 라벨로 떨어지게 했다(`evidence.ts`).

### 1.1 대화 DTO 표기 — 저장 모양 하나로 맞췄다

- 앞 런의 화면 손 타입(`CoverLetterStructuredDraft` 등)이 저장 모양과 어긋나 있었다. 예: 사실의 키가 실제로는 `id`인데 `fact_id`로 적혀 있었다.
- 그래서 그 타입들을 **계약 `CoverLetterDraft`의 별칭**으로 바꿨다(`cover-letter-chat-types.ts`). type-only import라 클라이언트 번들에 서버 코드가 들어가지 않는다.
- 이 바꿈으로 드러난 차이를 mock·컨트롤러·카드에서 맞췄다:
  - `document.question_edit_proposal`
  - `draft.sources`·`generated_at`
  - 블록 `evidence[]`의 전체 칸
  - `review`에 `rejected`가 없음 — 카드의 [빼기]는 저장하지 않는 화면 상태로만 둔다.
- 저장된 제안은 **늘 DTO의 `structuredDraft`에서** 읽는다. SSE `sources_selected`(camelCase)는 스트리밍 중 근거 목록 표시에만 쓴다.

---

## 2. 반드시 지킬 것 3가지

### ① `getApplicationDocument`의 `{error}`를 `null`로 접지 않는다

- **코드**:
  - `getCoverLetterDocument`의 실제 분기는 `unwrap(await getApplicationDocument(…))`이다. `{error}`면 `AppError`를 **던진다**.
  - 호출하는 `cover-letter/page.tsx`는 `Promise.all([getJobDescription(id), getCoverLetterDocument(id)])`이다. `catch`·`try`가 없으므로 오류 상태(S-28)로 간다.
  - 같은 페이지의 `.catch(() => null)`은 **대화 열기**(`getCoverLetterChat`)에만 있고, 정본 판정과 무관하다.
- **테스트** (`src/lib/data/cover-letters.read.test.ts`):
  - "{error}면 던진다 — null로 접지 않는다"
  - "권한·인증 오류도 던진다"
  - "{data: null}만 null(행 없음 → 문항 설정 상태)"
  - **소스 가드** "page.tsx의 getCoverLetterDocument 호출에 catch가 없다" — 호출 뒤 `.catch(` 없음, `try {…getCoverLetterDocument` 없음.

### ② 읽은 행의 `updated_at`을 다음 저장의 기대 버전으로 보낸다

- **코드**:
  - 화면의 `updatedAt` 초기값은 서버가 넘긴 정본 행의 `updated_at`이다.
  - 저장 때 기대 버전은 신설 순수 함수 **`expectedVersion()`**(`cover-letter/save-version.ts`)이 정하고, `runSave`가 그것을 쓴다.
  - 행이 없을 때(문항 설정 상태의 첫 저장)만 `null`이다.
- **테스트** (`save-version.test.ts`):
  - "② 정본 행을 읽었으면 그 updated_at을 다음 저장의 기대 버전으로 보낸다"
  - "행이 없을 때(문항 설정 상태의 첫 저장)만 null이다"
  - `cover-letters.read.test.ts` "행이 있으면 그대로 돌려준다 — updated_at이 다음 저장의 기대 버전이 된다"

### ③ CF-S7 — [작성 시작]도 같은 충돌 다이얼로그

- **코드**:
  - `stale_write`는 상태와 관계없이 같은 `StaleWriteDialog`를 연다. 앞 런(QA 1)부터 그랬다.
  - "내 내용으로 저장"은 `details.current_updated_at`을 기대 버전으로 다시 보낸다.
  - 이번에 더한 것: 문항 설정 상태에서 그 다이얼로그의 "내 내용으로 저장"을 누르면 **`createRow`도 함께** 보낸다. 그래서 [작성 시작]과 똑같이 작성 상태로 넘어간다.
  - "다시 읽어 작성 상태로 열기"(백엔드의 옛 제안)는 만들지 않았다. 기획 결정대로 같은 다이얼로그다.
- **테스트** (`save-version.test.ts`):
  - "③ CF-S7 — [작성 시작]이 stale_write를 받은 뒤 '내 내용으로 저장'은 current_updated_at을 보낸다 (null 아님)"
  - "작성 상태의 '내 내용으로 저장'도 지금 버전을 보낸다 — 정본이 있는데 null을 보내는 길이 없다"
  - mock 쪽 `cover-letters.slot.test.ts` "stale_write는 지금 버전을 details.current_updated_at으로 돌려준다"(QA 1)
- **남는 조건**: 서버가 "행 있음 + 기대 버전 null"을 거부하는 마이그레이션은 이번 묶음 다음에 들어올 수 있다. 화면은 이미 맞춰져 있다.

---

## 3. `correction_applied` 처리

- 처음 지시대로 서류 `draft_done` 스키마(`src/lib/contracts/writing-chat.ts` `DocumentDraftDoneEvent`)부터 확인했다. **`draft` 필드는 아직 없다.**
- 그 뒤 정정 지시를 따랐다: [반영]을 막는 임시 방어는 **만들지 않았다**. 카드에는 `char_adjust_needed` 안내 줄만 있고 버튼은 막지 않는다.
- 대신 이번에 생긴 대화 읽기로 위험을 줄였다. 실제 경로에서 턴이 끝나면(`turn_done` 뒤) `getCoverLetterChatAction`으로 **저장된 대화를 다시 읽어 `adoptChat`**한다.
  - 그래서 글자 수 보정 뒤 저장된 블록이 제안 카드에 들어간다. 화면이 `draft_block`(임시)으로 만든 제안은 그 사이에만 보인다.
  - 다시 읽기가 실패하면 화면이 만든 제안을 그대로 둔다.
  - mock(`?state=`)에서는 다시 읽지 않는다.
- `draft_done`의 처리 자체는 **바꾸지 않았다**(지시: "지금은 바꾸지 마라"). `draft_done.draft`가 들어오면 그것으로 확정하고, `computeBodyHash` 재계산을 걷고, 턴 뒤 다시 읽기도 걷으면 된다.

---

## 4. 다음 백엔드 커밋 대비 — `slot_high_water` 입력 자리

- `createSlotAllocator(initiallyUsed, { highWater })`가 정본의 최고 번호를 받도록 열어 뒀다(값이 없으면 0).
- 새 번호 = `max(highWater, 열린 제안, 이번 방문 발급분, 남은 슬롯) + 1`이다.
- 화면은 지금 `{ highWater: 0 }`을 넘긴다. 주석 "연결 대기: `application_documents.slot_high_water`"를 달아 뒀다.
- 컬럼이 들어오기 전이라 `types/db.ts`에 이름을 만들어 넣지 않았다.
- 테스트(`question-form.test.ts`): "정본의 최고 번호(slot_high_water)를 받으면 그보다 큰 번호부터 준다 — 없으면 0".

---

## 5. `[UI-가정]`

| # | 가정 | 자리 |
|---|---|---|
| 35 | 기록 목록에서 대화를 열지 못하면 토스트 "대화를 열지 못했어요. 다시 시도해 주세요" | `use-cover-letter-panel.ts` |
| 36 | 실제 경로에서 턴이 끝나면 저장된 대화를 다시 읽어 맞춘다(다시 읽기 실패는 조용히 화면 제안 유지) | 같음 |
| 37 | 보드 배지 읽기가 실패하면 배지만 접는다(A4 동작 유지) | `board/page.tsx` |

## 6. 기획 확인 필요

**0건.**

### 알려 둘 한계 (요청은 아니다)

- 대화를 **새로 고침 뒤 다시 열면** 제안 카드의 "근거 목록"이 비어 보인다.
- 근거 목록은 SSE `sources_selected` 카드(라벨·선택 이유)로 그리는데, 이 카드는 저장되지 않는다.
- 저장된 `draft.sources[]`에는 `{source_type, source_id, role}`만 있어 라벨이 없다.
- 선택 이유가 저장되지 않는 것은 CF-S2가 정한 그대로다. [반영]과 저장 근거(서버가 `draft.sources`로 만든다)에는 영향이 없다.
- 다시 연 대화에서도 라벨을 보이려면 `draft.sources`의 라벨 조인이 필요하다 — 필요하면 백엔드에 올리겠다.

## 7. 검증

| 명령 | 결과 |
|---|---|
| `pnpm lint` | 통과 (0 errors, 0 warnings) |
| `pnpm typecheck` | 통과 |
| `pnpm test` | **154 파일 2,473건 전부 통과**. 이번에 내가 더한 것은 16건이다: 신설 3파일 `cover-letters.read.test.ts` 7 · `cover-letter-chats.read.test.ts` 4 · `save-version.test.ts` 4, `question-form.test.ts` +1. QA 1 때(2,446건)보다 늘어난 나머지는 병합으로 들어온 백엔드 테스트다 |
| `pnpm build` | 통과 |
| 브라우저 | **미확인** — 대상 화면이 로그인 게이트 뒤다(QA와 같은 사유) |
