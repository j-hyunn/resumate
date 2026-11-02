# W5 QA 수정 — frontend-engineer

> 2026-11-02. 입력: `_workspace/ui/19_ui-qa_w5_review.md`, `_workspace/backend/W5/03_backend-qa_report.md`.
> UI 파일만 고쳤다(`src/server/`, `src/lib/contracts/`, `src/proxy.ts`, 그 밖의 `src/lib/data/` 파일은 건드리지 않음). 커밋, `pnpm build`, 실제 공급자 호출은 하지 않았다.
> **브라우저 확인은 이번에도 없다.** 아래 "확인"은 단위 시험, lint, typecheck, 소스 판독이다.

## 요약

| ID | 심각도 | 결과 | 확인 |
|----|--------|------|------|
| QA-W5-01 | Major | 고침 | 단위 시험(실제 AI-03 모양), typecheck. 화면 렌더 미확인 |
| UQ-701 | Major | 고침 | typecheck, 소스 판독. 실제 실패 행으로 다시 열기 미확인 |
| UQ-702 | Minor | 고침 | 단위 시험(재현 시나리오), typecheck |
| QA-W5-06 (1) | Minor | 고침(폼 쪽) | 단위 시험 |
| UQ-703 | Minor | 고침 | typecheck, 소스 판독 |
| UQ-705 | Minor | 고침 | 소스 판독 |
| UQ-706 | Minor | 고침 | lint, 소스 판독. 실제 포커스 이동 미확인 |
| UQ-707 | Minor | 고침 | 소스 판독(대기 상수와 대조) |
| QA-W5-08 | Minor | 고침 | 단위 시험 16건 |

UQ-700, UQ-704, QA-W5-02~05, QA-W5-06 (2), QA-W5-07, 09, 10은 백엔드 담당이라 손대지 않았다.

## 이슈별

### QA-W5-01 [Major] S-19 "포함하지 않은 항목"
- 원인: AI-03 `validated.result.omitted`는 `{ project_id, reason }`인데 `ai-stream-client.ts`가 `label ?? reason`만 읽어 `"low_relevance"` 같은 enum 원문만 남았다.
- 수정
  - `src/lib/mock/ai-stream.ts`: `GenerationNotesPayload.omitted`를 `Array<OmittedProject | string>`로 넓혔다. `OmittedProject = { project_id, reason }`. 문자열은 mock이 만드는 완성 문장("항목 — 이유")이다(mock 경로 `lib/data/drafts.ts`는 그대로).
  - `src/lib/data/ai-stream-client.ts` `notesOf`: `project_id`가 있으면 `{ project_id, reason }`으로 넘기고, 빈 값과 id 없는 항목은 버린다.
  - `src/components/applications/draft-editor.tsx` `GenerationNotes`: 화면이 이미 가진 C-11 소스 트리의 `tree.project_labels`(id → "회사명 또는 기관명 › 프로젝트명")로 이름을 붙이고, 이유는 한국어 문구로 바꾼다.
  - `src/components/applications/labels.ts`: `OMITTED_REASON_LABELS` 추가.
- 문구 `[UI-가정]`
  - `user_excluded`: "포함 항목 설정에 따라 이번 초안에 넣지 않았어요". 서버는 8개 상한을 넘어 잘린 프로젝트도 `user_excluded`로 보내므로(`AI-03.ts:487`) "직접 뺐다"고 단정하지 않았다. 잘린 경우는 같은 응답의 `notes_for_user`에 상한 안내가 따로 온다.
  - `low_relevance`: "이 기업 JD와 관련이 적어 이번 초안에 넣지 않았어요"
  - 모르는 이유: "이번 초안에 넣지 않았어요"
- **이름이 없을 때**: 소스 트리는 `complete` 프로젝트만 담는다. AI-03 컨텍스트 팩도 같은 규칙이라 보통은 이름이 있다. 다만 생성 중에 그 프로젝트를 지우거나 작성 중으로 되돌리면 트리에 없다. 이때는 이름을 지어내지 않고 "지금은 찾을 수 없는 프로젝트"로 보인다 `[UI-가정]`. 서버가 표시 이름을 함께 보내면 이 대체 문구가 필요 없다. 그 결정은 백엔드 QA "스펙 차이"의 QA-W5-01 항목(이름을 서버와 클라이언트 중 어디서 만드는지)에 남겨 둔다.
- 확인: `ai-stream-client.test.ts`에 실제 AI-03 모양(`[{project_id, reason}]`, id 없는 항목, 빈 문자열) 시험 1건 추가, 통과. 화면 렌더는 미확인.

### UQ-701 [Major] 실패한 경력기술서를 다시 열면 C-20이 없다
- 원인: `page.tsx`가 `sections.length === 0`일 때만 실패로 봤다. 실제 실패 초안에는 `begin`이 만든 섹션 행(머리글만, `ai_content` null)이 남는다.
- 수정 (`src/app/(dashboard)/(gated)/applications/[id]/drafts/[draftId]/page.tsx`)
  - `failedCareer = draft_type === "career_description" && status === "failed"`. 섹션 수를 보지 않는다(02 S-19 실패 처리, A4: 경력기술서 실패는 블록을 남기지 않는다).
  - 머리 설명, `getLatestJobFor` 호출, `storedFailure` 세 곳 모두 이 판정을 쓴다.
  - C-20 원인 코드는 마지막 작업 행이 `failed`일 때의 `error_code`이고, 작업 행이 없거나 코드가 없으면 시스템 실패 문구(`schema_invalid`)로 간다.
- 함께 고친 것 (`draft-editor.tsx`): 실패 초안에서 "전체 복사"가 남은 머리글(회사명)만 복사할 수 있었다. 경력기술서가 실패 상태면 복사할 글을 비워 버튼이 꺼진다.
- 편집기 쪽 C-20 경로(`cdFailed` 초기값 = `storedFailure.code`, 본문 대신 C-20, 오른쪽 C-11 패널 비움, "다시 시도" = 새 초안 행)는 원래 코드 그대로다.
- 확인: typecheck, 소스 판독. 실제 실패 행으로 다시 열어 보는 것은 하지 않았다(UI QA 재현 절차 1~4로 다시 볼 것).

### UQ-702 [Minor] + QA-W5-06 (1) 거짓 충돌 안내
- 원인 두 가지
  1. 폼 값과 저장된 행의 모양이 다르다. "재직 중"을 켜도 폼에는 옛 `end_month`가 남지만 저장은 null로 간다. 기간 역전이면 기간을 보내지 않는다. 그래서 응답만 잃은 저장이 `already_saved`로 판정되지 않았다.
  2. 첫 저장 응답을 두 번 잃으면 행은 우리 두 번째 시도 값을 담고 `updated_at`이 올라간다. 폼은 `base`가 null이라 무조건 충돌로 봤다.
- 수정
  - `src/lib/data/row-save.ts` `decideConflict`에 두 입력을 더했다.
    - `stored(values, latest)`: 그 값을 저장하면 `latest`가 어떻게 되는지(폼 모양). `sent` 대신 이것을 최신 행과 비교한다.
    - `earlierTries`: 첫 저장(같은 `client_id`)에서 응답을 잃은 이전 시도 값들. `client_id`는 이 폼만 알기 때문에 행이 그중 하나를 담고 있으면 우리가 쓴 것이다 → `rebase`(최신 버전 위에 다시 보냄).
  - `storedPeriod(start, end, latest)` 도우미: 역전된 기간은 저장된 기간이 남는다.
  - `src/components/career/form-parts.tsx` `useRowAutosave`: `stored` 옵션을 받고, `client_id` 경로로 보낸 값을 모은다. 첫 저장이 `rebase`로 끝나도 편집 주소로 바꾸도록(`replaceState`) "만드는 중이었는지"를 시도 전에 잡아 둔다.
  - 폼별 `stored`
    - S-09: "재직 중"이면 종료 월 null, 기간 역전이면 저장된 기간
    - S-34: "재학 중"이면 종료 월 null, 기간 역전
    - S-10: 요약 200자 자름, 팀 규모 반올림(`teamSizeOf`로 저장과 같은 함수), 기간 역전
    - S-35: 필드별 글자 수 자름
    - S-11: "1,000" → 1000 (숫자 정규화)
  - 그래도 보이는 칸이 모두 같은 충돌 안내가 뜨면 빈 목록 대신 "보이는 칸은 모두 같아요. 어느 쪽을 골라도 화면 내용은 그대로예요." 한 줄을 보인다 `[UI-가정]`.
- QA-W5-06 (2)(지운 행의 `client_id` 되살림)는 서버 쪽 판단이라 손대지 않았다.
- 확인: `row-save.test.ts`에 5건 추가(재직 중 토글 + 응답 유실 → 전에는 `conflict`, 지금은 `already_saved` / 기간 역전 / 다른 탭이 기간을 바꾼 진짜 충돌은 그대로 `conflict` / 첫 저장 두 번 유실 → `rebase`, 모르는 값이면 `conflict`). 훅 실행·HTTP 재현은 하지 않았다.

### UQ-703 [Minor] S-18 빈 칸인데 옛 문구로 생성
- 원인: 빈 문항은 저장을 건너뛰므로(W3-9) 저장된 문구는 옛것이다. "전체 문항 생성" 판정 `anyEmpty`는 서버 값만 봤다.
- 수정 (`src/components/applications/cover-letter-questions.tsx`)
  - 카드가 화면 입력이 비었는지(`empty`)와 `flush`를 페이지에 알린다(`CardStatus`).
  - `anyEmpty`는 카드가 알린 값을 먼저 본다. 화면에서 비운 문항이 있으면 "전체 문항 생성"이 꺼지고 기존 안내 "비어 있는 문항을 채우면 생성할 수 있어요"가 보인다(명세 S-18 문항 필수).
  - "전체 문항 생성"은 S-19로 가기 전에 모든 카드의 입력을 저장한다. 전에는 언마운트 저장에 맡겨 S-19가 먼저 옛 문구를 읽을 수 있었다.
  - "이 문항만 생성"은 원래 화면 입력(`!question.trim()`)으로 꺼지고 누를 때 저장했다. 바꾸지 않았다.
- 남은 것: 저장이 실패한 상태에서 생성하면 저장된 옛 문구로 생성된다(이번 이슈 범위 밖, 원래 동작).
- 확인: typecheck, 소스 판독.

### UQ-705 [Minor] 충돌 버튼 터치 대상
- `form-parts.tsx` `SaveProblemNotice`의 두 버튼에 `max-md:min-h-11`(768px 미만 44px, 리더 결정 2026-10-25). S-09·S-34·S-10·S-35·S-11 모두 이 컴포넌트를 쓴다.
- 확인: 소스 판독.

### UQ-706 [Minor] 선택 뒤 포커스
- 고르면 안내가 사라지면서 같은 자리에 결과 한 줄(`role="status"`, `tabIndex=-1`)을 남기고 포커스를 옮긴다. 화면 읽기 프로그램도 결과를 읽는다.
  - "최신 내용으로 바꾸기" → "최신 내용으로 바꿨어요"
  - "내 입력으로 저장" → "내 입력으로 저장하고 있어요"(결과는 머리의 저장 상태가 보인다)
  - 문구 `[UI-가정]`. 새 문제가 생기면 결과 줄은 지워진다.
- 확인: lint, 소스 판독. 실제 포커스 이동은 브라우저로 봐야 한다. S-11은 모달 안이라 포커스가 모달 밖으로 나가지 않는지도 같이 볼 것.

### UQ-707 [Minor] 중단 대기 문구
- `src/components/common/streaming.tsx`: "최대 10초쯤" → "최대 20초쯤".
- 근거: `drafts-real.ts` `stopRun`은 작업 행이 나타나기를 최대 3초, 닫히기를 최대 12초 기다린다(0.25초 폴링과 왕복 시간 추가). 최악 약 15초 + 왕복이라 "12초"나 "15초"로 쓰면 넘칠 수 있어 20초로 적었다. 주석에 계산을 남겼다. `?state=stopping` 미리보기도 같은 문구를 쓴다.
- 확인: 소스 판독. 실측 없음.

### QA-W5-08 [Minor] 클라이언트 `safeNextPath`
- `src/lib/routes.ts`: 계약판(`lib/contracts/routes.ts` `safeNextPath`)을 먼저 돌리고, 그 위에 화면 쪽 규칙(`/sign-in`·`/consent`와 그 아래 경로 거부)을 더한다. 계약판이 거부하는 값(`/auth/callback`, 제어 문자, 512자 초과, `//`, `/\`)은 화면에서도 거부되고, 경로 정규화(`/career/../sign-in` → `/sign-in`)도 같아졌다.
- 반환형(`string | null`)과 이름은 그대로라 호출자(S-02, S-03, `sign-in-link`, `components/account/actions.ts`)는 바꾸지 않았다.
- 확인: `src/lib/routes.test.ts` 새로 추가(16건). `"/auth/callback?x=1"` 등이 계약판과 화면판 모두에서 거부되는 것을 함께 확인.

## 바꾼 파일
- `src/lib/data/row-save.ts`, `src/lib/data/row-save.test.ts`
- `src/lib/data/ai-stream-client.ts`, `src/lib/data/ai-stream-client.test.ts`
- `src/lib/mock/ai-stream.ts` (타입만)
- `src/lib/routes.ts`, `src/lib/routes.test.ts`(새 파일)
- `src/components/career/form-parts.tsx`, `experience-form.tsx`, `education-form.tsx`, `project-form.tsx`, `detail-form.tsx`, `achievement-dialog.tsx`
- `src/components/applications/draft-editor.tsx`, `cover-letter-questions.tsx`, `labels.ts`
- `src/components/common/streaming.tsx`
- `src/app/(dashboard)/(gated)/applications/[id]/drafts/[draftId]/page.tsx`
- `docs/ui/screen-status.md` (S-02, S-03, S-09, S-34, S-10, S-35, S-11, S-18, S-19 행과 머리 메모. 모두 "브라우저 미확인" 유지)

## `[UI-가정]` 새로 생긴 것
- S-19 `omitted` 이유 문구 3개와 이름 없을 때 "지금은 찾을 수 없는 프로젝트"
- 충돌 안내: 보이는 칸이 모두 같을 때 한 줄, 선택 뒤 결과 줄 2개
- 중단 대기 "최대 20초쯤"

## 기획 확인 필요
- AI-03 `omitted`의 표시 이름을 서버가 보낼지(지금은 화면이 소스 트리로 붙임). 서버가 보내면 생성 중 삭제된 프로젝트도 이름이 남는다.
- `user_excluded`가 "직접 뺀 것"과 "8개 상한으로 잘린 것"을 함께 뜻한다. 화면 문구를 나누려면 이유 값을 나눠야 한다.

## 기계 검사

| 명령 | 결과 |
|------|------|
| `pnpm lint` | 오류·경고 0 (중간에 api-engineer 작업 파일 `mock-isolation.test.ts`의 경고 1건이 보였다가 마지막 실행에서 사라졌다) |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 108파일 1,665건 통과 (api-engineer 작업이 같은 체크아웃에 있는 상태) |
| `pnpm build` | 지시대로 실행 안 함 |

## 확인하지 못한 것 (브라우저 필요)
- S-19: 실제 실패 행을 다시 열었을 때 C-20·"다시 시도"·꺼진 복사, 생성 직후 안내 상자의 프로젝트 이름
- 커리어 폼 5종: 충돌 안내의 버튼 크기, 선택 뒤 포커스와 결과 줄, "재직 중" 토글 + 응답 유실 실제 재현
- S-18: 문항을 비웠을 때 전체 생성 버튼 비활성, 전체 생성 전 저장 순서
