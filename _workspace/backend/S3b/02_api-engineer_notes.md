# S3b API 구현 노트 (BYOK 키·동의)

> 상태: 완료. `pnpm typecheck`, `pnpm lint`, `pnpm test`(45 파일 682개, 로컬 스택 통합 포함), `pnpm build` 통과. 커밋하지 않음.
> ⚠️ 키 암호화 키(KEK)는 **출시 전 임시안**(env 마스터 키, 결정 B-2)이다. 출시 전에 클라우드 KMS 어댑터로 바꿔야 한다(아래 "배포 체크리스트").

## 엔드포인트 (Server Action ↔ 파일)
UI 화면(S-40, S-41)이 아직 없으므로 연결은 "연결 대기"다. 모두 `src/server/actions/ai-connection.ts`(인증 → zod → 서비스, 응답 `ActionResult<T>`).

| 액션 | 입력 | 결과 | 서비스 / RPC |
|------|------|------|--------------|
| `getAiConnection()` | — | `AiConnection` | 공급자 목록·키 메타(뷰)·활성 공급자·등급별 동의 상태·공급자별 진행 중 작업 수 |
| `getAiDisclosure` | `{ provider, connectionTier }` | `AiDisclosure` | 현재 고지(`effective_at <= now` 최신). 없으면 404 |
| `recordAiDataUseConsent` | `{ provider, connectionTier, disclosureVersion, freeTierAcknowledged }` | `AiConsentState` | `ai_data_use_consents` insert(트리거 가드). 무료는 별도 체크 필수(zod + CHECK) |
| `withdrawAiDataUseConsent` | `{ provider, connectionTier }` | `AiConsentState` | `withdrawn_at` update |
| `registerProviderKey` | `{ provider, connectionTier, apiKey, disclosureVersion }` | `KeyCheckOutcome` | 형식 검사 → 검증 작업 → 암호화 → `save_provider_key` |
| `recheckProviderKey` | `{ provider, connectionTier?, disclosureVersion? }` | `KeyCheckOutcome` | 다시 확인(`record_provider_key_check`) 또는 등급 변경(`save_provider_key`, spec-gaps) |
| `deleteProviderKey` | `{ provider }` | `AiConnection` | `delete_provider_key`(멱등) |
| `setActiveAiProvider` | `{ provider }` | `AiConnection` | 키 등급의 현재 동의 확인 → `set_active_ai_provider` |

오류 코드(409 등): `ai_consent_required`(동의 없음·고지 버전 바뀜), `ai_disclosure_changed`(동의 insert 중 고지 변경), `ai_provider_paused`(D-38 `is_available = false`), `key_verification_in_progress`, `key_not_found`(404), `invalid_input`. KEK 미설정은 `internal_error`(로그 `ai_key.kms_unavailable`, 값 없음).

## 계약 (`src/lib/contracts/`)
- 새 파일 `ai-connection.ts`: 입력 스키마 5종, `ProviderKeyMetaSchema`(뷰 컬럼 camelCase + `isActive`), `AiProviderInfo`, `AiDisclosure`, `AiConsentState`, `AiProviderConnection`, `AiConnection`, `KeyCheckOutcome`, `KEY_CHECK_RESULTS`, `KEY_FORMAT_MESSAGE`, `keyCheckMessage`, `ReadinessAiConnection`, `isAiLocked`.
- `KeyCheckOutcome` = `{ result: valid|limited|rejected, reason: format|verification|null, saved, key, becameActive, errorCode, failureCause, message, retryAfter, quotaResetsAt, jobId }`. **키를 담을 수 있는 필드가 없다**(통합 테스트가 키 목록을 고정 검사). 화면 표시는 `key.keyLast4`만.
- `enums.ts`: `KEY_STATUSES`(DB CHECK와 같음).
- `career.ts` readiness: `ai_connection: { active_provider, key_status, connection_tier }`(DM §6 v4) 필수 필드로 추가.

## 키 처리 (`src/server/keys/`)
| 파일 | 내용 |
|------|------|
| `kms.ts` | `KmsAdapter { kekId, wrap(dek, ctx), unwrap(wrapped, kekId, ctx) }`. `EnvKms`: KEK로 DEK를 AES-256-GCM으로 감쌈(`[형식 1B][nonce 12][암호 32][tag 16]`), AAD = 바인딩. `kek_id` 다르면 `kek_mismatch`. **"REPLACE WITH A CLOUD KMS BEFORE LAUNCH" 주석** |
| `envelope.ts` | 키마다 무작위 DEK 32B, nonce 12B, AES-256-GCM, AAD = `${userId}|${provider}|${keyId}`. `key_ciphertext` = 암호문‖tag. 평문 Buffer·DEK는 `finally`에서 0으로 채움. bytea hex 변환 |
| `format.ts` | 느슨한 형식 검사(openai `sk-`, anthropic `sk-ant-`, gemini `AIza`, 20~512자, 공백 없음), `keyVerificationTarget(provider)` = `ai_provider` / uuidv5(provider) |
| `key-source.ts` | 실행 시점 `KeySource`: app_key_reader RPC → unwrap → decrypt. 0행 → `ProviderError("key_missing")`, `key_not_available` → `AiError("stalled")`, 복호화 실패 → `KeyCryptoError`(코드만) |
| `app.ts` | 운영 연결: `getKms()`(env, 실패 시 일반 오류), `createAppKeySource(userId)`, `createKeyVerificationDeps` |
| `src/server/db/key-reader.ts` | app_key_reader 단명 JWT(60초, `sub = userId`). `getProviderKeySecret` 하나만 노출(클라이언트 비공개) |

- JS 문자열(사용자가 보낸 키, 복호화 결과)은 0으로 지울 수 없다. 한 번의 공급자 호출 동안만 쓰고 저장·로그·반환하지 않는다(코드 주석).
- AAD에 공급자가 필요한데 `get_provider_key_secret`은 공급자를 돌려주지 않는다. 실행기가 단계마다 `keySource.forJob(jobId, job.provider)`로 작업 공급자를 넘긴다(`KeySource.forJob`의 두 번째 인자, 선택). DB 변경 불필요.

## 서비스 (`src/server/services/ai-connection/`)
- `consent.ts`: 두 규칙을 분리했다.
  - 엄격(저장·등급 변경·활성화): 최신 활성 동의 = 현재 고지 버전(`save_provider_key`와 같은 규칙).
  - 실행 시점(작업 시작): 활성 동의가 있고, 동의한 버전 이후에 `requires_reconsent = true`인 고지가 시행되지 않았을 것(DM 2.11.5, db 노트 알고리즘).
- `keys.ts`: 조회·삭제·활성화 + 실행기용 `createDbProviderContextSource`(사용자 세션, 활성 공급자·키 상태·등급·실행 동의 — 재동의 필요 시 409 `ai_consent_required`), `createDbKeyStatusReporter`(app_ai_writer RPC).
- `verification.ts`: 등록·교체·다시 확인·등급 변경.
  1. 공급자 사용 가능(D-38) → 동의(엄격) → 형식 검사(실패 시 작업·호출 없음, 교체면 기존 키 그대로) → KMS 준비(없으면 공급자 호출 전에 실패).
  2. `key_verification` 작업 insert(대상 `ai_provider`/uuidv5). 같은 대상 진행 중이면 409 `key_verification_in_progress`. 그 작업의 heartbeat가 45초(`VERIFY_STALE_MS`)보다 오래면 `failed/stalled`로 닫고 새로 만든다(크론이 하루 1회여도 막히지 않게).
  3. claim(running, heartbeat) → 다시 확인은 이때 `KeySource`로 저장 키를 복호화.
  4. `verifyProviderKey`(재시도 없음, 상한 유료 15초·무료 20초) → 2단계 생성 호출 1행 사용 기록(`createUsageRecorder` 재사용, feature `key_verification`).
  5. R-38: `valid`/`limited` → 같은 행 id(교체) 또는 새 id로 암호화 → `save_provider_key`(`limited`면 `p_failure_cause`). `rejected` → 저장 안 함.
  6. 작업 종료: 저장했으면 `complete_ai_job`, 아니면 `failed` + 원인(spec-gaps 2026-10-29).
- 다시 확인 결과는 `record_provider_key_check(valid | failed + 원인)`. 원인이 키 원인 6값이 아니면(검증 예외) `provider_unavailable`로 기록 → `needs_check`.

## 작업 흐름 변경 (`src/server/jobs/`)
- `app-runner.ts` `connections()`: 운영은 DB 경로(위 세 구현). `AI_DEV_PROVIDER` + `AI_DEV_API_KEY`가 둘 다 있고 production이 아니면 S3a 개발 env 구현을 쓴다. `.env.example`에서 두 값은 주석 처리했다.
  - `startJob`의 공급자 문맥은 요청 쿠키 세션으로 읽고, 세션 사용자 ≠ `userId`면 `unauthenticated`.
- `KeyStatusReporter`에 `recordFailure(jobId, cause)`, `recordSuccess(jobId)` 추가.
  - `key_invalid` → `markInvalid`(기존, 취소와 무관하게 즉시).
  - 그 밖의 키 원인으로 **최종 실패** → `recordFailure` → `mark_provider_key_invalid(job, cause)`(`last_failure_*`만).
  - 작업 성공 → `recordSuccess` → `record_provider_key_success`(db 제안 채택, `needs_check`일 때만 `valid`). 보고 실패는 로그만, 작업 결과는 바뀌지 않음.
- `logJobEvent`를 `jobs/log.ts`로 옮겼다(`app-runner`에서 재수출).
- **QA-S3a-11**: `INVOCATION_BUDGET_MS = 58_000`을 "단계 마감 + 끝의 settle까지 모두 끝나야 하는 시점"으로 바꿨다. `USAGE_SETTLE_WORST_MS = USAGE_SETTLE_GRACE_MS(3초) + LLM_SETTLE_GRACE_MS(2초) = 5초`. 새 단계 시작 조건: `경과 + 단계 마감 + 5초 ≤ 58초`. 넘으면 다음 실행으로 넘기고, 실행의 첫 단계는 남은 시간으로 마감을 줄인다(최소 `MIN_STEP_TIMEOUT_MS` 5초). `RunnerTiming`에 `settleWorstMs`, `minStepTimeoutMs`.

## env·오류
- `env.ts`: `AI_KEY_KEK_BASE64`(base64, 정확히 32바이트), `AI_KEY_KEK_ID`(`[A-Za-z0-9._:-]{1,64}`), 둘 다 선택(페이지가 의존하지 않게). 키 등록·AI 실행 때 없으면 닫힌 실패.
- `.env.example`: 더미 KEK + 출시 전 KMS 전환 경고.
- `db/errors.ts`: S3b raise 이름 전부. `consent_required` → `ai_consent_required`(서비스 약관 게이트 코드 `consent_required`와 충돌 방지), 고지 변경 2종 → `ai_disclosure_changed`, `key_id_mismatch` → `conflict`, 서버가 만드는 인자 오류·`key_not_available`·`invalid_ai_job_state` → `internal_error`.
- `ai-writer.ts`: `signRoleToken(role, …)`으로 일반화(app_ai_writer·app_key_reader 공용). 기존 함수 이름·동작 유지.

## 테스트
- `src/server/keys/envelope.test.ts`(13): 왕복, 매번 다른 DEK·nonce, AAD(사용자·공급자·행 id) 불일치, 암호문 행 바꿔치기, 암호문·tag·nonce·wrapped DEK 변조, 다른 KEK id·버전·같은 id의 다른 KEK, DEK·평문 Buffer 0 채움, KEK 설정 검사(값 비노출), 형식 검사, uuidv5 RFC 벡터.
- `src/server/services/ai-connection/ai-connection.test.ts`(11): 동의 규칙(엄격·실행 시점), 계약, enum 대조, DB 오류 매핑, 실행 시점 키 소스(공급자 바인딩·다른 사용자 암호문·0행·거부), RPC 결과 매핑.
- `src/server/jobs/runner.test.ts` +8: 성공 시 `recordSuccess`, 최종 실패 원인별 `recordFailure`, `key_invalid`는 무효만, 보고 실패 무시, QA-S3a-11(15초 경과 시 넘김·13초는 실행·첫 단계 마감 단축).
- `src/server/services/ai-connection/ai-connection.integration.test.ts`(17, 로컬 스택): 동의 없음 거부(작업·호출 0) / 형식 오류 / R-38 저장 안 함 4종(작업 failed + 원인, 2단계만 사용 기록) / 등록 valid(첫 키 활성, 마지막 4자리, 사용 기록 `key_verification`, **user·app_ai_writer·service_role 모두 암호 컬럼 select 불가**) / 교체 실패 시 기존 키 그대로 / **AI 작업이 `get_provider_key_secret` → 복호화한 키로 호출 → 단계 1에서 키 삭제 → 단계 2 `key_missing`, 사용 기록 1행, 활성 해제·동의 철회, 끝난 작업·다른 사용자 거부, 이후 시작은 `ai_not_connected`** / limited → `needs_check` + 초기화 시각, `record_provider_key_success`로 valid / 다시 확인 3분기 / 등급 변경(새 동의 필요, 같은 id, 이전 등급 동의 철회, 재암호화 후 복호화 확인) / 활성화·실행 동의 / readiness `ai_connection` / 진행 중 검증 409·죽은 검증 교체 / **누출 검사**(응답·작업 행·사용 기록·콘솔 로그 전체에서 가짜 키의 마지막 4자리 외 부분 없음).
- 가짜 키만 쓰고 공급자 호출은 없다(가짜 어댑터 + 실제 `verifyProviderKey`/`createLlm`).
- `env.test.ts` +1, `career.test.ts` readiness 샘플 갱신.
- 실행: `pnpm test`(로컬 스택이 없으면 통합 테스트는 skip), 키만: `pnpm vitest run src/server/keys src/server/services/ai-connection`.

## 스펙 차이·가정 (spec-gaps.md 2026-10-29 S3b api 항목)
- 등급 변경 = 저장 키 재검증 + 같은 id로 재암호화 저장(새 RPC 없음).
- 키 검증 사용 기록은 2단계 생성 호출만, 작업 종료 상태 규칙, 검증 상한 15·20초.
- 최종 실패 원인이 키 원인 6값일 때만 키 상태 보고.
- 그 밖의 구현 결정(spec-gaps 미기록): 진행 중 검증의 오래됨 기준 45초, 형식 오류는 `errorCode = key_invalid` + `reason = format`, 활성화 시 키 등급 동의 확인.

## 다른 담당자에게
- db: 요청 없음(`record_provider_key_success` 제안 채택). `get_provider_key_secret`에 `provider`를 돌려주면 실행기의 공급자 바인딩이 필요 없어지지만, 지금 방식도 같은 작업 공급자라 안전하다(선택).
- ai: 요청 없음. `verifyProviderKey`·`createLlm` 그대로 사용.
- UI(연결 단계): `getAiConnection().providers[].inFlightJobs`로 삭제 대화상자 "진행 중 N건", `KeyCheckOutcome.reason === "format"`이면 형식 문구, `result === "limited"`면 "확인 보류" + `quotaResetsAt`(KST 표시), readiness `ai_connection`으로 잠금(`isAiLocked`).

## 남은 일
- **배포 체크리스트**: (1) KMS 공급사 결정 후 `KmsAdapter` 구현으로 `EnvKms` 교체, 실행 계정에만 decrypt 권한, 감사 로그에 `userId`·`aiJobId` 문맥. (2) 기존 행의 DEK를 새 KEK로 다시 감싸기(`kek_id` 버전). (3) Vercel 암호화 env에 KEK 설정 전에는 키 등록이 `internal_error`로 막힌다.
- 수동 재시도(`retryJob`) 때 키 삭제·무효를 미리 확인하지 않는 문제(S3a 남은 일)는 그대로 — 실행 단계에서 `key_missing`/`key_invalid`로 끝난다.
- `mark_provider_key_invalid`가 교체 직후 옛 키의 401로 새 키를 무효로 만들 수 있는 경합(db 노트) — 그대로 둠.

## QA 1차 반영 (2026-10-29, `03_backend-qa_report.md`)
| 이슈 | 반영 |
|------|------|
| QA-S3b-01 [Major] | `ProviderContextSource.assertJobRunnable(userId, { provider, connectionTier })` 추가. `retryJob`이 requeue 전에 **작업에 고정된 공급자**로 부른다. 키 없음 → 409 `key_missing`, 무효 → 409 `key_invalid`, 키의 현재 등급 동의가 실행 규칙 미충족 → 409 `ai_consent_required`. 활성 공급자가 바뀌어도 작업 공급자로 다시 돈다(F-AI-03 (2)). 실행 시점: `RunnerDeps.checkRunAllowed`(단계 시작마다, 오류면 `stalled`로 닫힌 실패, 공급자 호출 0) — **운영 연결은 db RPC 필요(아래)**. 보완: `withdrawAiDataUseConsent`가 그 공급자·등급의 queued/running 작업에 `request_ai_job_cancel`. 테스트: 단위 7(동의 철회·키 삭제·키 무효 거부, 공급자 변경 후 재시도, 게이트 차단·오류), 통합 1(철회 → 취소 요청·재시도 거부, 키 삭제 → `key_missing`) |
| QA-S3b-02 | 검증 `timeout` → `provider_unavailable`. 1단계는 저장 안 함, 2단계(인증 통과)는 `limited`(`needs_check`). spec-gaps 문구 갱신. 통합 테스트 2단계 각각 |
| QA-S3b-03 | `envelope.ts` 복호화, `kms.ts` unwrap의 `update()`·`final()` 결과 버퍼도 0으로 채움 |
| QA-S3b-04 | `.env.example`의 `AI_KEY_KEK_BASE64`는 비움(빈 값 = 미설정 → 키 처리 닫힌 실패). `env.ts`가 이전에 공개된 예시 값과 저엔트로피 값(서로 다른 바이트 16개 미만)을 거부(값은 오류 문구에 안 나옴). 테스트 추가 |
| QA-S3b-05 | `retryJob`이 `key_verification`이면 409 `ai_job_not_retryable`. 테스트 추가 |

- db 요청(리더 경유, SendMessage가 닿지 않음): app_ai_writer용 `check_ai_run_allowed(p_ai_job_id) returns text`(null / `key_missing` / `key_invalid` / `consent_required`, 실행 규칙 = `requires_reconsent` 기준). 생기면 `app-runner.ts`에서 `checkRunAllowed`로 연결한다. 동의 철회 시 `error_code`를 무엇으로 둘지는 spec-gaps(2026-10-29 QA-S3b-01)에 기획 확인으로 남겼다.
- 검사: typecheck, lint, test(45 파일 692개, 통합 포함), build 통과.

## QA-S3b-01 실행 시점 게이트 연결 (2026-10-29, decisions.md 결정)
- `keys.ts` `createDbRunGate(db)` → RPC `check_ai_run_allowed`. 생성 타입은 `string`이지만 null(허용)을 처리한다. `mapRunGate`: null → 허용, `consent_required`·`key_missing` → `key_missing`, `key_invalid` → `key_invalid`, 그 밖 → 오류(실행기가 `stalled`로 닫힌 실패).
- `app-runner.ts`: 운영 경로의 `checkRunAllowed` = 작업 사용자의 app_ai_writer로 단계 시작마다 호출. 개발 env 모드에서는 쓰지 않는다(키 행 없음).
- 차단되면 공급자 호출·사용 기록 0, 키 상태 보고 호출 없음.
- 테스트: 단위 `mapRunGate`, 통합 "큐에 있는 동안 동의 철회(취소 경로 없이) → `key_missing`/user_account/failure_cause null, 호출 0, 사용 기록 0".
- `requires_reconsent` 고지 행을 넣는 통합 테스트는 하지 않았다. `ai_disclosures`는 전역 테이블이라 병렬 테스트에 영향을 주기 때문이다. 같은 판정 함수를 쓰므로 db pgTAP에 맡긴다.

## QA 2차 반영 (2026-10-29)
- **간헐 실패 원인 확인**: `runner.integration.test.ts`가 전역 RPC `sweep_stalled_ai_jobs`를 미래 cutoff(지금 + 1시간)로 불렀다. 병렬로 도는 다른 파일의 갓 만든 작업(여기서는 queued `key_verification`)까지 `failed/stalled`로 만들어, `verification.ts`의 claim이 null → `internal_error`가 됐다. 운영 로직 문제는 아니다.
  - 수정(테스트만): 그 테스트 자신의 대기 작업 heartbeat를 하루 전으로 돌리고, sweep cutoff는 12시간 전으로 둔다. 다른 테스트의 새 작업은 걸릴 수 없다. `claim_due_ai_jobs`는 조회 전용이라 영향이 없다. 테스트 코드에서 다른 전역 쓰기 RPC 호출은 없다.
  - 전체 `pnpm test`를 연속 5회 실행해 모두 697/697 통과했다.
- **QA-S3b-07**: 동의 철회 뒤 진행 중 작업 취소를 `cancelInFlightJobs`로 분리했다. 이 함수는 throw하지 않는다. 조회 실패·취소 실패(오류 응답·예외)는 로그(`ai_consent.cancel_lookup_failed` / `ai_consent.cancel_failed`, 작업 id와 DB 코드만)만 남기고 나머지 작업을 계속 처리한다. 철회 자체는 성공으로 돌려준다(이미 커밋됨, 데이터 전송은 실행 게이트가 막음). 단위 테스트 3개.
- 검사: typecheck, lint, test(45 파일 697개 × 5회), build 통과.
