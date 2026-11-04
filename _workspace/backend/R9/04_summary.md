# R9 요약 — AI 패널·문서형 입력 백엔드 후속 (ui-panel-doc, UP-6·UP-9·UP-14)

- 상태: done (2026-11-04). QA 2라운드 — Critical 0 / Major 0, Minor 1 남음(QA-05).
- 마이그레이션·새 환경 변수 없음. 코드는 R8 + UI 개정(ui-panel-doc)과 같은 머지로 나간다(미커밋).

## 만든 것
- ★1 C-1.1 정규화(`src/server/ai/context-pack/deliverable-text.ts`): 편집기 백슬래시 이스케이프 되돌리기(오프셋은 원문 위치), `&lt;`만 `<`로, 표 `\|`·`<br>`·코드·링크·취소선·인용·자동 링크(글 유지) 처리. 검증 전용 `plainForValidation(md, mode)`.
- ★2 UP-14: AI-12 extract 프롬프트 `ai-12.extract.v7+common.v2` — 합친 `set`은 블록 서식 유지·인라인 강조 없음. extract 입력 STAR 값을 `<star_value>` 블록에 원문(들여쓰기 없이). V-3·V-9c/d/e/g/j·무변경 판정·`pendingInForm`은 평문 비교. 줄 앞 `N.`/`N)`는 1–2자리이고 목록을 이룰 때만 목록 번호(`findOrderedListMarkers`), 연도·3자리 이상·순서 밖은 본문 숫자.
- ☆3 분류 [무시] 서버 기억(DM 11.5 #1 후보 b, 마이그레이션 없음): `isDismissedClassification`(슬롯 있음 + 값 null + rev ≥ 2) — 프롬프트 입력에 "무시함 — 추천하지 않음", V-9i가 RPC 호출 전에 조용히 버림(`classification_dismissed` 카운트).
- pgTAP `supabase/tests/r9_classification_dismiss.test.sql`(25개): 분류 값이 있는 행의 분류 제안 반영 기록 → applied·값 교체, [무시] `set` null → `{value:null, origin:'ai', review:'ok', rev+1}`, 그 뒤 AI 패치를 RPC는 수락(그래서 필터는 파이프라인에서).
- 확인: 글자 수 셈 — DB `char_length`(코드 포인트) vs 화면 `.length`(UTF-16). 화면이 같거나 더 엄격해 DB 거부 없음(이모지 값은 화면이 더 일찍 막음). 그대로 둠, 맞추려면 UI 요청.
- 화면(리더, UI 소유 파일 — QA 지적 반영): 편집기 `trailingNode: false`(열기만 해도 값이 바뀌던 문제 QA-01), `highlightRange` `plainQuote` 이스케이프 처리(QA-04).

## 검사
- typecheck·lint 통과, vitest 130파일 2,244개 통과, pgTAP(로컬) 57파일 2,756개 통과.
- 로컬 스모크 SKIP — 요청 경로·deps 변경 없음, 로컬 BYOK 테스트 키 없음. 브라우저 확인 없음(헤드리스 TipTap 프로브로 대신).

## 남은 것
- QA-05 [Minor]: 턴 진행 중 [무시]하면 그 턴의 AI 추천이 RPC를 거쳐 슬롯을 다시 채울 수 있음(화면 localStorage가 숨김). 근본 해결 = RPC 가드(마이그레이션) — 다음 슬라이스 후보.
- `[가정]`(spec-gaps R9-AI-1~3): `&nbsp;` 줄 = 빈 줄, STAR 근거 저장 인용 = 평문 구간, 목록 번호 경계 2자리·혼자 있는 "1." = 목록.

## 파일
- `src/server/ai/context-pack/{deliverable-text,aliases,career-pack,writing-chat}.ts`, `prompts/AI-12/index.ts`, `pipelines/AI-12.ts`, `schemas/structured-draft.ts`, `validation/{v9,evidence}.ts` + 테스트
- `supabase/tests/r9_classification_dismiss.test.sql`
- (UI) `src/components/common/doc-markdown-editor.tsx`, `src/components/common/doc-inputs.tsx`
