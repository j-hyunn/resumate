# S3a AI 실행 기반 v4 (BYOK) 요약

## 만든 것
### DB (새 마이그레이션 5개, B-1)
- 사용량 원장(`usage_events`, `usage_limits`, 원장 RPC)을 삭제했다.
- `ai_jobs` v4
  - `provider` / `model_tier` / `connection_tier`
  - 실행 세대 `run_generation`과 재시도 합계 `retry_count`를 분리
  - `next_run_at`, `retry_wait_total_ms`, `quota_resets_at`, `retry_after`
  - `error_code` 15값 → `error_category` 5값, `failure_cause` 7값(generated)
  - 대상 단위 동시 실행 1개 제한, 공급자를 포함한 재사용 인덱스
- `ai_usage_records`(불변, 호출 1회 = 1행)
- `ai_price_tables`: 3개 버전 × 9개 모델 = 27행 시드
- RPC: `get_ai_usage_summary`, `complete_ai_job`(차감 없음), `sweep_stalled_ai_jobs`, `claim_due_ai_jobs`

### AI (`src/server/ai/`)
- 공급자 어댑터 3개(OpenAI `openai` 7.45 / Gemini `@google/genai` 2.31 / Claude)
  - 모델 매핑은 사용자 확정안
  - 정본 스키마를 공급자별 구조화 출력으로 변환
  - 스트림·사용량·오류(C-11.2)를 공통 형식으로 정규화
  - 키 검증 2단계
  - SDK 자체 재시도는 끔, 자동 대체 없음
- `createLlm`: 호출마다 사용 기록, `settle()`, 실행 단위 signal
- 키가 오류·로그에 남지 않는다(어댑터 3개 테스트).

### API (실행기·라우트)
- 원장 코드를 삭제했다.
- 원인별 재시도(C-11.3)
  - 함수 안에서 기다리지 않고 `next_run_at`으로 예약한다.
  - 대기 합계 상한 120초
- 깨우기: 상태 조회가 주 경로, `/api/cron/ai-jobs`가 안전망(B-4)
- 무료 등급: 순차 실행, 호출 간격 6초
- 호출마다 사용 기록과 가격표로 계산한 예상 비용
- 공급자 문맥·키 인터페이스: 가짜 구현과, production에서 거부되는 개발용 env 구현. 실제 구현은 S3b에서 붙인다.
- `useAiJob` 상태 응답에 실패 원인·재시도 시각·공급자 배지 정보를 넣었다.
- SSE 오류 이벤트에 `retryAfter` / `quotaResetsAt` / `failureCause`를 실었다.
- 사용량 미터 액션 `getAiUsageSummary`
- 서비스 `ANTHROPIC_API_KEY`를 삭제했다.

## 검사
typecheck / lint / Vitest 631개(로컬 통합 포함) / build / pgTAP 543개 모두 PASS

## QA
- 2라운드. Major 3건, Minor 7건 해결. QA-S3a-10은 라운드 뒤에 해결했다.
- 열림: QA-S3a-11 (Minor, 함수 시간 예산 계산 → S3b)
- S5 확인 사항: QA-S3a-08 (병렬 단계 재시도 규칙)

## 사용자 결정 (2026-10-28)
- 모델 매핑안 확정
- 공급자 오류가 아닌 단계 예외는 `stalled`
- 수동 재시도는 예산을 새로 시작

## 남은 일 (S3b)
- 키 테이블·암호화·`app_key_reader`
- 공급자 문맥·키 실제 구현, 동의 확인
- `key_verification` 작업의 대상(target) 정하기
- readiness `ai_connection`
- QA-S3a-11

## 하네스·UI 메모
- UI `patterns.md`가 아직 v3 기준이다(오류 범주 4값, "사용량은 차감되지 않았습니다" 문구). UI 하네스 갱신 대상이다.
- `vercel.json` 크론 등록은 배포 때 한다. Hobby 플랜은 크론이 하루 1회다.
- pnpm이 `@google/genai`, `protobufjs`의 빌드 스크립트를 막아 두었고 승인하지 않았다. 동작에는 문제가 없다.
