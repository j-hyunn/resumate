# R15 api-engineer 노트 — 자기소개서 관리 API·서비스 (계획 1-C A1~A9 + 1-E)

- 날짜: 2026-11-09 · 기준 판 **DM v4.15 · AI v4.15 · UX v5.20 · PRD v4.17** (+ **CF-S1** 2026-11-09 사용자 결정, 문서 반영은 **PR #68 미머지** — 이 워크트리 `docs/planning/`에는 없다)
- 검증: `pnpm typecheck` **통과** · `pnpm lint` **경고 0** · `pnpm test` **147파일 2,398건 전부 통과** (로컬 Supabase 스택 띄운 상태의 통합 테스트 포함)
- 실제 공급자 API 호출 0건(스크립트 어댑터·가짜 SDK만). 원격 쓰기·커밋·푸시 0건. `docs/planning/`·`docs/legal/`·`supabase/migrations/` **미수정**.

---

## ① 만든·폐기한 파일

### 신설

| 경로 | 범위 |
|------|------|
| `src/lib/contracts/jd-fetch.ts` | **A1** 요청·응답·실패 코드 6종 + 상한 상수 + `jdFetchError()` |
| `src/server/services/job-description/ssrf.ts` · `ssrf.test.ts` | **A1** 주소 차단(13건) |
| `src/server/services/job-description/fetch.ts` · `fetch.test.ts` | **A1** 가져오기·추출·사이트별 처리(22건) |
| `src/app/api/job-descriptions/fetch/route.ts` | **A1** 라우트 |
| `src/server/services/application/raw-text.ts` · `raw-text.test.ts` | **A3** `normalizeJdRawText`(9건) |
| `src/server/services/application/preview.ts` · `preview.test.ts` | **A2** 미리 보기 실행(13건) |
| `src/server/jobs/jd-preview.ts` | **A2** 운영 deps 팩토리(AI-01 + `jdPreviewSummary`) |
| `src/app/api/job-descriptions/extract-preview/route.ts` | **A2** 라우트 |
| `src/lib/contracts/application-document.ts` | **A5·A9** 저장·대화 시작 요청/응답, 거부 코드 목록 |
| `src/server/services/application-document/save.ts` · `save.test.ts` | **A5** 두 RPC 호출(19건) |
| `src/server/services/application-document/progress.ts` | 서류 수(0/1) — 폐기된 `services/drafts/progress.ts` 대체 |
| `src/server/actions/application-document.ts` | **A5** 서버 액션 2개 |
| `src/server/services/writing-chat/document-turn.test.ts` | **A6** 서류 턴(15건) |

### 폐기 (`git rm`)

`src/server/services/drafts/**`(12파일) · `src/app/api/application-projects/[id]/career-descriptions/route.ts` · `.../draft-source-ranking/route.ts` · `src/app/api/draft-sections/[id]/generate/route.ts` · `src/lib/data/drafts-real.ts` · `src/server/jobs/drafts.ts` · `src/server/actions/draft.ts` · `src/server/drafts-sse.ts` · `src/test/draft-fakes.ts`

- **관찰 기간 읽기 경로를 남기지 않았다**(CF-M1): 서버에서 `drafts`·`draft_sections`·`draft_section_sources`를 읽는 코드는 0건이다(`grep` 확인).
- 거부 코드 **`career_description_in_progress` 제거**(상수·매핑·주석 전부).
- `src/lib/contracts/draft.ts`와 `enums.ts`의 S7 열거(`DRAFT_TYPES`·`DRAFT_SECTION_KINDS` 등)는 **남겼다** — 옛 서류 화면 S-17·S-19가 `?state=` 미리 보기로 컴파일되어야 한다(리더 판정 2026-11-09). UI 세션이 화면을 지울 때 함께 지울 몫이다.

### 고친 주요 파일

- `src/lib/contracts/enums.ts` — ④ 미러(아래 ②)
- `src/lib/contracts/application.ts` — `sourceUrl`·`previewJobId`·`PREVIEW_SKIP_REASONS`·미리 보기 계약·이름 규칙
- `src/lib/contracts/writing-chat.ts` — 서류 draft 파싱·`DocumentSlotSchema`·서류 턴 SSE 12종
- `src/lib/contracts/career.ts` — 삭제 영향 키 `documents`·`document_sections`·`document_chats`
- `src/server/db/errors.ts` — `too_many_questions` detail 변환, `invalid_evidence_source`·`invalid_slot`·`invalid_source_url`
- `src/server/services/application/write.ts` — A3 정규화, A4 인자·반환
- `src/server/services/application/read.ts` — 서류 수, 원문 수정 조건 5(R15-DB-8)
- `src/server/services/writing-chat/{types,mappers,db,pipelines,turn}.ts` — A6 서류 분기
- `src/server/jobs/{cron,writing-chat-turn,runner}.ts` — A8 정리 크론, 서류 파이프라인 wiring
- `src/types/db.ts` — `ApplicationDocument` 계열 신설, 옛 서류 3타입을 손으로 쓴 인터페이스로 전환
- `src/test/{job-fakes,fake-supabase,writing-chat-fakes}.ts` — `output` 기록, raise `details` 전달, `fakeDocumentPipelines`

---

## ② db·ai 노트와 대조한 결과

### 일치 (그대로 구현)

- **RPC 시그니처·반환 키**: `save_application_document`(8인자, 반환 10키) · `start_document_writing_chat`(3인자, 반환 `uuid`) · `create_application_project`(10인자, 반환 10키) — 생성 타입(`database.types.ts`)과 db 노트 ②가 서로 맞고, 호출부를 그 모양으로 맞췄다.
- **거부 코드 → HTTP**: db 노트 ②-1 표 그대로. `too_many_questions`의 raise detail **`'5,{current}'`** → `details {limit, current}` 변환 구현 + 테스트.
- **`sources` 키 없음 ≠ 빈 배열**(CF-S1): ai 노트 ②(3-b)와 db 노트 ②-6이 같다. **api는 이 값을 만들지도 읽지도 않는다** — 화면은 `sources`를 보내지 않고(`p_body.questions[]`에 키 없음, 계약에서도 거부 — 테스트 있음), 저장은 적용 제안에서만 읽는다.
- **SSE 이벤트 이름**: ai 노트 ②(3) + 리더 판정 R15-L2 그대로 — **새 이름 0개**, 기존 `sources_selected`·`draft_started`·`draft_block`·`adjusting_length`·`draft_done`에 `slot`·`questionNo`만 더했다.
- **미리 보기 인터페이스**: ai 노트 ②(1) 그대로 — 파이프라인에 넘기는 것은 `sentences`뿐이고 정규화·분할·해시는 api 소유(A3), `ai_jobs.output = result.payload`, 응답은 `jdPreviewSummary(result) + previewJobId`.
- **턴 파이프라인 시그니처**: ai 노트 ②(2) 그대로 — `plan` / `extract` → 패치 → 컨텍스트 재조립 → `composeDecision` → `compose`. `call_key`는 턴 번호가 들어간 `cover_letter.turn.{n}.compose`(+ `.adjust_length`), `job_type = 'cover_letter'`, 등급 extract `light` / reply·compose `default`.
- **정리 크론**: db 노트 ⑤의 `purge_unused_jd_preview_outputs(now(), 5000)`를 `/api/cron/ai-jobs`에 넣었다(아래 A8).

### 어긋난 것 · 보완한 것

1. **`sources_selected` payload 모양** — ai 노트는 "화면 표시용 `role`·이유 한 줄, UUID"라고만 적었다. 파이프라인이 실제로 주는 값은 `SelectedSourceView`(`sort_order`·`role`·`experience_id`·`education_id`·`project_id`·`label`·`rationale`·`reuse_reason`·`requirement_ids`)여서 **계약을 그 모양의 camelCase로** 맞췄다(`{source_type, source_id}`로 평평하게 만들지 않았다 — 변환을 한 군데라도 더 두면 라벨 조립이 두 곳으로 갈라진다).
2. **턴 `style` 어휘 충돌** — AI-04는 `fit_length`·`shorter`, AI-13은 `shorter`·`more_detail_on_contribution`이다. 양쪽 어휘의 합집합을 요청 스키마로 두고 `checkTurnOptions`가 대상별로 거부한다(spec-gaps **R15-API-3**).
3. **`invalid_evidence_source`의 상태 코드** — db 노트 표는 400이지만 기존 매핑이 이 이름을 `internal_error`(500)로 접고 있었다(인사이트 경로용). db 노트를 따라 **400 + `details.field = item_key`**로 고쳤다 → 인사이트 경로의 같은 raise도 이제 400이다(spec-gaps **R15-API-2**).
4. **`invalid_slot`·`too_many_questions`는 별칭을 두지 않았다** — 화면이 세 거부를 구분해야 하므로 자기 코드 + 400(알 수 없는 코드의 기본값)으로 간다.
5. **이름 규칙** — 계약의 표시 이름 폴백이 아직 "회사명 – 포지션명"이었다. D12(CF-9)에 맞춰 `composeApplicationName()`을 두고 **"{회사명} 자기소개서"**로 고쳤다(spec-gaps **R15-API-1**). 통합 테스트 3건·계약 테스트 1건의 기대값을 함께 고쳤다.
6. **삭제 영향 키** — db 노트 §7의 `documents`·`document_chats`(지원 프로젝트) / `documents`·`document_sections`(커리어 종류)로 계약·데이터 계층·`types/db.ts`를 맞췄다. `get_account_deletion_summary`의 `applications.drafts`는 **키 이름 그대로**(DM §4.3)이고 `career.writing_chats`가 서류 대화를 포함한다 — 통합 테스트 기대값을 2로 고쳤다.
7. **원문 수정 조건 5**(R15-DB-8) — `read.ts`의 미러에서 서류 분기를 지웠다. 통합 테스트 1건을 `save_application_document`로 바꿔 "자소서만 있으면 원문 수정 허용"을 단정한다.
8. **`user_note` 근거 라벨** — `source_id`가 jsonb 안의 `question_id`여서 조인할 수 없다. 조회를 지우고 라벨 폴백으로 뒀다(spec-gaps **R15-API-4**, S-46 연결 때 한 줄 추가).

---

## ③ UI 소유 파일 수정 (Minimal UI edits 범위)

전부 "없으면 컴파일이 깨진다"에 해당하는 최소 수정이다.

| 파일 | 수정 | 왜 |
|------|------|-----|
| `src/lib/mock/fixtures.ts` | JD 픽스처에 `source_url: null` 1줄 | `job_descriptions`에 컬럼이 생겨 생성 타입이 요구한다 |
| `src/components/common/delete-confirm-dialog.tsx` | `d.drafts` → `d.documents`, `ap.drafts` → `ap.documents` (2곳, 문구 그대로) | 삭제 영향 반환 키 이름이 바뀌었다(D9) |
| `src/lib/data/applications.ts` | 서류 읽기 3개를 `previewOr(mock, 중립값)`로 되돌림 + `CreateApplicationInput`에 `source_url`·`preview_job_id` 선택 키 | 실제 경로(`drafts-real.ts`)가 폐기됐다 / A4 전달 |
| `src/lib/data/drafts.ts` | 실제 경로 분기 제거 → mock 전용 `// 연결 대기`(export 이름·시그니처 유지) | 리더 판정 2026-11-09 #2 |
| `src/lib/data/deletion.ts` | 영향 키 이름, `getDraftDeletionImpact`·`deleteDraft` mock 전용 | D9 / 폐기 |
| `src/lib/data/labels.ts` | `countsAsDraft` 셈법, `AI_FEATURE_NAMES`에서 "AI 근거 선택" 제거 | 1-E / CL-2 |
| `src/lib/data/career.ts` · `writing-chats.ts` · `evidence-real.ts` | `project_id` null 처리, `user_note` 조회 제거 | D2 `project_id` not null 해제 / CF-1 |
| `src/lib/data/applications-real.ts` | 생성 입력에 `sourceUrl`·`previewJobId` 전달 | A4 |

- **옛 서류 화면·컴포넌트는 지우지 않았다** — `src/app/(dashboard)/(gated)/applications/[id]/drafts/**`, `src/components/applications/{drafts-view,draft-editor,sources-used,source-tree}.tsx`는 그대로다. `?state=` 미리 보기로만 컴파일·동작한다.
- `countsAsDraft`는 **두 모양을 다 받는다** — 새 규칙 `filled_slot_count > 0`이 정본이고, 옛 `{draft_type, status}`는 S-17·S-19가 컴파일되게만 남겼다 `[가정]`.

## ④ UI 요청 (UI 세션으로 넘김)

1. **옛 서류 화면·컴포넌트 삭제** — `applications/[id]/drafts/**`(S-17·S-19), `src/components/applications/{drafts-view,draft-editor,sources-used,source-tree,cover-letter-questions}.tsx`, 옛 주소 → S-46 리다이렉트(4.23 UI 표 #4).
2. **S-13 목록 재작성 · S-14 → 2단계 모달 · S-46 작성 화면 · S-31·S-45 폐기 · S-39 카드** — 그 뒤 `src/lib/data/`의 서류 함수를 실제 경로로 붙이는 **연결 단계**가 필요하다(지금은 전부 `// 연결 대기`).
3. **S-14 2단계 모달이 호출할 것** — 단계 1 `[주소에서 가져오기]` → `POST /api/job-descriptions/fetch`, `[다음]` → `POST /api/job-descriptions/extract-preview`, 단계 2 `[자기소개서 작성]` → `createApplicationProject({ ..., source_url, preview_job_id })`. 응답의 `previewApplied`·`previewSkipReason`으로 "미리 본 요건을 그대로 썼는지"를 보여야 한다.
4. **S-46이 쓸 것** — 저장 `saveApplicationDocument`, 대화 시작 `startDocumentWritingChat`, 턴 `POST /api/writing-chats/{id}/turns`(서류 이벤트 집합 `DocumentTurnEventSchema`). `draft_done`이 문항마다 오고 `slot`·`questionNo`가 실린다.
5. **`src/lib/mock/`에 `application_documents`가 없다** — 삭제 영향 미리 보기(`deletion.ts`)의 `documents`는 지금 옛 `drafts` mock으로 센다. 새 화면과 함께 mock 테이블을 더해 달라.
6. **근거 라벨** — `user_note` 근거의 `source_id`는 정본 `body.questions[].question_id`다. S-46에서 문항 문구를 라벨로 보여야 하면 그 조립이 필요하다(spec-gaps R15-API-4).
7. **`policy_versions` 2차 정렬**(R14-DB-6 잔여) — 이 슬라이스 범위 밖이라 손대지 않았다. 같은 시행일 두 판이 있는 동안 `loadPolicyVersions`가 `version collate "C" desc`를 더해야 한다.

## ⑤ 새 환경 변수

**없다.** 공고 URL 가져오기는 외부 키가 필요하지 않고(CF-A15), 미리 보기는 사용자 BYOK 키를 쓴다.

---

## ⑥ 구현 판단과 `[가정]`

### A1 `POST /api/job-descriptions/fetch`

- SSRF: scheme http(s) · 2,048자 · **`dns.lookup(all)` 뒤 모든 주소를 차단 목록에 검사** · 리다이렉트 **홉마다 재검사**, 최대 3회 · 리터럴 IP도 검사 · 파싱 못 하는 주소는 **차단(fail closed)** · 비정규 IPv4(`127.1`, `0177.0.0.1`)는 파싱에서 거부.
- 차단 범위는 계획서 목록보다 넓다 `[가정]`: `10/8`·`172.16/12`·`192.168/16`·`127/8`·`169.254/16`·`0/8`·`100.64/10`(CGNAT)·`192.0.0/24`·`192.0.2/24`·`198.18/15`·`198.51.100/24`·`203.0.113/24`·`≥224/4`·`::1`·`::`·`fc00::/7`·`fe80::/10`·`ff00::/8`·`100::/64`·`2001:db8::/32`·`::ffff:`/`::`/`64:ff9b::/96`로 감싼 사설 v4.
- **연결은 호스트 이름으로 한다** — `fetch`에 소켓 주소 훅이 없다. DNS 리바인딩 창이 남는 것을 코드 주석과 spec-gaps **R15-API-6**에 적었다 `[가정]`.
- 상한: 10초(모든 홉 합계 하나의 deadline) · 2MB(스트림을 끊는다, `Content-Length` 선검사) · 추출 200자 미만 실패 · `rawText` 50,000자 자름.
- 실패 코드 → HTTP `[가정]`: `invalid_source_url` 400 · `fetch_blocked` 400 · `fetch_timeout` 504 · `fetch_too_large` 413 · `fetch_too_short` 422 · `fetch_failed` 502. 남용 방지는 별 코드 `too_many_requests` 429(제품 "한도"로 노출하지 않는다, 2.9.4).
- 문자셋: `Content-Type` → 앞 2KB의 `<meta charset>`/`http-equiv` → UTF-8. `euc-kr`/`euckr`/`ks_c_5601-1987`/`ksc5601`/`cp949`/`windows-949` → `euc-kr`.
- 사이트별 `[가정]`: 사람인 = `view-detail|relay/view|jobs/relay` 프레임, 잡코리아 = `ReadContentFrame|GI_Read|GIReadContent|Read_Comp_Details`. 같은 등록 도메인이어야 따라간다. 프레임 문서가 200자 미만이면 랜딩 페이지를 쓴다.
- 본문 = JSON-LD `description`이 페이지 마크업보다 길면 그것, 아니면 마크업. 주변 글 제거는 정규식(런타임에 DOM이 없다) — 놓치면 **글이 남을 뿐 틀린 글이 들어가지 않는다**.
- **DB 쓰기 0건 · `ai_jobs`·`ai_usage_records`·사용량 미터 0건**(CF-A16). AI 모듈을 import하지 않는다.
- 로그는 **호스트·결과 코드·바이트 수·걸린 시간만** — 본문·URL 경로·쿼리 금지(테스트로 묶었다).

### A2 `POST /api/job-descriptions/extract-preview`

- `extractJdPreview(deps, rawText)`는 `ensureJdExtracted`의 축소판이다: JD 행이 없으니 `begin`/`apply`/`fail`이 없고, 검증 통과한 결과를 **`ai_jobs.output`에 쓰고 complete**한다.
- 행 모양: `job_type='jd_extraction'` · `target_type='jd_preview'` · `target_id` null · `application_project_id` null · `params = {raw_text_hash, sentence_count}`(**정규화한 문자열**에서 계산) · 등급 `light`.
- **Q53-1 게이트는 행을 만들기 전에 본다** → 409 `key_invalid`/`ai_consent_required`/`key_missing`이고 **작업 행·사용량 행 0건**(테스트 있음). `check_ai_run_allowed`는 행이 생긴 뒤라 `failed`로 닫는다(그 행은 `succeeded`가 아니므로 생성 RPC가 적용하지 않는다).
- **일반 재시도 경로에 넣지 않았다** — 실패는 이 요청에서 끝이고 `next_run_at`을 쓰지 않는다. `REQUEST_SCOPED_JOB_TYPES`에 `jd_extraction`이 이미 있어 크론이 깨우지 않는다.
- 응답 상태 `[가정]`: 성공 200 · 게이트 409 · `not_a_jd` 422 · 그 밖의 C-11 실패 502.
- `today`는 **KST 오늘**이고 프롬프트에 넣지 않는다(CF-A5, 테스트 있음). 회사명·포지션명은 null로 보낸다(CF-A6).
- 사용량 1행/호출, `feature='jd_extraction'`, `application_project_id` null.

### A3 `normalizeJdRawText`

- `src/server/services/application/raw-text.ts` `[가정: 위치]`. 규칙 3개(`\r\n`·`\r` → `\n` / NFC / 앞뒤 공백 제거)뿐이고 **안쪽 공백·빈 줄을 줄이지 않는다**.
- 생성·원문 수정·미리 보기가 **같은 함수 → 같은 문자열 → 분할·해시·저장 원문**을 쓴다. 테스트가 "미리 보기 해시 = 생성 해시"와 "offset이 정규화 문자열을 정확히 가리킨다"를 단정한다.
- 기존 JD 행은 재계산하지 않는다. `write.test.ts`의 "untouched" 단정을 "normalized" 단정으로 고쳤다.

### A4 생성 액션

- `p_source_url`·`p_preview_job_id`를 조건부로 보내고(값이 없으면 키를 빼서 RPC 기본값을 쓴다), 반환 `preview_applied`·`preview_skip_reason`을 `previewApplied`·`previewSkipReason`으로 올린다.
- `sourceUrl`은 zod에서 `^https?://` + 2,048자, 서비스에서 길이 재검사(400 `invalid_source_url`) — RPC가 다시 보므로 이중이지만 **행을 만들지 않는 거부**라 앞에서 걸러도 동작이 같다.
- `shouldExtract`는 그대로 `ai_run_allowed && status in (pending, failed)`다. 미리 보기가 적용되면 상태가 `succeeded`가 되어 자동으로 0회가 된다(D-30).

### A5 저장·대화 시작 액션

- zod는 **JSON 모양만**(R5-API-2): 키 집합과 자료형만 본다. 문항 5개 상한·`char_limit` 1~10,000·슬롯 형식·길이·허용 출처·V-8은 **전부 RPC**가 판정한다(테스트로 "zod가 판정하지 않는다"를 묶었다).
- `p_body.questions[]`에 **`sources` 키를 두지 않는다**(CF-S1) — `.strict()`라 보내면 `invalid_input`이다(테스트 있음).
- `p_client_id`는 받아서 그대로 넘긴다(RPC가 무시한다 — db 노트 ②-1) `[가정]`.
- 빈 `appliedProposals`는 보내지 않는다(RPC 기본값).

### A6 턴 라우트 서류 분기

- **대상 판정 한 지점** `chatTargetOf(chat)` → `project` / `project_deliverable` / `application_document`. `turnJobType(target)`이 `cover_letter` vs `writing_chat_turn`을 정하고, **진행 중 1개 조회도 같은 `job_type`으로** 한다(R15 D3의 `job_type`별 CHECK 때문에 섞으면 잠금이 어긋난다).
- 작업 행: `job_type='cover_letter'` · `target_type='writing_chat'` · `target_id` = 대화 · **`application_project_id` = 그 지원 프로젝트**(CHECK 요구) · `params.target='application_document'`.
- 옵션 검사: 슬롯 `^q_[0-9]{1,3}$` · style `fit_length`/`shorter` · `form_snapshot`은 S-46 모양(`DocumentFormSnapshotSchema`) → 어긋나면 `invalid_form_snapshot`(400).
- 초안 상한: **대화 전체 6회**(DM 2.9.4) — 칩 요청은 사용자 메시지를 저장하기 전에 409로 거절한다. 다른 탭이 마지막 초안을 쓴 경합은 기존 산출물 분기와 같은 모양으로 "상한 안내 메시지"로 답한다.
- 턴 순서: 질문 턴 = reply ∥ extract(무료는 reply → 간격 → extract, C-12) / 초안 턴 = extract → 패치 → 컨텍스트 재조립 → `composeDecision` → compose → 패치 → **문항마다 `draft_done`** → 고정 메시지(`reply_done`). 초안 턴에 reply 호출은 없다.
- `draft_done`은 **러너가 RPC 응답(`rev`·`draft_count`)과 파이프라인 결과를 합쳐** 만든다. RPC가 저장하지 않은 문항은 보내지 않는다 `[가정]`.
- 서류 턴 컨텍스트 로딩(`loadDocumentInputs`, app_ai_writer 읽기 전용): 정본 `body.questions[]` · **전체 커리어 팩**(CL-Q1) · JD 문장·요건·`extraction.other_sids` · 최신 `ready` 인사이트의 강점(소프트 신호). 정본 행이 없어도 돈다(문항 0개 = 시작 인사 ②).
- 모양을 모르는 문항 값은 **버린다**(`slot`·`question_id`가 없으면 건너뜀) — 저장 RPC가 정본을 지키므로 여기서 고치지 않는다 `[가정]`.
- `question_class`가 있으면 그것을, 없으면 `template_key`를 파이프라인의 `template_key`로 넘긴다 `[가정]`(ai 쪽 입력 이름이 `template_key` 하나다).

### A7 폐기

- 위 ① 목록. 서버에서 폐기 테이블을 읽는 코드 0건, 폐기 라우트를 부르는 코드 0건.
- `REQUEST_SCOPED_JOB_TYPES`에 `career_description`·`draft_source_ranking`은 **남겼다**(CF-A3: 90일 보관 행이 일반 재시도·크론 경로로 새지 않게 하는 목적).

### A8 정리 크론

- `/api/cron/ai-jobs`의 `runAiJobsCron`에 4단계로 `purge_unused_jd_preview_outputs(now, limit)`를 더했다. 보관 크론과 **같은 배치 규칙**(5,000행씩, 한 실행에 최대 4회, 남으면 다음 실행).
- **실패해도 크론 실행을 실패시키지 않는다** `[가정]` — 멱등이라 다음 실행이 다시 집는다. 결과는 응답·로그의 `previewOutputsPurged`.
- 작업 행 자체는 지우지 않는다(`purge_old_ai_jobs`의 90일). 사용량 행은 13개월 그대로(미터 "요건 추출"에 계속 보인다).

### A9 계약·열거

`enums.ts`에 더한 것(db 노트 ④ 대조 완료):

- `APPLICATION_DOCUMENT_KINDS = ["cover_letter"]`(1값) · `DOCUMENT_SLOT_PATTERN` · `DOCUMENT_QUESTION_LIMIT = 5` · `DOCUMENT_BLOCK_TYPES`(7) · `DOCUMENT_BLOCK_BASES`(`new`/`current_body`/`user`) · `DOCUMENT_TONES` · `DOCUMENT_SOURCE_ROLES` · `DOCUMENT_SOURCE_LIMIT = 5` · `DOCUMENT_QUESTION_EDIT_OPS` · `DOCUMENT_COMPOSE_STYLES` · `DOCUMENT_SAVE_SKIP_REASONS`(= `PAGE_SAVE_SKIP_REASONS`)
- `EVIDENCE_OWNER_TYPES` → **`insight`·`chat_message`·`application_document`**(파괴 단계 뒤 상태) + `EVIDENCE_ALLOWED_SOURCE_TYPES`(소유자별 허용 출처) + `documentBlockItemKey()`·`documentSourceItemKey()`
- `AI_JOB_TARGET_TYPES`에 **`jd_preview`** 신설(`draft`·`draft_section`은 보관 행용으로 유지)
- `START_WRITING_CHAT_RETURN_TARGET_FEATURES = ["insight","cover_letter"]`(테이블 CHECK 3값은 그대로)
- `AI_JOB_TYPES`·`USAGE_FEATURES`·`EVIDENCE_SOURCE_TYPES`는 **변경 없음**(CF-A3).

### 그 밖의 `[가정]`

- 라우트 이름 `/api/job-descriptions/fetch`·`/api/job-descriptions/extract-preview`(계획서 `[가정]` 그대로).
- 서류 턴 이벤트 집합을 `DocumentTurnEventSchema`로 **따로** 뒀다(산출물 턴과 payload가 다르다 — ai 노트의 권고).
- `src/lib/data/drafts.ts`의 `retryJdExtraction`·`runJdExtraction`은 **실제 경로를 유지했다** — 서류 함수가 아니라 JD 요건 추출(S-15 "요건 정리하기", D-30)이고, mock으로 되돌리면 지금 동작하는 화면이 깨진다. 리더 판정의 "실제 경로 분기 제거"는 서류 함수에만 적용했다.
- `// 연결 대기` 함수는 **`previewOr(mock, 중립값)` 모양을 유지**했다 — W5 격리 검사(`mock-isolation.test.ts`)가 mock 스토어에 닿는 비가드 export를 금지한다. 실제 분기는 `null`/`false`/`{}`/`503 not_connected`를 돌려준다.
- `user-cookies.ts`의 `PENDING_CAREER_DESCRIPTION_COOKIE`는 **이름만 옮겨 남겼다** — 쓰는 코드는 없지만 기존 브라우저의 쿠키를 로그아웃·탈퇴에서 지워야 한다.
- 테스트 가짜 보강: `MemoryJobStore.outputs`(이전에는 `output` 패치를 버렸다), `fakeSupabase`가 raise `details`를 전달(이전에는 버려서 detail 변환을 테스트할 수 없었다).

---

## ⑦ 테스트

| 파일 | 묶는 것 | 건수 |
|------|---------|------|
| `services/job-description/ssrf.test.ts` | 사설·루프백·링크 로컬·메타데이터·unique-local·mapped/NAT64·비정규 IPv4·파싱 실패 차단 | 13 |
| `services/job-description/fetch.test.ts` | `JobPosting`(배열·`@graph`) · EUC-KR 변환 · 사람인·잡코리아 프레임 · 리다이렉트 재검사·3회 상한 · 10초 · 2MB · 200자 · 50,000자 자름 · 실패 코드 6종 · **로그에 본문·URL 경로·쿼리 없음** · 남용 방지 | 22 |
| `services/application/raw-text.test.ts` | 정규화 3규칙 · 안쪽 공백·빈 줄 보존 · 멱등 · **해시=분할=저장 일치** · 줄바꿈만 다른 입력의 동일 해시 | 9 |
| `services/application/preview.test.ts` | 행 모양(`jd_preview`·대상 null·`params`) · `output`에만 결과(응답엔 요약만) · 사용량 1행(`application_project_id` null) · 키 미노출 · KST 기준일 프롬프트 미포함 · **게이트 409 3종에 작업 행 0건** · 런 게이트는 `failed`로 닫음 · `not_a_jd` · 문장 0개 · 공급자 실패(502·`next_run_at` null) | 13 |
| `services/application-document/save.test.ts` | 인자 매핑(대상·`p_meta`·기대 버전·반영됨·이름/마감일) · **`sources` 키 거부**(CF-S1) · `document_kind` 1값 · zod가 상한을 판정하지 않음 · 거부 5종 · `too_many_questions` details · 모양 오류 500 / 대화 시작(반환·`p_return_target` 없음·폼 스냅숏·20개 상한·404·500) | 19 |
| `services/writing-chat/document-turn.test.ts` | 대상 판정·`job_type` · 옵션 어휘(슬롯·style·폼 스냅숏) · 질문 턴 이벤트 순서·사용량 2행·무료 간격·resend · **초안 턴: 한 호출 3문항 → 문항마다 `draft_done`(slot·questionNo·rev·draftCount)** · 초안 턴에 reply 호출 0 · 문항 없음 → reply · **초안 6회 409(메시지 저장 전)** · compose 실패 시 기존 제안 보존 | 15 |
| `db/errors.test.ts`(추가) | **`too_many_questions` detail `'5,{current}'` → `{limit, current}`** · **`invalid_evidence_source` 400 + `details.field`** · `invalid_slot` · `stale_write`·`invalid_fields`·`field_too_long` · `invalid_source_url` | 13 |
| 고친 기존 테스트 | `application.integration`(이름 규칙·삭제 영향 키·조건 5를 저장 RPC로) · `account.integration`(픽스처를 `application_documents`로, `writingChats` 2) · `insight.integration`(영향 키) · `w3.integration`(서류 테스트 3개 제거, 이름 규칙, Q53-11 재작성) · `application.test`(표시 이름) · `write.test`(정규화) | — |

전체: **147파일 2,398건 통과**.

---

## ⑧ 열린 문제 · 다음 사람에게

1. **UI 없이는 끝이 아니다** — 서류 저장·대화·미리 보기 경로는 서버에만 있다. `src/lib/data/`의 서류 함수는 전부 `// 연결 대기`이고, S-13·S-14 모달·S-46이 생긴 뒤 **연결 단계**가 한 번 더 필요하다. 옛 화면 S-17·S-19는 `?state=` 미리 보기로만 산다.
2. **`main`에 가는 순서** — 비파괴 마이그레이션 push → 코드 배포 → 파괴 마이그레이션 push(사용자 승인). 코드가 먼저 가면 옛 화면이 폐기된 라우트를 부르지 않으므로(이미 지웠다) 깨지지는 않지만, `application_documents`가 없는 원격에서는 서류 저장·대화가 404/500이 된다 → **비파괴 push 전에 코드만 머지하지 말 것**.
3. **CF-S1 문서 대조** — PR #68이 머지되면 `sources[]` 상한 5개·`role` 값·"키 없음 = 유지"가 그대로인지, `p_body`에 `sources` 키가 없다는 점이 DM 2.5.1에 적혔는지 확인할 것.
4. **spec-gaps 6건**(`R15-API-1` ~ `R15-API-6`). 그중 **API-2**(근거 거부 400/500)와 **API-1**(이름 규칙)은 화면 동작에 보인다.
5. **`R15-API-7`은 닫혔다** — 초안 횟수는 **턴당 1**(리더 판정, db `004660`). 남은 미결 없음.
6. **A1 법무** — 사람인·잡코리아 약관의 자동 수집 제한 확인은 사용자 몫이다(CF-10, PRD NFR-PRV-12). 지금 코드는 `robots.txt`를 보지 않는다 `[가정]` — 필요하면 기획이 정해 달라.
7. **남용 방지 수치**(R15-API-5) — 프로세스 안 카운터는 Vercel에서 람다마다 따로 센다. 실질 상한이 필요하면 엣지 미들웨어나 KV가 필요하다.

---

## ⑨ QA 1라운드 수정 (2026-11-09, 2차 작업)

- 검증 재실행: `pnpm typecheck` 통과 · `pnpm lint` 경고 0 · `pnpm test` **149파일 2,418건 전부 통과**(db-engineer의 `004650`·`004660` 적용 뒤).

### QA-02 [Major] 실패 `error` 이벤트가 `ErrorEvent` 계약을 만족하지 않았다 — 고쳤다

- `turn.ts`의 `errorFields`(`{code, retryAfter, quotaResetsAt}`)를 **`turnErrorEvent` → `aiErrorEvent(code, times)`**로 바꿨다. `aiErrorEvent`가 코드 → C-11 `category`·`failureCause`·한국어 `message`·`retryable`을 매기는 **한 지점**이라 분류를 새로 쓰지 않았다. 턴 라우트의 게이트 `error`(`{type, code}`)도 같은 함수로 바꿨다.
- **`as` 캐스팅을 전부 지웠다**(`as AnyWritingChatTurnEvent` 6곳·`as SseEvent` 1곳). 캐스팅을 지우자 **숨어 있던 결함 1건이 드러났다**: AI-04의 `sources_selected`는 저장 행 모양의 **snake_case**(`sort_order`·`experience_id`…)인데 SSE 계약은 **camelCase**다 → 그대로 나가면 화면의 근거 칩이 하나도 파싱되지 않는다. `toDocumentSseEvent()`를 두어 그 한 자리에서만 이름을 바꾸고, 나머지 이벤트는 캐스팅 없이 타입이 맞는 것을 확인했다.
- **QA 보고서 정정**(리더 승인 2026-11-09): `03_backend-qa_report.md`의 QA-02 항목에 정정 단락을 덧붙이고 상태를 "닫힘"으로 적었다(원문은 지우지 않았다). 아래가 그 내용이다.
- **QA의 영향 판정은 한 단계 과했다.** `src/server/sse.ts`의 `normalizeErrorEvent`가 내보내는 모든 `error` 이벤트를 `aiErrorEvent`로 **다시 조립**하므로 **실제 와이어 모양은 이미 완전했고 C-20 안내도 떴다**. 진짜 결함은 ① 턴이 만든 **객체**가 계약을 어겨 in-process 소비자(테스트)가 버린다 ② 캐스팅이 타입 검사를 우회해 **`sources_selected`의 snake_case 같은 실제 버그를 가린다**였다. 그래서 고칠 가치는 그대로다(오히려 ②가 더 나쁘다).
- 테스트: 실패 경로 이벤트를 **`ErrorEvent` + 각 대화 종류의 유니온으로 파싱**하는 단정을 **서류·산출물·STAR 세 턴 모두**에 더했다(`category`·`failureCause`·`retryable`·한국어 `message`까지 값으로 확인). `sources_selected`의 camelCase 변환 테스트도 더했다(snake_case 키가 하나도 남지 않는지 확인).

### QA-03 [Minor] 고아 거부 코드 16개 — 지웠다

- 지우기 전에 **직접 전수 확인**했다: 로컬 DB(파괴 마이그레이션 적용 상태)에서 코드별 `pg_proc.prosrc` 조회 → 16개 전부 **0개 함수**. `src/` 참조는 `errors.ts` 자신뿐이고, 나머지 일치는 **이미 drop된 함수를 만든 옛 마이그레이션 파일**뿐이다(옛 화면 S-17·S-19가 이 문구를 참조하는 자리 0건).
- 지운 16개: `invalid_draft_sections`·`draft_id_conflict`·`draft_not_found`·`invalid_draft_options`·`invalid_draft_payload`·`invalid_question`·`invalid_section_order`·`invalid_sources`·`invalid_title`·`last_question`·`question_limit_reached`·`section_generating`·`section_id_conflict`·`section_in_progress`·`section_not_found`·`source_not_found`.
- **남긴 6개**(같은 조회로 살아 있는 함수가 쓰는 것을 확인): `invalid_source`(6) · `invalid_value`(5) · `field_already_applied`(3) · `invalid_review_transition`(3) · `field_not_patchable`(1) · `protected_field`(1).

### QA-06 [Minor] 노트 heredoc 찌꺼기 — 지웠다

### 통합 테스트 편입 — `document-chat.integration.test.ts` (4건)

QA의 임시 스모크를 정식 편입하고 **초안 턴(compose)을 더했다**. 실제 로컬 스택·실제 RPC·실제 운영 파이프라인 팩토리(`createDocumentPipelines`)를 쓰고 공급자 어댑터와 키 복호화만 가짜다. 파일 머리에 "왜 이 파일이 있는가"(단위 테스트가 `MemoryChatDb`로 RPC를 대체해 QA-01을 놓쳤다 — `332ec0c`와 같은 유형)를 적었다.

덮는 경로: 정본 저장 → 대화 시작(시작 인사 1행·정본 행 안 만듦) → **질문 턴**(작업 행이 R15 D3 조합을 만족, `error_code ≠ stalled`, 패치 서류 분기 저장, 사용량 2행) → **초안 턴**(아래) → 미리 보기 게이트 409(`ai_jobs` 0건) → 미리 보기 성공(`jd_preview` 행 + `output` + 사용량 1행) → 생성 적용(`preview_applied`) → **`preview_mismatch`**(보낸 해시를 믿지 않음, 버려도 연결은 함) → 로그에 키·본문·문항 문구 없음.

**초안 턴은 이번에 처음 돌았고 통과했다**(QA-01이 막고 있던 경로). 커리어(경력 1 + 완료 프로젝트 1)를 심어 팩에 `EXP-1`·`PRJ-1`이 있는 상태에서: 한 compose 호출이 문항 2개를 쓰고 → `draft_started` → 문항마다 `draft_block` → **문항마다 `draft_done`**(`slot`·`questionNo`·슬롯별 `rev` = 1) → 고정 메시지(`reply_done`, `reply_delta` 없음) → `turn_done`. 저장된 제안은 슬롯마다 1개, `value`는 RPC가 `blocks`로 재조립(R5-DB-5), **블록이 `review = "ok"` + 근거 유지**(근거가 실제 행으로 풀렸다는 뜻 — 팩이 비었으면 `no_evidence`가 된다), CF-S1 `sources` 키 존재.

**초안 턴에서 나온 발견 1건 → spec-gaps `R15-API-7`, 리더 판정으로 해소됐다.** 처음 관측: `apply_structured_draft_patch`가 `draft_count`를 `replace_draft` **연산마다** 올려 문항 2개를 쓴 턴 한 번에 2가 됐다(5문항 자소서는 한 바퀴에 6회 중 5회를 써 수정 바퀴가 막힌다). 담당이 갈릴 수 있어 구현을 바꾸지 않고 보고했다.

**판정 (리더, 2026-11-09): 구현이 틀렸다 — `draft_count`는 턴당 1이다.** AI 명세 C-14가 "제안 단위가 **최대 3문항**이라 자소서 5문항이면 초안 턴 2회면 한 바퀴가 돈다"로 이미 답을 갖고 있었다(6회 = 세 바퀴). db-engineer가 `20261113004660_r15_document_draft_count_per_turn.sql`로 **패치 호출당 +1**로 고쳤다.

- **api 쪽 코드 변경 0건**: `prepareTurn`의 사전 검사(`chat.documentDraft?.draft_count ?? 0 >= COVER_LETTER_DRAFT_LIMIT`)가 같은 `draft_count` 필드를 6과 비교하므로 셈법을 **자동으로 따른다**(이제 "초안 턴 6회"가 된다). AI 쪽 `ctx.draftLimitReached`도 같은 필드를 읽는다.
- **통합 테스트 갱신**: 문항 2개를 쓴 턴의 `draftCount`를 `[1, 1]`·행의 `draft_count`를 `1`로 고치고, **초안 턴 6회가 모두 통과(카운터가 턴 번호를 따라간다)하고 7번째가 `prepareTurn`에서 `writing_chat_draft_limit_reached`(409)로 막히며 그때 사용자 메시지가 저장되지 않는다**는 단정을 더했다(4번째 테스트). 상한이 **세 바퀴를 허용한다**는 것이 이 판정의 핵심이라 그것을 직접 덮는다.

### SSRF 실제 resolver 테스트 편입 — `ssrf-real.test.ts` (15건)

겹치지 않으므로 **편입했다**. 기존 50건 중 SSRF 단위 테스트는 `lookup`을 주입해 **차단 목록만** 보고 운영 해석 경로를 타지 않는다. 이 파일은 `fetchJobDescription`을 **기본 deps 그대로** 불러, 주입 lookup으로는 재현할 수 없는 형태를 덮는다: 10진·8진 IPv4(`2130706433`·`0177.0.0.1`), 미지정 주소(`[::]`·`0.0.0.0`), 끝점 호스트(`LOCALHOST.`), IPv4-mapped 루프백, `file:`·`gopher:`·자격증명 URL. **로그 키가 정확히 5개**(`event`·`host`·`code`·`bytes`·`elapsedMs`)인지도 본다. 모든 케이스가 fetch 전에 거부되므로 외부 트래픽·플레이크 없음.


---

## ⑩ R15 후속 (2026-11-09) — 읽기 쪽 공백 4건 + 복사 기록 + 직접 쓰기 거부 매핑

- 검증: `pnpm typecheck` 통과 · `pnpm lint` 경고 0 · `pnpm test` **150파일 2,429건 전부 통과** (db `20261113004670` 적용·타입 재생성 뒤).
- **`src/lib/data/cover-letters.ts`는 만들지도 고치지도 않았다**(UI 세션 소유). 서버 쪽(`src/server/services/**`·`src/server/actions/**`·`src/lib/contracts/**`)과 `src/types/db.ts`(필드 1개 추가)만 손댔다. 마이그레이션·`supabase/` 미수정.

### UI가 부를 서버 export 목록 (UI 세션에 그대로 전달)

모든 액션은 `"use server"`, 동의 확인된 사용자 세션(RLS = 본인 것만), 반환은 `ActionResult<T>` = `{ data: T } | { error: { code, message, details? } }`. **AI 키·동의·활성 공급자를 보지 않는다.**

| UI stub (cover-letters.ts) | 부를 서버 액션 | 입력 | `data` 모양 |
|---|---|---|---|
| `getCoverLetterDocument(applicationProjectId)` | **`getApplicationDocument`** — `@/server/actions/application-document` | `{ applicationProjectId: uuid, documentKind?: "cover_letter" }` | **`ApplicationDocument \| null`** (`@/types/db`) — 행 그대로(snake_case): `id`·`user_id`·`created_at`·**`updated_at`**·`application_project_id`·`document_kind`·`body {questions[]}`·`meta {tone?}`·`filled_slot_count`·`slot_count`·**`first_copied_at`**. `null` = 행 없음 → 문항 설정 상태 |
| `listCoverLetterSlotCounts()` | **`listDocumentSlotCounts`** — 같은 파일 | **없음**(인자 없이 호출) | **`Record<application_project_id, { slot_count: number; filled_slot_count: number }>`** — 행이 없는 프로젝트는 키가 없다 |
| `markCoverLetterCopied(applicationProjectId)` | **`markApplicationDocumentCopied`** — 같은 파일 | `{ applicationProjectId: uuid, documentKind?: "cover_letter" }` | **`{ firstCopiedAt: string \| null }`** — 저장된 첫 값(두 번째 호출도 첫 값). `null` = 정본 행 없음(복사할 본문 없음). stub이 `Promise<void>`면 값을 버리면 된다 |
| (근거 칩) | **`listApplicationDocumentEvidence`** — 같은 파일 | `{ applicationDocumentId: uuid }` (= `getApplicationDocument`의 `id`) | **`Record<item_key, EvidenceChip[]>`** — `item_key` = `{slot}.blocks.{block_id}`(블록 근거) / `{slot}.sources.{n}`(문항 근거, CF-S1). 각 목록 `sort_order` 순. `EvidenceChip`은 인사이트와 같은 계약(`@/lib/contracts/evidence`) |
| (대화 기록 목록) | **`listDocumentWritingChats`** — `@/server/actions/writing-chat` | `{ applicationProjectId: uuid, documentKind?: "cover_letter" }` | **`ProjectWritingChatSummary[]`** (산출물·STAR와 같은 타입) — `id`·`title`·`status`·`lastActivityAt`·`lastAppliedAt`·`messageCount`·`messageLimit`, `last_activity_at desc` |
| (대화 열기·새로 고침) | **`getWritingChat`** — 기존 액션 그대로 | `{ writingChatId: uuid }` | 서류 대화면 **`DocumentWritingChatDto`**(`target: "application_document"`) — `AnyWritingChatDto` 유니온에 추가됨. `applicationProjectId`·`documentKind`·`structuredDraft`(저장 jsonb 그대로)·`draftCount`·`draftLimit: 6`·메시지·연결 상태·`needsReviewCount`·`canSend` |
| (저장 — 기존) | `saveApplicationDocument` | 기존 | **`expectedUpdatedAt`에 `getApplicationDocument`의 `updated_at`을 넣어야 한다** — 이번 공백의 핵심(아래) |

**`target`으로 분기해야 한다**: `getWritingChat`은 이제 세 모양 중 하나를 돌려준다. S-10·S-44용 데이터 계층(`career-v45.ts`)은 서류 대화가 오면 `null`로 처리하도록 고쳤다(그 패널의 대화가 아니다).

### 1. 정본 1행 읽기 — 데이터 손실 경로를 막는다

- 사실 확인: 사용자 세션으로 `application_documents` 한 행을 읽는 경로가 없었다. S-46이 늘 문항 설정 상태로 열리고, 첫 저장이 기대 버전 없이(`p_expected_updated_at` null = 덮어씀) 나가 **기존 정본을 빈 기본 문항으로 덮어쓰는** 경로였다.
- `src/server/services/application-document/read.ts` `getApplicationDocument(user, applicationProjectId, documentKind = "cover_letter")` → `ApplicationDocument | null`. `body`·`meta`는 저장 RPC가 정하는 모양 그대로 넘긴다(여기서 재조립하지 않는다). `slot_count`는 생성 컬럼이라 생성 타입이 `number | null`이지만 `body`가 not null이므로 `?? 0`.
- `src/types/db.ts` `ApplicationDocument`에 **`first_copied_at: Timestamp | null`**을 더했다(UI stub이 이 타입을 쓴다).
- **화면이 할 일(UI 요청)**: 행이 오면 작성 상태로 열고 그 `updated_at`을 다음 저장의 `expectedUpdatedAt`으로 보낼 것. 그래야 다른 탭·다른 기기의 저장과 충돌하면 `stale_write`(409, `details.current_updated_at`)가 난다.

### 근거 읽기 — 새 경로를 만들지 않았다

- 기존 공용 칩 읽기(`src/server/services/evidence/index.ts` `loadEvidenceChips`)가 `ownerType: EvidenceOwnerType`을 받아 **`application_document`를 그대로 처리한다**(R15 A9에서 그 열거에 들어갔다). 변경됨/삭제됨 판정도 인사이트와 같은 규칙이다.
- 서버 액션 경계를 넘도록 `Map` 대신 **평범한 record**로 돌려주는 얇은 래퍼 `listApplicationDocumentEvidence`만 더했다. UI stub `getCoverLetterDocument`의 반환은 지시대로 **행만**이고 근거는 따로 부른다.
- `user_note` 출처 칩의 라벨은 여전히 폴백이다(spec-gaps R15-API-4 — `source_id`가 `body` 안의 `question_id`라 조인 대상이 없다). 화면이 `body.questions[]`에서 그 문항 문구를 찾아 붙이면 된다.

### 2. 보드용 문항 수

- `listDocumentSlotCounts(user, documentKind = "cover_letter")` → `Record<application_project_id, {slot_count, filled_slot_count}>`. **`application_project_id`·`slot_count`·`filled_slot_count`만 select하고 `body`를 읽지 않는다**(단위 테스트가 select 컬럼 목록에 `body`가 없음을 단정). 카드 판정(표시 없음 / 작성 중 / 작성됨)은 화면 규칙이다(2.7.3).
- 기존 `loadDocumentCounts`(0/1, `progress.ts`)는 **지우지 않았다**(기존 호출부 `services/application/read.ts`).

### 3. 첫 복사 기록 — db `004670`·타입 재생성 확인 뒤 붙였다

- `markApplicationDocumentCopied(user, applicationProjectId, documentKind)` → `{ firstCopiedAt: string | null }`.
- **타입 함정 처리**: 생성 타입은 `Returns: string`이지만 행이 없거나 남의 행이면 실제로 `null`이 온다(db 노트 R15 후속 B). `data as string | null`로 받고 빈 문자열도 `null`로 접는다. **통합 테스트가 "정본 행이 없는 프로젝트 → `null`"과 "남의 행 → `null`이고 그 행은 그대로"를 단정한다.**
- 통합 테스트로 확인한 것: 첫 호출이 값을 기록 → 두 번째 호출이 **같은 값** → 행의 `first_copied_at`이 그 값 → **`updated_at` 불변** → **복사 전 기대 버전으로 저장해도 `stale_write`가 나지 않는다**.

### 4. 서류 대화 읽기 — 새로 고침하면 대화가 사라지던 문제

- `DocumentWritingChatDto`를 `src/lib/contracts/writing-chat.ts`에 신설하고 `AnyWritingChatDto` 유니온에 넣었다. 매퍼 `toDocumentWritingChatDto`는 `chat.ts`에서 **`toDeliverableWritingChatDto`를 그대로 본떴다**(같은 파일·같은 필드 순서·같은 `canSend` 규칙). `DOCUMENT_DRAFT_LIMIT = 6`(초안 턴 6회, R15-API-7 판정).
- **발견한 결함 1건**: `getWritingChat`이 서류 대화를 STAR DTO 분기로 보내 내 R15 가드(`not a project chat`)에 걸려 **500**이 났다. 서류 분기를 더해 고쳤다.
- 목록 `listDocumentWritingChats(user, applicationProjectId, documentKind)` — `where application_project_id = ? and document_kind = ?` `order by last_activity_at desc`, 산출물 목록과 같은 `ProjectWritingChatSummary` 모양.
- **키 케이스 판단**: 기존 대화 DTO 관례를 따랐다 — **`structuredDraft`는 저장 jsonb 그대로(snake_case)**이고 DTO 자기 필드는 camelCase다. 산출물 DTO의 `DeliverableDraftSchema`, SSE `draft_patch`/`facts_patch`의 `structuredDraft`도 전부 snake_case 저장 모양이다. 그래서 `document.questions[].draft.sources[]`는 저장된 `{source_type, source_id, role}`이고 `answer_title`·`draft_count`도 그대로다. **SSE `sources_selected`의 camelCase와 어긋나지 않는다**: 그 이벤트는 저장 초안의 일부가 아니라 **별도의 표시 카드 payload**이고(QA-02에서 깨진 것이 바로 이런 "독립 payload에 저장 모양이 새는" 경계였다), 화면은 저장된 제안을 언제나 `structuredDraft`에서 읽는다. 계약 주석에 이 규칙을 적었다.

### 5. 거부 코드 매핑

- **`direct_write_not_allowed` → 403 `forbidden`**(db 권고·리더 승인 — 권한 문제이지 입력 오류가 아니다), 한국어 문구. 정상 경로(저장·복사 RPC)에서는 나오지 않는다. 단위 테스트 1건.

### 테스트

| 파일 | 추가 |
|------|------|
| `application-document/read.test.ts` (신설 6) | 정본 행 매핑(`updated_at`·`first_copied_at`) · 행 없음 `null` · 다른 프로젝트 행 안 섞임 · 보드 두 값 키잉 · **`body`를 select하지 않음** · 빈 record |
| `application-document/save.test.ts` (+3) | 복사 RPC 인자·반환 · **RPC `null` → 값 `null`(오류 아님)** · `invalid_fields` 매핑 |
| `db/errors.test.ts` (+1) | `direct_write_not_allowed` → 403 |
| `writing-chat/document-chat.integration.test.ts` (+1, 총 5) | 실제 로컬 스택: 저장 전 `null` → 저장 뒤 행(`updated_at` = 저장 결과) · 보드 `{3, 1}` 정확 · 근거 읽기(새 소유자) · **초안 턴 뒤 목록·상세를 처음부터 다시 읽어 `DocumentWritingChatDto`로, 반영하지 않은 제안이 남아 있음**(새로 고침) · 복사 기록(첫 값 유지·`updated_at` 불변·복사 전 기대 버전 저장 통과·행 없음 `null`) · **두 번째 사용자: 정본 `null`·보드 키 없음·근거 `{}`·대화 목록 `[]`·상세 `not_found`·복사 `null`이고 원래 행 불변** |

- 단정은 전부 그 테스트가 만든 프로젝트·대화 id로 범위를 좁혔다 — 다른 테스트나 다른 사용자의 잔여 행이 있어도 통과한다.

### 열린 것

- **UI 요청**: S-46이 열 때 `getApplicationDocument` → 행이 있으면 그 `updated_at`을 기대 버전으로 들고 있을 것(이번 공백의 핵심 — 이게 빠지면 서버를 고쳐도 덮어쓰기는 남는다).
- db 노트가 적은 같은 구조의 우회(`profile_job_interests` 직접 쓰기)는 R15 밖이라 손대지 않았다 — 리더 판단 대상.

---

## ⑪ R15 후속 3 (2026-11-09) — `draft_done.draft` · CF-S7 · `slot_high_water`

- 검증: `pnpm typecheck` 통과 · `pnpm lint` 경고 0 · `pnpm test` **150파일 2,432건 전부 통과** (db `004690` 적용·타입 재생성 뒤).
- `supabase/`·`docs/`·`src/lib/data/cover-letters.ts` 미수정. 커밋·원격 쓰기 없음.

### UI에 넘길 변경점

1. **서류 `draft_done`에 `draft` 필드 추가** — 그 슬롯의 **저장된 제안 객체**를 그대로 싣는다. `structured_draft.document.questions[].draft`와 같다(저장 모양, snake_case):
   `{ answer_title, value, blocks[], sources[], char_count, char_limit_at_generation, char_adjust_needed, correction_applied, rev, generated_at, base_body_hash, replace_allowed, missing_slots[], dropped_block_count, applied_at, applied_rev }`
   - **[반영]은 `draft_done.draft`를 읽어야 한다.** `draft_block`은 글자 수 보정 **전** 스트림이라 보정이 일어나면 문장이 다르다(`correctionApplied: true`).
   - `value`는 DB가 보정 후 `blocks`로 다시 조립한 값이다. `base_body_hash`도 여기 있으니 **`form_snapshot` 본문으로 해시를 다시 만들 필요가 없다.**
   - 기존 바깥 필드(`slot`·`questionNo`·`answerTitle`·`charCount`·`charLimit`·`charAdjustNeeded`·`correctionApplied`·`needsReviewBlockIds`·`droppedBlockCount`·`rev`·`draftCount`)는 **그대로**다(camelCase). `rev === draft.rev`.
2. **저장 반환 11키** — `saveApplicationDocument`의 `data`에 **`slotHighWater: number`** 추가.
3. **`getApplicationDocument`의 행에 `slot_high_water: number`** 추가(`ApplicationDocument` 타입도).
4. **새 문항 번호는 `slot_high_water + 1`부터** 매긴다. 지운 번호를 새 문항에 다시 쓰면 `invalid_slot`(400, `details.field` = 그 slot)이다. 저장돼 있던 문항을 고치는 저장은 영향이 없다.
5. **CF-S7**: 정본 행이 있으면 저장에 **`expectedUpdatedAt`이 필수**다. null이면 `stale_write`(409, `details.current_updated_at`). **"내 내용으로 저장"은 그 `current_updated_at`을 실어 다시 보낸다.** 첫 저장(행 없음)은 null이어도 통과한다.
6. 오류 우선순위가 바뀌었다(db): **`stale_write`(409)가 문항 오류(400)보다 먼저** 나온다. 화면이 409를 받으면 문항 오류는 아직 판정되지 않은 상태다.

### 2. `draft_done.draft` — 리더 판정(S-44와 계약 맞춤, 새 이벤트 이름 없음)

- 계약 `DocumentDraftDoneEvent`에 `draft: CoverLetterQuestionDraftSchema`를 더했다. 산출물 `draft_done.body`와 같은 관례다.
- **"저장된 값"을 싣는다**: 러너는 이미 패치 RPC의 **응답**(`res.draft`, DB가 쓴 뒤의 `structured_draft`)에서 그 슬롯의 `rev`를 읽고 있었다. 같은 객체를 `draft`로 싣는다. 파이프라인이 패치 전에 들고 있던 객체(`value` 없음)는 쓰지 않는다. 다시 읽기 왕복이 없다.
- **통합 테스트로 보정 경로를 덮었다**: `char_limit` 1,000에 한 문장 초안 → 범위 밖 → 보정 호출 1회. 단정:
  - `adjusting_length`가 나오고 `correctionApplied: true`다.
  - **`draft_block` 텍스트(보정 전) ≠ `draft_done.draft.blocks`(보정 후)**이고, 후자에 보정 문장이 들어 있다.
  - **`draft_done.draft`가 DB `structured_draft`의 그 슬롯 초안과 깊은 비교로 같다**("SSE 초안 == 저장 초안"). `value`도 같고 보정 문장을 포함한다. `correction_applied: true`다.
  - 안쪽 키가 저장 모양(`base_body_hash` 존재)이고 바깥에 snake_case 키(`draft_count`)가 새지 않는다.
- QA-02 회귀 단정(`sources_selected` 키에 `_` 없음)은 그대로 통과한다. 그 단정은 **`sources_selected` 이벤트**만 본다. `draft_done.draft`는 저장 모양을 일부러 그대로 싣는 자리다(⑩ "키 케이스 판단"과 같은 규칙: 저장 초안은 snake_case, 독립 표시 payload는 camelCase).

### 1. CF-S7 = (a)

- `stale_write` → `details.current_updated_at` 변환은 **이미 있었다**(`src/server/db/errors.ts` `raiseDetails`). 확인만 했고 바꾸지 않았다.
- **회귀 확인**: `src/`에서 같은 서류를 기대 버전 없이 두 번 저장하는 곳은 **없었다**. 통합 테스트는 각 `it`이 새 지원 프로젝트를 만들어 한 번 저장한다. 다시 저장하는 유일한 자리(⑩ 복사 기록의 `resaved`)는 이미 `expectedUpdatedAt`을 보낸다. 실제 RPC를 쓰는 통합 테스트는 `004690` 뒤에도 수정 없이 전부 통과했다. 깨진 것은 `save.test.ts` 가짜 RPC 픽스처 4건뿐이고, 원인은 CF-S7이 아니라 **반환 11번째 키(`slot_high_water`)가 계약에서 필수**가 된 것이다. 픽스처를 실제 반환 모양으로 맞췄다. **단정은 약하게 하지 않았다**(오히려 "옛 RPC 반환(10키)이면 500" 단정을 더했다).
- 400/409 겹침 순서를 단정하는 서류 테스트는 `src/`에 없다(그 우선순위는 db pgTAP이 덮는다).
- **새 통합 테스트**(실제 RPC):
  - 첫 저장(행 없음 + null) 통과.
  - **행 있음 + null → `stale_write` 409, `details.current_updated_at` = 첫 저장의 `updated_at`. body·`updated_at` 불변.**
  - **"내 내용으로 저장" = 그 값을 실어 다시 보내면 통과하고, 그 내용이 정본이 된다.**

### 3. `slot_high_water`

- `getApplicationDocument`의 명시 select에 추가했다. `ApplicationDocument`(`src/types/db.ts`)에 `slot_high_water: number`(not null default 0)를 넣었다. 저장 반환 계약 `SaveApplicationDocumentRpcResult`에 `slot_high_water`, 서비스 결과에 `slotHighWater`를 넣었다.
- **같은 통합 테스트**: 첫 저장 `q_1..q_3` → 3(반환·읽기 둘 다) → `q_3`을 지우고 저장해도 3 유지 → **`q_3`을 새 문항으로 다시 넣으면 `invalid_slot`(`details.field = "q_3"`), 아무것도 안 바뀜**(`slot_count` 2 유지) → `q_4`는 통과하고 4가 된다.
- `DocumentQuestion`은 `.strict()`라 `sort_order`를 받지 않는다. 지시대로 **바꾸지 않았다**(순서 = 받은 배열 순서, 2.5.1).
