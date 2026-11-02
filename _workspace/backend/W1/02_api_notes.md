# W1 API 구현 노트 (공통 연결)

커밋, 원격 적용, 배포, 실제 공급자 호출 없음. 로컬 스택만 썼다.

## 먼저 볼 것: 차단 1건
**새 사용자가 S-03을 통과하지 못한다.** DB는 `cross_border_transfer`를 필수로 보고 S-03 폼은 보내지 않는다(`spec-gaps.md` ⑲). 받지 않은 동의를 서버가 채울 수는 없어 그대로 뒀다. W2~W4를 실제 사용자로 돌리려면 이 결정이 먼저다. 끝까지 확인할 때는 시험 계정만 RPC로 직접 동의시켰다.

## 연결한 함수
| 파일 | 실제로 바꾼 함수 | 경유 |
|------|------------------|------|
| `lib/data/account.ts` | `getPolicyVersions`, `sendMagicLink`, `signInWithGoogle`, `signOut`, `getConsentStatuses`, `recordConsents`, `setOptionalConsent`, `getAccountDeletionSummary`, `getRunningAiJobCount`, `deleteAccountConfirmed`, `getAccountDeletionState` | `server/actions/{auth,consent,account}`, `services/shell` |
| `lib/data/account.ts` | `completeSignIn`: 미리보기 전용(실제 링크는 `/auth/callback`) | |
| `lib/data/shell.ts` | `getCurrentUser`, `getShellBadges`, `getServiceStatus` | `services/shell` |
| `lib/data/readiness.ts` | `getDataReadiness` | RPC |
| `lib/data/ai-connection.ts` | 읽기 7개 + `recordDataUseConsent`, `verifyAndSaveProviderKey`, `recheckProviderKey`, `deleteProviderKey`, `setActiveAiProvider`, `changeProviderTier` | `server/actions/ai-connection`, 서비스 |
| `lib/data/ai-usage.ts` | `getAiUsageSummary`, `getAiPriceTables` | `server/actions/usage`, `services/usage` |
| `lib/data/ai-jobs.ts` | `getAiJob`, `listActiveAiJobs`, `getLatestJobFor`, `cancelAiJob`, `retryAiJob`, `regradeFailedAnswers`, `startRemainingQuestions` | 실행기·서비스(라우트와 같은 호출) |
| `lib/data/ai-guard.ts` | `withAiGuard`가 실제 409도 `{ rejected, refusal }`로 | |
| `components/common/streaming.tsx` + 새 `lib/data/ai-stream-client.ts` | `useAiStream`, `useChatTurnStream`이 `start({ endpoint, body })`도 받음. 반환 모양 그대로 | |
| `useAiJob` | 수정 없음. `getAiJobAction`을 그대로 부르고 그 안이 실제로 바뀌었다 | |

`consent-items.ts`는 상수뿐이라 그대로다. `lib/data/actions.ts`도 수정이 필요 없었다(data 함수에 위임만 함). `mock-controls.ts`는 주석만.

`deletion.ts`는 고치지 않았다. S-25·마무리 함수는 `account.ts`에 있고, `deletion.ts`는 C-05(항목 삭제)뿐이다. 함수별 담당은 아래 "W2~W4".

새 서버 코드: `server/services/shell/index.ts`, `services/usage.loadPriceTables`, `ai-connection/consent.loadCurrentDisclosureRow`·`loadLiveConsentRows`, `ai-connection/keys.loadPublicKeyRows`, `ai-jobs.load*JobViewRow*`, `auth/session.gateConsentPage`, `auth/consent-gate.tsx`, `lib/contracts/preview.ts`.

## 연결 방식 (W2~W4는 이대로)
도구는 `src/lib/data/source.ts`에 있다.

**미리보기**: 프록시가 개발 모드에서 `?state=`가 있는 요청과 `/dev/`에 `x-resumate-preview: 1`을 붙인다. Server Action은 페이지 URL로 POST하므로 그 페이지의 Action도 미리보기다. 이런 요청은 로그인 없이 열리고, 동의 게이트를 건너뛰고, data 함수는 mock 분기만 탄다. 쓰기도 mock 저장소로만 간다. 클라이언트가 보낸 같은 헤더는 프록시가 지우고, 운영은 헤더를 만들지도 읽지도 않는다.

**실제 분기**: `server/actions/*`를 부른다(인증, 검사, 서비스가 이미 있다). camelCase → snake_case 변환만 data 함수에서 한다.

```ts
export async function getAiUsageSummary(periodMonth?: string, includePrevious = false): Promise<AiUsageSummary> {
  return previewOr(
    async () => clone(computeAiUsageSummary(await mockRequest(), periodMonth, includePrevious)), // 옛 mock 본문
    async () => toUiUsageSummary(unwrap(await usageActions.getAiUsageSummary({ periodMonth, includePrevious }))),
  )
}
```

**거부 결과 변환 (spec-gaps ⑰)**
| mock 모양 | 쓰는 것 | 동작 |
|-----------|---------|------|
| `{ rejected, refusal }` | `unwrap` 후 `withAiGuard` (Action에 이미 있음) | 2.11.7 코드의 `AppError`를 그 모양으로 바꾼다. mock과 같은 값이다 |
| `{ refused: code }` | `refusalOf(result, CODES)` | 목록의 코드만 `{ refused, details }`, 나머지는 throw. 이름이 다르면 그 자리에서 고친다 (예: `not_found` → `job_description_not_found`) |
| `{ ok: false, error }` | `toDeleteAccountResult` 참고 | 아는 코드만 그대로, 나머지는 `"failed"` |
| 그 밖의 오류 | `unwrap`이 `AppError`를 던짐 | 코드·문구·details 유지 |

**`mock_controls`와 `/dev/states`**: mock 저장소만 바꾼다. 미리보기 요청과 아직 mock인 함수에서만 효과가 보인다. 연결된 화면의 평범한 주소는 무시하므로, 갤러리에서 값을 바꾼 뒤에는 `?state=q53`처럼 아무 `?state=`나 붙여 연다. 운영에서는 `/dev/*`를 프록시가 404로 끊는다(셸·세션 읽기도 없음). `publishMockReconsentDisclosure`도 mock 저장소만 바꾼다.

## UI 소유 파일 수정 (전부)
| 파일 | 내용 | 근거 |
|------|------|------|
| `app/(dashboard)/(gated)/layout.tsx` 새 파일 | 동의 게이트 | 게이트 배치 |
| `app/(dashboard)/` 아래 `applications`, `board`, `career`, `interviews`, `settings/page.tsx`, `settings/ai`를 `(gated)/`로 이동 | 내용 변경 없음, URL 그대로. `settings/withdraw`와 `dev`는 제자리 | 게이트 배치, A7 |
| `components/**` 등의 `@/app/(dashboard)/applications/_lib/` import | 경로를 `(gated)` 포함으로 일괄 치환(이동의 결과) | 위와 같음 |
| `app/(focus)/layout.tsx` | `ConsentGate`를 Suspense로 감쌈 | 게이트 배치 |
| `app/(public)/sign-in/page.tsx` | `?error=auth_callback` → `link-expired` | `?error=` 표시 |
| `app/(public)/consent/page.tsx` | 미리보기가 아니면 `gateConsentPage(next)`. 이미 동의했으면 `next`로 | 게이트 배치 |
| `components/account/sign-in-form.tsx` | 개발용 "링크 열기"를 `isPreviewEnabled && preview`일 때만 | 미리보기 분기 |
| `components/account/actions.ts` | `destinationHref`가 `provider_url`을 우선 | **미리보기/실제 분기로 판단했지만 허용 목록에 가장 가깝게 걸친 수정이다.** Google OAuth 주소를 돌려줄 다른 경로가 없다(반환형은 추가 필드뿐). 리더가 다르게 보면 되돌리고 "UI 요청"으로 옮기면 된다. 그러면 Google만 멈춘다 |
| `components/common/streaming.tsx` | `start` 인자 확장 | 지시 범위(훅 연결) |

`src/lib/mock/`은 고치지 않았다.

## W0 QA 처리
| 항목 | 처리 |
|------|------|
| QA-W0-01 | 위 표. 운영 빌드에서도 확인 |
| QA-W0-02 | `(gated)` 그룹. 동의 없는 계정이 `/settings/withdraw`를 열 수 있음을 확인. 셸의 읽기 함수는 동의 게이트 없는 `requireUser`다 |
| QA-W0-03 나머지 | `listDrafts`의 `sectionCount`·`readySectionCount`·`badge`를 비움 |
| QA-W0-04 | 새 `isQuestionsPrepareStale`. `prepare` 체크포인트가 있는데 JD가 `succeeded`가 아니면 질문 작업의 같은 행 다시 시도를 `ai_job_not_retryable`로 거부, 상태 응답 `canRetry`도 false. 공급자가 달라 처음부터 도는 경우도 함께 막는다(S-33 버튼은 이미 꺼져 있음). 단위 시험만 |
| QA-W0-05 | `invalid_error_code`, `job_description_immutable` → `internal_error` 500 |

프록시 우회는 제거했다. 환경값이 없으면 500이고, 개발 모드는 빠진 키 이름과 `.env.local` 안내를 보여 준다. 운영 응답은 일반 문구이고 키 이름은 로그에만 남는다. 응답 메시지는 단위 시험이나 실행으로 확인하지 않았다.

Cache Components: 서버 클라이언트가 인증 세션을 읽으며 시계를 보므로 `createSupabaseServerClient`에 `await connection()`을 더했다. 빼면 `next start`에서 `Date.now()` 오류가 로그에 남는다(실제로 봤고 이 수정으로 사라짐).

## 중간 상태 (W2~W4 전까지)
- 로그인·동의·셸 메일 주소·AI 연결·사용량은 실제, 커리어·기업 JD·면접·보드 화면은 mock 저장소다.
- 그래서 어긋남이 보인다. readiness와 배지는 실제 행(0개)을 보는데 화면 목록은 fixture라 C-09 게이트가 뜰 수 있다. mock AI 실행은 mock 저장소의 연결 상태를 보므로 실제 키 유무와 다를 수 있다.
- `ai-jobs.ts`는 id로 저장소를 고른다(`isMockRow`). mock 저장소에 있으면 mock, 없으면 실제다. 그래서 W3·W4가 이 파일을 고치지 않아도 실제 id부터 실제로 간다. `listActiveAiJobs`는 둘을 합쳐 돌려준다.
- **W5에서 할 일**: `isMockRow`, `listActiveAiJobs`의 합치기, `startAiJob` 제거.
- **운영 배포 금지 상태**: 운영 빌드에서도 mock 함수는 fixture를 돌려주고 인증을 보지 않는다. W2~W4 전에는 배포하면 안 된다.
- 잡 폴링이 Server Action을 거치므로 라우트의 `maxDuration = 60`이 적용되지 않는다. `after()`로 이어 도는 단계의 Vercel 시간 제한은 W5에서 확인해야 한다.

## W2~W4가 건드리면 안 되는 것
`src/types/db.ts`, `lib/data/source.ts`, `ai-*.ts`, `actions.ts`, `account.ts`, `shell.ts`, `readiness.ts`, `lib/contracts/preview.ts`, `server/auth/*`, `proxy.ts`, 레이아웃과 라우트 그룹 구조.

페이지 경로가 바뀌었다: 이제 `src/app/(dashboard)/(gated)/...`. import는 `@/app/(dashboard)/(gated)/applications/_lib/...`.

`deletion.ts`는 함수별로 나눈다: W2 `getDeletionImpact`·`deleteCareerItem`, W3 `getApplicationDeletionImpact`·`deleteApplicationProject`·`getDraftDeletionImpact`·`deleteDraft`, W4 `getInterviewSessionDeletionImpact`·`deleteInterviewSession`. 파일 위쪽의 공용 헬퍼는 건드리지 않는다.

스트림: W2·W3는 `stream.start({ endpoint, body, discardOnError })`를 쓰되 미리보기에서는 mock 요청을 그대로 넘긴다(`usePreviewState()`로 분기). `validated.result`에서 블록을 찾는 코드는 `block_id`·`text`를 가진 객체를 재귀로 모으는 방식이라, 실제 AI-03·AI-04 출력으로는 돌려 보지 못했다. W3에서 확인해야 한다. `draft_flags`의 `actor_ambiguous`는 계약에 대응 값이 없어 `[]`다(W2 확인). W4: ㉖.

## UI 요청
1. S-03 항목 결정(⑲의 (b)를 고르는 경우).
2. C-21에 고지 버전 전달(㉒).
3. 로그아웃·탈퇴 직후 재렌더: `getAccountDeletionSummary`가 세션 없이 호출되어 S-25에서 서버 로그에 오류 1건이 남는다. 화면이 곧 떠나므로 잠깐 오류 표시가 보일 수 있는데 브라우저로 보지 못했다.
4. `sign-in-form`의 재발송 대기 60초는 `[UI-가정]`이다. 로컬 Auth 제한과 맞는지 볼 수 있으면 좋다.

## 시험
| 명령 | 결과 |
|------|------|
| `pnpm lint` | 오류 0 |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 95파일 1,554건 통과 |
| `pnpm build` | 성공 |
| `pnpm db:test` | 50파일 2,351건 PASS |

새 시험: `lib/data/source.test.ts`, `ai-guard.test.ts`, `ai-stream-client.test.ts`. 더함: `proxy-session.test.ts`, `errors.test.ts`, `support.test.ts`, `drafts/read.test.ts`. `account.ts`·`ai-connection.ts`·`ai-jobs.ts`의 변환 함수 자체에는 단위 시험을 쓰지 않았고 아래 흐름으로만 확인했다. `getAiJob`·`retryAiJob`·`cancelAiJob`의 실제 분기는 흐름에도 없다.

### 끝까지 확인 (로컬 스택, `next start`, HTTP로 Server Action 직접 호출)
생성한 시험 계정을 썼고 마지막에 탈퇴시켜 지웠다. 37개 확인 통과, 차단 1건(⑲).
- 익명 `/career` → `/sign-in?next=`, 위조한 미리보기 헤더도 같음. 운영에서 `?state=` 무시, `/dev/states` 404.
- 메일 수신함의 링크로 가입 → `/consent?next=`. `next` 유지. 같은 링크 재사용 → `/sign-in?error=auth_callback` → 만료 문구.
- 동의 전: `/career`와 `/settings/ai/connect` → `/consent`. `/settings/withdraw`는 열림(A7), 셸 읽기 정상.
- S-03 폼 저장 **거부**(⑲). 시험 계정만 RPC로 3종 동의.
- 동의 후: `/consent` 통과, `/career`에 실제 메일 주소, S-40·S-42·가격표·readiness, S-24 선택 동의 끄기·켜기, C-21 동의 행, 형식 틀린 키 거부(공급자 호출 없음).
- 키: 실제 서비스 `registerProviderKey` + 가짜 검증기로 픽스처 키 저장 → 활성 공급자 지정, 응답에 끝 4자리만, 원문 없음.
- 로그아웃 → 익명 이동. 다시 로그인 → `/career`. 탈퇴 → 익명 이동.
- 개발 서버: 익명 `/career?state=empty`가 200이고 fixture 메일 주소 표시, `/settings/ai?state=ai-locked` 200, `?state=` 없는 주소는 이동.

## 실행하지 않은 것
- **브라우저 확인 전부.** Chrome 확장이 연결되지 않아 HTTP로 대신했다. 클릭, 스트리밍된 동의 게이트의 클라이언트 이동(응답 안 redirect 표식까지만 봄), 로그아웃 후 S-01 도착, S-41 화면 흐름, 미리보기 전환은 눈으로 보지 못했다.
- **개발 모드 미리보기의 Server Action 호출**(개발 번들에서 Action id를 얻지 못함). `previewOr` 단위 시험과 프록시 시험, 개발 서버의 GET까지만이다. "미리보기 쓰기가 실제 행에 안 간다"를 실제 행으로 대조하지 않았다.
- Google 로그인(로컬 공급자 꺼짐). 코드 경로와 시그니처만.
- `deletion_incomplete` 실제 상태, `/settings/withdraw/finalize` 흐름, 실제 SSE 연결, 키 "다시 확인"·등급 변경(공급자 호출 필요), 환경값 누락 응답.
- 실제 공급자 호출, 원격, 배포.

포트 3000의 개발 서버는 이 작업 트리에서 이미 떠 있던 것이라 끄지 않았다. 내 확인은 3100에서 돌리고 종료했다. 시험 계정 정보는 저장소에 남기지 않았다(임시 파일 삭제). `.env.local`은 gitignore 대상임을 확인했다.
