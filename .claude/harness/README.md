# 하네스: Resumate 기획

**목표:** 커리어 데이터 관리 · JD 인사이트/채팅 · AI 모의 면접 3대 축의 기획 문서(PRD, 유저 플로우, AI 기능 명세, 데이터 모델, 결정 로그)를 `docs/planning/`에 만들고 지속 갱신한다.

**진입점:** `resumate-planning` 스킬 (`.claude/skills/resumate-planning/SKILL.md`)

**트리거:** 기획·요구사항·MVP·기능 명세·화면 흐름·AI 기능 설계·데이터 모델 관련 작업 요청(초기 실행과 수정·보완·재실행 모두). 단순 질문은 직접 응답 가능.

**범위:** 기획 전용. 코드 작성·DB 마이그레이션·배포는 하지 않는다.

**구성 위치:**
- 에이전트: `.claude/agents/`
- 스킬: `.claude/skills/`
- 공통 제품 컨텍스트: `.claude/skills/resumate-planning/references/product-context.md`
- 변경 이력: `.claude/harness/CHANGELOG.md`
