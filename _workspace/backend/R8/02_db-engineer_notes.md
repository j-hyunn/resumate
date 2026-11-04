# R8 db-engineer 노트 — STAR 합친 제안 (RQ-5)

- 날짜: 2026-11-04
- 파괴적 변경: **없음** (함수 교체만, 데이터·스키마 변경 없음)
- 타입 재생성: 하지 않음 (시그니처 변경 없음)

## 파일
- `supabase/migrations/20261113000300_r8_star_merged_proposal.sql` — `private.wc_patch_star`만 교체(R5 `20261110000200_r5_structured_draft_patch_v4.sql` 정의를 바탕으로 수정). `public.apply_structured_draft_patch(uuid, jsonb) → jsonb { structured_draft, rejected }`, `private.apply_structured_draft_patch_impl`(security definer), 권한은 그대로.
- `supabase/tests/r8_star_merged_proposal.test.sql` — 신규 pgTAP
- `supabase/tests/structured_draft_patch.test.sql` — 기대값 1건 수정(적용 후 값 있는 컬럼에 AI set → op `set`), 라벨 2건 수정

## 동작 변경
| 경우 | R5 | R8 |
|------|----|----|
| AI `set`, 컬럼 값 있음 | op `append`로 낮춰 저장 | op **`set`** 저장 = 전체 교체 제안 |
| AI `set`, 미반영 제안 있음 | 값 교체 | 값 교체 (그대로, 이어 붙이지 않음) |
| AI `set`, 제안이 이미 반영됨(applied_at) 또는 `new_object` | 새 객체, rev+1 | 그대로 |
| AI `append` | 미반영 제안에 줄바꿈으로 이어 붙임, op는 컬럼 기준(값 있음→append, 없음→set) | **그대로** (과거 초안 호환) |
| protected_field(미반영 user_edit / accepted) | AI 거부 | 그대로 |
| 사용자 편집 `set` | op는 컬럼 기준(값 있음→append) | 컬럼 기준 그대로, **단 미반영 객체의 op가 `set`이고 값이 있으면 `set` 유지** |

- 사용자 편집 예외를 둔 이유: 합친 제안(op set, 전체 문장)을 사용자가 카드에서 고치면 R5 규칙으로는 op가 `append`로 바뀌어 화면이 전체 문장을 기존 값 뒤에 붙인다(중복). 계획서의 "사용자 경로 op 강제는 유지하되 합친 제안 교체와 충돌하지 않게"에 맞춘 최소 변경. 부수 영향: 빈 컬럼일 때 받은 set 제안을 반영하지 않은 채 사용자가 폼에 직접 값을 써 저장하고, 그 뒤 제안을 편집하면 R5에서는 append, R8에서는 set(교체)이 된다 — 화면은 원래도 그 제안을 set(교체)으로 보여 주던 상태라 일관적.
- 남겨 둔 호환 동작(참고): 값 있는 컬럼의 미반영 `set` 제안 위에 AI `append`가 오면 이어 붙이고 op는 `append`가 된다(R5 규칙 그대로). AI-12 v6은 append를 더 내지 않으므로 실제로는 생기지 않는 경로.

## 테스트 (`supabase test db`: 56 files, 2708 tests, PASS)
- 값 있는 컬럼에 AI set → 수락, op set, rev 1
- 같은 미반영 제안에 다시 set → 값 교체(이어 붙이지 않음), op set, rev 2, source_quotes는 새 것만
- `save_project_page`로 반영 후 set → 새 객체(op set, applied_at null, rev 3); `new_object` set → rev 4
- append(값 있는 컬럼) → 이어 붙임, op append, rev 2; append(빈 컬럼) → op set
- 사용자 편집: 미반영 set 제안 → op set 유지(origin user_edit), 미반영 append 제안(값 있는 컬럼) → append, 빈 컬럼 → set
- user_edit 미반영 객체는 AI 합친 set을 protected_field로 거부

## 적용
- 로컬: `supabase migration up --local`로 이 파일만 적용(리셋 없음). ~~원격 미적용.~~ 원격 적용 2026-11-04(사용자).
- 출시: UI의 [반영] 교체 처리와 같은 머지. db push 먼저.

## QA 1라운드 수정 (2026-11-04)

같은 마이그레이션 파일 `20261113000300_r8_star_merged_proposal.sql`을 고쳤다(어디에도 push 안 됨). 로컬 반영: 파일의 `private.wc_patch_star` 정의 부분만 psql로 로컬 DB(127.0.0.1:54322)에 다시 실행(리셋 없음, 원격 무관). 다음 `supabase db reset` 때는 수정된 파일 그대로 적용된다.

### QA-01 [Major] 합친 set 위의 append → op가 append로 바뀌던 문제
- 미반영 객체의 op가 `set`이면, AI `append`는 제안 값에 줄바꿈으로 이어 붙이되 op는 **`set` 유지**(전체 교체). 그 외 append 규칙(컬럼 기준)은 그대로.
- 테스트: `r8_star_merged_proposal.test.sql`에 케이스 추가(값 이어짐, op set, rev+1). `structured_draft_patch.test.sql`의 두 기대값(값 있는 컬럼 set→append 연쇄, 반영 후 set→append 연쇄)을 op `set`으로 수정.

### R8-QA-4 `review_reason` (STAR 필드 객체)
- 저장 키: **`review_reason`** (STAR 필드 객체 안, `review` 옆). 값: `existing_missing`(V-9j) | `content_unverified`(V-9e). 없으면 null로 읽는다(하위 호환).
- AI 패치 op에서 `review` 옆의 `review_reason`을 읽는다. 둘 이외 값·문자열 아님 → `invalid_patch`. null/없음 허용.
- 저장 규칙: 최종 review가 `needs_review`이고 이유가 있을 때만 키를 둔다(그 외엔 키 없음). needs_review 객체에 append가 오면 새 이유가 없을 때 기존 이유를 유지.
- 지움: accept → 키 제거, reject·clear·사용자 편집 → 객체를 새로 만들며 키 없음.
- 기간(project 섹션) 필드에도 값 검사는 하지만 저장은 STAR만.
- 타입: structured_draft는 jsonb라 `database.types.ts` 변경 없음 → 재생성 안 함. TS 쪽 draft 스키마(zod)에 `review_reason` 선택 필드 추가는 ai-pipeline-engineer/frontend 몫.
- 테스트: 저장, append 시 유지, 다른 이유로 교체, review ok면 미저장, 키 없음(하위 호환), 잘못된 값 invalid_patch, accept/user edit/reject 시 제거.

### pgTAP 결과
- 이번 변경 관련 파일(`r8_star_merged_proposal`, `structured_draft_patch`, `r5_structured_draft_patch`, `r5_page_save`, `writing_chats`) 모두 통과.
- 전체 실행에서 4개 파일 실패: `career_description`(65), `drafts`(149, 151), `evidence_links`(9), `jd_extraction`(95). 모두 전역 행 수를 세는 삭제/연쇄 검사로, 로컬 DB에 오늘 11:47에 생긴 실제 데이터(evidence_links 4행 등 — 로컬 스모크로 보임) 때문이다(evidence_links 기대 9, 실제 13 = +4). 이 RPC와 무관. 다른 사람의 로컬 데이터를 지우지 않으려고 리셋하지 않았다. 깨끗한 DB(`supabase db reset`)에서는 1차 실행 때처럼 전부 통과할 것으로 본다(확인은 리셋 후 필요).
