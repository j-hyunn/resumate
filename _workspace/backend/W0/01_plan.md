# 백엔드 연결 계획 (2026-11-02)

브랜치 `claude/ui-work-a25919`: main 백엔드(S0~S9, R1~R3) + UI(mock) 병합 완료. 기획 PRD v4.4a / 플로우 v5.4a / AI v4.4a / DM v4.3a.
로컬 Supabase(Docker)에서만 적용·검증한다. 원격 프로젝트·개발 브랜치 적용 없음, 배포 없음, 커밋 없음(리더가 사용자에게 묻는다).

## 단계
| 단계 | 내용 | 담당 |
|------|------|------|
| W0 | Q53 백엔드 후속 + 주소 계약 | db-engineer → api-engineer(+ AI 영향이면 ai-pipeline-engineer) → backend-qa |
| W1 | 공통 연결: `src/types/db.ts` 재수출, 인증·S-02/S-03, 셸, readiness, AI 연결 설정·사용량, ai-jobs·`useAiJob`/`useAiStream`, 탈퇴(A1) | api-engineer → backend-qa |
| W2 | 커리어·AI 작성 대화 (A2: S4, S2) | api-engineer |
| W3 | 기업 JD·인사이트·서류 (A3: S5~S7) | api-engineer |
| W4 | 모의 면접·보드 (A4: S8) | api-engineer |
| W5 | 통합 QA, 실제 흐름 확인 | backend-qa, 리더 |

W2~W4는 W1이 끝난 뒤 병렬. 공유 파일(`src/types/db.ts`, `lib/data/ai-*`, `lib/data/actions.ts`)은 W1만 고치고, 영역 담당은 자기 파일만 고친다.

## W0 범위
**DB·서비스 (`docs/planning/decisions.md` 4.1a가 목록, 상세는 DM 2.6.1·2.7.1·2.9.1·2.11.7)**
- Q53-1 `create_application_project` 사전 거부(경로 ⑥, 고아 행 금지)
- Q53-2·11 `update_failed_jd_raw_text`, `raw_text_edited_at`, `job_descriptions_guard` 완화(`succeeded → pending` 포함), `ensureJdExtracted` 순서, `getJdView.rawTextEditable`, 지난 실패 표시 규칙
- Q53-3 `answer_evaluations.error_code`, 입력 원인 답변 제외, `interview_evaluation_input_only`
- Q53-5 종합만 다시 정리 경로, 대상 0 세션의 같은 행 다시 시도 거부
- Q53-7 경력기술서 `composing`, 취소 처리, 중단 시 이전 상태
- Q53-10 `mark_interview_result_viewed` 조건, 공용 판정 헬퍼
화면 쪽 동작 기준은 이미 구현된 `src/lib/data/interview-grading.ts`(DM 2.7.1 표), `src/lib/data/applications.ts` `jdRawTextLock`이다. 기획과 다르면 기획이 우선이고 `spec-gaps.md`에 적는다.

**주소 계약 (`src/lib/contracts/routes.ts`, 리더 결정)**: 페이지 주소는 UI 소유이므로 계약을 UI에 맞춘다.
`login` → `/sign-in`, `consent` → `/consent`, `accountDeletion` → `/settings/withdraw`. `PROTECTED_PREFIXES`의 `/onboarding/consent` → `/consent`. 테스트도 함께 고친다. `/settings/withdraw/finalize`가 동의 게이트 밖인지 확인한다.

**`src/proxy.ts`**: 병합 때 넣은 개발 모드 우회(`NODE_ENV !== production && !NEXT_PUBLIC_SUPABASE_URL`)는 W1 끝에서 제거한다. W0에서는 두되 건드리지 않는다.

## 공통 규칙
- UI 소유 경로(페이지, `components/`, `lib/mock/`, `docs/ui/`)는 읽기 전용. 화면을 고쳐야 연결되면 고치지 말고 노트의 "UI 요청"에 적어 리더에게 넘긴다.
- `lib/data` 내보내기 이름·인자·반환형은 유지한다. 실제 데이터로 만들 수 없는 모양은 `spec-gaps.md`에 적는다.
- `?state=` 미리보기는 계속 동작해야 하고 실제 데이터를 쓰면 안 된다.
- 확인: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, pgTAP(`pnpm db:test`). 실행하지 못한 검사는 그렇다고 적는다.
- 실제 API 키·공급자 호출 없음. 키가 필요한 검증은 기존 fixture 방식을 쓴다.
