# Resumate 기획 정합성 리뷰 — 결정 사이클 `settings-dialog` (라운드 1)

> 작성: spec-reviewer / 2026-11-05 / 이슈 ID `R-SD-n`
> 입력: `_workspace/00_input/planning-decisions-settings-dialog.md`(SD-1~SD-6 사용자 확정, SD-A1~SD-A19 리더 판단, SD-Q1~SD-Q3 미확정), `_workspace/settings-dialog/{ux,ai}_requests.md`·`dm_replies.md`
> 리뷰 범위: 이 사이클이 건드린 경계만(이름 정합 · SD-2/A17 잔재 · SD-6 · SD-4 경계 · S-24 탭↔화면 ID · 약관 탭 · 사용량 비용 열 · 버전 표기 · 미확정 항목 표시). 사이클 밖(커리어·면접·보드)은 재검토하지 않았다.

## 요약

- 검토 문서: PRD v4.14 · UX v5.17 · AI 명세 v4.12 · 데이터 모델 v4.12 (+ DM 회신 `dm_replies.md`)
- 이슈: **Critical 0 / Major 11 / Minor 6** — ~~해소 0 / 미해소 17~~ → **라운드 2 재검토 결과 17건 전부 해소**(각 이슈의 "상태 (라운드 2)" 줄)
- 한 줄 진단: **네 문서의 결정 내용은 서로 맞다.** 어긋나는 것은 거의 전부 **순서 문제**다 — data-architect가 DM v4.12에서 이름·응답 모양·SD-A17~A19를 확정했는데, PRD v4.14·UX v5.17·AI v4.12는 그 회신 **이전** 판이라 아직 `[가정]` 이름과 "data-architect 확인 요청"을 들고 있다. 그 상태로 구현에 넘기면 UI가 **폐기될 컬럼**(`interested_industries`)을 보고 만든다.
- 사용자 결정이 필요한 항목은 새로 생기지 않았다(SD-Q1~SD-Q3, D-DM-13~15, D-UX-29~31이 그대로). 다만 **D-UX-29·30·31은 DM이 이미 답했으므로 "미확정"이 아니라 "해소"로 내려야 한다**(R-SD-12).

## 경계별 결과

| 경계 | 결과 | 이슈 ID |
|------|------|---------|
| 이름 정합 (DM 확정명 ↔ PRD·UX·AI) | **불일치** | R-SD-1, R-SD-2, R-SD-3, R-SD-4, R-SD-5, R-SD-6 |
| SD-2·SD-A17 잔재 (`total_years_of_experience`·`desired_job_title`) | 통과 — 네 문서 어디에도 "살아 있는 값"으로 없다(폐기·요청 서술만) | — (단 UX 1806행의 `[가정]` 미해소는 R-SD-11·12) |
| SD-6 (내 정보 값이 AI 입력으로 새는 자리) | 통과 — 컨텍스트 팩·기능별 입력·V-4·V-7·readiness 전부 제거됨. DM은 권한(`app_ai_writer`)으로도 막았다 | R-SD-16(과거 변경표 문장만) |
| SD-4 경계 (S-13~S-19·F-DOC-*) | 통과 — 세 문서 모두 `(v5.17/v4.14/v4.12)` 변경 표시가 S-13~S-19·F-DOC-*에 없다. 7행 묶음이 "표시 단계에서만"인 점도 세 문서가 같은 말 | R-SD-13(표현 하나) |
| S-24 탭 ↔ 화면 ID (S-04 폐기·S-40·S-42·S-25·S-30·S-41) | 통과 — 사이트맵·화면 목록·매트릭스·진입점·L-01 모두 처리됨 | R-SD-8(C-02 목적지만) |
| 약관 탭 (문서 4종·선택 동의·SD-Q3 (다)) | 대부분 통과 — SD-Q3 (다)는 UX·DM 양쪽에서 "남긴다 + 미확정"으로 같다 | R-SD-14, R-SD-17 |
| 사용량 비용 열 (`input_cost_usd`·`output_cost_usd`) | **불일치** — 두 컬럼이 UX·AI 어느 문서에도 없다 | R-SD-4, R-SD-5, R-SD-15 |
| 버전·표시 | **불일치** — 짝 문서 기준 버전과 리더 판단 범위(A16 vs A19) | R-SD-10, R-SD-11 |
| 미확정 항목 표시 일치 | 부분 통과 — SD-Q1·Q2·Q3, D-DM-13·14·15는 일치. D-UX-29·30·31만 상태가 어긋난다 | R-SD-12 |

---

## 이슈

### R-SD-1 [Major] UX 계정 탭이 **폐기될 컬럼** `profiles.interested_industries`를 가리킨다
- 경계: UX ↔ 데이터 모델 (이름 정합)
- 근거:
  - `02_ux-planner_flows.md` S-24 ① 계정 탭 컴포넌트 표: "내 정보 — 관심 산업 | `profiles.interested_industries` **단일 선택으로 바뀜**(현행 `text[]`) … 컬럼 모양·기존 값 처리는 data-architect 확인 요청"
  - `02_data-architect_data-model.md` 2.1.1 삭제 컬럼 표: "`interested_industries text[]` | **단일 선택 `interested_industry text`로 교체** (v4.12, SD-A4)" / 마이그레이션 ④ "`drop column … interested_industries`" (파괴적 ★)
- 담당자: ux-planner
- 제안 수정: 이름을 **`profiles.interested_industry`**(text, 단일)로 고치고, "카테고리 `industry`의 **코드**를 저장하고 라벨은 `profile_options`에서 읽는다"를 비고에 한 줄 넣는다. 기존 다중 값 처리(DM 마이그레이션 ②: 원소 1개 + 라벨 일치일 때만 백필, 그 밖은 null)는 **"비어 있을 수 있다"**만 화면에 반영하면 된다(별도 분기 불필요).
- **상태 (라운드 2): 해소** — UX S-24 ① 계정 탭 표가 `profiles.interested_industry`(text, 단일)로 바뀌고 카테고리 `industry` 코드 저장 + `profile_options` 라벨, 미백필 시 "비어 있을 수 있다"까지 적혔다

### R-SD-2 [Major] UX 계정 탭의 내 정보 필드 이름이 아직 `[가정]`·미기재 — DM 확정명으로 올려야 한다
- 경계: UX ↔ 데이터 모델 (이름 정합)
- 근거:
  - UX S-24 ① 계정 탭 표: 구직 상태 `profiles.job_search_status` `[가정]`, 관심 기업군 `profiles.interested_company_type` `[가정]`, **최종 학력 6칸 "필드 이름 `[가정]`(data-architect 확인 요청)"**, 관심 직군·직무 쌍 "쌍 목록 `[가정]`"(저장 단위·테이블 없음), 검증 문구 "학교 명·전공 길이 초과 → … (길이 값은 data-architect 확인 요청)"
  - `dm_replies.md` 0절·DM 2.1.1·2.1.2: 10개 컬럼 확정(`job_search_status`·`interested_company_type`·`interested_industry`·`highest_education_school_name`·`_degree`·`_status`·`_start_month`·`_end_month`·`_major`·`_gpa`), 쌍은 **별도 테이블 `profile_job_interests(user_id, sort_order, job_family, job_role)`**, 상한 **학교 명 100 · 전공 100 · 학점 20**
- 담당자: ux-planner
- 제안 수정: 표의 `[가정]`을 확정명으로 바꾸고 최종 학력 6칸에 `highest_education_*` 이름을 넣는다. 검증 문구의 N을 100/100/20으로 채운다. 쌍 행 비고에 "저장은 `profile_job_interests` **쌍 전체 덮어쓰기**(부분 수정 없음), `job_role`은 비울 수 있다(직군만 고른 상태 허용)"를 적는다. 5.1j의 **D-UX-29를 "해소"로** 내린다.
- **상태 (라운드 2): 해소** — 10개 컬럼 확정명·`profile_job_interests` 쌍 테이블·상한 100/100/20이 표와 검증 문구에 들어갔고 5.1j의 D-UX-29가 해소로 내려갔다

### R-SD-3 [Major] UX 내 정보 저장에 RPC 이름과 오류 코드가 없다
- 경계: UX ↔ 데이터 모델 (API 경계)
- 근거:
  - UX S-24 ① "저장 방식 = 섹션 단위 저장" + "성공·실패 문구"는 `stale_write`를 "같은 성격"으로만 언급하고 RPC·오류 코드가 없다. 문서 전체에 `save_profile_basics` 0건.
  - DM 7장 "내 정보 저장 (v4.12 ★)": RPC **`save_profile_basics(p_values jsonb, p_job_interests jsonb, p_expected_updated_at timestamptz)`**, 기대 버전 = `profiles.updated_at`, 오류 **`stale_write`(409) · `invalid_profile_option`(400) · `field_too_long` · `invalid_period` · `too_many_job_interests`**, 응답 `{updated_at}`
- 담당자: ux-planner
- 제안 수정: 저장 절에 RPC 이름·기대 버전·오류 5종을 적고, 오류마다 화면 문구를 붙인다. 특히 `invalid_profile_option`(목록에서 내려간 값·직군과 맞지 않는 직무)과 `too_many_job_interests`는 지금 문구가 없다. 조회도 `profiles` + `profile_job_interests` + `profile_options`(라벨) 세 읽기임을 비고에 적는다.
- **상태 (라운드 2): 해소** — S-24 ① "조회·저장 경계" + "저장 오류 5종과 화면 문구" 표 신설 — `save_profile_basics` 시그니처·기대 버전·응답·오류 5종 문구가 모두 있다

### R-SD-4 [Major] UX S-42의 데이터 출처가 옛 모양 — 비용 2컬럼과 `providers[]` 응답이 빠졌다
- 경계: UX ↔ 데이터 모델 (사용량 비용 열)
- 근거:
  - UX S-42 "데이터 (데이터 모델 v4 2.9)" 줄의 `ai_usage_records` 컬럼 열거에 `estimated_cost_usd`만 있고 **`input_cost_usd`·`output_cost_usd`가 없다**. 표는 "입력 비용(USD) / 출력 비용(USD)" 두 열을 요구한다.
  - UX 5.1j: "**D-UX-30** 사용량 공급자 × 기능 교차 집계 응답 모양 … 현행 `by_feature`·`by_provider`를 대체한다" — 미확정으로 남아 있다.
  - DM 2.9.2: "`input_cost_usd` numeric(12,6) **v4.12 신설 ★** … 입력 쪽 비용(비캐시 입력 + 캐시 읽기 + 캐시 쓰기). 화면 '입력 비용' 열(SD-A11)" / 2.9.5: `get_ai_usage_summary` 응답을 **`providers[]`**(공급자별 `connection_tiers`·`totals`·`by_feature[]`·`price_table_versions`)로 교체
- 담당자: ux-planner
- 제안 수정: 데이터 출처 줄에 두 컬럼을 넣고, 표 비고에 "열 2개의 원천 = `input_cost_usd`·`output_cost_usd`(저장 컬럼 합), 토큰 보조 표기는 `by_feature[]`의 입력/캐시/출력 토큰"을 적는다. **입력 비용에 캐시 읽기·쓰기 비용이 포함**되므로 보조 표기 토큰을 무엇으로 적을지(비캐시 입력만인지 캐시 포함인지) 한 줄로 정한다. D-UX-30을 "해소"로 내린다.
- **상태 (라운드 2): 해소** — S-42 데이터 줄에 `input_cost_usd`·`output_cost_usd`(v4.12 신설)와 `providers[]`·`by_feature[]` 필드 목록이 들어갔고 D-UX-30이 해소로 내려갔다. 토큰 보조 표기 범위도 한 줄 결정(아래 R-SD-24 확인 참조)

### R-SD-5 [Major] AI C-13 기록 형식에 비용 2컬럼과 **비용 분할 식**이 없다
- 경계: AI 명세 ↔ 데이터 모델 (사용량 비용 열)
- 근거:
  - `02_ai-feature-designer_ai-spec.md` C-13 "기록 형식(`ai_usage_records`)" 표에 `estimated_cost_usd`만 있고 비용 2컬럼이 없다. 예상 비용 식도 합계 하나(`input_tokens × … + output_tokens × 출력 단가`)로만 적혀 있다.
  - DM 2.9.2: "`estimated_cost_usd` … **(v4.12) `input_cost_usd + output_cost_usd`와 같아야 한다**", 입력 쪽 = 비캐시 입력 + 캐시 읽기 + **캐시 쓰기**
- 담당자: ai-feature-designer
- 제안 수정: C-13 표에 두 컬럼을 추가하고, 예상 비용 식을 **두 식으로 나눠** 적는다 — `input_cost_usd = input_tokens × 입력 단가 + cached_input_tokens × 캐시 읽기 단가 + cache_write_tokens × 캐시 쓰기 단가`, `output_cost_usd = output_tokens × 출력 단가`, 합계 = `estimated_cost_usd`. 장문 구간 단가 교체가 두 식에 똑같이 적용되는 점과 `price_table_version = 'unpriced'`일 때 둘 다 0인 점도 한 줄씩. (이 식이 AI 명세에 없으면 기록 경로가 캐시 쓰기 비용을 어느 열에 넣을지 구현이 임의로 정한다.)
- **상태 (라운드 2): 해소** — C-13 표에 두 컬럼이 추가되고 비용이 두 식으로 분리됐다(캐시 쓰기 = 입력 쪽, 사고 토큰 = 출력 쪽 한 번만, 장문 단가 동시 교체, `unpriced`면 세 값 0)

### R-SD-6 [Major] AI C-1의 `computed_total_months`에 계산 위치·시그니처가 없다
- 경계: AI 명세 ↔ 데이터 모델 (이름 정합)
- 근거:
  - AI C-1: "(v4.12, SD-2) `computed_total_months` — 서버가 계산하는 총 경력 개월 수" — 규칙은 상세하지만 계산 위치는 "팩 조립 시점"뿐이고, AI의 data-architect 요청 2가 "① 인라인 SQL ② 전용 함수" 중 하나를 골라 달라고 열어 둔 상태다.
  - DM 6.2 / `dm_replies.md` 2-2: **`private.compute_total_experience_months(p_user_id uuid, p_as_of date)` → `(total_months integer, open_ended_experience_count integer, as_of_month date)`**, `status = 'complete'` 필터는 함수 안, 기준월은 **인자로** 받는다(함수 안에서 `now()`를 읽지 않는다), 공개 RPC 없음
- 담당자: ai-feature-designer
- 제안 수정: C-1의 해당 항목에 함수 이름·시그니처·반환 3값을 한 줄로 적고, "기간 미입력 경력 N건"의 N이 **같은 호출의 `open_ended_experience_count`**임을 명시한다. AI-02 판정 기준의 "서버가 넣은 값"도 같은 함수를 가리키게 한다. 문서 끝 요청 2를 "해소(전용 함수)"로 내린다.
- **상태 (라운드 2): 해소** — C-1에 `private.compute_total_experience_months(p_user_id, p_as_of)` → `(total_months, open_ended_experience_count, as_of_month)`와 "기간 미입력 경력 N건 = 같은 호출의 `open_ended_experience_count`"가 들어갔고 문서 끝 요청 2가 "해소"다

### R-SD-7 [Major] AI C-3의 `profile` 근거 행 처리 권고가 SD-A19·DM 결정과 반대다
- 경계: AI 명세 ↔ 결정 입력 ↔ 데이터 모델 (결정 추적)
- 근거:
  - AI C-3 각주: "과거 `evidence_links`의 `profile` 행 처리는 data-architect 판단(**권고: `achievement`와 같이 '원본 삭제됨'으로 둔다**)" / 문서 끝 요청 4도 같은 권고
  - 결정 입력 3.1 **SD-A19**: "행·라벨을 지우지 않고 남기되, 근거 칩은 **'원본으로 이동'을 비활성**으로 보인다" / DM 2.8: "`source_deleted_at`을 소급해 채우지도 않는다 — 원본 **데이터**가 지워진 것이 아니라 **원본 화면**(S-04)이 없어진 것이라 '원본 삭제됨'은 사실과 다르다", `source_type` CHECK는 유지하고 **insert 트리거가 새 행만 거부**(`invalid_evidence_source`)
- 담당자: ai-feature-designer
- 제안 수정: 권고 문장을 SD-A19 확정 내용으로 바꾼다 — 기존 행 유지, `source_deleted_at` 백필 없음, CHECK 유지 + insert 트리거 거부, 칩은 라벨 유지 + "원본으로 이동" 비활성. 문서 끝 요청 4를 "해소"로 내린다.
- **상태 (라운드 2): 해소** — C-3 각주를 SD-A19 확정 내용으로 다시 썼다(행·라벨 유지, `source_deleted_at` 백필 없음, CHECK 유지 + insert 트리거 `invalid_evidence_source`) — "원본 삭제됨" 권고는 폐기 표시. 단 같은 문서 ux-planner 요청 3이 옛 권고를 들고 있다(R-SD-19)

### R-SD-8 [Major] 프로필 근거 칩의 "원본으로 이동" 목적지가 세 문서에서 다르다
- 경계: UX ↔ AI ↔ 결정 입력 (SD-A19)
- 근거:
  - UX C-01 칩 라벨: "profile '기본 프로필'(… 라벨·**이동**은 과거 기록을 위해 남긴다 `[가정]`)" / UX 5.1j 변경 목록: "C-02 기본 프로필 근거 → S-04 | → **설정 다이얼로그 계정 탭**(SD-A2)" / UX S-24 진입점: "C-02 기본 프로필 근거(→ 계정 탭)"
  - PRD "ux-planner에게 요청" 2: "C-02(기본 프로필 근거)의 '원본으로 이동'도 설정 다이얼로그 계정 탭으로 바꿔 주세요"
  - SD-A19 / DM 2.8: 원본 화면이 없어졌으므로 **"원본으로 이동"은 비활성**
- 담당자: ux-planner (PRD 요청 2도 함께 철회 — R-SD-11 참조)
- 제안 수정: C-01 칩 라벨 비고와 C-02 경로, S-24 진입점 목록에서 "프로필 근거 → 계정 탭" 이동을 **비활성 상태**로 바꾼다(칩은 보이고 누를 수 없음, 안내 한 줄). 계정 탭에는 그 근거가 가리키던 값(희망 직무·총 경력 연차·관심 산업 배열)이 더 이상 없으므로 이동이 "같은 내용"을 열지 못한다.
- **상태 (라운드 2): 해소** — UX C-01 칩 비고·C-02 "원본으로 이동"·S-24 진입점 세 자리 모두 "비활성"으로 바뀌고 "이 근거의 원본 화면은 더 이상 없어요" 한 줄이 생겼다. PRD 요청 2도 취소선 + "철회"로 정리됐다

### R-SD-9 [Major] DM 2.8 "소유자별 허용 출처"가 인사이트만 5종으로 고쳐졌다 — 경력기술서·면접 질문 행은 6종 그대로
- 경계: 데이터 모델 내부 (SD-A19 적용 누락) — 트리거와 RPC가 서로 다른 규칙을 갖는다
- 근거: `02_data-architect_data-model.md` 2.8 "소유자별 허용 출처" 행: "**v4.4**: 인사이트 = 커리어 ~~6종~~ **(v4.12, SD-A19) 5종**(~~`profile`~~, …) + `jd_requirement`·`jd_sentence`. **경력기술서 = 커리어 6종만.** 직무 면접 질문·경력기술서·`job_competency` 문항은 …"
- 담당자: data-architect
- 제안 수정: 같은 행의 "경력기술서 = 커리어 6종만"과 그 뒤 열거를 **5종**으로 고친다. 2.8의 다른 자리(`dm_replies.md` 2-4의 "허용 출처 커리어 6종 → 5종")와 11.7 #11의 표현도 한 번에 맞춘다 — 지금 상태면 insert 트리거는 `profile`을 거부하는데 경력기술서 저장 RPC의 허용 목록은 받아들이는 모순이 남는다.
- **상태 (라운드 2): 해소** — DM 2.8 두 행과 11.7 #11이 "모든 소유자에서 5종"·"insert 트리거와 저장 RPC가 같은 목록"으로 통일됐다

### R-SD-10 [Major] 짝 문서 기준 버전이 세 문서에서 옛 값이다
- 경계: 전 문서 (버전 표기)
- 근거:
  - PRD 머리글: "짝 문서 기준 버전 (v4.14): UX(02) **v5.16** / AI 명세(03) **v4.11** / 데이터 모델(04) **v4.11**"
  - AI 머리글: "테이블·필드명은 `docs/planning/04-data-model.md` **v4.5**를 기준으로 한다(… 이번 판에서 바뀐 이름·컬럼은 **DM v4.11**)"
  - UX 머리글 기준 입력: "`02_data-architect_data-model.md` (**데이터 모델 v4.2**), `02_ai-feature-designer_ai-spec.md` (**AI 명세 v4.3**)"
  - 실제 현재 판: PRD v4.14 · UX v5.17 · AI v4.12 · DM v4.12
- 담당자: product-planner(PRD), ai-feature-designer(AI), ux-planner(UX)
- 제안 수정: 각 머리글의 짝 문서 버전을 **UX v5.17 · AI v4.12 · DM v4.12**로 올린다. AI의 "이번 판에서 바뀐 이름·컬럼은 DM v4.11"은 **DM v4.12**로(이번 사이클 이름이 전부 v4.12에서 확정됐다).
- **상태 (라운드 2): 해소** — PRD 머리글 "UX v5.17 / AI v4.12 / DM v4.12", AI 머리글 "짝 문서 기준 버전 … DM v4.12 확정값", UX 머리글 DM·AI v4.12. **UX 기준 입력의 "PRD v4.3"만 남아 있어 리뷰어가 직접 v4.14로 고쳤다**(아래 "리더 대신 직접 수정")

### R-SD-11 [Major] PRD·UX가 리더 판단 범위를 "SD-A1~SD-A16"으로 적어 SD-A17·A18·A19가 빠져 있다
- 경계: 결정 입력 ↔ PRD ↔ UX (결정 추적, B12)
- 근거:
  - PRD 머리글 확정 표기: "같은 문서의 **SD-A1~SD-A16**은 리더 판단이므로 `[가정]`" / 기준 입력 줄도 "리더 판단 SD-A1~SD-A16"
  - UX 상태 줄·변경 이력 v5.17: "리더 판단 **SD-A1~SD-A16** `[가정]`" / 5.1j "리더 판단 `[가정]` — SD-A1 … SD-A16"
  - 결정 입력 3.1: **SD-A17**(`desired_job_title` 폐기) · **SD-A18**(`profile_filled` 삭제) · **SD-A19**(profile 근거 유지 + 이동 비활성). DM 머리글·변경 이력은 "SD-A1~SD-A19"로 적고 세 건을 모두 반영했다.
  - 그 결과 PRD "data-architect에게 요청" 1·4와 UX 요청 2·1806행이 **이미 확정된 것을 아직 묻고 있다**: "`desired_job_title`·`interested_industries`는 … 판단해 주세요", "`profile_filled`을 **없앨지** … 정해 주세요", "컬럼을 폐기할지는 data-architect 확인 요청"
- 담당자: product-planner(PRD), ux-planner(UX)
- 제안 수정: 두 문서의 범위 표기를 **SD-A1~SD-A19**로 고치고, 본문에 세 건을 확정으로 적는다 — PRD: `desired_job_title` 삭제(SD-A17, F-P1-01 (1) 항목에 "희망 직무 없음" 한 줄), `profile_filled` 삭제(SD-A18, F-P1-01 (4) 근거), profile 근거 칩 처리(SD-A19). UX: 1806행 `[가정]`을 "폐기 확정(SD-A17)"으로, C-01·C-02는 R-SD-8대로.
- **상태 (라운드 2): 해소** — PRD·UX 모두 "리더 판단 SD-A1~SD-A19"로 올랐고 SD-A17·A18·A19가 본문 확정으로 들어갔다(PRD F-P1-01 (3)(4)(9), UX S-24 ① "없어진 입력"·5.1j)

### R-SD-12 [Minor] DM v4.12가 이미 답한 요청·열린 결정이 PRD·UX에서 미해소로 남아 있다
- 경계: 전 문서 (미확정 항목 표시 일치)
- 근거:
  - UX 5.1j: **D-UX-29**(필드 이름·폐기 컬럼) · **D-UX-30**(교차 집계 응답) · **D-UX-31**(AI 데이터 처리 문서 버전) 세 건이 `[결정 필요]`로 남아 있다. `dm_replies.md` 1절 요청 1·4·5가 세 건을 모두 확정했다.
  - PRD "data-architect에게 요청" 1·2·4·5와 UX "data-architect에게 요청" 1·2·3·4도 같은 상태다.
- 담당자: ux-planner(D-UX-29·30·31), product-planner(PRD 요청 절)
- 제안 수정: 세 D-UX 행을 **"해소 (DM v4.12)"**로 내리고 확정값을 본문에 반영한다(R-SD-1~R-SD-4와 같은 수정). 요청 절은 "회신 반영 완료" 한 줄로 바꾼다. 미확정으로 **남는 것은** SD-Q1·SD-Q2·SD-Q3과 D-DM-13·D-DM-14·D-DM-15뿐이고, 이 6건은 네 문서에서 같은 상태로 적혀 있다(확인했다).
- **상태 (라운드 2): 해소** — UX 5.1j의 D-UX-29·30·31이 취소선 + "해소 (DM v4.12)"로, PRD data-architect 요청 절이 "회신 반영 완료" 머리말 + 요청 1~7 "해소" 표시로 바뀌었다. AI 명세의 요청 절만 일부 미표시(R-SD-20)

### R-SD-13 [Minor] "7행 묶음을 누가 접는지"가 AI 명세와 DM에서 한 글자 다르다
- 경계: AI ↔ 데이터 모델 (SD-4)
- 근거:
  - AI C-13.1: "묶음 정의는 이 표가 유일한 원천이다(**화면·조회 쿼리 양쪽이** 이 표를 본다)"
  - DM 2.9.5 / `dm_replies.md` 1절 요청 4: "**합산은 화면이 한다** … **RPC·SQL에 묶음을 넣지 않는다**", `providers[].by_feature`는 **저장 값 8개 그대로**
- 담당자: ai-feature-designer
- 제안 수정: "화면·조회 쿼리 양쪽" → "**화면(표시 단계)만**. RPC는 저장 값 8개를 그대로 돌려주고, 묶음은 화면 매핑 상수가 접는다"로 고친다. 뜻은 이미 같으므로 문장 하나다.
- **상태 (라운드 2): 해소** — AI C-13.1이 "이 표를 보는 것은 화면(표시 단계)뿐이다 … RPC·조회 SQL에는 묶음을 넣지 않는다"로 바뀌어 DM 2.9.5와 같은 말이 됐다

### R-SD-14 [Minor] `policy_versions.document_path` 값 규칙이 UX와 DM에서 다르다
- 경계: UX ↔ 데이터 모델 (약관 탭)
- 근거:
  - UX S-30 공통 줄: "`document_path`(**`/policies/{type}/{version}`**)는 기록용 값이고 링크로 쓰지 않는다"
  - DM 2.1.3 / 11.7 #10: 새 `ai_data_use` 행은 "`document_path = '/policies/ai_data_use'`"(버전 없음)
- 담당자: data-architect
- 제안 수정: 네 행의 규칙을 하나로 맞춘다 — 기존 3종이 `/policies/{type}/{version}`이면 새 행도 `/policies/ai_data_use/{version}`으로, 규칙을 바꾸는 쪽이면 UX S-30의 괄호 설명을 함께 고치도록 UX에 알린다. (링크로 쓰지 않는 기록 값이라 영향은 작지만, 시드 마이그레이션에 들어가는 실제 값이다.)
- **상태 (라운드 2): 해소** — DM 2.1.3·11.7 #10·9장이 `document_path = '/policies/ai_data_use/{version}'`으로 통일되고 "문서 페이지 주소는 버전 없는 `/policies/ai_data_use`"를 함께 적어 UX S-30과 어긋나지 않는다(아래 R-SD-25 확인 참조)

### R-SD-15 [Minor] UX S-42 무료 등급 안내의 판정 원천이 적혀 있지 않다
- 경계: UX ↔ 데이터 모델 (사용량)
- 근거:
  - UX S-42: "무료 등급 안내 | **고른 공급자의 등급이 무료면** 표 위에 …" — 어떤 값으로 판정하는지 없다.
  - `dm_replies.md` 1절 요청 4: "무료 등급 안내의 현재 상태는 `providers[].connection_tiers`(지난 기록)가 아니라 **활성 키의 `connection_tier`**(`ai_provider_keys_public`)로 판단해 주세요 — 달 중간에 등급을 바꾸면 기록에 두 등급이 섞인다"
- 담당자: ux-planner
- 제안 수정: 그 행 비고에 판정 원천(`ai_provider_keys_public.connection_tier`, 그 공급자의 키가 없으면 안내를 보이지 않음)을 한 줄 적는다.
- **상태 (라운드 2): 해소** — S-42 무료 등급 안내 행에 "활성 키의 `ai_provider_keys_public.connection_tier`가 `free`일 때만" + "그 공급자의 키가 없으면 보이지 않음"이 들어갔다. AI 연결 탭 블록 ②에도 같은 비고가 있다

### R-SD-16 [Minor] AI 명세 0.v43 변경표의 A10 행이 SD-6 뒤집힘 표시 없이 현행 규칙처럼 읽힌다
- 경계: AI 내부 ↔ PRD 9.3 A10
- 근거:
  - AI 0.v43 표: "| 판단 근거 | 프로필 희망 정보도 근거로 셀 수 있었음 | 희망 직무·관심 산업은 판단 근거가 아니고 **문맥 참고만**(A10, C-3 V-4) |"
  - PRD 9.3 A10: "(v4.14, SD-6) **뒤집힘** → 문맥 참고로도 **보내지 않는다**"
- 담당자: ai-feature-designer
- 제안 수정: 과거 변경표는 역사로 남겨도 되지만, 그 행 끝에 "(v4.12, SD-6으로 뒤집힘 — 문맥 참고로도 보내지 않는다)"를 덧붙인다. 지금은 읽는 사람이 현행 규칙으로 오해한다.
- **상태 (라운드 2): 해소** — AI 0.v43 표의 A10 행 끝에 "(v4.12, SD-6으로 뒤집힘, R-SD-16) 이 행은 현행 규칙이 아니다"가 붙었다

### R-SD-17 [Minor] UX S-30 "AI 데이터 처리" 행이 아직 버전 원천을 묻고 있다
- 경계: UX ↔ 데이터 모델 (약관 탭, D-UX-31)
- 근거:
  - UX S-30 표: "**AI 데이터 처리** | `/policies/ai_data_use` | … `policy_versions`에 같은 모양의 행이 필요한지, 아니면 `ai_disclosures` 버전을 그대로 쓰는지는 data-architect 확인 요청 `[가정]`"
  - DM 2.1.3: `policy_versions`에 `policy_type = 'ai_data_use'` 행을 **더한다**(머리글 버전·시행일은 그 행), 본문의 공급자별 요약만 `ai_disclosures` 6행에서 읽는다, `requires_reconsent = false` `[가정]`
- 담당자: ux-planner
- 제안 수정: 그 행을 확정으로 바꾼다 — 머리글 "버전 {version} · 시행일 {effective_at}"의 원천 = `policy_versions`의 `ai_data_use` 행, 본문 공급자별 단락의 원천 = `ai_disclosures` 6행. 버전 문자열 모양이 다른 세 문서와 같아지는 점(`2026-11-05` 꼴)도 한 줄.
- **상태 (라운드 2): 해소** — S-30 "AI 데이터 처리" 행이 "확정 (DM v4.12 2.1.3, D-UX-31 해소)"으로 바뀌고 머리글 원천 = `policy_versions` `ai_data_use` 행, 본문 공급자별 단락 = `ai_disclosures` 6행, 버전 문자열 모양까지 적혔다

---

## 결정 필요 모음 (중복 제거)

이 라운드에서 **새로 생긴 사용자 결정은 없다.** 아래 6건이 네 문서에서 같은 상태로 열려 있다(표시 일치 확인했다).

| ID | 내용 | 출처 문서 | 상태 |
|----|------|-----------|------|
| **SD-Q1** | 개선 요청 외부 폼의 **주소** | PRD 7장(결정 필요 표), UX S-24 ④ 개선 요청 탭(주소 미정 = "준비 중"), DM 2.1.6(테이블 없음·앱 상수) | 사용자 확인 대기 |
| **SD-Q2** | 내 정보 값 목록 7종(구직 상태·기업군·산업·직군·직무·학위·졸업 상태) | PRD 9.7 초안(7/9/11/8/52/8/6), UX(9.7 참조만), DM(`profile_options` 시드, D-DM-13) | 사용자 확인 대기. **값 수는 PRD 9.7과 DM 시드가 일치한다(직무 52 = 8+6+7+6+7+6+6+6)** |
| **SD-Q3 (가)** | 관심 직군·직무 쌍 **최대 3쌍**이 맞는지 | PRD F-P1-01 (2) `[가정]`, UX S-24 ① 쌍 목록, DM `profile_job_interests` CHECK(= D-DM-14) | 사용자 확인 대기 |
| **SD-Q3 (나)** | 사용량 표에서 **토큰 열·합계 토큰 카드 삭제**, 토큰은 비용 칸 보조 표기 | PRD F-AI-07 (2), UX S-42(합계 카드 "없앴다"), DM 2.9.5 | 사용자 확인 대기 |
| **SD-Q3 (다)** | 약관 탭의 **필수 동의 기록 표시 삭제** 여부 | UX 약관 탭(남겨 두고 `[결정 필요]`), DM 2.1.4(읽는 경로 유지, 데이터 보존), PRD 요청 8·`consents` 요청 6 | 사용자 확인 대기 — **법무 확인 필요**(PIPA 동의 이력 열람). 세 문서 모두 "남긴다"로 같다 |
| **D-DM-13·14·15** | 코드 키 작성 주체(13) / 쌍 상한(14, = SD-Q3 (가)) / `ai_usage_records` 과거 행 비용 2컬럼 **백필 여부**(15) | DM 9장 | 13·14 사용자 확인 대기, **15는 백엔드 확인**(13개월 재계산 비용. 백필하지 않으면 지난달 표의 비용 열이 0으로 보인다) |

### 담당자 간 이견
없다. R-SD-7·R-SD-8은 AI·UX의 **이전 권고**가 리더 판단 SD-A19로 이미 정리된 건이라 이견이 아니라 미반영이다.

## 다음 라운드
R-SD-1~R-SD-17 수정 통지를 받는 대로 해당 경계만 재확인한다. 라운드 2 뒤 남는 이슈는 "미해소"로 리더에게 넘긴다.

---

# 라운드 2 재검토

> 작성: spec-reviewer / 2026-11-05 / 새 이슈 ID `R-SD-18` 이후
> 검토 문서: PRD v4.14 · UX v5.17 · AI v4.12 · DM v4.12 (모두 "리뷰 라운드 1 반영" 판) + `settings-dialog/dm_replies.md`
> 범위: ① 라운드 1 17건의 해소 여부 ② 라운드 1 수정이 새로 만든 어긋남 ③ 미확정 6건의 표시 일치. 사이클 밖(커리어·면접·보드)은 보지 않았다.

## 1. 라운드 1 집계

| 상태 | 건수 | 이슈 |
|------|------|------|
| **해소** | **17** | R-SD-1 ~ R-SD-17 전부 |
| 부분 해소 | 0 | — |
| 미해소 | 0 | — |

각 이슈의 근거는 위 라운드 1 절의 "상태 (라운드 2)" 줄에 한 줄씩 적었다. 네 담당자 모두 자기 몫을 반영했고, 라운드 1의 핵심 위험(UI가 폐기될 컬럼 `interested_industries`를 보고 만드는 일)은 사라졌다.

## 2. 담당자가 스스로 올린 두 자리 — 확인 결과

### R-SD-24 [확인 — 이슈 아님] 사용량 토큰 보조 표기의 범위가 AI C-13 비용 분할 식과 같다
- 경계: UX S-42 ↔ AI C-13 ↔ DM 2.9.5
- 대조:
  - UX S-42 기능별 표: "입력 비용 칸 아래는 **`input_tokens` + `cached_input_tokens` + `cache_write_tokens`를 더한 한 수**(입력 비용에 캐시 읽기·쓰기 비용이 들어 있으므로 …) `[가정]`, 출력 비용 칸 아래는 `output_tokens`"
  - AI C-13: `input_cost_usd` = `input_tokens × 입력 단가 + cached_input_tokens × 캐시 읽기 단가 + cache_write_tokens × 캐시 쓰기 단가` / `output_cost_usd` = `output_tokens × 출력 단가`(사고 토큰은 `output_tokens`에 이미 포함)
  - DM 2.9.5 `providers[].by_feature[]`: 네 토큰 값(`input_tokens`·`cached_input_tokens`·`cache_write_tokens`·`output_tokens`)을 모두 돌려준다
- 판정: **세 토큰 = 입력 쪽, `output_tokens` = 출력 쪽**으로 세 문서가 정확히 같은 범위를 가리킨다. 응답에 필요한 필드도 다 있다. `reasoning_tokens`를 보조 표기에 더하지 않는 점도 AI의 "출력 쪽에 한 번만"과 맞는다(더하면 이중 계산이 된다). 수정 필요 없음.

### R-SD-25 [확인 — 이슈 아님] `document_path = '/policies/ai_data_use/{version}'`은 UX S-30과 모순되지 않는다
- 경계: DM 2.1.3 ↔ UX S-30
- 대조: DM 2.1.3 — "`document_path = '/policies/ai_data_use/{version}'` … 이 값은 링크가 아니라 기록용이고, **문서 페이지 주소는 버전 없는 `/policies/ai_data_use`**다 — UX S-30의 괄호 설명과 같다" / UX S-30 공통 줄 — "`document_path`(`/policies/{type}/{version}`)는 기록용 값이고 링크로 쓰지 않는다(그 주소의 페이지는 없다)" + 페이지 표의 주소는 `/policies/ai_data_use`
- 판정: **기록 값과 페이지 주소가 다른 두 값**임을 양쪽이 같은 말로 적었다. 네 문서가 같은 `/policies/{type}/{version}` 규칙을 쓰고 예외가 없다. 수정 필요 없음.

## 3. 새 이슈

### R-SD-18 [Major] `profile_job_interests`의 중복 쌍 차단이 성립하지 않고, 중복 오류 코드가 없다
- 경계: UX ↔ 데이터 모델 (라운드 1에서 UX가 새로 적은 문장)
- 근거:
  - UX S-24 ① 관심 직군·직무 쌍 행(v5.17 리뷰 라운드 1 신설): "같은 쌍을 두 번 고르면 '이미 고른 직군·직무예요'로 막는다(**DB도 `unique (user_id, job_family, job_role)`로 막는다**) `[가정]`"
  - DM 2.1.2: "`job_role` text **null**. … **직군만 고르고 직무를 비워 둔 상태를 허용한다**" / "`unique (user_id, job_family, job_role)` — 같은 쌍을 두 번 담지 않는다"
  - DM 7장 "내 정보 저장" 오류 목록: `stale_write` · `invalid_profile_option` · `field_too_long` · `invalid_period` · `too_many_job_interests` — **중복 쌍 오류 코드가 없다**
- 문제 두 가지:
  1. Postgres의 unique 제약은 기본이 `NULLS DISTINCT`다. `job_role`이 null인 행은 서로 다른 값으로 취급되므로 **"같은 직군 + 직무 비움" 쌍 2개가 제약을 통과한다**. UX가 "DB도 막는다"고 적은 보장이 직군만 고른 상태(= DM이 명시적으로 허용한 상태)에서 깨진다.
  2. 제약이 걸리는 경우에도 RPC 오류 목록에 중복용 코드가 없어, 구현이 raw 유니크 위반(23505)을 그대로 올리거나 임의 코드를 만든다. UX 오류 표(5종)에도 그 문구가 없어 화면이 "이미 고른 직군·직무예요"를 어디서 받는지 정해지지 않았다.
- 담당자: **data-architect**(제약·오류 코드), ux-planner(오류 표에 한 줄 추가)
- 제안 수정:
  - DM 2.1.2: `unique nulls not distinct (user_id, job_family, job_role)`(PG 15+) 또는 부분 unique 2개(`where job_role is not null` + `unique (user_id, job_family) where job_role is null`)로 바꾸고, 어느 쪽인지 한 줄로 적는다.
  - DM 7장 오류 목록에 **`duplicate_job_interest`**(400)를 더한다(쌍 전체 덮어쓰기라 저장 요청 안의 중복도 RPC가 먼저 걸러야 한다 — insert 전에 거부하는 쪽이 메시지가 깔끔하다).
  - UX S-24 ① 오류 표에 그 코드 한 줄("이미 고른 직군·직무예요", 해당 행 포커스)을 더하고 쌍 행 비고의 `[가정]`을 확정으로 내린다.

### R-SD-19 [Minor] AI 명세 ux-planner 요청 3이 SD-A19로 확정된 것을 아직 묻고, 확정과 반대되는 표현을 들고 있다
- 경계: AI 명세 ↔ 결정 입력 SD-A19 ↔ UX (R-SD-7의 같은 결정이 남은 다른 자리)
- 근거: `02_ai-feature-designer_ai-spec.md` "ux-planner (UX 02)" 요청 3 — "새 결과에는 이 칩이 아예 생기지 않으니 **'원본이 삭제된 근거' 상태 표시만 있으면 됩니다**. 칩 자체를 없앨지, 비활성 상태로 둘지 **정해 주세요**." / SD-A19·DM 2.8·같은 문서 C-3 각주: **"원본 삭제됨"으로 보이지 않는다**(원본 데이터가 아니라 원본 화면이 없어졌다), 칩은 라벨 유지 + "원본으로 이동"만 비활성 — UX도 이미 그렇게 적었다
- 담당자: ai-feature-designer
- 제안 수정: 요청 3을 "**(해소 — SD-A19 / UX v5.17 C-01·C-02)**"로 바꾸고 본문을 확정 내용으로 줄인다(칩 라벨 유지, "원본으로 이동" 비활성, "원본 삭제됨" 표시 아님). 지금은 C-3 각주와 같은 문서 안에서 서로 다른 말을 한다.

### R-SD-20 [Minor] AI 명세 data-architect 요청 1·5에 "해소" 표시가 없다 (2·4에만 있다)
- 경계: 전 문서 (미확정 항목 표시 일치)
- 근거: AI 요청 1(컨텍스트 팩이 `profiles`를 읽지 않는다는 한 줄을 적어 달라) → DM **2.1.5**가 그 줄과 `app_ai_writer` 권한 차단까지 적었다(`dm_replies.md` 2-1). 요청 5(교차 집계·묶음 원천) → DM **2.9.5**가 채택했다(`dm_replies.md` 2-5). 그런데 같은 절의 요청 2·4에는 "(해소 — …)" 머리말이 붙었고 1·5에는 없다.
- 담당자: ai-feature-designer
- 제안 수정: 요청 1·5 앞에 같은 모양의 "(해소 — DM v4.12 2.1.5 / 2.9.5)"를 붙인다. PRD·UX는 라운드 1에서 요청 절을 정리했는데 AI만 반쯤 남아, 읽는 사람이 열린 요청으로 센다.

### R-SD-21 [Minor · 리더 대신 직접 수정] UX 머리글 기준 입력의 "PRD v4.3"만 옛 값이었다
- 경계: 전 문서 (버전 표기, R-SD-10 잔여)
- 근거: UX 1~2행 기준 입력 목록이 R-SD-10으로 "데이터 모델 v4.12"·"AI 명세 v4.12"로 올라갔는데 같은 목록의 PRD만 **v4.3**이었다(바로 뒤 "v5.17 짝 문서 기준 버전: PRD v4.14"와 한 문장 안에서 어긋남).
- 처리: **리뷰어가 직접 고쳤다** — `(**PRD v4.3**, BYOK)` → `(**PRD v4.14**, BYOK)`. 한 줄 표기 수정이고 같은 문장의 짝 문서 버전과 맞춘 것뿐이다. ux-planner는 다음 판에서 이 수정을 그대로 두면 된다.

### R-SD-22 [Minor] 가격표 버전 문자열 모양이 DM과 AI에서 다르다
- 경계: 데이터 모델 ↔ AI 명세 (라운드 1에서 교체된 2.9.5 응답에 그대로 들어갔다)
- 근거: DM 2.9.3 `version` "예: `2026-10-26.1`"과 2.9.5 새 응답 JSON `"version": "2026-10-26.1"`(두 자리) / AI C-13 "버전 규칙: **`v{YYYY-MM-DD}`**", 첫 버전 **`v2026-10-28`**, 예정 버전 `v2026-12-01`·`v2027-01-01`
- 영향: 화면이 "가격표 {version} · 기준일 {source_checked_at}"을 그대로 보이므로(UX S-42) 시드 값과 화면 문구가 어느 모양인지 구현이 임의로 고른다. 사이클 전부터 있던 차이지만 **이번 판 새 응답 예시에 복사됐다.**
- 담당자: data-architect(2.9.3·2.9.5 예시) — AI C-13의 `v2026-10-28` 쪽이 시드 표의 원천이므로 DM을 맞추는 쪽을 권한다
- 제안 수정: DM의 예시 값을 `v2026-10-28`(또는 AI 첫 버전과 같은 문자열)로 바꾸고 "버전 규칙은 AI C-13 `v{YYYY-MM-DD}`" 한 줄을 2.9.3에 적는다.

### R-SD-23 [Minor] `compute_total_experience_months`의 `p_as_of` 기본값이 "함수 안에서 `now()`를 읽지 않는다"와 어긋난다
- 경계: 데이터 모델 ↔ AI 명세 (R-SD-6으로 새로 적힌 시그니처)
- 근거: DM 6.2 시그니처 — `p_as_of date default (now() at time zone 'Asia/Seoul')::date` / 같은 절 바로 아래와 `dm_replies.md` 2-2 — "**함수 안에서 `now()`를 읽지 않는다**(테스트·재현)" / AI C-1 — "함수는 안에서 `now()`를 읽지 않고 호출자가 넘긴 `p_as_of`의 달을 기준월로 쓴다"
- 영향: 기본값은 호출 시점에 평가되므로 인자를 생략하면 그 호출이 `now()`에 의존한다. 팩 조립 경로가 인자를 생략하면 "같은 입력에 같은 결과"라는 전제(동일 입력 재사용·pgTAP)가 조용히 깨진다.
- 담당자: data-architect
- 제안 수정: 기본값을 없애 필수 인자로 두거나, 기본값을 남긴다면 "**팩 조립·`get_data_readiness` 등 모든 내부 호출은 `p_as_of`를 명시해 넘긴다**(기본값은 수동 조회 편의용)" 한 줄을 6.2에 적는다.

## 4. 미확정 항목 — 네 문서 표시 일치 (최종 확인)

| ID | PRD v4.14 | UX v5.17 | AI v4.12 | DM v4.12 | 일치 |
|----|-----------|----------|----------|----------|------|
| **SD-Q1** 개선 요청 폼 주소 | 7장 결정 필요 표 "사용자" | S-24 ④ "준비 중" + 5.1j `[결정 필요]` | 해당 없음 | 2.1.6 "앱 상수·env", 11.7 #14 | **일치** |
| **SD-Q2** 내 정보 값 목록 7종 | 9.7 초안 `[결정 필요: 값 목록 — 사용자 확정]` | 5.1j "PRD 9.7 초안을 그대로 쓰고 UX에서 다시 정의하지 않는다" | 해당 없음 | DM-22·2.1.1·시드(= D-DM-13) | **일치**. 값 수도 그대로 맞는다(9.7 7/9/11/8/52/8/6 ↔ DM 2.1.1 시드 줄) |
| **SD-Q3 (가)** 쌍 최대 3 | F-P1-01 (2) `[가정]` + 7장 | S-24 ① 쌍 행 `[가정]`, 5.1j | 해당 없음 | 2.1.2 `[가정]` + D-DM-14 | **일치** |
| **SD-Q3 (나)** 토큰 열·합계 카드 삭제 | F-AI-07 (2) `[가정]` + 7장 | S-42 합계 카드 "없앴다(확인 SD-Q3 (나))" | C-13 미터 표시 범위(SD-A11 반영, 열린 결정 없음) | 2.9.5 "합계 토큰 카드가 없어졌어도 `totals`는 남긴다" | **일치** |
| **SD-Q3 (다)** 필수 동의 기록 표시 삭제 | 요청 8 "남긴다 + `[결정 필요]`" | 약관 탭 행 `[결정 필요]`, 남겨 둠 | 해당 없음 | 2.1.4·1720행 "읽는 경로 유지, 데이터 보존" | **일치** (법무 확인 필요 그대로) |
| **D-DM-13** 코드 키 작성 주체 | 요청 2에 "확정은 SD-Q2" | — (DM 몫) | — | 9장 D-DM-13 | **일치** |
| **D-DM-14** 쌍 상한 | F-P1-01 (2) `[가정]` | S-24 ① `[가정]` | — | 9장 D-DM-14 | **일치** (= SD-Q3 (가)) |
| **D-DM-15** 과거 행 비용 백필 | 요청 5 "DM의 `[결정 필요]` D-DM-15로 남아 있다" | S-42 표 비고 "백필하지 않으면 지난달 비용 열이 0으로 보인다" | C-13(기록 시점 계산만, 백필은 DM 몫) | 9장 D-DM-15 + 2.9.2 백필 `[가정]` + 11.7 #8 ② | **일치** (백엔드 확인) |

**새로 생긴 사용자 결정은 없다.** 라운드 2의 새 이슈 6건은 모두 담당자가 문서에서 고칠 수 있는 범위다(R-SD-18만 DB 제약 설계 판단을 포함한다).

### 담당자 간 이견
없다.

## 5. 다음 라운드
라운드 2까지로 정한 상한에 닿았다. **R-SD-18**(Major)은 구현에 바로 닿으므로 리더가 data-architect에게 한 줄 수정 요청으로 처리하는 것을 권한다. R-SD-19·R-SD-20·R-SD-22·R-SD-23은 다음 판에 함께 반영하면 되고, R-SD-21은 리뷰어가 이미 고쳤다. 이 넷이 남아도 구현이 어긋나게 만들 자리는 R-SD-22(시드 값 모양)·R-SD-23(결정성)뿐이다.
