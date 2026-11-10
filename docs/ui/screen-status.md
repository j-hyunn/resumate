# 화면 구현 현황
- 기준 기획: PRD v4.6 / 플로우 v5.6 / AI v4.6 / 데이터 모델 v4.5 (PA-1~PA-4 반영, 2026-11-03 — 이번 런의 대상 화면만. 나머지 화면은 이전 기준 v5.4a 그대로) · **S-02만 PRD v4.7 / 플로우 v5.7 (D-09 변경 2026-11-04: Google 로그인만)** · **S-08 C-22·C-23만 PRD v4.9 / 플로우 v5.9 / 데이터 모델 v4.7 (D-UX-28 변경 2026-11-04: 독립 프로젝트 첫 저장 때 생성)** · **S-10·S-44·L-02·AI 패널만 PRD v4.12 / 플로우 v5.12 / AI v4.10 / 데이터 모델 v4.10 (UI 개정 ui-panel-doc UP-1~UP-13, 2026-11-04)**
- **S-44 본문 칸 높이만 플로우 v5.19 (DH-1, 2026-11-08)**
- **36 런(2026-11-05) 대상만 PRD v4.13 / 플로우 v5.13 / AI v4.11 / 데이터 모델 v4.11** (열린 결정 일괄 OD-*, decisions.md 3.18·4.12): C-05·C-14·C-17·C-18·C-19·C-20·C-21·S-10·S-44·S-18·S-22·S-33·S-37·S-39·S-40·S-24·S-30
- **42 런(2026-11-06) 대상만 PRD v4.14 / 플로우 v5.17a / AI v4.12a / 데이터 모델 v4.12a** (새 설정 다이얼로그 SD-*, decisions.md 3.22·3.23·4.16): S-24·S-40·S-42·S-30·S-04(폐기)·C-01·C-02. **브라우저 미확인**(사용자 결정 2026-11-06 — Chrome 확장 미연결, 이번엔 건너뜀)
- **44 런(2026-11-08) 대상만 PRD v4.16 / 플로우 v5.19 / AI v4.14 / 데이터 모델 v4.14** (AI 모의 면접 MVP 제외 RM-1~RM-5, decisions.md 4.21 UI 1~7, 보고 `_workspace/ui/44_frontend-engineer_report.md`): S-20·S-22·S-33·S-37·C-14·C-16·C-17 **폐기**(코드 삭제 + 옛 주소 308), L-01 메뉴 3개, S-39 4열, C-12 4값, S-13·S-31·S-25·S-24 ②·S-40·S-42(5행)·C-01·C-03·C-05·C-09·C-18~C-21·S-01 면접 부분 삭제. **UI QA 미실행 · 브라우저 미확인**
- **45 런(2026-11-09) 대상만 PRD v4.17 / 플로우 v5.20 / AI v4.15 / 데이터 모델 v4.15 + 기획 PR #68(CF-S1~CF-S5, 사용자 확정 2026-11-09 · 미머지)** (자기소개서 관리 흐름 재설계 CF-1~CF-10, decisions.md 3.28·4.23 UI 1~8, 브리프 `_workspace/ui/45_brief_cover-letter-flow.md`): S-13·S-14·S-15·S-16·S-18·S-46·S-39·C-05·C-11·C-18·S-25(라벨)·S-30(본문, CF-S6) / **폐기** S-17·S-19·S-31·S-45. 백엔드 R15(`dba1bff`) 병합 — **실제 경로 일부 연결, 정본 읽기 등 4건 연결 대기**(아래). **브라우저 미확인**(Claude in Chrome 미연결, 로컬 로그인 우회 없음)
- 디자인 시스템: **v5.15** (2026-11-09 45 런 — 폐기 S-19·S-45·C-11 체크 트리 묘사 정리, S-13·S-14·S-46·S-39 규칙 신설, CF-S2·CF-S3 반영, 새 토큰 0개) · v5.12 (2026-11-06 설정 다이얼로그를 원본 화면 3장에 맞춤, 5.11 — 모서리 12px·틴트 10% 사용자 확정 DR-13·14) · v5.11 (탭 4개) · v5.7 (2026-11-05 OD-D4: 커리어 항목 추가·수정 모달 공통 규칙·C-24 폐기·되돌리기 삭제) · v5 (v4 = 사용자 지정 브랜드 토큰 2026-11-03, v5 = L-02·S-10·S-44·AI 패널·제안 카드 2026-11-03, v5.3 = C-23 소속 선택 전용 2026-11-04, v5.4 = 알림·경고 모달 공통 모양, v5.6 = S-02 헤더·카드 없는 배치 + L-02 새 행 안내(UQ-331~333) 2026-11-04, v5.5 = AI 패널·제안 확인 줄·문서형 마크다운 편집기·포커스·32px 2026-11-04) · 최종 갱신: 2026-11-04
- 실행: `pnpm install` → `pnpm dev` · 상태 미리보기: 각 화면 `?state=…`, 공통 상태 갤러리 `/dev/states`(개발 모드 전용). 38 런 추가: `ai-failed-daily-quota-reset`(C-20). W5 추가: `save-conflict`(커리어 폼, 첫 입력 뒤), `multi-detail`(S-36). (44 런) `generation-canceled`(S-33)·`interview-prompt`(C-14) 삭제
- **(46 런 A0, 플로우 v5.20 CF-*) 자기소개서 흐름 `?state=` 키** — 갤러리 `/dev/states?state=cover-letter`에 링크가 모여 있다. 화면은 A3·A4가 만든다.
  - S-13 `/applications`: `empty` · `loading` · `error`
  - S-14 2단계 모달(S-13·S-39 위, `?new=1&state=`): `step1` · `fetching` · `fetch-failed` · `extracting` · `extract-failed` · `step2` · `close-confirm` · `creating` · `create-failed` · `invalid-source-url` (+ 공통 `consent-required` · `key-invalid` · `key-missing`)
  - S-46 `/applications/{id}/cover-letter`: 문항 설정 상태 `questions` · `questions-invalid` · `questions-max` · `extracting` · `extract-failed` / 작성 상태 `writing` · `empty-answers` · `save-failed` · `save-conflict` · `too-many-questions` · `not-found` · `unauth` / 패널 `draft-stream` · `draft-failed` · `draft-limit` · `ai-locked` / 탭 `?tab=jd`·`?tab=insight`는 S-15·S-16의 기존 키(`raw-*` 등)를 그대로 쓴다
  - **삭제된 키**(폐기 화면): S-19 `stopping`(초안 편집기 중단 대기 — `PREVIEW_STATES`에서도 뺐다) · S-17 `no-requirements`·`no-requirements-consent`·`no-requirements-key-invalid`. `/dev/states`의 Q53-4·Q53-7 줄도 지웠다. `finalizing`·`wait-jd`는 C-04·요건 선행 추출 공통 키라 남는다

> S-44 본문 칸 높이 고정 해제 (2026-11-05, 41 런, 사용자 요청, 기록 `_workspace/ui/41_s44-body-height.md`): `DocTextarea`에 `grow` 옵션을 만들어 S-44 본문 칸의 400px 상한·칸 안 스크롤을 없앴다 — 칸은 내용만큼 자라고(최소 `min-h-[24rem]`) 넘치는 만큼은 왼쪽 입력 영역이 스크롤한다. 근거 구간 강조·AI 채우기 스크롤도 그에 맞게 고쳤다. **S-10 STAR 칸은 400px 유지**(UP-9). design-system v5.10. lint·typecheck 통과, vitest 151 파일 2407건 통과. **UI QA 미실행 · 브라우저 미확인**. 기획 반영 완료(2026-11-08, UX v5.19 DH-1, decisions 3.26).

> **40 런 UI QA (2026-11-05, S-02·S-03·L-02·39 런 정리분, `_workspace/ui/40_ui-qa_review.md`·`40_frontend-engineer_fix_report.md`)**: Critical 0 · Major 2(UQ-420 게이트 → S-08 모달 저장 뒤 C-10 재판정·FL-13 다음 단계 누락 — 39 런 회귀, UQ-421 L-02 보존본이 다른 곳의 새 저장을 덮어씀) · Minor 9 — 모두 수정. 기획 확인 2건은 사용자 확정(U40-1·U40-2, decisions 3.21). 로그아웃·탈퇴 때 L-02 보존 입력과 S-14 공고 초안·복귀 대상 키도 지움(테마·AI 패널 설정은 유지). 옛 S-09·S-34 주소는 `next.config.ts` 308. lint·typecheck·build 통과, vitest 151 파일 2407건 통과. **브라우저 미확인** — 확인할 것은 리뷰 "브라우저 확인" 절(뒤로/앞으로 3개 브라우저, 두 탭 UQ-421 재현, 옛 주소 redirect, 게이트 → 모달 저장 뒤 C-10).

> **38 런 UI QA (2026-11-05, 36·37 런 대상, `_workspace/ui/38_ui-qa_36-37_review.md`·`38_frontend-engineer_fix_report.md`)**: Critical 0 · Major 2(UQ-380 등급 라벨 우수/양호/보완 필요/미흡/해당 없음, UQ-381 S-22 질문별 `score_rationale`) · Minor 8 — 모두 수정. 분류 [무시]는 `localStorage` 대신 서버 판정(값 비고 rev ≥ 2). 새 `?state=ai-failed-daily-quota-reset`(C-20 초기화 줄). design-system v5.9. lint·typecheck·build 통과, vitest 147 파일 2386건 통과. **브라우저 미확인** — 확인할 것 7가지는 리뷰 Q12 절.

> S-09·S-11 정리 (2026-11-05, 39 런, 기록 `_workspace/ui/39_brief_s09-s11-cleanup.md`): 옛 S-09 경력 편집 페이지와 S-11 정량 성과 코드를 지웠다. `routes.experienceNew`·`routes.experience` 삭제 → `routes.careerNew(kind)`(S-08 `?new={kind}`로 추가 모달 열기 `[UI-가정]`)·`routes.careerItem`. 옛 `/career/experiences/new|{id}`는 S-08로 redirect. 옛 `achievement` 근거(R4 마이그레이션이 DB 행을 지움, mock 픽스처에만 남음)는 링크 없이 "원본 삭제됨". S-25 삭제 범위 "상세 내용·정량 성과" → "산출물"(UX v5.5, 계약 `projectDeliverables`). S-34 예전 교육 폼 페이지도 같은 방식으로 지웠다(`/career/educations/new|{id}` → S-08 redirect, 근거 칩 교육 → `routes.careerItem`). 남은 것: S-16 "정량 성과" 문구는 38 런(PR #51) 담당. lint·typecheck·test·build 통과. **UI QA 미실행 · 브라우저 미확인**.

> UI 36 런 기획 확인 확정 후속 (2026-11-05, 37 런, decisions.md 3.19·4.13 U36-1~U36-5, UX v5.14, 보고 `_workspace/ui/37_frontend-engineer_u36_report.md`): ① "자기소개서 삭제됨" 면접 = `/interviews/{sessionId}/result`(`routes.interviewDeletedResult`, S-22 본문은 `result-screen.tsx`로 공유), 옛 `/applications/{id}/interview/{sessionId}[/result]`·36 런 임시 경로는 새 주소로 이동, 아직 있는 자기소개서의 세션은 원래 S-22로 ② CR-23 전체 적용: 메뉴·이동 경로 "자기소개서 관리", 화면 안 "기업 JD" 0곳(contracts 주석 2곳만), `cover_letter` = "자소서 문항 답변"(S-17·S-18 "자소서 문항 설정"·C-05·S-42·AI 기능 이름) ③ 처리방침 1번·이용약관 2조 "정량 성과" 삭제 ④ design-system v5.8(답 없는 메시지 줄, P-21 해소). lint·typecheck·build 통과, vitest 2358건 중 4건 실패(36 런과 같은 로컬 통합 테스트). **UI QA 미실행 · 브라우저 미확인**.

> 열린 결정 일괄 확정 UI 후속 (2026-11-05, 36 런, decisions.md 4.12 UI 1~14, UX 5.1i): 기록 `_workspace/ui/36_brief_od-ui-followups.md`, 보고 `36_frontend-engineer-A2_report.md`·`36_frontend-engineer-A4_report.md`. ① S-22·C-17 가중 100점 표시(`interview-session-view.ts`): "{n}점 / 100"·"미응답 n개(0점으로 반영)", 모두 미응답이면 "답변이 없어 0점이에요", `not_scored`는 답이 있는데 채점 0개일 때만, `pending_method` 동안 항목 등급·다음 연습 숨김 ② OD-I6 "자기소개서 삭제됨" 세션: S-37 표시·필터·메뉴는 삭제만, S-22·S-33 읽기 전용, 라우트 `/applications/deleted/interview/{id}/result` `[UI-가정]` ③ C-05 K-2·K-3 문구, 자기소개서 삭제 "작성 중인 면접 {N}" + "끝난 모의 면접 {M}개는 기록에 남아요", 커리어 삭제 "삭제된 자기소개서의 면접 기록 {n}개" ④ S-10·S-44 첫 저장 토스트, 채우기 되돌리기 삭제, 초안 6회 고정 칩 3개, 답 없는 메시지 "답을 받지 못한 메시지예요 · 다시 보내기", 실행 중 키 삭제만 C-20 `key_missing` ⑤ C-20 일일 한도 제목 등급별·초기화 줄은 `quota_resets_at`이 있을 때만·"공급자 토큰", C-19 유료 툴팁, S-40 첫 동의/재동의 줄, C-18 설명 2곳, S-18 문항 삭제 "답변" ⑥ C-21 고지 사실을 `src/lib/ai-disclosures.ts`(AI C-7.1, `v2026-11-05`, Claude "추론 global · 저장 미국")로 옮김, 무료 등급 문장·강조 고지·툴팁은 Gemini 무료만(R-OD-15) ⑦ 국외 이전 고지·처리방침 6번 2026-11-05 개정안을 `policy-content.ts`에 반영(`policy_versions` 행은 백엔드 대기) ⑧ C-14·S-39·S-24 "기업 JD" 잔여 → "자기소개서" ⑨ mock 인사이트 작업 `target_type: application_project`, mock 자기소개서 삭제가 끝난 세션을 남김. lint·typecheck·build 통과. vitest 143 파일 중 로컬 통합 테스트 2 파일 4건 실패 — 공유 로컬 Supabase에 병렬 세션 od-backend의 `d14.v1`·OD-I6 마이그레이션이 이미 적용되어 옛 기대값(`pending_method`·세션 전부 삭제)과 다름(서버 테스트는 od-backend가 갱신). **UI QA 미실행 · 브라우저 미확인**(범위 밖).

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
| L-01 | 대시보드 셸 (**메뉴 3개** 커리어·자기소개서 관리·지원 현황 — 44 런 RM-1, 모의 면접 메뉴·배지·이동 경로 마디 삭제 · sidebar-08·아이콘 레일·고정 헤더·NavAiStatus) | A0 | `(dashboard)/layout` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-28 | 오류 | A0 | not-found / error | QA 통과 (BYOK) | — | 2026-10-28 BYOK 통합 |
| C-01~C-10, C-12·C-13, C-18~C-21, ST-* (~~C-14·C-16·C-17~~ 폐기 RM-1, 44 런 코드 삭제 — `interview-prompt-preview`·`score-display`·C-14 팝업·`AiLockDialog`) | 공통 컴포넌트·상태 뷰 (v2: C-18 AiLock · C-19 ProviderBadge · C-20 AiErrorNotice · C-21 DataUseConsent · AiRunButton) | A0 | `/dev/states` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-01 | 랜딩 | A1 | `/` | QA 통과 | — | 2026-10-25 R2 |
| S-02 | 가입/로그인 | A1 | `/sign-in` | QA 통과 (mock·브라우저 미확인) — 40 런 UI QA + 수정(재검토 없이 lint·typecheck·test·build로 확인, 2026-11-05) (이전: 구현 수정 2026-11-04 사용자 요청) | (2026-11-04 사용자 요청) 상단 헤더·Card 제거 — `src/app/(bare)/sign-in`으로 옮겨 `(public)` 헤더를 피함(URL 그대로). 화면 가운데 심볼 `size-10` + 워드마크 `h-6` 가로 배치(누르면 S-01), 그 아래 제목 "Resumate에서 커리어 준비를 시작해요"·Google 버튼(부제 없음 — UX v5.13 OD-S3로 확정)·약관 안내 `[UI-가정]`. design-system 6 A1의 S-02 "Card max-w-md" 규칙과 달라짐 → ui-designer 반영 필요. 이전: 없음 (UQ-733은 design-system 6 A1에 `max-md:h-auto` 반영으로 해결). v5.7(D-09 변경 2026-11-04): Google 로그인만 남김. 이메일 매직 링크·재발송·링크 보냄·링크 만료 안내 삭제. 상태: 시작 실패 버튼 아래 한 줄, 콜백 실패(`?error=auth_callback`) 상단 경고 "로그인을 마치지 못했어요"(콜백 실패 때도 `?next=` 유지, UQ-732). `?state=` error · login-error · new-user · deletion-incomplete · loading (`sent`·`link-expired` 삭제). 보고: `_workspace/ui/R6_frontend-engineer-A1_report.md` · QA `_workspace/ui/R6_ui-qa_S-02_review.md`(UQ-725~732 해결) design-system 6장 A1은 v5.6에서 이 배치로 갱신(34 런). | 2026-11-04 (R6 QA 라운드 2: lint·typecheck·vitest·build 통과) |
| S-03 | 동의 | A1 | `/consent` | QA 통과 (mock·브라우저 미확인) — 40 런 UI QA + 수정(재검토 없이 lint·typecheck·test·build로 확인, 2026-11-05) (이전: 구현 (#24), dev 서버 렌더 확인) | (플로우 v5.8, PT-5) 필수 "만 14세 이상이에요" 확인(모두 동의 포함, 저장 안 함). W5 QA 수정(QA-W5-08): 동의 뒤 이동 `next` 검사를 서버 계약판과 통일 | 2026-11-04 처리방침·약관 |
| S-24 | 설정 | A1 | 설정 다이얼로그 **탭 4개**(계정 · AI 연결 · 약관 · 개선 요청, 42 런 2026-11-06 — SD-A1), `?settings={tab}` 주소로도 열림, 옛 섹션 ID는 탭·스크롤로 변환 | QA 통과 (mock·브라우저 미확인) — 43 런(2026-11-06) 원본 화면 3장에 맞춤, UI QA 1라운드 Minor 6 수정 | 브라우저 미확인 | 2026-11-06 42 런 |
| S-25 | 회원 탈퇴 | A1 | `/settings/withdraw` | QA 통과 (v5.3) | — (UQ-90 해결: NFR-PRV-06 v4.1) | 2026-10-30 v5.3 통합 |
| S-30 | 정책 | A1 | `/policies/terms` · `/policies/privacy` · `/policies/cross_border_transfer` · **`/policies/ai_data_use`**(42 런, SD-A13 — `policy_versions` 머리글 + 공급자별 요약) (예전 `/policies?doc=`는 `next.config.ts`에서 308) | QA 통과 (mock·브라우저 미확인) — 43 런(2026-11-06) 원본 화면 3장에 맞춤, UI QA 1라운드 Minor 6 수정 | AI 데이터 처리 본문 원문 없음(기획 확인 필요) | 2026-11-06 42 런 |
| ~~S-04~~ | ~~기본 프로필 편집~~ **폐기** (SD-A2) | — | `/career/profile` → `/career?settings=account` 영구 리다이렉트 | 폐기 2026-11-06 (42 런) | — | 2026-11-06 42 런 |
| S-08 | 커리어 (2026-11-03: S-43 산출물 섹션·C-23 범위 축소·`?edit=` 추가, QA 통과 mock 기준) | A2 | `/career?item={kind}:{id}` | 32 런(2026-11-04): 빈 상태 레이아웃(목록 머리 "커리어 추가" 상시·칸별 가운데 안내)·교육 이름 = 교육 명. QA 통과 (mock·브라우저 미확인) | ~~UQ-734~738~~ 해결 2026-11-04 (35 런): UQ-734는 PR #29(`86edf30`)에서 이미 고쳐짐 — `getCareerList`·`getProjectDetail`·`getNewProjectPage`가 `educationDisplayName` 사용, 로컬 통합 테스트 통과(브라우저 미확인). UQ-735 교육 이름 규칙 한 곳(`server/services/career/education-name.ts`, 컴포넌트·mock은 위임), UQ-736 `career-overview.test.ts`, UQ-737 넓은 화면 두 안내 칸 전체 높이 기준 가운데(브라우저 미확인), UQ-738 디자인 시스템 ST-EMPTY 예외. 2단 목록+상세(S-09·S-34·S-43 보기). 커리어 추가 → 경력/교육 이수/개인 프로젝트 모달에서 한 번에 생성(자동 저장·작성 중 표시 없음, 소속 프로젝트·경력 단위 성과 제외). 상세 패널 “수정”은 같은 모달을 채운 채로 열어 저장. 교육 정보에서 구분 숨김, 독립 프로젝트에 링크 표시. [UI-가정] 교육 직무 필드 제외(컬럼 없음), 교육 이수 = 구분 course. 아직 없음: C-23·C-24 인라인 편집, 소속 프로젝트 추가·상세는 기존 화면, 종류 태그·산출물 표시, 셸 메뉴 이름(CR-12) | 2026-11-04 35 런(lint·typecheck·test, 브라우저 미확인) |
| S-09 | 경력 — S-08 패널·추가/수정 모달 (UX v5.5, OD-C2·OD-D4). 예전 편집 페이지 폐기 | A2 | `/career?item=experience:{id}` · 새 경력 `/career?new=experience` (옛 `/career/experiences/new\|[id]` → `next.config.ts` 308 redirect, 규칙 `src/lib/legacy-redirects.ts` — 40 런) | 2026-11-05 39 런: 예전 폼 페이지·`ExperienceForm` 삭제, 옛 경로는 S-08로 redirect(`?achievement=` 버림). 데이터 게이트 "경력 먼저 입력하기"·근거 칩 경력 → S-08. lint·typecheck·test·build 통과 · 브라우저 미확인 | — | 2026-11-05 39 런 (리더 직접, ui-qa 미실행) |
| S-34 | 교육 — S-08 패널·추가/수정 모달 (UX v5.5, OD-C2·OD-D4; ED-6·ED-7 저장 규칙 `education-derive.ts`). 예전 편집 페이지 폐기 | A2 | `/career?item=education:{id}` · 새 교육 `/career?new=education` (옛 `/career/educations/new\|[id]` → `next.config.ts` 308 redirect — 40 런) | 2026-11-05 39 런: 예전 폼 페이지·`EducationForm`·`FreshKey`와 폼 전용 헬퍼(`form-parts` DangerZone·SaveProblemNotice·LongTextField·PeriodError, `education-derive` 폼 값·충돌 필드) 삭제, 옛 경로는 S-08로 redirect, 근거 칩 교육 → S-08. lint·typecheck·test·build 통과 · 브라우저 미확인 | — | 2026-11-05 39 런 (리더 직접, ui-qa 미실행) |
| S-10 | 프로젝트 상세 (전체 페이지, v5.6) | A2 | `/career/projects/new?experience=\|education=`, `/career/projects/[id]` (`(page)` 그룹) | QA 통과 (mock·브라우저 미확인) — 38 런 UI QA 1라운드 + 수정(재검토 없이 lint·typecheck·test·build로 확인, 2026-11-05) (이전: 36 런 OD 후속 반영, UI QA 미검토) (이전: UI 개정 ui-panel-doc(2026-11-04) 구현, UI QA 미검토 · 브라우저 미확인 (이전:…) | 백엔드 연결됨(2026-11-04 R5 연결: 페이지 저장 `save_project_page`가 반영 기록을 남김, 대화 시작 `p_form_snapshot`, 턴 `formSnapshot`) — **브라우저 미확인**. 새 페이지 저장의 `client_id`는 실제 경로에서 쓰지 않음(응답 유실 뒤 재시도면 행이 둘 생길 수 있음, spec-gaps R5-W-1). ~~UQ-331·332·333~~ 해결(2026-11-04, 34 런: design-system v5.6 5.9 "새 행 안내", 테두리 `border-info`, 첫 포커스 `preventScroll` — 브라우저 미확인) | 2026-11-04 33 런 QA |
| L-02 | 전체 페이지 셸 (로고·[Resumate AI]·저장하기·계정, 이동 줄, 이탈 확인·입력 보존, 장애 배너, 오류 경계) | A0 | `(page)/layout` | QA 통과 (mock·브라우저 미확인) — 40 런 UI QA + 수정(재검토 없이 lint·typecheck·test·build로 확인, 2026-11-05): U40-1 로그아웃·탈퇴 때 보존 입력 지움, U40-2 기준 `updated_at`이 바뀐 보존본은 복원 안 함, 뒤로/앞으로 판정을 `leave-guard.ts` 순수 함수로(테스트 14) (이전: UI 개정 ui-panel-doc(2026-11-04): 입력 보존 자동 복원·브라우저 뒤로/앞으로 이탈 확인·본문 스크롤바 auto-hide·42rem 해제, UI QA 미검토 (이전: QA 통과 (2026-11-03 PA, 브라우저 미확인)…)) | — | 2026-11-03 PA 통합 |
| S-44 | 산출물 상세 (전체 페이지 + AI 패널 본문 초안 카드) | A2 | `/career/projects/[id]/deliverables/new`, `/career/deliverables/[id]?range=` | QA 통과 (mock·브라우저 미확인) — 38 런 UI QA 1라운드 + 수정(재검토 없이 lint·typecheck·test·build로 확인, 2026-11-05) (이전: 36 런 OD 후속 반영, UI QA 미검토) (이전: UI 개정 ui-panel-doc(2026-11-04) 구현, UI QA 미검토 · 브라우저 미확인 (이전:…) | 백엔드 연결됨(2026-11-04 R5 연결: 저장 `save_project_deliverable`·반영 기록, 산출물 대화 시작·턴(AI-13 SSE)·사실/블록 수락·거절, 대화 기록 목록) — **브라우저 미확인**. `backend_pending` 안내 경로 제거. ~~UQ-331·332·333~~ 해결(S-10과 같은 건, 34 런 — 브라우저 미확인) | 2026-11-04 33 런 QA |
| ~~S-35~~ | ~~상세 내용 편집~~ — 폐기(CR-2). 옛 URL은 S-10으로 redirect | A2 | `/career/projects/[id]/details/**` → S-10 | 폐기 | — | 2026-11-03 PA 통합 |
| ~~S-11~~ | ~~정량 성과 (모달)~~ — 폐기(UX v5.5, CR-11) | A2 | — (옛 `?achievement=`는 S-09 redirect가 버림) | 폐기 — 2026-11-05 39 런에서 코드 삭제(`achievement-list`·`achievement-dialog`, C-07 G-3, C-05 상세 내용·정량 성과 삭제 대상, S-25 "상세 내용·정량 성과" 줄 → "산출물") | 옛 `achievement` 근거 칩 = "원본 삭제됨" `[UI-가정]` | 2026-11-05 39 런 |
| S-12 | 스킬 목록 | A2 | `/career/skills` | QA 통과 | — | 2026-10-25 R2 |
| ~~S-36~~ | ~~AI 작성 대화~~ — 폐기(CR-5). S-10·S-44 Resumate AI 패널로 대체, 옛 URL은 redirect | A2 | `/career/writing-chats/**` → S-10 / S-08 | 폐기 | — | 2026-11-03 PA 통합 |
| S-13 | 자기소개서 목록 (**v5.20 재작성**, CF-3·CF-9·CF-A8·CF-A14 — 이름·포지션·만든 날·마감 D-day(값 있을 때만), `created_at desc` "최근 작성 순" 고정 표기, 행 ⋯ 삭제만. 단계 칩·기능 진행·"보드로 보기" 없음) | A3 | `/applications` | QA 통과 (mock·브라우저 미확인) — 45 런 UI QA 2라운드(라운드 1 Critical 1·Major 2 → 해소, 라운드 2 Major 1 → 해소, 재검은 리더가 코드·테스트로 확인) | 실제 백엔드: 목록 연결됨(`listApplicationProjects` 위 뷰 모델) | 2026-11-09 45 런 QA 라운드 2 |
| S-14 | 자기소개서 추가 — **2단계 모달** (`AddApplicationDialog`, **v5.20 재작성** CF-8·CF-10·CF-A6·CF-A17 — ① 공고 URL 또는 직접 입력 → [다음](가져오기 → 미리 보기 추출, Q53-1 게이트) ② 기업명·포지션명·공고 내용. "AI 없이 계속" 없음 CF-U1) | A3 | `/applications?new=1` · 보드 위 `?new=1&from=board` (옛 `/applications/new` → 308) | QA 통과 (mock·브라우저 미확인) — 45 런 UI QA 2라운드(라운드 1 Critical 1·Major 2 → 해소, 라운드 2 Major 1 → 해소, 재검은 리더가 코드·테스트로 확인) | 실제 백엔드: 가져오기·미리 보기 추출·생성(`p_source_url`·`p_preview_job_id`·`preview_skip_reason`) 연결됨 | 2026-11-09 45 런 QA 라운드 2 |
| ~~S-31~~ | ~~지원 프로젝트 허브~~ — **폐기 (v5.20, CF-7)** | A3 | `/applications/{id}` → S-46 308 | 폐기 — 2026-11-09 45 런 코드 삭제 | — | 2026-11-09 45 런 |
| S-15 | 채용 공고 — **S-46 왼쪽 탭** (v5.20 재정의, CF-7·CF-A12 — 별도 화면 아님, ID 유지) | A3 | `/applications/{id}/cover-letter?tab=jd` (옛 `/applications/{id}/jd` → 308) | QA 통과 (mock·브라우저 미확인) — 45 런 UI QA 2라운드(라운드 1 Critical 1·Major 2 → 해소, 라운드 2 Major 1 → 해소, 재검은 리더가 코드·테스트로 확인) | 실제 백엔드: JD 요건 추출 연결됨(`runJdExtraction`·`retryJdExtraction` 보존) | 2026-11-09 45 런 QA 라운드 2 |
| S-16 | 인사이트 — **S-46 왼쪽 탭** (v5.20 재정의, CF-7·CF-A12 — 별도 화면 아님, ID 유지) | A3 | `/applications/{id}/cover-letter?tab=insight` (옛 `/applications/{id}/insight` → 308) | QA 통과 (mock·브라우저 미확인) — 45 런 UI QA 2라운드(라운드 1 Critical 1·Major 2 → 해소, 라운드 2 Major 1 → 해소, 재검은 리더가 코드·테스트로 확인) | 실제 백엔드: 기존 인사이트 경로 그대로 | 2026-11-09 45 런 QA 라운드 2 |
| ~~S-17~~ | ~~서류 초안 목록~~ — **폐기 (v5.20, CF-1·CF-7)** | A3 | `/applications/{id}/drafts` → S-46 308 | 폐기 — 2026-11-09 45 런 코드 삭제 | — | 2026-11-09 45 런 |
| S-18 | 자소서 문항 설정 → **S-46의 문항 설정 상태** (v5.20 재정의, CF-5·CF-A10·CF-A11 — 별도 화면 아님) | A3 | S-46과 같은 주소(정본 행 없음) · 옛 `/applications/{id}/drafts/{draftId}/questions` → S-46 308 | S-46 행 참조 | — | 2026-11-09 45 런 |
| ~~S-19~~ | ~~초안 편집기~~ — **폐기 (v5.18 CL-7 · v5.20 CF-1)** | A3 | `/applications/{id}/drafts/{draftId}` → S-46 308 | 폐기 — 2026-11-09 45 런 코드 삭제 | — | 2026-11-09 45 런 |
| ~~S-45~~ | ~~경력기술서 작성~~ — **폐기 (v5.20, CF-1)** | A3 | `/applications/{id}/career-description` → S-46 308 | 폐기 — 구현된 적 없음(리다이렉트만, 45 런) | — | 2026-11-09 45 런 |
| S-46 | 자기소개서 작성 (**L-02**, v5.20 재작성 — 한 주소 두 상태: 문항 설정 / 작성, 정본 행 유무로 판정 CF-A11. 왼쪽 탭 **자소서 · 채용 공고(S-15) · 인사이트(S-16)**. 문항 최대 5개 CF-5, 글자 수 제한 기본 800자 CF-U2, 답변 제목 CF-6(글자 수 미포함), 오른쪽 Resumate AI 패널 + `QuestionProposalCard`. **CF-S1·S2** 근거를 저장 요청에 싣지 않음·C-11 경로 한 줄 / **CF-S3·S5** 문항 설정 상태 저장하기 비활성·⌘S 끔·이유 안내 없음 / **CF-S4** 머리 라벨 "채용 공고") | A3 | `/applications/{id}/cover-letter` (옛 `/career-description`·`/drafts/**`·`/interview/**` → 308, MRG-UX-1) | QA 통과 (mock·브라우저 미확인) — 45 런 UI QA 2라운드(라운드 1 Critical 1·Major 2 → 해소, 라운드 2 Major 1 → 해소, 재검은 리더가 코드·테스트로 확인) | 실제 백엔드: **연결됨**(R15 + 후속 `56ba1bf` — 정본 읽기·저장·첫 복사·서류 대화 시작·턴·목록·열기·삭제). R15 후속 3(`8473a58`)으로 CF-S7 RPC·`slot_high_water`·`draft_done.draft`, 후속 4(`4d330e6`)로 다시 연 대화의 근거 라벨까지 연결됨. 남은 연결 대기 0건. **브라우저로 실제 데이터 확인은 안 했다** | 2026-11-09 45 런 QA 라운드 2 |
| ~~S-20~~ | ~~면접 준비~~ — **폐기 (RM-1, 2026-11-08)**. 코드 삭제, 옛 주소는 redirect | A4 | `/applications/[id]/interview` → S-31 `/applications/[id]` (`next.config.ts` 308, `legacy-redirects.ts`) | 폐기 | — | 2026-11-08 44 런 |
| ~~S-33~~ | ~~면접 답변지~~ — **폐기 (RM-1, 2026-11-08)**. 코드 삭제, 옛 주소는 redirect | A4 | `/applications/[id]/interview/[sessionId]` → S-31 (308) | 폐기 | — | 2026-11-08 44 런 |
| ~~S-22~~ | ~~면접 결과~~ — **폐기 (RM-1, 2026-11-08)**. 코드 삭제, 옛 주소는 redirect | A4 | `/applications/[id]/interview/[sessionId]/result` → S-31 · `/interviews/[sessionId]/result` → S-13 (308) | 폐기 | — | 2026-11-08 44 런 |
| ~~S-37~~ | ~~모의 면접 전체 세션~~ — **폐기 (RM-1, 2026-11-08)**. 코드·L-01 메뉴 삭제, 옛 주소는 redirect | A4 | `/interviews` → S-13 `/applications` (308) | 폐기 | — | 2026-11-08 44 런 |
| S-40 | AI 연결 | A1 | 설정 다이얼로그 **AI 연결 탭** 위쪽 — 공급자 라디오 행 3개(`ProviderRow`, 42 런에서 카드 대체) | QA 통과 (mock·브라우저 미확인) — 43 런(2026-11-06) 원본 화면 3장에 맞춤, UI QA 1라운드 Minor 6 수정 | 브라우저 미확인 | 2026-11-06 42 런 |
| S-41 | 키 연결 단계 | A1 | `/settings/ai/connect` (집중 화면, `(focus)` 레이아웃) | QA 통과 (BYOK 신설) | — | 2026-10-28 BYOK 통합 |
| S-42 | AI 사용량 | A1 | 설정 다이얼로그 **AI 연결 탭** 아래쪽 — 공급자 탭 + 기능 **5행** 교차 표(44 런, RM-A2: 면접 2행 삭제)(`getAiUsageSummaryV412`) | QA 통과 (mock·브라우저 미확인) — 43 런(2026-11-06) 원본 화면 3장에 맞춤, UI QA 1라운드 Minor 6 수정 | 브라우저 미확인 | 2026-11-06 42 런 |
| S-39 | 지원 현황 보드 (**4열** — 44 런 RM-2. **45 런**: 카드 → S-46, 서류 표시는 배지 하나 **"자소서 작성 중 / 작성됨"**(숫자 없음, CF-3·R-CF-21, `filled_slot_count`·`slot_count`), 인사이트 표시 유지, 면접 수 없음, "지원 전 +" = S-14 모달) | A4 | `/board` | QA 통과 (mock·브라우저 미확인) — 45 런 UI QA 2라운드(라운드 1 Critical 1·Major 2 → 해소, 라운드 2 Major 1 → 해소, 재검은 리더가 코드·테스트로 확인) | 실제 백엔드: 카드·단계 이동·배지용 문항 수(`listDocumentSlotCounts`) **연결됨**. 브라우저: mock `?state=default`·`cl-pending`은 A4가 확인 | 2026-11-09 45 런 QA 라운드 2 |

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

### 45 런 실제 백엔드 연결 요약 (2026-11-10 — **실제 백엔드 연결 완료 기준: 백엔드 `4d330e6` 병합**)
> **실제 백엔드 연결 완료의 기준 커밋: 백엔드 `4d330e6`(PR #69, R15 후속 4까지)** — 이 커밋을 병합하고 닿는 자리를 맞춘 UI 커밋이 이 런의 최종이다. 그 전 기준은 백엔드 `8473a58` / UI `2a90750`이었고, 후속 4에서 바뀐 계약 3곳(`DocumentWritingChatDto.sourceLabels` 추가, `invalid_source_url` 보존, `sourceUrl` 스킴 대소문자 무시)을 반영했다. **브라우저 미확인.**
| 화면 | mock / `?state=` | 실제 경로 | 브라우저 |
|---|---|---|---|
| S-13 목록 | 있음 | **연결됨** — 목록 읽기·삭제 | 미확인 |
| S-14 2단계 모달 | 있음 | **연결됨** — 공고 가져오기·미리 보기 추출(Q53-1)·생성(`p_source_url`·`p_preview_job_id`). `invalid_source_url`(400)이 실제 경로에서도 와서 "주소 없이 만들기"가 뜬다(UQ-759, 후속 4 — 화면 변경 없음) | 미확인 |
| S-46 작성(탭 3개·AI 패널) | 있음 | **연결됨** — 정본 읽기·저장(11키, CF-S7·`slot_high_water`)·첫 복사·서류 대화 시작·턴(SSE `draft_done.draft`)·목록·열기·삭제, CF-S8 자동 저장, 다시 연 대화의 근거 목록(`sourceLabels`, 후속 4) | 미확인 |
| S-15·S-16 탭 | 있음 | **연결됨** — 기존 JD 요건 추출·인사이트 경로 | 미확인 |
| S-39 보드 | 있음 | **연결됨** — 카드·단계 이동·배지(`listDocumentSlotCounts`) | mock `?state=`만 A4가 확인 |
| S-25 라벨 · S-30 본문(CF-S6) | — | 기존 경로(`policy_versions` 2026-11-09 행은 백엔드 `004680`) | 미확인 |

- "QA 통과 (mock·브라우저 미확인)"의 뜻: UI QA는 코드·mock·테스트 기준으로 통과했고, **실제 경로는 코드로 연결돼 있지만 실제 데이터로 눌러 본 확인은 없다**(Claude in Chrome 미연결, 로컬 로그인 우회 없음).
- 잔여 정리(decisions 4.22 후속 #4·#5): screen-status의 닫힌 항목이 열린 문장으로 남아 있던 자리(36·37·38 런 절, S-13·S-14 옛 이름 행, S-17·S-19 연결 대기 행)와 design-system의 폐기 S-19·C-11 체크 트리 묘사(v5.15) — **둘 다 정리 완료**.

## 기획 확인 필요 (누적)

### 45 런 (2026-11-09, 자기소개서 관리 흐름 재설계) — **9건 모두 닫힘** (사용자 확정 CF-S2~CF-S6, 기획 PR #68 — 미머지) · UQ-741도 **CF-S7로 확정**(백엔드 RPC 변경 대기) · UQ-761은 **CF-S9**, 새 문항 초안은 **CF-S8**로 확정 — **둘 다 구현됨. 45 런 기획 확인 열린 것 0건**
- ~~**P-28** S-46 근거 목록(C-11)이 보일 값~~ **확정 CF-S2**: 경로 한 줄만("회사명/교육 표시 이름 › 프로젝트명"), 주 근거 먼저, 배지·rationale 없음
- ~~**P-29** 문항 설정 상태에서 "저장하기"만 눌렀을 때 전환 시점~~ **확정 CF-S3**: 문항 설정 상태에서 저장하기 비활성·⌘S 끔, 첫 저장은 [자기소개서 작성 시작]뿐 (DM 2.5.1 잔여 문장도 PR #68에서 정정)
- ~~**P-30** 작성 상태에서 문항 설정으로 돌아갈 입구~~ **결정 불필요** — 작성 상태의 "문항 편집"(CL-8)으로 해소
- ~~S-46 머리 공고 `dt` 라벨~~ **확정 CF-S4**: "채용 공고"(링크 글자 "JD 상세"·동작 그대로)
- ~~비활성 "저장하기"의 이유 안내 자리~~ **확정 CF-S5**: 알리지 않음(툴팁·안내 줄·`aria-describedby` 모두 없음)
- ~~6문항 이상 정본이 생길 경로~~ **사실 확인: 없음**(CF-M1 이관 0행 + 저장 상한 5) — 영구 비활성 분기 만들지 않음
- ~~**UQ-753** PR #68 UX S-46 "저장하기 → 이 상태에 남는다" 행이 CF-S3와 어긋남~~ **정정됨 (기획, PR #68)** — UX 행을 취소선 + CF-S3·S5 문장으로, DM 667행은 이미 정정돼 있었음. 구현 변경 없음
- ~~**UQ-754** 법무 문서에 "경력기술서"가 남아 있음~~ **확정 CF-S6 (사용자 2026-11-09)** — 법무 3종 2026-11-09 개정판("경력기술서·자기소개서 초안" → "자기소개서 초안", 재동의 없음). **45 런 `policy-content.ts` 본문 4곳 반영**(4.23 UI #11). 시행일은 `policy_versions` 2026-11-09 행 — **백엔드 몫(4.23 백엔드 #15), 같은 머지 필요**
- ~~**UQ-755** S-25 탈퇴 요약 "초안 {n}" 라벨~~ **결정 불필요** — UX S-25에 이미 "자소서 {n}"(R-CF-12). **45 런 라벨 반영**(`deletion-summary.tsx`, 키 `drafts`는 유지)
- ~~**UQ-761** 문항 설정 탭의 CF-S7 "내 내용으로 저장"이 다른 탭 정본의 근거를 빈 문항에 남김~~ **확정 CF-S9 (사용자 2026-11-10, 4.23 UI #14)** — 문항 설정 상태의 충돌 다이얼로그는 "새로 불러오기" 하나만(이 탭의 문항 설정을 버리고 정본을 읽어 작성 상태로). 작성 상태는 CF-S7 그대로 버튼 둘. **45 런 구현됨**(`StaleWriteDialog reloadOnly`, 기본값은 버튼 둘)
- ~~저장하지 않은 새 문항은 AI 초안을 받지 못함~~ **확정 CF-S8 (사용자 2026-11-10, 4.23 UI #13)** — 저장하지 않은 문항 추가·삭제·순서 바꿈이 있으면 대화 턴 전에 같은 저장 경로로 먼저 저장, 실패하면 턴을 보내지 않음. 값만 바뀐 경우는 스냅숏으로. **45 런 구현됨**(보고 `_workspace/ui/56_frontend-engineer-A3_cf-s8_report.md`)

### 42 런 (2026-11-06, 새 설정 다이얼로그) — **모두 확정 2026-11-06 (사용자, UI42-1~8 — decisions.md 3.24, UX v5.17b 5.1k)**. 화면 반영됨(GPT 표기 통일·확정 태그). 남은 것은 법무 확인 2건(처리방침 개정·AI 데이터 처리 본문 — `docs/legal/drafts/`, 미시행)
- **P-22** 미저장 확인의 버튼 문구가 "…닫기"인데 탭 전환·회원 탈퇴로 떴을 때도 같은 문구인가
- **P-23** "화면" 섹션(시스템/라이트/다크 3단)이 없어져 계정 메뉴 다크 모드 스위치만 남음 — 한 번 누르면 "시스템 설정 따르기"로 돌아갈 길이 없다
- **P-24** 계정 탭 읽기 실패 문구가 없다(v5.10 문구 유지)
- **P-25** 셀렉트를 비우는 방법이 없다 — "선택 안 함" 항목을 새 문구로 넣음 `[UI-가정]`. 기간의 연도만 고른 상태 문구도 없다
- **P-26** `stale_write` 때 "내가 고친 값"을 어떻게 보일지 없다 — 경고 상자 안 목록으로 둠 `[UI-가정]`
- **QP-1** S-24 ② 안내 문구가 두 곳에서 다르다(UX 1830행 "본인 AI 키를 연결하면 연결한 모델의 한도 내에서…" vs S-40 표 1909행 "AI 기능은 선택이에요. 본인 AI 키를 연결하면…") — 구현은 S-24 ② 쪽
- **QP-2** "화면 이름은 GPT"(1831행)의 범위 — 행 제목·사용량 탭·S-30만 GPT, C-19 배지·상태 줄·S-41은 OpenAI라 한 행에 두 이름
- **S-30 AI 데이터 처리 본문 원문이 없다** — 기존 화면 문구로 조합. 법무 원문 필요
- **개인정보 처리방침 본문에 폐기된 필드가 남아 있다** — "기본 프로필(선택): 표시 이름, 희망 직무, 총 경력 연수, 관심 산업" (`policy-content.ts:210,237`). 법무 문서라 고치지 않음
- **2026-11-05 닫힘 (decisions.md 3.18, 사이클 open-decisions)**: 이 절에 쌓였던 항목 전부(P-331~P-334, S-02 부제, 2026-11-03 프로젝트 추가 런 목록 — S-10·S-44·AI-13·L-01↔L-02·디자인 P-15~P-20, Q53 B-4·B-5, v5.3 Q-10~Q-28, BYOK B-1~B-29, K-1~K-35)는 OD-*로 정해졌고, UI 후속은 36 런에서 반영했다. 이전 목록은 git 이력(`dd97d21` 판)과 각 QA 보고서에 남아 있다.

### 36 런(2026-11-05)에서 새로 생긴 것 — **6건 중 5건 닫힘 2026-11-05 (decisions.md 3.19, U36-1~U36-5)**. 남은 것은 37 런 항목 아래
- ~~(A4) "자기소개서 삭제됨" 세션 라우트가 명세에 없음~~ **닫힘 (U36-1, `/interviews/{sessionId}/result`)** → `/applications/deleted/interview/{sessionId}/result`(S-33은 S-22로, S-20은 404) `[UI-가정]`
- ~~(A4) S-37 필터·열 머리·빈 상태, S-13~S-20 제목·이동 경로에 남은 "기업 JD"~~ **닫힘 (U36-2, 37 런 전체 교체)** — 용어는 그 뒤 **CF-U3(2026-11-08)**로 다시 확정: 지원 건·서류 모두 "자기소개서", S-46 탭만 "자소서". `DRAFT_TYPE_LABELS`는 45 런에서 삭제(S-17·S-19 폐기)
- ~~(A4) 자기소개서 삭제 토스트 "자기소개서를 삭제했어요"는 명세 행 없음 `[UI-가정]`~~ **닫힘 (U38-1)**
- (A2) "다시 보내기" 줄의 모양, 같은 방문에서 사용자가 중지한 직후에도 보이는지, `nothing_to_retry` 토스트 문구
- (디자인 P-21) C-22 명세 "작은 다이얼로그(좁은 화면은 시트)" vs 코드 `DropdownMenu`
- (리더) 법무 문서의 "정량 성과" 잔여: 처리방침 1번 항목·이용약관 2조(이번에는 국외 이전·처리방침 6번만 고침)

### 41 런(2026-11-05)에서 새로 생긴 것 — **1건 닫힘 2026-11-08 (decisions.md 3.26, DH-1)**
- ~~(S-44) 본문 칸 높이가 UX S-44 본문 행·UP-9의 "400px에서 칸 안 스크롤"과 어긋남~~ **닫힘 (DH-1, UX v5.19)**: S-44 본문은 상한 없이 자란다(구현과 같음). S-10 STAR 칸은 400px 유지 — 같이 풀 필요가 생기면 DH-2로 추가

### 37 런(2026-11-05)에서 새로 생긴 것 — **3건 모두 닫힘 2026-11-05 (decisions.md 3.19 U36-6~U36-8, 구현 그대로·법무 문서 유지)**
- ~~AI 기능·복귀 이름에서 `cover_letter`를 "자소서 문항 답변"으로 했다 `[UI-가정]`~~ **닫힘 (U36-6) → 다시 대체 (CF-U3, 2026-11-08)**: 기능 이름 "자소서"(45 런 `AI_FEATURE_NAMES` 반영)
- ~~S-31 제목의 이름에 이미 "자기소개서"가 있으면 뒤에 붙이는 "자기소개서"를 생략했다 `[UI-가정]`~~ **닫힘 (U36-7)** — S-31은 v5.20에서 폐기(CF-7). 새 이름 규칙은 "{기업 명} 자기소개서"(CF-A7)
- ~~법무 본문의 "자기소개서 초안/메모"가 D-UX-23 용어와 다르다~~ **닫힘 (U36-8, 법무 문서 유지)** — 법무 본문의 "경력기술서" 잔여는 45 런 UQ-754로 따로 올림

### 38 런(2026-11-05)에서 새로 생긴 것 — **3건 모두 닫힘 2026-11-05 (decisions.md 3.20 U38-1~U38-3, UX v5.15)**: 토스트 이름 넣기(구현 그대로), S-13 제목 "자기소개서 관리"(구현 그대로), S-16 문구 "프로젝트·STAR·산출물을 더 채우면 더 정확해져요"로 변경
- ~~(A3·A4) 자기소개서 삭제 성공 토스트 문구~~ **닫힘 (U38-1, 구현 그대로)**
- ~~(A3) S-13 페이지 제목~~ **닫힘 (U38-2, "자기소개서 관리")**
- ~~(A3) S-16 데이터 부족 안내 문구~~ **닫힘 (U38-3, "프로젝트·STAR·산출물을 더 채우면 더 정확해져요")**

## 백엔드 연결 대기 (45 런, 2026-11-09) — **R15 누락 4건은 모두 연결됨**(백엔드 `56ba1bf` → UI `c7afdfe`). **남은 것은 표 아래 "남은 연결 대기"** — 두 PR(UI·#69)은 CF-S7까지 정리된 뒤 같은 릴리스로 머지
> R15(`dba1bff`)를 병합해 공고 가져오기·미리 보기 추출·생성(`p_source_url`·`p_preview_job_id`)·정본 저장(9키)·서류 대화 시작·턴 SSE는 **실제 경로로 연결했다**. 아래 4건은 화면이 부를 서버 함수 자체가 없어 연결하지 못했다 — 백엔드가 "DM 7장 25·33행이 정해 둔 읽기를 R15가 빠뜨렸다"고 확인했다. UI는 이름·시그니처를 맞춘 stub(`notWired`)을 두었다. 새 마이그레이션 `20261113004670`(비파괴)도 코드 배포 전에 원격 push해야 한다.

| # | 화면 ID | 데이터 함수 (UI stub) | 필요한 계약 (백엔드가 만드는 것) | 지금 실제 환경 증상 |
|---|---|---|---|---|
| ~~1~~ **연결됨** | S-46 | `getCoverLetterDocument(apId): Promise<ApplicationDocument \| null>` | `getApplicationDocument` 서비스·액션 — 행 또는 `null` (DM 7장 25행) | **S-46이 늘 오류 화면**(실제 분기가 throw, page가 catch 안 함 — UQ-743). 덮어쓰기는 일어나지 않음. **규칙: 읽기 실패를 `null`로 접지 않는다**(접으면 빈 기본 문항으로 기존 정본을 덮어씀) |
| ~~2~~ **연결됨** | S-39 | `listCoverLetterSlotCounts()` | `listDocumentSlotCounts` → `Record<apId, {slot_count, filled_slot_count}>` (DM 7장 33행; 기존 `loadDocumentCounts`는 0/1만) | 배지가 접힘(보드는 정상) |
| ~~3~~ **연결됨** | S-46 | `markCoverLetterCopied()` | RPC `mark_application_document_copied` — 한 번 기록되면 불변, 행 없으면 `null`, `updated_at` 안 올림 | 첫 복사가 기록되지 않음(복사는 동작) |
| ~~4~~ **연결됨** | S-46 패널 | 서류 대화 읽기 | `DocumentWritingChatDto`를 `AnyWritingChatDto`에 추가, 서류별 대화 목록·상세 | 새로 고침하면 대화·미반영 제안이 화면에서 사라짐(서버에는 남음) |
| — | S-46 | 저장 | ~~**UQ-741**~~ **확정 CF-S7 (사용자 2026-11-09)** — 서류 RPC만 "정본 행 있음 + 기대 버전 null → `stale_write`"(첫 저장 통과, S-10·S-44·프로필 불변). UI: "내 내용으로 저장"은 `details.current_updated_at` 재전송(반영됨), 문항 설정 상태의 [자기소개서 작성 시작]도 같은 충돌 다이얼로그. **백엔드 RPC 변경 대기** | 백엔드 변경 전까지는 두 탭·미리 열어 둔 탭에서 조용한 덮어쓰기 가능 |

**남은 연결 대기 (45 런 종료 시점, 백엔드 `4d330e6` 병합 뒤) — 0건** (아래는 처리 기록)
- ~~CF-S7 서류 RPC 변경~~ · ~~`slot_high_water`~~ · ~~서류 `draft_done.draft`~~ — **연결됨**(백엔드 `004690`, UI 보고 `_workspace/ui/55_frontend-engineer-A3_8473a58_report.md`). [반영]은 `draft_done.draft`(저장본)를 읽고, 턴 뒤 다시 읽기·`base_body_hash` 재계산 우회는 걷었다. 새 문항 번호 = `max(slot_high_water, 열린 제안, 이번 방문 발급분) + 1`, 기존 문항은 읽어 온 `question_id`를 그대로 보낸다
- 다시 연 대화의 제안 카드 "근거 목록" 라벨(저장된 `draft.sources`에 라벨 없음) — ~~백엔드 요청~~ **연결됨 (후속 4 `4d330e6`)**: 서버가 `DocumentWritingChatDto.sourceLabels`로 `draft.sources[]`마다 경로 라벨을 준다(`storedSourceCards`가 인덱스로 짝짓고, 원본이 지워졌으면 "원본 삭제됨"). 화면이 `getEvidence`로 조인하지 않는다(반영 전 제안에는 `evidence_links` 행이 없다). 이유 문장은 CF-S1대로 저장하지 않으므로 다시 연 대화에는 라벨만 나온다. 표시만 빠지고 [반영]·저장 근거는 정상
- **UQ-759** 실제 경로에서 `invalid_source_url`이 `invalid_input`으로 바뀌고 스킴 대소문자를 구분 — S-14 "주소 없이 만들기"가 mock에서만 뜸. ~~백엔드 요청~~ **연결됨 (후속 4 `4d330e6`)**: `invalid_source_url`(400) 보존, 스킴 대소문자 무시(서버가 스킴만 소문자로 저장). 화면 변경 없음 — 받은 값을 그대로 보낸다
- ~~결정 대기: 저장하지 않은 새 문항은 AI 초안을 받을 수 없다~~ **CF-S8로 해소**(화면이 턴 전에 자동 저장, 백엔드 변경 없음)
- (Minor, 기록만) 패널의 로컬 제안 항목이 문항을 못 찾을 때 `question_id` 자리 표시값 `qid-{slot}`을 쓴다 — 저장 본문은 폼의 `question_id`만 보내므로 서버로 가지 않음(리더 확인)

## 백엔드 연결 대기 (36 런, 2026-11-05) — **모두 연결됨 2026-11-05** (아래 표는 기록)
> **2026-11-05 main 병합(#47·#49 R11) 뒤 연결함**: 스냅샷 필드(`interview-rows.ts`, 서버 `sessionProjectName`), `get_deletion_impact('application_project')`(`getApplicationDeletionImpact` → `getApplicationProjectDeletionImpact` 액션), `detached_interview_sessions`, 대화 DTO `turnFailure` → `turn_job`, 다시 보내기 라우트(서버 쪽만 바뀜), `p_client_id`(`career-v45-save.ts`가 새 페이지의 `client_id`를 `clientId`로 보냄), `ai_disclosures v2026-11-05`(버전 문자열 일치). mock 자기소개서 삭제도 남는 세션의 `application_project_id`를 null로 둔다. 아래 표의 `policy_versions` 2026-11-05 행 3개·자소서 초안 기본 제목·AI-12 `GATE_FEATURE_LABEL`도 **백엔드 R12(`20261113001300`)로 처리됨**(원격 반영 2026-11-05, PR #50 `5c0933a` 운영 배포). 해시 정규화(#10)는 백엔드가 공통 함수로 처리. lint·typecheck·build 통과, vitest 146 파일 2381건 모두 통과(36 런의 로컬 통합 테스트 4건 실패 해소). 브라우저 미확인.

| 화면 ID | 데이터 함수 | 필요한 계약 (문서 위치) |
|---|---|---|
| ~~S-37·S-22·S-33~~ | ~~`interview-rows.ts`~~ | **폐기 (RM-1, 2026-11-08)** — 화면·데이터 계층 삭제 |
| C-05 | `deletion.ts` `getApplicationDeletionImpact` | RPC `get_deletion_impact('application_project')` `cascade.*` (#1~#6). (RM-1, 2026-11-08) `kept.interview_sessions` 폐기 |
| ~~C-05~~ | ~~`deletion.ts` `toDeletionImpact`~~ | ~~`affected_results.detached_interview_sessions` (R-OD-5)~~ **폐기 (RM-1, 2026-11-08)** |
| S-10·S-44 | `writing-chat-turn-v45.ts` 다시 보내기 | 턴 라우트가 "마지막이 답 없는 사용자 메시지"를 다시 응답 (#11) |
| S-10·S-44 | `career-v45.ts` `messagesOf` `turn_job` | 대화 상세 DTO에 실패 응답의 작업 상태(`canceled`/`failed`·원인) (#15) |
| S-10·S-44 | `career-v45-save.ts` | `p_client_id` (#9) — 백엔드가 이 파일을 고침, UI 변경 없음 |
| S-44 | `career-v45-shared.ts` 해시 | `base_body_hash` 공백 정규화 공통 함수 (#10) — 백엔드 |
| S-30 | `policy_versions` | `cross_border_transfer`·`privacy`·`terms_of_service` `2026-11-05` 행 (본문은 `policy-content.ts`에 반영됨, U36-5) |
| ~~S-17·S-19~~ | ~~자소서 생성 RPC 기본 제목~~ | **폐기 (v5.20, CF-1·CF-7)** — 초안 생성 RPC와 화면이 함께 없어짐. 새 이름 규칙은 "{기업 명} 자기소개서"(CF-A7, R15 `private.application_compose_name`) |
| S-10 | AI-12 `GATE_FEATURE_LABEL` | `cover_letter` 복귀 기능 이름 — U36-2 "자기소개서" → **CF-U3 "자소서"** (45 런 UI 반영, 서버 라벨은 R15 확인 필요) |
| C-21 | `ai_disclosures` | `v2026-11-05` 6행, Claude `requires_reconsent = true` (#12). 화면 상수는 반영됨 |

## [UI-가정] 요약
- (45 런) 목록은 각 보고서에: `_workspace/ui/46_frontend-engineer-A0_report.md`(9건, 모두 순수 화면 세부) · `47`·`49`·`51`·`52`·`54`(A3) · `48`(A4) · `45_ui-designer_cover-letter_notes.md`. 대표: 모달 주소 `?new=1`, 탭·대화 쿼리 이름, 기준 기본값 `with_spaces`, `preview_skip_reason` 토스트·`invalid_slot` 문구
- (39 런) S-08 `?new={kind}` = 그 종류의 추가 모달을 한 번 열고 주소에서 뺀다(C-09 "경력 먼저 입력하기" = S-08 + S-09 새 경력의 주소). 폐기된 `achievement` 근거 칩은 "원본 삭제됨"과 같게(링크 없음) 보인다
- 디자인 시스템 G-1~G-13, 각 영역 보고서(`_workspace/ui/0{2,3}_frontend-engineer-*_report.md`)의 [UI-가정] 목록 참고. 대부분 K-1(v3 원문 부재)에서 나온 문구·구성 가정
