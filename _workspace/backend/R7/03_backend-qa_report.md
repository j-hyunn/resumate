# R7 백엔드 QA 리포트 (라운드 1)

- 날짜: 2026-11-04
- 대상: 작업 트리 미커밋 변경 — `src/server/ai/prompts/AI-12/index.ts`, `src/server/ai/prompts/AI-13/index.ts`, `src/server/ai/context-pack/writing-chat.ts`(+ 테스트 4개), `docs/planning/03-ai-features.md`(v4.8), `decisions.md`, `README.md`
- 기준: `01_plan.md`, `02_ai-pipeline-engineer_notes.md`, AI 명세 v4.8 AI-12(700~808행)·AI-13(921~1017행)

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `run-checks.sh` |
| lint | 통과 | 경고·오류 없음 |
| vitest | 통과 | 130 files, 2,022 tests |
| pgTAP | 통과 | 55 files, 2,676 tests (로컬 스택이 떠 있어 스크립트가 실행함 — 이 슬라이스는 마이그레이션이 없어 판정에는 무관) |
| 로컬 스모크 | SKIP | 요청 경로·잡 경로·deps 팩토리 변경 없음(프롬프트 텍스트와 렌더 함수만). 실제 공급자 키 없이 응답 품질은 확인할 수 없음 — 평가 세트(명세 "질문 구체성")로 확인할 항목 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1~Q4, Q8, Q10(RLS), Q11, Q13 | DB·RPC·enum·UI·출시 | 해당 없음 | 마이그레이션·RPC·환경 변수·UI 변경 없음 |
| Q5·Q6 | 계약·SSE | 해당 없음 | 턴 요청·SSE 이벤트 변경 없음 |
| Q7 | AI 출력 ↔ 저장 | 통과 | 출력 스키마·V-9·저장 매핑 변경 없음. compose(`ai-13.compose.v1`) 텍스트 무변경 확인 |
| Q9 | 잡 종료·사용량 | 해당 없음 | 대화 턴은 `inputHash: null`(노트 확인) → 버전 변경으로 무효화되는 재사용 결과 없음 |
| Q10 | 로그 프라이버시 | 통과 | 변경 파일에 `console.`·로거 호출 추가 없음 |
| Q12 | 실제 의존성 | 해당 없음 | 팩토리 변경 없음 |
| 명세 ↔ 프롬프트 | AI-12·AI-13 v4.8 | 이슈 | QA-01, QA-02, QA-05 |
| 응답 컨텍스트 | `renderProjectForReply` | 이슈(경미) | QA-03, QA-04, QA-06, QA-07 |
| 프롬프트 내부 모순 | 새 규칙 vs 유지 규칙 | 이슈(경미) | QA-03 |
| 테스트 | 규칙·버전 | 이슈(경미) | QA-08 |

### 명세 ↔ 프롬프트 대조 요약 (일치 항목)
- 인용 규칙(본인 말·`<project_state>` 따옴표 원문 인용, 미발화 수치·기술·회사·결과·원인 금지, 예문 동일): AI-12 `index.ts:116-117` ↔ 명세 704행 일치. AI-13 `index.ts:118-120`(본문·프로젝트는 "사용자가 쓴 글임을 밝히고") ↔ 명세 922행 일치.
- 질문 1개 기본·꼭 필요할 때 2개: 양쪽 일치(명세 701·921행).
- 첫 문장 받아 주기(새 사실·평가·칭찬 없음), 구체 요소 하나 겨냥, 범주 2~4개 예시(추측 금지): 일치.
- AI-12 항목별 구체 요소 5행: 명세 표(709~717행)와 문구 그대로 일치.
- AI-13 슬롯별 구체 요소: 19개 슬롯(`deliverable-slots.ts:50-70` `DELIVERABLE_SLOTS`) 전부 8개 묶음에 포함, 명세 표(926~935행)와 일치.
- 꼬리 질문: 1개, 우선순위 action > result > situation > task > learnings(AI-12) / contribution 먼저(AI-13), 항목당 최대 2번, "모르겠어요"면 즉시 넘어감, 되묻기 우선: 일치(단, `requested_slot` 우선은 누락 — QA-01).
- extract "구체 요소 보존" 한 줄: AI-12 `index.ts:67`, AI-13 `index.ts:62` ↔ 명세 806·1015행 문구 일치.
- 버전: `ai-12.extract.v5`·`ai-12.reply.v5`·`ai-13.extract.v2`·`ai-13.reply.v2`·`ai-13.compose.v1`(+`common.v2`) ↔ 명세 808·1017행·decisions RQ-3 일치.
- 유지 규칙: AI-12 안내 규칙(delegation·sensitive·can_apply·full_fields·ready_to_return·last_message)·gate_requirements 4줄·분류 질문 금지·3~5문장·나열 금지, AI-13 안내 규칙 전부 그대로.

### 응답 컨텍스트 대조 요약 (일치 항목)
- `<project_state>`(`writing-chat.ts:336-372`): 값 출처, 기간(`renderPeriod`), STAR 5필드 값(learnings `<reflection>`), 미반영 제안(기간 제안은 폼 기간이 비었을 때만, STAR는 `pendingInForm` 제외), clarifications ↔ 명세 입력 표(755행) 일치.
- 제외: 분류 값(테스트로 확인), 남은 글자 수, 발화 별칭·UUID — 일치(분류 키 이름만 예외, QA-06).
- C-4 이스케이프: STAR 값·제안 값·기간 제안 모두 `esc()` 경유(`<`→`＜`), `<reflection>` 닫기 태그 주입 불가. 테스트 `writing-chat.test.ts` "먼저 ＜측정＞하기" 확인.
- 태그: 응답 user 블록 = `<chat>`·`<message>`·[`<gate_requirements>`]·`<project_state>`·`<turn>` — SHARED_RULES의 데이터 태그 목록에 모두 있음. `<status>`는 src 어디에도 렌더·지시로 남지 않음(테스트의 `not.toContain("<status>")`와 버전 주석만).
- 캐시 순서: `<project_state>`가 캐시 지점(마지막 `<message>`) 뒤에 있어 접두 캐시 유지.

## 이슈

### QA-01 [Major] 꼬리 질문이 `requested_slot`(사용자가 고른 항목)보다 먼저 나갈 수 있음
- 담당: ai-pipeline-engineer
- 근거: 명세 AI-12 723행 "`actor_ambiguous`·`number_vague` 되묻기와 **`requested_slot`(사용자가 고른 항목)은 꼬리 질문보다 우선한다**", AI-13 937행 "되묻기·`requested_slot`이 우선" ↔ 프롬프트 `src/server/ai/prompts/AI-12/index.ts:132`, `src/server/ai/prompts/AI-13/index.ts:137`은 되묻기만 우선으로 두고, `AI-12/index.ts:129`·`AI-13/index.ts:134`는 "focus_slots로 넘어가기 전에 그 항목의 꼬리 질문", `:135`·`:140`은 "꼬리 질문이 없으면 focus_slots 순서대로". 서버는 `requested_slot`을 `reason=requested`/`requested_reinforce`로 focus_slots 맨 앞에 두지만(`focus-slots.ts:106-110`), 프롬프트상 직전 발화 항목의 꼬리 질문이 먼저다.
- 영향: 사용자가 칩("결과/성과 보강하기" 등)이나 빈 항목 버튼을 눌렀는데 AI가 직전 항목(예: action) 꼬리 질문을 하는 흐름 — 사용자의 명시적 선택이 무시됨.
- 수정 제안: 두 프롬프트의 되묻기 우선 줄을 "focus_slots에 되묻기(actor_ambiguous, number_vague)나 사용자가 고른 항목(reason=requested, requested_reinforce)이 있으면 꼬리 질문보다 먼저 묻습니다."로 바꾸고 포함 검사 테스트 추가. 프롬프트 텍스트 변경이지만 같은 R7 안이라 버전은 v5/v2 그대로 둬도 됨(미배포).
- 상태: 열림

### QA-02 [Minor] AI-13 "이미 있는 요소는 다시 묻지 않음"에 `<project>` 누락
- 담당: ai-pipeline-engineer
- 근거: 명세 937행 "사실 목록·현재 본문·**부모 프로젝트**에 이미 있는 요소는 다시 묻지 않음" ↔ `src/server/ai/prompts/AI-13/index.ts:136` "<facts>, <current_body>, 대화에 이미 있는 요소는 다시 묻지 않습니다."
- 수정 제안: `<facts>, <current_body>, <project>, 대화에 …`. (from_project 질문은 `<project>` 내용을 인용해 "이 산출물에서도 다루나요?"로 묻는 것이라 충돌하지 않음.)
- 상태: 열림

### QA-03 [Minor] SHARED_RULES의 `<project_state>` 설명이 응답 블록 내용과 어긋남
- 담당: ai-pipeline-engineer
- 근거: `src/server/ai/prompts/AI-12/index.ts:50` "<project_state>는 … 화면 폼의 현재 값입니다 … 이 값이 프로젝트의 현재 값입니다." ↔ 응답용 `<project_state>`는 미반영 제안(proposals)도 담고(`writing-chat.ts:350-365`), `form_snapshot`이 없으면 `values: 저장된 값`(`:339`). 응답 프롬프트 `:110`이 "proposals는 아직 폼에 넣지 않은 제안"이라고 바로잡지만, 공통 줄을 문자 그대로 읽으면 제안을 현재 값으로 볼 수 있음(→ "이미 있는 내용" 판정·인용 범위 혼동).
- 수정 제안: 공통 줄을 "…의 star·period(정리 호출은 classification 포함)가 폼의 현재 값입니다. 응답 호출의 proposals는 아직 폼에 없는 제안입니다." 정도로 좁힘.
- 상태: 열림

### QA-04 [Minor·스펙] 인용 대상에 제안 값(특히 `검토 필요`)이 포함됨
- 담당: ai-feature-designer (spec-gaps R7-QA-1), 결정 후 ai-pipeline-engineer
- 근거: `src/server/ai/prompts/AI-12/index.ts:110` "proposals … 둘 다 사용자가 말하거나 쓴 내용입니다", `:116` "<project_state>에 있는 내용은 따옴표로, 고치지 않고 … 인용" ↔ 제안 값은 정리 모델의 요약 문장이고 `needs_review`(V-9e 실패 — 인용문에 없는 내용어 40% 초과)도 렌더됨(`writing-chat.ts:361`). 명세 704행은 "바꿔 말하거나 요약한 인용은 허용하지 않는다"면서 입력은 "아직 폼에 없는 제안 값"도 인용 대상으로 둠 — 명세 자체의 긴장.
- 영향: "'인덱스를 재설계했다'고 하셨는데"처럼 사용자가 그렇게 말하지 않은 요약을 사용자 말로 되묻을 수 있음. V-9a로 새 값이 생기지는 않지만, `검토 필요` 카드 수락을 유도할 수 있음.
- 수정 제안: 명세 결정 후 — (a) 인용은 사용자 발화·폼 star 값만, proposals는 중복 질문 방지용 / 또는 (b) 최소한 `검토 필요` 제안은 인용 금지 한 줄.
- 상태: 열림(스펙 차이로 넘김)

### QA-05 [Minor] 명세 "프롬프트 전략" 요약 줄과 프롬프트 문구 차이
- 담당: ai-feature-designer
- 근거: 명세 807·1016행 "열린 질문, … 칭찬·평가 최소화" ↔ 프롬프트에서 "열린 질문으로 묻습니다"·"칭찬과 평가는 최소한으로"가 빠지고(구 `AI-12` 질문 규칙 첫 줄·마지막 줄 삭제), 범주 예시(반쯤 닫힌 질문)·"첫 문장에 평가·칭찬 없음"으로 대체됨. 또 명세 702행(AI-12 `requested_slot` "이미 채워진 슬롯이면 '보강할 내용이 있나요?'로 묻는다")·921행(AI-13 "'보강할 내용이 있나요?'로만 묻는다")은 v4.7 문구 그대로인데, 프롬프트(`AI-12/index.ts:141`, `AI-13/index.ts:144`)는 "비어 있는 구체 요소 하나를 겨냥해 보강"으로 바뀜(계획서 방향과 일치, 명세 미갱신).
- 수정 제안: 명세 쪽 문구를 v4.8 방향(구체 요소 겨냥 보강, 칭찬·평가는 붙이지 않음)으로 갱신하거나, 프롬프트에 "칭찬과 평가는 최소한으로" 한 줄을 되살림. 동작 위험은 낮음.
- 상태: 열림

### QA-06 [Minor·스펙] `classification_recommended`(키 이름)가 응답 입력에 남음
- 담당: ai-feature-designer (spec-gaps R7-QA-2)
- 근거: 명세 755행 "응답 호출에는 분류 3종을 넣지 않고" ↔ `writing-chat.ts:367-368`이 추천 있는 분류 키 이름(`experience_type` 등)을 넣음(값은 없음 — 테스트 확인). "분류도 추천해 두었어요" 안내(명세 "분류 추천" 마지막 줄, 프롬프트 `AI-12/index.ts:149`)에 필요하므로 구현이 합리적. 노트에 `[가정]`으로 기록됨.
- 수정 제안: 명세 입력 표에 "추천 여부(키 이름만)" 한 줄 추가.
- 상태: 열림(스펙 차이로 넘김)

### QA-07 [Minor] `<reflection>`이 응답 프롬프트에서 설명되지 않음
- 담당: ai-pipeline-engineer
- 근거: `writing-chat.ts:341`이 응답 `<project_state>`의 learnings를 `<reflection>`으로 감싸지만 `AI-12/index.ts` SHARED_RULES 데이터 태그 목록(`:47`)과 응답 프롬프트 어디에도 `<reflection>`이 없음(정리 호출도 같은 상태 — 기존). 하위 태그라 데이터 취급 자체는 `<project_state>`로 덮이지만 "배운 점(회고)" 의미 전달이 없음.
- 수정 제안: SHARED_RULES 한 줄 — "<project_state> 안의 <reflection>은 learnings(사용자의 회고)입니다." 또는 응답에서는 감싸지 않음.
- 상태: 열림

### QA-08 [Minor] AI-13 슬롯 포함 테스트가 슬롯 목록을 하드코딩
- 담당: ai-pipeline-engineer
- 근거: `src/server/ai/pipelines/AI-13.test.ts:106` 19개 슬롯 문자열 배열 ↔ 원천 `DELIVERABLE_SLOTS`(`deliverable-slots.ts:50`). 슬롯이 추가되면 프롬프트 구체 요소 목록 누락을 테스트가 못 잡음. 또한 QA-01 규칙(`requested` 우선)에 대한 포함 검사 없음.
- 수정 제안: `for (const slot of DELIVERABLE_SLOTS)`로 바꾸고, QA-01 수정 문구 포함 검사 추가.
- 상태: 열림

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- R7-QA-1 = QA-04 (제안 값·검토 필요 제안 인용 범위)
- R7-QA-2 = QA-06 (`classification_recommended` 키 이름)

## 결론
Critical 0, Major 1(QA-01), Minor 7. 검사 전부 통과. QA-01은 사용자가 고른 항목을 꼬리 질문이 가로챌 수 있는 명세 위반이라 머지 전 수정 권장. 나머지는 문구 정리 수준이며 QA-04는 기획 판단이 필요.

---

# R7 백엔드 QA 리포트 (2라운드)

- 날짜: 2026-11-04
- 기준: `02_ai-pipeline-engineer_notes.md` "QA 1라운드 수정", 명세 v4.8 702·704·755·807·921·922·937·1016행, `decisions.md` 3.15 "리더 판단 (R7-QA-1)"
- 리더 결정(QA-04): 응답이 인용할 수 있는 것은 사용자 본인 발화와 폼 값뿐이다(AI-12 star/period, AI-13 `<current_body>`·`<project>`). 미반영 제안과 AI-13 `<facts>`는 인용하지 않는다.

## 검사 실행 결과 (2라운드)
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck / lint / vitest / pgTAP | 모두 통과 | vitest 130 files·2,022 tests, pgTAP 55 files 실행·통과(마이그레이션 없어 판정 무관) `run-checks.sh` 재실행 |
| 로컬 스모크 | SKIP | 1라운드와 같은 사유(요청·잡 경로 변경 없음) |

## 이슈 재확인
| 이슈 | 결과 | 근거 |
|------|------|------|
| QA-01 [Major] | 수정됨(확인 완료) | `AI-12/index.ts:132` / `AI-13/index.ts:138` 순서 규칙이 (1) 요청 항목(reason requested·requested_reinforce)·되묻기 → (2) 꼬리 질문 → (3) focus_slots로 바뀌었고 "꼬리 질문 때문에 미루지 않는다"가 들어감. 진행 규칙 첫 줄(`AI-12:135`, `AI-13:141`)도 같은 순서. reason 이름은 `focus-slots.ts:109`의 값과 같음. 테스트 `AI-12.test.ts:295`, `AI-13.test.ts:112` ↔ 명세 723·937행 |
| QA-02 [Minor] | 수정됨(확인 완료) | `AI-13/index.ts:137`에 `<project>` 들어감 ↔ 명세 937행 |
| QA-03 [Minor] | 수정됨(확인 완료) | `AI-12/index.ts:50` "period·star·classification은 폼 현재 값, 응답용 proposals는 폼 값이 아님" ↔ `writing-chat.ts` 렌더 내용 |
| QA-04 [Minor·스펙] | 수정됨(확인 완료, 1건 남김 → QA-09) | AI-12 `:111`·`:117`(proposals 인용 금지, 테스트 `AI-12.test.ts:298`), AI-13 `:117`·`:119`(`<facts>` 인용 금지) ↔ decisions 359행, 명세 755행 ②"재질문 방지용, 인용 대상 아님"·807·1016행 |
| QA-05 [Minor] | 수정됨(확인 완료) | 명세 702·921행 "비어 있는 구체 요소 겨냥 보강"으로, 807·1016행 열린 질문·칭찬 최소화 → v4.8 문구로 갱신. 프롬프트 `AI-12:141`·`AI-13:144`와 같음 |
| QA-06 [Minor·스펙] | 수정됨(확인 완료) | 명세 755행에 `classification_recommended` 키 이름 예외 추가 ↔ `writing-chat.ts:367-368` |
| QA-07 [Minor] | 수정됨(확인 완료) | `AI-12/index.ts:110` `<reflection>` 안 learnings 설명 |
| QA-08 [Minor] | 수정됨(확인 완료) | `AI-13.test.ts:17,107` `DELIVERABLE_SLOTS` 사용 + QA-01 규칙 포함 검사 |

## 새 모순 점검
- 인용 관련 줄을 전부 다시 읽음(AI-12 `:110,111,117`, AI-13 `:117~119,145`): 허용 목록·금지 목록이 서로 충돌하지 않음. "이미 있는 요소는 다시 묻지 않음"(AI-12 `:131`은 `<project_state>` 전체, AI-13 `:137`은 `<facts>` 포함)은 금지된 제안·사실을 재질문 방지에만 쓰는 규칙과 맞음.
- `from_project`(AI-13 `:145` "위 인용 형식")는 `<project>` 인용 허용과 맞음.
- 유지 규칙(3~5문장, 나열 금지, 분류 질문 금지, 안내 규칙, gate_requirements)은 그대로. compose 텍스트 변경 없음, 버전 v5/v2 그대로(미출시라 노트대로 수용).
- `<status>`는 src에서 테스트의 부정 검사와 버전 주석 외에 없음.

### QA-09 [Minor] AI-12 인용 허용 목록에 기간(period)이 빠짐
- 담당: ai-pipeline-engineer (또는 명세를 맞출 경우 ai-feature-designer)
- 근거: 명세 704행 "폼에 이미 있는 값(`<project_state>`의 저장 전 STAR 값·**기간**)은 … 인용"·리더 결정(star/period) ↔ `AI-12/index.ts:117` "<project_state>의 star(폼 값)만 할 수 있습니다". decisions 359행은 "AI-12 STAR 값"만 적어 문서끼리도 다름.
- 영향: 낮음(기간 인용이 막혀도 동작에 큰 영향 없음). 문구 일치 문제.
- 수정 제안: 프롬프트를 "star·period(폼 값)"으로 넓히거나, 명세 704행·결정을 "STAR 값"으로 통일.
- 상태: 열림

## 결론 (2라운드)
QA-01~08 모두 수정 확인. 새 이슈는 Minor 1건(QA-09)뿐이며 머지를 막지 않음. Critical 0, Major 0.
