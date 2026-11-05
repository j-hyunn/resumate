# R12 요약 — UI 36·37 런 백엔드 요청 (2026-11-05)

- 근거: spec-gaps UI36-6·UI36-10, decisions.md 4.13(U36-2·U36-5·U36-6), AI v4.11 C-7.1 R-OD-15
- 규모가 작아 리더가 직접 구현했다(팀 미구성). QA 에이전트는 돌리지 않았고 검사 스크립트만 직접 실행했다.

## 만든 것
- 마이그레이션 `20261113001300_r12_ui36_followups.sql` (비파괴 — insert와 함수 본문만)
  1. `policy_versions` 2026-11-05 행 3개(`terms`·`privacy`·`cross_border_transfer`, `requires_reconsent = false`)
  2. `private.draft_default_title`: cover_letter 기본 제목 "자소서 문항 답변 (YYYY-MM-DD)"
  3. `private.writing_chat_greeting`: 게이트 줄의 cover_letter 이름 "자소서 문항 답변을"(그 밖은 20261109100800 본문 그대로)
  4. `private.writing_chat_free_tier`: Gemini 무료만 true(R-OD-15) — 시작 인사의 무료 등급 문장이 OpenAI·Claude 무료 키에도 붙던 것을 고침(요청 밖에서 찾은 버그)
- `src/server/ai/prompts/AI-12/index.ts` `GATE_FEATURE_LABEL.cover_letter` = "자소서 문항 답변". 프롬프트 템플릿이 아니라 입력 값이 바뀐 것이라 `prompt_version`은 그대로 두었다 `[가정]`
- pgTAP: 새 `r12_ui36_followups.test.sql`(9건). 기존 테스트에 박혀 있던 현재 정책 버전 문자열(`consents`·`signup_consent_ai_gate`·`account_deletion`·`policy_versions` 개수)과 drafts의 기본 제목 기대값을 갱신했다

## 검사
- 로컬 `supabase migration up`(공유 스택이라 reset 안 함)을 실행하고 `supabase test db`를 돌렸다. 59 파일, 2905건 PASS
- typecheck·lint 0건, vitest 146 파일 2381건 통과, build 통과
- local smoke(라우트 실호출)와 원격 반영은 하지 않았다

## 원격 반영 시
- R11(`20261113000500`~`001200`) 다음 순서로 `20261113001300`. 비파괴 마이그레이션이다
- 적용하면 S-30에 2026-11-05판이 보인다. 재동의는 없다
- 이미 만든 대화의 시작 인사(저장된 메시지)는 바뀌지 않는다. 새 대화부터 적용된다
