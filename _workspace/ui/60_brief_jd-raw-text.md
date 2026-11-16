# 60 런 브리프 — 채용 공고 원문 전환 화면 개정 (jd-raw-text U1~U9)

- 날짜: 2026-11-16 · 브랜치 `claude/jd-raw-text-ui` (베이스 = 백엔드 PR #78 `claude/jd-raw-text-backend-610f7b`, `e19f513`)
- 요청: 사용자 결정 2026-11-14 "채용 공고는 AI 부분 필요 없어. 원문 텍스트 그대로만 사용" — 기획 PR #77, 백엔드 PR #78 뒤 화면 개정.
- 기준 기획 (이 브랜치의 `docs/planning/`은 옛 판이다 — **반드시 기획 브랜치에서 읽는다**):
  - `git show origin/claude/jd-raw-text-planning-6b673b:docs/planning/decisions.md` → 4.24 "UI" 표 1~9
  - `git show origin/claude/jd-raw-text-planning-6b673b:docs/planning/02-user-flows.md` → 5.1o, 그리고 본문 S-14·S-15·S-16·S-46·S-24 ②·S-42·C-01·C-03·C-05·C-11·C-15·C-18·C-19·C-20의 `(v5.21, JR-…)` 표시 문장
  - PRD v4.18 · UX v5.21 · AI v4.16 · DM v4.16
- 백엔드 계약: #78 그대로. **바꾸지 않는다**(`src/server/`, `src/app/api/`, `src/lib/contracts/`, `supabase/`, `src/types/database.types.ts`). 어긋나면 `_workspace/ui/60_contract-gaps.md`에 기록.
  - 계약 변화 요약·UI 요청 U1~U9: `_workspace/backend/R17/02_api_notes.md` "정렬 (2026-11-16)" 절(177행~), 요약 `_workspace/backend/R17/04_summary.md`
  - `src/lib/data/*`는 화면이 쓰는 데이터 계층 — mock 분기·타입 정리(U9)는 UI 범위. real 분기의 계약 호출은 유지.

## 범위 (화면 ID별)

| U | 4.24 UI # | 화면 | 핵심 |
|---|-----------|------|------|
| U1 | 1 | S-14 추가 모달 | 마감일 칸(일 단위, 포지션 아래), 직접 입력이면 [다음]이 서버 요청 없이 ②로, AI 미리 채우기·추출 로딩(`extracting`/`extract-failed`)·"요건 n개"·`previewJobId`·form-draft 미리 보기 키 삭제, AI 연결 시 [자기소개서 작성] 위 "인사이트를 자동으로 만들어요" 안내 줄(C-19), `jd_no_sentences` 문구 |
| U2 | 2 | S-46 채용 공고 탭(S-15) | 요건 목록 열·`JdLockedNotice`·`raw-has-requirements` 삭제, `raw_text` + `sentences` 오프셋 하이라이트(`?tab=jd&s=S3,S4`), [공고 내용 수정] 늘 보임, `rawTextLockedReason = job_in_progress`면 비활성 + "인사이트를 만드는 중에는 수정할 수 없어요", 거부 코드 `jd_no_sentences`·`jd_job_in_progress`·`jd_raw_text_unchanged` |
| U3 | 3 | S-46 인사이트 탭(S-16) | 판정 표 = `requirementText` + "공고 원문" 링크(`sentenceIds` 전체 강조), 카테고리·핵심 배지 삭제, "임시 상태" 줄, 자동 시작 진행·완료 토스트·실패 다시 시도, `schemaVersion = 1` → "공고 처리 방식이 바뀌어 다시 만들어야 해요" + [다시 생성](본문 없음), `staleReasons.rawText` → "공고가 바뀌었어요 — 다시 생성", rawText stale이면 `jd_sentence` 칩 강조 안 함, `extractFirst`·`not_a_jd` 경로 정리 |
| U4 | 4 | S-46 작성 | [자기소개서 작성 시작] = 검증 → 저장만, "AI가 읽는 내용" = 커리어 + 최신 인사이트 + 대화(공고 원문 없음), 인사이트 없음/만드는 중 안내 줄, 제안 카드·근거 칩에 공고 출처 없음 |
| U5 | 5 | C-01·C-11·C-15 근거 칩 | `REQ`/`jd_requirement` 칩 삭제(`question-proposal-card.tsx` 포함), `jd_sentence` "공고 원문" 칩은 인사이트에서만 |
| U6 | 6 | C-03·C-20 | 인사이트 `prepare` "준비 중" → `match` "요건별로 내 커리어와 맞춰 보는 중"(처리 단위 없음), AI-01 진행 문구·`ai-progress.tsx` `jd_extraction` 삭제, C-20 `not_a_jd`·요건 추출 행 삭제(dev 갤러리 포함) |
| U7 | 7 | C-18·C-05·S-16→S-10 | "요건 정리하기" 진입점, `AI_FEATURE_NAMES` "요건 정리" 삭제, C-05 "JD·요건" → "공고", S-10 "관련 요건" 줄을 `insight_id`·`insight_item_key`로(또는 `jd_requirements` 읽기 제거) |
| U8 | 8 | S-24 ②·S-42 사용량 표 | 기본 4행 + 과거 기록이 있는 달만 맨 아래 "JD 요건 추출(종료)" |
| U9 | 9 | 데이터 계층 mock·타입 | `MockDb.jd_requirements`·`next_jd_extraction_failure`·`jd_extraction` 견본, `JdRequirement`·`getJdRequirement`, fetch `companyName`·`positionTitle`, mock 생성 자동 시작 흉내, `?state=` 키 정리 |

## 검증
- ui-qa: lint·typecheck·test·build + 스펙 대조(Q1–Q7·Q11).
- 브라우저: 로컬 Supabase(127.0.0.1:54321, 실행 중) + `pnpm dev`로 S-14 생성 → S-46 공고 탭 수정·잠금 → 인사이트 탭, 사용량 표.
