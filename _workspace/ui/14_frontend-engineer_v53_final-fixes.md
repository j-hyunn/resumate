# 프론트엔드 — 기획 v5.3 최종 수정 (UQ-580~588)

> 2026-10-30. 입력: `13_ui-qa_v53_integration_review.md`. mock만 수정, 커밋 없음. `docs/planning`과 테마 파일은 건드리지 않았다. dev 서버는 시작·종료하지 않았다.

## 결과

9건 모두 수정. 닫을 때 사유를 단 건은 없다(UQ-586도 수정).

| ID | 수정 | 파일 (`src/` 기준) |
|----|------|-------------------|
| UQ-580 (Major) | 동의 필요·키 무효면 추출 없이 저장(`pending`, D-30 이름 규칙). 행은 작업 생성이 끝난 뒤에 넣으므로 실패해도 남지 않는다. S-14에 안내 한 줄, 회사명·포지션명 입력란 펼침, C-21은 열지 않음 | `lib/mock/ai.ts`(`runnableKey`), `lib/data/applications.ts`, `applications/_lib/actions.ts`, `applications/new/page.tsx`, `components/applications/application-new-form.tsx`, `components/common/ai-lock.tsx` |
| UQ-581 | `getInsightState().generating`은 작업이 대기·실행 중인 행만 돌려준다. 그래서 끝났거나 없는 작업의 행은 `insight_status.failure`(`stalled`)로 S-16에 나온다. 새 실행은 멈춘 행을 `failed`로 닫는다 | `lib/data/applications.ts` |
| UQ-582 | S-20이 `?state=insufficient-project-fields` 처리 | `applications/[id]/interview/page.tsx` |
| UQ-583 | S-13 문구를 `AI_STAGE_LABELS.prepare`("공고 요건 정리 중")로. Q-18을 `[UI-가정]` 주석에 적음 | `components/applications/application-list.tsx` |
| UQ-584 | 첫 열람 기록이 끝나면 `resumate:ai-jobs-changed` 발행 | `components/interviews/result-view.tsx` |
| UQ-585 | `shell.ts`가 `hasNewResult` 사용 | `lib/data/shell.ts` |
| UQ-586 | 가드 면제를 `/settings/withdraw` 전체에서 `/settings/withdraw/finalize`로 좁혔다(한 줄). 레이아웃 변경 없음 | `components/common/shell/deletion-guard.tsx`, `lib/routes.ts`(주석) |
| UQ-587 | `WRITING_CHAT_FIELD_LIMITS` 사용, 로컬 사본 삭제 | `components/career/writing-chat/draft-preview.tsx` |
| UQ-588 | 동의 필요·키 무효면 자동 AI-11을 보내지 않고 기다린다. "직접 고르기 + 체크 없음"으로 시작하고, "AI에게 맡기기"를 고르면 `consent.guard`가 C-21을 연다 | `components/applications/drafts-view.tsx` |

## 지시 범위 밖이거나 판단이 들어간 부분

- **UQ-581의 `startInsight` 변경:** 지시에는 없었다. 멈춘 행이 남아 있으면 새 실행이 성공한 뒤에도 S-13·S-31·S-16이 계속 `stalled`로 보이기 때문에 넣었다. 작업이 살아 있는 행은 건드리지 않는다.
- **UQ-588의 키 무효:** 지시는 동의 필요만 말했지만, 키 무효도 같은 이유로 요청이 거부되므로 함께 막았다.
- **`AiLock` 공통 컴포넌트:** 선택 prop 2개 추가. `title={null}`(인라인에서 제목 줄 생략), `actionLabel`. 기존 호출은 그대로다.
- **S-14 미리보기:** `?state=consent-required`·`key-invalid`는 클라이언트에서만 연결 상태를 바꾸므로, 그대로면 서버가 추출을 돌려 안내와 어긋난다. 그래서 미리보기 전용 값 `preview_skip_extraction`을 넘긴다.
- **S-14 C-19 배지:** 유지했다. "동의 필요"·"키를 확인해 주세요"를 보여 주고 S-40으로 연결되어 안내와 맞는다.

## `[UI-가정]` 추가

| 화면 | 내용 |
|------|------|
| S-14 | 동의 필요 안내: "데이터 사용 동의 전이라 요건 정리 없이 저장해요. 요건은 나중에 JD·요건 화면에서 정리할 수 있어요" |
| S-14 | 키 무효 안내: "AI 키를 확인해야 해서 요건 정리 없이 저장해요. 요건은 나중에 JD·요건 화면에서 정리할 수 있어요" |
| S-14 | 안내 옆 버튼 "AI 연결 확인"(→ S-40, 입력 복원). 키가 있는데 "AI 연결하기"는 맞지 않아 바꿨다 |
| S-14 | 위 입력 안내를 "채용 공고 전체를 그대로 붙여넣어 주세요"까지만 표시(요건 정리 약속 제거) |
| S-17 | 동의 필요 진입 때 C-21을 열지 않고 기다림 |
| S-13 | Q-18 표시 |

## 기획 확인 필요

- **Q-1 (S-14):** 여전히 열려 있다. 지금 구현은 리더 임시 결정 (나). (가)로 정해지면 `createApplicationProject`와 폼 안내를 바꿔야 한다.
- **Q-4 (S-17):** 동의 필요 진입 때 C-21을 바로 열지, 기본 선택을 무엇으로 할지. 지금은 기다림 + 직접 고르기. 왜 "직접 고르기"로 시작했는지 알려 주는 문구는 없다.
- **Q-18 (S-13·S-15):** 02와 03의 문구 차이. 코드는 02를 따른다.

## 확인한 것

**기계 검사:** `pnpm lint` 종료 0 · `pnpm typecheck` 종료 0 · `pnpm build` 종료 0(정적 페이지 40/40, warn·error 줄 없음). 빌드 후 :3000 응답 200.

**데이터 계층 실행** (scratchpad 임시 스크립트, 별도 프로세스의 fixture 저장소. :3000 저장소는 바꾸지 않음. 저장소에 넣지 않은 일회성 검사다):

| 경우 | 이름 / `name_source` | 추출 | 추가 행(프로젝트·JD·작업) |
|------|----------------------|------|---------------------------|
| 유효 | null / null | running | 1·1·1 |
| 동의 필요 | 새 기업 JD (2026-10-30) / default | pending | 1·1·0 |
| 동의 필요 + 회사명·포지션명 | A사 – B직 / user | pending | 1·1·0 |
| 키 무효 | 새 기업 JD (2026-10-30) / default | pending | 1·1·0 |
| `needs_check` | null / null | running | 1·1·1 |

- UQ-581: 실행 중 = `generating`. 작업이 끝남·없어짐 = `generating` 행 없음, `kind: none`, `failure: stalled`. 새 실행 뒤 = 옛 행 `failed`, 새 행 `generating`.
- UQ-585: 배지 수와 이전 조건의 수가 같음(2 = 2).

**SSR (:3000 curl):**

- S-14: `consent-required`·`key-invalid`에 안내·"AI 연결 확인"·입력란 있음. 일반 상태에는 없음. `ai-locked`는 기존 C-18 그대로.
- S-20: `insufficient-project-fields`에 "마저 채우기" 있음, `insufficient`에는 없음.
- S-17: 기업 JD 2~6에서 일반 상태는 "쓸 경력·프로젝트 고르는 중"이 나오고, `consent-required`·`key-invalid`에서는 나오지 않음.
- S-13: 옛 문구 없음.
- S-25: `/settings/withdraw`에 덮개가 HTML로 나옴(`?state=deletion-incomplete`도). 마무리 화면에는 덮개·셸 없음.

## 브라우저에서 확인하지 않은 것

브라우저로 클릭해 본 항목은 없다.

- **S-14:** 실제 "만들기" 클릭 → S-31(또는 S-39 토스트) 이동, 안내 줄의 배치와 좁은 화면 줄바꿈, "AI 연결 확인" 왕복 뒤 입력 복원.
- **S-16:** `stalled` 안내가 실제로 그려지는 모습과 "다시 시도". 데이터 값까지만 확인했다.
- **S-17:** 자동 AI-11이 없을 때 "AI에게 맡기기" → C-21 → 동의 후 이어서 실행.
- **S-22 → L-01:** 첫 열람 때 배지가 바로 줄어드는지. 코드로만 확인했다.
- **S-25 (UQ-586):** 실제 깜박임 여부. SSR HTML에 셸(`data-sidebar`)과 덮개가 함께 있고, 덮개가 셸보다 늦게 도착하는 순간이 있는지는 눈으로 보지 않았다. 다른 URL과 같은 가드 방식이다. 미완료 상태에서 마무리로 이동하는 것도 `?state=` 미리보기의 SSR로만 봤다.
- **S-25 일반 사용자:** `/settings/withdraw`를 직접 열면 이제 다른 화면처럼 첫 확인 동안 덮개가 잠깐 보인다.

## 남은 작은 항목

`?state=ai-locked`의 S-14는 이번 범위 밖이라 그대로다. 화면은 키 없음이지만 서버에는 키가 있어 만들면 추출이 돈다. 미리보기에서만 생기며 실제 키 없음 경로는 정상이다.
