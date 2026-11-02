# S3 AI infrastructure 요약

## 만든 것
### DB (마이그레이션 6개)
- 테이블
  - `ai_jobs`: 상태 전이 가드, 실행 세대 감소 금지, 진행 중 중복 방지 부분 유니크 인덱스, `step_outputs`
  - `usage_events` / `usage_limits`: free 한도 insight 10, draft 20, interview_session 5, writing_chat 10
  - `evidence_links`: source_type별 source_field CHECK
- 커리어 6개 테이블에 근거 원본 삭제 트리거
- RPC
  - 원장: `reserve_usage`(advisory lock, 한도), `charge_usage` / `release_usage`, `release_usage_for_job`, `complete_ai_job`(성공 처리와 그 예약 1건 확정을 한 트랜잭션에서)
  - 작업: `sweep_stalled_ai_jobs`(service_role), `request_ai_job_cancel`, `get_usage_summary`
- 권한: 사용자의 ai_jobs 조회는 컬럼 단위(params, step_outputs 제외). app_ai_writer 쓰기는 허용 목록 방식.

### AI (`src/server/ai/`)
- `AiClient`(운영 구현과 가짜). 구조화 출력은 `output_config.format`. 오류는 C-6 코드로 매핑. 거절 시 모델 대체 스위치 `REFUSAL_FALLBACKS_ENABLED`(현재 켜짐).
- 경력 팩(C-1): 같은 데이터면 같은 바이트, 별칭, `career_snapshot_hash`.
- JD 문장 분할과 컨텍스트(C-2)
- 검증 V-1~V-8, 자리 표시(C-5), `validation_report`
- evidence_links 행 매핑, 증분 JSON → 블록 이벤트 스트리밍, `computeInputHash`

### API (`src/server/jobs/`, 라우트)
- 실행기
  - 단계 레지스트리와 체크포인트, `after()` 실행, 10초 heartbeat
  - 일시 오류 자동 재시도 1회, 실행 세대 조건
  - 55초 예산 초과 시 `/continue`로 자기 호출해 이어 실행(HMAC 토큰)
  - 같은 입력의 작업이 진행 중이면 재사용
- 원장 처리: 예약 id 단위. 성공은 `complete_ai_job` 하나, 그 밖의 출구는 자기 예약 해제. 수동 재시도는 점유에 이긴 쪽만 원장을 건드린다.
- 라우트: `GET /api/ai-jobs/[id]`(useAiJob 모양, 지연 멈춤 감지), `cancel`, `retry`, `continue`, `/api/cron/stalled-jobs`(service role은 이 모듈에만 둔다)
- SSE 헬퍼: 마지막 종료 이벤트로 결과를 판정한다. 사용량 조회 액션.

## 검사
typecheck / lint / Vitest 460개(로컬 통합 포함) / build / pgTAP 489개 모두 PASS

## QA
2라운드. Major 4건, Minor 5건 모두 해결(QA-S3-06은 라운드 후 해결).

열림 Minor 2건(S4에서 처리):
- QA-S3-10: 재시도 중 예약이 크론 정리까지 묶일 수 있다.
- QA-S3-12: 진행 중인 같은 작업이 있을 때 재시도하면 일반 409가 난다.

QA-S3-11은 S4 규칙으로 넘긴다: 스트림 정산은 결과 저장 여부로 판정한다.

## 사용자 결정이 필요한 것
- 거절 시 모델 대체: 명세 C-6은 "거절이면 실패 처리"다. 지금은 대체를 켜 두었고(QA도 켜 두기를 권함), 스위치 하나로 끌 수 있다.

## spec-gaps 추가 [가정]
- usage_limits `chat_message` 없음
- application_project_id FK는 S5에서 추가
- `step_outputs`
- ai_jobs `target_type` 목록과 상태 전이 규칙
- 근거 저장 직전 원본 삭제
- 보유 기간 정리 미구현
- `career_snapshot_hash` 계산 방식
- 거절 대체
- V-5 세부 규칙
- 6종 밖의 자리 표시 처리
- 미분류 예외 처리, refused 재시도, 수동 재시도 reason

## 배포 메모
- Vercel Cron 설정이 필요하다(Hobby는 하루 1회).
- Preview의 Deployment Protection이 `/continue` 자기 호출을 막을 수 있다.
- `SUPABASE_SERVICE_ROLE_KEY`는 크론에만 쓴다.

## 후속 (2026-10-27)
- 사용자 결정에 따라 거절 시 모델 대체를 껐다. `refused`는 바로 실패하고 자동 재시도하지 않는다(C-6). 검사 5종 PASS.
