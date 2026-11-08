# 릴리스 2026-11-08 — 법무 문서 2종 시행 (UI42-7 · UI42-8)

`docs/planning/decisions.md` 3.24·4.18의 법무 후속 2건을 시행판으로 옮겼다. 사용자 확인 2026-11-08.

## 사용자 결정

| # | 질문 | 확정 |
|---|------|------|
| 1 | 처리방침 "운영자는 학점·성적을 받지 않습니다" vs 내 정보의 **학점 칸**(운영에 이미 배포됨, `profiles.highest_education_gpa`) | **본문을 고치는 쪽.** 기능은 그대로 두고 "학점은 이용자가 내 정보의 최종 학력에 직접 적을 때만 보관하며, 성적 증명이나 과목별 성적은 받지 않습니다"로 바꿨다 |
| 2 | 시행일 | **2026-11-08** (리더 기본값, 사용자 이의 없음). 시행 중인 판에 없는 내 정보 항목을 이미 받고 있어 더 미루지 않았다 |
| 3 | `requires_reconsent` | **false** (초안 권고 그대로). 선택 항목의 이름·구성만 바뀌었고 필수 동의 범위(계정)와 국외 이전 대상은 그대로다 |

**법무(변호사) 검토는 여전히 "출시 전 권장"으로 남는다.** 이번 작업은 사용자가 운영자로서 초안을 확인해 시행판으로 옮긴 것이다.

## 바뀐 것

| 파일 | 내용 |
|------|------|
| `docs/legal/privacy-policy.md` | 버전·시행 2026-11-08. 5곳 — ① 1번 항목 표 "기본 프로필(표시 이름·희망 직무·총 경력 연수·관심 산업)" → "내 정보"(이름·구직 상태·관심 기업군·산업·직군·직무 최대 2개·최종 학력) ② 인적사항·학점 문장 + 새 문장 "내 정보는 화면 표시와 서비스 안 기능 추천에만 쓰고, AI 공급자에 보내지 않습니다"(SD-6) ③ 2번 처리 목적 2 ④ 3번 보유 기간 표 첫 행 ⑤ 공고일·시행일 |
| `src/components/account/policy-content.ts` `POLICY_DOCUMENTS.privacy` | 같은 4곳(앱 문체 "-요"). 폐기 필드가 남아 있던 `:210`·`:237` 해소 |
| `docs/legal/ai-data-use.md` | **신설** — AI 데이터 처리 원문 8개 조항. `docs/ui/screen-status.md`의 열린 이슈 "S-30 AI 데이터 처리 본문 원문이 없다"가 닫혔다 |
| `src/components/account/policy-content.ts` `AI_DATA_USE_SECTIONS` | `[UI-가정]` 2개 조항(기존 화면 문구 조합) → 원문 8개 조항. 문체는 원문의 "-습니다"를 유지했다(다른 탭의 "-요"와 다름 — 고지 문서) |
| `supabase/migrations/20261113002900_policy_versions_2026_11_08.sql` | **신설, 비파괴.** `policy_versions`에 `privacy` 2026-11-08 · `ai_data_use` 2026-11-08 두 행 insert(`on conflict do nothing`). 기존 행은 고치지 않는다 |

### 공급자별 사실은 복제하지 않았다

원문 5번의 공급자 표는 `docs/legal/ai-data-use.md`에는 그대로 싣되 **앱 본문에는 넣지 않았다.** 화면은 `ai_disclosures` 행(공급자 × 등급 6행)을 읽는 `ProviderSummaries`가 그 자리를 대신한다 — 초안이 요구한 "AI 명세 C-7.1 / `ai_disclosures`와 한 글자도 다르지 않게"를 표를 복제하지 않는 방식으로 지켰다. 다만 그 조항은 `policy-document.tsx`가 **문서 맨 끝**에 붙이므로 번호가 5번이 아니라 마지막(9번)이다. 5번 자리에는 그 요약을 가리키는 안내문만 둔다. 원문 순서대로 5번에 놓으려면 `policy-document.tsx`의 조항 배치를 고쳐야 한다 → **UI 요청**.

## 테스트 영향 — 동의 버전이 문서별로 갈라졌다

처리방침만 2026-11-08로 올라가 **가입 때 기록되는 동의 행이 두 문서 버전을 인용하게 됐다**: `terms` = 2026-11-05, `privacy_required`·`service_improvement`·`marketing` = 2026-11-08(`private.consent_policy_type`가 선택 동의 2종을 `privacy`에 매핑). 설계대로지만 pgTAP 4개 파일이 "네 종류가 한 버전을 쓴다"를 전제로 두고 있었다.

| 파일 | 고친 기대값 |
|------|-------------|
| `consents.test.sql` | 선택 동의 현재 버전·`agreed_version` → 2026-11-08, 직접 insert 3곳 → 2026-11-08, `count(distinct policy_version)` 1 → **2** + 어느 동의가 어느 문서를 인용하는지 단정 2건 추가(plan 51 → 53) |
| `policy_versions.test.sql` | 행 수 11 → 13(3곳) |
| `r12_ui36_followups.test.sql` | "2026-11-05가 세 문서의 현재 버전" → 약관·국외 이전 2종만 + `privacy`는 2026-11-08 단정 추가(plan 21 → 22) |
| `r13_settings_dialog.test.sql` | `ai_data_use` 행 1 → 2, `document_path` 기대를 두 행으로 |
| `account_deletion.test.sql` | `privacy_required` 동의 행 → 2026-11-08(현재 버전이 아니면 트리거가 거부) |

## 검사 결과

| 검사 | 결과 |
|------|------|
| pgTAP | **65 파일 3058건 통과** (로컬 적용 후) |
| typecheck · lint | 통과 |
| vitest | **157 파일 2506건 통과** |
| build | 통과 (`✓ Compiled successfully`) |
| 브라우저 | **미확인** — `/policies/privacy`·`/policies/ai_data_use` 실제 렌더는 보지 않았다 |

## 원격 반영 — 2026-11-08 완료


- **비파괴**다. 기존 행을 고치지 않고 새 버전 행 2개만 넣는다.
- **앱 본문과 같은 머지로 나가야 한다.** 행만 먼저 올리면 화면이 옛 본문에 새 시행일(2026-11-08)을 보인다 — 법적으로 잘못된 표시다.
- `requires_reconsent = false`라 가입 게이트(`get_consent_status().needs_consent`)는 열리지 않는다. 기존 사용자에게 재동의를 요구하지 않는다.

### 실제 순서와 중간에 생긴 구간

| 단계 | 결과 |
|------|------|
| 머지 | PR #62 → `main` 머지 커밋 `9ffd881` |
| 운영 배포 | Vercel "Deployment has completed" (GitHub 커밋 상태 success) |
| **중간 구간** | 배포가 끝나고 행을 올리기 전까지, 화면에 **새 본문 + 옛 버전·시행일(2026-11-05)** 이 함께 보였다. 처음 시도가 권한 분류기(Production Deploy)에 막혀 사용자 승인을 받는 동안 생긴 구간이다. 기능 영향은 없고(앱은 있는 행을 읽는다), 그 사이 가입이 있었다면 `privacy_required` 동의가 2026-11-05를 인용한다 |
| 행 반영 | 사용자 승인 뒤 Supabase MCP `execute_sql` 한 트랜잭션으로 2행 insert + `schema_migrations` 버전 행 (이 워크트리는 `supabase link` 안 됨 → `db push` 불가) |
| 확인 | `privacy` 현재 버전 = **2026-11-08**(4행), `ai_data_use` = **2026-11-08**(2행), `terms`·`cross_border_transfer`는 2026-11-05 그대로. 원격 마지막 마이그레이션 = `20261113002900` |
| advisors | 실행하지 않았다 — DDL이 없는 insert 전용 마이그레이션이라 `20261113002800` 뒤에 확인한 결과와 같다 |
| 브라우저 | **미확인** — `/policies/privacy`·`/policies/ai_data_use`의 머리글과 본문을 눌러 보지는 않았다 |

## UI 요청

| # | 내용 |
|---|------|
| 1 | `src/lib/mock/fixtures.ts`의 `policy_versions` — mock은 `POLICY_VERSION = "2026-04-01"`(3종 공용)과 `ai_data_use` 2026-11-05를 쓴다. `?state=` 미리보기에서 실제 버전과 다른 날짜가 보인다. 처리방침만 따로 올리려면 3종 공용 상수를 쪼개야 한다 |
| 2 | `policy-document.tsx` 조항 배치 — 원문 순서대로 "공급자별 데이터 사용"을 5번 자리에 놓을지 (지금은 문서 끝) |
| 3 | `docs/ui/screen-status.md` S-30 행의 열린 이슈 "AI 데이터 처리 본문 원문 없음(기획 확인 필요)" 닫기, `[UI-가정]` 주석(`AI_DATA_USE_SECTIONS` 조항 구성)은 원문 반영으로 해소됨 |
| 4 | `/policies/ai_data_use` 본문 문체가 "-습니다"라 다른 탭("-요")과 다르다 — 고지 문서라 원문을 그대로 썼는데, 화면 문체를 통일할지 |
