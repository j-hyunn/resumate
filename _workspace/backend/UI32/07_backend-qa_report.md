# UI32-2 백엔드 QA 리포트 — 근거·출처 라벨의 교육 이름 (2026-11-04)

범위: `05_plan_evidence-labels.md`, `06_db-engineer_notes.md`, `06_ai-pipeline-engineer_notes.md`, `06_api-engineer_notes.md`, 커밋되지 않은 변경 전체. 새 마이그레이션 `supabase/migrations/20261113000200_ui32_education_display_labels.sql`과 pgTAP `supabase/tests/ui32_education_display_labels.test.sql`도 포함한다.
규칙: 교육 표시 이름은 trim한 `program_name`이다. 비면 trim한 `institution_name`, 둘 다 비면 null이다. 근거 칩, 서류 출처 라벨("부모 › 프로젝트"), 작성 대화 부모 이름에 적용하고, 이미 저장된 라벨은 백필한다.

## 결론
Critical·Major 이슈는 없고 Minor 3건이 있다. 앱이 쓰는 데이터에서는 AI 저장 라벨, DB 저장 RPC 라벨, 백필 결과가 모두 같은 값이 된다. 앱 경로에서는 zod가 입력을 trim한다. 백필은 삭제 없이 멱등이고, 원본이 없는 행은 건드리지 않는다. AI-03과 요약 팩의 모델 입력은 이전과 같다. pgTAP 실패 2건은 공유 로컬 DB에 남은 개발 데이터 때문이며, 이번 변경과 관계없다(근거는 아래). 지시문의 `src/lib/lib/data/education-labels.test.ts` 경로는 존재하지 않는다. 실제 파일은 `src/lib/data/education-labels.test.ts`이고 위치도 맞다(아래 (5)).

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `run-checks.sh --build` |
| lint | 통과 | |
| vitest | 통과 | 129 파일, 2008 테스트. 로컬 스택 통합 테스트도 실제로 돌았다. `education-labels.test.ts`와 `education-name.test.ts`를 따로 돌려도 통과(2 파일, 6 테스트) |
| build (`pnpm build`) | 통과 | Compiled successfully, 정적 페이지 45/45 |
| pgTAP | 실패 2건 (UI32와 무관) | 55 파일, 2569 테스트. `ui32_education_display_labels` ok, `drafts`·`drafts_career_deletion`·`evidence_links` ok. 실패: `ai_provider_keys` #35, `drafts_qa1` #14. QA-04 참고 |
| 백필 엣지 시나리오 (수동) | 실행함 | 롤백 트랜잭션에서 로컬 DB에 실행. 기관명에 ` › `, `_`, `%`가 들어간 삭제 프로젝트 라벨은 정확히 치환된다. 공백 문자 차이는 QA-01 |
| 로컬 DB 백필 재실행 | `0|0` | 롤백 트랜잭션. 로컬 DB에 교육 근거·출처 행이 없어 실데이터 건수 확인은 못 했다 |
| 로컬 스모크 (`pnpm dev`) | SKIP | route나 job 경로 변경이 없다. 작성 대화는 실제 의존성으로 턴을 돌리는 통합 테스트(`writing-chat.integration.test.ts` UI32-2 케이스)로 대신했다 |

### pgTAP 실패 원인 — 공유 스택에 남은 데이터 (이번 변경과 무관)
- `ai_provider_keys.test.sql:106`: `select count(*) from public.ai_provider_keys`로 테이블 전체를 센다(사용자 조건 없음). 결과는 have 1, want 0이다. 로컬 DB에 남은 행은 `lab.jehyun@gmail.com` 사용자의 gemini 키 1건(2026-11-03 13:25 생성)이다. 테스트가 만든 행이 아니다.
- `drafts_qa1.test.sql:95`: `select … from public.ai_jobs order by id`로 역시 테이블 전체를 읽는다. 첫 행이 `0c734ddf-…`(writing_chat_turn, failed, 2026-11-03 13:59)이고, 같은 사용자의 수동 테스트 잔여 행 18건 가운데 하나다.
- 두 테스트 파일은 이번 변경에서 수정되지 않았다. 교육, `draft_section_sources`, `evidence_links`, 이번에 바뀐 함수 어느 것도 쓰지 않는다. → UI32와 무관하다. `db reset` 뒤에는 통과할 것으로 보지만, 공유 스택이라 reset은 하지 않았다.

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | 데이터 모델 ↔ 마이그레이션 | 해당 없음 (컬럼·CHECK 변경 없음) | |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과. public 시그니처 변경이 없어 타입을 재생성하지 않아도 된다. 새 select(`program_name`)는 기존 컬럼이다 | |
| Q3 | RPC ↔ 호출처 | 통과. `draft_source_label`·`draft_source_parent_name` 시그니처는 그대로다. 저장 RPC(`20261102000300:603`, `20261102000500:325`, `20261109100700:531`, `20261109101400:153`)는 수정 없이 새 규칙을 따른다 | |
| Q4–Q6 | 오류 코드, 계약, SSE | 해당 없음 (AI-04 `sources_selected`의 `label` 값만 새 규칙을 따른다) | |
| Q7 | AI 출력 ↔ 저장 | 통과 (아래 (2)) | QA-01 |
| Q8, Q9 | enum, 작업 종료 | 해당 없음 | |
| Q10 | 보안 | 통과. 새 함수는 모두 `search_path = ''`이고, public 실행 권한은 회수됐다. anon·authenticated·service_role·app_ai_writer·app_key_reader·authenticator 모두 실행 권한이 없다(`has_function_privilege` 확인). 로그 추가 없음 | |
| Q11 | UI ↔ 백엔드 | 통과 (아래 (6)) | |
| Q12 | 실제 의존성 배선 | 통과. `evidence-real.ts`·`drafts-real.ts`는 `select("*")`라 `program_name`이 들어온다. 작성 대화는 실제 writer 클라이언트로 통합 테스트를 거쳤다 | |
| Q13 | 릴리스 | 통과. `20261113000200`은 최신 파일 `20261113000100` 뒤에 온다. 비파괴(삭제 없음)이므로 `-- DESTRUCTIVE` 표기는 필요 없다. 라벨 값이 바뀐다는 점은 노트 릴리스 항목에 있다 | |

### (1) SQL 헬퍼와 TS 헬퍼가 같은 결과를 내는가
- SQL `…20261113000200…sql:15`: `coalesce(nullif(btrim(p),''), nullif(btrim(i),''))`
- TS `src/server/services/career/education-name.ts:11`: `programName?.trim() || institutionName?.trim() || null`. UI(`components/career/education-name.ts:10`)와 mock(`lib/mock/career-v45.ts:262`)도 같은 식이다.
- null, 빈 문자열, ASCII 공백, 앞뒤 공백, 둘 다 빈 경우: 결과가 같다(pgTAP 5건, TS 단위 테스트).
- **다른 경우**: Postgres `btrim(x)`는 ASCII 공백(U+0020)만 지운다. JS `trim()`은 탭, 줄바꿈, NBSP(U+00A0), 전각 공백(U+3000), BOM(U+FEFF) 등 유니코드 공백을 모두 지운다. 실측 결과 SQL은 `E'\t'`를 그대로 이름으로 돌려주고(TS는 기관명으로 넘어감), `'　데이터　'`는 전각 공백이 붙은 채로 돌려준다(TS는 `'데이터'`) → QA-01.

### (2) AI 저장 라벨과 DB 함수 결과가 같은가
- `evidence_links.source_label`: `career-pack.ts:306` 별칭 label → `storage/evidence-links.ts:66`에 그대로 저장된다. 백필 값은 `left(education_display_name(…),300)`이다. 이름이 100자 이하라 잘림은 없다. QA-01의 공백 경우를 빼면 같다. 둘 다 비면 TS는 null을 저장하고, 백필은 기존 값을 유지한다. 새 행에 null이 들어가는 것은 이전과 같은 동작이다.
- `draft_section_sources.source_label`: 저장 RPC가 `coalesce(private.draft_source_label(DB), payload)`이므로, 살아 있는 원본이면 항상 DB 값이 저장된다. 따라서 새 행과 백필 (a) 행은 정의상 같은 함수로 만든 값이다. TS `selection.ts:103–105` `sourceLabel`(부모 label + 프로젝트 label, 빈 값 제외, " › ")은 DB 값이 null일 때만 쓰이고, 형식도 `concat_ws(' › ', …)`와 같다.
- 서류 블록 `toEvidenceChips`(`draft-blocks.ts:169`): `storage/drafts.ts:10` "blocks carry no evidence"로, 칩은 SSE 이벤트와 `evidence_links`에만 들어간다. 백필 누락 저장소는 없다.
- `alias-text.ts:59` 기본 분기: 출력 문장에 남은 `EDU-n` 토큰이 이제 교육 표시 이름으로 바뀐다. 화면 문구라서 규칙과 맞다.

### (3) 백필 정확성과 안전성
- 정확 일치 치환 (b): `left(label, char_length(inst||' › ')) = inst||' › '` 비교라 LIKE 와일드카드 문제가 없다. 기관명에 ` › `, `_`, `%`가 들어 있어도 수동 시나리오 결과는 `'A › B_% › 사라진 › 과제'` → `'새 과정 › 사라진 › 과제'`였다. 형식이 맞지 않는 행(이후 기관명이 바뀐 경우)은 유지된다(pgTAP S8).
- 원본이 삭제된 행: 교육이 없으면 join에서 빠진다(pgTAP S6, EV5 유지). 프로젝트만 삭제됐으면 (b)만 적용된다.
- 경력 행과 프로젝트 근거 행은 손대지 않는다(pgTAP S7, e4).
- 멱등: `is distinct from` 조건이 있다. 두 번째 실행 결과는 `(0,0)`이다(pgTAP, 로컬 재실행).
- 삭제: 없다. UPDATE뿐이다. `updated_at` 트리거가 링크 행의 `updated_at`을 갱신하지만, "변경됨" 판정은 원본의 `updated_at`을 쓰므로(`services/evidence/index.ts:19–24`) 영향이 없다.
- 성능: UPDATE 3문을 한 트랜잭션에서 실행한다. `evidence_links`는 `source_type`이 앞에 오는 인덱스가 없어 순차 스캔이 되지만 Free 플랜 규모에서는 문제가 없다. (a)는 행마다 `draft_source_label`의 서브쿼리 2~3개를 돈다. 교육 소속 출처 행만 대상이라 작다. 단일 마이그레이션으로 괜찮다.
- 참고(이슈 아님): (a)는 살아 있는 출처 라벨을 현재 이름으로 다시 계산하므로, 그 사이 프로젝트 이름이 바뀌었으면 프로젝트 부분도 현재 이름이 된다. 교육 근거 칩 라벨도 "생성 시점 이름"(`lib/contracts/evidence.ts:77`) 대신 현재 표시 이름이 된다. 다만 살아 있는 출처는 화면에서 현재 이름(`drafts/read.ts:358–359`)을 쓴다. 출처 라벨은 삭제 트리거가 삭제 시점에 다시 쓴다. 그래서 사용자에게 드러나는 손실은 없다.
- **보안 정의자 백필 함수를 남겨 두는 것**: 받아들일 수 있다. 소유자는 postgres이고 ACL은 `{postgres=X/postgres}`뿐이다. 위 6개 역할 모두 실행할 수 없다. 원본에서 계산한 값만 멱등으로 쓰고, 행을 지우거나 사용자 입력을 받지 않는다. pgTAP이 같은 규칙을 검증하는 데 쓰므로 남길 이유도 있다. 원하면 나중에 정리 마이그레이션에서 `drop function`해도 된다(필수 아님).

### (4) AI-03 / summary-pack, prompt_version
- `summary-pack.ts:71`: `e.label` → `f.institution_name`이다. `fields.institution_name`이 `e.institution_name` 원문(`career-pack.ts:297`)이므로, 이전 label 값(`e.institution_name`)과 같은 문자열이다.
- `AI-03.ts:142` heading과 `:559` header: `fields.institution_name`을 쓴다. 이전 label과 같은 값이다. 테스트로 heading·header 텍스트를 단언한다.
- 모델에 label이 들어가는 다른 곳: `AI-04.ts:216`·`AI-05.ts:527`은 프로젝트 별칭만 넣고, `interview.ts:98`은 경력만 넣는다(교육은 `:103–104`의 원본 필드). `selection.ts` `sourceLabel`과 `alias-text`는 출력 쪽이다. `careerSnapshotHash`는 원본 필드로 계산한다(`career-pack.ts:356`).
- → AI-03, AI-04, AI-05, AI-11, 면접 팩의 모델 입력은 바이트 단위로 같다는 주장이 맞다. prompt_version을 올리지 않아도 된다. **예외**: AI-12 작성 대화의 모델 입력은 바뀐다(api-engineer 변경) → QA-02.

### (5) api 변경과 테스트
- `drafts/read.ts:335–347`: 교육 select에 `program_name`을 추가했고, 둘 다 비면 맵에서 빼서 `affiliationName: null`이 된다. 경력 쪽 null 의미와 같다. 테스트 3건(`read.test.ts`).
- `writing-chat/pipelines.ts:45–69`: 교육 부모 이름 = 표시 이름. 실제 턴 통합 테스트가 2건이다. 이 테스트는 사용자 세션으로 `' 클라우드 백엔드 부트캠프 '`를 trim하지 않은 원문으로 insert한다. 즉 zod를 거치지 않은 값이 DB에 들어갈 수 있다는 근거다(QA-01).
- `lib/data/evidence.ts:45–54`: `educationName`과 `parentName`이 생겼다. 저장된 `source_label`이 우선이고, 대체값과 경로(path)는 표시 이름이다. mock과 실제가 같은 경로를 쓴다.
- `lib/data/drafts.ts:137–138`: 이름은 표시 이름이다. `meta`는 교육 명이 있으면 `운영 기관 · 기간`, 없으면 `기간`만 보인다. 이 문구가 화면 명세와 맞는지는 노트의 UI 확인 요청에 있다. `project_labels`는 `a.name`을 따른다. `edus`는 complete만 다루므로 기관명이 반드시 있어 이름이 비지 않는다.
- 새 테스트 파일: **`src/lib/lib/data/education-labels.test.ts`는 존재하지 않는다**(`ls src/lib/lib` → 없음). 실제 파일은 `src/lib/data/education-labels.test.ts`이고, api 노트와 `git status`에 적힌 경로와 같다. 테스트 대상(`./drafts`, `./evidence`) 옆이고 vitest가 실행한다. 경로 오류는 QA 지시문의 오기이며 코드 쪽 문제는 없다.
- 앞 라운드 이슈: QA-01(별칭 라벨 분류)은 이번 수정으로 해소됐다. QA-02(`getNewProjectPage` 테스트)는 `career.integration.test.ts:284–304`로 해소됐다. QA-03(mock 주석)은 `lib/mock/career-v45.ts:260–261`이 갱신돼 해소됐다.

### (6) 화면에 기관명만으로 교육 이름을 보이는 곳이 남았는가
`grep institution_name|institutionName src`로 전수 확인했다. 남은 것은 모두 의도된 곳이다.
- 기관 필드 자체: `career-overview.tsx:431`("운영 기관" 행), `education-form.tsx:52·126`("기관명" 입력), `add-career-dialog.tsx:130·174`(입력 매핑), `mappers.ts:78·204`(DTO 필드).
- 판정과 매칭: `lib/data/career.ts:64` 완료 판정, `lib/mock/writing-chat-turn.ts:219` 미리보기 매칭(라벨 아님, api 노트 범위 밖).
- AI 원본 필드: `career-pack.ts`, `summary-pack.ts`, `interview.ts`, `evidence-rules.ts`.
- 예외(의도): AI-03 섹션 heading과 머리글(`AI-03.ts:142·559·588`)은 "운영 기관 교육 명"을 둘 다 보여 준다.
- `writing-chat-view.ts:27·90`: `institution_name`을 넘기지만 이름으로 그리는 컴포넌트가 없다(api 노트 확인과 같다).
- → 남은 표시 지점은 없다.

## 이슈

### QA-01 [Minor] SQL `btrim`과 JS `trim()`의 공백 범위가 달라 특정 입력에서 라벨이 갈린다
- 담당: db-engineer
- 근거: `supabase/migrations/20261113000200_ui32_education_display_labels.sql:15`(`btrim`은 U+0020만 지움) ↔ `src/server/services/career/education-name.ts:11`(`trim()`은 유니코드 공백 전부). 롤백 트랜잭션에서 실측했다.
  - `program_name = E'\t'`: 백필이 근거 라벨을 `"\t"`로 덮어쓴다. 화면에는 빈 칩으로 보인다. TS(새 AI 행과 화면 대체값)는 `'한빛대'`다.
  - `program_name = '　데이터　'`(U+3000): 백필, 부모 이름, 삭제 트리거 라벨이 `'　데이터　'`이고, TS는 `'데이터'`다.
- 범위: 앱의 쓰기 경로는 zod `text()`(`src/lib/contracts/career.ts:75–81`)가 유니코드 trim을 하므로 이런 값이 생기지 않는다. 하지만 authenticated에는 `educations` insert/update 권한이 있다(`20261025000200_s2_educations.sql:86–89`). 사용자가 PostgREST로 직접 쓰면 이런 값이 생기고, 통합 테스트도 trim하지 않은 값을 직접 insert한다. 영향은 그 사용자 자신의 라벨뿐이다. 전각 공백은 한국어 IME로 들어오기 쉽다.
- 수정 제안: SQL 헬퍼가 JS `trim()`과 같은 공백 집합을 지우게 한다. 예: `nullif(regexp_replace(p, '^[\s   -     　﻿]+|[…같은 집합…]+$', '', 'g'), '')`. 백필 (b)의 `nullif(btrim(ed.institution_name), '')`(`:118`)도 같은 헬퍼 방식으로 맞춘다. pgTAP에 `E'\t'`·U+3000 케이스를 추가한다. 고치지 않을 거라면 노트에 "앱 쓰기 경로 기준으로 같음"이라고 남긴다.
- 상태: 열림

### QA-02 [Minor] AI-12 작성 대화의 모델 입력이 바뀌었고, 교육 소속이면 기관명이 모델에서 빠진다
- 담당: api-engineer (판단은 리더)
- 근거: `src/server/services/writing-chat/pipelines.ts:69` → `src/server/ai/context-pack/writing-chat.ts:222` `affiliation: 교육 '<name>'`. 이전에는 `'가상대학교'`(기관)였고, 이제 `'컴퓨터공학'`(교육 명)이다. 작성 대화 팩에는 교육의 다른 필드가 없어, 교육 명이 있는 교육은 모델이 기관명을 보지 못한다. ai-pipeline 노트의 "모델 입력 바이트 동일"은 그 노트의 범위(AI-03/04/05/11/면접)에서만 맞고, AI-12는 해당하지 않는다. 프롬프트 템플릿은 그대로라 prompt_version을 올릴 필요는 없다.
- 수정 제안: 사용자 결정 "작성 대화 부모 이름에도 적용"을 따른 것이므로 그대로 둬도 된다. 다만 모델 맥락을 위해 `affiliation`에 기관명도 넣을지 리더가 확인해 달라(예: `교육 '컴퓨터공학' (가상대학교)`. 이 경우 AI-12 템플릿 변경이므로 prompt_version을 올린다). 유지한다면 api 노트에 "AI-12 모델 입력 변경(의도)"을 적는다.
- 상태: 열림 (리더 판단)

### QA-03 [Minor] 백필 보안 정의자 함수가 영구히 남는다는 점이 마이그레이션 주석에만 있다
- 담당: db-engineer
- 근거: `…20261113000200…sql:75–134`. 권한은 위에서 확인한 대로 문제가 없다. 이 함수는 모든 사용자 행을 한 번에 갱신하는 운영용 함수이므로 "누가, 언제 다시 실행해도 되는가"를 남겨 두는 것이 좋다.
- 수정 제안: 둘 중 하나. (1) 그대로 두고 함수 주석(`comment on function`)에 "멱등, 마이그레이션 1회 실행용, 실행 권한 없음 유지"를 단다. (2) 다음 정리 마이그레이션에서 drop하고, pgTAP은 같은 SQL을 테스트 안에서 직접 실행한다. 차단 사항은 아니다.
- 상태: 열림 (선택)

### QA-04 [Minor, UI32 무관] pgTAP 두 파일이 전역 집계를 써서 공유 스택 잔여 데이터에 깨진다
- 담당: db-engineer (별도 작업)
- 근거: `supabase/tests/ai_provider_keys.test.sql:106` `count(*) from public.ai_provider_keys`(`:247`도 같은 방식), `supabase/tests/drafts_qa1.test.sql:95` `from public.ai_jobs order by id`. 로컬 잔여 행(키 1건, ai_jobs 18건, 2026-11-03 생성)으로 실패한다.
- 수정 제안: 테스트 사용자 id(`user_id in (…)`)나 테스트 fixture id로 범위를 좁힌다. 그러면 `db reset` 없이 공유 스택에서도 결정적으로 통과한다.
- 상태: 열림 (이번 슬라이스 차단 아님)

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- 없음. QA-02(AI-12 입력에 기관명을 같이 넣을지)는 기획 판단이 필요할 수 있다. 리더가 UQ-739 후속으로 다룰지 결정한다.

## 라운드 2 재확인 (2026-11-04)

범위: `06_db-engineer_notes.md`와 `06_api-engineer_notes.md`의 "라운드 2" 절, 수정된 마이그레이션 `20261113000200_ui32_education_display_labels.sql`, pgTAP 3개 파일, `writing-chat.integration.test.ts`. 코드는 수정하지 않았다.

### 결론
QA-01부터 QA-04까지 모두 해소됐다. 새 이슈는 없다. 모든 검사가 통과했다(pgTAP 실패 0건).

### 이슈별 상태
| 이슈 | 상태 | 확인 내용 |
|------|------|-----------|
| QA-01 | **해소** | `private.trim_js_whitespace`가 지우는 문자 집합을 전수 대조했다. U+0001–U+10FFFF(서로게이트 제외)의 각 코드 포인트 c에 대해 SQL `trim_js_whitespace(chr(c)) = ''`인 집합과 node `String.fromCodePoint(c).trim() === ''`인 집합이 25개로 완전히 같다(09–0D, 20, A0, 1680, 2000–200A, 2028, 2029, 202F, 205F, 3000, FEFF). U+0085는 양쪽 모두 남긴다. 혼합 문자열의 앞뒤만 지우고 안쪽 NBSP는 유지되며, null은 null이다. `education_display_name(E'\t','한빛대')`는 `한빛대`, `(E'　데이터　','x')`는 `데이터`, 공백뿐인 두 값은 null이다. 백필 (b)의 기관명 존재 확인도 같은 헬퍼를 쓴다. 접두어 비교에 trim을 쓰지 않는 것은 코드가 원문 기관명으로 라벨을 썼던 형식과 맞추기 위한 의도이고, 맞다. 권한: anon, authenticated, service_role, app_ai_writer, app_key_reader, authenticator 모두 `trim_js_whitespace` 실행 권한이 없다. pgTAP에 탭, U+3000, NBSP·줄바꿈, BOM·em space, U+0085 케이스 5건이 추가됐다. |
| QA-01 (적용성) | **확인** | 롤백 트랜잭션에서 확인했다(`db reset` 하지 않음). 이 마이그레이션 직전 상태를 재현했다. 새로 만드는 함수 3개(`backfill_education_display_labels`, `education_display_name`, `trim_js_whitespace`)를 drop하고, 덮어쓰는 함수 2개(`draft_source_parent_name`, `draft_sources_mark_education_deleted`)를 직전 정의(`20261102000200`)로 되돌렸다. 그다음 마이그레이션 파일 전체를 `\i`로 `ON_ERROR_STOP` 상태에서 실행했다. 결과: CREATE·REVOKE 5쌍, COMMENT, 백필 `(0, 0)` 순으로 오류 없이 끝났다. 적용 뒤 헬퍼 결과와 함수 주석이 있는지 확인하고 ROLLBACK했다. 롤백 뒤 로컬 DB의 함수는 그대로 남아 있다. 덮어쓰는 두 함수의 시그니처와 반환형은 직전 정의와 같아 `create or replace`가 유효하다. 두 정의 사이에 끼어든 다른 마이그레이션도 없다. |
| QA-02 | **해소** | `git diff HEAD -- src/server/services/writing-chat/pipelines.ts`가 비어 있다(0줄). AI-12 경로(`context-pack/writing-chat.ts`, `focus-slots.ts`, `pipelines/AI-12*`, `AI-13*`)는 수정되지 않았고, 수정된 `career-pack.ts`·`summary-pack.ts`·`alias-text`·`education-name`을 import하지도 않는다. 따라서 AI-12 모델 입력은 HEAD와 바이트 단위로 같고, prompt_version은 그대로다. 통합 테스트는 두 경우(교육 명이 있음, 교육 명이 공백뿐)에 실제 턴을 돌려, 공급자 호출 기록에 `affiliation: 교육 '<institution_name>'`이 있고 교육 명은 없음을 단언한다. |
| QA-03 | **해소** | 함수 위 SQL 주석과 `comment on function private.backfill_education_display_labels()`가 있다. 내용은 1회 실행용, 멱등, pgTAP용으로 남김, 운영자 전용, 어떤 역할에도 grant 금지, postgres로만 재실행이다. 롤백 적용 테스트에서 주석이 실제로 생성되는 것을 확인했다. |
| QA-04 | **해소, 엄격도 유지** | `ai_provider_keys.test.sql` 6곳은 사용자 A(`aaaaaaaa-…-0001`)로 좁혔다. 줄 106 앞의 거부 시도(직접 insert 7건, `save_provider_key` 10건)는 모두 사용자 A가 대상이다(user_id가 없는 insert 1건은 `throws_ok`가 따로 잡는다). 줄 247까지 사용자 B의 저장은 모두 `throws_ok`로 거부된다. 따라서 범위를 좁혀도 검증하는 내용은 같고, 단언 값(0, 2, 'gm02' 등)도 바뀌지 않았다. `drafts_qa1.test.sql:95`는 `user_id = 'a0000000-…-0001'`로 좁혔다. 이 파일이 만드는 job은 모두 이 사용자 것이고 기대 행 목록도 그대로라, 여분 행이 생기면 여전히 실패한다. |

### 검사 실행 결과 (라운드 2)
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `run-checks.sh --build` |
| lint | 통과 | |
| vitest | 통과 | 129 파일, 2008 테스트(로컬 스택 통합 테스트 포함) |
| build (`pnpm build`) | 통과 | Compiled successfully, 정적 페이지 45/45 |
| pgTAP | **통과** | 55 파일, 2676 테스트, Result: PASS. 라운드 1의 `ai_provider_keys` #35와 `drafts_qa1` #14 실패가 사라졌다 |
| 공백 집합 전수 대조 (SQL ↔ node) | 일치 | 위 QA-01 |
| 마이그레이션 단독 적용 (롤백 트랜잭션) | 통과 | 위 QA-01 (적용성) |

### 참고 (차단 아님)
- db 노트의 "남은 위험"에 공감한다. `supabase/tests/`에는 사용자 범위 없이 전역으로 세는 `count(*)`가 아직 여러 곳 남아 있다. 이번 실행은 통과했지만, 다른 세션이 공유 스택에 동시에 쓰면 무관한 파일이 간헐적으로 실패할 수 있다. 별도 정리 작업 후보로 둔다.
