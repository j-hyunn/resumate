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
