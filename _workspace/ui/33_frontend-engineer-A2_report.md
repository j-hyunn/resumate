# A2 커리어 구현 보고 — 새 프로젝트·새 산출물 "추가 중" 표시 (33 런)

- 날짜: 2026-11-04
- 범위: 표시 전용. 화면 전환 구조·첫 저장 때 행 생성(PA-3)·데이터 계층·서버 파일은 건드리지 않았다.

## 완료 화면

| 화면 ID | 라우트 | 지원 `?state=` | 비고 |
|---|---|---|---|
| S-10 새 프로젝트 | `/career/projects/new?experience={id}` · `?education={id}` | 기존 그대로(변경 없음) | 이동 줄 현재 위치 + 머리 안내 추가 |
| S-10 프로젝트 상세 | `/career/projects/{id}` | 기존 그대로 | **모양 유지** (안내 없음, "프로젝트 상세") |
| S-44 새 산출물 | `/career/projects/{project_id}/deliverables/new` | 기존 그대로 | 이동 줄 현재 위치 + 머리 안내 추가 |
| S-44 산출물 상세 | `/career/deliverables/{id}` | 기존 그대로 | **모양 유지** (안내 없음, "산출물 상세") |

## 파일별 변경

### `src/components/career/new-row-notice.tsx` (신설, A2 영역)
- `NewRowNotice({ kind: "project" | "deliverable" })`: 머리 맨 위 안내. `Alert variant="info"` + `border-dashed` + `FilePlus2`, `role="note"`(정적 안내라 `alert`의 즉시 알림을 쓰지 않음). 색은 전부 토큰(`info` variant)이고 하드코딩 색·일회성 간격 없음.
- `CRUMB_CURRENT`: 이동 줄 현재 위치 문구 표(새 행 / 기존 행)를 한 곳에 모아 두 화면이 같은 문구 규칙을 쓰게 했다.

### `src/components/career/project-page/project-page.tsx`
- `isNew = !projectId` 파생값 추가(“derived” 블록). **URL이 아니라 `projectId` 상태를 따른다** — `doSave` 성공 시 `setProjectId(r.project_id)` + `replaceUrl(...)`가 돌면 같은 렌더에서 기존 행 표시로 바뀌고, 새로 고침이 필요 없다. 첫 AI 메시지로 행이 생기는 경로(`savePage` → 같은 `doSave`)도 동일.
- `CrumbRow`: `current`를 `isNew ? "새 프로젝트 추가" : "프로젝트 상세"`로. 행이 없고 이름도 비었으면 `{label: values.name, placeholder: "새 프로젝트"}` 칸을 목록에서 뺀다(중복 방지).
- `DocHead` 첫 자식으로 `{isNew ? <NewRowNotice kind="project" /> : null}`.
- 머리 주석 1줄 보강.

### `src/components/career/deliverable/deliverable-page.tsx`
- `isNew = !id`(행 ID 상태) 파생값 추가. 첫 저장 성공 시 `setId(...)`로 바로 기존 행 표시로 전환.
- `CrumbRow`: `current`를 `isNew ? "새 산출물 추가" : "산출물 상세"`로, 빈 제목일 때 자리 표시 칸 제거.
- `DocHead` 첫 자식으로 `{isNew ? <NewRowNotice kind="deliverable" /> : null}`.
- 머리 주석 1줄 보강.

데이터 계층·서버·공통(`src/components/common/`)·기획 문서 변경 **없음**. 공통 파일은 한 줄도 건드리지 않았다.

## 이동 줄 문구 (before → after)

| 상황 | before | after |
|---|---|---|
| S-10 새 프로젝트, 이름 비었음 | `{경력명} › 새 프로젝트 › 프로젝트 상세` | `{경력명} › 새 프로젝트 추가` |
| S-10 새 프로젝트, 이름 입력함 | `{경력명} › {이름} › 프로젝트 상세` | `{경력명} › {이름} › 새 프로젝트 추가` |
| S-10 기존 행 | `{경력명} › {이름} › 프로젝트 상세` | (동일) |
| S-44 새 산출물, 제목 비었음 | `{프로젝트명} › 새 산출물 › 산출물 상세` | `{프로젝트명} › 새 산출물 추가` |
| S-44 새 산출물, 제목 입력함 | `{프로젝트명} › {제목} › 산출물 상세` | `{프로젝트명} › {제목} › 새 산출물 추가` |
| S-44 기존 행 | `{프로젝트명} › {제목} › 산출물 상세` | (동일) |

좁은 화면(<1024)의 이동 줄은 "← {상위 이름}"만 보이는 기존 규칙 그대로다(변경 없음) — 좁은 화면에서는 머리 안내가 "추가 중"을 알리는 유일한 신호가 된다.

## 머리 안내 문구 (신규)

| 화면 | 제목 | 본문 |
|---|---|---|
| S-10 새 프로젝트 | 아직 추가되지 않았어요 | 새 프로젝트를 쓰는 중이에요. 위 "저장하기"를 누르면 이 프로젝트가 커리어에 추가돼요 |
| S-44 새 산출물 | 아직 추가되지 않았어요 | 새 산출물을 쓰는 중이에요. 위 "저장하기"를 누르면 이 산출물이 프로젝트에 추가돼요 |

- 저장 버튼 상태 문구와의 정합: `SaveButton` 라벨은 항상 "저장하기", `SaveStatusText`는 `savedAt`이 없으면 아무것도 쓰지 않으므로(C-06) 새 페이지에서 "저장됨"과 동시에 보일 수 없다. 저장 성공 순간 `isNew`가 false가 되어 안내가 사라지고 그 자리에 "저장됨 HH:MM"이 생긴다 — 모순 없음.
- 문구에 "작성 중"을 쓰지 않았다: design-system 5.8/CR-11의 `draft` "작성 중" 배지와 섞이지 않게.

## 새 화면 ↔ 기존 화면 구분 방법

1. 이동 줄 현재 위치 문구가 다르다("… 추가" vs "… 상세").
2. 새 화면 머리 맨 위에만 점선 테두리 `info` 톤 안내 블록이 있다(기존 행에는 없음) — 토큰만 사용(`border-info/20 bg-info-subtle text-info-subtle-foreground` + `border-dashed`).
3. 기존 행에만 있는 것은 그대로 유지: ⋯ 메뉴의 "프로젝트 삭제"/"산출물 삭제"(행 없으면 숨김), C-06 "저장됨 HH:MM".

## 배너 겹침·`?state=` 확인

- 안내는 `ShellBanners`가 아니라 `DocHead` 안에 있어서 C-10 복귀 배너·관련 요건 배너·입력 보존 배너와 같은 자리를 쓰지 않는다. 배너 자리의 순서·개수는 손대지 않았다.
- `DocHead`는 `max-h-[40%]` + `OverflowScroller`라 안내가 한 줄 늘어도 머리가 넘치지 않고 기존 스크롤 규칙을 따른다.
- `?state=`: `getNewProjectPage` / 새 산출물 읽기는 어떤 preview state에서도 `project_id` / `project_deliverable_id`를 `null`로 주므로 모든 미리보기에서 안내가 보이고, 기존 행 라우트(`/career/projects/[id]`, `/career/deliverables/[id]`)에서는 어떤 state에서도 보이지 않는다. 데이터 계층 변경이 필요 없었다(파운데이션 요청 없음).

## [UI-가정]

| 화면 ID | 파일:줄 | 내용 |
|---|---|---|
| S-10·S-44 | `src/components/career/new-row-notice.tsx:9-18` | 머리 안내 블록 자체가 명세에 없다. 모양은 `Alert variant="info"` + 점선 테두리로 두었다 |
| S-10·S-44 | `src/components/career/new-row-notice.tsx:22-33` | 안내 문구(제목·본문) 전부 명세에 없는 신규 문구 |
| S-10·S-44 | `new-row-notice.tsx:15-18` | design-system 5.8 "L-02에 `draft` 배지·Alert를 두지 않는다"(CR-11)는 **저장된 행의 완료/작성 중 표시**를 뜻하므로 저장 전 새 행 안내는 금지 대상이 아니라고 해석했다 |
| S-10 | `project-page.tsx` CrumbRow | 명세 1.3a는 이동 줄 현재 위치를 "프로젝트 상세"로 고정하고 빈 이름은 "새 프로젝트" 자리 표시로 적는다. 새 행에서는 현재 위치를 "새 프로젝트 추가"로 바꾸고 빈 자리 표시 칸을 뺐다 |
| S-44 | `deliverable-page.tsx` CrumbRow | 위와 같음("새 산출물 추가") |

## 기획 확인 필요

| 화면 ID | 질문 | 스펙 위치 |
|---|---|---|
| S-10·S-44 | 이동 줄 현재 위치를 새 행에서 "새 프로젝트 추가"·"새 산출물 추가"로 바꾸는 것을 명세에 반영할지 (현 명세는 "프로젝트 상세"·"산출물 상세" 고정 + 빈 이름 자리 표시 "새 프로젝트"·"새 산출물") | `docs/planning/02-user-flows.md` L-02 1.3a 이동 줄 표(212줄), S-10 "←" 항목, S-44 레이아웃 항목 |
| S-10·S-44 | 머리 안내 블록과 문구를 머리 표에 정식 행으로 넣을지, 넣는다면 확정 문구 | S-10 머리 표 / S-44 머리·본문 표 |
| S-10·S-44 | 빈 이름일 때 이동 줄에서 "새 프로젝트"·"새 산출물" 자리 표시를 빼는 것이 맞는지(현재 위치 문구와 중복) | 같은 위치 |
| S-10·S-44 | 새 행 안내가 design-system CR-11의 "L-02에 완료·작성 중 표시 없음"과 충돌하지 않는지 디자이너 확인 | `docs/ui/design-system.md` 5.8 (729줄) |

## 파운데이션 요청

없음. 공통 컴포넌트(`src/components/common/`)·타입·데이터 계층·`lib/routes.ts`를 수정하지 않았다. `CrumbRow`의 `current` prop이 이미 문자열이고 `items`가 배열이라 공통 수정 없이 끝났다.

> 다만 다른 L-02 화면이 같은 "새 행" 표시를 필요로 하게 되면 `new-row-notice.tsx`를 `components/common/`으로 올리는 것이 맞다(지금은 A2 전용이라 영역 폴더에 두었다).

## 백엔드 요청

없음(표시 전용, 데이터 함수·계약 변경 없음).

## 검사 결과

| 명령 | 결과 |
|---|---|
| `pnpm lint` | 통과 (출력 없음) |
| `pnpm typecheck` | 통과 (`next typegen` → "Types generated successfully", `tsc --noEmit` 오류 없음) |
| `pnpm test` | 통과 — Test Files 129 passed (129), Tests 2008 passed (2008) |
| `pnpm build` | 통과 (라우트 매니페스트 정상 출력, 오류 없음) |

- **브라우저 확인: 하지 않았다.** 이 런에서는 dev 서버를 띄우거나 화면을 클릭해 보지 않았다. 코드·타입·테스트·빌드만 확인했다. `?state=` 미리보기와 "+ 프로젝트 추가 → 저장하기 → 기존 행 표시로 전환"의 실제 눈 확인은 ui-qa 또는 후속 브라우저 패스에서 필요하다.
