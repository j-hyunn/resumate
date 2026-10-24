# 하네스 변경 이력

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-10-23 | 초기 구성 (기획팀 5인: product-planner, ux-planner, ai-feature-designer, data-architect, spec-reviewer) | 전체 | 기획 단계 착수 |
| 2026-10-23 | 하네스 설명·변경 이력을 CLAUDE.md에서 `.claude/harness/`로 분리 | CLAUDE.md, .claude/harness/, resumate-planning | CLAUDE.md는 참조만 두기로 함 |
| 2026-10-23 | 에이전트·스킬(references 포함)을 영어로 재작성. 산출물은 한국어 유지, 스킬 description에 한국어 트리거 키워드 병기 | .claude/agents/, .claude/skills/ | 에이전트·스킬은 영어로 작성하기로 함 |
| 2026-10-24 | 백엔드 하네스 추가 (4인: db-engineer, api-engineer, ai-pipeline-engineer, backend-qa). 오케스트레이터 `resumate-backend`, 스킬 supabase-migration · nextjs-server-api · ai-pipeline-impl · backend-integration-qa(+ run-checks.sh), 공통 컨텍스트·슬라이스 목록(S0~S9) | .claude/agents/, .claude/skills/, .claude/harness/README.md, CLAUDE.md | 기획 완료 후 백엔드 구현 착수. 사용자 선택: 4인 팀, 원격은 Supabase 개발 브랜치까지, 하네스가 프로젝트 골격 생성 |
| 2026-10-24 | 기획 오케스트레이터의 새 실행 시 `_workspace/` 이동 범위에서 `_workspace/backend/` 제외 | resumate-planning | 백엔드 작업 폴더가 기획 재실행 때 함께 옮겨지지 않게 함 |
