# UI QA — A3 기업 JD 관리 (라운드 1)

기준: 플로우 v4.2b · AI v3.2a · 데이터 모델 v3.2a · PRD v3.2a · 디자인 시스템 v1 · A0 라운드 1 규칙. 대상: S-13, S-14, S-31, S-15, S-16, S-17, S-18, S-19, C-11 (`src/app/(dashboard)/applications/**`에서 `[id]/interview/**` 제외, `src/components/applications/**`).
이슈 ID: A0 리뷰가 UQ-1~25, A4 리뷰가 UQ-26~49를 쓰고 있어 A4 재확인과 겹치지 않게 **UQ-60부터** 매겼다.

## 요약

- **Critical 0 / Major 9 / Minor 15** (영역 담당 A3: Major 8 · Minor 13, 파운데이션: Major 1 · Minor 2)
- 기계 검사: A3 파일은 `tsc` 0 오류, `eslint` 0 문제. 전체 `pnpm build`는 **A3 밖 파일 때문에 실패**(1회차: A1 `settings/page.tsx:56`, `settings/withdraw/page.tsx:55`의 ErrorKind 타입. 2회차: A4 `components/interviews/answer-sheet.tsx:99,115`의 선언 전 사용). 두 영역 모두 수정 중이라 A3 판정에는 넣지 않았다.
- 런타임: `pnpm dev`(포트 3937)에서 A3 경로 15개(`?state=` 포함)가 모두 200을 반환했다. S-15에서 "경력 조건: senior"가 실제로 렌더되는 것을 확인(UQ-66). 브라우저 조작(스트리밍, 다이얼로그, 자동 저장 경합)은 코드 경로를 읽어서 판단했다. 확인 뒤 dev 서버는 종료했다.
- 엔지니어가 뺀 Should/Could 판단은 모두 맞다: F-P2-03(요건 수정, Could), F-ST-06/S-38(전형 이력, Should), F-AP-04 메모(Should), F-DOC-05(다시 쓰기, Should), F-DOC-06(이전 버전, Could), F-AP-09(복제, Could). MVP 최소 범위에 들어가는 F-AP-04(이름·마감일 인라인 수정)와 F-P2-07("데이터 변경됨" + 다시 생성)은 구현돼 있다. 다만 F-P2-07 표시는 S-31에 빠져 있다(UQ-69).

## 화면별 점검표

| 화면 ID | Q1 스펙 행 | Q2 문구 | Q3–4 타입·필드 | Q5 라우트 | Q6 상태 | Q7 AI 모드 | Q8 디자인 | Q9 접근성 | Q10 좁은 화면 |
|---------|-----------|---------|----------------|-----------|---------|------------|-----------|-----------|---------------|
| S-13 | ✅ | ✅ | ⚠️ UQ-74 | ✅ | ✅ | ⚠️ UQ-74 | ✅ | ✅ | ⚠️ UQ-81 |
| S-14 | ✅ | ✅ (`[UI-가정]` 다수, P-A3-4) | ✅ | ✅ (`?from=board` → S-39 + "열기" 토스트) | ⚠️ UQ-82 | ✅ 무차감 안내 | ✅ | ✅ | ✅ |
| S-31 | ⚠️ UQ-69 | ✅ | ⚠️ UQ-75 | ✅ (C-12/13/14 공통 컴포넌트, 삭제 → S-13) | ✅ | ✅ | ✅ | ✅ 인라인 수정 포커스 복귀 | ✅ |
| S-15 | ✅ | ⚠️ UQ-72 | ❌ UQ-66 | ✅ | ✅ | ✅ 동기 스피너 "공고를 분석하고 있어요" | ✅ | ✅ aria-pressed | ⚠️ UQ-73 |
| S-16 | ❌ UQ-65, ⚠️ UQ-70 | ✅ | ✅ | ✅ (S-36/S-10/C-10) | ⚠️ UQ-71 | ❌ UQ-65 | ✅ | ✅ | ✅ 표 → 카드 |
| S-17 | ⚠️ UQ-76 | ✅ | ✅ | ✅ | ⚠️ UQ-63 | ✅ AI-11 동기 `rank` + 실패 시 조용히 대체 | ✅ | ⚠️ UQ-80 | ✅ |
| S-18 | ⚠️ UQ-67 | ✅ 포부 힌트 문구 일치 | ✅ `template_key` 시드 3종 | ✅ | ❌ UQ-63, ⚠️ UQ-77 | — | ✅ | ✅ | ✅ |
| S-19 | ⚠️ UQ-61, UQ-64 | ⚠️ UQ-64, UQ-79 | ✅ C-11 필드명 일치 | ✅ | ❌ UQ-63 | ❌ UQ-61, UQ-62 | ✅ | ✅ | ✅ Sheet + Collapsible |
| C-11 | ✅ | ✅ "근거 없이 메모·공고 내용만으로 작성돼요" | ⚠️ UQ-84(e) | — | — | — | ✅ | ⚠️ UQ-80 | ✅ |
| 자동 저장 (S-19) | — | — | — | — | — | — | — | — | ❌ UQ-60, UQ-68 (데이터 무결성) |

## 이슈

### Major

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-60 | Major | A3 | S-19 | 02 C-06 자동 저장, S-19 "문항 다시 생성은 같은 섹션 덮어쓰기", 03 AI-04 저장(`edited_content`) | `components/applications/draft-editor.tsx:117-133` (`pendingEdits`를 비우지 않음), `:120` | 저장된 편집은 대기 목록에서 빠지고, 다시 생성한 섹션은 새 AI 본문이 그대로 남는다 | `pendingEdits.current`가 누적만 되고 비워지지 않는다. 그래서 저장할 때마다 편집한 적 있는 **모든** 섹션을 다시 보낸다. 문항 1을 고친 뒤 다시 생성하면 prepare가 `edited_content`를 null로 비우는데, 이어서 문항 2를 고치면 문항 1의 **옛 편집 블록**이 `saveEditedContentAction`으로 다시 저장된다. 그러면 `blocksOf()`가 `edited_content`를 먼저 읽으므로 새로 생성한 본문이 조용히 옛 글로 덮인다. 저장이 성공한 섹션은 대기 목록에서 지우고, 생성을 시작할 때 그 섹션의 대기 편집도 지워야 한다 |
| UQ-61 | Major | A3 | S-19 (경력기술서) | 02 C-04, 03 AI-03 "스트리밍 중단 → 완료된 블록은 보존", ST-AI-FAILED | `draft-editor.tsx:186-208`, `:386-416`. shim `_lib/data.ts:400-497` | 중단하거나 실패해도 이미 받은 블록은 화면과 저장본에 남고, 받지 않은 블록은 없다 | ① 중단·실패 뒤 `current = null`이 되면 `stream.blocks`가 더는 그려지지 않고, 로컬 `sections`(새 초안이면 빈 배열)만 남는다. 그래서 받은 블록이 사라지고 "아직 생성된 내용이 없어요"만 보인다. ② shim은 prepare 단계에서 **모든 블록이 든 `ai_content`**를 미리 써 두고, 실패하면 `status = failed`로만 바꾼다. 다시 들어오면 받지 않은 블록까지 전부 보이고, 섹션마다 "이 섹션을 만들지 못했어요"도 함께 뜬다. 사용량은 `released` 상태라 차감 없이 전체 본문을 얻는 셈이다 |
| UQ-62 | Major | A3 | S-19 (자기소개서) | 02 C-11 "다시 생성 … 성공 시 `generation_no + 1`, `sources_modified_at = null`", ST-AI-FAILED "사용량은 차감되지 않았습니다 + 다시 시도" | `_lib/data.ts:599-607` (prepare 단계에서 `edited_content = null`, `generation_no += 1`, `sources_modified_at = null`), `:619-620` (실패하면 `ai_content = null`) | 다시 생성이 실패하거나 중단되면 이전 본문·편집본과 "근거를 바꿨어요" 상태가 그대로 남는다 | 생성을 **시작할 때** 편집본을 지우고, 실패·중단되면 AI 본문까지 지운다. 다시 생성이 실패하면 사용자가 쓰던 글이 모두 사라지고, `sources_modified_at`도 이미 지워져 "변경 사항으로 다시 생성" 버튼이 없어진다. 처음 생성할 때도 중단하면 받은 문단이 사라진다. `lib/data`로 옮길 때는 "성공했을 때만 덮어쓰기"가 기본이어야 한다 |
| UQ-63 | Major | A3 | S-17 / S-18 / S-19 | 02 FL-13 "돌아가면 지운다", C-10 "원래 화면의 진행 중 설정 복원", A0 영역 규칙 3 | `cover-letter-questions.tsx:122-134` (게이트 `returnFeature="cover_letter"`, consume 없음), `draft-editor.tsx:271-283` (consume 없음), `drafts-view.tsx:153` (`career_description`만 consume, 게이트는 `returnFeature={kind}`) | 복귀 화면이 진입할 때 `consumeReturnParams(apId, feature)`를 불러 설정을 복원하고 복귀 대상을 지운다 | `feature = 'cover_letter'`인 복귀 대상을 아무 화면도 읽거나 지우지 않는다. S-19의 `career_description` 게이트로 들어간 경우도 S-19는 지우지 않는다. 그래서 돌아온 뒤에도 커리어 화면마다 C-10 복귀 배너가 계속 뜬다. S-17에서 "자기소개서"를 고른 채 게이트로 나갔다 돌아오면 서류 종류도 복원되지 않는다 |
| UQ-64 | Major | A3 | S-19 (경력기술서) | 03 AI-03 저장 "재생성은 새 `drafts` 행(이전 행 보존)" | `sources-used.tsx:58` (확인 문구), `draft-editor.tsx:237-251` (`createCareerDescriptionAction(..., draft.id)`로 새 행) | 확인 문구가 실제 동작을 맞게 설명한다 | 문구는 "이전 초안은 보관되지 않아요"인데, 경력기술서는 새 초안 행을 만들고 이전 행이 S-17 목록에 그대로 남는다(뜻이 바뀐 문구). 자기소개서(같은 섹션 덮어쓰기)에는 맞는 문구라 종류별로 나눠야 한다. 어느 동작이 맞는지는 P-A3-1 기획 확인과 함께 정한다 |
| UQ-65 | Major | A3 | S-16 | 02 FL-11 "AI-02 비동기 30~45초, 단계 1 완료 시 판정 표 먼저", C-03 "부분 결과: 인사이트 단계 1 판정 표" | `components/applications/insight-view.tsx:124-134` | 단계 1이 끝나면 생성 중 화면에 요건별 판정 표를 먼저 보인다 | 생성 중에는 고정 Skeleton만 보이고, 부분 결과를 그리는 경로가 없다. 파운데이션 의존: `Insight.match_stage_result`의 타입이 `Record<string, unknown>`이고(`types/db.ts:548`), 목 `startInsight`가 이 값을 null로만 둔다(`lib/data/applications.ts:392`). 파운데이션이 단계 1이 끝난 뒤 `match_stage_result`(매칭 배열)를 채우도록 목·타입을 고치고, A3는 `generating` 행의 값으로 표를 그린다 |
| UQ-66 | Major | 파운데이션 | S-15 | 03 AI-01 출력 `seniority: {min_years, max_years, label, source_sids}` | `src/types/db.ts:481` (`seniority?: string \| null`), `src/lib/mock/fixtures.ts:633` (`seniority: "senior"`), 사용처 `app/(dashboard)/applications/[id]/jd/page.tsx:86` | 경력 조건 줄에 `label`(예: "5년 이상")을 보인다 | 타입이 문자열이고 목 값이 영어 "senior"라 화면에 "경력 조건: senior"가 나온다(dev에서 확인). 파운데이션이 타입을 AI-01 객체 형태로 고치고 픽스처도 바꾼 뒤, A3가 `seniority.label`을 읽도록 바꾼다 |
| UQ-67 | Major | A3 | S-18 | 01 F-DOC-02 "문항 수정·추가·삭제(최소 1)", 02 C-05 원칙(파괴 동작 확인) | `cover-letter-questions.tsx:81-85`, `:212-216`, shim `_lib/data.ts:297-305` | 생성된 초안이 있는 문항(카드에 "· 초안 있음" 표시)을 지울 때는 확인을 받는다 | 확인 없이 바로 지운다. 그 문항의 본문·편집본·`draft_section_sources`·`evidence_links`가 함께 사라지고 되돌릴 수 없다. 카드의 대기 중 자동 저장은 언마운트할 때 이미 지워진 섹션으로 저장을 시도한다. 확인이 필요한지는 P-A3-2 참고(C-05 대상 목록에 S-18이 없음). 보수적으로 "초안 있음" 문항은 확인을 받는 쪽을 권한다 |
| UQ-68 | Major | A3 | S-19 | 02 C-06 자동 저장 | `draft-editor.tsx:106-110` | 서버 새로고침이 저장되지 않은 로컬 편집을 덮지 않는다 | `draft.sections`가 바뀌면 `current === null`일 때마다 로컬 `sections`를 서버 값으로 통째로 바꾼다. 다른 문항 생성이 끝나며 `router.refresh()`가 돌면, 800ms 디바운스 안에 있던 편집이 화면에서 옛 값으로 돌아간다. 그 블록을 이어서 고치면 옛 텍스트를 바탕으로 새 편집이 만들어져 앞선 입력이 사라진다. 대기 중인 편집이 있는 섹션은 덮지 말아야 한다 |

### Minor

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-69 | Minor | A3 | S-31 | 02 1.4 "F-P2-03, 07, 08 \| S-15 / **S-31·S-16** \| F-P2-07 '데이터 변경됨' 상태 표시만" | `app/(dashboard)/applications/[id]/page.tsx:90-117` | 인사이트 카드에도 "데이터 변경됨"(커리어가 바뀌었어요) 표시 | S-16에만 있고 허브 카드에는 없다 |
| UQ-70 | Minor | A3 | S-16 → S-10 | 02 S-10 상태 "S-16 보완점에서 열면 '관련 요건: {요건 content}' 참고 문구", FL-11 | `insight-view.tsx:330` | "직접 입력"도 관련 요건 정보를 함께 넘긴다(AI 대화 링크처럼 `params.requirement_ids`) | `markCareerReturn(returnTarget)`만 불러 params가 없다. S-10(A2)이 참고 문구를 보일 수 없다 |
| UQ-71 | Minor | A3 | S-16·S-17·S-18·S-19 | 02 ST-WAIT-JD, FL-08 | `insight/page.tsx:95`, `drafts/page.tsx:90`, `questions/page.tsx:80`, `[draftId]/page.tsx:111` (`extraction_status !== "succeeded"`) | 추출이 **실패**하면 "공고 분석이 끝나면…" 대신 S-15 다시 시도로 안내한다 | 추출이 실패해도 `WaitJd`가 계속 보여, 끝나지 않을 대기를 안내한다 |
| UQ-72 | Minor | A3 | S-15 | 02 S-15 "`error_category = 'input'`(`not_a_jd`)이면 '채용 공고가 아닌 텍스트로 보여요'", 03 C-6 `input` 범주 = `not_a_jd`·`insufficient_data`·`input_too_long` | `components/applications/jd-view.tsx:156`, `jd/page.tsx:39` | 이 문구는 `error_code = 'not_a_jd'`일 때만 쓰고, 그 밖의 `input` 오류는 ST-AI-FAILED 기본 문구를 쓴다 | `category === "input"`만 보고 판단해서 `input_too_long`에도 "채용 공고가 아닌 텍스트로 보여요"가 나온다 |
| UQ-73 | Minor | A3 | S-15 | 03 C-2 "화면은 `start/end` 오프셋으로 원문을 하이라이트", 01 F-P2-01 "원문 보존" | `jd-view.tsx:47-61` | 원문 줄바꿈을 그대로 두고 문장 구간만 강조한다 | 문장마다 `"\n"`을 넣어, 한 줄에 있던 여러 문장이 줄마다 나뉜다(원문 모양이 바뀜) |
| UQ-74 | Minor | A3 | S-13 | 02 S-13 기능 진행 "인사이트(없음/생성 중/있음)" | `application-list.tsx:247`. 파운데이션 `lib/data/applications.ts:51-53,65` | 인사이트 칸에는 인사이트 작업의 진행만, 재생성 중이면 "생성 중" | `running_job_ids[0]`은 채점 같은 다른 작업일 수 있어 인사이트 칸에 "답변 채점 중"이 뜰 수 있다. 생성 중인데 작업 ID가 없으면 "없음"이 뜬다. `insight_state`는 ready 행이 있으면 재생성 중에도 "ready"다. 요약에 작업별 ID(`insight_job_id`)를 두도록 파운데이션에 요청 |
| UQ-75 | Minor | A3 | S-31 | 04 A.5 `name_source`(user/ai/default), 02 S-31 "AI 추출" 배지 | `components/applications/hub-header.tsx:59` | 마감일만 고치면 이름을 보내지 않는다 | 항상 `name`을 보내 `updateApplicationProject`가 `name_source = 'user'`로 바꾼다(`lib/data/applications.ts:187`). 그래서 마감일만 고쳐도 "AI 추출" 배지가 사라진다. 추출 대기(name null) 중에 빈 이름으로 저장하면 `name = null` + `name_source = 'user'`가 된다 |
| UQ-76 | Minor | A3 | S-17 | 02 C-11 경력기술서 출처 `selection_origin`, S-17 "AI에게 맡기기" | `drafts-view.tsx:145`, `:203`, `:241`, `:257` | "AI에게 맡기기"로 돌아가면 AI(또는 인사이트) 기본 선택과 출처를 되살린다 | "직접 고르기"에서 바꾼 체크와 `origin = 'user'`가 남은 채 AI 라디오만 선택된다. 배지 "직접 고름"과 라디오가 서로 맞지 않는다 |
| UQ-77 | Minor | A3 | S-18 → S-19 | 02 실행 버튼 사용량 안내 "이 작업으로 {k}회 사용" | `cover-letter-questions.tsx:88`, `:161`, `draft-editor.tsx:230` | 안내하는 사용량 = 실제로 생성하는 문항 수 | S-18은 전체 문항 수로 안내하는데, S-19는 이미 생성된 문항을 건너뛴다. 모두 생성돼 있으면 "전체 생성"을 눌러도 아무 일도 일어나지 않는다 |
| UQ-78 | Minor | A3 | S-19 | 02 C-08, 03 C-5 (토큰 6종 + `{token, hint}`) | `draft-editor.tsx:265-269` | 자리 표시 목록 = 본문에 실제로 남은 토큰 | `placeholders`가 비어 있으면 실제 토큰과 상관없이 "[내용 확인 필요]"를 넣는다. 사용자가 토큰 하나를 채워도 목록은 원래 배열 전체를 계속 보인다 |
| UQ-79 | Minor | A3 | S-19 | — (화면 안내 문구) | `app/(dashboard)/applications/[id]/drafts/[draftId]/page.tsx:56`, `draft-editor.tsx:490-503` | 안내와 실제 동작이 같다 | "문단을 눌러 고칠 수 있어요"라고 안내하지만 문단을 클릭해도 편집되지 않고, 연필 버튼만 동작한다 |
| UQ-80 | Minor | A3 | S-17·S-19 (C-11) | 디자인 시스템 1.3 `pad-row` "트리 행(최소 높이 44px)" | `components/applications/source-tree.tsx:130` (`min-h-9`), `:153` (`min-h-8`) | 트리 행 최소 44px(터치 대상) | 36px / 32px |
| UQ-81 | Minor | A3 | S-13 | 디자인 시스템 5.2 넓은 화면 표 / 좁은 화면 카드 | `application-list.tsx:93-104`, `:123` | 행마다 단계 이동 상태가 하나 | 표와 카드를 둘 다 렌더해 행마다 `useStageMove`가 두 벌이다. 한쪽에서 옮긴 뒤 창 폭을 바꾸면 다른 쪽은 옛 단계를 보인다. `router.refresh()`로 결국 맞춰지긴 한다 |
| UQ-82 | Minor | A3 | S-14 | 02 공통 상태 ST-UNAUTH | `app/(dashboard)/applications/new/page.tsx:35-41` | `?state=unauth` → ErrorState unauth | 처리가 없어 폼이 그대로 보인다(다른 A3 화면은 모두 처리함) |
| UQ-83 | Minor | 파운데이션 | S-19 (C-04) | 03 AI-04 `sources_selected` 이벤트, 02 C-11 role/origin | `components/common/streaming.tsx` (`sources`가 `{label, rationale}`만 가짐), 사용처 `draft-editor.tsx:614-621` | 스트리밍 중 선택 카드에도 주 근거/보조·AI 선택 배지를 보인다 | 이벤트 형태에 role/origin/requirement_ids가 없다(A3 보고 파운데이션 요청 2와 같은 건) |
| UQ-84 | Minor | 파운데이션 | — (shim 이관 메모) | 03 C-6, FL-08, AI-11 트리거, C-11 | 아래 항목 | `_lib/data.ts`를 `lib/data/`로 옮길 때 그대로 가져가면 깨지는 부분 | (a) `prepareCareerDescriptionAction` / `prepareCoverLetterSectionAction`(`_lib/actions.ts:107-121`)에 서버 쪽 준비 상태(D-01)·한도·`input_hash` 재사용 검사가 없다. 지금은 UI만 막는데, 생성이 URL `?generate=1\|all`로도 시작되므로(`draft-editor.tsx:221-235`) 서버에서 반드시 막아야 한다(인사이트는 한도만 검사, `_lib/actions.ts:57-61`). (b) `deleteDraftSection`이 섹션이 그 초안에 속하는지 확인하지 않는다(`_lib/data.ts:301`). (c) `usage_events.ai_job_id`에 초안·섹션 ID를 넣는다(`_lib/data.ts:323`). 실제로는 `ai_jobs` 행 ID여야 한다. (d) 사용자가 고른 근거는 `rationale = null`이다(`_lib/data.ts:674`). AI-04의 user 모드는 모델이 이유를 채운다. (e) C-11 경로 라벨을 항상 `source_label` 스냅샷으로 보인다. 원본이 살아 있으면 지금 이름으로 만들어야 한다. (f) 완료·실패 확정을 클라이언트가 호출하고, 이탈은 20초 규칙(`settleAbandonedGeneration`)으로 처리한다. SSE Route Handler에서는 서버가 확정한다. (g) AI-11을 S-17에 들어올 때마다 호출한다(`drafts-view.tsx:164-182`). 스펙은 같은 `career_snapshot_hash` + `requirements_hash` 결과가 있으면 호출하지 않는다. A3 화면 코드 문제는 아니고, 계획된 파운데이션 이관 작업에서 처리할 목록이다 |

## 기획 확인 필요

| ID | 화면 | 내용 (양쪽 인용) |
|----|------|------------------|
| P-A3-1 | S-19 | 03 AI-03 저장: "재생성은 새 `drafts` 행(이전 행 보존, 이전 버전 열람은 Could)". 반면 01 D-DM-06 "자소서 재생성 시 이전 생성본 보관 **(a) 보관 안 함**", 02 S-19 "문항 다시 생성은 같은 섹션 덮어쓰기(이전 생성본 보관 없음)". 경력기술서도 덮어쓰는지, 새 행을 만드는지 정해야 확인 문구(UQ-64)와 S-17 목록 동작이 정해진다. A3 보고에도 같은 질문이 있다 |
| P-A3-2 | S-18 | 02 C-05 대상 목록(4.1 F-COM-04 "C-05 (S-08~S-12, S-34~S-36, **S-17, S-19**, S-20, S-22, S-37)")에 S-18 문항 삭제가 없다. 01 F-DOC-02는 "문항 수정·추가·삭제(최소 1)"만 적었다. 생성된 문항을 지울 때 확인이 필요한지(UQ-67) |
| P-A3-3 | S-16 / S-31 | F-P2-07 "데이터 변경됨"의 판단 기준: 근거 상태(변경됨·원본 삭제됨, 지금 구현)인지 `insights.career_snapshot_hash` 비교인지. 03 C-6은 `career_snapshot_hash`를 재사용 판정에만 언급한다. A3 보고와 같은 질문 |
| P-A3-4 | S-14, S-15~S-19 | 02가 "v3와 같음"이라고 적은 세부 명세가 저장소에 없다(디자인 시스템 P-6, A0 P-QA). A3 `[UI-가정]` 28곳이 이 공백에서 나왔다. 특히 U-6 "S-14 안내 확정"이라는데 그 안내 문구 자체가 없다 |

## 재확인 결과

라운드 1이라 이전 A3 이슈는 없다. A0 리뷰에서 넘어온 규칙의 적용 여부만 확인했다.

| 항목 | 결과 | 메모 |
|------|------|------|
| UQ-3 페이지 패턴(ScreenSuspense) | 해결(준수) | A3 페이지 8개 모두 기본 export가 동기이고, 데이터는 `Screen` 안에서 읽는다 |
| A0 규칙 3 `consumeReturnParams` | 미해결(부분 적용) | S-16·S-17(경력기술서)만 적용. UQ-63 |
| A0 규칙 7 C-12~C-14 공통 import | 해결(준수) | `StageCardMenu` / `StageChip` / `useStageMove` 사용, 영역에서 다시 만들지 않음 |
| `routes.*`만으로 링크 | 해결(준수) | 하드코딩된 경로 0건. `?generate=` 쿼리만 문자열로 붙임 |
| 하드코딩 색 | 해결(준수) | 원시 색·팔레트 클래스 0건. 임의 값은 디자인 시스템 토큰 정의(`leading-[1.75]` prose, `max-w-[42rem]`)와 같은 값만 씀 |

## 기계 검사 출력

- `pnpm typecheck` (`tsc --noEmit`): 통과. 마지막 실행 기준 전체 0 오류. 1회차 build에서 A1 오류가 보였다가 다음 실행에서 사라짐.
- `pnpm lint`: 전체 통과(exit 0). `eslint src/app/(dashboard)/applications src/components/applications`도 0 문제.
- `pnpm build`: **실패 — 모두 A3 밖**
  - 1회차: `src/app/(dashboard)/settings/page.tsx(56,21)`, `settings/withdraw/page.tsx(55,21)` TS2322 `PreviewState` → `ErrorKind` (A1, 수정 중)
  - 2회차: `src/components/interviews/answer-sheet.tsx(99,6)`, `(115,25)` TS2448/TS2454 `previewRetried` 선언 전 사용 (A4, 수정 중)
  - 컴파일 단계(Turbopack)는 두 번 모두 성공했다. A3 파일에서 나온 오류는 없다.
- `pnpm dev -p 3937` 스모크(확인 뒤 종료): `/applications?state=empty`, `/applications/new?from=board`, S-31(+`wait-jd`), S-15(+`ai-failed-input`), S-16(+`limit`, `insufficient`), S-17(+`ranking-failed`), S-19 경력기술서·자기소개서, S-18 → 모두 200, 개발 로그 오류 0건. S-15 HTML에서 "경력 조건: senior" 확인(UQ-66).

---

# 라운드 2 (최종, 2026-10-25)

이번 라운드에 확인한 변경: A3 "라운드 1 수정"(`03_frontend-engineer-A3_report.md`, 새 prepare*/finalize* 계약)과 파운데이션 배치(`02_frontend-engineer-A0_report.md`의 "파운데이션 배치 (Phase 3)"). 파운데이션 배치에서는 `_lib/data.ts`가 `lib/data/drafts.ts`로 옮겨졌고, `insight_job_id`, `StreamSource` role/origin, 목의 `match_stage_result` 채우기, `JdSeniority` 타입이 들어왔다.
확인 방법: 코드 재검토 + 기계 검사 + dev 스모크. 스트리밍 중단, 자동 저장 경합, 삭제 확인 창 같은 클라이언트 상호작용은 이번에도 브라우저로 조작하지 않고 코드 경로를 읽어 판단했다.

## 요약 (라운드 2)

- 라운드 1 이슈 25건(UQ-60~84): **해결 23**(UQ-60~82), **부분 해결 1**(UQ-83: 데이터는 오지만 S-19 화면 표시가 남아 UQ-85로 분리), **부분 해결 + 일부 보류 1**(UQ-84: (a) 서버 검사와 (b)는 해결, (a)의 input_hash 재사용과 (c)~(g)는 실제 백엔드로 보류). 재발 0건. 상세는 아래 표.
- 새 이슈: **Critical 0 / Major 0 / Minor 3**(UQ-85~87)
- 기계 검사: `pnpm typecheck` 통과, `pnpm lint` 통과, `pnpm build` **통과**(36 페이지, A3 경로 모두 Partial Prerender)
- dev 스모크(포트 3951, 확인 후 종료): A3 경로 19개 모두 200, 개발 로그 오류 0건. 확인한 렌더 내용: S-15 "경력 조건: 5년 이상", S-14 `?state=unauth` → ErrorState "접근할 수 없는 페이지예요"
- **판정: 통과.** Critical·Major가 남아 있지 않다.

## 재확인 결과

| ID | 결과 | 메모 |
|----|------|------|
| UQ-60 | 해결 | `draft-editor.tsx` 자동 저장이 대기 목록의 스냅샷만 보낸다. 저장이 끝나고 값이 같으면 목록에서 빼고, 생성을 시작할 때 `dropPendingEdits`로 그 섹션의 대기 편집을 지운다. 옛 편집이 새 본문을 덮는 경로가 사라졌다 |
| UQ-61 | 해결 | prepare는 서버 메모리에 계획만 만들고 저장본을 건드리지 않는다. finalize가 실패·중단 시 `completed_block_ids`에 든 블록만 저장하고(`lib/data/drafts.ts` `finalizeCareerDescription`, 상태 `partially_failed`, 사용량 released), 화면은 종료 후 새로고침한다 |
| UQ-62 | 해결 | `finalizeCoverLetterSection`은 성공일 때만 `ai_content` 교체, `edited_content = null`, `generation_no + 1`, `sources_modified_at = null`을 적용한다. 다시 생성이 실패하면 이전 상태를 그대로 둔다. 첫 생성 중단은 받은 문단만 남긴다 |
| UQ-63 | 해결 | S-18(`cover_letter`), S-19(종류별, `draft-editor.tsx:129`), S-17(`career_description`·`cover_letter`) 모두 진입할 때 consume한다. 부작용 하나는 UQ-87로 분리 |
| UQ-64 | 해결 (`[UI-가정]`, P-A3-1 대기) | `OverwriteConfirm variant`. 경력기술서 "지금 초안은 서류 초안 목록에 그대로 남아요", 자기소개서 "이전 본문은 보관되지 않아요". 두 문구 모두 실제 코드 동작과 일치 |
| UQ-65 | 해결 (코드 기준) | 페이지가 `parseMatchStage(generating.match_stage_result)`로 부분 판정 표와 안내 문구를 그린다. 목은 `getAiJob` 진행 중 배치가 끝날 때마다 값을 채운다(`lib/data/ai-jobs.ts:178-195`). 스모크 시점의 ap2 픽스처 작업은 첫 배치 전이라 SSR에는 아직 표가 없었다. 클라이언트 폴링 뒤 나타나는 것은 브라우저로 확인하지 않았다 |
| UQ-66 | 해결 | `JdSeniority` 타입, 픽스처 "5년 이상", `jd/page.tsx:88`이 `seniority.label`을 읽는다. dev에서 "경력 조건: 5년 이상" 확인 |
| UQ-67 | 해결 (`[UI-가정]`, P-A3-2 대기) | 초안이 있는 문항만 확인 창을 띄운다(`cover-letter-questions.tsx:213`, `:341`). `deleteDraftSection`은 섹션 소속도 확인한다 |
| UQ-68 | 해결 | `dirty` 섹션은 서버 새로고침이 와도 로컬 `edited_content`를 유지한다 |
| UQ-69 | 해결 | S-31 인사이트 카드에 "커리어가 바뀌었어요" 표시 |
| UQ-70 | 해결 | "직접 입력" → `routes.projectNew({ requirement_id })` + 복귀 대상 params(`insight-view.tsx:301-302`) |
| UQ-71 | 해결 | 추출 실패 시 `JdFailedNotice` + S-15 링크 |
| UQ-72 | 해결 | `notAJd`(`error_code = 'not_a_jd'` 또는 미리보기 `ai-failed-input`)일 때만 그 문구를 쓰고, 나머지 `input` 오류는 기본 문구(`jd/page.tsx:60`) |
| UQ-73 | 해결 | `raw_text`를 그대로 그리고 `start/end` 오프셋 구간만 강조한다. 오프셋이 맞지 않으면 문장 단위로 대체 |
| UQ-74 | 해결 | 파운데이션 `ApplicationSummary.insight_job_id` 사용(`application-list.tsx:266`). `listApplicationsForScreen`은 삭제됐다 |
| UQ-75 | 해결 | 바뀐 필드만 보낸다(`hub-header.tsx:59-64`). 빈 이름은 보내지 않는다 |
| UQ-76 | 해결 | "AI에게 맡기기"로 돌아가면 기본 선택과 출처 배지를 되살린다 |
| UQ-77 | 해결 | 사용량 = 초안이 없는 문항 수(`cover-letter-questions.tsx:104-108`). S-19 queue와 같은 기준 |
| UQ-78 | 해결 | 본문에 실제로 남은 토큰을 정규식으로 찾는다. 임의로 넣던 "[내용 확인 필요]"는 제거 |
| UQ-79 | 해결 | 문단 클릭으로 편집되고, 연필 버튼은 키보드 경로로 남았다 |
| UQ-80 | 해결 | 트리 행 `min-h-11`(`source-tree.tsx:130`, `:153`) |
| UQ-81 | 해결 | `useSyncExternalStore(matchMedia)`로 표와 카드 중 하나만 렌더(서버 스냅샷은 표). 행마다 단계 이동 상태가 하나 |
| UQ-82 | 해결 | S-14 `?state=unauth` 처리(`new/page.tsx:37-38`). dev에서 확인 |
| UQ-83 | 부분 해결 | 파운데이션 `StreamSource`가 role/origin/requirement_ids를 실어 보낸다. 다만 S-19 선택 카드는 아직 label·rationale만 그린다 → UQ-85(A3) |
| UQ-84 | 부분 해결 / 보류 | (a) 서버 쪽 준비 상태·월 한도 검사 추가(`lib/data/drafts.ts:297-301`, prepare 두 곳). (b) 섹션 소속 확인 추가. **보류(실제 백엔드에서 처리):** (a)의 input_hash 재사용, (c) `usage_events.ai_job_id`에 실제 작업 ID, (d) user 모드 rationale, (e) 살아 있는 원본은 현재 이름으로 라벨, (f) 확정을 서버에서, (g) AI-11 결과 재사용. 계획이 서버 메모리(globalThis)에 있다는 점도 실제 SSE 구현 때 사라질 목 한정 구조 |

## 이관 회귀 확인

- `src/app/(dashboard)/applications/_lib/`에는 `actions.ts`만 남았다. A3 컴포넌트의 `SourceTree`·`GenerationResult` 등 타입 import는 `@/lib/data/drafts`로 바뀌었고, tsc 0 오류.
- `prepare*`가 서버 검사에서 null을 돌려주면 예약이 생기지 않는다. 화면은 조용히 멈춘다 → UQ-86(Minor).
- `settleAbandonedGeneration`: S-19 진입 때 20초가 지난 계획은 성공으로 확정(C-04 `[가정]`)하고, 계획 없이 `generating`에 남은 행도 정리한다. 서버를 재시작해도 행이 `generating`에 갇히지 않는다.
- S-13: 정렬·단계 필터·삭제가 `listApplicationProjects`로 동작하고, JD 추출 완료 처리는 요약 계산 안으로 옮겨졌다. 스모크 200 확인.

## 새 이슈 (라운드 2)

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-85 | Minor | A3 | S-19 (C-04/C-11) | 03 AI-04 `sources_selected`, 02 C-11 role(주 근거/보조)·origin(AI 선택/내가 추가) | `components/applications/draft-editor.tsx:683-690` | 스트리밍 중 선택 카드에도 role/origin 배지(완료 후 `SourceRow`와 같은 모양) | 데이터(`StreamSource.role/origin/requirement_ids`)는 오지만 label — rationale만 그린다(UQ-83의 화면 몫) |
| UQ-86 | Minor | A3 | S-19 | 02 FL-08(데이터 미달 → C-09, 한도 → ST-LIMIT) | `draft-editor.tsx:190`, `:222` | 서버가 생성을 거절하면(준비 상태·한도) 이유를 알린다(토스트 또는 LimitNotice / C-09) | `plan`이 null이면 `setCurrent(null)`만 하고 아무 안내 없이 멈춘다. UI 버튼이 미리 막고 있어 주로 `?generate=` URL이나 다른 탭에서 한도를 쓴 경우에 생긴다 |
| UQ-87 | Minor | A3 | S-17 / S-18 / S-19 | 02 FL-13 "원래 기업 JD의 같은 기능 · 설정 복원", C-10 | `drafts-view.tsx:171`(S-17도 `cover_letter`를 consume), `draft-editor.tsx:129`, 공통 `return-target.ts:75-80`(apId + feature만 비교) | 복귀 대상은 그 대상의 `href` 화면이 consume한다 | S-18용 `cover_letter` 복귀 대상이 남아 있을 때 사용자가 S-17이나 같은 기업 JD의 다른 자기소개서 S-19에 먼저 들르면, 그 화면이 대상을 지운다. 그러면 S-18에서 설정 복원(`draft_id`)이 일어나지 않고 C-10 배너도 사라진다. consume 전에 `href`(또는 params의 `draft_id`)가 맞는지 확인하는 편이 안전하다 |

## 기획 확인 필요 (유지)

P-A3-1(경력기술서 재생성 = 새 행 vs 덮어쓰기), P-A3-2(S-18 문항 삭제 확인), P-A3-3(F-P2-07 판단 기준), P-A3-4("v3와 같음" 세부 명세 부재)는 그대로 열려 있다. UQ-64와 UQ-67은 `[UI-가정]`으로 구현돼 있어 기획이 결정하면 문구만 바꾸면 된다.

## 기계 검사 출력 (라운드 2)

- `pnpm typecheck` (`tsc --noEmit`): 통과, 0 오류
- `pnpm lint` (`eslint`): 통과, 0 문제
- `pnpm build`: 통과. `/applications`, `/applications/new`, `[id]`, `[id]/jd`, `[id]/insight`, `[id]/drafts`, `[id]/drafts/[draftId]`, `[id]/drafts/[draftId]/questions` 모두 ◐ Partial Prerender
- `pnpm exec next dev -p 3951` 스모크(종료함): `/applications`(+`empty`), `/applications/new`(+`from=board`, `unauth`), S-31(+`wait-jd`), S-15(+`ai-failed-input`), S-16(ap1·ap2, +`limit`, `insufficient`), S-17(+`ranking-failed`), S-19 경력기술서(+`ai-failed`)·자소서(+`ai-stream`), S-18 → 19개 모두 200, 로그 오류 0건
