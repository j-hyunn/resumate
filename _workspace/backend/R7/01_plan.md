# R7 AI 작성 대화 질문 품질 개선 (AI-12·AI-13 reply)

- 날짜: 2026-11-04
- 계기: 사용자 피드백 "답변 내용이 형편없다. 내용을 구체화할 수 있는 프롬프팅이 필요하다." (프로젝트 상세 AI-12, 산출물 상세 AI-13)
- 사용자 확정 (2026-11-04):
  - **RQ-1 본인 말 인용 허용**: AI 질문에 사용자 본인이 말하거나 폼·본문에 쓴 내용을 그대로 인용해 되물을 수 있다. 사용자가 말하지 않은 사실(수치·기술명·회사명·결과·원인)을 질문에 넣는 것은 계속 금지.
  - **RQ-2 항목당 꼬리 질문 1~2회**: 항목에 한 문장이라도 들어가면 넘어가던 방식을 바꿔, 구체 요소가 비어 있으면 그 항목에서 꼬리 질문을 최대 2번 더 한다.
  - **RQ-3 범위 = 기획 문서 + 코드**.

## 진단 (현재 코드)

1. AI-12 reply는 `renderStatusForReply`로 STAR 필드의 **상태만**("값 있음/비어 있음") 받는다. 무엇이 이미 쓰였는지 모르니 깊이 있는 후속 질문을 할 수 없다.
2. 규칙 "질문에 구체적 사실을 넣지 않는다"가 사용자 본인의 말까지 막아, 질문이 "결과는 어땠나요?"처럼 일반적이다.
3. `focus_slots`는 필드가 비었는지만 본다. 한 문장이라도 있으면 다음 항목으로 넘어간다 → 얕은 STAR.
4. 항목별로 무엇을 캐야 하는지(규모, 선택 이유, 대안, 전후 비교 …) 질문 기법이 프롬프트에 없다.
5. 정리(extract)는 "요약 가능"만 있어 사용자가 말한 구체 요소(방법·이유·규모)가 요약 중 빠질 수 있다.
6. AI-13 reply는 `<project>`, `<current_body>`, `<facts>`를 이미 받지만 질문 규칙은 AI-12와 같은 문제(2~4)를 가진다.

## 변경 범위

DB·API·UI 변경 없음. 마이그레이션 없음, 환경 변수 없음. `src/server/ai/` 와 기획 문서만.

| 파일 | 변경 |
|------|------|
| `src/server/ai/prompts/AI-12/index.ts` | reply system 재작성(아래 "새 질문 규칙"), extract에 "구체 요소 보존" 규칙 1줄, reply user 블록에 `<project_state>` 값 |
| `src/server/ai/context-pack/writing-chat.ts` | `renderStatusForReply` → 값 포함 렌더(`renderProjectForReply`): 폼 현재 값(STAR 텍스트, learnings는 `<reflection>`), 아직 폼에 없는 제안 값, 기간, 분류는 넣지 않음(질문 금지 항목), clarifications. 남은 글자 수는 넣지 않음 |
| `src/server/ai/prompts/AI-13/index.ts` | reply system 질문 규칙 재작성(같은 원칙, 슬롯별 구체 요소), extract에 "구체 요소 보존" 1줄 |
| 버전 | `ai-12.reply.v5`, `ai-12.extract.v5`, `ai-13.reply.v2`, `ai-13.extract.v2` (compose는 그대로 v1) |
| 테스트 | `writing-chat.test.ts`("never values" 테스트 → 값 포함으로), `AI-12.test.ts`·`AI-13.test.ts` 버전 정규식, 새 규칙 스냅숏/포함 검사 |
| `docs/planning/03-ai-features.md` | AI-12·AI-13 응답 규칙, 입력 컨텍스트 표(응답에 프로젝트 현재 값), 변경 이력 v4.8 |
| `docs/planning/decisions.md`, `docs/planning/README.md` | RQ-1~3 기록, 개정 줄 |

`focus_slots` 계산(서버)은 바꾸지 않는다. 꼬리 질문은 reply 모델이 `<project_state>`와 대화 기록을 보고 판단한다 `[가정]` — 서버 상태 추가 없이 시작하고, 횟수 상한(항목당 2번)은 대화 기록으로 센다. 효과가 부족하면 다음 단계로 extract 출력에 `depth_gaps`를 더해 서버가 세게 한다.

## 새 질문 규칙 (AI-12 reply, 프롬프트 원문 방향)

질문 방식
- 한 번에 질문 1개, 꼭 필요할 때만 2개.
- 첫 문장은 직전 사용자 발화의 핵심을 사용자 표현대로 짧게 받아 준다. 새 사실·평가·칭찬을 붙이지 않는다. 그다음 질문.
- 사용자가 말했거나 `<project_state>`에 있는 내용은 따옴표로, 고치지 않고 짧게 인용해 되물을 수 있다. 예: "'캐시 무효화 규칙을 설계했다'고 하셨는데, 무효화 시점은 어떤 기준으로 정하셨나요?"
- 사용자가 말하지 않은 사실(수치, 기술 이름, 회사 이름, 결과, 원인)은 질문에 넣지 않는다. "응답 시간을 30% 줄이셨나요?" 금지.
- 막연하게 묻지 않고 구체 요소 하나를 겨냥한다. "결과는 어땠나요?" 대신 "작업 전과 후에 무엇이 달라졌나요? 숫자로 기억나는 게 있으면 함께 알려 주세요."
- 답하기 어려워 보이면 일반적인 범주 2~4개를 예로 들 수 있다(예: "속도, 비용, 안정성, 사용자 불편 중 어느 쪽 문제였나요? 다른 것이어도 좋아요"). 범주는 예시일 뿐이며 이 프로젝트에 대한 추측(기술명·수치)을 넣지 않는다.

항목별 구체 요소 (꼬리 질문의 기준)
- situation: 배경(어떤 서비스·조직), 규모(사용자·데이터·팀), 문제(무엇이 왜 문제였나), 제약(일정·자원·기술)
- task: 본인 역할과 책임 범위, 달성해야 했던 목표, 성공 기준
- action: 구체적 방법과 순서, 그 방법을 고른 이유, 고려한 대안·트레이드오프, 어려움과 극복, 협업 방식
- result: 전후 비교, 수치, 영향 범위(사용자·팀·사업), 결과를 확인한 방법
- learnings: 구체적인 교훈, 다음에 다르게 할 점, 이후 적용한 사례

꼬리 질문
- 직전 사용자 발화가 다룬 항목에 위 구체 요소가 비어 있으면, `focus_slots`로 넘어가기 전에 그 항목의 꼬리 질문을 1개 한다. 우선순위 action > result > situation > task > learnings.
- 같은 항목의 꼬리 질문은 대화 기록에서 최대 2번. 사용자가 "모르겠어요", "그 정도예요"처럼 답하면 바로 넘어간다.
- `<project_state>`나 대화에 이미 있는 요소는 다시 묻지 않는다.
- `actor_ambiguous`·`number_vague` 되묻기는 지금처럼 우선한다.

유지: 3~5문장, 마크다운 제목·표 없음, 정리 내용 나열 금지, 분류 질문 금지, 안내 규칙(delegation, sensitive, can_apply, full_fields, ready_to_return, last_message), gate_requirements 규칙.

## AI-13 reply

같은 원칙(본인 글·말 인용 허용, 구체 요소 겨냥, 범주 예시, 꼬리 질문 최대 2번)을 슬롯별 구체 요소로 적는다. `contribution`은 모든 종류에서 우선(방법·이유·대안·본인 몫). 슬롯별 요소 예:
- background/requirements/scope/audience/what: 배경, 대상·규모, 제약
- goal/purpose/message: 무엇을 왜, 성공 기준
- contribution: 본인이 맡은 부분, 방법, 선택 이유, 대안
- structure/outline/content: 구성 요소와 순서, 핵심 내용
- decisions: 결정 사항, 이유, 버린 대안
- limits/went_wrong: 한계·문제, 원인으로 본 것(사용자 판단), 대응
- outcome/went_well/reaction: 전후 비교, 수치, 반응, 확인 방법
- learnings: 교훈, 다음에 다르게 할 점

## Extract 보강 (AI-12·AI-13)

"요약과 문장 다듬기는 되지만, 사용자가 말한 구체 요소(수치, 방법, 순서, 이유, 규모, 대안, 도구 이름)는 빠뜨리지 않는다." 한 줄. 나머지 규칙 그대로.

## 담당

- ai-pipeline-engineer: 코드·테스트 (위 표의 `src/server/ai/` 행)
- ai-feature-designer: 기획 문서 (`docs/planning/03-ai-features.md`, `decisions.md`, `README.md`)
- backend-qa: 프롬프트 ↔ 명세 대조, `run-checks.sh`
- 병렬 가능. 서로 이 문서를 기준으로 맞춘다.

## 출시 영향

마이그레이션·환경 변수 없음. prompt_version이 바뀌어 input_hash가 달라진다(대화 턴이 input_hash 재사용을 쓰는지 ai-pipeline-engineer가 확인해 notes에 적는다). 머지하면 바로 운영에 반영된다.
