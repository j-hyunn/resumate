# S2 백엔드 QA 리포트 (라운드 2 · 최종)

> 범위: DB(마이그레이션 9개, pgTAP 4개 + grants 갱신, 생성 타입) + API(contracts·enums·errors·services/career·actions/career). AI 기능·SSE·사용량 원장·UI 화면 없음.
> 라운드 1 리포트 내용은 아래에 그대로 두고, 라운드 2 재확인 결과를 "라운드 2" 절과 각 이슈의 상태에 반영했다.

## 판정 (라운드 2)
**S2 `done` 가능.** 단, 미해결 Major 1건(QA-S2-08)이 있으니 리더에게 넘긴다. QA-S2-08은 QA-S2-03 수정으로 새로 생긴 회귀다.
- 라운드 1 Minor 7건 중 6건 수정 확인, QA-S2-07은 S4 메모로 decisions.md에 기록됨(S4에서 확인).
- QA-S2-08: 늦게 도착한 생성 재시도가 그 뒤의 편집을 아무 신호 없이 덮어쓸 수 있다. 지금은 UI가 연결되지 않아 사용자 영향이 없다. **A2 career 연결(wiring) 전에 고쳐야 한다**는 조건을 붙인다. 수정 라운드 한도(2회)를 다 써서 미해결로 둔다.

## 라운드 2 검사 실행 결과 (최종)
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 19파일 234개, skip 0(S2 통합 15건 실제 실행) |
| build (`--build`) | 통과 | |
| pgTAP | 통과 | Files=9, Tests=265 |
| 생성 타입 | 통과 | `supabase gen types --local` 결과 = `database.types.ts` |

## 라운드 2 이슈 상태
| ID | 심각도 | 담당 | 상태 | 확인 근거 |
|----|--------|------|------|-----------|
| QA-S2-01 | Minor | api | 수정됨(확인 완료) | `career.ts:48` 연도 1900~2099, `career.ts:96` `z.iso.datetime({ offset: true })`, `errors.ts:54` 22007/22008 → `invalid_input` |
| QA-S2-02 | Minor | api | 수정됨(확인 완료) | `career.ts:85` 입력 id `z.guid()`, `:282·300·316·341-344` RPC 결과 id도 `z.guid()` |
| QA-S2-03 | Minor | api | 수정됨(확인 완료) → 회귀 QA-S2-08 | id 필수 + 클라이언트 id insert, `<table>_pkey` 23505면 update(`save.ts:88-101`), 남의 id는 RLS로 `not_found`. 상세 내용 sort_order 23505 재시도와 PK 충돌 구분(`save.ts:199`) |
| QA-S2-04 | Minor | api, db | 수정됨(확인 완료) | DB: 부모 프로젝트는 status가 바뀔 때만 update(`..._project_details.sql:118-123`, 테스트 2건). API: 상세 내용 저장 `project`, 삭제 응답 `updatedProjects`(`rpc.ts:47-64`, 삭제 전에 영향 프로젝트 id를 모으고 삭제 뒤 다시 읽음). 연결 단계 규칙은 api 노트에 있음 |
| QA-S2-05 | Minor | db | 수정됨(확인 완료) | `grants.test.sql:55-65` `has_column_privilege` 전수로 INSERT/UPDATE/REFERENCES 없음 검사 |
| QA-S2-06 | Minor | db | 수정됨(확인 완료) | `..._achievements.sql:17-19` `nullif(btrim(metric_name), '')`, 테스트 추가 |
| QA-S2-07 | Minor | db(S4) | 열림(S4 확인) | decisions.md 2026-10-25 항목으로 기록 |
| **QA-S2-08** | **Major** | api | **미해결 → 리더** | 아래 |

### QA-S2-08 [Major] 늦게 도착한 "생성" 요청이 그 뒤의 편집을 조용히 덮어씀 (QA-S2-03 회귀)
- 담당: api-engineer
- 근거: `src/server/services/career/save.ts:88-92` — `expectedUpdatedAt`이 없으면 insert, `<table>_pkey` 23505면 `:101` `ops.update(id, undefined)`로 **동시성 조건 없이** 생성 당시 값을 그대로 쓴다.
- 도달 경로(재현 순서):
  1. 생성 요청 C(id=X, 값 V1, `expectedUpdatedAt` 없음)가 네트워크에서 지연됨
  2. 클라이언트가 시간 초과로 재시도 C′ 전송 → insert 성공, 응답으로 `updatedAt` t1 수신
  3. 사용자가 편집 → 저장 E(`expectedUpdatedAt` = t1, 값 V2) 성공(t2)
  4. 지연된 C가 도착 → PK 충돌 → 조건 없는 update로 V1을 다시 씀 → **V2가 사라지고 conflict 신호도 없음**. 응답이 클라이언트에 버려지면 화면은 V2를 보여 주는데 DB는 V1(다음 새로고침에 사용자가 발견)
  - 같은 문제의 다른 형태: 생성 응답을 받기 전에 사용자가 계속 입력해서, `expectedUpdatedAt` 없는 저장 두 개가 동시에 떠 있으면 도착 순서대로 마지막 쓰기가 이긴다(오래된 값이 새 값을 덮을 수 있음).
- 심각도 판단: 일어날 확률은 낮다(원래 요청이 재시도와 그 뒤 편집 한 번보다 늦게 도착해야 함 — 불안정한 모바일망이나 Server Action 재시도 구현에 따라 가능). 하지만 사용자가 입력한 커리어 데이터가 **아무 신호 없이** 사라지고, 이 데이터는 AI 근거의 원본이다. 그래서 Major. 지금은 UI가 연결되지 않아 실제 영향은 없다.
- 수정 제안(둘 다 권장):
  1. 서버: PK 충돌 시 현재 행을 읽어 `updated_at = created_at`(생성 뒤 편집된 적 없음)일 때만 `eq('updated_at', row.updated_at)` 조건으로 update하고, 이미 편집됐으면 쓰지 않고 `conflict`(또는 현재 행 반환)로 응답. 진짜 재시도는 생성 직후라 이 조건을 통과한다.
  2. 연결 규칙: 새 행은 생성 응답을 받을 때까지 그 행의 다음 저장을 보내지 않고(행 단위 직렬화), 이후 저장은 항상 `expectedUpdatedAt`을 넣는다. api 노트의 "자동 저장은 순서대로" 규칙을 생성 단계까지 명시.
  - 테스트: "생성 → 편집(expected) → 같은 id 생성 재전송" 뒤 편집 값이 남는지 확인하는 통합 테스트.
- 상태: 미해결(수정 라운드 한도 도달, 리더에게 넘김)

---
# 라운드 1 기록

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `next typegen && tsc --noEmit` |
| lint | 통과 | eslint |
| vitest | 통과 | 19파일 221개, skip 0 — S2 통합 테스트 14건이 로컬 스택에서 실제 실행됨 |
| build (`--build`) | 통과 | `next build` (UI 화면 없음) |
| pgTAP | 통과 | Files=9, Tests=263 |
| 재현성 | 통과 | 마이그레이션 파일이 적용 후 수정된 이력이 있어(`project_is_complete` grant) `supabase db reset`으로 파일에서 다시 만든 뒤 pgTAP 263 / vitest 221 재실행 통과. `supabase gen types --local` 결과가 `src/server/db/database.types.ts`와 바이트 단위로 같음 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM §2.2–2.4·§4.1·A.3·A.4 ↔ 마이그레이션 | 통과 | 컬럼·CHECK 목록·길이(교육·상세 내용·요약·스킬)·`unique (id, user_id)`·복합 FK·`on delete set null (col)`·인덱스(DM 명시분 전부 + draft 부분 인덱스) 일치. §4.1 연쇄 경로(경력→경력 성과 cascade·프로젝트 set null / 교육→set null / 프로젝트→상세→성과, 태그, 고아 스킬 / 상세→성과 + 부모 재계산 / 스킬→링크) 확인. 스펙 밖 추가 CHECK(`projects` 기간·`team_size >= 1`, `sort_order >= 1`)는 노트에 기록됨. QA-S2-06, QA-S2-07 |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과 | 타입 최신. 서비스의 `select` 컬럼 목록·`.rpc()` 이름·인자(`p_*`) 모두 존재 |
| Q3 | RPC 시그니처 ↔ 호출 | 통과 | `get_data_readiness` / `get_deletion_impact` / `delete_career_item` / `reorder_project_details` 인자명·기본값, 반환 jsonb 키 ↔ zod(`DataReadiness`, `DeletionImpact`, `DeleteCareerItemResult`) 일치. QA-S2-02 |
| Q4 | RPC raise 코드 ↔ `errors.ts` | 통과 | S2 raise 5종(`career_item_not_found`, `invalid_entity_type`, `invalid_affiliation_mode`, `invalid_result_mode`, `invalid_detail_order`) + `42501 not_authenticated` 모두 매핑, 죽은 코드 없음. 23503 → `not_found`(저장 경로). QA-S2-01(22007/22008 미매핑) |
| Q5 | contracts ↔ 서비스 ↔ 화면 명세 | 통과(Minor) | zod 길이 = DB CHECK(DB 제한이 없는 필드는 앱만 제한, spec-gaps 기록). UTF-16 기준이라 zod가 DB보다 엄격(안전 방향). S-08 트리·S-10 상세 수·S-11 kind·S-12 연결 수 필드 존재. 자동 저장 충돌 처리 확인. QA-S2-01, 03, 04 |
| Q6 | SSE | 해당 없음 | |
| Q7 | AI 출력 ↔ 저장 | 해당 없음 | |
| Q8 | enum DB CHECK ↔ `enums.ts` | 통과 | employment_type 5, education_type 2, enrollment_status 5, proficiency 3, status 2, kind 2, entity_type 6(+S4 writing_chat), affiliation/result mode(`keep_results`/`delete_results` — UX C-05와 일치), readiness 값 목록 = SQL 리터럴 |
| Q9 | 사용량 원장 | 해당 없음 | |
| Q10 | 보안·개인정보 | 통과(Minor) | 7개 테이블 RLS + A/B 격리, 복합 FK로 남의 부모 연결 차단(23503), `status` 쓰기 거부, app_ai_writer = 7개 테이블 SELECT만(컬럼 권한도 SELECT만 — psql로 직접 확인), anon 없음, definer 함수 3개 모두 `search_path = ''`. `console.*` 없음, `.env.local` 무시·미추적. QA-S2-05(가드 공백) |
| Q11 | UI ↔ 백엔드 | 해당 없음 | `src/lib/data/`·`src/types/db.ts` 없음 → 연결 대기 |

### 중점 확인 항목 결과
- **status 계산**: 4개 테이블 BEFORE 트리거(공백 = 없음) + CHECK. 프로젝트는 자기 BEFORE 트리거 + 상세 내용 insert/delete/(status·project_id 변경 update) AFTER 트리거가 이전·새 부모 모두 재계산 → 상세 내용 프로젝트 간 이동도 처리(현재는 `project_id` update grant 없음). 상태가 바뀔 때만 `projects.updated_at` 갱신(DM §4.2). 순서만 바뀐 update는 상세 `updated_at` 유지.
- **readiness ↔ §6**: 키 구성·값 목록 일치, `ready = true`면 `next_action`/`suggested_*` 생략, `form`이면 `suggested_mode` 없음. draft 소속(경력·교육) 아래 프로젝트 제외, draft 프로젝트의 complete 상세 내용 제외. 프로브로 확인(역할 없는 프로젝트 + complete 상세 → `new_project`, 아래 스펙 차이).
- **삭제 영향 ↔ 실제 삭제**: 프로브(경력 + delete_projects, 소속 프로젝트 1·상세 1·경력 성과 1) — impact `{projects:1, project_details:1, achievements:1}` = delete 반환 = 실제 감소분(모두 0행). pgTAP 6종 × 모드도 통과.
- **첫 호출 권한(plpgsql 캐시) 계열**: `pg_proc` ACL 전수 확인. 사용자/AI 역할 문맥에서 호출되는 private 헬퍼는 `project_is_complete`(authenticated), `current_uid`(authenticated, app_ai_writer) 두 개이고 둘 다 grant 있음. 나머지 private 함수는 트리거 함수(발화 시 EXECUTE 검사 없음)이거나 security definer라 추가 grant 불필요. `career_first_call_privileges.test.sql`이 7개 테이블 쓰기·RPC 전부를 실제 역할 첫 호출로 덮음. 누락 없음.
- **스킬 정규화 TS ↔ DB**: 저장 이름은 zod가 이미 trim·공백 축약 → DB 식은 사실상 `lower()`만. DB 로캘 ICU(en_US.UTF-8)에서 `lower('ÄÖ Ｒｅａｃｔ İ')`와 JS `toLowerCase()` 결과 동일, PG `\s`가 NBSP·전각 공백도 매치. 불일치 없음.
- **groupCareerByYear ↔ §2.4·S-08**: 활동 연도 전부, 재직·재학 중/종료 없음 → 올해(Asia/Seoul), 프로젝트는 `coalesce(시작월, 소속 시작월)` 한 해, 독립 → 기타 프로젝트, 둘 다 없으면 연도 미정(마지막), 최신 연도 위. 일치.

## 이슈
### QA-S2-01 [Minor] 잘못된 `expectedUpdatedAt`·연도 0000이 500(internal_error)으로 나감
- 담당: api-engineer
- 근거: `src/lib/contracts/career.ts:85` `expectedUpdatedAt: z.string().min(1)`(형식 검사 없음) → PostgREST `22007 invalid input syntax for type timestamp with time zone`; `career.ts:47` `^\d{4}-...`가 `0000-01` 허용 → `22008`. `src/server/db/errors.ts:53-57`은 22007/22008을 매핑하지 않아 `internal_error` 500.
- 수정 제안: `expectedUpdatedAt: z.iso.datetime({ offset: true })`, 연도 정규식을 `19\d{2}|20\d{2}` 등으로 좁히기(또는 `errors.ts`에서 22007/22008 → `invalid_input`).
- 상태: 수정됨(라운드 2 확인 완료)

### QA-S2-02 [Minor] zod v4 `z.uuid()`가 Postgres가 받는 비RFC uuid를 거부 — 그런 id 행이 하나라도 있으면 readiness가 500
- 담당: api-engineer (대안은 db-engineer)
- 근거: `src/lib/contracts/career.ts:80, 291, 307, 332-335`. `node -e "z.uuid().safeParse('aaaaaaaa-1111-0000-0000-000000000001')"` → `false`(pgTAP 픽스처 형식). authenticated는 `id` insert grant가 있어(`20261025000100_s2_experiences.sql:88` 등 7곳) 클라이언트가 그런 id를 넣을 수 있고, 그러면 `getDataReadiness`의 `parseRpc`(`rpc.ts:16`)가 `internal_error`, 그 행은 저장·삭제 입력 검증(`saveMeta.id`)도 통과 못 해 고칠 수 없다. 앞으로 seed에 고정 id를 쓰면 바로 재현.
- 수정 제안: DB에서 돌아오는 id 검증(`DataReadiness`, `DeleteCareerItemResult`)과 입력 id는 `z.guid()`(형식만 검사)로. 또는 API가 클라이언트 id를 쓰지 않는다면 db가 insert grant에서 `id`를 뺀다(QA-S2-03과 함께 결정).
- 상태: 수정됨(라운드 2 확인 완료)

### QA-S2-03 [Minor] 자동 저장 생성이 멱등이 아님 — 응답 유실 후 "다시 시도"하면 draft 행이 중복 생성
- 담당: api-engineer
- 근거: `src/server/services/career/save.ts:81` id가 없으면 항상 insert, id가 있으면 update만(`save.ts:88-93`, 없으면 `not_found`). DB는 멱등성용으로 `id` insert를 열어 두었으나(`02_db-engineer_notes.md` "쓰기 가능한 컬럼") API가 쓰지 않는다. C-06 "저장 실패 — 다시 시도" 경로에서 첫 요청이 실제로는 커밋됐으면 같은 경력·상세 내용이 2개 생긴다(상세 내용은 sort_order도 하나 더 차지).
- 수정 제안: 생성 시 클라이언트가 만든 id(`crypto.randomUUID()`)를 받아 insert하고, `23505`(PK)면 그 행을 현재 상태로 돌려주기. 아니면 `id` insert grant를 회수하고 중복 가능성을 연결 단계 노트에 명시.
- 상태: 수정됨(라운드 2 확인 완료)

### QA-S2-04 [Minor] 상세 내용 저장·삭제로 `projects.updated_at`이 바뀌어 열린 프로젝트 폼의 다음 자동 저장이 거짓 `conflict`
- 담당: api-engineer
- 근거: `20261025000400_s2_project_details.sql:118-123`(상태가 바뀌면 프로젝트 update → `updated_at` 갱신) ↔ `save.ts:107/136`(`eq('updated_at', expected)`). `saveProjectDetail`은 `project.updatedAt`을 돌려주지만(`save.ts:195-196`), `deleteCareerItem('project_detail')` 응답(`DeleteCareerItemResult`)에는 부모 프로젝트의 새 `status`/`updated_at`이 없다. 경력 삭제(keep_projects)의 set null도 소속 프로젝트들의 `updated_at`을 바꾼다.
- 수정 제안: 상세 내용 삭제 액션이 부모 프로젝트 `SaveResult`를 함께 반환(서비스에서 재조회)하거나, 연결 단계 규칙으로 "상세 내용 저장·삭제 응답의 project.updatedAt을 프로젝트 폼 상태에 반영 / 삭제 후 트리 재조회"를 노트에 명시.
- 상태: 수정됨(라운드 2 확인 완료)

### QA-S2-05 [Minor] `grants.test.sql` 가드가 app_ai_writer의 컬럼 단위 쓰기 grant를 잡지 못함
- 담당: db-engineer
- 근거: `supabase/tests/grants.test.sql:35-48`은 `has_table_privilege`만 본다. `grant update (summary) on public.experiences to app_ai_writer` 같은 컬럼 grant는 이 검사에 걸리지 않아 DM-13(AI는 커리어 쓰기 불가)이 회귀해도 통과한다. 현재 상태는 정상(psql 확인: app_ai_writer 컬럼 권한은 7개 테이블 + profiles 모두 SELECT만).
- 수정 제안: `information_schema.column_privileges where grantee = 'app_ai_writer' and privilege_type <> 'SELECT'`가 S4 허용 목록(writing_chats 3컬럼 등) 외에는 비어 있음을 검사하는 항목 추가.
- 상태: 수정됨(라운드 2 확인 완료)

### QA-S2-06 [Minor] `achievements.kind`와 `status`의 "값 있음" 기준이 다름
- 담당: db-engineer
- 근거: `20261025000500_s2_achievements.sql:16-18` `kind`는 `metric_name is not null` ↔ `:49` status는 `nullif(btrim(metric_name), '')`. 공백만 있는 `metric_name` + 값이면 `kind = 'quantitative'`인데 `status = 'draft'`. API는 trim 후 `''` → null로 저장해 이 경로로는 안 생기지만 직접 PostgREST 쓰기·S4 `save_writing_chat`에서는 가능.
- 수정 제안: generated 식도 `nullif(btrim(metric_name), '') is not null`로 맞추기.
- 상태: 수정됨(라운드 2 확인 완료)

### QA-S2-07 [Minor · S4 메모] `source_writing_chat_id` FK는 복합 FK로 추가해야 함
- 담당: db-engineer (S4)
- 근거: `20261025000300_s2_projects.sql:19`, `..._project_details.sql:17`, `..._achievements.sql:19` — 지금은 FK 없이 authenticated insert grant만 있어 임의 uuid가 들어갈 수 있다. DM 표기("FK → writing_chats on delete set null")를 단일 FK로 구현하면 남의 대화 id를 연결할 수 있다(DM-2 위반).
- 수정 제안: S4에서 `foreign key (source_writing_chat_id, user_id) references writing_chats (id, user_id) on delete set null (source_writing_chat_id)`. 추가 전 고아 값 정리(`update ... set source_writing_chat_id = null where not exists ...`)를 같은 마이그레이션에 넣기.
- 상태: 열림(S4에서 확인, decisions.md 기록됨)

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- 2026-10-25 · DM §6 `suggested_mode`: complete 상세 내용은 있는데 `name`·`role`이 비어 draft인 프로젝트는 `new_project`로 안내되고 hint도 없다(프로브로 확인). 기획에서 `form` + `suggested_project_id` 또는 별도 hint를 정해 달라고 기록.
- 그 밖에 db/api가 이미 기록한 가정(`kind` 식, `normalized_name` 규칙, 모드 값 이름, `profile_filled`, readiness 세부, cascade 범위, 길이 제한 누락)은 구현과 일치함을 확인.

## 라운드 후 조치 (리더, 2026-10-25)
- QA-S2-08 [Major] → **해결**. api-engineer가 `replayCreate`에서 `updated_at = created_at` 조건부 update로 고쳤다. 이미 수정된 행이면 `conflict`를 돌려준다. 통합 테스트 "create → edit → resend same create"를 추가했다.
- QA 라운드 한도(2회)가 지나 3차 QA는 열지 않았다. 리더가 코드를 확인하고 `run-checks.sh --build`를 다시 실행했다. typecheck, lint, vitest 237개, build, pgTAP 265개 모두 PASS.
