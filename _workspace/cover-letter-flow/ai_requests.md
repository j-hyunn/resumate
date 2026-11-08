## 다른 팀원에게 요청 (v4.14, 결정 사이클 cover-letter-flow)

이번 판에서 AI 명세가 바꾼 것 중 다른 문서가 받아야 하는 항목이다. 결정 ID를 그대로 인용한다. **반영 기준 AI 명세: v4.14.** 같은 내용이 `_workspace/cover-letter-flow/ai_requests.md`에도 있다. DM v4.14가 리더를 통해 이미 정한 이름(`POST /api/job-descriptions/fetch`·`fetch_*` 5종, `POST /api/job-descriptions/extract-preview`·`target_type = 'jd_preview'`·`p_preview_job_id`, `structured_draft.document.questions[].draft.answer_title`, `formSnapshot.questions[].answer_title`, `p_source_url`, AI-11·`document.source_ranking` 폐기)은 본문에 그대로 썼다.

### data-architect (데이터 모델 04)

1. **(해소 — DM v4.14 2.6.2) 미리 보기 추출의 작업 기록 모양** (CF-A17): `POST /api/job-descriptions/extract-preview`, `ai_jobs`(`job_type = 'jd_extraction'`, `target_type = 'jd_preview'`, `target_id`·`application_project_id` null, `params.raw_text_hash`, `output`), 사용량 `jd_extraction` 1행(지원 건 null → 생성 때 채움), 생성 RPC `p_preview_job_id`. AI-01 카드를 이 이름으로 맞췄다. 남은 확인 1건: 모달을 닫아 쓰이지 않은 `jd_preview` 작업 행의 정리(보관 기간·삭제) — 사용량 행은 남아야 한다.
2. **(해소) 미리 보기 결과의 신뢰 경계**: 요건을 서버(`ai_jobs.output`)가 들고 있으므로 처음 권고했던 서버 서명은 필요 없다. 확인 1건: `params.raw_text_hash`는 **C-2 문장 분할 입력과 같은 정규화**(줄바꿈·공백 처리)를 거친 원문으로 계산해 주세요 — 해시가 같으면 분할·`source_sids`가 같아야 결과를 재검증 없이 적용할 수 있다.
3. **`apply_jd_extraction`의 마감일 쓰기** (CF-2·CF-A5): `application_projects.deadline`이 **null일 때만** 검증 통과 `deadline`을 쓴다(사용자 값 덮지 않음, 재추출도 같음). 원본은 `job_descriptions.extraction.deadline`(jsonb, `{value, source_sids}`). 지난 날짜·366일 초과는 쓰지 않는다 `[가정]`. 출처 표시(`deadline_source`)는 **(해소 — DM v4.14) 두지 않는다**. 생성과 함께 적용되는 미리 보기 결과의 마감일도 같은 규칙이다.
4. **AI-01 `extraction` 스키마 1 → 2**: `job_descriptions.extraction`의 `schema_version`이 2가 된다(`deadline` 추가). 과거 1판 행은 `deadline` 없음으로 읽는다.
5. **`answer_title`** (CF-6·CF-A4): 정본 `body.questions[].answer_title`(≤ 100자, null) · 제안 `structured_draft.document.questions[].draft.answer_title`(string|null). AI 쪽 계약: ① 제목에는 **`evidence_links` 행을 만들지 않는다**(제목에 자기 근거가 없다) ② `char_count`·`char_limit_at_generation`·`char_adjust_needed`에 넣지 않는다 ③ `user_modified` 판정에 넣지 않는다 ④ 저장 RPC의 100자 초과는 `field_too_long`(details `questions.q_n.answer_title`) 권고 ⑤ [반영]은 제안에 제목이 있을 때만 제목 칸을 채운다(AI는 빈 제목 문항에만 제안 — `[가정]`). **(해소 — DM v4.14)** `structured_draft` 자소서 모양의 `schema_version`은 1 유지.
6. **(해소 — DM v4.14 회신과 같음) 과거 `career_description` 사용량 표시**: "자기소개서 작성 AI 채팅" 행에 화면에서 계속 합산한다(C-13.1).
7. **`job_type` 값 목록** (CF-1): `career_description`·`draft_source_ranking`은 새 작업이 없다(과거 행만). CHECK에 남길지와 `ai_jobs` 조합 CHECK(`job_type in ('career_description','cover_letter')` ⇒ `application_project_id` not null)의 정리는 DM 소관이다. "대화 턴" 집계는 과거 행 때문에 `career_description`을 계속 포함해야 한다(C-13.1).
8. **게이트 복귀 대상** (C-1): `writing_chats.return_target.feature`의 새 값은 `cover_letter`뿐이다(`career_description`은 과거 행).
9. **문항 상한** (CF-5): AI 쪽은 정본 슬롯 상한을 문항 ≤ 5로 읽는다(AI-04·C-14). 섹션 ≤ 30(경력기술서)은 새 행에서 없어진다.

### ux-planner (UX 02)

1. **[다음]의 대기와 실패** (CF-A6·CF-A17, PRD 6.4): AI-01 p90 15초 목표는 그대로이고 재는 구간이 [다음] → 2단계 표시다. URL이면 가져오기(≤ 10초)가 앞에 붙어 최악 약 25초 — "공고 가져오는 중" → "공고 요건 정리 중"(C-03) 단계 표시를 권고한다 `[가정]`. AI-01이 실패·시간 초과면 **AI 값 없이 2단계로 넘어간다**(`JobPosting` 값 또는 빈 칸) `[가정]`. 동의 필요·키 무효(409)는 **2단계로 넘어가지 않는다** — Q53-1 유지, C-21 동의 / 키 교체 뒤 [다음] 다시(입력 보존). "AI 없이 계속"은 `[결정 필요]` CF-U1 선택지로만(v4.14, 리더 후속).
2. **2단계에서 공고 내용을 고쳤을 때**: 미리 받은 요건·마감일은 버리고 생성 후 1회 재추출한다(키 있을 때). 사용자에게 알릴지(예: "공고 내용을 고쳐 요건을 다시 정리할게요")는 UX 판단이다.
3. **마감일**: AI 추출 마감일은 2단계에 보이지 않고 문항 설정의 마감일 칸에 미리 채워진다(빈 값일 때만). 지난 날짜는 채우지 않고 `extraction.warnings`에 "공고의 마감일(YYYY-MM-DD)이 이미 지났어요"가 남는다 — 보일지 UX 판단. 날짜가 여러 개라 비운 경우도 `warnings`가 있다.
4. **`draft_done`에 문항별 `answer_title`** (CF-6): 제목은 `draft_block`으로 스트리밍하지 않고 `draft_done`에만 온다(검증이 보정 뒤 본문 기준). 값이 null이면 제안 없음(현재 제목이 있거나 검증에서 버림). 버린 경우 AI 메시지에 "{n}번 문항 제목은 확인되지 않는 내용이 있어 넣지 않았어요 — 직접 써 주세요"가 온다. 제안 카드에 제목을 본문 위에 보이고 [반영]이 제목 칸도 채우는 모양을 권고한다. `adjusting_length`의 글자 수에는 제목이 없다.
5. **사용자가 쓴 제목은 AI가 덮지 않는다** `[가정]`: AI는 현재 제목이 빈 문항에만 제안한다 — 새 제목을 받고 싶으면 사용자가 제목을 지우고 다시 제안을 요청한다. 칩으로 "제목 다시 지어 줘"를 둘지는 UX 판단(두면 AI-04 정리 호출의 대상 지정이 필요해 프롬프트가 바뀐다 — 이 판은 두지 않는 쪽으로 썼다).
6. **첫 턴 문구** (CF-5): 문항이 3개 이하면 "먼저 1~3번 문항을"이 맞지 않으므로 "모아 둔 커리어로 **바로 초안을** 만들어 드릴까요?" `[가정]`. 5문항이면 두 번째 초안 턴 칩은 "남은 4~5번 문항 초안 만들기"가 자연스럽다.
7. **경력기술서 관련 SSE·카드 모양 폐기** (CF-1): 섹션 단위 제안, `section_order_proposal`, 경력기술서 칩 표, AI-11 근거 목록 카드("이 경력·프로젝트로 쓸게요", `progress.stage = rank`)는 대상이 없다.

### product-planner (PRD 01) — `prd_requests.md` AI 7건 회신

1. **AI-03 폐기** — 반영(3장 폐기 절, 공유 규칙은 AI-04로 이동). **AI-11도 폐기 `[가정: CF-1의 귀결]`**(호출처가 AI-03뿐, DM도 같은 결론) — PRD에 AI-11·"근거 자동 선택"·"AI-11 경험 정렬"(F-AI-03 (2), F-P2-02, D-30 "서류 3종")이 남아 있으면 걷어 주세요.
2. **`deadline`** — 반영(AI-01 카드: 추출 규칙·서버 검증·빈 값일 때만 쓰기). C-6 순서는 "모달 [다음](미리 보기 실행) → 문항 설정 '작성 시작'(보충)"으로, 6.4 "JD 요건 추출 15초"는 **[다음] → 2단계 표시 구간**의 AI-01 p90 15초로 읽어 주세요(URL이면 가져오기 ≤ 10초가 앞에 붙음).
3. **`answer_title`** — 반영(AI-04). 글자 수 90~110%는 본문만, 제목은 세지 않고 보정에서 뺀다. 제목에도 숫자 가드·고유명사·민감정보 검사가 걸리고 걸리면 제목만 버린다. 제한 값은 사용자 입력값.
4. **CL-Q1 재계산**(7.3a): 예시 월 **(b) 약 $1.7~2.0(계산값 $2.04) / (a) 약 $1.8~2.0 — (a)가 (b)보다 월 약 $0.005~0.20 적다**. 초안 턴 비중 **약 81%**("81~83%" → "약 81%"). **자소서 3문항 대화 $0.37 행은 그대로**다. 참고로 5문항 한 바퀴는 약 $0.34(다시 제안 1회 더하면 약 $0.40~0.49) `[가정]`. CL-Q1은 `[결정 필요]`·본문 기준 (b) 그대로.
5. **과거 `career_description` 표시** — 같은 표시 행에 화면에서 계속 합산(AI 권고 = DM v4.14 회신, C-13.1).
6. **URL 가져오기 품질** — 평가 세트에 넣는다(6장 "JD 추출 세트 보강": 사이트별 가져오기 결과 10건 이상 `[가정]`, 주변 글이 요건이 된 비율 5% 이하 `[가정]`, `not_a_jd` 오판 0건, 다른 공고 마감일 0건). AI-01 카드에 주변 글 영향(요건으로 섞임은 `source_sids`로 못 막음, `not_a_jd`는 요건 0개일 때만)을 적었다.
7. **경력기술서 평가 세트 삭제** — 반영(서류 대화 세트 15건 → 자소서 10건, 출시 전 체크리스트 ⑥도).
