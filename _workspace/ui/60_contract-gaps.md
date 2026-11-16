# 60 런 계약 대조 메모 — 채용 공고 원문 전환 (jd-raw-text U1~U9)

- 작성: frontend-engineer, 2026-11-16 · 기준 계약: 백엔드 PR #78 (`_workspace/backend/R17/02_api_notes.md` "정렬 (2026-11-16)")
- 결론: **막힌 계약 없음.** 화면은 #78 계약을 그대로 썼고 `src/server/`·`src/app/api/`·`src/lib/contracts/`·`supabase/`·`database.types.ts`는 건드리지 않았다. 아래는 화면이 계약을 **어떻게 읽었는지**와 백엔드가 알아 두면 좋은 점이다(요청 아님, 확인용).

| # | 화면 | 읽은 방식 | 메모 |
|---|------|-----------|------|
| G-1 | S-16 `staleReasons.rawText` | 화면의 인사이트 읽기(`getInsightState`)는 `staleReasons`를 돌려주지 않는다. 대신 이미 읽는 두 행의 컬럼을 비교한다 — 최신 인사이트 `insights.raw_text_hash` ≠ JD `job_descriptions.raw_text_hash` (`getJobDescription`이 행 전체를 돌려준다). DM v4.16 판정과 같은 규칙(해시 비교, 되돌리면 false) | 서버 판정 규칙이 바뀌면(예: 해시가 아니라 다른 신호) 화면도 바꿔야 한다. 그때는 `getInsightState`가 `stale_reasons`를 실어 주는 쪽이 안전하다 — 지금은 요청하지 않는다 |
| G-2 | S-16 `schemaVersion = 1` | `insights.schema_version`(행 컬럼) — real `normalizeInsightResult`가 schema 1 본문을 빈 목록으로 돌려주므로 화면은 `schema_version === 1`이면 본문·근거를 읽지 않고 "다시 만들어야 해요"만 그린다 | 없음 |
| G-3 | C-01 `jd_sentence` 칩 (rawText stale) | 서버 QA-06 처리(`services/insight/read.ts` `withRawTextStale`)는 화면 경로(`lib/data/evidence` → `loadEvidenceRows` + `toEvidenceView`)를 지나지 않는다. 화면이 S-16 안에서 같은 규칙을 적용한다 — stale이면 `jd_sentence` 칩 `status = "changed"`(삭제됨이면 그대로) + 강조 없는 `?tab=jd` 링크 | 두 곳에 같은 규칙이 있다. 근거 칩 읽기를 인사이트 서비스 쪽으로 옮길 때 화면 덮어쓰기를 지우면 된다 |
| G-4 | C-01 `jd_sentence` 칩 링크 | `evidence_links.source_locator.sid` → `?tab=jd&s={sid}` (`lib/data/evidence.ts` resolve) | `source_locator`가 `{sid}`가 아닌 모양이면 강조 없이 탭만 연다 |
| G-5 | S-16 생성 `jd_no_sentences`(409) | `startInsightAction`(UI 액션)이 `AppError("jd_no_sentences")`를 `{ refused: "jd_no_sentences" }` 값으로 바꿔 돌려준다(Server Action 경계에서 code가 사라지므로). S-14 생성의 400도 같은 방식 | 없음 |
| G-6 | S-46 시작 인사 | 패널의 로컬 인사(행 없는 시작 영역)는 "모아 둔 커리어와 인사이트로 초안을 제안해 드려요"로 바꿨다 `[UI-가정]`. 대화 행이 생기면 서버 인사(`private.writing_chat_document_greeting`, 3종)가 보인다 | 서버 인사 문구가 아직 "공고 요건"을 말하면 두 문구가 어긋난다 — 백엔드 확인 권장 |
| G-7 | 데이터 계층 이름 | `updateFailedJdRawText`·`updateFailedJdRawTextAction`(R17b-api-8)을 `updateJdRawText`·`updateJdRawTextAction`으로 **이름만** 바꿨다(같은 계약 `applicationActions.updateJdRawText`). `w3.integration.test.ts`도 같이 바꿨다 | 백엔드 쪽 문서·노트에 옛 이름이 남아 있으면 정리 |
