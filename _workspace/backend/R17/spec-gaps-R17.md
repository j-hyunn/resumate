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

## 기획 확정(PR #77, decisions 3.29·4.24) 대조 — 2026-11-16

| # | 결과 | 근거 | 정렬 후 구현 |
|---|------|------|-------------|
| G1 | **해소·변경** | JR-Q1 (a), JR-5, DM 2.8 | JD 근거 = `Sn`. 인사이트에서만 — 요건 행의 "공고 원문" 링크는 근거 행이 아니라 `sids`. 자소서 근거에서 `jd_sentence` 거부(#12) |
| G2 | **대체** | JR-Q3 (b), 4.24 #1·#4 | `jd_requirements` drop(C), `jd_requirement` 근거 행 삭제(A) |
| G3 | **대체** | 4.24 #2 | 추출 컬럼 8개 drop(C) |
| G4 | **해소** | JR-1, 4.24 #9 (Q53-1 되돌림) | 생성 게이트 없음 — 가정이 확정됨 |
| G5 | **해소** | 4.24 #9·#16 | 이름 항상 결정, `name is null` 백필(A) |
| G6 | **대체** | JR-7, 4.24 #11 | 신설 `update_jd_raw_text`(인사이트 실행 중만 잠금), `rawTextEditable`·`rawTextLockedReason` |
| G7 | **대체(임시)** | JR-Q2 보류, 4.24 #18 | `MT-n`·`match_keys`·`requirement_text` ≤ 120·최대 15·`{prompt_version, items}`. 인사이트 재설계 사이클에서 다시 바뀜 |
| G8 | **해소** | 4.24 #13 | `staleReasons.{career, rawText}`, `schemaVersion` 조회 |
| G9 | **해소·변경** | 4.24 #13 | `jd_text_hash` 대신 `requirements_hash` → `raw_text_hash` rename |
| G10 | **대체** | JR-5, 4.24 #19 | AI-04는 공고를 읽지 않음 — 최신 인사이트 + 커리어 + 문항·메모 |
| G11 | **대체** | 4.24 #14·#19 | AI-12 게이트 = 인사이트 보완점(`insight_id`·`insight_item_key`) |
| G12 | **잔여(일부)** | 4.24 #18 "알려진 위험" | AI-04는 공고를 안 읽어 해소, AI-02는 원문 전체 — 단계 1 지연 실측(`latencyMs`, `ai_stage_timing` 로그)은 재설계 사이클 입력 |
| G13 | **해소** | JR-3, 4.24 #9·#13 | 문장 0개 → `jd_no_sentences`(생성·원문 수정·인사이트 시작) |
| G14 | **해소** | JR-Q5, 4.24 #8 | 과거 값 CHECK 유지. 사용량 행 표시 규칙은 UI 8 |
| G15 | **해소** | 4.24 #19 (`common.v5`) | 같음 |

**정렬 뒤 남은 `[가정]`** (기획에 명시 없음 — 각 notes 참조): db `R17b-db-1~12`, AI `R17b-AI-1~9`, api `R17b-api-1~8`. 기획 확인이 특히 필요한 것:
- `R17b-api-1` `jd_no_sentences` HTTP 상태(생성·수정 400, 인사이트 시작 409)
- `R17b-api-3` 게이트의 `insight_id`가 사라졌거나 ready가 아니면 최신 인사이트로 대체
- `R17b-api-5` 자동 시작은 생성 Server Action 안 `after()`로 첫 단계 실행
- `R17b-db-2` JD 가드가 `source_url` 변경도 막음
- `R17b-db-4` `insight_id`만 있는 게이트 진입 허용(보완점 전부)
- `R17b-AI-5` V-5 재생성 `call_key` `insight.synthesize.regen`
- `R17b-AI-6`·`AI-7` AI-04 `<insight>` 블록 구성과 "인사이트 없음" 안내 방식

**정렬 QA에서 나온 기획 문서 간 불일치**
- **G16 자소서 시작 인사의 인사이트 상태 줄** — AI 명세(AI-04)는 인사이트 상태 줄을 AI-04 시작 인사 안에 둔다고 쓰고, DM 2.5는 화면이 그리고 저장하지 않는다고 쓴다. 구현은 DM을 따랐다(인사는 DB 3종, 상태 줄은 화면). 둘 중 하나를 고쳐야 한다.
- `R17b-api-9` 원문이 바뀐 뒤 실패한 인사이트 잡은 공급자가 달라 처음부터 다시 도는 재시도도 막는다(사용자는 "다시 생성")
- **→ G16 해소 (2026-11-20, decisions 3.30 UI60-G16)**: 지금 구현(인사 DB 3종, 상태 줄은 화면이 그림)이 정본. AI-04 명세를 맞춤.
