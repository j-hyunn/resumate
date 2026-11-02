# A4 면접·보드 구현 보고 (Phase 3, 2026-10-25)

기준: 플로우 v4.2b · AI v3.2a · 데이터 모델 v3.2a · 디자인 시스템 v1 · A0 보고(라운드 1). 커밋하지 않음. 데이터는 mock 계층만 사용.

## 완료 화면

| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---------|--------|--------------|------|
| S-20 면접 준비 | `/applications/[id]/interview?type=job\|culture_fit` | `loading` `error` `unauth` `not-found` `empty`(세션·작성 중 없음) `insufficient` `insufficient-no-experience` `limit` `wait-jd` `ai-failed` / `-input` / `-timeout`(시작한 질문 생성이 S-33에서 실패) `from-board`(`?type=`와 함께, 진입 안내 미리보기) | 진입 안내(출발 메뉴 = 지원 현황 + `?type=`), 작성 중 세션 배너(이어서 쓰기 / 그만두기 + 확인), ① 유형 RadioGroup 카드(기본 선택 없음, `?type=` 미리 선택·변경 가능), ② 질문 수 ToggleGroup 3/5/7(기본 5), 직무 + 준비 안 됨 → C-09(컬처핏 대안·복귀 설정 `interview_type`/`question_count`), 컬처핏 thin/none 안내, 시작하기 + UsageHint, ST-LIMIT, ST-WAIT-JD(JD 추출 미완료), C-10 복귀 시 `consumeReturnParams(id,"job_interview")`로 설정 복원, 이 기업 JD의 세션 목록(C-17 점수, 새 결과 표식, 삭제 C-05) |
| S-33 면접 답변지 | `/applications/[id]/interview/[sessionId]` | `loading` `error` `unauth` `not-found` `ai-pending`(생성 중 화면, 질문 절반 + 자리 표시) `ai-failed` / `-input` / `-timeout` `save-failed` | 질문이 AI-05 진행에 따라 차례로 채워짐(2초 폴링, 서버 액션이 작업을 진행시켜 질문 행 생성), 전부 생성될 때까지 답변란 비활성 + "질문을 준비하고 있어요"(D-UX-07), 편집 조건 = 답변 draft + 미제출 + `generation_status='ready'`, 화면 머리 C-06 하나로 자동 저장(직렬화, 변경된 답변만), 생성 실패 → ST-AI-FAILED + 다시 시도(남은 질문 무차감 안내), 하단 sticky "답변 a/N" + 제출, 미응답·50자 미만 답변 경고 AlertDialog → `submit_interview_session` → S-22. 제출된 세션은 S-22로 redirect, 그만둔 세션은 읽기 전용 |
| S-22 면접 결과 | `/applications/[id]/interview/[sessionId]/result` | `loading` `error` `unauth` `not-found` `ai-pending`(채점 중 + 첫 카드만 완료) `ai-failed` / `-timeout`(채점 실패 + 다시 시도) `scored`(C-17 scored 분기, 임의 값 72/100 · 4/5 미리보기 전용) `empty` / `no-answers`(응답 0개 → "답변이 없어 평가할 내용이 없어요" + 새 면접 시작하기) | 머리 카드: C-17 세션 점수(`score_status`별) + 고정 고지 + "산정 근거 보기"(scored·rationale) + "다른 산정 방식으로 계산된 점수예요"(method_version 비교 [가정]) + `unanswered_count` + 다룬 보완 요건(`weak_requirement_ids` → 요건 `content`) + `data_sufficiency` thin/none 안내. 종합 피드백(AI-07: headline, 강점·보완, unanswered_note, 다음 연습). 답변별 카드: 질문 n/N · 유형 라벨(세션 `interview_type`) · AnswerScore · 내 답변(접기) · 질문 의도(`intent_reveal`) · 참고 평가 기준 4항목 등급 · 잘한 점 · 개선할 점 · 개선 답변 예시(C-08 자리 표시) · 일관성 메모 · C-01 근거 칩(`criteria.*`, `improvements.n`, `model_answer`). 채점 중 C-03 + 끝난 카드부터, 열람 시 `result_viewed_at` 기록. **점수 산식은 만들지 않음** — 저장된 `score_*` 슬롯만 표시(D-14) |
| S-37 모의 면접 | `/interviews` | `loading` `error` `unauth` `empty`(세션 없음) `no-jd`(기업 JD 없음) | 새 면접 → C-16, 작성 중 맨 위 고정 카드(이어서 쓰기), 필터(기업 JD / 유형 / 상태), 세션 목록 최신순(넓은 화면 Table, 좁은 화면 카드), 상태 배지 5종, 채점 중 행 C-03 축약형(작업 폴링), 새 결과 점, 행 메뉴 삭제(C-05)·기업 JD로 가기, "그만둔 면접" 접힘 묶음, 빈 상태 2종. S-33/S-22/S-31로 갈 때 `setNavOrigin("interviews")` |
| S-39 지원 현황 보드 | `/board` | `loading` `error` `unauth` `empty` `move-failed`(모든 이동 실패 → 원위치 + "이동하지 못했어요" 다시 시도) | 6열 고정, 열 머리 카드 수, 지원 전 열 "+"(→ S-14 `from=board`), 카드(회사명·포지션 / D-day(3일 이내 경고 배지) / 인사이트·초안 수·면접 수·작성 중 / 종료 카드 결과 배지), 카드 클릭 → S-31(`setNavOrigin("board")`), ⋯ 메뉴 = 공통 `StageCardMenu`(단계 이동·다음 단계로·결과 기록) + 기업 JD 열기 + 삭제(C-05). dnd-kit 포인터 + 키보드 센서(손잡이 포커스 → Space 집기 → ←/→ 열 이동 → Space 놓기 / Esc 취소), 놓을 수 있는 열 강조, DragOverlay. 모든 이동은 공통 `useStageMove().request()` → C-13 / C-14 / 결과 지우기 확인 / aria-live 알림. 낙관적 반영 시 카드가 바로 새 열 맨 위로. 768px 미만: 열 탭 + 메뉴로만 이동, 가로 스크롤은 보드 영역 안에서만 |
| C-16 기업 JD 선택 | (S-37 다이얼로그) | S-37 `no-jd`에서 빈 상태 확인 | Dialog + Command 검색("회사명 또는 포지션 검색"), 최근 활동순, 단계·D-day·"작성 중 면접" 배지, 빈 상태 "기업 JD를 먼저 추가해 주세요" → S-14. 작성 중 세션이 있으면 "작성 중인 면접이 있어요: 이어서 쓰기 / 그만두고 새로"(FL-17), 아니면 S-20(출발 메뉴 = 모의 면접) |

### 파일

- 라우트: `src/app/(dashboard)/applications/[id]/interview/page.tsx`, `…/[sessionId]/page.tsx`, `…/[sessionId]/result/page.tsx`, `src/app/(dashboard)/interviews/page.tsx`, `src/app/(dashboard)/board/page.tsx` (모두 A0 `ScreenSuspense` 페이지 규칙)
- `src/components/interviews/`: `actions.ts`(서버 액션), `session-status.tsx`(상태 배지·새 결과·행 이동 대상·상대 시각), `session-list.tsx`(S-20·S-37 공용 목록 + 삭제), `interview-prep.tsx`(S-20), `answer-sheet.tsx`(S-33), `result-view.tsx`(S-22), `jd-picker-dialog.tsx`(C-16), `interviews-overview.tsx`(S-37)
- `src/components/board/`: `actions.ts`(삭제), `kanban-board.tsx`(S-39)
- 링크는 모두 `routes.*`. C-12~C-14·C-05·C-09·C-17은 공통 컴포넌트를 import(재구현 없음).

## 미완료 / 부분 구현

- **새로 제출한 세션의 평가 내용**: mock 채점 작업이 끝나도 `answer_evaluations`·`session_feedbacks` 행을 만들지 않아(파운데이션 `ai-jobs.ts syncEffects`), 새 세션의 S-22는 점수 자리("점수 준비 중")만 나오고 카드에 "평가 내용이 아직 없어요"가 표시된다. 픽스처 세션 2(컬처핏)는 정상 표시. 아래 파운데이션 요청 1.
- **답변별 "다시 채점"**: 질문 하나만 다시 채점하는 데이터 API가 없어, 세션의 채점 작업 전체를 `retryAiJobAction`으로 다시 돌린다 [UI-가정]. 파운데이션 요청 2.
- **질문 생성 중단 버튼**: C-04는 중단 버튼을 두지만 면접 질문 생성의 중단 후 세션 처리가 명세에 없어 두지 않음(기획 확인 필요).
- 브라우저 육안·실제 드래그 조작 확인은 하지 않음(아래 검사 결과). QA가 브라우저에서 키보드 드래그·C-13/C-14 흐름 확인 필요.

## [UI-가정]

| 화면 ID | 파일:줄 | 내용 |
|---------|---------|------|
| S-20 | `interview-prep.tsx:42` | 유형별 한 줄 설명 문구 |
| S-20 | `interview-prep.tsx:171` | 작성 중 세션 배너 문구 "작성 중인 면접이 있어요 · {유형} · n/N 작성 · 마지막 활동" |
| S-20 | `interview-prep.tsx:292,296` | 유형 미선택 안내, 작성 중 세션 있을 때 새로 시작 불가 안내(기업 JD당 작성 중 1개 unique → 시작 버튼 비활성) |
| S-20 | `interview-prep.tsx:305` | 그만두기는 AlertDialog로 확인(문구 가정) |
| S-20 | `interview-prep.tsx:136` | 시작 실패 토스트 문구 |
| S-20 | `interview/page.tsx:121` | 세션 0개 문구 "아직 이 기업 JD로 연습한 면접이 없어요" |
| S-20 | `interview-prep.tsx` | 진입 안내 판단 = 출발 메뉴(sessionStorage) `board` + `?type=` 있음 |
| S-33 | `answer-sheet.tsx:332` | 제출 확인·미응답·짧은 답변(50자 미만, AI 명세 4.2 기준) 경고 문구, 미응답이 없어도 제출은 항상 확인(1회 제출·수정 불가) |
| S-33 | `answer-sheet.tsx:187,201` | 저장 실패 중 제출 차단 토스트, 제출 실패 토스트 |
| S-33 | `answer-sheet.tsx:120` | 생성 완료 스크린 리더 알림 문구 |
| S-33 | `answer-sheet.tsx:225` | 그만둔 세션은 S-33에서 읽기 전용 열람 + 안내 문구(S-37 목록 행 → S-33) |
| S-33 | `answer-sheet.tsx` | G-2 민감정보 안내를 답변지 맨 위에 한 번(답변란마다 반복하지 않음), 글자 수는 "{n}자"만(상한 없음) |
| S-22 | `result-view.tsx:317,340,417` | 미응답 카드 문구, 평가 행 없음 문구, 일관성 메모 제목 "등록한 커리어와 다른 점" |
| S-22 | `result-view.tsx:206` | 다음 연습 `add_data` → 커리어(S-08), `focus_session` → S-20(`?type=`), `retry_question`은 문구만 |
| S-22 | `result-view.tsx` | 채점 전 머리 카드 문구 "채점이 끝나면 점수 자리가 표시돼요", 섹션 제목 "종합 피드백 / 강점 / 보완할 점 / 다음 연습 / 답변별 평가 / 질문 의도 / 참고 평가 기준 / 잘한 점 / 개선할 점 / 개선 답변 예시", "빠진 점:" 접두. 항목 이름은 AI 명세 4.2 표(컬처핏 `job_relevance` = "직무·조직 연결") |
| S-22 | `result/page.tsx:125` | "지난 세션과 방식이 다르면" = 같은 기업 JD의 직전 채점 세션과 `score_method_version` 비교 |
| S-22 | `result/page.tsx` | `?state=scored`의 72/100·4/5는 미리보기 전용 값(산식 아님) |
| S-37 | `interviews-overview.tsx:41,173` | 필터는 화면 상태(URL 미반영), 필터 결과 없음 문구. 상태 필터에서 그만둠은 제외(아래 묶음으로 따로 표시) |
| S-20/S-37 | `session-list.tsx:215` | 세션 삭제 완료 토스트 문구 |
| C-16 | `jd-picker-dialog.tsx:110,130` | 다이얼로그 설명 문구, 검색 결과 없음 문구 |
| S-39 | `kanban-board.tsx:170,241` | dnd-kit 한국어 안내·알림 문구(놓은 결과 알림은 C-12 공통 문구 그대로) |
| S-39 | `kanban-board.tsx:311` | 기업 JD 삭제 완료 토스트 문구 |
| S-39 | `kanban-board.tsx:325` | 빈 열 "카드 없음"(design-system P-4) |
| S-39 | `kanban-board.tsx` | 카드 제목 = `job_descriptions.company_name`, 둘째 줄 = `position_title`. 회사명이 없으면 `application_projects.name` 표시 이름만 |

## 기획 확인 필요

| 화면 ID | 질문 | 스펙 위치 |
|---------|------|-----------|
| S-22 | "항목별 등급과 다음 연습은 D-14 결과에 따라 표시"의 뜻 — D-14 미정인 지금 등급·다음 연습을 보여도 되는지(현재는 "참고 평가 기준"으로 표시) | 02 S-22 마지막 줄 |
| S-33 / S-22 | "v3와 같음"인 S-33·S-22 v3 세부 명세가 저장소에 없음. 문구·구성은 v4 행과 AI 명세 4장 기준으로 구성 | 02 S-33, S-22 (design-system P-6) |
| S-33 | 제출 전 경고 문구, "짧은 답변" 기준(현재 50자 미만) | FL-12 |
| S-33 | 질문 생성 중단(C-04 중단 버튼) 허용 여부와 중단 후 세션 상태 | 02 C-04, 03 AI-05 |
| S-20 | 작성 중 세션 배너·그만두기 확인 문구, 작성 중 세션이 있을 때 시작 버튼 처리 | 02 S-20 |
| S-37 | 그만둔 세션 행을 누르면 어디로 가는지(현재 S-33 읽기 전용) | 02 S-37 |
| S-22 | 답변 하나만 "다시 채점"할 때 사용량·작업 단위 | 02 C-17 |
| S-39 | 빈 열 문구(P-4), 키보드 드래그 안내 문구 | 02 S-39 |

## 파운데이션 요청

1. **mock 채점 결과 생성**: `src/lib/data/ai-jobs.ts`의 `interview_evaluation` 완료 처리에서 제출된 답변마다 `answer_evaluations` 행(+ 진행 중 `evaluate done`에 맞춰 부분 생성)과 `session_feedbacks` 행을 만들어 주세요. 지금은 새로 제출한 세션의 S-22 카드가 비어 있음. 픽스처 세션 3(채점 중)에도 질문·답변 행이 없어 S-22 부분 결과를 볼 수 없음.
2. **답변별 다시 채점 API**: `not_scored` 질문 하나만 다시 채점하는 데이터 함수/액션(예: `retryAnswerEvaluation(answerId)`). 지금은 세션 채점 작업 전체를 재시도.
3. **mock 질문 생성 실패 후 재시도**: `generation_status='failed'` 세션을 `retryAiJob`으로 다시 돌릴 때 세션 `generation_status`를 `generating`으로 되돌려 주세요(지금은 완료 시점에만 `ready`로 바뀜. 화면은 작업 상태로 보정 중).
4. **A3 타입 오류(빌드 차단)**: 아래 검사 결과 — A3 페이지들이 `<ErrorState kind={state}>`에 `PreviewState`를 그대로 넘겨 TS2322. `ErrorKind`로 좁히거나(`state === "unauth" ? "unauth" : "error"`), 파운데이션이 `ErrorState`에 좁히는 헬퍼를 두면 좋겠음.
5. (참고) C-05 `CardRadio`가 `has-[:checked]`만 써서 radix RadioGroup(버튼, `data-state="checked"`)에서는 선택 강조가 안 될 수 있음. A4는 `has-data-[state=checked]`를 함께 씀.

## 검사 결과

- `pnpm lint` — **A4 파일 오류·경고 0** (`eslint src/components/interviews src/components/board` + A4 라우트 통과). 전체 실행은 다른 영역 파일 때문에 실패: `src/app/(dashboard)/career/page.tsx:30`(A2), `src/components/applications/drafts-view.tsx:164` `react-hooks/set-state-in-effect`(A3), 경고 `src/components/career/project-form.tsx:26`(A2).
- `pnpm typecheck` — **A4 파일 오류 0**. 전체는 A3 파일 TS2322로 실패: `applications/[id]/page.tsx:44`, `[id]/jd/page.tsx:56`, `[id]/insight/page.tsx:48`, `[id]/drafts/page.tsx:47`, `[id]/drafts/[draftId]/questions/page.tsx:56` — `Type '(string & {}) | "error" | "unauth"' is not assignable to type 'ErrorKind'`.
- `pnpm build` — 컴파일 성공, 같은 A3 TS2322로 "Failed to type check"에서 중단(A4 원인 없음).
- 추가 확인: `next dev`(포트 3417)에서 A4 라우트 19개를 `?state=` 포함 요청 → 모두 200, 화면별 핵심 문구 렌더 확인(보드 열·결과 배지·카드 메뉴, S-37 작성 중·그만둔 면접·빈 상태 2종, S-20 C-09·한도·세션 목록, S-33 생성 중·실패·그만둔 세션, S-22 점수 준비 중·scored·응답 0개·채점 중 C-03), 제출된 세션의 S-33 → S-22 redirect 확인, 개발 로그 오류 0건. 브라우저 상호작용(드래그, 다이얼로그, 자동 저장, 폴링)은 확인하지 않음.

---

## 라운드 1 수정 (QA `03_ui-qa_A4_review.md` 반영, 2026-10-25)

### 이슈별 처리

| ID | 심각도 | 처리 | 내용 |
|----|--------|------|------|
| UQ-40 | Major | 수정 | S-22: 감시할 채점 작업을 상태(`watch`)로 바꾸고, 감시는 `EvaluationWatcher`(key로 재마운트 → 같은 작업 id도 폴링 재시작)가 맡는다. "다시 시도"(채점 실패)와 "다시 채점"(완료 세션의 `not_scored` 답변)은 새 영역 액션 `retryEvaluationAction`을 호출: 세션의 `interview_evaluation` 작업이 있으면 `retryAiJob`(실패 단계부터), 없으면 `startAiJob`(무차감, `reserve_units: 0`). 이어서 C-03 진행 표시 → 끝나면 `router.refresh()`. 다시 실패하면 ST-AI-FAILED 다시 표시. `?state=ai-failed` 미리보기에서도 다시 시도하면 실제 작업이 돈다. 요청 실패 시 토스트 [UI-가정]. 질문 하나만 다시 채점하는 API는 여전히 없어 세션 전체 재채점(파운데이션 요청 2 유지) |
| UQ-41 | Major | 수정 | S-33 답변란 `maxLength=5000` + 붙여넣기도 5,000자에서 자름, 글자 수 표시를 공통 `CharCount`로 "n / 5,000자"(90% 이상 경고 색) — 04 A.13 |
| UQ-42 | Minor | 수정 | S-33 폴링 조건: 작업이 있으면 `queued`/`running`일 때만, 작업이 없으면 `generation_status='generating'`일 때만 → 실패 화면에서 무한 호출 없음. "다시 시도"는 새 영역 액션 `retryQuestionGenerationAction`(AI-05 작업 재개, 없으면 무차감으로 새 작업). 재시도 중 서버 행이 아직 `failed`면(UQ-49) 작업이 도는 동안 화면에서 `generating`으로 보정 |
| UQ-43 | Minor | 수정 | S-20 "그만두기", C-16 "그만두고 새로 시작"에 `catch` + 토스트 "그만두지 못했어요. 잠시 후 다시 시도해 주세요" [UI-가정]. 실패 시 확인 창/단계는 열린 채 유지 |
| UQ-44 | Minor | 수정 | C-16 "그만두고 새로"도 확인을 거친다. 다이얼로그 위 다이얼로그를 피해 같은 다이얼로그 안의 확인 단계로 표시(S-20과 같은 제목·설명, 버튼 "취소" / "그만두고 새로 시작"(destructive)) |
| UQ-45 | Minor | 수정 | 리더 결정대로 768px 미만에서 A4의 모든 조작 요소 44px 이상: 보드 열 탭 `h-11`(md 이상 `h-9`), 보드 카드 ⋯(공통 `StageCardMenu` 트리거를 감싼 요소에서 `max-md:[&>button]:size-11`, 수화 전 자리 버튼도 같은 크기), S-37·S-20 세션 행 ⋯ `max-md:size-11`, S-37 필터 Select·새 면접·이어서 쓰기·그만둔 면접 펼치기, S-20 배너 버튼·질문 수 토글·그만두기 확인, S-33 제출·제출하기, S-22 펼치기·다음 연습·새 면접 시작하기, C-16 목록 행(`min-h-11`)·버튼, S-39 빈 상태 버튼. 넓은 화면은 기존 `icon-sm`·`sm` 유지 |
| UQ-46 | Minor | 해당 없음(ui-designer/파운데이션) | 리더 결정을 A4 범위에서 감싸는 요소로 반영(UQ-45). 공통 `StageCardMenu` 자체 크기 변경은 파운데이션 몫 |
| UQ-47 | Minor | 수정 | C-16에서 작성 중 세션 분기·확인 단계로 바뀌면 새 내용의 주 버튼("이어서 쓰기" / "그만두고 새로 시작")으로 포커스 이동(ref + effect). 브라우저 확인은 아직 안 됨 |
| UQ-48, UQ-49 | — | 손대지 않음 | 파운데이션 배치 대기(`lib/` 수정 금지). 새 API가 생기면 `retryEvaluationAction`/`retryQuestionGenerationAction`과 S-33의 `generating` 보정을 바꿀 예정 |

### 바뀐 파일

- `src/components/interviews/actions.ts` — `retryEvaluationAction`, `retryQuestionGenerationAction` 추가(`lib/data/ai-jobs`의 `retryAiJob`·`startAiJob` 호출만, lib 수정 없음)
- `src/components/interviews/result-view.tsx` (UQ-40, UQ-45), `answer-sheet.tsx` (UQ-41, UQ-42, UQ-45), `jd-picker-dialog.tsx` (UQ-43, UQ-44, UQ-45, UQ-47), `interview-prep.tsx` (UQ-43, UQ-45), `interviews-overview.tsx`·`session-list.tsx` (UQ-45)
- `src/components/board/kanban-board.tsx`, `src/app/(dashboard)/board/page.tsx` (UQ-45)

### 새 [UI-가정]

| 화면 ID | 파일 | 내용 |
|---------|------|------|
| S-22 | `result-view.tsx` | 재채점 요청 실패 토스트 문구. 재채점 작업이 없으면 무차감 새 작업으로 시작 |
| S-33 | `answer-sheet.tsx` | 질문 재생성 요청 실패 토스트 문구. 작업이 없으면 무차감 새 작업으로 시작 |
| S-20, C-16 | `interview-prep.tsx`, `jd-picker-dialog.tsx` | 그만두기 실패 토스트 문구, C-16 확인 단계 문구 |

### 검사 결과 (라운드 1)

- `pnpm typecheck` — 통과(exit 0)
- `pnpm lint` — 통과(오류·경고 0, 전체 프로젝트). A4 파일 별도 실행도 0
- `pnpm build` — 통과(exit 0)
- `next dev -p 3418`: S-39, S-37, S-20, S-33(기본·`ai-failed`), S-22(기본·`ai-failed`) 200, S-33 답변란 "n / 5,000자" 렌더 확인, 개발 로그 오류 0. 브라우저 상호작용(다시 시도 후 폴링, C-16 포커스 이동, 44px 대상)은 아직 확인 안 됨

---

## BYOK 반영 (2026-10-28)

기준: `_workspace/ui/05_brief_byok.md`, design-system v2(3.3 C-03 무료 등급·대기 줄, 3.18 C-18 + C-14 키 없음 변형, 3.19 C-19, 3.20 C-20, 3.22 AiRunButton, 6 A4), A0 보고 "BYOK 파운데이션 (2026-10-28)", 플로우 v5.2(S-20·S-33·S-22·S-37·S-39, C-14·C-16·C-17·C-18~C-20, FL-12·16·17·19·21), AI v4.2, 데이터 모델 v4.1a. 파운데이션이 먼저 한 기계적 정리(UsageHint·AiFailed 제거, 제출 AiRunButton, previewErrorCode)를 이어받아 다듬었다. 점수 산식 없음(D-14) 유지. 커밋하지 않음.

### 화면별 반영

| 화면 | 반영 |
|------|------|
| S-20 면접 준비 | 시작하기 = `AiRunButton`(`interview_new`, C-19 배지 / 키 없음 C-18 인라인 / 키 무효 C-20 `key_invalid`). **무료 등급이면 시작하기 위 `Alert info` "질문을 하나씩 만들어 조금 더 걸려요"**(02 S-20, design-system 6 A4). 서버에서 `getAiConnection()`을 받아 넘겨 첫 화면부터 배지·잠금·안내가 맞게 보임. **D-30**: JD 요건이 없으면(`extraction_status` pending·failed) 시작할 때 `runJdExtraction` → 질문 생성 순서(영역 액션), 안내 한 줄 [UI-가정]. ST-WAIT-JD는 추출 `running`일 때만. 세션 목록에 **"실행 공급자" 열**. 키 없이도 세션 목록·작성 중 배너(이어서 쓰기·그만두기)는 그대로(D-36) |
| S-33 답변지 | 질문 생성 중 = C-03 `AiProgress`(`interview_questions`, C-19 배지 + 무료 등급 순차 줄 + 요청 한도 대기 줄, 작업의 `connection_tier`) + 질문이 차례로 채워짐. 생성 실패 = C-20 block(원인 7종 + 시스템·입력, `job.provider`·`retry_after`·`quota_resets_at`, "다시 시도하면 토큰을 다시 써요"). **ST-AI-KEY-MISSING**: 키 삭제로 끝나면 C-20 `key_missing`(AI 연결하기), 저장된 질문·답변 보존. 키가 없어진 뒤 다른 원인 실패면 다시 시도 대신 C-18 인라인 [UI-가정 문구]. 제출 = `AiRunButton`(`interview_submit`): 키 없음 C-18 인라인("제출하면 연결한 AI로 채점해요…"), 키 무효 C-20 `key_invalid`, **답변 작성·자동 저장은 키와 무관**. "무차감" 주석 삭제 |
| S-22 결과 | 머리 오른쪽 **C-19 결과 배지**(`ProviderResultTag`: `evaluation_provider`(없으면 `question_provider`) + 평가 행의 `model_tier`, 모델 ID는 툴팁), 질문·채점 공급자가 다르면 "실행 공급자: 질문 … · 채점 …" 한 줄. 채점 중 C-03에 작업 등급(무료 순차 줄·대기 줄). 채점 실패 = 상단 C-20 block(재시도한 작업의 공급자·시각 반영) + "다시 채점". 키 없음이면 다시 채점 자리에 C-18 인라인, 키 무효면 누를 때 C-20 `key_invalid`(실행 안 함). 답변별 `not_scored` = `AiRunButton`("다시 채점", rerun 주석 "다시 하면 공급자 토큰을 다시 써요", C-19 배지, 파운데이션 `retryAnswerEvaluationAction`). 평가 실패 답변 카드에 원인 없는 한 줄(`AiFailedInline`). 결과 열람은 키 없이 가능 |
| S-37 모의 면접 | 새 면접 = `AiRunButton`(`interview_new`, 키 없음 C-18 인라인 → 목록 열람은 그대로, 키 무효 C-20, 정상 → C-16). 세션 0개면 버튼을 빈 상태에만 둠(잠금 상자 중복 방지). **"실행 공급자" 열**(좁은 화면 카드에서는 "질문 … / 채점 …" 두 줄) + **실행 공급자 필터**(02 S-37 `[가정]`, 세션에 쓰인 공급자만) |
| S-39 보드 | 인터뷰 열 이동 시 공통 `InterviewPromptDialog`가 키 없음이면 **C-14 키 없음 변형**(`AiLockDialog`, 복귀 대상 S-20 `?type=`, 닫아도 이동 유지). 보드 코드는 공통 컨트롤러를 쓰므로 추가 코드 없음. `?state=ai-locked` 문서화 |
| C-16 | 변경 없음(AI 없음). 키 없음이면 S-37 새 면접 버튼이 잠겨 열리지 않음(FL-17) |
| 공통 | A4 파일에서 차감·남은 횟수·한도 UI 문구 0건(주석만 "무차감 규칙 폐기" 기록). 자동 실행 없음 — FL-19 복귀 후 `AiRunButton`이 링 4초 + 토스트만 |

### `?state=` (BYOK 추가분)

| 화면 | 값 |
|------|-----|
| S-20 | `ai-locked` · `key-invalid` · `key-check` · `ai-waiting`(시작한 질문 생성이 요청 한도 대기를 거침 → S-33 C-03 대기 줄) · `key-missing` 및 `ai-failed`·`-input`·`-timeout`·`-rate-limited`·`-daily-quota`·`-billing`·`-key-invalid`·`-model`·`-provider`·`-input-rejected`(시작한 질문 생성이 그 원인으로 실패 → S-33) |
| S-33 | `ai-locked`(제출 잠금) · `key-invalid` · `key-check` · `key-missing` · C-20 원인 전부(위 목록) · 기존 `ai-pending`·`save-failed` |
| S-22 | `ai-locked`(다시 채점 잠금 — `not_scored`·실패 세션에서 보임) · `key-invalid` · `key-check` · `key-missing` · C-20 원인 전부 · 기존 `ai-pending`·`scored`·`no-answers` |
| S-37 | `ai-locked` · `key-invalid` · `key-check` (+ 기존 `empty`·`no-jd`) |
| S-39 | `ai-locked`(카드를 인터뷰 열로 옮기면 C-14 키 없음 변형) |

### 새 [UI-가정]

| 화면 | 파일 | 내용 |
|------|------|------|
| S-20 | `interview-prep.tsx` | D-30 안내 "공고 요건을 먼저 정리한 뒤 질문을 만들어요". 추출 실패 JD도 시작 시 다시 추출 |
| S-33 | `answer-sheet.tsx` | 키가 없어진 뒤 생성 실패 자리의 C-18 설명 "남은 질문을 만들려면 AI를 연결해 주세요. 만든 질문과 답변은 그대로 있어요". 생성 헤더를 C-03 카드로 바꿈(제목 "면접 질문 생성 진행 중", 무료·대기 줄을 보이려고) |
| S-22 | `result-view.tsx` | 다시 채점 잠금 설명 "다시 채점하면 연결한 AI로 채점해요. 작성한 답변은 저장돼 있어요"(C-18 표에 다시 채점 행 없음), 평가 실패 답변 카드 한 줄 "이 답변은 채점하지 못했어요"(`answer_evaluations`에 `error_code` 없음) |
| S-20·S-37 | `session-list.tsx` | 세션에 `model_tier`가 없어 "실행 공급자" 열은 "{공급자} · 기본" |
| S-37 | `interviews-overview.tsx` | 실행 공급자 필터 = 세션에 쓰인 공급자만, 질문·채점 어느 쪽이든 일치 |

### 기획 확인 필요

| 화면 | 질문 | 스펙 위치 |
|------|------|-----------|
| S-20·S-37·S-22 | 세션 "실행 공급자" 글자의 단계 이름(경량/기본/고성능): `interview_sessions`에 `model_tier`가 없음(`question_model`·`evaluation_model`만). 지금은 "기본" 고정 | 02 C-19 "면접 세션의 실행 공급자", S-20 "`interview_sessions.provider` `[확인 필요]`", 04 v4.1 |
| S-22 | 다시 채점 잠금(C-18)의 기능 설명 문구 — C-18 진입점 표에 없음 | 02 C-18 표, S-22 |
| S-37 | 키 무효일 때 "새 면접"이 C-16 선택조차 막는 게 맞는지(지금은 AiRunButton 규칙대로 누르면 C-20 `key_invalid`). FL-16은 무효 키를 "있음" 경로로 보내고 S-20 시작 때 C-20을 보임 | 02 FL-16, FL-17, 실행 버튼 공통 규칙 |
| S-33 | 질문 생성 중 키가 없어진 경우 외의 실패를 키 없이 볼 때 다시 시도 자리 처리 | 02 S-33 (v5) |

### 파운데이션 요청

1. **`submitInterviewSession` 키 확인 순서**: mock이 세션을 `submitted_at`·`evaluating`으로 바꾼 **뒤** `createMockJob`에서 `key_missing`을 던진다. 키가 없거나 그 사이 삭제되면 세션이 작업 없이 제출 상태로 남는다. 키 확인을 먼저 하거나, 작업 생성 실패 시 `evaluation_failed` + `error_code = key_missing` 작업 행을 남겨 주세요(지금 화면은 제출 버튼을 C-18로 막아 피함).
2. **세션 `model_tier`**: "실행 공급자" 글자에 단계 이름을 쓰려면 `interview_sessions`(또는 `InterviewSessionRow`)에 질문·채점 작업의 `model_tier`가 필요.
3. **`answer_evaluations` 실패 원인**: 실패한 답변 카드에 C-20 inline을 원인별로 보이려면 평가 행(또는 답변별 재채점 작업)에서 `error_code`를 알 수 있어야 함.
4. (선택) `submitInterviewSession`에 `rate_wait` 옵션 — S-22 채점 대기 줄을 `?state=ai-waiting`으로 바로 보려면.

### 검사 결과 (BYOK)

- `pnpm typecheck` — 통과
- `pnpm lint` — 통과(오류·경고 0, 전체)
- `pnpm build` — 통과(39 페이지)
- `next dev -p 3419`(확인 후 종료): S-20(기본 — 무료 등급 안내·실행 공급자 열 / `ai-locked` C-18 / `key-invalid` 경고 배지), S-33(`ai-locked` 제출 잠금 문구, `key-missing`, `ai-failed-daily-quota`, `ai-pending` C-03), S-22(기본 결과 배지·점수 준비 중 / `ai-failed-provider` + 다시 채점 / `key-missing`), 채점 중 세션 C-03, S-37(실행 공급자 열·새 면접 / `ai-locked`), S-39 `ai-locked` 모두 200·문구 렌더 확인, 개발 로그 오류 0. 브라우저 상호작용(C-14 키 없음 팝업 실제 표시, FL-19 복귀 링·토스트, RetryButton 카운트다운, 대기 줄 카운트다운)은 확인하지 않음

---

## BYOK 라운드 1 수정 (QA `06_ui-qa_byok_A4_review.md`, 2026-10-28)

기준: QA UQ-320~326, A0 보고 "BYOK 파운데이션 배치 (2026-10-28)"(거절 반환 `{rejected}`, `retryAiJob` 모든 원인 재시도·활성 공급자로 재고정, `AiErrorNotice` 재연결 시 다시 시도, 세션 `question_model_tier`/`evaluation_model_tier`, `questions[].evaluation_error`, 제출 `rate_wait`, 서버 쪽 D-30 `ensureJdRequirementsInDb`). 커밋하지 않음.

### 이슈별 처리

| ID | 심각도 | 처리 | 내용 |
|----|--------|------|------|
| UQ-320 | Major (파운데이션) | 재현 확인 | dev(3421)에서 임시 라우트로 재현(확인 후 삭제): 새 세션(클라우드나인, 컬처핏 3문항) → 질문 준비 → 답변 1개 저장 → `deleteProviderKey("gemini")` → `submitInterviewSessionAction` = `{rejected: "key_missing"}`, 세션 `in_progress`·`submitted_at null`·답변 3개 모두 `draft`·저장한 답변 글자 그대로. 동의 기록 + 키 재연결 → 다시 제출 = `{job_id}`, 세션 `evaluating`, 답변 `submitted`/`unanswered`. **화면**: 거절되면 S-33 제출 자리에 C-20 `key_missing` inline(AI 연결하기)이 뜨고 답변은 계속 편집·자동 저장된다. 키가 돌아오면 다시 제출 버튼 |
| UQ-321 | Major | 수정 | S-33 질문 생성: `key_missing` 실패에도 `onRetry`를 넘김 → 키를 다시 연결해 돌아오면 같은 자리에 "다시 시도"(남은 질문 다시 만들기, 파운데이션 `AiErrorNotice` 재연결 분기). S-22 채점: `key_missing`·`key_invalid` 실패가 재연결로 풀리면 C-20 안의 "다시 채점"(+ C-19 배지 줄). 둘 다 **자동 실행 없음**, 사용자가 눌러야 재시도(FL-21·D-UX-16) |
| UQ-322 | Minor | 수정 | 영역 액션의 `runJdExtraction` 선행 호출 삭제 → 서버 `startInterviewSession`이 같은 호출에서 요건 추출을 끝낸 뒤 질문 작업을 만든다(파운데이션 `ensureJdRequirementsInDb`). S-20 문구를 동작에 맞춤: 대기 "공고 요건을 먼저 정리한 뒤 질문을 만들어요", 누른 뒤 "공고 요건을 정리하고 있어요. 끝나면 질문을 만들어요"(`role=status`) [UI-가정]. **추출 실패**면 질문을 만들지 않고 시작하기 아래 C-20(예: `not_a_jd` → "입력 화면으로" = S-15, 다시 시도 = 다시 시작). 미리보기 `?state=extract-failed`(영역 액션이 dev에서만 `{extraction_failed}` 반환). mock 추출은 스스로 실패하지 않음 → 파운데이션 요청 |
| UQ-323 | Minor | 수정 | S-22 세션 단위 "다시 채점" = `AiRunButton`(rerun 주석 "다시 하면 공급자 토큰을 다시 써요" + C-19 배지, 키 없음 C-18 인라인, 키 무효 C-20). `rate_limited`·`provider_unavailable`이면 `retry_after`까지 비활성 + "다시 채점 (m:ss)". C-20 블록 자체의 다시 시도 버튼은 쓰지 않는다(위 UQ-321 재연결 경우만 예외, 배지 함께) |
| UQ-324 | Minor | 수정 | S-33·S-22 페이지가 `getAiConnection()`을 넘기고(`serverConnection`), 컴포넌트는 `useAiConnection(serverConnection)` + 모든 `AiRunButton`에 `connection` → 첫 렌더부터 제출·다시 채점 잠금/배지가 맞다. dev SSR 확인: `?state=ai-locked`에서 S-33 첫 HTML에 C-18 "제출하면 연결한 AI로 채점해요" |
| UQ-325 | Minor | 수정 | 작업 행이 없는 미리보기: C-20 `provider` = 작업 → 없으면 활성 연결 공급자, C-03 `connectionTier` = 작업 → 없으면 활성 연결 등급. dev 확인: S-33 `ai-failed-daily-quota` "오늘 Gemini 무료 한도를 다 썼어요" + "Gemini 대시보드", `ai-failed-provider` "Gemini 상태 페이지", S-22 `ai-failed-billing` "Gemini 결제 설정", S-33·S-22 `ai-pending` "무료 등급이라 하나씩 처리해요" |
| UQ-326 | Minor (파운데이션) | 해당 없음 | 파운데이션이 `AiLockDialog onConnect`로 처리 |
| 추가 | — | 수정 | "실행 공급자" 열: `providerRunLabel(row)`가 세션의 `question_model_tier`/`evaluation_model_tier`를 쓴다(이전 "기본" 고정 [UI-가정] 해소). S-22 결과 배지 단계도 세션 tier 우선. S-22 실패 답변 카드: `questions[].evaluation_error`가 있으면 원인별 C-20 inline(공급자·시각), 원인 모를 때만 한 줄 |

### 바뀐 파일

- `src/components/interviews/actions.ts` — D-30 선행 추출 삭제, `extraction_fail` 미리보기, 반환형 명시
- `src/components/interviews/interview-prep.tsx` — 추출 실패 C-20, 진행 문구
- `src/components/interviews/answer-sheet.tsx` — `serverConnection`, 공급자·등급 대체값, 제출 거절 시 C-20 `key_missing`
- `src/components/interviews/result-view.tsx` — `serverConnection`, `SessionRescore`(AiRunButton), 재연결 다시 채점, 세션 tier, 답변별 실패 원인
- `src/app/(dashboard)/applications/[id]/interview/page.tsx` — `?state=extract-failed`
- `src/app/(dashboard)/applications/[id]/interview/[sessionId]/page.tsx`, `.../result/page.tsx` — 서버 연결 상태 전달

### 새 [UI-가정]

| 화면 | 내용 |
|------|------|
| S-20 | 요건 추출 진행 문구 "공고 요건을 정리하고 있어요. 끝나면 질문을 만들어요"; 추출 실패 C-20의 다시 시도 = 시작하기 다시 누름 |
| S-33 | 제출 거절(`key_missing`)이면 제출 자리를 C-20 inline으로 바꿈(토스트와 함께) |
| S-22 | `rate_limited`·`provider_unavailable` 다시 채점 버튼 카운트다운 글자 "다시 채점 (m:ss)"(RetryButton 형식을 따름) |

### 파운데이션 요청

1. mock 요건 추출 실패 주입: `ensureJdRequirementsInDb`/`startInterviewSession`에 추출 실패 옵션(예: `extraction_fail`)과 실패 시 거절 반환(`{rejected}` 또는 별도 형태)을 정해 주세요. 지금 S-20 `?state=extract-failed`는 영역 액션이 dev에서만 흉내 낸다. 실제 반환 형태가 정해지면 화면 분기를 그에 맞춘다
2. (참고) `notifyAiRejected`의 `key_missing` 토스트가 "AI 연결하면 사용할 수 있어요"라서, S-33 제출 거절 때 C-20 `key_missing` 제목("키가 삭제되어…")과 문구가 다르다. 토스트를 C-20 제목으로 통일할지 디자이너 확인

### 검사 결과

- `pnpm typecheck` 통과 · `pnpm lint` 통과(오류·경고 0) · `pnpm build` 통과(39 페이지)
- 임시 재현 라우트 삭제 후 `.next/dev/types`를 dev 재시작으로 다시 만들어 남은 참조 없음 확인
- `next dev -p 3421`(확인 후 종료): S-33 기본·`ai-locked`·`ai-failed-daily-quota`·`ai-failed-provider`·`ai-pending`, S-22 `ai-failed-billing`·`ai-failed-daily-quota`·`ai-locked`·`ai-pending`, S-20 `extract-failed`, S-37 모두 200·문구 확인. 브라우저 클릭 흐름(재연결 후 다시 시도 → 폴링, 카운트다운)은 확인하지 않음
