# R5 AI 파이프라인 구현 노트 (PA-1~PA-4, AI 명세 v4.6 AI-12·AI-13)

- 작성: ai-pipeline-engineer, 2026-11-03
- 기준: AI 명세 v4.6(0.v46, AI-12, AI-13, C-1·C-1.1, C-3, C-11~C-14), DM v4.5(2.5, 2.5.0, 2.5.1, 3.7 이름, 7장 턴 계약), `02_db_notes.md`(패치 계약은 `20261110000200_r5_structured_draft_patch_v4.sql` 본문과 맞춤)
- 소유 범위: `src/server/ai/**`만. 서비스·액션·UI는 건드리지 않았다. 커밋 안 함.
- 결과: `pnpm vitest run src/server/ai` **46 파일, 958개 모두 통과**. `pnpm eslint src/server/ai` 0건. `pnpm typecheck`의 AI 영역 오류 0건(전체 오류 1건은 api 몫 `services/writing-chat/chat.ts:205` — `apply_writing_chat_proposal` 삭제).

## 1. 파일

| 구분 | 파일 | 내용 |
|------|------|------|
| 수정 | `schemas/structured-draft.ts` | 필드 객체 `rev`(정수, 없으면 1), `StarChange.new_object`, STAR 패치 op에 `new_object: true` 전달, 주석(반영됨 = `save_project_page`) |
| 수정 | `context-pack/writing-chat.ts` | `ProjectFormSnapshot`, `WritingChatTurnInput.formSnapshot`, `applyFormSnapshot()`, 컨텍스트 `project`(스냅숏 적용본)·`valueSource`, 폼에 채워진 제안 표시 |
| 수정 | `validation/v9.ts` | `containsNormalized`, `pendingInForm`, 폼에 채워진 제안은 C-14 길이에서 한 번만 셈, `new_object` 판정, 같은 문장 덧붙임 = 변화 없음, 폼에 채워진 `user_edit`·`accepted`는 보호 해제 |
| 수정 | `prompts/AI-12/index.ts` | `ai-12.extract.v4`, `ai-12.reply.v4`(폼 현재 값·반영 = 폼 채우기·저장하기 문구) |
| 수정 | `pipelines/AI-12.ts` | 주석만 |
| 신규 | `context-pack/deliverable-slots.ts` | 산출물 종류 5개·표시명·제목 키워드 짐작(DB 함수와 같음), 종류별 슬롯 5개, 슬롯 표시명, 초안 상한·조건, `COMPOSE_STYLES`, `DELIVERABLE_REQUESTED_ACTIONS`, **칩 함수 `deliverableChips()`** (의존성 없음 — 화면이 import 가능) |
| 신규 | `context-pack/deliverable-chat.ts` | AI-13 입력 타입, `buildDeliverableChatContext()`, 본문 잘라 넣기·`replace_allowed`·`base_body_hash`, 부모 프로젝트 출처 텍스트, 사실 별칭 `F-n`, 초 요청 감지, 슬롯 순서 `computeDeliverableFocus()`, 렌더러 |
| 신규 | `schemas/deliverable-draft.ts` | 산출물 대화 `structured_draft` zod(DM 2.5.0), `parseDeliverableDraft`, `isDeliverableDraftJson`, 블록·사실·출처 enum |
| 신규 | `schemas/deliverable-markdown.ts` | 블록 → 마크다운(DB `private.wc_block_markdown`과 글자 단위로 같음), `appendToBody()`(덧붙이기 미리보기). 의존성 없음 |
| 신규 | `schemas/AI-13.ts` | 정리·초안 모델 출력 zod + 정본 JSON 스키마 |
| 신규 | `validation/v10.ts` | 사실 검증(V-9a~e·g + actor), 블록 검증 V-10a~h, 30% 판정, 8,000자 자르기, 빈 제목 정리 |
| 신규 | `storage/deliverable-patch.ts` | `factsPatch()`, `draftPatch()`, `deliverableDraftFlags()` (RPC 패치 = 저장 매핑) |
| 신규 | `prompts/AI-13/index.ts` | 정리·응답·초안 system 블록, user 블록, `replyNotices()`, `composeMode()` |
| 신규 | `pipelines/AI-13.ts` | `planDeliverableTurn`, `extract`, `composeDecision`, `reply`, `compose`(스트리밍 제너레이터) |
| 신규 | `__fixtures__/AI-13/conversations.ts`, `__fixtures__/AI-13/eval-set.ts` | 가상 대화·사실·초안 출력, 평가 세트 골격 15건(종류 5 × 3, 시나리오 9종, 자동·사람 기준) |
| 테스트 | `validation/v9.snapshot.test.ts`(16), `validation/v10.test.ts`(40), `context-pack/deliverable-chat.test.ts`(33), `pipelines/AI-13.test.ts`(20), 기존 `v9.test.ts`·`AI-12*.test.ts` 기대값 갱신 | 8장 |

## 2. 모델 등급·prompt_version

| 기능 | 호출 | 등급·사고 | prompt_version | call_key 기본값 |
|------|------|-----------|----------------|-----------------|
| AI-12 정리 | 구조화 | 경량, low | `ai-12.extract.v4+common.v2` (v3 → v4) | `writing_chat.extract` |
| AI-12 응답 | 텍스트 스트림 | 기본, low | `ai-12.reply.v4+common.v2` (v3 → v4) | `writing_chat.reply` |
| AI-13 정리 | 구조화 | 경량, low | `ai-13.extract.v1+common.v2` | `writing_chat.extract` |
| AI-13 응답 | 텍스트 스트림 | 기본, low | `ai-13.reply.v1+common.v2` | `writing_chat.reply` |
| AI-13 초안 | 구조화 **스트림** | 기본, low, 출력 상한 16,000 토큰 | `ai-13.compose.v1+common.v2` | `writing_chat.compose` |

- 미터 `feature = writing_chat`(AI-12와 공유). `ai_usage_records`는 `Llm.onCall`이 호출마다 1행(초안 재시도·재생성도 각각).
- 공통 블록 `common.v2`는 그대로.

## 3. 파이프라인 진입점 (api-engineer가 부르는 것)

### 3.1 AI-12 (변경분만 — 함수 시그니처는 그대로)

```ts
// context-pack/writing-chat.ts
type ProjectFormSnapshot = {           // 턴 요청 form_snapshot (DM 2.5.1), 키가 없으면 DB 값, null/"" = 폼에서 비움
  name?: string; start_month?: string | null; end_month?: string | null; is_current?: boolean;
  project_type?: string | null; experience_type?: string | null; competencies?: readonly string[];
  star?: Partial<Record<"situation"|"task"|"action"|"result"|"learnings", string | null>>;
};
WritingChatTurnInput.formSnapshot?: ProjectFormSnapshot | null   // ← 새 필드. zod로 검증한 요청 값을 그대로 넘긴다
buildWritingChatContext(input) → WritingChatContext   // ctx.project = 스냅숏 적용본, ctx.valueSource
extract(ctx, deps) / reply(ctx, deps)                  // 그대로
```

- 스냅숏을 넣으면 V-9h(set/append)·빈 값·기간·분류 "빈 값만 추천"·C-14 남은 글자 수·슬롯 순서가 모두 **스냅숏 기준**이 된다. 없으면 DB 값(구버전 화면).
- **`new_object`**: 미반영 STAR 제안의 `value`가 스냅숏 같은 필드에 (V-9b 정규화 부분 문자열로) 들어 있으면, 그 필드의 이번 턴 첫 패치가 `{ op: "append", new_object: true, … }`로 나간다. 같은 턴 두 번째 패치부터는 `new_object` 없이 새 객체에 이어 붙는다. 폼에 채워진 `user_edit`·`accepted` 제안은 보호하지 않는다(DB R5-DB-2와 같음).
- 이미 폼 값·미반영 제안·이번 턴 직전 패치에 들어 있는 문장의 `append`는 버린다(`report.unchanged`) — "같은 문장 두 번 채움 0건".
- 시작 인사·칩: 서버 계산 없음(R-PA-5). `focus-slots.ts`의 `quickChips()`는 지우지 않았다(현재 `services/writing-chat/draft.ts`가 씀). `turn_done`에서 칩을 빼는 것은 api 몫.

### 3.2 AI-13 산출물 대화

```ts
import { buildDeliverableChatContext, planDeliverableTurn, extract, composeDecision, reply, compose } from "@/server/ai/pipelines/AI-13";

type DeliverableChatTurnInput = {
  messages: WritingChatMessageRow[];            // 이 대화, status 무관(done만 씀)
  structuredDraft: unknown;                     // writing_chats.structured_draft (산출물 모양)
  lastExtractedSequence: number;
  deliverable: { id: string; title: string; body: string };   // project_deliverables 행 (DB)
  formSnapshot?: { title?: string; body?: string } | null;    // 턴 요청 form_snapshot (S-44)
  project: { id; name; startMonth; endMonth; isCurrent; role: string|null; description: string|null; skills: string[] }; // 부모 독립 프로젝트 (DB), link_url 넣지 않음
  siblingTitles: string[];                      // 같은 프로젝트의 다른 산출물 제목 (이 산출물 제외, ≤ 20은 여기서 자름)
  desiredJobTitle: string | null;
  requestedSlot: DeliverableSlot | null;        // DELIVERABLE_SLOTS 19개
  requestedAction: "compose_draft" | "ask_from_project" | null;
  style: "shorter" | "more_detail_on_contribution" | null;
  isFinalReply: boolean;                        // begin_assistant_message is_final
  now?: Date;
};

buildDeliverableChatContext(input) → DeliverableChatContext
planDeliverableTurn(ctx) → { kind: "question" } | { kind: "compose"; source: "requested_action" | "text" } | { kind: "reject_draft_limit" }
extract(ctx, deps) → Promise<DeliverableExtractResult>      // { skipped, patch, intent, style, processedThroughSequence, sensitiveAdded, report, rejections, promptVersion, meta, attempts }
composeDecision(ctxAfterFacts, plan, extracted) → { action: "compose"; style } | { action: "reply"; notices: ReplyNotice[] }
reply(ctx, deps, notices?) → AsyncGenerator<ReplyEvent>     // AI-12와 같은 계약: delta* → done | error (마지막 1개)
compose(ctxAfterFacts, deps, { style }) → AsyncGenerator<ComposeEvent, ComposeResult>
deps = { llm, callKey?, signal?, logger?, jobId? }
```

### 3.3 턴 흐름 (runner 순서)

1. `ctx = buildDeliverableChatContext(input)`, `plan = planDeliverableTurn(ctx)`.
2. `plan.kind === "reject_draft_limit"` → **사용자 메시지 저장 전에** 409 `writing_chat_draft_limit_reached`(칩 `requested_action` 요청만 해당).
3. **질문 턴** (`question`): AI-12와 같다 — 유료 `extract` ∥ `reply`, 무료 reply → extract 순차(C-12). `extract().patch`를 `apply_structured_draft_patch`(app_ai_writer)로 적용(ops가 비면 생략) → `mark_writing_chat_extracted(processedThroughSequence)`.
4. **초안 턴** (`compose`):
   1. `extract(ctx)` → 패치 적용(사실이 UUID를 받음) → `ctx2 = buildDeliverableChatContext({ ...input, structuredDraft: rpc.structured_draft, lastExtractedSequence: processedThroughSequence })`.
   2. `decision = composeDecision(ctx2, plan, extracted)`.
      - `reply` → `reply(ctx2, deps, decision.notices)`로 질문 턴처럼 마무리(`compose_insufficient` = "조금만 더 여쭤볼게요", `draft_limit` = 새 대화 안내, 자유 문장인데 `intent`가 null이면 notice 없음).
      - `compose` → `compose(ctx2, deps, { style: decision.style })`. 이벤트를 SSE로 흘리고, 반환값 `result.patch`를 `apply_structured_draft_patch`로 적용. `result.assistantMessage`를 assistant 메시지로 저장(응답 호출 없음).
5. 정리 실패는 응답·초안을 막지 않는다(AI-12와 같음). 단 초안 턴에서 정리가 실패하면 `composeDecision(ctx, plan, null)`로 판단한다(`requested_action`이면 이전 사실만으로 초안, `text`면 질문 턴).
6. 초안 호출 오류: `compose`가 `ProviderError`/`AiError`를 **throw**한다. 이전 초안 유지, `draft_count` 안 셈(패치 없음). `schema_invalid`는 이미 재시도한 것이라 `retryable: false`. 재생성 중 실패는 내부에서 첫 초안으로 끝낸다.
7. RPC가 `rejected`에 `replace_draft`를 돌려주면(블록 검증 불일치 — 파이프라인이 더 엄격해서 나오면 안 됨) 내부 오류로 로그하고 이전 초안 유지.

### 3.4 진행 단계 (`ai_jobs.progress.stage`)

- 질문 턴: `extract` / `reply` (AI-12와 같음)
- 초안 턴: `extract` → `compose`(초안 스트림 중) → `validate`(스트림 종료 뒤 V-10 전체 검증 + RPC). 결정이 `reply`면 `extract` → `reply`.

## 4. SSE 이벤트 (AI-13, AI 명세 순서 + 페이로드 제안)

| 이벤트 | 언제 | 페이로드(제안) | 출처 |
|--------|------|----------------|------|
| `turn_started` | 시작 | AI-12와 같음 | api |
| `reply_delta` / `reply_done` | 질문 턴 응답 / 초안 턴 고정 문구 | AI-12와 같음. 초안 턴 `reply_done.text = result.assistantMessage` | `reply` / `compose` |
| `facts_patch` | 정리 패치 RPC 뒤 | `{ structured_draft }` = RPC가 돌려준 산출물 모양 전체(사실 id는 UUID) | api (RPC 결과) |
| `draft_flags` | `facts_patch` 뒤 | `deliverableDraftFlags(stored, extract.sensitiveAdded)` = `{ needs_review: factId[], actor_ambiguous: boolean, number_vague: boolean, sensitive: number }` | `storage/deliverable-patch.ts` |
| `draft_started` | 초안 호출 시작마다 | `{ attempt: 1|2, reason: "initial"|"schema_retry"|"regenerate" }` — **attempt 2면 화면은 앞서 받은 블록을 버린다** | `compose` 이벤트 그대로 |
| `draft_block` | 블록이 V-10a~g를 통과할 때마다 | `{ attempt, block: StoredBlock }`(`block_id` = `b{모델 순번+1}`, 출처는 UUID, `review` ok/needs_review). 제목 블록은 뒤 내용 블록이 통과할 때 함께 나간다 | `compose` 이벤트 그대로 |
| `draft_done` | 초안 RPC 성공 뒤 | `{ body: rpc.structured_draft.deliverable.body, dropped_block_count, needs_review_block_ids: result.validation.needsReviewBlockIds, missing_slots, replace_allowed, rev, draft_count }` — **`body`가 정본**(스트림 블록은 잠정. 빈 제목 정리·8,000자 자르기로 달라질 수 있음) | api (RPC 결과 + `result.validation`) |
| `turn_done` | 끝 | `{ draft_count }`(산출물 대화). 칩 없음 | api |
| `error` | 실패 | AI-12와 같음(C-11 코드) | api |

- 블록 0개(`result.outcome === "empty"`) → `count_draft` 패치, **`draft_done` 없이** `reply_done`(`DRAFT_EMPTY_MESSAGE`) → `turn_done.draft_count`(R-PA-15).
- AI-12 이벤트 이름은 그대로(`draft_patch`·`draft_flags`·`turn_done{ready_to_return}`).

## 5. 출력 스키마 ↔ 저장 매핑

### 5.1 AI-13 정리 출력 (`Ai13ExtractOutputSchema`, 명세 키 그대로)
`{schema_version: 1, writing_kind|null, intent: "compose_draft"|null, style|null, facts[≤20]{slot, text, actor, source_message_ids, source_quotes}, clarifications[≤10]{kind, slot|null, note|null}, sensitive_flags[≤20]{category, message_id}}`

→ `factsPatch()`: `add_sensitive_flags`(있으면 맨 앞) → `add_facts`(`{slot, text, actor, source_message_ids: UUID[], source_quotes: 원문 구간, review: ok|needs_review}`, `id`는 보내지 않음 — RPC가 매김) → `set_writing_kind`(바뀔 때만) → `set_clarifications`(바뀔 때만, note는 별칭·민감정보 제거 후 ≤ 200).

### 5.2 AI-13 초안 출력 (`Ai13ComposeOutputSchema`)
`{schema_version: 1, writing_kind, replace_mode, blocks[≤120]{type, level|null, text|null, items[]{text, 출처3}|null, rows[]{cells[], 출처3}|null, basis|null, 출처3}, missing_slots[]}` — 출처3 = `source_fact_ids`(F-n), `source_body_quotes`, `source_project_fields`(`PRJ.description|role|skills|name|period`).

→ `draftPatch()`: (`writing_kind`가 비어 있던 대화면 `set_writing_kind`) → `replace_draft { body: { blocks, base_body_hash, replace_allowed, missing_slots, dropped_block_count } }` 또는 `count_draft`. 블록 저장 모양 = DB 노트의 블록 모양(출처는 UUID·원문 구간, 목록 항목·표 행도 각자 출처). `value`는 보내지 않는다(DB가 조립, R5-DB-5).

- 출처는 `evidence_links`에 넣지 않는다(DM-15). `storage/evidence-links.ts`는 바꾸지 않았다 — 저장된 산출물 본문은 다른 기능에서 기존 `project_deliverable`(`DLV-n`) 근거로 쓰인다(C-1.1 그대로).
- `base_body_hash` = `"sha256:" + sha256hex(폼 본문 문자열 그대로, UTF-8, 정규화 없음)`. 화면은 [반영] 때 같은 방식(SubtleCrypto SHA-256)으로 폼 본문을 해시해 비교한다.
- `replace_allowed` = 폼 본문(원문) 코드포인트 수 ≤ 6,000.

## 6. 검증 규칙 적용 범위

### 6.1 AI-12 V-9 (v4.6 변경분)
| 규칙 | v4.6 |
|------|------|
| V-9h | "값이 있음" = 스냅숏 기준. 스냅숏에서 비운 필드는 DB에 값이 있어도 `set`(DB가 `append`로 낮춤 — 화면 채우기는 op와 무관). 기간은 스냅숏 기간·`is_current` 기준 |
| V-9i | 분류 "빈 값만" = 스냅숏 기준 |
| C-14 길이 | 폼 값 + (폼에 안 채워진) 미반영 제안 + 새 문장 |
| 보호 | 폼에 채워진 미반영 `user_edit`·`accepted`는 보호 해제(`new_object`로 교체) |
| 중복 | 폼 값·미반영 제안·직전 패치에 이미 있는 문장의 append는 무시 |

### 6.2 AI-13 사실 (V-9 재사용)
V-9a(사용자 발화, 위임 발화 거부) → V-9b(인용 부분 문자열) → V-9g(민감 → 거부 + 개수, 이번 턴 발화만 셈) → V-9c(수치) → V-9d(영문·스킬·회사명) → V-9e(40% → `needs_review`). V-9f 대신 **actor**: 팀 주어 + 1인칭 표지 없음 → `actor = team`(버리지 않음), 본인 기여 슬롯이면 `actor_ambiguous` 되묻기. 턴당 10개·대화당 60개·`text` ≤ 300. 같은 사실(정규화 동일) 무시.

### 6.3 AI-13 초안 V-10 (내용 단위마다)
| # | 구현 | 실패 |
|---|------|------|
| V-10a | 출처 ≥ 1, `F-n`은 사용 가능 사실(ok·accepted)만, 본문 인용은 **이번 호출에 넣은 본문**(잘렸으면 앞·뒤 부분)의 부분 문자열, 프로젝트 필드는 값이 있는 것만 | 제거 |
| V-10b | 단위의 숫자가 그 단위 출처 텍스트(사실 text·인용, 본문 인용, 인용한 프로젝트 필드 — `PRJ.period`는 서버 계산 개월 수 포함)에 있음 | 제거 |
| V-10c | 영문 토큰·스킬 사전어·회사명·URL이 출처 텍스트에 있음(`PRJ.skills`는 인용했을 때 출처) | 제거 |
| V-10d | "제가/직접/본인이…" 문장은 self 사실 또는 1인칭 본문 인용·부모 description 필요. + team 사실만 출처인데 팀 주어 없는 문장 `[가정]` | `needs_review` |
| V-10e | 내용어 50% 초과가 출처 밖 | `needs_review` |
| V-10f | 민감정보 | 제거 + 민감 개수 |
| V-10g | HTML·이미지 제거, 제목 한 줄·깊이 1~3·≤ 200자, 단위 ≤ 1,500자(문장 끝에서 자름), 표 셀 ≤ 12개·≤ 500자, 조립 ≤ 8,000자(뒤 블록부터 제거), 내용 없는 제목 제거 | 정리·자름·제거 |
| V-10h | 사실 출처가 있으면 `new`, 아니면 `current_body`. 제목은 아래 섹션에 `new`가 있으면 `new` | 다시 매김 |

- 제목 블록은 출처가 없으므로 이 호출의 전체 출처(사실·본문·프로젝트)에 대해 V-10b·c·f만 본다.
- 목록은 항목마다, 표는 행마다(머리글 행은 모든 행 출처의 합) 검사. 항목 하나라도 `needs_review`면 블록이 `needs_review`.
- 제거 비율 > 30% → 위반 검사 번호만(`V-10c 1건, …`) `<retry>`로 알려 1회 재생성. 다시 넘으면 남은 블록 사용. 고정 문구 "확인되지 않은 문장 N개는 뺐어요"의 N = 제거된 내용 단위 수.

## 7. 화면·api가 쓸 공유 순수 함수

- `deliverableChips({ formBody, writingKind, facts, hasDraft, draftCount, closed })` (`context-pack/deliverable-slots.ts`): AI-13 칩 표 3행 + 상한 6회 대체 + closed 숨김. 칩 `{ label, requested_slot, requested_action, style, new_chat? }`.
- `appendToBody(body, blocks)` / `deliverableMarkdown(blocks)` (`schemas/deliverable-markdown.ts`): 덧붙이기·교체 미리보기. DB 조립과 같다.
- 두 파일 모두 zod·node API·`server-only`를 쓰지 않는다. 화면이 `src/server/**`를 import하지 않는 규칙이면 api/UI가 `src/lib/`로 옮기거나 재수출해도 된다(내용 변경 없이).
- AI-12 칩(`quickChips`)도 순수 함수 그대로.

## 8. 테스트·픽스처

- `v9.snapshot.test.ts`(16): 스냅숏 병합 규칙, V-9h 스냅숏 기준(채움 → append만, 비움 → set), 기간·`is_current`, V-9i 스냅숏 분류, 프롬프트 값 출처, `pendingInForm`, `new_object`(첫 패치만, 보호 해제, 중복 무시), `rev` 기본값
- `v10.test.ts`(40): 사실 V-9a/b/c/d/위임/g(대기 발화만 셈)/e, actor team, 중복, 개수·길이, 되묻기 해소·note 정리, 종류 변경 / 블록 V-10a 4종, needs_review 사실 수락 전후, UUID·원문 구간 저장, V-10b(다른 사실의 숫자 불가, 기간 개월 수 허용), V-10c(기술명·`PRJ.skills`·URL), V-10d(팀 사실 + "제가", 주어 없는 팀 문장, 1인칭 description), V-10e, V-10f, V-10g(HTML·이미지·제목 깊이·1,500자·제목 수치/이름·목록 항목별·표 머리글), 전체(빈 제목 정리, 30%, 빈 초안, 8,000자, basis·missing_slots)
- `deliverable-chat.test.ts`(33): 스냅숏, 6,000자 경계·앞 1,000+뒤 2,000, 해시, 사용 가능 사실 별칭, 프로젝트 블록(링크 없음, 개월 수), 형제 제목 20개, 데이터 블록 이스케이프, 초안 요청 감지(위임 제외), 슬롯 순서, 종류 짐작 표(DB와 같은 결과), 칩 행 전부, 마크다운 조립 전 블록 종류, 덧붙이기, 패치 빌더 순서, flags
- `AI-13.test.ts`(20): 정본 스키마 변환, 턴 계획, 정리(경량·call key·버전·UUID 출처·대상 없음 → 호출 없음·본문/프로젝트 안 봄), 응답(기본 등급·블록·notice), 초안 결정 5가지, 초안 스트림(이벤트 순서·제목 보류·패치·고정 문구), 초안 프롬프트에 대화 원문 없음, 6,000자 초과 → `new_only`, 30% 재생성(검사 번호만), 재생성 뒤에도 초과, 빈 초안 → `count_draft`, V-6 1회 재시도·2회 실패 → `schema_invalid`(재시도 불가), 공급자 오류 throw, 재생성 중 오류 → 첫 초안 유지, 평가 세트 골격 모양
- 실제 공급자 호출 없음(가짜 LLM). 픽스처는 가상 데이터.

## 9. 스펙 차이·가정 (상수)

| # | 가정 | 상수 / 위치 |
|---|------|-------------|
| A1 | 초안 6회, 사실 2개 미만 + 본문 빔 = 초안 불가 | `DELIVERABLE_DRAFT_LIMIT = 6`, `DRAFT_MIN_FACTS = 2` (`deliverable-slots.ts`) |
| A2 | 교체 허용 본문 ≤ 6,000자, 넘으면 앞 1,000 + 끝 2,000 | `REPLACE_ALLOWED_MAX_BODY_CHARS`, `BODY_HEAD_CHARS`, `BODY_TAIL_CHARS` |
| A3 | 초안 ≤ 8,000자, 블록 ≤ 120, 단위 ≤ 1,500, 제목 깊이 ≤ 3 | `DRAFT_VALUE_MAX`, `AI13_MAX_BLOCKS`, `BLOCK_TEXT_MAX`, `HEADING_MAX_LEVEL` (C-14) |
| A4 | 턴당 사실 ≤ 10, 대화당 ≤ 60, 사실 ≤ 300자 | `MAX_FACTS_PER_TURN`, `MAX_FACTS_PER_CHAT`, `FACT_TEXT_MAX` (C-14) |
| A5 | V-10e 50%, 재생성 30% | `V10E_MAX_UNCOVERED_RATIO`, `V10_REGENERATE_DROP_RATIO` |
| A6 | 30%·"N개"의 단위 = 내용 단위 | spec-gaps **R5-AI-1** |
| A7 | 칩 "프로젝트 내용을 바탕으로" = `requested_action: "ask_from_project"` | spec-gaps **R5-AI-2** — api zod 계약에 추가 필요 |
| A8 | 자유 문장 초안 요청 어휘 감지 → 초안 턴 후보, `intent`로 확정 | `COMPOSE_REQUEST_PATTERN`, spec-gaps **R5-AI-3** |
| A9 | 턴당 초안 호출 ≤ 2(V-6 재시도와 V-10 재생성 합산) | `AI13_COMPOSE_MAX_CALLS`, spec-gaps **R5-AI-4** |
| A10 | V-10d 확장(팀 사실만 + 팀 주어 없음 → 검토) | spec-gaps **R5-AI-5** |
| A11 | 슬롯 키 19개·종류별 배치(회고 슬롯 1 = `scope`, 기타 슬롯 5 = `outcome`) | `KIND_SLOTS` — DB `c_slots`와 같은 19개 |
| A12 | 제목 키워드 짐작 = DB 함수와 같은 목록·순서 | `WRITING_KIND_TITLE_PATTERNS` (R5-DB-13) |
| A13 | 표 = 첫 행 머리글, 목록 항목·표 행마다 출처 | 명세 `[가정]` 그대로 |
| A14 | `number_vague` 해소 = 그 슬롯에 숫자 있는 ok 사실 | `validateFactsOutput` |
| A15 | 다른 산출물·프로젝트를 가져와 달라는 요청 감지 → 안내 | `OTHER_SOURCES_PATTERN` (`prompts/AI-13`) |
| A16 | 초안 턴 고정 문구 | `DRAFT_READY_MESSAGE`, `draftDroppedSuffix`, `DRAFT_EMPTY_MESSAGE` (최종 문구 UX) |
| A17 | AI-12: 폼에 채워진 판정 = 미반영 제안 `value`가 폼 값에 정규화 부분 문자열로 포함 | `pendingInForm` (DM 2.5 DA-10) |
| A18 | `form_snapshot`을 공급자로 보내는 고지 범위 | D-DM-12 `[결정 필요]`, 권고 (a)로 구현 |

## 10. api-engineer에게 (호출부 할 일)

| 위치(api 소유) | 할 일 |
|----------------|------|
| 턴 요청 zod | `form_snapshot`(S-10 / S-44 모양, 길이 검사, 로그·DB 저장 금지), AI-13 `requested_slot` = `DELIVERABLE_SLOTS`, `requested_action` ∈ `DELIVERABLE_REQUESTED_ACTIONS`, `style` ∈ `COMPOSE_STYLES` |
| `services/writing-chat/pipelines.ts` | AI-12 `toTurnInput`에 `formSnapshot` 전달. 대화의 `project_deliverable_id`가 있으면 AI-13 경로: 산출물 행 + 부모 독립 프로젝트(`name, start_month, end_month, is_current, role, description` + `project_skills → skills.name`) + 형제 산출물 제목을 읽어 `DeliverableChatTurnInput` 구성 |
| 턴 서비스·SSE | 3.3 흐름, 4장 이벤트, 진행 단계 `compose`·`validate`, call_key `….compose`, `reject_draft_limit` 409 |
| 칩 | `turn_done`에서 칩 제거(R-PA-5). AI-13 칩은 `deliverableChips` |
| 제거된 RPC | `apply_writing_chat_proposal` 호출 제거(타입 오류 1건) |
