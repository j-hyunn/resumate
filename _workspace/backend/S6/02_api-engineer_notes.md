# S6 API 구현 노트 (인사이트, AI-02 비동기 작업)

> 상태: QA 1차 반영 완료. `pnpm typecheck`·`pnpm lint`(경고 0) 통과, `pnpm test` 70 파일 1145개 전부 통과(2회 반복 확인). S6 통합 테스트(로컬 스택) 9개는 skip 0이다. 커밋하지 않음.
> 아래 "작업 흐름"의 단계 구성은 QA 1차 반영으로 바뀌었다. 최신 구조는 맨 아래 "QA 1차 반영" 절을 본다.
> 연결(wiring): UI 화면(S-16) 없음 → "연결 대기".

## 엔드포인트 (DM §7 ↔ 파일)
| 작업 | 방식 | 파일 · 함수 |
|------|------|-------------|
| 인사이트 생성·다시 생성 (S-16, F-P2-04·07) | Route Handler `POST /api/application-projects/[id]/insights` | `src/app/api/application-projects/[id]/insights/route.ts` → `services/insight/start.ts` `startInsight` |
| 진행 상태·부분 결과·취소·재시도 | 기존 `/api/ai-jobs/[id]`, `/cancel`, `/retry` | `jobs/status.ts` `jobPartial` → `services/insight/partial.ts` `insightJobPartial` |
| 인사이트 조회 (S-16) | 서비스(Server Component용) + 같은 이름 액션 | `services/insight/read.ts` `getInsight`, `src/server/actions/insight.ts` `getInsight` |
| 근거 칩 조회 (C-01·C-02, S7·S8 재사용) | 서비스 | `services/evidence/index.ts` `loadEvidenceChips`, `toEvidenceChip` |
| 진행 표시 (S-13·S-39·S-31) | `loadProgress` 확장 | `services/insight/progress.ts` `loadInsightProgress` ← `services/application/read.ts` `loadProgress` |
| 작업 정의 `insight` | 실행기 등록 | `services/insight/job.ts` `createInsightJobDefinition`(Next 비의존), `jobs/insight.ts`(운영 연결), `jobs/definitions.ts`(등록, `app-runner.ts`가 import) |
| AI-02 연결 | 파이프라인 어댑터 | `services/insight/pipeline.ts` `createAi02InsightPipeline` |
| DB | 입력 읽기·RPC 래퍼 | `services/insight/db.ts` (`loadInsightInputs`, `createInsightStore`: begin/complete/fail_insight) |
| 커리어 삭제 영향 | 계약 주석만 갱신 | `lib/contracts/career.ts` `AffectedApplicationProject`(모양은 S2부터 같음; 통합 테스트로 `insights: 2` 확인) |

- 구조 정리: `connections()`를 `jobs/connections.ts`로 옮겼다(`app-runner.ts`는 다시 내보냄). 작업 정의가 `app-runner`를 import하면 순환이 생기기 때문이다. `jd-extraction.ts`·`writing-chat-turn.ts`는 `./connections`·`./log`를 직접 쓴다.

## 계약 (`src/lib/contracts/insight.ts`, `evidence.ts`)
- 시작 입력 `{ regenerate?: boolean }`(빈 본문 = `{}`, 모르는 키 거부).
- 시작 응답 200 `{ data }`
  - `{ reused: true, insightId, jobId: null, inProgress: false }` — 같은 `input_hash`의 ready 인사이트. 작업·호출·사용 기록 없음.
  - `{ reused: false, insightId: null, jobId, inProgress }` — 새 작업, 또는 진행 중인 작업(D-34).
- 오류: 422 `{ error: { code: 'insufficient_data', message }, readiness }`(`readiness` = `get_data_readiness().features.insight`, C-10), 409 `ai_not_connected` / `key_invalid` / `ai_consent_required`, 404, 401, 400.
- 작업 상태 `partial`(job_type `insight`): `InsightJobPartial` = `{ kind: 'insight_matches', batchesDone, batchesTotal, requirementMatches: [{requirementId, status, rationale, missingAspect}] }`. 배치가 끝날 때마다 늘어난다. 근거 칩은 없다.
- 조회 `InsightView`
  - `requirements`: 현재 요건(내용·분류·중요도·순서)
  - `extractionStatus`: 끝난 작업 보정 적용(아래)
  - `insight`: `InsightResultView` | null — `versionNo`, C-19 배지(`provider`, `model`, `modelTier`, `connectionTier`), `stale` + `staleReasons{career, requirements}`, `basisNote`, `dataSufficiency`, `summaryCounts`, `requirementMatches[]`(요건 내용 포함), `strengths[]`, `gaps[].actions[]`(`add_data`면 `relatedRequirementIds`, F-P2-09), `strategy.positioning`, `strategy.projectPriorities[]`(현재 프로젝트 이름 → S-10). 항목마다 `itemKey`와 `evidence: EvidenceChip[]`.
  - `activeJob`: 진행 중 작업 `{jobId, status, progress, provider, connectionTier}` | null
  - `lastFailure`: C-20 실패(`AiFailure` + `jobId`, `failedAt`) | null
- 입력 `GetInsightInput { applicationProjectId, version? }`. `version`은 ready 버전만(없으면 404 `insight_not_found`). 이전 버전 열람은 Could지만 읽기는 열어 두었다.
- `EvidenceChip`: `itemKey`, `sourceType`, `sourceField`, `kindLabel`("상세 내용 · 행동", 회고는 "회고 및 배운 점"), `sourceLabel`, `quote`(삭제면 null), `quoteAdjusted`, `isReflection`, `state`(`current`/`changed`/`deleted`), `target`(원본 이동용 id; 삭제면 null).
- 오류 코드(`src/server/db/errors.ts`): `insight_not_found` 404, `insight_in_progress` 409, `jd_not_extracted` 409, `invalid_insight_payload`·`invalid_evidence_source` → `internal_error` 500.

## 작업 흐름 (`insight`, target `application_project`, 기본 등급)
1. **시작**: 소유 확인(RLS) → readiness(미달이면 422, AI 없음) → 연결 게이트 → 해시(JD가 추출됐을 때만: 사용자 세션으로 읽은 행 → AI-02 `buildInsightContext`) → `regenerate`가 아니면 ready 인사이트 재사용 → `startJob`(`regenerate: true`로 실행기 재사용은 끔, `input_hash` 함수·`prompt_version` 기록).
2. **prepare**: `ensureJdExtracted`(S5) — 작업의 고정 공급자·등급, app_ai_writer 읽기, 자기 `jd_extraction` 작업과 사용 기록. 실패 → 같은 코드로 작업 실패(재시도 불가, `retry_after`/`quota_resets_at` 유지). 요건 0개 → `not_a_jd`. 이어서 `begin_insight` → `{insightId, requirementCount, extractedJobId}`.
3. **match**: 단계마다 DB 행으로 문맥을 다시 만든다. 배치 = 요건 8개씩.
   - 유료: 남은 배치를 병렬로 부르고, 성공분은 `savePartial`로 저장한 뒤 실패 하나를 던진다 → 실행기 재시도는 실패한 배치만 다시 부른다.
   - 무료: 실행 1번에 배치 1개, `STEP_CONTINUE` → 실행기의 6초 간격·예산·호출별 재시도.
   - 저장된 배치는 요건 id 목록이 지금 계획과 같을 때만 다시 쓴다.
   - 진행 `match` done/total = 배치 수.
4. **synthesize**: `synthesizeInsight` + `finalizeInsight`(같은 문맥 객체) → `{payload, inputHash}`를 단계 출력으로 둔다(검증 끝난 저장 형태).
5. **validate**(`callsProvider: false`): `complete_insight(insightId, jobId, runGeneration, payload)`.
   - `applied:false`(stale_run)이면 `stalled`로 실패시키고, `complete_ai_job`은 부르지 않는다.
   - RPC 거부(`insight_not_found` 등)도 `stalled`다. 프로젝트가 삭제됐으면 작업 행도 없어 실행기는 `lost`로 끝난다.
   - 순서는 `complete_insight` → (실행기) `complete_ai_job`이다.
- **실패·취소**: 실행기 공통 경로. `generating` 행은 DB 트리거가 `failed`로 바꾼다.
- **사용 기록**: 공급자 호출마다 1행이다. 추출은 `jd_extraction`, 매칭·종합은 `insight`(`insight.match.n`, `insight.synthesize[.regen]`).

### 실행기 변경 (`jobs/runner.ts`, `types.ts`, `supabase-store.ts`) — 모두 선택 기능이고 기존 동작은 그대로다
- `StepContext.partial` / `savePartial(value)`
  - 미완료 단계의 저장분이다. `_meta.partials[stage]`에 직렬화해 조건부로 쓴다(세대·활성).
  - 작업을 잃으면 단계를 abort한다.
  - 단계가 끝나면 지운다.
  - 수동 재시도(`retryJob`)에도 유지된다.
- `STEP_CONTINUE` 반환: 같은 단계를 다시 실행한다. 그 단계의 호출별 재시도 횟수는 초기화된다. 무료 간격·실행 게이트·예산 검사를 다시 거친다.
- `StepContext.runGeneration`: 결과 RPC의 늦은 실행 검사용(`complete_insight`).
- `JobStep.callsProvider: false`: 무료 등급 간격을 생략한다.
- 진행 유지: 저장분이 있는 단계를 다시 시작하면 done/total을 0으로 되돌리지 않는다. 단계가 직접 보고한 total로 끝낸다. 예약 재시도의 `waiting_retry_until`도 done/total을 유지한다.

### 끝난 작업 보정 (리더 요청, QA-S5-06 skip locked 대응)
- 인사이트(`read.ts` `resolveInsightRun`)
  - 진행 중 작업이 있으면 `activeJob`.
  - 최신 비-ready 행이 `generating`이면 그 작업으로 판단한다.
    - failed → 그 실패
    - 없음 또는 성공(complete 없이) → `stalled`
    - 취소 → 표시 없음
  - 그 밖에는 표시 결과보다 늦게 끝난 failed 작업을 보인다.
  - 진행 표시는 작업 기준이라, 남은 `generating` 행이 "생성 중"으로 보이지 않는다.
- S5 읽기(`application/read.ts` `resolveExtraction`)
  - 목록·보드·허브·JD 보기에서 `running` JD의 `extraction_job_id` 작업이 failed·canceled면 `failed` + 그 실패, 없으면 `failed` + `stalled`로 보인다.
  - `failed` JD는 예전과 같다.
  - 인사이트 조회의 `extractionStatus`도 같은 보정을 쓴다.

## 테스트
- `services/insight/job.test.ts`(14, 실제 실행기 + 메모리 저장소 + 실제 createLlm 위 스크립트 공급자)
  - 유료 3배치 병렬 → 성공, 호출 4건 = 사용 기록 4행
  - 배치 하나 실패 → 예약 재시도에서 그 배치만 다시 호출, 부분 결과 2/3
  - 최종 실패 → 수동 재시도에서 실패 배치만 다시 호출
  - stale_run → `stalled`(complete 없음)
  - match 중 취소 → canceled
  - 무료 등급: 배치마다 실행 분리, 간격 ≥ 6초, 진행 1/3 → 3/3, validate는 간격 없음
  - 선행 추출 실패(rate_limited + retry_after) / 성공 후 계속 / `extraction_in_progress` → stalled
  - 요건 0개 → not_a_jd
  - begin 거부 → stalled
  - 보조 함수
- `services/insight/start.test.ts`(6): 422(게이트·작업 없음), 404, 409 연결 2종, 재사용(작업 없음), regenerate(해시 함수·대상·params), JD 미추출(해시 없음·진행 중 작업 따라가기).
- `services/insight/read.test.ts`(7): 결과 → 화면 모양(칩·요건 내용·프로젝트 이름·add_data 링크·stale), 잘못된 멤버 무시, `resolveInsightRun` 5가지.
- `services/application/read.test.ts`(4): `resolveExtraction` 보정.
- `services/evidence/evidence.test.ts`(5): 라벨, current/changed/deleted, jd_sentence, 회고·성과 이동 정보.
- `services/insight/insight.integration.test.ts`(8, 로컬 스택, 실제 RPC·트리거, 실제 AI-01·AI-02 파이프라인, 같은 문맥으로 만든 스크립트 출력)
  - readiness 422 → 작업 0
  - **D-30**: prepare가 추출 → match → synthesize → ready v1 + 근거(project_detail·achievement·jd_sentence). 사용 기록 = jd_extraction 1 + insight 2. 로그에 원문·키 없음.
  - 조회: 칩·배지·stale false, 진행 `ready`
  - 재사용(사용 기록 증가 없음), 다른 사용자 404
  - 커리어 수정 → stale(career) + 칩 "changed" → 다시 생성 → v2 latest, v1 유지, `version: 1` 조회
  - 실패 실행(billing_required) → 행 failed(트리거), `lastFailure`, v2 유지, 진행 `ready`
  - 삭제 영향 `insights: 2`
  - 프로젝트 삭제 → 인사이트·근거 연쇄 삭제
- 실행
  - 전체: `pnpm test`(통합은 `supabase start` 상태에서 자동)
  - 이 슬라이스만: `pnpm vitest run src/server/services/insight src/server/services/evidence src/server/services/application/read.test.ts src/server/jobs`

## 스펙 차이·가정
- spec-gaps "2026-11-01 · S6 (api)" ①~⑪
  - 선행 추출 실패 처리
  - 요건 0개
  - 추출 연결
  - insights 기준 재사용
  - readiness 먼저
  - 무료 순차 구조
  - 병렬 일부 실패
  - partial 모양
  - 진행 우선순위
  - 실패 표시와 끝난 작업 보정
  - 칩 기준
- 계획서 `[가정]` 1~5(db·ai와 공통)는 그대로 따른다.

## 다른 담당자와의 인터페이스
- db
  - 노트 시그니처를 그대로 쓴다: `begin_insight` → uuid, `complete_insight` → `{applied, version_no…}`, `fail_insight` → boolean.
  - payload는 ai `toCompleteInsightPayload` 결과를 그대로 넘긴다. 통합 테스트가 통과한다.
  - 요청은 없다. `fail_insight`는 트리거가 처리하므로 api는 부르지 않는다(래퍼만 있음).
- ai
  - 시그니처를 그대로 쓴다. 다만 `finalizeInsight`가 `inputHash`를 직접 계산하므로(실제 호출 모델 기준) 그 값을 쓴다.
  - 시작 라우트의 재사용 해시는 `computeInsightInputHash(provider, resolveModel(provider,'default'), …)`다. 같은 모델 매핑이면 둘이 같다.
- 일수 경계 실패(`writing-chat.integration.test.ts:175`)는 QA-S6-05로 고쳤다.

## 남은 일
- UI 연결(S-16): 액션·조회 서비스·시작 라우트·`useAiJob` partial.
- S7·S8: `loadProgress`의 서류·면접 수, 근거 칩 서비스 재사용, `definitions.ts`에 작업 등록.

## QA 1차 반영 (2026-11-01, `03_backend-qa_report.md`)
| 이슈 | 반영 |
|------|------|
| QA-S6-01 [Major] | db가 `begin_insight`·`complete_insight`에서 수동 재시도(이전 세대에 실패한 행)를 받도록 고쳤다. api는 코드 변경 없음. 실제 DB 통합 테스트를 추가했다. 흐름: 실패한 작업(`billing_required`) → `retryJob` → `match`부터 재개 → v3가 `ready`·latest, `lastFailure` 없음, 추가 `jd_extraction` 없음(prepare 체크포인트 유지) |
| QA-S6-02 [Major] | 유료 병렬 `match`: 배치가 성공하는 즉시 `savePartial`과 진행 보고를 한다(전에는 `allSettled` 뒤). 테스트: 배치 1 즉시 성공, 배치 2 hang → 단계 시간 초과 → 재시도에서 배치 2만 다시 호출(`insight.match.1` 사용 기록 1행) |
| QA-S6-03 [Major] | 단계를 나눴다. `synthesize`(ai `synthesizeOnce`, 첫 답 JSON을 단계 출력으로 저장) → `synthesize_regen`(ai `regenerateSynthesis`, `first.violations`가 있을 때만 호출) → `validate`(`finalizeInsight` + `complete_insight`, 호출 없음). 이제 단계마다 논리 호출이 최대 1개라, 무료 등급 6초 간격이 그 사이에 적용되고 재시도가 성공한 단계를 다시 부르지 않는다. 실행기: `JobStep.callsProvider`가 이전 단계 출력을 받는 함수도 될 수 있다 → 재생성이 필요 없으면 간격 없이 통과한다. 테스트: 무료 등급 종합·재생성 간격 ≥ 6초, 재생성 실패 시 재생성만 재시도, 위반 없으면 호출 없이 통과 |
| QA-S6-05 [Major] | `daysUntilAutoDelete`를 0~90으로 자른다(`writing-chat/mappers.ts`). 통합 테스트는 대화의 `last_activity_at`(DB 시계)을 `now`로 주입한다. 단위 테스트(+52 ms 앞선 DB 시계 → 90)를 추가했다 |
| QA-S6-06 [Minor] | 재사용은 현재 latest 행의 `input_hash`가 같을 때만 한다. 그 밖에는 새 작업. 단위 테스트를 추가했다 |
| QA-S6-07 [Minor] | `AI_PROGRESS_STAGES`에 `prepare`, `synthesize_regen`을 더했다(spec-gaps S6 (api) ⑫) |
| QA-S6-08 [Minor] | `ensureJdExtracted(deps, id, { signal })`: 호출자 abort → 추출 호출과 재시도가 멈추고 추출 작업은 `canceled`. `prepare`가 `ctx.signal`을 넘긴다. 테스트를 추가했다 |
| QA-S6-09 [Minor] | `prepare`가 요건 목록과 `{careerSnapshotHash, requirementsHash}`를 저장한다. 이후 단계는 그 요건 목록으로 문맥을 만들고(커리어 행은 현재 값), `finalizeInsight({ …, first, regen, snapshot })`가 prepare 시점 해시를 저장한다. 그래서 작업 중 데이터가 바뀌면 저장 직후 "데이터 변경됨"이 뜬다. 테스트: 작업 중 요건 수가 바뀌어도 prepare 목록대로 배치 3개 |
| (리더 결정) | ai `InsightRequirementsChangedError`(`requirements_changed`)는 `stalled`로 끝내고 재시도하지 않는다. 로그 `insight.requirements_changed`를 남긴다(spec-gaps ⑰). 테스트를 추가했다 |

- 최종 단계: `prepare` → `match` → `synthesize` → `synthesize_regen` → `validate`
  - 호출 순서는 `complete_insight` → `complete_ai_job`이다.
  - `stale_run`이면 `stalled`로 끝내고 `complete_ai_job`은 부르지 않는다.
- 단계 출력에 남는 것
  - `synthesize` 단계 출력에는 모델의 첫 답(별칭 형태 + ai `refs`)이 서버 쪽 `ai_jobs.step_outputs`에만 남는다(QA 제안대로).
  - 상태 응답은 `step_outputs`를 내보내지 않는다.
- 파이프라인 인터페이스(`services/insight/job.ts` `InsightPipeline`)
  - 추가: `violations(attempt)`, `regenerate(...)`
  - 변경: `finalize`가 `first`, `regen`, `snapshot`을 받는다.
  - 어댑터는 `services/insight/pipeline.ts`.
- 테스트 수(바뀐 것)
  - `job.test.ts` 21개
  - `start.test.ts` 7개
  - `extraction.test.ts` +1
  - `writing-chat.test.ts` +1 단언
  - 통합 테스트 9개
