# UI 작업 브리프 — BYOK 기획 반영 (2026-10-28)

## 사용자 요청
"기획 수정사항 발생했어." → main의 기획 문서(커밋 6fc33e7 "Switch planning to BYOK multi-provider AI")를 이 브랜치에 가져와 UI에 반영한다.
- 기획 문서는 `git restore --source origin/main -- docs/planning`으로 작업 트리에만 가져왔다(커밋 없음). main의 백엔드 코드(src/server 등)는 가져오지 않았다 — 사용자 결정: main 병합·실제 백엔드 연결은 백엔드 작업이 끝난 뒤 한 번에.
- **커밋하지 않는다** (사용자 요청).

## 기획 버전
- 이전: PRD v3.2a / 플로우 v4.2b / AI v3.2a / 데이터 모델 v3.2a
- 이후: **PRD v4.2 / 플로우 v5.2 / AI v4.2 / 데이터 모델 v4.1a**
- 변경 요약: `docs/planning/README.md`, 플로우 6장 변경 이력 v5·v5.1·v5.1a·v5.2, 5.1b BYOK 결정 표, D-UX-14~18.

## 핵심 변경 (BYOK)
AI는 사용자가 본인 키(Gemini / Claude / OpenAI 중 활성 1개)를 연결하면 열리는 선택 확장. 운영자 비용·서비스 한도 없음.
1. 신설 화면: **S-40 AI 연결**, **S-41 키 연결 단계**(① 등급 → ② 데이터 사용 동의 → ③ 키 가이드·등록·검증), **S-42 AI 사용량 미터**(이번 달만, 기능별·공급자별, 예상치 고지).
2. 신설 공통: **C-18 AI 잠금 상태**(모든 AI 진입점, 영역형/인라인형 — D-UX-15), **C-19 공급자·등급 배지**("Gemini · 기본", D-UX-18), **C-20 한도·오류 안내**(원인 7종, ST-AI-FAILED 대체), **C-21 데이터 사용 고지·동의**. 상태 ST-AI-KEY-MISSING, ST-AI-KEY-CHECK.
3. **삭제**: 서비스 한도 UI 전부 — "이번 달 N회 남음", "{N}/10회", ST-LIMIT, UsageHint, 사용량 차감 문구("사용량은 차감되지 않았습니다" 포함), C-09의 AI 작성 대화 10회 소진 분기(U-8 폐기). 메시지 상한 40·동시 실행 1개 등 품질 제한은 유지.
4. 키 없는 흐름: S-08 기본 시작점 직접 입력, S-14 이름 입력·기본 이름, S-15 공고 원문 + "요건 정리하기"(D-30), C-09 키 무효·대화 실패 시 폼 경로, 기존 결과는 키 없이 열람·편집·복사(D-36).
5. 무료 등급 순차 모드 진행·시간 문구(D-37), 결과·세션 목록에 실행 공급자 표시(C-19).
6. L-01 메뉴 하단 **AI 연결 상태 한 줄**, S-24 "AI 연결"·"AI 사용량" 항목과 AI 학습 고지 문구 변경, S-25 삭제 범위에 AI 연결(키·사용 기록·동의 이력) + 공급자 키 폐기 권고, S-28 공급자별 장애 배너.
7. 데이터 모델 v4.1a: 사용량 원장(usage ledger) 삭제, `ai_provider_keys`(+ `ai_provider_keys_public` 뷰), `ai_data_use_consents`, `ai_usage_records`, `ai_price_tables`, `ai_providers`, `profiles.active_ai_provider`, `get_data_readiness().ai_connection`, `failure_cause` 7값, `error_category` 5값, 결과 메타 `provider`/`model`/`model_tier`, 면접 세션 `question_provider`/`evaluation_provider` 등(플로우 v5.1 변경 이력 참고).

## 이번 실행 이후 셸에 이미 들어간 사용자 결정 (유지할 것)
- L-01은 shadcn **sidebar-08**(inset) 기반, `collapsible="icon"`, 헤더는 본문 패널 안 `sticky top-0`, 메뉴 크기는 primitive에서 키움(디자인 시스템 5.1 "메뉴 크기").
- **S-24 설정은 shadcn sidebar-13 다이얼로그**(`shell/settings-dialog.tsx`, 섹션 내용은 `account/settings-sections.tsx`, 목록은 `account/settings-section-list.ts`). `/settings` 페이지도 같은 섹션을 카드로 보인다.

## 리더 결정 (이번 실행)
- S-40 AI 연결·S-42 AI 사용량은 **설정 다이얼로그의 섹션**("AI 연결", "AI 사용량")으로 넣고, 같은 내용 컴포넌트를 쓰는 **라우트 페이지도 둔다**(직접 주소·C-18 복귀 흐름용): `/settings/ai`(S-40), `/settings/ai/usage`(S-42). S-41은 단계가 있고 공급자 사이트를 오가므로 **페이지** `/settings/ai/connect`(`?provider=`, 복귀 대상 유지).
- L-01 메뉴 하단 "AI 연결 상태 한 줄"은 sidebar-08 구조 안에서 NavSecondary 위 또는 NavUser 위에 둔다(디자이너가 결정, 접힌 레일에서는 아이콘 + 상태 점).
- mock: 픽스처 사용자는 기본으로 Gemini 무료 키가 연결된 상태 + `?state=`로 미연결·무효·확인 필요·한도 원인 7종을 미리 볼 수 있게.

## 범위·순서
1. ui-designer: design-system.md에 C-18~C-21·S-40~S-42 패턴, ST-LIMIT 삭제, C-20 원인 7종 시각, C-19 배지, 무료 등급 순차 안내, L-01 하단 상태 줄.
2. foundation: `types/db.ts` v4.1a, mock·데이터 계층(키·동의·사용 기록·readiness.ai_connection·실패 원인), 공통 C-18~C-21, 한도 UI 삭제, ST 갱신, 셸 하단 상태 줄, 라우트·`?state=`.
3. 영역: A1(S-24 섹션·S-25·S-40·S-41·S-42), A2(S-08 시작점·S-36 잠금/오류), A3(S-14·S-15·S-16~S-19 잠금/오류/배지), A4(S-20·S-33·S-22·S-37·S-39 팝업 잠금/배지·순차 안내).
4. QA: 변경 화면 Q1–Q6 + 통합.
