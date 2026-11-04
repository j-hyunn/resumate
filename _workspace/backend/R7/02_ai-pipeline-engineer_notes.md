# R7 AI 파이프라인 구현 노트 (AI-12·AI-13 reply 질문 품질)

- 날짜: 2026-11-04
- 기준: `_workspace/backend/R7/01_plan.md` (RQ-1 본인 말 인용 허용, RQ-2 항목당 꼬리 질문 최대 2번, RQ-3 범위)
- 범위: `src/server/ai/`만 수정. DB·API·UI·docs 변경 없음. 커밋하지 않음.

## 바꾼 파일

| 파일 | 변경 |
|------|------|
| `src/server/ai/context-pack/writing-chat.ts` | `renderStatusForReply`(상태만) 삭제 → `renderProjectForReply` 추가. `<project_state>` 블록: values 출처, period, star(폼 값, learnings는 `<reflection>`), proposals(아직 폼에 없는 제안 값: period 제안은 기간이 비었을 때만, STAR는 `[덧붙임/새로 채움, 검토 필요]`), `classification_recommended`(키 이름만), clarifications. 분류 값·남은 글자 수·발화 별칭·UUID는 넣지 않음 |
| `src/server/ai/prompts/AI-12/index.ts` | reply system 질문 규칙 재작성, extract에 "구체 요소 보존" 1줄, SHARED_RULES에서 `<status>` 제거, `replyUserBlocks`가 `renderProjectForReply` 사용, 버전 v5 |
| `src/server/ai/prompts/AI-13/index.ts` | reply system 질문 규칙 재작성(슬롯별 구체 요소), extract에 "구체 요소 보존" 1줄, 버전 v2. compose는 손대지 않음(v1) |
| `src/server/ai/context-pack/writing-chat.test.ts` | "never values" 테스트 → 값 포함·분류 값 없음·남은 글자 수 없음·별칭 없음 검사, 폼에 채워진 제안 중복 없음·기간 제안 검사 추가 |
| `src/server/ai/pipelines/AI-12.test.ts` | 버전 정규식 v5, `<status>` → `<project_state>`, 값 포함 검사, 새 규칙·기존 안내 규칙 포함 검사 |
| `src/server/ai/pipelines/AI-12.gate.test.ts` | 버전 정규식 v5 |
| `src/server/ai/pipelines/AI-13.test.ts` | 버전 정규식 extract v2·reply v2·compose v1, 새 규칙·19개 슬롯 전부 구체 요소 목록에 있는지·기존 안내 규칙 포함 검사 |

## prompt_version

| 호출 | 이전 | 이후 |
|------|------|------|
| AI-12 extract | `ai-12.extract.v4+common.v2` | `ai-12.extract.v5+common.v2` |
| AI-12 reply | `ai-12.reply.v4+common.v2` | `ai-12.reply.v5+common.v2` |
| AI-13 extract | `ai-13.extract.v1+common.v2` | `ai-13.extract.v2+common.v2` |
| AI-13 reply | `ai-13.reply.v1+common.v2` | `ai-13.reply.v2+common.v2` |
| AI-13 compose | `ai-13.compose.v1+common.v2` | 그대로 |

## reply 프롬프트 핵심

### AI-12 reply (블록 순서: common system → feature system | `<chat>` → `<message>`… (마지막에 캐시) → [`<gate_requirements>`] → `<project_state>` → `<turn>`)
- `<project_state>` 읽는 법: star = 폼 값, proposals = 아직 폼에 없는 제안. 둘 다 사용자의 말·글. 항목 선택과 중복 질문 방지에만 쓰고 답변에 나열하지 않음.
- 질문 방식: 질문 1개(꼭 필요할 때 2개). 첫 문장은 직전 발화 핵심을 사용자 표현대로 받기(새 사실·평가·칭찬 없음). 본인 말·`<project_state>` 내용은 따옴표로 그대로 짧게 인용 가능. 사용자가 말하지 않은 수치·기술·회사·결과·원인은 질문에 넣지 않음. 구체 요소 하나 겨냥. 답하기 어려우면 일반 범주 2~4개 예시(추측 금지).
- 항목별 구체 요소: situation(배경·규모·문제·제약), task(역할·목표·성공 기준), action(방법·순서·이유·대안·어려움·협업), result(전후·수치·영향 범위·확인 방법), learnings(교훈·다르게 할 점·적용 사례).
- 꼬리 질문: 직전 발화가 다룬 항목에 요소가 비면 focus_slots 전에 1개. 우선순위 action > result > situation > task > learnings. 같은 항목 최대 2번, "모르겠어요/그 정도예요"면 즉시 넘어감. 이미 있는 요소는 다시 묻지 않음. actor_ambiguous·number_vague 되묻기가 먼저.
- 유지: focus_slots·upcoming 진행, 건너뛰기, period·action·수치 질문, requested_reinforce(비어 있는 요소 하나를 겨냥하도록 보강), optional_offer, 3~5문장·제목/표 없음·나열 금지, 분류 질문 금지, 안내 규칙(delegation, sensitive, can_apply + classification_recommended, full_fields, ready_to_return, last_message), gate_requirements 규칙 전부.

### AI-13 reply (블록 순서 변경 없음)
- 같은 질문 방식(본인 말 인용, `<project>`·`<current_body>`는 사용자가 쓴 글임을 밝히고 인용, 미발화 사실 금지, 구체 요소 하나, 범주 예시).
- 슬롯별 구체 요소: 계획서 표 그대로(19개 슬롯 모두 포함).
- 꼬리 질문: 같은 규칙, 여러 슬롯이면 contribution 먼저, 슬롯당 최대 2번, `<facts>`·`<current_body>`·대화에 있는 요소는 다시 묻지 않음, 되묻기 우선.
- 유지: kind 질문, contribution 최우선·팀 주어 되묻기, 현재 본문 슬롯은 보강만(비어 있는 요소 겨냥), requested_reinforce/from_project, 수치, 건너뛰기, 부모 프로젝트와 다른 사실 확인, 3~5문장, 안내 규칙 전부(delegation, sensitive, compose_insufficient, draft_limit, other_sources, compose_suggested, 초안 버튼 안내, replace_allowed, last_message).

### Extract (AI-12·AI-13)
- 역할 문단 바로 아래에 "요약과 문장 다듬기는 되지만, 사용자가 말한 구체 요소(수치, 방법, 순서, 이유, 규모, 대안, 도구 이름)는 빠뜨리지 않습니다." 1줄. 나머지 규칙 그대로.

## 테스트 결과

- `pnpm vitest run src/server/ai`: 46 files, 969 tests 통과
- `pnpm vitest run src/server/services/writing-chat`: 5 files, 64 tests 통과 (수정 없음, 회귀 확인)
- `pnpm typecheck`: 통과
- `pnpm lint src/server/ai`: 경고·오류 없음

## input_hash 재사용 여부

- 대화 턴(`writing_chat_turn`, AI-12·AI-13 공통)은 input_hash 재사용을 쓰지 않는다. `src/server/services/writing-chat/turn.ts`에서 진행 중 작업 조회(`inFlightQuery`)와 ai_jobs 생성 모두 `inputHash: null`(생성 시 `promptVersion: null`도 함께). 따라서 버전 변경으로 무효화되는 캐시된 결과는 없고, 머지 즉시 다음 턴부터 새 프롬프트가 쓰인다. prompt_version은 호출 요청(`promptVersion`)과 사용량·로그에만 남는다.

## 스펙 차이·가정

- `[가정]` 꼬리 질문 판단과 "항목당 최대 2번" 횟수는 서버 상태 없이 reply 모델이 `<project_state>`와 대화 기록으로 판단한다(계획서 그대로). `focus_slots` 계산은 바꾸지 않음. 효과가 부족하면 다음 단계로 extract에 `depth_gaps` 출력을 더한다.
- `[가정]` `<project_state>`에 `classification_recommended`(키 이름만)를 남겼다. 기존 안내 규칙 "분류도 추천해 두었어요"를 유지하기 위해서이며, 분류 값은 넣지 않는다.
- `[가정]` 기간 제안(proposals의 period)은 폼 기간이 비어 있을 때만 보여 준다(extract도 기간이 비었을 때만 패치하므로 같은 기준).
- reply의 `<project_state>`는 사용자 말·글만 담는다(출처 별칭·UUID 없음). V-9·저장 매핑은 변경 없음.

## QA 1라운드 수정 (2026-11-04, `03_backend-qa_report.md`)

버전은 그대로 둠(`ai-12.*.v5`, `ai-13.*.v2`, 아직 출시 전).

| 이슈 | 수정 |
|------|------|
| QA-01 [Major] | AI-12·AI-13 reply 꼬리 질문 절에 순서 규칙: (1) 사용자가 요청한 항목/슬롯(reason requested·requested_reinforce)과 되묻기(actor_ambiguous, number_vague) → (2) 꼬리 질문 → (3) focus_slots 순서. 꼬리 질문 때문에 (1)을 미루지 않는다. 진행 규칙 첫 줄도 "요청한 항목·되묻기·꼬리 질문이 없으면 focus_slots 순서"로 맞춤. 테스트에 규칙 문장 검사 추가 |
| QA-04 (리더 결정) | 인용 허용 범위: AI-12는 사용자 발화(`<message role="user">`)와 `<project_state>` star(폼 값)만, AI-13은 사용자 발화·`<current_body>`·`<project>`(사용자가 쓴 글임을 밝힘)만. AI-12 proposals는 정리 담당 요약(특히 "검토 필요"는 미확인)이라 인용 금지, 다뤄진 내용 파악·중복 질문 방지용. 같은 원칙으로 AI-13 `<facts>`도 인용 금지(정리 요약) `[가정]` — 리더 결정의 허용 목록에 facts가 없어 일관되게 적용 |
| QA-02 | AI-13 "이미 있는 요소는 다시 묻지 않음"에 `<project>` 추가 |
| QA-03 | AI-12 공통 규칙: `<project_state>`의 period·star·classification은 폼 현재 값, 응답용 `<project_state>`의 proposals는 아직 폼에 넣지 않은 제안이며 폼 값이 아님 |
| QA-07 | AI-12 reply "<project_state> 읽는 법"에 한 줄: `<reflection>` 안 learnings는 사용자 본인의 회고라 다른 폼 값처럼 인용 가능. 사실·수치 근거 금지는 공통 규칙(common.ts)에 이미 있음 |
| QA-08 | AI-13.test.ts 슬롯 목록 하드코딩 → `DELIVERABLE_SLOTS` |

재검사: `pnpm vitest run src/server/ai` 46 files / 969 tests 통과, `pnpm typecheck` 통과, `eslint src/server/ai` 경고·오류 없음.
