# UI QA — S-02 · S-03 · L-02 · 39 런(PR #52) (40 런, 라운드 1)

- 기준: main `9d8b6a0`, 브랜치 `claude/ui-qa-40-s02-s03-l02`. 기획 PRD v4.13 / UX v5.15 / AI v4.11 / DM v4.11, design-system v5.9.
- 대상 변경: S-02 `f4d7c14`(헤더·Card 제거, `(bare)`), `7cb027a`(Google 단일화) · S-03 `#24`(PT-5 만 14세, `next` 검사 QA-W5-08) · L-02 `21b3442`(ui-panel-doc UP-11·UP-12: 자동 복원·뒤로/앞으로 이탈 확인·스크롤바 auto-hide·42rem 해제) · 39 런 `14b4641`·`7999dd1`.
- 브라우저 패스 없음(브리프). Q12는 모든 행 "미확인" — 아래 "브라우저 확인" 절에 확인할 것을 적었다.

## 요약 — Critical 0 / Major 2 / Minor 9, 기계 검사 4종 통과

- **Major 2건**
  - **UQ-420**: 39 런 회귀. C-09 "경력 먼저 입력하기"가 이제 S-08 추가 모달로 가는데, 모달 저장은 `notifyCareerSaved()`·`recordGateExperience()`를 부르지 않는다. 그래서 C-10 복귀 배너가 다시 판정하지 않고, FL-13 D0 → D1(방금 저장한 경력으로 S-10 새 프로젝트)의 다음 단계가 사라진다.
  - **UQ-421**: L-02 자동 복원(UP-11)이 보존본의 기준 버전을 갖고 있지 않다. 그래서 다른 곳에서 더 새로 저장된 행 위에 오래된 입력이 배너 없이 채워지고, 저장하면 `stale_write` 검사 없이 덮어쓴다.
- Minor 9건: 뒤로/앞으로 방향 판정 대체 경로, 이탈 확인 테스트 없음, 낡은 주석, 정해진 `[UI-가정]` 표식 남음(S-02·S-03·design-system), 옛 경로 redirect 방식, `?new=` 모달 닫힘 뒤 포커스, 폐기 용어 "정량 성과" 칩.
- 39 런 링크 정리: 지운 경로(`/career/experiences/*`, `/career/educations/*`, `routes.experience*`, `routes.education*`, S-11 컴포넌트)를 가리키는 링크는 `src`에 0건이다(주석만 남음). redirect는 항목 id를 유지한다(`new` → `?new={kind}`, 그 밖 → `?item={kind}:{id}`). 데이터 게이트와 근거 칩의 이동 대상은 C-02 v5.5·C-09 표와 같다.
- lint 0 경고 / typecheck 통과 / vitest 147 파일 2381건 통과 / build 통과.
- 리더 참고: `docs/ui/screen-status.md` S-02 행의 "부제 없음 … 기획 확인 필요"는 UX v5.13 OD-S3에서 닫혔다(S-02 표 "제목·안내" 행이 지금 코드를 기준으로 삼는다). 상태 문서를 고칠 때 함께 반영해야 한다.

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | Q11 | Q12 |
|---------|----|----|------|----|----|----|----|----|-----|-----|-----|
| S-02 가입/로그인 | ✅ | ✅ | — | ✅ | ✅ | — | ✅ (Google 로고 색은 6 A1 예외) | ✅ | ✅ | ✅ | 미확인 |
| S-03 동의 | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | 미확인 |
| L-02 셸 (UP-11·UP-12 변경분) | ⚠️ UQ-421 | ✅ | — | ✅ | — | — | ✅ | ⚠️ UQ-422 | ✅ | — | 미확인 |
| S-09·S-34 redirect (39 런) | ✅ | — | ✅ | ⚠️ UQ-428 | — | — | — | ⚠️ UQ-429 | ✅ | — | 미확인 |
| C-09 데이터 게이트 → S-08 새 경력 (39 런) | ❌ UQ-420 | ✅ | — | ✅ | — | — | — | — | — | ✅ | 미확인 |
| C-01·C-02 근거 칩 (39 런, 옛 `achievement`) | ✅ | ⚠️ UQ-430 | ✅ | ✅ | ✅ | — | — | ✅ | — | ✅ | 미확인 |
| C-05·C-07·S-25 (39 런 정리분) | ✅ | ✅ | ✅ | — | — | — | — | — | — | ✅ | 미확인 |

점검 메모:
- **S-02** (UX S-02 v5.7 + v5.13 OD-S3, design-system 6 A1 v5.6): 순서가 명세·design-system과 같다 — 로고 링크(→ S-01, `aria-label`) → (콜백 실패 때만) destructive Alert "로그인을 마치지 못했어요 / 다시 시도해 주세요" → 제목 "Resumate에서 커리어 준비를 시작해요"(부제 없음) → "Google로 계속하기"(outline·lg·전체 폭, 누르면 스피너 + 비활성) → 시작 실패 줄 "Google 로그인을 시작하지 못했어요. 다시 시도해 주세요"(`role="alert"`) → 약관 안내와 링크 두 개. `?next=`는 `safeNextPath`를 거쳐 넘기고, 콜백 실패 URL도 `next`를 유지한다(`server/services/auth/index.ts:70,97`). `?state=` 값은 loading·error·login-error·new-user·deletion-incomplete로, 명세 상태표 6행에 모두 대응한다. R6 이슈 UQ-725~733은 `(bare)` 이동 뒤에도 회귀가 없다(Alert가 제목보다 위, 다시 누르면 지움, `size-5` 로고·스피너, 시작 실패 뒤 포커스 돌려주기, bfcache `pageshow`, 링크 `max-md:h-auto`).
- **S-03** (UX S-03 v5.8 PT-5, design-system 6 A1 v5.2): 동의 목록 맨 위에 "만 14세 이상이에요"가 필수 배지와 함께 있다. "모두 동의"에 포함되고(`setAll`), 빠지면 맨 앞에 넣어 "필수 항목에 모두 동의해야 시작할 수 있어요 (만 14세 이상이에요, …)"를 보이며 `aria-invalid`도 붙인다. 따로 저장하지 않는다(`recordConsentsAction(agreed)`에 나이 값이 없음). 고지 문구는 명세 그대로다. `next`는 페이지(`safeNextPath`)·게이트(`gateConsentPage`)·액션(`recordConsentsAction` → `safeNextPath(next) ?? career`)이 모두 같은 검사를 거친다. 화면 쪽 검사는 계약판(`lib/contracts/routes.ts`)을 먼저 돌린 뒤 `/sign-in`·`/consent`를 막는다(`lib/routes.ts:156-166`, 테스트 `routes.test.ts`).
- **L-02** (1.3a 이탈 확인·입력 보존·본문, design-system 1.3 스크롤바·5.8·5.9): 입력 보존 배너가 없어지고 하이드레이션 뒤 한 번 자동으로 채운다(`project-page.tsx:350-357`, `deliverable-page.tsx:245-252`). 저장 성공·"저장하지 않고 나가기"·"새로 불러오기" 때 지운다. 뒤로/앞으로는 캡처 단계 `popstate`로 막고, 원래 자리로 되돌린 뒤 같은 `LeaveGuardDialog`를 띄운다(문구는 OD-S2와 같다). 닫기·새로 고침은 `beforeunload`. 본문은 `DocBody`의 42rem 제한을 없앴고(`doc-body.tsx:110`), 스크롤바는 `scrollbar-thin scrollbar-thumb-transparent … data-scrolling:` + `useScrollActivity`(design-system 1.3 "스크롤할 때만" 묶음과 같다). 빌드 CSS에 해당 유틸리티가 있는 것을 확인했다. L-02에는 `max-w-doc`·`42rem`이 남아 있지 않다.
- **39 런**: `experiences/[id]`·`educations/[id]` 페이지는 `new` → `routes.careerNew(kind)`, 그 밖 → `routes.careerItem(kind, id)`로 보내 id를 유지한다. 모르는 id는 S-08이 "찾을 수 없는 항목이에요" 토스트로 처리한다(`career-overview.tsx:136-140`). C-09 주 버튼·보조 링크는 `careerNew("experience")`/`careerItem`이고(`data-gate.tsx:107-127`), C-02 경력·교육 칩은 S-08 `?item=`이다(`evidence.ts:79,99`, C-02 v5.5 "원본으로 이동"과 같다). 옛 `achievement` 근거는 링크·인용 없이 "원본 삭제됨"으로 보인다(`evidence.ts:155-158,198-199`). 실제 데이터는 R4가 행을 지웠고 `evidence-real.ts`는 achievement를 읽지 않는다. C-05 `CareerDeleteEntityType`은 `project_detail`·`achievement`를 뺐다(DM 4.2 `entity_type` v4.4와 같다). C-07은 G-3을 삭제했다(UX C-07 G-3 폐기 행). S-25는 "산출물" 줄 + 계약 `projectDeliverables`(UX S-25 v5.5와 같다).

## 브라우저 확인

이번 런에서는 하지 않았다(브리프: 브라우저 패스는 사용자가 따로 한다). SSR이나 curl 확인도 하지 않았다. 브라우저에서 확인할 것:

1. **S-02**: 데스크톱과 좁은 화면(375px)에서 헤더 없이 가운데 배치되는지, 로고 링크 포커스 링, Google 왕복(성공 / 동의 화면에서 취소 → "로그인을 마치지 못했어요" + `next` 유지), 시작 실패를 일부러 냈을 때 버튼 포커스 복귀, Google에서 뒤로 왔을 때(bfcache) 버튼이 다시 활성인지.
2. **S-03**: 새 계정으로 첫 로그인 → 만 14세를 빼고 누르기(오류 줄·`aria-invalid`) → 모두 동의 → `?next=` 원래 화면 또는 S-08. 스크린 리더로 "모두 동의"의 혼합 상태 읽기.
3. **L-02 (S-10·S-44)**: (a) 입력하고 탭 닫기 → 다시 열면 배너 없이 채워지고 저장하기에 점이 켜지는지. (b) 더러운 상태에서 브라우저 뒤로·앞으로 → 다이얼로그가 뜨고 URL이 그대로인지, X = 머묾, 나가기 = 실제로 한 칸 이동. **Chrome·Safari·Firefox에서 각각**(UQ-422 — Navigation API가 없는 브라우저의 앞으로). (c) 본문 스크롤바가 스크롤할 때만 보이는지(macOS "항상 표시" 설정 포함, Safari `scrollbar-color` 지원 여부). (d) 넓은 창에서 왼쪽 열이 전체 폭을 쓰는지. (e) UQ-421을 재현: 두 탭에서 같은 프로젝트를 열고, 탭 A에서 입력만 하고 닫은 뒤 탭 B에서 저장 → 탭 A의 페이지를 다시 열고 저장했을 때 B의 내용이 사라지는지.
4. **39 런**: `/career/experiences/new`·`/career/educations/new` → 추가 모달이 한 번 열리고 주소에서 `new`가 빠지는지. `/career/experiences/{실제 id}` → 그 항목이 선택되는지. 모르는 id → 토스트. S-16에서 데이터 게이트 "경력 먼저 입력하기" → 모달에서 저장 → C-10 배너가 다시 판정되는지(UQ-420에서는 다시 판정되지 않을 것으로 예상).

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-420 | Major | frontend-engineer(A2) | C-09 → S-08 새 경력(S-09), C-10 | 02 FL-13 흐름도 `D0[S-08 새 경력 S-09 · 재직 정보 저장] --> D1`, "섹션 저장·저장하기마다 get_data_readiness 재판정"(FL-13 본문 끝 문단), C-09 주 버튼 행(`02-user-flows.md:895`) | `src/components/career/add-career-dialog.tsx:255-265`(저장 성공 경로), `src/components/career/career-overview.tsx:293-299`(`onCreated`), `src/components/common/return-target.ts:68-73`(`recordGateExperience` — 이제 부르는 곳 없음), `src/components/common/return-banner.tsx:144-146`(`SAVED_EVENT`에서만 다시 판정). 삭제된 `experience-form.tsx`(`14b4641^`) `:113-118`이 하던 일 | 게이트에서 S-08 모달로 와서 경력을 저장하면 C-10 배너가 준비 상태를 다시 판정하고("준비됨" / "아직 필요 n개"), 기록한 경력으로 다음 단계("AI와 대화하며 채우기" → S-10 새 프로젝트 `?experience=`)를 보인다 | 모달 저장(추가·수정)은 `notifyCareerSaved()`도 `recordGateExperience()`도 부르지 않는다. 같은 `/career`에 머물러(`pushState`라 pathname이 같다) 배너가 처음 판정 그대로 남고, `target.experience_id`가 없으니 `gateContinuationHref`가 null이 되어 다음 단계 버튼이 없다. 39 런 전에는 옛 S-09 페이지가 둘 다 불렀다. **고치기**: `AddCareerForm` 저장 성공 뒤(추가·수정 모두) `notifyCareerSaved()`를 부르고, 추가된 종류가 `experience`이고 `readCareerReturn()`이 있으면 `recordGateExperience(result.id)`를 부른다. 이 경로를 묶는 테스트 하나(모의 `window` 이벤트·세션 저장소) |
| UQ-421 | Major | frontend-engineer(A2) | S-10 · S-44 (L-02 입력 보존) | 02 1.3a "입력 보존"(UP-11 자동 복원) + "저장하기" 상태 / S-10·S-44 페이지 저장 `p_expected_updated_at` → `stale_write`(DM 2.5.1, PA-3), design-system 5.8 `StaleWriteDialog` | `src/components/career/project-page/project-page.tsx:209-212`(보존본 = `{values, applied}`만), `:350-357`(복원), `:169`·`:265`(`expected_updated_at: updatedAt` = 지금 서버 행); `src/components/career/deliverable/deliverable-page.tsx:106-118`, `:245-252`, `:79`·`:164`; `src/components/common/shell/input-preservation.ts` | 이전 방문의 입력을 되살려도, 그 사이 다른 곳(다른 탭·기기)에서 저장된 내용을 확인 없이 덮어쓰지 않는다. 기준이 다르면 기존 변경 충돌 다이얼로그("다른 곳에서 이 프로젝트가 바뀌었어요")로 고르게 한다 | 보존본에 "어느 버전에서 고친 입력인지"(행의 `updated_at`)가 없다. 다시 열면 오래된 폼 값 전체(사용자가 손대지 않은 칸 포함)를 지금 행 위에 말없이 채우고, 저장하기는 **지금** `updated_at`을 기대 버전으로 보내 서버가 `stale_write` 없이 받아들인다. 배너가 있던 때는 사용자가 "이어서 편집"을 골랐지만, UP-11로 배너가 없어져 그 선택도 사라졌다. 이탈 확인의 "저장하고 나가기"로도 같은 덮어쓰기가 일어난다. **고치기**: 보존본에 `base_updated_at`(복원 대상 행의 `updated_at`, 새 페이지는 null)을 함께 쓰고, 복원할 때 값이 지금 행과 다르면 `setUpdatedAt(stored.base_updated_at)`로 기대 버전을 그 값으로 둔다 → 첫 저장이 `stale_write` → 기존 `StaleWriteDialog`("내 내용으로 저장 / 새로 불러오기")가 뜬다. 테스트: 기준이 다른 보존본 → 저장 요청의 `expected_updated_at`이 보존본 값인지 |
| UQ-422 | Minor | frontend-engineer(A0) | L-02 | 02 1.3a 이탈 확인 "브라우저 뒤로·앞으로"(UP-11) | `src/components/common/shell/page-shell.tsx:150-169` | 뒤로든 앞으로든 다이얼로그가 뜨는 동안 원래 항목(URL)에 머물고, "나가기"는 사용자가 누른 방향으로 한 칸 간다 | 방향을 Navigation API(`navigation.currentEntry.index`)로만 알아낸다. 없으면 무조건 "뒤로"로 본다(`:160`). Navigation API가 없는 브라우저에서 **앞으로**를 누르면 `history.forward()`(`:168`)로 한 칸 더 앞으로 가거나(앞 항목이 있을 때), 아무 일도 없이 URL이 다음 항목에 남은 채 페이지만 그대로 보인다. "나가기"(`history.back()`)도 엉뚱한 곳으로 간다. **고치기**: 마운트 때 `history.replaceState({...history.state, __l02Index: n})`처럼 자체 위치 값을 두고 popstate의 `e.state`로 방향을 정한다. 이 값도 없으면 막지 말고 그냥 이동시킨다(보존본이 남아 있으니 다시 열면 복원된다). 브라우저 확인 3(b) |
| UQ-423 | Minor | frontend-engineer(A0) | L-02 | design-system 5.8 `LeaveGuard`(UP-11 뒤로/앞으로), 02 1.3a | `src/components/common/shell/page-shell.tsx:96-216`(`useLeaveGuard`), 테스트 없음(`*.test.*`에 `popstate`·`useLeaveGuard` 0건) | UP-11의 새 동작(popstate 가로채기·되돌리기·나가기 방향, 문서 클릭 캡처, `bypass` 재무장)을 단위 테스트가 묶는다. 33 런 `new-row-notice.test.ts`처럼 | 입력 보존 store만 테스트가 있고(`input-preservation.test.ts`), 이탈 확인 훅은 코드를 읽어서만 확인된다. **고치기**: jsdom + `renderHook`으로 dirty일 때 `popstate`가 `stopImmediatePropagation` + `pending` 설정, dirty가 아니면 통과, 클릭 캡처가 같은 경로 쿼리 전용 링크를 무시하는지 |
| UQ-424 | Minor | frontend-engineer(A0) | L-02 | 02 1.3a 입력 보존(UP-11: 배너 없음), UP-12(42rem 없음) | `src/components/common/shell/input-preservation.ts:5-10,28`("restore banner", "이어서 편집", "버리기"), `src/components/common/shell/page-shell.tsx:583,587,589`, `src/components/common/shell/doc-body.tsx:60`("the 42rem text width"), `src/components/common/shell/input-preservation.test.ts:38,51`(테스트 이름) | 주석·테스트 이름이 지금 규칙(자동 복원, 폭 제한 없음)을 설명한다 | 없어진 배너·"이어서 편집/버리기"·42rem을 계약 설명으로 남겨, 다음 작업자가 배너 응답 대기(`pending`)를 지금도 쓰는 규칙으로 읽을 수 있다. **고치기**: 주석을 "복원 = 하이드레이션 뒤 `resolve()`"로 고치고, 테스트 이름에서 배너 용어를 뺀다 |
| UQ-425 | Minor | frontend-engineer(A1) | S-02 | 02 S-02 표 "제목·안내"(v5.13, OD-S3 — "구현 `sign-in/page.tsx` 그대로 … 부제 없음. 처음이면 바로 가입된다는 안내는 아래 약관 안내 문장이 대신한다") | `src/app/(bare)/sign-in/page.tsx:73` | 확정된 사항이니 `[UI-가정]` 표식이 없다 | `{/* [UI-가정] … 부제 없음 (02 S-02의 "처음이면 바로 가입" 안내 생략) */}`이 남아 `grep "\[UI-가정\]"` 목록에 미결로 잡힌다. **고치기**: 주석을 "(UX v5.13 OD-S3) 부제 없음"으로 바꾼다 |
| UQ-426 | Minor | ui-designer | S-02 | 02 S-02 표 "제목·안내"(v5.13, OD-S3) | `docs/ui/design-system.md:1930`(6 A1 S-02 제목 항목: "**부제 없음** `[UI-가정]`(… 명세의 제목 '가입/로그인'·'처음이면 바로 가입' 한 줄 대신 …)") | design-system이 확정된 명세를 근거로 든다 | 아직 "명세와 다른 사용자 요청 가정"으로 적혀 있다. **고치기**: `[UI-가정]`과 "명세의 … 대신"을 지우고 "(플로우 v5.13 OD-S3)"로 근거를 바꾼다 |
| UQ-427 | Minor | frontend-engineer(A1) | S-03 | 02 S-03 (v5.8, PT-5) "'모두 동의'에 포함되고, 빠진 채 … '필수 항목에 모두 동의해야 시작할 수 있어요 (만 14세 이상이에요, …)'로 안내한다" | `src/components/account/consent-form.tsx:100`(`[UI-가정] "모두 동의" convenience row`), `:184`(`[UI-가정]` 오류 문구) | 명세가 "모두 동의"와 오류 문구를 주니 `[UI-가정]`이 아니다 | 표식이 남아 있다(문구와 동작은 명세와 같다). **고치기**: 두 주석을 "02 S-03 v5.8 PT-5"로 바꾼다 |
| UQ-428 | Minor | frontend-engineer(A2) | S-09 · S-34 옛 경로 | 02 1장 "폐기 화면은 redirect만"(ui-context), S-09·S-34 행 "옛 `/career/experiences/new\|[id]` → redirect"(screen-status) | `src/app/(dashboard)/(gated)/career/experiences/[id]/page.tsx:12-22`, `src/app/(dashboard)/(gated)/career/educations/[id]/page.tsx:12-22`, `src/lib/routes.ts:44-46`(`careerItem`가 id를 인코딩하지 않음) | 옛 주소가 HTTP redirect(3xx)로 S-08에 가고, id가 쿼리에 안전하게 들어간다. 같은 저장소 선례: `next.config.ts` `redirects()`(S-30 `/policies`) | `ScreenSuspense` 안의 비동기 컴포넌트에서 `redirect()`를 불러, 스트리밍된 응답(200) 안에서 클라이언트가 이동한다(빌드 표 `◐`). 동작은 하지만 북마크·외부 링크에서 한 번 빈 셸을 그린다. id는 디코드된 값 그대로 `?item=experience:${id}`에 붙어, `%26edit%3Dcontent` 같은 값이 쿼리 키를 더할 수 있다(위험은 낮음). redirect·`?new=`를 묶는 테스트도 없다. **고치기**: `next.config.ts` `redirects()`에 `/career/experiences/new` → `/career?new=experience`, `/career/experiences/:id` → `/career?item=experience::id`(교육도 같게, `new`를 먼저)를 두고 두 페이지를 지운다. 또는 페이지를 남기면 `encodeURIComponent(id)`를 쓴다. 경로 표 테스트 한 줄을 더한다 |
| UQ-429 | Minor | frontend-engineer(A2) | S-08 `?new={kind}` | design-system 7 A-14(다이얼로그 닫으면 연 자리로 포커스), UX-8 | `src/components/career/career-overview.tsx:251-258`(주소로 자동 열기), `src/components/career/add-career-dialog.tsx:207-211`(`onCloseAutoFocus` 없음) | 주소(`?new=`)로 자동으로 연 추가 모달을 닫으면 포커스가 "커리어 추가" 버튼으로 간다 | 연 트리거가 없어 Radix가 열기 전 포커스(`body`)로 돌려준다. 키보드·스크린 리더 사용자가 페이지 맨 앞에서 다시 시작한다. **고치기**: `AddCareerMenu`에서 트리거 ref를 잡고 `DialogContent onCloseAutoFocus`에서 `?new=`로 연 경우 그 버튼에 포커스한다 |
| UQ-430 | Minor | frontend-engineer(A0) | C-01 근거 칩 (미리 보기) | 02 C-07 G-3·S-11 폐기(CR-11) — "정량 성과" 용어 삭제, C-02 "정량 성과 → S-11 이동은 폐기" | `src/lib/data/labels.ts:240`(`achievement: "정량 성과"`), `src/lib/data/evidence.ts:198-199`, 픽스처 `src/lib/mock/fixtures.ts:1525,1529,1539,1542` | 폐기 용어가 화면에 나오지 않는다 | 실제 데이터에는 없지만(R4가 근거 행을 지움), S-16·S-19 등 `?state=` 미리 보기의 근거 칩이 "정량 성과 · 결제 승인 API p95 응답 시간 · 원본 삭제됨"으로 보인다. 미리 보기를 기준으로 화면을 확인하는 사람에게 폐기 용어와 "삭제됨" 칩이 정상 예시로 보인다. **고치기**: 픽스처의 `achievement` 근거 4줄을 `project`(`result` 필드) 근거로 바꾼다(39 브리프에서 범위 밖으로 둔 픽스처 정리와 함께). 또는 kind 라벨을 "삭제된 근거"로 바꾼다 |

## 기획 확인 필요

- **P-40-1 (L-02 입력 보존 · 로그아웃)**: 02 1.3a "입력 보존"은 "내용은 브라우저 저장소에만, URL에는 넣지 않는다"고 하지만 **언제 지우는지는 저장 성공·"저장하지 않고 나가기"만** 정한다. 지금은 `localStorage`의 `resumate:l02:*` 보존본(STAR·산출물 본문 원문)이 로그아웃·탈퇴 뒤에도 기기에 남는다(`page-shell.tsx:603-616`, 로그아웃 `nav-user`의 `useAccountSignOut`은 보존본을 지우지 않음). 공용 PC에서는 다음 사람이 개발자 도구로 읽을 수 있다(RLS 때문에 다른 계정으로 그 행을 여는 것은 불가). 로그아웃·탈퇴 때 `resumate:l02:*`를 지울지, 지금처럼 둘지 정해 달라. 권고: 로그아웃·탈퇴 때 지운다(NFR-PRV 쪽 기록).
- **P-40-2 (UQ-421 고치는 방향 확인)**: 1.3a는 "다시 열면 배너 없이 자동 복원"만 정하고, 그 사이 다른 곳에서 저장된 경우는 정하지 않았다. QA 권고는 가장 보수적인 읽기로, 복원은 그대로 하고 첫 저장에서 기존 변경 충돌 다이얼로그(`stale_write`)를 띄우는 것이다. 다른 선택지는 기준이 다르면 복원하지 않고 버리는 것(입력 유실). 명세에 한 줄 더할지 판단해 달라. 구현은 권고안으로 먼저 진행할 수 있다.

## 재확인 결과

| ID | 결과 | 메모 |
|----|------|------|
| UQ-725~731 (R6, S-02) | 해결 유지 | `(bare)` 이동 뒤에도 `sign-in-form.tsx`가 같다: Alert가 `intro`보다 먼저(`mb-6`), 다시 누르면 지움, `size-5` 로고·스피너, 버튼 `mt-8`, 시작 실패 `mt-2` + 포커스 돌려주기, `pageshow` |
| UQ-732 (R6) | 해결 유지 | `server/services/auth/index.ts:70,97` `loginCallbackErrorUrl(next)` |
| UQ-733 (R6) | 해결 유지 | `page.tsx:81,85` `max-md:h-auto` |

## 기계 검사 출력

| 검사 | 결과 |
|------|------|
| `pnpm lint` | 통과 (eslint, 경고 0) |
| `pnpm typecheck` | 통과 (`next typegen && tsc --noEmit`) |
| `pnpm test` | 통과 — Test Files 147 passed, Tests 2381 passed |
| `pnpm build` | 통과 — `/sign-in`·`/consent`·`/career/experiences/[id]`·`/career/educations/[id]` 모두 `◐`(부분 사전 렌더) |
