# S3b BYOK 키·동의 요약

## 만든 것
### DB (새 마이그레이션 7개)
- 역할 `app_key_reader`: 테이블 권한 0, `get_provider_key_secret` 실행만 가능
- `ai_provider_keys`: 암호 컬럼 4개는 앱·API 모든 역할에 grant 0. 뷰 `ai_provider_keys_public`
- `profiles.active_ai_provider`: 키 행 복합 FK, 키를 지우면 null
- `ai_data_use_consents`: 현재 고지 버전 가드, 무료 등급 확인 CHECK
- 참조 테이블 `ai_disclosures`(6행), `ai_providers`(3행, 모두 열림, Gemini 추천)
- RPC
  - `save_provider_key`(`p_key_id` 추가), `record_provider_key_check`, `delete_provider_key`, `set_active_ai_provider`
  - `mark_provider_key_invalid`, `record_provider_key_success`(신설), `get_provider_key_secret`, `check_ai_run_allowed`(신설)
- `get_data_readiness`에 `ai_connection` 추가

### API
- 봉투 암호화
  - AES-256-GCM, 키마다 DEK, AAD = user|provider|keyId
  - 중간 버퍼까지 0으로 지운다.
  - `KmsAdapter` + `EnvKms`(출시 전 KMS 교체 경고)
- `app_key_reader` 클라이언트, 공급자 문맥·키 공급·키 상태 보고의 실제 구현
- 실행 게이트
  - 작업 시작, 수동 재시도, 단계마다 키·동의를 확인한다.
  - 동의 때문에 막히면 `key_missing`으로 끝낸다.
- Server Action 8개
  - 연결 조회, 고지 조회, 동의, 동의 철회(진행 중 작업 취소 포함)
  - 키 등록·교체(동기 검증, R-38 저장 규칙), 다시 확인, 삭제, 활성 공급자 선택
- 키 검증 작업: 대상 `ai_provider` / uuidv5(provider), 재시도 불가, 2단계만 사용 기록
- QA-S3a-11 해결: 단계 시작 조건 = 경과 + 단계 마감 + settle 5초 ≤ 58초

## 검사
typecheck / lint / Vitest 697개(로컬 통합 포함, 연속 통과) / build / pgTAP 821개 모두 PASS

## QA
- 2라운드. Major 1건, Minor 5건 해결. QA-S3b-07은 라운드 뒤에 해결했다.
- 설계 차이 1건(QA-S3b-06)은 기획 판단을 기다린다.

## 사용자 확인 필요 (spec-gaps / decisions)
1. 공급자별 고지 첫 버전과 고지 문구 — 법무 확인(D-39) 전 임시값, 출시 차단
2. KMS 전환을 출시 조건으로 둘지와 DM 2.11.1 운영자 역할 문구 — `pg_read_all_data` 역할은 DB 안에서 암호문을 읽을 수 있다
3. 등급 변경: 저장된 키를 다시 검증하고 다시 암호화한다(키를 다시 붙여넣지 않음)
4. 키 검증: 사용 기록은 2단계만, 검증 상한 15초(무료 20초)
5. 재동의 규칙: 등록 때(고지 버전 일치)와 실행 때(`requires_reconsent` 기준)가 다르다
6. `ai_providers` 시드: 세 공급자 모두 열림, 콘솔 URL
7. `record_provider_key_success`, `check_ai_run_allowed`를 DM에 반영할지
8. 동의 때문에 막힌 작업을 `key_missing`으로 끝내는 것(C-11.1에 맞는 코드 없음)
9. QA-S3b-06: 키 저장·확인 RPC를 브라우저에서 직접 부를 수 있다(본인 행만 영향)

## 연결
UI 화면 없음. S-40, S-41, S-42와 모든 AI 진입점의 잠금 상태는 "연결 대기"다.

## 배포 전
- KMS 전환과 기존 DEK 재포장
- `AI_KEY_KEK_*` 설정
- 크론 등록
