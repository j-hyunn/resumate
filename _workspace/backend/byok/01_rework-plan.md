# BYOK 재작업 계획 (S0~S3)

- 작성: 2026-10-28
- 기준 기획: PRD v4.2, UX v5.2, AI v4.2, 데이터 모델 v4.1a (origin/main 커밋 `6fc33e7`)
- 브랜치: `claude/backend-byok` (origin/main `be0e5f5` 기준)

## 1. 바뀐 전제

| 이전 (S0~S3 구현 기준) | BYOK (v4) |
|------------------------|-----------|
| 서비스 Anthropic 키 하나로 모든 AI 실행 | 사용자 본인 키, 공급자 3곳(OpenAI / Gemini / Claude) 중 **활성 1개**(D-28) |
| 사용량 원장: 예약 → 확정/해제, 월 무료 한도 | **원장·한도 없음**(D-34). 호출 1회 = `ai_usage_records` 1행(토큰 + 예상 비용). 미터는 이번 달만(UB-2) |
| 모델 장애 시 이전 세대로 대체, 거절 = `refused` | **자동 대체 없음**(D-31), 거절은 `safety_blocked` |
| 일시 오류 1회 즉시 재시도 | 원인별 재시도(C-11.3): 분당 한도 4회, 장애 2회, 스키마·시간 초과 1회. **함수 안에서 기다리지 않고** `next_run_at`으로 예약, 작업당 대기 합계 120초 |
| 병렬 실행 | 무료 등급은 순차 + 호출 간격(C-12) |
| 오류 범주 4개 | `error_category` 5값 + `failure_cause` 7원인(F-AI-08) |
| 동시 실행 제한 = 같은 input_hash | 같은 대상(`user_id, job_type, target_type, target_id`) 동시 1개(D-34) |
| 키 저장 없음 | `ai_provider_keys` 봉투 암호화 + 외부 KMS, 별도 역할 `app_key_reader`로만 암호문 접근(DM-16) |

## 2. 슬라이스별 영향

| 슬라이스 | 영향 | 유지 | 바꿀 것 |
|----------|------|------|---------|
| S0 | 작음 | 앱 골격, 스크립트, Vitest | env: 서비스 `ANTHROPIC_API_KEY` 제거. 키 암호화 설정(KMS 또는 출시 전 임시 마스터 키) 추가. 공급자 SDK 의존성(`openai`, `@google/genai`) 추가 |
| S1 | 작음 | 인증, 동의(`consents` 스키마 그대로), 프로필 | `app_key_reader` 역할. `profiles.active_ai_provider`(키 테이블 FK라 S3b에서) |
| S2 | 작음 | 커리어 테이블·RPC 전부 | `get_data_readiness`에 `ai_connection` 추가, 키 없음·무효면 `next_action = form`(S3b에서, 키 테이블 이후) |
| S3 | **큼** | 경력 팩(C-1), JD 분할(C-2), 검증 V-1~V-8, 자리 표시, evidence_links와 삭제 트리거, 증분 JSON 스트리밍, SSE 헬퍼, 실행기의 체크포인트·세대·이어 실행·취소·멈춤 정리 골격 | 아래 3장 |

## 3. 새 슬라이스 구성

### S3a — AI 실행 기반 v4 (S3 재작업)
- **DB**
  - 삭제: `usage_events`, `usage_limits`, 원장 RPC(`reserve_usage`, `charge_usage`, `release_usage`, `*_for_job`, `get_usage_summary`). `complete_ai_job`은 차감 없이 "성공 전이"만 하도록 단순화. `sweep_stalled_ai_jobs`에서 예약 해제 제거.
  - `ai_jobs` v4: `provider`, `model_tier`, `connection_tier`, `retry_count`(명세의 `attempt_count` 이름 변경), `next_run_at`, `retry_wait_total_ms`, `progress.waiting_retry_until`, `error_code` 목록 교체, `error_category` 5값, `failure_cause`(generated 7값), `quota_resets_at`, `retry_after`, `job_type`에 `key_verification`. 동시 실행 partial unique를 `(user_id, job_type, target_type, target_id)`로 교체. 재사용 인덱스에 `provider` 추가.
  - **실행 세대**: S3에서 `attempt_count`를 "실행 세대"(좀비 실행기 차단)로 썼는데, 명세는 이 컬럼을 "재시도 횟수 합계"(`retry_count`)로 바꿨다. 세대는 내부 컬럼 `run_generation`으로 분리한다 `[가정 → spec-gaps]`.
  - 신설: `ai_usage_records`(불변, app_ai_writer insert만), `ai_price_tables`(운영자 쓰기, 새 버전 추가만), `get_ai_usage_summary(period_month, include_previous)`.
  - 결과 메타 컬럼 `provider` / `model_tier` / `connection_tier`는 결과 테이블이 생기는 각 슬라이스(S4~S8)에서 넣는다.
- **AI**
  - 공급자 어댑터 계층(C-10): 공통 요청 `{tier, system_blocks, user_blocks, output_schema, stream, max_output_tokens, reasoning_level}`. 어댑터는 `anthropic` / `openai` / `gemini` 세 개.
  - 어댑터별로 맞출 것: 모델 매핑(C-10.1), 구조화 출력 변환(C-10.2, 정본 스키마 → 공급자 형식), 스트리밍 정규화, 사용량 정규화(C-13 필드), 오류 정규화(C-11.2 → 7원인 + `error_code`, `Retry-After`, Gemini 일일 한도 초기화 시각).
  - 캐시: Claude만 캐시 지점과 예열(C-10.3).
  - 정본 스키마 규칙 검사 유틸: 최상위 `oneOf` 없음, 선택 값은 `null`, 깊이 5 이하.
  - 기존 Anthropic 클라이언트는 어댑터 하나로 옮긴다. 이전 세대 대체(`AI_UNAVAILABLE_FALLBACK`)와 `REFUSAL_FALLBACKS_ENABLED`는 삭제한다(D-31).
  - 테스트: 공급자별 녹화 픽스처와 가짜 SDK. 실제 API 호출은 하지 않는다.
- **API (실행기)**
  - 원장 코드 제거. 호출마다 `ai_usage_records` insert(실패 호출 포함, 가격표로 예상 비용 계산).
  - 재시도 규칙 C-11.3: 함수 안에서 기다리지 않고 `next_run_at` + `progress.waiting_retry_until`을 기록한 뒤 종료하고, 나중에 다시 깨운다. 작업당 대기 합계 120초. 최종 실패 시 `retry_after`·`quota_resets_at`.
  - 스트리밍은 첫 토큰 전 오류만 재시도한다.
  - 무료 등급(C-12): 순차 실행, 사용자·공급자 단위 최소 호출 간격(Gemini 무료 약 6초 `[가정]`).
  - 키 공급 인터페이스 `KeySource.forJob(jobId)`: S3a는 가짜 구현으로 테스트하고, S3b에서 실제 구현을 붙인다.
  - `key_invalid`면 `mark_provider_key_invalid`(S3b)를 호출할 자리를 둔다.
  - 상태 응답(useAiJob)에 `failure_cause`, `retry_after`, `quota_resets_at`, `waiting_retry_until`, 공급자 배지 정보를 넣는다.
  - 사용량 조회 액션을 `get_ai_usage_summary` 기준으로 바꾼다.

### S3b — BYOK 키·동의 (신규)
- **DB**
  - 테이블: `ai_provider_keys`(암호 컬럼 4개는 어떤 역할에도 grant 없음), 뷰 `ai_provider_keys_public`, `profiles.active_ai_provider`(복합 FK, on delete set null), `ai_data_use_consents`, 참조 테이블 `ai_disclosures`·`ai_providers`(초기 행).
  - 역할: `app_key_reader`(함수 실행 권한만).
  - RPC: `get_provider_key_secret(ai_job_id)`(running이고 heartbeat 최근이며 user·provider가 일치할 때만), `save_provider_key`, `record_provider_key_check`, `mark_provider_key_invalid`, `delete_provider_key`, `set_active_ai_provider`.
  - `get_data_readiness`에 `ai_connection` 추가.
- **서버**
  - 봉투 암호화 모듈: AES-256-GCM, AAD = `user_id || provider || 키 행 id`, DEK는 KMS로 감싼다. KMS 어댑터 인터페이스를 두고, 출시 전 임시 구현은 환경 변수 마스터 키(DM 2.11.2 `[가정]`).
  - `app_key_reader` 클라이언트: app_ai_writer와 같은 단명 JWT 방식에 역할만 다르다.
  - 키 검증 작업(`key_verification`, C-10.5): 2단계 판별과 저장 규칙 R-38. 재시도하지 않는다.
  - 설정 액션: 키 등록·교체·다시 확인·삭제, 활성 공급자 선택, 공급자·등급별 고지 조회와 동의(무료 등급은 별도 체크).
  - AI 실행 전 검사: 활성 공급자, 키 상태, 재동의 필요 여부.
  - 로그 마스킹 테스트(NFR-KEY-05).
- **QA 중점**: 다른 사용자·다른 공급자·끝난 작업의 암호문 접근 거부, 암호 컬럼 grant 0, 키가 응답·로그·오류에 나오지 않는지(NFR-KEY-01·05·07·08).

### 이후 슬라이스 조정 (S4~S9, 카탈로그 갱신)
- S4: `writing_chats.usage_event_id` 없음, `message_count <= 40` CHECK. 턴은 무료 등급이면 응답 → 정리 순차. 호출마다 사용 기록. 결과 메타에 공급자 컬럼.
- S5: 키 없이도 JD 등록이 동작한다. 요건 추출은 키가 있으면 생성 직후, 없으면 첫 AI 기능 때(D-30). `extraction_provider`/`extraction_model`, 키 없는 JD는 `pending`·`default` 이름.
- S6~S8: 결과 테이블에 공급자 메타 컬럼, `interview_sessions`에 공급자 4개 컬럼(R-40). 무료 등급 순차 경로.
- S9: 탈퇴 집계에 키·동의·사용 기록 포함. 키 즉시 파기. `ai_usage_records` 13개월 정리 크론.

## 4. 진행 순서

1. **R0 정리** (리더)
   - 하네스 문서 갱신(5장).
   - `spec-gaps.md`에서 의미가 없어진 항목을 "폐기(v4)"로 표시.
   - `slice-catalog.md` 갱신.
2. **S0·S1 소규모 수정**: env, 의존성, `app_key_reader` 역할. S3a와 함께 진행한다.
3. **S3a**: db, ai, api 병렬. QA 2라운드.
4. **S3b**: db, api 병렬. ai는 키 검증 호출 어댑터만. QA 2라운드.
5. 그다음 S4.

## 5. 하네스 수정 필요 (R0, 사용자 확인 후 `.claude/`에 반영하고 CHANGELOG 기록)

| 파일 | 고칠 내용 |
|------|-----------|
| `resumate-backend/references/backend-context.md` | LLM 행: Anthropic 단일 → 공급자 어댑터 3개(사용자 키). DB 역할에 `app_key_reader` 추가. 디렉터리 `src/server/ai/providers/`. env·KMS 규칙. Next 16 `proxy.ts`. 테스트에서 세 공급자 모두 실제 호출 금지 |
| `resumate-backend/references/slice-catalog.md` | S3를 S3a/S3b로 나눔, S4~S9 조정(3장), Wiring 표에 AI 연결(설정) 영역 |
| `ai-pipeline-impl/SKILL.md` | "강제 tool로 JSON" → 공급자별 구조화 출력(C-10.2). 오류 매핑을 C-11 7원인으로. 재시도 C-11.3, 사용 기록 C-13. 대체 금지(D-31) |
| `nextjs-server-api/SKILL.md` | 사용량 원장(reserve/charge/release) 섹션 → 사용 기록·미터. 실행기에 `next_run_at` 재시도 예약·무료 등급 순차. `middleware.ts` → `proxy.ts`. 키 검증·키 공급 경로 |
| `supabase-migration/SKILL.md` | `app_key_reader`, 암호 컬럼 grant 금지, 키 RPC 보안 규칙 |
| `backend-integration-qa/SKILL.md` (+ `run-checks.sh` 변경 없음) | 원장 출구 경로 점검 → 사용 기록 누락·중복 점검. 키 격리·마스킹 점검 항목 추가 |
| `.claude/agents/ai-pipeline-engineer.md`, `api-engineer.md` | 책임 문구에서 "usage ledger" → "usage records", 공급자 어댑터 |
| **Codex 사본** `.agents/skills/**`, `.codex/agents/*.toml` | 위 `.claude/` 변경을 같은 내용으로 반영(현재 경로만 다르고 본문은 동일). 사본 동기화 규칙이 하네스 README·CHANGELOG에 없으므로 함께 기록 |

## 6. 결정이 필요한 것

| # | 질문 | 권고 |
|---|------|------|
| B-1 | 기존 S1~S3 마이그레이션을 고칠까, 새 마이그레이션으로 덮을까 | **새 마이그레이션(전진 방식).** 이미 main에 머지됐다. 원격에는 적용한 적이 없어 고쳐도 되지만, "적용·머지된 마이그레이션은 고치지 않는다" 규칙을 지키는 편이 이후 원격 개발 브랜치 적용과 리뷰에 안전하다. 대신 원장 테이블 생성 → 삭제 기록이 남는다 |
| B-2 | KMS 공급사 (AWS KMS / GCP KMS) | **구현은 KMS 어댑터 인터페이스 + 임시 환경 변수 마스터 키로 시작.** 공급사는 배포 전 결정(명세 `[가정]`) |
| B-3 | OpenAI·Gemini 모델 ID와 가격 (명세 `[가정]`, "구현 전 확정 필요") | S3a 착수 때 공급자 공식 문서로 최신 모델·가격을 조사해 매핑안을 제시하고, 확인을 받은 뒤 가격표 첫 버전을 넣는다 |
| B-4 | `next_run_at`으로 예약된 작업을 누가 깨우나 | **상태 조회(폴링) 때 깨우는 것을 주 경로로, Vercel Cron을 안전망으로.** 화면이 2초마다 폴링하므로 대기(최대 16초 간격)는 폴링으로 충분하다. 사용자가 화면을 떠나면 크론까지 멈춘다(Hobby는 하루 1회). 명세에 깨우는 주체가 없어 spec-gaps에 기록 |
