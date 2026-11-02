# 브리프 — 기획 결정 Q53-1~10 화면 반영 (2026-10-30)

기준: PRD v4.4 / 플로우 v5.4 / AI v4.4 / 데이터 모델 v4.3. 결정 원문: `_workspace/00_input/planning-decisions-v53-qa.md`, `docs/planning/decisions.md` 3.8. 리뷰: `_workspace/03_spec-reviewer_review_q53.md`.
**mock 계층만.** 실제 백엔드 연결·main 병합·커밋 없음. 백엔드 후속은 `decisions.md` 4.1a(이번 범위 밖).

| # | 화면 | 바꿀 것 | 명세 |
|---|------|---------|------|
| Q53-1 | S-14 | **임시 처리(UQ-580)를 되돌린다.** 동의 필요 → 만들기 전에 C-21, 동의 뒤 만들면서 바로 추출. 키 무효 → 키 교체 안내(입력은 브라우저 세션에 보존). 행을 만들지 않는다. 키 없음 흐름은 그대로. mock `createApplicationProject`는 insert 전에 `key_invalid`/`ai_consent_required`로 거부(경로 ⑥). `preview_skip_extraction`과 S-14의 추출 건너뜀 안내 제거 | UX S-14·FL-10·C-18, DM 2.11.7 ⑥ |
| Q53-2 | S-15, S-16, S-33, S-37 | 입력 원인(`not_a_jd`·`input_too_long`·`safety_blocked`) 추출 실패 + 요건 0개면 **"공고 원문 고치기"**. S-15 "공고 원문 수정" 표의 상태 전부(조건, 진입, 수정 중, 경고, 저장, 재추출, 이름, 상태, 돌아가기, 원인 모름). 저장은 `update_failed_jd_raw_text` mock(거부 코드 포함)과 `raw_text_edited_at`. 저장 시점부터 그 전 실패 안내를 숨김(C-03, S-16 "없음" + 문구, S-33 "공고를 고쳤어요…", S-37) | UX S-15·C-20 "입력 원인 실패의 이동"·C-03, DM 2.6.1 |
| Q53-3 | S-22 | 입력 원인 답변은 다시 채점 대상에서 제외, 대상이 없으면 버튼 없음 + 원인 + "이 기업 JD로 새 면접 시작". `answer_evaluations.error_code` mock·fixture, `interview_evaluation_input_only`. S-22의 로컬 `InputCausedGradingNotice` 정리. 판정은 DM 2.7.1 표를 한 곳(공용 함수)에 둔다 | UX S-22·C-20, DM 2.7.1 |
| Q53-4 | S-17 | 요건 없는 JD는 추출 먼저 → 설정 화면, 기본 **"AI에게 맡기기"**(지금은 "직접 고르기"로 시작). 동의 필요·키 무효면 자동 호출 안 함, 누를 때 C-21 / 키 교체. `composing` 복원 진입은 자동 호출 없음 | UX FL-03·S-17·C-11, AI AI-11 |
| Q53-5 | S-22, S-37 | 조건 = 다시 채점 대상 0 + 평가 성공 ≥ 1 + 종합 실패가 입력 원인 아님 → **"종합 평가 다시 정리"**(AI-06 없음, 활성 공급자 배지·토큰 안내), 진행 `prepare`→`summarize`→`score`→`complete`. `{n}` = 다시 채점 대상 수. 대상 0 세션의 같은 행 다시 시도는 `ai_job_not_retryable` | UX S-22, AI 다시 채점, DM 2.7.1·2.9.1 |
| Q53-6 | S-37 | 메뉴는 채점 실패 행 + 완료인데 실패 답변이 남은 행 모두(S-22와 같은 판정, 입력 원인만 남으면 없음). 종합만 실패면 "종합 평가 다시 정리" | UX S-37 |
| Q53-7 | S-19, S-17 | 경력기술서 중단 = 실패 아님, C-20 없음, 임시 블록 폐기. 다시 생성이면 새 행 삭제, 첫 생성이면 `composing`(options 유지). S-17 "작성 중" 행(열면 설정 복원, 삭제 가능), S-13·S-31·S-39 초안 수·C-05 N에서 제외 | UX C-04·S-19·S-17, DM 2.7.1·A.9 |
| Q53-8 | C-09 | `project_fields`일 때 제목 변경("한 칸만 채우면 바로 쓸 수 있어요" / 두 칸 문구, 읽기 전 기본 문구). 칸 수 계산은 UX C-09 | UX C-09 |
| Q53-9 | S-33, S-20 | 질문 생성 입력 원인 실패 → **S-15로**(`insufficient_data`만 S-20 C-09). 요건이 이미 있으면 S-15 읽기 전용 + "새 기업 JD 추가"·"커리어 정리하기" 안내. S-20 "그만두고 새로 시작"(이어서 쓰기와 함께, 판정·프리필은 명세), 질문 0개 그만둔 세션 표시·면접 수 제외(S-13·S-31·S-39) | UX C-20·S-33·S-20·S-37 |
| Q53-10 | S-22, S-37, L-01, S-20 | 다시 채점 대상도 없고 종합 다시 정리도 안 되는 입력 원인 실패 세션은 **첫 열람에 "새 결과" 지움**. 그 밖 실패 세션은 A9. `markInterviewResultViewed`와 `hasNewResult`·배지 반영 | UX S-22·S-37·L-01, DM 2.7.1·A.12 |

## 함께 고칠 것
- `types/db.ts`: `raw_text_edited_at`, `answer_evaluations.error_code`, 새 거부 코드.
- 픽스처·`?state=`: 입력 원인 실패 JD(원문 수정 가능), 입력 원인 채점 실패 세션, 종합만 실패 세션, 첫 생성 중단 뒤 `composing` 초안. `/dev/states` 갤러리 항목.
- `gate-preview`와 `?state=` 미리보기가 실제 저장소 상태를 바꾸지 않게 할 것.
- 새 문구는 명세의 문구 그대로, 명세에 없으면 `[UI-가정]`.
