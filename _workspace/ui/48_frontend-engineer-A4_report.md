# 48 런 A4 보고 — S-39 지원 현황 보드 (자기소개서 흐름 재설계)

- 날짜: 2026-11-09 · 담당: frontend-engineer (A4) · 워크트리 `cover-letter-ui-469976`
- 기준 판: PRD v4.17 (F-ST-01~05) · 플로우 **v5.20** S-39(1772~) · 데이터 모델 v4.15 · 디자인 시스템 **v5.15**(5.5 보드 · 6장 A4)
- 정본 지시: `docs/planning/decisions.md` **4.23 UI 5** + 4.21(RM-1~RM-5)
- 범위: 보드 화면과 보드 뷰 모델만. `src/components/applications/`·`applications/` 라우트는 A3 몫이라 건드리지 않았다.
- 커밋하지 않았다 (리더가 한다).

## 1. 고친 것

| 파일 | 무엇 |
|---|---|
| `src/components/board/kanban-board.tsx` | 카드 3행의 **서류 초안 수(`FileText` + `card.draft_count`) 삭제** → **`CoverLetterBadge`**(배지 하나, 숫자 없음). `SlotCountMap`/`CoverLetterLabelMap` prop 추가. 주석의 S-31 흔적 정리 |
| `src/app/(dashboard)/(gated)/board/page.tsx` | `listCoverLetterSlotCounts()` 읽어 `coverLetterProgressLabel()`로 **서버에서 판정**해 `coverLetterLabels` map으로 넘긴다. `?state=cl-pending` 추가 |
| `src/components/common/dev-state-gallery-v53.tsx` | S-39 미리보기 링크 2줄 추가(`?state=cl-pending`, "지원 전 + → 추가 모달" 경로) |
| `src/components/board/card-progress.test.ts` (신설) | 배지 판정 경계 5건 |

카드 본문 클릭 → `routes.coverLetter(card.id)`(S-46)와 카드 메뉴 "자기소개서 열기"는 A0이 이미 바꿔 둔 상태여서 그대로 확인만 했다. 폐기된 S-31로 가는 링크는 보드에 남아 있지 않다.

## 2. 카드 표시 규칙 구현 방식 (UI 5 · CF-3 · PRD F-ST-01 · R-CF-21)

- 원천: `listCoverLetterSlotCounts()` → `{application_project_id: {slot_count, filled_slot_count}}` (A0, 연결 대기).
- 판정은 A0의 `coverLetterProgressLabel()` 하나로만 한다: 행 없음 / `slot_count = 0` / `filled_slot_count = 0` → **표시 없음**, `0 < filled < slot` → **"자소서 작성 중"**(`Badge variant="draft"` + `CircleDashed size-3`), `filled = slot` → **"자소서 작성됨"**(`Badge variant="success"` + `Check size-3`). **숫자·분수(`2/3`)는 그리지 않는다.**
- **판정을 서버 컴포넌트에서 한다** — `src/lib/data/cover-letters.ts`는 `import "server-only"`여서 클라이언트 보드 파일에서 부르면 `pnpm build`가 깨진다(실제로 한 번 깨졌다). 그래서 페이지가 라벨 map(`Record<id, "자소서 작성 중" | "자소서 작성됨">`)을 만들어 넘기고, 클라이언트는 글자만 그린다. 라벨이 없는 카드는 키가 없다 → 배지 없음.
- **real 분기가 아직 없다.** `listCoverLetterSlotCounts()`는 real에서 `wiring_pending`(503)을 던지므로 페이지가 `try/catch`로 받아 **빈 map**으로 떨어뜨린다 → 배지만 접히고 보드는 정상 동작한다(곁가지 표시라 보드 전체를 ST-ERROR로 내리지 않았다, `[UI-가정] 1`).
- 인사이트 표시(`Lightbulb` + `AiFeatureStatus` 줄)는 **유지**했다. 면접 횟수는 되살리지 않았다(RM-1). 4열(지원 전 / 서류 / 과제 / 종료)·C-12·C-13·결과 배지·드래그·좁은 화면 열 탭은 그대로다.
- `ApplicationSummary.draft_count`는 **보드에서 더 쓰지 않는다**(필드는 파운데이션 소유라 지우지 않았다 — A0 보고 7절 ⑨).

## 3. "지원 전 +" 경로

- 넓은 화면 열 머리 `Plus`(`aria-label="자기소개서 추가"`)와 좁은 화면 지원 전 탭의 "자기소개서 추가" 버튼 모두 **`routes.applicationNew({ from: "board" })` = `/applications?new=1&from=board`**로 간다(A0이 정한 주소). 브라우저에서 두 링크 모두 그 주소로 렌더되는 것을 확인했다.
- **A3의 `AddApplicationDialog`가 아직 없다**(`_workspace/ui/47_frontend-engineer-A3_report.md` 없음). 그래서 지금은 "목록으로 이동해 모달이 열리는 주소"라는 최소 동작 경로다. `/applications?new=1&state=default`는 200으로 뜨지만 모달은 아직 안 열린다(A3 대기).
- 명세(디자인 시스템 5.5 · 6장 A4)는 **보드 위에 모달을 띄우고 생성 뒤 보드에 남아 "열기" 토스트**다. 그건 `AddApplicationDialog`가 들어온 뒤 보드에서 직접 렌더해야 한다 — 5절 "A3·파운데이션 요청" ①.

## 4. 쓴 `?state=` 키 (`/board`)

| 키 | 보이는 것 |
|---|---|
| (없음 / 아무 값) | mock 픽스처 그대로 — ap1 **"자소서 작성 중"**, ap2 **"자소서 작성됨"**, ap3~8 **표시 없음**(정본 행 없음). 세 경우가 한 화면에 다 나온다 |
| `loading` | 열 4개 스켈레톤 |
| `error` · `unauth` | ST-ERROR |
| `empty` | ST-EMPTY(아이콘 `KanbanSquare`) + [자기소개서 추가] · [자기소개서 관리로] |
| `move-failed` | 모든 이동 실패 → 원위치 + 토스트(ST-MOVE-FAILED) |
| **`cl-pending`** (신설) | 자소서 수 조회가 연결 대기일 때 — **배지 하나도 없음**. real 분기가 들어오기 전 실제 화면 모양 |

`/dev/states?state=cover-letter` 섹션에 `cl-pending`과 "지원 전 + → 추가 모달" 링크를 더했다.

## 5. `[UI-가정]`

| # | 가정 | 자리 |
|---|---|---|
| 1 | 자소서 수 조회가 실패하면 **배지만 접고** 보드는 그대로 보인다(곁가지 표시라 화면 전체를 오류로 내리지 않는다) | `board/page.tsx readCoverLetterLabels()` |
| 2 | 배지 아이콘은 `CircleDashed`(작성 중) / `Check`(작성됨) `size-3`, 글자 뒤가 아니라 앞 — 디자인 시스템 5.5 표기 그대로 | `kanban-board.tsx CoverLetterBadge` |
| 3 | 배지는 3행의 **마지막**(결과 배지 → D-day → 인사이트 → 자소서 순). 명세가 3행 안 순서를 못 박지 않았다 | 같음 |
| 4 | `?state=cl-pending` 키 이름 | `board/page.tsx` |
| 5 | 배지에 `sr-only` 보조 설명을 붙이지 않았다 — 배지 글자 자체가 상태 문장이라 중복 낭독이 된다 | `CoverLetterBadge` |

## 6. 기획 확인 필요

**없다.** 이번 범위(카드 표시 규칙·목적지·"+" 경로)는 플로우 v5.20 S-39 표와 decisions 4.23 UI 5, 디자인 시스템 5.5가 값까지 정해 두었다.

## 7. 백엔드 요청

1. **`listCoverLetterSlotCounts()` real 분기** — `application_documents`의 `slot_count`(생성 컬럼)·`filled_slot_count`를 `application_project_id`별로 돌려주는 조회(DM 2.7.3). 지금은 `wiring_pending`이라 **실제 보드에 배지가 하나도 보이지 않는다**(A0 보고 백엔드 요청 ②와 같은 건). 이름·시그니처는 그대로 두면 화면 수정 없이 붙는다.
2. `ApplicationSummary.draft_count`(real 분기 `item.progress.draftCount`)는 **보드가 마지막 사용처였다** — 이제 UI에 쓰는 곳이 없으니 응답에서 빼도 된다(A0 보고 ⑨ 확인).

## 8. A3·파운데이션 요청

1. **A3** — `AddApplicationDialog`(5.6.2)가 들어오면 알려 주면 보드에서 **제자리로 띄우도록** 바꾼다(생성 뒤 보드에 남고 "열기" 토스트 → S-46). 그때까지는 `/applications?new=1&from=board` 이동이다. 모달이 `from=board`를 읽어 ② 주 버튼 라벨을 **"추가하기"**로 바꾸고 생성 뒤 이동하지 않는 처리는 A3 쪽 규칙(디자인 시스템 5.6.2)이다.
2. **파운데이션** — `coverLetterProgressLabel()`·`filledSlotCount()` 같은 **순수 헬퍼가 `server-only` 모듈(`src/lib/data/cover-letters.ts`) 안에 있어 클라이언트 컴포넌트에서 쓸 수 없다**. 지금은 서버에서 판정해 넘겨 피했지만, 다른 영역이 클라이언트에서 같은 판정을 하려면 `src/lib/data/cover-letter-defaults.ts`처럼 `server-only`가 아닌 파일로 옮기는 편이 낫다. (내가 공용 파일을 고치지 않고 올린다.)

## 9. 검증

| 명령 | 결과 |
|---|---|
| `pnpm lint` | **통과** (0 errors) |
| `pnpm typecheck` | **통과** |
| `pnpm test src/components/board` | **통과** (5건, 신설) |
| `pnpm test src/lib src/components` | **통과** (44 파일 374건, skip 9) |
| `pnpm build` | **통과** (처음 1회 실패 — 클라이언트에서 `server-only` 모듈을 import한 내 코드 때문. 서버 판정으로 고쳐 통과. A3 파일 때문의 실패는 없었다) |
| `pnpm test` 전체 | `src/server/services/{account,application,insight}.integration.test.ts` **17건 실패 — 내 범위 밖**(병행 백엔드 세션의 미커밋 마이그레이션, 브리프대로 손대지 않았다) |

(중단 뒤 재개해 `lint`·`typecheck`·`test`·`build`를 모두 다시 돌렸고 결과는 위와 같다. `pnpm build`는 A3 파일 때문에 실패하지 않았다.)

**브라우저 확인(했다)** — 이미 떠 있던 `pnpm dev`(:3000)에 `?state=` 미리보기로:
- `/board?state=default` → 카드 3행에 **"자소서 작성 중"**(ap1) · **"자소서 작성됨"**(ap2) 각 1개, 나머지 카드 배지 없음. **"서류 초안 n" 문구 0건**.
- `/board?state=cl-pending` → 배지 0건.
- 카드 링크 전부 `/applications/{id}/cover-letter`, "지원 전 +"(넓은 화면 열 머리 · 좁은 화면 탭 버튼) 2곳 모두 `/applications?new=1&from=board`.
- `/applications?new=1&state=default` → 200(모달은 A3 대기).
- `/dev/states?state=cover-letter` → 200, 새 링크 "S-39 보드 (자소서 수 연결 대기 — 배지 없음)"·"S-39 보드 (지원 전 + → 추가 모달)" 렌더 확인. 갤러리는 A0의 `dev-state-gallery-v53.tsx` 자소서 섹션에 **두 줄만 더했고**(A3와 겹치는 `dev-state-gallery.tsx`는 건드리지 않았다) 기존 줄을 지우거나 옮기지 않았다.

> 리더 참고: A0 세션이 띄운 `pnpm dev`(포트 3000)가 아직 돌고 있다 — 나도 종료하지 않았다.
