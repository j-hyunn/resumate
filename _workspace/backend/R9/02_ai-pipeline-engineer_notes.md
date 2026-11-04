# R9 — ai-pipeline-engineer 노트 (★1 · ★2 · ☆3)

- 날짜: 2026-11-04
- 근거: AI v4.10 C-1.1(UP-9 이스케이프 규칙)·0.v410 UP-14·AI-12 V-9i/V-9j·`star_patches`, DM v4.10 2.2·11.5 #1/#4/#6, 계획서 `_workspace/backend/R9/01_plan.md`, 편집기 `src/components/common/doc-markdown-editor.tsx` `patchMarkdownEscaping`(읽기만)
- 스키마·`schema_version`·RPC·마이그레이션 변경 없음. 커밋 안 함.

## prompt_version

| 프롬프트 | 이전 | 지금 | 이유 |
|----------|------|------|------|
| AI-12 extract | `ai-12.extract.v6+common.v2` | **`ai-12.extract.v7+common.v2`** | UP-14 서식 규칙·예시 5), UP-6 [무시] 분류 규칙, STAR 입력을 `<star_value>` 블록으로 바꿈 |
| AI-12 reply | `ai-12.reply.v6+common.v2` | 그대로 | 시스템 문구·입력 렌더링 변경 없음 |

## ★1 C-1.1 정규화 (`src/server/ai/context-pack/deliverable-text.ts`)

- 백슬래시 이스케이프: `\x`(x = ASCII 문장부호, CommonMark 규칙) → `x`, 오프셋 지도는 **x의 원문 위치**. `\\`·`` \` ``·`\*`·`\[`·`\]`·`\~`·`\_`·`\#` 등 모두.
- `&lt;` → `<`(지도는 `&` 위치). 다른 엔티티(`&amp;`·`&gt;`)는 디코딩하지 않음.
- 인라인 코드: 같은 길이 백틱 짝을 찾아 **내용을 글자 그대로**(이스케이프·강조 처리 안 함, 편집기도 코드 안은 이스케이프하지 않음). 양쪽 한 칸 여백은 CommonMark처럼 제거. 짝 없는 백틱은 예전처럼 지움.
- 표: 셀을 **이스케이프되지 않은 `|`로만** 나눔(편집기는 셀 안 `|`를 `\|`로 씀, 코드 안에서도). 셀 안 `<br>`(여러 줄 셀) → 공백 1개.
- 링크 글에 이스케이프된 괄호 허용(`[링크 \[1\]](url)` → `링크 [1]`).
- 줄 전체가 `&nbsp;`인 줄(편집기의 연속 빈 문단) → 빈 줄 `[가정]` (spec-gaps R9-AI-1).
- 확인한 편집기 문법: 취소선 `~~`, 인용 `>`(중첩·인용 속 목록), 제목 `#`~`###`, 목록(중첩·번호), 표(구분 줄 `| --- |`), 코드 블록(언어 표기 포함, 내용은 그대로 — 엔티티·이스케이프 유지), 링크 → 모두 평문.
- 새 export: `NormalizeOptions { codeBlockMaxLines }`, `plainForValidation(md)`(= 같은 규칙, 코드 블록 자르지 않음 — 검증 전용).
- 오프셋: `rawSpan`·산출물 `locate`(career-pack)는 그대로 쓰며, 이스케이프 글자·`&lt;`·표 셀·코드 안 `\|`의 원문 구간이 맞는지 테스트로 고정.

## ★2 UP-14 (프롬프트 + 평문 비교 검증)

### 프롬프트 (`src/server/ai/prompts/AI-12/index.ts`)
- 값이 있는 필드의 합친 `set`은 그 필드의 **블록 서식 유지**: 목록(`-`·`1.` 기호와 번호, 들여쓰기 중첩), 제목, 문단/줄 구조, 인용, 표, 코드 블록. 번호 목록에 항목을 더하면 번호를 이어 매김. 한 문단이면 한 문단. 서식을 새로 만들거나 바꾸지 않음.
- **인라인 강조(굵게·기울임·취소선·인라인 코드)는 어떤 value에도 넣지 않음**, 기존 텍스트의 인라인 강조는 기호만 지움. 이스케이프(`\*`, `\[`, `&lt;`)는 쓰인 그대로.
- 경계 사례 5) 번호 목록 + 굵게가 있는 result에 항목 3 추가 예시.
- 입력(`src/server/ai/context-pack/writing-chat.ts`): extract의 `<project_state>` star와 `<draft>` star 제안을 **`<star_value field="…">` 블록**에 저장 문자열 그대로(줄 들여쓰기 없이) 넣음. 이전에는 줄바꿈마다 4칸 들여쓰기가 붙어 모델이 목록 구조를 잘못 볼 수 있었다. 이 블록 안 이스케이프는 태그 시작 `<`(뒤가 영문자·`/`·`!`·`?`)만 `＜`로(C-4) — 인용 `>`와 편집기 `&lt;`는 그대로 보임. reply 렌더링은 바꾸지 않음.

### 검증 (평문 비교, 저장 값은 모델 출력 그대로)
- `src/server/ai/validation/v9.ts`
  - `checkClaim`(STAR text): V-9g·V-9c·V-9d·V-9e를 `plainForValidation(value)`와 `plainForValidation(기존 텍스트)`로 비교. 인용·발화는 원래 평문이라 그대로.
  - `preservesExisting`(V-9j): 양쪽 평문 — 목록 번호 `1.`·`2.`는 숫자가 아님 → `existing_missing` 오탐 없음. 실제 숫자 누락은 여전히 잡음.
  - `containsNormalized`(무변경 판정·`pendingInForm`·append 중복): 평문 + V-9b 정규화. 효과: 서식만 바꾼 합친 값은 "변경 없음"으로 버림, [반영] 때 편집기가 다시 이스케이프한 값(`\[메모\]`, `*초안*`)도 "폼에 채워짐"으로 판정.
  - 저장되는 `StarChange.value`는 모델이 낸 마크다운 그대로(테스트로 고정).
- `src/server/ai/validation/evidence.ts` + `context-pack/aliases.ts`·`career-pack.ts` (V-3, AI-02~AI-11 팩의 STAR 근거): 별칭 항목에 선택 키 `matchFields`(소속 프로젝트 STAR 5필드의 평문)를 두고 V-3가 그쪽과 비교. 인용도 평문화해서 비교(모델이 원문의 `2.`·`**`·`\[`를 베껴도 통과). 팩 본문에는 여전히 원문 마크다운. 저장 인용은 평문 구간 `[가정]` (spec-gaps R9-AI-2).
- 범위 밖으로 둔 것: V-10(AI-13 산출물 초안)은 이번 결정 대상이 아니라 그대로. V-5 수치 출처(`factualTexts`)는 원문 STAR를 그대로 씀(목록 번호가 허용 숫자에 더해지는 방향 — 느슨해질 뿐 오탐 없음).

## ☆3 분류 [무시] 서버 기억 (DM 11.5 #1 후보 (b), 마이그레이션 없음)

### AI가 분류 슬롯에 null을 쓰는 경로 확인 (최신 RPC `20261113000300_r8_star_merged_proposal.sql`)
- AI `set` 분류: `wc_classification_value`가 null이면 `invalid_value`로 거부 → AI는 null을 못 씀. V-9i도 값이 빈 추천은 버림.
- 사용자 `set` null: **슬롯 객체가 이미 있을 때만** `{value:null, origin:'ai', reviewed_at: now(), rev: 이전+1}` → rev ≥ 2.
- 사용자 reject: `needs_review`만 대상인데 분류는 항상 `review='ok'` → `invalid_review_transition`, 분류에는 해당 없음.
- `save_project_page`(`wc_mark_proposal_applied`)는 `applied_at`만 기록, 값을 비우지 않음.
- 슬롯의 첫 객체는 rev 1(`wc_next_rev`). → **"슬롯 있음 + 값 없음(null·빈 배열) + rev ≥ 2" = [무시]만**. 조건을 더 좁힐 필요 없음.

### 구현
- `src/server/ai/schemas/structured-draft.ts` `isDismissedClassification(slot)`.
- 프롬프트 입력: `<project_state>` classification에서 폼 값이 비어 있고 무시된 분류는 `(비어 있음 — 사용자가 이 대화에서 추천을 무시함, 추천하지 않음)`, `<draft>`는 `(무시함 — 다시 추천하지 않음)`. extract 시스템 규칙에 "무시한 분류는 추천하지 않고 null" 추가.
- V-9i: 무시된 필드의 AI 추천은 **조용히 버림** — `rejected`·`rejections`에 넣지 않고 리포트 `classification_dismissed` 카운트만(로그 `stats`에 포함, `flattenReport`). 화면 `localStorage` 기억은 즉시 숨김용으로 남음(서버가 정본).

## 테스트

- `pnpm exec tsc --noEmit`: 통과
- `eslint src/server/ai`: 경고·오류 없음
- `vitest run src/server/ai`: 46 파일 **1,162 통과**
- `vitest run`(전체): 130 파일 **2,217 통과**
- 추가·수정한 테스트
  - `context-pack/deliverable-text.test.ts`: 이스케이프·편집기 문법 18케이스(`2\*3`, `\[메모\]`, `a &lt;div>`, `&amp;`·`&gt;` 미디코딩, `snake_case`/`\_edge\_`, `\\`·`` \` ``·`\~`, `\#`, 취소선, 인용·인용 속 목록, 중첩 목록, 제목, 코드 스팬, 링크 속 이스케이프, 표 `\|`·코드 안 `\|`, `<br>`, `&nbsp;`), 코드 블록 내용 그대로, 오프셋 지도(`rawSpan`이 원문 `\]`·`&lt;`·표 셀까지 덮음), `plainForValidation` 3케이스
  - `validation/v9.test.ts`: UP-14 8케이스(번호 목록에 항목 추가 → V-9c·V-9j 통과·값 그대로 저장, 번호 없앤 한 문단 → ok, 목록 속 실제 숫자 누락 → `existing_missing`, 새 숫자 → V-9c 거부, 제목·굵게·이스케이프·`&lt;` 기존 텍스트, 날 `<hit>` 태그는 이름 누락, 서식만 바꾼 값 → unchanged, 편집기 재이스케이프 뒤 `new_object`), UP-6 2케이스(rev 2 null → 조용히 버림·카운트, rev 1 null → 추천 유지)
  - `validation/evidence.test.ts`: STAR 마크다운 V-3(항목 사이 인용, 원문 기호를 베낀 인용, 굵게, 지어낸 인용 거부)
  - `context-pack/writing-chat.test.ts`: `<star_value>` 렌더링·`>`/`&lt;` 유지·태그 시작 이스케이프, 무시 표시(extract 두 블록)
  - `pipelines/AI-12.test.ts`·`AI-12.gate.test.ts`: extract 버전 v7, 시스템 문구 확인

## [가정]
- C-1.1 `CODE_BLOCK_MAX_LINES`(30, 팩 전용) 그대로. 검증용 평문은 코드 블록을 자르지 않음.
- 줄 전체 `&nbsp;` = 빈 줄 (R9-AI-1).
- STAR V-3 저장 인용 = 평문 구간 (R9-AI-2).
- 줄 앞 `N. `/`N) `은 목록 번호로 보고 V-9c·V-9j에서 뺌 (R9-AI-3).
- 모델이 마크다운 값에 날 `<태그>`를 쓰면 HTML로 보고 지운 뒤 비교(편집기 화면에도 글자로 보이지 않음).

## 다른 담당에게
- api-engineer: 시그니처·SSE·오류 코드 변경 없음. extract 로그 `stats`에 `classification_dismissed` 키가 늘었다.
- db-engineer: 변경 요청 없음(☆3 판정은 RPC 현재 동작 — `set` null → rev+1 빈 객체 — 에 기대므로 pgTAP 고정(계획 #4)이 중요).
- backend-qa: 위 테스트 파일. fixture는 `src/server/ai/__fixtures__/AI-12/conversations.ts`, `__fixtures__/career-rows.ts` 그대로 사용(테스트 안에서 STAR만 바꿈).


## QA 라운드 1 수정

### QA-02 [Major] 줄 앞 숫자 → 목록일 때만 기호 (spec-gaps R9-AI-3 좁힘)
- `context-pack/deliverable-text.ts` `findOrderedListMarkers`: 줄 앞 `N.`/`N)`는 1–2자리(`ORDERED_LIST_MAX_DIGITS = 2`, `[가정]`)이고 번호가 1이거나, 이웃 항목이 n-1(앞) / n+1(뒤)일 때만 목록 기호로 지움. 이웃 = 같은 인용(`>`) 깊이·같은 들여쓰기, 사이에는 빈 줄·`&nbsp;` 줄·더 깊이 들여쓴 줄(이어지는 줄·중첩 목록)만. 코드 블록·표·같은 깊이 일반 문단은 목록을 끊음. 구분 기호(`.`/`)`)는 섞여도 같은 목록으로 봄(기존 테스트 `1. 첫째` + `2) 둘째` 유지).
- 그 밖(3자리 이상 "2024.", "300)", 혼자 있는 "7.", 순서 밖 "5.")은 본문 숫자 → V-9c·V-9j가 검사. "2023. 3월" → "2023년 3월" 다시 쓰기 오탐도 사라짐(기존 평문에 2023이 남음).
- `NormalizeOptions.orderedLists` / `plainForValidation(md, "fragment")`: 목록에서 잘라 온 조각용 — 1–2자리는 모두 기호(3자리 이상은 본문). V-3 STAR 인용(`evidence.ts`)과 `containsNormalized` needle(`v9.ts`)에 씀. 값·기존 텍스트·haystack은 기본 "list" 모드.
- C-1.1 팩 평문(산출물 본문, STAR 팩)도 같은 규칙 → "2024. …" 줄은 팩에도 숫자가 남음. 프롬프트 문구는 바꾸지 않아 `prompt_version` 그대로.

### QA-03 [Minor] 자동 링크 글 유지
- `renderInline`: `<scheme:…>`·`<a@b.c>`(CommonMark autolink)는 HTML 태그로 지우지 않고 안의 글을 원문 위치 지도와 함께 남김. 다른 `<태그>`는 그대로 지움.

### QA-05 (미처리)
- [무시]와 진행 중 턴 경합은 다음 슬라이스 후보로 둠(근본 해결은 RPC가 AI 분류 패치에서 `value null & rev >= 2` 슬롯을 건너뛰기 — 마이그레이션 필요).

### 테스트
- `deliverable-text.test.ts`: 목록/본문 숫자 16케이스(이어지는·느슨한·중첩·시작 3·게으른 1·인용 속·섞인 구분 기호 목록 / "2024.", "300)", "2023. 03 ~ 2024. 02", 혼자 "7.", 순서 밖 "5.", 문단이 끊은 "2.", "45."+"100.", "99."+"100."), fragment 3케이스, 자동 링크 3케이스 + 오프셋 지도
- `v9.test.ts`: QA 프로브 고정 — "2024. 서비스를 출시함"·"300) 명이 가입함" V-9c 거부, "1. …" 통과; V-9j "2023. 03 ~" → "3월부터" `existing_missing`; "2023년 3월" V-9c 통과; `containsNormalized` 목록 조각
- `pnpm exec tsc --noEmit` 통과, `eslint src/server/ai` 깨끗, `vitest run` 130 파일 2,244 통과 (`src/server/ai` 46 파일 1,189)
