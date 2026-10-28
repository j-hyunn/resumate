# S4 AI 파이프라인 구현 노트 (AI-12 AI 작성 대화)

> 완료(2026-10-28). **0절 "공개 인터페이스"가 api-engineer·db-engineer와의 합의 기준**이다. 패치 모양은 db 노트("패치 계약")를 그대로 따른다.

## 0. 공개 인터페이스

### 0.-1 QA 1차 대응 (2026-10-30)
- **QA-S4-03**: `extract`·`reply`의 deps에 선택 `callKey`를 추가했다. 넘기면 그 값이 `ai_usage_records.call_key`가 된다(`writing_chat.turn.{n}.extract|reply`, C-13). 없으면 예전 상수를 쓴다.
  - api `pipelines.ts`가 `call.callKey`를 `extract(ctx, { …, callKey })`, `reply(ctx, { …, callKey })`로 넘겨야 반영된다.
- **QA-S4-02 (ai 쪽)**: `deps.logger`를 넘기면 `ai_validation` 로그 1건을 남긴다.
  - 내용은 개수만이다: `proposed`·`applied`·`needs_review`·`rejected`·`rejected_V-9x`·`actor_ambiguous`·`sensitive_added`·`unchanged`.
  - 필드 종류별 거부 수 `rejected_field_<필드명>`(`rejectionTargetCounts`)을 더했다. 대화 원문·값·인용·상세 내용 키는 없다(테스트로 확인).
  - `jobId`도 deps로 받는다. api가 logger와 jobId를 넘기면 운영에서 켜진다.
- **QA-S4-07 (ai 쪽)**: `toDraftPatch`가 `add_sensitive_flags`를 **맨 앞**에 두고, 나머지를 99개로 자른다. 100개 상한에 걸려도 민감정보 개수가 빠지지 않는다(테스트 추가).

### 0.0 변경 (2026-10-28, api-engineer 반영 필요)
- `WritingChatTurnInput.messageCountAfterReply` → **`isFinalReply: boolean`** (`begin_assistant_message`의 `is_final`). db 규칙상 실제 최대가 39라 `>= 40` 판정은 켜지지 않는다.
  - `src/server/services/writing-chat/pipelines.ts`의 `Loaded` Omit 목록과 `toTurnInput`의 두 곳만 바꾸면 된다(현재 typecheck 오류 2건이 여기서 난다).
- 선택 입력 `declinedAffiliationIds?: string[]` 추가: 사용자가 [아니요]로 거절한 경력·교육 id. 아직 저장 위치가 없어 비워 두면 된다(아래 6절).
- `ExtractResult.patch`는 db 계약의 `{ ops: [...] }`(`DraftPatch`)다. 그대로 `p_patch`에 넘긴다. `isEmptyDraftPatch(patch)`면 RPC를 생략한다.

### 0.1 파일
| 파일 | 내용 |
|------|------|
| `src/server/ai/schemas/structured-draft.ts` | `structured_draft` 저장 형식 zod(`achievement_key` 포함), `parseStructuredDraft`, 검증 결과 `DraftChanges`, RPC 패치 `DraftPatch`/`DraftPatchOp`, `toDraftPatch`, `isEmptyDraftPatch`, RPC 한도 상수 |
| `src/server/ai/schemas/AI-12.ts` | 정리 모델 출력 zod(schema_version 2), `ai12ExtractJsonSchema()`, `SENSITIVE_CATEGORIES` |
| `src/server/ai/context-pack/writing-chat.ts` | `buildWritingChatContext`, `renderDraftForExtract`, `renderDraftStatusForReply`, `toMonth` |
| `src/server/ai/context-pack/focus-slots.ts` | `computeFocusSlots`, `predictReadyToReturn`, `nextDetailKey`, `SLOT_IDS`, `RequestedSlot` |
| `src/server/ai/validation/v9.ts` / `v9-lexicon.ts` | V-9a~h 개별 함수 + `validateExtractOutput` / 단어 목록·패턴 |
| `src/server/ai/prompts/AI-12/index.ts` | system 블록, user 블록 조립, prompt_version |
| `src/server/ai/pipelines/AI-12.ts` | `extract`, `reply`, 상수(tier·callKey·max tokens) |
| `src/server/ai/__fixtures__/AI-12/conversations.ts` | 가상 대화 6종 + 입력 헬퍼 |

### 0.2 runner 입력 `WritingChatTurnInput`
```ts
{
  mode: "new_project" | "augment_project";
  messages: { id; sequence; role: "user" | "assistant"; content; status: "streaming" | "done" | "failed" }[]; // 빌더가 done만 씀
  structuredDraft: unknown;            // 저장된 jsonb 그대로
  lastExtractedSequence: number;
  affiliation: { experienceId; educationId; parentStatus: "complete" | "draft" | null };
  candidates: { experiences: { id; companyName; startMonth; endMonth; isCurrent }[]; educations: { id; institutionName; programName; startMonth; endMonth }[] };
  augmentTarget: { project: { id; name; role; summary; startMonth; endMonth; teamSize }; details: { id; status; sortOrder; title; situation; task; action; result; learnings }[] } | null;
  desiredJobTitle: string | null;
  gate: { feature: "insight" | "career_description" | "cover_letter" | "job_interview"; missing: ("complete_experience" | "complete_project")[] } | null;
  requestedSlot: { slot: SlotId; detail_key: string | null; existing_detail_id: string | null } | null;
  isFinalReply: boolean;               // begin_assistant_message.is_final
  declinedAffiliationIds?: string[];   // 선택: [아니요]로 거절한 소속 후보 id
}
// SlotId = basic_info | situation | task | action | result | learnings | next_episode
```
- 날짜는 `YYYY-MM-DD`·`YYYY-MM` 모두 받는다. 한 턴에 컨텍스트 1개를 만들어 두 호출이 같이 쓴다(api 구현이 이미 그렇게 한다).

### 0.3 함수
```ts
buildWritingChatContext(input): WritingChatContext
// { draft, v9, focus: FocusPlan, pendingUserSequences, processThroughSequence, sensitiveNotice, delegationRequested, lastMessage, sharedBlocks, … }

extract(ctx, { llm, signal?, logger?, jobId? }): Promise<ExtractResult>
// ExtractResult = { skipped, patch: DraftPatch /* {ops} */, flags: DraftFlags, processedThroughSequence,
//                   report: V9Report /* 개수만 */, rejections: {check, target}[] /* 원문 없음 */, promptVersion, meta, attempts }
// 실패: ProviderError(C-11) 또는 AiError("schema_invalid", retryable:false). V-6 재요청 1회는 안에서 이미 썼다.

reply(ctx, { llm, signal? }): AsyncIterable<
  | { type: "delta"; text } | { type: "done"; text; result: AiCallResult }
  | { type: "error"; error: ProviderError; partialText } >   // error.beforeFirstToken로 즉시 재시도 판단

predictReadyToReturn(focusInput): boolean   // 패치 반영 후 새 draft로 다시 계산할 때
```
- `DraftFlags = { needsReview: FieldRef[]; actorAmbiguous: FieldRef[]; sensitiveAdded: number }`, `FieldRef = { target: "project"|"detail"|"achievement"; detail_key; existing_detail_id; field }` → SSE `draft_flags` 재료.
- 성공 시 `mark_writing_chat_extracted(processedThroughSequence)`. 정리 대상이 없으면 `skipped: true`(호출 없음).

## 1. 모델 등급·prompt_version
| 호출 | 등급 | 사고 | 최대 출력 | callKey | prompt_version |
|------|------|------|-----------|---------|----------------|
| 정리 extract | `light`(요청에 `tier` 지정) | low | 4,096 | deps.callKey ?? `writing_chat.extract` | `ai-12.extract.v1+common.v1` |
| 응답 reply | `default` | low | 2,048 | deps.callKey ?? `writing_chat.reply` | `ai-12.reply.v1+common.v1` |
- 계획 문서의 `AI-12.extract.v1` 대신 기존 규칙(`<기능 소문자>.<단계>.vN+common.v1`, S3)을 따랐다.
- 블록 순서(C-8): 공통 system → 기능 system | `<context>`(대화 내내 고정) → 메시지마다 블록 1개(마지막에 캐시 지점, Claude만) → 호출별 꼬리(extract: `<draft>`+`<task>`, reply: `<draft_status>`+`<turn>`).
- reply에는 정리 결과 **값 없이 상태만** 준다(질문에 사실이 섞이지 않게). extract에는 값·origin/review·출처 별칭을 준다(append·보호·중복 방지).

## 2. 출력 스키마 ↔ 저장 매핑 (db 패치 계약)
| 모델 출력 | RPC op |
|-----------|--------|
| `new_details[]` + 처음 보는 `detail_key` | `new_detail` (맨 앞) |
| `project_patches[]` | `set` `{section:"project", field}` |
| `detail_patches[]` (`detail_key`) | `set` `{section:"detail", detail_key, field}` |
| `detail_patches[]` (`detail_ref` DET-n) | `set` `{section:"detail", existing_detail_id, field}` |
| `op: "append"` | 파이프라인이 현재 값 + " " + 새 값, 출처·인용 합집합으로 `set` |
| `achievements[]` | `add_achievement` `{detail, fields}` (값 있는 필드만) |
| `skills[]` | `add_skill` (draft·이번 패치와 정규화 이름 중복이면 생략) |
| `affiliation_suggestion` (EXP/EDU-n) | `set_affiliation_suggestion` `{type, id, source_message_ids}` (새 프로젝트 + 확정 소속 없음 + 기존 제안과 다름 + **이번 정리 대상 발화를 출처로 포함** + 거절 목록에 없음일 때만, 아니면 `declined` 거부) |
| `clarifications[]` + V-9f | `set_clarifications` 전체 교체(바뀐 경우만), `note`는 버림 |
| `sensitive_flags[]` + V-9g 거부 | `add_sensitive_flags` `{count}` (맨 앞, 잘리지 않음, QA-S4-07) |
- `M{n}`(n = sequence) → 메시지 UUID, `DET-n` → `project_details.id`, `EXP-n`/`EDU-n` → 경력·교육 id. 저장 패치에 별칭이 남지 않는 것을 테스트한다.
- 인용은 모델이 쓴 문자열이 아니라 **발화 원문의 해당 구간**으로 바꿔 저장한다.
- RPC 한도에 맞춰 자른다: ops 100, 필드당 id·인용 20, 인용 1,000자(넘으면 V-9b 거부), clarifications 50, sensitive count 100.
- 기존 성과(`achievement_key`)를 고치는 출력은 없다. 같은 값의 성과는 중복으로 보고 건너뛴다.

## 3. 검증 규칙 (V-9, `validation/v9.ts`)
순서: 대상 확인(target·V-9h·보호) → 형식(type·length) → V-9a → V-9b → V-9g → V-9c → V-9d → V-9e → (action이면) V-9f.

| # | 구현 | 실패 |
|---|------|------|
| V-9a | 출처가 1개 이상, 모두 이번 호출의 `role=user`·`done` 메시지. **추가**: 출처가 모두 "알아서 채워 줘" 발화(`DELEGATION_PATTERN`)면 `V-9a.delegation` | 거부 |
| V-9b | 인용마다 정규화(공백·문장부호·NFKC·대소문자) 후 인용한 발화의 부분 문자열. 부분 일치(70%) 없음 | 거부 |
| V-9c | 문장 값: 숫자마다 같은 값이 인용에 있고, 단위가 둘 다 있으면 같아야 함(30% vs 30명 거부). `23년`→2023, `네 명`→4, `1.2만`↔12000, `1,200`. team_size는 단위 명/인/없음. 성과의 이전·이후 값은 성과 `unit`과 같은 단위(또는 단위 없음)여야 함, `unit` 문자열도 인용에 있어야 함. 기간은 인용에서 연·월을 모두 읽을 수 있어야 함 | 거부 |
| V-9d | 값의 영문 토큰, 스킬 사전(표기 변형: Kafka↔카프카), 회사명 접미사(`…페이`, `…뱅크` 등) 단어가 **출처 발화 전문**에 있어야 함. 스킬 값 자체도 출처에 있어야 함. 소속 제안은 후보 이름이 출처에 있어야 함 | 거부 |
| V-9e | 조사·어미를 뗀 내용어 중 인용에 없는 비율 > 0.4 → `needs_review`(앞뒤 한 음절을 뺀 형태도 인정: 재설계↔설계). 문장 필드·metric_name에만 | needs_review |
| V-9f | action 값이나 인용의 주어가 우리/저희/팀(조사 붙은 경우만) **이고** 인용에 제가·저는·직접 등이 없으면 → action 버림, `actor_ambiguous`, situation이 비어 있으면 같은 값을 situation에 `needs_review`로(= "situation 후보") | 되묻기 |
| V-9g | 값·인용에서 건강·종교·노조·정치·연락처·제3자 실명(성 + 2음절 + 직함) 감지 → 거부. 개수는 이번 정리 대상 발화에 대해서만 (발화, 범주) 단위로 셈. 모델 플래그도 같은 규칙 | 거부 + 개수 |
| V-9h | augment에서 DET-n이 컨텍스트에 없거나, 기존 행에 이미 값이 있는 컬럼, new_project의 `detail_ref` | 거부 (RPC도 막음) |
| 보호 | draft의 `user_edit`·`accepted` 필드 | 거부 (RPC도 막음) |
- clarification 해소: actor_ambiguous는 같은 상세 내용의 action이 `ok`로 들어오면, number_vague는 그 상세 내용에 성과가 추가되면, period_unclear는 시작·종료월이 `ok`로 들어오면, affiliation_unclear는 소속 제안·확정이 있으면 지운다.
- 로그: `ai_validation` 이벤트에 개수만(`rejected_V-9c` 등). 거부 목록은 `{check, target: "detail.D1.action"}`만 남긴다.

## 4. 이벤트·진행 단계·오류 코드
- SSE 이벤트 모양은 api 계약 기준이다. AI 쪽 재료: `reply` 이벤트 → `reply_delta`/`reply_done`, `ExtractResult.patch` → RPC → `draft_patch`, `ExtractResult.flags` → `draft_flags`.
- `progress.stage`: `extract` / `reply`(C-6).
- 오류: reply는 `error` 이벤트(`beforeFirstToken`), extract는 throw(ProviderError / schema_invalid). 정리 실패는 응답을 막지 않고 `last_extracted_sequence`를 두면 다음 턴에 다시 정리된다.
- 공급자가 terminal 이벤트 없이 스트림을 닫으면 `provider_unavailable`(받은 글자가 있으면 `beforeFirstToken:false`).

## 5. 테스트·픽스처
- 실제 공급자 호출 없음. `createFakeLlm`만 쓴다. 가상 데이터만 쓴다(회사 "에이비씨페이", "가나다대학교" 등).
- `validation/v9.test.ts` (125건): 개별 검사를 표로 확인(한국어 띄어쓰기·전각 문장부호, `30%`, `3배`, `1,200명`, `2년 6개월`, `1.2만 건`, `23년 3월`, `네 명`, 민감정보 오탐 사례 "장애 대응", "이번 팀장님", "부장님", "정산팀 팀장"), 종합 검증(보호, append, V-9h, V-9f, 성과, 스킬, 소속, 민감 개수, note 미저장).
- `context-pack/focus-slots.test.ts` (19): 순서, requested_slot·보강, 되묻기 우선, 게이트(필수 먼저, 보강 대상 상세 내용), D-01 예측 표.
- `context-pack/writing-chat.test.ts` (5), `schemas/structured-draft.test.ts` (7): 별칭, failed 제외, 태그 이스케이프, draft 파싱(achievement_key), op 순서·한도, 정본 스키마.
- `pipelines/AI-12.test.ts` (18): **픽스처 대화 6종**(협조적 / 몰아서 말함 / "우리 팀" / 수치 모름 / 민감정보 / "알아서 채워 줘"), 등급·callKey·사용 기록, 건너뛰기, V-6 재요청, 공급자 오류, 로그에 원문 없음, 프롬프트 입력(failed 제외·이스케이프·캐시 지점), reply 스트림·첫 토큰 전후 오류·turn 블록.
- 결과(2026-10-28): `pnpm vitest run src/server/ai` 24파일 452건 통과(거절 제안 반복 검사 포함), `pnpm eslint src/server/ai` 통과. `pnpm tsc --noEmit`: `src/server/ai` 오류 0건. api 쪽 `src/server/services/writing-chat/pipelines.ts`에 0.0의 이름 변경으로 2건 남아 있다.

## 6. 스펙 차이·가정·상수
| 항목 | 값 / 처리 | 근거 |
|------|-----------|------|
| `V9E_MAX_UNCOVERED_RATIO` | 0.4 (내용어 기준, 조사·어미 제거, 한 음절 차이 허용) | AI-12 V-9e `[가정]` |
| 스킬 사전 `SKILL_DICTIONARY` | 38개 항목(영문·한글 표기) | 계획: 작은 상수 목록에서 시작 |
| 회사명 후보 `ORG_SUFFIXES` | 페이·뱅크·카드·증권·전자·테크 등 14개 | V-9d "회사·제품명 후보" `[가정]` |
| 제3자 실명 | 성 + 2음절(복성 + 1~2) + 직함/님. 2음절 이름은 놓친다(오탐 방지), `NOT_A_NAME` 제외 목록 | V-9g `[가정]` |
| 민감정보 패턴 | 재현율 우선. 오탐이면 필드가 비고 미리보기에서 직접 입력 가능 | NFR-PRV-05 |
| "알아서 채워 줘" 발화 출처 거부 (`V-9a.delegation`) | 스펙 가드레일을 서버 검사로도 둠(추가 규칙) | AI-12 실패 유형 |
| V-9f "situation 후보" | situation이 비어 있을 때만 `needs_review`로 넣음(수락해야 저장) | 해석 `[가정]` |
| V-9c 단위 | 같은 값의 인용 숫자가 모두 다른 단위일 때만 거부. 성과 값은 성과 단위와 일치 | "단위 포함" 해석 |
| 고유어 수 | 한·두·세·네…열두·스무 + 명/개/번 등 | V-9c 한국어 |
| 길이 한도 | name·role 100, summary 200, title 100, STAR 2,000, metric 200, unit 50, skill 50 | DM 2.3 + db 값 형식 |
| `TEAM_SIZE_MAX` | 10,000 (DB는 32,767) | 구현 결정(상식 범위) |
| 슬롯 "건너뛰기" | DB에 기록하지 않음. reply가 대화 기록을 보고 넘어가고, `upcoming`으로 다음 후보를 준다 | 저장 위치 없음 |
| 과제·결과·회고 "한 번만 권유" | 서버 상태 없이 프롬프트 규칙(대화 기록에서 권했으면 다시 권하지 않음) | 위와 같음 |
| 기본 정보 완료 | 이름·역할. 기간은 STAR 뒤 `follow_up`으로 한 번 | 표의 "기간·역할이 없을 때 되묻기" 해석 |
| 마지막 메시지 | `is_final`(db RPC) 기준 | db 상한 규칙(최대 39) |
| 거절한 소속 제안 반복 금지 | 저장 위치가 없어(`p_dismiss_only`는 제안만 지움) ① 제안은 새 발화(정리 대상)를 출처로 포함할 때만 ② runner가 아는 거절 id(`declinedAffiliationIds`)는 항상 막음. 사용자가 새 발화에서 같은 회사를 다시 말하면 ①만으로는 다시 제안될 수 있다 | 리더 전달(db 결정), spec-gaps 2026-10-30 |
| reply 사실 금지 | 프롬프트 규칙만. 서버가 응답 텍스트를 검사하지 않는다(정리 경로는 V-9a로 AI 발화를 출처에서 막음) | AI-12 가드레일 |
| 게이트 요건 목록(R-31) | 넣지 않음. S5 확장 지점: `replyUserBlocks`에 요건 블록 추가, V-9d는 그대로 출처 발화만 대조 | 계획 |

- QA 1차 대응 후(2026-10-30): `src/server/ai` 24파일 454건, `src/server/services/writing-chat` 32건 통과, lint·전체 typecheck 통과.
