# R1 기획 결정 반영 (백엔드 후속 수정) 계획

## 범위와 근거
- 입력
  - 사용자 확정 A1~A24: `_workspace/backend/planning-decisions-2026-11-05.md`
  - 갱신된 기획 문서: 브랜치 `claude/planning-backend-gaps-3192d0`(아직 커밋 전)의 `docs/planning/` — PRD v4.3, UX v5.3, AI v4.3, DM v4.2
    - 경로: `/Users/jehyun/Resumate/.claude/worktrees/planning-backend-gaps-3192d0/docs/planning/`
    - 읽기만 한다. 이 브랜치의 `docs/planning/`은 옛 버전이다.
    - 두 문서가 다르면 갱신본을 따른다.
- **A1 해석**(기획 세션 리더 해석 `[가정]`, 사용자 확인 대기)
  - 같은 작업 행의 다시 시도는 처음 공급자로 한다.
  - 새 작업(다시 생성, 다시 채점, 남은 질문 다시 만들기, 요청 범위 작업의 다시 시도)은 현재 활성 공급자로 한다.
  - 현재 구현과 같아서 이번에는 바꾸지 않는다.
- A2(인사이트 생성 중 요건 편집 막기)는 요건 편집 기능(F-P2-03, Could)이 없어서 이번에 하지 않는다.
- 연결: UI 없음, 그대로 "연결 대기"

## 항목별 작업

| # | 확정 내용 (갱신 문서 위치) | db | ai | api |
|---|---------------------------|----|----|-----|
| A5 | 메시지 상한 40은 사용자 + AI이고 시작 인사(`ai_job_id` null, sequence 1)는 뺀다. 사용자 메시지는 `message_count ≤ 38`일 때 받는다 (DM 2.5) | `start_writing_chat`은 인사를 넣어도 `message_count`를 올리지 않는다. 기존 행은 마이그레이션에서 1씩 빼서 보정하고, `is_final` 계산을 확인한다 | | `limitReached`·남은 수 표시 계산 |
| A6 | 그만둔 대화를 다시 이어 할 수 있다(`abandoned → active`, `last_activity_at = now()`) (DM 2.5·3.4, UX S-08·S-10·S-36) | 상태 전이 트리거에서 `abandoned → active`를 허용한다(사용자 세션 직접 update). 저장·전환된 대화는 그대로 막는다 | | 재개 Server Action과 목록 조회(S-08 "그만둔 AI 대화" 포함) |
| A7 | 탈퇴 미완료 판정 `get_account_deletion_state(p_user_id)` → `active` / `deletion_incomplete` / `profile_missing`. 서버 전용 역할(service_role)로 부르고, hash는 `delete_account`와 같다 (DM 6.1, UX FL-07·L-01·S-02) | RPC 추가(service_role만 실행) | | 세션 게이트: `profiles`가 없을 때만 판정해서, `deletion_incomplete`면 동의 게이트보다 먼저 S-25로 보낸다. S-25 경로는 동의 게이트 밖이다. `profile_missing` 처리는 UX 문서를 따르고, 없으면 `[가정]` |
| A10 | 프로필 희망 정보(`desired_job_title`, `interested_industries`)는 판단 근거가 아니다. `total_years_of_experience`는 연차 판정 근거로 남긴다 (AI C-3 V-4, AI-02) | | V-4 지원 근거 목록에서 희망 정보 두 필드를 빼고, 프롬프트 지시를 추가한다(버전을 올림). 인사이트·서류·면접 V-4에 공통으로 적용된다 | |
| A11 | 모든 직무 질문의 사실 전제는 `action`·`result` 또는 성과에서만 가져온다 (AI §4.1) | | `requirement_fit`도 같은 사실 근거 규칙으로 판정한다. 사실을 전제하지 않는 `gap_probe`는 제외. 프롬프트 버전을 올린다 | |
| A13 | 서류 생성 요청(AI-03, AI-04, AI-11) 안에서는 요건을 추출하지 않는다. 요건이 없으면 공급자를 부르지 않고 거부한다 (AI C-6·AI-03·AI-11, UX FL-03) | | | 세 경로에서 `ensureJdExtracted`를 빼고, 요건이 없으면 409 `jd_not_extracted`(화면은 추출 라우트를 먼저 부름)로 답한다. AI-11은 A23 규칙에 따라 실패 응답을 준다. 생성 예산은 58초를 통째로 쓴다 |
| A18 | readiness `hints`에 `project_fields`를 둔다. `next_action = form`과 `suggested_project_id`(이름·역할이 빠진 draft 프로젝트 중 최근 수정 1건)를 준다. 판정 순서와 AI 미연결일 때도 같은 값인 점은 DM 6장을 따른다 | `get_data_readiness` 수정 | | contracts의 hint 값 |
| A19 | `save_provider_key`·`record_provider_key_check`는 서버 전용 역할(service_role)로 실행하고 `p_user_id`를 받는다. `authenticated`·`anon`은 실행할 수 없다 (DM 2.11.3·§5) | 시그니처 변경, 소유 검사를 `p_user_id`로 바꾸고 grant를 옮긴다 | | 키 등록·교체·다시 확인·등급 변경 액션이 세션 확인 후 service_role 클라이언트로 부른다 |
| A20 | 키 등록·실행 모두, 동의 후 시행된 고지 버전 중 `requires_reconsent = true`가 있을 때만 재동의한다 (DM 2.11.5) | `save_provider_key`의 "현재 버전과 정확히 일치" 검사를 통일 규칙으로 바꾼다. `check_ai_run_allowed`와 같은 헬퍼를 쓴다 | | 실행 시점 판정이 같은 규칙인지 확인하고, 다르면 맞춘다 |
| A22 | `interview_sessions.question_validation_report`, `question_usage` (jsonb null) (DM 2.7) | 컬럼을 추가하고 `complete_interview_questions`가 쓴다 | 세트 payload에 이미 있으면 그대로 쓴다. 없으면 매퍼를 추가한다 | 질문 작업 `complete`가 넘긴다 |
| A23 | AI-11이 실패하면 대체 선택을 하지 않는다. 체크 없는 목록을 주고 출처는 `user`. 데이터 부족(422)만 오류로 답한다 (AI AI-11, UX S-17·C-11) | | `fallbackSelection`을 쓰지 않는다(삭제하거나 사용 중단) | 라우트 응답을 바꾼다: 실패하면 `{ selection: 빈 목록, failed: true, reason }`, `selectionOrigin`은 `user`. 계약을 갱신한다 |
| A24 | `app_ai_writer`의 `evidence_links` 직접 INSERT 권한을 없앤다 (DM §5) | grant를 회수하고 grants 테스트에 반영한다 | | 직접 insert 경로가 없는지 다시 확인한다 |

## 공통
- 마이그레이션은 새 파일 `20261105xxxxxx_r1_*`이다. 커밋된 슬라이스 파일은 고치지 않는다(전진 방식).
- pgTAP과 Vitest 테스트를 각 항목에 추가한다. 기존 테스트 중 바뀐 규칙에 걸리는 것(메시지 수, 재동의, AI-11 대체, 키 RPC 권한, readiness)을 고친다.
- `spec-gaps.md`의 해당 항목에 "R1 해소"를 표시한다(각 담당 섹션 "2026-11-05 · R1").

## 팀
| 담당 | 항목 |
|------|------|
| db-engineer | A5, A6, A7, A18, A19, A20, A22, A24 (먼저 바뀐 시그니처를 노트에 올린다) |
| ai-pipeline-engineer | A10, A11, A22(payload), A23(fallback 제거) |
| api-engineer | A5, A6, A7, A13, A18, A19, A20, A22, A23 |
| backend-qa | 항목별 확인 + 회귀(최대 2라운드) |

## 원격 브랜치
적용하지 않는다.
