# 하네스 변경 이력

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-10-23 | 초기 구성 (기획팀 5인: product-planner, ux-planner, ai-feature-designer, data-architect, spec-reviewer) | 전체 | 기획 단계 착수 |
| 2026-10-23 | 하네스 설명·변경 이력을 CLAUDE.md에서 `.claude/harness/`로 분리 | CLAUDE.md, .claude/harness/, resumate-planning | CLAUDE.md는 참조만 두기로 함 |
| 2026-10-23 | 에이전트·스킬(references 포함)을 영어로 재작성. 산출물은 한국어 유지, 스킬 description에 한국어 트리거 키워드 병기 | .claude/agents/, .claude/skills/ | 에이전트·스킬은 영어로 작성하기로 함 |
| 2026-10-24 | UI 하네스 추가: 에이전트 3개(ui-designer, frontend-engineer, ui-qa), 스킬 4개(resumate-ui 오케스트레이터 + ui-context 참조, ui-design-system, ui-implementation + patterns 참조, ui-qa-review). 스택 Tailwind + shadcn/ui, Figma는 선택적 사용, 백엔드는 mock 데이터 계층 | .claude/agents/, .claude/skills/, .claude/harness/README.md | 기획 완료 후 디자인·화면 구현 단계 착수 |
| 2026-10-24 | ux-flow-spec description에 시각 디자인·화면 코드는 UI 스킬로 가라는 안내 추가 | skills/ux-flow-spec | UI 하네스와 트리거 경계 구분 |
| 2026-10-24 | 백엔드 하네스 추가 (4인: db-engineer, api-engineer, ai-pipeline-engineer, backend-qa). 오케스트레이터 `resumate-backend`, 스킬 supabase-migration · nextjs-server-api · ai-pipeline-impl · backend-integration-qa(+ run-checks.sh), 공통 컨텍스트·슬라이스 목록(S0~S9) | .claude/agents/, .claude/skills/, .claude/harness/README.md, CLAUDE.md | 기획 완료 후 백엔드 구현 착수. 사용자 선택: 4인 팀, 원격은 Supabase 개발 브랜치까지, 하네스가 프로젝트 골격 생성 |
| 2026-10-24 | 기획 오케스트레이터의 새 실행 시 `_workspace/` 이동 범위에서 `_workspace/backend/` 제외 | resumate-planning | 백엔드 작업 폴더가 기획 재실행 때 함께 옮겨지지 않게 함 |
| 2026-10-24 | UI 하네스와 백엔드 하네스의 경계 정리: 골격은 먼저 실행한 쪽이 만들고 다른 쪽은 의존성만 추가, 생성 타입은 `src/server/db/database.types.ts`, 백엔드 슬라이스에 mock 데이터 계층(`src/lib/data/`)을 실제 서비스로 바꾸는 연결 단계 추가, backend-qa에 UI 경계 Q11 추가, 기획 재실행 시 `_workspace/ui/`도 이동 제외 | resumate-backend, backend-context, slice-catalog, nextjs-server-api, supabase-migration, backend-integration-qa, db-engineer, api-engineer, resumate-planning, README | 같은 Next.js 앱의 `src/`를 두 하네스가 함께 다룸 |
