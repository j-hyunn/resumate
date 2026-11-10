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
