# S6 백엔드 QA 리포트 (라운드 1)

> 범위: S6 인사이트(AI-02 2단계 비동기 작업) + QA-S5-06 잠금 순서 수정. 기준은 HEAD(1bf2832) 대비 커밋되지 않은 diff.
> 실행 전 로컬 스택에 `supabase db reset`을 다시 적용했다(S6 마이그레이션 5개 포함). `database.types.ts`는 `supabase gen types --local` 결과와 같다(diff 0).
> 코드는 고치지 않았다. 커밋하지 않았다.

## 검사 실행 결과 (`run-checks.sh --build`)
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | 경고 0 |
| vitest | **실패** | 69파일 중 68 통과, 1117개 중 1116 통과. 실패는 `writing-chat.integration.test.ts:175`의 `expected 91 to be 90` 1건 → QA-S6-05 |
| build (`pnpm build`) | 통과 | |
| pgTAP (`supabase test db`) | 통과 | 33파일, 1444개 |
| 수동 재현 SQL (롤백) | 실행함 | 수동 재시도 → `complete_insight`가 `stale_run`(QA-S6-01). 스크립트는 롤백만 하고 데이터를 남기지 않음 |
| DB·호스트 시계 차 측정 | 실행함 | DB `clock_timestamp()`가 호스트보다 약 **+52 ms** 앞섬(왕복 32 ms, 5회 측정) → QA-S6-05 근거 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM A.8 + AI 공통 메타 ↔ 마이그레이션 | 통과 | 컬럼·CHECK·`unique (application_project_id, version_no)`·`is_latest` 부분 유니크·재사용 인덱스 모두 일치. `ai_job_id` 복합 FK는 spec-gaps(db ①)에 기록됨 |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과 | 타입 재생성 결과 diff 0. 서비스의 `.from('insights'/'evidence_links'/'jd_requirements')` 컬럼과 `.rpc('begin_insight'/'complete_insight'/'fail_insight')` 이름 모두 존재 |
| Q3 | RPC 시그니처 ↔ 호출자 | 통과 | `services/insight/db.ts:126,132,143`의 `p_*` 인자 = SQL. 반환 `applied`/`version_no` 키 일치. payload 모양(`storage/insight.ts`) = `private.insight_payload_valid` 검사 항목 일치 |
| Q4 | RPC raise ↔ 오류 매핑 | 통과 | 새 코드 5개(`insight_not_found`, `insight_in_progress`, `jd_not_extracted`, `invalid_insight_payload`, `invalid_evidence_source`)가 `db/errors.ts`에 있음. `invalid_ai_metadata`·`application_project_not_found`·`invalid_ai_job`은 기존 매핑 |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 | 이슈 | 시작 라우트 순서(소유 → readiness 422 → 게이트 409 → 재사용 → 작업)는 계획대로. QA-S6-06(재사용이 latest가 아닌 버전을 돌려줌) |
| Q6 | SSE | 해당 없음 | S6은 비동기 작업 + 폴링(`partial`)만 |
| Q7 | AI 출력 ↔ 저장 | 이슈 | `result`·`match_stage_result`에 `evidence` 키 없음(TS 테스트 + DB `jsonb_path_exists` 거부). C-3 매핑: `jd_sentence` → `source_id = job_descriptions.id` + `source_locator {sid,start,end}`, `jd_requirement` → 요건 UUID, 출처 검사 트리거가 다른 프로젝트·잘못된 위치를 거부. **자유 텍스트 안의 별칭(PRJ-n, REQ-n …)은 풀리지 않고 저장됨** → QA-S6-04 |
| Q8 | enum DB ↔ TS | 이슈 | `insights.status` = `INSIGHT_STATUSES`, `job_type`·`error_code`(`not_a_jd` 포함) 일치. 진행 단계 `prepare`가 `AI_PROGRESS_STAGES`·C-6에 없음 → QA-S6-07 |
| Q9 | 작업 종료 경로·사용 기록 | **이슈** | 호출 1회 = 사용 기록 1행(통합 테스트: jd_extraction 1 + insight 2), 재사용 시 0행, 무료 등급 배치 간 6초·60초 예산·호출별 재시도는 `STEP_CONTINUE`로 적용됨. 그러나 QA-S6-01(수동 재시도 항상 실패), QA-S6-02(시간 초과 시 성공 배치 재호출), QA-S6-03(종합 단계 한 단계 안 다중 호출) |
| Q10 | 보안·개인정보 | 통과 | pgTAP: `insights` 교차 사용자(사용자·app_ai_writer·sub 없음), 직접 쓰기 권한 없음(grants.test), definer RPC 모두 `search_path = ''` + `private.current_uid()` 소유 검사, 트리거 skip locked. 새 로그 4곳(`job.ts:138,144,208,251`)은 jobId·코드·개수뿐. 검증 로그는 개수만(`AI-02.ts:497`). JD 출처 오류의 `detail`에도 본문 없음 |
| Q11 | UI ↔ 백엔드 | 해당 없음 | S-16 화면 없음 → "연결 대기" |

검증 규칙 테스트: V-1·V-2·V-3(별칭·필드·인용), V-4(강점·포지셔닝·reframe/prepare_answer 제거, 판정 강등), `met` 강등(스킬·상황·과제만), V-5(단계 1 치환, 단계 2 재생성 1회 → 치환), V-6(`schema_invalid`), V-8(회고만 근거 → `no_evidence`)이 모두 `pipelines/AI-02.test.ts`·`validation/insight.test.ts`에 있다.

### 집중 점검 결과 요약
- **조작 방지(근거 없는 저장)**: `met`/`partial`은 경력 사실 근거(JD·회고 제외)가 0개면 `no_evidence`, `met`은 상세 `action`/`result` 또는 성과가 없으면 `partial`(`validation/insight.ts:109-124`). 강점·포지셔닝·`reframe`/`prepare_answer`는 `judgment`라 근거 0개면 제거(`validation/evidence.ts:175-183`). 회고만 근거면 V-8로 근거가 빠져 위 규칙에 걸린다. 수치는 생성 텍스트 전부에 V-5. 단계 사이 커리어가 바뀌면 근거 재검사 후 규칙 재적용(`AI-02.ts:305-348`). → 통과. 다만 `profile.desired_job_title` 같은 희망 정보도 "경력 사실"로 세는 점은 스펙 차이로 넘김(아래).
- **버전·latest·stale_run·트리거**: `begin_insight` 버전 증가(행 잠금), `complete_insight` 세대·상태 검사 + latest 교체, 작업 종료 트리거(`failed`/`canceled`/`succeeded`) → `failed`. pgTAP로 고정됨. 단 수동 재시도와 결합하면 QA-S6-01.
- **skip locked 보정 읽기**: 인사이트 `resolveInsightRun`, 진행 표시(작업 기준), S5 `resolveExtraction` 모두 "생성 중인데 작업 끝남/없음"을 실패로 본다. 통과.
- **실행기 확장 회귀**: 기존 작업 유형은 `partials`가 없어 `resumed` 분기를 타지 않는다. 종료 진행값만 `max(total, 보고된 total)`로 바뀌었고 기존 테스트 통과. 회귀 없음.
- **input_hash**: 어댑터가 `model = request.model`(= `resolveModel`)을 돌려주므로 라우트 해시 = finalize 해시(통합 테스트 재사용 통과). 통과.
- **동시 실행 1개**: DB `ai_jobs_in_flight_target_key` + `findInFlight`(대상 기준). 통과.
- **커리어 삭제**: `by_application_project`·`delete_results`(latest 재지정)·`keep_results` pgTAP 22개 + 통합 테스트(`insights: 2`). 통과.
- **프로젝트 삭제**: 인사이트·근거 연쇄 삭제, `ai_usage_records.application_project_id`는 `set null`로 사용 기록 유지. 통과.

## 이슈

### QA-S6-01 [Major] 인사이트 작업의 수동 재시도("다시 시도")가 항상 `stalled`로 끝난다 — 호출 비용만 쓰고 결과 없음
- 담당: db-engineer(주), api-engineer(테스트)
- 근거
  - 작업이 실패하면 트리거가 이 작업의 `generating` 행을 `failed`로 바꾼다: `supabase/migrations/20261101000300_s6_insight_rpcs.sql:396-400`
  - 수동 재시도는 `step_outputs`(= `prepare.insightId`)를 그대로 두고 `queued`로 돌린다: `src/server/jobs/runner.ts:256`. 그래서 `prepare`는 다시 돌지 않고, 돌아도 `begin_insight`는 같은 작업의 행을 상태와 관계없이 그대로 돌려준다(`...insight_rpcs.sql:183-186`).
  - `validate`의 `complete_insight`는 행이 `generating`이 아니면 `stale_run`을 돌려준다(`...insight_rpcs.sql:276-279`). 그러면 `job.ts:255`가 `stalled`로 실패시킨다.
  - 로컬 DB 재현(롤백 트랜잭션): begin → 작업 `failed`(트리거로 행 `failed`) → `queued`→`running`, 세대 2 → `begin_insight`는 같은 id → `complete_insight(…, 2, …)` = `{"reason": "stale_run", "applied": false}`
  - 단위 테스트가 놓친 이유: `job.test.ts:84-99`의 `FakeInsightStore.complete`는 항상 `applied: true`라 트리거 동작이 없다(`job.test.ts:225-250` "manual retry re-calls only that batch"가 성공으로 끝남). 통합 테스트에는 수동 재시도 경우가 없다.
  - 영향: `rate_limited`·`provider_unavailable`·`timeout`·sweep `stalled` 등 재시도 가능한 실패 후 사용자가 "다시 시도"를 누르면 남은 배치 + 종합 호출(사용자 키 비용)을 쓴 뒤 항상 실패한다.
- 수정 제안: (db) 같은 작업의 행이 `failed`이고 그 작업이 다시 `queued`/`running`이면 `begin_insight`가 행을 `generating`으로 되살리도록(다른 `generating`·진행 중 작업이 없을 때) 하거나, `complete_insight`가 "같은 `ai_job_id` + 현재 세대 + running"이면 `failed` 행도 받도록 한다. (api) `validate` 직전에 `begin_insight`를 다시 불러 행 상태를 맞추고, 실제 DB 트리거를 쓰는 통합 테스트(실패 → `retryJob` → ready)를 추가한다.
- 상태: 열림

### QA-S6-02 [Major] 유료 병렬 매칭에서 단계 시간 초과가 나면 이미 성공한 배치가 저장되지 않아 재시도 때 다시 호출된다
- 담당: api-engineer
- 근거
  - `src/server/services/insight/job.ts:198-206`: 모든 배치를 `allSettled`로 기다린 **뒤에만** `persist()`(= `savePartial`)를 부른다.
  - `src/server/jobs/runner.ts:703`: `savePartial`은 신호가 abort됐으면 곧바로 `StepAborted`를 던진다. 단계 deadline(45초)이 지나면 실행기는 단계를 경주로 끊는다(`runner.ts:714-716`).
  - 예: 배치 A가 20초에 성공, 배치 B가 45초 deadline까지 응답 없음 → abort → A의 결과는 저장 시도 전에 버려짐 → `timeout` 자동 재시도(C-11 1회)에서 A를 다시 호출(사용 기록 중복). 계획·spec-gaps(api ⑥⑦)의 "성공한 배치는 다시 부르지 않는다"와 어긋난다. 테스트는 빠른 실패(`failMatch`)만 다뤄 이 경로를 못 잡는다.
- 수정 제안: 배치 promise 안에서 성공 즉시 `saved.set` + `ctx.savePartial(...)`을 부른다(쓰기는 실행기가 직렬화함). 단계 시간 초과 테스트(한 배치 성공, 다른 배치 hang)를 추가해 재시도 때 성공 배치 호출 0회를 고정한다.
- 상태: 열림

### QA-S6-03 [Major] `synthesize` 단계가 한 단계 안에서 공급자를 최대 4번 부른다 — 무료 등급 6초 간격 우회, 재시도 때 성공한 호출 재실행, 45초 deadline 위험
- 담당: api-engineer(단계 구조), ai-pipeline-engineer(재생성 분리 API)
- 근거
  - `src/server/ai/pipelines/AI-02.ts:407-417`: 첫 종합 호출 뒤 V-5 위반이면 같은 함수 안에서 `insight.synthesize.regen`을 바로 부른다. 각 호출은 `generateStructured`의 V-6 재시도 1회를 포함한다(최대 4호출).
  - `src/server/services/insight/job.ts:215-237`: 이 모두가 한 `synthesize` 단계(타임아웃 45초, `constants.ts:17`)다.
  - (1) 무료 등급: C-12 "사용자·공급자 단위 최소 간격 6초"는 단계 시작 전에만 검사(`runner.ts:427`)하므로 재생성 호출이 첫 호출 직후 간격 없이 나간다. (2) 재생성이 실패하거나 시간 초과면 단계 재시도가 이미 성공한 첫 종합 호출을 다시 부른다(QA-S3a-08 규칙 위반, 비용 중복). (3) 카드 지연 추정은 단계 2 호출당 15~20초(중간 사고, 출력 12k 한도)라 재생성까지 한 단계에 넣으면 45초를 넘기 쉽고, V-5 위반은 같은 입력에서 반복되기 쉬워 시간 초과 → 재시도 → 다시 시간 초과로 갈 수 있다.
- 수정 제안: 첫 종합 결과를 `savePartial`로 저장하고 재생성을 별도 실행 단위로 나눈다(무료 등급은 `STEP_CONTINUE`로 간격·예산·호출별 재시도 적용, 유료 등급도 재시도 때 첫 결과 재사용). ai는 `synthesizeInsight`를 "첫 호출"과 "재생성"으로 나눠 부를 수 있게 하거나, 첫 결과를 입력으로 받아 재생성만 하는 함수를 낸다. 무료 등급 간격·재시도 재호출 0회 테스트를 추가한다.
- 상태: 열림

### QA-S6-04 [Major] 생성 텍스트 안의 별칭(PRJ-n, REQ-n, DET-n, S12 …)이 풀리지 않고 저장·표시된다
- 담당: ai-pipeline-engineer
- 근거
  - 저장 텍스트 필드(`rationale`, `missing_aspect`, 강점 `title`/`description`, 보완점 `description`, 대응 방안 `text`, `positioning`, 우선순위 `reason`)는 V-5 숫자 가드만 거친다(`validation/insight.ts:175-176, 269-270, 307, 312, 325, 341`). 숫자 가드는 별칭을 일부러 건너뛴다(`validation/numbers.ts:15` `ALIAS_PATTERN`) → 별칭 문자열이 그대로 `insights.result`에 남는다.
  - 프롬프트에 "본문에 별칭을 쓰지 말라"는 지시가 없다(`prompts/AI-02/index.ts:25-74`, `prompts/common.ts:12-31`). 오히려 단계 2 입력 `<match_results>`가 `REQ-n`·`DET-n.action` 형태로 별칭을 보여 준다(`AI-02.ts:382-388`). 카드 예시 문장도 "PRJ-3의 재시도 큐 설계를 정리해 두세요"다.
  - 영향: 사용자에게 내부 번호가 노출되고, 별칭 번호는 경력 데이터가 바뀌면 달라지므로 저장된 문장이 다른 항목을 가리키게 된다(C-3 "별칭 참조도 UUID로" 취지 위반). 계획 집중 점검 항목("저장 결과에 풀리지 않은 별칭")에 해당.
- 수정 제안: (1) 두 단계 system에 "설명 문장에는 별칭 대신 프로젝트·요건 이름을 쓴다"를 추가하고, (2) finalize에서 텍스트의 별칭을 현재 alias 지도의 표시 이름(프로젝트명, 요건 요약)으로 바꾸거나, 남은 별칭을 검출해 `validation_report`에 세고 V-5처럼 1회 재생성 대상에 넣는다. 단계 1 `rationale`도 같은 처리. 별칭이 들어간 출력 fixture 테스트를 추가한다.
- 상태: 열림

### QA-S6-05 [Major] vitest 실패 1건 — `writing-chat.integration.test.ts:175`의 "90일" 기대값이 DB·호스트 시계 차로 91이 된다
- 담당: api-engineer
- 근거
  - 실패: `AI writing chat (local stack) > start: …` `AssertionError: expected 91 to be 90`(run-checks 출력).
  - 원인: `last_activity_at`은 DB `now()`(Docker VM 시계), 비교 기준 `now`는 Node 시계(`services/career/tree.ts:29` 기본값 `new Date()`). `daysUntilAutoDelete`(`services/writing-chat/mappers.ts:127-131`)는 `ceil((last_activity_at + 90일 − now) / 1일)`이라, 방금 만든 대화에서 `last_activity_at > now`(DB가 앞섬)면 90일을 아주 조금 넘어 **91**이 된다. 측정한 시계 차는 DB가 약 +52 ms 앞섬(왕복 32 ms)이고, 테스트에서 생성 → 조회 간격이 이보다 짧으면 실패한다. 시각 의존이라 실행마다 흔들린다. S6 변경과 무관(S4 코드).
  - 운영에도 같은 문제가 있다: Vercel 함수와 Supabase DB 시계가 조금만 어긋나도 새 대화에 "91일 뒤 자동 삭제"가 보일 수 있다.
- 수정 제안: `daysUntilAutoDelete`에서 `Math.min(WRITING_CHAT_RETENTION_DAYS, …)`로 상한을 둔다(제품 동작도 바로잡힘). 테스트는 고정 `now`를 주입하거나 경계값이 아니라 범위를 확인한다.
- 상태: 열림

### QA-S6-06 [Minor] `input_hash` 재사용이 latest가 아닌 예전 ready 버전을 돌려줄 수 있다
- 담당: api-engineer
- 근거: `src/server/services/insight/start.ts:49-60`은 같은 해시의 ready 행 중 `version_no`가 가장 큰 것을 고르고 `is_latest`를 보지 않는다. 예: v1(해시 H) → 경력 수정 → v2(해시 H') → 수정 되돌림 → 시작 요청 시 `{reused: true, insightId: v1}`. 그런데 `getInsight`(버전 없음)는 latest인 v2(현재 데이터 기준 stale)를 보여 준다. 화면은 "재사용됨"인데 stale 표시가 그대로 남는다.
- 수정 제안: 재사용은 latest 행의 해시가 같을 때만 하거나(가장 단순), 예전 버전을 재사용하면 그 행을 latest로 올리는 RPC를 둔다(db). 결정은 스펙 차이로도 남긴다.
- 상태: 열림

### QA-S6-07 [Minor] 진행 단계 `prepare`가 C-6 단계 값과 `AI_PROGRESS_STAGES`에 없다
- 담당: api-engineer
- 근거: `src/server/services/insight/job.ts:37,127-128`(`stage: "prepare"`), `services/insight/read.ts:247`(기본값 `"prepare"`) ↔ `src/lib/contracts/enums.ts:139-151`(`match`부터 시작, `prepare` 없음) ↔ AI 명세 C-6 "진행 단계 값"(AI-02 `match` → `synthesize` → `validate`). 화면이 단계 이름으로 라벨을 고르면 첫 단계(선행 추출 포함 최대 약 30초)에 알 수 없는 값이 온다.
- 수정 제안: `AI_PROGRESS_STAGES`에 `prepare`를 더하고 스펙 차이로 기록(아래에 넘김)하거나, 첫 단계를 `match` 0/N으로 보고한다.
- 상태: 열림

### QA-S6-08 [Minor] `prepare`의 선행 추출에 인사이트 작업의 취소·시간 초과 신호가 전달되지 않는다
- 담당: api-engineer
- 근거: `src/server/services/insight/job.ts:132-135`는 `ensureJd`에 `ctx.signal`을 넘기지 않는다. `ensureJdExtracted`(`services/application/extraction.ts:322-387`)는 자기 `jd_extraction` 작업의 취소만 본다. 사용자가 인사이트 작업을 취소해도 추출 호출과 그 안의 즉시 재시도(최대 30초)가 계속되어 사용자 키로 호출이 나간다(QA-S3a-04 취지). 실행기가 단계를 끊은 뒤 재시도하면 아직 도는 추출 때문에 `extraction_in_progress` → `stalled`가 된다.
- 수정 제안: `InsightJdExtractor`에 `signal`을 넘기고, abort되면 추출 작업에 취소를 요청(또는 `callSignal`에 합침)한다.
- 상태: 열림

### QA-S6-09 [Minor] 작업 도중 요건이 수정되면 단계 1 판정이 옛 요건 기준인데 새 `requirements_hash`로 저장된다(또는 호출 후 `stalled`)
- 담당: ai-pipeline-engineer(판정), api-engineer(작업)
- 근거: 단계마다 문맥을 DB에서 다시 만든다(`job.ts:113-119`). 요건 id가 같고 내용만 바뀌면 `restoreMatches`(`AI-02.ts:305-348`)는 옛 판정을 그대로 쓰고, finalize는 현재 문맥의 `requirementsHash`를 저장한다(`AI-02.ts:479`) → 조회의 stale 판정이 `false`가 되어 "데이터 변경됨"이 뜨지 않는다. 요건이 추가·삭제되면 `restoreMatches`가 일반 Error → 작업 `stalled`(단계 1 호출 비용은 이미 씀).
- 수정 제안: 단계 1 배치에 이미 있는 `requirementsHash`를 저장값으로 쓰거나, 종합 시점 해시와 다르면 stale로 표시되도록 단계 1 해시를 저장한다. 요건 목록 변경은 `stalled` 대신 명시적 코드로 끝내고 진행 중 요건 편집을 막을지 결정(스펙 차이).
- 상태: 열림

## 재검사 대상 아님 / 확인만 한 것
- QA-S5-06(잠금 순서): 트리거 경로 `for update … skip locked`(`20261101000400…sql:23-28`, 인사이트 `…insight_rpcs.sql:129-133`), `fail_*`는 기다리는 경로 유지. pgTAP는 구조만 고정하고 실제 교착 재현은 db 노트의 두 세션 수동 재현에 근거한다(pgTAP로 두 연결 재현 불가 — 인정). 읽기 보정은 위 "skip locked 보정 읽기"대로 통과.
- 새 마이그레이션의 커리어 삭제 경로 잠금 순서(커리어 행 → 근거 → 프로젝트 → 인사이트)와 `complete_insight`(프로젝트 → 인사이트 → 근거 insert)는 서로 기다리는 순환이 없다.

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
`_workspace/backend/spec-gaps.md` "2026-11-01 · S6 (qa)"에 추가했다.
1. 희망 정보(`profile.desired_job_title`·`interested_industries`)가 V-4 "경력 사실 근거"로 셈 → `partial`·강점이 희망 직무만으로 남을 수 있음. C-3/AI-02가 어떤 출처를 사실 근거로 볼지 정해 달라.
2. AI-02 카드 예시 문장에 별칭(`PRJ-3`)이 들어 있음 → 저장 텍스트의 별칭 표기 규칙(이름으로 바꿀지) 필요(QA-S6-04).
3. 진행 단계 `prepare`(D-30 선행 추출)가 C-6 단계 값에 없음(QA-S6-07).
4. `input_hash` 재사용 대상이 latest만인지, 예전 버전 재사용 시 latest를 바꾸는지 C-6이 말하지 않음(QA-S6-06).
5. 인사이트 작업 중 요건 편집(F-P2-03) 허용 여부와 그때의 결과 처리(QA-S6-09).

---

# S6 백엔드 QA 리포트 (라운드 2, 최종)

> 기준: 각 담당 노트의 "QA 1차 반영" 절 + spec-gaps S6 ⑨·⑫~⑰. 로컬 스택에 `supabase db reset`을 다시 적용한 뒤 검사했다. 코드는 고치지 않았고 커밋하지 않았다.

## 검사 실행 결과 (`run-checks.sh --build`)
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 70파일, 1145개 전부 통과(라운드 1의 90/91 실패 해소) |
| build | 통과 | |
| pgTAP | 통과 | 34파일, 1464개(`insights_retry.test.sql` 20개 추가) |
| `retry_repro.sql` 재실행(롤백) | 통과 | 실패 → 수동 재시도(세대 2) → `begin_insight` 같은 행 → `complete_insight` = `{"applied": true, "status": "ready", "is_latest": true, …}`(라운드 1에서는 `stale_run`) |
| 생성 타입 | 최신 | `supabase gen types --local` 결과와 같음(`insights.run_generation` 포함) |

## 이슈 재확인
| 이슈 | 결과 | 확인 내용 |
|------|------|-----------|
| QA-S6-01 [Major] | **수정됨(확인 완료)** | `insights.run_generation` 추가. `insight_mark_failed`가 실패시킨 세대를 찍고(`…insight_rpcs.sql:139-144`), `begin_insight`는 같은 작업의 `failed` 행을 세대가 더 클 때만 다시 연다(`:192-204`), `complete_insight`는 `generating` 또는 "이전 세대에 실패한 행"만 받는다(`:298-301`). 같은 세대의 `fail_insight` 뒤에는 계속 `stale_run`. 재현 스크립트 `applied: true`, pgTAP `insights_retry.test.sql`, 실제 트리거를 쓰는 통합 테스트(`insight.integration.test.ts:380`) 통과 |
| QA-S6-02 [Major] | **수정됨(확인 완료)** | 유료 병렬 배치가 성공 즉시 `saved.set` + `persist()`(`services/insight/job.ts` match 단계 `allSettled` 내부). 저장은 실행기가 직렬화하고, 뒤 호출이 앞 호출의 상위 집합을 쓰므로 순서 문제 없음. 테스트 `job.test.ts:290`(느린 배치 deadline → 재시도는 그 배치만) 통과 |
| QA-S6-03 [Major] | **수정됨(확인 완료)** | 단계 `prepare → match → synthesize → synthesize_regen → validate`. 단계당 논리 호출 1개(V-6 재시도 1회 포함, 기존 관례). `synthesize_regen.callsProvider`는 이전 출력을 보고 위반이 있을 때만 true(`runner.ts:428`) → 위반 없으면 간격·호출 없이 통과. `validate`는 `finalizeInsight` + `complete_insight`만(호출 없음). 테스트 `job.test.ts:367`(무료 등급 종합·재생성 간격 ≥ 6초), `:385`(재생성만 재시도, 첫 종합 재호출 없음), `:402` 통과 |
| QA-S6-04 [Major] | **수정됨(확인 완료)** | 저장되는 모든 문장(단계 1 `rationale`·`missing_aspect`, 강점 제목·설명, 보완점 설명, 대응 방안, 포지셔닝, 우선순위 이유)이 `cleanText`(V-5 → 별칭을 표시 이름으로) 를 거친다(`validation/insight.ts:178-179, 292-293, 330, 335, 348, 364`). 사용자 데이터에 원래 있는 별칭 모양 토큰(예: AWS "S3")은 보존(`alias-text.ts:24-28`). 한국어 조사가 붙은 경우(`PRJ-3의`)도 `\b` 경계가 맞다. 프롬프트 v2(`ai-02.match.v2`, `ai-02.synthesize.v2`)에 "문장에는 이름" 규칙. 상태 응답 `partial`의 단계 1 이유도 정리된 문장이다. `alias-text.test.ts` 통과 |
| QA-S6-05 [Major] | **수정됨(확인 완료)** | `daysUntilAutoDelete`가 `Math.min(90, …)`로 상한(`writing-chat/mappers.ts:132`). 통합 테스트는 DB 시각을 `now`로 주입. vitest 전체 통과 |
| QA-S6-06 [Minor] | **수정됨(확인 완료)** | 재사용은 latest ready 행의 `input_hash`가 같을 때만(`services/insight/start.ts:53-60`, `.eq("is_latest", true)`). spec-gaps ⑬ |
| QA-S6-07 [Minor] | **수정됨(확인 완료)** | `AI_PROGRESS_STAGES`에 `prepare`, `synthesize_regen` 추가(`enums.ts:141,144`). C-6 반영 요청은 spec-gaps ⑫ |
| QA-S6-08 [Minor] | **수정됨(확인 완료)** | `prepare`가 `ctx.signal`을 `ensureJd`에 넘기고, `ensureJdExtracted(deps, id, { signal })`가 abort 시 호출·재시도를 멈추고 추출 작업을 `canceled`로 닫는다. S5 호출자는 선택 인자라 영향 없음(S5 테스트 통과) |
| QA-S6-09 [Minor] | **수정됨(확인 완료)** | `prepare`가 요건 목록과 `{careerSnapshotHash, requirementsHash}`를 저장하고, 이후 단계는 그 요건 목록으로 문맥을 만든다. 저장 해시·`input_hash`는 prepare 시점 값 → 작업 중 변경은 조회에서 stale로 보인다. 그래도 요건 집합이 어긋나면 `requirements_changed` → `stalled`(재시도 없음, spec-gaps ⑰). 테스트 `job.test.ts:304`, `:394` |

## 수정이 건드린 경계 재검사
| 경계 | 결과 | 비고 |
|------|------|------|
| 실행기 변경 ↔ 기존 작업 유형 | 통과 | `callsProvider` 기본값은 그대로 true(함수일 때만 이전 출력으로 판단). `partials`·`STEP_CONTINUE`가 없는 작업은 기존 경로. runner·writing chat·JD 추출 테스트 전부 통과 |
| 상태 응답 ↔ `step_outputs` | 통과 | `toAiJobStatusResponse`는 `step_outputs`를 내보내지 않는다. `partial`은 `requirementId`·`status`·`rationale`·`missingAspect`만(근거·첫 종합 답·요건 스냅샷은 서버에만 남음) |
| 사용 기록 = 호출 1회당 1행 | 통과 | 단계 분리 후에도 `insight.match.n`, `insight.synthesize`, `insight.synthesize.regen`(위반 시) 각 1행. 통합 테스트(jd_extraction 1 + insight 2), 재사용 0행 |
| 무료 등급 간격 | 통과 | 배치 사이, 종합 ↔ 재생성 사이 모두 6초 이상(테스트). 호출 없는 `validate`·위반 없는 `synthesize_regen`은 간격 없음 |
| RPC ↔ 호출자(Q3) | 통과 | `begin/complete_insight` 시그니처 불변, 반환 키 불변 |
| 마이그레이션 ↔ 타입(Q2) | 통과 | `run_generation` 반영, 타입 diff 0 |

## 남은 관찰 (이슈 아님)
- db 노트의 남는 경계 `[가정]`: 다른 작업의 `begin_insight` 인계로 `failed`가 된 옛 행도, 그 옛 작업을 나중에 수동 재시도하면 다시 열려 latest가 될 수 있다(버전 번호가 더 낮은 행이 latest). 동시 실행 1개 제약 때문에 새 작업이 끝난 뒤에만 생기며, 사용자가 직접 누른 재시도의 결과다. 기록만 하고 이슈로 열지 않는다.
- 스펙 질문(라운드 1 "S6 (qa)" ①~⑤): ②~⑤는 담당자 쪽 ⑫~⑰로 구현 결정이 기록됐다. ①(희망 정보 `profile.desired_job_title`·`interested_industries`를 V-4 사실 근거로 셀지)은 아직 스펙 답을 기다린다.

## 결론
열린 이슈 없음(Critical 0 / Major 0 / Minor 0). 라운드 1의 9건은 모두 수정됨(확인 완료). 전체 검사 통과. 스펙 질문 1건(S6 (qa) ①)은 리더가 사용자에게 전달한다.
