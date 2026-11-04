# UI32-2 api-engineer 노트 — 근거·출처 라벨의 교육 이름 (2026-11-04)

규칙(사용자 결정): 교육 이름 = 앞뒤 공백을 뗀 `program_name`, 비면 `institution_name`, 둘 다 비면 null.
구현은 모두 `src/server/services/career/education-name.ts`의 `educationDisplayName`을 쓴다.

## 변경

| 파일 | 내용 |
|------|------|
| `src/server/services/drafts/read.ts` (loadNames) | `educations` 조회에 `program_name` 추가, C-11 출처의 `affiliationName`을 표시 이름으로. 둘 다 비면 맵에 넣지 않아 `affiliationName: null` (경력 쪽과 같은 null 의미) |
| `src/server/services/writing-chat/pipelines.ts` (loadPackInputs) | 교육 부모 조회에 `program_name` 추가, AI-12 팩의 `project.parent.name`을 표시 이름으로 |
| `src/lib/data/evidence.ts` (resolve) | mock·실제 공통 경로(실제는 `evidence-real.ts`가 실제 행을 MockDb 모양으로 넘김). `educationName` / `parentName` 헬퍼 추가 — 교육 근거의 `source_label` 대체값과 경로, 교육 소속 프로젝트·상세·성과 경로의 부모 이름을 표시 이름으로. 저장된 `source_label`이 있으면 그대로 우선(값 자체는 db-engineer 백필이 고침) |
| `src/lib/data/drafts.ts` (buildSourceTree) | mock·실제 공통(`drafts-real.ts`가 `select("*")`로 호출). 교육 소속 `name`·`project_labels`("부모 › 프로젝트")를 표시 이름으로. `meta`는 원래 `program_name · 기간`이었는데 이름이 교육 명이 되면 중복되므로, 교육 명이 있을 때만 `운영 기관 · 기간`, 없으면 `기간`만 보이도록 바꿈 |
| `src/lib/data/writing-chat-view.ts` | **변경 없음.** `ChatView.educations`는 `projectedReady`의 status 판정에만 쓰이고 화면 어디도 이름을 읽지 않는다(`grep` 결과 소비자 `components/career/actions.ts` → `use-ai-panel.ts`, 이름 미사용). 지시대로 화면이 이름을 보일 때만 `program_name` 추가 |

## 테스트

- QA-02: `src/lib/data/career.integration.test.ts` — `getNewProjectPage({ education })` 실제 분기. 교육 명(공백 포함) → 다듬은 교육 명, 교육 명 공백 → 기관명(다듬음), 둘 다 빔 → null, 목록 `affiliations`에도 같은 이름, 없는 id → not_found.
- `src/server/services/drafts/read.test.ts` — 교육 출처 3건(교육 명 / 공백 교육 명 → 기관명 / 둘 다 빔 → null)의 `affiliationName`.
- `src/server/services/writing-chat/writing-chat.integration.test.ts` — 교육 소속 프로젝트로 실제 턴을 돌려, 공급자 호출(스크립트 어댑터 기록)에 `affiliation: 교육 '<표시 이름>'`이 들어가고 다른 쪽 이름은 들어가지 않음을 확인(두 경우).
- 새 파일 `src/lib/data/education-labels.test.ts` — `toEvidenceView`(교육 근거 라벨 대체값·경로, 저장된 라벨 우선, 교육 소속 프로젝트 경로), `buildSourceTree`(이름·meta·project_labels).

실행 결과: `pnpm typecheck` 통과, `pnpm lint` 통과, `pnpm vitest run` 129 파일 / 2008 테스트 통과(로컬 스택 통합 테스트 포함, 건너뜀 없음). `pnpm build`는 실행하지 않음(병렬 작업 중, typecheck로 시그니처 확인).

## 범위 밖 / 남은 것

- 백필·SQL 헬퍼(`draft_source_label` 등)는 db-engineer, 팩 라벨·AI-03은 ai-pipeline-engineer 담당 — 이 노트의 파일과 겹치지 않음.
- `src/lib/mock/writing-chat-turn.ts:219`(UI 소유)는 미리보기에서 사용자 문장에 기관명이 있으면 교육 소속을 제안한다. 라벨이 아니라 매칭 규칙이라 이번 범위 밖. 교육 명으로도 매칭하려면 UI 요청.

## UI 요청

- QA-03 (기존): `src/lib/mock/career-v45.ts:261` 주석 "The real branches still get institution_name from the server"를 "실제 분기도 서버 `educationDisplayName`(같은 규칙)"으로 고칠 것.
- (확인 요청) S-17/S-31 출처 트리의 교육 소속 보조 줄(`meta`)이 이제 `운영 기관 · 기간`(교육 명이 있을 때) 또는 `기간`이다. 화면 명세 문구와 맞는지 UI가 확인. 데이터 계층 값만 바뀌었고 컴포넌트는 그대로.

## UI 소유 파일 수정

없음.

## 라운드 2 (QA-02)

리더 결정: 표시 이름 규칙은 사용자가 보는 곳에만 적용하고, AI 모델 입력은 조용히 바꾸지 않는다.

- 확인: `loadPackInputs`의 `project.parent.name`은 `buildWritingChatContext` → `src/server/ai/context-pack/writing-chat.ts:222`의 `affiliation:` 줄 하나에서만 쓰인다. 반환값 `Loaded`는 `contextFor`(`pipelines.ts`) 안에서 팩으로만 바뀌고, DTO·SSE 이벤트·화면으로 나가는 경로가 없다. 즉 모델 입력 전용이다.
- 조치: `src/server/services/writing-chat/pipelines.ts`를 UI32 이전 상태로 되돌렸다(`git checkout`, HEAD와 diff 없음). 교육 부모는 다시 `institution_name`만 조회해 쓴다. AI-12 모델 입력은 UI32 이전과 바이트 단위로 같다. prompt_version 변경 없음. `src/server/ai/`는 손대지 않았다.
- 테스트: `writing-chat.integration.test.ts`의 UI32-2 케이스를 "AI-12 모델 입력은 기관명을 유지" 단언으로 바꿨다. 교육 명이 있는 교육·공백뿐인 교육 두 경우 모두 공급자 호출 기록에 `affiliation: 교육 '<institution_name>'`이 있고, 교육 명은 들어가지 않음을 확인한다.
- 위 표의 `pipelines.ts` 행과 테스트 설명(라운드 1)은 이 라운드로 대체된다. 작성 대화 화면 쪽은 원래 이름을 보이지 않으므로(`writing-chat-view.ts` 행 참고) 별도 표시 값은 필요 없다.
- 실행: `pnpm typecheck` 통과, `pnpm lint` 통과, `pnpm vitest run` 129 파일 / 2008 테스트 통과(통합 테스트 포함, 로컬 스택).
