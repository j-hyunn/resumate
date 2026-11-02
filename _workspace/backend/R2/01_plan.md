# R2 바뀐 A1 반영 (다시 시도의 공급자) 계획

## 범위와 근거
- 사용자가 A1을 바꿨다(2026-11-05, 기획 세션). R1은 앞선 해석(R-48, 같은 행 다시 시도 = 처음 공급자)을 따랐고, 이 해석은 폐기됐다.
- 갱신된 기획 문서(읽기만 한다, 아직 커밋 전): `/Users/jehyun/Resumate/.claude/worktrees/planning-backend-gaps-3192d0/docs/planning/`
  - DM 2.9.1 "경우 (1) 같은 행 다시 시도", DM-17, DM 1장 `run_generation` 설명, DM 2.11.7(경로 ①·②)
  - AI C-11.4 표, AI 공통 실패 처리(270~271행 근처)
  - `decisions.md`의 A1 행, "A1 세부", R-63, R-64, 그리고 `[가정]` "면접 질문 행 다시 열기"
  - UX C-20·S-40(다시 시도 버튼 배지)
- 이 작업 브랜치의 `docs/planning/`은 옛 버전이다. 두 문서가 다르면 갱신본을 따른다.

## 확정 규칙 (갱신 문서 요약)
1. 다시 시도를 포함한 모든 재실행은 버튼을 누른 시점의 **활성 공급자·등급**으로 돈다. 이미 진행 중(`queued`/`running`)인 작업만 시작 공급자로 끝까지 간다.
2. **같은 행 다시 시도**(`POST /api/ai-jobs/{id}/retry`; 비동기 `insight`, `interview_questions`, `interview_evaluation`의 `failed` 행)
   - 작업 행의 `provider`, `model`, `model_tier`, `connection_tier`를 활성 값으로 갱신한다.
   - 활성 공급자 또는 연결 등급(`connection_tier`)이 기록된 값과 **다르면**
     - `step_outputs`를 비우고(`partials` 포함) 처음 단계부터 다시 돈다.
     - 그 작업이 이미 저장한 결과 행(인사이트, 면접 질문, 답변 평가, 종합)을 모두 다시 열어 새 결과로 덮어쓴다(R-63). 한 결과가 두 공급자의 출력으로 섞이면 안 된다.
   - **같으면** 지금처럼 `step_outputs`를 유지하고(완료 단계 건너뜀) 실패한 행만 다시 연다.
   - 어느 쪽이든 늦게 도착한 이전 세대의 완료는 `stale_run`으로 버린다(현행).
   - 결과 행의 `provider`·`model`·`model_tier`·`connection_tier`와 `interview_sessions.question_*`/`evaluation_*`는 새 실행 값으로 기록된다.
3. **거부 코드 (DM 2.11.7)**
   - 경로 ② 같은 행 다시 시도: HTTP 409, 작업 행은 `failed` 그대로. 활성 공급자의 키 없음(활성 공급자 없음 포함) → `key_missing`, 동의 필요(활성 공급자·활성 키 현재 등급, A20 규칙) → `ai_consent_required`, 활성 키 무효 → `key_invalid`.
   - 경로 ① 새 작업 시작: `ai_not_connected` / `ai_consent_required` / `key_invalid`. 지금 구현이 이 표와 같은지 확인하고 다르면 맞춘다.
4. 새 작업(인사이트 다시 생성, 요청 범위 작업 재생성, 다시 채점, 남은 질문 다시 만들기, 다시 보내기)은 이미 활성 공급자로 돈다. 확인만 한다.

## 설계
### db-engineer
- 새 definer RPC `public.retry_ai_job(p_ai_job_id uuid, p_expected_run_generation integer, p_model text, p_model_tier text) returns jsonb`. 실행: `authenticated`(소유 검사 `auth.uid()`). 이름과 인자는 바꿔도 된다. 바꾸면 노트 맨 위에 적는다.
  - 작업 행을 잠그고 `failed`, 소유, 비동기 유형 3종, `run_generation` 일치를 확인한다.
  - 활성 공급자는 `profiles.active_ai_provider`에서, 연결 등급은 그 공급자 키 행에서 읽는다(사용자가 넘긴 값을 믿지 않는다).
  - 키 없음, 키 무효, 동의 필요는 2.11.7 경로 ② 코드로 `raise`한다. 동의 판정은 `private.ai_consent_allows_run`을 그대로 쓴다.
  - 공급자 또는 등급이 다르면 `step_outputs`를 비우고, 유형별로 그 작업의 결과 행을 모두 다시 연다. 같으면 지금 하던 대로 실패한 행만 다시 연다.
    - 어느 행을 어떻게 다시 여는지는 S6(인사이트)·S8(질문·평가·종합) RPC의 `reopen` 판정을 읽고 정한다. 상태 컬럼이 없는 `interview_questions`를 다시 여는 방법은 `[가정]`으로 둔다.
  - `failed → queued`, `run_generation + 1`, 공급자 4개 컬럼을 갱신한다. 반환값: `{ restarted: boolean, provider, connection_tier, run_generation }`.
  - in-flight partial unique 충돌은 지금처럼 23505로 둔다(API가 진행 중 작업을 찾는다).
- 사용자 세션이 `ai_jobs`를 직접 update하는 권한 중 이제 쓰지 않게 되는 것(재시도용 `status`·`run_generation`·`step_outputs` 등)은 다른 사용자 경로(취소 등)가 쓰는지 확인한 뒤 회수한다. 쓰는 곳이 있으면 남기고 노트에 적는다.
- 가드 트리거: 상태가 `failed → queued`일 때만 공급자 컬럼이 바뀌도록 막을지 검토한다(진행 중 작업의 공급자는 바뀌면 안 된다).
- pgTAP: 같은 공급자(실패 행만 다시 열림, `step_outputs` 유지), 다른 공급자(모든 결과 행 다시 열림, `step_outputs` 비움, 공급자 컬럼 갱신), 등급만 다름, 거부 3코드, 다른 사용자, 요청 범위 작업 거부, 이전 세대 완료가 `stale_run`인지. 권한 테스트(허용 목록)를 갱신한다.
- 타입 생성.

### api-engineer
- `runner.retryJob`: 고정 공급자로 `assertJobRunnable`하던 부분을 없애고, 새 작업 시작과 같은 방식으로 활성 공급자 문맥을 구한 뒤 경로 ② 코드로 거부한다. 모델은 활성 공급자와 작업 유형의 `model_tier`로 정한다(새 작업 시작과 같은 라우팅).
- `store.requeueFailed`를 새 RPC 호출로 바꾼다. `restarted`이면 `step_outputs`·`partials`를 버린 빈 메타로 시작한다(재시도 대기 예산은 지금처럼 새로).
- 응답에 `restarted`(처음부터 다시 하는지)를 더한다. 계약을 갱신한다.
- 화면 배지용: 실패한 작업 상태 응답(작업 상태 조회)에 다시 시도 미리보기 `retry: { provider, fromScratch }`를 더한다(활성 공급자 없음이면 `provider: null`). 이름은 계약에 맞게 정해도 된다.
- 주석의 "job's fixed provider"를 바꾼다. 경로 ① 거부 코드가 2.11.7 표와 같은지 확인한다(인사이트·면접·서류·대화 시작).
- `src/server/ai/`를 고쳐야 하면(예: 파이프라인이 DB에 저장된 이전 결과를 보고 건너뜀) 리더에게 알린다. 직접 고치지 않는다.
- 테스트: 러너 단위(같은/다른 공급자, 거부 3코드, 활성 공급자 없음), 통합(로컬 DB에서 다른 공급자로 다시 시도 시 이전 결과 행이 새 공급자 값으로 덮어써짐).

### ai-pipeline-engineer
- 이번에는 부르지 않는다. 엔지니어가 필요하다고 하면 부른다.

### backend-qa
- 규칙 1~4 항목별 확인, RPC ↔ 호출자, 계약, 권한, 회귀(최대 2라운드).

## 공통
- 마이그레이션 새 파일 `20261106000100_r2_*`. 커밋된 파일은 고치지 않는다.
- `spec-gaps.md`에 "2026-11-06 · R2" 섹션을 추가한다. R1 노트의 A1 "현행 유지"는 "R2에서 바꿈"으로 표시한다.
- 원격 브랜치: 적용하지 않는다. 연결: UI 없음, "연결 대기".
