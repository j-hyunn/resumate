# 46 런 A0 파운데이션 보고 — 자기소개서 관리 흐름 재설계 (CF-*)

- 날짜: 2026-11-09 · 담당: frontend-engineer (A0) · 작업 디렉터리: worktree `cover-letter-ui-469976`
- 기준 판: PRD v4.17 · 플로우 **v5.20** · AI v4.15 · 데이터 모델 **v4.15** · 디자인 시스템 v5.12
  + 기획 PR #68 **CF-S1**(문항 근거 원천 = 초안 제안의 `sources[]`, 화면은 근거를 저장 요청에 싣지 않는다)
- 범위: decisions 4.23 **UI 4·6·7** + 그에 필요한 공용 자리(라우트·리다이렉트·타입·mock 데이터 계층·`?state=` 키). **화면 본체(S-13·S-14·S-46·S-39)는 만들지 않았다** — A3·A4 몫.
- 커밋하지 않았다 (리더가 한다).

---

## 1. 지운 것

### 페이지 (라우트)

| 파일 | 화면 | 근거 |
|---|---|---|
| `src/app/(dashboard)/(gated)/applications/[id]/page.tsx` | S-31 지원 프로젝트 허브 | UX v5.20 S-31 폐기 (CF-7) |
| `.../applications/[id]/drafts/page.tsx` | S-17 서류 초안 목록 | UX v5.20 S-17 폐기 (CF-1·CF-7) |
| `.../applications/[id]/drafts/[draftId]/page.tsx` | S-19 초안 편집기 | UX v5.18 S-19 폐기 (CL-7) |
| `.../applications/[id]/drafts/[draftId]/questions/page.tsx` | 옛 S-18 문항 설정(별도 화면) | S-46의 한 상태로 바뀜 (CF-A11) |
| `.../applications/[id]/jd/page.tsx` | S-15 | S-46 "채용 공고" 탭이 됐다 (CF-7·CF-A12) |
| `.../applications/[id]/insight/page.tsx` | S-16 | S-46 "인사이트" 탭이 됐다 (CF-7·CF-A12) |
| `.../applications/new/page.tsx` | S-14 전체 페이지 | 2단계 모달이 대체 (CF-8) — 주소는 `/applications?new=1`로 308 |

> S-45 경력기술서 작성 화면은 **코드로 구현된 적이 없다**(`career-description` 라우트 없음) — 리다이렉트만 새로 넣었다.

### 컴포넌트·헬퍼

| 파일 | 어느 화면 몫이었나 | 근거 |
|---|---|---|
| `src/components/applications/hub-header.tsx` | S-31 헤더(이름·마감일 인라인 수정·단계 칩·삭제) | S-31 폐기. 제목·마감일은 S-46 머리로 갔다 |
| `src/components/applications/drafts-view.tsx` | S-17 목록 + 경력기술서 설정(포함 항목 트리·문체·AI-11) | S-17·경력기술서 폐기 |
| `src/components/applications/draft-editor.tsx` | S-19 블록 편집기 + AI-03/AI-04 스트리밍 | S-19 폐기, 초안은 S-46 패널 초안 턴이 만든다 (CL-2·CL-6) |
| `src/components/applications/source-tree.tsx` | S-17 포함 항목 트리 · S-19 문항 근거 변경 | 새 C-11은 **읽기 전용 목록**(CL-5) — 고르는 트리가 없다 |
| `src/components/applications/sources-used.tsx` | 옛 C-11(편집형) + `CareerDescriptionSources` | 같음 |
| `src/components/applications/source-label.ts`(+test) | `draft_section_sources.source_label` 표시 | 테이블 폐기 (DM v4.13 CL-3) |
| `src/components/applications/draft-entry.ts`(+test) | S-17 "새 경력기술서" 진입 단계(Q53-4) | S-17·경력기술서 폐기 |
| `src/components/applications/remote-runs.ts`(+test) | S-19 원격 생성 대상 판정 | S-19 폐기 |

### 코드 안에서 지운 자리

- `src/components/applications/labels.ts`: `DRAFT_TYPE_LABELS` · `DRAFT_STATUS_LABELS` · `SOURCE_ROLE_LABELS` · `SOURCE_ORIGIN_LABELS` · `SELECTION_ORIGIN_LABELS` · `OMITTED_*` 삭제(쓰는 화면이 없어졌다). 남긴 것: `REQUIREMENT_CATEGORY_*` · `IMPORTANCE_HIGH_LABEL` · `COUNT_BASIS_LABELS` · `GAP_ACTION_LABELS`.
- `src/app/(dashboard)/(gated)/applications/_lib/actions.ts`: `rankDraftSourcesAction`(AI-11) · `createCareerDescriptionAction` · `createCoverLetterAction` · `deleteDraftAction` · `prepare/finalizeCareerDescriptionAction` · `prepare/finalizeCoverLetterSectionAction` · `saveEditedContentAction` · `setSectionSourcesAction` · `markDraftCopiedAction` 삭제.
- `src/components/common/delete-confirm-dialog.tsx`: `DeleteTarget`의 `kind: "draft"`와 그 영향 줄 삭제(C-05 "서류" 행 폐기, CF-A9).
- `src/lib/preview-state.ts`: `stopping`(S-19 중단 대기) 삭제.
- `src/components/common/dev-state-gallery-v53.tsx`: Q53-4(S-17 요건 없는 JD 3줄) · Q53-7(작성 중 경력기술서) 링크 삭제.

지우기 전에 `grep`으로 참조를 모두 확인하고, 남은 참조는 전부 아래 2·3절대로 고쳤다.

---

## 2. A3·A4에게 넘기는 재사용 자리 (지우지 않았다)

| 파일 | 무엇 | A3·A4가 할 일 |
|---|---|---|
| `src/components/applications/jd-view.tsx` | S-15 본체 — 공고 원문 패널·요건 목록(`importance = high` "핵심")·"요건 정리하기"·추출 실패 C-20 | **S-46 "채용 공고" 탭**에 그대로 넣는다. 원문 패널 머리에 "원래 공고 열기"(`source_url`) 링크 추가 (CF-A16) |
| `src/components/applications/jd-raw-edit.tsx` · `jd-raw-edit-state.ts`(+test) | Q53-2·Q53-11 공고 원문 수정(조건·저장·거부·"요건이 있는 공고" 안내) | 탭 안의 자기 "저장"/"취소"로 쓰고 상단 바 "저장하기"와 섞지 않는다 (CF-A12 `[가정]`) |
| `src/components/applications/insight-view.tsx` · `insight-parse.ts` | S-16 본체 — 생성·다시 생성·C-18·C-20·C-09·근거 칩·보완점 → C-23 | **S-46 "인사이트" 탭**에 그대로 넣는다 |
| `src/components/applications/extract-first.tsx` | 요건 선행 추출(`useRequirementsFirst`) — 진행 문구·"이미 정리하고 있어요"·C-20·입력 원인 이동 | S-46 문항 설정 [자기소개서 작성 시작]·패널 대화 열기·인사이트 생성이 쓴다. `jdEditFrom`을 `{ from: "insight" \| "cover_letter" }`로 바꿔 뒀다 |
| `src/components/applications/cover-letter-questions.tsx` | 문항 카드(문항 문장·글자 수 제한·기준·메모 300자·A12 안내·삭제 확인·추가 상한) | **S-46 문항 설정 상태로 다시 쓴다.** 지금은 폐기된 `draft_sections` 행 단위 자동 저장이라 `application_documents.body.questions[]` + 페이지 단위 저장으로 바꿔야 한다. 상한은 `COVER_LETTER_MAX_QUESTIONS`(5)로 이미 돌려놨다 |
| `src/components/applications/application-new-form.tsx` · `form-draft.ts`(+test) | S-14 ①·② 입력 검사(200자/24,000자 경고·회사명·포지션 200자)·이탈 보존·Q53-1 게이트 처리 | **2단계 모달로 다시 쓴다.** 페이지 라우트는 지웠으니 S-13·S-39 위 모달에서 이 조각을 쓴다 |
| `src/components/applications/application-list.tsx` | S-13 행·필터·행 메뉴 | **재작성**: 단계 칩·정렬 선택·기능 진행·"보드로 보기" 제거, "최근 작성 순" 표기 (UI 1) |
| `src/components/applications/shared.tsx` | `useDeleteApplication`(C-05) · `AutoRefresh` · `JobInline` · `useRestoreReturnParams` | 그대로 쓴다 |
| `src/components/career/ai-panel/**` · `star-proposal-card.tsx` · `src/components/common/{source-chip,evidence,streaming,doc-markdown-editor,save-status}.tsx` | AI 패널·제안 카드·출처 칩(C-15)·근거(C-01·C-02)·C-04 스트리밍·마크다운 편집기·C-06 | S-46 패널·제안 카드·자소서 탭이 S-10·S-44와 같은 조각을 쓴다 (CL-A7·CL-A1) |
| `src/app/(dashboard)/(gated)/applications/_lib/{jd-state,gate-preview}.ts` | `?state=` → JD 실행 상태 / C-09·대화 실패 미리보기 | S-46 하위 폴더(`[id]/cover-letter/`)에서 `../../_lib/`로 그대로 import 된다 |

---

## 3. 라우트·리다이렉트

### `src/lib/routes.ts`

| 전 | 후 |
|---|---|
| `applications()` | 그대로 `/applications` (S-13) |
| `applicationNew({from})` → `/applications/new` | **`/applications?new=1[&from=board]`** — 모달을 연 채로 S-13을 연다 `[가정]` |
| `application(id)` (S-31) | **삭제** |
| `applicationJd(id, …)` (S-15) | **삭제** → `coverLetter(id, { tab: "jd", edit, from, cause })` |
| `applicationInsight(id)` (S-16) | **삭제** → `coverLetter(id, { tab: "insight" })` |
| `applicationDrafts(id)` · `draftQuestions(id, draftId)` · `draft(id, draftId)` | **삭제** |
| — | **신설 `coverLetter(id, { tab?, chat?, edit?, from?, cause? })` → `/applications/{id}/cover-letter`** (S-46 한 주소 두 상태, 서류 id는 주소에 없다 — CL-A10·CF-A2) |

`from`의 값은 v5.20에 맞춰 `"insight" | "cover_letter"`다(옛 `"drafts" | "questions"` 폐기) — "{인사이트 / 자소서} 탭으로 돌아가기"(CF-A12).

### `src/lib/legacy-redirects.ts` → `next.config.ts` (모두 308, 안내 없음)

| 옛 주소 | 화면 | 간 곳 |
|---|---|---|
| `/applications/new` | S-14 전체 페이지 | `/applications?new=1` |
| `/applications/{id}/jd` | S-15 | `/applications/{id}/cover-letter?tab=jd` |
| `/applications/{id}/insight` | S-16 | `…/cover-letter?tab=insight` |
| `/applications/{id}/drafts[/{draftId}[/questions]]` | S-17 · S-19 · 옛 문항 설정 | `…/cover-letter` |
| `/applications/{id}/career-description` | S-45 | `…/cover-letter` |
| `/applications/{id}/cover-letter/questions` | v5.18 문항 설정 | `…/cover-letter` |
| `/applications/{id}/interview[/…]` | S-20·S-33·S-22 (RM-1) | `…/cover-letter` — R14가 보내던 S-31이 폐기됐다 (**MRG-UX-1 `[가정]`**) |
| `/interviews[/…]` | S-37 (RM-1) | `/applications` (그대로) |
| `/applications/{id}` | S-31 허브 | `…/cover-letter` (규칙 순서상 마지막) |

규칙 순서: `/applications/new`가 `/applications/:id`보다 **먼저** 와야 한다(`:id`가 "new"에도 맞는다). 소스 가드 테스트 `src/lib/legacy-redirects.test.ts`를 v5.20 기준으로 다시 썼다(Next의 실제 matcher로 14경로 검증). `src/lib/routes.test.ts`의 메뉴 판정도 `coverLetter`로 갱신.

---

## 4. 라벨·기능 이름 (decisions 4.23 UI 6·7)

- **`AI_FEATURE_NAMES`** (`src/lib/data/labels.ts`): `career_description`·`draft_source_ranking` 제거, **`cover_letter: "자소서"`** (CF-U3). FL-19 "{원래 기능}으로 돌아가기"가 이 표를 쓴다.
- **C-18 진입점** (`src/components/common/ai-lock.tsx`): `draft` 설명 "커리어를 바탕으로 **자소서 문항 초안**을 써 드려요", 기본 기능 `draft → cover_letter`(경력기술서가 없어 분기할 것이 없다).
- **C-05** (`delete-confirm-dialog.tsx`):
  - `delete_results` 범위 "인사이트는 해당 버전, **자기소개서는 해당 문항의 답변 본문만**(문항·글자 수 제한·메모·제목은 남음) 삭제돼요" (v5.20 문구 그대로)
  - 자기소개서 삭제 영향 줄 "JD·요건, 인사이트 {N}, **자소서 문항·답변**, 전형 이력이 함께 삭제돼요. 커리어 데이터는 그대로예요" — **"서류 {N}" 삭제**(CF-A14)
  - 영향받는 자기소개서 줄은 "인사이트 {N} **· 자소서**"(수 없음, R-CF-12 `[가정]`)
  - `kind: "draft"` 폐기, `application_project` 대상에 `unsavedChanges?`를 더해 "저장하지 않은 수정도 함께 사라져요" 한 줄을 S-46이 켤 수 있게 했다 (CF-A9 `[가정]`)
- **복귀 대상** (`types/db.ts` `ReturnTargetFeature`, `return-banner.tsx`): `insight | cover_letter` 두 값, 라벨 "인사이트" / "자소서".
- **이름 규칙** (CF-A7): `composeCoverLetterName(company)` → **"{기업 명} 자기소개서"**(100자 초과는 기업 명 앞쪽을 남기고 줄임)를 `labels.ts`에 두고, mock 생성·추출 성공·추출 실패 세 경로가 모두 쓴다. 기업 명이 없으면 `defaultApplicationName()` "새 자기소개서 (YYYY-MM-DD)". **기존 이름("회사명 – 포지션명")은 바꾸지 않는다.**
- 그 밖의 "경력기술서"·"자소서 문항 답변" 잔재 문구: `data-gate.tsx` · `shared.tsx` · `return-target.ts` · `ai-error-notice.tsx` · `mock/writing-chat-turn.ts` · `lib/data/evidence.ts`(근거 경로 "채용 공고 › 요건", "자소서 › 문항 메모") 정리.
- **남긴 enum 값**: `career_description`·`draft_source_ranking`은 `AiJobType`·`AiUsageFeature`·`DraftType`에 그대로 둔다 — decisions 4.23 백엔드 7 "과거 행 보존용으로 CHECK에 남김". S-42 표는 `usage-display.ts`가 두 값을 "자기소개서 작성 AI 채팅" 한 줄로 합쳐 보인다(AI 명세 기능 이름, CF-U3로 변경 없음).

---

## 5. mock 데이터 계층

새 파일 **`src/lib/data/cover-letters.ts`** (+ 상수 `src/lib/data/cover-letter-defaults.ts`).
**CF-S1 준수**: 저장 입력에 근거 목록이 없다 — `applied_proposals: [{writing_chat_id, slot, rev}]`만 보내고 `evidence_links`는 서버가 제안에서 만든다.

| 함수 | 쓰는 화면 | real 분기 |
|---|---|---|
| `listCoverLetters()` → `CoverLetterListRow[]` (이름·포지션·만든 날·마감일, `created_at desc`) | S-13 | **연결됨** — 이미 와이어된 `listApplicationProjects()` 위에서 모양만 줄였다 |
| `fetchJobPosting(url)` → `{rawText, companyName, positionTitle}` | S-14 ① | **연결 대기** `POST /api/job-descriptions/fetch` (DM v4.15 11.10) |
| `extractJdPreview(rawText)` → `{previewJobId, companyName, positionTitle, deadline, requirementCount}` | S-14 ① | **연결 대기** `POST /api/job-descriptions/extract-preview` (DM 2.6.2). mock은 Q53-1 게이트를 그대로 판정한다(키 없음/무효/동의 필요) |
| `getCoverLetterDocument(apId)` → `ApplicationDocument \| null` | S-46 두 상태 판정 | **연결 대기** `application_documents` select (DM 2.7.3) |
| `saveCoverLetterDocument(input)` → `SaveApplicationDocumentResult` | S-46 "저장하기" · [자기소개서 작성 시작] | **연결 대기** `save_application_document(… p_application_values)` (DM 2.7.3·v4.15). mock은 `too_many_questions`·`stale_write`·이름 되돌리기·마감일 비우기까지 재현 |
| `listCoverLetterSlotCounts()` → `Record<apId, {slot_count, filled_slot_count}>` | S-39 카드 | **연결 대기** (DM 2.7.3 생성 컬럼) |
| `markCoverLetterCopied(apId)` | S-46 "전체 복사" | **연결 대기** `first_copied_at` (DM 2.7.3) |
| 순수 헬퍼 (previewOr 밖): `seedCoverLetterQuestions()` · `newCoverLetterQuestion(n)` · `coverLetterScreenState(doc)` · `filledSlotCount(body)` · `countAnswerChars(body, basis)` · `coverLetterProgressLabel(counts)` | S-46 · S-39 | — |

- `createApplicationProject`(기존·와이어됨)에 **`source_url`·`preview_job_id`** 입력을 더했다. mock만 저장하고 real 분기(`create_application_project`)에는 인자가 없다 → 7절 백엔드 요청.
- 상수(`cover-letter-defaults.ts`): `COVER_LETTER_MAX_QUESTIONS = 5`(CF-5) · **`COVER_LETTER_DEFAULT_CHAR_LIMIT = 800`**(CF-U2, 시안의 600 아님) · 범위 1~10,000 · 기본 기준 `with_spaces` · 상한 표(문항 1,000 / 제목 100 / 메모 300 / 답변 8,000) · 기본 3문항 문구(OD-D1 K-28) · 포부 문항 메모 힌트.
- **픽스처**: `MockDb.application_documents` 신설 + 2행 — ap 1 = 3문항 중 2개 채움(S-39 "자소서 작성 중", 제목 1개), ap 2 = 3문항 전부 채움("자소서 작성됨", `first_copied_at` 있음). ap 3~8은 행이 없어 S-46이 **문항 설정 상태**로 열린다. `IDS.adoc(n)`·`IDS.clq(n)` 추가.
- **서버 액션**(`applications/_lib/actions.ts`)에 얇은 래퍼를 미리 뒀다: `fetchJobPostingAction` · `extractJdPreviewAction`(`withAiGuard`) · `getCoverLetterDocumentAction` · `saveCoverLetterDocumentAction` · `markCoverLetterCopiedAction` · `listCoverLetterSlotCountsAction`.

---

## 6. 타입 (`src/types/db.ts`)

- **신설**(DM 2.7.3·2.6.2): `DocumentKind = "cover_letter"` (1값, CF-A2) · `CoverLetterQuestion`(`answer_title` · `char_limit` · `count_basis` · `user_note` · `blocks[]` · `slot`/`question_id`/`sort_order`) · `CoverLetterBlock`(`basis` 3값 포함 `user`) · `CoverLetterBody` · `ApplicationDocumentMeta` · **`ApplicationDocument`**(`filled_slot_count`·**`slot_count`**·`first_copied_at`) · `ApplicationValuesPatch`{name, deadline} · `AppliedProposalRef` · `SaveApplicationDocumentResult` · `ApplicationDocumentSaveErrorCode`(+`too_many_questions`) · `JdFetchResult` · `JdFetchErrorCode`(`fetch_*` 5종 + `invalid_source_url`) · `JdExtractPreview`.
- **고친 것**: `EvidenceOwnerType`에 `application_document` 추가(`draft_section`은 `@deprecated`) · `ReturnTargetFeature`에서 `career_description` 제거 · `JobDescription`에 `source_url?: string | null`.
- **생성 타입 대기**(손으로 적은 자리): `application_documents` 테이블 전체와 `job_descriptions.source_url`. 두 개 모두 `database.types.ts`에 없다 — 마이그레이션 배포 뒤 `Row<"application_documents", …>`로 묶어야 한다(백엔드 요청 ①·②).

---

## 7. 백엔드 요청 (R15 커밋 전 — 연결 대기)

1. **`job_descriptions.source_url`** 신설(text null, http(s) ≤ 2,048) + 생성 타입 재생성 → UI의 `source_url?` optional을 필수로 좁힌다. (decisions 4.23 백엔드 1)
2. **`application_documents`** 테이블(+ `slot_count` 생성 컬럼·`answer_title`·`document_kind` 1값) 배포 + 생성 타입 → UI의 손으로 적은 타입을 `Row<>`로 교체. (백엔드 10)
3. **`create_application_project`에 `p_source_url`·`p_preview_job_id`** 추가, 반환 `preview_applied`·`preview_skip_reason`, `invalid_source_url`(400). UI는 `CreateApplicationInput.source_url`/`preview_job_id`를 이미 보낼 준비가 돼 있다. (백엔드 2)
4. **`POST /api/job-descriptions/fetch`** — 응답 `{rawText, companyName, positionTitle}`, 실패 `fetch_blocked`·`fetch_timeout`·`fetch_too_large`·`fetch_too_short`·`fetch_failed`·`invalid_source_url`. (백엔드 8)
5. **`POST /api/job-descriptions/extract-preview`** — 응답 `{previewJobId, companyName, positionTitle, deadline, requirementCount}`, Q53-1 게이트 409(`key_invalid`·`ai_consent_required`). (백엔드 8)
6. **`save_application_document(… p_application_values {name, deadline})`** + 거부 `too_many_questions`(400, `{limit: 5, current: n}`) · `field_too_long` · `stale_write`. 반환은 DM v4.15 모양 그대로. (백엔드 10·13)
7. **`get_deletion_impact('application_project', id)` 반환 키** — 지금 로컬 DB는 `cascade.documents`·`document_chats`를 돌려주는데 커밋된 zod 계약(`src/lib/contracts/career.ts`)은 `drafts`·`draft_sections`를 필수로 본다 → `src/server/services/*.integration.test.ts` 17건이 깨져 있다(9절). UI는 `affected_results.by_application_project[].drafts`(0~1)를 "자소서" 표시에만 쓰므로, 키 이름이 `documents`로 바뀌면 한 줄만 고치면 된다 — **이름을 알려 주면 맞춘다.**
8. **폐기 테이블 잔재**: `src/lib/data/drafts.ts`·`drafts-real.ts`·픽스처 `drafts`/`draft_sections`/`draft_section_sources`와 `getDraftDeletionImpact`는 화면이 더 쓰지 않는다(문항 설정 임시 3개 액션만 남음). `drafts` 3테이블 drop(11.8 4단계) 때 함께 지우자 — UI 쪽은 그때 한 번에 걷는다.
9. `ApplicationSummary.draft_count`(real 분기 `item.progress.draftCount`)는 화면에서 쓸 곳이 없어졌다(CF-A14). S-39가 `listCoverLetterSlotCounts()`로 옮겨 가면 응답에서 빼도 된다.

---

## 8. `[UI-가정]` 목록 (순수 화면 세부)

| # | 가정 | 자리 |
|---|---|---|
| 1 | `/applications/new`는 `/applications?new=1`로 보내고 모달을 연 채로 연다(UX S-14 `[가정]`을 그대로 구현). `from=board`는 옛 주소에서 온 경우의 복귀 표시 | `routes.applicationNew`, `legacy-redirects.ts` |
| 2 | 옛 면접 하위 주소 → S-46(MRG-UX-1 `[가정]`), `/interviews`는 S-13 그대로 | `legacy-redirects.ts` |
| 3 | 탭 주소는 `?tab=jd` / `?tab=insight`, 연 대화는 `?chat=` (UX `[가정]`) | `routes.coverLetter` |
| 4 | 공고 원문 수정 진입의 복귀 표시 `from`은 `insight` / `cover_letter` 두 값 | `routes.coverLetter`, `extract-first.tsx` |
| 5 | 글자 수 기준 기본값 `with_spaces` | `cover-letter-defaults.ts` |
| 6 | 영향받는 자기소개서 줄의 "자소서"는 `drafts > 0`일 때만 붙이고 수를 보이지 않는다 | `delete-confirm-dialog.tsx` |
| 7 | real 분기가 없는 데이터 계층 함수는 `wiring_pending`(503)으로 거부해 화면이 ST-ERROR로 떨어지게 한다 | `cover-letters.ts` `notWired()` |
| 8 | mock `fetchJobPosting`은 주소에 `fail`·`blocked`·`timeout`이 들어가면 실패로 재현한다(미리 보기용) | `cover-letters.ts` |
| 9 | S-14·S-46의 `?state=` 키 이름(5절·9절 표) | `dev-state-gallery-v53.tsx`, `screen-status.md` |

---

## 9. `?state=` 키

`/dev/states?state=cover-letter`에 새 섹션 "자기소개서 흐름 (v5.20 CF-*) 화면별 미리보기"를 더했다(링크 33줄). `docs/ui/screen-status.md` 머리에도 표로 적었다.

- **S-13** `/applications`: `empty` · `loading` · `error`
- **S-14** 모달(`?new=1&state=`): `step1` · `fetching` · `fetch-failed` · `extracting` · `extract-failed` · `step2` · `close-confirm` · `creating` · `create-failed` · `invalid-source-url` (+ 공통 `consent-required` · `key-invalid` · `key-missing`)
- **S-46** `/applications/{id}/cover-letter`
  - 문항 설정 상태: `questions` · `questions-invalid` · `questions-max` · `extracting` · `extract-failed`
  - 작성 상태: `writing` · `empty-answers` · `save-failed` · `save-conflict` · `too-many-questions` · `not-found` · `unauth`
  - 패널: `draft-stream` · `draft-failed` · `draft-limit` · `ai-locked`
  - 탭: `?tab=jd` / `?tab=insight`는 S-15·S-16의 기존 키(`raw-edit`·`raw-save-failed`·`raw-saved`·`raw-edited` 등)를 그대로 쓴다
- **삭제**: `stopping`(S-19, `PREVIEW_STATES`에서도 뺐다) · `no-requirements`·`no-requirements-consent`·`no-requirements-key-invalid`(S-17). `finalizing`·`wait-jd`는 C-04·요건 선행 추출 공통 키라 남긴다.

---

## 10. 기획 확인 필요

없다 — 이번 범위(라우트·용어·타입·mock 계층·상태 키)에서 v5.20·DM v4.15·decisions 4.23이 정하지 않은 자리를 만나지 않았다. 8절은 모두 순수 화면 세부다.

한 가지만 리더에게 **확인 요청**(기획 변경은 아니다): decisions 4.23 UI 표는 "폐기 주소 처리"(UI 4)를 A3에 적었고 내 지시서는 A0에 적었다. 라우트·리다이렉트·폐기 화면 삭제를 **A0에서 다 끝냈으니** A3는 화면 본체만 만들면 된다.

---

## 11. 검증

| 명령 | 결과 |
|---|---|
| `pnpm lint` | **통과** (0 errors, 0 warnings) |
| `pnpm typecheck` | **통과** |
| `pnpm test` (범위 내) | `pnpm test src/lib src/components` **42 파일 369건 통과** (1 skip) — `legacy-redirects.test.ts`(v5.20로 재작성) · `routes.test.ts` · `mock-isolation.test.ts` · `w3.integration.test.ts` 포함 |
| `pnpm test` (전체) | **17건 실패 — 전부 내 범위 밖**: `src/server/services/{account,application,insight}.integration.test.ts`. 원인은 **로컬 Supabase가 병행 백엔드 세션의 미커밋 마이그레이션으로 앞서 있어서**다. 예: `create…` 테스트가 `name: "가나다랩 – 데이터 엔지니어"`를 기대하는데 로컬 DB가 이미 **`"가나다랩 자기소개서"`**(CF-A7)를 돌려준다. 그리고 `get_deletion_impact`가 `drafts`·`draft_sections` 키를 더 주지 않아 zod가 거부한다(7절 ⑦). `src/server/`·`src/lib/contracts/`는 쓰지 않는 영역이라 손대지 않았다 |
| `pnpm build` | **통과** |
| 브라우저 | **리다이렉트 14경로를 `pnpm dev`에 curl로 확인** — 표 3절 그대로 308 + Location(쿼리 `?tab=jd`·`?new=1`까지). 화면 확인은 못 했다: S-13·S-46 등 대상 화면이 아직 없고(A3·A4 몫) 나머지는 로그인 게이트 뒤다. `/dev/states?state=cover-letter` 렌더는 미확인 |

> `pnpm dev`(포트 3000)를 리다이렉트 확인용으로 띄웠고 **종료 권한이 막혀 아직 돌고 있다** — 리더가 필요하면 꺼 주세요.

### 전체 테스트 실패 요약 (원문)

```
FAIL src/server/services/application/application.integration.test.ts
  AssertionError: expected { …(9) } to match object { name: '가나다랩 – 데이터 엔지니어', …(2) }
  -   "name": "가나다랩 – 데이터 엔지니어"
  +   "name": "가나다랩 자기소개서"

FAIL src/server/services/account/account.integration.test.ts
  Caused by: ZodError: affected_results.by_application_project[0].drafts
    Invalid input: expected number, received undefined
    affected_results.by_application_project[0].draft_sections — 같음
```
