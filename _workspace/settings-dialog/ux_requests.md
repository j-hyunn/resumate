# ux-planner 요청 — 결정 사이클 `settings-dialog` (UX v5.17)

이 사이클에서 UX가 정한 것 중 다른 문서가 받아야 하거나 UX가 답을 기다리는 항목이다. 결정 ID를 그대로 인용한다. **반영 기준 UX: v5.17** (요청 사본은 `_workspace/settings-dialog/ux_requests.md`).

### data-architect (데이터 모델 04)

1. **내 정보 새 필드 이름 확정** (`[결정 필요]` D-UX-29, SD-A2·SD-A4·SD-5). S-24 ① 계정 탭이 쓰는 값이고 지금은 전부 `[가정]`입니다:
   - 구직 상태 `profiles.job_search_status` `[가정]` — 단일 선택, 값 목록은 PRD 9.7 (1)
   - 관심 기업군 `profiles.interested_company_type` `[가정]` — 단일 선택, PRD 9.7 (2)
   - 관심 산업 — 현행 `profiles.interested_industries`(`text[]`)가 **단일 선택으로 바뀝니다**(SD-A4). 컬럼을 단일 값으로 바꿀지(`interested_industry`), 배열을 유지하고 화면에서만 1개로 제한할지와 **기존 다중 값 처리**를 정해 주세요
   - 관심 직군·직무 **쌍 최대 3개**(SD-A3 `[가정]`) — 별도 테이블(예: `profile_job_interests(user_id, job_family, job_role, sort_order)`)인지 `profiles`의 jsonb인지. 저장은 **쌍 전체 덮어쓰기**로 쓰고 싶습니다
   - 최종 학력 6칸: 학교 명 · 학위 · 졸업 상태 · 기간(시작·종료 연월) · 전공 · 학점. **설정 전용 값이고 `educations`와 동기화하지 않습니다**(SD-5, F-P1-01a) — 평면 컬럼(`highest_education_*`)인지 jsonb인지, **학점은 자유 입력 text**로 둡니다
   - 각 text 칸의 **길이 상한**(학교 명·전공·학점)을 알려 주세요 — 검증 문구에 숫자를 넣어야 합니다
2. **폐기할 컬럼** (SD-2·SD-A2): `profiles.total_years_of_experience`는 어떤 화면에도 입력·표시가 없어졌습니다(SD-2). `profiles.desired_job_title`도 자유 입력 칸이 없어지고 관심 직군·직무 쌍이 대신합니다 `[가정]` — 두 컬럼을 폐기할지, 과거 값을 읽기만 할지 정해 주세요. 데이터 준비 판정의 **`profile_filled`**(현행 = `desired_job_title` / `total_years_of_experience` / `interested_industries` 중 하나)도 함께 손봐야 합니다 — 내 정보는 **어떤 게이트 판정에도 쓰지 않기로** 했으므로(F-P1-01 (4)) 이 값을 없애거나 게이트에서 떼어 주세요.
3. **내 정보 저장 RPC** (SD-A2): 계정 탭은 **섹션 단위 저장**(이름 + 셀렉트 + 쌍 목록 + 최종 학력을 한 번에)입니다. 쌍 목록 덮어쓰기를 포함한 저장 RPC 하나와, 다른 탭·기기에서 먼저 저장된 경우를 알리는 **기대 버전(`stale_write`)** 처리를 S-10·S-44 페이지 저장과 같은 모양으로 둘 수 있을지 알려 주세요.
4. **사용량 공급자 × 기능 교차 집계** (`[결정 필요]` D-UX-30, SD-A10). 현행 `get_ai_usage_summary`의 `by_feature`·`by_provider`(교차 없음)를 **고른 공급자의 기능별 행**으로 대체해야 합니다. 필요한 값: 공급자별·기능별 **입력 비용 / 출력 비용 / 호출 수 / 입력 토큰 / 출력 토큰**, 그 공급자의 `connection_tier`(무료 등급 안내용), 가격표 `version`·`source_checked_at`. 표시 행은 7개지만 **저장되는 `feature` 값 8개는 그대로**이고 `career_description` + `cover_letter`를 **한 행으로 합산**합니다(SD-4·SD-A12) — 합산을 RPC가 할지 화면이 할지 정해 주세요.
5. **AI 데이터 처리 문서 버전** (`[결정 필요]` D-UX-31, SD-A13). `/policies/ai_data_use` 페이지도 S-30의 다른 세 문서처럼 "버전 {version} · 시행일 {effective_at}"을 보입니다. `policy_versions`에 `policy_type = 'ai_data_use'` 행을 더하는지, `ai_disclosures` 버전을 그대로 쓰는지 알려 주세요. 참고로 `consents.consent_type`·`policy_type` CHECK에 값이 늘어날 수 있습니다.
6. **선택 동의 토글** (SD-A15): 기존 `consents`의 `service_improvement`·`marketing`에 그대로 붙입니다(켜면 새 행, 끄면 `withdrawn_at`). 변경 없습니다 — 확인만 부탁합니다.

### ai-feature-designer (AI 명세 03)

1. **사용량 기능 이름 표기** (SD-4·SD-A12): 저장되는 `feature` 값 8개는 그대로 두고 **표시 이름·묶음만** 새 화면에 맞췄습니다. UX가 쓰는 표기는 `writing_chat` → "프로젝트/산출물 작성 AI 채팅", `jd_extraction` → "요건 추출", `insight` → "인사이트", **`career_description` + `cover_letter` → "자기소개서 작성 AI 채팅"(한 행 합산)**, `interview_questions` → "면접 질문", `interview_evaluation` → "면접 채점", `key_verification` → "연결 확인"입니다. AI 명세의 기능 이름 표도 같은 표기로 맞춰 주세요. **자기소개서 작성의 채팅형 전환 자체는 이 사이클 밖입니다**(SD-4).
2. **profile 근거 칩** (SD-6): 내 정보 값을 **어떤 프롬프트에도 보내지 않기로** 했으므로, `evidence_links`의 `source_type = 'profile'` 근거는 **새 결과에서는 생길 수 없다**고 보고 C-01에 그렇게 적었습니다 `[가정]`. 맞는지, 그리고 `profile`을 근거 종류에서 완전히 빼는지(과거 기록만 남기는지) 알려 주세요 — C-01 칩 라벨과 C-02 원본 이동(현재는 설정 계정 탭을 엽니다)의 처리가 거기 달려 있습니다.
3. **연차 요건 판정** (SD-2): `total_years_of_experience`가 입력에서 사라졌으니 연차 요건은 **등록된 경력 기간에서 계산한 값만**으로 판정합니다(PRD F-P2-04). S-16 인사이트 화면 문구에 연차 관련 안내가 생기면 알려 주세요.
4. **키 확인 호출의 사용량 집계**(현행 `[가정]` 유지): 사용량 표의 "연결 확인" 행은 그대로입니다.

### product-planner (PRD 01)

1. **필수 동의 기록**(SD-A14 / SD-Q3 (다)): PRD 권고대로 약관 탭에 **남겨 두고 `[결정 필요]`로 표시**했습니다. 사용자 확정이 나오면 알려 주세요.
2. **`/career/profile` 리다이렉트**(SD-A2): S-04 폐기 후 기존 주소를 커리어로 보내고 설정 계정 탭을 함께 여는 처리를 `[가정]`으로 정했습니다. 제품 쪽에서 다른 뜻이 있으면 알려 주세요.
3. **희망 직무(`desired_job_title`) 폐기**: 새 화면에 자유 입력 칸이 없습니다. 관심 직군·직무 쌍이 그 역할을 완전히 대신하는지 확인 부탁합니다(F-P1-01 (1)에 "희망 직무"가 없어 그렇게 읽었습니다).
