# R4 백엔드 QA 리포트 (라운드 1 점진 검토 + 라운드 2 최종)

- 작성: backend-qa, 2026-11-02
- 범위: db-engineer(`supabase/migrations/20261109*_r4_*.sql`, `supabase/tests/`, `src/server/db/database.types.ts`), ai-pipeline-engineer(`src/server/ai/**`).
- **범위 밖(이번 라운드 검토 안 함)**: api-engineer 작업 중인 `src/server/{services,actions}`, `src/lib/{contracts,data}`, `src/types/db.ts`. 전체 typecheck·build는 api 작업이 끝날 때까지 실패가 예상되므로 판정하지 않았다(아래 "다음 라운드 확인 항목").
- 기준: DM v4.4(11장 작업 목록, 2.3·2.5·2.8·3.3·4.1·6장), AI 명세 v4.5(C-1·C-3·AI-12), PRD F-P1-19, decisions 3.9, `R4/01_plan.md`, `02_db_notes.md`, `02_ai_notes.md`.

## 검사 실행 결과

| 검사 | 결과 | 비고 |
|------|------|------|
| pgTAP (`supabase test db`) | 통과 | 51개 파일, 2,382개 테스트. 로컬 DB에 적용된 마이그레이션 순서 확인: `…20261108000100`(w1) 다음에 `20261109100100`~`20261109101600` |
| vitest (`pnpm vitest run src/server/ai`) | 통과 | 42개 파일, 849개 테스트 |
| typecheck (AI 영역만) | 통과 | `tsc --noEmit` 전체 실행 결과 중 `src/server/ai/**` 오류 0건. 나머지 오류(36개 파일, `services/*`, `lib/data/*`, `lib/contracts/*`, `types/db.ts` 등)는 api-engineer 범위라 이번 판정 제외 |
| lint (`eslint src/server/ai`) | 통과 | 0건 |
| `database.types.ts` 최신 여부 | 통과 | `supabase gen types typescript --local` 결과와 커밋 파일이 같음(1,108줄, diff 없음) |
| 전체 typecheck / lint / vitest / build | SKIP | api-engineer 작업 중(리더 지시). 최종 라운드에서 실행 |

## 경계면 검사

| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM v4.4 ↔ 마이그레이션 | 통과(11.1 표 19행 모두 대응) — 아래 "DM 11.1 대조" | QA-R4-04 |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ AI 쿼리 | 통과. `PROJECT_COLUMNS`·`DELIVERABLE_COLUMNS`의 모든 컬럼이 존재하고 `app_ai_writer` select grant 안에 있음 | — |
| Q3 | RPC 시그니처 ↔ 호출부 | AI 쪽만 통과(`toDraftPatch` ↔ `apply_structured_draft_patch` v3). 서비스 호출부는 다음 라운드 | — |
| Q4 | RPC raise 코드 ↔ 앱 오류 매핑 | 다음 라운드(api) | — |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 | 해당 없음(이번 라운드) | — |
| Q6 | SSE 이벤트 | 다음 라운드(AI 노트 5.3 제안 ↔ `contracts/sse.ts`·핸들러) | — |
| Q7 | AI 출력 ↔ 저장 | 통과. `evidence_links` source_type/source_field CHECK = `EVIDENCE_RULES` + `PROJECT_SCOPE_FIELDS`, 스냅샷(`project` = `content_updated_at`, 산출물 = `updated_at`), 산출물 `body` locator `{start,end}`, `title` locator null, `writing_chat_message`는 저장 시 예외 | QA-R4-02 |
| Q8 | enum DB ↔ TS | 분류 3종: DB CHECK = `private.classification_keys` = `classification.ts` = DM 2.3 = PRD F-P1-19(9·7·10개, 순서까지 일치). `clarifications.kind` 3종 일치. `src/lib/contracts/enums.ts`는 다음 라운드 | — |
| Q9 | AI 작업 종료·사용량 | 해당 없음(이번 슬라이스에 러너 변경 없음, 다음 라운드에 턴 핸들러만 확인) | — |
| Q10 | 보안·개인정보 | `app_ai_writer`는 커리어 테이블 쓰기 권한 없음(표 단위·컬럼 단위 모두 SELECT만, `project_deliverables` 포함). 사용자 세션의 `projects` 쓰기 컬럼에 `status`·`content_updated_at`·`source_writing_chat_id` 없음, `writing_chats`는 `return_target`만. 새 테이블 RLS 4동작 본인 + 교차 사용자 pgTAP 있음. `src/server/ai` 로그는 `log.ts` 한 곳(C-7 형식). private 스키마는 API 노출 안 됨(`config.toml` schemas = public, graphql_public) | QA-R4-01 |
| Q11 | UI ↔ 백엔드 | 다음 라운드 | — |

### DM 11.1 대조 (요약)

| DM 11.1 행 | 마이그레이션 | 결과 |
|------------|--------------|------|
| `projects` 컬럼·CHECK·FK·트리거·인덱스 | `…100300` | 일치(STAR 5·분류 3·`description`·`link_url`·`content_updated_at`·`is_current` CHECK, `summary`·`team_size` 삭제, `name` not null, DM-20 CHECK 3개, FK cascade, 범위 변경 거부, `content_updated_at` 트리거, 컬럼 기반 완료 판정, 독립 부분 인덱스) |
| `project_details`·`reorder_project_details`·`achievements` 삭제 | `…100200` | 일치. 남은 함수 본문에서 삭제된 이름(`project_details`, `achievements`, `project_detail_ids`, `saved_at`, `writing_chat_not_active` 등)을 참조하는 함수 0개(라이브 DB `pg_get_functiondef` 검색) |
| `project_skills` 독립 한정 | `…100400` | 일치(QA-R4-01 참고) |
| `project_deliverables` 신설 | `…100500` | 일치(RLS, 복합 FK, 독립 한정, 50개, `updated_at`, `career_data_updated_at`, 근거 삭제 표시, `reorder_project_deliverables`, `app_ai_writer` select) |
| `career_data_updated_at` 대상 | `…100500` 등 | 일치 |
| `app_ai_writer` grant | `…100500`, `grants.test.sql` | 일치 |
| `get_data_readiness` | `…101200` | 일치(카운트·힌트 이름·`create_project`·판정 순서·D-01 v4.4, `suggested_mode` 삭제) |
| `get_deletion_impact`·`delete_career_item` | `…101300` | 일치(QA-R4-03 한 가지) |
| `evidence_links` CHECK·트리거 | `…100600`, `…100700` | 일치(종류별 필드 검사, 산출물 원본 확인, V-8 `project.learnings`) |
| `writing_chats`·빈 초안 v3·시작 인사 4종·`start_writing_chat` | `…100800` | 일치(인사 문구 = AI-12 카드 초안) |
| `source_writing_chat_id` FK | (테이블 삭제로 정리) | `projects` 쪽 `on delete set null (source_writing_chat_id)` 유지 확인 |
| 메시지 RPC | `…100900` | 일치 |
| `apply_structured_draft_patch` v3 | `…101000` | 일치 |
| 폐기 RPC → `apply_writing_chat_proposal` | `…100800`, `…101100` | 일치 |
| R1 재개 전이·`status` grant 회수 | `…100800` | 일치 |
| 서류 `project_detail_ids` | `…100200`, `…101400` | 일치 |
| 탈퇴 집계·삭제 | `…101500` | 일치 |
| 기본 이름 "새 자기소개서 (날짜)" | `…101600` | 일치 |
| `purge_unlinked_writing_chats` 삭제 | `…100800` | 일치 |
| pgTAP 갱신 | `supabase/tests` | DM-20 CHECK, 범위 전환 거부, 산출물 독립 한정·50개, 반영 덧붙임·`needs_review` 건너뜀·2,000자 전체 거부, `closed` 전이, `field_not_patchable`, `classification_already_set`, 교차 사용자 update/delete 무효 모두 테스트 있음 |

### 마이그레이션 순서 변경(20261107… → 20261109…) 확인
- w0(`20261107000*`)·w1(`20261108000100`)이 정의한 함수와 R4가 `create or replace` 하는 함수가 겹치지 않는다(이름 교집합 0). w1은 동의 함수(`get_consent_status`, `record_consents`, `private.consents_before_insert`)만 다루고 R4 테이블을 건드리지 않는다. R4가 다시 쓴 함수 본문은 w0 적용 뒤 라이브 정의에서 가져온 것이라 w0 변경을 되돌리지 않는다.
- 새 순서로 `supabase db reset`이 끝난 로컬 DB에서 pgTAP 전부 통과. → 순서 충돌 없음. 남은 것은 옛 번호를 가리키는 주석·문서뿐(QA-R4-04).

### 동작 확인(롤백 트랜잭션으로 직접 실행)
- 사용자 패치 → `apply_writing_chat_proposal`: 역량 `["analysis","analysis","bogus","execution","planning","leadership"]` → `["analysis","execution","planning"]`로 걸러져 반영, `status = complete`, `source_writing_chat_id` 연결, 두 번째 반영은 `already_applied`로 전부 건너뜀.
- AI 패치(`app_ai_writer`): `project.is_current` → `rejected: field_not_patchable`, 분류 `reason` 300자 → 200자로 잘려 저장. 기존 1,500자 `action`에 600자 `append` 제안 → 반영 시 `field_too_long`(detail `action`), 분류만 반영하면 `content_updated_at` 그대로.
- 대화가 반영된(= `source_writing_chat_id`가 걸린) 소속 프로젝트의 경력을 지우면 프로젝트·대화가 함께 지워진다(오류 없음).

## 이슈

### QA-R4-01 [Minor] 정의자 권한 insert 트리거가 RLS 검사보다 먼저 남의 프로젝트를 읽어 다른 오류 코드를 낸다
- 담당: db-engineer
- 근거: `supabase/migrations/20261109100500_r4_project_deliverables.sql:32-66`(`private.project_deliverables_before_insert`, `security definer`, `for no key update`), `20261109100400_r4_project_skills_standalone.sql:5-19`(`private.project_skills_require_standalone`, `security definer`). PostgreSQL은 RLS `WITH CHECK`를 BEFORE 트리거 뒤에 평가한다. 사용자 A 세션에서 `insert into project_deliverables (user_id, project_id, title) values ('<B의 user_id>', '<B의 소속 프로젝트 id>', 'x')`를 실행하면 RLS 거부(42501) 대신 `deliverable_requires_standalone_project`가 나온다(`project_skills`도 `project_skill_requires_standalone_project`). 결과적으로 남의 프로젝트 UUID를 알면 소속/독립 여부와 산출물 50개 도달 여부를 알 수 있고, 정의자 권한으로 남의 `projects` 행에 잠금을 잡는다(문 실패로 곧 풀림). UUID를 알아야 하므로 실제 위험은 낮다.
- 수정 제안: 두 트리거 함수를 `security invoker`로 바꾼다(사용자는 자기 `projects`를 읽고 `for no key update`할 권한이 있고, 남의 행은 RLS로 안 보여 `found = false` → FK·RLS가 거부). 또는 함수 앞에 `if new.user_id is distinct from (select auth.uid()) then return new; end if;`처럼 RLS가 거부할 행은 검사를 건너뛴다. pgTAP에 "남의 user_id로 insert → 42501" 한 줄 추가.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-R4-02 [Minor] 반영 RPC는 현재 값을 다듬지 않고 이어 붙이는데, 파이프라인 길이 검사는 다듬은 길이로 계산한다
- 담당: db-engineer (대안: ai-pipeline-engineer)
- 근거: `supabase/migrations/20261109101100_r4_apply_writing_chat_proposal.sql:170-178`(`v_cur := to_jsonb(v_p) ->> v_field; … v_text := v_cur || E'\n' || v_text`, `v_cur`는 원문 그대로, 길이 검사 `char_length(v_text) > 2000`) ↔ `src/server/ai/validation/v9.ts:459-462`(`mergedStarLength`: `(project.star[field] ?? "").trim().length`). 사용자가 섹션 편집으로 끝에 공백·빈 줄이 남은 값을 저장하면(DB는 STAR 값을 다듬지 않음), 파이프라인은 C-14 기준으로 "들어간다"고 보고 제안을 받지만 반영 때 `field_too_long`이 나서 "모두 반영" 전체가 실패한다. 이어 붙인 결과에도 "값\n\n제안"처럼 빈 줄이 남는다.
- 수정 제안: 반영 RPC에서 `v_cur := rtrim(v_cur, E' \t\r\n')` 후 이어 붙인다(DM 3.3 "현재 값 + 줄바꿈 1개 + 제안 값"과도 더 맞음). DB를 바꾸지 않을 거면 파이프라인이 `trim()` 대신 원문 길이(오른쪽 공백 포함)로 계산한다. 둘 중 하나로 맞추고 반영 RPC pgTAP에 "끝 공백 있는 현재 값" 사례 추가.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-R4-03 [Minor] 대화 삭제 영향의 `message_count`가 시작 인사까지 센다
- 담당: db-engineer
- 근거: `supabase/migrations/20261109101300_r4_career_deletion_rpcs.sql:103-110`(`count(*) from writing_chat_messages`) ↔ DM 2.5 `writing_chats.message_count` "사용자 + AI 메시지 합계, 시작 인사 제외(A5)". 같은 이름의 값이 대화 목록(컬럼)과 삭제 확인 창(RPC)에서 1씩 다르게 보인다(첫 사용자 메시지 전 대화는 컬럼 0, RPC 1).
- 수정 제안: `w.message_count`를 그대로 돌려준다(삭제 확인 창 "메시지 N개"가 패널 표시와 같아짐). 시작 인사를 세는 게 의도라면 DM 4.1에 정의를 적도록 spec-gaps에 남긴다. `career_deletion_rpcs.test.sql` 기대값 갱신.
- 상태: 수정됨(확인 완료, 라운드 2)

### QA-R4-04 [Minor] 옛 마이그레이션 번호(20261107100100)를 가리키는 주석·문서
- 담당: db-engineer
- 근거: 리더가 파일명을 `20261109…`로 바꿨는데 본문 주석이 그대로다 — `20261109100300_r4_projects_v44.sql:5`, `…100400…:2`, `…100600…:6`, `…100800…:8`, `…101000…:20`. 문서도 같다 — `_workspace/backend/decisions.md:51`, `_workspace/backend/spec-gaps.md:639`(R4-DB-13 "w1 앞에 정렬"은 이제 사실이 아님), `R4/02_db_notes.md:29,246`.
- 수정 제안: 주석의 번호를 `20261109100100`으로 바꾸고(동작 영향 없음, 아직 원격 미적용이라 파일 수정 가능 — 원격 적용 전이면 리더 확인 후), decisions.md·02_db_notes를 고치고 spec-gaps R4-DB-13에 "해소(2026-11-02 파일명 변경, w1 뒤로 정렬)"를 적는다.
- 상태: 수정됨(확인 완료, 라운드 2)

## 스펙 차이 판정 (spec-gaps.md R4-DB-*, R4-AI-1~3)

| 항목 | 실제 차이인가 | 판정·처리 방향 |
|------|---------------|----------------|
| R4-DB-1 데이터 비우기 | 예(DM 11.2가 두 길을 둠) | 권고안 채택으로 타당. **원격(스테이징 포함) 적용 전에 사용자 확인 필수** — 남는 인사이트·서류·면접 결과의 프로젝트 근거 행은 "원본 삭제됨"이 아니라 행 자체가 지워진다(`…100100`이 `evidence_links`·`draft_section_sources`를 delete). 남길 데이터가 있으면 표시만 하는 방식으로 바꿔야 함 |
| R4-DB-2 패치 입력 형식 | 예(DM은 저장 모양만 정함) | 구현대로 확정 권고. DM 2.5에 ops 형식과 `field_not_patchable` 사유를 적도록 기획에 넘김. 파이프라인 `toDraftPatch`와 일치 확인 |
| R4-DB-3 사용자 STAR 수정의 `op` 재계산 | 예(DM 2.5 "op 유지" ↔ V-9h 공통) | 구현 쪽이 타당(반영은 어차피 현재 값 기준으로 덧붙임). DM 문구를 "프로젝트 컬럼 기준으로 다시 정함"으로 고치도록 기획에 넘김 |
| R4-DB-4 `is_current`일 때 `end_month` | 아니오(DM 3.3과 같음, 패치 쪽 사유 이름만 미정) | 구현대로. DM 2.5 거부 사유 목록에 `field_already_filled`(기간) 명시만 |
| R4-DB-5 마지막 응답 실패 시 `active` 유지 | 예(DM "실패로 닫는 턴 정리" 미정의) | 구현 타당(닫으면 다시 보내기 불가). 단 `message_count = 40`·`active`인 대화가 생기므로 **api·UI가 `message_count > 38`이면 입력창을 막고 "다시 보내기"만 보이게** 해야 함 → 다음 라운드 확인 항목 |
| R4-DB-6 `writing_chat_closed` | 아니오(DM 2.5에 이미 이 코드) | api 매핑 갱신만(다음 라운드) |
| R4-DB-7 / R4-AI-1 `reason` 200 ↔ 100 | 예(문서 두 값) | 충돌 없음(파이프라인 100자로 자르고 DB는 200자 방어). 기획에서 DM 2.5를 100자로 맞추는 쪽 권고. 코드 변경 불필요 |
| R4-DB-8 V-9i ⑤는 DB 미강제 | 아니오(파이프라인 몫) | `v9.ts` `checkClassification(…, situationKnown && actionKnown)`로 구현·테스트 확인. 해소 |
| R4-DB-9 `source_snapshot_at`은 파이프라인이 채움 | 아니오(설계 선택) | 파이프라인이 `project` = `content_updated_at`, 산출물 = `updated_at`을 넣음(`career-pack.ts:191,224,243`, `evidence-links.test.ts`). **남은 확인: 서비스가 결과 RPC payload에 이 값을 빠짐없이 넘기는지**(다음 라운드 api) |
| R4-DB-10 힌트 하나만 | 약한 차이(DM은 판정 순서만 서술) | 구현대로 확정 권고 |
| R4-DB-11 반영 `invalid_period` | 예(DM 3.3 오류 목록에 없음) | 구현 타당(CHECK 위반을 사용자 오류로). DM 3.3 오류 목록에 추가하도록 기획에 넘김, api 오류 매핑 필요 |
| R4-DB-12 근거 종류 불일치 시 RPC 전체 실패 | 아니오(DM 2.8 그대로) | 파이프라인 V-2가 별칭 `scope`로 먼저 거름(`validation/evidence.ts:79`). 프로젝트는 소속↔독립 전환이 막혀 있어 팩 생성~저장 사이에 바뀔 수 없음. 해소 |
| R4-DB-13 접두사가 w1 앞 | 해소됨 | 파일명 `20261109…`로 바뀌어 w1 뒤로 정렬. 기록만 갱신(QA-R4-04) |
| R4-DB-14 순서만 바꾸면 `updated_at` 그대로 | 아니오 | 타당(근거 "변경됨" 기준). 순서 변경은 `career_data_updated_at`은 갱신함 — 팩 채우는 순서가 바뀌므로 맞음 |
| R4-DB-15 대화 삭제 시 턴 취소 트리거 | 아니오(DM 4.2 v4.4 요구) | 구현·테스트 확인 |
| R4-AI-2 팩 기간 표기 `YYYY-MM ~ 현재` | 약한 차이(모델 입력 형식) | 화면 영향 없음, 경력·교육과 같은 형식 유지가 타당. AI 명세 C-1에 "팩은 기존 `~` 형식" 한 줄 넣도록 기획에 넘김 |
| R4-AI-3 응답 호출엔 STAR 값 대신 상태만 | 예(AI-12 카드 안 두 문장 충돌) | 구현 쪽이 "질문에 구체 사실을 넣지 않는다" 규칙에 더 안전. AI-12 처리 방식 문장을 고치도록 기획에 넘김 |

## 다음 라운드 확인 항목 (api-engineer 착지 후)

1. `start_writing_chat(p_project_id, p_return_target)` 2인자 호출, 폐기 RPC(`save/hand_off/set_affiliation/purge_unlinked/reorder_project_details`) 호출 제거(보관 크론 `src/server/jobs/retention.ts` 포함 — 현재 타입 오류 있음).
2. 오류 매핑: `writing_chat_closed`, `field_too_long`(detail 필드 목록), `invalid_fields`, `invalid_period`, `affiliation_mode_not_supported`, `project_scope_change_not_allowed`, `deliverable_requires_standalone_project`, `deliverable_limit_reached`, `project_skill_requires_standalone_project`, `writing_chat_requires_affiliated_project`, `invalid_deliverable_order`, 패치 사용자 호출의 사유 예외(`field_already_applied`, `classification_already_set`, `field_not_patchable`, `invalid_review_transition`, `protected_field`).
3. AI 턴: `rejected[].reason` 집계, `turn_done`의 `quickChips(RPC가 돌려준 draft)`, SSE 이벤트(AI 노트 5.3) ↔ `contracts/sse.ts`, `message_count > 38` + `active`(R4-DB-5) 처리.
4. 결과 RPC payload에 `toEvidenceLinkRows`의 `source_snapshot_at`·`source_locator`가 그대로 전달되는지(R4-DB-9).
5. `src/lib/contracts/enums.ts`의 분류 3종·슬롯 목록(`SLOT_IDS`) ↔ `classification.ts`·DB CHECK.
6. 기본 이름: `src/server/services/application/application.integration.test.ts:117`이 아직 `새 기업 JD (…)`를 기대함, `src/lib/contracts/application.ts:38` `PENDING_DISPLAY_NAME = "새 기업 JD"`(CR-23 화면 문구와 맞는지).
7. readiness 소비 코드(힌트 이름·`suggested_mode` 삭제·`create_project`), `src/lib/data` 호환 껍데기, 전체 `typecheck`·`lint`·`vitest`·`pgTAP`·`pnpm build`.

## 요약

| 심각도 | db-engineer | ai-pipeline-engineer | api-engineer |
|--------|-------------|----------------------|--------------|
| Critical | 0 | 0 | — (미검토) |
| Major | 0 | 0 | — |
| Minor | 4 (QA-R4-01~04) | 0 (QA-R4-02 대안 담당) | — |

DB·AI 모듈은 DM v4.4·AI v4.5와 경계에서 맞는다. 차단 이슈 없음.

---

# 라운드 2 (최종) — 2026-11-02

- 범위: 라운드 1 이슈 재확인(db-engineer `20261109101700_r4_qa1_fixes.sql`), api-engineer 모듈 전체(`src/server/{services,actions,jobs,db/errors.ts}`, `src/lib/{contracts,data}`, `src/types/db.ts`), 전체 검사.
- 입력: `R4/02_api_notes.md`, spec-gaps "R4 (api-engineer)" R4-API-1~9.

## 검사 실행 결과 (라운드 2)

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck (`run-checks.sh`) | 통과 | 0건 |
| lint | 통과 | 0건 |
| vitest | 통과 | 111개 파일, 1,772개 테스트(로컬 스택 통합 테스트 포함) |
| pgTAP | 통과 | 51개 파일, 2,387개 테스트. 로컬 DB 마지막 마이그레이션 = `20261109101700` |
| `pnpm build` | 통과 | `supabase status -o env` 값을 명령줄 환경 변수로만 넘김(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` + 로컬용 더미 `CRON_SECRET`·`ACCOUNT_DELETION_HASH_SECRET`·`AI_KEY_KEK_ID`·`NEXT_PUBLIC_SITE_URL`). `.env*` 파일은 만들지 않음(작업 트리에 `.env.example`만 있음) |
| `database.types.ts` 최신 여부 | 통과 | 101700 적용 뒤 다시 생성해도 같음(함수 본문만 바뀜) |
| UI 파일 미수정 | 통과 | `git status -- src/app src/components src/lib/mock` 변경·새 파일 0건(`page.tsx`·컴포넌트·mock 모두 그대로) |

## 라운드 1 이슈 재확인

| 이슈 | 결과 | 확인 방법 |
|------|------|-----------|
| QA-R4-01 | 수정됨(확인 완료) | 두 트리거가 `security invoker`로 바뀜. 같은 재현 스크립트(사용자 A가 B의 `user_id`·소속 프로젝트로 insert)가 이제 `new row violates row-level security policy`(산출물·`project_skills` 모두). `career_tables.test.sql:254` 테스트 추가 |
| QA-R4-02 | 수정됨(확인 완료) | 반영 RPC가 `rtrim(현재 값, E' \t\r\n')` 뒤 이어 붙이고 길이를 잼. `apply_writing_chat_proposal.test.sql:128` 테스트 추가 |
| QA-R4-03 | 수정됨(확인 완료) | `get_deletion_impact('writing_chat')`가 `w.message_count` 반환. `career_deletion_rpcs.test.sql:75` |
| QA-R4-04 | 수정됨(확인 완료) | `supabase/migrations`·`decisions.md`·`02_db_notes.md`에 `20261107100` 참조 0건, spec-gaps R4-DB-13 "해소" 표기 |

## 경계면 검사 (라운드 2, api 모듈)

| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q2 | 생성 타입 ↔ 쿼리 | 통과. `src/` 비테스트 코드의 `.rpc("…")` 이름이 전부 라이브 DB의 public 함수로 존재(누락 0). 타입 검사가 생성 타입으로 인자 이름을 검사 | QA-R4-05 |
| Q3 | RPC 시그니처 ↔ 호출부 | 통과. `start_writing_chat`은 `p_project_id` + 선택 `p_return_target`(`chat.ts:51`), `apply_writing_chat_proposal`은 `p_writing_chat_id` + 선택 `p_fields`(`chat.ts:205`), 반환을 `ApplyProposalRpcResult`(applied/skipped reason 5종 = DB 목록, `project_status`)로 파싱. 폐기 RPC(`save_writing_chat`, `hand_off_writing_chat`, `set_writing_chat_affiliation`, `purge_unlinked_writing_chats`, `reorder_project_details`) 호출 0건, `jobs/retention.ts`에서 purge 제거 | — |
| Q4 | raise 코드 ↔ 오류 매핑 | 통과. R4 마이그레이션의 모든 `message = '…'` 코드와 사용자 패치 거부 사유(`field_already_filled`, `protected_field`, `invalid_review_transition`, `invalid_value`, `invalid_source`, `invalid_patch`)가 `src/server/db/errors.ts`에 있음. `field_too_long`은 `details.fields`(쉼표 분리), `writing_chat_not_active`는 삭제됨 | QA-R4-06(문구) |
| Q5 | 계약 ↔ 핸들러 | 통과(노트의 DM §7 표와 서비스·액션·데이터 계층 대조) | — |
| Q6 | SSE 이벤트 | 통과. 이벤트 이름 `turn_started`·`reply_delta`·`reply_done`·`draft_patch`·`draft_flags`·`turn_done`·`error`(AI 노트 5.3·DM §7과 같음), 옛 `draftUpdated`·`progress` 소비처 없음. 페이로드 필드는 camelCase(R4-API-4, 이름만 다름) | — |
| Q7 | AI 출력 ↔ 저장 | 통과. 인사이트·서류·면접 저장 payload가 `toEvidenceLinkRows` 행을 그대로 담아 결과 RPC로 감(`source_snapshot_at`·`source_locator` 보존). 칩 "변경됨" = 프로젝트 `content_updated_at` / 산출물 `updated_at` > `source_snapshot_at`(`services/evidence/index.ts:113`) | — |
| Q8 | enum DB ↔ TS | 통과. `enums.ts`의 `PROJECT_TYPES`·`EXPERIENCE_TYPES`·`COMPETENCIES`가 `server/ai/classification.ts`와 순서까지 같고(임시 vitest로 직접 대조, 파일 삭제함), `WRITING_CHAT_SLOTS` = AI `SLOT_IDS`, `EVIDENCE_SOURCE_TYPES`(10종) = DB CHECK, `WRITING_CHAT_STATUSES` = `active`/`closed`, `CLARIFICATION_KINDS` 3종, `DELETABLE_ENTITY_TYPES` = DB 6종, readiness `hints`·`next_action` = DM 6장 | — |
| Q9 | 작업 종료·사용 기록 | 통과(변경분만). `closed` 대화 → `writing_chat_closed`(409) 사전 거부, 상한 도달 턴은 공급자 호출 없음. `turn_done.closed` = `messageCount > 38`. 마지막 응답 실패로 `active`·40인 대화(R4-DB-5)는 `limitReached = true`, `canSend = false`, 칩 없음, `?retry=1`만(`chat.ts:122,132`) | — |
| Q10 | 보안·개인정보 | 통과. 반영은 사용자 세션 RPC만(작업·사용 기록·키 없음). 통합 테스트에 "로그에 본문 없음" 확인 | — |
| Q11 | UI ↔ 백엔드 | 통과(호환 껍데기로 빌드 유지) — 아래 판정 | — |

### 기본 이름 "새 자기소개서" (CR-23)
- DB `private.application_default_name` = "새 자기소개서 (YYYY-MM-DD)", `PENDING_DISPLAY_NAME = "새 자기소개서"`(`contracts/application.ts:39`), 테스트 `application.integration.test.ts:119`·`application.test.ts:47` 갱신 확인. 단 서버 오류 문구에는 "기업 JD"가 남아 있음 → QA-R4-06.

### readiness 소비 코드
- `getDataReadinessV44`가 v4.4 zod로 파싱. 옛 게이트 화면용 `toLegacyReadiness`(`lib/data/readiness.ts:131`)가 `project_star → complete_project_detail`, `writing_chat → augment_project + suggested_project_id`, `create_project → form`으로 바꿔 줌. 서버·계약에 `suggested_mode`·옛 카운트 참조 없음(mock 미리보기 `computeReadiness`만 옛 모양 — UI 소유 mock 기반이라 그대로가 맞음).

### `src/lib/data` 호환 껍데기 판정
- **판정: 수용.** UI 파일을 한 줄도 고치지 않고 `pnpm build`가 통과하며, 실제 경로에서 옛 화면이 쓰는 이름은 v4.4 데이터로 매핑되거나 명확한 `not_supported`(410)/빈 결과를 낸다(조용히 다른 데이터를 쓰지 않음). 껍데기 목록이 `02_api_notes.md`에 정리되어 UI 재작업 때 지울 대상이 분명하다.
- 알려진 한계(이슈 아님, UI 재작업 전까지의 상태 — R4-API-7): 옛 S-36은 v3 제안을 볼 수 없고(`structured_draft = {}`로 보임), 새 프로젝트 대화·저장·폼 전환·소속 지정은 410. 옛 삭제 화면 기본값은 `delete_projects`(명시 `keep_projects`는 거부, R4-API-2). 새 데이터 함수(`career-v44.ts`, `writing-chats-v44.ts`, `getDataReadinessV44`, 삭제 v4.4)는 `?state=` 미리보기 분기가 없음 — UI 재작업 때 mock과 함께.

## 라운드 2 새 이슈

### QA-R4-05 [Minor] `project_deliverables.sort_order`가 생성 타입에서 insert 필수라 서비스가 타입을 우회한다 (R4-API-1)
- 담당: db-engineer (후속: api-engineer가 우회 제거)
- 근거: `supabase/migrations/20261109100500_r4_project_deliverables.sql`(`sort_order smallint not null`, 기본값 없음, 트리거가 null이면 최댓값 + 1) → `database.types.ts`의 `project_deliverables.Insert.sort_order: number`(필수) ↔ `src/server/services/career/save.ts:237` `.insert({ id, project_id, title, body } as never)`. 동작은 맞지만 `as never`가 그 insert의 다른 컬럼 타입 검사까지 끈다(오타·삭제된 컬럼이 컴파일을 통과).
- 수정 제안(권고): 새 마이그레이션으로 `alter table public.project_deliverables alter column sort_order set default 0;` + `private.project_deliverables_before_insert`의 조건을 `if new.sort_order is null or new.sort_order < 1 then … 최댓값 + 1`로 바꾼다(기본값은 BEFORE 트리거 전에 들어가고, CHECK `sort_order >= 1`은 트리거 뒤에 평가되므로 그대로 유지). 타입을 다시 생성하면 `Insert.sort_order?: number`가 되어 api가 `as never`를 지울 수 있다. pgTAP: `sort_order` 생략·0 → 마지막 번호. (대안: 트리거 유지 + `TablesInsert<'project_deliverables'>`를 `Omit<…,'sort_order'> & {sort_order?: number}`로 좁히는 로컬 타입 — 우회 범위가 줄지만 DB 계약이 문서와 어긋난 채 남음.)
- 상태: 열림

### QA-R4-06 [Minor] 서버가 사용자에게 보내는 오류 문구에 "기업 JD"가 남아 있다 (CR-23)
- 담당: api-engineer
- 근거: CR-23(decisions 3.9, "화면 안 '기업 JD' 표기 → '자기소개서', 화면 문구 전역") ↔ 서버 문구 18곳: `src/server/db/errors.ts:81,82,147,150,155`, `services/drafts/ranking.ts:109`, `services/drafts/career-description.ts:145,218`, `services/insight/read.ts:48`, `services/interview/read.ts:65,177,243,427`, `services/interview/start.ts:144`, `services/application/read.ts:44`, `services/application/db.ts:81`, `services/application/write.ts:34`, `lib/data/drafts-real.ts:415`. 기본 이름·`PENDING_DISPLAY_NAME`은 바뀌었는데 오류 토스트는 옛 용어로 나온다.
- 수정 제안: 지원 건을 가리키는 문구는 "자기소개서"로(예: "자기소개서를 찾을 수 없습니다…", "이 자기소개서에서 AI 작업이 진행 중이에요…"), 공고 자체(`job_description_not_found`, `jd_has_results`)는 "공고"/"새 자기소개서로 추가해 주세요"로. 메시지 상수를 쓰는 테스트 기대값 함께 갱신. UI 재작업과 같이 묶어도 됨(동작 영향 없음).
- 상태: 열림

## spec-gaps R4-API-1~9 판정

| 항목 | 실제 차이인가 | 판정 |
|------|---------------|------|
| R4-API-1 산출물 `sort_order` 타입 | 예(DM "새 행은 마지막" ↔ 컬럼 기본값 없음) | QA-R4-05로 db-engineer에게. 위 기본값 0 + 트리거 방식 권고 |
| R4-API-2 옛 삭제 화면 `keep_projects` 기본값 | 예(옛 UI ↔ CR-15) | 껍데기 기본값 `delete_projects` + 명시 `keep_projects` 거부가 맞음. 해소(UI 재작업 때 인자 제거) |
| R4-API-3 이름 없는 생성 → "새 프로젝트" | 예(옛 폼 ↔ `name` not null) | 껍데기 한정 `[가정]` 수용. 새 화면은 C-23 `createProject`가 이름을 받음 |
| R4-API-4 SSE 필드 camelCase | 이름만 다름 | 수용. 기존 계약 관례(camelCase)를 따르는 게 맞음. DM §7·AI 노트의 snake_case 표기는 기획에서 "계약은 camelCase"로 정리 권고 |
| R4-API-5 칩 숨김 36 | 아니오(UX `[가정]` 그대로 구현) | 수용 |
| R4-API-6 반영 응답에 `structuredDraft` 추가 | 확장(DM 응답의 상위 집합) | 수용. 왼쪽 STAR는 다시 읽기 — 화면 재작업 때 확인 |
| R4-API-7 옛 S-36에서 v3 제안 안 보임 | 예(UI 미재작업) | 수용(연결 대기). UI 재작업 전까지 패널 기능은 새 데이터 함수로만 확인 가능 |
| R4-API-8 "변경됨" = `content_updated_at` | 아니오(DM 2.8 그대로) | 확인 완료 |
| R4-API-9 build에 env 필요 | 아니오(작업 트리 환경) | 확인: 로컬 스택 값을 환경 변수로 넘기면 통과. 코드 문제 아님 |

## 최종 이슈 목록

| ID | 심각도 | 담당 | 상태 |
|----|--------|------|------|
| QA-R4-01 | Minor | db-engineer | 수정됨(확인 완료) |
| QA-R4-02 | Minor | db-engineer | 수정됨(확인 완료) |
| QA-R4-03 | Minor | db-engineer | 수정됨(확인 완료) |
| QA-R4-04 | Minor | db-engineer | 수정됨(확인 완료) |
| QA-R4-05 | Minor | db-engineer (+ api 우회 제거) | 열림 |
| QA-R4-06 | Minor | api-engineer | 열림 |

| 심각도 | db-engineer | ai-pipeline-engineer | api-engineer |
|--------|-------------|----------------------|--------------|
| Critical | 0 | 0 | 0 |
| Major | 0 | 0 | 0 |
| Minor (열림) | 1 (QA-R4-05) | 0 | 1 (QA-R4-06) |
| Minor (수정 확인) | 4 (QA-R4-01~04) | 0 | 0 |

결론: R4 슬라이스는 전체 검사(typecheck·lint·vitest 1,772·pgTAP 2,387·build)를 통과하고 경계면 불일치로 흐름이 깨지는 곳이 없다. 남은 2건은 Minor(타입 우회, 문구)라 출시를 막지 않는다. 2라운드 상한에 따라 열린 2건은 리더에게 넘긴다.

## 라운드 2 뒤 리더 처리 (2026-11-02, 사용자 요청)
- QA-R4-05 **해결**: `20261109101800_r4_deliverable_sort_order_default.sql` — `sort_order` 기본값 0, 삽입 트리거가 null 또는 1 미만이면 마지막 + 1. `database.types.ts` 재생성(Insert `sort_order` 선택), `save.ts`의 `as never` 제거. pgTAP `career_tables`에 0 → 끝 번호 케이스 추가.
- QA-R4-06 **해결**: 서버 사용자 문구의 "기업 JD" → "자기소개서"(errors.ts, drafts·insight·interview·application 서비스, `lib/data/drafts-real.ts`), 기본 이름 주석 갱신. 내부 이름·코드 주석의 용어는 그대로.
- 검사: pgTAP 51 files / 2,388 pass, typecheck 0, lint 0, Vitest 111 files / 1,772 pass, `pnpm build` 43페이지 통과(로컬 스택 env 인라인).
