# S3b 백엔드 QA 리포트 (라운드 2 · 최종)

> 라운드 1 내용은 아래에 그대로 두었다. 라운드 2 재확인 결과는 이 절에 적었다.

## 판정 (라운드 2)
**S3b `done` 가능.**
- Major 1건(01)과 Minor 4건(02~05)의 수정을 확인했다.
- 06은 설계 차이로 spec-gaps에 넘겼다(코드 변경 없음).
- 회귀를 찾다가 새 Minor 1건(QA-S3b-07)을 발견했다. 데이터가 나갈 위험은 없으며, 리더에게 넘긴다.
- 사용자 결정 1건(동의 때문에 막힌 작업은 `key_missing`으로 끝냄)은 `decisions.md` 2026-10-29에 반영된 것을 확인했다.

## 라운드 2 검사 실행 결과 (최종)
`run-checks.sh --build`, 로컬 스택 실행 중

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 45파일 694개, skip 0. 통합 테스트 포함 |
| build | 통과 | |
| pgTAP | 통과 | Files=21, Tests=821(`check_ai_run_allowed.test.sql` 추가) |
| 타입 재생성 대조 | 통과 | `supabase gen types --local` 결과와 diff 0(`check_ai_run_allowed` 포함) |
| 라이브 권한 | 통과 | `check_ai_run_allowed` 실행 권한은 app_ai_writer만 있다(anon, authenticated, service_role, app_key_reader 모두 false). app_key_reader의 실행 함수는 여전히 `get_provider_key_secret` 하나다 |

## 라운드 2 이슈 상태
| ID | 심각도 | 담당 | 상태 | 확인 근거 |
|----|--------|------|------|-----------|
| QA-S3b-01 | Major | api, db | 수정됨(확인 완료) | 확인 내용은 아래 |
| QA-S3b-02 | Minor | api | 수정됨(확인 완료) | `verification.ts:94-95`. `timeout`은 `provider_unavailable`로 바뀐다. 2단계(인증 통과)에서 시간이 초과되면 limited로 저장하고, 1단계면 저장하지 않는다. 통합 테스트가 두 단계를 각각 다룬다. spec-gaps 문구도 갱신됐다 |
| QA-S3b-03 | Minor | api | 수정됨(확인 완료) | `envelope.ts:70-81`에서 `update()`·`final()`이 돌려준 버퍼를 `finally`에서 0으로 채운다. `kms.ts`의 unwrap도 같다 |
| QA-S3b-04 | Minor | api | 수정됨(확인 완료) | `.env.example`의 KEK 값이 빈 값이다. 빈 값은 미설정으로 처리돼(`env.ts:90`) 키 처리가 닫힌 실패로 끝난다. `isUsableKek`(`env.ts:34-38`)가 이전 예시 값과 서로 다른 바이트가 16개 미만인 값을 거부한다. 오류 문구에 값은 나오지 않는다. 테스트가 있다 |
| QA-S3b-05 | Minor | api | 수정됨(확인 완료) | `runner.ts:237`. `key_verification`이면 409 `ai_job_not_retryable`. 테스트는 `runner.test.ts:958` |
| QA-S3b-06 | Minor(설계) | db, 기획 | spec-gaps로 넘김 | 코드 변경 없음. 기획 판단을 기다린다 |
| QA-S3b-07 | Minor | api | **미해결(리더에게 넘김)** | 신규 회귀. 아래 참고 |

### QA-S3b-01 확인 내용
- **재시도 게이트**: `retryJob`이 requeue 전에 `assertJobRunnable(userId, { provider: job.provider, … })`를 부른다(`runner.ts:240`).
  - 기준은 작업에 고정된 공급자다. 키가 없거나 무효면 409로 막고, 키의 **현재 등급** 동의가 실행 규칙(`mayRunWithConsent`)을 통과하지 못하면 409 `ai_consent_required`를 돌려준다(`services/ai-connection/keys.ts:194-203`).
  - 쿠키 세션의 사용자와 `userId`가 다르면 거부한다(`app-runner.ts`). 단위 테스트 7개가 있다.
- **단계마다 실행 게이트**: DB 함수 `check_ai_run_allowed`(`supabase/migrations/20261029000700_s3b_check_ai_run_allowed.sql`)를 쓴다.
  - definer이고 `search_path=''`이며, sub가 작업의 사용자인지 확인한다. 암호 컬럼은 읽지 않는다.
  - 동의 규칙은 TS `mayRunWithConsent`와 같다: 최신 활성 동의, 유효한 버전, 그 뒤에 `requires_reconsent` 고지가 없을 것.
  - 실행기는 free-tier 간격 확인 다음, 단계 시작 직전에 이 게이트를 부른다(`runner.ts:424-437`). 차단되면 `finish("failed", code)`로 끝나므로 공급자 호출, 사용 기록, 키 상태 보고가 모두 없다. RPC 오류나 알 수 없는 응답은 `stalled`로 닫힌 실패한다.
  - 재시도가 대기 후 같은 반복으로 돌아오므로 게이트를 다시 지난다.
- **회귀 확인**
  - (a) 게이트를 건너뛰는 경로는 출력이 이미 있는 단계(호출 없음)와 개발 env 모드뿐이다. 개발 env 모드는 `nodeEnv !== "production"`일 때만 켜지고(`app-runner.ts:41-43`), 개발용 구현도 `assertNotProduction`을 부르므로 운영 환경에는 닿지 않는다.
  - (b) 등급 판단: 실행 중 작업의 `connection_tier`가 아니라 키의 현재 등급 동의로 판단하는 것은 의도된 동작이다. 등급을 바꾸면 `save_provider_key`가 이전 등급 동의를 철회하므로 틈이 없다.
  - (c) 철회 직후 경합: 철회는 같은 등급의 queued·running 작업에 취소를 요청한다. 등급이 다른 작업이나 취소 요청보다 먼저 claim된 작업도 다음 단계의 게이트에서 막힌다. 통합 테스트가 "큐에 있는 동안 철회(취소 경로 없이) → `key_missing`, 호출 0, 사용 기록 0"을 확인한다.
  - 남는 틈은 이미 시작된 단계 하나뿐이다. 그 단계의 호출은 끝까지 간다. 이는 DM 2.11.2의 "단계 단위"와 같은 수준이라 수용한다.

### QA-S3b-07 [Minor] 동의 철회 액션: 작업 취소 요청이 일부 실패하면 철회는 이미 반영됐는데 오류를 돌려줌
- 담당: api-engineer
- 근거
  - `src/server/services/ai-connection/consent.ts:182-202`: 먼저 `withdrawn_at` update가 커밋된 뒤, 작업마다 `request_ai_job_cancel`을 부른다.
  - `invalid_ai_job_transition`이 아닌 오류(일시적인 DB 오류 등)가 나면 throw한다. 화면은 "철회 실패"를 보이지만 실제로는 철회가 반영됐고, 남은 작업은 취소 요청을 받지 못한다.
  - 데이터 전송은 단계 게이트가 막으므로 개인정보 영향은 없다(UX·일관성 문제).
- 수정 제안: 취소 요청 실패는 로그(`jobId`만)를 남기고 계속 진행한다. 응답은 철회 성공으로 돌려준다. 게이트가 최종 보호선이다.
- 상태: 미해결(라운드 한도 2회, 리더에게 넘김)

## 스펙 차이 (라운드 2)
- QA-S3b-01: 동의 때문에 막힌 작업의 `error_code = key_missing`은 decisions 2026-10-29와 spec-gaps에 기록돼 있다(기획 확인 필요: C-11.1에 맞는 코드가 없음).
- QA-S3b-06: spec-gaps에 기록됐다.

---

# 라운드 1

## 판정
**조건부 통과. Critical 0건, Major 1건(QA-S3b-01), Minor 5건.**
- 키 격리·마스킹(Q10)은 통과했다. 암호 컬럼 grant는 모든 앱·API 역할에서 0이고, `app_key_reader`는 `get_provider_key_secret` 하나만 실행할 수 있다. 응답·로그·작업 행·사용 기록에서 키 누출을 찾지 못했다. 마지막 4자리만 밖으로 나간다.
- Major 1건: 수동 재시도(`retryJob`)가 실행 시점 동의 게이트를 건너뛴다. `done` 전에 고쳐야 한다.
- QA-S3a-11(시간 예산)은 수정을 확인했다.

## 검사 실행 결과
`run-checks.sh --build`, 로컬 스택 실행 중

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 45파일 682개, skip 0. 로컬 스택 통합 테스트 포함 |
| build | 통과 | |
| pgTAP | 통과 | Files=20, Tests=801 |
| 타입 재생성 대조 | 통과 | `supabase gen types --local` 결과와 `database.types.ts`가 같다(diff 0) |
| 라이브 권한 조회 | 통과 | 아래 Q10 참고 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM 2.11 / §5 / §6 ↔ 마이그레이션 | 통과 | 컬럼·CHECK·unique·복합 FK set null(컬럼 지정)·RLS가 표와 같다. 추가된 인자·RPC는 spec-gaps에 기록되어 있다 |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과 | 서비스는 뷰 `ai_provider_keys_public`의 메타 컬럼만 select한다 |
| Q3 | RPC 시그니처 ↔ 호출자 | 통과 | `save_provider_key`(12개 인자, bytea는 `\x` hex), `record_provider_key_check`, `mark_provider_key_invalid`, `record_provider_key_success`, `get_provider_key_secret`(`key_id` 포함 반환) ↔ `verification.ts`, `keys.ts`, `key-reader.ts`, `key-source.ts` |
| Q4 | raise 코드 ↔ 오류 매핑 | 통과 | S3b의 raise 코드 15개가 모두 `db/errors.ts`에 있다. 서버가 만드는 인자 오류는 `internal_error`로 매핑된다 |
| Q5 | 계약 ↔ 액션 | 통과 | `KeyCheckOutcome`에 키를 담을 필드가 없다(통합 테스트가 필드 목록을 고정). `invalid()`는 zod 상세를 응답에 넣지 않고, `runAction`은 알 수 없는 오류를 일반 오류로 바꾼다 |
| Q6 | SSE | 해당 없음 | |
| Q7 | AI 출력 ↔ 저장 | 해당 없음 | |
| Q8 | enum DB ↔ TS | 통과 | `KEY_STATUSES`, `AI_PROVIDERS`, `CONNECTION_TIERS`, `FAILURE_CAUSES`(7), `KEY_FAILURE_CAUSES`(6) = `private.is_key_failure_cause` |
| Q9 | 작업 종료 경로·사용 기록 | 이슈 | QA-S3b-01, -02, -05 |
| Q10 | 보안·개인정보 | 통과(Minor 2) | QA-S3b-03, -04 |
| Q11 | UI ↔ 백엔드 | 해당 없음 | 연결 대기(S-40/41 미구현). UI build는 통과 |

### Q10 상세 (NFR-KEY)
- **암호 컬럼 grant**: 라이브 `information_schema.column_privileges`에서 4개 컬럼의 grantee는 `postgres`(소유자)뿐이다.
  - `has_column_privilege`로 확인한 값은 모두 false다: service_role·authenticated·anon 대상 `key_ciphertext`/`wrapped_dek`/`kek_id`, app_ai_writer 대상 테이블·`key_last4`.
- **app_key_reader**: nologin, noinherit, bypassrls 없음. 실행 가능한 public/private 함수는 `get_provider_key_secret` 하나뿐이고, 테이블 select 권한은 0이다.
  - postgres의 전역 기본 권한이 함수의 PUBLIC 실행을 회수하므로, 앞으로 만드는 함수도 자동으로 열리지 않는다.
  - 클라이언트 모듈은 `getProviderKeySecret`만 노출한다(`key-reader.ts:83-88`).
- **`get_provider_key_secret` 거부 매트릭스**(pgTAP): 다른 사용자, 없는 작업, null, queued·succeeded·failed·canceled, heartbeat 121초·null, sub 없음, 다른 역할 4개를 거부한다. 키 없음은 0행이고, 앱은 이를 `key_missing`으로 처리한다.
  - JWT sub 바인딩: `j.user_id = auth.uid()`(`…000500_s3b_provider_key_rpcs.sql:433`)이고, 토큰의 `sub`는 작업의 userId다(`app-runner.ts` `forUser(userId)` → `createAppKeySource(userId)`).
- **AAD**: `userId|provider|keyId`이고 DEK wrap에도 같은 바인딩을 쓴다(`kms.ts:52`). 변조·행 바꿔치기·다른 KEK id 테스트 13개가 있다(`envelope.test.ts`).
  - 실행기는 작업에 고정된 공급자를 넘긴다(`runner.ts:377`). 교체할 때 id를 유지하므로 AAD도 그대로 맞는다.
- **누출**: 로그는 구조화된 필드만 남긴다(`jobs/log.ts`, `ai/log.ts`). `KeyCryptoError`와 `KeyReaderError`는 코드만 담는다.
  - 통합 테스트의 누출 검사는 응답, 작업 행 전체(`step_outputs` 포함), 사용 기록, 콘솔 4종을 대상으로 한다. 스냅샷 파일은 없다.
- **KEK 미설정**: `getKms()`가 닫힌 실패로 동작한다(`internal_error`, 로그에 값 없음, `keys/app.ts:26-36`). 등록은 공급자 호출 전에 막힌다(`verification.ts:299`). 실행 중이면 KEK 미설정이 비공급자 예외가 되어 `stalled`로 끝난다(S3a 결정과 일치).
- **EnvKms**: 클래스, `app.ts`, `.env.example`, 노트에 "REPLACE WITH A CLOUD KMS BEFORE LAUNCH" 경고가 있다.
- **`pg_read_all_data` 판단**
  - 라이브 구성원은 `supabase_read_only_user`, `supabase_etl_admin`, `postgres`(소유자)다. 이 역할들은 컬럼 grant로 막을 수 없다.
  - 그래도 KEK가 DB 밖(현재 Vercel env, 이후 KMS)에 있으므로 DB 권한만으로 얻는 것은 암호문뿐이다. NFR-KEY-02는 충족한다.
  - NFR-KEY-07(운영자 분리)은 env KEK로는 약하다. 결정 B-2의 출시 전 KMS 전환이 이 전제의 조건이다.
  - DM §5 문구("운영자 SQL 역할에도 암호 컬럼은 의미가 없다 — KMS 권한이 서버에만")와도 맞는다.
  - **판정: 이번 슬라이스의 코드 결함은 아니다(이슈 없음). 출시 차단 항목(KMS 전환)으로 관리한다.** DM 2.11.1의 "운영자 SQL 역할 모두 select 권한 없음" 문구만 기획에서 고친다.

### 그 밖에 확인한 것
- **R-38**: valid → 저장/valid, limited(2단계 429·일일 한도·장애) → needs_check와 원인, 키 무효·결제 필요·모델 불가 → 저장하지 않음.
  - 교체에 실패하면 기존 키를 유지한다. 형식 오류면 작업도 호출도 없다.
  - 검증은 재시도하지 않는다. 2단계 호출만 사용 기록 1행을 남긴다. `key_verification` 대상은 `ai_provider`/uuidv5이고 진행 중 409를 돌려준다. 통합 테스트가 있다.
- **다시 확인**: `KeySource` 경로(running 작업)로 복호화한 뒤 `record_provider_key_check`를 부른다.
- **삭제**: hard delete → FK가 활성 공급자를 null로 → 모든 등급의 동의를 철회한다. 실행 중이던 작업은 다음 단계에서 `key_missing`이 된다(통합 테스트).
- **활성 변경**: 동의를 확인한다. **등급 변경**: 같은 id로 다시 암호화하고 이전 등급 동의를 철회한다.
- **동의**: insert 트리거가 현재 버전을 강제하고 서버 시각을 쓴다. 무료 등급은 CHECK로 별도 동의를 강제한다. 철회는 되돌릴 수 없다.
  - 실행 시점 규칙(`requires_reconsent`)은 `startJob`에서 409 `ai_consent_required`로 처리한다.
- **실행기 연결**
  - 운영 환경의 `connections()`는 DB 경로를 쓴다. 개발용 env 경로는 production이 아닐 때, 두 값이 모두 있을 때만 쓴다.
  - `markInvalid`는 `key_invalid`일 때 즉시 부른다.
  - `recordFailure`는 그 밖의 키 원인 5개로 최종 실패할 때만 부른다(`runner.ts:462-466`).
  - `recordSuccess`는 작업 완료 후 부른다(`runner.ts:514`). 보고에 실패하면 로그만 남긴다.
- **readiness**: `ai_connection` 3키가 DM §6 v4와 같다. 활성 공급자가 없거나 키가 invalid면 `form`이다. `ReadinessAiConnection` 계약도 일치한다.
- **QA-S3a-11**: `room = 58s − 5s(settle 최악) − 경과`. 넘으면 다음 실행으로 넘기고, 첫 단계는 마감을 줄인다(최소 5초). 테스트 3개 → **수정됨(확인 완료)**.

## 이슈

### QA-S3b-01 [Major] 수동 재시도가 실행 시점 동의·키 상태 게이트를 건너뜀
- 담당: api-engineer
- 근거
  - 첫 실행은 `startJob`에서 `providerContext.forUser`를 거쳐 재동의(`mayRunWithConsent`)와 `invalid` 키를 검사한다(`src/server/jobs/runner.ts:155-159`, `src/server/services/ai-connection/keys.ts:191`).
  - `retryJob`(`runner.ts:229-263`)은 이 검사 없이 바로 `requeueFailed` → `scheduleRun`으로 간다.
- 결과
  - 사용자가 동의를 철회했거나 `requires_reconsent` 고지가 시행된 뒤에도, 실패한 작업의 "재시도"로 커리어 데이터가 공급자에게 전송된다(F-AI-04 (5), DM 2.11.5, NFR-PRV-03).
  - invalid 키로도 다시 호출한다.
- 수정 제안
  - `retryJob`에서 requeue 전에 `deps.providerContext.forUser(ref.userId)`를 부른다(`ai_consent_required` / `ai_not_connected` / `key_invalid`).
  - 동의 판정은 **작업에 고정된** `job.provider`·`job.connectionTier` 기준으로 한다. 활성 공급자가 바뀌었으면 그 작업 공급자의 동의를 따로 검사한다.
  - 회귀 테스트: 동의 철회 후 재시도 → 409, 호출 0.
- 상태: 열림

### QA-S3b-02 [Minor] 검증 시간 초과의 처리가 spec-gaps 기록과 다르고 테스트가 없음
- 담당: api-engineer
- 근거
  - `runVerify`(`src/server/services/ai-connection/verification.ts:224`)의 `AbortSignal.timeout`이 걸리면, 어댑터가 `abortError` → `timeout`을 돌려준다(`src/server/ai/errors.ts:177-179`, `providers/anthropic.ts:88,106`).
  - 그 결과 `errorCode = 'timeout'`, `failureCause = null`, 작업은 `failed/timeout`이 된다.
  - 반면 spec-gaps 2026-10-29(api) 기록은 "15·20초에서 끊고 `provider_unavailable`로 안내"다.
  - 2단계 시간 초과(인증은 통과)도 limited가 아니라 "저장 안 함"으로 처리된다.
  - `ai-connection.*.test.ts`에 timeout 케이스가 없다.
- 수정 제안
  - 검증의 `timeout`을 `provider_unavailable`로 정규화한다. 1단계는 저장하지 않고, 2단계는 R-38의 "장애(6)"와 같게 limited로 저장할지 정해 spec-gaps와 맞춘다.
  - 1단계·2단계 timeout 테스트를 추가한다.
- 상태: 열림

### QA-S3b-03 [Minor] 복호화 중간 버퍼를 0으로 채우지 않음
- 담당: api-engineer
- 근거
  - `decipher.update(body)`가 반환한 버퍼(평문 키·DEK 조각)는 `Buffer.concat`로 복사된 뒤 0으로 채워지지 않는다.
  - 해당 위치: `src/server/keys/envelope.ts:71`(키 평문), `src/server/keys/kms.ts:102`(DEK).
  - 0으로 채우는 것은 concat 결과뿐이다(`envelope.ts:77`).
- 수정 제안: `update()`·`final()` 결과를 변수에 받아 concat한 뒤 둘 다 `fill(0)`한다.
- 상태: 열림

### QA-S3b-04 [Minor] `.env.example`의 더미 KEK가 실제로 쓸 수 있는 32바이트 값임
- 담당: api-engineer
- 근거
  - `.env.example`의 `AI_KEY_KEK_BASE64=ZHVtbXkt…MDA=`는 env 검증(`src/server/env.ts`, base64 32바이트)을 통과한다.
  - 이 파일을 그대로 production env에 복사하면 공개된 KEK로 동작한다. 그러면 DB 사본만으로 키를 복원할 수 있다(NFR-KEY-02 위반).
- 수정 제안
  - production에서 예시 값(또는 알려진 더미 값)이면 `kms_not_configured`로 거부한다.
  - 또는 예시 값을 일부러 형식에 맞지 않게 둔다.
  - 배포 체크리스트에 항목을 추가한다.
- 상태: 열림

### QA-S3b-05 [Minor] `key_verification` 작업이 재시도 라우트로 다시 큐에 들어감
- 담당: api-engineer
- 근거
  - `retryJob`(`runner.ts:235`)은 job_type을 거르지 않는다.
  - 실패한 검증 작업(`key_invalid`는 `user_account` 범주)을 재시도하면 requeue된다. 레지스트리에 정의가 없으므로 실행기는 `stalled`로 끝낸다(`runner.ts:362-364`).
  - 그 사이 진행 중 대상(`ai_provider`/uuidv5)을 차지해, 키 등록이 최대 45초(`VERIFY_STALE_MS`) 동안 409가 될 수 있다.
- 수정 제안: `job.jobType === 'key_verification'`이면 `ai_job_not_retryable`을 돌려준다. 테스트 1개를 추가한다.
- 상태: 열림

### QA-S3b-06 [Minor · 설계 메모] 키 RPC를 브라우저에서 직접 부를 수 있음(본인 범위)
- 담당: db-engineer (기획 확인 후)
- 근거: `save_provider_key`·`record_provider_key_check`는 authenticated 실행이다(`…000500_s3b_provider_key_rpcs.sql:173,237`).
  - 사용자가 자기 JWT로 검증 없이 `valid` 상태 저장이나 무효 키의 `valid` 표시를 할 수 있다.
  - 영향은 본인 행뿐이다. KEK가 없으므로 임의 암호문은 실행 때 복호화에 실패해 `stalled`가 되고, 무효 키는 첫 호출에서 다시 invalid가 된다. 다른 사용자 데이터나 키 노출은 없다.
- 수정 제안: 지금은 그대로 둬도 된다.
  - DM 2.11.3이 "서버 액션(사용자 세션)"으로 정했으므로, 기획에서 이 한계를 받아들일지 정한다.
  - 강화하려면 `p_verification_job_id`(본인의 succeeded `key_verification` 작업)를 요구한다.
- 상태: 열림(기획 판단)

## [가정] 판단 (2026-10-29 db·api 추가분)

**사용자 확인이 필요한 항목**(사용자에게 보이는 동작·법무·운영):
1. `ai_disclosures` 첫 버전 `v2026-10-29`, `document_path`, 실제 고지 문구: 법무 확인(D-39)이 필요하다. 출시 차단 항목이다.
2. DM 2.11.1 "운영자 SQL 역할도 select 없음" 문구 수정(`pg_read_all_data`)과 KMS 전환을 출시 조건으로 둘지.
3. 등급 변경 = 저장된 키를 다시 검증하고 같은 id로 재암호화(키를 다시 붙여넣지 않음)하는 UX 경로.
4. 키 검증의 사용 기록은 2단계만 남기는 것("연결 확인" 미터 표시)과 검증 상한 15·20초. QA-S3b-02와 함께 정한다.
5. 등록 규칙(정확히 현재 버전)과 실행 규칙(`requires_reconsent`만 막음)이 다른 점: 문구만 바뀐 고지도 등록·활성화는 막는다.
6. `ai_providers` 시드: 세 공급자 모두 `is_available = true`(UB-3), Gemini 추천, 콘솔 URL. 운영자 확인이 필요하다.
7. `record_provider_key_success` 신설과 DM §5 app_ai_writer 실행 목록 추가: 기획 문서에 반영한다(동작은 안전하다).

**기술적 결정이라 확인이 필요 없는 항목**(QA가 타당하다고 본다): `p_key_id`·`p_failure_cause`·`p_encryption_version` 인자, `result_status ∈ (valid, failed)`, "첫 키 = 활성 공급자 null", `get_provider_key_secret`의 거부(오류)와 키 없음(0행) 구분 및 `key_id` 반환, readiness `form`일 때 `suggested_*` 생략, 화면 조회 컬럼에 `user_id` 없음(삭제는 RLS), 키 상태 보고는 최종 실패에서만, 진행 중 검증 오래됨 기준 45초.

## 스펙 차이 (spec-gaps.md에 넘길 항목)
- QA-S3b-06: 키 RPC를 클라이언트가 직접 호출할 수 있다는 한계를 받아들일지(DM 2.11.3). 리더가 spec-gaps에 기록한다.

## 라운드 후 조치 (리더, 2026-10-29)
- QA-S3b-07 → **해결**: 철회 후 진행 중 작업 취소가 실패해도 철회는 성공으로 응답하고 로그만 남긴다. 단위 테스트 3개.
- 테스트 간헐 실패(리더 재검사 중 발견): `runner.integration.test.ts`가 전역 sweep을 미래 기준 시각으로 불러, 병렬로 도는 다른 테스트의 새 작업을 정리하고 있었다. 테스트 범위를 좁혀 고쳤다(운영 로직 변경 없음). 리더가 `run-checks.sh --build` 5종 PASS와 전체 Vitest 697/697 연속 통과를 확인했다.
- QA-S3b-06 → 설계 차이로 spec-gaps에 넘겼다(기획 판단 대기).
