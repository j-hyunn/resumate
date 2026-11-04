# UI QA — S-10 새 프로젝트 · S-44 새 산출물 "추가 중" 표시 (33 런, 라운드 1)

- 날짜: 2026-11-04
- 범위: 33 런 A2 변경 3파일만 — `src/components/career/new-row-notice.tsx`(신설, 미추적), `project-page/project-page.tsx`, `deliverable/deliverable-page.tsx`
- 대조 기준: `docs/planning/02-user-flows.md`(L-02 1.3a 이동 줄, S-10, S-44), `docs/ui/design-system.md` v5.3(3.6 C-06, 5.8, 5.9, 6장 A2)
- 변경 집합 확인: `git status --short` → 수정 2 + 미추적 1(+ `_workspace/ui/` 문서 2). `src/server/`·`src/app/api/`·`src/lib/contracts/`·`supabase/`·`docs/planning/`·`src/lib/data/`·`src/components/common/` **변경 없음**

## 요약 — Critical 0 / Major 0 / Minor 5

기계 검사 4개 모두 **통과**(lint·typecheck·test 2008개·build, 모두 exit 0) — 엔지니어 보고의 통과 주장은 사실이다.
핵심 동작 주장("URL이 아니라 `projectId`/`id` 상태를 따르므로 첫 저장 직후 새로 고침 없이 기존 행 표시로 바뀐다")도 **코드로 확인됐다**. 사용자가 보고한 증상(빈 화면이 기존 상세처럼 읽힘)은 이 변경으로 두 화면 모두에서 해소된다. 남은 것은 모두 문서 동기화·시각 확인·회귀 테스트 수준의 Minor다. **브라우저 확인은 하지 않았다**(로컬 로그인이 Google 전용) — 이 범위는 순수 표시 변경이라 시각 판정이 남아 있다.

### CR-11 충돌 판정 (명시 요청 사항) — **충돌 아님**

`docs/ui/design-system.md:739`(3.6 C-06)의 원문은 다음과 같다.

> (v5) **L-02 화면**(S-10·S-44)에서는 C-06 글자가 상단 바 `SaveButton` 바로 왼쪽에 있고, 버튼 상태와 짝을 이룬다(5.8 표). `status = 'draft'` 배지·Alert는 L-02에 두지 않는다(명세 CR-11: 완료·작성 중 표시 없음)

금지 대상은 **`status = 'draft'`에 딸린 배지와 그 짝 Alert**("작성 중 — 필수 항목을 채우면 AI 분석에 반영돼요")이며, L-02의 모든 `Alert`가 아니다. 근거: ① 같은 표의 바로 위 행이 `status = 'draft'` 행이고 인용문은 그 행을 가리킨다 ② design-system 5.8 배너 자리(1619줄)는 L-02에서 C-10 복귀 배너와 입력 보존 배너를 **`Alert variant="info"`로** 두라고 명시한다 — L-02에 Alert 자체가 금지라면 모순이다 ③ 새 행 안내는 저장된 행의 완료도 표시가 아니라 "행이 아직 없다"는 상태 안내다.
또 문구에 "작성 중"을 쓰지 않아 draft 배지 문구와 섞이지도 않는다(`new-row-notice.tsx:22-31`). 엔지니어의 `[UI-가정]`(`new-row-notice.tsx:12-14`) 해석을 **그대로 인정**한다. 다만 디자인 시스템에 이 패턴 자체가 적혀 있지 않은 것은 별개 문제다(UQ-331).

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | Q11 | Q12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S-10 새 프로젝트 (`/career/projects/new?experience=\|education=`) | ✅ | ⚠️ | — | ✅ | ✅ | — | ⚠️ | ✅ | ⚠️ | ✅ | 미확인 |
| S-10 프로젝트 상세 (`/career/projects/[id]`) — 모양 유지 | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-44 새 산출물 (`/career/projects/[id]/deliverables/new`) | ✅ | ⚠️ | — | ✅ | ✅ | — | ⚠️ | ✅ | ⚠️ | ✅ | 미확인 |
| S-44 산출물 상세 (`/career/deliverables/[id]`) — 모양 유지 | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | 미확인 |

- Q3–4(데이터 모델 ↔ `types/db.ts` ↔ 필드 사용): 이 변경은 필드·enum·타입을 한 글자도 건드리지 않아 "—". `isNew`는 기존 상태값(`projectId` / `id`)의 파생값일 뿐이고 행 타입에 UI 전용 필드를 더하지 않았다.
- Q7(AI 응답 모드): 패널·AI 경로 변경 없음 → "—". 단 첫 AI 메시지로 행이 생기는 경로(`savePage: () => doSaveRef.current()`, `project-page.tsx:378`)도 같은 `doSave`를 타므로 안내가 함께 사라지는 것은 확인했다.

### Q1 — 명세 행 대조 (변경이 닿은 행만)

| 명세 위치 | 명세 내용 | 코드 | 결과 |
|---|---|---|---|
| `02-user-flows.md:212` (L-02 1.3a 이동 줄) | S-10 "{회사명/기관명} › {프로젝트명} › 프로젝트 상세", S-44 "{프로젝트명} › {산출물 제목} › 산출물 상세". 비면 "새 프로젝트"·"새 산출물" `[가정]` | `project-page.tsx:489-496`, `deliverable-page.tsx:349-356` | ⚠️ 새 행에서 의도적으로 다르게 구현(사용자 결정) → 기획 Q1·Q3 |
| `02-user-flows.md:1361` (S-10 머리: 복귀 배너 "이동 줄 바로 아래") | C-10은 이동 줄 아래 | `project-page.tsx:497-522` `ShellBanners` — 변경 없음. 새 안내는 그 **아래** `DocHead` 안 | ✅ 순서 보존 |
| `02-user-flows.md:1362` (제목 = 프로젝트명 입력, 자리 표시 "프로젝트명을 입력해 주세요") | 그대로 | `project-page.tsx:529-540` 변경 없음 | ✅ |
| `02-user-flows.md:1363` (새 프로젝트 ⋯에는 "소속 변경"만) | 그대로 | `project-page.tsx:554` `projectId ? …` 변경 없음 | ✅ |
| `02-user-flows.md:1256` (S-44 새 산출물에는 ⋯ 메뉴를 보이지 않는다) | 그대로 | `deliverable-page.tsx:388` `id ? …` 변경 없음 | ✅ |
| `02-user-flows.md:1257` (S-44 안내 1줄 G-2) | 머리에 유지 | `deliverable-page.tsx` 머리, 제목 아래 — 변경 없음 | ✅ (새 안내와 **별개 블록**으로 공존) |
| `02-user-flows.md:1344` (새 프로젝트: 머리 제목에 포커스) | 그대로 | `project-page.tsx:234` `if (!data.project_id) return titleRef.current?.focus()`, `deliverable-page.tsx:382` `autoFocus={!data.project_deliverable_id}` — 변경 없음 | ✅ (단 UQ-333) |

### Q6 — `?state=` 미리보기 커버리지 (양방향 확인)

엔지니어 주장을 데이터 계층에서 직접 확인했다.

- `src/lib/data/career-v45.ts:249` `getNewProjectPage` → `project_id: null`이 `build()` 안에 **상수**로 들어가고 mock·real 두 분기가 모두 같은 `build()`를 쓴다 → 새 프로젝트 라우트는 **모든** preview state에서 안내가 보인다.
- `src/lib/data/career-v45.ts:342` `getNewDeliverablePage` → 같은 구조로 `project_deliverable_id: null`.
- 반대 방향: `career-v45.ts:197` `project_id: id`, `:300` `project_deliverable_id: id` — 기존 행 로더는 `not-found` / `standalone` / `affiliated-parent` / `empty` 등 어떤 preview state에서도 ID를 라우트 파라미터로 채운다 → 기존 행 화면에 안내가 새는 경로 **없음**.
- 데이터 계층 변경이 필요 없었다는 주장도 사실이다(`git status`로 확인).

### 상태 전환 — stale URL / stale prop 경로 점검 (요청 사항)

**결론: 끊긴 경로 없음.** 근거:

1. `project-page.tsx:468` `const isNew = !projectId` — `projectId`는 `useState(data.project_id)`(172줄) 상태다.
2. `project-page.tsx:328` 저장 성공 시 `setProjectId(r.project_id)` → 같은 렌더에서 `isNew`가 false.
3. `project-page.tsx:247-252` `replaceUrl`은 **`window.history.replaceState`**다(Next 라우터 내비게이션이 아님). 즉 첫 저장 뒤에도 컴포넌트는 마운트된 채이고 `data.project_id`는 영원히 `null`로 남는다 — **URL이나 `data.project_id`를 봤다면 안내가 계속 떠 있는 버그가 됐을 자리**다. 상태를 고른 판단이 정확하다.
4. 409 `stale_write`로 행이 이미 만들어진 분기(`project-page.tsx:281-283`)도 `setProjectId(r.error.created.project_id)`를 거치므로 안내가 사라진다.
5. `deliverable-page.tsx:341` `isNew = !id` ← `useState(data.project_deliverable_id)`(73줄), 저장 성공 시 `setId(r.project_deliverable_id)`(211줄). 같은 구조.
6. 역방향(기존 행에 안내가 뜨는 경로): `/career/projects/[id]`·`/career/deliverables/[id]`는 로더가 ID를 항상 채우므로(위 Q6) `isNew`가 true가 될 수 없다. 이름·제목을 모두 지워도 `isNew`는 false다.

### 겹침·레이아웃 (요청 사항)

- 안내는 `DocHead`(= `OverflowScroller max-h-[40%]`, `shell/doc-body.tsx:44-50`)의 **첫 자식**이고 `ShellBanners`(`page-shell.tsx:669-675`)는 손대지 않았다. 따라서 C-10 복귀 배너·관련 요건(`requirementNotice`)·입력 보존 배너·페이지 오류 Alert와 **같은 상자를 쓰지 않는다**. 배너 자리의 순서·개수 불변(`project-page.tsx:497-522`).
- design-system 5.9 세로 구성(1636-1640줄) 순서 ①크럼+배너 ②머리 ③구분선 ④2단은 그대로 유지된다. 안내는 ②의 내부 맨 위에 들어간다.
- `max-h-[40%]` + `min-h-[50%]`(UQ-SC-1) 규칙: 안내가 머리 내용 높이를 ~56px 늘리므로 낮은 창에서 머리가 더 일찍 자기 상자 안 스크롤로 넘어간다. 창이 스크롤되는 일은 없고(규칙 위반 아님) `OverflowScroller`가 흐림+`role="region"`을 켜 준다 → 규칙 안. 다만 UQ-333 참고.

### Q8 토큰 적합성

- 하드코딩 색·`rgb()`·팔레트 클래스 **0건**(3파일 grep).
- `Alert variant="info"`는 `components/ui/alert.tsx:15`의 기존 variant를 그대로 쓴다(`border-info/20 bg-info-subtle text-info-subtle-foreground`). 사용처에서 svg를 따로 칠하지 않아 3.20(UQ-712) "variant가 아이콘 색을 가진다" 규칙을 지킨다.
- 일회성 간격 없음(`space-y-*`는 `DocHead` 쪽이 그대로 담당).
- `border-dashed`는 저장소 안에서 "빈 자리·미확정"을 뜻하는 기존 관습이다(design-system 1432·1834줄, `ai-lock.tsx:148`, `panel-input.tsx:40`) → 의미상 맞다. 다만 UQ-332.

### Q9 접근성

- `role="note"`: `Alert`는 `role="alert"`를 먼저 쓰고 `{...props}`를 뒤에 펼치므로(`alert.tsx:33-38`) `role="note"`가 **실제로 덮어쓴다**. 화면을 열 때 즉시 끼어드는 알림이 되지 않아 판단이 옳다(정적 안내).
- `FilePlus2 aria-hidden` — 장식 아이콘 처리 정확.
- 초기 포커스는 제목 입력 그대로(제목 앞에 **포커스 가능한 요소를 추가하지 않았다**) → 새 페이지의 포커스 순서가 바뀌지 않는다. 안내 안에 버튼·링크가 없어 저장 성공으로 안내가 사라질 때 포커스 유실도 없다.
- 안내가 제목 입력보다 DOM 앞에 있어 스크린 리더 읽기 순서상 "아직 추가되지 않았어요"가 제목보다 먼저 온다 — 의도에 맞다.
- 다이얼로그·포커스 트랩 관련 변경 없음.

### Q10 좁은 화면

- `<1024`에서 `CrumbRow`의 Breadcrumb는 `max-lg:hidden`(`page-shell.tsx:543`)이고 "← {상위 이름}"만 남는다 → **크럼 문구 변경은 좁은 화면에 아무 효과가 없다**. 엔지니어 보고가 이 점을 정확히 적었다. 좁은 화면에서 "추가 중"을 알리는 신호는 머리 안내 하나뿐이고, 그 안내에는 반응형으로 숨기는 클래스가 없어 보인다 → 좁은 화면에서도 목적 달성.
- `<768` 머리 패딩 `px-4`(`doc-body.tsx:45`)은 그대로. 안내는 전체 폭 블록이라 추가 규칙이 필요 없다.
- ⚠️ 표로 둔 이유: 좁은 화면 + 낮은 높이 조합에서의 실제 모습은 브라우저로 보지 못했다(UQ-333과 같은 미확인).

### Q11 데이터 계층 ↔ 백엔드

- 두 화면 모두 `src/lib/data/*`만 쓰고 이번 변경은 데이터 호출을 하나도 더하거나 바꾸지 않았다.
- `previewOr` 구조·`연결 대기` 표식 변경 없음. `mock-isolation.test.ts`를 포함한 129개 테스트 파일 전체 통과.
- `src/server/`·`src/app/api/`·`src/lib/contracts/`·`supabase/`·`docs/planning/` **무변경** 확인(`git status --short`). 백엔드 요청 없음이 맞다.

## 브라우저 확인

**하지 않았다.** 이 런의 로컬 사인인은 Google 전용이어서 테스트 계정으로 들어갈 수 없다. SSR HTML이나 `curl`로 대신하지 않았다 — 즉 **네 화면 모두 눈으로 본 적이 없다**. 아래는 전부 코드 경로 독해 결과다.

| 화면 | 미확인으로 남은 것 |
|---|---|
| S-10 새 프로젝트 | 안내 블록의 실제 대비·점선 가시성, "+ 프로젝트 추가 → 저장하기 → 안내 사라짐 + '저장됨 HH:MM'" 전환 눈 확인, 낮은 창에서 머리 스크롤 모습 |
| S-44 새 산출물 | 같음 + 새 안내와 G-2 안내 두 블록이 한 머리에 쌓인 모습 |
| S-10·S-44 기존 행 | "모양이 그대로인지"의 시각 확인(코드상 분기는 확인됨) |

리더는 네 화면을 `QA 통과 (mock·브라우저 미확인)`로 기록해야 한다.

## 이슈 (결함)

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|---|---|---|---|---|---|---|---|
| UQ-331 | Minor | ui-designer | S-10·S-44 | `docs/ui/design-system.md:1845` "새 프로젝트(`/career/projects/new?…`)는 **같은 화면의 빈 상태다** — 제목 입력에 포커스, ⋯에는 '소속 변경'만, 패널은 시작 영역…"; 5.8(1574~)·5.9 머리 규칙에 새 행 안내 블록 항목 없음 | `src/components/career/new-row-notice.tsx:43-51`, `project-page.tsx:528`, `deliverable-page.tsx:374` | 디자인 시스템이 L-02 새 행 안내 패턴(어느 자리, 어느 variant, 점선 여부, 기존 행과의 구분 방법)을 한 줄로 정하고, 6장 A2 S-10·S-44 항목의 "같은 화면의 빈 상태" 서술을 갱신 | 코드에만 있는 패턴. 다른 L-02 화면이 같은 표시를 필요로 할 때 각자 다르게 만들 여지가 남는다 |
| UQ-332 | Minor | ui-designer | S-10·S-44 | `docs/ui/design-system.md:1432`·`:1834`, `ai-lock.tsx:148`·`panel-input.tsx:40` — 기존 점선은 모두 `border-dashed border-input` + 투명/카드 바탕과 짝 | `new-row-notice.tsx:46` `<Alert role="note" variant="info" className="border-dashed">` (variant 테두리 = `border-info/20`, `alert.tsx:15`) | 점선이 "기존 행 화면과 눈에 띄게 구분"이라는 역할을 실제로 하려면 테두리 대비가 보여야 한다 — 점선 유지 시 테두리 알파를 올리거나(`border-info/40` 등), 아니면 점선을 빼고 `info` 바탕만으로 구분 | 20% 알파 테두리에 점선을 얹어, 점선이 거의 보이지 않거나 렌더링 결함처럼 읽힐 수 있다. 구분은 사실상 `bg-info-subtle` 하나에 걸려 있다. **브라우저 미확인이라 시각 판정은 담당자 몫** |
| UQ-333 | Minor | frontend-engineer (A2) | S-10·S-44 새 행 | `docs/ui/design-system.md:1641-1643`(머리 `max-h-[40%]`, 넘치면 머리만 자기 안에서 스크롤 — UQ-SC-1), `02-user-flows.md:1344`(새 프로젝트는 머리 제목에 포커스) | 안내가 `DocHead` 첫 자식(`project-page.tsx:528`, `deliverable-page.tsx:374`) + 초기 포커스가 제목 입력(`project-page.tsx:234`, `deliverable-page.tsx:382` `autoFocus`) | 낮은 창에서도 화면을 열었을 때 "아직 추가되지 않았어요"가 보여야 한다(이 변경의 목적 자체) | 머리가 상한을 넘으면 머리 상자가 스크롤 상자가 되고, 제목 입력에 포커스가 가면서 브라우저 기본 scroll-into-view가 상자를 내려 **안내가 상자 밖으로 밀릴 수 있다**. 낮은 창(창 ~600px, design-system 1642줄의 재현 조건)에서 실제로 밀리는지 확인하고, 밀리면 안내를 제목 아래로 내리거나 상자 안 스크롤 위치를 0으로 유지할 것. 공통 파일(`ShellBanners` 자리로 옮기기)이 필요하면 영역 규칙상 리더·파운데이션 경유 |
| UQ-334 | Minor | frontend-engineer (A2) | S-10·S-44 | 검증 기준(ui-context "Verification standard") | 테스트 없음 — `grep`으로 `NewRowNotice`·"새 프로젝트 추가"·"아직 추가되지"를 참조하는 테스트 파일 0건(테스트 2008개 중 이 변경을 덮는 것 없음) | 적어도 ① 새 페이지에서 안내·"새 프로젝트 추가" 크럼이 보인다 ② 첫 저장 성공 직후 둘 다 사라지고 기존 행 표시가 된다 ③ 기존 행 라우트에서는 어떤 `?state=`에서도 보이지 않는다 — 세 가지 회귀 테스트 | 테스트가 없어, 나중에 누가 `isNew`를 `data.project_id`나 URL 기준으로 "정리"하면(바로 이 런이 피한 그 실수) 아무 것도 깨지지 않고 통과한다. 브라우저 확인도 못 한 변경이라 유일한 안전망이 비어 있다 |
| UQ-335 | Minor | frontend-engineer (A2) | S-10·S-44 | — (코드 정리) | `new-row-notice.tsx:33-37` `CRUMB_CURRENT` (`project.existing = "프로젝트 상세"`, `deliverable.existing = "산출물 상세"`) | 모듈 이름과 내용이 맞아야 한다 — 기존 행 크럼 문구까지 "새 행 안내" 파일에 두면 찾기 어렵다 | 기존 행 문구가 `new-row-notice.tsx`에 산다. 파일을 `new-row-affordance.tsx`로 부르거나 `CRUMB_CURRENT`를 크럼 문구 전용 위치로 옮기는 것이 맞다(기능 영향 없음) |

## 기획 확인 필요

엔지니어 보고의 4개 질문은 모두 타당하다. 중복을 합치고 양쪽을 인용해 다시 적는다.

**P-331. 새 행의 이동 줄 현재 위치 문구** — 명세에 반영할지.
- 명세: `02-user-flows.md:212` "S-10 '{회사명 / 기관명} › {프로젝트명} › 프로젝트 상세', S-44 '{프로젝트명} › {산출물 제목} › 산출물 상세'"; `:1335`(S-10 "←") "이동 경로의 프로젝트명은 입력 중인 이름을 따라가고, 비어 있으면 '새 프로젝트' `[가정]`"
- 코드: `project-page.tsx:495` / `deliverable-page.tsx:356` — 행이 없으면 현재 위치가 "새 프로젝트 추가" / "새 산출물 추가"
- 두 명세 문장 모두 `[가정]`이고, 사용자 결정(2026-11-04: "표시만 '새 프로젝트/새 산출물 추가'답게")이 이 변경을 지시했다. 명세 쪽을 고치는 것이 맞아 보이지만 `resumate-planning`이 판단할 일이다.

**P-332. 이름·제목이 빈 새 행에서 자리 표시 칸을 빼는 것** — 맞는지.
- 명세: 같은 위치, "비어 있으면 '새 프로젝트'"
- 코드: `project-page.tsx:493` / `deliverable-page.tsx:354` — `isNew && isBlank(...)`면 칸 자체를 뺀다
- 빼지 않으면 "{경력명} › 새 프로젝트 › 새 프로젝트 추가"로 같은 말이 두 번 나온다. 기존 행에서 이름을 모두 지운 경우에는 자리 표시가 그대로 남는다(명세 유지).

**P-333. 머리 안내 블록과 문구를 S-10·S-44 머리 표에 정식 행으로 넣을지, 넣는다면 확정 문구.**
- 명세: S-10 머리 표(`02-user-flows.md:1360-1369`), S-44 머리·본문 표(`:1255-1261`) — 그런 행이 없다
- 코드 문구(둘 다 명세 없는 신규): 제목 "아직 추가되지 않았어요" / 본문 `새 프로젝트를 쓰는 중이에요. 위 "저장하기"를 누르면 이 프로젝트가 커리어에 추가돼요` · `새 산출물을 쓰는 중이에요. 위 "저장하기"를 누르면 이 산출물이 프로젝트에 추가돼요`(`new-row-notice.tsx:22-31`)
- QA 의견(문구 품질): 뜻은 정확하고 해요체·C-06 문구와의 충돌도 없다(저장 전에는 `savedAt`이 없어 "저장됨"이 함께 보일 수 없음 — `project-page.tsx:469` `uiState` 계산으로 확인). 다만 **"프로젝트를 쓰는 중"** 은 산출물에는 자연스럽고 프로젝트에는 덜 자연스럽다("새 프로젝트를 쓰는 중" → "새 프로젝트를 작성하는 중" / "새 프로젝트를 추가하는 중"). 확정 문구를 정할 때 함께 봐 달라.

**P-334. 첫 저장 성공 뒤 "추가됐어요" 확인을 둘지.**
- 사용자 원래 불만은 "추가되지 않았다고 읽힌다"였다. 저장 전 안내는 이제 있지만, **저장 성공 순간의 확인은 C-06 "저장됨 HH:MM" 하나**다(`02-user-flows.md:1341`). 안내가 사라지는 것 말고 "커리어에 추가됐어요" 같은 토스트·문구는 명세에 없다.
- 33 런 브리프 요구에는 없던 항목이라 코드 결함으로 잡지 않았다. 추가 확인이 필요한지 사용자에게 물을 가치가 있다.

**P-335(디자이너).** 새 행 안내가 CR-11과 충돌하지 않는다는 판정은 위 "CR-11 충돌 판정"에서 QA가 내렸다(충돌 아님). 디자이너에게 남는 것은 **패턴을 문서화하는 일**이며, 그것은 결함 UQ-331·UQ-332로 올렸다 — 기획 질문이 아니다.

## 재확인 결과

이전 라운드 없음(이 범위 첫 리뷰). `UQ-331`~`UQ-335`는 이후 라운드에서 재사용하지 않는다.

## 기계 검사 출력

QA가 직접 실행했다(워크트리 `/Users/jehyun/Resumate/.claude/worktrees/project-add-button-bug-76d58e`).

| 명령 | 결과 | 출력 |
|---|---|---|
| `pnpm lint` | ✅ 통과 (exit 0) | `$ eslint` — 출력 없음 |
| `pnpm typecheck` | ✅ 통과 (exit 0) | `next typegen` → `✓ Types generated successfully`, `tsc --noEmit` 오류 없음 |
| `pnpm test` | ✅ 통과 (exit 0) | Vitest v5.0.5 — `Test Files 129 passed (129)`, `Tests 2008 passed (2008)`, 37.95s |
| `pnpm build` | ✅ 통과 (exit 0) | 라우트 매니페스트 정상, 오류·경고 없음 |

엔지니어 보고의 "4개 모두 통과" 주장은 **사실로 확인**. 단 테스트 2008개 중 이번 변경을 덮는 것은 0개다(UQ-334).
