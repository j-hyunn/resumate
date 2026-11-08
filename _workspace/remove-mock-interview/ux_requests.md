# UX → 다른 팀원 요청 (v5.19, 결정 사이클 remove-mock-interview)

- 작성: ux-planner / 2026-11-08
- 기준 UX: `_workspace/02_ux-planner_flows.md` **v5.19** (짝 문서 기준 PRD v4.16 · AI v4.14 · DM v4.14)
- 결정 입력: `_workspace/00_input/planning-decisions-remove-mock-interview.md` (RM-1~RM-3, 후속 확정 RM-4·RM-5, 리더 판단 RM-A1·RM-A2·RM-A4·RM-A5 — RM-A3은 RM-4로 대체)
- 같은 내용이 UX 문서 끝의 "다른 팀원에게 요청" 절에도 있다.

이 사이클에서 UX가 바꾼 것 중 다른 문서가 받아야 하거나 UX가 확인을 기다리는 항목이다. 결정 ID를 그대로 인용한다. **반영 기준 UX: v5.19** (요청 사본은 `_workspace/remove-mock-interview/ux_requests.md`). **이 사이클은 삭제와 "4개로 줄이기"만 한다** — 새 필드·새 RPC를 요구하지 않는다.

> **(해소) v5.18 cover-letter-chat 요청 절**: data-architect 1~10은 DM v4.13이, ai-feature-designer AI-1~AI-10은 AI 명세 v4.13이 답했고 UX 본문에 반영했다. product-planner 1~7은 PRD v4.15가 받았다. 열린 채 남는 것은 사용자 몫인 CL-Q1·CL-Q2다(5.1l). 원문은 `_workspace/cover-letter-chat/ux_requests.md`.

### data-architect (데이터 모델 04) — 화면이 읽는 필드 확인

| # | 확인 요청 | UX가 쓰는 이름·모양 (v5.19) | 걸린 화면 |
|---|-----------|------------------------------|-----------|
| 1 | **보드 4열 = `stage` CHECK 4값** (RM-2) | `application_projects.stage` ∈ **`before_apply` · `document` · `assignment` · `closed`**, 열 순서도 이 순서(기본 `before_apply`). `stage_outcome`(`passed`/`failed`/null)·`stage_changed_at` 그대로. 이 4값과 순서가 DM CHECK·보드 조회와 같은지 확인해 주세요 | S-39 열·좁은 화면 탭, C-12, S-31 단계 칩, S-13 전형 단계 열 |
| 2 | **단계 이동 규칙** (RM-2) | `move_application_stage`: 4값 사이 어느 방향이든 허용, `closed`에서 나가면 `stage_outcome = null`(이전 값은 `application_stage_events.from_outcome`), 이력 `event_type = 'stage_changed'` — **규칙 자체는 바뀌지 않는다고 봤다**. 화면은 반환값의 **`interview_prompt`(옛 C-14 데이터)를 더 이상 읽지 않는다** — 키가 사라지는지 확인해 주세요 | FL-15, C-12, S-39 |
| 3 | ~~**RM-A3 이관과 전형 이력의 과거 값**~~ **(해소) DM 회신 3 — RM-4·RM-5로 대체(확정 2026-11-08, 사용자)** | 지금 `stage`가 `job_interview`·`culture_fit_interview`인 행이 없어 **이관이 없다**(drop 마이그레이션은 그런 행이 있으면 멈추는 가드만 둔다, RM-4). `application_stage_events`에 남은 면접 단계 값의 행은 **삭제**된다(RM-5) — 화면 영향 없음, S-38이 생겨도 옛 라벨이 필요 없다 | S-39(간접), S-38(예약) |
| 4 | **사용량 행 수** (RM-A2) | `ai_usage_records.feature` **6값**: `writing_chat` · `jd_extraction` · `insight` · `career_description` · `cover_letter` · `key_verification`. 화면은 `get_ai_usage_summary().providers[].by_feature[]`를 **5행**으로 접는다(`career_description` + `cover_letter` 합산). 매핑에 없는 값은 표에 보이지 않는다 — 이미 쌓인 면접 행을 drop 마이그레이션이 지우는지(RM-A2), 남는다면 `totals`에서도 빠지는지 확인해 주세요 | S-24 ② 블록 ②, S-42 |
| 5 | **데이터 충분성 판정** (RM-A5) | `get_data_readiness().features` = **`insight` · `draft` 두 키**. `job_interview`·`culture_fit_interview` 키와 `data_sufficiency` 값이 응답에서 사라지는지 확인해 주세요(`ai_connection`·`counts`·`draft_item_ids`·`hints`·`next_action`·`suggested_project_id`는 그대로 씀) | C-09, FL-13 |
| 6 | **삭제 영향 키** (RM-1, OD-I6 폐기) | `get_deletion_impact('application_project', id)`: 화면이 읽는 것은 `cascade.insights` · `cascade.documents` · `cascade.document_chats`(수는 보이지 않음)뿐 — **`cascade.interview_sessions`·`kept.interview_sessions`는 읽지 않는다**. 커리어 항목: `affected_results.by_application_project[]`의 `interview_sessions`와 **`affected_results.detached_interview_sessions`**를 읽지 않는다. `delete_results` 범위에서 "모의 면접 세션 전체"가 빠진다. 키 제거를 확인해 주세요 | C-05, FL-06 |
| 7 | **탈퇴 요약** (RM-1) | `get_account_deletion_summary()`의 면접 세션 수를 읽지 않는다. 자기소개서 묶음 = 인사이트 N · 초안(서류) N · 전형 이력 | S-25 |
| 8 | **작업·근거 값** (RM-1·RM-A2) | 화면이 쓰는 `ai_jobs.progress.stage` 문구에서 `generate`·`evaluate`·`summarize`·`score`를 지웠다(C-03). `ai_jobs.job_type`의 면접 2값, `evidence_links.source_type`의 `interview_answer`(C-01 칩 "내 답변")도 화면에서 지웠다 — CHECK 목록과 같은지 확인해 주세요 | C-01, C-03 |
| 9 | **폐기 주소** (RM-1, UX `[가정]`) | `/applications/{id}/interview…` → S-31, `/interviews…` → S-13 리다이렉트(1.2). DM 7장 API 경계 표에 면접 엔드포인트가 남아 있다면 함께 지워 주세요 | 1.2 |

### ai-feature-designer (AI 명세 03)

1. **C-03 진행 단계 문구**(RM-1): UX는 `generate`(질문 만드는 중)·`evaluate`(답변 채점 중)·`summarize`(종합 평가 정리 중)·`score`(점수 계산 중)와 채점 `prepare`("채점 준비 중") 문구를 지웠다. AI C-6 표에서도 같은 행이 빠졌는지 확인해 주세요. 남은 단계: `prepare`(인사이트) · `match` · `synthesize` · `synthesize_regen` · `validate` · `rank` · `compose` · `complete`.
2. **기능 수**(RM-A2): 사용량 표 **5행** / 저장 `feature` **6값**과 C-13.1 매핑 표가 같은지, C-18 기능 이름 목록(요건 정리 · 인사이트 · 경력기술서 · 자소서 문항 답변 · AI 작성 대화 · AI 사용량)과 AI 쪽 기능 목록이 같은지 확인해 주세요.
3. **C-21 고지 "전송되는 데이터"**(RM-1): "면접 답변"을 뺐다. AI 명세 고지 사실 표에서도 빼고, 보내는 범위가 줄어 재동의가 필요 없다는 UX `[가정]`에 이의가 있으면 알려 주세요.
4. **C-20 입력 원인 이동 표·대기 재시도**(RM-1): 면접 질문 생성·채점 행을 지웠고, 대기 재시도를 하는 비동기 작업은 **인사이트만** 남았다고 적었다. C-11.3과 같은지 확인해 주세요.

### product-planner (PRD 01) — 요청 1~8 회신

1. **(반영) 면접 화면**: 실제 번호는 **S-20 면접 준비 · S-22 면접 결과 · S-33 면접 답변지 · S-37 모의 면접(전체 세션)**이었다. 네 화면을 명세째 지우고 번호는 비워 뒀다. **S-39는 면접 화면이 아니라 지원 현황 보드라 남겼다**(4열로 개정).
2. **(반영) 플로우·진입점**: FL-04·FL-12·FL-16·FL-17을 지웠고, F-ST-04 팝업 C-14와 그 키 없음·작성 중 세션 변형, S-31 면접 카드·단계 칩의 C-14 분기, S-39 카드 면접 횟수를 지웠다.
3. **(반영) 메뉴 3개**(RM-A4 `[가정]`): 커리어 / 자기소개서 관리 / 지원 현황, 순서 그대로. 모의 면접 메뉴 배지도 지웠다.
4. **(반영) 보드 4열**(RM-2): 지원 전 / 서류 전형 / 과제 전형 / 전형 종료. 보드에 AI 잠금 상태가 하나도 남지 않는다(S-39 "AI" 줄).
5. **(회신) 점수 표시의 다른 소비자 없음**: C-17은 S-22·S-20·S-37·S-31 면접 카드만 썼다 — PRD 판단과 같다. 지웠다. 면접 전용 ST-xx ID는 원래 없었다(상태는 화면 안에만 있었다). **남긴 공통 요소와 근거는 5.1m RM-A1 행**.
6. **(회신, v5.19 R-RM-5 정정) 데이터 충분성 등급 중 면접 전용은 `none` 수준과 readiness 응답의 `data_sufficiency` 키뿐이다**: `get_data_readiness()`의 `data_sufficiency`는 `culture_fit_interview` 분기에만 있었다(DM 6장 예시와 같음). **`ok`/`thin` 등급과 S-16 인사이트 배너(`thin`)는 그대로 유지한다**(AI-02 출력, AI C-1). 게이트는 남겼다(RM-A5).
7. **(반영) 사용량 표 7행 → 5행**, AI 연결 안내에서 "모의 면접" 삭제(S-24 ② 블록 ①·S-40 안내).
8. **(반영) "면접 진행 여부"·C-05 끝난 면접 문구**: S-13 기능 진행·S-31·S-39 카드에서 면접 표시를 지웠고, C-05의 "끝난 모의 면접 N개는 기록에 남아요"와 그 셈법(OD-I6)을 지웠다.
9. **(확인 필요) UX `[가정]` 3건**: 폐기 주소 리다이렉트(1.2), C-21 재동의 불필요, 실행 버튼 예시 문구 교체 — 5.1m 마지막 표.

### spec-reviewer

- 이 판(UX v5.19)과 PRD v4.16 · AI v4.14 · DM v4.14를 교차 확인해 주세요. **검사 기준은 "남아 있는지"**입니다:
  1. 1~4장(유효 명세)에 면접 화면·플로우·진입점·`job_interview`·`culture_fit_interview`·`interview_*` 값이 살아 있지 않은지. **정당한 잔존**은 ① 상태 줄 아래 "이전 상태" 인용, ② 이 사이클의 삭제 기록(폐기 표기 행·`~~ID~~` 제목·"(v5.19, RM-n) … 삭제" 주석), ③ 5장 결정 반영 표(5장 첫머리 안내로 무효 처리), ④ 6장 변경 이력이다.
  2. 지원 단계가 **네 문서 모두 4개**인지 — UX S-39 열 ↔ C-12 ↔ DM CHECK ↔ 이동 RPC.
  3. 사용량 표 **5행** / 저장 `feature` **6값**이 PRD F-AI-07 (2)·AI C-13·DM과 같은지.
  4. **지운 ID가 재사용되지 않았는지**: S-20·S-22·S-33·S-37, C-14·C-16·C-17, FL-04·FL-12·FL-16·FL-17.
  5. `[가정]` 표식: RM-A1·RM-A2·RM-A4·RM-A5와 UX가 새로 정한 3건(5.1m)에 붙어 있는지(RM-A3은 RM-4·RM-5로 확정돼 `[가정]`이 아니다).
