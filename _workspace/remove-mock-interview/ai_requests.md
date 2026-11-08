# AI 명세 → 다른 팀원 요청 (v4.14, 결정 사이클 remove-mock-interview)

- 작성: ai-feature-designer / 2026-11-08
- 기준 AI 명세: `_workspace/02_ai-feature-designer_ai-spec.md` **v4.14**
- 결정 입력: `_workspace/00_input/planning-decisions-remove-mock-interview.md` (RM-1~RM-3, 리더 판단 RM-A1~RM-A5 `[가정]`)
- 받은 요청: `_workspace/remove-mock-interview/prd_requests.md` (ai-feature-designer 1~6) — **6건 모두 반영했다**(아래 product-planner 1).
- 같은 내용이 AI 명세 끝 "다른 팀원에게 요청" 절에도 있다.

이 사이클은 **삭제만** 한다. 새 기능·새 저장 구조를 요구하지 않는다. 지운 ID(AI-05·06·07·10, 4장)는 비워 두고 재사용하지 않는다.

## data-architect (데이터 모델 04)

1. **`ai_jobs.job_type` CHECK에서 2값 삭제** (RM-1·RM-A2 `[가정]`): `interview_questions`(AI-05)·`interview_evaluation`(AI-06+AI-07). 남는 값은 **9개** — `jd_extraction` · `insight` · `career_description` · `draft_source_ranking` · `cover_letter` · `writing_chat_turn` · `key_verification` + (Should) `writing_assist` · `chat_reply`. 기존 행은 drop 마이그레이션에서 함께 지운다(RM-3). `target_type`에 면접 세션을 가리키는 값이 있으면 그것도 함께 지워 주세요(AI 명세는 그 값을 쓰지 않는다).
2. **`ai_usage_records.feature` CHECK에서 2값 삭제** (RM-A2 `[가정]`): `interview_questions`·`interview_evaluation`. 남는 값은 MVP **6개**(`jd_extraction` · `insight` · `career_description` · `cover_letter` · `writing_chat` · `key_verification`) + Should 2개(`writing_assist` · `chat_reply`) = CHECK 목록 **8개**(지금 10개). 화면 표기는 **5행**(AI C-13.1 — `career_description` + `cover_letter`가 한 행). `get_ai_usage_summary`는 계속 저장 값 그대로 돌려주고 묶음은 화면 매핑 상수가 한다(변경 없음).
   - **주의 — 이번 달 미터 합계가 줄어든다**: RM-A2대로 이미 쌓인 면접 사용량 행을 지우면, 이번 달(KST)에 면접을 쓴 사용자의 미터 합계가 그만큼 작아진다. AI C-13.1의 "과거 기록을 고치지 않는다"의 유일한 예외로 적었다. 행을 지우는 대신 남겨 두고 CHECK만 새 행에 거는 방법(`profile` 근거 행 SD-A19 패턴)도 있으나, 결정 입력이 "drop 마이그레이션에서 함께 지운다"로 정했으므로 본문은 그대로 따랐다 — 사용자 확인 대상으로 보고에 올린다.
3. **`evidence_links` 값 삭제** (RM-1·RM-A1 `[가정]`):
   - `source_type`에서 **`interview_answer`** 삭제(`source_id` = `interview_answers.id`였다).
   - `owner_type`에서 **`interview_question` · `answer_evaluation` · `session_feedback`** 삭제.
   - 기존 행은 소유 결과와 함께 **지운다**. `profile`(SD-A19)·`draft_section`(CL-3)처럼 "행을 남기고 insert 트리거로 새 행만 거부"하지 **않는** 이유: 그 둘은 남는 결과(인사이트·서류)의 근거 칩이라 보여야 했지만, 이 값들의 행은 지워지는 면접 결과에만 달려 있어 보일 화면이 없다(AI C-3).
4. **`writing_chats.return_target.feature`에서 `job_interview` 삭제** (RM-A1 `[가정]`): 남는 값은 `insight` · `career_description` · `cover_letter` 3개(AI-12 "대상·시작점"). 이미 `return_target.feature = 'job_interview'`인 대화가 있으면 **`return_target`을 null로 바꾸고 대화·제안은 그대로 두는 것**을 권고한다 — 대화는 커리어 데이터를 만드는 기록이라 면접과 함께 지울 이유가 없고, 돌아갈 화면만 없어졌다 `[가정]`. 다른 처리를 정하면 회신해 주세요.
5. **`get_data_readiness()`** (RM-A5 `[가정]`): 면접 분기(유형별 판정, "컬처핏은 JD만으로 가능")만 빼 주세요. **`data_sufficiency` `ok`/`thin`과 `hints`는 남깁니다** — 면접 전용이 아니라 **AI-02 인사이트 출력**(보완 안내 배너)이 씁니다(AI C-1, C-14 AI-02 행). 지울 것은 JD만으로 실행되던 **`none` 수준**뿐입니다. DM에 등급 값 목록이 있으면 `none`만 빼 주세요.
6. **자리 표시 6종 → 5종** (RM-A1): `[사례 입력 필요]`를 지웠다(AI C-5 — 면접 개선 답변 예시 전용). `validation_report`나 DB 상수에 토큰 목록이 있으면 함께 고쳐 주세요. 서류 정본에 이 토큰이 저장된 적은 없다(서류 초안 규칙이 쓰지 않았다).
7. **`app_ai_writer` grant·결과 저장 RPC**: AI 경로는 면접 테이블에 더 이상 쓰지 않는다(AI-05~07 저장 RPC·평가 저장·채점 마감 호출이 모두 없어짐). 면접 테이블분 grant는 DM 요청 2(PRD)대로 지워 주세요. AI 쪽에서 새로 필요한 권한은 없다.
8. **★ 남는 기능 수 재집계 — 확인 요청**: AI 명세 기준 셈은 다음과 같다. DM의 CHECK·상수와 맞는지 회신해 주세요.

   | 항목 | v4.13 | v4.14 |
   |------|-------|-------|
   | AI 기능 카드 | Must 10 (AI-01·02·03·11·04·05·06·07·12·13) + Should 3 (AI-08·09·10 보류) | **Must 7** (AI-01·02·03·11·04·12·13) + **Should 2** (AI-08·09) |
   | `ai_jobs.job_type` | 11 | **9** |
   | `ai_usage_records.feature` CHECK | 10 (MVP 8 + Should 2) | **8** (MVP **6** + Should 2) |
   | 사용량 화면 행 | 7 | **5** |
   | 비동기 작업 기능 | AI-02 · AI-05 · AI-06/07 | **AI-02 하나** |
   | 근거 `source_type` | (DM 목록) | `interview_answer` 하나 빠짐 |
   | 근거 `owner_type` | (DM 목록) | `interview_question`·`answer_evaluation`·`session_feedback` 빠짐 |
   | 자리 표시 토큰 | 6 | **5** |

   PRD v4.16의 "사용량 표 기능 행 5개 / 저장 `feature` 값 6개"와 AI 명세가 일치한다.

## ux-planner (UX 02)

1. **응답 모드**: 남는 비동기 작업은 **인사이트 하나**다. 면접 질문 생성·채점 작업이 없어져 C-03 "단계 문구"에서 **채점용 `prepare`·`evaluate`·`summarize`·`score`·`complete` 문구와 면접 질문 `generate`·`complete` 문구**를 지워 주세요(AI C-6 진행 단계 표).
2. **데이터 충분성 배너는 남깁니다**: AI-02 인사이트 결과의 `data_sufficiency.level = thin` + `hints` 보완 안내 배너는 **인사이트 화면에 그대로** 있어야 합니다. 지울 것은 면접 시작·결과 화면의 `thin`/`none` 안내뿐입니다. PRD 요청 6은 "데이터 충분성 등급 = 면접 전용"으로 봤는데, AI 쪽 판단은 **`none`만 면접 전용**입니다 — 다른 판단이면 회신해 주세요.
3. **자리 표시 강조·복사 전 경고 대상이 5종**입니다(`[사례 입력 필요]` 삭제, AI C-5).
4. **사용량 표 5행**(AI C-13.1)과, drop 마이그레이션 뒤 **이번 달 합계가 면접 사용분만큼 줄어든다**는 점(RM-A2) — 화면 안내가 필요한지 판단해 주세요(AI 쪽 권고: 안내 없음, 면접을 쓴 사용자가 적고 금액이 작다 `[가정]`).
5. **복귀 대상**: 게이트 진입 대화의 "돌아가기"가 가리킬 수 있는 화면은 인사이트·경력기술서·자소서 3곳이다(`job_interview` 삭제).

## product-planner (PRD 01)

1. **요청 6건 모두 반영했다**: (1) AI-05·06·07·10 카드 삭제, ID 비움 (2) 4.1·4.2·4.3과 C-13·C-14 면접 항목 삭제 (3) `interview_answer`·면접 소유자 3값·별칭 `Q-n` 삭제, V-x는 **번호를 다시 매기지 않았고 지운 번호도 없다**(V-5의 기능별 예외 두 줄만 삭제) (4) 등급 매핑·재시도 예시·토큰 표·비용 예시의 면접 항목 삭제 (5) D-14·OD-I1·OD-I2·D-AI-07·08·09 효력 없음(AI 8장) (6) **재집계 회신**: AI Must 7 + Should 2, 사용량 화면 **5행** / 저장 `feature` **6값** — PRD v4.16과 일치(위 data-architect 8 표).
2. **PRD 9.9 RM-A1 문구 확인 요청**: PRD는 "데이터 충분성 등급(면접 유형별 질문 가능 여부 판정 전용)"을 지웠다고 적었다. AI 명세에서 `data_sufficiency`의 **`ok`/`thin`은 AI-02 인사이트 출력이 쓴다**(보완 안내 배너). 면접 전용이었던 것은 **`none`(JD만) 수준**뿐이다. PRD 문구를 "등급 중 `none`" 정도로 좁혀 주세요.
3. **사용자 확인이 필요한 `[가정]` 4건** (AI 0.v414):
   - **AI-02 `prepare_answer` 유지** — "실제 채용 면접에서 질문받을 때의 대비 포인트"는 인사이트 보완점의 대응 방안 3종 중 하나다. 모의 면접 기능이 아니라 실제 전형 준비 조언이라 남겼다. 지우면 AI-02 정본 스키마·프롬프트가 바뀐다.
   - **AI-12 응답 역할 문구 "친절한 경력직 면접 코치" 유지** — 구현 프롬프트와 같은 말이라 문서만 바꾸지 않았다. 바꾸라면 다음 AI-12 프롬프트 개정 때 함께(`ai-12.reply` 버전 +1).
   - **공통 system 블록 `common.v3` → `common.v4`** — 자리 표시 목록에서 `[사례 입력 필요]`를 지우기 때문. 모든 기능의 `prompt_version`이 바뀌어 동일 입력 재사용이 한 번 끊긴다.
   - **면접 사용량 행 삭제로 이번 달 미터 합계가 줄어드는 것**(RM-A2의 파급).
4. **비용 예시 갱신**: 월 예시(지원 프로젝트 3개 …)가 면접 2세션을 빼고 약 $2.0~2.3 → **약 $1.4~1.7**(요약형 팩 시 약 $1.2), Gemini 무료 요청 약 110 → **약 95회** `[가정]`. PRD에 같은 예시 수치가 있으면 맞춰 주세요.

## spec-reviewer

- 이 사이클의 AI 명세 **정당한 잔존**: ① 0.v413 이하 "vN에서 바뀐 것" 절과 9장 변경 이력(역사 기록) ② 0.v414·4장 자리·AI-10 자리·8장 해소 표·본문의 `(v4.14, RM-n)` 삭제 기록 ③ AI-02 `prepare_answer`의 "실제 채용 면접" ④ AI-12 응답 역할 문구 "면접 코치" ⑤ `NFR-AI-05`·`D-AI-06`·`D-AI-10`처럼 다른 ID의 글자 일치.
