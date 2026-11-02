# S6 인사이트 (AI-02) 계획

## 범위와 근거
- 기획 근거
  - DM
    - A.8 `insights`, 공통 AI 메타(§0)
    - §2.8 `evidence_links`
    - §4.1·§4.2: 커리어 삭제 영향 중 `insights`
    - §6 `get_data_readiness().features.insight`
    - §6.1 F-P2-04, F-P2-09
  - AI
    - AI-02 카드 전체
    - C-1(경력 팩, `computed_total_months`), C-3(V-1~V-5, V-8, 저장 매핑, `item_key`)
    - C-6(비동기 작업, 진행 단계 `match` → `synthesize` → `validate`, `input_hash` 재사용)
    - C-9(회고 근거 제한), C-11~C-13, C-12(무료 등급 배치 순차)
  - UX: S-16, S-31 인사이트 카드, S-13·S-39 진행 표시
  - PRD: F-P2-04·05·07(MVP 최소: "데이터 변경됨" + 다시 생성)·09, F-AP-06, D-30
- 앞 슬라이스 위에 쌓는다
  - S3a: 비동기 실행기·단계 등록(`registerJobType`)·`next_run_at` 예약·사용 기록
  - S3b: 실행 게이트
  - S3: `evidence_links`, `validation/evidence.ts`, `storage/evidence-links.ts`, `career-pack.ts`
  - S5: `ensureJdExtracted`, `jd_requirements`, 목록·보드 `loadProgress` 확장 지점
- **이번에 함께 하는 것**: QA-S5-06(추출 트리거 ↔ 프로젝트 삭제의 잠금 순서) 수정
- **이번에 하지 않는 것**
  - 이전 버전 열람(Could): 행은 남긴다.
  - 결과 평가(`result_ratings`, Should)
  - AI-03·AI-05가 인사이트를 참고 신호로 읽는 부분은 S7·S8에서 한다.
- 연결: UI 없음 → A3 "연결 대기"

## 계약 — DB (새 마이그레이션 `20261101xxxxxx_s6_*`)

1. **`insights`** (A.8 + 공통 AI 메타)
   - 컬럼
     - 기본: `id`, `user_id`, `application_project_id`(복합 FK cascade), `version_no`(`unique (application_project_id, version_no)`), `is_latest` default false, `status` (`generating`, `ready`, `failed`)
     - 결과: `result` jsonb(근거 없음, `item_key`만), `match_stage_result` jsonb
     - 해시: `requirements_hash`, `career_snapshot_hash`, `input_hash`
     - AI 메타: `ai_job_id`, `schema_version`, `prompt_version`, `provider`, `model`, `model_tier`, `connection_tier`, `validation_report`, `usage`
     - `completed_at`, `created_at`, `updated_at`
   - CHECK
     - `is_latest`는 `ready` 행만 true다.
     - `ready`면 `result`, `completed_at`이 not null이다.
   - 인덱스
     - `unique (application_project_id) where is_latest`
     - `(user_id, application_project_id, input_hash) where status = 'ready'`
     - `(application_project_id, created_at desc)`
   - RLS: select 본인. 사용자 insert·update는 없다. 사용자 delete도 MVP에 없다(지원 프로젝트 연쇄와 커리어 삭제의 `result_mode`만). app_ai_writer는 아래 definer RPC로만 쓴다.

2. **RPC (app_ai_writer 전용, 소유·세대 검사, S5와 같은 방식)**
   - `begin_insight(p_application_project_id, p_ai_job_id) returns uuid`
     - `generating` 행을 만든다. `version_no = max + 1`이고, 행 잠금으로 동시성을 막는다.
     - 같은 작업이 다시 부르면 기존 행을 반환한다(멱등).
   - `complete_insight(p_insight_id, p_ai_job_id, p_run_generation, p_payload jsonb) returns jsonb` — 한 트랜잭션에서 한다.
     - `result`, `match_stage_result`, 해시, 메타를 쓴다.
     - `evidence_links`를 `owner_type = 'insight'`로 insert한다(payload의 `evidence` 배열).
     - `status = 'ready'`, `completed_at`.
     - 이전 latest의 `is_latest`를 false로, 이번 행을 true로 바꾼다.
     - 지원 프로젝트 `last_activity_at`을 갱신한다.
     - 늦게 도착한 실행이면 `{applied:false, reason:'stale_run'}`이다.
     - payload 모양은 db·ai가 노트에서 합의한다. db 노트를 기준으로 한다.
   - `fail_insight(p_insight_id, p_ai_job_id) returns boolean`
   - **트리거**: `insight` 작업이 성공하지 못하고 끝나면, 그 작업의 `generating` 행을 `failed`로 바꾼다(S5 QA-S5-02와 같은 방식).
     - 잠금 순서는 QA-S5-06 교훈대로 삭제와 교착이 나지 않게 한다(`skip locked` 등).
     - 같은 방식으로 S5 추출 트리거도 고친다(QA-S5-06).
   - 부분 인사이트는 저장하지 않는다(카드 `[가정]`). 단계 1 결과는 작업의 단계 출력에만 남는다.

3. **`evidence_links` 출처 검사 확장 (S5에서 넘김)**
   - `jd_requirement`: `source_id` = `jd_requirements.id`, 같은 사용자·같은 지원 프로젝트
   - `jd_sentence`: `source_id` = `job_descriptions.id`, `source_locator = {sid, start, end}`이고 `sid`가 그 JD 문장에 있어야 한다.
   - 요건 행 삭제는 MVP에 없다(재추출은 실패 재시도뿐). 그래도 요건 삭제 트리거로 근거의 `source_deleted_at`을 기록하는 규칙을 둔다.

4. **커리어 삭제 영향 (§4.2)**
   - `get_deletion_impact`의 `affected_results.by_application_project[]`에 `{application_project_id, name, insights}`를 채운다. drafts·interview_sessions 키는 0으로 둔다(S7·S8).
   - 집계 기준: 삭제될 커리어 행을 가리키는 `insight` owner의 `evidence_links` → 서로 다른 insight 수.
   - `delete_career_item`의 `result_mode`(`keep` / `delete_results`, S2 정의에 맞춤): "인사이트 버전" 단위로 처리한다. 지우는 모드면 해당 insight 행을 삭제하고, latest가 지워지면 남은 ready 중 최신을 latest로 올린다 `[가정]`.

5. **목록·보드 진행 표시용 조회**: 인사이트 상태(없음 / 생성 중 / 있음). 서비스 select로 충분하면 RPC는 만들지 않는다.

6. **grants·pgTAP**
   - grants 허용 목록
   - `insights.test.sql`: RLS 교차 사용자, 버전 증가, latest 교체, 세대 검사, 트리거, 근거 삽입, 연쇄 삭제
   - evidence 출처 검사(jd_*)
   - 삭제 영향·결과 모드
   - 첫 호출 권한
   - QA-S5-06 동시성(가능하면 dblink 없이 잠금 순서를 검증하는 단위 테스트, 어렵다면 노트에 근거)

## 계약 — AI (`src/server/ai/`)

1. **스키마** `schemas/AI-02.ts`: 단계 1(`matches`)과 단계 2(`strengths`, `gaps`, `strategy`)의 모델 출력 스키마. 카드 그대로이고 공급자 공통분모 규칙을 따른다.
2. **프롬프트** `prompts/AI-02/`
   - `ai-02.match.v1+common.v1`, `ai-02.synthesize.v1+common.v1`
   - 판정 기준과 경계 사례 3개, 금지 표현(합격 가능성·점수)
   - 대응 방안은 3종으로 제한한다.
   - 데이터 블록 분리(C-4)
   - 경력 팩은 프리픽스에 두어 캐시가 잘 맞게 한다(C-8).
3. **파이프라인** `pipelines/AI-02.ts`
   - `matchRequirements({ pack, requirements(batch), jdSentences, jdMeta }, deps)`: 배치 1개 = 호출 1개. 배치 분할 함수 `batchRequirements(reqs, 8)`.
   - `synthesizeInsight({ pack, requirements, matches, jdMeta }, deps)`
   - `finalizeInsight(...)`: 병합 → 검증 → 저장 payload
   - **검증**
     - V-1~V-3, V-8은 기존 `validation/evidence.ts`를 재사용한다.
     - V-4
       - 충족·부분 충족 판정의 근거가 0개면 `no_evidence`로 강등한다.
       - 강점·지원 방향·`reframe`/`prepare_answer` 대응은 근거가 0개면 제거한다.
     - **`met` 강등 규칙**: 근거에 `project_detail.action`/`result` 또는 `achievement`가 없으면 `partial`로 내린다.
     - 강점의 `requirement_refs`가 `no_evidence` 요건만 가리키면 제거한다. 강점은 최대 3개, 우선순위는 최대 5개로 자른다.
     - V-5 수치 가드: 강점 설명, 지원 방향, 대응 방안 텍스트에 적용한다. 위반 시 단계 2를 1회 재생성하고, 그래도 실패하면 `[수치 확인 필요]`로 치환한다.
     - 별칭(`REQ-n`, `PRJ-n` 등)은 UUID로 바꾼다. 존재하지 않는 `requirement_ref`는 판정을 버린다.
     - 요건마다 판정이 정확히 1개다. 빠진 요건은 `no_evidence` + 근거 없음으로 채운다 `[가정]`.
   - 서버 계산: `summary_counts`, `data_sufficiency`(`thin` = complete 프로젝트 2개 이하 또는 정량 성과 0개), `item_key`(`requirement_matches.<요건uuid>`, `strengths.n`, `gaps.n`, `gaps.n.actions.m`, `strategy.positioning`, `strategy.project_priorities.n`)
   - 반환: 저장 payload(db 합의 모양), `validation_report`, 사용량 메타. 단계 1 출력은 작업 단계 출력으로 넘길 수 있는 직렬화 형태로 둔다(함수 간 재시도 대비).
4. **`input_hash`** = `hash(insight, prompt_version, provider, model, career_snapshot_hash, requirements_hash)`. 기존 `input-hash.ts`를 쓴다.
5. **fixtures·테스트**: 충분한 데이터 1, 얇은 데이터 1, 스킬 태그만 있는 경우(`met` 강등), 회고만 근거인 경우(V-8), 수치 위반, 별칭 오류, 영문 JD 요건 1.

## 계약 — API

1. **작업 정의** `src/server/jobs/insight.ts` (`job_type = 'insight'`, `target_type = 'application_project'`, 기본 등급)
   - 단계
     1. `prepare`: JD 추출이 안 됐으면 `ensureJdExtracted`를 선행한다(D-30, 같은 작업의 첫 단계). 실패하면 그 원인으로 작업이 실패한다. 이어서 `begin_insight`를 부른다.
     2. `match`: 유료 등급은 모든 배치를 한 단계에서 병렬로 실행한다(S4 병렬 재시도 규칙 적용). 무료 등급은 배치 1개 = 단계 1개이고 호출 간격 6초다(C-12).
     3. `synthesize`
     4. `validate`: 저장 → `complete_insight` → 작업 완료
   - 진행 `{stage, done, total}`. 단계 1이 끝나면 요건별 판정을 부분 결과로 상태 응답에 노출한다(S-16 부분 결과).
   - 한 단계는 60초 안에 끝낸다.
2. **시작 라우트** `POST /api/application-projects/[id]/insights`
   - 입력 `{ regenerate?: boolean }`
   - 처리 순서
     - 사용자 확인 → `get_data_readiness().features.insight.ready`(아니면 422 `insufficient_data` + readiness 그대로 → 화면 C-10)
     - 실행 게이트
     - `input_hash` 재사용: `regenerate`가 아니고 같은 해시의 ready가 있으면 `{reused: true, insightId}`, 토큰 사용 없음
     - 작업 시작 → `{jobId}`
   - 진행 중이면 기존 작업을 반환한다(동시 1개).
   - 상태 조회와 취소는 기존 `/api/ai-jobs/[id]` 경로를 재사용한다.
3. **조회** `getInsight(applicationProjectId, { version? })` (S-16)
   - 최신 ready 결과 + 요건(별칭 대신 내용) + 근거 칩 목록
     - 근거 칩은 `evidence_links`에 원본 상태(최신 / 변경됨 / 삭제됨)와 표시 라벨을 붙인다. 공용 근거 칩 조회 함수가 없으면 이번에 `src/server/services/evidence/`에 만든다(S7·S8 재사용).
   - 공급자 배지(provider·model)
   - "데이터 변경됨"(F-P2-07 최소): 현재 `career_snapshot_hash`·`requirements_hash`가 저장값과 다르면 `stale: true`
   - 진행 중 작업과 최근 실패(C-20)
4. **진행 표시**: S5의 `loadProgress`에서 `insight: 'none' | 'generating' | 'ready'`를 채운다(목록·보드·허브).
5. **보완점 → 입력 링크(F-P2-09)**: `add_data` 대응에 화면이 쓸 정보(관련 요건 id)를 조회 결과에 둔다. 대화 시작 `return_target`은 S4에 있다.
6. **삭제 영향**: 커리어 삭제 확인 화면 서비스가 새 `by_application_project` 필드를 그대로 전달하는지 확인한다(contracts 갱신).
7. **테스트**
   - 단위: 가짜 LLM으로 유료 병렬·무료 순차, 배치 일부 실패 재시도, 재사용, readiness 미달, JD 미추출 선행, 취소, 삭제 중 실행
   - 로컬 DB 통합: 생성 → 근거 저장 → 재생성 latest 교체 → stale 판정 → 프로젝트 삭제 연쇄

## 팀 작업과 의존
| 담당 | 작업 | 의존 |
|------|------|------|
| db-engineer | 마이그레이션 1~6, QA-S5-06, pgTAP, 타입 생성, 노트(시그니처·payload 모양을 먼저) | 없음 |
| ai-pipeline-engineer | AI-02 스키마·프롬프트·파이프라인·검증·payload 매퍼·fixtures | payload 모양은 db 노트 기준 |
| api-engineer | 작업 정의, 라우트, 조회, 근거 칩 서비스, 진행 표시, 테스트 | 파이프라인 시그니처(ai 노트), 타입(db) |
| backend-qa | 점진 검사 → 전체 검사(최대 2라운드) | 각 모듈 |

## 원격 브랜치
적용하지 않는다.

## `[가정]` (spec-gaps에 기록)
1. 부분 인사이트는 저장하지 않는다. 배치 일부가 최종 실패하면 작업 전체가 실패한다(카드 `[가정]` 유지).
2. 모델이 빠뜨린 요건은 `no_evidence`로 채운다.
3. 커리어 삭제로 latest 인사이트를 지우면 남은 ready 중 최신을 latest로 올린다.
4. `data_sufficiency = thin`의 규칙은 complete 프로젝트 2개 이하 또는 정량 성과 0개다(카드 예시를 그대로 규칙으로 쓴다).
5. 인사이트 개별 삭제는 MVP에 없다.
