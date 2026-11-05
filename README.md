# Resumate

경력직 이직자를 위한 AI 커리어 관리 서비스. 커리어 데이터를 쌓아 두고, 지원하는 회사의 JD에 맞춰 인사이트·경력기술서·자기소개서를 만들고, 모의 면접으로 준비한다.

AI 기능은 사용자가 본인 API 키(OpenAI / Gemini / Claude 중 1개)를 연결하면 열리는 **BYOK** 방식이다. 커리어·JD·지원 현황은 AI 없이도 동작한다.

## 주요 기능

| 메뉴 | 내용 |
|------|------|
| **커리어** | 경력·교육·독립 프로젝트를 시작 연도별로 정리. 프로젝트마다 STAR(상황/역할/행동/결과·성과/배운 점)를 쓰고, Resumate AI 패널과의 대화로 채운다. |
| **자기소개서 관리** | 지원 건마다 JD를 등록하고 인사이트, 경력기술서, 자소서 문항 답변을 만든다. AI 출력은 모두 사용자 데이터·JD 근거에 연결된다. |
| **모의 면접** | 직무/컬처핏 면접 질문을 만들고, 답을 한 번에 제출하면 100점 만점 점수와 피드백을 준다. |
| **지원 현황** | 지원 건을 전형 단계별 칸반 보드로 관리한다. |

설정에서 AI 키 등록·검증, 이번 달 토큰 사용량과 예상 비용을 볼 수 있다.

## 기술 스택

- **앱**: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · Tiptap
- **백엔드**: Supabase (Postgres, Auth — Google 로그인, RLS) · Server Actions · Route Handlers(SSE)
- **AI**: OpenAI / Google Gen AI / Anthropic SDK (사용자 키, 서버에서 봉투 암호화 보관)
- **테스트**: Vitest · pgTAP (`supabase/tests/`)
- **배포**: Vercel (`icn1`, Cron: AI 작업 정리·보유 기간 파기)

## 디렉터리 구조

```
src/
  app/          라우트 (App Router, 라우트 그룹별 레이아웃)
  components/   화면 영역별 컴포넌트 + ui/(shadcn)
  lib/          데이터 계층(data/), 계약(contracts/), mock, 유틸
  server/       서버 전용 — actions, services, ai, jobs, keys, auth, db
supabase/
  migrations/   스키마·RLS·RPC 마이그레이션
  tests/        pgTAP 테스트
docs/
  planning/     기획 문서 (PRD, 유저 플로우, AI 기능, 데이터 모델, 결정 기록)
  ui/           디자인 시스템, 화면 진행 현황
  legal/        개인정보 처리방침, 이용약관, 국외 이전 고지
_workspace/     기획·QA 작업 원본과 리뷰 기록
```

## 문서

- [기획 문서](docs/planning/README.md) — 현재 버전, 결정 기록, 남은 일
- [디자인 시스템](docs/ui/design-system.md) · [화면 진행 현황](docs/ui/screen-status.md)
- [Claude Code 하네스](.claude/harness/README.md) — 기획·UI·백엔드 에이전트 팀 구성
