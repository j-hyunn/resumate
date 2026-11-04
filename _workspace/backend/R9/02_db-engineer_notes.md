# R9 db-engineer 노트 (2026-11-04)

범위: 계획 4·5. **마이그레이션 없음, 스키마·RPC·타입 변경 없음** (`database.types.ts` 재생성 불필요).

## 4. pgTAP — `supabase/tests/r9_classification_dismiss.test.sql` (25개)

대상 RPC(현재 정의 그대로):
- `public.apply_structured_draft_patch(uuid, jsonb) → { structured_draft, rejected }` → `private.wc_patch_star` (20261113000300_r8_star_merged_proposal.sql)
- `public.save_project_page(p_project_id uuid, p_values jsonb, p_expected_updated_at timestamptz default null, p_applied_proposals jsonb default null) → { project_id, status, updated_at, applied, skipped }` (20261110000400_r5_page_save_rpcs.sql) → `private.wc_mark_proposal_applied` (20261110000300)

고정한 동작:

| 케이스 | 결과 |
|------|------|
| DB 행에 `project_type`·`experience_type`·`competencies` 값이 이미 있는데 AI 분류 제안 `set` | 수락(`rejected: []`) — "빈 칸에만"은 앱(폼 스냅샷) 판정, DB는 값 필터만(V-9i) |
| AI가 분류 슬롯에 `null` `set` | `invalid_value`로 거절, 슬롯 그대로 → **분류 슬롯의 `value: null`은 사용자 비우기로만 생김** (☆3 판정 전제 확인) |
| **(a)** `save_project_page`로 `project_type`·`competencies` 덮어쓰기 + 제안 반영 기록(rev 1) | `applied`에 두 항목, `skipped: []`, 행 값 교체(`improvement → new_build`, `{analysis} → {planning,leadership}`), 슬롯 `applied_at` 기록, rev 불변, `source_writing_chat_id` = 그 대화 |
| 반영된 분류 슬롯을 사용자가 `set` null | 예외 `field_already_applied` ([무시]는 미반영 제안에만) |
| **(b)** 미반영 제안 슬롯을 사용자 `set` null ([무시]) | `{value: null, origin: 'ai', source_message_ids: [], reason: null, review: 'ok', reviewed_at: now(), applied_at: null, rev: 2}` — 저장된 행 값(`experience_type`)은 안 바뀜 |
| 비운 슬롯을 저장 시 반영 기록(rev 2) | `skipped` `not_found` |
| 제안이 없던(슬롯 없음) 필드를 사용자 `set` null | no-op — 슬롯 객체가 생기지 않음(따라서 "무시함" 표시도 안 남음) |
| 비운 슬롯을 다시 `set` null | 수락, rev + 1 (3) |
| **(b) 이후** 무시한 슬롯에 AI 분류 제안 | **RPC는 오늘 수락함** (`rejected: []`) — 슬롯이 `{value: 'collaboration', origin: 'ai', ..., rev: 4}`로 덮여 "무시함" 표시가 사라짐. 서버 파이프라인(V-9i, ☆3)이 RPC 호출 전에 버려야 함 |

ai-pipeline-engineer 참고: `isDismissedClassification(slot)` = 슬롯 객체 존재 && `value === null` && `rev ≥ 2` 조건은 DB 동작과 맞음(AI null 경로 없음, 사용자 reject는 분류에 적용 안 됨 — 분류는 항상 `review: ok`라 `invalid_review_transition`). 한 번이라도 파이프라인이 그 슬롯에 패치를 보내면 DB가 표시를 덮어쓰므로 필터는 패치 전에 있어야 함.

결과: `supabase test db`(로컬) 전체 57파일 2,756개 **PASS**.

## 5. 글자 수 셈 단위 (화면 UTF-16 vs DB 코드 포인트)

DB 쪽(전부 `char_length` = 코드 포인트, DB 인코딩 UTF8):
- `projects_{situation,task,action,result,learnings}_check` ≤ 2000 (20261109100300), `project_details_*` 동일
- `project_deliverables_body_check` ≤ 20000 (20261109100500)
- RPC: `save_project_page` STAR `char_length > 2000 → field_too_long`, 산출물 저장 `char_length(v_body) > 20000`, `wc_value_ok` / `wc_patch_star` AI 제안 `char_length ≤ 2000`, 산출물 초안 블록 ≤ 8000, 메시지 `writing_chat_messages_content_check` ≤ 4000

화면·서버 TS 쪽(전부 `.length` = UTF-16 코드 유닛):
- `PAGE_LIMITS.star 2000 / deliverableBody 20000 / messageMaxChars 4000` (`src/lib/data/career-v45-shared.ts`)
- `project-page.tsx:117`, `deliverable-page.tsx:130·147`, `star-proposal-fill.ts:128`, `deliverable/draft-fill.ts:88`, `form-parts.tsx:166` + `<Textarea maxLength>`(브라우저 maxlength도 코드 유닛), `doc-markdown-editor.tsx` `mdLength`(마크다운 직렬화 `.length`), `use-ai-panel.ts:647`
- 서버 계약 `src/lib/contracts/writing-chat.ts:218` (`v.value.length > 2000`), AI zod `z.string().max()`

실측(로컬): `'😀'` → JS 2 / PG 1, `'👨‍👩‍👧'` → JS 8 / PG 5, `'😀'.repeat(1001)` → JS 2002 / PG 1001. 한글(완성형·NFD 모두 BMP)·영문은 양쪽 같음.

판정:
- **화면 통과 → DB 거부: 없음.** UTF-16 길이 ≥ 코드 포인트 수라 화면이 항상 같거나 더 엄격함. 이모지가 든 값에서 DB 오류가 나는 경로는 없다.
- **DB 통과 → 화면 거부: 있음.** 예) STAR에 `😀` 1,001개(코드 포인트 1,001 / UTF-16 2,002)
  - AI 제안 경로: `wc_patch_star`는 수락해 저장하지만 화면 [반영]은 `star-proposal-fill`에서 `too_long` 스킵.
  - 직접 입력: 화면 `maxLength`가 2,000 코드 유닛에서 막음(DB 한도까지 못 씀).
  - 과거·외부 데이터: DB에 위 값이 있으면 페이지를 열자마자 한도 초과 오류, 줄이기 전에는 저장 불가.
- 실제 영향: 경력 문장에 이모지가 수백 개 들어가는 경우만이라 낮음. 데이터 손상·저장 실패(DB 오류) 위험은 없음.

권고: **DB(코드 포인트)를 정본으로 두고, 맞출 거면 화면·TS 쪽을 코드 포인트로 맞춘다** (UI 요청). 이유: 기획 DM의 "2,000자"가 이미 DB `char_length`로 구현돼 있고, DB를 UTF-16(`octet_length` 아님 — PG에 UTF-16 셈 함수 없음)으로 바꾸려면 CHECK 교체 마이그레이션 + 기존 행이 위반될 수 있음. 화면 쪽 변경 범위: 공용 `charCount(s) = Array.from(s).length` 헬퍼 → 위 화면 파일·`mdLength`·네이티브 `maxLength` 제거(커스텀 차단으로 대체)·`writing-chat.ts:218`. 다만 현 상태도 안전한 방향(화면이 더 엄격)이라 **우선순위 낮음 — 지금은 그대로 두어도 됨**. 참고로 두 방식 모두 "보이는 글자"(그래핌)와는 다름(가족 이모지 1개 = 5 코드 포인트).

## 변경 파일
- 추가: `supabase/tests/r9_classification_dismiss.test.sql`
- 추가: `_workspace/backend/R9/02_db-engineer_notes.md`
- 마이그레이션·타입·spec-gaps: 변경 없음. 커밋하지 않음.
