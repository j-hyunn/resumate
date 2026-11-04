# R9 — AI 패널·문서형 입력 백엔드 후속 (기획 사이클 ui-panel-doc, UP-6·UP-9·UP-14)

- 근거: `docs/planning/decisions.md` 4.11, DM v4.10 11.5, AI v4.10 C-1.1·AI-12(0.v410·V-9j·V-9i), `_workspace/backend/spec-gaps.md` UIP-1~UIP-7, 결정 입력 `_workspace/00_input/planning-decisions-ui-panel-doc.md`.
- 화면 쪽은 이미 구현됨(미커밋, 같은 워크트리): TipTap 마크다운 편집기(`src/components/common/doc-markdown-editor.tsx`), 분류 [무시] 화면 기억(`src/components/career/ignored-classification.ts`). UI 파일은 이 슬라이스에서 읽기만.
- 배포: **마이그레이션 없음**(스키마·RPC 변경 없음). 코드는 R8 + UI 개정과 같은 머지.

## 범위

| # | 내용 | 담당 | 비고 |
|---|------|------|------|
| ★1 | C-1.1 정규화 `src/server/ai/context-pack/deliverable-text.ts`: 백슬래시 이스케이프 되돌리기(`\x` → `x`, 오프셋 지도는 `x`의 원문 위치), `&lt;` → `<`(그 엔티티만). 편집기 출력(취소선 `~~`, 인용 `>`, 표, 코드 블록 울타리, 링크) 전부 평문화 확인. fixture: `2\*3`·`\[메모\]`·`a &lt;div>`·`snake_case`·표·코드 블록 | ai-pipeline-engineer | 근거 오프셋(`rawSpan`·`source_locator`)이 원문 기준으로 맞는지 테스트 |
| ★2 | UP-14: AI-12 extract 프롬프트 — 값이 있는 STAR 필드의 합친 `set` 제안은 사용자의 블록 서식(목록·번호·제목·문단/줄 구조)을 유지하고 인라인 강조(굵게·기울임·취소선·인라인 코드)는 넣지 않는다. `prompt_version` 올림. 검증 V-3·V-9c/d/e·V-9j는 STAR 값·기존 텍스트를 C-1.1 정규화(검증 전용)한 평문으로 비교 — 목록 번호(`1.`)·기호가 숫자·`existing_missing`을 만들지 않게. 저장 값은 모델이 낸 마크다운 그대로 | ai-pipeline-engineer | 스키마·`schema_version`·RPC 변경 없음. fixture 갱신 |
| ☆3 | 분류 [무시] 서버 기억 — **리더 결정: DM 11.5 #1 후보 (b), 마이그레이션 없음**. 판정: 분류 슬롯 객체가 있고 `value`가 null(사용자 `set` null로 비운 슬롯, `rev` ≥ 2)이면 "무시함". (1) AI-12 프롬프트 입력에서 그 분류를 "추천하지 말 것"으로 넣거나 빼고, (2) V-9i에서 그 필드의 AI 분류 추천 패치를 버린다(조용히, 로그만). AI가 분류에 null을 쓰는 경로가 있는지 먼저 확인하고 있으면 판정 조건을 좁힌다 | ai-pipeline-engineer | 화면 `localStorage` 기억은 즉시 숨김용으로 남김(서버가 정본) |
| 4 | pgTAP: "DB 분류 값이 있는 행에 분류 제안 반영 기록 → `applied`"(`save_project_page`) 케이스 추가. [무시] 경로(사용자 `set` null on classification → `{value:null, origin:'ai', rev+1}`) 동작을 테스트로 고정 | db-engineer | 마이그레이션 없음 — 테스트만 |
| 5 | 확인: 화면 2,000자(JS UTF-16) vs DB `char_length`(코드 포인트) 셈 차이 — 이모지가 든 값에서 화면은 통과·DB 거부가 나는지. 결과를 노트에 기록(필요하면 화면 쪽 셈을 코드 포인트로 맞추는 UI 요청) | db-engineer | |
| 6 | 확인: 편집기 왕복 동일성 — 과거 평문 데이터를 열고 고치지 않은 채 저장하면 같은 문자열인지(편집기는 사용자 입력 전에는 `onValueChange`를 내지 않음 → 저장 값은 원문 그대로여야 함). QA가 코드로 확인 | backend-qa | |

## 계약 스케치
- 정규화: `normalizeDeliverableText(raw) → { text, map }` 기존 시그니처 유지(이름은 실제 코드 따름). STAR 검증용으로 같은 정규화를 재사용하는 helper 추가(예: `plainForValidation(md)`), 저장 경로에는 쓰지 않음.
- ☆3: `isDismissedClassification(slot)` = slot 존재 && slot.value === null && (slot.rev ?? 1) ≥ 2 (AI null 경로 확인 뒤 확정). V-9i에서 사용, 프롬프트 빌더(`context-pack/writing-chat.ts`)에서 사용.

## 작업 순서
1. ai-pipeline-engineer(★1·★2·☆3)와 db-engineer(4·5)를 병렬 — 서로 파일이 겹치지 않음.
2. 각각 끝나면 backend-qa(6 포함, `run-checks.sh`, pgTAP).

## 열린 `[가정]`
- ☆3 판정 조건(rev ≥ 2)은 AI가 분류 슬롯을 null로 만들지 않는다는 전제 — ai-pipeline-engineer가 확인.
- UP-14 "블록 서식"의 범위: 목록(중첩·번호)·제목·문단/줄바꿈·인용·표·코드 블록은 유지, 인라인 강조만 제외.

## 연결(wiring)
- 없음(화면은 기존 계약 그대로). UI 요청 후보: (5) 결과에 따라 글자 셈 단위 맞추기.
