# R12 백엔드 QA 리포트 (라운드 1, 2026-11-05)

- 대상: R12 "UI 36·37 백엔드 요청 (UI36-6·UI36-10, U36-2·U36-5·U36-6, R-OD-15)" — 커밋 `f15c873`(코드), `5913536`(원격 반영 기록), main `5c0933a`
- 파일: `supabase/migrations/20261113001300_r12_ui36_followups.sql`, `src/server/ai/prompts/AI-12/index.ts`, pgTAP 6개(`r12_ui36_followups` 신규 + 기대값 갱신 5개), AI-12 vitest 2개
- 사후 QA다(리더가 QA 에이전트 없이 구현·원격 반영까지 끝낸 뒤). 코드는 고치지 않았다.

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `run-checks.sh` |
| lint | 통과 | |
| vitest | 통과 | 146 파일 · 2381건 (동시 실행 중인 UI QA와 겹쳤지만 실패 없음) |
| pgTAP | 통과 | 59 파일 · 2905건 (`r12_ui36_followups` 9건 포함). 로컬 DB는 이미 `20261113001300`까지 적용돼 있어 reset·migration up 하지 않음 |
| 타입 재생성 비교 | 통과 | `supabase gen types typescript --local` 결과 = `src/server/db/database.types.ts` (빈 줄 제외 차이 없음). R12는 스키마 변경 없음 |
| 로컬 스모크 | 통과 (SQL 경로) | 라우트·액션 변경이 없어 dev 서버 스모크는 해당 없음. 대신 로컬 DB에서 `begin … rollback` 트랜잭션으로 실제 RPC 호출: OpenAI 무료 키 사용자 `start_writing_chat(…, {"feature":"cover_letter",…})` → 인사 첫 줄 "자소서 문항 답변을 쓰려면…", 무료 등급 문장 없음 / Gemini 유료 키 사용자 → 무료 등급 문장 없음. 공유 DB에 남은 행 없음 |
| 원격 `list_migrations` (읽기 전용) | 통과 | 원격 마지막 = `20261113001300 r12_ui36_followups`, 로컬 파일 목록 끝과 같음 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | 기획 ↔ 마이그레이션 | 통과 | `policy_versions` 3행(terms·privacy·cross_border_transfer, `2026-11-05`, `requires_reconsent=false`) = decisions.md 4.13 U36-5·spec-gaps UI36-6. cover_letter 기본 제목 = U36-2/D-UX-23. 게이트 이름 = U36-6. `writing_chat_free_tier` Gemini 무료만 = AI v4.11 C-7.1 / AI-12·AI-13 시작 인사 R-OD-15 / UX v5.13 S-10. (초안 기본 제목 자체는 DM·UX에 없는 S7 `[가정 5]` — 스펙 차이 참고) |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과 | 스키마 변경 없음, 재생성 결과 동일. `loadPolicyVersions`(`src/server/services/shell/index.ts:42`)는 `effective_at <= now` 내림차순 → 2026-11-05판이 현재판으로 잡힘(로컬 확인) |
| Q3 | RPC 시그니처 ↔ 호출자 | 통과 | 교체한 함수 3개 모두 시그니처 그대로(`create or replace`). 호출자: `draft_resolve_title`(→ `create_cover_letter_draft` 등), `start_writing_chat`·`start_deliverable_writing_chat`(둘 다 live 본문이 `private.writing_chat_free_tier` 호출, 인라인 무료 판정 없음 — `pg_proc.prosrc`로 확인). `writing_chat_greeting` 본문은 `20261109100800` 대비 cover_letter 줄 1줄만 다름(diff 확인) |
| Q4 | raise 코드 ↔ 오류 매핑 | 해당 없음 | 새 코드 없음 |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 | 통과 | 게이트 이름: DB 인사 "자소서 문항 답변을" = AI-12 `GATE_FEATURE_LABEL.cover_letter`(`src/server/ai/prompts/AI-12/index.ts:212`) = 화면 `RETURN_FEATURE_LABELS.cover_letter`(`src/components/common/return-banner.tsx:23`) = `DRAFT_TYPE_LABELS`(`src/lib/data/labels.ts:115`). 정책 버전: S-30은 `policy-content.ts`에 버전 상수가 없고 DB 행의 `version`·`effective_at`을 그대로 표시 → 불일치 여지 없음 |
| Q6 | SSE 이벤트 | 해당 없음 | |
| Q7 | AI 출력 ↔ 저장 | 해당 없음 | 출력 스키마 변경 없음. `prompt_version` 미변경은 입력 라벨 값만 바뀐 것이라 수용(`[가정]`, 04_summary) |
| Q8 | enum DB ↔ TS | 해당 없음 | |
| Q9 | AI 작업 종료·사용량 | 해당 없음 | |
| Q10 | 보안·개인정보 | 통과 | `private.writing_chat_free_tier`: security definer + `search_path=''`, `revoke all from public`, anon·authenticated·app_ai_writer·app_key_reader·service_role 모두 execute 없음(`has_function_privilege`), 읽는 컬럼은 `provider`·`connection_tier`뿐(암호문 아님). 다른 두 함수도 execute 권한 없음. 동의 게이트: `get_consent_status`는 "동의한 판 이후 `requires_reconsent` 판이 하나라도 있으면" 재동의 → 2026-11-05(재동의 없음) 행 추가로 2026-11-04 재동의 미완료 사용자의 게이트가 풀리지 않음(로직 확인) |
| Q11 | UI ↔ 백엔드 | 통과 | `ai_disclosures` `v2026-11-05` 6행 = `DISCLOSURE_VERSION`(`src/lib/ai-disclosures.ts:11`), `requires_free_tier_ack`는 Gemini 무료 행만 true = `ai-disclosures.ts:74` `provider === "gemini" && tier === "free"` = `writing_chat_free_tier` 범위. mock `policy_versions`(`2026-04-01`)는 미리보기 전용 |
| Q12 | 실제 의존성 연결 | 해당 없음 | 코드 경로 변경은 상수 1개 |
| Q13 | 릴리스 준비 | 통과 | 파일명이 기존·원격 마지막 뒤에 정렬, 비파괴(insert `on conflict do nothing` + 함수 본문), 새 환경 변수 없음. 원격 반영 완료 확인 |

AI-12 V-9 등 검증기 규칙은 R12에서 바뀌지 않았다(게이트 라벨 테스트 2건만 갱신).

## 이슈

### QA-01 [Minor] `docs/legal/` 검토용 사본의 버전·시행일 표기가 R12 반영 뒤에도 "마이그레이션 대기"
- 담당: 리더(법무 문서 — `docs/legal/`은 백엔드 코드가 아님. UI 36 런이 고친 파일이라 `resumate-ui`로 돌려도 됨)
- 근거:
  - `docs/legal/terms-of-service.md:7` "…`policy_versions` 행은 백엔드 마이그레이션 대기. 그 전까지 시행 중인 판은 2026-11-04", `:8` "시행일: 반영일", `:114` "이 약관은 2026년 11월 4일부터 시행합니다."
  - `docs/legal/privacy-policy.md:7` 같은 "마이그레이션 대기", `:144` "시행일: 2026년 11월 4일"
  - `docs/legal/cross-border-transfer.md:6` "…백엔드 마이그레이션이 배포되는 날 시행", `:53` 변경 이력 "2026-11-05 | 반영일"
  - ↔ 실제: `20261113001300` 원격 반영 2026-11-05, `effective_at = 2026-11-05 00:00+09`(`supabase/migrations/20261113001300_r12_ui36_followups.sql:19-21`)
- 수정 제안: 세 문서의 버전 줄에서 "개정안 / 마이그레이션 대기" 문구를 지우고 시행일을 "2026년 11월 5일"로, 부칙(약관 :114·처리방침 :144)과 국외 이전 변경 이력 :53의 "반영일"을 `2026-11-05`로 바꾼다. 앱 본문(`src/components/account/policy-content.ts`)은 시행일 문장이 없고 DB 행을 표시하므로 수정 불필요
- 상태: 열림

### QA-02 [Minor] R-OD-15 범위 테스트가 함수 단위뿐 — 경계 조합·RPC 경유 경로 미검증
- 담당: db-engineer
- 근거: `supabase/tests/r12_ui36_followups.test.sql:144-163`은 `private.writing_chat_free_tier`를 Gemini 무료 / OpenAI 무료 / Anthropic 무료 / 프로필 없음 4경우만 직접 호출한다. 빠진 경우: (a) Gemini **유료** → false, (b) Gemini 무료 키가 있지만 활성 공급자가 다른 공급자 → false(조인이 `k.provider = p.active_ai_provider`인 이유), (c) `start_writing_chat`·`start_deliverable_writing_chat`가 비-Gemini 무료 키에서 인사에 무료 등급 문장을 넣지 않음(기존 `writing_chats.test.sql:114`·`r5_deliverable_writing_chats.test.sql:98`은 Gemini 무료의 "있음"만, `writing_chats.test.sql:183`은 "키 없음"만 확인). 이번 QA에서 (a)·(c)의 `start_writing_chat`은 롤백 SQL 스모크로 확인했지만 회귀 테스트로 남아 있지 않다
- 수정 제안: `r12_ui36_followups.test.sql`에 (a)·(b) 2건, OpenAI 무료 사용자로 `start_writing_chat`·`start_deliverable_writing_chat` 호출 후 인사 `not like '%무료 등급%'` 2건 추가(plan 9 → 13)
- 상태: 열림

### QA-03 [Minor] 시작 인사의 무료 등급 문장이 UX v5.13 확정 문장과 다름 (R-OD-15로 범위만 좁히고 문구는 그대로)
- 담당: db-engineer (문구 확정은 기획 확인 — spec-gaps 기록)
- 근거: DB `supabase/migrations/20261113001300_r12_ui36_followups.sql:96` " 지금 연결된 AI는 무료 등급이라 입력한 내용이 공급자의 서비스 개선에 쓰일 수 있어요. 민감한 내용은 특히 조심해 주세요." (`20261110000100_r5_deliverable_writing_chats.sql:182` AI-13 인사도 같은 문장) ↔ UX `docs/planning/02-user-flows.md:1453` "무료 등급에서는 입력한 내용이 {공급자} 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요"(C-19 툴팁·C-21과 같은 문장이라고 명시). AI 명세(`03-ai-features.md:775`)는 문구를 `[가정]`·"최종 문구는 ux-planner"로 둔다. R-OD-15 이후 이 문장은 Gemini 무료에만 붙으므로 UX 문장(`{공급자}` = Google, "사람이 검토")이 사실과도 더 정확하다. 기존 `[가정]`(spec-gaps S4 ⑨)이 UX 확정으로 답을 받은 상태
- 수정 제안: 다음 리비전에서 `writing_chat_greeting`·`writing_chat_deliverable_greeting`의 무료 등급 문장을 UX 문장으로 교체("무료 등급에서는 입력한 내용이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요"), pgTAP `%무료 등급%` 기대값은 그대로 통과. 이미 저장된 인사는 바꾸지 않음. 기획이 문구 차이를 의도한 것이면 UX 쪽을 고친다
- 상태: 열림 (spec-gaps.md에 기록)

## 참고 (이슈 아님)
- 이미 만든 `cover_letter` 초안의 제목 "자기소개서 (날짜)"와 이미 저장된 시작 인사는 바뀌지 않는다(함수 교체만). 지원 프로젝트 기본 이름 개정(DM 534 "이미 저장된 기본 이름은 바꾸지 않는다")과 같은 정책이라 수용
- DB 인사는 이름 뒤 조사를 항상 "을"로 붙이고(`'P1'을`) 화면 `projectGreeting`(`src/lib/data/career-v45-shared.ts:522`)은 받침에 따라 을/를을 고른다 — R12 이전부터 있던 차이로 R12 범위 밖
- `policy_versions` `effective_at`이 실제 원격 반영 시각보다 앞선 2026-11-05 00:00 KST로 소급돼 있다. 소급 자체는 화면 동작에 문제 없음(아래 스펙 차이 2번 참고)

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
1. QA-03 무료 등급 문장: UX v5.13 S-10 확정 문장 ↔ DB 인사 문장 불일치 (기획 확인 또는 db 수정)
2. 정책 개정 사전 고지: 처리방침 `policy-content.ts`·`docs/legal/privacy-policy.md:141` "바꾸면 시행 7일 전부터… 국외 이전처럼 중요한 변경은 30일 전에 알리고"인데, 2026-11-05판은 반영 즉시(소급) 시행됐고 국외 이전 고지 2026-11-05판은 Anthropic 처리 국가(추론 global)를 추가했다. 재동의는 AI 고지(`ai_disclosures` Claude 2행)로 받지만, 정책 문서 자체의 사전 고지 기간 규칙과 맞는지는 법무·기획 판단 필요. 코드 결함 아님
