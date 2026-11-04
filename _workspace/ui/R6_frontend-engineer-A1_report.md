# R6 A1 구현 보고 — S-02 Google 로그인만 (플로우 v5.7, D-09 변경 2026-11-04)

## 완료 화면
| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---|---|---|---|
| S-02 | `/sign-in` | `loading` · `error`(Google 로그인 시작 실패) · `login-error`(콜백 실패 경고) · `new-user`(→ S-03) · `deletion-incomplete`(→ S-25 탈퇴 마무리) | `?error=auth_callback`은 운영에서도 `login-error`와 같은 상단 경고. `sent`·`link-expired`는 삭제(`link-expired` → `login-error`로 이름 변경) |

### 바뀐 파일
- `src/components/account/sign-in-form.tsx` — "Google로 계속하기"(outline, 전체 폭, Google 로고)만 남김. 누르면 스피너 + 비활성 + `aria-busy`, 이동하는 동안 비활성 유지. 시작 실패 → 버튼 아래 `role="alert"` "Google 로그인을 시작하지 못했어요. 다시 시도해 주세요"(버튼 다시 활성). 콜백 실패 → 상단 destructive Alert "로그인을 마치지 못했어요" / "다시 시도해 주세요". 이메일 폼·zod 스키마·재발송/쿨다운·"다른 이메일로 받기"·링크 보냄 Alert·개발용 "메일의 로그인 링크 열기"·"또는" 구분선 삭제. 헤더 주석 갱신. `SignInPreview = "error" | "login-error" | "new-user" | "deletion-incomplete" | null`.
- `src/app/(public)/sign-in/page.tsx` — PREVIEWS 목록, `isLoginError(sp.error)` → `"login-error"`, 헤더 주석 ?state= 목록, 부제 "처음이면 바로 가입돼요. Google 계정으로 들어와요.", 로딩 스켈레톤 필드 1개.
- `src/components/account/actions.ts` — `sendMagicLinkAction`·`openMagicLinkAction` 삭제, `sendMagicLink`·`completeSignIn` import 삭제(둘 다 더 이상 UI에서 안 씀). Google·동의·설정·로그아웃 액션은 그대로.
- `docs/ui/screen-status.md` — 헤더 기준 기획에 "S-02만 PRD v4.7 / 플로우 v5.7" 추가, S-02 행 "구현 완료, QA 대기 (v5.7)".

### 잔여물 점검
`src/lib/mock`, `src/components`, `src/app`(`/dev/states` 포함)에서 magic link·로그인 링크·이메일 링크·`sent`·`link-expired` 흔적 grep → UI 소유 파일에 남은 것 없음. `src/lib/data/account.ts`의 `sendMagicLink`·`completeSignIn`(magic_link 분기)은 지시대로 손대지 않음(api-engineer 정리 대상).

## 미완료 / 부분 구현
- 없음. 브라우저 클릭 확인은 하지 않음(lint·typecheck·build만).

## [UI-가정]
| 화면 ID | 파일:줄 | 내용 |
|---|---|---|
| S-02 | `src/app/(public)/sign-in/page.tsx:60` | 부제 문구 "처음이면 바로 가입돼요. Google 계정으로 들어와요." (스펙은 뜻만 줌) |
| S-02 | `src/components/account/sign-in-form.tsx:46` | 콜백 실패에서 취소와 실패를 나누지 않음 — 스펙 자체의 `[가정]`을 그대로 표시 |

## 기획 확인 필요
- 없음.

## 파운데이션 / 다른 담당 요청
- api-engineer: `src/lib/data/account.ts`의 deprecated `sendMagicLink` 삭제와 `completeSignIn`의 magic_link 분기 정리 — UI는 이제 둘 다 import하지 않으므로 바로 지워도 됨.
- ui-designer: design-system 6 A1의 S-02 패턴(이메일 Input·"또는" 구분선·재발송 Alert)을 Google 버튼 하나 + 시작 실패 한 줄 + 콜백 실패 상단 Alert로 맞춰 주기(병행 중).

## 검사 결과
- `pnpm typecheck`: 통과
- `pnpm lint`: 통과(경고·오류 없음)
- `pnpm build`: worktree에 `.env.local`이 없어 더미 env(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, 가짜 anon 키·JWT secret·CRON secret)로 실행 → 통과, `/sign-in` 포함 전체 라우트 생성

## QA 라운드 1 수정 (2026-11-04)

대상: `_workspace/ui/R6_ui-qa_S-02_review.md` UQ-725~UQ-731. 기준: design-system 6 A1 S-02 (v5.1).
수정 파일: `src/components/account/sign-in-form.tsx`, `src/app/(public)/sign-in/page.tsx`, `docs/ui/screen-status.md`(S-02 행).

| ID | 수정 내용 |
|---|---|
| UQ-725 | `SignInForm`이 카드 본문 전체를 그리도록 바꿨다. `intro`(제목 묶음)·`footnote`(약관 안내)를 prop으로 받고, 콜백 실패 `Alert`를 그 위 카드 첫 요소(`mb-6`)로 둔다. `Card`는 `gap-0 p-8`로 간격을 요소별 마진으로만 정한다 |
| UQ-726 | 콜백 실패 표시를 `callbackFailed` 상태로 옮겼다(초기값 `preview === "login-error"`). 버튼을 누르면 지운다 |
| UQ-727 | 버튼 `size="lg"`. Google 로고 `size-5`, 진행 중 `Loader2 size-5 animate-spin`이라 누를 때 아이콘 크기가 같다 |
| UQ-728 | 부제 `body`(`text-base leading-[1.6]`) + `mt-2`, 버튼 `mt-8`, 시작 실패 줄 `mt-2` |
| UQ-729 | 약관 안내 `mt-6 text-center` meta. 링크는 `Button variant="link" asChild` + `h-auto p-0 text-sm` |
| UQ-730 | 시작 실패로 `busy`가 풀리면 버튼으로 포커스를 돌려준다(`refocus` 플래그 + effect) |
| UQ-731 | `pageshow`에서 `event.persisted`이면 `busy`를 해제한다(Google에서 뒤로 가기 bfcache 복원) |

추가 `[UI-가정]`
- 약관 링크에 `max-md:h-auto`를 더했다. Button default 크기의 `max-md:h-11`(A-4 터치 높이) 때문에 좁은 화면에서 문장 안 링크가 44px 높이로 줄을 벌리는 것을 막는다. 문장 안 인라인 링크라 터치 높이 규칙의 예외로 봤다.

범위 밖: UQ-732(콜백 실패 시 `next` 유지)는 api-engineer가 `src/server/**`에서 수정 중. UI 쪽 `page.tsx`는 `?next=`가 있으면 그대로 받으므로 추가 변경 없음.

기계 검사: `pnpm typecheck` 통과, `pnpm lint` 통과(출력 없음). `pnpm build`·브라우저 확인은 하지 않았다.
