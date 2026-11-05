# R12 QA 수정 — db-engineer 노트 (2026-11-05)

대상: `_workspace/backend/R12/03_backend-qa_report.md` QA-02, QA-03. 로컬에만 적용했다(`supabase migration up --local`, `db reset` 없음). 원격 프로젝트는 건드리지 않았다.

## 파일

| 파일 | 변경 |
|------|------|
| `supabase/migrations/20261113001400_r12_free_tier_greeting_copy.sql` | 새 파일(비파괴). `private.writing_chat_greeting`(AI-12)·`private.writing_chat_deliverable_greeting`(AI-13)을 `create or replace`. 본문은 각각 `20261113001300` §3, `20261110000100`과 같고 무료 등급 문장 한 줄만 다르다. 시그니처·권한(`revoke all … from public`) 그대로 |
| `supabase/tests/r12_ui36_followups.test.sql` | plan 9 → 21 (12건 추가) |
| `_workspace/backend/spec-gaps.md` | R12-QA-03 항목에 "처리됨" 기록(S4 ⑨도 닫힘) |

`database.types.ts`는 다시 만들지 않았다 — 바뀐 건 `private` 스키마 함수 본문뿐이고 시그니처 변화가 없다.

## QA-03 — 문장 교체

- 이전: ` 지금 연결된 AI는 무료 등급이라 입력한 내용이 공급자의 서비스 개선에 쓰일 수 있어요. 민감한 내용은 특히 조심해 주세요.`
- 이후: ` 무료 등급에서는 입력한 내용이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요.`

근거와 판단:
- UX v5.13 `02-user-flows.md` S-10 "+ 새 대화"(1453행)가 문장을 확정했고, S-44 시작 영역(1316행)은 "무료 등급 안내(S-10과 같은 문장)"이다.
- AI 명세 `03-ai-features.md` AI-12(770~775행)·AI-13(1043~1048행)은 문구를 정하지 않고 "최종 문구는 ux-planner" `[가정]`로 둔다. 서로 다른 문장이 아니므로 충돌이 없어 UX 문장을 따랐다.
- `{공급자}` = Google: R-OD-15 이후 이 문장은 Gemini 무료일 때만 붙는다(`writing_chat_free_tier`). 화면의 C-21 문구(`data-use-consent.tsx`)도 Google로 고정돼 있다.
- 끝에 마침표를 붙였다. 앞 문장(민감정보 안내)이 마침표로 끝나는 인사 본문이라서다. 화면 `freeTierGreetingLine`(`career-v45-shared.ts:494`)은 마침표 없이 따로 붙이는 한 줄이라 차이가 있지만 같은 문장이다. 화면은 저장된 인사에 "무료 등급"이 있으면 덧붙이지 않으므로(`ai-panel.tsx:397`) 중복되지 않는다.
- 이미 저장된 시작 인사(`writing_chat_messages`)는 바꾸지 않는다.

## QA-02 — 추가한 pgTAP

`r12_ui36_followups.test.sql`:
- `writing_chat_free_tier`: Gemini **유료** → false / Gemini 무료 키가 있지만 활성 공급자는 OpenAI 유료 → false(활성 공급자를 따른다)
- 문장 정확성: AI-12·AI-13 인사(`p_free_tier = true`)가 UX 문장으로 끝남 / 옛 문장 없음 / `p_free_tier = false`면 "무료 등급" 없음
- RPC 경유(저장된 sequence 1 인사): OpenAI 무료·Gemini 유료 사용자의 `start_writing_chat`·`start_deliverable_writing_chat` 인사에 "무료 등급" 없음(4건), Gemini 무료 사용자의 두 인사가 UX 문장으로 끝남(2건)

## 테스트 결과

- `supabase test db`: Files=59, Tests=2917, **PASS** (r12_ui36_followups 21/21)
- `pnpm vitest run src/server/services/writing-chat src/components/career/ai-panel src/lib/data/career-v45-shared.test.ts`: 7 files, 84 tests **passed** (`writing-chat.integration`·`deliverable-chat.integration` 포함)

## 원격 반영

원격 미적용. 다음 원격 반영 때 `20261113001400` 1개가 추가로 올라간다(비파괴, 함수 본문만).
