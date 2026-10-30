# R3 db-engineer 노트 — readiness `ai_connection.consent_required` (R-67)

## 만든 것
- 새 마이그레이션 `supabase/migrations/20261106000200_r3_readiness_consent_required.sql`
  - `private.current_ai_connection()`을 다시 정의해 `consent_required`를 더했다. 이 함수는 S3b(`20261029000600`)에서만 정의됐고 이후 재정의가 없었다(R1 `20261105000400`은 `get_data_readiness`에서 호출만 한다).
  - 판정: 활성 공급자와 활성 키가 모두 있으면 `not private.ai_consent_allows_run(user, k.provider, k.connection_tier)`, 아니면 `null`.
    - `ai_consent_allows_run`은 `check_ai_run_allowed`·`retry_ai_job`·`save_provider_key`가 쓰는 같은 함수다(DM 2.11.5 규칙: 철회 안 된 최신 동의 행 + 그 버전이 시행 중 + 그 뒤 시행된 `requires_reconsent` 고지 없음).
    - `key_status`와 따로 계산한다(DM 6장). `invalid` 키도 동의 여부를 그대로 보여 준다.
  - 보안·권한은 그대로: `security definer`, `search_path = ''`, `revoke all from public`, `execute` → `authenticated`, `app_ai_writer`. `ai_consent_allows_run`은 여전히 소유자 전용이다(definer 안에서만 호출).
  - `get_data_readiness()`는 바꾸지 않았다. `ai_connection`을 그대로 실어 보내므로 필드가 자동으로 붙는다. `next_action` 판정 순서·힌트는 그대로다(판정은 `active_provider`·`key_status`만 본다).

## 반환 모양 (변경 후)
```json
"ai_connection": {
  "active_provider": "gemini" | "openai" | "anthropic" | null,
  "key_status": "valid" | "invalid" | "needs_check" | null,
  "connection_tier": "free" | "paid" | null,
  "consent_required": true | false | null
}
```
- `profiles(id, active_ai_provider)` → 키 FK가 있어 "활성 공급자는 있는데 키가 없음"은 생기지 않는다. 그래도 함수는 `k.id is null`이면 `null`을 준다.

## 호출처 확인
- DB: `private.current_ai_connection()`을 부르는 곳은 `public.get_data_readiness()`뿐이다(R1 정의). 앱 코드에서 직접 부르는 곳은 없다.
- `database.types.ts`: `get_data_readiness`가 `Json`을 돌려주므로 재생성 결과 변화 없음(다시 생성해 확인).
- api-engineer 몫: `src/lib/contracts/ai-connection.ts` zod에 `consent_required: boolean | null`(작업 중인 변경이 작업 트리에 보임).

## pgTAP
- 새 파일 `supabase/tests/readiness_consent_required.test.sql`
  - 동의 행 없음 → `true`(다른 사용자 B의 동의는 A에 안 셈)
  - 동의 있음 → `false`, 나머지 세 필드 그대로(객체 전체 비교)
  - `invalid` 키에서도 `consent_required`는 동의 기준으로 계산
  - `app_ai_writer`로 불러도 같은 값
  - 동의 뒤 시행된 `requires_reconsent` 고지 → `true`, 새 버전 재동의 → `false`, 미래 시행 고지는 무시 → `false`
  - 키 등급이 paid인데 free 동의만 있음 → `true`, paid 동의 → `false`, 철회 → `true`
  - 키 삭제(활성 공급자 해제) → 네 필드 모두 `null`; 키는 있지만 활성 공급자 없음 → 모두 `null`
  - 함수가 여전히 security definer, `authenticated`·`app_ai_writer`만 실행, `ai_consent_allows_run`은 `authenticated` 실행 불가
- 기존 `supabase/tests/get_data_readiness.test.sql`: `ai_connection` 전체 비교 4곳에 `consent_required` 추가(A는 동의 행이 없어 `true`, 키 삭제 후 `null`). 테스트 내용만 맞췄고 판정 기대값은 그대로다.

## 실행 결과
- `supabase db reset`: 성공(새 마이그레이션 적용).
- `supabase test db`: 46 파일, 2177 테스트 전부 통과.
- 원격 브랜치 적용 없음. 커밋 안 함.

## 기획 갭
- 없음. DM 6장은 "활성 공급자가 없으면 null"이라고만 적었고, 지시대로 "활성 키 없음"도 null로 했다. FK 때문에 둘은 같은 상태다.
