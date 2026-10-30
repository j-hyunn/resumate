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

## 2026-10-31 · S5 (api) · 지원 프로젝트·JD 동기 추출
- ① **동기 추출의 대기 재시도 `[가정]`**: AI 명세 C-6 동기 모드는 재시도 대기를 정하지 않았다. 동기 요청 안에서는 `next_run_at` 예약을 못 하므로, C-11.3 정책이 대기를 요구하면 5초 이하일 때만 요청 안에서 기다린 뒤 다시 부르고, 더 길면 최종 실패로 끝낸다(`retry_after` = C-11.3 최종 값, rate_limited 최소 1분·provider_unavailable +1분). 즉시 재시도(timeout 1회)는 그대로. 전체 30초 상한.
- ② **실패 응답 모양 `[구현 결정]`**: 동기 추출 라우트는 C-11 실패(연결 게이트 포함)를 HTTP 200 `{ data: { status: 'failed', jobId, error, jd } }`로 돌려준다(`error` = SSE `error` 이벤트와 같은 필드). 이미 추출됨·진행 중은 409 JSON 오류(`already_extracted`, `extraction_in_progress`). 화면은 C-20을 `error.category`/`failureCause`로 고른다.
- ③ **클라이언트 끊김 `[구현 결정]`**: 추출 중 브라우저가 요청을 끊어도 호출은 끝까지 진행해 결과를 저장한다(사용자 키 토큰은 이미 쓰였고 결과가 다음 화면에서 쓰임). 중단은 `cancel_requested_at`(프로젝트 삭제 등)과 30초 상한만.
- ④ **삭제 중 실행 `[구현 결정]`**: 프로젝트 삭제로 작업 행이 사라지면 heartbeat·반영·종료 쓰기가 0행이 되고, 이를 `canceled`로 다룬다. 그 뒤에 남기는 사용 기록은 FK 위반(23503) 시 `application_project_id = null`로 다시 넣는다(DM 4.1 "사용 기록 유지"와 같은 결과).
- ⑤ **범용 재시도 제외**: `POST /api/ai-jobs/{id}/retry`는 `jd_extraction` 작업을 409 `ai_job_not_retryable`로 거부한다. 추출 재시도는 같은 추출 라우트를 다시 부르는 것(새 작업)이다.

## 2026-10-31 · S5 (db) · 지원 프로젝트·JD 스키마 세부
- ① **AI 쓰기 경로 (DM §5·계획 대비 더 좁힘) `[구현 결정]`**: 계획은 `app_ai_writer`에 `application_projects.name/name_source/last_activity_at`, `job_descriptions.extraction_status` 직접 update를 준다. S4와 같이 직접 권한은 주지 않고, `begin/apply/fail_jd_extraction`(security definer + 소유 검사)만 쓴다. `app_ai_writer`는 `application_projects`를 컬럼 단위로 읽고 `memo`는 읽지 못한다(메모는 AI 입력이 아님 `[가정]`).
- ② **추출 실패 시 이름 `[가정 1 해석]`**: "추출 실패 때도 같은 이름"을 DB가 채운다. `fail_jd_extraction`이 null 이름을 키 없는 생성과 같은 규칙(회사명·포지션명 둘 다 있으면 "회사명 – 포지션명"(`user`), 아니면 "새 기업 JD (YYYY-MM-DD)"(`default`, 프로젝트 생성일 KST))으로 채운다. 기본 이름은 이후 추출 성공 때 AI 이름으로 바뀐다.
- ③ **길이 상한 `[가정]`**: 기획에 없는 `company_name`·`position_title` ≤ 200자, `jd_requirements.content` ≤ 500자, 요건 키워드 1~100자, 요건 ≤ 200개, `detected_language` 1~16자, 해시 ≤ 128자. 합성 이름은 앞 100자.
- ④ **추출 결과 `ai_run_allowed`**: `create_application_project` 반환에 `ai_run_allowed`(= `check_ai_run_allowed`와 같은 기준: 활성 공급자, 키 `invalid` 아님, 실행 동의)를 더했다. `needs_check` 키도 허용된다(S3b와 같음). 서버 액션 `shouldExtract`가 이 값을 쓰면 DB 이름 규칙과 어긋나지 않는다.
- ⑤ **같은 단계 이동 + 결과**: `move_application_stage(closed → closed, outcome)`은 DM 1단계대로 아무것도 하지 않는다(결과는 `set_application_outcome`). `interview_prompt`는 실제로 이동했을 때만 준다.
- ⑥ **`extraction_in_progress`**: `ai_jobs_in_flight_target_key`가 같은 JD의 살아 있는 작업을 1개로 묶으므로, 실제로는 이전 작업이 끝난 뒤에만 새 작업이 생긴다. 이 오류는 방어용이다.
- ⑦ **S6로 넘김**: `evidence_links` 삽입 가드의 `jd_requirement`/`jd_sentence` 출처 검사와, 요건 삭제 시 근거 인용문 삭제 트리거는 근거를 처음 쓰는 S6에서 넣는다(지금은 요건이 재추출로만 지워지고, 재추출은 실패 뒤에만 일어나 지울 요건이 없다).

## 2026-10-31 · S5 (ai) · AI-01 JD 요건 추출·R-31 게이트 요건 (ai-pipeline-engineer)
- ① **prompt_version 표기 `[구현 결정]`**: S5 계획은 `AI-01@1`이지만 C-4 예시(`ai-02.match.v1`)와 S4 규칙(`ai-12.reply.v1+common.v1`)에 맞춰 `ai-01.extract.v1+common.v1`로 했다. 공통 블록 버전이 접미사로 붙어 공통 문구가 바뀌면 모든 기능의 버전이 함께 바뀐다.
- ② **`requirements_hash`에 `importance` 포함 `[구현 결정]`**: 계획은 `category·content·source_sids`. 중요도는 이후 기능 프롬프트에 "중요"로 렌더링되어 출력에 영향을 주므로 넣었다. 행 id는 넣지 않는다(추출 시점에 없음). 규칙은 `computeRequirementsHash` 한 곳이고 `buildJdContext`도 같은 값을 쓴다(이전에는 행 id가 섞여 추출 시 값과 달라질 수 있었음).
- ③ **AI-01 출력 길이 상한 `[가정]`**: 요건 text ≤ 300자, keywords ≤ 10개(각 ≤ 60자), 요건 ≤ 100개, tech_keywords ≤ 60개, other_sids ≤ 1,000개, warnings ≤ 5개(각 ≤ 200자), 회사명·포지션명 ≤ 200자. 넘으면 V-6 불일치 → 1회 재시도 → `schema_invalid`. DB 상한(content ≤ 500, 요건 ≤ 200)보다 엄격하다.
- ④ **문장 0개 → `not_a_jd` `[가정 S5-4 확장]`**: 분할기는 유니코드 문자·숫자가 있는 구간만 문장으로 본다(QA-S5-01 수정 후 키릴·아랍·태국 문자 포함). 기호만 있는 원문은 문장 0개로 저장되고, AI-01은 모델을 호출하지 않고 `not_a_jd`로 끝낸다(사용 기록 없음). 요건 0개 + `is_likely_jd = false`도 `not_a_jd`(재시도 없음), 요건 0개 + `is_likely_jd = true`는 1회 재시도 후 `schema_invalid`.
- ⑤ **`seniority` 수치 가드 없음**: 카드에 규칙이 없어 `min_years`/`max_years`가 인용 문장에 숫자로 있는지는 검사하지 않는다(sid 실재·`min ≤ max`만). 영문 "five years" 같은 표기 때문에 단순 숫자 대조는 보류. 필요하면 기획에서 규칙을 정해 주면 추가한다.
- ⑥ **AI-12 프롬프트 버전 `[구현 결정]`**: 응답 `ai-12.reply.v1` → `v2`(R-31 `<gate_requirements>` 블록·주제 전용 지시). QA-S5-04로 공통 규칙(SHARED_RULES)의 데이터 블록 목록에 `<gate_requirements>`를 넣어 정리 문구도 바뀌었으므로 정리 `ai-12.extract.v1` → `v2`도 올렸다(정리 호출은 요건 블록을 여전히 받지 않음). 둘 다 아직 출시 전이라 같은 슬라이스 안에서 v2로 묶었다.
- ⑦ **R-31 "근거가 약해 보이는 요건" `[가정 S5-7]`**: 요건 키워드가 스킬 이름과 정확히 같지 않고 프로젝트·상세 텍스트에도 포함되지 않으면(NFKC·소문자·공백/구두점 제거 후 비교, 2글자 미만 키워드는 스킬 정확 일치만) 약함. 키워드 0개 요건도 약함.
- ⑧ **QA 1차 (2026-10-31)**: 문장 0개 JD도 저장한다(`sentences = []` 허용, QA-S5-01). `jd_extraction` 작업이 성공하지 못하고 끝나면(sweep의 stalled 포함) DB 트리거가 그 작업으로 `running` 중인 JD를 `failed`로 바꾸고 대체 이름을 넣는다(QA-S5-02, C-6 stalled 경로 `[구현 결정]`). AI 회사명·포지션명은 sid가 JD에 있을 때만 쓰고, 없으면 값을 버린다(QA-S5-05).

## 2026-11-01 · S6 (ai) · AI-02 인사이트 2단계 체인 (ai-pipeline-engineer)
- ① **두 단계가 같은 system 블록 `[구현 결정]`** (AI 명세 C-4 ↔ C-8·AI-02 비용): C-8 프리픽스 순서는 [공통 system] → [기능 system] → [경력 팩]이라, 단계별로 system이 다르면 단계 2가 단계 1의 경력 팩 캐시를 읽지 못한다(카드 비용 "경력 팩 6k 캐시 읽기"가 성립하지 않음). 두 단계 규칙을 하나의 AI-02 system 블록에 넣고, 마지막 user `<task>`가 단계를 알린다. `prompt_version`은 계획대로 `ai-02.match.v1+common.v1` / `ai-02.synthesize.v1+common.v1`(호출별), 저장값은 `ai-02.match.v1+ai-02.synthesize.v1+common.v1`.
- ② **빠진 요건 `[가정 S6-2]`**: 모델이 배치 안 요건을 판정하지 않으면 `no_evidence` + 근거 없음, 이유 "입력된 데이터에서 이 요건을 뒷받침하는 근거를 찾지 못했습니다."로 채운다(`model_status = null`). 배치에 없는 `requirement_ref`·같은 요건의 두 번째 판정은 버린다.
- ③ **V-4로 `no_evidence`가 된 판정의 이유 `[구현 결정]`**: 모델의 이유는 (검증에서 떨어진) 근거를 전제로 쓰였으므로 위 고정 문구로 바꾼다. `met` → `partial` 강등은 이유를 두고, 부족한 측면이 비었으면 "본인이 한 행동·결과 또는 성과로 확인되는 서술"을 넣는다. `no_evidence` 판정이 근거를 달았으면 근거를 버린다(올리지 않음).
- ④ **단계 1 이유 문장의 수치 가드 `[구현 결정]`**: 계획은 V-5를 단계 2 텍스트에만 적용한다. 단계 1 `rationale`·`missing_aspect`도 화면에 보이는 생성 텍스트라 V-5 치환(재생성 없이 바로 `[수치 확인 필요]`)을 적용했다. 단계 2는 계획대로 1회 재생성 후 치환이며, 대상은 강점 제목·설명, 보완점 설명, 대응 방안, 포지셔닝, 우선순위 이유 전부다.
- ⑤ **저장 키 이름 `[구현 결정]`** (C-3 "별칭 참조도 UUID로"): `result`에서 `requirement_ref` → `requirement_id`, `requirement_refs` → `requirement_ids`, `project_priorities[].ref` → `project_id`로 이름을 바꿨다(C-3 예시 `target_requirement_refs` → `target_requirement_ids`와 같은 방식). `strategy.positioning`은 문자열 그대로이고 item_key는 `strategy.positioning_item_key`에 둔다. 각 항목에 `item_key` 필드가 있다.
- ⑥ **강점·보완점의 요건 참조 정리 `[구현 결정]`**: 강점은 `met`/`partial` 요건만 남기고(계획의 "no_evidence만 가리키면 제거" + 섞여 있으면 no_evidence 참조만 제거), 남는 게 없으면 강점 제거. 보완점은 `partial`/`no_evidence` 요건만 남기고, 없으면 제거하며 `gap_kind`는 서버가 다시 정한다(하나라도 no_evidence면 no_evidence). 대응 방안이 모두 빠진 보완점도 남긴다. 우선순위의 `requirement_ids`도 met/partial만 남긴다. 우선순위는 PRJ 별칭이 실재해야 하고 같은 프로젝트는 1번만, 모델 순위 순으로 1..n 재부여.
- ⑦ **`data_sufficiency.hints` `[가정]`**: 카드는 `hints: []`만 보인다. 서버 고정 한국어 문장 2개(프로젝트 2개 이하, 수치 성과 없음)를 넣는다. `thin` 규칙은 계획 `[가정 4]` 그대로(팩에 들어간 complete 프로젝트 ≤ 2 또는 `kind = quantitative` 성과 0개).
- ⑧ **단계 1 결과 형태 `[구현 결정]`**: 작업 단계 출력에 저장하는 단계 1 결과는 별칭이 아니라 UUID(`source_id`, JD 문장은 `sid`도)로 둔다. 단계 사이에 커리어가 바뀌면 단계 2·finalize가 현재 팩으로 근거를 다시 풀고, 사라진 근거를 버린 뒤 V-4·met 규칙을 다시 적용한다(`evidence_lost_on_restore`). 단계 2 결과는 별칭 형태라 finalize를 같은 실행에서 불러야 한다(다른 context면 오류).
- ⑨ **`match_stage_result` `[구현 결정]`**: "단계 1 원본"이지만 C-3(결과 jsonb에 근거 없음)에 맞춰 근거를 뺀 병합본(`requirement_id`, `status`, `model_status`, `rationale`, `missing_aspect`) + `prompt_version`·`batches`로 저장한다.

## 2026-11-01 · S6 (db) · 인사이트 스키마·RPC 세부
- ① **`insights.ai_job_id` 복합 FK `[구현 결정]`**: DM은 AI 메타의 `ai_job_id`를 soft로 둔다. S5 `extraction_job_id`처럼 `(ai_job_id, user_id)` → `ai_jobs` `on delete set null (ai_job_id)`로 걸어 다른 사용자 작업 지정을 막고, 90일 작업 정리 때 null이 되게 했다.
- ② **작업 종료 트리거 범위 `[구현 결정]`**: `insight` 작업이 `failed`(sweep `stalled` 포함)·`canceled`뿐 아니라 `succeeded`로 끝나도 그 작업의 `generating` 행을 `failed`로 바꾼다. `complete_insight` 없이 작업이 성공 처리되면 행이 영영 생성 중으로 남기 때문이다. 정상 경로는 `complete_insight` → `complete_ai_job` 순서다.
- ③ **QA-S5-06 수정의 남는 한계 `[가정]`**: 작업 종료 트리거는 프로젝트 행을 `skip locked`로만 잡는다(교착 방지, 두 세션 재현으로 확인). 짧은 다른 쓰기와 겹쳐 건너뛰면 JD `running`·인사이트 `generating`이 남을 수 있다. 화면(S-13·S-16·S-39 진행 표시)은 "생성 중인데 그 작업이 이미 끝났거나 없음"을 실패로 보여야 한다(api 조회 규칙). 다음 실행의 `begin_*`가 행을 정리한다.
- ④ **커리어 삭제의 인사이트 처리 `[가정 3]`·`[가정]`**: `delete_results`로 latest 인사이트가 지워지면 남은 `ready` 중 `version_no`가 가장 큰 행을 latest로 올린다(failed 제외, 없으면 latest 없음). `get_deletion_impact.affected_results.by_application_project[]`는 `{application_project_id, name, insights, drafts: 0, draft_sections: 0, interview_sessions: 0}`이고 인사이트가 1개 이상인 프로젝트만 이름순으로 둔다(drafts·면접은 S7·S8에서 채움). 같은 인사이트의 근거 여러 개는 1로 센다.
- ⑤ **길이 상한 `[가정]`**: 기획에 없는 `evidence` 원소 ≤ 2,000개, `item_key` ≤ 200자, `quote` ≤ 2,000자, `source_label` ≤ 300자, `prompt_version`·`model` ≤ 200자, 해시 ≤ 128자.
- ⑥ **JD 근거 검사 `[가정]`**: `jd_requirement`·`jd_sentence`가 같은 사용자의 **다른 지원 프로젝트**를 가리키거나 `jd_sentence` 위치가 틀리면 `invalid_evidence_source`로 거부한다(파이프라인 오류). 원본 행이 없으면 커리어 출처와 같이 "원본 삭제됨"으로 저장한다. `jd_sentence.source_locator {sid, start, end}`는 그 문장의 `[start, end]` 안의 부분 구간을 허용한다(인용 하이라이트용). 오프셋 단위는 S5와 같이 JS UTF-16이며 원문과 대조하지 않는다.
- ⑦ **인사이트 쪽 제한 `[구현 결정]`**: 인사이트 근거 출처는 커리어 7종 + `jd_requirement`·`jd_sentence`만 받는다(`interview_answer`·`user_note`는 AI-02 입력에 없음). `begin_insight`는 JD 추출이 `succeeded`가 아니면 `jd_not_extracted`로 거부한다(D-30 선행은 api `prepare` 단계 책임).
- ⑧ **`ai_jobs` insight 모양 CHECK 미추가 `[구현 결정]`**: S5의 `ai_jobs_jd_extraction_check`처럼 `insight`의 `target_type = 'application_project'`를 테이블에 고정하지 않았다. 기존 테스트 다수가 대상 없는 `insight` 작업을 쓰기 때문이다. 같은 검사는 `begin_insight`가 한다(`invalid_ai_job`). 필요하면 S7 전에 테스트를 고치고 CHECK를 더한다.

## 2026-11-01 · S6 (api) · 인사이트 작업·시작 라우트·조회 (api-engineer)
- ① **선행 추출 실패 = 인사이트 작업 실패, 자동 재시도 없음 `[가정]`** (계획 API 1, D-30): `prepare`의 `ensureJdExtracted`는 동기 경로에서 이미 C-11.3 재시도(요청 안 5초 이하 대기)를 썼으므로, 실패하면 인사이트 작업도 같은 `error_code`(+ `retry_after`/`quota_resets_at`)로 바로 실패한다. 사용자가 "다시 시도"하면 `prepare`부터 다시 한다. 추출이 다른 경로로 진행 중(`extraction_in_progress`)이거나 프로젝트가 사라졌으면 공급자 호출 없이 `stalled`로 끝난다.
- ② **요건 0개 JD → `not_a_jd` `[가정]`**: 추출은 성공했지만 요건이 없으면 맞출 것이 없어 인사이트 작업을 `not_a_jd`(input, 재시도 불가)로 끝낸다. 호출·사용 기록 없음.
- ③ **선행 추출의 연결 `[구현 결정]`**: `prepare` 안의 추출은 인사이트 작업에 고정된 공급자·등급으로 실행한다(F-AI-03 (2)). cron·이어 실행 호출에는 사용자 쿠키가 없어서다. 키·동의는 추출 작업의 `check_ai_run_allowed`가 다시 확인한다. JD는 app_ai_writer로 읽는다(select 권한 있음).
- ④ **재사용 판정은 `insights` 기준 `[구현 결정]`** (C-6): 시작 라우트는 같은 `input_hash`의 `ready` 인사이트를 찾아 `{reused:true, insightId}`를 준다. 실행기의 `ai_jobs` 기준 재사용은 쓰지 않는다(`regenerate: true`로 넘김). 커리어 삭제 `delete_results`로 인사이트가 지워진 뒤 성공 작업만 남아 있으면 잘못 재사용되기 때문이다. JD가 아직 추출 전이면 해시를 만들 수 없어 재사용 판정 없이 작업을 시작한다(작업 `input_hash` null).
- ⑤ **readiness 검사가 연결 게이트보다 먼저 `[가정]`** (계획 순서 그대로): 데이터가 부족하면 키가 없어도 422 `insufficient_data` + `readiness`(= `features.insight`)를 준다. 화면은 C-10 배너를 먼저 보인다.
- ⑥ **무료 등급 순차 실행 구조 `[구현 결정]`** (C-12, registry 규칙 QA-S3a-08): 요건 수는 `prepare`(선행 추출) 뒤에야 알 수 있어 `freeTierSteps(params)`로 배치 단계를 미리 펼칠 수 없다. 대신 실행기에 두 가지를 더했다. (a) `ctx.savePartial`: 끝난 배치를 `step_outputs._meta.partials.match`에 저장 → 자동·수동 재시도가 성공한 배치를 다시 부르지 않는다(유료 병렬도 같음). (b) `STEP_CONTINUE`: 무료 등급 `match` 단계는 실행 1번에 배치 1개만 부르고 다시 실행을 요청한다 → 실행기의 호출 간격(6초), 60초 예산, 호출별 재시도 횟수가 배치마다 적용된다. 진행 표시는 `match` done/total = 배치 수 그대로다. 호출이 없는 단계(`validate`)에는 무료 등급 간격을 두지 않는다(`callsProvider: false`).
- ⑦ **유료 병렬 배치 일부 실패 `[구현 결정]`**: 모든 배치를 `allSettled`로 끝까지 기다려 성공분을 저장한 뒤, 실패 하나를 실행기에 던진다(취소 > 공급자 오류 > 그 밖 순). 재시도 정책은 그 오류 코드로 정한다. 최종 실패하면 작업 전체가 실패한다(카드 `[가정]` "부분 인사이트 저장 안 함").
- ⑧ **부분 결과 모양 `[구현 결정]`** (S-16, C-03): `GET /api/ai-jobs/{id}`의 `partial` = `{kind:'insight_matches', batchesDone, batchesTotal, requirementMatches:[{requirementId, status, rationale, missingAspect}]}`. 근거 칩은 저장 뒤에만 있다. 요건 문장은 `getInsight().requirements`에서 찾는다(상태 응답에 DB 읽기를 더하지 않음).
- ⑨ **진행 표시 우선순위 `[가정]`** (S-13·S-39·S-31): 인사이트 작업이 queued/running이면 이전 결과가 있어도 `generating`, 아니면 latest 결과가 있으면 `ready`, 없으면 `none`.
- ⑩ **실패 표시 `[가정]`** (C-20): `lastFailure`는 표시 중인 결과보다 늦게 끝난 `failed` 작업만 보인다. 사용자가 취소한 작업은 실패로 보이지 않는다. 작업이 끝났는데 `generating`으로 남은 행(QA-S5-06 skip locked)은 실패로 본다: 작업 failed → 그 실패, 작업 없음·성공(complete 없이) → `stalled`, 취소 → 표시 없음. 같은 이유로 S5 읽기도 `running` JD의 추출 작업이 끝났으면(또는 없으면) `failed`와 그 작업의 실패(없으면 `stalled`)로 보인다.
- ⑪ **근거 칩 "변경됨" 기준 `[가정]`** (C-01, DM §2.8): 원본 행 `updated_at > source_snapshot_at`. `project_detail`은 행 단위라 다른 STAR 필드 수정도 "변경됨"이 된다(DM 한계 그대로). 원본 행이 없는데 `source_deleted_at`도 없으면(삭제 트리거 없는 출처) "원본 삭제됨"으로 보인다. `profile` 근거는 `profiles.updated_at` 기준이라(QA-S3-06) 활성 공급자 변경 같은 비커리어 수정도 "변경됨"이 될 수 있다.

## 2026-11-01 · S6 (qa) · 인사이트 QA에서 나온 스펙 질문 (backend-qa)
- ① **V-4 "경력 사실 근거"에 희망 정보 포함 여부 `[가정]`** (AI 명세 C-3 V-4, AI-02 판정 기준): 현재 공용 `CAREER_SUPPORT_SOURCE_TYPES`에 `profile`이 들어 있어 `profile.desired_job_title`·`interested_industries`(희망 정보)만으로도 `partial` 판정·강점·포지셔닝이 살아남는다. 희망 정보는 경험의 사실이 아니므로 AI-02에서 근거로 셀지 정해 달라. 그동안 코드는 그대로 둔다.
- ② **저장 텍스트의 별칭 표기 `[가정]`** (AI-02 출력 예시 ↔ C-3 "별칭은 UUID로"): 카드 예시 `prepare_answer` 문장이 "PRJ-3의 재시도 큐 설계를…"로 별칭을 본문에 쓴다. 별칭 번호는 데이터가 바뀌면 달라지고 사용자에게 의미가 없다. 본문에서는 프로젝트·요건 이름을 쓰도록 명세를 고쳐 달라(QA-S6-04).
- ③ **진행 단계 `prepare` `[가정]`** (C-6 "진행 단계 값"): D-30 선행 추출과 `begin_insight`를 하는 첫 단계 `prepare`가 C-6 목록(AI-02 `match` → `synthesize` → `validate`)에 없다. 목록에 넣을지, `match` 0/N으로 보일지 정해 달라(QA-S6-07).
- ④ **`input_hash` 재사용 대상 `[가정]`** (C-6): 같은 해시의 예전 ready 버전(latest 아님)을 재사용할 때 latest를 그 버전으로 바꿀지, latest만 재사용 대상으로 볼지 명세가 없다(QA-S6-06).
- ⑤ **인사이트 작업 중 요건 편집 `[가정]`** (F-P2-03 ↔ AI-02): 작업 도중 요건을 고치거나 추가·삭제하면 단계 1 판정과 저장 해시가 어긋나거나 작업이 실패한다. 진행 중 편집을 막을지, 결과를 stale로 표시할지 정해 달라(QA-S6-09).
- ⑨ **수동 재시도와 인사이트 행 (QA-S6-01) `[구현 결정]`**: 실패한 인사이트 작업의 수동 재시도는 새 버전을 만들지 않고 같은 행(같은 `version_no`)을 다시 연다. 행에 내부 컬럼 `run_generation`을 두어, 이전 실행 세대에서 실패한 행만 다시 열고 같은 세대에서 실패한 행은 그대로 둔다. S5 JD 추출은 재시도가 새 작업이라 해당 없음.
- ⑫ **진행 단계 값 추가 `[가정]`** (QA-S6-07, AI C-6 "진행 단계 값"): AI-02 작업은 `prepare`(D-30 선행 추출 + `begin_insight`) → `match` → `synthesize` → `synthesize_regen`(V-5 위반이 있을 때만 호출, 없으면 바로 통과) → `validate`로 진행한다. `prepare`·`synthesize_regen`을 `AI_PROGRESS_STAGES`에 더했다. 화면 문구 제안: `prepare` "공고 요건 정리 중"(선행 추출이 없으면 짧게 지나감), `synthesize_regen` "강점·지원 방향 정리 중"(`synthesize`와 같은 문구). C-6·C-03 표에 반영이 필요하다.
- ⑬ **재사용은 latest만 `[구현 결정]`** (QA-S6-06, C-6): 같은 `input_hash`라도 현재 latest가 아닌 예전 ready 버전은 재사용하지 않고 새 작업을 시작한다. 화면(S-16)이 보여 주는 결과와 "재사용됨"이 가리키는 결과가 항상 같게 하려는 것이다.
- ⑭ **요건 목록은 prepare 시점에 고정 `[구현 결정]`** (QA-S6-09, F-P2-03): 작업 도중 요건이 수정·추가·삭제돼도 이번 실행은 `prepare`에서 읽은 요건 목록으로 판정·종합·저장한다(`requirements_hash`도 그 목록 기준). 그래서 수정이 있었으면 저장 직후 S-16에 "데이터 변경됨"이 뜬다. 진행 중 요건 편집을 막을지는 기획이 정할 일이다(qa ⑤와 같은 질문). 삭제된 요건을 가리키는 근거는 DB 트리거가 "원본 삭제됨"으로 둔다.
- ⑮ **선행 추출 취소 전파 `[구현 결정]`** (QA-S6-08): 인사이트 작업이 취소되거나 단계 시간 초과·소유 상실로 abort되면 `prepare` 안의 추출 호출과 재시도도 멈추고, 그 `jd_extraction` 작업은 `canceled`로 끝난다(사용자 키로 호출이 더 나가지 않게, QA-S3a-04 취지).
- ⑯ **대화 자동 삭제 남은 일수 상한 `[구현 결정]`** (QA-S6-05, DM §3.4): `daysUntilAutoDelete`를 0~90으로 자른다. DB 시계가 앱보다 조금 앞서면 방금 만든 대화가 "91일 뒤"로 보이던 문제를 막는다.
- ⑩ **QA 1라운드 (2026-11-01)**
  - (QA-S6-04) **저장 문장의 별칭 `[구현 결정]`**: 카드 예시 문장("PRJ-3의 재시도 큐 설계를…")과 달리, 저장되는 모든 생성 문장에서 별칭을 표시 이름으로 바꾼다(프로젝트명·상세 제목·요건 내용·공고 문장은 `'…'` 40자, 스킬 이름, "프로필"; 모르는 별칭은 삭제). 사용자 데이터에 같은 글자가 있으면(예: "AWS S3", 티켓 번호 "REQ-1") 바꾸지 않는다. 프롬프트에도 금지 규칙을 넣고 `ai-02.match.v2`·`ai-02.synthesize.v2`로 올렸다. 카드 예시 문장 수정 필요(기획).
  - (QA-S6-03) **단계 2 분리**: 첫 종합과 V-5 재생성이 각각 작업 단계 1개다. 무료 등급 6초 간격·호출별 재시도가 재생성에도 적용된다. 단계 2 출력은 별칭 → 행 id 표를 함께 저장해, finalize가 다른 실행에서 불려도(커리어가 바뀌어도) 재매핑된다(위 ⑧의 "같은 실행" 제약 해소).
  - (QA-S6-09) **저장 해시 = prepare 시점 `[구현 결정]`**: `insights.career_snapshot_hash`·`requirements_hash`·`input_hash`는 작업 준비 시점 값이다. 판정·근거 검증은 마지막 단계 시점 데이터 기준이라, 작업 중 데이터가 바뀌면 결과는 최신 데이터로 검증되지만 "데이터 변경됨"으로 표시된다. 요건 추가·삭제(id 집합 변경)는 `requirements_changed`(AiError 아님)로 끝나며 C-11 코드가 없다 — 작업 종료 코드와 진행 중 요건 편집 허용 여부는 기획 결정 필요(QA 스펙 차이 5).
- ⑰ **`requirements_changed` → `stalled` `[가정]`** (리더 결정, ai `InsightRequirementsChangedError`): 단계 1 판정과 요건 목록이 맞지 않으면 C-11 코드가 없어 작업을 `stalled`(system)로 끝내고 자동 재시도하지 않는다. 다만 ⑭(요건 목록을 prepare 시점에 고정)로 실제로는 생기지 않는다. 남겨 둔 것은 방어용이다.

## 2026-11-02 · S7 (ai) · 서류 초안 AI-11·AI-03·AI-04 (ai-pipeline-engineer)
- ① **AI-04 이벤트 순서 `[구현 결정]`** (AI-04 응답 모드, 계획 API 3): 카드·계획은 `validated → (보정 시) adjusting_length → done`이다. 구현은 `sources_selected → 블록 이벤트 → (보정 시) adjusting_length → validated → done`. `validated`는 저장된 최종본과 같아야 하고 그 뒤에 오류가 올 수 없어야 하므로(QA-S3-02) 보정 뒤 1번만 낸다. `adjusting_length`에 보정 전 글자 수·제한·기준이 들어 있어 화면은 "글자 수 맞추는 중"을 그대로 보일 수 있다. 카드 순서 수정 필요.
- ② **스트리밍 기능의 V-5 재생성 생략 `[가정]`** (C-3 V-5 "1회 재생성"): AI-03(완료 40~60초)·AI-04는 함수 60초 안에 블록 단위 재생성 호출을 더할 여유가 없어, 근거 없는 숫자는 재생성 없이 `[수치 확인 필요]`로 치환하고 `number_check_needed` 플래그를 단다(AI-03 계획 "플래그로 표시"와 같음). AI-04는 글자 수 보정 호출이 생길 때만 그 호출에 "확인되지 않는 숫자를 빼거나 [수치 입력 필요]로" 지시를 함께 넣는다(`adjusting_length.reasons`에 `numbers`). 숫자 위반만 있을 때는 추가 호출이 없다.
- ③ **글자 수 범위·세는 법 `[가정]`** (AI-04 글자 수 보정): ±10%를 그대로 따라 제한의 90%~110% 안이면 보정하지 않는다 — 즉 제한을 최대 10% 넘어도 통과한다. 지원서 사이트 제한은 보통 상한이라 "초과는 항상 보정"이 맞는지 기획 확인 필요. 세는 법: 문단을 줄바꿈 1개로 이어 붙인 뒤, `with_spaces`는 공백·줄바꿈 포함 코드 포인트 수, `without_spaces`는 모든 공백 문자 제거 후 수. 자리 표시 토큰도 적힌 그대로 센다. 목표치는 제한의 95%.
- ④ **보정 호출 실패 `[구현 결정]`**: 보정 호출이 공급자 오류·스키마 불일치로 실패하면 문항 생성을 실패로 끝내지 않고 보정 전 초안을 저장한다(`correction_applied = false`, `char_adjust_needed = true`, 보고서 `length_adjust_failed = 1`). 사용자 취소(`canceled`)만 오류로 끝낸다.
- ⑤ **저장 위치 없는 출력 `[가정]`** (AI-03 출력 `omitted`·`notes_for_user`, AI-04 `notes_for_user`·`char_adjust_needed`): DM에 컬럼이 없다. payload 최상위에 함께 넣었고(RPC는 모르는 최상위 키를 무시) `validated` 이벤트로는 화면에 간다. 다시 열었을 때도 보이려면 DM에 자리(`drafts.notes`, `draft_sections.char_adjust_needed` 등)가 필요하다. `char_adjust_needed`는 `validation_report.char_adjust_needed = 1`로도 남는다.
- ⑥ **AI-03 근거 출처 `[구현 결정]`** (C-3 V-7, db 노트 "커리어 7종만"): 경력기술서 근거는 선택된 항목의 커리어 근거만 남긴다. JD 요건·문장을 근거로 달면 V-7 범위 밖으로 제거한다(`requirement_refs`는 그대로 유지). JD 근거만 단 불릿은 근거 0개 → `evidence_check_needed`.
- ⑦ **AI-03 프로젝트 8개 초과 `[가정]`** (카드 "프로젝트 최대 8개"): 사용자가 8개 넘게 고르면 `project_order` → 팩 순서로 앞 8개만 넣고(`planCareerDescription`, `drafts.options`도 정규화본), 나머지는 `omitted`(`user_excluded`)와 고정 안내 문구로 알린다. 모델이 다른 섹션에 넣은 프로젝트는 실제 소속 섹션으로 옮기고, 선택되지 않은 프로젝트·경력은 버린다. 출력이 없는 선택 프로젝트도 서버 머리글은 남긴다.
- ⑧ **블록 id `[구현 결정]`**: AI-03은 모델 id가 형식(`[A-Za-z0-9_.:-]{1,64}`)에 맞고 초안 안에서 처음이면 그대로 쓰고, 아니면 서버 id(`b<n>`)로 바꾼다. 머리글은 `h<섹션>`/`h<섹션>-<프로젝트>`. AI-04 문단 id는 서버가 `q<섹션 id 앞 8자>-p<n>`로 정한다(같은 초안의 다른 문항과 겹치지 않게). 스트리밍 중 `block_started`/`block_delta`/`block_completed`의 `blockId`는 모델 id라서, 화면은 `validated`에서 블록을 통째로 바꿔야 한다.
- ⑨ **스킬명 가드 `[가정]`** (AI-03 실패 유형): 출력의 라틴 문자 기술어(Kafka, Node.js, K8s, C++ …)가 사용자 커리어 데이터 텍스트(경력 팩 전체, AI-04는 JD·메모·문항 포함)에 없으면 블록에 `skill_check_needed` 플래그. API·DB·UI·p95·ms 같은 일반어는 제외 목록. 한글 표기 기술명(쿠버네티스 등)은 잡지 못한다. AI-04에도 같은 가드를 적용했다.
- ⑩ **AI-04 근거 선택 규칙 `[구현 결정]`**: AI 모드에서 근거 인용이 하나도 남지 않은 선택은 버린다(V-4, "선택마다 근거 인용 1개 이상"). primary는 1개(첫 번째)로 맞춘다. 문항 유형별 개수 상한을 넘으면 뒤에서 자르고(`sources_truncated`), 하한 미달(`job_competency`·`experience_story` 0개)은 보고서에만 남긴다(`sources_below_minimum`). 모델이 적은 소속 경력이 실제와 다르면 실제 소속으로 고친다. `detail_refs`는 그 프로젝트의 상세 내용만 최대 2개. 다른 문항의 주 근거를 이유 없이 다시 쓰면 `reuse_without_reason`만 센다. 사용자 모드는 사용자 목록을 그대로 두고(근거가 없어도), 모델 선택에서 이유·요건·근거만 가져온다.
- ⑪ **AI-04 V-7 범위 세부 `[구현 결정]`** (C-3 V-7): 선택한 프로젝트의 소속 경력 자체(요약 등)와 경력 단위 성과는 범위에 넣고, 같은 경력의 다른 프로젝트는 넣지 않는다. 프로젝트 없이 경력·교육만 고른 선택은 그 하위 전체. 직접 추가 스킬(프로젝트에 안 붙은 스킬)은 범위 밖이다.
- ⑫ **문항 유형 `[구현 결정]`**: `template_key`가 있으면 그것이 `question_class`이고 모델 분류는 무시한다(`question_class_overridden`). 사용자 추가 문항은 모델 분류를 쓴다. 회고 허용(V-8)은 이 서버 유형으로 판정한다.
- ⑬ **AI-11 요약 팩 `[구현 결정]`**: 전체 팩과 같은 포함 규칙·별칭·`career_snapshot_hash`를 쓴다(다른 기능과 같은 해시로 재사용 판정). 유효한 프로젝트 순위가 하나도 없으면 V-6 불일치로 보고 1회 재시도 후 `schema_invalid` → 라우트가 대체 선택으로 넘어간다. 순위 이유 문장에도 V-5 치환·별칭 정리를 한다.
- ⑭ **`drafts.options.tone` `[구현 결정]`**: 사용자 입력이므로 알려진 값(`concise`, `detailed`)만 프롬프트에 들어가고 그 밖의 문자열은 무시한다(C-4 지시·데이터 분리). 카드의 tone 값 목록 확정 필요.

## 2026-11-02 · S7 (api) · 서류 초안 라우트·액션·조회 (api-engineer)
- ① **자소서 "전체 생성" = 문항별 요청 `[가정]`** (AI-04 응답 모드, 계획 `[가정]` 1): `POST /api/draft-sections/{id}/generate`는 문항 1개만 만든다. "전체 생성"은 화면이 문항 순서대로 이 라우트를 차례로 부른다(함수 1회 60초 제한). 뒤 문항은 앞 문항의 주 근거를 DB에서 읽어 중복을 피한다.
- ② **경력기술서 실패 시 전체 재시도 `[가정]`** (AI-03 "완료된 블록은 보존", 계획 `[가정]` 2 / UX S-19 "이미 생성된 블록은 보존"): 실패한 초안은 `failed`로 남고 블록을 저장하지 않는다. "다시 시도"는 같은 라우트를 다시 부르는 것(새 초안 행). UX S-19의 "생성된 블록 보존"과 다르다.
- ③ **클라이언트 끊김 `[구현 결정]`** (계획 API 2, S5 ③과 같음): 두 SSE 라우트는 연결이 끊겨도 생성·저장을 끝까지 하고 사용 기록을 남긴다(`after()`로 함수 유지, 요청 signal을 넘기지 않음). 중지는 `POST /api/ai-jobs/{jobId}/cancel`(heartbeat 10초 간격)과 시간 예산뿐이다. S4 대화 턴(끊기면 취소)과 다르다.
- ④ **D-30 추출 + 생성의 60초 예산 `[가정]`** (C-6, AI-03 "완료 40~60초"): 요건 추출이 먼저 필요하면 추출 상한을 20초로 줄이고(S5 동기 라우트는 30초), 생성은 요청 시작 + 58초 − 사용 기록 정리 5초까지 남은 시간만 쓴다. 추출이 길면 AI-03이 `timeout`으로 끝날 수 있고, 다시 시도하면 추출은 이미 끝나 있다. AI-03 자체 목표(완료 40~60초)도 함수 60초와 빠듯하다 — 기획 확인 필요.
- ⑤ **AI-11 대체 선택의 `selection_origin` `[가정]`** (C-11 출처 3값): "최신 경력순 전체 선택"(대체 경로)에는 출처 값이 없다. 응답 `origin: "fallback"`으로만 알리고, 사용자가 그대로 생성하면 화면은 `selectionOrigin: "user"`를 보내야 한다("직접 고름"으로 표시됨). 대체 경로용 출처 값이 필요한지 기획 확인.
- ⑥ **AI-11 실패는 조용히 `[구현 결정]`**: 키 없음·키 무효·공급자 오류·스키마 불일치·추출 실패·추출 진행 중·같은 프로젝트 정렬 진행 중 모두 200 `fallback: true`(+ 로그용 `fallbackReason`)로 답한다. 422(readiness)와 404만 오류로 답한다. 실패한 호출은 `draft_source_ranking` 작업 `failed`와 사용 기록으로 남는다(미터 `career_description`).
- ⑦ **경력기술서 동일 입력 재사용 `[구현 결정]`** (C-6): "다시 생성"(`regeneratedFromId`)이 아니고 같은 `input_hash`(공급자·모델·커리어·요건·정규화된 옵션·tone)의 `ready` 경력기술서가 있으면 호출 없이 SSE `done { reused: true, draftId }` 하나로 답한다. 자소서 문항은 "생성" 버튼이 곧 다시 생성이라 재사용하지 않는다.
- ⑧ **`drafts.options.ranking` 복사 출처 `[가정]`** (AI-11 저장): `selectionOrigin = 'ai_ranking'`이면 이 프로젝트의 가장 최근 성공한 `draft_source_ranking` 작업 출력을 복사한다(지금 팩에 없는 프로젝트는 빠짐). 화면이 보낸 체크 목록과 정렬 결과가 다를 수 있다(사용자가 바꾸면 화면은 `user`를 보내야 한다).
- ⑨ **생성 중 문항 편집 금지 `[구현 결정]`** (F-DOC-02): 생성 중인 문항은 문구·글자 수·메모 수정(409 `section_generating`, `set_section_sources`·삭제와 같은 규칙)과 편집 저장을 막는다.
- ⑩ **진행 표시 "서류 초안 수" `[가정]`** (S-13/S-39 카드): 지원 프로젝트의 `drafts` 행 수(경력기술서·자소서, 상태 무관, 다시 생성으로 생긴 행 포함)다.
- ⑪ **끝난 작업 보정 `[구현 결정]`** (db 노트 §4, S6 방식): 조회는 `generating`인데 그 작업이 queued/running이 아닌 문항·초안을 `failed`로 보이고, 실패 정보는 그 작업에서 가져온다(failed → 그 코드, 작업 없음·성공 → `stalled`). 사용자 취소(`canceled`)는 실패 안내를 보이지 않는다(상태만 failed). 자소서 초안 상태는 보정한 문항 상태로 다시 계산한다.
- ⑫ **편집 블록 규칙 `[구현 결정]`** (F-DOC-04, AI-03 저장): `saveSectionEdit`는 AI 블록 id만 받는다(추가·중복 불가, 빼는 것은 허용 = 화면에서 블록 삭제). 텍스트가 AI 원본과 다르면 `user_modified: true`, 근거는 원래 블록 근거 유지. 머리글 블록도 편집할 수 있다.

## 2026-11-02 · S7 (db) · 서류 초안 스키마·RPC 세부 (db-engineer)
- ① **경력기술서 작업의 대상 `[구현 결정]`** (DM §2.9.1, 계획 DB 5 `target_type = 'draft'`): 작업을 만들 때는 초안이 아직 없다. api가 초안 UUID를 먼저 만들어 `target_id`에 넣고, `begin_career_description`이 그 id로 초안을 만든다(같은 작업 재호출 멱등). 결과적으로 D-34 "동시 실행 1개" 키가 초안마다 달라져 **같은 지원 프로젝트에서 경력기술서 생성이 동시에 여러 개 돌 수 있다** `[가정]`. 프로젝트당 1개로 막아야 하면 `target_type = 'application_project'`로 바꿔야 한다(기획 확인).
- ② **RPC 인자 추가 `[구현 결정]`**: `begin_career_description`에 `p_insight_id`·`p_regenerated_from_id`·`p_title`(모두 기본값 null)을 더했다(A.9 `insight_id`·`regenerated_from_id`를 채울 경로). `create_cover_letter_draft`·`add_cover_letter_question`은 클라이언트 id(`p_draft_id`·`p_section_id`)를 받아 재시도를 멱등으로 처리한다(S2 결정과 같음).
- ③ **기획에 없는 기본값·상한 `[가정]`**: 시드 문항 글자 수 1000자·공백 포함, 문항 최대 10개, 문구 ≤ 1,000자, 글자 수 제한 1~10,000, 사용자 근거 선택 ≤ 5개(모델 0~2 규칙보다 여유), 블록 ≤ 500개·블록 텍스트 ≤ 5,000자·`block_id` `[A-Za-z0-9_.:-]{1,64}`, 섹션 ≤ 30개, `tone` ≤ 50자, 상세 id ≤ 20·요건 id ≤ 50.
- ④ **자소서 초안 상태 계산 `[가정]`** (계획 DB 4): 생성 중 문항이 있으면 `generating` → 모두 `ready`면 `ready` → `failed`와 `ready`가 섞이면 `partially_failed` → `failed`만(생성 전 포함) 있으면 `failed` → 그 밖(생성 전만, 또는 ready + 생성 전)은 `composing`. ready 초안에 문항을 추가하면 `composing`으로 돌아간다. 화면 문구 확인 필요.
- ⑤ **자소서 초안의 공급자 배지 `[가정]`** (S-19 "상단 C-19 결과 배지 `drafts.provider`"): 문항마다 공급자가 다를 수 있어, 초안의 `provider`·`model`·`model_tier`·`connection_tier`·`prompt_version`은 **마지막으로 생성 완료된 문항** 값으로 덮어쓴다. 문항별 배지는 `draft_sections`의 같은 컬럼. `drafts`·`draft_sections`에 `completed_at`(결과 시각)과 내부용 `run_generation`을 더했다 `[구현 결정]`.
- ⑥ **`user_note` 근거의 `source_id` `[구현 결정]`** (AI C-3 `NOTE-n`, DM A.14): 기획에 원본 행 정의가 없다. 메모가 있는 문항(`draft_sections.id`)으로 정했다. 같은 지원 프로젝트가 아니면 `invalid_evidence_source`, 문항이 없으면 "원본 삭제됨"으로 저장한다. 메모를 나중에 고쳐도 인용은 저장 시점 문장이다.
- ⑦ **사용자 근거 선택 규칙 `[가정]`** (F-DOC-08, A.11): 본인 소유 `complete` 행만 고를 수 있다. 프로젝트를 고르면 소속 경력·교육은 프로젝트에서 정해진다. 프로젝트 없이 경력만·교육만 고르는 것도 허용한다(A.11 CHECK가 허용). 이미 목록에 있던 항목은 이유·재사용 이유·요건과 그 선택 이유 근거(`sources.{n}`)를 이어받고, 빠진 항목의 선택 이유 근거는 지운다. 생성 중 문항은 바꿀 수 없다(`section_generating`).
- ⑧ **"삭제됨" 표시명 `[가정]`** (A.11 `source_label`): DB가 저장 시점과 원본 삭제 시점에 "회사명/기관명 › 프로젝트명"으로 계산한다(프로젝트만이면 프로젝트명, 경력만이면 회사명). 여러 원본이 차례로 지워져도 **처음 삭제 때의 표시명**을 유지한다. AI 선택에서 원본이 이미 없으면 payload의 표시명을 쓰고 `source_deleted_at`을 바로 채운다.
- ⑨ **삭제 영향 집계·초기화 범위 `[가정]`** (DM §4.2): `drafts` = 삭제 대상을 근거로 단 블록이 있거나 **섹션 머리글이 삭제 대상 경력·교육인** 경력기술서 문서 수, `draft_sections` = 근거 또는 근거 선택(`draft_section_sources`의 경력·교육·프로젝트·상세 내용 배열)이 삭제 대상에 걸린 자소서 문항 수. 프로젝트 이름순, 한 값이라도 0보다 큰 프로젝트만. `delete_results`의 문항 초기화는 생성 결과·편집본·근거·선택 목록·AI 메타를 지우고 선택 모드를 `ai`로 되돌린다(문구·메모·글자 수·`generation_no`는 유지).
- ⑩ **V-8 DB 방어 `[구현 결정]`** (C-3 V-8, C-9): 경력기술서 payload의 `project_detail.learnings` 근거, `job_competency` 문항의 `learnings` 근거는 RPC가 `invalid_draft_payload`로 거부한다. 경력기술서 근거는 커리어 7종만 받는다(ai ⑥과 같음).
- ⑪ **경력기술서 payload는 모든 섹션 포함 `[구현 결정]`**: `complete_career_description`은 초안의 섹션을 정확히 1번씩 받아야 한다(블록 0개 섹션 허용). `block_id`는 초안 안에서 유일해야 한다.
- ⑫ **QA 1차 반영 (2026-11-02)**: ①은 리더 결정으로 **프로젝트당 경력기술서 생성 1개**를 DB 제약으로 막았다(`ai_jobs_career_description_in_flight_key`, 위반 23505 → api 409). 생성 중 판정과 자소서 초안 상태 계산은 행 상태가 아니라 queued/running 작업 기준이다(QA-S7-07, 끝난 작업의 `generating` 잔여 행은 실패로 센다 `[구현 결정]`). 커리어 삭제 `delete_results`는 영향받는 진행 중 작업에 취소를 요청하고, 초기화된 문항에 늦게 도착한 완료는 `stale_run`으로 버린다(QA-S7-09 `[구현 결정]`).
- ⑬ **(QA 1차) 경력기술서 동시 실행 409 `[구현 결정]`** (D-34, QA-S7-01): 같은 지원 프로젝트에 경력기술서 생성은 1개만 돈다. 두 번째 요청은 409 `career_description_in_progress`(`error.details.jobId` = 진행 중 작업)이다. 화면은 그 작업을 이어 보이거나 "이미 만들고 있어요"를 보인다. SSE는 이어 붙을 수 없으므로(끊긴 스트림 재접속 없음) 결과는 끝난 뒤 조회로 본다.
- ⑭ **(QA 1차) 무료 등급 간격은 요청 안에서 대기 `[가정]`** (C-12, QA-S7-03): 동기·스트리밍 경로는 `next_run_at` 예약을 할 수 없어 요청 안에서 최대 6초 기다린다. 기다린 만큼 생성 예산(58초)이 줄어 AI-03이 무료 등급에서 `timeout`으로 끝날 가능성이 커진다(④와 같은 문제). 보정 호출이 간격 때문에 들어갈 자리가 없으면 보정 없이 저장(`char_adjust_needed`).
- ⑮ **(QA 1차) 빈 편집 저장 허용 `[구현 결정]`** (QA-S7-06): 블록을 모두 지운 저장도 편집본(빈 화면)으로 남는다. AI 원본으로 돌아가려면 "다시 생성"뿐이다(되돌리기 기능은 명세에 없다).
- ⑯ **(QA 1차) 외부 중지 = 취소 `[구현 결정]`** (QA-S7-09): 생성 중 커리어 삭제(결과 삭제/초기화)·초안 삭제·프로젝트 삭제로 결과 행이 없어지거나 초기화되면 그 실행은 `canceled`로 끝나고 실패 안내를 보이지 않는다. 이미 쓴 토큰은 사용 기록에 남는다.

## 2026-11-03 · S8 (ai) · 모의 면접 AI 파이프라인 (ai-pipeline-engineer)
- ① **질문 단위 판정 + 남은 개수 재생성 `[가정]`** (AI-05 처리 방식 "규칙 위반 시 1회 재생성", 계획 `[가정]` 3): 질문은 스트림에서 닫히는 즉시 저장되므로 세트 전체를 다시 만들 수 없다. 그래서 4.1 세트 구성 규칙을 **받을 때마다의 가능성 검사**로 바꿨다(이 질문을 받으면 남은 칸으로 최소 개수를 채울 수 없으면 버림). 버린 질문만큼 1회 재생성하고, 재생성 호출에서는 구성 규칙을 완화해 받는다(경고 `composition_relaxed`/`composition_unmet`). 그래도 질문 수가 모자라면 `schema_invalid`(retryable false)로 끝나고 저장된 질문은 남는다("남은 질문 다시 만들기").
- ② **질문 속 수치 V-5는 치환 대신 질문 폐기 `[구현 결정]`** (C-3 V-5 "치환"): 질문 문장에 `[수치 확인 필요]`가 들어가면 면접 질문으로 쓸 수 없어, 그 질문을 버리고 재생성 요청에 해당 숫자를 알린다. `intent`·`good_answer_signals`는 치환한다.
- ③ **중복 규칙의 "주 대상" `[가정]`** (4.1 "같은 프로젝트를 주 대상으로 하는 질문 최대 2개, 같은 상세 내용 1개, 같은 요건 1개"): 주 대상 = 질문 근거 중 첫 경력 근거(상세 내용·성과면 그 상위 프로젝트)와 `target_requirement_refs`(없으면 gap refs)의 첫 번째. 직무 면접에만 적용. 이전 실행에서 저장된 질문은 api가 `evidence_sources`를 넘길 때만 프로젝트·상세 내용 중복을 함께 본다(요건은 항상).
- ④ **C-7 금지 주제·컬처핏 고유명사·회고 인용 검사는 규칙 기반 `[가정]`**: 금지 주제는 단어 목록(나이·결혼/출산·가족·종교·출신 지역·정치·건강, "장애 대응"·"건강성" 같은 직무어는 제외). 컬처핏 `experience`가 아닌 질문은 경력 팩의 회사·기관·전공·프로젝트명·직급·직책·부서(JD나 희망 직무에 있는 말 제외)와 JD에 없는 숫자를 쓰면 버린다. 회고(learnings) 근거는 질문 문장이 "배웠다고 정리하셨는데"류 표현일 때만 남긴다. 평가 세트로 보정 필요.
- ⑤ **project_deep_dive의 근거 `[구현 결정]`** (4.1 v3 "사실 전제는 action/result/성과에서만"): 상세 내용 `action`·`result` 또는 성과 근거가 없으면 버린다. `requirement_fit`은 요건 + 사실 경력 근거, `gap_probe`는 gap 요건 1개 이상이 필요하다. 컬처핏 `jd` 앵커는 조직·업무 방식 문장(S 번호) 근거, `general`은 근거를 지운다.
- ⑥ **AI-06 `consistency_notes` 원소 모양 `[가정]`** (카드에 원소 정의 없음): `{text, answer_quotes, evidence}`. 사실 경력 근거(learnings 제외) 1개 이상이 없으면 버린다. 저장 result에는 `{text, answer_quotes}`만, 근거는 `consistency_notes.<n>`.
- ⑦ **AI-06 답변 인용도 evidence_links로 `[구현 결정]`** (계획 item_key 목록 확장): 등급·강점의 `answer_quotes`는 result에 문자열로 남기고(화면 표시), 같은 인용을 `interview_answer` 근거 행(`criteria.<key>`, `strengths.<n>`)으로도 저장한다. 등급의 인용이 모두 V-3에서 떨어지고 `missing`도 없으면 서버 문구("답변에서 이 판단의 근거 구간을 확인하지 못했습니다.", `missing_filled: true`)를 넣는다 `[가정]`.
- ⑧ **AI-06 criteria 규칙은 V-6로 취급 `[구현 결정]`**: 4키 누락·중복, `job_relevance` 밖의 `not_applicable`은 1회 재시도 후 `schema_invalid`. 개선 답변 예시 V-5 재생성은 호출 전체를 1회 다시 한다(평가 결과도 새 출력으로 교체). 함수 예산이 빠듯하면 api가 `numberRegeneration: false`로 끌 수 있고, 그때는 바로 치환한다.
- ⑨ **AI-06 개선할 점(improvements)은 근거가 없어도 유지 `[구현 결정]`** (C-3 V-4 "피드백 항목"): 답변에 대한 행동 조언이라 경력 근거가 없는 경우(컬처핏 none)가 정상이다. 잘한 점(strengths)은 답변 인용이 없으면 버린다.
- ⑩ **AI-07 미응답 처리 `[구현 결정]`**: `unanswered_note`는 서버 문구로 덮어쓴다("미응답 N문항(3번 질문)은 답변이 없어 평가하지 않았습니다."). 강점·약점·다음 연습(retry_question 제외)·headline이 미응답 질문 번호(Q-n, "n번 질문")를 언급하면 그 항목을 버린다(headline은 고정 문구로 교체). 제출했지만 평가 실패한 질문도 강점·약점 ref에서 뺀다. `add_data`의 질문 ref는 평가된 답변만.
- ⑪ **AI-07 저장 키 `[구현 결정]`**: result의 `question_refs`→`question_ids`(UUID), `requirement_refs`→`requirement_ids`, `question_ref`→`question_id`로 바꿔 저장한다(C-3 별칭→UUID). 문장 속 Q-n은 "n번 질문", REQ-n은 요건 내용으로 바꾼다. AI-07에는 근거 행이 없다(`evidence: []`). `hashes.career_snapshot_hash`는 세션 값을 api가 넘긴다.
- ⑫ **AI-05 `data_sufficiency` 출력은 무시 `[구현 결정]`**: 서버 판정값(세션)을 쓰고, 모델 값이 다르면 `data_sufficiency_overridden`만 센다. 컬처핏 `ok`에서 experience 앵커 50% 미만은 `experience_anchor_below_target`만 센다(목표치).

## 2026-11-03 · S8 (db) · 모의 면접 스키마·RPC 세부 (db-engineer)
- ① **세션 내부 컬럼 추가 `[구현 결정]`** (DM A.12): `question_job_id`·`question_run_generation`·`evaluation_job_id`·`evaluation_run_generation`. 생성·채점을 소유한 작업과 실행 세대를 세션에 두어 S6 QA-S6-01 재시도 규칙(같은 세대 실패는 다시 열지 않음, 수동 재시도는 다시 엶)을 그대로 적용한다. 작업 FK는 복합 `(…, user_id)` `on delete set null`. 질문·평가·종합 행에도 `run_generation`.
- ② **세트 단위 AI 메타 저장 자리 없음** (DM §0, A.12): AI 메타는 질문 행마다 저장한다. `complete_interview_questions`가 받는 세트 단위 `validation_report`(구성 규칙 경고 등)·`usage`는 세션에 컬럼이 없어 저장하지 않는다. 화면·운영에서 세트 경고가 필요하면 DM에 자리가 필요하다.
- ③ **길이·개수 상한 `[가정]`**: `question_text`·`intent` 1~1000자, `good_answer_signals` 문자열 0~10개(각 ≤300), `focus_criteria`는 4키 중 0~4개, 대상 요건·보완 요건 각 ≤20, `weak_requirement_ids` ≤50, `score_method_version` ≤100.
- ④ **답변 편집 조건에 `status = 'in_progress'` 추가 `[가정]`** (A.13 "draft + 미제출 + 생성 완료"): 그만둔(`abandoned`) 세션도 미제출이지만 답변을 고칠 수 없게 했다. RLS로 막으므로 조건 밖 update는 오류가 아니라 0행이다.
- ⑤ **"응답됨" = 공백 아닌 글자가 있음 `[구현 결정]`**: 제출의 미응답 판정과 `answered_count` 모두 `answer_text ~ '\S'`(줄바꿈·탭 포함 공백만이면 미응답).
- ⑥ **제출 전 `score_status` null, 미응답은 제출 때 `unanswered` `[구현 결정]`** (C-17): 응답 답변은 평가 저장 때 `pending_method`, 평가 실패 때 `not_scored`. 응답 0개면 세션 `completed` + `not_scored` + `score_counted_count = 0`(채점 작업 없음, AI-07 미호출).
- ⑦ **다시 채점 범위 `[가정]`** (계획 [가정] 1·2): 평가 성공이 없는 응답 답변만 다시 평가하고, 종합(AI-07)은 **항상 다시** 한다(답변 평가가 바뀌면 종합도 바뀌므로). 다시 채점을 시작하면 종합 행은 `pending`(이전 result는 행에 남음), 세션 `score_status`·`completed_at`·`result_viewed_at`을 비운다. 종합이 실패하면 세션은 `evaluation_failed`. `completed`인데 다시 할 답변이 없으면 `interview_evaluation_not_needed`.
- ⑧ **결과 확인 표시(`result_viewed_at`)는 `completed`일 때만 `[가정]`**: 채점 중·채점 실패 화면을 열어도 "새 결과" 표식은 남는다. 다시 채점이 시작되면 null로 되돌린다.
- ⑨ **세션 삭제 시 진행 작업 취소 요청 `[구현 결정]`**: 세션 delete 트리거가 그 세션 대상 queued/running 질문·채점 작업에 `cancel_requested_at`을 기록한다(사용자 삭제, `delete_results`, 프로젝트 연쇄 모두). 그만두기는 질문 생성 작업만 취소 요청한다.
- ⑩ **V-8 DB 방어 `[구현 결정]`**: 직무 면접 질문 근거의 `project_detail.learnings`를 거부한다(컬처핏은 회고 인용 허용). 답변 평가·종합의 근거는 제한하지 않는다(컬처핏 개선 답변 마무리 회고, C-9).
- ⑪ **`interview_answer` 근거 출처 `[구현 결정]`** (C-3 ANS-n): `source_id` = `interview_answers.id`, 같은 지원 프로젝트의 답변만(아니면 `invalid_evidence_source`), `source_field`는 null(DB CHECK). 답변 삭제 시 "원본 삭제됨" 트리거.
- ⑫ **보드 팝업 `interview_prompt` 확장 `[구현 결정]`** (DM §2.6 5, C-14): `in_progress_session_id` 외에 `in_progress_session {session_id, interview_type, answered_count, question_count, generation_status, last_activity_at}`를 더했다. 작성 중 세션은 유형과 무관하게 프로젝트당 1개라, 옮긴 열 유형과 다를 수 있다.
- ⑬ **세션 `data_sufficiency` not null `[구현 결정]`** (A.12에 not null 표기 없음): 생성 RPC가 항상 서버 판정값을 받는다.
- ⑭ **자동 저장과 세션 삭제의 교착 가능성 `[가정]`**: 답변 수정 트리거는 답변 → 세션 순으로 잠그고, 세션 삭제 연쇄는 세션 → 답변 순이다. 같은 세션을 지우는 순간 자동 저장이 겹치면 Postgres 교착 감지(1초)가 한쪽을 `40P01`로 끝낸다(세션은 어차피 없어진다). 제출 RPC는 답변 → 세션 순으로 잠가 이 문제를 피했다.

## 2026-11-03 · S8 (api) · 모의 면접 작업·라우트·조회 (api-engineer)
- ① **답변 일부의 최종 실패 판정 `[가정]`** (AI-06 "해당 답변만 재시도, 그래도 실패하면 not_scored", 계획 `[가정]` 2): 실행기가 그 오류로 더는 자동 재시도하지 않을 때(C-11.3 정책·120초 상한, `ctx.wouldRetry`) 그 답변을 `fail_answer_evaluation`(`not_scored`)으로 닫고 나머지로 진행한다. 단 **키·계정·공급자 한도 원인**(`user_account`·`provider_limit` 범주: `key_invalid`·`key_missing`·`billing_required`·`model_not_available`·`rate_limited`·`daily_quota_exhausted`)은 종합도 같은 이유로 실패하므로 답변을 닫지 않고 작업 전체를 실패시킨다(세션 `evaluation_failed`, 저장된 평가 보존). 단계 마감 시간(timeout)으로 끊긴 경우도 작업 단위 재시도 규칙을 따른다.
- ② **모든 답변이 실패하면 작업 실패 코드 = 첫 실패 답변의 원인 `[구현 결정]`**: `complete_interview_evaluation`이 `evaluation_failed`를 돌려주면 작업을 그 코드로 실패시킨다(재시도 없음). AI-07은 호출하지 않는다.
- ③ **질문 생성은 함수 실행 1번 = 공급자 호출 1번 `[구현 결정]`** (C-6 60초, C-12): 첫 호출이 모자라면 남은 개수 재생성을 다음 실행(STEP_CONTINUE)에서 한다. 그래서 무료 등급은 재생성 전에도 호출 간격(6초)을 지킨다. 재생성 후에도 모자라면 `schema_invalid`(retryable false), 저장된 질문은 남는다.
- ④ **"남은 질문 다시 만들기"·"다시 채점"은 새 작업 `[구현 결정]`**: 실패한 작업을 다시 큐에 넣지 않고 같은 세션을 대상으로 새 `interview_questions`/`interview_evaluation` 작업을 시작한다(begin RPC가 실패 세션을 다시 엶). 공용 `/api/ai-jobs/{id}/retry`도 그대로 동작한다(DB의 실행 세대 재오픈 규칙).
- ⑤ **세션 생성 직후 작업 시작이 실패하면 빈 세션을 지운다 `[구현 결정]`**: 연결 게이트를 먼저 보지만, 그 사이 키가 바뀌는 등으로 `startJob`이 실패하면 질문이 0개인 방금 만든 세션을 삭제하고 오류를 돌려준다(작업 없는 `generating` 세션이 남지 않게).
- ⑥ **제출 후 채점 작업 시작이 실패하면 세션은 `evaluating`으로 남고 조회는 `evaluation_failed`로 보인다 `[가정]`**: 남은 작업 규칙(진행 중 작업 없음 = 실패)으로 처리하고, "다시 채점"으로 새 작업을 시작한다.
- ⑦ **실행 공급자 필터 `[가정]`** (S-37 필터 "실행 공급자" `[가정]`): 화면에 보이는 공급자(단일 또는 질문·채점 둘 다) 중 하나라도 같으면 포함한다. 상태 필터는 남은 작업 규칙을 적용한 **표시 상태**로 거른다.
- ⑧ **새 결과 표식 = 제출됨 + 완료/채점 실패 + `result_viewed_at` null `[구현 결정]`**: DB는 `completed`일 때만 열람을 기록하므로(db ⑧) 채점 실패 세션은 표식이 계속 남는다. 결과 조회(`getInterviewResult`)는 처음 열 때 `mark_interview_result_viewed`를 부르고 `firstView: true`를 돌려준다.
- ⑨ **S-20 세션 목록의 실행 공급자 `[확인 필요]` 해소 방식**: UX S-20은 `interview_sessions.provider`를 적었지만 DM v4.1 규칙(채점 시작 후 `evaluation_*`, 아니면 `question_*`, 다르면 둘 다)을 따랐다. 계약 `ExecutionProviderView`.
- ⑩ **답변지(S-33) 질문에 근거 칩 포함 `[구현 결정]`**: 질문 근거(`evidence_links` `interview_question`)는 비공개 컬럼이 아니므로 제출 전에도 보여 준다. `intent`·`good_answer_signals`는 응답 어디에도 없다(결과 화면 `intent`만 제출 후 `get_interview_question_reveals`로).
- ⑪ **C-14 팝업 계약 확장**: `InterviewPrompt`에 `inProgressSession {sessionId, interviewType, answeredCount, questionCount, generationStatus, lastActivityAt}`를 더했다(기존 `inProgressSessionId` 유지).
- ⑫ **진행 단계 값 `complete` 추가 `[가정]`** (AI C-6 "진행 단계 값": AI-05 `generate`, 채점 `evaluate → summarize → score`): 두 면접 작업의 마지막 단계(질문 세트 확정 / 채점 마감, 호출 없음)가 `progress.stage = complete`로 끝난다. 앞 단계 `prepare`도 같은 방식(S6 ⑫). C-6 목록에 반영 요청.
- ⑬ **AI-06 재생성 최종 실패 시 첫 평가 사용 `[구현 결정]`** (QA-S8-01): V-5 재생성 호출이 재시도 없이 실패하면(키·한도 원인 제외) 답변을 `not_scored`로 두지 않고 첫 평가 결과를 `[수치 확인 필요]` 치환으로 저장한다(C-3 V-5 대체 규칙).

## 2026-11-04 · S9 (api) · 계정 탈퇴·보관 크론 (api-engineer)
- ① **탈퇴 확인 방식 `[가정]`** (UX FL-07 "확인 문구", S-25에 입력 문구 정의 없음): 문구 입력 대신 체크 플래그 `DeleteAccountInput { confirm: true }`(strict)로 받는다. 화면이 고정 문구 입력을 원하면 화면에서 비교한 뒤 같은 플래그를 보낸다. UX S-25에 확인 방식 명시 요청.
- ② **탈퇴 후 이동 경로 `[가정]`**: FL-07 "→ S-01"을 `/`(공개 랜딩)로 두고 응답 `redirectTo`로 돌려준다(`ACCOUNT_DELETED_REDIRECT`). S-01 경로가 다르면 contracts 한 곳만 고친다.
- ③ **탈퇴·요약은 약관 동의 게이트 없이 로그인만 확인 `[구현 결정]`**: 새 약관 미동의 상태에서도 탈퇴할 수 있어야 하고, auth 삭제 실패 뒤 재시도 때는 동의 행이 이미 지워져 있기 때문이다.
- ④ **`subject_hash` = HMAC-SHA256(`ACCOUNT_DELETION_HASH_SECRET`, `"account:" + user id`) hex `[가정]`** (계획 `[가정]` 3): 도메인 구분 접두사를 붙였다. 재가입 추적에는 쓰지 않는다. 비밀값이 없으면 아무것도 지우지 않고 `internal_error`로 실패한다.
- ⑤ **auth 삭제 실패 시 오류 코드 `account_deletion_incomplete`(500) `[구현 결정]`**: public 데이터는 이미 지워졌고 세션은 남겨 둔다(쿠키 정리 안 함). 같은 화면에서 다시 시도하면 RPC가 멱등으로 통과하고(로그 추가 없음) auth 삭제를 다시 한다. 이미 지워진 auth 사용자(404)는 성공으로 본다. 화면 문구 "계정 정보 삭제를 마치지 못했어요. 잠시 후 다시 시도해 주세요." — UX에 이 상태 문구 추가 요청.
- ⑥ **크론 일정 `[가정]`** (계획 `[가정]` 2): `vercel.json`에 `/api/cron/retention` 매일 03:00 KST(`0 18 * * *` UTC), `/api/cron/ai-jobs` 매일 02:00 KST(`0 17 * * *`). Hobby 플랜은 크론이 하루 1회·시각 오차 최대 1시간이라 ai-jobs 크론은 안전망 역할만 한다(B-4: 주 경로는 상태 폴링). Pro로 바꾸면 ai-jobs는 `*/5 * * * *` 권장.
- ⑦ **보관 크론 배치 `[구현 결정]`**: RPC 한 번에 5,000행, 꽉 차면 같은 실행에서 최대 4번까지 이어 부르고 남은 행은 다음 실행에 넘긴다(`hasMore`). 한 정리가 실패해도 나머지는 실행하고 끝에 500을 돌려준다.
- ⑧ **교착 재시도 후 오류 `account_deletion_busy`(503) `[구현 결정]`** (QA-S9-01): `delete_account`가 40P01이면 한 번 다시 부르고, 또 실패하면 이 코드로 "다른 작업과 겹쳐 탈퇴를 마치지 못했어요. 지운 것은 없어요. 잠시 후 다시 시도해 주세요."를 낸다. UX S-25 오류 문구에 추가 요청.

## 2026-11-04 · S9 (db) · 탈퇴·보관 정리 (db-engineer)
- ① **DM-1 "탈퇴 = auth.users 연쇄" 전제와 실제 순서가 다르다 `[구현 결정]`** (DM §4.1·6.1 F-COM-05 "W `auth.users` delete(전체 연쇄)"): 모든 사용자 테이블은 `auth.users`에서 연쇄되고 `profiles`에서는 아무것도 연쇄되지 않는다. 계획대로 public 데이터는 `delete_account`가 28개 `user_id` 테이블과 `profiles`를 **명시적으로** 지우고, `auth.users` 삭제는 그 뒤 서버가 한다. 연쇄는 안전망으로 남는다. DM 6.1 표현을 "RPC가 public 전체 삭제 → auth 사용자 삭제(연쇄는 안전망)"로 고치기를 권한다.
- ② **로그 행은 RPC 마지막에 한 번만 쓴다 `[구현 결정]`** (계획 3단계 "insert → 삭제 → `db_deleted_at` 기록"): 한 트랜잭션이라 순서와 무관하게 결과가 같아 insert 한 번에 `requested_at`·`db_deleted_at`를 함께 넣는다. `subject_hash`는 unique이고 같은 hash로 다시 부르면 첫 행을 유지한다(멱등). 형식은 소문자 hex 64자(HMAC-SHA256)로 CHECK한다.
- ③ **진행 중 작업은 취소 표시 없이 행째 삭제 `[구현 결정]`** (계획 3-1 "취소를 요청한다"): 같은 트랜잭션에서 작업 행이 지워지므로 `cancel_requested_at`은 의미가 없다. 실행기는 heartbeat에서 lost로 멈추고 키 복호화도 거절된다. api가 미리 `request_ai_job_cancel`을 별도 커밋으로 부르는 것은 선택이다.
- ④ **교착 가능성은 두 경로에 남는다 `[가정]`** (QA 1차 QA-S9-02로 고침)
  - S5~S8 실행기와 S4 턴 시작·발화 추가(대화 → 메시지)와는 같은 잠금 순서다. 탈퇴는 대화를 id 순서로 먼저 잠그고, 그 다음 메시지를 지운다.
  - 반대 방향이 남는 경로는 두 가지다.
    - S4 `finish_assistant_message`(메시지 → 대화). S4 안에 두 순서가 모두 있어서 어느 쪽을 골라도 한쪽과는 반대가 된다.
    - 다른 탭에서 커리어를 자동 저장하는 경우(커리어 행 → `profiles` 갱신).
  - 겹치면 40P01이 난다. 데이터는 롤백되고, api가 한 번 재시도한다(RPC 멱등).
- ⑤ **90일 지난 작업 정리 시 결과 행의 `updated_at`이 바뀐다 `[가정]`** (DM §2.9.1 보관 90일): 결과 테이블의 작업 FK가 `on delete set null`이라 `set_updated_at` 트리거가 돈다. 낙관적 동시성(`expectedUpdatedAt`)은 커리어 테이블만 쓰므로 화면 충돌은 없다. 결과 화면이 `updated_at`을 "수정됨"으로 보이면 오해가 생길 수 있다.
- ⑥ **미연결 대화 정리는 진행 중 턴이 있는 대화를 건너뛴다 `[구현 결정]`** (DM §3.4): 대상 작업이 queued/running이면 90일이 지나도 남긴다. 기준은 "90일보다 오래됨"(정확히 90일은 남김)이다.
- ⑦ **사용 기록 13개월 = 이번 KST 달 포함 13개 달 `[가정]`** (D-DM-09): `period_month < (p_now의 KST 달 1일 − 12개월)`이면 지운다. 매월 배치가 아니라 매일 크론에서 같은 기준으로 돈다.
- ⑧ **정리 RPC 한 번에 최대 `p_limit`(기본 5000, 1~50000)행을 지운다 `[구현 결정]`**: 잠긴 행은 건너뛴다(`skip locked`). 반환값이 `p_limit`과 같으면 남은 행이 있을 수 있다.

## 2026-11-04 · S9 (QA) · 탈퇴 미완료 상태 복구 경로·AI 쓰기 권한 정리 (backend-qa)
- ① **`account_deletion_incomplete` 뒤 S-25 재진입 경로가 없다 `[UX 확인 필요]`** (FL-07, S-25; api spec-gaps S9 ⑤): auth 삭제가 실패하면 public 데이터(동의·`profiles` 포함)는 이미 없고 세션은 남는다. 같은 화면에서 바로 재시도하면 되지만, 화면을 떠나면 대시보드 레이아웃의 동의 게이트(`src/server/auth/session.ts:42-54` `requireConsentedUserOrRedirect`)가 S-03으로 보내므로 약관에 다시 동의해야 S-25에 닿는다. UX에 이 상태의 진입 경로(예: 로그인 직후 "탈퇴 마무리" 안내, S-25를 동의 게이트 밖에 두기)를 정해 달라고 요청한다. A1 연결 때 반영.
- ② **`app_ai_writer`의 `evidence_links` 직접 INSERT 컬럼 권한은 쓰는 곳이 없다 `[기획 확인]`** (DM §5, DM-13): 모든 근거 저장은 S6~S8 definer RPC(`complete_insight`·`complete_*`·`save_*`) 안에서 하고, 앱 코드에서 `app_ai_writer`로 `evidence_links`에 직접 쓰는 경로가 없다. 직접 INSERT는 `run_generation` 확인을 거치지 않으므로 DM §5에서 이 권한을 빼는 방안을 검토해 달라(같은 사용자 범위라 Critical은 아님).

## 2026-11-05 · R1 (ai) · 기획 결정 A10·A11·A22·A23 반영 (ai-pipeline-engineer)
- **R1 해소** S6 (qa) ① V-4 희망 정보 포함 여부 → A10 확정: `profile.desired_job_title`·`interested_industries`는 V-4 근거 수에 넣지 않는다(`isCareerSupportEvidence`). `total_years_of_experience`는 유지. AI-02·03·04·05·06 프롬프트 버전을 올렸다.
- **R1 해소** S7 (api) ⑤·⑥ AI-11 대체 선택 → A23 확정: `fallbackSelection` 삭제, `emptyDraftSourceSelection()` 추가(실패 = 체크 없는 목록, `selection_origin = user`).
- **R1 해소** S8 (ai) ⑤ requirement_fit 사실 근거 → A11 확정: 모든 직무 질문의 사실 전제는 action·result·성과에서만(`fact_premise_unsupported`로 버림).
- ① **희망 정보 근거는 세지 않을 뿐 지우지 않는다 `[구현 결정]`** (C-3 V-4 v4.3): 다른 사실 근거로 살아남은 판단 항목에는 희망 정보 근거가 `evidence_links`에 함께 저장될 수 있다. 근거 칩에서도 빼야 하면 기획에서 정해 달라(검증 단계에서 제거 규칙 추가).
- ② **gap_probe "사실을 전제함" 판별 `[가정]`** (§4.1 A11은 판별 방법이 없음): anchor `experience`, 사실 경력 근거(희망 정보·회고 제외), 질문 문장의 경력 고유명사 중 하나라도 있으면 사실 전제로 본다. 셋 다 없으면 "비슷한 경험이 있다면" 형태로 보고 면제.
- ③ **세트 단위 `question_usage`·`question_validation_report`는 생성 호출 전체 합 `[구현 결정]`** (DM A.12 A22 "세트를 만든 호출들의 토큰 합계"): `accumulateQuestionSetRecord`로 호출마다 누적하고 `attempts`·`regenerated`를 보고서에 넣는다. api 실행기가 누적값을 넘겨야 한다(지금은 마지막 호출 값).

## 2026-11-05 · R1 (db) · 기획 결정 A5·A6·A7·A18·A19·A20·A22·A24 반영 (db-engineer)
- **R1 해소** 2026-10-30 S4 ② · S4 (db) ② 시작 인사와 메시지 상한 → A5 확정: 인사는 세지 않는다. `start_writing_chat`이 0으로 시작하고 기존 행은 인사 행이 있으면 1을 뺐다(`20261105000100`). 사용자 메시지 수락 `≤ 38`, `is_final`(40번째 답) 규칙은 그대로 → 실제 최대 40.
- **R1 해소** S4 (db) ④ 그만둔 대화 → A6 확정: `abandoned → active`를 사용자 세션 직접 update로 허용, 트리거가 `last_activity_at = now()`(`20261105000200`). `saved`·`handed_off`는 그대로 최종, `abandoned`에서 나가는 길은 `active`뿐.
- **R1 해소** 2026-10-25 S2 `suggested_mode` 필드 누락 프로젝트 · S3b readiness `form` 시 `suggested_*` → A18 확정: `hints`에 `project_fields`, `next_action = form` + `suggested_project_id`(예외적으로 form에 id를 준다), DM 6장 판정 순서 ①~⑤로 바꿨다(`20261105000400`).
- **R1 해소** S3b DM 2.11.3 키 RPC 실행 주체(QA-S3b-06) → A19 확정: `save_provider_key`·`record_provider_key_check`가 `p_user_id`를 받고 service_role만 실행(`20261105000500`). 옛 시그니처는 지웠다.
- **R1 해소** S3b DM 2.11.5 재동의 판정 → A20 확정: `save_provider_key`가 `check_ai_run_allowed`와 같은 `private.ai_consent_allows_run`을 쓴다. `private.has_current_ai_consent`는 지웠다.
- **R1 해소** S8 (db) ② 세트 단위 AI 메타 → A22 확정: `interview_sessions.question_validation_report`·`question_usage`(jsonb null, object CHECK), `complete_interview_questions`가 `p_payload.validation_report`·`usage`로 쓴다(`20261105000600`).
- **R1 해소** S9 (QA) ② `evidence_links` 직접 INSERT → A24 확정: `app_ai_writer` insert 컬럼 grant와 `evidence_links_insert_ai_writer` 정책을 없앴다(`20261105000700`).
- **R1 해소(db 쪽)** S9 (QA) ① 탈퇴 미완료 재진입 → A7: `get_account_deletion_state` 추가(`20261105000300`). 세션 게이트 연결은 api.
- ① **`get_account_deletion_state`는 `p_subject_hash`도 받는다 `[구현 결정]`** (DM 6.1 시그니처는 `(p_user_id)`만): hash는 서버의 HMAC 비밀값으로 만들고 DB는 비밀값을 모른다(`delete_account(p_subject_hash)`와 같은 이유). 서버가 `delete_account`에 쓰는 것과 같은 함수로 계산해 넘긴다. hash 형식(소문자 hex 64자)은 프로필이 있어도 검사한다. DM 6.1 시그니처를 `(p_user_id, p_subject_hash)`로 고치기를 권한다.
- ② **`save_provider_key.p_disclosure_version`은 형식상 인자 `[구현 결정]`** (DM 2.11.3 인자 유지 + 2.11.5 v4.2 통일 규칙): 판정은 동의 행 기준이라 이 값은 그 공급자·등급의 알려진 고지 버전이기만 하면 된다(null·없는 버전이면 `consent_required`). 현재 버전이든 동의한 버전이든 통과한다.
- ③ **키 RPC 소유 검사 = `p_user_id`의 `profiles` 행 존재 `[구현 결정]`** (DM 2.11.3 "`p_user_id` 소유 검사"): 프로필이 없으면 `user_not_found`, null이면 기존 매핑 그대로 42501 `not_authenticated`. 모든 읽기·쓰기를 `p_user_id`로 거른다. service_role이 다른 사용자 id를 넘기는 것은 서버 책임이다(세션 확인 후 호출).
- ④ **`project_fields` hint 조건 `[가정]`** (DM 6장은 "draft 프로젝트가 있으면"만 말함): `complete_projects = 0`일 때만 넣는다(`complete_project_detail`과 같은 조건 계열). 대상은 포함 규칙(소속 경력·교육이 draft면 제외)을 적용하고 complete 상세 내용이 있으며 `name` 또는 `role`이 공백인 draft 프로젝트. 경력이 없으면(판정 ①) hint는 붙지만 `suggested_project_id`는 주지 않는다.

## 2026-11-05 · R1 (api) · 기획 결정 A5·A6·A7·A13·A18·A19·A20·A22·A23 반영 (api-engineer)

- ① **`profile_missing` 처리 `[가정]`** (DM v4.2 6.1, UX v5.3 S-25 — 화면 처리 없음, 리뷰 R-61): 프로필도 탈퇴 기록도 없는 세션은 가입 트리거 실패 같은 서버 이상으로 본다. 로그인 콜백은 로그아웃 후 S-02 `?error=auth_callback`, 동의 게이트 액션·페이지는 `account_profile_missing`(500), S-25 진입 판정도 같은 오류. 동의 게이트로 보내지 않는다.
- ② **S-25 경로 `[가정]`**: `ROUTES.accountDeletion = "/settings/account/delete"`. 이 페이지는 `requireUserForAccountDeletion()`(로그인만 확인, 동의 게이트 밖)을 써야 한다. 탈퇴 미완료면 대시보드 게이트(`requireConsentedUserOrRedirect`)가 원래 URL·S-03보다 먼저 이 경로로 보내고, 동의 게이트 액션은 `account_deletion_incomplete`(403)로 거부한다. "다른 메뉴 이동 없음"은 이 게이트로 보장된다.
- ③ **`get_account_deletion_state` 인자** (DM 6.1은 `p_user_id`만): db 구현대로 `p_subject_hash`(delete_account와 같은 HMAC)도 넘긴다. DM 시그니처 정정 필요(db 노트와 같은 항목).
- ④ **로그인 콜백에서 판정 실패 시 `[구현 결정]`**: 상태 조회가 실패하면 로그인은 그대로 진행하고(보통 흐름), 게이트가 있는 페이지·액션이 다시 판정해 실패를 드러낸다.
- ⑤ **AI-11 응답 필드 이름 변경** (A23, UX S-17·C-11): `origin`/`fallback`/`fallbackReason` → `selectionOrigin`(`insight`/`ai_ranking`/`user`)/`failed`/`reason`. 실패면 네 목록 모두 빈 배열, `ranking: null`. UI 연결 전이라 화면 영향 없음. 요건 미추출(`jd_not_extracted`)·추출 중(`extraction_in_progress`)도 AI-11 실패로 같은 모양으로 답한다(오류 화면 없음, AI v4.3 AI-11 "실패로 보는 경우").
- ⑥ **서류 생성 요청의 요건 상태 `[구현 결정]`** (A13): 요건 추출 중이면 기존 409 `extraction_in_progress`, 추출 전·실패면 409 `jd_not_extracted`. 둘 다 작업·공급자 호출 없음. SSE `preparing` 이벤트는 없앴다(계약에서도 삭제).
- ⑦ **키 저장의 `p_disclosure_version` `[구현 결정]`** (A20): 서버가 사용자의 최신 유효 동의 행의 버전을 넘긴다. 클라이언트가 보내는 `disclosureVersion`은 계약에 남아 있지만(등급 변경 refine 포함) 더 이상 판정에 쓰지 않는다. 화면이 보던 버전과 정확히 같아야 한다는 옛 규칙은 없어졌다.
- ⑧ **S-10 "AI 작성 대화 기록" 목록 신설** (A6): `listProjectWritingChats({ projectId })` — 그 프로젝트의 모든 상태 대화. 이전 슬라이스에는 이 목록 서비스가 없었다.
- ⑨ **재개 멱등 `[구현 결정]`** (A6): 이미 `active`인 대화의 재개는 성공으로 돌려준다(두 번 누름·다른 탭). `saved`·`handed_off`는 409 `writing_chat_not_resumable`.
