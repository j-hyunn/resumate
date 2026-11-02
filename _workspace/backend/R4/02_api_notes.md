# R4 API 구현 노트 (커리어 재설계 CR-1~CR-24, DM v4.4)

- 작성: api-engineer, 2026-11-02
- 기준: DM v4.4(2.3, 2.4, 2.5, 3.3, 4.1~4.3, 6, 7, 11), 유저 플로우 v5.5(S-08·S-09·S-34·S-43·S-44·S-10, C-05, C-09), PRD v4.5(F-P1-13·17~19), decisions 3.9, `02_db_notes.md`, `02_ai_notes.md`
- 커밋 안 함. 원격 Supabase 건드리지 않음.

## 결과 요약

| 검사 | 결과 |
|------|------|
| `pnpm typecheck` | 통과(0건) |
| `pnpm lint` | 통과(0건, 경고 0) |
| `pnpm vitest run` | **111 파일, 1,772개 전부 통과**(로컬 스택 통합 테스트 포함, 건너뜀 0) |
| `pnpm build` | 로컬 스택 환경 변수(`NEXT_PUBLIC_SUPABASE_URL`·`ANON_KEY`·`SUPABASE_JWT_SECRET`·`CRON_SECRET`)를 주면 통과(43 페이지). 환경 변수 없이 돌리면 정적 생성 단계에서 env 검증 오류로 실패 — `.env.local` 없는 작업 트리 문제, 코드와 무관(spec-gaps R4-API-9) |
| pgTAP | 실행 안 함(db 몫, db 노트 기준 통과) |

## 엔드포인트 (DM §7 v4.4 행 ↔ 파일)

| DM §7 행 | 방식 | 서비스 | 액션 / 라우트 | 데이터 계층(연결 대기) |
|----------|------|--------|----------------|------------------------|
| 커리어 목록 (S-08 왼쪽) | Server Component 읽기 | `services/career/read.ts` `getCareerList` + `year-view.ts` `groupCareerByYear`(시작 연도에 한 번, `연도 미정` 마지막, CR-4) | `actions/career.ts` `getCareerList` | `lib/data/career-v44.ts` `getCareerList` |
| 경력·교육 상세 (S-09·S-34) | 읽기 | `getExperienceDetail` / `getEducationDetail`(카드 = id, name, project_type, 기간, is_current; `start_month desc nulls last, created_at desc`) | — | `getExperiencePanel` / `getEducationPanel` |
| 독립 프로젝트 상세 (S-43) | 읽기 | `getStandaloneProjectDetail`(프로젝트 + 스킬 + 산출물 목록(본문 제외) + `deliverableLimitReached`). 소속 프로젝트 id면 null | `getStandaloneProjectDetail` | `getStandaloneProject` |
| 산출물 보기·편집 (S-44) | 읽기 / Server Action | `getDeliverable`, `save.ts` `saveDeliverable`(생성 = projectId + title, 이후 낙관적 동시성), `rpc.ts` `reorderProjectDeliverables` | `getDeliverable`, `saveDeliverable`, `reorderDeliverables` | `getDeliverable`, `saveDeliverable`, `reorderDeliverables` |
| 프로젝트 상세 (S-10) | 읽기 | `getProjectDetail`(프로젝트 + 부모 이름 + 대화 기록). 독립 id면 null(화면이 S-08 `?item=project:`로) | `getProjectDetail` | `getProjectPage` |
| 섹션 저장 | Server Action | `saveProject`(update만, 넘긴 컬럼만, `isCurrent: true` → `end_month` 비움). 경력·교육은 그대로 `saveExperience`·`saveEducation` | `saveProject`, `saveExperience`, `saveEducation` | `saveProjectSection` |
| 프로젝트 추가 (C-23, CR-6) | Server Action | `createProject({id?, name, affiliation})` → `draft`. 같은 클라이언트 id 재시도는 같은 행 | `createProject` | `createProject` |
| AI 작성 대화 시작 | Server Action → `start_writing_chat(p_project_id, p_return_target)` | `writing-chat/chat.ts` `startWritingChat` | `actions/writing-chat.ts` `startWritingChat` | `lib/data/writing-chats-v44.ts` `startProjectChat` |
| 대화 기록 목록 / 열기 | 읽기 | `listProjectWritingChats`, `getWritingChat`(칩·검토 필요 수·반영 가능 필드·잠금) | `listProjectWritingChats`, `getWritingChat` | `listProjectChats`, `getProjectChat` |
| 제안 카드 수정·수락/거절 | Server Action → `apply_structured_draft_patch` v3(사용자) | `applyDraftEdit`, `reviewDraftField` | `applyDraftEdit`, `acceptDraftField`, `rejectDraftField` | `editProposalField`, `reviewProposalField` |
| 대화 턴 | Route Handler SSE | `writing-chat/turn.ts` `prepareTurn`/`runTurn`, `pipelines.ts`(AI-12 v4.5) | `POST /api/writing-chats/{id}/turns`(변경 없음, 계약만 바뀜) | `turnRequest` |
| **반영** | Server Action → `apply_writing_chat_proposal` | `applyWritingChatProposal`(응답 + 갱신된 `structuredDraft`) | `applyWritingChatProposal` | `applyProposal` |
| 대화만 삭제 | Server Action → `delete_career_item('writing_chat')` | `deleteWritingChat` → `{messageCount, lastAppliedAt}` | `deleteWritingChat` | `deleteProjectChat` |
| 데이터 최소 기준 | RPC | `getDataReadiness`(v4.4 zod) | `getDataReadiness` | `lib/data/readiness.ts` `getDataReadinessV44` |
| 커리어 삭제 영향 / 삭제 | RPC | `rpc.ts` `getDeletionImpact`/`deleteCareerItem`(`affiliation_mode` 기본·유일 `delete_projects`) | `getDeletionImpact`, `deleteCareerItem` | `lib/data/deletion.ts` `getCareerDeletionImpact`, `deleteCareerEntity` |
| 탈퇴 범위 | RPC | `services/account` `career.projectDeliverables`(상세 내용·성과 삭제) | 그대로 | 그대로 |
| ~~연결 안 된 대화 90일 정리~~ | 폐기 | `jobs/retention.ts`에서 `purge_unlinked_writing_chats` 제거 | `/api/cron/retention` | — |

삭제한 것: `saveProjectDetail`, `saveAchievement`, `reorderProjectDetails`, `getCareerTree`(서비스·액션), `summary.ts`, `tree.ts`, `startWritingChatWithAffiliation`, `listWritingChats`/`listActiveWritingChats`, `setWritingChatAffiliation`, `saveWritingChat`, `handOffWritingChat`, `abandonWritingChat`, `resumeWritingChat`, `editDraftSkill/Detail/Achievement`, `daysUntilAutoDelete`(서비스).

## 계약 (`src/lib/contracts/`)

- `enums.ts`: `PROJECT_TYPES`(9)·`EXPERIENCE_TYPES`(7)·`COMPETENCIES`(10)·`MAX_COMPETENCIES = 3`·`STAR_FIELDS`·`CLASSIFICATION_FIELDS`(DB CHECK·`server/ai/classification.ts`와 같은 순서, 단위 테스트로 대조), `DELETABLE_ENTITY_TYPES`(+`project_deliverable`, −`project_detail`·`achievement`), `AFFILIATION_MODES = ["delete_projects"]`, readiness `hints`(`project_star`·`project_fields`·`profile`)·`next_action`(+`create_project`), `suggested_mode` 삭제, `EVIDENCE_SOURCE_TYPES`(+`project_deliverable`), `WRITING_CHAT_STATUSES = ["active","closed"]`, `CLARIFICATION_KINDS`(−`affiliation_unclear`), `DRAFT_PERIOD_FIELDS`, `APPLY_PROPOSAL_FIELDS`, `APPLY_PROPOSAL_SKIP_REASONS`, `WRITING_CHAT_SLOTS = SLOT_IDS`(`period`…`learnings`). `WRITING_CHAT_MODES`·`DRAFT_*_FIELDS`·`ACHIEVEMENT_KINDS` 삭제.
- `career.ts`: `CreateProjectInput`, `SaveProjectInput` v4.4(STAR ≤2,000, `description` ≤5,000, `linkUrl` http(s) ≤2,048, 분류 키, 역량 ≤3·중복 없음, `isCurrent`+종료월 동시 불가, `summary`·`teamSize` 없음), `SaveDeliverableInput`(제목 1~100, 본문 ≤20,000), `ReorderDeliverablesInput`(≤50), 삭제 입력(기본 `delete_projects`), `CareerDeletionImpact`(cascade = projects·project_deliverables·project_skills·writing_chats), `WritingChatDeletionImpact {message_count, last_applied_at}`, `DataReadiness` v4.4, DTO(`ProjectDto` v4.4 + `scope`, `ProjectCardDto`, `DeliverableSummaryDto`/`DeliverableDto`, `CareerListDto`, `ExperienceDetailDto`, `EducationDetailDto`, `StandaloneProjectDetailDto`, `ProjectDetailDto`, `DeliverableDetailDto`).
- `writing-chat.ts`: `StructuredDraft` = AI 파이프라인의 v3 스키마(`server/ai/schemas/structured-draft.ts`) 재수출(같은 파서 하나), `DraftFieldPath = {section: project|star|classification, field}`(= SSE FieldRef), `StartWritingChatInput {projectId, returnTarget?}`, `ApplyDraftEditInput`(구역별 값 검사: STAR 문자열 ≤2,000 / 기간 `YYYY-MM` / 분류 키·역량 1~3), `ApplyProposalInput {writingChatId, fields?}`, `ApplyProposalRpcResult`, `RequestedSlot {slot}`, `QuickChip {label, requestedSlot}`, `WritingChatDto`(title, status, lastAppliedAt, chips, needsReviewCount, applicableFields, canSend), `ProjectWritingChatSummary`.
- `evidence.ts`: 종류 라벨 `project_deliverable` "산출물", `PROJECT_FIELD_LABELS`("프로젝트 · 행동", `learnings` = "배운 점"), `EvidenceTarget`(project = `{projectId, field, standalone}`, `project_deliverable = {deliverableId, projectId}`; 상세 내용·성과 대상 삭제).
- `draft.ts`: 자소서 근거 선택에서 `projectDetailIds`·`detailTitles`·`project_detail_ids`·`SOURCE_DETAIL_IDS_MAX` 삭제.
- `account.ts`: 탈퇴 집계 `career.projectDeliverables`(상세 내용·성과 삭제).
- `application.ts`: `PENDING_DISPLAY_NAME = "새 자기소개서"`(CR-23, DB 기본 이름과 맞춤).

### SSE 턴 이벤트 (`POST /api/writing-chats/{id}/turns`, 순서는 DM §7 그대로)

| 이벤트 | 페이로드 |
|--------|----------|
| `turn_started` | `{jobId, userMessage, assistantMessageId, provider, connectionTier, messageCount, retry}`(그대로) |
| `reply_delta` / `reply_done` | 그대로 |
| `draft_patch` | `{structuredDraft(v3, RPC가 돌려준 값), changed: DraftFieldPath[]}` |
| `draft_flags` | `{needsReview, actorAmbiguous: DraftFieldPath[], sensitiveAdded, sensitiveFlagsCount, lengthFull: StarField[], clarifications}` — 파이프라인 `ExtractResult.flags`(V-9) 그대로 |
| `turn_done` | `{jobId, messageCount, remainingMessages, limitReached, closed, draftStatus, chips: QuickChip[3], readyToReturn, needsReviewCount, applicableFields}` — 칩은 `quickChips(이번 턴 프로젝트 STAR, RPC가 준 새 draft)`, 36개 이상·상한·closed면 `[]` |
| `error` | 그대로 |

`draftUpdated`·`progress`(옛 진행 단계)는 삭제.

## 작업 흐름 (턴)

- 흐름·재시도·사용 기록은 S4 그대로(C-11.3 스트림 첫 토큰 전만 즉시 재시도, 호출마다 `ai_usage_records` 1행, 무료 등급 순차 + 간격). 바뀐 점:
  - `closed` 대화 → `writing_chat_closed`(409). 시작 RPC가 독립 프로젝트를 거부(`writing_chat_requires_affiliated_project`).
  - `pipelines.ts`: 턴마다 `app_ai_writer`로 대화의 프로젝트 1행(STAR·분류·기간·`is_current`) + 부모 경력/교육 이름·상태 + 희망 직무를 읽어 AI-12 v4.5 입력을 만든다. 게이트 요건의 근거 텍스트 = 완료 프로젝트의 STAR·`role`·`description` + 산출물 제목. `WritingChatPipelines.turnState(snapshot)` 신설(칩 계산용 프로젝트 상태 + `readyToReturn`, provider 호출 없음).
  - `ExtractOutcome.flags` 추가(SSE `draft_flags` 원천).
  - `turn_done.closed` = `messageCount > 38`(DB `finish_assistant_message`가 닫는 조건과 같음). 마지막 응답이 실패해 `active`·40으로 남은 대화(R4-DB-5)는 `limitReached = true`·`canSend = false`·칩 없음, "다시 보내기"(`?retry=1`)만 가능.
- 반영(`apply_writing_chat_proposal`)은 AI·키를 보지 않는 사용자 세션 RPC라 작업·사용 기록이 없다.
- 면접 채점(AI-06): `sessionDeliverableProjectIds(careerRows, 세션 전체 질문 근거)`를 한 번 계산해 모든 답변 컨텍스트에 같은 값으로 넘긴다(`services/interview/job.ts`, `jobs/interview.ts`).

## 오류 매핑 (`src/server/db/errors.ts`)

추가: `writing_chat_closed`(409), `writing_chat_requires_affiliated_project`(409), `project_scope_change_not_allowed`(409), `deliverable_requires_standalone_project`(409), `deliverable_limit_reached`(409), `invalid_deliverable_order` → `conflict`(409), `project_skill_requires_standalone_project`(409), `affiliation_mode_not_supported` → `invalid_input`(400), `invalid_fields` → `invalid_input`, `field_too_long`(409, `details.fields` = RPC detail을 쉼표로 나눈 배열), `classification_already_set`(409), `field_already_applied`(409), `field_not_patchable` → `invalid_input`, `actor_mismatch` → `internal_error`. `invalid_writing_chat_transition` → `writing_chat_closed`. 삭제: `writing_chat_not_active`, `invalid_detail_order`, `detail_not_found`, `achievement_not_found`, `invalid_mode`·`project_required`·`project_not_allowed`·`invalid_affiliation`·`affiliation_not_found`·`affiliation_not_editable`. `invalid_period`는 기존 매핑 그대로(반영 RPC에도 적용).

## 근거·서류·인사이트·면접

- 근거 칩(`services/evidence`): 추적 대상에 `project_deliverable` 추가, 상세 내용·성과 삭제. "변경됨" = 프로젝트 `content_updated_at` / 산출물 `updated_at` > `source_snapshot_at`(DM 2.8). `isReflection` = `project.learnings`.
- 자소서 근거 선택(`services/drafts/cover-letter.ts`·`read.ts`·`types.ts`): `project_detail_ids` 컬럼·인자 제거, 근거 이름에서 상세 내용 제목 제거.
- 인사이트·면접 서비스는 상세 내용·성과 테이블을 직접 읽지 않음(AI 쪽 `CareerRows.deliverables`로 바뀜, 테스트 fake 갱신).

## 배선 (`src/lib/data/`, `src/types/db.ts`) — 호환 껍데기 목록 (UI 재작업 때 지울 대상)

UI 화면(S-08·S-09·S-34·S-10·S-35·S-11·S-36)과 `src/lib/mock/**`는 옛 모델 그대로라, UI가 import하는 이름은 지우지 않고 `@deprecated` 껍데기로 남겼다. **실제 경로**의 동작:

| 파일 | 껍데기 | 실제 경로 동작 |
|------|--------|----------------|
| `types/db.ts` | `Project`(summary·team_size 포함 v4.3b 모양), `ProjectDetail`, `Achievement`, `WritingChat`(mode·experience_id·education_id·saved_at), `DraftSectionSource`(= `DraftSectionSourceRow` + `project_detail_ids`), `WritingChatMode`, `WritingChatStatus`(옛 4값), `StructuredDraft`·`StructuredDraftProject`·`StructuredDraftDetail`·`StructuredDraftSkill`·`StructuredDraftClarification`(v1), `ProjectDetailField`, `EvidenceSourceType`의 `project_detail`·`achievement`, `ReadinessHint`·`ReadinessFeature`·`DataReadiness`(v4.3), `DeletionEntityType`·`AffiliationMode`·`DeletionImpact`·`AccountDeletionSummary`(v4.3) | 타입만 |
| `lib/data/career.ts` | `getCareerTree`/`CareerTree`(연도 트리) | v4.4 행으로 만든 옛 트리: 경력·교육은 시작 연도에 한 번 + 그 프로젝트 전부, 독립 프로젝트는 그 해 `other_projects`(시작월 없으면 `undated_projects`), `details`·`achievements`는 항상 `[]`, `active_writing_chats = []` |
| | `getProject`·`getExperience`·`getEducation`·`ProjectWithChildren`·`ExperienceWithChildren.achievements` | `toLegacyProject`로 매핑(`summary` = 독립 프로젝트 `description`, `team_size` = null), `details`·`achievements` = `[]`, 대화는 `toLegacyWritingChat` |
| | `getProjectDetail`, `getAchievement` | 항상 null |
| | `saveProjectDetail`, `reorderProjectDetails`, `saveAchievement` | `not_supported`(410) |
| | `saveProject(id, patch)` | 생성은 C-23 `createProject`(이름 비면 "새 프로젝트" `[가정]`), 이어서 섹션 저장. `role`·`summary`(→`description`)는 독립 프로젝트만, `team_size` 버림, 범위 변경은 DB가 거부 |
| | `setProjectSkills` | 그대로(소속 프로젝트면 `project_skill_requires_standalone_project`) |
| | `isDetailComplete`, `isAchievementComplete` | 순수 함수(미리보기용) 그대로 |
| `lib/data/writing-chats.ts` | `listActiveWritingChats`, `listAbandonedWritingChats` | `[]` |
| | `getWritingChat` | v4.4 행을 옛 모양으로(`mode = augment_project`, `closed` → `saved`, 소속 = 프로젝트의 소속, `structured_draft = {}`) |
| | `startWritingChat` | `augment_project` + `project_id`만 → `start_writing_chat(projectId)`. `new_project`는 `not_supported` |
| | `applyStructuredDraftPatch`, `setWritingChatAffiliation`, `saveWritingChat`, `handOffWritingChat` | `not_supported`. `toDraftFieldPath`는 항상 null |
| | `getWritingChatSaveSummary` | null |
| | `abandonWritingChat` | 무동작 / `resumeWritingChat`: `active` 대화면 그대로 돌려줌, 아니면 null |
| | `sendWritingChatTurn`, `retryWritingChatTurn`, `completeWritingChatTurn` | 그대로(실제 턴 라우트). `requestedSlot`은 STAR 슬롯만 `{slot}`으로, 그 밖은 null. 오류 코드 `writing_chat_closed` |
| `lib/data/deletion.ts` | `getDeletionImpact`, `deleteCareerItem` | v4.4 RPC → 옛 모양(`project_details`·`achievements` = 0, `writing_chat.linked_saved_rows` = `last_applied_at`이 있으면 1). `project_detail`·`achievement` → `not_supported`(410), 명시적 `keep_projects` → `affiliation_mode_not_supported`, **기본값을 `delete_projects`로 바꿈**(R4-API-2) |
| `lib/data/readiness.ts` | `getDataReadiness` | `toLegacyReadiness`: `project_star` → `complete_project_detail`, `writing_chat` → `augment_project` + 추천 프로젝트, `create_project` → `form`, 상세 내용 개수 0 |
| `lib/data/drafts-real.ts` | `realGetCareerSourceTree`, 문항 근거 행, `setSectionSources` | 상세 내용 없음(`project_details: []`, `project_detail_ids: []`), 근거 선택에서 상세 내용 id를 보내지 않음 |
| `lib/data/evidence(-real).ts` | 상세 내용·성과 `case` | 미리보기용으로 남김. 실제 경로는 산출물 행을 읽고 `project` 근거의 현재 값(STAR 필드)·`content_updated_at` 기준 상태를 계산 |
| `lib/data/account.ts` | 탈퇴 집계 `project_details`·`achievements` | 0(산출물 수는 옛 화면에 자리가 없어 안 보임) |
| `lib/data/actions.ts` | `abandonWritingChatAction`, `resumeWritingChatAction`, `listAbandonedWritingChatsAction` | 위 껍데기를 그대로 부름 |
| `lib/data/writing-chat-view.ts`, `writing-chat-slots.ts`, `writing-chat-limits.ts` | 옛 S-36 보기 모델 | 손대지 않음(실제 경로에서는 빈 v1 초안이라 진행 단계가 비어 보임) |

새 배선(연결 대기 — 새 화면이 import):
- `lib/data/career-v44.ts`: `getCareerList`, `getExperiencePanel`, `getEducationPanel`, `getStandaloneProject`, `getProjectPage`, `getDeliverable`, `createProject`, `saveProjectSection`, `saveDeliverable`, `reorderDeliverables`
- `lib/data/writing-chats-v44.ts`: `listProjectChats`, `getProjectChat`, `startProjectChat`, `editProposalField`, `reviewProposalField`, `applyProposal`, `deleteProjectChat`, `turnRequest`
- `lib/data/readiness.ts` `getDataReadinessV44`, `lib/data/deletion.ts` `getCareerDeletionImpact`·`deleteCareerEntity`
- `types/db.ts`: `CareerProject`, `ProjectDeliverable`, `ProjectWritingChat`, `StructuredDraftV3`, `DraftSectionSourceRow`, `ProjectType`·`ExperienceType`·`Competency`, `DataReadinessV44`, `CareerDeletionImpactV44`, `WritingChatDeletionImpactV44`, `DeletionEntityTypeV44`
- `lib/data/labels.ts`: `PROJECT_EVIDENCE_FIELD_LABELS`, 근거 종류 `project_deliverable` "산출물", 기본 이름 "새 자기소개서 (날짜)"(CR-23)
- 새 데이터 함수는 아직 `?state=` 미리보기 분기가 없다(mock 저장소가 옛 모델). UI 재작업 때 mock과 함께 붙인다.

UI 재작업 때 할 일: 위 껍데기 삭제 → `Project`/`WritingChat` 이름을 v4.4 타입으로 바꾸고 `*V44` 별칭·`toLegacy*` 삭제, `writing-chat-view`·`writing-chat-slots` 재작성(칩은 서버 값 사용).

## 테스트

- 단위: `contracts/career.test.ts`(v4.4 입력·readiness·삭제 입력), `services/career/career.test.ts`(매퍼·카드 정렬), `year-view.test.ts`(CR-4), `writing-chat/writing-chat.test.ts`(v3 diff·반영 가능 필드·칩·enum ↔ AI 목록 대조·오류 매핑), `turn.test.ts`(새 이벤트 모양, 40번째 응답 → `closed`, closed 대화 거부), `evidence.test.ts`, `db/errors.test.ts`, `retention.test.ts`(purge 제거), `drafts/read.test.ts`, `insight/*.test.ts`, `account.test.ts`.
- 로컬 스택 통합(실제 RLS·트리거·RPC): `services/career/career.integration.test.ts`(만들기·섹션 저장·DM-20 거부·범위 변경 거부·산출물·스킬 독립 한정·목록·S-09/S-10/S-43·readiness v4.4·삭제 v4.4), `writing-chat/writing-chat.integration.test.ts`(독립 프로젝트 거부, 턴, 실패·다시 보내기, 카드 수정, 반영·덧붙임·`field_too_long` 전체 거부, 대화 삭제 후 STAR 유지, 로그에 본문 없음), `lib/data/career.integration.test.ts`(껍데기 동작 + v4.4 데이터 계층 + 실제 턴 라우트), `w3`·`insight`·`drafts`·`application`·`account` 통합 테스트 갱신.
- `src/test/writing-chat-fakes.ts`: v4.4 스냅샷, `closed` 전이, `flags`·`turnState`.

## 스펙 차이·가정 (spec-gaps.md "R4 (api-engineer)")

- R4-API-1 산출물 insert 타입이 `sort_order`를 요구(트리거가 채움) → 한 줄 타입 우회, db에 기본값 요청
- R4-API-2 옛 삭제 화면의 `keep_projects` 기본값 → 껍데기 기본값 `delete_projects`, 명시적 `keep_projects`는 거부
- R4-API-3 옛 폼의 이름 없는 생성 → "새 프로젝트" `[가정]`
- R4-API-4 SSE 필드 이름 camelCase 유지(`readyToReturn` 등)
- R4-API-5 빠른 칩 숨김 36(UX `[가정]`)을 서버가 적용
- R4-API-6 반영 응답에 `structuredDraft` 추가, 왼쪽 STAR는 다시 읽기
- R4-API-7 옛 S-36은 v3 제안을 볼 수 없음(UI 재작업 전까지)
- R4-API-8 근거 "변경됨" = `content_updated_at`
- R4-API-9 `pnpm build`는 env 필요(코드 무관)

## 다른 팀원에게

- **db-engineer**: R4-API-1(`project_deliverables.sort_order` 기본값 또는 타입 처리). 그 밖 요청 없음.
- **ai-pipeline-engineer**: 인터페이스 그대로 썼다. 추가로 `WritingChatPipelines.turnState`는 api 쪽 `pipelines.ts`에서 `buildWritingChatContext` 결과(`input.project`, `focus.readyToReturn`)로 만든다 — ai 코드 변경 요청 없음. AI-06 `deliverableProjectIds` 배선 완료.
- **backend-qa**: QA 보고서 "다음 라운드 확인 항목" 1~7 반영(retention 크론, 오류 매핑, 턴 이벤트·칩·R4-DB-5 처리, enum 대조 테스트, 기본 이름·`PENDING_DISPLAY_NAME`, readiness 소비 코드, 전체 검사). 4번(결과 RPC payload의 `source_snapshot_at`·`source_locator`)은 서비스가 파이프라인 payload를 그대로 넘기는 구조라 바꾼 곳 없음 — 통합 테스트(인사이트·서류)에서 `project` 근거 저장·"변경됨" 판정을 확인했다.
