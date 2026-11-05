# 36 런 브리프 — 열린 결정 일괄 확정(OD-*) UI 후속

- 요청: decisions.md 4.12 "UI" 1~14 + UX 5.1i(구현과 다른 문구 6건 K-2·K-3·K-28·B-7·Q-15·Q-25)를 코드에 반영
- 기획 기준: PRD v4.13 / UX v5.13 / AI v4.11 / DM v4.11 (PR #46 브랜치 `claude/open-decisions-2026-11-04`에서 갈라짐)
- 결정 원문: `_workspace/00_input/planning-decisions-open-decisions.md`, 정리: `docs/planning/decisions.md` 3.18·4.12
- 백엔드: 병렬 세션 `od-backend`가 DM 11.6 #1~#15(스냅샷 필드·`d14.v1` 점수·`p_client_id`·다시 보내기 경로·고지 마이그레이션·해시 정규화)를 만든다. **이 런은 `supabase/`·`src/server/`·`src/app/api/`·`src/lib/contracts/`·생성 타입을 건드리지 않는다.** 아직 없는 계약은 data layer mock(`?state=`) 분기 + `// 연결 대기 (DM v4.11 11.6 #n)`.
- 백엔드 세션이 고치는 UI 쪽 파일이라 이 런에서 손대지 않음: `src/lib/data/career-v45-save.ts`(OD-C6 #9), `src/lib/data/career-v45-shared.ts`의 해시 함수(OD-P5 #10). → UI 4·(해시)는 백엔드 연결 때 처리, screen-status "연결 대기".
- 브라우저 확인: 범위 밖(로컬 로그인 Google 전용). lint·typecheck·test·build만.

## 영역별 범위와 파일 소유

| 담당 | 항목 | 파일 |
|------|------|------|
| A4 엔지니어 | UI 1(OD-I1·I2 C-17·S-22 점수), UI 2 중 S-37·S-22·S-33 읽기 전용·"자기소개서 삭제됨"·필터, C-14 "이 자기소개서에", S-39 "기업 JD" 잔여(빈 상태·추가 버튼·삭제 토스트·카드 메뉴) | `src/components/interviews/**`, `src/components/board/**`, `src/components/common/score-display.tsx`, `src/components/common/stage-menu.tsx`, `src/app/(dashboard)/(gated)/{interviews,board,applications/[id]/interview}/**`, `src/lib/data/interviews.ts`·`interview-rows.ts`·`interview-grading.ts`, `src/lib/mock/fixtures.ts`의 면접 세션 행, `src/types/db.ts`의 면접 view model |
| A2 엔지니어 | UI 3(OD-C3 첫 저장 토스트), UI 5(OD-P2 되돌리기 제거), UI 6(OD-P6 고정 칩 3개), UI 7(OD-P11 다시 보내기), UI 9(OD-B4 S-10 전송 거절 문구) | `src/components/career/**`, `src/app/(page)/**`, `src/lib/data/quick-chips.ts`·`writing-chat-*.ts`·`career-v45-actions.ts`·`career-v45.ts`, `src/lib/mock/career-v45.ts`·`writing-chat-turn-v45.ts` |
| 리더 | UI 2 중 C-05(K-2·K-3·커리어 연쇄 줄·`detached_interview_sessions`)·`getApplicationDeletionImpact`, UI 8(OD-B1), UI 10(고지 상수 이동·Gemini 무료만·국외 이전 고지), UI 11 중 K-28·B-7·Q-15·Q-25·S-24 탈퇴 설명·C-18 설명 2곳, UI 13(mock target_type), UI 14, 문서 | `src/components/common/{delete-confirm-dialog,ai-error-notice,provider-badge,ai-lock,data-use-consent}.tsx`, `src/components/account/**`, `src/components/applications/**`, `src/lib/data/deletion.ts`·`applications.ts`, `src/lib/mock/ai-providers.ts`, 새 고지 모듈, `docs/**` |
| ui-designer | UI 12(OD-D4 design-system P-15·추가/수정 모달 패턴, C-24 폐기) | `docs/ui/design-system.md`만 |

공유 파일(`src/lib/labels.ts`, `src/lib/routes.ts`, `src/components/ui/**`)은 필요하면 리더에게 요청.

## 범위 밖으로 남긴 것

- CR-23 화면 용어 전체 교체("기업 JD" → "자기소개서", S-13·S-14·S-31·S-15~S-20 제목·이동 경로 등 약 50곳): 4.12 항목은 C-14·S-39·S-24 잔여만 지목. 전체 교체는 별도 후속.
