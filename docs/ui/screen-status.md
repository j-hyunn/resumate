# 화면 구현 현황
- 기준 기획: PRD v4.6 / 플로우 v5.6 / AI v4.6 / 데이터 모델 v4.5 (PA-1~PA-4 반영, 2026-11-03 — 이번 런의 대상 화면만. 나머지 화면은 이전 기준 v5.4a 그대로)
- 디자인 시스템: v5 (v4 = 사용자 지정 브랜드 토큰 2026-11-03, v5 = L-02·S-10·S-44·AI 패널·제안 카드 2026-11-03) · 최종 갱신: 2026-11-03
- 실행: `pnpm install` → `pnpm dev` · 상태 미리보기: 각 화면 `?state=…`, 공통 상태 갤러리 `/dev/states`(개발 모드 전용). W5 추가: `stopping`(S-19), `save-conflict`(커리어 폼, 첫 입력 뒤), `generation-canceled`(S-33), `multi-detail`(S-36)

> 브랜드 토큰 정합 (2026-11-03): main의 v4 브랜드 토큰 머지 뒤 v5 화면을 맞췄다(`_workspace/ui/27_ui-qa_v5-brand-conformance.md`, 17건 — 코드 11·문서 8 반영, 재검토는 grep·lint·typecheck·test·build로만, 브라우저 hover 미확인).

> 프로젝트 추가·산출물 상세 런 (2026-11-03): L-02·S-10·S-43 산출물·S-44·C-23 구현. 파운데이션 QA 2라운드 + 영역 QA 2라운드 + 통합 QA, 이슈 Critical 1·Major 12 모두 해결(통합 QA 뒤 마지막 수정 UQ-INT-1~5·UQ-S44-4는 리뷰어 재검토 없이 lint·typecheck·테스트로만 확인). **모두 mock·SSR 렌더 기준이며 브라우저에서 눌러 본 확인은 없다.** DM v4.5 계약(페이지 저장 RPC 반영 기록, 산출물 AI 대화 AI-13)은 백엔드에 없어 데이터 계층이 v4.4 백엔드 + mock으로 잇는다(`// 연결 대기 (DM v4.5 11.3)`). 기록: `_workspace/ui/21_brief_project-add.md` ~ `26_ui-qa_project-add_round2-integration.md`
> W5 QA 수정 (2026-11-02): `_workspace/ui/19_ui-qa_w5_review.md`·`_workspace/backend/W5/03_backend-qa_report.md`의 UI 이슈를 고쳤다(UQ-701~703·705~707, QA-W5-01·06 앞부분·08). lint·typecheck·test까지 확인, 브라우저 미확인. 상세: `_workspace/ui/20_frontend-engineer_w5_fixes.md`

> W5 (2026-11-02): "QA 통과"는 모두 mock 기준이다. 실제 백엔드 연결 뒤 UI QA는 아직 하지 않았다. W5에서 고친 화면은 lint·typecheck·test·build와 HTTP 확인까지이고 클릭은 해 보지 않았다. 상세: `_workspace/backend/W5/02_ui_notes.md`

| 화면 ID | 화면명 | 영역 | 라우트 | 상태 | 열린 이슈 | 마지막 QA |
|---|---|---|---|---|---|---|
| L-01 | 대시보드 셸 (sidebar-08·아이콘 레일·고정 헤더·NavAiStatus) | A0 | `(dashboard)/layout` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-28 | 오류 | A0 | not-found / error | QA 통과 (BYOK) | — | 2026-10-28 BYOK 통합 |
| C-01~C-10, C-12~C-14, C-17~C-21, ST-* | 공통 컴포넌트·상태 뷰 (v2: C-18 AiLock · C-19 ProviderBadge · C-20 AiErrorNotice · C-21 DataUseConsent · AiRunButton) | A0 | `/dev/states` | QA 통과 (Q53) | — | 2026-10-30 Q53 |
| S-01 | 랜딩 | A1 | `/` | QA 통과 | — | 2026-10-25 R2 |
| S-02 | 가입/로그인 | A1 | `/sign-in` | W5 QA 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과 (v5.3)) | W5 QA 수정(QA-W5-08): `?next=` 검사를 서버 계약판과 통일(`/auth/callback` 거부) | 2026-11-02 W5 QA |
| S-03 | 동의 | A1 | `/consent` | W5 QA 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과 (BYOK)) | W5 QA 수정(QA-W5-08): 동의 뒤 이동 `next` 검사를 서버 계약판과 통일 | 2026-11-02 W5 QA |
| S-24 | 설정 | A1 | 설정 다이얼로그(sidebar-13)만, `?settings=` 주소로도 열림 (2026-11-04 페이지 삭제) | QA 통과 (v5.3) | — | 2026-10-30 v5.3 통합 |
| S-25 | 회원 탈퇴 | A1 | `/settings/withdraw` | QA 통과 (v5.3) | — (UQ-90 해결: NFR-PRV-06 v4.1) | 2026-10-30 v5.3 통합 |
| S-30 | 정책 | A1 | `/policies` | QA 통과 (BYOK) | — (UQ-90 해결: NFR-PRV-06 v4.1) | 2026-10-28 BYOK 통합 |
| S-04 | 기본 프로필 편집 | A2 | `/career/profile` | QA 통과 | — | 2026-10-25 R2 |
| S-08 | 커리어 (2026-11-03: S-43 산출물 섹션·C-23 범위 축소·`?edit=` 추가, QA 통과 mock 기준) | A2 | `/career?item={kind}:{id}` | v5.5 레이아웃 구현(피그마 1010:552) + 커리어 추가 모달(피그마 1009:2), QA 미검토 · 브라우저 클릭 미확인 | 2단 목록+상세(S-09·S-34·S-43 보기). 커리어 추가 → 경력/교육 이수/개인 프로젝트 모달에서 한 번에 생성(자동 저장·작성 중 표시 없음, 소속 프로젝트·경력 단위 성과 제외). 상세 패널 “수정”은 같은 모달을 채운 채로 열어 저장. 교육 정보에서 구분 숨김, 독립 프로젝트에 링크 표시. [UI-가정] 교육 직무 필드 제외(컬럼 없음), 교육 이수 = 구분 course. 아직 없음: C-23·C-24 인라인 편집, 소속 프로젝트 추가·상세는 기존 화면, 종류 태그·산출물 표시, 셸 메뉴 이름(CR-12) | 2026-11-03 lint·typecheck·test, HTML 확인 |
| S-09 | 경력 편집 | A2 | `/career/experiences/new\|[id]` | W5 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과) | W5: client_id·충돌·기간 안내. W5 QA 수정: 재직 중 토글·첫 저장 두 번 유실의 거짓 충돌(UQ-702·QA-W5-06), 충돌 버튼 44px(UQ-705), 선택 뒤 포커스(UQ-706) — 브라우저 미확인 | 2026-11-02 W5 QA |
| S-34 | 교육 편집 | A2 | `/career/educations/new\|[id]` | W5 수정, QA 미검토 · 브라우저 미확인 (이전: QA 통과) | W5: client_id·충돌·기간 안내. W5 QA 수정: 재학 중·첫 저장 유실 거짓 충돌, 충돌 버튼 44px, 선택 뒤 포커스 — 브라우저 미확인 | 2026-11-02 W5 QA |
| S-10 | 프로젝트 상세 (전체 페이지, v5.6) | A2 | `/career/projects/new?experience=\|education=`, `/career/projects/[id]` (`(page)` 그룹) | QA 통과 (2026-11-03 PA, mock 기준 · 브라우저 미확인) | 반영 기록·STAR 대화 v4.5 계약은 연결 대기 | 2026-11-03 PA 통합 |
| L-02 | 전체 페이지 셸 (로고·[Resumate AI]·저장하기·계정, 이동 줄, 이탈 확인·입력 보존, 장애 배너, 오류 경계) | A0 | `(page)/layout` | QA 통과 (2026-11-03 PA, 브라우저 미확인) | — | 2026-11-03 PA 통합 |
| S-44 | 산출물 상세 (전체 페이지 + AI 패널 본문 초안 카드) | A2 | `/career/projects/[id]/deliverables/new`, `/career/deliverables/[id]?range=` | QA 통과 (2026-11-03 PA, mock 기준 · 브라우저 미확인) | 산출물 AI 대화(AI-13) 전체 mock — 백엔드 연결 대기 | 2026-11-03 PA 통합 |
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
- 2026-10-25 리더: S-24 폭 `max-w-form` / 768px 미만 모든 조작 요소 44px(공통 컴포넌트가 보장) / 제출 실패 문구 틀 통일(`submitFailedMessage`) / 자소서 게이트 params 키 `draft_id` / 영역 임시 데이터 함수는 `lib/`로 이전
- 2026-10-30 사용자(Q53-1~10): 기획 질문에 답함. 임시 처리 UQ-580(S-14 추출 없이 저장)·UQ-588(S-17 직접 고르기로 시작)은 결정대로 되돌렸다. 설정에 "화면" 섹션(시스템 설정·라이트·다크)을 추가했다(디자인 시스템 Q-2).

## 기획 확인 필요 (누적)

### 2026-11-03 프로젝트 추가·산출물 상세 런 (상세: `_workspace/ui/26_ui-qa_project-add_round2-integration.md` 7장)
- **사용자 답 대기 P-1**: C-22 "프로젝트"를 PR #8의 피그마 1009:2 일괄 추가 모달로 둘지, 명세(D-UX-28 (a))대로 이름 다이얼로그 → S-43 수정 모달 두 단계로 둘지 (지금 구현 = 두 단계)
- 문서 정리(리더 판정 완료): AI-12 문구를 UX에 맞추기(K1·K2), S-44 "마무리 중" 없음(P-3), S-44 `?range={start}-{end}` 형식, 부모가 소속 프로젝트로 바뀐 산출물 저장 처리(UQ-S44-14)
- S-10: "AI에게 물어보기" 고정 문구, 기간 제안 카드 모양, "본인 역할 확인 중" 클릭 목적지, [모두 반영] 되돌리기 범위, 이름 빈 새 페이지 시작 인사
- S-44·AI-13: 회고 슬롯 1의 `scope` 재사용, `base_body_hash` 정규화, 초안 6회 때 칩 구성, "초안 작성 중" 문구 원천, 자유 입력 초안 턴 판정
- L-01 ↔ L-02 계정 메뉴 2항목 vs 5항목, 이탈 확인 설명 문구
- 디자인 P-15~P-20 (`_workspace/ui/21_ui-designer_project-add_notes.md`)
- 백엔드 전달: 칩 표가 서버 `focus-slots.ts`에도 있음(UQ-S10-14), DM v4.5 11.3 연결


- **Q53 후 남은 것**: 혼합 세션의 같은 행 다시 시도(R-63), S-17 "새 경력기술서" 버튼 대상 등. `_workspace/ui/17_ui-qa_q53_review.md`, `18_frontend-engineer_q53_fixes.md`
- **v5.3 통합 나머지(가정 유지 가능) Q-10~Q-28**: `_workspace/ui/13_ui-qa_v53_integration_review.md` "기획 확인 필요" B절
- **BYOK 29건(B-1~B-29)**: `_workspace/ui/07_ui-qa_byok_integration_review.md` 마지막 절. 우선 B-24(FL-19 복귀 문장의 기능 이름), B-6(등급 글자), B-2(유료 등급에도 "무료 한도" 문구를 쓰는지)
- 초기 실행분:
- 중복 제거 35건(K-1~K-35): `_workspace/ui/04_ui-qa_integration_review.md` 마지막 절
- 우선: ~~K-16~~(PRD v4.1 NFR-PRV-06으로 해결), K-1("v3와 같음" 원문 부재), K-27(경력기술서 재생성 = 새 행 vs 덮어쓰기), K-22(S-09 종료월이 완료 조건인지)

## [UI-가정] 요약
- 디자인 시스템 G-1~G-13, 각 영역 보고서(`_workspace/ui/0{2,3}_frontend-engineer-*_report.md`)의 [UI-가정] 목록 참고. 대부분 K-1(v3 원문 부재)에서 나온 문구·구성 가정
