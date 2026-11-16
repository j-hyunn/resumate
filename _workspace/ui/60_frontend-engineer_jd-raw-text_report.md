# 60 런 구현 보고 — 채용 공고 원문 전환 (jd-raw-text U1~U9)

- 작성: frontend-engineer, 2026-11-16 · 브랜치 `claude/jd-raw-text-ui` (커밋 안 함)
- 기준: decisions 4.24 UI #1~9, UX v5.21 5.1o + 본문 `(v5.21, JR-…)`(기획 브랜치 `origin/claude/jd-raw-text-planning-6b673b`), 백엔드 계약 PR #78 그대로
- 백엔드 소유 경로(`src/server/`·`src/app/api/`·`src/lib/contracts/`·`supabase/`·`database.types.ts`)는 수정하지 않았다. 계약 대조 메모: `_workspace/ui/60_contract-gaps.md`(막힌 계약 없음)

## 완료 — U별

| U | 화면 | 상태 | 주요 파일 |
|---|------|------|-----------|
| U1 | S-14 추가 모달 | 완료 | `components/applications/add-application-dialog.tsx`, `app/(dashboard)/(gated)/applications/_lib/actions.ts`, `lib/data/jd-raw-text.ts`; 삭제 `components/applications/form-draft.ts`(+test) |
| U2 | S-46 채용 공고 탭(S-15) | 완료 | `cover-letter/jd-tab.tsx`, `jd-view.tsx`, `jd-raw-edit.tsx`, 신설 `jd-highlight.ts` |
| U3 | S-46 인사이트 탭(S-16) | 완료 | `cover-letter/insight-tab.tsx`, `insight-view.tsx`, `insight-parse.ts`, 신설 `start-refusal.ts`; 삭제 `extract-first.tsx`, `_lib/jd-state.ts` |
| U4 | S-46 작성 | 완료 | `cover-letter/question-setup.tsx`, `cover-letter-screen.tsx`, `cover-letter-panel.tsx`, `use-cover-letter-panel.ts`, 신설 `cover-letter/insight-notice.tsx`, `lib/data/cover-letter-chat-types.ts`, `career/ai-panel/ai-panel.tsx`(`copy.notice`를 ReactNode로), `app/(page)/(gated)/applications/[id]/cover-letter/page.tsx` |
| U5 | C-01·C-11·C-15 근거 칩 | 완료 | `cover-letter/question-proposal-card.tsx`(`jd_requirement` 분기 삭제 → "커리어에서" 한 갈래), `lib/data/evidence.ts`(`jd_sentence` 칩 → `?tab=jd&s={sid}`), `lib/mock/cover-letter-turn.ts` |
| U6 | C-03·C-20 | 완료 | `common/ai-progress.tsx`, `lib/data/labels.ts`(`AI_STAGE_LABELS`), `common/ai-error-notice.tsx`, `lib/data/ai-errors.ts`, `common/dev-state-gallery*.tsx`, `common/state-views.tsx`(ST-WAIT-JD 삭제) |
| U7 | C-18·C-05·S-16→S-10 | 완료(“관련 요건” 줄은 삭제 쪽) | `common/ai-lock.tsx`(`requirements` 진입점 삭제), `lib/data/labels.ts`(`AI_FEATURE_NAMES.requirements` 삭제), `common/delete-confirm-dialog.tsx`("JD·요건" → "공고"), S-10 페이지 2개·`details` 리다이렉트·`writing-chats/new`, `career/add-project-dialog.tsx`, `common/choose-project-affiliation.tsx`, `lib/routes.ts`; 삭제 `career/related-requirement.tsx` |
| U8 | S-24 ②·S-42 사용량 표 | 완료 | `lib/data/usage-display.ts`, `components/account/usage-rows.ts`(+test), `account/ai-usage-panel.tsx`, `lib/data/labels.ts`("JD 요건 추출(종료)") |
| U9 | 데이터 계층 mock·타입 | 완료 | `lib/mock/fixtures.ts`, `lib/mock/ai.ts`, `lib/data/applications.ts`·`applications-real.ts`, `lib/data/ai-jobs.ts`, `deletion.ts`, `evidence-real.ts`, `types/db.ts`(`JdRequirement*` 삭제), `lib/preview-state.ts`, `lib/routes.ts`, dev 갤러리 |

### U별 세부

- **U1 S-14**: ② 지원 포지션 아래 **마감일** 칸(`type="date"`, 일 단위, "마감일 비우기" ×) → `createApplicationAction({deadline})`. 직접 입력이면 [다음]이 서버 요청 없이 ②로, URL이면 가져오기(`{rawText}`)만 기다린다. 기업·포지션·마감일은 늘 빈 칸에서 시작. AI 미리 채우기·`extracting`/`extract-failed` 단계·"요건 n개" 줄·`previewJobId`·`rawEdited`·C-20 `key_invalid`·C-21 동의 게이트·세션 입력 보존(form-draft) 삭제. AI 연결(활성 공급자 + 키 무효 아님 + 동의 필요 없음) 시 [자기소개서 작성] 위에 **"만들면 인사이트를 바로 만들기 시작해요" + C-19 배지**(스펙 S-14 문구 — 브리프의 "인사이트를 자동으로 만들어요"가 아니라 UX 본문 문구를 썼다). `jd_no_sentences`(400) → 공고 내용 칸 아래 "공고 내용을 확인해 주세요. 문장으로 읽을 수 있는 내용이 없어요"(입력 유지). 닫기 확인 "입력한 내용이 사라져요 · 닫기 / 계속 작성". 원문 안내 "만든 뒤에도 채용 공고 탭에서 공고 내용을 고칠 수 있어요", 짧은 공고 경고 "…인사이트가 더 정확해져요". 생성 뒤 `insight_job_id`는 S-46이 진행 중 인사이트 작업(`ApplicationSummary.insight_job_id`)으로 읽어 문항 설정 상태 머리 아래 **"인사이트를 만드는 중이에요. 작성을 시작하면 인사이트 탭에서 볼 수 있어요"**를 보인다(주소에 값을 싣지 않아 새로고침해도 맞다).
- **U2 S-15**: 요건 목록 열·기술 키워드·경력 조건·`JdLockedNotice`·`raw-has-requirements` 삭제. `raw_text` + `sentences` 오프셋 하이라이트, `?tab=jd&s=S3,S4`(첫 문장으로 스크롤, 원문 클릭·탭 이탈 시 해제, 없는 문장이면 "이 근거가 가리키던 문장을 찾지 못했어요"). **[공고 내용 수정]** 늘 보임, `rawTextLockedReason = job_in_progress`면 비활성 + "인사이트를 만드는 중에는 수정할 수 없어요". 저장 거부 코드 `jd_job_in_progress`(잠금 + 다시 읽기)·`jd_no_sentences`·`jd_raw_text_unchanged` 문구, 저장 성공 "저장했어요". 같은 페이지 안 링크(칩·요건 행)로 `?tab=`이 바뀌면 탭이 따라가도록 S-46에 동기화 추가(폼 상태 유지).
- **U3 S-16**: 판정 표 = `requirement_text` + **"공고 원문"** 링크(`sids` 전체 강조), 카테고리·"핵심" 배지 삭제. 머리에 **임시 상태 줄** `[UI-가정]`. 자동 시작: 진행 중 작업이 있으면 C-03으로 열고, 다른 읽기에서 생긴 작업도 따라간다; 완료 토스트는 셸 `AiJobWatcher`("{이름} 인사이트가 준비됐어요 [보기]"), 실패는 C-20 + 같은 행 다시 시도. `schema_version = 1` → 본문·근거 없이 "공고 처리 방식이 바뀌어 다시 만들어야 해요" + [다시 생성]. rawText stale(인사이트 `raw_text_hash` ≠ JD `raw_text_hash`) → "공고가 바뀌었어요 — 다시 생성" 배지(커리어 변경과 함께면 두 줄), 그 인사이트의 `jd_sentence` 칩 "변경됨" + 강조 없는 링크, 요건 행 "공고 원문" 링크도 강조 없이. 생성 거부 `jd_no_sentences`(409) → 안내 + "공고 원문 고치기". C-20 입력 원인 이동 = `input_too_long`·`safety_blocked` → S-15 수정 상태(`?tab=jd&edit=1&from=insight`), {줄일 대상} "공고 원문이나 커리어". `extractFirst`·`EXTRACT_FIRST_NOTE`·`isInputCausedJdFailure`·`cause: not_a_jd` 경로·`WaitJd` 삭제. 별칭 가드에 `MT-n` 추가.
- **U4 S-46 작성**: [자기소개서 작성 시작] = 검증 → 저장만(`useRequirementsFirst` 삭제, AI 연결을 보지 않음). 패널 시작 영역 고정 안내 "AI는 모아 둔 커리어와 인사이트로 문항 초안을 제안하고, 반영은 내가 정해요" + 인사이트 없음 "인사이트가 있으면 공고에 맞춘 답을 쓸 수 있어요" + (키 있음) [인사이트 탭 열기] / 만드는 중 "인사이트를 만드는 중이에요. 끝나면 공고에 맞춘 답을 쓸 수 있어요". 시작 인사 ④("공고 요건을 먼저 정리…") 삭제. 제안 카드 근거 칩에 공고 출처 없음.
- **U6**: `prepare` "준비 중", `match` **"공고에서 요건을 찾아 내 커리어와 맞춰 보는 중"**(UX C-03 본문 문구 — decisions 4.24 #6의 "요건별로 내 커리어와 맞춰 보는 중"과 다름, 아래 기획 확인), 인사이트 처리 단위 (n/m) 표시 안 함, 무료 등급 줄 "무료 등급이라 조금 더 걸려요 · 2분 정도 걸려요". `PAID_ESTIMATE_SEC.jd_extraction` 삭제. C-20 `not_a_jd` 문구·아이콘·행동 줄, dev 갤러리 `not_a_jd`·요건 추출 실패 버튼·"요건 정리" 잠금 삭제. `errorCategoryOf`의 `not_a_jd`는 DB 생성 컬럼 거울이라 남겼다(4.24 #8).
- **U7**: S-10 "관련 요건" 줄은 **삭제**했다 — 읽을 데이터(`jd_requirements`)가 없고, 보완점 맥락은 이미 `markCareerReturn({params: {insight_id, insight_item_key}})`(복귀 대상)로 S-10 패널 게이트 대화에 간다(AI-12, 서버). `requirement_id` 쿼리·`getJdRequirement` 경로 전부 정리.
- **U8**: 기본 4행(프로젝트/산출물 작성 AI 채팅 · 인사이트 · 자기소개서 작성 AI 채팅 · 연결 확인) + 그 달 `jd_extraction` 기록(calls > 0)이 있을 때만 맨 아래 "JD 요건 추출(종료)". 정렬을 바꿔도 그 행은 맨 아래.
- **U9**: `MockDb.jd_requirements`·`next_jd_extraction_failure`·`jd_extraction` 견본 작업(1·6·15) 삭제, 작업 17 = 인사이트 `input_too_long`(C-20 이동 견본), 사용량 기록 2(`jd_extraction`)는 과거 행 견본으로 유지. mock 인사이트 단계 계획 `match` 한 단계. **mock 생성 자동 시작 흉내**: 연결(키 없음/무효/동의) → D-01 → 문장 ≥ 1 → 진행 중 없음 → 수동 시작과 같은 `startMockInsight` → `insight_job_id`, 예외는 `start_failed`. mock 생성·원문 수정·인사이트 시작의 0문장 거부(`jd_no_sentences`). 문장 분할 mock은 글자·숫자가 없는 줄을 문장으로 세지 않는다. `JdRequirement`·`JdRequirementCategory/Importance/Origin`(db.ts), `getJdRequirement`/`realGetJdRequirement`, `JobDescriptionWithRequirements` → `JobDescriptionView`, `updateFailedJdRawText*` → `updateJdRawText*`(같은 계약, 이름만).

## `?state=` 키 (screen-status 반영용)

| 화면 | 추가 | 삭제 |
|------|------|------|
| S-14 (S-13/S-39 위 모달) | `jd-no-sentences` | `extracting`, `extract-failed`, `key-invalid`, `ai-failed-key-invalid` (모달은 `consent-required`·`key-missing`도 더 이상 다르게 그리지 않는다) |
| S-46 문항 설정 상태 | `questions-insight-generating` | `extracting`, `extract-failed`, `extract-failed-input`, `extract-failed-wait` |
| S-46 작성 상태(패널) | `insight-none`, `insight-generating` | — |
| S-46 채용 공고 탭 (`?tab=jd`) | `raw-save-no-sentences`, `raw-locked`; 주소 `&s=S3,S4`(상태 아님) | `raw-has-requirements`, `raw-editable`, `raw-unknown-cause` |
| S-46 인사이트 탭 (`?tab=insight`) | `schema-v1`, `raw-text-stale`, `jd-no-sentences` | `raw-edited`, `wait-jd` |
| 공통 (`PREVIEW_STATES`) | — | `wait-jd` (ST-WAIT-JD 폐기, R-JR-9) |

## [UI-가정]

| 화면 | 파일 | 내용 |
|------|------|------|
| S-14 | `add-application-dialog.tsx` | 마감일 칸 모양 = S-46 머리와 같은 날짜 칸 + × "마감일 비우기"; 자동 시작 안내 줄은 ②에서만, 버튼 위 오른쪽 정렬 |
| S-14 | 같음 | "연결됨" = 활성 공급자 · 키 무효 아님 · 동의 필요 없음(`needs_check`는 연결됨) |
| S-14 | 같음 | 직접 입력 [다음]은 미리 보기에서도 서버를 부르지 않으므로 그대로 ②로 간다 |
| S-14 | 같음 | 닫기 확인의 설명 줄은 낭독기 전용("지금 닫으면 입력한 공고가 남지 않아요") |
| S-15 | `jd-view.tsx` | 강조 해제 = 원문 클릭(드래그 선택은 제외)·탭 이탈(`JD_TAB_LEFT_EVENT`, 주소의 `s`도 지움); 강조 중에는 일반 글 보기(오프셋 강조), 아니면 마크다운 읽기 전용 |
| S-15 | `jd-raw-edit.tsx` | `jd_raw_text_unchanged` 문구 "바뀐 내용이 없어요"; 그 밖 코드(`invalid_raw_text`·`job_description_not_found`)는 "저장하지 못했어요. 다시 시도해 주세요" |
| S-16 | `insight-view.tsx` `INSIGHT_INTERIM_NOTE` | 임시 상태 줄 문구 "지금 인사이트는 임시 구성이에요. AI가 공고 원문에서 요건을 찾아 내 커리어와 맞춰 봐요" (스펙에 문구 없음) |
| S-16 | 같음 | rawText stale이면 요건 행 "공고 원문" 링크도 강조 없이 탭만 연다(C-02 칩 규칙과 같게) |
| S-16 | 같음 | 옛 인사이트 카드 = 경고 아이콘 + 문구 + [다시 생성](C-19 / 키 없으면 C-18 인라인 — AiRunButton 규칙) |
| S-46 | `cover-letter-chat-types.ts` | 로컬 시작 인사 ① "자기소개서 문항을 함께 채워 볼까요? 모아 둔 커리어와 인사이트로 초안을 제안해 드려요"(공고 요건 → 인사이트) |
| S-46 | `insight-notice.tsx` | [인사이트 탭 열기]는 패널이 잠기지 않았을 때(키 있음·무효 아님)만 |
| C-03 | `ai-progress.tsx` | 인사이트 유료 예상 60초(무료 2배 = "2분") |

## 기획 확인 필요

| 화면 | 질문 | 스펙 위치 |
|------|------|-----------|
| C-03 | `match` 문구가 두 곳에서 다르다 — UX C-03·5.1o "공고에서 요건을 찾아 내 커리어와 맞춰 보는 중" vs decisions 4.24 UI #6 "요건별로 내 커리어와 맞춰 보는 중". UX 본문 문구를 썼다 | 02 C-03 "단계 문구", decisions 4.24 UI #6 |
| S-14 | 자동 시작 안내 문구가 두 곳에서 다르다 — UX S-14 "만들면 인사이트를 바로 만들기 시작해요" vs decisions 4.24 UI #1 "인사이트를 자동으로 만들어요". UX 본문 문구를 썼다 | 02 S-14 [자기소개서 작성] 행, decisions 4.24 UI #1 |
| S-16 | "임시 상태" 줄의 문구가 없다 — `[UI-가정]` 문구를 넣었다 | 02 S-16 (v5.21, JR-Q2 보류), 5.1o 후속 확정 JR-Q2 |
| S-30 | 약관 본문(`components/account/policy-content.ts:112`)에 "지원 프로젝트(채용 공고)별 요건 정리, 인사이트, 자기소개서 초안 작성"이 남아 있다 — 법무 문서라 고치지 않았다. 다음 약관 개정 때 "요건 정리" 삭제 여부 | 약관(서비스 내용) |
| S-10 | "관련 요건" 줄을 `insight_id`·`insight_item_key`로 다시 그릴지(보완점 문구를 S-10 머리에 보이기) — 지금은 삭제(패널 게이트 대화가 그 보완점을 시작 맥락으로 쓴다). 줄이 필요하면 인사이트 id로 한 항목을 읽는 data 함수가 필요하다 | 02 S-16 보완점 → C-23 → S-10, decisions 4.24 UI #7 |

## 파운데이션 요청

- 없음(이번 런은 UI 전체를 맡아 공통 파일도 직접 고쳤다 — `components/common/*`, `career/ai-panel/ai-panel.tsx`의 `copy.notice` 타입 넓힘, `lib/routes.ts`, `lib/preview-state.ts`, `lib/mock/*`, `types/db.ts` 뷰 타입 정리).

## 백엔드 요청

- 막힌 것 없음. 확인 권장 2건은 `_workspace/ui/60_contract-gaps.md` G-1(stale 판정을 화면이 컬럼 비교로 함)·G-6(서버 대화 시작 인사 문구에 "공고 요건"이 남았는지).

## 남은 grep (`jd_requirement|REQ-|jd_extraction|not_a_jd|extractFirst|requirementCount|previewJobId|요건 정리|companyName.*fetch`, 백엔드 경로 제외)

| 위치 | 이유 |
|------|------|
| `types/db.ts` `AiJobType`·`AiErrorCode`·`AiUsageFeature`의 `jd_extraction`/`not_a_jd` | 4.24 #8 과거 CHECK 값 거울(백엔드 소유 행 타입) |
| `lib/data/ai-errors.ts` `errorCategoryOf` `not_a_jd` | DB `error_category` 생성식 거울(과거 행) |
| `lib/data/labels.ts`·`usage-display.ts`·`usage-rows.test.ts`·`lib/mock/fixtures.ts` rec 2 `jd_extraction` | U8 과거 기록 행 "JD 요건 추출(종료)" |
| `lib/data/applications.ts:83`, `lib/data/shell.ts:78`, `lib/data/account.ts:350` | real 행의 과거 `jd_extraction` 작업을 진행 중 표시에서 제외(백엔드가 둔 필터, real·mock 공용 `summarize`) |
| `components/applications/insight-parse.ts` `REQ` | 저장된 산문에 남은 옛 별칭 표시 가드 |
| `components/account/policy-content.ts` "요건 정리" | 약관 본문 — 기획 확인 필요 |
| 주석(`ai-lock.tsx`·`ai-error-notice.tsx`·`jd-view.tsx`·`jd-tab.tsx`·`jd-raw-text.ts`·`fixtures.ts`·`ai.ts`·`evidence-real.ts`·`deletion.ts`·`applications.ts`·S-10 페이지·`routes.ts`·`choose-project-affiliation.tsx`·`add-application-dialog.tsx`·테스트 이름) | 무엇이 왜 없어졌는지 적은 설명 |
| `requirement_ids`(`types/db.ts` 876·933, `lib/data/drafts.ts`, `lib/mock/ai-stream.ts`, `fixtures.ts` drafts) | 폐기된 S-17/S-19 `drafts` 미리 보기 전용 모양(이번 범위 밖) |
| `form-draft`·`extracting`·`requirement_id` | 코드에는 없음(주석·테스트 단정만) |

## 검사 결과

| 검사 | 결과 |
|------|------|
| `pnpm lint` | 경고·오류 0 |
| `pnpm typecheck` (`next typegen && tsc --noEmit`) | 오류 0 |
| `pnpm exec vitest run` (로컬 Supabase 127.0.0.1:54322, 통합 포함) | 159 파일 / 2665 테스트 중 2664 통과, 1 실패 = `src/server/services/job-description/fetch.redos.test.ts` 시간 상한(2 MB 1.48초 > 1초) — 전체 병렬 실행 부하에서만, 단독 재실행 125/125 통과. 백엔드 소유·이번 변경과 무관 |
| `pnpm build` | 성공 |
| 바꾼 테스트 | `usage-rows.test.ts`(4행 + 과거 행), `start-writing.test.ts`(선행 추출 없음), `tab-copy.test.ts`(요건 열 없음·하이라이트 보기), `cover-letter-chat-types.test.ts`(인사 ④ 없음), `routes-v56.test.ts`(`requirement_id` 삭제, `?s=` 추가), `education-labels.test.ts`, `w3.integration.test.ts`(이름 변경). 삭제 `form-draft.test.ts` |
| 브라우저 | **미확인.** 화면은 로그인(Google OAuth)이 필요한 gated 경로라 이 환경에서 로그인할 수 없고, 프로덕션 빌드는 `?state=` 미리 보기를 끈다(`next start`로 확인 — `/sign-in`으로 307). 기록은 `QA 통과 (mock·브라우저 미확인)` 기준으로 남겨 주세요. 확인 권장 흐름: S-14 생성(마감일·AI 연결 안내) → S-46 문항 설정 "만드는 중" 줄 → 채용 공고 탭 수정·잠금·`&s=` 하이라이트 → 인사이트 탭(자동 시작 진행·stale 배지·schema 1) → S-24 ② 사용량 표 |

## QA 1라운드 수정 (`61_ui-qa_jd-raw-text_review.md`, 2026-11-16)

| 이슈 | 수정 | 파일 |
|------|------|------|
| UQ-614 (Major) | 같은 페이지의 `?tab=jd[&s=…]` 링크(S-16 요건 행 "공고 원문", C-01/C-02 `jd_sentence` 칩)를 **클라이언트에서** 받는다: document 캡처 클릭 리스너가 `preventDefault` + `stopImmediatePropagation` 후 탭을 "채용 공고"로 바꾸고 `{sids, nonce}` 요청을 컨텍스트로 내려 강조를 다시 건다(nonce가 매번 바뀌어 같은 링크 재클릭·탭 이탈 뒤에도 다시 강조). 주소는 `replaceState`로 `tab=jd&s=`만 맞춘다. 리스너는 `useLeaveGuard`보다 먼저 등록돼 같은 페이지 이동에 "저장하지 않고 떠날까요?"를 묻지 않는다. `edit=1`(C-20 "공고 원문 고치기")은 서버가 편집기를 열어야 해서 그대로 이동 | `cover-letter/cover-letter-screen.tsx`, 신설 `jd-highlight-context.tsx`, `jd-view.tsx`, `tab-copy.test.ts`(회귀 가드) |
| UQ-615 | 패널 인사이트 상태를 `getInsightState`로 판정 — 최신 ready 인사이트가 schema 1뿐이면 "없음"(→ "인사이트가 있으면 …" 줄) | `app/(page)/(gated)/applications/[id]/cover-letter/page.tsx` |
| UQ-616 | 옛 문구 상수 `ANSWER_NOTE`(쓰이지 않음) 삭제, 다시 둘 때의 v5.21 문구를 주석으로 남김 | `lib/data/cover-letter-copy.ts` |
| UQ-617 | 모달이 열릴 때 기존 `getDataReadinessAction()`으로 `features.insight.ready`를 읽어, AI 연결 **그리고** D-01 충족일 때만 자동 시작 안내 줄을 보인다(모름 → 숨김) `[UI-가정]` — 기획 B 확정 전 임시 | `add-application-dialog.tsx` |
| UQ-618 | 마감일 "비우기"(×) 뒤 포커스를 날짜 칸으로 — S-14 ②와 S-46 머리 둘 다 | `add-application-dialog.tsx`, `cover-letter-screen.tsx`(`id="cl-deadline"`) |
| UQ-619 | S-14 ② 공고 원문 안내를 공고 내용 칸 아래에 늘 보인다(포커스 조건 삭제) | `add-application-dialog.tsx` |
| UQ-620 | 첫 강조 문장에 `tabIndex=-1` + 포커스(스크롤 함께), 강조 문장마다 낭독기용 "근거 문장:" 머리, "근거 문장 n개를 강조했어요" 상태 알림 `[UI-가정]` 문구 | `jd-view.tsx` |
| UQ-621 | 강조 보기 `<p>`에 `break-words` + `overflow-wrap:anywhere` | `jd-view.tsx` |

- 문구(기획 A·C·D): UX 본문 문구를 그대로 두고 `[UI-가정]`으로 유지(기획 확인 대기).
- 재검사: `pnpm lint` 0 · `pnpm typecheck` 0 · `pnpm exec vitest run` **159 파일 / 2666 테스트 전부 통과**(로컬 Supabase, 새 회귀 가드 1건 포함) · `pnpm build` 성공. 브라우저는 여전히 미확인(로그인 수단 없음). 커밋 안 함.
