# UI QA — 채용 공고 원문 전환 (jd-raw-text U1~U9, 런 60 미커밋 변경) (라운드 1)

- 작성: ui-qa, 2026-11-16 · 브랜치 `claude/jd-raw-text-ui`(미커밋 63파일 + 신규 3파일)
- 기준: decisions 4.24 UI #1~9, UX v5.21 5.1o + 본문 `(v5.21, JR-…)` — **기획 브랜치 `origin/claude/jd-raw-text-planning-6b673b`에서 읽음**. 백엔드 계약 PR #78 (`_workspace/backend/R17/02_api_notes.md` "정렬 (2026-11-16)")
- 입력: `_workspace/ui/60_brief_jd-raw-text.md`, `60_frontend-engineer_jd-raw-text_report.md`, `60_contract-gaps.md`
- 이슈 번호: 요청은 `UQ-6xx`였으나 UQ-600~613은 17 라운드(`17_ui-qa_q53_review.md`)에서 이미 썼다. ID를 다시 쓰지 않으려고 **UQ-614부터** 매겼다.

## 요약 — Critical 0 / Major 1 / Minor 7

- 기계 검사: lint 0 · typecheck 0 · vitest **159 파일 / 2665 테스트 전부 통과**(로컬 Supabase, 통합 포함) · build 성공.
- `fetch.redos.test.ts`: 이번 전체 실행에서는 통과. 단독으로 4번 돌려 1번 실패(시간 상한), 3번 통과(머신 부하 평균 4.9). **시간에 기대는 불안정 테스트로 판정**한다. 백엔드 소유이고 이번 변경과 관계없다(`src/server/` 변경 0).
- 백엔드 소유 경로(`src/server/`, `src/app/api/`, `src/lib/contracts/`, `supabase/`, `src/types/database.types.ts`)는 **건드리지 않았다**(`git status` 0건).
- #78 계약 호출(real 분기) 확인 결과 모두 맞다: 생성 → `insightJobId`·`insightSkipReason` 통과, `updateJdRawText` 거부 코드 3종 매핑, `rawTextLockedReason`, 인사이트 `schemaVersion`. 통합 테스트 `w3.integration.test.ts`가 실제 Server Action 경로로 확인한다.
- **rawText stale 판정**: 화면은 `staleReasons.rawText`를 읽지 않고 인사이트 `raw_text_hash`와 JD `raw_text_hash`를 직접 비교한다. 서버 판정(`services/insight/read.ts:361` `row.raw_text_hash !== currentRawTextHash`)과 **같은 규칙이라 맞다고 판정한다**. 화면에만 있는 `!!latest.raw_text_hash` 조건은 ready 행의 CHECK(`insights_ready_check`가 `raw_text_hash is not null`을 요구, 마이그레이션 `…r17_jd_raw_text_cleanup.sql:166-171`) 때문에 실제로 차이를 만들지 않는다. 규칙이 두 곳에 있는 점은 G-1·G-3에 이미 적혀 있으니 이슈로 올리지 않는다(백엔드가 판정 규칙을 바꾸면 화면도 같이 고쳐야 한다).
- 남은 `jd_requirement`/REQ/`not_a_jd`/추출 화면: **없다.** 남은 것은 과거 CHECK 값을 그대로 옮긴 거울, 과거 행 필터, 주석, 약관 본문뿐이다(보고서 표와 같다).
- 주된 결함: 같은 페이지 안에서 탭을 누른 뒤 "공고 원문" 링크나 근거 칩을 **두 번째로** 누르면 채용 공고 탭으로 넘어가지 않고 강조도 다시 걸리지 않는다(UQ-614, Major).
- 브라우저 확인(Q12): **미확인.** gated 경로는 Google OAuth 로그인이 필요하고, 이 환경에는 로컬 테스트 로그인 수단이 없다. 그래서 모든 화면은 `QA 통과 (mock·브라우저 미확인)` 기준이다.

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | Q11 | Q12 |
|---------|----|----|------|----|----|----|----|----|-----|-----|-----|
| S-14 추가 모달 (U1) | ✅ | ⚠️ UQ-619 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ UQ-618 | ✅ | ✅ | 미확인 |
| S-46 채용 공고 탭 / S-15 (U2) | ⚠️ UQ-614 | ✅ | ✅ | ⚠️ UQ-614 | ✅ | — | ✅ | ⚠️ UQ-620 | ⚠️ UQ-621 | ✅ | 미확인 |
| S-46 인사이트 탭 / S-16 (U3) | ✅ | ✅ | ✅ | ⚠️ UQ-614 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-46 문항 설정·작성 (U4) | ⚠️ UQ-615 | ⚠️ UQ-616 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-16 → S-10 보완점 진입 (U7) | ✅ | — | ✅ | ✅ | — | — | ✅ | ✅ | — | ✅ | 미확인 |
| C-01·C-11·C-15 근거 칩 (U5) | ✅ | ✅ | ✅ | ⚠️ UQ-614 | ✅ | — | ✅ | ✅ | — | ✅ | 미확인 |
| C-03 진행 (U6) | ✅ | ⚠️ 기획 A | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ | 미확인 |
| C-05 삭제 영향 줄 (U7) | ✅ | ✅ | — | — | — | — | ✅ | ✅ | — | ✅ | 미확인 |
| C-18 잠금 (U7) | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ✅ | — | — | 미확인 |
| C-19 배지 (S-14 자리) | ✅ | ✅ | — | — | ✅ | — | ✅ | ✅ | ✅ | — | 미확인 |
| C-20 오류 안내 (U6) | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | 미확인 |
| S-24 ② / S-42 사용량 표 (U8) | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ✅ | ✅ | ✅ | 미확인 |
| 데이터 계층 mock·타입 (U9) | — | — | ✅ | — | ✅ | — | — | — | — | ✅ | — |
| 공통 (주석·남은 상수) | — | ⚠️ UQ-616 | — | — | — | — | — | — | — | — | — |

**Q6 `?state=` 대조 (요청 항목)**

| 요청 상태 | 키 | 결과 |
|-----------|----|------|
| 잠금(인사이트 진행 중) | S-15 `raw-locked`, 저장 거부 `raw-save-refused` | ✅ 버튼 비활성 + "인사이트를 만드는 중에는 수정할 수 없어요"(`jd-tab.tsx:46-47`, `jd-raw-edit.tsx:167-177`) |
| schema 1 | S-16 `schema-v1` | ✅ 본문·근거 없이 "공고 처리 방식이 바뀌어 다시 만들어야 해요" + [다시 생성](`insight-view.tsx:271-280`, 근거 읽기 생략 `insight-tab.tsx:58`) |
| rawText stale | S-16 `raw-text-stale` | ✅ "공고가 바뀌었어요 — 다시 생성" + `jd_sentence` 칩 "변경됨"·강조 없는 링크 + 요건 행 링크도 강조 없음(`insight-tab.tsx:56-59`, `:106-117`, `insight-view.tsx:534-536`) |
| 자동 시작 진행 | 문항 설정 `questions-insight-generating`, 패널 `insight-generating`, 탭 `ai-pending` | ✅ 탭은 진행 중 작업이 있으면 C-03으로 연다(`insight-view.tsx:108-110`). 완료 토스트는 셸 `AiJobWatcher` |
| `jd_no_sentences` | S-14 `jd-no-sentences`, S-15 `raw-save-no-sentences`, S-16 `jd-no-sentences` | ✅ 세 곳 모두 같은 문구 `JD_NO_SENTENCES_MESSAGE`. S-16은 "공고 원문 고치기"까지 보인다 |
| 삭제된 키 | `extracting`·`extract-failed*`·`raw-has-requirements`·`wait-jd`·`key-invalid`(S-14) 등 | ✅ 코드·갤러리 어디에도 남아 있지 않다 |

## 브라우저 확인

- 하지 못했다. gated 화면은 Google OAuth 로그인 뒤에만 열리고, 로컬 Supabase에 쓸 수 있는 테스트 로그인 수단(시드 계정이나 비밀번호 로그인)이 이 환경에 없다. 프로덕션 빌드는 `?state=`를 끈다(엔지니어 보고와 같다). SSR HTML은 브라우저 확인으로 치지 않는다.
- 사람이 확인할 흐름: S-14 생성(마감일 입력·비우기, AI 연결 안내 줄) → S-46 문항 설정 "만드는 중" 줄 → 인사이트 탭 진행 → 완료 토스트 → 요건 행 "공고 원문" 링크 → 인사이트 탭 → **다른 요건 행 "공고 원문"**(UQ-614 재현) → [공고 내용 수정] 잠금/저장 → 인사이트 "공고가 바뀌었어요" → S-24 ② 사용량 표.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-614 | **Major** | frontend-engineer (A3) | S-46 탭 전환 · S-15 하이라이트 · S-16 "공고 원문" · C-01 `jd_sentence` 칩 | 02 S-15 "문장 하이라이트" — 칩·링크에서 오면 "그 문장들을 강조하고 첫 문장으로 스크롤 … **다른 칩에서 오면 새 강조로 바뀐다**", C-01 "원본으로 이동" | `src/components/applications/cover-letter/cover-letter-screen.tsx:241-245`(`seenInitialTab` 비교), `:246-258`(`changeTab`이 `history.replaceState`만 하고 서버 props는 그대로), `src/components/applications/jd-view.tsx:49`·`:55`(`active.key` 비교) | 칩이나 링크를 누를 때마다 채용 공고 탭이 열리고 그 문장들이 강조된다 | 탭은 `forceMount`로 계속 마운트되어 있고, 탭을 누르는 동작은 서버 props를 바꾸지 않는다. 그래서 (1) 서버가 마지막으로 그린 탭이 이미 `jd`이면(예: 첫 "공고 원문" 링크로 jd → 인사이트 탭 클릭 → 두 번째 "공고 원문" 링크) 새 `initialTab`도 `"jd"`라서 `setTab`이 불리지 않는다. 주소는 `?tab=jd&s=…`인데 화면은 인사이트 탭에 남는다. (2) 같은 칩을 다시 누르면(jd 탭을 떠날 때 강조가 지워졌는데 `s` 값이 같음) `active.key === key`라서 강조가 되살아나지 않는다. 요건을 여러 개 비교하는 흔한 흐름에서 두 번째 클릭부터 아무 일도 일어나지 않는다. 고칠 방향: 내비게이션마다 바뀌는 값(예: `useSearchParams()`의 `tab`·`s`)에 맞춰 동기화하거나, 링크 클릭을 `changeTab("jd")` + 강조 갱신 이벤트로 처리한다 |
| UQ-615 | Minor | frontend-engineer (A3) | S-46 작성 상태 패널 시작 영역 | 02 S-46 시작 영역 "(v5.21, JR-5) **이 자기소개서에 완료된 인사이트가 없으면** '인사이트가 있으면 공고에 맞춘 답을 쓸 수 있어요'", 4.24 #19 "AI-04 … 최신 ready 인사이트(`schema_version = 2`)" | `src/app/(page)/(gated)/applications/[id]/cover-letter/page.tsx:75-84`, `src/lib/data/applications.ts:75-79`(`insight_state`는 스키마를 보지 않음) | ready 인사이트가 schema 1뿐이면 AI-04는 인사이트를 읽지 않으므로 "없음" 안내가 보인다 | schema 1 ready 행이 있으면 `insight_state = "ready"` → 안내 줄이 없다. 마이그레이션 뒤 기존 사용자는 모두 이 상태라 "인사이트가 있다"고 오해할 수 있다 |
| UQ-616 | Minor | frontend-engineer (A3) | S-46 자소서 탭 "안내 1줄" | 02 S-46 자소서 탭 "안내 1줄" — "문항 답변은 모아 둔 커리어와 **인사이트를 바탕으로** 써요. 지어낸 경험·수치는 넣지 않아요" (v5.21, JR-5) | `src/lib/data/cover-letter-copy.ts:91` | 상수 문구가 v5.21과 같거나, 쓰이지 않으면 지운다 | `ANSWER_NOTE = "…커리어와 **공고 요건을 근거로** 써요…"` 그대로다. 지금은 화면에 그려지지 않지만(`tab-copy.test.ts:15`이 쓰지 않음을 단정) 옛 문구가 상수로 남아 있다. 다시 쓰이면 바로 틀린 문구가 나온다 |
| UQ-617 | Minor | frontend-engineer (A3) | S-14 ② 자동 시작 안내 줄 | 02 S-14 [자기소개서 작성] "AI가 연결돼 있으면 … 버튼 위 한 줄 … C-19 배지", S-16 "자동으로 시작하지 않는 경우 … 데이터 최소 기준 미달 → C-09" | `src/components/applications/add-application-dialog.tsx:92`, `:398-405` | (스펙 그대로라면) 연결만 본다 — 아래 기획 B 참고 | 연결돼 있지만 D-01 미달(서버 `insufficient_data`)인 사용자에게도 "만들면 인사이트를 바로 만들기 시작해요"가 보이는데 실제로는 시작되지 않는다. 스펙 문면과는 맞으므로 Minor, 판단은 기획 B |
| UQ-618 | Minor | frontend-engineer (A3) | S-14 마감일 "비우기" | design-system 7 포커스 관리(누른 컨트롤이 사라지면 포커스를 옮긴다 — UQ-746과 같은 규칙) | `src/components/applications/add-application-dialog.tsx:325-329` (S-46 머리 `cover-letter-screen.tsx:559`도 같은 모양) | × "마감일 비우기"를 누르면 포커스가 날짜 칸으로 간다 | 누르면 버튼이 사라지고 포커스가 다이얼로그 본문으로 떨어진다. 키보드·낭독기 사용자가 위치를 잃는다 |
| UQ-619 | Minor | frontend-engineer (A3) | S-14 ② 공고 원문 안내 | 02 S-14 "공고 원문 안내 — ②의 **공고 내용 칸 아래** '만든 뒤에도 채용 공고 탭에서 공고 내용을 고칠 수 있어요'" | `src/components/applications/add-application-dialog.tsx:379-383` (`sr-only … group-focus-within/raw:not-sr-only`) | 칸 아래에 늘 보인다 | 공고 칸에 포커스가 있을 때만 보인다(`[UI-가정]` "시안에 상시 보조 문구 없음"). 스펙 표시 조건을 좁힌 것이라 Minor. 시안이 우선이라면 리더가 스펙 쪽 정리를 판단 |
| UQ-620 | Minor | frontend-engineer (A3) | S-15 문장 하이라이트 접근성 | design-system 7 (상태 변화 알림·live region), 02 S-15 "그 문장들을 강조하고 첫 문장으로 스크롤" | `src/components/applications/jd-view.tsx:63-67`(스크롤만), `:117`(`<mark>`) | 낭독기 사용자도 강조된 문장이 어디서 시작하는지 알 수 있다(첫 강조 문장에 포커스를 주거나 "강조한 문장 n개" 상태 알림) | 화면만 스크롤되고 포커스·알림이 없다. `<mark>`는 대부분의 낭독기가 읽지 않는다. 칩에서 넘어온 낭독기 사용자는 문장 위치를 모른다 |
| UQ-621 | Minor | frontend-engineer (A3) | S-15 하이라이트 보기, 좁은 화면 | L-02 좁은 화면 규칙(가로 스크롤 없음) | `src/components/applications/jd-view.tsx:103` (`whitespace-pre-wrap`, `break-words` 없음) | 긴 URL이나 공백 없는 토큰도 줄바꿈된다 | 강조 모드는 마크다운 편집기 대신 일반 `<p>`로 그리는데, 공고 원문에 흔한 긴 URL이 좁은 화면에서 넘칠 수 있다(코드로만 확인) |

## 기획 확인 필요

| # | 화면 | 내용 (양쪽 인용) | 구현 |
|---|------|------------------|------|
| A | C-03 | decisions 4.24 UI #6: `match` **"요건별로 내 커리어와 맞춰 보는 중"** ↔ UX v5.21 C-03 단계 문구·5.1o: **"공고에서 요건을 찾아 내 커리어와 맞춰 보는 중"** | UX 본문 문구(`labels.ts` `AI_STAGE_LABELS.match`). 어느 쪽인지 정해 주면 맞춘다 |
| B | S-14 | UX S-14 "**AI가 연결돼 있으면** … '만들면 인사이트를 바로 만들기 시작해요'" ↔ S-16 / FL-10 "데이터 최소 기준 미달이면 시작하지 않고 … C-09" — 연결은 됐지만 D-01이 미달이면 안내 줄이 사실과 어긋난다(UQ-617) | 연결만 본다. 모달이 readiness를 함께 읽어 줄을 숨길지 결정 필요 |
| C | S-14 | decisions 4.24 UI #1 "인사이트를 자동으로 만들어요" ↔ UX S-14 "만들면 인사이트를 바로 만들기 시작해요"(둘 다 `[가정: 문구]`) | UX 본문 문구(엔지니어 보고와 같음) |
| D | S-16 | "임시 상태" 줄 문구가 스펙에 없다(02 S-16 JR-Q2 보류) | `[UI-가정]` "지금 인사이트는 임시 구성이에요. AI가 공고 원문에서 요건을 찾아 내 커리어와 맞춰 봐요" |
| E | S-30 | 약관 본문 `components/account/policy-content.ts:112` "지원 프로젝트(채용 공고)별 **요건 정리**, 인사이트, …" — 법무 문서라 UI가 고치지 않았다 | 다음 약관 개정 때 판단 |
| F | S-10 | 4.24 UI #7 "S-16 보완점 → S-10 패널로 갈 때 `insight_id`·`insight_item_key` 전달" — 전달은 됐다(`insight-view.tsx:452`·`:462`). "관련 요건" 머리 줄은 지웠다(읽을 데이터 없음). 머리 줄이 필요한지 | 삭제 |

## 계약 대조 메모 (Q11 상세)

| 항목 | #78 계약 | UI real 분기 | 판정 |
|------|----------|--------------|------|
| 생성 | `createApplicationProject` → `insightJobId`·`insightSkipReason`, 400 `jd_no_sentences`·`invalid_source_url` | `applications-real.ts:93-117`이 두 값을 행에 실어 보내고, `_lib/actions.ts:48-56`이 400 두 개를 `{refused}` 값으로 바꾼다. S-46은 `ApplicationSummary.insight_job_id`(진행 중 작업)로 "만드는 중"을 읽는다(주소에 싣지 않음) | ✅ |
| 원문 수정 | `updateJdRawText` → `jd_no_sentences`(400)·`jd_job_in_progress`·`jd_raw_text_unchanged`(409) | `applications-real.ts:137-150` `refusalOf(…, RAW_TEXT_REFUSALS)` + `not_found`·`invalid_input` 이름 바꾸기. 이름만 `updateFailedJdRawText` → `updateJdRawText`(G-7) | ✅ (통합 테스트 `w3.integration.test.ts:208-214`) |
| 잠금 | `JdView.rawTextEditable`·`rawTextLockedReason` | `applications-real.ts:120-133` → `raw_text_editable`·`raw_text_locked_reason` → `jd-tab.tsx:46-47`. 인사이트가 끝나면 `InsightView`의 `onDone → router.refresh()`가 같은 페이지의 JD 탭(forceMount)도 다시 읽는다 | ✅ |
| 인사이트 스키마 | `schemaVersion`(1이면 본문 빈 값) | `realGetInsightState`가 행의 `schema_version`을 `normalizeInsightResult`로 넘긴다(`applications-real.ts:257`). 화면은 `schema_version === 1`이면 본문·근거를 읽지 않는다 | ✅ |
| rawText stale | `staleReasons.rawText` = `insights.raw_text_hash ≠ job_descriptions.raw_text_hash` | 같은 두 컬럼을 화면에서 비교한다(`insight-tab.tsx:56-57`). ready 행에는 null이 없어서(CHECK) 결과가 같다 | ✅ (규칙 중복은 G-1·G-3에 기록됨) |
| 인사이트 시작 | 409 `jd_no_sentences` | `_lib/actions.ts:111-118` → `{refused}` → `NoSentencesNotice` | ✅ |
| fetch | `{rawText}`만 | `add-application-dialog.tsx:166-171` `got.rawText`만 쓴다 | ✅ |
| 근거 칩 | `jd_requirement` 삭제, `jd_sentence`는 인사이트에만 | `question-proposal-card.tsx:275` "커리어에서" 한 갈래, `evidence.ts:167-180` `source_locator.sid` → `?s=` | ✅ |
| 보완점 진입 | `return_target.params.insight_id`·`insight_item_key` | `insight-view.tsx:452`·`:462` | ✅ |
| G-6 서버 인사 | — | 서버 인사 3종(`…r17_jd_raw_text_rpcs.sql:703-708`)에는 "공고 요건"이 없다. 화면의 로컬 인사(`cover-letter-chat-types.ts:164`)와 문구는 다르지만 뜻은 어긋나지 않는다 | ✅ 확인 완료 |

## 재확인 결과

- 이번 범위(런 60)의 첫 라운드라 다시 확인할 이전 이슈가 없다. 59 라운드(`59_ui-qa_mockup-rework_review.md`)에서 열린 이슈는 이번 범위 밖이라 다시 보지 않았다.

## 기계 검사 출력

| 검사 | 결과 |
|------|------|
| `pnpm lint` | `eslint` 경고·오류 0 (EXIT 0) |
| `pnpm typecheck` | `next typegen && tsc --noEmit` 오류 0 (EXIT 0) |
| `pnpm exec vitest run` | Test Files 159 passed · Tests 2665 passed (EXIT 0, 로컬 Supabase 127.0.0.1:54322, 통합 테스트 포함) |
| `fetch.redos.test.ts` 단독 4회 | 1회 실패(Tests 1 failed / 124 passed), 3회 125/125 통과 — 시간 상한 불안정, 백엔드 소유, 이번 변경과 무관 |
| `pnpm build` | `✓ Compiled successfully`, EXIT 0 |
| 백엔드 소유 경로 변경 | `git status -- src/server src/app/api src/lib/contracts supabase src/types/database.types.ts` → 0건 |
| 하드코딩 색 grep(바뀐 파일·신규 파일) | 0건 |
| 남은 grep `jd_requirement\|getJdRequirement\|not_a_jd\|extractFirst\|requirementCount\|previewJobId\|요건 정리\|requirement_id\|form-draft\|extracting\|wait-jd` (백엔드 경로 제외) | 화면 코드 0건. 남은 것은 과거 CHECK 값 거울(`types/db.ts:183`, `ai-errors.ts:23`), 주석, 약관 본문(기획 E), 주석 2곳 `ai-run-button.tsx:60`·`:70`의 "ST-WAIT-JD"(폐기 상태를 예로 든 주석 — 함께 정리 권장, 이슈 아님) |

## 재확인 (라운드 2)

- 2026-11-16 · 범위: 엔지니어 보고 "QA 1라운드 수정"에 적힌 파일(`cover-letter-screen.tsx`, `jd-view.tsx`, 신설 `jd-highlight-context.tsx`, `add-application-dialog.tsx`, `cover-letter/page.tsx`, `cover-letter-copy.ts`, `tab-copy.test.ts`)을 **코드로만** 읽었다. 기계 검사는 리더가 돌리기로 해서 이번에는 돌리지 않았다. 브라우저는 여전히 미확인.
- 결과: **8건 중 8건 해결.** 수정에서 새 회귀가 생겼다 — **Major 1(UQ-622)**, Minor 1(UQ-623).

### 재확인 결과

| ID | 판정 | 메모 |
|----|------|------|
| UQ-614 | 해결 | 같은 페이지의 `?tab=jd[&s=]` 링크를 document 캡처 단계 클릭 리스너가 받아 `changeTab("jd")`를 부르고, `nonce`가 붙은 요청을 컨텍스트로 내린다(`cover-letter-screen.tsx:266-293`, `jd-view.tsx:49-54`). 매번 새 키가 되므로 두 번째 클릭, 같은 링크 재클릭, 탭을 떠났다 온 뒤 모두 다시 강조된다. `edit=1`은 서버 이동으로 그대로 보낸다. 이탈 확인 리스너보다 먼저 등록된다(같은 컴포넌트에서 effect가 앞에 선언됨) |
| UQ-615 | 해결 | 패널 판정이 `getInsightState().latest`의 `schema_version`을 본다 — schema 1뿐이면 "none"(`cover-letter/page.tsx:60`, `:75-87`) |
| UQ-616 | 해결 | `ANSWER_NOTE` 상수를 지웠고, 다시 쓸 때의 v5.21 문구는 주석으로 남겼다(`cover-letter-copy.ts:90-91`) |
| UQ-617 | 해결 (`[UI-가정]`, 기획 B 대기) | 모달이 열릴 때 `getDataReadinessAction()`으로 `features.insight.ready`를 읽는다. 연결됨 **그리고** 준비됨일 때만 안내 줄을 보이고, 모르면 숨긴다(`add-application-dialog.tsx:95-108`). effect 정리(`alive`)도 있다 |
| UQ-618 | 해결 | × 뒤 포커스가 날짜 칸으로 간다 — S-14 `add-application-dialog.tsx:344`, S-46 머리 `cover-letter-screen.tsx:599-602`(`id="cl-deadline"`) |
| UQ-619 | 해결 | 안내 줄을 늘 보인다(`add-application-dialog.tsx:399`, `sr-only`·포커스 조건 삭제) |
| UQ-620 | 해결 (문구 `[UI-가정]`) | 첫 강조 문장 `tabIndex=-1` + 포커스(`preventScroll` 뒤 부드러운 스크롤), 강조 문장마다 낭독기용 "근거 문장:" 머리(`jd-view.tsx:66-77`, `:130-142`). 상태 알림의 남은 문제는 UQ-623 |
| UQ-621 | 해결 | `break-words` + `[overflow-wrap:anywhere]`(`jd-view.tsx:115`) |

### 새 이슈 (수정에서 생긴 회귀)

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-622 | **Major** | frontend-engineer (A3) | S-16 → C-01 `jd_sentence` 칩 → C-02 근거 패널 "원본으로 이동" | 02 C-02 "원본으로 이동"(공고 원문 → S-46 채용 공고 탭 하이라이트), UQ-14 "이동 전에 패널을 닫는다" | `src/components/applications/cover-letter/cover-letter-screen.tsx:287-288` (`e.preventDefault()` + **`e.stopImmediatePropagation()`**, document 캡처 단계) ↔ `src/components/common/evidence.tsx:254-259` (`<Link onClick={() => { …; onOpenChange(false) }}>`) | 누르면 근거 패널(Sheet)이 닫히고 채용 공고 탭에서 그 문장이 강조된다 | document 캡처 단계에서 전파를 끊으므로 React 루트의 위임 리스너까지 이벤트가 가지 않는다. 그래서 Link의 `onClick`(패널 닫기)이 실행되지 않는다. 탭은 뒤에서 바뀌지만 **모달 Sheet가 열린 채 화면을 덮고 포커스를 가둔다**(좁은 화면은 `w-full`이라 전체를 덮는다). 사용자가 직접 닫아야 강조가 보인다. stale 인사이트의 칩(`insight-tab.tsx:113`, `?tab=jd`)도 같다. 고칠 방향: `stopImmediatePropagation`을 빼고 `preventDefault`만 둔다. Next `Link`는 사용자 `onClick`을 먼저 부르고 `defaultPrevented`면 이동하지 않으며, 이탈 확인 `guardableHref`(`leave-guard.ts:113`)도 `defaultPrevented`면 건너뛰므로 두 쪽 모두 그대로 맞는다. 회귀 가드 테스트에 "C-02 패널 안 링크 → 패널 닫힘"을 더하기를 권장 |
| UQ-623 | Minor | frontend-engineer (A3) | S-15 강조 알림 | design-system 7 live region 규칙(영역이 먼저 있고 내용이 바뀌어야 알린다) | `src/components/applications/jd-view.tsx:120-122` | "근거 문장 n개를 강조했어요"가 낭독기에 읽힌다 | `role="status"` 요소가 강조 보기 `<p>`와 **함께 새로 마운트**된다. 대부분의 낭독기는 처음부터 들어 있는 live region 내용을 알리지 않는다. 그래서 첫 강조(마크다운 보기 → 강조 보기)에서는 알림이 빠지기 쉽다. 포커스 이동(UQ-620)이 있어 영향은 작다. 상태 요소를 `<section>` 쪽에 늘 두고 텍스트만 바꾸면 된다 |

### 관찰 (이슈 아님)

- 클라이언트 요청(`r{nonce}`)이 한 번 생기면 그 뒤 서버 `?s=`는 강조 키가 되지 않는다(`jd-view.tsx:51-52`). 같은 페이지 안의 이동은 모두 리스너를 지나므로 지금은 차이가 없다. 브라우저 뒤로/앞으로 이동으로 `?s=`만 바뀌면 강조가 따라오지 않을 수 있다 — 브라우저 확인 때 볼 것.
- `parseSentenceParam`은 `S\d+`만 받아서 링크 주소에서 읽는 값은 문장 ID뿐이다(개인 정보 없음).

### 라운드 2 남은 이슈

- Critical 0 / **Major 1 (UQ-622)** / **Minor 1 (UQ-623)**. 기획 확인 A~F는 그대로 남아 있다(B는 UQ-617 임시 처리로 화면 쪽 위험이 줄었다).

## 리더 수정·확인 (라운드 2 뒤, 2026-11-16)

| 이슈 | 수정 | 위치 |
|------|------|------|
| UQ-622 (Major) | 클릭 리스너에서 `stopImmediatePropagation` 삭제, `preventDefault`만 — 링크 자체 onClick(C-02 패널 닫기)이 돈다. Next `Link`·이탈 확인(`guardableHref`)은 막힌 클릭을 건너뛴다 | `cover-letter-screen.tsx` |
| UQ-623 (Minor) | 낭독 상태 영역을 늘 마운트하고 글만 바꿈 | `jd-view.tsx` |
| 테스트 | 소스 가드 `tab-copy.test.ts` UQ-614 케이스를 `preventDefault` 있음 · `stopImmediatePropagation` 없음으로 뒤집음(회귀 가드). 패널이 닫히는 DOM 테스트는 jsdom 환경이 없어 못 넣음 | `tab-copy.test.ts` |

검사: lint 0 · typecheck 0 · vitest 159 파일 2666건 통과(수정한 1건 포함 — 전체 실행에서 실패 1건은 이 가드였고 고친 뒤 단독 통과) · build 통과.
렌더 스모크(dev 서버, `?state=` 미리보기는 로그인 없이 열림): `/dev/states?state=cover-letter`의 32개 주소 + 이번 런 새 상태 9개(`schema-v1`·`raw-text-stale`·`jd-no-sentences`·`raw-locked`·`raw-save-no-sentences`·`questions-insight-generating`·`insight-none`·`insight-generating`·`&s=S1,S2`) — 모두 200, "Element type is invalid" 0건. 미리보기 아닌 주소는 로그인으로 307.
브라우저: **미확인**(Claude in Chrome 미연결, 이 Mac에 Chrome·Playwright 없음, 로컬 로그인 우회 없음).
