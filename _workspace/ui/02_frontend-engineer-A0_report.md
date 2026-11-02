# A0 파운데이션 구현 보고 (Phase 2, 2026-10-24)

기준: 플로우 v4.2b · 데이터 모델 v3.2a · AI v3.2a · 디자인 시스템 v1. 커밋하지 않음.

## 완료 화면

| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---------|--------|--------------|------|
| L-01 셸 | `src/app/(dashboard)/layout.tsx` (모든 로그인 화면) | `ai-outage`(AI 장애 배너), `return-banner`(C-10 미리보기, 커리어 화면) | 왼쪽 메뉴 고정 순서, 현재 메뉴 규칙, 배지, 계정·설정·처리방침, 1024px 미만 상단 바 + 서랍, 이동 경로(출발 메뉴 치환), 전역 토스트, AI 완료 토스트 |
| S-28 | `(dashboard)/not-found.tsx`, `(dashboard)/error.tsx`, `app/not-found.tsx` | `not-found`, `unauth`, `error` (자리 표시 화면에서) | ErrorState 3종 + AI 장애 배너 |
| 영역 화면 자리 표시 32개 | 아래 "라우트 트리" | `empty`, `loading`, `error`, `unauth`, `not-found` | 영역 엔지니어가 파일째 교체 |

`?state=`는 개발 모드에서만 동작(`NODE_ENV !== "production"`). 셸 왼쪽 아래에 개발용 상태 전환 메뉴(PreviewStateSwitcher)가 뜬다.

### 라우트 트리 (`src/lib/routes.ts`의 `routes.*`로만 링크할 것)

- (public) A1: `/` S-01, `/sign-in` S-02, `/consent` S-03, `/policies` S-30
- 커리어 A2: `/career` S-08, `/career/profile` S-04, `/career/experiences/new|[id]` S-09, `/career/educations/new|[id]` S-34, `/career/projects/new|[id]` S-10, `/career/projects/[id]/details/new|[detailId]?focus=` S-35, `/career/skills` S-12, `/career/writing-chats/new|[id]` S-36 (S-11은 모달이라 라우트 없음)
- 기업 JD A3: `/applications` S-13, `/applications/new?from=board` S-14, `/applications/[id]` S-31, `/jd` S-15, `/insight` S-16, `/drafts` S-17, `/drafts/[draftId]/questions` S-18, `/drafts/[draftId]` S-19
- 면접·보드 A4: `/applications/[id]/interview?type=` S-20, `/interview/[sessionId]` S-33, `/interview/[sessionId]/result` S-22, `/interviews` S-37, `/board` S-39
- 설정 A1: `/settings` S-24, `/settings/withdraw` S-25

## 파일 맵

| 경로 | 내용 |
|------|------|
| `package.json` | Next 16.4.2 / React 19.3 / Tailwind 4 / shadcn(radix-nova) / lucide / react-hook-form + zod + @hookform/resolvers / @dnd-kit core·sortable·utilities / cmdk / sonner. 스크립트 `dev build start lint typecheck` |
| `next.config.ts` | 스캐폴드 기본값 유지: `cacheComponents: true`, `partialPrefetching: true` |
| `src/app/globals.css` | 디자인 시스템 1.1.2 블록 그대로 + 아래 편차(헤더 주석에 기록) |
| `src/app/fonts/` | PretendardVariable.woff2(npm `pretendard@1.3.9`), OFL 라이선스 |
| `src/app/layout.tsx` | `next/font/local` Pretendard, `lang="ko"`, TooltipProvider, 반응형 Toaster |
| `src/app/(dashboard)/{layout,loading,not-found,error}.tsx` | L-01, ST-LOADING(전 화면 Suspense 경계), S-28 |
| `src/app/(public)/layout.tsx` | 셸 밖 화면 상단 로고 바 |
| `src/types/db.ts` | 04 데이터 모델 27개 테이블 + 참조 2개 행 타입, 모든 enum, jsonb 형태(structured_draft, return_target, insights.result, draft blocks, 평가 결과), RPC 반환형(get_data_readiness, get_deletion_impact, get_account_deletion_summary, move_application_stage) |
| `src/lib/routes.ts` | 라우트 빌더, 메뉴 항목, 현재 메뉴 판정 |
| `src/lib/preview-state.ts` | `getPreviewState(searchParams)`, `PREVIEW_STATES`, `previewErrorCategory()` |
| `src/lib/data/*.ts` | 데이터 계층 (아래 API) |
| `src/lib/mock/` | `fixtures.ts`(김지우 1인 데이터), `store.ts`(globalThis 싱글톤 + `mockRequest()`), `ai.ts`(비동기 작업·동기 호출·실패 주입), `ai-stream.ts`(블록/대화 턴 스트림, 클라이언트 안전), `ids.ts`, `time.ts` |
| `src/components/ui/` | shadcn primitive 31개 (테마 수정은 아래) |
| `src/components/common/` | 공통 컴포넌트·상태 뷰 (아래) |
| `src/components/common/shell/` | 사이드바, 상단 바·토스트·작업 감시·장애 배너, 이동 경로, 셸 서버 슬롯, 복귀 배너 슬롯 |

### 공통 컴포넌트 (`src/components/common/`)

| ID | 파일 · export |
|----|---------------|
| C-01 / C-02 | `evidence.tsx` — `EvidenceProvider`(화면당 1개, `returnTarget` 주면 원본 이동 시 C-10 기록), `EvidenceChip`, `EvidenceChips`(`max`로 +N), `EvidencePanel`, `CHIP_CLASS`(C-15가 같은 모양으로 재사용) |
| C-03 | `ai-progress.tsx` — `useAiJob(jobId, {onDone})` → `{job, status, progress, error, retry, cancel}`(2초 폴링), `AiProgress`(카드), `AiProgressInline`(축약형), `stageText()` |
| C-04 | `streaming.tsx` — `useAiStream()` → `{blocks, sources, status, error, start, cancel, reset}`, `useChatTurnStream()`(AI-12), `StreamingHeader`(중단), `StreamingBlock`, `StreamingCaret`, `PendingBlock`, `StreamRegion`(aria) |
| C-05 | `delete-confirm-dialog.tsx` — `DeleteConfirmDialog target={{kind: "career" \| "writing_chat" \| "application_project" \| "draft" \| "interview_session", ...}} onConfirm={(opts) => …}`. 영향 조회·선택지 기본값·확인 체크 포함 |
| C-06 | `save-status.tsx` — `useAutosave({save})` → `{state, savedAt, schedule, flush, retry}`(800ms 디바운스, 실패/진행 중 이탈 경고), `SaveStatus`, `DraftBadge`, `DraftNotice` |
| C-07 | `input-guide.tsx` — `InputGuide guide="G-1..G-4"`, `CharCount`, `countChars(text, count_basis)`, `MonthField`(연·월 Select + 재직/재학 중 체크) |
| C-08 | `placeholders.tsx` — `PlaceholderText`(6종 토큰 강조 + hint), `BlockFlagBadges`, `CopyWithPlaceholderGuard`, `countPlaceholders` |
| C-09 | `data-gate.tsx` — `DataInsufficientGate`(next_action 분기, 한도 소진 시 직접 입력, S-20 컬처핏 대안, 복귀 대상 기록) |
| C-10 | `return-banner.tsx` — `ReturnBanner`(셸이 커리어 화면에 자동 표시), `notifyCareerSaved()`(저장 후 호출 → 재판정), `RETURN_FEATURE_LABELS` |
| C-17 | `score-display.tsx` — `SessionScore`, `SessionScoreBadge`, `AnswerScore`, `ScoreDisclaimer` (S-20/S-22/S-31/S-37 공용이라 파운데이션에 둠) |
| 패턴 | `basics.tsx` — `PageHeader`, `UsageHint`, `StatusDot`, `StageLabel`, `OutcomeBadge`, `DDay`, `daysUntil` |
| ST-xx | `state-views.tsx` — `EmptyState`, `ErrorState`(not-found/unauth/error), `ListSkeleton`/`CardGridSkeleton`/`FormSkeleton`/`TextSkeleton`/`PageSkeleton`(300ms 지연), `AiFailed`(error_category별, canceled 미표시), `AiFailedInline`, `LimitNotice`, `WaitJd`, `AiOutageAlert` |
| 기타 | `return-target.ts` — `markCareerReturn`, `readCareerReturn`, `consumeReturnParams`(원래 화면에서 설정 복원 + 지움), `setNavOrigin`/`readNavOrigin`(S-39·S-37 출발 메뉴). `preview-state-client.tsx` — `usePreviewState()`, `PreviewStateSwitcher`, `WhenPreview`. `shell/breadcrumbs.tsx` — `PageCrumbs items applicationProjectId` |
| 자리 표시 | `placeholder-screen.tsx` — 영역 화면 대체 전 임시 화면 |

## 데이터 계층 API (영역 엔지니어용)

모두 서버 전용 async 함수. Server Component에서 바로 부르거나, 영역 폴더의 server action에서 감싸서 쓴다. 각 함수는 `mockRequest()`로 `connection()`을 호출하므로 요청 시점 렌더링이 된다(아래 Cache Components 주의).

- `career.ts`: `getProfile`, `updateProfile`, `listExperiences`, `listEducations`, `getExperience`(+projects, 경력 단위 achievements), `getEducation`, `getProject`(+details+achievements, skills, writing_chats, 소속), `getProjectDetail(projectId, detailId)`, `listSkills`(+project_count), **`getCareerTree()`**(S-08 연도 묶음: years[].entries[] 경력/교육 + 그 해 시작 프로젝트 + collapsed, other_projects, undated_projects, counts, hints, active_writing_chats, is_empty), 쓰기: `saveExperience|saveEducation|saveProject(id|null, patch, {fail})`, `setProjectSkills`, `saveProjectDetail(projectId, id|null, patch)`, `reorderProjectDetails`, `saveAchievement`, `addManualSkill`. 저장 시 `status` 자동 재계산(draft/complete, 상세 내용 → 부모 프로젝트). `{fail: true}`는 ST-SAVE-FAILED 시뮬레이션(`SaveFailedError`). 완료 판정 함수 `is*Complete` export
- `deletion.ts`: `getDeletionImpact(entity_type, id, affiliation_mode)`, `deleteCareerItem(entity_type, id, affiliation_mode, result_mode)`(근거 '원본 삭제됨' 처리 포함), `getApplicationDeletionImpact`, `deleteApplicationProject`(진행 중 작업 취소), `getDraftDeletionImpact`/`deleteDraft`, `getInterviewSessionDeletionImpact`/`deleteInterviewSession`
- `readiness.ts`: `getDataReadiness()`(RPC 형태 그대로), `insufficientReadinessPreview(base, {noExperience})`(`?state=insufficient`용)
- `usage.ts`: `getUsageSummary()` → `{insight, draft, interview_session, writing_chat}: {monthly_limit, used, remaining}`, `limitUsagePreview()`(`?state=limit`용)
- `applications.ts`: `listApplicationProjects({sort, stage})`, `getApplicationProject(id)`(요약: jd, insight_state, draft_count, interview_session_count, in_progress_session, running_job_ids), `getBoard()`(단계별, stage_changed_at desc), `createApplicationProject({raw_text, name, deadline})`(AI-01 자동 시작, 약 4초 후 추출 완료), `updateApplicationProject`, `moveApplicationStage(id, to, outcome, {fail})` → `{application_project, interview_prompt}`(MoveFailedError), `setApplicationOutcome`, `getJobDescription(apId)`(+requirements), `saveJdRequirement`, `deleteJdRequirement`, `getInsightState(apId)` → `{latest, generating}`, `startInsight(apId, {fail})` → `{insight_id, job_id}`, `listDrafts`, `getDraft(apId, draftId)`(+sections+sources), `saveDraftSection`
- `interviews.ts`: `listInterviewSessions({application_project_id, interview_type, status})`(+application_name, running_job_id), `getInterviewSession(apId, sessionId)`(+questions[].answer/evaluation, feedback), `startInterviewSession({...,fail})`(질문이 작업 진행에 따라 하나씩 생기고 끝나면 generation_status='ready'), `saveInterviewAnswer`(편집 가능 조건 검사), `submitInterviewSession`(빈 답변 unanswered, 0개면 not_scored), `abandonInterviewSession`, `markResultViewed`
- `writing-chats.ts`: `listActiveWritingChats`, `getWritingChat(id)`(+messages, user_message_numbers), `daysUntilAutoDelete`, `startWritingChat({mode, project_id, experience_id, education_id, return_target})`(한도 초과 시 `WritingChatLimitError`), `appendWritingChatMessage`, `completeMockAssistantTurn(chatId, content, failed)`, `applyStructuredDraftPatch(chatId, {path, action: edit|accept|reject})`, `setWritingChatAffiliation`, `getWritingChatSaveSummary`, `saveWritingChat`, `handOffWritingChat`, `clearReturnTarget`, `abandonWritingChat`, 상수 `WRITING_CHAT_MESSAGE_LIMIT`(40)
- `evidence.ts`: `getEvidence(owner_type, owner_id)` → `{[item_key]: EvidenceView[]}`, `getEvidenceForOwners`. EvidenceView에 label/status(ok·changed·deleted)/quote/current_value/path/href 포함
- `ai-jobs.ts`: `getAiJob`, `listActiveAiJobs`, `getLatestJobFor(target_type, target_id)`, `startAiJob(opts)`, `cancelAiJob`, `retryAiJob`(실패 단계부터 재개). 사용량 reserve → charge/release 반영
- `shell.ts`: `getCurrentUser`, `getShellBadges`, `getServiceStatus`
- `labels.ts`(클라이언트 안전): `STAGE_ORDER/STAGE_LABELS`, `OUTCOME_LABELS`, `AI_STAGE_LABELS`, `AI_FAILED_TITLES`, `USAGE_FEATURE_LABELS`, `INTERVIEW_TYPE_LABELS`, `SESSION_STATUS_LABELS`, `MATCH_STATUS_LABELS`, `GRADE_LABELS`, `EDUCATION_TYPE_LABELS`, `ENROLLMENT_STATUS_LABELS`, `EMPLOYMENT_TYPE_LABELS`, `WRITING_CHAT_*_LABELS`, `DETAIL_FIELD_LABELS`, `evidenceKindLabel`, `formatMonth/Period/Date/Time/Relative`, `applicationDisplayName`
- `actions.ts`("use server", 공통 컴포넌트용): `getAiJobAction`, `listActiveAiJobsAction`, `cancelAiJobAction`, `retryAiJobAction`, `get*DeletionImpactAction` 4종, `getDataReadinessAction`, `getUsageSummaryAction`, `getShellBadgesAction`

### 가짜 AI
- 비동기: `startInsight` / `startInterviewSession` / `submitInterviewSession` / `startAiJob`이 작업을 만들고, 읽을 때마다 경과 시간으로 `progress.stage`·`done/total`을 계산(6~12초). `fail: "transient"|"input"|"timeout"`이면 60% 지점에서 실패. 픽스처의 하늘커머스 인사이트·채점 작업은 10분짜리 진행 중 상태라 C-03을 바로 볼 수 있다.
- 스트리밍: `useAiStream().start({ blocks:[{block_id,text,flags}], sources?, fail?, failAfterBlocks? })`, `useChatTurnStream().start({ reply, patchPaths, needsReview, actorAmbiguous, fail })`. 이벤트 이름은 AI 명세 C-6 / AI-12와 같다.
- 동기: `mockSyncCall(result, {ms, fail})` (`MockAiError.error_category`).

### 픽스처 요약
경력 3(재직 중 1, draft 1), 교육 2(학위·과정), 프로젝트 7(경력·교육·독립·연도 미정, complete/draft 섞임), 상세 내용 6, 정량 성과 3, 스킬 7, AI 작성 대화 3(active 새 프로젝트 · saved 보강 · return_target 있는 active), 기업 JD 6(지원 전 2(1개는 추출 중) · 서류 · 직무 인터뷰 · 종료 불합격 · 종료 결과 미기록), 인사이트 ready 1 + 생성 중 1, 초안 2(경력기술서 ready, 자소서 3문항), 면접 세션 4(작성 중 · 완료(새 결과) · 채점 중 · 그만둠), 근거 15(변경됨·원본 삭제됨 포함), 이번 달 사용량 일부 차감. 서버 재시작 시 초기화.

## [UI-가정]

| 화면 ID | 파일 | 내용 |
|---------|------|------|
| 전역 | `next.config.ts` | 스캐폴드 기본값인 Cache Components를 유지. 요청 시점 데이터는 Suspense 안에서만 읽어야 함 → `(dashboard)/loading.tsx`가 모든 페이지 경계, 데이터 계층이 `connection()` 호출 |
| 전역 | `globals.css` | 다크 토큰을 `.dark` 대신 `prefers-color-scheme` 미디어 쿼리에 둠(Q-2 시스템 설정만). 토큰 이름·값 변경 없음 |
| 전역 | `components/ui/*` | 디자인 시스템 반영: button 크기·16px·solid destructive, badge 커스텀 variant 8종, card 그림자 제거·border, alert info/warning/destructive/ai, 포커스 링 불투명 `ring-2 ring-offset-2`, 입력·Select 16px·h-10, dialog/alert-dialog `rounded-lg p-6 sm:max-w-lg shadow-lg`, sheet 오른쪽 `sm:max-w-md`, sidebar 15rem·lg 기준, sr-only 문구 한국어 |
| 전역 | `components/ui/sonner.tsx` | next-themes 제거, `theme="system"` |
| L-01 | `shell/app-sidebar.tsx` | 모의 면접 배지: 작성 중 수 + 새 결과 수를 숫자 하나로 합치고 스크린 리더 문구로 구분 |
| L-01 | `return-target.ts` | 출발 메뉴(지원 현황/모의 면접)는 쿼리가 아니라 sessionStorage로 기억(C-14 "쿼리에는 유형 값만") |
| S-28 | `state-views.tsx` | ErrorState 문구(v3 명세 없음): "찾을 수 없는 페이지예요" / "접근할 수 없는 페이지예요" / "문제가 생겼어요" |
| C-02 | `evidence.tsx` | 변경됨 설명 문구 "이 결과를 만든 뒤 원본이 수정됐어요." |
| C-02 | `lib/data/evidence.ts` | 정량 성과 "원본으로 이동"은 S-11을 띄우는 화면(S-35 결과 필드 / S-09)으로 |
| C-03 | `ai-progress.tsx`, `labels.ts` | 이탈 안내 문구, `extract`/`reply` 단계 문구, 인사이트·질문 생성 완료 토스트 문구(명세에는 면접 채점 문구만) |
| C-05 | `delete-confirm-dialog.tsx` | 첫 줄 문구, 경력·교육 연쇄 문구, 초안·세션 하위 개수 문구, 기업 JD 확인 체크 문구(P-1). 결과 처리 선택지는 영향이 0이어도 항상 표시 |
| C-09 | `data-gate.tsx` | "{기능}을"/"{기능}으로"는 받침에 따라 을/를·으로/로. "직접 입력" 대상: 작성 중 프로젝트 → 작성 중 경력 → 새 폼. 컬처핏 대안 버튼 문구 "컬처핏 면접으로 바꾸기" |
| C-10 | `return-banner.tsx` | "돌아가기"는 대상만 이동하고, 원래 화면이 `consumeReturnParams()`로 설정 복원·대상 삭제 |
| C-17 | `labels.ts` | 항목 등급 라벨(P-2) |
| 데이터 | `types/db.ts` | `achievements.kind` 생성값 미정의 → `string`. RPC 반환 키(삭제 영향 by_application_project 필드, 탈퇴 요약, move 결과의 "새 상태")는 문서 목록을 키로 사용 |
| 데이터 | `writing-chats.ts` | 대화 시작 인사 문구(명세 없음) |
| 기타 | `labels.ts` | `employment_type` 라벨(정규직/계약직/프리랜서/인턴/기타) |

## 기획 확인 필요

| 화면 ID | 질문 | 스펙 위치 |
|---------|------|-----------|
| S-28 | 오류·접근 불가 화면 문구가 "v3와 같음"인데 v3 문서가 저장소에 없음(디자인 시스템 P-6과 같은 문제) | 02 §3 S-24·S-25·S-28·S-30 |
| C-02 | "변경됨" 설명 문구가 "v3와 같음" | 02 C-02 |
| C-03 | 인사이트·면접 질문 생성 완료 토스트 문구 | 02 C-03 |
| C-05 | 초안/면접 세션 삭제 "하위 개수" 구체 문구, 경력·교육 삭제 시 연쇄 문구 | 02 C-05 |
| L-01 | 모의 면접 배지 두 수(작성 중 / 새 결과)를 어떻게 보일지 | 02 1.3 |
| 데이터 | `achievements.kind` 생성 컬럼 값 목록 | 04 §2.3 |
| 데이터 | `get_account_deletion_summary`·`move_application_stage` 반환 JSON 키 | 04 §4.3, §2.6 |

## 파운데이션 → 리더 요청 / 영역 엔지니어 안내

1. **C-12 단계 이동 메뉴 소유 영역**: ui-context는 A4 소유지만 A3(S-13 행 메뉴, S-31 헤더 단계 칩)도 쓴다. A3·A4 병렬 작업 시 충돌하니 C-12(그리고 C-13·C-14 중 S-31이 쓰는 부분)를 파운데이션으로 옮기거나 A3가 A4 것을 import하도록 순서를 정해 주세요. 데이터 계층(`moveApplicationStage`, `setApplicationOutcome`, `STAGE_LABELS`, `StageLabel`, `OutcomeBadge`)은 이미 공통에 있음.
2. **Cache Components 규칙(전 영역 필독)**: 페이지에서 `searchParams`/`params`/데이터 계층을 읽는 것은 `(dashboard)/loading.tsx`의 Suspense 안이라 괜찮다. 다만 클라이언트 컴포넌트에서 `usePathname`/`useSearchParams`(`usePreviewState` 포함)를 쓰면 그 컴포넌트를 `<Suspense>`로 감싸야 빌드가 통과한다. 레이아웃 파일을 새로 만들 경우 특히 주의. 또 Activity로 이전 화면 상태가 유지되므로 다이얼로그는 이동 시 닫기 처리 권장.
3. 페이지는 `<PageCrumbs items=[…] applicationProjectId=…/>`로 이동 경로를 선언. S-39/S-37에서 기업 JD 하위 화면으로 보낼 때는 링크 클릭 시 `setNavOrigin("board" | "interviews", apId)` 호출.
4. 커리어 폼은 저장 성공 후 `notifyCareerSaved()` 호출(C-10 재판정). 원래 기능 화면은 진입 시 `consumeReturnParams(apId, feature)`로 설정 복원.
5. 영역 화면에서 쓰기 동작은 영역 폴더에 server action 파일을 만들어 `src/lib/data/*`를 호출하고 `revalidatePath`/`refresh`로 갱신.
6. `AGENTS.md`(Next 16 스캐폴드가 생성, `next dev`가 재생성)를 저장소 루트에 둠. 커밋 여부는 리더 판단.

## 검사 결과

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` (`tsc --noEmit`, 스크립트 추가) — 통과
- `pnpm build` — 통과. 32개 라우트(공개 4 정적, 대시보드 28 Partial Prerender)
- 추가 확인: `pnpm start` 후 대표 라우트 12개 curl 응답 200(없는 경로 404), 픽스처 데이터가 셸·자리 표시 화면에 렌더되는 것 확인. 브라우저 육안 검수와 `?state=` 개발 모드 확인은 하지 않음(QA 단계에서 `pnpm dev`로 확인 필요). 없는 지원 프로젝트 ID는 스트리밍 중 notFound라 HTTP 200 + not-found 화면으로 응답(Cache Components 특성).

---

## 라운드 1 수정 (QA `02_ui-qa_A0_review.md` 반영, 2026-10-24)

### 이슈별 처리

| ID | 심각도 | 처리 | 내용 |
|----|--------|------|------|
| UQ-1 | Critical | 수정 | `useAutosave`: 언마운트(앱 안 이동·Activity hidden), `pagehide`, `visibilitychange=hidden` 때 대기 중 입력을 즉시 저장. 버리지 않음 (`save-status.tsx`) |
| UQ-2 | Major | 수정 | 저장을 직렬화: 진행 중이면 최신 값만 모아 다음에 보냄 → 마지막 입력이 최종 저장 값. 실패 시 `retry()`가 실패한 값(또는 더 새 값)을 다시 보냄 |
| UQ-3 | Major | 수정 | 페이지 패턴 확정(아래 "페이지 규칙"). 32개 자리 표시 페이지를 모두 이 패턴으로 다시 만듦. `pnpm dev`에서 8개 경로(`?state=` 포함) 요청 시 "URL data" 오류 0건 |
| UQ-4 | Major | 수정(파운데이션 부분) | C-10 배너가 다시 판정한 결과 `next_action = 'writing_chat'`이면 "AI와 대화하며 채우기"(S-36, `new_project` + 방금 저장한 경력 소속, 또는 `augment_project`)를 띄움. A2용 훅 추가(아래) |
| UQ-7 | Major | 수정 | 왼쪽 메뉴 클릭 시, 그리고 최상위 메뉴 화면(이동 경로 1마디·지원 프로젝트 없음)이 `PageCrumbs`를 선언할 때 출발 메뉴를 지움 → S-13에서 들어가면 첫 마디가 다시 "기업 JD 관리" |
| UQ-5 | Minor | 안내로 처리 | S-36이 대화를 시작할 때 `readCareerReturn()?.params`를 `startWritingChat({ return_target: { application_project_id, feature, params } })`에 넣어야 함(영역 규칙 4번) |
| UQ-6 | Minor | 수정 | C-03 카드에서 `aria-live` 제거, 시작 시 한 번만 읽는 `role="status"` 문구 |
| UQ-8 | Minor | 수정 | MonthField: 연도만 고르면 값은 비어 있음(null), 월까지 골라야 `YYYY-MM-01` 저장. 연도 전에는 월 Select 비활성 |
| UQ-9 | Minor | 수정 | `<PageTopActions>` 추가 — 페이지가 상단 바 오른쪽 동작을 선언 |
| UQ-10 | Minor | 수정 | 상단 바 두 모양을 CSS(`lg:hidden` / `hidden lg:block`)로 함께 그려 hydration 전에도 좁은 화면에서 메뉴 버튼·현재 메뉴 이름이 보임(메뉴 버튼은 hydration 뒤 동작) |
| UQ-11 | Minor | 수정 | C-02 경로 연도 = `coalesce(프로젝트 시작월, 소속 시작월)`, 정량 성과 경로도 "연도 › 소속 › 프로젝트 › 상세 내용 › 정량 성과" |
| UQ-12 | Minor | 수정 | `getEvidenceForOwners`도 `sort_order` 순 |
| UQ-13 | Minor | 수정 | 칩 클릭 → C-02가 열리면 누른 칩의 근거 카드로 포커스 이동 |
| UQ-14 | Minor | 수정 | "원본으로 이동" 누르면 패널 닫고 이동 |
| UQ-15 | Minor | 수정 | C-09 제목 id를 `React.useId()`로 |
| UQ-16 | Minor | 수정 | 보조 링크 "직접 입력"이 주 버튼과 같은 곳이면 숨김 |
| UQ-17 | Minor | 수정 | 한도 소진 시 경고 한 줄만: "이번 달 AI 작성 대화를 모두 사용했어요. 직접 입력으로 채울 수 있어요" |
| UQ-18 | Minor | 수정 | `InsightResult.strategy.positioning_item_key` 삭제(item_key는 고정 경로 `strategy.positioning`) |
| UQ-19 | Minor | 수정 | sidebar 메뉴 버튼 `ring-offset-2`, field·input-group의 `ring-3 ring-ring/50` → `ring-2 ring-ring ring-offset-2`. 남은 `aria-invalid:ring-3`은 포커스 링이 아니라 오류 표시라 유지 |
| UQ-20 | Minor | 수정 | `SessionScore`/`SessionScoreBadge`에 `startNewAction` 자리(응답 0개일 때 "새 면접 시작하기"), "다시 채점"을 공통 `Button variant="link" size="sm"`으로 |
| UQ-21 | Minor | 기록 | `cn@0.5.0`은 shadcn 4.x 스캐폴드가 넣은 클래스 병합 유틸(clsx + tailwind-merge 대체). `src/lib/utils.ts`가 다시 export. **리더 승인 필요 항목으로 기록**, 바꾸지 않음 |
| UQ-22 | Minor | 수정 | `formatTime`을 `Intl.DateTimeFormat(..., timeZone: "Asia/Seoul")`로 고정 → 서버·클라이언트 같은 시각 |
| UQ-23 | Minor | 수정 | 개발용 상태 갤러리 `/dev/states` 추가(프로덕션 404). `?state=` 값으로 ai-pending(실제 폴링되는 진행 중 작업), ai-stream(시작·실패 버튼), ai-sync, ai-failed / -input / -timeout, limit, insufficient / -no-experience, wait-jd, move-failed(C-12·C-13·C-14 실동작), save-failed, empty(C-01·C-05·C-08·C-17)를 그려 볼 수 있음 |
| P-QA-1, P-QA-2 | 기획 | 유지 | 기획 확인 필요 목록에 추가 |

건너뛴 Minor: 없음. UQ-5·UQ-21은 코드 대신 규칙·기록으로 처리했다.

### C-12 · C-13 · C-14 → 파운데이션으로 이전 (`src/components/common/stage-menu.tsx`)

- `useStageMove({ applicationProjectId, name, stage, outcome, origin?, failMove?, onMoved? })` → `{ stage, outcome, moving, request(to), openOutcome(), dialogs }`
  - `request(to)`는 메뉴·"다음 단계로"·드래그앤드롭(S-39)이 모두 같은 경로를 탄다. 순서: 전형 종료이고 결과가 기록돼 있으면 "기록한 결과({최종 합격})를 지울까요?" 먼저 확인 → 낙관적 반영(종료에서 나가면 결과 즉시 지움) → `moveApplicationStageAction` → 실패하면 원위치 + 토스트 "이동하지 못했어요" [다시 시도] → 성공하면 `aria-live`로 "{카드}를 {단계}로 옮겼어요" 한 번 → `to = closed`이고 결과가 없으면 C-13 → `interview_prompt`가 있으면 C-14(작성 중 세션이 있으면 "이어서 쓰기").
  - `dialogs`는 트리거 근처에 한 번 렌더(확인 창, C-13, C-14, live region 포함).
- 트리거 두 가지: `StageChip`(S-31 헤더: outline sm + StatusDot + 단계 이름 + ChevronDown, 종료면 결과 배지) / `StageCardMenu`(카드·행 ⋯: ghost icon-sm + MoreHorizontal, `aria-label="카드 메뉴"`, 하위 메뉴 "단계 이동" + 종료 카드 "결과 기록" + 화면이 넣는 `extraItems`(기업 JD 열기·삭제)). 다른 메뉴에 넣을 땐 `StageSubMenu` / `StageMenuItems`.
- `OutcomeDialog`(C-13: 최종 합격 / 불합격 / 나중에 기록), `InterviewPromptDialog`(C-14: 사용량 안내 없음, `origin` 주면 S-20/S-33 링크 클릭 때 출발 메뉴 기록).
- 서버 액션 추가(`lib/data/actions.ts`): `moveApplicationStageAction`, `setApplicationOutcomeAction`, `getInProgressSessionAction`.
- 새 [UI-가정]: 결과 지우기 확인 창의 설명 문구와 "지우고 옮기기" 버튼 문구, C-14 컬처핏 설명(명세는 "…"로 생략), 결과 기록 완료 알림 문구.

### 영역 엔지니어가 지킬 규칙 (라운드 1에서 추가·확정)

1. **페이지 규칙 (UQ-3)** — 모든 `page.tsx`:
   ```tsx
   export default function Page({ params, searchParams }: Props) {   // async 아님, await 없음
     return (
       <ScreenSuspense>                                           // @/components/common/screen-suspense
         <Screen params={params} searchParams={searchParams} />
       </ScreenSuspense>
     )
   }
   async function Screen({ params, searchParams }: Props) {
     const { id } = await params
     const state = getPreviewState(await searchParams)
     const data = await getSomething(id)          // 데이터 계층 호출도 여기서
     if (!data) notFound()
     …
   }
   ```
   기본 export에서 `params`/`searchParams`를 await하거나 데이터 계층을 부르지 않는다. 클라이언트 컴포넌트의 `usePathname`/`useSearchParams`/`usePreviewState`도 `<Suspense>` 안에 둔다. 자리 표시 페이지가 모두 이 모양이므로 그대로 고쳐 쓰면 된다.
2. **C-09 경력 없음 경로 (UQ-4)** — A2:
   - S-09: 복귀 대상이 있을 때(`readCareerReturn()`가 null이 아님) 경력을 저장하면 `recordGateExperience(experienceId)` 다음 `notifyCareerSaved()`를 부른다. 그러면 C-10 배너가 다시 판정하고, `next_action = 'writing_chat'`이면 "AI와 대화하며 채우기"(S-36, 이 경력 소속)를 띄운다.
   - S-09·S-36 저장 완료 화면에서 직접 버튼을 그리려면 `useGateContinuation()` → `{ target, ready, returnHref, continueHref, recheck }`를 쓴다. 준비됐으면 `returnHref`로 "{기능}으로 돌아가기", 아니면 `continueHref`.
   - S-36은 쿼리의 `experience_id`를 소속 기본값으로 쓴다.
3. 원래 기능 화면(S-16·S-17·S-18·S-20)은 진입 때 `consumeReturnParams(apId, feature)`로 진행 중 설정을 복원한다(복귀 대상도 이때 지워짐).
4. **S-36 return_target (UQ-5)** — 대화를 시작할 때 `startWritingChat({ …, return_target: { application_project_id, feature, params: readCareerReturn()?.params ?? {} } })`로 params까지 DB에 저장한다(다른 기기에서 이어 해도 복원되게).
5. 커리어 폼은 저장 성공 후 `notifyCareerSaved()`를 부른다.
6. 상단 바 오른쪽 화면 동작은 `<PageTopActions>`로, 이동 경로는 `<PageCrumbs>`로 선언한다. S-39·S-37에서 기업 JD 하위 화면으로 보낼 때는 `setNavOrigin(...)`을 부른다. 왼쪽 메뉴와 최상위 메뉴 화면이 출발 메뉴를 자동으로 지운다.
7. C-12~C-14는 A3·A4가 `@/components/common/stage-menu`에서 import한다. 영역에서 다시 만들지 않는다.

### 검사 결과 (라운드 1)

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` — 통과
- `pnpm build` — 통과, 36개 페이지 생성(`/dev/states` 추가)
- `pnpm dev` 확인: `/career`(없음·empty·error), `/applications/{id}/insight?state=loading`, `/dev/states`(없음·ai-pending·insufficient), `/board` 모두 200, 개발 로그에 "URL data" 오류 0건. 브라우저로 직접 보지는 않음(클라이언트 상호작용 — 서랍, 토스트, 단계 이동, 스트림 — 은 QA가 브라우저로 확인 필요)

---

## 파운데이션 배치 (Phase 3, 2026-10-25)

영역 라운드 1 이후 요청·QA 이슈를 반영했다. 영역 엔지니어가 쉬는 배치라 이동에 필요한 영역 쪽 import·호출부도 기계적으로 고쳤다(아래 목록). 커밋하지 않음.

### 항목별 처리

| # | 항목 | 처리 |
|---|------|------|
| 1-A1 | `account-data.ts` → `lib/data/account.ts` | 완료. 시그니처 유지. `safeNextPath`는 클라이언트에서도 쓰도록 `lib/routes.ts`로 |
| 1-A1 | 동의 항목 정의·필수 목록·정책 문서 종류 (A1 UQ-95) | `lib/data/consent-items.ts`(클라이언트 안전)로 이동. `policy-content.ts`는 다시 export만 하고 문서 본문 문구는 영역에 남김 |
| 1-A1 | 정책 버전 픽스처 (A1 요청 3) | `MockDb.policy_versions` 추가, `getPolicyVersions()`. S-03·S-30은 페이지가 버전을 prop으로 내려 줌(클라이언트 `currentPolicyVersion()` 제거) |
| 1-A1 | `running_ai_jobs` 분리 (UQ-95 ③) | `getAccountDeletionSummary()`는 RPC 모양만, `getRunningAiJobCount()` 별도. `DeletionSummary`는 `runningAiJobs` prop |
| 1-A1 | 동의일 vs 시행일 (UQ-106) | 정책 버전 `2026-04-01`(시행 2026-04-01) — 픽스처 동의(120일 전)보다 앞섬 |
| 1-A2 | `mock-turn.ts` → `lib/mock/writing-chat-turn.ts`, `chat-view.ts` → `lib/data/writing-chat-view.ts`, `slots.ts` → `lib/data/writing-chat-slots.ts` (A2 UQ-78) | 완료. 네 진입점은 `writing-chats.ts`의 `sendWritingChatTurn` / `retryWritingChatTurn` / `completeWritingChatTurn` / `markWritingChatSlotAsked`. 영역 액션 이름은 그대로 |
| 1-A2 | 재시작 후 다시 보내기 | 턴 기억(물은 칸·건너뛴 칸·대기 계획)을 globalThis Map 대신 목 저장소 `db.mock_chat_turns`에 둠. 대기 계획이 없으면(서버 재시작) **마지막 사용자 메시지로 다시 계획**해 "다시 보내기"가 동작 |
| 1-A2 | `persistChat`이 정량 성과·스킬 저장 (A2 요청 6) | 완료: `achievements`(검토 필요·빈 값 제외, 완료 판정), `skills`(normalized_name으로 기존 스킬 연결) + `project_skills` |
| 1-A2 | 첫 AI 턴 성공 후 차감 (A2 UQ-63) | 첫 사용자 메시지에서 `reserved` → 첫 턴 성공 시 `charged`, 실패 시 `released`(+ `usage_event_id` 비움, 다시 보내기가 다시 예약) |
| 1-A2 | 40개 상한에 AI 답 포함 (A2 UQ-77) | `canSendWritingChatMessage(count)` = 답까지 들어갈 때만 전송 허용. RPC 목과 S-36 입력 비활성이 같은 함수 사용. [UI-가정] 기획 확인 유지 |
| 1-A2 | 상수 export (A2 요청 5) | `lib/data/writing-chat-limits.ts`(클라이언트 안전): `WRITING_CHAT_MESSAGE_LIMIT`, `WRITING_CHAT_RETENTION_DAYS`, `canSendWritingChatMessage`, `daysUntilAutoDelete`. S-08·S-36의 로컬 상수 교체 |
| 1-A3 | `_lib/data.ts` → `lib/data/drafts.ts` | 완료(prepare*/finalize* 계약 유지). `_lib/actions.ts`는 영역 서버 액션이라 그대로 두고 import만 바꿈 |
| 1-A3 | `?generate=` 생성의 서버 검사 (A3 UQ-84 (a)) | `prepareCareerDescription` / `prepareCoverLetterSection`이 준비 상태(readiness `draft`)와 월 `draft` 한도를 다시 확인, 안 되면 `null`(예약 없음 → 화면은 기존처럼 멈춤). **input_hash 재사용은 흉내 내지 않음**(아래 건너뜀) |
| 1-A3 | `ApplicationSummary.insight_job_id` (A3 UQ-74) | 추가. JD 추출 완료 처리도 요약 계산 안에서 하므로 `listApplicationsForScreen` 삭제(S-13은 `listApplicationProjects` 사용) |
| 1-A3 | AI-04 `sources_selected` role/origin (A3 UQ-83) | `StreamSource { label, rationale, role?, origin?, requirement_ids? }`(`lib/mock/ai-stream.ts`), `useAiStream().sources` 타입도 같음. prepare가 실제로 채워 보냄. S-19가 배지를 그리는 것은 A3 몫 |
| 2 | 채점 작업이 `answer_evaluations`·`session_feedbacks` 생성 (UQ-48) | `evaluate done/total`이 오를 때마다 답변 평가 행이 하나씩 생기고(부분 결과), 끝나면 세션 피드백. 픽스처 세션 3(채점 중)에 질문 3·제출 답변 3 추가 |
| 2 | 답변별 다시 채점 (A4 요청 2) | `retryAnswerEvaluation(answerId)` / `retryAnswerEvaluationAction` — 그 답변만, 무차감, 세션 상태는 그대로. 실패하면 그 답변 `not_scored` |
| 2 | 질문 생성 재시도 시 `generating` (UQ-49) | `retryAiJob`이 결과 행을 진행 상태로 되돌림: 질문 생성 → `generation_status = 'generating'`, 세션 채점 → `status = 'evaluating'`, 인사이트 → `generating` |
| 2 | `match_stage_result` 채우기 + 타입 (A3 UQ-65) | `InsightMatchStageResult { schema_version, batches_done, batches_total, requirement_matches }`. 배치가 끝날 때마다 채움 → S-16 부분 판정 표가 보임(A3 파서와 호환) |
| 3 | `extraction.seniority` (A3 UQ-66) | `JdSeniority { min_years, max_years, label, source_sids }`, `JdExtraction` 타입. 픽스처 그린뱅크 "5년 이상". S-15가 `seniority.label`을 읽게 바꿈 |
| 4 | C-10 S-36 안에서 "AI와 대화하며 채우기" 숨김 (UQ-24) | 완료(`/career/writing-chats/*`) |
| 4 | `/dev/states` 프로덕션 404 (UQ-25) | 동기 기본 export에서 먼저 검사 → `pnpm start`에서 HTTP 404 확인 |
| 4 | `PreviewState` → `ErrorKind` | `previewErrorKind(state)` (`state-views.tsx`) |
| 4 | C-05 radix 선택 강조 | `has-data-[state=checked]:…` 추가 |
| 4 | `routes.project(id, { requirement_id })` (A2 요청 3) | 추가(+ `projectNew({ requirement_id })`). S-10 새/편집 화면이 "관련 요건: {content}" 표시(`RelatedRequirement`), S-16 보완점 "직접 입력"이 요건 ID를 넘김 |
| 4 | 정량 성과 "원본으로 이동" `?achievement=` (A2 요청 4) | `routes.projectDetail(..., focus, achievement)`, `routes.experience(id, { achievement })`. C-02 href가 사용. S-35·S-09가 `AchievementList openId`로 모달을 엶 |
| 4 | `routes.policies(doc?)` (A1 요청 2) | 추가. `policy-links.ts` 삭제, `routes.policies(type)`로 교체 |
| 4 | `routes.signIn(next)` + ST-UNAUTH (A1 요청 5 / UQ-100) | `routes.signIn(next?)`, `routes.consent(next?)`. ST-UNAUTH "로그인"이 현재 경로(`?state=` 제외)를 `next`로 넘김(`SignInLink`, `/career?state=unauth` → `/sign-in?next=%2Fcareer` 확인) |
| 4 | `FieldError` 아이콘 (UQ-103) | `CircleAlert` 추가 |
| 4 | 좁은 화면 탭 44px (UQ-105) | `TabsList` 높이 `h-11`, `md` 이상 `h-9` |
| 4 | 자소서 게이트 params 키 (A2 요청 7) | **`draft_id`로 확정**(A3가 이미 이 키로 보내고 A2가 읽음). 기능별 params 키를 `ReturnTargetInput.params` 주석에 정리 |
| 5 | 영역 우회 코드 정리 | A4: S-33 `generating` 보정 제거, S-22 답변별 "다시 채점"이 새 API 사용. A2: S-10 관련 요건, 정량 성과 링크. A1: policies/signIn 라우트 |

### 건너뜀 / 남은 것

- **A3 UQ-84 (c)~(g)**(`usage_events.ai_job_id`에 실제 작업 ID, user 모드 rationale, 살아 있는 원본 이름 라벨, 확정을 서버에서, AI-11 재사용)와 **(a)의 input_hash 재사용**: 목에 `ai_jobs` 행이 없는 스트리밍 생성 구조라 실제 백엔드(SSE Route Handler) 때 함께 처리하는 게 맞다고 봄. 생성 계획은 여전히 서버 메모리(globalThis)에 있어 서버를 재시작하면 생성 중이던 계획은 `settleAbandonedGeneration`이 정리한다.
- S-19 스트리밍 선택 카드에 role/origin 배지를 그리는 것은 A3 화면 몫(데이터는 이제 옴).
- A1 요청 6(mock 세션 로그인 상태)은 하지 않음(선택 항목).

### 옮긴 파일

| 이전 | 새 위치 |
|------|---------|
| `src/components/account/account-data.ts` | `src/lib/data/account.ts` (+ `safeNextPath` → `src/lib/routes.ts`) |
| `src/components/account/policy-content.ts` 일부 | `src/lib/data/consent-items.ts`, 정책 버전 → `src/lib/mock/fixtures.ts` `policy_versions` |
| `src/components/account/policy-links.ts` | 삭제(`routes.policies(doc)`) |
| `src/components/career/writing-chat/mock-turn.ts` | `src/lib/mock/writing-chat-turn.ts` |
| `src/components/career/writing-chat/chat-view.ts` | `src/lib/data/writing-chat-view.ts` |
| `src/components/career/writing-chat/slots.ts` | `src/lib/data/writing-chat-slots.ts` |
| `src/app/(dashboard)/applications/_lib/data.ts` | `src/lib/data/drafts.ts` (`listApplicationsForScreen` 삭제) |

### 손댄 영역 파일

- A1: `app/(public)/consent/page.tsx`, `app/(public)/sign-in/page.tsx`, `app/(public)/policies/page.tsx`, `app/(dashboard)/settings/page.tsx`, `app/(dashboard)/settings/withdraw/page.tsx`, `components/account/actions.ts`, `consent-form.tsx`, `consent-settings.tsx`, `deletion-summary.tsx`, `policies-view.tsx`, `policy-content.ts`
- A2: `components/career/actions.ts`, `career-tree.tsx`, `detail-form.tsx`, `experience-form.tsx`, `writing-chat/chat-screen.tsx`, `writing-chat/draft-preview.tsx`, 신규 `components/career/related-requirement.tsx`, `app/(dashboard)/career/projects/new/page.tsx`, `projects/[id]/page.tsx`, `projects/[id]/details/[detailId]/page.tsx`, `experiences/[id]/page.tsx`
- A3: `app/(dashboard)/applications/_lib/actions.ts`, `applications/page.tsx`, `[id]/drafts/page.tsx`, `[id]/drafts/[draftId]/page.tsx`, `[id]/jd/page.tsx`, `components/applications/application-list.tsx`, `draft-editor.tsx`, `drafts-view.tsx`, `source-tree.tsx`, `sources-used.tsx`, `insight-view.tsx`
- A4: `components/interviews/answer-sheet.tsx`, `result-view.tsx`, `actions.ts`(주석만)

### 새로 바뀐 데이터 계층 API

- `lib/data/account.ts`: `sendMagicLink`, `completeSignIn`, `signInWithGoogle`, `signOut`, `getConsentStatuses`, `recordConsents`, `setOptionalConsent`, `getPolicyVersions`, `getAccountDeletionSummary`(RPC 모양), `getRunningAiJobCount`, `deleteAccount`, `AccountRequestError`, `ConsentStatus`
- `lib/data/consent-items.ts`: `CONSENT_ITEMS`, `REQUIRED_CONSENT_TYPES`, `POLICY_TYPES`, `POLICY_TYPE_LABELS`, `isPolicyType`, `ConsentItem`
- `lib/data/writing-chats.ts`: `sendWritingChatTurn`, `retryWritingChatTurn`, `completeWritingChatTurn`, `markWritingChatSlotAsked`, `PlannedTurnView` (+ 기존). `lib/data/writing-chat-limits.ts`, `lib/data/writing-chat-slots.ts`, `lib/data/writing-chat-view.ts`(`buildChatView`, `ChatView`)
- `lib/data/drafts.ts`: A3 shim 함수 전부(`getCareerSourceTree`, `deriveAffiliations`, `rankDraftSources`, `create*Draft`, `addCoverLetterQuestion`, `deleteDraftSection`, `prepare*/finalize*`, `setSectionSources`, `markDraftCopied`, `markDraftEdited`, `settleAbandonedGeneration`, `retryJdExtraction`, 타입 `SourceTree`·`GenerationResult`·`SourceSelection`·`StreamPlanBlock`)
- `lib/data/applications.ts`: `ApplicationSummary.insight_job_id`, `getJdRequirement(id)`
- `lib/data/ai-jobs.ts` / `actions.ts`: `retryAnswerEvaluation` / `retryAnswerEvaluationAction`
- `lib/routes.ts`: `signIn(next?)`, `consent(next?)`, `policies(doc?)`, `project(id, { requirement_id })`, `projectNew({ …, requirement_id })`, `experience(id, { achievement })`, `projectDetail(…, focus, achievement)`, `safeNextPath`
- 타입(`types/db.ts`): `InsightMatchStageResult`, `JdSeniority`, `JdExtraction`. 목 저장소: `policy_versions`, `mock_chat_turns`
- 공통: `previewErrorKind`, `SignInLink`, `StreamSource`

### 검사 결과 (Phase 3)

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` — 통과
- `pnpm build` — 통과(36 페이지). `pnpm start`에서 `/dev/states` → HTTP 404 확인
- `pnpm exec next dev -p 3468`(확인 후 종료): 4개 영역 대표 경로 25개 + `/dev/states`(기본·insufficient) 모두 200. 확인 내용: S-30 버전 `2026-04-01`, S-15 "경력 조건: 5년 이상", S-10 "관련 요건: Kafka 등 메시지 큐 기반 비동기 처리 경험"(새/편집), `/career?state=unauth` → `/sign-in?next=%2Fcareer`, 채점 중 세션 S-22, 정량 성과 `?achievement=` 경로. 개발 로그 오류 0건. 브라우저 클릭(모달 자동 열림, 대화 턴 차감 시점, 부분 평가 카드)은 확인하지 않음 — QA 브라우저 확인 필요

---

## 최종 정리 (Phase 4, 2026-10-25)

통합 QA(`04_ui-qa_integration_review.md` UQ-120~128)와 A2·A3·A4 라운드 2 Minor를 반영했다. 이번 패스는 파운데이션·영역 파일을 모두 맡았다. 커밋하지 않음.

### 이슈별 처리

| ID | 처리 | 내용 |
|----|------|------|
| UQ-120 | 수정 | `components/ui/button.tsx`의 모든 크기가 768px 미만에서 44px(`max-md:h-11`, `sm`·`xs`는 `max-md:px-4`, 아이콘 크기는 `max-md:size-11`). Select 트리거도 `max-md:h-11`. 그래서 `StageCardMenu`·`StageChip`·C-10 버튼·ST-AI-FAILED 다시 시도·C-04 중단·C-09 버튼이 화면 쪽 처리 없이 44px. 서랍 메뉴·설정 `max-md:h-11`, 처리방침 링크 `max-md:min-h-11`. 보드의 감싸는 요소(`max-md:[&>button]:size-11`)와 C-16 확인 버튼의 `max-md:h-11`은 지움(이제 중복). 다른 화면의 `size-11 lg:size-8` 같은 기존 클래스는 해가 없어 그대로 둠. 참고: 본문 안 `link` 버튼(`h-auto`)도 좁은 화면에서 44px 높이가 됨 |
| UQ-121 | 수정(UQ-120으로) | 기업 JD 관리 화면의 `sm`/`icon-sm` 버튼·`SelectTrigger size="sm"`이 모두 공통 크기 규칙으로 44px. 따로 손댈 곳 없음 |
| UQ-122 | 수정 | S-20 진입 안내를 출발 메뉴가 아닌 **일회용 표시**로: 보드에서 옮긴 C-14 "면접 준비하기"만 `markBoardStageMove(apId)`을 남기고 S-20이 `consumeBoardStageMove`로 읽고 지움. 이동 경로 출발 메뉴는 지원 프로젝트 밖 화면(메뉴·커리어·S-36·설정)에 가면 모두 지움 → 이후 S-20/S-22/S-31/S-36 복귀에서 "지원 현황"이 남지 않음 |
| UQ-123 | 수정 | S-14(보드 진입) 토스트 "열기"가 `setNavOrigin("board", id)` 후 이동 |
| UQ-124 | 수정 | S-13 행 메뉴 이름 "{기업 JD 이름} 메뉴" |
| UQ-125 | 수정 `[UI-가정]` | S-31 삭제 후: 출발 메뉴가 지원 현황이면 S-39, 아니면 S-13 (FL-06 "출발 화면으로", 기획 확인 K-29) |
| UQ-126 | 수정 | 중단 문구가 둘 다 `AI_NOT_CHARGED`를 그대로 씀: S-19 "생성을 중단했어요. 사용량은 차감되지 않았습니다", S-36 "중단했어요. 사용량은 차감되지 않았습니다 · 다시 보내기" |
| UQ-127 | 해당 없음 | ui-designer 몫, 디자인 시스템 7 A-4로 정리됨(UQ-120에 반영) |
| UQ-128 | 수정 | `lib/data/labels.ts`에 `submitFailedMessage(대상)`("{대상}을(를) 저장하지 못했어요. 입력한 내용은 그대로 있어요")와 `actionFailedMessage(동작)`("{동작}하지 못했어요. 잠시 후 다시 시도해 주세요"). 적용: S-14(기업 JD), S-31(이름·마감일), S-03(동의 내용), S-25(탈퇴), S-36(정리 결과 저장 / 폼으로 전환), C-05(삭제), S-20(면접 시작), S-33(다시 시도·제출), S-22(다시 채점), S-19 생성 거절. 로그인 실패 문구(S-02)는 인증 안내라 그대로 |
| A2 UQ-83 | 수정 | S-36에서 1280px 이상(두 열이 함께 보이고 탭 목록 숨김)이면 두 열이 `role="region"` + `aria-label`("대화"/"정리 결과"), 탭 패널 역할·`aria-labelledby` 없음. 그 미만은 탭 그대로 |
| A3 UQ-85 | 수정 | S-19 스트리밍 선택 카드에 role(주 근거/보조)·origin(AI 선택/내가 추가) 배지(완료 후 C-11 행과 같은 모양) |
| A3 UQ-86 | 수정 `[UI-가정]` | 서버가 생성을 거절하면 prepare 액션이 `{ refused: "insufficient" | "limit" | "unavailable" }`을 돌려주고 S-19가 토스트로 이유를 알림(한도: ST-LIMIT 문구, 데이터 부족: 서류 초안 화면 확인 안내) |
| A3 UQ-87 | 수정 | `consumeReturnParams`가 복귀 대상의 `href` 경로와 현재 경로가 같을 때만 지움 → S-17이나 다른 S-19가 S-18용 대상을 가져가지 않음(모든 화면에 공통 적용) |
| A4 UQ-50 | 수정 | C-16 그만두기 확인 단계의 첫 포커스를 "취소"로 |
| A4 UQ-51 | 수정 | `getLatestJobFor(…, { jobType, sessionWide })` 추가. 세션 "다시 시도"는 답변별 재채점 작업을 건너뛰고 세션 전체 채점 작업만 재시도 |

### 손댄 파일

- 파운데이션: `src/components/ui/button.tsx`, `src/components/ui/select.tsx`, `src/components/common/shell/app-sidebar.tsx`, `src/components/common/shell/breadcrumbs.tsx`, `src/components/common/return-target.ts`, `src/components/common/stage-menu.tsx`, `src/components/common/delete-confirm-dialog.tsx`, `src/lib/data/labels.ts`, `src/lib/data/ai-jobs.ts`
- A1: `src/components/account/consent-form.tsx`, `src/components/account/withdraw-form.tsx`
- A2: `src/components/career/writing-chat/chat-screen.tsx`
- A3: `src/app/(dashboard)/applications/_lib/actions.ts`, `src/components/applications/application-new-form.tsx`, `application-list.tsx`, `hub-header.tsx`, `draft-editor.tsx`
- A4: `src/components/board/kanban-board.tsx`, `src/components/interviews/interview-prep.tsx`, `jd-picker-dialog.tsx`, `answer-sheet.tsx`, `result-view.tsx`, `actions.ts`

### 검사 결과 (Phase 4)

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` — 통과
- `pnpm build` — 통과(36 페이지)
- `pnpm exec next dev -p 3469`(확인 후 종료): A1 6개, A2 3개, A3 7개, A4 5개, `/dev/states`(기본·move-failed) 경로 모두 200, 버튼 HTML에 `max-md:h-11` 렌더 확인, 개발 로그 오류 0건. 브라우저 확인(좁은 화면 터치 크기 실측, 일회용 표시 흐름, 탭 역할 전환, 토스트)은 하지 않음 — 리더·QA 브라우저 확인 권장

## BYOK 파운데이션 (2026-10-28)

기준: `_workspace/ui/05_brief_byok.md`, design-system v2(3.18~3.22, C-03, 4장, 5.1, 5.7), 기획 PRD v4.2 · 플로우 v5.2 · AI v4.2 · 데이터 모델 v4.1a. 셸(sidebar-08 inset·아이콘 레일·상단 고정·설정 다이얼로그)은 그대로 두었다. 커밋하지 않음.

### 항목별 상태

| # | 범위 | 상태 |
|---|------|------|
| 1 | `types/db.ts` → v4.1a | 완료 (공급자·등급·키 상태 유니온, `AiErrorCode` 17값 / `AiErrorCategory` 5값 / `AiFailureCause` 7값, `ai_provider_keys`·`ai_data_use_consents`·`ai_usage_records`·`ai_price_tables`·`ai_disclosures`·`ai_providers`, `AiJob` v4 컬럼(`retry_count`·`next_run_at`·`failure_cause`·`quota_resets_at`·`retry_after`…), `DataReadiness.ai_connection`, `AiUsageSummary`. v3 `usage_events`/`usage_limits`/`UsageFeature` 삭제) |
| 2 | mock + `lib/data/` | 완료. 기본 픽스처 = Gemini 무료 키 연결·활성(`••••1a2b`), 무료 등급 동의, 이번 달 사용 기록 11건. 키 RPC(저장·확인·삭제·활성 전환·등급 변경), 가짜 AI가 원인별 실패·무료 등급 순차(2배 시간)·요청 한도 대기(`waiting_retry_until`)·`retry_after`/`quota_resets_at`을 만든다. 사용량 예약·차감·한도는 모든 곳에서 삭제(`lib/data/usage.ts` 삭제) |
| 3 | 공통 컴포넌트 | 완료: C-18 `AiLock`(영역/인라인) + `AiLockDialog`(C-14 키 없음 변형, `stage-menu`의 인터뷰 팝업에 연결), C-19 `ProviderBadge`·`ProviderResultTag`·`providerRunLabel`, C-20 `AiErrorNotice`(block/inline/field, 7원인 + 시스템·입력, KST 시각, 외부 링크) + `RetryButton`(카운트다운), C-21 `DataUseConsent`·`FreeTierNotice`, `AiRunButton`(UsageHint 대체), C-03 무료 등급 순차 줄·대기 줄(`Hourglass`), C-09 키 무효·대화 실패 분기. `UsageHint`·`LimitNotice`·`AiFailed` 삭제. `AiFailedInline`은 error_code가 없는 "부분 결과" 줄용으로만 남김 |
| 4 | 셸 | 완료: `NavAiStatus`(NavSecondary 첫 항목, 펼침=글자+점 / 레일=아이콘+모서리 점, 누르면 설정 다이얼로그 "AI 연결"), 설정 섹션 "AI 연결"(`PlugZap`)·"AI 사용량"(`Gauge`)을 계정 바로 아래에 추가 + 키 무효·확인 필요 경고 점, `openSettings(section)` 그대로 사용, 공급자별 장애 배너(활성 공급자만, 상태 페이지 링크, 세션 동안 닫기), AI 학습 고지 F-COM-03 v4 문구 |
| 5 | 라우트 + `?state=` | 완료: `/settings/ai`(S-40), `/settings/ai/usage`(S-42) 자리 표시, `/settings/ai/connect`(S-41) — `src/app/(focus)/` 라우트 그룹 + 셸 없는 레이아웃. `?state=` 신규: `ai-locked`·`key-invalid`·`key-check`·`key-missing`·`ai-waiting`·`ai-failed-rate-limited`·`-daily-quota`·`-billing`·`-key-invalid`·`-model`·`-provider`·`-input-rejected`(+ 기존 `ai-failed`=schema_invalid, `ai-failed-input`=not_a_jd, `ai-failed-timeout`). `limit` 삭제. `/dev/states`에 C-18·C-19·C-20 전 원인·C-21(`?state=consent`)·대기 줄·장애 배너 섹션 추가, ST-LIMIT 섹션 삭제 |
| 6 | `docs/ui/screen-status.md` | 완료: 기준 기획 줄 갱신, S-40/S-41/S-42 행(미착수) 추가, 영향 화면 "구현 중 (BYOK 반영)", 리더 결정(Q-4/Q-5/Q-6) 기록 |

### 영역 엔지니어용 — 데이터 계층 API (신규·변경)

- **연결 상태**: `getAiConnection()` → `AiConnection {active_provider, key_status, connection_tier}` (= `get_data_readiness().ai_connection`), `getAiConnectionState()` → `{connection, has_any_key}`, `getAiConnectionOverview()` → 공급자 카드 목록(`ProviderCardData`: `ai_providers` 행 + 사용자 키 공개 컬럼) + 이번 달 비용, `listProviderKeys()`, `getDisclosure(provider, tier)`, `needsDataUseConsent(provider, tier)`
- **쓰기(서버 액션 `lib/data/actions.ts`)**: `recordDataUseConsentAction({provider, connection_tier, free_tier_acknowledged, fail?})`, `verifyAndSaveProviderKeyAction({provider, connection_tier, raw_key, mock?})` → `KeyCheckResult` (`valid` / `limited` = 저장되고 `needs_check` / `rejected` = 저장 안 함 + `error_code`). mock 규칙: 접두사(`AIza`·`sk-ant-`·`sk-`)가 다르면 형식 오류, 끝 `0000` → `key_invalid`, 끝 `1111` → `rate_limited`(확인 보류), 첫 키는 자동 활성. `recheckProviderKeyAction`, `deleteProviderKeyAction`, `setActiveAiProviderAction`, `changeProviderTierAction`, `getAiConnectionAction`, `getAiConnectionStateAction`, `getAiConnectionOverviewAction`, `getAiUsageSummaryAction(periodMonth?)`. 키를 바꾼 뒤에는 클라이언트에서 `notifyAiConnectionChanged()` 호출
- **사용량 미터**: `getAiUsageSummary(periodMonth?, includePrevious?)` → `AiUsageSummary`(totals / by_feature 8행 고정 순서 `USAGE_FEATURE_ORDER` / by_provider / price_table_versions / previous_month), `getAiPriceTables(versions?)`
- **공급자 상수**(`lib/mock/ai-providers.ts`, 클라이언트 안전): `AI_PROVIDER_ORDER`, `AI_PROVIDER_LABELS`(Gemini/Claude/OpenAI), `AI_PROVIDER_FULL_NAMES`, `AI_PROVIDERS[p]`(dashboard/billing/status/key_issue/upgrade URL, description, default_tier, key_prefix), `MOCK_MODELS`, `DISCLOSURE_FACTS`
- **오류 규칙**(`lib/data/ai-errors.ts`, 클라이언트 안전): `errorCategoryOf(code)`, `failureCauseOf(code)`, `FAILURE_CAUSES`, `codeForCause(cause)`, `nextQuotaReset()`, `failureTimestamps(code)`
- **라벨**: `CONNECTION_TIER_LABELS`(무료 등급/유료), `MODEL_TIER_LABELS`(경량/기본/고성능), `KEY_STATUS_LABELS`, `AI_USAGE_FEATURE_LABELS`. 삭제: `USAGE_FEATURE_LABELS`, `AI_NOT_CHARGED`, `AI_FAILED_TITLES`
- **AI 작업**: `startAiJob(opts)`에 `reserve_units` 없음, `fail?: AiErrorCode`, `rate_wait?: boolean`(대기 줄 재현). 키가 없으면 `key_missing`으로 거절. `useAiJob().error`는 이제 `AiErrorCode`. `retry_count`(구 `attempt_count`). 스트림 오류 이벤트는 `{type: "error", error_code}`, `useAiStream().error`/`useChatTurnStream().error`도 `AiErrorCode`
- **기타 변경**: `startWritingChat`은 키가 없으면 `WritingChatLockedError`(액션은 `{ok: false, reason: "locked"}`), 키 없이 등록한 JD는 `extraction_status = 'pending'` + 작업 없음(→ `retryJdExtraction` = "요건 정리하기"), `getServiceStatus()` → `{affected_providers, active_provider}`, 탈퇴 요약 `ai {provider_keys, data_use_consents, usage_records}`, 초안 생성 거절 사유 `"insufficient" | "locked" | "key_invalid" | "unavailable"`
- **미리보기**: `previewErrorCode(state)`(구 `previewErrorCategory`), `isConnectionPreview(state)`

### 영역 엔지니어용 — 공통 컴포넌트 props

- `AiRunButton({children, lock: AiLockProps(size 제외), onRun?, href?, pending?, running?, runningSlot?, rerun?, disabled?, variant?, size?, type?, form?, connection?, hideBadge?, footer?, buttonClassName?})` — 키 없음 → C-18 인라인, 무효 → 누르면 C-20 `key_invalid` inline, 확인 필요 → 정상 실행, `rerun` → "다시 하면 공급자 토큰을 다시 써요", `running` → "이미 만들고 있어요", FL-19 복귀 직후 링 4초 + 토스트. `href`와 `onRun`을 함께 주면 링크 클릭 때 `onRun`도 실행
- `AiLock({entry, size: "area"|"inline", description?, alternativeLabel?, alternativeHref?, onAlternative?, alternativeNote?, actionName?, featureLabel?, returnHref?})` — `entry`: `writing_chat`·`requirements`·`insight`·`draft`·`interview_new`·`interview_submit`·`usage`(기능 설명·기본 대안 문구 내장). "AI 연결하기"는 저장된 키가 없으면 S-41, 있으면 S-40으로 가고 FL-19 복귀 대상을 기억
- `AiLockDialog({open, onOpenChange, interviewType, returnHref})` — C-14 키 없음 변형(파운데이션이 `InterviewPromptDialog`에 연결함)
- `AiErrorNotice({code, provider?, retryAfter?, quotaResetsAt?, size?: "block"|"inline"|"field", onRetry?, retryHref?, retrying?, retryLabel?, inputHref?, onFocusInput?, inputLabel?, reduceTarget?, hidePreserved?})` + `aiErrorFromJob(job)` → props, `aiErrorTitle(code, …)`, `RetryButton`, `ExternalProviderLink`, `formatKstTime`, `useNow`. `canceled`·`insufficient_data`는 렌더하지 않음
- `ProviderBadge({connection?})`, `ProviderResultTag({provider, model_tier?, model?})`, `providerRunLabel(session)`, `connectionLabel`, `connectionStatusText`
- `DataUseConsent({provider, tier, onBack?, onNext?({free_tier_acknowledged}), pending?, reconsent?, agreedAt?, footerError?})` — `agreedAt`를 주면 읽기 전용("동의함 · {시각}"). `FreeTierNotice`, `RESUMATE_AI_PRINCIPLE`
- `AiProgress`에 `connectionTier?`·`hideBadge?` 추가(머리 오른쪽에 C-19, 무료 등급 줄, 대기 줄). `AiProgressInline`은 대기 중이면 " · 대기 N초"
- `DataInsufficientGate`: `writingChat` prop 삭제, `chatFailure?: AiErrorCode` 추가(대화 첫 턴 실패 시). 키 무효면 자동으로 "직접 입력하기" + C-20 한 줄 + "AI 연결 확인"
- `AiConnectionProvider`(dashboard·focus 레이아웃에 장착), `useAiConnection(explicit?)`(?state= 반영, Suspense 안), `useAiConnectionBase()`(?state= 없음, Suspense 밖), `useAiConnectHref()`, `notifyAiConnectionChanged()`
- FL-19 복귀(`common/ai-connect-return.ts`): `markAiConnectReturn({href?, feature_label?})`, `readAiConnectReturn()`, `clearAiConnectReturn()`, **S-41 연결 성공 시 `completeAiConnectReturn()`**(돌아갈 href 반환, 없으면 S-40), `useAiConnectedHighlight()`
- S-40/S-42 내용 컴포넌트 자리: `account/ai-connection-panel.tsx`(`AiConnectionPanel({variant: "page"|"section", onNavigate?})`), `account/ai-usage-panel.tsx`(`AiUsagePanel`) — 페이지·다이얼로그 섹션이 함께 쓴다. **A1이 실제 내용으로 교체.** 다이얼로그는 Suspense 밖이라 이 두 컴포넌트에서 `usePreviewState`·`useAiConnection`을 쓰면 안 된다(`useAiConnectionBase` 사용)

### 영역 파일 수정 목록 (삭제·이름 변경에 따른 호출부 정리)

기계적 변경(사용량 props·한도 분기 제거, `AiFailed`→`AiErrorNotice`, `previewErrorCategory`→`previewErrorCode`, `UsageHint`→`AiRunButton`/삭제, `error_category`→`error_code`, `reserve_units` 제거):
- `src/app/(dashboard)/applications/_lib/actions.ts`(인사이트 시작은 키 확인, 거절 사유 `locked`/`key_invalid`, `getUsageAction` 삭제)
- `src/app/(dashboard)/applications/[id]/drafts/page.tsx`, `.../drafts/[draftId]/page.tsx`, `.../drafts/[draftId]/questions/page.tsx`, `.../insight/page.tsx`, `.../interview/page.tsx`, `.../interview/[sessionId]/page.tsx`, `.../interview/[sessionId]/result/page.tsx`, `.../jd/page.tsx`
- `src/app/(dashboard)/career/writing-chats/[id]/page.tsx`, `.../writing-chats/new/page.tsx`, `src/app/(dashboard)/settings/withdraw/page.tsx`(빈 요약에 `ai` 0)
- `src/components/applications/draft-editor.tsx`, `sources-used.tsx`(재생성 확인 문구 "초안 1회가 차감돼요" → "다시 하면 공급자 토큰을 다시 써요"), `cover-letter-questions.tsx`, `drafts-view.tsx`
- `src/components/career/actions.ts`, `career/writing-chat/chat-start.tsx`, `career/writing-chat/chat-screen.tsx`
- `src/components/interviews/actions.ts`, `interview-prep.tsx`, `answer-sheet.tsx`(제출 = AiRunButton `interview_submit`), `result-view.tsx`
- `src/components/account/policy-content.ts`(AI 학습 고지 v4, 약관의 "이용 한도" 절 → "AI 연결과 비용", 처리방침 이용 목적에서 "이용 한도 관리" 삭제), `account/settings-sections.tsx`, `account/settings-section-list.ts`(셸 배선)

기계적 범위를 조금 넘은 것(삭제 후 화면이 막히지 않게 하려고 최소한으로 넣음 — 영역에서 다듬어 주세요):
- `insight-view.tsx`: 결과 없고 키 없으면 C-18 영역형, 결과 머리에 `ProviderResultTag`, 보완점 "AI와 대화하며 추가"를 AiRunButton으로
- `jd-view.tsx` + `jd/page.tsx`: `ExtractionFailed`가 `code`/`job`을 받도록 변경, 키 없이 등록된 JD용 `RunExtraction`(C-18 영역형 / "요건 정리하기")
- `application-new-form.tsx`: 만들기 옆 C-19 배지 + 키 없음 안내 한 줄(입력란 펼침은 A3)
- `chat-screen.tsx`: 대화 상단 C-19 배지, 실패한 턴 = C-20 inline

### 영역에 남은 BYOK 작업(파운데이션 범위 밖)

- A1: S-40·S-41·S-42 실제 내용(ProviderCard, StepIndicator, 키 입력·검증 패널, 사용량 표), S-41 좁은 화면 셸 안 변형 여부, S-03 동의 화면의 국외 전송 문구(`consent-form.tsx`·`lib/data/consent-items.ts`는 건드리지 않음)
- A2: S-08·S-10의 "AI와 대화하며 정리/보강" 시작점을 `AiRunButton`(`writing_chat`)으로, S-36 시작 화면 문구 정리
- A3: S-13·S-31 카드의 C-18, S-14 키 없음 입력란 펼침·기본 이름, S-16/S-19 결과 배지와 다시 생성 주석 위치 점검, S-15 `?state=ai-locked` 미리보기
- A4: S-20 무료 등급 순차 안내 `Alert`, S-20·S-37 "실행 공급자" 열(`providerRunLabel`), S-22 결과 배지, S-37 새 면접 C-18, 다시 채점 rerun 주석

### [UI-가정]

- `NavAiStatus`는 연결 상태를 아직 불러오지 못했을 때(첫 렌더) 점 없이 "AI 연결"로 보인다
- S-41 집중 화면은 좁은 화면에서도 셸 없는 레이아웃을 쓴다(design-system 5.7은 <1024에서 셸 안 페이지). 리더 결정 Q-5를 라우트 그룹 하나로 구현했기 때문
- C-19 유료 툴팁 "연결한 {공급자} 키로 실행돼요", 무효 툴팁 뒤 "눌러서 키를 교체하세요"(design-system 표 그대로)
- C-20: 서버 남용 방지·알 수 없는 코드 → "잠시 후 다시 시도해 주세요". 미리보기처럼 `quota_resets_at`이 없으면 다음 KST 16:00으로 계산. `rate_limited` 제목의 {N}분은 `retry_after` 기준 올림
- C-20 외부 링크 글자 "{공급자} 대시보드 / 결제 설정 / 상태 페이지", 모델 미지원의 "등급 업그레이드 안내" URL은 공급자 상수의 `upgrade_url`
- C-03 유료 기준 예상 시간(초): JD 15 · 인사이트 45 · 경력기술서 40 · 자소서 45 · 근거 고르기 15 · 질문 30 · 채점 40 (무료는 2배). 명세 예시는 인사이트 1분 30초뿐
- C-21 민감정보 주의 문구는 C-07 G-2 문장을 재사용, 공급자 정책 값(`DISCLOSURE_FACTS`)은 약관 확인 전 자리 표시
- 공급자 장애 배너 닫기는 브라우저 세션 동안 공급자별로 유지
- 약관 "AI 연결과 비용" 절 문구(법무 확정 전 임시)
- S-41 자리 표시의 `mode=replace|tier` 처리, `/settings/ai` 페이지의 `PageHeader` 설명 문구
- 초안 생성 거절 토스트(키 없음 / 키 무효) 문구

### 기획 확인 필요

- 결과 배지 조사: 명세 "Gemini · 기본로 만든 결과"는 받침 규칙상 "기본으로"가 맞다. 지금은 명세 글자 그대로 둠
- C-20 `daily_quota_exhausted` 제목이 "무료 한도"로 고정돼 있는데, 유료 등급의 일일 한도(Claude·OpenAI tier 한도)에도 같은 문구를 쓰는지
- C-09 "키가 없을 때 … 주 버튼을 '직접 입력하기'"를 구현했는데, 이때 C-20 한 줄은 보이지 않게 했다(키 무효·대화 실패일 때만). 맞는지
- C-14 키 없음 변형: 작성 중 세션이 있으면 이어 쓰기는 키 없이 되므로 기존 팝업("이어서 쓰기")을 그대로 보이게 했다. 키 없음 변형이 우선인지
- `AccountDeletionSummary.ai` 세 개수(키·동의·사용 기록)를 탈퇴 요약에 보여 줄지(04에 RPC 반환 형태 명시 없음)

### 파운데이션 → 리더 요청

- A1~A4 재배정 시 위 "영역에 남은 BYOK 작업" 목록을 근거로 써 주세요
- 브라우저 확인 필요: 연결 상태 클라이언트 로딩 후 배지·NavAiStatus 갱신, FL-19 복귀 링·토스트, RetryButton 카운트다운, 설정 다이얼로그 섹션 열기, C-14 키 없음 팝업

### 검사 결과

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` — 통과
- `pnpm build` — 통과(39 페이지, `/settings/ai`·`/settings/ai/usage`·`/settings/ai/connect` 포함)
- `pnpm exec next dev -p 3123`(확인 후 종료, 사용자 3000 포트는 건드리지 않음): `/career`, `/settings`, `/settings/ai`, `/settings/ai/usage`, `/settings/ai/connect`(+`?provider=gemini&mode=replace`), `/dev/states`(기본·ai-locked·ai-failed·ai-waiting·consent·key-invalid), S-16(기본·ai-locked·ai-failed-daily-quota·key-invalid), S-15, S-17, S-20(기본·ai-locked), `/board`, `/interviews`, S-36 새 대화(기본·ai-locked), S-14 모두 200. C-18 문구·C-20 일일 한도 문구·무료 등급 순차 줄·C-19 경고 배지 렌더 확인, 개발 로그 오류 0건. 브라우저 확인은 하지 않음

## BYOK 파운데이션 배치 (2026-10-28)

기준: `06_ui-qa_byok_foundation_review.md`(UQ-202~209, 211), `06_ui-qa_byok_A1_review.md`(UQ-262), `06_ui-qa_byok_A3_review.md`(UQ-232, 234, 239), `06_ui-qa_byok_A4_review.md`(UQ-320, 326), A1~A4 보고서 BYOK 절의 "파운데이션 요청". 커밋하지 않음.

### 항목별 상태

| 항목 | 상태 | 내용 |
|------|------|------|
| UQ-320 (Major) | 완료 | `submitInterviewSession`은 세션 상태(in_progress·미제출·질문 준비 완료)와, 채점할 답변이 있으면 키(`assertAiRunnable`)를 **먼저** 확인한 뒤에 답변·세션을 바꾼다. 거절이면 아무것도 바뀌지 않는다. 같은 규칙을 모든 AI 시작 함수에 적용: `createMockJob`(모든 비동기 작업), `startInsight`, `startInterviewSession`, `prepareCareerDescription`/`prepareCoverLetterSection`(기존 `generationAllowed`), `rankDraftSources`, `retryJdExtraction`(무효 키도 거절), `startWritingChat`(무효 키 → `key_invalid`), `sendWritingChatTurn`(키 없음/무효면 사용자 메시지를 추가하지 않음, A2 요청 10), `retryWritingChatTurn`, `retryAiJob`, `retryAnswerEvaluation` |
| 재연결 후 다시 시도 (FL-21) | 완료 | `retryAiJob`이 모든 원인(key_missing·key_invalid 포함)을 재시도한다. 먼저 키를 확인하고(실패 시 변경 없음), 작업을 **지금 활성 공급자·등급**으로 다시 고정한다. 실패·취소된 작업만 재시도하고 진행 중이면 그대로 돌려준다. `AiErrorNotice`는 `key_missing`/`key_invalid`라도 지금 쓸 수 있는 키가 있고 `onRetry`가 있으면 "AI 연결하기"/"키 교체" 대신 `RetryButton`을 보인다(UQ-321에 필요한 부분) |
| UQ-202 | 완료 | C-20 세 크기 모두 보이는 블록의 live region을 없애고, 시간이 지나도 바뀌지 않는 제목(분·카운트다운 없음)을 `sr-only role=status`로 한 번만 알린다 |
| UQ-203 | 완료 [UI-가정] | "입력 토큰"의 정의를 하나로: 04 RPC 컬럼 `totals.input_tokens`는 캐시 제외 그대로 두고, 화면에 보이는 모든 입력 토큰(표 행·previous_month·합계 카드)은 입력 + 캐시 읽기 + 캐시 쓰기. `displayInputTokens(totals)`(labels)를 A1 합계 카드에 적용 → 카드 = 표 합 |
| UQ-204 | 완료 | `PREVIEW_STATES`에 `consent`, `ai-failed-safety`(= `safety_blocked`) 추가 |
| UQ-205 | 완료 | 자리 표시 화면 문구에서 "ST-LIMIT" 삭제 |
| UQ-206 | 완료 (일부 유지) | C-18 인라인 설명·추천·대안 줄, "이미 만들고 있어요", C-21 원칙·동의함·비활성 이유 → `text-sm leading-5`. **AiRunButton 다시 하기 주석**("다시 하면 공급자 토큰을 다시 써요")은 design-system 3.22가 `caption`이라고 적어 12px로 유지 — QA와 디자인 문서가 어긋나면 디자이너 확인 |
| UQ-207 | 완료 | `AiRunButton`은 연결 상태를 알기 전(서버 `connection`도 컨텍스트 값도 없음)에는 비활성. `useAiConnectionLoaded`가 `null` 명시값을 "로드됨"으로 보던 문제도 고침 |
| UQ-208 | 완료 | `routes.aiConnection(provider?)` → `/settings/ai#provider-card-{provider}`. C-19 경고 배지(invalid/needs_check)와 C-09 "AI 연결 확인"이 해당 카드로 감 |
| UQ-209 | 완료 | `AI_TRAINING_NOTICE`를 `lib/data/labels.ts` 한 곳으로. `policy-content.ts`는 다시 내보내기만, `RESUMATE_AI_PRINCIPLE` = 같은 상수 |
| UQ-211 | 완료 | C-21 "다음" 비활성 이유 문장을 `aria-describedby`로 버튼에 연결 |
| UQ-262 | 완료 [UI-가정] | `CONNECTION_TIER_LABELS` = "무료 등급" / "유료 등급"(짝 맞춤). 02 C-19 예시 "Claude · 유료"와 달라 기획 확인 필요 |
| UQ-232 + A3 요청 2 | 완료 | `ensureJdRequirementsInDb()`: 요건 추출이 안 된 JD면 같은 서버 호출 안에서 AI-01을 먼저 끝내고(mock 1.5초, 원문 줄에서 요건 생성) 본 작업을 만든다. `startInsight`·`prepareCareerDescription`·`prepareCoverLetterSection`·`startInterviewSession`에 적용. A3 쪽 `ensureRequirements`/`ensureRequirementsAction`과 클라이언트 호출 4곳 삭제(`extractFirst` 안내 문구 prop은 유지) |
| UQ-234 | 완료 | `kstDateString`·`kstToday`·`defaultApplicationName`(labels). `applicationDisplayName`·`formatDate`가 KST 날짜를 쓰고, 키 없이 만든 JD 기본 이름도 "새 기업 JD (KST 날짜)". S-14의 로컬 `kstToday` 삭제 → labels 사용 |
| UQ-239 + A2 요청 9 | 완료 | 스트림 `error` 이벤트 = `{error_code, provider, retry_after, quota_resets_at}`. `useAiStream`/`useChatTurnStream`에 `errorInfo`. `prepare*`가 `provider`를 돌려주고 S-19가 그 값을 C-20에 넘긴다. AI 작성 대화의 실패한 턴은 원인과 함께 `writing_chat_turn` ai_jobs 행으로 남고, `ChatView.turnFailures[messageId]`로 새로 고침 뒤에도 실제 원인을 보인다(S-36 `FailedTurn` 연결) |
| A2 요청 8 | 완료 | mock 스트림 `rate_wait` 이벤트(`{seconds, until}`, `rateWaitSeconds` 옵션), 두 훅의 `waitSec`. S-36의 화면 쪽 대기 흉내(`waitForRateLimit`)를 이벤트로 교체 |
| UQ-326 | 완료 | `AiLockDialog`에 `onConnect`. C-14 키 없음 변형에서 "AI 연결하기"를 눌러도 보드 출발 표시(`setNavOrigin`)와 S-20 진입 안내(`markBoardStageMove`)를 남긴다 |
| A1 요청 2~6 | 완료 | `routes.aiConnect({..., activate})`; 공유 액션 `getAiPriceTablesAction`·`needsDataUseConsentAction`·`getRunningAiJobCountAction(provider?)`(모든 작업 유형); `badge` `recommend` variant; `DeleteConfirmDialog`에 `api_key` 대상(C-05 "API 키 삭제" 문구·진행 중 작업 수·대시보드 링크) → A1 S-40을 이 대화상자로 바꾸고 `KeyDeleteDialog` 삭제 |
| A3 요청 1·3·peek | 완료 | `createApplicationProject`/`createApplicationAction`이 `company_name`·`position_title`을 받아 JD에 source `user`로 저장(추출은 빈 값만 채움, S-14 연결). 자소서 문항·경력기술서 생성이 끝나면 실행 공급자 메타(`provider`·`model`·`model_tier`·`connection_tier`)를 섹션/초안에 기록. `peekAiConnected()` export → S-17의 세션 키 직접 읽기 교체 |
| A4 요청 2~4 | 완료 | `InterviewSessionRow.question_model_tier`/`evaluation_model_tier`(ai_jobs에서 도출, 테이블 컬럼 아님) + `providerRunLabel`이 이 값을 씀. `InterviewSessionDetail.questions[].evaluation_error`(평가 실패 답변의 작업 원인 — `answer_evaluations`에 error_code 컬럼이 없어 ai_jobs에서). `submitInterviewSession(id, {rate_wait, fail})` + 액션 옵션 |
| 우회 코드 정리 | 완료 | A1 `account/actions.ts`의 BYOK 래퍼 4개 삭제(호출부 → `lib/data/actions`), A1 `connectHref`의 `&activate=1` 수작업 제거, `RecommendBadge` 인라인 토큰 → variant, S-17 세션 키 직접 읽기, A3 `ensureRequirements*`, S-14 로컬 `kstToday`, S-36 대기 흉내 |

### API 변경 (영역 엔지니어용)

- **거절 반환**: `lib/data/ai-errors.ts` `AiRejected {rejected: AiErrorCode}` + `isAiRejected(x)`, 서버 `lib/data/ai-guard.ts` `withAiGuard(fn)`. 다음 액션은 키 없음/무효면 throw 대신 `{rejected}`를 돌려주고 서버에서는 아무것도 바꾸지 않는다: `retryAiJobAction`, `retryAnswerEvaluationAction`, `startInsightAction`, `startInterviewSessionAction`, `submitInterviewSessionAction`, `retryEvaluationAction`, `retryQuestionGenerationAction`, `sendWritingChatMessageAction`, `retryWritingChatTurnAction`. 클라이언트 처리 도우미 `common/ai-rejection.ts` `notifyAiRejected(r)`(C-20 제목 토스트 + 연결 상태 다시 읽기). `useAiJob().retry()`는 거절이면 `error`를 그 코드로 바꾼다
- `startWritingChatAction` 실패 사유 `"locked" | "key_invalid"`
- mock: `assertAiRunnable(db)`, `retryMockJob(job, {fail, rate_wait}, db)`
- `completeWritingChatTurnAction(chatId, failed, errorCode?)`, `ChatView.turnFailures`
- 스트림: `StreamErrorEvent`, `StreamRateWaitEvent`, 옵션 `provider`·`rateWaitSeconds`, 훅 `errorInfo`·`waitSec`
- `ensureJdRequirementsInDb(db, apId)`(데이터 계층 내부용), `createApplicationProject({company_name, position_title})`
- `routes.aiConnection(provider?)`, `routes.aiConnect({provider, mode, activate})`
- `getRunningAiJobCount(provider?)`, 액션 3종, `badge variant="recommend"`, `DeleteTarget {kind: "api_key", entity_id: provider, is_active}`
- `peekAiConnected(pathname?)`, `AiLockDialog onConnect`
- labels: `AI_TRAINING_NOTICE`, `kstDateString`, `kstToday`, `defaultApplicationName`, `displayInputTokens`; `CONNECTION_TIER_LABELS.paid = "유료 등급"`
- `?state=consent`, `?state=ai-failed-safety`

### 건드린 영역 파일

- A1: `components/account/actions.ts`(래퍼 삭제), `ai-connection-panel.tsx`(액션 import, `connectHref`, 키 삭제를 `DeleteConfirmDialog`로, `KeyDeleteDialog` 삭제), `ai-usage-panel.tsx`(액션 import, 합계 입력 토큰), `key-connect-flow.tsx`(액션 import), `provider-card.tsx`(`RecommendBadge`), `policy-content.ts`(상수 다시 내보내기)
- A2: `components/career/actions.ts`(가드·사유·errorCode), `career/writing-chat/chat-screen.tsx`(거절 처리, 실패 원인 전달·`turnFailures`, 대기 이벤트)
- A3: `app/(dashboard)/applications/_lib/actions.ts`(`ensureRequirements*` 삭제, `startInsightAction` 가드, 회사명·포지션명), `components/applications/insight-view.tsx`(거절 처리), `draft-editor.tsx`(요건 선행 호출 삭제, 스트림 실패 정보), `drafts-view.tsx`(요건 선행 호출 삭제, `peekAiConnected`), `cover-letter-questions.tsx`(요건 선행 호출 삭제), `application-new-form.tsx`(`kstToday`, 회사명·포지션명 전달)
- A4: `components/interviews/actions.ts`(가드, 제출 옵션), `interview-prep.tsx`, `answer-sheet.tsx`, `result-view.tsx`(거절 처리만)

### 건너뛴 것·남은 것

- UQ-321(A4): 화면 쪽은 A4 몫. 파운데이션이 준 것 = `retryAiJob` 재연결 재시도 + `AiErrorNotice`의 key_missing 재시도 버튼. S-33/S-22가 `onRetry`를 넘기면 바로 동작한다
- UQ-324(A4): S-33·S-22에 서버 `ai_connection` 전달은 A4 몫(UQ-207로 첫 렌더 비활성은 이미 해결)
- 재시도 시 공급자가 바뀌면 mock 작업 길이(무료 2배)는 다시 계산하지 않는다(mock 한정)
- UQ-320 시나리오(키 삭제 후 제출)는 서버 액션을 직접 부르지 못해 코드 판독으로만 확인했다. A4 라운드에서 dev로 재현 확인 권장

### 기획 확인 필요 (추가)

- 등급 글자 짝: "유료 등급"으로 맞췄는데 02 C-19 예시는 "Claude · 유료"(UQ-262)
- S-42 입력 토큰 정의(P-B2): 표시 입력 토큰 = 입력 + 캐시 읽기 + 캐시 쓰기로 가정
- `key_missing` 뒤 재연결하면 같은 작업을 이어 하는지(A4 리뷰 기획 확인과 같은 건). 지금은 FL-21을 따라 재시도 허용

### 검사 결과

- `pnpm lint` 통과(오류·경고 0), `pnpm typecheck` 통과, `pnpm build` 통과(39 페이지)
- `pnpm exec next dev -p 3127`(확인 후 종료, 3000 포트 사용 안 함): A1(`/settings`, `/settings/ai`, `/settings/ai/usage`, S-41 2종) · A2(`/career`, `/career/skills`, S-36 새 대화 기본·key-invalid) · A3(S-13, S-14, S-31, S-15, S-16 기본·ai-waiting, S-17) · A4(S-20 기본·ai-locked, S-33, S-22, S-37, S-39) · `/dev/states`(기본·consent·ai-failed-safety·key-invalid) 26개 경로 모두 200, 개발 로그 오류 0건. 브라우저 확인은 하지 않음

## BYOK 최종 정리 (2026-10-28)

기준: `_workspace/ui/07_ui-qa_byok_integration_review.md`의 UQ-350~353. 커밋하지 않음.

### 항목별 상태

| 이슈 | 상태 | 내용 |
|------|------|------|
| UQ-350 | 완료 [UI-가정, 기획 B-24 대기] | `lib/data/labels.ts`에 기능 이름 고정 표 `AI_FEATURE_NAMES` 추가(요건 정리·인사이트·경력기술서·자기소개서·AI 근거 선택·면접 질문 생성·면접 채점·AI 작성 대화, S-42는 "AI 사용량"). 조사는 `returnToFeatureLabel(key)` / `directionParticle()`. `AiLock`에 `feature?: AiFeatureKey`를 추가했고, 없으면 `entry`별 기본값을 쓴다(writing_chat → AI 작성 대화, requirements → 요건 정리, insight → 인사이트, draft → 경력기술서, interview_new → 면접 질문 생성, interview_submit → 면접 채점, usage → AI 사용량). FL-19 복귀 대상 `feature_label`은 이제 이 표의 이름만 쓴다. 버튼 글자(`actionName`)는 접근 이름에만 쓰고, `featureLabel`은 영역형 `aria-label`에만 쓴다. C-14 키 없음 변형도 "면접 질문 생성"으로 바꿔서 S-20은 진입점과 상관없이 같은 이름이다. 호출부: 자소서 쪽 `draft` 진입점 5곳에 `feature: "cover_letter"`. A2의 `chatLock`과 행 단위 AI 보강 링크는 "AI 작성 대화"로 고정. S-20·S-37·S-16의 임의 `featureLabel`("면접 연습", "새 면접", "인사이트")은 삭제 |
| UQ-351 | 완료 | FL-19 "설정 복원"용 공통 장치: `markAiConnectReturn({..., params})` → `completeAiConnectReturn()`이 경로와 함께 보관 → 원래 화면이 `consumeAiReturnParams()`로 한 번 꺼낸다. `AiLock`/`AiRunButton lock`에 `returnParams` 추가. S-20은 `{interview_type, question_count}`를 넘기고 돌아오면 복원한다 |
| UQ-352 | 완료 | S-36 시작은 `{affiliation, experience_id, education_id}`를 넘기고(영역형 C-18·인라인 모두) 돌아오면 복원한다. 목록에 없는 id는 무시 |
| UQ-353 | 완료 | `AiRunButton`에 `aria-label` prop 추가(잠금일 때 `actionName`에도 쓰임). S-22 세션 다시 채점은 접근 이름을 "다시 채점"으로 고정하고, 남은 시간은 sr-only "{시각}부터 다시 채점할 수 있어요"를 `aria-describedby`로 한 번만 준다. 보이는 글자는 계속 "다시 채점 (0:42)" |

### 수정한 파일

- 파운데이션: `src/lib/data/labels.ts`, `src/components/common/ai-lock.tsx`, `src/components/common/ai-run-button.tsx`, `src/components/common/ai-connect-return.ts`
- A2: `src/components/career/gate-next-step.tsx`, `src/components/career/career-tree.tsx`, `src/components/career/writing-chat/chat-start.tsx`
- A3: `src/components/applications/cover-letter-questions.tsx`, `src/components/applications/draft-editor.tsx`, `src/components/applications/sources-used.tsx`, `src/components/applications/insight-view.tsx`
- A4: `src/components/interviews/interview-prep.tsx`, `src/components/interviews/interviews-overview.tsx`, `src/components/interviews/result-view.tsx`
- 보고서: `_workspace/ui/02_frontend-engineer-A0_report.md`

### 남은 것

- 기획 B-24: 진입점별 기능 이름(특히 S-42 "AI 사용량", S-37 새 면접 = "면접 질문 생성")이 확정되면 `AI_FEATURE_NAMES`만 고치면 된다
- `consumeAiReturnParams`는 S-41이 `completeAiConnectReturn()`을 부를 때만 채워진다(취소 시 복원 없음). 왕복 복원은 브라우저에서 확인하지 않았다

### 검사 결과

- `pnpm lint` 통과(오류·경고 0), `pnpm typecheck` 통과, `pnpm build` 통과(39 페이지)
- `pnpm exec next dev -p 3129`(확인 후 종료, 3000 포트 사용 안 함): `/career`, S-36 새 대화(기본·ai-locked), S-16 ai-locked, S-17, S-20(기본·ai-locked), S-33, S-22(기본·ai-failed-rate-limited), `/interviews`, `/board`, `/settings/ai`, S-41, `/dev/states?state=ai-locked` 15개 경로 모두 200, 개발 로그 오류 0건
