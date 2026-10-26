# S2 career data 요약

## 만든 것
### DB (마이그레이션 9개)
- 테이블: `experiences`, `educations`, `projects`, `project_details`, `achievements`, `skills`, `project_skills`
  - RLS, 복합 FK, CHECK, 인덱스
  - 트리거: status 계산(DB가 단일 원천), 부모 프로젝트 재계산, `updated_at`, `career_data_updated_at`, 고아 태그 스킬 정리
- RPC: `get_data_readiness()`(§6 모양 그대로), `reorder_project_details`, `get_deletion_impact`, `delete_career_item`
- 권한: app_ai_writer는 커리어 7개 테이블 select와 readiness 실행만 할 수 있다.

### API
- 계약과 enum
- Server Actions
  - 자동 저장 5종: 클라이언트 id, 멱등 생성, `expectedUpdatedAt` 충돌 검사
  - 스킬 4종, 상세 내용 순서 변경, readiness, 삭제 영향·삭제
- `getCareerTree`: 연도 묶음은 순수 함수 `groupCareerByYear`(§2.4)

## 검사
typecheck / lint / Vitest 237개(S2 통합 16개 포함) / build / pgTAP 265개 모두 PASS

## QA
- 2라운드: Minor 7건 중 6건 해결. QA-S2-07은 S4 메모(decisions.md).
- 라운드 2에서 생긴 Major QA-S2-08은 라운드 뒤에 해결하고 리더가 확인했다.
- 열린 이슈 없음.

## 화면 연결 단계 규칙 (`02_api-engineer_notes.md`)
- 새 행은 `crypto.randomUUID()`로 id를 만들고, 생성 응답이 올 때까지 다음 저장을 보내지 않는다.
- 이후 저장에는 항상 직전 응답의 `updatedAt`을 `expectedUpdatedAt`으로 넣는다.
- 상세 내용 저장·삭제 응답의 부모 프로젝트 `updatedAt`으로 열린 프로젝트 폼의 값을 바꾼다.

## spec-gaps 추가 [가정]
- achievements `kind` 계산식
- skills 정규화 규칙
- 삭제 모드 값 이름(UX C-05에 맞춤)
- `profile_filled` 정의, readiness 세부 규칙, cascade 집계 범위, 길이 제한 미정 필드
- complete 상세 내용은 있는데 이름·역할이 빈 프로젝트의 readiness 안내

## 연결
UI 화면 없음 → A2 career "연결 대기"
