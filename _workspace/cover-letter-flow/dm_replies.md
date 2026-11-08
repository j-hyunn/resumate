# data-architect 회신 — 사이클 `cover-letter-flow` (DM v4.14)

- 작성: data-architect, 2026-11-08
- 대상: `_workspace/cover-letter-flow/prd_requests.md`의 data-architect 요청 9건 (+ ai-feature-designer 요청 5의 데이터 쪽 답)
- 이름의 정본은 `docs/planning/04-data-model.md` v4.14(3.9 이름 확정 표). 본문 위치를 괄호에 적었다.
- ⚠ = PRD·UX·AI가 고쳐야 할 이름이나 서술이 있다.

| # | 요청 | 확정 회신 |
|---|------|-----------|
| 1 | `document_kind`를 `cover_letter` 하나로 좁히고 정본 1행 | **반영.** `application_documents.document_kind`·`writing_chats.document_kind` CHECK = `cover_letter` 1값(컬럼은 남김), `unique (application_project_id, document_kind)` = 지원 프로젝트당 1행(CF-A2). `start_document_writing_chat`·`save_application_document`는 시그니처 그대로 두고 `cover_letter`만 받는다. 11.8이 아직 배포 전이라 기존 행이 없다(2.5·2.7.3·11.8) |
| 2 | `answer_title` (정본·제안 둘 다) | **반영.** 정본 `application_documents.body.questions[].answer_title`(text ≤ 100자, null), 제안 `structured_draft.document.questions[].draft.answer_title`, 패치 `replace_draft`의 인자 `answer_title`, 턴 스냅숏 `formSnapshot.questions[].answer_title`. 글자 수 계산·`filled_slot_count`에 넣지 않는다 — **제목만 있고 본문이 빈 문항은 "작성됨"으로 세지 않는다** `[가정]`. 이관 행은 null(2.5.0b·2.5.1·2.7.3) |
| 3 | `job_descriptions.source_url` | **반영 ★.** text null, CHECK http(s)·≤ 2,048자 `[가정]`. 생성 RPC만 쓴다(사용자 직접 update 없음), `app_ai_writer` grant 없음(AI 입력 아님). 생성 RPC 인자 **`p_source_url`**, 오류 **`invalid_source_url`**(400) `[가정]`. 저장 원문은 2단계 확인 텍스트뿐, 가져온 원본은 두지 않는다. URL 가져오기 = `POST /api/job-descriptions/fetch` `[가정: 이름]`, DB·`ai_jobs`·사용량 기록 없음(2.6·2.6.2·11.9 (3)) |
| 4 | 행을 만들기 전 추출 결과의 임시 자리 | **CF-A17(리더 정정) 기준으로 정했다 (2.6.2).** ① [다음]의 AI-01 = **`POST /api/job-descriptions/extract-preview`** `[가정: 이름]`, 행을 만들지 않는다. ② 기록은 **`ai_jobs` 1행** — `job_type = 'jd_extraction'`, **`target_type = 'jd_preview'`(새 값)**, **`target_id`·`application_project_id` null**, 검증된 결과는 그 행의 `output`. `ai_jobs_jd_extraction_check` 완화 ★. ③ 사용량 `ai_usage_records`는 호출마다 `feature = 'jd_extraction'`, **`application_project_id` null**(새 값 없음). ④ [자기소개서 작성] = `create_application_project(…, p_source_url, **p_preview_job_id**)` 1회 — 작업 행에 새 JD·지원 프로젝트를 **연결**하고 사용량 행도 그 지원 건으로 채운다. 원문 해시가 같으면 같은 트랜잭션에서 요건·`deadline`을 **적용**하고, 다르면(2단계에서 공고 내용을 고침) **버리고** 생성 뒤 보통 AI-01 1회를 돈다(키 있을 때). 반환 `preview_applied`·`preview_skip_reason`. ⑤ **모달을 닫으면** 지원 프로젝트·JD 행은 생기지 않고, 작업·사용량 행만 지원 건 없이 남는다(미터 "요건 추출"에 보임). 쓰이지 않은 `output`은 24시간 뒤 비운다 `[가정]`. Q53-1(JD 없는 행 없음)과 D-30(a)(키 있으면 자동 추출) 둘 다 성립한다. ⚠ **CF-A17 문구와 다른 점 1개**: 모달이 요건 전체를 들고 있다가 보내지 않고 **`previewJobId`와 표시 값(회사명·포지션명)만** 든다. 화면이 보낸 요건이 `origin = ai`·공급자 배지로 저장되는 위조 경로를 막고, 작업 행은 사용량 때문에 어차피 생기기 때문이다 — 리더 확인 요청. PRD F-P2-02 "데이터 모델 몫"은 이 2.6.2를 가리키면 된다 |
| 5 | `deadline` date·null, AI 값은 비어 있을 때만 | **반영 ★.** 타입 `date` 그대로. `apply_jd_extraction`(그리고 미리 보기 적용)이 **`deadline is null`일 때만** AI-01 `deadline`을 쓴다. 변환할 수 없는 값은 무시한다. 사용자 세션 직접 update(column grant)는 그대로다. 출처 컬럼(`deadline_source`)은 두지 않는다 `[가정]` — 대가: 원문 수정 뒤 다시 추출하면 사용자가 일부러 비운 마감일이 다시 채워질 수 있다(입력 원인 실패 JD에서만 일어나 드물다)(2.6) |
| 6 | 사용량 `feature` `career_description` 유지 + 과거 기록 합산 | **반영.** `ai_usage_records.feature`·`ai_jobs.job_type` CHECK에 `career_description`(+ `draft_source_ranking`)을 남기고 새 기록은 만들지 않는다 `[가정]`(CF-A3). **과거 기록 합산 (AI 요청 5와 같은 답): 합친다** — 표시 7행의 "자기소개서 작성 AI 채팅"은 지금처럼 `career_description` + `cover_letter`를 화면에서 합산한다. 이번 달·지난달에 남은 과거 경력기술서 기록도 그 행에 들어간다. RPC·응답·화면 매핑 상수 **변경 없음**. 별도 행을 만들면 0이 될 행이 생기고, 빼면 그 달 합계가 공급자 청구와 어긋난다(2.9.2·2.9.5) |
| 7 | 이관 범위 확대 | **반영 (11.8).** 4단계 = `draft_type = 'cover_letter'`만, 6단계에 **`career_description` 행 전부**, 5단계 근거 행 전부 `draft_section`으로 남김, 7단계 증거 #1의 개수 셈 수정. **7단계에서 경력기술서 초안은 되돌릴 수 없이 사라지고 운영자 덤프만 남는다**고 명시했다. `[결정 필요]` CLA-Q3은 "넓어졌다"로 고쳐 열어 두었다. 손실 안내 `{n}`: 경력기술서 행은 전부 "옮기지 못한 행"이므로 **`{n}` = 6단계 집합의 그 사용자 행 수**(경력기술서 행 + 자소서 쪽 건너뛴 행)가 되고, 판정 수단은 여전히 `[결정 필요]` CLA-Q4다(매핑 표로 판정하는 (a)면 6단계 집합을 7단계까지 보관하는 매핑 표에 함께 넣으면 된다). 새 `[결정 필요]` **CF-DM-2** — 이미 6~10문항인 자소서의 이관(권고 (a): 그대로 옮기고 문항 수를 늘리는 저장만 막음) |
| 8 | 서류 수·`get_deletion_impact` 서류 부분 | **반영.** CLA-Q2는 해당 없음으로 닫았다. 남는 값: **보드 카드 "작성됨" = `application_documents` 행이 있고 `filled_slot_count > 0`, 나머지는 "작성 중"** `[가정]`(0~1, "작성 전"을 따로 보일지는 UX). `get_deletion_impact`의 `application_project` 반환 서류 키는 0~1, 커리어 삭제의 `documents`·`document_sections`는 자소서만 센다(키 이름은 코드 변경을 줄이려고 그대로). `get_account_deletion_summary`의 서류 수 = 자소서가 작성된 지원 건 수(반환 키 그대로)(2.7.3·4.2·4.3) |
| 9 | 목록 정렬 `created_at desc` | **반영 ★.** 목록 읽기 = `application_projects`(id, name, created_at, deadline) + `job_descriptions.position_title`, `order by created_at desc`. 이 정렬을 받칠 인덱스가 지금 없어서 **`(user_id, created_at desc)` 신설**(비파괴). 행 날짜도 `created_at`(KST). 목록은 단계·인사이트·서류 수·면접 수를 읽지 않는다(2.6·6.1 F-AP-02·7장) |

## 함께 알릴 것 (PRD·UX·AI)

- **이름 규칙** "{company_name} 자기소개서": 회사명이 비면 "새 자기소개서 (YYYY-MM-DD)". `name_source` 3값의 뜻 — `user` = 사용자가 입력·확인한 회사명으로 만든 이름 또는 직접 바꾼 이름 / `ai` = AI 추출 회사명 / `default`. **2단계에서 보낸 회사명·포지션명은 AI 값을 미리 채운 것이어도 `user`로 저장한다**(사용자가 확인한 값이 최종 — CF-A6) `[가정]`. **이미 저장된 이름은 바꾸지 않는다** `[가정]` — 기존 지원 건은 목록에 "회사명 – 포지션명"으로 남는다.
- **AI-11·`document.source_ranking` 폐기** `[가정]` — AI 명세 v4.14와 같은 결론이다.
- ⚠ UX 요청 4(키가 있고 `JobPosting` 값도 있을 때)는 CF-A6 정정이 정했다(AI 값 우선). 데이터 쪽은 어느 값이 이기든 2단계에서 보낸 값만 저장하므로 영향이 없다.

---

## UX 요청 회신 (정렬 라운드 — `ux_requests.md` DM-1~DM-10, DM v4.14 같은 판)

- 작성: data-architect, 2026-11-08. 본문 반영은 두 DM 파일(`docs/planning/04-data-model.md` = `_workspace/02_data-architect_data-model.md`)에 같게 했고 바뀐 문장에 `(v4.14 정렬, …)`을 달았다. 새 이름은 3.9 표 끝에 모았다.

| # | 요청 | 회신 |
|---|------|------|
| DM-1 | "AI 없이 계속"으로 만든 자기소개서에서 생성 때 추출을 하지 않게 하는 방법 | **`[결정 필요]` CF-U1 (Q53-1 변경 여부)** — 확정하지 않았다. 사실관계: 지금 규칙(Q53-1, 2026-10-30 확정)에서는 [다음]에서 409를 받고 2단계로 넘어가도 **[자기소개서 작성]의 생성 게이트가 같은 409로 다시 막는다**(활성 공급자 있음 + 키 무효/동의 없음). readiness로 서버가 판정하는 방법은 성립하지 않는다(게이트가 그 판정이다). 활성 공급자가 **없는** 경우는 지금도 통과해 추출 없이 만들어지고 인자도 필요 없다(D-30). 두 안의 데이터 경로: (a) Q53-1 유지 — 변경 없음, 만들기는 키·동의를 고친 뒤 / (b) Q53-1 변경 — 생성 RPC에 명시 인자(후보 `p_without_ai boolean default false`)를 더해 게이트를 건너뛰고 `extraction_status = 'pending'`으로 만들며 서버 액션이 생성 직후 AI-01을 돌리지 않는다. 새 컬럼·표식 없음(`pending`이 이미 "추출 전"이고 뒤 추출 자리는 경로 ⑤ 게이트를 탄다), `p_preview_job_id`와 함께 오면 `invalid_fields`. 본문은 (a)(현행)로 쓰고 (b)는 2.6.2·8장 CF-U1에만 적었다. ⚠ UX v5.19의 "'AI 없이 계속'이면 생성 때 추출 없음 `[가정]`"은 CF-U1이 (b)일 때만 성립한다 |
| DM-2 | 2단계 값의 출처·이름 규칙·백필·100자 | **확인.** 2단계에서 보낸 회사명·포지션명은 미리 채운 값이어도 `company_name_source`·`position_title_source = 'user'`, 이름 "{기업 명} 자기소개서" `name_source = 'user'`. 기업명이 비면 기본 이름 + `default`, 뒤에 추출이 회사명을 찾으면 "{AI 회사명} 자기소개서"(`ai`). **덧붙임**: 빈 칸으로 보낸 칸은 미리 보기를 적용할 때 AI 값으로 채워진다(`ai`) — 일부러 지운 칸과 구분하지 않는다 `[가정]`. 기존 "회사명 – 포지션명" 이름 백필 없음 동의(`[가정]` 유지 — S-13에 두 모양이 섞인다). 100자 = 회사명 앞 94자 + " 자기소개서"(2.6) |
| DM-3 | S-46 두 상태의 판정 원천 | **행 유무 판정 확정.** 정본 행을 만드는 길은 **`save_application_document` 첫 저장과 11.8 이관 4단계뿐**이다 — 대화 시작·턴·요건 추출은 행을 만들지 않는다. 이관 행은 문항 1개 이상일 때만 생긴다. `p_body.questions`는 길이 0도 받는다 `[가정]` → 작성 상태에서 문항을 모두 지워 저장하면 "행 있음·문항 0개" 작성 상태가 된다(문항 설정으로 돌릴지는 UX — 판정에 `slot_count = 0`을 더하면 된다). ⚠ **[자기소개서 작성 시작]은 요건 추출(필요할 때) → 성공 뒤 저장** 순서여야 FL-03 "실패하면 문항 설정 상태에 머문다"가 성립한다(먼저 저장하면 다음 방문은 작성 상태) `[가정]`(2.5.1 "정본 행이 생기는 때") |
| DM-4 | 머리 이름·마감일 저장 경로 | **① 같은 트랜잭션 RPC — 인자 추가로 정했다.** `save_application_document(…, p_client_id, **p_application_values jsonb default null**)` = `{name, deadline}`(키 없으면 유지). 한 번의 "저장하기" = RPC 한 번이라 한쪽만 성공하는 경우가 없다. `stale_write`면 이름·마감일도 쓰지 않는다. 기대 버전은 서류 `updated_at` 하나라 **이름·마감일만 바꾼 두 탭은 나중 저장이 이긴다** `[가정]`. **이름을 비우면** 내부 헬퍼 **`private.application_reset_name`** `[가정: 이름]`이 지금 회사명으로 "{회사명} 자기소개서"(출처는 `company_name_source`를 따름), 회사명이 없으면 기본 이름(`default`). 이름 100자 초과 `field_too_long`(details `application.name`), 마감일 형식 오류 `invalid_fields`(details `application.deadline`). 반환에 `name`·`name_source`·`deadline`·`slot_count` 추가. ⚠ UX의 "두 쓰기를 차례로 보낸다 `[가정]`"을 이 한 호출로 바꿔 달라 |
| DM-5 | 문항 수 상한의 거부 코드 | **`too_many_questions`**(400, details `{limit: 5, current: n}` — `current` = 저장돼 있던 문항 수, 행이 없으면 0) `[가정: 이름]`. 판정 = **보낸 수 > 5 이고 저장돼 있던 수보다 많을 때만** — 6~10문항 행은 고치기·줄이기가 되고 늘리기만 막힌다. CF-DM-2가 어느 안이 되든 같은 식이다. `field_too_long`과 나눈 이유는 문구와 `details`(개수)가 달라서다(`too_many_job_interests` 선례). 화면 문구 "지금 {n}개라"의 n = `current` |
| DM-6 | `get_deletion_impact('application_document', …)`를 남길지 | **11.8에서 만들지 않는다** `[가정]`(CF-A9 — 정본 비우기를 부르는 화면이 없다). 되살릴 때는 v4.13 모양 그대로. RLS delete 본인 정책은 남긴다(지우면 S-46이 문항 설정 상태로 돌아간다). 지원 프로젝트 삭제 영향의 `cascade.documents`·`document_chats`는 키를 남기되 화면이 읽지 않아도 된다 |
| DM-7 | 보드 카드 판정에 문항 수 | **`application_documents.slot_count`** 신설 — `generated always as (jsonb_array_length(coalesce(body->'questions','[]'))) stored`(본문이 비어도 세는 문항 수). 판정 `[가정]`: 표시 없음 = 행 없음 또는 `filled_slot_count = 0` / 작성 중 = `0 < filled_slot_count < slot_count` / 작성됨 = `filled_slot_count = slot_count`. 제목만 있는 문항은 `filled_slot_count`에 들지 않는다(UX와 같음). ⚠ 내가 앞 회신 8에서 쓴 "작성됨 = `filled_slot_count > 0`"은 이 식으로 바뀐다 |
| DM-8 | 관찰 기간 읽기 경로·`{n}` | **새 RPC·뷰 없음** — 7단계까지 남기는 `drafts`·`draft_sections` select 본인 RLS를 S-13 머리 [초안 보기]가 읽는다. 대상 = 6단계 집합의 그 사용자 `drafts` 행(경력기술서 전부 + 건너뛴 자소서 행). **어느 행을 고르느냐가 `[결정 필요]` CLA-Q4**: (a) 매핑 표면 운영자 전용이라 **definer 조회 함수 1개**가 필요(이름은 CLA-Q4 뒤) / (b) 표식 컬럼이면 RLS 조건만 / (c) 전원 공지면 판정 없이 전부(옮긴 행도 보임). 한 줄 = `drafts` 행 1개(지원 건 이름 · 종류 · `created_at`), 본문 = `draft_sections` `sort_order` 순으로 4단계와 같은 마크다운 조립. **`{n}` = 그 행 수**(섹션 수 아님), (c)면 `{n}` 없음. `{날짜}` = CLA-Q5(11.8 머리 "관찰 기간 읽기 경로") |
| DM-9 | 목록 값·인덱스 | **확인.** "만든 날" = `application_projects.created_at`(KST `yyyy.mm.dd`), 정렬 `created_at desc`, 인덱스 `(user_id, created_at desc)` 신설 ★(이미 11.9 #5) |
| DM-10 | `source_url` 저장 조건 | **남긴다.** 가져오기에 실패하고 직접 붙여넣은 경우에도 1단계에 넣은 URL을 저장한다. URL을 넣지 않았으면 null. `invalid_source_url`(400)은 인자 검사 단계라 행이 없으므로 **같은 `p_id`로** 주소만 빼고 다시 보내면 된다(UX 동작 그대로). 추적 쿼리는 지우지 않고 저장, 로그에는 남기지 않는다 `[가정]` |

## AI 요청 회신 (정렬 라운드 — `ai_requests.md` data-architect 1~9)

| # | 요청 | 회신 |
|---|------|------|
| 1 | 쓰이지 않은 `jd_preview` 작업 정리, 사용량 행은 남김 | **확정 `[가정]`**: 연결 안 된 작업은 `finished_at` + 24시간 뒤 `output` → null·`step_outputs` → `'{}'`(기존 정리 크론 1줄). 작업 행은 다른 작업처럼 **90일** 뒤 삭제 — 그때 `ai_usage_records.ai_job_id`는 기존 복합 FK `on delete set null`로 비고 **사용량 행은 13개월 그대로**(`application_project_id` null, 미터 "요건 추출"). 남는 것은 해시·메타뿐. 별도 테이블·크론 없음(2.6.2) |
| 2 | `params.raw_text_hash`를 C-2 분할과 같은 정규화로 | **확정 ★(코드)**: 서버 함수 하나(`normalizeJdRawText` `[가정: 이름]`)로 정규화한 **같은 문자열**로 분할·해시·저장 원문을 만든다(미리 보기·생성·원문 수정 세 경로). 정규화 `[가정]`: `\r\n`·`\r` → `\n`, NFC, 앞뒤 공백 제거, 안쪽 공백은 그대로(저장 원문이 곧 정규화 문자열이라 오프셋이 맞는다). 지금 코드는 입력 그대로 해시한다 → 함수를 끼우는 것이 ★. **덧붙임**: 생성 RPC는 보낸 `p_raw_text_hash`를 믿지 않고 `p_raw_text`로 sha256을 **다시 계산**해 비교하고 `jsonb_array_length(p_sentences) = params.sentence_count`도 본다(직접 호출로 다른 원문에 미리 보기를 붙이는 경로 차단, 11.9 #9) |
| 3 | `apply_jd_extraction` 마감일 | **확정.** `deadline.value`를 `application_projects.deadline is null`일 때만 쓴다(재추출·미리 보기 적용도 같음). `deadline.source_sids`는 회사명 규칙과 같게 검사(분할 밖 sid → 값만 버림). **지난 날짜·366일 초과도 RPC가 다시 검사해 쓰지 않는다** `[가정]` — 쓰기 판단을 RPC 한 곳에 두어 미리 보기 적용(생성 시점 기준일)과 보통 추출이 같은 규칙을 탄다. 값은 `extraction.deadline`에 남는다. `deadline_source`는 두지 않는다(권고 수용) |
| 4 | `extraction` 스키마 1 → 2 | **확정.** `job_descriptions.extraction.schema_version` 2, **1판 행은 `deadline` 없음 = null로 읽는다**. 백필·DB CHECK 없음. `apply_jd_extraction`은 키가 없으면 마감일을 건드리지 않는다. 미리 보기 `ai_jobs.output`도 2판 |
| 5 | `answer_title` 계약 | **①~⑤ 모두 수용.** 근거 행 없음(`item_key`에 제목 자리가 없다), `char_count`·`char_limit_at_generation`·`char_adjust_needed` 제외, `user_modified`(블록 키) 제외, 100자 초과 = `field_too_long`(details `questions.q_n.answer_title`), [반영]은 제안에 제목이 있을 때만. 검증에서 버린 제목은 `null`. **`structured_draft` 자소서 모양의 `schema_version`은 올리지 않는다(1 유지)** — 11.8 미배포라 1판 행이 없고 처음부터 `answer_title`을 담은 1판으로 만든다(AI-04 출력 3 → 4와는 별개 번호)(2.5.0b) |
| 6 | 과거 `career_description` 표시 | (해소) 같은 답 — 표시 행에서 화면이 합산 |
| 7 | `job_type` CHECK 잔여와 조합 CHECK | **CHECK에 `career_description`·`draft_source_ranking` 남김**(CF-A3, 새 행 없음). **조합 CHECK(`job_type in ('career_description','cover_letter')` ⇒ `application_project_id` not null)도 목록 그대로** — 그 조합의 `career_description` 행이 0개라 무해하고, 값을 뺄 때 두 CHECK를 함께 고친다. 빼도 되는 시점: `ai_jobs`는 마지막 과거 행이 90일 정리로 사라진 뒤, `ai_usage_records`는 13개월 뒤(그때도 별도 판단). "대화 턴" 집계는 계속 `career_description` 포함(2.9.1) |
| 8 | 게이트 복귀 대상 | **확정 — 새 값은 `cover_letter`뿐.** 테이블 CHECK `writing_chats_return_target_check`에는 `career_description`을 남기고(기존 커리어 대화 행, 자동 삭제 없음) **`start_writing_chat`의 `p_return_target` 허용 목록에서 뺀다 ★**(새로 보내면 `invalid_return_target` 400, 11.9 #8 — 최신 정의 `20261110000100_r5_deliverable_writing_chats`). 서류 대화 자체의 `return_target`은 지금처럼 null 고정 |
| 9 | 문항 상한 | **같음** — 정본 슬롯 ≤ 5(저장 거부 `too_many_questions`, 늘리는 저장만), 섹션 ≤ 30은 새 행에서 없다. 6~10문항 이관은 `[결정 필요]` CF-DM-2 |

## 이번 라운드에 새로 붙인 이름 (리더 정렬용)

| 이름 | 자리 | 상태 |
|------|------|------|
| `p_application_values` (`{name, deadline}`) | `save_application_document` 마지막 인자 | 확정(DM) |
| `private.application_reset_name` | 내부 definer 헬퍼 | `[가정: 이름]` |
| 반환 키 `slot_count`·`name`·`name_source`·`deadline` | `save_application_document` 반환 | 확정(DM) |
| `too_many_questions` (details `{limit, current}`) | 저장 RPC 거부 코드 400 | `[가정: 이름]` |
| `application_documents.slot_count` | 생성 컬럼 | 확정(DM) |
| `normalizeJdRawText` | 서버 함수 | `[가정: 이름]` |
| `p_without_ai` | 생성 RPC 인자 **후보** | `[결정 필요]` CF-U1이 (b)일 때만 |
| `deadline` = `{value, source_sids}` | AI-01 출력 모양(AI 명세 쪽 이름을 DM이 따름) | 확정 |

## 남은 열린 것

- **`[결정 필요]` CF-U1** (신규) — "AI 없이 계속" = Q53-1 변경 여부. 리더 → 사용자.
- `[결정 필요]` CF-DM-2(6~10문항 이관), CLA-Q3~CLA-Q7(이관 범위·관찰 기간 판정·기간·근거 행·덤프) — 그대로 미답. DM-8의 대상 행·`{n}`은 CLA-Q4에 묶여 있다.
- `[가정]`으로 남긴 것: 보드 카드 3상태, 빈 이름 → 기본 이름, 이름·마감일 두 탭 경합(나중 저장이 이김), `questions` 길이 0 허용, [작성 시작] 순서(추출 → 저장), 빈 칸으로 보낸 회사명의 AI 채움, 미리 보기 정리 24시간, 원문 정규화 단계, RPC 마감일 기간 검사, `application_document` 영향 종류 미구현, `source_url` 추적 쿼리 보존.

## 리뷰 라운드 1 반영 (R-CF-4·9·10·16, DM v4.14 같은 판)

- **R-CF-4**: 2.6.2 표·"AI 없이 계속" (a)안·8장 CF-U1 (a)를 Q53-1 유지 기준으로 고쳤다 — 409면 화면은 1단계에서 막고 2단계로 가지 않는다. 생성 게이트는 대비용이다. "AI 없이 계속"은 CF-U1이 (b)일 때만이다(위 DM-1 회신도 이 뜻으로 읽는다).
- **R-CF-9**: CL-Q1 수치를 AI v4.14 7.3a 값으로 바꿨다(2.5.0b·2.9.4·8장).
- **R-CF-10**: 폐기된 화면·기능 잔재(허브·서류 3종·AI-11·S-45·S-31·S-17)를 정리했고, 6.1에 F-P2-10 행을 더했다.
- **R-CF-16**: `char_limit`는 새 저장에서 필수다(null·빈 값이면 `invalid_fields`, details `questions.q_n.char_limit`) `[가정]`. 이미 null인 이관 행은 null 유지를 허용하고, 이관은 null을 그대로 옮긴다. 서버 시드·기본값은 없다(F-DOC-02 — CF-U2가 (a)여도 화면이 값을 보낸다). null 문항에서의 AI-04 동작은 AI 명세 몫이다.

## 사용자 확정 반영 (2026-11-08)

- **CF-U1 = (a) Q53-1 유지**: 위 DM-1 회신의 (b) 경로와 "새로 붙인 이름" 표의 후보 `p_without_ai`는 **채택하지 않는다(만들지 않는다)**. 생성 RPC·게이트는 변경 없다.
- **CF-U2 = 글자 수 기본값 800자**: 화면이 기본 3문항·새 문항에 800을 채워 보낸다. 서버 시드·DB 기본값은 계속 없다. 저장 값 필수 규칙(R-CF-16)과 이관 null 예외는 그대로다.
- **CF-U3 = 시안대로(서류도 "자기소개서")**: 화면 표기만 바뀐다. 데이터 이름(`cover_letter`·`application_documents`·`document_kind`)은 그대로다.
