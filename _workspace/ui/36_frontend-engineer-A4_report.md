# 36 런 — A4(모의 면접·지원 현황) 프론트엔드 보고

- 기준: UX v5.13(C-17, S-22, S-33, S-37, C-14, S-39, FL-06·FL-12, 5.1i), decisions 3.18·4.12 UI 1·2·11, DM v4.11 11.6 #1~#6
- 수정 범위: 브리프 A4 소유 파일 + 새 파일 3개(`src/lib/data/interview-session-view.ts`, 테스트 2개). `src/server/**`·`src/lib/contracts/**`·`supabase/**`·생성 타입은 건드리지 않음. `src/types/db.ts`도 바꾸지 않음(스냅샷 필드는 view model `InterviewSessionRow`에만 붙임).
- 브라우저 확인: 하지 않음(브리프: 범위 밖, Google 로그인 전용). lint·typecheck·test만.

## 1. OD-I1·OD-I2 — C-17 점수 표시, S-22

| 파일:줄 | 바뀐 것 |
|---------|---------|
| `src/lib/data/interview-session-view.ts` (새 파일, 1~100) | 순수 함수. `sessionScoreView`(hidden / pending / not_scored / scored + `allUnanswered`), `answerScoreView`, `scorePoints`("{n}점"), `showsCriterionGrades`(질문 `scored`일 때만), `showsNextPractice`(세션 `scored`일 때만), `ALL_UNANSWERED_COPY = "답변이 없어 0점이에요"`, `SCORE_MAX_DEFAULT = 100` |
| `src/components/common/score-display.tsx` (전체) | 위 함수로만 그림. 세션 scored = **"{n}점 / 100"** + "반영 질문 {n}개" + 미응답이 있으면 " · 미응답 {n}개(0점으로 반영)". 모든 질문 미응답 = **"0점 / 100"** + "미응답 {N}개" + "답변이 없어 0점이에요" + (넘겨받으면) "새 면접 시작하기". `not_scored` = "점수를 계산하지 못했어요"(응답이 있는데 하나도 채점 못 했을 때만). `pending_method` = "점수 산정 방식 준비 중" / 질문 "점수 준비 중". 질문 `unanswered` = **"미응답 · 0점"**. 고지 "입력한 답변 기준 연습 점수예요. 합격 가능성을 뜻하지 않아요" 문구 그대로. `SessionScoreBadge`의 `startNewAction` prop 제거(목록 배지는 쓰지 않았음) |
| `src/components/interviews/result-view.tsx` 381~384, 707~730 | OD-I2: "참고 평가 기준"(항목 등급)은 그 질문 `score_status = 'scored'`일 때만, "다음 연습"은 세션 `scored`일 때만(`pending_method` 동안 숨김). 개선점·개선 답변 예시·종합 평가는 그대로 |
| `result-view.tsx` 651~652 | C-17 고지를 질문 점수 옆에도(질문이 `scored`일 때 카드 질문 아래) — 명세 `[가정]`(위치) |
| `result-view.tsx` 550 | S-22 입력 원인 실패 버튼 "이 기업 JD로 새 면접 시작" → **"이 자기소개서로 새 면접 시작"**(S-22 명세 문구) |
| `src/lib/data/interviews.ts` 359~370 | mock 제출: 응답 0개면 `not_scored` 대신 `scored`·0점·`score_max 100`·`d14.v1`·`score_counted_count = 질문 수`, 각 답변 `unanswered`·0점 (R-OD-3) |
| `src/lib/mock/fixtures.ts` 1264~1277, 1364~1367 | 세션 2(컬처핏 완료)를 d14.v1 `scored` 69점으로(양호·양호·보완 필요·해당 없음 → 68.75 → 69), 답변 6~8도 69점. 다른 완료 세션(10·11)은 `pending_method` 그대로(백필 전 행 미리보기) |
| `result/page.tsx` 107~160 | 미리보기: `scored`(72점 / 100, 미응답 0점), 새 `pending-method`, 새 `not-scored`, `empty`·`no-answers`를 0점 / 100으로 |

## 2. OD-I6 — 자기소개서 삭제됨 (S-37 · S-22 · S-33)

| 파일:줄 | 바뀐 것 |
|---------|---------|
| `interview-session-view.ts` 102~150 | `APPLICATION_DELETED_BADGE = "자기소개서 삭제됨"`, `DELETED_APPLICATION_NAME = "삭제된 자기소개서"`, `deletedApplicationName`(R-OD-12: "{회사} – {포지션}", 한쪽만 있으면 그 값, 둘 다 비면 "삭제된 자기소개서"), `DeletedApplicationFields`(`application_deleted?`, `company_name_snapshot?`, `position_title_snapshot?` — 모두 optional, 없으면 "삭제 아님"), `DELETED_APPLICATION_SEGMENT = "deleted"`, `sessionApplicationSegment` |
| `src/lib/data/interviews.ts` 40~45 | `InterviewSessionRow extends InterviewSession, DeletedApplicationFields`. `application_name`은 삭제된 세션이면 스냅샷 이름 |
| `interviews.ts` 75~92 (mock `row`) | mock 판정: 세션의 `application_project_id`가 `application_projects`에 없으면 삭제됨(행 타입이 null을 못 가져 지운 프로젝트 id를 남겨 둠). 스냅샷 필드 채움 |
| `interviews.ts` 118~130, 152~187 | `listInterviewSessions({ application_project_id: "deleted" })` = 삭제된 세션만. `getInterviewSession("deleted", id)` = 삭제된 세션만 찾음, 살아 있는 프로젝트 id로는 못 찾음 |
| `src/lib/data/interview-rows.ts` 102~121, 147~150, 189~195 (실제 분기) | `application_project_id`를 nullable로 읽고 null이면 `application_deleted: true`(지금 DB에선 생기지 않음). `"deleted"` 필터·상세는 `.filter("application_project_id", "is", null)`. 스냅샷 컬럼은 아직 select 안 함 → `// 연결 대기 (DM v4.11 11.6 #1~#6)` (아래 백엔드 요청) |
| `src/lib/mock/fixtures.ts` 60~69, 93, 148~149, 1305~1327, 1392~1394, 1401~1403, 1455~1456 | `MockInterviewSession` 타입(행 + 스냅샷 optional), `MockDb.interview_sessions`를 그 타입으로, `DELETED_AP_N = 90`. 세션 15: 지운 자기소개서(IDS.ap(90), 목록에 없음)의 `completed` 직무 면접, 스냅샷 "한빛소프트 – 백엔드 개발자", 46점(69·69·미응답 0), 질문 60~62·답변 60~62·평가 60~61 |
| `src/components/interviews/session-status.tsx` 71~95 | `sessionHref`: 삭제된 세션은 늘 S-22 `/applications/deleted/interview/{id}/result`. `ApplicationDeletedBadge` |
| `src/components/interviews/session-list.tsx` 162, 173~180, 246, 308 | S-37 행: 스냅샷 이름 + "자기소개서 삭제됨" 표식, 메뉴는 "삭제"만(자기소개서로 가기·다시 채점·종합 평가 다시 정리 없음), 이동 경로 origin 기록 안 함. 메뉴 "기업 JD로 가기" → S-37 명세 "자기소개서로 가기" |
| `src/components/interviews/interviews-overview.tsx` 93~102, 111~127, 183 | 필터 "자기소개서"에 **"삭제된 자기소개서"** 항목(삭제된 세션이 있을 때만, 그만둔 묶음에도 같은 필터). 자기소개서 0개여도 남은 세션이 있으면 빈 상태 안내 + 목록을 함께 보임(새 면접 버튼은 숨김) |
| `result/page.tsx` 224~280 | S-22: `deleted` 경로면 자기소개서 조회 없이 세션만 읽음. 이동 경로 "모의 면접 › {이름} · 자기소개서 삭제됨 › 면접 결과", 자기소개서 링크 없음. JD·형제 세션 조회 안 함 |
| `result-view.tsx` 116~117, 148, 216~221, 237~241, 262, 312~315, 372~377 | 읽기 전용: 다시 채점·종합 평가 다시 정리 버튼·카드 다시 채점 없음, "새 면접 시작하기"·"이 자기소개서로 새 면접 시작"·다음 연습 "면접 준비로" 없음, 머리 이름 옆 "자기소개서 삭제됨", "다룬 보완 요건"은 "원본 삭제됨" |
| `[sessionId]/page.tsx` 46~47 | S-33: `deleted` 경로면 S-22로 redirect(명세 "S-33으로 열리면 S-22로") |

## 3. 문구 잔여

| 파일:줄 | 전 → 후 |
|---------|---------|
| `src/components/common/stage-menu.tsx` 503 (+350 주석) | C-14 "이 기업 JD에 작성 중인 면접이 있어요" → "이 자기소개서에 작성 중인 면접이 있어요" |
| `src/components/board/kanban-board.tsx` 202 | 카드 메뉴 "기업 JD 열기" → "자기소개서 열기" |
| `kanban-board.tsx` 293, 369 | 지원 전 "+" "기업 JD 추가"(버튼·aria-label) → "자기소개서 추가" |
| `kanban-board.tsx` 315 | 삭제 토스트 "기업 JD를 삭제했어요" → "자기소개서를 삭제했어요" (`[UI-가정]` 명세에 자기소개서 삭제 토스트 문구는 없음, 용어만 교체) |
| `src/app/(dashboard)/(gated)/board/page.tsx` 82~92 | 빈 상태 "자기소개서를 추가하면 여기서 전형 단계를 관리할 수 있어요" + "자기소개서 추가" / "자기소개서 관리로" |

## `?state=` 추가

- S-22 `/applications/[id]/interview/[sessionId]/result`: `pending-method`(항목 등급·다음 연습 숨김), `not-scored`(응답 있음 + 모두 채점 실패), `application-deleted`(이 세션을 자기소개서 삭제됨 읽기 전용으로). `empty`·`no-answers`·`scored`는 새 규칙으로 바뀜.
- 실제 삭제된 세션 미리보기(mock): `/interviews`의 "한빛소프트 – 백엔드 개발자" 행, `/applications/deleted/interview/b01…15/result`(IDS.ses(15)).

## `[UI-가정]`

1. **라우트**: 삭제된 세션은 `application_project_id`가 없는데 S-22·S-33은 `/applications/[id]/interview/…` 아래. 명세가 정하지 않아 같은 라우트에 `[id] = "deleted"`를 쓴다(`DELETED_APPLICATION_SEGMENT`, `routes.ts`는 그대로). S-20 `/applications/deleted/interview`는 not found.
2. 백필 전에 "응답 0개 = `not_scored`"로 저장된 행은 0점 / 100으로 보인다(R-OD-3). 응답이 있는 `not_scored`만 "점수를 계산하지 못했어요".
3. 질문 점수 고지 위치: 질문이 `scored`인 카드의 질문 문장 아래.
4. 다음 연습 = 종합 평가(`session_feedbacks.result.next_practice`)의 "다음 연습" 목록으로 보고 세션 점수 기준으로 숨김.
5. 삭제된 세션의 "다룬 보완 요건"은 요건이 지워져 "원본 삭제됨"으로 보임.
6. 자기소개서 0개 + 삭제된 세션만 남음 → 빈 상태 안내와 목록을 함께, 새 면접 버튼 숨김.
7. S-39 삭제 토스트 "자기소개서를 삭제했어요".

## 백엔드 요청 (연결 대기)

- `src/lib/data/interview-rows.ts` `toRow` / `SESSION_SELECT` — `// 연결 대기 (DM v4.11 11.6 #1~#6)`. 기대: `interview_sessions.application_project_id uuid null`(생성 타입 `string | null`), `company_name_snapshot text null`, `position_title_snapshot text null`. 들어오면 `SESSION_SELECT`에 두 컬럼을 넣고 `as` 캐스트를 지운다. `services/interview/read.ts` DTO(left join·읽기 전용 플래그)를 화면이 쓰게 되면 `application_deleted`는 그 플래그로.
- 읽기 전용 가드 `interview_session_read_only`(409): 화면은 버튼을 안 보이므로 지금은 받을 일이 없음. 오면 일반 실패 토스트로 떨어짐.
- 점수 `d14.v1`(#7·#8): 화면은 저장된 `score_*`만 보임. 응답 0개 제출 경로가 `scored`·0점을 저장하는지 확인 부탁.

## 리더(공통) 요청

- `src/lib/data/deletion.ts` mock 자기소개서 삭제(약 453~466줄)는 아직 세션을 모두 지움. OD-I6대로 `completed` 세션은 남기고 `company_name_snapshot`·`position_title_snapshot`(`MockInterviewSession`, fixtures.ts)을 채운 뒤 `application_project_id`는 그대로 두면(행 타입이 null 불가) A4 화면이 삭제됨으로 읽음. 질문·답변·평가·종합도 남겨야 함.
- `src/lib/data/ai-jobs.ts`(A4 소유 아님) mock 채점 완료는 여전히 `pending_method`를 저장(264·319줄). d14.v1 산식을 mock에도 넣을지 판단 필요 — 지금은 fixture 세션 2·15만 `scored`.
- `src/components/common/dev-state-gallery.tsx`의 `SessionScore` 예시는 `pending_method` 그대로 — 바꿀 필요 없음.

## 기획 확인 필요

- 삭제된 세션의 S-22·S-33 라우트(위 가정 1). 명세 문장은 "S-22로 열린다"까지만.
- S-37 그 밖의 "기업 JD" 문구(필터 "모든 기업 JD", 열 머리 "기업 JD", 빈 상태 "기업 JD를 먼저 추가하면…")는 CR-23 전체 교체 범위라 두었다(브리프 "범위 밖"). S-37 명세 빈 상태 문구는 "자기소개서를 먼저 추가하면…".

## 검사 결과

- `pnpm typecheck`: 통과
- `pnpm lint`: 통과(경고 없음)
- `pnpm vitest run`(전체): 143 files / 2352 tests 통과. 새 테스트 `src/lib/data/interview-session-view.test.ts`(C-17 상태별 표시, OD-I2 숨김, R-OD-12 이름, 라우트 세그먼트), `src/lib/data/interviews.deleted.test.ts`(mock 삭제 세션 매핑·필터·상세, 응답 0개 제출 → 0점)
- 작업 중 typecheck 한 번에 `src/components/career/ai-panel/use-ai-panel.ts(692)` 오류가 보였으나(A2 동시 편집), 마지막 실행에서는 없음.
- `pnpm build`: 실행 안 함(브리프 요청 범위 밖).
