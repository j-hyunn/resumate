# R15 슬라이스 계획 — 자기소개서 관리 영역 백엔드 (cover-letter-chat 11.8 + cover-letter-flow 11.10)

- 날짜: 2026-11-09
- 기준 문서(정본): `docs/planning/decisions.md` **4.23**(CF-*) · `docs/planning/04-data-model.md` **11.8**(CL-*, 미배포) + **11.10**(CF-*, ★ 구현된 객체) · 1장(결정 대기 **0건**)
- 함께 읽을 절: DM 2.5·2.5.0·2.5.0b·2.5.1·2.6.2·2.7.3·2.7.4·2.8·2.9.1·4.2·4.5·5장·6장·7장 / AI v4.15 0.v415·C-1·C-2·C-3·C-15·AI-01·AI-04 / UX v5.20 S-13·S-14·S-46·5.1n / PRD v4.17
- 기준 판: **DM v4.15 · AI v4.15 · UX v5.20 · PRD v4.17**. 이보다 낮은 판의 서술(v4.13 경력기술서·섹션·AI-03·AI-11, 관찰 기간·이관·운영자 덤프)은 **폐기된 설계**다.
- 직전 슬라이스: R14(`20261113003000_r14_remove_mock_interview`). **새 마이그레이션 번호는 `20261113003100`부터.**
- 상태 확인(2026-11-09): `supabase/`·`src/`에 `application_documents`·`start_document_writing_chat` **없음** → 11.8은 전부 신규. `src/server/services/drafts/*`, `/api/application-projects/[id]/career-descriptions`, `/api/application-projects/[id]/draft-source-ranking`, `/api/draft-sections/[id]/generate`는 **폐기 대상**으로 살아 있다.

## 0. 확정 전제 (어기면 폐기된 설계를 구현하게 된다)

1. **CF-1 경력기술서는 서비스에서 빠졌다.** 서류는 자소서 문항 답변 하나. **AI-03·AI-11 구현하지 않는다.** `document_kind`는 컬럼을 남기고 CHECK는 `cover_letter` 1값(CF-A2). `body.sections[]`·`heading_label`·`section_order_proposal`·`source_ranking`·슬롯 키 `s_{n}` 전부 폐기.
2. **CF-M1 이관하지 않는다.** 운영 DB 옛 초안 0행 확인. `drafts`·`draft_sections`·`draft_section_sources`는 **이관 없이 drop**하되 **행이 하나라도 있으면 `raise exception`으로 멈추는 가드**를 drop 마이그레이션 안에 둔다. `migration_note` 컬럼·관찰 기간·운영자 덤프·S-13 안내·읽기 경로는 **만들지 않는다**.
3. **CL-Q1** RAG 전까지 모든 턴에 전체 커리어 팩. 지킬 설계 제약 2개 — ① 커리어 컨텍스트 조립을 갈아 끼울 수 있는 **한 지점**(팩 빌더) ② 항목·조각마다 출처 별칭(`EXP`·`EDU`·`PRJ`·`DLV`·`SKL`). 기존 팩 빌더 구조를 유지·강화하고 우회 조립을 만들지 않는다.
4. **CF-10 공고 URL 가져오기는 Must.** 서버가 가져온다. SSRF 차단·10초·2MB·리다이렉트 3회(매번 재검사)·200자 미만 실패. **AI를 쓰지 않으므로 키 없이 동작하고 `ai_jobs`·`ai_usage_records`·사용량 미터에 남기지 않는다**(CF-A15·A16).
5. **CF-A17 미리 보기 추출**은 `POST /api/job-descriptions/extract-preview` → `ai_jobs.target_type = 'jd_preview'` 행, 생성 RPC가 `p_preview_job_id`로 **서버 작업 행의 `output`에서 결과를 읽는다**. 화면이 보낸 요건을 `origin='ai'`로 저장하는 위조 경로를 막는 설계 — 모양을 바꾸지 말 것.
6. **모의 면접은 RM-1~RM-5로 MVP에서 빠졌다.** 면접 관련 코드·분기·CHECK 값을 되살리지 않는다. R14가 교체한 함수·CHECK는 **R14 정의에서 시작**한다(11.10 머리 ②).
7. **사용자 결정 대기 0건**(decisions 1장). 구현 중 결정이 필요해지면 **여기서 정하지 말고** 기획 검토 세션(`local_6c265c4a-0a2e-4e53-8e52-a6fc0459717d`)으로 올린다. 구현 세부(컬럼 이름·인덱스·오류 코드 문자열)는 관례대로 정하고 `[가정]`으로 기록한다.

## 1. 범위

### 1-A. DB — 비파괴 (배포 1~3단계, 한 릴리스로 묶어도 됨)

| 그룹 | 대상 | 내용 | 근거 |
|------|------|------|------|
| D1 | **`application_documents` 신설** | 테이블(2.7.3 컬럼) + CHECK(`document_kind in ('cover_letter')`, `filled_slot_count >= 0`) + `unique (application_project_id, document_kind)` + 복합 FK `(application_project_id, user_id)` cascade + `updated_at` 트리거 + 생성 컬럼 `slot_count` + RLS(select·delete 본인 / insert·update는 저장 RPC) + grant(`app_ai_writer` **select만**). **`migration_note` 없음** | 11.8 #1, 2.7.3 |
| D2 | **`writing_chats` 확장** | `application_project_id`·`document_kind` 추가, 복합 FK, **`project_id` not null 해제**, 대상 배타 CHECK 3개 교체, 인덱스 1개 추가, 트리거 `writing_chats_check_target`·대상 열 불변 가드 교체. `return_target` CHECK(R14 3값)는 **그대로** | 11.8 #2 |
| D3 | **`ai_jobs` CHECK 완화** | `target_type='writing_chat'`일 때 `application_project_id is null`을 `job_type`별로 — `writing_chat_turn` = null / `cover_letter` = not null. **`ai_jobs_career_description_in_flight_key` 인덱스 삭제** + API 거부 코드 `career_description_in_progress` 제거 | 11.8 #3 |
| D4 | **`ai_jobs_jd_extraction_check` 완화** | `… or (target_type='jd_preview' and (target_id is null) = (application_project_id is null))` | 11.10 #5a, 2.6.2 |
| D5 | **`job_descriptions.source_url`** | text null + CHECK(http(s), ≤ 2,048자 `[가정]`). 사용자 update grant 없음, `app_ai_writer` grant 없음 | 11.10 #1 |
| D6 | **인덱스** | `application_projects (user_id, created_at desc)` | 11.10 #5 |
| D7 | **RPC 신설** | `save_application_document`(invoker, 2.5.1 전문), `start_document_writing_chat`(definer), `private.doc_replace_slot_evidence`(definer, 외부 execute 없음), `private.application_reset_name`(definer, 외부 execute 없음) | 11.8 #4 |
| D8 | **RPC 교체 — 패치** | `apply_structured_draft_patch`에 **서류 분기**(2.5.0b 패치 연산·`slot` 인자·`set_tone`·`invalid_patch` 조건·V-10 방어 범위). **`set_section_order_proposal`·`set_source_ranking`은 만들지 않는다**(CF-1), `replace_draft`에 `answer_title` + **`sources[]`**(CF-S1, 아래 1-F) | 11.8 #5, 11.10 (2), **CF-S1** |
| D9 | **RPC 교체 — 삭제·탈퇴** | R14 정의에서 시작: `get_deletion_impact`(`application_project` 반환 키 `documents`·`document_chats`, 커리어 종류 결과 영향 키 `documents`·`document_sections`. **`entity_type='application_document'`는 만들지 않는다** `[가정]`), `delete_career_item`(`delete_results` 범위 재작성 — 경력기술서 분기 없음), `get_account_deletion_summary`(서류 수 = `filled_slot_count > 0`인 정본 수, 대화 합계), `cascade.writing_chats`·`delete_career_item`에 **`project_id is not null` 조건 추가** | 11.8 #6 |
| D10 | **`evidence_links`** | R14 정의에서 시작: `owner_type` CHECK에 **`application_document` 추가**(`draft_section`은 3단계에서는 남기고 insert 트리거가 거부), 허용 출처 목록에 새 소유자(커리어 5종 + `jd_requirement`·`jd_sentence`·`user_note` — 답변 출처 없음, RM-1), `user_note` 출처 판정을 트리거 → 저장 RPC로 이동. **SD-A19의 `profile` 차단과 같은 트리거 함수이므로 한 번에 교체**(두 번 교체 금지) | 11.8 #7 |
| D11 | **생성 RPC 교체** | `create_application_project` — 기존 8인자 함수 **drop 후 재생성**(오버로드 2개 금지), 뒤에 `p_source_url text default null`·`p_preview_job_id uuid default null`. 미리 보기 적용: `p_raw_text`로 **sha256 재계산**(`extensions.digest`, hex 소문자)해 `params.raw_text_hash`와 비교 + `jsonb_array_length(p_sentences) = params.sentence_count` — **보낸 해시를 믿지 않는다**. 소유자·`succeeded`·미연결·24시간 검사 실패는 오류가 아니라 "적용 안 함". 반환에 `preview_applied`·`preview_skip_reason`(`preview_not_found`/`preview_expired`/`preview_mismatch`). 연결은 버린 경우에도 한다(`ai_jobs.target_id`·`application_project_id` + 그 작업의 `ai_usage_records.application_project_id`). 적용 본문은 `apply_jd_extraction`과 **같은 내부 함수**로 분리. **이름 규칙 교체**: `p_company_name`이 있으면 키 유무와 무관하게 "{회사명} 자기소개서"(`user`). `p_source_url` 검사 실패 `invalid_source_url`(400) `[가정]` | 11.10 #2·#5b·#9, 2.6.2 |
| D12 | **이름 조립 교체** | `private.application_compose_name`·`private.application_fallback_name` → "{회사명} 자기소개서"(회사명 94자 자름 `[가정]`), 회사명 없으면 기본 이름("새 자기소개서 (YYYY-MM-DD)"). **기존 이름 백필 없음** `[가정]` | 11.10 #3 |
| D13 | **`apply_jd_extraction`** | `p_result -> 'deadline' ->> 'value'`가 유효한 `date`이고 `deadline.source_sids`가 그 분할 안이고 KST 오늘 ~ 오늘+366일이면 **`application_projects.deadline is null`일 때만** 같은 update에서 채운다. 변환 실패는 무시, 반환에 `deadline` 추가. 키 없는 옛 작업 결과도 통과 | 11.10 #4 |
| D14 | **`start_writing_chat`** | R14 정의에서 시작. `p_return_target.feature` 허용 목록에서 **`career_description` 제거** → `insight`·`cover_letter` 2값(새로 보내면 `invalid_return_target` 400). 테이블 CHECK는 그대로. `private.writing_chat_greeting`의 `career_description` 분기는 남겨도 됨 `[가정]` | 11.10 #8 |
| D15 | **정리 크론 규칙 1줄** | 연결되지 않은(`target_type='jd_preview' and target_id is null`) 작업은 `finished_at + 24h` 뒤 `output` → null, `step_outputs` → `'{}'`. 작업 행 자체는 90일 보관 그대로 `[가정]` | 11.10 #5a·#9, 2.6.2 |
| D16 | 타입·pgTAP | `database.types.ts` 재생성(비파괴 뒤 1회, 파괴 뒤 1회) + pgTAP 신설(아래 3-B) | 11.8 #10, 11.10 #7 |

### 1-B. DB — 파괴 (배포 4단계, **별도 마이그레이션 파일 1개, 원격 반영은 사용자 승인 뒤**)

파일 첫 줄 `-- DESTRUCTIVE: …`, **한 트랜잭션**, 순서 고정:

1. **가드** — `public.drafts`·`public.draft_sections`·`public.draft_section_sources` 행 수 + `public.evidence_links`의 `owner_type='draft_section'` 행 수를 세어 **넷 중 하나라도 0이 아니면 `raise exception`**. 메시지에는 **테이블별 행 수만**(값·id 금지, R14 0단계와 같은 모양). 이관 규칙은 두지 않는다.
2. **객체 #8 폐기** — `begin`/`complete`/`fail_career_description`, `begin`/`complete`/`fail_cover_letter`, 자소서 문항 사용자 RPC 일괄, `ai_jobs_release_drafts`, 트리거·함수 `draft_sources_mark_project_deleted`·`draft_sources_mark_education_deleted`·`draft_source_label`·`draft_source_parent_name`·`backfill_education_display_labels`. **`private.education_display_name`·`trim_js_whitespace`는 남긴다.** 폐기 테이블의 행 타입을 쓰는 함수는 테이블보다 **먼저**.
3. **테이블 3개 drop** — `draft_section_sources` → `draft_sections` → `drafts`(자식 → 부모). **`cascade`는 쓰지 않는다**(예상 밖 의존이 있으면 멈추는 편이 안전).
4. **`evidence_links_owner_type_check` drop → add** — `draft_section`을 뺀다(결과: `insight`·`chat_message`·`application_document`).
5. 타입 재생성.

**빼지 않는 값**: `ai_jobs.job_type`·`ai_usage_records.job_type`·`feature`의 `career_description`·`draft_source_ranking`(과거 행 보존, CF-A3), `ai_jobs.target_type`의 `draft`·`draft_section`(90일 보관 행).

**되돌릴 수 없는 지점**(사용자 승인 대상): ① 코드 배포 뒤 `writing_chats.project_id` not null 복구 ② 코드 배포 뒤 `ai_jobs` CHECK 원복(90일) ③ 3단계 뒤 `structured_draft`에 쓴 서류 모양 jsonb ④ 4단계 drop(스키마 비가역, 지우는 행 0).

### 1-C. API·서비스

| 그룹 | 대상 | 내용 |
|------|------|------|
| A1 | **신설 `POST /api/job-descriptions/fetch`** `[가정: 이름]` | 로그인 사용자만. 요청 `{url}` → 응답 `{rawText, companyName, positionTitle}`(없으면 null). ① schema.org `JobPosting`(JSON-LD)에서 제목·회사명 ② 본문 추출 + 사이트별 처리(사람인 본문 주소, 잡코리아 프레임 주소, EUC-KR → UTF-8, 주변 글 제거) ③ **AI 안 씀 — 키 없이 동작**. SSRF 차단(http(s)만, DNS 해석 뒤 10/8·172.16/12·192.168/16·127/8·169.254/16·::1·fc00::/7 등 거부, **리다이렉트마다 재검사**, 최대 3회), 10초, 2MB(넘으면 끊음), 추출 텍스트 200자 미만 실패, `raw_text`는 50,000자 상한으로 자름 `[가정]`. 실패 코드 `invalid_source_url`(400)·`fetch_blocked`·`fetch_timeout`·`fetch_too_large`·`fetch_too_short`·`fetch_failed` `[가정]`. **DB 쓰기 없음**, `ai_jobs`·사용량 기록 없음. 로그는 호스트·결과 코드·바이트 수·걸린 시간만 — **본문·전체 URL 경로·쿼리 금지** `[가정]`. 남용 방지는 기존 서버 규칙(2.9.4) `[가정: 수치]` |
| A2 | **신설 `POST /api/job-descriptions/extract-preview`** `[가정: 이름]` | 동기(AI-01 경량, 15초 목표). 요청 `{rawText}` → `normalizeJdRawText` → `splitJdSentences`·`sha256Hex`(**생성과 같은 코드**) → AI-01 호출 → 서버 검증(`source_sids`가 분할 안인지 등, `apply_jd_extraction`과 같은 검사). 응답 `{previewJobId, companyName, positionTitle, deadline, requirementCount}`. `ai_jobs` 1행(`job_type='jd_extraction'`, `target_type='jd_preview'`, `target_id` null, `application_project_id` null, `params={raw_text_hash, sentence_count}`, `output` = 검증 통과 결과) + `ai_usage_records` 1행(`feature='jd_extraction'`, `application_project_id` null). **Q53-1 게이트 409**(`key_invalid`·`ai_consent_required`) — 차단되면 작업 행을 만들지 않는다. 일반 재시도 경로에 넣지 않는다 |
| A3 | **`normalizeJdRawText` 신설** `[가정: 이름]` | `src/server/services/application/write.ts`(생성·원문 수정 2.6.1)와 미리 보기 라우트가 **같은 함수**로 정규화한 **문자열 하나**로 분할·해시·저장 원문을 만든다. 정규화 `[가정]`: `\r\n`·`\r` → `\n`, 유니코드 NFC, 앞뒤 공백 제거. **안쪽 공백·빈 줄은 줄이지 않는다.** 기존 JD 행은 다시 계산하지 않는다 |
| A4 | 생성 액션 | 2단계 [자기소개서 작성]에서 1회 호출, `p_source_url`·`p_preview_job_id` 전달. `preview_applied=false`이고 키가 있으면 보통 AI-01 1회(D-30) |
| A5 | 서류 저장·대화 액션 | 생성 버튼 3개(경력기술서·전체 문항·이 문항만) 경로 **폐기** → 저장 액션 1개(`save_application_document`) + 대화 시작 액션 1개(`start_document_writing_chat`). zod는 **JSON 모양만**(R5-API-2) |
| A6 | 턴 라우트 재사용 | 서류 생성 라우트(AI-03·AI-04 일괄 생성) **폐기** → `POST /api/writing-chats/{id}/turns`에 **서류 분기**. `src/server/services/writing-chat/turn.ts` 대상 3분기(서류 턴: 컨텍스트 팩 + JD 요건 + 지금 본문, `job_type`·`feature` 분기, `call_key`). `form_snapshot` S-46 = `{questions:[{slot, question_text, char_limit, count_basis, user_note, answer_title, body}]}` |
| A7 | 폐기 | `src/server/services/drafts/*` 전부(읽기 경로도 **남기지 않는다** — CF-M1), 라우트 `application-projects/[id]/career-descriptions`·`draft-source-ranking`·`draft-sections/[id]/generate`, 거부 코드 `career_description_in_progress` |
| A8 | 정리 크론 | `/api/cron/ai-jobs`에 D15 규칙 1줄 |
| A9 | 계약·열거 | `src/lib/contracts/` 요청·응답·거부 코드(`invalid_slot`·`application_project_not_found`·`too_many_questions`·`invalid_source_url`·`fetch_*`), `enums.ts`에 `document_kind`·`owner_type`·`target_type` 미러 갱신 |

### 1-D. AI 파이프라인

| 그룹 | 내용 |
|------|------|
| AI1 | **AI-01**: 출력 schema_version 1 → **2**(`deadline {value, source_sids}`), 프롬프트 `ai-01.extract.v2`. `deadline` 검증(`source_sids`가 분할 안) |
| AI2 | **AI-04 자소서 문항 답변 작성 AI 채팅**: schema_version 3 → **4**(`answer_title` — `draft_done`에만 실음, 숫자·고유명사·민감정보 검증 적용, 걸리면 **제목만 버린다**), 프롬프트 `ai-04.generate.v7`·`ai-04.adjust.v7`(main 병합 RM이 v6을 먼저 썼음 — **구현 번호는 현행 코드에서 확인**, MRG-AI-1 `[가정]`), 공통 접미사는 RM의 `common.v4` 그대로. **문항 ≤ 5 → 한 바퀴 초안 턴 2회**(한 턴 최대 3문항, CL-10). 첫 턴 문구: 4~5문항 "먼저 1~3번 문항을" / 3문항 이하 "바로 초안을"(최종 문구 UX). `char_limit` null 건너뛰기 분기는 **만들지 않는다**(CF-M1) |
| AI3 | **AI-03·AI-11 구현하지 않는다**(폐기). 기존 AI-03·AI-11 파이프라인·프롬프트·스키마 코드 제거 |
| AI4 | 팩 빌더 한 지점 유지(CL-Q1 제약 ①), 출처 별칭 유지(제약 ②). 서류 턴 컨텍스트 = 전체 커리어 팩 + JD 요건 + 지금 본문 |
| AI5 | V-10(초안) 범위를 자소서 블록 기준으로, V-8 마지막 안전망(`job_competency` 문항에서 `project.learnings` 거부)은 저장 RPC와 **같은 규칙** |

### 1-F. 슬롯 근거 저장 — **CF-S1 (확정 2026-11-09, 사용자)** 추가분

구현 중 발견한 기획 불일치(R15-AI-2)를 기획 세션에 올려 받은 결정이다. 상세·배경은 `_workspace/backend/decisions.md` "2026-11-09 CF-S1".

- `replace_draft`에 **`sources[]`** 인자 — `{source_type, source_id, role}`, `role` ∈ `primary`/`supporting`, **0~5개** `[가정]`. 저장 위치 `structured_draft.document.questions[].draft.sources[]`. **새 패치 연산을 만들지 않는다**(폐기된 `set_source_ranking`을 되살리는 것이 아니다).
- 별칭 → `source_id` 변환은 **ai-pipeline이 블록 `evidence[]`와 같은 경로로**. `user_note`의 `source_id` = 그 문항의 `question_id`. 허용 출처는 2.8 목록. V-4·V-7·V-8·문항 유형별 상한·`primary` 1개 정규화가 이 배열에 그대로 걸린다.
- `save_application_document`: 그 슬롯 제안이 **applied**면 그 제안(같은 `rev`)의 `draft.sources[]`로 `{slot}.sources.{n}` **교체**(`n` = 배열 순서, `primary` 먼저, **`role` 미저장**). **적용 제안 없는 슬롯은 기존 `sources` 행 유지** `[가정]`, 블록 근거만 재작성. 보내지 않은 슬롯은 양쪽 삭제.
- **화면은 `sources`를 보내지 않는다** — `p_body.questions[]`에 키 없음, **RPC 인자·`p_body` 모양 변경 없음**.
- **귀결**: 2.5.1의 "슬롯마다 근거 전부 지우고 다시 넣기"는 **블록 근거에만** 적용된다.
- **문서 상태**: 반영 PR #68 **미머지** → 이 워크트리 `docs/planning/`에는 CF-S1이 없다. 머지되면 대조할 것.

### 1-E. 연결(Wiring) — 이 슬라이스에서는 **하지 않는다**

UI(S-13 목록 재작성, S-14 → 2단계 모달, S-46 작성 화면, S-31·S-17·S-45 폐기, S-39 카드)는 **백엔드 배포 뒤 별도 UI 세션**에서 붙인다(4.23 UI 표). `src/lib/data/`의 서류 관련 함수는 **"연결 대기"**로 둔다. 다만 아래는 UI가 없으면 빌드가 깨지므로 처리한다:

- `src/lib/data/deletion.ts`: `countsAsDraft` → `filled_slot_count > 0`, 영향 키 `drafts`·`draft_sections` → `documents`·`document_sections`·`document_chats`
- `src/lib/data/labels.ts`: `AI_FEATURE_NAMES`에서 "AI 근거 선택" 제거(CL-2)
- 폐기 서비스·라우트를 참조하는 UI 파일이 있으면 **"Minimal UI edits"** 범위에서만 손대고 `04_summary.md` "UI 소유 파일 수정"에 적는다. 그 밖은 **"UI 요청"**으로 넘긴다.
- **`src/lib/data/` 서류 함수를 실제 경로로 바꾸는 것은 UI 재설계 뒤**(지금 붙이면 폐기될 S-17·S-31 화면에 연결된다)

## 2. 계약 스케치

### `save_application_document` (security invoker)
```
save_application_document(
  p_application_project_id uuid, p_document_kind text, p_body jsonb,
  p_meta jsonb default null, p_expected_updated_at timestamptz default null,
  p_applied_proposals jsonb default null, p_client_id uuid default null,   -- 받아도 무시 [가정]
  p_application_values jsonb default null)                                 -- {name, deadline}
→ { application_document_id, document_kind, filled_slot_count, slot_count,
    name, name_source, deadline, updated_at,
    applied: [{writing_chat_id, slot}], skipped: [{writing_chat_id, slot, reason}] }
```
- 대상은 id가 아니라 `(p_application_project_id, p_document_kind)`. 행 없으면 만들고 있으면 고친다. **행을 만드는 유일한 길**.
- `p_body` = `{questions:[...]}` 전체 덮어쓰기. 받은 순서가 정본, `sort_order`는 서버가 1부터 재부여. **보내지 않은 슬롯은 삭제**(그 슬롯 근거 행도 지운다).
- `p_meta` = `{tone}`만. `p_application_values` = `{name, deadline}`만. 빈 `name`은 `private.application_reset_name`으로 기본 이름 복귀. 기대 버전은 **서류 행 `updated_at` 하나만**.
- 상한: 문항 ≤ **5**(초과 → **`too_many_questions`** 400, details `{limit:5, current:n}`, 판정은 "보낸 수 > 5 **이고** 저장돼 있던 수보다 많을 때"만, raise detail `'5,{current}'`), 문항 문구 ≤ 1,000, `answer_title` ≤ 100, `char_limit` **1~10,000 필수**(null·빈 값 → `invalid_fields` details `questions.q_n.char_limit`; 저장돼 있던 같은 `question_id`가 이미 null이면 null 유지 허용 — 실제로는 안 생김), `user_note` ≤ 300, 본문 ≤ 8,000, 블록 ≤ 200·텍스트 ≤ 5,000·블록당 근거 ≤ 20 → `field_too_long`(details 점 경로). `slot` 형식(`^q_[0-9]{1,3}$`)·중복·종류 불일치 → `invalid_slot`. `p_document_kind ≠ 'cover_letter'` → `invalid_fields`.
- 근거: 슬롯마다 `evidence_links` **전부 지우고 다시 넣기**(`owner_type='application_document'`, `item_key` = `{slot}.blocks.{block_id}` / `{slot}.sources.{n}`). 허용 출처는 **insert 트리거와 같은 목록**. `job_competency` 문항의 `project.learnings` 거부. **근거 쓰기 실패는 저장을 되돌린다.**
- `filled_slot_count` 재계산: **본문이 빈 문항은 `answer_title`이 있어도 세지 않는다** `[가정]`. `slot_count`는 생성 컬럼이라 쓰지 않는다.
- `p_applied_proposals` 원소 `{writing_chat_id, slot, rev}`. `skipped[].reason` 6종·판정 순서·"기록 실패는 저장을 막지 않는다"는 2.5.1 공통 규칙 그대로. `applied_mode` 없음.
- **키·동의·활성 공급자를 보지 않는다**(CL-8).

### `start_document_writing_chat` (security definer)
2.5.0b·11.8 #4. 대상 = `(application_project_id, document_kind)`. **정본 행을 만들지 않는다.** 없는 지원 프로젝트 → `application_project_not_found`(404).

### `create_application_project` (교체)
```
create_application_project(p_id, p_raw_text, p_raw_text_hash, p_sentences,
  p_company_name, p_position_title, p_name, p_deadline,
  p_source_url text default null, p_preview_job_id uuid default null)
→ 기존 반환 + preview_applied boolean, preview_skip_reason text|null
```

### 턴 SSE
기존 `POST /api/writing-chats/{id}/turns` 그대로, 서류 분기만 추가. 새 SSE 이벤트 이름을 만들지 않는다.

## 3. 담당 분배

### db-engineer (선행 — 나머지가 기다린다)
- 비파괴 마이그레이션: D1~D15(번호 `20261113003100`부터, 관심사별 분리)
- **별도 파일** 파괴 마이그레이션: 1-B(가드 + drop), 첫 줄 `-- DESTRUCTIVE:`
- `database.types.ts` 재생성 2회
- pgTAP: 3-B 목록
- 노트: `_workspace/backend/R15/02_db-engineer_notes.md` — **RPC 시그니처·거부 코드·반환 키를 여기에 먼저 적는다**(api·ai가 읽는다)

### api-engineer (D1~D15 적용 뒤)
- A1~A9. 계약(`src/lib/contracts/`)은 **즉시 시작 가능**
- 1-E의 `deletion.ts`·`labels.ts` 처리와 폐기 코드 제거
- 노트: `02_api-engineer_notes.md`

### ai-pipeline-engineer (순수 코드는 즉시 시작)
- AI1~AI5. **현행 프롬프트 번호를 코드에서 먼저 확인**하고 v7 결정을 노트에 적는다(MRG-AI-1)
- api-engineer와 **턴 파이프라인 시그니처·미리 보기 호출 인터페이스를 노트로 합의**
- 노트: `02_ai-pipeline-engineer_notes.md`

### backend-qa (모듈 단위 증분)
- 3-B 체크리스트 + `run-checks.sh` + **로컬 스모크**(턴 라우트·저장 RPC·미리 보기 라우트가 실제 의존으로 도는지 — 과거 `332ec0c` 사례)
- 보고: `03_backend-qa_report.md`

## 3-B. pgTAP·테스트 범위

- `application_documents`: CHECK(`document_kind` 1값, `filled_slot_count >= 0`), `unique`, 복합 FK cascade, `slot_count` 생성 컬럼, RLS(남의 행 안 보임, 직접 insert·update 거부), `app_ai_writer` select만
- `save_application_document`: 만들기·고치기, `stale_write`, 문항 5개 초과 `too_many_questions`(details), `char_limit` null 거부, `answer_title` 100자, `invalid_slot`, 보내지 않은 슬롯 삭제 + 근거 삭제, 근거 교체·`job_competency`의 `learnings` 거부, 근거 실패 시 롤백, `filled_slot_count`(제목만 있는 문항 안 셈), `p_application_values`(이름 빈 값 → 기본 이름 복귀, 마감일 형식 오류), 반영됨 기록 `skipped` 6종, 키·동의 없이 성공
- `writing_chats` 대상 3분기 CHECK, `project_id` null 허용, `start_document_writing_chat`(정본 행 안 만듦, `application_project_not_found`)
- `start_writing_chat`: `career_description` 복귀 대상 거부
- `ai_jobs`: `jd_preview` 조합 CHECK(연결 전 둘 다 null / 연결 뒤 둘 다 채움), 서류 `job_type` + `writing_chat` 조합
- `create_application_project`: 이름 규칙 3분기(회사명 있음 / 키 없음·회사명 없음 / 키 있음·회사명 없음), 미리 보기 적용·`preview_not_found`·`preview_expired`·**해시 재계산 불일치 → `preview_mismatch`**, 문장 수 불일치, 남의 작업 거부, 버린 경우에도 연결, `source_url` CHECK, 같은 `p_id` 재시도
- `apply_jd_extraction`: `deadline` null일 때만 채움·사용자 값 보존·`source_sids` 검사·기간 밖 무시·키 없는 옛 결과 통과
- 삭제·탈퇴: `get_deletion_impact` 반환 키, `delete_career_item` 범위, `get_account_deletion_summary` 서류 수, `project_id is not null` 조건
- `evidence_links`: `owner_type` CHECK, 허용 출처, `draft_section` insert 거부
- **가드**(픽스처 DB): 세 테이블·`draft_section` 근거 중 하나라도 행이 있으면 drop 마이그레이션이 **멈춤**
- **drop 뒤**: 테이블·함수 부재, `owner_type` CHECK의 `draft_section` 거부
- 정리 크론 24시간 만료(`output`·`step_outputs` 비움)
- Vitest: `normalizeJdRawText`(정규화 3규칙·안쪽 공백 보존·해시=분할=저장 일치), SSRF 차단(사설·루프백·링크 로컬·메타데이터·리다이렉트 재검사·3회 상한), 10초·2MB·200자, EUC-KR 변환, `JobPosting` 파싱, 사람인·잡코리아 처리, 실패 코드 6종, 로그에 본문·URL 경로 없음, AI-01 `deadline` 스키마·검증, AI-04 `answer_title` 검증(걸리면 제목만 버림)·문항 5개 턴 2회 분할·첫 턴 문구 분기

## 4. 릴리스 영향

- **파괴 마이그레이션 1개**(1-B). 지우는 행은 **0행**(가드가 마이그레이션 안에서 재확인). 원격 반영은 **사용자 승인 뒤** — 이 슬라이스는 **원격 미반영**으로 남긴다.
- **되돌릴 수 없는 작업 2개**: ① 테이블 3개 drop ② `writing_chats.project_id` not null 해제. **로컬만 적용.**
- 배포 순서: 비파괴(1~3단계) push → **코드 배포** → 4단계(가드 + drop) push. 같은 릴리스에 묶어도 되지만 **파일은 분리**하고 4단계는 코드 배포 뒤.
- **새 환경 변수: 없음**(예상). URL 가져오기는 외부 키가 필요 없다. 생기면 `04_summary.md`에 적는다.
- **UI와 함께 가야 하는가**: 그렇다. 백엔드만 main에 가면 S-17·S-31 등 옛 화면이 폐기된 라우트를 부른다 → **A7 폐기는 UI 세션과 같은 릴리스**로 묶거나, 폐기를 UI 세션 뒤로 미룬다. **리더 판정: 이 슬라이스에서 서버·DB·새 라우트를 만들고, 옛 서류 라우트·서비스 폐기는 같은 브랜치에서 하되 UI가 그 라우트를 참조하면 빌드가 깨지므로 참조 여부를 먼저 확인한다.** 깨지면 폐기분만 분리해 "UI 세션과 함께"로 넘기고 `04_summary.md`에 적는다.
- **출시 전 법무 확인**(사용자 몫): 사람인·잡코리아 이용약관의 자동 수집 제한(CF-10, PRD NFR-PRV-12).

## 5. 이 슬라이스에서 쓰는 `[가정]`

문서가 `[가정]`으로 표시한 것(그대로 따른다): `source_url` ≤ 2,048자 · `invalid_source_url` 이름 · 회사명 94자 자름 · 기존 이름 백필 없음 · `career_description`·`draft_source_ranking` CHECK 보존 · 미리 보기 24시간 · `output`·`step_outputs` 비우기 · `/api/job-descriptions/fetch`·`extract-preview` 이름 · `fetch_*` 5종 · 로그 항목 · 남용 방지 수치 · `raw_text` 50,000자 자름 · `normalizeJdRawText` 이름·정규화 3규칙 · `too_many_questions` 이름 · `answer_title` 한 줄 평문 · `filled_slot_count`에서 제목만 있는 문항 제외 · `p_client_id` 무시 · `entity_type='application_document'` 만들지 않음 · `writing_chat_greeting` 분기 유지 · 프롬프트 v7 번호(MRG-AI-1) · `slot_count` 0을 문항 설정 상태로 보지 않음 · 이름·마감일만 바꾼 저장은 나중 저장이 이김.

구현이 새로 정하는 것은 `04_summary.md` "[가정]"에 모은다.

## 6. 막혔을 때

- **사용자 결정이 필요하거나 기획 문서가 틀렸거나 비어 있으면** → 기획 검토 세션 `local_6c265c4a-0a2e-4e53-8e52-a6fc0459717d`("기획 검토")로 `SendMessage`. 무엇을 구현하다 막혔는지 · 문서의 어느 절·행 · 선택지와 각각의 구현 영향을 함께 적는다. **코드 쪽 `[가정]`으로 덮고 진행하지 않는다.**
- 그 세션이 응답하지 않으면 상위 세션에 보고.
- 구현 세부(컬럼 이름·인덱스·오류 코드 문자열)는 관례대로 정하고 `[가정]` 기록.
- `docs/planning/`·`docs/legal/`은 **이 세션에서 고치지 않는다**. 어긋남은 `_workspace/backend/spec-gaps.md`에 적는다.
