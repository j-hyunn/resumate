# UI32 백엔드 QA 리포트 (라운드 1, 2026-11-04)

범위: 교육 표시 이름 = trim한 `program_name`, 비면 trim한 `institution_name`, 둘 다 비면 `null` (UI32-1, UQ-734). 커밋되지 않은 변경(`git diff`)과 새 파일 `src/server/services/career/education-name.ts`, `education-name.test.ts`를 검사했다.

## 결론
코드 변경은 맞다. 서버 헬퍼는 UI 헬퍼와 같은 결과를 내고, 화면 3곳(C-23, S-10, S-43)과 새 프로젝트 페이지의 실제 분기 모두 새 이름을 받는다. mock 분기도 같은 규칙이다. 회귀는 없다. Critical·Major 이슈는 없고 Minor 3건이 있다. 그중 1건은 범위 밖 목록의 분류 보완이다. pgTAP 실패는 로컬 DB에 최신 마이그레이션 3개가 적용되지 않아서이며, 이 슬라이스와는 관계없다(아래 설명).

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `run-checks.sh` |
| lint | 통과 | |
| vitest | 통과 | 128 파일, 1995 테스트. 로컬 스택 통합 테스트도 실제로 돌았다(스킵 아님). 새 케이스 `career.integration.test.ts` "education display name (UI32-1)" ✓ |
| pgTAP | 실패 (환경 문제, UI32와 무관) | 54 파일, 2547 테스트 중 5개 파일에서 실패: `consents`, `policy_versions`, `signup_consent_ai_gate`(cross-border 버전 `2026-11-04.1`이 없음), `ai_provider_keys`(#35, 115행 "more than one row": 로컬 DB에 남은 데이터), `drafts_qa1`(#14). 원인: 로컬 DB에 적용된 마지막 마이그레이션이 `20261110000700`이다. 워크트리에 있는 `20261111000100_policy_versions_2026_11_04`, `20261112000100_inactive_account_deletion`, `20261113000100_policy_versions_cross_border_2026_11_04_1`이 적용되지 않았다. UI32는 `supabase/`를 건드리지 않았다(`git status supabase` 비어 있음). 로컬 DB에 마이그레이션을 다시 적용하지 않았다. 다른 워크트리와 같이 쓰는 스택이라서다. 다시 돌리려면 `supabase db reset` 후 재실행 |
| 로컬 스모크 | 통합 테스트로 대신함 | 바뀐 건 읽기 서비스뿐이고 route나 job 경로는 없다. 실제 사용자 세션 클라이언트로 `getCareerList`와 `getProjectDetail`을 호출하는 통합 테스트가 로컬 스택에서 통과했다. `pnpm dev` 스모크는 돌리지 않았다 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | 데이터 모델 ↔ 마이그레이션 | 해당 없음 (DB 변경 없음) | |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과. `educations.program_name`이 있다(`20261025000200_s2_educations.sql:10`). 사용자 세션으로 select가 되는 것을 통합 테스트로 확인했다 | |
| Q3, Q4 | RPC | 해당 없음 | |
| Q5 | 계약 ↔ 서비스 ↔ 화면 | 통과 (아래 상세) | |
| Q6–Q10 | SSE, AI 저장, enum, 작업, 보안 | 해당 없음 (보안: RLS 경로는 그대로이고 로그 추가 없음) | |
| Q11 | UI ↔ 백엔드 | 통과. mock과 실제 분기 이름이 일치한다 | QA-03 |
| Q12 | 실제 의존성 배선 | 통과. `career-v44.ts:38–40, 62–64` → `career.getCareerList` / `getProjectDetail` (사용자 세션) | |
| Q13 | 릴리스 | 해당 없음. 마이그레이션과 새 환경 변수 없음 | |

### (1) 서버 헬퍼와 UI 헬퍼의 동작이 같은가
- 서버 `src/server/services/career/education-name.ts:8–12`: `programName?.trim() || institutionName?.trim() || null`
- UI `src/components/career/education-name.ts:9–11`: `e.program_name?.trim() || e.institution_name?.trim() || null`
- mock `src/lib/mock/career-v45.ts:262–263`: 같은 식
- 식이 같으므로 경우마다 결과가 같다. null이나 undefined면 기관으로 넘어간다. 빈 문자열과 공백만 있는 값은 trim 뒤 `""`(falsy)가 되어 기관으로 넘어간다. 고른 값은 trim해서 돌려준다. 둘 다 비면 `null`이다. 서버 쪽은 `undefined`도 받지만 결과는 같다. 단위 테스트(`education-name.test.ts`)가 이 경우를 모두 다룬다.

### (2) select·매핑·계약·호출처
- `read.ts:60`: `getCareerList` select에 `program_name`이 추가됐다. `read.ts:65`에서 `name`에 규칙을 적용한다.
- `read.ts:121`: `getProjectDetail` 교육 select에 `program_name`이 추가됐다. `read.ts:128`에서 `parent.name`에 규칙을 적용한다. `edu`가 null이면 이전처럼 null이다.
- 계약 `src/lib/contracts/career.ts:618`은 주석만 바뀌었다. `CareerListItem`과 `ProjectDetailDto.parent`(`:654`)의 모양은 그대로다.
- 호출처(실제 분기)는 모두 새 이름을 받는다.
  - S-10 기존 프로젝트: `career-v45.ts:210` `detail.parent`(`getProjectDetail`)와 `:215–216` 소속 목록(`getCareerList`). 화면 `project-page.tsx:213`은 type과 id로 찾으므로 이름이 바뀌어도 매칭에 영향이 없다.
  - S-10 새 프로젝트: `career-v45.ts:269` 부모 이름(`EducationDetailDto.programName` 사용, `mappers.ts:80`)과 `:270–271` 소속 목록.
  - C-23 / S-43 소속 선택: `career-v45.ts:681–688` `listProjectAffiliations`.
  - S-08과 S-34는 원본 행 위에서 UI 헬퍼를 쓴다(`career-overview.tsx:66`, `educations/[id]/page.tsx:30`, `education-form.tsx:102`). 백엔드 경로를 거치지 않는다.
- mock 분기: `mockAffiliationName`(:273), `mockAffiliations`(:281), `mockAffiliationOptions`(:549) 모두 같은 규칙이다.
- `career-v45.ts:27`이 `@/server/...`를 import한다. 이 파일은 `import "server-only"`이고 같은 패턴의 data 파일이 이미 있어서 문제가 없다.

### (3) 다른 용도의 `name` 회귀
- 정렬: `year-view.ts`의 `compareListItems`는 startMonth, createdAt, id만 쓴다. `listProjectAffiliations` 정렬은 startMonth만 쓴다. name은 쓰이지 않는다.
- 매칭: `project-page.tsx:213`과 `affiliation-dialog.tsx`는 type과 id로 찾는다.
- 준비도: `getDataReadiness`와 `isEducationComplete`(`lib/data/career.ts:64`)는 원본 `institution_name`을 그대로 쓴다. 바뀌지 않았고 바뀌면 안 된다.
- AI 입력: `career-pack.ts`와 `career-rows.ts`는 자체 select를 쓰고 `CareerListItem.name`을 쓰지 않는다. 바뀌지 않았다.
- `getCareerList`와 `getProjectDetail`의 다른 호출처는 Server Action(`server/actions/career.ts:45, 53`)뿐이다. 컴포넌트에서는 쓰이지 않는다.
- → 회귀 없음.

### (4) 범위 밖 목록이 빠짐없는가
notes 목록(`evidence.ts`, `drafts.ts:135`, `drafts/read.ts:334·340`, `writing-chat/pipelines.ts:44·67`, `career-pack.ts`, `AI-03.ts`, `interview.ts`, `writing-chat-view.ts`)을 `grep institution_name src`로 대조했다. 커리어 화면에서 이름을 보여 주는 곳 가운데 `institution_name`에 남은 곳은 없다. 남은 것은 `education-form.tsx:52, 126`("기관명" 입력란)과 `career-overview.tsx:431`("운영 기관" 행)이고, 둘 다 기관 필드 자체라서 맞다. 다만 분류 한 곳이 틀렸다(QA-01). `writing-chat-view.ts:90`의 `educations` 목록은 지금 이것을 이름으로 그리는 컴포넌트가 없다(`grep educations src/components` 결과 없음). 지금 화면에 드러나는 곳은 없다.

## 이슈

### QA-01 [Minor] 범위 밖 목록: `career-pack.ts:302` 별칭 라벨은 화면에 나오는 라벨이다
- 담당: api-engineer (notes 보완). 기획 판단은 리더가 UQ-739에 덧붙인다
- 근거: notes는 `career-pack.ts:296·302·305`를 "AI 컨텍스트 팩… 필드로 넘기므로 표시 규칙과는 별개"로 분류했다. 그런데 `career-pack.ts:302`의 마지막 인자 `e.institution_name`은 별칭 항목의 `label`이고(`career-pack.ts:406–409`, `aliases.ts:19`), 이 값이 다음 경로로 화면에 나온다.
  - `evidence_links.source_label`로 저장된다(`ai/storage/evidence-links.ts:66`). 근거 칩에 보인다(`components/common/evidence.tsx:105–108`).
  - 서류 출처 라벨(`validation/draft-blocks.ts:169`, `selection.ts:101–102` `sourceLabel` "소속 › 프로젝트")과 `AI-03.ts:558` `institution_name: entry?.label`도 같은 값을 쓴다.
  - 값이 저장 시점의 스냅샷이므로, 규칙을 바꿔도 기존 행은 그대로 남는다. 또 `institution_name`이 비고 `program_name`만 있는 교육은 라벨이 null이 된다.
- 수정 제안: notes 범위 밖 목록에서 이 항목을 "표시 라벨(근거 칩·서류 출처, 저장 스냅샷)"로 다시 분류하고, UQ-739 확인 항목에 넣는다. 코드는 UQ-739 결정 뒤에 고친다.
- 상태: 열림

### QA-02 [Minor] 새 프로젝트 페이지 실제 분기(`career-v45.ts:269`)에 테스트가 없다
- 담당: api-engineer
- 근거: `getNewProjectPage`와 `listProjectAffiliations`를 부르는 테스트가 없다(`grep -rln "getNewProjectPage\|listProjectAffiliations" src` 결과에 테스트 파일 없음). 소속 목록(:270–271, :681–688)은 `getCareerList` 통합 테스트로 간접 확인된다. 부모 이름(:269)은 새 코드인데 실행하는 테스트가 없다.
- 수정 제안: `src/lib/data/career.integration.test.ts`의 v4.5 블록에 교육 부모 `getNewProjectPage({ education })` 케이스를 하나 추가한다. `parent.name`이 교육 명인지, 공백뿐이면 기관명이 되는지 확인한다.
- 상태: 열림

### QA-03 [Minor] mock 주석이 이제 사실과 다르다 (UI 소유 파일)
- 담당: frontend-engineer (resumate-ui)
- 근거: `src/lib/mock/career-v45.ts:261` "The real branches still get institution_name from the server (백엔드 요청, run 32)". UI32로 실제 분기도 같은 규칙이 됐다.
- 수정 제안: 주석을 "실제 분기는 서버 `educationDisplayName`(같은 규칙)"으로 바꾼다. 백엔드는 UI 소유 파일이라 손대지 않았다.
- 상태: 열림

### 참고 (이슈 아님)
- 같은 규칙이 세 곳에 따로 있다(UI 헬퍼, 서버 헬퍼, mock 인라인). 계획(`01_plan.md` "UI 헬퍼 import 금지")대로 한 것이다. 나중에 규칙이 바뀌면 세 곳을 같이 고쳐야 한다.
- notes의 "UI 소유 파일 수정 없음"은 api-engineer 변경 기준으로 맞다. `src/lib/mock/career-v45.ts`의 diff는 UI 32 런(frontend-engineer)이 만든 것이다(`_workspace/ui/32_frontend-engineer-A2_report.md:30`).

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- 새로 넘긴 항목 없음. QA-01은 이미 있는 UQ-739(근거 칩·서류·AI 라벨 기획 확인) 범위에 덧붙일 내용이라 리더에게 넘긴다.
