# 49 런 A3 보고 — R15 병합 해소 · 실제 경로 전환 · S-46 AI 패널

- 날짜: 2026-11-09 · 담당: frontend-engineer (A3) · 작업 디렉터리: worktree `cover-letter-ui-469976`
- 들어온 것: 백엔드 **R15**(`claude/cover-letter-backend-ef4d68`, `dba1bff`) 병합 + 기획 확인 회신 **CF-S4·CF-S5**(사용자 확정 2026-11-09)
- 내 앞 산출물: `47_frontend-engineer-A3_report.md`(커밋 `d074229`)
- **커밋하지 않았다** — 병합 커밋도 만들지 않았다(리더가 확인하고 커밋한다).

---

## 1. 병합 충돌 5개 해소

| 파일 | 어느 쪽을 정본으로 | 어떻게 |
|---|---|---|
| `src/lib/data/labels.ts` | **HEAD(내 쪽)** | `AI_FEATURE_NAMES.cover_letter = "자소서"`. 백엔드 쪽 `"자소서 문항 답변"`(U36-6)은 **CF-U3(2026-11-08 사용자 확정)으로 대체**된 값이라 쓰지 않았다. `career_description`도 표에서 뺀 상태를 유지했다. 백엔드 주석의 사실 — **`career_description`·`draft_source_ranking`의 `job_type`·사용량 `feature` 값은 이미 기록된 행 때문에 DB CHECK에 남는다(CF-A3, decisions 4.23 백엔드 7)** — 은 주석으로 살렸다 |
| `src/types/db.ts` (2곳) | **백엔드(DB 행 모양)** | ① `EvidenceOwnerType`: 백엔드 쪽 목록을 쓰고 중복된 `application_document`를 하나로 합쳤다(`draft_section`의 `@deprecated` 문장은 백엔드 것 — 마이그레이션 이름이 적혀 있다). ② 자소서 정본 타입은 **백엔드 쪽을 쓰고** 내 손 타입을 지웠다. 자세히는 아래 1.1 |
| `src/lib/data/applications.ts` | **키 이름·설명은 백엔드, mock 전용 칸은 내 쪽** | `CreateApplicationInput`의 `source_url`·`preview_job_id` 설명은 백엔드 문장(이름 규칙 R15 D12 포함)을 쓰고, **`preview_deadline`(mock 전용)**만 내 쪽을 남겼다. `source_url`을 두 번 넣던 객체 리터럴(백엔드 `source_url: null` + 내 `input.source_url`)은 **입력을 쓰는 쪽 하나**로 합쳤다 — R15가 생성 RPC에 `p_source_url`을 넘기므로 `null` 고정은 더 맞지 않는다 |
| `src/lib/data/deletion.ts` | **키 이름은 백엔드, 세는 대상은 내 쪽** | 반환 키를 `documents`·`document_chats`(계약 정본)로 바꾸고, 세는 대상은 옛 `drafts` 테이블이 아니라 **`application_documents` 1행**(0 또는 1)으로 뒀다(CF-1·CF-A14). `document_chats`는 mock `writing_chats`에 서류 대화가 없어 0이다(주석에 적었다) |
| `src/components/common/delete-confirm-dialog.tsx` (2곳) | **키는 백엔드, 문구는 내 쪽** | ① 영향 줄은 CF-A14·CF-U3대로 **"서류 {N}"을 쓰지 않는** 내 문구("…인사이트 {n}, 자소서 문항·답변, 전형 이력이…")를 유지하고 `unsavedChanges` 줄도 살렸다. ② 영향받는 자기소개서 줄은 백엔드 키 `ap.documents`를 읽고 **수를 보이지 않고 1이면 "자소서"만** 붙인다(R-CF-12). 백엔드가 쓴 "초안 {n}"은 쓰지 않았다 |

**`src/lib/contracts/account.ts`의 `applications.drafts`는 건드리지 않았다** — 셈법만 바뀌고 키 이름은 유지가 정본이다(DM §4.3).

### 1.1 `types/db.ts` 자소서 정본 타입 — 손 타입을 걷었다

- **백엔드 것을 쓴다**: `ApplicationDocument` · `ApplicationDocumentQuestion` · `ApplicationDocumentBlock` ·
  `ApplicationDocumentEvidence` · `ApplicationDocumentKind` · `DocumentBlockType` · `DocumentBlockBasis` · `DocumentTone`.
- **내 이름은 별칭으로만 남겼다**(두 정의 공존 금지): `DocumentKind = ApplicationDocumentKind` ·
  `CoverLetterQuestion = ApplicationDocumentQuestion` · `CoverLetterBlock = ApplicationDocumentBlock` ·
  `CoverLetterBlockBasis = DocumentBlockBasis` · `CoverLetterBody` · `ApplicationDocumentMeta`.
  화면 코드 수정을 줄이려는 별칭이고, 뜻은 하나다.
- **`first_copied_at`을 백엔드 행 타입에 되살렸다** — 생성 타입(`database.types.ts`)에 있는 실제 컬럼인데
  백엔드가 적은 `ApplicationDocument`에는 빠져 있었다(PRD 7장 지표, S-46 "전체 복사").
- **UI 전용 손 타입은 계약으로 갈아탔다**(먼저 `grep`해 보니 R15가 다 들여왔다):
  `ApplicationValuesPatch`·`AppliedProposalRef`·`SaveApplicationDocumentResult`·`ApplicationDocumentSaveErrorCode`·
  `JdFetchErrorCode`·`JdFetchResult`·`JdExtractPreview` **전부 삭제**하고
  `@/lib/contracts/application-document`(`SaveApplicationDocumentInput`·`SaveApplicationDocumentResult`·
  `AppliedDocumentProposal`·`DocumentApplicationValues`·`DocumentSaveErrorCode`) ·
  `@/lib/contracts/application`(`ExtractJdPreviewResult`·`PreviewSkipReason`) ·
  `@/lib/contracts/jd-fetch`(`FetchJobDescriptionResult`·`JdFetchErrorCode`)를 쓴다.
  `db.ts`에는 **"UI 전용 타입을 여기 두지 않는다"**는 주석과 그 위치만 남겼다.
  → 그 결과 저장 반환이 **camelCase 9키**가 되어 화면의 머리 다시 그리기도 `r.updatedAt`·`r.filledSlotCount`·
  `r.slotCount`·`r.applicationDocumentId`로 바꿨고, `skipped`·`applied` 처리를 새로 붙였다(아래 2.3).
- **`char_limit`은 DB가 `number | null`인 것이 정본**이다. 화면은 필수(기본 800, CF-U2)로 다루므로
  **읽을 때 좁히고 null을 막는다**: `toQuestionForms`가 `String(q.char_limit ?? "")`·
  `q.question_text ?? ""`·`q.count_basis ?? "with_spaces"`로 받고, 저장 전 검증이 빈 값을
  "글자 수를 입력해 주세요"로 막는다. mock 저장도 `q.char_limit == null`을 `invalid_fields`로 거부한다.
- `src/lib/mock/fixtures.ts`의 자소서 블록에 **`evidence: []`**를 더했다(정본 행 타입의 필수 칸, DM 2.8).

---

## 2. 실제 경로 전환 (`// 연결 대기` 제거)

`?state=` mock 분기는 **전부 유지**했다(이 프로젝트 방식).

| 함수 | 전 | 후 |
|---|---|---|
| `fetchJobPosting` | 연결 대기 | **실제** — `fetchJobDescription`(= `POST /api/job-descriptions/fetch`의 서비스)을 서버에서 바로 부른다. AI가 아니라 키·동의 없이 된다. 실패 6종은 `jdFetchError()`가 `AppError`로 던지고 화면이 **한 문구**로 받는다(CF-10) |
| `extractJdPreview` | 연결 대기 | **실제** — `extractJdPreview(createJdPreviewDeps(user.id), rawText)`. Q53-1 게이트 409는 서비스가 던지고 `withAiGuard`가 `AiRejected`로 바꿔 모달이 C-21 / C-20으로 처리한다 |
| `saveCoverLetterDocument` | 연결 대기 | **실제** — `saveApplicationDocument` server action(`save_application_document` 한 번). `applicationValues {name, deadline}`·`appliedProposals`를 함께 보내고 **반환 9키로 머리를 다시 그린다**(다시 읽지 않는다) |
| `createApplicationProject`(`source_url`·`preview_job_id`) | mock만 저장 | **실제** — R15가 10인자로 교체됐다. 반환 `preview_applied`·`preview_skip_reason`을 모달까지 올려, 미리 보기가 버려지면 **조용히 삼키지 않고** 토스트로 알린다 |
| `startCoverLetterChat` | (없었다) | **실제** — `startDocumentWritingChat`(정본 행을 만들지 않고 복귀 대상도 받지 않는다) |
| 서류 턴 SSE | (없었다) | **실제** — `POST /api/writing-chats/{id}/turns` + 새 `realCoverLetterTurn()` 리더 |
| `getCoverLetterDocument` | 연결 대기 | **연결 대기 그대로** (아래 5절 ①) |
| `listCoverLetterSlotCounts` | 연결 대기 | **연결 대기 그대로** (아래 5절 ②) |
| `markCoverLetterCopied` | 연결 대기 | **연결 대기 그대로** (아래 5절 ③) |
| `listCoverLetterChats` · `getCoverLetterChat` · `deleteCoverLetterChat` | (없었다) | **연결 대기** (아래 5절 ④) |

### 2.1 못 바꾼 셋의 이유 (코드를 안 본 추측이 아니라 확인한 사실)

- **`getCoverLetterDocument`**: `application_documents`를 **읽는** 서버 자리가 R15에 없다.
  `src/server/actions/application-document.ts`에는 `saveApplicationDocument`·`startDocumentWritingChat`
  **둘뿐**이고 `src/server/services/application-document/`에는 `save.ts`·`progress.ts`만 있다.
- **`listCoverLetterSlotCounts`**: `progress.ts`의 `loadDocumentCounts()`는 **0 또는 1**만 돌려준다
  (`filled_slot_count > 0`인 행 수). 보드 카드의 **"자소서 작성 중" ↔ "작성됨"**은
  `slot_count`와 `filled_slot_count`를 **둘 다** 알아야 갈라진다(`0 < filled < slot` / `filled = slot`).
  `ApplicationProgress.draftCount`도 그 0/1이라 유도할 수 없다. 그래서 real 분기를 만들지 않았다.
- **`markCoverLetterCopied`**: `first_copied_at`을 쓰는 RPC·액션이 없다(컬럼만 있다).

### 2.2 `?state=` mock을 R15 계약 모양으로 맞춘 것 (앞 런에 이어서)

`jd-preview-store.ts`(원문 sha256 재대조 흉내)·`too_many_questions` 400 + `details {limit, current=저장된 수}`·
`char_limit` 필수 → `invalid_fields` 경로 `questions.q_n.char_limit`·`p_client_id` 무시(`@deprecated`)·
저장 반환 9키. 이번에 더한 것: mock 저장 반환을 **camelCase**로 바꿔 계약과 같은 모양으로 만들었다.

### 2.3 저장 응답 처리 보강

`skipped[]`가 오면 **S-10 "저장 응답의 건너뜀"과 같은 문구**(`PAGE_SAVE_SKIP_COPY`)를 알리고,
`applied[]`에 담겨 돌아온 제안만 화면의 `applied` 목록에서 비운다(저장 중에 새로 채운 것은 다음 저장으로 남는다).

---

## 3. S-46 Resumate AI 패널 + `QuestionProposalCard`

`panel-pending.tsx`를 **걷어 냈다**. 새 파일:

| 파일 | 몫 |
|---|---|
| `src/lib/data/cover-letter-chat-types.ts`(+`.test.ts`) | **클라이언트 안전** 뷰 타입·문구·상한. 시작 인사 분기·첫 턴 문구(R-CF-8)·빠른 버튼 칩·`emptyCoverLetterDraft` |
| `src/lib/data/cover-letter-chats.ts` | 서류 대화 data layer — 시작(실제) · 목록·열기·삭제(연결 대기) · 턴 요청 |
| `src/lib/mock/cover-letter-turn.ts` | **mock 서류 턴 생성기**(클라이언트 안전). 질문 턴 / 초안 턴 이벤트 순서 그대로 |
| `src/lib/data/ai-stream-client.ts`에 `realCoverLetterTurn()` | 실제 SSE → 화면 이벤트 |
| `use-cover-letter-panel.ts` | 패널 컨트롤러(대화·메시지·스트리밍·상한·실패·근거 카드·임시 블록) |
| `cover-letter-panel.tsx` | 패널 셸(머리·시작 영역·메시지·칩·입력창·잠금·삭제) |
| `question-proposal-card.tsx` | **3.26 `QuestionProposalCard`** |

### 3.1 `useAiPanel`을 넓히지 않고 전용 컨트롤러를 둔 이유

`useAiPanel`은 `AiPanelTarget = "project" | "deliverable"`과 두 DTO에 맞물려 있고
`WritingChatView.project_id`가 **필수**다(서류 대화에는 프로젝트가 없다). 게다가 서류 대화를 **읽는**
계약이 없어(`AnyWritingChatDto`에 서류 분기 없음) 그 훅의 읽기 경로를 채울 수 없다. A2 소유 파일
889줄을 넓히는 것보다 **전용 컨트롤러**가 S-10·S-44를 건드리지 않아 안전하다고 보고 그렇게 했다.
패널 **모양**은 5.10 그대로이고 다른 점(제안 카드 3.26 · 복귀 대상 없음 · 초안 턴 상한)만 다르다.

### 3.2 확인된 제약을 코드로 지킨 자리

- **새 SSE 이벤트 이름을 만들지 않았다**: `turn_started` · `reply_delta` · `reply_done` · `draft_patch` ·
  `draft_flags` · `sources_selected` · `draft_started` · `draft_block` · `adjusting_length` · `draft_done` ·
  `turn_done` · `error` 뿐이고 `slot`·`questionNo`만 추가된 모양이다. **단위 테스트가 이벤트 집합을 단정한다.**
- **`sources_selected.sources[]`만 camelCase, `draft_block.block`은 snake_case**: `realCoverLetterTurn`이
  두 자리를 **그대로 통과**시키고(변환하지 않는다) mock도 같은 모양으로 만든다.
  **회귀 단정**: `sortOrder`·`experienceId`·`reuseReason`가 있고 `sort_order`가 없을 것 /
  `block_id`·`source_fact_ids`가 있고 `blockId`가 없을 것.
- **초안 상한은 "초안 턴" 6회**(문항당 아님, DM 2.9.4): 한 턴이 문항 3개를 써도 `draftCount`는 1만 늘고,
  카드·칩·안내가 **`6 − draft_count`**를 보인다. **단위 테스트가 "3문항 = 1회"를 단정한다.**
- **서류 대화는 복귀 대상이 없다**: 시작 입력에 `returnTarget`을 보내지 않고 패널에 C-10 자리를 두지 않았다.
- **CF-S1**: 저장 요청에 근거를 싣지 않는다. [반영]은 폼을 채우고 `{writingChatId, slot, rev}`만
  화면 `applied` 목록에 쌓이며, 저장이 `appliedProposals`로 올린다. **표시용 근거 칩·근거 목록은
  `sources_selected` 카드**에서 온다.
- **CF-S2**: 제안 쪽 근거 목록은 **선택 이유 한 줄을 보이고**(`rationale` / `reuseReason`), 정본 쪽
  C-11(3.10)은 **경로 한 줄뿐**이다. 두 자리 모양이 다른 것이 정상이라는 주석을 양쪽에 달았다.

### 3.3 패널·카드 구현 내용

- **머리**: "Resumate AI" + 대화 기록 목록(`Popover` — 제목·최근 활동·`message_count` / 40·끝난 대화) +
  "+ 새 대화" + ⋯("이 대화 삭제" → C-05 `writing_chat`) + ×.
- **시작 영역**: 시작 인사 4분기(답변 없음 / 일부 / 전부 / **요건 추출 전**) + 첫 턴 제안(문항 3개 이하
  "바로 초안을" / 4~5개 "먼저 1~3번 문항을", R-CF-8) + 고정 안내. **메시지 수에 세지 않는다**(A5).
- **빠른 버튼 칩**: 대화 중에도 유지(S-44 방식). 4~5문항이고 첫 초안 턴을 돌린 뒤에는
  **"남은 4~5번 문항 초안 만들기"**가 맨 앞에 붙는다. "더 간결하게"·"글자 수 맞춰 줘"는 `style` 칩
  (`shorter` / `fit_length`)으로 보낸다.
- **턴 상태**: `replying`(reply_delta + 캐럿) / `drafting`("초안 작성 중" + 임시 블록) /
  `adjusting`("글자 수 맞추는 중") / 첫 블록 전 15초면 "긴 글이라 조금 더 걸려요" / 중단 버튼.
- **초안 실패**: 임시 블록을 버리고 지금 본문·이전 제안을 유지, 카드 위 "초안을 만들지 못했어요. 지금
  본문은 그대로예요" + C-20 "다시 시도", **횟수가 줄지 않는다**.
- **제안 카드(3.26)**: 제목 "자소서 초안" + 설명 한 줄("{n}번~{m}번 문항 초안을 만들었어요…") +
  "초안 남은 횟수 n / 6" + 주 버튼 **[모두 반영 (n)]** + [자세히](기본 접힘). [자세히] 안에 문항 묶음 —
  문항 번호·문항 문장 · **제안 제목**(없으면 줄 생략) · 블록 · **출처 칩 3종**(`evidence` "커리어에서" /
  "공고 요건에서" · `source_fact_ids` "이 말에서 정리했어요" · `source_body_quotes` "지금 본문에서") ·
  검토 블록 강조 + [수락]/[빼기] · 글자 수 · **근거 목록** · [반영] · **문항별 잠금**("폼에 채움 · 저장 전").
  밖에 "확인이 필요한 내용 N개"(접힘) · 빈 부분 칩 · 뺀 문장 · 보정 안내 · 초안 상한 안내 + [새 대화].
- **반영**: 채울 블록은 `review in ('ok','accepted')`만. 제목·내용이 있는 문항이 섞이면 확인 한 줄
  (여러 개면 "답변이 있는 문항 {m}개는 바뀌어요"), 비어 있으면 확인 없이. 되돌리기 없음(OD-P2) —
  토스트 "{n}번 문항에 채웠어요" / "문항 {n}개에 채웠어요".
- **잠금**: 키 없음·키 무효면 **패널만** C-18로 잠기고 왼쪽 본문·문항 편집·저장하기·복사는 그대로 된다(CL-8).
  동의 필요는 보낼 때 C-21을 띄우고 동의 뒤 그 턴을 이어 보낸다.
- **"AI 제안 있음"**: 반영하지 않은 제안이 있는 문항 머리에 `Badge variant="ai"`. 누르면 패널을 열고
  입력창에 포커스한다.

---

## 4. 파운데이션 요청 4건 — 내가 처리했다 (기본값은 지금 동작 유지)

| # | 한 일 |
|---|---|
| ① `SaveButton` | **`disabledHint`를 만들었다가 CF-S5 확정으로 걷었다.** 대신 **`hideTooltip`**(기본 `false`)을 더해 S-46 문항 설정 상태에서 툴팁을 끈다 — 그 상태는 ⌘S가 동작하지 않고 **비활성 이유를 알리지 않는다**. S-10·S-44는 그대로 "저장하기 (⌘S)" |
| ② `LeaveGuardDialog` | **`hideSave`**(기본 `false`)를 더했다. 켜면 버튼이 **"나가기" / "계속 작성"** 둘이다. `PageShell`에 `hideLeaveSave`를 뚫어 S-46이 문항 설정 상태에서만 켠다 — 앞 런에서 화면이 **다시 그리던 2버튼 다이얼로그를 삭제**했다 |
| ③ `preservationKey` | `kind`에 **`"cover_letter"`**를 더했다(행 ID 대신 지원 프로젝트 ID를 쓰는 이유를 주석에 적었다). S-46이 손으로 만들던 키 문자열을 공용 헬퍼로 바꿨다 |
| ④ `evidence.tsx` | **`useEvidencePanelOpen()`**을 내보냈다. C-11은 화면에 `<EvidenceProvider>`가 있으면 그 패널 하나를 쓰고, 없으면 대비용 자기 패널을 띄운다 |

---

## 5. 백엔드 요청

1. **`application_documents` 읽기** — S-46이 두 상태를 판정하려면 정본 행을 읽어야 한다. 지금은
   `getCoverLetterDocument`의 real 분기가 없어 **실제 환경에서 S-46이 항상 문항 설정 상태로 열린다.**
   `getApplicationDocument(applicationProjectId, documentKind)` 서버 액션(또는 서비스 읽기) 하나가 필요하다.
   필요한 칸: `id`·`updated_at`(= 다음 저장의 `expectedUpdatedAt`)·`body.questions[]`·`filled_slot_count`·
   `slot_count`·`meta.tone`·`first_copied_at`.
2. **S-39 카드용 `slot_count` + `filled_slot_count`** — `loadDocumentCounts()`는 0/1만 준다. 카드의
   **"자소서 작성 중" / "작성됨"**(CF-A14)은 둘 다 필요하다. `loadDocumentCounts`가
   `Map<apId, {slotCount, filledSlotCount}>`를 돌려주거나 `ApplicationProgress`에 두 수를 더해 주면
   `listCoverLetterSlotCounts`의 real 분기를 바로 붙인다.
3. **`first_copied_at` 기록** — "전체 복사"가 처음 눌린 시각(PRD 7장 지표)을 쓰는 RPC·액션이 없다.
   `mark_application_document_copied(p_application_project_id, p_document_kind)` 같은 자리가 필요하다.
4. **서류 대화 읽기 계약** — R15는 **쓰는 쪽(시작·턴·저장)만** 들여왔다. 읽는 쪽이 없다:
   - `AnyWritingChatDto`가 `project` · `project_deliverable` 두 값뿐이다(서류 분기 없음).
   - `getWritingChat`·대화 기록 목록(`listProjectWritingChats` 류)에 서류 분기가 없다.
   - 서류 대화 삭제 자리도 없다.
   → 그래서 **새로 고침하면 대화가 사라진다**(이번 방문에 시작한 대화는 패널이 들고 있어 돈다).
   `CoverLetterWritingChatDto`(+ `listDocumentWritingChats`·`deleteDocumentWritingChat`)가 필요하다.
   계약 파일은 쓰지 않는 영역이라 내가 만들지 않았다.
5. **`get_deletion_impact` 반환 키 `document_chats`** — 실제 경로는 들어왔는데 mock은 서류 대화 행이
   없어 0이다(④가 풀리면 mock도 세게 고친다).

---

## 6. 쓴 `?state=` 키 (앞 런 + 이번에 켜진 것)

- **S-13** `/applications`: `empty` · `loading` · `error` · `unauth` · `not-found`
- **S-14** 모달(`?new=1&state=`): `step1` · `fetching` · `fetch-failed` · `extracting` · `extract-failed` ·
  `step2` · `close-confirm` · `creating` · `create-failed` · `invalid-source-url`
  (+ 공통 `consent-required` · `key-invalid` · `key-missing`)
- **S-46 문항 설정 상태**: `questions` · `questions-invalid` · `questions-max` · `extracting` ·
  `extract-failed` · `extract-failed-input` · `extract-failed-wait`
- **S-46 작성 상태**: (기본) · `empty-answers` · `save-failed` · `save-conflict` · `too-many-questions` ·
  `not-found` · `unauth` · `loading` · `error`
- **S-46 패널 — 이번에 켜졌다**: **`draft-stream`**(마운트 직후 초안 턴 재생) ·
  **`draft-failed`**(초안 실패 + C-20) · **`draft-limit`**(6회 소진 → 안내 + [새 대화]) · `ai-locked`(C-18)
- **S-46 탭**: `?tab=jd` / `?tab=insight` + S-15·S-16의 기존 키 전부 + `?edit=1&from=&cause=`
- 패널이 연 대화는 `?chat=`에 남는다(`replaceState`만 — 서버 재렌더로 폼을 잃지 않게)

---

## 7. 기획 확인 회신 반영 (CF-S4 · CF-S5 · 6문항)

| 확정 | 반영 |
|---|---|
| **CF-S4** | S-46 머리 공고 항목의 `dt` 라벨을 **"공고" → "채용 공고"**로 바꿨다(탭 이름과 같은 용어). 링크 글자 "JD 상세"와 동작(`source_url` 새 창 / 없으면 채용 공고 탭)은 그대로 |
| **CF-S5** | 비활성 "저장하기"의 이유를 **알리지 않는다.** 만들어 둔 `disabledHint` prop을 **걷어 내고** 그 자리에 `hideTooltip`을 뒀다 — 문항 설정 상태에서는 툴팁·안내 줄·`aria-describedby`가 **하나도 없다**. 디자인 시스템에 `[가정]`으로 있던 비활성 툴팁 문구는 이 버튼에 쓰지 않았다 |
| **6문항 이상 정본 없음** | 화면을 그대로 뒀다 — "+ 문항 추가"는 `forms.length >= 5`면 비활성이고 **영구 비활성 분기를 만들지 않았다** |

---

## 8. `[UI-가정]` 목록 (이번에 더한 것만. 앞 런 20건은 47 보고서에 있다)

| # | 가정 | 자리 |
|---|---|---|
| 21 | 패널 입력창 자리 표시 "문항에 쓰고 싶은 경험이나 요청을 적어 주세요" | `cover-letter-panel.tsx` |
| 22 | 대화 기록 목록은 `Popover`(머리 아이콘) — 명세가 "대화 기록 목록 아이콘"만 정한다 | 같음 |
| 23 | "초안 턴을 돌리는 칩" 판정 = 라벨에 "초안 만들기"가 있거나 "더 간결하게"·"글자 수 맞춰 줘" | 같음 |
| 24 | 시작 인사 4분기의 실제 문장(명세는 분기 조건만 정한다) | `cover-letter-chat-types.ts` |
| 25 | 반영 확인 문구 "지금 쓴 답변은 제안으로 바뀌어요. 되돌릴 수 없어요"(한 문항일 때) | `question-proposal-card.tsx` |
| 26 | 보정 안내 "글자 수를 맞추려고 한 번 더 다듬었어요. 제출 전에 글자 수를 확인해 주세요" | 같음 |
| 27 | 출처 칩 `evidence` 종류의 글자 — `jd_requirement`면 "공고 요건에서", 그 밖은 "커리어에서" | 같음 |
| 28 | 다른 대화 열기를 누르면 토스트 "다른 대화를 여는 기능은 아직 연결되지 않았어요"(읽기 계약 대기) | `use-cover-letter-panel.ts` |
| 29 | mock 턴의 지문·간격·근거 2개 구성 | `lib/mock/cover-letter-turn.ts` |
| 30 | `preview_deadline`(mock 전용 입력) — real 경로는 서버가 작업 행 `output`에서 읽는다 | `lib/data/applications.ts` |

---

## 9. 기획 확인 필요

**0건.** 앞 런에 올린 3건은 CF-S4·CF-S5·"6문항 경로 없음"으로 모두 닫혔다(7절). 이번에 새로 생긴 것도 없다 —
패널·제안 카드는 UX v5.20 S-46과 design-system 3.26이 정한 범위 안에서 만들었고, 막힌 자리는 전부
**기획 공백이 아니라 계약 공백**이라 5절 "백엔드 요청"에 올렸다.

### 파운데이션 쪽에 남겨 둔 제안 하나 (요청은 아니다)

C-15 공용 `SourceChip`에 **`evidence` 종류**("커리어에서" / "공고 요건에서")가 없어 3.26 카드가 같은 칩
모양(`CHIP_CLASS`)으로 직접 그렸다. 공용에 그 종류를 더하면 S-44와 한 자리에서 관리된다 — S-10·S-44가
쓰는 세 종류를 건드리지 않아야 해서 이번에는 손대지 않았다.

---

## 10. 검증

| 명령 | 결과 |
|---|---|
| `pnpm lint` | **통과** (0 errors, 0 warnings) |
| `pnpm typecheck` | **통과** |
| `pnpm test` (전체) | **149 파일 2,433건 전부 통과** — **앞 런의 서버 통합 테스트 17건 실패가 병합으로 해소됐다**(`src/server/services/{account,application,insight}.integration.test.ts`). 서버 테스트는 손대지 않았다. 신설 테스트 2파일: `question-form.test.ts` 9건(앞 런) + **`cover-letter-chat-types.test.ts` 8건**(문구 분기 + 계약 모양 회귀 단정 — 이벤트 이름 집합 · camelCase/snake_case 구분 · **"초안 턴 6회"**) |
| `pnpm build` | **통과** (`/applications` · `/applications/[id]/cover-letter`) |
| 브라우저 | **대상 화면은 여전히 확인하지 못했다.** `(dashboard)/(gated)`가 `ConsentGate`(Google 로그인) 뒤라 curl·헤드리스로 못 들어간다(`/applications`는 `sign-in`으로 떨어진다). 확인한 것: **`/dev/states?state=cover-letter` 렌더 통과** — 패널 링크 3개(`draft-stream`·`draft-failed`·`draft-limit`)까지 그려진다. 로그인 세션이 있는 환경에서 QA의 브라우저 패스가 필요하다 |

### 병합 해소가 맞는지 가린 방법

17건 실패는 병합 전 "계약이 `drafts`·`draft_sections`를 필수로 보는데 DB는 `documents`를 준다"였고,
병합으로 계약이 `cascade.documents`로 바뀌면서 자동 해소됐다. 내가 고친 `deletion.ts`는 **mock 분기의
세는 대상**이고 real 분기는 백엔드 키를 그대로 읽으므로, 통과는 병합 덕분이지 내 수정 덕분이 아니다
(확인: 서버 테스트 파일은 한 줄도 바꾸지 않았다).
