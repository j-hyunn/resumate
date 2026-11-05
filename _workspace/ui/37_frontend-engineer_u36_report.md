# 37 런 — U36-1·U36-2 프론트엔드 보고

- 기준: decisions 3.19·4.13 UI 1·2, `_workspace/00_input/planning-decisions-ui36-questions.md`, UX v5.14 (S-22·S-33 "자기소개서 삭제됨", S-37, 0장 표기 규칙 17줄, D-UX-20, D-UX-23), 36 런 A4 보고
- 건드리지 않은 곳: `src/server/**`, `src/app/api/**`, `src/lib/contracts/**`, `supabase/**`, 생성 타입, `docs/**`. `src/components/account/policy-content.ts`의 변경은 이 런 전부터 있던 것(U36-5, 리더)이라 손대지 않음.
- 브라우저 확인: 하지 않음(gated 화면은 Google 로그인 전용). typecheck·lint·test·build만.

## 1. U36-1 — "자기소개서 삭제됨" 면접 = `/interviews/{sessionId}/result`

| 파일 | 바뀐 것 |
|------|---------|
| `src/lib/routes.ts` | `routes.interviewDeletedResult(sessionId)` → `/interviews/{sessionId}/result` (S-22, 자기소개서 삭제됨). `menuKeyForPath`는 `/interviews`로 시작하므로 모의 면접 메뉴가 활성. 섹션 주석 "기업 JD 관리" → "자기소개서 관리" |
| `src/lib/routes.test.ts` | 새 빌더, 살아 있는 세션 URL 유지, 메뉴 키 `interviews`, 메뉴 라벨 "자기소개서 관리" 테스트 |
| `src/components/interviews/result-screen.tsx` (새 파일) | 기존 S-22 page의 화면 본체(미리보기 덮어쓰기 `previewSession` 포함)를 옮긴 서버 컴포넌트 `ResultScreen({ applicationProjectId, sessionId, state })`. `applicationProjectId = null` = 삭제된 세션: 자기소개서 조회 없이 세션만 읽고, 이동 경로 "모의 면접 › {이름} · 자기소개서 삭제됨 › 면접 결과", JD·형제 세션 조회 안 함. 살아 있는 세션 이동 경로 첫 마디 "자기소개서 관리" |
| `src/app/(dashboard)/(gated)/interviews/[sessionId]/result/page.tsx` (새 파일) | L-01 셸 안(`(gated)`) 새 라우트. 세션 위치를 읽어 없으면 not found, 자기소개서가 살아 있으면 `routes.interviewResult(apId, sessionId)`로 redirect(`?state=` 유지), 삭제됐으면 `ResultScreen` 읽기 전용 |
| `src/app/(dashboard)/(gated)/applications/[id]/interview/[sessionId]/result/page.tsx` | 얇은 page로. `[id] = "deleted"`(36 런 임시 경로) 또는 세션이 삭제된 자기소개서 소속이면 새 URL로 redirect(`?state=` 유지). 아니면 `ResultScreen` |
| `src/app/(dashboard)/(gated)/applications/[id]/interview/[sessionId]/page.tsx` (S-33) | 같은 판정으로 새 URL로 redirect(삭제된 세션은 S-33 주소 없음). 이동 경로 첫 마디 "자기소개서 관리" |
| `src/lib/data/interviews.ts` | `getInterviewSessionLocation(sessionId)` → `{ application_project_id: string \| null } \| null`. mock: 세션의 프로젝트가 저장소에 없으면 null(36 런과 같은 판정). 실제: `interview_sessions.select("application_project_id").eq("id")`(RLS로 본인 것만), 생성 타입이 아직 `string`이라 nullable로 읽음 |
| `src/lib/preview-state.ts` | `withPreviewState(path, state)` — redirect할 때 `?state=`를 붙여 줌 |
| `src/components/interviews/session-status.tsx` | `sessionHref`: 삭제된 세션 → `routes.interviewDeletedResult(id)` (S-37 행). `[UI-가정]` 라우트 주석 제거 |
| `src/components/interviews/session-status.test.ts` (새 파일) | 삭제된 세션 → `/interviews/{id}/result`, 살아 있는 세션 URL 그대로 |
| `src/lib/data/interview-session-view.ts` (+ test) | `DELETED_APPLICATION_SEGMENT`는 이제 **데이터 계층 키**로만 남김(`listInterviewSessions({ application_project_id: "deleted" })`, `getInterviewSession("deleted", id)`) — URL 아님. `[UI-가정]` 라우트 주석 삭제, URL용 `sessionApplicationSegment` 삭제(테스트 정리) |

- `?state=application-deleted`: 옛 라우트(`/applications/{id}/interview/{sessionId}/result?state=application-deleted`)에서 살아 있는 세션을 삭제됨 읽기 전용으로 미리보기 — 그대로 동작. 새 라우트에 살아 있는 세션 + 이 state를 주면 옛 라우트로 state를 유지한 채 보냄.
- 실제 삭제된 세션 미리보기(mock): `/interviews`의 "한빛소프트 – 백엔드 개발자" 행 → `/interviews/{IDS.ses(15)}/result`. 옛 `/applications/deleted/interview/{id}/result`·`/applications/{지운 id}/interview/{id}`도 여기로 옴.
- 다른 링크(`evidence.ts` 면접 답변 근거 링크, `ai-jobs.ts` 작업 완료 링크)는 `interviewResult(apId, …)`를 그대로 쓰지만, 삭제된 세션이면 옛 경로 redirect가 새 URL로 보내므로 손대지 않음.

## 2. U36-2 — CR-23 화면 용어

### 지원 건 "기업 JD" → "자기소개서"

| 위치 | 전 → 후 (명세 근거) |
|------|---------------------|
| 메뉴 `MENU_ITEMS` (`routes.ts`, app-sidebar) | "기업 JD 관리" → **"자기소개서 관리"** (UX-1) |
| 이동 경로 첫 마디 (S-14·S-15·S-16·S-17·S-18·S-19·S-20·S-22·S-31·S-33, S-13) | "기업 JD 관리" → **"자기소개서 관리"** (L-01) |
| S-13 `applications/page.tsx` | 제목 "자기소개서 관리"(다른 메뉴처럼 메뉴 이름), 버튼 "+ 자기소개서 추가", 빈 상태 "아직 자기소개서가 없어요" + 명세 문장 "지원하려는 공고를 붙여넣어 첫 자기소개서를 추가해 보세요…", 필터 결과 없음 "이 전형 단계의 자기소개서가 없어요" |
| S-13 `application-list.tsx` | 열 머리 "자기소개서", 행 메뉴 "자기소개서 열기" |
| S-14 `new/page.tsx`, `application-new-form.tsx` | 제목·이동 경로 "자기소개서 추가", 설명 "공고를 붙여넣어 자기소개서를 만들어요. 이 자기소개서에서…", 공고 원문 안내(명세 문장), 저장 실패 "자기소개서를 저장하지 못했어요…", 이름 규칙 안내 "새 자기소개서 ({날짜})", 토스트 "자기소개서를 추가했어요" |
| S-15 `jd-raw-edit.tsx` | 명세 문장 두 개 "…새 자기소개서로 추가해 주세요" / "…새 자기소개서로 추가하고…", 버튼 "새 자기소개서 추가" |
| S-31 `hub-header.tsx` | 제목 **"{회사명 – 포지션명} 자기소개서"**, 메뉴 aria-label "자기소개서 메뉴" |
| S-31 `[id]/page.tsx` | 면접 카드 "이 자기소개서로 직무·컬처핏 면접을 연습할 수 있어요" |
| S-20 `[id]/interview/page.tsx` | "이 자기소개서의 세션 목록"(명세), caption "이 자기소개서의 면접 세션 목록", 빈 목록 "아직 이 자기소개서로 연습한 면접이 없어요" |
| S-33 `answer-sheet.tsx` | "이 자기소개서로 새 면접 시작"(명세) |
| S-37 `interviews-overview.tsx`, `session-list.tsx` | 빈 상태 "자기소개서를 먼저 추가하면 그 공고에 맞춘 면접을 연습할 수 있어요"(명세) + "자기소개서 추가", 필터 "모든 자기소개서" / aria "자기소개서 필터", 열 머리 "자기소개서" |
| C-16 `jd-picker-dialog.tsx` | 제목 "자기소개서 선택", 설명 "면접을 연습할 자기소개서를 골라 주세요", 빈 상태 "자기소개서를 먼저 추가해 주세요"(명세) + "자기소개서 추가" |
| C-05 `shared.tsx` | 삭제 토스트 "{이름} 자기소개서를 삭제했어요" |
| C-20 `state-views.tsx` | "…커리어 입력과 열람, 자기소개서, 지원 현황 보드는 정상이에요"(명세) |
| S-25 `deletion-summary.tsx` | 묶음 제목 "자기소개서 {N}개" |
| 인사이트 사유 `applications/labels.ts` | `low_relevance` "이 자기소개서와 관련이 적어 이번 초안에 넣지 않았어요" |
| S-01 `(public)/page.tsx` | "자기소개서를 모아 지원 현황 보드로 관리하고"(명세) |
| 메타 설명 `app/layout.tsx` | "커리어를 정리하고, 자기소개서마다 인사이트·서류·면접을 준비하고, 지원 현황을 관리하세요" |
| dev 갤러리 | "C-05 자기소개서 삭제 확인 열기" |
| mock fixtures | 기본 이름 프로젝트 7·8 "새 자기소개서 (날짜)"(DB 기본 이름 R4와 같게) |

### 개별 서류 `cover_letter` "자기소개서" → "자소서 문항 답변" (D-UX-23)

| 위치 | 전 → 후 |
|------|---------|
| `DRAFT_TYPE_LABELS.cover_letter` (`components/applications/labels.ts`) | "자기소개서" → **"자소서 문항 답변"** (S-17 목록 종류·S-19 머리 등이 이 값을 씀) |
| S-17 `drafts-view.tsx` | 새 서류 종류 라디오 "자소서 문항 답변", 데이터 부족 게이트 기능 이름 |
| S-17 `drafts/page.tsx`, S-31 서류 카드 | "경력기술서와 자소서 문항 답변 초안을 만들어요" / "경력기술서나 자소서 문항 답변 초안을 만들어 보세요" |
| S-18 `questions/page.tsx`, `cover-letter-questions.tsx` | 제목·이동 경로 "자기소개서 문항" → **"자소서 문항 설정"**(D-UX-23), 게이트 기능 이름 |
| S-15 `jd/page.tsx` | 복귀 링크 "자소서 문항 설정으로 돌아가기" |
| C-05 `delete-confirm-dialog.tsx` | 결과 삭제 범위 "…자소서 문항 답변은 해당 문항의 생성 결과만…"(명세 851줄). 초안 삭제 제목은 이미 "자소서 문항 답변 삭제" |
| S-42 `AI_USAGE_FEATURE_LABELS.cover_letter` (`lib/data/labels.ts`) | "자소서 문항 답변"(S-42 명세) |
| `AI_FEATURE_NAMES.cover_letter`, `RETURN_FEATURE_LABELS.cover_letter` | "자소서 문항 답변" → 복귀 "자소서 문항 답변으로 돌아가기" (아래 `[UI-가정]` 1) |
| C-02 근거 경로 `evidence.ts` (user_note) | ["자소서 문항 답변", "문항 메모"] |
| mock: 새 자소서 초안 제목(`drafts.ts`), fixture 초안 2 제목, mock AI 작성 대화 기능 이름 | "자소서 문항 답변" |

- 코드 주석의 "기업 JD"도 화면 이름을 가리키는 곳은 함께 고침. 식별자는 그대로(`JdPickerDialog`, `jd-raw-edit` 등).
- 테스트: 옛 문구를 단언하는 테스트는 없었음. 새 테스트 = routes(메뉴 라벨·새 빌더), session-status(sessionHref).

## 남은 "기업 JD"

`grep -rn "기업 JD" src` → 2건, 모두 백엔드 소유 주석(`src/lib/contracts/application.ts` 97·331줄, "새 기업 JD 추가"를 가리키는 문서 주석). 화면에 나오지 않고 수정 금지 경로라 그대로 둠. UI 소유 파일에는 0건.

## 남은 "자기소개서"(= cover_letter 뜻)와 백엔드 요청

- `supabase/migrations/20261102000300_s7_cover_letter_user_rpcs.sql` 103줄: 새 초안 기본 제목 `'자기소개서'`(+ 날짜, `server/services/drafts/read.test.ts` "자기소개서 (2026-10-29)") → 실제 S-17 목록·S-19 머리·삭제 다이얼로그 "'{초안 이름}'"에 "자기소개서 (날짜)"가 보임. **백엔드 요청**: D-UX-23대로 "자소서 문항 답변 (날짜)"로(기존 행 백필 여부 판단 포함). mock은 이미 "자소서 문항 답변".
- `supabase/migrations/20261109100800_r4_writing_chats_v44.sql` 193줄 `'자기소개서를'`, `src/server/ai/prompts/AI-12/index.ts` `GATE_FEATURE_LABEL`(테스트 `gate_feature_label: 자기소개서`): AI 작성 대화가 "자기소개서로 돌아갈 수 있어요"처럼 말함. **백엔드 요청**: cover_letter 게이트 이름을 "자소서 문항 답변"으로(화면 복귀 배너와 맞춤).
- `src/server/services/interview/read.ts` 177·243·427줄 이름 없을 때 대체값 "자기소개서" — 지원 건 뜻이라 맞음(화면은 이 DTO를 아직 안 씀).
- `src/components/account/policy-content.ts`의 "자기소개서 초안"·"자기소개서 메모"(처리방침·약관 본문)는 법무 문서 문장이라 그대로 둠 — 법무 문서 개정 때 함께 판단 필요(기획 확인).

## `[UI-가정]`

1. `AI_FEATURE_NAMES.cover_letter`(C-18 기능 이름 열, FL-19 복귀 "…으로 돌아가기")를 "자소서 문항 답변"으로. 명세 C-18 표는 "자기소개서(문항 답변)", 5.x 목록 문장은 "자기소개서"라 적혀 있으나 D-UX-23·U36-2에 따라 지원 건 이름과 겹치지 않게 함. `RETURN_FEATURE_LABELS`·게이트 기능 이름도 같은 값.
2. S-31 제목 "{이름} 자기소개서": 이름에 이미 "자기소개서"가 들어 있으면(기본 이름 "새 자기소개서 (날짜)", 이름 없음 "새 자기소개서") 붙이지 않음.
3. S-13 페이지 제목은 다른 메뉴(모의 면접·지원 현황)처럼 메뉴 이름 "자기소개서 관리"로 둠(명세 화면 이름은 "자기소개서 목록").
4. 명세 문구가 없어 용어만 바꾼 곳: S-13 필터 결과 없음, S-14 설명·토스트·이름 규칙 안내, S-20 빈 목록·caption, S-31 면접·서류 카드 안내, C-05 삭제 토스트, C-16 설명, S-25 묶음 제목, 인사이트 `low_relevance` 사유, 메타 설명.

## 기획 확인 필요

- C-18 기능 이름 열 "자기소개서(문항 답변)"과 AI_FEATURE_NAMES 목록 문장 "자기소개서"를 D-UX-23 "자소서 문항 답변"으로 고칠지(위 가정 1).
- 처리방침·약관 본문의 "자기소개서 초안/메모"를 "자소서 문항 답변"으로 맞출지(법무 문서).

## 검사 결과

- `pnpm typecheck` 통과
- `pnpm lint` 통과(경고 없음)
- `pnpm vitest run`: 144 파일 중 142 통과, 테스트 2358 중 2354 통과. 실패 4건은 브리프에 적힌 로컬 Supabase 통합 테스트(`src/lib/data/interviews.integration.test.ts` 2건, `src/server/services/interview/interview.integration.test.ts` 2건, 공유 DB 마이그레이션 차이)뿐 — 그 밖 실패 없음
- `pnpm build` 통과(`/interviews/[sessionId]/result` 라우트 생성 확인)
