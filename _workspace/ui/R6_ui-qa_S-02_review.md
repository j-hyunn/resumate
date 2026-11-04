# UI QA — S-02 가입/로그인 Google 단일화 (R6, 라운드 1)

기준: 플로우 `02-user-flows.md` S-02 (v5.7 개정, 1131행~), decisions 3.11, design-system 6 A1 S-02 (v5.1).
대상 코드: `src/components/account/sign-in-form.tsx`, `src/app/(public)/sign-in/page.tsx`, `src/components/account/actions.ts` (+ 경로 확인용 `src/lib/routes.ts`, `src/components/common/sign-in-link.tsx`, `src/server/services/auth/index.ts`).
엔지니어 보고: `_workspace/ui/R6_frontend-engineer-A1_report.md`.
브라우저 확인은 하지 않았다. `?state=` 렌더링은 코드 경로를 읽어 확인했다.

## 요약 — Critical 0 / Major 1 / Minor 7

- 명세의 구성(제목·부제·주 버튼·약관 안내), 문구, 상태 6종, `?state=` 5종(`loading`·`error`·`login-error`·`new-user`·`deletion-incomplete`), ST-UNAUTH → S-02 `?next=` 전달은 모두 맞다. UI 소유 파일에 매직 링크 흔적은 없다.
- Major 1건(api-engineer): 콜백 실패로 S-02에 돌아오면 `?next=`가 사라진다. 다시 로그인해도 원래 화면으로 돌아가지 못한다.
- Minor 7건: design-system v5.1(오늘 갱신)과 어긋나는 시각·접근성 세부다. 경고 위치와 지우기, `size="lg"`, 로고·스피너 크기, 타이포·간격, 약관 줄 가운데 정렬과 링크 variant, 실패 뒤 포커스, 뒤로 가기 bfcache.
- 기계 검사: `pnpm typecheck` 통과, `pnpm lint` 통과(경고 0). `pnpm build`는 돌리지 않았다(엔지니어 보고에서는 더미 env로 통과).

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 |
|---|---|---|---|---|---|---|---|---|---|
| S-02 | ✅ | ✅ | — | ⚠️ UQ-732 | ⚠️ UQ-726 | — | ⚠️ UQ-725·727·728·729 | ⚠️ UQ-730·731 | ✅ |

- Q1: 명세 4행(제목·안내 / 주 버튼 / 약관 안내 / 원래 URL)이 모두 있다. 주 버튼은 전체 폭에 Google 로고가 있고, 누르면 진행 중 표시를 하고 중복 클릭을 막는다(`disabled` + `aria-busy`, `sign-in-form.tsx:52-62`).
- Q2: 시작 실패 "Google 로그인을 시작하지 못했어요. 다시 시도해 주세요"(`sign-in-form.tsx:67`)와 콜백 실패 "로그인을 마치지 못했어요" / "다시 시도해 주세요"(`:47-48`)가 명세 문구와 같다. 약관 문구와 링크 "처리방침·약관 보기"도 같다(`page.tsx:65-67`). 부제 "처음이면 바로 가입돼요. Google 계정으로 들어와요."는 명세가 뜻만 정했으므로 `[UI-가정]`으로 표시했고, 뜻이 맞는다. 링크 만료 문구는 없다.
- Q5: ST-UNAUTH "로그인"은 `SignInLink`가 현재 경로를 `routes.signIn(safeNextPath(current))`로 넘기고 `state`는 빼고 넘긴다(`sign-in-link.tsx:14-20`). S-02는 `safeNextPath(sp.next)`(`page.tsx:53`)를 액션에 넘긴다. 미리보기 경로는 `routes.consent(next)`와 `next ?? routes.career()`로 이어지고, 탈퇴 미완료는 `next`보다 먼저 `routes.withdrawFinalize()`로 간다(`actions.ts:33-38`). 실제 경로는 `account.ts`의 `nextFromSignInUrl()`이 요청 경로에서 `next`를 읽어 OAuth 시작에 넘기고, 콜백이 동의·`next`·S-08로 보낸다. 다만 콜백 실패 경로에서 `next`가 빠진다(UQ-732).
- Q6: `loading`은 `FormSkeleton fields={1}`이고, `error`는 `fail` 플래그로 액션이 실패해 시작 실패 줄을 보인다. `login-error`와 운영의 `?error=auth_callback`(`isLoginError`)은 상단 Alert를 보인다. `new-user`는 S-03으로, `deletion-incomplete`는 `withdrawFinalize("deletion-incomplete")`로 간다. 기존 사용자 기본값은 S-08 또는 `next`다. 삭제된 `sent`·`link-expired`는 남아 있지 않다.
- Q8: Google 로고 다색 hex(`sign-in-form.tsx:77-91`)는 design-system이 허용한 브랜드 예외다. 그 밖의 raw 색은 없다.
- Q10: `Card max-w-md` + `px-4`로 좁은 화면을 감당한다. 버튼은 전체 폭이다.

### 매직 링크 잔여물
`src/app`·`src/components`·`src/lib`(테스트 제외)에서 magic·매직·로그인 링크·링크 받기·재발송·다른 이메일·링크 만료·`signInWithOtp`·`link-sent`·`"sent"`·`link-expired`를 찾았다. 걸린 것은 무관한 단어뿐이다(`resends`·`slotPath`·`isNotPreviewCondition`). `actions.ts`에서 `sendMagicLinkAction`·`openMagicLinkAction`이 빠졌다. `src/lib/data/account.ts`는 api-engineer가 수정하는 중이라 범위 밖이다.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|---|---|---|---|---|---|---|---|
| UQ-732 | Major | api-engineer | S-02 | 02 S-02 표 "원래 URL": "`?next=`를 Google 왕복 뒤에도 유지한다", 상태 "콜백 실패" | `src/server/services/auth/index.ts:84-89`(`LOGIN_CALLBACK_ERROR` = `/sign-in?error=auth_callback`, `next` 없음) | 콜백 실패로 S-02에 돌아올 때도 `?next=`를 붙인다(`/sign-in?error=auth_callback&next=…`). 그래야 다시 누르면 원래 화면으로 돌아간다 | `next`를 파싱하고도 실패 경로에서 버린다. Google 화면에서 취소한 뒤 다시 로그인하면 S-08로 간다. UI 쪽 `page.tsx:53`은 `next`가 있으면 그대로 받으므로, 서버만 고치면 된다 |
| UQ-725 | Minor | frontend-engineer(A1) | S-02 | design-system 6 A1 S-02 첫 항목: 콜백 실패 Alert는 "카드 안 첫 요소(`mb-6`)" | `src/components/account/sign-in-form.tsx:43-50`, `src/app/(public)/sign-in/page.tsx:58-63` | Alert가 제목 "가입/로그인" 위, 카드 맨 위에 온다 | Alert가 `SignInForm` 안에 있어 제목·부제 아래, 버튼 바로 위에 그려진다 |
| UQ-726 | Minor | frontend-engineer(A1) | S-02 | design-system 6 A1 S-02: "사용자가 다시 버튼을 누르면 지운다 `[가정]`" | `src/components/account/sign-in-form.tsx:28-30, 43` | 버튼을 누르면 콜백 실패 Alert를 숨긴다 | Alert는 `preview` prop만 보고 그린다. 다시 눌러도 남고, 그 시도가 시작에 실패하면 상단 Alert와 버튼 아래 오류 줄이 함께 보인다 |
| UQ-727 | Minor | frontend-engineer(A1) | S-02 | design-system 6 A1 S-02 주 버튼: `Button variant="outline" size="lg" className="w-full"`, 로고 `size-5`, 로딩 시 `Loader2 size-5 animate-spin` | `src/components/account/sign-in-form.tsx:52-60, 74` | `size="lg"`(h-11), 로고와 스피너가 모두 `size-5` | `size`가 없어 default(h-10, 좁은 화면 h-11)다. 로고는 `size-[18px]`(임의값)이고 `Loader2`는 버튼 기본값 `size-4`라서, 누르는 순간 아이콘이 18→16px로 줄어 글자가 흔들린다 |
| UQ-728 | Minor | frontend-engineer(A1) | S-02 | design-system 6 A1 S-02: 부제 `body text-muted-foreground mt-2`, 제목 묶음과 버튼 사이 `mt-8`, 시작 실패 줄은 버튼 아래 `mt-2` | `src/app/(public)/sign-in/page.tsx:57-61`, `src/components/account/sign-in-form.tsx:42` | 부제 `text-base leading-[1.6]`(body), 제목↔부제 8px, 묶음↔버튼 32px, 버튼↔오류 8px | 부제가 `text-sm leading-5`(meta)이고 `space-y-1`(4px)다. Card `gap-6`이라 묶음↔버튼이 24px이고, 폼 `space-y-4`라서 버튼↔오류가 16px다 |
| UQ-729 | Minor | frontend-engineer(A1) | S-02 | design-system 6 A1 S-02 약관 안내: `mt-6 meta text-muted-foreground text-center`, 링크는 `Button variant="link" asChild` + `h-auto p-0 text-sm`(색·밑줄은 link variant 기본값) | `src/app/(public)/sign-in/page.tsx:64-68` | 가운데 정렬, link variant(초록 `primary-text` 링크) | 왼쪽 정렬이다. 링크는 `Link`에 `font-medium text-foreground underline` 직접 지정이라 다른 화면의 link 색·hover 규칙과 다르다 |
| UQ-730 | Minor | frontend-engineer(A1) | S-02 | design-system 7(포커스), UX-8 키보드 경로 / S-02 시작 실패 "버튼 다시 활성" | `src/components/account/sign-in-form.tsx:32-35, 57` | 키보드로 눌러 시작에 실패하면 다시 활성된 버튼으로 포커스가 돌아와서, Enter로 바로 다시 시도할 수 있다 | `disabled`가 되는 순간 포커스가 `body`로 빠지고, 실패 뒤에도 돌아오지 않는다. 오류 줄 `role="alert"`의 읽기는 정상이다 |
| UQ-731 | Minor | frontend-engineer(A1) | S-02 | 02 S-02 주 버튼 "누른 뒤에는 진행 중 표시 + 중복 클릭 막음" / 시작 실패 "버튼 다시 활성" | `src/components/account/sign-in-form.tsx:25, 37-38` | Google 동의 화면에서 브라우저 "뒤로"로 돌아오면 버튼을 다시 누를 수 있다 | `busy`를 풀지 않은 채 외부로 이동한다. 브라우저가 bfcache로 페이지를 복원하면 스피너와 비활성 상태가 그대로 남을 수 있다(브라우저 미확인). 예: `pageshow`에서 `event.persisted`이면 `busy`를 해제 — 확인 후 판단 |

## 기획 확인 필요
- 없음. 명세, decisions 3.11, design-system v5.1 사이에 모순은 없다. 콜백 실패 시 `next` 유지(UQ-732)는 명세의 "원래 URL" 행을 그대로 읽은 결과라서 구현 이슈로 분류했다.

## 참고 (이슈 아님)
- `signInWithGoogleAction(next, …)`(`actions.ts:41-49`)은 실제 경로에서 인자 `next`를 서비스에 넘기지 않는다. 대신 `account.ts`의 `nextFromSignInUrl()`이 요청 경로 헤더에서 다시 읽는다. 결과는 같지만 출처가 둘이다. api-engineer가 `account.ts`를 정리할 때 인자로 받은 `next`를 쓰도록 맞추면 단순해진다.
- 외부 URL로 `router.push(res.href)`를 하면 App Router가 하드 내비게이션으로 처리한다. 동작에는 문제가 없지만 브라우저로는 확인하지 않았다.

## 재확인 결과
- 이전 S-02 이슈 중 미해결은 없다(UQ-586은 v5.3 통합 리뷰에서 처리됨). 새 ID는 UQ-725부터 시작한다.

## 기계 검사 출력
- `pnpm typecheck`(`next typegen && tsc --noEmit`): 통과. api-engineer가 `src/lib/data/account.ts`를 수정하는 중에 실행했지만 오류는 없었다.
- `pnpm lint`(`eslint`): 통과, 출력 없음.
- `pnpm build`: 실행하지 않음(더미 env 필요). 엔지니어 보고에서는 통과.

---

## 라운드 2 — 재확인 (2026-11-04)

대상: `src/components/account/sign-in-form.tsx`, `src/app/(public)/sign-in/page.tsx`(A1 "QA 라운드 1 수정"), `src/server/services/auth/index.ts` + `auth.test.ts`(api-engineer UQ-732 노트), `src/lib/data/account.ts`(매직 링크 잔여물 제거, `completeSignIn` 인라인).
브라우저 확인은 이번에도 하지 않았다. 코드 경로를 읽어 확인했다.

### 요약 — Critical 0 / Major 0 / Minor 1(새 이슈, 문서)
- 라운드 1 이슈 8건(UQ-725~732)이 모두 해결됐다. 회귀는 없다.
- 새 이슈 1건(UQ-733 Minor, ui-designer): design-system의 인라인 링크 클래스 문자열만으로는 좁은 화면에서 인라인이 되지 않는다. 코드는 맞게 고쳤으므로(A1 `[UI-가정]` `max-md:h-auto`) 문서에 반영하면 된다.
- 기계 검사 4종 모두 통과. S-02는 `QA 통과`로 올린다.

### 이슈 재확인

| ID | 결과 | 근거 (코드) |
|---|---|---|
| UQ-732 (Major) | 해결 | `index.ts:70-77` `loginCallbackErrorUrl(next)`. `:96-97`에서 `safeNextPath` 검사 뒤 만들고, 실패 경로 4곳(`:98` 공급자 오류·`:100` code 없음·`:102` 교환 실패·`:115` profile_missing)이 모두 쓴다. 기본 목적지 `/career`는 붙이지 않는다. 탈퇴 미완료(`:112`)는 여전히 `next`보다 먼저 간다. 테스트 `auth.test.ts:154-171`(쿼리 포함 경로 인코딩, 위험 값·인증 페이지·기본값 제외) 통과 |
| UQ-725 | 해결 | `sign-in-form.tsx:80-89` Alert가 `intro`(제목 묶음)보다 먼저, `mb-6`. `page.tsx:58` `Card gap-0 p-8`(design-system A1 "Card max-w-md mx-auto mt-16 p-8"과 같다) |
| UQ-726 | 해결 | `:42` `callbackFailed` 초기값 = `preview === "login-error"`(운영 `?error=auth_callback` 포함, `page.tsx:48-53`). `:66` 버튼을 누르면 지운다. 시작 실패와 상단 Alert가 함께 보이는 경우가 없어졌다 |
| UQ-727 | 해결 | `:95` `size="lg"`, `:101` `Loader2 size-5`, `:120` 로고 `size-5`. 누를 때 아이콘 크기가 같다 |
| UQ-728 | 해결 | `page.tsx:66` 부제 `mt-2 text-base leading-[1.6]`, `sign-in-form.tsx:96` 버튼 `mt-8`, `:106` 오류 줄 `mt-2`. Card `gap-0`이라 다른 간격이 끼지 않는다 |
| UQ-729 | 해결 | `page.tsx:72` `mt-6 text-center text-sm leading-5 text-muted-foreground`, `:75` `Button variant="link" asChild` + `h-auto p-0 text-sm`(link variant = `text-primary-text underline-offset-4 hover:underline`) |
| UQ-730 | 해결 | `:55-61` `refocus` 플래그 + `[busy]` effect. 시작 실패 때만 `refocus=true`(`:69`), 버튼이 다시 활성으로 그려진 뒤 포커스를 돌려준다. 오류 줄 `role="alert"`는 그대로 |
| UQ-731 | 해결 | `:47-53` `pageshow`에서 `e.persisted`이면 `setBusy(false)`. effect cleanup에서 `removeEventListener`로 같은 함수 참조를 지운다. 의존성 `[]`라 한 번만 붙는다 |

### 회귀 점검
- 포커스: `refocus`는 실패 분기에서만 켜지고 effect에서 바로 끈다. 성공(외부 이동)이나 bfcache 복원으로 `busy`가 풀릴 때는 포커스를 옮기지 않는다. 문제 없음.
- `pageshow` 리스너: 마운트당 하나, 언마운트 때 지운다. 문제 없음.
- 약관 링크 `max-md:h-auto`(A1 `[UI-가정]`): Button default 크기의 `max-md:h-11`을 tailwind-merge가 뒤의 `max-md:h-auto`로 바꾼다. design-system 7 A-4가 "본문 안 인라인 링크 제외"라고 정하므로 규칙과 맞는다. 다른 화면의 `variant="link" size="sm" className="h-auto px-0"` 링크들은 단독 링크라서 44px가 맞고, 이번 변경과 무관하다. 문서 보완은 UQ-733.
- `next` 끝까지 따라가기:
  1. ST-UNAUTH "로그인": `sign-in-link.tsx:15-20`이 `state`를 빼고 현재 경로를 `routes.signIn(safeNextPath(current))`로 만든다. `withQuery`가 `URLSearchParams`로 인코딩한다(`/sign-in?next=%2Fapplications%2F42%3Ftab%3Dinsight`).
  2. S-02: `page.tsx:54` `safeNextPath(sp.next)`(디코딩된 값)를 폼에 넘긴다. 실제 요청은 `account.ts:96-100` `nextFromSignInUrl()`이 proxy가 넣은 `x-resumate-path`(`pathname+search`)에서 `next`를 읽어 `contracts` `safeNextPath`로 검사한다.
  3. Google 시작: `index.ts:14-18` `buildCallbackUrl`이 `searchParams.set("next", …)`로 다시 인코딩해 `redirectTo`에 넣는다.
  4. 콜백 실패: `callback/route.ts:17` `searchParams.get("next")`(디코딩) → `index.ts:96` 검사 → `:76` `encodeURIComponent`로 `/sign-in?error=auth_callback&next=…`.
  5. 다시 시도: S-02가 Alert와 `next`를 함께 읽고(`page.tsx:48-54`), 2→3을 그대로 다시 탄다. 이중 인코딩이나 `next` 손실은 없다. 테스트 `auth.test.ts:157-158`이 쿼리 포함 경로의 인코딩을 고정한다.
  - 참고(라운드 1과 같음, 이슈 아님): 실제 경로는 액션 인자 `next` 대신 요청 헤더에서 `next`를 다시 읽는다. 결과는 같다. 또 서버 `safeNextPath`는 `/consent`를 버리지 않아 `next=/consent…`가 왕복할 수 있지만, S-02의 UI `safeNextPath`가 화면에서 버리고 콜백 성공 시에는 동의 게이트가 다시 판단한다. 이번 변경 전부터 있던 동작이다.
- `src/lib/data/account.ts` 미리보기: `signInWithGoogle` preview 본문(`:110-117`)이 `?state=` 목록과 맞는다.
  - `error` → `fail` → `maybeFail`이 `AccountRequestError` → 액션 `{ ok:false }` → 버튼 아래 오류 줄.
  - `new-user` → `forceNewUser` → `consent` → `routes.consent(next)`(S-03).
  - `deletion-incomplete` → 액션의 `previewDeletionIncomplete`가 먼저 `routes.withdrawFinalize("deletion-incomplete")`(S-25).
  - `login-error` → 플래그 없음 → fixture 동의 상태로 `career`(→ `next` 또는 S-08) / 동의 없으면 S-03. 상단 Alert는 페이지가 그린다.
  - `loading` → `page.tsx:47` `FormSkeleton fields={1}`.
  - 지연이 500+400ms에서 500ms 한 번으로 줄었다. 화면에서 보이는 차이는 스피너 시간뿐이다. `sendMagicLink`·`completeSignIn`은 `src` 전체에서 남은 import가 없다(typecheck 통과로 확인).

### 새 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|---|---|---|---|---|---|---|---|
| UQ-733 | Minor | ui-designer | S-02 | design-system 6 A1 S-02 약관 안내: 인라인 링크 `Button variant="link" asChild` + `h-auto p-0 text-sm` / 7 A-4 "본문 안 인라인 링크 제외" | `src/components/ui/button.tsx:44`(size default `max-md:h-11`), `src/app/(public)/sign-in/page.tsx:75` | 문서의 클래스 문자열대로 쓰면 좁은 화면에서도 문장 안에 그대로 있다 | 문서 문자열만 쓰면 `max-md:h-11`이 남아 768px 미만에서 링크가 44px 높이가 되어 줄 간격이 벌어진다. A1이 `max-md:h-auto`를 더해 해결했다(`[UI-가정]`). design-system의 인라인 링크 문자열에 `max-md:h-auto`를 넣어 다음 화면이 같은 실수를 하지 않게 한다. 코드 수정은 필요 없다 |

### 기획 확인 필요
- 없음.

### 기계 검사 출력
- `pnpm typecheck`(`next typegen && tsc --noEmit`): 통과.
- `pnpm lint`(`eslint`): 통과, 출력 없음.
- `pnpm exec vitest run src/server/services/auth src/lib`: 22 파일, 252 테스트 통과.
- `pnpm build`: 더미 env(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, 가짜 anon key·JWT secret·CRON secret, `03_backend-qa_report.md`와 같은 방식)로 exit 0, `✓ Compiled successfully`. `/sign-in`은 부분 prerender(◐) 라우트로 나왔다.

### 결론
S-02는 Critical·Major 미해결이 없어 `QA 통과`(브라우저 미확인). 남은 것은 문서 보완 UQ-733(Minor, ui-designer)뿐이다.
