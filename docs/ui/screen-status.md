# 화면 구현 현황
- 기준 기획: PRD v4.6 / 플로우 v5.6 / AI v4.6 / 데이터 모델 v4.5 (PA-1~PA-4 반영, 2026-11-03 — 이번 런의 대상 화면만. 나머지 화면은 이전 기준 v5.4a 그대로) · **S-02만 PRD v4.7 / 플로우 v5.7 (D-09 변경 2026-11-04: Google 로그인만)** · **S-08 C-22·C-23만 PRD v4.9 / 플로우 v5.9 / 데이터 모델 v4.7 (D-UX-28 변경 2026-11-04: 독립 프로젝트 첫 저장 때 생성)** · **S-10·S-44·L-02·AI 패널만 PRD v4.12 / 플로우 v5.12 / AI v4.10 / 데이터 모델 v4.10 (UI 개정 ui-panel-doc UP-1~UP-13, 2026-11-04)**
- 디자인 시스템: v5 (v4 = 사용자 지정 브랜드 토큰 2026-11-03, v5 = L-02·S-10·S-44·AI 패널·제안 카드 2026-11-03, v5.3 = C-23 소속 선택 전용 2026-11-04, v5.4 = 알림·경고 모달 공통 모양, v5.5 = AI 패널·제안 확인 줄·문서형 마크다운 편집기·포커스·32px 2026-11-04) · 최종 갱신: 2026-11-04
- 실행: `pnpm install` → `pnpm dev` · 상태 미리보기: 각 화면 `?state=…`, 공통 상태 갤러리 `/dev/states`(개발 모드 전용). W5 추가: `stopping`(S-19), `save-conflict`(커리어 폼, 첫 입력 뒤), `generation-canceled`(S-33), `multi-detail`(S-36)

> AI 패널·문서형 입력 UI 개정 (2026-11-04, 결정 UP-1~UP-13 `_workspace/00_input/planning-decisions-ui-panel-doc.md`, decisions.md 3.17·4.11): 코드를 먼저 고치고 문서를 맞췄다(미커밋). S-10·S-44: 칩(S-10 첫 보냄부터 숨김, S-44 유지)·빠른 응답 삭제, Prompt Input 입력줄([+] 첨부 비활성 · n/40 · C-19 · 보내기), 바닥 따라가기, 제안 = 마지막 AI 턴 아래 확인 줄([자세히], [나중에]·아이콘 없음, 반영 계열 primary, 반영한 섹션 숨김), STAR 직접 고치기 삭제, 분류 [무시]·[반영] 덮어쓰기, S-10 도움말·[AI에게 물어보기] 삭제, 머리 2행·역량 팝오버 [적용], TipTap 마크다운 편집기(표·코드 블록·링크, 400px 안쪽 스크롤), STAR 글자 수 라벨 줄 + 2,000자 하드 상한 오류, S-44 글자 수 삭제, 입력 보존 자동 복원·브라우저 뒤로 이탈 확인, 본문 42rem 제한 해제. **공통 primitive 변경(button·select·input·textarea·input-group·item): 입력 포커스 테두리·링 변화 없음, 좁은 화면 44px → 32px** — 이 primitive를 쓰는 모든 "QA 통과" 행이 영향을 받는다(디자인 위험 DR-1~DR-12, design-system 8.5). UI QA·브라우저 확인 전.

> 독립 프로젝트 만들기 (2026-11-04, D-UX-28 변경, decisions.md 4.7): C-22 "프로젝트"는 이름 다이얼로그 없이 경력·교육과 같은 추가 모달(`AddCareerDialog` kind="project")로 열고 "추가하기" 때 행을 만든다. C-23(`AddProjectDialog`)은 소속 선택 전용 — 이름 칸·"만들기" 제거, "소속 없음" → "계속" → 같은 추가 모달(`choose-project-affiliation.tsx`). 생성 직후 수정 모달을 다시 여는 흐름 제거(`?edit=content`는 C-09용으로 유지). typecheck·lint 통과, 관련 테스트 없음. **브라우저 미확인**(로컬 로그인이 Google 전용이라 이번 런에서 클릭 확인 못 함).

> 새 프로젝트·새 산출물 "추가 중" 표시 (2026-11-04, 33 런): 사용자 보고 — 경력·교육 상세의 "+ 프로젝트 추가"를 누르면 "새 프로젝트가 추가되지 않고 기존 프로젝트 상세로 넘어간다"(산출물도 같음). 원인은 결함이 아니라 표시: PA-3대로 모달 없이 S-10 새 페이지로 가고 행은 첫 저장 때 생기는데, 이동 줄이 `{경력명} › 새 프로젝트 › 프로젝트 상세`로 기존 행 편집 화면과 같고 칸이 모두 비어 있어 오해를 낳았다. **사용자 결정(2026-11-04): 화면 전환 구조와 첫 저장 때 행 생성은 그대로, 표시만 바꾼다.** 이동 줄 현재 위치를 "새 프로젝트 추가"·"새 산출물 추가"로, 머리 맨 위에 새 행 안내(`new-row-notice.tsx`, 점선 `info` Alert, "아직 추가되지 않았어요 / 위 '저장하기'를 누르면 … 추가돼요")를 둔다. 분기는 URL이 아니라 `projectId`·`id` **상태** 기준 — `replaceUrl`이 `history.replaceState`만 쓰므로 서버 prop은 저장 뒤에도 `null`로 남는다. 이 불변식은 소스 가드 테스트(`new-row-notice.test.ts`, 11건, 고의 변형으로 실패 확인)로 묶었다. QA Critical 0·Major 0·Minor 5(UQ-331~335, UQ-334는 해결), CR-11 "L-02 Alert 금지"는 draft 배지 한정이라 충돌 아님으로 판정. lint·typecheck·test(130 파일·2019건) 통과, **브라우저 미확인**(로컬 로그인 Google 전용). 기록: `_workspace/ui/33_brief_new-page-affordance.md` ~ `33_ui-qa_A2_new-page-affordance_review.md`

> L-02 스크롤 정비 (2026-11-04): S-10·S-44에서 창 전체가 스크롤되던 문제 수정(원인: 위치 기준 없는 `sr-only` 라이브 영역이 문서 높이를 늘림). 셸 `relative overflow-clip`, 머리 `DocHead` 카드 높이 40% 상한. QA 0 Critical·0 Major. Minor UQ-SC-1~7·9·10 해결(재검수 `31_ui-qa_l02-minor_recheck.md`, SC-9·10은 리더가 한 줄 수정 후 재검수 없이 lint·typecheck·test로만 확인), UQ-SC-8(역량을 한 줄 배치 아래로 — 명세 순서와 다름)은 기획 확인 필요 → **QA 통과 (mock·브라우저 미확인)**. 같은 날 로고(심볼·워드마크)·Google 프로필 아바타·S-10 머리 필드 한 줄 배치도 반영. 기록: `_workspace/ui/28_brief_l02-scroll-fix.md` ~ `31_ui-qa_l02-minor_recheck.md`

> 브랜드 토큰 정합 (2026-11-03): main의 v4 브랜드 토큰 머지 뒤 v5 화면을 맞췄다(`_workspace/ui/27_ui-qa_v5-brand-conformance.md`, 17건 — 코드 11·문서 8 반영, 재검토는 grep·lint·typecheck·test·build로만, 브라우저 hover 미확인).

> 프로젝트 추가·산출물 상세 런 (2026-11-03): L-02·S-10·S-43 산출물·S-44·C-23 구현. 파운데이션 QA 2라운드 + 영역 QA 2라운드 + 통합 QA, 이슈 Critical 1·Major 12 모두 해결(통합 QA 뒤 마지막 수정 UQ-INT-1~5·UQ-S44-4는 리뷰어 재검토 없이 lint·typecheck·테스트로만 확인). **모두 mock·SSR 렌더 기준이며 브라우저에서 눌러 본 확인은 없다.** DM v4.5 계약(페이지 저장 RPC 반영 기록, 산출물 AI 대화 AI-13)은 2026-11-04 백엔드 R5 연결로 실제 경로가 됐다(브리지와 연결 대기 표시 제거, 브라우저 미확인). 기록: `_workspace/ui/21_brief_project-add.md` ~ `26_ui-qa_project-add_round2-integration.md`
> W5 QA 수정 (2026-11-02): `_workspace/ui/19_ui-qa_w5_review.md`·`_workspace/backend/W5/03_backend-qa_report.md`의 UI 이슈를 고쳤다(UQ-701~703·705~707, QA-W5-01·06 앞부분·08). lint·typecheck·test까지 확인, 브라우저 미확인. 상세: `_workspace/ui/20_frontend-engineer_w5_fixes.md`

> W5 (2026-11-02): "QA 통과"는 모두 mock 기준이다. 실제 백엔드 연결 뒤 UI QA는 아직 하지 않았다. W5에서 고친 화면은 lint·typecheck·test·build와 HTTP 확인까지이고 클릭은 해 보지 않았다. 상세: `_workspace/backend/W5/02_ui_notes.md`

| 화면 ID | 화면명 | 영역 | 라우트 | 상태 | 열린 이슈 | 마지막 QA |
|---|---|---|---|---|---|---|
| L-01 | 대시보드 셸 (sidebar-08·아이콘 레일·고정 헤더·NavAiStatus) | A0 | `(dashboard)/layout` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-28 | 오류 | A0 | not-found / error | QA 통과 (BYOK) | — | 2026-10-28 BYOK 통합 |
| C-01~C-10, C-12~C-14, C-17~C-21, ST-* | 공통 컴포넌트·상태 뷰 (v2: C-18 AiLock · C-19 ProviderBadge · C-20 AiErrorNotice · C-21 DataUseConsent · AiRunButton) | A0 | `/dev/states` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-01 | 랜딩 | A1 | `/` | QA 통과 | — | 2026-10-25 R2 |
| S-02 | 가입/로그인 | A1 | `/sign-in` | 구현 수정 (2026-11-04 사용자 요청), UI QA 미검토 · 브라우저 미확인 | (2026-11-04 사용자 요청) 상단 헤더·Card 제거 — `src/app/(bare)/sign-in`으로 옮겨 `(public)` 헤더를 피함(URL 그대로). 화면 가운데 심볼 `size-10` + 워드마크 `h-6` 가로 배치(누르면 S-01), 그 아래 제목 "Resumate에서 커리어 준비를 시작해요"·Google 버튼(부제 없음 — 02 S-02 "처음이면 바로 가입" 안내 생략, 기획 확인 필요)·약관 안내 `[UI-가정]`. design-system 6 A1의 S-02 "Card max-w-md" 규칙과 달라짐 → ui-designer 반영 필요. 이전: 없음 (UQ-733은 design-system 6 A1에 `max-md:h-auto` 반영으로 해결). v5.7(D-09 변경 2026-11-04): Google 로그인만 남김. 이메일 매직 링크·재발송·링크 보냄·링크 만료 안내 삭제. 상태: 시작 실패 버튼 아래 한 줄, 콜백 실패(`?error=auth_callback`) 상단 경고 "로그인을 마치지 못했어요"(콜백 실패 때도 `?next=` 유지, UQ-732). `?state=` error · login-error · new-user · deletion-incomplete · loading (`sent`·`link-expired` 삭제). 보고: `_workspace/ui/R6_frontend-engineer-A1_report.md` · QA `_workspace/ui/R6_ui-qa_S-02_review.md`(UQ-725~732 해결) | 2026-11-04 (R6 QA 라운드 2: lint·typecheck·vitest·build 통과) |
| S-03 | 동의 | A1 | `/consent` | 구현 (#24), UI QA 미검토 · dev 서버 렌더 확인 (이전: W5 QA 수정) | (플로우 v5.8, PT-5) 필수 "만 14세 이상이에요" 확인(모두 동의 포함, 저장 안 함). W5 QA 수정(QA-W5-08): 동의 뒤 이동 `next` 검사를 서버 계약판과 통일 | 2026-11-04 처리방침·약관 |
| S-24 | 설정 | A1 | 설정 다이얼로그(sidebar-13)만, `?settings=` 주소로도 열림 (2026-11-04 페이지 삭제) | QA 통과 (v5.3) | — | 2026-10-30 v5.3 통합 |
| S-25 | 회원 탈퇴 | A1 | `/settings/withdraw` | QA 통과 (v5.3) | — (UQ-90 해결: NFR-PRV-06 v4.1) | 2026-10-30 v5.3 통합 |
| S-30 | 정책 | A1 | `/policies/terms` · `/policies/privacy` · `/policies/cross_border_transfer` (예전 `/policies?doc=`는 `next.config.ts`에서 308) | 구현 (#24), UI QA 미검토 · dev·prod 빌드 확인 (이전: QA 통과 (BYOK)) | (플로우 v5.8, PT-6) 탭 한 화면 → 문서별 페이지, 하단 다른 문서 링크. 본문 확정(PT-1, `docs/legal/`) | 2026-11-04 처리방침·약관 |
| S-04 | 기본 프로필 편집 | A2 | `/career/profile` | QA 통과 | — | 2026-10-25 R2 |
| S-08 | 커리어 (2026-11-03: S-43 산출물 섹션·C-23 범위 축소·`?edit=` 추가, QA 통과 mock 기준) | A2 | `/career?item={kind}:{id}` | 32 런(2026-11-04): 빈 상태 레이아웃(목록 머리 "커리어 추가" 상시·칸별 가운데 안내)·교육 이름 = 교육 명. QA 통과 (mock·브라우저 미확인) | ~~UQ-734~738~~ 해결 2026-11-04 (35 런): UQ-734는 PR #29(`86edf30`)에서 이미 고쳐짐 — `getCareerList`·`getProjectDetail`·`getNewProjectPage`가 `educationDisplayName` 사용, 로컬 통합 테스트 통과(브라우저 미확인). UQ-735 교육 이름 규칙 한 곳(`server/services/career/education-name.ts`, 컴포넌트·mock은 위임), UQ-736 `career-overview.test.ts`, UQ-737 넓은 화면 두 안내 칸 전체 높이 기준 가운데(브라우저 미확인), UQ-738 디자인 시스템 ST-EMPTY 예외. 2단 목록+상세(S-09·S-34·S-43 보기). 커리어 추가 → 경력/교육 이수/개인 프로젝트 모달에서 한 번에 생성(자동 저장·작성 중 표시 없음, 소속 프로젝트·경력 단위 성과 제외). 상세 패널 “수정”은 같은 모달을 채운 채로 열어 저장. 교육 정보에서 구분 숨김, 독립 프로젝트에 링크 표시. [UI-가정] 교육 직무 필드 제외(컬럼 없음), 교육 이수 = 구분 course. 아직 없음: C-23·C-24 인라인 편집, 소속 프로젝트 추가·상세는 기존 화면, 종류 태그·산출물 표시, 셸 메뉴 이름(CR-12) | 2026-11-04 35 런(lint·typecheck·test, 브라우저 미확인) |
| S-09 | 경력 편집 | A2 | `/career/experiences/new\|[id]` | W5 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과) | W5: client_id·충돌·기간 안내. W5 QA 수정: 재직 중 토글·첫 저장 두 번 유실의 거짓 충돌(UQ-702·QA-W5-06), 충돌 버튼 44px(UQ-705), 선택 뒤 포커스(UQ-706) — 브라우저 미확인 | 2026-11-02 W5 QA |
| S-34 | 교육 편집 (예전 폼, PRD v4.10 / 플로우 v5.10 / 데이터 모델 v4.8 ED-6·ED-7) | A2 | `/career/educations/new\|[id]` | ED-6·ED-7 수정 2026-11-04, lint·typecheck·test 통과 · 브라우저 미확인 | 2026-11-04 ED-6·ED-7: 입력 라벨 "교육 명"·"운영 기관 *"(S-08 모달 순서), C-24 충돌 필드 라벨 같음, 구분·상태 입력 제거 → 새 교육 `course`·수정 땐 구분 유지, 상태는 "진행 중" 체크와 종료월에서(`education-derive.ts`, 모달과 공용) — 학위 과정 생성 불가. 경로 유지(C-02 mock 근거 링크 `evidence.ts:102`가 사용, S-09 예전 폼도 남음). W5: client_id·충돌·기간 안내 — 브라우저 미확인(로컬 로그인 Google 전용) | 2026-11-04 (리더 직접, ui-qa 미실행) |
| S-10 | 프로젝트 상세 (전체 페이지, v5.6) | A2 | `/career/projects/new?experience=\|education=`, `/career/projects/[id]` (`(page)` 그룹) | UI 개정 ui-panel-doc(2026-11-04) 구현, UI QA 미검토 · 브라우저 미확인 (이전: 33 런(2026-11-04): 새 프로젝트일 때 이동 줄 "새 프로젝트 추가" + 머리 새 행 안내. QA…) | 백엔드 연결됨(2026-11-04 R5 연결: 페이지 저장 `save_project_page`가 반영 기록을 남김, 대화 시작 `p_form_snapshot`, 턴 `formSnapshot`) — **브라우저 미확인**. 새 페이지 저장의 `client_id`는 실제 경로에서 쓰지 않음(응답 유실 뒤 재시도면 행이 둘 생길 수 있음, spec-gaps R5-W-1). UQ-331·332 Minor(디자인 시스템 문서·점선 가시성), UQ-333 Minor(낮은 창에서 초기 포커스가 안내를 머리 밖으로 밀 수 있음) | 2026-11-04 33 런 QA |
| L-02 | 전체 페이지 셸 (로고·[Resumate AI]·저장하기·계정, 이동 줄, 이탈 확인·입력 보존, 장애 배너, 오류 경계) | A0 | `(page)/layout` | UI 개정 ui-panel-doc(2026-11-04): 입력 보존 자동 복원·브라우저 뒤로/앞으로 이탈 확인·본문 스크롤바 auto-hide·42rem 해제, UI QA 미검토 (이전: QA 통과 (2026-11-03 PA, 브라우저 미확인)…) | — | 2026-11-03 PA 통합 |
| S-44 | 산출물 상세 (전체 페이지 + AI 패널 본문 초안 카드) | A2 | `/career/projects/[id]/deliverables/new`, `/career/deliverables/[id]?range=` | UI 개정 ui-panel-doc(2026-11-04) 구현, UI QA 미검토 · 브라우저 미확인 (이전: 33 런(2026-11-04): 새 산출물일 때 이동 줄 "새 산출물 추가" + 머리 새 행 안내. QA 통…) | 백엔드 연결됨(2026-11-04 R5 연결: 저장 `save_project_deliverable`·반영 기록, 산출물 대화 시작·턴(AI-13 SSE)·사실/블록 수락·거절, 대화 기록 목록) — **브라우저 미확인**. `backend_pending` 안내 경로 제거. UQ-331·332·333 Minor(S-10과 같은 건) | 2026-11-04 33 런 QA |
| ~~S-35~~ | ~~상세 내용 편집~~ — 폐기(CR-2). 옛 URL은 S-10으로 redirect | A2 | `/career/projects/[id]/details/**` → S-10 | 폐기 | — | 2026-11-03 PA 통합 |
| S-11 | 정량 성과 (모달) | A2 | `?achievement=` | W5 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과) | W5: client_id·충돌. W5 QA 수정: 거짓 충돌("1,000" 쉼표·첫 저장 유실), 충돌 버튼 44px, 선택 뒤 포커스 — 브라우저 미확인 | 2026-11-02 W5 QA |
| S-12 | 스킬 목록 | A2 | `/career/skills` | QA 통과 | — | 2026-10-25 R2 |
| ~~S-36~~ | ~~AI 작성 대화~~ — 폐기(CR-5). S-10·S-44 Resumate AI 패널로 대체, 옛 URL은 redirect | A2 | `/career/writing-chats/**` → S-10 / S-08 | 폐기 | — | 2026-11-03 PA 통합 |
| S-13 | 기업 JD 목록 | A3 | `/applications` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-14 | 기업 JD 추가 | A3 | `/applications/new` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-31 | 지원 프로젝트 허브 | A3 | `/applications/[id]` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-15 | JD·요건 | A3 | `/applications/[id]/jd` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-16 | 인사이트 | A3 | `/applications/[id]/insight` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-17 | 서류 초안 목록 | A3 | `/applications/[id]/drafts` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-18 | 자소서 문항 설정 | A3 | `/applications/[id]/drafts/[draftId]/questions` | W5 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과 (v5.3)) | W5: 빈 문항 저장 건너뜀. W5 QA 수정(UQ-703): 화면에서 비운 문항이 있으면 "전체 문항 생성" 비활성, 전체 생성 전 입력 저장 — 브라우저 미확인 | 2026-11-02 W5 QA |
| S-19 | 초안 편집기 | A3 | `/applications/[id]/drafts/[draftId]` | W5 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과 (Q53)) | W5: 실제 생성 시작(패치), 중단 대기 표시. 실제 스트림 끝까지 미확인. 새로고침 후 재연결·done.draftId 미구현; A3 UQ-84 (c)~(g) 실제 백엔드로 보류. W5 QA 수정: 실패 경력기술서 다시 열기 C-20·다시 시도(UQ-701), "포함하지 않은 항목" 프로젝트 이름·이유 문구(QA-W5-01), 중단 대기 문구 "최대 20초쯤"(UQ-707) — 브라우저 미확인 | 2026-11-02 W5 QA |
| S-20 | 면접 준비 | A4 | `/applications/[id]/interview` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-33 | 면접 답변지 | A4 | `/applications/[id]/interview/[sessionId]` | W5 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과 (Q53)) | W5: 중단한 생성은 남은 질문으로 | 2026-10-30 Q53 |
| S-22 | 면접 결과 | A4 | `/applications/[id]/interview/[sessionId]/result` | W5 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과 (Q53)) | W5: 일관성 메모 인용·근거 | 2026-10-30 Q53 |
| S-37 | 모의 면접 전체 세션 | A4 | `/interviews` | W5 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과 (Q53)) | W5: 없는 세션 삭제는 안내 후 새로 읽기 | 2026-10-30 Q53 |
| S-40 | AI 연결 | A1 | 설정 다이얼로그 섹션 "AI 연결" (2026-11-04 페이지 삭제) | QA 통과 (v5.3) | — | 2026-10-30 v5.3 통합 |
| S-41 | 키 연결 단계 | A1 | `/settings/ai/connect` (집중 화면, `(focus)` 레이아웃) | QA 통과 (BYOK 신설) | — | 2026-10-28 BYOK 통합 |
| S-42 | AI 사용량 | A1 | 설정 다이얼로그 섹션 "AI 사용량" (2026-11-04 페이지 삭제) | QA 통과 (BYOK 신설) | — | 2026-10-28 BYOK 통합 |
| S-39 | 지원 현황 보드 | A4 | `/board` | QA 통과 (Q53) | — | 2026-10-30 Q53 |

- BYOK 반영(2026-10-28): 기획 문서는 main(6fc33e7)에서 작업 트리로만 가져옴(커밋·main 병합 없음 — 사용자 결정: 백엔드 작업이 끝난 뒤 병합·실제 백엔드 연결). 디자인 시스템 v2 → 파운데이션 → A1~A4 → 영역 QA 1라운드(Major 4: UQ-200·230·320·321) → 수정·파운데이션 배치 → 통합 QA(1라운드 이슈 50건 중 46 해결·2 리더 결정·1 기획 대기·1 문서 정렬, 새 Minor 5) → 단일 정리 라운드(UQ-350~354) 처리. 정리 후 lint·typecheck·build 통과(리더 직접 실행), 정리 후 재검수는 하지 않음.
- 통합 QA(2026-10-25): Critical 0 / Major 0 / Minor 8 → 단일 정리 라운드에서 모두 처리.
- 브라우저 확인 미실시: Chrome 확장이 연결되지 않아 모든 QA가 curl + 코드 판독으로 진행. 키보드 드래그, 다이얼로그 포커스, 서랍, 토스트, 스트리밍, 자동 저장 경합, 좁은 화면 터치 크기는 사람이 한 번 확인 필요.

## 리더 결정 기록
- 2026-11-04 사용자: 설정은 전부 다이얼로그 — `/settings`·`/settings/ai`·`/settings/ai/usage` 페이지 삭제. 다이얼로그가 없는 화면은 `/career?settings={section}`. S-41 `/settings/ai/connect`(셸 밖 집중 화면)와 S-25 `/settings/withdraw`·`/finalize`(동의 게이트 밖, A7)는 페이지로 남김
- 2026-10-28 리더(BYOK 2): S-41 좁은 화면도 집중 화면 / S-31 키 없음은 명세의 표식 / AI-11은 키가 있는 첫 진입에만 자동 1회, AI 연결 복귀 후 자동 실행·사용자 선택 덮어쓰기 없음 / key_missing 등 모든 원인은 재연결 후 "다시 시도"(자동 실행 없음) / 등급 글자 "무료 등급"·"유료 등급"(기획 B-6 대기) / 다시 하기 주석은 디자인 3.22 caption 12px / FL-19 복귀 문장은 기능 이름 고정 목록 `AI_FEATURE_NAMES`(기획 B-24 대기) / 가입 동의에서 cross_border_transfer 제외(S-03 v5)
- 2026-10-28 리더(BYOK): Q-4 공급자 로고 없이 글자만 / Q-5 S-41은 셸 밖 집중 화면(`(focus)` 라우트 그룹) / Q-6 공급자 URL은 `src/lib/mock/ai-providers.ts` 상수(`ai_providers` 모양) / S-40·S-42는 페이지와 설정 다이얼로그 섹션이 같은 내용 컴포넌트(`account/ai-connection-panel`, `account/ai-usage-panel`)를 쓴다
- 2026-10-25 사용자: 셸을 shadcn sidebar-08(inset)로, 접으면 아이콘 레일 / 2026-10-26 사용자: 사이드바의 설정을 shadcn sidebar-13 다이얼로그로
- 2026-10-24 사용자: primary 초록 계열, 본문 16px
- 2026-10-24 리더: Pretendard 저장소 포함 허용 / 다크 모드는 시스템 설정만 따름(next-themes 없음) / cmdk 허용 / C-12·C-13·C-14 파운데이션 이관 / `cn` 패키지(shadcn-ui/cn, shadcn CLI 의존성) 허용
- 2026-10-25 리더: S-24 폭 `max-w-form` / 768px 미만 모든 조작 요소 44px(공통 컴포넌트가 보장) — **대체됨 2026-11-04(UP-12): 32px, 예외 목록은 design-system A-4** / 제출 실패 문구 틀 통일(`submitFailedMessage`) / 자소서 게이트 params 키 `draft_id` / 영역 임시 데이터 함수는 `lib/`로 이전
- 2026-10-30 사용자(Q53-1~10): 기획 질문에 답함. 임시 처리 UQ-580(S-14 추출 없이 저장)·UQ-588(S-17 직접 고르기로 시작)은 결정대로 되돌렸다. 설정에 "화면" 섹션(시스템 설정·라이트·다크)을 추가했다(디자인 시스템 Q-2).

## 기획 확인 필요 (누적)
- (33 런, P-331~P-334) 새 프로젝트·새 산출물 "추가 중" 표시 — 코드가 앞서 간 부분: ① 이동 줄 현재 위치를 새 행에서 "새 프로젝트 추가"·"새 산출물 추가"로 바꾼 것(02-user-flows.md:212 L-02 이동 줄 표는 "프로젝트 상세"·"산출물 상세" 고정 + 빈 이름 자리 표시 "새 프로젝트") ② 빈 이름일 때 자리 표시 칸을 빼는 것이 맞는지 ③ 머리 새 행 안내를 S-10·S-44 머리 표 정식 행으로 넣을지와 확정 문구(QA 의견: "쓰는 중이에요"가 프로젝트에는 덜 자연스러움) ④ 첫 저장 성공 확인이 C-06 "저장됨 HH:MM" 하나뿐인데 "커리어에 추가됐어요" 같은 확인을 둘지 — 사용자 원래 불만과 직결되나 이번 범위 밖. design-system 6장 A2(:1845)의 "새 프로젝트는 같은 화면의 빈 상태다" 서술도 코드와 어긋나 갱신 필요(UQ-331).
- ~~(32 런, UQ-739) S-08 빈 상태·교육 이름 규칙 기획 반영~~ → **해결 2026-11-04**: 기획 사이클 education-name ED-1~ED-7(PRD v4.10 / UX v5.10 / AI v4.7 / DM v4.8, `docs/planning/decisions.md` 3.14·4.8). UI 후속: 예전 `education-form.tsx` 라벨·구분·상태 입력(4.7), S-17/S-31 출처 트리 교육 보조 줄 "운영 기관 · 기간"은 UX v5.10 C-11과 일치 확인됨(리뷰).

### 2026-11-03 프로젝트 추가·산출물 상세 런 (상세: `_workspace/ui/26_ui-qa_project-add_round2-integration.md` 7장)
- ~~**사용자 답 대기 P-1**: C-22 "프로젝트"를 피그마 1009:2 일괄 추가 모달로 둘지, 이름 다이얼로그 → S-43 수정 모달 두 단계로 둘지~~ → **닫힘 2026-11-04**: 일괄 추가 모달(D-UX-28 (b)로 변경, 구현 완료)
- 문서 정리(리더 판정 완료): AI-12 문구를 UX에 맞추기(K1·K2), S-44 "마무리 중" 없음(P-3), S-44 `?range={start}-{end}` 형식, 부모가 소속 프로젝트로 바뀐 산출물 저장 처리(UQ-S44-14)
- S-10: ~~"AI에게 물어보기" 고정 문구~~(기능 삭제, UP-7), 기간 제안 카드 모양, "본인 역할 확인 중" 클릭 목적지, [모두 반영] 되돌리기 범위, 이름 빈 새 페이지 시작 인사
- S-44·AI-13: 회고 슬롯 1의 `scope` 재사용, `base_body_hash` 정규화, 초안 6회 때 칩 구성, "초안 작성 중" 문구 원천, 자유 입력 초안 턴 판정
- L-01 ↔ L-02 계정 메뉴 2항목 vs 5항목, 이탈 확인 설명 문구
- 디자인 P-15~P-20 (`_workspace/ui/21_ui-designer_project-add_notes.md`)
- 백엔드 전달: 칩 표가 서버 `focus-slots.ts`에도 있음(UQ-S10-14). (DM v4.5 11.3 연결은 2026-11-04 R5 연결로 완료)


- **Q53 후 남은 것**: 혼합 세션의 같은 행 다시 시도(R-63), S-17 "새 경력기술서" 버튼 대상 등. `_workspace/ui/17_ui-qa_q53_review.md`, `18_frontend-engineer_q53_fixes.md`
- **v5.3 통합 나머지(가정 유지 가능) Q-10~Q-28**: `_workspace/ui/13_ui-qa_v53_integration_review.md` "기획 확인 필요" B절
- **BYOK 29건(B-1~B-29)**: `_workspace/ui/07_ui-qa_byok_integration_review.md` 마지막 절. 우선 B-24(FL-19 복귀 문장의 기능 이름), B-6(등급 글자), B-2(유료 등급에도 "무료 한도" 문구를 쓰는지)
- 초기 실행분:
- 중복 제거 35건(K-1~K-35): `_workspace/ui/04_ui-qa_integration_review.md` 마지막 절
- 우선: ~~K-16~~(PRD v4.1 NFR-PRV-06으로 해결), K-1("v3와 같음" 원문 부재), K-27(경력기술서 재생성 = 새 행 vs 덮어쓰기), K-22(S-09 종료월이 완료 조건인지)

## [UI-가정] 요약
- 디자인 시스템 G-1~G-13, 각 영역 보고서(`_workspace/ui/0{2,3}_frontend-engineer-*_report.md`)의 [UI-가정] 목록 참고. 대부분 K-1(v3 원문 부재)에서 나온 문구·구성 가정
