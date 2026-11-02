# UI QA — A4 면접·보드 (라운드 1)

기준: 플로우 v4.2b · AI v3.2a · 데이터 모델 v3.2a · 디자인 시스템 v1 · A0 보고 · A4 보고(2026-10-25). 리뷰 일자 2026-10-25.
이슈 ID: A2·A3 리뷰가 병렬로 진행 중이라 충돌을 피하려고 A4는 **UQ-40부터** 사용(UQ-26~39는 비워 둠).

## 요약 — Critical 0 / Major 3 / Minor 7

- 기계 검사: `pnpm typecheck` 통과, `pnpm build` 통과(36 라우트), `pnpm lint` 실패 1건 — A2 파일(`src/app/(dashboard)/career/page.tsx:30` `react-hooks/purity`)만, A4 파일 오류·경고 0.
- 개발 서버(`next dev -p 3471`)에서 A4 라우트 38개를 `?state=` 포함 요청 → 전부 200, 개발 로그 오류 0. 제출된 세션 S-33 → S-22, 미제출 세션 S-22 → S-33 redirect 확인. `not-found`는 404 폴백 렌더 확인.
- **브라우저 확인 불가**: Claude in Chrome 확장이 연결되지 않아 실제 키보드 드래그, 다이얼로그 포커스, 자동 저장·폴링 동작은 확인하지 못했다. 해당 항목은 코드 경로 판독 결과이며, 리더 또는 사람이 브라우저에서 확인해야 한다(아래 "브라우저 확인 필요").
- 소유 범위: A0 리뷰 이후 수정된 파일 중 커리어·기업 JD 폴더 밖은 모두 A4 폴더(`components/interviews`, `components/board`, `(dashboard)/interviews`, `(dashboard)/board`)뿐. `components/common`, `lib`, `types` 수정 없음. C-05·C-09·C-12~C-14·C-17은 공통 컴포넌트 import(재구현 없음).
- D-14: 점수 산식 없음 확인. 화면은 저장된 `score_*` 슬롯만 표시하고, `?state=scored`의 72/100·4/5는 미리보기 전용 오버라이드(`result/page.tsx:32-48`).

## 화면별 점검표

| 화면 ID | Q1 스펙 행 | Q2 문구 | Q3–4 타입·필드 | Q5 라우트 | Q6 상태 | Q7 AI 모드 | Q8 디자인 | Q9 접근성 | Q10 좁은 화면 |
|---------|-----------|---------|----------------|-----------|---------|-----------|-----------|-----------|--------------|
| S-20 면접 준비 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ UQ-43 | ✅ |
| S-33 면접 답변지 | ✅ | ✅ | ⚠️ UQ-41 | ✅ | ⚠️ UQ-42 | ✅ | ✅ | ✅ | ✅ |
| S-22 면접 결과 | ⚠️ UQ-40 | ✅ | ✅ | ✅ | ❌ UQ-40, UQ-48 | ⚠️ UQ-40 | ✅ | ✅ | ✅ |
| S-37 모의 면접 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (C-03 축약형) | ✅ | ⚠️ UQ-45 | ⚠️ UQ-45 |
| C-16 기업 JD 선택 | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ⚠️ UQ-47 | ✅ |
| S-39 지원 현황 보드 | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ⚠️ 브라우저 미확인, UQ-46 | ⚠️ UQ-45, UQ-46 |

### 확인한 주요 일치 사항

- **S-20**: 진입 안내 문구 "지원 현황에서 {직무 인터뷰 / 컬처핏} 전형으로 옮겼어요. {직무 면접 / 컬처핏 면접}이 선택돼 있어요" 렌더 확인(`?type=culture_fit&state=from-board`). 유형 기본 선택 없음, `?type=` 미리 선택·변경 가능(`interview-prep.tsx:89,197`). 질문 수 3/5/7 기본 5. 직무 + `job_interview.ready=false` → C-09 + "컬처핏 면접은 지금 바로 연습할 수 있어요", 컬처핏 thin/none → "입력된 커리어가 적어 일반 질문 비중이 높아요". ST-LIMIT(`매월 1일`, `0회 남음`), ST-WAIT-JD("공고 분석이 끝나면 시작할 수 있어요"). C-10 복귀 시 `consumeReturnParams(id,"job_interview")`로 유형·질문 수 복원. 세션 목록은 `created_at`·`interview_type`·`question_count`·상태 5종·C-17·새 결과 표시.
- **S-33**: 편집 조건 = 답변 `draft` + `submitted_at null` + `generation_status='ready'`(`answer-sheet.tsx:100-101,265`), 생성 중 "질문을 준비하고 있어요" + 답변란 비활성(D-UX-07 (a)), 유형 라벨은 세션 `interview_type`, 화면 머리 C-06 하나, G-2 안내, 하단 sticky "답변 a/N" + 제출, 제출 전 AlertDialog(미응답·50자 미만 경고). ST-AI-FAILED 3종 문구 + "사용량은 차감되지 않았습니다" + 다시 시도(무차감 안내) 렌더 확인.
- **S-22**: C-17 세션 `pending_method` "점수 산정 방식 준비 중" / 질문 "점수 준비 중" / `unanswered` "미응답" / 응답 0개 "답변이 없어 평가할 내용이 없어요" + "새 면접 시작하기", 고정 고지 문구 일치, `scored`에 "반영 질문 n개" + "산정 근거 보기". `unanswered_count`, 다룬 보완 요건(`weak_requirement_ids` → `jd_requirements.content`), `data_sufficiency` 안내, 채점 중 C-03(`evaluate` "답변 채점 중") + 끝난 카드부터.
- **S-37**: 빈 상태 2종 문구 일치(기업 JD 없음 → S-14 / 세션 없음), 작성 중 고정 카드, 필터 3종(기업 JD·유형·상태), 최신순, 상태 배지 5종(디자인 6 A4 매핑과 일치), "그만둔 면접" 접힘 묶음, 행 메뉴 삭제(C-05)·기업 JD로 가기(S-31), `setNavOrigin("interviews")`.
- **C-16**: 이름·전형 단계·D-day·"작성 중 면접" 배지, 최근 활동순(`listApplicationProjects` `last_activity_at desc`), 검색 placeholder 일치, 빈 상태 "기업 JD를 먼저 추가해 주세요" → S-14, 작성 중 세션 분기(FL-17).
- **S-39**: 6열 고정 순서, 열 머리 카드 수, `stage_changed_at desc` + 낙관적 이동 카드 맨 위, 카드 필드(회사명·포지션·D-day·인사이트 유무·초안 수·면접 수·작성 중·종료 결과 배지), 카드 클릭 → S-31 + `setNavOrigin("board")`, ⋯ = 공통 `StageCardMenu` + 기업 JD 열기 + 삭제(C-05), 지원 전 "+" → `/applications/new?from=board`, 빈 상태 문구·버튼 2개 일치, 모든 이동이 `useStageMove().request()` 경유(C-13/C-14/결과 지우기 확인/ST-MOVE-FAILED). 열 = `ul aria-label="{단계} {n}개"`, 카드 = `li`, dnd-kit 키보드 센서(Space/←→/Space/Esc) + 한국어 안내. 768px 미만: 열 탭 + 메뉴로만 이동, 드래그 비활성, 탭 목록만 가로 스크롤.
- **토큰**: A4 파일에서 raw 색(`#hex`, `rgb(`, `oklch(`, 팔레트 클래스) 0건. `max-w-3xl`·`max-w-[42rem]`은 디자인 시스템 1.4의 `max-w-form`·`max-w-prose-edit` 값과 같음.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-40 | Major | A4 | S-22 | 02 ST-AI-FAILED("모두 … + 다시 시도"), C-17 `not_scored`(질문) "채점 실패 + 다시 채점", 03 AI-06 "해당 답변만 재시도" | `src/components/interviews/result-view.tsx:85` (useAiJob 호출), `:102-110` (doRetry), `:132`, `:231`; `src/components/common/ai-progress.tsx:62-66` | 채점 실패 세션(`status='evaluation_failed'`)에서 "다시 시도", 완료 세션의 `not_scored` 답변에서 "다시 채점"을 누르면 채점 작업이 다시 실행된다 | `useAiJob`에 job id를 `evaluatingNow`일 때만 넘겨서(`evaluatingNow && !preview.pending ? job?.id : null`), 실패·완료 세션에서는 id가 null → `retry()`가 즉시 return → 버튼을 눌러도 `router.refresh()`만 하고 아무 일도 없다. 실패 상태에서 화면이 회복할 방법이 없음. `retryAiJobAction(job.id)`를 `job` prop으로 직접 부르거나 실패 시에도 id를 넘겨야 함 |
| UQ-41 | Major | A4 | S-33 | 04 A.13 `interview_answers.answer_text(≤ 5,000자)` | `src/components/interviews/answer-sheet.tsx:283-293` | 답변란이 5,000자 상한을 지키고 글자 수 표시에 상한을 보여 준다(예: `maxLength={5000}` + "n / 5,000자") | 상한 없음(보고서 [UI-가정] "상한 없음"). 실제 백엔드에서는 5,000자 초과 답변이 저장 실패로 계속 남아 제출이 막히거나(UQ 저장 실패 차단 토스트) 입력이 저장되지 않는다. mock은 길이 검사가 없어 드러나지 않음 |
| UQ-48 | Major | foundation | S-22 (FL-12 끝) | 02 FL-12 "S-22 점수 슬롯 + 답변별 평가 + 미응답 카드", 03 AI-06/AI-07 저장 | `src/lib/data/ai-jobs.ts` `syncEffects`의 `interview_evaluation` 완료 처리 (A4 보고 파운데이션 요청 1) | 새로 제출한 세션의 채점이 끝나면 `answer_evaluations`·`session_feedbacks` mock 행이 생겨 S-22에 평가가 보인다 | 평가 행이 생기지 않아 S-33 제출 → S-22 경로에서 카드마다 "평가 내용이 아직 없어요"만 표시. 픽스처 세션 3(채점 중)에도 질문·답변 행이 없어 부분 결과를 볼 수 없음. 화면 쪽 처리는 맞음 |
| UQ-42 | Minor | A4 | S-33 | 02 ST-AI-FAILED, 03 AI-05 "끝내 실패하면 세션은 생성 실패" | `src/components/interviews/answer-sheet.tsx:104` (polling 조건), `:134-138` (retry) | `generation_status='failed'`이고 작업 행이 없으면 실패 화면만 보이고 폴링은 멈춘다. 다시 시도는 실제 재생성 경로를 탄다 | 폴링 조건이 `generation_status !== 'ready'`이고 `job`이 null이면 계속 참 → 실패 화면을 띄운 채 2초마다 서버 액션을 무한 호출. 이때 다시 시도는 `router.refresh()`뿐 |
| UQ-43 | Minor | A4 | S-20, C-16 | design-system 4 (실패 시 표시), FL-04 | `src/components/interviews/interview-prep.tsx:141-151`, `src/components/interviews/jd-picker-dialog.tsx:50-61` | "그만두기"·"그만두고 새로"가 실패하면 토스트 등으로 알리고 다이얼로그 상태를 되돌린다 | `try/finally`만 있고 `catch`가 없어 실패 시 아무 안내 없이 처리되지 않은 Promise 거부가 남음 |
| UQ-44 | Minor | A4 | C-16 | 02 FL-17 "그만두고 새로", S-20 그만두기(`abandoned`) | `src/components/interviews/jd-picker-dialog.tsx:89-92` vs `interview-prep.tsx:302-319` | 같은 동작(작성 중 세션 `abandoned` 처리)은 같은 확인 수준을 따른다 | S-20 "그만두기"는 AlertDialog로 확인하지만 C-16 "그만두고 새로"는 확인 없이 바로 그만둔다. 둘 중 하나로 맞추거나 차이를 [UI-가정]으로 표시(되돌릴 수 없는 처리라 확인 권장, design-system 5.6) |
| UQ-45 | Minor | A4 | S-39, S-37, S-20 | design-system 7 A-4 "좁은 화면 터치 대상 44×44px 이상" | `src/components/board/kanban-board.tsx:277` (`TabsTrigger h-9`), `src/components/interviews/session-list.tsx:80` (행 메뉴 `icon-sm` = size-8) | 768px 미만에서 열 탭·행 메뉴 버튼이 44px 이상 | 탭 36px, 행 ⋯ 32px. 좁은 화면에서 보드 이동의 유일한 경로(메뉴)와 탭이 작다 |
| UQ-46 | Minor | ui-designer | S-39 (C-12) | design-system 3.11 "`Button variant="ghost" size="icon-sm"`" vs 7 A-4 "아이콘 버튼 `size-11` 또는 투명 확장 영역" | `src/components/common/stage-menu.tsx:351` | 좁은 화면 카드 ⋯ 크기 규칙이 하나로 정해져 있다 | 디자인 시스템 두 규칙이 충돌(3.11은 32px, A-4는 44px). 좁은 화면에서 C-12가 보드 이동의 유일한 경로이므로 규칙 확정 후 파운데이션 `StageCardMenu`에 반영 필요 |
| UQ-47 | Minor | A4 | C-16 | design-system 7 (다이얼로그 포커스), 02 FL-17 | `src/components/interviews/jd-picker-dialog.tsx:74-105` | 작성 중 세션이 있는 기업 JD를 고르면 바뀐 내용의 첫 버튼(또는 제목)으로 포커스가 옮겨진다 | 같은 `DialogContent` 안에서 목록을 분기 화면으로 바꾸므로 선택한 `CommandItem`이 사라지며 포커스가 body로 빠질 가능성이 높다(코드 판독, 브라우저 미확인). 분기 화면 진입 시 `autoFocus` 또는 ref focus 필요 |
| UQ-49 | Minor | foundation | S-33 | 03 AI-05 "남은 개수만 재생성", A4 보고 파운데이션 요청 3 | `src/lib/data/ai-jobs.ts` (`interview_questions` 재시도 처리) | `retryAiJob`으로 실패한 질문 생성 작업을 다시 돌리면 세션 `generation_status`가 `generating`으로 돌아간다 | 완료 시점에만 `ready`로 바뀌고 재시도 시 `failed`가 유지되어 화면이 로컬 상태로 보정 중(`answer-sheet.tsx:143`). 새로고침하면 실패 화면으로 되돌아갈 수 있음 |

## 기획 확인 필요

| 화면 ID | 내용 | 양쪽 인용 |
|---------|------|-----------|
| S-22 | 항목별 등급을 D-14 미정인 지금 보여도 되는가. 현재 "참고 평가 기준"으로 등급 배지를 항상 표시 | 02 S-22 "항목별 등급(`answer_evaluations.result.criteria[]`)과 다음 연습은 D-14 결과에 따라 표시" ↔ 03 4.2 "참고 평가 기준으로 유지. 용도: (1) 답변별 서술형 피드백의 근거" / design-system 3.16 "항목 등급 (D-14 결과에 따라 노출)" |
| S-33 | 답변 글자 수 상한 표시 여부(UQ-41과 연결). 데이터 모델은 5,000자 상한, 화면 명세는 글자 수 표시만 | 04 A.13 `answer_text(≤ 5,000자)` ↔ 02 S-33 "v3와 같음"(v3 명세 저장소에 없음) |
| S-33 | 질문 생성 중단(C-04 중단 버튼) 허용 여부와 중단 후 세션 상태 | 02 C-04 "중단은 `ai_jobs.cancel_requested_at`" ↔ 03 AI-05 중단 규칙 없음 |
| S-22 | 답변 하나만 "다시 채점"할 때 작업 단위·사용량. 현재 세션 채점 작업 전체를 재시도 | 02 C-17 "채점 실패 + 다시 채점" ↔ 03 AI-06 "해당 답변만 재시도" |
| S-20 | 작성 중 세션이 있을 때 "시작하기" 처리(현재 비활성 + 안내). unique 제약상 새 세션은 만들 수 없으나 명세에 화면 동작 없음 | 02 S-20 작성 중 세션 배너 "이어서 쓰기 / 그만두기" ↔ 04 A.12 `unique (application_project_id) where status = 'in_progress'` |
| S-37 | 그만둔 세션 행의 이동 대상(현재 S-33 읽기 전용) | 02 S-37 "→ S-22 / S-33" (상태별 대상 미정) |
| C-12 | 키보드 경로: 명세는 "카드에 포커스 후 Enter로 메뉴"인데, 카드 본문이 S-31 링크라 Enter는 S-31로 간다. 현재는 손잡이·링크·⋯ 버튼이 각각 포커스 대상 | 02 C-12 비고 "카드에 포커스 후 Enter로 메뉴" ↔ 02 S-39 카드 "클릭 → S-31, 드래그 손잡이, 메뉴(⋯)" |
| S-33 / S-22 | "v3와 같음" 세부 명세 부재(A4 보고와 같음) | 02 S-33 "v3와 같음 + 다음", S-22 "v3 구조 유지" |

## 브라우저 확인 필요 (이번 라운드 미확인)

1. S-39 키보드 드래그: 손잡이 포커스 → Space → ←/→ → Space 놓기 / Esc 취소, 놓을 수 있는 열 강조, 이동 후 aria-live "{카드}를 {단계}로 옮겼어요", 인터뷰 열 → C-14, 전형 종료 → C-13, 종료에서 나가기 → 결과 지우기 확인. `columnCoordinates`가 가로 스크롤된 보드에서도 대상 열 rect를 맞게 찾는지.
2. 768px 미만 보드: 열 탭 전환, 페이지 가로 스크롤 없음, 메뉴 이동.
3. S-33 자동 저장(800ms 디바운스, 이탈 시 flush), 질문 생성 폴링으로 차례로 채워짐, `?state=save-failed`에서 입력 후 C-06 실패형.
4. C-16 분기 후 포커스(UQ-47), 다이얼로그 닫힘 후 트리거로 포커스 복귀.

## 재확인 결과

라운드 1이라 해당 없음.

## 기계 검사 출력

- `pnpm lint` — 실패(exit 1). 오류 1: `src/app/(dashboard)/career/page.tsx:30:62` `react-hooks/purity`(`Date.now()` 렌더 중 호출, A2). 경고 1: `src/components/career/project-form.tsx:26:35` `RequiredMark` 미사용(A2). A4 파일 0건.
- `pnpm typecheck` — 통과(exit 0). A4 보고 당시의 A3 TS2322는 해소된 상태.
- `pnpm build` — 통과(exit 0). Next 16.4.2 Turbopack, 36 페이지, A4 라우트 5개 모두 Partial Prerender.
- `next dev -p 3471` — A4 URL 38개(S-20 13, S-33 8, S-22 7, S-37 5, S-39 5) 모두 200. 개발 로그 오류·경고 0. 서버 종료함.

---

# 라운드 2 (최종, 2026-10-25)

대상: A4 "라운드 1 수정"(`03_frontend-engineer-A4_report.md`)과 파운데이션 배치(Phase 3, `02_frontend-engineer-A0_report.md`). 리더 결정: 768px 미만 조작 대상 44px 이상, 넓은 화면은 `icon-sm` 유지.

## 요약 — 판정: **통과**

- 라운드 1 이슈 10건(UQ-40~49)은 모두 해결됐고 재발은 없다.
- 새로 나온 이슈는 Minor 2건(UQ-50, UQ-51)이다. Critical·Major는 새로 없다.
- 기계 검사: `pnpm lint`(오류·경고 0, 전체), `pnpm typecheck`, `pnpm build`(36 페이지) 모두 통과.
- 개발 서버(`next dev -p 3472`) 스모크: A4 URL 20개 모두 200, 개발 로그 오류 0. 서버는 종료했다.
- **제출 → S-22 경로 확인**: 세션 1(작성 중, 5문항)에 서버 액션으로 답변 1개를 저장하고 `submitInterviewSessionAction`을 호출했다. 응답 3개 · 미응답 2개였다.
  - 제출 직후 S-22에서 이미 첫 평가 카드가 보였다(부분 결과).
  - 약 2초 뒤 결과:
    - 평가 카드 3개(참고 평가 기준 · 개선 답변 예시)
    - 미응답 카드 2개("답변하지 않은 질문이에요")
    - 종합 피드백 · 다음 연습
    - 세션 "점수 산정 방식 준비 중", 질문별 "점수 준비 중" ×3
  - 같은 세션의 S-33은 S-22로 redirect됐다.
- 브라우저 상호작용(키보드 드래그, 다이얼로그 포커스, 다시 시도 후 폴링)은 이번에도 Chrome 확장이 연결되지 않아 코드 판독으로만 확인했다. 라운드 1 "브라우저 확인 필요" 4항목은 그대로 남는다.

## 재확인 결과

| ID | 결과 | 메모 |
|----|------|------|
| UQ-40 | 해결 | `result-view.tsx:89-139`. 감시 작업을 상태(`watch`)로 두고 `EvaluationWatcher`가 key로 다시 마운트된다. 실패 세션의 "다시 시도"는 `retryEvaluationAction`이 호출한다(작업이 있으면 `retryAiJob`, 없으면 무차감 `startAiJob`, `actions.ts:64-76`). `not_scored` 답변의 "다시 채점"은 파운데이션 `retryAnswerEvaluationAction`(그 답변만, 세션 상태 유지, `ai-jobs.ts:387-402`, `:375`)이 호출한다. 요청 실패 시 토스트 |
| UQ-41 | 해결 | `answer-sheet.tsx:53,305,313`. `maxLength=5000`(붙여넣기도 브라우저가 자름), 공통 `CharCount`로 "n / 5,000자" 표시. 렌더 확인 |
| UQ-42 | 해결 | `answer-sheet.tsx:115-119`. 작업이 있으면 queued/running일 때만, 작업이 없으면 `generating`일 때만 폴링한다. "다시 시도"는 `retryQuestionGenerationAction`(`actions.ts:82-94`, 무차감) |
| UQ-43 | 해결 | `interview-prep.tsx:148-150`, `jd-picker-dialog.tsx:62-65`. catch + 토스트, 실패 시 확인 창 유지 |
| UQ-44 | 해결 | `jd-picker-dialog.tsx:91-109`. 같은 다이얼로그 안의 확인 단계(S-20과 같은 제목·설명, "그만두고 새로 시작" destructive)로 처리 |
| UQ-45 | 해결 | 768px 미만에서 44px 이상: 보드 탭 `h-11 md:h-9`(`kanban-board.tsx:277`, 공통 `TabsList`도 `h-11`), 카드 ⋯ `max-md:[&>button]:size-11`(`:422`, 수화 전 자리 버튼 `:427`), 세션 행 ⋯ `max-md:size-11`(`session-list.tsx:80`). 필터·주요 버튼·C-16 행(`min-h-11`)도 확인 |
| UQ-46 | 해결 | 리더 결정(좁은 화면 44px / 넓은 화면 `icon-sm`)으로 규칙이 정리됐다. A4는 감싸는 요소로 반영했다. 공통 `StageCardMenu`(`stage-menu.tsx:351`)는 여전히 `icon-sm`이라 다른 영역(S-13·S-31)에서 쓸 때는 각자 감싸야 한다. 디자인 시스템 문서에 결정을 반영하는 것은 ui-designer 몫(참고) |
| UQ-47 | 해결(코드 판독) | `jd-picker-dialog.tsx:80-84`. 분기·확인 단계로 바뀌면 주 버튼으로 ref focus. 브라우저 미확인 |
| UQ-48 | 해결 | 파운데이션 `ai-jobs.ts:199-`. `evaluate done`이 오를 때마다 `answer_evaluations`가 생기고, 끝나면 `session_feedbacks`가 생긴다. 위 제출 → S-22 스모크로 확인 |
| UQ-49 | 해결 | 파운데이션 `retryAiJob`이 질문 생성 → `generation_status='generating'`, 채점 → `status='evaluating'`으로 되돌린다. S-33에는 `answer-sheet.tsx:157`의 로컬 낙관 표시만 남아 있는데, 서버 값과 같은 방향이라 문제없다 |

## 새 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-50 | Minor | A4 | C-16 | design-system 5.6(되돌릴 수 없는 결정은 `AlertDialog`), 7 A-3 | `src/components/interviews/jd-picker-dialog.tsx:81-84,104` | 그만두기 확인 단계에 들어가면 안전한 버튼("취소")에 첫 포커스가 간다(AlertDialog 관례, S-20 그만두기 확인과 같게) | 확인 단계 진입 시 destructive "그만두고 새로 시작"에 포커스를 준다. 분기 화면에서 Enter를 두 번 누르면 바로 그만두기가 실행될 수 있다 |
| UQ-51 | Minor | A4 | S-22 | 02 ST-AI-FAILED(세션 채점 다시 시도), 03 AI-06 | `src/components/interviews/actions.ts:65-66` | 세션 "다시 시도"는 세션 전체 채점 작업을 다시 돌린다 | 최근 `interview_evaluation` 작업을 그대로 `retryAiJob`한다. 마지막 작업이 답변별 "다시 채점" 작업(`params.answer_id`)이면, 이후 세션이 채점 실패가 됐을 때 "다시 시도"가 그 답변 하나만 다시 채점한다. `params.answer_id`가 없는 작업만 고르거나 새 세션 작업을 시작해야 한다(드문 경로) |

## 참고(이슈 아님)

- 픽스처 세션 3(채점 중)의 작업 12는 `mock_duration_ms` 10분이다. 화면에 첫 평가 카드가 나오기까지 수 분이 걸려, 스모크 20초 동안에는 C-03만 보였다. 부분 결과 자체는 새로 제출한 세션에서 확인했다.

## 기계 검사 출력 (라운드 2)

- `pnpm lint` — 통과(exit 0, 오류·경고 0). 라운드 1의 A2 오류는 해소됨.
- `pnpm typecheck` — 통과(exit 0).
- `pnpm build` — 통과(exit 0). Next 16.4.2, 36 페이지 생성.
- `next dev -p 3472` — S-20 6, S-33 3, S-22 4(+ 제출 세션 폴링), S-37 3, S-39 4 URL 모두 200. 로그 오류 0. 종료함.
