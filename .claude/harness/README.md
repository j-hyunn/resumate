# Resumate 하네스

이 저장소에는 하네스가 3개 있다. 구성 위치는 공통이다.

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

## 3. 백엔드 하네스

**목표:** `docs/planning/` 기획을 명세로 삼아 Next.js 서버(Server Action·Route Handler·비동기 AI 작업), Supabase(마이그레이션·RLS·RPC), Claude AI 파이프라인(프롬프트·근거 검증)을 기능 단위 슬라이스(S0~S9)로 구현하고, 화면의 mock 데이터 계층을 실제 서비스로 연결한다.

**진입점:** `resumate-backend` 스킬 (`.claude/skills/resumate-backend/SKILL.md`)

**트리거:** 백엔드 구현·프로젝트 셋업·DB 구축·API 개발·AI 기능 구현·mock 데이터 계층 연결·백엔드 수정·QA 재실행·다음 슬라이스 진행 요청. 단순 질문은 직접 응답 가능.

**팀:** db-engineer, api-engineer, ai-pipeline-engineer, backend-qa (에이전트 팀, 팀 도구가 없으면 서브 에이전트로 대체)

**범위와 안전 정책:** 로컬 Supabase와 Supabase 개발 브랜치까지만 적용한다. 메인(프로덕션) 프로젝트 적용·배포·커밋은 사용자가 요청할 때만 한다. 화면과 컴포넌트는 UI 하네스 소관이다.

**공통 백엔드 컨텍스트:** `.claude/skills/resumate-backend/references/backend-context.md`, 슬라이스 목록 `references/slice-catalog.md`

**작업 폴더:** `_workspace/backend/` (슬라이스 상태 `slices.md`, 기획 차이 `spec-gaps.md`, 구현 결정 `decisions.md`)

## 하네스 간 관계

```
                       ┌──→ resumate-ui ──── 화면 + mock 데이터 계층(src/lib/data, src/lib/mock)
resumate-planning ─────┤                                   │  연결 단계: 함수 시그니처는 유지,
  (docs/planning/*)    └──→ resumate-backend ── DB·API·AI ──┘  구현만 실제 서비스로 교체
        ↑                          │
        └── 기획 확인 필요 / spec-gaps.md (사용자 경유) ──┘
```

- 기획 문서가 UI와 백엔드 모두의 명세다. 두 하네스 모두 `docs/planning/`을 직접 고치지 않는다. 모순·누락은 UI는 "기획 확인 필요", 백엔드는 `_workspace/backend/spec-gaps.md`로 사용자에게 넘기고, 기획 수정은 `resumate-planning`으로 한다.
- 두 하네스가 같은 Next.js 앱을 다룬다. 프로젝트 골격은 먼저 실행한 쪽이 만들고, 다른 쪽은 자기 의존성만 추가한다. 파일 소유권은 `backend-context.md`의 "Coexisting with the UI harness"에 있다.
- 화면 데이터 계층을 실제 백엔드로 바꾸는 작업(연결 단계)은 백엔드 하네스가 한다. UI 실행이 진행 중일 때는 하지 않는다.
