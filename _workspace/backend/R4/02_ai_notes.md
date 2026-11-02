# R4 AI 파이프라인 구현 노트 (커리어 재설계 CR-1~CR-24, AI 명세 v4.5)

- 작성: ai-pipeline-engineer, 2026-11-02
- 기준: AI 명세 v4.5(C-1, C-1.1, C-1.2, C-3, C-9, C-14, AI-12, AI-02~06·11), DM v4.4(2.3, 2.5, 2.8, 3.3), decisions 3.9(CR-20)
- `02_db_notes.md`는 작업 끝까지 없었다. 끝 무렵 db-engineer의 R4 마이그레이션과 재생성된 `database.types.ts`가 나와서 **패치 계약은 `20261109101000_r4_structured_draft_patch_v3.sql`에 맞췄고**(분류 op = `set` + `section: "classification"`), `loadCareerRows`는 생성 타입으로 통과한다. 나머지 가정은 8장.
- 커밋 안 함.

## 1. 바뀐 파일 (`src/server/ai/**`만)

| 구분 | 파일 | 내용 |
|------|------|------|
| 신규 | `classification.ts` | 분류 3종 키(CR-17)·표시명·한 줄 정의, `classificationLine()` |
| 신규 | `context-pack/deliverable-text.ts` (+ test) | 산출물 마크다운 → 평문 정규화, 오프셋 지도, 문단 경계 자르기, 원문 구간 계산(C-1.1) |
| 근거 규칙 | `evidence-rules.ts` | `project_detail`·`achievement` 삭제, `project_deliverable`(`DLV-n`, `title`/`body`) 추가, `project` 필드 확장 + `PROJECT_SCOPE_FIELDS`(소속/독립), 회고 = `project.learnings`, 사실 근거(`isActionResultEvidence`) = 소속 `action`/`result`·독립 `description`·산출물 `body` |
| 팩 | `context-pack/career-rows.ts` | v4.4 컬럼(`PROJECT_COLUMNS`에 STAR·분류·`is_current`·`role`·`description`·`content_updated_at`, `link_url` 없음), `DELIVERABLE_COLUMNS`, `CareerRows.deliverables`. 행 타입은 손으로 적음(생성 타입 대기) |
| 팩 | `context-pack/career-pack.ts` | 팩 재작성(3장) |
| 팩 | `context-pack/aliases.ts` | `AliasEntry.scope`(`affiliated`/`standalone`), `locate()`(인용별 `source_locator`) |
| 팩 | `context-pack/summary-pack.ts` | AI-11 요약형 v4.5(분류 참고·역할 100·행동 200·결과 150, 독립 담당 업무·내용 200·사용 기술, 산출물 제목 + 앞 200) |
| 팩 | `context-pack/selection.ts`, `context-pack/interview.ts` | 상세 내용·성과 제거, 산출물 포함, AI-06 산출물 범위 옵션 |
| 검증 | `validation/evidence.ts` | V-2 소속/독립 필드 검사, V-7 범위에서 `detailRefs` 삭제 |
| 검증 | `validation/drafts.ts` | `isSituationTaskOnly`(소속 situation/task + 독립 role), `buildSourceScope`(상세 내용 인자 삭제) |
| 검증 | `validation/insight.ts`, `validation/alias-text.ts` | met 규칙 주석, `DLV-n` → 산출물 제목, 남은 `DET-n`·`ACH-n` 삭제 |
| 검증 | `validation/v9.ts` | AI-12 V-9 v3 전체(5장) |
| 저장 | `storage/evidence-links.ts` | `source_locator` = 인용별 `locate()` 우선, 스냅샷 = 별칭의 `snapshotAt`(프로젝트 `content_updated_at`) |
| 저장/이벤트 | `storage/drafts.ts`, `streaming/events.ts` | `project_detail_ids` 삭제(`CoverLetterPayloadSource`, `SelectedSourceView`) |
| 스키마 | `schemas/structured-draft.ts` | `structured_draft` v3 + 패치 계약 v3(6장) |
| 스키마 | `schemas/AI-12.ts` | 정리 출력 `schema_version: 3` |
| 스키마 | `schemas/AI-04.ts` | `detail_refs` 삭제(schema_version은 명세대로 2 유지) |
| 파이프라인 | `pipelines/AI-02.ts` | `data_sufficiency` thin = 프로젝트 ≤ 2 또는 결과·내용·산출물에 숫자 없음(C-14) |
| 파이프라인 | `pipelines/AI-03.ts` | 역할 줄 = 소속 `task` / 독립 `role`, 없으면 버림(`role_line_dropped_no_source`), 머리글 "독립 프로젝트"(CR-7) |
| 파이프라인 | `pipelines/AI-04.ts` | `detail_refs`·`project_detail_ids` 삭제 |
| 파이프라인 | `pipelines/AI-05.ts` | "같은 상세 내용 1개" 규칙 삭제, 산출물 근거는 상위 독립 프로젝트로 셈 |
| 파이프라인 | `pipelines/AI-06.ts` | `deliverableProjectIds` 입력, `sessionDeliverableProjectIds()` |
| 파이프라인 | `pipelines/AI-12.ts` | 플래그 타입 v3, 거부 집계 키(`star.`/`classification.`) |
| 컨텍스트 | `context-pack/writing-chat.ts`, `context-pack/focus-slots.ts` | AI-12 v4.5(5장) |
| 프롬프트 | `prompts/common.ts`, `drafts-common.ts`, `AI-02~06`, `AI-11`, `AI-12` | 2장 |
| 픽스처·테스트 | `__fixtures__/career-rows.ts`(v4.4 + `project()` 헬퍼 + 산출물), `__fixtures__/AI-12/conversations.ts`, `AI-02/insight.ts`, `S7/drafts.ts`, `S8/interview.ts`, 테스트 30여 개 | 9장 |

## 2. 모델 등급·prompt_version

공통 블록이 바뀌어(`DET`/`ACH` 별칭 목록 삭제, `DLV-n`, `<classification>`·`<deliverable>` 규칙) **모든 기능의 버전이 `common.v2`로 바뀐다**. 등급은 변경 없음.

| 기능 | 등급 | prompt_version (이전 → 지금) |
|------|------|------------------------------|
| 공통 | — | `common.v1` → `common.v2` |
| AI-01 | 경량 | `ai-01.extract.v1+common.v2` (본문 그대로, 접미사만) |
| AI-02 | 기본 | `ai-02.match.v4+ai-02.synthesize.v4+common.v2` (met 기준·예시) |
| AI-03 | 기본 | `ai-03.generate.v3+common.v2` (재료 = STAR / 내용·산출물, 역할 줄 재료) |
| AI-04 | 기본 | `ai-04.generate.v3+common.v2`, `ai-04.adjust.v3+common.v2` (`detail_refs` 삭제) |
| AI-05 | 기본 | `ai-05.generate.v3+common.v2` (사실 전제, 상세 내용 중복 규칙 삭제) |
| AI-06 | 기본 | `ai-06.evaluate.v3+common.v2` |
| AI-07 | 기본 | `ai-07.summarize.v1+common.v2` (본문 그대로) |
| AI-11 | 경량 | `ai-11.rank.v2+common.v2` (요약형 설명) |
| AI-12 정리 | 경량, 낮은 사고 | `ai-12.extract.v3+common.v2` |
| AI-12 응답 | 기본, 낮은 사고 | `ai-12.reply.v3+common.v2` |

`input_hash`에 버전이 들어가므로 R4 배포 뒤 기존 결과는 재사용되지 않는다(의도).

## 3. Career Context Pack v4.5 (C-1)

- 구조: `<profile>` → `<experience ref="EXP-n">` → 소속 `<project ref="PRJ-n">` → `<education>` → 소속 프로젝트 → `<standalone_projects>` → 독립 `<project>` → `<deliverable ref="DLV-n">` → `<manual_skills>`.
- 소속 프로젝트: `name`, `period`, `computed_duration`, `<classification>`(표시명, 참고), `situation`/`task`/`action`/`result`, `<reflection>learnings</reflection>`. `role`·스킬 없음(CR-10). 별칭 필드 = `name, period, situation, task, action, result, learnings`, `scope: "affiliated"`.
- 독립 프로젝트: `name`, `period`, `role`, `skills`(`SKL-n`), `description`, 산출물. `link_url` 없음. 별칭 필드 = `name, period, role, description`, `scope: "standalone"`.
- 산출물(C-1.1): 정규화 평문(제목·목록·강조·백틱 제거, 링크는 글만, 이미지·HTML 제거, 표 셀은 " / ", 코드 블록 앞 30줄). 산출물당 6,000자(문단 경계), 팩 전체 15,000자. 최근 독립 프로젝트부터·`sort_order` 순으로 채우고 예산이 다 차면 제목만. 잘리면 `truncated="true"`. 별칭 필드 `body` = 팩에 들어간 정규화 텍스트(V-3·V-5 기준), `locate()`가 인용 → 원문 마크다운 `{start, end}`.
- 포함 규칙: `complete`만, `draft` 부모의 자식 제외. 산출물은 부모 독립 프로젝트가 `complete`일 때만 `[가정]`(C-1 그대로). 소속 프로젝트에 걸린 `project_skills`는 무시(DB 트리거가 막지만 방어).
- 기간(CR-22): `is_current` → `YYYY-MM ~ 현재` + 이번 달까지 개월 수(V-5 허용값), 종료월만 비면 `YYYY-MM ~ (종료 미입력)` + 개월 수 없음. 표기는 기존 경력과 같은 `YYYY-MM ~` 형식을 유지(spec-gaps R4-AI-2).
- 해시: STAR 5필드, 분류 3종, `is_current`, `role`, `description`, 산출물 `title`·`body`(원문), 독립 프로젝트 사용 기술. `link_url`·계산 개월 수 제외.
- V-5 원천: 소속 S/T/A/R, 경력 `summary`, 교육 `description`, 독립 `role`·`description`, 팩에 들어간 산출물 텍스트, 서버 계산 기간. `learnings`·분류는 제외.
- `CareerPack.counts` = `{experiences, educations, projects, deliverables, skills}`, 새 필드 `hasResultNumbers`(AI-02 thin).
- 스냅샷: `project` = `content_updated_at`, `project_deliverable` = 행 `updated_at`.
- `buildCareerPack(rows, { deliverableProjectIds })`: AI-06처럼 산출물 범위를 좁힐 때. 프로젝트 자체 필드는 그대로, 해시도 그대로.

## 4. 근거 검증 (C-3 v4.5)

| 규칙 | 적용 |
|------|------|
| V-1 | `DET-n`·`ACH-n`·`project_detail`·`achievement`는 모르는 별칭/형식 → 제거 |
| V-2 | `project`는 별칭의 `scope`로 필드 집합 확인: 소속 = `name, period, situation, task, action, result, learnings`, 독립 = `name, period, role, description`. 분류 3종·`link_url`·`summary`·`team_size`는 허용값 아님. `project_deliverable` = `title`, `body` |
| V-3 | `quote` 필수: `project`의 `name`·`period` 외 전부, 산출물 `body`. 산출물은 팩에 들어간 정규화 텍스트 기준(잘린 부분 인용 실패). 70% 부분 일치 상수 그대로 |
| V-8 | 회고 = `source_type = project AND field = learnings` |
| V-7 | 선택한 프로젝트 + 그 산출물·사용 기술(독립) + 소속 경력/교육 자체. 형제 프로젝트·남의 산출물은 범위 밖 |
| V-4 | 사실 근거에 `project_deliverable` 포함, 분류는 애초에 근거 불가 |
| V-5 | 3장 원천. `learnings`에만 있는 숫자는 불인정(그대로) |
| met / 사실 전제 | 소속 `action`·`result`, 독립 `description`, 산출물 `body`. situation·task·role·스킬·분류만이면 partial / 질문 버림 |
| AI-03 본인 주어 가드 | 근거가 `project` situation/task/role뿐이면 `evidence_check_needed` |

## 5. AI-12 v4.5 (api-engineer와 맞출 인터페이스)

### 5.1 턴 입력 `WritingChatTurnInput` (`context-pack/writing-chat.ts`)

```ts
{
  messages: WritingChatMessageRow[];          // 그대로
  structuredDraft: unknown;                   // writing_chats.structured_draft
  lastExtractedSequence: number;
  project: {                                  // writing_chats.project_id 행을 턴마다 새로 읽음 (app_ai_writer)
    id: string; name: string;
    startMonth: string | null; endMonth: string | null; isCurrent: boolean;
    parent: { type: "experience" | "education"; name: string | null; status: "complete" | "draft" };
    projectType: string | null; experienceType: string | null; competencies: string[];
    situation: string | null; task: string | null; action: string | null; result: string | null; learnings: string | null;
  };
  desiredJobTitle: string | null;
  gate: { feature: GateFeature; missing: ReadinessMissing[] } | null;   // return_target + get_data_readiness (턴마다)
  gateRequirements?: GateRequirement[];      // R-31, 응답 호출에만
  requestedSlot: { slot: SlotId } | null;
  isFinalReply: boolean;
}
```

- 삭제: `mode`, `affiliation`, `candidates`, `augmentTarget`, `declinedAffiliationIds`.
- `SLOT_IDS = ["period", "situation", "task", "action", "result", "learnings"]`(`basic_info`·`next_episode` 삭제). `RequestedSlot = { slot }`(상세 내용 키 삭제). `src/lib/contracts/enums.ts`의 슬롯 목록과 `RequestedSlot` 계약을 이 값으로 바꿔야 한다.
- `loadGateRequirements`의 근거 텍스트: `project_details` 대신 `projects`의 `name, situation, task, action, result, role, description`(complete)과 산출물 제목을 넘기면 된다(`selectGateRequirements`는 그대로).

### 5.2 파이프라인 함수 (시그니처 변경 없음)

- `buildWritingChatContext(input) → WritingChatContext`: `focus`, `chips`(이번 턴 시작 상태 기준), `remainingChars`, `processThroughSequence` 등.
- `extract(ctx, deps) → ExtractResult`: `{ skipped, patch: DraftPatch, flags: DraftFlags, processedThroughSequence, report, rejections, promptVersion, meta, attempts }`.
  - `DraftFlags = { needsReview: FieldRef[]; actorAmbiguous: FieldRef[]; sensitiveAdded: number; lengthFull: StarField[] }`, `FieldRef = { section: "project" | "star" | "classification"; field }`(텍스트 없음).
- `reply(ctx, deps)`: 그대로(텍스트 스트림, `delta`/`done`/`error`).
- `quickChips({ project: { star, startMonth }, draft }) → QuickChip[3]`(`focus-slots.ts`): `{ label, requested_slot }`. `turn_done` 때는 **RPC가 돌려준 새 `structured_draft`로 다시 계산**하고, 대화 조회(시작 인사 직후 포함) 때도 같은 함수로 계산한다. 칩을 누르면 `label`을 사용자 메시지로 보내고 `requestedSlot = { slot: requested_slot }`.

### 5.3 SSE 이벤트 (AI-12 카드 순서 그대로, 페이로드 제안)

| 이벤트 | 페이로드(제안) |
|--------|----------------|
| `turn_started` | 기존과 같음 |
| `reply_delta` / `reply_done` | 기존과 같음 |
| `draft_patch` | RPC가 돌려준 `structured_draft`(v3) — 필드 출처는 메시지 UUID |
| `draft_flags` | `{ needs_review: FieldRef[], actor_ambiguous: FieldRef[], sensitive: number, length_full: StarField[] }` |
| `turn_done` | `{ chips: QuickChip[], ready_to_return: boolean }` — `ready_to_return` = `ctx.focus.readyToReturn`(게이트이고 준비도 `missing` 비었음) |
| `error` | 기존과 같음 |

- 진행 단계: `extract` → `reply`(변경 없음). 오류 코드 변경 없음.
- 반영(`apply_writing_chat_proposal`)은 AI를 부르지 않으므로 파이프라인과 무관.

### 5.4 V-9 v3 (`validation/v9.ts`)

| 검사 | 내용 | 실패 |
|------|------|------|
| V-9a~d, V-9g | 그대로(사용자 발화만, 위임 요청 거부, 인용 부분 문자열, 숫자·월, 영문·스킬·회사명, 민감정보) | 패치 거부 |
| V-9e | 내용어 40% 이상 인용 밖 | `needs_review` |
| V-9f | 팀 주어 `action` → `actor_ambiguous`; 제안·프로젝트 둘 다 `situation`이 비었으면 그 값을 `situation`에 `needs_review` | — |
| V-9h | 프로젝트에 값이 있는 STAR 필드는 `append`만(`set` 거부). 빈 필드의 `append`는 `set`. 기간은 프로젝트 칸이 비었을 때만, `is_current`면 `end_month` 거부 | 거부 |
| 보호 | 미반영 `user_edit`·`accepted` 필드 | 거부 |
| 길이(C-14) | 현재 값 + 미반영 제안 + 이번 문장(구분자 1자)이 2,000자 초과 | 거부 + `flags.lengthFull` |
| 개수(C-14) | 기간 + STAR 패치 10개 초과분 | 거부(`limit`) |
| V-9i | ① 키 목록 ② 역량 중복 제거·앞 3개 ③ 프로젝트 값이 비었을 때만(역량은 0개일 때만), 미반영 `user_edit` 추천 보호 ④ 출처는 사용자 발화만(아니면 지움, 비어도 됨) ⑤ 상황·행동이 프로젝트/제안/이번 패치 어디에도 없으면 버림. `reason` 100자로 자르고 별칭·민감정보 제거 | 그 추천만 버림(로그 `V-9i`) |
| 되묻기 | `actor_ambiguous`(ok `action` 오면 해소), `number_vague`(숫자 있는 ok `result` 오면 해소 `[가정]`), `period_unclear`(시작월 오면 해소) | — |

거부 로그는 `{ check, target }`(`target` = `project.start_month`, `star.action`, `classification.competencies`)만, 원문 없음(C-7).

### 5.5 슬롯·안내 (`focus-slots.ts`)

- 순서: (일반) 기간(비었을 때) → S → T → A → R → 배운 점. 필수(상황·행동)가 차면 나머지는 `optional_offer`. (게이트) 상황 → 행동 → 기간 → 역할·결과·배운 점(`optional_offer`).
- `requested_slot`이 맨 앞(채워졌으면 `requested_reinforce`), 그다음 미해결 되묻기.
- 남은 글자 수 20자 미만(`STAR_FULL_THRESHOLD` `[가정]`)인 필드는 묻지 않고(`fullFields`) 응답이 "글자 수가 가득 찼어요"를 안내.
- `canApply` = 필수가 제안으로만 채워짐 → "왼쪽에 반영할 수 있어요" 한 번. `readyToReturn` = 게이트 + 준비도 `missing` 없음(반영 뒤 다음 턴에 서버가 준비도를 다시 읽으므로).
- 분류는 질문 슬롯이 아니다. `is_current`는 묻지도 제안하지도 않는다.

## 6. DB 계약 요청 (db-engineer)

### 6.1 `apply_structured_draft_patch` v3 패치 계약 (AI 호출 = `app_ai_writer`) — db 마이그레이션에 맞춤

```jsonc
{ "ops": [
  { "op": "add_sensitive_flags", "count": 1 },                                      // 있으면 항상 맨 앞
  { "op": "set", "target": { "section": "project", "field": "start_month" },
    "value": "2023-03", "review": "ok", "source_message_ids": ["uuid"], "source_quotes": ["23년 3월부터"] },
  { "op": "set" | "append", "target": { "section": "star", "field": "action" },
    "value": "이번 턴 문장만", "review": "ok" | "needs_review", "source_message_ids": ["uuid"], "source_quotes": ["…"] },
  { "op": "set", "target": { "section": "classification", "field": "competencies" },
    "value": ["analysis", "execution"], "source_message_ids": ["uuid"], "reason": "한 줄 이유" | null },
  { "op": "set_clarifications", "items": [ { "kind": "actor_ambiguous", "field": "action" } ] }
] }
```

- `append`의 `value`는 **이번 턴 문장만** 보낸다. 같은 필드의 미반영 제안이 있으면 RPC가 줄바꿈 1개로 이어 붙이고(파이프라인 길이 검사도 1자), `set`은 교체. `applied_at`이 있는 필드면 새 필드 객체.
- 파이프라인의 길이 검사는 RPC보다 엄격하다: RPC는 제안 값만 2,000자 이하인지 보지만, 파이프라인은 프로젝트 현재 값 + 제안 + 새 문장을 본다(C-14, 반영 때 `field_too_long`을 미리 막음).
- 한 턴에 같은 필드 op가 둘 이상 올 수 있다(순서대로 적용).
- 반환은 S4와 같이 `{ structured_draft, rejected: [{ index, op, reason }] }`을 기대한다.
- 상한: op ≤ 100, 출처 ID ≤ 20, 인용 ≤ 20(각 ≤ 1,000자), 되묻기 ≤ 50, 민감 개수 ≤ 100(S4 값 유지 가정).

### 6.2 그 밖

- `app_ai_writer` select 권한: `projects`의 새 컬럼(`is_current, project_type, experience_type, competencies, situation, task, action, result, learnings, role, description, content_updated_at`)과 `project_deliverables`의 `id, project_id, title, body, sort_order, created_at, updated_at`(`career-rows.ts` `PROJECT_COLUMNS`/`DELIVERABLE_COLUMNS`). `link_url`은 읽지 않는다.
- `evidence_links`: `source_type = project_deliverable`, `source_field` `title`/`body`, `body`면 `source_locator = {start, end}`(원문 마크다운 UTF-16 오프셋, 파이프라인이 채움). `project`의 `source_snapshot_at`은 파이프라인이 `content_updated_at`을 넣는다.
- 결과 저장 RPC(인사이트·경력기술서·자소서·면접)가 `project_deliverable` 근거를 받아야 한다. 경력기술서·`job_competency`·직무 면접 질문의 `project.learnings` 거부(V-8 DB 방어)는 DM 2.8대로.
- 자소서 `complete_cover_letter_section`의 `sources[]`에서 `project_detail_ids`가 빠진다(`CoverLetterPayloadSource`).

## 7. api-engineer에게 (호출부 변경 목록)

| 위치(api 소유) | 바꿀 것 |
|----------------|---------|
| `services/writing-chat/pipelines.ts` | `loadPackInputs`를 5.1 입력으로: 프로젝트 1행(+ 부모 경력/교육 이름·상태)과 프로필 희망 직무만 읽기. `toTurnInput`에서 `mode` 삭제, `requestedSlot = { slot }`. `loadGateRequirements`의 `project_details` → `projects` STAR·내용 |
| `services/writing-chat/*`, SSE 핸들러 | 5.3 이벤트, `turn_done` 칩은 `quickChips(RPC가 준 draft)` |
| `lib/contracts/enums.ts` 등 | AI-12 슬롯 목록 = `SLOT_IDS`, 분류 키 = `classification.ts`의 세 목록(DB CHECK와 같게) |
| 자소서 서비스(`services/drafts/cover-letter.ts`, `read.ts`) | `UserSourceInput`·`SelectedSourceView`·`CoverLetterPayloadSource`에서 `project_detail_ids` 삭제 |
| 면접 채점(`jobs/interview.ts`) | `buildAnswerEvaluationContext({ …, deliverableProjectIds: sessionDeliverableProjectIds(careerRows, 세션 전체 질문의 evidence_links) })` — 세션 안 모든 답변에 같은 값 |
| `CareerRows`를 직접 만드는 테스트·fake | `projectDetails`/`achievements` → `deliverables` (`emptyCareerRows()` 사용 권장) |
| AI-02 화면 힌트 | `THIN_HINTS.noQuantitative` 문구가 "결과/성과 서술에 수치가 없어 …"로 바뀜 |
| AI-03 | 독립 프로젝트 섹션 머리글 `STANDALONE_HEADING` = "독립 프로젝트" |

## 8. 열린 가정 (DB 노트 나오면 맞출 것)

| # | 가정 | 근거 / 상수 |
|---|------|-------------|
| A1 | `projects`·`project_deliverables` 컬럼 이름·타입이 DM v4.4 그대로(`competencies text[]`, `is_current boolean not null`, `content_updated_at timestamptz not null`) | `career-rows.ts` 행 타입은 손으로 적었다. 생성 타입이 나오면 `Pick<Row<…>>`로 바꿀 수 있다 |
| A2 | 패치 계약 v3(6.1) | r4 마이그레이션 주석·본문과 맞춤. db 노트가 다르게 정하면 `toDraftPatch`만 고친다 |
| A3 | append 합칠 때 구분자 1자 | `APPEND_SEPARATOR_LENGTH = 1` |
| A4 | 산출물 정규화·예산 | `CODE_BLOCK_MAX_LINES = 30`, `DELIVERABLE_PACK_MAX_CHARS = 6000`, `DELIVERABLE_PACK_TOTAL_CHARS = 15000` (C-1.1 `[가정]`) |
| A5 | 산출물은 부모 독립 프로젝트 `complete`일 때만 팩에 | C-1 `[가정]` |
| A6 | `reason` 100자 | `CLASSIFICATION_REASON_MAX = 100` (DM은 200, spec-gaps R4-AI-1) |
| A7 | 턴당 패치 10개 | `MAX_PATCHES_PER_TURN = 10` (C-14) |
| A8 | 가득 찬 필드 기준 | `STAR_FULL_THRESHOLD = 20`자 |
| A9 | V-9e 40%, V-3 부분 일치 70% | 그대로 |
| A10 | `number_vague` 해소 = 숫자가 든 ok `result` | `[가정]` |
| A11 | 빠른 칩 문구 3×3 | AI-12 표 그대로 `[가정]`, 최종 문구 UX |
| A12 | 독립 프로젝트 `role`은 `task`급(맥락), 본인 기여 근거 아님 | C-1.1 `[가정]` |
| A13 | 분류 한 줄 정의 문구 | `classification.ts` — 바꾸면 `ai-12.extract` 버전 올림 |
| A14 | 응답 호출엔 STAR 값 대신 상태만 | spec-gaps R4-AI-3 |
| A15 | 팩 기간 표기 `YYYY-MM ~ 현재` 유지 | spec-gaps R4-AI-2 |

시작 인사 4종은 DB(`start_writing_chat`) 담당이라 파이프라인에 없다. 문구는 AI-12 카드 초안 그대로 쓰면 된다.

## 9. 테스트

- `pnpm vitest run src/server/ai`: **42 파일, 849개 모두 통과**.
- 새·고친 범위:
  - `deliverable-text.test.ts`: 정규화 규칙 표(제목·목록·강조·링크·이미지·HTML·표·코드 블록 30줄·CRLF), 오프셋 지도, 자르기
  - `career-pack.test.ts`: 포함 규칙, 별칭 순서, scope, `content_updated_at` 스냅샷, `<classification>`은 근거 아님, 스킬은 독립 프로젝트만, 예산(문단 자르기·제목만), AI-06 범위, `is_current` 기간, 해시 포함/제외 필드, `hasResultNumbers`
  - V-2 소속/독립 필드, 산출물 V-3·`source_locator`, V-7 산출물 범위, `DLV-n` 표시 이름, AI-02 met(산출물)·thin, AI-05 산출물 → 상위 프로젝트 중복 규칙, AI-03 역할 줄, AI-04 상세 내용 제거
  - AI-12: V-9 146개(V-9a~i, 길이·개수·보호, 패치 op 순서, 별칭 미노출), 슬롯·칩, 컨텍스트, 스키마 v3(정본 JSON 스키마 포함), 파이프라인 대화 픽스처 8종(협조·몰아서·팀 주어·수치 모름·민감·위임·채워진 프로젝트 보강·분류 추천), 게이트(요건은 응답 호출에만)
- `pnpm eslint src/server/ai`: 0건.
- 실제 공급자 호출 없음(가짜 LLM). 픽스처는 가상 데이터.

## 10. 타입 검사 (`pnpm typecheck`)

- **AI 영역(`src/server/ai/**`)**: 오류 0건(재생성된 `database.types.ts` 기준).
- **다른 영역**: 타입 재생성 뒤 api-engineer·UI 소유 파일에 오류가 많다(`lib/data/*`, `services/career/*`, `services/writing-chat/*`, `services/drafts/cover-letter.ts`·`read.ts`, `components/career/*`, `lib/mock/*` 등). AI 변경으로 생긴 것은 7장 표의 항목(`services/writing-chat/pipelines.ts`, AI 픽스처 `output()`을 쓰는 통합 테스트 2개, `CareerRows`를 직접 만드는 테스트·fake, `project_detail`/`achievement` 근거를 쓰는 통합 테스트)이고, 나머지는 DB 스키마 변경 자체로 생긴 것이다.
- 서비스 코드 중 `services/drafts/read.ts`·`cover-letter.ts`는 아직 `project_detail_ids` 컬럼을 읽는다(생성 타입이 바뀌면 타입 오류가 될 것).

## 11. 그 밖

- `_workspace/backend/spec-gaps.md`에 R4-AI-1~3을 덧붙였다.
- `parseStructuredDraft`는 `project` 아래 모르는 키(예: `is_current`)가 있으면 예외를 던진다(서버만 쓰는 컬럼이라 버그로 본다). 최상위의 v1 잔재(`details`, `skills`)는 조용히 버린다. 마이그레이션이 v1 행을 `'{}'`로 비운다는 DM 11장 가정과 맞다.
