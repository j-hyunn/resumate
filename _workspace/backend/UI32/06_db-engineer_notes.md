# UI32-2 db-engineer 노트 — 근거·출처 라벨의 교육 이름 (2026-11-04)

## 규칙
교육 표시 이름 = `btrim(program_name)` → 비면 `btrim(institution_name)` → 둘 다 비면 null (사용자 결정, UQ-739 "근거 칩·서류 교육 이름").

## 마이그레이션
`supabase/migrations/20261113000200_ui32_education_display_labels.sql` (직전 `20261113000100` 뒤)

| 대상 | 변경 |
|------|------|
| `private.education_display_name(p_program_name text, p_institution_name text) returns text` | 신규. immutable, `coalesce(nullif(btrim(program),''), nullif(btrim(institution),''))`. public 실행 권한 회수 |
| `private.draft_source_parent_name(uuid, uuid, uuid)` | 교육 부모 = 위 헬퍼(기존 `institution_name` 원문). 경력(`company_name`)은 그대로 |
| `private.draft_source_label(...)`, `private.draft_sources_mark_project_deleted()` | 본문 변경 없음 — `draft_source_parent_name`을 호출하므로 새 규칙을 따름. 이를 쓰는 저장 RPC(S7 `20261102000300`/`0500`, R4 `20261109100700`/`101400`)도 자동으로 새 규칙 |
| `private.draft_sources_mark_education_deleted()` | `old.institution_name` → `education_display_name(old.program_name, old.institution_name)` |
| `private.backfill_education_display_labels() returns table(evidence_links_updated int, draft_sources_updated int)` | 신규(security definer, public 실행 권한 회수). 마이그레이션 끝에서 1회 호출. pgTAP에서 같은 규칙을 검증하려고 함수로 남김 |

다른 DB 함수/트리거 중 교육 이름으로 라벨을 만드는 곳은 없음(`grep institution_name` 결과: 테이블 정의, `evidence_links` source_field 허용 목록, 위 S7 트리거뿐). `evidence_links` 삭제 트리거는 라벨을 건드리지 않음.

public RPC 시그니처 변경 없음 → `database.types.ts` 재생성 안 함.

## 백필 규칙 (코드가 쓰는 라벨 형식 확인 후)
코드 형식: `career-pack.ts` 교육 별칭 label = `institution_name` 원문 → `evidence_links.source_label`(`storage/evidence-links.ts`). 프로젝트 별칭 label = 프로젝트 이름만(부모 없음). `draft_section_sources.source_label` = RPC가 `coalesce(draft_source_label(DB), payload)`로 저장, 형식 `"<institution_name> › <프로젝트>"` 또는 `"<institution_name>"`(교육만), 기관명 null이면 프로젝트 이름만.

1. `evidence_links`: `source_type='education'`이고 교육 행이 살아 있으면 → 표시 이름. 표시 이름이 null이면 기존 라벨 유지. 다른 source_type(프로젝트 등)은 부모 이름이 없으므로 손대지 않음.
2. `draft_section_sources` (education_id 있음, 교육 행 존재):
   - (a) 살아 있는 출처(`source_deleted_at is null`, project_id 없거나 프로젝트 존재) → `draft_source_label(...)` 재계산 = 지금 저장 RPC가 쓰는 값과 동일. null이면 유지.
   - (b) 프로젝트만 삭제된 행(`source_deleted_at` 있음, 프로젝트 없음, 교육 존재)이고 라벨이 정확히 `"<현재 institution_name> › "`로 시작하면 → `"<표시 이름> › <나머지>"`. 형식이 다르면(기관명이 그 사이 바뀐 경우 등) 유지.
   - 교육이 삭제된 행(원본 없음)은 그대로.
3. 경력 소속·독립 프로젝트 행은 대상 아님. 같은 값이면 갱신 안 함(멱등). `updated_at`은 기존 트리거대로 갱신됨.

## pgTAP
`supabase/tests/ui32_education_display_labels.test.sql` — 22개 통과. 헬퍼(트림·대체·null), 부모 이름/라벨 빌더(교육·경력·타 사용자), 프로젝트 삭제·교육 삭제 트리거 라벨, 백필(evidence 2건·출처 4건, 경력 행/형식 불명 삭제 행/원본 없는 행 미변경, 멱등, 빈 이름이면 evidence 라벨 유지), 권한(authenticated·app_ai_writer 실행 불가).

전체 `supabase test db`: 55 파일 중 이 슬라이스 무관 2개 실패 — `ai_provider_keys`(35: "nothing stored" have 2), `drafts_qa1`(14: 다른 ai_jobs 행 선택). 공유 로컬 스택에 다른 워크트리 데이터가 남아 생긴 것으로 보이며 이번 변경과 관계 없음. 기존 `drafts_career_deletion`(교육 program 없음 → 기관명 대체로 '한빛대 › 졸업 프로젝트' 유지)·`drafts`·`evidence_links` 통과.

로컬 적용: `supabase migration up --local` (이 브랜치의 미적용 3개 `20261111000100`, `20261112000100`, `20261113000100` 함께 적용). `db reset` 안 함. 원격 미접촉.

## 릴리스 노트
- 파괴적 아님(`-- DESTRUCTIVE:` 없음): 행 삭제 없음. 단 **기존 `evidence_links.source_label`·`draft_section_sources.source_label` 값이 바뀜**(교육 명이 있는 교육의 라벨이 기관명 → 교육 명). 되돌리려면 기관명으로 다시 계산 가능(원본 행이 살아 있는 경우만 바뀌므로 정보 손실 없음).
- 순서: 이 마이그레이션은 ai-pipeline/api 코드 변경과 같은 릴리스로 `db push` 후 머지. 코드보다 먼저 들어가도 문제 없음(DB가 저장 시 라벨을 재계산하고, 코드 쪽 payload 라벨은 DB 값이 null일 때만 쓰임).
- 백필 함수 `private.backfill_education_display_labels()`는 남아 있음(재실행해도 멱등).

## 라운드 2 (QA `07_backend-qa_report.md` 반영, 2026-11-04)

### QA-01 — SQL trim을 JS `trim()`과 같은 공백 집합으로 (해결)
- 마이그레이션이 아직 어디에도 push되지 않아 `20261113000200_ui32_education_display_labels.sql`을 그 자리에서 고쳤다.
- 새 헬퍼 `private.trim_js_whitespace(p_value text) returns text` (immutable, parallel safe, `search_path=''`, public 실행 권한 회수). ECMAScript WhiteSpace + LineTerminator 집합을 앞뒤에서 지운다: U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. U+0085는 JS처럼 남긴다(node로 대조 확인).
- `private.education_display_name`이 `btrim` 대신 이 헬퍼를 쓴다. 백필 (b)의 기관명 존재 확인(`nullif(btrim(ed.institution_name), '')`)도 같은 헬퍼로 바꿨다. (b)의 접두어 비교(`institution_name || ' › '`)는 코드가 원문 기관명을 그대로 썼던 형식과 맞추는 것이라 trim 없이 둔다.
- 규칙 표기 갱신: 교육 표시 이름 = JS `trim()` 기준으로 trim한 `program_name` → 비면 trim한 `institution_name` → 둘 다 비면 null.
- pgTAP 추가 5건(`ui32_education_display_labels.test.sql`): 탭만 있는 교육 명 → 기관명, U+3000 앞뒤 공백 제거, U+3000만 있는 교육 명 → NBSP·줄바꿈 제거된 기관명, 탭·CR/LF·BOM·em space만 → null, U+0085와 안쪽 공백은 유지.

### QA-03 — 백필 함수를 남겨 두는 이유 (해결)
- 함수 위 SQL 주석과 `comment on function private.backfill_education_display_labels()`를 추가했다. 내용: 1회 백필, 멱등(다른 행만 UPDATE, 삭제 없음), pgTAP이 같은 규칙을 검증하려고 남김, 운영자 전용(public 실행 권한 회수, 어떤 클라이언트·서버·AI 역할에도 grant 금지), 다시 돌려야 하면 postgres로만 실행.

### QA-04 — 공유 스택에서 깨지는 전역 집계 (해결, 요청 범위)
- `ai_provider_keys.test.sql`: service_role(RLS 우회)로 읽던 미범위 조회 6곳을 테스트 사용자 A(`aaaaaaaa-…-0001`)로 좁혔다. 106 "nothing stored after the refusals", 247 "checks never delete the key"(count), 그리고 같은 이유로 깨질 수 있는 `where provider = 'gemini'/'openai'` 단일 행 조회 4곳(114, 127, 161, 167 부근). 단언 값은 그대로라 검증 강도는 같다(사용자 A의 행이 하나라도 더 생기면 여전히 실패).
- `drafts_qa1.test.sql:95`: `ai_jobs` 전체 대신 `where user_id = 'a0000000-…-0001'`. 이 사용자의 job 4건이 정확히 기대 상태여야 하는 것은 그대로다.

### 로컬 적용
- `db reset` 없이 수정한 마이그레이션 파일 전체를 `psql -1 -f`로 한 트랜잭션에서 다시 실행했다(`create or replace` 함수 5개, revoke, comment, 백필 재실행 → `(0, 0)`). 마이그레이션 이력 테이블은 건드리지 않았다. 확인: `education_display_name(E'\t','한빛대')` = `한빛대`, `education_display_name(E'　데이터　','x')` = `데이터`, authenticated는 `trim_js_whitespace` 실행 불가.
- public 시그니처 변경 없음 → `database.types.ts` 재생성 불필요. 원격 미접촉.

### `supabase test db`
- 연속 2회: 55 파일, 2676 테스트, **PASS**.
- 그 직전 1회는 무관한 4개 파일이 실패했다: `career_description` #65, `drafts` #149·#151, `evidence_links` #9, `jd_extraction` #95. 모두 `count(*) from public.<table>`를 사용자 조건 없이 postgres로 세는 단언이다. 바로 다시 돌리자 통과했으므로, 같은 시각 공유 스택에 다른 세션이 쓴 행 때문으로 본다(이번 변경과 무관).
- 남은 위험: `supabase/tests/`에는 이런 미범위 `count(*) from public.<table>)`가 26개 파일에 96곳 있다(이 중 상당수는 authenticated + RLS 아래라 안전). 공유 스택에서 결정적으로 돌리려면 postgres/service_role 문맥의 것들을 테스트 사용자로 좁히는 별도 정리 작업이 필요하다. 이번 라운드 범위 밖이라 손대지 않았다.
