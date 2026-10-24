# 하네스 변경 이력

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-10-23 | 초기 구성 (기획팀 5인: product-planner, ux-planner, ai-feature-designer, data-architect, spec-reviewer) | 전체 | 기획 단계 착수 |
| 2026-10-23 | 하네스 설명·변경 이력을 CLAUDE.md에서 `.claude/harness/`로 분리 | CLAUDE.md, .claude/harness/, resumate-planning | CLAUDE.md는 참조만 두기로 함 |
| 2026-10-23 | 에이전트·스킬(references 포함)을 영어로 재작성. 산출물은 한국어 유지, 스킬 description에 한국어 트리거 키워드 병기 | .claude/agents/, .claude/skills/ | 에이전트·스킬은 영어로 작성하기로 함 |
| 2026-10-24 | UI 하네스 추가: 에이전트 3개(ui-designer, frontend-engineer, ui-qa), 스킬 4개(resumate-ui 오케스트레이터 + ui-context 참조, ui-design-system, ui-implementation + patterns 참조, ui-qa-review). 스택 Tailwind + shadcn/ui, Figma는 선택적 사용, 백엔드는 mock 데이터 계층 | .claude/agents/, .claude/skills/, .claude/harness/README.md | 기획 완료 후 디자인·화면 구현 단계 착수 |
| 2026-10-24 | ux-flow-spec description에 시각 디자인·화면 코드는 UI 스킬로 가라는 안내 추가 | skills/ux-flow-spec | UI 하네스와 트리거 경계 구분 |
