# 56 런 A3 — CF-S8 턴 전 자동 저장 · CF-S9 문항 설정 상태 충돌 다이얼로그

- 날짜: 2026-11-10 · 담당: frontend-engineer (A3) · 기준 HEAD `783325c`
- 기준:
  - **CF-S8**: 사용자 확정 2026-11-10, decisions 4.23 UI #13, 기획 PR #68 `99ce3d9`
  - **CF-S9**: 사용자 확정 2026-11-10 (UQ-761), decisions 4.23 UI #14, 기획 PR #68 `d4a1c13`
  - 둘 다 `git fetch`한 뒤 `origin/claude/focused-mclaren-1a7881` 원문으로 확인했다.
- **원문과 리더 요약은 둘 다 같았다.** 다른 점이 없다.
  - CF-S8 원문: UX S-46 "AI가 읽는 내용" 아래(1747행)
  - CF-S9 원문: UX S-46 페이지 저장 "다른 곳에서 바뀜"(1758행) · decisions 4.23 UI #14
- 커밋하지 않았다. `docs/ui/screen-status.md`의 변경은 리더 것이라 건드리지 않았다.
- 검증: lint 0/0 · typecheck 통과 · test **155파일 2,512건 전부 통과** · build 통과

---

## 1. CF-S8 — 저장하지 않은 문항 구성은 턴 전에 저장한다

### 1.1 판정 함수 (순수)

`src/components/applications/cover-letter/question-form.ts`
- **`questionStructure(questions)`**(307행) — 문항 구성 = `sort_order` 순서의 `[slot, question_id]` 목록. 배열 순서가 섞여 와도 `sort_order`로 맞춘다.
- **`questionStructureChanged(stored, forms)`**(316행) — 저장된 정본의 목록과 지금 폼의 목록을 순서대로 비교한다.
  - 추가·삭제·순서 바꿈은 **참**이다. 같은 번호에 `question_id`가 다르면 다른 문항이니 역시 참이다.
  - 답변·제목·메모·글자 수 제한·문항 문장처럼 **값만** 바뀌면 **거짓**이다.
  - `stored = null`(정본 행 없음 = 문항 설정 상태)이면 **거짓**이다. 그 상태에는 패널(대화)이 없으니 해당이 없다 — 확인했다.

**테스트** (`question-form.test.ts` › "CF-S8 — 문항 구성이 바뀌었나 (턴 전 자동 저장 판정)", 8건)
- "구성은 sort_order 순서의 [slot, question_id]다 (배열 순서가 섞여 와도)"
- "값(답변·제목·메모)만 바뀌었으면 거짓 — 저장하지 않고 스냅숏으로 보낸다"
- "문항을 추가했으면 참" · "문항을 지웠으면 참" · "순서를 바꿨으면 참"
- "같은 번호라도 question_id가 다르면 참(다른 문항이다)"
- "문항 설정 상태(정본 행 없음)는 대화가 없으니 해당 없음 — 거짓"
- "저장 왕복 뒤의 폼은 그 정본과 구성이 같다 — 저장 직후 다시 저장하지 않는다"

### 1.2 구현 자리

| 파일·줄 | 내용 |
|---|---|
| `use-cover-letter-panel.ts` 옵션 `beforeTurn` | 턴을 보내기 **직전**에 부르는 자리다. `true`면 보내고 `false`면 보내지 않는다 |
| `use-cover-letter-panel.ts` `send()`(386~411행) | **턴을 보내는 모든 길이 `send`를 지난다** — 입력창, 빠른 버튼 칩, 첫 턴 제안 칩, "다시 보내기", `?state=` 자동 재생. 흐름: 동의 확인 → **`beforeTurn()`(저장)** → 대화 시작/열기 → `onSent()` → 턴 |
| 같은 함수(394행) | **이중 전송 막기**: 저장 중(`preparingRef`)이거나 턴이 도는 중이면 보내지 않는다 |
| 같은 자리 `preparing` 상태(126~127행) | 패널이 이 값으로 보내기·칩을 막는다 |
| `cover-letter-screen.tsx` `beforeTurn`(413행) | 정본(`docRef`) 구성과 지금 폼(`formsRef`)을 `questionStructureChanged`로 비교한다. 바뀌었을 때만 **`runSave()` — "저장하기"와 같은 함수**를 부른다. 따로 만든 경로가 없다 |
| `cover-letter-screen.tsx`(343행) | 저장이 성공하면 화면의 정본 행 `body`도 보낸 본문으로 바꾼다. 다음 판정의 기준선이 된다 — 같은 구성으로 또 저장하지 않는다 |
| `cover-letter-panel.tsx`(47·61·223행) | `busy`에 `preparing`을 넣었다. 입력창은 **`onSent`가 불릴 때만**(턴이 실제로 나갈 때) 비운다. 저장 중에는 [보내기]가 막히고 돌기 표시만 보인다(저장은 중단할 수 없어 [중단]을 보이지 않는다) |

**같은 경로라서 그대로 적용되는 것** — `runSave`를 그대로 쓰므로 일부러 다르게 처리한 것이 없다.
- 기대 버전(읽은 `updated_at`) · CF-S7
- `slot_high_water`와 저장 응답의 `slotHighWater` 반영
- `question_id` 보존
- 반영한 제안 `applied_proposals`도 평소 저장처럼 함께 나간다

### 1.3 실패 시 동작

저장이 실패하면 `runSave`가 `false`를 돌려주고, 턴은 나가지 않는다. `onSent`가 불리지 않아 **입력창 내용이 그대로 남는다.** 사용자 말풍선도 추가하지 않는다.
오류는 평소 저장 실패와 **같은 자리·문구**에 보인다(같은 함수라서다):
- 검증 오류 → 칸 아래 오류 + 첫 오류 칸 포커스
- `too_many_questions` · `invalid_slot` → 머리 아래 한 줄
- 네트워크·기타 → 상단 바 C-06 "저장하지 못했어요 · 다시 시도"
- `stale_write` → 같은 충돌 다이얼로그. 이 경우는 **작성 상태**에서만 생기므로 CF-S7의 버튼 둘이다(아래 2절)

`beforeTurn`이 예외를 던져도 `false`로 받아 턴을 보내지 않는다.

### 1.4 성공 시

C-06 "저장됨 HH:MM"만 바뀐다. **따로 토스트가 없다** `[가정]` — `runSave`가 토스트를 띄우는 것은 정본 행을 처음 만들 때(`createRow`)뿐이고, 자동 저장은 작성 상태라 해당하지 않는다.
예외가 하나 있다: 저장 응답의 `skipped`(반영 기록을 남기지 못한 제안) 안내는 평소 저장과 같이 뜬다. 저장 결과를 알리는 것이지 "저장됐어요" 토스트가 아니다.

---

## 2. CF-S9 — 문항 설정 상태의 충돌 다이얼로그는 "새로 불러오기" 하나

| 파일·줄 | 내용 |
|---|---|
| `src/components/common/shell/page-shell.tsx` `StaleWriteDialog`(378·388·410·420행) | **`reloadOnly`** prop을 더했다(기본 `false` = 지금 동작, 버튼 둘 — S-10·S-44·S-46 작성 상태). 켜면 "내 내용으로 저장"을 그리지 않는다. "새로 불러오기"가 주 버튼이 되고 첫 포커스를 받는다. **제목·설명은 그대로**("다른 곳에서 이 자기소개서가 바뀌었어요" / "새로 불러오면 저장하지 않은 변경과 AI 반영 표시가 사라져요") `[가정]` |
| `save-version.ts` `staleDialogReloadOnly(state)`(31행) | 문항 설정 상태면 참, 작성 상태면 거짓 |
| `cover-letter-screen.tsx`(733행) | `reloadOnly={staleDialogReloadOnly(state)}` |

**걷은 죽은 코드**: 지난 라운드에 만든 `onOverwrite`의 `createRow: state === "questions"`(문항 설정 상태에서 "내 내용으로 저장"을 누르면 작성 상태로 가는 경로)를 지웠다. "내 내용으로 저장"은 이제 작성 상태에서만 닿고, `current_updated_at` 재전송(CF-S7)만 남았다.

**"새로 불러오기"가 정본을 읽어 작성 상태로 여는지 확인했다**
- 코드 흐름: `guard.reloadDiscarding` → `onDiscard` = **`clearPreserved()`**로 입력 보존 키(`preservationKey("cover_letter", …)`)를 지운다 → 페이지를 다시 읽는다 → 서버가 정본 행을 읽는다 → `doc`이 있으니 **작성 상태**로 열린다.
- **문항 설정 초안이 되살아나지 않는다 — 두 겹으로 막았다**:
  1. 복사본을 지운다.
  2. 혹시 남아도, 복원 판정 **`restorableCopy(copy.base, row.updated_at)`**(save-version.ts 40행, screen 192행)이 막는다. 문항 설정 상태에서 쓴 복사본은 `base = null`이라 정본이 생긴 뒤에는 거짓이다.
- 복원 판정은 원래 화면 안에 인라인으로 있던 비교다. 같은 규칙을 순수 함수로 떼어 테스트했다.
- 실제 새로 고침 동작은 브라우저에서 확인하지 못했다(아래 4절).

**테스트** (`save-version.test.ts`)
- **(바꿈)** 옛 "③ CF-S7 — [작성 시작]이 stale_write를 받은 뒤 '내 내용으로 저장'은 current_updated_at을 보낸다" → **"③ CF-S9 — 문항 설정 상태의 [작성 시작]이 stale_write를 받으면 다이얼로그는 '새로 불러오기'만 둔다"**
- **(추가)** "작성 상태의 stale_write는 CF-S7 그대로 버튼 둘 (CF-S8 자동 저장 실패 포함)"
- **(그대로)** "작성 상태의 '내 내용으로 저장'도 지금 버전을 보낸다 — 정본이 있는데 null을 보내는 길이 없다"
- **(추가)** "CF-S9 '새로 불러오기' 뒤 문항 설정 초안이 되살아나지 않는다" 2건
  - "문항 설정 상태에서 쓴 복사본(base = null)은 정본이 생긴 뒤에는 되살리지 않는다"
  - "같은 정본 버전에서 쓴 복사본만 되살린다 · 정본이 그 뒤 바뀌었으면 버린다 (U40-2)"

**CF-S8과의 관계**: 자동 저장이 `stale_write`를 받는 것은 대화가 있는 **작성 상태**뿐이다. 그래서 버튼 둘(CF-S7)이다 — 판정 함수 테스트로 묶었다.

---

## 3. `[UI-가정]`

| # | 가정 | 자리 |
|---|---|---|
| 40 | (원문 `[가정]`) 값만 바뀐 경우는 저장하지 않고 스냅숏으로 보낸다 | `questionStructureChanged` |
| 41 | (원문 `[가정]`) 자동 저장 성공은 C-06만 바뀌고 토스트 없음 | `runSave`(createRow가 아닐 때 토스트 없음) |
| 42 | 자동 저장 중 [보내기]는 막고 돌기 표시만 보인다. 저장은 중단할 수 없어 [중단]을 보이지 않는다 | `cover-letter-panel.tsx` |
| 43 | (원문 `[가정]`) CF-S9 다이얼로그는 S-10 제목·설명 그대로, 버튼 하나. 그 버튼("새로 불러오기")이 주 버튼 모양이고 첫 포커스를 받는다 | `StaleWriteDialog reloadOnly` |

## 4. 기획 확인 필요

**0건.**

## 5. 검증

| 명령 | 결과 |
|---|---|
| `pnpm lint` | 통과 (0 errors, 0 warnings) |
| `pnpm typecheck` | 통과 |
| `pnpm test` | **155 파일 2,512건 전부 통과** (+11: `question-form.test.ts` CF-S8 8건 · `save-version.test.ts` 순 +3 — ③을 CF-S9로 바꾸고 작성 상태 1건·복원 판정 2건을 더함) |
| `pnpm build` | 통과 |
| 브라우저 | 미확인 — 대상 화면이 로그인 게이트 뒤다. "새로 불러오기" → 작성 상태 전환과 자동 저장 → 턴 순서는 코드 흐름과 순수 함수 테스트로만 확인했다 |
