# 데이터 모델 → 다른 팀원 회신 (DM v4.14, 결정 사이클 remove-mock-interview)

- 작성: data-architect / 2026-11-08
- 기준 데이터 모델: `_workspace/02_data-architect_data-model.md` **v4.14** (짝 문서 PRD v4.16 · UX v5.19 · AI v4.14)
- 결정 입력: `_workspace/00_input/planning-decisions-remove-mock-interview.md` (RM-1~RM-3, 후속 확정 RM-4·RM-5, 리더 판단 RM-A1·RM-A2·RM-A4·RM-A5 `[가정]`)
- 같은 내용이 데이터 모델 끝 "요청 회신" 절에 있다. 백엔드 후속(drop 마이그레이션 요건·바뀌는 RPC·법무 `policy_versions`)은 데이터 모델 **11.9**.


> 받은 요청: `_workspace/remove-mock-interview/prd_requests.md`(data-architect 1~8), `ux_requests.md`(data-architect 1~9), `ai_requests.md`(data-architect 1~8). 같은 내용이 `_workspace/remove-mock-interview/dm_replies.md`에 있다. 이 사이클은 **삭제와 "4개로 줄이기"만** 했다 — **이름이 바뀐 필드·테이블·RPC는 없다.** 새 필드·새 RPC도 없다. 지난 사이클(v4.13 cover-letter-chat, 39건)의 회신 원문은 `_workspace/cover-letter-chat/dm_replies.md`에 있다.
>
> **결정 입력 5장의 후속 확정이 RM-A3을 대체했다**: RM-4(지금 면접 단계 행은 없다 — 이관 규칙 없이 **있으면 멈추는 가드**만), RM-5(전형 이력의 면접 단계 값 행은 **삭제**). 그래서 PRD 요청 6이 요구한 `[결정 필요]` 표시와 (a) `document` / (b) `closed` 두 안은 **두지 않았다**.

### → product-planner (8건)

| # | 요청 | 회신 |
|---|------|------|
| 1 | 면접 엔티티 전체 폐기, 순수 테이블 수 다시 세기 | **적용** — A.12·A.13 자리를 비우고(번호 재사용 없음) 2.7·2.7.1·2.7.2·ERD에서 지웠다. **순수 MVP 사용자 테이블 = 22**(9장). ⚠ **v4.13의 "28"은 셈 오류였다** — 29 − 3(`drafts` 계열) + 1(`application_documents`) = **27**이고, 여기서 면접 5개를 빼 **22**다. PRD에 테이블 수를 적은 자리가 있으면 22로 맞춰 달라 |
| 2 | 면접 RPC·트리거·grant 폐기 | **적용** — 함수 public 16 + private 28, 다른 테이블에 걸린 트리거 2개(`application_projects_detach_interviews`·`ai_jobs_release_interview`), 정책 12, `authenticated`·`app_ai_writer` grant 전부(11.9 (1) 6·7단계, 이름은 마이그레이션 grep) |
| 3 | RM-3 drop 마이그레이션 요건 | **적용** — 11.9 (1). 첫 줄 `-- DESTRUCTIVE:`, 가드 → 근거·작업·사용량·전형 이력 행 삭제 → 테이블 → 함수 → CHECK 재정의 → OD-I6 되돌리기 순서, `supabase db push`는 사용자 |
| 4 | 열거 값 제거 | **적용** — ⚠ **이름 정정**: 요청의 "`evidence_links` 출처 타입 `interview_question`·`interview_answer`"에서 **`interview_question`은 출처(`source_type`)가 아니라 소유자(`owner_type`) 값**이다. 지운 값은 `source_type` = `interview_answer` 하나, `owner_type` = `interview_question`·`answer_evaluation`·`session_feedback` 셋이다(2.8). `ai_jobs.job_type`(그리고 같은 목록인 `ai_usage_records.job_type`) 11 → 9, `ai_usage_records.feature` CHECK 10 → 8. 기존 행은 drop 마이그레이션이 지운다 |
| 5 | 지원 단계 4개, `INTERVIEW_STAGES` 폐기 | **적용** — `application_projects.stage`·`application_stage_events.from_stage`/`to_stage` CHECK = `before_apply`·`document`·`assignment`·`closed`(2.6). `move_application_stage`는 4값 검사 + `interview_prompt` 반환 삭제, 보드 조회·인덱스는 그대로. `INTERVIEW_STAGES`는 DB가 아니라 코드 상수라 11.9 (3)에 적었다 |
| 6 | RM-A3 기존 단계 데이터 이관 `[결정 필요]` | **RM-4·RM-5(사용자 확정 2026-11-08)로 대체** — 이관 규칙 없음, 면접 단계 행이 있으면 마이그레이션이 **멈춘다**(RM-4). 전형 이력의 면접 단계 값 행은 **삭제**(RM-5, 2.6). `[결정 필요]` 표시와 두 안 비교는 두지 않았다. **PRD 9.9의 RM-A3 행을 RM-4·RM-5로 고쳐 달라** |
| 7 | 삭제·보존 정책의 면접 분기 제거, OD-I6 폐기 | **적용** — 4.1 지원 프로젝트 행(하위 전부 cascade, 남는 것은 `ai_usage_records`의 null 프로젝트뿐), 4.2 `get_deletion_impact`·`delete_career_item`의 면접 키·분기, 4.3 탈퇴 요약 키, 4.5 길이 상한 행, 2.7.2 OD-I6 전체(트리거·복사 컬럼·`evidence_links.application_project_id` null 허용 되돌림). 보관 정리 크론은 원래 면접 테이블을 다루지 않았다(변경 없음). **장기 미접속 파기(4.6)는 `private.delete_account_data`를 탈퇴와 공유**하므로 그 함수 교체가 필수다(11.9 (2)) |
| 8 | `get_data_readiness()` 면접 분기 제거, 면접 전용 등급 삭제 | **적용, 단 범위를 좁혔다** — 응답 `features` = `insight`·`draft` 두 키, `data_sufficiency`는 **readiness 응답에서 사라진다**. 그러나 등급 `ok`/`thin`은 면접 전용이 아니다 — **AI-02 인사이트 출력**(`data_sufficiency.level`, 보완 안내 배너)이 쓴다(AI 요청 5·AI C-14). 면접 전용이던 것은 **`none` 수준뿐**이라 그것만 지웠다(6장). **PRD 9.9 RM-A1 문구 "데이터 충분성 등급(면접 전용)"을 "등급 중 `none`(JD만)"으로 좁혀 달라**(AI 요청 product-planner 2와 같은 요청) |

### → ux-planner (9건)

| # | 확인 요청 | 회신 |
|---|-----------|------|
| 1 | 보드 4열 = `stage` CHECK 4값 | **일치** — `before_apply`·`document`·`assignment`·`closed`, 이 순서, 기본 `before_apply`. `stage_outcome`(`passed`/`failed`/null)·`stage_changed_at`·보드 인덱스 `(user_id, stage, stage_changed_at desc)` 그대로(2.6) |
| 2 | 단계 이동 규칙, `interview_prompt` 키 | **규칙 그대로, 키는 사라진다** — 반환 `{stage, stage_outcome, stage_changed_at, changed}`. 이동 안 함(`changed: false`) 응답의 `'interview_prompt': null`도 없어진다(2.6, 11.9 (2)) |
| 3 | RM-A3 이관과 이력 과거 값 | **RM-4·RM-5로 대체** — 이관이 없으므로 "이관 결과를 그 열에 그린다" `[가정]`은 대상이 없다(면접 단계 행이 0). 이력의 면접 단계 값 행은 **삭제**되어 남지 않는다 → S-38이 생겨도 옛 라벨이 필요 없다 |
| 4 | 사용량 행 수 | **일치** — 저장 `feature` MVP **6값**(`writing_chat`·`jd_extraction`·`insight`·`career_description`·`cover_letter`·`key_verification`) + Should 2 = CHECK 8, 화면 5행(`career_description` + `cover_letter` 합산). 이미 쌓인 면접 행은 drop 마이그레이션이 **지운다**(RM-A2 `[가정]`) → `by_feature`에도 `totals`에도 남지 않는다. 그 대신 이번 달 합계가 면접 사용분만큼 줄어든다(AI 요청 2 — 사용자 확인 대상) |
| 5 | 데이터 충분성 판정 | **일치** — `features` = `insight`·`draft`. `job_interview`·`culture_fit_interview` 키와 `data_sufficiency` 값이 응답에서 **없어진다**(null이 아니라 키 없음). `ai_connection`·`counts`·`draft_item_ids`·`hints`·`next_action`·`suggested_project_id` 그대로(6장) |
| 6 | 삭제 영향 키 | **일치** — `application_project`: `cascade.interview_sessions`·`kept` 삭제 → `{cascade: {insights, documents, document_chats, stage_events}}`(⚠ 11.8 미구현인 지금 마이그레이션의 키 이름은 아직 `drafts`). 커리어 항목: `affected_results.by_application_project[]`의 `interview_sessions`와 `affected_results.detached_interview_sessions` 삭제, `delete_results` 범위에서 면접 세션 삭제 분기 삭제(4.2) |
| 7 | 탈퇴 요약 | **일치** — `get_account_deletion_summary()`의 `interview_sessions` 키 삭제. 자기소개서 묶음 = 지원 프로젝트 수 · 인사이트 · 서류(옛 초안) · 전형 이력(4.3) |
| 8 | 작업·근거 값 | **일치** — `ai_jobs.job_type` 9값, `evidence_links.source_type`에서 `interview_answer` 삭제. `progress.stage` 문구는 **DB CHECK가 없는 앱 상수**라 DM 목록은 없다(11.9 (3)) |
| 9 | 폐기 주소, 7장 면접 엔드포인트 | **적용** — 7장의 "면접 전체 세션 조회" 행, 2.7.1의 다시 채점 라우트 `POST /api/interview-sessions/{id}/evaluation/retry`, 2.9.1의 면접 새 작업 경로를 지웠다. 리다이렉트는 화면 몫이라 DM에 행을 두지 않는다(11.9 (3)에 메모) |

### → ai-feature-designer (8건)

| # | 요청 | 회신 |
|---|------|------|
| 1 | `job_type` 2값 삭제, 면접 `target_type` | **적용** — 9값(요청 목록과 같다). `target_type = 'interview_session'`도 지웠다 — `target_type`에는 **전역 CHECK가 없어** 값 목록에서만 지우고, 그 행은 작업 행 삭제로 사라진다(2.9.1). ➕ **`ai_usage_records.job_type` CHECK도 같은 9값**이다(구현이 두 CHECK를 함께 바꾸게 되어 있다 — 요청에 없던 자리) |
| 2 | `feature` 2값 삭제, 이번 달 합계 감소 `[가정]` | **적용, 행 삭제안 채택** — CHECK 8(MVP 6 + Should 2), 화면 5행. **DM 입장: 지우는 쪽이 맞다.** 남기고 CHECK만 새 행에 거는 안(SD-A19 패턴)은 행이 `totals`에 남는데 5행 매핑에 없어 **표 합계와 총액이 어긋난다**(2.9.5가 이미 Should 값에 대해 경고한 그 불일치). 면접을 쓴 사용자가 적고 금액이 작다는 판단(UX 요청 4의 AI 권고)에도 동의한다. 사용자 확인 대상으로 올린다 `[가정]` |
| 3 | `evidence_links` 값 삭제 | **적용** — `source_type` `interview_answer`, `owner_type` 면접 3값을 CHECK에서 빼고 행을 지운다(남기고 막는 패턴을 쓰지 않는 이유에 동의 — 보일 화면이 없다). ⚠ **DM 2.8 v4.13 서류 근거 표의 "자소서 문항 허용 출처 … `interview_answer`"는 문서 오류였다** — 구현 허용 목록(`20261113002600`)은 `user_note`만 받는다. 지웠다. 마이그레이션은 면접 소유자가 아닌 `interview_answer` 출처 행이 있으면 멈춘다(0행이어야 함, 11.9 (1) 2단계) |
| 4 | `return_target.feature`에서 `job_interview`, 기존 대화는 null `[가정]` | **적용, 권고 채택** — 남는 값 `insight`·`career_description`·`cover_letter` 3개(CHECK `writing_chats_return_target_check`, `start_writing_chat` 인자 검사, 게이트 진입 인사 문구). 기존 `job_interview` 대화는 **`return_target`만 null**, 대화·메시지·제안은 그대로(11.9 (1) 5단계). 대화는 커리어 데이터를 만드는 기록이고 프로젝트에 묶여 있어 면접과 함께 지울 근거가 없다는 판단에 동의한다. 화면은 "돌아가기" 버튼만 안 보인다 `[가정]` |
| 5 | `get_data_readiness()` 면접 분기만, `none`만 삭제 | **적용** — 6장. `data_sufficiency`는 readiness 응답 값이 아니게 되고(그 값은 `culture_fit_interview` 키에만 있었다), `ok`/`thin`은 AI-02 출력(`insights.result` jsonb)에 남는다. DB에 등급 CHECK는 없다 — 유일한 CHECK였던 `interview_sessions_data_sufficiency_check`는 테이블과 함께 사라진다. `thin`의 정의는 AI C-1·C-14 AI-02 행을 따른다(DM은 정의를 복제하지 않는다) |
| 6 | 자리 표시 6종 → 5종 | **DM 변경 없음** — 토큰 목록을 가진 DB 상수·CHECK가 없다(블록의 `placeholders[]`는 자유 배열, `validation_report`는 jsonb). 서버 검증 상수는 ai-pipeline 몫 |
| 7 | `app_ai_writer` grant | **적용** — 면접 테이블 select grant·`*_select_ai_writer` 정책·결과 저장 RPC execute가 테이블·함수와 함께 사라진다(5장). 새 권한 없음 |
| 8 | 재집계 확인 | **전부 일치** — `ai_jobs.job_type` 9 / `ai_usage_records.feature` CHECK 8(MVP 6 + Should 2) / 화면 5행 / 비동기 작업 AI-02 하나 / `source_type` −1(`interview_answer`) / `owner_type` −3. ➕ DM 쪽 추가 셈: `ai_usage_records.job_type` 9, MVP 사용자 테이블 22(v4.13 셈 오류 정정 포함), 지원 단계 4 |

### 다른 문서가 고쳐야 하는 이름·숫자 (리더 전달용)

| 문서 | 자리 | 지금 | 고칠 값 |
|------|------|------|---------|
| PRD v4.16 | 요청 data-architect 4 (그리고 같은 문장이 본문에 있으면) | "`evidence_links`의 출처 타입 `interview_question`·`interview_answer`" | 출처 `source_type` = **`interview_answer`**, 소유자 `owner_type` = **`interview_question`·`answer_evaluation`·`session_feedback`** |
| PRD v4.16 | 9.9 RM-A3 | 기존 면접 단계 행을 `document`로 `[가정]` | **RM-4·RM-5(확정 2026-11-08)** — 이관 없음 + 가드, 이력 행 삭제 |
| PRD v4.16 | 9.9 RM-A1 | "데이터 충분성 등급(면접 전용)" 삭제 | 등급 중 **`none`(JD만)**만 삭제, `ok`/`thin`은 AI-02가 쓴다 |
| PRD·UX·AI | 테이블 수를 적은 자리(있으면) | 28 | **22** |
| UX v5.19 | 요청 data-architect 3, 5.1m RM-A3 행 | 이관 결과(`document`/`closed`)를 그 열에 그린다 `[가정]` | 이관 없음(RM-4) — 그 `[가정]`은 대상이 없다 |
| UX v5.19 | 요청 data-architect 6 | `cascade.documents` | 맞다 — 단 지금 구현 키는 11.8 전까지 `drafts` |

### spec-reviewer
- DM v4.14의 **정당한 잔존**(면접 서술이 남는 자리): ① 머리글 상태 줄의 "이전:" 판 요약과 **10장 변경 이력** ② **11.1~11.8 지난 사이클 백엔드 후속**(역사 기록 — 11.6 머리에 "효력 없음" 표시) ③ **3.5~3.7 이름 확정 표**의 근거 열(과거 비교 대상) ④ 이 사이클의 **삭제 기록**(`~~…~~ (v4.14 폐기, RM-n)` 제목·행, 8장 결정 표의 "효력 없음" 행) ⑤ **11.9 백엔드 후속의 지울 대상 목록** ⑥ 이 회신 절.
