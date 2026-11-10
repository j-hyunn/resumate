# 57 — 운영 장애: S-13 `/applications` React #130 (2026-11-10)

## 증상
PR #70(45 런)이 #69·#68과 함께 머지·배포된 뒤, 운영 `https://www.resumate.me/applications`가 통째로 깨졌다.
콘솔: `Minified React error #130; args[]=undefined&args[]=` — "Element type is invalid … got: undefined".

## 원인
`src/components/applications/add-application-launcher.tsx`(`"use client"`)가 컴포넌트에 **정적 속성**을 달았다:
`AddApplicationLauncher.Button = LauncherButton`. 서버 컴포넌트인 S-13 페이지가 `<AddApplicationLauncher.Button />`을
머리와 빈 상태에서 렌더했다. 서버 컴포넌트가 `"use client"` 모듈에서 받는 것은 **클라이언트 참조(프록시)**라
정적 속성이 실리지 않는다 → `undefined` → React #130.

## 재현 (리더 확인)
`pnpm dev`에서 `/applications?state=empty`(미리보기 — 로그인 게이트 없이 열림):
- 버그 코드: 서버 렌더 HTML에 `Element type is invalid: expected a string … but got: undefined` (React #130의 minify 전 문장)
- 수정 코드: HTTP 200, 오류 0건, "자기소개서 작성" 버튼 2곳 렌더

## 수정
- `LauncherButton` → 이름 붙은 export `AddApplicationLauncherButton`, 정적 속성 대입 삭제. 페이지 2곳 교체.
- 버튼은 모달과 상태를 공유하지 않고 URL(`?new=1`)만 바꾸므로 동작 변화 없음.

## 왜 모든 자동 검사를 통과했나
| 검사 | 왜 못 잡았나 |
|---|---|
| typecheck | TypeScript는 함수에 붙인 정적 속성을 정상 타입으로 본다. RSC 경계(클라이언트 참조)는 타입 체계에 없다 |
| build | 번들러는 그대로 통과시킨다. 오류는 RSC 페이로드를 그릴 때(런타임)만 난다 |
| test | 단위 테스트는 컴포넌트를 직접 import한다 — RSC 경계를 지나지 않는다 |
| UI QA 2라운드 | 코드·mock·`?state=` **소스 대조** 기준이었고, **브라우저도 dev 서버 렌더도 S-13에 대해 돌리지 않았다** |
| 브라우저 | Claude in Chrome 미연결 — 45 런 전체가 "브라우저 미확인" |

**교훈**: "QA 통과 (mock·브라우저 미확인)"에서 빠진 것은 "브라우저"만이 아니라 **실제 렌더 자체**였다. `?state=` 미리보기는 로그인 없이
dev 서버에서 열리므로, 브라우저가 없어도 **`curl`로 대상 화면의 미리보기 주소를 한 번씩 렌더해 "Element type is invalid"·500을 찾는 것**만으로
이 장애를 머지 전에 잡을 수 있었다.

## 재발 방지
1. **소스 가드 테스트** `src/components/no-client-static-members.test.ts` — `"use client"` 파일에서 컴포넌트 정적 속성(`Foo.Bar = …`,
   `Object.assign(Foo, …)`)을 금지하고, S-13이 이름 붙은 export를 쓰는지 확인. 버그 코드로 되돌리면 2건 모두 실패함을 확인했다.
2. **전수 점검(리더)**: `"use client"` 파일의 정적 속성 대입 0건(이번 한 곳뿐이었다), 서버 컴포넌트의 `<X.Y>` 렌더는 `React.Suspense`뿐,
   `Object.assign(컴포넌트, …)` 0건. 컴포넌트·아이콘 맵(`GUIDE_ICON`·`MENU_ICONS`)은 키 유니언 전체를 덮는 `Record`라 `undefined` 반환 없음.
   폐기 export를 배럴로 끌어오는 자리: 없음(TypeScript가 이름 있는 import의 누락 export를 잡는다).
3. **렌더 스모크(리더, 이번 수정에서 실행)**: dev 서버의 미리보기 주소를 렌더해 오류 문장·500을 찾는다.
   S-13 3개 · S-14 1개 · S-46 15개 · S-39 3개 · `/dev/states` — **모두 200, 오류 0건**.
   → 하네스 후속 제안: UI QA 체크리스트에 "변경 화면의 `?state=` 미리보기를 dev 서버로 한 번씩 렌더(브라우저가 없어도)"를 넣는다(`.claude/skills/ui-qa-review`, 리더 판단 필요).

## 아직 확인하지 못한 것
- **운영(로그인한 실제 화면)에서의 확인** — 이 수정이 배포된 뒤 사용자가 `/applications`를 한 번 열어 봐야 한다.
- **브라우저(클라이언트 하이드레이션) 확인** — Chrome 확장 미연결. dev 서버 렌더에서는 같은 유형이 서버 쪽에서 드러나는 것을 확인했다.

---

## 전수 점검 (2026-11-10, 머지 전 — 사용자 "전수 점검 요청" 승인)

**범위**: `git ls-files src`의 테스트가 아닌 `.ts`/`.tsx` **528개**(그중 `"use client"` **130개**) — 자기소개서 관리뿐 아니라 커리어·계정·보드·공통·`ui/`·`lib/`·`server/` 전부.
**방법**: 경로에 괄호·대괄호가 있어 셸 단어 분리가 깨지므로 **Python으로 파일을 직접 읽어** 정규식·import 해석으로 판정했다(첫 셸 점검은 이 문제로 일부가 무효였다 — 다시 했다).

| # | 유형 | 방법 | 결과 |
|---|---|---|---|
| 1a | `"use client"` 파일의 컴포넌트 정적 속성 대입(`Foo.Bar = …`, 들여쓰기 무관) | 130개 파일 줄 단위 | **0건**(수정 뒤) — 이번 `AddApplicationLauncher.Button`이 유일했다 |
| 1b | `Object.assign(Component, …)`·`export const Foo = { … }` 네임스페이스 객체 | 130개 파일 | **0건** |
| 1c | 서버·공용(지시문 없는) `.tsx`의 `<X.Y>` 렌더 | 398개 파일 | `React.Suspense`(state-views.tsx:126)뿐 — 정상 |
| 1d | 서버·공용 파일이 `"use client"` import를 `<X.Y>`로 렌더 | import 해석(`@/`·상대 경로 → 대상 파일의 지시문) | **0건** |
| 1e | 서버·공용 파일이 `"use client"` 모듈에서 **컴포넌트가 아닌 값**을 가져옴 (같은 경계의 이웃 유형) | 같은 import 해석, `import type` 제외 | **1건 — `components/account/ai-format.ts`의 `aiErrorTitle`**. 부르는 곳이 클라이언트 컴포넌트 3개(ai-usage-panel·key-connect-flow·provider-row)뿐이라 **지금은 안전**, 서버에서 부르면 깨지는 잠재 위험 → 가드의 알려진 예외로 관리 |
| 2 | 맵 조회 결과를 요소 타입으로 렌더(`const Icon = MAP[k]` → `<Icon/>`) | `.tsx` 전체, 대문자 지역 변수 + 인덱스/`?.`/`.get` 조회 + `<Name` 렌더 | **3곳 — 모두 안전**: `career-overview.tsx:349 KIND_ICONS[item.kind]`, `input-guide.tsx:44 GUIDE_ICON[guide]`, `app-sidebar.tsx:128 MENU_ICONS[item.key]`. 맵은 키 유니언 전체를 덮는 `Record`이고 키는 코드가 리터럴로 정한다(서버 문자열이 아님). `document_kind`·전형 단계·서류 배지 맵은 **라벨 문자열·`variant` 맵**이라 값이 없어도 #130이 되지 않는다 |
| 3 | 폐기 export를 참조하는 import | 배럴 `export *` 검색, `@ts-ignore/expect-error/nocheck`, 동적 import, 폐기 모듈·export 이름 검색 | **끊어진 참조 0건**. 배럴 16개 중 `export *` 0개, 억제 주석 0건, 동적 import는 타입 import·`node:dns`뿐. 이름이 걸린 곳은 폐기 사실을 적은 주석(`labels.ts`), 새 C-11 파일(`cover-letter/sources-used.tsx` — 존재), 남은 **타입** `GenerationNotesPayload`, 리다이렉트 출발 주소뿐. `strict`라 이름 붙은 import가 없는 export를 가리키면 typecheck가 잡는다 |

**렌더 스모크(dev 서버, `?state=` 미리보기는 로그인 없이 열림)**:
- 자기소개서 관리: S-13 3 · S-14 1 · S-46 15 · S-39 3 · `/dev/states` — 모두 200, 오류 0건
- 다른 영역: 커리어(S-08·S-12·S-10 기존·새 페이지·S-44 새 페이지)·계정(S-24 AI 연결·S-25)·보드·공개(S-01·S-02·S-03·S-30)·`/dev/page-shell`·`/dev/states` **15개 라우트 × 상태 4개(없음·empty·loading·error) = 60개 주소 — 모두 200, "Element type is invalid" 0건**
  (미리보기가 아닌 게이트 주소는 로그인 화면으로 리다이렉트된 결과다)

## 재발 방지 — 무엇으로 막나

- **ESLint 규칙은 마땅치 않다**: RSC 경계는 파일 지시문(`"use client"`)과 **import 그래프**에 달려 있어 한 파일만 보는 린트로는 판정할 수 없고, 표준 규칙(`react`·`next`·`@typescript-eslint`)에 이것을 잡는 것이 없다. 커스텀 규칙은 import 해석이 필요해 비용이 크다.
- **대신 소스 가드 테스트**(`src/components/no-client-static-members.test.ts`, `pnpm test`에 포함, 5건):
  1. `"use client"` 파일의 컴포넌트 정적 속성·`Object.assign` 금지
  2. 서버·공용 파일이 클라이언트 import를 `<X.Y>`로 렌더 금지
  3. 서버·공용 파일이 클라이언트 모듈에서 컴포넌트가 아닌 값을 가져오기 금지(알려진 예외 `ai-format.ts`만)
  4. 알려진 예외 파일이 지금도 클라이언트 컴포넌트에서만 불리는지
  5. S-13이 이름 붙은 export를 쓰는지
  → 버그 코드로 되돌리면 1·5가, 예외를 빼면 3이 실패함을 확인했다.
- **관례**: 클라이언트 컴포넌트의 하위 조각은 **이름 붙은 export**로 둔다(`Foo.Bar` 금지). 서버에서 쓸 순수 함수·상수는 지시문 없는 모듈에 둔다.
- **QA 절차(하네스 후속 제안)**: UI QA에 "변경 화면의 `?state=` 미리보기를 dev 서버로 한 번씩 렌더해 `Element type is invalid`·500을 찾는다(브라우저가 없어도)"를 넣는다 — `.claude/skills/ui-qa-review` 체크리스트. 하네스 변경은 리더·사용자 판단이라 여기서는 제안만 한다.

## 미리 보기에서 사용자가 눌러 볼 것 (PR #72 Vercel 미리 보기, 로그인 필요)
1. `/applications` — 머리의 [자기소개서 작성], 빈 상태라면 빈 상태의 버튼 → 모달이 열린다
2. 추가 모달 ①→② — 공고 URL 붙여넣고 [다음], 실패하면 "직접 입력"으로, ②에서 [자기소개서 작성]
3. 목록 행 → S-46 문항 설정 → [자기소개서 작성 시작] → 작성 상태(탭 자소서·채용 공고·인사이트)
4. 작성 상태에서 답변 입력 → 상단 "저장하기"
5. (선택) 같은 자소서를 두 탭에 열고 한쪽에서 저장 → 다른 쪽에서 저장 → 충돌 다이얼로그(버튼 둘)
6. `/board` — 카드 배지 "자소서 작성 중/작성됨", "+"로 모달
