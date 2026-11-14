# jd-raw-text — AI 명세(v4.16)가 다른 문서에 보내는 요청

- 작성: ai-feature-designer / 2026-11-14 / 기준: `docs/planning/03-ai-features.md` **v4.16**
- 입력: `_workspace/00_input/planning-decisions-jd-raw-text.md` (JR-1~JR-4 확정, JR-Q1~JR-Q4 권장안 `[가정]`, JR-Q5 리더 판단 `[가정]`)
- 이름은 받는 문서가 확정한다. 아래 이름은 AI 쪽 권고다.

---

## 1. data-architect (DM v4.16)

### DM-1 인사이트 `result` 모양 (`insights.result`, `schema_version` 1 → 2) — JR-Q2 (a) `[가정]`

AI-02 단계 1이 요건 목록 대신 **1a 식별(경량, 원문에서 요건 문구·`sids`) → 1b 판정(기본, 8개씩 배치 병렬)**으로 돈다(리더 판단 2026-11-14). 최종 결과의 요건 원소 모양:

```json
"requirement_matches": [
  {
    "match_key": "MT-1",
    "requirement_text": "Java/Kotlin 기반 Spring 서버 개발 경험",
    "sids": ["S8"],
    "status": "partial",
    "rationale": "…",
    "missing_aspect": "Kotlin 사용 경험",
    "item_key": "requirement_matches.MT-1"
  }
]
```

- `match_key`: 서버가 1a 검증 뒤 원문 순서(첫 `sid` 번호 오름차순, 같으면 모델 순서)로 `MT-1`…을 붙인다(접두사 `MT-` — 리더 판단 2026-11-14, L-2). **그 인사이트 행 안에서만 유효**하다(호출마다 바뀌는 별칭이 아니므로 UUID로 바꾸지 않고 그대로 저장한다 — C-3 "별칭 참조 필드는 UUID 키로" 규칙의 예외).
- 단계 2 참조: 모델 출력 키 `requirement_refs`(값 `MT-n`) → 저장 키 이름은 DM이 최종 확정한다. AI 권고(리더 동의) **`match_keys`**(옛 `requirement_ids`와 섞이지 않게). 대상: `strengths[]`, `gaps[]`, `strategy.project_priorities[]`.
- 없어지는 것: `requirement_matches[].requirement_id`(UUID), `requirement_ids`.
- `summary_counts`·`data_sufficiency`·`strategy`·`item_key` 규칙은 그대로.

### DM-2 `match_stage_result` 모양

근거를 뺀 단계 1 병합본 = `{match_key, requirement_text, sids, status, model_status, rationale, missing_aspect}` 배열 + 단계 1 `prompt_version`(1a `ai-02.identify.v1`·1b `ai-02.match.v6` 둘) + 1b 배치 정보(옛 그대로).

### DM-2a 진행 단계 값·호출 키

- `ai_jobs.progress.stage` 값에 **`identify`** 추가(`prepare` → `identify` → `match` → `synthesize` → `synthesize_regen` → `validate`). 값 목록을 CHECK·상수로 두면 함께 고친다.
- 사용량 `call_key`: `insight.identify`(경량 등급 1행) + `insight.match.{n}` + `insight.synthesize`. `feature`는 모두 `insight`. 한 인사이트 안에 `model_tier`가 둘(경량·기본) 섞인다.
- 1a 결과는 `ai_jobs.step_outputs`에 남겨 1b·종합 재시도 때 다시 부르지 않는다.

### DM-3 `insights`의 해시 컬럼

- `requirements_hash` → **`raw_text_hash`**. AI 쪽 정의: **모델에 넣은 문장 목록(`sentences`의 `sid`·`text`)의 해시** `[가정]` — 정규화된 `raw_text`만 해시하면 문장 분할 규칙이 바뀌었을 때(R16 선례) `sids`가 달라진 결과를 재사용하게 된다. 이름을 `raw_text_hash`로 두고 내용을 이렇게 정의하는 것을 권고하며, 저장 위치(인사이트 행만 / `job_descriptions`에도)는 DM이 정한다.
- `input_hash = hash(기능, prompt_version, provider, model, career_snapshot_hash, raw_text_hash, 기능별 파라미터)`.
- 과거 행의 `requirements_hash` 값 처리는 DM(JR-Q3).

### DM-4 근거 `source_type` 허용 목록 — JR-Q1 (a) `[가정]`

- 모델 출력·새 `evidence_links` 행에서 **`jd_requirement` 제거**. JD 근거는 `jd_sentence`(`source_id` = `job_descriptions.id`, `source_locator` = `{sid, start, end}`)만.
- 기존 `jd_requirement` 행은 JR-Q3 (a) 변환 마이그레이션이 `jd_sentence`로 바꾼다는 전제로, AI 명세는 "남기고 새 행만 거부"(`profile`·`draft_section` 패턴)를 쓰지 않았다. JR-Q3가 (b)·(c)로 가면 C-3 폐기 문장을 고쳐야 하므로 알려 달라.

### DM-5 `ai_jobs.job_type`·`target_type`·`ai_usage_records.feature` CHECK — JR-Q5 `[가정]`

- `jd_extraction`(job_type·feature), `target_type = 'jd_preview'`: CHECK에 남기고 **새 행 거부**(CF-A3 `career_description` 선례). 진행 중 작업을 닫는 `error_code`는 DM이 기존 값에서 고른다.
- `error_code = 'not_a_jd'`: AI 명세에서 지웠다(C-11·C-6). 과거 `ai_jobs` 행의 값과 `error_category` generated 식의 처리는 DM.
- AI 명세 C-6에 "새 작업을 만드는 `job_type`" = `insight`·`cover_letter`·`writing_chat_turn`·`key_verification` + Should `writing_assist`·`chat_reply`로 적었다.

### DM-6 지울 RPC·API·컬럼 (AI 쪽에서 더 이상 부르지 않는 것)

- RPC `begin_jd_extraction`·`apply_jd_extraction`·`fail_jd_extraction`, 생성 RPC의 `p_preview_job_id`·반환 `preview_applied`·`preview_skip_reason`.
- API `POST /api/job-descriptions/extract-preview`, `ai_jobs.params.raw_text_hash`·`sentence_count`(미리 보기 전용).
- `job_descriptions.extraction`·`extraction_status`·`extraction_job_id`·`extraction_provider`·`extraction_model`·`tech_keywords`, `jd_requirements` 테이블 전체. `job_descriptions.detected_language`는 AI가 더 이상 채우지 않는다(AI-02·AI-04 입력에도 쓰지 않는다).
- 남겨야 하는 것: `job_descriptions.raw_text`·`sentences`(문장 분할 결과, 모든 JD 입력의 원천), `position_title`·`company_name`(사용자 입력, AI-02·AI-04가 `position_title`을 입력에 넣는다).

### DM-7 원문 수정 예외(JR-Q4 (a))와 실행 중 인사이트

조건이 "`insights.status = 'ready'` 0행 AND `jd_sentence` 근거 0행"이면, **인사이트 작업이 `queued`/`running`인 동안** 원문을 고칠 수 있다. 그 작업은 `prepare`에서 읽은 옛 `sentences`로 판정·저장해 **고친 원문과 맞지 않는 `sids`**를 가진 ready 인사이트가 생긴다(옛 A2 "생성 중 요건 편집 금지"가 막던 경로). 권고: 조건에 "진행 중 `insight` 작업 0개"를 더하거나, 저장 RPC가 인사이트 저장 때 `raw_text_hash`가 현재 값과 다르면 `stale_write`로 거부. 같은 문제가 자소서 대화 턴에도 있다(턴 도중 원문이 바뀌면 `jd_sentence` 근거의 `sid`가 새 분할과 다를 수 있다) — 서류 저장 RPC가 `jd_sentence` 근거를 넣는 순간 조건 두 번째 항이 막지만, 제안 단계의 근거는 막지 못한다.

### DM-8 문장 0개 원문

`not_a_jd`가 없어져 "문장이 하나도 안 나오는 원문"(기호만)을 받을 자리가 없다. AI 쪽은 단계 1 원소 0개 → 1회 재시도 후 `schema_invalid` `[가정]`으로 적었지만 "다시 시도"로 풀리지 않는 실패다. 권고: **JD 저장(생성 RPC·JR-Q4 RPC)이 `sentences` 1개 이상을 요구**하고 화면이 "공고 내용을 확인해 주세요"로 막는다. DM이 받으면 AI 명세의 해당 줄(AI-02 실패 유형)을 "저장 단계에서 막힘 — 방어용"으로 고친다.

### DM-9 데이터 준비도

`get_data_readiness()`·D-01 게이트가 요건 수(`jd_requirements`)를 보는 곳이 있으면 원문 존재(`sentences` ≥ 1)로 바꾼다(JR-Q5). AI 명세 C-1 게이트 표는 커리어 데이터만 본다.

### DM-10 AI-04 출력 `schema_version` 4 → 5

`sources[]`·`paragraphs[]`의 `requirement_refs`를 지웠다(저장하지 않던 값 — AI-04 저장 매핑). `writing_chats.structured_draft` 자소서 모양에 `requirement_refs`가 들어가 있으면 알려 달라 — 없다는 전제로 `structured_draft`의 `schema_version`은 1 그대로라고 적었다 `[가정]`.

### DM-11 AI-12 게이트 진입 입력 `[가정: JR-1·JR-3의 귀결]`

옛 R-31 "게이트 진입의 요건 목록"(`jd_requirements`에서 서버가 고른 ≤ 8개)은 원천이 사라져 **`return_target.application_project_id`의 `job_descriptions.sentences` 전부 + `position_title`**(응답 호출에만)로 바꿨다. 읽기 경로(게이트 대화의 `return_target` → 지원 건 → JD)가 `app_ai_writer`·조회 함수에서 되는지 확인해 달라.

---

## 2. ux-planner (UX v5.21)

### UX-1 진행 단계 (AI-02 인사이트)

- **(리더 판단 2026-11-14 반영) 단계 값**: `prepare` → **`identify`(새 단계)** → `match`(배치 `done/total`, 예 1/2 → 2/2 — 옛 그대로) → `synthesize`(→ `synthesize_regen`) → `validate`.
- 의미: `prepare`는 **선행 추출이 없다**(짧게 지나감). `identify`는 1a 요건 식별(경량 1회, 약 5~10초 `[측정 안 됨]`). `match`는 1b 판정으로 옛 지연(15~25초) 그대로. 인사이트 전체 약 35~55초.
- 화면 문구 권고(최종 UX): `identify` = "공고에서 요건 찾는 중", `match` = "요건별로 내 경력과 맞춰 보는 중" 류. 옛 AI-01 문구 "공고 요건 정리 중"·"공고 가져오는 중 → 공고 요건 정리 중"은 지운다.

### UX-2 인사이트 요건 표 원소 (S-16 "요건별 판정 표")

- 행 = `requirement_matches[]` 원소: **요건 문구 = `requirement_text`**(≤ 120자, 원문 표현을 짧게, 영문 JD면 한국어 요약 + 기술명 원문), **원문 위치 = `sids`**(1a가 만든 값, 1~5개 — 채용 공고 탭의 문장 하이라이트로 이동), 판정 `status`, 이유 `rationale`, 부족한 측면 `missing_aspect`, 근거 칩(`evidence_links`, `item_key = requirement_matches.MT-n`).
- 없어지는 것: 요건 카테고리(주요 업무/자격 요건/우대 사항) 구분, 중요도(`importance`) 표시, 기술 키워드 칩. 표 순서는 **원문 순서**(서버 정렬).
- 한 인사이트 안에서 최대 15행. 다시 생성하면 식별이 달라질 수 있다(행 수·문구가 바뀜) — 이전 버전과 행 단위로 비교하는 화면은 만들지 않기를 권고.
- 강점·보완점·우선순위가 가리키는 요건은 `match_keys`(DM-1)로 이 표의 행을 찾는다.

### UX-3 근거 칩

- `REQ`(요건) 칩 삭제. JD 근거는 **원문 문장 칩**(`jd_sentence`, 라벨 = 문장 앞 40자)만. 칩을 누르면 채용 공고 탭의 그 문장 하이라이트.
- 과거 `jd_requirement` 칩은 JR-Q3 (a)면 변환되어 문장 칩으로 보인다.

### UX-4 오류·안내 문구

- `not_a_jd` 안내, AI-01 추출 실패·`pending` 분기, "요건 정리하기"·"요건이 아직 정리되지 않았어요"류 문구, 서류 대화의 "요건이 없어 첫 턴을 보낼 수 없음" 경로를 지운다(AI-04 응답 프롬프트의 `no_requirements` 안내도 삭제 — 0.v416 표).
- 단계 1 원소 0개(공고가 아닌 텍스트) → `schema_invalid` `[가정]` — DM-8이 받히면 저장 단계 안내로 옮겨 간다.

### UX-5 사용량 표 (JR-Q5)

- 새 기록이 생기는 행은 4행(프로젝트/산출물 작성 AI 채팅·인사이트·자기소개서 작성 AI 채팅·연결 확인). `jd_extraction` 과거 기록은 "JD 요건 추출(종료)" 행으로 보이거나 숨긴다 — CF-A3 `career_description` 처리와 같게 UX가 정한다. AI 쪽 권고는 **과거 기록이 이번 달에 있을 때만 행을 보인다**(미터가 사용자가 낸 돈을 보여야 하므로 — C-13.1의 CF-A3 이유와 같다).

### UX-6 AI-04 화면에 영향 없는 것

- 근거 카드(`sources_selected`)의 요건 연결 표시가 있었다면 지운다(`requirement_refs` 삭제). 이벤트 이름·순서는 그대로.

---

## 3. 리더 — 권장안의 설계상 문제 (고치지 않고 적는다)

> **리더 판단 2026-11-14 — L-1~L-4 처리 완료, AI 명세 v4.16에 반영**: L-1 완화안 (다) 채택(1a 식별 → 1b 배치 판정), L-2 키 `MT-n`, L-3 `common.v5` 유지, L-4 원문 문장 전체 + `ai-12.reply.v8` 유지(모두 `[가정]`).

### L-1 JR-Q2 (a) 단계 1 "배치 없이 1회 호출"의 지연·함수 한도 — **리더 판단 2026-11-14: 완화안 (다) 채택**

- 반영: 단계 1 = 1a 식별(경량, `requirement_text`·`sids`만, 최대 15개, 1회) → 1b 판정(기본, 8개씩 배치 병렬, 옛 배치·빠진 판정 채우기 규칙 되살림). 비용 약 $0.13(v4.15와 같음), 지연 약 35~55초 `[측정 안 됨]`. 아래는 판단 전 기록.

- 단계 1 출력이 요건 15개 × 약 250토큰(요건 문구·sids·판정·이유·근거 인용) + 사고 0.5k ≈ **4~4.5k 토큰**을 한 호출로 낸다. 기본 등급 60~100 tok/s `[가정]`이면 **40~75초**다. 옛 배치(8개 × 2 병렬)는 배치당 약 2k라 15~25초였다.
- 결과: ① **PRD 목표 p90 40초를 넘는다**(단계 2 15~20초를 더하면 55~90초) ② **C-6 "한 번의 함수 실행이 60초를 넘지 않도록 단계를 쪼갠다"에 닿는다**(단계 1이 단일 공급자 호출이라 더 쪼갤 수 없다) ③ 무료 등급(목표 80초)은 단계 1 하나로 넘을 수 있다.
- 완화안(사용자 결정 범위 — AI 명세는 적용하지 않았다): (가) 상한 15 → 10~12, (나) `rationale`을 한 문장(≤ 80자)으로 묶기, (다) **단계 1을 "식별(경량, 요건 문구·sids만 — 출력 약 0.8k)" → "판정(기본, 8개씩 배치 병렬)"으로 나누기** — 식별 결과는 여전히 인사이트 안에만 두므로 JR-1 취지(JD에 AI 결과를 붙이지 않음)와 맞고, 지연은 옛 구조와 비슷해진다(호출 1회·약 $0.001 추가). 8장 JR-Q2 행에 리스크로만 적었다.

### L-2 `M-n` 이름 겹침 — **리더 판단 2026-11-14: `MT-n`으로 바꿈**(원소 `match_key`, 참조 `match_keys`, 모델 출력 `requirement_refs` 값 `MT-n` — DM 최종 확정)

AI 작성 대화 근거 별칭 `M-n`(`writing_chat_message`, C-3)과 JR-Q2 (a)의 단계 1 원소 키 `M-n`이 같은 글자다. 한 호출 안에서 두 별칭이 같이 쓰이는 기능은 없어 검증은 깨지지 않지만(AI-02에는 대화 메시지가 없다), 로그·구현 상수·문서에서 같은 접두사가 두 뜻이 된다. 권고: 원소 키를 `RQ-n`처럼 다른 접두사로(사용자에게는 보이지 않는 키라 결정 부담이 작다). AI 명세는 권장안대로 `M-n`을 썼다.

### L-3 `common.v4` → `common.v5` — **리더 판단 2026-11-14: 유지 `[가정]`**

공통 system 블록(구현 `common.ts`)의 근거 ref 예시 목록에 `REQ-1`이 있다. 지우면 공통 접미사가 바뀌어 모든 기능의 `prompt_version`이 함께 바뀐다(v4.14 `common.v4`와 같은 이유·같은 영향). 남은 동일 입력 재사용은 AI-02뿐이고 AI-02는 어차피 버전이 오르므로 **추가 비용이 없다** — AI 명세는 `common.v5` `[가정]`으로 적었다.

### L-4 AI-12 게이트 진입 입력 (DM-11) — **리더 판단 2026-11-14: 원문 문장 전체 + `ai-12.reply.v8` 유지 `[가정]`**

결정 입력에 없던 자리다(JR-1이 원천 테이블을 지워 생긴 귀결). AI 명세는 JR-3의 원칙대로 **원문 문장 전체**로 바꾸고 `ai-12.reply.v7` → `v8` `[가정]`으로 적었다. 대안: 게이트 진입의 JD 블록을 없앤다(질문 주제를 대상 프로젝트에서만 잡음, 비용 0, R-31 기능 축소). 사용자에게 물을지 리더가 판단.

---

## 4. 후속 확정 요청 (2026-11-14, 사용자 결정 대기 답변 반영 — AI v4.16 같은 판)

기준: `_workspace/00_input/planning-decisions-jd-raw-text.md` "후속 확정". 위 1~3절 중 아래와 어긋나는 것은 이 절이 이긴다.

### data-architect

- **F-DM-1 (JR-Q2 보류 → 1a/1b 걷음)**: DM-2·DM-2a 회신의 1a/1b 모양은 **쓰지 않는다**. `match_stage_result` = `{prompt_version, items: [{match_key, requirement_text, sids, status, model_status, rationale, missing_aspect}]}`(배치 정보 없음, 단계 1 한 호출). `progress.stage`에 `identify`를 **더하지 않는다**(`prepare` → `match` 0/1 → 1/1 → `synthesize` → `validate`). `call_key`는 `insight.match.1` + `insight.synthesize`(`insight.identify` 없음), 한 인사이트 안 등급은 기본 하나. `insights.result` 원소 모양·`match_key`·`match_keys`·`MT-n`·`raw_text_hash`는 그대로.
- **F-DM-2 (JR-Q3 (b))**: `jd_requirement` 근거 행은 변환 없이 삭제(DM-4 회신의 변환 전제 철회). 옛 인사이트(`schema_version` 1)는 그대로 두고 화면이 "다시 만들어야 해요"를 보인다 — AI-04·AI-12는 `schema_version` 1 인사이트를 입력으로 쓰지 않으므로, 조회 RPC가 최신 ready 인사이트를 돌려줄 때 `schema_version`도 함께 돌려줄 것.
- **F-DM-3 (JR-5 — AI-04 입력)**: 자소서 대화 턴의 컨텍스트 조립이 **`job_descriptions.sentences`를 읽지 않고** 그 지원 건의 **최신 ready 인사이트**(`insights` `is_latest` + `status = ready` + `schema_version` 2)의 `result`에서 `requirement_matches[].{requirement_text, status, missing_aspect}`, `strengths[].{title, description}`, `gaps[].{match_keys→requirement_text, gap_kind, description}`, `strategy.{positioning, project_priorities}`를 읽는다. `app_ai_writer`의 `insights` 읽기 grant 확인. stale(공고·커리어 변경)이어도 읽는다 `[가정]` — 그래서 "stale 여부"(`raw_text_hash` ≠ JD 현재 값, `career_snapshot_hash` ≠ 현재)를 함께 돌려주면 시작 인사 안내 줄에 쓴다. `company_name`·`position_title`은 계속 읽는다(사용자 입력 메타).
- **F-DM-4 (JR-5 — 근거 허용)**: 자소서 정본(`owner_type = 'application_document'`) 저장 RPC가 받는 근거 `source_type`에서 **`jd_sentence` 제외**(커리어 5종 + `user_note`). DM-7 회신의 "서류 대화 `structured_draft`의 `jd_sentence` 출처 0" 조건은 대상이 없어진다. `jd_sentence`는 `owner_type = 'insight'`에만.
- **F-DM-5 (JR-5 — AI-12 게이트)**: 게이트 진입 대화의 `return_target`이 **출발한 보완점의 `item_key`**(`gaps.{n}`)를 담을 수 있게 해 달라(없으면 AI 쪽은 `gaps[]` 전부 최대 5개를 넣는다). DM-11 회신의 `job_descriptions.sentences` 읽기 경로는 게이트에서는 더 쓰지 않는다.
- **F-DM-6 (JR-6 — 자동 시작)**: 지원 건 생성 경로(생성 RPC → 생성 API)가 성공 뒤 **AI 연결(활성 키 + 동의) 이고 D-01 충족이면** 인사이트 작업 1개를 만든다(`begin_insight`와 같은 검사, 공급자·등급은 그 시점 활성 값). 연결 안 됨·D-01 미달이면 만들지 않고 오류도 내지 않는다(응답에 `insight_auto_started: false` 같은 표시 — 이름은 DM). 자동 시작 실패는 생성 트랜잭션과 분리(생성은 성공). 같은 지원 건 진행 중 작업이 있으면 만들지 않는다.
- **F-DM-7 (JR-7 — 원문 수정)**: `update_jd_raw_text`의 "결과 없을 때만" 조건 삭제. 인사이트 stale 판정 = `insights.raw_text_hash` ≠ `job_descriptions.raw_text_hash`. 실행 중 인사이트가 있을 때 (가) 수정을 막는다 / (나) 작업을 끝내고 결과를 stale로 보인다(`complete_insight`의 `stale_run`은 이때 빼야 결과가 남는다) — **둘 중 단순한 쪽을 DM이 정해 알려 달라**(AI 명세는 둘 다 받게 적었다). 자소서 쪽 조건(DM-7의 서류 대화 조건)은 JR-5로 필요 없다.

### ux-planner

- **F-UX-1**: 진행 단계에서 `identify`를 지운다(위 F-DM-1). `match`는 0/1 → 1/1, 약 40~75초(임시 상태의 알려진 위험).
- **F-UX-2 (JR-5·JR-6)**: AI-04 시작 인사 앞 "인사이트 상태 줄" 3종 `[가정: 문구]` — 없음 / 만드는 중 / 공고·경력 변경 뒤. 최종 문구 UX.
- **F-UX-3 (JR-7)**: 인사이트 탭 "공고가 바뀌었어요 — 다시 생성"(F-P2-07 자리). 옛 인사이트(`schema_version` 1) "공고 처리 방식이 바뀌어 다시 만들어야 해요" + [다시 생성].
- **F-UX-4 (JR-5)**: 자소서 근거 칩에 원문 문장 칩이 생기지 않는다(근거 = 커리어 + 메모). 원문 문장 칩은 인사이트 탭에만.
