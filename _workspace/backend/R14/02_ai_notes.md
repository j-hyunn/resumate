# R14 — ai-pipeline-engineer 노트 (AI 모의 면접 MVP 제외)

기준: AI 명세 v4.14 0.v414, C-3·C-4·C-5·C-6·C-13. 범위 `src/server/ai/`만.

## 지운 파일 (18)
- `pipelines/AI-05.ts`·`AI-05.test.ts`·`AI-06.ts`·`AI-06.test.ts`·`AI-07.ts`·`AI-07.test.ts`
- `prompts/AI-05/index.ts`·`prompts/AI-06/index.ts`·`prompts/AI-07/index.ts`
- `schemas/AI-05.ts`·`AI-06.ts`·`AI-07.ts`·`interview-common.ts`
- `storage/interview.ts`, `validation/interview.ts`·`interview.test.ts`, `context-pack/interview.ts`, `__fixtures__/S8/interview.ts`

## 고친 파일
| 파일 | 내용 |
|------|------|
| `evidence-rules.ts` | 출처 `interview_answer`(`ANS-n`) 삭제 — `EVIDENCE_SOURCE_TYPES`·`EVIDENCE_RULES`·`CAREER_SUPPORT_SOURCE_TYPES`. 주석의 면접 언급 정리 |
| `storage/evidence-links.ts` | `EVIDENCE_OWNER_TYPES`에서 `interview_question`·`answer_evaluation`·`session_feedback` 삭제(AI 모듈 상수만, `enums.ts`는 안 건드림) |
| `validation/evidence.ts` | `buildSelectionScope` 항상 허용 목록에서 `interview_answer` 삭제 |
| `context-pack/focus-slots.ts` | `GATE_FEATURES`에서 `job_interview` 삭제(3값) |
| `context-pack/career-rows.ts` | `emptyCareerRows`를 지운 `context-pack/interview.ts`에서 **옮겨 옴**(면접 전용이 아닌 테스트 헬퍼) |
| `context-pack/total-experience.ts`, `career-pack.ts`, `career-pack.test.ts` | 주석·테스트 이름의 면접(AI-06) 언급만 정리 |
| `prompts/AI-12/index.ts` | 복귀 대상 라벨 `job_interview: "직무 면접"` 삭제. 남은 라벨 문구는 바이트 그대로 → `ai-12.*` 버전 유지 |
| `prompts/common.ts` | **`common.v3` → `common.v4`**: 자리 표시 6 → 5개(`[사례 입력 필요]` 삭제, "이 5개만 사용"), 데이터 블록 목록에서 `<answer>` 삭제(C-4) |
| `validation/placeholders.ts` | `PLACEHOLDER_TOKENS` 5종. 모델이 `[사례 입력 필요]`를 쓰면 기존 "목록에 없는 토큰" 규칙으로 `[내용 확인 필요]` + `unknown_placeholders` |
| `prompts/AI-04/index.ts` | 빈 `<user_sources>` 규칙의 `[사례 입력 필요]` → `[내용 확인 필요]`, `ai-04.generate`·`ai-04.adjust` **v4 → v5** (spec-gaps R14-AI-1 `[가정]`) |
| `prompts/prompt-versions.test.ts`, `pipelines/AI-04·12·13.test.ts` | AI-05/06 블록 제거, 새 버전 고정, "면접 자리 표시·`<answer>` 없음"·"공통 블록 = C-5 5종" 테스트 추가 |

## `common.v4`와 바뀐 `prompt_version`
조합 규칙은 기존 그대로(`<call>.vN+${COMMON_PROMPT_VERSION}`), 접미사라 **모든 기능 문자열이 바뀐다** → AI-01·AI-02·AI-11 동일 입력 재사용 1회 단절(명세 0.v414가 예고).

| 호출 | 이전 | R14 |
|------|------|-----|
| AI-01 extract | `ai-01.extract.v1+common.v3` | `ai-01.extract.v1+common.v4` |
| AI-02 match / synthesize / 저장 | `ai-02.match.v5+…`, `ai-02.synthesize.v5+…`, `ai-02.match.v5+ai-02.synthesize.v5+common.v3` | 같은 호출 번호 + `common.v4` |
| AI-03 | `ai-03.generate.v4+common.v3` | `ai-03.generate.v4+common.v4` |
| **AI-04 generate / adjust** | `ai-04.generate.v4` / `ai-04.adjust.v4` + `common.v3` | **`ai-04.generate.v5` / `ai-04.adjust.v5`** + `common.v4` |
| AI-11 | `ai-11.rank.v2+common.v3` | `ai-11.rank.v2+common.v4` |
| AI-12 extract / reply | `ai-12.extract.v7` / `ai-12.reply.v7` + `common.v3` | 같은 번호 + `common.v4` |
| AI-13 extract / reply / compose | `v3` / `v3` / `v2` + `common.v3` | 같은 번호 + `common.v4` |

## 남긴 면접 문자열과 근거
- `prompts/AI-12/index.ts` 역할 "친절한 경력직 면접 코치" — 명세 0.v414 "남긴 것" 표(사용자 확인 필요 `[가정]`), 바꾸면 `ai-12.reply` 버전 상승.
- `prompts/AI-02/index.ts` `prepare_answer`("면접에서 이 요건을 질문받을 때…") — 실제 전형 준비 조언, 명세가 유지(`[가정]`).
- `data_sufficiency` `ok`/`thin` — AI-02가 씀. 코드에 `none` 수준은 원래 면접 모듈 안에만 있었고 같이 지워짐. `jd.ts`의 `includeSentences: "none"`은 JD 문장 포함 옵션이라 무관.
- 주석의 R14 이력 표기(`evidence-rules.ts`·`evidence-links.ts`·`focus-slots.ts`·`placeholders.ts`·`common.ts`·`AI-04`) — 지운 이유 기록.
- grep의 나머지 일치(`REQ-n`, `F-AI-05`, `NFR-AI-05`)는 면접과 무관.
- `EVIDENCE_OWNER_TYPES`의 `draft_section`은 R14 범위 밖이라 그대로 둠.

## api 조치 필요 (파일·심볼)
- `src/server/jobs/interview.ts` — `@/server/ai/pipelines/AI-05`·`AI-06`·`AI-07`, `@/server/ai/schemas/interview-common` (파일 삭제 대상)
- `src/server/services/interview/job.ts`·`job.test.ts`·`db.ts`·`interview.integration.test.ts` — `sessionDeliverableProjectIds`(AI-06), `context-pack/interview` (삭제 대상)
- `src/server/services/writing-chat/pipelines.ts:54` — `chat.returnTarget.feature`의 `"job_interview"` 분기·`readiness.features.job_interview`. `GateFeature`가 3값이 되어 TS2322
- `src/test/draft-fakes.ts:11`, `src/server/services/insight/job.test.ts:16` — `emptyCareerRows` import를 `@/server/ai/context-pack/career-rows`로 변경
- `src/lib/data/interviews.integration.test.ts` — 면접 통합 테스트(삭제 대상)
- UI 소유(참고): `src/types/db.ts:876`, `src/components/common/placeholders.tsx:31`의 `"[사례 입력 필요]"`, `src/lib/mock/fixtures.ts`·`src/lib/data/ai-jobs.ts`의 면접 mock

## 테스트 결과
- `pnpm vitest run src/server/ai`: **43 파일 / 1182 테스트 통과**
- `pnpm tsc --noEmit`: `src/server/ai/` 안 오류 **0**. 밖 오류 24건 — 위 api 조치 목록 10건 + `src/app/api/**/route.ts` 14건 `Cannot find name 'RouteContext'`(Next 타입 생성 전 상태, R14와 무관)
