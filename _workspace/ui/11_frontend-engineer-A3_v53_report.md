# A3 기업 JD 구현 보고 — 기획 v5.3 (브리프 3-1 … 3-7)

> 2026-10-30. 기준: 플로우 v5.3(FL-03, S-13~S-19, S-31, C-03·C-04·C-11·C-20, 5.1c) · design-system v3 `(v3)` 문단 · 파운데이션 보고 09(QA 1차 수정 포함) · QA 10(UQ-409 + A3 메모). mock 데이터 계층만, 커밋 없음, `docs/planning/` 수정 없음.
> 검사: `pnpm lint` 통과 · `pnpm typecheck` 통과(build는 지시대로 생략). dev 서버(:3000) SSR로 아래 화면·`?state=` 문구를 확인했다. **브라우저 클릭 흐름(요건 선행 추출 → 생성 이어짐, 스트리밍 "마무리 중" → 통째 교체, 생성 직후 안내 상자)은 눈으로 보지 못했다.**

## 1. 화면별 변경

| # | 화면 | 변경 | 파일 |
|---|------|------|------|
| 3-1 | S-14 | 이름 규칙: 회사명·포지션명 **둘 다** 입력했을 때만 "회사명 – 포지션명", 아니면 키 없음 = "새 기업 JD (YYYY-MM-DD)"(KST), 키 있음 = 추출 대기 → AI 이름. 공고 200자 미만 "공고가 짧아요. 전체 공고를 붙여넣으면 요건을 더 정확히 정리해요" / 24,000자 초과 "공고가 길어요. 공고와 관계없는 부분은 빼 주세요"(둘 다 경고만). 회사명·포지션명 각 200자. 이름 안내 문구 갱신 | `components/applications/application-new-form.tsx`, `_lib/actions.ts` `createApplicationAction` |
| 3-2 | S-15 | "요건 정리하기" 진행 중 버튼 자리에 스피너 "공고 요건 정리 중", 다른 경로로 이미 추출 중이면 "이미 정리하고 있어요"(`retryJdExtractionAction` → `{ already: true }`). 페이지 진행 상태 문구도 "공고 요건 정리 중". 실패 C-20: `requestPath`(A14 카운트다운) · `rerunLabel="요건 정리하기"` · 입력 원인 다시 시도 없음. **UQ-402 결과 처리**: `RunExtraction`은 `AiRejected`를 AiRunButton에 돌려줘 C-18/C-21/키 무효를 버튼이 처리. `ExtractionFailed` 다시 시도가 거부되면 연결 상태를 다시 읽어 `key_missing`/`ai_consent_required`/`key_invalid` 거부 행으로 동작 줄만 바꿈(G-34) | `components/applications/jd-view.tsx`, `app/(dashboard)/applications/[id]/jd/page.tsx` |
| 3-3 | S-16 | **UQ-409**: `<AiErrorNotice {...aiErrorFromJob(job.job)} refusal={job.refusal} retrying={job.retrying} rerunLabel="다시 생성" …/>` → 같은 행 다시 시도 거부가 보이고, 작업 공급자·등급이 활성과 다르면 "{활성 공급자}로 처음부터 다시 해요". 시작은 `onRun={start}`가 거부 결과를 돌려줘 AiRunButton이 C-18/C-21 처리(토스트만 내던 것 제거). 입력 원인 실패는 다시 시도 없이 결과가 없을 때 아래에 "다시 생성" 실행 버튼. 진입 시 결과보다 늦게 끝난 실패(`insight_status.failure`)도 C-20으로 보임(아래 [UI-가정]). 단계 문구는 파운데이션 `AiProgress jobType="insight"`(prepare → match → synthesize(_regen) → validate). 저장 문장 내부 별칭 표시 방지 `hideInternalAliases`(판정 이유·부족한 점·강점·보완점·대응·지원 방향·프로젝트 이유·기준 안내) | `components/applications/insight-view.tsx`, `insight-parse.ts`, `app/(dashboard)/applications/[id]/insight/page.tsx` |
| 3-4 | S-17 | **요건 선행 추출(A13)**: 새 훅 `useRequirementsFirst` — 요건이 없으면 "초안 생성"·"AI에게 맡기기"·"AI에게 다시 맡기기"가 먼저 AI-01을 별도 요청으로 돌리고(버튼 비활성 + "공고 요건 정리 중"/"이미 정리하고 있어요") 끝나면 다음 단계로, 실패하면 버튼 아래 C-20 inline(요청 안 경로 카운트다운, 입력 원인 다시 시도 없음)이고 초안 행을 만들지 않음. 요건이 없을 때는 들어갈 때 AI-11 자동 실행도 하지 않음. **문체** ToggleGroup 간결(기본)/상세, 해제 불가, 생성 요청에 항상 `tone`. **AI-11 실패(A23)**: 대체 선택 없음 → 체크 없는 트리 + `Alert warning`(ListChecks) "AI가 포함할 항목을 고르지 못했어요. 직접 골라 주세요" + 원인 한 줄 + "AI에게 다시 맡기기"(AiRunButton = 활성 공급자 배지·동의·잠금), 출처 "직접 고름". 1개 이상 골라야 생성(버튼 위 안내), 프로젝트 최대 8개(넘으면 체크박스 비활성 + 안내). **초안 상태 배지 5종**(작성 중/생성 중/완료/"{n}개 문항 생성 실패"/생성 실패). **실패한 경력기술서 행**: 열 수 없음, "다시 시도"(새 초안 행, 같은 설정·문체, 활성 공급자 배지) + "삭제"(C-05) + "다시 시도하면 토큰을 다시 써요". **결과 배지**: 자소서는 마지막으로 생성 완료된 문항의 공급자·모델(페이지에서 계산) | `components/applications/drafts-view.tsx`, `extract-first.tsx`(신설), `source-tree.tsx`(`maxProjects`), `labels.ts`, `app/(dashboard)/applications/[id]/drafts/page.tsx`, `_lib/actions.ts` `rankDraftSourcesAction` |
| 3-5 | S-18 | 글자 수 제한 아래 안내 "AI는 제한의 90~110% 안으로 맞춰요. **최대 10%까지 넘을 수 있으니** 제출 전에 글자 수를 확인해 주세요"(이전 "±10%" 문구 삭제). 문항 최대 10개(넘으면 "문항 추가" 비활성 + 안내), 문항 문장 1,000자(90%부터 글자 수 표시). 요건 선행 추출: "전체 문항 생성"·"이 문항만 생성"이 S-19로 가기 전에 여기서 추출을 끝냄(실패 C-20은 하단 카드). 근거 직접 추가 5개는 S-19 C-11(아래) | `components/applications/cover-letter-questions.tsx`, `…/questions/page.tsx` |
| 3-5 | S-19 C-11 | 자소서 문항 근거 변경 트리 최대 5개 + 명세 문구 "한 문항에 5개까지 고를 수 있어요". 경력기술서 포함 항목 최대 8개 + 문체 선택(바꾸면 "근거를 바꿨어요"와 같은 "변경 사항으로 다시 생성", G-39) | `components/applications/sources-used.tsx` |
| 3-6 | S-19 | 스트리밍 머리에 `phase`/`adjusting` 전달 → "마무리 중…", "글자 수 맞추는 중 (현재 n자 / 제한 m자)". 자소서 문항 블록에 `section_id`를 실어 `validated` 문항별 통째 교체, 제한의 90~110% 밖이면 `adjustLength`. **경력기술서 실패(A4)**: `discardOnError` + 확정 블록만 저장(`completed_block_ids` = `validated` 블록만) → 블록 없음, 편집기 자리에 "생성에 실패했어요. 다시 시도하면 새 초안으로 처음부터 만들어요" + C-20(보존 줄 없음, 다시 시도 = 새 초안 행·활성 공급자, 오른쪽 C-11 패널 비움). 저장된 실패 초안(픽스처 초안 3)을 열어도 같은 화면(작업 14 `schema_invalid`). **자소서 실패 문항**만 C-20 inline(`requestPath`, "다시 시도", 입력 원인 다시 시도 없음), 완료 문항 보존. **생성 직후 안내 상자** `GenerationNotes`(기본 펼침, 포함하지 않은 항목 / 확인해 주세요 / 글자 수를 맞추지 못했어요, 자소서는 문항별, "이 안내는 지금만 보여요. 필요하면 메모해 두세요", 메모리에만). **글자 수 표시** "현재 {n}자 / 제한 {limit}자(공백 포함·제외)", 110% 이내 초과 시 경고 모양 + 명세 문구, 편집으로 110% 초과 시 "제한보다 {n}자 많아요", `validation_report.char_adjust_needed`면 다시 열어도 경고. 결과 배지: 자소서는 마지막 완료 문항 값 | `components/applications/draft-editor.tsx`, `app/(dashboard)/applications/[id]/drafts/[draftId]/page.tsx` |
| 3-7 | S-13·S-31 | `AiFeatureStatus`(C-03 진행 표시 우선순위). S-13 인사이트 칸: 생성 중이면 C-03 축약형(작업 유형별 문구, live), 아니면 있음/없음 + 늦게 끝난 실패 한 줄. 면접 칸: 생성 중 축약형 / 실패 한 줄. 진행 중이면 목록 자동 새로 읽기. S-31 인사이트 카드: `insight_status` 기준 생성 중 우선 + 실패 한 줄(버튼 없음), 면접 카드: 실패 한 줄. `JobInline`이 작업 유형을 넘겨 "공고 요건 정리 중"/"채점 준비 중" 등 v5.3 단계 문구 | `components/applications/application-list.tsx`, `shared.tsx`, `app/(dashboard)/applications/page.tsx`, `app/(dashboard)/applications/[id]/page.tsx` |
| QA | 공통 | `gate-preview.ts`가 `?state=insufficient-project-fields`를 `projectFields: true`로 넘김 → S-16·S-17·S-18·S-19 게이트에서 "'{프로젝트명}' 마저 채우기" 미리보기 | `app/(dashboard)/applications/_lib/gate-preview.ts` |

## 2. 지원 `?state=` (이번에 추가·바뀐 것)

| 화면 | 라우트 | 값 |
|------|--------|----|
| S-15 | `/applications/[id]/jd` | 기존 + `consent-required` · `input-failed` · `request-wait` · `retry-refused-key-missing` · `retry-refused-consent` · `retry-refused-key-invalid` · `retry-connection-changed` · `retry-not-retryable` |
| S-16 | `/applications/[id]/insight` | 기존 + `consent-required` · `insufficient-project-fields` · `input-failed` · `retry-other-provider` · `retry-refused-*`(3종) · `retry-connection-changed` · `retry-not-retryable` |
| S-17 | `/applications/[id]/drafts` | 기존 + `ranking-failed`(의미 변경: 체크 없는 트리 + "AI에게 다시 맡기기") · `consent-required` · `insufficient-project-fields` · `extract-failed` · `extract-failed-input` · `extract-failed-wait`(화면 전용: 요건 선행 추출 실패, 누르면 1.5초 뒤 실패) |
| S-18 | `/applications/[id]/drafts/[draftId]/questions` | 기존 + `consent-required` · `insufficient-project-fields` · `extract-failed` · `extract-failed-input` · `extract-failed-wait` |
| S-19 | `/applications/[id]/drafts/[draftId]` | 기존 + `consent-required` · `insufficient-project-fields` · `input-failed` · `request-wait`. 실데이터: 픽스처 초안 3(경력기술서 실패) |
| S-13 / S-31 | `/applications`, `/applications/[id]` | 바뀐 값 없음(상태는 실데이터 `insight_status`·`interview_status`) |

`finalizing` 단독 미리보기는 S-19에 넣지 않았다(mock 스트림이 마무리 단계에 멈추는 옵션이 없음). `ai-stream`으로 마무리 중 → 교체를 지나가며 볼 수 있다.

## 3. [UI-가정]

| 화면 | 파일 | 내용 |
|------|------|------|
| S-14 | `_lib/actions.ts` `createApplicationAction` | 하나만 입력하면 data layer가 그 값 하나로 이름을 만들지 않도록 빈 이름("")을 넘김(파운데이션 요청 1) |
| S-14 | `application-new-form.tsx` | 붙여넣기 상한 50,000자는 막는 값으로 유지(명세 길이 검사는 경고 2개뿐). 이름 안내 문구 |
| S-15 | `jd-view.tsx` `ExtractionFailed` | 작업 행이 없는 미리보기의 요청 안 대기 20초 |
| S-16 | `insight-view.tsx` | 진입 시 늦은 실패는 작업 id를 몰라 "다시 시도" = 새 인사이트 실행(같은 행 아님, "처음부터 다시" 줄 없음) — 파운데이션 요청 3 |
| S-16 | `insight-parse.ts` `hideInternalAliases` | 괄호 안 별칭은 지우고, 맨 별칭은 "해당 항목"으로 바꾸는 표시 보호 |
| S-17 | `drafts-view.tsx` | AI-11 자동 실행이 없을 때(키 없음·연결 직후·요건 선행 추출 필요)의 기본은 "직접 고르기 + 체크 없음"(이전 "최신 경력순 전체"를 A23에 맞춰 없앰) |
| S-17 | `drafts-view.tsx` | 요건이 없으면 들어갈 때 AI-11 자동 실행 안 함(D-30 자동 추출 금지와 A13 순서) |
| S-17 | `drafts-view.tsx` | 문구 "프로젝트는 8개까지 고를 수 있어요", "포함할 항목을 1개 이상 골라 주세요"(G-39), 목록 행에 "· 문체 간결/상세" 표시 |
| S-17 | `drafts-view.tsx` | 실패 경력기술서 다시 시도의 `regenerated_from_id` = 실패 초안 id |
| S-18 | `cover-letter-questions.tsx` | "문항은 10개까지 추가할 수 있어요", 문항 글자 수는 90%부터 표시 |
| S-19 | `draft-editor.tsx` | 생성 직후 안내 내용은 mock이 화면에서 만듦(포함하지 않은 프로젝트 최대 3개, 자리 표시 개수, 글자 수 범위 밖) — 파운데이션 요청 4 |
| S-19 | `draft-editor.tsx` | "생성에 실패했어요…" 첫 줄을 Alert 안이 아니라 바로 위에 둠(AiErrorNotice에 자리 없음) — 파운데이션 요청 5 |
| S-19 | `draft-editor.tsx` | 경력기술서 중단 문구 "생성을 중단했어요. 확정되기 전 내용은 남지 않아요", 이전 방문에서 실패한 자소서 문항 "이 문항을 만들지 못했어요"(원인 저장 없음) |
| S-19 | `draft-editor.tsx` | `validation_report.char_adjust_needed` 키 이름, 안내 상자 "글자 수를 맞추지 못했어요" 아래 한 줄 "제출 전에 글자 수를 확인해 주세요", 제목 "생성 직후 안내"(G-40) |

## 4. 파운데이션 요청

1. `createApplicationProject`(S-14): 이름은 회사명·포지션명 **둘 다** 있을 때만 "회사명 – 포지션명"(user), 아니면 키 없음 = 기본 이름(default) / 키 있음 = null(추출 대기). 지금은 하나만 있어도 그 값으로 이름을 만든다(영역은 "" 우회). **요건 추출이 실패해도 같은 규칙으로 기본 이름**을 채우는 처리도 필요(mock 추출은 실패하지 않음).
2. `retryJdExtraction`: "이미 추출 중"을 `true`와 구분해 돌려주기(영역 액션이 먼저 상태를 읽어 `{ already: true }`로 우회 중). mock 추출 실패 주입(`?state` 없이 실데이터로 S-15/S-17 실패 재현) 옵션.
3. `AiFeatureStatusView.failure`에 실패 작업 `job_id`(또는 `getInsightState`에 결과보다 늦은 실패 인사이트 행). S-16 진입 시 늦은 실패를 **같은 행 다시 시도**(`aiErrorFromJob` → "처음부터 다시")로 보이려면 필요.
4. 서류 생성 계획(`prepareCareerDescription`/`prepareCoverLetterSection`)이 `notes`(omitted·notes_for_user·char_adjust_needed)와 `adjust_length`를 실어 주기. `GenerationNotesPayload.omitted`는 명세상 "항목 + 이유"라 `{ item, reason }[]`가 맞아 보임(지금 `string[]`, 영역은 " — "로 나눠 표시). 자소서 `char_adjust_needed`를 `draft_sections.validation_report`에 남기기(다시 열 때 경고).
5. `AiErrorNotice`에 설명 첫 줄(`lead`) 자리 — S-19 경력기술서 실패 "생성에 실패했어요. 다시 시도하면 새 초안으로 처음부터 만들어요"를 Alert 안 첫 줄로 두기 위해(design-system 6장 A3).
6. `finalizeCoverLetterSection`: 문항 생성 완료 시 `drafts.provider·model·model_tier`를 그 문항 값으로 갱신(S-17·S-19 "마지막으로 생성 완료된 문항" 배지). 지금은 영역이 섹션에서 계산.
7. `finalizeCareerDescription`: 중단(canceled)은 실패가 아니므로 블록 없이 끝나도 `failed`로 두지 않기(지금은 확정 블록 없이 중단하면 "생성 실패" 행이 됨). 실패 시 `ai_jobs`(career_description, `target_type = 'draft'`) 행 기록 — 다시 열 때 C-20 원인을 보이려면 필요(픽스처 초안 3만 작업 행이 있음).
8. `prepareCareerDescription`/`prepareCoverLetterSection` 안의 `ensureJdRequirementsInDb`(같은 요청 안 추출)는 A13("생성 요청 안에서는 추출하지 않음")과 다름 — 화면이 먼저 추출하므로 영역 흐름에는 영향 없지만 백엔드 연결 전 정리 필요.

## 5. 기획 확인 필요

| 화면 | 질문 | 스펙 위치 |
|------|------|-----------|
| S-17 | AI-11 자동 실행이 없는 진입(키 없음·연결 직후·요건 없음)의 기본 선택. A23은 "실패 시 대체 없음"만 정함 — 구현은 체크 없는 직접 고르기 | 02 C-11, S-17 v5.3 |
| S-17 | 요건이 없는 JD에서 들어갈 때 AI-11을 자동으로 돌릴지(그러려면 추출을 자동으로 해야 해 D-30과 충돌) — 구현은 "AI에게 맡기기"를 누를 때 추출 → AI-11 | 02 FL-03, S-17 A13 |
| S-17 | 1개 이상 선택·8개 상한·10문항 상한 안내 문구(P-13), 문체 선택 위치(G-39) | design-system P-13, G-39 |
| S-16 | 진입 시 보이는 늦은 실패의 "다시 시도"가 같은 행이어야 하는지(데이터 계층에 작업 id 필요, 파운데이션 요청 3) | 02 C-03 진행 표시 우선순위, S-16 v5.3 |
| S-19 | 경력기술서 생성 중 "중단"을 누른 경우 남길 것(확정 전 블록은 임시) — 구현은 아무것도 남기지 않음 | 02 C-04 블록 확정 시점 |
| S-19 | 생성 직후 안내 `omitted`의 형태(항목·이유 분리 여부) | 02 S-19 A21, AI 명세 |

## 6. 검사 결과

- `pnpm lint` → 종료 코드 0(오류 0; 경고는 A2·A4 파일만).
- `pnpm typecheck` → 종료 코드 0. 작업 중 한때 A4 파일(`interviews/result-view.tsx`, `applications/[id]/interview/[sessionId]/page.tsx`)의 타입 오류가 보였으나 마지막 실행에서는 없었다(A4 병행 작업).
- build: 지시대로 생략.
- SSR 확인(dev :3000): `/applications`, `/applications/new`, 허브, S-15 `?state=request-wait` · `ai-failed-input`("요건 정리하기로 새로", "채용 공고가 아닌") · `retry-refused-key-missing`("작성한 내용은 저장"), S-16 `?state=insufficient-project-fields`("마저 채우기") · `retry-not-retryable` · `input-failed`("고친 뒤 다시 생성"), S-17(ap 2: "생성 실패" 행 + "다시 시도", 문체), S-18("90~110%", "최대 10%까지"), S-19 초안 3("새 초안으로 처음부터", "결과를 정리하지 못했어요"), 자소서 초안 2("현재 …자 / 제한 …자") 모두 200.

## QA 1차 수정 (`12_ui-qa_v53_A3_review.md` 대응)

| ID | 수정 | 파일 |
|----|------|------|
| UQ-510 (Major) | `jdRunState.extractFirst`를 "요건 없음(추출 전·**추출 실패**)"으로 넓힘. S-17·S-18은 실패 JD에서도 추출을 먼저 끝낸 뒤 초안 행을 만듦. S-19 자체 실행 버튼(초안 생성·이 문항만 생성·다시 생성·근거 변경 다시 생성·실패 다시 시도)과 `?generate=` 자동 시작도 `useRequirementsFirst`를 거침. S-17 실패 행 다시 시도도 같음 | `_lib/jd-state.ts`, `draft-editor.tsx`, `drafts-view.tsx`, `cover-letter-questions.tsx`, `drafts/page.tsx` |
| UQ-511 (Major) | 파운데이션이 기계적으로 넣은 `canceled`·`error_code`·`retry_after`·`quota_resets_at` 전달을 확인하고 유지 | `draft-editor.tsx` |
| UQ-513 (Major) | S-15 입력 원인 실패에 "요건 정리하기" `AiRunButton`(+ C-19, 거부는 버튼이 처리). 다시 시도는 여전히 없음 | `jd-view.tsx` |
| UQ-516 | 화면의 `mockNotes`·글자 수 계산 삭제 → 계획의 `plan.notes`·`plan.adjust_length`. `?state=ai-stream` 다시 보기만 고정 미리보기 안내 | `draft-editor.tsx` |
| UQ-517 | 별칭에 `ACH-n`·`SKL-n`, 괄호 안 `Sn` 추가. **맨 `Sn`은 지우지 않음**("AWS S3" 같은 실제 글자를 망가뜨리므로, [UI-가정]) | `insight-parse.ts` |
| UQ-518 | 폼이 `name: null`만 보내고 이름 규칙·100자는 data layer가 정함(파운데이션이 "" 우회 삭제) | `application-new-form.tsx` |
| UQ-519 | v4 `JdFailedNotice` 삭제. S-16은 실행 시 `prepare`에서 다시 추출, 서류는 선행 추출 | `shared.tsx`, `insight-view.tsx` 등 |
| UQ-520 | 늦은 실패에 `failure.job`이 있으면 그 작업을 `useAiJob`으로 잡아 **같은 행 다시 시도**(`aiErrorFromJob`, "처음부터 다시", `job.refusal`). 작업 없는 `stalled`만 새 실행이고 거부는 `refusal`로 표시. 첫 프레임 진행 표시 깜빡임 방지 | `insight-view.tsx` |
| UQ-521 | S-19 실패 화면: 키 없음·무효면 다시 시도를 숨겨 새 초안 행을 만들지 않고 C-18 인라인 / `key_invalid` 안내. 새 초안 실패 시 로딩 되돌림 + 토스트. S-17 행도 try/catch + A13 | `draft-editor.tsx`, `drafts-view.tsx` |
| UQ-522 | 결과 배지를 `draft.provider`·`model`·`model_tier`로(섹션 `updated_at` 계산 삭제). 완료 문항이 없으면 배지 없음 | `draft-editor.tsx`, `drafts-view.tsx`, `drafts/page.tsx` |
| UQ-523 | 요건 선행 추출 30초 초과 → `timeout` C-20. 실패 C-20 다시 시도가 거부되면 원래 실패를 유지하고 거부 행 표시(`refusalOf`를 `extract-first.tsx`로 옮김) | `extract-first.tsx`, `jd-view.tsx` |
| UQ-524 | S-19 `?state=finalizing`: 첫 섹션 블록을 임시 상태로 그린 정지 화면 + "마무리 중…", 전체 복사 비활성 | `draft-editor.tsx`, `[draftId]/page.tsx` |
| UQ-525 | 블록 없는 실패 초안 머리 설명은 "생성 실패"만 | `[draftId]/page.tsx` |
| UQ-526 | S-31 생성 중 판정을 `insight_status.kind`만으로(남은 `generating` 행은 실패/`stalled` 한 줄) | `[id]/page.tsx` |
| UQ-527 | 허브 JD 카드 "공고 요건 정리 중" | `[id]/page.tsx` |
| UQ-528 | 다시 생성 성공 시 그 대상의 생성 직후 안내를 교체(새 안내가 없으면 지움) | `draft-editor.tsx` |
| UQ-529 | 실패 행 삭제 버튼 이름 "{초안} 삭제" | `drafts-view.tsx` |
| UQ-530 | S-15 진입 시 추출 중이면 "이미 정리하고 있어요", 이 화면에서 시작했으면(`?extracting=self`) "공고 요건 정리 중" | `jd/page.tsx`, `jd-view.tsx` |
| UQ-531 | 경력기술서 `partially_failed` 분기·"이 섹션을 만들지 못했어요" 삭제 | `draft-editor.tsx` |

파운데이션 2차 반영 채택: 이름 규칙, `already`, `failure.job`, `notes`·`adjust_length`, `lead`(실패 첫 줄이 이제 Alert 안), 중단 처리, 문항 완료 시 초안 메타 복사. 위 4절 요청 1~8은 이것으로 닫힘.

새 [UI-가정]: 맨 `Sn` 유지(UQ-517) · `?extracting=self` 표시용 쿼리, S-14 자동 추출 직후 진입도 "이미 정리하고 있어요"(UQ-530) · S-19 C-20 다시 시도·근거 변경 재생성의 거부는 토스트(`notifyAiRejected`) · 추출 30초 초과 = `timeout`.

손대지 않음: UQ-514(기획 확인, 입력 원인 "고친 뒤"인데 원문 교체 불가), UQ-512·515(파운데이션).

검사: `pnpm lint` 통과 · `pnpm typecheck` 통과. dev 서버 SSR로 확인. **클릭 흐름(실패 JD 선행 추출 → 생성, 거부 행, 다시 생성 안내 교체)은 브라우저로 보지 못했다.**
