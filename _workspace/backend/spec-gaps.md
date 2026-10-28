# 기획 차이 (spec gaps)

기획 문서와 구현 사이의 모순·누락. 항목마다 날짜, 슬라이스, 문서·섹션, 내용, 임시 조치(`[가정]`)를 적는다. 기획 수정은 `resumate-planning`으로 한다.

## 2026-10-24 · S1 · DM 부록 A.2 policy_versions / consents
- 내용: ① 초기 정책 버전 값(버전 문자열 형식, 시행일, 문서 경로)이 정해져 있지 않다. ② 선택 동의(`service_improvement`, `marketing`)가 어느 `policy_type` 버전을 따르는지 정해져 있지 않다(`policy_type`은 terms/privacy/cross_border_transfer 3종뿐).
- 임시 조치 `[가정]`: ① 마이그레이션에 3종 각각 `version = '2026-10-01'` 행을 넣고 `document_path = '/policies/{type}/{version}'`. ② 선택 동의는 `privacy` 버전을 따른다. 실제 약관 문서와 시행일은 출시 전 확정 필요(D-10).

## 2026-10-24 · S1 · DM 부록 A.2 consents (재동의 판단)
- 내용: ① 정책 버전이 바뀌었을 때 선택 동의(`service_improvement`, `marketing`)도 다시 물어야 하는지 정해져 있지 않다. ② 필수 동의의 재동의 판단 기준(최신 버전의 `requires_reconsent`만 볼지, 동의한 버전 이후 모든 버전을 볼지)이 정해져 있지 않다.
- 임시 조치 `[가정]`: ① 선택 동의는 `get_consent_status().needs_consent`가 항상 false(동의 게이트에 영향 없음). 이전 선택 동의는 버전과 무관하게 유효로 본다. ② 동의한 버전보다 뒤이고 지금 시행 중인 버전 중 하나라도 `requires_reconsent = true`면 재동의 필요(중간 버전을 건너뛴 경우도 잡는다).

## 2026-10-25 · S2 · DM §2.3 achievements `kind`(generated)
- 내용: `kind`가 generated 컬럼이라고만 되어 있고 값 목록·계산식이 없다(AI 명세 C-1도 `kind`를 읽기만 함).
- 임시 조치 `[가정]`: `metric_name`이 있고 `value_before`/`value_after` 중 하나가 있으면 `quantitative`, 아니면 `qualitative`.

## 2026-10-25 · S2 · DM 부록 A.4 skills `normalized_name`
- 내용: 정규화 규칙이 없다(대소문자, 공백, `React.js` vs `React` 같은 표기 차이).
- 임시 조치 `[가정]`: 앞뒤 공백 제거 → 연속 공백 1칸 → 소문자. 표기 차이(별칭)는 합치지 않는다.

## 2026-10-25 · S2 · DM §4.2 `delete_career_item` 모드 값
- 내용: `affiliation_mode`·`result_mode`의 값 이름이 정의되지 않았다(기본 동작 설명만 있음).
- 임시 조치 `[가정]`: `affiliation_mode` ∈ (`keep_projects` 기본, `delete_projects`), `result_mode` ∈ (`keep_results` 기본, `delete_results`) — UX C-05 표기에 맞춤(S2 구현 시 정정).

## 2026-10-25 · S2 · DM §4.2 `delete_career_item` 모드 값 (위 항목 정정)
- 내용: 위 항목은 "값 이름이 정의되지 않았다"고 했으나 UX 02 C-05(삭제 확인)에 `result_mode` = `keep_results`(기본) / `delete_results`, `affiliation_mode` = `keep_projects`(기본) / `delete_projects`가 정의되어 있다. DM §4.2에는 값 이름이 없다(문서 간 누락).
- 조치: UX 02 값으로 구현(`keep_results`/`delete_results`). 위 항목의 `keep`/`delete` 가정은 쓰지 않는다. api `RESULT_MODES`도 같은 값. DM §4.2에 값 이름을 적어 달라는 요청.

## 2026-10-25 · S2 · DM §6 `profile_filled` 정의
- 내용: `counts.profile_filled`와 `data_sufficiency = thin`의 "프로필이 있음"이 어떤 필드 기준인지 정의가 없다.
- 임시 조치 `[가정]`: `desired_job_title`(공백 아님) / `total_years_of_experience` / `interested_industries`(비지 않음) 중 하나라도 있으면 true. `display_name`은 AI 입력이 아니어서 제외.

## 2026-10-25 · S2 · DM §6 readiness 세부 규칙
- 내용: ① `next_action = 'form'`일 때 `suggested_mode`를 줄지 ② `projects_without_complete_detail`이 draft 소속(경력·교육) 아래 프로젝트도 세는지 ③ `hints: ["profile"]`을 ready일 때도 붙이는지 ④ `missing`/`hints`를 ready일 때 생략하는지가 정해져 있지 않다.
- 임시 조치 `[가정]`: ① form이면 `suggested_mode`·`suggested_project_id` 없음(경력 저장 후 다시 판정). ② 포함 규칙(소속이 draft면 제외)을 적용해 세고, `suggested_project_id`도 그 안에서 최근 수정순 1건. ③ 붙인다(참고용). ④ 항상 둔다(ready면 `missing: []`). 세 기능(insight/draft/job_interview)은 같은 객체.

## 2026-10-25 · S2 · DM §4.2 `get_deletion_impact` `cascade` 집계 범위
- 내용: `cascade` 개수에 삭제 대상 자신을 포함하는지(예: 프로젝트 삭제 시 `projects: 1`?), 고아 태그 스킬 자동 삭제분을 세는지 정해져 있지 않다.
- 임시 조치 `[가정]`: 대상 자신은 제외(하위만). 고아 태그 스킬 자동 삭제분은 세지 않는다(키 목록에 skills 없음).

## 2026-10-25 · S2 · DM §2.3 / A.3 / A.4 길이 제한 누락
- 내용: `experiences.company_name`·`job_rank`·`job_position`·`department`, `projects.name`·`role`, `achievements.metric_name`·`unit`·`description`의 길이 제한이 없다(교육·상세 내용은 있음).
- 임시 조치: DB CHECK를 두지 않음(스펙대로). 입력 길이는 api zod에서만 제한된다. 값이 정해지면 새 마이그레이션으로 CHECK 추가.

## 2026-10-25 · S2 · DM §6 `suggested_mode` — 필드가 빠져 미완료인 프로젝트 (backend-qa)
- 내용: §6은 `new_project`(완료 프로젝트가 없을 때) / `augment_project`(프로젝트는 있으나 complete 상세 내용이 없을 때)만 정의한다. complete 상세 내용은 있는데 `name`·`role`이 비어 draft인 프로젝트는 어느 쪽에도 해당하지 않는다. 현재 구현은 `projects_without_complete_detail = 0`이라 `suggested_mode: "new_project"`, `hints`에 해당 문구 없음 → 사용자는 역할 한 칸만 채우면 되는데 "새 프로젝트를 AI와 정리"로 안내된다(QA 프로브: 경력 complete + 역할 없는 프로젝트 + complete 상세 내용 1건).
- 임시 조치 `[가정]`: 구현 그대로 둔다. 기획에서 ① `next_action: "form"` + `suggested_project_id`로 프로젝트 폼(S-10)을 열지 ② 별도 hint(예: `project_fields`)를 둘지 정해 달라.

## 2026-10-26 · S3 · DM A.16 usage_limits `chat_message`
- 내용: 커리어 채팅(Should) 한도가 D-12로 미정이라 `usage_limits`에 값이 없다.
- 임시 조치 `[가정]`: 한도 행이 없는 기능은 예약을 거부한다(`usage_limit_missing`). AI-09는 Should라 MVP에서 쓰지 않는다.

## 2026-10-26 · S3 · DM A.14·A.15 application_project_id FK
- 내용: `evidence_links`·`ai_jobs`의 `application_project_id`는 S5의 `application_projects`를 가리키지만, 카탈로그상 테이블은 S3에서 만든다.
- 임시 조치: S3에서는 uuid 컬럼만 두고 FK(cascade)는 S5에서 추가한다. 기획 문제는 아니고 구현 순서 문제라 기록만 한다.

## 2026-10-26 · S3 · DM A.15 ai_jobs 단계 결과 보존
- 내용: AI C-6은 "비동기 작업은 완료된 단계 결과를 보존하고 실패한 단계부터 다시 실행"하라고 하지만, A.15에는 단계 결과를 담을 컬럼이 없다(`output`은 `draft_source_ranking` 전용).
- 임시 조치 `[가정]`: `ai_jobs.step_outputs jsonb not null default '{}'`(단계 이름 → 결과)를 추가한다. app_ai_writer만 쓴다. 보관은 ai_jobs와 같은 90일.

## 2026-10-26 · S3 · DM A.15 ai_jobs `target_type` 값 / 상태 전이
- 내용: ① `target_type`의 허용값 목록이 없다(`writing_chat`만 §2.9에 나옴). ② `status` 전이 규칙(실패 후 재시도가 같은 행인지, 종료 상태에서 되돌릴 수 있는지)이 정해져 있지 않다.
- 임시 조치 `[가정]`: ① CHECK 없이 자유 text, `writing_chat_turn`만 `target_type = 'writing_chat'` + `application_project_id is null` CHECK. ② DB 트리거로 `succeeded`·`canceled`는 종료, `failed`는 `queued`로만(재시도 = 같은 행, error_code·finished_at 비움), 그 외 `invalid_ai_job_transition`. 멈춤 처리 후 되살아난 실행기가 결과를 덮어쓰지 못하게 하려는 것.

## 2026-10-26 · S3 · AI C-3 / DM §2.8 근거 저장 직전 원본 삭제
- 내용: 컨텍스트 팩을 만든 뒤 결과를 저장하기 전에 사용자가 원본을 지우면, 삭제 트리거는 이미 지나가 인용문이 남는다. 스펙에 처리 규칙이 없다.
- 임시 조치 `[가정]`: `evidence_links` insert 트리거가 커리어 원본(6종 + profile)이 없거나 다른 사용자 것이면 `quote = null`, `source_deleted_at = now()`로 저장한다(화면은 "근거와 발췌가 삭제되었습니다"). JD·답변·메모 원본은 해당 슬라이스에서 같은 검사를 추가.

## 2026-10-26 · S3 · DM §4.4 보유 기간 정리
- 내용: `ai_jobs` 90일, `usage_events` 13개월 삭제는 DB에 아직 없다(정리 주체 미정).
- 임시 조치: S3에서는 구현하지 않음. 크론 슬라이스에서 service_role 정리 함수로 추가 예정.

## 2026-10-26 · S3 · AI C-6 실패 처리 — 분류되지 않은 예외의 error_code
- 내용: `ai_jobs.error_code` CHECK에 내부 오류 값이 없다. 단계 안의 버그·DB 오류처럼 C-6 코드로 분류되지 않는 예외를 어떤 코드로 남길지 스펙에 없다.
- 임시 조치 `[가정]`: `model_unavailable`(일시적)로 보고 자동 재시도 1회 → 그래도 실패면 `failed`/`model_unavailable` + 사용량 해제. 화면은 "일시적 오류, 다시 시도" 문구. 로그에는 job_id·단계만 남긴다(C-7).

## 2026-10-26 · S3 · AI C-6 자동 재시도 대상에 `refused` 포함 여부
- 내용: C-6은 "모델 오류·타임아웃·스키마 불일치 → 자동 재시도 1회"라고 하고, 거절은 "실패로 처리하고 재시도 안내"라고 한다. 거절을 자동 재시도할지 불분명하다.
- 임시 조치 `[가정]`: ai-pipeline의 `AiError.retryable`(model_unavailable, rate_limited, schema_invalid, refused, timeout)을 그대로 따른다 → `refused`도 1회 자동 재시도. 입력 범주(`not_a_jd`, `insufficient_data`, `input_too_long`)와 `canceled`는 재시도하지 않는다.

## 2026-10-26 · S3 · AI C-6 / PRD 6.5 수동 재시도(재시도 버튼)의 사용량
- 내용: "실패 시 재시도 버튼", "완료된 단계 보존·실패 단계부터 재실행"은 있으나, 재시도가 같은 작업 행인지와 사용량 `reason` 값이 정해져 있지 않다.
- 임시 조치 `[가정]`: `POST /api/ai-jobs/{id}/retry` — 같은 행을 `failed → queued`로 되돌리고(완료 단계 `step_outputs` 유지) 새로 예약(`reason = 'initial'`, 앞선 예약은 이미 released). 입력 범주 실패는 409 `ai_job_not_retryable`(입력을 고쳐 새로 시작해야 함).

## 2026-10-26 · S3 · AI C-1 `career_snapshot_hash` 계산 대상
- 내용: C-1은 "팩의 해시"라고 하지만, 팩에는 재직 중 경력의 기간(`computed_duration`, 연차)처럼 기준 월마다 바뀌는 값이 있다. 팩 텍스트를 해시하면 데이터를 고치지 않아도 매달 "데이터 변경됨"(F-P2-07)이 뜨고 동일 입력 재사용(C-6)이 깨진다.
- 임시 조치 `[가정]`: `career_snapshot_hash`는 팩에 포함된 행의 **내용 필드**(정규 JSON) 해시로 계산한다. 팩 텍스트 자체는 기준 월에 따라 달라질 수 있다(`src/server/ai/context-pack/career-pack.ts`).

## 2026-10-26 · S3 · AI C-6 거절(refusal) 처리와 서버 측 대체 모델
- 내용: C-6은 거절을 "실패로 처리하고 재시도 안내"라고 한다. Anthropic API의 서버 측 대체(`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`)를 켜면 정책상 거절이 나도 같은 호출 안에서 다른 모델이 이어서 답한다(결과의 `model`이 요청 모델과 다를 수 있음).
- 임시 조치 `[가정]`: 서버 측 대체를 켠다. 대체 체인 전체가 거절해야 `refused`로 실패한다. 결과·로그의 `model`은 실제 응답 모델, `fallbackUsed`로 표시. 끄려면 `anthropic-client.ts` `buildParams` 한 곳만 바꾸면 된다. 모델 장애(과부하·5xx) 대체는 별도로 이전 세대 모델 1회(`AI_UNAVAILABLE_FALLBACK`, 출력이 나가기 전에만).

## 2026-10-26 · S3 · AI C-3 V-5 수치 비교 규칙 세부
- 내용: "같은 값으로 존재"의 비교 단위(단위·자릿수 표기·만/억, 영문 이름 속 숫자)가 정해져 있지 않다.
- 임시 조치 `[가정]`: 숫자 값만 비교(단위 무시), 쉼표 제거, `만/억/천/조`는 곱한 값으로 비교(원천은 곱한 값과 맨 숫자 둘 다 허용). 별칭(`PRJ-3`, `S12`)과 영문자에 붙은 숫자(`EC2`, `B2B`, `K8s`, `3D`)는 수치로 보지 않는다. 서버 계산 허용값은 기간의 개월 수·연 수·나머지 개월·"N년차"(연 수 + 1). 비율처럼 원천 두 값에서 계산되는 값(1.2초→0.7초의 41%)은 허용하지 않는다.

## 2026-10-26 · S3 · AI C-5 목록에 없는 자리 표시
- 내용: 모델이 6종 외의 토큰(예: `[회사명 입력 필요]`)을 쓰면 어떻게 할지 없다.
- 임시 조치 `[가정]`: `[… 필요]` 모양의 미등록 토큰은 `[내용 확인 필요]`로 바꾸고 `validation_report.unknown_placeholders`로 센다. `placeholders` 배열은 본문 순서로 다시 만든다(개수 불일치는 `placeholder_mismatches`).

## 2026-10-27 · 해소 · 위 두 거절 항목 (78행·89행)
- 사용자 결정: 명세 C-6대로 한다. 서버 측 거절 대체를 끄고(`REFUSAL_FALLBACKS_ENABLED = false`), `refused`는 바로 실패 처리한다. 자동 재시도는 하지 않고 재시도를 안내한다. 모델 장애(5xx) 때 이전 세대 모델로 1회 대체하는 것은 거절과 무관하므로 유지한다.

## 2026-10-28 · BYOK 기획 개정(v4) 후 위 항목 재분류
| 항목 (행) | v4 상태 | 이유 |
|-----------|---------|------|
| usage_limits `chat_message` (49행) | **폐기** | `usage_limits` 자체가 없어짐(D-34) |
| 분류되지 않은 예외의 error_code (73행) | **재검토 필요** | v3 코드 `model_unavailable`가 없어짐. S3a에서 v4 목록 안에서 다시 정한다(후보: 시스템 원인이므로 `schema_invalid`/`timeout`이 아닌 경우 `provider_unavailable`로 볼지) |
| `refused` 자동 재시도 (77행), 거절 대체 (89행) | **해소** | v4 C-11.1: 거절은 `safety_blocked`, 재시도 0회, 자동 대체 없음(D-31) |
| 수동 재시도의 사용량 `reason` (81행) | **폐기** | 차감·예약이 없어짐. 재시도 각 호출은 사용 기록 1행씩 |
| ai_jobs 단계 결과 보존 `step_outputs` (57행) | 유지 | v4 2.9.1에도 단계 결과 컬럼이 없음 |
| ai_jobs 상태 전이·`target_type` (61행) | 유지, S3a에서 갱신 | v4가 `target_type = 'application_project'` 예시만 추가 |
| 그 밖의 S1·S2·S3 항목 | 유지 | v4 개정과 무관 |

## 2026-10-28 · S3a · DM §2.9.1 `attempt_count` → `retry_count`와 실행 세대
- 내용: v4는 `attempt_count`를 `retry_count`(재시도 횟수 합계)로 바꿨다. S3 구현은 같은 컬럼을 "실행 세대"(좀비 실행기 차단, QA-S3-05)로 썼다.
- 임시 조치 `[가정]`: 명세대로 `retry_count`를 두고, 실행 세대는 내부 컬럼 `run_generation`으로 분리한다(화면·명세 노출 없음).

## 2026-10-28 · S3a · AI C-11.3 / C-12 `next_run_at` 작업을 깨우는 주체
- 내용: 재시도 대기를 함수 안에서 하지 않고 `next_run_at`으로 예약하라고 하지만, 예약된 작업을 누가 다시 실행하는지 정해져 있지 않다.
- 임시 조치 `[가정]` (사용자 승인 B-4): 작업 상태 조회(화면 폴링 2초)가 `next_run_at`이 지난 작업을 깨우는 것을 주 경로로, Vercel Cron을 안전망으로 둔다. 사용자가 화면을 떠나면 다음 크론까지 멈춘다(Hobby 플랜은 하루 1회).

## 2026-10-28 · S3a · AI C-13 가격표 초안 ↔ 공급자 공식 가격 (조사 2026-10-28)
- 내용: C-13 초안의 Claude Sonnet 5.5 캐시 읽기 0.20은 현재 공식 0.10(입력의 0.05배)이다. Haiku 5.5는 캐시 단가가 비어 있었고(공식 쓰기 0.125 / 읽기 0.01), 10만 토큰 초과 장문 구간이 있다. OpenAI·Gemini는 미정이었다.
- 조치: `S3a/00_model-mapping.md`(사용자 확정)의 값과 버전 3개(`v2026-10-28`, `v2026-12-01`, `v2027-01-01`)를 가격표 시드로 쓴다.

## 2026-10-28 · S3a · 분류되지 않은 예외의 error_code (73행 재검토)
- 임시 조치 `[가정]`: 공급자 오류 표(C-11.2)에 없는 예외는 `provider_unavailable`(재시도 최대 2회)로 기록하고, 로그에 `unclassified: true`를 남긴다. 시스템 코드 목록(C-11.1)에 "내부 오류"가 없어서다.

## 2026-10-28 · S3a · DM §2.9.3 / AI C-13 장문 구간의 캐시 단가 컬럼
- 내용: DM·C-13의 가격표에는 장문 구간 단가가 `long_context_input_usd_per_mtok`, `long_context_output_usd_per_mtok` 두 개뿐이다. 그런데 확정된 매핑(`S3a/00_model-mapping.md` §2)에서는 장문 구간에 캐시 읽기 단가도 바뀐다(OpenAI 3모델: 0.02 / 0.10 / 0.20). Claude Haiku 5.5는 캐시 쓰기 단가(0.625)도 바뀐다. C-13 비용 식도 장문 구간에서 캐시 토큰에 어떤 단가를 쓸지 정하지 않았다.
- 임시 조치 `[가정]`: `ai_price_tables`에 null 허용 컬럼 `long_context_cached_input_usd_per_mtok`, `long_context_cache_write_usd_per_mtok`를 더하고 매핑 값을 시드했다. 비용 계산(api)은 입력이 기준을 넘으면 `long_context_*` 단가를 쓰고, 장문 캐시 단가가 null이면 일반 캐시 단가를 쓰는 것으로 제안한다. 기획에서 DM 2.9.3 표와 C-13 식에 두 컬럼을 반영할지 정해야 한다.

## 2026-10-28 · S3a · AI C-11.2 공급자 오류 표 ↔ 공급자 최신 문서·SDK (ai-pipeline-engineer 확인)
- 내용: C-11.2는 `[가정: 구현 시 최신 오류 문서로 확인]`이다. 확인 결과 표와 다른 점이 있다.
  - OpenAI 공식 오류 문서에는 `insufficient_quota`와 일일(RPD) 한도 코드가 없고, 잔액·한도 계열로 `credit_balance_exhausted`, `organization/project_spend_limit_exceeded`, `organization_usage_limit_exceeded`(모두 429)가 있다. 403 "지원하지 않는 국가·지역"은 표에 없다.
  - Gemini 문서에 402(선불 크레딧 소진)와 snake_case 코드(`quota_exceeded` = 일일 한도, `failed_precondition` 등)가 새로 있다. `API_KEY_INVALID`, `QuotaFailure`(`PerDay`/`PerMinute`), `RetryInfo`는 문서에 없고 실제 응답 본문 관례에 기댄다.
  - Claude는 402 `billing_error`가 따로 있다.
  - OpenAI Responses API는 `max_output_tokens` 최솟값이 16이라 C-10.5의 "출력 1~5토큰"을 지킬 수 없다.
- 임시 조치 `[가정]`: 표의 값과 새 값을 모두 매핑한다. OpenAI 잔액·한도 계열 → `billing_required`, 메시지에 per day/RPD가 있거나 `quota_exceeded` → `daily_quota_exhausted`(초기화 시각은 Retry-After가 있을 때만), 403 지역 미지원 → `billing_required`(Gemini 지역 제한과 같은 원인 3). Gemini 402·`quota_exceeded` → 각각 원인 3·2. Claude 402 → 원인 3. OpenAI 키 검증 2단계는 16토큰. 세부는 `S3a/02_ai-pipeline-engineer_notes.md` §3.

## 2026-10-28 · S3a · AI C-11.3 대기 상한 120초와 공급자 `Retry-After`
- 내용: "작업당 대기 합계 상한 120초"가 다음 대기를 더하기 전 기준인지, 더한 뒤 기준인지 정해져 있지 않다. 공급자가 120초보다 긴 `Retry-After`를 줄 때의 처리도 없다.
- 임시 조치 `[가정]`: `이번 실행의 대기 합계 + 다음 대기 ≤ 120초`일 때만 `next_run_at`으로 예약한다. 넘으면 그 원인으로 최종 실패하고 `retry_after`를 기록한다(`src/server/jobs/retry.ts`).

## 2026-10-28 · S3a · 수동 재시도("다시 시도")의 재시도 횟수·대기 예산
- 내용: 수동 재시도 때 호출당 재시도 횟수와 120초 대기 예산을 다시 시작하는지 정해져 있지 않다. DB 가드는 `retry_count`·`retry_wait_total_ms`를 비우지 않는다.
- **사용자 확정 (2026-10-28)**: 수동 재시도는 새 실행으로 본다. 호출당 횟수와 대기 예산(120초)은 새로 시작한다(`step_outputs._meta.waitBase`, `retries`). 컬럼 `retry_count`·`retry_wait_total_ms`는 작업 전체 누계로 계속 늘어난다.

## 2026-10-28 · S3a · 실행기 자체 오류(공급자 무관)의 error_code
- 내용: 단계 밖의 실패(체크포인트 저장 DB 오류, `complete_ai_job` 2회 실패, 등록되지 않은 job type)를 C-11.1의 어떤 코드로 남길지 정해져 있지 않다. 단계 안의 미분류 예외는 앞 항목대로 `provider_unavailable`이다.
- 임시 조치 `[가정]`: 공급자와 무관하므로 `stalled`(system, "작업이 중단되었습니다", 다시 시도 가능)로 끝낸다. `provider_unavailable`로 두면 화면에 "공급자 장애"가 잘못 보이기 때문이다.

## 2026-10-28 · S3a · 가격표에 없는 모델의 사용 기록
- 내용: 호출한 모델이 그날 유효한 가격표 버전에 없을 때의 처리가 없다(`price_table_version` not null).
- 임시 조치 `[가정]`: `price_table_version = 'unpriced'`, `estimated_cost_usd = 0`으로 기록하고 로그 `ai_usage.unpriced`를 남긴다. 화면의 가격표 버전 목록에 `unpriced`가 보일 수 있다(매핑 모델 9개가 모두 시드되어 있어 정상 경로에서는 생기지 않음).

## 2026-10-28 · S3a · 작업 시작 거부 코드 (AI 미연결·키 무효)
- 내용: 활성 공급자가 없거나 키가 `invalid`일 때 작업 시작 API의 오류 코드가 정해져 있지 않다(화면은 readiness `ai_connection`으로 먼저 잠근다).
- 임시 조치 `[가정]`: 409 `ai_not_connected` / 409 `key_invalid`, 작업 행을 만들지 않는다. `needs_check`는 실행을 허용한다(UX C-19).

## 2026-10-28 · S3a · 대상 없는 작업과 동시 실행 1개
- 내용: DB 고유 인덱스는 `target_type`·`target_id`가 null이면 제한하지 않는다. `key_verification`의 대상이 정해져 있지 않다.
- 임시 조치: 실행기는 대상이 없으면 같은 `input_hash`의 진행 중 작업을 따라간다(이중 클릭 방지, DB 보장은 없음). 기능 슬라이스는 모든 작업에 대상을 넣는다. `key_verification` 대상(예: `target_type = 'ai_provider'`, `target_id` = 키 행 id)은 S3b에서 정한다.

## 2026-10-28 · S3a QA · AI C-10.2 Gemini 구조화 출력 방식
- 내용: C-10.2는 Gemini를 `responseSchema`(OpenAPI 부분집합, anyOf 미사용)로 적었다. 구현은 `responseJsonSchema`(JSON Schema)를 쓰고, nullable 필드는 `anyOf [T, null]`로 보낸다. SDK 타입 주석상 `anyOf`·`enum`·`additionalProperties`·`propertyOrdering`을 지원한다.
- 임시 조치 `[가정]`: 구현 그대로 둔다. 실제 키로 스모크 확인이 필요하다. 기획에서 C-10.2 표기를 고칠지 정한다.

## 2026-10-28 · S3a QA · DM §5 app_ai_writer의 ai_usage_records select
- 내용: DM §5는 app_ai_writer에 `ai_usage_records` insert만 준다. 구현은 본인 행 select를 더했다. C-12 호출 간격(마지막 `occurred_at`) 조회와 `insert … returning`에 필요해서다.
- 임시 조치 `[가정]`: select 본인(RLS)을 유지한다. DM §5 표에 반영할지 정한다.

## 2026-10-28 · S3a QA · 수동 재시도와 활성 공급자 변경 (F-AI-03 (2))
- 내용: "진행 중 공급자 변경은 다음 실행부터"인데, 실패 작업의 "다시 시도"가 다음 실행인지 정해져 있지 않다. 지금은 작업 행에 고정된 옛 공급자로 다시 돈다. 그 키를 지웠다면 `key_missing`으로 끝난다.
- 임시 조치: 구현 그대로 둔다(작업 행 공급자 고정). S3b 전에 결정이 필요하다.

## 2026-10-28 · S3a QA · 스트리밍(SSE) 기능의 첫 토큰 전 자동 재시도 주체 (C-11.3)
- 내용: C-11.3은 스트리밍 응답의 첫 토큰 전 오류를 자동 재시도하라고 한다. 그런데 SSE 경로는 작업 실행기(`next_run_at`)를 쓰지 않는다. 대기(2~16초, Retry-After)를 열린 연결 안에서 할지, 클라이언트 재요청으로 할지 정해져 있지 않다. S3a에는 SSE 경로 재시도가 없다.
- 임시 조치: S4 계획에서 정한다.

## 2026-10-28 · S3a · 해소 · 단계 안의 비공급자 예외 (QA-S3a-02)
- **사용자 확정**: 단계 안에서 난 예외 중 공급자 호출 밖의 것(우리 버그, DB 오류, 검증기 오류 등 `ProviderError`가 아닌 것)은 `stalled`로 끝내고 재시도하지 않는다. 공급자 호출 안에서 난 분류되지 않은 오류만 `provider_unavailable`(최대 2회 재시도)로 둔다. 위 "분류되지 않은 예외의 error_code (73행 재검토)" 항목과 "실행기 자체 오류" 항목은 이 규칙으로 정리된다.

## 2026-10-29 · S3b · DM 2.11.6 `ai_disclosures` 초기 버전 / 2.11.3 `save_provider_key` 인자
- 내용: ① 공급자·등급별 고지의 초기 버전 값·문서 경로가 정해져 있지 않다. ② 키 암호화의 AAD에 키 행 id가 들어가는데(2.11.2), `save_provider_key` 인자에 id가 없어 새 키를 저장하기 전에 서버가 id를 알 수 없다.
- 임시 조치 `[가정]`: ① 6행(3 공급자 × 2 등급) `v2026-10-29`, `document_path = '/policies/ai/{provider}/{tier}/{version}'`. 실제 고지 문구는 법무 확인(D-39) 후 확정. ② `save_provider_key`에 `p_key_id` 인자를 추가한다(서버가 생성, 교체 시 기존 id 유지).

## 2026-10-29 · S3b · DM 2.11.1 / 2.11.2 "운영자 SQL 역할도 암호 컬럼 select 없음" ↔ Postgres 기본 역할
- 내용: 컬럼 grant로 `anon`·`authenticated`·`app_ai_writer`·`app_key_reader`·`service_role`의 암호 컬럼 권한은 0으로 만들었다. 그러나 Supabase 플랫폼 역할 `supabase_read_only_user`, `supabase_etl_admin`은 Postgres 기본 역할 `pg_read_all_data`(·`pg_write_all_data`)의 구성원이라 컬럼 grant와 무관하게 모든 테이블을 읽는다. 테이블 소유자(`postgres`)와 슈퍼유저도 마찬가지다. 컬럼 단위로 막을 방법이 없다.
- 임시 조치 `[가정]`: DM 2.11.2의 설계(KEK가 DB 밖 KMS에만 있어 DB 역할을 다 가져도 암호문뿐)를 이 역할들에 대한 보호 근거로 본다. pgTAP(`grants.test.sql`)이 앱·API 역할의 암호 컬럼 권한 0과, 우회 가능한 플랫폼 역할 목록(위 2개)을 고정해 새 구성원이 생기면 실패하게 했다. 기획에서 DM 2.11.1 문구("운영자 SQL 역할 모두 select 권한 없음")를 "운영자 역할도 KEK 없이는 암호문만 볼 수 있음"으로 고칠지 정한다. 출시 전 KMS 전환(B-2)이 이 전제의 조건이다.

## 2026-10-29 · S3b · DM 2.11.3 `save_provider_key` / `record_provider_key_check` 인자 세부
- 내용: ① `limited` 저장 시 `last_failure_cause`를 기록하라고 하지만 인자 목록에 원인이 없다. ② `record_provider_key_check(provider, result_status, failure_cause)`의 `result_status` 값 목록이 없다. ③ 성공 시 `last_failure_*`를 비울지 정해져 있지 않다. ④ "첫 키면 활성 공급자 설정"의 "첫 키" 기준이 없다(모든 키를 지운 뒤 다시 등록한 경우).
- 임시 조치 `[가정]`: ① `p_failure_cause`(limited일 때 `rate_limited`/`daily_quota_exhausted`/`provider_unavailable` 필수, valid면 null)와 `p_encryption_version`(기본 1)을 추가. ② `result_status ∈ (valid, failed)`, failed면 원인 6값 중 하나(`input_rejected` 제외). ③ `record_provider_key_check` 성공은 표 그대로 `status`·`last_verified_at`만 바꾸고 실패 기록은 이력으로 남긴다. `save_provider_key`(새 키 저장)는 새 키이므로 valid면 실패 필드를 비운다. ④ "활성 공급자가 null일 때 저장되는 키"를 첫 키로 본다.

## 2026-10-29 · S3b · DM 2.11.3 "needs_check 키는 다음 성공 실행 시 valid" — 실행 주체
- 내용: 성공 실행으로 `needs_check → valid`를 되돌리는 RPC가 표에 없다. `record_provider_key_check`는 사용자 세션 RPC라 작업 실행기(`app_ai_writer`)가 부를 수 없다.
- 임시 조치 `[가정]`: `record_provider_key_success(p_ai_job_id)`(app_ai_writer 전용, security definer)를 추가했다. 작업이 본인 것이고 `running`/`succeeded`이며 키가 `needs_check`일 때만 `valid` + `last_verified_at = now()`. 암호 컬럼을 읽지 않는다. DM 2.11.3 표와 §5 app_ai_writer 실행 목록에 넣을지 기획에서 정한다.

## 2026-10-29 · S3b · DM 2.11.2 `get_provider_key_secret` 반환 — 키 없음과 거부의 구분
- 내용: "그 외는 거부"라고만 하고, 실행 중 키 삭제(→ `key_missing`, 2.11.2 4)와 작업 조건 불충족을 앱이 어떻게 구분하는지 없다. 반환 컬럼에 AAD용 키 id도 없다.
- 임시 조치 `[가정]`: 작업 조건(본인·running·heartbeat 2분 이내) 불충족 → 오류 `P0001 key_not_available`. 작업은 정상인데 그 공급자 키 행이 없으면 0행 → 앱이 `key_missing`. 반환에 `key_id`를 더했다.

## 2026-10-29 · S3b · DM §6 v4 readiness — `form`으로 바꿀 때 `suggested_*` 처리
- 내용: 활성 공급자가 없거나 키가 invalid면 `next_action = form`이라고만 한다. 같은 조건에서 `suggested_mode`·`suggested_project_id`를 남길지 정해져 있지 않다.
- 임시 조치 `[가정]`: `form`일 때는 S2 규칙("`suggested_*`는 `writing_chat`일 때만")에 맞춰 넣지 않는다. `needs_check`는 실행 허용(UX C-19)이므로 S2 판정 그대로.

## 2026-10-29 · S3b · DM 2.11.1 화면 조회 컬럼에 `user_id` 없음
- 내용: 화면 조회 컬럼 목록에 `user_id`가 없어 authenticated는 `user_id`를 select할 수 없다(`select('*')`도 42501). security invoker인 `delete_provider_key`는 `user_id`로 거를 수 없다.
- 조치(구현 결정): 목록대로 두고, `delete_provider_key`는 `provider`로만 거르고 본인 범위는 RLS(`ai_provider_keys_delete_own`)에 맡긴다. 화면·서버는 뷰 `ai_provider_keys_public`을 쓴다. 운영자(`service_role`)에는 `user_id`를 포함한 메타 컬럼 select만 줬다.

## 2026-10-29 · S3b · DM 2.11.5 실행 시점 재동의 판정
- 내용: 키 등록·등급 변경 때는 "최신 활성 동의의 고지 버전 = 현재 버전"을, AI 실행 때는 "`requires_reconsent = true`인 새 버전이면 재동의"를 말한다. 두 규칙이 다르다(`requires_reconsent = false`인 새 버전이 나오면 등록은 막히고 실행은 허용).
- 임시 조치: DB(`save_provider_key`)는 등록 규칙(정확히 현재 버전)을 강제한다. 실행 시점 판정은 api가 사용자 세션으로 한다(노트 S3b/02_db-engineer_notes.md "실행 시점 동의 확인"). `ai_disclosures` 첫 버전의 `effective_at`은 배포 즉시 유효하도록 2026-10-28 00:00 KST로 넣었다(버전 이름은 `v2026-10-29`).

## 2026-10-29 · S3b (api) · S-40 "등급 변경"의 서버 경로
- 내용: S-40 카드 메뉴에 "등급 변경 → C-21 재동의"가 있지만 DM 2.11.3에 등급만 바꾸는 RPC가 없다. `save_provider_key`는 암호문을 새로 받아야 한다.
- 임시 조치 `[가정]`: `recheckProviderKey({ provider, connectionTier, disclosureVersion })`로 처리한다. 새 등급 동의(현재 고지 버전) 확인 → 저장된 키를 실행 시점 경로로 복호화해 검증 → `valid`/`limited`면 같은 행 id로 다시 암호화해 `save_provider_key`(이전 등급 동의 철회는 RPC가 함). 검증 실패면 등급은 그대로 두고 `record_provider_key_check`로 상태만 갱신한다. 사용자는 키를 다시 붙여넣지 않는다.

## 2026-10-29 · S3b (api) · 키 검증의 사용 기록과 작업 상태 (C-10.5, NFR-KEY-04)
- 내용: C-10.5는 "확인 호출 토큰을 미터에 기록"이라고만 한다. 1단계(모델 조회)는 토큰이 없다. 검증 작업(`key_verification`)의 종료 상태도 정해져 있지 않다.
- 임시 조치 `[가정]`: 2단계 생성 호출만 `ai_usage_records` 1행(`feature = key_verification`, 실패 호출 포함)으로 남기고 1단계는 기록하지 않는다. 작업 상태: 등록·교체·등급 변경에서 저장했으면(`valid`/`limited`) `succeeded`, 저장 안 함이면 `failed` + 원인 코드. "다시 확인"은 `valid`만 `succeeded`, 그 밖은 `failed` + 원인. 검증 상한 시간은 목표(유료 5초·무료 10초)와 별도로 15초·20초에서 끊는다. 상한 초과(어댑터 `timeout`)는 공급자 장애(원인 6)로 보고 `provider_unavailable`로 바꾼다: 1단계면 저장하지 않고 "잠시 후 다시", 2단계(인증 통과)면 R-38의 장애와 같게 `limited`(`needs_check`)로 저장한다(QA-S3b-02).

## 2026-10-29 · S3b (api) · 작업 최종 실패 시 키 상태 갱신 범위 (DM 2.11.3)
- 내용: `mark_provider_key_invalid`는 `billing_required`·`daily_quota_exhausted` 등은 `last_failure_*`만 갱신한다고 되어 있지만, 실행기가 어떤 원인일 때 부를지 정해져 있지 않다.
- 임시 조치 `[가정]`: 작업이 키 원인 6값(`rate_limited`, `daily_quota_exhausted`, `billing_required`, `key_invalid`, `model_not_available`, `provider_unavailable`) 중 하나로 **최종 실패**할 때만 부른다(자동 재시도 중간에는 부르지 않음). 성공한 작업은 `record_provider_key_success`(db 제안 채택)로 `needs_check → valid`.

## 2026-10-29 · S3b · DM 2.11.3 키 RPC 실행 주체 (QA-S3b-06, 설계)
- 내용: `save_provider_key`·`record_provider_key_check`는 "서버 액션(사용자 세션)"이 부르는 RPC라서 authenticated에 실행 권한이 있다. 그래서 브라우저가 사용자 JWT로 직접 부를 수도 있다(검증을 거치지 않은 암호문 저장, 상태 임의 변경).
- 영향: 본인 행만 바뀐다. 남의 키나 원문 노출은 없다. 직접 부르면 자기 키가 쓸 수 없는 상태가 될 뿐이다.
- 임시 조치: 그대로 둔다. 막으려면 이 두 RPC를 서버 전용 역할로 옮기고 서버가 사용자 id를 넘겨야 한다. DM 2.11.3의 실행 주체를 바꾸는 일이라 기획 판단이 필요하다.

## 2026-10-29 · S3b QA (api) · 수동 재시도·실행 중 동의 철회 게이트 (QA-S3b-01)
- 내용: F-AI-04 (5)·DM 2.11.5는 재동의가 필요하면 "다음 AI 실행 전"에 막으라고 하지만, 수동 재시도와 이미 큐에 있는 작업을 어떻게 다룰지 정해져 있지 않다. 실행기(app_ai_writer)는 동의·키 메타를 읽을 권한이 없다.
- 임시 조치 `[가정]`:
  - 수동 재시도는 **작업에 고정된 공급자**로 다시 돈다(F-AI-03 (2)). 단, 그 공급자의 키가 없으면 409 `key_missing`, 무효면 409 `key_invalid`, 키의 **현재 등급** 동의가 실행 규칙을 못 맞추면 409 `ai_consent_required`로 거부한다. 등급은 키 기준이다(실제 데이터가 그 등급 정책으로 나간다).
  - 사용자가 동의를 철회하면 그 공급자·등급의 queued/running 작업에 취소를 요청한다(queued는 시작 전, running은 다음 heartbeat에서 중단).
  - 실행기는 단계마다 db RPC `check_ai_run_allowed(p_ai_job_id)`(app_ai_writer)로 확인하고, 확인 오류면 닫힌 실패(`stalled`)다. 이미 큐에 있던 작업도 `requires_reconsent` 고지 시행·동의 철회 뒤 다음 단계에서 멈춘다(공급자 호출·사용 기록 0).
  - **해소 (decisions.md 2026-10-29)**: 게이트가 `consent_required`면 작업은 `error_code = key_missing`(user_account, failure_cause null → 화면 "AI 연결하기" 잠금)으로 끝난다. `key_invalid` → `key_invalid`, `key_missing` → `key_missing`.

## 2026-10-30 · S4 · AI-12 정리 대기 발화 / 시작 인사 / 스트리밍 재시도
- 내용: ① AI-12는 "정리 호출 실패 시 직전 미처리 발화 ID 목록을 서버가 관리"한다고 하지만 저장 위치가 없다. ② 고정 시작 인사(AI 메시지)가 메시지 상한 40에 포함되는지 명시가 없다. ③ C-11.3은 재시도 대기를 `next_run_at`으로 예약하라고 하는데, SSE 스트리밍 턴은 응답을 연 채로 예약할 수 없다.
- 임시 조치 `[가정]`: ① `writing_chats.last_extracted_sequence`를 두고, 그 뒤의 사용자 발화를 다음 정리에 포함한다. ② 시작 인사도 40에 포함한다(AI 메시지 합계 규칙). ③ 스트리밍 턴은 첫 토큰 전의 즉시 재시도(`schema_invalid` / `timeout`)만 하고, 대기가 필요한 원인(분당 한도·장애)은 바로 실패로 끝낸다. `retry_after`를 안내하고 사용자가 "다시 보내기"를 누른다.
- S5 확장 지점: 게이트 진입 대화의 지원 프로젝트 요건 목록(R-31)은 `jd_requirements`가 생기는 S5에서 넣는다.

## 2026-10-30 · S4 (api) · AI-12 턴 경로 세부 (DM §7 대화 턴, AI-12, C-12, UX S-36)
- 내용: ① 무료 등급 호출 간격(C-12, 약 6초)은 `next_run_at` 예약을 전제로 하는데, 스트리밍 턴은 예약할 수 없다. ② 무료 등급에서 응답이 실패했을 때 정리를 부를지 정해져 있지 않다. ③ "다시 보내기는 응답만 다시 생성"이라고 하지만, 직전 정리도 실패해 미처리 발화가 남은 경우가 정해져 있지 않다. ④ 메시지 상한: 사용자 메시지는 `message_count ≤ 38`일 때만 받으므로(응답 자리 확보, db 구현) 실제 최대는 39이고 화면의 "n / 40"은 39에서 입력이 막힌다. ⑤ 키 없음·동의 필요로 막힌 메시지 전송의 응답 형태가 없다.
- 임시 조치 `[가정]`: ① 무료 등급 턴은 요청 안에서 최대 6초를 기다린다(응답 전: 같은 공급자의 마지막 호출이 6초 안이면 남은 시간만, 정리 전: 6초). 재시도 대기와 달리 상한이 6초로 고정돼 60초 예산 안에 든다. ② 무료 등급에서 응답이 실패하면 정리를 부르지 않는다(실패한 키에 호출을 더하지 않음). 발화는 미처리로 남아 다음 턴·다시 보내기에서 정리된다. 유료 등급은 이미 병렬로 시작한 정리를 끝까지 반영한다(이벤트 `draft_patch` → `draft_flags` → `error`). ③ 다시 보내기는 응답을 다시 만들고, 미처리 발화가 있을 때만 정리도 한다(성공한 정리는 다시 부르지 않음, QA-S3a-08). ④ `limitReached` = `message_count ≥ 39`. 상한 직전 턴의 응답은 `begin_assistant_message.is_final`로 마지막 안내를 한다. ⑤ 연결 게이트에 막히면 SSE `error` 이벤트 1개(`key_missing`: 연결 없음·동의 필요, `key_invalid`: 키 무효)로 답한다. 사용자 메시지는 저장하지 않는다(입력창 내용 유지).

## 2026-10-30 · S4 (db) · AI 작성 대화 쓰기 경로·상한·상태 규칙
- ① **쓰기 경로 (DM §5 대비 더 좁힘)**: DM §5는 `append_writing_chat_message`를 security invoker로, `app_ai_writer`에게 `writing_chats.message_count`·`last_activity_at` 직접 update와 assistant 메시지 insert/update를 준다. invoker로 만들면 사용자에게 메시지 직접 insert·`message_count` update 권한을 줘야 해서 상한(40)을 우회할 수 있다. 임시 조치 `[구현 결정]`: 대화 시작·사용자 메시지·assistant 메시지·정리 완료 표시는 모두 **소유 검사를 하는 security definer RPC**로만 쓰고, 두 테이블에 대한 직접 insert/update 권한은 사용자(`status`, `return_target` 제외)와 `app_ai_writer` 모두에게 주지 않는다. `save_writing_chat`·`hand_off_writing_chat`은 DM대로 invoker(커리어 쓰기는 사용자 RLS), 마지막 상태 변경만 private definer 헬퍼. `service_role`은 select·delete만(90일 정리용).
- ② **메시지 상한 `[가정]`**: 사용자 메시지는 `message_count <= 38`일 때만 받는다(그 답 AI 메시지 자리 확보). 그래서 실제 최대는 보통 39개다. "40번째가 사용자 메시지이고 답이 없는" 경우를 막기 위함. 상한 안내용으로 `begin_assistant_message`가 `is_final`을 돌려준다.
- ③ **죽은 스트리밍 턴 `[구현 결정]`**: assistant 행이 `streaming`인데 2분 넘게 갱신이 없거나 그 턴 작업이 이미 끝났으면 죽은 턴으로 본다. 다시 보내기에서 재사용하고, 새 턴이 시작되면 남은 `streaming` 행을 `failed`로 닫는다(함수 강제 종료로 영원히 "응답 중"이 되는 것 방지). 살아 있는 턴이 있는 동안에는 새 사용자 메시지도 `turn_in_progress`로 거부한다(QA-S4-04).
- ④ **대화 상태 `[가정]`**: `saved`·`handed_off`·`abandoned`는 되돌릴 수 없다. 사용자 직접 상태 변경은 `active → abandoned`(그만두기)만. 그만둔 대화를 다시 이어 하는 흐름은 기획에 없어 막았다(필요하면 `abandoned → active` 허용으로 바꾸기 쉬움).
- ⑤ **패치 형식 `[구현 결정]`**: DM 2.5는 패치 jsonb 모양을 정하지 않았다. `_workspace/backend/S4/02_db-engineer_notes.md` "패치 계약"으로 정했다. `structured_draft`에 DM에 없는 키 2개를 더했다: 성과 `achievement_key`(사용자 수정·수락 대상 지정용), clarifications `existing_detail_id`(DM 예시는 `detail_key`만). 사용자가 값을 비우면(`value: null`) 필드 객체를 지운다(DM은 비우기를 정의하지 않음. 거절과 달리 `reviewed_at`도 남기지 않음).
- ⑥ **AI 패치 거부 방식 `[구현 결정]`**: AI 패치는 규칙 위반 op만 건너뛰고 나머지를 반영한다(`rejected[]`로 보고). 사용자 패치는 첫 위반에서 전체 거부. AI-12 "패치 거부"를 필드 단위로 읽었다.
- ⑦ **소속 제안 반복**: 사용자가 [아니요]로 제안을 지워도 다음 턴 AI가 같은 제안을 다시 낼 수 있다. DB는 막지 않는다(파이프라인이 확정 소속·거절 이력을 보고 다시 내지 않아야 함). 보강 모드에서는 제안을 거부한다(`affiliation_not_editable`, UX S-36 "보강 모드에서는 소속 칸을 읽기 전용").
- ⑧ **값 길이 `[구현 결정]`**: `projects.name`·`role`, `achievements.metric_name`·`unit`은 컬럼에 길이 제한이 없어 패치에서 각각 100·100·200·50자로 막았다. 스킬 50자는 `skills` CHECK와 같다.
- ⑨ **시작 인사 문구 `[가정]`**: 고정 문구를 SQL 상수로 두었다(모드별 2종 + 활성 키가 무료 등급이면 "입력 내용이 공급자의 서비스 개선에 쓰일 수 있어요" 안내 추가). 공급자별 고지 문구와 맞는지는 기획 확인 필요.
- ⑩ **게이트 진입 `return_target`**: `application_project_id`는 S5 전이라 uuid 모양만 검사한다(soft reference). `created_at`은 서버가 넣는다.

## 2026-10-30 · S4 · AI-12 V-9 구현 해석 (ai-pipeline-engineer)
- 내용: ① V-9f의 "situation 후보로만 둔다"가 구체적이지 않다. ② "알아서 채워 줘" 발화에서 패치를 만들지 않는 규칙이 프롬프트에만 있다. ③ 사용자가 [아니요]로 거절한 소속 제안을 다시 내지 않으려면 거절 기록이 필요하지만 저장 위치가 없다(`set_writing_chat_affiliation(p_dismiss_only)`는 제안만 지움). ④ V-9d "회사·제품명 후보"와 V-9g "제3자 실명"을 판정하는 기준이 없다.
- 임시 조치 `[가정]`: ① situation이 비어 있으면 같은 값을 `needs_review`로 넣고(수락해야 저장), 차 있으면 버리고 `actor_ambiguous`만 남긴다. ② 출처가 모두 위임 요청 발화면 서버에서도 거부한다(`V-9a.delegation`). ③ 제안은 이번 정리 대상 발화를 출처로 포함할 때만 내고, runner가 거절 id를 넘기면(`declinedAffiliationIds`) 항상 막는다. 확실히 막으려면 `writing_chats`에 거절 목록 컬럼이 필요하다(기획 결정 필요). ④ 접미사 목록과 "성 + 2음절 + 직함" 패턴을 상수로 두었다(`v9-lexicon.ts`). 재현율을 우선했고, 오탐이면 필드만 빈다.

## 2026-10-30 · S4 QA (backend-qa) · UI 패턴 문서의 AI-12 스트림 모양
- 내용: `.claude/skills/ui-implementation/references/patterns.md`는 AI-12 작성 대화를 C-04 블록 이벤트(`block_started`…`done`)와 `useAiStream → { blocks, status, error, cancel }`로 적고, "월간 대화 한도" 소진 처리도 남아 있다. 기획(AI-12 응답 모드, DM §7 대화 턴)과 S4 구현은 대화 이벤트(`turn_started` → `reply_delta` → `reply_done` → `draft_patch` → `draft_flags` → `turn_done` | `error`)이고 월 한도는 v4에서 폐기됐다(D-34).
- 임시 조치: 백엔드는 기획대로 둔다. S-36 연결 단계에서 UI 훅은 `blocks` 대신 대화 메시지·정리 결과 상태를 돌려주는 별도 훅이 필요하다. UI 하네스 문서 갱신 필요(리더 → resumate-ui).
