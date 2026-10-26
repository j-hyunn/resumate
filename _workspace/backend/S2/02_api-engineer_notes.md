# S2 API 구현 노트

## 엔드포인트 (DM §7 행 ↔ 파일)

| DM §7 / 계획 작업 | 방식 | 파일 · 함수 |
|------|------|------|
| 커리어 계층 조회(연도 묶음) S-08 | 서비스(페이지가 직접 호출) + Server Action | `services/career/tree.ts` `getCareerTree(supabase, now?)`, `actions/career.ts` `getCareerTree()` |
| 경력 자동 저장 S-09 | Server Action | `saveExperience(input)` |
| 교육 자동 저장 S-34 | Server Action | `saveEducation(input)` |
| 프로젝트 자동 저장 S-10 | Server Action | `saveProject(input)` |
| 상세 내용 자동 저장 S-35 | Server Action (부모 프로젝트 status를 함께 반환) | `saveProjectDetail(input)` |
| 정량 성과 자동 저장 S-11 | Server Action | `saveAchievement(input)` |
| 상세 내용 순서 변경 S-10 | Server Action → RPC `reorder_project_details` | `reorderProjectDetails(input)` |
| 스킬 태그 S-10 / 스킬 목록 S-12 | Server Action | `addProjectSkill`, `removeProjectSkill`, `addManualSkill`, `updateSkill` |
| 데이터 최소 기준 C-09/C-10 | Server Action → RPC `get_data_readiness` | `getDataReadiness()` (서비스는 app_ai_writer 클라이언트도 받음) |
| 커리어 삭제 영향 / 삭제 C-05 | Server Action → RPC `get_deletion_impact` / `delete_career_item` | `getDeletionImpact(input)`, `deleteCareerItem(input)` |

- 모든 액션: `requireConsentedUser()` → zod `safeParse` → 서비스 → `runAction`(AppError → `{ error: { code, message } }`). 쓰기는 전부 사용자 세션(RLS, DM-13).
- 서비스(Next 비의존): `src/server/services/career/` — `save.ts`, `skills.ts`, `rpc.ts`, `tree.ts`, `year-view.ts`, `summary.ts`, `mappers.ts`, `index.ts`.
- 스킬 삭제는 별도 액션 없이 `deleteCareerItem({ entityType: 'skill' })`.
- 편집 화면용 단건 조회(S-09/S-10/S-35)는 만들지 않았다. 트리 하나에 필요한 행이 모두 있다(사용자당 수십 행, DM §2.4). 연결(wiring) 단계에서 화면이 단건 조회를 원하면 추가.

## 계약 (요청·응답, contracts 파일)

### `src/lib/contracts/enums.ts` (S2 추가, 마이그레이션 CHECK와 같음)
`CAREER_STATUSES`(draft, complete), `EMPLOYMENT_TYPES`(5), `EDUCATION_TYPES`(degree, course), `ENROLLMENT_STATUSES`(5), `SKILL_PROFICIENCIES`(3), `ACHIEVEMENT_KINDS`(quantitative, qualitative), `DELETABLE_ENTITY_TYPES`(6, `writing_chat`은 S4), `AFFILIATION_MODES`(keep_projects, delete_projects), `RESULT_MODES`(**keep_results, delete_results** — db 마이그레이션 값에 맞춤. 계획의 keep/delete와 다름), readiness 값 목록(`READINESS_MISSING`, `READINESS_HINTS`, `READINESS_NEXT_ACTIONS`, `READINESS_SUGGESTED_MODES`, `DATA_SUFFICIENCIES`).

### `src/lib/contracts/career.ts`
- 공통 규칙: 필드 camelCase. 년-월은 `'YYYY-MM'` ↔ DB `'YYYY-MM-01'`(`yearMonthToDate`, `dateToYearMonth`). 저장 입력은 부분 저장 — 키가 없으면 그대로, `null`/`''`이면 비움, 문자열은 trim. **`status`는 받지 않는다**(zod가 제거, DB 트리거가 계산).
- 자동 저장 입력: `{ id, expectedUpdatedAt?, ...필드 }` (QA-S2-03 반영). **`id`는 필수이며 클라이언트가 새 행에 `crypto.randomUUID()`로 만들고 그 행의 모든 저장에 재사용**한다. `expectedUpdatedAt`이 없으면 "생성 또는 수정", 있으면 수정만(동시성 검사). `expectedUpdatedAt`은 offset 있는 ISO 날짜시간(`z.iso.datetime({ offset: true })`).
  - id 검증은 `z.guid()`(8-4-4-4-12 hex 형식만, Postgres uuid와 같은 기준 — QA-S2-02). DB에서 돌아오는 id(readiness·삭제 결과)도 같음.
  - 년-월은 1900~2099만 허용(QA-S2-01).
  - `SaveExperienceInput`: companyName, startMonth, endMonth, isCurrent, jobRank, jobPosition, department, employmentType, summary. 같은 patch 안에서 end < start, isCurrent + endMonth면 거부.
  - `SaveEducationInput`: institutionName, educationType, programName, startMonth, endMonth, enrollmentStatus, description. enrolled + endMonth 거부.
  - `SaveProjectInput`: `affiliation: { type: 'experience'|'education', id } | { type: 'none' }`(두 컬럼을 항상 같이 써서 `num_nonnulls <= 1` 위반이 안 남), name, role, summary(≤200), startMonth, endMonth, teamSize(1 이상 정수).
  - `SaveProjectDetailInput`: projectId(생성할 때 필요, 수정 시 무시. 없으면 수정만 시도), title(≤100), situation, task, action, result, learnings(각 ≤2,000).
  - `SaveAchievementInput`: `target: { type: 'project_detail'|'experience', id }`(생성할 때 필요, 이후 고정. 없으면 수정만 시도), metricName, valueBefore, valueAfter(유한 number), unit, description.
- 응답: `SaveResult { id, status, updatedAt }`. 상세 내용은 `SaveProjectDetailResult = SaveResult & { sortOrder, project: SaveResult }` — 상세 내용 저장이 프로젝트 status(그리고 그때만 `updated_at`)를 바꿀 수 있어서(DM §2.2·§4.2) 같이 준다.
- 삭제 응답: `DeleteCareerItemResponse = DeleteCareerItemResult & { updatedProjects: SaveResult[] }`(QA-S2-04). 상세 내용 삭제면 부모 프로젝트, 경력·교육 삭제(keep_projects)면 독립이 된 소속 프로젝트들의 현재 상태. 지워진 프로젝트는 넣지 않는다.
- **연결 단계 규칙(QA-S2-04)**: 열린 프로젝트 폼은 상세 내용 저장 응답의 `project.updatedAt`, 삭제 응답의 `updatedProjects[].updatedAt`을 다음 자동 저장의 `expectedUpdatedAt`으로 바꿔 넣는다. 그러지 않으면 거짓 `conflict`가 난다.
- 순서 변경: `ReorderProjectDetailsInput { projectId, orderedIds(1~200, 중복 금지) }` → `{ projectId, orderedIds }`.
- 스킬: `AddProjectSkillInput { projectId, name }`, `RemoveProjectSkillInput { projectId, skillId }` → `{ removed, skillDeleted }`, `AddManualSkillInput { name, proficiency? }`, `UpdateSkillInput { id, name?, proficiency? }` → `SkillDto`. 이름은 trim + 연속 공백 1칸, 1~50자. `normalizeSkillName()`은 DB generated 식과 같다.
- 삭제: `DeletionImpactInput { entityType, entityId, affiliationMode='keep_projects' }`, `DeleteCareerItemInput`(+ `resultMode='keep_results'`). 응답 `DeletionImpact`, `DeleteCareerItemResult`는 **RPC jsonb 그대로(snake_case)** — DM §4.2/§6 문서 모양과 맞추기 위해. zod로 검증해서 DB와 어긋나면 `internal_error`.
- readiness: `DataReadiness`(DM §6 모양, snake_case). `ReadinessFeature`는 `ready`로 구분되는 union(not ready면 `next_action` 필수).
- 트리: `CareerTreeDto { experiences, educations, projects, projectDetails, achievements, skills, years, summary, isEmpty }` — 엔티티는 평평한 목록, `years`는 id로 참조.
  - `ProjectDto`에 `skillIds`, `detailCount`, `completeDetailCount`. `ProjectDetailDto`에 `filled`(STAR + 회고 채움 표시, 공백은 빔), `achievementCount`. `SkillDto`에 `projectCount`.
  - `CareerYearGroup { year: number | null, affiliations: [{ type, id, projectIds }], otherProjectIds }`. `year: null` = "연도 미정"(항상 마지막).
  - `CareerSummary`: 상태별 개수(완료·작성 중), `detailsWithoutResult`("결과가 빈 상세 내용 N건"), `projectsWithoutCompleteDetail`, `skillCount`.

### 오류 코드 (`src/server/db/errors.ts` 추가)
| DB | 코드 | HTTP | 메시지 |
|----|------|------|--------|
| P0001 `career_item_not_found` | `not_found` | 404 | 요청한 항목을 찾을 수 없습니다. |
| P0001 `invalid_entity_type` / `invalid_affiliation_mode` / `invalid_result_mode` | `invalid_input` | 400 | 입력값을 확인해 주세요. |
| P0001 `invalid_detail_order` | `invalid_detail_order` | 409 | 상세 내용 목록이 바뀌었습니다. 새로고침 후 다시 시도해 주세요. |
| 22007 / 22008 (날짜시간 형식·범위, QA-S2-01 — zod가 대부분 먼저 막음) | `invalid_input` | 400 | 입력값을 확인해 주세요. |
| 23503 (복합 FK — 남의/삭제된 부모) | `not_found` | 404 | 연결할 항목을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요. (저장 경로 `mapSaveError`) |
| 낙관적 동시성 불일치 | `conflict` | 409 | 기본 conflict 메시지 |
| 스킬 이름 중복(23505, updateSkill) | `conflict` | 409 | 이미 같은 이름의 스킬이 있습니다. |

- SSE: S2 해당 없음.

## 동작 결정 [구현 결정]
- **멱등 생성(QA-S2-03, QA-S2-08 보강)**: `expectedUpdatedAt`이 없고 생성 가능하면(상세 내용은 projectId, 성과는 target이 있을 때) 클라이언트 id로 insert. `<table>_pkey` 23505면 재시도된 생성으로 보되, **그 행이 만든 뒤 한 번도 수정되지 않았을 때만**(`updated_at = created_at`) 적용한다.
  - 원자성: PostgREST는 컬럼끼리 비교하는 필터가 없어서, 행을 읽어 `created_at`을 얻은 뒤 `update ... eq('updated_at', <created_at>)`로 compare-and-set 한다. 사이에 수정이 끼면 0행 → `conflict`.
  - 이미 수정된 행(`updated_at ≠ created_at`) → 쓰지 않고 `conflict`. 늦게 도착한 생성 재전송이 새 편집을 덮어쓰지 않는다.
  - 다른 사용자의 id: insert는 PK에 걸리지만 읽기가 RLS에 막혀 `not_found`(덮어쓰기·노출 없음).
  - 다른 unique 위반(스킬 이름, 상세 내용 sort_order)은 재시도로 보지 않는다.
  - DB 전제 확인(마이그레이션 읽기만): 7개 테이블 `created_at`·`updated_at` 모두 `default now()`(트랜잭션 시각이라 insert 때 같은 값), insert 트리거는 status·sort_order만 바꾸고, `set_updated_at`은 BEFORE UPDATE에만 걸려 있으며, 사용자에게 두 컬럼 쓰기 grant가 없다. 따라서 insert 직후 `updated_at = created_at`이 정확히 성립한다. 참고: 상세 내용 변경으로 프로젝트 status가 바뀌면 프로젝트 `updated_at`이 바뀌므로 그 뒤의 프로젝트 생성 재전송은 `conflict`(의도된 동작). 순서만 바꾼 상세 내용은 `updated_at`을 유지하므로 "수정"으로 치지 않는다.
  - `SAVE_RESULT_COLUMNS`에 `created_at` 추가(응답 DTO는 그대로).
- **연결 단계 규칙(QA-S2-08)**: 새 행은 **생성 응답이 오기 전에 다음 저장을 보내지 않는다**(입력은 클라이언트에 모아 둔다). 생성 응답 뒤의 모든 저장은 **항상 `expectedUpdatedAt`을 넣는다**(직전 응답의 `updatedAt`). `expectedUpdatedAt` 없는 저장은 "생성(또는 생성 재전송)"으로만 쓴다. 생성 재전송이 `conflict`면 행을 다시 읽어 화면을 맞춘다.
- **낙관적 동시성**: `expectedUpdatedAt`이 있으면 `update ... eq('updated_at', expected)`. 0행이면 행이 보이는지 다시 보고 있으면 `conflict`, 없으면 `not_found`. 바꿀 키가 없는 저장은 update를 보내지 않는다(updated_at을 올리지 않음). 자동 저장은 클라이언트가 직전 응답의 `updatedAt`을 다음 저장에 넣어 순서대로 보내야 한다.
- **부분 저장과 CHECK**: `isCurrent: true`나 `enrollmentStatus: 'enrolled'`를 보내면서 endMonth를 안 보내면 서버가 `end_month = null`도 함께 쓴다(저장된 종료월 때문에 CHECK에 걸리지 않게).
- **상세 내용 sort_order**: 생성 타입이 `sort_order`를 필수로 요구해서(타입 단언을 피하려고) 서비스가 `max + 1`을 계산해 넣는다. 동시 추가로 지연 unique(sort_order 쪽 23505)에 걸리면 한 번 재시도. 같은 id로 재시도된 생성은 PK 충돌 → update라 sort_order를 새로 차지하지 않는다.
- **스킬 태그**: normalized_name으로 기존 스킬을 찾고 없으면 `is_manual = false`로 생성(경합 23505면 재조회). 이미 연결된 태그는 성공으로 본다. 링크 생성이 실패하면 방금 만든 스킬을 지운다(고아 정리 트리거는 링크 삭제 때만 돈다). 직접 추가(`addManualSkill`)가 기존 태그 스킬과 같은 이름이면 `is_manual = true`로 바꾼다.
- **연도 보기**(`groupCareerByYear`, DM §2.4): 경력·교육은 시작~(종료 또는 올해) 모든 연도, 재직 중·종료월 없음은 올해까지. 시작월 없는 경력·교육은 "연도 미정". 프로젝트는 `coalesce(프로젝트 시작월, 소속 시작월)`의 연도 한 곳. 독립은 그 해 `otherProjectIds`, 연도가 없으면 "연도 미정". 올해는 Asia/Seoul 기준(`currentYearInSeoul`). 정렬: 연도 내림차순, 소속은 시작월 내림차순(같으면 경력 먼저), 프로젝트는 유효 시작월 내림차순 → 생성 순.
  - 프로젝트 연도가 소속의 활동 연도 밖이면(예: 입사 전 날짜) 그 해에도 소속 머리를 추가해 계층을 유지한다.
  - 소속 id가 트리에 없으면 독립 프로젝트로 취급(방어 코드).
- 트리에는 draft도 포함(화면이 "작성 중" 배지). `isEmpty` = 경력·교육·프로젝트가 모두 0(S-08 빈 상태).
- 텍스트 길이: DB CHECK가 있는 것(교육·프로젝트 summary·상세 내용·스킬·경력 summary)은 같은 값. DB에 제한이 없는 것은 앱에서만 제한 `[가정]`: 경력 companyName·department ≤100, jobRank ≤50, jobPosition ≤100, 프로젝트 name·role ≤100, teamSize ≤10,000, 성과 metricName ≤100, unit ≤30, description ≤2,000.

## db-engineer 요청
- (해결됨) `private.project_is_complete(uuid, text, text)`에 authenticated execute grant가 없어 사용자 세션 projects insert/update가 `42501`이었다. 통합 테스트로 발견 → db-engineer가 `20261025000300_s2_projects.sql`에 grant 추가, 로컬 반영 후 통합 테스트 통과.
- 추가 요청 없음.

## 테스트
- 단위
  - `src/lib/contracts/career.test.ts`(24): 년-월 변환, 부분 저장·빈 문자열·status 제거, 기간·재직·재학 규칙, enum·길이, affiliation/target union, 순서 중복, 스킬 이름 정규화, 삭제 기본 모드, readiness 모양.
  - `src/server/services/career/year-view.test.ts`(16): DM §2.4 규칙 전체(활동 연도, 재직·재학 중, 미래 시작, 프로젝트 시작 연도, 소속 시작 연도 대체, 기타 프로젝트, 연도 미정, 소속 시작월 없음, 범위 밖 프로젝트, 정렬, 알 수 없는 소속, 혼합) + Asia/Seoul 연도 경계.
  - `src/server/services/career/career.test.ts`(15): 매퍼(patch→컬럼, 행→DTO), `upsertRow` 흐름(insert / 동시성 필터 / conflict / not_found / 빈 patch / 23503), `sameInstant`, `summarizeCareer`.
  - `src/server/db/errors.test.ts`: S2 raise 코드 5개 추가.
- 통합(로컬 스택, `project_details` 테이블이 없으면 자동 skip): `src/server/services/career/career.integration.test.ts`(14) — 경력 draft→complete, stale `expectedUpdatedAt` → conflict, isCurrent CHECK 회피, 다른 사용자 수정·부모 연결 차단, 프로젝트 ↔ 상세 내용 상태 재계산, 남의 프로젝트에 상세 내용 차단, 성과 kind, 교육 enrolled, 스킬 재사용·고아 삭제·직접 스킬 유지, 재정렬·부분 목록 오류·남의 프로젝트, readiness, 트리 연도 묶음, 마지막 complete 상세 삭제 → 프로젝트 draft, 경력 삭제 시 프로젝트 독립.
- 실행: `pnpm test` (통합은 `supabase start` + `supabase db reset` 상태에서 자동 실행).
- QA 1차 대응 추가 테스트: 계약(id 필수, `z.guid()`, `expectedUpdatedAt` ISO 형식, 년도 1900~2099), `upsertRow`(PK 충돌 → update, 빈 재시도, 남의 id → not_found, 다른 unique는 재시도 아님, 생성 불가 → update만), `isPrimaryKeyViolation`, errors 22007/22008, 통합(같은 id 재시도 → 1행 + bob 재사용 차단, 상세 내용 저장 후 `project.updatedAt`으로 프로젝트 저장 성공, 상세 내용 재시도 sort_order 유지, 삭제 응답 `updatedProjects`).
- QA 2차 대응 추가 테스트: 단위 — 수정 안 된 행 재전송은 `updated_at = created_at` 조건으로 update, 빈 재전송은 현재 행 반환, 수정된 행 재전송 → conflict(쓰기 없음), 읽기와 update 사이 경합 → conflict, 남의 id → not_found. 통합 — "create → resend create (no edit)" 1행 유지 + bob 차단, "create → edit → resend same create" 편집 유지·재전송 conflict, 수정된 상세 내용의 생성 재전송 → conflict·행/sort_order 그대로.
- 결과(QA 2차 대응 후, 2026-10-25): `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(19 파일, 237 테스트 — S2 통합 16건 실제 실행), `pnpm build` PASS.
- 결과(QA 1차 대응 후, 2026-10-25): `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(19 파일, 234 테스트 — S2 통합 15건 실제 실행, S1 그대로 통과), `pnpm build` PASS. db-engineer의 QA-S2-04 DB 부분은 새 마이그레이션 없이 기존 동작 확인으로 끝나(02_db-engineer_notes) 이 결과가 최종 DB 기준이다.

## QA 1차 대응 (03_backend-qa_report.md)
| 이슈 | 조치 |
|------|------|
| QA-S2-01 | `expectedUpdatedAt` ISO 날짜시간 검증, 년-월 1900~2099, `errors.ts` 22007/22008 → `invalid_input` |
| QA-S2-02 | 입력·RPC 결과 id를 `z.guid()`로 |
| QA-S2-03 | 클라이언트 id 필수 + 멱등 생성(PK 충돌 → update), 남의 id는 `not_found` 유지 |
| QA-S2-04 | 상세 내용 저장 `project`, 삭제 응답 `updatedProjects` 반환 + 연결 단계 규칙 명시 |
| QA-S2-08 (2차, Major) | 생성 재전송의 PK 충돌 경로를 "한 번도 수정 안 된 행만, `updated_at = created_at` compare-and-set"으로 제한. 수정된 행은 `conflict`, 남의 id는 `not_found`. 연결 규칙 추가 |

## 스펙 차이·가정
- `RESULT_MODES`는 db 마이그레이션의 `keep_results`/`delete_results`를 따른다(spec-gaps 2026-10-25 항목의 `keep`/`delete`는 db-engineer가 정정 예정이라고 노트에 적음).
- 위 텍스트 길이 `[가정]`, 연도 보기 범위 밖 프로젝트 처리 `[구현 결정]`.
- `writing_chats`(active) 트리 포함, `entity_type = 'writing_chat'`은 S4.
- 연결(wiring): UI 화면 없음(`src/lib/data/`·`src/lib/mock/` 없음) → 대기.
