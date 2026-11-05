# 요청 회신 — data-architect (데이터 모델 v4.12, 결정 사이클 `settings-dialog`)

- 작성: 2026-11-05 / 반영 문서: `_workspace/02_data-architect_data-model.md` (**v4.12**, 기준 PRD v4.14 · UX v5.17 · AI v4.12)
- 작업 원본이 v4.2로 뒤처져 있어 **통합본 `docs/planning/04-data-model.md`(v4.11)를 작업 원본에 복사해 기준을 맞춘 뒤** v4.12를 썼다. `docs/planning/`은 건드리지 않았다.
- **문서만 작성했다.** 마이그레이션·SQL은 적용하지 않았다(방향·순서·파괴성 표시는 2.1.1과 11.7에 적었다).

---

## 0. 확정 이름 한눈에 (다른 문서가 그대로 쓸 이름)

**`profiles` 신설 컬럼** — `job_search_status` / `interested_company_type` / `interested_industry` / `highest_education_school_name` / `highest_education_degree` / `highest_education_status` / `highest_education_start_month` / `highest_education_end_month` / `highest_education_major` / `highest_education_gpa`

**`profiles` 삭제 컬럼** — `total_years_of_experience`(SD-2) · `desired_job_title`(SD-A17) · `interested_industries`(→ `interested_industry`로 교체, SD-A4)

**신설 테이블** — `profile_job_interests(user_id, sort_order, job_family, job_role, created_at)` · 참조 테이블 `profile_options(category, code, parent_code, label, sort_order, is_active)`

**신설·교체 RPC·함수** — `save_profile_basics(p_values, p_job_interests, p_expected_updated_at)`(신설) · `get_ai_usage_summary`(응답 교체) · `get_data_readiness`(응답 축소) · `private.compute_total_experience_months(p_user_id, p_as_of)`(신설)

**신설 컬럼(사용량)** — `ai_usage_records.input_cost_usd` · `ai_usage_records.output_cost_usd`

**새 열거값** — `policy_versions.policy_type`에 `ai_data_use` 추가. **그 밖 CHECK는 늘리지 않는다**(`consents.consent_type`·`ai_usage_records.feature`·`evidence_links.source_type` 모두 그대로).

---

## 1. ux-planner (UX v5.17) 요청 회신

### 요청 1 — 내 정보 새 필드 이름 확정 (D-UX-29)

| UX가 물은 것 | 확정 |
|---|---|
| 구직 상태 | **`profiles.job_search_status`** text null. 단일 선택, 값은 `profile_options` 카테고리 `job_search_status`의 **코드**(라벨은 PRD 9.7 (1)) |
| 관심 기업군 | **`profiles.interested_company_type`** text null, 카테고리 `company_type` |
| 관심 산업 | **`profiles.interested_industry`** text null, 카테고리 `industry`. **컬럼을 단일 값으로 바꾼다**(배열 유지 + 화면 제한은 쓰지 않는다 — "2개 들어 있는 행"을 화면이 영구히 분기해야 한다). **기존 값 처리**: 배열 원소가 정확히 1개이고 그 문자열이 새 코드의 `label`과 글자 그대로 같을 때만 백필하고, 그 밖(0개·2개 이상·대응 없음)은 **null로 두고 사용자가 다시 고른다**. 임의 매핑 표로 뜻을 추측하지 않는다 (2.1.1 마이그레이션 표 ②) |
| 관심 직군·직무 쌍 | **별도 테이블 `profile_job_interests`**(jsonb 아님). 근거: ① 직무가 그 직군의 것인지(상하 관계) 검증을 코드 테이블 조회 한 곳에서 한다 ② 최대 3쌍·중복 금지·순서가 PK `(user_id, sort_order)` + `CHECK (sort_order between 1 and 3)` + `unique (user_id, job_family, job_role)`로 끝난다 ③ "서비스 안 추천"이 생기면 조인 대상이다. **저장은 요청대로 쌍 전체 덮어쓰기**(한 트랜잭션에서 delete → insert, 부분 수정 API 없음). `job_role`은 null 허용 — 직군만 고른 상태를 허용한다 |
| 최종 학력 6칸 | **평면 컬럼 `highest_education_*`**(jsonb 아님 — 칸이 6개로 고정이고 기간·길이 CHECK를 그대로 쓴다). **학점은 요청대로 자유 입력 text**. **`educations`와 동기화하지 않는다**(FK·트리거·백필·경고 전부 없음, SD-5) |
| text 칸 길이 상한 | **학교 명 100자 · 전공 100자 · 학점 20자**. (참고: 이름 `display_name`은 기존 50자) |

- 값 목록을 **코드 테이블 `profile_options`**에 둔 이유는 DM-22에 적었다(값 약 40개 + 표시 문구가 바뀔 전제 + 직군·직무 상하 관계). **화면은 코드로 저장하고 라벨은 `profile_options`에서 읽는다** — 셀렉트 옵션 목록도 이 테이블이다. 폐지한 값은 행을 지우지 않고 `is_active = false`로 내리며, 이미 그 값을 고른 사용자에게는 저장된 값을 계속 보인다.
- **검증 오류 코드**: 목록에 없는 코드·카테고리 불일치·직군과 맞지 않는 직무 = `invalid_profile_option`(400).

### 요청 2 — 폐기할 컬럼과 `profile_filled`

- `total_years_of_experience`·`desired_job_title`·`interested_industries` **세 컬럼 모두 폐기**(읽기 전용으로도 남기지 않는다 — PRD·UX·AI 모두 쓰지 않기로 확정했고 보존 요구가 없다). 순서는 **① 컬럼 추가 → ② 백필 → ③ 읽는 코드 제거 배포 → ④ `drop column`(파괴적 ★)**.
- **`get_data_readiness().profile_filled`은 삭제한다**(SD-A18). `hints`의 `"profile"` 값과 "ready여도 `hints: ["profile"]`을 붙인다"는 규칙도 함께 삭제한다. `data_sufficiency`의 `thin` 정의에서 "프로필 또는"을 뺀다. **응답에서 키가 사라진다**(값이 `false`가 되는 것이 아니다) — 6-A 절.

### 요청 3 — 내 정보 저장 RPC

- **된다. S-10·S-44 페이지 저장과 같은 모양으로 둔다.** RPC **`save_profile_basics(p_values jsonb, p_job_interests jsonb, p_expected_updated_at timestamptz)`**, security invoker, 동기, 한 트랜잭션에서 `profiles` update + 쌍 전체 덮어쓰기.
- 기대 버전은 **`profiles.updated_at`** 기준이고 다르면 **`stale_write`(409)** — DM-21과 같은 규칙이다.
- 오류: `stale_write` · `invalid_profile_option` · `field_too_long` · `invalid_period`(최종 학력 종료 < 시작) · `too_many_job_interests`(4쌍 이상). 응답 `{updated_at}`.
- 조회는 `profiles` + `profile_job_interests` + `profile_options`(라벨) 세 읽기다(7장 "내 정보 조회" 행).

### 요청 4 — 사용량 공급자 × 기능 교차 집계 (D-UX-30)

- **`get_ai_usage_summary`의 응답을 교체한다**(시그니처는 그대로). `by_feature`·`by_provider` 삭제 → **`providers[]`**: 공급자마다 `connection_tiers`(그 달 기록에 나타난 등급 목록) · `totals` · **`by_feature[]`**(입력/캐시/출력 토큰, 호출 수, 실패 호출 수, **`input_cost_usd`·`output_cost_usd`**, `estimated_cost_usd`) · `price_table_versions`(버전·`source_checked_at`). 전체 `totals`와 `include_previous`는 유지. 정확한 모양은 2.9.5의 JSON이다.
- **무료 등급 안내의 현재 상태**는 `providers[].connection_tiers`(지난 기록)가 아니라 **활성 키의 `connection_tier`**(`ai_provider_keys_public`, 같은 화면이 이미 읽는다)로 판단해 주세요 — 달 중간에 등급을 바꾸면 기록에 두 등급이 섞인다.
- **합산은 화면이 한다**(요청이 물은 점): `career_description` + `cover_letter` → "자기소개서 작성 AI 채팅" 한 행은 **표시 단계에서만**, 매핑 상수 한 곳(AI C-13.1 표)으로. RPC·SQL에 묶음을 넣지 않는다 — 다음 사이클에 묶음이 또 바뀌고(SD-4), RPC가 묶으면 저장 8값과 표시 7행이 한 함수에 섞인다. **저장 `feature` 8값은 그대로다.**
- ★ **새로 필요한 것 하나**: 화면의 **입력 비용 / 출력 비용 열**은 현행 데이터로 만들 수 없다(합계 `estimated_cost_usd` 하나뿐이고, 장문 구간·캐시 단가가 섞여 토큰에서 역산할 수 없다). 그래서 `ai_usage_records`에 **`input_cost_usd`·`output_cost_usd`를 신설**하고 기록 시점에 나눠 저장한다. 과거 행은 가격표로 재계산해 백필하는 쪽을 권고한다(`[결정 필요]` D-DM-15 — 백필하지 않으면 지난달 표의 비용 열이 0으로 보인다).

### 요청 5 — AI 데이터 처리 문서 버전 (D-UX-31)

- **`policy_versions`에 `policy_type = 'ai_data_use'` 행을 더한다.** 네 문서가 모두 같은 모양("버전 {version} · 시행일 {effective_at}")으로 열린다. `document_path = '/policies/ai_data_use/{version}'`(**리뷰 라운드 1, R-SD-14** — 기존 3종과 같은 `/policies/{type}/{version}` 규칙. 문서 페이지 주소는 버전 없는 `/policies/ai_data_use`), `requires_reconsent = false` `[가정]`.
- **`ai_disclosures`를 머리글 원천으로 쓰지 않는 이유**: 공급자 × 등급 **6행**이라 "이 문서의 버전 하나"가 없고(활성 공급자가 없으면 고를 수조차 없다), 버전 문자열 모양도 다른 세 문서(`2026-11-04`)와 다르다(`v2026-11-05`). **문서 본문의 공급자별 요약만** `ai_disclosures` 6행에서 읽는다.
- **`consents.consent_type`에는 값을 더하지 않는다**(요청이 걱정한 점): 이 문서는 고지 문서이고 동의는 키 연결 때 공급자별로 받는다(`ai_data_use_consents`). 늘어나는 CHECK는 `policy_versions.policy_type` 하나뿐이다. 가입 동의 게이트도 그대로다.

### 요청 6 — 선택 동의 토글 (확인)

- **확인했다. 변경 없다.** 기존 `consents`의 `service_improvement`·`marketing` 그대로. **켜기 = 새 행 insert**(`agreed = true`, `policy_version` = 그 시점 `privacy` 버전 `[가정]`, `withdrawn_at = null`), **끄기 = 가장 최근 유효 행에 `withdrawn_at = now()` update**(행 삭제 없음). 현재 상태 = 가장 최근 행이 `agreed = true AND withdrawn_at is null`.
- **필수 동의 기록 표시를 남기기로 했으니**(SD-A14 / SD-Q3 (다) 미확정) `terms`·`privacy_required`의 항목·동의 날짜를 읽는 경로를 **그대로 유지**했다(2.1.4). 확정이 나와 표시를 없애더라도 **데이터는 지우지 않는다**(PIPA 동의 이력).

---

## 2. ai-feature-designer (AI v4.12) 요청 회신

1. **컨텍스트 팩이 `profiles`를 읽지 않는다 — 데이터 모델에 한 줄로 못 박았다**(2.1.5). 빠지는 컬럼 4개(`desired_job_title`·`interested_industries`·`total_years_of_experience`·`display_name`)와 "`profiles`에 어떤 컬럼을 더하든 AI 입력 경로와는 무관하다"를 적었고, **권한으로도 막는다** — `app_ai_writer`에게 내 정보 컬럼·`profile_job_interests`·`profile_options` select 권한을 주지 않는다(5장). AI 실행 경로가 `profiles`에서 읽는 것은 `active_ai_provider`·`career_data_updated_at`뿐이다.
2. **`computed_total_months` — 권고대로 전용 함수**(6.2 신설): `private.compute_total_experience_months(p_user_id uuid, p_as_of date)` → **`(total_months integer, open_ended_experience_count integer, as_of_month date)`**. ① 팩 조립 쿼리 안의 인라인 SQL로 두지 않는다(정의가 갈라진다) ② `status = 'complete'` 필터를 **함수 안에서** 적용하고, 팩 조립과 같은 정의를 쓴다는 것을 pgTAP로 고정한다(경력 1건을 `draft`로 내리면 팩에서도 합계에서도 빠진다) ③ **"기간 미입력 경력 N건"을 같은 호출이 함께 돌려준다**(`open_ended_experience_count`). 계산 규칙은 C-1과 한 글자도 다르지 않게 옮겼다(양 끝 포함 / 월 합집합 / 재직 중 = `p_as_of`의 달 / `is_current = false` + 종료월 null = 합계 제외 + 건수). 기준월을 **인자로** 받는다(함수 안에서 `now()`를 읽지 않는다 — 테스트·재현). 공개 RPC는 지금 두지 않는다(보이는 화면이 없다).
3. **`career_snapshot_hash`에 넣지 않는다 — 동의했고 그대로 적었다**(6.2 해시·검증). `input_hash`도 같다. 대가 한 줄도 적었다: 달이 바뀌어 합계가 1개월 늘어도 같은 `input_hash`로 이전 결과를 재사용한다 `[가정]`(뒤집혀야 하면 사용자가 "다시 생성").
4. **`evidence_links`의 `profile` 행 — 권고를 채택하지 않았다.** 리더 판단 **SD-A19**(2026-11-05, AI·UX 회신 뒤 추가)가 "행·라벨을 지우지 않고 남기되 근거 칩의 **'원본으로 이동'을 비활성**"으로 정했다. 따라서 `source_deleted_at`을 소급해 채우지 않는다 — 원본 **데이터**가 지워진 것이 아니라 **원본 화면**(S-04)이 없어진 것이라 "원본 삭제됨"은 사실과 다르다. 요청이 물은 제약 문제는 그 판단과 같은 결론이다: **`source_type` CHECK 목록에서 `profile`을 빼지 않고**(빼면 기존 행이 위반) **insert 트리거가 새 행만 거부**한다(`invalid_evidence_source`). 부분 제약(`CHECK … NOT VALID`)도 가능하지만 거부 코드를 다른 근거 오류와 같게 주려면 트리거가 낫다. 결과 저장 RPC의 "허용 출처 커리어 6종"은 **5종**으로 줄였다(2.8) — **리뷰 라운드 1(R-SD-9) 반영**: 인사이트만이 아니라 **경력기술서·직무 면접 질문·평가·종합·자기소개서 문항의 허용 목록도 모두 5종**이다(트리거와 RPC가 같은 목록을 쓴다).
5. **사용량 집계 — ① 교차 집계는 RPC가, ② 묶음은 화면이** 한다. `providers[].by_feature`는 **저장 값 그대로**이고, `career_description` + `cover_letter` 합산은 표시 단계에서만 한다. **묶음 정의의 원천은 C-13.1 표 하나**로 두자는 권고를 그대로 채택했다(SQL 하드코딩 없음) — 2.9.5에 그렇게 적었다. 저장 `feature` CHECK는 변경 없다.
6. **`prompt_version` 문자열 변경 — 과거 결과 행을 마이그레이션으로 고치지 않는다.** 11.7 #13에 "마이그레이션 없음"으로 올렸다. 영향 한 줄: **동일 입력 재사용(`input_hash`)이 v4.12 배포 시점에 한 번 전부 끊기고**, 그 뒤 첫 생성 비용이 한 번 늘어난 다음 다시 정상으로 돌아온다(의도).

---

## 3. product-planner (PRD v4.14) 요청 회신

1. **`profiles`에서 뺄 필드**: `total_years_of_experience` 삭제. **`desired_job_title`도 삭제**(SD-A17 — 관심 직군·직무 쌍이 대신하고 자유 입력 칸이 없다), **`interested_industries`는 단일 선택 `interested_industry`로 교체**(SD-A4). 세 컬럼 모두 읽기 전용으로 남기지 않는다.
2. **`profiles`에 더할 필드**: 위 0절 목록대로 전부 nullable. 값 목록은 **`text + CHECK`가 아니라 참조 코드 테이블 `profile_options`**로 정했다(DM-22) — 값이 약 40개이고 **표시 문자열이 바뀔 전제**(PRD 9.7의 "코드가 아니라 표시 문자열 + 안정적인 키")이며, 관심 직군·직무는 **상하 관계**라 CHECK로 쌍 유효성을 검사할 수 없다. 값 추가·문구 변경은 행 insert·update, 폐지는 `is_active = false`(마이그레이션 없음).
3. **최종 학력은 `educations`와 무관**: FK·트리거·동기화·경고를 두지 않았다(2.1.1에 한 줄로 못 박음). 컬럼 접두사도 `highest_education_`로 해 읽는 사람이 섞지 않게 했다.
4. **`profile_filled` — 권고대로 삭제**(SD-A18). 응답 모양 변경과 읽는 곳 영향은 6-A 절, 백엔드 후속은 11.7 #6.
5. **사용량 교차 집계**: `get_ai_usage_summary` 응답 교체 + `ai_usage_records`에 비용 2컬럼 신설(위 UX 요청 4 참조). 조회·집계 경로는 2.9.5, 묶음은 화면.
6. **`consents`**: 새 동의 종류 없음, 데이터 그대로. SD-A14가 열린 결정이므로 **읽는 경로를 지우지 않았다**.
7. **개선 요청**: **테이블을 두지 않는다**(2.1.6). 폼 주소는 앱 상수·env이고 DB에 두지 않는다 — 주소 하나를 위해 참조 테이블을 만들 이유가 없다. 탈퇴·삭제 정책에 영향 없음.

**product-planner에게 올리는 제품 결정**

- `profile_options`의 **코드 키**를 누가 정할지: 라벨은 PRD 9.7(product-planner), **코드 키는 data-architect**가 확정 라벨에서 `snake_case`로 만들어 시드 마이그레이션에 매핑 표로 둔다(`[결정 필요]` D-DM-13).
- 값 목록 확정 전까지 화면 셀렉트는 **9.7 초안 시드**로 동작한다 — 라벨만 바뀌면 코드는 그대로이므로 사용자 데이터가 깨지지 않는다.

---

## 4. 다른 문서에서 고쳐야 하는 자리 (이름이 바뀐 것)

| 바뀐 것 | 어느 문서의 어느 자리 |
|---|---|
| `interested_industries`(배열) → **`interested_industry`**(단일) | UX v5.17 S-24 계정 탭 컴포넌트 표의 "관심 산업" 행 `[가정]` 이름, PRD F-P1-01 (1)의 항목 설명(배열 전제 문장이 있으면) |
| 내 정보 컬럼 이름 `[가정]` → 확정 | UX v5.17 S-24 계정 탭 표 전체(위 0절 10개 이름), D-UX-29 행을 **해소**로 |
| 관심 직군·직무 = **별도 테이블 `profile_job_interests`** | UX v5.17 S-24 쌍 추가·삭제 UI 설명(저장 단위 = 쌍 전체 덮어쓰기), PRD F-P1-01 (2) |
| 내 정보 저장 = **`save_profile_basics`**, 기대 버전 `stale_write` | UX v5.17 S-24 계정 탭 "섹션 단위 저장"의 저장 실패 문구(`stale_write` = 다른 곳에서 먼저 저장됨), 오류 코드 5종 |
| `get_data_readiness()`에서 **`profile_filled`·`hints: "profile"` 삭제** | UX v5.17 C-09·C-10 게이트 설명(쓰는 곳이 남아 있으면), AI v4.12 `data_sufficiency` `thin` 정의(이미 정리됨 — 확인만) |
| `get_ai_usage_summary` 응답 = **`providers[]`** | UX v5.17 S-42 표의 데이터 출처 설명(`by_provider` 표 삭제는 이미 반영됨), 열 2개의 원천 = **`input_cost_usd`·`output_cost_usd`**(새 컬럼) |
| **`policy_versions.policy_type = 'ai_data_use'`** | UX v5.17 S-30 진입점 표의 "AI 데이터 처리" 행(버전·시행일 원천), 약관 탭 [전문 확인] 4개 |
| `computed_total_months` 계산 위치 = **`private.compute_total_experience_months`** | AI v4.12 C-1의 `computed_total_months` 항목(계산 위치·시그니처·동반 반환값 한 줄), AI-02 판정 기준의 "서버가 넣은 값" |
| `evidence_links` 허용 출처 커리어 **5종** | AI v4.12 C-3·V-7의 "커리어 6종" 표현, UX C-01·C-02(칩 라벨 유지 + "원본으로 이동" 비활성) |

---

## 5. 이 판에 남긴 `[결정 필요]`·`[가정]`

| ID | 내용 | 상태 |
|---|---|---|
| **D-DM-13** (신규) | 내 정보 값 목록(7종)과 코드 키 | 사용자 확인 대기(SD-Q2). 데이터 모양은 어느 값 목록이든 같다 |
| **D-DM-14** (신규) | 관심 직군·직무 쌍 **최대 3개**가 맞는지 | 사용자 확인 대기(SD-Q3 (가)). 늘리는 방향은 CHECK 하나만 고치면 되고 비파괴, 줄이는 방향은 파괴적 |
| **D-DM-15** (신규) | `ai_usage_records` 과거 행에 비용 2컬럼을 **백필할지** | data-architect 권고 = 백필, 백엔드 확인(13개월 재계산 비용) |
| SD-A14 / SD-Q3 (다) | 약관 탭의 필수 동의 기록 표시 | 미확정 — **데이터·읽기 경로를 그대로 유지**했다 |
| `[가정]` | `is_active = false` 코드는 신규 선택만 거부하고 기존 값 재저장은 통과 | 2.1.1 |
| `[가정]` | `policy_versions`의 `ai_data_use` 행 `requires_reconsent = false` | 2.1.3. 법무 확인(D-39) 범위 |
| `[가정]` | 선택 동의의 `policy_version`은 `privacy` 버전을 따른다 | 기존 A.2 가정 유지 |
| `[가정]` | 월이 바뀌어 `computed_total_months`가 늘어도 `input_hash` 재사용은 끊지 않는다 | 6.2 |

---

## 6. 리뷰 라운드 2 반영 (R-SD-18 · R-SD-22 · R-SD-23, 2026-11-05)

판 번호는 **v4.12 유지**. 마이그레이션·SQL은 쓰지 않았다(제약·오류 코드 방향만 문서에 확정).

| 이슈 | 반영 | 고친 자리 |
|---|---|---|
| **R-SD-18** (Major) | 중복 쌍 제약을 **`unique nulls not distinct (user_id, job_family, job_role)`**로 확정(부분 unique 2개는 쓰지 않는다 — PG 15+ 문법이라 제약 하나로 끝나고 오류 매핑이 단순하다). 저장 RPC 오류에 **`duplicate_job_interest`(400)** 추가 — 쌍 목록은 전체 덮어쓰기라 **요청 안의 중복을 insert 전에** 거부하고, 제약 위반(23505)도 같은 코드로 변환한다(raw 23505를 화면에 올리지 않는다). null 직무끼리도 중복으로 본다 | 2.1.2, 7장 "내 정보 저장" 오류 목록, 11.7 #3·#5 |
| **R-SD-22** (Minor) | 가격표 `version` 문자열을 **AI C-13의 `v{YYYY-MM-DD}`**로 맞췄다(리뷰 권고 그대로 AI 쪽 모양). 시드 첫 버전 **`v2026-10-28`**, 예정 `v2026-12-01`·`v2027-01-01`. 두 자리 접미사 모양은 폐기, 같은 날 두 번 고치면 새 날짜 버전을 쓴다 | 2.9.3 `version` 행 + 규칙 한 줄, 2.9.5 응답 예시 2곳(`price_table_versions`, 기준일도 `2026-10-28`), 11.7 #8 ⓞ |
| **R-SD-23** (Minor) | `private.compute_total_experience_months`의 `p_as_of`에서 **기본값을 없앴다**(필수 인자). 기본값은 호출 시점에 평가되므로 생략한 호출은 함수가 `now()`를 읽은 것과 같아져 동일 입력 재사용·pgTAP의 전제가 깨진다. **모든 호출자가 `p_as_of`를 명시**한다(팩 조립 = 그 실행의 KST 오늘, pgTAP = 고정 날짜, 수동 조회는 식을 직접 적는다) | 6.2 시그니처 + 설명 한 줄, 11.7 #7 |

### ux-planner에게 요청 (R-SD-18 — UX S-24 ① 오류 표에 한 줄)

- 계정 탭 저장 오류 표에 **`duplicate_job_interest`**(400) 행을 더해 주세요. 지금 표는 `stale_write` · `invalid_profile_option` · `field_too_long` · `invalid_period` · `too_many_job_interests` 5종이고, 중복 쌍 문구가 어느 코드에서 오는지가 비어 있습니다.
- **화면 문구 초안(한 줄 제안)**: 「이미 고른 직군·직무예요. 다른 쌍을 고르거나 지워 주세요.」 — 표시 위치는 **중복으로 걸린 쌍 행 아래 인라인 + 그 행 포커스**(쌍 목록 전체 덮어쓰기라 저장은 통째로 실패하고, 어느 행이 문제인지만 집어 주면 됩니다).
- 함께: **직무를 비운 쌍끼리도 중복**입니다(같은 직군을 직무 없이 두 번 고르면 막힙니다) — DB 제약을 `nulls not distinct`로 확정했으니 S-24 ① 쌍 행 비고의 "DB도 `unique (user_id, job_family, job_role)`로 막는다" 문장을 **`unique nulls not distinct (...)`**로 고치고 `[가정]`을 내려 주세요.
