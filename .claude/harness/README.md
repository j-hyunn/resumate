# Resumate 하네스

변경 이력은 `.claude/harness/CHANGELOG.md`에 있다. 에이전트는 `.claude/agents/`, 스킬은 `.claude/skills/`에 있다.

## 1. 기획 하네스

**목표:** 커리어 데이터 관리 · JD 인사이트/채팅 · AI 모의 면접 3대 축의 기획 문서(PRD, 유저 플로우, AI 기능 명세, 데이터 모델, 결정 로그)를 `docs/planning/`에 만들고 지속 갱신한다.

**진입점:** `resumate-planning` 스킬 (`.claude/skills/resumate-planning/SKILL.md`)

**트리거:** 기획·요구사항·MVP·기능 명세·화면 흐름·AI 기능 설계·데이터 모델 관련 작업 요청(초기 실행과 수정·보완·재실행 모두). 단순 질문은 직접 응답 가능.

**범위:** 기획 전용. 코드 작성·DB 마이그레이션·배포는 하지 않는다.

**공통 제품 컨텍스트:** `.claude/skills/resumate-planning/references/product-context.md`

## 2. 백엔드 하네스

**목표:** `docs/planning/` 기획을 명세로 삼아 Next.js 서버(Server Action·Route Handler·비동기 AI 작업), Supabase(마이그레이션·RLS·RPC), Claude AI 파이프라인(프롬프트·근거 검증)을 기능 단위 슬라이스(S0~S9)로 구현한다.

**진입점:** `resumate-backend` 스킬 (`.claude/skills/resumate-backend/SKILL.md`)

**트리거:** 백엔드 구현·프로젝트 셋업·DB 구축·API 개발·AI 기능 구현·백엔드 수정·QA 재실행·다음 슬라이스 진행 요청. 단순 질문은 직접 응답 가능.

**팀:** db-engineer, api-engineer, ai-pipeline-engineer, backend-qa (에이전트 팀, 팀 도구가 없으면 서브 에이전트로 대체)

**범위와 안전 정책:** 로컬 Supabase와 Supabase 개발 브랜치까지만 적용한다. 메인(프로덕션) 프로젝트 적용·배포·커밋은 사용자가 요청할 때만 한다. 프론트엔드 화면은 범위 밖이다.

**공통 백엔드 컨텍스트:** `.claude/skills/resumate-backend/references/backend-context.md`, 슬라이스 목록 `references/slice-catalog.md`

**작업 폴더:** `_workspace/backend/` (슬라이스 상태 `slices.md`, 기획 차이 `spec-gaps.md`, 구현 결정 `decisions.md`)

## 두 하네스의 관계

기획 문서가 백엔드의 명세다. 백엔드 구현 중 기획의 모순·누락이 나오면 백엔드 팀은 `docs/planning/`을 직접 고치지 않고 `_workspace/backend/spec-gaps.md`에 기록한다. 사용자가 `resumate-planning`으로 기획을 고치면, 백엔드 오케스트레이터가 다음 실행 때 영향받은 슬라이스를 찾아 갱신을 제안한다.
