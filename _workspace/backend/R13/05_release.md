# R13 원격 반영 순서 (settings-dialog 백엔드 후속)

- 작성: 2026-11-05 · 슬라이스 R13 · 기준 DM v4.12 11.7 "원격 반영 순서 주의"
- **이 문서는 계획이다. 이 슬라이스에서 원격(운영) Supabase에 아무것도 올리지 않았다.** `supabase db push`와 main 머지는 사용자가 실행한다.
- 원격 프로젝트는 운영 겸용이고 개발 브랜치가 없다. 프리뷰 배포도 **같은 운영 DB·KEK**를 쓴다(backend-context "Remote environments").

## 왜 순서가 중요한가

`20261113002800`이 지우는 세 컬럼(`total_years_of_experience`·`desired_job_title`·`interested_industries`)을 지금도 읽는 것이 둘 있었다:

1. `get_data_readiness` — `counts.profile_filled` 계산이 세 컬럼에 걸려 있다 → `20261113002200`이 교체한다
2. 컨텍스트 팩 조립 — `loadCareerRows()`가 `profiles`를 select 했다 → R13 코드(AI 쪽)가 조회를 없앴다

**둘 중 하나라도 옛 상태로 남은 채 drop을 올리면 AI 실행 전부와 커리어 화면이 함께 멈춘다.** 그래서 drop은 한 배포 뒤로 미룬다.

`20261113002700`(권한 좁힘)도 같은 쪽이다 — `app_ai_writer`의 `profiles` select가 `id`·`career_data_updated_at`·`updated_at`만 남으므로, 옛 팩 코드가 돌고 있으면 drop 전에 **권한 오류**로 먼저 깨진다.

## 2단 배포

### 1단 — 비파괴 마이그레이션 15개 + 코드

올릴 파일 (`supabase/migrations/`, 이 순서대로 정렬됨):

| 파일 | 하는 일 |
|------|---------|
| `20261113001500_r13_profile_options.sql` | 참조 테이블 + 시드 101행 + RLS + 인덱스 |
| `20261113001600_r13_profiles_basics_columns.sql` | 내 정보 새 컬럼 10개 추가 (전부 null 허용) |
| `20261113001700_r13_profile_job_interests.sql` | 관심 직군·직무 쌍 테이블 (최대 2쌍) |
| `20261113001800_r13_validate_profile_options.sql` | 옵션 검증 트리거 |
| `20261113001900_r13_interested_industry_backfill.sql` | `interested_industries` → `interested_industry` 백필 (읽기만, 건수 notice) |
| `20261113002000_r13_compute_total_experience_months.sql` | `private` 계산 함수 |
| `20261113002100_r13_save_profile_basics.sql` | 내 정보 저장 RPC |
| `20261113002200_r13_get_data_readiness_profile_removed.sql` | **readiness 응답에서 `profile_filled`·`"profile"` 삭제** |
| `20261113002300_r13_ai_usage_cost_columns.sql` | 비용 2컬럼 + 인덱스 + 과거 행 백필 |
| `20261113002400_r13_get_ai_usage_summary_providers.sql` | 사용량 RPC `providers[]` 교차 집계로 교체 |
| `20261113002500_r13_policy_versions_ai_data_use.sql` | `policy_type`에 `ai_data_use` + 행 1건 |
| `20261113002600_r13_evidence_profile_source.sql` | 근거 트리거 + 저장 RPC 5개 허용 출처 5종 |
| `20261113002700_r13_ai_writer_profile_grants.sql` | **`app_ai_writer` 권한 좁힘** |
| `20261113002750_r13_delete_account_profile_job_interests.sql` | 탈퇴 삭제 대상에 새 테이블 추가 |
| `20261113002760_r13_public_compute_total_experience_months.sql` | public 얇은 래퍼 |

`db push`에는 "여기까지만 올리기" 옵션이 없다 — **작업 폴더의 `supabase/migrations/`에 있는 미반영 파일을 전부 올린다.** 그래서 1단에서는 `20261113002800`(파괴적 drop)이 그 폴더에 **없어야** 한다.

**리더 결정 (2026-11-05): `20261113002800`은 `supabase/migrations/`에 둔 채로 커밋했다.** 아래 "이미 2800이 리포에 커밋돼 있다면" 절차(push 직전에 작업 폴더에서만 `mv`)가 **이 슬라이스의 실제 절차**다.

이유: 그 파일을 리포에서 빼면 `supabase db reset`이 drop을 적용하지 않아 **로컬 DB가 검증된 상태와 달라진다.** pgTAP 3048개와 통합 테스트는 drop까지 적용된 스키마에서 통과했고, 컬럼이 사라진 것을 단정하는 테스트도 있다. 리포를 "검증된 상태"로 두는 편이 안전하고, `db push`가 집는 폴더만 push 직전에 바꾸는 것으로 충분하다.

~~권장: 2단을 별도 커밋·별도 PR로 분리한다~~ — 아래는 그 대안의 기록이다. 다음에 같은 모양이 또 나오면 이쪽을 택할 수도 있다(그때는 로컬 reset이 달라지는 것을 받아들여야 한다).
- 1단 PR에는 `20261113002800_r13_drop_profile_legacy_columns.sql`을 넣지 않는다. 그 파일은 2단까지 `_workspace/backend/R13/pending/`에 둔다(`supabase/migrations/` 밖이면 `db push`도, `db reset`도 집지 않는다).
- 2단 PR이 그 파일을 `supabase/migrations/`로 옮긴다.

```bash
# 0. 올라갈 목록을 눈으로 확인한다 (Local 쪽에만 있는 파일 = 이번에 올라간다)
supabase migration list --linked
#    → 2800이 목록에 보이면 멈춘다. 1단에서는 보이면 안 된다.
supabase db push --dry-run   # 적용될 SQL을 한 번 더 확인
supabase db push             # 비밀번호 입력
```

**이미 2800이 리포에 커밋돼 있다면**(1단 PR에서 빼지 못했을 때) push 직전에 작업 폴더에서만 잠시 빼고 되돌린다 — git 이력은 그대로 두고 `db push`가 집는 폴더만 바꾸는 것이다:

```bash
mkdir -p _workspace/backend/R13/pending
mv supabase/migrations/20261113002800_r13_drop_profile_legacy_columns.sql _workspace/backend/R13/pending/
supabase migration list --linked     # 2800이 사라졌는지 확인
supabase db push
mv _workspace/backend/R13/pending/20261113002800_r13_drop_profile_legacy_columns.sql supabase/migrations/
git status                            # 작업 폴더가 원래대로인지 확인
```

그다음 **같은 배포로** 코드를 main에 머지한다. 응답 키가 사라지는 변경이라 DB와 코드가 떨어지면 화면이 깨진다:
- `get_data_readiness`에서 `counts.profile_filled`·`hints` `"profile"`이 **없어진다**(값이 `false`가 되는 것이 아니다)
- `get_ai_usage_summary` 응답이 `providers[]`로 **교체된다**(최상위 `by_feature`·`by_provider` 삭제)

1단이 끝나면: 옛 세 컬럼을 읽는 서버 경로가 남아 있지 않다. 컬럼은 아직 테이블에 있다(값도 그대로).

### 2단 — 파괴적 drop

1단 배포가 운영에서 정상 동작하는 것을 확인한 뒤에만.

| 파일 | 잃는 것 |
|------|---------|
| `20261113002800_r13_drop_profile_legacy_columns.sql` | **`profiles.total_years_of_experience` · `desired_job_title` · `interested_industries`의 모든 사용자 값. 복구 불가** |

- ~~사용자 확인이 필요하다~~ **사용자 승인 2026-11-05** (`docs/planning/decisions.md` 3.23 R13-U1) — 백업 없이 2단에서 실행. 1단 배포가 운영에서 정상인 것을 확인한 뒤에만 올린다는 조건은 그대로다.
- 값을 남겨야 할 이유가 있다면 push 전에 백업하라: `interested_industries`는 ⑤가 라벨 일치분만 `interested_industry`로 옮겼고, 나머지(0개·2개 이상·라벨 불일치)와 다른 두 컬럼은 **그대로 사라진다**.
- drop 뒤 `database.types.ts`는 이미 최종 상태로 재생성돼 있다(별도 작업 없음).

```bash
# 2800이 supabase/migrations/ 에 있는 상태에서 (2단 PR 머지 뒤, 또는 위에서 되돌린 뒤)
supabase migration list --linked
#    → Local 쪽에만 있는 파일이 20261113002800 **한 개**여야 한다. 다른 파일이 같이 보이면 멈추고 리더에게 알린다.
supabase db push --dry-run   # drop 문 3개만 나오는지 확인
supabase db push
```

## 확인

각 단계 뒤:
1. Supabase MCP `list_migrations` — 올라간 파일이 로컬 목록과 같은지
2. Supabase MCP `get_advisors` (security + performance) — `decisions.md`에 이미 수용된 항목은 다시 보고하지 않는다
3. ⑤ 백필 건수 notice를 push 로그에서 확인(라벨 일치로 옮겨진 행 수)
4. ⑨ 비용 백필 (QA-R13-06 — 가격표 행이 없어진 과거 행은 **의도적으로** 0/0으로 남기므로 "0/0인데 합계가 0보다 큼"은 오류가 아니다). push 로그의 `R13 ai_usage cost backfill: … recomputed … mismatch … at 0` notice를 먼저 보고, 다음 둘을 확인한다(둘 다 읽기 전용):
   ```sql
   -- (a) 값이 있어야 하는데 못 채운 행: 토큰이 있고 unpriced도 아닌데 두 값이 0 → 그 (version, provider, model)이
   --     가격표에 없다는 뜻. 매핑 9개 모델은 모두 시드에 있으므로 정상 경로에서는 0이어야 한다.
   select price_table_version, provider, model, count(*)
     from ai_usage_records
    where price_table_version <> 'unpriced'
      and input_cost_usd = 0 and output_cost_usd = 0
      and (input_tokens + cached_input_tokens + cache_write_tokens + output_tokens) > 0
    group by 1, 2, 3;
   -- (b) 두 열의 합이 저장된 합계와 다른 행: 당시 값이 맞으므로 고치지 않는다. 건수만 기록한다
   --     (대부분 (a)의 행 + 과거 가격표 수정이 있었던 행).
   select count(*) from ai_usage_records
    where input_cost_usd + output_cost_usd <> estimated_cost_usd;
   ```
5. Vercel 배포 상태와 런타임 오류(읽기 전용)

## 새 환경 변수

| 이름 | 용도 | 값 |
|------|------|----|
| `NEXT_PUBLIC_FEEDBACK_FORM_URL` | 설정 "개선 요청" 탭의 외부 폼 주소 (#14) | **설정하지 않는다** — 사용자 확정 2026-11-05 (3.23 R13-U3): 주소 없이 "준비 중"으로 출시. 주소가 생기면 Vercel production·preview에 값만 넣는다(코드 변경 없음) |

## 함께 가야 하는 UI 변경

이 슬라이스는 **백엔드만**이다. UI 재구현(`resumate-ui`) 없이 1단을 배포하면:
- 설정의 내 정보 영역이 옛 세 컬럼을 입력·표시하던 화면 그대로다(S-04, `src/components/career/profile-form.tsx`) — 2단 drop 뒤에는 저장이 실패한다
- S-42 사용량 표가 `by_feature`·`by_provider`를 읽고 있으면 빈 값을 보인다

→ **UI 후속(S-24 탭 4개 재구현, S-04 폐기와 `/career/profile` 리다이렉트, S-42 공급자 탭·비용 2열, `/policies/ai_data_use` 페이지)을 1단과 같은 머지에 묶는 것이 안전하다.** 묶지 못하면 2단 drop은 UI 후속이 배포된 뒤로 더 미룬다.

## `ai_data_use` 문서 버전 — 확정

`20261113002500`의 `ai_data_use` 행(`version`·`effective_at` = `2026-11-05`)을 **그대로 출시하기로 확정했다**(사용자 2026-11-05, decisions 3.23 R13-U2). 마이그레이션 변경 없음. 나중에 법무 확인으로 값이 바뀌면 **그 행을 고치지 말고 새 행을 추가한다**(`policy_versions`는 버전 이력이고 `requires_reconsent = false`라 게이트에 영향이 없다).
