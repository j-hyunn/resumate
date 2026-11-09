# R15 — ai-pipeline-engineer 노트 (자기소개서 관리 AI 파이프라인)

- 날짜: 2026-11-09 (CF-S1 반영 후속 포함)
- 범위: 1-D(AI1~AI5). 기준 판 **AI v4.15**(0.v415·C-1·C-2·C-3·C-5·C-13·C-14·C-15·AI-01·AI-04) · DM v4.15(2.5.0b·2.6.2·2.7.3) · decisions 4.23
- 테스트: `npx vitest run src/server/ai` → **44 파일 1,198건 통과**. `npx tsc --noEmit`에서 `src/server/ai/**` 오류 **0건**(아래 "api-engineer가 치워야 하는 참조" 제외)
- 실제 공급자 API 호출 0건(가짜 SDK `createFakeLlm`만). 키·프롬프트·본문을 로그에 남기지 않음(C-7)

---

## ① 현행 번호 확인 결과와 올린 번호 (MRG-AI-1)

| 항목 | 계획서 전제 | **코드의 실제 현행값** | 이 판에서 올린 값 |
|------|-------------|----------------------|-------------------|
| AI-01 출력 `schema_version` | 1 → 2 | **1** (일치) | **2** |
| AI-01 프롬프트 | `ai-01.extract.v2` | **`ai-01.extract.v1+common.v4`** | **`ai-01.extract.v2+common.v4`** |
| AI-04 출력 `schema_version` | 3 → 4 | **2** ← 계획 전제와 다름 | **4**(번호는 명세대로 4로 간다, 3을 거치지 않는다) |
| AI-04 초안 프롬프트 | `ai-04.generate.v7`(RM이 v6을 먼저 썼다는 전제) | **`ai-04.generate.v5+common.v4`** ← RM(R14)이 쓴 것은 **v5**다 | **`ai-04.generate.v6+common.v4`** |
| AI-04 보정 프롬프트 | `ai-04.adjust.v7` | **`ai-04.adjust.v5+common.v4`** | **`ai-04.adjust.v6+common.v4`** |
| AI-04 정리·응답 프롬프트 | (명세: `ai-04.extract.v1`) | **없음** | **`ai-04.extract.v1+common.v4`** · **`ai-04.reply.v1+common.v4`**(이름 `[가정]`) |
| 공통 접미사 | `common.v4` 그대로 | `common.v4` | **그대로**(올리지 않음) |

근거: `git log` + 파일 내용 — R14 커밋 `a0f7dab`가 `[사례 입력 필요] → [내용 확인 필요]`로 v4 → **v5**를 썼고(R14 노트 R14-AI-1도 "v4 → v5"로 적혀 있다), v6은 코드에 없었다. 그래서 **+1 = v6**이다. 프롬프트 번호가 `input_hash`에 들어가므로 계획서의 v7을 그대로 쓰면 존재하지 않는 중간 판을 만들게 된다.

**더 중요한 차이 — 계획 전제가 한 단계 어긋나 있었다.** 현행 AI-04는 v4.13(CL-1~CL-10)의 **채팅형 전환이 구현되지 않은** 상태였다: 문항 1개를 한 번에 생성하는 카드형 파이프라인(`streamCoverLetterSection`, `selection_mode`, `question_ref = CLQ-1`, `complete_cover_letter_section` payload)이었고 서류 턴은 `writing-chat` 쪽에 분기가 없었다. 그래서 이 판의 AI-04 작업은 "`answer_title` 추가"가 아니라 **CL-* + CF-* 를 함께 구현하는 재작성**이 됐다(아래 ④). spec-gaps `R15-AI-1`.

---

## ② api-engineer와 합의할 인터페이스

### (1) 미리 보기 추출 (A2 `POST /api/job-descriptions/extract-preview`)

```ts
// src/server/ai/pipelines/AI-01.ts
extractJdRequirements(
  input: { sentences: readonly JdSentence[]; companyName: string | null; positionTitle: string | null; today?: string | null },
  deps: { llm: Llm; callKey?: string; signal?: AbortSignal; logger?: AiLogger; jobId?: string | null },
): Promise<JdExtractionResult>   // { output, requirementsHash, report, payload, promptVersion, meta, attempts }

jdPreviewSummary(result): { companyName: string | null; positionTitle: string | null; deadline: string | null; requirementCount: number }
```

- **입력은 `sentences`만이다**(계획서 초안의 `{normalizedRawText, rawTextHash}`를 함수 안으로 넣지 않았다). 정규화·분할·해시는 api 소유(`normalizeJdRawText` → `splitJdSentences` → `sha256Hex`)이고, 파이프라인은 그 결과를 받는다 — 생성 경로와 미리 보기 경로가 **같은 분할**을 쓰는 것이 핵심이기 때문이다.
- 미리 보기에서는 `companyName`·`positionTitle`을 **null로 보낸다**(1단계에는 사용자 입력값이 없고, `JobPosting` 값은 모델에 넣지 않는다 — CF-A6).
- `today`는 **KST 오늘(`YYYY-MM-DD`)**이고 **프롬프트에 들어가지 않는다**(CF-A5). 넘기지 않으면 `deadline` 기간 검사(검사 4)만 건너뛴다.
- `ai_jobs.output` = **`result.payload`**(= `apply_jd_extraction`의 `p_result`와 같은 모양, `deadline` 포함). `params = { raw_text_hash, sentence_count }`는 api가 만든다.
- 응답 바디 = `jdPreviewSummary(result)` + `previewJobId`. **요건 본문은 응답에 넣지 않는다**(서버 `output`에만 — CF-A17).
- `deadline`은 **검사 1~4를 모두 통과한 값만** 요약에 들어간다(지난 공고·366일 초과는 `usable: false`로 `extraction`에만 남고 요약은 null). 생성 RPC(D13)가 다시 검사한다.
- 던지는 오류: `ProviderError`(C-11) 그대로 / `AiError("not_a_jd")`(문장 0개 또는 공고 아님) / `AiError("schema_invalid")`. 재시도·대기(최대 6초)·Q53-1 게이트 409는 **러너·라우트 몫**이다.

### (2) 서류 턴 파이프라인 (A6 `POST /api/writing-chats/{id}/turns` 서류 분기)

```ts
// src/server/ai/context-pack/cover-letter-chat.ts
buildCoverLetterChatContext(input: CoverLetterChatTurnInput): CoverLetterChatContext
//   input: { messages, structuredDraft, lastExtractedSequence, questions(정본 body.questions[]),
//            formSnapshot?, careerRows, asOf?, jd: {jobDescriptionId, jobDescriptionUpdatedAt, sentences,
//            companySids, requirements, positionTitle}, insightSignal?, requestedSlot?, requestedSlots?,
//            requestedAction?, style?, isFinalReply?, now? }
selectDraftBatch(ctx) / planDraftBatches(ctx.questions) / firstTurnVariant(n) / firstDraftChipLabel(questions)

// src/server/ai/pipelines/AI-04.ts
planCoverLetterTurn(ctx): { kind: "question" } | { kind: "compose"; source } | { kind: "reject_draft_limit" }
extract(ctx, deps): Promise<CoverLetterExtractResult>        // { skipped, patch, intent, tone, processedThroughSequence, sensitiveAdded, report, promptVersion, meta, attempts }
composeDecision(ctx, plan, extracted): { action: "compose"; batch } | { action: "reply"; notices }
reply(ctx, deps, notices?): AsyncGenerator<ReplyEvent>        // delta / done / error
compose(ctx, deps, { batch }): AsyncGenerator<ComposeEvent, ComposeResult>
coverLetterCallKey(turn, "extract" | "reply" | "compose" | "adjust_length"): string
```

- 턴 순서는 C-15 그대로: 질문 턴 `extract ∥ reply`(무료 등급은 reply → extract, C-12), 초안 턴 `extract` → **패치 적용** → **컨텍스트 재조립** → `composeDecision` → `compose`.
- `compose`는 **문항 배열을 한 호출로** 쓰고, 보정이 필요한 문항만 **`adjust_length` 1회**를 안에서 더 부른다(그래서 초안 턴 호출 최대 3개 + 스키마 재시도 1 — C-15 "자소서는 3개까지").
- `deps.callKey`/`adjustCallKey`에 **턴 번호가 들어간 `call_key`**를 넘겨라(`cover_letter.turn.{n}.compose` 등, C-13). 기본값은 turn=1이다.
- `ComposeResult.patch`는 `apply_structured_draft_patch`의 `p_patch`다 — **문항마다 `replace_draft`(인자에 `slot`·`answer_title`)**, 남은 블록이 없으면 `count_draft` 1회. 초안 횟수는 **대화 전체 6회**이므로 `count_draft`는 턴당 1회만 보낸다.
- `job_type = 'cover_letter'`, `feature = 'cover_letter'`, 등급: extract `light` / reply·compose·adjust `default`.

### (3) SSE 이벤트 — **새 이름을 만들지 않았다**

| 순서 | 이벤트(기존 이름) | 파이프라인이 주는 값 |
|------|-------------------|----------------------|
| 1 | `turn_started` | 러너 |
| 2 | `draft_patch` | `extract().patch` 적용 결과(사실 갱신이 있을 때만) |
| 3 | `draft_flags` | `extract().report` / `sensitiveAdded` / clarifications |
| 4 | 문항마다 `sources_selected` | `ComposeEvent{type:"sources_selected", slot, questionNo, questionClass, sources}` |
| 5 | 문항마다 `draft_started` → `draft_block` | `ComposeEvent{type:"draft_started", attempt, reason, slots}` / `{type:"draft_block", slot, questionNo, attempt, block}` |
| 6 | 보정이 있으면 `adjusting_length` | `ComposeEvent{type:"adjusting_length", questions:[{slot, questionNo, charCount, charLimit, countBasis, reasons}]}` |
| 7 | 문항마다 `draft_done` | **러너가 RPC 응답(`rev`·`draft_count`)과 `ComposeResult.questions[]`를 합쳐 만든다** — 담을 것: `slot`, `answerTitle`, `charCount`, `charLimit`, `charAdjustNeeded`, `correctionApplied`, `needsReviewBlockIds`, `droppedBlockCount`, `rev`, `draftCount` |
| 8 | `reply_done` | `ComposeResult.assistantMessage`(서버 고정 문구) |
| 9 | `turn_done` | 러너 |

→ **계약 추가가 필요한 곳**: `src/lib/contracts/writing-chat.ts`의 `sources_selected`·`draft_block`·`draft_done`·`adjusting_length`에 **`slot`(과 `questionNo`)** 칸이 필요하다(기존 산출물 대화 모양은 슬롯이 하나라 없다). 이름은 그대로 두고 칸만 더해 달라. 서류 턴 이벤트 집합은 `CoverLetterTurnEvent`로 따로 두는 쪽을 권한다(산출물 턴과 payload가 다르다).

### (3-b) 문항 근거 `sources[]` — **CF-S1 (2026-11-09 사용자 결정, 문서 PR #68 미머지)**

> 이 워크트리의 `docs/planning/`에는 CF-S1이 **없다**(DM 2.5.0b·2.5.1·2.8, AI-04 "저장 매핑", decisions 3.28·4.23 반영은 PR #68). 아래는 리더가 전달한 확정 내용 기준이다.

- `replace_draft` 인자에 **`sources[]`**를 더했다 — 원소 `{source_type, source_id, role}`(`role` ∈ `primary`/`supporting`), **0~5개** `[가정]`. **새 연산을 만들지 않았다.**
- 저장 위치 = **`structured_draft.document.questions[].draft.sources[]`**. 폐기된 `document.source_ranking`(AI-11)과 **다른 자리**이고 이름이 겹치지 않는다. `structured_draft`의 `schema_version`은 **1 그대로**.
- **별칭 → `source_id` 변환은 블록 `evidence[]`와 같은 경로**다: `validation/cover-letter.ts`의 `toStoredSourceRef(alias, aliases)` 하나를 `toStoredEvidence`와 `toStoredSources`가 함께 쓴다. 그래서 `user_note` 출처의 `source_id`는 자동으로 **그 문항의 `question_id`**다(메모 별칭을 그 id로 등록했다). 허용 출처는 `STORABLE_SOURCE_TYPES`(DM 2.8 목록) 그대로이고 목록 밖(`writing_chat_message` 등)·모르는 별칭은 버린다.
- 기존 근거 검증이 **그대로 `sources[]`에 걸린다**: V-4(근거 인용이 하나도 남지 않은 선택은 버림) · V-7(문항별 범위) · V-8(`job_competency`의 `project.learnings` 거부) · 문항 유형별 개수 상한 · `primary` 1개 정규화(저장 순서도 `primary` 먼저) · 같은 항목 중복 제거.
- **`sources` 키 없음 ≠ 빈 배열** `[가정]`:
  - 키가 있으면(빈 배열 포함) db가 그 슬롯의 `{slot}.sources.{n}` 행을 **그 값으로 교체**한다. 빈 배열 = 근거 행 없음(프로젝트 0개가 정상인 `motivation`·`future_plan`).
  - **키가 없으면** db가 "제안에 `sources`가 없다"로 보고 **기존 행을 유지**한다.
  - 화면은 `sources`를 보내지 않으므로(`p_body.questions[]`에 키 없음) **제안이 저장의 유일한 원천**이다 → 초안 턴은 블록이 남은 문항마다 **항상 키를 싣는다**. 테스트로 묶었다(`hasOwnProperty("sources")`).
- 저장 쪽(db-engineer가 맞출 부분): `save_application_document`가 `p_applied_proposals`의 **applied 슬롯**에서 같은 `rev` 제안의 `draft.sources[]`를 읽어 행을 교체(`n` = 배열 순서, `primary` 먼저, **`role`은 행에 저장하지 않는다**). 적용 제안이 없는 슬롯은 기존 `sources` 행 유지 `[가정]`.
- 출력 `schema_version`은 **4 그대로**이고 프롬프트도 **`ai-04.generate.v6` 그대로**다 — `sources[]`(`role`·`rationale`·`reuse_reason` 포함)는 이미 모델 출력 스키마에 있던 값이고, 모델이 하는 일·선택 규칙이 바뀌지 않았다(서버가 그 값을 저장하기 시작했을 뿐이다). 번호를 올리면 `input_hash` 재사용만 잃는다.
- SSE `sources_selected`는 그대로 유지한다(화면 표시용 `role`·이유 한 줄, UUID). `ComposeResult.questions[].storedSources`가 저장용 값이다.
### (3-c) db-engineer 노트·마이그레이션 대조 결과 (2026-11-09)

원천: `_workspace/backend/R15/02_db-engineer_notes.md` ②-5·②-6·③ + 마이그레이션 `20261113003600`(허용 출처·트리거) · `20261113003800`(`wc_doc_sources`·`wc_document_block`·`wc_patch_document`) 실물.

| # | 항목 | 결과 | 조치 |
|---|------|------|------|
| 1 | `sources` 키 없음 vs 빈 배열 | **일치** — db: "키가 없으면 초안에 `sources`를 두지 않고 저장 때 기존 행 유지, 빈 배열은 지운다"(`if v_draft_obj ? 'sources'`). 내 구현과 같은 뜻 | 없음 |
| 2 | `role` 값 | **일치** — `primary`/`supporting`(`wc_doc_sources`) | 없음 |
| 3 | 0~5개 상한·`invalid_patch`(detail `op {i} sources`) | **일치**. 내 쪽은 보내기 전에 5개로 자르므로 이 raise에 닿지 않는다(문항 유형 상한 때문에 실질적으로 ≤ 2~3개) | 없음 |
| 4 | **`replace_draft` payload 모양** | **불일치 — 고쳤다.** db는 `{op, slot, question_id?, draft:{…}}`인데 내 조립은 `{op, body:{slot, …}}`이었다. 그대로 두면 `invalid_patch`('op N slot')로 턴이 통째로 실패했을 자리다 | `storage/cover-letter-patch.ts`를 `{op, slot, question_id?, draft}`로 바꿨다. `value`는 **보내지 않는다**(db가 `blocks`로 재조립). `question_id`는 새 슬롯 원소를 만들 때 db가 쓰므로 함께 보낸다 |
| 4b | `char_limit_at_generation`이 **null**일 때 | **불일치 — 고쳤다.** db는 `coalesce(jsonb_typeof(...), 'number') <> 'number'`라서 **값이 null이면 `invalid_value`**(초안이 조용히 저장되지 않는다). 키가 없으면 통과한다 | 숫자일 때만 키를 싣는다(`char_limit`이 null인 문항 — CF-M1대로 실제로는 생기지 않지만 타입상 가능) |
| 5 | 허용 출처 목록 | **일치** — db `private.evidence_allowed_sources('application_document')` = 8값(`experience`·`education`·`project`·`project_deliverable`·`skill`·`jd_requirement`·`jd_sentence`·`user_note`) = 내 `STORABLE_SOURCE_TYPES`와 같은 집합. 블록 근거와 슬롯 근거가 같은 함수를 읽는 것도 내 `toStoredSourceRef` 한 경로와 같다 | 없음 |
| 6 | 그 밖의 `invalid_patch`·`invalid_value` 조건 | **내가 보낼 수 있는 모양은 전부 통과**. 확인한 것: `slot` `^q_[0-9]{1,3}$` · `blocks` 1~200(내 최대 12) · `block_id` `^[A-Za-z0-9_.:-]{1,64}$`·**길이 ≤ 50**(`q_1.1`은 5자) · 슬롯 안 `block_id` 유일(문단 번호로 보장) · `type` 7종 중 `paragraph` · `basis` `new`/`current_body` · `review` `ok`/`needs_review`(파이프라인은 `accepted`를 내지 않는다) · `review_reason` string\|null · `placeholders`·`flags` ≤ 20 · 블록당 `evidence` ≤ 20·`quote` ≤ 2,000·`label` ≤ 300 · `source_fact_ids`는 **그 대화 사실의 uuid**(별칭을 이미 uuid로 바꾼다) ≤ 40 · `char_count` `^[0-9]{1,6}$` · `dropped_block_count` `^[0-9]{1,3}$`(999로 자른다) · `base_body_hash` ≤ 200 · `missing_slots` ≤ 20 · 조립된 `value` 1~8,000자 | 테스트 `matches the RPC payload shape of replace_draft`로 고정 |
| 7 | **R15-DB-3** 슬롯 근거 행의 `source_field`·`source_locator` null | **일치** — `StoredSource`는 `{source_type, source_id, role}` **3키뿐**이라 두 값이 아예 없다(db가 null로 쓴다). 블록 근거(`toStoredEvidence`)는 `source_field`·`source_locator`를 그대로 싣고, 두 변환은 **공유 함수 `toStoredSourceRef`에서 출처 식별자만** 가져가므로 섞이지 않는다 | 없음 |

**불일치로 남겨 리더에게 보고하는 것 1건** (내 쪽을 바꾸지 않았다):
- **블록 `review` 강제 규칙이 다르다.** db `wc_document_block`은 **`evidence[]`가 비면** 비제목 블록을 `review='needs_review'`·`review_reason='no_evidence'`로 **강제**한다. 내 쪽(AI-04 V-4·C-15 (8))은 **출처 3종(`evidence`·`source_fact_ids`·`source_body_quotes`) 중 하나라도 있으면 `ok`**다. 그래서 **이어 쓰기 블록(사실 또는 지금 본문 인용만 출처)**이 제안에는 `ok`로 들어가지만 저장된 제안에서는 `needs_review`가 되어 사용자가 [수락]해야 [반영]에 들어간다. DB 쓰기가 이기므로 화면 동작은 db 규칙이다. 어느 쪽이 맞는지는 기획 판단(AI 명세 "모든 문단에 출처 3종 중 하나 이상" vs DM 2.5.0b "근거 0개면 needs_review")이라 리더에게 올린다. 내 `review` 계산은 명세대로 두었다.
- 참고(불일치 아님): 블록의 `requirement_ids`는 db가 다시 조립하는 블록 객체에 없어 **저장되지 않는다** — AI 명세 "`requirement_refs`는 `requirement_ids` 컬럼에 저장하지 않는다(요건 대응은 블록 evidence의 `jd_requirement` 근거로)"와 같은 결론이다. 파이프라인은 화면 표시용으로만 들고 있다.

### (4) db-engineer에게 필요한 것

- `apply_structured_draft_patch` 서류 분기가 받아야 하는 `replace_draft` 인자: `slot`, **`answer_title`(string|null, ≤ 100 — 초과는 `invalid_patch`)**, **`sources[]`(CF-S1, 위 (3-b) — 키 없음과 빈 배열의 뜻이 다르다)**, `blocks[]`(아래 ⑤의 블록 모양), `value`(RPC가 다시 조립), `base_body_hash`, `replace_allowed`, `char_count`, `char_limit_at_generation`, `char_adjust_needed`, `correction_applied`, `missing_slots`, `dropped_block_count`. 그 밖의 연산은 `add_facts`(`slot`이 `^q_[0-9]{1,3}$`) / `count_draft` / `set_clarifications` / `add_sensitive_flags` / **`set_tone`**뿐이다 — `set_section_order_proposal`·`set_source_ranking`·`set_writing_kind`는 보내지 않는다.
- `evidence_links.source_field`로 가는 값: 커리어 5종의 기존 필드 + `jd_requirement`·`jd_sentence`(필드 없음) + `user_note`(필드 없음, `source_id` = 그 문항의 `question_id`). **답변 제목은 근거 행을 만들지 않는다**(CF-6).
- V-8 마지막 안전망은 파이프라인과 **같은 규칙**이어야 한다: `job_competency` 문항에서 `source_type='project' AND source_field='learnings'` 거부. 파이프라인은 `motivation`·`future_plan`·`experience_story`에서만 `learnings`를 **회고 문장 근거로만** 허용한다(사실 주장 근거로는 플래그).

---

## ③ 제거한 AI-03 · AI-11 코드 (CF-1, ID 재사용 금지)

`git rm` 한 파일:

- `src/server/ai/pipelines/AI-03.ts`, `AI-03.test.ts`
- `src/server/ai/pipelines/AI-11.ts`, `AI-11.test.ts`
- `src/server/ai/schemas/AI-03.ts`, `src/server/ai/schemas/AI-11.ts`
- `src/server/ai/prompts/AI-03/index.ts`, `src/server/ai/prompts/AI-11/index.ts`
- `src/server/ai/context-pack/summary-pack.ts` — **AI-11 전용 요약형 팩**(C-1.1 (a), 채택되지 않은 안). CL-Q1 확정이 "모든 턴에 전체 팩"이므로 요약형 팩을 남기지 않았다.
- `src/server/ai/storage/drafts.ts` — `complete_career_description` / `complete_cover_letter_section` payload 조립. 서류 저장이 `save_application_document` 하나가 되면서 두 RPC가 모두 폐기되고, 삭제 시점에 이 파일을 참조하는 코드는 이미 없었다.

같은 파일 안에서 **지운 식별자**:

- `context-pack/selection.ts`: `MAX_DRAFT_PROJECTS`(프로젝트 ≤ 8) · `packProjects` · `deriveSelection` · `selectionFromPrioritiesWithAliases` · `DraftSourceSelection`(AI-03 포함 항목·AI-11 기본 선택 전용). 남긴 것은 `filterCareerRows`·`sourceLabel`.
- `prompts/prompt-versions.test.ts`: AI-03·AI-11 행 삭제 + `ai-03.`/`ai-11.` 이름이 어느 `prompt_version`에도 다시 나타나지 않는지 보는 단정 추가.
- 테스트 fixture `__fixtures__/S7/drafts.ts`는 AI-04가 계속 쓰므로 남겼다(주석의 AI-11·AI-03 언급만 사실과 맞게 둔다).

**api-engineer가 치워야 하는 참조**(내 경로 밖이라 손대지 않았다 — 지금 `tsc`가 이 3파일에서만 깨진다):

| 파일 | 깨진 이유 |
|------|-----------|
| `src/server/jobs/drafts.ts` | `pipelines/AI-03`·`AI-11` import, 그리고 옛 AI-04 export(`AI04_TIER`·`buildCoverLetterContext`·`computeCoverLetterInputHash`·`streamCoverLetterSection`·`CoverLetterContext`) |
| `src/server/services/drafts/drafts.integration.test.ts` | 같은 import (A7 폐기 대상 디렉터리) |
| `src/lib/data/w3.integration.test.ts` | 같은 import (옛 서류 생성 경로 통합 테스트) |

A7(서비스·라우트 폐기)과 **같은 커밋에서** 사라져야 한다.

---

## ④ 구현 판단

### AI1 — AI-01 `deadline` (CF-2·CF-A5)

- 출력 스키마: `deadline: { value: string | null, source_sids: string[] } | null`을 **필수 키**로 더했다(C-10.2 canonical: 모든 키 필수, 빈 값은 명시적 null). `schema_version` 리터럴 2.
- 서버 검증은 `validation/jd-extraction.ts`의 **기존 `source_sids` 검증과 같은 경로**다: `filterSids`로 그 분할 안의 문장 ID만 남기고(검사 2), 그다음 `validateDeadline`이 검사 1(실제 달력 날짜)·3(인용 문장에 연·월·일 숫자, 2자리 연도는 `26.`·`'26`만 20YY로)·4(KST 기준일 ~ +366일)를 본다. 검사 5(요일 표기)는 **보지 않는다**.
- **검사 1~3 실패 = 값만 버리고 추출은 성공**(`report.deadline_dropped`). 검사 4 실패는 값을 `extraction.deadline`에 남기고 `usable: false` + 지난 날짜면 `warnings`에 "공고의 마감일(YYYY-MM-DD)이 이미 지났어요".
- **키가 없는 옛 결과(schema_version 1)는 그냥 통과한다** — `deadline` 키를 optional로 읽고 `null`로 정규화하며 `deadline_dropped`를 올리지 않는다. 테스트 있음.
- `requirements_hash`는 `deadline`을 보지 않는다(요건 4개 값만 — 재사용 판정이 마감일로 깨지지 않는다).
- `jd_extraction` payload(`p_result`)에 `deadline: {value, source_sids, usable}`을 더했다. **최종 판정은 RPC(D13)가 다시 한다** — `usable`은 파이프라인의 판단을 그대로 전달하는 정보값이다.

### AI2 — AI-04 자소서 문항 답변 작성 AI 채팅 (재작성)

새 파일:

| 파일 | 내용 |
|------|------|
| `schemas/AI-04.ts` (교체) | 모델 출력 **schema_version 4** 3종 — compose(`questions[]`: `question_slot` → `sources` → `paragraphs` → **`answer_title`** → `notes_for_user`) · extract(facts/source_selection/clarifications/tone/intent/sensitive_flags) · adjust(문항별 `paragraphs`만). `selection_mode`·`question_ref` 폐기, 슬롯 패턴 `^q_[0-9]{1,3}$` |
| `schemas/cover-letter-draft.ts` (신설) | `structured_draft` 자소서 모양(DM 2.5.0b) — `schema_version` **1 유지**, `document.questions[].draft.answer_title`, 블록의 `evidence[]`·`source_fact_ids`·`source_body_quotes`·`placeholders`·`flags`·`review`·`review_reason`. `paragraphBlockId(slot, n) = "{slot}.{n}"` |
| `context-pack/cover-letter-chat.ts` (신설) | 턴 컨텍스트 + **팩 조립 한 지점** + 턴 분할 + 첫 턴 문구 분기 + 데이터 블록 렌더러 |
| `validation/cover-letter.ts` (신설) | 근거 선택 검증(V-1~V-4·V-7·V-8) · 문단 검증 · 정리 턴 검증(V-9a~e·g, V-9f → `actor`) |
| `validation/answer-title.ts` (신설) | 답변 제목 검증 — 걸리면 **제목만 버린다** |
| `storage/cover-letter-patch.ts` (신설) | `apply_structured_draft_patch` 서류 연산 조립 (+ CF-S1 `sources[]`) |
| `pipelines/AI-04.ts` (교체) | `planCoverLetterTurn` / `extract` / `reply` / `composeDecision` / `compose`(스트리밍) / `adjustLength` |
| `prompts/AI-04/index.ts` (교체) | compose v6 · adjust v6 · extract v1 · reply v1 |

구현 판단:

- **답변 제목**: `draft_done`에만 담기므로 **스트리밍하지 않는다**. 검증은 **보정이 끝난 그 문항의 최종 문단**을 기준으로 돈다. 숫자·고유명사·민감정보·자리 표시·100자에 걸리면 `answer_title = null`이고 **본문은 그대로 산다**. **현재 제목이 있는 문항은 모델에게 null을 요구하고, 모델이 그래도 제목을 내면 서버가 버린다**(사용자 제목을 덮는 경로를 코드로 막았다).
- **글자 수**: 제목은 `char_count`·`char_limit_at_generation`·`char_adjust_needed` 계산과 `adjust_length` 호출 **양쪽 모두에서 빠진다**(보정 프롬프트에 제목을 넣지 않고 출력 스키마에도 제목 칸이 없다). 테스트로 묶었다.
- **한 바퀴 초안 턴 2회**: `planDraftBatches`가 문항 ≤ 3이면 1회, 4~5면 `[1,2,3] + [4,5]`. 문항들의 `char_limit` 합계가 3,000자를 넘으면 턴당 2문항으로 줄인다(`[가정]`, 명세 그대로). `selectDraftBatch`는 사용자가 고른 문항 → 비어 있는 문항 → (전부 채워졌으면) 처음부터.
- **첫 턴 문구 분기**: `firstTurnVariant(n)` = 4~5 → `batched`, ≤ 3 → `all`. 칩 문구는 `firstDraftChipLabel` = "먼저 1~3번 문항 초안 만들기" / "초안 만들기" — **최종 문구는 UX 몫**이므로 파이프라인은 분기와 기본 문구만 들고 있다.
- **`char_limit`이 null인 문항을 건너뛰는 분기를 만들지 않았다**(CF-M1). null이면 "목표 글자 수 없음"으로 흘러가 보정만 돌지 않는다(저장 RPC가 null을 필수로 막는다).
- 초안 호출 실패는 **이전 제안을 건드리지 않는다**(패치를 만들지 않는다). 보정 호출 실패는 1차 초안을 플래그만 달아 살린다. 사용자 중단(`canceled`)은 그대로 던진다.

### AI4 — 팩 빌더 한 지점 · 출처 별칭 (CL-Q1)

- 서류 턴의 커리어 컨텍스트는 `buildCoverLetterChatContext` 안의 **`buildCareerPack(careerRows)` 호출 하나**로만 만든다. 파이프라인·프롬프트는 `ctx.packText`만 받고 행을 다시 조립할 길이 없다(요약·선택 함수를 지웠다 — ③).
- 별칭은 그대로 `EXP`·`EDU`·`PRJ`·`DLV`·`SKL`(+ `REQ`·`S`·`NOTE`·`F`·`M`)이고, 근거 검증(V-1·V-2·V-7)은 별칭 → 행 해석 한 경로만 쓴다. RAG로 바꿀 때 조각에 같은 별칭을 달면 검증이 그대로 돈다.

### AI5 — V-10 범위 · V-8 안전망

- 서류 블록은 **문단(paragraph) 하나뿐**이므로 산출물 대화의 V-10(heading/list/table/코드 블록, 콘텐츠 단위별 drop)을 가져오지 않았다. 자소서 블록 기준은 `checkQuestionParagraphs`다: V-1~V-5(숫자는 `final`에서 `[수치 확인 필요]` 치환) + V-7(문항별 scope) + V-8 + 스킬명 가드 + 자리 표시 + 출처 3종.
- **근거 0개 판정**: `evidence` + `source_fact_ids` + `source_body_quotes`가 **모두 비면** `review = needs_review`, `review_reason = 'no_evidence'`(수락해야 반영된다). 숫자·스킬명·글자 수·자리 표시는 플래그만 — C-15 (8) 그대로.
- **V-8 안전망**: `job_competency` 문항은 `learnings` 정책이 `forbidden`이라 `learnings` 근거가 **파이프라인에서 제거된다**(저장 RPC 거부 규칙과 같은 값 쌍). 테스트: `job_competency`에서 제거 / `future_plan`에서는 회고 근거로 유지.

---

## ⑤ `[가정]` (이 판이 새로 정한 것)

1. **프롬프트 번호 v6** — 현행이 v5였다(계획서 v7 전제는 RM이 v6을 썼다고 본 것). spec-gaps `R15-AI-1`.
2. **`ai-04.reply.v1`** — 명세는 `ai-04.extract.v1`만 이름을 준다. 응답 호출 프롬프트 이름을 같은 규칙으로 지었다.
3. **메모 별칭 `NOTE-{문항 번호}`** — 명세 예시는 한 문항 기준 `NOTE-1`이다. 한 턴에 문항이 3개이므로 문항마다 별칭이 필요하다. `source_id`는 그 문항의 `question_id`(명세 그대로).
4. **문단 id `{slot}.{n}`** — 명세 "문단 id는 서버가 정한다({question_slot}.{n})"를 그대로. 모델의 `block_id`는 믿지 않는다.
5. **근거 0개 = 출처 3종이 모두 빈 것**(위 AI5). DM 2.5.0b의 "근거 0개"를 `evidence[]`만으로 읽으면 사실만 인용한 문단이 전부 `needs_review`가 된다.
6. **답변 제목 검증 순서** — 명세는 ①숫자 ②고유명사 ③민감정보 ④별칭 치환 ⑤자리 표시·길이다. 구현은 **④를 ①보다 먼저** 돈다(별칭 토큰 `PRJ-3`이 남아 있으면 숫자·고유명사 가드가 멀쩡한 제목을 버린다). 블록 검사도 치환 뒤에 스킬명 가드를 보므로 같은 순서다.
7. **제목에서 `[수치 확인 필요]`도 버린다** — C-5의 5개 자리 표시 토큰 외에 숫자 가드 치환 토큰이 제목에 남는 경우.
8. **`usable` 플래그**(AI-01 payload `deadline.usable`) — 기간 검사 결과를 RPC에 전달하는 정보값. RPC는 자기 기준으로 다시 검사한다.
9. **`COVER_LETTER_TONES = ["concise","detailed"]`** 를 `schemas/AI-04.ts`에 두었다(기존 `DRAFT_TONES`는 폐기 예정 파일 `contracts/draft.ts`에 있다). `enums.ts` 미러가 필요하면 api가 같은 두 값으로 맞춰 달라.
10. **`compose` 호출 최대 2회**(스키마 재시도 1회). V-10식 "탈락률 초과 재생성"은 서류에 두지 않았다 — 자소서는 문단 단위 drop이 드물고 60초 예산에 보정 호출이 이미 들어간다.
11. **CF-S1 구현에서 새로 정한 것**: `sources[]` 상한 5개(리더 전달 `[가정]`) · 같은 `(source_type, source_id)` 중복 제거 · 선택 대상은 V-1이 해석한 프로젝트/소속 경력/교육이고(메모·JD 근거는 블록 근거에 남는다) 변환 함수는 모든 출처 종류를 같은 경로로 처리한다 · 보고 카운터 `question_sources_dropped`·`question_sources_truncated`.
12. 모델에 넣는 다른 문항 본문 미리보기 길이 상한(`OTHER_ANSWER_PREVIEW_CHARS = 200`)은 상수로만 두었다(현재 `<other_questions>`는 프로젝트 별칭만 넣는다).

---

## ⑥ 테스트

| 파일 | 묶는 것 |
|------|---------|
| `validation/jd-extraction.test.ts` (추가 11건) | `deadline` 검사 1~4 — 정상 유지 · **분할 밖 `source_sids` 거부** · 빈 sids 거부 · 달력 아닌 날짜 거부 · 연도 없는 인용 거부 · 2자리 연도(`26.`) 허용 · 지난 날짜(값 유지 + `usable:false` + warning) · 366일 초과 · 당일 허용 · **키 없는 옛 결과 통과** · `value:null` |
| `storage/jd-extraction.test.ts` | payload 키에 `deadline` 포함, `extraction.schema_version = 2` |
| `context-pack/cover-letter-chat.test.ts` (신설 12건) | 팩 한 지점·별칭 · 문항 번호·메모 별칭 · **폼 스냅숏 우선(명시적 null은 "지움")** · 제목만 있는 문항은 비어 있음 · 문항 5개 상한 · **5문항 → 초안 턴 2회(3+2)** · 3문항 → 1회 · 제한 합계 > 3,000 → 턴당 2문항 · 비어 있는 문항 먼저·지정 문항 우선 · **첫 턴 문구 분기 2종** |
| `validation/answer-title.test.ts` (신설 9건) | 통과 · 숫자 위반 버림 · 고유명사 버림 · 민감정보 버림 · 자리 표시·100자 버림 · 여러 줄 → 한 줄 · 별칭 치환(버리지 않음) · 제안 없음/빈 제안 · 안내 문구 |
| `validation/cover-letter-sources.test.ts` (신설 6건, CF-S1) | 별칭 → `source_id` 변환이 블록 근거와 같은 경로(**`user_note` = `question_id`**) · 모르는 별칭·저장 불가 출처 거부 · **`primary` 1개 정규화와 순서** · V-4(근거 0개 선택)·V-1(팩 밖) 거부 · **V-8**(`job_competency` 거부 / `future_plan` 유지) · V-7 범위 밖 거부 · 중복 제거·5개 상한 |
| `pipelines/AI-04.test.ts` (신설 13건) | 제목 유지 + `replace_draft`에 실림 · **제목만 버리고 본문은 살아남음** · 제목 있는 문항엔 null 요구 · **글자 수·보정에서 제목 제외** · 문항 배열 → 문항마다 `replace_draft`·이벤트 · 모르는 슬롯 무시 · 남은 블록 없음 → `count_draft` · **V-8(job_competency 거부 / future_plan 유지)** · `call_key` · 초안 상한 거절 · 질문 턴 판정 · **(CF-S1) `replace_draft`에 `sources[]` 실림** · **근거 0개 문항은 키를 두고 빈 배열** |
| `prompts/prompt-versions.test.ts` | 올린 번호 고정 + `ai-03.`/`ai-11.` 이름 재사용 금지 |

---

## ⑦ 열린 문제 (spec-gaps에 올림)

1. **`R15-AI-1`** AI-04의 v4.13(CL-*) 채팅형 전환이 구현되지 않은 상태였다 — 계획서의 "schema_version 3 → 4"·"프롬프트 v7" 전제가 한 판 어긋나 있었다. 이 판에서 CL-* + CF-* 를 함께 구현했고 번호는 **4 / v6**이다.
2. **`R15-AI-2` — 해소됨 (CF-S1, 2026-11-09 사용자 결정; 문서 PR #68 미머지).** 구현은 위 ②(3-b). 아래는 원래 적어 둔 문제 서술이다: `evidence_links.item_key = {slot}.sources.{n}`(근거 선택 이유 행)을 **저장 RPC가 어디서 받는지 정해져 있지 않다.** `structured_draft`에는 `sources[]`가 없고(AI-11 폐기로 `role`·`rationale`·`reuse_reason`은 "이벤트·대화 기록에만"), 저장은 폼 값 + `p_applied_proposals`로 돈다. 파이프라인은 `ComposedQuestion.evidence`에 `{slot}.sources.{n}` 항목을 들고 있으니 ① 화면이 `sources_selected`로 받은 값을 저장 때 돌려주거나 ② `structured_draft`에 `sources` 자리를 두거나 ③ 그 `item_key`를 쓰지 않는 중 하나를 기획이 정해야 한다. → **확정: ②의 변형(AI 초안에 실어 저장). 구현 완료.**
3. **`R15-AI-3`** 서류 턴 SSE payload에 `slot` 칸이 필요하다(계약 변경 — 이름은 그대로). api-engineer와 합의 필요.
4. `document.question_edit_proposal`(F-DOC-10 Could)은 **자리만** 뒀다(모델이 채우지 않는다).
5. `reply`의 `no_requirements` 안내는 러너가 "JD 요건 0개"를 보고 넘겨야 한다(파이프라인은 요건 존재를 판정하지 않는다).
