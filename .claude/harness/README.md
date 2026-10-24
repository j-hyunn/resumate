# Resumate 하네스

이 저장소에는 하네스가 2개 있다. 구성 위치는 공통이다.

- 에이전트: `.claude/agents/`
- 스킬: `.claude/skills/`
- 변경 이력: `.claude/harness/CHANGELOG.md`

## 1. 기획 하네스

**목표:** 커리어 데이터 관리 · JD 인사이트/채팅 · AI 모의 면접 3대 축의 기획 문서(PRD, 유저 플로우, AI 기능 명세, 데이터 모델, 결정 로그)를 `docs/planning/`에 만들고 지속 갱신한다.

**진입점:** `resumate-planning` 스킬 (`.claude/skills/resumate-planning/SKILL.md`)

**트리거:** 기획·요구사항·MVP·기능 명세·화면 흐름·AI 기능 설계·데이터 모델 관련 작업 요청(초기 실행과 수정·보완·재실행 모두). 단순 질문은 직접 응답 가능.

**범위:** 기획 전용. 코드 작성·DB 마이그레이션·배포는 하지 않는다.

**팀:** product-planner, ux-planner, ai-feature-designer, data-architect, spec-reviewer

**공통 제품 컨텍스트:** `.claude/skills/resumate-planning/references/product-context.md`

## 2. UI 하네스

**목표:** 기획 문서를 디자인 시스템(`docs/ui/design-system.md`)과 실제 동작하는 화면(Next.js + Tailwind + shadcn/ui, mock 데이터 계층)으로 옮기고, 화면별 진행 상황을 `docs/ui/screen-status.md`에서 추적한다.

**진입점:** `resumate-ui` 스킬 (`.claude/skills/resumate-ui/SKILL.md`)

**트리거:** UI 작업, 화면 구현, 디자인 시스템, 프론트엔드 구축, Figma 디자인 반영, 화면 수정·이어서·재실행, 기획 변경의 화면 반영, UI QA 이슈 수정.

**범위:** 디자인 시스템 + 화면 코드 + UI QA. 백엔드(Supabase 마이그레이션, 실제 Claude API 연동)는 하지 않고 mock 데이터 계층 뒤에 둔다. 기획 문서는 읽기만 하고, 기획 공백은 "기획 확인 필요"로 사용자에게 넘긴다.

**팀:** ui-designer, frontend-engineer(파운데이션 1 + 화면 영역별 인스턴스), ui-qa

**실행 모드:** 하이브리드 — 디자인 시스템·파운데이션은 서브 에이전트, 화면 영역은 에이전트 팀(없으면 백그라운드 서브 에이전트), 통합 QA는 서브 에이전트.

**공통 UI 컨텍스트:** `.claude/skills/resumate-ui/references/ui-context.md` (스택, 디렉터리, 영역 소유권, 데이터 계층 규칙)

## 하네스 간 관계

```
resumate-planning ──docs/planning/*──→ resumate-ui ──docs/ui/*, src/*──→ (다음: 백엔드)
        ↑                                   │
        └──── 기획 확인 필요 (사용자 경유) ────┘
```
