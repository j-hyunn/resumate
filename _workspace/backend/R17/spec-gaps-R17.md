# R17 spec-gaps — 채용 공고 AI 처리 제거 (2026-11-14)

기획 개정(jd-raw-planning 세션)이 이 슬라이스와 동시에 진행됐다. 아래는 백엔드가 기획 확정 전에 `[가정]`으로 구현한 지점이며, 기획 문서와 어긋날 수 있다. 기획이 다르게 정하면 R18(또는 R17 후속)에서 맞춘다.

| # | 지점 | 구현한 `[가정]` | 기획에 필요한 결정 |
|---|------|----------------|-------------------|
| G1 | JD 근거 형태 (R17-1) | JD를 가리키는 근거 = 원문 문장 인용(`jd_sentence`, S-n, `job_descriptions.sentences`의 결정적 분할). `jd_requirement` 근거는 새로 만들지 않는다 | REQ-n 대체 방식 확정 (원문 인용으로 충분한지) |
| G2 | `jd_requirements` 테이블 (R17-2) | 테이블·과거 행·근거 행 보존, 쓰기만 중단. 과거(v1) 인사이트 표시에만 읽는다 | 보존 기간 / 삭제(2단 파괴 마이그레이션 `phase2-destructive-draft.sql` P1~P4) |
| G3 | `job_descriptions` 추출 컬럼 (R17-3) | `extraction*`·`requirements_hash`·`tech_keywords`·`detected_language`·`extraction_status` 보존, 새 공고는 `pending` 고정, 아무 게이트도 안 봄 | 컬럼 삭제 여부(2단) |
| G4 | 공고 등록 게이트 (R17-9, R17-api6) | `create_application_project`가 `key_invalid`·`ai_consent_required`를 던지지 않음, 추가 모달 ①의 키·동의 게이트 삭제 — 공고 등록은 AI를 안 쓰므로 | **DM 2.7.1 / 2.11.7 경로 ⑥(Q53-1)과 어긋남** — 게이트 폐지 확정 필요 |
| G5 | 지원 건 이름 (R17-8) | `p_name` → `"{회사명} 자기소개서"` → 둘 다 없으면 `application_fallback_name`(키 유무 무관). 추출이 이름을 채우던 경로 없음. R17 이전에 이름이 null로 남은 지원 건은 계속 "새 자기소개서"로 보임 | 이름 규칙 확정 / 과거 null 이름 백필 여부 |
| G6 | 원문 수정 (R17-6) | `update_failed_jd_raw_text` 그대로 → 새 공고(`pending`)는 항상 `jd_raw_text_locked`, 편집 버튼 사실상 없음 | 원문 수정 허용 규칙(언제 고칠 수 있고, 인사이트·근거는 어떻게 되는지) |
| G7 | AI-02 v2 결과 (R17-5, R17-AI-1·2·3·4·5) | 모델이 원문 문장에서 요건을 직접 읽어 판정(라벨·분류·중요도·인용 S-n), 인사이트 내부 키 `M1…Mn`, 상한 20개, 문구 200자, 0개도 정상 결과, 1단계 단일 호출. 결과 jsonb 키 이름은 v1 유지 | AI 명세 AI-02 출력 스키마·처리 단계 개정 |
| G8 | 인사이트 "데이터 변경됨" (R17-5) | `staleReasons.requirements`(키 유지) = "JD 원문이 바뀜"(`insights.jd_text_hash` ≠ 현재 `raw_text_hash`). v1 인사이트는 항상 true | F-P2-07 변경 사유 정의·문구 |
| G9 | 해시·재사용 | `input_hash` = 원문 해시(`jd_text_hash`) 기반, `INPUT_HASH_VERSION` 3, `requirements_hash` 미사용. 새 컬럼 `insights.jd_text_hash` | C-6 정의 개정 |
| G10 | AI-04 요건 참조 (R17-10) | 모델 스키마에서 `requirement_refs` 삭제, 블록·선택의 `requirement_ids`는 계약 유지를 위해 항상 `[]`. `no_requirements` 알림 삭제, JD 블록 = 원문 문장 전체 | AI-04 출력 계약에서 `requirement_ids` 삭제 여부 |
| G11 | AI-12 게이트 진입 대화 (R17-4) | `<gate_requirements>` 블록 제거, 원문 대체 없음 | PRD F-AP-06 (2) 공고 조향을 원문으로 대체할지 |
| G12 | 컨텍스트 크기 | AI-02·AI-04가 공고 문장 전체를 받음(원문 ≤ 50,000자) | C-2 JD 토큰 상한(8k [가정])·비용 추정 재검토 |
| G13 | 문장 0개 공고 (R17-api1) | 인사이트 시작을 막지 않음(빈 결과) | 막을지 여부 |
| G14 | 과거 `jd_extraction` 기록 (R17-7) | `ai_jobs`·`ai_usage_records` CHECK 값 유지, 사용량 화면에 "채용 공고 분석(이전)" 라벨. 남은 과거 잡은 실행 시 `stalled`, 수동 재시도 409 | 사용량 표 행 유지·숨김 |
| G15 | 공통 프롬프트 버전 (R17-AI-6) | `common.v5`(REQ-1 예시 삭제) → 모든 기능의 prompt_version 문자열이 바뀜 | 없음(정보) |
