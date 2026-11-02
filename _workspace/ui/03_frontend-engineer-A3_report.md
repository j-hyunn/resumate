# A3 기업 JD 관리 구현 보고 (Phase 3, 2026-10-25)

기준: 플로우 v4.2b · AI v3.2a · 데이터 모델 v3.2a · 디자인 시스템 v1 · A0 라운드 1 규칙(ScreenSuspense 페이지 패턴, `routes.*`, C-12~C-14 파운데이션 컴포넌트). 커밋하지 않음.
S-15~S-19와 S-14·S-31 일부는 명세가 "v3와 같음"인데 v3 문서가 저장소에 없어, v4 명세 + AI 명세(AI-01/02/03/04/11, C-6) + 디자인 시스템 A3 메모로 만들고 빈 곳은 `[UI-가정]`으로 남겼다.

## 완료 화면

| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---------|--------|--------------|------|
| S-13 기업 JD 목록 | `/applications` (`?sort=deadline`, `?stage=`) | `empty` `loading` `error` `unauth` `not-found` `move-failed` | 넓은 화면 표 / 좁은 화면 카드, 행 전체 → S-31, 행 메뉴 = `StageCardMenu`(C-12 단계 이동 + C-13 결과 기록) + 기업 JD 열기 + 삭제(C-05). 기능 진행 칸(인사이트 없음/생성 중 C-03 축약형/있음 · 초안 수 · 면접 수 + 작성 중), D-day, 최근 활동. 최근 활동순 기본 / 마감일순 / 단계 필터. "+ 기업 JD 추가", "보드로 보기" |
| S-14 기업 JD 추가 | `/applications/new`, `?from=board` | `loading` `error` `not-found` `save-failed` | 공고 원문(필수·50,000자·글자 수), 이름(선택, 비우면 AI 추출), 마감일. 200자 미만·매우 긴 공고 경고(진행 허용), 교체 불가 안내, "사용량 차감 없음". 만들기 → S-31, 보드에서 왔으면 S-39 + "열기" 토스트. 이동 경로 첫 마디도 출발지에 맞춤 |
| S-31 지원 프로젝트 허브 | `/applications/[id]` | `loading` `error` `unauth` `not-found` `move-failed` `save-failed` `wait-jd` `ai-pending` | 헤더: 이름 + "AI 추출" 배지 + 이름·마감일 인라인 수정(F-AP-04 MVP 범위) + 회사·포지션 + D-day + `StageChip`(C-12 → C-13/C-14) + ⋯ 삭제(C-05 → S-13). 기능 카드 4개(JD·요건 / 인사이트 / 서류 초안 / 모의 면접: 세션 수, 최근 유형·점수 `SessionScoreBadge`, 작성 중 n/N + "이어서 쓰기" → S-33). 추출 중이면 2초 새로고침 |
| S-15 JD·요건 | `/applications/[id]/jd` | `loading` `error` `unauth` `not-found` `wait-jd` `ai-sync` `ai-failed` `ai-failed-input` `ai-failed-timeout` | 2열(xl): "공고 원문"(요건의 `source_sids` 문장 하이라이트) / 요건(주요 업무·자격요건·우대사항, 핵심 배지, 직접 수정 표시, "원문" 버튼) + 기술 키워드 + 경력 조건. 추출 중 "공고를 분석하고 있어요"(ST-AI-SYNC), `is_likely_jd=false` 경고, 실패 input → "채용 공고가 아닌 텍스트로 보여요" + 다시 시도 |
| S-16 인사이트 | `/applications/[id]/insight` | `loading` `error` `unauth` `not-found` `empty` `ai-pending` `ai-failed(-input/-timeout)` `limit` `insufficient` `insufficient-no-experience` `wait-jd` | 생성 버튼 + UsageHint → C-03(부분 결과 자리 Skeleton) → 결과: 기준 안내·판정 개수, "커리어가 바뀌었어요"(F-P2-07) + 다시 생성, 요건별 판정 표(좁은 화면 카드), 핵심 강점, 보완점(+대응 방안, `add_data` → "AI와 대화하며 추가"(S-36 + C-10, 대화 사용량 안내) / "직접 입력"(S-10 + C-10)), 지원 방향(포지셔닝 + 어필 프로젝트 → S-10). 모든 항목 C-01 칩 / C-02 패널(`returnTarget` 설정). C-09·ST-LIMIT·ST-WAIT-JD. 진입 시 `consumeReturnParams` |
| S-17 서류 초안 목록·경력기술서 설정 | `/applications/[id]/drafts` | `loading` `error` `unauth` `not-found` `empty` `limit` `insufficient` `insufficient-no-experience` `wait-jd` `ranking-failed`(화면 전용: AI-11 실패 → 최신순 전체 대체) | 만든 초안 목록(종류·상태·편집일·출처, 삭제 C-05). 새 서류: 경력기술서(AI에게 맡기기 기본 / 직접 고르기, C-11 체크 트리 — 경력·교육 아래 프로젝트 + 독립 프로젝트, 출처 배지 인사이트 우선순위/AI가 고름/직접 고름, AI-11 진행 `rank` 스켈레톤) → 초안 생성 → S-19 스트리밍. 자기소개서 → 기본 3문항 시드 → S-18. C-09 복귀 시 포함 항목 복원 |
| S-18 자소서 문항 설정 | `/applications/[id]/drafts/[draftId]/questions` | `loading` `error` `unauth` `not-found` `save-failed` `limit` `insufficient` `insufficient-no-experience` `wait-jd` | 문항 카드(문항·글자 수 number w-28·공백 기준 Select·메모 300자 + G-2 + 포부 문항 힌트 "회고 및 배운 점이 있으면 AI가 참고해요"), 자동 저장 C-06(머리 하나), 문항 추가/삭제(최소 1). "전체 생성"(문항 수만큼 사용) → S-19 `?generate=all`, "문항별로 생성하기" |
| S-19 초안 편집기 | `/applications/[id]/drafts/[draftId]` (`?generate=1\|all\|{sectionId}`) | `loading` `error` `unauth` `not-found` `ai-stream` `ai-failed(-input/-timeout)` `limit` `insufficient` `insufficient-no-experience` `save-failed` `wait-jd` | ≥1280 문서 + sticky 패널, 미만 "근거·출처" Sheet + 문항 카드 아래 Collapsible. 경력기술서: C-04 블록 스트리밍(중단, 완료 시 저장), 섹션 머리글 + 요약/역할/불릿, C-11 포함 항목 변경 → 덮어쓰기 확인 → 전체 다시 생성(`regenerated_from_id`). 자소서: 문항마다 "쓸 경력·프로젝트 고르는 중" → 선택 카드 → 문단 스트리밍, 전체 생성은 순서대로, 문항 생성/다시 생성(덮어쓰기 확인), 글자 수 `n / N자(공백 포함)` ±10% 표시, 문항 복사. 블록 편집 → `edited_content` 자동 저장 + "편집됨" 배지, C-08 자리 표시 강조·검증 배지·"커리어에 추가하기"(상세 내용 근거면 S-35 해당 필드 + C-10), 자리 표시 목록, 전체 복사(자리 표시 경고) |
| C-11 사용한 경력·프로젝트 | (S-17, S-19 안) | — | 문항별 목록: 경로 라벨(`source_label`), 주 근거/보조, AI 선택/내가 추가, rationale, 관련 요건, reuse_reason, 원본 삭제됨. 바꾸기 → 프로젝트 + 상세 내용 체크(`project_detail_ids`) → `source_selection_mode='user'`, `sources_modified_at` → "근거를 바꿨어요" + "변경 사항으로 다시 생성"(1회) + 덮어쓰기 확인. 모두 제외 경고 |

## 파일

- 페이지: `src/app/(dashboard)/applications/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `[id]/jd/page.tsx`, `[id]/insight/page.tsx`, `[id]/drafts/page.tsx`, `[id]/drafts/[draftId]/page.tsx`, `[id]/drafts/[draftId]/questions/page.tsx` (모두 ScreenSuspense 패턴)
- 영역 데이터 shim·액션: `src/app/(dashboard)/applications/_lib/data.ts`, `_lib/actions.ts`
- 컴포넌트: `src/components/applications/` — `application-list.tsx`, `application-new-form.tsx`, `hub-header.tsx`, `jd-view.tsx`, `insight-view.tsx`, `drafts-view.tsx`, `source-tree.tsx`, `sources-used.tsx`(C-11), `cover-letter-questions.tsx`, `draft-editor.tsx`, `shared.tsx`(AutoRefresh, JobInline, useDeleteApplication, useRestoreReturnParams), `labels.ts`
- `interview/**`(A4)는 건드리지 않음

## 미완료 / 부분 구현

- S-15 요건 수정·추가·삭제: F-P2-03이 Could라 MVP에서 읽기 전용으로 둠(데이터 계층 `saveJdRequirement`는 있음).
- S-31 전형 이력(S-38, Should)·메모(F-AP-04 메모는 Should): 미구현.
- S-19 이전 버전 보기(F-DOC-06 Could), 다시 쓰기(F-DOC-05 Should): 미구현.
- 경력기술서 포함 프로젝트의 순서 직접 바꾸기: `project_order`는 인사이트/선택 순서를 그대로 씀(명세에 순서 변경 UI 언급 없음).
- 브라우저 육안 확인은 하지 않음. `pnpm dev`에서 대표 14개 경로(상태 포함) 200 응답·핵심 문구 렌더·서버 오류 로그 0건까지 확인. 스트리밍·다이얼로그·자동 저장 등 클라이언트 상호작용은 QA 브라우저 확인 필요.

## [UI-가정]

| 화면 ID | 파일 | 내용 |
|---------|------|------|
| S-13 | `applications/page.tsx` | 빈 상태 제목 "아직 기업 JD가 없어요"(설명은 명세 문구), 필터 결과 없음 "이 전형 단계의 기업 JD가 없어요" |
| S-13 | `application-list.tsx` | 단계 필터(명세 `[가정]`), 추출 대기 행 "공고를 분석하고 있어요", 행 메뉴 이름 "행 메뉴" |
| S-13·S-31 | `shared.tsx` | 삭제 완료 토스트 "{이름} 기업 JD를 삭제했어요" |
| S-14 | `application-new-form.tsx` | 200자 미만 경고 문구, 16,000자 초과 긴 공고 경고(문구·기준), 교체 불가 안내 문구, 이름 도움말, 저장 실패 문구, 보드 복귀 토스트 "기업 JD를 추가했어요" |
| S-31 | `hub-header.tsx`, `[id]/page.tsx` | 인라인 수정 형태(연필 → 이름·마감일 폼 → 저장/취소), "저장했어요" 토스트, 기능 카드 요약 문구, 삭제는 ⋯ 메뉴 안 |
| S-15 | `jd-view.tsx`, `labels.ts` | 카테고리 라벨(주요 업무/자격요건/우대사항 — AI 명세 기준 용어), 핵심 배지(P-3), 카테고리 빈 문구, "원문" 버튼, 경력 조건 줄, `is_likely_jd=false` 경고 문구 뒷부분 |
| S-16 | `insight-view.tsx` | 생성 전 안내 카드 문구, thin 안내, 강점 0개 문구, 보완점 대응 유형 라벨(관련 경험 추가/다르게 설명하기/면접 대비), "데이터 변경됨" 판단 = 근거 중 변경됨·원본 삭제됨이 하나라도 있으면, 기존 결과가 있으면 C-09는 결과를 가리지 않고 "다시 생성" 자리에만 표시 |
| S-17 | `drafts-view.tsx`, `labels.ts` | 초안 상태 라벨 5종, AI-11 실패 대체 선택의 출처 배지 "직접 고름", 포함 항목 0개 안내, "AI에게 맡기기" 상태에서 체크 비활성(직접 고르기로 바꾸면 수정) |
| S-18 | `_lib/data.ts`, `cover-letter-questions.tsx` | 기본 글자 수 800/1000/600·공백 포함, 3문항 기본 문구, 메모 안내 문구, "전체 생성"은 남은 횟수 < 문항 수이면 비활성 + 안내, 빈 문항이 있으면 비활성 |
| S-19 | `draft-editor.tsx`, `sources-used.tsx` | 덮어쓰기 확인 문구, "복사했어요" 토스트, 중단 안내 문구, ±10% 범위 밖 표시 문구, 블록은 연필 버튼/클릭으로 편집, 자소서 "다시 생성"(근거 변경 없이)도 덮어쓰기 확인 + 1회 차감 |
| S-19 | `_lib/data.ts` | 경력기술서 재생성 = 새 drafts 행(`regenerated_from_id`, AI-03), 자소서 재생성 = 같은 섹션 덮어쓰기(D-DM-06). 스트리밍 중 이탈 → 20초 뒤 서버가 끝낸 것으로 처리(C-04 `[가정]` 모사). 모의 AI 문장은 상세 내용 행동·결과를 잘라 붙인 것 |

## 기획 확인 필요

| 화면 ID | 질문 | 스펙 위치 |
|---------|------|-----------|
| S-14·S-15~S-19 | "v3와 같음"으로 적힌 세부 명세(필드·문구·상태)가 저장소에 없음. 위 [UI-가정] 전부가 이 공백에서 나옴 | 02 S-14, S-15~S-19 |
| S-13 | 빈 상태 제목 문구 | 02 S-13 |
| S-14 | U-6 "S-14 안내 확정"이라는데 안내 문구 자체가 없음. 짧은 공고(F-P2-01)·긴 공고(AI C-2) 경고 문구 | 02 5.1a, 01 F-P2-01, 03 C-2 |
| S-16 | F-P2-07 "데이터 변경됨"의 판단 기준(근거 변경 / `career_snapshot_hash` 비교 중 무엇?), 기존 결과가 있을 때 C-09를 결과 대신 보일지 | 02 FL-11, 01 F-P2-07 |
| S-16 | 보완점 대응 방안 3종의 화면 라벨 | 03 AI-02 `gaps[].actions[].type` |
| S-17 | "AI에게 맡기기"와 "직접 고르기"의 화면 차이(AI 모드에서 트리를 보일지), AI-11 실패 시 출처 표시 | 02 FL-03, S-17 |
| S-18 | 기본 3문항의 기본 글자 수·문구, 남은 횟수 < 문항 수일 때 "전체 생성" 처리 | 03 AI-04, 02 실행 버튼 사용량 안내 |
| S-19 | 자소서를 근거 변경 없이 다시 생성할 수 있는지(차감 1, reason explicit_regenerate), 경력기술서 재생성을 새 행으로 만들지 덮어쓸지(AI-03 "새 drafts 행" vs D-DM-06) | 03 AI-03/AI-04, 04 D-DM-06 |
| S-19 | `drafts.status` 화면 라벨, 초안·면접 세션 삭제의 하위 개수 문구(A0 보고에도 있음) | 04 A.9, 02 C-05 |

## 파운데이션 요청

1. **데이터 계층 함수 추가** (`src/lib/data/applications.ts`) — 지금은 `src/app/(dashboard)/applications/_lib/data.ts`에 같은 이름·모양으로 임시 구현. 옮겨 주시면 import만 바꾸고 shim 파일을 지운다:
   - `getCareerSourceTree()`(C-11 트리: 완료 경력·교육 → 완료 프로젝트 → 완료 상세 내용, 라벨 맵), `rankDraftSources(apId)`(AI-11 동기·무차감)
   - `createCareerDescriptionDraft(apId, options, regenerated_from_id)`, `createCoverLetterDraft(apId)`(기본 3문항 시드), `addCoverLetterQuestion(draftId)`, `deleteDraftSection(draftId, sectionId)`(최소 1)
   - 생성: `prepareCareerDescription` / `finalizeCareerDescription`, `prepareCoverLetterSection` / `finalizeCoverLetterSection` (섹션·근거 행·evidence_links 쓰기 + `usage_events` draft reserve → charge/release). 실제 백엔드에서는 SSE Route Handler로 바뀔 자리
   - `setSectionSources(sectionId, selections)`(C-11 변경), `markDraftCopied(draftId)`(`first_copied_at`), `markDraftEdited(draftId)`(`edited_at`), `retryJdExtraction(apId)`(AI-01 실패 재시도)
   - `listApplicationsForScreen()`: 목 전용 — 지금 목은 `getJobDescription()`을 불러야 추출이 끝나서 S-13이 대신 불러 줌. 목 store가 시간 기반으로 스스로 끝내 주면 삭제 가능
2. **`useAiStream` 결과의 sources 타입**: `sources_selected`가 `{label, rationale}`만 실어 와 C-11 배지(role/origin)를 스트리밍 중에는 못 그림. AI-04 이벤트에 `role`, `origin`, `requirement_ids`도 실어 주면 좋겠음.
3. **`ErrorState kind`**: 페이지에서 `state`(PreviewState)를 그대로 넘기면 타입 오류 — `PreviewState`를 `ErrorKind`로 좁히는 헬퍼(`previewErrorKind(state)`)가 있으면 A2·A4도 같은 오류를 피함(A4 `interview/` 페이지 두 곳이 지금 이 오류).
4. **RadioGroup 카드형 선택 스타일**: C-05 `CardRadio`가 `has-[:checked]`를 쓰는데 Radix Radio는 `<button data-state=checked>`라 폼 밖에서는 강조가 안 들어갈 수 있음. A3는 `has-[[data-state=checked]]`로 씀 — 공통 쪽 확인 부탁.
5. **`DataInsufficientGate`의 C-09 주 버튼 맥락**: 인사이트 보완점에서 열 때 "관련 요건을 대화 시작 맥락으로 표시"(C-09)하려고 `markCareerReturn(params.requirement_ids)`에 넣어 둠 — S-36(A2)이 이 params를 읽어 표시하도록 안내 필요.

## 검사 결과

- `pnpm typecheck` — 통과(전체 0 오류. 작업 중 A4 `interview/` 2건이 있었으나 최종 실행 시점에는 해소됨)
- `pnpm lint` — A3 파일 오류·경고 0. 전체 실행 결과 `✖ 2 problems (1 error, 1 warning)`는 A2 파일(`src/app/(dashboard)/career/page.tsx:30`, `src/components/career/project-form.tsx`) — 다른 영역 소관이라 손대지 않음
- `pnpm build` — 통과(모든 `/applications/**` 경로 Partial Prerender)
- `pnpm dev`(포트 3913) 스모크: `/applications`(+`?state=empty`), `/applications/new?from=board`, S-31, S-15, S-16(+`ai-pending`, `insufficient`), S-17(ap1, ap3 — AI-11 경로), S-19 경력기술서·자소서(+`ai-stream`), S-18 → 모두 200, 핵심 문구 렌더 확인, 서버 오류 로그 0건

---

## 라운드 1 수정 (QA `03_ui-qa_A3_review.md` 반영, 2026-10-25)

이슈 ID는 A2 리뷰와 범위가 겹쳐 **A3 UQ-xx**로 적는다. 커밋하지 않음.

### 이슈별 처리

| ID | 심각도 | 처리 | 내용 |
|----|--------|------|------|
| A3 UQ-60 | Major | 수정 | S-19 자동 저장: 저장할 때 대기 목록(`pendingEdits`)의 **현재 스냅샷**만 보내고, 저장이 끝난 섹션은 같은 값이면 목록에서 뺀다. 생성·다시 생성을 시작하면 그 섹션(경력기술서는 전체)의 대기 편집을 지운다(`dropPendingEdits`). 옛 편집이 새 AI 본문을 덮지 않음 (`draft-editor.tsx`) |
| A3 UQ-61 | Major | 수정 | shim 생성 계약을 바꿈: `prepare*`는 계획만 서버 메모리에 두고 저장본을 건드리지 않음 → 클라이언트가 스트림 종료 시 `finalize*(id, generation_id, { ok, completed_block_ids })`. 경력기술서 실패·중단 → **받은 블록만** 저장(초안 `partially_failed`), 받지 않은 블록 없음, 사용량 released. 화면은 종료 후 항상 새로고침해 남은 블록 + "초안을 끝까지 만들지 못했어요 · 다시 생성"을 보임. 미리보기(`?state=ai-failed`)는 받은 스트림 블록을 그대로 남김 |
| A3 UQ-62 | Major | 수정 | 자소서 문항: 성공했을 때만 `ai_content` 교체·`edited_content = null`·`generation_no + 1`·`sources_modified_at = null`·AI 근거 행 교체. 다시 생성이 실패·중단되면 이전 본문·편집본·"근거를 바꿨어요" 상태가 그대로. 첫 생성 중단은 받은 문단만 남기고 `status = failed` + "이 문항을 끝까지 만들지 못했어요 · 다시 생성" |
| A3 UQ-63 | Major | 수정 | `useRestoreReturnParams`: S-18(`cover_letter`), S-19(`career_description`/`cover_letter`, 초안 종류별), S-17(`career_description` 포함 항목 복원 + `cover_letter` → 서류 종류 "자기소개서" 복원). 돌아오면 복귀 대상이 지워져 C-10 배너가 사라짐 |
| A3 UQ-64 | Major | 수정 (`[UI-가정]`, P-A3-1 대기) | `OverwriteConfirm variant`: 경력기술서 "새 경력기술서 초안을 만들까요? … 지금 초안은 서류 초안 목록에 그대로 남아요"(버튼 "새 초안 만들기") / 자소서 "이 문항을 다시 생성할까요? … 이전 본문은 보관되지 않아요". 코드 동작(경력기술서 = 새 행 `regenerated_from_id`, 자소서 = 같은 섹션 덮어쓰기)과 일치 |
| A3 UQ-65 | Major | 수정(UI) / 파운데이션 의존 | 생성 중 화면이 `generating` 행의 `match_stage_result`에서 판정 표(`MatchTable partial`)를 먼저 그림 + 안내 한 줄. 단계가 `synthesize`/`validate`로 넘어가면 새로고침해 부분 결과를 읽음. 파싱은 `components/applications/insight-parse.ts`의 `parseMatchStage()`(`requirement_matches` 또는 `matches` 배열, 저장형 필드 `requirement_id`·`status`·`rationale`·`missing_aspect`). **목이 값을 채우는 것과 타입은 파운데이션** — 채워지면 화면 변경 없이 보임 |
| A3 UQ-67 | Major | 수정 (`[UI-가정]`, P-A3-2 대기) | S-18: 초안이 있는 문항 삭제 시 C-05 모양 확인 창("문항 삭제" — 초안·직접 고친 내용·사용한 경력·프로젝트가 함께 삭제, 되돌릴 수 없음). 삭제된 카드의 대기 자동 저장은 보내지 않음. shim `deleteDraftSection`이 섹션 소속도 확인(UQ-84(b) 함께) |
| A3 UQ-68 | Major | 수정 | 서버 새로고침이 와도 저장 전 편집이 있는 섹션(`dirty`)은 로컬 `edited_content`를 유지하고 나머지만 서버 값으로 바꿈 |
| A3 UQ-69 | Minor | 수정 | S-31 인사이트 카드에 "커리어가 바뀌었어요" 배지(S-16과 같은 규칙) |
| A3 UQ-70 | Minor | 수정 | S-16 보완점 "직접 입력"도 `params: { gap_item_key, requirement_ids }`를 복귀 대상에 실음 |
| A3 UQ-71 | Minor | 수정 | 추출 실패면 S-16·S-17·S-18·S-19가 `WaitJd` 대신 `JdFailedNotice`("공고 분석이 끝나지 않았어요. JD·요건에서 다시 시도하면 시작할 수 있어요" + S-15 링크, `[UI-가정]`). 실행 버튼은 계속 비활성 |
| A3 UQ-72 | Minor | 수정 | "채용 공고가 아닌 텍스트로 보여요"는 `error_code = 'not_a_jd'`(미리보기 `ai-failed-input`)일 때만, 그 밖 `input` 오류는 ST-AI-FAILED 기본 문구 |
| A3 UQ-73 | Minor | 수정 | 공고 원문을 `raw_text` 그대로 그리고 `start/end` 오프셋 구간만 강조. 오프셋이 맞지 않으면 문장 단위로 대체 |
| A3 UQ-74 | Minor | 수정 (shim) | `listApplicationsForScreen()` → `ApplicationListRow`(`insight_job_id` = 진행 중 AI-02 작업만). 인사이트 칸은 그 작업만 C-03 축약형, 재생성 중도 표시. 파운데이션이 요약에 같은 필드를 두면 shim에서 빼면 됨 |
| A3 UQ-75 | Minor | 수정 | S-31 인라인 수정은 바뀐 필드만 보냄 → 마감일만 고치면 `name_source = 'ai'`(AI 추출 배지) 유지, 빈 이름은 보내지 않음 |
| A3 UQ-76 | Minor | 수정 | "AI에게 맡기기"로 돌아가면 AI 기본 선택(인사이트 우선순위 / AI-11 / 대체)과 출처 배지를 되살림 |
| A3 UQ-77 | Minor | 수정 | S-18 "전체 생성" 사용량 = 초안이 없는 문항 수(S-19 queue와 같은 기준). 모두 있으면 비활성 + "모든 문항에 초안이 있어요…"(`[UI-가정]`) |
| A3 UQ-78 | Minor | 수정 | 자리 표시 목록 = 현재 본문에 남은 토큰(6종 정규식), hint는 블록 `placeholders`에서 같은 토큰으로 찾음. 임의 "[내용 확인 필요]" 삽입 제거 |
| A3 UQ-79 | Minor | 수정 | 문단 글자를 눌러도 편집(연필 버튼은 키보드 경로로 유지) → 안내 문구와 일치 |
| A3 UQ-80 | Minor | 수정 | C-11 트리 행 `min-h-11`(44px), 상세 내용 행도 같음 |
| A3 UQ-81 | Minor | 수정 | S-13은 `useSyncExternalStore(matchMedia ≥768px)`로 표/카드 중 하나만 렌더(서버는 표) → 행마다 단계 이동 상태 하나 |
| A3 UQ-82 | Minor | 수정 | S-14 `?state=unauth` → ErrorState unauth |
| A3 UQ-66, UQ-83, UQ-84 | — | 파운데이션 | 손대지 않음. UQ-84 중 shim 안에서 바로 고칠 수 있는 (b)는 고쳤고, (c)는 주석으로 표시. 나머지 (a)(d)(e)(f)(g)는 이관 작업 목록 |

### shim 함수 계약 (파운데이션 이관용, `src/app/(dashboard)/applications/_lib/data.ts`)

- `listApplicationsForScreen(opts): ApplicationListRow[]` — 요약 + `insight_job_id`
- `getCareerSourceTree(): SourceTree`, `deriveAffiliations(tree, projectIds)`, `rankDraftSources(apId, {fail})`
- `createCareerDescriptionDraft(apId, options, regenerated_from_id)`, `createCoverLetterDraft(apId)`, `addCoverLetterQuestion(draftId)`, `deleteDraftSection(draftId, sectionId): boolean`(최소 1 + 소속 확인)
- 생성: `prepareCareerDescription(draftId) → { generation_id, blocks }`, `finalizeCareerDescription(draftId, generation_id, GenerationResult)`, `prepareCoverLetterSection(sectionId) → { generation_id, sources, blocks }`, `finalizeCoverLetterSection(sectionId, generation_id, GenerationResult)`. `GenerationResult = { ok, completed_block_ids }`. prepare는 사용량 reserve + 대상 `generating`만, 저장본은 finalize에서만 바뀜(성공 = 덮어쓰기 + charge, 실패·중단 = 이전 유지 / 첫 생성은 받은 블록만 + release). 실제 백엔드에서는 SSE Route Handler가 같은 규칙으로 서버에서 확정
- `settleAbandonedGeneration(draftId)` — 20초 넘게 finalize 안 된 계획은 서버가 끝낸 것으로(성공) 처리, 계획 없이 `generating`에 남은 행도 정리
- `setSectionSources(sectionId, selections)`, `markDraftCopied`, `markDraftEdited`, `retryJdExtraction(apId)`

### 새 [UI-가정] (라운드 1)

| 화면 ID | 파일 | 내용 |
|---------|------|------|
| S-19 | `sources-used.tsx` | 다시 생성 확인 문구 2종(경력기술서 새 행 / 자소서 덮어쓰기) |
| S-19 | `draft-editor.tsx` | "초안을 끝까지 만들지 못했어요. 받은 부분만 남아 있어요", "이 문항을 끝까지 만들지 못했어요" + 다시 생성 |
| S-18 | `cover-letter-questions.tsx` | 문항 삭제 확인 창(초안 있는 문항만), "모든 문항에 초안이 있어요…" |
| S-16 | `insight-view.tsx` | 부분 결과 안내 "요건 대조가 끝난 결과를 먼저 보여 드려요…" |
| S-16~S-19 | `shared.tsx` | 추출 실패 안내 `JdFailedNotice` 문구 |

### 파운데이션 요청 (추가·유지)

- A3 UQ-65: `Insight.match_stage_result` 타입을 단계 1 저장형(`{ requirement_matches: [...] }` 등)으로 정하고, 목 `startInsight`/작업 진행이 `match` 단계 완료 후 값을 채우게. A3 파서는 `requirement_matches`·`matches` 둘 다 받음
- A3 UQ-66: `extraction.seniority` 객체 타입 + 픽스처 수정 → 그 뒤 A3가 `seniority.label`을 읽도록 바꿈
- A3 UQ-74: `ApplicationSummary`에 `insight_job_id`(또는 작업 종류별 ID) 추가 → shim의 보강 제거
- A3 UQ-83: 스트리밍 `sources_selected`에 role/origin/requirement_ids
- A3 UQ-84: shim 이관 시 (a) 서버 쪽 준비 상태·한도·`input_hash` 검사, (c) `usage_events.ai_job_id`에 실제 `ai_jobs.id`, (d) user 모드 rationale, (e) 살아 있는 원본은 현재 이름으로 라벨, (f) 확정을 서버에서, (g) AI-11 결과 재사용

### 검사 결과 (라운드 1)

- `pnpm typecheck` — 통과(전체 0 오류)
- `pnpm lint` — 통과(전체 0 문제. A2의 이전 오류도 이번 실행에는 없음)
- `pnpm build` — 통과(36 페이지)
- `pnpm dev -p 3914` 스모크: S-13, S-14(`unauth`), S-31, S-15(+`ai-failed-input`), S-16(ap1, ap2 생성 중), S-17, S-19 경력기술서(+`ai-failed`)·자소서, S-18 → 모두 200, 공고 원문이 원문 그대로 렌더, 서버 오류 로그 0건. 스트림 중단·실패 후 보존, 자동 저장 경합, 삭제 확인 창 같은 클라이언트 동작은 브라우저로 확인하지 않음(QA 재확인 필요)

---

## BYOK 반영 (2026-10-28)

기준: `_workspace/ui/05_brief_byok.md`, design-system v2(3.18 C-18 · 3.19 C-19 · 3.20 C-20 · 3.22 AiRunButton · C-03 무료 등급/대기 줄 · A3 메모), A0 "BYOK 파운데이션 (2026-10-28)", 기획 플로우 v5.2 · AI v4.2 · 데이터 모델 v4.1a. 파운데이션이 이미 한 기계적 교체(UsageHint → AiRunButton, AiFailed → AiErrorNotice, 사용량 문구 삭제, shim → `lib/data/drafts.ts`)는 유지하고 그 위에서 다듬었다. 커밋하지 않음.

### 화면별 반영

| 화면 | 반영 |
|------|------|
| S-13 | 키 없이 만든 JD 행에 "요건 정리 전"(`extraction_status = 'pending'`, 작업 없음). 분석 중 문구는 `running`일 때만. 인사이트 칸은 AI-02 작업만(기존) |
| S-14 | **키 없음**: C-18 인라인 안내 한 줄("AI를 연결하면 공고에서 회사명·포지션명·요건을 자동으로 정리해 드려요", 막지 않음) + **회사명·포지션명 입력란 펼침**, 비우면 기본 이름 "새 기업 JD (날짜)"(`name_source = 'default'`, 데이터 계층), 요건 추출 안 함(D-30). **키 있음**: 입력란은 "회사명·포지션명 직접 입력" 링크로 접어 두고 비우면 AI 추출, 만들기 옆 C-19(파운데이션). 이름 = "회사명 – 포지션명" |
| S-31 | `getAiConnection()` + `previewAiConnection`으로 잠금 판정. 키 없음이면 JD(요건 정리 전·실패)·인사이트·서류·면접 카드에 표식 — 결과 없음 "AI 연결 필요" / 결과 있음 "새로 만들려면 AI 연결"(요약은 그대로). JD 카드 "요건 정리 전 · 공고 원문은 열어 볼 수 있어요" |
| S-15 | `JdView`에 `requirementsSlot` 추가 — 요건이 없을 때 **요건 영역 자리만** 바꾸고 공고 원문 패널은 항상 그대로. 키 없음 → C-18 영역형(`requirements`), 키 있음 → "요건 정리 전" 카드 + "요건 정리하기" AiRunButton(C-19, 자동 실행 없음 D-30/D-UX-16), 실패 → C-20 block(7원인·`not_a_jd`·`key_missing`), 분석 중 → ST-AI-SYNC. 머리 설명도 요건 유무로 바뀜 |
| S-16 | FL-08 순서: **키 확인 → 데이터 준비**(키 없으면 C-09 대신 C-18). 결과 없음 + 키 없음 → C-18 영역형, 결과 있음 + 키 없음 → 결과 그대로 + "다시 생성" 자리만 C-18 인라인(D-36, D-UX-15). C-03에 `connectionTier`(무료 등급 순차 줄) + `?state=ai-waiting` 요청 한도 대기 줄. 실패 = C-20 block(공급자·`retry_after`·`quota_resets_at`). 결과 머리 C-19 결과 배지(파운데이션). 요건이 없으면 요건 추출 먼저(서버 액션 `ensureRequirements`) + 안내 한 줄 |
| S-17 | 키 없음: "초안 생성" = C-18 인라인, **AI-11(AI에게 맡기기) 호출 안 함** → 직접 고르기·최신 경력순 전체 기본, "AI에게 맡기기 (AI 연결 후)" 비활성. 자기소개서 "문항 설정하기"는 키 없이 가능. 게이트는 키가 있을 때만. 초안 목록 행에 C-19 결과 배지. 요건 추출 먼저(D-30) |
| S-18 | 문항 편집·메모는 키 없이, "전체 문항 생성"(이름 명세 맞춤)만 AiRunButton(C-18 인라인 / C-19). 게이트는 키가 있을 때만. 요건 추출 먼저 |
| S-19 | 상단에 C-19 결과 배지(`drafts.provider/model/model_tier`, 내용이 있을 때). 게이트는 키가 있을 때만. "이 문항만 생성"(명세 이름). C-20: 경력기술서 block(입력 = "포함 항목으로 돌아가기"), 자소서 섹션 inline(입력 = "문항 설정으로", 줄일 대상 "문항 메모"). 편집·복사는 키 없이(D-36). 요건 추출 먼저 |
| C-09 | 파운데이션 `DataInsufficientGate`의 키 무효·대화 실패 분기를 A3 4화면에 연결(`chatFailure`). 10회 분기 사용처 없음 |
| 문구 | A3 안 "차감·남은 횟수·한도·N회" 문구 0건(grep 확인). 재생성 주석은 "다시 하면 공급자 토큰을 다시 써요"(AiRunButton `rerun`) |

### `?state=` (BYOK 추가분)

| 화면 | 값 |
|------|----|
| S-14 | `ai-locked`(키 없음 입력란 펼침), `key-invalid`, `key-check` |
| S-31 | `ai-locked`(카드 표식), `key-invalid`, `key-check` |
| S-15 | `ai-locked`(키 없이 등록한 JD 미리보기: 요건 영역 C-18), `key-invalid`, `key-check`, `key-missing`, `ai-failed-rate-limited` · `-daily-quota` · `-billing` · `-key-invalid` · `-model` · `-provider` · `-input-rejected`, `ai-failed`(schema_invalid), `ai-failed-input`(not_a_jd), `ai-failed-timeout` |
| S-16 | 위 C-20 값 전부 + `key-missing`, `ai-pending`, **`ai-waiting`**, `ai-locked`(결과 있는 JD = 결과 + 인라인 잠금 / 결과 없는 JD(예: 클라우드나인) = 영역형), `key-invalid`, `key-check`, `insufficient` · `insufficient-no-experience` · **`insufficient-key-invalid`** · **`insufficient-chat-failed`** |
| S-17 · S-18 | `ai-locked`, `key-invalid`, `key-check`, `insufficient*` 4종, `wait-jd`(+S-17 `ranking-failed`) |
| S-19 | `ai-stream`, C-20 값 전부, `key-missing`, `ai-locked`, `key-invalid`, `key-check`, `insufficient*` 4종, `save-failed`, `wait-jd` |

### 새 파일

- `src/app/(dashboard)/applications/_lib/jd-state.ts` — `jdRunState(jd, state)` → `{ waitJd, jdFailed, extractFirst }`, `EXTRACT_FIRST_NOTE` (클라이언트 안전)
- `src/app/(dashboard)/applications/_lib/gate-preview.ts` — `gateReadinessPreview`, `gateChatFailurePreview` (서버 전용)
- 서버 액션 `ensureRequirementsAction(apId)` / `startInsightAction` 내부 `ensureRequirements` (`_lib/actions.ts`)

### [UI-가정] (BYOK)

| 화면 | 파일 | 내용 |
|------|------|------|
| S-13 | `application-list.tsx` | 행의 "요건 정리 전" 표시 |
| S-14 | `application-new-form.tsx` | 회사명·포지션명 두 칸 → 이름 "회사명 – 포지션명", 키 있을 때 접는 링크 "회사명·포지션명 직접 입력", 도움말 문구 2종 |
| S-31 | `[id]/page.tsx` | 표식 모양(outline 배지 + `Lock`), 인사이트 카드도 영역형이 아닌 표식만(카드 안 카드 회피 — 디자인 시스템 3.18은 "S-31 인사이트 카드 본문 영역형") |
| S-15 | `jd-view.tsx`, `jd/page.tsx` | "요건 정리 전" 카드 제목, 요건 없을 때 머리 설명, `?state=ai-locked`는 요건이 있는 JD에서도 "키 없이 등록한 JD" 모양으로 미리보기 |
| S-16~S-19 | `jd-state.ts` | 요건 추출 먼저 안내 "요건이 아직 정리되지 않아, 공고 요건을 먼저 정리한 뒤 시작해요" |
| S-17 | `drafts-view.tsx` | 키 없음: AI-11 안 부르고 최신 경력순 전체 + 직접 고르기, "AI에게 맡기기 (AI 연결 후)" |
| S-19 | `draft-editor.tsx` | C-20 입력 이동 글자 "포함 항목으로 돌아가기" / "문항 설정으로", 줄일 대상 "포함할 프로젝트" / "문항 메모" |
| C-09 | `gate-preview.ts` | 대화 실패 미리보기 원인 = `provider_unavailable` |

### 기획 확인 필요 (BYOK)

| 화면 | 질문 |
|------|------|
| S-14 | 키 없을 때 펼치는 "회사명·포지션명" 입력값을 `job_descriptions.company_name`/`position_title`(`*_source = 'user'`)에도 저장하는지, 이름만 만드는지. 지금은 이름만(데이터 계층에 입력 자리가 없음) |
| S-31 | 키 없음 표식이 디자인 시스템(인사이트 카드 본문 = C-18 영역형)과 명세("AI 연결 필요" 표식) 중 어느 쪽인지 |
| S-17 | 키가 없을 때 "AI에게 맡기기"(AI-11, AI 호출)를 막는 것이 맞는지, 기본 선택(인사이트 우선순위가 있으면 그것)은 키 없이도 쓰는지 |
| S-16~S-19 | "요건 추출 먼저"(D-30)를 화면에 어떻게 보일지 — 별도 진행 단계로 보일지, 안내 한 줄이면 되는지 |
| S-15 | 요건 추출 결과에도 C-19 결과 배지(`extraction_provider`)를 붙이는지(명세는 S-16·S-19·S-22만) |

### 파운데이션 요청 (BYOK)

1. `createApplicationProject({ company_name, position_title })` 입력 — S-14 키 없음 입력란을 JD 컬럼에도 저장할 수 있게(위 기획 확인 결과에 따라)
2. 생성 시작 서버 쪽에서 D-30 "요건 추출 먼저"를 한 작업으로 묶기 — 지금은 A3 액션이 `retryJdExtraction`을 먼저 부르고 바로 생성(목에서는 순서가 보장되지 않음)
3. `DraftSection`에도 실행 공급자 메타가 있으면 문항별 결과 배지를 붙일 수 있음(지금은 초안 단위 `drafts.provider`)
4. (A1 영역) `components/account/ai-connection-panel.tsx:168`, `ai-usage-panel.tsx:70` lint 오류 2건 — 전체 `pnpm lint` 실패 원인

### 검사 결과 (BYOK)

- `pnpm typecheck` — 통과(전체 0 오류)
- `pnpm lint` — A3 파일 0 문제. 전체는 `✖ 2 problems (2 errors)` — 모두 A1 `components/account/ai-connection-panel.tsx:168`, `ai-usage-panel.tsx:70`(손대지 않음)
- `pnpm build` — 통과(39 페이지)
- `pnpm exec next dev -p 3915`(확인 후 종료): S-13, S-14(기본·`ai-locked`), S-31(기본·`ai-locked`), S-15(기본·`ai-locked`·`ai-failed-daily-quota`), S-16(기본·`ai-locked` 결과 있음/없음·`ai-waiting`·`insufficient-key-invalid`·`key-missing`), S-17(`ai-locked`·`insufficient-chat-failed`), S-19 경력기술서(기본·`ai-failed-rate-limited`)·자소서(`ai-locked`), S-18(`ai-locked`) → 모두 200, C-18 영역형·S-15 원문 유지 문구·S-31 "새로 만들려면 AI 연결"·S-16 잠금 중 결과 유지·S-16/S-19 결과 배지 렌더 확인, 개발 로그 오류 0건. 브라우저 조작(FL-19 복귀 링·토스트, 무료 등급 대기 카운트다운, 키 없음 JD 생성 → 요건 정리하기)은 확인하지 않음

---

## BYOK 라운드 1 수정 (QA `06_ui-qa_byok_A3_review.md`, 2026-10-28)

커밋하지 않음. 리더 결정: UQ-236/P-A3B-1 — AI-11은 연결 후 복귀 때 자동 실행하지 않고 사용자 선택을 덮지 않음, P-A3B-2 — S-31 키 없음은 명세의 표식 유지(디자인 문서 정렬 예정).

| ID | 심각도 | 처리 | 내용 |
|----|--------|------|------|
| UQ-230 | Major | 수정 (`[UI-가정]`) | S-14 입력(공고 원문·회사명·포지션명·마감일)을 브라우저 세션 저장소에 진입 경로(목록/보드)별로 계속 저장하고, 다시 들어오면 복원 + "작성하던 내용을 불러왔어요". 만들기 성공·취소 때 지움. C-18 "AI 연결하기"로 S-41에 갔다 돌아와도 입력이 남음(FL-19). URL에는 아무것도 넣지 않음 |
| UQ-231 | Minor | 수정 | S-18 "전체 문항 생성"·"이 문항만 생성"은 요건 추출 시작(`ensureRequirementsAction`)을 **기다린 뒤** S-19로 이동. S-19 `?generate=` 자동 시작은 트리거를 보관하고, JD가 `running`이면 ST-WAIT-JD + 새로고침으로 기다렸다가 준비되면 시작. 키 없음·데이터 부족·추출 실패면 시작하지 않음 |
| UQ-232 | Minor | 파운데이션 | 손대지 않음(요건 추출 → 본 작업 체인, 기존 파운데이션 요청 2) |
| UQ-233 | Minor | 수정 | S-14 공고 원문 안내를 키 유무로 분기("AI를 연결하면 … 정리해 드려요"), 머리 설명을 요건 정리 약속 없는 문장으로 |
| UQ-234 | Minor | 부분 수정 / 파운데이션 | S-14 도움말의 기본 이름 날짜를 KST로 계산. 표시 함수 `applicationDisplayName`(`lib/data/labels.ts`)·기본 이름 생성(`createApplicationProject`)의 UTC 날짜는 파운데이션 몫 |
| UQ-235 | Minor | 수정 | S-19 경력기술서 일부 실패·자소서 문항 일부 실패의 "다시 생성"을 `AiRunButton rerun`(C-19 · 키 없으면 C-18 인라인 · "다시 하면 공급자 토큰을 다시 써요")으로. 부분 결과 안내 줄은 그대로 |
| UQ-236 | Minor | 수정 (`[UI-가정]`) | AI-11 자동 호출은 **키가 있는 상태로 들어온 첫 진입 한 번만**(03 AI-11 "자동 1회" 유지). 키 없이 들어온 경우, FL-19로 연결 직후 돌아온 경우, 화면에 있는 동안 키가 연결된 경우에는 자동 호출하지 않고 "직접 고르기 · 최신 경력순 전체"로 시작 → 사용자가 "AI에게 맡기기"를 고를 때 AI-11을 부름. 결과는 C-10 복원·직접 고르기·체크 수정이 있으면 선택을 덮지 않고 AI 기본값으로만 보관 |
| UQ-237 | Minor | 수정 | 요건 추출 먼저 안내 3곳을 `text-sm leading-5 text-muted-foreground`(meta)로 |
| UQ-238 | Minor | 수정 | 생성 거절 사유 순서를 키 없음 → 키 무효 → 데이터 부족(FL-08) |
| UQ-239 | Minor | 파운데이션 | 손대지 않음(스트림 오류 이벤트의 `retry_after`·`quota_resets_at`·`provider`) |
| UQ-240 | Minor | ui-designer | 손대지 않음(디자인 문서) |
| UQ-241 | Minor | 수정 | S-18 문항 카드마다 "이 문항만 생성"(`AiRunButton`, 키 없으면 C-18 인라인 / C-19) → 저장 먼저 하고 S-19 `?generate={문항}`. 초안이 있으면 "초안 보기". 이름이 달랐던 "문항별로 생성하기" 링크는 "초안 편집기 열기"(초안이 있을 때만)로 |

### 새 [UI-가정] (BYOK 라운드 1)

| 화면 | 파일 | 내용 |
|------|------|------|
| S-14 | `application-new-form.tsx` | 입력 세션 저장(경로별 키, 만들기·취소 시 삭제), 복원 안내 "작성하던 내용을 불러왔어요" |
| S-17 | `drafts-view.tsx` | AI-11 자동 호출 조건(위 UQ-236), 연결 직후 복귀 판정은 파운데이션의 "연결됨" 세션 값을 읽기만 함 |
| S-18 | `cover-letter-questions.tsx` | 카드 하단 "이 문항만 생성" / "초안 보기", 아래 "초안 편집기 열기" |

### 파운데이션 요청 (추가)

- `ai-connect-return.ts`에 소비하지 않는 `peekAiConnected(pathname)` export — 지금 S-17은 세션 키 이름(`resumate.ai-connected`)을 직접 읽음
- UQ-234: `applicationDisplayName`·기본 이름 날짜를 KST로

### 검사 결과 (BYOK 라운드 1)

- `pnpm typecheck` — 통과
- `pnpm lint` — 통과(전체 0 문제)
- `pnpm build` — 통과(39 페이지)
- `pnpm exec next dev -p 3916`(확인 후 종료): S-14(기본·`ai-locked`), S-17(ap1·ap3·`ai-locked`), S-18(기본·`ai-locked`, "이 문항만 생성" 렌더), S-19(`?generate=all`, 경력기술서) → 모두 200, 개발 로그 오류 0건. 세션 복원·대기 후 자동 시작·AI-11 미호출 경로는 브라우저로 확인하지 않음
