# Resumate AI 기능 명세 v4.3

> 작성: ai-feature-designer / 기준 입력: `_workspace/01_product-planner_prd.md` (**PRD v4.3**, BYOK), `_workspace/02_ux-planner_flows.md` (**UX v5.3**), `_workspace/02_data-architect_data-model.md` (**DM v4.2**), `00_input/brief-2026-11-05.md`(리더 브리프), `00_input/planning-decisions-2026-11-05.md`(사용자 확정 A1~A24), `00_input/spec-gaps-summary.md`·`spec-gaps.md`(백엔드 구현 S0~S9 차이), `00_input/brief.md`(이전 피드백·결정), `product-context.md`
> 상태: v4.3 — 백엔드 구현 반영(2026-11-05). 사용자 확정은 "확정 2026-11-05 (사용자)"로 표기한다. `[가정]`·`[결정 필요]`·`[보류]` 태그 항목은 확정이 아니다.
> 범위: 설계 문서만 다룬다. 프롬프트 전문과 API 호출 코드는 쓰지 않는다.
> 테이블·필드명은 `_workspace/02_data-architect_data-model.md` **v4.2**를 기준으로 한다. 출력 스키마 예시의 JSON 키는 **모델 출력 형식**이며 저장 시 데이터 모델 이름으로 매핑된다(C-3, 4.3, AI-12 매핑표). v4.2 기준 이 문서에 `[제안]` 상태의 이름은 없다. 모델은 기능별 **등급(경량/기본/고성능)**으로 적고, 공급자별 모델은 C-10.1 매핑표 하나에서 정한다.

---

## 0. 요약

### 0.v43 v4.3에서 바뀐 것 (백엔드 구현 반영, 2026-11-05)

| 영역 | v4.2 | v4.3 |
|------|------|------|
| 실패 작업 다시 시도의 공급자 | 정하지 않음 | (A1 — 확정 2026-11-05 (사용자, A1 변경)) **"다시 시도"를 포함한 모든 다시 시도·재실행은 누른 시점의 활성 공급자·등급으로 돈다**(C-11.4). 같은 작업 행의 다시 시도(실패한 인사이트·면접 질문 생성·채점 작업)에서 활성 공급자·등급이 작업에 기록된 것과 다르면 완료 단계 결과(`step_outputs`)를 버리고 처음 단계부터, 같으면 완료 단계를 건너뛰고 잇는다. 연결 확인(키 없음 → "AI 연결 필요", 무효, 동의 필요 `ai_consent_required`)도 활성 공급자·등급 기준. 앞선 R-48 해석(같은 행 다시 시도 = 처음 공급자)은 폐기 |
| 판단 근거 | 프로필 희망 정보도 근거로 셀 수 있었음 | 희망 직무·관심 산업은 판단 근거가 아니고 문맥 참고만(A10, C-3 V-4) |
| 저장 문장 | 예시에 별칭(`PRJ-3`)이 섞여 있었음 | 저장·표시 문장에 별칭을 쓰지 않는다. 표시 이름으로 바꾼다(C-3 저장 키·표시 규칙) |
| 진행 단계 | `match`/`synthesize`/`validate` 등 | `prepare`, `synthesize_regen`, `complete` 추가(C-6) |
| 대기·재시도 | 모든 대기를 `next_run_at`으로 예약 | 동기·스트리밍 경로는 요청 안에서 짧게 기다리거나 바로 실패(C-11.3, A14) |
| 경력기술서 | 블록 보존, 생성 안에서 요건 추출 | 실패 시 블록 보존 없이 새 초안으로 처음부터(A4), 요건 추출은 화면이 먼저 끝낸다(A13), tone `concise`/`detailed`(A17) |
| AI-11 실패 | 최신 경력순 전체 선택으로 대체 | 대체 없음. 체크 없이 사용자가 직접 고른다(A23) |
| 자소서 | ±10% 범위, 이벤트 `validated → adjusting_length` | "최대 10% 초과까지 통과"를 명시(A12), 이벤트 `adjusting_length → validated`(AI-04) |
| 생성 직후에만 보이는 안내 | 저장 여부 미정 | `omitted`·`notes_for_user`·`char_adjust_needed`는 저장하지 않는다(A21) |
| 면접 | 세트 단위 재생성, 질문 V-5 치환 | 질문 단위 가능성 검사, 질문 V-5 위반은 버리고 다시 만듦, 직무 질문 전부 사실 전제 제한(A11), 다시 채점 범위(A9), 세트 기록 `question_validation_report`·`question_usage` |
| AI-12 | 상한 40에 인사 포함 여부 미정, 그만둔 대화 재개 없음 | 시작 인사는 상한에서 뺀다(A5), `abandoned → active` 재개(A6), 거절한 소속 제안은 저장하지 않음(A15) |
| 공급자 사실 | 가격표 초안·오류 표 `[가정]` | 가격표 첫 버전(9모델, 3개 버전), 장문 캐시 단가 2개, 오류 표 갱신, Gemini `responseJsonSchema`, OpenAI 검증 16토큰 |
| 출력 상한 | 일부만 | 구현이 정한 출력 길이·개수 상한을 C-14에 모음 `[가정]` |

### 0.v4 v4에서 바뀐 것 (PRD v4 BYOK)

| 영역 | v3 | v4 |
|------|----|----|
| 키·비용 | 운영자 키, 운영자 비용 상한 $2, 서비스 무료 한도 | **사용자 본인 키(OpenAI / Gemini / Claude), 활성 공급자 1개**(D-28). 운영자 AI 비용 0. 서비스 한도·차감·예약 폐기(D-34) |
| 모델 | Claude 모델 고정 | **공급자 어댑터 + 등급별 고정 매핑**(C-10, D-31). 자동 대체 없음 |
| 구조화 출력 | Claude 구조화 출력 | 정본 JSON Schema → 공급자별 형식 변환, 서버가 항상 재검증(NFR-AI-07) |
| 검증 V-1~V-9 | 서버 | 그대로, 공급자와 무관하게 동일(공급자별 위험은 C-10.4) |
| 오류 | 일시적/입력/시간 초과 | F-AI-08 7원인 + 신규 `error_code`, 사용자 키·한도 원인과 시스템 원인 분리(C-11) |
| 무료 등급 | — | AI-02·AI-06·AI-12 순차 실행 + 백오프, 성능 목표 2배(C-12) |
| 사용량 | `usage_events` 차감 원장 | **사용량 미터 기록**(호출·시도 단위 토큰, 가격표 버전, 예상 비용)(C-13) |
| 7장 | 운영자 비용 시나리오 | 호출당 토큰 추정, 사용자 기능별 예상 비용, 품질 목적 제한 |
| 요건 추출 | 생성 직후 자동 | 키가 있으면 생성 직후, 키 없이 만든 JD는 첫 AI 기능에서 선행(D-30). 키 연결 시 일괄 추출 없음 |
| 평가 | 단일 공급자 | **세 공급자 모두 평가 세트 통과가 출시 조건**(UB-3), 작업 순서 Gemini → Claude → OpenAI(D-38) |

### 0.0 v3에서 바뀐 것 (PRD v3, 데이터 모델 v3 기준)

| 영역 | v2 | v3 |
|------|----|----|
| 커리어 입력 | 폼 수동 입력만 (+ Should AI-08 서술 정리) | 폼 **또는 AI-12 프로젝트 AI 작성 대화**(Must). 정리 결과의 모든 필드는 사용자 발화로 추적(V-9), 사용자 "저장" 전에는 커리어 데이터 불변 |
| 커리어 구조 | 경력 > 프로젝트(기여 내용, 팀·배경) > 성과 | 경력 / 교육 > 프로젝트 > **상세 내용(STAR + 회고 및 배운 점, 여러 개)** > 성과(결과에 연결). `contribution`·`team_context` 폐기 |
| 근거 단위 | 프로젝트 필드 | **STAR 필드 단위**(`project_detail` › `action` 등). 회고 및 배운 점은 "본인의 회고"로만 쓰고 칩은 "회고 및 배운 점"(C-9, V-8) |
| 데이터 최소 기준 | 완료 경력 1 + 완료 프로젝트 1 | 완료 프로젝트 = 완료 상세 내용 ≥ 1, 교육 소속 프로젝트도 셈, 교육만으론 미충족 |
| AI-08 | 기여 내용 정리 제안 | 폼 STAR 필드 하나 다듬기(Should) |
| 지원 현황 보드 | — | AI 호출 없음. F-ST-04 팝업은 면접 유형 미리 선택만 |
| 비용 | 평균 $1.19 | (v4에서 운영자 비용 개념 폐기 — 7장은 사용자 기능별 예상 비용) |

### 0.1 v2에서 바뀐 것 (PRD v2 기준)

| 영역 | v1 | v2 |
|------|----|----|
| 기능 간 의존 | 면접 시작 시 인사이트 자동 선행, 초안·질문이 인사이트를 입력으로 사용 | **어떤 기능도 인사이트(AI-02 출력)를 필수 입력으로 쓰지 않는다.** 모든 지원 프로젝트 기능은 JD 요건(AI-01) + 경력 팩만으로 동작하고, 인사이트가 있으면 참고 입력으로만 쓴다(F-AP-03) |
| 인사이트 시작 | 요건 확인 후 / 면접 시작 시 자동 | 사용자가 "인사이트 생성"을 눌러야 시작(D-18) |
| 자기소개서 | 문항 입력 → 초안 | 기본 3문항(지원 동기 / 직무 역량 / 입사 후 포부 및 성장 계획) 시드, 문항별 **근거 경력·프로젝트 선택 → 표시 → 사용자 변경 후 재생성**, 문항 메모 입력(F-DOC-02, 08, 09) |
| 경력기술서 기본 선택 | 인사이트 우선순위 | 인사이트가 없으면 **AI-11 관련도 정렬**(가벼운 호출)로 기본 선택 |
| 면접 형식 | 턴 방식, 혼합 유형, 꼬리 질문 | **일괄 방식**: 유형(직무 / 컬처핏) 선택 → 질문 전체 생성 → 답변 전체 작성 → 1회 제출 → 일괄 채점. 꼬리 질문(AI-10) `[보류]` |
| 면접 결과 | 4항목 등급, 총점 없음 | **질문별 점수 + 세션 점수 자리**(산식은 D-14, 사용자 정의 대기). 4항목 루브릭은 참고 평가 기준으로 유지 |
| 데이터 부족 | 모든 기능 D-01 게이트 | 인사이트·서류·직무 면접은 D-01, **컬처핏 면접은 JD만으로 가능**(F-P3-13, D-15) |
| 사용량·비용 | 기능별 추정 | D-17 단위로 재계산. 평균 사용자 약 **$1.2**(상한 $2 이내), 한도 최대 사용 약 $3.8 |

### 0.2 기능 목록 (모델은 등급, 비용은 Claude 매핑 기준 사용자 부담 예상치 — 7장)

| AI ID | 기능 | PRD 기능 | 우선순위 | 처리 방식 | 모델 | 응답 모드 | 1회 비용(일반) |
|-------|------|----------|----------|-----------|------|-----------|----------------|
| AI-01 | JD 요건 추출 | F-AP-01, F-P2-01, F-P2-02 | Must | 단일 호출 | 경량 등급 | 동기 | 약 $0.002 |
| AI-02 | 인사이트 생성 | F-P2-04, F-P2-05, F-P2-09 (F-P2-03, F-P2-07) | Must | 2단계 체인 (요건 매칭 → 종합) | 기본 등급 | 비동기 작업 | 약 $0.13 |
| AI-03 | 경력기술서 초안 | F-DOC-01, F-DOC-03, F-DOC-04 | Must | 단일 호출 + 서버 검증 | 기본 등급 | 스트리밍 (블록 단위) | 약 $0.07 |
| AI-11 | 경력기술서 기본 선택 (관련도 정렬) | F-DOC-01 | Must | 단일 호출 (인사이트가 있으면 호출 없음) | 경량 등급 | 동기 | 약 $0.002 |
| AI-04 | 자기소개서 문항별 초안 (근거 선택 포함) | F-DOC-02, F-DOC-03, F-DOC-04, F-DOC-08, F-DOC-09 | Must | 문항별 1회 호출 (선택 → 본문 2단 출력) + 글자 수 보정 최대 1회 | 기본 등급 | 스트리밍 (선택 카드 → 문단) | 문항당 약 $0.045 |
| AI-05 | 면접 질문 일괄 생성 (유형별) | F-P3-01, F-P3-02, F-P3-13 | Must | 단일 호출 | 기본 등급 | 비동기 작업 (질문이 저장되는 대로 목록에 채움) | 약 $0.05 |
| AI-06 | 답변별 평가 (점수 자리 포함) | F-P3-06 | Must | 응답된 답변별 병렬 호출 | 기본 등급 | 비동기 작업 (제출 1회 = 작업 1개, AI-07과 묶음) | 답변당 약 $0.036 |
| AI-07 | 세션 종합 피드백 (세션 점수 자리 포함) | F-P3-06, F-P3-07 | Must | 단일 호출 (AI-06 결과 입력) | 기본 등급 | 위와 같은 비동기 작업 | 약 $0.045 |
| **AI-12** | **프로젝트 AI 작성 대화 (v3)** | F-P1-13 | **Must** | 턴마다 정리(추출) + 응답 병렬, 서버 발화 추적 검증 | 정리 경량 등급 / 응답 기본 등급 | 스트리밍 대화 턴 | 대화당 약 $0.11 (상한 $0.19) |
| AI-08 | STAR 필드 다듬기 (v3 축소) | F-P1-08 | Should | 단일 호출 | 경량 등급 | 동기 | 약 $0.001 |
| AI-09 | 커리어 채팅 | F-P2-08 | Should | 대화 (도구 없음) | 기본 등급 | 스트리밍 | 메시지당 약 $0.02 |
| AI-10 | ~~꼬리 질문~~ | F-P3-05 | `[보류]` | — | — | — | — |
| (재사용) | 초안 다시 쓰기 | F-DOC-05 | Should | AI-03/AI-04 "다시 쓰기 모드" | 기본 등급 | 스트리밍 | 블록 수에 비례 |
| (재사용) | 같은 질문 세트로 재응시 | F-P3-08 | Should | 질문 복사(AI 없음) + AI-06/07 | AI-06과 동일 | 비동기 작업 | 세션 채점 약 $0.25 |

핵심 설계 결정:
0. **(v4) 공급자 독립.** 기능 파이프라인·검증은 공급자를 모르고, 어댑터가 모델·스키마·스트리밍·사용량·오류를 정규화한다(C-10~C-13).
1. **RAG를 쓰지 않는다.** 사용자 한 명의 경력 데이터는 일반적으로 3k~15k 토큰이므로 매 호출에 전체를 넣는다(C-1). pgvector는 MVP에서 필요 없다.
2. **근거는 출력 스키마에서 강제하고 서버가 검증한다.** 서버는 참조 ID 존재, 인용문 실재, 수치 실재, (v2) 선택된 근거 범위를 기계적으로 확인하고, 실패한 항목은 화면에 내보내지 않는다(C-3).
3. **인사이트는 선택 행동이다.** 다른 기능이 인사이트에서 얻던 정보(관련도 순서, 보완점)는 각 기능이 JD 요건과 경력 팩에서 직접 판단한다. 인사이트가 있으면 같은 판단의 참고 신호로만 쓴다.
4. **면접 점수의 산식은 정하지 않는다(D-14).** 출력·저장 구조에 질문별·세션 점수 자리를 두고, 루브릭 등급은 참고 평가로 계속 생성한다. 산식이 정해지면 저장된 등급으로 과거 세션도 AI 재호출 없이 채점할 수 있게 한다(D-AI-07).

---

## 1. 공통 설계

### C-1. 사용자 컨텍스트 팩 (Career Context Pack)

모든 P2/P3/DOC 기능은 같은 방식으로 경력 데이터를 조립해 넣는다. 조립은 서버에서 결정적으로 한다(같은 데이터 → 같은 바이트열). 프롬프트 캐시를 쓸 수 있고 해시를 계산할 수 있도록 하기 위해서다.

**구성 순서와 포함 필드 (v3: 경력/교육 > 프로젝트 > 상세 내용)**

| 블록 | 원천 entity.field | 필수 | 크기 추정 (토큰) | 비고 |
|------|-------------------|------|-------------------|------|
| 프로필 | `profiles.desired_job_title`, `profiles.total_years_of_experience`, `profiles.interested_industries` | desired_job_title·total_years_of_experience 필수 | 50~100 | `profiles.display_name`은 **보내지 않는다** |
| 경력 (`EXP-n`) | `experiences.id`, `company_name`, `start_month`, `end_month`(팩에는 년-월), `is_current`, `job_rank`, `job_position`, `department`, `employment_type`, `summary` | id·company_name·start_month·(job_rank 또는 job_position) | 경력당 100~300 | 최근순. "직급 / 직책"을 한 줄로 합쳐 표시 |
| 교육 (`EDU-n`) | `educations.id`, `institution_name`, `education_type`(degree/course), `program_name`, `start_month`, `end_month`, `enrollment_status`(enrolled/graduated/completed/dropped_out/on_leave), `description` | id·institution_name·education_type·start_month | 교육당 50~150 | 경력 블록 다음. 교육 아래 프로젝트를 중첩 |
| 프로젝트 (`PRJ-n`) | `projects.id`, `experience_id` / `education_id`(둘 중 하나 또는 없음), `name`, `start_month`, `end_month`, `role`, `team_size`, `summary`(한 줄 요약) | id·name·role | 프로젝트당 50~150 (본문은 상세 내용으로 이동) | 소속 경력/교육 아래 중첩. 독립 프로젝트는 "기타 프로젝트" 그룹. v2의 `contribution`·`team_context`는 폐기 |
| 상세 내용 (`DET-n`) | `project_details.id`, `project_id`, `title`, `situation`(S), `task`(T), `action`(A), `result`(R 서술), `learnings`(회고 및 배운 점), `sort_order` | id·title·situation·action | 상세 내용당 300~700 | 프로젝트 아래 여러 개(D-23). **`learnings`는 `<reflection>` 태그로 감싸 "본인의 회고"임을 표시**(C-9) |
| 성과 (`ACH-n`) | `achievements.id`, `project_detail_id` / `experience_id`(둘 중 하나), `kind`, `metric_name`, `value_before`, `value_after`, `unit`, `description` | id·kind | 성과당 50~150 | 상세 내용의 결과(R) 아래 또는 경력 아래(경력 단위 성과, D-24 (b)) |
| 스킬 (`SKL-n`) | `skills.id`, `skills.name`, `skills.is_manual`, `project_skills(project_id, skill_id)` | name | 전체 50~300 | 프로젝트 블록 안에 태그로, 직접 추가 스킬은 별도 목록 |

- **`status = 'complete'` 행만 넣는다**: `experiences`, `educations`, `projects`, `project_details`, `achievements`는 `status = 'draft' | 'complete'`를 가진다. 팩에는 `complete` 행만 넣고, `draft` 부모(경력·교육·프로젝트·상세 내용)에 속한 자식은 `complete`여도 함께 제외한다(데이터 모델 v2 확정 — v1.1 확인 1). 완료 항목이 `draft`로 돌아가면 다음 조립부터 빠지고 기존 결과의 해당 근거는 "변경됨"으로 표시된다.
- **완료 판정 (v3, PRD F-P1-03·F-P1-15)**: 상세 내용 `complete` = 제목 + 상황 + 행동 / 프로젝트 `complete` = 이름 + 역할 + `complete` 상세 내용 1개 이상. 판정은 서버가 저장 때마다 한다.
- 데이터 최소 기준 게이트와 `career_snapshot_hash`도 `complete` 행 기준으로 계산한다. 저장 전 AI 작성 대화의 정리 결과(AI-12)는 커리어 데이터가 아니므로 팩에 들어가지 않는다.
- 일반 사용자(경력 2~3건, 교육 1건, 프로젝트 5~8건, 상세 내용 8~12건, 성과 10~15건) 기준 **약 7k 토큰**(v2 6k → STAR 구조로 소폭 증가), 범위 3k~18k `[가정]` (한국어 1자 ≈ 0.7~1.0 토큰, 구현 시 token counting으로 재측정).
- **짧은 별칭(alias)**: `EXP-1`, `EDU-1`, `PRJ-3`, `DET-5`, `ACH-7`, `SKL-2`. 모델은 별칭으로만 참조하고 서버가 저장 시 UUID로 바꾼다. 매핑은 호출 단위. **별칭은 참조 필드에만 쓰고, 사용자에게 보이는 문장에는 쓰지 않는다**(C-3 "저장 키와 표시 문장").
- **`career_snapshot_hash`**: F-P2-07 "데이터 변경됨" 판정과 동일 입력 재사용에 쓴다. (v4.3, 구현 반영) **팩 텍스트가 아니라 팩에 포함된 행의 내용 필드(정규화한 JSON)로 계산한다.** 팩 텍스트에는 재직 중 경력의 기간·연차처럼 기준 월마다 바뀌는 계산값이 있어서, 텍스트를 해시하면 데이터를 고치지 않아도 매달 "데이터 변경됨"이 뜨고 재사용이 깨지기 때문이다. AI-11의 요약 팩도 같은 포함 규칙·별칭·해시를 쓴다.
- **데이터 최소 기준 게이트 (F-AP-06, D-01, D-15, 사용자 결정 U-5)**: 서버가 규칙으로 판정하고, 미달이면 **그 기능의 AI는 호출하지 않는다**. 대신 **AI-12 AI 작성 대화를 "게이트 진입" 컨텍스트로 열어 부족한 커리어 데이터를 채우게 하고, 저장 후 원래 기능으로 돌려보낸다**(U-5). AI 결과는 여전히 근거 데이터가 있어야 생성된다. 폼 직접 입력 바로가기도 함께 보인다. (v4) **키가 없으면 AI 기능 자체가 잠겨(F-AI-06) 게이트에 도달하지 않는다.** 대화를 시작할 수 없으면(키 무효 등) 폼 입력으로 안내한다(PRD 3.3).

  | 기능 | 기준 | 미달 시 |
  |------|------|---------|
  | AI-01 요건 추출 | JD 텍스트만 | 해당 없음 (지원 프로젝트 생성에 커리어 데이터 불필요) |
  | AI-02 인사이트, AI-03/AI-11 경력기술서, AI-04 자기소개서, AI-05 직무 면접 | D-01 (v3): `complete` 경력 1건 + `complete` 프로젝트 1건(= `complete` 상세 내용 1개 이상, 경력·교육·독립 어디 소속이든 셈). 교육만으로는 미충족 | 그 기능은 미실행 + `insufficient_data` → `get_data_readiness()`의 `next_action`에 따라 **AI-12 게이트 진입**(`suggested_mode`, `writing_chats.return_target`) 또는 폼(`next_action = form`: `complete_experience` 부족 시 경력 폼, (v4.3, A18) `hints`에 `project_fields`가 있으면 `suggested_project_id`의 프로젝트 폼 S-10 — 상세 내용은 있는데 이름·역할이 빠진 draft 프로젝트). 저장 후 준비도를 다시 계산해 충족되면 원래 기능 화면으로 복귀(실행은 사용자가 다시 누름 — 사용자 토큰이 쓰이므로 자동 실행하지 않음). 대화를 시작할 수 없으면(키 무효 등) 폼 직접 입력으로 안내 |
  | AI-12 AI 작성 대화, AI-08 필드 다듬기 | 없음 (커리어 데이터를 만드는 기능) | 해당 없음 |
  | AI-05 컬처핏 면접 | JD만 필수(`[가정]` 유지, U-5). 프로필·경력 데이터가 있으면 사용 | 차단하지 않음. `data_sufficiency`(아래)로 질문 구성과 안내를 바꾼다 |

- **`data_sufficiency` 수준 (서버 계산)**: `ok` = D-01 충족 / `thin` = D-01 미달이지만 프로필 또는 `complete` 경력·교육·상세 내용이 있음 / `none` = 커리어 데이터 없음(JD만). 컬처핏 면접(4장)과 각 결과의 보완 안내 배너에 쓴다.
- **데이터는 있으나 빈약한 경우**: 호출은 진행한다. 결과는 "근거 없음" 판정과 자리 표시가 많아지는 방향으로 자연스럽게 나오며, 출력의 `data_sufficiency` 필드(AI-02, AI-05)로 화면에 보완 안내를 띄운다.

### C-2. JD 컨텍스트 (문장 ID)

- JD 원문(`job_descriptions.raw_text`)은 저장 시 서버가 **결정적 규칙으로 문장/줄 단위로 분할**해 `S1`, `S2`… ID를 붙인다(`job_descriptions.sentences` jsonb: `[{sid, text, start, end}]` 제안). 줄바꿈·불릿·마침표 기준. LLM에게 분할을 맡기지 않는다.
- 모든 JD 근거는 문장 ID(`S12`)로 참조한다. 서버가 ID 존재를 확인할 수 있고, 화면은 `start/end` 오프셋으로 원문을 하이라이트한다.
- AI-01 이후 단계는 원문 대신 **구조화된 요건 목록**(`jd_requirements`, 별칭 `REQ-1`…)을 넣는다. 인사이트 단계 1(요건 매칭)만 요건 목록과 원문 문장을 함께 넣는다.
- JD 원문 크기: 일반 1.5k~3k 토큰, 상한 8k 토큰 `[가정]`. 상한을 넘는 JD(복수 포지션 공고 등)는 등록 시 경고하고, 그대로 진행하면 비용이 늘어난다. 자르지 않는다.

### C-3. 근거 형식과 서버 검증 (모든 기능 공통)

**모델이 출력하는 근거 객체**

```json
{ "source_type": "project_detail", "ref": "DET-5", "field": "action", "quote": "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다" }
```

| source_type | ref 형식 | field 허용값 | quote |
|-------------|----------|--------------|-------|
| `profile` | `PROFILE` | `desired_job_title`, `total_years_of_experience`, `interested_industries` | 선택 |
| `experience` | `EXP-n` | `job_rank`, `job_position`, `department`, `summary`, `period` | `summary`이면 필수 |
| `education` | `EDU-n` | `institution_name`, `program_name`, `education_type`, `enrollment_status`, `period`, `description` | `description`이면 필수 |
| `project` | `PRJ-n` | `name`, `role`, `team_size`, `summary`, `period` | `summary`이면 필수 |
| `project_detail` | `DET-n` | `title`, `situation`, `task`, `action`, `result`, `learnings` | `situation`/`task`/`action`/`result`/`learnings`이면 필수. **`learnings`는 회고 근거(C-9)** |
| `achievement` | `ACH-n` | `metric`, `description` | `description`이면 필수 (v3: 상세 내용 결과 또는 경력에 연결) |
| `skill` | `SKL-n` | `name` | 없음 |
| `jd_sentence` | `Sn` | — | 선택 (원문 문장 자체가 근거) |
| `jd_requirement` | `REQ-n` | — | 없음 |
| `interview_answer` | `ANS-n` | — | 필수 (면접 답변 인용) |
| `user_note` | `NOTE-n` | — | 필수 (자소서 문항 메모, F-DOC-09) |
| `writing_chat_message` | `M-n` | — | 필수. **AI-12 전용**(정리 결과 필드의 출처 사용자 발화). `evidence_links.source_type`에는 넣지 않고 `writing_chats.structured_draft`에만 저장한다(데이터 모델 v3). 지원 프로젝트 기능에서는 쓰지 않는다 |

**서버 검증 규칙 (모델 출력 직후, 저장 전)**

| # | 검증 | 실패 시 처리 |
|---|------|--------------|
| V-1 | `ref`가 이번 호출의 입력 팩에 존재 | 해당 근거 제거 |
| V-2 | `field`가 source_type의 허용값 | 해당 근거 제거 |
| V-3 | `quote`가 해당 원문 필드의 부분 문자열 (공백·문장부호 정규화 후 비교) | 근거 제거. 부분 일치(70% 이상 `[가정]`)면 원문의 가장 가까운 구간으로 교체하고 `quote_adjusted: true` |
| V-4 | 근거가 **0개**가 된 판단 항목 (강점, 충족/부분 충족 판정, 지원 방향, 초안 블록, 피드백 항목). (v4.3, A10 — 확정 2026-11-05 (사용자)) **프로필의 희망 정보(`profile.desired_job_title`, `profile.interested_industries`)는 경력 사실 근거로 세지 않는다.** 판정·강점·포지셔닝의 근거가 될 수 없고 문맥 참고만 한다. 희망 정보 근거만 남은 판단 항목은 근거 0개로 본다(`profile.total_years_of_experience`는 연차 판정의 사실 근거로 유지) | 항목을 출력하지 않는다(NFR-AI-01). 충족/부분 충족 판정은 `no_evidence`로 강등. 초안 블록은 "근거 확인 필요" 배지로 표시 (초안은 문장 구조상 블록 삭제가 어색하므로) |
| V-5 | **수치 가드**: 생성 텍스트(초안, 지원 방향, 개선 답변 예시, 질문 문장)에 나온 숫자(%, 배, 명, 원, 건, 기간 등)가 입력 팩·JD·답변 중 어딘가에 같은 값으로 존재 (v3: `learnings`에만 있는 숫자는 사실 수치로 인정하지 않는다) | 기본: 존재하지 않으면 해당 블록을 1회 재생성 요청. 그래도 실패하면 해당 숫자를 `[수치 확인 필요]`로 치환하고 표시. 연차·기간처럼 입력 날짜에서 계산되는 값은 서버가 계산 가능한 값 목록을 미리 만들어 허용. **기능별 예외(v4.3)는 아래 "V-5 비교 규칙과 예외"** |
| V-8 | **(v3) 회고 근거 제한 (NFR-AI-06)**: `field = learnings` 근거는 C-9의 허용 용도에서만 유효하고, 판단 항목의 유일한 근거가 될 수 없다 | 허용 용도 밖이면 제거. 남은 사실 근거가 0개면 V-4 처리 |
| V-6 | 스키마 일치 (structured output 사용으로 대부분 보장) | 1회 재시도 → 실패 시 작업 실패 처리 (C-6) |
| V-7 | **근거 범위**: 근거 선택이 있는 생성(AI-03의 포함 항목, AI-04의 "사용한 경력·프로젝트")에서 본문 근거가 **선택된 경력·교육·프로젝트와 그 하위 상세 내용(AI-04에서 `detail_refs`가 있으면 그 상세 내용만)·성과·스킬**, 프로필, JD, 문항 메모 안에 있음 | 범위 밖 근거 제거. 근거가 0개가 된 블록은 V-4와 같이 `evidence_check_needed` |

- 검증 통계(항목 수, 제거된 근거 수, 강등 수, 수치 가드 위반 수)는 결과와 함께 `validation_report`로 저장한다. 7장 "근거 없는 주장 비율" 운영 지표의 원천이다. 원문은 들어가지 않는다.

**V-5 비교 규칙과 예외 (v4.3, 구현 반영)**

- 비교 규칙
  - 숫자 값만 비교한다. 단위는 무시하고 쉼표는 지운다.
  - `천`·`만`·`억`·`조`는 곱한 값으로 비교한다. 원천 쪽은 곱한 값과 맨 숫자를 모두 허용한다.
  - 수치로 보지 않는 것: 별칭(`PRJ-3`, `S12` 등), 영문자에 붙은 숫자(`EC2`, `B2B`, `K8s`, `3D`).
  - 서버 계산 허용값: 기간의 개월 수·연 수·나머지 개월, "N년차"(연 수 + 1).
  - 원천 두 값에서 계산되는 값(예: 1.2초 → 0.7초의 "41%")은 허용하지 않는다.
- 기능별 처리
  - 기본(AI-02 단계 2, AI-06 개선 답변 예시): 1회 재생성 → 그래도 위반이면 치환.
  - AI-02 단계 1의 `rationale`·`missing_aspect`: 재생성 없이 바로 치환(화면에 보이는 생성 문장).
  - **스트리밍 서류(AI-03, AI-04)**: 재생성하지 않는다. 함수 60초 안에 블록 재생성 호출을 넣을 여유가 없어서다. 위반 숫자는 `[수치 확인 필요]`로 바꾸고 블록 `flags`에 `number_check_needed`를 단다. AI-04는 글자 수 보정 호출이 생길 때만 그 호출에 "확인되지 않는 숫자를 빼거나 `[수치 입력 필요]`로" 지시를 함께 넣는다.
  - **면접 질문(AI-05)**: 질문 문장은 치환하지 않는다(`[수치 확인 필요]`가 든 질문은 면접 질문으로 쓸 수 없다). 그 질문을 버리고 남은 개수 재생성에 위반 숫자를 알린다. `intent`·`good_answer_signals`는 치환한다.
  - **AI-06 재생성 최종 실패**: 재생성 호출이 실패하면(키·한도 원인 제외) 답변을 `not_scored`로 두지 않고 첫 평가 결과를 치환해서 저장한다.

**저장 키와 표시 문장 (v4.3, 구현 반영)**

- **별칭 참조 필드는 UUID 키로 이름을 바꿔 저장한다.** 결과 jsonb에서 `requirement_ref` → `requirement_id`, `requirement_refs` → `requirement_ids`, `project_priorities[].ref` → `project_id`, `question_ref` → `question_id`, `question_refs` → `question_ids`, `target_requirement_refs` → `target_requirement_ids`, `weak_requirement_refs` → `weak_requirement_ids`. 모델 출력 형식(이 문서의 스키마 예시)은 별칭 이름 그대로다.
- **저장·표시 문장에 별칭을 남기지 않는다.** 별칭 번호는 호출마다 바뀌고 사용자에게 의미가 없다. 프롬프트로 별칭을 문장에 쓰지 않게 지시하고, 서버가 저장 전에 남은 별칭을 표시 이름으로 바꾼다.

  | 별칭 | 바꾸는 표시 이름 |
  |------|------------------|
  | `PRJ-n` / `DET-n` | 프로젝트명 / 상세 내용 제목 (`'…'`로 감싸고 40자까지) |
  | `REQ-n` / `Sn` | 요건 내용 / 공고 문장 (`'…'`, 40자까지) |
  | `SKL-n` | 스킬 이름 |
  | `PROFILE` | "프로필" |
  | `Q-n` | "n번 질문" |
  | 그 밖·모르는 별칭 | 지운다 |

  - 사용자 데이터에 같은 글자가 원래 있으면(예: "AWS S3", 티켓 번호 "REQ-1") 바꾸지 않는다.
  - 대상: 저장되는 모든 생성 문장(AI-02 이유·강점·보완점·대응 방안·포지셔닝·우선순위 이유, AI-03·AI-04 블록, AI-11 이유, AI-05 질문·의도, AI-06·AI-07 문장)과 생성 직후에만 보이는 안내(`notes_for_user`).

**근거 저장 방식 (데이터 모델 v1 기준 확정)**

- **근거는 `evidence_links` 테이블에만 저장한다. 결과 jsonb(`insights.result`, `draft_sections.ai_content`, `answer_evaluations.result`, `session_feedbacks.result`)에는 `evidence` 배열을 저장하지 않는다.** v1 초안의 "근거는 결과 jsonb에도 들어간다"는 철회한다.
- 저장 직전 서버가 검증(V-1~V-5)을 마친 출력에서 `evidence` 배열을 떼어 내고, 각 근거를 `evidence_links` 행으로 넣는다. 결과 jsonb의 각 항목에는 `item_key`만 남긴다(초안은 블록의 `block_id`, 그 밖의 항목은 서버가 부여하는 경로형 키 — 예: `requirement_matches.REQ-uuid`, `strengths.0`).
- 이 문서의 출력 스키마 예시에 나오는 `evidence` 배열, `ref`(별칭), `field` 키는 **모델 출력 형식**이다. 모델 출력 키는 그대로 두고 저장 시 다음과 같이 매핑한다.

  | 모델 출력 | `evidence_links` 컬럼 |
  |-----------|------------------------|
  | (결과 테이블명) | `owner_type` (`insight`, `draft_section`, `interview_question`, `answer_evaluation`, `session_feedback`, `chat_message`; 자소서 근거 선택 이유는 `draft_section`의 `item_key = sources.{n}`). AI-12 정리 결과의 출처 발화는 `evidence_links`가 아니라 대화 정리 결과 안에 둔다(AI-12 저장 참고) |
  | (결과 행 ID) | `owner_id` |
  | 항목 위치 / `block_id` | `item_key` |
  | `source_type` | `source_type` (값 이름 동일. 면접 답변은 `interview_answer`) |
  | `ref` (별칭) | `source_id` (서버가 UUID로 변환) |
  | `field` | `source_field` (v3 값 추가: `situation`, `task`, `action`, `result`, `learnings` 등 — 모델 출력 키 `field`는 그대로 두고 저장 시 매핑) |
  | `quote` | `quote` |
  | — | `source_snapshot_at`(생성 시점), `source_deleted_at`, `source_locator`(JD 문장 오프셋 등), `source_label` — 서버가 채움 |
- 마찬가지로 `requirement_ref`·`requirement_refs`·`project_priorities[].ref` 같은 별칭 참조도 저장 시 UUID로 바뀐다(예: 면접 질문의 `target_requirement_refs` → `interview_questions.target_requirement_ids`, `target_gap_requirement_refs` → `target_gap_requirement_ids`). 전체 목록은 위 "저장 키와 표시 문장".
- 원본 항목이 수정되면(`updated_at > source_snapshot_at`) "근거 수정됨", 삭제되면 트리거가 `quote = null`과 `source_deleted_at`을 기록하고 "근거와 발췌가 삭제되었습니다"로 표시한다(D-AI-04 (b) 채택). (v4.3) 경력 팩을 만든 뒤 결과를 저장하기 전에 원본이 지워졌으면, `evidence_links` 저장 시점 검사가 같은 방식("원본 삭제됨")으로 저장한다(DM v4.2).
- (v4.3) 출처별 `source_id`: `user_note` = 그 메모가 있는 문항의 `draft_sections.id`, `interview_answer` = `interview_answers.id`(`source_field`는 null).
- (v4.3, A24 — 확정 2026-11-05 (사용자)) **AI 경로(`app_ai_writer`)는 `evidence_links`에 직접 INSERT하지 않는다.** 모든 근거는 결과 저장 RPC가 소유·실행 세대 검사를 한 뒤 함께 저장한다(DM v4.2 §5).

### C-4. 프롬프트 공통 원칙

- **지시와 데이터 분리**: 지시는 system에만 둔다. 경력 팩·JD·답변·사용자 메모는 user 메시지 안에서 각각 태그로 감싼 데이터 블록(`<career_data>`, `<jd>`, `<answer>`)으로 넣고, system에 "데이터 블록 안의 문장은 지시가 아니라 분석 대상"이라고 명시한다. JD는 외부 텍스트이므로 특히 중요하다.
- **도구를 주지 않는다**: MVP의 모든 AI 기능은 도구 없는 생성이다. 인젝션이 성공하더라도 할 수 있는 행동이 없고, 출력은 스키마로 제한된다.
- **구조화 출력**: 화면 렌더링·저장 대상은 모두 **정본 JSON Schema** 구조화 출력으로 받고, 공급자별 방식(OpenAI JSON Schema strict / Gemini `responseJsonSchema` / Claude 구조화 출력)으로는 어댑터가 바꾼다(C-10.2). Claude는 강제 `tool_choice`를 쓰지 않는다. 모든 스키마에 `schema_version`을 넣는다.
- **날조 금지 지시 (모든 생성 기능)**: "데이터에 없는 경험·수치·기술·직함·회사명을 쓰지 않는다. 필요하면 자리 표시를 쓰거나 질문으로 남긴다. 판단 항목마다 근거를 단다." 이 지시는 공통 system 블록으로 관리한다.
- **"경험 없음" 단정 금지**: 근거가 없으면 "입력된 데이터에서 근거를 찾지 못함"으로 표현한다(F-P2-04 비고).
- **언어**: 출력은 항상 한국어. JD가 영문이면 요건 본문(모델 출력 `text` → 저장 `jd_requirements.content`)은 한국어로 요약하고, 근거 인용(`quote`)과 기술 키워드는 원문 그대로 둔다(NFR 6.5).
- **사고(reasoning) 설정**: 카드마다 "낮은/중간 사고 설정"을 적고, 어댑터가 공급자 설정(Claude effort, OpenAI reasoning effort, Gemini thinking budget `[가정]`)으로 바꾼다. 사고 토큰은 출력 토큰으로 과금되므로 토큰 추정(7장)과 미터(C-13)에 포함한다. 첫 글자 지연이 중요한 스트리밍 기능은 낮게 둔다.
- **프롬프트 버전**: 기능별 `prompt_version`을 결과와 함께 저장한다. 품질 회귀 추적과 동일 입력 재사용 판정에 쓴다. (v4.3, 구현 반영) 표기는 `ai-{기능번호}.{호출}.v{n}+common.v{n}`이다(예: `ai-01.extract.v1+common.v1`, `ai-12.reply.v2+common.v1`). 공통 system 블록 버전이 접미사로 붙어, 공통 문구가 바뀌면 모든 기능의 버전이 함께 바뀐다. 호출이 여러 개인 결과는 호출 버전을 이어 붙여 저장한다(예: AI-02 `ai-02.match.v2+ai-02.synthesize.v2+common.v1`). 공급자별 변형이 생기면 공급자 접미사를 더한다(C-10.4).
- **few-shot**: 형식 예시는 스키마로 대체한다. 판단 기준이 미묘한 기능(AI-02 판정 경계, AI-06 등급 기준)에만 짧은 경계 사례 2~3개를 넣는다. 예시는 가상 인물 데이터만 쓴다.

### C-5. 자리 표시 (Placeholder) 규칙

초안(AI-03, AI-04)과 개선 답변 예시(AI-06)에서 데이터에 없는 정보가 필요한 자리에 쓴다.

| 토큰 | 용도 |
|------|------|
| `[수치 입력 필요]` | 성과 수치·규모가 필요한데 데이터에 없을 때 |
| `[기간 입력 필요]` | 기간·날짜가 필요한데 없을 때 |
| `[내용 확인 필요]` | 사실 관계(역할 범위, 사용 기술 등)를 사용자가 확인해야 할 때 |
| `[지원 동기 입력 필요]` | 회사·직무를 고른 개인적 이유 등 데이터로 알 수 없는 내용 (자소서 지원 동기) |
| `[계획 입력 필요]` | (v2) 입사 후 목표·학습 계획 등 사용자만 아는 계획 (자소서 입사 후 포부) |
| `[사례 입력 필요]` | (v2) 개선 답변 예시에 구체 사례가 필요한데 답변·데이터 어디에도 없을 때 (특히 데이터가 적은 컬처핏 면접) |

- 토큰은 위 6종으로 고정한다(UX 강조 표시·복사 전 경고 대상). 본문 안에 토큰을 그대로 두고, 같은 블록의 `placeholders` 배열에 `{token, hint}`를 함께 출력한다. `hint`는 "개선 전후 응답 시간(예: ms)"처럼 무엇을 넣으면 되는지 알려 준다.
- 서버는 본문의 토큰 수와 `placeholders` 배열 길이가 맞는지 확인한다. 화면은 토큰을 강조 표시하고, 복사 전에 "자리 표시 N개가 남아 있습니다" 경고를 띄운다(ux-planner 요청).
- (v4.3, 구현 반영) **목록에 없는 토큰**: 모델이 6종 밖의 `[… 필요]` 모양 토큰(예: `[회사명 입력 필요]`)을 쓰면 서버가 `[내용 확인 필요]`로 바꾸고 `validation_report.unknown_placeholders`로 센다. `placeholders` 배열은 본문 순서대로 서버가 다시 만들고, 개수 불일치는 `placeholder_mismatches`로 센다.

### C-6. 응답 모드와 실행 구조 (Vercel 서버리스 대응)

| 모드 | 언제 | 구조 |
|------|------|------|
| **동기** | p90 15초 이하 단일 호출 (AI-01, AI-11, AI-08). 지원 현황 보드 이동과 F-ST-04 팝업은 **AI를 호출하지 않는다** | Route Handler가 호출하고 결과를 바로 반환. 서버 타임아웃 30초 `[가정]`. 동기 호출도 `ai_jobs`에 기록한다(사용량·재사용·실패 추적) |
| **스트리밍** | 사용자가 생성 과정을 지켜보는 긴 텍스트·대화 (AI-03, AI-04, AI-09, AI-12) | Route Handler가 모델 스트림을 받아 SSE로 전달. 구조화 출력 JSON을 서버에서 증분 파싱해 **블록 완료 이벤트**(`block_started`, `block_delta`, `block_completed`, `validated`, `done`, `error`)로 바꿔 보낸다. 검증(C-3)은 블록 완료 시와 전체 완료 시 실행 |
| **비동기 작업** | 여러 단계·병렬 호출로 30초를 넘을 수 있는 작업, 또는 사용자가 기다리지 않고 나갈 수 있어야 하는 작업 (AI-02, AI-05, AI-06/07) | `ai_jobs` 행 생성(`job_type`, `target_type` + `target_id`, `application_project_id`) → 즉시 `job_id` 반환 → 서버가 단계별로 실행하며 `ai_jobs.status`(queued/running/succeeded/failed/canceled), `progress`(`{stage, done, total}`, 예: `{stage: "match", done: 2, total: 3}`), `attempt_count` 갱신 → 클라이언트는 Supabase Realtime 구독 또는 2초 폴링 |

- **실행 인프라** D-AI-01 (확정, 8장): (a) Next.js `after()` + Vercel 함수 최대 실행 시간 연장(Fluid compute 기준 수 분 `[가정]`, 플랜·설정 확인 필요), 단계마다 별도 호출로 이어 실행 (b) 내구성 있는 큐/워크플로 서비스(예: Vercel Queues, Inngest 등) (c) Supabase Edge Functions. **권고: (a)로 시작**하고, `ai_jobs`에 `heartbeat_at`을 두어 멈춘 작업을 감지·재시도한다. 실패율이 1%를 넘으면 (b)로 옮긴다. 어떤 방식이든 **한 번의 함수 실행이 60초를 넘지 않도록** 단계를 쪼갠다.
- **실패 처리 (공통)**: 공급자 오류는 C-11로 분류하고 재시도 가능한 원인(1·6)만 C-11.3 규칙으로 자동 재시도한다. 스키마 불일치·시간 초과는 1회 재시도. 실패 시 `failed` 상태와 원인별 안내·"다시 시도" 버튼. 비동기 작업은 완료된 단계 결과를 보존하고(`ai_jobs.step_outputs`) 실패한 단계부터 다시 실행한다(다시 시도 때 활성 공급자·등급이 작업에 기록된 것과 다르면 보존 결과를 버리고 처음 단계부터, C-11.4). (v4) 다시 시도도 사용자 토큰을 쓴다. 다시 시도의 공급자는 누른 시점의 활성 공급자다(C-11.4, A1 변경).
- **(v4.3) 요청 범위 작업과 일반 재시도**: 동기·스트리밍 작업(AI-01 요건 추출, AI-11·AI-03·AI-04 서류 3종, Should인 AI-08·AI-09)은 요청 하나 안에서 끝나는 작업이라 일반 재시도 경로(실패한 작업 행을 다시 큐에 넣기)에서 뺀다. 이 작업들의 "다시 시도"는 같은 생성 요청을 다시 보내는 것이고 새 작업 행이 생긴다(현재 활성 공급자, C-11.4 경우 ②). 비동기 작업(AI-02, AI-05, AI-06/07)만 같은 행을 다시 연다(이때도 활성 공급자, C-11.4 경우 ①).
- **(v4.3, A13 — 확정 2026-11-05 (사용자)) 경력기술서 생성 요청 안에서는 JD 요건 추출을 하지 않는다.** 함수 1회 60초 안에 추출(최대 약 20초)과 생성(완료 40~60초)을 함께 넣을 수 없어서다. 요건이 아직 없으면 화면이 추출(AI-01, 별도 동기 요청)을 먼저 끝낸 뒤 생성을 시작한다(UX FL-03·S-17). AI-04 자소서 문항 생성과 AI-11 정렬도 같은 이유로 같은 순서를 따른다 — 확정 2026-11-05 (팀)(PRD D-30, R-52). 비동기 작업(AI-02, AI-05)은 작업의 첫 단계 `prepare`에서 선행 추출을 한다 — 확정 2026-11-05 (팀)(PRD D-30, 구현과 같음). 이 추출은 그 실행의 공급자·등급으로 돈다(C-11.4).
- **동일 입력 재사용 (PRD 6.5, NFR-AI-08)**: `input_hash = hash(기능, prompt_version, provider, model, career_snapshot_hash, requirements_hash, 기능별 파라미터)`. 같은 해시의 성공 결과가 있으면 새로 호출하지 않고 기존 결과를 보여 준다(토큰 사용 없음). 사용자가 "다시 생성"을 명시적으로 누르면 새로 호출한다. 활성 공급자를 바꾸면 해시가 달라져 새로 호출된다. 재사용 범위는 같은 JD(= 같은 지원 프로젝트, D-19) 안으로 한정한다(요건 ID가 JD마다 다름). 조회 인덱스: `ai_jobs (user_id, application_project_id, job_type, input_hash) where succeeded`, `insights`/`drafts`의 `(user_id, application_project_id, input_hash) where ready`.
- **`ai_jobs.job_type` 대응**: AI-01 `jd_extraction`, AI-02 `insight`, AI-03 `career_description`, AI-11 `draft_source_ranking`, AI-04 `cover_letter`, AI-05 `interview_questions`, AI-06+AI-07 `interview_evaluation`(제출 1회 = 작업 1개), AI-08 `writing_assist`, AI-09 `chat_reply`, (v3) AI-12 `writing_chat_turn`(대화 턴 1회 = 작업 1개, `target_type = 'writing_chat'`, `application_project_id` null). `follow_up_question`은 MVP에서 제거(데이터 모델 v2).
- **(v4) 사용량**: 차감·예약 개념은 없다(D-34). 모든 공급자 호출(재시도 포함)은 C-13 형식으로 사용량 미터에 기록된다. 품질·안전 목적 제한은 7.4.
- **진행 단계 값 (`ai_jobs.progress.stage`)** (v4.3: `prepare`·`synthesize_regen`·`complete` 추가, 구현 반영):

  | 작업 | 단계 순서와 의미 | 화면 표시 메모 (문구는 UX C-03 기준) |
  |------|------------------|----------------------------------------|
  | AI-02 인사이트 | `prepare`(D-30 선행 추출 + 시작 준비, 추출이 필요 없으면 짧게 지나감) → `match`(`done/total` = 배치 수) → `synthesize` → `synthesize_regen`(V-5 위반이 있을 때만 호출, 없으면 바로 통과) → `validate` | `synthesize_regen`은 화면에서 `synthesize`와 같은 단계로 보인다 |
  | AI-11 | `rank` | — |
  | AI-03·AI-04 | `generate` → `adjust_length`(자소서 보정 시) → `validate` | — |
  | AI-05 면접 질문 | `prepare`(D-30 선행 추출 + 시작 준비, 인사이트와 같은 뜻) → `generate`(`done/total` = 저장된 질문 수) → `complete`(질문 세트 확정, 호출 없음) | `complete`는 호출 없는 마지막 단계 |
  | 채점 (AI-06+AI-07) | **`prepare`가 있다**(구현 S8 ⑫: 면접 두 작업 모두 `prepare`로 시작). 채점의 `prepare`는 시작 준비(평가할 응답 답변 확정)만 하며 **AI 호출·요건 추출이 없다**(요건은 질문 생성 때 이미 있음). → `evaluate`(`done/total` = 응답 수) → `summarize` → `score`(D-14 확정 후, 서버 계산) → `complete`(채점 마감, 호출 없음) | 채점 `prepare`는 요건 추출이 아니므로 인사이트·질문 생성의 `prepare` 문구를 쓰면 안 된다. 채점용 문구는 UX C-03에 둔다(R-51 요청). `complete`는 호출 없는 마지막 단계 |
  | AI-12 | `extract` → `reply`(턴 단위, 화면 표시는 선택) | — |

  - (v4.3, R-51) **화면 문구의 최종 권한은 UX다.** 이 표는 단계 값·순서·의미만 정하고, 단계별 화면 문구는 UX C-03 "단계 문구"를 따른다(이 문서는 문구를 따로 두지 않는다). 같은 `prepare` 값이 작업마다 뜻이 다르므로 화면은 작업 종류(`job_type`)와 단계 값을 함께 보고 문구를 고른다.

  작업 생성 즉시 첫 단계 0/N으로 표시할 수 있다.
- **`error_code` 범주** (C-11.1과 같은 값, `ai_jobs.error_category` generated 5값): `provider_limit` — `rate_limited`, `daily_quota_exhausted` / `user_account` — `billing_required`, `key_invalid`, `key_missing`, `model_not_available` / `transient` — `provider_unavailable` / `input` — `input_too_long`, `safety_blocked`, `insufficient_data`, `not_a_jd`(경고만, 진행 가능) / `system` — `schema_invalid`, `timeout`, `stalled`(heartbeat 끊김), `canceled`. 화면 F-AI-08 원인은 `failure_cause`(C-11.1). v3의 `model_unavailable`·`refused`는 각각 `model_not_available`·`safety_blocked`로 대체.
- **모델 장애 시 (v4)**: 다른 모델·다른 공급자로 **자동 대체하지 않는다**(D-28, D-31 — 사용자가 동의하지 않은 공급자·품질로 바뀌지 않게). 공급자 장애는 C-11 원인 6으로 재시도 후 안내한다. 안전 차단·거절은 원인 7.

### C-7. 개인정보·로그

- **로그 마스킹 (NFR-PRV-09, NFR-KEY-05)**: 애플리케이션 로그·에러 추적에는 `job_id`, 기능, 공급자, 모델, `prompt_version`, 토큰 수, 지연 시간, 검증 통계, `error_code`만 남긴다. 프롬프트 본문·응답 본문·**API 키**는 남기지 않는다. 공급자 오류 메시지 원문도 키·입력 일부를 담을 수 있으므로 저장하지 않고 분류 결과(C-11)만 남긴다.
- **LLM에 보내는 데이터 최소화**: 이름·연락처는 보내지 않는다(C-1). 데이터는 **사용자가 고른 활성 공급자 1곳에만** 간다(D-28). 국외 이전·학습 사용·사람 검토 고지는 공급자·등급별(F-AI-04, NFR-PRV-03·04). 활성 공급자가 무료 등급이면 민감정보 주의 안내를 더 강하게(AI-12 시작 인사 등) `[가정]`.
- **제3자 정보**: 생성 출력에 동료·고객 담당자 등 개인 이름을 쓰지 않도록 지시한다. 사용자가 입력한 회사명·프로젝트명은 사용자의 데이터이므로 그대로 쓸 수 있다.
- **민감정보**: 사용자가 자유 서술에 민감정보(건강, 종교, 노조 활동 등)를 넣은 경우, 생성 출력에 그 내용을 옮기지 않도록 지시한다. 면접 질문(AI-05, AI-10)은 채용 절차상 묻지 않는 개인 신상(나이, 결혼·출산 계획, 가족, 종교, 출신 지역, 정치 성향, 건강)을 묻지 않는다.

### C-8. 프롬프트 캐시 활용

- 프리픽스 순서: [공통 system 블록 (날조 금지·근거 규칙)] → [기능별 system 블록] → [user: 경력 팩] → [user: JD 요건] → [user: 기능별 가변 입력]. 경력 팩과 JD를 앞쪽에 두어, 같은 기능의 연속 호출(AI-04 문항 여러 개, AI-06 답변 5개 병렬, AI-02 단계 1 배치)이 캐시를 공유하게 한다.
- 병렬 호출 전 캐시 예열은 **Claude 공급자에만** 적용한다(명시적 캐시 지점). OpenAI·Gemini는 자동·암묵 캐시라 순서만 맞추고 예열 호출을 하지 않는다(C-10.3, NFR-AI-08). 무료 등급은 순차 실행이라 예열이 필요 없다.
- 캐시는 모델별로 분리되므로, 같은 작업 안에서 모델을 섞을 때는 이득이 줄어든다.

---

### C-9. 회고 및 배운 점의 사용 규칙 (v3, NFR-AI-06)

회고 및 배운 점(`project_details.learnings`)은 사용자의 해석·회고다. 사실(무엇을 했고 무엇이 나왔는가)의 근거가 아니다.

| 기능 | 허용 | 금지 |
|------|------|------|
| AI-02 인사이트 | 없음 (팩에는 포함하되 판정·강점·지원 방향의 근거로 쓰지 않음) | 충족 판정, 강점, 포지셔닝 근거 |
| AI-03 경력기술서 | 없음 | 불릿·요약에 사용 |
| AI-04 자소서 | `future_plan`·`experience_story`·`motivation` 문항에서 **회고 문장**("~을 배웠습니다", "~라고 느꼈습니다")의 근거 | 성과·역량 주장의 근거, 수치의 근거 |
| AI-05 면접 질문 | 컬처핏 `experience` 앵커 질문의 소재("~를 배웠다고 정리하셨는데, 그 뒤 실제로 바뀐 점은?") | 직무 질문의 사실 전제 |
| AI-06 평가 | 컬처핏 개선 답변 예시의 마무리 회고 문장 | 일관성 메모의 비교 기준, 개선 답변의 사실 근거 |

- **서버 검사 (V-8)**: `source_field = learnings` 근거가 허용 용도 밖이면 제거한다. 판단 항목(강점, 충족 판정, 불릿, 개선할 점 등)은 `learnings` 외의 사실 근거가 1개 이상 있어야 한다. 수치 가드(V-5)는 `learnings`에만 있는 숫자를 사실로 인정하지 않는다.
- **표현 검사**: 허용 용도라도 `learnings`를 근거로 한 문장은 회고 표현이어야 한다. 서버는 근거가 `learnings`뿐인 문장에서 단정형 성과 표현(예: "~를 달성했습니다", 수치)을 찾으면 블록에 `evidence_check_needed`를 단다 `[가정]`(규칙 기반, 평가 세트로 보정).
- **화면**: `learnings` 근거 칩 표시명은 "회고 및 배운 점"로 통일한다(사용자 결정 U-2, PRD v3.2). 문서 안의 성격 구분 용어는 "본인의 회고".
- 팩에서는 `<reflection>` 태그로 감싸 모델이 사실과 구분하게 한다(C-1).

---

### C-10. 공급자 추상화 (v4 BYOK, D-28·D-31, NFR-AI-07)

모든 AI 기능은 **활성 공급자 1개**(D-28)의 사용자 키로 실행된다. 기능 코드는 공급자를 모르고, 서버의 **공급자 어댑터 계층**이 차이를 흡수한다.

```
기능 파이프라인 (AI-01 … AI-12)
  └─ 공통 요청 형식: { tier, system_blocks[], user_blocks[], output_schema(정본 JSON Schema) | null, stream, max_output_tokens, reasoning_level }
       └─ 공급자 어댑터 (openai / gemini / anthropic)
            ├─ 모델 해석: tier → 공급자 모델 ID (아래 매핑표, 고정)
            ├─ 구조화 출력 변환: 정본 스키마 → 공급자 형식
            ├─ 스트리밍 정규화: 공급자 이벤트 → 공통 델타 이벤트
            ├─ 사용량 정규화: 공급자 usage → 공통 토큰 기록 (C-13)
            └─ 오류 정규화: 공급자 오류 → 7원인 + error_code (C-11)
  └─ 서버 검증 V-1 … V-9 (공급자와 무관, 동일 적용)
```

**C-10.1 모델 등급 매핑 (D-31: Resumate 고정, 자동 대체 없음)**

| 등급 | 용도 | OpenAI | Google Gemini | Anthropic Claude |
|------|------|--------|---------------|------------------|
| 경량 (`light`) | 짧은 추출·분류·정렬 (AI-01, AI-11, AI-08, AI-12 정리) | `gpt-6-luna` | `gemini-3.5-flash-lite` (무료 등급 있음) | `claude-haiku-5-5` |
| 기본 (`default`) | 인사이트·서류·면접·대화 응답 (AI-02~07, AI-09, AI-12 응답) | `gpt-6.1-terra` | `gemini-3.8-flash` (무료 등급 있음) | `claude-sonnet-5-5` |
| 고성능 (`heavy`) | **MVP 기본 배정 없음.** 평가 세트에서 기본 등급이 기준 미달인 기능을 그 공급자에 한해 승급할 때만 | `gpt-6.1-sol` | `gemini-4-argon` (**무료 등급 없음**) | `claude-opus-5-5` |

- (v4.3) **모델명은 사용자 확정 매핑(B-3, 2026-10-28 공급자 공식 목록 조사)이다.** v4.2의 계열 표기 `[가정]`을 대체한다. Gemini 고성능은 무료 등급이 없어, 무료 사용자의 기능을 승급하면 그 사용자는 F-AI-08 (5)를 보게 된다 — Gemini에서 미달 기능은 고성능 승급보다 프롬프트 조정을 먼저 한다.
- **Gemini 기본 등급은 무료 등급에서 쓸 수 있는 모델이어야 한다**(F-AI-05 기본 추천 경로). 무료 등급에서 못 쓰는 모델을 배정하면 무료 사용자는 모두 F-AI-08 (5)를 보게 된다.
- 기능별 등급 배정은 공급자와 무관하게 같다(각 카드 "모델 등급"). 평가 세트에서 특정 공급자의 특정 기능만 미달하면 **그 공급자의 그 기능을 고성능으로 승급**하거나 그 공급자용 프롬프트를 조정해 통과할 때까지 반복한다(D-38, UB-3: 세 공급자 모두 통과해야 출시, "준비 중" 공급자는 두지 않는다). 실행 중 자동 대체·자동 강등은 하지 않는다. 사용자가 고른 공급자의 모델을 그 등급에서 쓸 수 없으면 F-AI-08 (5) 안내로 끝낸다.
- v3의 "Sonnet으로 시작 → 평가 통과 시 Haiku"(D-AI-02·D-AI-11)는 이 매핑으로 대체한다. 모델 변경은 **운영자의 매핑 변경**(평가 세트 재통과 필수)이며 사용자 실행 중에 일어나지 않는다.
- 사고(reasoning) 설정: 공통 요청의 `reasoning_level`(`low` / `medium`)을 어댑터가 공급자 설정으로 바꾼다(Claude effort, OpenAI reasoning effort, Gemini thinking budget `[가정]`). 사고 토큰은 출력 토큰으로 과금되므로 미터에 포함한다(C-13).

**C-10.2 구조화 출력 (같은 정본 스키마 → 공급자 형식)**

| 공급자 | 방식 | 스키마 제약과 대응 |
|--------|------|--------------------|
| OpenAI | JSON Schema 구조화 출력(strict) | 모든 속성 `required`, `additionalProperties: false` 필요 → 선택 필드는 `null` 허용 타입으로 표현 |
| Gemini | (v4.3, 구현 반영) `responseMimeType = application/json` + **`responseJsonSchema`**(JSON Schema). v4.2의 `responseSchema`(OpenAPI 부분집합)는 쓰지 않는다 | 선택 값(nullable)은 `anyOf [T, null]`로 보낸다. `enum`·`additionalProperties`·`propertyOrdering`을 쓸 수 있어 "선택 → 본문"(AI-04) 순서를 속성 순서로 보장한다. 재귀는 쓰지 않는다. 실제 키 스모크 확인 필요 `[가정]` |
| Claude | 구조화 출력(`output_config.format`) 또는 `strict` 도구 정의 | 강제 `tool_choice`는 쓰지 않는다(현 모델 미지원). 기본은 구조화 출력 |

- **정본 스키마 설계 규칙(최소 공통분모)**: 최상위 `oneOf` 없음, 판별 필드(`target`, `kind` 등)는 문자열 enum, 선택 값은 명시적 `null`, 깊이 5 이하, 배열 길이 상한은 서버 검증으로(공급자별 `maxItems` 지원 차이). AI-03의 경력/교육 섹션처럼 갈래가 있는 출력은 별도 배열(`sections`, `education_sections`)로 둔다.
- **서버가 항상 다시 검증한다**: 공급자의 스키마 보장 수준이 다르므로 모든 응답을 정본 스키마로 재검증(V-6)한다. 실패 → 같은 공급자·모델로 1회 재시도 → 실패 시 `schema_invalid`.
- 스트리밍 + 구조화 출력: 세 공급자 모두 JSON 텍스트를 조각으로 흘려보내며, 서버의 증분 JSON 파서가 블록 이벤트(C-6)를 만든다. Gemini는 조각이 큰 편이라 블록 표시가 덜 매끄러울 수 있다 `[가정]`.

**C-10.3 스트리밍·사용량·캐시 차이**

| 항목 | OpenAI | Gemini | Claude | 서버 처리 |
|------|--------|--------|--------|-----------|
| 스트리밍 | SSE 델타 | `streamGenerateContent` 조각 | SSE 이벤트 | 공통 `delta` / `done` / `error` 이벤트로 정규화 |
| 토큰 수 반환 | 응답·스트림 종료 시 usage (스트림은 usage 포함 옵션 필요) | `usageMetadata`(입력·출력·사고·캐시) | `usage`(입력·출력·캐시 쓰기·캐시 읽기) | C-13 공통 필드로 매핑 |
| 프롬프트 캐시 | 긴 프롬프트의 앞부분 자동 캐시, 캐시된 입력 토큰 보고 | 최근 모델의 암묵 캐시, 캐시 토큰 보고. 명시적 컨텍스트 캐시는 저장 비용이 있어 MVP 미사용 | 명시적 캐시 지점 지정, 쓰기 할증·읽기 할인 | C-8의 "고정 프리픽스 먼저" 순서를 세 공급자 공통으로 유지. Claude에만 캐시 지점 표시를 추가 |
| 안전 필터 | 거절 응답 | 안전 차단(`blockReason`, `finishReason = SAFETY`) | 거절(`stop_reason = refusal`) | F-AI-08 (7) |

- 캐시 효과는 공급자마다 다르므로 C-8의 병렬 전 캐시 예열은 **Claude에만** 적용한다. 다른 공급자는 순서만 맞추고 예열 호출을 하지 않는다(NFR-AI-08: 불필요 호출 금지).

**C-10.4 공급자별 품질·검증 위험 (서버 검증은 그대로, 평가 세트에서 집중 점검)**

| 위험 | 내용 | 대응 |
|------|------|------|
| 인용 변형 | 근거 `quote`·`source_quotes`를 원문과 다르게 다듬어 V-3·V-9b 거부가 늘 수 있다 | 프롬프트에 "그대로 복사" 강조, 공급자별 거부율을 평가 지표로 |
| 별칭 날조 | 존재하지 않는 `PRJ-n` 등 | V-1 그대로 |
| 수치 표기 | "1.2초" ↔ "1.2 s" 같은 단위·자릿수 변형 | V-5·V-9c 정규화 규칙(단위 동의어 표)을 공급자 공통으로 |
| 한국어 품질 | 자소서 문체·경력기술서 개조식·면접 질문 어투가 공급자별로 다르다 `[가정]` | 평가 세트의 사람 평가 항목으로 공급자별 확인, 필요 시 공급자별 프롬프트 변형(`prompt_version`에 공급자 접미사) |
| 한국어 토큰 수 | 토크나이저가 달라 같은 입력의 토큰 수가 공급자별로 ±30~50% 다를 수 있다 `[가정]` | 미터는 항상 공급자가 보고한 값을 쓴다(7장 추정치는 범위로 표기) |
| 안전 필터 오탐 | 컬처핏의 갈등·실패, 회고의 건강 언급 등에서 차단될 수 있다 | 공급자가 허용하는 범위에서 기본 안전 설정 유지, 차단 시 F-AI-08 (7). 평가 세트에 갈등·실패 사례 포함 |
| 스키마 보장 차이 | Gemini 부분집합 스키마는 일부 제약을 강제하지 않는다 | V-6 재검증 |

**C-10.5 키 검증 호출 (F-AI-01, NFR-KEY-04)**

| 단계 | OpenAI | Gemini | Claude | 판별 |
|------|--------|--------|--------|------|
| 1. 인증·모델 가시성 (토큰 비용 없음) | 모델 조회(매핑된 기본 등급 모델) | 모델 조회 | 모델 조회 | 401/403/`API_KEY_INVALID` → (4) 키 무효, 404 → (5) 모델 불가 |
| 2. 실행 가능 여부 (최소 생성) | 기본 등급 모델, **출력 상한 16토큰**(v4.3: OpenAI 응답 API의 출력 최솟값이 16이라 1~5토큰은 불가) | 기본 등급 모델, 출력 1~5토큰 | 기본 등급 모델, 출력 1~5토큰 | 잔액·결제 → (3), 무료 등급 지역·결제 필요 → (3), 등급에서 한도 0 → (5), 429 분당·일일 → (1)/(2), 5xx → (6) |

- 2단계는 기본 등급 모델로 하는 이유: 대부분의 기능이 그 모델로 돈다. 경량 등급 모델은 1단계 조회로만 확인한다.
- (v4.3, 구현 반영) 검증 상한 시간: 목표(유료 5초·무료 10초)와 별도로 유료 15초·무료 20초에서 끊는다. 상한 초과는 공급자 장애(6)로 본다 — 1단계면 저장하지 않고 "잠시 후 다시", 2단계(인증 통과)면 `needs_check`로 저장한다. 사용 기록은 2단계 생성 호출만 1행 남긴다(1단계 조회는 토큰이 없다).
- **저장 규칙 (R-38)**:

  | 검증 결과 | 저장 | `ai_provider_keys.status` | 비고 |
  |-----------|------|---------------------------|------|
  | 1·2단계 모두 통과 | 저장 | `valid` | |
  | 키 무효(4)·형식 오류, 결제 필요(3), 모델 불가(5) | **저장하지 않음** | — | 원인 안내 후 다시 입력(F-AI-01 (2)) |
  | 1단계 통과(인증됨) + 2단계에서 분당·일일 한도(1·2) 또는 공급자 장애(6) | **저장** | `needs_check` + `last_failure_cause` | Gemini 무료 사용자가 그날 한도를 다 쓴 상태에서도 연결할 수 있게. 다음 AI 실행이나 "다시 확인"에서 `valid`로 갱신(`record_provider_key_check`). 일일 한도면 초기화 시각도 함께 안내 |
- **RPC 연결 (데이터 모델 v4.2)**: 등록·교체 검증은 `save_provider_key`에 `verification_result = valid | limited`를 넘긴다(`limited` = 인증 통과 + 분당·일일 한도 또는 공급자 장애 → `needs_check`로 저장, 원인을 함께 넘김). `key_invalid`·`billing_required`·`model_not_available`이면 RPC를 호출하지 않는다(저장 안 함). "다시 확인"은 `record_provider_key_check`를 쓴다: 성공 → `valid`, `key_invalid` → `invalid`, 그 밖의 실패 → `needs_check`. 작업이 성공하면 `needs_check` 키를 `valid`로 되돌리는 것은 AI 경로 RPC(`record_provider_key_success`)가 한다. (v4.3, A19 — 확정 2026-11-05 (사용자)) 키 저장·확인 RPC는 **서버 전용 역할**에서 실행하고 서버가 `p_user_id`를 넘긴다. 브라우저(`authenticated`)는 직접 부를 수 없다. 인자·권한 세부는 DM v4.2 2.11.3.
- (v4.3, A20 — 확정 2026-11-05 (사용자)) 키 등록과 AI 실행 모두 "동의 후 시행된 고지 버전 중 `requires_reconsent = true`인 새 버전이 있을 때만" 다시 동의를 받는다(DM v4.2 2.11.5).
- 검증은 재시도하지 않는다(즉시 결과를 보여 주기 위해). 1단계 장애(6)는 저장하지 않고 "잠시 후 다시 시도" 안내.
- 확인 호출 토큰은 미터에 기능 `key_verification`("연결 확인")으로 기록한다(`ai_jobs.job_type = 'key_verification'`, NFR-KEY-04). 키 원문은 어떤 로그에도 남기지 않는다(NFR-KEY-05).
- 목표 5초(무료 등급 10초).

### C-11. 공급자 오류 분류 (F-AI-08)

**C-11.1 7원인 ↔ `error_code` ↔ 재시도**

| # | 원인 (F-AI-08, `ai_jobs.failure_cause`) | `error_code` | `error_category` | 재시도 (C-11.3) | 키 상태 변경 |
|---|----------------|--------------|---------------------------|--------|--------------|
| 1 | 분당 요청 한도 (`rate_limited`) | `rate_limited` | `provider_limit` | **예** — 호출당 최대 4회(C-11.3) | 없음 |
| 2 | 일일 한도 소진 (`daily_quota_exhausted`) | `daily_quota_exhausted` | `provider_limit` | 아니오 (초기화 시각을 `ai_jobs.quota_resets_at`에 저장해 안내) | 없음 |
| 3 | 잔액·결제 부족 (`billing_required`) | `billing_required` | `user_account` | 아니오 | 없음 ("결제 확인 필요" 표시) |
| 4 | 키 무효·폐기·권한 없음 (`key_invalid`) | `key_invalid` | `user_account` | 아니오 | **무효**로 즉시 변경 — RPC `mark_provider_key_invalid(ai_job_id, failure_cause)`(NFR-KEY-09) |
| 5 | 이 등급에서 쓸 수 없는 모델 (`model_not_available`) | `model_not_available` (v3 `model_unavailable` 대체) | `user_account` | 아니오 (자동 대체 없음, D-31) | 없음 |
| 6 | 공급자 장애·과부하 (`provider_unavailable`) | `provider_unavailable` | `transient` | **예** — 호출당 최대 2회(C-11.3) | 없음 |
| 7 | 입력 과다 / 안전 차단 (`input_rejected`) | `input_too_long` / `safety_blocked` (v3 `refused` 대체) | `input` | 아니오 | 없음 |
| — | 실행 중 키 없음(키 삭제됨, D-36) | `key_missing` | `user_account` | 아니오 (`failure_cause` null — 화면은 "AI 연결하기" 잠금 안내) | 없음 (행이 이미 없음) |
| — | (시스템) 스키마 불일치, 시간 초과, 작업 정지, 취소, 데이터 부족, JD 아님 | `schema_invalid`, `timeout`, `stalled`, `canceled`, `insufficient_data`, `not_a_jd` (v3 유지) | `system` / `input` | `schema_invalid`·`timeout`만 1회 | 없음 |

- `error_category`는 v3의 화면 3범주(일시적 / 입력 문제 / 시간 초과)를 **사용자 키·한도 원인(`provider_limit`, `user_account`)과 시스템 원인(`transient`, `system`, `input`)으로 다시 나눈다**. 실행 인프라 실패율(D-AI-01, PRD 6.6)은 `provider_limit`·`user_account`를 빼고 계산한다.
- **저장 위치**: `ai_jobs.error_code`(세부 코드), `ai_jobs.error_category`(generated), `ai_jobs.failure_cause`(generated, 위 7값 — 화면 F-AI-08 원인), `ai_jobs.quota_resets_at`(원인 2의 초기화 시각, UTC 저장·KST 표시), `ai_jobs.retry_after`(원인 1·6으로 최종 실패했을 때 "이 시각 이후 다시 시도"), `ai_jobs.retry_count`(A4-8).
- 재시도 후에도 실패하면 마지막 원인으로 작업을 끝내고, 입력·부분 결과(저장된 질문, 완료된 문항·답변 평가, 대화 메시지)는 보존한다(D-36).

**C-11.3 자동 재시도 규칙 (R-39, 유료·무료 등급 공통)**

| 원인 | 호출당 최대 재시도 | 대기 간격 | 작업당 대기 합계 상한 | 최종 실패 시 |
|------|--------------------|-----------|------------------------|--------------|
| 1 `rate_limited` | **4회** | 공급자 재시도 시각(`Retry-After` 등)이 있으면 그 값, 없으면 지수 백오프 2 → 4 → 8 → 16초 (+0~1초 무작위) | **120초** (원인 1·6 합산) | `retry_after` = 마지막 실패 시각 + 다음 대기 간격(최소 1분), "N분 후 다시 시도" |
| 6 `provider_unavailable` | **2회** | 2 → 4초 (+0~1초 무작위) | 같음 | `retry_after` = 실패 시각 + 1분, "잠시 후 다시 시도" |
| `schema_invalid`, `timeout` (시스템) | 1회 | 즉시 | — | 실패 안내 + "다시 시도" |
| 그 밖의 원인 (2·3·4·5·7, `key_missing`) | 0회 | — | — | 원인별 안내 |

- **등급에 따라 횟수를 다르게 두지 않는다.** 무료 등급과 유료 등급의 차이는 **실행 방식**(무료 = 순차 + 호출 간격, C-12)뿐이다. 이유: 같은 원인에 같은 안내가 나와야 화면(UX C-20)이 하나의 규칙으로 표시할 수 있고, 분당 한도에 자주 닿는 무료 등급의 부담은 호출 간격으로 이미 줄인다.
- 원인 6을 1보다 적게(2회) 두는 이유: 장애는 짧은 대기로 풀리지 않는 경우가 많고, 재시도마다 사용자 토큰이 쓰일 수 있다(실패 응답의 토큰도 기록, C-13).
- **비동기 작업**: 재시도 대기는 함수 안에서 기다리지 않고 `ai_jobs.next_run_at`으로 다음 단계를 예약하며 `progress.waiting_retry_until`을 기록한다(C-12). 재시도 각 시도는 `ai_jobs.retry_count`를 올리고 사용 기록 1행을 남긴다. 예약은 "이번 실행의 대기 합계 + 다음 대기 ≤ 120초"일 때만 하고, 넘으면 그 원인으로 최종 실패하고 `retry_after`를 기록한다(공급자가 120초보다 긴 재시도 시각을 줄 때도 같다). 예약된 작업은 화면의 작업 상태 조회(2초 폴링)가 깨우고, 크론이 안전망이다.
- **(v4.3, 구현 반영) 동기 작업(AI-01 요건 추출, AI-11)**: 요청을 열어 둔 채 `next_run_at` 예약을 할 수 없다. 정책이 요구하는 대기가 **5초 이하일 때만 요청 안에서 기다린 뒤** 다시 부르고, 더 길면 바로 최종 실패로 끝낸다(`retry_after` = 위 표의 최종 값). 즉시 재시도(`timeout`·`schema_invalid` 1회)는 그대로. 요청 전체 상한 30초.
- **스트리밍 응답(AI-03, AI-04, AI-12 응답)**: **첫 토큰 전**의 즉시 재시도(`schema_invalid`·`timeout` 1회)만 한다. (v4.3, A14 — 확정 2026-11-05 (사용자)) 대기가 필요한 원인(1 분당 한도, 6 공급자 장애)은 기다리지 않고 바로 실패로 끝낸다. 화면은 `retry_after`로 대기 시간을 안내한 뒤 "다시 보내기"(AI-12)·"다시 시도"(서류)를 보인다. 스트리밍 도중 끊기면 재시도하지 않는다(중복 출력·중복 토큰 방지). 받은 부분의 처리는 기능 카드를 따른다(AI-12 메시지는 `failed`, AI-03은 블록 보존 없음 — A4).
- **수동 "다시 시도"(사용자 확정 2026-10-28)**: 재시도 예산 기준으로는 새 실행으로 본다. 호출당 재시도 횟수와 120초 대기 예산을 새로 시작한다. (공급자는 이와 별개로 C-11.4를 따른다 — 같은 행의 다시 시도도 누른 시점의 활성 공급자.) `retry_count`·누적 대기 기록은 작업 전체 누계로 계속 늘어난다.
- UX C-20의 원인 6 문구("자동 재시도 1회 후")는 이 표(2회)를 따르도록 리더가 전달한다.

**C-11.2 공급자 응답 → 원인 매핑 (v4.3: 2026-10-28 공급자 문서 확인 반영. 본문 관례에 기대는 값은 `[가정]`)**

| 원인 | OpenAI | Gemini | Claude |
|------|--------|--------|--------|
| 1 분당 한도 | 429 + `rate_limit_exceeded`(분당 요청·토큰 한도) | 429 `RESOURCE_EXHAUSTED` + 할당량 상세의 분당(`PerMinute`) 한도 `[가정: 본문 관례]` | 429 `rate_limit_error` |
| 2 일일 한도 | 429 중 메시지에 일일(per day/RPD) 표기가 있는 경우 `[가정]` (초기화 시각은 재시도 시각 헤더가 있을 때만) | 429 `quota_exceeded`(snake_case 코드), 또는 `RESOURCE_EXHAUSTED` + 할당량 상세의 일일(`PerDay`) 한도 `[가정: 본문 관례]` | (일일 한도 개념 없음 — 해당 없음) |
| 3 잔액·결제 | 429 잔액·지출 한도 계열 `credit_balance_exhausted`, `organization_spend_limit_exceeded`·`project_spend_limit_exceeded`, `organization_usage_limit_exceeded`(v4.2의 `insufficient_quota` 대체), **403 지원하지 않는 국가·지역** | **402**(선불 크레딧 소진), 400 `FAILED_PRECONDITION`/`failed_precondition`(무료 등급 불가 지역·결제 필요) | **402 `billing_error`**, 400 `invalid_request_error` 중 크레딧 부족·사용 한도 도달 메시지 |
| 4 키 무효 | 401 `invalid_api_key`, 403 권한 없음 | 400 `INVALID_ARGUMENT` + `API_KEY_INVALID`, 403 `PERMISSION_DENIED` | 401 `authentication_error`, 403 `permission_error` |
| 5 모델 불가 | 404 `model_not_found`, 403 모델 접근 권한 없음 | 404 `NOT_FOUND`, 429인데 해당 모델 무료 등급 한도가 0 | 404 `not_found_error` |
| 6 장애 | 500·502·503 | 500 `INTERNAL`, 503 `UNAVAILABLE`, 504 `DEADLINE_EXCEEDED` | 500 `api_error`, 529 `overloaded_error` |
| 7 입력 과다 | 400 `context_length_exceeded` | 400 `INVALID_ARGUMENT`(토큰 수 초과) | 400 프롬프트 길이 초과, 413 `request_too_large` |
| 7 안전 차단 | 거절 응답, 콘텐츠 정책 오류 | 200 + `promptFeedback.blockReason` 또는 `finishReason = SAFETY` | 200 + `stop_reason = refusal` |

- (v4.3, 구현 반영) **표에 없는 오류**: 공급자 호출 안에서 난 분류되지 않은 오류는 `provider_unavailable`(최대 2회 재시도)로 기록하고 로그에 미분류 표시를 남긴다. 공급자 호출 밖의 예외(서버 버그, DB 오류, 검증기 오류, 실행기 자체 오류)는 `stalled`로 끝내고 자동 재시도하지 않는다(화면에 "공급자 장애"가 잘못 보이지 않게, 사용자 확정 2026-10-28).
- 분류가 애매한 429(Gemini 할당량 상세가 없는 경우 등)는 **1(분당)로 보고 재시도**하되, 같은 작업에서 재시도 상한까지 연속 429면 "한도에 걸렸어요 — 무료 등급이면 오늘 한도를 다 썼을 수 있어요"로 2와 함께 안내한다.
- **Gemini 무료 일일 한도 초기화 시각**: 다음 `00:00 America/Los_Angeles`를 tz 데이터베이스로 계산해 `Asia/Seoul`로 바꿔 표시한다(태평양 서머타임 기간 KST 오후 4시, 표준시 기간 오후 5시). 고정 시각으로 하드코딩하지 않는다. 공급자 정책이 바뀌면 이 규칙만 바꾼다 `[가정: 최신 정책 확인]`.

**C-11.4 "다시 시도"·재실행의 공급자 (v4.3, A1 — 확정 2026-11-05 (사용자, A1 변경))**

A1(변경): **"다시 시도"를 포함한 모든 다시 시도·재실행은 누른 시점의 현재 활성 공급자·등급으로 돈다.** 앞선 R-48 리더 해석(같은 작업 행의 다시 시도 = 작업에 고정된 처음 공급자)은 폐기한다. 동작은 아래 두 경우로 나뉘지만 공급자 규칙은 같고, 다른 것은 완료 단계 결과를 이어 쓰는지뿐이다.

| 경우 | 해당 동작 | 공급자·등급 | 완료 단계 결과(`step_outputs`) |
|------|-----------|-------------|-------------------------------|
| ① 같은 작업 행을 다시 엶 | 실패한 비동기 작업의 "다시 시도": AI-02 인사이트, AI-05 면접 질문 생성, AI-06/07 채점 작업의 공용 재시도(`/api/ai-jobs/{id}/retry`, `spec-gaps.md` S3a) | **다시 시도를 누른 시점의 활성 공급자·등급.** 작업 행의 `provider`·`model`·`connection_tier`와 결과 행·면접 세션의 공급자 컬럼(AI-05 `question_provider`·`question_model`, AI-06/07 `evaluation_provider`·`evaluation_model`)을 그 값으로 갱신 | 활성 공급자·등급이 작업에 기록된 것과 **다르면** `step_outputs`를 버리고 **처음 단계(`prepare`)부터** 다시 실행한다(한 결과가 두 공급자의 출력으로 섞이지 않게, 리더 판단). **같으면** 지금처럼 완료 단계를 건너뛰고 실패한 단계부터 잇는다 |
| ② 새 작업을 시작함 | 요청 범위 작업(C-6: AI-01 요건 추출, AI-11·AI-03·AI-04 서류 3종)의 "다시 시도"·"다시 생성", 인사이트 "다시 생성", 면접 "다시 채점"(AI-06)·"남은 질문 다시 만들기"(AI-05) — 구현상 새 작업(`spec-gaps.md` S8 ④) | **시작 시점의 활성 공급자·등급**을 새 작업에 고정 | 해당 없음(새 작업) |

- 경우 ①에서 공급자·등급이 작업 행에 기록된 값과 달라 처음부터 다시 실행할 때, 그 작업이 이미 저장한 결과 행 전부(AI-05 이 세션에 저장된 질문, AI-06 이 작업에서 저장된 답변 평가, AI-07 종합)도 다시 열어 새 실행의 결과로 덮어쓴다 — 한 결과에 두 공급자의 출력이 섞이지 않게 한다(리더 판단 2026-11-05, 리뷰 R-63 (a)). 공급자·등급이 같으면 지금처럼 실패한 행만 다시 연다. 비교 기준은 작업 행에 기록된 값(R-66).
- **연결 확인은 두 경우 모두 활성 공급자·등급 기준**이고, 거부 코드는 DM v4.2 2.11.7의 경로별 표를 따른다: 경우 ①(같은 행 다시 시도, DM 경로 ②, 다시 시도 라우트) — 키 없음 `key_missing`, 동의 필요(A20) 409 `ai_consent_required`, 키 무효 `key_invalid`. 경우 ②(새 작업 시작, DM 경로 ①) — 키 없음 `ai_not_connected`(409), 동의 필요 `ai_consent_required`, 키 무효 `key_invalid`. 키 없음은 두 코드 모두 화면에서 "AI 연결 필요"(AI 연결하기 잠금 안내), 무효는 키 교체, 동의 필요는 **활성 공급자·등급으로** 동의(C-21)를 연다. 실행 중 단계 확인(`check_ai_run_allowed`)은 DM 경로 ③이라 여기 거부 코드의 근거가 아니다. 거부되면 공급자 호출과 사용 기록은 생기지 않는다.
- 진행 중(`running`) 작업은 시작한 공급자로 끝까지 간다. F-AI-03 (2)의 "공급자 변경은 다음 실행부터"는 유지한다 — 다시 시도는 다음 실행이다.
- 비동기 작업의 선행 추출(`prepare`)은 **그 실행의 공급자·등급**으로 돈다(처음 실행이면 시작 공급자, 다시 시도면 누른 시점의 활성 공급자).
- 화면(UX C-20·S-40): "처음 실행한 {공급자}로 다시 해요"·"실패한 작업의 다시 시도는 원래 공급자로" 같은 안내는 없앤다. 다시 시도 버튼 옆 배지는 활성 공급자를 보이고, 작업에 기록된 공급자와 다르면 "{활성 공급자}로 처음부터 다시 해요"를 붙인다.
- 백엔드 후속 ★: 현재 구현은 작업에 고정된 옛 공급자로 다시 돈다 → 활성 공급자·등급으로 바꾸고, 다르면 `step_outputs`를 비우는 처리를 더한다.

### C-12. 무료 등급 실행 경로 (D-37)

연결 등급이 `free`(사용자 선택, F-AI-04)이면 어댑터가 **순차 실행 모드**로 바꾼다. 유료 등급은 v3의 병렬 경로를 그대로 쓴다.

| 기능 | 유료 등급 | 무료 등급 |
|------|-----------|-----------|
| AI-02 인사이트 단계 1 | 요건 배치 병렬 | 배치를 **순차** 실행(배치 크기 8 유지) |
| AI-06 답변 평가 | 응답 수만큼 병렬 | **순차**, 답변 1개 = 작업 단계 1개 |
| AI-12 턴 | 정리 + 응답 병렬 | **응답 먼저, 정리 다음** 순차(사용자가 응답을 먼저 보게) |
| AI-04 전체 생성 | 문항 순차(v2부터) | 같음 |
| 그 외 | 단일 호출 | 같음 |

- **호출 간격 조절**: 사용자·공급자 단위로 최소 간격을 둔다(무료 Gemini 기준 약 6초 `[가정]`). (v4.3) Gemini 무료 등급의 모델별 분당·일일 요청 한도는 공식 가격·한도 페이지에 공개되지 않고(2026-10-28 확인) 콘솔에서만 보이므로 6초 `[가정]`을 상수로 유지한다. 간격은 마지막 호출 시각(사용 기록)으로 판단한다.
  - 비동기 작업: 다음 단계 실행 시각으로 예약한다(`next_run_at`).
  - (v4.3, 구현 반영) **동기·스트리밍 경로**(AI-01, AI-11, AI-03, AI-04, AI-12 턴): 예약할 수 없으므로 **요청 안에서 최대 6초 기다린다**(같은 공급자의 마지막 호출이 6초 안이면 남은 시간만). 기다린 만큼 함수 60초 예산이 줄어 AI-03이 무료 등급에서 `timeout`으로 끝날 가능성이 커진다 — A13(추출 분리)로 줄였고, 실측 후 다시 본다 `[가정]`. AI-04 글자 수 보정 호출이 간격 때문에 예산 안에 들어가지 못하면 보정 없이 저장한다(`char_adjust_needed`).
  - AI-12 무료 등급 턴에서 응답 호출이 실패하면 정리 호출을 부르지 않는다(실패한 키에 호출을 더하지 않음). 그 발화는 미처리로 남아 다음 턴·다시 보내기에서 정리된다.
- **자동 재시도**: C-11.3 규칙을 그대로 쓴다(등급과 무관). 무료 등급은 순차 실행이라 분당 한도에 닿는 빈도를 호출 간격으로 줄인다.
- 재시도 대기 중에는 `ai_jobs.progress`에 `{stage, done, total, waiting_retry_until}`을 기록해 화면이 "한도 대기 중 n초"를 보이게 한다.
- 한 번의 서버 함수 실행이 60초를 넘지 않도록 순차 경로도 단계를 쪼갠다(C-6). 비동기 작업의 재시도 대기는 함수 안에서 기다리지 않고 다음 단계 실행 시각으로 예약한다(`ai_jobs.next_run_at`). 동기·스트리밍 경로는 C-11.3 규칙. (v4.3, 구현 반영) 무료 등급 AI-02 단계 1과 (등급 무관) AI-05 질문 생성·남은 개수 재생성은 **함수 실행 1번에 공급자 호출 1번**만 하고 다음 실행을 이어 요청한다 — 호출 간격·60초 예산·호출별 재시도가 배치·재생성마다 적용된다. 끝난 배치 결과는 단계 결과에 저장해 재시도 때 다시 부르지 않는다(유료 병렬도 같음). 호출이 없는 단계(`validate`, `complete`)에는 간격을 두지 않는다.
- **성능 목표 2배 완화** (PRD 6.4, 무료 등급):

  | 작업 | 유료 등급 p90 | 무료 등급 p90 |
  |------|---------------|---------------|
  | 키 등록 검증 | 5초 | 10초 |
  | JD 요건 추출 | 15초 | 30초 |
  | 인사이트 | 40초 (첫 진행 10초) | 80초 (첫 진행 20초) |
  | 서류 초안 (문항당) | 첫 글자 5초 / 완료 60초 | 10초 / 120초 |
  | 면접 질문 일괄 생성 | 첫 질문 10초 / 전체 30초 | 20초 / 60초 |
  | 면접 채점 | 60초 | 120초 |
  | AI 작성 대화 응답 | 첫 글자 3초 / 완료 10초 | 6초 / 20초 |
  | STAR 정리 갱신 | 10초 | 20초 |

  재시도 대기 시간은 이 목표에서 제외하고 화면에 따로 보인다 `[가정]`.

### C-13. 사용량 미터 기록 (F-AI-07, D-17 재정의, D-33)

**차감·예약 개념은 없다**(D-34). AI 호출 1회(재시도 포함, 각 시도 1행)마다 공급자가 보고한 토큰을 기록한다.

**기록 형식 (`ai_usage_records`, 데이터 모델 v4)**

| 필드 | 설명 |
|------|------|
| `user_id`, `occurred_at`, `period_month` | 달력 월 KST 1일 (D-DM-05) |
| `provider` | `openai` / `gemini` / `anthropic` |
| `model` | 실제 호출한 모델 ID |
| `model_tier` | `light` / `default` / `heavy` |
| `connection_tier` | `free` / `paid` (호출 시점의 사용자 등급 선택) |
| `feature` | 미터 표시 기능 (A4-1): `jd_extraction` / `insight` / `career_description` / `cover_letter` / `interview_questions` / `interview_evaluation` / `writing_chat` / `key_verification`(연결 확인, A4-2) / (Should) `writing_assist`, `chat_reply`. AI-11 기본 선택과 자소서 글자 수 보정은 각각 `career_description`·`cover_letter`에 포함 |
| `job_type`, `ai_job_id`, `call_key` | 작업과 단계(예: `insight.match.2`, `interview_evaluation.answer.3`, `writing_chat.turn.7.extract`) |
| `application_project_id` | 관련 지원 프로젝트(삭제 시 null, 기록은 유지 `[가정]`) |
| `input_tokens` | 캐시되지 않은 입력 토큰 |
| `cached_input_tokens` | 캐시 읽기 입력 토큰(공급자가 보고할 때) |
| `cache_write_tokens` | 캐시 쓰기 토큰(Claude) |
| `output_tokens` | 출력 토큰(사고 토큰 포함) |
| `reasoning_tokens` | 그중 사고 토큰(공급자가 따로 보고할 때, 표시용) |
| `usage_source` | `provider_reported` / `unavailable`(실패 응답에 토큰 정보가 없을 때 0으로 기록) |
| `outcome` | `succeeded` / `failed` + `error_code` |
| `price_table_version` | 계산에 쓴 가격표 버전 |
| `estimated_cost_usd` | 아래 식, 기록 시점 계산값(가격표가 바뀌어도 다시 계산하지 않음) |

- **예상 비용** = `input_tokens × 입력 단가 + cached_input_tokens × 캐시 읽기 단가 + cache_write_tokens × 캐시 쓰기 단가 + output_tokens × 출력 단가` (모델·가격표 버전 기준). 무료 등급도 **유료 환산 값**을 계산하고 화면은 "청구되지 않을 수 있음"으로 표시한다(F-AI-07 (5)).
  - **장문 구간 (v4.3)**: 그 호출의 입력(캐시 포함 전체 입력 토큰)이 `long_context_threshold_tokens`를 넘으면 네 단가를 모두 장문 단가로 바꾼다: 입력 `long_context_input_usd_per_mtok`, 캐시 읽기 `long_context_cached_input_usd_per_mtok`, 캐시 쓰기 `long_context_cache_write_usd_per_mtok`, 출력 `long_context_output_usd_per_mtok`. 장문 캐시 단가가 비어 있으면(null) 일반 캐시 단가를 쓴다. 장문 캐시 단가 2개는 DM v4.2 2.9.3의 가격표 컬럼이다(공급자 가격표에서 장문 구간에 캐시 단가도 바뀌는 모델이 있어 추가).
  - 그날 유효한 가격표 버전에 없는 모델을 호출했으면 `price_table_version = 'unpriced'`, `estimated_cost_usd = 0`으로 기록한다 `[가정]`(매핑 모델 9개가 모두 가격표에 있어 정상 경로에서는 생기지 않는다).
- **실패 호출**: 공급자가 토큰 수를 돌려주면 그대로 기록(F-AI-07 (7)). 토큰 정보가 없으면 0 + `usage_source = unavailable`. 스트리밍 중 끊긴 응답은 마지막으로 받은 usage가 있으면 그것을, 없으면 `unavailable`.
- **동일 입력 재사용**(C-6)으로 호출하지 않은 경우는 기록하지 않는다.
- 미터 반영은 호출 완료 후 1분 이내(PRD 6.4) — 호출 직후 동기 insert.
- **미터 표시 범위 (UB-2 (b) 확정)**: **이번 달(달력 월 KST)만**, 기능별 합계와 공급자별 합계. 지난달 비교는 표시하지 않는다(기록은 13개월 보관하므로 사용자 결정이 바뀌면 화면만 추가).

**가격표 (`ai_price_tables`, 데이터 모델 v4.2)**: `version`, `effective_from`, `provider`, `model`, `input_usd_per_mtok`, `cached_input_usd_per_mtok`, `cache_write_usd_per_mtok`, `output_usd_per_mtok`, `long_context_threshold_tokens`, `long_context_input_usd_per_mtok`, `long_context_cached_input_usd_per_mtok`, `long_context_cache_write_usd_per_mtok`, `long_context_output_usd_per_mtok`(장문 구간이 있는 모델만, 장문 캐시 2개는 v4.3 추가), `source_checked_at`(화면 "가격표 기준일").

**첫 버전 `v2026-10-28`** (v4.3: 사용자 확정 모델 매핑 B-3과 공급자 공식 가격 페이지 2026-10-28 조사값. USD / 100만 토큰, 표준 처리. 시드에 넣기 전에 원문 페이지와 한 번 더 대조한다)

| 공급자 | 등급 | 모델 | 입력 | 캐시 읽기 | 캐시 쓰기 | 출력 | 장문 구간 (기준 초과 시 입력 / 캐시 읽기 / 캐시 쓰기 / 출력) |
|--------|------|------|------|-----------|-----------|------|------------------------------|
| openai | 경량 | `gpt-6-luna` | 0.10 | 0.01 | — | 0.50 | 272K 초과: 0.20 / 0.02 / — / 0.75 |
| openai | 기본 | `gpt-6.1-terra` | 1.00 | 0.05 | — | 5.00 | 272K 초과: 2.00 / 0.10 / — / 7.50 |
| openai | 고성능 | `gpt-6.1-sol` | 2.00 | 0.10 | — | 10.00 | 272K 초과: 4.00 / 0.20 / — / 15.00 |
| gemini | 경량 | `gemini-3.5-flash-lite` (무료 등급 있음) | 0.30 | 0.03 | — | 2.50 | 없음 |
| gemini | 기본 | `gemini-3.8-flash` (무료 등급 있음) | 0.75 | 0.075 | — | 3.75 | 없음 |
| gemini | 고성능 | `gemini-4-argon` (무료 등급 없음) | 2.00 | 0.10 | — | 10.00 | 없음 |
| anthropic | 경량 | `claude-haiku-5-5` | 0.10 | 0.01 | 0.125 | 0.50 | 100K 초과: 0.50 / 0.05 / 0.625 / 2.50 |
| anthropic | 기본 | `claude-sonnet-5-5` | 2.00 | **0.10** (v4.2 초안 0.20 정정) | 2.50 | 10.00 | 없음 |
| anthropic | 고성능 | `claude-opus-5-5` | 4.00 | 0.20 | 5.00 | 20.00 | 없음 |

- 캐시 쓰기는 Claude 5분 캐시 단가다. Gemini 명시적 캐시 저장료는 MVP에서 쓰지 않는다(C-10.3). 출력에는 사고 토큰이 포함된다.
- **예정된 가격 변경은 버전을 미리 나눠 넣는다**: `v2026-12-01` — `gemini-4-argon` 입력 4.00 / 캐시 읽기 0.20 / 출력 20.00, `v2027-01-01` — `gemini-3.8-flash` 입력 1.50 / 캐시 읽기 0.15 / 출력 7.50. 나머지 행은 앞 버전 값 그대로.
- 버전 규칙: `v{YYYY-MM-DD}` — 공급자 가격이 바뀌면 새 버전, 과거 기록은 당시 버전 값 유지(PRD 6.5).
- C-10.1 매핑표의 OpenAI·Gemini `[가정]` 칸은 위 모델로 확정되었다(B-3). 모델 변경은 평가 세트 재통과가 필요한 운영자 매핑 변경이다.

### C-14. 출력 길이·개수 상한 (v4.3, 구현이 정한 값 `[가정]`)

모델 출력의 정본 스키마·서버 검증에 쓰는 상한이다. 카드에 값이 없어 구현이 정했고, 확인만 하면 된다. 정본 스키마 상한을 넘으면 V-6 불일치(1회 재시도 → `schema_invalid`), 저장 상한을 넘으면 서버가 자르거나 거부한다. DB 쪽 상한(입력 길이, 근거 개수 등)은 DM v4.2를 따른다.

| 기능 | 상한 |
|------|------|
| AI-01 | 요건 `text` ≤ 300자, 요건 ≤ 100개, 요건별 `keywords` ≤ 10개(각 ≤ 60자), `tech_keywords` ≤ 60개, `other_sids` ≤ 1,000개, `warnings` ≤ 5개(각 ≤ 200자), 회사명·포지션명 ≤ 200자. DB 저장 상한(요건 내용 ≤ 500자, ≤ 200개)보다 엄격하다 |
| AI-02 | 결과 하나의 근거 ≤ 2,000개, `item_key` ≤ 200자, 인용 ≤ 2,000자. `data_sufficiency = thin` = 팩에 들어간 `complete` 프로젝트 ≤ 2 또는 `kind = quantitative` 성과 0개. `hints`는 서버 고정 한국어 문장 2종(프로젝트 2개 이하 / 수치 성과 없음) |
| AI-03 | 프로젝트 ≤ 8개, 프로젝트당 불릿 ≤ 4개(카드 값). 8개를 넘게 고르면 사용자 순서 → 팩 순서로 앞 8개만 넣고 나머지는 생성 직후 안내(`omitted`, `user_excluded`)로 알린다. 섹션 ≤ 30개 |
| AI-03·AI-04 블록 | 초안당 블록 ≤ 500개, 블록 텍스트 ≤ 5,000자, `block_id` 영문·숫자·`_.:-` 1~64자. 형식에 맞지 않거나 겹치는 모델 id는 서버 id로 바꾼다 |
| AI-04 | 사용자 근거 선택 ≤ 5개(모델 선택은 문항 유형 규칙 0~2개), `detail_refs`는 그 프로젝트의 상세 내용 최대 2개 |
| AI-05 | 질문 문장·`intent` 각 1~1,000자, `good_answer_signals` ≤ 10개(각 ≤ 300자), 대상 요건·보완 요건 각 ≤ 20개, 세션 `weak_requirement_ids` ≤ 50개 |
| AI-12 | 패치 값: 프로젝트명·역할 ≤ 100자, 지표명 ≤ 200자, 단위 ≤ 50자, 스킬 ≤ 50자 |

---

## P1. 커리어 기능 카드 (v3 신설)

### AI-12 프로젝트 AI 작성 대화 (F-P1-13)
- 관련 기능: F-P1-13, F-P1-06(이어하기), F-P1-15(상세 내용), F-P1-04(정량 성과), F-AP-06·F-P2-09(시작점), NFR-AI-02, NFR-AI-05, NFR-PRV-05 / 관련 화면: 커리어 > AI 작성 대화(대화 영역 + 정리 결과 미리보기)
- 목적: AI가 면접관처럼 한두 개씩 질문하고, 사용자의 답을 프로젝트 기본 정보와 STAR 상세 내용으로 정리해 보여 준다. **정리 결과의 모든 필드는 그 내용을 말한 사용자 발화로 추적되고, 사용자가 "저장"을 눌러야만 커리어 데이터가 된다.**
- 시작점·모드:

  | 모드 | 시작점 | 대상 |
  |------|--------|------|
  | `new_project` | 커리어 빈 상태, 커리어 "AI와 대화하며 작성", F-AP-06 데이터 부족 안내, F-P2-09 보완점 링크 | 새 프로젝트 1건 + 상세 내용 1개 이상 |
  | `augment_project` | 기존 프로젝트 상세 → "AI와 상세 내용 추가·보강" | 기존 프로젝트에 새 상세 내용 추가, 또는 기존 상세 내용의 **빈 필드만** 채움(이미 쓴 필드는 덮어쓰지 않음) |

  - **게이트 진입 (v3.2, 사용자 결정 U-5, 데이터 모델 v3.2 V32-4)**: 데이터 최소 기준 미달로 지원 프로젝트 기능이 막혔을 때, 화면은 `get_data_readiness()`의 `features.{feature}`를 읽는다.
    - `next_action = "writing_chat"`이면 AI-12를 연다. 모드는 `suggested_mode`를 그대로 쓴다: `new_project`(완료 프로젝트가 없을 때) / `augment_project` + `suggested_project_id`(프로젝트는 있으나 `complete` 상세 내용이 없을 때). 대화 시작 시 `writing_chats.return_target = {application_project_id, feature, params, created_at}`(`feature` ∈ `insight` / `career_description` / `cover_letter` / `job_interview`)가 저장된다.
    - `next_action = "form"`(부족 항목에 `complete_experience`가 있을 때)이면 경력은 폼으로 먼저 입력한다(F-P1-16 경력 대화 작성은 Could). AI-12는 경력을 만들지 않는다.
    - (v4.3, A18 — 확정 2026-11-05 (사용자)) 상세 내용은 `complete`인데 프로젝트 이름·역할이 빠져 `draft`인 프로젝트가 있으면 `hints`에 `project_fields`, `next_action = "form"`, `suggested_project_id` = 그 프로젝트가 온다. 화면은 AI-12가 아니라 그 프로젝트 폼(S-10)을 연다(빈 칸 한두 개를 채우는 데 대화를 열지 않는다).
    - **AI-12가 읽는 게이트 컨텍스트**: `return_target`(원래 기능) + 대화 시작 시점의 `get_data_readiness()` `missing` 목록(서버가 턴마다 다시 계산). 별도 저장 컬럼 없이 이 둘에서 `focus_slots`를 만든다.
    - **질문 순서**: 부족 항목을 먼저 채운다. ① `augment_project`: 대상 프로젝트의 작성 중 상세 내용이 있으면 그 빈 필수 필드(제목·상황·행동), 없으면 새 상세 내용의 제목·상황·행동 → ② `new_project`: 기본 정보(이름·역할) + 상세 내용 필수 필드. 필수가 채워지면 과제·결과·회고 및 배운 점을 **한 번만** 권하고, 사용자가 원하면 바로 저장하게 한다. 서버는 턴마다 `structured_draft`를 저장했을 때 D-01이 충족되는지 미리 계산하고, 충족되면 `focus_slots`에 `ready_to_return`을 넣어 응답이 "이제 저장하면 {원래 기능}으로 돌아갈 수 있어요"를 말하게 한다.
    - 사용량: 게이트 진입 대화도 일반 대화와 같이 사용자 토큰을 쓴다(미터 `writing_chat`). 원래 기능의 실행은 복귀 후 사용자가 누를 때.
    - 복귀: 저장(`save_writing_chat`)·폼 전환 후 화면이 `get_data_readiness()`를 다시 불러 `ready = true`면 `return_target`으로 돌아가고 컬럼을 비운다. 미달이면 남은 부족 항목을 보여 주고 대화를 이어 가게 한다.
- 데이터 기준: 없음(커리어 데이터를 만드는 기능).
- 사용량 (v4): 차감 없음. 턴마다 응답·정리 호출이 미터 `writing_chat`으로 기록된다(C-13). 메시지 상한 **40개 = 사용자 + AI 메시지 합계, 시작 인사(첫 assistant 인사 메시지)는 제외**(v4.3, A5 — 확정 2026-11-05 (사용자). D-34 품질 목적 유지, `writing_chats.message_count`). 사용자 메시지는 그 답(AI 메시지) 자리가 남아 있을 때만 받으므로, 40번째는 AI 메시지가 되고 그 턴의 응답이 마지막 안내(빈 필드 요약 + "저장"·"폼으로 이어서 쓰기")를 한다. 시작 인사는 고정 문구로 AI를 호출하지 않는다(모드별 문구 + 활성 키가 무료 등급이면 서비스 개선 사용 가능성 안내 추가 `[가정]` — 공급자별 고지 문구와의 일치는 ux-planner·법무 확인). (v4) 무료 등급은 응답 → 정리 순차(C-12). 활성 공급자를 바꾸면 다음 메시지부터 새 공급자로 이어 간다(F-AI-03 (2)).
- 대화 진행 규칙 (서버가 슬롯 순서를 결정):

  | 순서 | 슬롯 | 채울 필드 | 질문 예 | 되묻기 조건 |
  |------|------|-----------|---------|-------------|
  | 1 | 기본 정보 | `projects.name`, 소속, 기간, `role`, `team_size`, 스킬 태그, `summary` | "어떤 프로젝트였고, 언제 어디서 하셨나요?" | 기간·역할이 없을 때 |
  | 2 | 상황 S | `project_details.title`(임시 제목), `situation` | "그때 어떤 상황이었나요? 팀이나 서비스 배경을 알려 주세요" | — |
  | 3 | 과제 T | `task` | "그 상황에서 해결해야 했던 과제나 목표는 무엇이었나요?" | — |
  | 4 | 행동 A | `action` | "그 과제에서 **본인이 직접** 한 일은 무엇인가요?" | "우리 팀이/저희가"가 주어인 문장 → "그중 본인이 맡은 부분은?" |
  | 5 | 결과 R | `result` + 정량 성과(`metric_name`, `value_before`, `value_after`, `unit`) | "결과는 어땠나요? 수치로 알고 있는 게 있나요?" | "많이 줄었다"처럼 정도만 있을 때 → "대략적인 수치를 아시나요? 모르면 비워 둘게요" |
  | 6 | 회고 및 배운 점 | `learnings` | "이 경험에서 회고 및 배운 점이나 다음에 다르게 할 점이 있나요?" | — |
  | 7 | 다음 에피소드 | 새 상세 내용 | "이 프로젝트에서 다른 에피소드(장애 대응, 협업 등)도 정리할까요?" | — |

  - 한 턴에 질문 1~2개. 사용자가 "모르겠어요/건너뛰기"라고 하면 그 슬롯을 비워 두고 다음으로 간다. **자리 표시는 저장값이 아니다**: 필수·권유 필드가 비어 있으면 화면이 그리는 표시일 뿐이고, `structured_draft`와 커리어 데이터에는 빈 값으로 남는다(R-18).
  - `requested_slot`: 사용자가 미리보기의 단계나 빈 필드를 눌러 "이 부분 물어봐 줘"를 요청하면, 다음 사용자 메시지(또는 "물어봐 줘" 버튼이 보내는 고정 문구 메시지)와 함께 서버가 그 슬롯을 `focus_slots` 맨 앞에 둔다. 이미 채워진 슬롯이면 "보강할 내용이 있나요?"로 묻는다. 고정 문구 메시지도 사용자 메시지로 저장되어 메시지 상한에 포함된다.
  - 사용자가 순서와 다르게 한꺼번에 이야기하면 들어온 내용을 해당 슬롯에 모두 정리하고, 남은 빈 슬롯만 묻는다.
  - **AI 질문에는 구체적 사실을 넣지 않는다**(예: "응답 시간을 30% 줄이셨나요?" 금지). 질문 속 사실이 사용자의 "네"로 확정되는 경로를 막기 위해서다.
  - 메시지 상한에 닿으면 마지막 AI 메시지가 빈 필드를 요약하고 "저장" 또는 "폼으로 이어서 쓰기"를 안내한다.
- 입력 컨텍스트 (턴마다):

  | 원천 | entity.field | 필수 | 크기 추정 (토큰) |
  |------|--------------|------|-------------------|
  | 대화 기록 | `writing_chat_messages`(`sequence`, `role`, `content`, `status = 'done'`만, 별칭 `M-n`) 전체 (상한 40개라 요약 불필요) | 필수 | 0.5k~8k |
  | 정리 결과 현재 상태 | `writing_chats.structured_draft` (필드별 값 + 출처 + `review`) | 필수 | 0.3k~2k |
  | 게이트 진입 컨텍스트 | `writing_chats.return_target`(있을 때만: 원래 기능) + `get_data_readiness()`의 `missing`·`suggested_mode` — `focus_slots` 계산에 우선 반영 | 조건부 | 50~150 |
  | 이번 턴 목표 슬롯 | 서버가 계산한 `focus_slots`(1~2개, 게이트 진입이면 부족 항목 우선, D-01 충족 예상 시 `ready_to_return`) + 미해결 되묻기 목록. **사용자가 화면에서 고른 `requested_slot`(선택)이 있으면 `focus_slots` 맨 앞**(R-18: 진행 단계 "이 부분부터 다시 물어봐 줘", 빈 필드 "이거 물어봐 줘") | 필수 | 50 |
  | 소속 후보 | `complete`·`draft` 경력·교육의 이름·기간 목록 (내용 없음) | 선택 | 0.1k~0.3k |
  | 기존 프로젝트 (`augment_project`) | 대상 프로젝트(`PRJ-n`)와 그 상세 내용 전체(각각 `DET-n` 별칭, 채워진 필드·빈 필드 표시) — 중복 질문 방지, 빈 필드 파악 | 조건부 | 0.5k~3k |
  | 프로필 | `profiles.desired_job_title` (질문 어휘 조정용) | 선택 | 20 |

  | 지원 프로젝트 요건 (**게이트 진입 시에만**, R-31) | `return_target.application_project_id`의 `jd_requirements.content`, `category`, `importance` 중 `importance = 'high'` 요건과 커리어 근거가 약해 보이는 요건(최대 8개, 서버가 선별) | 조건부 | 0.3k~0.6k |

  - **요건 목록의 용도 제한 (PRD F-AP-06 (2))**: 어떤 경험부터 물을지(`focus_slots` 순서)와 질문 주제(예: "결제·정산 쪽 프로젝트가 있었나요?") 선택에만 쓴다. **출처가 아니다** — 요건 문구는 정리 결과의 값·인용이 될 수 없고(V-9a·V-9b: 출처는 사용자 발화뿐), 질문에 사실을 넣지 않는 규칙도 그대로라 "Kafka를 쓰셨나요?"처럼 요건의 기술명을 사용자 경험인 것처럼 묻지 않는다(주제만 열린 질문으로). V-9d(고유명사·기술명)는 요건 목록이 아니라 사용자 발화와만 대조한다.
  - 게이트 진입 외에는 다른 프로젝트의 내용, JD, 지원 프로젝트 데이터를 넣지 않는다.
- 처리 방식: **턴마다 2개 호출을 병렬로** 실행한다.
  1. **정리(extract)** — 이번 사용자 발화를 정리 결과에 반영할 **패치**를 구조화 출력으로 만든다. 모든 패치 값에 출처 발화 ID와 인용(`source_quotes`)을 단다.
  2. **응답(reply)** — 이전 정리 결과 + 이번 발화 + `focus_slots`를 보고 다음 질문을 스트리밍 텍스트로 쓴다. 사용자가 앞 질문에 답하지 않았으면 다시 묻는다.
  - 병렬로 두는 이유: 응답 첫 글자 3초 목표(PRD 6.3)를 지키면서 정리를 따로 검증하기 위해서다. 응답 모델은 사용자 발화를 직접 보므로 정리 결과가 한 턴 늦어도 질문이 어긋나지 않는다. 서버는 정리 패치 검증 후 다음 턴의 `focus_slots`를 다시 계산한다.
  - **서버 검증 V-9 (발화 추적, 날조 0건 장치)** — 패치 필드마다:

    | # | 검사 | 실패 시 |
    |---|------|---------|
    | V-9a | 출처 ID가 `role = 'user'` 발화를 가리킨다 (AI 발화는 출처가 될 수 없다). (v4.3) 출처가 모두 "알아서 채워 줘" 같은 위임 요청 발화면 서버도 거부한다(프롬프트 지시만으로 두지 않음) | 패치 거부 |
    | V-9b | `source_quotes`가 해당 발화의 부분 문자열이다 (공백·문장부호 정규화) | 패치 거부 |
    | V-9c | **수치**: 값에 나온 모든 숫자(단위 포함)가 인용문에 같은 값으로 있다 | 패치 거부 |
    | V-9d | **고유명사·기술명**: 값의 영문 토큰, 스킬 사전 매칭어, 회사·제품명 후보가 출처 발화에 있다(대소문자 무시). 게이트 진입의 요건 목록에만 있는 기술명은 통과 근거가 되지 않는다(R-31) | 패치 거부 |
    | V-9e | **내용 겹침**: 값의 내용어 중 인용문에 없는 비율이 40% 이하 `[가정]` (요약·문장 정리는 허용, 새 주장은 불허) | 자동 반영하지 않고 `needs_review`로 미리보기에 표시(사용자가 수락해야 반영) |
    | V-9f | `action` 값의 문장 주어가 "우리/저희/팀"이면 | `actor_ambiguous` 되묻기 목록에 추가하고 `situation` 후보로만 둔다. (v4.3, 구현 반영) 후보 처리: 같은 상세 내용의 `situation`이 비어 있으면 그 값을 `situation`에 `review = 'needs_review'`로 넣고(사용자가 수락해야 저장), 이미 차 있으면 값을 버리고 `actor_ambiguous`만 남긴다 |
    | V-9g | 민감정보(건강, 종교, 노조, 정치, 제3자 실명·연락처) 감지 | 해당 내용 제외, `sensitive_flags` → 응답에서 "이 내용은 기록하지 않을게요" 안내 (NFR-PRV-05). 대화 원문(`writing_chat_messages.content`)은 사용자 데이터로 남는다(리뷰 T-17 권고 (a) — 안내 문구에 "대화 기록에는 남아 있어요") |
    | V-9h | `augment_project`: `detail_ref` 패치의 대상 필드가 기존 상세 내용에서 이미 채워져 있지 않다 / `detail_ref`가 입력 컨텍스트의 `DET-n`이다 | 패치 거부(기존 값은 대화로 덮어쓰지 않음). `apply_structured_draft_patch` RPC가 강제(데이터 모델 v3.2) |

    - 거부된 패치는 반영하지 않고 로그(원문 없이 검사 번호·필드만)에 남긴다. 그 필드는 빈 채로 남아 다음 턴에 다시 질문된다. (v4.3) AI 패치는 규칙을 어긴 항목만 건너뛰고 나머지는 반영한다(필드 단위 거부).
    - (v4.3, 구현 반영) V-9d "회사·제품명 후보"와 V-9g "제3자 실명"은 서버 상수(회사·기관 접미사 목록, "성 + 2음절 + 직함" 패턴 등)로 판정한다. 재현율을 우선했고, 오탐이면 그 필드만 빈다. 평가 세트로 보정한다 `[가정]`.
    - 사용자가 미리보기에서 직접 고친 필드는 `origin = 'user_edit'`가 되고 출처 발화 대신 "직접 수정"으로 표시된다. 이후 AI 패치는 그 필드를 덮어쓰지 않는다.
- 모델:
  - 정리: **경량 등급**, 낮은 사고 설정. 이유: 짧은 구조화 추출이고 턴마다 실행된다. 날조 방지는 모델이 아니라 V-9가 맡는다. 평가 세트에서 "누락(말한 내용을 정리하지 못함)" 비율이 15%를 넘으면 기본 등급로 올린다(대화당 +약 $0.05).
  - 응답: **기본 등급**, 낮은 사고 설정. 이유: 되묻기 판단과 자연스러운 한국어 면접 대화가 P1 입력 장벽을 낮추는 이 기능의 체감 품질이다. 공급자별 평가 세트에서 기준 미달이면 그 공급자만 프롬프트·매핑을 조정해 통과시킨다(C-10.1, D-38, UB-3).
- 응답 모드: **스트리밍 대화 턴**(SSE). 이벤트: `turn_started` → `reply_delta` → `reply_done` → `draft_patch`(검증 통과 필드와 출처) → `draft_flags`(`needs_review`, `actor_ambiguous`, `sensitive`) → `turn_done`, 실패 시 `error`. 목표: 첫 글자 3초 이내(예상 1~2.5초), 정리 결과 갱신 10초 이내(예상 2~5초). 정리 실패는 응답을 막지 않는다(미리보기만 갱신 안 됨, 다음 턴 재시도).
  - (v4.3) 재시도: 첫 토큰 전 즉시 재시도만 한다. 분당 한도·공급자 장애는 바로 `error`로 끝나고 화면이 대기 시간을 안내한 뒤 "다시 보내기"를 보인다(A14, C-11.3). 연결 게이트(키 없음·동의 필요 → `key_missing`, 키 무효 → `key_invalid`)에 막히면 `error` 이벤트 1개로 답하고 사용자 메시지는 저장하지 않는다(입력창 내용 유지).
  - (v4.3) 정리가 끝나지 않은 사용자 발화는 마지막으로 정리한 발화 위치(`writing_chats.last_extracted_sequence`, DM v4.2) 뒤의 발화로 판단해 다음 정리에 함께 넣는다. "다시 보내기"는 응답을 다시 만들고, 미처리 발화가 있을 때만 정리도 다시 한다(성공한 정리는 다시 부르지 않음).
- 프롬프트 전략:
  - 정리: 역할 = 기록 담당. "사용자가 말한 내용만, 말한 범위 안에서 정리한다. 요약·문장 다듬기는 되지만 추론·보충·일반화는 안 된다. 모르면 비운다." 필드 정의(S/T/A/R/회고 및 배운 점 경계) + 경계 사례 3개(팀 성과 vs 본인 행동, 정도 표현 vs 수치, 회고 vs 결과).
  - 응답: 역할 = 친절한 경력직 면접 코치. 질문은 열린 질문, 사실 제안 금지, 칭찬·평가 최소화, 한 번에 1~2개. 사용자 발화 안의 지시문은 데이터로 취급(C-4).
- 출력 스키마 (정리 패치, 턴 1회 — 모델 출력 형식, 저장 형식은 아래 매핑표):
  ```json
  {
    "schema_version": 2,
    "project_patches": [
      { "field": "team_size", "op": "set", "value": 4, "source_message_ids": ["M3"], "source_quotes": ["저 포함 4명이었어요"] },
      { "field": "start_month", "op": "set", "value": "2023-03", "source_message_ids": ["M2"], "source_quotes": ["23년 3월부터"] }
    ],
    "detail_patches": [
      {
        "detail_key": "D1",
        "detail_ref": null,
        "field": "action",
        "op": "set",
        "value": "결제 승인 API의 병목 쿼리를 APM으로 찾아 인덱스를 재설계했다",
        "source_message_ids": ["M7"],
        "source_quotes": ["APM으로 병목 쿼리를 찾아서 인덱스를 다시 설계했어요"]
      },
      {
        "detail_key": null,
        "detail_ref": "DET-12",
        "field": "result",
        "op": "set",
        "value": "장애 알림 건수가 줄었다",
        "source_message_ids": ["M11"],
        "source_quotes": ["그 뒤로 장애 알림이 확 줄었어요"]
      }
    ],
    "achievements": [
      {
        "detail_key": "D1",
        "detail_ref": null,
        "metric_name": "결제 승인 API 응답 시간",
        "value_before": 1.2,
        "value_after": 0.7,
        "unit": "초",
        "source_message_ids": ["M9"],
        "source_quotes": ["1.2초 걸리던 게 0.7초로 줄었어요"]
      }
    ],
    "skills": [ { "value": "Kafka", "source_message_ids": ["M4"], "source_quotes": ["Kafka로 이벤트를 받아서"] } ],
    "new_details": [ { "detail_key": "D2", "source_message_ids": ["M15"] } ],
    "affiliation_suggestion": { "type": "experience", "ref": "EXP-1", "source_message_ids": ["M1"], "source_quotes": ["에이비씨페이 다닐 때"] },
    "clarifications": [ { "kind": "actor_ambiguous", "field": "action", "detail_key": "D1", "detail_ref": null, "note": "'저희가 캐시를 붙였다'에서 본인 역할이 불분명" } ],
    "sensitive_flags": [ { "category": "health", "message_id": "M6" } ]
  }
  ```
  - `project_patches[].field`: `name` | `role` | `team_size`(정수) | `start_month` | `end_month`(`YYYY-MM`) | `summary`. 기간은 사용자가 말한 범위만(예: "작년 봄" → 월을 지어내지 않고 비우고 `period_unclear` 되묻기). 스킬은 `project_patches`가 아니라 최상위 `skills[]`.
  - `detail_patches[]`: **새 상세 내용은 `detail_key`(D1, D2… 대화 단위 임시 키), 기존 상세 내용(`augment_project`)은 `detail_ref`(입력 컨텍스트의 `DET-n`)** — 둘 중 정확히 하나. `field`: `title` | `situation` | `task` | `action` | `result` | `learnings`. `op`: `set` | `append`.
  - 숫자 필드(`team_size`, `value_before`, `value_after`)는 숫자로 출력하고 V-9c로 인용문에 같은 값이 있는지 확인한다.
  - `clarifications[].kind`: `actor_ambiguous` | `number_vague` | `period_unclear` | `affiliation_unclear`.

- **패치 → `writing_chats.structured_draft` 매핑 (데이터 모델 v3 2.5, R-02)**:

  | 모델 출력 | `structured_draft` | 서버 처리 |
  |-----------|--------------------|-----------|
  | `project_patches[]` (`name`/`role`/`team_size`/`start_month`/`end_month`/`summary`) | `project.{field}` 필드 객체(`value`, `origin = 'ai'`, `source_message_ids`, `source_quotes`, `review`, `reviewed_at`). 필드 키 = 저장 대상 컬럼명 | `start_month`/`end_month`는 `YYYY-MM` → 저장 시 date(1일), `team_size`는 smallint. **`origin = 'user_edit'` 또는 `review = 'accepted'`인 필드는 AI 패치가 덮어쓰지 않음**(RPC가 거부) |
  | `detail_patches[]` + `detail_key` | `details[]` 중 같은 `detail_key` 항목의 `fields.{field}` (`existing_detail_id = null`) | `new_details[]`의 `detail_key`로 `details[]` 항목 추가 |
  | `detail_patches[]` + `detail_ref` (`augment_project`) | `details[]` 중 `existing_detail_id = {DET-n의 UUID}` 항목의 `fields.{field}` (없으면 항목 생성) | **기존 상세 내용에서 이미 값이 있는 필드에 대한 패치는 거부**(V-9h) — `save_writing_chat`의 "빈 필드에만" 규칙과 같다 |
  | `achievements[]` | 해당 `details[]` 항목의 `achievements[]` (`metric_name`/`value_before`/`value_after`/`unit` 각각 필드 객체) | 4필드 모두 V-9c |
  | `skills[]` | 최상위 `skills[]` (`value`, `source_message_ids`, `source_quotes`) | 저장 시 `normalized_name`으로 기존 스킬 연결(데이터 모델) |
  | `affiliation_suggestion.ref` (`EXP-n`/`EDU-n`) | `affiliation_suggestion.id` (UUID) + `type` | AI는 제안만 출력한다. (v4.3) 제안은 이번 정리 대상 발화를 출처로 포함할 때만 낸다. (A15 — 확정 2026-11-05 (사용자)) [아니요]로 거절한 제안은 **저장하지 않는다** — 같은 제안이 뒤 턴에 다시 나올 수 있다. 보강 모드(`augment_project`)에서는 소속을 바꾸지 않으므로 제안을 내지 않는다. 사용자가 미리보기에서 [연결]·직접 선택하면 사용자 세션 RPC **`set_writing_chat_affiliation(writing_chat_id, experience_id, education_id)`**가 `writing_chats.experience_id`/`education_id`에 쓰고 `affiliation_suggestion`을 지운다, [아니요]면 제안만 지운다(R-28, T-19, V32-3). **확정 소속의 유일한 원천은 이 두 컬럼**이며 `structured_draft.project`에는 소속 키를 두지 않는다. 저장·폼 전환 RPC는 이 컬럼을 프로젝트 소속으로 쓴다 |
  | `clarifications[]` | `clarifications[]` (`detail_ref`는 `existing_detail_id`로 변환) | 해소되면 서버가 제거 |
  | `sensitive_flags[]` | `sensitive_flags_count`(개수만) | 내용은 저장하지 않음 |
  | 모든 `source_message_ids`의 `M-n` | `writing_chat_messages.id`(UUID) | **`M-n`은 호출 단위 별칭이며 저장 시 UUID로 변환**(A3-9) |
  | V-9e로 걸린 필드 | 필드 객체 `review = 'needs_review'` | 필드 객체 `review` ∈ `ok` / `needs_review` / `accepted` + `reviewed_at`(V32-1). [수락] → 사용자 세션 `apply_structured_draft_patch`가 `review = 'accepted'`, `reviewed_at` 기록(이어하기 때 복원). [거절] → 값을 비우고 `review = 'ok'` — **빈 필드가 되므로 AI-12는 그 슬롯을 다시 묻는다**. 저장·폼 전환 모두 남은 `needs_review` 필드를 건너뛴다(R-27·T-18) |

  - 응답(reply)은 구조화 출력 없이 텍스트 스트림이다.
- 저장 (데이터 모델 v3 2.5·3.3 확정):
  - `writing_chats`(`mode`(`new_project`/`augment_project`), `project_id`(보강 대상, 또는 저장·폼 전환으로 만들어진 프로젝트), `experience_id`/`education_id`(확정된 소속, 최대 1개), `status`(`active`/`saved`/`handed_off`/`abandoned`), `structured_draft`(jsonb, 위 매핑), `message_count`(사용자 + AI 합계, 시작 인사 제외, 상한 40), `last_extracted_sequence`, `last_activity_at`, `saved_at`). 컬럼 세부는 DM v4.2 §2.5.
  - `writing_chat_messages`(`writing_chat_id`, `sequence`, `role`(user/assistant), `content`, `status`(`streaming`/`done`/`failed`), `ai_job_id`). 사용자 메시지는 사용자 세션 RPC `append_writing_chat_message`가 상한 검사와 `message_count` 증가를 함께 처리한다. AI 응답 메시지는 `status = 'streaming'`으로 만들고 `done`/`failed`로 닫는다. **`failed` 응답은 다음 턴 입력에서 제외**하고 화면은 "다시 보내기"를 보인다(재시도는 같은 사용자 메시지에 대해 응답만 다시 생성하며 사용자 토큰을 쓴다, 메시지 수는 늘지 않음). 정리 호출만 실패하면 응답은 `done`으로 두고 다음 턴에 그 사용자 메시지까지 함께 정리한다. 기존 `chat_threads`/`chat_messages`(AI-09)와 별도 테이블.
  - 쓰기 주체: 대화 턴은 `app_ai_writer`가 **RPC `apply_structured_draft_patch`로만** `structured_draft`를 바꾼다(행 잠금, V-9h 검사, `user_edit`·`accepted` 필드 보호 — RPC가 강제). 그 밖에 `message_count`, `last_activity_at`, assistant 메시지만 쓴다. `structured_draft` 컬럼 직접 update는 누구에게도 허용되지 않는다(사용자 수정·수락·거절도 같은 RPC의 사용자 세션 호출). 소속은 `set_writing_chat_affiliation`(사용자 세션)만. **커리어 테이블 쓰기 권한은 AI 경로에 없다**(NFR-AI-05).
  - 필드 출처는 `evidence_links`가 아니라 `structured_draft`에 둔다(커리어 데이터를 만드는 과정의 기록이고, 저장 후 근거 링크의 원본은 커리어 항목 자체이기 때문).
  - **저장(사용자 "저장")**: AI 호출 없음. **사용자 세션 RPC `save_writing_chat(writing_chat_id)`**(V32-2, 인자 없음)가 `projects`/`project_details`/`achievements`/`skills`/`project_skills`에 쓴다. 남은 `needs_review` 필드는 건너뛰고(수락된 필드는 `review = 'accepted'`, T-18), `augment_project`는 기존 행의 빈 필드에만 쓰고 새 상세 내용은 insert(`existing_detail_id` 지정분은 그 행의 빈 필드). 소속은 `writing_chats.experience_id`/`education_id`(T-19). 완료 판정(C-1)에 따라 `complete` 또는 `draft`. 생성·수정 행에 `source_writing_chat_id`. `writing_chats.status = 'saved'`, `project_id`, `saved_at`. 저장 후 대화는 D-27 (a)대로 읽기 전용 보관(대화만 따로 삭제 가능).
  - **폼으로 전환(F-P1-13 (7), R-04)**: AI 호출 없음. 사용자가 전환을 확인하면 **사용자 세션 RPC `hand_off_writing_chat(writing_chat_id)`**가 정리 결과를 같은 커리어 테이블에 쓰고(완료 판정대로, 대부분 `draft`. 남은 `needs_review` 필드는 저장과 같은 규칙으로 건너뜀(T-18). 소속은 `writing_chats.experience_id`/`education_id`(T-19)), `writing_chats.status = 'handed_off'`, `project_id`를 채운다. 이후는 일반 폼 자동 저장(F-P1-06)이다.
  - **이어하기**: 메시지와 `structured_draft`를 불러와 다음 턴부터. `message_count` 누적. 키가 없거나 무효면 대화는 열람만 가능하고 새 메시지 전송 시 F-AI-08(PRD 3.3).
  - **그만두기**: `status = 'abandoned'`(대화·정리 결과는 D-27 규칙대로 보관 또는 사용자 삭제).
  - **(v4.3, A6 — 확정 2026-11-05 (사용자)) 그만둔 대화 다시 이어 하기**: 사용자가 "다시 이어 하기"를 누르면 `abandoned → active`로 바뀌고 이어하기와 같이 다음 턴부터 진행한다(`message_count` 누적, 상한 그대로). 90일 자동 정리 전까지만 가능하고, 재개는 사용자 동작이다(AI가 자동으로 재개하지 않음). `saved`·`handed_off`는 되돌리지 않는다.
  - `ai_jobs`: 턴 1회 = `job_type = 'writing_chat_turn'` 1행(`target_type = 'writing_chat'`, `progress.stage` = `extract`/`reply`), 보관 90일.
- 품질 기준 (NFR-AI-04 v3 평가 세트: 가상 사용자 대화 20건 이상 `[가정]`):
  - **날조 0%**: 저장 직전 정리 결과의 필드 중 사용자 발화에 없는 사실이 들어간 비율 0% (사람 검수 + V-9 로그). V-9 거부율도 함께 본다(거부가 많으면 추출 품질 문제).
  - 누락: 사용자가 말한 사실 중 정리 결과에 반영되지 않은 비율 15% 이하 `[가정]`.
  - 본인/팀 구분: "우리 팀"이 주어인 발화가 `action`에 그대로 들어간 사례 0건(되묻기 또는 `situation`).
  - 수치: 정량 성과 4필드가 발화와 정확히 일치 100%. 정도 표현만 있을 때 수치가 생성된 사례 0건.
  - 민감정보: 평가 세트의 민감정보 발화가 정리 결과에 들어간 사례 0건.
  - 대화 효율: 기본 정보 + S/A/R을 채우는 데 걸린 사용자 발화 수 중앙값 6 이하 `[가정]`. 사람 평가 "질문이 자연스럽고 다시 묻는 게 적절했다" 4/5 이상.
  - 평가 세트 구성: 협조적 사용자 / 한꺼번에 몰아서 말하는 사용자 / "우리 팀" 위주로 말하는 사용자 / 수치를 모르는 사용자 / 민감정보를 섞는 사용자 / AI에게 "알아서 그럴듯하게 채워 줘"라고 요구하는 사용자(→ 거절하고 질문해야 정답).
- 실패 유형·가드레일:
  - "알아서 채워 줘" 요구 → 응답은 정중히 거절하고 질문으로 돌아간다. 정리는 그 발화에서 패치를 만들지 않는다.
  - AI 질문 속 사실을 사용자가 "네"로 동의 → V-9a로 AI 발화는 출처가 될 수 없으므로 반영되지 않는다. 응답 프롬프트가 질문에 사실을 넣지 않게 한다.
  - 회사 기밀 수치(매출 등) → 저장은 사용자 판단이지만, 대화 시작 화면과 첫 AI 메시지에 기밀·민감정보 주의 안내(NFR-PRV-05).
  - 정리 호출 실패 → 응답은 계속, 다음 턴에 그 발화까지 포함해 다시 정리(직전 미처리 발화 ID 목록을 서버가 관리).
- 토큰·비용·지연 (턴당 = 사용자 발화 1개, 비용은 Claude 매핑 기준 사용자 부담 예상치):
  - 응답(기본 등급): 입력 평균 약 6k(대화가 늘수록 증가, 프리픽스 캐시 읽기 약 80%) ≈ $0.0035 + 출력 약 0.5k(사고 포함) ≈ $0.005 → 약 $0.0085
  - 정리(경량 등급): 입력 약 5k + 출력 약 0.4k → 약 $0.0007
  - 게이트 진입의 요건 목록(약 0.5k, 응답 호출에만, 프리픽스 캐시)은 턴당 약 $0.0002 추가 — 대화당 비용 변화 무시 가능(R-31)
  - **턴당 약 $0.009. 대화 1회: 일반 12턴 약 $0.11, 상한 20턴 약 $0.19.** 첫 글자 1~2.5초, 정리 갱신 2~5초.
- 결정: v3의 D-AI-10(월 10회)·D-AI-11(응답 모델)은 v4에서 폐기·대체(D-34, D-31) — 8장.

## 2. P2 기능 카드

### AI-01 JD 요건 추출
- 관련 기능: F-AP-01, F-P2-01, F-P2-02, (F-P2-03 Could) / 관련 화면: 지원 프로젝트 생성·JD 요건 확인 화면 (ux-planner 화면 ID 확정 후 기입)
- 목적: 붙여넣은 JD를 주요 업무·자격요건·우대사항·기술 키워드로 구조화하고, 각 요건이 원문 어느 문장에서 나왔는지 연결한다. 이후 지원 프로젝트의 모든 기능(AI-02~07, AI-11)이 이 결과를 공통 입력으로 쓴다. **v2에서 인사이트가 선택 행동이 되었으므로, 요건 추출 결과가 기능 간에 공유되는 유일한 AI 산출물이다.**
- 트리거 (v4, D-30): **활성 키가 있으면** 지원 프로젝트 생성(JD 저장) 직후 자동 1회. **키 없이 만든 JD**는 "요건 정리하기"를 누르거나 그 JD에서 첫 AI 기능(인사이트·서류·면접)을 실행할 때 선행한다. (v4.3, A13) 인사이트·면접(비동기)은 같은 작업의 첫 단계 `prepare`에서, 서류(동기·스트리밍)는 **화면이 추출 요청을 먼저 끝낸 뒤** 생성 요청을 보낸다(C-6). 추출 요청은 일반 재시도 경로에 들어가지 않고, 다시 시도는 같은 추출 요청을 새로 보내는 것이다. 키를 연결하는 순간 기존 JD를 일괄 추출하지 않는다(NFR-AI-08). 생성 후 JD 교체는 불가(D-19)이므로 재추출은 실패 재시도뿐이다. 추출된 회사명·포지션명으로 지원 프로젝트 이름("회사명 – 포지션명")을 채운다(사용자가 이미 이름을 입력했으면 덮어쓰지 않음). 커리어 데이터는 필요 없다.
- 입력 컨텍스트:

  | 원천 | entity.field | 필수 | 크기 추정 (토큰) |
  |------|--------------|------|-------------------|
  | JD | `job_descriptions.sentences` (서버 분할, C-2) | 필수 | 1.5k~3k (상한 8k) |
  | JD | `job_descriptions.company_name`, `job_descriptions.position_title` (사용자 입력값) | 선택 | 20 |
  | 프로필 | — | 넣지 않음 | — |

  경력 데이터는 넣지 않는다. 추출은 JD만의 작업이고, 사용자 데이터에 맞춰 요건이 왜곡되는 것을 막기 위해서다.
- 처리 방식: 단일 호출. 서버 전처리(문장 분할) → 모델 추출 → 서버 검증(문장 ID 존재, 요건마다 `source_sids` 1개 이상).
  - (v4.3, A16 — 확정 2026-11-05 (사용자)) **`seniority`의 연차 숫자는 검사하지 않는다.** 근거 문장(`source_sids`)이 실제로 있는지와 `min_years ≤ max_years`만 확인한다. 영문 "five years"처럼 숫자가 아닌 표기가 있어 숫자 대조가 오히려 정상 추출을 떨어뜨리기 때문이다.
  - (v4.3, 구현 반영) 회사명·포지션명은 근거 문장 ID가 JD에 있을 때만 쓰고, 없으면 값을 버린다. 문장이 0개인 원문(기호만 있음)은 모델을 부르지 않고 `not_a_jd`로 끝낸다(사용 기록 없음). 요건 0개 + `is_likely_jd = false`도 `not_a_jd`(재시도 없음), 요건 0개 + `is_likely_jd = true`는 1회 재시도 후 `schema_invalid`.
  - (v4.3) `requirements_hash`는 요건의 `category`·`content`·`source_sids`·`importance`로 계산한다(중요도는 뒤 기능 프롬프트에 "중요"로 들어가 출력에 영향을 준다). 행 id는 넣지 않는다. 출력 상한은 C-14.
- 모델: **경량 등급**, 낮은 사고 설정. 이유: 근거 문장 ID를 붙이는 추출·분류 작업이고, 기본 등급보다 훨씬 저렴하다. 출시 전 평가 세트(7장)에서 요건 재현율이 기준에 못 미치면 기본 등급로 올린다(비용 영향 미미: 건당 약 $0.03).
- 응답 모드: **동기**. p90 15초 목표. 화면은 "공고를 분석하고 있어요" 스피너 후 결과 표시.
- 프롬프트 전략:
  - 역할: 한국 채용 공고 구조화 담당.
  - 핵심 지시: 원문에 있는 요건만 추출한다. 하나의 문장에 여러 요건이 있으면 나눈다. 같은 요건이 반복되면 합친다. 카테고리 기준(주요 업무 = 하게 될 일, 자격요건 = 필수, 우대사항 = 우대·플러스)을 명시한다. "~년 이상" 경력 조건은 `seniority`로 분리한다. 회사 소개·복리후생·채용 절차 문장은 요건이 아니라 `other_sids`로만 분류한다.
  - 근거 인용: 요건마다 `source_sids` 필수.
  - 영문 JD: `text`는 한국어 요약, `keywords`는 원문 표기 유지.
  - few-shot: 필요 없음(스키마로 충분). 카테고리 경계 사례 2개만 포함.
- 출력 스키마:
  ```json
  {
    "schema_version": 1,
    "detected_language": "ko",
    "is_likely_jd": true,
    "company_name": { "value": "에이비씨페이", "source_sids": ["S1"] },
    "position_title": { "value": "백엔드 엔지니어 (결제)", "source_sids": ["S1"] },
    "seniority": { "min_years": 5, "max_years": null, "label": "5년 이상", "source_sids": ["S9"] },
    "requirements": [
      {
        "category": "responsibility",
        "text": "결제 승인·정산 API 설계 및 운영",
        "keywords": ["결제", "API"],
        "importance": "high",
        "source_sids": ["S4"]
      },
      {
        "category": "required",
        "text": "Java/Kotlin 기반 Spring 서버 개발 경험",
        "keywords": ["Java", "Kotlin", "Spring"],
        "importance": "high",
        "source_sids": ["S8"]
      }
    ],
    "tech_keywords": [ { "keyword": "Kafka", "source_sids": ["S12"] } ],
    "other_sids": ["S2", "S3", "S20"],
    "warnings": []
  }
  ```
  - `category`: `responsibility` | `required` | `preferred`
  - `importance`: `high` | `normal` (반복 언급, "필수" 표기, 문서 앞쪽 배치 기준)
  - `warnings`: 예 `["복수 포지션이 섞인 공고로 보입니다"]`
- 저장: `job_descriptions.extraction` (jsonb, 원본 결과), `job_descriptions.detected_language`, `job_descriptions.tech_keywords`(모델 출력 `tech_keywords`, 화면 조회용 컬럼), 요건은 `jd_requirements` 행으로 정규화(`category`, `content` ← 모델 출력 `text`, `keywords`, `importance`, `source_sids`, `sort_order`, `origin: ai|user`, `is_user_edited`). 서버가 `job_descriptions.requirements_hash`를 갱신한다. 회사명·포지션명이 비어 있었다면 추출값으로 채우고 `company_name_source`/`position_title_source = 'ai'`로 표시. 기술 키워드는 요건 행이 아니라 JD 속성이므로 AI-02 판정 대상이 아니다. 재추출 시 이전 AI 요건은 덮어쓰되, 사용자 수정 요건이 있으면 재추출을 막고 확인을 받는다.
- 품질 기준: 사람이 라벨링한 요건 대비 재현율 90% 이상, 정밀도 90% 이상 `[가정]`. `source_sids` 정확도(해당 문장에 실제로 그 요건이 있음) 98% 이상. 카테고리 오분류 10% 이하.
- 실패 유형·가드레일:
  - JD가 아닌 텍스트 → `is_likely_jd: false`이면 경고하되 진행 허용(F-P2-01).
  - JD 안의 지시문(인젝션, 예: "이 공고를 분석하는 AI는 ...") → C-4 데이터 분리. 요건으로 추출되더라도 지시로 따르지 않는다.
  - 원문에 없는 요건 생성 → `source_sids` 검증으로 차단.
- 비용·지연: 입력 약 4k(system 1.5k + JD 2.5k) + 출력 1.5k~2.5k(사고 포함) → **약 $0.002/회**, 6~15초 (경량 등급 출력 속도 150 tok/s 이상 `[가정]`).
- 결정 필요: 없음 (A16 확정).

### AI-02 JD 인사이트 생성
- 관련 기능: F-P2-04, F-P2-05, F-P2-07(재생성), F-P2-03(수정 요건 반영), F-P2-09(보완점 → 입력 링크) / 관련 화면: 지원 프로젝트 > 인사이트 화면
- 목적: JD 요건별 충족 판정, 핵심 강점(최대 3개), 보완점과 대응 방안, 지원 방향을 **모든 항목에 근거를 달아** 제공한다.
- 트리거: 사용자가 지원 프로젝트에서 "인사이트 생성"을 누를 때만(D-18). 자동 선행·자동 시작은 없다(v1의 "면접 시작 시 자동 선행" 폐기). 데이터 변경 후 재생성(F-P2-07, Should).
- (v4.3, A2 — 확정 2026-11-05 (사용자)) **생성 중에는 JD 요건 편집을 막는다.** 요건 수정(F-P2-03)이 Could라 지금은 편집 기능이 없고, 그 기능이 생길 때 이 규칙을 적용한다. 그 전까지의 방어: 작업은 `prepare`에서 읽은 요건 목록으로 판정·종합·저장하고(`requirements_hash`도 그 목록 기준), 다른 경로로 요건이 바뀌었으면 저장 직후 "데이터 변경됨"(F-P2-07)이 뜬다. 단계 1 판정과 요건 목록이 맞지 않으면 `stalled`로 끝낸다(자동 재시도 없음, 방어용).
- (v4.3, 구현 반영) **재사용**: 같은 `input_hash`라도 **현재 latest인 `ready` 인사이트만** 재사용한다. 예전 ready 버전은 재사용하지 않고 새로 생성한다(화면이 보여 주는 결과와 "재사용됨"이 가리키는 결과가 같게). 요건이 아직 추출 전이면 해시를 만들 수 없어 재사용 판정 없이 시작한다. 저장 해시(`career_snapshot_hash`·`requirements_hash`·`input_hash`)는 `prepare` 시점 값이다.
- 다른 기능과의 관계: 인사이트는 어떤 기능의 선행 조건도 아니다. AI-03·AI-04·AI-05는 인사이트가 있으면 `strategy`·`gaps`를 **참고 신호**로만 읽고, 없으면 같은 판단을 스스로 한다.
- 입력 컨텍스트:

  | 원천 | entity.field | 필수 | 크기 추정 (토큰) | 사용 단계 |
  |------|--------------|------|-------------------|-----------|
  | 경력 팩 | C-1 전체 | 필수 | 6k (3k~15k) | 1, 2 |
  | JD 요건 | `jd_requirements.*` (별칭 REQ-n) | 필수 | 1k~1.5k | 1, 2 |
  | JD 원문 문장 | `job_descriptions.sentences` 중 각 요건의 `source_sids` 문장 | 필수 | 0.5k~1k | 1 |
  | JD 메타 | `job_descriptions.position_title`, `job_descriptions.extraction.seniority` | 선택 | 50 | 1, 2 |
  | 단계 1 결과 | 요건 매칭 결과 | 필수 | 2k~3k | 2 |
- 처리 방식: **2단계 체인**.
  1. **요건 매칭** (단계 1): 요건을 최대 8개씩 배치로 나눠 병렬 호출 `[가정]`(요건 15개면 2배치). 각 요건에 `met | partial | no_evidence` 판정 + 경력 근거 + 판정 이유 + 부족한 측면.
  2. **종합** (단계 2): 매칭 결과를 입력으로 강점(최대 3), 보완점(+대응 방안), 지원 방향(포지셔닝, 어필 프로젝트 우선순위)을 만든다.
  - 체인으로 나누는 이유: 단계 1 결과는 그 자체로 화면(요건별 판정 표)에 쓰이고, 인사이트가 있을 때 AI-03(관련 항목 우선 배치)·AI-05(보완점 질문)가 참고 신호로 읽을 수 있다(필수 아님). 중간 결과가 근거로 남아 평가·디버깅이 쉽다. 단일 호출보다 출력 길이를 나눠 지연 목표를 맞추기 쉽다.
  - 서버 검증(C-3)은 각 단계 직후 실행. 단계 2의 강점·지원 방향은 단계 1에서 `met`/`partial` 판정된 요건과 그 근거만 사용할 수 있도록 지시하고, 서버도 `requirement_refs`가 `no_evidence` 요건만 가리키는 강점을 제거한다.
  - (v4.3, 구현 반영) **두 단계가 같은 system 블록을 쓴다.** C-8 프리픽스 순서상 단계별로 system이 다르면 단계 2가 단계 1의 경력 팩 캐시를 읽지 못한다(비용 추정의 "경력 팩 캐시 읽기"가 성립하지 않음). 두 단계 규칙을 AI-02 system 블록 하나에 넣고, 마지막 user 블록이 이번 단계를 알린다. `prompt_version`은 호출별(`ai-02.match.v2+common.v1`, `ai-02.synthesize.v2+common.v1`), 저장값은 이어 붙인 값.
  - (v4.3, 구현 반영) **모델이 빠뜨린 요건**: 배치 안 요건을 판정하지 않으면 서버가 `no_evidence` + 근거 없음 + 고정 이유("입력된 데이터에서 이 요건을 뒷받침하는 근거를 찾지 못했습니다.")로 채운다. 배치에 없는 요건 참조와 같은 요건의 두 번째 판정은 버린다. V-4로 `no_evidence`가 된 판정의 이유도 같은 고정 문구로 바꾼다(모델 이유는 떨어진 근거를 전제로 쓰였으므로). `met` → `partial` 강등은 이유를 두고, 부족한 측면이 비었으면 "본인이 한 행동·결과 또는 성과로 확인되는 서술"을 넣는다.
  - (v4.3, 구현 반영) 단계 2는 첫 종합과 V-5 재생성(`synthesize_regen`)이 각각 작업 단계 1개다. 무료 등급 간격·호출별 재시도가 재생성에도 적용된다. 강점은 `met`/`partial` 요건 참조만 남기고(없으면 강점 제거), 보완점은 `partial`/`no_evidence` 요건만 남기며 `gap_kind`는 서버가 다시 정한다(하나라도 `no_evidence`면 `no_evidence`). 우선순위는 실재하는 프로젝트만, 같은 프로젝트는 1번, 1..n으로 다시 매긴다.
- 모델: **기본 등급**. 단계 1 낮은 사고 설정(요건 단위 판단, 지연 우선), 단계 2 중간 사고 설정(종합 판단). 이유: 의미 단위 대조와 포지셔닝 문장은 서비스 차별점이며 Haiku로는 판정 경계 품질이 불안하다 `[가정]`. Opus는 기본으로 쓰지 않는다. 평가 세트에서 단계 2 만족도가 기준 미달이면 단계 2만 고성능 등급로 올리는 것을 검토한다(건당 +약 $0.04).
- 응답 모드: **비동기 작업** (무료 등급은 배치 순차, C-12). 진행 단계(C-6): `prepare` → `match`(배치 진행 `done/total`, 예: 1/2 → 2/2) → `synthesize`(필요할 때만 `synthesize_regen`) → `validate` → 완료. 단계별 화면 문구는 UX C-03 기준. 단계 1 결과가 나오면 **요건별 판정 표를 먼저 보여 줄 수 있다**(부분 결과 표시, ux-planner 판단). 10초 안에 첫 진행 표시(PRD 6.3).
- 프롬프트 전략:
  - 역할: 경력직 채용 서류 검토 경험이 많은 커리어 코치. 판단은 "입력된 데이터 기준"이라고 전제.
  - 판정 기준(단계 1): `met` = 요건을 직접 뒷받침하는 **상세 내용의 행동(A)·결과(R) 또는 성과**가 있음(본인 기여). 상황(S)·과제(T)만 근거이거나(팀 맥락일 수 있음) 스킬 태그만 근거이면 최대 `partial`. 회고 및 배운 점(`learnings`)은 판정 근거로 쓰지 않는다(V-8). (v4.3, A10) 프로필의 희망 직무·관심 산업도 판정·강점·포지셔닝의 근거로 쓰지 않는다 — "이 사람이 무엇을 원하는가"의 문맥 참고일 뿐 경험의 사실이 아니다. `partial` = 관련 경험은 있으나 범위·깊이·연차·본인 기여 중 하나가 불명확하거나 부족. `no_evidence` = 관련 데이터를 찾지 못함. 스킬 태그만 있고 프로젝트 서술이 없으면 최대 `partial`. 연차 요건은 `profiles.total_years_of_experience`와 경력 기간으로 판정. 경계 사례 3개를 few-shot으로 넣는다.
  - 근거 인용: `met`/`partial`은 경력 근거 1개 이상 필수(quote 포함). 모든 판정은 `requirement_ref`로 JD 요건과 연결.
  - 보완점(단계 2): `no_evidence`·`partial` 요건에서 고른다. 대응 방안은 세 종류로 제한: `add_data`(관련 경험이 있으면 입력 — F-P2-09 링크), `reframe`(기존 경험을 이 요건 관점으로 설명하는 방법, 근거 필수), `prepare_answer`(면접에서 질문받을 때의 대비 포인트). "공부하세요" 같은 일반론은 금지.
  - 지원 방향: 포지셔닝 1~2문장(근거 필수), 어필 프로젝트 우선순위(최대 5개, 각각 관련 요건과 이유).
  - 금지: 합격 가능성·확률·점수 표현(NFR-AI-03), 전체 적합도 점수(D-05 권고안 b).
- 출력 스키마:

  단계 1 (배치마다):
  ```json
  {
    "schema_version": 1,
    "matches": [
      {
        "requirement_ref": "REQ-2",
        "status": "partial",
        "rationale": "Spring 기반 결제 API 개발 경험은 있으나 Kotlin 사용 근거가 없습니다.",
        "missing_aspect": "Kotlin 사용 경험",
        "evidence": [
          { "source_type": "project_detail", "ref": "DET-5", "field": "action", "quote": "Spring Boot로 결제 승인 API를 설계했다" },
          { "source_type": "skill", "ref": "SKL-1", "field": "name" }
        ]
      }
    ]
  }
  ```

  단계 2 및 최종 저장 형태:
  ```json
  {
    "schema_version": 1,
    "basis_note": "입력된 경력 데이터 기준 분석입니다",
    "data_sufficiency": { "level": "ok", "hints": [] },
    "requirement_matches": [ "…단계 1 matches를 요건 순서대로 병합…" ],
    "summary_counts": { "met": 6, "partial": 4, "no_evidence": 2 },
    "strengths": [
      {
        "title": "대규모 결제 트래픽 성능 개선",
        "description": "결제 승인 API 응답 시간을 1.2초에서 0.7초로 줄인 경험이 JD의 결제 API 운영 요건과 직접 맞닿습니다.",
        "requirement_refs": ["REQ-1", "REQ-4"],
        "evidence": [
          { "source_type": "achievement", "ref": "ACH-2", "field": "metric" },
          { "source_type": "jd_requirement", "ref": "REQ-1" }
        ]
      }
    ],
    "gaps": [
      {
        "requirement_refs": ["REQ-7"],
        "gap_kind": "no_evidence",
        "description": "Kafka 기반 이벤트 처리 경험이 입력된 데이터에서 확인되지 않습니다.",
        "actions": [
          { "type": "add_data", "text": "메시지 큐를 다룬 프로젝트가 있다면 추가해 주세요." },
          { "type": "prepare_answer", "text": "비동기 처리 설계 경험을 묻는 질문에 대비해 '정산 시스템 재구축' 프로젝트의 재시도 큐 설계를 정리해 두세요.", "evidence": [ { "source_type": "project_detail", "ref": "DET-5", "field": "action", "quote": "실패 건 재시도 큐를 설계했다" } ] }
        ],
        "evidence": [ { "source_type": "jd_sentence", "ref": "S12" } ]
      }
    ],
    "strategy": {
      "positioning": "결제 도메인에서 성능과 안정성을 수치로 개선해 온 백엔드 엔지니어로 포지셔닝합니다.",
      "positioning_evidence": [ { "source_type": "achievement", "ref": "ACH-2", "field": "metric" } ],
      "project_priorities": [
        { "rank": 1, "ref": "PRJ-3", "reason": "결제 API 운영 요건과 가장 직접적으로 연결", "requirement_refs": ["REQ-1", "REQ-2"] }
      ]
    }
  }
  ```
  - `status`: `met` | `partial` | `no_evidence` (화면 표기: 충족 / 부분 충족 / 근거 없음)
  - `strengths`: 0~3개. 근거가 충분한 강점이 없으면 빈 배열 허용(억지로 3개를 채우지 않는다).
  - `gaps[].actions[].type`: `add_data` | `reframe` | `prepare_answer`. `reframe`·`prepare_answer`는 `evidence` 필수.
  - `summary_counts`는 서버가 계산(모델 출력 아님).
  - `data_sufficiency.level`: `ok` | `thin`(프로젝트 2개 이하 또는 정량 성과 0개 등 규칙 기반, 서버 계산). `hints`는 서버 고정 문장(C-14).
  - (v4.3) 문장 필드(`rationale`, `description`, `actions[].text`, `positioning`, `reason`)에는 별칭을 쓰지 않는다. 위 예시처럼 프로젝트·요건은 이름·내용으로 쓰고, 서버가 남은 별칭을 표시 이름으로 바꾼다(C-3 "저장 키와 표시 문장").
- 저장: `insights` 테이블에 생성 단위로 행 추가(이력 보존). 필드: `application_project_id`, `version_no`, `is_latest`, `status`(job 상태), `result`(jsonb, 위 최종 형태), `match_stage_result`(jsonb, 단계 1 원본), `career_snapshot_hash`, `requirements_hash`, `schema_version`, `prompt_version`, `model`, `input_hash`, `validation_report`, `usage`(토큰 수), `ai_job_id`. `result`에는 evidence 배열을 넣지 않고 항목별 `item_key`만 남긴다(근거는 `evidence_links`, `owner_type = 'insight'`). 별칭 참조는 UUID 키로 이름을 바꿔 저장한다(`requirement_ref` → `requirement_id`, `requirement_refs` → `requirement_ids`, `project_priorities[].ref` → `project_id`). 각 항목에 `item_key`가 있고, `strategy.positioning`은 문자열 그대로 두고 키는 `strategy.positioning_item_key`에 둔다. (v4.3) `match_stage_result`는 근거를 뺀 단계 1 병합본(`requirement_id`, `status`, `model_status`, `rationale`, `missing_aspect`) + 단계 1 `prompt_version`·배치 정보다(C-3: 결과 jsonb에 근거 없음). 실패 작업의 수동 재시도는 새 버전을 만들지 않고 같은 행(같은 `version_no`)을 다시 연다. 재생성 시 새 행 + 이전 행 `is_latest=false`(`is_latest`는 `ready` 행에만). 이전 버전 열람은 Could지만 행은 남긴다.
- 품질 기준:
  - 근거 검증 통과율(V-1~V-3) 98% 이상, 근거 없는 주장 비율 2% 이하(PRD 7장).
  - 판정 일치도: 사람 평가자 판정과 3단계 일치 80% 이상, `met`↔`no_evidence` 정반대 불일치 3% 이하 `[가정]`.
  - 강점·지원 방향 사람 평가 "구체적이고 내 데이터에 맞다" 4/5 이상 `[가정]`.
  - 대응 방안 중 일반론(근거·구체 행동 없는 문장) 0건.
- 실패 유형·가드레일:
  - 스킬 태그나 상황·과제만으로 `met` 판정 → 판정 기준 + 서버 규칙(근거에 `action`/`result`/`achievement`가 없으면 `partial`로 강등).
  - 연차 요건 오판 → 연차는 서버가 경력 기간으로 계산한 값을 팩에 함께 넣는다(`computed_total_months`).
  - 같은 프로젝트를 모든 강점에 반복 → 지시 + 강점 간 근거 중복이 전부 같으면 경고 로그(품질 모니터링).
  - 단계 1 배치 일부 실패 → 해당 배치만 재시도, 그래도 실패하면 작업 실패(부분 인사이트는 저장하지 않음 `[가정]`).
- 비용·지연 (일반: 경력 팩 6k, 요건 12~15개 → 2배치):
  - 단계 1: 배치당 입력 11.5k + 출력 2k(사고 포함) × 2 → 입력 23k($0.046) + 출력 4k($0.040)
  - 단계 2: 입력 11k(그중 경력 팩 6k 캐시 읽기) ≈ $0.011 + 출력 3k($0.030)
  - **합계 약 $0.13/회** (경력 팩 15k 사용자는 약 $0.20). 지연: 단계 1 병렬 15~25초 + 단계 2 15~20초 = **30~45초** (기본 등급 출력 속도 60~100 tok/s `[가정]`, 공급자별 실측 필요). PRD 목표 p90 40초는 경계선이므로, 구현 초기에 실측하고 넘으면 단계 1 배치를 더 잘게 나눈다(비용 소폭 증가).
- 결정 필요: 없음 (D-05 권고안 b를 전제로 설계. 권고안이 바뀌면 `summary_counts`를 등급으로 바꾸는 정도의 수정).

---

## 3. DOC 기능 카드

### AI-03 경력기술서 초안
- 관련 기능: F-DOC-01, F-DOC-03, F-DOC-04, (F-DOC-05 다시 쓰기) / 관련 화면: 경력기술서 초안 화면
- 목적: 특정 JD에 맞춰 경력별 → 프로젝트별(역할, 기여, 성과) 구조의 경력기술서 초안을 만들고, 모든 문장을 경력 데이터에 연결한다.
- 트리거: 사용자가 포함할 경력·프로젝트를 확인하고 "초안 생성"을 누를 때. **기본 선택**은 (1) 최신 인사이트가 있으면 `strategy.project_priorities`, (2) 없으면 AI-11 관련도 정렬 결과, (3) (v4.3, A23 — 확정 2026-11-05 (사용자)) AI-11이 실패하면 **기본 선택 없음** — 체크 없이 사용자가 직접 고르고 `selection_origin = user`. 사용자가 체크를 바꾸면 그 목록이 우선한다.
- (v4.3, A13) **요건이 아직 없으면 화면이 AI-01 추출을 먼저 끝낸 뒤 생성 요청을 보낸다.** 생성 요청 안에서는 추출하지 않는다(C-6). 생성 요청이 왔는데 요건이 없으면 공급자 호출 없이 거부한다.
- (v4.3) 같은 지원 프로젝트에서 경력기술서 생성은 동시에 1개만 돈다(두 번째 요청은 "이미 만들고 있어요", DM v4.2). "다시 생성"이 아니고 같은 `input_hash`(공급자·모델·커리어·요건·정규화한 옵션·tone)의 `ready` 초안이 있으면 호출 없이 그 초안을 보여 준다(C-6 재사용).
- 입력 컨텍스트:

  | 원천 | entity.field | 필수 | 크기 추정 (토큰) |
  |------|--------------|------|-------------------|
  | 경력 팩 | C-1 중 **사용자가 선택한 경력·프로젝트와 그 성과·스킬만** | 필수 | 3k~6k |
  | JD 요건 | `jd_requirements.*` | 필수 | 1k~1.5k |
  | 인사이트 | `insights.result.strategy`, `requirement_matches`(status·ref만) | **선택 — 참고 신호** (없으면 생략, 품질 기준은 없는 경우로 잡는다) | 0.5k~1k |
  | 기본 선택 근거 | AI-11 `rankings`(관련 요건 ref) | 선택 | 0.2k~0.5k |
  | 사용자 선택 | `drafts.options.included_experience_ids`, `drafts.options.included_education_ids`, `drafts.options.included_project_ids`, `drafts.options.project_order` | 필수 | 50 |
  | 사용자 지시 | `drafts.options.tone` — (v4.3, A17 — 확정 2026-11-05 (사용자)) `concise`(간결) / `detailed`(상세) 두 값. 그 밖의 값은 프롬프트에 넣지 않고 무시한다(사용자 입력은 정해진 값만, C-4). 값이 없으면(null) `concise`로 보고 프롬프트와 `input_hash`에 같은 값으로 넣는다(DM v4.2 2.7, R-60) | 선택 | 20 |
- 처리 방식: 단일 호출 + 서버 후처리.
  - **머리글은 서버가 채운다**: 회사명·재직 기간·직급·프로젝트 기간은 모델이 쓰지 않고 데이터에서 그대로 넣는다(오타·날조 원천 차단). 모델은 경력 요약 한 줄, 프로젝트별 역할 한 줄, 기여·성과 불릿만 쓴다.
  - 섹션: 포함된 경력마다 경력 섹션, 포함된 교육마다 **교육 섹션**(F-DOC-01 v3 "교육 아래 프로젝트도 고를 수 있다"), 소속 없는 프로젝트는 독립 프로젝트 섹션. 섹션 순서는 경력(최신순) → 교육(최신순) → 독립 프로젝트 `[가정]`(경력직 서류 관행).
  - 배치 순서: 경력은 최신순(국내 관행 `[가정]`), 경력 안의 프로젝트는 JD 관련성 순(사용자 지정 순서 → AI-11 순위 또는 인사이트 우선순위 → 모델 판단 + `requirement_refs`). 본문 근거는 선택된 항목 안으로 제한한다(V-7).
  - 불릿 수 상한: 프로젝트당 최대 4개, 프로젝트 최대 8개 `[가정]` (출력 길이·지연 통제). 8개 초과 선택의 처리는 C-14.
  - (v4.3, 구현 반영) 근거 범위(V-7): 경력기술서 근거는 **선택된 항목의 커리어 근거만** 남긴다. JD 요건·문장을 근거로 달면 범위 밖으로 제거한다(`requirement_refs`는 유지). JD 근거만 단 불릿은 근거 0개 → `evidence_check_needed`. 모델이 다른 섹션에 넣은 프로젝트는 실제 소속 섹션으로 옮기고, 선택되지 않은 프로젝트·경력은 버린다. 출력이 없는 선택 프로젝트도 서버 머리글은 남긴다.
  - (v4.3) V-5 위반은 재생성하지 않고 바로 치환 + `number_check_needed`(C-3 "V-5 비교 규칙과 예외").
- 모델: **기본 등급**, 낮은 사고 설정. 이유: 한국어 문서 품질과 근거 준수의 균형. 첫 글자 지연을 줄이기 위해 effort를 낮춘다.
- 응답 모드: **스트리밍 (블록 단위)**. 블록 = 경력 요약 / 프로젝트 역할 줄 / 불릿 하나. `block_completed` 시점에 해당 블록의 근거 칩을 붙이고, 전체 완료 후 수치 가드(V-5) 결과로 배지를 갱신한다. 목표: 첫 블록 5초 이내, 완료 60초 이내. (v4.3) 스트리밍 중 블록 이벤트의 블록 id는 모델 id다. 최종 블록 id(서버가 형식·중복을 고친 값, 머리글 `h<섹션>`)는 `validated`에서 확정되므로 **화면은 `validated`에서 블록을 통째로 바꾼다.** 연결이 끊겨도 서버는 생성·저장을 끝까지 하고 사용 기록을 남긴다(중지는 취소 요청과 시간 예산뿐) — 결과는 끝난 뒤 조회로 본다.
- 프롬프트 전략:
  - 역할: 국내 경력직 경력기술서 작성 전문가.
  - 핵심 지시: 사실은 데이터에서만. 불릿의 재료는 **상세 내용의 행동(A) + 결과(R) + 연결 성과**(PRD F-DOC-01 v3). 상세 내용 1개가 불릿 1~2개가 된다. "행동 + 대상 + 결과(수치)" 형태를 권장하되 수치가 없으면 `[수치 입력 필요]`. 상황(S)·과제(T)는 불릿 앞 맥락 구절로만 쓰고 그 내용을 본인 행동으로 바꿔 쓰지 않는다. 회고 및 배운 점은 경력기술서에 쓰지 않는다(V-8). JD 키워드는 데이터에 같은 의미의 근거가 있을 때만 쓴다(키워드 끼워 넣기 금지). 문체는 개조식 명사형 종결(예: "~설계 및 구현").
  - 근거 인용: 불릿마다 `evidence` 1개 이상, `requirement_refs`(관련 JD 요건) 0개 이상.
  - few-shot: 불릿 문체 예시 1개(가상 데이터).
- 출력 스키마:
  ```json
  {
    "schema_version": 1,
    "draft_type": "career_description",
    "sections": [
      {
        "experience_ref": "EXP-1",
        "summary": {
          "block_id": "e1-s",
          "text": "결제 플랫폼 백엔드 개발 및 운영 담당",
          "evidence": [ { "source_type": "experience", "ref": "EXP-1", "field": "summary", "quote": "결제 플랫폼 백엔드 개발" } ],
          "placeholders": []
        },
        "projects": [
          {
            "project_ref": "PRJ-3",
            "role_line": {
              "block_id": "p3-r",
              "text": "백엔드 리드 (4인 팀)",
              "evidence": [ { "source_type": "project", "ref": "PRJ-3", "field": "role" }, { "source_type": "project", "ref": "PRJ-3", "field": "team_size" } ],
              "placeholders": []
            },
            "bullets": [
              {
                "block_id": "p3-b1",
                "text": "결제 승인 API 구조 개선으로 응답 시간 1.2초 → 0.7초 단축",
                "evidence": [ { "source_type": "achievement", "ref": "ACH-2", "field": "metric" } ],
                "requirement_refs": ["REQ-1"],
                "placeholders": []
              },
              {
                "block_id": "p3-b2",
                "text": "정산 배치 재설계로 처리 시간 [수치 입력 필요] 단축",
                "evidence": [ { "source_type": "project_detail", "ref": "DET-5", "field": "action", "quote": "정산 배치를 재설계했다" } ],
                "requirement_refs": ["REQ-3"],
                "placeholders": [ { "token": "[수치 입력 필요]", "hint": "정산 배치 처리 시간의 개선 전후 값" } ]
              }
            ]
          }
        ]
      }
    ],
    "education_sections": [
      {
        "education_ref": "EDU-1",
        "summary": null,
        "projects": [ { "project_ref": "PRJ-7", "role_line": { "block_id": "p7-r", "text": "…", "evidence": [ { "source_type": "project", "ref": "PRJ-7", "field": "role" } ], "placeholders": [] }, "bullets": [ "…경력 섹션과 같은 형식…" ] } ]
      }
    ],
    "standalone_projects": [],
    "omitted": [ { "ref": "PRJ-5", "reason": "user_excluded" } ],
    "notes_for_user": ["'정산 배치 개선' 프로젝트는 성과 수치가 없어 자리 표시를 넣었습니다."]
  }
  ```
  - 저장 시 서버가 `header`를 데이터에서 채워 넣는다: 경력 섹션(회사명, 기간, 직급/직책), **교육 섹션(기관명, 과정명, 기간, 재학 상태)**, 프로젝트(프로젝트명, 기간). 모델은 머리글을 쓰지 않는다.
  - `education_sections[].summary`는 교육의 `description`이 있을 때만 한 줄(근거 필수), 없으면 null.
  - `omitted[].reason`: `user_excluded` | `low_relevance`
  - (v4.3, A21 — 확정 2026-11-05 (사용자)) **`omitted`·`notes_for_user`는 저장하지 않는다.** 생성 직후 화면(`validated` 이벤트)에서만 보이고, 초안을 다시 열면 보이지 않는다. `notes_for_user` 문장에도 별칭을 쓰지 않는다(위 예시처럼 프로젝트명).
- 저장: `drafts` 행(`application_project_id`, `draft_type = 'career_description'`, `options`(+ `selection_origin`: `insight` | `ai_ranking` | `user`, `ranking`(AI-11 결과 복사)), `insight_id`(참고한 경우만, nullable), `status`, `edited_at`, AI 출력 공통 메타) + 섹션별 `draft_sections` 행(`section_kind = 'experience'` + `experience_id` / **교육 섹션은 `section_kind = 'education'` + `education_id`** / 독립 프로젝트는 `'standalone_projects'`, `sort_order`, `heading`). 섹션마다 `ai_content`(블록 배열 jsonb, AI 원본 — **변경 불가**) / `edited_content`(사용자 편집본, `block_id` 유지). 모델 출력의 `summary`/`role_line`/`bullets`는 저장 시 `blocks[]`(`block_kind` = `header`(서버가 데이터로 채움)/`summary`/`role_line`/`bullet`, `project_id`, `requirement_ids`, `placeholders`, `flags`)로 평탄화하고 evidence는 `evidence_links`(`owner_type = 'draft_section'`, `item_key = block_id`)로 옮긴다. V-4/V-5 결과는 블록 `flags`(`evidence_check_needed`, `number_check_needed`)로 남긴다. 편집된 블록은 `user_modified: true`로 표시하고 근거는 원래 블록 근거를 유지하되 "편집됨 — 근거 재확인 권장"으로 보여 준다. 재생성은 새 `drafts` 행(이전 행 보존, 이전 버전 열람은 Could).
- 품질 기준: 수치 가드 위반 0건(최종 저장본 기준), 근거 없는 블록 0건, 자리 표시가 필요한 자리에서 수치 날조 0건(평가 세트에서 성과 수치를 일부 지운 프로필로 검증), 사람 평가 "그대로 쓰거나 조금만 고치면 쓸 수 있다" 60% 이상 `[가정]`.
- 실패 유형·가드레일: 키워드 끼워 넣기(데이터에 없는 기술명) → V-5와 별도로 "스킬명 가드": 출력 텍스트의 기술 키워드가 경력 팩 스킬·서술에 없으면 블록 플래그. 팀 성과를 본인 성과로 바꿔 쓰기 → 근거가 `situation`/`task`뿐인 "본인 주어" 불릿은 서버가 `evidence_check_needed`로 표시하고 평가 세트에서 집중 점검. 스트리밍 중단·생성 실패 → (v4.3, A4 — 확정 2026-11-05 (사용자)) **블록을 보존하지 않는다.** 실패한 초안은 블록 없이 `failed`로 표시하고, "다시 시도"는 새 `drafts` 행으로 처음부터 생성한다("이어서 생성" 없음, MVP 단순화). 스트리밍 중 화면에 보였던 블록도 실패 후에는 남기지 않는다. 사용자 취소·외부 삭제(커리어 결과 삭제, 초안·프로젝트 삭제)로 중지되면 `canceled`로 끝나고 실패 안내를 보이지 않는다(이미 쓴 토큰은 사용 기록에 남음).
- 비용·지연: 입력 약 10.5k + 출력 약 5k(본문·근거 JSON·사고 포함) → **약 $0.07/회**. 첫 블록 3~6초, 완료 40~60초.
- 결정 필요: 없음.

### AI-11 경력기술서 기본 선택 (관련도 정렬) — v2 신설
- 관련 기능: F-DOC-01 / 관련 화면: 경력기술서 포함 항목 선택 화면
- 목적: 인사이트가 없어도 "JD 요건과 관련도가 높은 경력·프로젝트"를 기본으로 체크해 보여 준다(F-DOC-01 "기본 선택은 AI가 JD 요건과의 관련도로 정한다").
- 트리거: 경력기술서 화면에 들어갈 때 최신 인사이트가 없고, 이 지원 프로젝트에 같은 `career_snapshot_hash` + `requirements_hash`의 정렬 결과도 없을 때 자동 1회(경량 등급 호출 1회, 미터 `career_description`). 최신 인사이트가 있으면 호출하지 않고 `project_priorities`를 쓴다.
- 데이터 기준: D-01. 미달이면 호출하지 않는다(F-AP-06 안내).
- 입력 컨텍스트:

  | 원천 | entity.field | 필수 | 크기 추정 (토큰) |
  |------|--------------|------|-------------------|
  | 경력 팩 | C-1 중 경력·교육·프로젝트의 이름·기간·역할·한 줄 요약, 상세 내용의 제목·행동 앞 200자, 스킬 태그, 연결 성과 지표명 (요약형, 회고 및 배운 점 제외) | 필수 | 2k~5k |
  | JD 요건 | `jd_requirements.content`, `category`, `importance` | 필수 | 1k~1.5k |
- 처리 방식: 단일 호출. 프로젝트마다 관련 요건과 관련도 등급을 매기고, 상위 최대 8개를 `include: true`로 낸다. 서버 검증: ref 존재(V-1), 관련 요건 ref 존재.
- 모델: **경량 등급**, 낮은 사고 설정. 이유: 사용자가 바로 검토·수정하는 기본값이고 출력이 짧다. 평가 세트에서 사람이 고른 상위 3개와의 겹침이 기준 미달이면 Sonnet(약 $0.03)으로 올린다.
- 응답 모드: **동기**, 2~5초. 화면은 선택 목록을 스켈레톤으로 보여 주다가 결과로 체크 상태를 채운다.
- 실패 처리 (v4.3, A23 — 확정 2026-11-05 (사용자)): 실패하면 **대체 선택을 하지 않는다.** 오류 화면 없이 목록을 체크 없이 보여 주고 사용자가 직접 고른다(UX S-17·C-11). 그대로 생성하면 `selection_origin = user`("직접 고름"). `selection_origin` 값 목록(`insight` / `ai_ranking` / `user`)은 그대로다. 실패로 보는 경우: 키 없음·무효, 공급자 오류, 스키마 불일치(유효한 프로젝트 순위가 하나도 없음 포함), 요건 추출 실패·진행 중, 같은 프로젝트 정렬 진행 중. 데이터 부족(D-01)만 화면 안내(F-AP-06)로 답한다. 실패한 호출도 작업 `failed`와 사용 기록(미터 `career_description`)으로 남는다.
- 출력 스키마:
  ```json
  {
    "schema_version": 1,
    "rankings": [
      { "project_ref": "PRJ-3", "relevance": "high", "include": true, "requirement_refs": ["REQ-1", "REQ-2"], "reason": "결제 API 운영 요건과 직접 연결" },
      { "project_ref": "PRJ-5", "relevance": "low", "include": false, "requirement_refs": [], "reason": "JD 요건과 관련 근거가 약함" }
    ]
  }
  ```
  - `relevance`: `high` | `medium` | `low`. 경력·교육의 포함 여부는 소속 프로젝트에서 서버가 파생한다(포함 프로젝트가 있는 경력 → `included_experience_ids`, 교육 → `included_education_ids`).
- 저장: `drafts.options.included_project_ids` / `project_order`의 **기본값**으로 쓰고, 정렬 결과 원본은 `ai_jobs.output`(jsonb, `draft_source_ranking` 전용)에 두며 초안 생성 시 `drafts.options.ranking`에 복사한다(데이터 모델 v2 A2-17, 이 프로젝트의 가장 최근 성공한 정렬 결과, 지금 팩에 없는 프로젝트는 뺌). 화면의 "AI 추천" 표시는 `drafts.options.selection_origin = 'ai_ranking'`. 사용자가 체크를 바꾸면 화면은 `user`를 보낸다. `reason` 문장에도 V-5 치환과 별칭 정리를 한다(C-3).
- 품질 기준: 사람이 고른 상위 3개 프로젝트가 `include: true`에 들어가는 비율 85% 이상 `[가정]`.
- 비용·지연: 입력 약 5k + 출력 0.8k → **약 $0.001~0.002**, 2~5초.

### AI-04 자기소개서 문항별 초안 (근거 선택 포함)
- 관련 기능: F-DOC-02, F-DOC-03, F-DOC-04, F-DOC-08, F-DOC-09, (F-DOC-05 다시 쓰기, F-DOC-10 Could) / 관련 화면: 자기소개서 문항·초안 화면
- 목적: 문항마다 커리어 정리에서 **어떤 경력의 어떤 프로젝트를 근거로 쓸지 먼저 고르고**, 그 선택과 이유를 "사용한 경력·프로젝트"로 보여 준 뒤, 선택한 근거만으로 글자 수 제한에 맞는 초안을 쓴다. 사용자는 선택을 바꿔 다시 생성할 수 있다.
- 트리거:
  - 자소서 화면을 처음 열면 기본 3문항이 **AI 없이** 시드된다: `template_key` = `motivation`(지원 동기) / `job_competency`(직무 역량) / `future_plan`(입사 후 포부 및 성장 계획). 사용자가 문구 수정·추가·삭제(최소 1개)하면 `template_key`는 유지(문구만 수정) 또는 `null`(사용자 추가 문항).
  - 문항별 "생성" 또는 "전체 생성"(문항 순서대로 순차 실행 — 뒤 문항이 앞 문항의 선택을 보고 중복을 피하기 위해서다).
  - "사용한 경력·프로젝트"를 추가·제외한 뒤 "다시 생성".
- 데이터 기준: D-01. 미달이면 모든 문항 생성을 막는다(F-AP-06). 지원 동기·포부 문항은 메모만으로 쓸 수 있을 것처럼 보이지만, 문항 단위로 기준을 달리하면 화면 규칙이 복잡해지므로 MVP는 서류 전체에 같은 기준을 적용한다 `[가정]`.
- 입력 컨텍스트:

  | 원천 | entity.field | 필수 | 크기 추정 (토큰) |
  |------|--------------|------|-------------------|
  | 경력 팩 | C-1 전체 (`complete` 행만). 선택 모드가 `user`이면 선택된 경력·교육·프로젝트와 그 하위 상세 내용·성과·스킬 + 프로필만 | 필수 | 6k (3k~15k) / user 모드 2k~4k |
  | JD 요건 | `jd_requirements.*` + `job_descriptions.sentences` 중 회사·직무 소개 문장(`extraction.other_sids`) | 필수 | 1.5k~2.5k |
  | 문항 | `draft_sections.question_text`, `char_limit`, `count_basis`, `template_key` (`section_kind = 'cover_letter_question'`) | 필수 | 50~150 |
  | 문항 메모 | `draft_sections.user_note` (≤300자, F-DOC-09). 근거 표시명 "내 메모" | 선택 | 0~300 |
  | 사용자 지정 근거 | `draft_section_sources` 중 `origin = 'user'` 확정 목록 (선택 모드 `user`일 때) | 조건부 | 50~100 |
  | 다른 문항의 선택 | 같은 `drafts`의 다른 문항 `draft_section_sources`(주 근거 프로젝트 ref) | 선택 | 50~150 |
  | 인사이트 | `insights.result.strengths`, `strategy.positioning` | **선택 — 참고 신호** | 0.5k~1k |
- 처리 방식: **문항당 1회 호출, 출력이 2단 구조**(① 근거 선택 `sources` → ② 본문 `paragraphs`). 선택과 작성이 같은 판단 맥락을 공유하고, 호출이 한 번이라 비용·지연이 작으며, 스트리밍에서 선택이 본문보다 먼저 도착한다(PRD 6.3).
  - **선택 모드 `ai`(기본)**: 모델이 문항 유형별 규칙(아래)에 따라 프로젝트 0~2개를 고른다. 각 선택에 이유·관련 요건·근거 인용을 달고, (v3) 그 프로젝트에서 실제로 쓸 상세 내용(`detail_refs`, 1~2개)을 함께 고른다. 소속 경력은 프로젝트에서 자동 포함(독립 프로젝트는 경력 없음). 다른 문항이 주 근거로 쓴 프로젝트는 피하고, 더 맞는 대안이 없을 때만 중복하며 `reuse_reason`을 쓴다(F-DOC-08 (3) `[가정]`).
  - **선택 모드 `user`(사용자가 바꾼 뒤 재생성)**: 모델은 선택을 바꾸지 않는다. `sources`에 사용자 목록을 그대로 돌려주며 이유만 쓴다. 사용자가 고른 프로젝트가 문항과 관련이 약하면 억지로 연결하지 않고 `notes_for_user`에 알린다(예: "'사내 위키 개편' 프로젝트는 이 문항과 관련이 약해 한 문장만 사용했습니다" — 별칭이 아니라 프로젝트명). 사용자가 프로젝트를 모두 제외하면 메모·JD·프로필만으로 쓰고 사례 자리는 자리 표시로 남긴다.
  - **서버 검증**: V-1~V-5 + **V-7 근거 범위**(본문 근거는 `sources`의 경력·교육·프로젝트와 그 하위 상세 내용(`detail_refs`가 있으면 그 상세 내용만)·성과·스킬, 프로필, JD, 메모 안에서만). `user` 모드에서 모델이 목록 밖 프로젝트를 `sources`에 넣으면 제거.
    - (v4.3, 구현 반영) V-7 세부: 선택한 프로젝트의 소속 경력 자체(요약 등)와 경력 단위 성과는 범위 안, 같은 경력의 다른 프로젝트는 범위 밖. 프로젝트 없이 경력·교육만 고른 선택은 그 하위 전체. 프로젝트에 붙지 않은 직접 추가 스킬은 범위 밖.
    - (v4.3, 구현 반영) 근거 선택 규칙: `ai` 모드에서 근거 인용이 하나도 남지 않은 선택은 버린다(V-4). `primary`는 1개(첫 번째)로 맞춘다. 문항 유형별 개수 상한을 넘으면 뒤에서 자르고, 하한 미달(`job_competency`·`experience_story` 0개)은 `validation_report`에만 남긴다. 모델이 적은 소속 경력이 실제와 다르면 실제 소속으로 고친다. `user` 모드는 사용자 목록을 그대로 두고 모델 출력에서 이유·요건·근거만 가져온다.
    - (v4.3) 문항 유형: `template_key`가 있으면 그것이 `question_class`이고 모델 분류는 무시한다. 회고 허용(V-8)도 이 유형으로 판정한다.
    - (v4.3) 스킬명 가드: 출력의 영문 기술어가 사용자 커리어 데이터·JD·메모·문항에 없으면 블록에 `skill_check_needed`(AI-03과 같은 가드). 한글 표기 기술명은 잡지 못한다 `[가정]`.
  - **글자 수 보정**: 서버가 글자 수를 세어 제한의 ±10% 밖이면 보정 호출 1회(미터는 `cover_letter`에 포함, 낮은 사고 설정, 근거·자리 표시 유지). 모델에게 주는 목표는 제한의 95% `[가정]`. 보정 후에도 벗어나면 `char_adjust_needed`.
    - (v4.3, A12 — 확정 2026-11-05 (사용자)) **±10%를 유지한다.** 제한의 90~110%면 보정하지 않으므로 **최대 10% 초과까지 통과**한다. 화면은 제한을 넘은 글자 수를 그대로 보여 주고(UX S-18·S-19), 제출 전 줄이는 것은 사용자 몫이다.
    - 세는 법 (구현 반영): 문단을 줄바꿈 1개로 이어 붙인 뒤, `with_spaces`는 공백·줄바꿈 포함 문자 수, `without_spaces`는 모든 공백 문자를 뺀 수. 자리 표시 토큰도 적힌 그대로 센다.
    - 보정 호출이 공급자 오류·스키마 불일치로 실패하면 문항을 실패로 끝내지 않고 보정 전 초안을 저장한다(`correction_applied = false`, 글자 수 경고는 `validation_report`). 사용자 취소만 오류로 끝낸다.
- 문항 유형별 작성 규칙:

  | `template_key` | 근거 선택 | 본문 구성 | 데이터로 알 수 없는 부분 |
  |----------------|-----------|-----------|--------------------------|
  | `motivation` 지원 동기 | 프로젝트 0~1개 (지원 이유와 연결되는 경험이 있을 때만) | 메모의 지원 이유 → JD의 회사·직무 문장과 연결 → (선택 시) 관련 경험 한 단락 | 메모가 없으면 개인적 이유 자리에 `[지원 동기 입력 필요]`. 회사에 대한 외부 지식(매출, 서비스명 등)은 JD 문장에 없으면 쓰지 않는다 |
  | `job_competency` 직무 역량 | 프로젝트 1~2개 (필수). `importance: high` 요건과의 연결 우선 | 핵심 역량 한 문장(두괄식) → 사례(상황·행동·결과, 본인 기여 주어) → JD 요건과의 연결 | 수치가 없으면 `[수치 입력 필요]` |
  | `future_plan` 입사 후 포부 | 프로젝트 0~1개 (현재 역량의 출발점으로. v3: 회고 및 배운 점이 있는 상세 내용 우선 `[가정]`) | 기여할 수 있는 영역(JD 주요 업무 근거) → (v3) 지금까지의 회고 및 배운 점(회고로 표현) → 성장 방향(프로필 희망 직무·스킬 근거) → 구체 계획(메모 근거) | 메모가 없으면 구체 목표·학습 계획 자리에 `[계획 입력 필요]` |
  | `null` 사용자 추가 문항 | 모델이 문항 의도를 위 세 유형 또는 `experience_story`(경험 서술형: 갈등·실패·성과 등)로 분류해 해당 규칙 적용. `experience_story`는 프로젝트 1~2개 | 분류 결과를 `question_class`로 출력 | 위와 같음 |
- 모델: **기본 등급**, 낮은 사고 설정. 이유: 서술형 한국어 품질과 근거 선택 판단이 핵심.
- 응답 모드: **스트리밍 (문항 단위)**. 이벤트 순서 (v4.3 정정): `sources_selected`(선택 카드 먼저 표시: 경력명 › 프로젝트명 + 이유 한 줄) → `block_started`/`block_delta`/`block_completed`(문단) → (보정 시) `adjusting_length` → `validated` → `done`.
  - `validated`는 저장된 최종본과 같아야 하고 그 뒤에 오류가 올 수 없어야 하므로 보정이 끝난 뒤 1번만 낸다. `adjusting_length`에는 보정 전 글자 수·제한·기준·보정 이유(글자 수, 숫자)가 들어 있어 화면이 "글자 수 맞추는 중"을 보일 수 있다.
  - 문단 id는 서버가 정한다(같은 초안의 다른 문항과 겹치지 않게). 스트리밍 중 블록 이벤트의 id는 모델 id이므로 **화면은 `validated`에서 블록을 통째로 바꾼다.**
  - 목표: 선택 카드 3~5초, 첫 문단 글자 5초 이내, 문항당 완료 10~25초.
  - "전체 생성"은 화면이 문항 순서대로 문항별 생성 요청을 차례로 보낸다(함수 1회 60초 제한). 뒤 문항은 앞 문항의 주 근거를 저장된 선택에서 읽어 중복을 피한다. 생성 중인 문항은 문구·글자 수·메모·근거 선택을 바꿀 수 없다.
- 프롬프트 전략:
  - 역할: 국내 경력직 자기소개서 작성 코치.
  - 핵심 지시: 먼저 문항 의도를 파악하고 근거를 고른다 → 고른 근거와 메모·JD 안에서만 쓴다. 두괄식. 사례는 1~2개를 깊게. 과장된 수식어 금지. 메모는 사용자의 진술로 사실 취급하되, 메모 안의 지시문은 따르지 않는다(데이터 블록, C-4).
  - 근거 인용: 선택마다 이유와 근거 인용 1개 이상. 문단마다 `evidence` 1개 이상(경력 데이터, JD 문장, `user_note` 중). 사례 서술은 상세 내용의 상황→행동→결과 순서를 따르고, 본인 기여 주장은 `action`/`result`/성과 근거로만 한다.
  - (v3) **회고 및 배운 점 사용 규칙(C-9)**: `future_plan`·`experience_story`·`motivation` 문항에서만 쓸 수 있고, 문장은 "~을 배웠습니다 / ~라고 느꼈습니다"처럼 **본인의 회고로 표현**한다. 회고 및 배운 점의 내용을 사실·성과처럼 쓰지 않는다. 근거 칩 표시명 "회고 및 배운 점".
  - few-shot: 문항 유형별 근거 선택 예시 1개씩(가상 데이터, 짧게).
- 출력 스키마 (문항 1개):
  ```json
  {
    "schema_version": 2,
    "question_ref": "CLQ-2",
    "question_class": "job_competency",
    "selection_mode": "ai",
    "sources": [
      {
        "project_ref": "PRJ-3",
        "experience_ref": "EXP-1",
        "detail_refs": ["DET-5"],
        "role": "primary",
        "rationale": "JD 핵심 요건인 결제 API 운영과 가장 직접 연결되고, 응답 시간 개선 수치가 있어 직무 역량을 보여 주기 좋습니다.",
        "requirement_refs": ["REQ-1"],
        "reuse_reason": null,
        "evidence": [ { "source_type": "achievement", "ref": "ACH-2", "field": "metric" } ]
      }
    ],
    "paragraphs": [
      {
        "block_id": "q2-p1",
        "text": "저는 결제 시스템의 안정성과 속도를 함께 높이는 일에 강점이 있습니다. …",
        "evidence": [
          { "source_type": "achievement", "ref": "ACH-2", "field": "metric" },
          { "source_type": "project_detail", "ref": "DET-5", "field": "action", "quote": "병목 쿼리를 분석해 인덱스를 재설계했다" }
        ],
        "requirement_refs": ["REQ-1"],
        "placeholders": []
      }
    ],
    "notes_for_user": []
  }
  ```
  - `selection_mode`: `ai` | `user`. `sources[].role`: `primary` | `supporting`. `sources`는 0~2개(문항 유형 규칙). 교육 소속 프로젝트는 `experience_ref` 대신 `education_ref`. 저장 매핑: `project_ref` → `project_id`, `experience_ref` → `experience_id`, `education_ref` → `education_id`, `detail_refs` → `project_detail_ids`, `requirement_refs` → `requirement_ids`, `reuse_reason` → `reuse_reason`. `question_class`는 `draft_sections.question_class`(A2-16).
  - 지원 동기 문항에서 메모가 있으면 근거는 `{ "source_type": "user_note", "ref": "NOTE-1", "quote": "…" }` 형태로 단다(화면 표시명 "내 메모").
  - 글자 수(`ai_char_count`)는 서버가 센다. 모델은 출력하지 않는다.
  - (v4.3, A21 — 확정 2026-11-05 (사용자)) **`notes_for_user`와 `char_adjust_needed`는 저장하지 않는다.** 생성 직후 화면(`validated` 이벤트)에서만 보인다. 글자 수 경고는 `validation_report`(`char_adjust_needed` 카운트)에 남으므로, 다시 열었을 때 화면은 저장된 글자 수와 제한으로 다시 계산해 보인다.
- 저장:
  - `drafts` 행(`draft_type = 'cover_letter'`, 문항 입력 중 `status = 'composing'`) 1개 + 문항별 `draft_sections` 행(`section_kind = 'cover_letter_question'`, `template_key`, `question_text`, `char_limit`, `count_basis`, `user_note`, `ai_content`(블록 배열, `block_kind = 'paragraph'`, 원본 변경 불가), `edited_content`, `ai_char_count`, `correction_applied`).
  - **근거 선택 (데이터 모델 v3 확정)**: `draft_section_sources`(`draft_section_id`, `application_project_id`, `experience_id`, `education_id`, `project_id`, `project_detail_ids`(uuid[]), `role`(primary/supporting), `origin`(ai/user), `rationale`, `reuse_reason`, `requirement_ids`, `sort_order`, `source_label`, `source_deleted_at`) — 현재 목록만 보관 + `draft_sections.source_selection_mode`(`ai` | `user`), `generation_no`(섹션 생성 횟수), `sources_modified_at`(선택 변경 표시). 선택 이유의 근거 인용은 `evidence_links`(`owner_type = 'draft_section'`, `item_key = sources.{n}`). 사용자가 목록을 바꾸면 `origin = 'user'` 행으로 교체하고 `source_selection_mode = 'user'`. 원본 프로젝트가 삭제되면 `source_deleted_at` + `source_label`로 "삭제됨" 표시.
  - 본문 근거는 `evidence_links`(`item_key = block_id`). 문항 단위 재시도·재생성(일부 실패 시 `drafts.status = 'partially_failed'`).
- 품질 기준:
  - 근거 선택: 사람 평가자가 고른 "가장 적합한 프로젝트"가 `primary`에 들어가는 비율 70% 이상, `sources`에 들어가는 비율 85% 이상 `[가정]`. 운영 지표 "자소서 근거 변경률"(PRD 7장) 30% 초과 시 선택 규칙 점검.
  - 기본 3문항 세트에서 `primary` 프로젝트 중복 0건(대안이 있는 프로필 기준).
  - V-7 위반 최종 0건, 근거 없는 문단 0건, 수치 가드 위반 0건, 지원 동기·포부의 개인적 이유·계획 날조 0건(메모 없는 프로필로 검증 — 자리 표시가 나와야 정답).
  - 보정 후 글자 수 범위 준수율 95% 이상. 사람 평가 "편집해서 쓸 만하다" 60% 이상 `[가정]`.
- 실패 유형·가드레일: 키워드 맞추려고 관련 약한 프로젝트를 고르기 → 이유에 근거 인용 필수 + 평가 세트 점검. 사용자 지정 근거를 무시하고 다른 프로젝트 사용 → V-7로 차단. 회사 외부 지식 끌어오기 → JD 문장 외 회사 정보 금지 + 수치 가드. 메모의 민감정보 → C-7 지시(옮기지 않음).
- 비용·지연: 문항당 입력 약 10k(두 번째 문항부터 경력 팩 캐시 읽기) + 출력 약 2k(선택 0.3k + 본문·근거 + 사고) → 약 $0.04, 보정 호출 발생률 30% `[가정]` × 약 $0.015 → **문항당 약 $0.045**. `user` 모드 재생성은 입력이 줄어 약 $0.035. 기본 3문항 세트 약 $0.13.
- 결정 필요: 없음 (D-AI-06은 PRD v2 F-DOC-09로 수용).

### (재사용) 초안 다시 쓰기 — F-DOC-05 (Should)
- AI-03/AI-04를 "다시 쓰기 모드"로 실행한다. 추가 입력: 대상 `block_id` 목록, 사용자 지시(자유 텍스트, 최대 200자, 예: "리더십 강조"), 현재 `edited_content`.
- 출력: 같은 스키마의 블록 배열(대상 블록만). 화면은 기존 블록과 나란히 비교하고 적용/취소를 고른다.
- 가드레일: 사용자 지시도 데이터 블록으로 넣는다. "없는 성과를 추가해 줘" 같은 지시는 자리 표시로 대응한다(날조 금지가 사용자 지시보다 우선).
- 비용: 블록 3~5개 기준 약 $0.02~0.04.

---

## 4. P3 기능 카드 (v2 일괄 방식)

### 4.0 면접 흐름과 AI 호출 지점

| 단계 | 사용자 행동 | AI | 상태 (`interview_sessions.status` 값은 data-architect 확정) |
|------|-------------|----|----------------------------------------|
| 1 | 지원 프로젝트에서 면접 유형(직무 / 컬처핏, 기본값 없음) → 질문 수(3/5/7, 기본 5) 선택 → 시작 | 서버가 데이터 기준 판정(C-1) → 연결 확인(키·동의) → **AI-05 작업 1개** | 질문 생성 중 |
| 2 | 질문이 저장되는 대로 목록이 채워지는 것을 본다 | AI-05 완료 | 답변 작성 중 |
| 3 | 모든 질문을 한 화면에서 보며 순서 자유로 답변 작성, 자동 저장 (나갔다 와도 그대로) | 없음 | 답변 작성 중 |
| 4 | 미응답 경고 확인 후 **1회 제출** (이후 수정 불가) | 서버가 미응답 질문을 `unanswered`로 확정 → **AI-06(응답된 질문만, 병렬) + AI-07 작업 1개** → 점수 슬롯 채움 | 채점 중 (나갔다 와도 됨) |
| 5 | 결과: 세션 점수·질문별 점수 자리 + 답변별 평가 + 종합 | 없음 (저장된 결과 렌더링) | 완료 / 채점 실패(재시도) |

- 턴·"다음 질문"·꼬리 질문·건너뛰기가 없으므로 **턴 단위 지연 목표가 없다.** AI 호출은 세션당 2개의 비동기 작업(질문 생성, 채점)뿐이다.
- 답변 작성 중에는 AI를 호출하지 않는다. 피드백은 제출 후에만 나온다(D-07 해소안).

### 4.1 면접 유형별 질문 구성 규칙 (AI-05 전제)

**직무 면접 (`interview_type = 'job'`)** — 데이터 기준 D-01

| source_kind | 설명 | 근거 | 3문항 | 5문항 | 7문항 |
|-------------|------|------|-------|-------|-------|
| `project_deep_dive` | 특정 상세 내용의 행동(A)·결과(R)·성과에 대한 본인 기여 검증 ("응답 시간을 1.2초에서 0.7초로 줄이셨는데…") | 경력 데이터 필수 | 1 이상 | 2 이상 | 3 이상 |
| `requirement_fit` | JD 핵심 요건(`importance: high`)과 경험 연결 | JD 요건 + 경력 데이터 | 1 이상 | 1 이상 | 2 이상 |
| `gap_probe` | 커리어 데이터 근거가 약한 JD 요건에 대한 대응력 (F-P3-02 "최소 1개") | JD 요건 (+ 유사 경험) | 1 | 1 이상 | 1 이상 |

- **보완점 판단은 인사이트에 의존하지 않는다.** AI-05가 같은 호출 안에서 요건별 근거 강도를 스스로 판단해 `weak_requirement_refs`를 출력하고, 그중에서 `gap_probe`를 만든다. 최신 인사이트가 있으면 `no_evidence`/`partial` 요건 목록을 참고 신호로 함께 넣는다.
- 같은 프로젝트를 주 대상으로 하는 질문은 최대 2개(같은 상세 내용은 1개), 같은 요건을 주 대상으로 하는 질문은 1개.
- (v3) 직무 질문의 사실 전제(수치·행동)는 `action`/`result`/성과에서만 가져온다. 회고 및 배운 점은 직무 질문의 전제로 쓰지 않는다.
- (v4.3, A11 — 확정 2026-11-05 (사용자)) **이 제한은 모든 직무 질문(`project_deep_dive`, `requirement_fit`, `gap_probe`)에 같다.** 질문 문장이 사용자 경력의 사실을 전제로 하면 그 전제는 상세 내용의 `action`·`result` 또는 성과 근거에서만 나와야 한다. 상황(S)·과제(T)·프로젝트 요약·스킬 태그만으로 사실을 전제한 질문은 버리고 다시 만든다. 사실을 전제하지 않는 질문(예: `gap_probe`의 "이 요건과 비슷한 경험이 있다면")은 해당하지 않는다.
- (v4.3, 구현 반영) 질문 유형별 필요 근거: `project_deep_dive` = `action`·`result` 또는 성과 근거 필수, `requirement_fit` = 대상 요건 + 위 사실 근거, `gap_probe` = 보완 요건 1개 이상. 중복 규칙의 "주 대상" = 질문 근거 중 첫 경력 근거(상세 내용·성과면 그 상위 프로젝트)와 대상 요건(없으면 보완 요건)의 첫 번째, 직무 면접에만 적용 `[가정]`.

**컬처핏 면접 (`interview_type = 'culture_fit'`)** — 데이터 기준 JD만 (F-P3-13, D-15)

| source_kind (주제) | 설명 |
|--------------------|------|
| `collaboration` | 협업 방식, 역할 분담, 소통 |
| `conflict` | 의견 충돌·갈등 해결 |
| `failure_growth` | 실패·실수와 그 이후의 변화 |
| `values` | 일하는 방식의 가치관, 우선순위 판단 |
| `org_adaptation` | 새 조직·변화 적응, 피드백 수용 |
| `motivation_career` | 지원 동기·이직 이유·커리어 방향 |

- 질문마다 주제가 달라야 한다(7문항일 때만 한 주제 최대 2개). 5·7문항에는 `motivation_career` 1개를 포함한다.
- 질문마다 **`anchor`**(질문의 바탕)를 단다:
  - `experience`: 사용자의 실제 경력 맥락을 짚음 (예: "4인 팀 리드로 일하며 의견이 갈렸던 경험") — 근거에 경력 데이터 필수. (v3) 상세 내용의 **상황(S)**과 **회고 및 배운 점**을 우선 활용한다(PRD F-P3-02). 회고 및 배운 점을 쓸 때는 "그 경험에서 ~를 배웠다고 정리하셨는데"처럼 **본인의 회고로 인용**한다(C-9)
  - `jd`: JD의 조직·업무 방식 문장을 바탕으로 함 (예: "이 팀은 주 단위로 우선순위를 바꾸는데…") — 근거에 `jd_sentence` 필수
  - `general`: 일반 컬처핏 질문 — 근거 없음
- `data_sufficiency`별 구성: `ok` → `experience` 50% 이상 목표 / `thin` → 가능한 만큼 `experience`, 나머지 `jd`·`general` / `none` → `jd`·`general`만. `jd` 앵커는 JD에 조직·문화·업무 방식 문장이 있을 때만 쓴다.
- 두 유형 공통 금지 주제(C-7): 나이, 결혼·출산 계획, 가족, 종교, 출신 지역, 정치 성향, 건강. 컬처핏의 이직 이유 질문은 이전 회사·동료를 비난하게 유도하지 않는다.

**데이터가 적은 컬처핏 면접의 동작 (F-P3-13)**

| 항목 | 동작 |
|------|------|
| 시작 | 차단하지 않는다. 시작 화면과 결과 화면에 "커리어 정리를 하면 내 경험을 짚는 질문이 늘어나요" 안내(`data_sufficiency` = `thin`/`none`) |
| 질문 | 사용자 사실을 가정하지 않는다. `anchor`가 `experience`가 아닌 질문의 문장에는 회사명·프로젝트명·직급·연차를 쓰지 않는다(서버가 경력 팩 고유명사·숫자 포함 여부 검사). 프로필의 희망 직무는 `general` 질문에도 쓸 수 있다 |
| 평가 | 답변 텍스트만 근거로 평가. 경력 데이터와의 일관성 메모(`consistency_notes`)는 생략 |
| 개선 답변 예시 | 사용자 답변에 있는 사실만 재구성한다. 구체 사례가 없으면 `[사례 입력 필요]` 자리 표시 + "이런 사례가 있다면 넣으세요" 제안(`suggestions_if_true`). 경력 데이터를 지어내지 않는다 |
| 다음 연습 | `add_data`(답변에서 말한 경험을 커리어 정리에 기록하면 직무 면접·서류에도 쓰인다)를 우선 추천 |

### AI-05 면접 질문 일괄 생성
- 관련 기능: F-P3-01, F-P3-02, F-P3-13 / 관련 화면: 면접 유형·질문 수 선택, 답변지
- 목적: 선택한 유형·질문 수에 맞춰 질문 전체를 한 번에 만들고, 질문마다 평가 의도와 근거를 붙인다.
- 트리거: 사용자가 유형·질문 수를 고르고 "시작". 인사이트 생성 선행 없음(v1 폐기).
- 입력 컨텍스트:

  | 원천 | entity.field | 필수 | 크기 추정 (토큰) |
  |------|--------------|------|-------------------|
  | 경력 팩 | C-1 전체 (`complete` 행만). 컬처핏 `none`이면 비어 있음 | 직무: 필수 / 컬처핏: 있으면 사용 | 7k (0~18k) |
  | 프로필 | `profiles.desired_job_title`, `total_years_of_experience` | 선택 | 50 |
  | JD 요건 | `jd_requirements.*` | 필수 | 1k~1.5k |
  | JD 조직·업무 방식 문장 | `job_descriptions.sentences` 중 `extraction.other_sids` (컬처핏 `jd` 앵커용) | 컬처핏: 필수 / 직무: 넣지 않음 | 0.3k~0.8k |
  | 세션 설정 | `interview_sessions.interview_type`, `question_count`, `data_sufficiency` (F-ST-04 팝업으로 들어오면 `interview_type`이 미리 선택되어 있을 뿐 AI 입력은 같다) | 필수 | 20 |
  | 인사이트 | `insights.result.requirement_matches`(status·ref·missing_aspect) | **선택 — 참고 신호** (직무만) | 0.5k~1k |
  | 최근 세션 질문 | 같은 지원 프로젝트·같은 유형 최근 2세션의 `interview_questions.question_text` | 선택 | 0.3k~0.6k |
- 처리 방식: 단일 호출 + 서버 검증(유형별 구성 규칙, 중복 규칙, 수치 가드 V-5, 금지 주제, 컬처핏 `anchor` 검증).
  - (v4.3, 구현 반영) **질문 단위 검사로 바꾼다.** 질문은 스트림에서 완성되는 즉시 저장되므로 세트 전체를 다시 만들 수 없다. 서버는 질문을 받을 때마다 검사한다: 규칙 위반(중복, 금지 주제, 사실 전제(4.1, A11), 근거, 질문 문장 V-5)이거나, 이 질문을 받으면 남은 칸으로 유형별 최소 개수(4.1 표)를 채울 수 없으면 그 질문을 버린다.
  - 버린 만큼 **1회 다시 만든다**(저장된 질문과 위반 이유를 입력에 넣어 중복 방지). 재생성 호출은 구성 규칙을 완화해 받고 `validation_report`에 경고를 남긴다(`composition_relaxed` / `composition_unmet`). 그래도 질문 수가 모자라면 `schema_invalid`(자동 재시도 없음)로 끝나고 저장된 질문은 남는다 — 화면은 "남은 질문 다시 만들기"(새 작업, 현재 활성 공급자 — C-11.4 경우 ②).
  - 금지 주제·컬처핏 고유명사·회고 인용 검사는 규칙 기반이다 `[가정]`: 금지 주제는 단어 목록("장애 대응"처럼 직무어는 제외), 컬처핏 `experience`가 아닌 질문은 경력 팩의 회사·기관·전공·프로젝트명·직급·직책·부서(JD·희망 직무에 있는 말 제외)와 JD에 없는 숫자를 쓰면 버린다. 회고 근거는 질문 문장이 "배웠다고 정리하셨는데"류일 때만 남긴다. 평가 세트로 보정한다.
  - 모델이 낸 `data_sufficiency`는 쓰지 않고 서버 판정값(세션)을 쓴다. 컬처핏 `ok`에서 `experience` 앵커 50% 미만은 경고만 남긴다(목표치).
- 모델: **기본 등급**, 낮은 사고 설정. 이유: 경력직 검증 질문의 날카로움이 체감 품질을 좌우한다.
- 응답 모드: **비동기 작업**(`job_type = 'interview_questions'`). 서버가 모델 출력을 스트리밍으로 받아 질문이 완성될 때마다 `interview_questions`에 저장하고 `ai_jobs.progress = {stage: "generate", done: n, total: N}`를 갱신한다. 화면은 저장된 질문을 차례로 목록에 채우고, **답변 입력은 전체 생성 완료 후 연다**(PRD 6.3 `[가정]`). 사용자는 기다리지 않고 나갔다 와도 된다. 목표: 첫 질문 10초 이내(예상 6~10초), 전체 30초 이내(예상 20~35초 — 7문항은 초과 가능).
  - 생성 도중 실패하면 저장된 질문을 유지하고 남은 개수만 재생성한다(기존 질문을 입력에 넣어 중복 방지). 끝내 실패하면 세션은 생성 실패(입력 설정은 보존, D-36).
  - (v4.3) 진행 단계: `prepare` → `generate` → `complete`(C-6). 함수 실행 1번 = 공급자 호출 1번이라, 남은 개수 재생성은 다음 실행에서 한다(무료 등급 간격도 지킴, C-12).
- 프롬프트 전략:
  - 역할: 직무 면접 — 해당 직무의 경력직 실무 면접관(팀장급). 컬처핏 면접 — 조직 적합성을 보는 면접관(HR·조직장).
  - 핵심 지시: 한 질문에 하나의 핵심만(하위 질문 최대 2개). 질문 속 사실은 데이터 그대로. 질문마다 평가 의도와 좋은 답변의 신호를 내부용으로 만든다. 직무 면접은 먼저 요건별 근거 강도를 판단해 `weak_requirement_refs`를 낸 뒤 질문을 만든다.
  - few-shot: 유형별로 좋은 질문 vs 일반론 질문 대비 1쌍씩.
- 출력 스키마:
  ```json
  {
    "schema_version": 2,
    "interview_type": "job",
    "weak_requirement_refs": ["REQ-7"],
    "questions": [
      {
        "order": 1,
        "source_kind": "project_deep_dive",
        "anchor": "experience",
        "text": "결제 승인 API 응답 시간을 1.2초에서 0.7초로 줄이셨는데, 병목을 어떻게 찾았고 본인이 직접 바꾼 부분은 무엇이었나요?",
        "intent": "성능 문제 진단 방법과 본인 기여 범위를 검증",
        "focus_criteria": ["specificity", "intent_fit"],
        "target_requirement_refs": ["REQ-1"],
        "target_gap_requirement_refs": [],
        "evidence": [
          { "source_type": "achievement", "ref": "ACH-2", "field": "metric" },
          { "source_type": "jd_requirement", "ref": "REQ-1" }
        ],
        "good_answer_signals": ["측정 방법(모니터링 지표)을 언급", "팀원과 본인 역할 구분", "개선 수치와 트레이드오프"]
      }
    ],
    "data_sufficiency": { "level": "ok", "hints": [] }
  }
  ```
  컬처핏 예:
  ```json
  {
    "order": 2,
    "source_kind": "conflict",
    "anchor": "jd",
    "text": "이 팀은 기획·개발·운영이 한 스쿼드로 일한다고 소개합니다. 직군이 다른 동료와 우선순위가 부딪쳤을 때 어떻게 풀어 본 적이 있나요?",
    "intent": "다른 직군과의 갈등 해결 방식과 협업 태도 확인",
    "focus_criteria": ["specificity", "job_relevance"],
    "target_requirement_refs": [],
    "target_gap_requirement_refs": [],
    "evidence": [ { "source_type": "jd_sentence", "ref": "S3" } ],
    "good_answer_signals": ["구체적인 상황과 본인 행동", "상대 입장 이해", "결과와 회고 및 배운 점"]
  }
  ```
  - `source_kind`: 직무 `project_deep_dive` | `requirement_fit` | `gap_probe` / 컬처핏 `collaboration` | `conflict` | `failure_growth` | `values` | `org_adaptation` | `motivation_career`
  - `anchor`: `experience` | `jd` | `general` (직무 질문은 `experience` 또는 `jd`만)
  - v1의 `type`(job/personality, 질문 단위)은 세션 단위 `interview_type`으로 대체. v1의 `follow_up_hooks`는 삭제(꼬리 질문 `[보류]`).
  - `intent`, `good_answer_signals`는 **답변지에서 보여 주지 않는다**. `intent`는 결과 화면에서 공개.
- 저장: `interview_questions` 행(질문당 1행, 빈 `interview_answers` 행을 함께 생성 — 데이터 모델 v2): `session_id`, `sequence` ← `order`, `source_kind`, `anchor`, `question_text` ← `text`, `intent`, `focus_criteria`, `target_requirement_ids`, `target_gap_requirement_ids`, `good_answer_signals`, `prompt_version`, `model`. 근거는 `evidence_links`(`owner_type = 'interview_question'`). 세션에는 `application_project_id`, (v4.1) **`question_provider`·`question_model`**(AI-05 작업이 기록, 질문 세트를 만든 공급자·모델. 실패한 질문 생성 작업을 다시 시도하면 누른 시점의 활성 공급자·모델로 갱신 — C-11.4 경우 ①), `interview_type`, `data_sufficiency`, `weak_requirement_ids` ← `weak_requirement_refs`(결과 화면 "이번 세션이 다룬 보완 요건"), `generation_status`, `insight_id`(참고한 경우만), `career_snapshot_hash`. v1의 `kind`·`parent_question_id`·`question_type`은 MVP 스키마에서 삭제(데이터 모델 v2 A2-19, A2-20).
  - (v4.3, A22 — 확정 2026-11-05 (사용자)) **질문 세트 단위 기록은 세션에 저장한다**: `interview_sessions.question_validation_report`(jsonb — 버린 질문 수와 이유, 구성 규칙 경고 `composition_relaxed`/`composition_unmet`, 재생성 여부 등. 원문 없음), `interview_sessions.question_usage`(jsonb — 세트를 만든 호출들의 토큰 합계). 질문 행마다의 AI 메타는 그대로 둔다. 화면 표시는 하지 않고 운영 지표(6장 "질문 구성 규칙 위반률")에 쓴다.
- 품질 기준: 직무 질문 중 경력 데이터 항목을 명시적으로 짚는 비율 80% 이상, `gap_probe` 포함률 100%, `weak_requirement_refs`가 사람 판단 "근거 약함" 요건과 일치 70% 이상 `[가정]`, 세션 내 중복 0건, 질문 속 수치 날조 0건, 금지 주제 0건, 컬처핏 `none`/`thin`에서 사용자 사실 가정 0건, 사람 평가 "실제 면접에서 나올 법하다" 4/5 이상 `[가정]`.
- 비용·지연: 직무 입력 약 11k + 출력 약 3k(5문항, 사고 포함) → **약 $0.05/세션**(7문항 약 $0.065). 컬처핏 `none`은 입력 약 4k → 약 $0.04. 첫 질문 6~10초, 전체 20~35초.

### 4.2 참고 평가 기준 (루브릭) — AI-06 전제

v2에서 면접 결과는 **점수**로 제공하며 산정 방식은 D-14(사용자 정의 대기)다. 아래 4항목 × 4등급 루브릭은 **참고 평가 기준**으로 유지한다. 용도: (1) 답변별 서술형 피드백(잘한 점·개선할 점)의 근거, (2) D-14가 정해졌을 때 점수 계산의 재료가 될 수 있는 구조화된 판단(PRD D-14 선택지 (a)). **이 문서는 등급을 점수로 바꾸는 산식을 정하지 않는다.**

| 키 | 항목 | 직무 면접에서 보는 것 | 컬처핏 면접에서 보는 것 | 우수 | 양호 | 보완 필요 | 미흡 |
|----|------|----------------------|------------------------|------|------|-----------|------|
| `specificity` | 구체성 (본인 기여·수치) | 본인 행동과 팀이 한 일의 구분, 규모·수치·기간, 기술적 선택의 이유 | 실제 사례(언제, 누구와, 무엇을)의 구체성, 본인 행동 | 본인 행동과 결과가 수치·규모로 명확 | 본인 행동은 분명하나 수치·규모 일부 빠짐 | 본인 기여·결과가 모호 | 구체 사례 없음 |
| `intent_fit` | 질문 의도 부합 | `intent`에 직접 답함 | 같음 | 의도에 정면으로 답하고 핵심을 먼저 말함 | 핵심이 늦거나 일부 벗어남 | 질문의 일부에만 답함 | 질문과 무관 |
| `structure` | 구조 (논리 흐름) | 결론 → 상황 → 행동 → 결과 | 같음 | 두괄식, 인과가 이어짐 | 흐름은 있으나 결론이 뒤 | 나열식 | 따라가기 어려움 |
| `job_relevance` | JD 연관성 (컬처핏: 직무·조직 연결) | 답변이 `target_requirement_refs`와 연결 | 드러난 태도·가치가 JD의 조직·업무 방식과 연결. `anchor`가 `jd`가 아니고 JD에 해당 문장이 없으면 `not_applicable` | 연결을 스스로 명시 | 연결되나 명시적이지 않음 | 연결이 약함 | 연결 없음 |

- 등급마다 답변 인용(`answer_quotes`, 답변 원문의 부분 문자열) 1개 이상 또는 결핍 설명(`missing`) 필수.
- **일관성 메모(`consistency_notes`, 등급·점수 아님)**: 직무 면접과 데이터가 `ok`인 컬처핏에서, 답변이 등록된 경력 데이터(상세 내용의 행동·결과·성과, 프로젝트 역할·팀 규모)와 다르면 알려 준다(거짓말로 단정하지 않음). 회고 및 배운 점과 다른 해석은 일관성 메모 대상이 아니다(회고는 바뀔 수 있음).
- 짧은 답변(50자 미만)도 평가한다(대부분 `poor`). **미응답 질문은 AI 평가 없음**(D-16 (b)).

### 4.3 점수 자리 (D-14 대기)

모든 점수 객체는 같은 모양이다. 산식이 정해지기 전에는 값이 비어 있다.

```json
{ "status": "pending_method", "value": null, "max": null, "method_version": null, "rationale": null }
```

| 필드 | 설명 |
|------|------|
| `status` | `pending_method`(D-14 미정 — 화면은 "점수 산정 방식 준비 중" 같은 빈 상태) / `scored` / `unanswered`(미응답 — D-14에서 0점·제외 여부 결정, **질문별에만**) / `not_scored`(평가 실패). 세션 점수는 `pending_method`/`scored`/`not_scored`만(A2-13) |
| `value`, `max` | 숫자. D-14 확정 후 채움 (예: 100점 만점, 5점 만점 — 정하지 않음) |
| `method_version` | 산정 방식 식별자(예: `d14.v1`). 방식이 바뀌어도 과거 점수의 기준을 알 수 있게 한다 |
| `rationale` | 점수 설명(답변 인용 포함). 근거 없는 점수는 표시하지 않는다(NFR-AI-01) |

- **질문별 점수**: 질문마다 1개(미응답 포함) → `interview_answers.score_value`, `score_max`, `score_status`, `score_method_version`, `score_rationale`. **세션 점수**: 세션당 1개 → `interview_sessions.score_value`, `score_max`, `score_status`, `score_method_version`, `score_rationale`, `score_counted_count`, `unanswered_count`(A2-6~A2-12). 모델 출력의 점수 객체 키(`value`, `max`, `rationale`, `counted_questions`)는 그대로 두고 저장 시 이 컬럼으로 매핑한다.
- **누가 계산하나**: PRD v3가 D-AI-07 (a)(서버가 저장된 등급에서 계산)를 수용했다. 아래는 기록용. (a) 서버가 저장된 루브릭 등급(4.2)에서 결정적으로 계산 — 재현성이 높고, 산식이 나중에 정해져도 **과거 세션을 AI 재호출 없이 채점**할 수 있다. (b) 모델이 질문별 점수를 직접 출력 — 산식이 "종합 인상 점수"라면 필요하지만, 같은 답변의 점수 변동이 생기고 `rationale` 필수. 권고는 (a)를 기본으로 두고, D-14가 (b) 유형이면 AI-06 출력의 `score`를 모델이 채우도록 스키마만 활성화하는 것이다.
- 어떤 방식이든 결과 화면에 "이번 답변의 연습 점수이며 합격 예측이 아닙니다"를 표시한다(NFR-AI-03).

### AI-06 답변별 평가
- 관련 기능: F-P3-06, (F-P3-08 재응시) / 관련 화면: 면접 결과 화면(질문별)
- 목적: 응답된 답변마다 참고 평가 기준 등급, 잘한 점, 개선할 점, 질문의 평가 의도, 개선 답변 예시를 제공하고 질문별 점수 자리를 채울 재료를 남긴다.
- 트리거: 세션 **제출 1회** → `interview_evaluation` 작업 시작. 서버가 답변이 빈 질문을 `unanswered`로 확정하고, **응답된 질문만** AI-06을 병렬 호출한다.
- 입력 컨텍스트:

  | 원천 | entity.field | 필수 | 크기 추정 (토큰) |
  |------|--------------|------|-------------------|
  | 경력 팩 | C-1 전체 (개선 답변 예시·일관성 메모용). 컬처핏 `thin`/`none`이면 있는 만큼(또는 없음) | 직무: 필수 / 컬처핏: 있으면 사용 | 7k (0~18k) |
  | JD 요건 | `jd_requirements.*` (컬처핏은 + 조직·업무 방식 문장) | 필수 | 1k~2k |
  | 세션 | `interview_sessions.interview_type`, `data_sufficiency` | 필수 | 20 |
  | 질문 | `interview_questions.question_text`, `source_kind`, `anchor`, `intent`, `focus_criteria`, `good_answer_signals`, `target_requirement_ids` + 질문 근거(`evidence_links`) | 필수 | 0.3k |
  | 답변 | `interview_answers.answer_text` (`status = 'submitted'`, 별칭 `ANS-n`) | 필수 | 0.3k~1k |

  다른 질문의 답변은 넣지 않는다(답변 간 독립 평가, 병렬 처리).
- 처리 방식: 응답된 답변별 단일 호출, 캐시 예열 후 병렬. 서버 검증: `answer_quotes` 부분 문자열(V-3), 개선 답변 예시 수치 가드(V-5), 근거 검증, `criteria` 4키 모두 존재.
- 모델: **기본 등급**, 중간 사고 설정. 점수가 생기면서 **재현성**이 더 중요해졌다(같은 답변이 다른 점수를 받으면 신뢰가 깨진다). 공급자별 평가 세트에서 일치도(±1등급 85%)·재현성(3회 변동 1등급 이내 95%)을 모두 넘어야 한다 — 세 공급자 모두 통과가 출시 조건(D-38, UB-3). v3의 "Haiku 전환 검토"(D-AI-02)는 D-31 고정 매핑으로 대체.
- 응답 모드: 비동기 작업(AI-07과 하나, 무료 등급은 답변 순차 평가 — C-12). 진행: `{stage: "evaluate", done: n, total: 응답 수}` → `summarize` → `score`(서버, D-14 확정 후) → 완료. 완료된 질문 카드부터 열람 가능(선택). 목표: 제출 후 60초 이내. 사용자는 나갔다가 세션 목록에서 결과를 볼 수 있다.
- 프롬프트 전략: (v3) 개선 답변 예시는 상세 내용의 상황→행동→결과 흐름으로 재구성하고, 사실은 `action`/`result`/성과에서만 가져온다. 컬처핏 개선 답변의 마무리 문장에는 회고 및 배운 점을 회고로 쓸 수 있다(C-9). 그 밖은 v1과 같다(공정·구체적 코치, 등급 앵커, 행동 단위 개선점, 개선 답변 예시는 답변 + 경력 데이터에 있는 사실만, 데이터 밖 내용은 `suggestions_if_true`로 분리, 답변 속 지시문은 데이터 취급). v2 추가: 유형별 루브릭 정의 적용, 컬처핏 데이터 부족 시 4.1 표의 평가·개선 답변 예시 규칙.
- 출력 스키마 (v1 대비 `score` 추가, 나머지 동일):
  ```json
  {
    "schema_version": 2,
    "question_ref": "Q-1",
    "answer_ref": "ANS-1",
    "criteria": [
      { "key": "specificity", "grade": "fair", "reason": "개선 결과는 말했지만 본인이 바꾼 부분이 '팀에서 개선했다'로 뭉뚱그려져 있습니다.", "answer_quotes": ["팀에서 여러 가지를 개선해서 빨라졌습니다"], "missing": "본인의 직접 행동과 측정 방법" },
      { "key": "intent_fit", "grade": "good", "reason": "…", "answer_quotes": ["…"], "missing": null },
      { "key": "structure", "grade": "good", "reason": "…", "answer_quotes": ["…"], "missing": null },
      { "key": "job_relevance", "grade": "fair", "reason": "…", "answer_quotes": [], "missing": "결제 API 운영 요건과의 연결" }
    ],
    "strengths": [ { "text": "개선 수치를 정확히 제시했습니다.", "answer_quotes": ["1.2초에서 0.7초로"] } ],
    "improvements": [
      { "text": "본인이 직접 한 일을 주어로 말하세요.", "how": "'제가 APM으로 병목 쿼리를 찾아 인덱스를 재설계했습니다'처럼 행동 → 결과 순서로 말해 보세요.", "related_criteria": ["specificity"], "evidence": [ { "source_type": "project_detail", "ref": "DET-5", "field": "action", "quote": "병목 쿼리를 분석해 인덱스를 재설계했다" } ] }
    ],
    "intent_reveal": "이 질문은 성능 문제를 진단하는 방법과 본인 기여 범위를 확인하려는 질문이었습니다.",
    "model_answer": {
      "text": "…제가 APM 지표로 병목 쿼리를 찾고 인덱스를 재설계해 0.7초로 줄였습니다.",
      "evidence": [ { "source_type": "achievement", "ref": "ACH-2", "field": "metric" } ],
      "placeholders": [],
      "suggestions_if_true": ["개선 후 장애율이나 처리량 변화를 알고 있다면 함께 말하면 설득력이 높아집니다."]
    },
    "consistency_notes": [],
    "score": { "status": "pending_method", "value": null, "max": null, "method_version": null, "rationale": null }
  }
  ```
  - `grade`: `excellent` | `good` | `fair` | `poor` | `not_applicable`(`job_relevance`만)
  - `score`: 4.3. D-AI-07 (a) 수용(PRD v3)이므로 모델은 항상 `pending_method`로 두고, D-14 확정 후 서버가 등급에서 계산해 덮어쓴다.
  - (v4.3, 구현 반영) `consistency_notes[]` 원소는 `{ "text", "answer_quotes", "evidence" }`다. 사실 경력 근거(`learnings` 제외) 1개 이상이 없으면 버린다. 저장 `result`에는 `{text, answer_quotes}`만 두고 근거는 `evidence_links`(`item_key = consistency_notes.<n>`).
  - (v4.3, 구현 반영) 검증 세부: `criteria` 4키 누락·중복, `job_relevance` 밖의 `not_applicable`은 V-6(1회 재시도 → `schema_invalid`)으로 다룬다. 등급의 인용이 모두 V-3에서 떨어지고 `missing`도 없으면 서버 문구("답변에서 이 판단의 근거 구간을 확인하지 못했습니다.")를 `missing`에 넣는다 `[가정]`. 잘한 점(`strengths`)은 답변 인용이 없으면 버린다. 개선할 점(`improvements`)은 답변에 대한 행동 조언이라 경력 근거가 없어도 남긴다(컬처핏 `none`에서 정상). 개선 답변 예시 V-5 재생성은 호출 전체를 1회 다시 하고(평가도 새 출력으로 교체), 그 재생성이 실패하면 첫 평가를 치환해 저장한다(C-3).
- 저장: `answer_evaluations` 행(응답된 답변 1개당 1행, `answer_id` unique, `result` jsonb — evidence 배열 제외, 근거는 `evidence_links`(`owner_type = 'answer_evaluation'`, `item_key` 예: `criteria.specificity`, `model_answer`), AI 출력 공통 메타). (v4.3, 구현 반영) **답변 인용도 근거 행으로 남긴다**: 등급·잘한 점의 `answer_quotes`는 `result`에 문자열로 두고(화면 표시), 같은 인용을 `source_type = 'interview_answer'` 근거 행(`item_key = criteria.<key>`, `strengths.<n>`)으로도 저장한다. **질문별 점수 (데이터 모델 v3 확정)**: `interview_answers.score_value`, `score_max`, `score_status`, `score_method_version`, `score_rationale`(`answer_evaluations.result.score`는 모델 출력 원본). 미응답 질문은 `interview_answers.status = 'unanswered'`, 평가 행 없음, `score_status = 'unanswered'`. v1의 `attempt_no`는 폐기(재응시는 새 세션, F-P3-08).
- 품질 기준: 사람 평가자(2인) 대비 항목별 등급 ±1 이내 85% 이상, 정확 일치 60% 이상 `[가정]`. **재현성**: 같은 답변 3회 평가 시 항목별 등급 변동 1등급 이내 95% 이상(점수가 붙으므로 v1보다 중요). 개선 답변 예시의 데이터 밖 사실 0건, 인용 검증 통과율 98% 이상. 점수는 D-14 확정 후 사람 평가자와의 일치도 기준 추가(NFR-AI-04).
- 실패 유형·가드레일: v1과 같음(후한 평가 편향 점검, 수치 가드, 톤). 답변 일부 평가 실패 → 해당 답변만 재시도, 그래도 실패하면 그 질문은 `score_status = 'not_scored'` + "평가 다시 시도", AI-07은 나머지로 진행.
  - (v4.3, 구현 반영) 단, 실패 원인이 **키·계정·공급자 한도**(`user_account`·`provider_limit` 범주)면 종합도 같은 이유로 실패하므로 답변을 닫지 않고 작업 전체를 실패시킨다(세션 채점 실패, 저장된 평가는 보존). 모든 답변이 실패하면 작업 실패 코드는 첫 실패 답변의 원인이고 AI-07은 부르지 않는다.
- **다시 채점 (v4.3, A9 — 확정 2026-11-05 (사용자))**:
  - 범위: **평가에 실패한(평가 성공이 없는) 응답 답변만 다시 평가**하고, 종합(AI-07, `session_feedbacks`)은 **항상 다시 생성**한다(답변 평가가 바뀌면 종합도 바뀐다). 이미 성공한 답변 평가는 다시 부르지 않는다(토큰 효율, NFR-AI-08).
  - "새 결과" 표식(`interview_sessions.result_viewed_at`): 결과를 열면 **세션이 `completed`일 때만** 지운다(채점 중·채점 실패 화면을 열어도 표식은 남는다). 다시 채점을 시작하면 표식을 되살린다(null로 되돌림). 다시 채점 중에는 세션 점수·완료 시각도 비운다.
  - 다시 채점은 새 `interview_evaluation` 작업이며 채점 공급자(`evaluation_provider`·`evaluation_model`)를 덮어쓴다. 완료된 세션에 다시 평가할 답변이 없으면 시작하지 않는다.
  - (v4.3, A1 변경 — 확정 2026-11-05 (사용자)) **"다시 채점"과 "채점 작업 다시 시도"는 다른 동작이다.** 다시 채점 = 새 작업(C-11.4 경우 ②). 채점 작업이 `failed`일 때의 다시 시도 = 같은 행을 다시 엶(경우 ①, 공용 재시도 API). **공급자는 둘 다 누른 시점의 활성 공급자다.** 다른 점은 경우 ①이 같은 작업 행을 쓰고, 활성 공급자·등급이 작업에 기록된 것과 같을 때만 완료 단계를 건너뛴다는 것뿐이다(다르면 처음 단계부터). 화면(UX S-22·S-37)에는 **"다시 채점" 하나만** 둔다. 위 "평가 다시 시도"(`not_scored` 답변)도 화면에서는 다시 채점과 같은 동작이다. 경우 ①은 API에 남지만 채점 화면에서는 노출하지 않는다.
- 비용·지연: 응답 답변당 입력 약 11.5k(캐시 예열 시 공통 프리픽스 캐시 읽기) + 출력 약 3k → **답변당 약 $0.036**, 5답변 + 캐시 쓰기 1회 ≈ **$0.20**. 병렬 20~35초. 미응답 질문은 비용 없음.

### AI-07 세션 종합 피드백
- 관련 기능: F-P3-06, F-P3-07 / 관련 화면: 면접 결과 화면(종합), 지원 프로젝트의 세션 목록
- 목적: 세션 전체 강점·약점 요약과 다음 연습 추천을 제공하고 세션 점수 자리를 둔다.
- 트리거: 채점 작업에서 AI-06이 모두 끝난 직후. **응답된 질문이 0개면 호출하지 않는다**(세션 `score_status = 'not_scored'`, `unanswered_count = question_count`, `session_feedbacks` 행 없음. 화면 문구 "답변이 없어 평가할 내용이 없습니다").
- 입력 컨텍스트: 질문 목록(`question_text`, `source_kind`, `anchor`, `intent`, `target_requirement_ids`), 응답된 질문의 `answer_evaluations.result`(`criteria` key·grade·reason, `strengths`, `improvements` — 개선 답변 예시 제외), **미응답 질문 ref 목록**, `interview_type`, `data_sufficiency`, 세션 `weak_requirement_ids`. 경력 팩은 넣지 않는다. 항목별 등급 분포(`criteria_summary`)는 서버가 계산해 넣는다.
- 처리 방식·모델: 단일 호출, **기본 등급**, 중간 사고 설정.
- 응답 모드: AI-06과 같은 비동기 작업의 마지막 단계(10~15초). **채점 작업 전체 30~50초**(목표 60초).
- 프롬프트 전략: 반복 패턴 우선, 강점·약점마다 질문 ref. 미응답은 내용 평가 없이 "미응답 N문항"으로만 언급하고 `retry_question`을 추천할 수 있다. 다음 연습 3종: `retry_question`(같은 질문 세트로 재응시, F-P3-08 Should — MVP에서는 "이 질문을 다시 연습해 보세요" 문구), `focus_session`(특정 요건·주제·유형으로 새 세션), `add_data`(답변에서 말한 경험을 커리어 정리에 기록).
- 출력 스키마:
  ```json
  {
    "schema_version": 2,
    "headline": "프로젝트 성과 수치는 잘 제시했지만, 본인 기여를 팀 성과와 구분하는 연습이 필요합니다.",
    "overall_strengths": [ { "text": "성과를 수치로 말하는 습관이 있습니다.", "question_refs": ["Q-1", "Q-3"], "related_criteria": ["specificity"] } ],
    "overall_weaknesses": [ { "text": "세 답변에서 '팀이' 주어로 말해 본인 역할이 흐려졌습니다.", "question_refs": ["Q-1", "Q-2", "Q-4"], "related_criteria": ["specificity"] } ],
    "unanswered_note": "미응답 1문항(5번 질문)은 답변이 없어 평가하지 않았습니다.",
    "next_practice": [
      { "type": "focus_session", "text": "Kafka·비동기 처리 요건 중심으로 직무 면접 3문항을 연습해 보세요.", "requirement_refs": ["REQ-7"], "interview_type": "job" },
      { "type": "add_data", "text": "답변에서 말한 '장애 대응 매뉴얼 작성'은 커리어 정리에 없습니다. 기록해 두면 서류와 직무 면접에도 쓰입니다.", "question_ref": "Q-2" }
    ],
    "session_score": { "status": "pending_method", "value": null, "max": null, "method_version": null, "rationale": null, "counted_questions": 4, "unanswered_count": 1 }
  }
  ```
  - 저장 시 서버가 `criteria_summary`(`[{key, distribution}]`)를 붙인다. `question_refs`는 이 세션 질문만(V-1).
  - (v4.3, 구현 반영) 저장 키: `question_refs` → `question_ids`, `question_ref` → `question_id`, `requirement_refs` → `requirement_ids`(UUID). 문장 속 `Q-n`은 "n번 질문", `REQ-n`은 요건 내용으로 바꾼다(C-3). AI-07 결과에는 근거 행이 없다.
  - (v4.3, 구현 반영) 미응답 처리: `unanswered_note`는 서버 문구로 덮어쓴다(위 예시 형식). 강점·약점·다음 연습(`retry_question` 제외)·`headline`이 미응답 질문을 언급하면 그 항목을 버린다(`headline`은 고정 문구로 교체). 제출했지만 평가에 실패한 질문도 강점·약점 참조에서 빼고, `add_data`의 질문 참조는 평가된 답변만 허용한다.
  - (v4.3, A9) 다시 채점 때마다 다시 생성한다(AI-06 "다시 채점"). 다시 채점을 시작하면 종합 행은 생성 대기로 돌아가고(이전 결과는 새 결과가 저장될 때까지 행에 남음), 종합이 실패하면 세션은 채점 실패다.
- 저장: `session_feedbacks.result`(jsonb) + AI 출력 공통 메타. **(v4.1) 채점 공급자**: AI-06/AI-07 작업은 `interview_sessions.evaluation_provider`·`evaluation_model`을 기록한다(다시 채점·채점 작업 다시 시도 모두 그때의 활성 공급자로 덮어씀, C-11.4). 질문 공급자와 채점 공급자는 활성 공급자를 중간에 바꾸면 다를 수 있다(F-AI-03 (2)). **세션 점수 (데이터 모델 v3 확정)**: `interview_sessions.score_value`, `score_max`, `score_status`, `score_method_version`, `score_rationale`, `score_counted_count`, `unanswered_count`(세션 목록·모의 면접 메뉴 F-P3-15 표시용). 모델 출력 `session_score`는 저장 시 이 컬럼으로 매핑. 근거가 필요한 항목은 `evidence_links`(`owner_type = 'session_feedback'`).
- 품질 기준: 강점·약점 각각 질문 ref 1개 이상(100%), 답변별 평가와 모순되는 종합 0건(서버 대조 경고), 미응답 질문 내용 언급 0건, 사람 평가 "다음에 뭘 연습할지 알겠다" 4/5 이상 `[가정]`.
- 비용·지연: 입력 약 7k~10k + 출력 약 2.5k → **약 $0.045/세션**, 10~15초.

### (재사용) 같은 질문 세트로 재응시 — F-P3-08 (Should)
- 새 `interview_sessions` 행(`source_session_id`)을 만들고 질문을 **AI 없이 복사**한다(`interview_questions.copied_from_question_id`, 근거 링크도 복사). 답변 작성·제출·채점은 일반 세션과 같다(AI-06/07). 결과 화면에서 이전 세션과 점수·등급을 나란히 비교.
- 사용량 (v4): 차감 없음. 채점 호출이 미터 `interview_evaluation`으로 기록된다.

## 5. Should 기능 개요 (확장 가능한 수준)

### AI-08 STAR 필드 다듬기 (F-P1-08, Should) — v3 범위 축소
- 목적: 폼에서 상세 내용의 STAR 필드 **하나**(상황/과제/행동/결과/회고 및 배운 점)를 쓰다가 "다듬기"를 누르면, 문장 정리 제안과 빠진 정보 질문을 받는다. 대화형 작성은 AI-12가 맡는다.
- 입력: 대상 필드 원문 + 같은 상세 내용의 다른 필드(맥락용, 읽기 전용) + 프로젝트 이름·역할 + 결과 필드면 연결 정량 성과. 약 0.5k~1.5k 토큰. 다른 프로젝트는 넣지 않는다. `draft` 상태여도 동작(작성 도중 쓰는 기능).
- 처리·모델: 단일 호출, **경량 등급**(한국어 문장 품질이 공급자 평가에서 부족하면 그 공급자만 기본 등급으로 매핑). 미터 기능 `writing_assist`.
- 응답 모드: 동기(3~6초). 필드 옆 패널에 제안, 수락·거절. 수락 전 원문 불변(NFR-AI-05).
- 출력 스키마:
  ```json
  {
    "schema_version": 2,
    "target": { "source_type": "project_detail", "ref": "DET-5", "field": "action" },
    "suggested_text": "…원문 사실만 재구성한 문장…",
    "changes": [ { "kind": "restructure", "note": "본인 행동을 문장 앞으로 옮김" } ],
    "questions": [ { "text": "개선 폭을 수치로 알고 계신가요?", "target_field": "achievements.value_after" } ],
    "move_suggestions": [ { "text": "…팀 전체가 한 일로 보이는 문장…", "to_field": "situation" } ]
  }
  ```
  - `move_suggestions`: 행동(A)에 섞인 팀 맥락 문장을 상황(S)으로, 결과에 섞인 회고를 회고 및 배운 점으로 옮기자는 제안(v2의 `split_suggestion` 대체). 옮기기도 사용자 수락 후에만.
- 가드레일: 수치 가드(원문에 없는 숫자 0개), 원문에 없는 기술·명사 추가 금지(V-9d·V-9e와 같은 규칙을 원문 기준으로 적용). 회고 및 배운 점 필드는 회고 표현을 유지(사실 문장으로 바꾸지 않음).
- 저장: `ai_suggestions`(수락/거절 기록 — F-COM-06 품질 지표용). v3 `target` 형식에 맞게 `source_type`/`source_field` 값 확장 필요(data-architect).

### AI-09 커리어 채팅 (F-P2-08, Should, D-04)
- 목적: 지원 프로젝트의 JD와 경력 데이터를 맥락으로 질의응답(대화 단위 = 지원 프로젝트, PRD v2 F-P2-08).
- (v3) **AI-12와의 관계**: 스트리밍 대화 턴·메시지 저장·메시지 상한·이어하기 같은 **대화 기반은 AI-12와 공유**하되, 목적이 다르다. AI-12는 커리어 데이터를 **만드는** 대화(정리 패치 + 사용자 저장), AI-09는 지원 전략을 **묻는** 대화(정리 단계 없음, 커리어 데이터 읽기 전용, 근거 인용). 테이블도 별도(AI-12 `writing_chats`, AI-09 `chat_threads`). 근거 인용은 STAR 필드 단위, 회고 및 배운 점은 C-9의 회고 표현으로만.
- 입력: 경력 팩 전체 + JD 요건 + 최신 인사이트 결과(있으면, 요약형) + 대화 기록. 대화 기록은 최근 10턴 또는 6k 토큰까지 원문, 그 이전은 **누적 요약**(경량 등급로 10턴마다 갱신)으로 대체 `[가정]`. RAG 불필요(경력 팩 전체 주입).
- 처리·모델: **기본 등급**, 낮은 사고 설정. 도구 없음. 프리픽스(system + 경력 팩 + JD + 인사이트)를 캐시해 메시지당 입력 비용을 낮춘다.
- 응답 모드: **스트리밍 텍스트**. 본문에 인라인 근거 표식(예: `[[PRJ-3]]`, `[[REQ-2]]`)을 쓰게 하고, 서버가 스트림 완료 후 표식을 검증·근거 칩으로 변환(존재하지 않는 표식은 제거). (v4.3) 표식은 칩으로만 보이고 별칭 글자는 저장·표시 문장에 남기지 않는다(C-3). 스트리밍 중에는 표식을 감춘다 `[가정]`. 구조화 출력은 쓰지 않는다(대화 자연스러움, 스트리밍 단순성).
- 저장: `chat_threads`(`application_project_id`, `rolling_summary`, `summary_updated_at`) / `chat_messages`(`role`, `content`, `career_snapshot_hash`, `model`, `usage`). 근거는 `evidence_links`(`owner_type = 'chat_message'`).
- 가드레일: 근거 없는 질문 → "입력된 데이터로는 판단할 수 없습니다" + 보완 안내(F-P2-08). 커리어와 무관한 요청 → 정중히 범위 안내. 수치 가드 V-5 적용(위반 수치는 응답 완료 후 표시 단계에서 경고 배지). 채팅으로 데이터를 수정하지 않는다(MVP는 읽기 전용).
- 비용·지연: 메시지당 입력 약 15k(대부분 캐시 읽기) ≈ $0.01 + 출력 0.6k ≈ $0.006 → **약 $0.02**, 첫 글자 2~4초. (v4) 서비스 메시지 한도 없음(D-34). 미터 `chat_reply`.

### AI-10 꼬리 질문 (F-P3-05) — `[보류]`
- PRD v2에서 면접이 일괄 방식(질문 전체 생성 → 답변 전체 작성 → 1회 제출)으로 바뀌어 "직전 답변을 보고 바로 묻는" 꼬리 질문이 흐름에 맞지 않는다(D-08 해소). MVP에서 설계·저장 구조를 모두 뺀다.
- 재검토 시 후보: 제출 후 결과 화면에서 "이 답변에 대해 면접관이 더 물어볼 질문" 목록을 AI-06 출력에 추가하는 방식(별도 호출 없음, 답변 비용 소폭 증가). 지금은 설계하지 않는다.

---

## 6. 품질 평가 체계 (출시 전·운영)

- **내부 평가 세트 (NFR-AI-04)**: 가상 프로필 × JD 최소 30쌍 `[가정]`. 직군 IT/개발·기획/PM·마케팅 각 10쌍. 프로필마다 "정상 버전"과 "빈약 버전(성과 수치 일부 삭제, 프로젝트 1개)"을 두어 날조·자리 표시 동작을 검증한다. JD 중 5개는 영문, 3개는 인젝션 문구 포함.
- **면접 평가 세트**: 위 30쌍에서 질문당 답변 3종(좋은 답변 / 모호한 답변 / 데이터와 불일치하는 답변)을 사람이 작성하고, 사람 평가자 2인이 루브릭으로 등급을 매긴 정답 세트. (v2) 직무·컬처핏 각각 구성하고, 컬처핏은 `data_sufficiency` `ok`/`thin`/`none` 프로필을 모두 포함한다. D-14 확정 후 사람 평가자의 점수를 추가해 점수 일치도를 잰다(NFR-AI-04).
- **(v2) 자소서 근거 선택 세트**: 프로필마다 기본 3문항 + 사용자 추가 문항 1개에 대해 사람이 "가장 적합한 프로젝트"를 고른 정답(AI-04 선택 품질 기준). 메모 있음/없음 두 버전으로 지원 동기·포부의 자리 표시 동작을 검증한다.
- **(v4.2) 공급자 평가와 출시 조건 (NFR-AI-04, D-38, 사용자 결정 UB-3)**:
  - 위 평가 세트 전부를 **공급자별 기본 매핑(C-10.1)으로 각각** 돌린다. 기준은 공급자와 무관하게 같다(근거 없는 주장 2% 이하, AI 작성 대화 날조 0%, 기능별 품질 기준).
  - **출시 조건: Gemini·Claude·OpenAI 세 공급자가 모두 MVP AI 기능 전체에서 기준을 통과해야 출시한다.** 공급자별로 따로 여는 게이트가 아니며, 일부 공급자만 열고 나머지를 "준비 중"으로 두는 경로는 없다.
  - 작업 순서: **Gemini(무료 등급 모델) → Claude → OpenAI**. 순서는 작업 진행 순서일 뿐 공개 순서가 아니다.
  - 공급자별로 추가로 보는 지표: V-3·V-9b 인용 거부율, V-6 스키마 재검증 실패율, 안전 차단 오탐(갈등·실패·건강 언급 사례), 한국어 사람 평가(자소서 문체, 면접 어투), 호출당 토큰(7.2 대비).
  - **기능 단위 미달 시**: 통과할 때까지 ① 그 공급자용 프롬프트 변형(`prompt_version` 공급자 접미사) 조정 → ② 그 공급자의 그 기능을 고성능 등급으로 승급(D-AI-12) → 재평가를 반복한다. 고성능 승급은 그 공급자 사용자의 토큰 비용을 높이므로 7.2 토큰 추정과 함께 기록한다. 그래도 통과하지 못하면 출시 일정 문제로 product-planner에게 올린다(공급자를 빼는 결정은 사용자 결정 사항).
  - **무료 등급 경로 테스트**: Gemini 무료 키로 C-12 순차 경로·백오프·원인 2 안내(초기화 시각)를 통합 테스트.
  - 재평가 조건: 매핑 모델 변경, 공급자 모델 지원 종료, 프롬프트 버전 변경.
  - 내부 평가는 **운영자 키**로 하며 사용자 키를 쓰지 않는다(NFR-KEY-08).
- **(v3) AI 작성 대화 평가 세트**: 가상 사용자 대화 20건 이상(AI-12 품질 기준의 6개 사용자 유형). 목표: 날조 0%, 누락 15% 이하, 본인/팀 혼동 0건, 민감정보 반영 0건. 정리 모델·응답 모델 교체(D-AI-11) 때마다 재실행.
- **(v3) STAR 프로필**: 평가용 가상 프로필을 STAR 상세 내용 + 회고 및 배운 점 구조로 다시 만들고, 회고 및 배운 점에만 수치·주장이 있는 함정 데이터를 넣어 V-8(회고 근거 제한)을 검증한다.
- **(v2) 인사이트 없는 경로**: 모든 평가는 인사이트가 **없는** 상태를 기본으로 돌리고, 인사이트가 있는 상태는 비교용으로만 돌린다(인사이트가 선택 행동이므로).
- **자동 지표**: 근거 검증 통과율, 수치 가드 위반 수, 근거 없는 주장 비율(검증 통계 + 사람 표본 검수), 스키마 실패율, 글자 수 범위 준수율, 질문 구성 규칙 위반률, 지연 p50/p90, 호출당 토큰.
- **사람 평가**: 기능별 품질 기준(각 카드)의 만족도 항목. 출시 전 1회 + 프롬프트 버전 변경 시마다.
- **회귀 방지**: `prompt_version`을 올릴 때마다 평가 세트를 다시 돌려 이전 버전과 비교한다. 모델 매핑 변경(C-10.1)도 공급자별로 같은 절차.
- **운영 지표**: F-COM-06 좋아요/별로예요를 `prompt_version`·`model`별로 집계, `validation_report` 집계로 근거 없는 주장 비율 추적(원문 없이).

---

## 7. 호출당 토큰 추정 (v4 BYOK — 사용량 미터 추정과 토큰 효율의 근거)

v4에서 AI 비용은 **사용자가 자기 키로 부담**한다(운영자 비용 0, PRD 6.5). 이 장은 운영자 예산이 아니라 (1) 사용량 미터의 예상 비용이 어떤 규모인지, (2) NFR-AI-08 토큰 효율 점검의 기준선을 보여 준다. 실제 기록은 항상 공급자가 보고한 토큰이다(C-13).

### 7.1 가정
- 경력 팩 7k 토큰(범위 3k~18k), JD 문장 2.5k, 요건 목록 1~1.5k, system 1.5k~3k, 사고 토큰은 낮은 사고 설정 기준 0.5k~1.5k(출력에 포함).
- 공급자별 한국어 토큰 수 차이 ±30~50% `[가정]`(C-10.4). 아래 수치는 범위의 중앙값이다.
- 캐시: 같은 작업 안의 연속 호출(AI-04 문항, AI-06 답변, AI-02 배치, AI-12 턴)은 앞부분이 캐시될 수 있다. 캐시 비율은 공급자마다 다르다(C-10.3).

### 7.2 기능별 호출·토큰 (1회 실행 단위)

| 기능 (미터 표시) | 실행 단위 | 호출 수 | 입력 토큰 (그중 캐시 가능) | 출력 토큰 (사고 포함) | 모델 등급 |
|------------------|-----------|---------|----------------------------|------------------------|-----------|
| 연결 확인 | 키 등록·다시 확인 1회 | 1 (+ 무료 조회) | ~0.05k | ≤ 0.01k | 기본 |
| 요건 추출 (AI-01) | JD 1건 | 1 | 4k | 1.5k~2.5k | 경량 |
| 인사이트 (AI-02) | 생성 1회 (요건 15개) | 3 (배치 2 + 종합) | 35k (팩 반복분 ~14k) | 7k | 기본 |
| 경력기술서 (AI-11 + AI-03) | 초안 1건 | 1~2 | 16.5k (AI-11 5k 포함) | 6k | 경량 + 기본 |
| 자기소개서 (AI-04) | 문항 1개 | 1 + 보정 0~1 | 11k (+보정 2.5k) | 2k (+1k) | 기본 |
| 면접 질문 (AI-05) | 세션 1회, 5문항 | 1 | 12.5k | 3k | 기본 |
| 면접 채점 (AI-06 × 응답 + AI-07) | 제출 1회, 응답 5개 | 6 | 70k (팩 반복분 ~45k) | 17.5k | 기본 |
| AI 작성 대화 (AI-12) | 대화 1회, 사용자 발화 12개 | 24 (턴당 응답 + 정리) | 130k (대화 누적분 대부분 캐시 가능) | 11k | 기본 + 경량 |
| (Should) 필드 다듬기 (AI-08) | 1회 | 1 | 1k | 0.5k | 경량 |
| (Should) 커리어 채팅 (AI-09) | 메시지 1개 | 1 | 15k (대부분 캐시 가능) | 0.6k | 기본 |

- 큰 항목은 면접 채점과 AI 작성 대화다. 토큰 효율 수단(NFR-AI-08): 동일 입력 재사용(C-6), 고정 프리픽스 순서(C-8), AI-07에 경력 팩을 넣지 않음, AI-12 정리 호출에 대화 전체 대신 최근 발화 + 현재 정리 결과만 넣는 최적화(평가 세트에서 누락률 확인 후) `[가정]`.

### 7.3 사용자 1명의 기능별 예상 비용 (공급자별)

| 기능 | Claude 매핑 (7.2 × 가격표 초안) | Gemini 무료 등급 | Gemini 유료 / OpenAI |
|------|----------------------------------|------------------|----------------------|
| 연결 확인 | $0.0001 미만 | 청구 없음 (일일 요청 1회 소모) | 가격표 확정 후 |
| 요건 추출 | 약 $0.002 | 청구 없음 | 같음 |
| 인사이트 | 약 $0.14 | 청구 없음 | 같음 |
| 경력기술서 | 약 $0.077 | 청구 없음 | 같음 |
| 자기소개서 문항 1개 | 약 $0.047 | 청구 없음 | 같음 |
| 면접 1세션 (질문 + 채점) | 약 $0.31 | 청구 없음 (요청 약 7회) | 같음 |
| AI 작성 대화 1회 | 약 $0.11 (상한 40메시지 시 약 $0.19) | 청구 없음 (요청 약 24회) | 같음 |

- **예시 (참고용, 상한 아님)**: 지원 활동 중인 한 달(지원 프로젝트 3개, 인사이트 2, 경력기술서 1, 자소서 7문항, 면접 2세션, AI 작성 대화 3회)을 Claude 매핑으로 쓰면 약 $1.6.
- **Gemini 무료 등급의 실제 제약은 비용이 아니라 요청 수**다. 위 예시는 한 달 동안 요청 약 110회로 분산되면 무료 일일 한도 안이지만, AI 작성 대화(요청 약 24회)·면접 채점(약 7회)을 하루에 몰아 쓰면 일일 한도에 닿을 수 있다 `[가정: 무료 등급 일일 요청 한도는 공급자 정책 확인]` → C-12 순차 경로와 C-11 원인 2 안내.
- (v4.3) Claude 칸은 v4.2 가격표 초안(Sonnet 캐시 읽기 0.20) 기준이다. 첫 버전 `v2026-10-28`은 Sonnet 캐시 읽기가 0.10이라 캐시 비중이 큰 기능(AI-12, 채점)은 몇 % 낮아진다 — 상한 쪽 추정으로 둔다.
- (v4.3) Gemini 유료·OpenAI 칸은 C-13 첫 버전 단가로 기본 등급 기준 대략 **Gemini 유료(`gemini-3.8-flash`) ≈ Claude 칸 × 0.35~0.4, OpenAI(`gpt-6.1-terra`) ≈ Claude 칸 × 0.5** `[가정: 입력·출력 단가 비율로만 환산, 공급자별 토큰 수 차이 ±30~50%(C-10.4)와 캐시 비율 차이는 반영하지 않음]`. `gemini-3.8-flash`는 `v2027-01-01`부터 단가가 2배가 되어 약 × 0.75가 된다. 실제 값은 항상 공급자가 보고한 토큰으로 기록한다(C-13).

### 7.4 품질·안전 목적 제한 (D-34 유지)

| 제한 | 값 | 목적 |
|------|-----|------|
| AI 작성 대화 메시지 상한 | 40 (사용자 + AI 합계, 시작 인사 제외 — A5, `writing_chats.message_count`) | 긴 대화일수록 정리 정확도 하락, 맥락 토큰 증가(사용자 비용 보호). 상한 도달 시 저장 또는 새 대화 |
| 입력 길이 상한 | 공고 원문 50,000자, 자소서 메모 300자, 답변·메시지 4,000자 (데이터 모델) | 입력 과다(F-AI-08 (7)) 예방 |
| 지원 프로젝트당 작성 중 면접 세션 | 1 | v3 유지 |
| 같은 대상의 같은 AI 작업 동시 실행 | 1 | 중복 호출 방지 |
| 동일 입력 결과 재사용 | `input_hash`(공급자·모델 포함) | 같은 공급자·모델·입력이면 새로 호출하지 않음 |
| 서버 남용 방지 요청 제한 | 구현 시 정함 `[가정]` | 사용자에게 "한도"로 보이지 않음 |

- v3까지의 서비스 무료 한도(월 인사이트 10 / 초안 20 / 면접 5 / AI 작성 대화 10), 사용량 예약·확정·환불, "이번 달 N회 남음"은 **모두 폐기**했다(D-34).

---

## 8. 결정 필요 목록 (AI 설계)

| ID | 질문 | 선택지 | 권고와 이유 |
|----|------|--------|-------------|
| D-AI-01 | 비동기 작업 실행 인프라 | (a) Next.js `after()` + 함수 실행 시간 연장, 단계별 분할 (b) 내구성 큐/워크플로 서비스 (c) Supabase Edge Functions | **확정 (리뷰 T-14): (a)로 시작.** 실패율 1% 초과 시 (b). (v4) 실패율에서 사용자 키·한도 원인(`provider_limit`, `user_account`)은 제외 |
| **D-AI-12** | 고성능 등급의 쓰임 | (a) MVP 기본 배정 없음, 평가 미달 기능의 공급자별 승급용 (b) AI-07 종합 피드백·AI-02 종합에 기본 배정 | **(a)**. 사용자가 비용을 내므로 기본 배정은 최소로 둔다(NFR-AI-08). (v4.2) UB-3로 세 공급자 모두 통과가 출시 조건이 되었으므로, 프롬프트 조정으로도 미달인 기능을 통과시키는 수단으로 쓴다 |
| **D-AI-13** (신규) | 429 중 분당/일일 구분이 안 될 때 | (a) 분당으로 보고 재시도, 상한까지 연속 실패면 일일 가능성 함께 안내 (b) 바로 일일로 안내 | **(a)**. 일일로 오판하면 사용자가 하루를 기다린다. 재시도 상한(120초)이 짧아 손해가 작다 |

**해소·이관·폐기**

| ID | 결과 |
|----|------|
| D-AI-02, D-AI-11 (Sonnet → Haiku 전환) | **대체** — PRD D-31 공급자별 고정 모델 매핑(C-10.1). 등급 변경은 평가 세트 기반 운영자 매핑 변경 |
| D-AI-10 (AI 작성 대화 월 10회) | **폐기** — PRD D-34(BYOK로 서비스 한도 없음). 메시지 상한 40만 유지 |
| D-AI-08 (재응시 차감) | **폐기** — D-34 |
| D-AI-03 (비용 상한 해석) | **폐기** — D-12 폐기 |
| D-AI-04~07, D-AI-09 | v3까지 해소(기록 유지) |

---

## 9. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|-----------|
| v1 | 2026-10-23 | 최초 작성. PRD v1 기준 Must AI 기능(AI-01~07) 카드, Should 개요(AI-08~10), 공통 설계(C-1~C-8), 비용 시나리오, 결정 필요 D-AI-01~06 |
| v1.1 | 2026-10-23 | 데이터 모델 v1 정렬(A-1~A-39, 근거는 `evidence_links`에만, 경력 팩 `complete`만, D-AI-04 (b)) |
| v2 | 2026-10-23 | PRD v2 반영. 인사이트 의존 제거, AI-11 신설, AI-04 근거 선택·기본 3문항·메모, P3 일괄 방식·유형별 질문·점수 자리, AI-10 `[보류]`, 데이터 최소 기준 게이트·`data_sufficiency`, D-AI-07~09 |
| v2.1 | 2026-10-23 | 데이터 모델 v2 정렬(A2-1~A2-24) |
| v3 | 2026-10-23 | PRD v3 반영. AI-12 프로젝트 AI 작성 대화(V-9), 경력 팩 STAR 개편, C-9 회고 사용 규칙·V-8, AI-08 축소, D-AI-10·11 |
| v3.1 | 2026-10-24 | 리뷰 라운드 1 수정(R-01, R-02, R-04, R-05, R-09~R-11, R-18), 데이터 모델 v3 정렬 |
| v3.2 | 2026-10-24 | 리뷰 라운드 2 + 사용자 결정 U-1~U-10, 데이터 모델 v3.2(11.4) 정렬. 필드명 "회고 및 배운 점", 게이트 진입(U-5), 검토 상태 `accepted` |
| v3.2a | 2026-10-24 | 확인 패스(R-31 게이트 대화의 요건 참고, R-33 태그·요청 정리) |
| v4 | 2026-10-26 | **PRD v4 BYOK 반영.** (1) **C-10 공급자 추상화**: 어댑터 계층, 경량/기본/고성능 고정 매핑(D-31, OpenAI·Gemini 모델명 `[가정]`, Gemini 기본 등급은 무료 등급 제공 모델), 공급자별 구조화 출력(OpenAI JSON Schema strict / Gemini responseSchema / Claude 구조화 출력·strict 도구) ↔ 정본 스키마 최소 공통분모 규칙 + 서버 재검증, 스트리밍·usage·프롬프트 캐시 차이(캐시 예열은 Claude만), 공급자별 품질 위험, 키 검증 호출 2단계. (2) **C-11 오류 분류**: F-AI-08 7원인 ↔ 공급자 응답 매핑, 신규 `error_code`(`daily_quota_exhausted`, `billing_required`, `key_invalid`, `model_not_available`, `provider_unavailable`, `safety_blocked`), `error_category` 재분류, 재시도 여부, Gemini 일일 한도 초기화 시각 계산(태평양 자정 → KST, tz 계산). (3) **C-12 무료 등급 순차 경로**(D-37): AI-02·AI-06·AI-12 순차, 호출 간격, 지수 백오프(호출당 4회·작업당 120초), 성능 목표 2배. (4) **C-13 사용량 미터 기록**(D-17 재정의): 호출·시도 단위 기록 형식, 예상 비용 식, 실패 호출 처리, 가격표 형식·초안(Claude만 수치, OpenAI·Gemini 확정 대기). (5) **차감·예약·서비스 한도 전부 삭제**(D-34): C-6 사용량 표, AI-12 월 10회·차감, 재응시 차감, AI-04 차감 문구, 7장 운영자 비용 시나리오. 7장을 호출당 토큰 추정·사용자 기능별 예상 비용·품질 목적 제한으로 교체. (6) 각 카드 모델을 등급 표기로, D-30 요건 추출 시점(키 없이 만든 JD는 첫 AI 기능에서 선행), 키 없을 때 게이트 미도달. (7) 공급자별 평가 계획(6장, D-38). (8) 결정: D-AI-12·13 신설, D-AI-02·10·11·08·03 대체·폐기 |
| v4.1 | 2026-10-26 | BYOK 리뷰 라운드 1 반영. **R-37** 데이터 모델 v4 rename(A4-1 `feature`, A4-2 `key_verification`, A4-3~7 `*_usd_per_mtok` + 장문 구간 단가 2개, A4-8 `retry_count`), C-11.1에 `key_missing` 행, `failure_cause`(7값)·`quota_resets_at`·`retry_after` 저장 위치 명시, `mark_provider_key_invalid` RPC, `[제안]` 표식 제거, 머리글 데이터 모델 v4, AI-11 "무차감"·AI-05 "사용량 미차감" 삭제. **R-38** C-10.5 저장 규칙: 인증 통과 + 한도(1·2)·장애(6)면 `status = needs_check`로 저장, 키 무효·결제 필요·모델 불가면 저장 안 함, 검증은 재시도 없음. **R-39** C-11.3 재시도 표 하나로 통일(원인 1 = 호출당 4회, 원인 6 = 2회, 작업당 대기 120초, 등급 공통, 스트리밍은 첫 토큰 전 오류만 재시도), C-12는 이 표 참조. 미터 범위 이번 달만·기능별·공급자별(UB-2 (b) `[가정]`). 요청 절 재작성. 데이터 모델 v4.1 반영: `save_provider_key(verification_result = valid | limited)`·`record_provider_key_check` 결과 규칙, 면접 세션 `question_provider`/`question_model`(AI-05)·`evaluation_provider`/`evaluation_model`(AI-06/07, 재채점 시 덮어씀) |
| v4.1a | 2026-10-27 | BYOK 리뷰 라운드 2: R-37 잔여 — C-6 `error_code` 범주 문단을 C-11.1 값과 `error_category` 5값으로 교체(`model_unavailable`·`refused` 제거). 요청(ux) 7의 게이트 진입 배너(R-32) 항목 종료(UX v4.2b 반영) |
| v4.2 | 2026-10-28 | 사용자 결정 반영. **UB-3**: 세 공급자(Gemini·Claude·OpenAI) 모두 평가 세트 통과가 출시 조건 — 공급자별 공개 게이트와 "준비 중" 경로 삭제, 작업 순서 Gemini → Claude → OpenAI 유지, 미달 기능은 공급자별 프롬프트 조정 → 고성능 등급 승급(D-AI-12)으로 통과할 때까지 반복(6장, C-10.1, AI-06·AI-12 문구, D-AI-12). **UB-2**: 미터 범위 이번 달만·기능별·공급자별 확정 |
| v4.3 | 2026-11-05 | **v4.3 — 백엔드 구현 반영(2026-11-05).** 기준 PRD v4.3 / UX v5.3 / DM v4.2. **사용자 확정 15건**: A1(C-11.4 — A1 변경 후: 모든 다시 시도·재실행 = 활성 공급자, 같은 행 다시 시도는 공급자·등급이 다르면 처음 단계부터), A2(AI-02 생성 중 요건 편집 금지, F-P2-03 생길 때 적용), A4(AI-03 실패 블록 보존 없음, 새 초안), A5(AI-12 상한 40에서 시작 인사 제외), A9(AI-06·AI-07 다시 채점 범위·`result_viewed_at`), A10(C-3 V-4·AI-02 희망 정보는 근거 아님), A11(4.1 모든 직무 질문 사실 전제 제한), A12(AI-04 "최대 10% 초과까지 통과"), A13(C-6·AI-03 생성 요청 안에서 추출 안 함), A14(C-11.3·AI-12 스트리밍 대기 재시도 없음), A15(AI-12 거절 소속 제안 미저장), A16(AI-01 연차 숫자 검사 안 함), A17(AI-03 tone `concise`/`detailed`), A21(AI-03·AI-04 생성 직후 안내 미저장), A23(AI-11·AI-03 대체 선택 없음, `selection_origin = user`). 연관 반영: A6(AI-12 `abandoned → active`), A18(C-1·AI-12 `project_fields` → S-10), A19·A20(C-10.5), A22(AI-05 `question_validation_report`·`question_usage`), A24(C-3 근거는 RPC로만). **B 문서 반영**: C-6 진행 단계 `prepare`·`synthesize_regen`·`complete`(표로 정리), 동기 5초 이하 요청 안 대기·무료 6초 간격 요청 안 대기, 요청 범위 작업의 일반 재시도 제외, C-3 V-5 비교 규칙과 기능별 예외(스트리밍 서류 치환, 면접 질문 폐기, AI-06 재생성 실패 시 첫 평가), 저장 키 UUID 이름 변환 목록, **별칭 노출 금지와 표시 이름 규칙**(AI-02 예시 "PRJ-3" → 프로젝트명, AI-03·AI-04 `notes_for_user`, AI-07 `unanswered_note` 예시도 수정), C-5 미등록 자리 표시, C-1 `career_snapshot_hash` = 포함 행 내용 필드, C-4 `prompt_version` 표기, AI-04 이벤트 순서 `adjusting_length → validated`·블록은 `validated`에서 교체, AI-05 질문 단위 가능성 검사, AI-06 `consistency_notes` 모양·`interview_answer` 근거 행, AI-02 같은 system 블록·빠진 요건 `no_evidence`·latest만 재사용, AI-12 V-9 해석(위임 발화, situation 후보, 고유명사 상수)·`turn_started` 이벤트·`last_extracted_sequence`, C-10.2 Gemini `responseJsonSchema`, C-10.5 OpenAI 16토큰·검증 상한 시간, C-11.2 미분류 오류 처리. **C**: C-14 출력 상한 신설 `[가정]`. **D**: C-10.1 모델 매핑 확정(B-3), C-13 가격표 첫 버전(9모델, `v2026-10-28`·`v2026-12-01`·`v2027-01-01`, Sonnet 캐시 읽기 0.10 정정) + 장문 캐시 단가 2개를 비용 식에 반영, C-11.2 오류 표 갱신(OpenAI 잔액·지출 한도 429, 403 지역, Gemini 402·`quota_exceeded`, Claude 402), Gemini 무료 6초 `[가정]` 유지 근거, 7.3 공급자별 비용 환산. 정리: C-1·4.0·AI-04의 v3 잔여 표현(월 한도, 예약, 차감), AI-12 `usage_event_id` 삭제. **리뷰 R-48·R-51·R-52 반영**: R-48 C-11.4를 두 경우 표로 정리(① 같은 행 다시 시도, ② 새 작업 — 이후 A1 변경으로 공급자는 둘 다 활성 공급자), AI-06에 "다시 채점"과 "채점 작업 다시 시도" 구분(화면은 다시 채점 하나). 리더 직접 수정: R-49 C-11.4 경우 ① 동의 필요 코드를 `ai_consent_required`로(DM 2.11.7), R-60 AI-03 tone null = `concise`. R-51 C-6 진행 단계 표에서 화면 문구 제거(UX C-03 기준으로 참조), 채점 작업에 `prepare` 단계가 있음(호출·요건 추출 없음)을 명시, AI-02 카드 진행 단계 문구도 단계 값으로 바꿈. R-52 PRD D-30 갱신에 맞춰 C-6의 AI-04·AI-11 선행 추출 순서 `[가정]`을 "확정 2026-11-05 (팀)"으로, 비동기 작업 `prepare` 추출도 팀 확정으로 표기, product-planner 요청 1 해소. **A1 변경(사용자, 2026-11-05 후속) 반영**: R-48 해석(같은 행 다시 시도 = 처음 공급자) 폐기, C-11.4 표를 "모든 다시 시도·재실행 = 활성 공급자, 같은 행 다시 시도에서 활성 공급자·등급이 작업 기록과 다르면 `step_outputs`를 버리고 처음 단계부터, 같으면 완료 단계 건너뜀"으로 재작성, 동의 필요 거부(`ai_consent_required`)·연결 확인을 활성 공급자·등급 기준으로, `prepare` 선행 추출은 그 실행의 공급자, 다시 시도 시 작업 행·세션 공급자 컬럼 갱신. 0.v43·C-6·C-11.3·AI-05·AI-06·AI-07·요청 절 맞춤. **리뷰 R-63·R-64 반영**: R-63 C-11.4 "이미 저장된 면접 질문·답변 평가도 새 결과로 바꾼다" `[가정]`을 리더 판단 2026-11-05 (a)로 확정(공급자·등급이 바뀐 같은 행 다시 시도는 결과 행 전부 재개방·덮어쓰기, 같으면 실패 행만), data-architect 요청 4 해소. R-64 C-11.4 거부 코드를 DM 2.11.7 경로별로 정리(새 작업 시작 키 없음 `ai_not_connected`, 같은 행 다시 시도 `key_missing`), 근거를 `check_ai_run_allowed`(경로 ③)에서 DM 2.11.7로. R-62 AI 몫: ux-planner 4·product-planner 2에 "(해소)" 표시. 출력 스키마 변경 없음 |

---

