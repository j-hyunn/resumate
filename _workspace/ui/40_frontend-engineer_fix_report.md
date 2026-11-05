# 40 런 수정 보고 — frontend-engineer (A0 + A1 + A2)

- 기준: 브랜치 `claude/ui-qa-40-s02-s03-l02`, 리뷰 `_workspace/ui/40_ui-qa_review.md` 라운드 1.
- 범위: UQ-420 ~ UQ-430 (UQ-426은 리더 몫이라 제외). 사용자 결정 U40-1 (P-40-1), U40-2 (P-40-2)를 반영했다.
- `docs/`·`supabase/`·`src/server/`·`src/app/api/`·`src/lib/contracts/`는 손대지 않았다. (작업 트리의 `docs/` 변경은 리더 쪽 작업이다.)

## 이슈별 수정

### UQ-420 (Major) — S-08 모달 저장 뒤 C-10 재판정 · 게이트 경력 기록
- 변경: `notifyCareerSaved()`와 저장 이벤트 이름을 `return-target.ts`로 옮겼다(`return-banner.tsx`는 다시 내보내기만 한다). 새 함수 `afterCareerItemSaved({ kind, id, created })`를 더했다. 이 함수는 경력을 새로 추가했고 복귀 대상이 있으면 먼저 `recordGateExperience(id)`를 부르고, 그다음 `notifyCareerSaved()`를 부른다. `AddCareerForm`이 추가 성공 경로와 수정 성공 경로에서 모두 이 함수를 부른다.
- 파일: `src/components/common/return-target.ts`, `src/components/common/return-banner.tsx`, `src/components/career/add-career-dialog.tsx`
- 테스트: `src/components/common/return-target.test.ts` 3건. 게이트에서 추가하면 `experience_id`를 기록하고 이벤트가 순서대로 나간다. 수정이나 다른 종류는 재판정만 한다. 복귀 대상이 없으면 기록하지 않는다.

### UQ-421 (Major) — L-02 보존본 기준 버전 (U40-2)
- 변경: 보존본에 `base_updated_at`을 함께 쓴다. 값은 입력을 시작한 행의 `updated_at`이고, 새 페이지면 null이다. 다시 열 때는 `isRestorable(copy, data.updated_at)`이 참일 때만 자동으로 복원한다. 거짓이면 `clear()`로 보존본을 말없이 버리고 저장된 행을 보인다. 거짓인 경우는 다른 곳에서 그 사이에 저장했을 때, 기준 값이 없는 옛 보존본일 때, 형식이 잘못됐을 때다. 시각 비교는 같은 순간이 다른 문자열 형식으로 와도 맞도록 `Date.parse`로 한다(읽기 쿼리와 저장 RPC의 형식이 다를 수 있음).
- 파일: `src/components/common/shell/input-preservation.ts` (`VersionedCopy`, `isRestorable`), `src/components/career/project-page/project-page.tsx`, `src/components/career/deliverable/deliverable-page.tsx`, `src/components/common/dev-page-shell-demo.tsx`(쓰기 형식만 맞춤)
- 테스트: `input-preservation.test.ts`에 `isRestorable` 4건을 더했다. 같은 버전이면 복원(형식이 달라도), 새 페이지(null↔null)도 복원, 다른 곳에서 저장됐으면 버림, 기준 없는 옛 보존본이나 잘못된 값도 버림.

### UQ-422 (Minor) — 뒤로/앞으로 방향 판정 대체 경로
- 변경: popstate 처리를 순수 함수 `createPopStateGuard`로 뽑았다.
  - 방향은 Navigation API의 index로 정한다.
  - Navigation API가 없으면 이 셸이 마운트할 때 `history.state.__l02Index`에 찍은 값을 쓴다(`stampEntry`). 이 값은 만들어진 순서대로 커지고, 이미 찍혀 있으면 그대로 둔다. 다른 항목의 popstate `e.state`에서 읽은 값과 비교한다.
  - 둘 다로도 방향을 알 수 없으면 막지 않고 그냥 이동시킨다. 보존본이 남아 있으니 다시 열면 복원된다.
  - "나가기"는 사용자가 누른 방향으로 한 칸 간다.
- 파일: `src/components/common/shell/leave-guard.ts`(새 파일), `src/components/common/shell/page-shell.tsx`(`useLeaveGuard`가 이 함수들을 쓴다)
- 한계: Navigation API가 없는 브라우저에서 찍힌 값이 없는 항목(예: S-08)으로 뒤로 가면 다이얼로그 없이 이동한다. QA가 권고한 동작이다.

### UQ-423 (Minor) — `useLeaveGuard` 테스트
- 변경: 프로젝트에 jsdom과 testing-library가 없다(vitest `environment: "node"`). 의존성을 더하지 않으려고 훅의 로직을 순수 함수로 뽑아 테스트했다: `createPopStateGuard`, `guardableHref`/`createClickGuard`, `createBypass`(다시 막기 1.5초, 새로 고침 때는 `hold`), `stampEntry`. 훅은 이 함수들을 이벤트에 연결하는 일만 한다.
- 테스트: `src/components/common/shell/leave-guard.test.ts` 14건.
  - popstate: 더러우면 `stopImmediatePropagation`, 되돌리고 `ask`를 부른다. 되돌릴 때 생기는 popstate도 삼킨다. 뒤로·앞으로 각각 "나가기" 방향을 확인한다. Navigation API가 없으면 찍힌 값으로 방향을 정하고, 방향을 모르면 통과시킨다. 깨끗하면 통과한다.
  - 클릭: 같은 경로에 같은 쿼리(해시만 다름)는 무시하고, 쿼리가 다르면 막는다. 수정 키·새 탭·download·외부 링크·`data-leave-guard="skip"`는 무시한다. 더러울 때만 `preventDefault`한다.
  - bypass: 다시 막기와 `hold`를 확인한다.

### UQ-424 (Minor) — 낡은 주석과 테스트 이름
- 변경: 보존 store 계약 주석을 "하이드레이션 뒤 `resolve()`로 자동 복원 / `clear()`로 버림, 기준 버전 규칙"으로 고쳤다. `useInputPreservation` 필드 주석에서 배너·"이어서 편집"·"버리기"를 뺐다. `DocBody` 주석의 42rem을 "열 전체 폭(UP-12)"으로 바꿨다. 테스트 이름 3개에서 배너 용어를 뺐다.
- 파일: `input-preservation.ts`, `input-preservation.test.ts`, `page-shell.tsx`, `doc-body.tsx`

### UQ-425 (Minor) — S-02 `[UI-가정]` 표식
- 변경: 주석을 "(UX v5.13 OD-S3) 서비스 전용 제목, 부제 없음 — …약관 안내 문장이 대신한다"로 바꿨다. 같은 파일 `:80`의 `max-md:h-auto` 가정은 다른 사항이라 그대로 두었다.
- 파일: `src/app/(bare)/sign-in/page.tsx`

### UQ-427 (Minor) — S-03 `[UI-가정]` 표식
- 변경: "모두 동의" 행 주석과 오류 문구 주석을 "02 S-03 v5.8 PT-5"로 바꿨다.
- 파일: `src/components/account/consent-form.tsx`

### UQ-428 (Minor) — 옛 경로 redirect
- 변경: 옛 경로를 `next.config.ts` `redirects()`의 HTTP 308로 옮겼다. 규칙은 `src/lib/legacy-redirects.ts`에 두고 next.config가 가져온다. `new` 규칙이 먼저 온다.
  - `/career/experiences/new` → `/career?new=experience`
  - `/career/experiences/:id` → `/career?item=experience::id`
  - 교육(`/career/educations/…`)도 같다.
  - 두 redirect 페이지(`career/experiences/[id]`, `career/educations/[id]`)는 지웠다.
  - `routes.careerItem`은 이제 id를 `encodeURIComponent`한다.
  - 빌드 뒤 `.next/routes-manifest.json`에 4개 규칙이 308로 들어간 것을 확인했다.
- 파일: `next.config.ts`, `src/lib/legacy-redirects.ts`(새 파일), `src/lib/routes.ts`, 페이지 2개 삭제
- 테스트: `src/lib/legacy-redirects.test.ts` 4건. Next의 `getPathMatch`·`prepareDestination`로 실제 치환을 확인했다: new → 모달, id → `item`(`careerItem`과 같은 값), `%26edit%3D…`가 쿼리 키를 더하지 않음, 다른 경로는 건드리지 않음.

### UQ-429 (Minor) — `?new=`로 연 모달을 닫은 뒤 포커스
- 변경: `AddCareerDialog`에 `onCloseAutoFocus` prop을 더했다. `AddCareerMenu`는 주소로 연 경우(`openedByUrl`)에만 기본 동작을 막고 "커리어 추가" 버튼(ref)에 포커스한다. 메뉴로 연 경우는 Radix 기본 동작(트리거로 돌아감)을 그대로 쓴다.
- 파일: `src/components/career/add-career-dialog.tsx`, `src/components/career/career-overview.tsx`

### UQ-430 (Minor) — 폐기 용어 "정량 성과" 칩
- 변경: 픽스처의 `achievement` 근거 4줄을 `project`(prj-1, `result` 필드, 인용 "p95 응답 시간이 1.2초에서 0.7초로 줄었고", 스냅샷 1일 전 = 정상 칩)로 바꿨다. kind 라벨 `achievement`도 "삭제된 근거"로 바꿔 폐기 용어가 화면에 나올 길을 없앴다.
- 파일: `src/lib/mock/fixtures.ts`, `src/lib/data/labels.ts`

### U40-1 (P-40-1) — 로그아웃·탈퇴 때 미저장 입력 지우기
- 변경: `clearUserUnsavedInput()`를 새로 만들었다. 저장소 접근은 모두 try/catch로 감쌌고, 키 하나를 지우다 실패해도 나머지는 계속 지운다. 리다이렉트 직전에 부른다.
  - 부르는 곳: 셸 계정 메뉴 로그아웃(`useAccountSignOut`, L-01·L-02 공용), S-24 로그아웃 버튼, `signOutToLanding`(S-25 탈퇴 성공, 탈퇴 마무리 화면의 마무리 성공과 로그아웃), S-25에서 `account_deletion_incomplete`로 마무리 화면에 갈 때.
  - 지우는 것: localStorage `resumate:l02:*`(L-02 보존본), sessionStorage `resumate.a3.new-application.*`(S-14 새 자기소개서 입력, JD 원문), sessionStorage 복귀 대상(`resumate.return-target`, `resumate.nav-origin`, `resumate.ai-*` — 사용자의 행 id와 진행 중 설정).
  - 남기는 것: 브라우저별 표시 설정(테마, AI 패널 열림·폭, 장애 배너 닫음).
- 파일: `src/components/common/clear-user-storage.ts`(새 파일), `src/components/common/shell/nav-user.tsx`, `src/components/account/sign-out-button.tsx`, `src/components/account/withdraw-form.tsx`
- 테스트: `src/components/common/clear-user-storage.test.ts` 2건. 지울 키와 남길 키를 구분하는지, 저장소가 막혀 있거나 지우기가 실패해도 예외가 나지 않는지 확인한다.

## 기계 검사

| 검사 | 결과 |
|------|------|
| `pnpm lint` | 통과 (경고 0) |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 통과 — 151 파일, 2407건 (이전 147 / 2381에서 새 테스트 4파일 26건) |
| `pnpm build` | 통과. `/career/experiences/[id]`·`/career/educations/[id]` 페이지가 빠졌고, routes-manifest에 career redirect 4개(308)가 있다 |

브라우저 확인: 하지 않았다(브리프: 브라우저 패스는 사용자가 한다). 리뷰 "브라우저 확인" 3(b)(e)·4는 이번 수정 뒤의 동작으로 확인해야 한다.
- 3(e): 다른 탭에서 저장한 뒤 다시 열면 보존본이 버려지고 저장된 내용이 보여야 한다.
- 4: 옛 주소가 HTTP 308로 가야 한다. C-10 배너는 다시 판정되고 다음 단계가 보여야 한다.

## 남은 것

- `[UI-가정]` 새로 더한 것 없음.
- 기획 확인 필요: 없음. U40-1에서 "그 밖의 사용자별 입력 저장소"로 S-14 입력과 복귀 대상까지 지운 것은 이번 판단이다. 기획 문서(1.3a·S-14 입력 보존)에 지우는 시점을 한 줄 더할지는 리더가 정한다.
- UQ-422 한계: Navigation API가 없고 이동할 항목에 찍힌 값도 없으면 막지 않는다(QA 권고안).
- `src/lib/data/career.ts:196`의 `not_supported` 오류 문구에 "정량 성과"가 남아 있다. 지금은 부르는 화면이 없는 옛 함수라 이번 범위에서 고치지 않았다.
- 리더에게: UQ-426(design-system 6 A1 S-02 `[UI-가정]`)이 남아 있다. screen-status S-09·S-34 행의 "redirect"는 이제 `next.config.ts`(legacy-redirects.ts)로 고쳐 적어야 한다.
- 커밋하지 않았다.
