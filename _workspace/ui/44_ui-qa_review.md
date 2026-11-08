# UI QA — 44 런 AI 모의 면접 MVP 제외 (라운드 1)

- 작성: 2026-11-08 · ui-qa · 기준: PRD v4.16 / 플로우 v5.19 / AI v4.14 / DM v4.14, decisions 4.20 UI 1~7, R14 `02_api_notes.md` "UI 요청"
- 입력: `44_brief_remove-mock-interview.md`, `44_frontend-engineer_report.md`, 작업 트리 미커밋 diff

## 요약 — Critical 0 / Major 1 / Minor 5

기계 검사 4종 모두 통과(lint 0 · tsc 0건 · vitest 144 파일 / 2343건 · build exit 0, 면접 라우트 없음). 브라우저 확인(Q12)은 하지 않았다 → 바뀐 화면은 모두 `QA 통과 (mock·브라우저 미확인)` 수준.
면접 화면·컴포넌트 삭제, 메뉴 3개, 보드 4열, C-05/S-25/S-24②/S-40/S-42/C-08/C-21 문구는 명세와 맞는다. 남은 문제는 배포 전 세션에 남은 옛 출발점 값이 이동 경로를 깨뜨리는 경로(Major 1)와 문서·미리보기 잔여(Minor).

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | Q11 | Q12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L-01 (메뉴·배지·이동 경로) | ✅ | ✅ | ✅ | ⚠️ UQ-44-1 | — | — | ✅ | ✅ | ✅ (서랍 3개, `MENU_ITEMS` 공용) | ✅ | 미확인 |
| S-39 보드 | ✅ 4열 = `STAGE_ORDER` = `APPLICATION_STAGES` | ✅ | ✅ | ✅ | ✅ `interview-prompt`·`ai-locked` 제거 | — | ✅ | ✅ | ✅ (탭도 `STAGE_ORDER`) | ✅ 이동 반환 `interview_prompt` 없음 | 미확인 |
| C-12/C-13 | ✅ 4값 | ✅ | ✅ | — | ✅ | — | ✅ | ✅ | — | ✅ | 미확인 |
| S-31 허브 | ✅ 카드 3개 | ✅ | ✅ | ✅ | ✅ | — | ⚠️ UQ-44-4 | ✅ | ✅ | ✅ | 미확인 |
| S-13 목록 | ✅ 면접 칸 제거 | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-14 · S-15 · S-16 | ✅ | ✅ (`[UI-가정]` 문구 2) | ✅ | ✅ `from=interview` 제거 | ✅ | — | ✅ | — | — | ✅ | 미확인 |
| C-05 | ✅ | ✅ 자기소개서 영향 줄 = 명세 그대로 | ✅ | — | ✅ | — | ✅ | ✅ | — | ✅ 면접 키 없음 | 미확인 |
| S-25 | ✅ | ✅ | ✅ 빈 요약 키 4개 | — | ✅ | — | ✅ | — | — | ✅ | 미확인 |
| S-24 ② / S-40 | ✅ | ✅ 안내·활성 변경 확인 문구 일치 | ✅ | — | ✅ | — | ⚠️ 문서 UQ-44-3 | — | — | ✅ | 미확인 |
| S-42 | ✅ 5행 | ✅ 라벨 = AI C-13.1 | ✅ | — | ✅ | — | ✅ | — | — | ✅ | 미확인 |
| S-01 / S-08 / S-44 | ✅ | ✅ (S-01 본문 `[UI-가정]`) | — | — | — | — | ✅ | — | — | — | 미확인 |
| C-03 | ✅ 면접 단계·`complete` 제거 | ✅ | ✅ | — | ✅ | ✅ | ✅ | — | — | ✅ | 미확인 |
| C-08 | ✅ 5종 = `PlaceholderToken` | ✅ | ✅ | — | — | — | — | — | — | ✅ | — |
| C-09 / C-10 / C-18 / C-19 / C-21 | ✅ | ✅ | ✅ readiness `features` 2키 | ✅ | ✅ | — | ✅ | — | — | ✅ | 미확인 |
| S-30 미리보기 (`policy_versions`) | — | — | ✅ fixtures 4행 | — | ⚠️ UQ-44-5 | — | — | — | — | ⚠️ UQ-44-5 | 미확인 |
| 옛 주소 리다이렉트 | — | — | — | ⚠️ UQ-44-2 (목적지 ✅, 쿼리 유지) | — | — | — | — | — | — | 미확인 (엔지니어 curl만) |

## 브라우저 확인
하지 않았다. 브라우저 도구로 로컬 백엔드에 로그인해 화면을 열어 보지 않았으므로 Q12는 모든 화면 "미확인". 리다이렉트 4건은 엔지니어의 `next start` + curl 기록과 `legacy-redirects.test.ts`(Next 매처로 검사)만 근거다 — 브라우저 확인이 아니다.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 / 수정 제안 |
|---|---|---|---|---|---|---|---|
| UQ-44-1 | Major | foundation | L-01 이동 경로 (S-31·S-14~S-18·S-45·S-46) | 02 L-01 "상단 바·이동 경로"(출발 메뉴 마디는 지원 현황만, v5.19 RM-1) | `src/components/common/return-target.ts:113-122`, `src/components/common/shell/breadcrumbs.tsx:78,100` | 옛 값이 남아 있어도 이동 경로가 그려진다 | `readNavOrigin`이 sessionStorage 값을 검사 없이 `NavOrigin`으로 돌려준다. 배포 전에 S-37에서 S-31로 들어간 탭은 `{"origin":"interviews",…}`를 그대로 갖고 있고(같은 자기소개서 하위 화면 사이 이동에서는 지워지지 않음, `breadcrumbs.tsx:76`), `ORIGIN_CRUMB["interviews"]`가 `undefined`라서 trail 첫 항목이 `undefined` → `CrumbTrail`의 `c.label`에서 TypeError가 나 셸이 오류 화면으로 간다. 제안: `readNavOrigin`에서 `parsed.origin === "board"`일 때만 돌려주고 아니면 `clearNavOrigin()` 뒤 `null`(+ 단위 테스트 1건) |
| UQ-44-2 | Minor | 기획 | 옛 면접 주소 | 02 1장 "폐기한 면접 화면의 주소"(v5.19, RM-1 `[가정]`) "쿼리(`?type=` 등)는 버린다" | `src/lib/legacy-redirects.ts:24-36`, `next.config.ts:23` | 목적지에 쿼리 없음 | Next 설정 redirect는 요청 쿼리를 목적지에 붙인다(`[UI-가정]`으로 표시됨). S-31·S-13이 모르는 키를 무시해 화면 차이는 없다. 기획이 "쿼리 유지 허용"으로 문장을 고치거나, 지키려면 `src/proxy.ts`(백엔드 소유)에서 처리 — 둘 중 결정 필요 |
| UQ-44-3 | Minor | ui-designer | S-24 ② · C-05 · S-31 · S-13 외 (문서) | 02 S-24 ② 블록 ① 안내(v5.19 "모의 면접" 삭제), C-05 자기소개서 행(v5.19 면접 줄 삭제), S-31 기능 카드(면접 카드 삭제) | `docs/ui/design-system.md:2076`(5.11.2 블록 ① 문구에 "모의 면접"), `:725`(C-05 영향 요약 형식 "· 면접 1"), `:728`("끝난 모의 면접 {M}개는 기록에 남아요"), `:1416-1419`(5.2 목록 S-37·"새 면접"·"그만둔 면접", 허브 카드 "/ 면접"), `:1107`("작성 중 면접 1개(S-20 배너)"), `:1315`(ST-EMPTY 면접 아이콘), `:410·478·560·568·576·715·1488`(사용처 열거) | 남은 화면의 규칙·문구는 v5.19와 일치 | 머리 안내(6행)가 "사용처·예시 문장은 이력"이라고 묶었지만 2076·725·728·1419는 **남은 화면의 문구·레이아웃 정의**라 유효 명세로 읽히고 코드·플로우와 어긋난다. 이 네 곳은 고치고, 나머지는 해당 줄에 취소선 또는 "(폐기)" 표시 |
| UQ-44-4 | Minor | ui-designer | S-31 | 02 S-31 "기능 카드(JD·요건 / 인사이트 / 서류)" (v5.19, RM-1) · design-system 5.2 허브 | `src/app/(dashboard)/(gated)/applications/[id]/page.tsx:82` (`grid gap-4 md:grid-cols-2`) | 카드 3개가 고르게 놓인다 | 면접 카드가 빠져 md 이상에서 서류 카드 혼자 두 번째 줄 반폭, 오른쪽이 빈다(깨짐은 아님). 5.2에 3카드 배치(예: `md:grid-cols-3` 또는 마지막 카드 `md:col-span-2`)를 정하고 A3가 반영 |
| UQ-44-5 | Minor | 백엔드 (`lib/data/account.ts` 소유) | S-30 AI 데이터 처리 · C-21 미리보기 | DM `policy_versions` 현재 판 = 시행일 desc, 버전 desc (R14-DB-6) | `src/lib/data/account.ts:45-47`(`previewAiDataUseVersion`이 `find`로 첫 `ai_data_use` 행) | 미리보기에서 `ai_data_use` 현재 판 `2026-11-08.1` | fixtures에 `ai_data_use` 행이 2개(2026-11-05, 2026-11-08.1)가 되어 미리보기는 **2026-11-05**를 보인다(R13 임시 우회 그대로). `currentVersion(db, "ai_data_use")`로 교체하고 R13 주석 삭제. 덧붙여 fixtures에는 마이그레이션 `20261113002900`의 privacy·ai_data_use `2026-11-08`(.1 없는 판) 행이 없어 같은 시행일 2차 정렬이 미리보기에서 한 번도 돌지 않는다 — 원하면 foundation이 2행 추가 |
| UQ-44-6 | Minor | 백엔드 | (테스트 fake) | DM §6 v4.14 readiness `features` 2키, `data_sufficiency` 삭제(RM-A5) | `src/test/draft-fakes.ts:210` | 새 readiness 모양 | fake readiness가 아직 `data_sufficiency: "none"`/`"ok"`를 넣는다(타입이 느슨해 tsc 통과). 화면 영향 없음 — R14 정리 때 함께 삭제 |

## 기획 확인 필요
- UQ-44-2: 옛 주소의 쿼리 — 명세 "버린다" ↔ Next 설정 redirect의 쿼리 유지. 문장을 "쿼리는 그대로 넘어가도 목적지가 무시한다"로 바꿀지, `proxy.ts`에서 버릴지.
- (엔지니어 보고 재확인, 이번 런 범위 밖) C-05 `delete_results` 설명은 v5.17 문구("경력기술서는 문서 전체, …생성 결과만")로 남아 있고 명세 v5.18 CL-3은 "그 커리어 항목을 쓴 섹션 / 답변 본문만"이다(`src/components/common/delete-confirm-dialog.tsx:249` ↔ 02 C-05 `delete_results` 범위 설명 행). 자기소개서 영향 줄의 `{N}`도 명세는 `cascade.documents`(내용이 있는 서류 수)인데 코드는 `drafts`(`src/lib/data/deletion.ts:376-388`). v5.18 서류 후속 런 대상으로 기록만 한다.

## 잔존 grep 판정 (`grep -rni "interview\|면접\|모의" src/app src/components src/lib src/hooks next.config.ts`, `src/server` 제외)
| 위치 | 판정 |
|---|---|
| `src/components/applications/labels.ts:74` `prepare_answer: "면접 대비"` | 정당 — AI-02 인사이트 대응 방안 종류(실제 채용 면접), AI v4.14 유지 |
| `src/lib/legacy-redirects.ts:26-39`, `legacy-redirects.test.ts:55-68`, `next.config.ts:22` 주석 | 정당 — 옛 주소 308 규칙·테스트(음성 단정 `…/interviews`, `/interviewsx` 포함) |
| `src/components/account/policy-content.ts:30,397` | 정당 — 개정 이력 주석. 본문에 면접 문장 없음(R14가 `docs/legal/` 2026-11-08판과 맞춤, 금지 파일) |
| `src/lib/ai-disclosures.ts:66`, `src/lib/data/usage-display.ts:2` | 정당 — 폐기 이력 주석 |
| `src/lib/data/w3.integration.test.ts:564` | 정당 — 음성 단정(`interview_sessions` 키 없음) |
| `src/app/(dashboard)/(gated)/applications/[id]/drafts/page.tsx:23` "모의이고" | 무관 — "mock(모의) 추출"의 뜻 |
- 단계 색 토큰: `globals.css:76-79·164-167·255-258` 4개 = `design-system.md:129-132·210-213·295-298` 표 = `basics.tsx` `STAGE_DOT_CLASS` 4키. 면접 토큰 2개 없음 ✅
- `docs/ui/screen-status.md`: 면접 행은 모두 취소선 + "폐기 (RM-1)" + redirect 목적지, 남은 언급은 이전 런 이력 인용 ✅. `design-system.md`는 UQ-44-3.

## 재확인 결과
첫 라운드 — 해당 없음.

## 기계 검사 출력
- `pnpm lint`: exit 0, 출력 없음(0 errors / 0 warnings)
- `pnpm tsc --noEmit`: exit 0, **0건** (기존 `RouteContext` 10건도 이번 실행에서는 나오지 않음 — `.next/types` 생성 상태 차이)
- `pnpm vitest run`: Test Files 144 passed (144) · Tests 2343 passed (2343)
- `pnpm build`: exit 0. 라우트 표에 `/interviews`·`/applications/[id]/interview/**` 없음
