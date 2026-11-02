# R1 AI 파이프라인 구현 노트 (A10 · A11 · A22 payload · A23)

## 바뀐 시그니처·payload (api-engineer 먼저 보기)

### A22 `complete_interview_questions.p_payload` — 최상위 키 2개 추가 (db R1 노트 모양)
```ts
type CompleteInterviewQuestionsPayload = {
  weak_requirement_ids: string[];
  insight_id: string | null;
  career_snapshot_hash: string;
  validation_report: Record<string, number> | null; // → interview_sessions.question_validation_report
  usage: NormalizedUsage | null;                      // → interview_sessions.question_usage
  meta: PayloadMeta;                                  // 기존 그대로(validation_report·usage도 같은 값)
};

buildCompleteInterviewQuestionsPayload({
  context, weakRequirementIds, existingWeakRequirementIds?, model,
  usage?, report?,
  attempts?: number | null,   // 신규: 세트를 만든 생성 호출 수. 주면 report에 attempts·regenerated(0/1)를 넣는다
  provider, connectionTier,
})

// 신규: 세트 단위 누적(호출마다 접어 넣는다). report는 키별 합, usage는 addUsage 합(한쪽 null이면 다른 쪽).
accumulateQuestionSetRecord(prev | null, { report, usage }) → { report, usage, attempts }
```
- **api 할 일**: `src/server/services/interview/job.ts`의 generate 단계는 지금 `last = { model, usage, report }`로 **마지막 호출 값만** 넘긴다. 세트 단위 기록이 되려면 partial에 `accumulateQuestionSetRecord(partial.set ?? null, result)`를 쌓고, complete 단계에서 `usage`·`report`·`attempts`를 그 누적값으로 넘긴다. 그대로 두어도 payload 모양은 맞다(마지막 호출 값이 들어감).
- `validation_report`는 숫자 카운트만이다(원문 없음). 주요 키: `questions_total`, `questions_dropped`, `dropped_<reason>`(아래 이유 목록), `composition_relaxed`, `composition_unmet`, `questions_extra`, `stream_incomplete`, `attempts`, `regenerated`.

### A23 AI-11 실패 = 대체 선택 없음
- 삭제: `fallbackSelection`(pipelines/AI-11), `fallbackSelectionFromAliases`(context-pack/selection). 호출처는 api가 이미 지웠다(`ranking.fallback` 제거).
- 신규: `emptyDraftSourceSelection(): DraftSourceSelection` — 네 배열이 모두 빈 선택. 실패 응답 `{ selection: 빈 목록, failed: true, reason }`과 `selectionOrigin = user`에 쓰면 된다(api가 직접 빈 값을 만들어도 같다).
- `rankDraftSources` 시그니처·실패 방식(재시도 1회 후 `AiError("schema_invalid")`)은 그대로다.

### A11 AI-05 버림 이유 추가
- `QuestionDropReason`에 `fact_premise_unsupported` 추가 → 보고서 키 `dropped_fact_premise_unsupported`.
- 신규 export `premisesUserFacts(kind, anchor, factualCareerEvidence, careerTermsInText): boolean`.

### A10 공용 헬퍼 (evidence-rules)
- `PROFILE_PREFERENCE_FIELDS = ["desired_job_title", "interested_industries"]`
- `isProfilePreferenceEvidence(e)`, `isCareerSupportEvidence(e, types = CAREER_SUPPORT_SOURCE_TYPES)`
- `isActionResultEvidence(e)` (상세 내용 action·result 또는 성과; AI-02 `supportsMet`와 AI-05가 함께 씀)

## 기능별 prompt_version (input_hash 재사용이 끊긴다)
| 기능 | 이전 | 이후 | 이유 |
|------|------|------|------|
| AI-02 단계 1 | `ai-02.match.v2+common.v1` | `ai-02.match.v3+common.v1` | A10 (같은 system 블록이라 두 단계 함께) |
| AI-02 단계 2 | `ai-02.synthesize.v2+common.v1` | `ai-02.synthesize.v3+common.v1` | A10 |
| AI-02 저장값 | `ai-02.match.v2+ai-02.synthesize.v2+common.v1` | `ai-02.match.v3+ai-02.synthesize.v3+common.v1` | |
| AI-03 | `ai-03.generate.v1+common.v1` | `ai-03.generate.v2+common.v1` | A10 |
| AI-04 생성 | `ai-04.generate.v1+common.v1` | `ai-04.generate.v2+common.v1` | A10 (system 블록 공유) |
| AI-04 보정 | `ai-04.adjust.v1+common.v1` | `ai-04.adjust.v2+common.v1` | A10 (system 블록 공유) |
| AI-05 | `ai-05.generate.v1+common.v1` | `ai-05.generate.v2+common.v1` | A10 + A11 |
| AI-06 | `ai-06.evaluate.v1+common.v1` | `ai-06.evaluate.v2+common.v1` | A10 |
- 공통 블록(`common.v1`)은 바꾸지 않았다. 규칙 문구는 `prompts/common.ts`의 `PROFILE_PREFERENCE_RULE` 상수 하나이고, V-4가 있는 기능(AI-02·03·04·05·06)의 기능 system 블록에 넣었다. AI-01·AI-07·AI-11·AI-12는 V-4 판단 항목이 없어 그대로다.
- 모델 등급·출력 스키마·`schema_version`은 바뀌지 않았다.

## 항목별 변경

### A10 — 프로필 희망 정보는 판단 근거가 아님 (AI v4.3 C-3 V-4, AI-02 판정 기준)
- V-4 집계(`validateItem`)가 `isCareerSupportEvidence`를 쓴다: `profile.desired_job_title`·`profile.interested_industries` 근거는 근거 수에 들어가지 않는다. `profile.total_years_of_experience`는 그대로 센다(연차 판정 근거).
  - 판단 항목(강점·포지셔닝·피드백) → 희망 정보만 남으면 버림 / 충족·부분 충족 판정 → `no_evidence` 강등 / 초안 블록(AI-03·AI-04·AI-06 개선 답변) → `evidence_check_needed`.
- 같은 판정을 직접 하는 곳도 바꿨다: AI-02 `isCareerFact`(applyMatchRules), AI-05 경력 근거(앵커·사실 전제·주 대상), AI-06 `consistency_notes` 사실 근거.
- 희망 정보 근거 자체는 V-1~V-3를 통과하면 근거 목록에 남는다(삭제하지 않고 "세지 않음"). 판단 항목이 다른 사실 근거로 살아남으면 희망 정보 근거도 `evidence_links`에 저장된다 — 아래 스펙 차이 ①.
- 프롬프트: "희망 직무·관심 산업은 문맥 참고일 뿐 경력 사실이 아니다. 판정·강점·지원 방향·본인 기여의 근거로 쓰지 않는다. 총 경력 연수는 연차 근거로 쓸 수 있다."

### A11 — 모든 직무 질문의 사실 전제 = action·result·성과 (AI v4.3 §4.1)
- 질문 유형별 필요 근거(4.1 v4.3 "구현 반영" 그대로): `project_deep_dive` = action·result·성과 근거(기존 `kind_target_missing`), `requirement_fit` = 대상 요건(`kind_target_missing`) + 사실 근거, `gap_probe` = 보완 요건 1개 이상.
- 사실 전제 검사(신규, `fact_premise_unsupported`): 직무 질문이 사용자 사실을 전제하면 근거에 action·result·성과가 하나 이상 있어야 한다. 상황·과제·프로젝트 요약·스킬 태그·희망 정보만이면 버리고 남은 칸을 다시 만든다(기존 질문 단위 재생성 경로).
  - `requirement_fit`: 항상 사실을 전제한다고 본다.
  - `gap_probe`: 다음 중 하나면 사실을 전제한다고 본다 `[가정]` — anchor `experience`, 사실 경력 근거(희망 정보·회고 제외)가 있음, 질문 문장에 경력 고유명사(`careerTerms`: 회사·기관·전공·프로젝트명·직급·직책·부서, JD·희망 직무에 있는 말 제외)가 있음. 셋 다 아니면 "비슷한 경험이 있다면" 형태로 보고 면제한다.
- 순서: 유형별 대상 검사 → 사실 전제 검사 → 컬처핏 고유명사 → V-5 → 중복 → 구성 규칙.
- 프롬프트: requirement_fit에 "action·result·성과 근거 필수", gap_probe에 "유사 경험을 짚으면 action·result·성과 근거, 없으면 사실 전제 없이(anchor jd, 경력 근거·고유명사 없이) 묻기", 공통 줄을 "모든 직무 질문(project_deep_dive, requirement_fit, gap_probe)"으로 바꿈.

### A22 — 세트 단위 기록 payload
- 위 시그니처 절 참고. db는 `p_payload.validation_report`·`p_payload.usage`(object 또는 null)를 읽는다. 기존 `meta`에도 같은 값이 그대로 들어간다(작업 메타 경로 호환).

### A23 — AI-11 대체 선택 제거
- 위 시그니처 절 참고. `AI-11.ts` 주석의 "the route then falls back to `fallbackSelection`"도 고쳤다.

## 검증 규칙 적용 범위 (바뀐 부분만)
| 규칙 | AI-02 | AI-03 | AI-04 | AI-05 | AI-06 |
|------|-------|-------|-------|-------|-------|
| V-4 희망 정보 제외(A10) | 판정·강점·포지셔닝·gap action | 블록 | 근거 선택·문단 | 앵커·사실 전제·주 대상 | 개선 답변·일관성 노트 |
| 사실 전제 action·result·성과(A11) | (met 기준 기존) | — | — | 직무 3유형 | — |

## 테스트·픽스처 (새 픽스처 없음, 기존 합성 픽스처 재사용)
- `validation/evidence.test.ts`: V-4 표에 A10 6건(희망 정보만 → drop/downgrade/flag, 연차 → keep, 희망+action → keep), `isCareerSupportEvidence` 표 8건 + 기능별 지원 집합에서도 제외.
- `validation/insight.test.ts`: applyMatchRules A10 4건.
- `pipelines/AI-05.test.ts`: A11 버림 5건(requirement_fit 상황만, requirement_fit 희망 직무만, gap_probe 프로젝트 요약, gap_probe 고유명사, gap_probe experience+스킬) + 면제 gap_probe 저장 + 유사 경험 action 근거 gap_probe 통과, `premisesUserFacts` 표 7건, A22 complete payload·누적 1건.
- `pipelines/AI-11.test.ts`: fallback 테스트 → `emptyDraftSourceSelection` 테스트로 교체.
- `prompts/profile-preference.test.ts`(신규): 5개 기능 system에 규칙 포함, 공통·AI-01 불변, 버전 문자열, AI-05 A11 문구.
- `pipelines/AI-04.test.ts`: 보정 prompt_version 기대값 v2로.
- 결과: `src/server/ai` vitest 41파일 739건 통과, `tsc`의 `src/server/ai` 오류 0, `eslint src/server/ai` 통과.
  - 전체 vitest의 실패 15건(ai-connection·writing-chat 통합 테스트)과 `tsc`의 `draft-fakes`·`drafts.integration.test`·`writing-chat/turn.test` 오류는 db/api의 A5·A13·A19 진행 중 변경에서 나온 것이다(AI 코드와 무관).

## 스펙 차이·가정
- ① 희망 정보 근거는 "세지 않음"만 하고 근거 목록에서 지우지는 않는다 `[구현 결정]`. 다른 사실 근거가 있는 판단 항목에는 희망 정보 근거 칩이 같이 저장될 수 있다. 칩까지 숨기려면 V-4 전에 제거하는 규칙(새 removal 사유)을 더한다.
- ② gap_probe의 "사실을 전제함" 판정 신호 `[가정]` (4.1 A11은 규칙만 정하고 판별 방법은 없음): anchor experience / 사실 경력 근거 / 경력 고유명사. 문장 표현("~하셨는데")은 보지 않는다. 평가 세트로 보정.
- ③ 세트 단위 usage·report 누적은 api 실행기가 해야 한다(현재 마지막 호출 값만 넘김). 헬퍼 `accumulateQuestionSetRecord`를 제공했다.
