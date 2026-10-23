---
name: resumate-planning
description: "Resumate(AI 커리어 관리 서비스) 기획팀 오케스트레이터. 기획자·UX·AI기능·데이터·정합성 리뷰어 5인 팀을 조율해 PRD, 유저 플로우·화면 명세, AI 기능 명세, 데이터 모델, 결정 필요 목록을 docs/planning/에 만든다. 기획 시작, 기획 구체화, 요구사항 정리, 서비스 설계, MVP 정의, 기능 명세, 경력 관리·JD 인사이트·채팅·모의 면접 기획 요청 시 반드시 사용. 후속 작업: 기획 수정, 보완, 업데이트, 다시 실행, 재실행, 결정 사항 반영, 'AI 면접 부분만 다시', '데이터 모델만 수정', 이전 기획 결과 개선 요청에도 반드시 이 스킬을 사용. 구현(코드 작성, DB 마이그레이션, 배포)에는 쓰지 않는다."
---

# Resumate Planning Orchestrator

기획팀 5인을 조율해 Resumate의 기획 문서 세트를 만들고 갱신한다. 당신(메인 세션)이 리더다.

## 실행 모드: 에이전트 팀 (팀 도구 없으면 하이브리드 대체)

- **기본:** `TeamCreate` + `TaskCreate` + `SendMessage`로 팀 구성. 팀원이 필드명·응답 방식을 직접 맞춘다.
- **대체:** 세션에 `TeamCreate`가 없으면 `Agent` 도구(서브 에이전트) + 파일 기반 요청으로 같은 흐름을 돈다. 팀원 간 메시지 대신 각 문서의 "다른 팀원에게 요청" 섹션을 리더가 다음 단계 입력으로 넘긴다. 아래 각 Phase에 대체 경로를 같이 적었다.

## 팀 구성

| 팀원 | 에이전트 정의 | 스킬 | 출력 |
|------|-------------|------|------|
| product-planner | `.claude/agents/product-planner.md` | prd-writing | `_workspace/01_product-planner_prd.md` |
| ux-planner | `.claude/agents/ux-planner.md` | ux-flow-spec | `_workspace/02_ux-planner_flows.md` |
| ai-feature-designer | `.claude/agents/ai-feature-designer.md` | ai-feature-spec | `_workspace/02_ai-feature-designer_ai-spec.md` |
| data-architect | `.claude/agents/data-architect.md` | data-model-spec | `_workspace/02_data-architect_data-model.md` |
| spec-reviewer | `.claude/agents/spec-reviewer.md` | spec-consistency-review | `_workspace/03_spec-reviewer_review.md` |

모든 팀원은 `model: "opus"`로 띄운다. 모든 팀원은 작업 전 `.claude/skills/resumate-planning/references/product-context.md`를 읽는다.

경로는 모두 저장소 루트(`/Users/jehyun/Resumate`) 기준이다.

## 워크플로우

### Phase 0: 컨텍스트 확인

1. `_workspace/`와 `docs/planning/` 존재 여부를 확인한다.
2. 분기:
   - **둘 다 없음** → 초기 실행. Phase 1부터.
   - **있음 + 부분 수정 요청** (예: "모의 면접 부분만 다시", "결정 사항 반영해줘") → 부분 재실행. 아래 표로 재호출 대상을 정하고 Phase 3의 해당 부분 + Phase 4(관련 경계면만)만 실행.
   - **있음 + 기획 방향 자체를 새로** → 새 실행. `_workspace/`를 `_workspace_{YYYYMMDD_HHMMSS}/`로 옮긴 뒤 Phase 1부터. `docs/planning/`은 새 결과로 덮어쓰기 전에 git으로 변경이 추적되는지 확인한다.

| 수정 범위 | 재호출 | 이어서 갱신 |
|----------|--------|-----------|
| 타깃·MVP 범위·우선순위 | product-planner | 영향받는 팀원 전부 → reviewer |
| 화면·흐름 | ux-planner | reviewer (B1, B2, B5, B6) |
| AI 기능(채팅, 인사이트, 면접 등) | ai-feature-designer | 필드 변경 시 data-architect → reviewer (B3~B6, B11) |
| 데이터 구조 | data-architect | reviewer (B2~B4, B7, B10) |
| 사용자가 [결정 필요]에 답함 | 답이 닿는 문서의 담당자 | reviewer |

부분 재실행 시 프롬프트에 기존 산출물 경로와 사용자 피드백 원문을 넣는다.

### Phase 1: 브리프 & 인터뷰

1. `_workspace/00_input/` 생성.
2. 사용자 아이디어와 기존 대화 맥락을 `_workspace/00_input/brief.md`에 정리한다.
3. 기획의 방향을 가장 크게 바꾸는 질문을 `AskUserQuestion`으로 묻는다 (최대 4개, 이미 답이 있는 것은 생략):
   - 1차 타깃 (신입 / 경력 이직 / 직무 전환)
   - 경력 입력 방식 (직접 입력 / 이력서 업로드 파싱 / 둘 다)
   - 모의 면접 형식 (텍스트 / 음성 / 텍스트 먼저)
   - 산출물 범위 (인사이트만 / 자기소개서·경력기술서 초안까지)
   사용자가 "알아서"라고 하면 추천안을 `[가정]`으로 기록하고 진행한다.
4. 답변을 brief.md에 추가한다.

### Phase 2: 팀 구성 & PRD

**팀 모드:**
```
TeamCreate(team_name: "resumate-planning", members: [5명, 각자 agent 정의 파일 + model "opus"])
TaskCreate(tasks: [
  T1 PRD 작성 (product-planner),
  T2 유저 플로우·화면 명세 (ux-planner, depends_on T1),
  T3 AI 기능 명세 (ai-feature-designer, depends_on T1),
  T4 데이터 모델 (data-architect, depends_on T1),
  T5 점진 리뷰 (spec-reviewer, depends_on T1),
  T6 최종 리뷰 & 결정 필요 통합 (spec-reviewer, depends_on T2 T3 T4)
])
```
product-planner가 PRD를 쓰고 세 팀원에게 알린다.

**대체 경로:** `Agent(subagent_type: "product-planner", model: "opus")` 한 번 호출. 프롬프트에 brief 경로·출력 경로를 준다.

PRD가 나오면 리더가 MVP 범위와 결정 필요 상위 항목을 한 문단으로 사용자에게 공유한다(멈추지는 않는다).

### Phase 3: 병렬 상세 설계

**팀 모드:** ux-planner, ai-feature-designer, data-architect가 병렬로 작업한다.
- ux → data: 화면 필드명 확인 / ai → data: 입력 필드·출력 저장 요청
- ai → ux: 응답 방식·출력 구조 공유
- 범위 질문은 product-planner에게
- spec-reviewer는 산출물이 생기는 대로 해당 경계면부터 검토 (점진 리뷰)

**대체 경로 (순서가 중요하다 — data-architect가 요청을 모으는 허브):**
1. 한 메시지에서 ux-planner, ai-feature-designer를 `run_in_background: true`, `model: "opus"`로 병렬 호출. 각자 문서 끝에 `## 다른 팀원에게 요청` 섹션(받는 사람별 필드·확인 요청)을 쓰라고 지시한다.
2. 둘 다 끝나면 data-architect를 호출. 입력으로 PRD + 두 문서의 요청 섹션을 준다. 확정 필드명을 문서에 `## 요청 회신` 섹션으로 쓰게 한다.
3. data-architect의 회신에서 이름이 바뀐 필드가 있으면 해당 문서 담당자를 한 번 더 호출해 맞춘다.

### Phase 4: 정합성 리뷰

1. spec-reviewer가 B1~B11 전체를 검토하고 `03_spec-reviewer_review.md`를 쓴다.
2. 이슈는 담당자에게 간다 — 팀 모드는 SendMessage, 대체 경로는 리더가 담당자별 이슈 목록으로 해당 에이전트를 재호출(서로 독립이면 병렬).
3. 수정 후 reviewer가 재확인. **최대 2라운드.** 남은 이슈는 미해결로 둔다.
4. Critical이 미해결이면 Phase 5 보고 시 맨 위에 적는다.

### Phase 5: 통합 산출물

`docs/planning/`에 최종 문서를 쓴다 (_workspace 문서에서 작업용 요청·회신 섹션은 빼고 옮긴다):

| 파일 | 출처 |
|------|------|
| `docs/planning/README.md` | 리더가 작성 — 문서 목록, 버전, MVP 한 문단, 미해결 이슈 수 |
| `docs/planning/01-prd.md` | product-planner |
| `docs/planning/02-user-flows.md` | ux-planner |
| `docs/planning/03-ai-features.md` | ai-feature-designer |
| `docs/planning/04-data-model.md` | data-architect |
| `docs/planning/decisions.md` | reviewer의 통합 결정 필요 목록 + 확정된 결정 로그(날짜, 결정, 근거) |

`decisions.md`는 실행마다 누적한다. 사용자가 답한 결정은 "확정"으로 옮기고 날짜를 남긴다.

### Phase 6: 정리 & 보고

1. 팀 모드면 팀원에게 종료를 알리고 `TeamDelete`.
2. `_workspace/`는 지우지 않는다 (감사 추적용).
3. 사용자에게 보고: 만든 문서, MVP 요약, 미해결 이슈, **사용자가 답해야 할 결정 필요 상위 3~5개**.
4. 피드백을 묻는다: 결과물에서 고칠 부분, 팀 구성·흐름에서 바꿀 점. 피드백이 하네스 자체에 관한 것이면 해당 에이전트·스킬을 고치고 `.claude/harness/CHANGELOG.md`에 남긴다. CLAUDE.md는 포인터만 두므로 수정하지 않는다.

## 데이터 흐름

```
brief.md ─→ [product-planner] ─→ 01_prd
                                   │
            ┌──────────────────────┼──────────────────────┐
            ↓                      ↓                      ↓
      [ux-planner] ←─필드명─→ [data-architect] ←─필드─→ [ai-feature-designer]
            │       ←────────── 응답 방식 ──────────→     │
            ↓                      ↓                      ↓
        02_flows             02_data-model            02_ai-spec
            └──────────────────────┼──────────────────────┘
                                   ↓
                           [spec-reviewer] ─이슈→ 담당자 (≤2라운드)
                                   ↓
                            docs/planning/*
```

## 에러 핸들링

| 상황 | 대응 |
|------|------|
| 팀원 1명 실패 | 1회 재호출. 또 실패하면 그 문서 없이 진행하고 README·보고에 "미작성"과 영향 경계면을 명시 |
| PRD 실패 | 나머지가 모두 PRD에 의존하므로 진행하지 않는다. 재시도 후에도 실패하면 사용자에게 알림 |
| 팀원 간 결론 충돌 | 삭제하지 않고 양쪽 안을 병기해 `[결정 필요]`로 올린다 |
| 리뷰 2라운드 후 미해결 | 미해결로 보고서·README에 남기고 종료 |
| 팀원이 코드·마이그레이션을 시도 | 중단시키고 문서 작성으로 돌린다. 이 팀은 기획 전용이다 |

## 테스트 시나리오

### 정상 흐름
1. 사용자: "Resumate 기획 시작하자"
2. Phase 0: `_workspace/` 없음 → 초기 실행
3. Phase 1: 인터뷰 4문항, 사용자는 타깃만 답하고 나머지 "알아서" → 추천안 `[가정]` 기록
4. Phase 2: PRD 생성 (F-P1/P2/P3 기능 ID, MVP 경로 포함)
5. Phase 3: UX·AI·데이터 문서 생성, 필드명 합의
6. Phase 4: 리뷰 1라운드 이슈 6건 → 수정 → 2라운드 Minor 1건 미해결
7. Phase 5: `docs/planning/` 6개 파일 생성
8. Phase 6: 결정 필요 상위 항목과 함께 보고

### 부분 재실행 흐름
1. 사용자: "모의 면접은 음성으로 하기로 했어, 반영해줘"
2. Phase 0: 기존 산출물 있음 + 부분 수정 → ai-feature-designer 재호출 (기존 ai-spec 경로 + 결정 내용)
3. 오디오 저장 필드 필요 → data-architect 재호출, 면접 화면 변경 → ux-planner 재호출
4. reviewer가 B2~B6, B11만 재검토
5. `decisions.md`에 "모의 면접 형식: 음성 — 확정 (날짜)" 기록

### 에러 흐름
1. Phase 3에서 ai-feature-designer가 실패
2. 1회 재호출 → 다시 실패
3. UX·데이터 문서로 Phase 4 진행, B3~B6·B11은 "검토 불가"
4. 보고에 "AI 기능 명세 미작성 — 다음 실행 시 '`AI 기능 명세만 다시`'로 보완 가능" 명시
