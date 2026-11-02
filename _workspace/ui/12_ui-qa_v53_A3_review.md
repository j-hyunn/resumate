# UI QA — 기획 v5.3 A3 기업 JD (라운드 1)

> 2026-10-30. 범위: 브리프 `08_brief_v53.md` 3-1~3-7 (S-14 · S-15 · S-16 · S-17 · S-18 · S-19 · S-13 · S-31, C-03 · C-04 · C-11 · C-20).
> 기준: `02-user-flows.md` v5.3 (FL-03, S-13~S-19, S-31, C-03, C-04, C-11, C-20, 5.1c), `04-data-model.md` v4.2, `03-ai-features.md` v4.3 C-3, `design-system.md` v3, A3 보고 `11_frontend-engineer-A3_v53_report.md`, 파운데이션 보고 09, 파운데이션 QA `10_ui-qa_v53_foundation_review.md`(UQ-409 + A3 메모).
> 방법: 코드 정적 대조 + dev 서버(:3000) curl SSR 확인. **브라우저 클릭 흐름(요건 선행 추출 → 생성 이어짐, AI-11 실패 트리, 스트리밍 "마무리 중" → 통째 교체, 생성 직후 안내 상자, 다시 시도 거부)은 클라이언트에서만 그려져 SSR로 볼 수 없어 코드 경로로만 확인했다.** 코드 수정 없음.
> 병행 작업 주의: 검수 중 파운데이션이 `src/lib/data/drafts.ts`·`applications.ts`·`ai-error-notice.tsx`를 고치고 있었다(17:30 전후, A3 요청 1·4·7 반영 중). 아래 인용 줄 번호는 검수 시점 기준이다.

## 요약 — Critical 0 / Major 4 / Minor 18

- 기계 검사: `pnpm lint` 종료 0(오류·경고 0) · `pnpm typecheck` 종료 0 · build 생략(지시).
- 브리프 3-1~3-7의 화면 요소·문구는 대부분 들어가 있다. S-14 이름 규칙·경고 2종·200자, S-15 "공고 요건 정리 중"/"이미 정리하고 있어요" 스피너와 요청 경로 C-20, S-16 UQ-409 수정(거부·"처음부터 다시"·`rerunLabel`)과 입력 원인 무재시도, S-17 문체(간결 기본·해제 불가·요청에 항상 `tone`)·AI-11 실패 체크 없는 트리·8개 상한·실패 초안 행·상태 배지 5종, S-18 90~110% 문구·10문항·1,000자, S-19 실패 화면·문항별 C-20·생성 직후 안내 상자·글자 수 표시 문구가 명세와 맞다.
- **Major 4건**
  1. UQ-510 (A3) 요건 선행 추출(A13)이 "키 없이 만든 JD(`pending`·작업 없음)"에만 적용된다. 추출이 **실패한** JD에서는 S-17 "초안 생성"이 그대로 눌려 초안 행이 먼저 생기고, S-19는 `jdFailed`라 생성을 시작하지 않아 빈 초안 행이 남는다(→ 정리되면 "생성 실패" 행).
  2. UQ-511 (A3) S-19가 생성 종료를 데이터 계층에 알릴 때 `canceled`·`error_code`·`retry_after`를 넘기지 않는다. 경력기술서 "중단"이 "생성 실패" 행 + 가짜 원인("결과를 정리하지 못했어요")으로 남는다(파운데이션은 이미 받을 준비가 됨).
  3. UQ-512 (A0) `settleAbandonedGeneration`이 **방금 만든(아직 prepare 전) 경력기술서 초안**을 "버려진 생성"으로 보고 `failed`로 바꾼다. 새 초안 생성 때마다 S-19 머리 설명이 생성 내내 "생성 실패 · …"로 보이고 첫 프레임에 C-20이 번쩍이며, `previous_status`가 `failed`가 돼 UQ-511을 고쳐도 중단이 실패로 끝난다.
  4. UQ-513 (A3) S-15 입력 원인 실패(`not_a_jd` 등)에서 "고친 뒤 요건 정리하기로 새로 실행해 주세요"만 있고 **"요건 정리하기" 버튼이 없다**(S-16은 같은 경우 "다시 생성" 버튼을 둠). 막다른 화면.
- Minor는 A3 15건, A0 2건, 기획 1건.
- 엔지니어 우회책 점검: 이름 빈 문자열 우회("")는 데이터 계층에서 기본 이름·실패 시 이름 채우기까지 정상 동작(`!ap.name` 판정) — 파운데이션이 `createApplicationProject`를 고쳐 이제 불필요(UQ-518). 화면에서 만든 생성 직후 안내(`mockNotes`)는 동작하지만 파운데이션 계획이 `notes`·`adjust_length`를 싣기 시작해 교체 필요(UQ-516). 자소서 결과 배지를 섹션 `updated_at`으로 계산하는 우회는 편집 시 틀린 문항을 고른다(UQ-522).

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | 메모 |
|---------|----|----|------|----|----|----|----|----|-----|------|
| S-14 기업 JD 추가 | ✅ | ✅ | ⚠️ | ✅ | ✅ | — | ✅ | ✅ | ✅ | UQ-518. 경고 2종 문구 명세 그대로, 회사명·포지션명 `maxLength=200`, KST 기본 이름 |
| S-15 JD·요건 | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | UQ-513(Major), 514, 530. `?state=` ai-failed-input · request-wait · retry-refused-* · retry-connection-changed · retry-not-retryable · consent-required 200 |
| S-16 인사이트 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UQ-409 해결. UQ-515, 517, 519, 520. retry-other-provider · retry-refused-key-missing("AI 연결이 필요해요. 작성한 내용은 저장돼 있어요") · retry-connection-changed · retry-not-retryable · input-failed · ai-pending("공고 요건 정리 중"·"요건 대조 중") 확인 |
| S-17 서류 초안 목록 | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | UQ-510(Major), 519, 521, 522, 529. ap2 "생성 실패" 행 + "다시 시도" + "다시 시도하면 토큰을 다시 써요", 문체 간결/상세, `insufficient-project-fields` "마저 채우기" |
| S-18 자소서 문항 | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UQ-510(같은 원인), 523. "AI는 제한의 90~110% 안으로 맞춰요. 최대 10%까지 넘을 수 있으니…" SSR 확인 |
| S-19 초안 편집기 | ⚠️ | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ | UQ-511(Major), 512(Major, A0), 516, 521, 524, 525, 528, 531. ap2 초안 3: "생성에 실패했어요. 다시 시도하면 새 초안으로 처음부터 만들어요" + "결과를 정리하지 못했어요" + 다시 시도. 자소서 초안 2 "현재 …자 / 제한 …자" |
| S-13 기업 JD 목록 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | C-03 우선순위 = `AiFeatureStatus`, 인사이트 생성 중 축약형 live, 면접 실패 한 줄(ap3). `?state=empty` 문구 명세 그대로 |
| S-31 지원 프로젝트 허브 | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | UQ-526, 527. 인사이트·면접 늦은 실패 한 줄(버튼 없음) |

세부 대조 (✅ 항목 근거):

- **3-1 S-14** — `application-new-form.tsx:48` 둘 다 있을 때만 "회사명 – 포지션명", `:157-171` 200자 미만 / 24,000자 초과 경고(막지 않음, 문구 명세 그대로), `:243,247` 각 200자. 키 없으면 입력란 펼침 + C-18 인라인 문구 명세 그대로(`:181`). 데이터 계층: 키 없음 → `defaultApplicationName`(KST), 키 있음 → `null`(추출 대기) → 성공 시 `ai` 이름, 실패 시 `failJdExtraction`이 같은 규칙으로 채움(`applications.ts:83-86`).
- **3-2 S-15** — `jd-view.tsx:250-257` "공고 요건 정리 중"/"이미 정리하고 있어요"(role=status), `RunExtraction`이 거부를 AiRunButton에 돌려줌(`:281-287`), `ExtractionFailed`가 `requestPath`·`rerunLabel="요건 정리하기"`·거부 행 처리(`:184-191, 231-243`). 파운데이션 메모(UQ-409 부속) 해결.
- **3-3 S-16** — `insight-view.tsx:156-162, 227-238` `aiErrorFromJob` → `sameRow`·`jobTier`, `refusal={preview.refusal ?? job.refusal}`, `rerunLabel="다시 생성"`. 입력 원인은 AiErrorNotice가 다시 시도를 빼고 결과가 없으면 아래 "다시 생성" 실행 버튼(`:239`). 시작 거부는 `onRun={start}`가 돌려줌(`:133-146`). 단계 문구는 파운데이션 `AiProgress jobType="insight"`. 별칭 숨김은 판정 이유·부족한 점·강점·보완점·대응·지원 방향·프로젝트 이유·기준 안내 모두 `plain()` 경유(`:303-524`).
- **3-4 S-17** — 문체 ToggleGroup(`drafts-view.tsx:456-474`, 해제 불가, 요청에 항상 `tone` `:411`, C-10 복원 `:292`). AI-11 실패: 대체 선택 없음 → `selection={projects:{}}`·`origin=user`(`:324-333`), Alert "AI가 포함할 항목을 고르지 못했어요. 직접 골라 주세요" + 원인 한 줄 + "AI에게 다시 맡기기"(AiRunButton = 배지·동의·잠금, `:504-524`). 1개 이상(`:565-574`), 8개 상한(`:213, 533-536, 554`). 상태 배지 5종(`:58-86`), 실패 경력기술서 행 열기 없음 + 다시 시도(새 초안, 같은 설정·문체, `regenerated_from_id`) + 삭제(C-05) + 토큰 안내(`:144-173`).
- **3-5 S-18** — `cover-letter-questions.tsx:43-44, 155-161, 298-310, 357` 10문항·1,000자·명세 문구. C-11 5개 `sources-used.tsx:37, 179-183` "한 문항에 5개까지 고를 수 있어요".
- **3-6 S-19** — 경력기술서 실패: `discardOnError` + `validated` 블록만 저장(`draft-editor.tsx:239-244, 309`), 본문 대신 첫 줄 + C-20(`:451-469`), 오른쪽 C-11 비움(`:491-493`), 보존 줄 없음(`hidePreserved`). 자소서는 실패 문항만 C-20 inline(`:892-904`). 생성 직후 안내 상자 기본 펼침 + "이 안내는 지금만 보여요. 필요하면 메모해 두세요"(`:965-1031`), 메모리만. 글자 수 "현재 {n}자 / 제한 {limit}자({기준})" + 110% 이내 초과 문구 명세 그대로(`:817-830`). 스트리밍 중 복사 비활성(`:535`), 스트리밍 블록 편집 불가.
- **3-7 S-13·S-31** — `application-list.tsx:274-315`, `[id]/page.tsx:66-153, 220-224`. 결과보다 늦은 실패만 한 줄, 버튼 없음.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-510 | Major | A3 | S-17 · S-18 · S-19 | 02 S-17 (v5.3) "요건 선행 추출 (A13): 요건이 없는 기업 JD에서 … 먼저 요건 추출(별도 요청) … 추출 실패는 S-17에 C-20, 초안은 만들지 않는다", FL-03 `JR{요건 추출됨?}` → JX → JF, S-18 (v5.3) 마지막 줄 | `_lib/jd-state.ts:21-25`(`extractFirst = pending && !extraction_job_id`만), `drafts/page.tsx:100`, `questions/page.tsx:77`, `drafts-view.tsx:253, 574`(`disabled`는 `waitJd`뿐), `:587` `JdFailedNotice`, `draft-editor.tsx:358`(`jdFailed`면 자동 시작 포기), `draft-editor.tsx:78`(`extractFirst` prop 미사용) | "요건이 없는" JD = 추출 전 **또는 추출 실패**. 어느 경우든 생성 전에 별도 추출 → 실패면 C-20, 초안 행 없음 | 추출 실패 JD(`extraction_status = 'failed'`)에서는 `needed=false`라 "초안 생성"이 바로 `createCareerDescriptionAction` → 초안 행(`generating`) 생성 → S-19가 `jdFailed`라 생성 시작 안 함 → 빈 초안 행이 남고 다음 방문 때 `settleAbandonedGeneration`이 "생성 실패" 행으로 바꿈. S-18도 같은 판정. S-19에서 직접 "이 문항만 생성"/"초안 생성"은 A13 없이 생성 요청 안 추출(파운데이션 요청 8)에 기댐. `jdRunState`의 `needed`를 "요건 없음(pending·failed)"으로 넓히고 S-19 실행 버튼도 `useRequirementsFirst`를 거치게 |
| UQ-511 | Major | A3 | S-19 | 02 C-03 진행 표시 우선순위 "사용자가 취소했으면 표시 없음", C-20 (시스템) "`canceled` 표시 안 함", S-17 (v5.3) 실패 초안 행은 "생성 실패" 원인으로 | `draft-editor.tsx:316`(`{ ok, completed_block_ids }`만), 파운데이션 준비: `lib/data/drafts.ts:378-383`(`canceled`·`error_code`·`retry_after`·`quota_resets_at`), `:614-619` | 중단 → `canceled: true`(실패 행 아님), 실패 → 스트림 오류 원인·대기 시각을 넘겨 작업 행에 기록(다시 열어도 같은 C-20) | 중단해도 `ok=false`라 경력기술서가 "생성 실패" 행이 되고, 다시 열면 원인이 기본값(`provider_unavailable` 또는 작업 행 없을 때 `schema_invalid` "결과를 정리하지 못했어요")으로 보임. 자소서 중단도 사용량 기록 등 실패로 처리 |
| UQ-512 | Major | A0 | S-19 (경력기술서 새 초안) | 02 C-03 진행 표시 우선순위(생성 중 우선), S-17 (v5.3) 초안 상태 `generating` | `lib/data/drafts.ts:948-956`(plan 없는 `generating` 초안 → 섹션 0이면 `failed`, 나이 검사 없음), `:252`(새 초안 `generating`), `:576`(`previous_status: draft.status`), `drafts/[draftId]/page.tsx:41, 98`, `draft-editor.tsx:126` | 막 만든 초안(S-17 → `?generate=1`)은 prepare 전까지 "생성 중" 그대로 | S-19 진입 시 settle이 먼저 돌아 새 초안이 `failed`가 됨 → 머리 설명 "생성 실패 · …"가 생성 내내 보이고, `storedFailure` → `cdFailed` 초기값 `schema_invalid`로 C-20이 한 프레임 보였다가 자동 시작에 지워짐. prepare가 `previous_status = failed`를 기록해 중단(UQ-511 수정 후에도)이 `failed`로 돌아감. 버려진 판정에 생성 시각(예: 20초) 조건 필요 |
| UQ-513 | Major | A3 | S-15 | 02 C-20 `input_rejected` 행 "입력을 고친 뒤 새로 실행(… 요건 추출·서류 3종·AI 작성 대화는 해당 실행 버튼)", (입력) 행 "입력 화면으로 → 고친 뒤 새로 실행", S-15 v5 "요건 정리하기" | `app/(dashboard)/applications/[id]/jd/page.tsx:50-55`(실패면 슬롯이 `ExtractionFailed`뿐), `jd-view.tsx:231-243`, 비교: `insight-view.tsx:239` | 입력 원인 실패에서 다시 시도 대신 **"요건 정리하기" 실행 버튼**(+ C-19)으로 새로 실행 | SSR `?state=ai-failed-input`: "채용 공고가 아닌 텍스트로 보여요" + "고친 뒤 요건 정리하기로 새로 실행해 주세요"만, 버튼 없음. 사용자가 할 수 있는 동작이 없다(원문 고치기 문제는 UQ-514) |
| UQ-514 | Minor | 기획 | S-15 · S-16 | 02 S-16 (v5.3) "원문을 고친 뒤 '다시 생성', R-76", C-20 `input_rejected` "입력을 고친 뒤 새로 실행" ↔ S-14/U-6 "공고 원문은 만든 뒤에 바꿀 수 없어요"(D-19) | `jd-view.tsx:196`, `insight-view.tsx:227-239`, `application-new-form.tsx:175` | 고칠 수 있는 입력으로 안내 | 공고 원문이 입력 원인(`not_a_jd`·`input_too_long`·`safety_blocked`)인데 원문은 교체 불가 → "고친 뒤 …로 새로 실행해 주세요"를 따를 방법이 없음. 대안(새 기업 JD로 다시 추가 안내 등) 결정 필요 — 아래 "기획 확인 필요" |
| UQ-515 | Minor | A0 | S-16 · S-17 · S-18 · S-19 | 02 C-20 입력 원인 안내(G-35 문구) | `components/common/ai-error-notice.tsx:690` `` `고친 뒤 ${rerunLabel}로 새로 실행해 주세요` `` | 조사가 받침에 맞게("다시 생성으로", "초안 생성으로") | SSR S-16 `?state=input-failed` "고친 뒤 **다시 생성로** 새로 실행해 주세요". A3 라벨 "초안 생성"·"전체 문항 생성"·"이 문항만 생성"도 "…생성로". "요건 정리하기로"만 맞음 |
| UQ-516 | Minor | A3 | S-19 | 02 S-19 (v5.3) 생성 직후 안내(A21, `validated`와 함께 오는 안내), C-04 `adjusting_length`; 파운데이션이 A3 요청 4 반영 | `draft-editor.tsx:91-98, 151-157, 228, 243, 277-287`; 파운데이션 `lib/data/drafts.ts:366-370, 773-790`(`plan.notes`·`adjust_length`·`char_adjust_needed`) | 데이터 계층 계획의 `notes`·`adjust_length`를 그대로 스트림에 실음 | 화면이 자체 `mockNotes`와 90~110% 계산으로 안내를 만듦(계획 값과 다른 문구·판정이 될 수 있음). 경력기술서 `omitted`는 `" — "` 문자열 분해 — 파운데이션 타입 확정(`{ item, reason }`) 뒤 맞출 것 |
| UQ-517 | Minor | A3 | S-16 | 02 S-16 (v5.3) "저장 문장에는 내부 별칭이 보이지 않고", 03 C-3 별칭 목록(`EXP`·`EDU`·`PRJ`·`DET`·`ACH`·`SKL`, 요건 `REQ`, 원문 문장 `S12`) | `components/applications/insight-parse.ts:32` `(?:EXP|PRJ|DET|EDU|REQ)-\d+` | 모든 별칭을 표시 보호 | `ACH-n`·`SKL-n`·`Sn`(원문 문장)이 걸러지지 않음(주석에는 `S12`가 있다고 적혀 있음) |
| UQ-518 | Minor | A3 | S-14 | 04 2.x application_projects "키 없이 회사명·포지션명을 둘 다 입력했으면 '회사명 – 포지션명'(`user`, 앞 100자)" | `_lib/actions.ts:52-55`, 파운데이션 `lib/data/applications.ts:282`(이제 둘 다 있을 때만 `.slice(0, 100)`) | 이름 100자 규칙, 데이터 계층 규칙 하나로 | 액션이 자체로 `"${company} – ${position}"`(최대 403자)을 `name`으로 넘겨 데이터 계층의 100자 자르기를 건너뜀. 하나만 입력 시 `""` 우회는 파운데이션 수정으로 불필요 — 액션은 `company_name`/`position_title`만 넘기고 `name`은 비우는 편이 맞음 |
| UQ-519 | Minor | A3 | S-16 · S-17 · S-19 | 02 S-16 (v5.3) `prepare`(키 없이 만든 JD면 여기서 요건 추출), S-17 A13 | `components/applications/shared.tsx:95` "공고 분석이 끝나지 않았어요. JD·요건에서 다시 시도하면 시작할 수 있어요", 사용처 `insight-view.tsx:194`, `drafts-view.tsx:587`, `draft-editor.tsx:543` | v5.3: 인사이트는 실행 시 `prepare`에서 추출, 서류는 선행 추출 | 추출 실패 JD에서 S-15로 보내는 v4 문구가 남아 있고, S-16은 버튼이 눌리는데(인라인 추출) 문구는 "JD·요건에서 다시 시도하면 시작"이라 모순. UQ-510 수정과 함께 정리 |
| UQ-520 | Minor | A3 | S-16 | 02 C-20 "다시 시도의 공급자" 표 "키·동의가 없을 때 … C-18 / C-21" | `insight-view.tsx:230` 늦은 실패의 `onRetry={() => void start()}` | 새 실행이 거부되면 C-18/C-21/키 교체 | 진입 시 보이는 늦은 실패(`lateFailure`)의 "다시 시도"가 `start()`의 `AiRejected`를 버림 → 키 삭제·무효 상태에서 눌러도 아무 변화 없음(동의 필요는 AiErrorNotice 게이트가 먼저 막음). 파운데이션 요청 3(같은 행 다시 시도용 `job_id`) 전까지는 거부 결과를 `refusal`로 바꿔 주면 됨 |
| UQ-521 | Minor | A3 | S-17 · S-19 | 02 S-17 (v5.3) 실패 초안 행 [다시 시도], S-19 (v5.3) 실패 처리, C-20 "다시 시도의 공급자" 키·동의 행 | `draft-editor.tsx:396-400, 461`(AiErrorNotice `onRetry` → `retryAsNewDraft`), `drafts-view.tsx:103-106` | 새 초안 다시 시도도 실행 버튼 규칙(C-18/C-21, 요건 선행 추출) | S-19 실패 화면 다시 시도는 AiRunButton이 아니라 키가 없거나 무효여도(`provider_unavailable` 등) 버튼이 보이고, 누르면 `generating` 새 초안 행을 만든 뒤 S-19가 잠금으로 시작하지 않아 빈 행이 남음. `retryingNew`는 오류 시 되돌리지 않음. S-17 행 다시 시도는 try/catch·A13 없음 |
| UQ-522 | Minor | A0 | S-17 · S-19 | 02 S-17 (v5.3) "결과 배지 … 마지막으로 생성 완료된 문항의 공급자·모델(`drafts.provider`·`model`·`model_tier`)" | `drafts/page.tsx:68`, `draft-editor.tsx:443`(섹션 `updated_at` 최신순), `lib/data/applications.ts:617`(편집 저장도 `updated_at` 갱신) | 데이터 계층이 문항 생성 완료 시 `drafts.provider·model·model_tier`를 갱신(A3 요청 6) | 영역 우회가 `updated_at`으로 고르므로 예전에 생성한 문항을 편집하면 그 문항의 공급자가 "마지막 완료"로 표시됨. 파운데이션이 `finalizeCoverLetterSection`에서 갱신하면 A3는 `draft.provider`를 쓰도록 바꿀 것 |
| UQ-523 | Minor | A3 | S-17 · S-18 | 02 S-15 "'요건 정리하기'는 동기 요청(최대 30초 `[가정]`)", C-20 "다시 시도 거부" | `components/applications/extract-first.tsx:89-108`(무한 폴링), `:123`(`void run(...)`) | 30초 넘으면 실패로 보이기, C-20 다시 시도가 거부되면 C-18/C-21 | 상태가 `pending`/`running`에 머무르면 "공고 요건 정리 중"이 끝없이 돎. 실패 C-20의 다시 시도가 키·동의로 거부되면 `failure`만 지워지고 아무 안내 없음(위 실행 버튼을 다시 누르면 처리되긴 함) |
| UQ-524 | Minor | A3 | S-19 | ui-context "?state= 미리보기", design-system v3 C-04 "마무리 중", `lib/preview-state.ts:63` `finalizing` | `drafts/[draftId]/page.tsx:126`(`stream: state === "ai-stream"`만) | `?state=finalizing`으로 "마무리 중"(편집·복사 막힘) 정지 화면 | S-19에서 `finalizing`이 무시됨. `ai-stream`이 지나가며 보이지만 QA·리더가 멈춘 상태를 확인할 수 없음(보고서에 사유 기재됨 — mock 스트림 정지 옵션은 파운데이션 몫이면 그쪽으로) |
| UQ-525 | Minor | A3 | S-19 | 02 S-19 (v5.3) 경력기술서 실패 "편집기 본문 대신 C-20" | `drafts/[draftId]/page.tsx:60` `` `${DRAFT_STATUS_LABELS[draft.status]} · 문단을 눌러 고칠 수 있어요. 근거 칩을 누르면 원본을 볼 수 있어요` `` | 블록이 없는 실패 초안에는 편집 안내 없음 | SSR ap2 초안 3: "생성 실패 · 문단을 눌러 고칠 수 있어요…" — 고칠 문단이 없음 |
| UQ-526 | Minor | A3 | S-31 | 02 C-03 진행 표시 우선순위 "결과가 '생성 중'인데 그 작업이 이미 끝났거나 없으면 실패로 보인다" | `app/(dashboard)/applications/[id]/page.tsx:69` `generating = … || insight.generating !== null || …`, `:137-139` | 작업 상태 기준(`insight_status.kind`)만으로 생성 중 판정, 끝난 작업이면 실패/`stalled` 한 줄 | `generating` 상태로 남은 인사이트 행이 있으면 작업이 끝났어도 카드가 "생성 중"(끝난 작업의 `JobInline`, 실패면 매 마운트 `router.refresh`)으로 보이고 `stalled` 한 줄은 가려짐 |
| UQ-527 | Minor | A3 | S-31 | 02 S-15 (v5.3) 진행 문구 "공고 요건 정리 중", C-03 `prepare` 문구 | `app/(dashboard)/applications/[id]/page.tsx:100` "공고를 분석하고 있어요" | 같은 작업은 같은 문구 | 허브 JD 카드만 v4 문구 |
| UQ-528 | Minor | A3 | S-19 | 02 S-19 (v5.3) 생성 직후 안내 "`validated`와 함께 오는 안내" | `draft-editor.tsx:313-314`(안내가 있을 때만 병합) | 문항을 다시 생성하면 그 문항의 이전 안내는 사라지고 새 안내만 | 다시 생성 결과에 안내가 없으면 이전 생성의 안내(예: "글자 수를 맞추지 못했어요")가 그 문항 아래 그대로 남음 |
| UQ-529 | Minor | A3 | S-17 | design-system 7장 접근 이름, 같은 목록의 메뉴 버튼(`${label} 메뉴`) | `drafts-view.tsx:166` | 행 맥락이 있는 이름(예: "경력기술서 삭제") | 실패 행 "삭제" 버튼 이름이 "삭제"뿐이라 실패 행이 여러 개면 구분 불가 |
| UQ-530 | Minor | A3 | S-15 | 02 S-15 (v5.3) "이미 다른 경로로 추출 중이면 '이미 정리하고 있어요'" | `app/(dashboard)/applications/[id]/jd/page.tsx:56-64`, `jd-view.tsx:284-285` | 다른 경로(인사이트 `prepare`·서류 선행 추출)에서 추출 중일 때 진입해도 "이미 정리하고 있어요" | 버튼을 눌렀을 때만 잠깐 보이고 `router.refresh` 뒤 "공고 요건 정리 중"으로 바뀜, 진입 시는 항상 "공고 요건 정리 중" |
| UQ-531 | Minor | A3 | S-19 | 02 S-19 (v5.3) / C-20 공통 "경력기술서는 예외: 실패하면 블록을 남기지 않고, 다시 시도는 새 초안으로" (A4) | `draft-editor.tsx:598-607`(경력기술서 `partially_failed` + "다시 생성" = 같은 초안), `:738` "이 섹션을 만들지 못했어요" | 경력기술서에 일부 실패 표시·같은 초안 다시 생성 경로 없음 | v5.3 이전 경로가 남아 있음(파운데이션 finalize가 이제 경력기술서를 `partially_failed`로 두지 않아 사실상 죽은 코드 — 정리) |

## 기획 확인 필요

| 화면 | 내용 | 양쪽 인용 |
|------|------|-----------|
| S-15 · S-16 (UQ-514) | 입력 원인 실패의 "입력"이 공고 원문인데 원문은 교체 불가 | 02 S-16 (v5.3) "원문을 고친 뒤 '다시 생성'(R-76)" ↔ U-6/D-19 "공고 원문은 만든 뒤에 바꿀 수 없어요. 다른 공고는 새 기업 JD로 추가". 안내를 "새 기업 JD로 다시 추가"로 바꿀지, 실행 버튼만 둘지 |
| S-17 | 요건 없는 JD에서 포함 항목 설정 순서 | FL-03 "`JR` 아니오 → 추출 → 성공 → C[포함 항목: **AI에게 맡기기 기본**]" ↔ 구현: 설정 화면이 먼저 보이고 기본은 "직접 고르기 + 체크 없음", 추출은 "초안 생성"/"AI에게 맡기기"를 누를 때(엔지니어 보고 5절 1·2와 같은 질문). D-30(자동 추출 금지)와 FL-03 순서 중 무엇을 따를지 |
| S-19 C-11 | 자소서 근거 5개 상한의 대상 | 02 C-11 "문항당 **직접 추가할 수 있는** 경력·프로젝트 최대 5개" ↔ 구현은 AI 선택 포함 **전체 체크 수** 5개(`sources-used.tsx:179-183`) |
| S-17·S-18·S-19 | 엔지니어 보고 5절의 나머지(8개·10문항·1개 이상 문구 P-13, 늦은 실패 다시 시도가 같은 행이어야 하는지, 경력기술서 중단 시 남길 것, `omitted` 형태) | 보고서 `11_frontend-engineer-A3_v53_report.md` 5절 그대로 전달 |

## 재확인 결과

| ID | 결과 | 메모 |
|----|------|------|
| UQ-409 | 해결 | `insight-view.tsx:227-238` `{...aiErrorFromJob(job.job)}`·`refusal={preview.refusal ?? job.refusal}`·`retrying`·`rerunLabel="다시 생성"`. SSR `?state=retry-refused-key-missing` "AI 연결이 필요해요. 작성한 내용은 저장돼 있어요", `retry-connection-changed` "AI 연결이 방금 바뀌었어요. 다시 시도해 주세요.", `retry-not-retryable` 문구 확인. "처음부터 다시" 줄은 연결 정보가 클라이언트에서 읽혀 SSR에는 없음(코드 경로 확인) |
| UQ-409 부속 메모 ① `gate-preview` | 해결 | `_lib/gate-preview.ts:14-17` `projectFields`. S-17 `?state=insufficient-project-fields` "마저 채우기" SSR 확인 |
| 부속 메모 ② S-15 `requestPath`·`rerunLabel` | 해결 | `jd-view.tsx:240-241` |
| 부속 메모 ③ 인사이트 시작 거부 토스트 | 해결 | `insight-view.tsx:133-146` 거부 결과를 AiRunButton에 돌려줌(토스트는 예외 시만) |

## 기계 검사 출력

- `pnpm lint` → `$ eslint` / 종료 코드 0 (오류 0, 경고 0)
- `pnpm typecheck` → `$ tsc --noEmit` / 종료 코드 0
- `pnpm build` → 생략(리더 지시, dev 서버 실행 중)
- 하드코딩 색 검색(`#hex`·`rgb(`·팔레트 클래스) — A3 파일 0건. `[UI-가정]` 표시 53곳(보고서 3절과 대조, 누락 없음)
- curl: `/applications`, 허브 6개, S-15/S-16/S-17/S-18/S-19 주요 `?state=` 모두 200
