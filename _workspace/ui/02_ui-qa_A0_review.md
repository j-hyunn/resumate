# UI QA — A0 파운데이션 (라운드 1)

- 검수일: 2026-10-24 / 기준: 플로우 v4.2b · 데이터 모델 v3.2a · AI v3.2a · 디자인 시스템 v1 · `_workspace/ui/02_frontend-engineer-A0_report.md`
- 범위: L-01 셸(넓은 화면 + 1024px 미만 서랍), S-28, C-01~C-10, C-17, ST-xx 상태 뷰, `types/db.ts`, 데이터 계층, `?state=` 전환, 토큰, 접근성
- 결정 사항으로 이슈에서 제외: 다크 모드 시스템 설정만(next-themes 없음), Pretendard 자가 호스팅, cmdk 승인, Cache Components 유지, 초록 primary·본문 16px, C-12 파운데이션 이전 예정

## 요약 — Critical 1 / Major 5 / Minor 17

기계 검사: `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm build` 통과(35 페이지 생성). `pnpm dev`에서 12개 경로 요청: 모두 기대 응답(정상 200, 없는 경로 404). 단 `?state=` 페이지마다 Next 개발 오류 "encountered URL data during prerendering"이 기록됨(UQ-3).

토큰: `globals.css`의 변수 이름·값이 디자인 시스템 1.1.2 블록과 **완전히 일치**(diff 결과 차이는 보고서에 적힌 편차 `--font-sans` 앞의 `var(--font-pretendard)`, `--font-heading`, `--radius-2xl..4xl` 뿐). 화면 코드에 hex·rgb·Tailwind 팔레트 클래스 없음(shadcn 오버레이 `bg-black/10` 3곳만, primitive 기본값).

타입: 04 9장의 MVP 사용자 테이블 27개 모두 행 타입이 있고, 모든 enum CHECK 값이 04 본문·부록 A와 글자 그대로 같다(stage 6개, stage_outcome, writing_chats mode/status, review `accepted`, ai_jobs job_type/error_code/error_category, usage feature/status/reason, interview 계열, draft 계열, evidence owner/source type 등). 테이블에 없는 UI 전용 필드는 1건(UQ-18).

## 화면별 점검표

Q1 스펙 행 · Q2 문구 · Q3–4 타입·필드 · Q5 라우트 · Q6 상태 · Q7 AI 모드 · Q8 디자인 시스템 · Q9 접근성 · Q10 좁은 화면

| 대상 | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 |
|------|----|----|------|----|----|----|----|----|-----|
| L-01 셸 | ⚠️ UQ-7, UQ-9 | ✅ | ✅ | ⚠️ UQ-7 | ✅ ai-outage | — | ⚠️ UQ-19 | ✅ | ⚠️ UQ-10 |
| S-28 (not-found/unauth/error, 장애 배너) | ✅ | ⚠️ 기획(v3 문구 없음) | — | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| C-01 근거 칩 · C-02 근거 패널 | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | ⚠️ UQ-13 | ✅ |
| C-03 AI 작업 상태 | ✅ | ✅ (단계 문구 9종 일치) | ✅ | ✅ | ⚠️ UQ-23 | ✅ | ✅ | ⚠️ UQ-6 | ✅ |
| C-04 스트리밍 | ✅ | ✅ | ✅ | — | ⚠️ UQ-23 | ✅ 이벤트 이름 일치 | ✅ | ✅ | ✅ |
| C-05 삭제 확인 | ✅ | ✅ | ✅ | — | ✅ 영향 조회 중 skeleton | — | ✅ | ✅ | ✅ |
| C-06 저장 상태 · useAutosave | ❌ UQ-1, UQ-2 | ✅ | — | — | ✅ save-failed | — | ✅ | ✅ | — |
| C-07 입력 가이드 · MonthField | ⚠️ UQ-8 | ✅ G-1~G-3 | ✅ | — | — | — | ✅ | ✅ | ✅ |
| C-08 자리 표시·검증 배지 | ✅ | ✅ 6종 토큰 | ✅ | — | — | — | ✅ | ✅ | — |
| C-09 데이터 부족 게이트 | ⚠️ UQ-4, UQ-16 | ✅ | ✅ | ⚠️ UQ-5 | ⚠️ UQ-17 | — | ✅ | ⚠️ UQ-15 | ✅ |
| C-10 복귀 배너 | ⚠️ UQ-4 | ✅ | ✅ | ✅ | ✅ return-banner | — | ✅ | ✅ | ✅ |
| C-17 점수 표시 | ⚠️ UQ-20 | ✅ | ✅ | — | — | — | ⚠️ UQ-20 | ✅ | — |
| ST-xx 상태 뷰 | ✅ | ✅ (AI-FAILED 3종·LIMIT·WAIT-JD·장애 배너 문구 일치) | ✅ | — | ⚠️ UQ-3, UQ-23 | — | ✅ | ✅ | ✅ |
| types/db.ts | — | — | ⚠️ UQ-18 | — | — | — | — | — | — |
| 데이터 계층 (lib/data, lib/mock) | ✅ | — | ✅ | ✅ | — | ✅ | — | — | — |

상태 확인 방법: `pnpm dev`(포트 3123)로 `/career`의 `?state=`(없음, loading, empty, error, unauth, not-found, ai-outage, return-banner), `/applications/xyz`, `/nope`, `/board?state=empty`, `/`를 curl로 요청하고, 스크립트를 뺀 HTML에서 문구를 확인했다. 브라우저로 직접 보지는 않았다. 클라이언트에서만 그려지는 것(C-10 배너, 서랍, 토스트)은 코드 경로를 읽어 확인했다.

## 이슈

| ID | 심각도 | 담당 | 대상 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-1 | Critical | foundation | C-06 useAutosave | 02 UX-7 "입력은 잃지 않는다", C-06 / ui-qa 기준 "autosave broken = Critical" | `src/components/common/save-status.tsx:153-155` (unmount 시 타이머만 지움), `:143-151` (beforeunload만 처리) | 디바운스 대기 중 입력은 컴포넌트가 사라지거나(앱 안 이동, Activity hidden) 페이지가 숨겨질 때(`pagehide`/`visibilitychange`) 바로 저장된다 | 800ms 안에 앱 안 링크·뒤로 가기로 이동하면 cleanup이 타이머를 지우고 `pending` 값은 **저장되지 않고 버려진다**. `beforeunload`는 전체 새로고침·탭 닫기에서만 동작한다. 영역 화면이 이 훅을 그대로 쓰므로 모든 자동 저장 폼에 영향 |
| UQ-2 | Major | foundation | C-06 useAutosave | 02 C-06 "저장됨 HH:MM" (최신 입력이 저장됨) | `save-status.tsx:108-135` | 저장 요청을 순서대로 처리하고(진행 중이면 최신 값만 다음에 보냄), 마지막 입력이 최종 저장 값이 된다 | `run()`이 이전 저장이 끝나기 전에도 새 저장을 시작한다. 실제 백엔드에서 응답 순서가 바뀌면 오래된 값이 나중에 기록되고 화면은 "저장됨"을 보인다(mock은 지연이 120ms로 고정이라 지금은 드러나지 않음) |
| UQ-3 | Major | foundation | `?state=` 패턴 · 자리 표시 화면 | ui-context "State preview switch", 보고서 "Cache Components 규칙" | `src/components/common/placeholder-screen.tsx:28`, `src/app/(dashboard)/career/page.tsx:6` (모든 자리 표시 페이지가 같은 패턴) | 영역 엔지니어가 그대로 따라 할 페이지 패턴이 개발 모드에서도 오류 없이 동작한다 | `pnpm dev` 로그에 `/career` 요청마다 `Error: Route "/career": Next.js encountered URL data during prerendering or a navigation`(instant-shell-url-data)가 8회 찍힘. 원인: 페이지 컴포넌트가 Suspense 경계 안이 아닌 곳에서 `await searchParams`. 개발 오버레이가 계속 떠서 QA가 `?state=`를 확인할 때 방해가 되고, 32개 화면 모두가 이 패턴을 물려받는다. `searchParams`를 읽는 부분을 페이지 안 `<Suspense>`로 감싸거나 `export const instant = false`로 정하고, 정한 방식을 보고서 "영역 엔지니어 안내"에 적어야 함 |
| UQ-4 | Major | foundation (A2와 조율) | C-09 / C-10 | 02 C-09 "경력이 없을 때" 행: "S-09 저장 후 다시 판정해 `next_action = 'writing_chat'`이면 S-36 새 프로젝트 대화로 넘긴다 (S-09 → S-36 → 복귀)" | `src/components/common/return-banner.tsx:90-122`, `data-gate.tsx:84-86` | 경력 폼을 거쳐 온 복귀 대상이 있을 때 다시 판정한 결과가 `next_action = 'writing_chat'`이면 S-36(`mode=new_project`, 방금 저장한 경력을 소속으로 미리 선택)으로 이어 가는 버튼·흐름이 있다 | 배너는 "아직 필요 n개" + "돌아가기"만 보인다. 경력 저장 후 S-36으로 넘어가는 경로가 없어 FL-13 데이터 부족 → 대화 → 복귀 흐름이 경력 없는 사용자에게서 끊긴다. 공통 배너에 "AI와 대화하며 채우기" 동작을 두고, A2 S-09가 저장 후 그 동작을 띄울지 결정 필요 |
| UQ-7 | Major | foundation | L-01 이동 경로 | 02 1.3 상단 이동 경로: S-39·S-37에서 들어왔을 **때만** 첫 마디가 "지원 현황"/"모의 면접" | `src/components/common/return-target.ts:69-87` (`clearNavOrigin`을 호출하는 곳 없음), `shell/breadcrumbs.tsx:55-56` | 기업 JD 관리(S-13·메뉴)에서 같은 지원 프로젝트로 들어가면 첫 마디가 다시 "기업 JD 관리" | 출발 메뉴가 sessionStorage에 지원 프로젝트 ID 기준으로 계속 남는다. 보드에서 한 번 들어간 기업 JD는 이후 S-13에서 들어가도 첫 마디가 "지원 현황"이고 링크도 보드로 간다. 왼쪽 메뉴 클릭(AppSidebar)과 S-13 진입에서 지우는 규칙을 파운데이션이 정해야 함 |
| UQ-5 | Minor | foundation | C-09 → S-36 | 04 §2.5 `return_target = {application_project_id, feature, params, created_at}`, §6 "대화는 여러 번에 나눠 이어 하므로 DB에 둔다" | `data-gate.tsx:69-70, 84-92`, `src/lib/routes.ts:45-57` | S-36이 대화를 만들 때 `return_target.params`(질문 수, 자소서 문항 등)를 함께 저장할 수 있다 | URL에는 ID와 기능 이름만 넘어가고(스펙대로) `params`는 sessionStorage에만 있다. S-36(A2)이 시작할 때 `readCareerReturn().params`를 읽어 `startWritingChat`에 넘기지 않으면 다른 세션에서 이어 할 때 설정 복원이 안 된다. 영역 안내에 이 규칙 추가 필요 |
| UQ-6 | Minor | foundation | C-03 | 디자인 시스템 7 A-6 "AI 진행·완료·실패는 `aria-live`로 한 번씩" | `src/components/common/ai-progress.tsx:126-130` | 시작·완료·실패만 한 번 알림 | 카드 전체가 `aria-live="polite"`라서 2초마다 폴링으로 바뀌는 단계·`n/N`이 매번 읽힌다(`aria-busy`와 함께 쓰여 스크린 리더마다 동작도 다름) |
| UQ-8 | Minor | foundation | C-07 MonthField | 04 DM-4 년-월 date, 02 C-07 | `src/components/common/input-guide.tsx:116-118, 133` | 월을 고르기 전에는 값이 비어 있거나 "연도만" 상태가 따로 표시된다 | 연도만 고르면 `${y}-01-01`(1월)이 바로 저장된다. 사용자가 월을 고르지 않아도 `start_month`가 채워져 완료(`complete`) 판정이 바뀔 수 있다 |
| UQ-9 | Minor | foundation | L-01 상단 바 | 디자인 시스템 5.1 "상단 바 … (오른쪽) 화면 동작", 좁은 화면 "오른쪽 화면 동작 1개까지" | `src/app/(dashboard)/layout.tsx:28-30`, `shell/shell-parts.tsx:20, 40` | 페이지가 상단 바 오른쪽에 동작을 넣을 수 있다(PageCrumbs처럼 선언) | `TopBar`의 `actions`를 채우는 경로가 없어서 화면 동작은 PageHeader에만 둘 수 있다 |
| UQ-10 | Minor | foundation | L-01 좁은 화면 | 02 1.3 "현재 메뉴 이름은 상단 바에 항상 보인다" | `src/hooks/use-mobile.ts` (서버 스냅샷 `false`), `shell-parts.tsx:28` | 1024px 미만에서 첫 화면부터 메뉴 버튼과 현재 메뉴 이름이 보인다 | 서버 렌더와 첫 페인트는 넓은 화면용 이동 경로가 그려지고, hydration 뒤에 메뉴 버튼으로 바뀐다(깜빡임, 그 사이 메뉴를 열 수 없음). CSS(`lg:hidden`/`hidden lg:flex`)로 두 모양을 함께 그리는 방식 권장 |
| UQ-11 | Minor | foundation | C-02 경로 | 02 C-02 "연도 › 회사명/기관명 › 프로젝트명 › 상세 내용 제목 › 필드", 04 §2.4 프로젝트 연도 = `coalesce(projects.start_month, 소속 start_month)` | `src/lib/data/evidence.ts:105, 120` | 프로젝트에 기간이 없으면 소속 경력·교육의 연도를 쓴다. 정량 성과도 같은 경로 | 상세 내용 경로의 연도가 `p.start_month`만 봐서 비어 빠진다. 정량 성과 경로는 "상세 내용 제목 › 정량 성과"뿐 |
| UQ-12 | Minor | foundation | C-01 순서 | 02 C-01 데이터 `sort_order` | `evidence.ts:203` | `getEvidenceForOwners`도 `sort_order` 순 | 정렬하지 않음(`getEvidence`는 정렬함, `:193`) |
| UQ-13 | Minor | foundation | C-01 → C-02 | 디자인 시스템 3.1 "클릭 → C-02 열고 포커스 이동" | `src/components/common/evidence.tsx:174-177` | 누른 칩의 근거 카드로 포커스(또는 제목) 이동 | 스크롤만 하고 포커스는 Sheet 기본(닫기 버튼)으로 간다 |
| UQ-14 | Minor | foundation | C-02 | 보고서 안내 2 "다이얼로그는 이동 시 닫기 처리 권장" | `evidence.tsx:236-241` | "원본으로 이동"을 누르면 패널을 닫는다 | 패널이 열린 채 이동한다. Activity 때문에 뒤로 오면 패널이 다시 열린 상태 |
| UQ-15 | Minor | foundation | C-09 | 디자인 시스템 7 A-7 | `src/components/common/data-gate.tsx:95, 99` | 제목 id가 화면마다 하나 | `id="data-gate-title"` 고정이라 한 화면에 게이트 둘(S-17 경력기술서·자소서)이면 id가 겹친다. `React.useId()` 권장 |
| UQ-16 | Minor | foundation | C-09 | 02 C-09 보조 링크 "직접 입력: 작성 중 항목이 있으면 그 편집, 없으면 새 폼" | `data-gate.tsx:74-86, 153-162` | 주 버튼과 보조 링크가 다른 곳으로 간다 | `next_action = 'form'`이고 작성 중 항목이 없으면 "경력 먼저 입력하기"와 "직접 입력"이 둘 다 `/career/experiences/new`로 간다 |
| UQ-17 | Minor | foundation | C-09 한도 소진 | 02 C-09 한도 행: 안내 문구 "이번 달 AI 작성 대화를 모두 사용했어요. 직접 입력으로 채울 수 있어요" / 디자인 3.8 "Alert warning 한 줄(ST-LIMIT 축약형)" | `data-gate.tsx:127-131` | 경고 한 줄 | ST-LIMIT 문구 Alert와 명세 안내 문구가 둘 다 나와 같은 말을 두 번 한다 |
| UQ-18 | Minor | foundation | types/db.ts | 03 AI-02 최종 저장 형태 `strategy.{positioning, positioning_evidence, project_priorities}` / item_key 규칙 `strategy.positioning`(02 C-01) | `src/types/db.ts:528-531` (`positioning_item_key`), `src/lib/data/ai-jobs.ts:158` | 저장 형태에 없는 키를 db 타입에 두지 않는다(item_key는 고정 경로 `strategy.positioning`) | `positioning_item_key`가 AI 명세에 없는 키다. 나중에 생성 타입으로 바꿀 때 어긋남 |
| UQ-19 | Minor | foundation | 포커스 링 | 디자인 시스템 7 A-3 `ring-2 ring-ring ring-offset-2`(shadcn `ring-[3px] ring-ring/50` 금지) | `src/components/ui/sidebar.tsx:469` (메뉴 버튼 `ring-sidebar-ring focus-visible:ring-2`, offset 없음), `src/components/ui/field.tsx:109`, `src/components/ui/input-group.tsx:17` (`ring-3 ring-ring/50`) | 모든 조작 요소가 같은 불투명 링 + offset | 왼쪽 메뉴 항목·field·input-group(command 검색에 쓰임)은 shadcn 기본 링이 남아 있다 |
| UQ-20 | Minor | foundation | C-17 | 02 C-17 `not_scored` + 응답 0개 → "답변이 없어 평가할 내용이 없어요" **+ "새 면접 시작하기"** / 디자인 3.16 "다시 채점" = `Button variant="link" size="sm"` | `src/components/common/score-display.tsx:37-41, 104-107` | 응답 0개 문구 옆 "새 면접 시작하기" 동작 자리, 다시 채점은 공통 Button | 동작 자리 없음(호출 쪽이 따로 붙여야 하는데 안내 없음). "다시 채점"은 맨 `<button>`이라 포커스 링 없음 |
| UQ-21 | Minor | foundation (리더 확인) | 의존성 | ui-context "Don't add other UI libraries without the leader's approval" | `package.json:19` (`cn@0.5.0`), `src/lib/utils.ts:1`, `src/components/ui/*.tsx` | 승인된 의존성만, 또는 보고서에 기록 | shadcn 스캐폴드가 넣은 `cn`(clsx + tailwind-merge 대체, shadcn-ui 저장소)이 쓰이는데 A0 보고서 패키지 목록에 없다. 리더 승인 여부만 기록하면 됨 |
| UQ-22 | Minor | foundation | C-06 시각 | 02 C-06 "저장됨 HH:MM" | `src/lib/data/labels.ts:206-209` | 시각을 KST(또는 브라우저 시간대)로 일관되게 | `getHours()` 기반이라 서버 컴포넌트에서 쓰면 서버 시간대(UTC)로 찍힌다. 클라이언트 전용이라는 주석이나 시간대 고정 필요 |
| UQ-23 | Minor | foundation | ST 미리보기 | ui-context "every ST-xx state can be rendered and checked" | `placeholder-screen.tsx:33-49` | 파운데이션 단계에서 C-03·C-04·C-09·ST-AI-FAILED·ST-LIMIT·ST-WAIT-JD를 한 번은 그려 볼 수 있다 | 자리 표시 화면은 `ai-pending`·`ai-stream`·`ai-failed*`·`limit`·`insufficient`·`wait-jd`·`move-failed`를 받아도 기본 화면을 그린다. 그래서 이 공통 컴포넌트들은 화면에서 확인하지 못했고 코드만 읽었다. 개발용 갤러리 라우트(예: `/dev/states`)나 자리 표시 화면 분기 권장 |

## 기획 확인 필요 (`기획`)

A0 보고서의 "기획 확인 필요" 7건을 확인했고 모두 실제 문서 공백이 맞다. 리더 전달 목록에 그대로 둔다. QA가 새로 찾은 항목:

| # | 대상 | 내용 (양쪽 인용) |
|---|------|------------------|
| P-QA-1 | C-02 정량 성과 "원본으로 이동" | 02 C-02 "정량 성과 → S-11" ↔ 02 1.2 "S-11 정량 성과 (모달)". 모달은 라우트가 없어 이동 대상을 정할 수 없다. 현재 `[UI-가정]`: S-35 결과(R) 필드로 이동(`evidence.ts:116-121`). S-35가 `?focus=result`로 S-11을 자동으로 여는지 A2와 함께 정해야 함 |
| P-QA-2 | ST-EMPTY / ST-LOADING / ST-UNAUTH / NOTFOUND / SAVE-FAILED | 02 3.0 공통 상태 "v3와 같음" ↔ v3 문서가 저장소에 없음(디자인 시스템 P-6과 같은 원인). S-28 문구 가정과 같은 묶음으로 처리 권장 |

## C-12 단계 이동 메뉴 — 파운데이션 이전 시 기대 모양 (수정 라운드 참고)

- 위치: `src/components/common/stage-menu.tsx`(파운데이션 소유). 트리거 두 가지를 같은 내용으로: 보드 카드 `⋯`(`Button ghost icon-sm` + `MoreHorizontal`, `aria-label="카드 메뉴"`) 안의 하위 메뉴 "단계 이동", S-31 헤더 단계 칩(`Button outline sm` + `StatusDot` + `STAGE_LABELS` + `ChevronDown`).
- 내용: `DropdownMenuLabel` "단계 이동" → `DropdownMenuRadioGroup` 6단계(`STAGE_ORDER`, 각 항목 `StatusDot` + 라벨, 현재 단계 체크) → 구분선 → "다음 단계로"(`ArrowRight`, `closed`면 숨김).
- 동작: `moveApplicationStage` 서버 액션 호출, 낙관적 반영, 실패하면 원위치 + ST-MOVE-FAILED 토스트("이동하지 못했어요" + "다시 시도"). 결과에 `interview_prompt`가 있으면 C-14, `to = closed`면 C-13을 띄우는 콜백(`onMoved(result)`)을 호출 쪽에 넘긴다. 이동 후 `aria-live`로 "{카드}를 {단계}로 옮겼어요" 한 번.
- 종료 → 다른 단계: `stage_outcome`이 지워진다는 사전 확인(04 §2.6 2단계 "화면이 사전 확인").
- C-13·C-14도 S-31과 S-39가 함께 쓰므로 같은 라운드에 `components/common/`으로 함께 옮기는 것을 권장.

## 재확인 결과

라운드 1이라 이전 이슈 없음.

## 기계 검사 출력

- `pnpm lint` (eslint): 오류·경고 없음, exit 0
- `pnpm typecheck` (`tsc --noEmit`): exit 0
- `pnpm build`: exit 0. `✓ Generating static pages using 11 workers (35/35)`. 공개 4개 + `/_not-found`는 정적(○), 대시보드 28개 라우트는 Partial Prerender(◐)
- `pnpm dev --port 3123` (확인 후 종료): `/career`(state 없음·loading·empty·error·unauth·not-found·ai-outage·return-banner), `/applications/xyz`, `/board?state=empty`, `/` → 200, `/nope` → 404. 스크립트를 뺀 HTML 기준으로 `state=error` → "문제가 생겼어요", `unauth` → "접근할 수 없는 페이지예요", `empty` → EmptyState, `ai-outage` → 장애 배너 문구(02 S-28 문구와 일치), `loading` → skeleton("불러오는 중"). 개발 로그에 `Error: Route "/career": Next.js encountered URL data during prerendering or a navigation` 8회(UQ-3)

---

# 라운드 2 (2026-10-24)

## 요약 — 열린 Critical 0 / Major 0 / Minor 2(신규) → **A0 통과**

- 라운드 1 이슈 23건: 해결 21, 규칙·기록으로 처리 2(UQ-5, UQ-21. 모두 Minor라 통과 판정에 영향 없음). 재발 0.
- 신규 이슈: Minor 2건(UQ-24, UQ-25). Critical·Major 없음.
- 기계 검사: lint·typecheck·build 모두 통과. 빌드에서 `/dev/states`(◐)가 추가됨.
- `pnpm dev`(포트 3124, 확인 후 종료) 결과:
  - `/dev/states`를 state 없이 + 13개 `?state=` 값으로 요청, 영역 경로 13개 요청. 모두 200이고, 없는 지원 프로젝트의 `insight?state=not-found`는 404.
  - **개발 로그 오류 0건**("URL data" 오류 사라짐).
- 브라우저 확인은 못 했다. Claude in Chrome이 연결되지 않아 서랍, 토스트, 단계 이동은 코드를 읽어서만 확인했다. 수정 라운드 전에 리더나 사람이 한 번 눈으로 보기를 권장한다.

## 재확인 결과

| ID | 결과 | 메모 (코드 위치) |
|----|------|------------------|
| UQ-1 | 해결 | `save-status.tsx` cleanup이 대기 값이 있으면 `drain()`. `pagehide`와 `visibilitychange=hidden`에서 `flush()`. effect 의존성(`flush`, `drain`)이 안정적이라 cleanup은 언마운트 때만 돈다 |
| UQ-2 | 해결 | `drain()`으로 직렬화: 진행 중이면 같은 promise를 돌려주고, 대기 값이 생기면 반복해서 마지막 입력을 저장한다. 실패하면 `last`를 유지하고 `retry()`가 다시 보낸다 |
| UQ-3 | 해결 | `screen-suspense.tsx` 패턴. 기본 export는 동기이고 async 자식이 await한다. 자리 표시 페이지 전부 적용됐고, dev 로그에서 같은 오류가 0건 |
| UQ-4 | 해결 (파운데이션 부분) | `return-banner.tsx:54-65, 174-178`: 다시 판정해서 `next_action = writing_chat`이면 "AI와 대화하며 채우기"를 보이고, `experience_id`를 소속으로 미리 고른다. `useGateContinuation()`과 `recordGateExperience()` 제공. S-09 연결은 A2 몫(영역 규칙 2) |
| UQ-5 | 규칙으로 처리 | 영역 규칙 4(S-36이 `readCareerReturn()?.params`를 `return_target`에 넣음). A2 QA 때 확인한다 |
| UQ-6 | 해결 | `ai-progress.tsx:126-133`: 카드의 `aria-live`를 없애고 `role="status"` 문구 한 번만 |
| UQ-7 | 해결 | `app-sidebar.tsx:113` 메뉴 클릭 때, `breadcrumbs.tsx:78` 최상위 메뉴 화면(1마디, 지원 프로젝트 없음)에서 `clearNavOrigin()` |
| UQ-8 | 해결 | `input-guide.tsx:107-121, 148`: 연도만 고르면 값은 null, 월 Select는 연도를 고른 뒤에 열린다 |
| UQ-9 | 해결 | `breadcrumbs.tsx:54` `PageTopActions` |
| UQ-10 | 해결 | `shell-parts.tsx:33-42`: CSS `lg:hidden`으로 두 모양을 함께 그림 |
| UQ-11 | 해결 | 보고서대로 경로 보완(`evidence.ts`) |
| UQ-12 | 해결 | `evidence.ts:223` 정렬 |
| UQ-13 | 해결 | `evidence.tsx:182-186, 201-203`: 누른 칩의 카드에 `tabIndex=-1` + 포커스 |
| UQ-14 | 해결 | `evidence.tsx:250`: 이동 전에 패널을 닫음 |
| UQ-15 | 해결 | `data-gate.tsx:64` `useId()` |
| UQ-16 | 해결 | `data-gate.tsx` `direct !== chatHref`일 때만 보조 링크 |
| UQ-17 | 해결 | 경고 한 줄. 문구가 02 C-09와 일치 |
| UQ-18 | 해결 | `positioning_item_key` 삭제(src 전체에서 grep 결과 0건) |
| UQ-19 | 해결 | sidebar 메뉴 버튼, field, input-group 포커스 링을 `ring-2 ring-ring ring-offset-2`로. `aria-invalid:ring-3`은 오류 표시라 유지(수용) |
| UQ-20 | 해결 | `score-display.tsx:26-45`에 `startNewAction` 자리. "다시 채점"은 `Button variant="link" size="sm"` |
| UQ-21 | 기록 | `cn@0.5.0` 사용 여부는 리더 승인 항목으로 넘김(코드 문제 아님) |
| UQ-22 | 해결 | `labels.ts:208` `timeZone: "Asia/Seoul"` |
| UQ-23 | 해결 | `/dev/states`: 아래 상태별로 HTML에서 명세 문구가 나오는 것을 확인. ai-stream과 ai-sync는 클라이언트에서만 동작하는 버튼이라 HTML로는 확인할 수 없음 |

`/dev/states`에서 상태별로 확인한 문구:

| `?state=` | 확인한 문구 |
|-----------|-------------|
| `ai-pending` | "진행 중" |
| `ai-failed` | "잠시 후 다시 시도해 주세요" + "사용량은 차감되지 않았습니다" |
| `ai-failed-input` | "입력 내용을 확인해 주세요" + "사용량은 차감되지 않았습니다" |
| `ai-failed-timeout` | "시간이 오래 걸려 중단됐어요" + "사용량은 차감되지 않았습니다" |
| `limit` | "한도(" |
| `insufficient` | C-09 제목 + "AI와 대화하며 채우기" |
| `insufficient-no-experience` | "경력 먼저 입력하기" |
| `wait-jd` | "공고 분석이 끝나면" |
| `move-failed` | "단계 이동" |
| `save-failed` | "저장 실패" |
| `empty` | 근거 칩, 삭제, 점수 |

## 새 파일 검토

- **`stage-menu.tsx` (C-12/C-13/C-14)**: 라운드 1에 적은 기대 모양과 일치한다.
  - 메뉴: 6단계 RadioGroup + StatusDot, "다음 단계로"(`closed`면 숨김)
  - 이동: 낙관적 반영, 실패하면 원위치 + 토스트 "이동하지 못했어요" [다시 시도], `aria-live` "{카드}를 {단계}로 옮겼어요"
  - 결과가 있는 전형 종료에서 나갈 때 사전 확인(04 §2.6)
  - `to = closed`이고 결과가 없으면 C-13. C-13 문구 "전형 결과를 기록할까요?", 최종 합격 / 불합격 / 나중에 기록
  - C-14: 직무 문구가 02와 일치, 작성 중 세션이 있으면 "이어서 쓰기"(유형 + n/N), 사용량 안내 없음
  - `answered_count`는 답변 저장 때 갱신된다(`interviews.ts:172`). 문제없음
  - 새 [UI-가정] 3건(결과 지우기 확인 문구, C-14 컬처핏 설명, 기록 완료 알림)은 기획 확인 목록에 넣어 둘 것
- **`screen-suspense.tsx`**: 규칙이 명확하고 실제로 dev 오류를 없앴다.
- **`save-status.tsx`, `return-banner.tsx`, `return-target.ts`**: 위 재확인 표와 같다. 신규 이슈는 UQ-24.
- **`/dev/states`**: 상태별 렌더 확인 가능. 신규 이슈는 UQ-25.

## 신규 이슈

| ID | 심각도 | 담당 | 대상 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-24 | Minor | foundation | C-10 배너 | 02 C-09 사용량 "대화 시작 1회", C-10 | `src/components/common/return-banner.tsx:152, 174-178` | S-36(`/career/writing-chats/*`)을 보는 중에는 배너에 "AI와 대화하며 채우기"(새 대화 시작)를 띄우지 않는다. 그 화면에서는 저장 완료 화면이 다음 단계를 맡는다 | 배너는 `/career` 아래 모든 화면에 나오므로, 대화 도중에도 새 대화를 시작하는 버튼이 보인다. 눌러서 새 대화를 시작하면 사용량이 한 번 더 차감될 수 있다 |
| UQ-25 | Minor | foundation | `/dev/states` | ui-context "development only" | `src/app/(dashboard)/dev/states/page.tsx:25` | 프로덕션에서 HTTP 404 | `notFound()`가 Suspense 안의 스트리밍 중에 불려 프로덕션에서도 HTTP 200 + 찾을 수 없음 화면이 된다(라운드 1 보고서의 지원 프로젝트 notFound와 같은 특성). 기능상 막히긴 하지만 상태 코드가 다르다. 동기 기본 export에서 `isPreviewEnabled`를 먼저 확인하면 404가 된다 |

## 기계 검사 출력 (라운드 2)

- `pnpm lint`: exit 0
- `pnpm typecheck`: exit 0
- `pnpm build`: exit 0(`/dev/states` ◐ 포함)
- `pnpm dev` 로그: `Error`/`⨯`/"URL data" 0건
