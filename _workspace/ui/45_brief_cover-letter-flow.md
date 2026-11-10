# 45 런 브리프 — 자기소개서 관리 흐름 재설계 UI 반영 (CF-1~CF-10)

- 날짜: 2026-11-09
- 요청(상위 세션): 자기소개서 관리 영역 UI 구현 — S-13 목록 재작성, S-14 2단계 모달, S-46 작성 화면(탭 자소서·채용 공고·인사이트), 폐기 화면 정리
- 기준 판: **PRD v4.17 · 플로우 v5.20 · AI v4.15 · 데이터 모델 v4.15**
  (screen-status 기준은 44 런의 v4.16/v5.19/v4.14/v4.14 — 이번 대상 화면만 v5.20로 올린다)
- 정본: `docs/planning/02-user-flows.md` S-13(1476~) · S-14(1494~) · S-15·S-16(1563~) · S-18(1609~) · S-46(1645~) · S-39(1772~) · 1.3a L-02(217~) · 5.1n(2564~),
  `docs/planning/decisions.md` **4.23 UI 표 1~8**(할 일 정본) + 4.19·4.21·4.22, `01-prd.md`·`03-ai-features.md`·`04-data-model.md` 해당 절
- 디자인 시스템: `docs/ui/design-system.md` v5.12

## 기획 PR #68 (머지 대기) — 반영할 것
`origin/claude/focused-mclaren-1a7881` (커밋 `052ce1f`·`144e7e4`). main에 없으나 **사용자 확정(2026-11-09)**이므로 이번 런의 기준에 넣는다.
- **CF-S1** (UX v5.20 S-46 근거 목록 행): 문항 근거의 원천은 **그 문항 초안 제안의 `sources[]`**. [반영]한 문항만 근거가 바뀌고 손으로만 고친 문항은 기존 근거를 유지한다 `[가정]`. **화면은 근거를 저장 요청에 싣지 않는다.**
- DM 2.6.1 문장 정정은 백엔드 몫 — UI 영향 없음.

## 확정 전제 (되살리지 말 것)
- **CF-1 경력기술서 완전 제거** — S-45 폐기. 서류는 자소서 하나. **S-17 서류 목록 · S-19 초안 편집기 · S-31 허브도 폐기.**
- S-15 JD · S-16 인사이트는 **S-46의 탭**(ID 유지, CF-7·CF-A11·CF-A12).
- **CF-M1 이관 없음** — 이관 안내 상자·[초안 보기]·경력기술서 안내 문장·6~10문항 안내·글자수 빈 이관 문항 처리 **모두 만들지 않는다**.
- **CF-U2** 글자 수 제한 기본값 **800자**(시안의 600 아님) · **CF-5** 문항 최대 5개 · **CF-6** 답변마다 제목(`answer_title`, 글자 수에 미포함) · **CF-U3** 지원 건·서류 모두 "자기소개서", 작성 화면 탭은 "자소서" · **CF-U1** "AI 없이 계속" 버튼 없음(Q53-1 게이트 유지).
- **모의 면접 MVP 제외(RM-1~RM-5)** — 면접 진입·면접 수 표시 되살리지 않는다. 옛 면접 주소는 **S-46으로**(MRG-UX-1 `[가정]`).

## 백엔드 상태 — mock 기준
병행 세션의 슬라이스 R15는 **아직 커밋 전**(`claude/cover-letter-backend-ef4d68`가 origin/main과 동일, 커밋 0건). 따라서 이번 런은
**기존 mock 데이터 계층 + `?state=` 미리보기로 화면을 완성**한다. 새 계약이 필요한 자리는 `// 연결 대기 (문서 위치)` + mock 분기로 두고
보고서의 "백엔드 요청"에 적는다. 다음 호출(`POST /api/job-descriptions/fetch`·`/extract-preview`, `save_application_document`의
`p_application_values`, `create_application_project`의 `p_source_url`·`p_preview_job_id`, `slot_count`·`answer_title`)은 모두 연결 대기 대상이다.

## 파일 경계 — 병행 세션이 같은 저장소를 고치고 있다
- **쓴다**: `src/app/`, `src/components/`, `src/lib/data/*`(mock 분기·뷰 모델), `src/lib/routes.ts`, `src/lib/legacy-redirects.ts`, `next.config.ts`, `src/types/db.ts`(화면이 쓰는 타입 한정), `docs/ui/`.
- **쓰지 않는다**: `src/lib/contracts/`, `src/lib/data/*-real.ts`, `src/server/`, `supabase/`, `docs/planning/`, `docs/legal/`.
  여기에 손댈 일이 생기면 고치지 말고 **보고서의 "백엔드 요청"**에 적는다.

## 영역 분배
| 단계 | 담당 | 범위 |
|---|---|---|
| A0 | frontend-engineer | routes·legacy redirect·폐기 화면 코드 삭제·라벨/기능 이름(4.23 UI 6)·C-05·C-18 자리·mock 데이터 계층(S-13·S-14·S-46)·`?state=` 키 |
| A3 | frontend-engineer | S-13 목록(UI 1) · S-14 2단계 모달(UI 2) · S-46 작성 화면(UI 3, 문항 설정 + 작성 + 탭 3개) · UI 4 폐기 주소 처리 |
| A4 | frontend-engineer | S-39 카드 → S-46, 서류 표시 "자소서 작성 중 / 작성됨"(UI 5) |
| QA | ui-qa | A0 → A3 → A4 → 통합 |

## 규칙
- **`[UI-가정]`으로 기획 공백을 덮지 않는다.** 기획 결정·명세 오류·빈 자리는 보고서 "기획 확인 필요"에 올린다(상위 세션이 기획 세션으로 넘긴다).
  순수 화면 세부(간격·포커스 순서·토스트 문구)는 관례대로 정하고 `[UI-가정]`으로 기록한다.
- 산출물·보고는 한국어.

## 추가 확정 (2026-11-09, 기획 세션 회신 — 사용자 확정)
디자인 시스템 작업에서 올린 기획 확인 3건(P-28·P-29·P-30)에 대한 답이다. 문서 반영은 기획 PR #68 브랜치
`claude/focused-mclaren-1a7881`(미머지)에 있다 — 반영 위치: UX S-46 상태 판정 2곳·C-11 행, decisions 3.28 후속 확정 4 · 4.23 UI #9.

- **CF-S2** (P-28, S-46 근거 목록 C-11): 행은 **경로 한 줄만** — "회사명/교육 표시 이름 › 프로젝트명".
  `{slot}.sources.{n}` 순서 = **주 근거 먼저**. 주/보조·출처 배지 **없음**, **rationale 줄도 없음**
  (rationale은 저장되지 않아 새로고침 뒤 그릴 수 없다 — 대화의 `sources_selected` 근거 카드에만 있다). 백엔드 계약 변경 없음.
- **CF-S3** (P-29, 문항 설정 상태의 저장): **문항 설정 상태에서는 상단 바 "저장하기"를 비활성**으로 둔다.
  정본 행을 만드는 **첫 저장은 [자기소개서 작성 시작]뿐**이다. 저장 없이 나가면 C-05 이탈 확인(작성 화면 미저장 규칙 그대로).
- **P-30**: 결정 불필요 — **문항 설정으로 돌아갈 입구를 새로 만들지 않는다.** 작성 상태의 **"문항 편집"**
  (UX S-46 문항 편집 행, CL-8)이 글자 수 제한 수정·추가·삭제·순서·기준·메모까지 이미 다룬다. 그것을 쓴다.

## 백엔드 R15 계약 정본 (2026-11-09, 백엔드 세션 회신 — 구현 완료·커밋 전)
브랜치 `claude/cover-letter-backend-ef4d68`. 커밋되면 백엔드 세션이 알린다. 그때까지 mock을 **이 모양으로** 맞춘다.

- **`POST /api/job-descriptions/fetch`** — AI 아님, **키·동의 없이 동작**. 요청 `{url}` → 응답 `{rawText, companyName, positionTitle}`(없으면 null).
  실패 **6종** `invalid_source_url`(400)·`fetch_blocked`·`fetch_timeout`·`fetch_too_large`·`fetch_too_short`·`fetch_failed` →
  **화면은 전부 한 문구로 받는다**(CF-10): "이 공고는 가져오지 못했어요. 내용을 직접 붙여넣어 주세요".
- **`POST /api/job-descriptions/extract-preview`** — 요청 `{rawText}` → `{previewJobId, companyName, positionTitle, deadline, requirementCount}`.
  **Q53-1 게이트 409**(`key_invalid`·`ai_consent_required`), 차단 시 `ai_jobs`·사용량 0행. 모달은 `previewJobId` + 표시 값만 들고 있으면 된다.
- **`create_application_project`** — **10인자**로 교체(옛 8인자 drop). 뒤 두 인자 `p_source_url`·`p_preview_job_id`,
  반환에 `preview_applied`·`preview_skip_reason`(`preview_not_found`/`preview_expired`/`preview_mismatch`/null). `p_source_url` 검사 실패 = `invalid_source_url`(400).
  **미리 보기는 서버가 원문 sha256을 다시 계산해 대조한다** — 모달 ②에서 공고 내용을 한 글자라도 고치면 `preview_mismatch`로 버려지고 생성은 계속된다(작업 연결은 함).
- **`save_application_document`** — 마지막 인자 `p_application_values {name, deadline}`. 반환 키 **9개**
  `{application_document_id, document_kind, filled_slot_count, slot_count, name, name_source, deadline, updated_at, applied, skipped}` — 머리 표시를 다시 읽지 않아도 된다.
  `too_many_questions` = **400 + `details {limit: 5, current: n}`**. **`char_limit`은 필수**(null·빈 값 → `invalid_fields`, 경로 `questions.q_n.char_limit`). **`p_client_id`는 무시된다.**
- **`application_documents`** — `slot_count` 생성 컬럼, `answer_title` ≤ 100자 null 허용, `unique (application_project_id, document_kind)`, `document_kind` CHECK = `cover_letter` 1값.
  **S-46 두 상태 판정 "행 유무"가 맞다** — 행을 만드는 길은 `save_application_document` 첫 호출뿐이고 **대화 시작·턴·요건 추출은 행을 만들지 않는다**.
- **CF-S2 구현 확인**: 저장 입력 `p_body.questions[]`에 **`sources` 키가 없다**. `applied_proposals: [{writing_chat_id, slot, rev}]`만 보내면
  저장 RPC가 그 제안의 `draft.sources[]`로 `evidence_links`를 넣는다(`role` 저장 없이 `primary` 먼저).
  **적용 제안이 없는 슬롯(손편집만)은 기존 근거 행을 유지**하므로 C-11이 갑자기 비지 않는다.

### 건드리지 말 것 (백엔드가 못 박은 두 자리)
- `src/lib/contracts/account.ts`의 **`applications.drafts: number`는 정본이다** — `get_account_deletion_summary`는 셈법만
  "자소서가 작성된 지원 건 수"로 바뀌고 **반환 키 이름은 `drafts` 유지**(DM §4.3). 용어 일괄 치환에 휘말리게 하지 마라.
- `src/lib/data/drafts.ts`를 걷을 때 **`retryJdExtraction`·`runJdExtraction`은 남긴다** — 서류 함수가 아니라 JD 요건 추출(S-15, D-30)이고 실제 경로가 유지된다.
- **`src/server/services/{account,application,insight}.integration.test.ts`의 17건 실패는 고치지 않는다.** 정본 키는 `cascade.documents`이고
  백엔드 워크트리에 이미 반영돼 있다 — R15 머지로 자동 해소된다. 여기서 고치면 머지 충돌만 생긴다.
- 공유 로컬 Supabase: 백엔드 세션이 QA 중 `supabase db reset`을 더 돌린다. 서버 통합 테스트를 돌릴 일이 있으면 미리 알린다.

## R15 병합 상태와 릴리스 (2026-11-09)
- `claude/cover-letter-backend-ef4d68`의 **`dba1bff`를 병합했다**(커밋 `d074229` 뒤). 브랜치 최신은 `f1aaae8`이지만
  그 사이는 **문서 2개뿐**(`_workspace/backend/R15/05_release.md`·`slices.md`)이고 `src/`·`supabase/` 변경 0건이라
  **재병합하지 않는다**(백엔드 세션 확인). 코드·마이그레이션에 영향 있는 커밋이 생기면 백엔드가 따로 알린다.
- 백엔드는 **비파괴 17개를 원격에 적용**했고(마지막 `20261113004660`), **파괴 `20261113004700`만 미적용**이다.
  원격에는 새 스키마와 옛 `drafts` 계열이 동시에 있어 지금 운영은 깨지지 않는다.
- **릴리스 순서**: (UI PR + 백엔드 PR #69를 **같은 릴리스로 머지** = 코드 배포) → 파괴 `004700` push(사용자 확인).
  되돌릴 수 있는 창은 **코드 배포 전까지만** 열려 있다. UI PR은 **사용자 확인 뒤** 올린다.

### QA 판정 기준 (파괴 단계 전 확인 — 백엔드 요청)
"옛 `drafts` 계열을 읽고 쓰는 코드 0건"은 **실제 경로만 기준으로 판정한다.**
- mock 전용 분기에 남은 `db.draft_sections` 류 참조는 **파괴 단계 뒤에도 런타임 오류를 내지 않는다**
  (이 PR에서 `drafts.ts`·픽스처를 걷으면 함께 사라진다).
- 반대로 **실제 경로(`*-real.ts`·서버 호출)에 하나라도 남으면 파괴 push 직후 500**이다 — 여기를 본다.
- `drafts.ts`를 걷을 때 **`retryJdExtraction`·`runJdExtraction`은 보존**한다(JD 요건 추출, S-15·D-30).

## 연결 대기 4건 — 백엔드가 R15 누락으로 확인, 수정 중 (2026-11-09)
UI 연결 중 찾은 계약 공백 4건(보고서 49)은 **R15가 빠뜨린 것**이다 — DM 7장 25행 "서류 작성 화면 조회"·33행 "보드 조회"가 이미 정해 둔 읽기다.
**백엔드 판단: 1번이 해소되기 전에는 UI PR·PR #69를 머지하지 않는다.** 4건 모두 함께 넣는다.

| # | 공백 | 백엔드가 만드는 것 | UI stub (이름·시그니처 그대로) |
|---|---|---|---|
| 1 | 정본 읽기 없음 → 실제 환경에서 S-46이 늘 문항 설정 상태, **기존 정본 덮어쓰기 위험** | `getApplicationDocument` 서비스·액션, 행 또는 `null` | `getCoverLetterDocument(applicationProjectId): Promise<ApplicationDocument \| null>` |
| 2 | 보드용 문항 수 없음(`loadDocumentCounts`는 0/1) | `listDocumentSlotCounts` → `Record<apId, {slot_count, filled_slot_count}>`, 인자 없음, `body` 안 읽음 | `listCoverLetterSlotCounts()` |
| 3 | `first_copied_at` 쓰기 없음 | RPC `mark_application_document_copied(p_application_project_id, p_document_kind default 'cover_letter') returns timestamptz` + 액션. 한 번 기록되면 불변, 행 없으면 `null`, **`updated_at`을 올리지 않는다**(복사만으로 다른 탭 저장이 `stale_write` 되지 않게) | `markCoverLetterCopied()` |
| 4 | 서류 대화 읽기 DTO 없음 → 새로 고침하면 대화가 화면에서 사라짐 | `DocumentWritingChatDto`(CF-S1 `draft.sources[]`·`answer_title`)를 `AnyWritingChatDto`에 추가, 서류별 대화 목록(`last_activity_at desc`)·상세(메시지 + `structured_draft`) | 신설 |

- **경계**: `src/lib/data/cover-letters.ts`는 **UI 소유** — 백엔드는 만들지도 고치지도 않는다. 백엔드는 서버 서비스·액션·계약만 만들고 **export 이름·시그니처·반환 모양 목록**을 준다. UI는 stub의 `notWired(...)` 자리를 그것으로 바꾼다.
- 새 마이그레이션 `20261113004670`(비파괴, 파괴 `004700`보다 앞) — **이것도 코드 배포 전에 원격 push**해야 한다(백엔드 체크리스트).
- 백엔드가 함께 찾은 **쓰기 우회**: `authenticated`가 `application_documents`에 insert·update 권한이 있어 저장 RPC를 거치지 않고 REST로 자기 행을 직접 쓸 수 있었다(상한·필수·정합성 우회, RLS로 교차 침해는 아님). 트랜잭션 로컬 플래그 없는 쓰기를 거부하는 트리거로 막는다. **UI는 직접 쓰지 않으므로 화면 영향 없음.**

### ⚠ UI 규칙 — 읽기 실패를 "행 없음"으로 접지 않는다
**S-46의 문항 설정 상태는 `getCoverLetterDocument`가 `null`(행 없음)일 때만 들어간다.**
읽기 **실패**(네트워크·서버 오류·`wiring_pending` 503)를 `null`로 접으면 1번의 덮어쓰기가 그대로 다시 생긴다 → **실패는 오류 상태로 보인다.**
(S-39 보드의 `listCoverLetterSlotCounts` 실패는 배지만 접는 것이 의도된 동작이다 — 덮어쓰기 위험이 없어 이 규칙의 예외다.)

## UQ-741 — 기획 확인 대기 (2026-11-09)
저장 RPC가 "행 있음 + 기대 버전 null"이면 검사 없이 덮어쓰는 것은 버그가 아니라 **DM 2.5.1 공통 규칙**이다(저장 RPC 5개 공통,
"내 내용으로 저장"이 이 인자 없이 다시 보낸다). 서류만 "없으면 만들고 있으면 고친다"라 null 하나가 "첫 저장"과 "강제 덮어쓰기" 두 뜻을 갖는다 —
정본이 생기기 전에 연 탭은 보낼 `updated_at`이 없어 **화면 쪽에서는 고칠 수 없다.** 백엔드가 기획 세션에 **권고 (a)**로 올렸다:
서류 RPC만 "행 있음 + 기대 버전 null → `stale_write`", 첫 저장(행 없음)은 null 통과, "내 내용으로 저장"은 `details.current_updated_at`을 기대 버전으로 재전송, S-10·S-44·프로필 불변.
**두 PR(UI·#69)은 이 건까지 정리된 뒤 머지한다.**

**(a) 확정 시 UI 할 일** (읽기 연결과 함께): 문항 설정 상태의 [자기소개서 작성 시작]이 `stale_write`를 받으면
"그 사이 다른 탭이 정본을 만들었다"는 뜻이다 → **덮어쓸지 묻지 말고 정본을 다시 읽어 작성 상태로 연다**(백엔드 제안, 최종 문구·흐름은 UI 판단).
작성 상태의 `stale_write`는 지금대로 C-05 충돌 확인("내 내용으로 저장"은 `current_updated_at` 재전송).

## UQ-741 → **CF-S7 확정** (사용자 2026-11-09, decisions 4.23 UI #12, 기획 PR #68)
서버가 자기소개서 저장에서 **"정본 행이 있는데 기대 버전 null"을 `stale_write`로 거부**한다(첫 저장 = 행 없음은 통과). 다른 화면(S-10·S-44·프로필)은 변경 없음.
- S-46 **"내 내용으로 저장"**은 기대 버전을 비우지 않고 **`stale_write` 응답의 `details.current_updated_at`을 실어 다시 보낸다.** (QA 1 수정에서 반영됨 — 51 보고서)
- **문항 설정 상태에서 연 탭의 [자기소개서 작성 시작]도, 다른 탭이 먼저 정본을 만들었으면 같은 충돌 다이얼로그를 받는다.**
  → **위 "UQ-741 — 기획 확인 대기" 절의 "(a) 확정 시 UI 할 일"(덮어쓸지 묻지 말고 다시 읽어 작성 상태로 연다 — 백엔드 제안)은 이 확정으로 대체한다.** 정본은 기획 결정이다: **같은 다이얼로그.**
