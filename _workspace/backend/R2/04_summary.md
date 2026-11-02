# R2 바뀐 A1 반영 (다시 시도의 공급자) 요약

- 상태: done (2026-11-06). QA 2라운드를 마쳤고 열린 이슈는 없다.
- 근거: 사용자가 바꾼 A1(2026-11-05)과 갱신된 기획 문서(DM 2.9.1·2.11.7, AI C-11.4, decisions A1 세부·R-63·R-64). 기획 브랜치 `claude/planning-backend-gaps-3192d0`는 아직 커밋 전이다.
- 연결: UI 없음 → "연결 대기"

## 바뀐 것
- **같은 행 다시 시도**(`POST /api/ai-jobs/{id}/retry`, 비동기 `insight`·`interview_questions`·`interview_evaluation`)
  - 누른 시점의 **활성 공급자·등급**으로 돈다. 모델은 새 작업과 같은 라우팅으로 정한다.
  - 공급자나 연결 등급이 작업과 **다르면**:
    - `step_outputs`를 비우고 처음부터 다시 한다.
    - 그 작업이 쓴 결과 행을 모두 다시 열어 덮어쓴다(R-63).
      - 인사이트: `generating`으로 되돌린다.
      - 면접 질문: 지운다. 답변은 빈 초안뿐이다.
      - 평가와 종합: 모두 `pending`으로 되돌린다.
  - **같으면** 지금처럼 끝난 단계는 건너뛰고 실패한 행만 다시 연다.
  - 거부(409, 작업은 `failed` 그대로): `key_missing` → `key_invalid` → `ai_consent_required` 순서로 판정한다. 사용자가 그사이 공급자를 바꾸면 `ai_connection_changed`를 낸다(한 번 다시 읽어 재호출한 뒤에도 어긋날 때).
- **DB**
  - 새 definer RPC `retry_ai_job(p_ai_job_id, p_expected_run_generation, p_model, p_model_tier, p_run_meta, p_expected_provider, p_expected_connection_tier)`. 실행은 `app_ai_writer`만 할 수 있다.
  - 활성 공급자와 등급은 DB에서 읽는다.
  - 가드 트리거는 공급자 컬럼이 `failed → queued` 전이에서만 바뀌게 한다.
- **API 계약**
  - 다시 시도 응답에 `restarted`를 더했다.
  - 작업 상태 응답에 배지용 `retry: { provider, fromScratch }`를 더했다.
  - 새 오류 코드 매핑: `ai_connection_changed`, `invalid_run_meta` 등.
- 새 작업 시작 경로(①)의 거부 코드와, 새 작업으로 도는 재실행이 활성 공급자를 쓰는지 확인했다. 바꾼 것은 없다.
- AI 파이프라인은 고치지 않았다.
- 마이그레이션: `20261106000100_r2_retry_ai_job.sql`(1개). QA-01 때 커밋 전 파일을 직접 고쳤다. 5인자 판이 적용된 로컬 DB는 `db reset`이 필요하다.

## 검사
| 검사 | 결과 |
|------|------|
| typecheck | 통과 |
| lint | 통과 (경고 0) |
| Vitest | 통과 (90파일, 1439개, 통합 포함) |
| build | 통과 |
| pgTAP | 통과 (45파일, 2158개) |

## QA
- 1라운드: Major 1건(활성 공급자 경쟁), Minor 3건(면접 통합 테스트 없음, 판정 순서, 주석). 모두 고쳤다.
- 2라운드: 0건. 409 거부 때 공급자 호출·사용 기록·예약이 모두 0인 것을 확인했다.

## 기획 확인이 필요한 것 (spec-gaps "2026-11-06 · R2")
- `ai_connection_changed`를 DM 2.11.7 경로 ② 표에 넣을지, 화면 문구를 어떻게 할지(db ⑧)
- JD 요건 추출과 서류 3종 생성은 새 작업 시작에서 키 없음·동의 필요를 `key_missing` 하나로 낸다. 2.11.7 표에 이 경로가 없다(api ①).
- 구현에서 정한 것
  - 면접 질문은 지워서 다시 연다 `[가정]`
  - 이미 끝난 결과 묶음은 다시 열지 않는다 `[가정]`
  - `input_hash`를 비운다 `[가정]`
  - `restarted`는 공급자·등급만 보고 판정한다
  - 계약 이름 `retry`, `restarted`
