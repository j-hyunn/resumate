# 41 런 — S-44 본문 칸 높이 고정 해제 (2026-11-05)

- 요청(사용자): "독립 프로젝트에서 산출물 작성할 때 작성 text area 높이 화면에 고정으로 두지마"
- 범위: S-44(`/career/projects/{projectId}/deliverables/new`, `/career/deliverables/{id}`) 본문 한 칸만. 리더가 직접 수정(파일 4개·문서 2개 — 에이전트 분담 없이 끝나는 크기)
- 기준: design-system 5.9 `DocTextarea`·S-44 본문 한 칸, 8.5 DR-10

## 무엇이 문제였나
`DocTextarea`의 기본 클래스에 `max-h-[400px] overflow-y-auto`가 있어서, 본문 칸이 `min-h-[24rem]`(384px)와 400px 사이에 사실상 고정돼 있었고 긴 본문은 칸 안에서 따로 스크롤됐다(왼쪽 입력 영역 스크롤과 겹침 = DR-10).

## 바꾼 것
| 파일 | 변경 |
|---|---|
| `src/components/common/doc-markdown-editor.tsx` | 기본 클래스에서 높이 상한·칸 안 스크롤을 `CAPPED_CLASS`로 분리하고 **`grow` 옵션** 신설(`grow`면 `CAPPED_CLASS`를 붙이지 않는다) |
| `src/components/career/deliverable/deliverable-page.tsx` | 본문 `DocTextarea`에 `grow` (최소 높이 `min-h-[24rem]` 유지). `onFill`의 `el.scrollTop` → 칸을 `scrollIntoView`(덧붙이기 `end` / 교체 `start`), `?range=` 효과의 중복 `scrollIntoView` 삭제(`highlightRange`가 알아서 함) |
| `src/components/common/doc-inputs.tsx` | `highlightRange`: 선택을 먼저 잡고, **칸이 스크롤 조상보다 높으면 선택 구간을 가운데로** 스크롤(`scrollHighlightIntoView`·`scrollParent`). 칸이 더 낮으면 예전처럼 칸을 가운데로. `coordsAtPos`/`scrollTo`가 안 되는 환경(jsdom)은 칸 스크롤로 폴백 |
| `src/components/common/dev-page-shell-demo.tsx` | 데모의 본문 칸도 `grow` (화면과 같게) |
| `docs/ui/design-system.md` | v5.10: 5.9 S-44 본문 한 칸·`DocTextarea` 높이·근거 구간 강조, 1.3 스크롤 규칙 ③, 8.5 DR-6·DR-10 |
| `docs/ui/screen-status.md` | 41 런 줄 + 기획 확인 필요 1건 |

## 건드리지 않은 것
- **S-10 STAR 칸**: `grow` 없음 → 400px 상한·칸 안 스크롤 그대로(UP-9). 클래스 문자열만 두 조각으로 나뉘었고 합친 결과는 같다.
- L-02 셸(`page-shell.tsx`)·`DocBody`/`DocHead`: 그대로. 창은 여전히 스크롤하지 않고(`h-dvh` + `overflow-clip`), 늘어난 본문은 **왼쪽 입력 영역**이 스크롤한다(1.3 스크롤 규칙 ③). 세로 구성 순서(이동 줄 → 배너 → 머리 → 구분선 → 본문 2단), 오른쪽 AI 패널, 상단 바 "저장하기", 좁은 화면 시트·떠 있는 버튼 모두 영향 없음.

## 검증
- `pnpm lint`·`pnpm typecheck` 통과, `pnpm test` 151 파일 2407건 통과.
- **브라우저 미확인**. 확인할 것: ① 긴 본문에서 칸 안 스크롤바가 없고 왼쪽 영역만 스크롤 ② 짧은 본문에서 최소 높이(384px) ③ AI 초안 [반영] 뒤 덧붙이기면 끝, 교체면 시작이 보이는지 ④ `?range=` 진입·"지금 본문에서" 칩이 그 문장으로 스크롤하는지(본문이 화면보다 길 때) ⑤ 좁은 화면(<1024)에서 떠 있는 "Resumate AI" 버튼이 본문 끝을 가리지 않는지(`pb-24` 유지).

## 기획 반영 (2026-11-08, 같은 세션에서 `resumate-planning`으로 처리)
- 사용자 지시 "기획도 반영" → 결정 **DH-1**(사이클 `s44-body-height`, 입력 `_workspace/00_input/planning-decisions-s44-body-height.md`).
- `docs/planning/02-user-flows.md` **v5.19**: S-44 본문 행의 "400px에서 멈추고 칸 안 스크롤" → "높이를 화면에 고정하지 않는다"(넘치면 본문 영역이 스크롤), S-10 "본문 형식" 행은 400px 높이 규칙의 적용 범위를 S-10 STAR 칸으로 한정, UP-9 매핑 표에 대체 표시, 변경 기록 추가.
- `docs/planning/decisions.md` 3.26(사용자 확정)·4.20(후속 — UI 반영 완료, 백엔드 없음), `docs/planning/README.md` 개정 줄 + 문서 표 버전.
- PRD·AI 기능·데이터 모델은 변경 없음(저장값·20,000자 검증·정규화 그대로). 작업 원본 `_workspace/02_ux-planner_flows.md`는 v5.3에서 멈춰 있어 손대지 않았다.
- **S-10 STAR 칸은 400px 유지** — 사용자 요청 범위 밖. 같이 풀려면 DH-2로 추가하면 된다.
