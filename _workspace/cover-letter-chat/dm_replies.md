# 데이터 모델 회신 — 사이클 `cover-letter-chat` (data-architect → 세 담당)

- 작성: data-architect, 2026-11-05
- 반영 기준: **`_workspace/02_data-architect_data-model.md` v4.13**(이 사이클에서 개정 완료). 짝 문서 기준 PRD v4.15 · UX v5.18 · AI v4.13
- 결정 원문: `_workspace/00_input/planning-decisions-cover-letter-chat.md`(CL-1~CL-10, CL-A1~CL-A10, CL-Q1·CL-Q2)
- 사전 조사: `_workspace/cover-letter-chat/touchpoints_dm.md`(편집 자리 D-1~D-92 전부 처리)
- 같은 내용이 데이터 모델 문서 끝 `## 요청 회신` 절에도 있다.

## 요청 회신 (v4.13, 결정 사이클 cover-letter-chat — 39건)

> 세 담당이 `_workspace/cover-letter-chat/{ux,ai,prd}_requests.md`에 올린 **data-architect 요청 39건**(ux 10 · ai 18 · prd 11)에 **확정 이름·모양**으로 하나씩 답한다. 이름의 정본은 이 문서다(머리말 5행). 같은 내용이 `_workspace/cover-letter-chat/dm_replies.md`에도 있다.
> **다른 문서가 고쳐야 하는 이름**은 ⚠로 표시했다 — 리더가 그 담당자를 다시 불러 맞춘다.

### → ux-planner (10건)

| # | 요청 | 확정 회신 |
|---|------|-----------|
| 1 | 서류 정본 테이블의 이름과 컬럼 | **그대로 확정**: 테이블 **`application_documents`**, `application_project_id`(복합 FK cascade) · `document_kind`(CHECK 2값) · `unique (application_project_id, document_kind)` · `body` jsonb · `meta` jsonb(`tone`) · `first_copied_at` · `updated_at`(기대 버전 기준). **추가로 둔 컬럼 2개**: **`filled_slot_count`**(아래 6) · `migration_note`(이관 기록, 일반 경로에서는 null). `drafts.title`은 **폐기 확정**. 정의는 2.7.3 |
| 2 | 섹션(문항) 객체의 키 이름과 섹션별 근거 배열 | **`body.sections[]`/`body.questions[]` 확정.** 식별자는 **둘 다** 둔다 — **`slot`**(`s_{n}`/`q_{n}`, 모델 입출력·`item_key`·`p_applied_proposals`가 쓰는 짧은 키)과 `section_id`/`question_id`(uuid, 이관에서 기존 `draft_sections.id` 재사용). `heading_label`·`experience_id`·`education_id`·`project_id`·`sort_order`·`body`·`blocks[]`, 문항 메타(`question_text`·`char_limit`·`count_basis`·`user_note`·`template_key`·`question_class`) **전부 정본 쪽** 확정(CL-8). ⚠ **근거 배열은 정본에 두지 않는다** — 요청에 적은 `{experience_id, project_id, origin, rationale, requirement_ids, source_label, source_deleted_at}`은 **`evidence_links`의 컬럼으로 대체**되고(DM-6: 근거는 한 곳에만) `origin`·`rationale`은 제안 쪽(`structured_draft.document.source_ranking`)에만, `role`·`reuse_reason`·`requirement_ids`는 **폐기**다. C-11은 그 슬롯의 근거 행을 읽어 보인다 → **UX v5.18 요청 2·C-11·S-45 섹션 목록의 "근거 배열 항목" 서술을 이 모양으로 고쳐 달라** |
| 3 | `evidence_links` 소유자 키와 `item_key` 점 경로 | **`owner_type = 'application_document'`·`owner_id` = 정본 행 id 확정**(사전 조사의 `application_document_section` 안은 폐기). ⚠ **`item_key`는 첫 구간을 uuid가 아니라 슬롯 키로 바꿨다**: **`{slot}.blocks.{block_id}`** / 슬롯 단위 근거 **`{slot}.sources.{n}`**(예 `s_3.blocks.b2`, `q_2.sources.1`). 이유 = 모델 입출력과 같은 키를 써야 하고 uuid는 턴당 입력이 수백 토큰 는다(AI 요청 2) → **UX v5.18 845행(C-01 데이터)과 요청 3의 `sections.{section_id}.blocks.{block_id}` 표기를 고쳐 달라.** 기존 `draft_section` 행 처리는 권고대로 **SD-A19 `profile` 패턴**(CHECK 유지 + insert 차단 + 행·라벨 유지) |
| 4 | 저장 RPC의 이름과 인자, `stale_write` | **`save_application_document` 확정.** ⚠ **인자 1개 추가**: `(p_application_project_id, p_document_kind, p_body, **p_meta**, p_expected_updated_at, p_applied_proposals, p_client_id)` — 문체를 정본 `meta.tone`에 두기로 했으므로 쓸 자리가 필요하다(`p_meta`는 `{tone}`만, 없으면 유지). `p_applied_proposals = [{writing_chat_id, slot, rev}]`·`stale_write`·`field_too_long`·`skipped` 사유 6종은 **요청 그대로**. 반환은 `{application_document_id, document_kind, filled_slot_count, updated_at, applied, skipped}`(서류 수 재계산 값을 함께 돌려준다). `p_client_id`는 **쓰지 않지만 시그니처에 남긴다**(주소에 서류 id가 없어 멱등 키를 만들 자리가 없고 unique 제약이 같은 역할을 한다) → **S-45·S-46·1.3a의 저장 호출에 `p_meta`를 더해 달라** |
| 5 | 대화 시작 RPC와 대화의 소속 키 | ⚠ **`start_document_writing_chat(p_application_project_id, p_document_kind, p_form_snapshot)` — `p_return_target`은 두지 않는다**(서류가 곧 복귀 대상이고 `return_target` CHECK가 null을 강제한다). UX v5.18 1731행은 이미 3인자라 맞고, **요청 5의 4인자 표기만 고쳐 달라.** 소속 키는 **컬럼 2개**(`application_project_id` + `document_kind`)로 `writing_chats`를 확장한다(안 A, 2.5). `p_form_snapshot` 모양은 `{sections: [{slot, heading_label, body}]}` / `{questions: [{slot, question_text, char_limit, count_basis, user_note, body}]}`(2.5.1). 메시지 40·`active`/`closed`·서류당 대화 수 무제한 **모두 확정** |
| 6 | "서류 수" 집계를 서버가 계산해 달라 | **확정 — `application_documents.filled_slot_count`**(본문이 비어 있지 않은 섹션·문항 수, 저장 RPC가 같은 트랜잭션에서 다시 계산) + 집계식 **`count(*) where filled_slot_count > 0`**(0~2). S-13·S-31·S-39 카드·보드 조회·C-05 영향 N·탈퇴 집계가 **모두 이 식**을 쓴다(별도 RPC·뷰를 두지 않는다 — 보드·카드는 이미 그 테이블을 join한다). 대화·제안은 세지 않는다 |
| 7 | `get_deletion_impact`의 서류 부분 | **`entity_type`에 `application_document` 추가 확정** → `{cascade: {writing_chats: n}, slots: n}`. **서류를 지우면 그 서류의 대화가 FK cascade로 함께 지워진다**(2.7.3). 지원 프로젝트 삭제의 반환은 `cascade.documents`(= 6번 셈법) + **`cascade.document_chats`**(서류 대화 수)로 바뀐다(옛 `cascade.drafts` 폐기, 2.7.2) → **C-05 두 행과 FL-06의 키 이름을 `documents`·`document_chats`로 고쳐 달라** |
| 8 | 공급자·모델 배지의 자리 | **확정**: 제안 쪽은 **그 턴의 `ai_jobs`**(`provider`·`model`·`model_tier`·`connection_tier`)와 `writing_chat_messages`(assistant 행), 정본 쪽은 **블록의 `applied_writing_chat_id`·`applied_rev`**로 그 제안을 만든 턴을 되찾아 읽는다(2.7.3). **서류 머리의 대표 배지를 두지 않는다**는 판단도 데이터와 맞는다(슬롯마다 다를 수 있다 — AI 회신 18) |
| 9 | 이관하지 못한 행 | **`[결정 필요]` CL-Q2로 남긴다**(8장). 마이그레이션은 **1~6단계(비파괴)와 관찰 기간까지만 확정**이고 **7단계(테이블 3개 drop)는 막아 두었다**(11.8). (a)로 정해지면 운영자 덤프 + 안내 뒤 drop이고, **(b)로 정해지면 폐기 테이블을 읽기 전용으로 남기므로 UX의 "이전 형식 · 읽기 전용" 배지·화면이 필요하다** — 정해지면 바로 알린다. S-19 리다이렉트의 서류 종류 판정은 **옛 `drafts.draft_type`**(7단계 전)이나 주소 파라미터로 하고, 판정할 수 없으면 S-17로 보낸다 `[가정]` |
| 10 | `get_data_readiness().features.draft` | **응답 모양 변경 없음**(`ready`·`missing`·`hints`·`next_action`·`suggested_project_id` 그대로). 뜻만 **"기능 진입 차단" → "초안 제안 차단"**으로 정의했다(6장) — 서류 화면은 D-01 미달에도 열리고 문항·본문 편집·저장·복사·대화·질문 턴이 되며 **초안 제안 턴만** 막힌다. `missing`·`hints` 값은 바뀌지 않는다 |

### → ai-feature-designer (18건)

| # | 요청 | 확정 회신 |
|---|------|-----------|
| 1 | `structured_draft`의 서류 모양 | **확정 — 2.5.0b.** `target` + `schema_version: 1`로 구분, 키는 **`document.sections[]` / `document.questions[]`**(한 이름 `items`로 묶지 않는다, 동의). 슬롯별 객체는 AI-12의 필드 객체 모양에 가깝게 `{slot, section_id\|question_id, draft: {value, blocks[], rev, base_body_hash, replace_allowed, missing_slots, dropped_block_count, applied_at, applied_rev}}`이고 `review`·`review_reason`은 **블록마다** 둔다(근거 0개 판정이 블록 단위다). `applied_mode`는 두지 않는다(서류는 늘 교체) |
| 2 | 슬롯 키와 `evidence_links` 소유자 키 | **`owner_type = 'application_document'` 확정**(제안 그대로), `owner_id` = 정본 행 id. **슬롯 키는 `s_{n}`·`q_{n}`(짧은 안정 키) 확정**이고 정본이 uuid 매핑을 들고 있다(권고 채택). ⚠ **`item_key`에 `blocks.` 구간을 넣는다** — `{slot}.blocks.{block_id}`(제안은 `{slot}.{block_id}`였다), 슬롯 근거는 제안 그대로 `{slot}.sources.{n}` → **AI v4.13 C-3의 `s_3.b2` 예시를 `s_3.blocks.b2`로 고쳐 달라.** 기존 행은 SD-A19 패턴 확정 |
| 3 | 문항 정의의 저장 위치 | **확정 — 정본 행**(`body.questions[]`의 `question_text`·`char_limit`·`count_basis`·`template_key`·`user_note`·`question_class`). `structured_draft`에는 **슬롯 참조 + 답변 본문 제안·근거**만. **경력기술서 섹션 순서도 정본**(배열 순서)이고 모델은 `document.section_order_proposal`로 제안만 한다 |
| 4 | `user_note` 근거의 `source_id` | **확정 — `source_id` = 그 문항의 `question_id`(uuid, soft)**. 정본 행 id와의 조합을 쓰지 않는다(근거 행에 `owner_id`가 이미 정본 행이다). jsonb 안 원소라 **"문항이 없으면 원본 삭제됨" 판정은 저장 RPC가 하고 트리거는 모양만 본다** `[가정]`(2.8) |
| 5 | `facts[].slot` 값 목록 | **회신 받음 — 고정 목록을 두지 않는다**(그 서류의 슬롯 키). DB는 **모양만** 본다(`^[sq]_[0-9]{1,3}$`), 정본에 없는 슬롯 판정은 파이프라인·화면 몫. 2.5.0b에 그렇게 적었다 |
| 6 | AI-11 결과 저장 위치 | **확정 그대로** — `ai_jobs.output`(`draft_source_ranking`) 보관 유지 + 복사 대상은 **`structured_draft.document.source_ranking = {origin, items[], generated_at}`**. `drafts.options.ranking`·`selection_origin` 폐기, `origin` 3값(`insight`/`ai_ranking`/`user`)은 그 메타에 유지 |
| 7 | `ai_jobs.job_type` | **권고 채택 — `career_description`·`cover_letter`를 턴 단위 `job_type`으로 유지한다**(`writing_chat_turn`으로 합치지 않는다. 사전 조사의 "전부 `writing_chat_turn`" 안은 폐기). 그래서 ★ **`target_type = 'writing_chat'`일 때 `application_project_id is null`인 CHECK를 `job_type`별로 나눈다** — `writing_chat_turn` = null / 서류 2종 = **not null**(2.9.1). `ai_jobs_career_description_in_flight_key` 인덱스는 **폐기**(대화당 1개로 충분, Q-DM-11). "대화 턴을 세는 뷰는 세 값을 본다"도 2.9.1에 적었다 |
| 8 | 사용량 `feature`는 그대로 | **확정 — 저장 8값·표시 합산 변경 없음**(CL-A8). `call_key` 3종(`career_description.turn.{n}.{extract\|reply\|compose}` / `cover_letter.turn.{n}.{…\|adjust_length}` / `career_description.rank`)을 **그대로** 2.9.2에 실었다. 2.9.5의 "다음 사이클에 묶음이 또 바뀐다" 예고 문장은 **"CL-A8로 바뀌지 않기로 확정"**으로 고쳤다 |
| 9 | 저장 RPC와 반영 기록 | **`save_application_document` 확정**(2.5.1). `p_applied_proposals = [{writing_chat_id, slot, rev}]`·`skipped` 6종·`stale_write`·`field_too_long` **그대로**. 같은 트랜잭션에서 **슬롯 근거를 `evidence_links`로 넣는다**(A24 유지 — AI 경로는 직접 INSERT하지 않는다). 저장 단위는 **페이지 1회**(ux-planner 회신 1대로 문항별로 쪼개지 않는다) |
| 10 | AI 쓰기 경로 | **확정** — `app_ai_writer`는 `apply_structured_draft_patch`로만 `structured_draft`를 바꾸고 **`application_documents`에는 select만** 있다(5장). 서류 본문·문항 확정은 사용자 세션 저장 RPC뿐. `p_form_snapshot`은 **저장하지 않는다**(시작 인사 4분기용) |
| 11 | 섹션별 `base_body_hash` | **권고 채택 — 슬롯(섹션·문항) 단위**. 공백 정규화는 OD-P5 **같은 함수**를 섹션 본문에 적용하고 "기준 본문이 바뀐 경우" 안내도 **그 슬롯에만** 낸다(2.5.0b) |
| 12 | `draft_count` 상한 | **권고 채택 — 대화 전체 6회**(사전 조사의 "섹션별 6회" 권고는 폐기). 자리·거부 코드는 2.5.0a와 같고(`structured_draft.draft_count`, `writing_chat_draft_limit_reached` 409) 상한에 닿으면 "새 대화에서 이어 하기"다. **`[가정]`·CL-Q1 묶음 표식 유지**(8장·2.9.4) |
| 13 | 글자 수 보정의 저장 위치 | **확정** — 보정은 초안 턴 안의 `adjust_length` 단계이고 **`style`**(`shorter`/`fit_length`)로 받는다(7장 턴 행). `char_count`·`char_limit_at_generation`·`char_adjust_needed`·`correction_applied`는 **그 문항 제안**에 적는다(정본에는 두지 않는다 — 정본의 초과 안내는 `char_count` vs `char_limit` 계산). `call_key`는 8번 |
| 14 | 섹션 근거를 `evidence_links`에 넣는 것 | **확정 — 넣는다. 산출물 대화와 다른 것이 맞다**(DM-15에 "서류 대화만 예외" 문장을 넣었다). **검증 분담도 회신 그대로**: V-1~V-9·숫자 가드·V-8은 **제안 단계**(초안 턴의 서버 검증), 저장 단계는 통과분을 옮기기만 한다. 다만 `job_competency` 문항의 `learnings` 근거 거부와 허용 출처 목록은 **저장 RPC에 마지막 안전망으로 남긴다**(2.8) |
| 15 | `input_hash` 재사용 폐기 확인 | **맞다 — 폐기 확정.** `drafts.input_hash`와 `(user_id, application_project_id, input_hash) where ready` 인덱스가 함께 폐기되고(2.7.4·11.8), 재사용이 남는 것은 **AI-11**(`career_snapshot_hash` + `requirements_hash`)뿐이다 |
| 16 | `composing` 폐기 | **동의·확정**(CL-A6). `drafts.status` 5값·`partially_failed`가 함께 없어지고 2.7.1 Q53-7 절 전체·4.5 자소서 `status` 계산 행을 폐기했다. "서류 초안 수"는 **내용이 있는 서류만** 센다(`filled_slot_count > 0`) |
| 17 | `features.draft` | **확정 — 판정값 유지, 뜻은 "초안 제안 차단"**(6장). 대화 자체는 D-01 미달에도 열린다 |
| 18 | 공급자·모델 배지의 자리 | **확정** — 제안 쪽은 그 턴의 `ai_jobs`·`writing_chat_messages`, 정본 쪽은 블록의 **`applied_writing_chat_id`·`applied_rev`**. "한 서류 안에서 문항별 공급자가 다를 수 있다"는 전제도 이 모양으로 유지된다(블록마다 다른 대화·다른 턴을 가리킬 수 있다) |

### → product-planner (11건)

| # | 요청 | 확정 회신 |
|---|------|-----------|
| 1 | 서류 정본 테이블 1개 신설 | **적용 완료**(2.7.3) — 추가 확인 없이 CL-9대로 신설했다. 순수 테이블 수 **29 → 28**(9장) |
| 2 | `drafts`·`draft_sections`·`draft_section_sources` 폐기 | **적용 완료 ★ 파괴적.** 폐기 표기는 기존 방식(취소선 + "v4.13 폐기")을 썼고 **57컬럼 대응표는 2.7.4**다(S 15 / C 9 / E 7 / J 7 / 폐기 19) |
| 3 | 마이그레이션은 비파괴 단계까지만 확정 | **적용 완료**(11.8 (2)) — 1~6단계와 관찰 기간(최소 1주 `[가정]`)까지 확정, **7단계 drop에 `[결정 필요]` CL-Q2**를 걸고 두 안을 나란히 적었다. (a)로 가면 **사용자 데이터 손실 안내 문구가 필요하다**는 점도 8장·11.8에 적었다(F-DOC-04의 "기존 초안도 편집·복사" 약속과 묶여 있다) |
| 4 | 이관 대화는 만들지 않는다 | **적용 완료**(11.8 — CL-A5 수정 반영). `evidence_links`는 `owner_type`·`owner_id`·`item_key` 세 컬럼을 다시 가리키고, **섹션 id로 기존 `draft_sections.id`를 재사용**해 `section_id`/`question_id`와 `user_note` 근거의 `source_id`는 값이 바뀌지 않는다. ⚠ 단 `owner_id`는 **정본 행**을 가리켜야 해서(UX·AI가 같은 답) **"`owner_id`를 안 바꿔도 된다"는 사전 조사 권고는 성립하지 않는다** — 5단계가 3컬럼 update다(여전히 비파괴) |
| 5 | 문체는 정본 쪽에 | **적용 완료** — `application_documents.meta.tone`(2값, null은 `concise`)이고 대화 쪽에는 `structured_draft.meta.tone_requested`만. `drafts.options.tone`은 이관 4단계에서 옮긴다. `selection_origin`은 **폐기**(제안의 `source_ranking.origin`으로) |
| 6 | 서류 대화의 상한과 상태 | **적용 완료** — 메시지 40·`active`/`closed` 그대로, **서류당 대화 수 상한 없음** `[가정]`(2.5) |
| 7 | 파기·보유 정책에 새 판단 없음 | **확인** — 서류 대화는 지원 프로젝트 삭제·대화 삭제·탈퇴까지, 자동 삭제 없음(3.4·4.4). **대화를 지워도 서류 본문·문항·근거는 남는다**(CL-9)를 3.3·3.4·4.1·4.2에 모두 적었다. 새 보유 기간이 없어 처리방침 문구 변경도 없다 |
| 8 | "서류 초안 수" 셈법과 `composing` 폐기 | **적용 완료** — 셈법은 `filled_slot_count > 0`(ux-planner 요청 6과 같은 값), `composing`은 2.7.1 절 전체 폐기. **RPC·뷰를 새로 두지 않고 컬럼 하나로** 통일했다(카드·보드·C-05·탈퇴 집계가 같은 식) |
| 9 | F-DOC-08·09 Must 유지 | **적용 완료** — 섹션별 근거는 `evidence_links`(슬롯 단위, 6.1 F-DOC-08), 문항 메모는 **정본 쪽**(`body.questions[].user_note`, 키 없이도 남는다). ⚠ 단 **"데이터 변경됨 표시"는 유지하고 "다시 제안 안내"의 판정 데이터(`sources_modified_at`)는 폐기했다** — ux-planner 회신 4가 "배너를 유지하지 않는다"로 답했기 때문이다(C-01 "변경됨" + 섹션 머리 한 줄로 알린다). PRD 요청 9의 "다시 제안 안내도 유지" 문장과 어긋나므로 **PRD 쪽 표현을 UX 회신에 맞춰 달라** |
| 10 | `features.draft` | **적용 완료** — 판정값 유지, "제안 차단"으로 정의(6장) |
| 11 | 저장 RPC와 저장 단위 | **적용 완료 — 페이지 단위**(ux-planner 회신 1이 "문항별로 쪼개지 않는다"로 답했으므로 그 결론을 따랐다). `save_application_document`는 `save_project_deliverable`과 같은 모양(`p_expected_updated_at`·`p_applied_proposals`·`p_client_id`·`stale_write`)이고 **`p_meta` 하나만 더 있다** |

### 다른 문서가 고쳐야 하는 이름 (리더 전달용)

| 문서 | 자리 | 지금 | 고칠 값 |
|------|------|------|---------|
| UX v5.18 | **845행**(C-01 데이터), 요청 3 | `item_key` = `sections.{section_id}.blocks.{block_id}` / `questions.{question_id}.blocks.{block_id}` / `…sources.{n}` | **`{slot}.blocks.{block_id}` / `{slot}.sources.{n}`**(`slot` = `s_{n}`/`q_{n}`) |
| UX v5.18 | 요청 2, C-11, S-45 "섹션 목록" | 섹션 근거 배열 항목 = `{experience_id, project_id, origin, rationale, requirement_ids, source_label, source_deleted_at}`(정본 안) | 근거는 **`evidence_links` 행**(정본에 복제하지 않는다). `origin`·`rationale`은 제안 쪽, `role`·`reuse_reason`·`requirement_ids`는 폐기 |
| UX v5.18 | 요청 5 | `start_document_writing_chat(…, p_return_target, p_form_snapshot)` | **`start_document_writing_chat(p_application_project_id, p_document_kind, p_form_snapshot)`**(1731행은 이미 맞다) |
| UX v5.18 | S-45·S-46 "저장", 1.3a | `save_application_document(p_application_project_id, p_document_kind, p_body, p_expected_updated_at, p_applied_proposals, p_client_id)` | 같은 이름 + **`p_meta` 추가**(문체) |
| UX v5.18 | C-05 두 행, FL-06 | 지원 프로젝트 삭제 영향 키 `drafts` | **`documents`·`document_chats`** |
| AI v4.13 | C-3 `item_key` 예시 | `s_3.b2`·`q_2.p1` | **`s_3.blocks.b2`·`q_2.blocks.p1`** |
| AI v4.13 | AI-03·AI-04 출력 스키마의 블록 근거 키 | (확인 필요) `evidence` | **`evidence`로 확정** — `source_evidence`·`source_career_items`·`source_requirements`를 쓰는 자리가 남아 있으면 고쳐 달라 |
| PRD v4.15 | 요청 9의 F-DOC-08 서술 | "'데이터 변경됨' 표시와 다시 제안 안내도 유지" | **다시 제안 안내(배너)는 유지하지 않는다**(UX 회신 4) — `sources_modified_at` 폐기 |
