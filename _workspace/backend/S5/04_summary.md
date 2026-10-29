# S5 지원 프로젝트·JD (AI-01) 요약

- 상태: done (2026-10-31). QA 2라운드, Critical·Major 없음. Minor 1건(QA-S5-06) 열림.
- 연결: UI 없음 → A3 applications, A4 board "연결 대기"

## 만든 것
- **DB** (마이그레이션 `20261031000100`~`0500`)
  - 테이블
    - `application_projects`: 전형 단계 컬럼은 RPC로만 바뀐다
    - `application_stage_events`: 불변
    - `job_descriptions`: 원문 변경 금지 트리거(D-19)
    - `jd_requirements`
  - RPC
    - 지원 프로젝트: `create_application_project`(이름 규칙, `ai_run_allowed` 반환), `move_application_stage`, `set_application_outcome`
    - JD 추출(app_ai_writer 전용): `begin_jd_extraction`, `apply_jd_extraction`(실행 세대 검사, 회사명·포지션명 sid 검사, 사용자 수정 요건 보호), `fail_jd_extraction`
  - 트리거 `ai_jobs_release_jd_extraction`: 추출 작업이 실패·취소·멈춤으로 끝나면 JD를 `failed`로 바꾼다.
  - 기존 테이블 FK: `ai_jobs`와 `evidence_links`의 `application_project_id`는 cascade, `ai_usage_records`는 set null(사용 기록은 남김).
- **AI**
  - AI-01 요건 추출: 스키마, 프롬프트 `ai-01.extract.v1+common.v1`, 파이프라인, 검증, 저장 매퍼
    - 서버 검증: 원문에 없는 문장 ID는 지우고, 근거가 0개가 된 요건은 버린다.
    - 문장이 0개이거나, 요건 0개이면서 공고가 아니라고 판단되면 `not_a_jd`로 끝낸다.
  - `requirements_hash`는 `computeRequirementsHash` 한 곳에서 계산한다.
  - R-31 `selectGateRequirements`
    - AI-12 응답 호출에만 붙이고(prompt v2), 정리 호출은 v2지만 요건을 받지 않는다.
    - 요건 문구가 정리 결과의 출처가 될 수 없음을 테스트로 고정했다.
  - JD 문장 분할이 모든 유니코드 문자를 인식한다.
- **API**
  - contracts: `application.ts`, S5 enum
  - Server Actions: 생성(`shouldExtract`), 수정, 삭제(진행 중 작업 취소 후 삭제), 단계 이동, 결과 기록, 조회 4종(목록·보드·허브·JD)
  - 동기 라우트 `POST /api/application-projects/[id]/jd-extraction`
    - 30초 상한, C-11 실패 본문을 200으로 반환, `already_extracted`·`extraction_in_progress`는 409
    - S6–S8에서 재사용할 `ensureJdExtracted`
  - 목록·보드·허브에 `lastExtractionFailure`
  - 삭제된 프로젝트의 사용 기록은 프로젝트 칸을 null로 해서 다시 넣는다.
  - 일반 재시도 경로에서 `jd_extraction`을 제외했다.
  - AI-12 게이트 요건 연결, 대화 시작 때 `return_target` 소유 확인

## 검사
| 검사 | 결과 |
|------|------|
| typecheck | 통과 |
| lint | 통과 |
| Vitest | 통과 (61파일, 1021개, 통합 테스트 포함) |
| build | 통과 |
| pgTAP | 통과 (29파일, 1289개) |

## 열린 이슈
- QA-S5-06 [Minor, db]: 작업이 실패·취소로 끝나는 순간과 사용자의 프로젝트 삭제가 겹치면 교착이 날 수 있다(트리거와 삭제의 잠금 순서가 반대).
  - 데이터 손상은 없다. 삭제 쪽이 지면 500이 나고, 사용자가 다시 시도하면 된다.
  - 고치는 방법: 트리거에서 `skip locked`를 쓰거나, 삭제 액션이 `40P01`이면 1회 재시도한다.

## 사용자 확인이 필요한 `[가정]`
1. 기본 이름 "새 기업 JD (YYYY-MM-DD, KST)". 추출이 실패하고 이름이 비어 있을 때도 같다. 키 없이 회사명·포지션명을 입력했으면 "회사명 – 포지션명"으로 한다.
2. 생성과 추출을 분리한다. 생성 응답의 `shouldExtract`를 보고 화면이 추출 라우트를 바로 부른다.
3. `not_a_jd` 실패: 문장 0개, 또는 요건 0개이면서 공고가 아니라고 판단될 때만이다. 요건이 있으면 경고만 한다.
4. 짧은 JD 경고는 200자 미만, 긴 JD 경고는 24,000자 초과다.
5. 결과 기록에서 null로 결과를 지울 수 있다.
6. R-31 "근거가 약한 요건"은 키워드가 스킬·프로젝트 텍스트와 겹치지 않는 요건이다.
7. AI 추출이 실패하면 HTTP 200 + 실패 본문을 돌려준다. 공급자가 요청한 대기가 5초 이하면 요청 안에서 재시도한다.
8. 연차(`seniority`) 숫자는 인용 문장과 대조하지 않는다.

## S6–S8로 넘긴 것
- 목록·보드의 진행 표시(인사이트·서류·면접)
- C-14의 `in_progress_session_id`
- `get_deletion_impact`의 `by_application_project`
- 근거 출처 검사에 JD 문장·요건 추가
- 첫 AI 기능에서 `ensureJdExtracted`를 선행 단계로 쓰기(D-30)

상세: `02_*_notes.md`, `03_backend-qa_report.md`, `spec-gaps.md` 2026-10-31 S5 (api/db/ai).
