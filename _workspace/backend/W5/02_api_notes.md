# W5 API 노트 (중간 상태 제거, 운영 빌드 fixture 차단)

커밋, 원격 적용, 배포, 실제 공급자 호출 없음. `supabase db reset` 안 함. 로컬 스택에 시험 계정을 만들어 쓰고 지웠다(`auth.users`에 `w5-api-%` 0행 확인).

## 결론
- 평범한 요청에서 data 함수가 mock 저장소에 닿는 길은 정적 검사 기준으로 없다. 진짜 누수 3종을 고쳤다(아래).
- 운영 빌드는 `?state=`를 무시한다. `next start`에서 익명은 이동, 로그인은 실제 행을 본다.
- fixture 묶음(`fixtures.ts`)은 클라이언트 번들에 없다. 작은 미리보기 문구만 남아 있고, 파일이 UI 소유라 보고만 한다.
- **남은 판단 1건**: `DISCLOSURE_FACTS`(동의 고지 문구)와 `AI_PROVIDERS`가 `lib/mock/`에 있고 실제 경로에서 쓰인다. 저장소 데이터는 아니지만 이름과 위치가 틀렸다.

## 1. 제거한 중간 상태
| 대상 | 처리 |
|------|------|
| `source.ts` `isMockRow` | 삭제. `source.ts`가 이제 `lib/mock`을 import하지 않는다 |
| `ai-jobs.ts` `usesMockStore` | 삭제. `getAiJob`, `cancelAiJob`, `retryAiJob`, `regradeFailedAnswers`, `startRemainingQuestions`는 `isPreviewRequest()`만 본다 |
| `listActiveAiJobs` 합치기 | 삭제. 실제 행만 돌려주고 미리보기는 mock만 |
| `getLatestJobFor`의 저장소 선택 | 삭제. 지시 목록에는 없었지만 같은 중간 분기였다(평범한 요청이 `mockRequest(0)`을 읽었다) |
| `startAiJob` | 삭제(호출처 없음) |

## 2. 감사
새 시험 `lib/data/mock-isolation.test.ts`가 소스를 AST로 읽는다. 저장소 호출(`mockRequest`, `getMockDb`, `resetMockDb`, `createFixtures`)이 `previewOr` 첫 인자, 미리보기 참 분기, `if (!(await isPreviewRequest())) { 항상 종료 }` 뒤에 있지 않으면 그 함수를 표시하고, 호출 관계로 파일 사이까지 전파한다. export 함수가 표시되면 실패한다.

검사 자체도 확인했다. 시험 안에 누수 5종·가드 6종 예제가 있고, `getAiPriceTables`의 가드를 일부러 깨면 `getAiPriceTables`와 `getAiPriceTablesAction`을 잡는 것을 봤다(되돌림).

한계: 이름 기준 검사다. 지역 변수로 함수를 넘기는 우회나 같은 이름의 다른 함수는 구분하지 못한다. 저장소 호출만 본다.

### 진짜 누수 (고침)
| 함수 | 문제 | 처리 |
|------|------|------|
| 위 1번의 `ai-jobs.ts` 함수 전부 | 평범한 요청이 저장소를 읽음 | 위와 같음 |
| `setMockControls`, `getMockControls`, `publishMockReconsentDisclosure` | 가드 없음. `setMockControls`는 `isPreviewEnabled`로 쓰기만 막았고 읽기는 그대로였다. 공개 Server Action 뒤에 있다 | 평범한 요청은 저장소 전에 throw. `/dev/states`는 미리보기 요청이라 계속 동작해야 한다(개발 서버로는 못 돌림) |
| `saveJdRequirement`, `deleteJdRequirement` | 가드 없는 mock 쓰기. 호출처 없음 | 삭제 |

export만 뗀 것: `appendWritingChatMessage`, `completeMockAssistantTurn`(미리보기 분기에서만 호출). `buildChatView`는 `isPreviewRequest()`를 `Promise.all` 밖으로 뺐다(동작 같음, 검사가 읽을 수 있게).

### 남은 `lib/mock` 사용: 전부 분류
| 분류 | 대상 |
|------|------|
| 미리보기 전용 (`previewOr` 또는 `isPreviewRequest` 뒤) | `account`, `ai-connection`, `ai-jobs`, `ai-usage`, `applications`, `career`, `deletion`, `drafts`, `evidence`, `interviews`, `readiness`, `shell`, `writing-chats`, `writing-chat-view`의 저장소 호출 전부와 `mock*` 도우미 |
| 순수 함수, 넘겨받은 `db`만 씀 | `computeReadiness`, `computeAiConnection`, `computeAiUsageSummary`, `summarize`(`applications-real`이 실제 행으로 만든 객체를 넘김), `ensureJdRequirementsInDb`, `refreshApplicationJobs`, `gradingFactsOf` 등 |
| 실제 경로에서 쓰는 상수·유틸 | `AI_PROVIDERS`(`realOverview`, `keyFormatOk`), `nowIso`, `currentPeriodMonth`, `clone` |
| 실제 경로에서 쓰는 오류 타입 | `MockAiError`(`ai-guard`, `drafts-real`, `components/career/actions`). 저장소를 안 본다. 이름만 틀렸다 |
| 진짜 누수 | 위 표. **지금 0건** |

`USER_ID`, `newId`, `IDS`, `mockAiMeta`, `createMockJob`도 따로 훑었다. 전부 미리보기 전용 도우미 안에서만 쓰인다. 일회성 스크립트로 봤고 시험으로 고정하지는 않았다.

### `src/components`·페이지의 `lib/mock` import
| 파일 | 가져오는 것 | 운영에서 닿는가 |
|------|-------------|-----------------|
| `app/(focus)/settings/ai/connect/page.tsx`, `components/account/{ai-connection-panel,ai-format,ai-usage-panel,deletion-summary,key-connect-flow,provider-card}`, `components/applications/drafts-view`, `components/career/writing-chat/chat-screen`, `components/common/{ai-error-notice,ai-feature-status,delete-confirm-dialog,provider-badge}`, `components/common/shell/{nav-ai-status,shell-parts}`, `components/interviews/interviews-overview` | `ai-providers`의 표시 상수 | 닿음. 상수뿐 |
| `components/common/data-use-consent` | `ai-providers`의 `DISCLOSURE_FACTS` 등 | 닿음. **실제 C-21 고지 문구가 이 상수다.** 아래 "확인 필요" |
| `components/common/streaming` | `ai-stream`의 `mockBlockStream`, `mockChatTurn` | 코드는 번들에 있음. 실행은 안 됨: 실제 경로의 계획은 항상 `endpoint`를 갖고, 나머지 호출은 미리보기 분기와 갤러리뿐이다(코드로 확인) |
| `components/career/actions` (`"use server"`) | `MockAiError` | 서버 전용. `instanceof`만 |
| `components/common/dev-state-gallery-v53` | `IDS` | `/dev/states` 전용. 운영 404 |

`lib/mock/store`, `lib/mock/fixtures`의 값을 import하는 곳이 `lib/data`·`lib/mock` 밖에는 없다(시험으로 고정).

## 3. 운영 빌드
`previewOr`는 원래도 운영에서 mock을 고르지 않았다. 빠진 것은 증명이었다(기존 시험은 `isPreviewEnabled`를 mock으로 바꿨을 뿐이다).

새 시험 `lib/data/source.production.test.ts`: 실제 모듈 + `NODE_ENV=production`. 위조 헤더가 와도 실제 분기, mock 콜백 미호출, 헤더 자체를 읽지 않음, `?state=` 읽기 함수 전부 `null`, 프록시가 표시를 안 붙이고 위조 헤더를 지움, `/dev/` 404.

### `next start`(포트 3517, 시험 뒤 종료) + 실제 세션 쿠키: 45개 전부 통과
| 항목 | 결과 |
|------|------|
| 익명 `/career?state=empty` | 307 → `/sign-in?next=...` |
| 익명 `/applications`, `/settings/ai`, `/board`, `/interviews`에 `?state=`, 위조 헤더 | 모두 같은 이동 |
| 로그인 `/career?state=empty` | 200. 방금 넣은 실제 경력 행과 실제 메일이 보임, fixture 문자열 0, 미리보기 전환 버튼 없음 |
| 로그인 `/dev/states`, `?state=q53`, `/dev` | 404 |
| `listActiveAiJobsAction` | `[]`(fixture 작업 없음). 합치기 제거의 직접 증거 |

처음 2개 판정이 실패했는데 내 판정이 틀린 것이었다. `setMockControlsAction`, `publishMockReconsentDisclosureAction`을 `/career`로 보내면 "거부"가 아니라 200 `{}`가 온다. 이 두 Action은 `/dev/states` 워커에만 등록돼 있고 `/dev/states` POST는 프록시가 404로 끊는다. 서버 로그에 내 가드 오류가 없으므로 **실행 자체가 안 된 것으로 본다**(내부 전달 동작을 직접 추적하지는 않았다). 판정을 "mock 데이터가 안 나옴"으로 바꿨다. 즉 가드는 2차 방어이고 운영에서 직접 실행해 보지는 못했다. 단위 시험으로만 확인했다. `getMockControlsAction`은 쓰는 곳이 없어 빌드에서 빠졌다.

### 운영에서 `?state=`가 그리는 것
**평범한 주소와 같다.** 화면 단위 미리보기는 전부 `getPreviewState`·`usePreviewState`를 거치고 운영에서 `null`이다. `searchParams.state`를 직접 읽는 화면은 없다(`PreviewStateSwitcher`는 `isPreviewEnabled`로 먼저 끝남).

로그인 상태로 11개 경로의 `?state=` 26개를 평범한 주소와 대조했다: 상태 코드 같음, 보이는 글자(스크립트 제외, 정렬한 낱말 비교) 같음, fixture 문자열 0. 대상: `/career`, `/career/skills`, `/applications`, `/board`, `/interviews`, `/settings`, `/settings/ai`, `/settings/ai/usage`, `/settings/withdraw`, `/sign-in`, `/consent`.

바이트 단위로 같지는 않다. URL이 페이로드에 들어가고 스트림 순서가 달라진다. `[id]` 경로와 `(focus)` 화면은 대조하지 않았다. 같은 함수를 쓰므로 같을 것으로 보지만 추정이다.

`?next=`에 `state=empty`가 그대로 실린다. 로그인 뒤 그 주소로 가도 위와 같아 문제는 없다.

## 4. 클라이언트 번들
`.next/static/chunks` 64개, 2.4MB에서 `fixtures.ts`의 문자열 199개를 찾았다.

| 찾은 것 | 위치 | 크기 |
|---------|------|------|
| fixture 묶음 자체 | 없음. `김지우`, `createFixtures`, `mock_controls` 0건 | - |
| 갤러리 예시 문구, `next_retry_refusal` | 청크 1개. `/dev/states` 매니페스트만 참조. 운영에서 페이지는 404지만 **청크 주소를 알면 받을 수 있다** | 49.8KB |
| `jiwoo.kim@example.com` | `sign-in-form.tsx`, `preview === "sent"`일 때만. 가짜 주소 | 문자열 2개 |
| `그린페이먼츠 › 결제 승인 API 성능 개선` | `draft-editor.tsx` 미리보기 분기 | 문자열 1개 |
| `그린뱅크 – 결제 백엔드 엔지니어` | `return-banner.tsx` 미리보기 값 | 문자열 1개 |
| `mockBlockStream`, `mockChatTurn` 코드 | `streaming.tsx`를 쓰는 화면 청크 | `ai-stream.ts` 239줄 분량 |
| 나머지 적중 | "원본 삭제됨", "잘 모르겠어요", 입력 예시 등 일반 문구가 우연히 겹침 | - |

전부 가짜 예시 문구이고 실제 사용자 데이터·비밀값은 없다. 쉽게 고칠 수 있는 것은 없었다. 전부 UI 소유 파일이고, 갤러리 청크를 없애려면 `pageExtensions` 분기와 파일 이름 변경이 필요하다. 그래서 고치지 않았다.

## 5. 문서
`docs/planning/04-data-model.md` 제목과 상태 줄을 v4.3b로, `docs/planning/README.md` 버전 표를 v4.3b로 맞췄다.

## 시험
| 명령 | 결과 |
|------|------|
| `pnpm lint` | 오류·경고 0 |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 102파일 1,626건 전부 통과 |
| `pnpm build` | 성공(exit 0) |
| `pnpm db:test` | 51파일 2,383건 PASS |

새 시험 3파일: `mock-isolation.test.ts`, `source.production.test.ts`, `mock-controls.test.ts`. `source.test.ts`에서 `isMockRow` 시험을 뺐다.

## 돌리지 못한 것
- **개발 서버의 `/dev/states`와 갤러리 컨트롤.** 포트 3000 개발 서버가 W5 UI 노트대로 깨져 있고 같은 폴더에 두 번째를 띄울 수 없어서다. 미리보기 쪽 변경(`listActiveAiJobs`, `getLatestJobFor`, 가드 3개)은 단위·통합 시험까지만 확인했다. **ui-qa가 재시작한 개발 서버에서 갤러리 버튼 3종을 눌러 봐야 한다.**
- 브라우저 확인 전부. HTTP만 썼다.
- 실제 공급자 호출, 원격, 배포.

## 건드리지 않은 프로세스
포트 3000, 3457, 3467, 3999는 내가 띄운 것이 아니라 끄지 않았다. `pnpm build`가 `.next`를 다시 써서 `next start` 쪽은 재시작이 필요할 수 있다.

## 확인 필요 (리더)
1. **`DISCLOSURE_FACTS`, `AI_PROVIDERS`, `AI_PROVIDER_*`를 `lib/mock/` 밖으로 옮길지.** 동의 고지 문구가 `lib/mock/ai-providers.ts`에 있고 실제 화면에 나간다. 내용이 실제 고지로 맞는지는 내가 판단할 수 없다(D-39 법무 확인이 열려 있다). 옮기면 컴포넌트·페이지 17개와 `lib/data/ai-connection.ts`의 import만 바뀐다. UI 소유라 건드리지 않았다.
2. `MockAiError`가 실제 경로의 거부 타입으로 쓰인다. 동작 문제는 아니고 이름 문제다. 1번과 같이 정리하면 된다.
3. 저장소에 직접 차단선을 넣을지. `lib/mock/store.ts`의 `getMockDb`가 운영에서 throw하면 시험이 놓친 경로도 막힌다. `lib/mock/`은 수정 금지 범위라 넣지 않았다. 두 줄이고 권한만 있으면 바로 넣을 수 있다.
4. W1이 W5로 넘긴 `after()` 단계의 Vercel 시간 제한(잡 폴링이 Server Action을 거쳐 `maxDuration = 60`이 적용되지 않음)은 이번 지시에 없어 보지 않았다. 배포 환경이 있어야 확인된다.
