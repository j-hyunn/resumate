# S3 AI 파이프라인 구현 노트

S3는 AI 공통 기반만 만든다. 실제 기능(AI-xx)은 없고, 모든 테스트는 가짜 클라이언트·가짜 SDK·합성 픽스처로 돈다(실제 API 호출 없음).

## 파일

| 파일 | 내용 |
|------|------|
| `src/server/ai/models.ts` | 모델 id(default `claude-sonnet-5-5`, light `claude-haiku-5-5`, heavy `claude-opus-5-5`), effort 목록, 장애 대체 모델 표 `AI_UNAVAILABLE_FALLBACK` [가정] |
| `src/server/ai/client.ts` | `AiClient` 인터페이스·요청/결과 타입 (Next 비의존) |
| `src/server/ai/anthropic-client.ts` | 운영 구현 (server-only, `@anthropic-ai/sdk` 1.1.0, beta messages stream) |
| `src/server/ai/fake-client.ts` | 테스트용 가짜 클라이언트 (실행기 테스트에서도 사용) |
| `src/server/ai/errors.ts` | `AiError`(C-6 code, `retryable`), SDK 오류 → C-6 매핑 `mapSdkError` |
| `src/server/ai/structured.ts` | V-6: `generateStructured`(zod 파싱, 1회 재요청), `toOutputJsonSchema` |
| `src/server/ai/log.ts` | C-7 로그 타입(닫힌 필드 집합) |
| `src/server/ai/hash.ts`, `input-hash.ts` | 정규 JSON + SHA-256, C-6 `computeInputHash` |
| `src/server/ai/evidence-rules.ts` | C-3 근거 표(별칭 패턴, 필드 허용값, 인용 필수 여부) |
| `src/server/ai/prompts/common.ts` | 공통 system 블록(C-4 날조 금지·근거·C-5·C-7·C-9), `COMMON_PROMPT_VERSION = "common.v1"` |
| `src/server/ai/context-pack/career-rows.ts` | app_ai_writer 로더 `loadCareerRows`(컬럼 명시, complete만) + 행 타입 |
| `src/server/ai/context-pack/career-pack.ts` | C-1 `buildCareerPack` |
| `src/server/ai/context-pack/jd.ts` | C-2 `splitJdSentences`, `buildJdContext`(REQ-n, Sn) |
| `src/server/ai/context-pack/aliases.ts`, `months.ts` | 별칭 맵, 년-월 계산 |
| `src/server/ai/validation/*` | `normalize`, `quote`(V-3), `evidence`(V-1·2·3·8·7, V-4, V-7 범위), `numbers`(V-5), `placeholders`(C-5), `block`(블록 단위 묶음), `report`(validation_report) |
| `src/server/ai/storage/evidence-links.ts` | `toEvidenceLinkRows`, `stripEvidence`, `resolveRefs` |
| `src/server/ai/streaming/*` | `json-incremental`(증분 JSON 파서), `blocks`(block_id 블록 추출), `structured-stream`(스트리밍 파이프라인 뼈대), `events`(이벤트 타입) |

## 기능별 모델·prompt_version
- S3에는 기능이 없다. 기능 슬라이스 규칙: `prompt_version`은 `"<기능>.<단계>.vN+common.v1"` 형식으로 공통 블록 버전을 포함한다(공통 블록을 고치면 모든 기능의 `input_hash`가 바뀌게).
- 모델 선택은 `resolveModel(tier)`. 카드별 effort는 요청의 `effort`로.

## SDK 확인 결과 (decisions 2026-10-26 확인 요청)
- `@anthropic-ai/sdk` 1.1.0 타입: `OutputConfig { effort?, format?: JSONOutputFormat { type: 'json_schema', schema } }`가 일반 messages와 beta messages 모두에 있다. **`output_config.format`으로 구조화 출력 가능 — AI 명세 C-4대로 구현했다.** 도구는 보내지 않는다.
- claude-api 스킬: Sonnet 5.5·Opus 5.5는 강제 `tool_choice`(`any`/`tool`)가 400 → 하네스 스킬의 "강제 tool" 지침은 이 모델들에서 동작하지 않는다(decisions 기록과 일치). `ai-pipeline-impl` 스킬 수정 필요(리더에게).
- thinking은 생략(= adaptive). Sonnet 5.5/Opus 5.5에서 `disabled`는 400. 깊이는 `output_config.effort`.
- 거절 대체: beta `server-side-fallback-2026-07-01` + `fallbacks: "default"` (Sonnet 5.5는 Claude API에서 `"default"` 형식만). → spec-gaps 기록.
- 긴 출력 대비로 항상 `beta.messages.stream` 사용, `complete()`는 스트림을 끝까지 읽는다. SDK `maxRetries` 2(429/5xx/연결).

## 공개 인터페이스 (api-engineer와 합의, 반영 확인됨)
- `AiClient { complete(req) → AiResult; stream(req) → AsyncIterable<{type:"text_delta",text} | {type:"final",result}> }`.
  `AiRequest { feature, promptVersion, model, system: AiTextBlock[], user: AiTextBlock[], outputSchema, effort?, maxTokens?, jobId?, signal? }`, `AiTextBlock { text, cache? }`(cache → 그 블록 뒤 캐시 브레이크포인트, C-8).
- 취소: `controller.abort("canceled")` → `AiError("canceled")`, 그 밖의 abort → `timeout`.
- `AiError.retryable`: model_unavailable, rate_limited, schema_invalid, refused, timeout. 실행기(`src/server/jobs/runner.ts`)가 이 값으로 1회 재시도.
- 스트리밍 이벤트 `AiStreamEvent`(`streaming/events.ts`) = contracts `AiStreamEventSchema`(api-engineer). `error.category`는 SSE 직렬화가 채운다. `support.test.ts`가 이벤트 이름 목록 일치를 고정.
- 단계 ctx: 계획안 + `jobType`, `stage`, `attempt`(api-engineer 노트). 기능 파이프라인은 `run(input, { ai, now, logger })` / `stream(input, { ai, signal, now })` 순수 함수로 만들고 단계 함수가 로드 → 파이프라인 → 저장을 잇는다.

## 컨텍스트 팩 (C-1, C-2)
- 포함: `complete` 행만. 부모가 draft이거나 로드되지 않았으면 자식 제외(경력/교육 → 프로젝트 → 상세 → 성과, 경력 → 경력 단위 성과). 제외된 프로젝트에만 붙은 스킬 제외, 직접 추가 스킬은 `<manual_skills>`.
- 정렬(결정적, 로케일 무관 코드포인트 비교): 경력·교육·프로젝트 = 시작월 내림차순(진행 중 우선, 시작월 없음 마지막) → created_at → id. 상세 = sort_order. 성과 = created_at. 스킬 = normalized_name.
- 별칭: 팩 순서대로 `EXP-n`, `EDU-n`, `PRJ-n`, `DET-n`, `ACH-n`, `SKL-n`(첫 등장 순), `PROFILE`. 별칭 맵 항목: `{ alias, sourceType, id, fields(V-3 원문), snapshotAt(updated_at), label, locator, parents(V-7) }`.
- 텍스트: `<career_data>` 안에 행별 태그 + C-3 필드명 그대로 `field: value`. `learnings`는 `<reflection>`. `display_name` 미포함. 사용자 텍스트의 `<`/`>`는 전각으로 바꿔 태그 탈출 차단(V-3 정규화가 되돌림). 경력 줄은 "job_rank / job_position" 한 줄.
- 서버 계산값: `computed_duration`(개월), 프로필 `computed_total_experience`(겹침 병합, 기준 월 표시 — AI-02 `computed_total_months`). 기준 월은 Asia/Seoul.
- `careerSnapshotHash`: 포함 행 **내용 필드**의 정규 JSON 해시(팩 텍스트 아님) — 기준 월이 바뀌어도 그대로. → spec-gaps.
- JD: `splitJdSentences(raw)` 줄 → 문장 끝(`.!?。` 뒤 공백) 분할, 불릿·번호 표시 제거, `raw.slice(start,end) === text`. `buildJdContext`: 요건 `REQ-n`(sort_order), 문장은 `none|cited|all`. 문장 근거의 `source_id` = `job_descriptions.id`, `source_locator` = `{sid,start,end}`. `requirementsHash`는 요건 내용 기준.

## 출력 스키마 ↔ 저장 매핑 (C-3)
- 모델 근거 형식 `ModelEvidenceSchema { source_type, ref, field?, quote? }`(기능 스키마가 재사용).
- `toEvidenceLinkRows({ owner{ownerType, ownerId, applicationProjectId}, items[{itemKey, evidence}], aliases, now })` → `evidence_links` Insert 행: `owner_type/owner_id/application_project_id/item_key/sort_order(항목 안 순서)/source_type/source_id(UUID)/source_field(필드 없는 원천은 null)/quote(원문 그대로의 구간)/quote_adjusted/source_snapshot_at(원본 updated_at, 없으면 now)/source_label/source_locator`. **`user_id`는 넣지 않는다**(DB 기본값 `private.current_uid()`). `writing_chat_message`는 예외 발생(DM-15).
- 결과 jsonb: `stripEvidence(value, keys)`로 `evidence`(+ `positioning_evidence` 등 기능별 키) 제거. 별칭 참조는 `resolveRefs(aliases, refs, type)` → UUID.
- 저장되는 인용문은 항상 DB 원문의 구간이다(모델이 공백·문장부호를 바꿔도 원문으로 교체).

## 검증 규칙 적용 범위 (V-1~V-8, C-5)
| 규칙 | 구현 | 처리 |
|------|------|------|
| V-1 | `checkEvidence` | 별칭 형식 + 이번 호출 맵에 존재 + 주장한 source_type 일치. 실패 → 근거 제거 |
| V-2 | 〃 | `EVIDENCE_RULES` 필드 허용값. 필드 없는 원천(JD·답변·메모)은 field 없어야 함 |
| V-3 | `matchQuote` | NFKC + 소문자 + 공백·문장부호 제거 후 부분 문자열. 아니면 최장 공통 연속 구간 ≥ 70%(`QUOTE_PARTIAL_MATCH_THRESHOLD`, 정규화 길이 6자 이상)면 원문 구간으로 교체·`quote_adjusted`. 인용 필수 필드에 인용 없음 → 제거. 선택 필드라도 인용이 틀리면 제거 |
| V-8 | 〃 | `learnings: "forbidden"`이면 제거. `"reflection_only"`면 유지하되 사실 근거로 세지 않음 |
| V-7 | 〃 + `buildSelectionScope` | 선택 경력·교육·프로젝트와 하위 상세·성과·태그 스킬 + 프로필·JD·메모·답변. `detailRefs`로 상세 축소 |
| V-4 | `validateItem` | 항목 종류별: `judgment` 제거, `match` → no_evidence 강등, `draft_block` → `evidence_check_needed`, `reference` 유지. 지원 근거 = 커리어 원천(JD만으로는 사용자 주장 근거 불가, 기능이 바꿀 수 있음) 중 learnings 제외 |
| C-9 표현 검사 | 〃 | 회고 허용 블록이 learnings만 근거일 때 단정형 성과 표현·숫자가 있으면 `evidence_check_needed` [가정] |
| V-5 | `numbers.ts`, `block.ts` | 허용 집합 = 팩 사실 텍스트(learnings 제외) + JD + (기능이 넣는) 답변 + 서버 계산 기간값. 감지 → (기능 파이프라인이 블록 1회 재생성) → `finalizeBlockNumbers`로 `[수치 확인 필요]` 치환 + `number_check_needed` |
| V-6 | `generateStructured`, `runStructuredStream` | 동기/비동기: 1회 재요청 후 `schema_invalid`. 스트리밍: 끝난 뒤 불일치면 `error(schema_invalid, retryable)` → 전체 재시도 |
| C-5 | `checkPlaceholders` | 6종 고정. 본문 순서로 `placeholders` 재구성(힌트 재사용), 개수/토큰 불일치 집계, 미등록 `[… 필요]` → `[내용 확인 필요]`. 자리 표시는 근거 없는 주장으로 보지 않으며 숫자가 없어 V-5와 충돌 없음(테스트) |
- 순서: 근거별 V-1 → V-2 → V-3 → V-8 → V-7, 항목별 V-4, 블록별 C-5·V-5 감지, 전체 끝에 V-5 치환.
- `validation_report`(개수만): items_total/dropped/downgraded/flagged, evidence_total/kept, 규칙별 제거 수(v1/v2/v3/v7/v8), quotes_adjusted, number_violations, numbers_replaced, placeholder_mismatches, unknown_placeholders. `mergeReports`로 합산.
- 기능별 규칙(AI-02 "action/result/achievement 없으면 partial", AI-12 V-9 등)은 각 기능 슬라이스에서 이 함수들 옆에 추가한다.

## 이벤트·진행 단계·오류 코드
- 스트리밍: `block_started{blockId,path}` → `block_delta{blockId,text}`(잠정) → `block_completed{blockId,block}`(블록 검증본; `validateBlock`이 null이면 이후 delta 숨김) → `validated{result,validationReport}`(저장 형태) → `done{meta{promptVersion,model,resultId}}`. 오류는 `error{code,message,retryable}` 하나로 끝. 블록 = `block_id` 문자열을 가진 객체(키 순서 무관).
- 진행 단계(`ai_jobs.progress.stage`)는 기능 슬라이스에서 C-6 값 그대로.
- SDK 오류 매핑: 사용자 취소 abort → canceled, 그 밖의 abort·연결 타임아웃 → timeout, 429 → rate_limited, 5xx·연결 오류 → model_unavailable(이전 세대 모델 1회 대체 후), 400 프롬프트 길이 → input_too_long, `stop_reason` refusal → refused, `max_tokens` → schema_invalid, `model_context_window_exceeded` → input_too_long. 그 밖(401 등)은 매핑하지 않음(실행기가 처리, spec-gaps 기존 항목).

## 테스트·픽스처
- 픽스처: `src/server/ai/__fixtures__/career-rows.ts`(가상 인물, draft 부모·자식 포함).
- 테스트 파일 12개, 134건: `context-pack/career-pack.test.ts`(포함 규칙, 순서 무관 결정성, 별칭·부모, reflection·V-5 원천, display_name·이스케이프, 기간 계산·해시), `context-pack/jd.test.ts`, `context-pack/career-rows.test.ts`(컬럼 명시·`*`·display_name 없음·complete 필터), `validation/quote.test.ts`(전각·띄어쓰기·대소문자·부분 일치·임계값), `validation/evidence.test.ts`(V-1/2/3/7/8 표 기반, V-4 종류별, C-9 표현 검사, 범위), `validation/numbers.test.ts`(`30%`, `3배`, `1,200명`, `2년 6개월`, `1.2만`, `300ms`, 별칭·EC2·K8s 무시, learnings 전용 숫자 거부, 계산 기간 허용), `validation/placeholders.test.ts`(자리 표시 보존·불일치·미등록 토큰, 블록 검증 + V-5 치환), `storage/evidence-links.test.ts`, `streaming/json-incremental.test.ts`(청크 크기 1~1000 동일 결과, 이스케이프, 잘못된 JSON), `streaming/structured-stream.test.ts`(정상·스키마 불일치·잘린 JSON·중간 모델 오류·취소), `structured.test.ts`(V-6 재요청·input_hash), `anthropic-client.test.ts`(가짜 SDK: 요청 형태, 오류 매핑, 장애 대체, 거절 대체 표시, 로그에 본문 없음).
- 결과(2026-10-26): `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS(35 파일, 429건 — 전체).

## 스펙 차이·가정 (상수)
- `QUOTE_PARTIAL_MATCH_THRESHOLD = 0.7`(C-3 [가정]), `QUOTE_MIN_PARTIAL_LENGTH = 6` [구현 결정].
- `SCHEMA_RETRY_LIMIT = 1`(C-3 V-6).
- `AI_UNAVAILABLE_FALLBACK`: sonnet-5-5 → sonnet-5, opus-5-5 → opus-5 [가정](C-6 "이전 세대 Sonnet").
- C-9 표현 검사 정규식 [가정], V-5 비교 규칙·"N년차" 허용 [가정], 미등록 자리 표시 처리 [가정], `career_snapshot_hash` 계산 대상 [가정], 서버 측 거절 대체 [가정] → `_workspace/backend/spec-gaps.md` 2026-10-26 항목.
- 하네스 `ai-pipeline-impl` 스킬의 "강제 tool로 구조화 출력" 지침은 현재 모델에서 400 → 스킬 문서 수정 필요(리더).
- 미구현(기능 슬라이스 몫): 기능별 프롬프트·스키마·파이프라인, V-5 블록 재생성 호출, 캐시 예열, AI-12 V-9, JD 문장 원본 삭제 시 evidence 처리(S5).

## QA 1차 대응 (03_backend-qa_report.md)
| 이슈 | 조치 |
|------|------|
| QA-S3-07 | 스위치 하나: `REFUSAL_FALLBACKS_ENABLED`(`models.ts`, 현재 `true`, decisions 2026-10-26). 켜져 있으면 `buildParams`가 `fallbacks: "default"` + beta 헤더를 보내고 최종 `refused`는 `retryable: false`(유료 재시도 없음). 끄면 대체 파라미터를 보내지 않고 `refused`는 다시 retryable. `retryableAiErrorCodes(enabled)`/`isRetryableAiErrorCode`가 이 값을 따른다. 토큰은 `usage.iterations`가 있으면 그 합계(`toUsage`), 대체 여부는 `fallback` 블록 또는 iterations의 `fallback_message`. 거절로 끝난 호출의 과금 토큰도 오류 로그에 남긴다 |
| QA-S3-02 (파이프라인 쪽) | `runStructuredStream`을 바꿔 오류는 catch에서 `error` 하나를 내고 바로 끝내고, `validated`·`done`은 try 밖에서 내보낸다 → 종료 이벤트는 항상 정확히 하나이고 마지막. `finalize` 예외(예: DB 쓰기 실패)도 `error(internal_error)`. `final` 뒤 클라이언트가 더 내보내도 무시. `AI_STREAM_TERMINAL_EVENT_TYPES` 공개. SSE 쪽 판정(`error`면 failed)은 api-engineer 몫 |
- **api-engineer 요청**: `src/lib/contracts/ai.ts`의 `RETRYABLE_CODES`에 아직 `refused`가 있다. 서버 실행기는 `AiError.retryable`을 써서 동작은 맞지만, QA가 대조하는 두 목록과 SSE `aiErrorEvent`의 `retryable`이 어긋난다. `isRetryableAiErrorCode`(`src/server/ai/errors.ts`)를 쓰거나 같은 규칙으로 맞춰 주세요.
- 결과(2026-10-26): `src/server/ai` 테스트 12파일 146건 통과, `pnpm lint` 통과, `pnpm test` 35파일 444건 통과. `pnpm typecheck`는 api-engineer 작업 중 파일(`src/test/job-fakes.ts`, `src/server/jobs/*`)에서만 실패하고 `src/server/ai`에는 오류가 없다.

## QA 2차 대응
| 이슈 | 조치 |
|------|------|
| QA-S3-06 | 프로필 근거의 `source_snapshot_at`을 `profiles.updated_at`으로 바꿨다(db가 app_ai_writer에 select grant 추가). 로더 `PROFILE_COLUMNS`에서 `career_data_updated_at`을 빼고 `updated_at`을 읽는다. `career_data_updated_at`은 AI 쪽 다른 용도가 없어 읽지 않는다 — `career_snapshot_hash`는 처음부터 행의 내용 필드로 계산하며 타임스탬프를 쓰지 않는다. 테스트: `storage/evidence-links.test.ts`(프로필 행 `source_snapshot_at` = profiles.updated_at), `context-pack/career-rows.test.ts`(프로필 컬럼 목록 고정) |
- 결과(2026-10-26): `pnpm typecheck`·`pnpm lint` 통과, `pnpm test` 35파일 460건 통과(`src/server/ai` 12파일 146건).
